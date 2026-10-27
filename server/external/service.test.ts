/**
 * Reglas del servicio de clientes externos que no necesitan la aplicación completa: cobros reales bloqueados sin el
 * interruptor y calendario del día 1 en Europe/Madrid.
 */
import { describe, it, expect } from "vitest";
import { CrmService } from "../crm/service";
import { MemoryCrmStore } from "../crm/store";
import { MemoryStripeStore } from "../stripe/store";
import { FakeStripeGateway } from "../stripe/testing";
import { ExternalService } from "./service";
import { MemoryExternalStore } from "./store";
import { chargeInstant, graceEnd, localDate, nextChargeAfter } from "./schedule";

const T = Date.UTC(2026, 9, 27, 9);
const urls = { acceptance: "https://admin.example/a", setupSuccess: "https://admin.example/ok", setupCancel: "https://admin.example/ko", portalReturn: "https://admin.example" };

describe("servicios externos: reglas", () => {
  it("en live, sin CP_EXTERNAL_LIVE_ENABLED, nunca se abre la autorización del método de pago", async () => {
    const crmStore = new MemoryCrmStore();
    const crm = new CrmService({ store: crmStore, now: () => T });
    const store = new MemoryExternalStore("live");
    const gw = new FakeStripeGateway();
    const svc = new ExternalService({ store, crm, crmStore, stripeStore: new MemoryStripeStore("live"), gateway: gw, mode: "live", namespace: "live", urls, now: () => T });
    const c = await crm.createCompany({ name: "Cliente Real SL" }, "operator:test");
    const x = await svc.create({ companyId: c.id, service: { key: "skinet", name: "SkiNet" }, amountCents: 100_000, taxRateBp: 2100, firstChargeDate: "2026-11-01", conditions: "Condiciones del servicio de prueba suficientemente largas." }, "operator:test");
    await store.update(x.id, x.version, { status: "awaiting_payment_method" }, T);
    await expect(svc.paymentSetup(x.id, "operator:test")).rejects.toMatchObject({ code: "unavailable", message: expect.stringMatching(/CP_EXTERNAL_LIVE_ENABLED/) });
    expect(gw.calls.filter((k) => k.op.startsWith("checkout.sessions.create"))).toHaveLength(0);
  });

  it("calendario: día 1 a las 08:00 de Madrid en invierno y verano; margen hasta el día 5 a las 23:59:59", () => {
    expect(new Date(chargeInstant("2026-11-01", 8, "Europe/Madrid")).toISOString()).toBe("2026-11-01T07:00:00.000Z");
    expect(new Date(chargeInstant("2027-07-01", 8, "Europe/Madrid")).toISOString()).toBe("2027-07-01T06:00:00.000Z");
    // El día de cambio de hora (último domingo de marzo) y meses de 28, 30 y 31 días
    for (const d of ["2027-02-01", "2027-03-01", "2027-04-01", "2027-11-01"]) expect(localDate(chargeInstant(d, 8, "Europe/Madrid"), "UTC").day).toBe(1);
    expect(new Date(graceEnd(chargeInstant("2027-01-01", 8, "Europe/Madrid"), 5, "Europe/Madrid")).toISOString()).toBe("2027-01-05T22:59:59.000Z");
    expect(new Date(nextChargeAfter(chargeInstant("2026-11-01", 8, "Europe/Madrid"), 1, 8, "Europe/Madrid")).toISOString()).toBe("2026-12-01T07:00:00.000Z");
  });
});
