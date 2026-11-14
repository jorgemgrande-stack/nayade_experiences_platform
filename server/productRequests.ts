/**
 * Solicitudes de información y de plaza desde la web pública (E-6 y E-4).
 *
 * Es la ÚNICA vía de «contratación» de un producto «bajo petición» o «próximamente» y de una convocatoria: no hay carrito,
 * ni pago, ni pedido. Cada solicitud entra en el CRM de la empresa como oportunidad (con el producto y, si la hay, la
 * edición) y, si pide plaza, como inscripción «solicitada» (o «en lista de espera»). El administrador la confirma a mano
 * en el panel; solo entonces cuenta como plaza ocupada.
 *
 * Protecciones (mismas ideas que los formularios seguros de E-7): misma web de origen (CSRF, en el router), límite por
 * visitante, campo trampa y tiempo mínimo de relleno, consentimiento RGPD obligatorio guardado tal como lo vio la
 * persona, huella de la IP (nunca la dirección), textos sin etiquetas, y un envío repetido no crea otra solicitud.
 * Nada se comparte entre empresas: las claves de límite y de exclusión incluyen la empresa y todo va a su BD.
 */
import { and, eq, gte } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { clients, experiences, leads } from "../drizzle/schema";
import { getDb, createLead } from "./db";
import { canRequestSeat, EDITION_LIMITS, formatEditionDates, type EnrollmentStatus } from "../shared/editions";
import { cleanText, offerModeOf } from "../shared/offerMode";
import { formConsentText, FORM_MIN_FILL_MS, FORM_RATE } from "./_core/studioForms";
import { ipFingerprint, keyedLock } from "./_core/studioFormsSubmit";
import { getRequestableEdition } from "./editionsDb";

export const PRODUCT_REQUEST_DEDUPE_MS = 10 * 60 * 1000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_RE = /^[+0-9 ().-]{6,25}$/;

/** Límite por visitante (empresa + IP): los mismos números que los formularios de Studio; estado propio para no mezclarlos. */
const hits = new Map<string, number[]>();
function allowRequest(key: string, now: number): boolean {
  const recent = (hits.get(key) ?? []).filter((t) => now - t < FORM_RATE.windowMs);
  if (recent.length >= FORM_RATE.max) {
    hits.set(key, recent);
    return false;
  }
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 5000) hits.delete(hits.keys().next().value as string);
  return true;
}
/** Solo para pruebas: vacía el límite por visitante. */
export function resetProductRequestLimits(): void {
  hits.clear();
}

export class ProductRequestError extends Error {
  constructor(readonly code: "NOT_FOUND" | "BAD_REQUEST" | "TOO_MANY_REQUESTS", message: string, readonly fields?: Record<string, string>) {
    super(message);
  }
}

export interface ProductRequestInput {
  experienceId: number;
  editionId?: number;
  name: string;
  email: string;
  phone?: string;
  message?: string;
  /** Plazas que pide (solo con edición) */
  seats?: number;
  consent: boolean;
  /** Campo trampa: las personas no lo ven */
  website?: string;
  elapsedMs?: number;
  /** Página de origen (ruta, sin dominio) */
  page?: string;
}

export interface ProductRequestContext {
  ip: string;
  tenantId: string;
  ipSecret: string;
  now?: () => number;
  /** Aviso al propietario (nunca lanza ni retrasa la respuesta) */
  notifyOwner?: (n: { leadId: number; duplicate: boolean; formTitle: string; page: string; name: string; email: string; phone?: string; message: string }) => Promise<void>;
}

export type ProductRequestResult = {
  ok: true;
  kind: "info" | "enrollment";
  leadId: number | null;
  enrollmentStatus: EnrollmentStatus | null;
  duplicate: boolean;
  message: string;
};

const cleanPath = (v: unknown) => (typeof v === "string" && /^\/[^\s<>"']{0,199}$/.test(v) ? v : "");

export async function processProductRequest(input: ProductRequestInput, ctx: ProductRequestContext): Promise<ProductRequestResult> {
  const now = (ctx.now ?? Date.now)();
  const name = cleanText(input.name, EDITION_LIMITS.name);
  const email = cleanText(input.email, 320).toLowerCase();
  const phone = cleanText(input.phone ?? "", EDITION_LIMITS.phone);
  const message = cleanText(input.message ?? "", 2000, true);
  const seats = Math.trunc(input.seats ?? 1);
  const errors: Record<string, string> = {};
  if (name.length < 2) errors.name = "Escribe tu nombre.";
  if (!EMAIL_RE.test(email)) errors.email = "Escribe un correo electrónico válido.";
  if (phone && !PHONE_RE.test(phone)) errors.phone = "Escribe un teléfono válido.";
  if (!Number.isInteger(seats) || seats < 1 || seats > EDITION_LIMITS.seats) errors.seats = `Las plazas deben estar entre 1 y ${EDITION_LIMITS.seats}.`;
  if (input.consent !== true) errors.consent = "Marca la casilla de privacidad para continuar.";
  const firstError = Object.values(errors)[0];
  if (firstError) throw new ProductRequestError("BAD_REQUEST", firstError, errors);

  // Envío automático: se responde como si hubiera ido bien, sin guardar nada
  if ((input.website ?? "").trim() !== "" || (typeof input.elapsedMs === "number" && input.elapsedMs < FORM_MIN_FILL_MS)) {
    return { ok: true, kind: input.editionId ? "enrollment" : "info", leadId: null, enrollmentStatus: null, duplicate: false, message: "Hemos recibido tu solicitud." };
  }
  if (!allowRequest(`${ctx.tenantId}:solicitud:${ctx.ip || "desconocida"}`, now)) {
    throw new ProductRequestError("TOO_MANY_REQUESTS", "Has enviado varias solicitudes seguidas. Espera unos minutos e inténtalo de nuevo.");
  }

  const d = await getDb();
  if (!d) throw new Error("Base de datos no disponible");
  const [product] = await d.select({ id: experiences.id, title: experiences.title, isPublished: experiences.isPublished, offerMode: experiences.offerMode }).from(experiences).where(eq(experiences.id, input.experienceId)).limit(1);
  if (!product || !product.isPublished) throw new ProductRequestError("NOT_FOUND", "Este producto ya no está disponible.");

  let edition: Awaited<ReturnType<typeof getRequestableEdition>> = null;
  if (input.editionId) {
    edition = await getRequestableEdition(input.editionId, product.id, now);
    if (!edition || !edition.state) throw new ProductRequestError("NOT_FOUND", "Esta convocatoria ya no está disponible.");
    if (!canRequestSeat(edition.state)) throw new ProductRequestError("BAD_REQUEST", "Esta convocatoria ya no admite solicitudes de plaza.");
  }

  const consent = formConsentText({ consentText: "" });
  const page = cleanPath(input.page);
  const dates = edition ? formatEditionDates(edition.edition.startsAt, edition.edition.endsAt, edition.edition.timezone) : "";
  const header = edition
    ? `Solicitud de plaza en «${product.title}» · ${edition.edition.label} (${dates})${edition.initialStatus === "lista_espera" ? " — para lista de espera" : ""}. Plazas: ${seats}.`
    : `Solicitud de información sobre «${product.title}» (${offerModeOf(product) === "coming_soon" ? "próximamente" : offerModeOf(product) === "on_request" ? "bajo petición" : "precio fijo"}).`;
  const body = [header, message && `Mensaje: ${message}`, page && `Origen: ${page}`, `Consentimiento RGPD: aceptado el ${new Date(now).toISOString()} · texto v${consent.version}: «${consent.text}»`].filter(Boolean).join("\n");

  return keyedLock(`${ctx.tenantId}:solicitud:${email}:${product.id}:${edition?.edition.id ?? 0}`, async () => {
    // Repetido: la misma persona y la misma convocatoria (o el mismo producto hace un momento) → se anota, no se duplica
    if (edition) {
      const [prev] = (await d.execute(sql`SELECT id, status, lead_id FROM edition_enrollments WHERE edition_id = ${edition.edition.id} AND email = ${email} AND status <> 'cancelada' ORDER BY id DESC LIMIT 1`)) as unknown as [Array<{ id: number; status: EnrollmentStatus; lead_id: number | null }>];
      if (prev?.[0]) {
        const p = prev[0];
        if (p.lead_id) await addNote(Number(p.lead_id), `Nueva solicitud de la misma persona para esta convocatoria (${new Date(now).toISOString()}):\n${body}`);
        return { ok: true as const, kind: "enrollment" as const, leadId: p.lead_id ? Number(p.lead_id) : null, enrollmentStatus: p.status, duplicate: true, message: "Ya teníamos tu solicitud para esta convocatoria. Te escribiremos pronto." };
      }
    } else {
      const [prevLead] = await d.select({ id: leads.id }).from(leads).where(and(eq(leads.email, email), eq(leads.experienceId, product.id), gte(leads.createdAt, new Date(now - PRODUCT_REQUEST_DEDUPE_MS)))).limit(1);
      if (prevLead) {
        await addNote(prevLead.id, `Nueva solicitud de la misma persona (${new Date(now).toISOString()}):\n${body}`);
        return { ok: true as const, kind: "info" as const, leadId: prevLead.id, enrollmentStatus: null, duplicate: true, message: "Ya teníamos tu solicitud. Te escribiremos pronto." };
      }
    }

    const lead = await createLead({
      name,
      email,
      phone: phone || undefined,
      message: body.slice(0, 8000),
      experienceId: product.id,
      selectedProduct: product.title.slice(0, 256),
      numberOfPersons: edition ? seats : undefined,
      preferredDate: edition ? new Date(edition.edition.startsAt).toISOString() : undefined,
      source: edition ? "web_solicitud_plaza" : "web_solicitud_producto",
      leadSourceCode: "HOME_FORM",
    });
    let status: EnrollmentStatus | null = null;
    if (edition) {
      status = edition.initialStatus;
      const [client] = await d.select({ id: clients.id }).from(clients).where(eq(clients.email, email)).limit(1);
      await d.execute(sql`INSERT INTO edition_enrollments
        (edition_id, client_id, lead_id, name, email, phone, seats, status, notes, consent_given, consent_text, consent_version, consent_at, ip_hash, page, created_at, updated_at)
        VALUES (${edition.edition.id}, ${client?.id ?? null}, ${lead.id}, ${name}, ${email}, ${phone || null}, ${seats}, ${status}, ${message ? message.slice(0, 2000) : null}, 1, ${consent.text}, ${consent.version}, ${now},
          ${ipFingerprint(ctx.ip, ctx.tenantId, ctx.ipSecret)}, ${page || null}, ${now}, ${now})`);
    }
    if (ctx.notifyOwner) {
      void ctx.notifyOwner({ leadId: lead.id, duplicate: false, formTitle: edition ? `Solicitud de plaza: ${product.title}` : `Solicitud de información: ${product.title}`, page: page || `/tienda`, name, email, phone: phone || undefined, message: body }).catch(() => {});
    }
    return {
      ok: true as const,
      kind: edition ? ("enrollment" as const) : ("info" as const),
      leadId: lead.id,
      enrollmentStatus: status,
      duplicate: false,
      message: status === "lista_espera"
        ? "Te hemos apuntado en la lista de espera. Si se libera una plaza, te escribiremos."
        : edition
        ? "Hemos recibido tu solicitud de plaza. Te escribiremos para confirmártela."
        : "Hemos recibido tu solicitud. Te responderemos lo antes posible.",
    };
  });
}

async function addNote(leadId: number, text: string) {
  const d = await getDb();
  if (!d) return;
  const [lead] = await d.select({ notes: leads.internalNotes }).from(leads).where(eq(leads.id, leadId)).limit(1);
  if (!lead) return;
  const notes = Array.isArray(lead.notes) ? lead.notes : [];
  await d.update(leads).set({ internalNotes: [...notes, { text: text.slice(0, 8000), authorId: 0, authorName: "Solicitud web", createdAt: new Date().toISOString() }] }).where(eq(leads.id, leadId));
}

/** Dependencias reales (empresa en curso): huella de IP y aviso al propietario por el correo de la empresa. */
export async function defaultRequestContext(ip: string): Promise<ProductRequestContext> {
  const { peekTenantContext } = await import("./_core/tenant");
  const { ENV } = await import("./_core/env");
  const { notifyOwner } = await import("./_core/studioFormsRuntime");
  return { ip, tenantId: peekTenantContext()?.tenantId ?? "single", ipSecret: ENV.cookieSecret, notifyOwner };
}
