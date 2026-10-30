/**
 * Servicio del libro contable de Big Elephant (fase 1A). Dependencias inyectadas (almacén, facturas emitidas en solo
 * lectura y reloj). Cada escritura deja su fila en `fin_audit_log` con el actor y el identificador de correlación.
 *
 * Interfaz para las fases siguientes (gastos, pagos, bancos, caja, Stripe…):
 *   postGenerated(draft, actor)            asiento generado y contabilizado, idempotente por `source_key`
 *   reverse(entryId, { date, reason }, actor)  reversión idempotente (`reverse:<id>`)
 */
import { madridDateKey } from "../utils/timezone";
import type { InvoicingStore } from "../invoicing/store";
import {
  balancesOf,
  closingEntry,
  closingSourceKey,
  invoiceEntry,
  invoiceSourceKey,
  isValidDate,
  journalCsv,
  ledger,
  netMovement,
  openingEntry,
  openingSourceKey,
  regularizationEntry,
  regularizationSourceKey,
  reversalEntry,
  trialBalance,
  trialBalanceCsv,
  validateEntry,
  yearOf,
} from "./rules";
import type { EntryQuery, FinanceStore } from "./store";
import { FinanceError, type Account, type AccountType, type Entry, type EntryDraft, type EntryLineInput, type EntryOrigin, type FinanceActor, type FiscalYear, type JournalCode, type OpenClosed } from "./types";

export interface FinanceDeps {
  store: FinanceStore;
  /** Facturas emitidas de la facturación propia (solo lectura). Sin ella no hay sincronización de ventas. */
  invoices?: Pick<InvoicingStore, "list"> | null;
  now?: () => number;
}

/** Lo que se sincroniza de una vez como mucho por estado (el almacén de facturas no pagina más allá). */
export const INVOICE_SYNC_LIMIT = 500;
/** Diarios que solo genera el cierre del ejercicio (no admiten asientos manuales). */
const SYSTEM_JOURNALS: readonly JournalCode[] = ["REG", "CIE"];
/** Orígenes que no son actividad del periodo (no cuentan en el resumen ni se revierten). */
const CLOSING_ORIGINS: EntryOrigin[] = ["regularization", "closing", "opening"];

export interface ManualEntryInput {
  date: string;
  journal: JournalCode;
  description: string;
  lines: EntryLineInput[];
  post?: boolean;
}

export interface SyncResult {
  posted: number;
  skipped: number;
  errors: Array<{ invoiceId: number; message: string }>;
  /** Hubo más facturas que el tope de una pasada: repetir la sincronización. */
  truncated: boolean;
}

export class FinanceService {
  private readonly now: () => number;
  constructor(private readonly d: FinanceDeps) {
    this.now = d.now ?? Date.now;
  }

  today(): string {
    return madridDateKey(new Date(this.now()));
  }

  private async audit(actor: FinanceActor, action: string, entity: string, entityId: string | number | null, summary: Record<string, unknown> | null) {
    await this.d.store.addAudit({ at: this.now(), actor: actor.by, action, entity, entityId: entityId === null ? null : String(entityId), summary, requestId: actor.requestId });
  }

  private async accountMap(): Promise<Map<string, Account>> {
    return new Map((await this.d.store.listAccounts()).map((a) => [a.code, a]));
  }

  // ── Plan contable ─────────────────────────────────────────────────────────────────────────────────────────────

  accounts() {
    return this.d.store.listAccounts();
  }

  /**
   * Alta de una subcuenta (o cuenta de 3 dígitos fuera del plan sembrado, indicando su tipo). La subcuenta hereda el
   * tipo de su cuenta de 3 dígitos.
   */
  async createAccount(i: { code: string; name: string; type?: AccountType; parentCode?: string | null }, actor: FinanceActor): Promise<Account> {
    const code = i.code.trim();
    const name = i.name.trim();
    if (!/^\d{3,12}$/.test(code)) throw new FinanceError("invalid_input", "El código de cuenta tiene de 3 a 12 dígitos");
    if (!name || name.length > 160) throw new FinanceError("invalid_input", "El nombre de la cuenta es obligatorio (máximo 160 caracteres)");
    const all = await this.d.store.listAccounts();
    if (all.some((a) => a.code === code)) throw new FinanceError("conflict", `La cuenta ${code} ya existe`);
    // Cuenta madre = la cuenta de 3 dígitos (no el prefijo más largo: 57200001 es un banco de 572, no de 5720 Stripe)
    const parent = code.length > 3 ? all.find((a) => a.code === code.slice(0, 3)) : undefined;
    if (!parent && (code.length !== 3 || !i.type)) throw new FinanceError("invalid_account", `No existe la cuenta de mayor de ${code}: crea primero la cuenta de 3 dígitos (con su tipo)`);
    if (i.parentCode && i.parentCode !== parent?.code && !(i.parentCode.length > 3 && code.startsWith(i.parentCode) && all.some((a) => a.code === i.parentCode))) throw new FinanceError("invalid_account", `La cuenta madre de ${code} es ${parent?.code ?? "una cuenta de 3 dígitos"}`);
    if (parent && i.type && i.type !== parent.type) throw new FinanceError("invalid_input", `La subcuenta hereda el tipo de ${parent.code}`);
    const created = await this.d.store.insertAccount({ code, name, type: parent?.type ?? i.type!, parentCode: parent?.code ?? null, isPostable: true, active: true, createdAt: this.now() });
    await this.audit(actor, "account.create", "account", code, { name, type: created.type, parentCode: created.parentCode });
    return created;
  }

  async patchAccount(code: string, p: { name?: string; active?: boolean }, actor: FinanceActor): Promise<Account> {
    const name = p.name?.trim();
    if (name !== undefined && (!name || name.length > 160)) throw new FinanceError("invalid_input", "El nombre de la cuenta es obligatorio (máximo 160 caracteres)");
    const a = await this.d.store.patchAccount(code, { ...(name !== undefined ? { name } : {}), ...(p.active !== undefined ? { active: p.active } : {}) });
    if (!a) throw new FinanceError("not_found", "Cuenta no encontrada");
    await this.audit(actor, "account.update", "account", code, { ...(name !== undefined ? { name } : {}), ...(p.active !== undefined ? { active: p.active } : {}) });
    return a;
  }

  journals() {
    return this.d.store.listJournals();
  }

  // ── Ejercicios y periodos ─────────────────────────────────────────────────────────────────────────────────────

  fiscalYears() {
    return this.d.store.listFiscalYears();
  }

  async createFiscalYear(year: number, actor: FinanceActor): Promise<FiscalYear> {
    if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new FinanceError("invalid_input", "Ejercicio no válido");
    const fy = await this.d.store.createFiscalYear(year, this.now(), actor.by);
    await this.audit(actor, "fiscal_year.create", "fiscal_year", year, { periods: 12 });
    return fy;
  }

  async setPeriodStatus(year: number, month: number, status: OpenClosed, actor: FinanceActor) {
    if (!Number.isInteger(month) || month < 1 || month > 12) throw new FinanceError("invalid_input", "Mes no válido");
    const p = await this.d.store.setPeriodStatus(year, month, status, this.now(), actor.by);
    await this.audit(actor, status === "closed" ? "period.close" : "period.reopen", "period", `${year}-${String(month).padStart(2, "0")}`, null);
    return p;
  }

  /**
   * Cierre del ejercicio (idempotente): exige los doce periodos cerrados y ningún borrador. Contabiliza la
   * regularización (grupos 6 y 7 contra 129, diario REG) y el cierre (CIE) el 31/12, da de alta el ejercicio siguiente
   * si no existe, contabiliza su apertura (APE, 1/1) y marca el ejercicio como cerrado. Si se interrumpe a medias,
   * repetirlo completa lo que falte sin duplicar nada (cada asiento tiene su `source_key`).
   */
  async closeFiscalYear(year: number, actor: FinanceActor) {
    const fy = await this.d.store.getFiscalYear(year);
    if (!fy) throw new FinanceError("not_found", "Ejercicio no encontrado");
    const keys = { regularization: regularizationSourceKey(year), closing: closingSourceKey(year), opening: openingSourceKey(year + 1) };
    const existing = async () => ({ regularization: await this.d.store.bySource(keys.regularization), closing: await this.d.store.bySource(keys.closing), opening: await this.d.store.bySource(keys.opening) });
    if (fy.status === "closed") return { fiscalYear: fy, ...(await existing()), alreadyClosed: true };
    if (fy.periods.some((p) => p.status !== "closed")) throw new FinanceError("invalid_state", "Antes de cerrar el ejercicio hay que cerrar sus doce periodos");
    const range = { from: `${year}-01-01`, to: `${year}-12-31` };
    const drafts = await this.d.store.listEntries({ ...range, status: "draft", limit: 1 });
    if (drafts.total > 0) throw new FinanceError("invalid_state", `Hay ${drafts.total} borrador(es) en el ejercicio ${year}: contabilízalos o anúlalos antes de cerrarlo`);
    // En el cierre se saldan también las cuentas que se hayan desactivado después de usarlas
    const accounts = new Map(Array.from((await this.accountMap()).entries()).map(([k, a]) => [k, { ...a, active: true }]));
    const at = this.now();
    const post = { by: actor.by, at, allowClosedPeriod: true };
    const generated = async (draft: EntryDraft | null, o = post) => {
      if (!draft) return null;
      const { draft: d, lines } = validateEntry(draft, accounts);
      const r = await this.d.store.insertEntry(d, lines, { createdBy: actor.by, at, post: o });
      if (r.created) await this.audit(actor, "entry.generate", "entry", r.entry.id, { sourceKey: d.sourceKey, number: r.entry.number, year: r.entry.year });
      return r.entry;
    };
    let regularization = await this.d.store.bySource(keys.regularization);
    if (!regularization) regularization = await generated(regularizationEntry(year, balancesOf(await this.d.store.postedLines(range))));
    let closing = await this.d.store.bySource(keys.closing);
    if (!closing) closing = await generated(closingEntry(year, balancesOf(await this.d.store.postedLines(range))));
    // Otro cierre simultáneo puede haberlo creado ya: eso no es un error
    if (!(await this.d.store.getFiscalYear(year + 1)))
      await this.createFiscalYear(year + 1, actor).catch((e) => {
        if (!(e instanceof FinanceError && e.code === "conflict")) throw e;
      });
    let opening = await this.d.store.bySource(keys.opening);
    if (!opening && closing) opening = await generated(openingEntry(year, closing), { by: actor.by, at, allowClosedPeriod: false });
    const closed = await this.d.store.closeFiscalYear(year, this.now(), actor.by);
    await this.audit(actor, "fiscal_year.close", "fiscal_year", year, { regularization: regularization?.id ?? null, closing: closing?.id ?? null, opening: opening?.id ?? null });
    return { fiscalYear: closed, regularization, closing, opening, alreadyClosed: false };
  }

  // ── Asientos ──────────────────────────────────────────────────────────────────────────────────────────────────

  /** Filtro por cuenta: exacta si es imputable; si es de mayor (o un grupo), ella y sus subcuentas. */
  async listEntries(q: EntryQuery) {
    if (!q.account) return this.d.store.listEntries(q);
    const a = (await this.accountMap()).get(q.account);
    return this.d.store.listEntries(a?.isPostable ? q : { ...q, account: undefined, accountPrefix: q.account });
  }

  async getEntry(id: number): Promise<Entry> {
    const e = await this.d.store.getEntry(id);
    if (!e) throw new FinanceError("not_found", "Asiento no encontrado");
    return e;
  }

  /** Asiento manual (borrador o contabilizado al crearlo con `post: true`). */
  async createManual(i: ManualEntryInput, actor: FinanceActor): Promise<Entry> {
    if (SYSTEM_JOURNALS.includes(i.journal)) throw new FinanceError("invalid_input", "Los diarios de regularización y cierre solo los usa el cierre del ejercicio");
    const { draft, lines } = validateEntry({ journalCode: i.journal, date: i.date, description: i.description, origin: "manual", sourceKey: null, lines: i.lines }, await this.accountMap());
    const at = this.now();
    const { entry } = await this.d.store.insertEntry(draft, lines, { createdBy: actor.by, at, ...(i.post ? { post: { by: actor.by, at } } : {}) });
    await this.audit(actor, i.post ? "entry.create_posted" : "entry.create", "entry", entry.id, { journal: entry.journalCode, date: entry.date, number: entry.number, totalCents: lines.reduce((a, l) => a + l.debitCents, 0) });
    return entry;
  }

  /** Contabiliza un borrador: vuelve a validar contra el plan contable actual y asigna el número del ejercicio. */
  async post(id: number, actor: FinanceActor): Promise<Entry> {
    const e = await this.getEntry(id);
    if (e.status !== "draft") throw new FinanceError("invalid_state", e.status === "posted" ? "El asiento ya está contabilizado" : "El asiento está anulado");
    validateEntry({ journalCode: e.journalCode, date: e.date, description: e.description, origin: e.origin, sourceKey: e.sourceKey, lines: e.lines }, await this.accountMap());
    const posted = await this.d.store.postEntry(id, { by: actor.by, at: this.now() });
    await this.audit(actor, "entry.post", "entry", id, { number: posted.number, year: posted.year });
    return posted;
  }

  /** Anula un borrador (nunca se borra). Un asiento contabilizado no se anula: se revierte. */
  async voidDraft(id: number, reason: string, actor: FinanceActor): Promise<Entry> {
    const why = reason.trim();
    if (why.length < 3 || why.length > 300) throw new FinanceError("invalid_input", "Indica el motivo de la anulación (3 a 300 caracteres)");
    const e = await this.d.store.voidEntry(id, { by: actor.by, at: this.now(), reason: why });
    await this.audit(actor, "entry.void", "entry", id, { reason: why });
    return e;
  }

  /**
   * Reversión de un asiento contabilizado: asiento espejo en la fecha indicada (periodo abierto, no anterior al
   * original), enlazado con el original. Idempotente: repetirla devuelve la reversión existente (`created: false`).
   */
  async reverse(id: number, i: { date: string; reason: string }, actor: FinanceActor): Promise<{ entry: Entry; created: boolean }> {
    const e = await this.getEntry(id);
    const why = i.reason.trim();
    if (why.length < 3 || why.length > 300) throw new FinanceError("invalid_input", "Indica el motivo de la reversión (3 a 300 caracteres)");
    if (!isValidDate(i.date)) throw new FinanceError("invalid_input", "La fecha de la reversión no es válida (AAAA-MM-DD)");
    if (e.reversedByEntryId !== null) {
      const prev = await this.d.store.getEntry(e.reversedByEntryId);
      if (prev) return { entry: prev, created: false };
    }
    if (e.status !== "posted") throw new FinanceError("invalid_state", "Solo se revierte un asiento contabilizado");
    if (e.origin === "reversal") throw new FinanceError("invalid_state", "Una reversión no se revierte: registra un asiento nuevo");
    if (CLOSING_ORIGINS.includes(e.origin)) throw new FinanceError("invalid_state", "Los asientos de regularización, cierre y apertura no se revierten");
    if (i.date < e.date) throw new FinanceError("invalid_input", "La reversión no puede ser anterior al asiento que revierte");
    // Se revierte aunque alguna cuenta se haya desactivado después: deshacer siempre debe ser posible
    const accounts = new Map(Array.from((await this.accountMap()).entries()).map(([k, a]) => [k, { ...a, active: true }]));
    const { draft, lines } = validateEntry(reversalEntry(e, i.date, why), accounts);
    const at = this.now();
    const r = await this.d.store.insertEntry(draft, lines, { createdBy: actor.by, at, post: { by: actor.by, at }, reverses: e.id });
    if (r.created) await this.audit(actor, "entry.reverse", "entry", e.id, { reversal: r.entry.id, number: r.entry.number, date: i.date, reason: why });
    return r;
  }

  /**
   * Asiento GENERADO por un hecho económico (factura, gasto, pago, movimiento bancario…), validado y contabilizado en
   * la misma transacción. Idempotente por `source_key`: si el hecho ya tiene asiento, lo devuelve (`created: false`)
   * sin volver a validarlo. `period_closed` si su fecha cae en un periodo cerrado.
   */
  async postGenerated(draft: EntryDraft, actor: FinanceActor): Promise<{ entry: Entry; created: boolean }> {
    if (!draft.sourceKey || draft.sourceKey.length > 160) throw new FinanceError("invalid_input", "Un asiento generado necesita su clave de origen");
    if (draft.origin === "manual" || CLOSING_ORIGINS.includes(draft.origin) || draft.origin === "reversal") throw new FinanceError("invalid_input", "Origen no válido para un asiento generado");
    if (SYSTEM_JOURNALS.includes(draft.journalCode)) throw new FinanceError("invalid_input", "Diario no válido para un asiento generado");
    const cur = await this.d.store.bySource(draft.sourceKey);
    if (cur) return { entry: cur, created: false };
    const { draft: d, lines } = validateEntry(draft, await this.accountMap());
    const at = this.now();
    const r = await this.d.store.insertEntry(d, lines, { createdBy: actor.by, at, post: { by: actor.by, at } });
    if (r.created) await this.audit(actor, "entry.generate", "entry", r.entry.id, { sourceKey: d.sourceKey, number: r.entry.number, year: r.entry.year });
    return r;
  }

  // ── Sincronización de facturas emitidas ───────────────────────────────────────────────────────────────────────

  private async issuedInvoices() {
    if (!this.d.invoices) throw new FinanceError("unavailable", "La facturación propia no está montada en este entorno (migración 0027)");
    const [issued, rectified] = await Promise.all([this.d.invoices.list({ status: "issued", limit: INVOICE_SYNC_LIMIT }), this.d.invoices.list({ status: "rectified", limit: INVOICE_SYNC_LIMIT })]);
    const all = [...issued, ...rectified].sort((a, b) => (a.issueDate ?? "").localeCompare(b.issueDate ?? "") || a.id - b.id);
    return { all, truncated: issued.length >= INVOICE_SYNC_LIMIT || rectified.length >= INVOICE_SYNC_LIMIT };
  }

  /** Contabiliza las facturas expedidas que aún no tienen asiento (`invoice:<id>`). Repetirla no crea nada nuevo. */
  async syncInvoices(actor: FinanceActor): Promise<SyncResult> {
    const { all, truncated } = await this.issuedInvoices();
    const done = await this.d.store.existingSources(all.map((i) => invoiceSourceKey(i.id)));
    const accounts = await this.accountMap();
    const out: SyncResult = { posted: 0, skipped: 0, errors: [], truncated };
    for (const inv of all) {
      if (done.has(invoiceSourceKey(inv.id))) {
        out.skipped++;
        continue;
      }
      try {
        const { draft, lines } = validateEntry(invoiceEntry(inv), accounts);
        const at = this.now();
        const r = await this.d.store.insertEntry(draft, lines, { createdBy: actor.by, at, post: { by: actor.by, at } });
        if (r.created) {
          out.posted++;
          await this.audit(actor, "entry.generate", "entry", r.entry.id, { sourceKey: draft.sourceKey, number: r.entry.number, year: r.entry.year, invoice: inv.number });
        } else out.skipped++;
      } catch (e) {
        if (!(e instanceof FinanceError)) throw e;
        out.errors.push({ invoiceId: inv.id, message: `Factura ${inv.number ?? `#${inv.id}`}: ${e.message}` });
      }
    }
    await this.audit(actor, "sync.invoices", "sync", "invoices", { posted: out.posted, skipped: out.skipped, errors: out.errors.length, truncated });
    return out;
  }

  /** Última sincronización, facturas expedidas pendientes (null sin facturación propia) y asientos de facturas ya hechos. */
  async syncStatus() {
    const last = await this.d.store.lastAudit("sync.invoices");
    const synced = (await this.d.store.listEntries({ origin: "invoice", limit: 1 })).total;
    let pending: number | null = null;
    if (this.d.invoices) {
      const { all } = await this.issuedInvoices();
      const done = await this.d.store.existingSources(all.map((i) => invoiceSourceKey(i.id)));
      pending = all.filter((i) => !done.has(invoiceSourceKey(i.id))).length;
    }
    return { lastRunAt: last?.at ?? null, lastRunBy: last?.actor ?? null, pending, synced, lastResult: last?.summary ?? null };
  }

  // ── Informes ──────────────────────────────────────────────────────────────────────────────────────────────────

  /** Rango de fechas: por defecto, del 1 de enero del año en curso a hoy. */
  range(from?: string, to?: string) {
    const t = to ?? this.today();
    const f = from ?? `${yearOf(t)}-01-01`;
    if (!isValidDate(f) || !isValidDate(t)) throw new FinanceError("invalid_input", "Fechas no válidas (AAAA-MM-DD)");
    if (f > t) throw new FinanceError("invalid_input", "La fecha inicial es posterior a la final");
    return { from: f, to: t };
  }

  async ledger(code: string, from?: string, to?: string) {
    const r = this.range(from, to);
    const account = (await this.accountMap()).get(code);
    if (!account) throw new FinanceError("not_found", "Cuenta no encontrada");
    // Imputable: solo ella (5720 no incluye los bancos 572000NN); de mayor: ella y sus subcuentas
    const which = account.isPostable ? { accountCode: code } : { accountPrefix: code };
    const [before, lines] = await Promise.all([this.d.store.postedLines({ before: r.from, ...which }), this.d.store.postedLines({ ...r, ...which })]);
    return { account, ...r, ...ledger(before, lines) };
  }

  async trialBalance(from?: string, to?: string, excludeClosing = false) {
    const r = this.range(from, to);
    const lines = await this.d.store.postedLines({ ...r, ...(excludeClosing ? { excludeOrigins: ["closing"] as EntryOrigin[] } : {}) });
    return { ...r, ...trialBalance(lines, await this.accountMap()) };
  }

  async journalCsv(from?: string, to?: string) {
    const r = this.range(from, to);
    return { ...r, csv: journalCsv(await this.d.store.postedLines(r), await this.accountMap()) };
  }

  async trialBalanceCsv(from?: string, to?: string, excludeClosing = false) {
    const tb = await this.trialBalance(from, to, excludeClosing);
    return { from: tb.from, to: tb.to, csv: trialBalanceCsv(tb) };
  }

  /**
   * Resumen del panel, desde el libro (asientos contabilizados, sin regularización, cierre ni apertura). Lo que llega
   * con la fase 1B (bancos, caja, acreedores, IVA soportado) se devuelve `null` = no disponible.
   */
  async summary() {
    const today = this.today();
    const year = yearOf(today);
    const month = today.slice(0, 7);
    const q = Math.floor((Number(today.slice(5, 7)) - 1) / 3);
    const quarterFrom = `${year}-${String(q * 3 + 1).padStart(2, "0")}-01`;
    const lines = await this.d.store.postedLines({ from: `${year}-01-01`, to: today, excludeOrigins: CLOSING_ORIGINS });
    const income = (from: string) => -netMovement(lines, "7", from, today);
    const expenses = (from: string) => netMovement(lines, "6", from, today);
    const incomeYear = income(`${year}-01-01`);
    const expensesYear = expenses(`${year}-01-01`);
    return {
      asOf: today,
      bankBalanceCents: null,
      cashBalanceCents: null,
      payablesCents: null,
      expensesMonthCents: expenses(`${month}-01`),
      expensesYearCents: expensesYear,
      incomeMonthCents: income(`${month}-01`),
      incomeYearCents: incomeYear,
      vatOutputQuarterCents: -netMovement(lines, "477", quarterFrom, today),
      vatInputQuarterCents: null,
      resultYearCents: incomeYear - expensesYear,
      banks: null,
      cash: null,
    };
  }
}
