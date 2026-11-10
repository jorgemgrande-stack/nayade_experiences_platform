/**
 * Incidencia Skibox (10/11/2026): estado efectivo de la prueba por fecha y ampliación ADMINISTRATIVA desde el CRM.
 *
 * Caso real reproducido: prueba #5 de t5-skibox, alta el 19/10/2026 13:50:33 UTC, +5 días aprobados el 02/11 (fin el
 * 08/11/2026 13:50:33 UTC = 14:50 en España), con la única ampliación de autoservicio ya usada. La tarea programada
 * se salta Skibox (exenta), así que la prueba sigue «active» y la suscripción «trialing» aunque haya vencido; las
 * licencias caducaron el 08/11 y el tenant está en consulta. Sin red, sin Stripe y sin cobros.
 */
import { describe, it, expect, beforeEach } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { MemoryTrialStore } from "./trials/store";
import { TrialService } from "./trials/service";
import { TrialOnboardingService, type TrialNotifier, type TrialStatusNotice } from "./trials/onboarding";
import { TrialLicenceReconciler } from "./trials/licenceSync";
import { TrialScheduler, memoryLock } from "./trials/scheduler";
import { effectiveTrialState } from "./trials/machine";
import { decodeAdminExtensionDetail, madridDay, madridEndOfDay, planAdminExtension } from "./trials/adminExtension";
import { createTrialAdminRouter } from "./trials/api";
import { authenticate, hashToken } from "./controlPlane/auth";
import { MemoryCapabilityStore } from "./_core/capabilities/store";
import { CapabilityAccess } from "./_core/capabilities/access";
import { LicensingService } from "./licensing/service";
import { seedElephantSource } from "./catalog/seed";
import { quoteCatalogFromSite } from "./catalog/snapshot";
import { WebAdminService } from "./web/service";
import { MemoryWebStore } from "./web/store";
import { BUILTIN_MODULES } from "./_core/modules/builtin";
import { MemorySubscriptionStore } from "./subscriptions/store";
import { SubscriptionService, subscriptionEffective } from "./subscriptions/service";
import { catalogFromWebStore, type CrmPort } from "./subscriptions/ports";
import { buildSubscriptionOverview } from "./subscriptionOverview";

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 9, 19, 13, 50, 33, 778);
const SKIBOX_END = Date.UTC(2026, 10, 8, 13, 50, 33, 778);
const TODAY = Date.UTC(2026, 10, 10, 9, 0); // 10/11/2026 10:00 en España
let clock = T0;
let trials: TrialService;
let trialStore: MemoryTrialStore;
let caps: MemoryCapabilityStore;
let subs: SubscriptionService;
let subStore: MemorySubscriptionStore;
let onboarding: TrialOnboardingService;
let notices: TrialStatusNotice[];
const companies = new Map<string, number>();
let n = 0;

beforeEach(async () => {
  clock = T0;
  companies.clear();
  notices = [];
  const webStore = new MemoryWebStore();
  const web = new WebAdminService({ store: webStore, refs: { moduleIds: BUILTIN_MODULES.map((m) => m.id), planIds: () => null }, now: () => clock });
  await seedElephantSource(web, webStore);
  const priceOf = async (key: string) => (await webStore.listPrices((await webStore.getEntry("product", key))!.id)).find((p) => p.status === "approved" && p.kind === "monthly")!.id;
  const crm: CrmPort = { company: async (id) => ({ id, name: `Empresa ${id}` }), contract: async () => null };
  subStore = new MemorySubscriptionStore();
  caps = new MemoryCapabilityStore();
  subs = new SubscriptionService({ store: subStore, catalog: catalogFromWebStore(webStore), crm, now: () => clock });
  const licensing = new LicensingService({ capabilities: caps, subscriptions: subStore, crm, catalog: async () => quoteCatalogFromSite(await web.site("published")), now: () => clock });
  trialStore = new MemoryTrialStore();
  // Límites de production: UNA ampliación de autoservicio de hasta 15 días
  trials = new TrialService({ store: trialStore, now: () => clock, limits: { perIp24h: 1000, perDomain30d: 1000 } });
  const notify: TrialNotifier = {
    verification: async () => undefined,
    welcome: async () => undefined,
    expiryNotice: async () => undefined,
    statusNotice: async (_to, info) => void notices.push(info),
  };
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
    priceOf,
    notify,
    now: () => clock,
  });
});

async function startTrial(company: string) {
  const r = await trials.register({ email: `info${n}@${company.toLowerCase().replace(/[^a-z]+/g, "-")}.es`, companyName: company, configuration: { plan: "essential", addons: [] }, idempotencyKey: `idem-admin-ext-${String(++n).padStart(8, "0")}` });
  await trials.verify(r.trial.id, r.verificationToken!);
  const out = await onboarding.activate(r.trial.id, "op");
  return { trial: await trials.must(r.trial.id), tenantId: out.tenantId, subscriptionId: out.subscriptionId };
}

/** Skibox tal cual está en production el 10/11/2026 (con el derecho adquirido del TPV). */
async function skiboxToday() {
  clock = T0;
  const s = await startTrial("Skibox");
  clock = Date.UTC(2026, 10, 2, 22, 15);
  const ext = await onboarding.approveExtension(s.trial.id, { expectedVersion: s.trial.version, days: 5, actor: "operator:jorge" });
  expect(ext.endsAt).toBe(SKIBOX_END);
  await caps.apply(s.tenantId, [{ capabilityId: "tpv-acquired-rights", siteId: "", status: "active", validUntil: null, source: "acquired:tpv-2026-11-10" }], { actor: "op", reason: "Derecho adquirido", now: clock });
  clock = TODAY;
  notices = [];
  return { ...s, trial: await trials.must(s.trial.id) };
}

const grantsOf = async (tenantId: string, subscriptionId: number) => (await caps.list(tenantId)).filter((g) => g.source === `subscription:${subscriptionId}`);
const overview = async (tenantId: string) => buildSubscriptionOverview({ mode: "multi", enforcing: true, grants: await caps.list(tenantId), now: clock });
const canWrite = async (tenantId: string) => (await new CapabilityAccess(caps, { enforce: true, now: () => clock, ttlMs: 0 }).check("crm-leads", { write: true, tenantId })).allowed;
const key = (s: string) => `clave-${s}-0001`;

describe("estado efectivo por fecha (sin depender de la tarea programada)", () => {
  it("prueba activa: activa en la prueba, la suscripción y el tenant; la renovación es el fin de la prueba", async () => {
    const { trial, tenantId, subscriptionId } = await startTrial("Activa");
    clock = T0 + 3 * DAY;
    expect(TrialService.view(trial, clock).effectiveState).toBe("active");
    const sub = await subs.must(subscriptionId);
    expect(subscriptionEffective(sub, clock)).toMatchObject({ status: "trialing", nextRenewalAt: sub.trialEnd, trialEndsAt: sub.trialEnd });
    expect((await overview(tenantId)).state).toBe("trial");
  });

  it("caso Skibox: guardada «active»/«trialing» pero vencida el 08/11 14:50 (España); CRM y tenant coinciden", async () => {
    const { trial, tenantId, subscriptionId } = await skiboxToday();
    // La tarea programada se salta Skibox (exenta): nada cambia lo guardado…
    const sched = new TrialScheduler({ store: trialStore, notify: { expiryNotice: async () => undefined }, lock: memoryLock(), now: () => clock, exempt: new Set([tenantId]), log: () => undefined });
    expect((await sched.tick()).expired).toBe(0);
    expect((await trials.must(trial.id)).state).toBe("active");
    // …pero el estado efectivo es vencido en todas partes, con la misma fecha
    expect(effectiveTrialState(trial, clock)).toBe("expired");
    expect(TrialService.view(trial, clock).effectiveState).toBe("expired");
    const sub = await subs.must(subscriptionId);
    expect(sub.status).toBe("trialing");
    const eff = subscriptionEffective(sub, clock);
    expect(eff).toMatchObject({ status: "trial_expired", trialEndsAt: SKIBOX_END, nextRenewalAt: SKIBOX_END });
    // La «próxima renovación 19/11» del CRM era el fin del periodo mensual simulado, no la prueba
    expect(new Date(sub.currentPeriodEnd).toISOString().slice(0, 10)).toBe("2026-11-19");
    const o = await overview(tenantId);
    expect(o.state).toBe("trial_expired");
    expect(o.trial?.endsAt).toBe(SKIBOX_END);
    expect(madridDay(SKIBOX_END)).toBe("2026-11-08");
    expect(await canWrite(tenantId)).toBe(false);
    // La ampliación de autoservicio ya no vale (una sola)
    await expect(trials.approveExtension(trial.id, trial.version, 5, "op")).rejects.toThrow(/ampliaciones permitidas/);
  });

  it("una suscripción cancelada o con baja programada no muestra renovación", () => {
    expect(subscriptionEffective({ status: "canceled", trialEnd: null, currentPeriodEnd: TODAY, cancelAt: null }, TODAY).nextRenewalAt).toBeNull();
    expect(subscriptionEffective({ status: "active", trialEnd: null, currentPeriodEnd: TODAY + DAY, cancelAt: TODAY + DAY }, TODAY).nextRenewalAt).toBeNull();
    expect(subscriptionEffective({ status: "active", trialEnd: null, currentPeriodEnd: TODAY + DAY, cancelAt: null }, TODAY)).toMatchObject({ status: "active", nextRenewalAt: TODAY + DAY });
  });
});

describe("ampliación administrativa", () => {
  it("después de vencer (Skibox): nueva fecha en hora de España; licencias, suscripción y tenant vuelven a operar", async () => {
    const { trial, tenantId, subscriptionId } = await skiboxToday();
    const tpvBefore = (await caps.list(tenantId)).find((g) => g.capabilityId === "tpv-acquired-rights");
    const subsBefore = (await subStore.list()).length;
    const itemsBefore = await subStore.items(subscriptionId);
    const preview = trials.planAdminExtension(trial, { until: "2026-11-30" });
    expect(preview.before).toBe(SKIBOX_END);
    expect(preview.after).toBe(Date.UTC(2026, 10, 30, 22, 59, 59)); // 30/11 23:59:59 en España (UTC+1)

    const r = await onboarding.adminExtend(trial.id, { expectedVersion: trial.version, input: { until: "2026-11-30" }, reason: "Ampliación pactada con el cliente", idempotencyKey: key("a"), actor: "operator:jorge" });
    expect(r).toMatchObject({ result: "applied", replayed: false, before: SKIBOX_END, after: preview.after });
    expect(r.licences).toMatchObject({ outcome: "aligned", subscriptionMoved: true });
    expect(r.trial).toMatchObject({ state: "active", endsAt: preview.after, extensionsUsed: 1 }); // no consume el autoservicio
    expect(madridDay(r.trial.endsAt!)).toBe("2026-11-30");

    expect((await subs.must(subscriptionId))).toMatchObject({ status: "trialing", trialEnd: preview.after });
    expect((await grantsOf(tenantId, subscriptionId)).every((g) => g.status === "active" && g.validUntil === preview.after)).toBe(true);
    // Recarga del panel: estado y fecha nuevos, opera sin esperar a ninguna renovación
    const o = await overview(tenantId);
    expect(o.state).toBe("trial");
    expect(o.trial).toEqual({ endsAt: preview.after, daysLeft: 21 });
    expect(await canWrite(tenantId)).toBe(true);
    expect(subscriptionEffective(await subs.must(subscriptionId), clock)).toMatchObject({ status: "trialing", nextRenewalAt: preview.after });

    // Auditoría: operador, fecha, motivo, fin anterior y nuevo
    const ev = (await trialStore.events(trial.id)).filter((e) => e.action === "admin_extend");
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ actor: "operator:jorge", createdAt: TODAY, fromState: "active", toState: "active" });
    expect(decodeAdminExtensionDetail(ev[0].detail)).toEqual({ before: SKIBOX_END, after: preview.after, days: preview.days, key: key("a"), reason: "Ampliación pactada con el cliente" });
    // Resultado auditado aparte (la ampliación nunca se sobrescribe)
    const res = (await trialStore.events(trial.id)).filter((e) => e.action === "admin_extend_result");
    expect(res.map((e) => JSON.parse(e.detail!))).toEqual([expect.objectContaining({ key: key("a"), result: "applied", subscriptionId })]);
    expect(ev[0].detail!.length).toBeLessThanOrEqual(300);

    // Derechos adquiridos y resto intactos; sin segunda suscripción, sin cambio de precio, sin cobros ni facturas
    expect((await caps.list(tenantId)).find((g) => g.capabilityId === "tpv-acquired-rights")).toEqual(tpvBefore);
    expect((await subStore.list()).length).toBe(subsBefore);
    expect(await subStore.items(subscriptionId)).toEqual(itemsBefore);
    expect(await subStore.shadowInvoices(subscriptionId)).toEqual([]);
    // Sin aviso al cliente salvo que se pida
    expect(notices).toEqual([]);
  });

  it("sobre una prueba ya marcada «expired» la vuelve a «active»", async () => {
    const { trial, tenantId } = await startTrial("Vencida");
    clock = trial.endsAt! + DAY;
    const exp = await onboarding.expire(trial.id, "op");
    expect(exp.state).toBe("expired");
    const r = await onboarding.adminExtend(trial.id, { expectedVersion: exp.version, input: { days: 10 }, reason: "Segunda oportunidad", idempotencyKey: key("b"), actor: "op" });
    expect(r.trial).toMatchObject({ state: "active", endsAt: clock + 10 * DAY });
    expect(await canWrite(tenantId)).toBe(true);
  });

  it("antes de vencer: los días se suman al fin actual", async () => {
    const { trial, tenantId, subscriptionId } = await startTrial("Antes");
    clock = T0 + 5 * DAY;
    const r = await onboarding.adminExtend(trial.id, { expectedVersion: trial.version, input: { days: 7 }, reason: "Evaluación más larga", idempotencyKey: key("c"), notify: true, actor: "op" });
    expect(r.after).toBe(trial.endsAt! + 7 * DAY);
    expect((await grantsOf(tenantId, subscriptionId)).every((g) => g.validUntil === r.after)).toBe(true);
    expect(notices).toEqual([expect.objectContaining({ trialId: trial.id, kind: "extended", endsAt: r.after })]);
  });

  it("reintento de la misma operación (misma clave, versión ya cambiada): no amplía dos veces ni avisa dos veces", async () => {
    const { trial, tenantId, subscriptionId } = await skiboxToday();
    const input = { expectedVersion: trial.version, input: { days: 10 }, reason: "Reintento tras corte", idempotencyKey: key("d"), notify: true, actor: "op" } as const;
    const first = await onboarding.adminExtend(trial.id, input);
    const again = await onboarding.adminExtend(trial.id, input);
    expect(again).toMatchObject({ replayed: true, before: first.before, after: first.after });
    expect(again.trial.endsAt).toBe(first.after);
    expect((await trialStore.events(trial.id)).filter((e) => e.action === "admin_extend")).toHaveLength(1);
    expect(notices).toHaveLength(1);
    expect((await grantsOf(tenantId, subscriptionId)).every((g) => g.validUntil === first.after)).toBe(true);
    // Otra clave con la versión antigua: conflicto (nunca pisa el cambio de otra persona)
    await expect(onboarding.adminExtend(trial.id, { ...input, idempotencyKey: key("e") })).rejects.toMatchObject({ code: "conflict" });
  });

  it("si la alineación falla, la ampliación queda hecha y el reintento con la misma clave la completa", async () => {
    const { trial, tenantId, subscriptionId } = await skiboxToday();
    const lic = (onboarding as unknown as { d: { licensing: LicensingService } }).d.licensing;
    const real = lic.syncValidUntil.bind(lic);
    lic.syncValidUntil = async () => Promise.reject(new Error("registro caído"));
    const input = { expectedVersion: trial.version, input: { until: "2026-11-20" }, reason: "Corte de comunicación", idempotencyKey: key("f"), actor: "op" } as const;
    const first = await onboarding.adminExtend(trial.id, input);
    // No se informa de éxito: queda pendiente (y anotado) para reintento
    expect(first.licences).toBeNull();
    expect(first.result).toBe("pending");
    expect(await canWrite(tenantId)).toBe(false);
    lic.syncValidUntil = real;
    const again = await onboarding.adminExtend(trial.id, input);
    expect(again.replayed).toBe(true);
    expect(again.result).toBe("applied");
    expect(again.licences).toMatchObject({ outcome: "aligned" });
    expect((await trialStore.events(trial.id)).filter((e) => e.action === "admin_extend_result").map((e) => JSON.parse(e.detail!).result)).toEqual(["pending", "applied"]);
    expect((await trialStore.events(trial.id)).filter((e) => e.action === "admin_extend")).toHaveLength(1);
    expect((await grantsOf(tenantId, subscriptionId)).every((g) => g.validUntil === first.after)).toBe(true);
    expect(await canWrite(tenantId)).toBe(true);
  });

  it("después de ampliar, ninguna tarea automática vuelve a la fecha antigua; al nuevo fin vence con normalidad", async () => {
    const { trial, tenantId, subscriptionId } = await startTrial("Tareas");
    clock = trial.endsAt! + 2 * DAY;
    const r = await onboarding.adminExtend(trial.id, { expectedVersion: trial.version, input: { days: 5 }, reason: "Pruebas del scheduler", idempotencyKey: key("g"), actor: "op" });
    const sched = new TrialScheduler({ store: trialStore, notify: { expiryNotice: async () => undefined }, lock: memoryLock(), now: () => clock, exempt: new Set(), log: () => undefined });
    const rec = new TrialLicenceReconciler({ store: trialStore, sync: () => (id, actor) => onboarding.syncLicences(id, actor), lock: memoryLock(), now: () => clock, log: () => undefined });
    for (let i = 0; i < 3; i++) {
      expect((await sched.tick()).expired).toBe(0);
      expect(await rec.tick()).toMatchObject({ aligned: 0, errors: 0 });
    }
    expect((await trials.must(trial.id)).endsAt).toBe(r.after);
    expect((await subs.must(subscriptionId)).trialEnd).toBe(r.after);
    expect((await grantsOf(tenantId, subscriptionId)).every((g) => g.validUntil === r.after)).toBe(true);
    clock = r.after + 1;
    expect((await sched.tick()).expired).toBe(1);
    expect((await trials.must(trial.id)).endsAt).toBe(r.after);
    expect(await canWrite(tenantId)).toBe(false);
  });

  it("aislamiento: solo cambia la empresa ampliada", async () => {
    const a = await startTrial("Empresa A");
    const b = await startTrial("Empresa B");
    const bGrants = await caps.list(b.tenantId);
    const bSub = await subs.must(b.subscriptionId);
    const bTrial = await trials.must(b.trial.id);
    await onboarding.adminExtend(a.trial.id, { expectedVersion: a.trial.version, input: { days: 3 }, reason: "Solo la empresa A", idempotencyKey: key("h"), actor: "op" });
    expect(await caps.list(b.tenantId)).toEqual(bGrants);
    expect(await subs.must(b.subscriptionId)).toEqual(bSub);
    expect(await trials.must(b.trial.id)).toEqual(bTrial);
  });

  it("validaciones técnicas: no acorta, no al pasado, fecha válida (antes de 2100), motivo y clave obligatorios, no en suspendidas", async () => {
    const { trial } = await skiboxToday();
    const base = { expectedVersion: trial.version, reason: "Motivo suficiente", idempotencyKey: key("i"), actor: "op" };
    await expect(onboarding.adminExtend(trial.id, { ...base, input: { until: "2026-11-09" } })).rejects.toMatchObject({ code: "invalid_input" }); // ya pasado
    await expect(onboarding.adminExtend(trial.id, { ...base, input: { until: "2026-02-30" } })).rejects.toMatchObject({ code: "invalid_input" });
    await expect(onboarding.adminExtend(trial.id, { ...base, input: { until: "2100-01-01" } })).rejects.toMatchObject({ code: "invalid_input" });
    await expect(onboarding.adminExtend(trial.id, { ...base, input: { until: "2026-12-01T24:00" } })).rejects.toMatchObject({ code: "invalid_input" });
    await expect(onboarding.adminExtend(trial.id, { ...base, input: { days: 0 } })).rejects.toMatchObject({ code: "invalid_input" });
    await expect(onboarding.adminExtend(trial.id, { ...base, reason: "no", input: { days: 3 } })).rejects.toMatchObject({ code: "invalid_input" });
    await expect(onboarding.adminExtend(trial.id, { ...base, idempotencyKey: "x", input: { days: 3 } })).rejects.toMatchObject({ code: "invalid_input" });
    // No acorta una prueba vigente
    const c = await startTrial("Vigente");
    await expect(onboarding.adminExtend(c.trial.id, { ...base, expectedVersion: c.trial.version, input: { until: madridDay(TODAY + DAY) } })).rejects.toThrow(/posterior a la actual/);
    // Suspendida: primero se reactiva
    const s = await startTrial("Suspendida");
    const sus = await onboarding.suspend(s.trial.id, { reason: "Revisión de uso", expectedVersion: s.trial.version, actor: "op" });
    await expect(onboarding.adminExtend(s.trial.id, { ...base, expectedVersion: sus.version, input: { days: 3 } })).rejects.toMatchObject({ code: "invalid_state" });
    expect((await trialStore.events(trial.id)).some((e) => e.action === "admin_extend")).toBe(false);
  });

  it("sin límites: 1.ª, 2.ª, 3.ª… ampliaciones sucesivas, sin contador, con el autoservicio agotado y duración larga", async () => {
    const { trial, tenantId, subscriptionId } = await skiboxToday();
    let t = trial;
    const ends: number[] = [];
    for (let i = 1; i <= 6; i++) {
      const r = await onboarding.adminExtend(t.id, { expectedVersion: t.version, input: { days: i === 6 ? 400 : 30 }, reason: `Ampliación número ${i}`, idempotencyKey: key(`n${i}`), actor: "operator:jorge" });
      expect(r.result).toBe("applied");
      ends.push(r.after);
      t = r.trial;
    }
    expect(ends[0]).toBe(TODAY + 30 * DAY);
    for (let i = 1; i < 5; i++) expect(ends[i]).toBe(ends[i - 1] + 30 * DAY);
    expect(ends[5]).toBe(ends[4] + 400 * DAY); // más de un año acumulado: sin tope
    expect(t.extensionsUsed).toBe(1); // el cupo del autoservicio no se toca
    const ev = (await trialStore.events(t.id)).filter((e) => e.action === "admin_extend").map((e) => decodeAdminExtensionDetail(e.detail)!);
    expect(ev.map((d) => d.after)).toEqual(ends); // ninguna se sobrescribe
    expect(ev[0].before).toBe(SKIBOX_END);
    for (let i = 1; i < ev.length; i++) expect(ev[i].before).toBe(ev[i - 1].after);
    // Una licencia por capacidad, sin duplicados, todas hasta el último fin
    const g = await grantsOf(tenantId, subscriptionId);
    expect(new Set(g.map((x) => x.capabilityId)).size).toBe(g.length);
    expect(g.every((x) => x.status === "active" && x.validUntil === ends[5])).toBe(true);
  });

  it("por fecha y hora (hora de España)", async () => {
    const { trial } = await skiboxToday();
    const r = await onboarding.adminExtend(trial.id, { expectedVersion: trial.version, input: { until: "2026-11-25T18:30" }, reason: "Hasta la tarde del 25", idempotencyKey: key("fh"), actor: "op" });
    expect(r.after).toBe(Date.UTC(2026, 10, 25, 17, 30));
    expect(r.days).toBe(15.35);
  });

  it("reactivación real: licencias del plan en solo lectura por el vencimiento vuelven a activas; suspendidas, canceladas y TPV intactas", async () => {
    const { trial, tenantId, subscriptionId } = await skiboxToday();
    const lic = (onboarding as unknown as { d: { licensing: LicensingService } }).d.licensing;
    await lic.setStatus(tenantId, "crm-leads", "read_only", { actor: "op", reason: "Fin de la prueba" });
    await lic.setStatus(tenantId, "bill-cash", "read_only", { actor: "op", reason: "Fin de la prueba" });
    await lic.setStatus(tenantId, "cms-blog", "suspended", { actor: "op", reason: "Bloqueo por otro motivo" });
    await lic.setStatus(tenantId, "cms-seo", "cancelled", { actor: "op", reason: "Baja decidida por un operador" });
    const tpv = (await caps.list(tenantId)).find((g) => g.capabilityId === "tpv-acquired-rights");
    const r = await onboarding.adminExtend(trial.id, { expectedVersion: trial.version, input: { days: 10 }, reason: "Reactivar la prueba", idempotencyKey: key("ro"), actor: "op" });
    expect(r.result).toBe("applied");
    const g = await grantsOf(tenantId, subscriptionId);
    expect(g.find((x) => x.capabilityId === "crm-leads")).toMatchObject({ status: "active", validUntil: r.after });
    expect(g.find((x) => x.capabilityId === "bill-cash")).toMatchObject({ status: "active", validUntil: r.after });
    expect(g.find((x) => x.capabilityId === "cms-blog")).toMatchObject({ status: "suspended" });
    expect(g.find((x) => x.capabilityId === "cms-seo")).toMatchObject({ status: "cancelled" });
    expect((await caps.list(tenantId)).find((x) => x.capabilityId === "tpv-acquired-rights")).toEqual(tpv);
    expect(await canWrite(tenantId)).toBe(true);
    expect((await overview(tenantId)).state).toBe("trial");
  });

  it("no reactiva una suscripción cancelada ni ya de pago: se rechaza sin cambiar nada", async () => {
    const a = await startTrial("Cancelada");
    const sa = await subs.must(a.subscriptionId);
    await subs.scheduleCancel(a.subscriptionId, { reason: "Baja del cliente" }, sa.version, "op");
    clock = (await subs.must(a.subscriptionId)).currentPeriodEnd + 1;
    await subs.applyRenewals(a.subscriptionId, "op");
    expect((await subs.must(a.subscriptionId)).status).toBe("canceled");
    const ta = await trials.must(a.trial.id);
    await expect(onboarding.adminExtend(ta.id, { expectedVersion: ta.version, input: { days: 5 }, reason: "No debe reactivar", idempotencyKey: key("ca"), actor: "op" })).rejects.toThrow(/cancelada/);
    expect(await trials.must(ta.id)).toEqual(ta);
    const b = await startTrial("Pagada");
    const sb = await subs.must(b.subscriptionId);
    await subs.endTrial(b.subscriptionId, { reason: "pago" }, sb.version, "op");
    await expect(onboarding.adminExtend(b.trial.id, { expectedVersion: b.trial.version, input: { days: 5 }, reason: "Ya es de pago", idempotencyKey: key("cb"), actor: "op" })).rejects.toThrow(/ya no está en prueba/);
  });

  it("concurrencia: dos administradores a la vez → una ampliación y un conflicto; la misma operación duplicada → una sola", async () => {
    const { trial } = await skiboxToday();
    const two = await Promise.allSettled([
      onboarding.adminExtend(trial.id, { expectedVersion: trial.version, input: { days: 5 }, reason: "Administrador A", idempotencyKey: key("ca1"), actor: "operator:a" }),
      onboarding.adminExtend(trial.id, { expectedVersion: trial.version, input: { days: 9 }, reason: "Administrador B", idempotencyKey: key("cb1"), actor: "operator:b" }),
    ]);
    expect(two.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect(two.filter((x) => x.status === "rejected").map((x) => (x as PromiseRejectedResult).reason.code)).toEqual(["conflict"]);
    const t = await trials.must(trial.id);
    const same = { expectedVersion: t.version, input: { days: 3 }, reason: "Doble clic", idempotencyKey: key("dup"), actor: "op" } as const;
    const dup = await Promise.all([onboarding.adminExtend(t.id, same), onboarding.adminExtend(t.id, same)]);
    expect(dup.map((d) => d.after)).toEqual([dup[0].after, dup[0].after]);
    expect((await trialStore.events(t.id)).filter((e) => e.action === "admin_extend")).toHaveLength(2);
  });

  it("fechas en hora de España, también con el cambio de hora", () => {
    expect(madridEndOfDay("2026-07-15")).toBe(Date.UTC(2026, 6, 15, 21, 59, 59)); // verano, UTC+2
    expect(madridEndOfDay("2026-10-25")).toBe(Date.UTC(2026, 9, 25, 22, 59, 59)); // día del cambio, ya UTC+1
    expect(madridDay(Date.UTC(2026, 10, 8, 23, 30))).toBe("2026-11-09");
    expect(planAdminExtension({ endsAt: null }, { days: 2 }, TODAY).after).toBe(TODAY + 2 * DAY);
  });
});

describe("rutas del plano de control", () => {
  async function serve(scopes: string[], actorType: "operator" | "crm" = "operator") {
    const token = "token-de-prueba-ampliacion-0123456789";
    const app = express();
    app.use(express.json());
    app.use(authenticate([{ id: actorType === "operator" ? "jorge" : "crm", sha256: hashToken(token), scopes, actorType } as never]));
    app.use("/trials", createTrialAdminRouter({ onboarding, trials, store: trialStore }));
    const server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/trials`;
    const call = async (method: string, path: string, body?: unknown) => {
      const res = await fetch(base + path, { method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
      return { status: res.status, body: (await res.json()) as Record<string, unknown> };
    };
    return { call, close: () => new Promise<void>((r) => server.close(() => r())) };
  }

  it("vista previa (fecha actual y nueva), ampliación con permisos y estado efectivo en el listado", async () => {
    const { trial } = await skiboxToday();
    const realNow = Date.now;
    Date.now = () => clock;
    const s = await serve(["subscriptions:read", "subscriptions:write", "entitlements:write"]);
    try {
      const list = await s.call("GET", "/");
      expect((list.body.trials as Array<Record<string, unknown>>).find((t) => t.id === trial.id)).toMatchObject({ state: "active", effectiveState: "expired" });
      const pv = await s.call("GET", `/${trial.id}/admin-extension/preview?until=2026-11-30`);
      expect(pv).toMatchObject({ status: 200, body: { currentEndsAt: SKIBOX_END, newEndsAt: Date.UTC(2026, 10, 30, 22, 59, 59), effectiveState: "expired", timeZone: "Europe/Madrid" } });
      const bad = await s.call("POST", `/${trial.id}/admin-extension`, { expectedVersion: trial.version, until: "2026-11-30", days: 3, reason: "Las dos cosas", idempotencyKey: key("j") });
      expect(bad.status).toBe(400);
      const ok = await s.call("POST", `/${trial.id}/admin-extension`, { expectedVersion: trial.version, until: "2026-11-30", reason: "Ampliación desde el CRM", idempotencyKey: key("j") });
      expect(ok).toMatchObject({ status: 200, body: { result: "applied", replayed: false, before: SKIBOX_END, licences: { outcome: "aligned" }, trial: { state: "active", effectiveState: "active" } } });
      const again = await s.call("POST", `/${trial.id}/admin-extension`, { expectedVersion: trial.version, until: "2026-11-30", reason: "Ampliación desde el CRM", idempotencyKey: key("j") });
      expect(again).toMatchObject({ status: 200, body: { replayed: true, result: "applied" } });
    } finally {
      Date.now = realNow;
      await s.close();
    }
  });

  it("un token de integración (no una persona) no amplía, aunque tenga los ámbitos", async () => {
    const { trial } = await skiboxToday();
    const s = await serve(["subscriptions:read", "subscriptions:write", "entitlements:write"], "crm");
    try {
      const r = await s.call("POST", `/${trial.id}/admin-extension`, { expectedVersion: trial.version, days: 3, reason: "Integración", idempotencyKey: key("tk") });
      expect(r.status).toBe(403);
      expect((await trials.must(trial.id)).endsAt).toBe(SKIBOX_END);
    } finally {
      await s.close();
    }
  });

  it("sin entitlements:write no se puede ampliar (mueve licencias)", async () => {
    const { trial } = await skiboxToday();
    const s = await serve(["subscriptions:read", "subscriptions:write"]);
    try {
      const r = await s.call("POST", `/${trial.id}/admin-extension`, { expectedVersion: trial.version, days: 3, reason: "Sin permiso", idempotencyKey: key("k") });
      expect(r).toMatchObject({ status: 403, body: { scope: "entitlements:write" } });
    } finally {
      await s.close();
    }
  });
});
