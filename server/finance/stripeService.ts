/**
 * Servicio de la fase 2 (CRM 0035): Stripe como TPV principal. Importa los informes CSV de Stripe, contabiliza a través
 * del libro de la fase 1A (`FinanceService.postGenerated` / `reverse`) y concilia factura ↔ cobro ↔ payout ↔ banco.
 *
 * Origen único de cada hecho (contrato §0): el cobro, la comisión, el reembolso y la disputa salen de la transacción de
 * saldo importada (`stripe-txn:<id>`); la liquidación, del payout (`stripe-payout:<id>`, fecha de llegada); su llegada
 * al banco se VINCULA al asiento del payout sin crear otro; el cobro de una factura por transferencia es un movimiento
 * bancario conciliado como `invoice_payment` (`bankmov:<id>`). Los webhooks, `commercial_events`, `stripe_invoices` y
 * el estado de cobro de las facturas son solo referencia: aquí nunca se escriben ni se contabilizan desde ellos.
 */
import { madridDateKey } from "../utils/timezone";
import type { InvoicingStore } from "../invoicing/store";
import type { Invoice } from "../invoicing/types";
import { decodeText, safeFilename, sha256Hex, MAX_DOCUMENT_BYTES } from "./opsRules";
import type { FinanceOpsStore } from "./opsStore";
import type { BankMovement } from "./opsTypes";
import type { BankReconciliationExtension } from "./opsService";
import { addDays } from "./opsRules";
import { balancesOf, isValidDate } from "./rules";
import type { FinanceService } from "./service";
import type { FinanceStore } from "./store";
import {
  parseBalanceCsv,
  parsePayoutsCsv,
  reconciliationStatus,
  SELF_POSTED_TYPES,
  STRIPE_ACCOUNTS,
  stripePayoutEntry,
  stripeTxnEntry,
  suggestStripeMatches,
  txnIssue,
  type InvoiceRef,
  type ReconciliationStatus,
  type StripeMatchSuggestion,
} from "./stripeRules";
import { isPayoutType, LIVE_PAYOUT_STATUSES, type FinanceStripeStore, type PayoutQuery, type TxnQuery } from "./stripeStore";
import type { FeeVatMode, ParsedStripeTxn, StripeImport, StripeImportKind, StripeIssue, StripePayout, StripeSettings, StripeTxn, StripeTxnStatus } from "./stripeTypes";
import { FinanceError, type FinanceActor } from "./types";

export interface FinanceStripeDeps {
  store: FinanceStripeStore;
  finance: FinanceService;
  /** Operaciones (fase 1B): cuentas bancarias y movimientos para la conciliación. */
  ops: FinanceOpsStore;
  ledger: Pick<FinanceStore, "postedLines" | "listAccounts" | "getEntry">;
  /** Facturas propias (solo lectura). Sin ellas los cobros quedan «sin factura» y no hay vista por factura. */
  invoices?: Pick<InvoicingStore, "list" | "get"> | null;
  /** Facturas de Stripe registradas por el cobro (`stripe_invoices`, solo lectura), para explicar un cobro sin factura. */
  stripeInvoices?: { known(ids: string[]): Promise<Set<string>> } | null;
  now?: () => number;
}

/** Factura propia tal y como la usa la conciliación (solo lectura de `server/invoicing`). */
export interface OwnInvoice {
  id: number;
  number: string | null;
  kind: Invoice["kind"];
  status: Invoice["status"];
  issueDate: string | null;
  operationDate: string;
  companyId: number;
  customerName: string | null;
  totalCents: number;
  currency: string;
  paymentStatus: Invoice["paymentStatus"];
  paymentRef: string | null;
}

const bad = (m: string) => new FinanceError("invalid_input", m);
const notFound = (what: string) => new FinanceError("not_found", `${what} no encontrado`);
/** Facturas leídas como mucho por estado (el almacén de facturas no pagina más allá). */
const INVOICE_SCAN = 500;
/** Transacciones contabilizadas como mucho por pasada (repetir si hay más: `truncated`). */
const POST_BATCH = 5_000;
const STRIPE_REF = /^stripe:in:(.+)$/;

const ownOf = (i: Invoice): OwnInvoice => ({
  id: i.id,
  number: i.number,
  kind: i.kind,
  status: i.status,
  issueDate: i.issueDate,
  operationDate: i.operationDate,
  companyId: i.companyId,
  customerName: i.customer?.legalName ?? null,
  totalCents: i.totalCents,
  currency: i.currency,
  paymentStatus: i.paymentStatus,
  paymentRef: i.paymentRef,
});
const refOf = (o: OwnInvoice): InvoiceRef => ({ id: o.id, number: o.number, companyId: o.companyId, totalCents: o.totalCents });

export interface PostResult {
  posted: number;
  skipped: number;
  errors: Array<{ transactionId: string; message: string }>;
  /** Quedaron más transacciones de las que se procesan en una pasada: repetir. */
  truncated: boolean;
}

export class FinanceStripeService implements BankReconciliationExtension {
  private readonly now: () => number;
  constructor(private readonly d: FinanceStripeDeps) {
    this.now = d.now ?? Date.now;
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

  settings() {
    return this.s.getSettings();
  }

  /** Configuración de Stripe (rol admin|superadmin en la API). Cambio parcial; se valida contra el plan y los bancos. */
  async saveSettings(p: { stripeFeeVat?: FeeVatMode; feeVatRateBp?: number; stripePayoutBankAccountId?: number | null; disputeAccountCode?: string }, actor: FinanceActor): Promise<StripeSettings> {
    const cur = await this.s.getSettings();
    const next = {
      stripeFeeVat: p.stripeFeeVat ?? cur.stripeFeeVat,
      feeVatRateBp: p.feeVatRateBp ?? cur.feeVatRateBp,
      stripePayoutBankAccountId: p.stripePayoutBankAccountId === undefined ? cur.stripePayoutBankAccountId : p.stripePayoutBankAccountId,
      disputeAccountCode: (p.disputeAccountCode ?? cur.disputeAccountCode).trim(),
    };
    if (next.stripeFeeVat !== "exempt" && next.stripeFeeVat !== "reverse_charge") throw bad("IVA de las comisiones: «exempt» o «reverse_charge»");
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

  imports() {
    return this.s.listImports(100);
  }

  // ── Facturas propias (solo lectura) ───────────────────────────────────────────────────────────────────────────

  private async ownInvoices(): Promise<OwnInvoice[]> {
    if (!this.d.invoices) return [];
    const [issued, rectified] = await Promise.all([this.d.invoices.list({ status: "issued", limit: INVOICE_SCAN }), this.d.invoices.list({ status: "rectified", limit: INVOICE_SCAN })]);
    return [...issued, ...rectified].map(ownOf);
  }

  /** Índices de las facturas propias: por id y por factura de Stripe que las cobró (`paymentRef` = `stripe:in:<id>`). */
  private async invoiceIndex() {
    const list = await this.ownInvoices();
    const byStripe = new Map<string, OwnInvoice>();
    for (const o of list) {
      const m = STRIPE_REF.exec(o.paymentRef ?? "");
      if (m && o.kind !== "rectification") byStripe.set(m[1], o);
    }
    return { list, byId: new Map(list.map((o) => [o.id, o])), byStripe };
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
    const [{ byId }, pm] = await Promise.all([this.invoiceIndex(), this.payoutMap(out.items.map((t) => t.stripePayoutId))]);
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
    const [txns, banks, idx] = await Promise.all([this.s.transactionsByPayout([p.payoutId]), this.d.ops.getMovementsByIds(p.bankMovementId ? [p.bankMovementId] : []), this.invoiceIndex()]);
    const bank = banks[0] ?? null;
    const pm = new Map([[p.payoutId, p]]);
    return {
      ...this.payoutDto(p, txns, bank),
      transactions: txns.sort((a, b) => a.createdOn.localeCompare(b.createdOn) || a.id - b.id).map((t) => this.txnDto(t, idx.byId, pm)),
      bankMovement: bank ? { id: bank.id, bankAccountId: bank.bankAccountId, bookingDate: bank.bookingDate, valueDate: bank.valueDate, amountCents: bank.amountCents, description: bank.description, status: bank.status } : null,
    };
  }

  // ── Contabilización ───────────────────────────────────────────────────────────────────────────────────────────

  /** Factura propia de una transacción: por su factura de Stripe o, en reembolsos y disputas, por la del cobro original. */
  private async invoiceFor(t: StripeTxn, idx: Awaited<ReturnType<FinanceStripeService["invoiceIndex"]>>, chargeOwn: Map<string, number>) {
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
    const settings = await this.s.getSettings();
    const out: PostResult = { posted: 0, skipped: 0, errors: [], truncated: false };
    const batch = await this.s.postableTransactions(u, POST_BATCH);
    out.truncated = batch.length >= POST_BATCH;
    const idx = await this.invoiceIndex();
    const chargeIds = Array.from(new Set(batch.filter((t) => t.type !== "charge" && t.chargeId).map((t) => t.chargeId!)));
    const chargeOwn = new Map<string, number>();
    for (const c of await this.s.transactionsByCharge(chargeIds)) if (c.type === "charge" && c.chargeId && c.ownInvoiceId) chargeOwn.set(c.chargeId, c.ownInvoiceId);
    const known = this.d.stripeInvoices ? await this.d.stripeInvoices.known(Array.from(new Set(batch.map((t) => t.stripeInvoiceId).filter((x): x is string => !!x)))) : new Set<string>();

    for (const t of batch) {
      if (isPayoutType(t.type)) continue;
      if (!SELF_POSTED_TYPES.includes(t.type)) {
        out.skipped++;
        continue;
      }
      const own = await this.invoiceFor(t, idx, chargeOwn);
      const ref = own ? refOf(own) : null;
      try {
        const { entry, created } = await this.d.finance.postGenerated(stripeTxnEntry(t, settings, ref), actor);
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
        if (t.type === "charge" && t.chargeId && own) chargeOwn.set(t.chargeId, own.id);
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
    const [idx, pm] = await Promise.all([this.invoiceIndex(), this.payoutMap([t.stripePayoutId])]);
    return this.txnDto((await this.s.getTransaction(id))!, idx.byId, pm);
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
    if (!this.d.invoices) throw new FinanceError("unavailable", "La facturación propia no está montada en este entorno (migración 0027)");
    const text = q.q?.trim().toLowerCase();
    const invoices = (await this.ownInvoices())
      .filter((o) => o.kind !== "rectification" && o.totalCents > 0)
      .filter((o) => {
        const date = o.issueDate ?? o.operationDate;
        return (!q.from || date >= q.from) && (!q.to || date <= q.to) && (!text || (o.number ?? "").toLowerCase().includes(text) || (o.customerName ?? "").toLowerCase().includes(text));
      })
      .sort((a, b) => (b.issueDate ?? b.operationDate).localeCompare(a.issueDate ?? a.operationDate) || b.id - a.id);
    const ids = invoices.map((o) => o.id);
    const [txns, transfers] = await Promise.all([this.s.transactionsByInvoice(ids), this.d.ops.movementsByMatch("invoice_payment", ids)]);
    const pm = await this.payoutMap(txns.map((t) => t.stripePayoutId));
    const payoutBanks = new Map((await this.d.ops.getMovementsByIds(Array.from(pm.values()).map((p) => p.bankMovementId).filter((x): x is number => x !== null))).map((b) => [b.id, b]));
    const rows = invoices.map((o) => this.invoiceChain(o, txns.filter((t) => t.ownInvoiceId === o.id), transfers.filter((m) => m.matchId === o.id), pm, payoutBanks));
    const filtered = q.status ? rows.filter((r) => r.status === q.status) : rows;
    const offset = Math.max(0, q.offset ?? 0);
    const limit = Math.max(1, Math.min(q.limit ?? 50, 500));
    return { items: filtered.slice(offset, offset + limit), total: filtered.length };
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
    const [payouts, idx] = await Promise.all([this.s.openPayoutsForBank(500), this.invoiceIndex()]);
    const settings = await this.s.getSettings();
    const candidates = payouts.filter((p) => p.currency === "EUR" && (settings.stripePayoutBankAccountId === null || settings.stripePayoutBankAccountId === m.bankAccountId) && p.arrivalOn >= addDays(m.bookingDate, -30) && p.arrivalOn <= addDays(m.bookingDate, 30));
    const pending = await this.pendingByInvoice(idx.list.filter((o) => o.kind !== "rectification" && o.status === "issued" && o.paymentStatus !== "paid" && o.totalCents > 0));
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
    if (!this.d.invoices) throw new FinanceError("unavailable", "La facturación propia no está montada en este entorno (migración 0027)");
    const inv = await this.d.invoices.get(invoiceId);
    if (!inv) throw new FinanceError("not_found", "Factura no encontrada");
    if (inv.status !== "issued" || inv.kind === "rectification") throw new FinanceError("invalid_state", "Solo se cobra una factura expedida (no rectificativa)");
    if (inv.currency !== "EUR") throw bad("La factura no está en euros");
    const [{ pendingCents }] = await this.pendingByInvoice([ownOf(inv)]);
    if (pendingCents <= 0) throw new FinanceError("exceeds_pending", "La factura ya está cobrada");
    return { id: inv.id, number: inv.number, companyId: inv.companyId, pendingCents };
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
