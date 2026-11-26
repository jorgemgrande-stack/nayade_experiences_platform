/**
 * Suplementos PAGADOS con derecho digital (p. ej. Lifetime Access de RECONNECT), nivel de datos con MySQL real
 * (opt-in con REGISTRY_TEST_DATABASE_URL). Sin pasarela, cobros ni correos: pedidos y suplementos son filas mínimas.
 *  (a) solo concede la regla EXACTA de la variante-suplemento (nunca las genéricas del producto),
 *  (b) acceso permanente a los tres módulos con desbloqueo progresivo, en una matrícula APARTE de la del programa,
 *  (c) idempotente (aviso repetido, recuperación manual, llamadas simultáneas): una sola matrícula,
 *  (d) reembolsar SOLO el suplemento retira ese derecho y deja intacto el del programa (y no se vuelve a conceder),
 *  (e) pedido completo reembolsado: se revocan todos y los suplementos constan como reembolsados,
 *  (f) el acceso del alumno es la unión de sus matrículas: caducado el programa, el permanente sigue abierto.
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

describe.skipIf(!URL_)("Suplementos pagados con derecho digital (Lifetime Access)", () => {
  let L: typeof import("./learningDb");
  let F: typeof import("./learningFlow");
  const c = { course: 0, m: [0, 0, 0] as number[] };
  const V = { live: 11, online: 10, lifetime: 20 };
  let order = 5000;
  let userSeq = 0;
  const q = async (text: string, params: unknown[] = []) => ((await pool!.query(text, params)) as any)[0] as any[];

  /** Alumno con cuenta, pedido PAGADO de la opción dada y, si se indica, su suplemento. */
  const buyer = async (o: { variant: number; supplement?: boolean; status?: string; supplementVariant?: number }) => {
    const email = `alumno${++userSeq}@lifetime.example`;
    await q("INSERT INTO users (email, name, passwordHash, inviteAccepted) VALUES (?, 'Alumno', 'x', 1)", [email]);
    const userId = Number((await q("SELECT id FROM users WHERE email = ?", [email]))[0].id);
    const merchantOrder = `LT${++order}`;
    await q("INSERT INTO reservations (merchant_order, product_id, variant_id, status, customer_name, customer_email, amount_paid, amount_total, paid_at) VALUES (?,?,?,?,?,?,?,?,?)", [merchantOrder, 1, o.variant, o.status ?? "paid", "Alumno", email, 69900, 69900, Date.now()]);
    const reservationId = Number((await q("SELECT id FROM reservations WHERE merchant_order = ?", [merchantOrder]))[0].id);
    if (o.supplement !== false) await q("INSERT INTO order_supplement_lines (reservation_id, merchant_order, product_id, variant_id, supplement_group, name, quantity, unit_cents, total_cents, status, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)", [reservationId, merchantOrder, 1, o.supplementVariant ?? V.lifetime, "lifetime", "Lifetime Access", 1, 14400, 14400, "active", Date.now()]);
    return { userId, email, merchantOrder, reservationId };
  };
  const enrollments = (userId: number) => q("SELECT * FROM learning_enrollments WHERE user_id = ? ORDER BY id", [userId]);
  const line = async (merchantOrder: string) => (await q("SELECT * FROM order_supplement_lines WHERE merchant_order = ?", [merchantOrder]))[0];

  beforeAll(async () => {
    const base = new URL(URL_!);
    const admin = await mysql.createConnection({ host: base.hostname, port: Number(base.port || 3306), user: decodeURIComponent(base.username), password: decodeURIComponent(base.password) });
    const dbName = `lms_life_${Date.now().toString(36)}`;
    await admin.query(`CREATE DATABASE ${dbName}`);
    await admin.end();
    pool = mysql.createPool({ host: base.hostname, port: Number(base.port || 3306), user: decodeURIComponent(base.username), password: decodeURIComponent(base.password), database: dbName, multipleStatements: true, connectionLimit: 10 });
    database = drizzle(pool);
    for (const f of ["0079_learning_core.sql", "0089_learning_acceso_por_modulo.sql", "0091_pedido_suplementos.sql"]) await pool.query(readFileSync(new URL(`../db/migrations/${f}`, import.meta.url), "utf8"));
    await pool.query("CREATE TABLE users (id INT AUTO_INCREMENT PRIMARY KEY, email VARCHAR(190), name VARCHAR(190) NULL, passwordHash VARCHAR(255) NULL, inviteAccepted TINYINT NULL)");
    await pool.query("CREATE TABLE reservations (id INT AUTO_INCREMENT PRIMARY KEY, merchant_order VARCHAR(30), product_id INT, variant_id INT NULL, status VARCHAR(20), customer_name VARCHAR(120), customer_email VARCHAR(190), amount_paid INT NULL, amount_total INT NULL, paid_at BIGINT NULL, changes_log JSON NULL)");
    L = await import("./learningDb");
    F = await import("./learningFlow");
    const now = Date.now();
    await q("INSERT INTO learning_courses (slug, title, language, status, created_at, updated_at) VALUES ('life','RECONNECT','de','published',?,?)", [now, now]);
    c.course = Number((await q("SELECT id FROM learning_courses WHERE slug = 'life'"))[0].id);
    for (const k of [0, 1, 2]) {
      await q("INSERT INTO learning_modules (course_id, position, title, source_key, created_at, updated_at) VALUES (?,?,?,?,?,?)", [c.course, k + 1, `TEIL ${k + 1}`, `m${k}`, now, now]);
      c.m[k] = Number((await q("SELECT id FROM learning_modules WHERE course_id = ? AND source_key = ?", [c.course, `m${k}`]))[0].id);
      await q("INSERT INTO learning_lessons (module_id, position, title, source_key, created_at, updated_at) VALUES (?,?,?,?,?,?)", [c.m[k], 1, `Lektion ${k + 1}`, `l${k}`, now, now]);
    }
    // Programa ONLINE: tres módulos de 30 días, desbloqueo a los 0/30/60 días (regla ACTIVA de la opción 10)
    await L.saveRule({ experienceId: 1, variantId: V.online, courseId: c.course, moduleIds: c.m, durationDays: 30, startMode: "on_grant", fixedStart: null, active: true,
      moduleSettings: c.m.map((m, i) => ({ moduleId: m, unlockOffsetDays: i * 30, durationDays: 30 })) });
  }, 120_000);
  afterAll(async () => {
    await pool?.end();
  });

  it("(a) un suplemento sin regla propia no concede nada, ni siquiera con una regla genérica del producto", async () => {
    // Regla genérica del producto (variantId nulo): jamás debe casar con un suplemento
    const generic = await L.saveRule({ experienceId: 1, variantId: null, courseId: c.course, moduleIds: [c.m[0]], durationDays: 365, startMode: "on_grant", fixedStart: null, active: true });
    const b = await buyer({ variant: V.live });
    const r = await F.grantSupplementsFromOrder(b.merchantOrder);
    expect(r).toMatchObject({ created: 0, existing: 0, failed: 0 });
    expect(await enrollments(b.userId)).toEqual([]);
    await L.saveRule({ experienceId: 1, variantId: null, courseId: c.course, moduleIds: [c.m[0]], durationDays: 365, startMode: "on_grant", fixedStart: null, active: false }, generic);
  });

  it("(b) Lifetime: matrícula PERMANENTE de los tres módulos, aparte de la del programa, con desbloqueo progresivo", async () => {
    // Regla del suplemento: acceso permanente (sin duración) a los tres módulos, desbloqueo a los 0/30/60 días
    await L.saveRule({ experienceId: 1, variantId: V.lifetime, courseId: c.course, moduleIds: c.m, durationDays: null, startMode: "on_grant", fixedStart: null, active: true, permanent: true,
      moduleSettings: c.m.map((m, i) => ({ moduleId: m, unlockOffsetDays: i * 30, durationDays: null })) });
    const b = await buyer({ variant: V.online });
    await F.grantLearningFromOrder(b.merchantOrder);
    const list = await enrollments(b.userId);
    expect(list).toHaveLength(2); // programa + Lifetime, cada uno su matrícula
    const prog = list.find((e) => e.ends_at != null)!;
    const life = list.find((e) => e.ends_at == null)!;
    expect(prog).toBeTruthy();
    expect(life).toBeTruthy();
    expect(life.order_id).toBe(b.reservationId);
    expect(Number(life.variant_id)).toBe(V.lifetime);
    expect(Number(prog.variant_id)).toBe(V.online);
    const mods = await q("SELECT module_id, starts_at, ends_at FROM learning_enrollment_modules WHERE enrollment_id = ? ORDER BY module_id", [life.id]);
    expect(mods).toHaveLength(3);
    expect(mods.every((m) => m.ends_at == null)).toBe(true); // nunca caduca
    expect(Number(mods[1].starts_at) - Number(life.starts_at)).toBe(30 * DAY);
    expect(Number(mods[2].starts_at) - Number(life.starts_at)).toBe(60 * DAY);
    expect((await line(b.merchantOrder)).learning_enrollment_id).toBe(life.id); // trazabilidad: qué derecho concedió este suplemento
  });

  it("(c) aviso repetido, recuperación manual y llamadas simultáneas: una sola matrícula del suplemento", async () => {
    const b = await buyer({ variant: V.online });
    await Promise.all([F.grantLearningFromOrder(b.merchantOrder), F.grantLearningFromOrder(b.merchantOrder), F.grantSupplementsFromOrder(b.merchantOrder)]);
    await F.grantLearningFromOrder(b.merchantOrder);
    const list = await enrollments(b.userId);
    expect(list).toHaveLength(2);
    expect(list.filter((e) => e.ends_at == null)).toHaveLength(1);
    expect(await q("SELECT 1 FROM learning_access_events WHERE enrollment_id = ? AND type = 'granted'", [list.find((e) => e.ends_at == null)!.id])).toHaveLength(1);
  });

  it("(c) un pedido sin pagar no concede el suplemento", async () => {
    const b = await buyer({ variant: V.online, status: "pending_payment" });
    await F.grantLearningFromOrder(b.merchantOrder);
    expect(await enrollments(b.userId)).toEqual([]);
  });

  it("(d) reembolsar SOLO el suplemento retira Lifetime y deja intacto el programa; no se vuelve a conceder", async () => {
    const b = await buyer({ variant: V.online });
    await F.grantLearningFromOrder(b.merchantOrder);
    const before = await enrollments(b.userId);
    const prog = before.find((e) => e.ends_at != null)!;
    const life = before.find((e) => e.ends_at == null)!;
    const r1 = await F.refundOrderSupplement(b.merchantOrder, "lifetime", "Reembolso solo del Lifetime", 1);
    expect(r1).toMatchObject({ refunded: true, revokedEnrollmentId: life.id, alreadyRefunded: false });
    const after = await enrollments(b.userId);
    expect(after.find((e) => e.id === life.id)!.status).toBe("revoked");
    expect(after.find((e) => e.id === prog.id)!.status).toBe(prog.status); // el programa, intacto
    expect(Number(after.find((e) => e.id === prog.id)!.ends_at)).toBe(Number(prog.ends_at));
    expect((await line(b.merchantOrder)).status).toBe("refunded");
    // repetir es inofensivo y recuperar el pedido NO vuelve a conceder lo reembolsado
    const r2 = await F.refundOrderSupplement(b.merchantOrder, "lifetime", "Reembolso solo del Lifetime", 1);
    expect(r2).toMatchObject({ alreadyRefunded: true, revokedEnrollmentId: null });
    await F.grantLearningFromOrder(b.merchantOrder);
    expect(await enrollments(b.userId)).toHaveLength(2);
    expect((await enrollments(b.userId)).find((e) => e.id === life.id)!.status).toBe("revoked");
    await expect(F.refundOrderSupplement(b.merchantOrder, "no-existe", "x", 1)).rejects.toThrow();
  });

  it("(e) pedido completo reembolsado: se revocan programa y Lifetime y el suplemento consta como reembolsado", async () => {
    const b = await buyer({ variant: V.online });
    await F.grantLearningFromOrder(b.merchantOrder);
    const r = await F.changeLearningAccessForOrder(b.merchantOrder, "revoke", "Stripe: reembolso total");
    expect(r.changed).toBe(2);
    expect((await enrollments(b.userId)).map((e) => e.status)).toEqual(["revoked", "revoked"]);
    expect((await line(b.merchantOrder)).status).toBe("refunded");
    expect((await F.changeLearningAccessForOrder(b.merchantOrder, "revoke", "Stripe: reembolso total")).changed).toBe(0); // idempotente
  });

  it("(f) caducado el programa, Lifetime mantiene abiertos los módulos que ya tocaba desbloquear; nunca los futuros", async () => {
    const b = await buyer({ variant: V.online });
    await F.grantLearningFromOrder(b.merchantOrder);
    const list = await enrollments(b.userId);
    const prog = list.find((e) => e.ends_at != null)!;
    const life = list.find((e) => e.ends_at == null)!;
    const day = Date.now();
    // Se «avanza el reloj» 100 días: el programa (30+30+30) caduca; Lifetime no
    await q("UPDATE learning_enrollments SET starts_at = starts_at - ?, ends_at = ends_at - ?, status = 'expired' WHERE id = ?", [100 * DAY, 100 * DAY, prog.id]);
    await q("UPDATE learning_enrollment_modules SET starts_at = starts_at - ?, ends_at = ends_at - ? WHERE enrollment_id = ?", [100 * DAY, 100 * DAY, prog.id]);
    await q("UPDATE learning_enrollments SET starts_at = starts_at - ? WHERE id = ?", [31 * DAY, life.id]);
    await q("UPDATE learning_enrollment_modules SET starts_at = starts_at - ? WHERE enrollment_id = ?", [31 * DAY, life.id]);
    // Con Lifetime comprado hace 31 días: M1 y M2 desbloqueados (permanentes), M3 aún no (a los 60 días)
    expect((await L.canAccessModule(b.userId, c.course, c.m[0], day)).allowed).toBe(true);
    expect((await L.canAccessModule(b.userId, c.course, c.m[1], day)).allowed).toBe(true);
    expect((await L.canAccessModule(b.userId, c.course, c.m[2], day)).allowed).toBe(false);
    // Y dentro de otros 40 días (siguen sin caducar)
    expect((await L.canAccessModule(b.userId, c.course, c.m[2], day + 40 * DAY)).allowed).toBe(true);
    expect((await L.canAccessModule(b.userId, c.course, c.m[0], day + 4000 * DAY)).allowed).toBe(true);
    // Un alumno sin Lifetime con el programa caducado no accede
    const s = await buyer({ variant: V.online, supplement: false });
    await F.grantLearningFromOrder(s.merchantOrder);
    await q("UPDATE learning_enrollments SET ends_at = ?, status = 'expired' WHERE user_id = ?", [day - DAY, s.userId]);
    await q("UPDATE learning_enrollment_modules SET ends_at = ? WHERE enrollment_id IN (SELECT id FROM learning_enrollments WHERE user_id = ?)", [day - DAY, s.userId]);
    expect((await L.canAccessModule(s.userId, c.course, c.m[0], day)).allowed).toBe(false);
  });

  it("(g) pedidos pendientes: un suplemento pagado cuya regla se activó después aparece y se recupera", async () => {
    await q("UPDATE learning_access_rules SET active = 0 WHERE variant_id = ?", [V.lifetime]);
    const b = await buyer({ variant: V.online });
    await F.grantLearningFromOrder(b.merchantOrder); // programa sí; suplemento sin regla activa: nada
    expect(await enrollments(b.userId)).toHaveLength(1);
    expect((await F.pendingLearningOrders()).some((p) => p.merchantOrder === b.merchantOrder)).toBe(false); // sin regla activa no hay nada que reparar
    await q("UPDATE learning_access_rules SET active = 1 WHERE variant_id = ?", [V.lifetime]);
    expect((await F.pendingLearningOrders()).some((p) => p.merchantOrder === b.merchantOrder)).toBe(true);
    await F.grantLearningFromOrder(b.merchantOrder);
    expect(await enrollments(b.userId)).toHaveLength(2);
    expect((await F.pendingLearningOrders()).some((p) => p.merchantOrder === b.merchantOrder)).toBe(false);
  });
});
