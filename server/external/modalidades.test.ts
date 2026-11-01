/**
 * Suscripción recurrente desde «+ Nuevo servicio externo»: borrador sin envíos ni cargos, edición del borrador,
 * periodicidad trimestral o anual, duración fija, descuento o recargo autorizado, cancelación antes de Stripe y la
 * suscripción de Stripe con su periodicidad y fin. La mensual sin ajuste (Nextair) conserva su texto exacto.
 * Datos sintéticos; Stripe es el doble de pruebas.
 */
import { describe, it, expect } from "vitest";
import { CrmService } from "../crm/service";
import { MemoryCrmStore } from "../crm/store";
import { MemoryStripeStore } from "../stripe/store";
import { FakeStripeGateway } from "../stripe/testing";
import { billingTerms } from "./document";
import { ExternalService } from "./service";
import { MemoryExternalStore } from "./store";
import { chargeInstant } from "./schedule";

const T = Date.UTC(2026, 10, 15, 9);
const urls = { acceptance: "https://admin.example/a", setupSuccess: "https://admin.example/ok", setupCancel: "https://admin.example/ko", portalReturn: "https://admin.example" };
const BASE = { service: { key: "infra-plus", name: "Infraestructura Plus" }, amountCents: 120_000, taxRateBp: 2100, firstChargeDate: "2026-12-01", conditions: "Condiciones del servicio de prueba suficientemente largas." };

async function setup() {
  const crmStore = new MemoryCrmStore();
  const crm = new CrmService({ store: crmStore, now: () => T });
  const store = new MemoryExternalStore("test");
  const gw = new FakeStripeGateway();
  const invites: string[] = [];
  const svc = new ExternalService({ store, crm, crmStore, stripeStore: new MemoryStripeStore("test"), gateway: gw, mode: "test", namespace: "beta", urls, now: () => T, mail: { invite: async (to) => (invites.push(to), { status: "pending", reason: null, duplicate: false }) } });
  const c = await crm.createCompany({ name: "Cliente Demo", legalName: "Cliente Demo SL" }, "operator:test");
  return { crm, crmStore, store, gw, svc, invites, companyId: c.id };
}

describe("suscripción recurrente: nuevas opciones", () => {
  it("la mensual sin duración ni ajuste conserva exactamente el texto contractual de siempre", () => {
    const x = { serviceName: "SkiNet", amountCents: 100_000, currency: "EUR", taxRateBp: 2100, billingDay: 1, billingHour: 8, timezone: "Europe/Madrid", graceDays: 5, firstChargeAt: chargeInstant("2026-11-01", 8, "Europe/Madrid") };
    expect(billingTerms(x)).toEqual(billingTerms({ ...x, interval: "month", intervalCount: 1, durationPeriods: null, endsAt: null, baseAmountCents: null, adjustment: null }));
    expect(billingTerms(x).slice(1, 4)).toEqual([
      "Cuota mensual: 1.000,00 € más IVA (21 %, 210,00 €): total previsto 1.210,00 € al mes.",
      "Periodicidad: mensual. Cargo ordinario el día 1 de cada mes (Europe/Madrid); primer cargo el 01/11/2026.",
      "Cada cargo corresponde a la mensualidad que empieza ese día. Margen de pago: hasta el día 5 del mes; en ese plazo se reintenta el cobro y no se emite ningún cargo adicional por el mismo periodo.",
    ].map((s) => s.replace(/ €/g, " €")));
  });

  it("borrador: no envía nada, se edita y al pedir la aceptación sale del borrador", async () => {
    const t = await setup();
    const x = await t.svc.create({ ...BASE, companyId: t.companyId, draft: true }, "operator:ana");
    expect(x).toMatchObject({ status: "draft", interval: "month", intervalCount: 1, durationPeriods: null, adjustment: null });
    expect(t.gw.calls).toHaveLength(0);
    expect(t.invites).toHaveLength(0);
    const ed = await t.svc.updateDraft(x.id, { ...BASE, amountCents: 90_000, interval: "year" }, "operator:ana");
    expect(ed).toMatchObject({ status: "draft", amountCents: 90_000, interval: "year", intervalCount: 1 });
    const contract = (await t.crmStore.get("contracts", x.contractId))!;
    expect(contract).toMatchObject({ billingInterval: "year", amountCents: 90_000, status: "draft" });
    expect(contract.conditions).toMatch(/Cuota anual: 900,00\s€/);
    await t.svc.requestAcceptance(x.id, { name: "Laura Demo", email: "laura@cliente.example" }, "operator:ana", { send: true });
    expect((await t.store.get(x.id))!.status).toBe("awaiting_acceptance");
    expect(t.invites).toEqual(["laura@cliente.example"]);
    await expect(t.svc.updateDraft(x.id, BASE, "operator:ana")).rejects.toMatchObject({ code: "invalid_state" });
  });

  it("ajuste comercial: solo con autorización; la cuota final y el precio de lista quedan en el contrato", async () => {
    const t = await setup();
    const adjustment = { type: "discount" as const, mode: "percent" as const, value: 1500, reason: "Acuerdo comercial anual" };
    await expect(t.svc.create({ ...BASE, companyId: t.companyId, adjustment }, "operator:ana")).rejects.toMatchObject({ code: "forbidden" });
    const x = await t.svc.create({ ...BASE, companyId: t.companyId, adjustment, interval: "quarter", durationPeriods: 4 }, "operator:jefa", { canAuthorize: true });
    expect(x).toMatchObject({ amountCents: 102_000, baseAmountCents: 120_000, intervalCount: 3, durationPeriods: 4, adjustment: { authorizedBy: "operator:jefa" } });
    expect(new Date(x.endsAt!).toISOString()).toBe("2027-12-01T07:00:00.000Z");
    const text = (await t.crmStore.get("contracts", x.contractId))!.conditions!;
    expect(text).toMatch(/Precio de lista: 1\.200,00\s€ más IVA por periodo; se aplica un descuento comercial del 15 % autorizado/);
    expect(text).toMatch(/Cuota trimestral: 1\.020,00\s€/);
    expect(text).toMatch(/Duración: 4 periodos trimestrales, hasta el 01\/12\/2027, sin renovación automática/);
    expect((await t.svc.detail(x.id)).events.map((e) => e.kind)).toEqual(expect.arrayContaining(["created", "adjustment_authorized"]));
    // Un borrador con ajuste editado por quien no autoriza, sin enviar el ajuste, lo conserva
    const d = await t.svc.create({ ...BASE, service: { key: "otro", name: "Otro servicio" }, companyId: t.companyId, adjustment, draft: true }, "operator:jefa", { canAuthorize: true });
    expect(await t.svc.updateDraft(d.id, { ...BASE, service: { key: "otro", name: "Otro servicio" }, graceDays: 7 }, "operator:ana")).toMatchObject({ graceDays: 7, amountCents: 102_000, adjustment: { authorizedBy: "operator:jefa" } });
  });

  it("Stripe recibe la periodicidad trimestral y el fin de la duración (sin cargo hasta el primer vencimiento)", async () => {
    const t = await setup();
    const x = await t.svc.create({ ...BASE, companyId: t.companyId, interval: "quarter", durationPeriods: 4 }, "operator:ana");
    await t.store.update(x.id, x.version, { status: "awaiting_payment_method" }, T);
    const s = await t.svc.paymentSetup(x.id, "operator:ana");
    t.gw.completeSetupSession(s.sessionId);
    await t.svc.handleSetupSession(s.sessionId);
    const call = t.gw.calls.find((k) => k.op === "subscriptions.create(service)")!.input as Record<string, unknown>;
    expect(call).toMatchObject({ interval: "month", intervalCount: 3, cancelAt: Math.floor(x.endsAt! / 1000), trialEnd: Math.floor(x.firstChargeAt / 1000), description: expect.stringMatching(/cuota trimestral/) });
    // Una mensual indefinida sigue llamando a Stripe exactamente como antes
    const m = await t.svc.create({ ...BASE, service: { key: "mensual", name: "Mensual" }, companyId: t.companyId }, "operator:ana");
    await t.store.update(m.id, m.version, { status: "awaiting_payment_method" }, T);
    const s2 = await t.svc.paymentSetup(m.id, "operator:ana");
    t.gw.completeSetupSession(s2.sessionId);
    await t.svc.handleSetupSession(s2.sessionId);
    const call2 = t.gw.calls.filter((k) => k.op === "subscriptions.create(service)")[1].input as Record<string, unknown>;
    expect(call2.interval).toBe("month");
    expect("intervalCount" in call2 || "cancelAt" in call2).toBe(false);
  });

  it("cancelar antes de Stripe; después, no", async () => {
    const t = await setup();
    const x = await t.svc.create({ ...BASE, companyId: t.companyId, draft: true }, "operator:ana");
    await expect(t.svc.cancel(x.id, "no", "operator:ana")).rejects.toMatchObject({ code: "invalid_input" });
    const c = await t.svc.cancel(x.id, "El cliente lo descarta", "operator:ana");
    expect(c.status).toBe("canceled");
    expect((await t.crmStore.get("contracts", x.contractId))!.status).toBe("cancelled");
    // Cancelada, la clave queda libre para otra contratación
    const y = await t.svc.create({ ...BASE, companyId: t.companyId }, "operator:ana");
    await t.store.update(y.id, y.version, { status: "active" }, T);
    await expect(t.svc.cancel(y.id, "El cliente lo descarta", "operator:ana")).rejects.toMatchObject({ code: "invalid_state" });
  });
});
