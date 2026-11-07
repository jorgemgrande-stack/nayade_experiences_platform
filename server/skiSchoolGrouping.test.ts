/**
 * Ski Net · Cursillos y grupos por niveles: reglas puras (tramos de edad, grupos equilibrados, agrupación por nivel,
 * edad e idioma respetando aforo, grupos vacíos, fusión) y servicio con la licencia REAL por capacidad en memoria:
 * bolsa del turno, propuesta revisable con huella, aplicación con las reglas de la escuela, fusión y división.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { CapabilityAccess } from "./_core/capabilities/access";
import { MemoryCapabilityStore } from "./_core/capabilities/store";
import { runWithTenant } from "./_core/tenant";
import { EventBus, ModuleGate, ModuleNotLicensed, SdkModuleRegistry, SiteUnknown } from "./sdk";
import { SKI_SCHOOL_ID, skiSchoolModule, type SkiSchoolEvents } from "./skiSchool/manifest";
import { ageBand, balancedSizes, mergeProblem, planGroups, type PoolStudent, type TurnSession } from "./skiSchool/grouping";
import { SkiGroupingService } from "./skiSchool/groupingService";
import { MemorySkiGroupingStore } from "./skiSchool/groupingStore";
import { SkiSchoolService } from "./skiSchool/service";
import { MemorySkiSchoolStore } from "./skiSchool/store";

const st = (poolId: number, o: Partial<PoolStudent> = {}): PoolStudent => ({ poolId, name: `Alumno ${poolId}`, age: 10, level: "B", language: "es", ...o });
const ses = (id: number, o: Partial<TurnSession> = {}): TurnSession => ({ id, capacity: 4, level: "B", language: "es", ages: [], enrolled: 0, ...o });

describe("agrupación (reglas puras)", () => {
  it("tramos de edad y grupos equilibrados sin superar el aforo", () => {
    expect([ageBand(4), ageBand(7), ageBand(12), ageBand(15), ageBand(40), ageBand(null)]).toEqual(["3-5", "6-8", "9-12", "13-17", "adultos", "sin-edad"]);
    expect(balancedSizes(9, 4)).toEqual([3, 3, 3]);
    expect(balancedSizes(10, 4)).toEqual([4, 3, 3]);
    expect(balancedSizes(4, 4)).toEqual([4]);
    expect(balancedSizes(0, 4)).toEqual([]);
  });

  it("por nivel, edad e idioma: completa primero las sesiones compatibles y equilibra las nuevas", () => {
    const students = [
      ...[1, 2, 3, 4, 5, 6, 7].map((i) => st(i)),
      st(8, { level: "C" }),
      st(9, { language: "en" }),
      st(10, { age: 15 }),
    ];
    const p = planGroups(students, [ses(100, { enrolled: 2, ages: [11, 9] }), ses(101, { level: "D" }), ses(102, { enrolled: 1, ages: [16] })], { capacity: 4, useLanguage: true });
    const summary = p.groups.map((g) => [g.kind, g.kind === "incorporate" ? g.sessionId : null, g.level, g.language, g.ageBand, g.poolIds]);
    expect(summary).toEqual([
      ["incorporate", 102, "B", "es", "13-17", [10]],
      ["new_session", null, "B", "en", "9-12", [9]],
      ["incorporate", 100, "B", "es", "9-12", [1, 2]],
      ["new_session", null, "B", "es", "9-12", [3, 4, 5]],
      ["new_session", null, "B", "es", "9-12", [6, 7]],
      ["new_session", null, "C", "es", "9-12", [8]],
    ]);
    // Ningún grupo supera el aforo y la sesión de nivel D queda vacía
    for (const g of p.groups) expect(g.poolIds.length).toBeLessThanOrEqual(4);
    expect(p.emptySessionIds).toEqual([101]);
    expect(p.fingerprint).toMatch(/^[a-f0-9]{32}$/);
    expect(planGroups(students, [ses(100, { enrolled: 2, ages: [11, 9] }), ses(101, { level: "D" }), ses(102, { enrolled: 1, ages: [16] })], { capacity: 4, useLanguage: true }).fingerprint).toBe(p.fingerprint);
  });

  it("escuelita: no separa por idioma; edades distintas nunca comparten grupo", () => {
    const p = planGroups([st(1, { age: 4, language: "es" }), st(2, { age: 5, language: "en" }), st(3, { age: 7 })], [], { capacity: 8, useLanguage: false });
    expect(p.groups.map((g) => [g.ageBand, g.poolIds])).toEqual([
      ["3-5", [1, 2]],
      ["6-8", [3]],
    ]);
  });

  it("fusión: mismo nivel e idioma y que quepan", () => {
    expect(mergeProblem({ capacity: 6, level: "B", language: "es", enrolled: 3 }, { level: "B", language: "es", enrolled: 3 })).toBeNull();
    expect(mergeProblem({ capacity: 6, level: "B", language: "es", enrolled: 4 }, { level: "B", language: null, enrolled: 3 })).toMatch(/No caben/);
    expect(mergeProblem({ capacity: 6, level: "B", language: null, enrolled: 1 }, { level: "C", language: null, enrolled: 1 })).toMatch(/niveles/);
  });
});

const NOW = Date.UTC(2026, 11, 1, 9);
const T = "acme";
const MON = "2026-12-07";

describe("servicio de grupos con licencia por capacidad", () => {
  let caps: MemoryCapabilityStore;
  let school: MemorySkiSchoolStore;
  let svc: SkiSchoolService;
  let grouping: SkiGroupingService;
  const sites = new Set(["s1"]);
  const inT = <R>(fn: () => Promise<R>) => runWithTenant(T, fn);

  beforeEach(() => {
    caps = new MemoryCapabilityStore();
    school = new MemorySkiSchoolStore();
    const registry = new SdkModuleRegistry();
    registry.registerAll([skiSchoolModule]);
    const access = new CapabilityAccess(caps, { enforce: true, ttlMs: 0, now: () => NOW });
    const gate = new ModuleGate(registry, { capabilities: () => access });
    const bus = new EventBus<SkiSchoolEvents>({ now: () => NOW });
    const assert = async (s: string) => {
      if (!sites.has(s)) throw new SiteUnknown(SKI_SCHOOL_ID, s);
    };
    svc = new SkiSchoolService({ store: school, gate: () => gate, events: () => bus, assertSite: assert });
    grouping = new SkiGroupingService({ store: new MemorySkiGroupingStore(), school, service: svc, gate: () => gate, assertSite: assert });
  });
  const license = () => caps.apply(T, [{ capabilityId: "ski-school", siteId: "", status: "active", validUntil: null, source: "operator" }], { actor: "t", reason: null, now: NOW });

  async function turn(capacity = 4) {
    await svc.activateSite("s1", "u");
    const p = await svc.createProduct("s1", { name: "Cursillo mañanas", kind: "group", durationMinutes: 120, capacity });
    return { siteId: "s1", productId: p.id, date: MON, startTime: "10:00" };
  }

  it("sin licencia: error tipado", async () => {
    await inT(async () => {
      await expect(grouping.propose({ siteId: "s1", productId: 1, date: MON, startTime: "10:00" })).rejects.toBeInstanceOf(ModuleNotLicensed);
    });
  });

  it("bolsa → propuesta revisable → aplicar exactamente lo revisado; la escuela comprueba aforo y nivel", async () => {
    await license();
    await inT(async () => {
      const t = await turn();
      const priv = await svc.createProduct("s1", { name: "Particular", kind: "private", durationMinutes: 60, capacity: 2 });
      await expect(grouping.propose({ ...t, productId: priv.id })).rejects.toThrow(/particulares/);
      for (let i = 1; i <= 6; i++) await grouping.addToPool(t, { name: `Alumno ${i}`, age: 10, level: i <= 5 ? "B" : "C", language: "es" }, "u");
      await expect(grouping.addToPool(t, { name: "Nivel raro", level: "Z" }, "u")).rejects.toMatchObject({ code: "invalid_input" });
      const p = await grouping.propose(t);
      expect(p.groups.map((g) => [g.kind, g.level, g.poolIds.length])).toEqual([
        ["new_session", "B", 3],
        ["new_session", "B", 2],
        ["new_session", "C", 1],
      ]);
      // Alguien añade un alumno entretanto: la propuesta revisada ya no vale
      const late = await grouping.addToPool(t, { name: "Llega tarde", age: 10, level: "C", language: "es" }, "u");
      await expect(grouping.apply(t, p.fingerprint, "u")).rejects.toThrow(/ha cambiado/);
      const p2 = await grouping.propose(t);
      expect(await grouping.apply(t, p2.fingerprint, "u")).toMatchObject({ created: 3, placed: 7 });
      const view = await grouping.turn(t);
      expect(view.sessions.map((s) => [s.level, s.participants.length])).toEqual([
        ["B", 3],
        ["B", 2],
        ["C", 2],
      ]);
      expect(view.pool.every((e) => e.status === "placed")).toBe(true);
      expect(view.pool.find((e) => e.id === late.id)!.sessionId).toBe(view.sessions[2].id);
      await expect(grouping.apply(t, p2.fingerprint, "u")).rejects.toThrow(/ha cambiado|No hay alumnos/);
      // Nuevos alumnos: se incorporan a los grupos con sitio antes que crear otro
      await grouping.addToPool(t, { name: "Uno más", age: 11, level: "B", language: "es" }, "u");
      const p3 = await grouping.propose(t);
      expect(p3.groups).toEqual([expect.objectContaining({ kind: "incorporate", sessionId: view.sessions[0].id, poolIds: [8] })]);
    });
  });

  it("fusión y división de grupos del turno", async () => {
    await license();
    await inT(async () => {
      const t = await turn(6);
      for (let i = 1; i <= 7; i++) await grouping.addToPool(t, { name: `Alumno ${i}`, age: 10, level: "B", language: "es" }, "u");
      await grouping.apply(t, (await grouping.propose(t)).fingerprint, "u");
      const [a, b] = (await grouping.turn(t)).sessions;
      expect([a.participants.length, b.participants.length]).toEqual([4, 3]);
      await expect(grouping.merge("s1", a.id, b.id)).rejects.toThrow(/No caben: 7 alumnos para 6/);
      // División: dos de A a un grupo nuevo; ahora A (2) y B (3) sí se fusionan
      const sp = await grouping.split("s1", a.id, a.participants.slice(0, 2).map((p) => p.id), "u");
      expect(sp.moved).toBe(2);
      await expect(grouping.split("s1", a.id, a.participants.slice(2).map((p) => p.id), "u")).rejects.toThrow(/no todos|no están/);
      const m = await grouping.merge("s1", b.id, a.id);
      expect(m.moved).toBe(2);
      const after = await grouping.turn(t);
      expect(after.sessions.map((s) => [s.id, s.participants.length]).sort((x, y) => x[0] - y[0])).toEqual([
        [b.id, 5],
        [sp.newSessionId, 2],
      ]);
      expect((await school.session(a.id))!.status).toBe("cancelled");
      const other = await svc.createSession("s1", { productId: t.productId, date: MON, startTime: "12:00" }, "u");
      await expect(grouping.merge("s1", b.id, other.id)).rejects.toThrow(/mismo turno/);
    });
  });
});
