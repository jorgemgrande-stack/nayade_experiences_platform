/**
 * Elephant LMS: ampliaciones de módulo compradas desde el aula (nivel de datos, MySQL real, opt-in con REGISTRY_TEST_DATABASE_URL).
 * Sin pasarela ni cobros ni correos: el pedido es una fila de `reservations` mínima y el catálogo, un ajuste simulado.
 * Cubre: (a) idempotencia, (b) aislamiento entre alumnos, (c) el progreso se conserva, (d) no pagado/reembolsado no amplía,
 * (e) módulo no incluido o matrícula revocada se rechazan.
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
const CATALOG = JSON.stringify({ experienceId: 500, variants: { "30": 501, "60": 502 } });
vi.mock("./config", () => ({ getSystemSetting: async (_k: string, f = "") => CATALOG || f }));

const DAY = 86_400_000;

describe.skipIf(!URL_)("LMS: ampliaciones de módulo (pedido pagado → extendModuleAccess)", () => {
  let L: typeof import("./learningDb");
  let X: typeof import("./learningExtensions");
  const c = { course: 0, m: [0, 0, 0] as number[], l: [0, 0, 0] as number[] };
  let order = 1000;
  let userSeq = 200;
  const q = async (text: string, params: unknown[] = []) => ((await pool!.query(text, params)) as any)[0] as any[];

  /** Alumno con matrícula de 30 días en los módulos indicados (índices). */
  const student = async (mods: number[], days: number | null = 30) => {
    const userId = ++userSeq;
    const { enrollment } = await L.grantAdmin({ userId, courseId: c.course, moduleIds: mods.map((i) => c.m[i]), durationDays: days, reason: "Concesión de prueba del aula", actorUserId: 1, nonce: `n${userId}` });
    return { userId, enrollmentId: enrollment.id };
  };
  /** Pedido de ampliación con el estado dado y la marca que escribe el servidor al crearlo. */
  const extOrder = async (o: { userId: number; enrollmentId: number; moduleIdx: number; days?: number; status?: string; variant?: number; extraLog?: unknown[] }) => {
    const days = o.days ?? 30;
    const merchantOrder = `EXT${++order}`;
    const log = [{ ts: Date.now(), actor: `alumno:${o.userId}`, action: "learning_extension", userId: o.userId, enrollmentId: o.enrollmentId, moduleId: c.m[o.moduleIdx], days, priceCents: 3300 }, ...(o.extraLog ?? [])];
    await q("INSERT INTO reservations (merchant_order, product_id, variant_id, status, changes_log) VALUES (?,?,?,?,?)", [merchantOrder, 500, o.variant ?? (days === 60 ? 502 : 501), o.status ?? "paid", JSON.stringify(log)]);
    return merchantOrder;
  };
  const modEnd = async (enrollmentId: number, idx: number) => Number((await q("SELECT COALESCE(m.ends_at, e.ends_at) AS ends_at FROM learning_enrollment_modules m JOIN learning_enrollments e ON e.id = m.enrollment_id WHERE m.enrollment_id = ? AND m.module_id = ?", [enrollmentId, c.m[idx]]))[0].ends_at);
  const ledger = (enrollmentId: number) => q("SELECT * FROM learning_module_extensions WHERE enrollment_id = ?", [enrollmentId]);

  beforeAll(async () => {
    const base = new URL(URL_!);
    const admin = await mysql.createConnection({ host: base.hostname, port: Number(base.port || 3306), user: decodeURIComponent(base.username), password: decodeURIComponent(base.password) });
    const dbName = `lms_ext_${Date.now().toString(36)}`;
    await admin.query(`CREATE DATABASE ${dbName}`);
    await admin.end();
    pool = mysql.createPool({ host: base.hostname, port: Number(base.port || 3306), user: decodeURIComponent(base.username), password: decodeURIComponent(base.password), database: dbName, multipleStatements: true, flags: ["+FOUND_ROWS"] });
    database = drizzle(pool);
    for (const f of ["0079_learning_core.sql", "0089_learning_acceso_por_modulo.sql"]) await pool.query(readFileSync(new URL(`../db/migrations/${f}`, import.meta.url), "utf8"));
    await pool.query("CREATE TABLE reservations (id INT AUTO_INCREMENT PRIMARY KEY, merchant_order VARCHAR(30), product_id INT, variant_id INT NULL, status VARCHAR(20), changes_log JSON NULL)");
    L = await import("./learningDb");
    X = await import("./learningExtensions");
    const now = Date.now();
    await q("INSERT INTO learning_courses (slug, title, language, status, created_at, updated_at) VALUES ('ext','RECONNECT','de','published',?,?)", [now, now]);
    c.course = Number((await q("SELECT id FROM learning_courses WHERE slug = 'ext'"))[0].id);
    for (const k of [0, 1, 2]) {
      await q("INSERT INTO learning_modules (course_id, position, title, source_key, created_at, updated_at) VALUES (?,?,?,?,?,?)", [c.course, k + 1, `TEIL ${k + 1}`, `m${k}`, now, now]);
      c.m[k] = Number((await q("SELECT id FROM learning_modules WHERE course_id = ? AND source_key = ?", [c.course, `m${k}`]))[0].id);
      await q("INSERT INTO learning_lessons (module_id, position, title, source_key, created_at, updated_at) VALUES (?,?,?,?,?,?)", [c.m[k], 1, `Lektion ${k + 1}`, `l${k}`, now, now]);
      c.l[k] = Number((await q("SELECT id FROM learning_lessons WHERE module_id = ?", [c.m[k]]))[0].id);
    }
  }, 120_000);
  afterAll(async () => {
    await pool?.end();
  });

  it("(a) pedido pagado amplía 30 días UNA vez; aviso repetido, recuperación manual y llamadas simultáneas no amplían otra vez", async () => {
    const s = await student([0, 1]);
    const before = await modEnd(s.enrollmentId, 0);
    const o = await extOrder({ ...s, moduleIdx: 0 });
    const r1 = await X.applyExtensionsForOrder(o);
    expect(r1.map((r) => r.status)).toEqual(["applied"]);
    const after = await modEnd(s.enrollmentId, 0);
    expect(after).toBe(before + 30 * DAY); // desde el fin actual (no caducado): no se pierden días
    expect(await modEnd(s.enrollmentId, 1)).toBe(before); // el otro módulo no cambia
    const again = await Promise.all([X.applyExtensionsForOrder(o), X.applyExtensionsForOrder(o), X.applyExtensionsForOrder(o)]);
    expect(again.flat().every((r) => r.status === "already_applied")).toBe(true);
    expect(await modEnd(s.enrollmentId, 0)).toBe(after);
    expect(await ledger(s.enrollmentId)).toHaveLength(1);
    expect(await q("SELECT 1 FROM learning_access_events WHERE enrollment_id = ? AND type = 'module_extended'", [s.enrollmentId])).toHaveLength(1);
  });

  it("(a) 60 días: dos pedidos distintos del mismo módulo suman; cada pedido una sola vez", async () => {
    const s = await student([0]);
    const before = await modEnd(s.enrollmentId, 0);
    const o1 = await extOrder({ ...s, moduleIdx: 0, days: 60 });
    const o2 = await extOrder({ ...s, moduleIdx: 0, days: 30 });
    await X.applyExtensionsForOrder(o1);
    await X.applyExtensionsForOrder(o2);
    await X.applyExtensionsForOrder(o1);
    expect(await modEnd(s.enrollmentId, 0)).toBe(before + 90 * DAY);
    expect(await ledger(s.enrollmentId)).toHaveLength(2);
  });

  it("(c) ampliar no borra el progreso ni las lecciones completadas, y reabre un módulo caducado", async () => {
    const s = await student([0]);
    const now = Date.now();
    await q("INSERT INTO learning_progress (user_id, lesson_id, status, completed_at, updated_at) VALUES (?,?,?,?,?)", [s.userId, c.l[0], "completed", now - 5 * DAY, now - 5 * DAY]);
    // Caducado hace 3 días
    await q("UPDATE learning_enrollment_modules SET ends_at = ? WHERE enrollment_id = ?", [now - 3 * DAY, s.enrollmentId]);
    await q("UPDATE learning_enrollments SET ends_at = ?, status = 'expired' WHERE id = ?", [now - 3 * DAY, s.enrollmentId]);
    expect((await L.canAccessModule(s.userId, c.course, c.m[0], now)).allowed).toBe(false);
    const o = await extOrder({ ...s, moduleIdx: 0 });
    await X.applyExtensionsForOrder(o, now);
    const end = await modEnd(s.enrollmentId, 0);
    expect(end).toBeGreaterThanOrEqual(now + 30 * DAY - 1000); // desde ahora, no regala los días vencidos
    expect(end).toBeLessThanOrEqual(now + 30 * DAY + 1000);
    expect((await L.canAccessModule(s.userId, c.course, c.m[0], now + 1000)).allowed).toBe(true);
    const prog = await q("SELECT status FROM learning_progress WHERE user_id = ? AND lesson_id = ?", [s.userId, c.l[0]]);
    expect(prog).toEqual([{ status: "completed" }]);
  });

  it("(d) pedido pendiente, fallido o cancelado no amplía nada", async () => {
    const s = await student([0]);
    const before = await modEnd(s.enrollmentId, 0);
    for (const status of ["pending_payment", "failed", "cancelled", "draft"]) {
      const o = await extOrder({ ...s, moduleIdx: 0, status });
      expect((await X.applyExtensionsForOrder(o)).map((r) => [r.status, r.reason])).toEqual([["skipped", "not_paid"]]);
    }
    expect(await modEnd(s.enrollmentId, 0)).toBe(before);
    expect(await ledger(s.enrollmentId)).toEqual([]);
  });

  it("(d) pedido reembolsado ANTES de aplicarse no amplía; reembolsado DESPUÉS queda registrado, avisa y no toca el acceso ni las facturas", async () => {
    const s = await student([0]);
    const before = await modEnd(s.enrollmentId, 0);
    const refunded = await extOrder({ ...s, moduleIdx: 0, extraLog: [{ ts: Date.now(), actor: "Sistema (Stripe)", action: "stripe_refund_full" }] });
    expect((await X.applyExtensionsForOrder(refunded)).map((r) => r.reason)).toEqual(["refunded"]);
    expect(await modEnd(s.enrollmentId, 0)).toBe(before);

    const o = await extOrder({ ...s, moduleIdx: 0 });
    await X.applyExtensionsForOrder(o);
    const extended = await modEnd(s.enrollmentId, 0);
    expect(await X.flagExtensionRefund(o, "Stripe: reembolso total del pedido")).toBe(1);
    expect(await X.flagExtensionRefund(o, "Stripe: reembolso total del pedido")).toBe(0); // idempotente
    const ev = await q("SELECT detail FROM learning_access_events WHERE enrollment_id = ? AND type = 'module_extension_refunded'", [s.enrollmentId]);
    expect(ev).toHaveLength(1);
    expect(JSON.stringify(ev[0].detail)).toContain(o);
    expect(await modEnd(s.enrollmentId, 0)).toBe(extended); // el acceso ampliado NO se retira
    expect((await q("SELECT status FROM learning_enrollments WHERE id = ?", [s.enrollmentId]))[0].status).toBe("active");
    // un pedido sin ampliación aplicada no genera aviso
    expect(await X.flagExtensionRefund("NOEXISTE1", "x")).toBe(0);
  });

  it("(b) un pedido a nombre de otra persona NO amplía la matrícula ajena; solo el titular puede ampliar lo suyo", async () => {
    const a = await student([0]);
    const b = await student([0]);
    const beforeA = await modEnd(a.enrollmentId, 0);
    // B intenta ampliar la matrícula de A (marca manipulada): la matrícula no es suya → fallo y nada cambia
    const hijack = await extOrder({ userId: b.userId, enrollmentId: a.enrollmentId, moduleIdx: 0 });
    expect((await X.applyExtensionsForOrder(hijack)).map((r) => r.status)).toEqual(["failed"]);
    expect(await modEnd(a.enrollmentId, 0)).toBe(beforeA);
    expect(await ledger(a.enrollmentId)).toEqual([]);
    // B no puede ver los módulos de A como ampliables
    expect((await X.extendableModules(b.userId, c.course)).has(c.m[0])).toBe(true); // los suyos
    expect((await X.extendableModules(b.userId, c.course)).get(c.m[0])!.enrollmentId).toBe(b.enrollmentId);
    expect([...(await X.extendableModules(999999, c.course)).keys()]).toEqual([]);
  });

  it("(b) la marca no basta: producto o variante distintos de los del catálogo, o días no permitidos, se rechazan", async () => {
    const s = await student([0]);
    const before = await modEnd(s.enrollmentId, 0);
    const wrongVariant = await extOrder({ ...s, moduleIdx: 0, days: 30, variant: 502 });
    const wrongDays = await extOrder({ ...s, moduleIdx: 0, days: 45, variant: 501 });
    expect((await X.applyExtensionsForOrder(wrongVariant))[0].status).toBe("failed");
    expect((await X.applyExtensionsForOrder(wrongDays))[0].status).toBe("failed");
    await q("UPDATE reservations SET product_id = 999 WHERE merchant_order = ?", [wrongVariant]);
    expect((await X.applyExtensionsForOrder(wrongVariant))[0].status).toBe("failed");
    expect(await modEnd(s.enrollmentId, 0)).toBe(before);
    expect(await ledger(s.enrollmentId)).toEqual([]);
    // el fallo queda en el historial del pedido
    expect(JSON.stringify((await q("SELECT changes_log FROM reservations WHERE merchant_order = ?", [wrongVariant]))[0].changes_log)).toContain("learning_extension_failed");
  });

  it("(e) un módulo que la matrícula no incluye y una matrícula revocada o suspendida se rechazan", async () => {
    const s = await student([0]); // solo el módulo 1
    const before = await modEnd(s.enrollmentId, 0);
    const notIncluded = await extOrder({ ...s, moduleIdx: 2 });
    expect((await X.applyExtensionsForOrder(notIncluded))[0].status).toBe("failed");
    expect((await X.extendableModules(s.userId, c.course)).has(c.m[2])).toBe(false);

    const o = await extOrder({ ...s, moduleIdx: 0 });
    await L.revokeEnrollment(s.enrollmentId, "Prueba de revocación", 1);
    expect((await X.applyExtensionsForOrder(o))[0].status).toBe("failed");
    expect(await modEnd(s.enrollmentId, 0)).toBe(before);
    expect(await ledger(s.enrollmentId)).toEqual([]);
    expect((await X.extendableModules(s.userId, c.course)).size).toBe(0); // ni siquiera se ofrece

    const t = await student([0]);
    await L.suspendEnrollment(t.enrollmentId, "Prueba de suspensión", 1);
    expect((await X.applyExtensionsForOrder(await extOrder({ ...t, moduleIdx: 0 })))[0].status).toBe("failed");
    expect(await ledger(t.enrollmentId)).toEqual([]);
  });

  it("un módulo sin caducidad no se amplía ni se ofrece", async () => {
    const s = await student([0], null);
    expect((await X.extendableModules(s.userId, c.course)).size).toBe(0);
    expect((await X.applyExtensionsForOrder(await extOrder({ ...s, moduleIdx: 0 })))[0].status).toBe("failed");
  });
});
