/**
 * Retiros con varias plazas y reembolsos de presupuestos: nivel de datos con MySQL real (opt-in con REGISTRY_TEST_DATABASE_URL).
 * Sin pasarela, cobros ni correos: presupuestos, solicitudes y cancelaciones son filas mínimas; no se mueve dinero.
 *  (a) cada persona identificada recibe SU derecho pendiente de activar; las plazas las fija la reserva y no hay duplicados,
 *  (b) cada persona activa el suyo cuando quiere, sin afectar a las demás,
 *  (c) retirar a una persona revoca solo su derecho y libera su plaza,
 *  (d) reembolso total/disputa: revoca o suspende a TODA la reserva; el parcial no retira nada por sí solo y queda por decidir,
 *  (e) la decisión sobre un parcial retira a quien se indique y conserva a los demás,
 *  (f) presupuesto perdido o cancelación aceptada: se revoca; cancelación parcial: solo se anota.
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
  createInvitedUser: async (u: { name: string; email: string }) => {
    const [r] = (await pool!.query("INSERT INTO users (email, name, passwordHash, inviteAccepted) VALUES (?, ?, NULL, 0)", [u.email, u.name])) as any;
    return { id: Number(r.insertId) };
  },
}));
vi.mock("./config", () => ({ getSystemSetting: async (_k: string, f = "") => f }));

const DAY = 86_400_000;

describe.skipIf(!URL_)("Retiros con varias plazas y reembolsos de presupuestos", () => {
  let L: typeof import("./learningDb");
  let F: typeof import("./learningFlow");
  const c = { course: 0, m1: 0 };
  const EXP = 9;
  const VAR = 91;
  let seq = 0;
  const q = async (text: string, params: unknown[] = []) => ((await pool!.query(text, params)) as any)[0] as any[];

  /** Reserva de `seats` plazas con el estado de pago dado. */
  const booking = async (o: { seats: number; status?: string; paid?: boolean }) => {
    const email = `reserva${++seq}@plazas.example`;
    await q("INSERT INTO leads (name, email, experienceId, variant_id, numberOfPersons) VALUES (?,?,?,?,?)", ["Quien reserva", email, EXP, VAR, o.seats]);
    const leadId = Number((await q("SELECT id FROM leads WHERE email = ?", [email]))[0].id);
    const paid = o.paid !== false;
    await q("INSERT INTO quotes (quoteNumber, status, total, paidAt, leadId) VALUES (?,?,?,?,?)", [`R-${seq}`, o.status ?? (paid ? "pagado" : "enviado"), 2380, null, leadId]);
    const quoteId = Number((await q("SELECT id FROM quotes WHERE quoteNumber = ?", [`R-${seq}`]))[0].id);
    return { email, quoteId, leadId };
  };
  const rights = (quoteId: number) => q("SELECT e.*, u.email AS email FROM learning_enrollments e JOIN users u ON u.id = e.user_id WHERE e.quote_id = ? ORDER BY e.id", [quoteId]);
  const statusOf = async (quoteId: number) => Object.fromEntries((await rights(quoteId)).map((r) => [r.email, r.status]));

  beforeAll(async () => {
    const base = new URL(URL_!);
    const admin = await mysql.createConnection({ host: base.hostname, port: Number(base.port || 3306), user: decodeURIComponent(base.username), password: decodeURIComponent(base.password) });
    const dbName = `lms_par_${Date.now().toString(36)}`;
    await admin.query(`CREATE DATABASE ${dbName}`);
    await admin.end();
    pool = mysql.createPool({ host: base.hostname, port: Number(base.port || 3306), user: decodeURIComponent(base.username), password: decodeURIComponent(base.password), database: dbName, multipleStatements: true, connectionLimit: 10 });
    database = drizzle(pool);
    for (const f of ["0079_learning_core.sql", "0089_learning_acceso_por_modulo.sql", "0092_learning_activacion_voluntaria.sql", "0093_learning_retiros_terminos.sql", "0094_learning_participantes.sql"]) await pool.query(readFileSync(new URL(`../db/migrations/${f}`, import.meta.url), "utf8"));
    await pool.query("CREATE TABLE users (id INT AUTO_INCREMENT PRIMARY KEY, email VARCHAR(190), name VARCHAR(190) NULL, passwordHash VARCHAR(255) NULL, inviteAccepted TINYINT NULL)");
    await pool.query("CREATE TABLE leads (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(190), email VARCHAR(190), experienceId INT NULL, variant_id INT NULL, numberOfPersons INT NULL)");
    await pool.query("CREATE TABLE quotes (id INT AUTO_INCREMENT PRIMARY KEY, quoteNumber VARCHAR(32) UNIQUE, status VARCHAR(30), total DECIMAL(10,2), paidAt DATETIME NULL, leadId INT)");
    await pool.query("CREATE TABLE edition_enrollments (id INT AUTO_INCREMENT PRIMARY KEY, quote_id INT NULL)");
    await pool.query("CREATE TABLE reservations (id INT AUTO_INCREMENT PRIMARY KEY, merchant_order VARCHAR(30), product_id INT, variant_id INT NULL, status VARCHAR(20), customer_name VARCHAR(120), customer_email VARCHAR(190), amount_paid INT NULL, amount_total INT NULL, paid_at BIGINT NULL, quote_id INT NULL, changes_log JSON NULL)");
    await pool.query("CREATE TABLE cancellation_requests (id INT AUTO_INCREMENT PRIMARY KEY, cancellation_number VARCHAR(32), linked_quote_id INT NULL, linked_reservation_id INT NULL, resolution_status VARCHAR(20), cancellation_scope VARCHAR(10) NULL)");
    L = await import("./learningDb");
    F = await import("./learningFlow");
    const now = Date.now();
    await q("INSERT INTO learning_courses (slug, title, language, status, created_at, updated_at) VALUES ('par','RECONNECT','de','published',?,?)", [now, now]);
    c.course = Number((await q("SELECT id FROM learning_courses WHERE slug = 'par'"))[0].id);
    await q("INSERT INTO learning_modules (course_id, position, title, source_key, created_at, updated_at) VALUES (?,?,?,?,?,?)", [c.course, 1, "TEIL 1", "m0", now, now]);
    c.m1 = Number((await q("SELECT id FROM learning_modules WHERE course_id = ?", [c.course]))[0].id);
    await L.saveRule({ experienceId: EXP, variantId: VAR, courseId: c.course, moduleIds: [c.m1], durationDays: 30, startMode: "on_grant", fixedStart: null, active: true, activationRequired: true });
  }, 120_000);
  afterAll(async () => {
    await pool?.end();
  });

  it("(a) cada persona identificada recibe SU derecho pendiente; las plazas las fija la reserva y no hay duplicados", async () => {
    const b = await booking({ seats: 3, paid: false });
    expect(await F.grantLearningFromQuote(b.quoteId)).toEqual({ status: "skipped", reason: "not_paid" }); // sin pagar no concede
    await q("UPDATE quotes SET status = 'pagado' WHERE id = ?", [b.quoteId]);
    expect(await F.grantLearningFromQuote(b.quoteId)).toMatchObject({ status: "granted", created: 1 }); // quien reservó
    const a = await F.addQuoteParticipant(b.quoteId, { name: "Ana", email: "Ana@Plazas.example" }, 1);
    expect(a).toMatchObject({ created: true, grant: { status: "granted", created: 1, existing: 1 } });
    const bb = await F.addQuoteParticipant(b.quoteId, { name: "Beto", email: "beto@plazas.example" }, 1);
    expect(bb.created).toBe(true);
    const list = await rights(b.quoteId);
    expect(list).toHaveLength(3);
    expect(new Set(list.map((r) => r.user_id)).size).toBe(3); // una matrícula por persona
    expect(list.every((r) => r.pending_activation_days === 30 && r.ends_at == null)).toBe(true);
    // Idempotente y con las plazas llenas
    expect((await F.addQuoteParticipant(b.quoteId, { name: "Ana", email: "ana@plazas.example" }, 1)).created).toBe(false);
    await expect(F.addQuoteParticipant(b.quoteId, { name: "Extra", email: "extra@plazas.example" }, 1)).rejects.toThrow(/plazas/);
    await expect(F.addQuoteParticipant(b.quoteId, { name: "Yo", email: b.email }, 1)).rejects.toThrow(/hizo la reserva/);
    await F.sweepLearningGrants();
    await Promise.all([F.grantLearningFromQuote(b.quoteId), F.grantLearningFromQuote(b.quoteId)]);
    expect(await rights(b.quoteId)).toHaveLength(3);
  });

  it("(a) validaciones: correo y nombre, reserva de una plaza, presupuesto cancelado o inexistente", async () => {
    const one = await booking({ seats: 1 });
    await expect(F.addQuoteParticipant(one.quoteId, { name: "Ana", email: "ana@x.example" }, 1)).rejects.toThrow(/una sola plaza/);
    const two = await booking({ seats: 2 });
    await expect(F.addQuoteParticipant(two.quoteId, { name: "Ana", email: "no-es-un-correo" }, 1)).rejects.toThrow(/correo válido/);
    await expect(F.addQuoteParticipant(two.quoteId, { name: "  ", email: "ana@x.example" }, 1)).rejects.toThrow(/nombre/);
    await expect(F.addQuoteParticipant(987654, { name: "Ana", email: "ana@x.example" }, 1)).rejects.toThrow(/no existe/);
    const lost = await booking({ seats: 2, status: "perdido" });
    await expect(F.addQuoteParticipant(lost.quoteId, { name: "Ana", email: "ana@x.example" }, 1)).rejects.toThrow(/cancelado/);
  });

  it("(a) una persona añadida antes del pago no tiene derecho hasta que el presupuesto se paga", async () => {
    const b = await booking({ seats: 2, paid: false });
    const r = await F.addQuoteParticipant(b.quoteId, { name: "Carla", email: "carla@plazas.example" }, 1);
    expect(r.grant).toMatchObject({ status: "skipped", reason: "not_paid" });
    expect(await rights(b.quoteId)).toEqual([]);
    await q("UPDATE quotes SET status = 'pagado' WHERE id = ?", [b.quoteId]);
    await F.sweepLearningGrants();
    expect(Object.keys(await statusOf(b.quoteId)).sort()).toEqual([b.email, "carla@plazas.example"].sort());
  });

  it("(b) cada persona activa el suyo cuando quiere, sin afectar a las demás", async () => {
    const b = await booking({ seats: 2 });
    await F.addQuoteParticipant(b.quoteId, { name: "Dani", email: "dani@plazas.example" }, 1);
    const [buyer, dani] = await rights(b.quoteId);
    const t = Date.now() + 5 * DAY;
    await L.activateEnrollment(buyer.id, buyer.user_id, t);
    const after = await rights(b.quoteId);
    expect(Number(after[0].ends_at)).toBe(t + 30 * DAY);
    expect(after[1].pending_activation_days).toBe(30); // la otra persona sigue pendiente
    await expect(L.activateEnrollment(dani.id, buyer.user_id)).rejects.toMatchObject({ code: "FORBIDDEN" }); // y nadie activa el de otra
    const t2 = Date.now() + 60 * DAY;
    await L.activateEnrollment(dani.id, dani.user_id, t2);
    expect(Number((await rights(b.quoteId))[1].ends_at)).toBe(t2 + 30 * DAY);
  });

  it("(c) retirar a una persona revoca solo su derecho y libera su plaza; no puede volver a entrar sola", async () => {
    const b = await booking({ seats: 3 });
    const a = await F.addQuoteParticipant(b.quoteId, { name: "Eva", email: "eva@plazas.example" }, 1);
    await F.addQuoteParticipant(b.quoteId, { name: "Fede", email: "fede@plazas.example" }, 1);
    await expect(F.removeQuoteParticipant(a.participant.id, "  ", 1)).rejects.toThrow(/motivo/);
    expect(await F.removeQuoteParticipant(a.participant.id, "No viaja", 1)).toEqual({ removed: true, revokedEnrollments: 1 });
    const st = await statusOf(b.quoteId);
    expect(st["eva@plazas.example"]).toBe("revoked");
    expect(st[b.email]).toBe("active");
    expect(st["fede@plazas.example"]).toBe("active");
    expect(await F.removeQuoteParticipant(a.participant.id, "No viaja", 1)).toEqual({ removed: false, revokedEnrollments: 0 }); // repetirlo no hace nada
    await F.sweepLearningGrants();
    expect((await statusOf(b.quoteId))["eva@plazas.example"]).toBe("revoked"); // el barrido no se lo devuelve
    expect((await F.addQuoteParticipant(b.quoteId, { name: "Gala", email: "gala@plazas.example" }, 1)).created).toBe(true); // su plaza quedó libre
    await expect(F.addQuoteParticipant(b.quoteId, { name: "Eva", email: "eva@plazas.example" }, 1)).rejects.toThrow(/retirada/);
  });

  it("(d) reembolso total o disputa perdida: revoca a toda la reserva; disputa abierta suspende y ganada reabre solo lo suspendido por Stripe", async () => {
    const b = await booking({ seats: 2 });
    await F.addQuoteParticipant(b.quoteId, { name: "Hugo", email: "hugo@plazas.example" }, 1);
    const manual = (await rights(b.quoteId))[1];
    await L.suspendEnrollment(manual.id, "Suspensión manual de prueba", 1);
    expect((await F.changeLearningAccessForQuote(b.quoteId, "suspend", "Stripe: disputa abierta, acceso en pausa")).changed).toBe(1); // solo el activo
    expect((await F.changeLearningAccessForQuote(b.quoteId, "reactivate", "Stripe: disputa ganada, acceso restablecido")).changed).toBe(1); // el manual no se reabre
    expect((await statusOf(b.quoteId))["hugo@plazas.example"]).toBe("suspended");
    expect((await F.changeLearningAccessForQuote(b.quoteId, "revoke", "Stripe: reembolso total del presupuesto")).changed).toBe(2);
    expect(Object.values(await statusOf(b.quoteId))).toEqual(["revoked", "revoked"]);
    expect((await F.changeLearningAccessForQuote(b.quoteId, "revoke", "Stripe: reembolso total del presupuesto")).changed).toBe(0);
  });

  it("(e) devolución parcial: no retira nada, queda por decidir y la decisión retira a quien se indique conservando a los demás", async () => {
    const b = await booking({ seats: 3 });
    await F.addQuoteParticipant(b.quoteId, { name: "Iris", email: "iris@plazas.example" }, 1);
    await F.addQuoteParticipant(b.quoteId, { name: "Joel", email: "joel@plazas.example" }, 1);
    const before = await rights(b.quoteId);
    expect(await F.flagPartialQuoteRefund(b.quoteId, { key: "evt_1", refundedCents: 79300, chargedCents: 238000, source: "Stripe: reembolso parcial" })).toBe(3);
    expect(await F.flagPartialQuoteRefund(b.quoteId, { key: "evt_1", refundedCents: 79300, chargedCents: 238000, source: "Stripe: reembolso parcial" })).toBe(0); // el mismo hecho no se duplica
    expect(Object.values(await statusOf(b.quoteId))).toEqual(["active", "active", "active"]); // nada se retira solo
    const review = (await F.listQuoteRefundReviews()).find((r) => r.quoteId === b.quoteId)!;
    expect(review).toMatchObject({ refundedCents: 79300, chargedCents: 238000 });
    expect(review.people.map((p) => p.email).sort()).toEqual([b.email, "iris@plazas.example", "joel@plazas.example"].sort());
    const joel = before.find((r) => r.email === "joel@plazas.example")!;
    await expect(F.resolveQuoteRefundReview(b.quoteId, [joel.id], " ", 1)).rejects.toThrow(/motivo/);
    await expect(F.resolveQuoteRefundReview(b.quoteId, [999999], "Una plaza devuelta", 1)).rejects.toThrow(/no pertenece/);
    expect(await F.resolveQuoteRefundReview(b.quoteId, [joel.id], "Joel no viaja: una plaza devuelta", 1)).toEqual({ revoked: 1, kept: 2 });
    const st = await statusOf(b.quoteId);
    expect([st[b.email], st["iris@plazas.example"], st["joel@plazas.example"]]).toEqual(["active", "active", "revoked"]);
    expect((await F.listQuoteRefundReviews()).some((r) => r.quoteId === b.quoteId)).toBe(false); // ya decidido
    expect(await F.resolveQuoteRefundReview(b.quoteId, [joel.id], "Joel no viaja: una plaza devuelta", 1)).toEqual({ revoked: 0, kept: 2 }); // idempotente
  });

  it("(f) presupuesto perdido o cancelación aceptada: se revoca; cancelación parcial: solo se anota", async () => {
    const lost = await booking({ seats: 1 });
    await F.grantLearningFromQuote(lost.quoteId);
    await q("UPDATE quotes SET status = 'perdido' WHERE id = ?", [lost.quoteId]);
    const cancelled = await booking({ seats: 2 });
    await F.addQuoteParticipant(cancelled.quoteId, { name: "Kai", email: "kai@plazas.example" }, 1);
    await q("INSERT INTO cancellation_requests (cancellation_number, linked_quote_id, resolution_status, cancellation_scope) VALUES ('C-1', ?, 'aceptada_total', NULL)", [cancelled.quoteId]);
    const partial = await booking({ seats: 2 });
    await F.addQuoteParticipant(partial.quoteId, { name: "Lía", email: "lia@plazas.example" }, 1);
    await q("INSERT INTO cancellation_requests (cancellation_number, linked_quote_id, resolution_status, cancellation_scope) VALUES ('C-2', ?, 'aceptada_parcial', 'lineas')", [partial.quoteId]);
    const r1 = await F.reconcileCancelledQuoteRights();
    expect(r1.revoked).toBe(3); // 1 (perdido) + 2 (cancelación total)
    expect(Object.values(await statusOf(lost.quoteId))).toEqual(["revoked"]);
    expect(Object.values(await statusOf(cancelled.quoteId))).toEqual(["revoked", "revoked"]);
    expect(Object.values(await statusOf(partial.quoteId))).toEqual(["active", "active"]); // la parcial no retira nada
    expect((await F.listQuoteRefundReviews()).some((r) => r.quoteId === partial.quoteId)).toBe(true);
    const r2 = await F.reconcileCancelledQuoteRights();
    expect(r2).toEqual({ revoked: 0, flagged: 0 }); // repetirlo no cambia nada
  });

  it("(a) el listado de pendientes enseña plazas sin identificar y desaparece al completarse", async () => {
    const b = await booking({ seats: 3 });
    await F.grantLearningFromQuote(b.quoteId);
    const item = () => F.pendingLearningQuotes().then((l) => l.find((p) => p.quoteId === b.quoteId));
    expect(await item()).toMatchObject({ seats: 3, participants: 0, missingRecipients: 0 });
    await F.addQuoteParticipant(b.quoteId, { name: "Mar", email: "mar@plazas.example" }, 1);
    expect(await item()).toMatchObject({ participants: 1 });
    await F.addQuoteParticipant(b.quoteId, { name: "Nico", email: "nico@plazas.example" }, 1);
    expect(await item()).toBeUndefined();
  });
});
