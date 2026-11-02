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
import { InvoicingAutomation } from "./delivery";
import type { CompanyFiscal } from "./rules";
import { InvoicingService } from "./service";
import { MemoryInvoicingStore } from "./store";
import { productLabel, rateOf, saleLines, StripeSalesInvoicing, stripeSaleSourceKey, type StripeSalesRegistry } from "./stripeSales";
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

function setup(o: { stripeSales?: boolean; issueEnabled?: boolean; stripe?: Record<string, { status: string; amountPaid: number; currency: string } | null>; externals?: boolean } = {}) {
  let now = NOV2 + 3_600_000;
  const clock = () => now;
  const reg = new FakeRegistry();
  // Pedido → empresa: 101 y 103 de la empresa 20; 102 de la empresa 30
  const orderCompany: Record<number, number> = { 101: 20, 102: 30, 103: 20 };
  const companies: Record<number, CompanyFiscal> = { 7: NEXTAIR, 20: { name: "Escuela 20", legalName: null, taxId: null, address: null, postalCode: null, city: null, country: null }, 30: { name: "Escuela 30", legalName: null, taxId: null, address: null, postalCode: null, city: null, country: null } };
  const sales = o.stripeSales === false ? null : new StripeSalesInvoicing({ stripe: reg, lines: { linesOf: async (id) => reg.lines.filter((l) => l.stripeInvoiceId === id) }, orderCompany: async (id) => orderCompany[id] ?? null, company: async (id) => companies[id] ?? null, now: clock });
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

  it("líneas que no cuadran con el cobro (descuento): una línea con los totales cobrados", () => {
    const lines = saleLines({ purpose: "initial", totalCents: 4_840, taxCents: 840, periodStart: NOV2 }, [{ stripeLineId: "x", stripeInvoiceId: "in", orderId: 1, subscriptionItemId: null, stripePriceId: null, webPriceId: null, productKey: "essential", quantity: 1, amountCents: 4_900, taxCents: 840, proration: false, periodStart: NOV2, periodEnd: NOV2 + 30 * DAY, refundedCents: 0 }]);
    expect(lines).toEqual([{ position: 1, concept: "Alta de la suscripción a Elephant Source — 02/11/2026 a 01/12/2026", quantity: 1, unitCents: 4_000, baseCents: 4_000, taxRateBp: 2100, taxCents: 840 }]);
  });
});
