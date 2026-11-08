/**
 * Revisión del catálogo del 08/11/2026 — Activación del marketplace, tanda A (encargo de Jorge del 08/11/2026,
 * «terminar, activar y vender»): las extensiones de Elephant Connect que ya funcionan de punta a punta sin
 * configuración del equipo ni credenciales externas pasan de «Implantación acompañada» a «Disponible» con
 * contratación inmediata desde el panel (mismo circuito que Elephant People).
 *
 *  - Elephant Partners (`supplier-settlements`): proveedores, colaboradores, liquidaciones con PDF y portales.
 *  - Elephant Deals (`deals-coupons`): formulario público de canje, revisión, reserva y conciliación de cupones.
 *
 * Criterio de «Disponible» (encargo, sección 4): ficha correcta, precio aprobado, Product y Price de Stripe Live,
 * compra en línea, licencia automática al confirmarse el pago, menú desbloqueado, uso sin asistencia y aislamiento por
 * empresa. Por eso la revisión NO abre la venta mientras el precio mensual aprobado no tenga su Price de Stripe
 * enlazado y activo (`stripe_prices`, modo indicado): sin él, el panel mostraría «Contratar ahora» y la compra fallaría.
 * Hasta entonces el producto sigue «Implantación acompañada» y el informe dice exactamente qué Price falta crear
 * (lo crea una persona con el procedimiento de server/stripe/catalog.ts: plan → crear → `POST /catalog/sync`).
 *
 * Mismas garantías que las demás revisiones (server/catalog/review.ts): flujo normal del CRM con autor, versión e
 * historial; idempotente; solo cambia lo que sigue en su estado y con sus textos de partida; nunca publica un borrador
 * ajeno; no toca precios, contratos, suscripciones, licencias de empresas ni Stripe; por defecto, simulación.
 */
import { productDraft, type ProductDraft } from "../web/schemas";
import type { WebAdminService } from "../web/service";
import type { WebStore } from "../web/store";
import { lookupKeyFor } from "../stripe/catalog";

export const REVIEW_ID_2026_11_08_CONNECT = "revision-catalogo-2026-11-08-connect";

type Step = { title: string; text: string };

export interface DirectSaleChange {
  key: string;
  evidence: string;
  /** Condición de activación pública: de la implantación acompañada a la activación automática. */
  activation: { from: string; to: string };
  /** Primer paso de «Cómo funciona»: de la solicitud a la contratación. */
  firstStep: { from: Step; to: Step };
}

const ASSISTED_ACTIVATION = "Implantación acompañada: la solicitas desde el panel y nuestro equipo la activa y la pone en marcha contigo.";
const AUTOMATIC_ACTIVATION = "Activación automática: en cuanto se confirma el pago, las funcionalidades contratadas se añaden al administrador de tu empresa.";
const REQUEST_STEP: Step = { title: "Solicitud", text: "La solicitas desde el panel y nuestro equipo prepara la implantación contigo." };
const PURCHASE_STEP: Step = { title: "Contratación", text: "La contratas desde el panel de tu empresa y se activa automáticamente al confirmarse el pago." };

export const DIRECT_SALE_2026_11_08: readonly DirectSaleChange[] = [
  {
    key: "connect-partners",
    evidence:
      "Tanda A del 08/11/2026: proveedores, colaboradores, liquidaciones por periodo con PDF y portales en la BD de cada empresa (routers suppliers, settlements, supplierPortal y partners); la licencia supplier-settlements protege rutas y menú; sin credenciales externas ni configuración del equipo. Contratación inmediata con Price de Stripe Live enlazado.",
    activation: { from: ASSISTED_ACTIVATION, to: AUTOMATIC_ACTIVATION },
    firstStep: { from: REQUEST_STEP, to: PURCHASE_STEP },
  },
  {
    key: "connect-deals",
    evidence:
      "Tanda A del 08/11/2026: formulario público de canje, revisión, conversión en reserva y conciliación por plataforma en la BD de cada empresa (router ticketing); la licencia deals-coupons protege rutas y menú; las plataformas las da de alta la propia empresa; canje manual sin API de terceros. Contratación inmediata con Price de Stripe Live enlazado.",
    activation: { from: ASSISTED_ACTIVATION, to: AUTOMATIC_ACTIVATION },
    firstStep: { from: REQUEST_STEP, to: PURCHASE_STEP },
  },
];

export interface DirectSaleReport {
  apply: boolean;
  changed: string[];
  already: string[];
  /** Falta el Price de Stripe: lo que hay que crear (una persona) antes de abrir la venta. */
  stripePending: Array<{ key: string; webPriceId: number; lookupKey: string; amountCents: number; interval: "month" }>;
  conflicts: string[];
}

const sameStep = (a: Step | undefined, b: Step) => !!a && a.title === b.title && a.text === b.text;

/** ¿El borrador ya está en venta directa tal como lo deja esta revisión? */
function isDone(d: ProductDraft, c: DirectSaleChange): boolean {
  const o = d.catalog.offer;
  return (
    d.catalog.commercialStatus === "available" &&
    d.technicalStatus === "available" &&
    o?.modality === "immediate" &&
    o.checkout === true &&
    d.commercial?.terms?.activation === c.activation.to &&
    sameStep(d.commercial?.howItWorks?.[0], c.firstStep.to)
  );
}

/**
 * Abre la venta directa de los productos indicados cuando su precio mensual aprobado ya tiene Price de Stripe enlazado.
 * `stripeLinked(webPriceId)` dice si ese precio tiene enlace ACTIVO en el modo de Stripe del entorno.
 */
export async function applyDirectSaleReview(
  svc: WebAdminService,
  store: WebStore,
  stripeLinked: (webPriceId: number) => Promise<boolean>,
  o: { apply?: boolean; author: string; changes?: readonly DirectSaleChange[] },
): Promise<DirectSaleReport> {
  const r: DirectSaleReport = { apply: !!o.apply, changed: [], already: [], stripePending: [], conflicts: [] };
  for (const c of o.changes ?? DIRECT_SALE_2026_11_08) {
    const cur = await store.getEntry("product", c.key);
    if (!cur) {
      r.conflicts.push(`${c.key}: no existe en el catálogo`);
      continue;
    }
    const d = productDraft.parse(cur.draft);
    const upToDate = cur.publication === "published" && cur.publishedVersion === cur.draftVersion;
    if (isDone(d, c) && upToDate) {
      r.already.push(c.key);
      continue;
    }
    if (cur.publication !== "published") {
      r.conflicts.push(`${c.key}: no está publicado (${cur.publication}); se decide en el CRM`);
      continue;
    }
    if (!upToDate) {
      r.conflicts.push(`${c.key}: tiene cambios sin publicar en el CRM; no se publica un borrador ajeno`);
      continue;
    }
    if (d.catalog.commercialStatus !== "on_request") {
      r.conflicts.push(`${c.key}: está en «${d.catalog.commercialStatus}» (se esperaba «on_request»); se deja como lo decidió el CRM`);
      continue;
    }
    if (d.technicalStatus === "planned") {
      r.conflicts.push(`${c.key}: estado técnico «planned»; se deja como lo decidió el CRM`);
      continue;
    }
    const activation = d.commercial?.terms?.activation;
    if (activation !== c.activation.from && activation !== c.activation.to) {
      r.conflicts.push(`${c.key}: la condición de activación ya no es la de partida («${(activation ?? "").slice(0, 60)}»); se revisa en el CRM`);
      continue;
    }
    const step = d.commercial?.howItWorks?.[0];
    if (!sameStep(step, c.firstStep.from) && !sameStep(step, c.firstStep.to)) {
      r.conflicts.push(`${c.key}: el primer paso de «Cómo funciona» ya no es el de partida; se revisa en el CRM`);
      continue;
    }
    // El precio de la venta: exactamente un mensual aprobado en EUR sin IVA (el mismo que lee la compra en línea)
    const monthly = (await store.listPrices(cur.id)).filter((p) => p.kind === "monthly" && p.status === "approved" && p.currency.toUpperCase() === "EUR");
    if (monthly.length !== 1 || monthly[0].taxIncluded) {
      r.conflicts.push(`${c.key}: necesita exactamente un precio mensual aprobado en EUR sin IVA (hay ${monthly.length})`);
      continue;
    }
    const price = monthly[0];
    if (!(await stripeLinked(price.id))) {
      r.stripePending.push({ key: c.key, webPriceId: price.id, lookupKey: lookupKeyFor(c.key, "monthly", "EUR", price.id), amountCents: price.amountCents, interval: "month" });
      continue;
    }
    r.changed.push(`${c.key}: on_request → available (contratación inmediata, ${price.amountCents} céntimos al mes sin IVA)`);
    if (!o.apply) continue;
    const m = d.commercial!;
    const steps = [c.firstStep.to, ...(m.howItWorks ?? []).slice(1)];
    const draft: ProductDraft = {
      ...d,
      technicalStatus: "available",
      catalog: { ...d.catalog, commercialStatus: "available", offer: { ...(d.catalog.offer ?? {}), modality: "immediate", trial: false, checkout: true, cta: "checkout" } },
      commercial: { ...m, terms: { ...(m.terms ?? {}), activation: c.activation.to }, howItWorks: steps },
      internal: { ...d.internal, evidence: c.evidence, functionalGrade: "in_use" },
    };
    const saved = await svc.save("product", c.key, { draft, expectedVersion: cur.draftVersion }, o.author);
    await svc.publish("product", c.key, saved.draftVersion, o.author);
  }
  return r;
}
