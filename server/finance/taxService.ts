/**
 * Servicio de la fase 3 (gestoría e impuestos, CRM 0037). Calcula borradores trazables de los modelos a partir del
 * libro (fase 1A), los gastos y proveedores (fase 1B), Stripe (fase 2), las facturas expedidas (solo lectura) y las
 * nóminas; lleva el calendario fiscal y registra la presentación y el pago que DECLARA el operador. Nunca presenta
 * nada ante la AEAT ni la Seguridad Social ni ordena pagos.
 *
 * Asientos (todos por `FinanceService.postGenerated`, idempotentes por `source_key`):
 *   tax:303:<año>:<periodo>     liquidación del IVA al presentar el 303 (477/472 contra 4750 o 4700)
 *   tax-payment:<obligación>    pago de una obligación (4750, 4751, 4752, 473 o 476 contra el banco)
 *   payroll:<id>                nómina (640/642 contra 4751/476/465)
 *   payroll-payment:<id>        pago de la nómina (465 contra el banco)
 *   tax-deferral:<id>:<n>       cuota de un aplazamiento (cuenta del modelo y 669 contra el banco)
 * Cada escritura deja su auditoría (`fin_audit_log`) y, si toca una obligación o un expediente, su bitácora.
 */
import JSZip from "jszip";
import { registerCsv } from "../invoicing/register";
import type { Invoice } from "../invoicing/types";
import { madridDateKey } from "../utils/timezone";
import { addDays } from "./opsRules";
import type { FinanceOpsService } from "./opsService";
import type { ExpenseRow, FinanceOpsStore } from "./opsStore";
import type { DocumentOwner, Supplier } from "./opsTypes";
import { isValidDate, yearOf } from "./rules";
import type { FinanceService } from "./service";
import type { FinanceStore } from "./store";
import type { FinanceStripeStore } from "./stripeStore";
import type { FiscalInvoiceSource } from "./taxSources";
import {
  ANNUAL,
  annualWithholdings,
  baseYearFor202,
  corporate200,
  corporateRateBp,
  daysUntil,
  deferralInstallmentEntry,
  draftCsv,
  finalizeDraft,
  installment202,
  isEuForeign,
  isValidPeriod,
  issuedIncidentsCsv,
  m347,
  m349,
  modelApplicability,
  obligationKey,
  obligationSpecs,
  payrollEntry,
  payrollPaymentEntry,
  periodLabel,
  periodRange,
  periodsOf,
  receivedRegisterCsv,
  reminderBucket,
  socialSecurity,
  staleInfo,
  taxPaymentEntry,
  vat303,
  vat390,
  vatSettlementEntry,
  w111,
  w115,
  type DraftBody,
  type PayrollRow,
  type ReceivedRegisterRow,
  type ThirdPartyOp,
  type VatLedgerLine,
  type WithholdingExpense,
} from "./taxRules";
import type { FinanceTaxStore, ObligationQuery } from "./taxStore";
import {
  ADJUSTMENT_KINDS,
  INFORMATIVE_MODELS,
  MODEL_NAMES,
  OPEN_STATUSES,
  PAYMENT_ACCOUNT,
  PRESENTED_STATUSES,
  type AdjustmentKind,
  type Deferral,
  type DeferralStatus,
  type Dossier,
  type DossierKind,
  type DossierStatus,
  type Obligation,
  type ObligationStatus,
  type Payroll,
  type TaxDraft,
  type TaxModel,
  type TaxSettings,
  type TaxSettingsInput,
} from "./taxTypes";
import { FinanceError, type EntryOrigin, type FinanceActor, type PostedLine } from "./types";

export interface FinanceTaxDeps {
  store: FinanceTaxStore;
  finance: FinanceService;
  ledger: Pick<FinanceStore, "postedLines" | "getEntry" | "listAccounts" | "listEntries">;
  /** Gastos, proveedores, categorías y bancos (fase 1B), en lectura. */
  ops: FinanceOpsStore;
  /** Documentos (justificantes) a través del servicio de operaciones: validación por contenido y auditoría. */
  documents: Pick<FinanceOpsService, "uploadDocument" | "documents">;
  /** Transacciones de Stripe (fase 2): cobros sin factura propia para el libro de expedidas. */
  stripe?: Pick<FinanceStripeStore, "listTransactions"> | null;
  /** Facturas expedidas (solo lectura). Sin ellas, los datos de ventas de los modelos quedan «sin datos». */
  invoices?: FiscalInvoiceSource | null;
  /** Emisor (razón social y NIF) para precargar la configuración la primera vez; nunca se escribe sin el administrador. */
  issuer?: { legalName: string; taxId: string } | null;
  now?: () => number;
}

const bad = (m: string) => new FinanceError("invalid_input", m);
const notFound = (what: string) => new FinanceError("not_found", `${what} no encontrado`);
const CLOSING: EntryOrigin[] = ["regularization", "closing", "opening"];
const NOT_VAT: EntryOrigin[] = [...CLOSING, "tax"];
const MAX_EXPORT_DAYS = 366;
/** Alias que parece un DNI o NIE: no se guardan datos personales innecesarios. */
const PERSONAL_ID = /\b(\d{8}[A-Z]|[XYZ]\d{7}[A-Z])\b/i;

export const DEFAULT_TAX_SETTINGS: Omit<TaxSettings, "legalName" | "taxId"> = {
  configured: false,
  fiscalYearStartMonth: 1,
  vatRegime: "general",
  vatPeriod: "quarterly",
  redeme: false,
  sii: false,
  vat390Exempt: false,
  openingVatCompensationCents: null,
  corporateTaxRateBp: 2500,
  newEntityFirstProfitYear: null,
  hasEmployees: false,
  hasProfessionalWithholdings: false,
  hasRentWithholdings: false,
  intraEuOperations: false,
  operations347: true,
  installmentPaymentsMethod: "art40_2",
  stripeVatId: null,
  extraHolidays: [],
  gestoriaEmail: null,
  notes: null,
  version: 0,
  updatedBy: null,
  updatedAt: null,
};

export interface PresentInput {
  presentedOn: string;
  receiptNumber: string;
  note?: string | null;
  document?: { filename: string; contentBase64: string } | null;
  /** 303 del último periodo con resultado negativo: pedir la devolución en lugar de compensar. */
  refund?: boolean;
  /** Resultado a ingresar domiciliado en la cuenta (queda «domiciliado» hasta registrar el cargo). */
  directDebit?: boolean;
}

export interface PaymentInput {
  paidOn: string;
  bankAccountId: number;
  amountCents?: number;
}

export interface PayrollInput {
  period: string;
  employeeAlias: string;
  grossCents: number;
  irpfCents: number;
  ssEmployeeCents: number;
  ssCompanyCents: number;
  netCents: number;
  paymentDate?: string | null;
  notes?: string | null;
}

export interface DeferralInput {
  obligationId: number;
  principalCents: number;
  interestCents?: number;
  reference?: string | null;
  requestedOn: string;
  notes?: string | null;
  installments: Array<{ n: number; dueDate: string; amountCents: number }>;
}

export interface DossierInput {
  kind: DossierKind;
  agency: string;
  reference?: string | null;
  subject: string;
  notifiedOn?: string | null;
  responseDueOn?: string | null;
  status?: DossierStatus;
  obligationId?: number | null;
  notes?: string | null;
}

export interface TaxReminder {
  obligationId: number;
  key: string;
  model: TaxModel;
  period: string;
  year: number;
  dueDate: string;
  daysLeft: number;
  bucket: number;
  amountCents: number | null;
}

const text = (v: string | null | undefined, max: number) => {
  const t = (v ?? "").trim();
  return t ? t.slice(0, max) : null;
};
const sumOf = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const netOf = (lines: PostedLine[], pred: (l: PostedLine) => boolean) => sumOf(lines.filter(pred).map((l) => l.debitCents - l.creditCents));

export class FinanceTaxService {
  private readonly now: () => number;
  constructor(private readonly d: FinanceTaxDeps) {
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
  private async log(o: Obligation, actor: FinanceActor, action: string, to: ObligationStatus | null, note: string | null, detail: Record<string, unknown> | null = null) {
    await this.s.addObligationLog({ obligationId: o.id, at: this.now(), actor: actor.by, requestId: actor.requestId, action, fromStatus: o.status, toStatus: to, note, detail });
  }

  // ── Configuración ─────────────────────────────────────────────────────────────────────────────────────────────

  /** Configuración guardada, o null si nadie la ha guardado aún. */
  storedSettings() {
    return this.s.getSettings();
  }

  /** Valores con los que se calcula: los guardados o, si no hay, los neutros con el emisor precargado. */
  async settings(): Promise<TaxSettings> {
    return (await this.s.getSettings()) ?? this.defaults();
  }

  defaults(): TaxSettings {
    return { ...DEFAULT_TAX_SETTINGS, legalName: this.d.issuer?.legalName ?? null, taxId: this.d.issuer?.taxId ?? null };
  }

  async settingsLog(limit = 50) {
    return this.s.settingsLog(limit);
  }

  /** Guarda la configuración (rol admin|superadmin en la API). Cambio parcial con versión optimista opcional. */
  async saveSettings(p: TaxSettingsInput & { expectedVersion?: number | null }, actor: FinanceActor): Promise<TaxSettings> {
    const before = await this.s.getSettings();
    const cur = before ?? this.defaults();
    const { expectedVersion, ...patch } = p;
    const next = { ...cur, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) } as TaxSettings;
    next.legalName = text(next.legalName, 200);
    next.taxId = text(next.taxId, 20)?.toUpperCase().replace(/[\s.-]/g, "") ?? null;
    next.stripeVatId = text(next.stripeVatId, 20)?.toUpperCase().replace(/[\s.-]/g, "") ?? null;
    next.gestoriaEmail = text(next.gestoriaEmail, 200);
    next.notes = text(next.notes, 4000);
    if (!Number.isInteger(next.fiscalYearStartMonth) || next.fiscalYearStartMonth < 1 || next.fiscalYearStartMonth > 12) throw bad("El mes de inicio del ejercicio va de 1 a 12");
    if (next.fiscalYearStartMonth !== 1) throw bad("Por ahora solo se admite el ejercicio natural (empieza en enero): el calendario fiscal se calcula sobre él");
    if (next.vatPeriod === "monthly" && !next.redeme) throw bad("El IVA mensual solo aplica con REDEME o gran empresa: marca REDEME o deja el periodo trimestral");
    if (!Number.isInteger(next.corporateTaxRateBp) || next.corporateTaxRateBp < 0 || next.corporateTaxRateBp > 10_000) throw bad("Tipo del Impuesto sobre Sociedades no válido (puntos básicos, 2500 = 25 %)");
    if (next.newEntityFirstProfitYear !== null && (!Number.isInteger(next.newEntityFirstProfitYear) || next.newEntityFirstProfitYear < 2000 || next.newEntityFirstProfitYear > 2100)) throw bad("Ejercicio de la primera base positiva no válido");
    if (next.openingVatCompensationCents !== null && (!Number.isSafeInteger(next.openingVatCompensationCents) || next.openingVatCompensationCents < 0)) throw bad("Las cuotas a compensar iniciales son un importe en céntimos no negativo");
    if (next.gestoriaEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(next.gestoriaEmail)) throw bad("Correo de la gestoría no válido");
    next.extraHolidays = Array.from(new Set((next.extraHolidays ?? []).map((x) => x.trim()))).sort();
    if (next.extraHolidays.length > 100 || next.extraHolidays.some((x) => !isValidDate(x))) throw bad("Los festivos adicionales son fechas AAAA-MM-DD (como mucho 100)");
    const { configured: _c, version: _v, updatedBy: _u, updatedAt: _a, ...values } = next;
    const saved = await this.s.saveSettings(values, { by: actor.by, at: this.now(), requestId: actor.requestId, expectedVersion: expectedVersion ?? null, before: cur });
    await this.audit(actor, "tax.settings", "tax_settings", 1, { version: saved.version });
    return saved;
  }

  // ── Calendario y obligaciones ─────────────────────────────────────────────────────────────────────────────────

  private checkYear(year: number) {
    if (!Number.isInteger(year) || year < 2000 || year > 2100) throw bad("Ejercicio no válido");
  }

  async calendar(year: number) {
    this.checkYear(year);
    const settings = await this.settings();
    const { notApplicable } = obligationSpecs(year, settings);
    const { items } = await this.s.listObligations({ year, limit: 500 });
    return { items, notApplicable };
  }

  /**
   * Da de alta las obligaciones del ejercicio según la configuración (idempotente: `obligation:<modelo>:<año>:<periodo>`).
   * Las que ya existían y dejaron de aplicar sin haberse trabajado pasan a «no aplica» (con su bitácora).
   */
  async generateCalendar(year: number, actor: FinanceActor) {
    this.checkYear(year);
    const settings = await this.settings();
    const { specs, notApplicable } = obligationSpecs(year, settings);
    const created = await this.s.insertObligations(specs, actor.by, this.now());
    for (const o of created) await this.s.addObligationLog({ obligationId: o.id, at: this.now(), actor: actor.by, requestId: actor.requestId, action: "generate", fromStatus: null, toStatus: "pendiente", note: `Vence el ${o.dueDate}`, detail: null });
    const keys = new Set(specs.map((s) => s.key));
    const { items } = await this.s.listObligations({ year, limit: 500 });
    let retired = 0;
    for (const o of items.filter((x) => !keys.has(x.key) && x.status === "pendiente")) {
      const reason = modelApplicability(o.model, settings).reason ?? "Ya no aplica según la configuración";
      if (await this.s.transition(o.id, ["pendiente"], "no_aplica", {}, this.now())) {
        await this.log(o, actor, "not_applicable", "no_aplica", reason);
        retired++;
      }
    }
    await this.audit(actor, "tax.calendar.generate", "tax_calendar", year, { created: created.length, retired });
    return { created: created.length, existing: specs.length - created.length, retired, notApplicable };
  }

  listObligations(q: ObligationQuery) {
    return this.s.listObligations(q);
  }

  private async mustObligation(id: number) {
    const o = await this.s.getObligation(id);
    if (!o) throw notFound("Obligación");
    return o;
  }

  async obligation(id: number) {
    const o = await this.mustObligation(id);
    const [draft, log, documents] = await Promise.all([this.s.getDraft(id), this.s.obligationLog(id), this.d.documents.documents("tax_obligation", id)]);
    return { obligation: o, draft, log, documents };
  }

  // ── Datos de origen ───────────────────────────────────────────────────────────────────────────────────────────

  private async ledgerHasEntries(from: string, to: string) {
    const all = await this.d.ledger.listEntries({ from, to, status: "posted", limit: 5 });
    return all.items.some((e) => !CLOSING.includes(e.origin)) || all.total > all.items.length;
  }

  /** Líneas de 477 y 472 del periodo con el origen del hecho (en las reversiones, el del asiento revertido). */
  private async vatLines(from: string, to: string): Promise<VatLedgerLine[]> {
    const lines = (await Promise.all(["477", "472"].map((accountCode) => this.d.ledger.postedLines({ from, to, accountCode, excludeOrigins: NOT_VAT })))).flat();
    const originals = new Map<number, { origin: EntryOrigin; date: string } | null>();
    const kindOf = (o: EntryOrigin): VatLedgerLine["kind"] => (o === "invoice" ? "sale" : o === "expense" ? "purchase" : o === "stripe" ? "stripe" : "other");
    const out: VatLedgerLine[] = [];
    for (const l of lines.sort((a, b) => a.date.localeCompare(b.date) || a.entryId - b.entryId || a.lineNo - b.lineNo)) {
      let kind = kindOf(l.origin);
      let originalInPeriod = true;
      const reversal = l.origin === "reversal";
      if (reversal) {
        if (!originals.has(l.entryId)) {
          const e = await this.d.ledger.getEntry(l.entryId);
          const orig = e?.reversesEntryId ? await this.d.ledger.getEntry(e.reversesEntryId) : null;
          originals.set(l.entryId, orig ? { origin: orig.origin, date: orig.date } : null);
        }
        const orig = originals.get(l.entryId);
        kind = orig ? kindOf(orig.origin) : "other";
        originalInPeriod = !!orig && orig.date >= from && orig.date <= to;
      }
      out.push({ entryId: l.entryId, entryNumber: l.number, date: l.date, description: l.description ?? l.entryDescription, account: l.accountCode as "477" | "472", kind, reversal, originalInPeriod, debitCents: l.debitCents, creditCents: l.creditCents, taxRateBp: l.taxRateBp, taxBaseCents: l.taxBaseCents });
    }
    return out;
  }

  /** Gastos registrados con fecha de factura en el rango (todas las páginas). */
  private async expensesByInvoiceDate(from: string, to: string): Promise<ExpenseRow[]> {
    const out: ExpenseRow[] = [];
    for (let offset = 0; offset < 100_000; offset += 500) {
      const page = await this.d.ops.listExpenses({ status: "registered", from, to, limit: 500, offset, sort: "invoiceDate", dir: "asc" });
      out.push(...page.items);
      if (out.length >= page.total || page.items.length === 0) break;
    }
    return out;
  }

  /** Gastos registrados con fecha de DEVENGO (o de factura) en el rango. */
  private async expensesByAccrual(from: string, to: string) {
    return (await this.expensesByInvoiceDate(addDays(from, -400), to)).filter((e) => {
      const d = e.accrualDate ?? e.invoiceDate;
      return d >= from && d <= to;
    });
  }

  private async suppliers(ids: Array<number | null>): Promise<Map<number, Supplier>> {
    const out = new Map<number, Supplier>();
    for (const id of Array.from(new Set(ids.filter((x): x is number => x !== null)))) {
      const s = await this.d.ops.getSupplier(id);
      if (s) out.set(id, s);
    }
    return out;
  }

  private async categoryAccounts(): Promise<Map<number, string>> {
    return new Map((await this.d.ops.listCategories()).map((c) => [c.id, c.accountCode]));
  }

  private async invoicesBetween(from: string, to: string): Promise<Invoice[] | null> {
    if (!this.d.invoices) return null;
    return (await this.d.invoices.issuedBetween(from, to)).filter((i) => i.currency === "EUR");
  }

  private async payrolls(from: string, to: string): Promise<PayrollRow[]> {
    return (await this.s.listPayrolls({ from: from.slice(0, 7), to: to.slice(0, 7) })).map((p) => ({ id: p.id, period: p.period, employeeAlias: p.employeeAlias, grossCents: p.grossCents, irpfCents: p.irpfCents, ssEmployeeCents: p.ssEmployeeCents, ssCompanyCents: p.ssCompanyCents, status: p.status }));
  }

  /** Gastos con retención, separados en alquileres (cuenta 621 → 115/180) y profesionales (resto → 111/190). */
  private async withholdingExpenses(from: string, to: string) {
    const [list, accounts] = await Promise.all([this.expensesByAccrual(from, to), this.categoryAccounts()]);
    const withW = list.filter((e) => e.withholdingCents !== 0);
    const sup = await this.suppliers(withW.map((e) => e.supplierId));
    const row = (e: ExpenseRow): WithholdingExpense => ({ id: e.id, number: e.invoiceNumber, date: e.accrualDate ?? e.invoiceDate, supplierId: e.supplierId, supplierName: e.supplierName, supplierTaxId: e.supplierId ? (sup.get(e.supplierId)?.taxId ?? null) : null, baseCents: e.baseCents, withholdingCents: e.withholdingCents });
    const isRent = (e: ExpenseRow) => (e.categoryId ? accounts.get(e.categoryId) : null)?.startsWith("621") ?? false;
    return { rents: withW.filter(isRent).map(row), professionals: withW.filter((e) => !isRent(e)).map(row) };
  }

  // ── Cálculo de los modelos ────────────────────────────────────────────────────────────────────────────────────

  /** Obligación anterior del 303 (cadena de compensaciones) según el periodo. */
  private previousVatKey(year: number, period: string) {
    if (period === "1T") return obligationKey("303", year - 1, "4T");
    if (period.endsWith("T")) return obligationKey("303", year, `${Number(period[0]) - 1}T`);
    if (period === "01") return obligationKey("303", year - 1, "12");
    return obligationKey("303", year, String(Number(period) - 1).padStart(2, "0"));
  }

  /** Borrador guardado de la obligación de un modelo y periodo (null si no hay). */
  private async storedDraft(model: TaxModel, year: number, period: string) {
    const o = await this.s.getObligationByKey(obligationKey(model, year, period));
    if (!o) return { obligation: null, draft: null };
    return { obligation: o, draft: await this.s.getDraft(o.id) };
  }

  /** Calcula un borrador sin guardarlo. */
  async computeDraft(model: TaxModel, year: number, period: string, opts: { refund?: boolean } = {}): Promise<TaxDraft> {
    this.checkYear(year);
    if (!isValidPeriod(model, period)) throw bad(`Periodo «${period}» no válido para el modelo ${model}`);
    const settings = await this.settings();
    const { from, to } = periodRange(model, year, period);
    const body = await this.computeBody(model, year, period, from, to, settings, opts);
    const a = modelApplicability(model, settings);
    if (!a.applies) {
      body.applicable = false;
      body.reason = a.reason;
    }
    return finalizeDraft(body, this.now());
  }

  private async computeBody(model: TaxModel, year: number, period: string, from: string, to: string, settings: TaxSettings, opts: { refund?: boolean }): Promise<DraftBody> {
    switch (model) {
      case "303": {
        const [lines, invoices, expenses, has] = await Promise.all([this.vatLines(from, to), this.invoicesBetween(from, to), this.expensesByInvoiceDate(from, to), this.ledgerHasEntries(from, to)]);
        const sup = await this.suppliers(expenses.map((e) => e.supplierId));
        const prev = await this.s.getObligationByKey(this.previousVatKey(year, period));
        const prevDraft = prev ? await this.s.getDraft(prev.id) : null;
        let carried = settings.openingVatCompensationCents ?? 0;
        let carriedSource = "settings:openingVatCompensationCents";
        const extraWarnings: string[] = [];
        if (prev && prevDraft) {
          carried = Number(prevDraft.extra.carryForwardCents ?? 0);
          carriedSource = `obligation:${prev.id}`;
          if (!PRESENTED_STATUSES.includes(prev.status)) extraWarnings.push(`El 303 anterior (${prev.period} ${prev.year}) aún no está presentado: la compensación arrastrada puede variar`);
        } else if (prev) extraWarnings.push(`El 303 anterior (${prev.period} ${prev.year}) no está calculado: calcúlalo para arrastrar su compensación`);
        const b = vat303({
          year,
          period,
          lines,
          invoices: invoices?.map((i) => ({ id: i.id, number: i.number!, date: i.issueDate!, customerName: i.customer?.legalName ?? null, customerTaxId: i.customer?.taxId ?? null, customerCountry: i.customer?.country ?? null, zeroRatedBaseCents: sumOf(i.lines.filter((l) => l.taxRateBp === 0).map((l) => l.baseCents)) })) ?? null,
          expenses: expenses.map((e) => ({ id: e.id, number: e.invoiceNumber, date: e.invoiceDate, supplierName: e.supplierName, supplierCountry: e.supplierId ? (sup.get(e.supplierId)?.country ?? null) : null, baseCents: e.baseCents, taxRateBp: e.taxRateBp, kind: e.kind })),
          ledgerHasEntries: has,
          carriedInCents: carried,
          carriedInSource: carriedSource,
          lastPeriod: period === "4T" || period === "12",
          refund: opts.refund,
          regime: settings.vatRegime,
        });
        b.warnings.push(...extraWarnings);
        return b;
      }
      case "390": {
        const expected = periodsOf("303", settings);
        const periods: Array<{ period: string; draft: DraftBody; source: string }> = [];
        for (const p of expected) {
          const { obligation, draft } = await this.storedDraft("303", year, p);
          if (obligation && draft && PRESENTED_STATUSES.includes(obligation.status)) periods.push({ period: p, draft, source: `obligation:${obligation.id}` });
          else {
            const r = periodRange("303", year, p);
            periods.push({ period: p, draft: await this.computeBody("303", year, p, r.from, r.to, settings, {}), source: obligation ? `obligation:${obligation.id}` : `preview:303:${year}:${p}` });
          }
        }
        return vat390(year, periods, expected);
      }
      case "349": {
        const [invoices, expenses, lines] = await Promise.all([this.invoicesBetween(from, to), this.expensesByInvoiceDate(from, to), this.vatLines(from, to)]);
        const sup = await this.suppliers(expenses.map((e) => e.supplierId));
        const stripeLines = lines.filter((l) => l.kind === "stripe" && l.account === "472");
        const signedBase = (l: VatLedgerLine) => Math.sign(l.debitCents - l.creditCents) * Math.abs(l.taxBaseCents ?? 0);
        return m349({
          year,
          period,
          invoices: invoices?.map((i) => ({ id: i.id, number: i.number!, date: i.issueDate!, customerName: i.customer?.legalName ?? null, customerTaxId: i.customer?.taxId ?? null, customerCountry: i.customer?.country ?? null, baseCents: i.baseCents })) ?? null,
          expenses: expenses.filter((e) => e.supplierId && isEuForeign(sup.get(e.supplierId)?.country)).map((e) => ({ id: e.id, number: e.invoiceNumber, date: e.invoiceDate, supplierName: e.supplierName, supplierTaxId: sup.get(e.supplierId!)?.taxId ?? null, supplierCountry: sup.get(e.supplierId!)?.country ?? null, baseCents: e.baseCents })),
          stripeFeeBaseCents: sumOf(stripeLines.map(signedBase)),
          stripeVatId: settings.stripeVatId,
          stripeDetails: stripeLines.map((l) => ({ box: "I", source: "entry", ref: `entry:${l.entryId}`, date: l.date, description: `Asiento ${l.entryNumber ?? l.entryId}: ${l.description}`, baseCents: signedBase(l), taxCents: null, rateBp: l.taxRateBp, number: l.entryNumber === null ? null : String(l.entryNumber) })),
        });
      }
      case "347": {
        const [invoices, expenses] = await Promise.all([this.invoicesBetween(from, to), this.expensesByInvoiceDate(from, to)]);
        const sup = await this.suppliers(expenses.map((e) => e.supplierId));
        const ops: ThirdPartyOp[] = [
          ...(invoices ?? []).map((i) => ({ key: "B" as const, ref: `invoice:${i.id}`, source: "invoice" as const, date: i.issueDate!, number: i.number, taxId: i.customer?.taxId ?? null, name: i.customer?.legalName ?? `Cliente ${i.companyId}`, country: i.customer?.country ?? null, totalCents: i.totalCents, withholdingCents: 0 })),
          ...expenses.map((e) => {
            const s = e.supplierId ? sup.get(e.supplierId) : undefined;
            return { key: "A" as const, ref: `expense:${e.id}`, source: "expense" as const, date: e.invoiceDate, number: e.invoiceNumber, taxId: s?.taxId ?? null, name: s?.legalName ?? s?.name ?? e.supplierName ?? "Proveedor", country: s?.country ?? null, totalCents: e.totalCents, withholdingCents: e.withholdingCents };
          }),
        ];
        const b = m347(year, ops);
        if (invoices === null) b.warnings.unshift("La facturación propia no está montada: faltan las ventas (clave B)");
        return b;
      }
      case "111": {
        const [payrolls, w, has] = await Promise.all([this.payrolls(from, to), this.withholdingExpenses(from, to), this.ledgerHasEntries(from, to)]);
        return w111({ year, period, hasEmployees: settings.hasEmployees, payrolls, professionals: w.professionals, ledgerHasEntries: has });
      }
      case "115": {
        const [w, has] = await Promise.all([this.withholdingExpenses(from, to), this.ledgerHasEntries(from, to)]);
        return w115({ year, period, rents: w.rents, ledgerHasEntries: has });
      }
      case "190":
      case "180": {
        const [payrolls, w, has] = await Promise.all([this.payrolls(from, to), this.withholdingExpenses(from, to), this.ledgerHasEntries(from, to)]);
        return annualWithholdings(model, year, { payrolls: model === "190" ? payrolls : [], expenses: model === "190" ? w.professionals : w.rents, ledgerHasEntries: has });
      }
      case "SS":
        return socialSecurity({ year, period, payrolls: await this.payrolls(from, to) });
      case "200":
        return this.corporateBody(year, settings);
      case "202":
        return this.installmentBody(year, period, from, to, settings);
    }
  }

  private async resultLines(from: string, to: string) {
    return this.d.ledger.postedLines({ from, to, excludeOrigins: CLOSING });
  }

  /** Pagos fraccionados (202) pagados del ejercicio, opcionalmente solo los de periodos anteriores a uno. */
  private async installmentsPaid(year: number, before?: string) {
    const { items } = await this.s.listObligations({ year, model: "202", limit: 10 });
    return items.filter((o) => o.status === "pagado" && (!before || o.period < before));
  }

  /** Bases negativas pendientes que dejó el 200 del ejercicio anterior (null si no está en el sistema). */
  private async previousPendingLosses(year: number) {
    const { obligation, draft } = await this.storedDraft("200", year - 1, ANNUAL);
    if (!obligation || !draft || typeof draft.extra.pendingLossesJson !== "string") return { pending: null, source: null };
    try {
      return { pending: JSON.parse(draft.extra.pendingLossesJson) as Array<{ originYear: number; amountCents: number }>, source: `obligation:${obligation.id}` };
    } catch {
      return { pending: null, source: null };
    }
  }

  private async corporateBody(year: number, settings: TaxSettings): Promise<DraftBody> {
    const from = `${year}-01-01`;
    const to = `${year}-12-31`;
    const [lines, accounts, adjustments, paid, prev] = await Promise.all([this.resultLines(from, to), this.d.ledger.listAccounts(), this.s.listAdjustments(year), this.installmentsPaid(year), this.previousPendingLosses(year)]);
    const names = new Map(accounts.map((a) => [a.code, a.name]));
    const result = lines.filter((l) => /^[67]/.test(l.accountCode));
    const byAccount = new Map<string, number>();
    for (const l of result) byAccount.set(l.accountCode, (byAccount.get(l.accountCode) ?? 0) + l.creditCents - l.debitCents);
    const accountingResult = sumOf(Array.from(byAccount.values()));
    const taxExpense = netOf(lines, (l) => l.accountCode.startsWith("630"));
    const withholdings473 = netOf(lines, (l) => l.accountCode.startsWith("473") && l.origin !== "tax");
    const newEntity = !!settings.newEntityFirstProfitYear && year >= settings.newEntityFirstProfitYear && year < settings.newEntityFirstProfitYear + 3;
    return corporate200({
      year,
      rateBp: corporateRateBp(settings, year),
      newEntity,
      hasData: result.length > 0,
      accountingResultCents: accountingResult,
      taxExpenseCents: taxExpense,
      withholdings473Cents: withholdings473,
      installmentsPaidCents: sumOf(paid.map((o) => o.paidAmountCents ?? o.amountCents ?? 0)),
      adjustments: adjustments.filter((a) => a.status === "active"),
      previousPending: prev.pending,
      previousSource: prev.source,
      details: [
        ...Array.from(byAccount.entries())
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(([code, cents]) => ({ box: "00501", source: "entry" as const, ref: `account:${code}`, date: null, description: `${code} ${names.get(code) ?? ""}`.trim(), baseCents: null, taxCents: cents, rateBp: null })),
        ...paid.map((o) => ({ box: "00598", source: "obligation" as const, ref: `obligation:${o.id}`, date: o.paidOn, description: `202 ${o.period} pagado`, baseCents: null, taxCents: o.paidAmountCents ?? o.amountCents, rateBp: null })),
      ],
    });
  }

  private async installmentBody(year: number, period: string, from: string, to: string, settings: TaxSettings): Promise<DraftBody> {
    if (settings.installmentPaymentsMethod === "art40_2") {
      const y = baseYearFor202(year, period);
      const { obligation, draft } = await this.storedDraft("200", y, ANNUAL);
      const ok = obligation && draft && draft.hasData;
      return installment202({
        year,
        period,
        method: "art40_2",
        last200: ok ? { year: y, cuotaIntegraCents: Number(draft!.extra.cuotaIntegraCents ?? 0), deduccionesCents: Number(draft!.extra.deduccionesCents ?? 0), retencionesCents: Number(draft!.extra.retencionesCents ?? 0), source: `obligation:${obligation!.id}` } : null,
      });
    }
    const [lines, prevLosses, previous] = await Promise.all([this.resultLines(from, to), this.previousPendingLosses(year), this.installmentsPaid(year, period)]);
    const result = lines.filter((l) => /^[67]/.test(l.accountCode));
    const cumulative = sumOf(result.map((l) => l.creditCents - l.debitCents)) + netOf(lines, (l) => l.accountCode.startsWith("630"));
    const manual = sumOf((await this.s.listAdjustments(year)).filter((a) => a.status === "active" && a.kind === "negative_base").map((a) => a.amountCents));
    return installment202({
      year,
      period,
      method: "art40_3",
      last200: null,
      cumulative: {
        resultCents: cumulative,
        lossesAvailableCents: sumOf((prevLosses.pending ?? []).map((x) => x.amountCents)) + manual,
        withholdingsCents: netOf(lines, (l) => l.accountCode.startsWith("473") && l.origin !== "tax"),
        previousPaymentsCents: sumOf(previous.map((o) => o.paidAmountCents ?? o.amountCents ?? 0)),
        rateBp: corporateRateBp(settings, year),
        hasData: result.length > 0,
        newEntity: !!settings.newEntityFirstProfitYear && year >= settings.newEntityFirstProfitYear && year < settings.newEntityFirstProfitYear + 3,
      },
    });
  }

  preview(model: TaxModel, year: number, period: string) {
    return this.computeDraft(model, year, period);
  }

  // ── Acciones sobre una obligación ─────────────────────────────────────────────────────────────────────────────

  /**
   * Calcula (o recalcula) el borrador. Pendiente o en borrador: se guarda (pasa a «borrador», o a «no aplica» si los
   * datos dicen que no hay que presentarlo). Revisado o ya presentado: NO se sobrescribe; si la huella cambió, se marca
   * `stale` con las diferencias (con `force`, un revisado vuelve a borrador con el cálculo nuevo).
   */
  async calculate(id: number, actor: FinanceActor, opts: { force?: boolean } = {}) {
    const o = await this.mustObligation(id);
    const draft = await this.computeDraft(o.model, o.year, o.period);
    const editable: ObligationStatus[] = ["pendiente", "borrador", "no_aplica"];
    if (editable.includes(o.status) || (o.status === "revisado" && opts.force && !o.frozenAt)) {
      const to: ObligationStatus = draft.applicable ? "borrador" : "no_aplica";
      if (!(await this.s.saveDraft(id, draft, { from: [o.status], to, amountCents: draft.resultCents, outcome: draft.outcome, at: this.now() }))) throw new FinanceError("conflict", "La obligación ha cambiado mientras se calculaba: vuelve a intentarlo");
      await this.log(o, actor, "calculate", to, draft.applicable ? null : draft.reason, { hash: draft.hash, resultCents: draft.resultCents, outcome: draft.outcome });
      await this.audit(actor, "tax.obligation.calculate", "tax_obligation", id, { key: o.key, hash: draft.hash, resultCents: draft.resultCents });
      return { obligation: (await this.s.getObligation(id))!, draft, stale: null };
    }
    const prev = await this.s.getDraft(id);
    const diff = prev ? staleInfo(prev, draft, this.now()) : null;
    await this.s.patchObligation(id, { stale: !!diff, staleDetail: diff }, this.now());
    if (diff && !o.stale) await this.log(o, actor, "stale", null, "Los datos han cambiado después de revisar o presentar: el borrador guardado no se modifica", { previousHash: diff.previousHash, currentHash: diff.currentHash, resultBefore: diff.resultBefore, resultAfter: diff.resultAfter });
    return { obligation: (await this.s.getObligation(id))!, draft: prev, stale: diff };
  }

  async review(id: number, actor: FinanceActor, note?: string | null) {
    const o = await this.mustObligation(id);
    const draft = await this.s.getDraft(id);
    if (o.status !== "borrador" || !draft) throw new FinanceError("invalid_state", "Solo se revisa un borrador calculado");
    if (!draft.hasData) throw new FinanceError("invalid_state", "El borrador no tiene datos: completa lo que falta y vuelve a calcularlo");
    if (!(await this.s.transition(id, ["borrador"], "revisado", { reviewedAt: this.now(), reviewedBy: actor.by }, this.now()))) throw new FinanceError("conflict", "La obligación ha cambiado: recárgala");
    await this.log(o, actor, "review", "revisado", text(note, 500));
    await this.audit(actor, "tax.obligation.review", "tax_obligation", id, { key: o.key, hash: draft.hash });
    return (await this.s.getObligation(id))!;
  }

  /**
   * Registra la presentación que el operador DECLARA haber hecho (con número de justificante y, opcionalmente, el PDF).
   * El sistema no envía nada. En un 303 contabiliza la liquidación del IVA (`tax:303:<año>:<periodo>`).
   */
  async present(id: number, i: PresentInput, actor: FinanceActor) {
    const o = await this.mustObligation(id);
    if (o.status !== "borrador" && o.status !== "revisado") throw new FinanceError("invalid_state", PRESENTED_STATUSES.includes(o.status) ? "La obligación ya está presentada" : "Calcula el borrador antes de registrar la presentación");
    if (!isValidDate(i.presentedOn) || i.presentedOn > this.today()) throw bad("Fecha de presentación no válida (AAAA-MM-DD, no futura)");
    const receipt = text(i.receiptNumber, 100);
    if (!receipt) throw bad("Indica el número de justificante (o el CSV) de la presentación");
    let draft = await this.s.getDraft(id);
    if (!draft || !draft.hasData) throw new FinanceError("invalid_state", "El borrador no tiene datos: no se puede registrar la presentación");
    if (o.stale) throw new FinanceError("invalid_state", "Los datos han cambiado desde el cálculo: recalcula (forzando) y revisa antes de presentar");
    if (o.model === "303" && i.refund && draft.resultCents !== null && draft.resultCents < 0) {
      draft = await this.computeDraft("303", o.year, o.period, { refund: true });
      if (!(await this.s.saveDraft(id, draft, { from: [o.status], to: o.status, amountCents: draft.resultCents, outcome: draft.outcome, at: this.now() }))) throw new FinanceError("conflict", "La obligación ha cambiado: recárgala");
    }
    let documentId: number | null = null;
    if (i.document) documentId = (await this.d.documents.uploadDocument({ ownerType: "tax_obligation", ownerId: id, filename: i.document.filename, contentBase64: i.document.contentBase64 }, actor)).id;
    let settlementEntryId: number | null = null;
    if (o.model === "303") {
      const e = vatSettlementEntry({ year: o.year, period: o.period, date: o.periodTo, devengadoCents: Number(draft.extra.devengadoCents ?? 0), deducibleCents: Number(draft.extra.deducibleCents ?? 0), compensadoCents: Number(draft.extra.compensadoCents ?? 0), resultCents: draft.resultCents ?? 0 });
      if (e) settlementEntryId = (await this.d.finance.postGenerated(e, actor)).entry.id;
    }
    const outcome = draft.outcome;
    const to: ObligationStatus = INFORMATIVE_MODELS.includes(o.model) ? "presentado" : outcome === "a_ingresar" ? (i.directDebit ? "domiciliado" : "presentado") : outcome === "a_compensar" ? "a_compensar" : outcome === "sin_actividad" ? "sin_actividad" : "presentado";
    const ok = await this.s.transition(id, ["borrador", "revisado"], to, { presentedAt: this.now(), presentedBy: actor.by, presentedOn: i.presentedOn, presentedAmountCents: draft.resultCents, receiptRef: receipt, receiptDocumentId: documentId, settlementEntryId, amountCents: draft.resultCents, outcome }, this.now());
    if (!ok) throw new FinanceError("conflict", "La obligación ha cambiado: recárgala");
    await this.log(o, actor, "present", to, text(i.note, 500), { receiptNumber: receipt, documentId, settlementEntryId, hash: draft.hash, resultCents: draft.resultCents });
    await this.audit(actor, "tax.obligation.present", "tax_obligation", id, { key: o.key, receiptNumber: receipt, settlementEntryId, resultCents: draft.resultCents });
    return (await this.s.getObligation(id))!;
  }

  private async bankCode(bankAccountId: number) {
    const b = await this.d.ops.getBankAccount(bankAccountId);
    if (!b || !b.active) throw bad("La cuenta bancaria no existe o está desactivada");
    return b.accountCode;
  }

  /** Registra el pago de una obligación presentada (o el cargo de la domiciliación): Debe cuenta del modelo · Haber banco. */
  async pay(id: number, i: PaymentInput, actor: FinanceActor) {
    const o = await this.mustObligation(id);
    if (!PAYMENT_ACCOUNT[o.model] || INFORMATIVE_MODELS.includes(o.model)) throw new FinanceError("invalid_state", `El modelo ${o.model} es informativo: no tiene pago`);
    if (o.status !== "presentado" && o.status !== "domiciliado") throw new FinanceError("invalid_state", o.status === "pagado" ? "La obligación ya está pagada" : "Registra antes la presentación");
    if (o.outcome !== "a_ingresar") throw new FinanceError("invalid_state", "La obligación no tiene resultado a ingresar");
    if (!isValidDate(i.paidOn) || i.paidOn > this.today()) throw bad("Fecha de pago no válida (AAAA-MM-DD, no futura)");
    const amount = i.amountCents ?? o.presentedAmountCents ?? o.amountCents ?? 0;
    const e = taxPaymentEntry({ obligationId: id, model: o.model, year: o.year, period: o.period, date: i.paidOn, amountCents: amount, bankAccountCode: await this.bankCode(i.bankAccountId) });
    const { entry } = await this.d.finance.postGenerated(e, actor);
    if (!(await this.s.transition(id, ["presentado", "domiciliado"], "pagado", { paidAt: this.now(), paidBy: actor.by, paidOn: i.paidOn, paidAmountCents: amount, paymentEntryId: entry.id }, this.now()))) throw new FinanceError("conflict", "La obligación ha cambiado: recárgala");
    await this.log(o, actor, "pay", "pagado", null, { amountCents: amount, entryId: entry.id, bankAccountId: i.bankAccountId });
    await this.audit(actor, "tax.obligation.pay", "tax_obligation", id, { key: o.key, amountCents: amount, entryId: entry.id });
    return (await this.s.getObligation(id))!;
  }

  /** Marca «a compensar» o «sin actividad» (decisión del operador con su gestoría). */
  async mark(id: number, status: "a_compensar" | "sin_actividad", note: string | null | undefined, actor: FinanceActor) {
    const o = await this.mustObligation(id);
    const from: ObligationStatus[] = ["pendiente", "borrador", "revisado", "presentado"];
    if (!from.includes(o.status)) throw new FinanceError("invalid_state", `No se puede marcar «${status}» una obligación ${o.status}`);
    if (status === "a_compensar" && o.model !== "303") throw bad("Solo un 303 queda a compensar");
    if (!(await this.s.transition(id, [o.status], status, { outcome: status }, this.now()))) throw new FinanceError("conflict", "La obligación ha cambiado: recárgala");
    await this.log(o, actor, "mark", status, text(note, 500));
    await this.audit(actor, "tax.obligation.mark", "tax_obligation", id, { key: o.key, status });
    return (await this.s.getObligation(id))!;
  }

  /**
   * Reabre una obligación presentada sin pago registrado (solo administración): vuelve a borrador y revierte la
   * liquidación del IVA si la hubo. Un trimestre congelado no se reabre.
   */
  async reopen(id: number, reason: string, actor: FinanceActor) {
    const o = await this.mustObligation(id);
    const why = text(reason, 300);
    if (!why || why.length < 3) throw bad("Indica el motivo de la reapertura (3 a 300 caracteres)");
    const from: ObligationStatus[] = ["presentado", "domiciliado", "a_compensar", "sin_actividad", "no_aplica", "revisado"];
    if (!from.includes(o.status)) throw new FinanceError("invalid_state", o.status === "pagado" ? "Una obligación pagada no se reabre: revierte antes el asiento del pago" : "No hay nada que reabrir");
    if (o.frozenAt) throw new FinanceError("invalid_state", "El trimestre fiscal está cerrado: la obligación está congelada");
    let reversal: number | null = null;
    if (o.settlementEntryId) {
      const e = await this.d.finance.getEntry(o.settlementEntryId);
      reversal = (await this.d.finance.reverse(o.settlementEntryId, { date: this.today() < e.date ? e.date : this.today(), reason: `Reapertura del 303: ${why}` }, actor)).entry.id;
    }
    if (!(await this.s.transition(id, [o.status], "borrador", { presentedAt: null, presentedBy: null, presentedOn: null, presentedAmountCents: null, receiptRef: null, receiptDocumentId: null, settlementEntryId: null, reviewedAt: null, reviewedBy: null }, this.now()))) throw new FinanceError("conflict", "La obligación ha cambiado: recárgala");
    await this.log(o, actor, "reopen", "borrador", why, { reversalEntryId: reversal });
    await this.audit(actor, "tax.obligation.reopen", "tax_obligation", id, { key: o.key, reason: why, reversalEntryId: reversal });
    return (await this.s.getObligation(id))!;
  }

  /**
   * Cierre de un trimestre fiscal (§7): congela los borradores presentados de las obligaciones del trimestre (su huella
   * queda fija) y, si se pide, cierra los tres periodos contables (fase 1A).
   */
  async closeQuarter(year: number, quarter: number, closePeriods: boolean, actor: FinanceActor) {
    this.checkYear(year);
    if (![1, 2, 3, 4].includes(quarter)) throw bad("Trimestre no válido (1 a 4)");
    const { from, to } = periodRange("303", year, `${quarter}T`);
    const { items } = await this.s.listObligations({ periodFrom: from, periodTo: to, limit: 500 });
    const inQuarter = items.filter((o) => o.periodFrom >= from && o.periodTo <= to);
    const open = inQuarter.filter((o) => OPEN_STATUSES.includes(o.status));
    if (open.length) throw new FinanceError("invalid_state", `Quedan obligaciones del trimestre sin presentar: ${open.map((o) => `${o.model} ${o.period}`).join(", ")}`);
    let frozen = 0;
    for (const o of inQuarter.filter((x) => !x.frozenAt && x.status !== "no_aplica")) {
      await this.s.patchObligation(o.id, { frozenAt: this.now(), frozenBy: actor.by }, this.now());
      await this.log(o, actor, "freeze", null, `Trimestre ${quarter}T ${year} cerrado`, { hash: o.draftHash });
      frozen++;
    }
    const periods: number[] = [];
    if (closePeriods) {
      const fy = (await this.d.finance.fiscalYears()).find((f) => f.year === year);
      for (const m of [quarter * 3 - 2, quarter * 3 - 1, quarter * 3]) {
        if (fy?.periods.find((p) => p.month === m)?.status === "closed") continue;
        await this.d.finance.setPeriodStatus(year, m, "closed", actor);
        periods.push(m);
      }
    }
    await this.audit(actor, "tax.quarter.close", "tax_quarter", `${year}-${quarter}T`, { frozen, closedPeriods: periods });
    return { year, quarter, frozen, closedPeriods: periods };
  }

  // ── Libros registro ───────────────────────────────────────────────────────────────────────────────────────────

  range(from?: string, to?: string, maxDays = MAX_EXPORT_DAYS) {
    const t = to ?? this.today();
    const f = from ?? `${yearOf(t)}-01-01`;
    if (!isValidDate(f) || !isValidDate(t)) throw bad("Fechas no válidas (AAAA-MM-DD)");
    if (f > t) throw bad("La fecha inicial es posterior a la final");
    if (daysUntil(f, t) > maxDays) throw bad(`El rango no puede superar ${maxDays} días`);
    return { from: f, to: t };
  }

  /** Libro registro de expedidas (registerCsv de la facturación) más los cobros de Stripe sin factura como incidencia. */
  async issuedRegisterCsv(from?: string, to?: string) {
    const r = this.range(from, to);
    if (!this.d.invoices) throw new FinanceError("unavailable", "La facturación propia no está montada en este entorno (migración 0027)");
    const invoices = await this.d.invoices.issuedBetween(r.from, r.to);
    const missing = Array.from(new Set(invoices.map((i) => i.originalInvoiceId).filter((x): x is number => x !== null && !invoices.some((i) => i.id === x))));
    const originals = await this.d.invoices.byIds(missing);
    const byId = new Map([...invoices, ...originals].map((i) => [i.id, i]));
    const incidents: Array<{ date: string; transactionId: string; description: string | null; grossCents: number }> = [];
    if (this.d.stripe) {
      for (let offset = 0; offset < 50_000; offset += 500) {
        const page = await this.d.stripe.listTransactions({ type: "charge", from: r.from, to: r.to, limit: 500, offset });
        for (const t of page.items) if (t.issue === "no_invoice" && t.currency === "EUR") incidents.push({ date: t.createdOn, transactionId: t.balanceTransactionId, description: t.description, grossCents: t.grossCents });
        if (offset + page.items.length >= page.total || !page.items.length) break;
      }
    }
    return { ...r, csv: registerCsv(invoices, byId) + issuedIncidentsCsv(incidents), incidents: incidents.length };
  }

  /** Libro registro de recibidas: gastos registrados y comisiones de Stripe con inversión del sujeto pasivo (por mes). */
  async receivedRegisterCsv(from?: string, to?: string) {
    const r = this.range(from, to);
    const expenses = await this.expensesByInvoiceDate(r.from, r.to);
    const sup = await this.suppliers(expenses.map((e) => e.supplierId));
    const rectified = await this.d.ops.getExpensesByIds(Array.from(new Set(expenses.map((e) => e.rectifiesExpenseId).filter((x): x is number => x !== null))));
    const rows: ReceivedRegisterRow[] = expenses.map((e) => {
      const s = e.supplierId ? sup.get(e.supplierId) : undefined;
      return {
        invoiceDate: e.invoiceDate,
        accrualDate: e.accrualDate,
        number: e.invoiceNumber,
        kind: e.kind === "rectification" ? "R1" : e.kind === "ticket" ? "F2" : "F1",
        supplierName: s?.legalName ?? s?.name ?? e.supplierName ?? "",
        supplierTaxId: s?.taxId ?? null,
        country: s?.country ?? null,
        baseCents: e.baseCents,
        taxRateBp: e.taxRateBp,
        taxCents: e.taxCents,
        deductibleTaxCents: Math.sign(e.taxCents) * Math.round((Math.abs(e.taxCents) * e.deductibleBp) / 10_000),
        withholdingCents: e.withholdingCents,
        totalCents: e.totalCents,
        rectifies: e.rectifiesExpenseId ? (rectified.find((x) => x.id === e.rectifiesExpenseId)?.invoiceNumber ?? `#${e.rectifiesExpenseId}`) : null,
        reverseCharge: false,
      };
    });
    const stripe = (await this.vatLines(r.from, r.to)).filter((l) => l.kind === "stripe" && l.account === "472");
    const byMonth = new Map<string, { base: number; tax: number; rate: number | null }>();
    for (const l of stripe) {
      const m = l.date.slice(0, 7);
      const g = byMonth.get(m) ?? { base: 0, tax: 0, rate: l.taxRateBp };
      const tax = l.debitCents - l.creditCents;
      g.tax += tax;
      g.base += Math.sign(tax) * Math.abs(l.taxBaseCents ?? 0);
      byMonth.set(m, g);
    }
    const settings = await this.settings();
    for (const [m, g] of Array.from(byMonth.entries())) {
      const [y, mm] = m.split("-").map(Number);
      const last = new Date(Date.UTC(y, mm, 0)).toISOString().slice(0, 10);
      rows.push({ invoiceDate: last > r.to ? r.to : last, accrualDate: null, number: `STRIPE-${m}`, kind: "F1", supplierName: "Stripe Payments Europe, Limited (comisiones del mes)", supplierTaxId: settings.stripeVatId, country: settings.stripeVatId?.slice(0, 2) ?? null, baseCents: g.base, taxRateBp: g.rate ?? 0, taxCents: g.tax, deductibleTaxCents: g.tax, withholdingCents: 0, totalCents: g.base, rectifies: null, reverseCharge: true });
    }
    return { ...r, csv: receivedRegisterCsv(rows) };
  }

  // ── Nóminas ───────────────────────────────────────────────────────────────────────────────────────────────────

  async listPayrolls(period?: string) {
    if (period && !/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) throw bad("Mes no válido (AAAA-MM)");
    return this.s.listPayrolls(period ? { period } : {});
  }

  private async mustPayroll(id: number) {
    const p = await this.s.getPayroll(id);
    if (!p) throw notFound("Nómina");
    return p;
  }

  /** Alta (o sustitución mientras sea borrador) de la nómina de un mes y empleado. */
  async savePayroll(i: PayrollInput, actor: FinanceActor): Promise<{ payroll: Payroll; created: boolean }> {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(i.period)) throw bad("Mes no válido (AAAA-MM)");
    const alias = (i.employeeAlias ?? "").trim();
    if (alias.length < 2 || alias.length > 60) throw bad("El alias del empleado tiene de 2 a 60 caracteres");
    if (PERSONAL_ID.test(alias)) throw bad("El alias no puede ser un DNI o NIE: usa un alias sin datos personales");
    for (const [v, what] of [[i.grossCents, "El bruto"], [i.irpfCents, "El IRPF"], [i.ssEmployeeCents, "La Seguridad Social del trabajador"], [i.ssCompanyCents, "La Seguridad Social de la empresa"], [i.netCents, "El líquido"]] as const) if (!Number.isSafeInteger(v) || v < 0) throw bad(`${what} es un importe en céntimos no negativo`);
    if (i.grossCents <= 0) throw bad("El bruto de la nómina es mayor que cero");
    if (i.netCents !== i.grossCents - i.irpfCents - i.ssEmployeeCents) throw bad("El líquido no cuadra: bruto − IRPF − Seguridad Social del trabajador");
    if (i.paymentDate && !isValidDate(i.paymentDate)) throw bad("Fecha de pago no válida (AAAA-MM-DD)");
    const r = await this.s.upsertDraftPayroll({ period: i.period, employeeAlias: alias, grossCents: i.grossCents, irpfCents: i.irpfCents, ssEmployeeCents: i.ssEmployeeCents, ssCompanyCents: i.ssCompanyCents, netCents: i.netCents, payDate: i.paymentDate ?? null, notes: text(i.notes, 500), createdBy: actor.by, createdAt: this.now() });
    await this.audit(actor, r.created ? "payroll.create" : "payroll.replace", "payroll", r.payroll.id, { period: i.period, grossCents: i.grossCents });
    return r;
  }

  /** Contabiliza la nómina (asiento `payroll:<id>`, fecha = último día del mes). */
  async postPayroll(id: number, actor: FinanceActor) {
    const p = await this.mustPayroll(id);
    if (p.status !== "draft") throw new FinanceError("invalid_state", "La nómina ya está registrada");
    const { entry } = await this.d.finance.postGenerated(payrollEntry(p), actor);
    if (!(await this.s.markPayrollPosted(id, entry.id, this.now()))) throw new FinanceError("conflict", "La nómina ha cambiado: recárgala");
    await this.audit(actor, "payroll.post", "payroll", id, { entryId: entry.id });
    return (await this.s.getPayroll(id))!;
  }

  /** Pago del líquido: Debe 465 · Haber banco (`payroll-payment:<id>`). */
  async payPayroll(id: number, i: PaymentInput, actor: FinanceActor) {
    const p = await this.mustPayroll(id);
    if (p.status !== "posted") throw new FinanceError("invalid_state", p.status === "paid" ? "La nómina ya está pagada" : "Registra antes la nómina");
    if (!isValidDate(i.paidOn)) throw bad("Fecha de pago no válida (AAAA-MM-DD)");
    if (i.amountCents !== undefined && i.amountCents !== p.netCents) throw bad("El pago de la nómina es su líquido completo");
    const { entry } = await this.d.finance.postGenerated(payrollPaymentEntry({ id, period: p.period, employeeAlias: p.employeeAlias, netCents: p.netCents, date: i.paidOn, bankAccountCode: await this.bankCode(i.bankAccountId) }), actor);
    if (!(await this.s.markPayrollPaid(id, { entryId: entry.id, paidOn: i.paidOn, bankAccountId: i.bankAccountId, at: this.now() }))) throw new FinanceError("conflict", "La nómina ha cambiado: recárgala");
    await this.audit(actor, "payroll.pay", "payroll", id, { entryId: entry.id });
    return (await this.s.getPayroll(id))!;
  }

  // ── Aplazamientos ─────────────────────────────────────────────────────────────────────────────────────────────

  listDeferrals(q: { status?: DeferralStatus; obligationId?: number } = {}) {
    return this.s.listDeferrals(q);
  }

  /** Aplazamiento o fraccionamiento de una obligación presentada: la obligación pasa a «aplazado». */
  async createDeferral(i: DeferralInput, actor: FinanceActor): Promise<Deferral> {
    const o = await this.mustObligation(i.obligationId);
    if (!PAYMENT_ACCOUNT[o.model] || INFORMATIVE_MODELS.includes(o.model)) throw bad("Solo se aplaza una obligación con resultado a ingresar");
    if (o.status !== "presentado" && o.status !== "domiciliado") throw new FinanceError("invalid_state", "El aplazamiento se registra sobre una obligación presentada y sin pagar");
    if (!isValidDate(i.requestedOn)) throw bad("Fecha de solicitud no válida (AAAA-MM-DD)");
    if (!Number.isSafeInteger(i.principalCents) || i.principalCents <= 0) throw bad("El principal es un importe en céntimos mayor que cero");
    const interest = i.interestCents ?? 0;
    if (!Number.isSafeInteger(interest) || interest < 0) throw bad("Los intereses son un importe en céntimos no negativo");
    const inst = [...i.installments].sort((a, b) => a.n - b.n);
    if (!inst.length || inst.length > 60) throw bad("Indica de 1 a 60 cuotas");
    if (inst.some((x, k) => x.n !== k + 1)) throw bad("Las cuotas se numeran 1, 2, 3…");
    if (inst.some((x) => !isValidDate(x.dueDate) || !Number.isSafeInteger(x.amountCents) || x.amountCents <= 0)) throw bad("Cada cuota lleva fecha (AAAA-MM-DD) e importe mayor que cero");
    if (sumOf(inst.map((x) => x.amountCents)) !== i.principalCents) throw bad("Las cuotas deben sumar el principal");
    const d = await this.s.insertDeferral({ obligationId: o.id, status: "solicitado", requestedOn: i.requestedOn, resolutionOn: null, reference: text(i.reference, 60), principalCents: i.principalCents, interestCents: interest, notes: text(i.notes, 500), createdBy: actor.by, createdAt: this.now() }, inst.map((x) => ({ number: x.n, dueDate: x.dueDate, amountCents: x.amountCents, interestCents: 0 })));
    if (!(await this.s.transition(o.id, ["presentado", "domiciliado"], "aplazado", {}, this.now()))) throw new FinanceError("conflict", "La obligación ha cambiado: recárgala");
    await this.log(o, actor, "defer", "aplazado", d.reference, { deferralId: d.id, installments: inst.length });
    await this.audit(actor, "tax.deferral.create", "tax_deferral", d.id, { obligationId: o.id, principalCents: i.principalCents, installments: inst.length });
    return d;
  }

  async patchDeferral(id: number, p: { status?: DeferralStatus; resolutionOn?: string | null; reference?: string | null; notes?: string | null }, actor: FinanceActor) {
    const d = await this.s.getDeferral(id);
    if (!d) throw notFound("Aplazamiento");
    if (p.status === "pagado" || p.status === "en_curso") throw bad("«en curso» y «pagado» los fija el pago de las cuotas");
    if (p.resolutionOn && !isValidDate(p.resolutionOn)) throw bad("Fecha de resolución no válida");
    const out = (await this.s.patchDeferral(id, { status: p.status, resolutionOn: p.resolutionOn, reference: p.reference === undefined ? undefined : text(p.reference, 60), notes: p.notes === undefined ? undefined : text(p.notes, 500) }, this.now()))!;
    await this.audit(actor, "tax.deferral.update", "tax_deferral", id, { status: p.status ?? null });
    return out;
  }

  /**
   * Pago de una cuota: Debe cuenta del modelo (principal de la cuota) · Debe 669 (intereses = lo pagado de más) ·
   * Haber banco (`tax-deferral:<id>:<n>`). Con todas pagadas, el aplazamiento y la obligación quedan pagados.
   */
  async payInstallment(id: number, n: number, i: PaymentInput, actor: FinanceActor) {
    const d = await this.s.getDeferral(id);
    if (!d) throw notFound("Aplazamiento");
    if (d.status === "denegado" || d.status === "cancelado") throw new FinanceError("invalid_state", `El aplazamiento está ${d.status}`);
    const inst = d.installments.find((x) => x.number === n);
    if (!inst) throw notFound("Cuota");
    if (inst.status === "pagada") throw new FinanceError("invalid_state", "La cuota ya está pagada");
    if (!isValidDate(i.paidOn)) throw bad("Fecha de pago no válida (AAAA-MM-DD)");
    const paid = i.amountCents ?? inst.amountCents + inst.interestCents;
    if (!Number.isSafeInteger(paid) || paid < inst.amountCents) throw bad("Lo pagado no puede ser menor que el importe de la cuota");
    const o = await this.mustObligation(d.obligationId);
    const { entry } = await this.d.finance.postGenerated(deferralInstallmentEntry({ deferralId: id, number: n, model: o.model, date: i.paidOn, amountCents: inst.amountCents, interestCents: paid - inst.amountCents, bankAccountCode: await this.bankCode(i.bankAccountId), label: `Aplazamiento del modelo ${o.model} ${periodLabel(o.year, o.period)}` }), actor);
    if (!(await this.s.payInstallment(id, n, { entryId: entry.id, paidOn: i.paidOn, by: actor.by, at: this.now() }))) throw new FinanceError("conflict", "La cuota ya se ha pagado");
    const after = (await this.s.getDeferral(id))!;
    const done = after.installments.every((x) => x.status === "pagada");
    await this.s.patchDeferral(id, { status: done ? "pagado" : "en_curso" }, this.now());
    if (done && (await this.s.transition(o.id, ["aplazado"], "pagado", { paidAt: this.now(), paidBy: actor.by, paidOn: i.paidOn, paidAmountCents: d.principalCents }, this.now()))) await this.log(o, actor, "pay", "pagado", "Aplazamiento pagado por completo", { deferralId: id });
    await this.audit(actor, "tax.deferral.pay", "tax_deferral", id, { number: n, entryId: entry.id, amountCents: paid });
    return (await this.s.getDeferral(id))!;
  }

  // ── Expedientes ───────────────────────────────────────────────────────────────────────────────────────────────

  listDossiers(status?: DossierStatus) {
    return this.s.listDossiers({ status });
  }

  async dossier(id: number) {
    const d = await this.s.getDossier(id);
    if (!d) throw notFound("Expediente");
    const [log, documents] = await Promise.all([this.s.dossierLog(id), this.d.documents.documents("tax_dossier", id)]);
    return { dossier: d, log, documents };
  }

  private async checkDossier(i: Partial<DossierInput>) {
    if (i.agency !== undefined && (!i.agency.trim() || i.agency.length > 120)) throw bad("Indica el organismo (máximo 120 caracteres)");
    if (i.subject !== undefined && (!i.subject.trim() || i.subject.length > 300)) throw bad("Indica el asunto (máximo 300 caracteres)");
    for (const v of [i.notifiedOn, i.responseDueOn]) if (v && !isValidDate(v)) throw bad("Fechas no válidas (AAAA-MM-DD)");
    if (i.obligationId) await this.mustObligation(i.obligationId);
  }

  async createDossier(i: DossierInput, actor: FinanceActor) {
    await this.checkDossier(i);
    const d = await this.s.insertDossier({ kind: i.kind, agency: i.agency.trim(), reference: text(i.reference, 80), subject: i.subject.trim(), notifiedOn: i.notifiedOn ?? null, responseDueOn: i.responseDueOn ?? null, status: i.status ?? "abierto", obligationId: i.obligationId ?? null, notes: text(i.notes, 4000), createdBy: actor.by, createdAt: this.now() });
    await this.s.addDossierLog({ dossierId: d.id, at: this.now(), actor: actor.by, requestId: actor.requestId, action: "create", note: `Expediente abierto: ${d.subject}`, detail: { status: d.status } });
    await this.audit(actor, "tax.dossier.create", "tax_dossier", d.id, { kind: d.kind, status: d.status });
    return d;
  }

  async patchDossier(id: number, p: Partial<DossierInput>, actor: FinanceActor) {
    const before = await this.s.getDossier(id);
    if (!before) throw notFound("Expediente");
    await this.checkDossier(p);
    const patch = { kind: p.kind, agency: p.agency?.trim(), reference: p.reference === undefined ? undefined : text(p.reference, 80), subject: p.subject?.trim(), notifiedOn: p.notifiedOn, responseDueOn: p.responseDueOn, status: p.status, obligationId: p.obligationId, notes: p.notes === undefined ? undefined : text(p.notes, 4000) };
    const d = (await this.s.patchDossier(id, patch, this.now()))!;
    const changed = Object.entries(patch).filter(([k, v]) => v !== undefined && (before as unknown as Record<string, unknown>)[k] !== v).map(([k]) => k);
    if (changed.length) await this.s.addDossierLog({ dossierId: id, at: this.now(), actor: actor.by, requestId: actor.requestId, action: p.status && p.status !== before.status ? "status" : "update", note: p.status && p.status !== before.status ? `Estado: ${before.status} → ${p.status}` : `Datos actualizados: ${changed.join(", ")}`, detail: { changed } });
    await this.audit(actor, "tax.dossier.update", "tax_dossier", id, { changed });
    return d;
  }

  async addDossierNote(id: number, note: string, actor: FinanceActor) {
    if (!(await this.s.getDossier(id))) throw notFound("Expediente");
    const n = (note ?? "").trim();
    if (!n || n.length > 2000) throw bad("La nota tiene de 1 a 2000 caracteres");
    await this.s.addDossierLog({ dossierId: id, at: this.now(), actor: actor.by, requestId: actor.requestId, action: "note", note: n, detail: null });
    await this.audit(actor, "tax.dossier.note", "tax_dossier", id, null);
    return this.dossier(id);
  }

  /** ¿Existe el propietario de un documento de la fase 3? (enchufado al servicio de operaciones). */
  async documentOwnerExists(ownerType: DocumentOwner, ownerId: number) {
    if (ownerType === "tax_obligation") return !!(await this.s.getObligation(ownerId));
    if (ownerType === "payroll") return !!(await this.s.getPayroll(ownerId));
    if (ownerType === "tax_dossier") return !!(await this.s.getDossier(ownerId));
    return false;
  }

  // ── Impuesto sobre Sociedades ─────────────────────────────────────────────────────────────────────────────────

  async corporate(year: number) {
    this.checkYear(year);
    const [draft, adjustments, obligation, installments] = await Promise.all([this.computeDraft("200", year, ANNUAL), this.s.listAdjustments(year), this.s.getObligationByKey(obligationKey("200", year, ANNUAL)), this.s.listObligations({ year, model: "202", limit: 10 })]);
    return { draft, adjustments, obligation, installments: installments.items };
  }

  /**
   * Alta de un ajuste del 200; con `id`, sustituye el existente (se anula y, si el importe es mayor que cero, se da de
   * alta el nuevo): nada se borra.
   */
  async saveAdjustment(year: number, i: { id?: number; kind: AdjustmentKind; description: string; amountCents: number; originYear?: number | null }, actor: FinanceActor) {
    this.checkYear(year);
    if (!ADJUSTMENT_KINDS.includes(i.kind)) throw bad("Clase de ajuste no válida");
    const description = (i.description ?? "").trim();
    if (!description || description.length > 300) throw bad("Describe el ajuste (máximo 300 caracteres)");
    if (!Number.isSafeInteger(i.amountCents) || i.amountCents < 0 || (i.amountCents === 0 && !i.id)) throw bad("El importe es un número de céntimos mayor que cero (0 con `id` anula el ajuste)");
    if (i.kind === "negative_base" && (!i.originYear || i.originYear >= year || i.originYear < year - 30)) throw bad("Una base negativa necesita su ejercicio de origen (anterior al del 200)");
    if (i.id) {
      const cur = (await this.s.listAdjustments(year)).find((a) => a.id === i.id);
      if (!cur) throw notFound("Ajuste");
      if (!(await this.s.voidAdjustment(i.id, { by: actor.by, at: this.now(), reason: "Sustituido o anulado desde el CRM" }))) throw new FinanceError("conflict", "El ajuste ya estaba anulado");
    }
    const created = i.amountCents > 0 ? await this.s.insertAdjustment({ year, kind: i.kind, description, amountCents: i.amountCents, originYear: i.kind === "negative_base" ? i.originYear! : (i.originYear ?? null), createdBy: actor.by, createdAt: this.now() }) : null;
    await this.audit(actor, "tax.adjustment.save", "tax_adjustment", created?.id ?? i.id ?? null, { year, kind: i.kind, amountCents: i.amountCents, replaces: i.id ?? null });
    return created;
  }

  // ── Panel y avisos ────────────────────────────────────────────────────────────────────────────────────────────

  async dashboard() {
    const today = this.today();
    const year = yearOf(today);
    const q = Math.floor((Number(today.slice(5, 7)) - 1) / 3) + 1;
    const stored = await this.s.getSettings();
    const settings = stored ?? this.defaults();
    const [upcoming, overdue, staleRows, deferrals, dossiers] = await Promise.all([
      this.s.listObligations({ dueFrom: today, statuses: ["pendiente", "borrador", "revisado", "presentado", "domiciliado"], limit: 10 }),
      this.s.listObligations({ dueTo: addDays(today, -1), statuses: [...OPEN_STATUSES], limit: 50 }),
      this.s.listObligations({ statuses: [...PRESENTED_STATUSES, "revisado"], limit: 500 }),
      this.s.listDeferrals({}),
      this.s.listDossiers({}),
    ]);
    const estimates: Array<{ model: TaxModel; period: string; label: string; amountCents: number | null; result: string | null; obligationId: number | null }> = [];
    const currentPeriods: Array<[TaxModel, string]> = [["303", settings.vatPeriod === "monthly" ? today.slice(5, 7) : `${q}T`], ["111", `${q}T`], ["115", `${q}T`]];
    for (const [model, period] of currentPeriods) {
      if (!modelApplicability(model, settings).applies) continue;
      const d = await this.computeDraft(model, year, period);
      const o = await this.s.getObligationByKey(obligationKey(model, year, period));
      estimates.push({ model, period, label: `${MODEL_NAMES[model]} · ${periodLabel(year, period)}`, amountCents: d.resultCents, result: d.outcome, obligationId: o?.id ?? null });
    }
    const liveDeferrals = deferrals.filter((d) => d.status === "solicitado" || d.status === "concedido" || d.status === "en_curso");
    const pendingInst = liveDeferrals.flatMap((d) => d.installments.filter((x) => x.status === "pendiente"));
    const openDossiers = dossiers.filter((d) => d.status !== "cerrado");
    const futureDeadlines = openDossiers.map((d) => d.responseDueOn).filter((x): x is string => !!x && x >= today).sort();
    const warnings: Array<{ code: string; message: string; obligationId: number | null }> = [];
    if (!stored) warnings.push({ code: "sin_configuracion", message: "La configuración fiscal no está guardada: revísala para que el calendario refleje tus obligaciones", obligationId: null });
    for (const o of overdue.items) warnings.push({ code: "vencida", message: `El modelo ${o.model} (${periodLabel(o.year, o.period)}) venció el ${o.dueDate} sin registrar la presentación`, obligationId: o.id });
    for (const o of upcoming.items) {
      const days = daysUntil(today, o.dueDate);
      if (days <= 15 && OPEN_STATUSES.includes(o.status)) warnings.push({ code: "vence_pronto", message: `El modelo ${o.model} (${periodLabel(o.year, o.period)}) vence en ${days} ${days === 1 ? "día" : "días"} (${o.dueDate})`, obligationId: o.id });
    }
    for (const o of staleRows.items.filter((x) => x.stale)) warnings.push({ code: "datos_cambiados", message: `Los datos del modelo ${o.model} (${periodLabel(o.year, o.period)}) han cambiado después de revisarlo o presentarlo`, obligationId: o.id });
    for (const d of openDossiers.filter((x) => x.responseDueOn && x.responseDueOn < today)) warnings.push({ code: "expediente_vencido", message: `El plazo de respuesta del expediente «${d.subject}» venció el ${d.responseDueOn}`, obligationId: d.obligationId });
    return {
      asOf: today,
      hasEmployees: settings.hasEmployees,
      settingsMissing: !stored,
      quarter: { label: `${q}.º trimestre ${year}` },
      upcoming: upcoming.items,
      estimates,
      deferrals: { count: liveDeferrals.length, pendingCents: sumOf(pendingInst.map((x) => x.amountCents)), nextDueDate: pendingInst.map((x) => x.dueDate).sort()[0] ?? null },
      dossiers: { open: openDossiers.length, nextDeadline: futureDeadlines[0] ?? null, overdue: openDossiers.filter((x) => x.responseDueOn && x.responseDueOn < today).length },
      warnings,
    };
  }

  /**
   * Avisos de vencimiento (15, 7 y 3 días; patrón `lastReminderDays` del tenant): marca cada umbral una sola vez por
   * obligación (también entre réplicas) y devuelve los que hay que avisar. Solo lo llama el ciclo de alertas con el
   * interruptor `CP_FINANCE_TAX_REMINDERS_ENABLED=1`.
   */
  async dueReminders(): Promise<TaxReminder[]> {
    const today = this.today();
    const { items } = await this.s.listObligations({ dueFrom: today, dueTo: addDays(today, 15), statuses: [...OPEN_STATUSES], limit: 200 });
    const out: TaxReminder[] = [];
    for (const o of items) {
      const daysLeft = daysUntil(today, o.dueDate);
      const bucket = reminderBucket(daysLeft, o.lastReminderDays);
      if (bucket === null) continue;
      if (await this.s.markReminder(o.id, bucket)) out.push({ obligationId: o.id, key: o.key, model: o.model, period: o.period, year: o.year, dueDate: o.dueDate, daysLeft, bucket, amountCents: o.amountCents });
    }
    return out;
  }

  // ── Exportación para la gestoría ──────────────────────────────────────────────────────────────────────────────

  /**
   * ZIP para la gestoría (adaptado de `buildDossierZip`, server/gestoriaDossier.ts): libro diario, sumas y saldos,
   * libros registro, borradores guardados de las obligaciones del rango, calendario y listado de documentos (solo sus
   * datos, sin contenido). Sin contraseñas ni datos personales: las nóminas van por alias.
   */
  async exportZip(from?: string, to?: string) {
    const r = this.range(from, to);
    const zip = new JSZip();
    const settings = await this.settings();
    const [journal, tb, received, obligations] = await Promise.all([this.d.finance.journalCsv(r.from, r.to), this.d.finance.trialBalanceCsv(r.from, r.to), this.receivedRegisterCsv(r.from, r.to), this.s.listObligations({ periodFrom: r.from, periodTo: r.to, limit: 500 })]);
    zip.file("libro-diario.csv", journal.csv);
    zip.file("sumas-y-saldos.csv", tb.csv);
    zip.file("libro-registro-recibidas.csv", received.csv);
    let issuedNote = "";
    if (this.d.invoices) zip.file("libro-registro-expedidas.csv", (await this.issuedRegisterCsv(r.from, r.to)).csv);
    else issuedNote = "La facturación propia no está montada: no se incluye el libro de expedidas.";
    const docRows: string[][] = [];
    for (const o of obligations.items) {
      const draft = await this.s.getDraft(o.id);
      if (draft) zip.file(`modelos/${o.model}-${o.year}-${o.period}.csv`, draftCsv(draft, periodLabel(o.year, o.period)));
      for (const doc of await this.d.documents.documents("tax_obligation", o.id)) docRows.push([`${o.model} ${o.period} ${o.year}`, String(doc.id), doc.filename, doc.mime, String(doc.sizeBytes), doc.sha256, doc.archived ? "archivado" : ""]);
    }
    const cell = (v: string | number | null) => {
      const s = String(v ?? "");
      return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = (rows: Array<Array<string | number | null>>) => "﻿" + rows.map((x) => x.map(cell).join(";")).join("\r\n") + "\r\n";
    zip.file("obligaciones.csv", csv([["Modelo", "Periodo", "Ejercicio", "Vencimiento", "Estado", "Resultado (céntimos)", "Presentada el", "Justificante", "Pagada el", "Huella del borrador", "Datos cambiados"], ...obligations.items.map((o) => [o.model, o.period, o.year, o.dueDate, o.status, o.amountCents, o.presentedOn, o.receiptRef, o.paidOn, o.draftHash, o.stale ? "sí" : "no"])]));
    zip.file("documentos.csv", csv([["Obligación", "Documento", "Fichero", "Tipo", "Bytes", "sha256", "Estado"], ...docRows]));
    zip.file(
      "LEEME.txt",
      [
        `Exportación para la gestoría · ${settings.legalName ?? ""}${settings.taxId ? ` (NIF ${settings.taxId})` : ""}`,
        `Periodo: ${r.from} a ${r.to}`,
        "",
        "Borradores calculados por el sistema. Revísalos con tu gestoría: el sistema no presenta declaraciones.",
        "Importes de los CSV en euros con coma decimal (separador «;», UTF-8 con BOM).",
        issuedNote,
      ]
        .filter((l) => l !== "")
        .join("\r\n"),
    );
    const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
    return { ...r, buffer, files: Object.keys(zip.files).filter((k) => !k.endsWith("/")).length };
  }
}
