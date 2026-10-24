/**
 * Métricas por empresa con su procedencia (GET /cp/v1/tenants/:id/metrics) contra bases REALES de dos empresas
 * (opt-in, REGISTRY_TEST_DATABASE_URL): las calculadas salen de la base de cada empresa con sus credenciales y no se
 * mezclan; lo no medido no tiene cifra; permisos y empresas inexistentes.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import crypto from "node:crypto";
import mysql from "mysql2/promise";
import { startElephantStack, type ElephantStack } from "./elephantStack.testkit";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;

describe.skipIf(!URL_)("métricas por empresa (MySQL real, dos empresas)", () => {
  let s: ElephantStack;
  let A = "";
  let B = "";
  const signUp = async (company: string, email: string) => {
    expect((await s.cp("POST", "/public/trial", { body: { email, companyName: company, idempotencyKey: crypto.randomBytes(12).toString("hex") } })).status).toBe(202);
    const v = await s.cp("POST", "/public/trial/verify", { body: s.verificationLink(email) });
    const id = String(v.json.domain).split(".")[0];
    s.tenants.push(id);
    return id;
  };
  const metric = (r: any, id: string) => r.json.metrics.find((m: any) => m.id === id);

  beforeAll(async () => {
    s = await startElephantStack(URL_!, { label: "met" });
    A = await signUp("Empresa Métricas A", `a-${s.run}@metricas-a.example`);
    B = await signUp("Empresa Métricas B", `b-${s.run}@metricas-b.example`);
    const c = await s.tenantConn(A);
    try {
      // Dos usuarios más en A: uno activo con acceso reciente y uno desactivado
      await c.query("INSERT INTO users (openId, name, email, role, isActive, createdAt, lastSignedIn) VALUES (?, 'Activo', ?, 'agente', 1, NOW() - INTERVAL 10 DAY, NOW() - INTERVAL 1 DAY), (?, 'Baja', ?, 'agente', 0, NOW(), NOW())", [
        `m-${crypto.randomBytes(6).toString("hex")}`,
        `activo-${s.run}@metricas-a.example`,
        `m-${crypto.randomBytes(6).toString("hex")}`,
        `baja-${s.run}@metricas-a.example`,
      ]);
    } finally {
      await c.end();
    }
  }, 300_000);
  afterAll(async () => {
    await s?.close();
  });

  it("cada métrica declara su procedencia; lo no medido nunca tiene cifra", async () => {
    const r = await s.cp("GET", `/tenants/${A}/metrics`, { token: s.adminToken });
    expect(r.status).toBe(200);
    for (const m of r.json.metrics) expect(["measured", "calculated", "estimated", "unavailable"]).toContain(m.kind);
    for (const m of r.json.metrics.filter((x: any) => x.kind === "unavailable")) expect(m.value).toBeNull();
    // Este banco no tiene base de medición: las medidas no se inventan (null y motivo)
    expect(r.json.measurement).toBe("not_configured");
    expect(metric(r, "http.request")).toMatchObject({ kind: "measured", value: null, missing: expect.stringMatching(/no configurada/) });
  });

  it("calculadas desde la base de CADA empresa: tamaño y usuarios no se mezclan", async () => {
    const a = await s.cp("GET", `/tenants/${A}/metrics`, { token: s.adminToken });
    const b = await s.cp("GET", `/tenants/${B}/metrics`, { token: s.adminToken });
    expect(metric(a, "db.size.bytes").value).toBeGreaterThan(0);
    expect(metric(b, "db.size.bytes").value).toBeGreaterThan(0);
    // A: propietaria + activo (habilitados 2; la baja no cuenta); activos en 30 días: solo el que entró hace 1 día
    expect(metric(a, "users.enabled").value).toBe(2);
    expect(metric(a, "users.active").value).toBe(1);
    // B: solo su propietario, que nunca ha entrado (no cuenta como activo)
    expect(metric(b, "users.enabled").value).toBe(1);
    expect(metric(b, "users.active").value).toBe(0);
  });

  it("almacenamiento ocupado y correo de 30 días, calculados desde la base de CADA empresa", async () => {
    const before = await s.cp("GET", `/tenants/${A}/metrics`, { token: s.adminToken });
    const bBefore = await s.cp("GET", `/tenants/${B}/metrics`, { token: s.adminToken });
    for (const id of ["storage.total.bytes", "email.delivered.30d", "email.problems.30d"]) expect(metric(before, id)).toMatchObject({ kind: "calculated", value: expect.any(Number) });
    const now = Date.now();
    const c = await s.tenantConn(A);
    try {
      const obj = (n: number) => `obj${s.run}${n}`.slice(0, 26).padEnd(26, "0");
      await c.query(
        "INSERT INTO stored_objects (object_id, storage_key, visibility, category, content_type, size_bytes, sha256, status, created_at, updated_at) VALUES (?, ?, 'private', 'document', 'application/pdf', 1000, ?, 'active', ?, ?), (?, ?, 'private', 'data-export', 'application/zip', 5000, ?, 'active', ?, ?), (?, ?, 'private', 'document', 'application/pdf', 777, ?, 'deleted', ?, ?)",
        [obj(1), "k1", "a".repeat(64), now, now, obj(2), "k2", "b".repeat(64), now, now, obj(3), "k3", "c".repeat(64), now, now],
      );
      const mail = (k: string, st: string, at: number) => [A, k, "user_invite", st, "h".repeat(64), "a***@x.example", "Empresa", "no-reply@x.example", "Asunto", at, at];
      await c.query(
        "INSERT INTO mail_outbox (tenant_id, idempotency_key, category, status, recipient_hash, recipient_masked, sender_name, sender_email, subject, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?), (?,?,?,?,?,?,?,?,?,?,?), (?,?,?,?,?,?,?,?,?,?,?), (?,?,?,?,?,?,?,?,?,?,?)",
        [...mail(`m1-${s.run}`, "delivered", now), ...mail(`m2-${s.run}`, "accepted", now), ...mail(`m3-${s.run}`, "bounced", now), ...mail(`m4-${s.run}`, "delivered", now - 40 * 86_400_000)],
      );
    } finally {
      await c.end();
    }
    const after = await s.cp("GET", `/tenants/${A}/metrics`, { token: s.adminToken });
    const bAfter = await s.cp("GET", `/tenants/${B}/metrics`, { token: s.adminToken });
    // Solo cuenta el fichero vigente (ni la exportación ni el borrado) y el correo de los últimos 30 días
    expect(metric(after, "storage.total.bytes").value - metric(before, "storage.total.bytes").value).toBe(1000);
    expect(metric(after, "email.delivered.30d").value - metric(before, "email.delivered.30d").value).toBe(2);
    expect(metric(after, "email.problems.30d").value - metric(before, "email.problems.30d").value).toBe(1);
    // B no se ve afectada
    for (const id of ["storage.total.bytes", "email.delivered.30d", "email.problems.30d"]) expect(metric(bAfter, id).value).toBe(metric(bBefore, id).value);
  });

  it("permisos y empresas inexistentes", async () => {
    expect((await s.cp("GET", `/tenants/${A}/metrics`, { token: s.readerToken })).status).toBe(403);
    expect((await s.cp("GET", `/tenants/${A}/metrics`)).status).toBe(401);
    expect((await s.cp("GET", "/tenants/no-existe-abc/metrics", { token: s.adminToken })).status).toBe(404);
    expect((await s.cp("GET", `/tenants/${A}/metrics?days=91`, { token: s.adminToken })).status).toBe(400);
  });
});
