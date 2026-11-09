/**
 * Contratación desde «Suscripción» (alta desde la prueba): modelo puro de la selección, separado de la presentación.
 *
 *  - Ampliaciones: las mismas condiciones que /admin/ampliar. El estado de cada producto es el del catálogo del
 *    marketplace (connect.catalog, calculado en el servidor) y solo se puede marcar lo que el servidor admite en el alta
 *    (`checkoutVia: "conversion"`) y encaja con el plan elegido (conversionPlanFor, la misma regla que el presupuesto).
 *    Lo bajo solicitud, lo próximo, lo contratado y lo que pide otro plan se explican, nunca se ofrecen como compra.
 *  - Datos de facturación: las mismas reglas que el perfil fiscal del plano de control (server/stripe/buyerProfile.ts);
 *    el servidor vuelve a validarlo todo.
 *  - Borrador: plan, periodicidad, ampliaciones y datos de facturación para volver sin perder nada (ir a una ficha,
 *    abandonar el pago y volver). Nunca guarda importes ni consentimientos: el importe se pide siempre al servidor y
 *    las condiciones se aceptan de nuevo.
 */
import { conversionPlanFor, type CheckoutVia, type CommercialStatus, type ConnectState } from "./connectMarketplace";

export type CheckoutPlan = "essential" | "business";
export type CheckoutInterval = "month" | "year";
export const CHECKOUT_PLANS: readonly CheckoutPlan[] = ["essential", "business"];
const PLAN_NAMES: Record<string, string> = { essential: "Essential", business: "Business", enterprise: "Enterprise" };

// ── Ampliaciones ───────────────────────────────────────────────────────────────

export type ExtensionGroupId = "available" | "on_request" | "coming_soon" | "contracted" | "not_included";

export const EXTENSION_GROUPS: ReadonlyArray<{ id: ExtensionGroupId; title: string; intro: string }> = [
  { id: "available", title: "Disponibles", intro: "Se contratan ahora junto con tu plan, en el mismo pago." },
  { id: "on_request", title: "Bajo solicitud", intro: "Las activa nuestro equipo contigo: consulta la ficha o envíanos una solicitud." },
  { id: "coming_soon", title: "Próximamente", intro: "Todavía no se pueden contratar. Puedes ver su ficha." },
  { id: "not_included", title: "No incluidas en el alta", intro: "Requieren otro plan u otro producto, o se contratan después desde su ficha." },
  { id: "contracted", title: "Ya activas en tu cuenta", intro: "Las tienes activas (por tu prueba o por una contratación anterior): no se añaden aquí. Su ficha explica con qué plan siguen." },
];

/** Lo que el modelo necesita de un producto del marketplace (ConnectCatalogItem). */
export interface CheckoutCatalogItem {
  key: string;
  name: string;
  kind: "module" | "quantity";
  state: ConnectState;
  commercialStatus: CommercialStatus;
  plans: string[];
  dependencies: ReadonlyArray<string | { key: string }>;
  prices: ReadonlyArray<unknown>;
  reasons: string[];
  checkoutVia?: CheckoutVia;
  /**
   * Antiguo módulo suelto sustituido por un producto completo (unificación de Elephant Net, campo aditivo de
   * connect.catalog `{ replacedBy, since }`). Nunca se ofrece: si la empresa lo tiene, se muestra como contratado.
   */
  legacy?: { replacedBy?: string | null; since?: string | number | null } | null;
}

export interface CheckoutExtension<T extends CheckoutCatalogItem = CheckoutCatalogItem> {
  item: T;
  group: ExtensionGroupId;
  /** Se puede marcar en el alta con el plan elegido. */
  selectable: boolean;
  /** Plan con el que sí se podría añadir (si no es el elegido). */
  needsPlan: CheckoutPlan | null;
  /** Explicación breve (por qué no se puede marcar, qué lo habilita…). */
  note: string | null;
}

const CONTRACTED: readonly ConnectState[] = ["active", "pending_setup", "activating", "incident"];

/** Clasifica el catálogo para el paso «Plan y ampliaciones». Las ampliaciones por unidades no entran en el alta. */
export function checkoutExtensions<T extends CheckoutCatalogItem>(items: readonly T[], plan: CheckoutPlan): CheckoutExtension<T>[] {
  const out: CheckoutExtension<T>[] = [];
  for (const item of items) {
    if (item.kind !== "module") continue;
    if (CONTRACTED.includes(item.state)) {
      const note = item.legacy ? "Contratación anterior: conservas el acceso y tus condiciones." : (item.reasons[0] ?? null);
      out.push({ item, group: "contracted", selectable: false, needsPlan: null, note });
      continue;
    }
    // Módulo suelto retirado (se vende el producto completo): si no se tiene, no se muestra
    if (item.legacy) continue;
    if (item.state === "on_request") {
      out.push({ item, group: "on_request", selectable: false, needsPlan: null, note: item.reasons[0] ?? null });
      continue;
    }
    if (item.state === "coming_soon") {
      out.push({ item, group: "coming_soon", selectable: false, needsPlan: null, note: item.reasons[0] ?? null });
      continue;
    }
    // A la venta o «no disponible para tu plan»: solo se marca si el servidor lo admite en el alta y con este plan
    if (item.checkoutVia === "conversion") {
      const fits = (p: CheckoutPlan) => conversionPlanFor(item, { currentPlan: p, selfServicePlans: [p] }) === p;
      if (fits(plan)) {
        out.push({ item, group: "available", selectable: true, needsPlan: null, note: null });
        continue;
      }
      const other = CHECKOUT_PLANS.find((p) => p !== plan && fits(p)) ?? null;
      out.push({
        item,
        group: "not_included",
        selectable: false,
        needsPlan: other,
        note: other ? `Se contrata con el plan ${PLAN_NAMES[other]}.` : (item.reasons[0] ?? "No se puede añadir con este plan."),
      });
      continue;
    }
    if (item.state === "available") {
      // A la venta, pero no entra en el alta (sin precio aprobado, requisitos…): no se presenta como «Disponible» aquí
      out.push({ item, group: "not_included", selectable: false, needsPlan: null, note: item.reasons[0] ?? "No se añade al alta: consulta su ficha para contratarlo después." });
      continue;
    }
    out.push({ item, group: "not_included", selectable: false, needsPlan: null, note: item.reasons[0] ?? null });
  }
  return out;
}

/** Ampliaciones marcadas que siguen siendo válidas con el plan elegido (al cambiar de plan no se envía lo que no cabe). */
export function validSelection(selected: readonly string[], extensions: readonly CheckoutExtension[]): string[] {
  const ok = new Set(extensions.filter((e) => e.selectable).map((e) => e.item.key));
  return selected.filter((k) => ok.has(k));
}

// ── Datos de facturación ───────────────────────────────────────────────────────

export interface BuyerDraft {
  legalName: string;
  taxId: string;
  line1: string;
  postalCode: string;
  city: string;
  country: string;
}
export type BuyerField = keyof BuyerDraft;
export const EMPTY_BUYER: BuyerDraft = { legalName: "", taxId: "", line1: "", postalCode: "", city: "", country: "ES" };

const TAX_ID = /^[A-Za-z0-9][A-Za-z0-9 .\-/]*$/;

/** Mismas reglas que buyerProfileInput (empresa o profesional) y los campos que el alta ya exigía. */
export function validateBuyer(b: BuyerDraft): Partial<Record<BuyerField, string>> {
  const e: Partial<Record<BuyerField, string>> = {};
  const legal = b.legalName.trim();
  if (legal.length < 2) e.legalName = "Escribe la razón social o el nombre fiscal (al menos 2 caracteres).";
  else if (legal.length > 160) e.legalName = "Máximo 160 caracteres.";
  const tax = b.taxId.trim();
  if (!tax) e.taxId = "Escribe el NIF, CIF o identificador fiscal.";
  else if (tax.length < 4 || tax.length > 40) e.taxId = "El identificador fiscal debe tener entre 4 y 40 caracteres.";
  else if (!TAX_ID.test(tax)) e.taxId = "Solo letras, números, espacios, puntos, guiones o barras.";
  const line1 = b.line1.trim();
  if (line1.length < 3) e.line1 = "Escribe la dirección fiscal (al menos 3 caracteres).";
  else if (line1.length > 200) e.line1 = "Máximo 200 caracteres.";
  const cp = b.postalCode.trim();
  if (!cp) e.postalCode = "Escribe el código postal.";
  else if (cp.length > 12) e.postalCode = "Máximo 12 caracteres.";
  const city = b.city.trim();
  if (!city) e.city = "Escribe la ciudad.";
  else if (city.length > 120) e.city = "Máximo 120 caracteres.";
  if (!/^[A-Za-z]{2}$/.test(b.country.trim())) e.country = "Elige el país.";
  return e;
}

/** Perfil que se envía al servidor (empresa o profesional), normalizado. */
export function buyerPayload(b: BuyerDraft) {
  return {
    type: "business" as const,
    legalName: b.legalName.trim(),
    taxId: b.taxId.trim(),
    country: b.country.trim().toUpperCase(),
    postalCode: b.postalCode.trim(),
    line1: b.line1.trim(),
    city: b.city.trim(),
  };
}

// ── Pasos ──────────────────────────────────────────────────────────────────────

export type CheckoutStep = 1 | 2 | 3;
export const CHECKOUT_STEPS: ReadonlyArray<{ step: CheckoutStep; title: string; short: string }> = [
  { step: 1, title: "Plan y ampliaciones", short: "Plan" },
  { step: 2, title: "Datos de facturación", short: "Facturación" },
  { step: 3, title: "Revisión y confirmación", short: "Confirmación" },
];

/** Paso más avanzado al que se puede ir: la facturación exige un importe válido; la revisión, además, datos completos. */
export function maxReachableStep(o: { quoteOk: boolean; buyerValid: boolean }): CheckoutStep {
  if (!o.quoteOk) return 1;
  return o.buyerValid ? 3 : 2;
}

// ── Borrador (volver sin perder nada) ──────────────────────────────────────────

export interface CheckoutDraft {
  plan: CheckoutPlan;
  interval: CheckoutInterval;
  add: string[];
  buyer: BuyerDraft;
  step: CheckoutStep;
  /** Clave de idempotencia de esta selección: repetir el envío (también tras recargar) abre el mismo pago. */
  key: string | null;
  /** Firma de la selección (plan, periodicidad, ampliaciones, datos fiscales y condiciones) a la que corresponde `key`. */
  keyFor: string | null;
  /** Caducidad del enlace de pago abierto con `key` (null: aún no se abrió). Caducado, la clave no se reutiliza. */
  payExpiresAt: number | null;
  savedAt: number;
}

/** Un borrador caduca a las 24 h (el enlace de pago de Stripe caduca antes). */
export const DRAFT_TTL_MS = 24 * 3_600_000;
const MODULE_KEY = /^[a-z0-9][a-z0-9-]{1,63}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");

/**
 * Firma de lo que se envía: plan, periodicidad y ampliaciones y, si se dan, los datos fiscales y la versión de las
 * condiciones. Cualquier cambio en lo enviado lleva otra clave de idempotencia (nunca la misma clave con otro cuerpo).
 */
export const selectionSignature = (s: { plan: string; interval: string; add: readonly string[]; buyer?: BuyerDraft; terms?: string | null }) =>
  [s.plan, s.interval, [...s.add].sort().join(","), s.buyer ? JSON.stringify(buyerPayload(s.buyer)) : "", s.terms ?? ""].join("|");

/** Clave del borrador que se puede reutilizar: misma firma y sin un enlace de pago ya caducado. */
export function reusableKey(d: Pick<CheckoutDraft, "key" | "keyFor" | "payExpiresAt"> | null, signature: string, now: number): string | null {
  if (!d?.key || d.keyFor !== signature) return null;
  if (d.payExpiresAt !== null && d.payExpiresAt <= now) return null;
  return d.key;
}

/** Lectura prudente del borrador guardado: lo que no se reconoce se descarta; caducado o ajeno, null. */
export function parseDraft(raw: string | null, now: number): CheckoutDraft | null {
  if (!raw) return null;
  let o: Record<string, unknown>;
  try {
    o = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!o || typeof o !== "object") return null;
  const savedAt = typeof o.savedAt === "number" ? o.savedAt : 0;
  if (!(now - savedAt >= 0 && now - savedAt < DRAFT_TTL_MS)) return null;
  const plan = (CHECKOUT_PLANS as readonly string[]).includes(String(o.plan)) ? (o.plan as CheckoutPlan) : null;
  if (!plan) return null;
  const interval: CheckoutInterval = o.interval === "year" ? "year" : "month";
  const add = Array.isArray(o.add) ? Array.from(new Set(o.add.filter((k): k is string => typeof k === "string" && MODULE_KEY.test(k)))).slice(0, 20) : [];
  const b = (o.buyer ?? {}) as Record<string, unknown>;
  const buyer: BuyerDraft = {
    legalName: str(b.legalName, 160),
    taxId: str(b.taxId, 40),
    line1: str(b.line1, 200),
    postalCode: str(b.postalCode, 12),
    city: str(b.city, 120),
    country: /^[A-Za-z]{2}$/.test(str(b.country, 2)) ? str(b.country, 2).toUpperCase() : "ES",
  };
  const step: CheckoutStep = o.step === 2 || o.step === 3 ? o.step : 1;
  const key = typeof o.key === "string" && UUID.test(o.key) ? o.key : null;
  const keyFor = key && typeof o.keyFor === "string" ? o.keyFor.slice(0, 2000) : null;
  const payExpiresAt = key && typeof o.payExpiresAt === "number" && Number.isFinite(o.payExpiresAt) ? o.payExpiresAt : null;
  return { plan, interval, add, buyer, step, key, keyFor, payExpiresAt, savedAt };
}

/**
 * Clave en el almacenamiento de la SESIÓN del navegador (sessionStorage: la pestaña; no deja datos fiscales en el equipo
 * al cerrarla), por persona; el navegador ya separa cada empresa por su dirección.
 */
export const draftStorageKey = (userId: number | string | null | undefined) => `es-suscripcion-alta:u${userId ?? "0"}`;
