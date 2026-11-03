/**
 * Factura propia (serie EB) de las ventas cobradas por Stripe desde el panel, con dobles del registro de Stripe (datos
 * sintéticos): alta desde la prueba, compra de un módulo con prorrateo y renovación. Cada cobro verificado → un borrador
 * con los importes y el IVA cobrados → expedición con número → documento fiscal emitido. Nunca dos facturas del mismo
 * cobro, nunca sin cobro verificado, comprador incompleto bloqueado, empresas aisladas y los servicios externos igual.
 */
import { describe, expect, it } from "vitest";
import { chargeInstant } from "../external/schedule";
import type { ExternalEvent, ExternalSubscription } from "../external/types";
import { FinanceAutomation } from "../finance/automation";
import type { BuyerProfile } from "../stripe/buyerProfile";
import { invoiceDocumentOf, invoiceRecordOf, invoiceSourceKey, rectificationOf, type FiscalDocument, type FiscalDocumentStatus, type StripeInvoiceRecord } from "../stripe/fiscalDocuments";
import type { GwInvoice, GwInvoiceLine } from "../stripe/gateway";
import { linesOf, type InvoiceLineRow } from "../stripe/invoiceLines";
import { ISSUER } from "../stripe/issuer";
import { InvoicingAutomation, invoicePdfBlocks } from "./delivery";
import { invoiceHtml } from "./document";
import { registerCsv } from "./register";
import type { FiscalCasesConfig } from "./fiscalCases";
import { FISCAL_MATRIX_VERSION } from "./fiscalMatrix";
import type { CompanyFiscal } from "./rules";
import { InvoicingService } from "./service";
import { MemoryInvoicingStore } from "./store";
import { accrualOf, allocateDiscount, productLabel, rateOf, saleLines, StripeSalesInvoicing, stripeSaleSourceKey, type StripeSalesRegistry } from "./stripeSales";
import type { FiscalParty } from "./types";

const TZ = "Europe/Madrid";
const NOV2 = chargeInstant("2026-11-02", 10, TZ);
const DEC2 = chargeInstant("2026-12-02", 10, TZ);
const DAY = 86_400_000;
const sec = (ms: number) => Math.floor(ms / 1000);
const ISSUER_PARTY: FiscalParty = { legalName: ISSUER.legalName, taxId: ISSUER.taxId, address: `${ISSUER.address.line1}, ${ISSUER.address.line2}`, postalCode: ISSUER.address.postalCode, city: ISSUER.address.city, country: "ES" };
const NEXTAIR: CompanyFiscal = { name: "Nextair", legalName: "CLIENTE EXTERNO SINTÉTICO SL", taxId: "B12345674", address: "Calle Ejemplo 1", postalCode: "18006", city: "Granada", country: "ES", billingEmail: "facturas@externo.example" };

/** Perfil fiscal declarado en el alta (lo que usa Stripe Tax). */
const profile = (orderId: number, p: Partial<BuyerProfile> = {}): BuyerProfile =>
  ({
    orderId,
    type: "business",
    territory: "es_mainland",
    scenario: "business:es_mainland",
    country: "ES",
    postalCode: "28001",
    displayName: `ESCUELA SINTÉTICA ${orderId} SL`,
    taxId: "B12345674",
    taxIdStatus: "unverified",
    billingEmail: `facturas${orderId}@escuela.example`,
    contactName: "Persona de contacto",
    billingAddress: { line1: "Calle Mayor 1", line2: null, city: "Madrid", state: null },
    consent: { source: "web", terms: { version: "v1", at: NOV2 }, privacy: null, precontract: null, immediateExecution: null, evidence: "0".repeat(16) },
    version: 1,
    createdAt: NOV2,
    updatedAt: NOV2,
    ...p,
  }) as BuyerProfile;

const line = (id: string, priceId: string, amount: number, tax: number, o: Partial<GwInvoiceLine> = {}): GwInvoiceLine => ({ id, subscriptionItemId: `si_${id}`, priceId, quantity: 1, amount, taxCents: tax, proration: false, periodStart: sec(NOV2), periodEnd: sec(NOV2 + 30 * DAY), ...o });
const gwInvoice = (id: string, reason: string, lines: GwInvoiceLine[], o: Partial<GwInvoice> = {}): GwInvoice => {
  const subtotal = lines.reduce((a, l) => a + l.amount, 0);
  const tax = lines.reduce((a, l) => a + (l.taxCents ?? 0), 0);
  return { id, status: "paid", subscriptionId: "sub_1", customerId: "cus_1", amountPaid: subtotal + tax, currency: "eur", billingReason: reason, periodStart: sec(NOV2), subtotal, customerCountry: "ES", customerPostalCode: "28001", customerTaxIds: 1, taxCents: tax, number: `STRIPE-${id}`, total: subtotal + tax, lines, ...o };
};
const PRODUCTS: Record<string, string> = { price_essential: "essential", price_people: "elephant-people", price_users: "extra-users" };

/** Doble del registro de Stripe: lo que deja el procesador de eventos tras un cobro VERIFICADO. */
class FakeRegistry implements StripeSalesRegistry {
  docs: FiscalDocument[] = [];
  records = new Map<string, StripeInvoiceRecord>();
  profiles = new Map<number, BuyerProfile>();
  lines: InvoiceLineRow[] = [];
  failMark = false;
  marks: Array<{ id: number; ref: string }> = [];
  vatChecks: Array<{ orderId: number; country: string; vatNumber: string; status: string; checkedAt: number }> = [];
  async vatChecksOfOrder(orderId: number) {
    return this.vatChecks.filter((c) => c.orderId === orderId);
  }
  async paid(orderId: number, inv: GwInvoice, at: number) {
    const purpose = inv.billingReason === "subscription_cycle" ? "renewal" : inv.billingReason === "subscription_update" ? "change" : "initial";
    const rec = invoiceRecordOf(inv, { orderId, purpose, buyerScenario: this.profiles.get(orderId)?.scenario ?? null, now: at });
    this.records.set(inv.id, rec);
    for (const l of await linesOf(inv.id, orderId, inv.lines ?? [], async (p) => ({ webPriceId: 1, productKey: PRODUCTS[p] ?? null }))) if (!this.lines.some((x) => x.stripeLineId === l.stripeLineId)) this.lines.push(l);
    return this.enqueue(invoiceDocumentOf(rec, at));
  }
  enqueue(d: Omit<FiscalDocument, "id" | "status" | "externalRef" | "issuedAt" | "issuedBy" | "lastError">) {
    const prev = this.docs.find((x) => x.sourceKey === d.sourceKey);
    if (prev) return prev;
    const doc: FiscalDocument = { ...d, id: this.docs.length + 1, status: "pending", externalRef: null, issuedAt: null, issuedBy: null, lastError: null };
    this.docs.push(doc);
    return doc;
  }
  async listFiscalDocuments(q: { status?: FiscalDocumentStatus; orderId?: number; limit: number }) {
    return this.docs.filter((x) => (!q.status || x.status === q.status) && (q.orderId === undefined || x.orderId === q.orderId)).map((x) => ({ ...x }));
  }
  async fiscalDocumentBySource(key: string) {
    const d = this.docs.find((x) => x.sourceKey === key);
    return d ? { ...d } : null;
  }
  async invoiceRecord(id: string) {
    const r = this.records.get(id);
    return r ? { ...r } : null;
  }
  async buyerProfile(orderId: number) {
    return this.profiles.get(orderId) ?? null;
  }
  async markFiscalDocumentIssued(id: number, ref: string, by: string, at: number) {
    if (this.failMark) throw new Error("caída de la BD");
    const d = this.docs.find((x) => x.id === id)!;
    if (d.status === "issued") return { ...d };
    Object.assign(d, { status: "issued", externalRef: ref, issuedBy: by, issuedAt: at });
    this.marks.push({ id, ref });
    return { ...d };
  }
}

const external: ExternalSubscription = { id: 1, contractId: 4, companyId: 7, serviceKey: "skinet", serviceName: "SkiNet — Servicio tecnológico gestionado", amountCents: 100_000, currency: "EUR", taxRateBp: 2100, interval: "month", billingDay: 1, billingHour: 8, timezone: TZ, graceDays: 5, firstChargeAt: chargeInstant("2026-11-01", 8, TZ), externalRef: null, status: "active", endsAt: null } as unknown as ExternalSubscription;
const externalPaid: ExternalEvent = { id: 1, externalId: 1, kind: "invoice_paid", ref: "in_externo_nov", detail: { periodStart: external.firstChargeAt, baseCents: 100_000, taxCents: 21_000, totalCents: 121_000 }, actor: "system:stripe", at: external.firstChargeAt + 3_600_000 };

function setup(o: { stripeSales?: boolean; issueEnabled?: boolean; stripe?: Record<string, { status: string; amountPaid: number; currency: string } | null>; externals?: boolean; fiscalCases?: FiscalCasesConfig } = {}) {
  let now = NOV2 + 3_600_000;
  const clock = () => now;
  const reg = new FakeRegistry();
  // Pedido → empresa: 101 y 103 de la empresa 20; 102 de la empresa 30
  const orderCompany: Record<number, number> = { 101: 20, 102: 30, 103: 20 };
  const companies: Record<number, CompanyFiscal> = { 7: NEXTAIR, 20: { name: "Escuela 20", legalName: null, taxId: null, address: null, postalCode: null, city: null, country: null }, 30: { name: "Escuela 30", legalName: null, taxId: null, address: null, postalCode: null, city: null, country: null } };
  const sales = o.stripeSales === false ? null : new StripeSalesInvoicing({ stripe: reg, lines: { linesOf: async (id) => reg.lines.filter((l) => l.stripeInvoiceId === id) }, orderCompany: async (id) => orderCompany[id] ?? null, company: async (id) => companies[id] ?? null, fiscalCases: o.fiscalCases, now: clock });
  const store = new MemoryInvoicingStore();
  const svc = new InvoicingService({ store, external: o.externals ? { list: async () => [external], events: async () => [externalPaid] } : undefined, company: async (id) => companies[id] ?? null, issuer: ISSUER_PARTY, seriesCode: "EB", issueEnabled: o.issueEnabled ?? true, stripeSales: sales, now: clock });
  const sent: Array<{ key: string; to: string; category: string }> = [];
  const auto = new InvoicingAutomation({
    svc,
    store,
    issueEnabled: o.issueEnabled ?? true,
    stripeInvoice: async (id) => {
      if (o.stripe && id in o.stripe) return o.stripe[id];
      const r = reg.records.get(id);
      return r ? { status: "paid", amountPaid: r.amountPaidCents, currency: r.currency } : null;
    },
    delivery: { send: async (m) => (sent.push({ key: m.key, to: m.to, category: m.category }), { status: "pending", duplicate: false }), recipient: async (inv) => inv.customer?.email ?? null, issuer: ISSUER_PARTY, supportEmail: null },
    now: clock,
  });
  return { reg, store, svc, auto, sent, companies, at: (t: number) => (now = t) };
}

const ALTA = gwInvoice("in_alta", "subscription_create", [line("l1", "price_essential", 4_900, 1_029)]);
const COMPRA = gwInvoice("in_compra", "subscription_update", [line("l2", "price_people", 1_500, 315, { proration: true, periodStart: sec(NOV2 + 10 * DAY) }), line("l3", "price_users", 900, 189, { proration: true, quantity: 3, periodStart: sec(NOV2 + 10 * DAY) }), line("l4", "price_essential", -500, -105, { proration: true, periodStart: sec(NOV2 + 10 * DAY) })]);
const RENOVACION = gwInvoice("in_renov", "subscription_cycle", [line("l5", "price_essential", 4_900, 1_029, { periodStart: sec(DEC2), periodEnd: sec(DEC2 + 31 * DAY) }), line("l6", "price_people", 1_500, 315, { periodStart: sec(DEC2), periodEnd: sec(DEC2 + 31 * DAY) })], { periodStart: sec(DEC2) });

describe("venta del panel: primer cobro de la conversión", () => {
  it("cobro verificado → borrador con el IVA cobrado → factura EB con número → documento fiscal emitido", async () => {
    const t = setup();
    t.reg.profiles.set(101, profile(101));
    await t.reg.paid(101, ALTA, NOV2);
    const gen = await t.svc.generateStripeSales("system");
    expect(gen.created).toHaveLength(1);
    expect(gen.skipped).toEqual([]);
    const draft = (await t.store.bySource(stripeSaleSourceKey(101, "in_alta")))!;
    expect(draft).toMatchObject({ status: "draft", kind: "invoice", companyId: 20, billingRef: "order:101", paymentStatus: "paid", paymentRef: "stripe:in:in_alta", paidAt: NOV2, operationDate: "2026-11-02", baseCents: 4_900, taxCents: 1_029, totalCents: 5_929, currency: "EUR" });
    expect(draft.lines).toEqual([expect.objectContaining({ concept: expect.stringContaining("Elephant Core Essential"), baseCents: 4_900, taxRateBp: 2100, taxCents: 1_029 })]);
    // Ninguna proforma: ya está cobrada
    expect((await t.auto.sendProformas()).sent).toBe(0);
    const iss = await t.auto.issueDue();
    expect(iss.blocked).toEqual([]);
    expect(iss.issued).toEqual([{ id: draft.id, number: "EB-2026-00001", totalCents: 5_929, delivery: "pending" }]);
    const inv = (await t.store.get(draft.id))!;
    expect(inv.customer).toEqual({ legalName: "ESCUELA SINTÉTICA 101 SL", taxId: "B12345674", address: "Calle Mayor 1", postalCode: "28001", city: "Madrid", country: "ES", email: "facturas101@escuela.example" });
    expect(t.sent).toEqual([{ key: `invoicing:invoice:${draft.id}:EB-2026-00001`, to: "facturas101@escuela.example", category: "invoice_available" }]);
    expect(await t.reg.fiscalDocumentBySource(invoiceSourceKey("in_alta"))).toMatchObject({ status: "issued", externalRef: "EB-2026-00001", issuedBy: "invoicing:system:invoicing" });
  });

  it("idempotente: el evento repetido y las pasadas repetidas no crean otra factura ni otro número", async () => {
    const t = setup();
    t.reg.profiles.set(101, profile(101));
    await t.reg.paid(101, ALTA, NOV2);
    await t.svc.generateStripeSales("system");
    await t.reg.paid(101, ALTA, NOV2 + 60_000);
    const again = await t.svc.generateStripeSales("system");
    expect(again).toMatchObject({ created: [], existing: 1 });
    await t.auto.issueDue();
    expect(await t.auto.issueDue()).toEqual({ issued: [], waiting: 0, blocked: [] });
    expect((await t.svc.generateStripeSales("system")).created).toEqual([]);
    expect(await t.store.list({})).toHaveLength(1);
    expect(t.reg.marks).toEqual([{ id: 1, ref: "EB-2026-00001" }]);
  });

  it("si marcar el documento fiscal falla al expedir, la factura sigue expedida y la pasada siguiente lo repara", async () => {
    const t = setup();
    t.reg.profiles.set(101, profile(101));
    await t.reg.paid(101, ALTA, NOV2);
    await t.svc.generateStripeSales("system");
    t.reg.failMark = true;
    expect((await t.auto.issueDue()).issued).toHaveLength(1);
    expect(t.reg.docs[0].status).toBe("pending");
    t.reg.failMark = false;
    expect(await t.svc.generateStripeSales("system")).toMatchObject({ created: [], existing: 1, marked: 1 });
    expect(t.reg.docs[0]).toMatchObject({ status: "issued", externalRef: "EB-2026-00001" });
  });

  it("un cobro ya facturado con otro número no se vuelve a facturar", async () => {
    const t = setup();
    t.reg.profiles.set(101, profile(101));
    await t.reg.paid(101, ALTA, NOV2);
    await t.svc.generateStripeSales("system");
    Object.assign(t.reg.docs[0], { status: "issued", externalRef: "OTRA-2026-1" });
    const iss = await t.auto.issueDue();
    expect(iss.issued).toEqual([]);
    expect(iss.blocked[0].reason).toContain("el cobro ya consta facturado (OTRA-2026-1)");
  });
});

describe("compra de módulo con prorrateo y renovación", () => {
  it("compra de Elephant People: una línea por partida de Stripe, abono incluido, con los importes del cobro", async () => {
    const t = setup();
    t.reg.profiles.set(101, profile(101));
    await t.reg.paid(101, COMPRA, NOV2 + 10 * DAY);
    t.at(NOV2 + 10 * DAY + 60_000);
    await t.svc.generateStripeSales("system");
    const inv = (await t.store.bySource(stripeSaleSourceKey(101, "in_compra")))!;
    expect(inv).toMatchObject({ baseCents: 1_900, taxCents: 399, totalCents: 2_299, operationDate: "2026-11-12" });
    expect(inv.lines.map((l) => [l.concept.split(" — ")[0], l.quantity, l.unitCents, l.baseCents, l.taxRateBp, l.taxCents])).toEqual([
      ["Elephant People (prorrateo)", 1, 1_500, 1_500, 2100, 315],
      ["Extra Users (prorrateo)", 3, 300, 900, 2100, 189],
      ["Elephant Core Essential (abono por prorrateo)", 1, -500, -500, 2100, -105],
    ]);
    expect((await t.auto.issueDue()).issued.map((x) => x.number)).toEqual(["EB-2026-00001"]);
    expect(t.reg.docs[0]).toMatchObject({ status: "issued", externalRef: "EB-2026-00001" });
  });

  it("renovación: factura propia del nuevo periodo, correlativa, con fecha de operación el día del cobro", async () => {
    const t = setup();
    t.reg.profiles.set(101, profile(101));
    await t.reg.paid(101, ALTA, NOV2);
    await t.svc.generateStripeSales("system");
    await t.auto.issueDue();
    await t.reg.paid(101, RENOVACION, DEC2);
    t.at(DEC2 + 60_000);
    expect((await t.svc.generateStripeSales("system")).created).toHaveLength(1);
    const iss = await t.auto.issueDue();
    expect(iss.issued.map((x) => [x.number, x.totalCents])).toEqual([["EB-2026-00002", 7_744]]);
    const inv = (await t.store.bySource(stripeSaleSourceKey(101, "in_renov")))!;
    expect(inv).toMatchObject({ operationDate: "2026-12-02", baseCents: 6_400, taxCents: 1_344 });
    expect(inv.periodLabel).toBe("02/12/2026 a 01/01/2027");
    expect(t.reg.docs.map((d) => d.externalRef)).toEqual(["EB-2026-00001", "EB-2026-00002"]);
  });
});

describe("bloqueos: nunca sin cobro verificado ni con datos que falten", () => {
  it("comprador sin NIF válido: borrador sí, expedición no, con el motivo (invoice_issue_blocked); al completarlo se expide", async () => {
    const t = setup();
    t.reg.profiles.set(101, profile(101, { taxId: "12345678A" }));
    await t.reg.paid(101, ALTA, NOV2);
    await t.svc.generateStripeSales("system");
    const iss = await t.auto.issueDue();
    expect(iss.issued).toEqual([]);
    expect(iss.blocked).toEqual([{ id: 1, reason: "comprador: el NIF no es válido" }]);
    expect(t.reg.docs[0].status).toBe("pending");
    t.reg.profiles.set(101, profile(101));
    expect((await t.auto.issueDue()).issued.map((x) => x.number)).toEqual(["EB-2026-00001"]);
  });

  it("comprador sin domicilio o fuera de la península: bloqueado; sin perfil fiscal se usa la ficha del CRM (incompleta → bloqueada)", async () => {
    const t = setup();
    t.reg.profiles.set(101, profile(101, { billingAddress: null }));
    t.reg.profiles.set(102, profile(102, { country: "ES", postalCode: "35001", territory: "es_canarias", scenario: "business:es_special" }));
    await t.reg.paid(101, ALTA, NOV2);
    await t.reg.paid(102, gwInvoice("in_canarias", "subscription_create", [line("c1", "price_essential", 4_900, 0)], { customerPostalCode: "35001" }), NOV2);
    await t.reg.paid(103, gwInvoice("in_sinperfil", "subscription_create", [line("s1", "price_essential", 4_900, 1_029)]), NOV2);
    await t.svc.generateStripeSales("system");
    const blocked = new Map((await t.auto.issueDue()).blocked.map((b) => [b.id, b.reason]));
    expect(blocked.get(1)).toContain("comprador: falta el domicilio fiscal");
    expect(blocked.get(2)).toContain("Canarias, Ceuta o Melilla");
    expect(blocked.get(2)).toContain("no es el 21 %");
    expect(blocked.get(3)).toContain("comprador: falta la razón social");
    expect(t.reg.docs.every((d) => d.status === "pending")).toBe(true);
  });

  it("IVA cobrado distinto del 21 % para un comprador peninsular: no se expide", async () => {
    const t = setup();
    t.reg.profiles.set(101, profile(101));
    await t.reg.paid(101, gwInvoice("in_sin_iva", "subscription_create", [line("z1", "price_essential", 4_900, 0)]), NOV2);
    await t.svc.generateStripeSales("system");
    const iss = await t.auto.issueDue();
    expect(iss.issued).toEqual([]);
    expect(iss.blocked[0].reason).toContain("el IVA cobrado en Stripe (0 %) no es el 21 %");
  });

  it("sin cobro verificado no hay factura: factura de Stripe no pagada, sin copia o que no casa con Stripe por API", async () => {
    const t = setup({ stripe: { in_api_no: { status: "open", amountPaid: 0, currency: "eur" } } });
    t.reg.profiles.set(101, profile(101));
    await t.reg.paid(101, gwInvoice("in_abierta", "subscription_create", [line("a1", "price_essential", 4_900, 1_029)]), NOV2);
    t.reg.records.set("in_abierta", { ...t.reg.records.get("in_abierta")!, status: "open" });
    t.reg.enqueue({ kind: "invoice", sourceKey: invoiceSourceKey("in_fantasma"), orderId: 101, stripeInvoiceId: "in_fantasma", stripeChargeId: null, originalDocumentId: null, currency: "EUR", baseCents: 100, taxCents: 21, totalCents: 121, createdAt: NOV2 });
    await t.reg.paid(101, gwInvoice("in_api_no", "subscription_update", [line("a2", "price_people", 1_500, 315)]), NOV2);
    const gen = await t.svc.generateStripeSales("system");
    expect(gen.created.map((c) => c.sourceKey)).toEqual([stripeSaleSourceKey(101, "in_api_no")]);
    expect(gen.skipped.map((s) => [s.stripeInvoiceId, s.reason])).toEqual([
      ["in_abierta", "la factura de Stripe no consta cobrada (open)"],
      ["in_fantasma", "no consta la copia de la factura de Stripe"],
    ]);
    const iss = await t.auto.issueDue();
    expect(iss.issued).toEqual([]);
    expect(iss.blocked[0].reason).toContain("el cobro de Stripe in_api_no no casa con la factura");
  });

  it("sin la expedición real habilitada se preparan los borradores, pero no se expide nada", async () => {
    const t = setup({ issueEnabled: false });
    t.reg.profiles.set(101, profile(101));
    await t.reg.paid(101, ALTA, NOV2);
    expect((await t.svc.generateStripeSales("system")).created).toHaveLength(1);
    expect(await t.auto.issueDue()).toEqual({ issued: [], waiting: 0, blocked: [] });
    expect(t.reg.docs[0].status).toBe("pending");
  });

  it("sin el registro de Stripe montado, una venta de Stripe no se expide a mano con la ficha del CRM", async () => {
    const t = setup();
    t.reg.profiles.set(101, profile(101));
    await t.reg.paid(101, ALTA, NOV2);
    await t.svc.generateStripeSales("system");
    const bare = new InvoicingService({ store: t.store, company: async () => NEXTAIR, issuer: ISSUER_PARTY, seriesCode: "EB", issueEnabled: true });
    expect((await bare.readiness(1)).problems).toEqual(["venta de Stripe: el registro de cobros de Stripe no está disponible en este entorno"]);
    await expect(bare.issue(1, "operador")).rejects.toThrow(/registro de cobros de Stripe/);
  });
});

describe("aislamiento entre empresas", () => {
  it("cada venta va a la empresa de su pedido con su comprador; el filtro por empresa no toca las demás", async () => {
    const t = setup();
    t.reg.profiles.set(101, profile(101));
    t.reg.profiles.set(102, profile(102, { taxId: "A58818501", billingAddress: { line1: "Avenida 2", line2: "Local 3", city: "Sevilla", state: null }, postalCode: "41001" }));
    await t.reg.paid(101, ALTA, NOV2);
    await t.reg.paid(102, gwInvoice("in_otra", "subscription_create", [line("o1", "price_essential", 4_900, 1_029)], { customerPostalCode: "41001" }), NOV2);
    const only30 = await t.svc.generateStripeSales("system", { companyId: 30 });
    expect(only30.created.map((c) => c.sourceKey)).toEqual([stripeSaleSourceKey(102, "in_otra")]);
    await t.svc.generateStripeSales("system");
    await t.auto.issueDue();
    const a = (await t.store.bySource(stripeSaleSourceKey(101, "in_alta")))!;
    const b = (await t.store.bySource(stripeSaleSourceKey(102, "in_otra")))!;
    expect([a.companyId, a.customer?.legalName]).toEqual([20, "ESCUELA SINTÉTICA 101 SL"]);
    expect([b.companyId, b.customer?.legalName, b.customer?.address, b.customer?.taxId]).toEqual([30, "ESCUELA SINTÉTICA 102 SL", "Avenida 2, Local 3", "A58818501"]);
    expect(await t.store.list({ companyId: 20 })).toHaveLength(1);
  });

  it("una factura cuya empresa no es la del pedido no se expide", async () => {
    const t = setup();
    t.reg.profiles.set(101, profile(101));
    await t.reg.paid(101, ALTA, NOV2);
    await t.svc.generateStripeSales("system");
    t.store.rows[0].companyId = 30;
    expect((await t.auto.issueDue()).blocked[0].reason).toContain("el pedido no es de la empresa de la factura");
  });
});

describe("reembolsos", () => {
  it("reembolso total: la factura queda reembolsada y avisada; la rectificativa expedida a mano liquida el documento de reembolso", async () => {
    const t = setup();
    t.reg.profiles.set(101, profile(101));
    const doc = await t.reg.paid(101, ALTA, NOV2);
    await t.svc.generateStripeSales("system");
    await t.auto.issueDue();
    t.reg.records.set("in_alta", { ...t.reg.records.get("in_alta")!, amountRefundedCents: 5_929 });
    t.reg.enqueue(rectificationOf({ ...doc, status: "issued" } as FiscalDocument, { chargeId: "ch_1", refundedTotalCents: 5_929, previousRefundedCents: 0, now: NOV2 + DAY })!);
    const gen = await t.svc.generateStripeSales("system");
    expect(gen.payments).toEqual([{ invoiceId: 1, paymentStatus: "refunded" }]);
    expect(gen.warnings).toEqual(["Factura EB-2026-00001: reembolso de 59,29 € en Stripe; hay que expedir la rectificativa"]);
    const r = await t.svc.rectify(1, { reason: "Desistimiento del cliente" }, "operador");
    const issued = await t.svc.issue(r.id, "operador");
    expect(issued.number).toBe("EBR-2026-00001");
    expect(t.reg.docs[1]).toMatchObject({ kind: "rectification", status: "issued", externalRef: "EBR-2026-00001" });
    expect((await t.store.get(1))!.status).toBe("rectified");
  });
});

describe("servicios externos (Nextair) sin cambios", () => {
  it("la mensualidad externa se factura igual, con la ficha del CRM, junto a una venta de Stripe", async () => {
    const ok = { in_externo_nov: { status: "paid", amountPaid: 121_000, currency: "eur" } };
    const withSales = setup({ externals: true, stripe: ok });
    const without = setup({ externals: true, stripeSales: false, stripe: ok });
    withSales.reg.profiles.set(101, profile(101));
    await withSales.reg.paid(101, ALTA, NOV2);
    for (const t of [withSales, without]) {
      await t.svc.generateExternal("system");
      await t.svc.generateStripeSales("system");
    }
    const ext = (s: ReturnType<typeof setup>) => s.store.bySource("external:1:2026-11");
    const a = (await ext(withSales))!;
    const b = (await ext(without))!;
    const strip = (x: typeof a) => ({ ...x, id: 0 });
    expect(strip(a)).toEqual(strip(b));
    await without.auto.issueDue();
    await withSales.auto.issueDue();
    const ia = (await ext(withSales))!;
    const ib = (await ext(without))!;
    expect(ib.number).toBe("EB-2026-00001");
    expect(ia.customer).toEqual(ib.customer);
    expect(ia.customer?.legalName).toBe(NEXTAIR.legalName);
    expect([ia.baseCents, ia.taxCents, ia.totalCents, ia.paymentRef]).toEqual([100_000, 21_000, 121_000, "stripe:in:in_externo_nov"]);
    expect((await withSales.store.list({ status: "issued" })).map((x) => x.number).sort()).toEqual(["EB-2026-00001", "EB-2026-00002"]);
  });
});

describe("automatización diaria", () => {
  it("genera los borradores de las ventas junto a los externos y lleva las ventas sin borrador al bloqueo del control diario", async () => {
    const t = setup();
    t.reg.profiles.set(101, profile(101));
    await t.reg.paid(101, ALTA, NOV2);
    t.reg.enqueue({ kind: "invoice", sourceKey: invoiceSourceKey("in_fantasma"), orderId: 101, stripeInvoiceId: "in_fantasma", stripeChargeId: null, originalDocumentId: null, currency: "EUR", baseCents: 100, taxCents: 21, totalCents: 121, createdAt: NOV2 });
    const finance = { fiscalYears: async () => [{ year: 2026 }], syncStatus: async () => ({ pending: null, synced: 0 }) } as unknown as ConstructorParameters<typeof FinanceAutomation>[0]["finance"];
    const fa = new FinanceAutomation({ finance, ledger: { addAudit: async () => undefined, lastAudit: async () => null } as never, invoicing: t.svc, issuing: t.auto, issuer: { legalName: ISSUER.legalName, taxId: ISSUER.taxId }, now: () => NOV2 + 3_600_000 });
    const r = await fa.run();
    expect(r.invoiceDrafts.detail).toContain("ventas de Stripe: 1 borradores nuevos, 0 ya existentes, 1 sin borrador");
    expect(r.invoiceIssue.issued).toEqual([{ id: 1, number: "EB-2026-00001", totalCents: 5_929, delivery: "pending" }]);
    expect(r.invoiceIssue.blocked).toEqual([{ id: 2, reason: "documento fiscal de la venta de Stripe in_fantasma: no consta la copia de la factura de Stripe" }]);
  });
});

describe("reglas puras", () => {
  it("tipo de IVA desde la cuota cobrada y nombres de producto", () => {
    expect(rateOf(4_900, 1_029)).toBe(2100);
    expect(rateOf(4_901, 1_029)).toBe(2100);
    expect(rateOf(4_900, 0)).toBe(0);
    expect(rateOf(10_000, 1_000)).toBe(1000);
    expect(productLabel("business")).toBe("Elephant Core Business");
    expect(productLabel("elephant-people")).toBe("Elephant People");
    expect(productLabel(null)).toBe("Suscripción a Elephant Source");
  });

  it("descuento en una sola partida: la línea con su importe, el descuento y la base, y la cuota cobrada", () => {
    const lines = saleLines({ purpose: "initial", totalCents: 4_840, taxCents: 840, periodStart: NOV2 }, [{ stripeLineId: "x", stripeInvoiceId: "in", orderId: 1, subscriptionItemId: null, stripePriceId: null, webPriceId: null, productKey: "essential", quantity: 1, amountCents: 4_900, taxCents: 840, proration: false, periodStart: NOV2, periodEnd: NOV2 + 30 * DAY, refundedCents: 0 }]);
    expect(lines).toEqual([{ position: 1, concept: "Elephant Core Essential — 02/11/2026 a 01/12/2026", quantity: 1, unitCents: 4_900, baseCents: 4_000, taxRateBp: 2100, taxCents: 840, grossCents: 4_900, discountCents: 900 }]);
  });

  it("líneas sin registrar que no cuadran (sin descuento): una línea con los totales cobrados, como siempre", () => {
    expect(saleLines({ purpose: "renewal", totalCents: 5_929, taxCents: 1_029, periodStart: NOV2 }, [])).toEqual([{ position: 1, concept: "Renovación de la suscripción a Elephant Source", quantity: 1, unitCents: 4_900, baseCents: 4_900, taxRateBp: 2100, taxCents: 1_029 }]);
  });

  it("reparto del descuento: proporcional con su signo y suma exacta; imposible si excede", () => {
    expect(allocateDiscount([1_500, 900, -500], 380)).toEqual([300, 180, -100]);
    expect(allocateDiscount([1_000, 1_000, 1_000], 100)).toEqual([33, 33, 34]);
    expect(allocateDiscount([100], 200)).toBeNull();
    expect(allocateDiscount([0, 0], 10)).toBeNull();
  });

  it("devengo: el cobro si es anticipado; el inicio del periodo si el cobro llegó después", () => {
    expect(accrualOf(NOV2, NOV2)).toEqual({ operationDate: "2026-11-02", basis: "advance_payment" });
    expect(accrualOf(NOV2, NOV2 + 30 * DAY)).toEqual({ operationDate: "2026-11-02", basis: "advance_payment" });
    expect(accrualOf(DEC2 + 3 * DAY, DEC2)).toEqual({ operationDate: "2026-12-02", basis: "due_date" });
    expect(accrualOf(NOV2, null)).toEqual({ operationDate: "2026-11-02", basis: "advance_payment" });
  });
});

const text = (inv: Parameters<typeof invoicePdfBlocks>[0]) => JSON.stringify(invoicePdfBlocks(inv, ISSUER_PARTY)).replace(/[  ]/g, " ");

describe("fechas: expedición, operación (devengo), periodo de prestación y cobro por separado", () => {
  it("alta cobrada el día: periodo de prestación propio y sin fecha de cobro repetida; datos fiscales del caso vigente", async () => {
    const t = setup();
    t.reg.profiles.set(101, profile(101));
    await t.reg.paid(101, ALTA, NOV2);
    await t.svc.generateStripeSales("system");
    t.at(NOV2 + 2 * DAY);
    await t.auto.issueDue();
    const inv = (await t.store.get(1))!;
    expect(inv).toMatchObject({ issueDate: "2026-11-04", operationDate: "2026-11-02", periodLabel: "02/11/2026 a 01/12/2026" });
    const { matrixVersion, ruleId, evidence, credit, ...same } = inv.fiscal!;
    expect(same).toEqual({ invoiceType: "complete", fiscalCase: "business:es_mainland", treatment: "taxed_es", legalMention: null, collectionDate: "2026-11-02", accrualBasis: "advance_payment", balanceAppliedCents: 0, advisorPending: ["devengo_cobro_anticipado"] });
    // Registro adicional: versión de la matriz, regla aplicada y evidencias con las fechas por separado
    expect({ matrixVersion, ruleId, credit }).toEqual({ matrixVersion: FISCAL_MATRIX_VERSION, ruleId: "business:es_mainland", credit: null });
    expect(evidence).toMatchObject({ matrixVersion: FISCAL_MATRIX_VERSION, ruleStatus: "enabled", buyer: { type: "business", territory: "es_mainland", country: "ES", postalCode: "28001", taxId: "B12345674", condition: "business_declared" }, vies: null, stripeTax: { stripeInvoiceId: "in_alta", taxCents: 1_029, totalCents: 5_929, amountPaidCents: 5_929, rates: [2100], customerCountry: "ES" }, dates: { operationDate: "2026-11-02", accrualBasis: "advance_payment", dueDate: "2026-11-02", collectionDate: "2026-11-02", issueDate: "2026-11-04" }, amounts: { grossCents: 4_900, discountCents: 0, baseCents: 4_900, taxCents: 1_029, totalCents: 5_929, balanceAppliedCents: 0 } });
    expect(evidence!.location).toEqual([{ source: "billing_address", country: "ES", postalCode: "28001" }, { source: "stripe_tax_address", country: "ES", postalCode: "28001", derivedFrom: "billing_address" }]);
    expect(evidence!.legalBasis.every((x) => x.includes("https://www.boe.es/"))).toBe(true);
    const s = text(inv);
    expect(s).toContain('["Fecha de expedición","04/11/2026"]');
    expect(s).toContain('["Fecha de operación (devengo)","02/11/2026"]');
    expect(s).toContain('["Periodo de prestación del servicio","02/11/2026 a 01/12/2026"]');
    expect(s).not.toContain("Fecha de cobro");
    expect(invoiceHtml(inv, ISSUER_PARTY)).toContain("<td>Periodo de prestación del servicio</td><td>02/11/2026 a 01/12/2026</td>");
  });

  it("renovación cobrada en un reintento: devengo el inicio del periodo y la fecha de cobro aparte", async () => {
    const t = setup();
    t.reg.profiles.set(101, profile(101));
    await t.reg.paid(101, RENOVACION, DEC2 + 3 * DAY);
    t.at(DEC2 + 3 * DAY + 60_000);
    await t.svc.generateStripeSales("system");
    const inv = (await t.store.get(1))!;
    expect(inv.operationDate).toBe("2026-12-02");
    expect(inv.fiscal).toMatchObject({ accrualBasis: "due_date", collectionDate: "2026-12-05" });
    expect((await t.auto.issueDue()).issued.map((x) => x.number)).toEqual(["EB-2026-00001"]);
    const s = text((await t.store.get(1))!);
    expect(s).toContain('["Fecha de operación (devengo)","02/12/2026"]');
    expect(s).toContain('["Fecha de cobro","05/12/2026"]');
    expect(s).toContain('["Fecha de expedición","05/12/2026"]');
  });
});

describe("descuentos: importes, bases e impuestos conservados", () => {
  // Cupón del 20 % en toda la factura: Stripe reparte el descuento y cobra el IVA de cada línea sobre la base neta
  const CUPON = gwInvoice("in_cupon", "subscription_update", [line("d1", "price_people", 1_500, 252, { proration: true }), line("d2", "price_users", 900, 151, { proration: true, quantity: 3 }), line("d3", "price_essential", -500, -84, { proration: true })], { total: 1_520 + 319, amountPaid: 1_520 + 319, taxCents: 319 });

  it("cupón de factura: una línea por partida con importe, descuento y base; totales los cobrados en Stripe", async () => {
    const t = setup();
    t.reg.profiles.set(101, profile(101));
    await t.reg.paid(101, CUPON, NOV2);
    await t.svc.generateStripeSales("system");
    const inv = (await t.store.get(1))!;
    expect([inv.baseCents, inv.taxCents, inv.totalCents]).toEqual([1_520, 319, 1_839]);
    expect(inv.lines.map((l) => [l.quantity, l.unitCents, l.grossCents, l.discountCents, l.baseCents, l.taxRateBp, l.taxCents])).toEqual([
      [1, 1_500, 1_500, 300, 1_200, 2100, 252],
      [3, 300, 900, 180, 720, 2100, 151],
      [1, -500, -500, -100, -400, 2100, -84],
    ]);
    expect(inv.lines.reduce((a, l) => a + l.baseCents, 0)).toBe(inv.baseCents);
    expect(inv.fiscal?.advisorPending).toEqual(["devengo_cobro_anticipado", "descuento_por_linea"]);
    expect((await t.auto.issueDue()).issued.map((x) => x.number)).toEqual(["EB-2026-00001"]);
    const issued = (await t.store.get(1))!;
    const s = text(issued);
    for (const x of ['"Descuento"', '"−3,00 €"', '"12,00 €"', '["Importe antes de descuentos","19,00 €"]', '["Descuentos","−3,80 €"]', '["Base imponible","15,20 €"]', '["Cuota de IVA","3,19 €"]', '["Total","18,39 €"]']) expect(s).toContain(x);
    const html = invoiceHtml(issued, ISSUER_PARTY);
    expect(html).toContain("<th class=\"n\">Descuento</th>");
    expect(html).toContain("Importe antes de descuentos");
    // La rectificativa total devuelve exactamente lo mismo, línea a línea
    t.reg.records.set("in_cupon", { ...t.reg.records.get("in_cupon")!, amountRefundedCents: 1_839 });
    const r = await t.svc.rectify(1, { reason: "Baja del módulo" }, "operador");
    expect(r.lines.map((l) => [l.grossCents, l.discountCents, l.baseCents, l.taxCents])).toEqual([
      [-1_500, -300, -1_200, -252],
      [-900, -180, -720, -151],
      [500, 100, 400, 84],
    ]);
    expect([r.baseCents, r.taxCents, r.totalCents]).toEqual([-1_520, -319, -1_839]);
  });

  it("descuento en una partida concreta: el reparto no casa con la cuota de cada línea → una línea agrupada exacta (un único tipo)", async () => {
    const t = setup();
    t.reg.profiles.set(101, profile(101));
    await t.reg.paid(101, gwInvoice("in_partida", "subscription_create", [line("p1", "price_essential", 4_900, 1_029), line("p2", "price_people", 1_500, 210)], { total: 5_900 + 1_239, amountPaid: 5_900 + 1_239, taxCents: 1_239 }), NOV2);
    await t.svc.generateStripeSales("system");
    const inv = (await t.store.get(1))!;
    expect(inv.lines).toEqual([{ position: 1, concept: "Alta de la suscripción a Elephant Source — 02/11/2026 a 01/12/2026", quantity: 1, unitCents: 6_400, baseCents: 5_900, taxRateBp: 2100, taxCents: 1_239, grossCents: 6_400, discountCents: 500 }]);
    expect((await t.auto.issueDue()).issued.map((x) => x.number)).toEqual(["EB-2026-00001"]);
  });

  it("descuento con varios tipos impositivos que no se pueden repartir: no se agrupa en falso, se bloquea con motivo", async () => {
    const t = setup();
    t.reg.profiles.set(101, profile(101));
    await t.reg.paid(101, gwInvoice("in_mixto", "subscription_create", [line("m1", "price_essential", 4_900, 1_029), line("m2", "price_people", 1_500, 0)], { total: 5_900 + 1_029, amountPaid: 5_900 + 1_029, taxCents: 1_029 }), NOV2);
    await t.svc.generateStripeSales("system");
    const iss = await t.auto.issueDue();
    expect(iss.issued).toEqual([]);
    expect(iss.blocked[0].reason).toContain("no es el 21 %");
  });

  it("saldo a favor del cliente: forma de pago, no descuento (la base y el total no cambian)", async () => {
    const t = setup();
    t.reg.profiles.set(101, profile(101));
    await t.reg.paid(101, { ...ALTA, id: "in_saldo", amountPaid: 4_929 }, NOV2);
    await t.svc.generateStripeSales("system");
    const inv = (await t.store.get(1))!;
    expect([inv.baseCents, inv.taxCents, inv.totalCents]).toEqual([4_900, 1_029, 5_929]);
    expect(inv.lines.every((l) => !l.discountCents)).toBe(true);
    expect(inv.fiscal).toMatchObject({ balanceAppliedCents: 1_000, advisorPending: ["devengo_cobro_anticipado", "saldo_a_favor"] });
    expect(inv.notes).toContain("Saldo a favor del cliente aplicado como forma de pago: 10,00 €.");
  });
});

const CONSUMER = (orderId: number, p: Partial<BuyerProfile> = {}) => profile(orderId, { type: "consumer", scenario: "consumer:es_mainland", displayName: "María Sintética Pérez", taxId: null, taxIdStatus: "none", billingEmail: null, contactName: null, ...p });

describe("casos fiscales preparados: DESACTIVADOS por defecto", () => {
  it("particular sin NIF, empresa de la UE y de Canarias: bloqueados como siempre", async () => {
    const t = setup();
    t.reg.profiles.set(101, CONSUMER(101));
    t.reg.profiles.set(102, profile(102, { country: "FR", postalCode: "75001", territory: "eu", scenario: "business:eu", taxId: "FR12345678901" }));
    t.reg.vatChecks.push({ orderId: 102, country: "FR", vatNumber: "12345678901", status: "valid", checkedAt: NOV2 });
    await t.reg.paid(101, ALTA, NOV2);
    await t.reg.paid(102, gwInvoice("in_ue", "subscription_create", [line("u1", "price_essential", 4_900, 0)], { customerCountry: "FR", customerPostalCode: "75001" }), NOV2);
    await t.svc.generateStripeSales("system");
    const blocked = new Map((await t.auto.issueDue()).blocked.map((b) => [b.id, b.reason]));
    expect(blocked.get(1)).toBe("comprador: falta el NIF");
    expect(blocked.get(2)).toContain("cliente fuera de España");
    expect(blocked.get(2)).toContain("no es el 21 %");
  });

  it("particular CON NIF y domicilio de la península: factura completa EB (como hasta ahora)", async () => {
    const t = setup();
    t.reg.profiles.set(101, CONSUMER(101, { taxId: "12345678Z" }));
    await t.reg.paid(101, ALTA, NOV2);
    await t.svc.generateStripeSales("system");
    expect((await t.auto.issueDue()).issued.map((x) => x.number)).toEqual(["EB-2026-00001"]);
    expect((await t.store.get(1))!.fiscal).toMatchObject({ invoiceType: "complete", fiscalCase: "consumer:es_mainland", legalMention: null });
  });
});

describe("casos fiscales preparados: ACTIVADOS por configuración", () => {
  const ALL: FiscalCasesConfig = { enabled: new Set(["consumer:es_mainland", "business:es_canarias", "business:eu_vies", "business:non_eu"]), simplified: true, euB2cRegime: null };

  it("factura simplificada para un particular sin NIF (≤ 400 €): serie EBS propia y correlativa, sin datos del destinatario", async () => {
    const t = setup({ fiscalCases: ALL });
    t.reg.profiles.set(101, CONSUMER(101, { billingAddress: null }));
    t.reg.profiles.set(103, profile(103));
    await t.reg.paid(101, ALTA, NOV2);
    await t.reg.paid(103, gwInvoice("in_empresa", "subscription_create", [line("e1", "price_essential", 4_900, 1_029)]), NOV2);
    await t.svc.generateStripeSales("system");
    const iss = await t.auto.issueDue();
    expect(iss.blocked).toEqual([]);
    expect(iss.issued.map((x) => x.number).sort()).toEqual(["EB-2026-00001", "EBS-2026-00001"]);
    const simp = (await t.store.bySource(stripeSaleSourceKey(101, "in_alta")))!;
    expect(simp).toMatchObject({ number: "EBS-2026-00001", seriesCode: "EBS", customer: { legalName: "María Sintética Pérez", taxId: "", address: "" } });
    expect(simp.fiscal).toMatchObject({ invoiceType: "simplified", fiscalCase: "consumer:es_mainland", treatment: "taxed_es" });
    expect(simp.fiscal?.advisorPending).toEqual(expect.arrayContaining(["consumidor_peninsula", "factura_simplificada"]));
    const s = text(simp);
    expect(s).toContain('"text":"Factura simplificada"');
    expect(s).toContain("Factura simplificada (arts. 4 y 7 del Real Decreto 1619/2012).");
    expect(s).toContain('"lines":["María Sintética Pérez"]');
    expect(invoiceHtml(simp, ISSUER_PARTY)).toContain("<h1>Factura simplificada</h1>");
  });

  it("simplificada por encima de 400 € IVA incluido: bloqueada con el motivo", async () => {
    const t = setup({ fiscalCases: ALL });
    t.reg.profiles.set(101, CONSUMER(101));
    await t.reg.paid(101, gwInvoice("in_caro", "subscription_create", [line("k1", "price_essential", 75_900, 15_939)]), NOV2);
    await t.svc.generateStripeSales("system");
    const iss = await t.auto.issueDue();
    expect(iss.issued).toEqual([]);
    expect(iss.blocked[0].reason).toContain("supera el límite de la factura simplificada (400 € IVA incluido, art. 4.1.a del RD 1619/2012)");
  });

  it("empresa de Canarias sin IVA: factura completa con la mención de no sujeción; con el 21 % cobrado, bloqueada", async () => {
    const t = setup({ fiscalCases: ALL });
    t.reg.profiles.set(101, profile(101, { postalCode: "35001", territory: "es_canarias", scenario: "business:es_special", billingAddress: { line1: "Calle Triana 1", line2: null, city: "Las Palmas de Gran Canaria", state: null } }));
    t.reg.profiles.set(102, profile(102, { postalCode: "38001", territory: "es_canarias", scenario: "business:es_special" }));
    await t.reg.paid(101, gwInvoice("in_igic", "subscription_create", [line("g1", "price_essential", 4_900, 0)], { customerPostalCode: "35001" }), NOV2);
    await t.reg.paid(102, gwInvoice("in_igic21", "subscription_create", [line("g2", "price_essential", 4_900, 1_029)], { customerPostalCode: "38001" }), NOV2);
    await t.svc.generateStripeSales("system");
    const iss = await t.auto.issueDue();
    expect(iss.issued.map((x) => x.number)).toEqual(["EB-2026-00001"]);
    expect(iss.blocked).toEqual([{ id: 2, reason: "el IVA cobrado en Stripe (21 %) no es el 0 % que corresponde al caso business:es_canarias: requiere revisión fiscal" }]);
    const inv = (await t.store.get(1))!;
    expect(inv.fiscal).toMatchObject({ fiscalCase: "business:es_canarias", treatment: "not_subject", legalMention: expect.stringContaining("establecido en Canarias") });
    expect(text(inv)).toContain("Operación no sujeta al IVA: destinatario empresario o profesional establecido en Canarias");
  });

  it("empresa de la UE: con NIF-IVA válido en VIES, inversión del sujeto pasivo; sin VIES, bloqueada como siempre", async () => {
    const t = setup({ fiscalCases: ALL });
    const fr = { country: "FR", postalCode: "75001", territory: "eu" as const, scenario: "business:eu" as const, billingAddress: { line1: "1 rue Sintétique", line2: null, city: "París", state: null } };
    t.reg.profiles.set(101, profile(101, { ...fr, taxId: "FR12345678901" }));
    t.reg.profiles.set(102, profile(102, { ...fr, taxId: "FR99999999999" }));
    t.reg.vatChecks.push({ orderId: 101, country: "FR", vatNumber: "12345678901", status: "valid", checkedAt: NOV2 });
    t.reg.vatChecks.push({ orderId: 102, country: "FR", vatNumber: "99999999999", status: "invalid", checkedAt: NOV2 });
    for (const [o, id] of [[101, "in_fr"], [102, "in_fr2"]] as const) await t.reg.paid(o, gwInvoice(id, "subscription_create", [line(`${id}_l`, "price_essential", 4_900, 0)], { customerCountry: "FR", customerPostalCode: "75001" }), NOV2);
    await t.svc.generateStripeSales("system");
    const iss = await t.auto.issueDue();
    expect(iss.issued.map((x) => x.number)).toEqual(["EB-2026-00001"]);
    expect(iss.blocked[0].reason).toContain("cliente fuera de España");
    const inv = (await t.store.get(1))!;
    expect(inv.customer).toMatchObject({ taxId: "FR12345678901", country: "FR", city: "París" });
    expect(inv.fiscal).toMatchObject({ fiscalCase: "business:eu_vies", treatment: "reverse_charge", legalMention: expect.stringMatching(/^Inversión del sujeto pasivo\./) });
  });
});

describe("ventas actuales (empresa de la península) sin más cambios que fechas y descuentos", () => {
  it("con todos los casos activados, una venta peninsular produce la misma factura que sin activar ninguno", async () => {
    const a = setup();
    const b = setup({ fiscalCases: { enabled: new Set(["consumer:es_mainland", "business:es_canarias", "business:eu_vies", "business:non_eu", "consumer:eu"]), simplified: true, euB2cRegime: "destination_oss" } });
    for (const t of [a, b]) {
      t.reg.profiles.set(101, profile(101));
      await t.reg.paid(101, COMPRA, NOV2);
      await t.svc.generateStripeSales("system");
      await t.auto.issueDue();
    }
    expect(await b.store.get(1)).toEqual(await a.store.get(1));
    const inv = (await a.store.get(1))!;
    expect(inv).toMatchObject({ number: "EB-2026-00001", baseCents: 1_900, taxCents: 399, totalCents: 2_299 });
    expect(inv.lines.every((l) => l.grossCents === undefined && l.discountCents === undefined)).toBe(true);
  });

  it("Nextair: el borrador y la factura externa no llevan datos fiscales nuevos ni descuentos", async () => {
    const t = setup({ externals: true, stripe: { in_externo_nov: { status: "paid", amountPaid: 121_000, currency: "eur" } } });
    await t.svc.generateExternal("system");
    await t.auto.issueDue();
    const inv = (await t.store.bySource("external:1:2026-11"))!;
    expect(inv.number).toBe("EB-2026-00001");
    expect(inv.fiscal).toBeUndefined();
    expect(inv.lines).toEqual([{ position: 1, concept: expect.any(String), quantity: 1, unitCents: 100_000, baseCents: 100_000, taxRateBp: 2100, taxCents: 21_000 }]);
    const s = text(inv);
    expect(s).toContain('["Fecha de operación (devengo)","01/11/2026"]');
    expect(s).not.toContain("Fecha de cobro");
    expect(s).not.toContain("Descuento");
  });
});

describe("matriz fiscal: saldo a favor (medio de pago o ajuste de precio)", () => {
  const SALDO = { ...ALTA, id: "in_saldo", amountPaid: 4_929 };

  it("sin origen determinado no se expide (motivo registrado); como medio de pago, la misma factura y conciliada con lo cobrado", async () => {
    const t = setup();
    t.reg.profiles.set(101, profile(101));
    await t.reg.paid(101, SALDO, NOV2);
    await t.svc.generateStripeSales("system");
    expect((await t.svc.readiness(1)).problems).toEqual(["saldo a favor del cliente aplicado en Stripe (10,00 €) de origen fiscal no determinado: indicar si es un saldo monetario (medio de pago) o un ajuste del precio de una factura anterior (rectificativa, art. 80.Dos de la Ley 37/1992 y art. 15 del RD 1619/2012)"]);
    expect((await t.auto.issueDue()).issued).toEqual([]);
    await expect(t.svc.resolveCredit(1, { origin: "payment_means", reason: "x" }, "operador")).rejects.toThrow("Indica el motivo");
    await t.svc.resolveCredit(1, { origin: "payment_means", reason: "Saldo monetario del cliente" }, "operador");
    const iss = await t.auto.issueDue();
    expect(iss.blocked).toEqual([]);
    expect(iss.issued).toEqual([{ id: 1, number: "EB-2026-00001", totalCents: 5_929, delivery: "pending" }]);
    const inv = (await t.store.get(1))!;
    expect([inv.baseCents, inv.taxCents, inv.totalCents]).toEqual([4_900, 1_029, 5_929]);
    expect(inv.fiscal?.credit).toMatchObject({ appliedCents: 1_000, origin: "payment_means", originalInvoiceId: null, rectificationInvoiceId: null, decidedBy: "operador" });
    expect(inv.fiscal?.evidence?.amounts).toMatchObject({ balanceAppliedCents: 1_000, totalCents: 5_929 });
    expect(inv.fiscal?.evidence?.stripeTax).toMatchObject({ amountPaidCents: 4_929, taxCents: 1_029 });
    // Una vez expedida no se cambia
    await expect(t.svc.resolveCredit(1, { origin: "payment_means", reason: "otra vez" }, "operador")).rejects.toThrow("sin expedir");
  });

  it("ajuste del precio de una factura anterior: borrador de rectificativa enlazado (EBR) y la venta se expide", async () => {
    const t = setup();
    t.reg.profiles.set(101, profile(101));
    await t.reg.paid(101, ALTA, NOV2);
    await t.svc.generateStripeSales("system");
    await t.auto.issueDue();
    // Segunda venta con 12,10 € de saldo a favor que procede de un ajuste del precio de la factura EB-2026-00001
    await t.reg.paid(101, { ...ALTA, id: "in_saldo2", amountPaid: 5_929 - 1_210 }, NOV2 + DAY);
    t.at(NOV2 + DAY + 3_600_000);
    await t.svc.generateStripeSales("system");
    const sale = (await t.store.bySource(stripeSaleSourceKey(101, "in_saldo2")))!;
    const after = await t.svc.resolveCredit(sale.id, { origin: "price_adjustment", originalInvoiceId: 1, reason: "Bonificación posterior por incidencia" }, "operador");
    const rid = after.fiscal!.credit!.rectificationInvoiceId!;
    const r = (await t.store.get(rid))!;
    expect(r).toMatchObject({ kind: "rectification", status: "draft", originalInvoiceId: 1, baseCents: -1_000, taxCents: -210, totalCents: -1_210 });
    expect(r.fiscal).toMatchObject({ rectifies: { invoiceId: 1, number: "EB-2026-00001", invoiceType: "complete" }, evidence: null, ruleId: "business:es_mainland", matrixVersion: FISCAL_MATRIX_VERSION });
    expect((await t.svc.issue(rid, "operador")).number).toBe("EBR-2026-00001");
    expect((await t.store.get(1))!.status).toBe("issued");
    expect((await t.auto.issueDue()).issued.map((x) => x.number)).toEqual(["EB-2026-00002"]);
    // Repetir la decisión no crea otra rectificativa (idempotente por importe)
    expect((await t.store.list({})).filter((x) => x.kind === "rectification")).toHaveLength(1);
  });

  it("ajuste sobre una factura de otra empresa o sin expedir: rechazado", async () => {
    const t = setup();
    t.reg.profiles.set(101, profile(101));
    t.reg.profiles.set(102, profile(102));
    await t.reg.paid(102, { ...ALTA, id: "in_otra" }, NOV2);
    await t.reg.paid(101, SALDO, NOV2);
    await t.svc.generateStripeSales("system");
    const own = (await t.store.bySource(stripeSaleSourceKey(101, "in_saldo")))!;
    const other = (await t.store.bySource(stripeSaleSourceKey(102, "in_otra")))!;
    await expect(t.svc.resolveCredit(own.id, { origin: "price_adjustment", originalInvoiceId: other.id, reason: "Ajuste de precio" }, "operador")).rejects.toThrow("otra empresa");
    await expect(t.svc.resolveCredit(other.id, { origin: "payment_means", reason: "Saldo monetario" }, "operador")).rejects.toThrow("no tiene saldo a favor");
  });
});

describe("matriz fiscal: simplificadas y sus rectificativas", () => {
  const ALL: FiscalCasesConfig = { enabled: new Set(["consumer:es_mainland"]), simplified: true, euB2cRegime: null };
  it("rectificativa de una simplificada: serie propia EBSR (art. 7.1.a RD 1619/2012), título y libro registro R5; la de una completa, EBR y R1", async () => {
    const t = setup({ fiscalCases: ALL });
    t.reg.profiles.set(101, CONSUMER(101, { billingAddress: null }));
    t.reg.profiles.set(103, profile(103));
    await t.reg.paid(101, ALTA, NOV2);
    await t.reg.paid(103, gwInvoice("in_empresa", "subscription_create", [line("e1", "price_essential", 4_900, 1_029)]), NOV2);
    await t.svc.generateStripeSales("system");
    await t.auto.issueDue();
    const simp = (await t.store.bySource(stripeSaleSourceKey(101, "in_alta")))!;
    const comp = (await t.store.bySource(stripeSaleSourceKey(103, "in_empresa")))!;
    expect(simp.number).toBe("EBS-2026-00001");
    const rs = await t.svc.issue((await t.svc.rectify(simp.id, { reason: "Error en el concepto" }, "operador")).id, "operador");
    const rc = await t.svc.issue((await t.svc.rectify(comp.id, { reason: "Error en el concepto" }, "operador")).id, "operador");
    expect([rs.number, rc.number]).toEqual(["EBSR-2026-00001", "EBR-2026-00001"]);
    expect(rs.fiscal).toMatchObject({ invoiceType: "simplified", rectifies: { invoiceId: simp.id, number: "EBS-2026-00001", invoiceType: "simplified" } });
    expect(rs.fiscal?.advisorPending).toContain("rectificativa_simplificada");
    expect(text(rs)).toContain('"text":"Factura rectificativa simplificada"');
    expect(text(rs)).toContain("factura EBS-2026-00001");
    expect(invoiceHtml(rs, ISSUER_PARTY)).toContain("<h1>Factura rectificativa simplificada</h1>");
    const csv = registerCsv(await t.store.list({}));
    expect(csv).toContain(";EBS;EBS-2026-00001;F2;");
    expect(csv).toContain(";EBSR;EBSR-2026-00001;R5;");
    expect(csv).toContain(";EB;EB-2026-00001;F1;");
    expect(csv).toContain(";EBR;EBR-2026-00001;R1;");
  });
});

describe("matriz fiscal: casos preparados con evidencias", () => {
  const fr = { country: "FR", postalCode: "75001", territory: "eu" as const, billingAddress: { line1: "1 rue Sintétique", line2: null, city: "París", state: null } };
  const frSale = (id: string, base: number, tax: number) => gwInvoice(id, "subscription_create", [line(`${id}_l`, "price_essential", base, tax)], { customerCountry: "FR", customerPostalCode: "75001" });

  it("empresa de la UE: la comprobación VIES con su fecha y la condición del comprador quedan en la factura", async () => {
    const t = setup({ fiscalCases: { enabled: new Set(["business:eu_vies"]), simplified: false, euB2cRegime: null } });
    t.reg.profiles.set(101, profile(101, { ...fr, scenario: "business:eu", taxId: "FR12345678901" }));
    t.reg.vatChecks.push({ orderId: 101, country: "FR", vatNumber: "12345678901", status: "valid", checkedAt: NOV2 - DAY });
    await t.reg.paid(101, frSale("in_fr", 4_900, 0), NOV2);
    await t.svc.generateStripeSales("system");
    expect((await t.auto.issueDue()).issued.map((x) => x.number)).toEqual(["EB-2026-00001"]);
    const inv = (await t.store.get(1))!;
    expect(inv.fiscal).toMatchObject({ ruleId: "business:eu_vies", matrixVersion: FISCAL_MATRIX_VERSION });
    expect(inv.fiscal?.evidence).toMatchObject({ ruleStatus: "ready", vies: { vatNumber: "FR12345678901", status: "valid", checkedAt: NOV2 - DAY }, buyer: { condition: "business_vies", country: "FR" }, stripeTax: { taxCents: 0, customerCountry: "FR" } });
  });

  it("particular de la UE bajo el umbral (declarado): IVA español, simplificada; la venta que supera 10.000 € en el año se bloquea", async () => {
    const t = setup({ fiscalCases: { enabled: new Set(["consumer:eu"]), simplified: true, euB2cRegime: "below_threshold" } });
    t.reg.profiles.set(101, CONSUMER(101, { ...fr, scenario: "consumer:eu", billingAddress: null }));
    await t.reg.paid(101, frSale("in_fr1", 4_900, 1_029), NOV2);
    await t.svc.generateStripeSales("system");
    expect((await t.auto.issueDue()).issued.map((x) => x.number)).toEqual(["EBS-2026-00001"]);
    expect((await t.store.get(1))!.fiscal).toMatchObject({ ruleId: "consumer:eu@below_threshold", treatment: "taxed_es", invoiceType: "simplified" });
    // Segunda venta (con NIF y domicilio: factura completa) que lleva el año por encima de 10.000 € sin IVA
    t.reg.profiles.set(102, CONSUMER(102, { ...fr, scenario: "consumer:eu", taxId: "X1234567" }));
    await t.reg.paid(102, frSale("in_fr2", 995_200, 208_992), NOV2);
    await t.svc.generateStripeSales("system");
    const iss = await t.auto.issueDue();
    expect(iss.issued).toEqual([]);
    expect(iss.blocked[0].reason).toContain("superan 10.000 €: desde esta operación tributa en destino (art. 73.Uno)");
  });

  it("particular de la UE en destino (OSS): sin una segunda prueba de localización independiente no se expide", async () => {
    const t = setup({ fiscalCases: { enabled: new Set(["consumer:eu"]), simplified: true, euB2cRegime: "destination_oss" } });
    t.reg.profiles.set(101, CONSUMER(101, { ...fr, scenario: "consumer:eu", taxId: "X1234567" }));
    await t.reg.paid(101, frSale("in_oss", 4_900, 980), NOV2);
    await t.svc.generateStripeSales("system");
    const iss = await t.auto.issueDue();
    expect(iss.issued).toEqual([]);
    expect(iss.blocked[0].reason).toContain("faltan pruebas de localización: el art. 24 ter.d) del Reglamento 282/2011 exige dos no contradictorias");
  });

  it("empresa de fuera de la UE: no sujeta con su mención y el identificador fiscal como prueba; sin él, bloqueada", async () => {
    const us = { country: "US", postalCode: "10001", territory: "non_eu" as const, scenario: "business:non_eu" as const, billingAddress: { line1: "1 Synthetic Ave", line2: null, city: "Nueva York", state: "NY" } };
    const t = setup({ fiscalCases: { enabled: new Set(["business:non_eu"]), simplified: false, euB2cRegime: null } });
    t.reg.profiles.set(101, profile(101, { ...us, taxId: "123456789" }));
    t.reg.profiles.set(102, profile(102, { ...us, taxId: null }));
    for (const [o, id] of [[101, "in_us"], [102, "in_us2"]] as const) await t.reg.paid(o, gwInvoice(id, "subscription_create", [line(`${id}_l`, "price_essential", 4_900, 0)], { customerCountry: "US", customerPostalCode: "10001" }), NOV2);
    await t.svc.generateStripeSales("system");
    const iss = await t.auto.issueDue();
    expect(iss.issued.map((x) => x.number)).toEqual(["EB-2026-00001"]);
    expect(iss.blocked.map((b) => b.reason).join(" ")).toContain("falta el NIF");
    const inv = (await t.store.get(1))!;
    expect(inv.fiscal).toMatchObject({ ruleId: "business:non_eu", treatment: "not_subject", legalMention: "Operación no sujeta al IVA: destinatario empresario o profesional establecido fuera del territorio de aplicación del impuesto (art. 69.Uno.1.º de la Ley 37/1992)." });
    expect(inv.fiscal?.evidence?.buyer).toMatchObject({ country: "US", taxId: "123456789", condition: "business_declared" });
  });

  it("un caso bloqueado en la matriz nunca se expide, aunque se fuerce en la configuración", async () => {
    const t = setup({ fiscalCases: { enabled: new Set(["business:es_ceuta", "consumer:non_eu"]), simplified: true, euB2cRegime: null } });
    t.reg.profiles.set(101, profile(101, { postalCode: "51001", territory: "es_ceuta", scenario: "business:es_special" }));
    await t.reg.paid(101, gwInvoice("in_ceuta", "subscription_create", [line("c1", "price_essential", 4_900, 0)], { customerPostalCode: "51001" }), NOV2);
    await t.svc.generateStripeSales("system");
    const iss = await t.auto.issueDue();
    expect(iss.issued).toEqual([]);
    expect(iss.blocked[0].reason).toContain("el caso fiscal business:es_ceuta está bloqueado");
  });
});

describe("matriz fiscal: devengo con reintentos de Stripe", () => {
  it("el reintento de la misma factura de Stripe no es un periodo nuevo: una factura, exigibilidad y cobro por separado en las evidencias", async () => {
    const t = setup();
    t.reg.profiles.set(101, profile(101));
    await t.reg.paid(101, RENOVACION, DEC2 + DAY);
    // El evento del cobro llega otra vez (otro reintento notificado): mismo documento, ninguna factura nueva
    await t.reg.paid(101, RENOVACION, DEC2 + 3 * DAY);
    t.at(DEC2 + 3 * DAY + 60_000);
    expect((await t.svc.generateStripeSales("system")).created).toHaveLength(1);
    expect((await t.svc.generateStripeSales("system")).created).toHaveLength(0);
    await t.auto.issueDue();
    const inv = (await t.store.get(1))!;
    expect(await t.store.list({})).toHaveLength(1);
    expect(inv.fiscal?.evidence?.dates).toMatchObject({ operationDate: "2026-12-02", accrualBasis: "due_date", dueDate: "2026-12-02", collectionDate: "2026-12-03", issueDate: "2026-12-05", periodStart: DEC2 });
  });
});
