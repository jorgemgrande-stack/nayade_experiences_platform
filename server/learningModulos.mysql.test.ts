/**
 * Elephant LMS: acceso con ventana propia por módulo, desbloqueo progresivo, ampliación individual y activación segura de reglas.
 * MySQL real (opt-in, REGISTRY_TEST_DATABASE_URL). Usa la lógica de BD directamente (sin aplicación ni pasarela): el pago es una
 * referencia de prueba y nunca hay cobros ni correos.
 */
import mysql from "mysql2/promise";
import { readFileSync } from "node:fs";
import { drizzle } from "drizzle-orm/mysql2";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
vi.setConfig({ testTimeout: 60_000 });

let pool: mysql.Pool | null = null;
let database: ReturnType<typeof drizzle> | null = null;
vi.mock("./db", () => ({ getDb: async () => database }));

const DAY = 86_400_000;
const T0 = Date.parse("2026-12-01T10:00:00Z");

describe.skipIf(!URL_)("LMS: ventana por módulo, desbloqueo progresivo, ampliación individual y activación segura", () => {
  let L: typeof import("./learningDb");
  const c = { exp: 777, course: 0, m: [0, 0, 0] as number[], l: [0, 0, 0] as number[], b: [0, 0, 0] as number[], res: 0 };
  let nextUser = 100;
  const user = () => ++nextUser;
  const q = async (text: string, params: unknown[] = []) => ((await pool!.query(text, params)) as any)[0] as any[];

  const grant = async (userId: number, variantId: number, opId: number, now = T0) =>
    (await L.grantFromPayment({ userId, clientId: null, experienceId: c.exp, variantId, operation: { kind: "order", id: opId }, payment: { reference: `PRUEBA-${opId}`, amountCents: 33300, verifiedBy: "prueba" }, actorUserId: null, now })).granted[0].enrollment;
  const can = async (userId: number, moduleIdx: number, now: number) => (await L.canAccessModule(userId, c.course, c.m[moduleIdx], now)) as { allowed: boolean; reason?: string; unlocksAt?: number };
  const rule = (variantId: number, moduleIdx: number[], extra: Record<string, unknown> = {}) =>
    L.saveRule({ experienceId: c.exp, variantId, courseId: c.course, moduleIds: moduleIdx.map((i) => c.m[i]), durationDays: 90, startMode: "on_grant", fixedStart: null, active: true, ...extra } as any);

  beforeAll(async () => {
    const base = new URL(URL_!);
    const admin = await mysql.createConnection({ host: base.hostname, port: Number(base.port || 3306), user: decodeURIComponent(base.username), password: decodeURIComponent(base.password) });
    const dbName = `lms_mod_${Date.now().toString(36)}`;
    await admin.query(`CREATE DATABASE ${dbName}`);
    await admin.end();
    pool = mysql.createPool({ host: base.hostname, port: Number(base.port || 3306), user: decodeURIComponent(base.username), password: decodeURIComponent(base.password), database: dbName, multipleStatements: true, flags: ["+FOUND_ROWS"] });
    database = drizzle(pool);
    for (const f of ["0079_learning_core.sql", "0089_learning_acceso_por_modulo.sql"]) await pool.query(readFileSync(new URL(`../db/migrations/${f}`, import.meta.url), "utf8"));
    L = await import("./learningDb");
    const now = Date.now();
    await q("INSERT INTO learning_courses (slug, title, language, status, created_at, updated_at) VALUES ('reconnect-mod','RECONNECT','de','published',?,?)", [now, now]);
    c.course = Number((await q("SELECT id FROM learning_courses WHERE slug = 'reconnect-mod'"))[0].id);
    await q("INSERT INTO learning_resources (kind, status, stored_object_id, created_at, updated_at) VALUES ('pdf','verified','OBJ-PRUEBA-0000000000001',?,?)", [now, now]);
    c.res = Number((await q("SELECT id FROM learning_resources LIMIT 1"))[0].id);
    for (const k of [0, 1, 2]) {
      await q("INSERT INTO learning_modules (course_id, position, title, source_key, created_at, updated_at) VALUES (?,?,?,?,?,?)", [c.course, k + 1, `TEIL ${k + 1}`, `m${k}`, now, now]);
      c.m[k] = Number((await q("SELECT id FROM learning_modules WHERE course_id = ? AND source_key = ?", [c.course, `m${k}`]))[0].id);
      await q("INSERT INTO learning_lessons (module_id, position, title, source_key, created_at, updated_at) VALUES (?,?,?,?,?,?)", [c.m[k], 1, `Lektion ${k + 1}`, `l${k}`, now, now]);
      c.l[k] = Number((await q("SELECT id FROM learning_lessons WHERE module_id = ?", [c.m[k]]))[0].id);
      await q("INSERT INTO learning_blocks (lesson_id, position, kind, title, body, resource_id, source_key, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)", [c.l[k], 1, k === 1 ? "pdf" : "text", `Block ${k + 1}`, "texto", k === 1 ? c.res : null, `b${k}`, now, now]);
      c.b[k] = Number((await q("SELECT id FROM learning_blocks WHERE lesson_id = ?", [c.l[k]]))[0].id);
    }
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
  });

  describe("permisos por modalidad", () => {
    it("LIVE (sin regla) no concede nada; +M1 solo el M1; COMPLETO e INTENSIV los tres", async () => {
      await rule(13, [0]);
      await rule(9, [0, 1, 2]);
      await rule(11, [0, 1, 2]);
      const live = user(), plus = user(), full = user(), intensiv = user();
      expect((await L.grantFromPayment({ userId: live, clientId: null, experienceId: c.exp, variantId: 8, operation: { kind: "order", id: 1 }, payment: { reference: "P-1", amountCents: 1000, verifiedBy: "prueba" }, actorUserId: null, now: T0 })).granted).toEqual([]);
      await grant(plus, 13, 2);
      await grant(full, 9, 3);
      await grant(intensiv, 11, 4);
      for (const i of [0, 1, 2]) expect((await can(live, i, T0)).allowed).toBe(false);
      expect([(await can(plus, 0, T0)).allowed, (await can(plus, 1, T0)).allowed, (await can(plus, 2, T0)).allowed]).toEqual([true, false, false]);
      expect((await can(plus, 1, T0)).reason).toBe("module_not_granted");
      for (const u of [full, intensiv]) for (const i of [0, 1, 2]) expect((await can(u, i, T0)).allowed).toBe(true);
      // sin calendario en la regla no se guarda ninguna ventana propia: comportamiento de siempre
      const [e] = await q("SELECT ends_at FROM learning_enrollments WHERE user_id = ?", [full]);
      expect(Number(e.ends_at)).toBe(T0 + 90 * DAY);
      expect(await q("SELECT 1 FROM learning_enrollment_modules m JOIN learning_enrollments e ON e.id = m.enrollment_id WHERE e.user_id = ? AND (m.starts_at IS NOT NULL OR m.ends_at IS NOT NULL)", [full])).toEqual([]);
    });
  });

  describe("desbloqueo progresivo", () => {
    it("M1 desde el día 0, M2 a los 30 días y M3 a los 60 (antes/después de cada umbral); canAccessBlock y recursos igual", async () => {
      await rule(20, [0, 1, 2], { moduleSettings: [{ moduleId: c.m[1], unlockOffsetDays: 30 }, { moduleId: c.m[2], unlockOffsetDays: 60 }] });
      const u = user();
      const enr = await grant(u, 20, 10);
      expect(enr.endsAt).toBe(T0 + 150 * DAY); // el último módulo (60 + 90 días)
      expect((await can(u, 0, T0)).allowed).toBe(true);
      const a = await can(u, 1, T0 + 30 * DAY - 1);
      expect(a).toMatchObject({ allowed: false, reason: "not_started", unlocksAt: T0 + 30 * DAY });
      expect((await can(u, 1, T0 + 30 * DAY)).allowed).toBe(true);
      expect((await can(u, 2, T0 + 60 * DAY - 1)).allowed).toBe(false);
      expect((await can(u, 2, T0 + 60 * DAY)).allowed).toBe(true);
      // el contenido de un módulo no desbloqueado no se abre (bloque y recurso)
      expect((await L.canAccessBlock(u, c.b[1], T0 + 10 * DAY)).allowed).toBe(false);
      expect((await L.canAccessBlock(u, c.b[1], T0 + 31 * DAY)).allowed).toBe(true);
      expect((await L.authorizeResource(u, c.res, T0 + 10 * DAY))).toMatchObject({ allowed: false, reason: "not_started" });
      expect((await L.authorizeResource(u, c.res, T0 + 31 * DAY)).allowed).toBe(true);
      // el alumno ve «se desbloquea el …» en su aula, sin acceso al contenido
      const [course] = await L.myCourses(u, T0 + 10 * DAY);
      expect(course.status).toBe("active");
      expect(course.modules.find((m) => m.moduleId === c.m[1])).toMatchObject({ state: "locked", unlocksAt: T0 + 30 * DAY });
      expect(course.modules.find((m) => m.moduleId === c.m[0])?.state).toBe("open");
      await expect(L.recordProgress(u, c.l[1], { completed: true }, T0 + 10 * DAY)).rejects.toMatchObject({ code: "FORBIDDEN" });
      // el desbloqueo es por matrícula: otro alumno comprado más tarde tiene su propio reloj
      const late = user();
      await grant(late, 20, 11, T0 + 20 * DAY);
      expect((await can(late, 1, T0 + 31 * DAY)).allowed).toBe(false);
      expect((await can(late, 1, T0 + 50 * DAY)).allowed).toBe(true);
    });

    it("la caducidad programada solo cierra la matrícula cuando acaba su último módulo", async () => {
      const [e] = await q("SELECT id FROM learning_enrollments WHERE payment_ref = 'PRUEBA-10'");
      await L.expireDue(T0 + 100 * DAY); // M1 ya caducó (día 90) pero M2 y M3 siguen: esta matrícula no se toca
      expect((await q("SELECT status FROM learning_enrollments WHERE id = ?", [e.id]))[0].status).toBe("active");
      await L.expireDue(T0 + 151 * DAY);
      expect((await q("SELECT status FROM learning_enrollments WHERE id = ?", [e.id]))[0].status).toBe("expired");
    });
  });

  describe("caducidad individual por módulo", () => {
    it("un módulo con duración propia caduca solo; el otro hereda la de la regla; el progreso se conserva", async () => {
      await rule(21, [0, 1], { moduleSettings: [{ moduleId: c.m[0], durationDays: 30 }] });
      const u = user();
      await grant(u, 21, 20);
      await L.recordProgress(u, c.l[0], { completed: true }, T0 + DAY);
      expect((await can(u, 0, T0 + 30 * DAY - 1)).allowed).toBe(true);
      expect(await can(u, 0, T0 + 30 * DAY)).toMatchObject({ allowed: false, reason: "expired" });
      expect((await can(u, 1, T0 + 30 * DAY)).allowed).toBe(true); // hereda 90 días
      expect((await can(u, 1, T0 + 90 * DAY)).allowed).toBe(false);
      const [course] = await L.myCourses(u, T0 + 40 * DAY);
      expect(course.completedLessons).toBe(1); // lo completado en el módulo caducado sigue contando
      expect(course.modules.find((m) => m.moduleId === c.m[0])?.state).toBe("closed");
      expect((await q("SELECT status FROM learning_progress WHERE user_id = ?", [u]))[0].status).toBe("completed");
    });
  });

  describe("ampliación individual por módulo", () => {
    const ev = (n: number) => q("SELECT type FROM learning_access_events WHERE enrollment_id = ? ORDER BY id", [n]);

    it("+30 desde el fin actual si aún no ha caducado; +60 desde ahora si ya caducó; no toca otros módulos", async () => {
      await rule(22, [0, 1], { moduleSettings: [{ moduleId: c.m[0], durationDays: 30 }] });
      const u = user();
      const enr = await grant(u, 22, 30);
      // a tiempo: parte del fin actual (T0+30d), no de ahora
      const r1 = await L.extendModuleAccess(enr.id, c.m[0], 30, { orderRef: "PED-A", paymentRef: "PAGO-A" }, { userId: 1 }, T0 + 10 * DAY);
      expect(r1).toMatchObject({ applied: true, previousEndsAt: T0 + 30 * DAY, newEndsAt: T0 + 60 * DAY });
      expect((await can(u, 0, T0 + 59 * DAY)).allowed).toBe(true);
      expect((await can(u, 0, T0 + 60 * DAY)).allowed).toBe(false);
      // tarde (ya caducado): parte de ahora
      const r2 = await L.extendModuleAccess(enr.id, c.m[0], 60, { orderRef: "PED-B" }, { userId: 1 }, T0 + 70 * DAY);
      expect(r2).toMatchObject({ applied: true, previousEndsAt: T0 + 60 * DAY, newEndsAt: T0 + 130 * DAY });
      expect((await can(u, 0, T0 + 129 * DAY)).allowed).toBe(true);
      // el módulo 2 conserva su fin original (90 días) aunque el de la matrícula se haya movido
      expect((await can(u, 1, T0 + 89 * DAY)).allowed).toBe(true);
      expect((await can(u, 1, T0 + 90 * DAY)).allowed).toBe(false);
      const types = (await ev(enr.id)).map((e) => e.type);
      expect(types).toEqual(["granted", "module_extended", "module_extended"]);
    });

    it("matrícula caducada: la ampliación reabre solo ese módulo, no los demás", async () => {
      await rule(23, [0, 1], { durationDays: 30 });
      const u = user();
      const enr = await grant(u, 23, 31);
      expect(await L.expireDue(T0 + 31 * DAY)).toBeGreaterThanOrEqual(1);
      const r = await L.extendModuleAccess(enr.id, c.m[1], 30, { orderRef: "PED-C" }, { userId: 1 }, T0 + 40 * DAY);
      expect(r.newEndsAt).toBe(T0 + 70 * DAY);
      expect((await can(u, 1, T0 + 41 * DAY)).allowed).toBe(true);
      expect((await can(u, 0, T0 + 41 * DAY)).allowed).toBe(false); // el M1 sigue caducado
      expect((await L.getEnrollment(enr.id))!.status).toBe("active");
    });

    it("es idempotente: pedido+módulo+días no se aplica dos veces (ni en paralelo)", async () => {
      await rule(24, [0], { durationDays: 30 });
      const u = user();
      const enr = await grant(u, 24, 40);
      const results = await Promise.all([1, 2, 3, 4].map(() => L.extendModuleAccess(enr.id, c.m[0], 30, { orderRef: "PED-D" }, { userId: 1 }, T0 + DAY)));
      expect(results.filter((r) => r.applied)).toHaveLength(1);
      expect(new Set(results.map((r) => r.newEndsAt)).size).toBe(1);
      expect((await L.getEnrollment(enr.id))!.endsAt).toBe(T0 + 60 * DAY);
      expect(await q("SELECT 1 FROM learning_module_extensions WHERE enrollment_id = ?", [enr.id])).toHaveLength(1);
      expect((await ev(enr.id)).filter((e) => e.type === "module_extended")).toHaveLength(1);
      // otra cantidad de días con el mismo pedido es otra ampliación (otra clave)
      expect((await L.extendModuleAccess(enr.id, c.m[0], 60, { orderRef: "PED-D" }, { userId: 1 }, T0 + DAY)).applied).toBe(true);
    });

    it("rechaza: módulo no incluido, matrícula revocada o suspendida, días no permitidos, sin referencia y módulo sin caducidad", async () => {
      await rule(25, [0], { durationDays: 30 });
      const u = user();
      const enr = await grant(u, 25, 50);
      await expect(L.extendModuleAccess(enr.id, c.m[2], 30, { orderRef: "PED-E" }, { userId: 1 }, T0)).rejects.toMatchObject({ code: "BAD_REQUEST" });
      await expect(L.extendModuleAccess(enr.id, c.m[0], 45, { orderRef: "PED-E" }, { userId: 1 }, T0)).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(L.extendModuleAccess(enr.id, c.m[0], 30, {}, { userId: 1 }, T0)).rejects.toMatchObject({ code: "BAD_REQUEST" });
      // un administrador puede otros días (hasta 365)
      expect((await L.extendModuleAccess(enr.id, c.m[0], 45, { orderRef: "PED-E" }, { userId: 1, isAdmin: true }, T0)).newEndsAt).toBe(T0 + 75 * DAY);
      await expect(L.extendModuleAccess(enr.id, c.m[0], 400, { orderRef: "PED-F" }, { userId: 1, isAdmin: true }, T0)).rejects.toMatchObject({ code: "BAD_REQUEST" });
      await L.suspendEnrollment(enr.id, "Prueba de suspensión", 1, T0);
      await expect(L.extendModuleAccess(enr.id, c.m[0], 30, { orderRef: "PED-G" }, { userId: 1 }, T0)).rejects.toMatchObject({ code: "CONFLICT" });
      await L.revokeEnrollment(enr.id, "Prueba de revocación", 1, T0);
      await expect(L.extendModuleAccess(enr.id, c.m[0], 30, { orderRef: "PED-G" }, { userId: 1 }, T0)).rejects.toMatchObject({ code: "CONFLICT" });
      // módulo sin caducidad (regla permanente): no hay nada que ampliar
      await rule(26, [0], { durationDays: null, permanent: true });
      const p = await grant(user(), 26, 51);
      expect(p.endsAt).toBeNull();
      await expect(L.extendModuleAccess(p.id, c.m[0], 30, { orderRef: "PED-H" }, { userId: 1 }, T0)).rejects.toMatchObject({ code: "CONFLICT" });
    });
  });

  describe("aislamiento entre alumnos", () => {
    it("el alumno A no accede ni se le amplía con lo del B; una referencia de pedido no pasa de una matrícula a otra", async () => {
      await rule(27, [0, 1], { durationDays: 30 });
      await rule(28, [0], { durationDays: 30 });
      const a = user(), b = user(), nobody = user();
      const ea = await grant(a, 28, 60); // A: solo M1
      const eb = await grant(b, 27, 61); // B: M1 y M2
      expect((await can(a, 1, T0)).allowed).toBe(false);
      expect((await can(nobody, 0, T0)).allowed).toBe(false);
      await expect(L.recordProgress(a, c.l[1], { completed: true }, T0)).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect((await L.authorizeResource(a, c.res, T0)).allowed).toBe(false); // el recurso es del M2
      expect((await L.authorizeResource(b, c.res, T0)).allowed).toBe(true);
      // ampliar la matrícula de A no mueve nada en la de B
      await L.extendModuleAccess(ea.id, c.m[0], 30, { orderRef: "PED-I" }, { userId: 1 }, T0);
      expect((await L.getEnrollment(eb.id))!.endsAt).toBe(T0 + 30 * DAY);
      expect((await can(b, 0, T0 + 31 * DAY)).allowed).toBe(false);
      // el mismo pedido no se puede «reutilizar» sobre la matrícula de B
      await expect(L.extendModuleAccess(eb.id, c.m[0], 30, { orderRef: "PED-I" }, { userId: 1 }, T0)).rejects.toMatchObject({ code: "CONFLICT" });
      // y A no se amplía el módulo que no tiene
      await expect(L.extendModuleAccess(ea.id, c.m[1], 30, { orderRef: "PED-J" }, { userId: 1 }, T0)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });
  });

  describe("activación segura de reglas", () => {
    it("no activa una regla con módulos sin duración (propia ni heredada) salvo permanent explícito", async () => {
      await expect(rule(30, [0, 1], { durationDays: null })).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("duración") });
      // la duración propia de TODOS los módulos basta
      await expect(rule(31, [0, 1], { durationDays: null, moduleSettings: [{ moduleId: c.m[0], durationDays: 30 }] })).rejects.toMatchObject({ code: "BAD_REQUEST" });
      await expect(rule(32, [0, 1], { durationDays: null, moduleSettings: [{ moduleId: c.m[0], durationDays: 30 }, { moduleId: c.m[1], durationDays: 60 }] })).resolves.toBeGreaterThan(0);
      // heredar la de la regla basta
      await expect(rule(33, [0, 1], { durationDays: 90 })).resolves.toBeGreaterThan(0);
      // sin duración pero declarado de forma expresa
      const id = await rule(34, [0], { durationDays: null, permanent: true });
      expect((await L.listRules()).find((r) => r.id === id)).toMatchObject({ permanent: true, durationDays: null, active: true });
      // sin activar (borrador) se puede guardar sin duración
      await expect(rule(35, [0], { durationDays: null, active: false })).resolves.toBeGreaterThan(0);
    });

    it("al editar una regla guardada, activarla sin duración se rechaza y «permanent» y el calendario se conservan", async () => {
      const draft = await rule(36, [0, 1], { durationDays: null, active: false });
      await expect(L.saveRule({ experienceId: c.exp, variantId: 36, courseId: c.course, moduleIds: [c.m[0], c.m[1]], durationDays: null, startMode: "on_grant", fixedStart: null, active: true }, draft)).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect((await L.listRules()).find((r) => r.id === draft)!.active).toBe(false);
      const perm = await rule(37, [0], { durationDays: null, permanent: true, active: false });
      await L.saveRule({ experienceId: c.exp, variantId: 37, courseId: c.course, moduleIds: [c.m[0]], durationDays: null, startMode: "on_grant", fixedStart: null, active: true }, perm); // sin repetir «permanent»: se conserva
      expect((await L.listRules()).find((r) => r.id === perm)).toMatchObject({ active: true, permanent: true });
      const sched = await rule(38, [0, 1], { moduleSettings: [{ moduleId: c.m[1], unlockOffsetDays: 30 }], active: false });
      await L.saveRule({ experienceId: c.exp, variantId: 38, courseId: c.course, moduleIds: [c.m[0], c.m[1]], durationDays: 90, startMode: "on_grant", fixedStart: null, active: true }, sched);
      expect((await L.listRules()).find((r) => r.id === sched)!.moduleSchedule).toEqual({ [c.m[1]]: { unlockOffsetDays: 30, durationDays: null } });
    });

    it("un ajuste fuera de rango o de un módulo ajeno a la regla se rechaza", async () => {
      await expect(rule(39, [0], { moduleSettings: [{ moduleId: c.m[1], unlockOffsetDays: 30 }] })).rejects.toMatchObject({ code: "BAD_REQUEST" });
      await expect(rule(39, [0], { moduleSettings: [{ moduleId: c.m[0], durationDays: 0 }] })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });
  });
});
