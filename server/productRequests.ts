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
import { getDb, createLead, getVariantsByExperience } from "./db";
import { canRequestSeat, EDITION_LIMITS, formatEditionDates, type EnrollmentStatus } from "../shared/editions";
import { cleanText, isPubliclyRequestable, offerModeOf, showsPrice } from "../shared/offerMode";
import { sendsExternalNotices } from "../shared/testMode";
import { formConsentText, FORM_MIN_FILL_MS, FORM_RATE } from "./_core/studioForms";
import { consentSentence, fillUiText, siteUiText } from "../shared/siteUiText";
import { ipFingerprint, keyedLock } from "./_core/studioFormsSubmit";
import { getRequestableEdition } from "./editionsDb";
import { writeEnrollmentVariant, writeLeadRequestExtras } from "./leadWebRequestDb";
import { normalizeCurrency } from "../shared/leadWebRequest";
import { formatIsoDayShort, plannedEndDay, requestedStartProblem, todayIso } from "../shared/requestDates";
import { productPeopleProblem, variantQuantityProblem } from "./shopCheckoutRules";
import { resolveSupplements, supplementLineText, SupplementError } from "./supplements";
import { supplementScopes } from "./orderSupplements";

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
  /** Opción/modalidad elegida en la ficha (se valida contra las variantes vigentes del producto) */
  variantId?: number;
  /**
   * Suplementos opcionales MARCADOS (ids de variante-suplemento). Sin ids no hay suplemento. Solo se anotan en la solicitud
   * (importe calculado aquí, por participantes y tramo): no hay cobro ni se suman al precio del programa.
   */
  supplementIds?: number[];
  /** Idioma de la web que veía la persona (código corto, p. ej. «de») */
  lang?: string;
  /** Fecha de inicio deseada (YYYY-MM-DD) en un producto sin convocatoria: es una petición, no una reserva */
  startDate?: string;
}

const eur = (n: number) => `${n.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

export interface ProductRequestContext {
  ip: string;
  tenantId: string;
  ipSecret: string;
  now?: () => number;
  /** Modo de pruebas (solo lo fija un procedimiento de administrador, nunca el cuerpo público): sin avisos ni integraciones externas */
  testMode?: boolean;
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
  // Idioma de la web que veía la persona: los mensajes que le llegan salen en ese idioma (lo del CRM, en español)
  const lang = /^[a-z]{2}(-[A-Za-z]{2})?$/.test(input.lang ?? "") ? input.lang!.toLowerCase().slice(0, 2) : "";
  const t = siteUiText(lang);
  const errors: Record<string, string> = {};
  if (name.length < 2) errors.name = t.nameRequired;
  if (!EMAIL_RE.test(email)) errors.email = t.invalidEmail;
  if (phone && !PHONE_RE.test(phone)) errors.phone = t.invalidPhone;
  if (!Number.isInteger(seats) || seats < 1 || seats > EDITION_LIMITS.seats) errors.seats = fillUiText(t.seatsRange, { n: EDITION_LIMITS.seats });
  if (input.consent !== true) errors.consent = t.privacyBoxRequired;
  const firstError = Object.values(errors)[0];
  if (firstError) throw new ProductRequestError("BAD_REQUEST", firstError, errors);

  // Envío automático: se responde como si hubiera ido bien, sin guardar nada
  if ((input.website ?? "").trim() !== "" || (typeof input.elapsedMs === "number" && input.elapsedMs < FORM_MIN_FILL_MS)) {
    return { ok: true, kind: input.editionId ? "enrollment" : "info", leadId: null, enrollmentStatus: null, duplicate: false, message: t.requestReceivedShort };
  }
  if (!allowRequest(`${ctx.tenantId}:solicitud:${ctx.ip || "desconocida"}`, now)) {
    throw new ProductRequestError("TOO_MANY_REQUESTS", t.tooManyRequests);
  }

  const d = await getDb();
  if (!d) throw new Error("Base de datos no disponible");
  const [product] = await d.select({ id: experiences.id, title: experiences.title, isPublished: experiences.isPublished, isActive: experiences.isActive, offerMode: experiences.offerMode, basePrice: experiences.basePrice, currency: experiences.currency, minPersons: experiences.minPersons, maxPersons: experiences.maxPersons, durationDays: experiences.durationDays, requestDatesFrom: experiences.requestDatesFrom, requestDatesUntil: experiences.requestDatesUntil }).from(experiences).where(eq(experiences.id, input.experienceId)).limit(1);
  if (!isPubliclyRequestable(product)) throw new ProductRequestError("NOT_FOUND", t.productGone);

  let edition: Awaited<ReturnType<typeof getRequestableEdition>> = null;
  if (input.editionId) {
    edition = await getRequestableEdition(input.editionId, product.id, now);
    if (!edition || !edition.state) throw new ProductRequestError("NOT_FOUND", t.editionGone);
    if (!canRequestSeat(edition.state)) throw new ProductRequestError("BAD_REQUEST", t.editionNoRequests);
  }

  // Fecha de inicio deseada (solo sin convocatoria): dentro del periodo que la empresa fijó para el producto. Nunca se deduce
  // la duración ni el fin de un texto; si la duración consta como dato, el fin es solo «previsto». No implica disponibilidad.
  let startDay: string | null = null;
  let endDay: string | null = null;
  if (input.startDate !== undefined && input.startDate !== "") {
    if (edition) throw new ProductRequestError("BAD_REQUEST", t.requestDateNotEnabled, { startDate: t.requestDateNotEnabled });
    const rules = { from: product.requestDatesFrom ?? null, until: product.requestDatesUntil ?? null, durationDays: product.durationDays ?? null };
    const problem = requestedStartProblem(input.startDate, rules, now);
    if (problem) {
      const tomorrow = formatIsoDayShort(plannedEndDay(todayIso(now), 2) as string);
      const msg =
        problem === "invalid" ? t.requestDateInvalid
        : problem === "past" ? t.requestDatePast
        : problem === "not_enabled" ? t.requestDateNotEnabled
        : fillUiText(t.requestDateOutside, { from: rules.from ? formatIsoDayShort(rules.from) : tomorrow, until: rules.until ? formatIsoDayShort(rules.until) : "—" });
      throw new ProductRequestError("BAD_REQUEST", msg, { startDate: msg });
    }
    startDay = input.startDate.trim();
    endDay = plannedEndDay(startDay, rules.durationDays);
  }
  // El texto tal como lo vio la persona (en español es el de siempre, con la misma versión)
  const consent = formConsentText({ consentText: consentSentence(t) });
  const page = cleanPath(input.page);
  const dates = edition ? formatEditionDates(edition.edition.startsAt, edition.edition.endsAt, edition.edition.timezone) : "";
  const header = edition
    ? `Solicitud de plaza en «${product.title}» · ${edition.edition.label} (${dates})${edition.initialStatus === "lista_espera" ? " — para lista de espera" : ""}. Plazas: ${seats}.`
    : `Solicitud de información sobre «${product.title}» (${offerModeOf(product) === "coming_soon" ? "próximamente" : offerModeOf(product) === "on_request" ? "bajo petición" : offerModeOf(product) === "priced_request" ? "precio visible, solo por solicitud" : "precio fijo"}).`;
  // Lo que la persona vio: precio publicado y modalidad elegida (los importes salen siempre de la BD, no del navegador)
  const baseNum = Number(product.basePrice ?? 0);
  const suppIds = Array.from(new Set((input.supplementIds ?? []).filter((n) => Number.isInteger(n) && n > 0))).slice(0, 5);
  const variantRows = ((showsPrice(product) || startDay) && input.variantId) || suppIds.length ? await getVariantsByExperience(product.id, { includeSupplements: true }) : [];
  // Un suplemento nunca es la modalidad del programa
  const chosen = variantRows.find((v) => v.id === input.variantId && !v.supplementGroup);
  let suppLines: ReturnType<typeof resolveSupplements> = [];
  if (suppIds.length) {
    const noSupp = "Los suplementos opcionales no están disponibles para este producto.";
    if (!showsPrice(product)) throw new ProductRequestError("BAD_REQUEST", noSupp, { supplements: noSupp });
    try {
      const scopes = await supplementScopes(variantRows.filter((v) => !!v.supplementGroup).map((v) => v.id));
      suppLines = resolveSupplements(suppIds, variantRows as any, seats, { programmeVariantId: input.variantId ?? null, scopes });
    } catch (e) {
      if (e instanceof SupplementError) throw new ProductRequestError("BAD_REQUEST", e.message, { supplements: e.message });
      throw e;
    }
  }
  if (startDay) {
    // Con fecha pedida se valida también la opción y el número de participantes (los mismos límites que el pago online)
    if (input.variantId && !chosen) throw new ProductRequestError("BAD_REQUEST", t.productGone);
    const qty = variantQuantityProblem(chosen as any, seats) ?? productPeopleProblem(product as any, seats);
    if (qty) throw new ProductRequestError("BAD_REQUEST", qty, { seats: qty });
  }
  const chosenPrice = chosen ? (chosen.priceType === "percentage" ? baseNum * (1 + Number(chosen.priceModifier ?? 0) / 100) : Number(chosen.priceModifier ?? 0)) : 0;
  const priceLine = chosen && showsPrice(product)
    ? `Modalidad elegida: ${chosen.name} · precio publicado: ${eur(chosenPrice)}`
    : showsPrice(product) && baseNum > 0 ? `Precio publicado (producto): ${eur(baseNum)}` : "";
  const suppLine = suppLines.length
    ? `Suplementos opcionales elegidos (NO incluidos en el precio del programa; sin cobro hasta que la empresa lo confirme) · Participantes: ${seats} · ${suppLines.map(supplementLineText).join(" · ")}`
    : "";
  const dateLine = startDay
    ? `Fecha de inicio deseada: ${formatIsoDayShort(startDay)}${endDay ? ` · fin previsto: ${formatIsoDayShort(endDay)} (según la duración del producto: ${product.durationDays} días)` : ""} · Participantes: ${seats}${chosen ? ` · Opción: ${chosen.name}` : ""}. Es una petición: NO es una reserva ni garantiza disponibilidad; la empresa debe aceptarla o proponer otras fechas antes de cualquier pago.`
    : "";
  const body = [header, dateLine, priceLine, suppLine, lang && `Idioma de la web: ${lang}`, message && `Mensaje: ${message}`, page && `Origen: ${page}`, `Consentimiento RGPD: aceptado el ${new Date(now).toISOString()} · texto v${consent.version}: «${consent.text}»`].filter(Boolean).join("\n");

  return keyedLock(`${ctx.tenantId}:solicitud:${email}:${product.id}:${edition?.edition.id ?? 0}`, async () => {
    // Repetido: la misma persona y la misma convocatoria (o el mismo producto hace un momento) → se anota, no se duplica
    if (edition) {
      const [prev] = (await d.execute(sql`SELECT id, status, lead_id FROM edition_enrollments WHERE edition_id = ${edition.edition.id} AND email = ${email} AND status <> 'cancelada' ORDER BY id DESC LIMIT 1`)) as unknown as [Array<{ id: number; status: EnrollmentStatus; lead_id: number | null }>];
      if (prev?.[0]) {
        const p = prev[0];
        if (p.lead_id) await addNote(Number(p.lead_id), `Nueva solicitud de la misma persona para esta convocatoria (${new Date(now).toISOString()}):\n${body}`);
        return { ok: true as const, kind: "enrollment" as const, leadId: p.lead_id ? Number(p.lead_id) : null, enrollmentStatus: p.status, duplicate: true, message: t.duplicateEdition };
      }
    } else {
      const [prevLead] = await d.select({ id: leads.id }).from(leads).where(and(eq(leads.email, email), eq(leads.experienceId, product.id), gte(leads.createdAt, new Date(now - PRODUCT_REQUEST_DEDUPE_MS)))).limit(1);
      if (prevLead) {
        await addNote(prevLead.id, `Nueva solicitud de la misma persona (${new Date(now).toISOString()}):\n${body}`);
        return { ok: true as const, kind: "info" as const, leadId: prevLead.id, enrollmentStatus: null, duplicate: true, message: t.duplicateRequest };
      }
    }

    const shownPrice = chosen ? chosenPrice.toFixed(2) : showsPrice(product) && baseNum > 0 ? baseNum.toFixed(2) : undefined;

    const lead = await createLead({
      name,
      email,
      phone: phone || undefined,
      message: body.slice(0, 8000),
      experienceId: product.id,
      selectedProduct: product.title.slice(0, 256),
      numberOfPersons: edition || startDay || suppLines.length ? seats : undefined,
      preferredDate: edition ? new Date(edition.edition.startsAt).toISOString() : startDay ? `${startDay}T00:00:00.000Z` : undefined,
      source: edition ? "web_solicitud_plaza" : "web_solicitud_producto",
      leadSourceCode: "HOME_FORM",
      requestLang: lang || undefined,
      variantId: chosen?.id,
      variantLabel: chosen?.name.slice(0, 128),
      shownPrice: shownPrice,
      isTest: ctx.testMode === true,
    });
    let status: EnrollmentStatus | null = null;
    if (edition) {
      status = edition.initialStatus;
      const [client] = await d.select({ id: clients.id }).from(clients).where(eq(clients.email, email)).limit(1);
      const [ins] = (await d.execute(sql`INSERT INTO edition_enrollments
        (edition_id, client_id, lead_id, name, email, phone, seats, status, notes, consent_given, consent_text, consent_version, consent_at, ip_hash, page, created_at, updated_at)
        VALUES (${edition.edition.id}, ${client?.id ?? null}, ${lead.id}, ${name}, ${email}, ${phone || null}, ${seats}, ${status}, ${message ? message.slice(0, 2000) : null}, 1, ${consent.text}, ${consent.version}, ${now},
          ${ipFingerprint(ctx.ip, ctx.tenantId, ctx.ipSecret)}, ${page || null}, ${now}, ${now})`)) as unknown as [{ insertId?: number }];
      // 0076: la modalidad elegida también en la inscripción
      await writeEnrollmentVariant(d, Number(ins?.insertId ?? 0), chosen?.id ?? null).catch(() => false);
    }
    // 0076: convocatoria y moneda del precio MOSTRADO (solo si se mostró un precio), después de la inscripción: un fallo
    // aquí nunca deja una solicitud a medias (el dato consta también en el texto de la solicitud)
    await writeLeadRequestExtras(d, lead.id, { editionId: edition?.edition.id ?? null, currency: shownPrice ? normalizeCurrency(product.currency) : null }).catch(() => false);
    if (ctx.notifyOwner && sendsExternalNotices(ctx)) {
      void ctx.notifyOwner({ leadId: lead.id, duplicate: false, formTitle: edition ? `Solicitud de plaza: ${product.title}` : `Solicitud de información: ${product.title}`, page: page || `/tienda`, name, email, phone: phone || undefined, message: body }).catch(() => {});
    }
    return {
      ok: true as const,
      kind: edition ? ("enrollment" as const) : ("info" as const),
      leadId: lead.id,
      enrollmentStatus: status,
      duplicate: false,
      message: status === "lista_espera"
        ? t.waitlisted
        : edition
        ? t.seatRequestReceived
        : startDay
        ? fillUiText(t.requestDatePending, { date: formatIsoDayShort(startDay), n: seats })
        : t.requestReceived,
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
