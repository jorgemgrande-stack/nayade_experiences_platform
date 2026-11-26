/**
 * Activación VOLUNTARIA del acceso (p. ej. Módulo 1 incluido en los retiros de seis días o más: 30 días que el alumno inicia cuando
 * quiere). Nivel de datos con MySQL real (opt-in con REGISTRY_TEST_DATABASE_URL), sin pasarela ni cobros ni correos.
 *  (a) el derecho se concede solo con pago confirmado y queda PENDIENTE: sin ventana, sin acceso, sin caducidad automática,
 *  (b) al activar, los 30 días empiezan en el instante exacto y el acceso se abre y se cierra a los 30 días,
 *  (c) dobles activaciones y llamadas simultáneas no mueven la ventana ni duplican nada,
 *  (d) solo el titular activa; una matrícula revocada o suspendida no se activa,
 *  (e) la regla exige días de acceso y no admite fecha fija ni desbloqueo progresivo,
 *  (f) el resto de matrículas del alumno no se tocan.
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
vi.mock("./config", () => ({ getSystemSetting: async (_k: string, f = "") => f }));

const DAY = 86_400_000;

describe.skipIf(!URL_)("Activación voluntaria del acceso (30 días a elección del alumno)", () => {
  let L: typeof import("./learningDb");
  const c = { course: 0, m: [0, 0, 0] as number[] };
  const V = { retiro6: 61, retiro4: 62, online: 10 };
  const EXP = 5;
  let op = 100;
  let userSeq = 500;
  const q = async (text: string, params: unknown[] = []) => ((await pool!.query(text, params)) as any)[0] as any[];
  const pay = (userId: number, variantId: number) =>
    L.grantFromPayment({ userId, clientId: null, experienceId: EXP, variantId, operation: { kind: "order", id: ++op }, payment: { reference: `pedido:T${op}`, amountCents: 129000, verifiedBy: "prueba" }, actorUserId: null });
  const enr = async (id: number) => (await q("SELECT * FROM learning_enrollments WHERE id = ?", [id]))[0];

  beforeAll(async () => {
    const base = new URL(URL_!);
    const admin = await mysql.createConnection({ host: base.hostname, port: Number(base.port || 3306), user: decodeURIComponent(base.username), password: decodeURIComponent(base.password) });
    const dbName = `lms_act_${Date.now().toString(36)}`;
    await admin.query(`CREATE DATABASE ${dbName}`);
    await admin.end();
    pool = mysql.createPool({ host: base.hostname, port: Number(base.port || 3306), user: decodeURIComponent(base.username), password: decodeURIComponent(base.password), database: dbName, multipleStatements: true, connectionLimit: 10 });
    database = drizzle(pool);
    for (const f of ["0079_learning_core.sql", "0089_learning_acceso_por_modulo.sql", "0092_learning_activacion_voluntaria.sql"]) await pool.query(readFileSync(new URL(`../db/migrations/${f}`, import.meta.url), "utf8"));
    L = await import("./learningDb");
    const now = Date.now();
    await q("INSERT INTO learning_courses (slug, title, language, status, created_at, updated_at) VALUES ('act','RECONNECT','de','published',?,?)", [now, now]);
    c.course = Number((await q("SELECT id FROM learning_courses WHERE slug = 'act'"))[0].id);
    for (const k of [0, 1, 2]) {
      await q("INSERT INTO learning_modules (course_id, position, title, source_key, created_at, updated_at) VALUES (?,?,?,?,?,?)", [c.course, k + 1, `TEIL ${k + 1}`, `m${k}`, now, now]);
      c.m[k] = Number((await q("SELECT id FROM learning_modules WHERE course_id = ? AND source_key = ?", [c.course, `m${k}`]))[0].id);
      await q("INSERT INTO learning_lessons (module_id, position, title, source_key, created_at, updated_at) VALUES (?,?,?,?,?,?)", [c.m[k], 1, `Lektion ${k + 1}`, `l${k}`, now, now]);
    }
    // Retiro de seis días: Módulo 1, 30 días que arrancan al activar. Retiro de cuatro días: sin regla. Online: programa normal de 30 días.
    await L.saveRule({ experienceId: EXP, variantId: V.retiro6, courseId: c.course, moduleIds: [c.m[0]], durationDays: 30, startMode: "on_grant", fixedStart: null, active: true, activationRequired: true });
    await L.saveRule({ experienceId: EXP, variantId: V.online, courseId: c.course, moduleIds: [c.m[0]], durationDays: 30, startMode: "on_grant", fixedStart: null, active: true });
  }, 120_000);
  afterAll(async () => {
    await pool?.end();
  });

  it("(a) el pago concede un derecho PENDIENTE: sin ventana, sin acceso y sin caducidad automática; sin regla (4 días) no hay derecho", async () => {
    const u = ++userSeq;
    const r = await pay(u, V.retiro6);
    const e = await enr(r.granted[0].enrollment.id);
    expect(e).toMatchObject({ status: "active", source: "payment", pending_activation_days: 30 });
    expect(e.ends_at).toBeNull();
    expect(e.activated_at).toBeNull();
    const d = await L.canAccessModule(u, c.course, c.m[0]);
    expect(d).toMatchObject({ allowed: false, reason: "pending_activation" });
    expect((await L.canAccessModule(u, c.course, c.m[0], Date.now() + 500 * DAY)).allowed).toBe(false); // ninguna fecha automática lo abre
    expect(await L.expireDue(Date.now() + 500 * DAY)).toBe(0); // y nada lo caduca
    expect((await enr(e.id)).status).toBe("active");
    const mine = (await L.myCourses(u))[0];
    expect(mine.status).toBe("pending_activation");
    expect(mine.pendingActivation).toEqual({ enrollmentId: e.id, days: 30 });
    expect(mine.modules[0].state).toBe("pending_activation");
    // Retiro de cuatro días: ninguna regla, ningún derecho
    expect((await pay(++userSeq, V.retiro4)).granted).toEqual([]);
  });

  it("(b) al activar, los 30 días empiezan en ese instante exacto y el acceso se abre y se cierra a los 30 días", async () => {
    const u = ++userSeq;
    const e0 = (await pay(u, V.retiro6)).granted[0].enrollment;
    const t = Date.now() + 3 * DAY; // decide empezar dentro de tres días (por ejemplo, durante el retiro)
    const a = await L.activateEnrollment(e0.id, u, t);
    expect(a).toMatchObject({ activated: true, startsAt: t, endsAt: t + 30 * DAY });
    const e = await enr(e0.id);
    expect(e).toMatchObject({ pending_activation_days: null });
    expect(Number(e.activated_at)).toBe(t);
    expect(Number(e.starts_at)).toBe(t);
    expect(Number(e.ends_at)).toBe(t + 30 * DAY);
    expect((await L.canAccessModule(u, c.course, c.m[0], t - 1)).allowed).toBe(false);
    expect((await L.canAccessModule(u, c.course, c.m[0], t)).allowed).toBe(true);
    expect((await L.canAccessModule(u, c.course, c.m[0], t + 30 * DAY - 1)).allowed).toBe(true);
    expect((await L.canAccessModule(u, c.course, c.m[0], t + 30 * DAY)).allowed).toBe(false);
    expect(await q("SELECT 1 FROM learning_access_events WHERE enrollment_id = ? AND type = 'activated'", [e0.id])).toHaveLength(1);
    expect((await L.myCourses(u, t + DAY))[0].pendingActivation).toBeNull();
    expect(await L.expireDue(t + 31 * DAY)).toBe(1); // pasado el plazo, caduca como cualquier otro
  });

  it("(c) doble clic, llamadas simultáneas y repetirlo más tarde no mueven la ventana", async () => {
    const u = ++userSeq;
    const e0 = (await pay(u, V.retiro6)).granted[0].enrollment;
    const t = Date.now();
    const res = await Promise.all([L.activateEnrollment(e0.id, u, t), L.activateEnrollment(e0.id, u, t + 5), L.activateEnrollment(e0.id, u, t + 10)]);
    expect(res.filter((r) => r.activated)).toHaveLength(1);
    const fixed = await enr(e0.id);
    const later = await L.activateEnrollment(e0.id, u, t + 10 * DAY);
    expect(later.activated).toBe(false);
    expect(Number((await enr(e0.id)).ends_at)).toBe(Number(fixed.ends_at));
    expect(await q("SELECT 1 FROM learning_access_events WHERE enrollment_id = ? AND type = 'activated'", [e0.id])).toHaveLength(1);
    // Pagar dos veces el mismo pedido tampoco duplica el derecho
    const again = await L.grantFromPayment({ userId: u, clientId: null, experienceId: EXP, variantId: V.retiro6, operation: { kind: "order", id: op }, payment: { reference: "x", amountCents: 1, verifiedBy: "t" }, actorUserId: null });
    expect(again.granted[0].created).toBe(false);
  });

  it("(d) solo el titular activa; revocada o suspendida no se activa; revocada estando pendiente no abre nada", async () => {
    const u = ++userSeq;
    const other = ++userSeq;
    const e0 = (await pay(u, V.retiro6)).granted[0].enrollment;
    await expect(L.activateEnrollment(e0.id, other)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(L.activateEnrollment(999999, u)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await enr(e0.id)).pending_activation_days).toBe(30); // el intento ajeno no cambió nada
    await L.suspendEnrollment(e0.id, "Disputa abierta de prueba", 1);
    await expect(L.activateEnrollment(e0.id, u)).rejects.toMatchObject({ code: "CONFLICT" });
    await L.reactivateEnrollment(e0.id, "Disputa ganada de prueba", 1);
    expect((await enr(e0.id)).pending_activation_days).toBe(30); // reabrir no activa solo
    await L.revokeEnrollment(e0.id, "Reembolso total de prueba", 1);
    await expect(L.activateEnrollment(e0.id, u)).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await L.canAccessModule(u, c.course, c.m[0])).allowed).toBe(false);
    // Una matrícula normal no necesita activación
    const normal = (await pay(++userSeq, V.online)).granted[0].enrollment;
    await expect(L.activateEnrollment(normal.id, normal.userId)).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("(e) la regla exige días de acceso y no admite fecha fija ni desbloqueo progresivo", async () => {
    const base = { experienceId: EXP, courseId: c.course, moduleIds: [c.m[0], c.m[1]], startMode: "on_grant" as const, fixedStart: null, active: false, activationRequired: true };
    await expect(L.saveRule({ ...base, variantId: 71, durationDays: null })).rejects.toThrow(/días de acceso/);
    await expect(L.saveRule({ ...base, variantId: 71, durationDays: 30, startMode: "fixed_date", fixedStart: Date.now() })).rejects.toThrow(/fecha fija/);
    await expect(L.saveRule({ ...base, variantId: 71, durationDays: 30, moduleSettings: [{ moduleId: c.m[1], unlockOffsetDays: 30, durationDays: 30 }] })).rejects.toThrow(/desbloqueo progresivo/);
    const rules = await L.listRules();
    expect(rules.find((r) => r.variantId === V.retiro6)?.activationRequired).toBe(true);
    expect(rules.find((r) => r.variantId === V.online)?.activationRequired).toBe(false);
    // Activar o desactivar la regla no pierde la marca; cambiar el producto crea versión nueva y la conserva
    const r6 = rules.find((r) => r.variantId === V.retiro6)!;
    await L.saveRule({ experienceId: EXP, variantId: V.retiro6, courseId: c.course, moduleIds: [c.m[0]], durationDays: 30, startMode: "on_grant", fixedStart: null, active: false }, r6.id);
    expect((await L.listRules()).find((r) => r.id === r6.id)?.activationRequired).toBe(true);
    const v2 = await L.saveRule({ experienceId: EXP, variantId: V.retiro6, courseId: c.course, moduleIds: [c.m[0], c.m[1]], durationDays: 30, startMode: "on_grant", fixedStart: null, active: true }, r6.id);
    expect((await L.listRules()).find((r) => r.id === v2)?.activationRequired).toBe(true);
    expect((await L.listRules()).find((r) => r.id === r6.id)?.active).toBe(false);
    await L.saveRule({ experienceId: EXP, variantId: V.retiro6, courseId: c.course, moduleIds: [c.m[0]], durationDays: 30, startMode: "on_grant", fixedStart: null, active: true }, v2); // vuelve a un solo módulo
  });

  it("(f) activar un derecho no toca las demás matrículas del alumno", async () => {
    const u = ++userSeq;
    const online = (await pay(u, V.online)).granted[0].enrollment;
    const before = await enr(online.id);
    const retiro = (await pay(u, V.retiro6)).granted[0].enrollment;
    await L.activateEnrollment(retiro.id, u, Date.now() + DAY);
    const after = await enr(online.id);
    expect([after.status, Number(after.starts_at), Number(after.ends_at)]).toEqual([before.status, Number(before.starts_at), Number(before.ends_at)]);
  });
});
