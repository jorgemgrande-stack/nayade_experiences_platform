/**
 * Paquete Marketing (`connect-pack-marketing`) · «Puesta en marcha y resumen»: lógica pura (servidor y panel).
 *
 * El paquete agrupa cuatro módulos del Core que ya funcionan por separado: Ads Manager (`ads-manager`), Campaigns
 * (`email-campaigns`: Brevo de la empresa y envío de campañas), SEO Control (`seo-control`) y GEO Control
 * (`geo-control`). La licencia del paquete concede las cuatro capacidades (server/licensing/service.ts
 * `capabilitiesOf`); quien solo tenga alguno suelto ve también aquí los suyos.
 *
 * Para cada módulo licenciado, a partir de los datos reales de la empresa (server/marketingPack.ts): qué está hecho,
 * el siguiente paso concreto con el enlace a su pantalla y dos o tres cifras clave. Lo no licenciado sale como
 * «No incluido» con enlace a /admin/ampliar. Nunca lleva secretos: solo estados y cifras.
 */

export const MARKETING_PACK_KEY = "connect-pack-marketing";
export const UPGRADE_HREF = "/admin/ampliar";
export const INTEGRATIONS_HREF = "/admin/configuracion/integraciones";
export const MARKETING_SUMMARY_HREF = "/admin/marketing/resumen";
/** Una observación de GEO de hace más de esto ya no dice cómo estás hoy. */
export const GEO_STALE_DAYS = 30;

export const MARKETING_PACK_MODULES = [
  { id: "ads", capability: "ads-manager", name: "Ads Manager", description: "Inversión y resultados de Meta Ads y Google Ads, medidos con tus ventas.", href: "/admin/marketing/ads" },
  { id: "campaigns", capability: "email-campaigns", name: "Campaigns", description: "Tu cuenta de Brevo, los consentimientos de tus clientes y tus campañas de correo.", href: "/admin/marketing/campanas" },
  { id: "seo", capability: "seo-control", name: "SEO Control", description: "Palabras clave y posiciones, Search Console, auditoría de tu web y reseñas.", href: "/admin/marketing/seo" },
  { id: "geo", capability: "geo-control", name: "GEO Control", description: "Presencia de tu marca en las respuestas de los asistentes de IA.", href: "/admin/marketing/geo" },
] as const;

export type MarketingModuleId = (typeof MARKETING_PACK_MODULES)[number]["id"];
export const MARKETING_PACK_CAPABILITIES: string[] = MARKETING_PACK_MODULES.map((m) => m.capability);

// ── Datos reales de cada módulo (los reúne server/marketingPack.ts con los servicios existentes) ──────────────────────

export interface AdsFacts {
  metaConnected: boolean;
  googleConnected: boolean;
  /** Alguna campaña llegó por informe CSV. */
  csvImported: boolean;
  /** Campañas importadas (API o CSV), sin archivar. */
  campaigns: number;
  /** Últimos 30 días. */
  spendCents: number;
  /** Ventas del Core atribuidas a campañas en esos 30 días; null si aún no hay forma fiable de atribuirlas. */
  sales: number | null;
  roas: number | null;
  currency: string;
  /** Campañas con datos en más de una moneda: no se suman en un importe. */
  mixedCurrencies?: boolean;
}

export interface CampaignsFacts {
  brevoConnected: boolean;
  /** Nombre de la lista de Brevo elegida; null sin elegir. */
  listName: string | null;
  consentsGranted: number;
  lastSync: { status: string; finishedAt: string | null } | null;
  campaignsSent: number;
  /** El recuento sale de las últimas campañas (el listado tiene tope): puede haber más. */
  campaignsCapped?: number | null;
  /** Última campaña enviada con estadísticas: aperturas sobre entregados (0–1). */
  lastOpenRate: number | null;
}

export interface SeoFacts {
  searchConsoleConnected: boolean;
  /** Última importación de Search Console terminada bien. */
  searchConsoleImported: boolean;
  reviewsConnected: boolean;
  keywords: number;
  top10: number;
  averagePosition: number | null;
  auditDone: boolean;
}

export interface GeoFacts {
  brandConfigured: boolean;
  queries: number;
  /** Observaciones anotadas por el equipo (las respuestas de referencia de la IA son estimaciones y no cuentan). */
  observations: number;
  lastObservedOn: string | null;
  presenceRate: number | null;
}

export interface FactsById {
  ads: AdsFacts;
  campaigns: CampaignsFacts;
  seo: SeoFacts;
  geo: GeoFacts;
}

/** Estado de la licencia de un módulo para esta empresa. */
export type ModuleLicence = "active" | "read_only" | null;

/** `unknown`: no se pudo comprobar la licencia (no es «no contratado»). */
export type ModuleInput<F> = { licence: null } | { licence: "active" | "read_only"; facts: F } | { licence: "active" | "read_only" | "unknown"; error: string };

export type MarketingPackInput = { [K in MarketingModuleId]: ModuleInput<FactsById[K]> };

// ── Vista ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

export type MarketingModuleState = "not_included" | "unavailable" | "to_start" | "in_progress" | "ready";

export const MODULE_STATE_LABEL: Record<MarketingModuleState, string> = {
  not_included: "No incluido",
  unavailable: "No disponible ahora",
  to_start: "Por empezar",
  in_progress: "En marcha",
  ready: "Funcionando",
};

export interface MarketingCheck {
  label: string;
  done: boolean;
  optional?: boolean;
}
export interface MarketingFigure {
  label: string;
  value: string;
}
export interface MarketingModuleView {
  id: MarketingModuleId;
  name: string;
  capability: string;
  description: string;
  href: string;
  state: MarketingModuleState;
  stateLabel: string;
  readOnly: boolean;
  checks: MarketingCheck[];
  nextStep: { label: string; href: string } | null;
  figures: MarketingFigure[];
  /** Aviso (no disponible, solo lectura…). */
  message: string | null;
}
export interface MarketingPackSummary {
  modules: MarketingModuleView[];
  included: number;
  ready: number;
  /** Los cuatro incluidos (el paquete o los cuatro sueltos). */
  complete: boolean;
}

// ── Formato ───────────────────────────────────────────────────────────────────────────────────────────────────────────

const intFmt = new Intl.NumberFormat("es-ES");
function money(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat("es-ES", { style: "currency", currency, maximumFractionDigits: 0 }).format(cents / 100);
  } catch {
    return `${intFmt.format(Math.round(cents / 100))} ${currency}`;
  }
}
const pct = (r: number) => `${Math.round(r * 100)} %`;
const dec1 = (n: number) => new Intl.NumberFormat("es-ES", { maximumFractionDigits: 1, minimumFractionDigits: 1 }).format(n);
/** AAAA-MM-DD → DD/MM/AAAA (sin zona horaria: es una fecha de calendario). */
export function dayLabel(day: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(day);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : day;
}
function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}
const NO_DATA = "Sin datos";
const MIXED = "Varias monedas";

// ── Reglas por módulo ─────────────────────────────────────────────────────────────────────────────────────────────────

interface ModuleBody {
  checks: MarketingCheck[];
  nextStep: { label: string; href: string };
  figures: MarketingFigure[];
  /** Lo imprescindible está hecho. */
  ready: boolean;
}

function adsBody(f: AdsFacts, href: string): ModuleBody {
  const source = f.metaConnected || f.googleConnected || f.csvImported;
  const checks: MarketingCheck[] = [
    { label: "Meta Ads o Google Ads conectados, o su informe CSV importado", done: source },
    { label: "Campañas importadas", done: f.campaigns > 0 },
    { label: "Ventas relacionadas con tus campañas (etiquetas UTM o informe de transacciones)", done: f.sales != null },
  ];
  const nextStep = !source
    ? { label: "Importa el informe CSV de Meta Ads o Google Ads, o conecta tus cuentas desde «Importar»", href: `${href}?tab=importar` }
    : f.campaigns === 0
      ? { label: "Importa los datos de tus campañas", href: `${href}?tab=importar` }
      : f.sales == null
        ? { label: "Relaciona tus ventas con las campañas para medir ROAS y coste por venta", href: `${href}?tab=importar` }
        : { label: "Revisa la inversión y el ROAS de tus campañas", href };
  return {
    checks,
    nextStep,
    ready: source && f.campaigns > 0,
    figures: [
      { label: "Inversión (30 días)", value: f.campaigns === 0 ? NO_DATA : f.mixedCurrencies ? MIXED : money(f.spendCents, f.currency) },
      { label: "Ventas atribuidas (30 días)", value: f.sales == null ? NO_DATA : intFmt.format(f.sales) },
      { label: "ROAS (30 días)", value: f.roas == null ? NO_DATA : f.mixedCurrencies ? MIXED : `${dec1(f.roas)}×` },
    ],
  };
}

function campaignsBody(f: CampaignsFacts, href: string): ModuleBody {
  const list = f.listName != null;
  const checks: MarketingCheck[] = [
    { label: "Cuenta de Brevo de tu empresa conectada", done: f.brevoConnected },
    { label: list ? `Lista de Brevo elegida: ${f.listName}` : "Lista de Brevo elegida", done: list },
    { label: "Consentimientos de tus clientes registrados", done: f.consentsGranted > 0 },
    { label: "Primera campaña enviada", done: f.campaignsSent > 0 },
  ];
  const nextStep = !f.brevoConnected
    ? { label: "Pega la clave API de tu cuenta de Brevo en Integraciones y pulsa «Probar conexión»", href: INTEGRATIONS_HREF }
    : !list
      ? { label: "Elige la lista de Brevo a la que se sincronizan tus clientes", href: "/admin/marketing/brevo" }
      : f.consentsGranted === 0
        ? { label: "Registra el consentimiento de los clientes que aceptan recibir tus correos", href: "/admin/marketing/brevo" }
        : f.campaignsSent === 0
          ? { label: "Crea y envía tu primera campaña de correo", href }
          : { label: "Revisa los resultados de tus campañas", href };
  return {
    checks,
    nextStep,
    ready: f.brevoConnected && list,
    figures: [
      { label: "Clientes con consentimiento", value: intFmt.format(f.consentsGranted) },
      { label: f.campaignsCapped ? `Campañas enviadas (de las últimas ${f.campaignsCapped})` : "Campañas enviadas", value: intFmt.format(f.campaignsSent) },
      { label: "Apertura de la última campaña", value: f.lastOpenRate == null ? NO_DATA : pct(f.lastOpenRate) },
    ],
  };
}

function seoBody(f: SeoFacts, href: string): ModuleBody {
  const checks: MarketingCheck[] = [
    { label: "Google Search Console conectado (cuenta de servicio de tu empresa)", done: f.searchConsoleConnected },
    { label: "Palabras clave dadas de alta", done: f.keywords > 0 },
    { label: "Datos de Search Console importados", done: f.searchConsoleImported },
    { label: "Auditoría de tu web hecha", done: f.auditDone },
    { label: "Reseñas de Google Business Profile o TripAdvisor conectadas", done: f.reviewsConnected, optional: true },
  ];
  const nextStep = !f.searchConsoleConnected
    ? { label: "Conecta Search Console en Integraciones (mientras tanto, puedes anotar posiciones a mano)", href: INTEGRATIONS_HREF }
    : f.keywords === 0
      ? { label: "Da de alta tus palabras clave y la página que debe posicionar cada una", href: `${href}?tab=palabras` }
      : !f.searchConsoleImported
        ? { label: "Importa clics, impresiones y posiciones de Search Console", href: `${href}?tab=gsc` }
        : !f.auditDone
          ? { label: "Audita las páginas de tu web", href: `${href}?tab=auditoria` }
          : { label: "Revisa la evolución de tus posiciones y los avisos", href };
  return {
    checks,
    nextStep,
    ready: f.searchConsoleConnected && f.keywords > 0,
    figures: [
      { label: "Palabras clave", value: intFmt.format(f.keywords) },
      { label: "En el top 10", value: intFmt.format(f.top10) },
      { label: "Posición media", value: f.averagePosition == null ? NO_DATA : dec1(f.averagePosition) },
    ],
  };
}

function geoBody(f: GeoFacts, href: string, today: string): ModuleBody {
  const stale = f.lastObservedOn != null && daysBetween(f.lastObservedOn, today) > GEO_STALE_DAYS;
  const checks: MarketingCheck[] = [
    { label: "Tu marca configurada (nombre, web, sector y zona)", done: f.brandConfigured },
    { label: "Consultas definidas", done: f.queries > 0 },
    { label: "Observaciones anotadas en los asistentes de IA", done: f.observations > 0 },
  ];
  const nextStep = !f.brandConfigured
    ? { label: "Configura tu marca: nombre, web, sector y zona", href: `${href}?tab=ajustes` }
    : f.queries === 0
      ? { label: "Define las consultas de tu sector (puedes partir de la plantilla)", href: `${href}?tab=consultas` }
      : f.observations === 0
        ? { label: "Anota tu primera observación en un asistente de IA", href: `${href}?tab=observaciones` }
        : stale
          ? { label: `Anota observaciones nuevas: la última es del ${dayLabel(f.lastObservedOn!)}`, href: `${href}?tab=observaciones` }
          : { label: "Revisa tu presencia y las oportunidades de mejora", href: `${href}?tab=oportunidades` };
  return {
    checks,
    nextStep,
    ready: f.brandConfigured && f.queries > 0 && f.observations > 0,
    figures: [
      { label: "Consultas activas", value: intFmt.format(f.queries) },
      { label: "Última observación", value: f.lastObservedOn ? dayLabel(f.lastObservedOn) : NO_DATA },
      { label: "Presencia de tu marca (90 días)", value: f.presenceRate == null ? NO_DATA : pct(f.presenceRate) },
    ],
  };
}

function bodyOf<K extends MarketingModuleId>(id: K, facts: FactsById[K], href: string, today: string): ModuleBody {
  switch (id) {
    case "ads":
      return adsBody(facts as AdsFacts, href);
    case "campaigns":
      return campaignsBody(facts as CampaignsFacts, href);
    case "seo":
      return seoBody(facts as SeoFacts, href);
    default:
      return geoBody(facts as GeoFacts, href, today);
  }
}

/** Resumen del paquete a partir del estado de licencia y los datos de cada módulo. `today`: AAAA-MM-DD (Madrid). */
export function marketingPackSummary(input: MarketingPackInput, today: string): MarketingPackSummary {
  const modules = MARKETING_PACK_MODULES.map((m): MarketingModuleView => {
    const base = { id: m.id, name: m.name, capability: m.capability, description: m.description, href: m.href };
    const inp = input[m.id] as ModuleInput<FactsById[typeof m.id]>;
    if (inp.licence === null) {
      return { ...base, state: "not_included", stateLabel: MODULE_STATE_LABEL.not_included, readOnly: false, checks: [], figures: [], nextStep: { label: `Añade ${m.name} o el Paquete Marketing`, href: UPGRADE_HREF }, message: null };
    }
    const readOnly = inp.licence === "read_only";
    if (inp.licence === "unknown") {
      return { ...base, state: "unavailable", stateLabel: MODULE_STATE_LABEL.unavailable, readOnly: false, checks: [], figures: [], nextStep: null, message: "error" in inp ? inp.error : null };
    }
    const roMessage = readOnly ? "Tu licencia está en solo lectura: puedes consultar los datos, pero no cambiar la configuración." : null;
    if ("error" in inp) {
      return { ...base, state: "unavailable", stateLabel: MODULE_STATE_LABEL.unavailable, readOnly, checks: [], figures: [], nextStep: { label: `Abrir ${m.name}`, href: m.href }, message: inp.error };
    }
    const b = bodyOf(m.id, inp.facts, m.href, today);
    const required = b.checks.filter((c) => !c.optional);
    const state: MarketingModuleState = b.ready ? "ready" : required.some((c) => c.done) ? "in_progress" : "to_start";
    // En solo lectura no se propone configurar nada: solo consultar
    const nextStep = readOnly ? { label: `Consulta los datos de ${m.name}`, href: m.href } : b.nextStep;
    return { ...base, state, stateLabel: MODULE_STATE_LABEL[state], readOnly, checks: b.checks, figures: b.figures, nextStep, message: roMessage };
  });
  const included = modules.filter((m) => m.state !== "not_included").length;
  return { modules, included, ready: modules.filter((m) => m.state === "ready").length, complete: included === MARKETING_PACK_MODULES.length };
}
