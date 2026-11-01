/**
 * invoiceHtml.ts — Construcción del HTML de factura on-demand.
 * Usado por generateInvoicePdf (crm.ts) y por el endpoint de vista previa.
 */

import { sql } from "drizzle-orm";
import { siteSettings } from "../drizzle/schema";
import { isMultiTenant } from "./_core/tenant";
import { peekTenantIdentity, tenantPublicUrl, warmTenantIdentity } from "./_core/tenantIdentity";
import { OWN_LEGAL_SETTING_KEYS, brandName, brandSetting, documentBrandColors, formatLegalAddress, preferOwnLegalSettings, readOwnLegalSettings, resolveCurrentLegalCompany, resolveLegalCompany, tenantFiscalIdentity, type LegalCompany } from "./tenantBrand";
import { getSystemSettingSync } from "./config";
import { groupTaxBreakdown, totalTaxAmount, type TaxBreakdownLine } from "./taxUtils";
import { legacyDb, legacyPool } from "./_core/legacyDb";

const _pool = legacyPool();
const db = legacyDb();

export interface InvoiceHtmlParams {
  invoiceNumber: string;
  clientName: string;
  clientEmail: string;
  clientPhone?: string | null;
  clientNif?: string | null;
  clientAddress?: string | null;
  /** `exemptionReason`: motivo de la exención de una línea al 0 % (factura libre). */
  itemsJson: { description: string; quantity: number; unitPrice: number; total: number; fiscalRegime?: string; taxRate?: number; exemptionReason?: string }[];
  subtotal: string;
  /** Descuento global aplicado sobre el subtotal (origen: TPV o promoción). null/0 = sin descuento. */
  discount?: string | number | null;
  discountReason?: string | null;
  /** @deprecated Usar taxBreakdown para multi-tipo. Se conserva como fallback. */
  taxRate: string;
  taxAmount: string;
  total: string;
  issuedAt: Date;
  /** Desglose por tipo de IVA (generado automáticamente si no se pasa). */
  taxBreakdown?: TaxBreakdownLine[];
  /**
   * Datos guardados del documento: copia del emisor, tipo, motivo y factura rectificada. Lo que no se pase se lee de la
   * factura con ese número; si aún no está guardada, es un documento nuevo.
   */
  issuerSnapshot?: unknown;
  invoiceType?: "factura" | "abono" | null;
  creditNoteReason?: string | null;
  rectifies?: { invoiceNumber: string; issuedAt: Date | string } | null;
}

/** Migración que fija el cambio de fuente de los datos fiscales (su fecha de aplicación en cada empresa). */
export const OWN_LEGAL_SOURCE_MIGRATION = "0018_tpv_idempotencia_cliente";

/**
 * ¿Mandan los ajustes propios para un documento de esa fecha? Un documento nuevo (sin fecha) o emitido desde que la
 * empresa tiene el cambio, sí. Uno emitido antes se sigue viendo exactamente como se emitió. Si no se sabe desde
 * cuándo (empresa fuera del carril de migraciones), se conserva el comportamiento anterior.
 */
export function ownLegalSettingsPrevail(issuedAt: Date | string | null | undefined, sinceMs: number | null): boolean {
  if (sinceMs == null) return false;
  if (issuedAt == null) return true;
  const t = new Date(issuedAt).getTime();
  return Number.isNaN(t) || t >= sinceMs;
}

/** Instante (ms) en que la empresa en curso recibió el cambio de fuente, o null si no consta. */
async function ownLegalSourceSince(): Promise<number | null> {
  try {
    const [rows] = await _pool.query<any[]>(
      "SELECT UNIX_TIMESTAMP(applied_at) * 1000 AS ms FROM __elephant_migrations WHERE id = ? LIMIT 1",
      [OWN_LEGAL_SOURCE_MIGRATION]
    );
    const ms = Number(rows[0]?.ms);
    return rows.length && Number.isFinite(ms) ? ms : null;
  } catch {
    return null;
  }
}

/** Ajustes antiguos `legalCompany*` (`site_settings`). */
async function readLegacyLegalSettings(): Promise<Record<string, string>> {
  const rows = await db.select().from(siteSettings)
    .where(sql`\`key\` IN ('legalCompanyName','legalCompanyCif','legalCompanyAddress','legalCompanyCity','legalCompanyZip','legalCompanyProvince','legalCompanyEmail','legalCompanyPhone','legalCompanyIban')`);
  return Object.fromEntries(rows.map(r => [r.key, r.value ?? ""]));
}

/**
 * Ajustes fiscales congelados al aplicar la migración 0020 (`invoice_issuer_baseline`): con ellos se pintan las
 * facturas emitidas antes de que existiera la copia del emisor. null si la empresa no tiene esa migración.
 */
export interface IssuerBaseline {
  /** Ajustes propios con las claves `legalCompany*`. */
  own: Record<string, string>;
  /** Ajustes antiguos `legalCompany*`. */
  legacy: Record<string, string>;
  /** Marca de entonces (nombre, nombre corto, logotipo y web): la cabecera y el pie de esas facturas. */
  brand: Record<string, string>;
  capturedAtMs: number;
}

const jsonObject = (v: unknown): Record<string, string> => {
  let o: unknown = v;
  if (typeof v === "string") {
    try { o = JSON.parse(v); } catch { o = null; }
  }
  if (!o || typeof o !== "object" || Array.isArray(o)) return {};
  return Object.fromEntries(Object.entries(o as Record<string, unknown>).map(([k, x]) => [k, x == null ? "" : String(x)]));
};

const BRAND_KEYS = ["brand_name", "brand_short_name", "brand_logo_url", "brand_website_url"] as const;

export async function readIssuerBaseline(): Promise<IssuerBaseline | null> {
  try {
    const [rows] = await _pool.query<any[]>(
      "SELECT own_json, legacy_json, UNIX_TIMESTAMP(captured_at) * 1000 AS ms FROM invoice_issuer_baseline WHERE id = 1 LIMIT 1"
    );
    const r = rows?.[0];
    const ms = Number(r?.ms);
    if (!r || !Number.isFinite(ms)) return null;
    const sys = jsonObject(r.own_json);
    const own: Record<string, string> = {};
    for (const [k, key] of Object.entries(OWN_LEGAL_SETTING_KEYS)) if (key in sys) own[k] = sys[key];
    const brand: Record<string, string> = {};
    for (const key of BRAND_KEYS) brand[key] = sys[key] ?? "";
    return { own, legacy: jsonObject(r.legacy_json), brand, capturedAtMs: ms };
  } catch {
    return null;
  }
}

/**
 * Emisor de los documentos que se emiten ahora (facturas, abonos y tickets nuevos, textos legales, presupuestos):
 * lo que la empresa guardó en «Datos de la empresa» manda sobre su entidad del registro (ver resolveCurrentLegalCompany).
 */
export async function currentLegalCompany(): Promise<LegalCompany> {
  const s = await readLegacyLegalSettings();
  const multi = isMultiTenant();
  if (multi) await warmTenantIdentity();
  const fiscal = multi ? tenantFiscalIdentity() : null;
  return resolveCurrentLegalCompany(s, multi ? await readOwnLegalSettings() : {}, { multi, fiscal });
}

/**
 * Fuente de antes para una factura sin copia del emisor (emitida antes de la 0020), con la misma regla de siempre y
 * los ajustes congelados de la 0020 si existen: cambiar ahora los datos de la empresa no la altera.
 */
async function legacyLegalCompany(issuedAt: Date | string | null | undefined, baseline: IssuerBaseline | null): Promise<LegalCompany> {
  let s: Record<string, string> = baseline ? { ...baseline.legacy } : await readLegacyLegalSettings();
  const readOwn = async () => (baseline ? { ...baseline.own } : await readOwnLegalSettings());
  // single: respaldos heredados (sin cambios). multi: entidad fiscal de la empresa en el registro.
  const multi = isMultiTenant();
  if (multi) await warmTenantIdentity();
  const fiscal = multi ? tenantFiscalIdentity() : null;
  if (multi && ownLegalSettingsPrevail(issuedAt, await ownLegalSourceSince())) {
    // Fuente única: lo guardado en «Datos de la empresa» o en el asistente manda sobre los ajustes antiguos
    s = preferOwnLegalSettings(s, await readOwn());
  } else if (multi && !fiscal) {
    // Documentos emitidos antes del cambio: como se emitieron (los ajustes antiguos primero y, si faltan,
    // los que guardó en «Primeros pasos»)
    const own = await readOwn();
    for (const [k, v] of Object.entries(own)) if (!s[k]) s[k] = v;
  }
  return resolveLegalCompany(s, { multi, fiscal });
}

/** ¿Un documento de esa fecha es posterior a la copia del emisor (0020)? */
function issuedAfterBaseline(issuedAt: Date | string | null | undefined, baseline: IssuerBaseline | null): boolean {
  if (!baseline || issuedAt == null) return false;
  const t = new Date(issuedAt).getTime();
  return Number.isFinite(t) && t >= baseline.capturedAtMs;
}

/**
 * Datos del emisor.
 *  - Sin `issuedAt`: un documento nuevo o una página legal: los datos en vigor (`currentLegalCompany`).
 *  - Con `issuedAt`: un documento ya emitido sin copia del emisor: la fuente de antes, congelada (o los datos en
 *    vigor si se emitió después de la 0020 por un camino que no guardó la copia).
 */
export async function getLegalCompanySettings(opts: { issuedAt?: Date | string | null } = {}): Promise<LegalCompany> {
  if (opts.issuedAt == null) return currentLegalCompany();
  const baseline = await readIssuerBaseline();
  if (issuedAfterBaseline(opts.issuedAt, baseline)) return currentLegalCompany();
  return legacyLegalCompany(opts.issuedAt, baseline);
}

// ── Copia del emisor ────────────────────────────────────────────────────────

/** Marca con la que se presenta un documento: nombre, nombre corto, logotipo, web y colores. */
export interface DocumentBrand {
  name: string;
  shortName: string;
  logoUrl: string;
  websiteUrl: string;
  primary: string;
  accent: string;
}

/**
 * Copia de los datos del emisor que guarda cada factura o abono al emitirse (0020), con la marca de ese momento: la
 * factura se ve siempre igual aunque la empresa cambie después sus datos, su logotipo o sus colores.
 */
export type IssuerSnapshot = LegalCompany & { v: 1; capturedAt: string; brand?: DocumentBrand };

/** Marca en vigor de la empresa para un documento nuevo. */
export async function currentDocumentBrand(): Promise<DocumentBrand> {
  return {
    name: brandName(),
    shortName: brandSetting("brand_short_name", ""),
    logoUrl: brandSetting("brand_logo_url", ""),
    websiteUrl: getSystemSettingSync("brand_website_url", "") || (isMultiTenant() ? tenantPublicUrl() ?? "" : ""),
    ...(await documentBrandColors()),
  };
}

/** Marca guardada en la copia, o null (copia sin marca). */
export function parseSnapshotBrand(raw: unknown): DocumentBrand | null {
  let o: unknown = raw;
  if (typeof raw === "string") {
    try { o = JSON.parse(raw); } catch { return null; }
  }
  const b = (o as { brand?: unknown } | null)?.brand;
  if (!b || typeof b !== "object") return null;
  const r = b as Record<string, unknown>;
  const str = (k: string) => (typeof r[k] === "string" ? (r[k] as string) : "");
  return { name: str("name"), shortName: str("shortName"), logoUrl: str("logoUrl"), websiteUrl: str("websiteUrl"), primary: str("primary"), accent: str("accent") };
}

const LEGAL_FIELDS = ["name", "cif", "address", "city", "zip", "province", "email", "phone", "iban"] as const;

export function toIssuerSnapshot(l: LegalCompany, at: Date = new Date(), brand?: DocumentBrand): IssuerSnapshot {
  const out = { v: 1 as const, capturedAt: at.toISOString() } as IssuerSnapshot;
  for (const k of LEGAL_FIELDS) out[k] = String(l[k] ?? "");
  if (brand) out.brand = { ...brand };
  return out;
}

/** Copia guardada válida, o null (factura emitida antes de la copia, o dato que no se reconoce). */
export function parseIssuerSnapshot(raw: unknown): LegalCompany | null {
  let o: unknown = raw;
  if (typeof raw === "string") {
    try { o = JSON.parse(raw); } catch { return null; }
  }
  if (!o || typeof o !== "object" || (o as { v?: unknown }).v !== 1) return null;
  const r = o as Record<string, unknown>;
  const out = {} as LegalCompany;
  for (const k of LEGAL_FIELDS) out[k] = typeof r[k] === "string" ? (r[k] as string) : "";
  return out;
}

/**
 * Copia del emisor para un documento que se emite AHORA (se guarda en `invoices.issuerSnapshot` en el alta). Si no se
 * pueden leer los datos, null: el documento se pinta entonces con los datos en vigor.
 */
export async function captureIssuerSnapshot(): Promise<IssuerSnapshot | null> {
  try {
    const issuer = await currentLegalCompany();
    return toIssuerSnapshot(issuer, new Date(), await currentDocumentBrand());
  } catch (e) {
    console.warn("[invoiceHtml] No se pudo copiar el emisor de la factura:", (e as Error).message);
    return null;
  }
}

interface InvoiceDocumentMeta {
  issuerSnapshot: unknown;
  invoiceType: string | null;
  creditNoteReason: string | null;
  issuedAt: Date | null;
  rectifies: { invoiceNumber: string; issuedAt: Date | string } | null;
}

/** Datos guardados de la factura con ese número (copia del emisor, tipo, factura rectificada); null si no existe. */
async function loadInvoiceDocumentMeta(invoiceNumber: string): Promise<InvoiceDocumentMeta | null> {
  try {
    const [rows] = await _pool.query<any[]>(
      `SELECT i.issuerSnapshot, i.invoiceType, i.creditNoteReason, UNIX_TIMESTAMP(i.issuedAt) * 1000 AS issuedMs,
              o.invoiceNumber AS origNumber, UNIX_TIMESTAMP(o.issuedAt) * 1000 AS origIssuedMs
         FROM invoices i LEFT JOIN invoices o ON o.id = i.creditNoteForId
        WHERE i.invoiceNumber = ? LIMIT 1`,
      [invoiceNumber]
    );
    const r = rows?.[0];
    if (!r) return null;
    return {
      issuerSnapshot: r.issuerSnapshot ?? null,
      invoiceType: r.invoiceType ?? null,
      creditNoteReason: r.creditNoteReason ?? null,
      issuedAt: r.issuedMs != null && Number.isFinite(Number(r.issuedMs)) ? new Date(Number(r.issuedMs)) : null,
      rectifies: r.origNumber ? { invoiceNumber: String(r.origNumber), issuedAt: new Date(Number(r.origIssuedMs)) } : null,
    };
  } catch {
    return null;
  }
}

function escapeHtml(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Escapa los textos que proceden de usuarios (cliente, conceptos) antes de interpolarlos. */
function escapeInvoiceParams(p: InvoiceHtmlParams): InvoiceHtmlParams {
  return {
    ...p,
    invoiceNumber: escapeHtml(p.invoiceNumber),
    clientName: escapeHtml(p.clientName),
    clientEmail: escapeHtml(p.clientEmail),
    clientPhone: p.clientPhone == null ? p.clientPhone : escapeHtml(p.clientPhone),
    clientNif: p.clientNif == null ? p.clientNif : escapeHtml(p.clientNif),
    clientAddress: p.clientAddress == null ? p.clientAddress : escapeHtml(p.clientAddress),
    discountReason: p.discountReason == null ? p.discountReason : escapeHtml(p.discountReason),
    itemsJson: (p.itemsJson ?? []).map((i) => ({ ...i, description: escapeHtml(i.description), ...(i.exemptionReason ? { exemptionReason: escapeHtml(i.exemptionReason) } : {}) })),
  };
}

/** Presentación del documento. La de antes (facturas sin copia del emisor) no cambia nunca. */
interface InvoiceLook {
  /** Marca de la cabecera y el pie. La presentación de antes la insertaba tal cual; la nueva la escapa. */
  brand: { name: string; shortName: string; logoUrl: string; websiteUrl: string };
  escapeBrand: boolean;
  primary: string;
  accent: string;
  docLabel: string;
  extraCss: string;
  /** Bloque tras las partes (factura rectificada y motivo), ya escapado. */
  afterParties: string;
  /** Párrafo legal al pie, ya escapado. */
  footerNote: string;
}

const LEGACY_COLORS = { primary: "#1a3a6b", accent: "#f97316" };

/**
 * Presentación de antes (facturas sin copia del emisor): colores fijos y la marca tal y como se leía, con la marca
 * congelada al aplicar la 0020 si la empresa la tiene (cambiar ahora el nombre o el logotipo no las altera).
 */
function legacyLook(baseline: IssuerBaseline | null): InvoiceLook {
  const multi = isMultiTenant();
  let brand: InvoiceLook["brand"];
  if (baseline) {
    const b = baseline.brand;
    const name = b.brand_name || (multi ? peekTenantIdentity()?.displayName ?? "" : "");
    brand = {
      name,
      shortName: b.brand_short_name || (multi ? name : ""),
      logoUrl: b.brand_logo_url,
      websiteUrl: b.brand_website_url || (multi ? escapeHtml(tenantPublicUrl() ?? "") : ""),
    };
  } else {
    brand = {
      name: brandName(),
      shortName: brandSetting("brand_short_name", ""),
      logoUrl: brandSetting("brand_logo_url", ""),
      // multi: si la empresa no fija su web, su URL pública del registro (nunca la de otra instalación)
      websiteUrl: getSystemSettingSync("brand_website_url", "") || (multi ? escapeHtml(tenantPublicUrl() ?? "") : ""),
    };
  }
  return { brand, escapeBrand: false, ...LEGACY_COLORS, docLabel: "Factura", extraCss: "", afterParties: "", footerNote: "" };
}

/** Mención legal de la rectificativa por diferencias (art. 15 del Reglamento de facturación, RD 1619/2012). */
export const RECTIFICATIVE_LEGAL_NOTE =
  "Factura rectificativa por diferencias, emitida conforme al artículo 15 del Reglamento por el que se regulan las obligaciones de facturación (Real Decreto 1619/2012, de 30 de noviembre). Los importes negativos minoran la base imponible y la cuota de IVA de la factura rectificada.";

const neg = (v: unknown) => -Math.abs(Number(v) || 0);

/** Importes de una rectificativa, siempre en negativo (líneas, base, cuotas por tipo y total). */
function negativeAmounts(p: InvoiceHtmlParams): InvoiceHtmlParams {
  return {
    ...p,
    itemsJson: (p.itemsJson ?? []).map((i) => ({ ...i, unitPrice: neg(i.unitPrice), total: neg(i.total) })),
    subtotal: neg(p.subtotal).toFixed(2),
    taxAmount: neg(p.taxAmount).toFixed(2),
    total: neg(p.total).toFixed(2),
    taxBreakdown: p.taxBreakdown?.map((b) => ({ ...b, base: neg(b.base), amount: neg(b.amount) })),
  };
}

/** Documentos nuevos: en pantallas estrechas (móvil) la cabecera y las partes se apilan, sin desbordar. */
const NARROW_CSS = `  @media (max-width: 640px) {
    .doc-header, .doc-type-band, .parties { flex-direction: column; align-items: flex-start; }
    .doc-header, .doc-type-band, .body-content, .footer { padding-left: 16px; padding-right: 16px; }
    .company-info { text-align: left; }
    .company-info, .party p { overflow-wrap: anywhere; }
    .totals { width: 100%; }
  }
`;

const dateEs = (d: Date | string) => (d instanceof Date ? d : new Date(d)).toLocaleDateString("es-ES");

/**
 * HTML de una factura o abono para la vista, el PDF y el ZIP de la gestoría.
 *  - Con copia del emisor (emitida desde la 0020): esos datos, los colores de la marca y, si es un abono, como
 *    FACTURA RECTIFICATIVA con la factura rectificada, el motivo, los importes en negativo y la mención legal.
 *  - Sin copia (emitida antes): exactamente como se veía, con la fuente de antes congelada.
 */
export async function buildInvoiceHtml(rawInvoice: InvoiceHtmlParams): Promise<string> {
  const needMeta = rawInvoice.issuerSnapshot === undefined || rawInvoice.invoiceType === undefined
    || (rawInvoice.invoiceType === "abono" && (rawInvoice.rectifies === undefined || rawInvoice.creditNoteReason === undefined));
  const meta = needMeta ? await loadInvoiceDocumentMeta(rawInvoice.invoiceNumber) : null;
  const snapshot = parseIssuerSnapshot(rawInvoice.issuerSnapshot !== undefined ? rawInvoice.issuerSnapshot : meta?.issuerSnapshot);
  const rawSnapshot = rawInvoice.issuerSnapshot !== undefined ? rawInvoice.issuerSnapshot : meta?.issuerSnapshot;
  let issuer: LegalCompany;
  let docBrand: DocumentBrand;
  if (snapshot) {
    issuer = snapshot;
    docBrand = parseSnapshotBrand(rawSnapshot) ?? (await currentDocumentBrand());
  } else {
    // Sin copia: decide la fecha de emisión guardada; la fuente de antes recibe la fecha de siempre
    const baseline = await readIssuerBaseline();
    if (!issuedAfterBaseline(meta?.issuedAt ?? rawInvoice.issuedAt, baseline)) {
      return renderInvoiceHtml(rawInvoice, await legacyLegalCompany(rawInvoice.issuedAt, baseline), legacyLook(baseline));
    }
    // Emitida después de la 0020 por un camino que no guardó la copia: los datos en vigor
    issuer = await currentLegalCompany();
    docBrand = await currentDocumentBrand();
  }
  const colors = docBrand.primary && docBrand.accent ? { primary: docBrand.primary, accent: docBrand.accent } : await documentBrandColors();
  const base: InvoiceLook = { ...legacyLook(null), brand: docBrand, escapeBrand: true, ...colors, extraCss: NARROW_CSS };
  const { primary, accent } = colors;

  const isCredit = (rawInvoice.invoiceType !== undefined ? rawInvoice.invoiceType : meta?.invoiceType) === "abono";
  if (!isCredit) return renderInvoiceHtml(rawInvoice, issuer, base);
  const rect = rawInvoice.rectifies !== undefined ? rawInvoice.rectifies : (meta?.rectifies ?? null);
  const reason = ((rawInvoice.creditNoteReason !== undefined ? rawInvoice.creditNoteReason : meta?.creditNoteReason) ?? "").trim();
  const afterParties = `  <div class="rectifies">
    <h3>Factura rectificada</h3>
    <p>${rect ? `Rectifica la factura <strong>${escapeHtml(rect.invoiceNumber)}</strong> de fecha ${escapeHtml(dateEs(rect.issuedAt))}.` : "Rectifica una factura emitida anteriormente."}<br/>
    Motivo de la rectificación: ${reason ? escapeHtml(reason) : "no indicado"}</p>
  </div>`;
  return renderInvoiceHtml(negativeAmounts(rawInvoice), issuer, {
    ...base,
    docLabel: "Factura rectificativa",
    extraCss: NARROW_CSS + `  .rectifies { border: 1px solid #e5e7eb; border-left: 4px solid ${accent}; border-radius: 8px; padding: 12px 16px; margin-bottom: 20px; background: #f8fafc; }
  .rectifies h3 { font-size: 10px; text-transform: uppercase; letter-spacing: 1.5px; color: ${primary}; margin-bottom: 6px; font-weight: 700; }
  .rectifies p { font-size: 13px; line-height: 1.7; color: #374151; }
  .legal-note { margin-top: 6px; font-size: 10.5px; color: #6b7280; }
`,
    afterParties,
    footerNote: `<p class="legal-note">${escapeHtml(RECTIFICATIVE_LEGAL_NOTE)}</p>`,
  });
}

function renderInvoiceHtml(rawInvoice: InvoiceHtmlParams, rawLegal: LegalCompany, look: InvoiceLook): string {
  const invoice = escapeInvoiceParams(rawInvoice);
  const legal = Object.fromEntries(
    Object.entries(rawLegal).map(([k, v]) => [k, escapeHtml(v)]),
  ) as unknown as LegalCompany;
  const legalAddressFull = formatLegalAddress(legal);
  const e = (v: string) => (look.escapeBrand ? escapeHtml(v) : v);
  const websiteUrl = e(look.brand.websiteUrl);

  const reavItems    = invoice.itemsJson.filter(i => i.fiscalRegime === "reav");
  const generalItems = invoice.itemsJson.filter(i => i.fiscalRegime !== "reav");
  const hasReav    = reavItems.length > 0;
  const hasGeneral = generalItems.length > 0;

  // Desglose fiscal: usar el que venga en el param, o calcularlo desde las líneas
  const breakdown: TaxBreakdownLine[] = invoice.taxBreakdown?.length
    ? invoice.taxBreakdown
    : groupTaxBreakdown(invoice.itemsJson);
  const isMultiRate = breakdown.length > 1;
  // Con descuento global: suma de conceptos, descuento y después las bases y cuotas ya descontadas
  const hasDiscount = Number(invoice.discount ?? 0) > 0;
  // Mención obligatoria de las líneas al 0 %: el motivo de la exención (solo si se indicó al emitir)
  const exemptionReasons = Array.from(new Set(invoice.itemsJson.map((i) => (i.exemptionReason ?? "").trim()).filter(Boolean)));

  const buildItemRows = (items: typeof invoice.itemsJson, isReav: boolean) =>
    items.map((item) =>
      `<tr${isReav ? ' class="reav-row"' : ''}>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">${item.description}${isReav ? ' <span style="font-size:10px;color:#6b7280;font-style:italic;">(REAV)</span>' : ''}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:center;">${item.quantity}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:right;">${Number(item.unitPrice).toFixed(2)} €</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:right;">${Number(item.total).toFixed(2)} €</td>
      </tr>`
    ).join("");

  let itemRows = "";
  if (hasGeneral && hasReav) {
    itemRows = buildItemRows(generalItems, false);
    itemRows += `<tr><td colspan="4" style="padding:6px 12px;background:#f0f4ff;font-size:11px;font-weight:600;color:${look.primary};letter-spacing:0.5px;">RÉGIMEN ESPECIAL AGENCIAS DE VIAJE (REAV) — Operaciones no sujetas a IVA</td></tr>`;
    itemRows += buildItemRows(reavItems, true);
  } else {
    itemRows = buildItemRows(invoice.itemsJson, hasReav && !hasGeneral);
  }

  const issuedDate = invoice.issuedAt instanceof Date
    ? invoice.issuedAt.toLocaleDateString("es-ES")
    : new Date(invoice.issuedAt).toLocaleDateString("es-ES");

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8"/>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family: 'Helvetica Neue', Arial, sans-serif; color: #1a1a2e; background: #fff; }
  .doc-header { background: ${look.primary}; padding: 20px 40px; display: flex; align-items: center; justify-content: space-between; gap: 20px; }
  .logo-block { display: flex; align-items: center; gap: 16px; flex-shrink: 0; }
  .logo-block img { width: 90px; height: 90px; border-radius: 50%; border: 3px solid rgba(255,255,255,0.85); object-fit: cover; display: block; }
  .brand-text .brand-name { font-size: 20px; font-weight: 900; letter-spacing: 2px; text-transform: uppercase; color: #fff; line-height: 1.1; }
  .brand-text .brand-sub { font-size: 10px; letter-spacing: 3px; text-transform: uppercase; color: rgba(255,255,255,0.65); margin-top: 3px; }
  .company-info { text-align: right; color: rgba(255,255,255,0.80); font-size: 11.5px; line-height: 1.7; }
  .company-info strong { color: #fff; font-size: 12.5px; display: block; }
  .doc-type-band { background: ${look.accent}; padding: 8px 40px; display: flex; align-items: center; justify-content: space-between; }
  .doc-type-band .doc-label { color: #fff; font-size: 12px; font-weight: 700; letter-spacing: 2px; text-transform: uppercase; }
  .doc-type-band .doc-ref { color: #fff; font-size: 13px; font-weight: 700; }
  .body-content { padding: 28px 40px; }
  .parties { display: flex; gap: 28px; margin-bottom: 24px; }
  .party { flex: 1; background: #f8fafc; border-radius: 8px; padding: 14px 16px; border: 1px solid #e5e7eb; }
  .party h3 { font-size: 10px; text-transform: uppercase; letter-spacing: 1.5px; color: ${look.primary}; margin-bottom: 8px; font-weight: 700; }
  .party p { font-size: 13px; line-height: 1.7; color: #374151; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 13px; }
  thead tr { background: ${look.primary}; color: #fff; }
  thead th { padding: 10px 12px; text-align: left; font-size: 12px; font-weight: 600; }
  thead th:last-child, thead th:nth-child(2), thead th:nth-child(3) { text-align: right; }
  tbody tr:nth-child(even) { background: #f8fafc; }
  tbody td { padding: 9px 12px; border-bottom: 1px solid #e5e7eb; }
  .totals-wrap { display: flex; justify-content: flex-end; margin-bottom: 24px; }
  .totals { width: 300px; border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden; }
  .totals tr td { padding: 8px 14px; font-size: 13px; border-bottom: 1px solid #e5e7eb; }
  .totals tr td:last-child { text-align: right; font-weight: 600; }
  .totals .total-row { background: ${look.primary}; color: #fff; }
  .totals .total-row td { padding: 11px 14px; font-size: 15px; font-weight: 700; border-bottom: none; }
  .footer { padding: 16px 40px; border-top: 2px solid ${look.primary}; text-align: center; color: #9ca3af; font-size: 11px; line-height: 1.8; }
${look.extraCss}</style>
</head>
<body>
  <div class="doc-header">
    <div class="logo-block">
      ${look.brand.logoUrl ? `<img src="${e(look.brand.logoUrl)}" alt="${e(look.brand.shortName)}" />` : ""}
      <div class="brand-text">
        <div class="brand-name">${e(look.brand.shortName)}</div>
        <div class="brand-sub">${e(look.brand.name.replace(look.brand.shortName, "").trim())}</div>
      </div>
    </div>
    <div class="company-info">
      <strong>${legal.name}</strong>
      ${legalAddressFull}<br/>
      CIF: ${legal.cif}${legal.phone ? ` &middot; Tel: ${legal.phone}` : ""}${legal.email ? `<br/>${legal.email}` : ""}
    </div>
  </div>
  <div class="doc-type-band">
    <span class="doc-label">${look.docLabel}</span>
    <span class="doc-ref">${invoice.invoiceNumber} &nbsp;&middot;&nbsp; ${issuedDate}</span>
  </div>

  <div class="body-content">
  <div class="parties">
    <div class="party">
      <h3>Emisor</h3>
      <p><strong>${legal.name}</strong><br/>
      ${legalAddressFull}<br/>
      CIF: ${legal.cif}${legal.iban ? `<br/>IBAN: ${legal.iban}` : ""}</p>
    </div>
    <div class="party">
      <h3>Cliente</h3>
      <p><strong>${invoice.clientName}</strong><br/>
      ${invoice.clientEmail}<br/>
      ${invoice.clientPhone ? invoice.clientPhone + "<br/>" : ""}
      ${invoice.clientNif ? "NIF: " + invoice.clientNif + "<br/>" : ""}
      ${invoice.clientAddress || ""}</p>
    </div>
  </div>
${look.afterParties}
  <table>
    <thead>
      <tr>
        <th>Descripción</th>
        <th style="text-align:center">Cant.</th>
        <th style="text-align:right">Precio unit.</th>
        <th style="text-align:right">Total</th>
      </tr>
    </thead>
    <tbody>${itemRows}</tbody>
  </table>

  <div class="totals-wrap"><table class="totals">
    ${hasGeneral && hasReav ? `
    <tr><td style="color:#6b7280;font-size:13px;">Subtotal rég. general</td><td>${generalItems.reduce((s,i) => s+i.total,0).toFixed(2)} €</td></tr>
    <tr><td style="color:#6b7280;font-size:13px;">Subtotal REAV (sin IVA)</td><td>${reavItems.reduce((s,i) => s+i.total,0).toFixed(2)} €</td></tr>
    ` : `<tr><td>Subtotal</td><td>${(hasDiscount ? invoice.itemsJson.reduce((s, i) => s + Number(i.total), 0) : Number(invoice.subtotal)).toFixed(2)} €</td></tr>`}
    ${hasDiscount ? `<tr><td style="color:#15803d;font-size:13px;">Descuento${invoice.discountReason ? ` <span style="color:#9ca3af;font-size:11px;">— ${invoice.discountReason}</span>` : ""}</td><td style="color:#15803d;font-weight:600;">-${Number(invoice.discount).toFixed(2)} €</td></tr>` : ""}
    ${hasGeneral && isMultiRate ? breakdown.map(b =>
      `<tr><td style="color:#6b7280;font-size:12px;">Base imponible IVA ${b.rate}%</td><td>${b.base.toFixed(2)} €</td></tr>` +
      `<tr><td>IVA ${b.rate}%</td><td>${b.amount.toFixed(2)} €</td></tr>`
    ).join("") : ""}
    ${hasGeneral && !isMultiRate && breakdown.length === 1 ? `
    <tr><td style="color:#6b7280;font-size:12px;">Base imponible IVA ${breakdown[0].rate}%</td><td>${breakdown[0].base.toFixed(2)} €</td></tr>
    <tr><td>IVA (${breakdown[0].rate}%)</td><td>${breakdown[0].amount.toFixed(2)} €</td></tr>` : ""}
    ${hasGeneral && breakdown.length === 0 ? `<tr><td>IVA (${invoice.taxRate}%)</td><td>${Number(invoice.taxAmount).toFixed(2)} €</td></tr>` : ""}
    ${hasReav && !hasGeneral ? `<tr><td style="font-size:12px;color:#6b7280;font-style:italic;" colspan="2">Operación sujeta al Régimen Especial de Agencias de Viaje (REAV). No procede repercusión de IVA al cliente.</td></tr>` : ''}
    ${exemptionReasons.map((r) => `<tr><td style="font-size:12px;color:#6b7280;font-style:italic;" colspan="2">IVA 0 %: ${r}</td></tr>`).join("")}
    <tr class="total-row"><td>TOTAL</td><td>${Number(invoice.total).toFixed(2)} €</td></tr>
  </table></div>
  </div>
  <div class="footer">
    <p>Gracias por confiar en ${escapeHtml(look.brand.name)}${websiteUrl ? " &middot; " + websiteUrl : ""}</p>
    <p>Documento emitido por <strong>${legal.name}</strong> &mdash; CIF: ${legal.cif} &mdash; ${legalAddressFull}</p>${look.footerNote}
  </div>
</body>
</html>`;
}

