/**
 * Exclusión entre réplicas con MySQL real (opt-in, REGISTRY_TEST_DATABASE_URL): `GET_LOCK`/`RELEASE_LOCK` sobre una
 * conexión dedicada por «réplica». Si la réplica muere (su sesión se cierra), MySQL libera el bloqueo y otra lo toma.
 */
import { describe, it, expect, afterAll } from "vitest";
import crypto from "node:crypto";
import mysql from "mysql2/promise";
import { jobLockKey, mysqlJobLockProvider } from "./_core/tenantRegistry/jobLocks";

const url = process.env.REGISTRY_TEST_DATABASE_URL;
const d = url ? describe : describe.skip;
const run = crypto.randomBytes(3).toString("hex");
const conns: mysql.Connection[] = [];

const connect = async () => {
  const c = await mysql.createConnection({ uri: url!, connectTimeout: 5_000 });
  conns.push(c);
  return c;
};

afterAll(async () => {
  await Promise.all(conns.map((c) => c.end().catch(() => undefined)));
});

d("bloqueos de tareas con GET_LOCK", () => {
  it("una réplica lo tiene, la otra no lo obtiene; al soltarlo, sí", async () => {
    const a = mysqlJobLockProvider(connect);
    const b = mysqlJobLockProvider(connect);
    const key = jobLockKey(`prueba-${run}`, "emp-uno");
    const la = await a.tryAcquire(key);
    expect(la).not.toBeNull();
    expect(await b.tryAcquire(key)).toBeNull();
    // Otra empresa de la misma tarea no se bloquea
    const otra = await b.tryAcquire(jobLockKey(`prueba-${run}`, "emp-dos"));
    expect(otra).not.toBeNull();
    await la!.release();
    const lb = await b.tryAcquire(key);
    expect(lb).not.toBeNull();
    await lb!.release();
    await otra!.release();
  });

  it("si la réplica que lo tiene muere, MySQL lo libera y otra recupera la tarea", async () => {
    let dead: mysql.Connection | null = null;
    const a = mysqlJobLockProvider(async () => (dead = await connect()));
    const b = mysqlJobLockProvider(connect);
    const key = jobLockKey(`caida-${run}`, "emp-tres");
    expect(await a.tryAcquire(key)).not.toBeNull();
    expect(await b.tryAcquire(key)).toBeNull();
    (dead as unknown as mysql.Connection).destroy();
    let lb = null;
    for (let i = 0; i < 50 && !lb; i++) {
      lb = await b.tryAcquire(key);
      if (!lb) await new Promise((r) => setTimeout(r, 100));
    }
    expect(lb).not.toBeNull();
    await lb!.release();
  });
});
