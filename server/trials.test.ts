/**
 * Prueba autónoma de 15 días (preparación): máquina de estados, verificación, límites contra el
 * abuso, idempotencia, aprovisionamiento, ampliaciones, suspensión, conversión y auditoría. Nada se
 * ejecuta solo: el informe de vencidas no cambia ningún estado.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { TRANSITIONS, TRIAL_STATES, nextState, type TrialAction } from "./trials/machine";
import { MemoryTrialStore } from "./trials/store";
import { TRIAL_DAYS, TrialService } from "./trials/service";

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 9, 16, 9);
let clock = T0;
let store: MemoryTrialStore;
let svc: TrialService;
const subs = new Map<number, { id: number; tenantId: string | null; status: string }>([
  [1, { id: 1, tenantId: "acme", status: "active" }],
  [2, { id: 2, tenantId: "otra", status: "active" }],
]);
const key = (n: number) => `idem-${String(n).padStart(16, "0")}`;
const reg = (n: number, email = `ana${n}@acme.es`, ip: string | null = "10.0.0.1") =>
  svc.register({ email, companyName: "Acme", configuration: { plan: "business", addons: ["telefonia"] }, idempotencyKey: key(n), ip });

beforeEach(() => {
  clock = T0;
  store = new MemoryTrialStore();
  svc = new TrialService({ store, subscriptions: { get: async (id) => subs.get(id) ?? null }, now: () => clock });
});

describe("máquina de estados", () => {
  it("solo las transiciones declaradas; los estados terminales no salen", () => {
    for (const s of ["converted", "rejected", "cancelled"] as const) {
      for (const a of Object.keys(TRANSITIONS) as TrialAction[]) expect(nextState(s, a)).toBeNull();
    }
    expect(nextState("pending_verification", "request_provisioning")).toBeNull();
    expect(nextState("active", "request_extension")).toBe("active");
    expect(nextState("expired", "approve_extension")).toBe("active");
    expect(TRIAL_STATES.filter((s) => nextState(s, "cancel") !== null)).toEqual(["pending_verification", "verified", "provisioning", "active", "expired", "suspended"]);
  });
});

describe("registro y verificación", () => {
  it("flujo completo: registro → verificación → aprovisionamiento → prueba de 15 días → conversión, con auditoría", async () => {
    const r = await reg(1);
    expect(r.created).toBe(true);
    expect(r.verificationToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(r.trial.verificationTokenHash).not.toContain(r.verificationToken!);
    const v = await svc.verify(r.trial.id, r.verificationToken!);
    expect(v).toMatchObject({ state: "verified", verificationTokenHash: null });
    const p = await svc.requestProvisioning(v.id, v.version, "operator:ana");
    const a = await svc.markProvisioned(p.id, p.version, "acme", "provisioning");
    expect(a).toMatchObject({ state: "active", tenantId: "acme", startsAt: T0, endsAt: T0 + TRIAL_DAYS * DAY });
    const c = await svc.convert(a.id, a.version, 1, "operator:ana");
    expect(c).toMatchObject({ state: "converted", convertedSubscriptionId: 1 });
    expect((await store.events(c.id)).map((e) => `${e.action}:${e.toState}`)).toEqual([
      "registered:pending_verification",
      "verify:verified",
      "request_provisioning:provisioning",
      "provisioned:active",
      "convert:converted",
    ]);
    // Al convertirse, el correo puede volver a pedir otra prueba
    expect((await reg(9, "ana1@acme.es")).created).toBe(true);
  });

  it("token incorrecto o caducado: rechazado y sin cambios", async () => {
    const r = await reg(1);
    await expect(svc.verify(r.trial.id, "x".repeat(43))).rejects.toMatchObject({ code: "forbidden" });
    clock = T0 + 2 * DAY;
    await expect(svc.verify(r.trial.id, r.verificationToken!)).rejects.toThrow(/caducado/);
    expect((await svc.must(r.trial.id)).state).toBe("pending_verification");
  });

  it("idempotente por clave; un correo, una prueba abierta; entrada validada", async () => {
    const a = await reg(1);
    const again = await reg(1);
    expect(again).toMatchObject({ created: false, verificationToken: null });
    expect(again.trial.id).toBe(a.trial.id);
    await expect(reg(2, "ANA1@acme.es")).rejects.toMatchObject({ code: "conflict" });
    await expect(reg(3, "no-es-correo")).rejects.toMatchObject({ code: "invalid_input" });
    await expect(svc.register({ email: "b@c.es", companyName: "X", configuration: { plan: null, addons: [] }, idempotencyKey: key(4) })).rejects.toThrow(/Nombre de empresa/);
    await expect(svc.register({ email: "b@c.es", companyName: "Bien", configuration: { plan: "<script>", addons: [] }, idempotencyKey: key(5) })).rejects.toThrow(/Configuración/);
  });

  it("límites contra el abuso: por dominio (no a correos personales) y por IP", async () => {
    for (let i = 1; i <= 3; i++) await reg(i, `p${i}@empresa.es`, `10.0.0.${i}`);
    await expect(reg(4, "p4@empresa.es", "10.0.0.9")).rejects.toMatchObject({ code: "limit" });
    for (let i = 10; i < 14; i++) await reg(i, `u${i}@gmail.com`, "10.9.9.9");
    await reg(14, "u14@gmail.com", "10.9.9.9");
    await expect(reg(15, "u15@gmail.com", "10.9.9.9")).rejects.toMatchObject({ code: "limit" });
    clock = T0 + DAY + 1;
    expect((await reg(16, "u16@gmail.com", "10.9.9.9")).created).toBe(true);
  });
});

describe("aprovisionamiento, ampliación, suspensión y vencimiento", () => {
  async function active(n: number, tenant: string) {
    const r = await reg(n, `x${n}@t${n}.es`, `10.1.0.${n}`);
    const v = await svc.verify(r.trial.id, r.verificationToken!);
    const p = await svc.requestProvisioning(v.id, v.version, "op");
    return svc.markProvisioned(p.id, p.version, tenant, "prov");
  }

  it("límite de aprovisionamientos simultáneos; un fallo vuelve a «verificada» sin tenant", async () => {
    const ts = [];
    for (let i = 1; i <= 4; i++) {
      const r = await reg(i, `x${i}@t${i}.es`, `10.2.0.${i}`);
      ts.push(await svc.verify(r.trial.id, r.verificationToken!));
    }
    for (let i = 0; i < 3; i++) await svc.requestProvisioning(ts[i].id, ts[i].version, "op");
    await expect(svc.requestProvisioning(ts[3].id, ts[3].version, "op")).rejects.toMatchObject({ code: "limit" });
    const p = await svc.must(ts[0].id);
    expect((await svc.requestProvisioning(p.id, p.version, "op")).version).toBe(p.version); // idempotente
    const back = await svc.markProvisioningFailed(p.id, p.version, "BD no disponible", "prov");
    expect(back).toMatchObject({ state: "verified", tenantId: null });
  });

  it("un tenant no puede pertenecer a dos pruebas", async () => {
    await active(1, "acme");
    const r = await reg(2, "y@otra.es", "10.3.0.1");
    const v = await svc.verify(r.trial.id, r.verificationToken!);
    const p = await svc.requestProvisioning(v.id, v.version, "op");
    await expect(svc.markProvisioned(p.id, p.version, "acme", "prov")).rejects.toMatchObject({ code: "conflict" });
  });

  it("nada vence solo: el informe lista las vencidas y no cambia su estado; una persona las marca", async () => {
    const t = await active(1, "acme");
    await expect(svc.markExpired(t.id, t.version, "op")).rejects.toThrow(/todavía no ha vencido/);
    clock = T0 + 16 * DAY;
    const rep = await svc.dueForReview();
    expect(rep.expired.map((x) => x.id)).toEqual([t.id]);
    expect((await svc.must(t.id)).state).toBe("active");
    const e = await svc.markExpired(t.id, t.version, "op");
    expect(e.state).toBe("expired");
  });

  it("ampliación: solicitud del cliente, aprobación humana con límite de días y de veces", async () => {
    const t = await active(1, "acme");
    const req = await svc.requestExtension(t.id, t.version, "Necesitamos probar el TPV");
    expect((await svc.dueForReview()).extensionRequests.map((x) => x.id)).toEqual([t.id]);
    await expect(svc.approveExtension(req.id, req.version, 30, "op")).rejects.toMatchObject({ code: "invalid_input" });
    const ok = await svc.approveExtension(req.id, req.version, 7, "op");
    expect(ok).toMatchObject({ state: "active", endsAt: T0 + 22 * DAY, extensionsUsed: 1, extensionRequestedAt: null });
    await expect(svc.approveExtension(ok.id, ok.version, 3, "op")).rejects.toMatchObject({ code: "limit" });
  });

  it("suspensión y reactivación manuales; no se reactiva una prueba vencida", async () => {
    const t = await active(1, "acme");
    await expect(svc.suspend(t.id, t.version, " ", "op")).rejects.toThrow(/motivo/);
    const s = await svc.suspend(t.id, t.version, "Uso indebido", "op");
    expect(s).toMatchObject({ state: "suspended", suspendedReason: "Uso indebido" });
    const r = await svc.reactivate(s.id, s.version, "op");
    expect(r.state).toBe("active");
    const s2 = await svc.suspend(r.id, r.version, "Otra vez", "op");
    clock = T0 + 20 * DAY;
    await expect(svc.reactivate(s2.id, s2.version, "op")).rejects.toThrow(/ha vencido/);
  });

  it("conversión: la suscripción debe existir y ser del mismo tenant", async () => {
    const t = await active(1, "acme");
    await expect(svc.convert(t.id, t.version, 99, "op")).rejects.toMatchObject({ code: "invalid_input" });
    await expect(svc.convert(t.id, t.version, 2, "op")).rejects.toThrow(/otro tenant/);
    expect((await svc.convert(t.id, t.version, 1, "op")).state).toBe("converted");
  });

  it("versión desfasada: conflicto y nada cambia; la vista pública no expone hash, IP ni clave", async () => {
    const t = await active(1, "acme");
    await svc.suspend(t.id, t.version, "x", "op");
    await expect(svc.cancel(t.id, t.version, "y", "op")).rejects.toMatchObject({ code: "conflict" });
    const view = TrialService.view(await svc.must(t.id));
    expect(Object.keys(view)).not.toEqual(expect.arrayContaining(["verificationTokenHash"]));
    expect(JSON.stringify(view)).not.toMatch(/ipHash|idempotencyKey|verificationTokenHash/);
  });
});
