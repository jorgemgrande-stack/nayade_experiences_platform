/**
 * Elephant Ads Manager (capacidad `ads-manager`) — lógica pura compartida por el servidor y la pantalla
 * (/admin/marketing/ads). Portado de la ingesta de gasto y la atribución «first-party» de Skicenter
 * (server/adSpend y server/campaignCommandCenter/firstPartyAttribution), adaptado al Core multiempresa:
 *
 *  - Lectura de los informes CSV de Meta Ads y Google Ads (en español o en inglés, coma, punto y coma o tabulador,
 *    números con formato español o inglés) para que el panel funcione sin conectar ninguna API.
 *  - Atribución de las ventas reales del Core (reservas) a cada campaña por su etiqueta de origen (utm_campaign,
 *    gclid, fbclid, utm_source). Una venta cuenta para UNA sola campaña (la coincidencia más específica) y nunca se
 *    reparte en proporción. Sin ninguna venta atribuida NUNCA a una campaña, su ingreso es «sin datos» (null), no 0:
 *    no se puede distinguir «no ha vendido» de «no está etiquetada».
 *  - Indicadores (CTR, CPC, CPA, ROAS, coste por venta) y alertas deterministas (presupuesto, previsión, campaña sin
 *    conversiones, importación caída, medición incompleta).
 *
 * Importes en céntimos de la moneda de la cuenta. Días como texto AAAA-MM-DD (día de la cuenta publicitaria).
 */

export const ADS_PLATFORMS = ["meta", "google"] as const;
export type AdsPlatform = (typeof ADS_PLATFORMS)[number];
export const ADS_PLATFORM_LABELS: Record<AdsPlatform, string> = { meta: "Meta Ads (Facebook e Instagram)", google: "Google Ads" };
export const ADS_PLATFORM_SHORT: Record<AdsPlatform, string> = { meta: "Meta", google: "Google" };

/** Clasificación de un fallo de importación (portada de Skicenter): las tres primeras necesitan una acción humana. */
export type AdsErrorKind = "CONFIG_MISSING" | "AUTH_ERROR" | "PERMISSION_ERROR" | "RATE_LIMITED" | "TRANSIENT_ERROR" | "INTERNAL_ERROR";
export const ADS_ERROR_LABELS: Record<AdsErrorKind, string> = {
  CONFIG_MISSING: "Falta configurar la conexión",
  AUTH_ERROR: "La plataforma rechaza el acceso (clave caducada o revocada)",
  PERMISSION_ERROR: "Sin permiso para leer esa cuenta publicitaria",
  RATE_LIMITED: "La plataforma pide esperar (límite de consultas)",
  TRANSIENT_ERROR: "Fallo temporal de conexión",
  INTERNAL_ERROR: "Error inesperado",
};
export function needsHumanAction(kind: AdsErrorKind): boolean {
  return kind === "CONFIG_MISSING" || kind === "AUTH_ERROR" || kind === "PERMISSION_ERROR";
}

/** Una fila diaria de una campaña tal como la da la plataforma (API o CSV). */
export interface AdsDailyRow {
  externalId: string | null;
  name: string;
  day: string;
  spendCents: number;
  impressions: number;
  clicks: number;
  /** null = la plataforma no lo da (nunca un 0 inventado). */
  conversions: number | null;
  conversionValueCents: number | null;
  currency: string | null;
  utmCampaign?: string | null;
}

// ─── Fechas ────────────────────────────────────────────────────────────────────

export const isDay = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;
export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}
export function todayMadrid(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
export const daysInMonth = (day: string) => new Date(Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)), 0)).getUTCDate();

/** Ventanas [since, until] de como mucho `size` días que cubren [start, end] (portada de Skicenter). */
export function chunkRange(start: string, end: string, size: number): Array<{ since: string; until: string }> {
  if (size <= 0) throw new Error("El tamaño de cada tramo debe ser mayor que cero");
  const out: Array<{ since: string; until: string }> = [];
  for (let cursor = start; cursor <= end; ) {
    const until = addDays(cursor, size - 1) > end ? end : addDays(cursor, size - 1);
    out.push({ since: cursor, until });
    cursor = addDays(until, 1);
  }
  return out;
}

// ─── CSV ──────────────────────────────────────────────────────────────────────

/** Texto CSV → filas. Detecta coma, punto y coma o tabulador por la primera línea con contenido; comillas dobles. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "").replace(/\u0000/g, "");
  const sample = src.split(/\r?\n/).slice(0, 12).join("\n");
  const count = (c: string) => sample.split(c).length - 1;
  const delim = [",", ";", "\t"].sort((a, b) => count(b) - count(a))[0];
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') (cell += '"'), i++;
      else if (ch === '"') quoted = false;
      else cell += ch;
      continue;
    }
    if (ch === '"' && cell === "") quoted = true;
    else if (ch === delim) row.push(cell), (cell = "");
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length) row.push(cell), rows.push(row);
  return rows.map((r) => r.map((c) => c.trim())).filter((r) => r.some((c) => c !== ""));
}

/** Cabecera comparable: minúsculas, sin tildes ni espacios repetidos. */
export const normHeader = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
/** Texto comparable para atribuir: minúsculas, sin tildes, sin espacios de sobra. */
export const normKey = (s: string | null | undefined) => (s ? s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim() : "");

/**
 * Número de un informe: «1.234,56», «1,234.56», «1234,5», «12 %», «€ 3,20», «--» (vacío). null si no es un número.
 */
export function parseNumber(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  let s = String(raw).replace(/[\s €$£%]|EUR|USD|GBP/gi, "");
  if (s === "" || s === "--" || s === "-" || s === "—") return null;
  const neg = /^\(.*\)$/.test(s) || s.startsWith("-");
  s = s.replace(/[()]/g, "").replace(/^-/, "");
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma >= 0 && lastDot >= 0) {
    // El último separador es el decimal
    s = lastComma > lastDot ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  } else if (lastComma >= 0) {
    // «1,234» (miles en inglés) frente a «12,5» (decimal en español): tres cifras tras una única coma = miles
    s = /^\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, "") : s.replace(/,/g, ".");
  } else if (lastDot >= 0 && /^\d{1,3}(\.\d{3}){2,}$/.test(s)) {
    s = s.replace(/\./g, "");
  }
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? (neg ? -n : n) : null;
}
/** Recuento (impresiones, clics): «1.200» y «1,200» son mil doscientos, nunca 1,2. */
export function parseCount(raw: string | null | undefined): number {
  const s = String(raw ?? "").replace(/[\s ]/g, "");
  if (/^\d{1,3}([.,]\d{3})+$/.test(s)) return Number(s.replace(/[.,]/g, ""));
  return Math.max(0, Math.round(parseNumber(s) ?? 0));
}
const toCents = (n: number | null) => (n == null ? null : Math.round(n * 100));

const MONTHS: Record<string, number> = {
  ene: 1, jan: 1, feb: 2, mar: 3, abr: 4, apr: 4, may: 5, jun: 6, jul: 7, ago: 8, aug: 8, sep: 9, sept: 9, set: 9, oct: 10, nov: 11, dic: 12, dec: 12,
};
const pad = (n: number) => String(n).padStart(2, "0");
function ymd(y: number, m: number, d: number): string | null {
  if (y < 100) y += 2000;
  const s = `${y}-${pad(m)}-${pad(d)}`;
  return isDay(s) ? s : null;
}
/** Día de un informe: «2026-11-01», «01/11/2026», «1/11/26», «2026/11/01», «1 nov. 2026», «Nov 1, 2026». */
export function parseDay(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = normHeader(raw).replace(/\bde\b/g, " ").replace(/[.,]/g, " ").replace(/\s+/g, " ").trim();
  let m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (m) return ymd(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})/);
  if (m) return ymd(+m[3], +m[2], +m[1]);
  const month = (w: string) => MONTHS[w.slice(0, 4)] ?? MONTHS[w.slice(0, 3)];
  m = s.match(/^(\d{1,2}) ([a-z]+) (\d{4})/);
  if (m && month(m[2])) return ymd(+m[3], month(m[2]), +m[1]);
  m = s.match(/^([a-z]+) (\d{1,2}) (\d{4})/);
  if (m && month(m[1])) return ymd(+m[3], month(m[1]), +m[2]);
  return null;
}

type Col = "campaign" | "campaignId" | "day" | "spend" | "impressions" | "clicks" | "conversions" | "conversionValue" | "currency" | "utm";
/** Nombres de columna de los informes de Meta y de Google (en español y en inglés) y de la plantilla propia. */
const ADS_COLUMNS: Record<Col, string[]> = {
  campaign: ["nombre de la campana", "campana", "campaign name", "campaign"],
  campaignId: ["identificador de la campana", "id de la campana", "id de campana", "campaign id"],
  day: ["dia", "day", "fecha", "date", "inicio del informe", "reporting starts"],
  spend: ["importe gastado", "amount spent", "coste", "costo", "cost", "gasto", "spend", "inversion"],
  impressions: ["impresiones", "impr.", "impr", "impressions"],
  clicks: ["clics en el enlace", "link clicks", "clics (todos)", "clicks (all)", "clics", "clicks"],
  conversions: ["conversiones", "conversions", "compras", "purchases", "resultados", "results"],
  conversionValue: ["valor de conv.", "valor de conversion", "valor de las conversiones", "conv. value", "conversion value", "valor de conversion de compras", "purchases conversion value", "valor de compras"],
  currency: ["moneda", "currency", "codigo de moneda", "currency code"],
  utm: ["utm_campaign", "codigo utm", "utm"],
};

/** Índice de cada columna reconocida: primero la coincidencia exacta, después la que empieza igual («Importe gastado (EUR)»). */
function mapColumns(header: string[], spec: Record<string, string[]>): Record<string, number> {
  const h = header.map(normHeader);
  const out: Record<string, number> = {};
  const used = new Set<number>();
  for (const [col, names] of Object.entries(spec)) {
    let idx = -1;
    for (const n of names) {
      idx = h.findIndex((x, i) => !used.has(i) && x === n);
      if (idx >= 0) break;
    }
    if (idx < 0) {
      for (const n of names) {
        idx = h.findIndex((x, i) => !used.has(i) && (x.startsWith(`${n} (`) || x.startsWith(`${n}:`)));
        if (idx >= 0) break;
      }
    }
    if (idx >= 0) {
      out[col] = idx;
      used.add(idx);
    }
  }
  return out;
}

/** Moneda en la cabecera del gasto: «Importe gastado (EUR)». */
function currencyFromHeader(header: string | undefined): string | null {
  const m = header?.match(/\(([A-Z]{3})\)/);
  return m ? m[1] : null;
}

export function guessPlatform(header: string[]): AdsPlatform | null {
  const h = header.map(normHeader).join("|");
  if (/importe gastado|amount spent|identificador de la campana|clics en el enlace|link clicks/.test(h)) return "meta";
  if (/\bimpr\.?(\||$)|coste|cost(\||$)|valor de conv|conv\. value|id de campana/.test(h)) return "google";
  return null;
}

export interface AdsCsvResult {
  platform: AdsPlatform | null;
  rows: AdsDailyRow[];
  skipped: number;
  problems: string[];
}

export const ADS_CSV_MAX_ROWS = 20_000;

/**
 * Informe de campañas desglosado por día (Meta: Administrador de anuncios → Informes → «Desglose: Día»; Google Ads:
 * Campañas → Segmento: Día → Descargar). Busca la cabecera en las primeras filas (Google pone antes el título y el
 * rango) e ignora las filas de totales.
 */
export function parseAdsCsv(text: string, platformHint?: AdsPlatform | null): AdsCsvResult {
  const all = parseCsv(text);
  const problems: string[] = [];
  let headerIdx = -1;
  let cols: Record<string, number> = {};
  for (let i = 0; i < Math.min(all.length, 15); i++) {
    const c = mapColumns(all[i], ADS_COLUMNS);
    if (c.campaign != null && c.spend != null) {
      headerIdx = i;
      cols = c;
      break;
    }
  }
  if (headerIdx < 0) return { platform: platformHint ?? null, rows: [], skipped: 0, problems: ["No se encuentran las columnas de campaña y de gasto. Exporta el informe de campañas con el gasto (o coste) de cada una."] };
  if (cols.day == null) return { platform: platformHint ?? null, rows: [], skipped: 0, problems: ["El informe no viene desglosado por día: expórtalo con el desglose (o segmento) «Día»."] };
  const header = all[headerIdx];
  const platform = platformHint ?? guessPlatform(header);
  const headerCurrency = currencyFromHeader(header[cols.spend]);
  const rows: AdsDailyRow[] = [];
  let skipped = 0;
  const body = all.slice(headerIdx + 1);
  if (body.length > ADS_CSV_MAX_ROWS) problems.push(`El archivo tiene más de ${ADS_CSV_MAX_ROWS} filas: se leen las primeras ${ADS_CSV_MAX_ROWS}.`);
  body.slice(0, ADS_CSV_MAX_ROWS).forEach((r, i) => {
    const get = (c: Col) => (cols[c] != null ? (r[cols[c]] ?? "").trim() : "");
    const name = get("campaign");
    if (!name || /^total\b/i.test(normHeader(name)) || name === "--") return void skipped++;
    const day = parseDay(get("day"));
    if (!day) {
      skipped++;
      if (problems.length < 10) problems.push(`Fila ${headerIdx + i + 2}: la fecha «${get("day").slice(0, 30)}» no se entiende.`);
      return;
    }
    const spend = parseNumber(get("spend"));
    if (spend == null && get("spend") !== "" && get("spend") !== "--") {
      skipped++;
      if (problems.length < 10) problems.push(`Fila ${headerIdx + i + 2}: el gasto «${get("spend").slice(0, 30)}» no es un número.`);
      return;
    }
    const id = get("campaignId").replace(/^'/, "");
    rows.push({
      externalId: id && /^[A-Za-z0-9_.:-]{1,64}$/.test(id) ? id : null,
      name: name.slice(0, 255),
      day,
      spendCents: toCents(spend) ?? 0,
      impressions: parseCount(get("impressions")),
      clicks: parseCount(get("clicks")),
      conversions: cols.conversions != null ? parseNumber(get("conversions")) : null,
      conversionValueCents: cols.conversionValue != null ? toCents(parseNumber(get("conversionValue"))) : null,
      currency: (get("currency").toUpperCase().match(/^[A-Z]{3}$/)?.[0] ?? headerCurrency) || null,
      utmCampaign: get("utm") ? get("utm").slice(0, 160) : null,
    });
  });
  if (!rows.length && !problems.length) problems.push("El informe no tiene filas de campañas.");
  return { platform, rows, skipped, problems };
}

/** Clave estable de una campaña del CSV sin identificador: por su nombre. */
export const csvExternalId = (name: string) => `nombre:${normKey(name).slice(0, 56)}`;

// ─── Etiquetas de origen de las ventas ─────────────────────────────────────────

export interface SaleTag {
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  gclid: string | null;
  fbclid: string | null;
}
export interface SaleTagRow extends SaleTag {
  reference: string;
}

type TagCol = "reference" | "sourceMedium" | "utmSource" | "utmMedium" | "utmCampaign" | "gclid" | "fbclid";
const TAG_COLUMNS: Record<TagCol, string[]> = {
  reference: ["referencia", "localizador", "n.o de reserva", "numero de reserva", "reserva", "pedido", "numero de pedido", "merchant_order", "id de transaccion", "transaction id", "transaction_id"],
  sourceMedium: ["fuente / medio de la sesion", "session source / medium", "fuente / medio", "source / medium"],
  utmSource: ["utm_source", "fuente de la sesion", "session source", "fuente", "origen", "source"],
  utmMedium: ["utm_medium", "medio de la sesion", "session medium", "medio", "medium"],
  utmCampaign: ["utm_campaign", "campana de la sesion", "session campaign", "campana", "campaign"],
  gclid: ["gclid"],
  fbclid: ["fbclid"],
};

const clip = (v: string, n: number) => {
  const s = v.trim();
  return s && s !== "(not set)" && s !== "(none)" && s !== "--" ? s.slice(0, n) : null;
};

/** CSV de ventas etiquetadas: referencia de la reserva (o ID de transacción de Google Analytics) y su origen. */
export function parseSaleTagsCsv(text: string): { rows: SaleTagRow[]; skipped: number; problems: string[] } {
  const all = parseCsv(text);
  let headerIdx = -1;
  let cols: Record<string, number> = {};
  for (let i = 0; i < Math.min(all.length, 15); i++) {
    const c = mapColumns(all[i], TAG_COLUMNS);
    if (c.reference != null && (c.utmCampaign != null || c.gclid != null || c.fbclid != null || c.utmSource != null || c.sourceMedium != null)) {
      headerIdx = i;
      cols = c;
      break;
    }
  }
  if (headerIdx < 0) return { rows: [], skipped: 0, problems: ["No se encuentran las columnas: hace falta la referencia de la reserva y al menos su campaña (utm_campaign), su origen o un gclid/fbclid."] };
  const rows: SaleTagRow[] = [];
  let skipped = 0;
  for (const r of all.slice(headerIdx + 1, headerIdx + 1 + ADS_CSV_MAX_ROWS)) {
    const get = (c: TagCol) => (cols[c] != null ? (r[cols[c]] ?? "") : "");
    const reference = get("reference").trim().replace(/^#/, "");
    if (!reference || !/^[A-Za-z0-9_./-]{1,40}$/.test(reference)) {
      skipped++;
      continue;
    }
    let utmSource = clip(get("utmSource"), 120);
    let utmMedium = clip(get("utmMedium"), 120);
    const sm = get("sourceMedium");
    if (sm.includes("/")) {
      const [s, m] = sm.split("/");
      utmSource ??= clip(s, 120);
      utmMedium ??= clip(m, 120);
    }
    const tag: SaleTagRow = { reference, utmSource, utmMedium, utmCampaign: clip(get("utmCampaign"), 160), gclid: clip(get("gclid"), 255), fbclid: clip(get("fbclid"), 255) };
    if (!tag.utmCampaign && !tag.gclid && !tag.fbclid && !tag.utmSource) {
      skipped++;
      continue;
    }
    rows.push(tag);
  }
  return { rows, skipped, problems: rows.length ? [] : ["El archivo no tiene ventas con su origen."] };
}

/** Canal de una venta por su etiqueta: identificador de clic primero, después utm_source. */
export function channelOf(tag: SaleTag): AdsPlatform | null {
  if (tag.gclid) return "google";
  if (tag.fbclid) return "meta";
  const src = normKey(tag.utmSource);
  if (!src) return null;
  if (/(^|[^a-z])(google|adwords|gads|youtube)([^a-z]|$)/.test(src)) return "google";
  if (/(^|[^a-z])(facebook|instagram|meta|fb|ig|messenger)([^a-z]|$)/.test(src)) return "meta";
  return null;
}

// ─── Atribución ───────────────────────────────────────────────────────────────

export interface AttributableCampaign {
  id: number;
  platform: AdsPlatform;
  externalId: string;
  name: string;
  utmCampaign: string | null;
}
export interface TaggedSale {
  reservationId: number;
  revenueCents: number;
  tag: SaleTag;
}
export type AttributionMethod = "campaign_id" | "utm_code" | "campaign_name";
const STRENGTH: Record<AttributionMethod, number> = { campaign_id: 3, utm_code: 2, campaign_name: 1 };

/** Cómo casa una venta con una campaña, o null. El canal de la venta, si se conoce, debe ser el de la campaña. */
export function matchSale(tag: SaleTag, c: AttributableCampaign): AttributionMethod | null {
  const utm = normKey(tag.utmCampaign);
  if (!utm) return null;
  const channel = channelOf(tag);
  if (channel && channel !== c.platform) return null;
  if (!c.externalId.startsWith("nombre:") && utm === normKey(c.externalId)) return "campaign_id";
  if (c.utmCampaign && utm === normKey(c.utmCampaign)) return "utm_code";
  if (utm === normKey(c.name)) return "campaign_name";
  return null;
}

export interface AttributionResult {
  /** id de campaña → reservas atribuidas. */
  byCampaign: Map<number, { reservationIds: number[]; revenueCents: number; method: AttributionMethod }>;
  /** Ventas con etiqueta de un canal pero sin campaña reconocible (o ambiguas), por canal. */
  unmatchedByChannel: Map<AdsPlatform | "unknown", { sales: number; revenueCents: number }>;
  ambiguous: number;
}

/**
 * Cada venta a UNA sola campaña: la coincidencia más fuerte. Si empatan dos campañas (o, sin canal, dos plataformas)
 * la venta queda sin atribuir: mejor «sin datos» que un ingreso en la campaña equivocada.
 */
export function attributeSales(sales: TaggedSale[], campaigns: AttributableCampaign[]): AttributionResult {
  const byCampaign: AttributionResult["byCampaign"] = new Map();
  const unmatchedByChannel: AttributionResult["unmatchedByChannel"] = new Map();
  let ambiguous = 0;
  for (const s of sales) {
    let best: Array<{ c: AttributableCampaign; m: AttributionMethod }> = [];
    for (const c of campaigns) {
      const m = matchSale(s.tag, c);
      if (!m) continue;
      if (!best.length || STRENGTH[m] > STRENGTH[best[0].m]) best = [{ c, m }];
      else if (STRENGTH[m] === STRENGTH[best[0].m]) best.push({ c, m });
    }
    if (best.length === 1) {
      const { c, m } = best[0];
      const e = byCampaign.get(c.id) ?? { reservationIds: [], revenueCents: 0, method: m };
      e.reservationIds.push(s.reservationId);
      e.revenueCents += s.revenueCents;
      if (STRENGTH[m] > STRENGTH[e.method]) e.method = m;
      byCampaign.set(c.id, e);
      continue;
    }
    if (best.length > 1) ambiguous++;
    const ch = channelOf(s.tag) ?? "unknown";
    const u = unmatchedByChannel.get(ch) ?? { sales: 0, revenueCents: 0 };
    u.sales++;
    u.revenueCents += s.revenueCents;
    unmatchedByChannel.set(ch, u);
  }
  return { byCampaign, unmatchedByChannel, ambiguous };
}

// ─── Indicadores ──────────────────────────────────────────────────────────────

export interface AdsTotals {
  spendCents: number;
  impressions: number;
  clicks: number;
  conversions: number | null;
  conversionValueCents: number | null;
}
export interface AdsKpis {
  ctr: number | null;
  cpcCents: number | null;
  /** Coste por conversión que declara la plataforma. */
  cpaCents: number | null;
  /** Ingresos reales del Core / gasto. null sin atribución verificada. */
  roas: number | null;
  /** Gasto / ventas reales atribuidas. */
  costPerSaleCents: number | null;
  /** Valor de conversión declarado por la plataforma / gasto (no son ventas del Core). */
  platformRoas: number | null;
}
const div = (a: number | null, b: number | null) => (a == null || b == null || b === 0 ? null : a / b);
export function computeKpis(t: AdsTotals, real: { revenueCents: number | null; sales: number | null }): AdsKpis {
  return {
    ctr: div(t.clicks, t.impressions),
    cpcCents: div(t.spendCents, t.clicks),
    cpaCents: div(t.spendCents, t.conversions),
    roas: real.revenueCents == null ? null : div(real.revenueCents, t.spendCents),
    costPerSaleCents: real.sales == null ? null : div(t.spendCents, real.sales),
    platformRoas: div(t.conversionValueCents, t.spendCents),
  };
}
export function addTotals(a: AdsTotals, b: AdsTotals): AdsTotals {
  const plus = (x: number | null, y: number | null) => (x == null && y == null ? null : (x ?? 0) + (y ?? 0));
  return { spendCents: a.spendCents + b.spendCents, impressions: a.impressions + b.impressions, clicks: a.clicks + b.clicks, conversions: plus(a.conversions, b.conversions), conversionValueCents: plus(a.conversionValueCents, b.conversionValueCents) };
}
export const ZERO_TOTALS: AdsTotals = { spendCents: 0, impressions: 0, clicks: 0, conversions: null, conversionValueCents: null };

// ─── Alertas ──────────────────────────────────────────────────────────────────

export type AdsAlertKind = "budget_exceeded" | "budget_forecast" | "no_conversions" | "sync_failed" | "sync_stale" | "tracking_missing" | "currency_mixed";
export type AdsAlertSeverity = "alta" | "media" | "info";
export interface AdsAlert {
  key: string;
  kind: AdsAlertKind;
  severity: AdsAlertSeverity;
  title: string;
  detail: string;
}

export interface BudgetSpend {
  scopeKey: string;
  label: string;
  monthlyCents: number;
  spentCents: number;
}
export interface AlertInput {
  today: string;
  budgets: BudgetSpend[];
  /** Gasto y resultados de cada campaña en los últimos `noConvDays` días. */
  recent: Array<{ campaignId: number; name: string; platform: AdsPlatform; spendCents: number; conversions: number | null; sales: number }>;
  noConvMinSpendCents: number;
  noConvDays: number;
  sync: Array<{ platform: AdsPlatform; configured: boolean; lastOkAt: string | null; lastError: { kind: AdsErrorKind; message: string; at: string } | null }>;
  tracking: TrackingCheck[];
  currencies: string[];
}
const eur = (c: number) => `${(c / 100).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

/** Reglas deterministas; el orden es de gravedad. */
export function computeAlerts(i: AlertInput): AdsAlert[] {
  const out: AdsAlert[] = [];
  const day = Number(i.today.slice(8, 10));
  const dim = daysInMonth(i.today);
  for (const b of i.budgets) {
    if (b.monthlyCents <= 0) continue;
    if (b.spentCents > b.monthlyCents) {
      out.push({ key: `budget_exceeded:${b.scopeKey}`, kind: "budget_exceeded", severity: "alta", title: `Gasto por encima del previsto: ${b.label}`, detail: `Llevas ${eur(b.spentCents)} este mes y el presupuesto es de ${eur(b.monthlyCents)}.` });
      continue;
    }
    const forecast = Math.round((b.spentCents / Math.max(1, day)) * dim);
    if (day >= 3 && forecast > b.monthlyCents * 1.05) {
      out.push({ key: `budget_forecast:${b.scopeKey}`, kind: "budget_forecast", severity: "media", title: `Al ritmo actual superarás el presupuesto: ${b.label}`, detail: `Previsión a fin de mes: ${eur(forecast)} (presupuesto ${eur(b.monthlyCents)}; llevas ${eur(b.spentCents)}).` });
    }
  }
  for (const s of i.sync) {
    if (!s.configured) continue;
    if (s.lastError && (!s.lastOkAt || s.lastError.at > s.lastOkAt)) {
      out.push({ key: `sync_failed:${s.platform}`, kind: "sync_failed", severity: needsHumanAction(s.lastError.kind) ? "alta" : "media", title: `No se pudo importar ${ADS_PLATFORM_SHORT[s.platform]}`, detail: `${ADS_ERROR_LABELS[s.lastError.kind]}. ${s.lastError.message}`.slice(0, 400) });
    } else if (!s.lastOkAt || Date.parse(`${i.today}T12:00:00Z`) - Date.parse(s.lastOkAt) > 2 * 86_400_000) {
      out.push({ key: `sync_stale:${s.platform}`, kind: "sync_stale", severity: "media", title: `Datos de ${ADS_PLATFORM_SHORT[s.platform]} sin actualizar`, detail: s.lastOkAt ? "La última importación correcta tiene más de dos días." : "Aún no se ha importado nada: pulsa «Importar ahora»." });
    }
  }
  for (const r of i.recent) {
    if (r.spendCents >= i.noConvMinSpendCents && !(r.conversions && r.conversions > 0) && r.sales === 0) {
      out.push({ key: `no_conversions:${r.campaignId}`, kind: "no_conversions", severity: "media", title: `Campaña sin conversiones: ${r.name}`, detail: `${eur(r.spendCents)} gastados en ${ADS_PLATFORM_SHORT[r.platform]} en los últimos ${i.noConvDays} días sin conversiones en la plataforma ni ventas atribuidas.` });
    }
  }
  if (i.currencies.length > 1) out.push({ key: "currency_mixed", kind: "currency_mixed", severity: "media", title: "Cuentas en monedas distintas", detail: `Hay importes en ${i.currencies.join(", ")}: los totales suman cifras de monedas distintas.` });
  for (const t of i.tracking) if (!t.ok) out.push({ key: `tracking:${t.key}`, kind: "tracking_missing", severity: "info", title: t.label, detail: t.fix });
  return out;
}

// ─── Medición de conversiones ────────────────────────────────────────────────

export interface TrackingCheck {
  key: "meta_pixel" | "meta_capi" | "ga4" | "meta_ads" | "google_ads";
  ok: boolean;
  label: string;
  detail: string;
  fix: string;
}
export function trackingChecks(s: { metaPixelId: string | null; capiToken: boolean; ga4Id: string | null; metaAds: boolean; googleAds: boolean; usesMeta: boolean; usesGoogle: boolean }): TrackingCheck[] {
  const list: TrackingCheck[] = [
    s.metaPixelId
      ? { key: "meta_pixel", ok: true, label: "Píxel de Meta en tu web", detail: `Píxel ${s.metaPixelId} configurado.`, fix: "" }
      : { key: "meta_pixel", ok: false, label: "Falta el píxel de Meta en tu web", detail: "Sin píxel, Meta no ve las visitas ni las compras de tu web.", fix: "Añade el número de tu píxel en Configuración → Marca y tema → Analítica de tu web." },
    s.capiToken && s.metaPixelId
      ? { key: "meta_capi", ok: true, label: "Compras enviadas a Meta desde el servidor", detail: "Cada pago confirmado se envía a Meta (sin depender del navegador).", fix: "" }
      : { key: "meta_capi", ok: false, label: "Las compras no se envían a Meta desde el servidor", detail: "Sin este envío, Meta pierde las compras que el navegador bloquea.", fix: "Configura «Medición de anuncios de Meta» en Integraciones y pagos (y el píxel de tu web)." },
    s.ga4Id
      ? { key: "ga4", ok: true, label: "Google Analytics 4 en tu web", detail: `Propiedad ${s.ga4Id} configurada.`, fix: "" }
      : { key: "ga4", ok: false, label: "Falta Google Analytics 4 en tu web", detail: "Sin Analytics no tendrás el informe de transacciones con su campaña para atribuir tus ventas.", fix: "Añade tu identificador G-XXXXXXXXXX en Configuración → Marca y tema → Analítica de tu web." },
    s.metaAds
      ? { key: "meta_ads", ok: true, label: "Importación automática de Meta Ads", detail: "Cuenta publicitaria conectada.", fix: "" }
      : { key: "meta_ads", ok: false, label: "Meta Ads sin conexión automática", detail: "Puedes importar el informe en CSV.", fix: "Para importarlo cada día, añade la cuenta publicitaria y su clave de lectura en Integraciones y pagos → Medición de anuncios de Meta." },
    s.googleAds
      ? { key: "google_ads", ok: true, label: "Importación automática de Google Ads", detail: "Cuenta de Google Ads conectada.", fix: "" }
      : { key: "google_ads", ok: false, label: "Google Ads sin conexión automática", detail: "Puedes importar el informe en CSV.", fix: "Para importarlo cada día, completa «Google Ads» en Integraciones y pagos." },
  ];
  // Solo se avisa de lo que importa: lo de Meta si usa Meta (o no usa ninguna), lo de Google si usa Google
  const none = !s.usesMeta && !s.usesGoogle;
  return list.filter((c) => {
    if (c.key === "meta_pixel" || c.key === "meta_capi" || c.key === "meta_ads") return s.usesMeta || none;
    if (c.key === "google_ads") return s.usesGoogle || none;
    return true;
  });
}
