/**
 * Elephant Ads Manager (capacidad `ads-manager`) — casos de uso. Lógica pura en shared/adsManager.ts, conectores de
 * solo lectura en ./connectors.ts y SQL en ./store.ts; procedimientos en ./router.ts; tarea diaria en ./job.ts;
 * pantalla en /admin/marketing/ads.
 *
 *  - Todo en la BD de la empresa en curso, con SUS credenciales de la bóveda (`meta`: cuenta publicitaria y clave de
 *    lectura —o la de la Conversions API si tiene el permiso—; `google_ads`). Sin credenciales, la conexión está
 *    desactivada y el panel funciona con los CSV de los informes de cada plataforma. Nunca una cuenta de otra empresa
 *    ni del entorno de la instalación: en la instalación única Ads Manager no se sirve.
 *  - Solo lectura en las plataformas: nunca se crean ni se modifican campañas.
 *  - Importación: rango [desde, hasta] con upsert por (campaña, día); la primera vez, 90 días; después, los últimos 7
 *    (las plataformas corrigen las conversiones de días anteriores). Un fallo NUNCA deja gasto 0: queda la
 *    importación como fallida, con su causa en lenguaje claro.
 *  - Ventas: reservas válidas del Core con su etiqueta de origen (CSV de transacciones o a mano). El Core aún no
 *    guarda los UTM en la reserva; sí guarda el clic de Meta (`fbc`), que cuenta para el canal, no para una campaña.
 */
import { TRPCError } from "@trpc/server";
import {
  ADS_ERROR_LABELS,
  ADS_PLATFORMS,
  ADS_PLATFORM_SHORT,
  ZERO_TOTALS,
  addDays,
  addTotals,
  attributeSales,
  chunkRange,
  computeAlerts,
  computeKpis,
  csvExternalId,
  daysBetween,
  isDay,
  needsHumanAction,
  parseAdsCsv,
  parseSaleTagsCsv,
  todayMadrid,
  trackingChecks,
  type AdsDailyRow,
  type AdsErrorKind,
  type AdsPlatform,
  type AdsTotals,
  type AttributableCampaign,
  type SaleTag,
} from "../../shared/adsManager";
import { fetchGoogleDaily, fetchMetaDaily, type AdsFetch, type AdsFetchResult, type GoogleCreds, type MetaCreds } from "./connectors";
import * as store from "./store";
import type { Exec } from "./store";

export const ADS_CAPABILITY = "ads-manager";
export const ADS_NOT_INSTALLED_MESSAGE = "Ads Manager aún no está preparado en tu empresa: falta aplicar la actualización 0055_connect_ads_manager de su base de datos. Inténtalo de nuevo en unos minutos.";
export const FIRST_SYNC_DAYS = 90;
export const INCREMENTAL_DAYS = 7;
export const MAX_RANGE_DAYS = 730;
const CHUNK_DAYS = 30;

export interface AdsActor {
  userId: number;
  role: string;
}

export interface AdsDeps {
  exec: () => Promise<Exec>;
  /** Credenciales de la bóveda de la empresa en curso. */
  vault: (provider: "meta" | "google_ads") => Promise<Record<string, string>>;
  /** Ajustes de la web de la empresa (píxel y GA4). */
  setting: (key: string) => Promise<string>;
  fetch: AdsFetch;
  /** Identificador de la empresa en curso (para no lanzar dos importaciones a la vez de la misma). */
  tenantKey: () => string;
  licensed: () => Promise<boolean>;
  now?: () => Date;
}

const bad = (message: string) => new TRPCError({ code: "BAD_REQUEST", message });
const notFound = (what: string) => new TRPCError({ code: "NOT_FOUND", message: `${what} no existe o ya no está disponible.` });
function writer(actor: AdsActor) {
  if (actor.role === "readonly") throw new TRPCError({ code: "FORBIDDEN", message: "Tu acceso es de solo lectura." });
}

/** Comienzo del día en Madrid, en milisegundos (las reservas guardan `created_at` en milisegundos). */
export function madridDayStartMs(day: string): number {
  const noon = new Date(`${day}T12:00:00Z`);
  const h = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Madrid", hour: "2-digit", hour12: false }).format(noon));
  return Date.parse(`${day}T00:00:00Z`) - (h - 12) * 3_600_000;
}

const running = new Set<string>();

export class AdsManagerService {
  constructor(private readonly d: AdsDeps) {}

  private today() {
    return todayMadrid(this.d.now?.() ?? new Date());
  }

  private async db<T>(fn: (exec: Exec) => Promise<T>): Promise<T> {
    const exec = await this.d.exec();
    try {
      return await fn(exec);
    } catch (e) {
      if (store.isMissingAdsSchema(e)) throw new TRPCError({ code: "PRECONDITION_FAILED", message: ADS_NOT_INSTALLED_MESSAGE, cause: e });
      throw e;
    }
  }

  // ─── Credenciales ───────────────────────────────────────────────────────────

  async metaCreds(): Promise<MetaCreds | null> {
    const v = await this.d.vault("meta");
    const token = v.adsAccessToken || v.capiAccessToken;
    if (!v.adAccountId || !token) return null;
    return { adAccountId: v.adAccountId, accessToken: token };
  }
  async googleCreds(): Promise<GoogleCreds | null> {
    const v = await this.d.vault("google_ads");
    if (!v.customerId || !v.developerToken || !v.clientId || !v.clientSecret || !v.refreshToken) return null;
    return { customerId: v.customerId, loginCustomerId: v.loginCustomerId || undefined, developerToken: v.developerToken, clientId: v.clientId, clientSecret: v.clientSecret, refreshToken: v.refreshToken };
  }
  private async fetchPlatform(platform: AdsPlatform, since: string, until: string, signal?: AbortSignal): Promise<AdsFetchResult> {
    if (platform === "meta") {
      const c = await this.metaCreds();
      return c ? fetchMetaDaily(c, since, until, this.d.fetch, signal) : { ok: false, error: { kind: "CONFIG_MISSING", message: "Meta Ads no está conectado: faltan la cuenta publicitaria o su clave de lectura." } };
    }
    const c = await this.googleCreds();
    return c ? fetchGoogleDaily(c, since, until, this.d.fetch, signal) : { ok: false, error: { kind: "CONFIG_MISSING", message: "Google Ads no está conectado: faltan datos de la conexión." } };
  }

  // ─── Importación por API ────────────────────────────────────────────────────

  /**
   * Importa [since, until] de una plataforma (por tramos de 30 días). Sin rango: 90 días la primera vez y los últimos
   * 7 después. Un error que necesita una acción humana (clave, permisos, configuración) corta el resto de tramos.
   */
  async sync(platform: AdsPlatform, o: { trigger: "manual" | "cron"; actor?: AdsActor; since?: string; until?: string; signal?: AbortSignal }) {
    if (o.actor) writer(o.actor);
    const today = this.today();
    const until = o.until ?? today;
    if ((o.since && !isDay(o.since)) || !isDay(until)) throw bad("Las fechas no son válidas.");
    if (until > today) throw bad("No se pueden importar días futuros.");
    // Sin credenciales propias la conexión está desactivada: no se registra ninguna importación
    if (!(platform === "meta" ? await this.metaCreds() : await this.googleCreds())) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: `${ADS_PLATFORM_SHORT[platform]} no está conectado: configúralo en Integraciones y pagos o sube su informe en CSV.` });
    }
    const key = `${this.d.tenantKey()}:${platform}`;
    if (running.has(key)) throw new TRPCError({ code: "CONFLICT", message: `Ya hay una importación de ${ADS_PLATFORM_SHORT[platform]} en curso.` });
    running.add(key);
    try {
      return await this.db(async (exec) => {
        const state = await store.apiSyncState(exec, platform);
        if (state.running) throw new TRPCError({ code: "CONFLICT", message: `Ya hay una importación de ${ADS_PLATFORM_SHORT[platform]} en curso.` });
        const since = o.since ?? addDays(until, -((state.lastOk ? INCREMENTAL_DAYS : FIRST_SYNC_DAYS) - 1));
        if (since > until) throw bad("La fecha de inicio es posterior a la de fin.");
        if (daysBetween(since, until) > MAX_RANGE_DAYS) throw bad(`Como mucho ${MAX_RANGE_DAYS} días por importación.`);
        const runId = await store.startRun(exec, { platform, kind: "api", trigger: o.trigger, rangeStart: since, rangeEnd: until, userId: o.actor?.userId ?? null });
        let upserted = 0;
        try {
          for (const ch of chunkRange(since, until, CHUNK_DAYS)) {
            const r = await this.fetchPlatform(platform, ch.since, ch.until, o.signal);
            if (!r.ok) {
              await store.finishRun(exec, runId, { status: "failed", rowsUpserted: upserted, errorKind: r.error.kind, errorMessage: r.error.message });
              return { ok: false as const, runId, rowsUpserted: upserted, error: { kind: r.error.kind, label: ADS_ERROR_LABELS[r.error.kind], message: r.error.message, needsAction: needsHumanAction(r.error.kind) } };
            }
            upserted += await this.saveRows(exec, platform, r.rows, "api", runId, r.accountId);
          }
          await store.finishRun(exec, runId, { status: "ok", rowsUpserted: upserted });
          return { ok: true as const, runId, rowsUpserted: upserted, since, until };
        } catch (e) {
          // Nunca una importación «en curso» para siempre si falla la BD a mitad
          await store.finishRun(exec, runId, { status: "failed", rowsUpserted: upserted, errorKind: "INTERNAL_ERROR", errorMessage: "Error al guardar los datos importados." }).catch(() => undefined);
          throw e;
        }
      });
    } finally {
      running.delete(key);
    }
  }

  /** Alta de campañas y upsert de sus filas diarias. Las del CSV sin identificador se unen por nombre a la existente. */
  private async saveRows(exec: Exec, platform: AdsPlatform, list: AdsDailyRow[], source: "api" | "csv", runId: number, accountId: string | null): Promise<number> {
    const ids = new Map<string, number>();
    const metrics: store.MetricRow[] = [];
    for (const r of list) {
      const k = r.externalId ?? `name:${r.name}`;
      let id = ids.get(k);
      if (id == null) {
        let externalId = r.externalId;
        if (!externalId) externalId = (await store.findCampaignByName(exec, platform, r.name))?.externalId ?? csvExternalId(r.name);
        id = await store.upsertCampaign(exec, { platform, externalId, accountId, name: r.name, currency: r.currency ?? "EUR", source, utmCampaign: r.utmCampaign ?? null });
        ids.set(k, id);
      }
      metrics.push({ campaignId: id, day: r.day, spendCents: r.spendCents, impressions: r.impressions, clicks: r.clicks, conversions: r.conversions, conversionValueCents: r.conversionValueCents });
    }
    // Un mismo (campaña, día) repetido en un CSV: se suma (p. ej. varias filas por conjunto de anuncios)
    const merged = new Map<string, store.MetricRow>();
    for (const m of metrics) {
      const k = `${m.campaignId}|${m.day}`;
      const prev = merged.get(k);
      if (!prev) merged.set(k, { ...m });
      else {
        prev.spendCents += m.spendCents;
        prev.impressions += m.impressions;
        prev.clicks += m.clicks;
        prev.conversions = prev.conversions == null && m.conversions == null ? null : (prev.conversions ?? 0) + (m.conversions ?? 0);
        prev.conversionValueCents = prev.conversionValueCents == null && m.conversionValueCents == null ? null : (prev.conversionValueCents ?? 0) + (m.conversionValueCents ?? 0);
      }
    }
    return store.upsertMetrics(exec, Array.from(merged.values()), source, runId);
  }

  // ─── Importación por CSV ────────────────────────────────────────────────────

  async importAdsCsv(input: { platform: AdsPlatform; text: string; fileName?: string | null }, actor: AdsActor) {
    writer(actor);
    const parsed = parseAdsCsv(input.text, input.platform);
    if (!parsed.rows.length) throw bad(parsed.problems[0] ?? "El archivo no tiene filas válidas.");
    const future = parsed.rows.filter((r) => r.day > this.today()).length;
    const valid = parsed.rows.filter((r) => r.day <= this.today());
    return this.db(async (exec) => {
      const runId = await store.startRun(exec, { platform: input.platform, kind: "csv", trigger: "manual", fileName: input.fileName?.slice(0, 190) ?? null, userId: actor.userId });
      try {
        const n = await this.saveRows(exec, input.platform, valid, "csv", runId, null);
        const days = valid.map((r) => r.day).sort();
        await store.finishRun(exec, runId, { status: "ok", rowsUpserted: n, rowsSkipped: parsed.skipped + future, rangeStart: days[0], rangeEnd: days[days.length - 1] });
        return { runId, rows: n, skipped: parsed.skipped + future, campaigns: new Set(valid.map((r) => r.externalId ?? r.name)).size, from: days[0] ?? null, to: days[days.length - 1] ?? null, problems: parsed.problems, detectedPlatform: parsed.platform };
      } catch (e) {
        await store.finishRun(exec, runId, { status: "failed", errorKind: "INTERNAL_ERROR", errorMessage: "Error al guardar el archivo." }).catch(() => undefined);
        throw e;
      }
    });
  }

  /** CSV de ventas etiquetadas: cada referencia se busca en las reservas de la empresa (localizador o pedido). */
  async importSaleTagsCsv(input: { text: string; fileName?: string | null }, actor: AdsActor) {
    writer(actor);
    const parsed = parseSaleTagsCsv(input.text);
    if (!parsed.rows.length) throw bad(parsed.problems[0] ?? "El archivo no tiene ventas con su origen.");
    return this.db(async (exec) => {
      const found = await store.findReservationsByReference(exec, Array.from(new Set(parsed.rows.map((r) => r.reference))));
      const tags = parsed.rows.filter((r) => found.has(r.reference)).map((r) => ({ ...strip(r), reservationId: found.get(r.reference)! }));
      const unknown = Array.from(new Set(parsed.rows.filter((r) => !found.has(r.reference)).map((r) => r.reference)));
      const runId = await store.startRun(exec, { platform: "core", kind: "tags", trigger: "manual", fileName: input.fileName?.slice(0, 190) ?? null, userId: actor.userId });
      const n = await store.upsertSaleTags(exec, tags, "csv", runId, actor.userId);
      await store.finishRun(exec, runId, { status: "ok", rowsUpserted: n, rowsSkipped: parsed.skipped + unknown.length });
      return { tagged: n, unknownReferences: unknown.slice(0, 20), unknownCount: unknown.length, skipped: parsed.skipped };
    });
  }

  async tagSale(input: { reference: string } & SaleTag, actor: AdsActor) {
    writer(actor);
    const ref = input.reference.trim().replace(/^#/, "");
    if (!/^[A-Za-z0-9_./-]{1,40}$/.test(ref)) throw bad("La referencia no es válida.");
    const tag = strip(input);
    if (!tag.utmCampaign && !tag.gclid && !tag.fbclid && !tag.utmSource) throw bad("Indica al menos la campaña (utm_campaign) o el origen.");
    return this.db(async (exec) => {
      const id = (await store.findReservationsByReference(exec, [ref])).get(ref);
      if (!id) throw notFound("La reserva");
      await store.upsertSaleTags(exec, [{ ...tag, reservationId: id }], "manual", null, actor.userId);
      return { reservationId: id };
    });
  }

  // ─── Campañas, presupuestos y ajustes ───────────────────────────────────────

  async setCampaignUtm(id: number, utm: string | null, actor: AdsActor) {
    writer(actor);
    const v = utm?.trim() ? utm.trim().slice(0, 160) : null;
    return this.db(async (exec) => {
      if (!(await store.setCampaignUtm(exec, id, v))) throw notFound("La campaña");
      return { id, utmCampaign: v };
    });
  }
  async setCampaignArchived(id: number, archived: boolean, actor: AdsActor) {
    writer(actor);
    return this.db(async (exec) => {
      if (!(await store.setCampaignArchived(exec, id, archived))) throw notFound("La campaña");
      return { id, archived };
    });
  }

  async budgets() {
    return this.db(async (exec) => store.listBudgets(exec));
  }
  async saveBudget(input: { scope: "total" | "platform" | "campaign"; platform?: AdsPlatform | null; campaignId?: number | null; monthlyCents: number }, actor: AdsActor) {
    writer(actor);
    if (!Number.isInteger(input.monthlyCents) || input.monthlyCents <= 0 || input.monthlyCents > 1e11) throw bad("El presupuesto debe ser un importe mayor que cero.");
    return this.db(async (exec) => {
      let scopeKey = "total";
      let platform: AdsPlatform | null = null;
      let campaignId: number | null = null;
      if (input.scope === "platform") {
        if (!input.platform || !ADS_PLATFORMS.includes(input.platform)) throw bad("Elige la plataforma.");
        platform = input.platform;
        scopeKey = `platform:${platform}`;
      } else if (input.scope === "campaign") {
        const c = input.campaignId ? await store.getCampaign(exec, input.campaignId) : null;
        if (!c) throw notFound("La campaña");
        campaignId = c.id;
        platform = c.platform;
        scopeKey = `campaign:${c.id}`;
      }
      await store.upsertBudget(exec, { scopeKey, scope: input.scope, platform, campaignId, monthlyCents: input.monthlyCents }, actor.userId);
      return { scopeKey };
    });
  }
  async archiveBudget(id: number, actor: AdsActor) {
    writer(actor);
    return this.db(async (exec) => {
      if (!(await store.archiveBudget(exec, id, actor.userId))) throw notFound("El presupuesto");
      return { id };
    });
  }

  async settings() {
    return this.db((exec) => store.getSettings(exec));
  }
  async saveSettings(s: store.AdsSettings, actor: AdsActor) {
    writer(actor);
    if (s.noConvDays < 3 || s.noConvDays > 90) throw bad("El periodo de la alerta debe estar entre 3 y 90 días.");
    if (s.noConvMinSpendCents < 0 || s.noConvMinSpendCents > 1e9) throw bad("El gasto mínimo de la alerta no es válido.");
    return this.db(async (exec) => {
      await store.saveSettings(exec, s, actor.userId);
      return store.getSettings(exec);
    });
  }

  // ─── Estado de conexiones y medición ────────────────────────────────────────

  async connections() {
    const [meta, google, metaVault] = await Promise.all([this.metaCreds(), this.googleCreds(), this.d.vault("meta")]);
    const [pixel, ga4] = await Promise.all([this.d.setting("analytics_meta_pixel_id"), this.d.setting("analytics_ga4_id")]);
    return {
      meta: !!meta,
      google: !!google,
      capiToken: !!metaVault.capiAccessToken,
      metaPixelId: /^\d{6,20}$/.test(pixel.trim()) ? pixel.trim() : null,
      ga4Id: /^G-[A-Z0-9]{4,20}$/.test(ga4.trim()) ? ga4.trim() : null,
    };
  }

  // ─── Panel ──────────────────────────────────────────────────────────────────

  async dashboard(input: { from?: string; to?: string; days?: number }) {
    const today = this.today();
    const to = input.to && isDay(input.to) ? input.to : today;
    const from = input.from && isDay(input.from) ? input.from : addDays(to, -((input.days ?? 30) - 1));
    if (from > to) throw bad("La fecha de inicio es posterior a la de fin.");
    if (daysBetween(from, to) > MAX_RANGE_DAYS) throw bad(`Como mucho ${MAX_RANGE_DAYS} días.`);
    const conn = await this.connections();
    return this.db(async (exec) => {
      const settings = await store.getSettings(exec);
      const campaigns = await store.listCampaigns(exec);
      const fromMs = madridDayStartMs(from);
      const toMs = madridDayStartMs(addDays(to, 1));
      const [totals, daily, allTagged, core, metaClicks, budgets, currencies, metaState, googleState, runs] = await Promise.all([
        store.totalsByCampaign(exec, from, to),
        store.dailyByPlatform(exec, from, to),
        store.taggedSales(exec),
        store.salesInWindow(exec, fromMs, toMs),
        store.untaggedMetaClickSales(exec, fromMs, toMs),
        store.listBudgets(exec),
        store.currencies(exec),
        store.apiSyncState(exec, "meta"),
        store.apiSyncState(exec, "google"),
        store.recentRuns(exec, 15),
      ]);
      const attributable: AttributableCampaign[] = campaigns.map((c) => ({ id: c.id, platform: c.platform, externalId: c.externalId, name: c.name, utmCampaign: c.utmCampaign }));
      // «Alguna vez»: prueba de que el etiquetado de esa campaña funciona; sin ella, su ingreso es «sin datos»
      const ever = attributeSales(allTagged, attributable);
      const inWindow = allTagged.filter((s) => s.createdAtMs >= fromMs && s.createdAtMs < toMs);
      const att = attributeSales(inWindow, attributable);
      const totalOf = new Map(totals.map((t) => [t.campaignId, t]));

      const rowsOut = campaigns
        .filter((c) => !c.archived && (totalOf.has(c.id) || att.byCampaign.has(c.id)))
        .map((c) => {
          const t = totalOf.get(c.id);
          const tot: AdsTotals = t ? { spendCents: t.spendCents, impressions: t.impressions, clicks: t.clicks, conversions: t.conversions, conversionValueCents: t.conversionValueCents } : { ...ZERO_TOTALS };
          const reliable = ever.byCampaign.has(c.id);
          const a = att.byCampaign.get(c.id);
          const revenueCents = reliable ? (a?.revenueCents ?? 0) : null;
          const sales = reliable ? (a?.reservationIds.length ?? 0) : null;
          return {
            id: c.id,
            platform: c.platform,
            name: c.name,
            externalId: c.externalId.startsWith("nombre:") ? null : c.externalId,
            utmCampaign: c.utmCampaign,
            source: c.source,
            currency: c.currency,
            ...tot,
            revenueCents,
            sales,
            reliable,
            method: a?.method ?? null,
            kpis: computeKpis(tot, { revenueCents, sales }),
          };
        })
        .sort((a, b) => b.spendCents - a.spendCents);

      const byPlatform = ADS_PLATFORMS.map((p) => {
        const list = rowsOut.filter((r) => r.platform === p);
        const tot = list.reduce<AdsTotals>((acc, r) => addTotals(acc, r), { ...ZERO_TOTALS });
        const campaignRevenue = list.reduce((s, r) => s + (r.revenueCents ?? 0), 0);
        const campaignSales = list.reduce((s, r) => s + (r.sales ?? 0), 0);
        const un = att.unmatchedByChannel.get(p) ?? { sales: 0, revenueCents: 0 };
        const clicks = p === "meta" ? metaClicks : { sales: 0, revenueCents: 0 };
        const channelSales = campaignSales + un.sales + clicks.sales;
        const channelRevenue = campaignRevenue + un.revenueCents + clicks.revenueCents;
        const anyEvidence = list.some((r) => r.reliable) || channelSales > 0;
        const revenueCents = anyEvidence ? channelRevenue : null;
        const sales = anyEvidence ? channelSales : null;
        return { platform: p, ...tot, campaigns: list.length, revenueCents, sales, campaignRevenueCents: campaignRevenue, unattributed: { sales: un.sales + clicks.sales, revenueCents: un.revenueCents + clicks.revenueCents }, kpis: computeKpis(tot, { revenueCents, sales }) };
      });
      const all = byPlatform.reduce<AdsTotals>((acc, r) => addTotals(acc, r), { ...ZERO_TOTALS });
      const anyRevenue = byPlatform.some((p) => p.revenueCents != null);
      const revenueCents = anyRevenue ? byPlatform.reduce((s, p) => s + (p.revenueCents ?? 0), 0) : null;
      const sales = anyRevenue ? byPlatform.reduce((s, p) => s + (p.sales ?? 0), 0) : null;

      // Presupuestos: gasto del mes en curso
      const monthStart = `${today.slice(0, 8)}01`;
      const monthTotals = await store.totalsByCampaign(exec, monthStart, today);
      const campaignById = new Map(campaigns.map((c) => [c.id, c]));
      const spentOf = (pred: (campaignId: number) => boolean) => monthTotals.filter((t) => pred(t.campaignId)).reduce((s, t) => s + t.spendCents, 0);
      const budgetView = budgets.map((b) => {
        const spent = b.scope === "total" ? spentOf(() => true) : b.scope === "platform" ? spentOf((id) => campaignById.get(id)?.platform === b.platform) : spentOf((id) => id === b.campaignId);
        const label = b.scope === "total" ? "Todas las campañas" : b.scope === "platform" ? ADS_PLATFORM_SHORT[b.platform!] : (campaignById.get(b.campaignId!)?.name ?? `Campaña ${b.campaignId}`);
        return { ...b, label, spentCents: spent };
      });

      // Alertas: campañas sin conversiones en el periodo de la alerta
      const recentFrom = addDays(today, -(settings.noConvDays - 1));
      const recentTotals = await store.totalsByCampaign(exec, recentFrom, today);
      const recentFromMs = madridDayStartMs(recentFrom);
      const recentAtt = attributeSales(allTagged.filter((s) => s.createdAtMs >= recentFromMs), attributable);
      const usesMeta = campaigns.some((c) => c.platform === "meta") || conn.meta;
      const usesGoogle = campaigns.some((c) => c.platform === "google") || conn.google;
      const tracking = trackingChecks({ metaPixelId: conn.metaPixelId, capiToken: conn.capiToken, ga4Id: conn.ga4Id, metaAds: conn.meta, googleAds: conn.google, usesMeta, usesGoogle });
      const syncView = [
        { platform: "meta" as const, configured: conn.meta, s: metaState },
        { platform: "google" as const, configured: conn.google, s: googleState },
      ].map(({ platform, configured, s }) => ({
        platform,
        configured,
        lastOkAt: s.lastOk?.finishedAt ?? null,
        lastOkRange: s.lastOk ? { from: s.lastOk.rangeStart, to: s.lastOk.rangeEnd } : null,
        lastError: s.lastFailed ? { kind: (s.lastFailed.errorKind ?? "INTERNAL_ERROR") as AdsErrorKind, message: s.lastFailed.errorMessage ?? "", at: s.lastFailed.finishedAt ?? s.lastFailed.startedAt ?? "" } : null,
        running: !!s.running,
      }));
      const alerts = computeAlerts({
        today,
        budgets: budgetView.map((b) => ({ scopeKey: b.scopeKey, label: b.label, monthlyCents: b.monthlyCents, spentCents: b.spentCents })),
        recent: recentTotals
          .map((t) => ({ t, c: campaignById.get(t.campaignId) }))
          .filter((x) => x.c && !x.c.archived)
          .map(({ t, c }) => ({ campaignId: t.campaignId, name: c!.name, platform: c!.platform, spendCents: t.spendCents, conversions: t.conversions, sales: recentAtt.byCampaign.get(t.campaignId)?.reservationIds.length ?? 0 })),
        noConvMinSpendCents: settings.noConvMinSpendCents,
        noConvDays: settings.noConvDays,
        sync: syncView.map((s) => ({ platform: s.platform, configured: s.configured, lastOkAt: s.lastOkAt, lastError: s.lastError })),
        tracking,
        currencies,
      });

      return {
        range: { from, to },
        today,
        totals: { ...all, revenueCents, sales, kpis: computeKpis(all, { revenueCents, sales }) },
        coreSales: { sales: core.sales, revenueCents: core.revenueCents, tagged: core.tagged, metaClicks: metaClicks.sales },
        ambiguousSales: att.ambiguous,
        unknownChannel: att.unmatchedByChannel.get("unknown") ?? { sales: 0, revenueCents: 0 },
        byPlatform,
        campaigns: rowsOut,
        daily,
        budgets: budgetView,
        alerts,
        tracking,
        sync: syncView,
        runs,
        currencies,
        settings,
        hasData: campaigns.length > 0,
      };
    });
  }

  /** Lista para los selectores (presupuesto por campaña, código UTM). */
  async campaigns(includeArchived = false) {
    return this.db(async (exec) => (await store.listCampaigns(exec)).filter((c) => includeArchived || !c.archived));
  }

  // ─── Tarea diaria ───────────────────────────────────────────────────────────

  /** Por empresa: solo con la licencia, la migración, la importación automática encendida y alguna conexión. */
  async runScheduled(signal?: AbortSignal): Promise<{ skipped?: string; results?: Array<{ platform: AdsPlatform; ok: boolean; rows: number; error?: string }> }> {
    if (!(await this.d.licensed())) return { skipped: "sin_licencia" };
    let settings: store.AdsSettings;
    try {
      settings = await this.db((exec) => store.getSettings(exec));
    } catch (e) {
      if (e instanceof TRPCError && e.code === "PRECONDITION_FAILED") return { skipped: "sin_migracion" };
      throw e;
    }
    if (!settings.autoSync) return { skipped: "apagada" };
    const results: Array<{ platform: AdsPlatform; ok: boolean; rows: number; error?: string }> = [];
    for (const p of ADS_PLATFORMS) {
      if (signal?.aborted) break;
      const configured = p === "meta" ? await this.metaCreds() : await this.googleCreds();
      if (!configured) continue;
      try {
        const r = await this.sync(p, { trigger: "cron", signal });
        results.push({ platform: p, ok: r.ok, rows: r.rowsUpserted, error: r.ok ? undefined : r.error.kind });
      } catch (e) {
        results.push({ platform: p, ok: false, rows: 0, error: e instanceof TRPCError ? e.code : "INTERNAL_ERROR" });
      }
    }
    return results.length ? { results } : { skipped: "sin_conexion" };
  }
}

const strip = (t: SaleTag): SaleTag => ({
  utmSource: t.utmSource?.trim().slice(0, 120) || null,
  utmMedium: t.utmMedium?.trim().slice(0, 120) || null,
  utmCampaign: t.utmCampaign?.trim().slice(0, 160) || null,
  gclid: t.gclid?.trim().slice(0, 255) || null,
  fbclid: t.fbclid?.trim().slice(0, 255) || null,
});
