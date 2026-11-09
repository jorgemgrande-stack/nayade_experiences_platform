/**
 * Recordatorios automáticos de la prueba gratuita (server/trials/reminders.ts, decisión 3 del 09/11/2026):
 *  - (a) correo sin verificar a las 24 h (enlace nuevo por el reenvío de siempre), (b) sin entrar en el panel a los
 *    2 días, (c) sin primera acción útil a los 4 días;
 *  - uno por prueba, tipo y paso; se cancelan al cumplirse su objetivo; nunca a registros técnicos ni a quien se dio
 *    de baja; la baja es un enlace firmado con página de confirmación (GET muestra, POST registra).
 * Todo en memoria: ningún correo real.
 */
import { describe, it, expect, beforeEach } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { MemoryTrialStore } from "./trials/store";
import { TrialService } from "./trials/service";
import { TrialScheduler, memoryLock } from "./trials/scheduler";
import { dueReminder, reminderKey } from "./trials/reminders";
import { createPublicTrialRouter } from "./trials/api";
import { LinkSigner } from "./communications/links";
import type { TrialOnboardingService, TrialReminderNotice } from "./trials/onboarding";

const H = 3_600_000;
const D = 24 * H;
const T0 = Date.UTC(2026, 10, 9, 9);

let clock = T0;
let store: MemoryTrialStore;
let svc: TrialService;
let sent: Array<{ kind: string; to: string; info: unknown }>;
let scheduler: TrialScheduler;

const terms = { accepted: true, version: "2026-10-21" };
let n = 0;
async function signup(email = `persona${++n}@empresa${n}.example`) {
  return svc.register({ email, companyName: `Empresa ${n}`, configuration: { plan: "essential", addons: [] }, terms, idempotencyKey: `idem-recordatorio-${String(n).padStart(10, "0")}` });
}
async function activeTrial() {
  const r = await signup();
  const v = await svc.verify(r.trial.id, r.verificationToken!);
  const p = await svc.requestProvisioning(v.id, v.version, "op");
  return svc.markProvisioned(p.id, p.version, `t-recordatorio-${n}`, "prov");
}

beforeEach(() => {
  clock = T0;
  store = new MemoryTrialStore();
  svc = new TrialService({ store, now: () => clock, limits: { perIp24h: 100, perDomain30d: 100 } });
  sent = [];
  scheduler = new TrialScheduler({
    store,
    lock: memoryLock(),
    now: () => clock,
    exempt: new Set(),
    log: () => undefined,
    notify: {
      expiryNotice: async () => undefined,
      verification: async (to, l) => void sent.push({ kind: "verify", to, info: l }),
      reminder: async (to, i: TrialReminderNotice) => void sent.push({ kind: i.kind, to, info: i }),
    },
    reminders: { platformDomain: "elephant.test", optOutUrl: (id) => `https://crm.example/cp/v1/public/trial/recordatorios?t=${id}` },
  });
});

describe("cuándo toca cada recordatorio (lógica pura)", () => {
  it("verificación a las 20 h (antes de que caduque el enlace); nada pasados 6 días, si es técnica o si se dio de baja", async () => {
    const t = (await signup()).trial;
    const none = new Set<string>();
    expect(dueReminder(t, none, none, T0 + 19 * H)).toBeNull();
    expect(dueReminder(t, none, none, T0 + 25 * H)).toBe("verify");
    expect(dueReminder(t, none, new Set([reminderKey("verify")]), T0 + 25 * H)).toBeNull();
    expect(dueReminder(t, none, none, T0 + 6 * D + H)).toBeNull();
    expect(dueReminder({ ...t, configuration: { ...t.configuration, test: { at: T0, actor: "op", reason: "prueba técnica" } } }, none, none, T0 + 25 * H)).toBeNull();
    expect(dueReminder({ ...t, configuration: { ...t.configuration, reminders: { optOutAt: T0 } } }, none, none, T0 + 25 * H)).toBeNull();
  });
});

describe("tarea programada: idempotencia por prueba, tipo y paso, y cancelación al cumplirse el objetivo", () => {
  it("(a) correo sin verificar: un enlace nuevo una sola vez; verificar antes lo cancela", async () => {
    const pending = (await signup()).trial;
    const verified = await signup();
    clock = T0 + 2 * H;
    await svc.verify(verified.trial.id, verified.verificationToken!);
    clock = T0 + 25 * H;
    expect((await scheduler.tick()).remindersQueued).toBe(1);
    expect(sent.map((s) => [s.kind, s.to])).toEqual([["verify", pending.email]]);
    expect(sent[0].info).toMatchObject({ trialId: pending.id, resend: true });
    clock += H;
    expect((await scheduler.tick()).remindersQueued).toBe(0);
    expect(sent).toHaveLength(1);
    expect((await store.events(pending.id)).filter((e) => e.action === "notice_queued" && e.detail === reminderKey("verify"))).toHaveLength(1);
  });

  it("(b) sin entrar en el panel y (c) sin primera acción: cada uno una vez, y cancelados por sus hitos", async () => {
    const t = await activeTrial();
    clock = T0 + 47 * H;
    await scheduler.tick();
    expect(sent).toHaveLength(0);
    clock = T0 + 49 * H;
    await scheduler.tick();
    await scheduler.tick();
    expect(sent.map((s) => s.kind)).toEqual(["setup"]);
    expect(sent[0].info).toMatchObject({ trialId: t.id, key: `trial:${t.id}:reminder:setup:1`, domain: `${t.tenantId}.elephant.test`, optOutUrl: expect.stringContaining("/recordatorios?t=") });
    // Entra en su panel: el de «entra» ya no aplica; el de primera acción llega a los 4 días
    await svc.recordMilestone(t.tenantId!, "first_access", null, "core:t");
    clock = T0 + 97 * H;
    await scheduler.tick();
    await scheduler.tick();
    expect(sent.map((s) => s.kind)).toEqual(["setup", "first_action"]);
    // Con la primera acción hecha antes de tiempo, otra prueba no recibe el (c)
    const done = await activeTrial();
    await svc.recordMilestone(done.tenantId!, "first_access", null, "core:t");
    await svc.recordMilestone(done.tenantId!, "first_action", "client", "core:t");
    clock = T0 + 10 * D;
    await scheduler.tick();
    expect(sent.filter((s) => (s.info as { trialId: number }).trialId === done.id)).toHaveLength(0);
  });

  it("registros técnicos y bajas: nunca reciben recordatorios", async () => {
    const tech = await activeTrial();
    await svc.markTest(tech.id, "Alta de verificación técnica", "op:test");
    const out = await activeTrial();
    expect(await svc.optOutReminders(out.id, "web:enlace")).toEqual({ trialId: out.id, changed: true });
    expect(await svc.optOutReminders(out.id, "web:enlace")).toEqual({ trialId: out.id, changed: false });
    clock = T0 + 10 * D;
    await scheduler.tick();
    expect(sent).toHaveLength(0);
    expect((await store.events(out.id)).filter((e) => e.action === "reminders_opt_out")).toHaveLength(1);
  });
});

describe("baja de los recordatorios por enlace firmado", () => {
  it("GET confirma sin cambiar nada; POST registra; un enlace falso o de otra prueba no sirve", async () => {
    const t = await activeTrial();
    const signer = new LinkSigner("s".repeat(40));
    const app = express();
    app.use("/trial", createPublicTrialRouter({ onboarding: {} as TrialOnboardingService, autoProvision: false, reminders: { verify: (x) => signer.verifyTrialReminders(x), optOut: async (id) => !!(await svc.optOutReminders(id, "web:enlace"))?.changed } }));
    const server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/trial/recordatorios`;
    try {
      const token = signer.trialRemindersToken(t.id);
      const page = await fetch(`${base}?t=${encodeURIComponent(token)}`);
      expect(page.status).toBe(200);
      expect(await page.text()).toContain("Dejar de recibir recordatorios");
      expect((await store.get(t.id))!.configuration.reminders).toBeUndefined();
      const forged = `${t.id}.${"x".repeat(32)}`;
      expect((await fetch(`${base}?t=${encodeURIComponent(forged)}`, { method: "POST" })).status).toBe(404);
      const ok = await fetch(`${base}?t=${encodeURIComponent(token)}`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "" });
      expect(ok.status).toBe(200);
      expect(await ok.text()).toContain("Baja registrada");
      expect((await store.get(t.id))!.configuration.reminders).toEqual({ optOutAt: expect.any(Number) });
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });
});
