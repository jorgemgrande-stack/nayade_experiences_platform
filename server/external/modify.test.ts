/**
 * Modificación de las condiciones de un servicio externo (plantilla external.changed y alerta admin.external_changed):
 * solo antes de la aceptación y sin nada en Stripe; versión nueva del contrato con el motivo; enlaces pendientes
 * invalidados; hecho en el historial (una vez por versión) que lanza la alerta; aviso al representante que recibió el
 * contrato. Nunca después de la aceptación ni con una suscripción de Stripe.
 */
import { describe, it, expect } from "vitest";
import { CrmService } from "../crm/service";
import { MemoryCrmStore } from "../crm/store";
import { externalEventAlerts, withExternalAlerts } from "../adminAlerts/sources";
import { ExternalService, type ChangedMail } from "./service";
import { MemoryExternalStore } from "./store";

const T = Date.UTC(2026, 9, 27, 9);
const urls = { acceptance: "https://admin.example/a", setupSuccess: "https://admin.example/ok", setupCancel: "https://admin.example/ko", portalReturn: "https://admin.example" };
const CONDITIONS = "Condiciones del servicio de prueba suficientemente largas.";

async function setup() {
  const crmStore = new MemoryCrmStore();
  const crm = new CrmService({ store: crmStore, now: () => T });
  const raised: Array<{ id: string; summary: string }> = [];
  const store = withExternalAlerts(new MemoryExternalStore("test"), { raise: async (id, f) => void raised.push({ id, summary: f.summary }), companyName: async () => "Nextair SL" });
  const mails: Array<{ to: string; key: string; i: ChangedMail }> = [];
  const svc = new ExternalService({
    store,
    crm,
    crmStore,
    mode: "test",
    namespace: "beta",
    urls,
    now: () => T,
    mail: {
      invite: async () => ({ status: "pending", reason: null, duplicate: false }),
      changed: async (to, key, i) => (mails.push({ to, key, i }), { status: "pending", reason: null, duplicate: false, id: 7 }),
    },
  });
  const c = await crm.createCompany({ name: "Nextair", legalName: "Nextair SL" }, "operator:test");
  const x = await svc.create({ companyId: c.id, service: { key: "skinet", name: "SkiNet" }, amountCents: 100_000, taxRateBp: 2100, firstChargeDate: "2026-11-01", conditions: CONDITIONS }, "operator:test");
  return { svc, store, crm, crmStore, x, raised, mails };
}
const flush = () => new Promise((r) => setTimeout(r, 10));

describe("servicios externos: modificación de condiciones", () => {
  it("antes de la aceptación: versión nueva del contrato, enlace anterior anulado, historial, alerta y aviso al representante", async () => {
    const { svc, store, crm, x, raised, mails } = await setup();
    const link = await svc.requestAcceptance(x.id, { name: "Laura Representante", email: "laura@nextair.example" }, "operator:test", { send: true });
    const r = await svc.modify(x.id, { amountCents: 120_000, firstChargeDate: "2026-12-01", reason: "Ampliación del alcance acordada" }, "operator:test");
    expect(r.external).toMatchObject({ amountCents: 120_000, status: "awaiting_acceptance", stripeSubscriptionId: null });
    expect(r.contractVersion).toBe(2);
    // El contrato recoge las condiciones nuevas y conserva las del servicio; vuelve a borrador
    const { contract, versions } = await crm.getContract(x.contractId);
    expect(contract).toMatchObject({ version: 2, status: "draft", amountCents: 120_000 });
    expect(contract.conditions).toMatch(/Cuota mensual: 1\.200,00\s€/);
    expect(contract.conditions).toContain("primer cargo el 01/12/2026");
    expect(contract.conditions!.endsWith(CONDITIONS)).toBe(true);
    expect(versions[0].reason).toContain("Ampliación del alcance acordada");
    // El enlace enviado ya no vale (el documento cambió)
    await expect(svc.viewAcceptance(new URL(link.url).searchParams.get("token")!)).rejects.toMatchObject({ code: "invalid_state" });
    // Historial y alerta administrativa
    const ev = (await store.events(x.id)).filter((e) => e.kind === "changed");
    expect(ev).toHaveLength(1);
    expect(ev[0].detail).toMatchObject({ fields: ["amountCents", "firstChargeAt"], labels: ["Cuota mensual", "Primer cargo"], before: { amountCents: 100_000 }, after: { amountCents: 120_000 }, contractVersion: 2 });
    await flush();
    expect(raised.map((a) => a.id)).toContain("admin.external_changed");
    expect(raised.find((a) => a.id === "admin.external_changed")!.summary).toContain("Cuota mensual, Primer cargo");
    // Aviso al representante (external.changed), una clave por versión
    expect(mails).toEqual([{ to: "laura@nextair.example", key: `external-changed:beta:${x.id}:v2`, i: expect.objectContaining({ signerName: "Laura Representante", companyName: "Nextair SL", serviceName: "SkiNet", amountCents: 120_000, effectiveAt: Date.UTC(2026, 11, 1, 7) }) }]);
    expect((await store.events(x.id)).filter((e) => e.kind === "changed_email")).toHaveLength(1);
    // Se puede volver a enviar el contrato nuevo
    await expect(svc.requestAcceptance(x.id, { name: "Laura Representante", email: "laura@nextair.example" }, "operator:test")).resolves.toMatchObject({ version: 2 });
  });

  it("sin representante todavía: registra el cambio y la alerta, sin correo; sin cambios reales no hace nada", async () => {
    const { svc, store, x, raised, mails } = await setup();
    await expect(svc.modify(x.id, { amountCents: 100_000, reason: "Sin cambios de verdad" }, "operator:test")).rejects.toMatchObject({ code: "invalid_input" });
    expect((await store.events(x.id)).filter((e) => e.kind === "changed")).toHaveLength(0);
    const r = await svc.modify(x.id, { serviceName: "SkiNet Pro", conditions: "Nuevas condiciones del servicio con soporte ampliado.", reason: "Cambio de nombre comercial" }, "operator:test");
    expect(r.mail).toBeNull();
    expect(mails).toHaveLength(0);
    await flush();
    expect(raised.filter((a) => a.id === "admin.external_changed")).toHaveLength(1);
  });

  it("después de la aceptación o con Stripe: nunca se modifica (ni evento, ni alerta, ni correo)", async () => {
    for (const status of ["awaiting_payment_method", "scheduled", "active", "past_due", "needs_decision", "canceled"] as const) {
      const { svc, store, x, raised, mails } = await setup();
      await store.update(x.id, x.version, { status }, T);
      await expect(svc.modify(x.id, { amountCents: 90_000, reason: "Rebaja acordada con el cliente" }, "operator:test")).rejects.toMatchObject({ code: "invalid_state" });
      await flush();
      expect((await store.events(x.id)).some((e) => e.kind === "changed")).toBe(false);
      expect(raised.some((a) => a.id === "admin.external_changed")).toBe(false);
      expect(mails).toHaveLength(0);
    }
    const { svc, store, x } = await setup();
    await store.update(x.id, x.version, { stripeSetupSessionId: "cs_test_abcdefgh" }, T);
    await expect(svc.modify(x.id, { amountCents: 90_000, reason: "Rebaja acordada con el cliente" }, "operator:test")).rejects.toMatchObject({ code: "invalid_state" });
  });

  it("valida motivo, fecha futura en el día de cobro e importe", async () => {
    const { svc, x } = await setup();
    await expect(svc.modify(x.id, { amountCents: 90_000, reason: "corto" }, "operator:test")).rejects.toMatchObject({ code: "invalid_input" });
    await expect(svc.modify(x.id, { firstChargeDate: "2026-12-02", reason: "Cambio de calendario acordado" }, "operator:test")).rejects.toThrow(/día de cobro/);
    await expect(svc.modify(x.id, { firstChargeDate: "2026-10-01", reason: "Cambio de calendario acordado" }, "operator:test")).rejects.toThrow(/ya ha pasado/);
    await expect(svc.modify(x.id, { amountCents: 50, reason: "Cambio de importe acordado" }, "operator:test")).rejects.toThrow(/Importe/);
  });

  it("alerta: el hecho «changed» es admin.external_changed; los avisos de correo no generan alerta", () => {
    const x = { id: 5, contractId: 1, companyId: 7, serviceName: "Servicio Ficticio", amountCents: 100_000, currency: "EUR" } as never;
    const ids = (kind: string) => externalEventAlerts({ externalId: 5, kind, ref: "contract-v2", detail: { labels: ["Cuota mensual"], reason: "Motivo de prueba", contractVersion: 2 }, actor: "operator:1", at: T }, x, "Cliente Ficticio, S.L.", false).map((a) => a.id);
    expect(ids("changed")).toEqual(["admin.external_changed"]);
    expect(ids("changed_email")).toEqual([]);
  });
});
