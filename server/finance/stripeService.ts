/**
 * Servicio de la fase 2 (CRM 0036): Stripe como TPV principal. Importa los informes CSV de Stripe, contabiliza a través
 * del libro de la fase 1A (`FinanceService.postGenerated` / `reverse`) y concilia factura ↔ cobro ↔ payout ↔ banco.
 *
 * Origen único de cada hecho (contrato §0): el cobro, la comisión, el reembolso y la disputa salen de la transacción de
 * saldo importada (`stripe-txn:<id>`); la liquidación, del payout (`stripe-payout:<id>`, fecha de llegada); su llegada
 * al banco se VINCULA al asiento del payout sin crear otro; el cobro de una factura por transferencia es un movimiento
 * bancario conciliado como `invoice_payment` (`bankmov:<id>`). Los webhooks, `commercial_events`, `stripe_invoices` y
 * el estado de cobro de las facturas son solo referencia: aquí nunca se escriben ni se contabilizan desde ellos.
 */
import { madridDateKey } from "../utils/timezone";
import { invoiceLockKey, memoryKeyedLock, type KeyedLock, type OwnInvoice, type OwnInvoiceDirectory } from "./ownInvoices";
import { decodeText, safeFilename, sha256Hex, MAX_DOCUMENT_BYTES } from "./opsRules";
import type { FinanceOpsStore } from "./opsStore";
import type { BankMovement } from "./opsTypes";
import type { BankReconciliationExtension } from "./opsService";
import { addDays } from "./opsRules";
import { balancesOf, isValidDate } from "./rules";
import type { FinanceService } from "./service";
import type { FinanceStore } from "./store";
import {
  checkFeeVatRule,
  feeBaseOf,
  parseBalanceCsv,
  parsePayoutsCsv,
  reconciliationStatus,
  resolveFeeVat,
  SELF_POSTED_TYPES,
  STRIPE_ACCOUNTS,
  stripePayoutEntry,
  stripeTxnEntry,
  suggestStripeMatches,
  txnIssue,
  type FeeVatRuleInput,
  type InvoiceRef,
  type ReconciliationStatus,
  type StripeMatchSuggestion,
} from "./stripeRules";
import { isPayoutType, LIVE_PAYOUT_STATUSES, type FinanceStripeStore, type NewStripeImport, type PayoutQuery, type TxnQuery } from "./stripeStore";
import { FEE_VAT_MODES, type FeeVatMode, type ParsedPayout, type ParsedStripeTxn, type ResolvedFeeVat, type StripeImport, type StripeImportKind, type StripeIssue, type StripePayout, type StripeSettings, type StripeTxn, type StripeTxnStatus } from "./stripeTypes";
import { isEu } from "./taxRules";
import { FinanceError, type EntryDraft, type FinanceActor } from "./types";

export interface FinanceStripeDeps {
  store: FinanceStripeStore;
  finance: FinanceService;
  /** Operaciones (fase 1B): cuentas bancarias y movimientos para la conciliación. */
  ops: FinanceOpsStore;
  ledger: Pick<FinanceStore, "postedLines" | "listAccounts" | "getEntry">;
  /** Facturas propias (solo lectura). Sin ellas los cobros quedan «sin factura» y no hay vista por factura. */
  invoices?: OwnInvoiceDirectory | null;
  /** Cerrojo por clave (MySQL: GET_LOCK) que serializa los cobros por transferencia de una misma factura. */
  lock?: KeyedLock;
  /** Facturas de Stripe registradas por el cobro (`stripe_invoices`, solo lectura), para explicar un cobro sin factura. */
  stripeInvoices?: { known(ids: string[]): Promise<Set<string>> } | null;
  /** Migración 0039 aplicada: reglas de IVA de las comisiones y modo global `unset` por defecto. */
  fiscal?: boolean;
  now?: () => number;
}

const nextMonth = (ym: string) => {
  const y = Number(ym.slice(0, 4));
  const m = Number(ym.slice(5, 7));
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
};

/** Motivo que queda en una transacción pendiente por no tener decidido el IVA de su comisión. */
export const FEE_VAT_UNSET_DETAIL = "fee_vat_unset: el IVA de la comisión de Stripe no está configurado (regla por tipo o modo global)";

/** Asiento de la vista previa: solo cuentas e importes (no se guarda nada). */
const previewEntry = (id: string, d: EntryDraft) => ({ balanceTransactionId: id, date: d.date, description: d.description, lines: d.lines.map((l) => ({ account: l.accountCode, debitCents: l.debitCents, creditCents: l.creditCents })) });

export type { OwnInvoice };

const bad = (m: string) => new FinanceError("invalid_input", m);
const notFound = (what: string) => new FinanceError("not_found", `${what} no encontrado`);
/** Facturas leídas por página en la vista por factura con filtro de estado (se recorren todas). */
const INVOICE_PAGE = 500;
/** Candidatas a un cobro por transferencia que se puntúan como mucho (las más recientes del último año). */
const INVOICE_CANDIDATES = 500;
/** Transacciones contabilizadas como mucho por pasada (repetir si hay más: `truncated`). */
const POST_BATCH = 5_000;

const refOf = (o: OwnInvoice): InvoiceRef => ({ id: o.id, number: o.number, companyId: o.companyId, totalCents: o.totalCents });

export interface PostResult {
  posted: number;
  skipped: number;
  errors: Array<{ transactionId: string; message: string }>;
  /** Quedaron más transacciones de las que se procesan en una pasada: repetir. */
  truncated: boolean;
  /** CRM 0039: transacciones que quedan pendientes porque el IVA de su comisión no está configurado (`fee_vat_unset`). */
  pendingFeeVat?: number;
}

export class FinanceStripeService implements BankReconciliationExtension {
  private readonly now: () => number;
  private readonly lock: KeyedLock;
  constructor(private readonly d: FinanceStripeDeps) {
    this.now = d.now ?? Date.now;
    this.lock = d.lock ?? memoryKeyedLock();
  }

  today(): string {
    return madridDateKey(new Date(this.now()));
  }
  private get s() {
    return this.d.store;
  }
  private audit(actor: FinanceActor, action: string, entity: string, id: string | number | null, summary: Record<string, unknown> | null) {
    return this.d.finance.recordAudit(actor, action, entity, id, summary);
  }

  // ── Configuración ─────────────────────────────────────────────────────────────────────────────────────────────

  /** ¿Está aplicada la migración 0039 (reglas de IVA de las comisiones; modo global `unset` por defecto)? */
  get fiscal() {
    return !!this.d.fiscal;
  }

  /**
   * Configuración vigente. CRM 0039: si nadie la ha guardado, el IVA de las comisiones queda `unset` (no se presupone
   * la exención); sin la migración, el valor por defecto anterior (`exempt`).
   */
  async settings(): Promise<StripeSettings> {
    const s = await this.s.getSettings();
    return this.fiscal && s.updatedAt === null ? { ...s, stripeFeeVat: "unset" } : s;
  }

  /** Configuración de Stripe (rol admin|superadmin en la API). Cambio parcial; se valida contra el plan y los bancos. */
  async saveSettings(p: { stripeFeeVat?: FeeVatMode; feeVatRateBp?: number; stripePayoutBankAccountId?: number | null; disputeAccountCode?: string }, actor: FinanceActor): Promise<StripeSettings> {
    const cur = await this.settings();
    // Siempre se escribe el valor explícito (la columna tiene un valor por defecto de la fase 2 que no se usa)
    const next = {
      stripeFeeVat: p.stripeFeeVat ?? cur.stripeFeeVat,
      feeVatRateBp: p.feeVatRateBp ?? cur.feeVatRateBp,
      stripePayoutBankAccountId: p.stripePayoutBankAccountId === undefined ? cur.stripePayoutBankAccountId : p.stripePayoutBankAccountId,
      disputeAccountCode: (p.disputeAccountCode ?? cur.disputeAccountCode).trim(),
    };
    const modes: readonly FeeVatMode[] = this.fiscal ? FEE_VAT_MODES : ["exempt", "reverse_charge"];
    if (!modes.includes(next.stripeFeeVat)) throw bad(`IVA de las comisiones: ${modes.map((m) => `«${m}»`).join(", ")}`);
    if (!Number.isInteger(next.feeVatRateBp) || next.feeVatRateBp < 0 || next.feeVatRateBp > 10_000) throw bad("Tipo de IVA no válido (puntos básicos, 2100 = 21 %)");
    if (next.stripePayoutBankAccountId !== null) {
      const b = await this.d.ops.getBankAccount(next.stripePayoutBankAccountId);
      if (!b || !b.active) throw bad("La cuenta bancaria de los payouts no existe o está desactivada");
    }
    const acc = (await this.d.ledger.listAccounts()).find((a) => a.code === next.disputeAccountCode);
    if (!acc || !acc.active || !acc.isPostable || !next.disputeAccountCode.startsWith("43")) throw bad("La cuenta de las disputas es una cuenta de clientes imputable y activa (430, 436…)");
    const saved = await this.s.saveSettings(next, actor.by, this.now());
    await this.audit(actor, "stripe.settings", "stripe_settings", 1, { ...next });
    return saved;
  }

  // ── IVA de las comisiones por tipo y periodo (CRM 0039) ───────────────────────────────────────────────────────

  private needFiscal() {
    if (!this.fiscal) throw new FinanceError("unavailable", "Las reglas de IVA de las comisiones llegan con la migración 0039, que no está aplicada en este entorno");
  }

  feeVatRules() {
    this.needFiscal();
    return this.s.listFeeVatRules();
  }

  /** Alta de una regla (sin edición: para cambiarla, se anula y se crea otra). */
  async createFeeVatRule(i: FeeVatRuleInput, actor: FinanceActor) {
    this.needFiscal();
    const r = checkFeeVatRule(i, { isEu });
    const row = await this.s.insertFeeVatRule({ ...r, createdBy: actor.by, createdAt: this.now() });
    await this.audit(actor, "stripe.fee_vat_rule.create", "stripe_fee_vat_rule", row.id, { feeKind: row.feeKind, treatment: row.treatment, rateBp: row.rateBp, issuerCountry: row.issuerCountry, validFrom: row.validFrom, validTo: row.validTo });
    return row;
  }

  async voidFeeVatRule(id: number, reason: string, actor: FinanceActor) {
    this.needFiscal();
    const why = (reason ?? "").trim();
    if (why.length < 3 || why.length > 300) throw bad("Indica el motivo de la anulación (3 a 300 caracteres)");
    const r = await this.s.getFeeVatRule(id);
    if (!r) throw notFound("Regla");
    if (!(await this.s.voidFeeVatRule(id, { by: actor.by, at: this.now(), reason: why }))) throw new FinanceError("invalid_state", "La regla ya está anulada");
    await this.audit(actor, "stripe.fee_vat_rule.void", "stripe_fee_vat_rule", id, { reason: why });
    return (await this.s.getFeeVatRule(id))!;
  }

  /** Resolutor del IVA de las comisiones con la configuración y las reglas de este momento (una lectura). */
  private async feeResolver(settings?: StripeSettings): Promise<(t: Pick<ParsedStripeTxn, "type" | "rawType" | "createdOn">) => ResolvedFeeVat> {
    const s = settings ?? (await this.settings());
    const rules = this.fiscal ? await this.s.listFeeVatRules() : [];
    return (t) => resolveFeeVat(t, rules, s);
  }

  // ── Facturas de comisiones de Stripe (CRM 0039, `settlesStripeFees`) ──────────────────────────────────────────

  /** Modo del IVA de las comisiones resuelto en una fecha (para un cobro: regla `charge`, después `*`, después el global). */
  async feeModeOn(date: string): Promise<FeeVatMode> {
    return (await this.feeResolver())({ type: "charge", rawType: "charge", createdOn: date }).treatment;
  }

  /** ¿Es el proveedor la entidad de Stripe? Nombre o razón social con «Stripe», o el NIF-IVA de una regla de comisiones. */
  async isStripeIssuer(sup: { name: string; legalName: string | null; taxId: string | null }): Promise<boolean> {
    if (/\bstripe\b/i.test(`${sup.name} ${sup.legalName ?? ""}`)) return true;
    const id = (sup.taxId ?? "").toUpperCase().replace(/[\s.-]/g, "");
    if (!id || !this.fiscal) return false;
    return (await this.s.listFeeVatRules()).some((r) => r.issuerVatId === id);
  }

  /**
   * Comisiones importadas por mes (base: comisión de cada transacción en euros y, en los cargos de Stripe por otros
   * servicios, el propio cargo) y el modo resuelto ese mes (a su último día), para avisar de las facturas de comisiones
   * que faltan o no cuadran en modo `per_invoice`.
   */
  async feeMonths(from: string, to: string): Promise<Array<{ month: string; mode: FeeVatMode; feeBaseCents: number }>> {
    if (!this.fiscal) return [];
    const resolve = await this.feeResolver();
    const out: Array<{ month: string; mode: FeeVatMode; feeBaseCents: number }> = [];
    for (let m = from.slice(0, 7); m <= to.slice(0, 7); m = nextMonth(m)) {
      const first = `${m}-01` < from ? from : `${m}-01`;
      const lastDay = new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).toISOString().slice(0, 10);
      const last = lastDay > to ? to : lastDay;
      const agg = await this.s.aggregates(first, last);
      const feeBaseCents = agg.reduce((a, x) => a + x.feeCents + (x.type === "stripe_fee" ? -x.grossCents : 0), 0);
      if (feeBaseCents !== 0) out.push({ month: m, mode: resolve({ type: "charge", rawType: "charge", createdOn: last }).treatment, feeBaseCents });
    }
    return out;
  }

  /** ¿Se queda sin contabilizar por no tener decidido el IVA de su comisión? (solo con comisión). */
  private static feeVatUnset(t: Pick<ParsedStripeTxn, "type" | "feeCents" | "grossCents">, f: ResolvedFeeVat) {
    return f.treatment === "unset" && SELF_POSTED_TYPES.includes(t.type) && feeBaseOf(t) !== 0;
  }

  /**
   * Transacciones en euros pendientes de contabilizar cuyo IVA de la comisión está sin decidir (`fee_vat_unset`),
   * opcionalmente solo las de un rango de fechas. 0 sin la migración 0039 (entonces el modo global nunca es `unset`).
   */
  async pendingFeeVatCount(from?: string, to?: string): Promise<number> {
    if (!this.fiscal) return 0;
    const resolve = await this.feeResolver();
    const pending = await this.s.postableTransactions(to ?? "9999-12-31", POST_BATCH);
    return pending.filter((t) => (!from || t.createdOn >= from) && FinanceStripeService.feeVatUnset(t, resolve(t))).length;
  }

  /**
   * Vista previa de una importación SIN ESCRIBIR NADA (ni la importación, ni transacciones, ni asientos, ni auditoría):
   * lo que se leería del fichero, lo que ya está importado, los totales, cómo se resolvería el IVA de cada comisión y
   * los asientos que se contabilizarían (hasta 50). Es lo que se usa con un CSV real antes de importarlo.
   */
  async previewImport(i: { kind: StripeImportKind; filename: string; contentBase64: string }) {
    const buf = this.decode(i.contentBase64);
    const sha = sha256Hex(buf);
    const prev = await this.s.findImport(i.kind, sha);
    const text = decodeText(buf);
    const settings = await this.settings();
    const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
    const base = { kind: i.kind, filename: safeFilename(i.filename), alreadyImported: !!prev, previousImportId: prev?.id ?? null };
    if (i.kind === "payouts") {
      const { rows, problems } = parsePayoutsCsv(text);
      const known = new Set((await this.s.payoutsByStripeIds(rows.map((r) => r.payoutId))).map((p) => p.payoutId));
      const bank = settings.stripePayoutBankAccountId ? await this.d.ops.getBankAccount(settings.stripePayoutBankAccountId) : null;
      const warnings = problems.map((p) => ({ line: p.line, message: p.message }));
      if (!bank) warnings.push({ line: 0, message: "Sin cuenta bancaria de destino configurada: los payouts no se contabilizarían" });
      const fresh = rows.filter((r) => !known.has(r.payoutId) && r.currency === "EUR" && r.status !== "failed" && r.status !== "canceled");
      return {
        ...base,
        rows: rows.length + problems.length,
        parsed: rows.length,
        skipped: problems.length,
        warnings,
        duplicates: rows.filter((r) => known.has(r.payoutId)).length,
        sample: rows.slice(0, 20),
        totals: { grossCents: sum(rows.map((r) => r.amountCents)), feeCents: sum(rows.map((r) => r.feeCents)), netCents: sum(rows.map((r) => r.amountCents)), byType: Object.fromEntries(Array.from(new Set(rows.map((r) => r.status))).map((st) => [st, { count: rows.filter((r) => r.status === st).length, grossCents: sum(rows.filter((r) => r.status === st).map((r) => r.amountCents)), feeCents: 0, netCents: sum(rows.filter((r) => r.status === st).map((r) => r.amountCents)) }])) },
        feeVat: null,
        wouldPost: bank ? fresh.slice(0, 50).map((p) => previewEntry(p.payoutId, stripePayoutEntry(p, bank.accountCode))) : [],
        nonEur: rows.filter((r) => r.currency !== "EUR").length,
      };
    }
    const { rows, problems } = parseBalanceCsv(text);
    const known = await this.s.knownTransactionIds(rows.map((r) => r.balanceTransactionId));
    const resolve = await this.feeResolver(settings);
    const resolved: Record<string, number> = {};
    let unset = 0;
    const wouldPost: ReturnType<typeof previewEntry>[] = [];
    const warnings = problems.map((p) => ({ line: p.line, message: p.message }));
    for (const r of rows) {
      if (r.currency !== "EUR" || !SELF_POSTED_TYPES.includes(r.type)) continue;
      const f = resolve(r);
      if (FinanceStripeService.feeVatUnset(r, f)) {
        unset++;
        continue;
      }
      if (feeBaseOf(r) !== 0) resolved[f.treatment] = (resolved[f.treatment] ?? 0) + 1;
      if (known.has(r.balanceTransactionId) || wouldPost.length >= 50) continue;
      try {
        wouldPost.push(previewEntry(r.balanceTransactionId, stripeTxnEntry(r, settings, null, f)));
      } catch (e) {
        if (!(e instanceof FinanceError)) throw e;
        warnings.push({ line: 0, message: `${r.balanceTransactionId}: ${e.message}` });
      }
    }
    if (unset) warnings.push({ line: 0, message: `${unset} transacciones con comisión sin tratamiento de IVA configurado: no se contabilizarían (fee_vat_unset)` });
    const byType: Record<string, { count: number; grossCents: number; feeCents: number; netCents: number }> = {};
    const eur = rows.filter((r) => r.currency === "EUR");
    for (const r of eur) {
      const g = (byType[r.type] ??= { count: 0, grossCents: 0, feeCents: 0, netCents: 0 });
      g.count++;
      g.grossCents += r.grossCents;
      g.feeCents += r.feeCents;
      g.netCents += r.netCents;
    }
    return {
      ...base,
      rows: rows.length + problems.length,
      parsed: rows.length,
      skipped: problems.length,
      warnings,
      duplicates: known.size,
      sample: rows.slice(0, 20),
      // Totales de las filas en euros (las de otra moneda se importan sin contabilizar: `nonEur`)
      totals: { grossCents: sum(eur.map((r) => r.grossCents)), feeCents: sum(eur.map((r) => r.feeCents)), netCents: sum(eur.map((r) => r.netCents)), byType },
      feeVat: { resolved, unset },
      wouldPost,
      nonEur: rows.length - eur.length,
    };
  }

  // ── Importación ───────────────────────────────────────────────────────────────────────────────────────────────

  private decode(b64: string) {
    const clean = (b64 ?? "").replace(/\s+/g, "");
    if (!clean || !/^[A-Za-z0-9+/]*={0,2}$/.test(clean) || clean.length % 4 !== 0) throw bad("El contenido no es base64 válido");
    if ((clean.length / 4) * 3 > MAX_DOCUMENT_BYTES + 3) throw bad("El fichero supera el máximo de 10 MB");
    const buf = Buffer.from(clean, "base64");
    if (!buf.length) throw bad("El fichero está vacío");
    return buf;
  }

  /** Estado inicial de una transacción al importarla: moneda no euro y tipos no contabilizables quedan con aviso. */
  private initialStatus(r: ParsedStripeTxn): { status: StripeTxnStatus; issue: StripeIssue | null } {
    if (r.currency !== "EUR") return { status: "pending", issue: "currency" };
    if (r.type === "other") return { status: "pending", issue: "unsupported" };
    return { status: "pending", issue: null };
  }

  /**
   * Importa un informe de Stripe. El mismo fichero dos veces → `conflict`; las transacciones o payouts ya conocidos
   * cuentan como duplicados (los payouts conocidos refrescan su estado). Las filas ilegibles se devuelven como avisos.
   */
  async importFile(i: { kind: StripeImportKind; filename: string; contentBase64: string }, actor: FinanceActor): Promise<StripeImport> {
    const buf = this.decode(i.contentBase64);
    const sha = sha256Hex(buf);
    const prev = await this.s.findImport(i.kind, sha);
    if (prev) throw new FinanceError("conflict", `Este fichero ya se importó (importación n.º ${prev.id}, ${prev.inserted} filas nuevas)`);
    const text = decodeText(buf);
    const base = { kind: i.kind, filename: safeFilename(i.filename), sha256: sha, importedBy: actor.by, createdAt: this.now() };
    let imp: StripeImport;
    if (i.kind === "balance") {
      const { rows, problems } = parseBalanceCsv(text);
      if (!rows.length) throw bad(`El fichero no tiene transacciones legibles${problems.length ? ` (${problems[0].message}, línea ${problems[0].line})` : ""}`);
      imp = await this.s.importTransactions({ ...base, rows: rows.length + problems.length, nonEur: rows.filter((r) => r.currency !== "EUR").length, errors: problems.length, problems }, rows, (r) => this.initialStatus(r));
    } else {
      const { rows, problems } = parsePayoutsCsv(text);
      if (!rows.length) throw bad(`El fichero no tiene payouts legibles${problems.length ? ` (${problems[0].message}, línea ${problems[0].line})` : ""}`);
      imp = await this.s.importPayouts({ ...base, rows: rows.length + problems.length, nonEur: rows.filter((r) => r.currency !== "EUR").length, errors: problems.length, problems }, rows);
    }
    await this.audit(actor, "stripe_import.create", "stripe_import", imp.id, { kind: i.kind, rows: imp.rows, inserted: imp.inserted, duplicates: imp.duplicates, refreshed: imp.refreshed, nonEur: imp.nonEur, errors: imp.errors, sha256: sha });
    return imp;
  }

  /**
   * Importa lo leído por la API de Stripe (`StripeApiBalanceReader`) con el mismo almacén que los informes CSV: cada
   * transacción y cada payout entra una sola vez (`UNIQUE(provider, id)`), venga de la API o de un fichero. Una lectura
   * idéntica a una ya importada no crea otra importación. Devuelve las importaciones creadas.
   */
  async importFromApi(r: { txns: ParsedStripeTxn[]; payouts: ParsedPayout[] }, actor: FinanceActor): Promise<{ balance: StripeImport | null; payouts: StripeImport | null }> {
    const day = this.today();
    const one = async <T extends { currency: string }>(kind: StripeImportKind, rows: T[], key: (x: T) => string, save: (base: NewStripeImport) => Promise<StripeImport>) => {
      if (!rows.length) return null;
      const sha = sha256Hex(Buffer.from(JSON.stringify(rows.map(key).sort())));
      if (await this.s.findImport(kind, sha)) return null;
      const imp = await save({ kind, filename: `api-stripe-${kind}-${day}`, sha256: sha, importedBy: actor.by, createdAt: this.now(), rows: rows.length, nonEur: rows.filter((x) => x.currency !== "EUR").length, errors: 0, problems: [] });
      await this.audit(actor, "stripe_import.api", "stripe_import", imp.id, { kind, rows: imp.rows, inserted: imp.inserted, duplicates: imp.duplicates, refreshed: imp.refreshed, nonEur: imp.nonEur });
      return imp;
    };
    const balance = await one("balance", r.txns, (t) => t.balanceTransactionId, (base) => this.s.importTransactions(base, r.txns, (t) => this.initialStatus(t)));
    const payouts = await one("payouts", r.payouts, (p) => `${p.payoutId}:${p.status}:${p.arrivalOn}`, (base) => this.s.importPayouts(base, r.payouts));
    return { balance, payouts };
  }

  imports() {
    return this.s.listImports(100);
  }

  // ── Facturas propias (solo lectura) ───────────────────────────────────────────────────────────────────────────

  private get invoices(): OwnInvoiceDirectory {
    if (!this.d.invoices) throw new FinanceError("unavailable", "La facturación propia no está montada en este entorno (migración 0027)");
    return this.d.invoices;
  }

  /** Facturas propias por id (para mostrar su número); vacío sin facturación propia. */
  private async invoicesById(ids: Array<number | null>): Promise<Map<number, OwnInvoice>> {
    const want = Array.from(new Set(ids.filter((x): x is number => x !== null)));
    if (!this.d.invoices || !want.length) return new Map();
    return new Map((await this.d.invoices.byIds(want)).map((o) => [o.id, o]));
  }

  // ── Transacciones y payouts ───────────────────────────────────────────────────────────────────────────────────

  private payoutDto(p: StripePayout, txns: StripeTxn[], bank: BankMovement | null) {
    const included = txns.filter((t) => t.stripePayoutId === p.payoutId && !isPayoutType(t.type));
    const transactionsCents = included.reduce((a, t) => a + t.netCents, 0);
    return {
      id: p.id,
      stripePayoutId: p.payoutId,
      createdOn: p.createdOn,
      arrivalOn: p.arrivalOn,
      currency: p.currency,
      amountCents: p.amountCents,
      feeCents: p.feeCents,
      status: p.status,
      description: p.description,
      origin: p.origin,
      transactionsCount: included.length,
      transactionsCents,
      /** null sin transacciones importadas de ese payout (no se puede comprobar). */
      differenceCents: included.length ? p.amountCents - transactionsCents : null,
      bankMovementId: p.bankMovementId,
      bankBookingDate: bank?.bookingDate ?? null,
      bankLinkedAt: p.bankLinkedAt,
      entryId: p.entryId,
      reversalEntryId: p.reversalEntryId,
    };
  }

  private txnDto(t: StripeTxn, own: Map<number, OwnInvoice>, payouts: Map<string, StripePayout>) {
    const p = t.stripePayoutId ? payouts.get(t.stripePayoutId) : undefined;
    return {
      id: t.id,
      balanceTransactionId: t.balanceTransactionId,
      type: t.type,
      rawType: t.rawType,
      createdOn: t.createdOn,
      availableOn: t.availableOn,
      grossCents: t.grossCents,
      feeCents: t.feeCents,
      netCents: t.netCents,
      currency: t.currency,
      description: t.description,
      customerEmail: t.customerEmail,
      chargeId: t.chargeId,
      sourceId: t.sourceId,
      invoiceRef: t.stripeInvoiceId,
      ownInvoiceId: t.ownInvoiceId,
      ownInvoiceNumber: t.ownInvoiceId ? (own.get(t.ownInvoiceId)?.number ?? null) : null,
      payoutId: p?.id ?? null,
      stripePayoutId: t.stripePayoutId,
      payoutArrivalOn: p?.arrivalOn ?? null,
      entryId: t.entryId,
      status: t.status,
      issue: t.issue,
      issueDetail: t.issueDetail,
      issueReviewedAt: t.issueReviewedAt,
      issueReviewedBy: t.issueReviewedBy,
      issueNote: t.issueNote,
    };
  }

  private async payoutMap(ids: Array<string | null>) {
    const list = await this.s.payoutsByStripeIds(Array.from(new Set(ids.filter((x): x is string => !!x))));
    return new Map(list.map((p) => [p.payoutId, p]));
  }

  /** Filtro `payout`: identificador de Stripe (po_…) o número interno del payout. */
  async transactions(q: Omit<TxnQuery, "payout"> & { payout?: string }) {
    let payout = q.payout;
    if (payout && /^\d+$/.test(payout)) payout = (await this.s.getPayout(Number(payout)))?.payoutId ?? "po_inexistente";
    const out = await this.s.listTransactions({ ...q, payout });
    const [byId, pm] = await Promise.all([this.invoicesById(out.items.map((t) => t.ownInvoiceId)), this.payoutMap(out.items.map((t) => t.stripePayoutId))]);
    return { items: out.items.map((t) => this.txnDto(t, byId, pm)), total: out.total };
  }

  async payouts(q: PayoutQuery) {
    const out = await this.s.listPayouts(q);
    const [txns, banks] = await Promise.all([this.s.transactionsByPayout(out.items.map((p) => p.payoutId)), this.d.ops.getMovementsByIds(out.items.map((p) => p.bankMovementId).filter((x): x is number => x !== null))]);
    const bm = new Map(banks.map((b) => [b.id, b]));
    return { items: out.items.map((p) => this.payoutDto(p, txns, p.bankMovementId ? (bm.get(p.bankMovementId) ?? null) : null)), total: out.total };
  }

  private async payout(id: number) {
    const p = await this.s.getPayout(id);
    if (!p) throw notFound("Payout");
    return p;
  }

  /** Vista por payout (§4): transacciones incluidas, suma frente al importe y movimiento bancario vinculado. */
  async reconciliationPayout(id: number) {
    const p = await this.payout(id);
    const [txns, banks] = await Promise.all([this.s.transactionsByPayout([p.payoutId]), this.d.ops.getMovementsByIds(p.bankMovementId ? [p.bankMovementId] : [])]);
    const byId = await this.invoicesById(txns.map((t) => t.ownInvoiceId));
    const bank = banks[0] ?? null;
    const pm = new Map([[p.payoutId, p]]);
    return {
      ...this.payoutDto(p, txns, bank),
      transactions: txns.sort((a, b) => a.createdOn.localeCompare(b.createdOn) || a.id - b.id).map((t) => this.txnDto(t, byId, pm)),
      bankMovement: bank ? { id: bank.id, bankAccountId: bank.bankAccountId, bookingDate: bank.bookingDate, valueDate: bank.valueDate, amountCents: bank.amountCents, description: bank.description, status: bank.status } : null,
    };
  }

  // ── Contabilización ───────────────────────────────────────────────────────────────────────────────────────────

  /** Factura propia de una transacción: por su factura de Stripe o, en reembolsos y disputas, por la del cobro original. */
  private async invoiceFor(t: StripeTxn, idx: { byStripe: Map<string, OwnInvoice>; byId: Map<number, OwnInvoice> }, chargeOwn: Map<string, number>) {
    if (t.stripeInvoiceId) {
      const o = idx.byStripe.get(t.stripeInvoiceId);
      if (o) return o;
    }
    if (t.type !== "charge" && t.chargeId) {
      const id = chargeOwn.get(t.chargeId);
      if (id) return idx.byId.get(id) ?? null;
    }
    return null;
  }

  /**
   * Contabiliza lo pendiente con fecha hasta `until` (hoy por defecto). Idempotente: cada hecho tiene su `source_key`
   * y repetirlo no crea nada. Primero las transacciones con asiento propio; después los payouts (fallidos: reversión;
   * vigentes con llegada hasta `until`: asiento contra el banco configurado).
   */
  async post(until: string | undefined, actor: FinanceActor): Promise<PostResult> {
    const u = until ?? this.today();
    if (!isValidDate(u)) throw bad("Fecha no válida (AAAA-MM-DD)");
    const settings = await this.settings();
    const out: PostResult = { posted: 0, skipped: 0, errors: [], truncated: false, ...(this.fiscal ? { pendingFeeVat: 0 } : {}) };
    const resolve = await this.feeResolver(settings);
    const batch = await this.s.postableTransactions(u, POST_BATCH);
    out.truncated = batch.length >= POST_BATCH;
    const chargeIds = Array.from(new Set(batch.filter((t) => t.type !== "charge" && t.chargeId).map((t) => t.chargeId!)));
    const chargeOwn = new Map<string, number>();
    for (const c of await this.s.transactionsByCharge(chargeIds)) if (c.type === "charge" && c.chargeId && c.ownInvoiceId) chargeOwn.set(c.chargeId, c.ownInvoiceId);
    // Solo las facturas que hacen falta: las de las facturas de Stripe del lote y las de los cobros originales
    const stripeIds = Array.from(new Set(batch.map((t) => t.stripeInvoiceId).filter((x): x is string => !!x)));
    const byStripe = new Map<string, OwnInvoice>();
    if (this.d.invoices) for (const o of await this.d.invoices.byStripeIds(stripeIds)) byStripe.set(o.paymentRef!.slice("stripe:in:".length), o);
    const byId = await this.invoicesById(Array.from(chargeOwn.values()));
    for (const o of Array.from(byStripe.values())) byId.set(o.id, o);
    const idx = { byStripe, byId };
    const known = this.d.stripeInvoices ? await this.d.stripeInvoices.known(Array.from(new Set(batch.map((t) => t.stripeInvoiceId).filter((x): x is string => !!x)))) : new Set<string>();

    for (const t of batch) {
      if (isPayoutType(t.type)) continue;
      if (!SELF_POSTED_TYPES.includes(t.type)) {
        out.skipped++;
        continue;
      }
      // CRM 0039: sin tratamiento del IVA de la comisión, la transacción se queda pendiente (nada se contabiliza a ciegas)
      const fee = resolve(t);
      if (FinanceStripeService.feeVatUnset(t, fee)) {
        out.pendingFeeVat = (out.pendingFeeVat ?? 0) + 1;
        if (t.status !== "pending" || t.issueDetail !== FEE_VAT_UNSET_DETAIL) await this.s.markTransaction(t.id, { status: "pending", issueDetail: FEE_VAT_UNSET_DETAIL });
        continue;
      }
      const own = await this.invoiceFor(t, idx, chargeOwn);
      const ref = own ? refOf(own) : null;
      try {
        const { entry, created } = await this.d.finance.postGenerated(stripeTxnEntry(t, settings, ref, fee), actor);
        if (created) out.posted++;
        else out.skipped++;
        const issue = txnIssue(t, ref);
        const issueDetail =
          issue === "no_invoice"
            ? t.stripeInvoiceId && known.has(t.stripeInvoiceId)
              ? `La factura de Stripe ${t.stripeInvoiceId} está registrada en el cobro pero ninguna factura propia la tiene como cobro`
              : "Ninguna factura propia tiene este cobro: revisa el cliente (no se inventa)"
            : issue === "amount_mismatch"
              ? `Cobrado ${t.grossCents} céntimos; la factura ${own?.number ?? ""} es de ${own?.totalCents ?? 0}`
              : null;
        await this.s.markTransaction(t.id, { status: "posted", entryId: entry.id, ownInvoiceId: own?.id ?? null, issue, issueDetail, postedAt: this.now() });
        if (t.type === "charge" && t.chargeId && own) {
          chargeOwn.set(t.chargeId, own.id);
          idx.byId.set(own.id, own);
        }
        // Disputa ganada: las retenciones de ese cobro quedan resueltas
        if (t.type === "dispute_reversal" && t.chargeId)
          for (const dsp of await this.s.transactionsByCharge([t.chargeId])) if (dsp.type === "dispute") await this.s.reviewIssue(dsp.id, actor.by, this.now(), `Disputa ganada (${t.balanceTransactionId})`);
      } catch (e) {
        if (!(e instanceof FinanceError)) throw e;
        await this.s.markTransaction(t.id, { status: "error", issueDetail: `No se pudo contabilizar: ${e.message}`.slice(0, 300) });
        out.errors.push({ transactionId: t.balanceTransactionId, message: e.message });
      }
    }

    await this.postPayouts(u, settings, actor, out);
    await this.audit(actor, "stripe.post", "stripe", "post", { until: u, posted: out.posted, skipped: out.skipped, errors: out.errors.length, truncated: out.truncated });
    return out;
  }

  /** Marca las filas de payout del saldo con el asiento que las cubre (o como ignoradas si el payout nunca llegó). */
  private async markPayoutTxns(p: StripePayout, payoutEntry: number | null, reversalEntry: number | null, status: StripeTxnStatus) {
    for (const t of await this.s.transactionsByPayout([p.payoutId])) {
      if (!isPayoutType(t.type) || t.status === status) continue;
      const entryId = t.type === "payout" ? payoutEntry : reversalEntry;
      if (status === "posted" && entryId === null) continue;
      await this.s.markTransaction(t.id, { status, entryId, postedAt: status === "posted" ? this.now() : null });
    }
  }

  private async postPayouts(until: string, settings: StripeSettings, actor: FinanceActor, out: PostResult) {
    // Fallidos o cancelados: con asiento → reversión; sin asiento → nada que contabilizar (el saldo vuelve a Stripe)
    for (const p of await this.s.failedPayouts()) {
      if (p.entryId === null) {
        await this.markPayoutTxns(p, null, null, "ignored");
        continue;
      }
      try {
        const entry = await this.d.ledger.getEntry(p.entryId);
        if (!entry) continue;
        const failTxn = (await this.s.transactionsByPayout([p.payoutId])).find((t) => t.type === "payout_reversal");
        const base = failTxn?.createdOn ?? this.today();
        const date = base < entry.date ? entry.date : base;
        const r = await this.d.finance.reverse(entry.id, { date, reason: `Payout ${p.payoutId} ${p.status === "canceled" ? "cancelado" : "fallido"} en Stripe` }, actor);
        if (r.created) out.posted++;
        await this.s.setPayoutReversal(p.id, r.entry.id);
        await this.markPayoutTxns(p, p.entryId, r.entry.id, "posted");
      } catch (e) {
        if (!(e instanceof FinanceError)) throw e;
        out.errors.push({ transactionId: p.payoutId, message: e.message });
      }
    }
    const due = await this.s.postablePayouts(until);
    if (!due.length) return;
    const bank = settings.stripePayoutBankAccountId ? await this.d.ops.getBankAccount(settings.stripePayoutBankAccountId) : null;
    for (const p of due) {
      if (p.currency !== "EUR") {
        out.skipped++;
        continue;
      }
      if (!bank) {
        out.errors.push({ transactionId: p.payoutId, message: "Configura la cuenta bancaria a la que llegan los payouts de Stripe" });
        continue;
      }
      try {
        const { entry, created } = await this.d.finance.postGenerated(stripePayoutEntry(p, bank.accountCode), actor);
        if (created) out.posted++;
        await this.s.setPayoutEntry(p.id, entry.id);
        await this.markPayoutTxns(p, entry.id, null, "posted");
      } catch (e) {
        if (!(e instanceof FinanceError)) throw e;
        out.errors.push({ transactionId: p.payoutId, message: e.message });
      }
    }
  }

  /** Marca revisada la incidencia de una transacción (con nota). */
  async reviewTransaction(id: number, note: string, actor: FinanceActor) {
    const n = (note ?? "").trim();
    if (n.length < 3 || n.length > 300) throw bad("Escribe una nota de revisión (3 a 300 caracteres)");
    const t = await this.s.getTransaction(id);
    if (!t) throw notFound("Transacción");
    if (!t.issue) throw new FinanceError("invalid_state", "La transacción no tiene ninguna incidencia");
    if (!(await this.s.reviewIssue(id, actor.by, this.now(), n))) throw new FinanceError("invalid_state", "La incidencia ya estaba revisada");
    await this.audit(actor, "stripe_txn.review", "stripe_txn", id, { issue: t.issue, note: n });
    const [byId, pm] = await Promise.all([this.invoicesById([t.ownInvoiceId]), this.payoutMap([t.stripePayoutId])]);
    return this.txnDto((await this.s.getTransaction(id))!, byId, pm);
  }

  // ── Resumen ───────────────────────────────────────────────────────────────────────────────────────────────────

  /** Saldo de 5720 en el libro (todas las fechas: un payout en tránsito ya ha salido del saldo de Stripe). */
  async ledgerBalance(): Promise<number> {
    return balancesOf(await this.d.ledger.postedLines({ accountCode: STRIPE_ACCOUNTS.balance })).get(STRIPE_ACCOUNTS.balance) ?? 0;
  }

  async summary() {
    const today = this.today();
    const from = `${today.slice(0, 7)}-01`;
    const [balance, imported, agg, issues, payouts, imports] = await Promise.all([this.ledgerBalance(), this.s.importedNetCents(), this.s.aggregates(from, today), this.s.issueCounts(), this.s.payoutStats(from, today), this.s.listImports(1)]);
    const by = (t: string) => agg.find((a) => a.type === t) ?? { grossCents: 0, feeCents: 0, netCents: 0, count: 0 };
    const nonPayout = agg.filter((a) => !isPayoutType(a.type));
    return {
      asOf: today,
      balancePendingCents: balance,
      /** Σ neto de las transacciones en euros importadas: lo que dicen los informes de Stripe. */
      importedBalanceCents: imported,
      /** Libro − informes: lo importado sin contabilizar o los saldos anteriores a la primera importación. */
      balanceDifferenceCents: balance - imported,
      grossMonthCents: by("charge").grossCents,
      feesMonthCents: nonPayout.reduce((a, x) => a + x.feeCents, 0) - by("stripe_fee").grossCents,
      netMonthCents: nonPayout.reduce((a, x) => a + x.netCents, 0),
      refundsMonthCents: -(by("refund").grossCents + by("refund_failure").grossCents),
      disputesOpen: issues.disputes,
      payoutsMonthCents: payouts.arrivedCents,
      lastImportAt: imports[0]?.createdAt ?? null,
      unmatchedTransactions: issues.open,
      payoutsWithoutBank: payouts.withoutBank,
    };
  }

  // ── Conciliación por factura ──────────────────────────────────────────────────────────────────────────────────

  /** Vista por factura (§4 y fechas del §3): factura → cobros → comisión → payout → banco, con su estado. */
  async reconciliationInvoices(q: { status?: ReconciliationStatus; from?: string; to?: string; q?: string; limit?: number; offset?: number }) {
    const dir = this.invoices;
    const offset = Math.max(0, q.offset ?? 0);
    const limit = Math.max(1, Math.min(q.limit ?? 50, 500));
    const base = { from: q.from, to: q.to, q: q.q?.trim() || undefined };
    // Sin filtro de estado pagina la propia consulta; con él, recorre todas las facturas por páginas (el estado se
    // calcula con los cobros, payouts y movimientos de cada una)
    if (!q.status) {
      const page = await dir.list({ ...base, limit, offset });
      return { items: await this.chains(page.items), total: page.total };
    }
    const matched: Array<ReturnType<FinanceStripeService["invoiceChain"]>> = [];
    for (let at = 0; ; at += INVOICE_PAGE) {
      const page = await dir.list({ ...base, limit: INVOICE_PAGE, offset: at });
      matched.push(...(await this.chains(page.items)).filter((x) => x.status === q.status));
      if (page.items.length < INVOICE_PAGE) break;
    }
    return { items: matched.slice(offset, offset + limit), total: matched.length };
  }

  private async chains(invoices: OwnInvoice[]) {
    const ids = invoices.map((o) => o.id);
    const [txns, transfers] = await Promise.all([this.s.transactionsByInvoice(ids), this.d.ops.movementsByMatch("invoice_payment", ids)]);
    const pm = await this.payoutMap(txns.map((t) => t.stripePayoutId));
    const payoutBanks = new Map((await this.d.ops.getMovementsByIds(Array.from(pm.values()).map((p) => p.bankMovementId).filter((x): x is number => x !== null))).map((b) => [b.id, b]));
    return invoices.map((o) => this.invoiceChain(o, txns.filter((t) => t.ownInvoiceId === o.id), transfers.filter((m) => m.matchId === o.id), pm, payoutBanks));
  }

  private invoiceChain(o: OwnInvoice, txns: StripeTxn[], transfers: BankMovement[], pm: Map<string, StripePayout>, banks: Map<number, BankMovement>) {
    const charges = txns
      .sort((a, b) => a.createdOn.localeCompare(b.createdOn) || a.id - b.id)
      .map((t) => {
        const p = t.stripePayoutId ? pm.get(t.stripePayoutId) : undefined;
        const bank = p?.bankMovementId ? banks.get(p.bankMovementId) : undefined;
        return {
          id: t.id,
          balanceTransactionId: t.balanceTransactionId,
          type: t.type,
          createdOn: t.createdOn,
          availableOn: t.availableOn,
          grossCents: t.grossCents,
          feeCents: t.feeCents,
          netCents: t.netCents,
          entryId: t.entryId,
          status: t.status,
          issue: t.issue,
          issueReviewedAt: t.issueReviewedAt,
          payout: p ? { id: p.id, stripePayoutId: p.payoutId, arrivalOn: p.arrivalOn, status: p.status, entryId: p.entryId, bankMovementId: p.bankMovementId, bankBookingDate: bank?.bookingDate ?? null } : null,
        };
      });
    const transferRows = transfers.map((m) => ({ bankMovementId: m.id, bookingDate: m.bookingDate, amountCents: m.amountCents, entryId: m.entryId }));
    const transfersCents = transferRows.reduce((a, t) => a + t.amountCents, 0);
    const collected = charges.reduce((a, c) => a + c.grossCents, 0) + transfersCents;
    const openIssues = Array.from(new Set(charges.filter((c) => c.issue && c.issueReviewedAt === null).map((c) => c.issue!)));
    const anyReviewed = charges.some((c) => c.issueReviewedAt !== null);
    const reviewed = openIssues.length === 0 && (collected === o.totalCents || anyReviewed);
    const live = (p: StripePayout | undefined) => !!p && LIVE_PAYOUT_STATUSES.includes(p.status);
    const status = reconciliationStatus({
      totalCents: o.totalCents,
      stripe: charges.map((c) => {
        const p = c.payout ? pm.get(c.payout.stripePayoutId) : undefined;
        return { type: c.type, grossCents: c.grossCents, payoutPosted: live(p) && p!.entryId !== null, payoutInBank: live(p) && p!.bankMovementId !== null };
      }),
      transfersCents,
      reviewed,
    });
    const max = (xs: Array<string | null | undefined>) => xs.filter((x): x is string => !!x).sort().pop() ?? null;
    const positive = charges.filter((c) => c.grossCents > 0);
    return {
      invoiceId: o.id,
      number: o.number,
      issueDate: o.issueDate,
      customerName: o.customerName,
      companyId: o.companyId,
      totalCents: o.totalCents,
      paymentStatus: o.paymentStatus,
      paymentRef: o.paymentRef,
      status,
      collectedCents: collected,
      feesCents: charges.reduce((a, c) => a + c.feeCents, 0),
      issues: openIssues,
      dates: {
        invoiceDate: o.issueDate ?? o.operationDate,
        chargeDate: positive[0]?.createdOn ?? transferRows[0]?.bookingDate ?? null,
        availableOn: max(positive.map((c) => c.availableOn)),
        payoutDate: max(positive.map((c) => c.payout?.arrivalOn)),
        bankDate: max([...positive.map((c) => c.payout?.bankBookingDate), ...transferRows.map((t) => t.bookingDate)]),
      },
      charges,
      transfers: transferRows,
    };
  }

  // ── Conciliación bancaria (extensión de las operaciones) ──────────────────────────────────────────────────────

  async suggestions(m: BankMovement): Promise<StripeMatchSuggestion[]> {
    if (m.amountCents <= 0) return [];
    const [payouts, open] = await Promise.all([this.s.openPayoutsForBank(500), this.d.invoices ? this.d.invoices.openCandidates({ minTotalCents: m.amountCents, from: addDays(m.bookingDate, -365), limit: INVOICE_CANDIDATES }) : Promise.resolve([] as OwnInvoice[])]);
    const settings = await this.s.getSettings();
    const candidates = payouts.filter((p) => p.currency === "EUR" && (settings.stripePayoutBankAccountId === null || settings.stripePayoutBankAccountId === m.bankAccountId) && p.arrivalOn >= addDays(m.bookingDate, -30) && p.arrivalOn <= addDays(m.bookingDate, 30));
    const pending = await this.pendingByInvoice(open);
    return suggestStripeMatches(
      m,
      candidates.map((p) => ({ id: p.id, payoutId: p.payoutId, arrivalOn: p.arrivalOn, amountCents: p.amountCents })),
      pending.map(({ o, pendingCents }) => ({ id: o.id, number: o.number, customerName: o.customerName, issueDate: o.issueDate, pendingCents })),
    );
  }

  /** Lo que queda por cobrar de cada factura: total − cobros de Stripe casados − transferencias conciliadas. */
  private async pendingByInvoice(list: OwnInvoice[]) {
    const ids = list.map((o) => o.id);
    const [txns, transfers] = await Promise.all([this.s.transactionsByInvoice(ids), this.d.ops.movementsByMatch("invoice_payment", ids)]);
    return list.map((o) => ({ o, pendingCents: o.totalCents - txns.filter((t) => t.ownInvoiceId === o.id).reduce((a, t) => a + t.grossCents, 0) - transfers.filter((m) => m.matchId === o.id).reduce((a, m) => a + m.amountCents, 0) }));
  }

  async invoiceForTransfer(invoiceId: number) {
    const [inv] = await this.invoices.byIds([invoiceId]);
    if (!inv) throw new FinanceError("not_found", "Factura no encontrada");
    if (inv.status !== "issued" || inv.kind === "rectification") throw new FinanceError("invalid_state", "Solo se cobra una factura expedida (no rectificativa)");
    if (inv.currency !== "EUR") throw bad("La factura no está en euros");
    const [{ pendingCents }] = await this.pendingByInvoice([inv]);
    if (pendingCents <= 0) throw new FinanceError("exceeds_pending", "La factura ya está cobrada");
    return { id: inv.id, number: inv.number, companyId: inv.companyId, pendingCents };
  }

  /**
   * Serializa los cobros por transferencia de una misma factura: comprobar lo pendiente, reservar el movimiento y
   * contabilizar ocurren con el cerrojo `fin-invoice-<id>` tomado (dos transferencias simultáneas que juntas superan lo
   * pendiente: la segunda espera y recibe `exceeds_pending`).
   */
  withInvoiceLock<T>(invoiceId: number, fn: () => Promise<T>): Promise<T> {
    return this.lock(invoiceLockKey(invoiceId), fn);
  }

  async linkPayout(m: BankMovement, payoutId: number, actor: FinanceActor) {
    await this.linkBank(payoutId, m.id, actor);
  }

  async unlinkPayout(m: BankMovement, actor: FinanceActor) {
    if (!m.matchId) throw new FinanceError("invalid_state", "El movimiento no está vinculado a ningún payout");
    await this.unlinkBank(m.matchId, actor);
  }

  /**
   * Vincula la llegada de un payout a su movimiento bancario: SIN asiento (el del payout ya llevó el dinero al banco).
   * Mismo importe y la cuenta bancaria configurada; el movimiento se reserva primero (dos vínculos simultáneos no
   * pueden ganar los dos) y vuelve a pendiente si el payout acaba de vincularse a otro.
   */
  async linkBank(payoutId: number, movementId: number, actor: FinanceActor) {
    const p = await this.payout(payoutId);
    if (!LIVE_PAYOUT_STATUSES.includes(p.status)) throw new FinanceError("invalid_state", "El payout falló o se canceló: no llegó al banco");
    if (p.bankMovementId !== null) throw new FinanceError("invalid_state", "El payout ya está vinculado a un movimiento bancario");
    const m = await this.d.ops.getMovement(movementId);
    if (!m) throw notFound("Movimiento");
    if (m.status !== "pending") throw new FinanceError("invalid_state", m.status === "matched" ? "El movimiento ya está conciliado" : "El movimiento está ignorado: desvincúlalo antes");
    if (m.amountCents !== p.amountCents) throw bad("El importe del movimiento no coincide con el del payout");
    const settings = await this.s.getSettings();
    if (settings.stripePayoutBankAccountId === null) throw new FinanceError("invalid_state", "Configura antes la cuenta bancaria a la que llegan los payouts de Stripe");
    if (m.bankAccountId !== settings.stripePayoutBankAccountId) throw bad("Los payouts de Stripe llegan a otra cuenta bancaria (configuración de Stripe)");
    const claimed = await this.d.ops.claimMovement(m.id, { from: "pending", to: "matched", matchType: "stripe_payout", by: actor.by, at: this.now(), bump: false });
    if (!claimed) throw new FinanceError("conflict", "El movimiento ya no está pendiente (otra persona lo ha conciliado)");
    if (!(await this.s.linkPayoutBank(p.id, m.id, actor.by, this.now()))) {
      await this.d.ops.releaseMovement(m.id, "matched");
      throw new FinanceError("conflict", "El payout acaba de vincularse a otro movimiento");
    }
    await this.d.ops.setMovementMatch(m.id, p.id, null);
    await this.audit(actor, "stripe_payout.link_bank", "stripe_payout", p.id, { stripePayoutId: p.payoutId, bankMovementId: m.id, entryId: p.entryId });
    return this.reconciliationPayout(p.id);
  }

  /** Deshace el vínculo payout ↔ movimiento (el libro no cambia: no había asiento del vínculo). */
  async unlinkBank(payoutId: number, actor: FinanceActor) {
    const p = await this.payout(payoutId);
    if (p.bankMovementId === null) throw new FinanceError("invalid_state", "El payout no está vinculado a ningún movimiento");
    const m = await this.d.ops.getMovement(p.bankMovementId);
    if (!(await this.s.unlinkPayoutBank(p.id, p.bankMovementId))) throw new FinanceError("conflict", "El vínculo acaba de cambiar");
    if (m && m.status === "matched" && m.matchType === "stripe_payout" && m.matchId === p.id) await this.d.ops.releaseMovement(m.id, "matched");
    await this.audit(actor, "stripe_payout.unlink_bank", "stripe_payout", p.id, { stripePayoutId: p.payoutId, bankMovementId: p.bankMovementId });
    return this.reconciliationPayout(p.id);
  }
}
