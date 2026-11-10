/**
 * Revisión del catálogo del 08/11/2026 — Activación del marketplace, tanda B (encargo de Jorge del 08/11/2026): fichas
 * de los productos que ya tienen funcionalidad en el Core.
 *
 *  - Elephant GEO Control (`geo-control`, PR #717): de «Próximamente» a «Implantación acompañada», con su ficha real.
 *  - Contratos y firma electrónica (`contracts-esign`, PR #718): igual, firma electrónica SIMPLE (sin avanzada ni
 *    cualificada) y su Price de Stripe preparado (`catalog.stripePrepared`, los extras no lo llevan por defecto).
 *  - Elephant Finance Sync: sigue en implantación acompañada (el datáfono por correo necesita el buzón del cliente),
 *    pero ya lee el extracto de cualquier banco (Norma 43, Excel o CSV, PR #716): la ficha deja de decir «CaixaBank».
 *
 * Cada campo de la ficha solo cambia si vale exactamente lo publicado de partida (o ya vale lo nuevo); los estados,
 * solo desde su estado de partida. Mismas garantías que las demás revisiones: flujo normal del CRM con autor, versión e
 * historial; idempotente; nunca publica un borrador ajeno; no toca precios, contratos, licencias ni Stripe; simulación
 * por defecto. La venta directa de GEO Control y Contratos la abre después la revisión de venta directa
 * (review20261108connect.ts), cuando sus Prices de Stripe Live estén enlazados.
 */
import { productDraft, type ProductDraft } from "../web/schemas";
import type { WebAdminService } from "../web/service";
import type { WebStore } from "../web/store";
import { reviewOverDraft, type OverDraftReport } from "./overDraft";
import { ASSISTED_ACTIVATION, REQUEST_STEP } from "./review20261108connect";

export const REVIEW_ID_2026_11_08_FICHAS = "revision-catalogo-2026-11-08-fichas";

type Commercial = NonNullable<ProductDraft["commercial"]>;
type Field = keyof Commercial;

export interface ListingChange {
  key: string;
  /** Evidencia del estado comercial; sin ella se conserva la que ya tenga el producto (cambios solo de textos). */
  evidence?: string;
  /** Estados de partida y de llegada (sin `status`, no cambia). */
  status?: { from: ProductDraft["catalog"]["commercialStatus"]; to: ProductDraft["catalog"]["commercialStatus"] };
  technical?: { from: ProductDraft["technicalStatus"]; to: ProductDraft["technicalStatus"] };
  activation?: { from: ProductDraft["activation"]["kind"]; to: ProductDraft["activation"]["kind"] };
  functionalGrade?: NonNullable<ProductDraft["internal"]["functionalGrade"]>;
  stripePrepared?: boolean;
  /** Costes de terceros del producto (texto público fuera de la ficha): de partida y nuevo. */
  thirdPartyCosts?: { from: string | null; to: string | null };
  /** Nivel de implantación (1 activable desde el Core · 2 portable · 3 desarrollo nuevo): de partida y nuevo. */
  implementationLevel?: { from: 1 | 2 | 3 | undefined; to: 1 | 2 | 3 };
  /** Campos de la ficha: valor publicado de partida y valor nuevo. */
  fields: Partial<Record<Field, { from: unknown; to: unknown }>>;
  /** Textos del producto fuera de la ficha (nombre, frase corta y descripción): de partida y nuevo. */
  product?: Partial<Record<ProductText, { from: string; to: string }>>;
  /**
   * Solo textos de un producto que ya está en venta directa (un plan): la revisión también le aplica. Sin esta marca,
   * un producto en venta directa se da por hecho y no se toca (review20261108connect.ts ya hizo su parte).
   */
  inDirectSale?: boolean;
  /**
   * Condición previa en el catálogo de un producto (el propio u otro): ámbito y unidad de cobro ya cambiados en el CRM.
   * Sin cumplirse, la ficha no cambia (conflicto) para no publicar un texto que contradiga el precio vigente.
   */
  requiresCatalog?: { key: string; scope: "company" | "site"; chargeUnit: string | null };
  /**
   * Ámbito de la licencia y unidad de cobro del propio producto (el editor del CRM no tiene campos para ellos): de
   * partida y nuevos. Solo cambian desde su valor publicado de partida.
   */
  catalogScope?: { scope: { from: "company" | "site"; to: "company" | "site" }; chargeUnit: { from: string | null; to: string | null } };
  /**
   * Condición previa: el precio aprobado vigente de ese tipo (en EUR) debe ser exactamente este. La revisión nunca toca
   * precios: el precio se cambia antes en el CRM. Sin cumplirse, el producto no cambia (conflicto).
   */
  requiresPrice?: { kind: "monthly" | "yearly"; amountCents: number };
}
type ProductText = "name" | "tagline" | "description";

export const ASSISTED_FAQ = { q: "¿Cómo se pone en marcha?", a: "Es una implantación acompañada: envías la solicitud desde el panel y nuestro equipo la activa contigo. Enviar la solicitud no activa ni cobra nada por sí solo." };
const COMING_SOON_ACTIVATION = { activation: "Todavía no se puede contratar: estará disponible próximamente." };

export const LISTINGS_2026_11_08: readonly ListingChange[] = [
  {
    key: "connect-geo-control",
    evidence:
      "Tanda B del 08/11/2026 (PR #717): consultas de la marca, observaciones por superficie de IA (Google AI Overviews, ChatGPT, Perplexity, Copilot, Gemini), panel de presencia y citación, cambios, competidores y oportunidades, en la BD de cada empresa (migración 0048, router geoControl); licencia geo-control en rutas, procedimientos y menú. Respuesta de referencia opcional con la IA central, etiquetada como estimación.",
    status: { from: "coming_soon", to: "on_request" },
    technical: { from: "planned", to: "partial" },
    activation: { from: "none", to: "feature" },
    functionalGrade: "in_use",
    fields: {
      cta: { from: "waitlist", to: "contact" },
      headline: { from: "Próximamente: tu marca en las respuestas de IA.", to: "Tu marca en las respuestas de la IA, medida y con oportunidades de mejora." },
      longDescription: {
        from: "Visibilidad de la marca en motores de IA generativa.",
        to: "Consultas de tu sector, observaciones por asistente de IA (Google AI Overviews, ChatGPT, Perplexity, Copilot y Gemini), panel de presencia y citación de tu web, cambios, competidores más citados y oportunidades de mejora.",
      },
      valueProposition: {
        from: "Próximamente: mide si tu marca aparece cuando tus clientes preguntan a los asistentes de IA.",
        to: "Sigue si tu marca aparece y si se cita tu web cuando tus clientes preguntan a los asistentes de IA, descubre qué competidores salen en tu lugar y trabaja las oportunidades de mejora.",
      },
      benefits: { from: ["Medición de visibilidad"], to: ["Presencia y citación por asistente de IA", "Competidores más citados y cambios", "Oportunidades de mejora"] },
      excludes: { from: [], to: ["Lectura automática de lo que ve cada usuario en los asistentes: las observaciones las anota tu equipo", "Publicación de contenidos en tu web"] },
      integrations: { from: ["Servicio central de IA"], to: ["Servicio central de IA (respuesta de referencia opcional, como estimación)"] },
      seo: {
        from: { slug: "geo-control", title: "Visibilidad en IA generativa | Big Elephant GEO Control", description: "Próximamente: mide y mejora cómo aparece tu marca en los motores de IA generativa." },
        to: { slug: "geo-control", title: "Visibilidad en IA generativa | Big Elephant GEO Control", description: "Mide y mejora cómo aparece tu marca en las respuestas de los asistentes de IA generativa." },
      },
      terms: { from: COMING_SOON_ACTIVATION, to: { activation: ASSISTED_ACTIVATION } },
      howItWorks: {
        from: undefined,
        to: [
          REQUEST_STEP,
          { title: "Consultas", text: "Partes de una plantilla de preguntas de tu sector y tu zona y la ajustas a tu negocio." },
          { title: "Observaciones", text: "Anotas en cada asistente de IA si aparece tu marca, si cita tu web y qué competidores salen." },
          { title: "Mejora", text: "El panel muestra presencia, cambios y competidores, y propone oportunidades para trabajarlas." },
        ],
      },
      faq: {
        from: [
          { a: "Todavía no. Mientras esté en preparación o próximamente no se puede contratar.", q: "¿Puedo contratarlo ya?" },
          { a: "Sí, cuando la ficha muestra el botón «Me interesa»: tu solicitud llega a nuestro equipo.", q: "¿Puedo dejar mi interés?" },
          { a: "La visibilidad de tu marca en las respuestas de los motores de IA generativa.", q: "¿Qué medirá?" },
          { a: "Sí, del Paquete Marketing.", q: "¿Forma parte de algún paquete?" },
        ],
        to: [
          ASSISTED_FAQ,
          {
            q: "¿Mide automáticamente los asistentes de IA?",
            a: "No: ningún asistente ofrece una vía oficial para saber qué ve cada usuario. Tu equipo anota lo que ve y, si quiere, pide una respuesta de referencia a la IA, que se guarda como estimación y no cuenta en el panel.",
          },
          { q: "¿Qué mide?", a: "Si tu marca aparece y si se cita tu web en cada asistente, su evolución por semana o mes, los cambios y los competidores que salen." },
          { q: "¿Forma parte de algún paquete?", a: "Sí, del Paquete Marketing." },
        ],
      },
    },
  },
  {
    key: "extra-contracts-esign",
    evidence:
      "Tanda B del 08/11/2026 (PR #718): plantillas con variables del cliente, contratos con estados, envío a firma por enlace de un solo uso o firma en el panel, evidencias (fecha, IP, navegador y huella SHA-256 del texto) y PDF firmado, en la BD de cada empresa (migración 0049, router contractsEsign, ruta pública /contrato); licencia contracts-esign en rutas, procedimientos y página pública. Firma electrónica simple.",
    status: { from: "coming_soon", to: "on_request" },
    technical: { from: "planned", to: "partial" },
    activation: { from: "none", to: "feature" },
    functionalGrade: "in_use",
    stripePrepared: true,
    fields: {
      cta: { from: "waitlist", to: "contact" },
      headline: { from: "Próximamente: contratos firmados sin salir de Big Elephant.", to: "Contratos firmados sin salir de Big Elephant." },
      longDescription: {
        from: "Contratos con clientes y proveedores firmados dentro de la plataforma con firma simple (trazo y evidencias).",
        to: "Plantillas de contrato con los datos de tus clientes, envío a firma por enlace de un solo uso o firma en el panel, evidencias de cada paso y PDF firmado con la huella del texto. Firma electrónica simple.",
      },
      valueProposition: {
        from: "Próximamente: contratos con clientes y proveedores firmados sin salir de Elephant Core.",
        to: "Prepara contratos desde tus plantillas con los datos del cliente, envíalos a firmar por enlace y guarda el PDF firmado con sus evidencias, sin salir de Elephant Core.",
      },
      benefits: { from: [], to: ["Plantillas con los datos de tus clientes", "Firma por enlace o en el panel", "PDF firmado con sus evidencias"] },
      excludes: { from: [], to: ["Firma electrónica avanzada o cualificada y sellado de tiempo de terceros", "Varios firmantes en un mismo contrato"] },
      seo: {
        from: { slug: "contratos-firma", title: "Contratos con firma electrónica | Big Elephant", description: "Próximamente: contratos con clientes y proveedores firmados electrónicamente dentro de tu gestión." },
        to: { slug: "contratos-firma", title: "Contratos con firma electrónica | Big Elephant", description: "Contratos con clientes y proveedores firmados electrónicamente (firma simple) dentro de tu gestión." },
      },
      terms: { from: COMING_SOON_ACTIVATION, to: { activation: ASSISTED_ACTIVATION } },
      howItWorks: {
        from: undefined,
        to: [
          REQUEST_STEP,
          { title: "Plantillas", text: "Creas tus plantillas con variables como el nombre del cliente, la fecha o el importe." },
          { title: "Firma", text: "Generas el contrato de un cliente y le envías un enlace de firma de un solo uso, o lo firma en tu mostrador." },
          { title: "Archivo", text: "Cada contrato guarda sus evidencias y el PDF firmado con la huella del texto." },
        ],
      },
      faq: {
        from: [
          { a: "Todavía no: estará disponible próximamente y hasta entonces no se puede contratar.", q: "¿Puedo contratarlo ya?" },
          { a: "Sí, cuando la ficha muestra el botón «Me interesa»: tu solicitud llega a nuestro equipo.", q: "¿Puedo dejar mi interés?" },
          { a: "No. Solo firma simple, con trazo y evidencias.", q: "¿Incluirá firma avanzada o cualificada?" },
          { a: "Las firmas simples no tendrán cupo; los documentos ocuparán almacenamiento.", q: "¿Habrá un número máximo de firmas?" },
        ],
        to: [
          ASSISTED_FAQ,
          { q: "¿Incluye firma avanzada o cualificada?", a: "No. Es firma electrónica simple por aceptación, con el nombre del firmante, sus evidencias (fecha, IP y navegador) y la huella del texto firmado." },
          { q: "¿Hay un número máximo de firmas?", a: "No: las firmas simples no tienen cupo; los PDF firmados ocupan almacenamiento." },
        ],
      },
    },
  },
  {
    key: "connect-finance-sync",
    evidence:
      "Tanda B del 08/11/2026 (PR #716): extractos de cualquier banco (Norma 43 con comprobación de saldos, Excel o CSV por nombre de columna). Sigue en implantación acompañada por el datáfono (buzón de tickets del cliente).",
    fields: {
      excludes: { from: ["Formatos bancarios distintos de los disponibles (presupuesto)"], to: ["Conexión directa con la banca en línea: trabaja con los extractos que descargas"] },
      integrations: { from: ["CaixaBank (formato de extracto)", "Datáfono Comercia (correo)"], to: ["Cualquier banco (Norma 43, Excel o CSV)", "Datáfono Comercia (Excel o correo)"] },
      howItWorks: {
        from: [
          { text: "La solicitas desde el panel y nuestro equipo prepara la implantación contigo.", title: "Solicitud" },
          { text: "Subes el extracto del banco e importas las operaciones del datáfono o sus tickets por correo.", title: "Importación" },
          { text: "El sistema propone a qué venta, reserva o gasto corresponde cada movimiento y tú lo confirmas.", title: "Conciliación" },
          { text: "Cuadras las remesas con el banco, justificas diferencias y consultas la previsión de tesorería.", title: "Control" },
        ],
        to: [
          REQUEST_STEP,
          { title: "Importación", text: "Subes el extracto de tu banco (Norma 43, Excel o CSV) e importas las operaciones del datáfono o sus tickets por correo." },
          { title: "Conciliación", text: "El sistema propone a qué venta, reserva o gasto corresponde cada movimiento y tú lo confirmas." },
          { title: "Control", text: "Cuadras las remesas con el banco, justificas diferencias y consultas la previsión de tesorería." },
        ],
      },
      faq: {
        from: [
          { a: "Hoy con el formato de extracto de CaixaBank. Otros formatos bancarios se presupuestan aparte.", q: "¿Con qué bancos funciona?" },
          { a: "Hoy con el datáfono Comercia, importando sus operaciones o leyendo por correo los tickets que envía tu banco.", q: "¿Con qué datáfonos funciona?" },
          { a: "Un buzón propio donde recibir los tickets del datáfono y el extracto bancario en un formato soportado.", q: "¿Qué necesito?" },
          { a: "No: trabaja con los extractos que descargas y subes al panel.", q: "¿Se conecta directamente con mi banco?" },
          { a: "Es una implantación acompañada: envías la solicitud desde el panel y nuestro equipo la activa contigo. Enviar la solicitud no activa ni cobra nada por sí solo.", q: "¿Cómo se pone en marcha?" },
          { a: "No. Los importes del catálogo son sin IVA; el 21 % se añade aparte.", q: "¿El precio incluye IVA?" },
        ],
        to: [
          { q: "¿Con qué bancos funciona?", a: "Con cualquier banco: importas el fichero Norma 43 (cuaderno 43) o el Excel o CSV del extracto que descargas de tu banca en línea." },
          { q: "¿Con qué datáfonos funciona?", a: "Hoy con el datáfono Comercia, importando sus operaciones o leyendo por correo los tickets que envía tu banco." },
          { q: "¿Qué necesito?", a: "El extracto de tu banco y, para leer los tickets del datáfono por correo, un buzón propio donde recibirlos." },
          { q: "¿Se conecta directamente con mi banco?", a: "No: trabaja con los extractos que descargas y subes al panel." },
          ASSISTED_FAQ,
          { q: "¿El precio incluye IVA?", a: "No. Los importes del catálogo son sin IVA; el 21 % se añade aparte." },
        ],
      },
    },
  },
];

export interface ListingReport {
  apply: boolean;
  changed: string[];
  already: string[];
  conflicts: string[];
  /** Solo con `overDraft` y si hay productos con borrador ajeno: diff campo a campo y lo que queda retenido en el borrador. */
  borradores?: OverDraftReport[];
}

/** Igualdad estructural de JSON (orden de claves indiferente). */
function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined || a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) return a.length === (b as unknown[]).length && a.every((x, i) => same(x, (b as unknown[])[i]));
  const ka = Object.keys(a as object).filter((k) => (a as Record<string, unknown>)[k] !== undefined);
  const kb = Object.keys(b as object).filter((k) => (b as Record<string, unknown>)[k] !== undefined);
  return ka.length === kb.length && ka.every((k) => same((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

function target(d: ProductDraft, c: ListingChange): ProductDraft {
  const m: Commercial = { ...(d.commercial as Commercial) };
  for (const [f, v] of Object.entries(c.fields) as Array<[Field, { to: unknown }]>) (m as Record<string, unknown>)[f] = v.to;
  const texts = Object.fromEntries((Object.entries(c.product ?? {}) as Array<[ProductText, { to: string }]>).map(([f, v]) => [f, v.to]));
  return {
    ...d,
    ...texts,
    ...(c.thirdPartyCosts ? { thirdPartyCosts: c.thirdPartyCosts.to } : {}),
    technicalStatus: c.technical?.to ?? d.technicalStatus,
    activation: c.activation ? { ...d.activation, kind: c.activation.to } : d.activation,
    catalog: {
      ...d.catalog,
      commercialStatus: c.status?.to ?? d.catalog.commercialStatus,
      ...(c.stripePrepared !== undefined ? { stripePrepared: c.stripePrepared } : {}),
      ...(c.implementationLevel ? { implementationLevel: c.implementationLevel.to } : {}),
      ...(c.catalogScope ? { scope: c.catalogScope.scope.to, chargeUnit: c.catalogScope.chargeUnit.to } : {}),
    },
    commercial: Object.keys(c.fields).length ? m : d.commercial,
    internal: { ...d.internal, ...(c.evidence !== undefined ? { evidence: c.evidence } : {}), ...(c.functionalGrade ? { functionalGrade: c.functionalGrade } : {}) },
  };
}

function isDone(d: ProductDraft, c: ListingChange): boolean {
  const t = target(d, c);
  return (
    same(d.commercial, t.commercial) &&
    (Object.keys(c.product ?? {}) as ProductText[]).every((f) => d[f] === t[f]) &&
    d.technicalStatus === t.technicalStatus &&
    d.activation.kind === t.activation.kind &&
    d.catalog.commercialStatus === t.catalog.commercialStatus &&
    (c.stripePrepared === undefined || d.catalog.stripePrepared === c.stripePrepared) &&
    (!c.thirdPartyCosts || d.thirdPartyCosts === c.thirdPartyCosts.to) &&
    (!c.implementationLevel || d.catalog.implementationLevel === c.implementationLevel.to) &&
    (!c.catalogScope || (d.catalog.scope === c.catalogScope.scope.to && (d.catalog.chargeUnit ?? null) === c.catalogScope.chargeUnit.to))
  );
}

/** Ya en venta directa (review20261108connect.ts): la revisión ya hizo su parte y no la deshace (salvo `inDirectSale`). */
const directSaleDone = (d: ProductDraft, c: ListingChange) => !c.inDirectSale && d.catalog.commercialStatus === "available" && d.technicalStatus === "available" && d.catalog.offer?.modality === "immediate";

/** Lo que impide aplicar el cambio: valores que ya no son ni los de partida ni los nuevos (vacío = se puede aplicar). */
function startProblems(d: ProductDraft, c: ListingChange): string[] {
  const problems: string[] = [];
  if (!d.commercial && Object.keys(c.fields).length) return ["no tiene ficha comercial"];
  if (c.implementationLevel && d.catalog.implementationLevel !== c.implementationLevel.from && d.catalog.implementationLevel !== c.implementationLevel.to) problems.push(`nivel de implantación «${d.catalog.implementationLevel}» (se esperaba «${c.implementationLevel.from}»)`);
  if (c.thirdPartyCosts && d.thirdPartyCosts !== c.thirdPartyCosts.from && d.thirdPartyCosts !== c.thirdPartyCosts.to) problems.push("los costes de terceros ya no son los de partida");
  if (c.stripePrepared !== undefined && d.catalog.stripePrepared !== undefined && d.catalog.stripePrepared !== c.stripePrepared) problems.push(`«stripePrepared» decidido en el CRM (${d.catalog.stripePrepared})`);
  if (c.status && d.catalog.commercialStatus !== c.status.from && d.catalog.commercialStatus !== c.status.to) problems.push(`estado «${d.catalog.commercialStatus}» (se esperaba «${c.status.from}»)`);
  if (c.technical && d.technicalStatus !== c.technical.from && d.technicalStatus !== c.technical.to) problems.push(`estado técnico «${d.technicalStatus}» (se esperaba «${c.technical.from}»)`);
  if (c.activation && d.activation.kind !== c.activation.from && d.activation.kind !== c.activation.to) problems.push(`activación «${d.activation.kind}» (se esperaba «${c.activation.from}»)`);
  if (c.catalogScope) {
    const s = c.catalogScope;
    const unit = d.catalog.chargeUnit ?? null;
    if (d.catalog.scope !== s.scope.from && d.catalog.scope !== s.scope.to) problems.push(`ámbito «${d.catalog.scope}» (se esperaba «${s.scope.from}»)`);
    if (unit !== s.chargeUnit.from && unit !== s.chargeUnit.to) problems.push(`unidad de cobro «${unit ?? "ninguna"}» (se esperaba «${s.chargeUnit.from ?? "ninguna"}»)`);
  }
  for (const [f, v] of Object.entries(c.fields) as Array<[Field, { from: unknown; to: unknown }]>) {
    const now = (d.commercial as Record<string, unknown>)[f];
    if (!same(now, v.from) && !same(now, v.to)) problems.push(`el campo «${f}» de la ficha ya no es el de partida`);
  }
  for (const [f, v] of Object.entries(c.product ?? {}) as Array<[ProductText, { from: string; to: string }]>) if (d[f] !== v.from && d[f] !== v.to) problems.push(`el texto «${f}» del producto ya no es el de partida`);
  return problems;
}

const eur = (cents: number) => `${(cents / 100).toFixed(2).replace(".", ",")} €`;

/**
 * `overDraft` (10/11/2026): un producto con borrador ajeno sin publicar ya no queda como conflicto. La revisión se aplica
 * sobre lo PUBLICADO y el borrador se vuelve a guardar con los mismos cambios (server/catalog/overDraft.ts): TODOS los
 * cambios del borrador siguen pendientes, sin publicarse («retenido»). Sin la marca, el comportamiento de siempre.
 */
export async function applyListingReview(svc: WebAdminService, store: WebStore, o: { apply?: boolean; author: string; changes?: readonly ListingChange[]; overDraft?: boolean }): Promise<ListingReport> {
  const r: ListingReport = { apply: !!o.apply, changed: [], already: [], conflicts: [] };
  /** Productos cuyo ámbito queda como pide esta misma revisión (también en simulación): ámbito y unidad de cobro. */
  const scoped = new Map<string, { scope: string; chargeUnit: string | null }>();
  for (const c of o.changes ?? LISTINGS_2026_11_08) {
    const cur = await store.getEntry("product", c.key);
    if (!cur) {
      r.conflicts.push(`${c.key}: no existe en el catálogo`);
      continue;
    }
    const d = productDraft.parse(cur.draft);
    const upToDate = cur.publication === "published" && cur.publishedVersion === cur.draftVersion;
    const settled = () => {
      if (c.catalogScope) scoped.set(c.key, { scope: c.catalogScope.scope.to, chargeUnit: c.catalogScope.chargeUnit.to });
    };
    if (isDone(d, c) && upToDate) {
      r.already.push(c.key);
      settled();
      continue;
    }
    // Ficha propia guardada y sin publicar (una ejecución anterior se interrumpió): se publica. Con `overDraft` la
    // retoma el mecanismo del borrador ajeno, que nunca publica a ciegas (el borrador puede llevar cambios retenidos)
    if (!o.overDraft && isDone(d, c) && cur.publication === "published" && !upToDate && cur.updatedBy === o.author) {
      r.changed.push(`${c.key}: se publica la ficha ya guardada`);
      if (o.apply) await svc.publish("product", c.key, cur.draftVersion, o.author).catch((e) => void r.conflicts.push(`${c.key}: no se pudo publicar (${e instanceof Error ? e.message : String(e)})`));
      continue;
    }
    if (cur.publication !== "published") {
      r.conflicts.push(`${c.key}: no está publicado (${cur.publication}); se decide en el CRM`);
      continue;
    }
    // Condiciones previas fuera del producto: el ámbito de otro producto y el precio aprobado
    const pre: string[] = [];
    if (c.requiresCatalog) {
      const q = c.requiresCatalog;
      const other = q.key === c.key ? cur : await store.getEntry("product", q.key);
      const oc = scoped.get(q.key) ?? (other ? productDraft.parse(other.published ?? other.draft).catalog : null);
      if (!oc || oc.scope !== q.scope || (oc.chargeUnit ?? null) !== q.chargeUnit) pre.push(`antes hay que cambiar el ámbito de «${q.key}» a «${q.scope}» y su unidad de cobro a «${q.chargeUnit ?? "ninguna"}» (ahora «${oc?.scope ?? "?"}», «${oc?.chargeUnit ?? "ninguna"}»)`);
    }
    if (c.requiresPrice) {
      const q = c.requiresPrice;
      const approved = (await store.listPrices(cur.id)).filter((p) => p.status === "approved" && p.kind === q.kind && p.currency === "EUR");
      if (approved.length !== 1 || approved[0].amountCents !== q.amountCents)
        pre.push(`el precio aprobado (${q.kind === "monthly" ? "mensual" : "anual"}) debe ser ${eur(q.amountCents)} y ahora es ${approved.length ? approved.map((p) => eur(p.amountCents)).join(" y ") : "ninguno"}: antes hay que aprobarlo en el CRM (la revisión no toca precios)`);
    }
    if (!upToDate) {
      if (!o.overDraft) {
        r.conflicts.push(`${c.key}: tiene cambios sin publicar en el CRM; no se publica un borrador ajeno`);
        continue;
      }
      // Borrador ajeno: la revisión se aplica sobre lo publicado y todos los cambios del borrador siguen pendientes
      const out = await reviewOverDraft(svc, store, {
        key: c.key,
        author: o.author,
        apply: o.apply,
        policy: {
          reviewed: (base) => (directSaleDone(base, c) || isDone(base, c) ? base : productDraft.parse(target(base, c))),
          startProblems: (base) => (directSaleDone(base, c) || isDone(base, c) ? [] : [...pre, ...startProblems(base, c)]),
          retain: () => true,
        },
      });
      if (out.state !== "none" && out.report) (r.borradores ??= []).push(out.report);
      if (out.state === "already") {
        r.already.push(c.key);
        settled();
      } else if (out.state === "changed") {
        r.changed.push(`${c.key}: ${out.summary}`);
        settled();
      } else if (out.state === "blocked") r.conflicts.push(`${c.key}: ${out.reason}`);
      continue;
    }
    // Ya en venta directa (review20261108connect.ts): esta revisión ya hizo su parte y no la deshace
    if (directSaleDone(d, c)) {
      r.already.push(`${c.key} (en venta directa)`);
      continue;
    }
    const problems = [...pre, ...startProblems(d, c)];
    if (problems.length) {
      r.conflicts.push(`${c.key}: ${problems[0] === "no tiene ficha comercial" && problems.length === 1 ? problems[0] : `${problems.join("; ")}; se deja como lo decidió el CRM`}`);
      continue;
    }
    settled();
    const scopeChange = c.catalogScope && (d.catalog.scope !== c.catalogScope.scope.to || (d.catalog.chargeUnit ?? null) !== c.catalogScope.chargeUnit.to) ? `ámbito «${d.catalog.scope}» → «${c.catalogScope.scope.to}», unidad de cobro «${d.catalog.chargeUnit ?? "ninguna"}» → «${c.catalogScope.chargeUnit.to ?? "ninguna"}»` : "";
    const what = [scopeChange, Object.keys(c.product ?? {}).length ? `producto (${Object.keys(c.product ?? {}).join(", ")})` : "", Object.keys(c.fields).length ? `ficha (${Object.keys(c.fields).join(", ")})` : ""].filter(Boolean).join("; ");
    r.changed.push(`${c.key}: ${c.status ? `${c.status.from} → ${c.status.to}; ` : ""}${what}`);
    if (!o.apply) continue;
    try {
      const saved = await svc.save("product", c.key, { draft: target(d, c), expectedVersion: cur.draftVersion }, o.author);
      await svc.publish("product", c.key, saved.draftVersion, o.author);
    } catch (e) {
      r.changed.pop();
      r.conflicts.push(`${c.key}: no se pudo publicar la ficha (${e instanceof Error ? e.message : String(e)}); se revisa en el CRM`);
    }
  }
  return r;
}
