/**
 * Revisión del catálogo del 09/11/2026 — Unificación comercial de Elephant Net (decisión definitiva de Jorge del
 * 09/11/2026): siete soluciones completas (Hotel, Ski, Travel, Restaurant, Care, Social Token y Life Net) y ningún módulo
 * Net suelto a la venta.
 *
 *  - Las siete soluciones son las claves de siempre (`*-net-complete`, `life-net`): conservan precio, Prices de Stripe,
 *    licencias e historial. Se llaman sin «Complete», con la línea corta y la descripción de la semilla, sus beneficios y la ficha de
 *    funcionalidades incluidas (`commercial.includedFeatures`, de shared/netProducts.ts), que distingue lo operativo hoy
 *    («available») de lo incluido y pendiente («coming_soon»).
 *  - Hotel Net pasa de «En preparación» a «Implantación acompañada», como las demás soluciones sectoriales: hasta hoy se
 *    vendían sus módulos PMS y Motor de reservas en implantación acompañada, y desde ahora se contrata solo el completo.
 *    Su ficha deja de decir «Todavía no se puede contratar» y su nivel de implantación pasa de 3 (desarrollo nuevo) a 1
 *    (activable desde el Core), como las demás soluciones: PMS, motor de reservas, check-in/out y housekeeping ya están.
 *  - Los 19 módulos sueltos se marcan como HEREDADOS (`catalog.legacy`, con la solución que los incluye): sin estado,
 *    precio, capacidades ni componentes nuevos. Siguen publicados (contratos, facturas, renovaciones, licencias de los
 *    paquetes y «Mis módulos» de quien los tiene), pero el servidor rechaza cualquier contratación nueva y la oferta
 *    efectiva deja de ofrecer su checkout (Social Token Net · Comunidades y · Tokens internos).
 *  - Precios: ninguno cambia (la orden lo comprueba antes y después). Social Token Net completo mantiene sus 59 € y su
 *    venta directa con su Price de Stripe Live ya enlazado; no se crea ningún Price.
 *
 * Garantías (las de las demás revisiones): flujo normal del CRM (guardar borrador → publicar) con autor, versión e
 * historial; cada campo solo cambia desde su valor publicado de partida (el de https://admin.bigelephant.es/cp/v1/public/site
 * del 09/11/2026) o si ya vale el nuevo; nunca publica un borrador ajeno; idempotente; simulación salvo `--apply`.
 */
import { productDraft, type ProductDraft } from "../web/schemas";
import type { WebAdminService } from "../web/service";
import type { WebStore } from "../web/store";
import { NET_PRODUCTS, type NetArea } from "../../shared/netProducts";
import { ASSISTED_ACTIVATION } from "./review20261108connect";
import { ASSISTED_FAQ } from "./review20261108fichas";
import { PRODUCTS } from "./elephantSourceV1";

/** Textos del catálogo oficial (la semilla): son los que la semilla vuelve a escribir, así que la revisión los adopta. */
const seedOf = (key: string) => PRODUCTS.find((p) => p.key === key)?.draft;

export const REVIEW_ID_2026_11_09_NET_UNIFICATION = "revision-catalogo-2026-11-09-net-unificacion";
/** Fecha de retirada de la venta de los módulos Net sueltos. */
export const NET_LEGACY_SINCE = "2026-11-09";

type Commercial = NonNullable<ProductDraft["commercial"]>;
type FieldChange = { from: unknown; to: unknown };

export interface NetUnificationChange {
  key: string;
  evidence: string;
  name?: { from: string; to: string };
  description?: { from: string; to: string };
  tagline?: { from: string; to: string };
  status?: { from: ProductDraft["catalog"]["commercialStatus"]; to: ProductDraft["catalog"]["commercialStatus"] };
  /** Nivel de implantación (1 activable desde el Core · 2 portable · 3 desarrollo nuevo): de partida y nuevo. */
  implementationLevel?: { from: 1 | 2 | 3 | undefined; to: 1 | 2 | 3 };
  /** Marca de heredado (solo se pone si no la tiene). */
  legacy?: { replacedBy: string; since: string };
  /** Campos de la ficha: valor publicado de partida y valor nuevo. */
  fields?: Partial<Record<keyof Commercial, FieldChange>>;
}

const OLD_BENEFITS = ["Todas las funcionalidades de tu sector incluidas, sin extensiones adicionales"];

/** Línea corta publicada de partida (09/11/2026): enumeraba los antiguos submódulos. */
const TAGLINE_FROM: Record<string, string> = {
  "hotel-net-complete": "PMS, Channel Manager, motor de reservas y housekeeping.",
  "ski-net-complete": "Escuela, alquiler, cursillos y profesores.",
  "travel-net-complete": "Agencias, paquetes y circuitos y conectores.",
  "restaurant-net-complete": "Sala y comandas, reservas y mesas y cocina.",
  "care-net-complete": "Agenda, gestión clínica y tratamientos y bonos.",
  "social-token-net-complete": "Comunidades y tokens internos.",
};

/** Descripción publicada de partida de cada solución (09/11/2026). */
const DESCRIPTION_FROM: Record<string, string> = {
  "hotel-net-complete": "La suite completa para hoteles y alojamientos, con descuento frente a los submódulos por separado.",
  "ski-net-complete": "Todo lo que necesita una escuela de esquí y su tienda de alquiler.",
  "travel-net-complete": "La suite para agencias de viajes.",
  "restaurant-net-complete": "La suite completa para restaurantes.",
  "care-net-complete": "La suite para centros de salud, bienestar y estética.",
  "social-token-net-complete": "Comunidad y fidelización en un solo paquete.",
  "life-net": "",
};

const areasOf = (areas: readonly NetArea[]) => areas.map((a) => ({ title: a.title, features: a.features.map((f) => ({ label: f.label, status: f.status })) }));

/** Hotel Net: ficha de contratación (hasta hoy decía «Todavía no se puede contratar»). */
const HOTEL_FIELDS: Partial<Record<keyof Commercial, FieldChange>> = {
  valueProposition: {
    from: "Próximamente como paquete: PMS, motor de reservas, Channel Manager y Housekeeping de tu alojamiento en una sola suite.",
    to: "PMS, motor de reservas para tu web, check-in y check-out y housekeeping de tu alojamiento en una sola solución. Channel Manager: próximamente, incluido sin coste adicional.",
  },
  longDescription: {
    from: "La suite completa para alojamientos: PMS, Channel Manager, motor de reservas y housekeeping.",
    to: "La solución completa para hoteles y alojamientos: PMS con habitaciones, tipologías, tarifas, ocupación, huéspedes y check-in y check-out; motor de reservas para tu web con pago directo; housekeeping con los estados de cada habitación; e informes de ocupación e ingresos. El Channel Manager llegará próximamente, incluido sin coste adicional.",
  },
  terms: { from: { activation: "Todavía no se puede contratar: solo se podrá contratar entero cuando lo estén sus cuatro componentes." }, to: { activation: ASSISTED_ACTIVATION } },
  faq: {
    from: [
      { a: "Hotel Net PMS, Motor de reservas, Channel Manager y Housekeeping.", q: "¿Qué incluirá?" },
      { a: "Todavía no: solo se podrá contratar entero cuando lo estén sus cuatro componentes. El PMS y el Motor de reservas ya se pueden solicitar por separado.", q: "¿Puedo contratarlo ya?" },
      { a: "No. Se pagan aparte a cada canal.", q: "¿Las comisiones de las OTAs estarán incluidas?" },
      { a: "Sí, cuando la ficha muestra el botón «Me interesa»: tu solicitud llega a nuestro equipo.", q: "¿Puedo dejar mi interés?" },
    ],
    to: [
      { q: "¿Qué incluye?", a: "PMS con habitaciones, tarifas, huéspedes y check-in y check-out, motor de reservas para tu web, housekeeping e informes de ocupación e ingresos. El Channel Manager llegará próximamente, incluido sin coste adicional." },
      ASSISTED_FAQ,
      { q: "¿Las comisiones de las OTAs están incluidas?", a: "No. Se pagan aparte a cada canal." },
      { q: "¿Y si ya tengo contratado el PMS o el Motor de reservas?", a: "Los conservas con sus condiciones. Si quieres pasar a Hotel Net completo, pídelo y nuestro equipo hace el cambio sin cobrarte dos veces." },
    ],
  },
};

/** Social Token Net: la primera pregunta comparaba con la compra suelta de sus módulos («sin pagarlos por separado»). */
const STN_FAQ_REST = [
  {
    a: "Al contratar Complete, el módulo que tenías se sustituye por el paquete: conservas tus comunidades, puntos y recompensas, y solo se cobra la diferencia prorrateada del periodo en curso.",
    q: "¿Y si ya tengo uno de los módulos?",
  },
  { a: "No. Son tokens internos sin valor monetario: solo se canjean por las recompensas que defines.", q: "¿Los tokens tienen valor en dinero?" },
];
const STN_FIELDS: Partial<Record<keyof Commercial, FieldChange>> = {
  faq: {
    from: [{ a: "Social Token Net Comunidades y Tokens internos, sin pagarlos por separado.", q: "¿Qué incluye?" }, ...STN_FAQ_REST],
    to: [
      { q: "¿Qué incluye?", a: "Comunidades públicas y privadas con publicaciones, encuestas y moderación, y un programa de puntos internos canjeables por recompensas, en un solo producto." },
      { q: "¿Y si ya tengo uno de los módulos?", a: "Lo conservas con tus condiciones. Si quieres pasar a Social Token Net completo, al contratarlo el módulo se sustituye: conservas tus comunidades, puntos y recompensas, y solo se cobra la diferencia prorrateada del periodo en curso." },
      STN_FAQ_REST[1],
    ],
  },
};

export const NET_UNIFICATION_2026_11_09: readonly NetUnificationChange[] = [
  ...NET_PRODUCTS.map(
    (p): NetUnificationChange => ({
      key: p.key,
      evidence:
        "Unificación comercial de Elephant Net (decisión de Jorge del 09/11/2026): solución completa con sus funcionalidades incluidas (shared/netProducts.ts, estado real de cada una); sus antiguos módulos sueltos quedan heredados. Precio, Prices de Stripe y licencias sin cambios.",
      ...(p.key === "life-net" ? {} : { name: { from: `${p.name} Complete`, to: p.name } }),
      // Nombre, línea corta y descripción: los de la semilla (sin «Complete» ni comparaciones con la compra suelta); Life
      // Net no tiene descripción en la semilla y toma el resumen del producto
      description: { from: DESCRIPTION_FROM[p.key] ?? "", to: seedOf(p.key)?.description || p.summary },
      ...(TAGLINE_FROM[p.key] && seedOf(p.key)?.tagline ? { tagline: { from: TAGLINE_FROM[p.key], to: seedOf(p.key)!.tagline } } : {}),
      // Hotel Net: PMS, motor de reservas, check-in y check-out y housekeeping ya están en el Core (nivel 1, como las demás
      // soluciones); solo el Channel Manager queda pendiente, incluido como «Próximamente»
      ...(p.key === "hotel-net-complete" ? { status: { from: "in_preparation" as const, to: "on_request" as const }, implementationLevel: { from: 3 as const, to: 1 as const } } : {}),
      fields: {
        includedFeatures: { from: undefined, to: areasOf(p.areas) },
        ...(p.key === "life-net" ? {} : { benefits: { from: OLD_BENEFITS, to: p.benefits } }),
        ...(p.key === "hotel-net-complete" ? HOTEL_FIELDS : {}),
        ...(p.key === "social-token-net-complete" ? STN_FIELDS : {}),
      },
    }),
  ),
  ...NET_PRODUCTS.flatMap((p) =>
    p.legacyKeys.map(
      (k): NetUnificationChange => ({
        key: k,
        evidence: `Módulo heredado desde el ${NET_LEGACY_SINCE} (unificación comercial de Elephant Net): forma parte de ${p.name} (${p.key}). Sin contrataciones nuevas; se conservan sus contratos, precios históricos, licencias e historial.`,
        legacy: { replacedBy: p.key, since: NET_LEGACY_SINCE },
      }),
    ),
  ),
];

export interface NetUnificationReport {
  apply: boolean;
  changed: string[];
  already: string[];
  conflicts: string[];
}

/** Igualdad estructural de JSON (orden de claves indiferente; `undefined` ≠ cualquier otro valor). */
function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined || a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) return a.length === (b as unknown[]).length && a.every((x, i) => same(x, (b as unknown[])[i]));
  const ka = Object.keys(a as object).filter((k) => (a as Record<string, unknown>)[k] !== undefined);
  const kb = Object.keys(b as object).filter((k) => (b as Record<string, unknown>)[k] !== undefined);
  return ka.length === kb.length && ka.every((k) => same((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

function isDone(d: ProductDraft, c: NetUnificationChange): boolean {
  if (c.name && d.name !== c.name.to) return false;
  if (c.description && d.description !== c.description.to) return false;
  if (c.tagline && d.tagline !== c.tagline.to) return false;
  if (c.status && d.catalog.commercialStatus !== c.status.to) return false;
  if (c.implementationLevel && d.catalog.implementationLevel !== c.implementationLevel.to) return false;
  if (c.legacy && d.catalog.legacy?.replacedBy !== c.legacy.replacedBy) return false;
  for (const [f, v] of Object.entries(c.fields ?? {})) if (!same((d.commercial as Record<string, unknown> | undefined)?.[f], v!.to)) return false;
  return true;
}

function target(d: ProductDraft, c: NetUnificationChange): ProductDraft {
  const commercial = c.fields ? { ...(d.commercial as Commercial), ...Object.fromEntries(Object.entries(c.fields).map(([f, v]) => [f, v!.to])) } : d.commercial;
  return productDraft.parse({
    ...d,
    ...(c.name ? { name: c.name.to } : {}),
    ...(c.description ? { description: c.description.to } : {}),
    ...(c.tagline ? { tagline: c.tagline.to } : {}),
    catalog: {
      ...d.catalog,
      ...(c.status ? { commercialStatus: c.status.to } : {}),
      ...(c.implementationLevel ? { implementationLevel: c.implementationLevel.to } : {}),
      ...(c.legacy ? { legacy: d.catalog.legacy?.replacedBy === c.legacy.replacedBy ? d.catalog.legacy : c.legacy } : {}),
    },
    ...(commercial ? { commercial } : {}),
    internal: { ...d.internal, evidence: c.evidence },
  });
}

export async function applyNetUnification(svc: WebAdminService, store: WebStore, o: { apply?: boolean; author: string; changes?: readonly NetUnificationChange[] }): Promise<NetUnificationReport> {
  const r: NetUnificationReport = { apply: !!o.apply, changed: [], already: [], conflicts: [] };
  for (const c of o.changes ?? NET_UNIFICATION_2026_11_09) {
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
    // Guardado por esta revisión y sin publicar (ejecución interrumpida): se publica
    if (isDone(d, c) && cur.publication === "published" && !upToDate && cur.updatedBy === o.author) {
      r.changed.push(`${c.key}: se publica lo ya guardado`);
      if (o.apply) await svc.publish("product", c.key, cur.draftVersion, o.author).catch((e) => void r.conflicts.push(`${c.key}: no se pudo publicar (${e instanceof Error ? e.message : String(e)})`));
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
    const problems: string[] = [];
    if (c.name && d.name !== c.name.from && d.name !== c.name.to) problems.push(`nombre «${d.name}» (se esperaba «${c.name.from}»)`);
    if (c.description && d.description !== c.description.from && d.description !== c.description.to) problems.push("la descripción ya no es la de partida");
    if (c.tagline && d.tagline !== c.tagline.from && d.tagline !== c.tagline.to) problems.push("la línea corta ya no es la de partida");
    if (c.status && d.catalog.commercialStatus !== c.status.from && d.catalog.commercialStatus !== c.status.to) problems.push(`estado «${d.catalog.commercialStatus}» (se esperaba «${c.status.from}»)`);
    if (c.implementationLevel && d.catalog.implementationLevel !== c.implementationLevel.from && d.catalog.implementationLevel !== c.implementationLevel.to) problems.push(`nivel de implantación «${d.catalog.implementationLevel}» (se esperaba «${c.implementationLevel.from}»)`);
    if (c.legacy && d.catalog.legacy && d.catalog.legacy.replacedBy !== c.legacy.replacedBy) problems.push(`ya es heredado de «${d.catalog.legacy.replacedBy}»`);
    if (c.fields && !d.commercial) problems.push("no tiene ficha comercial");
    for (const [f, v] of Object.entries(c.fields ?? {})) {
      const now = (d.commercial as Record<string, unknown> | undefined)?.[f];
      if (!same(now, v!.from) && !same(now, v!.to)) problems.push(`el campo «${f}» de la ficha ya no es el de partida`);
    }
    if (problems.length) {
      r.conflicts.push(`${c.key}: ${problems.join("; ")}; se deja como lo decidió el CRM`);
      continue;
    }
    const what = [
      c.name ? `nombre «${c.name.to}»` : null,
      c.status ? `${c.status.from} → ${c.status.to}` : null,
      c.implementationLevel ? `nivel ${c.implementationLevel.from} → ${c.implementationLevel.to}` : null,
      c.legacy ? `heredado (lo incluye ${c.legacy.replacedBy})` : null,
      c.description ? "descripción" : null,
      c.tagline ? "línea corta" : null,
      c.fields ? `ficha (${Object.keys(c.fields).join(", ")})` : null,
    ].filter(Boolean);
    r.changed.push(`${c.key}: ${what.join("; ")}`);
    if (!o.apply) continue;
    try {
      const saved = await svc.save("product", c.key, { draft: target(d, c), expectedVersion: cur.draftVersion }, o.author);
      await svc.publish("product", c.key, saved.draftVersion, o.author);
    } catch (e) {
      r.changed.pop();
      r.conflicts.push(`${c.key}: no se pudo guardar o publicar (${e instanceof Error ? e.message : String(e)}); se revisa en el CRM`);
    }
  }
  return r;
}

/**
 * Huella de lo que NO debe cambiar en ningún producto del catálogo: familia, estados, activación, capacidades,
 * componentes, cupos, oferta configurada y precios (id, estado e importe). La marca de heredado, el estado comercial y el
 * nivel de implantación de Hotel Net y los textos sí cambian (se comparan aparte). Dos huellas iguales = nada más ha cambiado.
 */
export async function catalogGuard(store: WebStore): Promise<Record<string, string>> {
  const [entries, prices] = await Promise.all([store.listEntries({ kind: "product" }), store.listPrices()]);
  const out: Record<string, string> = {};
  for (const e of entries) {
    // Normalizado con el esquema (lo publicado no lleva la parte interna ni los valores por defecto explícitos)
    const raw = (e.published ?? e.draft) as Record<string, unknown>;
    const parsed = productDraft.safeParse(raw);
    const d = (parsed.success ? parsed.data : raw) as Partial<ProductDraft> & { catalog?: Record<string, unknown> };
    const { legacy: _l, commercialStatus, implementationLevel, ...catalog } = (d.catalog ?? {}) as Record<string, unknown>;
    const own = prices.filter((p) => p.entryId === e.id).map((p) => [p.id, p.kind, p.status, p.amountCents, p.currency]);
    out[e.key] = JSON.stringify({ family: e.family, publication: e.publication, technicalStatus: d.technicalStatus, activation: d.activation, commercialStatus: e.key === "hotel-net-complete" ? null : commercialStatus, implementationLevel: e.key === "hotel-net-complete" ? null : implementationLevel, catalog, dependencies: d.dependencies, prices: own });
  }
  return out;
}

/** Productos cuya huella cambió entre dos fotos de `catalogGuard`. */
export function guardDiff(before: Record<string, string>, after: Record<string, string>): string[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return Array.from(keys).filter((k) => before[k] !== after[k]).sort();
}
