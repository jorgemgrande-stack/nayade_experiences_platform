/**
 * Modificaciones CONFIRMADAS de un servicio externo (plantilla external.changed y alerta admin.external_changed), con
 * datos simulados y la pasarela de Stripe falsa:
 *  - decisión registrada sobre el primer cargo (nueva fecha; «pendiente de decisión» → «programado»);
 *  - aceptación de una versión del contrato posterior a otra ya aceptada.
 * Una sola vez por servicio, versión y tipo de cambio; nada sin una operación confirmada; nunca cambia importes ni añade
 * llamadas a Stripe por el aviso.
 */
import { describe, it, expect } from "vitest";
import { CrmService } from "../crm/service";
import { MemoryCrmStore } from "../crm/store";
import { MemoryStripeStore } from "../stripe/store";
import { FakeStripeGateway } from "../stripe/testing";
import { externalEventAlerts, withExternalAlerts } from "../adminAlerts/sources";
import { extraTemplates } from "../mail/extraTemplates";
import { ExternalService, type ChangedMail } from "./service";
import { MemoryExternalStore } from "./store";

const T = Date.UTC(2026, 9, 29, 14);
const DAY = 86_400_000;
const urls = { acceptance: "https://admin.example/cp/v1/public/contract-acceptance", setupSuccess: "https://admin.example/ok", setupCancel: "https://admin.example/ko", portalReturn: "https://admin.example" };
const signer = { name: "Laura Representante", email: "laura@cliente-ficticio.example", role: "Administradora" };
const flush = () => new Promise((r) => setTimeout(r, 10));

async function setup() {
  let now = T;
  const crmStore = new MemoryCrmStore();
  const crm = new CrmService({ store: crmStore, now: () => now });
  const raised: Array<{ id: string; key: string; summary: string }> = [];
  const store = withExternalAlerts(new MemoryExternalStore("test"), { raise: async (id, f) => void raised.push({ id, key: f.key, summary: f.summary }), companyName: async () => "Cliente Ficticio SL" });
  const gw = new FakeStripeGateway();
  const changed: Array<{ to: string; key: string; i: ChangedMail }> = [];
  const svc = new ExternalService({
    store, crm, crmStore, stripeStore: new MemoryStripeStore("test"), gateway: gw, mode: "test", namespace: "beta", urls,
    ipSalt: "sal-de-pruebas-larga-0123456789abcdef",
    mail: {
      invite: async () => ({ status: "queued", reason: null, duplicate: false }),
      scheduled: async () => ({ status: "queued", reason: null, duplicate: false }),
      changed: async (to, key, i) => (changed.push({ to, key, i }), { status: "queued", reason: null, duplicate: false, id: changed.length }),
    },
    now: () => now,
  });
  const c = await crm.createCompany({ name: "Cliente Ficticio", legalName: "Cliente Ficticio SL" }, "operator:test");
  const x = await svc.create({ companyId: c.id, service: { key: "servicio-demo", name: "Servicio Demo" }, amountCents: 100_000, taxRateBp: 2100, firstChargeDate: "2026-11-01", conditions: "Condiciones del servicio de prueba suficientemente largas." }, "operator:test");
  const req = await svc.requestAcceptance(x.id, signer, "operator:test");
  const acc = await svc.accept(new URL(req.url).searchParams.get("token")!, { name: "Laura Representante", accept: true }, { ip: null, userAgent: null });
  return { svc, store, crmStore, gw, x, acc, changed, raised, tick: (ms: number) => (now += ms) };
}

/** Lleva el servicio a «pendiente de decisión»: el método de pago se confirma después del primer vencimiento. */
async function needsDecision(s: Awaited<ReturnType<typeof setup>>) {
  await s.svc.continuePaymentSetup(new URL(s.acc.continueUrl!).searchParams.get("t")!);
  const sid = (await s.store.get(s.x.id))!.stripeSetupSessionId!;
  s.gw.completeSetupSession(sid);
  s.tick(5 * DAY); // 3 de noviembre: el primer vencimiento (1 de noviembre) ya pasó
  await s.svc.handleSetupSession(sid);
  expect((await s.store.get(s.x.id))!.status).toBe("needs_decision");
}

describe("servicios externos: modificaciones confirmadas", () => {
  it("sin una operación confirmada no hay aviso ni alerta (alta, aceptación, método pendiente de decisión)", async () => {
    const s = await setup();
    await needsDecision(s);
    await flush();
    expect(s.changed).toHaveLength(0);
    expect((await s.store.events(s.x.id)).some((e) => e.kind === "changed")).toBe(false);
    expect(s.raised.some((a) => a.id === "admin.external_changed")).toBe(false);
  });

  it("decisión sobre el primer cargo: un aviso al firmante y una alerta, después de guardarse; nunca dos veces", async () => {
    const s = await setup();
    await needsDecision(s);
    const stripeBefore = s.gw.calls.length;
    const done = await s.svc.decideFirstCharge(s.x.id, { firstChargeDate: "2026-12-01", reason: "El cliente autorizó tarde: empezamos en diciembre" }, "operator:jorge");
    expect(done).toMatchObject({ status: "scheduled", firstChargeAt: Date.UTC(2026, 11, 1, 7), amountCents: 100_000 });
    // El aviso no añade llamadas a Stripe: solo las de la programación que ya existía (producto, IVA y suscripción)
    expect(s.gw.calls.slice(stripeBefore).map((c) => c.op).every((op) => !/update|cancel|delete/i.test(op))).toBe(true);
    const ev = (await s.store.events(s.x.id)).filter((e) => e.kind === "changed");
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ ref: `first_charge:v${done.version}`, detail: { change: "first_charge", before: { status: "needs_decision" }, after: { firstChargeAt: Date.UTC(2026, 11, 1, 7), status: "scheduled" } } });
    expect(s.changed).toEqual([
      { to: signer.email, key: `external-changed:beta:${s.x.id}:v${done.version}:first_charge`, i: expect.objectContaining({ change: "first_charge", companyName: "Cliente Ficticio SL", serviceName: "Servicio Demo", amountCents: 100_000, effectiveAt: Date.UTC(2026, 11, 1, 7) }) },
    ]);
    await flush();
    expect(s.raised.filter((a) => a.id === "admin.external_changed")).toHaveLength(1);
    expect(s.raised.find((a) => a.id === "admin.external_changed")!.summary).toMatch(/primer cargo/);
    // Repetir: ya no hay decisión pendiente (y el hecho es único por versión y tipo de cambio)
    await expect(s.svc.decideFirstCharge(s.x.id, { firstChargeDate: "2027-01-01", reason: "Segundo intento que no procede" }, "operator:jorge")).rejects.toMatchObject({ code: "invalid_state" });
    await (s.svc as unknown as { notifyChanged: (...a: unknown[]) => Promise<void> }).notifyChanged(done, "first_charge", {}, "operator:jorge");
    await flush();
    expect(s.changed).toHaveLength(1);
    expect((await s.store.events(s.x.id)).filter((e) => e.kind === "changed")).toHaveLength(1);
    expect(s.raised.filter((a) => a.id === "admin.external_changed")).toHaveLength(1);
  });

  it("si la programación en Stripe falla, no se avisa de un cambio que no se ha completado", async () => {
    const s = await setup();
    await needsDecision(s);
    (s.gw as unknown as { createServiceSubscription: () => Promise<never> }).createServiceSubscription = async () => {
      throw new Error("fallo simulado");
    };
    await expect(s.svc.decideFirstCharge(s.x.id, { firstChargeDate: "2026-12-01", reason: "El cliente autorizó tarde: empezamos en diciembre" }, "operator:jorge")).rejects.toThrow();
    await flush();
    expect(s.changed).toHaveLength(0);
    expect(s.raised.some((a) => a.id === "admin.external_changed")).toBe(false);
  });

  it("nueva versión del contrato aceptada (había otra aceptada): aviso y alerta una vez; la primera aceptación no avisa", async () => {
    const s = await setup();
    expect(s.changed).toHaveLength(0); // la primera aceptación no es una modificación
    // Versión 2 del contrato (simulada en el almacén) y nueva aceptación
    const contract = (await s.crmStore.get("contracts", s.x.contractId))!;
    await s.crmStore.update("contracts", contract.id, { status: "sent", version: contract.version + 1, conditions: `${contract.conditions}\nAnexo: soporte ampliado.` });
    const cur = (await s.store.get(s.x.id))!;
    await s.store.update(cur.id, cur.version, { status: "awaiting_acceptance" }, T);
    const stripeBefore = s.gw.calls.length;
    const req = await s.svc.requestAcceptance(s.x.id, signer, "operator:test");
    expect(req.version).toBe(contract.version + 1);
    await s.svc.accept(new URL(req.url).searchParams.get("token")!, { name: "Laura Representante", accept: true }, { ip: null, userAgent: null });
    expect(s.gw.calls.length).toBe(stripeBefore);
    expect(s.changed).toHaveLength(1);
    expect(s.changed[0]).toMatchObject({ to: signer.email, i: { change: "contract_version", contractVersion: contract.version + 1, amountCents: 100_000 } });
    await flush();
    expect(s.raised.filter((a) => a.id === "admin.external_changed")).toHaveLength(1);
    expect((await s.store.events(s.x.id)).filter((e) => e.kind === "changed").map((e) => e.detail)).toEqual([expect.objectContaining({ change: "contract_version", before: { contractVersion: contract.version }, after: { contractVersion: contract.version + 1 } })]);
  });

  it("alerta: «changed» es admin.external_changed; el registro del correo no genera alerta", () => {
    const x = { id: 5, contractId: 1, companyId: 7, serviceName: "Servicio Ficticio", amountCents: 100_000, currency: "EUR", firstChargeAt: T } as never;
    const ids = (kind: string) => externalEventAlerts({ externalId: 5, kind, ref: "first_charge:v4", detail: { change: "first_charge", after: { firstChargeAt: T, status: "scheduled" }, reason: "Motivo de prueba" }, actor: "operator:1", at: T }, x, "Cliente Ficticio, S.L.", false).map((a) => a.id);
    expect(ids("changed")).toEqual(["admin.external_changed"]);
    expect(ids("changed_email")).toEqual([]);
  });

  it("plantilla: explica el cambio sin hablar de importes nuevos", () => {
    const c = extraTemplates.externalChanged({ companyName: "Cliente Ficticio SL", serviceName: "Servicio Demo", amountCents: 100_000, taxRateBp: 2100, currency: "EUR", effectiveAt: Date.UTC(2026, 11, 1, 7), signerName: "Laura", change: "first_charge", contractVersion: null });
    expect(c.subject).toBe("Cambios en tu servicio Servicio Demo");
    expect(c.text).toMatch(/primer cargo será el 1 de diciembre de 2026/);
    expect(c.text).toMatch(/La cuota no cambia/);
  });
});
