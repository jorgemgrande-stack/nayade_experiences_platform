/**
 * Aislamiento operativo entre empresas en las tareas en segundo plano (modo multi): tiempo máximo por empresa,
 * concurrencia, cortocircuito con backoff, reintentos solo ante errores de conexión y exclusión entre réplicas.
 * Empresas ficticias; sin base de datos real (mysql2 no conecta hasta la primera consulta).
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { getTenantId } from "./_core/tenant";
import { closeAllDatabases, setConnectionResolver } from "./_core/dbRegistry";
import { hungJobs, resetJobSlots } from "./_core/tenantRegistry/jobs";
import {
  jobCircuits,
  jobStatus,
  resetJobIsolation,
  runTenantJob,
  setJobCircuitListener,
  setJobLockProvider,
  setJobTenantLister,
} from "./_core/tenantRegistry/scheduler";
import {
  JobCircuitBreakers,
  circuitCooldownMs,
  isTransientError,
  retryDelayMs,
  retryTransient,
  setJobIsolationPolicy,
} from "./_core/tenantRegistry/jobIsolation";
import { MemoryLeaseStore, jobLockKey, leaseLockProvider } from "./_core/tenantRegistry/jobLocks";
import type { CircuitEvent } from "./_core/tenantRegistry/jobIsolation";

const TENANTS = ["emp-uno", "emp-dos", "emp-tres", "emp-cuatro"];
const fakeDsn = (id: string) => `mysql://u:p@127.0.0.1:1/db_${id}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const connErr = (code = "ECONNRESET") => Object.assign(new Error("conexión perdida"), { code });

beforeEach(() => {
  process.env.TENANT_MODE = "multi";
  setConnectionResolver(fakeDsn);
  setJobTenantLister(async () => TENANTS);
  resetJobIsolation();
  resetJobSlots();
});

afterEach(async () => {
  delete process.env.TENANT_MODE;
  setJobTenantLister(null);
  setJobLockProvider(null);
  setJobCircuitListener(null);
  setConnectionResolver(null);
  for (const j of ["iso-cuelga", "iso-secuencial", "iso-aborta", "iso-circuito", "iso-reintento", "iso-negocio", "iso-colgadas", "iso-replicas", "iso-caducado"]) setJobIsolationPolicy(j, null);
  await closeAllDatabases();
});

describe("tiempo máximo y concurrencia por empresa", () => {
  it("una empresa cuelga y otra falla: las demás terminan a tiempo", async () => {
    setJobIsolationPolicy("iso-cuelga", { timeoutMs: 150, concurrency: 4, retryAttempts: 1 });
    let unhang!: () => void;
    const hang = new Promise<void>((r) => (unhang = r));
    const done: string[] = [];
    const t0 = Date.now();
    const r = await runTenantJob("iso-cuelga", async () => {
      const id = getTenantId();
      if (id === "emp-dos") await hang; // no atiende la señal: se deja de esperar
      if (id === "emp-tres") throw new Error("fallo de negocio");
      await sleep(10);
      done.push(id);
    });
    expect(Date.now() - t0).toBeLessThan(1_000);
    expect(done.sort()).toEqual(["emp-cuatro", "emp-uno"]);
    expect(r.find((x) => x.tenantId === "emp-dos")).toMatchObject({ ok: false, timedOut: true });
    expect(r.find((x) => x.tenantId === "emp-tres")).toMatchObject({ ok: false, error: "fallo de negocio" });
    expect(jobStatus().find((j) => j.job === "iso-cuelga" && j.tenantId === "emp-dos")).toMatchObject({ outcome: "timeout" });
    // La ejecución abandonada sigue contando como colgada hasta que termina de verdad
    expect(hungJobs()["iso-cuelga"]).toBe(1);
    // …y mientras siga viva, la misma empresa no se vuelve a arrancar
    const again = await runTenantJob("iso-cuelga", async () => undefined);
    expect(again.find((x) => x.tenantId === "emp-dos")).toMatchObject({ skipped: "running" });
    unhang();
    await sleep(30);
    expect(hungJobs()["iso-cuelga"]).toBeUndefined();
  });

  it("una tras otra (concurrencia 1) la empresa colgada solo retrasa su tiempo máximo", async () => {
    setJobIsolationPolicy("iso-secuencial", { timeoutMs: 100, concurrency: 1, retryAttempts: 1 });
    const done: string[] = [];
    const t0 = Date.now();
    await runTenantJob("iso-secuencial", async () => {
      if (getTenantId() === "emp-uno") await new Promise(() => undefined);
      done.push(getTenantId());
    });
    expect(Date.now() - t0).toBeLessThan(800);
    expect(done).toEqual(["emp-dos", "emp-tres", "emp-cuatro"]);
  });

  it("la tarea que atiende la señal se aborta y no queda colgada", async () => {
    setJobIsolationPolicy("iso-aborta", { timeoutMs: 50, concurrency: 4, retryAttempts: 3 });
    let aborted = 0;
    let calls = 0;
    await runTenantJob("iso-aborta", ({ signal }) => {
      if (getTenantId() !== "emp-uno") return;
      calls++;
      return new Promise<void>((_, reject) =>
        signal.addEventListener("abort", () => {
          aborted++;
          reject(signal.reason);
        }),
      );
    });
    await sleep(10);
    expect(aborted).toBe(1);
    expect(calls).toBe(1); // el tiempo agotado no es transitorio: sin reintentos
    expect(hungJobs()["iso-aborta"]).toBeUndefined();
  });

  it("con el límite de colgadas alcanzado no se arrancan más empresas de esa tarea", async () => {
    setJobIsolationPolicy("iso-colgadas", { timeoutMs: 40, concurrency: 4, maxHung: 2, retryAttempts: 1, failureThreshold: 99 });
    const release: Array<() => void> = [];
    const r1 = await runTenantJob("iso-colgadas", () => {
      if (getTenantId() === "emp-uno" || getTenantId() === "emp-dos") return new Promise<void>((r) => release.push(r));
    });
    expect(r1.filter((x) => x.timedOut)).toHaveLength(2);
    const ran = vi.fn();
    const r2 = await runTenantJob("iso-colgadas", ran);
    expect(ran).not.toHaveBeenCalled();
    expect(r2.every((x) => x.skipped === "hung_limit")).toBe(true);
    release.forEach((f) => f());
    await sleep(20);
    const r3 = await runTenantJob("iso-colgadas", ran);
    expect(r3.every((x) => x.ok && !x.skipped)).toBe(true);
  });
});

describe("cortocircuito por empresa y tarea", () => {
  it("se abre tras N fallos seguidos, salta la empresa y se recupera tras la espera", async () => {
    let now = 1_000_000;
    resetJobIsolation(() => now);
    setJobIsolationPolicy("iso-circuito", { failureThreshold: 2, baseCooldownMs: 1_000, maxCooldownMs: 4_000, retryAttempts: 1, concurrency: 4 });
    const events: CircuitEvent[] = [];
    setJobCircuitListener((e) => void events.push(e));
    let healthy = false;
    const calls: string[] = [];
    const job = () =>
      runTenantJob("iso-circuito", () => {
        calls.push(getTenantId());
        if (getTenantId() === "emp-dos" && !healthy) throw new Error("IMAP no responde");
      });

    await job();
    expect(events).toHaveLength(0);
    await job();
    expect(events).toEqual([expect.objectContaining({ type: "opened", job: "iso-circuito", tenantId: "emp-dos", opens: 1, reopen: false, retryAt: now + 1_000 })]);
    expect(jobCircuits({ onlyOpen: true })).toEqual([expect.objectContaining({ tenantId: "emp-dos", state: "open", consecutiveFailures: 2 })]);

    // Abierto: la empresa se salta sin tocarla; las demás siguen
    calls.length = 0;
    const r3 = await job();
    expect(calls.sort()).toEqual(["emp-cuatro", "emp-tres", "emp-uno"]);
    expect(r3.find((x) => x.tenantId === "emp-dos")).toMatchObject({ skipped: "circuit_open" });

    // Pasada la espera: una ejecución de prueba; falla y se reabre con el doble de espera
    now += 1_000;
    await job();
    expect(events[1]).toMatchObject({ type: "opened", opens: 2, reopen: true, retryAt: now + 2_000 });
    now += 1_999;
    calls.length = 0;
    await job();
    expect(calls).not.toContain("emp-dos");

    // Se recupera: la prueba sale bien y el cortocircuito se cierra
    now += 1;
    healthy = true;
    await job();
    expect(events[2]).toMatchObject({ type: "closed", tenantId: "emp-dos" });
    expect(jobCircuits()).toEqual([]);
  });

  it("un éxito intermedio reinicia la cuenta de fallos seguidos", () => {
    const cb = new JobCircuitBreakers(() => 0);
    const p = { failureThreshold: 3, baseCooldownMs: 10, maxCooldownMs: 100 };
    cb.failure("t", "emp-uno", "e", p);
    cb.failure("t", "emp-uno", "e", p);
    cb.success("t", "emp-uno");
    expect(cb.failure("t", "emp-uno", "e", p)).toBeNull();
    expect(cb.admit("t", "emp-uno")).toEqual({ allowed: true, trial: false });
  });

  it("solo una ejecución de prueba a la vez", () => {
    let now = 0;
    const cb = new JobCircuitBreakers(() => now);
    const p = { failureThreshold: 1, baseCooldownMs: 10, maxCooldownMs: 100 };
    cb.failure("t", "emp-uno", "e", p);
    expect(cb.admit("t", "emp-uno")).toEqual({ allowed: false, retryAt: 10 });
    now = 10;
    expect(cb.admit("t", "emp-uno")).toEqual({ allowed: true, trial: true });
    expect(cb.admit("t", "emp-uno").allowed).toBe(false);
    cb.releaseTrial("t", "emp-uno");
    expect(cb.admit("t", "emp-uno")).toEqual({ allowed: true, trial: true });
  });
});

describe("backoff", () => {
  it("la espera del cortocircuito se duplica en cada reapertura hasta el tope", () => {
    const p = { baseCooldownMs: 1_000, maxCooldownMs: 8_000 };
    expect([1, 2, 3, 4, 5, 6].map((n) => circuitCooldownMs(n, p))).toEqual([1_000, 2_000, 4_000, 8_000, 8_000, 8_000]);
  });

  it("los reintentos esperan cada vez más, con tope", () => {
    const p = { retryBaseDelayMs: 100, retryMaxDelayMs: 350 };
    expect([1, 2, 3, 4].map((n) => retryDelayMs(n, p))).toEqual([100, 200, 350, 350]);
  });

  it("reintenta solo errores de conexión y como mucho los intentos de la política", async () => {
    const waits: number[] = [];
    const sleepFake = async (ms: number) => void waits.push(ms);
    const p = { retryAttempts: 3, retryBaseDelayMs: 100, retryMaxDelayMs: 1_000 };

    let n = 0;
    await expect(retryTransient(async () => (++n < 3 ? Promise.reject(connErr()) : "ok"), p, { sleep: sleepFake })).resolves.toBe("ok");
    expect(n).toBe(3);
    expect(waits).toEqual([100, 200]);

    n = 0;
    await expect(retryTransient(async () => Promise.reject(Object.assign(new Error(++n && "plaza ocupada"), { code: "ER_DUP_ENTRY" })), p, { sleep: sleepFake })).rejects.toThrow("plaza ocupada");
    expect(n).toBe(1);

    n = 0;
    await expect(retryTransient(async () => Promise.reject((++n, connErr("PROTOCOL_CONNECTION_LOST"))), p, { sleep: sleepFake })).rejects.toThrow();
    expect(n).toBe(3);
  });

  it("reconoce el error de conexión envuelto por el ORM y no el de negocio", () => {
    expect(isTransientError(new Error("Failed query", { cause: connErr("ECONNREFUSED") }))).toBe(true);
    expect(isTransientError(Object.assign(new Error("x"), { name: "DbCapacityError" }))).toBe(true);
    expect(isTransientError(new Error("Importe no válido"))).toBe(false);
    expect(isTransientError(Object.assign(new Error("x"), { code: "ER_PARSE_ERROR" }))).toBe(false);
  });

  it("en el programador, un corte de conexión se reintenta y la empresa termina bien", async () => {
    setJobIsolationPolicy("iso-reintento", { retryAttempts: 3, retryBaseDelayMs: 1, retryMaxDelayMs: 2 });
    setJobIsolationPolicy("iso-negocio", { retryAttempts: 3, retryBaseDelayMs: 1, retryMaxDelayMs: 2 });
    const tries = new Map<string, number>();
    const r = await runTenantJob("iso-reintento", () => {
      const id = getTenantId();
      tries.set(id, (tries.get(id) ?? 0) + 1);
      if (id === "emp-uno" && tries.get(id)! < 2) throw connErr();
    });
    expect(tries.get("emp-uno")).toBe(2);
    expect(r.every((x) => x.ok)).toBe(true);

    let business = 0;
    const r2 = await runTenantJob("iso-negocio", () => {
      if (getTenantId() === "emp-uno") {
        business++;
        throw new Error("cliente sin correo");
      }
    });
    expect(business).toBe(1);
    expect(r2.find((x) => x.tenantId === "emp-uno")).toMatchObject({ ok: false });
  });
});

/** Una «réplica»: otra instancia de los módulos (estado en memoria propio) que comparte el almacén de bloqueos. */
async function replica(owner: string, store: MemoryLeaseStore, ttlMs = 5_000) {
  vi.resetModules();
  const db = await import("./_core/dbRegistry");
  const sched = await import("./_core/tenantRegistry/scheduler");
  const tenant = await import("./_core/tenant");
  db.setConnectionResolver(fakeDsn);
  sched.setJobTenantLister(async () => TENANTS);
  sched.setJobLockProvider(leaseLockProvider(store, owner, ttlMs));
  return { sched, db, tenant };
}

describe("exclusión entre réplicas", () => {
  it("dos réplicas a la vez: cada empresa se ejecuta una sola vez", async () => {
    const store = new MemoryLeaseStore();
    const a = await replica("replica-a", store);
    const b = await replica("replica-b", store);
    const ran: string[] = [];
    let open!: () => void;
    const gate = new Promise<void>((r) => (open = r));
    const handler = (owner: string, getId: () => string) => async () => {
      ran.push(`${owner}:${getId()}`);
      await gate;
    };
    const pa = a.sched.runTenantJob("iso-replicas", handler("a", a.tenant.getTenantId));
    const pb = b.sched.runTenantJob("iso-replicas", handler("b", b.tenant.getTenantId));
    await sleep(50);
    open();
    const [ra, rb] = await Promise.all([pa, pb]);
    // Cada empresa, exactamente una vez entre las dos réplicas
    expect(ran.map((x) => x.split(":")[1]).sort()).toEqual([...TENANTS].sort());
    const skipped = [...ra, ...rb].filter((x) => x.skipped === "other_replica").map((x) => x.tenantId).sort();
    expect(skipped).toEqual([...TENANTS].sort());
    // Al terminar se liberan: la siguiente pasada puede correr en cualquiera
    for (const t of TENANTS) expect(store.holder(jobLockKey("iso-replicas", t))).toBeNull();
    await Promise.all([a.db.closeAllDatabases(), b.db.closeAllDatabases()]);
  });

  it("sin bloqueos entre réplicas, las dos duplicarían el trabajo (control)", async () => {
    vi.resetModules();
    const s1 = await import("./_core/tenantRegistry/scheduler");
    const d1 = await import("./_core/dbRegistry");
    vi.resetModules();
    const s2 = await import("./_core/tenantRegistry/scheduler");
    const d2 = await import("./_core/dbRegistry");
    for (const [s, d] of [[s1, d1], [s2, d2]] as const) {
      d.setConnectionResolver(fakeDsn);
      s.setJobTenantLister(async () => TENANTS);
    }
    let count = 0;
    const h = async () => {
      count++;
      await sleep(20);
    };
    await Promise.all([s1.runTenantJob("iso-replicas", h), s2.runTenantJob("iso-replicas", h)]);
    expect(count).toBe(TENANTS.length * 2);
    await Promise.all([d1.closeAllDatabases(), d2.closeAllDatabases()]);
  });

  it("el arrendamiento de una réplica caída caduca y otra recupera la tarea", async () => {
    let now = 5_000_000;
    const store = new MemoryLeaseStore(() => now);
    // La réplica caída tomó «emp-tres» y murió sin soltarlo (sin renovaciones)
    expect(await store.tryAcquire(jobLockKey("iso-caducado", "emp-tres"), "replica-caida", 60_000)).toBe(true);
    const b = await replica("replica-b", store, 60_000);
    const ran: string[] = [];
    const h = () => void ran.push(b.tenant.getTenantId());

    const r1 = await b.sched.runTenantJob("iso-caducado", h);
    expect(ran.sort()).toEqual(["emp-cuatro", "emp-dos", "emp-uno"]);
    expect(r1.find((x) => x.tenantId === "emp-tres")).toMatchObject({ skipped: "other_replica" });

    now += 60_001;
    ran.length = 0;
    await b.sched.runTenantJob("iso-caducado", h);
    expect(ran).toContain("emp-tres");
    await b.db.closeAllDatabases();
  });

  it("un arrendamiento vivo se renueva y no se lo queda otra réplica", async () => {
    const store = new MemoryLeaseStore();
    const a = leaseLockProvider(store, "replica-a", 60);
    const b = leaseLockProvider(store, "replica-b", 60);
    const lock = await a.tryAcquire("job:x:emp-uno");
    expect(lock).not.toBeNull();
    await sleep(150); // más de dos caducidades: las renovaciones lo mantienen
    expect(await b.tryAcquire("job:x:emp-uno")).toBeNull();
    await lock!.release();
    const lb = await b.tryAcquire("job:x:emp-uno");
    expect(lb).not.toBeNull();
    await lb!.release();
  });

  it("si el almacén de bloqueos no responde, la empresa se omite (sin arriesgar duplicados)", async () => {
    setJobLockProvider({ tryAcquire: async () => Promise.reject(new Error("registro caído")) });
    const ran = vi.fn();
    const r = await runTenantJob("iso-replicas", ran);
    expect(ran).not.toHaveBeenCalled();
    expect(r.every((x) => x.skipped === "lock_unavailable")).toBe(true);
    // No cuenta como fallo de la empresa
    expect(jobCircuits()).toEqual([]);
  });
});
