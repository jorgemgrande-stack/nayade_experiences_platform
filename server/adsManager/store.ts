/**
 * Elephant Ads Manager — acceso a datos en la BD de la empresa en curso (tablas `ads_*` de
 * db/migrations/0055_connect_ads_manager, fuera de `drizzle/schema.ts` a propósito). SQL siempre parametrizado
 * (plantilla `sql` de drizzle). Las ventas son las reservas del Core (`reservations`), solo lectura.
 */
import { sql, type SQL } from "drizzle-orm";
import type { AdsPlatform, SaleTag } from "../../shared/adsManager";

export interface Exec {
  execute(q: SQL): Promise<unknown>;
}

export async function rows<T = any>(exec: Exec, q: SQL): Promise<T[]> {
  const [r] = (await exec.execute(q)) as unknown as [T[]];
  return r;
}
async function header(exec: Exec, q: SQL): Promise<{ affectedRows: number; insertId: number }> {
  const [r] = (await exec.execute(q)) as unknown as [{ affectedRows: number; insertId: number }];
  return { affectedRows: r.affectedRows ?? 0, insertId: Number(r.insertId ?? 0) };
}
const num = (v: unknown) => Number(v ?? 0);
const numOrNull = (v: unknown) => (v == null ? null : Number(v));
const str = (v: unknown) => (v == null ? null : String(v));
const iso = (v: unknown) => (v == null ? null : v instanceof Date ? v.toISOString() : new Date(String(v).replace(" ", "T") + (String(v).includes("Z") ? "" : "Z")).toISOString());

/** Falta la migración 0055 (o una de sus tablas) en esta empresa. */
export function isMissingAdsSchema(e: unknown): boolean {
  for (let x: any = e, i = 0; x && i < 6; x = x.cause, i++) {
    if ((x.code === "ER_NO_SUCH_TABLE" || x.errno === 1146) && /ads_/.test(String(x.sqlMessage ?? x.message ?? ""))) return true;
  }
  return false;
}

// ─── Ajustes ──────────────────────────────────────────────────────────────────

export interface AdsSettings {
  autoSync: boolean;
  noConvMinSpendCents: number;
  noConvDays: number;
}
export const DEFAULT_SETTINGS: AdsSettings = { autoSync: true, noConvMinSpendCents: 3000, noConvDays: 14 };

export async function getSettings(exec: Exec): Promise<AdsSettings> {
  const [r] = await rows(exec, sql`SELECT auto_sync, no_conv_min_spend_cents, no_conv_days FROM ads_settings WHERE id = 1`);
  if (!r) return { ...DEFAULT_SETTINGS };
  return { autoSync: num(r.auto_sync) === 1, noConvMinSpendCents: num(r.no_conv_min_spend_cents), noConvDays: num(r.no_conv_days) };
}
export async function saveSettings(exec: Exec, s: AdsSettings, userId: number | null): Promise<void> {
  await exec.execute(sql`
    INSERT INTO ads_settings (id, auto_sync, no_conv_min_spend_cents, no_conv_days, updated_by)
    VALUES (1, ${s.autoSync ? 1 : 0}, ${s.noConvMinSpendCents}, ${s.noConvDays}, ${userId})
    ON DUPLICATE KEY UPDATE auto_sync = VALUES(auto_sync), no_conv_min_spend_cents = VALUES(no_conv_min_spend_cents),
      no_conv_days = VALUES(no_conv_days), updated_by = VALUES(updated_by)`);
}

// ─── Campañas y métricas ──────────────────────────────────────────────────────

export interface CampaignRow {
  id: number;
  platform: AdsPlatform;
  externalId: string;
  accountId: string | null;
  name: string;
  utmCampaign: string | null;
  currency: string;
  source: "api" | "csv";
  firstDay: string | null;
  lastDay: string | null;
  archived: boolean;
}
const campaignOf = (r: any): CampaignRow => ({
  id: num(r.id),
  platform: String(r.platform) as AdsPlatform,
  externalId: String(r.external_id),
  accountId: str(r.account_id),
  name: String(r.name),
  utmCampaign: str(r.utm_campaign),
  currency: String(r.currency),
  source: String(r.source) === "csv" ? "csv" : "api",
  firstDay: str(r.first_day),
  lastDay: str(r.last_day),
  archived: num(r.is_archived) === 1,
});
const CAMPAIGN_COLS = sql`id, platform, external_id, account_id, name, utm_campaign, currency, source, first_day, last_day, is_archived`;

export async function listCampaigns(exec: Exec): Promise<CampaignRow[]> {
  return (await rows(exec, sql`SELECT ${CAMPAIGN_COLS} FROM ads_campaigns ORDER BY platform, name`)).map(campaignOf);
}
export async function getCampaign(exec: Exec, id: number): Promise<CampaignRow | null> {
  const [r] = await rows(exec, sql`SELECT ${CAMPAIGN_COLS} FROM ads_campaigns WHERE id = ${id}`);
  return r ? campaignOf(r) : null;
}
export async function findCampaignByName(exec: Exec, platform: AdsPlatform, name: string): Promise<CampaignRow | null> {
  const [r] = await rows(exec, sql`SELECT ${CAMPAIGN_COLS} FROM ads_campaigns WHERE platform = ${platform} AND name = ${name} ORDER BY source = 'api' DESC, id LIMIT 1`);
  return r ? campaignOf(r) : null;
}

/** Alta o actualización por clave natural (plataforma, identificador). El código UTM solo se rellena si no tenía. */
export async function upsertCampaign(exec: Exec, c: { platform: AdsPlatform; externalId: string; accountId: string | null; name: string; currency: string; source: "api" | "csv"; utmCampaign: string | null }): Promise<number> {
  await exec.execute(sql`
    INSERT INTO ads_campaigns (platform, external_id, account_id, name, utm_campaign, currency, source)
    VALUES (${c.platform}, ${c.externalId}, ${c.accountId}, ${c.name}, ${c.utmCampaign}, ${c.currency}, ${c.source})
    ON DUPLICATE KEY UPDATE name = VALUES(name), currency = VALUES(currency),
      account_id = COALESCE(VALUES(account_id), account_id), utm_campaign = COALESCE(utm_campaign, VALUES(utm_campaign))`);
  const [r] = await rows(exec, sql`SELECT id FROM ads_campaigns WHERE platform = ${c.platform} AND external_id = ${c.externalId}`);
  return num(r.id);
}

export async function setCampaignUtm(exec: Exec, id: number, utm: string | null): Promise<number> {
  return (await header(exec, sql`UPDATE ads_campaigns SET utm_campaign = ${utm} WHERE id = ${id}`)).affectedRows;
}
export async function setCampaignArchived(exec: Exec, id: number, archived: boolean): Promise<number> {
  return (await header(exec, sql`UPDATE ads_campaigns SET is_archived = ${archived ? 1 : 0} WHERE id = ${id}`)).affectedRows;
}

export interface MetricRow {
  campaignId: number;
  day: string;
  spendCents: number;
  impressions: number;
  clicks: number;
  conversions: number | null;
  conversionValueCents: number | null;
}

/** Upsert por (campaña, día): reimportar un rango corrige lo que cambió y nunca duplica. Por lotes de 500. */
export async function upsertMetrics(exec: Exec, list: MetricRow[], source: "api" | "csv", runId: number): Promise<number> {
  let n = 0;
  for (let i = 0; i < list.length; i += 500) {
    const chunk = list.slice(i, i + 500);
    const values = sql.join(
      chunk.map((m) => sql`(${m.campaignId}, ${m.day}, ${m.spendCents}, ${Math.max(0, m.impressions)}, ${Math.max(0, m.clicks)}, ${m.conversions}, ${m.conversionValueCents}, ${source}, ${runId})`),
      sql`, `,
    );
    await exec.execute(sql`
      INSERT INTO ads_daily_metrics (campaign_id, day, spend_cents, impressions, clicks, conversions, conversion_value_cents, source, run_id)
      VALUES ${values}
      ON DUPLICATE KEY UPDATE spend_cents = VALUES(spend_cents), impressions = VALUES(impressions), clicks = VALUES(clicks),
        conversions = VALUES(conversions), conversion_value_cents = VALUES(conversion_value_cents), source = VALUES(source), run_id = VALUES(run_id)`);
    n += chunk.length;
  }
  if (list.length) {
    const ids = Array.from(new Set(list.map((m) => m.campaignId)));
    await exec.execute(sql`
      UPDATE ads_campaigns c JOIN (SELECT campaign_id, MIN(day) AS f, MAX(day) AS l FROM ads_daily_metrics WHERE campaign_id IN (${sql.join(ids.map((x) => sql`${x}`), sql`, `)}) GROUP BY campaign_id) m
        ON m.campaign_id = c.id
      SET c.first_day = m.f, c.last_day = m.l`);
  }
  return n;
}

export interface CampaignTotals {
  campaignId: number;
  spendCents: number;
  impressions: number;
  clicks: number;
  conversions: number | null;
  conversionValueCents: number | null;
}
/** Totales por campaña en [from, to]. */
export async function totalsByCampaign(exec: Exec, from: string, to: string): Promise<CampaignTotals[]> {
  const list = await rows(exec, sql`
    SELECT campaign_id, SUM(spend_cents) AS spend, SUM(impressions) AS impr, SUM(clicks) AS clicks,
      SUM(conversions) AS conv, SUM(conversion_value_cents) AS conv_value
    FROM ads_daily_metrics WHERE day BETWEEN ${from} AND ${to} GROUP BY campaign_id`);
  return list.map((r) => ({ campaignId: num(r.campaign_id), spendCents: num(r.spend), impressions: num(r.impr), clicks: num(r.clicks), conversions: numOrNull(r.conv), conversionValueCents: numOrNull(r.conv_value) }));
}
/** Serie diaria por plataforma en [from, to]. */
export async function dailyByPlatform(exec: Exec, from: string, to: string): Promise<Array<{ day: string; platform: AdsPlatform; spendCents: number; clicks: number; conversions: number | null }>> {
  const list = await rows(exec, sql`
    SELECT m.day, c.platform, SUM(m.spend_cents) AS spend, SUM(m.clicks) AS clicks, SUM(m.conversions) AS conv
    FROM ads_daily_metrics m JOIN ads_campaigns c ON c.id = m.campaign_id
    WHERE m.day BETWEEN ${from} AND ${to} GROUP BY m.day, c.platform ORDER BY m.day`);
  return list.map((r) => ({ day: String(r.day), platform: String(r.platform) as AdsPlatform, spendCents: num(r.spend), clicks: num(r.clicks), conversions: numOrNull(r.conv) }));
}
export async function currencies(exec: Exec): Promise<string[]> {
  return (await rows(exec, sql`SELECT DISTINCT c.currency FROM ads_campaigns c WHERE EXISTS (SELECT 1 FROM ads_daily_metrics m WHERE m.campaign_id = c.id)`)).map((r) => String(r.currency));
}

// ─── Importaciones ────────────────────────────────────────────────────────────

export interface RunRow {
  id: number;
  platform: string;
  kind: "api" | "csv" | "tags";
  trigger: string;
  rangeStart: string | null;
  rangeEnd: string | null;
  status: "running" | "ok" | "failed";
  rowsUpserted: number;
  rowsSkipped: number;
  errorKind: string | null;
  errorMessage: string | null;
  fileName: string | null;
  startedAt: string | null;
  finishedAt: string | null;
}
const runOf = (r: any): RunRow => ({
  id: num(r.id),
  platform: String(r.platform),
  kind: String(r.kind) as RunRow["kind"],
  trigger: String(r.trigger_source),
  rangeStart: str(r.range_start),
  rangeEnd: str(r.range_end),
  status: String(r.status) as RunRow["status"],
  rowsUpserted: num(r.rows_upserted),
  rowsSkipped: num(r.rows_skipped),
  errorKind: str(r.error_kind),
  errorMessage: str(r.error_message),
  fileName: str(r.file_name),
  startedAt: iso(r.started_at),
  finishedAt: iso(r.finished_at),
});

export async function startRun(exec: Exec, r: { platform: string; kind: RunRow["kind"]; trigger: string; rangeStart?: string | null; rangeEnd?: string | null; fileName?: string | null; userId?: number | null }): Promise<number> {
  return (
    await header(exec, sql`
      INSERT INTO ads_sync_runs (platform, kind, trigger_source, range_start, range_end, file_name, created_by)
      VALUES (${r.platform}, ${r.kind}, ${r.trigger}, ${r.rangeStart ?? null}, ${r.rangeEnd ?? null}, ${r.fileName ?? null}, ${r.userId ?? null})`)
  ).insertId;
}
export async function finishRun(exec: Exec, id: number, r: { status: "ok" | "failed"; rowsUpserted?: number; rowsSkipped?: number; errorKind?: string | null; errorMessage?: string | null; rangeStart?: string; rangeEnd?: string }): Promise<void> {
  await exec.execute(sql`
    UPDATE ads_sync_runs SET status = ${r.status}, rows_upserted = ${r.rowsUpserted ?? 0}, rows_skipped = ${r.rowsSkipped ?? 0},
      error_kind = ${r.errorKind ?? null}, error_message = ${r.errorMessage ? r.errorMessage.slice(0, 500) : null},
      range_start = COALESCE(${r.rangeStart ?? null}, range_start), range_end = COALESCE(${r.rangeEnd ?? null}, range_end),
      finished_at = CURRENT_TIMESTAMP(3)
    WHERE id = ${id}`);
}
export async function recentRuns(exec: Exec, limit = 30): Promise<RunRow[]> {
  return (await rows(exec, sql`SELECT * FROM ads_sync_runs ORDER BY id DESC LIMIT ${limit}`)).map(runOf);
}
/** Última importación por API correcta y último fallo de cada plataforma. */
export async function apiSyncState(exec: Exec, platform: AdsPlatform): Promise<{ lastOk: RunRow | null; lastFailed: RunRow | null; running: RunRow | null }> {
  const [ok] = await rows(exec, sql`SELECT * FROM ads_sync_runs WHERE platform = ${platform} AND kind = 'api' AND status = 'ok' ORDER BY id DESC LIMIT 1`);
  const [failed] = await rows(exec, sql`SELECT * FROM ads_sync_runs WHERE platform = ${platform} AND kind = 'api' AND status = 'failed' ORDER BY id DESC LIMIT 1`);
  // Una importación que lleva más de 30 minutos «en curso» se da por abandonada (reinicio del proceso)
  const [running] = await rows(exec, sql`SELECT * FROM ads_sync_runs WHERE platform = ${platform} AND kind = 'api' AND status = 'running' AND started_at > (CURRENT_TIMESTAMP(3) - INTERVAL 30 MINUTE) ORDER BY id DESC LIMIT 1`);
  return { lastOk: ok ? runOf(ok) : null, lastFailed: failed ? runOf(failed) : null, running: running ? runOf(running) : null };
}

// ─── Ventas del Core y sus etiquetas ──────────────────────────────────────────

/**
 * Venta válida del Core: reserva no anulada y cobrada (total o parcialmente). Su ingreso es el importe total de la
 * reserva (céntimos), el mismo que factura la empresa.
 */
const VALID_SALE = sql`r.status <> 'cancelled' AND COALESCE(r.status_reservation, '') <> 'ANULADA' AND (r.status = 'paid' OR r.status_payment IN ('PAGADO', 'PAGO_PARCIAL'))`;

export interface TaggedSaleRow {
  reservationId: number;
  revenueCents: number;
  createdAtMs: number;
  reference: string | null;
  tag: SaleTag;
}
/** Todas las ventas válidas etiquetadas (para saber qué campañas tienen alguna vez una venta atribuida). */
export async function taggedSales(exec: Exec, limit = 50_000): Promise<TaggedSaleRow[]> {
  const list = await rows(exec, sql`
    SELECT r.id, r.amount_total, r.created_at, r.reservation_number, r.merchant_order,
      t.utm_source, t.utm_medium, t.utm_campaign, t.gclid, t.fbclid
    FROM ads_sale_tags t JOIN reservations r ON r.id = t.reservation_id
    WHERE ${VALID_SALE}
    ORDER BY r.id DESC LIMIT ${limit}`);
  return list.map((r) => ({
    reservationId: num(r.id),
    revenueCents: num(r.amount_total),
    createdAtMs: num(r.created_at),
    reference: str(r.reservation_number) ?? str(r.merchant_order),
    tag: { utmSource: str(r.utm_source), utmMedium: str(r.utm_medium), utmCampaign: str(r.utm_campaign), gclid: str(r.gclid), fbclid: str(r.fbclid) },
  }));
}
/** Ventas válidas del periodo (todas, etiquetadas o no): el total real de la empresa para comparar. */
export async function salesInWindow(exec: Exec, fromMs: number, toMs: number): Promise<{ sales: number; revenueCents: number; tagged: number }> {
  const [r] = await rows(exec, sql`
    SELECT COUNT(*) AS n, COALESCE(SUM(r.amount_total), 0) AS revenue, SUM(t.reservation_id IS NOT NULL) AS tagged
    FROM reservations r LEFT JOIN ads_sale_tags t ON t.reservation_id = r.id
    WHERE ${VALID_SALE} AND r.created_at >= ${fromMs} AND r.created_at < ${toMs}`);
  return { sales: num(r?.n), revenueCents: num(r?.revenue), tagged: num(r?.tagged) };
}

/**
 * Ventas válidas del periodo SIN etiqueta pero con clic de Meta: la web guarda la cookie `_fbc` (fbclid) en la reserva
 * para la Conversions API. Dice el canal (Meta), no la campaña: cuenta en el total del canal, nunca en una campaña.
 */
export async function untaggedMetaClickSales(exec: Exec, fromMs: number, toMs: number): Promise<{ sales: number; revenueCents: number }> {
  const [r] = await rows(exec, sql`
    SELECT COUNT(*) AS n, COALESCE(SUM(r.amount_total), 0) AS revenue
    FROM reservations r LEFT JOIN ads_sale_tags t ON t.reservation_id = r.id
    WHERE ${VALID_SALE} AND t.reservation_id IS NULL AND r.fbc IS NOT NULL AND r.fbc <> ''
      AND r.created_at >= ${fromMs} AND r.created_at < ${toMs}`);
  return { sales: num(r?.n), revenueCents: num(r?.revenue) };
}

/** Reservas por su localizador o su número de pedido (los que exporta la web y Analytics). */
export async function findReservationsByReference(exec: Exec, refs: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (let i = 0; i < refs.length; i += 500) {
    const chunk = refs.slice(i, i + 500);
    if (!chunk.length) continue;
    const list = sql.join(chunk.map((x) => sql`${x}`), sql`, `);
    const found = await rows(exec, sql`SELECT id, reservation_number, merchant_order FROM reservations WHERE reservation_number IN (${list}) OR merchant_order IN (${list})`);
    for (const r of found) {
      if (r.reservation_number) out.set(String(r.reservation_number), num(r.id));
      if (r.merchant_order && !out.has(String(r.merchant_order))) out.set(String(r.merchant_order), num(r.id));
    }
  }
  return out;
}

export async function upsertSaleTags(exec: Exec, list: Array<SaleTag & { reservationId: number }>, source: "csv" | "manual", runId: number | null, userId: number | null): Promise<number> {
  let n = 0;
  for (let i = 0; i < list.length; i += 500) {
    const chunk = list.slice(i, i + 500);
    const values = sql.join(chunk.map((t) => sql`(${t.reservationId}, ${t.utmSource}, ${t.utmMedium}, ${t.utmCampaign}, ${t.gclid}, ${t.fbclid}, ${source}, ${runId}, ${userId})`), sql`, `);
    await exec.execute(sql`
      INSERT INTO ads_sale_tags (reservation_id, utm_source, utm_medium, utm_campaign, gclid, fbclid, source, run_id, created_by)
      VALUES ${values}
      ON DUPLICATE KEY UPDATE utm_source = VALUES(utm_source), utm_medium = VALUES(utm_medium), utm_campaign = VALUES(utm_campaign),
        gclid = VALUES(gclid), fbclid = VALUES(fbclid), source = VALUES(source), run_id = VALUES(run_id), created_by = VALUES(created_by)`);
    n += chunk.length;
  }
  return n;
}

// ─── Presupuestos ─────────────────────────────────────────────────────────────

export interface BudgetRow {
  id: number;
  scopeKey: string;
  scope: "total" | "platform" | "campaign";
  platform: AdsPlatform | null;
  campaignId: number | null;
  monthlyCents: number;
}
export async function listBudgets(exec: Exec): Promise<BudgetRow[]> {
  return (await rows(exec, sql`SELECT id, scope_key, scope, platform, campaign_id, monthly_cents FROM ads_budgets WHERE is_archived = 0 ORDER BY scope, id`)).map((r) => ({
    id: num(r.id),
    scopeKey: String(r.scope_key),
    scope: String(r.scope) as BudgetRow["scope"],
    platform: (str(r.platform) as AdsPlatform | null) ?? null,
    campaignId: numOrNull(r.campaign_id),
    monthlyCents: num(r.monthly_cents),
  }));
}
export async function upsertBudget(exec: Exec, b: Omit<BudgetRow, "id">, userId: number | null): Promise<void> {
  await exec.execute(sql`
    INSERT INTO ads_budgets (scope_key, scope, platform, campaign_id, monthly_cents, updated_by)
    VALUES (${b.scopeKey}, ${b.scope}, ${b.platform}, ${b.campaignId}, ${b.monthlyCents}, ${userId})
    ON DUPLICATE KEY UPDATE monthly_cents = VALUES(monthly_cents), is_archived = 0, updated_by = VALUES(updated_by)`);
}
export async function archiveBudget(exec: Exec, id: number, userId: number | null): Promise<number> {
  return (await header(exec, sql`UPDATE ads_budgets SET is_archived = 1, updated_by = ${userId} WHERE id = ${id}`)).affectedRows;
}
