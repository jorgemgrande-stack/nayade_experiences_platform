/**
 * RECONNECT escalonado y Módulo 1 en retiros (decisión de Indira, 27/11/2026). MySQL real (opt-in, REGISTRY_TEST_DATABASE_URL), sin
 * aplicación, pasarela, cobros ni correos: el pago es una referencia de prueba.
 *  (a) saveRule aplica las prohibiciones de la activación voluntaria sobre el valor EFECTIVO de activation_required (guardado o heredado)
 *      y rechaza duración propia por módulo en esas reglas;
 *  (b) UNA concesión de activación voluntaria por participante y curso: dos retiros → una sola M1 (con evento de auditoría);
 *  (c) escalonado 0/30/60 con 30 días EXACTOS (30 × 24 h) por módulo: ventanas contiguas, fronteras, estados y +MODUL 1;
 *  (d) listEnrollments devuelve el estado por módulo para la administración;
 *  (e) catálogo de ampliaciones: validación de producto y variantes y guardado del ajuste.
 */
import mysql from "mysql2/promise";
import { readFileSync } from "node:fs";
import { drizzle } from "drizzle-orm/mysql2";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
vi.setConfig({ testTimeout: 60_000 });

let pool: mysql.Pool | null = null;
let database: ReturnType<typeof drizzle> | null = null;

/** Producto de ampliaciones simulado: 501 = +30 días (33 €), 502 = +60 días (55 €), 503 caducada, 504 sin precio; 600 = otro producto. */
const PRODUCTS: Record<number, { id: number; title: string; basePrice: string }> = { 500: { id: 500, title: "Modulverlängerung", basePrice: "0" }, 600: { id: 600, title: "Otro", basePrice: "10" } };
const VARIANTS = [
  { id: 501, experienceId: 500, name: "+30 Tage", priceType: "fixed", priceModifier: "33.00", validUntil: null, supplementGroup: null },
  { id: 502, experienceId: 500, name: "+60 Tage", priceType: "fixed", priceModifier: "55.00", validUntil: null, supplementGroup: null },
  { id: 503, experienceId: 500, name: "Caducada", priceType: "fixed", priceModifier: "33.00", validUntil: "2020-01-01", supplementGroup: null },
  { id: 504, experienceId: 500, name: "Sin precio", priceType: "fixed", priceModifier: "0", validUntil: null, supplementGroup: null },
  { id: 601, experienceId: 600, name: "Ajena", priceType: "fixed", priceModifier: "33.00", validUntil: null, supplementGroup: null },
];
vi.mock("./db", () => ({
  getDb: async () => database,
  getExperienceById: async (id: number) => PRODUCTS[id] ?? null,
  getVariantsByExperience: async (experienceId: number, opts: { includeExpired?: boolean } = {}) => VARIANTS.filter((v) => v.experienceId === experienceId && (opts.includeExpired || !v.validUntil)),
}));
vi.mock("./config", () => ({
  getSystemSetting: async (key: string, fallback = "") => {
    const [r] = ((await pool!.query("SELECT value FROM system_settings WHERE `key` = ?", [key])) as any)[0] as any[];
    return r?.value ?? fallback;
  },
  invalidateConfigCache: () => {},
}));

const DAY = 86_400_000;
const D30 = 30 * DAY;
const T0 = Date.parse("2026-12-01T10:00:00Z");

describe.skipIf(!URL_)("RECONNECT escalonado 0/30/60 · 30 días y Módulo 1 en retiros", () => {
  let L: typeof import("./learningDb");
  let X: typeof import("./learningExtensions");
  let S: typeof import("../shared/learning");
  const c = { exp: 1, course: 0, m: [0, 0, 0] as number[] };
  const V = { plusM1: 13, online: 9, intensiv: 11, retiroA: 201, retiroB: 202 };
  let nextUser = 1000;
  const user = async () => {
    const id = ++nextUser;
    await q("INSERT INTO users (id, name, email) VALUES (?,?,?)", [id, `Persona ${id}`, `p${id}@prueba.test`]);
    return id;
  };
  const q = async (text: string, params: unknown[] = []) => ((await pool!.query(text, params)) as any)[0] as any[];
  const pay = (userId: number, variantId: number, op: { kind: string; id: number }, now = T0, contractedDays: number | null = 6) =>
    L.grantFromPayment({ userId, clientId: null, experienceId: c.exp, variantId, operation: op, quoteId: op.kind === "quote" ? op.id : null, payment: { reference: `${op.kind}:${op.id}`, amountCents: 129_000, verifiedBy: "prueba" }, actorUserId: null, now, contractedDays });
  const can = async (userId: number, idx: number, now: number) => (await L.canAccessModule(userId, c.course, c.m[idx], now)) as { allowed: boolean; reason?: string; unlocksAt?: number };
  const base = (variantId: number, moduleIdx: number[], extra: Record<string, unknown> = {}) =>
    ({ experienceId: c.exp, variantId, courseId: c.course, moduleIds: moduleIdx.map((i) => c.m[i]), durationDays: 30, startMode: "on_grant", fixedStart: null, active: true, ...extra }) as import("./learningDb").RuleInput;

  beforeAll(async () => {
    const u = new URL(URL_!);
    const admin = await mysql.createConnection({ host: u.hostname, port: Number(u.port || 3306), user: decodeURIComponent(u.username), password: decodeURIComponent(u.password) });
    const dbName = `lms_esc_${Date.now().toString(36)}`;
    await admin.query(`CREATE DATABASE ${dbName}`);
    await admin.end();
    pool = mysql.createPool({ host: u.hostname, port: Number(u.port || 3306), user: decodeURIComponent(u.username), password: decodeURIComponent(u.password), database: dbName, multipleStatements: true, flags: ["+FOUND_ROWS"], connectionLimit: 10 });
    database = drizzle(pool);
    for (const f of ["0079_learning_core.sql", "0089_learning_acceso_por_modulo.sql", "0092_learning_activacion_voluntaria.sql", "0093_learning_retiros_terminos.sql"]) await pool.query(readFileSync(new URL(`../db/migrations/${f}`, import.meta.url), "utf8"));
    await pool.query("CREATE TABLE users (id INT PRIMARY KEY, name VARCHAR(190), email VARCHAR(190))");
    await pool.query("CREATE TABLE system_settings (id INT AUTO_INCREMENT PRIMARY KEY, `key` VARCHAR(128) NOT NULL UNIQUE, value TEXT, value_type VARCHAR(16) NOT NULL DEFAULT 'string', category VARCHAR(64) NOT NULL DEFAULT 'general', label VARCHAR(256) NOT NULL, description TEXT)");
    L = await import("./learningDb");
    X = await import("./learningExtensions");
    S = await import("../shared/learning");
    const now = Date.now();
    await q("INSERT INTO learning_courses (slug, title, language, status, created_at, updated_at) VALUES ('reconnect','RECONNECT','de','published',?,?)", [now, now]);
    c.course = Number((await q("SELECT id FROM learning_courses WHERE slug = 'reconnect'"))[0].id);
    for (const k of [0, 1, 2]) {
      await q("INSERT INTO learning_modules (course_id, position, title, source_key, created_at, updated_at) VALUES (?,?,?,?,?,?)", [c.course, k + 1, `MODUL ${k + 1}`, `m${k}`, now, now]);
      c.m[k] = Number((await q("SELECT id FROM learning_modules WHERE course_id = ? AND source_key = ?", [c.course, `m${k}`]))[0].id);
    }
  }, 120_000);
  afterAll(async () => {
    await pool?.end();
  });

  describe("(a) saveRule: prohibiciones sobre el valor efectivo de activation_required", () => {
    it("al crear: la activación voluntaria rechaza duración propia por módulo (se ignoraría) con mensaje claro", async () => {
      await expect(L.saveRule(base(301, [0], { activationRequired: true, moduleSettings: [{ moduleId: c.m[0], durationDays: 15 }] }))).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("duración propia por módulo") });
      // el desbloqueo progresivo sigue teniendo su propio mensaje aunque también lleve duración
      await expect(L.saveRule(base(301, [0, 1], { activationRequired: true, moduleSettings: [{ moduleId: c.m[1], unlockOffsetDays: 30, durationDays: 30 }] }))).rejects.toThrow(/desbloqueo progresivo/);
      // la misma regla SIN activación voluntaria se guarda (control)
      await expect(L.saveRule(base(302, [0], { moduleSettings: [{ moduleId: c.m[0], durationDays: 15 }] }))).resolves.toBeGreaterThan(0);
    });

    it("al editar sin enviar activationRequired se aplica el valor GUARDADO: ni calendario, ni fecha fija, ni sin duración", async () => {
      const id = await L.saveRule(base(303, [0], { activationRequired: true }));
      const edit = (extra: Record<string, unknown>) => L.saveRule(base(303, [0], extra), id); // sin activationRequired en la llamada
      await expect(edit({ moduleSettings: [{ moduleId: c.m[0], unlockOffsetDays: 10 }] })).rejects.toThrow(/desbloqueo progresivo/);
      await expect(edit({ moduleSettings: [{ moduleId: c.m[0], durationDays: 10 }] })).rejects.toThrow(/duración propia por módulo/);
      await expect(edit({ durationDays: null, active: false })).rejects.toThrow(/días de acceso/);
      await expect(edit({ startMode: "fixed_date", fixedStart: T0 })).rejects.toThrow(/fecha fija/);
      // nada de lo anterior tocó la regla
      expect((await L.listRules()).find((r) => r.id === id)).toMatchObject({ activationRequired: true, durationDays: 30, startMode: "on_grant", active: true });
      expect((await L.listRules()).find((r) => r.id === id)!.moduleSchedule).toBeUndefined();
      // una edición válida (desactivar) sigue funcionando y conserva la marca
      await edit({ active: false });
      expect((await L.listRules()).find((r) => r.id === id)).toMatchObject({ activationRequired: true, active: false });
      // quitar expresamente la activación voluntaria permite el calendario
      await expect(L.saveRule(base(303, [0], { activationRequired: false, moduleSettings: [{ moduleId: c.m[0], durationDays: 10 }] }), id)).resolves.toBe(id);
    });

    it("al crear una versión nueva (cambian los módulos) la marca heredada también se comprueba", async () => {
      const id = await L.saveRule(base(304, [0], { activationRequired: true }));
      await expect(L.saveRule(base(304, [0, 1], { moduleSettings: [{ moduleId: c.m[1], unlockOffsetDays: 30 }] }), id)).rejects.toThrow(/desbloqueo progresivo/);
      await expect(L.saveRule(base(304, [0, 1], { moduleSettings: [{ moduleId: c.m[1], durationDays: 30 }] }), id)).rejects.toThrow(/duración propia por módulo/);
      await expect(L.saveRule(base(304, [0, 1], { durationDays: null, active: false }), id)).rejects.toThrow(/días de acceso/);
      expect((await L.listRules()).filter((r) => r.variantId === 304)).toHaveLength(1); // ninguna versión nueva se creó
      const v2 = await L.saveRule(base(304, [0, 1]), id);
      expect(v2).not.toBe(id);
      expect((await L.listRules()).find((r) => r.id === v2)).toMatchObject({ activationRequired: true, active: true });
    });
  });

  describe("(b) una concesión de activación voluntaria por participante", () => {
    it("dos retiros pagados (dos presupuestos, dos reglas) → una sola M1; la segunda queda registrada como omitida", async () => {
      await L.saveRule(base(V.retiroA, [0], { activationRequired: true, minContractedDays: 6 }));
      await L.saveRule(base(V.retiroB, [0], { activationRequired: true, minContractedDays: 6 }));
      const u = await user();
      const first = await pay(u, V.retiroA, { kind: "quote", id: 7001 });
      expect(first.granted).toHaveLength(1);
      expect(first.granted[0].created).toBe(true);
      expect(first.skipped).toEqual([]);
      const enrollmentId = first.granted[0].enrollment.id;
      const second = await pay(u, V.retiroB, { kind: "quote", id: 7002 }, T0 + 5 * DAY);
      expect(second.granted).toEqual([]);
      expect(second.skipped).toEqual([{ ruleId: expect.any(Number), reason: "already_granted", existingEnrollmentId: enrollmentId }]);
      expect(await q("SELECT id FROM learning_enrollments WHERE user_id = ?", [u])).toHaveLength(1);
      // la matrícula existente no cambia; solo recibe el evento de auditoría
      expect((await q("SELECT * FROM learning_enrollments WHERE id = ?", [enrollmentId]))[0]).toMatchObject({ status: "active", pending_activation_days: 30, quote_id: 7001 });
      const ev = await q("SELECT type, detail FROM learning_access_events WHERE enrollment_id = ? AND type = 'grant_skipped'", [enrollmentId]);
      expect(ev).toHaveLength(1);
      expect(typeof ev[0].detail === "string" ? JSON.parse(ev[0].detail) : ev[0].detail).toMatchObject({ reason: "already_granted", operation: { kind: "quote", id: 7002 }, variantId: V.retiroB });
      // repetir el PRIMER presupuesto sigue siendo idempotente (devuelve la existente, no la omite)
      const again = await pay(u, V.retiroA, { kind: "quote", id: 7001 });
      expect(again.granted).toHaveLength(1);
      expect(again.granted[0]).toMatchObject({ created: false, enrollment: { id: enrollmentId } });
      expect(again.skipped).toEqual([]);
      // otra persona del segundo retiro recibe su M1 con normalidad
      const other = await user();
      expect((await pay(other, V.retiroB, { kind: "quote", id: 7002 })).granted[0].created).toBe(true);
    });

    it("también bloquea con el derecho ya ACTIVADO y vigente; con el derecho caducado o revocado vuelve a conceder", async () => {
      const u = await user();
      const e1 = (await pay(u, V.retiroA, { kind: "quote", id: 7101 })).granted[0].enrollment.id;
      await L.activateEnrollment(e1, u, T0);
      expect((await pay(u, V.retiroB, { kind: "quote", id: 7102 }, T0 + 10 * DAY)).skipped).toHaveLength(1);
      // caducado (30 días cumplidos): la siguiente compra sí concede
      const late = await pay(u, V.retiroB, { kind: "quote", id: 7102 }, T0 + 31 * DAY);
      expect(late.granted).toHaveLength(1);
      expect(late.skipped).toEqual([]);
      // revocado: idem
      const w = await user();
      const e2 = (await pay(w, V.retiroA, { kind: "quote", id: 7201 })).granted[0].enrollment.id;
      await L.revokeEnrollment(e2, "Prueba: participante retirado", 1, T0);
      expect((await pay(w, V.retiroB, { kind: "quote", id: 7202 })).granted).toHaveLength(1);
    });

    it("una regla normal (sin activación voluntaria) no se ve afectada", async () => {
      const u = await user();
      await pay(u, V.retiroA, { kind: "quote", id: 7301 });
      await L.saveRule(base(305, [0]));
      const r = await pay(u, 305, { kind: "order", id: 7302 });
      expect(r.granted).toHaveLength(1);
      expect(r.skipped).toEqual([]);
    });
  });

  describe("(c) escalonado 0/30/60 con 30 días exactos por módulo", () => {
    it("ONLINE KOMPLETT e INTENSIV: ventanas contiguas en ms exactos, fronteras y estados; +MODUL 1 solo M1 30 días", async () => {
      const settings = S.reconnectStaggeredSettings([c.m[0], c.m[1], c.m[2]]);
      await L.saveRule(base(V.online, [0, 1, 2], { moduleSettings: settings }));
      await L.saveRule(base(V.intensiv, [0, 1, 2], { moduleSettings: settings }));
      await L.saveRule(base(V.plusM1, [0], { moduleSettings: S.reconnectStaggeredSettings([c.m[0]]) }));
      const u = await user();
      const enr = (await pay(u, V.online, { kind: "order", id: 8001 }, T0, null)).granted[0].enrollment;
      expect(enr.endsAt).toBe(T0 + 3 * D30);
      const wins = await q("SELECT module_id, starts_at, ends_at FROM learning_enrollment_modules WHERE enrollment_id = ? ORDER BY module_id", [enr.id]);
      expect(wins.map((w) => [Number(w.module_id), w.starts_at == null ? null : Number(w.starts_at), Number(w.ends_at)])).toEqual([
        [c.m[0], null, T0 + D30],
        [c.m[1], T0 + D30, T0 + 2 * D30],
        [c.m[2], T0 + 2 * D30, T0 + 3 * D30],
      ]);
      // fronteras: permitido justo antes, denegado en la frontera, y el siguiente abre en ese mismo instante
      expect((await can(u, 0, T0)).allowed).toBe(true);
      expect((await can(u, 0, T0 + D30 - 1)).allowed).toBe(true);
      expect(await can(u, 0, T0 + D30)).toMatchObject({ allowed: false, reason: "expired" });
      expect(await can(u, 1, T0 + D30 - 1)).toMatchObject({ allowed: false, reason: "not_started", unlocksAt: T0 + D30 });
      expect((await can(u, 1, T0 + D30)).allowed).toBe(true);
      expect(await can(u, 1, T0 + 2 * D30)).toMatchObject({ allowed: false, reason: "expired" });
      expect(await can(u, 2, T0 + 2 * D30 - 1)).toMatchObject({ allowed: false, reason: "not_started", unlocksAt: T0 + 2 * D30 });
      expect((await can(u, 2, T0 + 2 * D30)).allowed).toBe(true);
      expect((await can(u, 2, T0 + 3 * D30 - 1)).allowed).toBe(true);
      expect(await can(u, 2, T0 + 3 * D30)).toMatchObject({ allowed: false, reason: "expired" });
      // el aula del alumno: activo / «se desbloquea el» / caducado
      const mid = (await L.myCourses(u, T0 + 45 * DAY))[0];
      expect(mid.status).toBe("active");
      expect(mid.modules.map((m) => m.state)).toEqual(["closed", "open", "locked"]);
      expect(mid.modules[2].unlocksAt).toBe(T0 + 2 * D30);
      // la caducidad programada solo cierra la matrícula al acabar el M3
      await L.expireDue(T0 + 2 * D30 + DAY);
      expect((await q("SELECT status FROM learning_enrollments WHERE id = ?", [enr.id]))[0].status).toBe("active");
      await L.expireDue(T0 + 3 * D30);
      expect((await q("SELECT status FROM learning_enrollments WHERE id = ?", [enr.id]))[0].status).toBe("expired");
      // INTENSIV: mismo escalonado
      const i = await user();
      expect((await pay(i, V.intensiv, { kind: "order", id: 8002 }, T0, null)).granted[0].enrollment.endsAt).toBe(T0 + 3 * D30);
      // +MODUL 1: solo M1, 30 días exactos
      const p = await user();
      const e1 = (await pay(p, V.plusM1, { kind: "order", id: 8003 }, T0, null)).granted[0].enrollment;
      expect(e1.moduleIds).toEqual([c.m[0]]);
      expect(e1.endsAt).toBe(T0 + D30);
      expect((await can(p, 0, T0 + D30 - 1)).allowed).toBe(true);
      expect(await can(p, 0, T0 + D30)).toMatchObject({ allowed: false, reason: "expired" });
      expect(await can(p, 1, T0)).toMatchObject({ allowed: false, reason: "module_not_granted" });
    });
  });

  describe("(d) administración: estado por módulo en listEnrollments", () => {
    it("devuelve activo / futuro / caducado con fechas y títulos; el estado global sigue siendo effectiveEnrollmentStatus", async () => {
      const u = await user();
      await pay(u, V.online, { kind: "order", id: 8101 }, T0, null);
      const [row] = await L.listEnrollments({ userId: u }, T0 + 45 * DAY);
      expect(row.userEmail).toBe(`p${u}@prueba.test`);
      expect(row.pendingActivationDays).toBeNull();
      expect(row.modules).toEqual([
        { moduleId: c.m[0], state: "expired", startsAt: T0, endsAt: T0 + D30, title: "MODUL 1", position: 1 },
        { moduleId: c.m[1], state: "active", startsAt: T0 + D30, endsAt: T0 + 2 * D30, title: "MODUL 2", position: 2 },
        { moduleId: c.m[2], state: "scheduled", startsAt: T0 + 2 * D30, endsAt: T0 + 3 * D30, title: "MODUL 3", position: 3 },
      ]);
      expect(S.effectiveEnrollmentStatus(row, T0 + 45 * DAY)).toBe("active");
      expect(S.effectiveEnrollmentStatus(row, T0 + 3 * D30)).toBe("expired");
      // derecho pendiente de activar (retiro)
      const r = await user();
      await pay(r, V.retiroA, { kind: "quote", id: 8102 });
      const [pend] = await L.listEnrollments({ userId: r }, T0);
      expect(pend.pendingActivationDays).toBe(30);
      expect(pend.modules.map((m) => m.state)).toEqual(["pending_activation"]);
      expect(S.effectiveEnrollmentStatus(pend, T0)).toBe("pending_activation");
    });
  });

  describe("(e) catálogo de ampliaciones", () => {
    it("rechaza producto inexistente, variante ajena, caducada, sin precio o repetida; sin ajuste no hay catálogo", async () => {
      expect(await X.getExtensionCatalog()).toEqual({ config: null, catalog: null });
      await expect(X.setExtensionCatalog({ experienceId: 999, variants: { 30: 501, 60: 502 } }, 1)).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(X.setExtensionCatalog({ experienceId: 500, variants: { 30: 601, 60: 502 } }, 1)).rejects.toThrow(/no pertenece/);
      await expect(X.setExtensionCatalog({ experienceId: 500, variants: { 30: 501, 60: 503 } }, 1)).rejects.toThrow(/caducada/);
      await expect(X.setExtensionCatalog({ experienceId: 500, variants: { 30: 504, 60: 502 } }, 1)).rejects.toThrow(/mayor que cero/);
      await expect(X.setExtensionCatalog({ experienceId: 500, variants: { 30: 501, 60: 501 } }, 1)).rejects.toThrow(/distintas/);
      expect(await q("SELECT 1 FROM system_settings WHERE `key` = 'learning_extension_catalog'")).toEqual([]);
    });

    it("guarda el ajuste y el catálogo resuelve 33 € / 55 € desde las variantes; volver a guardar sustituye", async () => {
      const r = await X.setExtensionCatalog({ experienceId: 500, variants: { 30: 501, 60: 502 } }, 1);
      expect(r.config).toEqual({ experienceId: 500, variants: [{ days: 30, variantId: 501 }, { days: 60, variantId: 502 }] });
      expect(r.catalog).toMatchObject({ experienceId: 500, productName: "Modulverlängerung", offers: [{ days: 30, variantId: 501, priceCents: 3300 }, { days: 60, variantId: 502, priceCents: 5500 }] });
      const [row] = await q("SELECT value, value_type, category FROM system_settings WHERE `key` = 'learning_extension_catalog'");
      expect(JSON.parse(row.value)).toEqual({ experienceId: 500, variants: { "30": 501, "60": 502 } });
      expect(row).toMatchObject({ value_type: "json", category: "learning" });
      expect(await X.extensionOffers()).toEqual([{ days: 30, priceCents: 3300 }, { days: 60, priceCents: 5500 }]);
      await X.setExtensionCatalog({ experienceId: 500, variants: { 30: 502, 60: 501 } }, 1);
      expect(await q("SELECT 1 FROM system_settings WHERE `key` = 'learning_extension_catalog'")).toHaveLength(1);
      expect((await X.getExtensionCatalog()).config?.variants).toEqual([{ days: 30, variantId: 502 }, { days: 60, variantId: 501 }]);
    });
  });
});
