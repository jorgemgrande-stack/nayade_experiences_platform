/**
 * Facturación propia por devengo (contrato §5) con el caso de Nextair: 1.000 € + 21 % IVA, día 1 a las 08:00 (Madrid),
 * primer vencimiento el 01/11/2026.
 *  - El borrador nace el día de vencimiento (devengo), cobre o no; nunca antes ni dos veces.
 *  - El cobro (historial de la contratación) solo cambia el estado de cobro; un fallo no anula la factura.
 *  - Expedir exige emisión habilitada, datos fiscales completos y la fecha de operación cumplida; número correlativo
 *    por serie y año y huella encadenada.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { chargeInstant } from "../external/schedule";
import type { ExternalEvent, ExternalSubscription } from "../external/types";
import { ISSUER } from "../stripe/issuer";
import { customerOf, externalPeriods, isValidSpanishTaxId, type CompanyFiscal } from "./rules";
import { InvoicingService } from "./service";
import { MemoryInvoicingStore } from "./store";
import type { FiscalParty } from "./types";

const TZ = "Europe/Madrid";
const FIRST = chargeInstant("2026-11-01", 8, TZ);
const DAY = 86_400_000;
const ISSUER_PARTY: FiscalParty = { legalName: ISSUER.legalName, taxId: ISSUER.taxId, address: `${ISSUER.address.line1}, ${ISSUER.address.line2}`, postalCode: ISSUER.address.postalCode, city: ISSUER.address.city, country: "ES" };
const NEXTAIR: CompanyFiscal = { name: "Nextair", legalName: "NEXTAIR SL", taxId: "B12345674", address: "Calle Ejemplo 1", postalCode: "28001", city: "Madrid", country: "ES", billingEmail: "facturas@nextair.example" };

const external = (p: Partial<ExternalSubscription> = {}): ExternalSubscription =>
  ({ id: 1, contractId: 9, companyId: 7, serviceKey: "skinet", serviceName: "SkiNet — Servicio tecnológico gestionado", amountCents: 100_000, currency: "EUR", taxRateBp: 2100, interval: "month", billingDay: 1, billingHour: 8, timezone: TZ, graceDays: 5, firstChargeAt: FIRST, externalRef: "skicenter:nextair", status: "scheduled", ...p }) as ExternalSubscription;

function setup(o: { company?: CompanyFiscal | null; issueEnabled?: boolean; x?: Partial<ExternalSubscription> } = {}) {
  const store = new MemoryInvoicingStore();
  const events: ExternalEvent[] = [];
  let now = FIRST - DAY;
  const xs = [external(o.x)];
  const svc = new InvoicingService({
    store,
    external: { list: async () => xs, events: async (id) => events.filter((e) => e.externalId === id) },
    company: async () => (o.company === undefined ? NEXTAIR : o.company),
    issuer: ISSUER_PARTY,
    seriesCode: "EB",
    issueEnabled: o.issueEnabled ?? true,
    now: () => now,
  });
  return { store, svc, events, xs, at: (t: number) => (now = t) };
}
const paid = (ref: string, period: string, at: number, subtotal = 100_000): ExternalEvent => ({ id: 0, externalId: 1, kind: "invoice_paid", ref, detail: { period, subtotal, tax: 21_000, amountPaid: 121_000 }, actor: "system:stripe", at });
const failed = (ref: string, period: string, at: number): ExternalEvent => ({ id: 0, externalId: 1, kind: "invoice_payment_failed", ref, detail: { period }, actor: "system:stripe", at });

describe("facturación de Nextair por devengo", () => {
  let t: ReturnType<typeof setup>;
  beforeEach(() => (t = setup()));

  it("nada antes del primer vencimiento; el 01/11/2026 a las 08:00, un borrador de 1.000 € + 210 € = 1.210 €", async () => {
    expect((await t.svc.generateExternal("operador")).created).toEqual([]);
    t.at(FIRST);
    const r = await t.svc.generateExternal("operador");
    expect(r.created).toHaveLength(1);
    const inv = await t.svc.must(r.created[0].id);
    expect(inv).toMatchObject({ sourceKey: "external:1:2026-11", billingRef: "external:1", status: "draft", paymentStatus: "pending", operationDate: "2026-11-01", periodLabel: "noviembre de 2026", currency: "EUR", baseCents: 100_000, taxCents: 21_000, totalCents: 121_000, number: null, notes: "Referencia del cliente: skicenter:nextair" });
    expect(inv.lines).toEqual([{ position: 1, concept: "SkiNet — Servicio tecnológico gestionado — noviembre de 2026", quantity: 1, unitCents: 100_000, baseCents: 100_000, taxRateBp: 2100, taxCents: 21_000 }]);
    expect(inv.customer?.taxId).toBe("B12345674");
  });

  it("idempotente: repetir no duplica; cada mes devengado, su factura con su fecha de operación", async () => {
    t.at(FIRST);
    await t.svc.generateExternal("op");
    expect((await t.svc.generateExternal("op")).existing).toBe(1);
    t.at(chargeInstant("2027-01-01", 8, TZ) + 60_000);
    const r = await t.svc.generateExternal("op");
    expect(r.created.map((c) => c.sourceKey)).toEqual(["external:1:2026-12", "external:1:2027-01"]);
    expect((await t.svc.list()).map((i) => i.operationDate).sort()).toEqual(["2026-11-01", "2026-12-01", "2027-01-01"]);
  });

  it("facturar no es cobrar: el cobro solo cambia el estado de cobro; un fallo deja la factura pendiente de cobro", async () => {
    t.at(FIRST);
    await t.svc.generateExternal("op");
    t.events.push(failed("in_1", "noviembre de 2026", FIRST + 60_000));
    let r = await t.svc.generateExternal("op");
    expect(r.payments).toEqual([{ invoiceId: 1, paymentStatus: "failed" }]);
    expect((await t.svc.must(1)).status).toBe("draft");
    t.events.push(paid("in_1", "noviembre de 2026", FIRST + 2 * DAY));
    r = await t.svc.generateExternal("op");
    expect(await t.svc.must(1)).toMatchObject({ paymentStatus: "paid", paymentRef: "stripe:in:in_1", paidAt: FIRST + 2 * DAY });
    // El mismo evento otra vez no cambia nada
    expect((await t.svc.generateExternal("op")).payments).toEqual([]);
  });

  it("formato de #396: empareja por periodStart y usa baseCents; un reembolso total la deja reembolsada y no vuelve a cobrada", async () => {
    t.at(FIRST);
    await t.svc.generateExternal("op");
    const fields = { periodStart: FIRST, periodEnd: chargeInstant("2026-12-01", 8, TZ), baseCents: 100_000, taxCents: 21_000, totalCents: 121_000, billingRef: "external:1" };
    // La mensualidad legible distinta no importa: manda periodStart
    t.events.push({ ...paid("in_9", "octubre de 2026", FIRST), detail: { ...fields, period: "octubre de 2026", subtotal: 100_000 } });
    await t.svc.generateExternal("op");
    expect(await t.svc.must(1)).toMatchObject({ paymentStatus: "paid", paymentRef: "stripe:in:in_9" });
    t.events.push({ id: 0, externalId: 1, kind: "charge_refunded", ref: "ch_1:121000", detail: { ...fields, fullyRefunded: true, refundedDeltaCents: 121_000 }, actor: "system:stripe", at: FIRST + DAY });
    const r = await t.svc.generateExternal("op");
    expect(r.warnings.join()).toMatch(/rectificativa/);
    expect((await t.svc.must(1)).paymentStatus).toBe("refunded");
    expect((await t.svc.generateExternal("op")).payments).toEqual([]);
    expect((await t.svc.must(1)).paymentStatus).toBe("refunded");
  });

  it("un cobro con otra base es un aviso, no una corrección", async () => {
    t.at(FIRST);
    await t.svc.generateExternal("op");
    t.events.push(paid("in_2", "noviembre de 2026", FIRST, 90_000));
    const r = await t.svc.generateExternal("op");
    expect(r.warnings[0]).toMatch(/base 90000 y la factura 100000/);
    expect((await t.svc.must(1)).baseCents).toBe(100_000);
  });

  it("sin aceptar, sin método autorizado, cancelada o con decisión pendiente: no se factura sola", async () => {
    for (const status of ["awaiting_acceptance", "awaiting_payment_method", "canceled", "needs_decision"]) {
      const s = setup({ x: { status: status as ExternalSubscription["status"] } });
      s.at(FIRST + DAY);
      const r = await s.svc.generateExternal("op");
      expect(r.created, status).toEqual([]);
      if (status === "needs_decision") expect(r.skipped[0].reason).toMatch(/decisión pendiente/);
    }
  });
});

describe("expedición", () => {
  it("apagada en el entorno: solo borradores", async () => {
    const t = setup({ issueEnabled: false });
    t.at(FIRST);
    await t.svc.generateExternal("op");
    await expect(t.svc.issue(1, "op")).rejects.toMatchObject({ code: "unavailable" });
    expect((await t.svc.must(1)).status).toBe("draft");
  });

  it("sin datos fiscales verificados no se expide (nunca se inventan)", async () => {
    const t = setup({ company: { ...NEXTAIR, taxId: "B12345670", address: null } });
    t.at(FIRST);
    await t.svc.generateExternal("op");
    const { problems } = await t.svc.readiness(1);
    expect(problems).toEqual(["cliente: el NIF no es válido", "cliente: falta el domicilio fiscal"]);
    await expect(t.svc.issue(1, "op")).rejects.toMatchObject({ code: "invalid_state" });
  });

  it("numeración correlativa por serie y año, datos congelados y huella encadenada; no se expide dos veces", async () => {
    const t = setup();
    t.at(chargeInstant("2026-12-01", 8, TZ));
    await t.svc.generateExternal("op");
    const a = await t.svc.issue(1, "admin");
    expect(a).toMatchObject({ status: "issued", number: "EB-2026-00001", issueDate: "2026-12-01", issuedBy: "admin", previousHash: null, issuer: { legalName: "IRON ELEPHANT CONSULTING, S.L.", taxId: "B26987875" }, customer: { legalName: "NEXTAIR SL", taxId: "B12345674" } });
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
    const b = await t.svc.issue(2, "admin");
    expect(b).toMatchObject({ number: "EB-2026-00002", previousHash: a.hash });
    await expect(t.svc.issue(1, "admin")).rejects.toMatchObject({ code: "invalid_state" });
  });

  it("no se expide antes de la fecha de operación", async () => {
    const t = setup();
    t.at(FIRST);
    await t.svc.generateExternal("op");
    t.at(FIRST - 2 * DAY);
    expect((await t.svc.readiness(1)).problems).toEqual(["la fecha de operación (2026-11-01) todavía no ha llegado"]);
  });
});

describe("datos fiscales de la empresa", () => {
  it("Nextair con los datos confirmados está lista; sin domicilio, no; la emisión real se indica aparte", async () => {
    const ok = setup({ company: { name: "Nextair", legalName: "NEXTAIR SL", taxId: "B16408031", address: "C/ José Luis Pérez Pujadas, Ed. Forum, 14, 1º D", postalCode: "18006", city: "Granada", country: "ES" }, issueEnabled: false });
    expect(await ok.svc.fiscalCheck(7)).toEqual({ ready: true, problems: [], issueEnabled: false });
    const ko = setup({ company: { ...NEXTAIR, address: null } });
    expect(await ko.svc.fiscalCheck(7)).toMatchObject({ ready: false, problems: ["falta el domicilio fiscal"] });
    await expect(setup({ company: null }).svc.fiscalCheck(7)).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("reglas fiscales", () => {
  it("NIF: CIF, DNI y NIE con control; con prefijo ES", () => {
    expect(isValidSpanishTaxId("B26987875")).toBe(true);
    expect(isValidSpanishTaxId("ESB26987875")).toBe(true);
    expect(isValidSpanishTaxId("12345678Z")).toBe(true);
    expect(isValidSpanishTaxId("X1234567L")).toBe(true);
    expect(isValidSpanishTaxId("12345678A")).toBe(false);
  });
  it("Canarias, Ceuta, Melilla y clientes de fuera de España se revisan antes de aplicar el 21 %", () => {
    expect(customerOf({ ...NEXTAIR, postalCode: "35001" }).problems.join()).toMatch(/Canarias/);
    expect(customerOf({ ...NEXTAIR, country: "PT", taxId: "PT123456789" }).problems.join()).toMatch(/fuera de España/);
    expect(customerOf(NEXTAIR)).toMatchObject({ problems: [], party: { country: "ES", email: "facturas@nextair.example" } });
  });
  it("periodos por la hora de Madrid, también con cambio de hora", () => {
    const ps = externalPeriods({ id: 1, serviceName: "S", amountCents: 1, taxRateBp: 0, currency: "EUR", billingDay: 1, billingHour: 8, timezone: TZ, firstChargeAt: chargeInstant("2027-03-01", 8, TZ) }, chargeInstant("2027-04-01", 8, TZ));
    expect(ps.map((p) => [p.operationDate, p.label])).toEqual([["2027-03-01", "marzo de 2027"], ["2027-04-01", "abril de 2027"]]);
  });
});
