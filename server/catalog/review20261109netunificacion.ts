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
 * 10/11/2026 — dos ampliaciones:
 *  - CORE Y NET SE CONTRATAN POR SEPARADO (decisión definitiva de Jorge del 10/11/2026): ninguna solución Elephant Net
 *    incluye Elephant Core Essential (Essential 29 € + Hotel Net 119 € = 148 €/mes antes de impuestos). La regla
 *    `catalog.coreIncluded` (propuesta el 27/10/2026, que nunca llegó a publicarse ni a cobrarse) se RETIRA de las siete
 *    soluciones, y la orden lista cualquier texto publicado o en borrador que anuncie Core incluido (`anunciaCore`).
 *  - BORRADOR AJENO: un producto con cambios sin publicar en el CRM ya no queda como conflicto. La revisión se aplica
 *    sobre lo PUBLICADO y el borrador se conserva (server/catalog/overDraft.ts): sus cambios siguen pendientes, sin
 *    publicarse. Solo en Hotel Net se publican también los cambios del borrador (decisión de Jorge del 10/11/2026:
 *    «autorizo integrar la unificación en el borrador de la versión 10, conservando los cambios existentes, y publicar
 *    después de las verificaciones»), salvo los que tocan el modelo del catálogo (capacidades, componentes, oferta…),
 *    que siguen retenidos. Si el borrador y la unificación cambian un mismo campo con valores distintos, manda la
 *    unificación solo cuando el texto del borrador dice «próximamente» o compara con los módulos sueltos; si no, el
 *    campo queda EN DISPUTA y no se guarda ni se publica nada de ese producto hasta que haya una decisión escrita
 *    (`NET_UNIFICATION_DECISIONS`).
 *
 * Garantías (las de las demás revisiones): flujo normal del CRM (guardar borrador → publicar) con autor, versión e
 * historial; cada campo solo cambia desde su valor publicado de partida (el de https://admin.bigelephant.es/cp/v1/public/site
 * del 09/11/2026) o si ya vale el nuevo; los cambios de un borrador ajeno no se publican (salvo los autorizados de Hotel Net, ver arriba); idempotente; simulación salvo `--apply`.
 */
import { productDraft, type ProductDraft } from "../web/schemas";
import type { WebAdminService } from "../web/service";
import type { WebStore } from "../web/store";
import { NET_PRODUCTS, type NetArea } from "../../shared/netProducts";
import { ASSISTED_ACTIVATION } from "./review20261108connect";
import { ASSISTED_FAQ } from "./review20261108fichas";
import { PRODUCTS } from "./elephantSourceV1";
import { NET_CORE_RE } from "./commercial/checks";
import { reviewOverDraft, sameJson, type OverDraftDecision, type OverDraftPolicy, type OverDraftReport } from "./overDraft";

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
  /** Solución: se retira `catalog.coreIncluded` (Core y Net se contratan por separado, 10/11/2026). */
  dropCoreIncluded?: boolean;
  /** Solución: sus textos públicos dejan de decir «Próximamente» (scrubComingSoon). */
  scrubText?: boolean;
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

/**
 * La web pública no usa la palabra «Próximamente» (09/11/2026): lo pendiente se nombra «en implantación» y el estado real
 * va en `includedFeatures[].status`. Idempotente: un texto ya limpio no cambia.
 */
export function scrubComingSoon(t: string): string {
  return t
    // Sin el flag `u` (no lo admite el target de tsconfig): letras latinas, también acentuadas y la ñ (À-Ö, Ø-ö, ø-ÿ)
    .replace(/Próximamente: ([A-Za-zÀ-ÖØ-öø-ÿ])/g, (_m, c: string) => c.toUpperCase())
    .replace(/llegarán próximamente/g, "están en implantación")
    .replace(/llegará próximamente/g, "está en implantación")
    .replace(/se abrirá próximamente/g, "se abrirá en breve")
    .replace(/ \(próximamente\)/g, " (en preparación)")
    .replace(/: próximamente,/g, ": en implantación,")
    .replace(/próximamente/gi, "en implantación");
}
export const hasComingSoonWord =(v: unknown) => /próximamente/i.test(JSON.stringify(v ?? null));
/** Aplica `scrubComingSoon` a todas las cadenas de un valor JSON. */
export const scrubDeep = <T,>(v: T): T => (typeof v === "string" ? (scrubComingSoon(v) as T) : Array.isArray(v) ? (v.map(scrubDeep) as T) : v && typeof v === "object" ? (Object.fromEntries(Object.entries(v).map(([k, x]) => [k, scrubDeep(x)])) as T) : v);
/** Campos de texto de una solución que no pueden decir «Próximamente» (los publica la web). */
export const TEXT_FIELDS =["headline", "valueProposition", "longDescription", "problem", "benefits", "excludes", "faq", "terms", "seo", "howItWorks"] as const;

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
      description: { from: DESCRIPTION_FROM[p.key] ?? "", to: scrubComingSoon(seedOf(p.key)?.description || p.summary) },
      ...(TAGLINE_FROM[p.key] && seedOf(p.key)?.tagline ? { tagline: { from: TAGLINE_FROM[p.key], to: scrubComingSoon(seedOf(p.key)!.tagline) } } : {}),
      scrubText: true,
      dropCoreIncluded: true,
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
  /** Productos con borrador ajeno: diff campo a campo (publicado → lo que se publica), lo retenido, lo retirado y lo que está en disputa. */
  borradores: OverDraftReport[];
  /** Textos de las soluciones (publicados o en borrador) que anuncian Elephant Core incluido: deben quedar en cero. */
  anunciaCore: string[];
}

const same = sameJson;

/** Decisiones de Jorge sobre campos en disputa (vacío: se rellena cuando vea la simulación de production, si hay alguno). */
export const NET_UNIFICATION_DECISIONS: readonly OverDraftDecision[] = [];
/** Autorización expresa para publicar también los cambios de un borrador ajeno: vale solo para ESA versión del borrador sobre ESA versión publicada. */
export interface ForeignDraftAuthorization {
  key: string;
  borradorVersion: number;
  versionPublicada: number;
  nota: string;
}
/** Hotel Net: borrador v10 sobre la v8 publicada (leídos del CRM de production el 10/11/2026). Cualquier otro borrador queda retenido. */
export const PUBLISH_FOREIGN_DRAFT: readonly ForeignDraftAuthorization[] = [
  { key: "hotel-net-complete", borradorVersion: 10, versionPublicada: 8, nota: "Jorge, 10/11/2026: «autorizo integrar la unificación en el borrador de la versión 10, conservando los cambios existentes, y publicar después de las verificaciones»" },
];

/** Elephant Core incluido en una solución Net, afirmado en texto (la regla de las fichas más «Essential incluido»). */
const CORE_INCLUDED_TEXT = new RegExp(`${NET_CORE_RE.source}|essential (va |viene |está )?incluid[oa]|incluye (el plan )?essential|incluid[oa] (elephant )?core|core gratis`, "gi");
/** Una negación justo antes («no incluye Elephant Core», «sin Core incluido») no anuncia nada: es el modelo vigente. Tampoco una pregunta. */
const NEGATED_RE = /(^|[^a-záéíóúñ])(no|ni|sin|tampoco|nunca)( (se|lo|la|está|va|viene))?\s*$/i;
function announcesCore(v: string): boolean {
  CORE_INCLUDED_TEXT.lastIndex = 0;
  for (let m = CORE_INCLUDED_TEXT.exec(v); m; m = CORE_INCLUDED_TEXT.exec(v)) {
    // Una pregunta («¿Incluye Elephant Core?») tampoco afirma nada: lo que cuenta es la respuesta
    const isQuestion = /^[^.!?]*\?/.test(v.slice(m.index));
    if (!isQuestion && !NEGATED_RE.test(v.slice(0, m.index))) return true;
  }
  return false;
}
/** Comparaciones con la compra suelta de los antiguos módulos («por separado» a secas no: Core y Net se contratan por separado). */
const LOOSE_MODULES_RE = /descuento|submódulos|sueltos|(módulos|extensiones|comprarlos|contratarlos|pagarlos) por separado/i;
const text = (v: unknown) => JSON.stringify(v ?? null);

/** Textos públicos de un producto (todo lo que se publica salvo el modelo del catálogo; nunca la parte interna) que anuncian Core incluido. */
export function coreIncludedTexts(d: Record<string, unknown> | null | undefined): string[] {
  const out: string[] = [];
  const walk = (v: unknown, path: string): void => {
    if (typeof v === "string") {
      if (announcesCore(v)) out.push(`${path}: «${v}»`);
    } else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`));
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, path ? `${path}.${k}` : k);
  };
  if (d) for (const [k, v] of Object.entries(d)) if (k !== "catalog" && k !== "internal") walk(v, k);
  return out;
}

/** Campos del modelo del catálogo: los cambios de un borrador ajeno en ellos nunca los publica esta revisión (los de `catalogGuard`, más la facturación). */
function outOfScope(path: string): boolean {
  if (path === "catalog.commercialStatus" || path === "catalog.implementationLevel") return false;
  return /^(technicalStatus|billingModel|dependencies|compatibleWith|limits|activation|catalog)(\.|$)/.test(path);
}
const isPublicText = (path: string) => path === "tagline" || path === "description" || TEXT_FIELDS.some((f) => path === `commercial.${f}` || path.startsWith(`commercial.${f}.`));

/** Política de la unificación ante un borrador ajeno (ver la cabecera). */
export function overDraftPolicy(c: NetUnificationChange, publishDraft: boolean): OverDraftPolicy {
  return {
    // (`publishDraft`: hay autorización expresa para publicar también los cambios de ESTE borrador)
    // Lo ya unificado no se vuelve a tocar (ni su nota interna)
    reviewed: (base) => (isDone(base, c) ? base : target(base, c)),
    startProblems: (base) => startProblems(base, c),
    drop: (path) => !!c.dropCoreIncluded && (path === "catalog.coreIncluded" || path.startsWith("catalog.coreIncluded.")),
    retain: (path) => !publishDraft || outOfScope(path),
    auto: (path, v) => {
      if (v.revisionChanged) {
        // Nota interna (nunca se publica): se conservan las dos, la del borrador primero
        if (path === "internal.evidence" && typeof v.borrador === "string" && typeof v.revision === "string") {
          const both = `${v.borrador} · ${v.revision}`;
          return both.length <= 1000 ? { value: both, origen: "ambos (nota interna: se conservan las dos)" } : { value: v.revision, origen: "revisión (nota interna: las dos no caben; la del borrador sigue en el historial)" };
        }
        if (isPublicText(path) && (hasComingSoonWord(v.borrador) || LOOSE_MODULES_RE.test(text(v.borrador)))) return { value: v.revision, origen: "revisión (el texto del borrador dice «próximamente» o compara con módulos sueltos)" };
        return undefined;
      }
      if (c.scrubText && isPublicText(path) && hasComingSoonWord(v.borrador)) return { value: scrubDeep(v.borrador), origen: "borrador, sin «próximamente»" };
      return undefined;
    },
    checkResult: (result) => {
      const pub = { tagline: result.tagline, description: result.description, commercial: { ...result.commercial, includedFeatures: undefined } };
      if (c.scrubText && hasComingSoonWord(pub)) return "el resultado todavía diría «próximamente» en un texto público; se revisa en el CRM";
      if (c.scrubText && publishDraft && LOOSE_MODULES_RE.test(text(pub))) return "el resultado compararía con la compra de módulos sueltos; se revisa en el CRM";
      const core = coreIncludedTexts(result as unknown as Record<string, unknown>);
      if (c.dropCoreIncluded && core.length) return `el resultado anunciaría Elephant Core incluido (${core.join("; ")}); se corrige el texto en el CRM`;
      // Un resultado a medio camino (sin terminar y con todos sus campos en el valor de partida o en el nuevo) lo pisaría
      // la siguiente ejecución sin avisar
      if (publishDraft && !isDone(result, c) && startProblems(result, c).length === 0) return "el resultado dejaría la unificación a medias y la siguiente ejecución lo cambiaría; se revisa en el CRM";
      return null;
    },
  };
}

export function isDone(d: ProductDraft, c: NetUnificationChange): boolean {
  if (c.name && d.name !== c.name.to) return false;
  if (c.description && d.description !== c.description.to) return false;
  if (c.tagline && d.tagline !== c.tagline.to) return false;
  if (c.status && d.catalog.commercialStatus !== c.status.to) return false;
  if (c.implementationLevel && d.catalog.implementationLevel !== c.implementationLevel.to) return false;
  if (c.legacy && d.catalog.legacy?.replacedBy !== c.legacy.replacedBy) return false;
  if (c.dropCoreIncluded && d.catalog.coreIncluded !== undefined) return false;
  for (const [f, v] of Object.entries(c.fields ?? {})) if (!same((d.commercial as Record<string, unknown> | undefined)?.[f], scrubDeep(v!.to))) return false;
  if (c.scrubText && (hasComingSoonWord(d.tagline) || hasComingSoonWord(d.description) || TEXT_FIELDS.some((f) => hasComingSoonWord((d.commercial as Record<string, unknown> | undefined)?.[f])))) return false;
  return true;
}

export function target(d: ProductDraft, c: NetUnificationChange): ProductDraft {
  const merged = c.fields ? { ...(d.commercial as Commercial), ...Object.fromEntries(Object.entries(c.fields).map(([f, v]) => [f, v!.to])) } : d.commercial;
  const commercial = merged && c.scrubText ? { ...merged, ...Object.fromEntries(TEXT_FIELDS.filter((f) => merged[f] !== undefined).map((f) => [f, scrubDeep(merged[f])])) } : merged;
  const { coreIncluded: _core, ...catalogWithoutCore } = d.catalog;
  return productDraft.parse({
    ...d,
    ...(c.name ? { name: c.name.to } : {}),
    ...(c.description ? { description: c.description.to } : {}),
    ...(c.tagline ? { tagline: c.tagline.to } : {}),
    catalog: {
      ...(c.dropCoreIncluded ? catalogWithoutCore : d.catalog),
      ...(c.status ? { commercialStatus: c.status.to } : {}),
      ...(c.implementationLevel ? { implementationLevel: c.implementationLevel.to } : {}),
      ...(c.legacy ? { legacy: d.catalog.legacy?.replacedBy === c.legacy.replacedBy ? d.catalog.legacy : c.legacy } : {}),
    },
    ...(commercial ? { commercial } : {}),
    // Si solo falta retirar «Core incluido», la nota interna se conserva (puede ser de una revisión posterior)
    internal: { ...d.internal, evidence: c.dropCoreIncluded && d.catalog.coreIncluded !== undefined && isDone({ ...d, catalog: catalogWithoutCore } as ProductDraft, c) ? d.internal.evidence : c.evidence },
  });
}

/** Lo que impide aplicar el cambio: campos que ya no valen ni su valor de partida ni el nuevo (vacío = se puede aplicar). */
export function startProblems(d: ProductDraft, c: NetUnificationChange): string[] {
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
    if (!same(now, v!.from) && !same(now, v!.to) && !same(now, scrubDeep(v!.to))) problems.push(`el campo «${f}» de la ficha ya no es el de partida`);
  }
  return problems;
}

export async function applyNetUnification(
  svc: WebAdminService,
  store: WebStore,
  o: { apply?: boolean; author: string; changes?: readonly NetUnificationChange[]; decisions?: readonly OverDraftDecision[]; publishForeignDraft?: readonly ForeignDraftAuthorization[] },
): Promise<NetUnificationReport> {
  const r: NetUnificationReport = { apply: !!o.apply, changed: [], already: [], conflicts: [], borradores: [], anunciaCore: [] };
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
    // (Una ejecución interrumpida —guardado por esta revisión y sin publicar— la retoma el mecanismo del borrador ajeno,
    // más abajo: nunca se publica a ciegas un borrador por llevar la firma de esta revisión, porque puede tener cambios retenidos)
    if (cur.publication !== "published") {
      r.conflicts.push(`${c.key}: no está publicado (${cur.publication}); se decide en el CRM`);
      continue;
    }
    if (!upToDate) {
      // Borrador ajeno: la revisión se aplica sobre lo publicado y el borrador se conserva (server/catalog/overDraft.ts)
      // La autorización para publicar los cambios del borrador vale solo para su versión (y la publicada) exactas
      const authorized = (b: { version: number; versionPublicada: number }) => (o.publishForeignDraft ?? PUBLISH_FOREIGN_DRAFT).some((a) => a.key === c.key && a.borradorVersion === b.version && a.versionPublicada === b.versionPublicada);
      const out = await reviewOverDraft(svc, store, { key: c.key, author: o.author, apply: o.apply, policy: (b) => overDraftPolicy(c, authorized(b)), decisions: o.decisions ?? NET_UNIFICATION_DECISIONS });
      if (out.state !== "none" && out.report) r.borradores.push(out.report);
      if (out.state === "already") r.already.push(c.key);
      else if (out.state === "changed") r.changed.push(`${c.key}: ${out.summary}`);
      else if (out.state === "blocked") r.conflicts.push(`${c.key}: ${out.reason}`);
      continue;
    }
    const problems = startProblems(d, c);
    if (problems.length) {
      r.conflicts.push(`${c.key}: ${problems.join("; ")}; se deja como lo decidió el CRM`);
      continue;
    }
    const fieldsChanged = Object.entries(c.fields ?? {}).filter(([f, v]) => !same((d.commercial as Record<string, unknown> | undefined)?.[f], scrubDeep(v!.to))).map(([f]) => f);
    const what = [
      // Solo lo que cambia de verdad (una solución ya unificada puede tener pendiente solo la retirada de «Core incluido»)
      c.name && d.name !== c.name.to ? `nombre «${c.name.to}»` : null,
      c.status && d.catalog.commercialStatus !== c.status.to ? `${c.status.from} → ${c.status.to}` : null,
      c.implementationLevel && d.catalog.implementationLevel !== c.implementationLevel.to ? `nivel ${c.implementationLevel.from} → ${c.implementationLevel.to}` : null,
      c.legacy ? `heredado (lo incluye ${c.legacy.replacedBy})` : null,
      c.dropCoreIncluded && d.catalog.coreIncluded !== undefined ? "se retira catalog.coreIncluded (Core y Net se contratan por separado)" : null,
      c.description && d.description !== c.description.to ? "descripción" : null,
      c.tagline && d.tagline !== c.tagline.to ? "línea corta" : null,
      fieldsChanged.length ? `ficha (${fieldsChanged.join(", ")})` : null,
      c.scrubText && TEXT_FIELDS.some((f) => hasComingSoonWord((d.commercial as Record<string, unknown> | undefined)?.[f])) ? "textos sin «Próximamente»" : null,
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
  // Comprobación final (solo lectura): ninguna solución anuncia Core incluido, ni en lo publicado ni en el borrador
  for (const c of (o.changes ?? NET_UNIFICATION_2026_11_09).filter((x) => x.dropCoreIncluded)) {
    const e = await store.getEntry("product", c.key);
    if (!e) continue;
    for (const t of coreIncludedTexts(e.published)) r.anunciaCore.push(`${c.key} (publicado) ${t}`);
    for (const t of coreIncludedTexts(e.draft)) r.anunciaCore.push(`${c.key} (borrador) ${t}`);
    if ((e.published as { catalog?: { coreIncluded?: unknown } } | null)?.catalog?.coreIncluded !== undefined) r.anunciaCore.push(`${c.key} (publicado) catalog.coreIncluded`);
    if ((e.draft as { catalog?: { coreIncluded?: unknown } }).catalog?.coreIncluded !== undefined) r.anunciaCore.push(`${c.key} (borrador) catalog.coreIncluded`);
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
