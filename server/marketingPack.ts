/**
 * Paquete Marketing · «Puesta en marcha y resumen» (namespace tRPC `marketingPack`, solo lectura).
 *
 * Reúne, para la empresa en curso, el estado real de los cuatro módulos del paquete reutilizando SUS servicios (sin
 * consultas paralelas): Ads Manager (`adsManagerService().connections/dashboard/campaigns`), Campaigns
 * (`brevoMarketingService().status` y `campaignService().list`), SEO Control (`seoControlDb.connectors/dashboard`) y GEO
 * Control (`geoControlDb.getSettings/listQueries/dashboard`). Cada bloque se lee SOLO si su capacidad está concedida
 * (activa o en solo lectura); el resto sale «No incluido». Sin ninguna de las cuatro, 403.
 *
 * Nunca devuelve secretos: de las credenciales solo se sabe si están (booleanos), nunca su valor, la propiedad de Search
 * Console, la ficha de Google ni los identificadores de píxel. Los errores de un módulo (p. ej. su migración aún sin
 * aplicar) no tumban el resumen: ese módulo sale «No disponible ahora» con un mensaje sin detalles internos.
 */
import { TRPCError } from "@trpc/server";
import {
  MARKETING_PACK_MODULES,
  marketingPackSummary,
  type AdsFacts,
  type CampaignsFacts,
  type FactsById,
  type GeoFacts,
  type MarketingModuleId,
  type MarketingPackInput,
  type MarketingPackSummary,
  type ModuleInput,
  type ModuleLicence,
  type SeoFacts,
} from "../shared/marketingPack";

export interface MarketingPackDeps {
  /** Estado de la licencia de una capacidad para la empresa en curso (solo lectura). */
  licence: (capability: string) => Promise<ModuleLicence>;
  facts: { [K in MarketingModuleId]: () => Promise<FactsById[K]> };
  /** Hoy (AAAA-MM-DD, Madrid). */
  today: () => string;
}

/** Mensajes que se pueden enseñar tal cual (los del propio módulo: falta su migración, instalación única…). */
function safeMessage(e: unknown, name: string): string {
  if (e instanceof TRPCError && (e.code === "PRECONDITION_FAILED" || e.code === "FORBIDDEN")) return e.message;
  if (e instanceof Error && (e.name === "BrevoNotInstalled" || e.name === "CampaignsNotInstalled")) return `${e.message}. Inténtalo de nuevo en unos minutos.`;
  return `No se ha podido leer el estado de ${name} ahora mismo. Ábrelo para revisarlo o inténtalo de nuevo en unos minutos.`;
}

export async function getMarketingPackSummary(deps: MarketingPackDeps): Promise<MarketingPackSummary> {
  const licences = await Promise.all(MARKETING_PACK_MODULES.map((m) => deps.licence(m.capability).catch((): ModuleLicence => null)));
  if (licences.every((l) => l === null)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Ningún módulo del Paquete Marketing está incluido en tu plan." });
  }
  const entries = await Promise.all(
    MARKETING_PACK_MODULES.map(async (m, i): Promise<[MarketingModuleId, ModuleInput<unknown>]> => {
      const licence = licences[i];
      if (licence === null) return [m.id, { licence: null }];
      try {
        return [m.id, { licence, facts: await deps.facts[m.id]() }];
      } catch (e) {
        // Sin el detalle en la respuesta; en el registro, solo el tipo de error
        console.warn(JSON.stringify({ ctx: "MarketingPack", event: "module_facts_failed", module: m.id, error: e instanceof TRPCError ? e.code : e instanceof Error ? e.name : "unknown" }));
        return [m.id, { licence, error: safeMessage(e, m.name) }];
      }
    }),
  );
  return marketingPackSummary(Object.fromEntries(entries) as MarketingPackInput, deps.today());
}

// ─── Lecturas de cada módulo con sus servicios existentes ────────────────────────────────────────────────────────────

export async function readAdsFacts(): Promise<AdsFacts> {
  const { adsManagerService } = await import("./adsManager/runtime");
  const svc = adsManagerService();
  const [conn, dash, campaigns] = await Promise.all([svc.connections(), svc.dashboard({ days: 30 }), svc.campaigns(false)]);
  return {
    metaConnected: conn.meta,
    googleConnected: conn.google,
    csvImported: campaigns.some((c) => c.source === "csv"),
    campaigns: campaigns.length,
    spendCents: dash.totals.spendCents,
    sales: dash.totals.sales,
    roas: dash.totals.kpis.roas,
    currency: dash.currencies.length === 1 ? dash.currencies[0]! : "EUR",
  };
}

export async function readCampaignsFacts(): Promise<CampaignsFacts> {
  const [{ brevoMarketingService }, { campaignService }] = await Promise.all([import("./brevoMarketing/runtime"), import("./connectCampaigns/runtime")]);
  const [status, list] = await Promise.all([brevoMarketingService().status(), campaignService().list()]);
  const sent = list.filter((c) => c.status === "sent");
  const withStats = sent.filter((c) => c.stats && c.stats.delivered > 0).sort((a, b) => String(b.sentAt ?? "").localeCompare(String(a.sentAt ?? "")));
  const last = withStats[0];
  return {
    brevoConnected: status.connected,
    listName: status.listId != null ? (status.listName ?? `Lista ${status.listId}`) : null,
    consentsGranted: status.consents.granted,
    lastSync: status.lastRun ? { status: status.lastRun.status, finishedAt: status.lastRun.finishedAt } : null,
    campaignsSent: sent.length,
    lastOpenRate: last?.stats ? Math.min(1, last.stats.opens / last.stats.delivered) : null,
  };
}

export async function readSeoFacts(): Promise<SeoFacts> {
  const seo = await import("./seoControlDb");
  const { SEO_PROVIDERS } = await import("../shared/seoControl");
  const [connectors, dash] = await Promise.all([seo.connectors(), seo.dashboard({ days: 90 })]);
  const of = (p: string) => connectors.find((c) => c.provider === p);
  const gsc = of(SEO_PROVIDERS.gsc);
  return {
    searchConsoleConnected: gsc?.state === "configured",
    searchConsoleImported: gsc?.lastRun?.status === "ok",
    reviewsConnected: of(SEO_PROVIDERS.gbp)?.state === "configured" || of(SEO_PROVIDERS.tripadvisor)?.state === "configured",
    keywords: dash.keywords.active,
    top10: dash.keywords.top10,
    averagePosition: dash.keywords.averagePosition,
    auditDone: !!dash.audit?.finishedAt,
  };
}

export async function readGeoFacts(): Promise<GeoFacts> {
  const geo = await import("./geoControlDb");
  const [settings, queries, dash] = await Promise.all([geo.getSettings(), geo.listQueries(false), geo.dashboard({ days: 90, granularity: "month" })]);
  const days = queries.map((q) => (q.lastObservedOn ? q.lastObservedOn.slice(0, 10) : null)).filter((d): d is string => !!d).sort();
  return {
    brandConfigured: settings.configured,
    queries: queries.length,
    observations: queries.reduce((s, q) => s + q.observations, 0),
    lastObservedOn: days.length ? days[days.length - 1]! : null,
    presenceRate: dash.visibility.total.presenceRate,
  };
}

export async function defaultMarketingPackDeps(): Promise<MarketingPackDeps> {
  const [{ getCapabilityAccess }, { todayMadrid }] = await Promise.all([import("./_core/capabilities/access"), import("./geoControlDb")]);
  return {
    licence: async (cap) => {
      const d = await getCapabilityAccess().check(cap, { write: false });
      if (!d.allowed) return null;
      return d.status === "read_only" ? "read_only" : "active";
    },
    facts: { ads: readAdsFacts, campaigns: readCampaignsFacts, seo: readSeoFacts, geo: readGeoFacts },
    today: () => todayMadrid(),
  };
}
