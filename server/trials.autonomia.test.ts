/**
 * Prueba gratuita autónoma: reenvío seguro del enlace de verificación, solicitudes sin verificar que
 * caducan y liberan el correo, protección contra alias (+etiqueta), mayúsculas y correo desechable, tarea
 * programada (vencimiento, avisos 3/1/0 una sola vez, exclusión entre réplicas, apagada por defecto) y
 * plantillas de correo en español sin envío real.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { MemoryTrialStore } from "./trials/store";
import { TrialService, blockedDomainsFromEnv, canonicalMailbox, mailboxOf } from "./trials/service";
import { TrialOnboardingService, type TrialNotifier } from "./trials/onboarding";
import { TrialScheduler, memoryLock, schedulerConfigFromEnv, startTrialScheduler, SCHEDULER_LOCK, DEFAULT_INTERVAL } from "./trials/scheduler";
import { platformTemplates } from "./mail/templates";
import { PlatformMailer } from "./mail/platform";
import { MailService } from "./mail/service";
import { MemoryMailStore } from "./mail/store";
import { memoryProvider } from "./mail/providers";
import { mailPolicyFromEnv } from "./mail/policy";

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 9, 16, 9);
let clock = T0;
let store: MemoryTrialStore;
let svc: TrialService;
let sent: Array<{ kind: string; to: string; data: Record<string, unknown> }>;
let notify: TrialNotifier;
let onboarding: TrialOnboardingService;
let n = 0;
const key = () => `idem-autonomia-${String(++n).padStart(8, "0")}`;
const reg = (email: string, ip: string | null = `10.2.0.${n % 250}`) => svc.register({ email, companyName: "Acme", configuration: { plan: "essential", addons: [] }, idempotencyKey: key(), ip });

beforeEach(() => {
  clock = T0;
  store = new MemoryTrialStore();
  svc = new TrialService({ store, now: () => clock, blockedDomains: ["bloqueado.example"] });
  sent = [];
  notify = {
    verification: async (to, l) => void sent.push({ kind: "verification", to, data: l }),
    welcome: async (to, i) => void sent.push({ kind: "welcome", to, data: i }),
    expiryNotice: async (to, i) => void sent.push({ kind: "expiry", to, data: i }),
  };
  // Solo se usan registro, reenvío y avisos: el resto de dependencias no se tocan
  onboarding = new TrialOnboardingService({ trials: svc, notify, now: () => clock } as unknown as ConstructorParameters<typeof TrialOnboardingService>[0]);
});

/** Lleva una prueba a «activa» con un tenant. */
async function activeTrial(email: string, tenant: string) {
  const r = await reg(email);
  const v = await svc.verify(r.trial.id, r.verificationToken!);
  const p = await svc.requestProvisioning(v.id, v.version, "op");
  return svc.markProvisioned(p.id, p.version, tenant, "op");
}

describe("reenvío del enlace de verificación", () => {
  it("token nuevo: el anterior deja de valer y el nuevo verifica", async () => {
    const r = await reg("ana@acme.es");
    clock += 5 * 60_000;
    const out = await onboarding.resendVerification({ email: "  ANA@acme.es " }, "web");
    expect(out.outcome).toBe("resent");
    const fresh = sent.find((m) => m.kind === "verification")!;
    expect(fresh.data).toMatchObject({ trialId: r.trial.id, resend: true });
    expect(fresh.data.token).not.toBe(r.verificationToken);
    await expect(svc.verify(r.trial.id, r.verificationToken!)).rejects.toMatchObject({ code: "forbidden" });
    expect((await svc.verify(r.trial.id, fresh.data.token as string)).state).toBe("verified");
    expect((await store.events(r.trial.id)).map((e) => e.action)).toEqual(["registered", "resend_verification", "verify"]);
  });

  it("idempotente por correo: dentro de la espera mínima no se genera otro enlace; máximo diario", async () => {
    const r = await reg("luis@acme.es");
    expect((await onboarding.resendVerification({ email: "luis@acme.es" }, "web")).outcome).toBe("cooldown");
    for (let i = 0; i < 3; i++) {
      clock += 3 * 60_000;
      expect((await onboarding.resendVerification({ email: "luis@acme.es" }, "web")).outcome).toBe("resent");
      expect((await onboarding.resendVerification({ email: "luis@acme.es" }, "web")).outcome).toBe("cooldown");
    }
    clock += 3 * 60_000;
    expect((await onboarding.resendVerification({ email: "luis@acme.es" }, "web")).outcome).toBe("limit");
    expect(sent.filter((m) => m.kind === "verification")).toHaveLength(3);
    // Pasadas 24 h desde los reenvíos vuelve a poder pedirse
    clock += DAY;
    expect((await onboarding.resendVerification({ trialId: r.trial.id }, "operator:ana")).outcome).toBe("resent");
  });

  it("dos peticiones simultáneas: un único enlace nuevo", async () => {
    await reg("sim@acme.es");
    clock += 5 * 60_000;
    const outs = await Promise.all([onboarding.resendVerification({ email: "sim@acme.es" }, "web"), onboarding.resendVerification({ email: "sim@acme.es" }, "web")]);
    expect(outs.map((o) => o.outcome).sort()).toEqual(["cooldown", "resent"]);
    expect(sent.filter((m) => m.kind === "verification")).toHaveLength(1);
  });

  it("enlace caducado: se renueva mientras la solicitud no supere su vida máxima; después se anula y libera el correo", async () => {
    const r = await reg("eva@acme.es");
    clock += 2 * DAY; // enlace caducado (24 h)
    await expect(svc.verify(r.trial.id, r.verificationToken!)).rejects.toThrow(/caducado/);
    expect((await onboarding.resendVerification({ email: "eva@acme.es" }, "web")).outcome).toBe("resent");
    expect((await svc.verify(r.trial.id, sent.at(-1)!.data.token as string)).state).toBe("verified");

    const old = await reg("old@acme.es");
    clock += 8 * DAY;
    expect((await onboarding.resendVerification({ email: "old@acme.es" }, "web")).outcome).toBe("expired");
    expect((await svc.must(old.trial.id)).state).toBe("cancelled");
    expect((await reg("old@acme.es")).created).toBe(true);
  });

  it("sin solicitud pendiente no se envía nada (no existe, ya verificada o correo no válido)", async () => {
    expect((await onboarding.resendVerification({ email: "nadie@acme.es" }, "web")).outcome).toBe("not_found");
    expect((await onboarding.resendVerification({ email: "no-es-correo" }, "web")).outcome).toBe("not_found");
    const t = await activeTrial("act@acme.es", "acme-act");
    clock += 5 * 60_000;
    expect((await onboarding.resendVerification({ trialId: t.id }, "op")).outcome).toBe("not_pending");
    expect(sent).toHaveLength(0);
  });
});

describe("el correo no queda bloqueado y protección contra abusos", () => {
  it("registrarse otra vez con una solicitud sin verificar y caducada: la anterior se anula y se crea otra", async () => {
    const a = await reg("rep@acme.es");
    await expect(reg("rep@acme.es")).rejects.toMatchObject({ code: "conflict" });
    clock += DAY + 1;
    const b = await reg("rep@acme.es");
    expect(b.created).toBe(true);
    expect(b.trial.id).not.toBe(a.trial.id);
    const prev = await svc.must(a.trial.id);
    expect(prev).toMatchObject({ state: "cancelled", verificationTokenHash: null });
    expect((await store.events(a.trial.id)).at(-1)).toMatchObject({ action: "expire_verification", actor: "system:trial" });
  });

  it("alias +etiqueta y mayúsculas del mismo buzón: una sola prueba abierta", async () => {
    expect(mailboxOf("ana+promo@acme.es")).toEqual({ base: "ana", domain: "acme.es" });
    await reg("ana@acme.es");
    await expect(reg("ana+2@acme.es")).rejects.toMatchObject({ code: "conflict" });
    await expect(reg("ANA+x@ACME.es")).rejects.toMatchObject({ code: "conflict" });
    await reg("bea+uno@gmail.com");
    await expect(reg("bea+dos@gmail.com")).rejects.toMatchObject({ code: "conflict" });
    await expect(reg("bea@gmail.com")).rejects.toMatchObject({ code: "conflict" });
    // Otro buzón que solo comparte el prefijo no se ve afectado
    expect((await reg("bea2@gmail.com")).created).toBe(true);
    expect((await reg("an_a@acme.es")).created).toBe(true);
  });

  it("Gmail: los puntos y googlemail.com son el mismo buzón; en otros dominios los puntos sí cuentan", async () => {
    expect(canonicalMailbox("A.Na+promo@GoogleMail.com")).toBe("ana@gmail.com");
    expect(canonicalMailbox("a.na@acme.es")).toBe("a.na@acme.es");
    expect(canonicalMailbox("+x@acme.es")).toBe("+x@acme.es");
    await reg("lu.cia@gmail.com");
    await expect(reg("lucia@gmail.com")).rejects.toMatchObject({ code: "conflict" });
    await expect(reg("l.u.c.i.a+2@googlemail.com")).rejects.toMatchObject({ code: "conflict" });
    await reg("lu.cia@acme.es");
    expect((await reg("lucia@acme.es")).created).toBe(true);
  });

  it("correo desechable conocido o dominio bloqueado por configuración: rechazado", async () => {
    await expect(reg("x@mailinator.com")).rejects.toMatchObject({ code: "invalid_input" });
    await expect(reg("x@Bloqueado.example")).rejects.toMatchObject({ code: "invalid_input" });
    expect(await store.list({})).toHaveLength(0);
    expect(blockedDomainsFromEnv({ CP_TRIAL_BLOCKED_DOMAINS: " Spam.example, ,no valido,otro.example " } as NodeJS.ProcessEnv)).toEqual(["spam.example", "otro.example"]);
    expect(blockedDomainsFromEnv({} as NodeJS.ProcessEnv)).toEqual([]);
  });
});

describe("tarea programada", () => {
  const scheduler = (lock = memoryLock(), notifier: TrialNotifier = notify) => new TrialScheduler({ store, notify: notifier, lock, now: () => clock, log: () => undefined });

  it("avisos de 3 y 1 días y vencimiento con aviso de 0 días, cada uno una sola vez; nada se toca antes de tiempo", async () => {
    const t = await activeTrial("dueno@hotel.es", "hotel-dueno");
    const s = scheduler();
    expect(await s.tick()).toMatchObject({ expired: 0, noticesQueued: 0 });
    clock = t.endsAt! - 3 * DAY + 1000;
    expect(await s.tick()).toMatchObject({ noticesQueued: 1 });
    expect(await s.tick()).toMatchObject({ noticesQueued: 0 });
    clock = t.endsAt! - DAY + 1000;
    expect(await s.tick()).toMatchObject({ noticesQueued: 1, expired: 0 });
    expect(await s.tick()).toMatchObject({ noticesQueued: 0 });
    clock = t.endsAt! + 1000;
    expect(await s.tick()).toMatchObject({ expired: 1, noticesQueued: 1, errors: 0 });
    expect(await s.tick()).toMatchObject({ expired: 0, noticesQueued: 0 });
    expect(sent.filter((m) => m.kind === "expiry").map((m) => m.data.daysLeft)).toEqual([3, 1, 0]);
    const after = await svc.must(t.id);
    expect(after).toMatchObject({ state: "expired", tenantId: "hotel-dueno" });
    expect((await store.events(t.id)).filter((e) => e.action === "mark_expired")).toEqual([expect.objectContaining({ actor: "system:trial-scheduler" })]);
  });

  it("prueba de 15 días completa: avisos a 7, 3 y 1 días y el de vencimiento, uno de cada; nada antes de los 7 días", async () => {
    const t = await activeTrial("completa@hotel.es", "hotel-completa");
    const s = scheduler();
    clock = t.endsAt! - 8 * DAY + 1000; // quedan más de 7 días: nada todavía
    expect(await s.tick()).toMatchObject({ noticesQueued: 0 });
    for (const days of [7, 3, 1]) {
      clock = t.endsAt! - days * DAY + 1000;
      expect(await s.tick()).toMatchObject({ noticesQueued: 1, expired: 0 });
      expect(await s.tick()).toMatchObject({ noticesQueued: 0 });
    }
    clock = t.endsAt! + 1000;
    expect(await s.tick()).toMatchObject({ expired: 1, noticesQueued: 1 });
    expect(sent.filter((m) => m.kind === "expiry" && m.to === "completa@hotel.es").map((m) => m.data.daysLeft)).toEqual([7, 3, 1, 0]);
  });

  it("si estuvo parada, manda solo el aviso más cercano (no el de 3 días el último día)", async () => {
    const t = await activeTrial("tarde@hotel.es", "hotel-tarde");
    clock = t.endsAt! - 12 * 3_600_000;
    await scheduler().tick();
    expect(sent.filter((m) => m.kind === "expiry").map((m) => m.data.daysLeft)).toEqual([1]);
  });

  it("una ampliación vuelve a avisar del nuevo fin", async () => {
    const t = await activeTrial("amp@hotel.es", "hotel-amp");
    const s = scheduler();
    clock = t.endsAt! - DAY + 1000;
    await s.tick();
    const cur = await svc.must(t.id);
    const ext = await svc.approveExtension(cur.id, cur.version, 5, "op");
    clock = ext.endsAt! - DAY + 1000;
    await s.tick();
    expect(sent.filter((m) => m.kind === "expiry").map((m) => [m.data.daysLeft, m.data.endsAt])).toEqual([
      [1, t.endsAt],
      [1, ext.endsAt],
    ]);
  });

  it("los avisos ya enviados a mano no se repiten", async () => {
    const t = await activeTrial("mano@hotel.es", "hotel-mano");
    clock = t.endsAt! - 3 * DAY + 1000;
    const due = await onboarding.noticesDue(async () => [{ id: t.id, email: t.email, endsAt: t.endsAt }]);
    await onboarding.sendNotices(due);
    expect(await scheduler().tick()).toMatchObject({ noticesQueued: 0 });
    expect(sent.filter((m) => m.kind === "expiry")).toHaveLength(1);
  });

  it("solicitudes sin verificar: se anulan solo con el enlace caducado y pasada su vida máxima", async () => {
    const a = await reg("pend@acme.es");
    const s = scheduler();
    clock += 2 * DAY;
    expect(await s.tick()).toMatchObject({ verificationsExpired: 0 });
    expect((await svc.must(a.trial.id)).state).toBe("pending_verification");
    clock = T0 + 7 * DAY + 1;
    expect(await s.tick()).toMatchObject({ verificationsExpired: 1 });
    expect((await svc.must(a.trial.id)).state).toBe("cancelled");
    expect((await reg("pend@acme.es")).created).toBe(true);
  });

  it("no toca pruebas suspendidas, verificadas ni convertidas", async () => {
    const t = await activeTrial("sus@hotel.es", "hotel-sus");
    const susp = await svc.suspend(t.id, t.version, "Uso indebido detectado", "op");
    const r = await reg("ver@hotel.es");
    await svc.verify(r.trial.id, r.verificationToken!);
    clock = T0 + 30 * DAY;
    expect(await scheduler().tick()).toMatchObject({ expired: 0, noticesQueued: 0, verificationsExpired: 0 });
    expect((await svc.must(susp.id)).state).toBe("suspended");
    expect((await svc.must(r.trial.id)).state).toBe("verified");
  });

  it("exclusión entre réplicas: con el bloqueo ocupado el tick no hace nada", async () => {
    const t = await activeTrial("lock@hotel.es", "hotel-lock");
    const lock = memoryLock();
    lock.held.add(SCHEDULER_LOCK);
    clock = t.endsAt! + 1;
    expect(await scheduler(lock).tick()).toMatchObject({ skipped: "locked", expired: 0 });
    expect((await svc.must(t.id)).state).toBe("active");
    lock.held.clear();
    expect(await scheduler(lock).tick()).toMatchObject({ skipped: null, expired: 1 });
    expect(lock.held.size).toBe(0);
  });

  it("dos réplicas a la vez con el mismo bloqueo: un solo vencimiento y un solo aviso", async () => {
    const t = await activeTrial("dos@hotel.es", "hotel-dos");
    const lock = memoryLock();
    clock = t.endsAt! + 1;
    const [a, b] = await Promise.all([scheduler(lock).tick(), scheduler(lock).tick()]);
    expect([a.expired + b.expired, a.noticesQueued + b.noticesQueued]).toEqual([1, 1]);
    expect(sent.filter((m) => m.kind === "expiry")).toHaveLength(1);
  });

  it("si el aviso falla no se deja constancia y se reintenta en el siguiente tick", async () => {
    const t = await activeTrial("fallo@hotel.es", "hotel-fallo");
    let fail = true;
    const flaky: TrialNotifier = { ...notify, expiryNotice: async (to, i) => (fail ? Promise.reject(new Error("smtp caído")) : notify.expiryNotice(to, i)) };
    clock = t.endsAt! - DAY + 1000;
    expect(await scheduler(memoryLock(), flaky).tick()).toMatchObject({ noticesQueued: 0, errors: 1 });
    fail = false;
    expect(await scheduler(memoryLock(), flaky).tick()).toMatchObject({ noticesQueued: 1, errors: 0 });
  });

  it("apagada por defecto; intervalo acotado; sin solapes ni trabajo al arrancar", async () => {
    expect(schedulerConfigFromEnv({} as NodeJS.ProcessEnv)).toEqual({ enabled: false, intervalMs: DEFAULT_INTERVAL });
    expect(schedulerConfigFromEnv({ CP_TRIALS_SCHEDULER_ENABLED: "true" } as NodeJS.ProcessEnv).enabled).toBe(false);
    expect(schedulerConfigFromEnv({ CP_TRIALS_SCHEDULER_ENABLED: "1", CP_TRIALS_SCHEDULER_INTERVAL_MS: "5" } as NodeJS.ProcessEnv)).toEqual({ enabled: true, intervalMs: 60_000 });
    expect(schedulerConfigFromEnv({ CP_TRIALS_SCHEDULER_INTERVAL_MS: "x" } as NodeJS.ProcessEnv).intervalMs).toBe(DEFAULT_INTERVAL);
    const s = scheduler();
    const tick = vi.spyOn(s, "tick");
    const off = startTrialScheduler({ scheduler: s, env: {} as NodeJS.ProcessEnv, log: () => undefined });
    expect(off.enabled).toBe(false);
    vi.useFakeTimers();
    try {
      const on = startTrialScheduler({ scheduler: s, env: { CP_TRIALS_SCHEDULER_ENABLED: "1", CP_TRIALS_SCHEDULER_INTERVAL_MS: "120000" } as NodeJS.ProcessEnv, log: () => undefined });
      expect(tick).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(tick).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(120_000);
      expect(tick).toHaveBeenCalledTimes(2);
      on.stop();
      await vi.advanceTimersByTimeAsync(600_000);
      expect(tick).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("plantillas de correo de la prueba (español, sin Náyade, sin envío real)", () => {
  const t = platformTemplates({ supportEmail: null });
  const all = [
    t.emailVerification({ verifyUrl: "https://web.example/prueba-gratuita/verificar?id=1&token=a" }),
    t.emailVerificationResent({ verifyUrl: "https://web.example/prueba-gratuita/verificar?id=1&token=b" }),
    t.trialExpiry({ endsAt: T0, daysLeft: 3, pricingUrl: "https://web.example/precios" }),
    t.trialExpiry({ endsAt: T0, daysLeft: 1, pricingUrl: "https://web.example/precios" }),
    t.trialExpiry({ endsAt: T0, daysLeft: 0, pricingUrl: "https://web.example/precios" }),
    t.trialExpired({ endsAt: T0 }),
  ];

  it("asuntos en español y ninguna referencia a Náyade", () => {
    expect(all.map((m) => m.subject)).toEqual([
      "Confirma tu correo para empezar tu prueba de Big Elephant",
      "Tu nuevo enlace para empezar la prueba de Big Elephant",
      "Tu prueba de Big Elephant termina en 3 días",
      "Tu prueba de Big Elephant termina mañana",
      "Tu prueba de Big Elephant ha terminado",
      "Tu prueba de Big Elephant ha terminado",
    ]);
    for (const m of all) expect(`${m.subject}\n${m.html}\n${m.text}`).not.toMatch(/n[aá]yade/i);
    expect(all[1].text).toMatch(/sustituye al anterior/);
    expect(all[5].text).toMatch(/solo lectura/);
    expect(all[5].text).toMatch(/No se ha borrado nada/);
  });

  it("por la bandeja de plataforma: reenvío con su plantilla y, con MAIL_MODE=off, nada sale", async () => {
    const mailStore = new MemoryMailStore();
    const provider = memoryProvider();
    const policy = mailPolicyFromEnv({ MAIL_MODE: "off" } as NodeJS.ProcessEnv);
    const m = new PlatformMailer(new MailService({ lane: "platform", store: mailStore, provider, policy, now: () => clock }), policy, { verifyUrl: "https://web.example/prueba-gratuita/verificar" });
    const nt = m.trialNotifier();
    await nt.verification("a@pruebas.example", { trialId: 3, token: "tok-1" });
    await nt.verification("a@pruebas.example", { trialId: 3, token: "tok-2", resend: true });
    await nt.verification("a@pruebas.example", { trialId: 3, token: "tok-2", resend: true });
    await nt.expiryNotice("a@pruebas.example", { trialId: 3, endsAt: T0, daysLeft: 0 });
    expect(provider.sent).toHaveLength(0);
    expect(mailStore.rows.map((r) => [r.category, r.status, r.subject])).toEqual([
      ["email_verification", "skipped", "Confirma tu correo para empezar tu prueba de Big Elephant"],
      ["email_verification", "skipped", "Tu nuevo enlace para empezar la prueba de Big Elephant"],
      ["trial_expiry", "skipped", "Tu prueba de Big Elephant ha terminado"],
    ]);
  });

  it("sin CP_TRIAL_VERIFY_URL no se encola el enlace (ni el reenvío)", async () => {
    const mailStore = new MemoryMailStore();
    const policy = mailPolicyFromEnv({ MAIL_MODE: "off" } as NodeJS.ProcessEnv);
    const m = new PlatformMailer(new MailService({ lane: "platform", store: mailStore, provider: null, policy, now: () => clock }), policy, {});
    await m.trialNotifier().verification("a@pruebas.example", { trialId: 3, token: "tok-3", resend: true });
    expect(mailStore.rows).toHaveLength(0);
  });
});

describe("avisos de los cambios decididos por el equipo", () => {
  /** Onboarding con lo justo para suspender y reactivar (licencias y suscripción de la prueba). */
  const withTeam = (notifier: TrialNotifier = notify) =>
    new TrialOnboardingService({
      trials: svc,
      notify: notifier,
      now: () => clock,
      platformDomain: "app.bigelephant.example",
      companies: { byTenant: async () => ({ id: 1 }), create: async () => ({ id: 1 }) },
      subscriptions: { list: async () => [{ id: 9, status: "trialing" }] },
      licensing: { list: async () => [], setStatus: async () => undefined, apply: async () => ({ applied: [], desired: [] }) },
    } as unknown as ConstructorParameters<typeof TrialOnboardingService>[0]);
  const status = () => sent.filter((m) => m.kind === "status").map((m) => [m.data.kind, m.data.endsAt, m.data.domain]);
  beforeEach(() => {
    notify.statusNotice = async (to, i) => void sent.push({ kind: "status", to, data: i as unknown as Record<string, unknown> });
  });

  it("ampliación, pausa y reactivación: un aviso cada una, con la fecha de fin (nunca en la pausa) y el acceso", async () => {
    const t = await activeTrial("equipo@hotel.es", "hotel-equipo");
    const ob = withTeam();
    const ext = await ob.approveExtension(t.id, { expectedVersion: t.version, days: 5, actor: "op" });
    const sus = await ob.suspend(t.id, { reason: "Uso indebido detectado", expectedVersion: ext.version, actor: "op" });
    const re = await ob.reactivate(t.id, { expectedVersion: sus.version, actor: "op" });
    expect(re.trial.state).toBe("active");
    expect(status()).toEqual([
      ["extended", ext.endsAt, "hotel-equipo.app.bigelephant.example"],
      ["suspended", null, "hotel-equipo.app.bigelephant.example"],
      ["reactivated", ext.endsAt, "hotel-equipo.app.bigelephant.example"],
    ]);
    expect(sent.filter((m) => m.kind === "status").every((m) => m.to === "equipo@hotel.es")).toBe(true);
    // El motivo interno de la pausa nunca viaja en el aviso
    expect(JSON.stringify(sent)).not.toMatch(/Uso indebido/);
  });

  it("si el aviso falla, el cambio queda hecho igualmente", async () => {
    const t = await activeTrial("fallo@hotel.es", "hotel-fallo");
    const ob = withTeam({ ...notify, statusNotice: async () => Promise.reject(new Error("bandeja caída")) });
    const ext = await ob.approveExtension(t.id, { expectedVersion: t.version, days: 3, actor: "op" });
    expect(ext.endsAt).toBe(t.endsAt! + 3 * DAY);
  });

  it("vencimiento manual: aviso de 0 días una sola vez, y la tarea programada no lo repite", async () => {
    const t = await activeTrial("manual@hotel.es", "hotel-manual");
    clock = t.endsAt! + 1000;
    const ob = withTeam();
    const e = await ob.expire(t.id, "op");
    expect(e.state).toBe("expired");
    await new TrialScheduler({ store, notify, lock: memoryLock(), now: () => clock, log: () => undefined }).tick();
    expect(sent.filter((m) => m.kind === "expiry").map((m) => [m.to, m.data.daysLeft])).toEqual([["manual@hotel.es", 0]]);
  });

  it("la bienvenida lleva la fecha de fin de la prueba", () => {
    const m = platformTemplates({ supportEmail: null }).trialActivated({ host: "t1-x.app.bigelephant.example", setPasswordUrl: "https://t1-x.app.bigelephant.example/establecer-contrasena?token=a", endsAt: T0 + 15 * DAY });
    expect(m.text).toMatch(/La prueba dura hasta: 31 de octubre de 2026/);
  });

  it("por la bandeja de plataforma: categoría propia, idempotente por transición y, con MAIL_MODE=off, nada sale", async () => {
    const mailStore = new MemoryMailStore();
    const provider = memoryProvider();
    const policy = mailPolicyFromEnv({ MAIL_MODE: "off" } as NodeJS.ProcessEnv);
    const nt = new PlatformMailer(new MailService({ lane: "platform", store: mailStore, provider, policy, now: () => clock }), policy, {}).trialNotifier();
    const info = { trialId: 4, version: 7, kind: "extended" as const, endsAt: T0 + 20 * DAY, domain: "t4-x.app.bigelephant.example" };
    await nt.statusNotice!("a@pruebas.example", info);
    await nt.statusNotice!("a@pruebas.example", info);
    await nt.statusNotice!("a@pruebas.example", { ...info, version: 8, kind: "suspended", endsAt: null });
    expect(provider.sent).toHaveLength(0);
    expect(mailStore.rows.map((r) => [r.category, r.status, r.subject])).toEqual([
      ["trial_status", "skipped", "Hemos ampliado tu prueba de Big Elephant"],
      ["trial_status", "skipped", "Tu prueba de Big Elephant está en pausa"],
    ]);
  });
});

describe("activación de la prueba: nada a medias", () => {
  it("sin tarifa Essential aprobada no se crea la plataforma ni se envía la bienvenida; la prueba sigue verificada", async () => {
    const r = await reg("sin-tarifa@hotel.es");
    const v = await svc.verify(r.trial.id, r.verificationToken!);
    const provision = vi.fn(async () => ({ status: "completed", tenantId: "x", domain: "x.app", adminInviteToken: "inv" }));
    const ob = new TrialOnboardingService({
      trials: svc,
      notify,
      now: () => clock,
      platformDomain: "app.bigelephant.example",
      provision,
      priceOf: async () => null,
    } as unknown as ConstructorParameters<typeof TrialOnboardingService>[0]);
    await expect(ob.activate(v.id, "system:trial")).rejects.toThrow(/tarifa mensual aprobada/);
    expect(provision).not.toHaveBeenCalled();
    expect(sent.filter((m) => m.kind === "welcome")).toEqual([]);
    expect((await svc.must(v.id)).state).toBe("verified");
  });
});
