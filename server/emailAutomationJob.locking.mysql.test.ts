/**
 * Reclamación atómica de envíos programados sobre MySQL real (opt-in, REGISTRY_TEST_DATABASE_URL).
 * Adaptado de Skicenter (a68e3190): el bloqueo ignoraba affectedRows y dos ejecuciones solapadas (p. ej. dos
 * contenedores durante un despliegue) enviaban el mismo correo dos veces; un bloqueo de un proceso muerto no se
 * liberaba nunca. Base desechable con filas sintéticas; no se envía ningún correo.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import crypto from "node:crypto";
import mysql from "mysql2/promise";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
const DB = `email_lock_${crypto.randomBytes(3).toString("hex")}`;

describe.skipIf(!URL_)("envíos programados: bloqueo atómico y recuperación", () => {
  let admin: mysql.Pool;
  let pool: mysql.Pool;
  let job: typeof import("./emailAutomationJob");
  const saved = { ...process.env };

  async function insertJob(o: { status?: string; lockedMsAgo?: number | null; attempts?: number } = {}): Promise<number> {
    // Mismo formato que escribe la aplicación (drizzle guarda TIMESTAMP en UTC)
    const locked = o.lockedMsAgo == null ? null : new Date(Date.now() - o.lockedMsAgo).toISOString().slice(0, 19).replace("T", " ");
    const [r] = await pool.query<mysql.ResultSetHeader>(
      "INSERT INTO email_scheduled_jobs (relatedEntityType, relatedEntityId, templateKey, ruleId, scheduledFor, status, attempts, lockedAt, recipientEmail) VALUES ('quote', 0, 'prueba', 0, NOW(), ?, ?, ?, 'cliente@prueba.example')",
      [o.status ?? "pending", o.attempts ?? 0, locked],
    );
    return r.insertId;
  }
  async function row(id: number) {
    const [[r]] = (await pool.query("SELECT status, lockedAt, attempts, errorMessage FROM email_scheduled_jobs WHERE id = ?", [id])) as unknown as [
      Array<{ status: string; lockedAt: Date | null; attempts: number; errorMessage: string | null }>,
    ];
    return r;
  }

  beforeAll(async () => {
    admin = mysql.createPool({ uri: URL_!, connectionLimit: 2 });
    await admin.query(`CREATE DATABASE ${DB} CHARACTER SET utf8mb4`);
    const u = new URL(URL_!);
    u.pathname = `/${DB}`;
    pool = mysql.createPool({ uri: u.toString(), connectionLimit: 4 });
    await pool.query(`CREATE TABLE email_scheduled_jobs (
      id INT AUTO_INCREMENT PRIMARY KEY,
      relatedEntityType VARCHAR(64) NOT NULL,
      relatedEntityId INT NOT NULL,
      templateKey VARCHAR(128) NOT NULL,
      ruleId INT NOT NULL,
      recipientEmail VARCHAR(320),
      scheduledFor TIMESTAMP NOT NULL,
      status ENUM('pending','sent','skipped','failed','cancelled') NOT NULL DEFAULT 'pending',
      attempts INT NOT NULL DEFAULT 0,
      lastAttemptAt TIMESTAMP NULL,
      errorMessage TEXT,
      skipReason VARCHAR(256),
      lockedAt TIMESTAMP NULL,
      metadataJson JSON,
      createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )`);
    // Modo de una sola empresa: el acceso heredado resuelve la BD por DATABASE_URL
    delete process.env.TENANT_MODE;
    process.env.DATABASE_URL = u.toString();
    job = await import("./emailAutomationJob");
  });

  afterAll(async () => {
    process.env = saved;
    await pool?.end().catch(() => undefined);
    await admin?.query(`DROP DATABASE IF EXISTS ${DB}`);
    await admin?.end();
  });

  it("de varias reclamaciones concurrentes sobre el mismo job solo una gana y cuenta un único intento", async () => {
    const id = await insertJob();
    const results = await Promise.all([job.claimJob(id), job.claimJob(id), job.claimJob(id), job.claimJob(id)]);
    expect(results.filter(Boolean)).toHaveLength(1);
    const r = await row(id);
    expect(r.attempts).toBe(1);
    expect(r.lockedAt).not.toBeNull();
  });

  it("dos reclamaciones concurrentes: exactamente una devuelve true", async () => {
    const id = await insertJob();
    const [a, b] = await Promise.all([job.claimJob(id), job.claimJob(id)]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
  });

  it("un job ya enviado no se puede reclamar", async () => {
    const id = await insertJob({ status: "sent" });
    expect(await job.claimJob(id)).toBe(false);
  });

  it("libera el bloqueo abandonado (>30 min), respeta el reciente y da por fallido el que agotó intentos", async () => {
    const abandonado = await insertJob({ lockedMsAgo: job.STALE_LOCK_MS + 60_000, attempts: 1 });
    const reciente = await insertJob({ lockedMsAgo: 60_000, attempts: 1 });
    const agotado = await insertJob({ lockedMsAgo: job.STALE_LOCK_MS + 60_000, attempts: job.MAX_STALE_RETRIES });

    const res = await job.releaseStaleJobLocks(new Date());
    expect(res).toEqual({ released: 1, failed: 1 });

    const a = await row(abandonado);
    expect(a.lockedAt).toBeNull();
    expect(a.status).toBe("pending");
    const r = await row(reciente);
    expect(r.lockedAt).not.toBeNull();
    expect(r.status).toBe("pending");
    const x = await row(agotado);
    expect(x.status).toBe("failed");
    expect(x.lockedAt).toBeNull();
    expect(x.errorMessage).toMatch(/stale_lock/);
    // El liberado vuelve a poder reclamarse
    expect(await job.claimJob(abandonado)).toBe(true);
  });
});
