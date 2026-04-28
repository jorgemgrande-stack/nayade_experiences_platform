/**
 * GHL Webhook Receiver — POST /api/ghl/webhook
 *
 * Recibe eventos de GoHighLevel (ContactCreate, ContactUpdate, FormSubmit, etc.)
 * y crea un lead en la plataforma igual que cuando llega desde el formulario web.
 *
 * Seguridad opcional: si GHL_WEBHOOK_SECRET está configurado, el webhook debe
 * incluir el header "x-ghl-secret: <secret>" o el query param "?secret=<secret>".
 *
 * Todos los eventos se registran en ghl_webhook_logs para trazabilidad.
 * Siempre devuelve HTTP 200 — GHL reintentaría en caso de fallo.
 */
import express from "express";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { eq } from "drizzle-orm";
import { ghlWebhookLogs } from "../drizzle/schema";
import { createLead } from "./db";

const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 2 });
const _db = drizzle(_pool);

// Eventos que generan un lead en la plataforma
const LEAD_EVENTS = new Set([
  "ContactCreate",
  "FormSubmit",
  "OpportunityCreate",
]);

const ghlWebhookRouter = express.Router();

ghlWebhookRouter.post("/api/ghl/webhook", express.json({ limit: "1mb" }), async (req, res) => {
  // 1. Validación de secreto opcional
  const secret = process.env.GHL_WEBHOOK_SECRET;
  if (secret) {
    const provided =
      (req.headers["x-ghl-secret"] as string | undefined) ??
      (req.query.secret as string | undefined);
    if (provided !== secret) {
      console.warn("[GHL Webhook] Petición rechazada — secreto inválido");
      return res.status(401).json({ ok: false });
    }
  }

  const payload = req.body ?? {};
  const event: string = payload.type ?? payload.event ?? "unknown";

  console.log(`[GHL Webhook] Evento recibido: ${event}`, {
    contactId: payload.id ?? payload.contactId,
    email: payload.email,
    locationId: payload.locationId,
  });

  // 2. Registrar en ghl_webhook_logs
  let logId: number | null = null;
  try {
    const ins = await _db.insert(ghlWebhookLogs).values({
      event,
      payload,
      status: "recibido",
    });
    logId = Number((ins[0] as any).insertId);
  } catch (logErr: any) {
    console.error("[GHL Webhook] Error al guardar log:", logErr.message);
  }

  // 3. Siempre responder 200 rápido para evitar reintentos de GHL
  res.status(200).json({ ok: true, event });

  // 4. Procesar de forma asíncrona
  if (!LEAD_EVENTS.has(event)) {
    // Evento informativo — solo registrar
    if (logId) {
      await _db.update(ghlWebhookLogs)
        .set({ status: "procesado" })
        .where(eq(ghlWebhookLogs.id, logId))
        .catch(() => {});
    }
    console.log(`[GHL Webhook] Evento ${event} registrado (no genera lead)`);
    return;
  }

  try {
    // 5. Extraer campos del contacto GHL
    const firstName: string = payload.firstName ?? payload.first_name ?? "";
    const lastName: string  = payload.lastName  ?? payload.last_name  ?? "";
    const name: string = [firstName, lastName].filter(Boolean).join(" ").trim()
      || payload.name
      || payload.fullName
      || "Contacto GHL";

    const email: string = payload.email ?? "";
    const phone: string | undefined = payload.phone ?? payload.phoneNumber ?? undefined;
    const company: string | undefined = payload.companyName ?? payload.company ?? undefined;

    // FormSubmit tiene los datos en payload.formData o payload.fields
    const formData = payload.formData ?? payload.fields ?? {};
    const formMessage: string | undefined =
      formData.message ?? formData.comments ?? formData.nota ?? undefined;

    const contactId: string = payload.id ?? payload.contactId ?? "";
    const message = [
      `Lead recibido desde GHL (${event}).`,
      contactId ? `ContactId GHL: ${contactId}` : "",
      formMessage ?? "",
    ].filter(Boolean).join(" ").trim();

    if (!email && !phone) {
      const warn = "Contacto sin email ni teléfono — lead no creado";
      console.warn(`[GHL Webhook] ${warn}`, { event, contactId });
      if (logId) {
        await _db.update(ghlWebhookLogs)
          .set({ status: "error", errorMessage: warn })
          .where(eq(ghlWebhookLogs.id, logId))
          .catch(() => {});
      }
      return;
    }

    await createLead({
      name,
      email: email || `ghl-${contactId}@noreply.nayade`,
      phone,
      company,
      message,
      source: "ghl_webhook",
    });

    if (logId) {
      await _db.update(ghlWebhookLogs)
        .set({ status: "procesado" })
        .where(eq(ghlWebhookLogs.id, logId))
        .catch(() => {});
    }

    console.log(`[GHL Webhook] Lead creado — event: ${event}, email: ${email || "(sin email)"}, nombre: ${name}`);

  } catch (err: any) {
    console.error(`[GHL Webhook] Error procesando evento ${event}:`, err.message);
    if (logId) {
      await _db.update(ghlWebhookLogs)
        .set({ status: "error", errorMessage: err.message?.slice(0, 500) ?? "Error desconocido" })
        .where(eq(ghlWebhookLogs.id, logId))
        .catch(() => {});
    }
  }
});

export default ghlWebhookRouter;
