/**
 * Ampliación de la prueba gratuita → licencias del tenant. El Core calcula la prueba (fin y días restantes) del
 * `validUntil` de las licencias, que salen de la suscripción interna de la prueba: al ampliar (o reactivar) y en la
 * reconciliación periódica, la suscripción y sus licencias pasan al fin de la prueba del plano de control. Nunca se
 * tocan licencias de otro origen, de otras empresas ni suscripciones de pago.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { MemoryTrialStore } from "./trials/store";
import { TrialService } from "./trials/service";
import { TrialOnboardingService, type TrialNotifier } from "./trials/onboarding";
import { TrialLicenceReconciler, licenceSyncConfigFromEnv, LICENCE_SYNC_LOCK } from "./trials/licenceSync";
import { memoryLock } from "./trials/scheduler";
import { MemoryCapabilityStore } from "./_core/capabilities/store";
import { CapabilityAccess } from "./_core/capabilities/access";
import { LicensingService } from "./licensing/service";
import { seedElephantSource } from "./catalog/seed";
import { quoteCatalogFromSite } from "./catalog/snapshot";
import { WebAdminService } from "./web/service";
import { MemoryWebStore } from "./web/store";
import { BUILTIN_MODULES } from "./_core/modules/builtin";
import { MemorySubscriptionStore } from "./subscriptions/store";
import { SubscriptionService } from "./subscriptions/service";
import { catalogFromWebStore, type CrmPort } from "./subscriptions/ports";
import { buildSubscriptionOverview } from "./subscriptionOverview";

const DAY = 86_400_000;
// Como Skibox: alta el 19/10/2026 a las 13:50:33 UTC
const T0 = Date.UTC(2026, 9, 19, 13, 50, 33, 778);
let clock = T0;
let trials: TrialService;
let trialStore: MemoryTrialStore;
let caps: MemoryCapabilityStore;
let subs: SubscriptionService;
let subStore: MemorySubscriptionStore;
let licensing: LicensingService;
let onboarding: TrialOnboardingService;
let priceOf: (key: string) => Promise<number>;
const companies = new Map<string, number>();
let n = 0;

const notify: TrialNotifier = { verification: async () => undefined, welcome: async () => undefined, expiryNotice: async () => undefined };

beforeEach(async () => {
  clock = T0;
  companies.clear();
  const webStore = new MemoryWebStore();
  const web = new WebAdminService({ store: webStore, refs: { moduleIds: BUILTIN_MODULES.map((m) => m.id), planIds: () => null }, now: () => clock });
  await seedElephantSource(web, webStore);
  priceOf = async (key) => (await webStore.listPrices((await webStore.getEntry("product", key))!.id)).find((p) => p.status === "approved" && p.kind === "monthly")!.id;
  const crm: CrmPort = { company: async (id) => ({ id, name: `Empresa ${id}` }), contract: async () => null };
  subStore = new MemorySubscriptionStore();
  caps = new MemoryCapabilityStore();
  subs = new SubscriptionService({ store: subStore, catalog: catalogFromWebStore(webStore), crm, now: () => clock });
  licensing = new LicensingService({ capabilities: caps, subscriptions: subStore, crm, catalog: async () => quoteCatalogFromSite(await web.site("published")), now: () => clock });
  trialStore = new MemoryTrialStore();
  trials = new TrialService({ store: trialStore, now: () => clock, limits: { maxExtensions: 3, perIp24h: 1000, perDomain30d: 1000 } });
  onboarding = new TrialOnboardingService({
    trials,
    provision: async (req) => ({ tenantId: req.tenantId, status: "completed", completedSteps: [], domain: `${req.tenantId}.app.example`, adminInviteToken: "inv" }),
    platformDomain: "app.example",
    companies: {
      byTenant: async (tenantId) => (companies.has(tenantId) ? { id: companies.get(tenantId)! } : null),
      create: async (input) => {
        const id = companies.size + 1;
        companies.set(input.tenantId, id);
        return { id };
      },
    },
    subscriptions: subs,
    licensing,
    priceOf: async (key) => priceOf(key),
    notify,
    now: () => clock,
  });
});

/** Prueba de 15 días activada como en production (plataforma, empresa, suscripción interna y licencias). */
async function startTrial(company: string) {
  const r = await trials.register({ email: `info${n}@${company.toLowerCase().replace(/[^a-z]+/g, "-")}.es`, companyName: company, configuration: { plan: "essential", addons: [] }, idempotencyKey: `idem-ampliacion-${String(++n).padStart(8, "0")}` });
  await trials.verify(r.trial.id, r.verificationToken!);
  const out = await onboarding.activate(r.trial.id, "op");
  return { trial: await trials.must(r.trial.id), tenantId: out.tenantId, subscriptionId: out.subscriptionId };
}
const grantsOf = async (tenantId: string, subscriptionId: number) => (await caps.list(tenantId)).filter((g) => g.source === `subscription:${subscriptionId}`);
const overview = async (tenantId: string) => buildSubscriptionOverview({ mode: "multi", enforcing: true, grants: await caps.list(tenantId), now: clock });

describe("ampliación de la prueba → licencias", () => {
  it("prueba de 15 días: las licencias caducan al final de la prueba y el Core cuenta 15 días", async () => {
    const { trial, tenantId, subscriptionId } = await startTrial("Skibox");
    const g = await grantsOf(tenantId, subscriptionId);
    expect(g.length).toBeGreaterThan(0);
    // La suscripción se crea unos instantes después de fijar el fin: dentro de la tolerancia
    expect(Math.abs(g[0].validUntil! - trial.endsAt!)).toBeLessThanOrEqual(60_000);
    expect((await overview(tenantId)).trial?.daysLeft).toBe(15);
  });

  it("+5 días: suscripción y TODAS las licencias de la prueba pasan al nuevo fin; el tenant ve la fecha nueva", async () => {
    const { trial, tenantId, subscriptionId } = await startTrial("Skibox");
    clock = T0 + 14 * DAY; // 02/11, queda 1 día
    expect((await overview(tenantId)).trial?.daysLeft).toBe(1);
    const ext = await onboarding.approveExtension(trial.id, { expectedVersion: trial.version, days: 5, actor: "operator:jorge" });
    expect(ext.endsAt).toBe(trial.endsAt! + 5 * DAY);
    expect((await subs.must(subscriptionId)).trialEnd).toBe(ext.endsAt);
    const g = await grantsOf(tenantId, subscriptionId);
    expect(g.every((x) => x.validUntil === ext.endsAt && x.status === "active")).toBe(true);
    const o = await overview(tenantId);
    expect(o.trial).toEqual({ endsAt: ext.endsAt, daysLeft: 6 });
    expect(o.state).toBe("trial");
    // Historial de la suscripción: un cambio de fin con el anterior y el nuevo
    const ev = (await subStore.events(subscriptionId)).filter((e) => e.kind === "trial_end_changed");
    expect(ev).toHaveLength(1);
    expect(ev[0].after).toEqual({ trialEnd: ext.endsAt });
    // Historial de la prueba intacto
    expect((await trialStore.events(trial.id)).filter((e) => e.action === "approve_extension")).toHaveLength(1);
  });

  it("varias ampliaciones consecutivas: cada una mueve el fin; repetir la alineación no cambia nada", async () => {
    const { trial, tenantId, subscriptionId } = await startTrial("Hotel Uno");
    let t = trial;
    for (const days of [5, 3, 2]) {
      t = await onboarding.approveExtension(t.id, { expectedVersion: t.version, days, actor: "op" });
      expect((await grantsOf(tenantId, subscriptionId)).every((x) => x.validUntil === t.endsAt)).toBe(true);
    }
    expect(t.endsAt).toBe(trial.endsAt! + 10 * DAY);
    expect(await onboarding.syncLicences(t.id, "op")).toMatchObject({ outcome: "in_sync", licencesChanged: 0, subscriptionMoved: false });
  });

  it("el acceso del Core opera hasta el fin ampliado y pasa a solo lectura justo después (no antes)", async () => {
    const { trial, tenantId } = await startTrial("Skibox");
    clock = T0 + 14 * DAY;
    const ext = await onboarding.approveExtension(trial.id, { expectedVersion: trial.version, days: 5, actor: "op" });
    const at = (t: number) => new CapabilityAccess(caps, { enforce: true, now: () => t, ttlMs: 0 });
    // El fin original ya pasó: sigue operando
    expect((await at(trial.endsAt! + DAY).check("crm-leads", { write: true, tenantId })).allowed).toBe(true);
    expect((await at(ext.endsAt! - 1).check("crm-leads", { write: true, tenantId })).allowed).toBe(true);
    expect((await at(ext.endsAt! + 1).check("crm-leads", { write: true, tenantId })).allowed).toBe(false);
    expect((await at(ext.endsAt! + 1).check("crm-leads", { write: false, tenantId })).allowed).toBe(true);
  });

  it("días restantes: dependen solo del instante (UTC, Europe/Madrid y cambio de hora dan lo mismo)", async () => {
    // Alta el 20/10 (horario de verano) y fin tras el cambio de hora del 25/10
    clock = Date.UTC(2026, 9, 20, 8);
    const { trial, tenantId } = await startTrial("Cambio Hora");
    expect(trial.endsAt).toBe(Date.UTC(2026, 10, 4, 8));
    for (const [at, days] of [
      [Date.UTC(2026, 9, 26, 8), 9],
      [Date.UTC(2026, 10, 3, 8, 0, 0, 1), 1],
      [Date.UTC(2026, 10, 3, 7, 59), 2],
    ] as const) {
      clock = at;
      expect((await overview(tenantId)).trial?.daysLeft).toBe(days);
    }
    const prev = process.env.TZ;
    try {
      for (const tz of ["UTC", "Europe/Madrid"]) {
        process.env.TZ = tz;
        clock = Date.UTC(2026, 9, 26, 8);
        expect((await overview(tenantId)).trial?.daysLeft).toBe(9);
      }
    } finally {
      if (prev === undefined) delete process.env.TZ;
      else process.env.TZ = prev;
    }
  });

  it("reactivación tras ampliar: las licencias reaplicadas llevan el fin ampliado", async () => {
    const { trial, tenantId, subscriptionId } = await startTrial("Pausa");
    // Ampliación con la alineación caída (como antes de esta corrección): la suscripción conserva el fin antiguo
    const ext = await trials.approveExtension(trial.id, trial.version, 5, "op");
    const sus = await onboarding.suspend(trial.id, { reason: "Revisión de uso", expectedVersion: ext.version, actor: "op" });
    expect((await grantsOf(tenantId, subscriptionId)).every((x) => x.status === "suspended")).toBe(true);
    await onboarding.reactivate(trial.id, { expectedVersion: sus.version, actor: "op" });
    const g = await grantsOf(tenantId, subscriptionId);
    expect(g.every((x) => x.status === "active" && x.validUntil === ext.endsAt)).toBe(true);
  });

  it("la alineación no cambia estados: una licencia suspendida sigue suspendida con el nuevo fin", async () => {
    const { trial, tenantId, subscriptionId } = await startTrial("Mixta");
    await licensing.setStatus(tenantId, "crm-leads", "suspended", { actor: "op", reason: "Revisión puntual" });
    const ext = await onboarding.approveExtension(trial.id, { expectedVersion: trial.version, days: 4, actor: "op" });
    const leads = (await grantsOf(tenantId, subscriptionId)).find((g) => g.capabilityId === "crm-leads")!;
    expect(leads).toMatchObject({ status: "suspended", validUntil: ext.endsAt });
  });
});

describe("reconciliación periódica", () => {
  it("caso Skibox: prueba ampliada al 08/11 con licencias al 03/11 → el primer tick alinea; el segundo no hace nada", async () => {
    const { trial, tenantId, subscriptionId } = await startTrial("Skibox");
    clock = Date.UTC(2026, 10, 2, 10);
    // Ampliación aprobada con el código anterior: solo se movió el fin de la prueba
    const ext = await trials.approveExtension(trial.id, trial.version, 5, "operator:jorge");
    expect(new Date(ext.endsAt!).toISOString()).toBe("2026-11-08T13:50:33.778Z");
    const before = await overview(tenantId);
    expect(before.trial?.daysLeft).toBe(2);
    expect(new Date(before.trial!.endsAt).toISOString().slice(0, 10)).toBe("2026-11-03");

    const logs: Array<[string, Record<string, unknown>]> = [];
    const rec = new TrialLicenceReconciler({ store: trialStore, sync: () => (id, actor) => onboarding.syncLicences(id, actor), lock: memoryLock(), now: () => clock, log: (_l, e, d) => void logs.push([e, d]) });
    const first = await rec.tick();
    expect(first).toMatchObject({ skipped: null, checked: 1, aligned: 1, errors: 0 });
    expect((await grantsOf(tenantId, subscriptionId)).every((g) => g.validUntil === ext.endsAt)).toBe(true);
    expect((await subs.must(subscriptionId)).trialEnd).toBe(ext.endsAt);
    const after = await overview(tenantId);
    expect(after.trial).toEqual({ endsAt: ext.endsAt, daysLeft: 7 });
    expect(logs.find(([e]) => e === "licence_sync_tick")?.[1]).toMatchObject({ aligned: 1, alignedTrials: [trial.id] });

    expect(await rec.tick()).toMatchObject({ checked: 1, aligned: 0, errors: 0 });
  });

  it("aislamiento: solo se tocan las licencias de la suscripción de cada prueba; otras empresas, operador y pago intactos", async () => {
    const a = await startTrial("Empresa A");
    const b = await startTrial("Empresa B");
    // Licencia de operador (módulo) en A y suscripción de pago en otra empresa
    await caps.apply(a.tenantId, [{ capabilityId: "people-hr", siteId: "", status: "active", validUntil: Date.UTC(2027, 0, 1), source: "operator" }], { actor: "op", reason: null, now: clock });
    companies.set("pago", 99);
    const paid = await subs.create({ companyId: 99, tenantId: "pago", interval: "month", plan: { productKey: "business", priceId: await priceOf("business") } }, "op");
    await licensing.apply(paid.id, { activate: true, actor: "op" });
    const paidBefore = await caps.list("pago");
    const bBefore = await caps.list(b.tenantId);

    const ext = await trials.approveExtension(a.trial.id, a.trial.version, 5, "op");
    const rec = new TrialLicenceReconciler({ store: trialStore, sync: () => (id, actor) => onboarding.syncLicences(id, actor), lock: memoryLock(), now: () => clock, log: () => undefined });
    expect(await rec.tick()).toMatchObject({ checked: 2, aligned: 1, errors: 0 });

    expect((await grantsOf(a.tenantId, a.subscriptionId)).every((g) => g.validUntil === ext.endsAt)).toBe(true);
    expect((await caps.list(a.tenantId)).find((g) => g.source === "operator")).toMatchObject({ capabilityId: "people-hr", validUntil: Date.UTC(2027, 0, 1) });
    expect(await caps.list(b.tenantId)).toEqual(bBefore);
    expect(await caps.list("pago")).toEqual(paidBefore);
    expect((await subs.must(paid.id))).toMatchObject({ status: "active", trialEnd: null, version: paid.version });
    expect((await subs.must(b.subscriptionId)).version).toBe(1);
  });

  it("si la alineación falla al aprobar, la ampliación queda hecha y la reconciliación la completa", async () => {
    const { trial, tenantId, subscriptionId } = await startTrial("Falla");
    const real = licensing.syncValidUntil.bind(licensing);
    licensing.syncValidUntil = async () => Promise.reject(new Error("registro caído"));
    const ext = await onboarding.approveExtension(trial.id, { expectedVersion: trial.version, days: 5, actor: "op" });
    expect(ext.endsAt).toBe(trial.endsAt! + 5 * DAY);
    expect((await grantsOf(tenantId, subscriptionId)).some((g) => g.validUntil !== ext.endsAt)).toBe(true);
    licensing.syncValidUntil = real;
    const rec = new TrialLicenceReconciler({ store: trialStore, sync: () => (id, actor) => onboarding.syncLicences(id, actor), lock: memoryLock(), now: () => clock, log: () => undefined });
    expect(await rec.tick()).toMatchObject({ aligned: 1, errors: 0 });
    expect((await grantsOf(tenantId, subscriptionId)).every((g) => g.validUntil === ext.endsAt)).toBe(true);
  });

  it("pruebas convertidas, sin plataforma o con la suscripción ya de pago: no se tocan", async () => {
    const { trial, subscriptionId } = await startTrial("Convertida");
    const sub = await subs.must(subscriptionId);
    await subs.endTrial(subscriptionId, { reason: "pago" }, sub.version, "op");
    const ext = await trials.approveExtension(trial.id, trial.version, 5, "op");
    expect(await onboarding.syncLicences(ext.id, "op")).toMatchObject({ outcome: "skipped", reason: "no_trial_subscription" });
    expect((await subs.must(subscriptionId))).toMatchObject({ status: "active", trialEnd: null });
  });

  it("exclusión entre réplicas, sin servicio montado no hace nada; encendida por defecto y apagable", async () => {
    const lock = memoryLock();
    lock.held.add(LICENCE_SYNC_LOCK);
    const rec = new TrialLicenceReconciler({ store: trialStore, sync: () => async () => ({ trialId: 0, tenantId: null, outcome: "in_sync" }), lock, log: () => undefined });
    expect((await rec.tick()).skipped).toBe("locked");
    const none = new TrialLicenceReconciler({ store: trialStore, sync: () => null, lock: memoryLock(), log: () => undefined });
    expect((await none.tick()).skipped).toBe("unavailable");
    expect(licenceSyncConfigFromEnv({})).toEqual({ enabled: true, intervalMs: 300_000 });
    expect(licenceSyncConfigFromEnv({ CP_TRIAL_LICENCE_SYNC: "off", CP_TRIAL_LICENCE_SYNC_SECONDS: "5" })).toEqual({ enabled: false, intervalMs: 60_000 });
  });
});
