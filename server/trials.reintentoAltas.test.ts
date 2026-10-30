/**
 * Recuperación automática de altas incompletas en la tarea programada de la prueba gratuita: reintentos con
 * espera creciente reutilizando `activate`, alerta de administración al agotarlos (sin correo al cliente),
 * aprovisionamientos interrumpidos que dejan de contar para el límite de simultáneos, interruptor de la
 * activación automática y exclusión entre réplicas. Todo en memoria.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { MemoryTrialStore } from "./trials/store";
import { TrialService } from "./trials/service";
import { TrialOnboardingService, type TrialNotifier } from "./trials/onboarding";
import { ACTIVATION_GAVE_UP_ALERT, ACTIVATION_RETRY_DELAYS_MS, TrialScheduler, memoryLock, type TrialRecovery } from "./trials/scheduler";

const MIN = 60_000;
const DAY = 86_400_000;
const T0 = Date.UTC(2026, 9, 30, 9);
let clock = T0;
let store: MemoryTrialStore;
let svc: TrialService;
let sent: Array<{ kind: string; to: string }>;
let notify: TrialNotifier;
let ob: TrialOnboardingService;
let provisionFails: number;
let provision: ReturnType<typeof vi.fn>;
let activate: ReturnType<typeof vi.fn>;
let raise: ReturnType<typeof vi.fn>;
let autoProvision: boolean;
let n = 0;

beforeEach(() => {
  clock = T0;
  store = new MemoryTrialStore();
  svc = new TrialService({ store, now: () => clock });
  sent = [];
  notify = {
    verification: async (to) => void sent.push({ kind: "verification", to }),
    welcome: async (to) => void sent.push({ kind: "welcome", to }),
    expiryNotice: async (to) => void sent.push({ kind: "expiry", to }),
  };
  provisionFails = 0;
  provision = vi.fn(async (req: { tenantId: string }) => {
    if (provisionFails > 0) {
      provisionFails--;
      throw new Error("Fallo transitorio del aprovisionamiento");
    }
    return { status: "completed", tenantId: req.tenantId, domain: `${req.tenantId}.app.example`, adminInviteToken: "invitacion" };
  });
  const companies = new Map<string, { id: number }>();
  const subs: Array<{ id: number; companyId: number; status: string }> = [];
  ob = new TrialOnboardingService({
    trials: svc,
    notify,
    now: () => clock,
    platformDomain: "app.example",
    provision,
    priceOf: async () => 7,
    companies: {
      byTenant: async (tenantId: string) => companies.get(tenantId) ?? null,
      create: async (input: { tenantId: string }) => {
        const c = { id: companies.size + 1 };
        companies.set(input.tenantId, c);
        return c;
      },
    },
    subscriptions: {
      list: async (f: { companyId: number }) => subs.filter((s) => s.companyId === f.companyId),
      create: async (input: { companyId: number }) => {
        const s = { id: subs.length + 1, companyId: input.companyId, status: "trialing" };
        subs.push(s);
        return s;
      },
    },
    licensing: { apply: async () => ({ applied: [], desired: [] }) },
  } as unknown as ConstructorParameters<typeof TrialOnboardingService>[0]);
  activate = vi.fn((id: number, actor: string) => ob.activate(id, actor));
  raise = vi.fn(async () => ({ status: "sent", recipients: 1 }));
  autoProvision = true;
});

const recovery = (): TrialRecovery => ({ autoProvision, activate, raise });
const scheduler = (lock = memoryLock()) => new TrialScheduler({ store, notify, lock, now: () => clock, recovery, log: () => undefined });

async function verified(email: string) {
  const r = await svc.register({ email, companyName: "Hotel Prueba", configuration: { plan: "essential", addons: [] }, idempotencyKey: `idem-reintento-${String(++n).padStart(8, "0")}`, ip: null });
  return svc.verify(r.trial.id, r.verificationToken!);
}

/** Prueba verificada cuya activación al verificar falló (queda «verificada» con `provisioning_failed`). */
async function failedTrial(email: string) {
  const v = await verified(email);
  provisionFails = 1;
  await expect(ob.activate(v.id, "system:trial")).rejects.toThrow(/Fallo transitorio/);
  const t = await svc.must(v.id);
  expect(t.state).toBe("verified");
  return t;
}

const actions = async (id: number) => (await store.events(id)).map((e) => e.action);

describe("recuperación automática de altas incompletas", () => {
  it("fallo transitorio: se reintenta tras la espera y la prueba queda activa", async () => {
    const t = await failedTrial("ana@hotel.es");
    clock += 4 * MIN;
    expect(await scheduler().tick()).toMatchObject({ activationsRetried: 0 });
    expect(activate).not.toHaveBeenCalled();

    clock += 2 * MIN;
    expect(await scheduler().tick()).toMatchObject({ activationsRetried: 1, activationsRecovered: 1, activationsGaveUp: 0, errors: 0 });
    const after = await svc.must(t.id);
    expect(after.state).toBe("active");
    expect(after.tenantId).toMatch(/^t\d+-hotel-prueba$/);
    expect(await actions(t.id)).toEqual(["registered", "verify", "request_provisioning", "provisioning_failed", "activation_retry", "request_provisioning", "provisioned"]);
    // La bienvenida, una sola vez (la del alta completada)
    expect(sent.filter((m) => m.kind === "welcome")).toHaveLength(1);

    // Ya activa: no se vuelve a tocar
    clock += DAY;
    expect(await scheduler().tick()).toMatchObject({ activationsRetried: 0 });
    expect(activate).toHaveBeenCalledTimes(1);
    expect(raise).not.toHaveBeenCalled();
  });

  it("fallo persistente: para tras 5 reintentos, avisa a administración una vez y no escribe al cliente", async () => {
    const t = await failedTrial("luis@hotel.es");
    provisionFails = Number.POSITIVE_INFINITY;
    for (const [i, d] of ACTIVATION_RETRY_DELAYS_MS.entries()) {
      clock += d;
      const out = await scheduler().tick();
      expect(out).toMatchObject({ activationsRetried: 1, activationsRecovered: 0, activationsGaveUp: i === ACTIVATION_RETRY_DELAYS_MS.length - 1 ? 1 : 0, errors: 0 });
    }
    expect(activate).toHaveBeenCalledTimes(5);
    expect(raise).toHaveBeenCalledTimes(1);
    expect(raise.mock.calls[0][0]).toBe(ACTIVATION_GAVE_UP_ALERT);
    expect(raise.mock.calls[0][1]).toMatchObject({ key: `trial:${t.id}:activation_gave_up`, intervention: true, reference: `Prueba #${t.id}`, link: "#/operacion/pruebas" });
    expect(JSON.stringify(raise.mock.calls[0][1].details)).toContain("Fallo transitorio del aprovisionamiento");
    const ev = await store.events(t.id);
    expect(ev.filter((e) => e.action === "activation_retry").map((e) => e.detail)).toEqual(["intento 1 de 5", "intento 2 de 5", "intento 3 de 5", "intento 4 de 5", "intento 5 de 5"]);
    expect(ev.filter((e) => e.action === "activation_gave_up")).toHaveLength(1);

    // Agotados: ni reintentos ni más alertas; nada se borra y la prueba sigue verificada
    for (let i = 0; i < 3; i++) {
      clock += DAY;
      expect(await scheduler().tick()).toMatchObject({ activationsRetried: 0, activationsGaveUp: 0 });
    }
    expect(activate).toHaveBeenCalledTimes(5);
    expect(raise).toHaveBeenCalledTimes(1);
    expect((await svc.must(t.id)).state).toBe("verified");
    expect(sent.filter((m) => m.kind !== "verification")).toEqual([]);
  });

  it("si la alerta falla no deja constancia del abandono y la repite en un tick posterior", async () => {
    const t = await failedTrial("eva@hotel.es");
    provisionFails = Number.POSITIVE_INFINITY;
    raise.mockRejectedValueOnce(new Error("sin alertas"));
    for (const d of ACTIVATION_RETRY_DELAYS_MS) {
      clock += d;
      await scheduler().tick();
    }
    expect(await actions(t.id)).not.toContain("activation_gave_up");
    clock += 5 * MIN;
    expect(await scheduler().tick()).toMatchObject({ activationsRetried: 0, activationsGaveUp: 1 });
    expect(raise).toHaveBeenCalledTimes(2);
    expect(activate).toHaveBeenCalledTimes(5);
    expect(await actions(t.id)).toContain("activation_gave_up");
  });

  it("respeta la espera creciente entre reintentos", async () => {
    const t = await failedTrial("marta@hotel.es");
    provisionFails = 1;
    clock += 5 * MIN;
    expect(await scheduler().tick()).toMatchObject({ activationsRetried: 1, activationsRecovered: 0 });
    // Segundo reintento: 15 min después del último fallo
    clock += 14 * MIN;
    expect(await scheduler().tick()).toMatchObject({ activationsRetried: 0 });
    clock += MIN;
    expect(await scheduler().tick()).toMatchObject({ activationsRetried: 1, activationsRecovered: 1 });
    expect((await svc.must(t.id)).state).toBe("active");
    expect(activate).toHaveBeenCalledTimes(2);
  });

  it("con la activación automática apagada (o sin activación montada) no hace nada", async () => {
    const t = await failedTrial("pablo@hotel.es");
    autoProvision = false;
    clock += DAY;
    expect(await scheduler().tick()).toMatchObject({ activationsRetried: 0, activationsGaveUp: 0 });
    const none = new TrialScheduler({ store, notify, lock: memoryLock(), now: () => clock, recovery: () => null, log: () => undefined });
    expect(await none.tick()).toMatchObject({ activationsRetried: 0 });
    const absent = new TrialScheduler({ store, notify, lock: memoryLock(), now: () => clock, log: () => undefined });
    expect(await absent.tick()).toMatchObject({ activationsRetried: 0 });
    expect(activate).not.toHaveBeenCalled();
    expect(raise).not.toHaveBeenCalled();
    expect(await actions(t.id)).not.toContain("activation_retry");
  });

  it("no toca pruebas activas, vencidas ni verificadas sin activación fallida", async () => {
    const a = await verified("activa@hotel.es");
    await ob.activate(a.id, "system:trial");
    const e = await verified("vencida@hotel.es");
    await ob.activate(e.id, "system:trial");
    clock += 16 * DAY;
    await svc.markExpired(e.id, (await svc.must(e.id)).version, "op");
    await svc.approveExtension(a.id, (await svc.must(a.id)).version, 15, "op");
    const quieta = await verified("quieta@hotel.es");
    activate.mockClear();
    clock += DAY;
    expect(await scheduler().tick()).toMatchObject({ activationsRetried: 0, activationsGaveUp: 0 });
    expect(activate).not.toHaveBeenCalled();
    expect((await svc.must(a.id)).state).toBe("active");
    expect((await svc.must(e.id)).state).toBe("expired");
    expect((await svc.must(quieta.id)).state).toBe("verified");
  });

  it("alta interrumpida en «aprovisionando»: se retoma pasado el umbral y deja de contar para el límite de simultáneas", async () => {
    // Tres caídas del proceso a mitad del alta: «aprovisionando» sin más cambios
    const stuck = [];
    for (const email of ["c1@hotel1.es", "c2@hotel2.es", "c3@hotel3.es"]) {
      const v = await verified(email);
      stuck.push(await svc.requestProvisioning(v.id, v.version, "system:trial"));
    }
    const nueva = await verified("nueva@hotel4.es");
    await expect(svc.requestProvisioning(nueva.id, nueva.version, "system:trial")).rejects.toMatchObject({ code: "limit" });

    clock += 10 * MIN;
    expect(await scheduler().tick()).toMatchObject({ activationsRetried: 0 });
    clock += 6 * MIN;
    // Pasado el umbral ya no cuentan como en curso
    const p = await svc.requestProvisioning(nueva.id, nueva.version, "system:trial");
    expect(p.state).toBe("provisioning");
    expect(await scheduler().tick()).toMatchObject({ activationsRetried: 3, activationsRecovered: 3 });
    for (const s of stuck) expect((await svc.must(s.id)).state).toBe("active");
    // La recién pedida no está atascada: no se toca
    expect((await svc.must(nueva.id)).state).toBe("provisioning");
  });

  it("dos réplicas a la vez: una sola reintenta la misma alta", async () => {
    const t = await failedTrial("rosa@hotel.es");
    clock += 6 * MIN;
    const lock = memoryLock();
    const [x, y] = await Promise.all([scheduler(lock).tick(), scheduler(lock).tick()]);
    expect([x.skipped, y.skipped].filter((s) => s === "locked")).toHaveLength(1);
    expect(x.activationsRetried + y.activationsRetried).toBe(1);
    expect(activate).toHaveBeenCalledTimes(1);
    expect(provision).toHaveBeenCalledTimes(2);
    expect((await svc.must(t.id)).state).toBe("active");
  });
});
