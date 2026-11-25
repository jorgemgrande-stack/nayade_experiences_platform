/**
 * Retiros SIN convocatoria: presupuesto PAGADO → derecho pendiente de activar, nivel de datos con MySQL real (opt-in con
 * REGISTRY_TEST_DATABASE_URL). Sin pasarela ni cobros ni correos: presupuestos y solicitudes son filas mínimas.
 *  (a) opción de duración fija: el presupuesto pagado concede UN derecho pendiente; barridos y reintentos no duplican,
 *  (b) duración variable («5–6 días»): sin confirmar, con 5 días o sin pagar NO se concede jamás; con 6, sí (una vez),
 *  (c) no se concede por un presupuesto sin pagar, sin regla, de otra opción o ya cubierto por una inscripción/pedido,
 *  (d) el listado de pendientes distingue lo que falta confirmar.
 */
import mysql from "mysql2/promise";
import { readFileSync } from "node:fs";
import { drizzle } from "drizzle-orm/mysql2";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
vi.setConfig({ testTimeout: 60_000 });

let pool: mysql.Pool | null = null;
let database: ReturnType<typeof drizzle> | null = null;
vi.mock("./db", () => ({
  getDb: async () => database,
  // Cuenta nueva con invitación pendiente (sin contraseña), como la real
  createInvitedUser: async (u: { name: string; email: string }) => {
    const [r] = (await pool!.query("INSERT INTO users (email, name, passwordHash, inviteAccepted) VALUES (?, ?, NULL, 0)", [u.email, u.name])) as any;
    return { id: Number(r.insertId) };
  },
}));
vi.mock("./config", () => ({ getSystemSetting: async (_k: string, f = "") => f }));

describe.skipIf(!URL_)("Retiros sin convocatoria: presupuesto pagado → derecho pendiente de activar", () => {
  let L: typeof import("./learningDb");
  let F: typeof import("./learningFlow");
  const c = { course: 0, m1: 0 };
  const EXP = 7;
  const V = { fijo6: 71, variable56: 72, cuatro: 73 };
  let seq = 0;
  const q = async (text: string, params: unknown[] = []) => ((await pool!.query(text, params)) as any)[0] as any[];

  /** Solicitud (lead) + presupuesto con el estado indicado. */
  const quote = async (o: { variant: number; status?: string; paidAt?: number | null; experience?: number }) => {
    const email = `retiro${++seq}@sin-convocatoria.example`;
    await q("INSERT INTO leads (name, email, experienceId, variant_id) VALUES (?,?,?,?)", ["Participante", email, o.experience ?? EXP, o.variant]);
    const leadId = Number((await q("SELECT id FROM leads WHERE email = ?", [email]))[0].id);
    await q("INSERT INTO quotes (quoteNumber, status, total, paidAt, leadId) VALUES (?,?,?,?,?)", [`P-${seq}`, o.status ?? "pagado", 1290, o.paidAt === undefined ? null : o.paidAt === null ? null : new Date(o.paidAt), leadId]);
    const quoteId = Number((await q("SELECT id FROM quotes WHERE quoteNumber = ?", [`P-${seq}`]))[0].id);
    return { email, leadId, quoteId };
  };
  const rights = (quoteId: number) => q("SELECT * FROM learning_enrollments WHERE quote_id = ? ORDER BY id", [quoteId]);

  beforeAll(async () => {
    const base = new URL(URL_!);
    const admin = await mysql.createConnection({ host: base.hostname, port: Number(base.port || 3306), user: decodeURIComponent(base.username), password: decodeURIComponent(base.password) });
    const dbName = `lms_ret_${Date.now().toString(36)}`;
    await admin.query(`CREATE DATABASE ${dbName}`);
    await admin.end();
    pool = mysql.createPool({ host: base.hostname, port: Number(base.port || 3306), user: decodeURIComponent(base.username), password: decodeURIComponent(base.password), database: dbName, multipleStatements: true, connectionLimit: 10 });
    database = drizzle(pool);
    for (const f of ["0079_learning_core.sql", "0089_learning_acceso_por_modulo.sql", "0092_learning_activacion_voluntaria.sql", "0093_learning_retiros_terminos.sql"]) await pool.query(readFileSync(new URL(`../db/migrations/${f}`, import.meta.url), "utf8"));
    await pool.query("CREATE TABLE users (id INT AUTO_INCREMENT PRIMARY KEY, email VARCHAR(190), name VARCHAR(190) NULL, passwordHash VARCHAR(255) NULL, inviteAccepted TINYINT NULL)");
    await pool.query("CREATE TABLE leads (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(190), email VARCHAR(190), experienceId INT NULL, variant_id INT NULL)");
    await pool.query("CREATE TABLE quotes (id INT AUTO_INCREMENT PRIMARY KEY, quoteNumber VARCHAR(32) UNIQUE, status VARCHAR(30), total DECIMAL(10,2), paidAt DATETIME NULL, leadId INT)");
    await pool.query("CREATE TABLE edition_enrollments (id INT AUTO_INCREMENT PRIMARY KEY, quote_id INT NULL)");
    await pool.query("CREATE TABLE reservations (id INT AUTO_INCREMENT PRIMARY KEY, merchant_order VARCHAR(30), product_id INT, variant_id INT NULL, status VARCHAR(20), customer_name VARCHAR(120), customer_email VARCHAR(190), amount_paid INT NULL, amount_total INT NULL, paid_at BIGINT NULL, quote_id INT NULL, changes_log JSON NULL)");
    L = await import("./learningDb");
    F = await import("./learningFlow");
    const now = Date.now();
    await q("INSERT INTO learning_courses (slug, title, language, status, created_at, updated_at) VALUES ('ret','RECONNECT','de','published',?,?)", [now, now]);
    c.course = Number((await q("SELECT id FROM learning_courses WHERE slug = 'ret'"))[0].id);
    await q("INSERT INTO learning_modules (course_id, position, title, source_key, created_at, updated_at) VALUES (?,?,?,?,?,?)", [c.course, 1, "TEIL 1", "m0", now, now]);
    c.m1 = Number((await q("SELECT id FROM learning_modules WHERE course_id = ?", [c.course]))[0].id);
    await q("INSERT INTO users (email, name, passwordHash, inviteAccepted) SELECT email, 'x', 'x', 1 FROM (SELECT 'ya.existe@sin-convocatoria.example' AS email) t");
    const base_ = { experienceId: EXP, courseId: c.course, moduleIds: [c.m1], durationDays: 30, startMode: "on_grant" as const, fixedStart: null, active: true, activationRequired: true };
    await L.saveRule({ ...base_, variantId: V.fijo6 }); // «6 Tage»: duración fija
    await L.saveRule({ ...base_, variantId: V.variable56, minContractedDays: 6 }); // «5–6 Tage»: solo con 6 días o más CONFIRMADOS
    // Opción de 4 días: sin regla
  }, 120_000);
  afterAll(async () => {
    await pool?.end();
  });

  it("(a) opción de seis días fijos: el presupuesto pagado concede UN derecho pendiente de activar; reintentos y barridos no duplican", async () => {
    const z = await quote({ variant: V.fijo6, status: "pagado" });
    const r = await F.grantLearningFromQuote(z.quoteId);
    expect(r).toMatchObject({ status: "granted", created: 1, existing: 0 });
    const list = await rights(z.quoteId);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ source: "payment", status: "active", pending_activation_days: 30, variant_id: V.fijo6 });
    expect(list[0].ends_at).toBeNull();
    expect((await L.canAccessModule(list[0].user_id, c.course, c.m1)).allowed).toBe(false); // pendiente: hasta que el alumno lo active
    await Promise.all([F.grantLearningFromQuote(z.quoteId), F.grantLearningFromQuote(z.quoteId), F.sweepLearningGrants()]);
    expect(await rights(z.quoteId)).toHaveLength(1);
    expect((await F.grantLearningFromQuote(z.quoteId))).toMatchObject({ status: "granted", created: 0, existing: 1 });
    // El alumno lo activa cuando quiere: los 30 días empiezan ahí
    const t = Date.now() + 40 * 86_400_000;
    expect(await L.activateEnrollment(list[0].id, list[0].user_id, t)).toMatchObject({ activated: true, startsAt: t });
  });

  it("(a) un cobro manual verificado (aceptado con fecha de pago) cuenta como pagado; sin pagar no concede", async () => {
    const manual = await quote({ variant: V.fijo6, status: "aceptado", paidAt: Date.now() });
    expect(await F.grantLearningFromQuote(manual.quoteId)).toMatchObject({ status: "granted", created: 1 });
    const sinPagar = await quote({ variant: V.fijo6, status: "enviado" });
    expect(await F.grantLearningFromQuote(sinPagar.quoteId)).toEqual({ status: "skipped", reason: "not_paid" });
    const aceptado = await quote({ variant: V.fijo6, status: "aceptado" });
    expect(await F.grantLearningFromQuote(aceptado.quoteId)).toEqual({ status: "skipped", reason: "not_paid" });
    expect(await rights(sinPagar.quoteId)).toEqual([]);
  });

  it("(b) duración variable: sin confirmar o con 5 días NO se concede nunca; con 6 días, sí, una sola vez", async () => {
    const z = await quote({ variant: V.variable56, status: "pagado" });
    expect(await F.grantLearningFromQuote(z.quoteId)).toEqual({ status: "needs_terms", quoteId: z.quoteId, minDays: 6 });
    await F.sweepLearningGrants(); // el barrido tampoco lo concede
    expect(await rights(z.quoteId)).toEqual([]);
    expect((await F.pendingLearningQuotes()).find((p) => p.quoteId === z.quoteId)).toMatchObject({ needsTermsMinDays: 6, email: z.email });
    // Reserva de cinco días: confirmada, pero no alcanza
    expect(await F.confirmQuoteContractedDays(z.quoteId, 5, "Acordado con la persona: 5 días", 1)).toEqual({ status: "needs_terms", quoteId: z.quoteId, minDays: 6 });
    expect(await rights(z.quoteId)).toEqual([]);
    // Se amplía a seis días y ya sí
    expect(await F.confirmQuoteContractedDays(z.quoteId, 6, "Acordado con la persona: 6 días", 1)).toMatchObject({ status: "granted", created: 1 });
    await F.confirmQuoteContractedDays(z.quoteId, 7, "Se alarga a 7 días", 1);
    await F.sweepLearningGrants();
    expect(await rights(z.quoteId)).toHaveLength(1);
    expect((await F.pendingLearningQuotes()).some((p) => p.quoteId === z.quoteId)).toBe(false);
    await expect(F.confirmQuoteContractedDays(z.quoteId, 0, "x", 1)).rejects.toThrow();
    await expect(F.confirmQuoteContractedDays(z.quoteId, 6, "  ", 1)).rejects.toThrow();
  });

  it("(c) sin regla (cuatro días), otro producto o presupuesto sin solicitud: nada", async () => {
    const cuatro = await quote({ variant: V.cuatro, status: "pagado" });
    expect(await F.grantLearningFromQuote(cuatro.quoteId)).toEqual({ status: "skipped", reason: "no_rule" });
    const otro = await quote({ variant: V.fijo6, status: "pagado", experience: 999 });
    expect(await F.grantLearningFromQuote(otro.quoteId)).toEqual({ status: "skipped", reason: "no_rule" });
    expect(await F.grantLearningFromQuote(987654)).toEqual({ status: "skipped", reason: "not_found" });
    expect(await rights(cuatro.quoteId)).toEqual([]);
  });

  it("(c) lo que ya concede una inscripción a convocatoria o un pedido de tienda del mismo presupuesto no se duplica", async () => {
    const enr = await quote({ variant: V.fijo6, status: "pagado" });
    await q("INSERT INTO edition_enrollments (quote_id) VALUES (?)", [enr.quoteId]);
    expect(await F.grantLearningFromQuote(enr.quoteId)).toEqual({ status: "skipped", reason: "via_enrollment" });
    const ord = await quote({ variant: V.fijo6, status: "pagado" });
    await q("INSERT INTO reservations (merchant_order, product_id, variant_id, status, customer_name, customer_email, amount_paid, amount_total, paid_at, quote_id) VALUES ('RQ1',?,?,'paid','x','x@y.example',129000,129000,?,?)", [EXP, V.fijo6, Date.now(), ord.quoteId]);
    const resId = Number((await q("SELECT id FROM reservations WHERE merchant_order = 'RQ1'"))[0].id);
    await q("INSERT INTO learning_enrollments (user_id, course_id, status, source, starts_at, order_id, idempotency_key, created_at, updated_at) VALUES (1, ?, 'active', 'payment', ?, ?, 'pay:order:x:r1:u1', ?, ?)", [c.course, Date.now(), resId, Date.now(), Date.now()]);
    expect(await F.grantLearningFromQuote(ord.quoteId)).toEqual({ status: "skipped", reason: "via_order" });
  });

  it("(c) reutiliza la cuenta existente de la persona sin crear otra", async () => {
    const email = "ya.existe@sin-convocatoria.example";
    await q("INSERT INTO leads (name, email, experienceId, variant_id) VALUES (?,?,?,?)", ["Ya existe", email, EXP, V.fijo6]);
    const leadId = Number((await q("SELECT MAX(id) AS id FROM leads"))[0].id);
    await q("INSERT INTO quotes (quoteNumber, status, total, leadId) VALUES ('P-EX','pagado',1290,?)", [leadId]);
    const quoteId = Number((await q("SELECT id FROM quotes WHERE quoteNumber = 'P-EX'"))[0].id);
    const r = await F.grantLearningFromQuote(quoteId);
    expect(r.status).toBe("granted");
    expect((await q("SELECT COUNT(*) AS n FROM users WHERE LOWER(email) = ?", [email]))[0].n).toBe(1);
    expect((await rights(quoteId))[0].user_id).toBe((await q("SELECT id FROM users WHERE email = ?", [email]))[0].id);
  });

  it("(d) las reglas con días mínimos exigen un entero razonable", async () => {
    const base_ = { experienceId: EXP, variantId: 88, courseId: c.course, moduleIds: [c.m1], durationDays: 30, startMode: "on_grant" as const, fixedStart: null, active: false };
    await expect(L.saveRule({ ...base_, minContractedDays: 0 })).rejects.toThrow(/entero/);
    await expect(L.saveRule({ ...base_, minContractedDays: 400 })).rejects.toThrow(/entero/);
    const id = await L.saveRule({ ...base_, minContractedDays: 6 });
    expect((await L.listRules()).find((r) => r.id === id)?.minContractedDays).toBe(6);
    await L.saveRule({ ...base_, minContractedDays: null }, id);
    expect((await L.listRules()).find((r) => r.id === id)?.minContractedDays).toBeNull();
  });
});
