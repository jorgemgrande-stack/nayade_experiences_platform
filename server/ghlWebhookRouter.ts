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

// Eventos que generan un lead en la plataforma (incluye variantes de GHL)
const LEAD_EVENTS = new Set([
  // CamelCase (API nativa GHL)
  "ContactCreate",
  "FormSubmit",
  "OpportunityCreate",
  // snake_case (webhooks de workflows GHL)
  "contact_created",
  "contact_create",
  "form_submit",
  "form_submitted",
  "opportunity_created",
  "opportunity_create",
  // otros alias habituales
  "NEW_CONTACT",
  "new_contact",
  "CONTACT_CREATED",
]);

const ghlWebhookRouter = express.Router();

ghlWebhookRouter.post("/api/ghl/webhook", express.json({ limit: "1mb" }), async (req, res) => {
  // 1. Validación de secreto opcional
  // IMPORTANTE: usar GHL_LEAD_WEBHOOK_SECRET (NO GHL_WEBHOOK_SECRET) para no
  // colisionar con el secreto del inbox webhook. El workflow de GHL llama a este
  // endpoint sin secreto — el check solo se activa si se configura esta variable.
  const secret = process.env.GHL_LEAD_WEBHOOK_SECRET || "";
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

  // GHL puede enviar el tipo de evento en distintas claves según el origen
  const event: string =
    payload.type ??
    payload.event ??
    payload.eventType ??
    payload.event_type ??
    payload.triggerName ??
    payload.trigger_name ??
    "unknown";

  // Si el evento es desconocido pero el payload tiene datos de contacto,
  // tratarlo como contact_created para no perder leads del workflow
  const hasContactData = !!(
    payload.email ||
    payload.phone ||
    payload.phoneNumber ||
    payload.firstName ||
    payload.first_name ||
    payload.fullName ||
    payload.name ||
    (payload.contact && (payload.contact.email || payload.contact.phone))
  );
  const effectiveEvent = event !== "unknown" ? event : hasContactData ? "contact_created" : "unknown";

  console.log(`[GHL Webhook] Evento recibido: ${event} → efectivo: ${effectiveEvent}`, {
    contactId: payload.id ?? payload.contactId ?? payload.contact?.id,
    email: payload.email ?? payload.contact?.email,
    locationId: payload.locationId,
    hasContactData,
  });

  // 2. Registrar en ghl_webhook_logs
  let logId: number | null = null;
  try {
    const ins = await _db.insert(ghlWebhookLogs).values({
      event: effectiveEvent,
      payload,
      status: "recibido",
    });
    logId = Number((ins[0] as any).insertId);
  } catch (logErr: any) {
    console.error("[GHL Webhook] Error al guardar log:", logErr.message);
  }

  // 3. Siempre responder 200 rápido para evitar reintentos de GHL
  res.status(200).json({ ok: true, event: effectiveEvent });

  // 4. Procesar de forma asíncrona
  if (!LEAD_EVENTS.has(effectiveEvent)) {
    // Evento informativo — solo registrar
    if (logId) {
      await _db.update(ghlWebhookLogs)
        .set({ status: "procesado" })
        .where(eq(ghlWebhookLogs.id, logId))
        .catch(() => {});
    }
    console.log(`[GHL Webhook] Evento ${effectiveEvent} registrado (no genera lead)`);
    return;
  }

  try {
    // 5. Extraer campos del contacto GHL
    // GHL puede anidar los datos en payload.contact o enviarlos en la raíz
    const c = payload.contact ?? payload;

    const firstName: string = c.firstName ?? c.first_name ?? payload.firstName ?? payload.first_name ?? "";
    const lastName: string  = c.lastName  ?? c.last_name  ?? payload.lastName  ?? payload.last_name  ?? "";
    const name: string = [firstName, lastName].filter(Boolean).join(" ").trim()
      || c.name
      || c.fullName
      || payload.name
      || payload.fullName
      || "Contacto GHL";

    const email: string = c.email ?? payload.email ?? "";
    const phone: string | undefined = c.phone ?? c.phoneNumber ?? payload.phone ?? payload.phoneNumber ?? undefined;
    const company: string | undefined = c.companyName ?? c.company ?? payload.companyName ?? payload.company ?? undefined;

    // FormSubmit tiene los datos en payload.formData o payload.fields
    const formData = payload.formData ?? payload.fields ?? {};
    const formMessage: string | undefined =
      formData.message ?? formData.comments ?? formData.nota ?? undefined;

    const contactId: string = c.id ?? payload.id ?? payload.contactId ?? payload.contact_id ?? "";

    // Campos personalizados de GHL — llegan como claves de nivel raíz con el nombre de display
    const experienciaInteres: string | undefined =
      payload["Experiencia de interés"] ||
      payload["experiencia_de_inters"] ||
      c["Experiencia de interés"] ||
      c["experiencia_de_inters"] ||
      undefined;

    const message = [
      `Lead recibido desde GHL (${effectiveEvent}).`,
      contactId ? `ContactId GHL: ${contactId}` : "",
      experienciaInteres ? `Experiencia de interés: ${experienciaInteres}` : "",
      formMessage ?? "",
    ].filter(Boolean).join(" ").trim();

    if (!email && !phone) {
      const warn = "Contacto sin email ni teléfono — lead no creado";
      console.warn(`[GHL Webhook] ${warn}`, { event: effectiveEvent, contactId });
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
      selectedProduct: experienciaInteres || undefined,
      ghlContactId: contactId || undefined,
    });

    if (logId) {
      await _db.update(ghlWebhookLogs)
        .set({ status: "procesado" })
        .where(eq(ghlWebhookLogs.id, logId))
        .catch(() => {});
    }

    console.log(`[GHL Webhook] Lead creado — event: ${effectiveEvent}, email: ${email || "(sin email)"}, nombre: ${name}`);

  } catch (err: any) {
    console.error(`[GHL Webhook] Error procesando evento ${effectiveEvent}:`, err.message);
    if (logId) {
      await _db.update(ghlWebhookLogs)
        .set({ status: "error", errorMessage: err.message?.slice(0, 500) ?? "Error desconocido" })
        .where(eq(ghlWebhookLogs.id, logId))
        .catch(() => {});
    }
  }
});

export default ghlWebhookRouter;
