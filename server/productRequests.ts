/**
 * Solicitudes de información desde la web pública (E-6).
 *
 * Es la ÚNICA vía de «contratación» de un producto «bajo petición» o «próximamente»: no hay carrito, ni pago, ni pedido.
 * Cada solicitud entra en el CRM de la empresa como oportunidad, con el producto como origen.
 *
 * Protecciones (mismas ideas que los formularios seguros de E-7): misma web de origen (CSRF, en el router), límite por
 * visitante, campo trampa y tiempo mínimo de relleno, consentimiento RGPD obligatorio guardado tal como lo vio la
 * persona, textos sin etiquetas, y un envío repetido no crea otra oportunidad. Nada se comparte entre empresas: las claves
 * de límite y de exclusión incluyen la empresa y todo va a su BD.
 */
import { and, eq, gte } from "drizzle-orm";
import { experiences, leads } from "../drizzle/schema";
import { getDb, createLead } from "./db";
import { cleanText, offerModeOf } from "../shared/offerMode";
import { formConsentText, FORM_MIN_FILL_MS, allowFormSubmit } from "./_core/studioForms";
import { keyedLock } from "./_core/studioFormsSubmit";

export const PRODUCT_REQUEST_DEDUPE_MS = 10 * 60 * 1000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_RE = /^[+0-9 ().-]{6,25}$/;

export class ProductRequestError extends Error {
  constructor(readonly code: "NOT_FOUND" | "BAD_REQUEST" | "TOO_MANY_REQUESTS", message: string, readonly fields?: Record<string, string>) {
    super(message);
  }
}

export interface ProductRequestInput {
  experienceId: number;
  name: string;
  email: string;
  phone?: string;
  message?: string;
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
  now?: () => number;
  /** Aviso al propietario (nunca lanza ni retrasa la respuesta) */
  notifyOwner?: (n: { leadId: number; duplicate: boolean; formTitle: string; page: string; name: string; email: string; phone?: string; message: string }) => Promise<void>;
}

export type ProductRequestResult = {
  ok: true;
  leadId: number | null;
  duplicate: boolean;
  message: string;
};

const cleanPath = (v: unknown) => (typeof v === "string" && /^\/[^\s<>"']{0,199}$/.test(v) ? v : "");

export async function processProductRequest(input: ProductRequestInput, ctx: ProductRequestContext): Promise<ProductRequestResult> {
  const now = (ctx.now ?? Date.now)();
  const name = cleanText(input.name, 200);
  const email = cleanText(input.email, 320).toLowerCase();
  const phone = cleanText(input.phone ?? "", 40);
  const message = cleanText(input.message ?? "", 2000, true);
  const errors: Record<string, string> = {};
  if (name.length < 2) errors.name = "Escribe tu nombre.";
  if (!EMAIL_RE.test(email)) errors.email = "Escribe un correo electrónico válido.";
  if (phone && !PHONE_RE.test(phone)) errors.phone = "Escribe un teléfono válido.";
  if (input.consent !== true) errors.consent = "Marca la casilla de privacidad para continuar.";
  const firstError = Object.values(errors)[0];
  if (firstError) throw new ProductRequestError("BAD_REQUEST", firstError, errors);

  // Envío automático: se responde como si hubiera ido bien, sin guardar nada
  if ((input.website ?? "").trim() !== "" || (typeof input.elapsedMs === "number" && input.elapsedMs < FORM_MIN_FILL_MS)) {
    return { ok: true, leadId: null, duplicate: false, message: "Hemos recibido tu solicitud." };
  }
  if (!allowFormSubmit(`${ctx.tenantId}:solicitud:${ctx.ip || "desconocida"}`, now)) {
    throw new ProductRequestError("TOO_MANY_REQUESTS", "Has enviado varias solicitudes seguidas. Espera unos minutos e inténtalo de nuevo.");
  }

  const d = await getDb();
  if (!d) throw new Error("Base de datos no disponible");
  const [product] = await d.select({ id: experiences.id, title: experiences.title, isPublished: experiences.isPublished, offerMode: experiences.offerMode }).from(experiences).where(eq(experiences.id, input.experienceId)).limit(1);
  if (!product || !product.isPublished) throw new ProductRequestError("NOT_FOUND", "Este producto ya no está disponible.");

  const consent = formConsentText({ consentText: "" });
  const page = cleanPath(input.page);
  const mode = offerModeOf(product);
  const header = `Solicitud de información sobre «${product.title}» (${mode === "coming_soon" ? "próximamente" : mode === "on_request" ? "bajo petición" : "precio fijo"}).`;
  const body = [header, message && `Mensaje: ${message}`, page && `Origen: ${page}`, `Consentimiento RGPD: aceptado el ${new Date(now).toISOString()} · texto v${consent.version}: «${consent.text}»`].filter(Boolean).join("\n");

  return keyedLock(`${ctx.tenantId}:solicitud:${email}:${product.id}`, async () => {
    // Repetido: la misma persona y el mismo producto hace un momento → se anota en la oportunidad, no se duplica
    const [prevLead] = await d.select({ id: leads.id }).from(leads).where(and(eq(leads.email, email), eq(leads.experienceId, product.id), gte(leads.createdAt, new Date(now - PRODUCT_REQUEST_DEDUPE_MS)))).limit(1);
    if (prevLead) {
      await addNote(prevLead.id, `Nueva solicitud de la misma persona (${new Date(now).toISOString()}):\n${body}`);
      return { ok: true as const, leadId: prevLead.id, duplicate: true, message: "Ya teníamos tu solicitud. Te escribiremos pronto." };
    }
    const lead = await createLead({
      name,
      email,
      phone: phone || undefined,
      message: body.slice(0, 8000),
      experienceId: product.id,
      selectedProduct: product.title.slice(0, 256),
      source: "web_solicitud_producto",
      leadSourceCode: "HOME_FORM",
    });
    if (ctx.notifyOwner) {
      void ctx.notifyOwner({ leadId: lead.id, duplicate: false, formTitle: `Solicitud de información: ${product.title}`, page: page || "/tienda", name, email, phone: phone || undefined, message: body }).catch(() => {});
    }
    return { ok: true as const, leadId: lead.id, duplicate: false, message: "Hemos recibido tu solicitud. Te responderemos lo antes posible." };
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

/** Dependencias reales (empresa en curso): aviso al propietario por el correo de la empresa. */
export async function defaultRequestContext(ip: string): Promise<ProductRequestContext> {
  const { peekTenantContext } = await import("./_core/tenant");
  const { notifyOwner } = await import("./_core/studioFormsRuntime");
  return { ip, tenantId: peekTenantContext()?.tenantId ?? "single", notifyOwner };
}
