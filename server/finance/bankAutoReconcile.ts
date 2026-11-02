/**
 * Conciliación bancaria automática con reglas deterministas (./bankRules.ts) sobre los movimientos PENDIENTES de los
 * extractos importados. Reutiliza la conciliación manual (`FinanceOpsService.match`): cada conciliación tiene su asiento
 * idempotente (`bankmov:<id>`), su auditoría con la regla y la evidencia, y se deshace con «Desvincular» (revierte el
 * asiento). Lo dudoso no se toca.
 *
 *  - `bank_fee`: asiento contra 626 con la naturaleza de la comisión (servicio bancario o comisión de cobro).
 *  - `supplier_charge`: gasto «pendiente de factura» del proveedor (`bank-charge:<movimiento>`, tique sin IVA: no se
 *    inventa; fuera de los modelos hasta tener la factura) y su pago por banco (Debe 410 · Haber banco).
 *  - `tax_payment`: solo contra una obligación presentada y sin pagar con el MISMO importe (o la cuota pendiente de un
 *    aplazamiento con principal + intereses iguales al cargo): registra el pago en Gestoría (su asiento) y vincula el
 *    movimiento sin otro asiento. Sin obligación que case, pendiente.
 *
 * Idempotente: solo trata movimientos pendientes y cada gasto o asiento tiene clave única. `dryRun` no escribe nada.
 */
import { BANK_RULES, bankChargeExpenseSourceKey, ruleFor, type BankRule, type KnownSupplier } from "./bankRules";
import type { FinanceOpsService } from "./opsService";
import type { FinanceOpsStore } from "./opsStore";
import type { BankMovement } from "./opsTypes";
import type { FinanceTaxService } from "./taxService";
import { FinanceError, type FinanceActor } from "./types";

export const BANK_RULES_ACTOR = "system:bank-rules";

export interface AutoReconcileItem {
  movementId: number;
  bookingDate: string;
  amountCents: number;
  description: string;
  rule: string;
  /** applied: conciliado; proposed: lo haría (dryRun); skipped: la regla exige algo que falta (motivo). */
  outcome: "applied" | "proposed" | "skipped" | "error";
  detail: string;
  entryId?: number | null;
  expenseId?: number | null;
}

export interface AutoReconcileResult {
  scanned: number;
  applied: number;
  proposed: number;
  skipped: number;
  errors: number;
  /** Pendientes sin ninguna regla aplicable (revisión manual). */
  unmatched: number;
  byRule: Record<string, number>;
  items: AutoReconcileItem[];
}

export interface BankAutoReconcileDeps {
  ops: Pick<FinanceOpsService, "match" | "registerExpense" | "linkExistingEntry">;
  store: Pick<FinanceOpsStore, "listMovements" | "listSuppliers" | "insertSupplier" | "listCategories" | "insertExpense" | "getExpense">;
  tax?: Pick<FinanceTaxService, "obligationsAwaitingPayment" | "pay" | "deferralsAwaitingPayment" | "payInstallment"> | null;
  now?: () => number;
}

const eur = (c: number) => `${(c / 100).toFixed(2).replace(".", ",")} €`;

export class BankAutoReconciler {
  private readonly now: () => number;
  constructor(private readonly d: BankAutoReconcileDeps) {
    this.now = d.now ?? Date.now;
  }

  /** Movimientos pendientes (todas las páginas), de una cuenta o de todas. */
  private async pending(bankAccountId?: number): Promise<BankMovement[]> {
    const out: BankMovement[] = [];
    for (let offset = 0; ; offset += 500) {
      const page = await this.d.store.listMovements({ status: "pending", ...(bankAccountId ? { bankAccountId } : {}), limit: 500, offset });
      out.push(...page.items);
      if (out.length >= page.total || !page.items.length) return out;
    }
  }

  /** Proveedor conocido (por nombre exacto) o su alta, sin NIF-IVA ni domicilio hasta tener la factura. */
  private async supplierFor(s: KnownSupplier, actor: FinanceActor): Promise<number> {
    const found = (await this.d.store.listSuppliers({ q: s.name, limit: 50 })).items.find((x) => x.name.toLowerCase() === s.name.toLowerCase());
    if (found) return found.id;
    const row = await this.d.store.insertSupplier({
      name: s.name,
      legalName: null,
      taxId: null,
      country: s.country,
      address: null,
      email: null,
      phone: null,
      iban: null,
      paymentTermsDays: null,
      defaultCategoryId: null,
      defaultCostCenterId: null,
      accountCode: "410",
      notes: "Alta automática por sus cargos bancarios (conciliación por reglas). Razón social, NIF-IVA, país y domicilio: verificarlos con la primera factura.",
      active: true,
      createdBy: actor.by,
      createdAt: this.now(),
    });
    return row.id;
  }

  private async categoryFor(s: KnownSupplier): Promise<number> {
    const cats = await this.d.store.listCategories();
    const c = cats.find((x) => x.name === s.category && x.accountCode === s.accountCode) ?? cats.find((x) => x.accountCode === s.accountCode && x.active);
    if (!c) throw new FinanceError("invalid_state", `No hay categoría de gasto con la cuenta ${s.accountCode}`);
    return c.id;
  }

  private async applyBankFee(m: BankMovement, r: Extract<BankRule, { kind: "bank_fee" }>, actor: FinanceActor): Promise<Partial<AutoReconcileItem>> {
    const done = await this.d.ops.match(m.id, { type: "other", nature: r.nature, description: `${m.description ?? r.label} · regla ${r.code}` }, actor);
    return { entryId: done.entryId, detail: `${r.label}: asiento contra la cuenta de la naturaleza «${r.nature}»` };
  }

  private async applySupplierCharge(m: BankMovement, r: Extract<BankRule, { kind: "supplier_charge" }>, actor: FinanceActor): Promise<Partial<AutoReconcileItem>> {
    const supplierId = await this.supplierFor(r.supplier, actor);
    const categoryId = await this.categoryFor(r.supplier);
    const base = -m.amountCents;
    const { expense } = await this.d.store.insertExpense({
      supplierId,
      categoryId,
      costCenterId: null,
      invoiceNumber: null,
      invoiceDate: m.bookingDate,
      accrualDate: null,
      dueDate: null,
      description: `${r.supplier.name} · cargo con tarjeta «${m.description ?? ""}» del ${m.bookingDate} (pendiente de factura)`.slice(0, 500),
      baseCents: base,
      taxRateBp: 0,
      taxCents: 0,
      deductibleBp: 10_000,
      withholdingRateBp: 0,
      withholdingCents: 0,
      totalCents: base,
      currency: "EUR",
      kind: "ticket",
      rectifiesExpenseId: null,
      vatTreatment: null,
      reverseChargeRateBp: null,
      settlesStripeFees: false,
      sourceKey: bankChargeExpenseSourceKey(m.id),
      createdBy: actor.by,
      createdAt: this.now(),
    });
    // Un fallo a medias se retoma: el gasto ya existe (misma clave) y solo falta registrarlo o pagarlo
    const reg = expense.status === "draft" ? await this.d.ops.registerExpense(expense.id, actor) : expense;
    const done = await this.d.ops.match(m.id, { type: "expense_payment", expenseId: reg.id }, actor);
    return { expenseId: reg.id, entryId: done.entryId, detail: `${r.label}: gasto #${reg.id} pendiente de factura (sin IVA) y su pago por banco` };
  }

  private async applyTaxPayment(m: BankMovement, r: Extract<BankRule, { kind: "tax_payment" }>, actor: FinanceActor): Promise<Partial<AutoReconcileItem> & { skip?: string }> {
    if (!this.d.tax) return { skip: "Gestoría e impuestos no está montado" };
    const amount = -m.amountCents;
    if (r.model === "deferral") {
      const hits = (await this.d.tax.deferralsAwaitingPayment()).filter((x) => x.totalCents === amount);
      if (hits.length !== 1) return { skip: hits.length ? `${hits.length} cuotas de aplazamiento por ${eur(amount)}: ambiguo` : `Ninguna cuota de aplazamiento pendiente por ${eur(amount)} (registra el aplazamiento con su calendario oficial)` };
      const h = hits[0];
      const d = await this.d.tax.payInstallment(h.deferralId, h.number, { paidOn: m.bookingDate, bankAccountId: m.bankAccountId, amountCents: amount }, actor);
      const entryId = d.installments.find((x) => x.number === h.number)?.entryId ?? null;
      await this.d.ops.linkExistingEntry(m.id, { type: "tax", matchId: h.deferralId, entryId, note: `${r.code}: cuota ${h.number} del aplazamiento #${h.deferralId}` }, actor);
      return { entryId, detail: `${r.label}: cuota ${h.number} (principal ${eur(h.amountCents)} + intereses ${eur(h.interestCents)})` };
    }
    const hits = (await this.d.tax.obligationsAwaitingPayment(r.model)).filter((o) => o.amountCents === amount);
    if (hits.length !== 1) return { skip: hits.length ? `${hits.length} obligaciones del ${r.model} por ${eur(amount)}: ambiguo` : `Ninguna obligación del ${r.model} presentada y sin pagar por ${eur(amount)}` };
    const o = await this.d.tax.pay(hits[0].id, { paidOn: m.bookingDate, bankAccountId: m.bankAccountId, amountCents: amount }, actor);
    await this.d.ops.linkExistingEntry(m.id, { type: "tax", matchId: o.id, entryId: o.paymentEntryId ?? null, note: `${r.code}: obligación ${o.model} ${o.period} ${o.year}` }, actor);
    return { entryId: o.paymentEntryId ?? null, detail: `${r.label}: obligación ${o.model} ${o.period} ${o.year} pagada` };
  }

  /** Aplica las reglas a los movimientos pendientes. `dryRun`: solo dice qué haría. */
  async run(actor: FinanceActor, o: { bankAccountId?: number; dryRun?: boolean } = {}): Promise<AutoReconcileResult> {
    const out: AutoReconcileResult = { scanned: 0, applied: 0, proposed: 0, skipped: 0, errors: 0, unmatched: 0, byRule: {}, items: [] };
    const movements = await this.pending(o.bankAccountId);
    out.scanned = movements.length;
    for (const m of movements.sort((a, b) => a.bookingDate.localeCompare(b.bookingDate) || a.id - b.id)) {
      const r = ruleFor(m);
      if (!r) {
        out.unmatched++;
        continue;
      }
      const base: AutoReconcileItem = { movementId: m.id, bookingDate: m.bookingDate, amountCents: m.amountCents, description: m.description ?? "", rule: r.code, outcome: "proposed", detail: r.label };
      if (o.dryRun) {
        out.proposed++;
        out.byRule[r.code] = (out.byRule[r.code] ?? 0) + 1;
        out.items.push(base);
        continue;
      }
      try {
        const res: Partial<AutoReconcileItem> & { skip?: string } = r.kind === "bank_fee" ? await this.applyBankFee(m, r, actor) : r.kind === "supplier_charge" ? await this.applySupplierCharge(m, r, actor) : await this.applyTaxPayment(m, r, actor);
        if (res.skip) {
          out.skipped++;
          out.items.push({ ...base, outcome: "skipped", detail: res.skip });
          continue;
        }
        out.applied++;
        out.byRule[r.code] = (out.byRule[r.code] ?? 0) + 1;
        const { skip: _skip, ...applied } = res;
        out.items.push({ ...base, ...applied, outcome: "applied" });
      } catch (e) {
        if (!(e instanceof FinanceError)) throw e;
        out.errors++;
        out.items.push({ ...base, outcome: "error", detail: e.message });
      }
    }
    return out;
  }

  /** Reglas vigentes (para el CRM). */
  static rules() {
    return BANK_RULES.map((r) => ({ code: r.code, kind: r.kind, label: r.label, pattern: r.test.source, ...(r.kind === "supplier_charge" ? { supplier: r.supplier.name, accountCode: r.supplier.accountCode } : r.kind === "bank_fee" ? { nature: r.nature } : { model: r.model }) }));
  }
}
