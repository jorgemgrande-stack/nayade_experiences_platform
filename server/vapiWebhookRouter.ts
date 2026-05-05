/**
 * VAPI Webhook Receiver — POST /api/vapi/webhook
 *
 * Recibe llamadas del asistente de voz VAPI, crea el lead con
 * source="vapi_llamada" y genera un presupuesto borrador, devolviendo
 * su URL pública en la misma respuesta (procesamiento síncrono).
 *
 * Respuesta siempre HTTP 200:
 *   { ok: true,  event: "contact_created", presupuesto_url: "https://..." }
 *   { ok: false, error: "..." }
 *
 * Secreto opcional: variable VAPI_WEBHOOK_SECRET (header x-vapi-secret o ?secret=).
 */
import express from "express";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { eq } from "drizzle-orm";
import { randomBytes } from "crypto";
import { quotes, ghlWebhookLogs, vapiCalls } from "../drizzle/schema";
import { createLead } from "./db";
import { generateDocumentNumber } from "./documentNumbers";
import { extractFromTranscript } from "./routers/vapiCalls";

const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 2 });
const _db = drizzle(_pool);

const VAPI_BASE_URL = "https://api.vapi.ai";

// Extrae datos de llamada de forma defensiva desde el payload de Vapi
function extractCallData(payload: any): {
  vapiCallId: string | null;
  assistantId: string | null;
  phoneNumber: string | null;
  customerName: string | null;
  customerEmail: string | null;
  startedAt: Date | null;
  endedAt: Date | null;
  durationSeconds: number | null;
  status: string | null;
  endedReason: string | null;
  recordingUrl: string | null;
  transcript: string | null;
  summary: string | null;
  structuredData: any;
} {
  // Vapi puede enviar el payload con o sin wrapper "message"
  const msg = payload.message ?? payload;
  const call = msg.call ?? payload.call ?? {};

  const vapiCallId = call.id ?? msg.callId ?? payload.callId ?? null;
  const assistantId = call.assistantId ?? msg.assistantId ?? null;
  const phoneNumber = call.customer?.number ?? call.phoneNumber ?? payload.phoneNumber ?? null;

  const startedAtRaw = call.startedAt ?? msg.startedAt ?? null;
  const endedAtRaw = call.endedAt ?? msg.endedAt ?? null;
  const startedAt = startedAtRaw ? new Date(startedAtRaw) : null;
  const endedAt = endedAtRaw ? new Date(endedAtRaw) : null;

  let durationSeconds: number | null = msg.durationSeconds ?? call.duration ?? null;
  if (!durationSeconds && startedAt && endedAt) {
    durationSeconds = Math.round((endedAt.getTime() - startedAt.getTime()) / 1000);
  }

  const status = call.status ?? msg.status ?? null;
  const endedReason = msg.endedReason ?? call.endedReason ?? null;
  const recordingUrl = msg.recordingUrl ?? msg.artifact?.recordingUrl ?? call.recordingUrl ?? null;
  const transcript = msg.transcript ?? msg.artifact?.transcript ?? null;
  const summary = msg.analysis?.summary ?? msg.summary ?? null;
  const structuredData = msg.analysis?.structuredData ?? msg.structuredData ?? null;

  // El nombre/email puede venir de structuredData (si el asistente tiene analysisPlan)
  // o de customer, o como último recurso se extrae del transcript por regex.
  const sd = structuredData ?? {};
  const sdName = sd.name ?? sd.customerName ?? sd.nombre ?? sd.fullName ?? null;
  const sdEmail = sd.email ?? sd.customerEmail ?? sd.correo ?? sd.emailAddress ?? null;

  const { name: tName, email: tEmail } = extractFromTranscript(transcript);

  const customerName = sdName ?? call.customer?.name ?? payload.customerName ?? tName ?? null;
  const customerEmail = sdEmail ?? call.customer?.email ?? payload.customerEmail ?? payload.email ?? tEmail ?? null;

  return {
    vapiCallId, assistantId, phoneNumber, customerName, customerEmail,
    startedAt, endedAt, durationSeconds, status, endedReason,
    recordingUrl, transcript, summary, structuredData,
  };
}

// Crea las tablas si no existen (auto-heal para Railway)
async function initVapiTables(): Promise<void> {
  try {
    await _pool.execute(`
      CREATE TABLE IF NOT EXISTS vapi_calls (
        id int AUTO_INCREMENT PRIMARY KEY,
        vapiCallId varchar(128) NOT NULL,
        assistantId varchar(128) NULL,
        phoneNumber varchar(32) NULL,
        customerName varchar(255) NULL,
        customerEmail varchar(320) NULL,
        startedAt timestamp NULL,
        endedAt timestamp NULL,
        durationSeconds int NULL,
        status varchar(64) NULL,
        endedReason varchar(128) NULL,
        recordingUrl text NULL,
        transcript mediumtext NULL,
        summary text NULL,
        structuredData json NULL,
        rawPayload json NULL,
        linkedLeadId int NULL,
        linkedBudgetId int NULL,
        linkedReservationId int NULL,
        reviewed boolean NOT NULL DEFAULT false,
        createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updatedAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_vapi_call_id (vapiCallId),
        INDEX idx_vapi_call_startedAt (startedAt),
        INDEX idx_vapi_call_status (status),
        INDEX idx_vapi_call_reviewed (reviewed),
        INDEX idx_vapi_call_leadId (linkedLeadId)
      )
    `);
    console.log("[VAPI] Tabla vapi_calls verificada/creada OK");
  } catch (err: any) {
    console.error("[VAPI] Error creando tabla vapi_calls:", err.message);
  }
}

initVapiTables();

const vapiWebhookRouter = express.Router();

vapiWebhookRouter.post("/api/vapi/webhook", express.json({ limit: "1mb" }), async (req, res) => {
  // 1. Secreto opcional — env var con fallback a BD
  const [secretRows]: any = await _pool.execute(
    "SELECT `value` FROM site_settings WHERE `key` = 'vapiWebhookSecret' LIMIT 1"
  ).catch(() => [[]]);
  const dbSecret = (secretRows as any[])[0]?.value ?? "";
  const secret = process.env.VAPI_WEBHOOK_SECRET || dbSecret || process.env.GHL_WEBHOOK_SECRET || "";
  if (secret) {
    const provided =
      (req.headers["x-vapi-secret"] as string | undefined) ??
      (req.query.secret as string | undefined);
    if (provided !== secret) {
      console.warn("[VAPI Webhook] Petición rechazada — secreto inválido");
      return res.status(401).json({ ok: false, error: "Unauthorized" });
    }
  }

  const payload = req.body ?? {};

  // 2. Extraer datos del contacto (VAPI puede enviarlos en distintas estructuras)
  const c = payload.contact ?? payload.customer ?? payload;
  const firstName = c.firstName ?? c.first_name ?? payload.firstName ?? payload.first_name ?? "";
  const lastName  = c.lastName  ?? c.last_name  ?? payload.lastName  ?? payload.last_name  ?? "";
  const name: string =
    [firstName, lastName].filter(Boolean).join(" ").trim() ||
    c.name || c.fullName || payload.name || payload.fullName || "Contacto VAPI";
  const email: string      = c.email ?? payload.email ?? "";
  const phone: string | undefined = c.phone ?? c.phoneNumber ?? payload.phone ?? payload.phoneNumber ?? undefined;
  const company: string | undefined = c.companyName ?? c.company ?? payload.company ?? undefined;
  const message: string = payload.summary ?? payload.message ?? payload.notes ?? `Lead recibido por llamada VAPI.`;

  // 3. Registrar el webhook
  let logId: number | null = null;
  try {
    const ins = await _db.insert(ghlWebhookLogs).values({
      event: "vapi_contact_created",
      payload,
      status: "recibido",
    });
    logId = Number((ins[0] as any).insertId);
  } catch (logErr: any) {
    console.error("[VAPI Webhook] Error al guardar log:", logErr.message);
  }

  // 3b. Siempre intentar guardar datos de llamada (incluso sin lead)
  const earlyCallData = extractCallData(payload);
  if (earlyCallData.vapiCallId) {
    await _db.insert(vapiCalls).values({
      vapiCallId: earlyCallData.vapiCallId,
      assistantId: earlyCallData.assistantId ?? undefined,
      phoneNumber: earlyCallData.phoneNumber ?? phone ?? undefined,
      customerName: earlyCallData.customerName ?? (name !== "Contacto VAPI" ? name : undefined) ?? undefined,
      customerEmail: (earlyCallData.customerEmail ?? email) || undefined,
      startedAt: earlyCallData.startedAt ?? undefined,
      endedAt: earlyCallData.endedAt ?? undefined,
      durationSeconds: earlyCallData.durationSeconds ?? undefined,
      status: earlyCallData.status ?? undefined,
      endedReason: earlyCallData.endedReason ?? undefined,
      recordingUrl: earlyCallData.recordingUrl ?? undefined,
      transcript: earlyCallData.transcript ?? undefined,
      summary: earlyCallData.summary ?? undefined,
      structuredData: earlyCallData.structuredData ?? undefined,
      rawPayload: payload,
    }).onDuplicateKeyUpdate({
      set: {
        // Actualizar nombre/email si structuredData los trae (webhook end-of-call)
        ...(earlyCallData.customerName ? { customerName: earlyCallData.customerName } : {}),
        ...(earlyCallData.customerEmail ? { customerEmail: earlyCallData.customerEmail } : {}),
        endedAt: earlyCallData.endedAt ?? undefined,
        durationSeconds: earlyCallData.durationSeconds ?? undefined,
        status: earlyCallData.status ?? undefined,
        endedReason: earlyCallData.endedReason ?? undefined,
        recordingUrl: earlyCallData.recordingUrl ?? undefined,
        transcript: earlyCallData.transcript ?? undefined,
        summary: earlyCallData.summary ?? undefined,
        structuredData: earlyCallData.structuredData ?? undefined,
        updatedAt: new Date(),
      },
    }).catch((e: any) => {
      if (e.code !== "ER_DUP_ENTRY") console.warn("[VAPI Webhook] Error guardando llamada:", e.message);
    });
  }

  if (!email && !phone) {
    const warn = "Contacto sin email ni teléfono — lead no creado";
    console.warn(`[VAPI Webhook] ${warn}`);
    if (logId) {
      await _db.update(ghlWebhookLogs)
        .set({ status: "error", errorMessage: warn })
        .where(eq(ghlWebhookLogs.id, logId))
        .catch(() => {});
    }
    return res.status(200).json({ ok: false, error: warn });
  }

  try {
    // 4. Crear lead (source=vapi_llamada → no se reenvía a GHL)
    const leadId = await createLead({
      name,
      email: email || `vapi-${Date.now()}@noreply.nayade`,
      phone,
      company,
      message,
      source: "vapi_llamada",
    });

    // 4b. Auto-crear cliente si no existe (para que aparezca en /admin/crm/clientes)
    try {
      const effectiveEmail = email || `vapi-${leadId}@noreply.nayade`;
      await _pool.execute(
        `INSERT IGNORE INTO clients (leadId, source, name, email, phone, isConverted, totalBookings, totalSpent, createdAt, updatedAt)
         VALUES (?, 'lead', ?, ?, ?, 0, 0, '0', NOW(), NOW())`,
        [leadId, name, effectiveEmail, phone || ""]
      );
    } catch {}

    // 5. Generar presupuesto borrador con URL pública
    const quoteNumber = await generateDocumentNumber("presupuesto", "vapi:quote", "system");
    const token = randomBytes(32).toString("hex");
    const origin = (
      process.env.APP_URL ??
      (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : "https://www.nayadeexperiences.es")
    ).replace(/\/+$/, "");
    const presupuestoUrl = `${origin}/presupuesto/${token}`;

    const validUntil = new Date();
    validUntil.setDate(validUntil.getDate() + 15);

    await _db.insert(quotes).values({
      quoteNumber,
      leadId,
      agentId: 0, // sistema — sin usuario autenticado
      title: `Presupuesto Nayade Experiences — ${name}`,
      status: "borrador",
      items: [],
      subtotal: "0",
      discount: "0",
      tax: "0",
      total: "0",
      conditions: "Presupuesto válido por 15 días. Sujeto a disponibilidad.",
      paymentLinkToken: token,
      paymentLinkUrl: presupuestoUrl,
      isAutoGenerated: true,
      validUntil,
    });

    if (logId) {
      await _db.update(ghlWebhookLogs)
        .set({ status: "procesado" })
        .where(eq(ghlWebhookLogs.id, logId))
        .catch(() => {});
    }

    // 6. Guardar datos de la llamada en vapi_calls (vinculada al lead)
    const callData = extractCallData(payload);
    if (callData.vapiCallId) {
      await _db.insert(vapiCalls).values({
        vapiCallId: callData.vapiCallId,
        assistantId: callData.assistantId ?? undefined,
        phoneNumber: callData.phoneNumber ?? phone ?? undefined,
        customerName: callData.customerName ?? name ?? undefined,
        customerEmail: email || undefined,
        startedAt: callData.startedAt ?? undefined,
        endedAt: callData.endedAt ?? undefined,
        durationSeconds: callData.durationSeconds ?? undefined,
        status: callData.status ?? undefined,
        endedReason: callData.endedReason ?? undefined,
        recordingUrl: callData.recordingUrl ?? undefined,
        transcript: callData.transcript ?? undefined,
        summary: callData.summary ?? undefined,
        structuredData: callData.structuredData ?? undefined,
        rawPayload: payload,
        linkedLeadId: leadId,
      }).onDuplicateKeyUpdate({
        set: {
          endedAt: callData.endedAt ?? undefined,
          durationSeconds: callData.durationSeconds ?? undefined,
          status: callData.status ?? undefined,
          endedReason: callData.endedReason ?? undefined,
          recordingUrl: callData.recordingUrl ?? undefined,
          transcript: callData.transcript ?? undefined,
          summary: callData.summary ?? undefined,
          structuredData: callData.structuredData ?? undefined,
          linkedLeadId: leadId,
          updatedAt: new Date(),
        },
      }).catch((e: any) => {
        console.warn("[VAPI Webhook] No se pudo guardar en vapi_calls:", e.message);
      });
    }

    console.log(`[VAPI Webhook] Lead #${leadId} creado — ${quoteNumber} — ${presupuestoUrl}`);

    return res.status(200).json({
      ok: true,
      event: "contact_created",
      presupuesto_url: presupuestoUrl,
    });

  } catch (err: any) {
    console.error("[VAPI Webhook] Error procesando payload:", err.message);
    if (logId) {
      await _db.update(ghlWebhookLogs)
        .set({ status: "error", errorMessage: err.message?.slice(0, 500) ?? "Error desconocido" })
        .where(eq(ghlWebhookLogs.id, logId))
        .catch(() => {});
    }
    return res.status(200).json({ ok: false, error: "Error interno procesando el lead" });
  }
});

export default vapiWebhookRouter;
