/**
 * Tareas programadas heredadas: decisión por modo (single / multi).
 *  - Política declarada para todas las tareas del arranque; las de buzón IMAP global, desactivadas.
 *  - Arranque multi: las desactivadas no se arrancan y dejan UNA línea informativa (no error).
 *  - Single: los arranques y pasadas iniciales siguen exactamente como antes (sin programador por
 *    empresa en la pasada inicial, sin esperar a las tareas «disparar y olvidar», el pool se cierra
 *    donde se cerraba). Multi: pasada inicial por empresa y tareas esperadas dentro del contexto.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

const sched = vi.hoisted(() => ({
  crons: new Map<string, () => unknown>(),
  runs: [] as string[],
  flags: [] as string[],
}));

vi.mock("./_core/tenantRegistry/scheduler", () => ({
  scheduleTenantCron: (_expr: string, name: string, handler: () => unknown) => {
    sched.crons.set(name, handler);
    return { stop() {} };
  },
  scheduleTenantInterval: () => ({ stop() {} }),
  runTenantJob: async (name: string, _handler: () => unknown) => {
    sched.runs.push(name);
    return [];
  },
  setJobFlag: (name: string) => {
    sched.flags.push(name);
  },
}));

// BD heredada falsa: el pool registra si se cierra; las consultas devuelven vacío
const fakeDb = vi.hoisted(() => {
  const ended = { count: 0 };
  const chain: any = new Proxy(function () {}, {
    get: (_t, prop) => (prop === "then" ? (res: (v: unknown[]) => void) => res([]) : chain),
    apply: () => chain,
  });
  return {
    ended,
    pool: { end: async () => { ended.count++; }, execute: async () => [[]], query: async () => [[]] },
    db: chain,
  };
});
vi.mock("./_core/legacyDb", () => ({ legacyDb: () => fakeDb.db, legacyPool: () => fakeDb.pool }));

import { JOB_MULTI_POLICIES, jobMultiPolicy, startScheduledJobsMulti } from "./_core/tenantRegistry/jobPolicy";

const flush = () => new Promise((r) => setImmediate(r));

beforeEach(() => {
  sched.crons.clear();
  sched.runs.length = 0;
  sched.flags.length = 0;
  fakeDb.ended.count = 0;
});
afterEach(() => {
  delete process.env.TENANT_MODE;
  vi.restoreAllMocks();
});

describe("política multiempresa de las tareas programadas", () => {
  it("todas las tareas del arranque tienen política declarada", () => {
    const src = fs.readFileSync(path.resolve(__dirname, "_core/index.ts"), "utf8");
    const block = src.slice(src.indexOf("const SCHEDULED_JOBS"), src.indexOf("];", src.indexOf("const SCHEDULED_JOBS")));
    const names = Array.from(block.matchAll(/name: "([^"]+)"/g)).map((m) => m[1]);
    expect(names.length).toBe(11);
    for (const n of names) expect(JOB_MULTI_POLICIES[n], n).toBeDefined();
    expect(Object.keys(JOB_MULTI_POLICIES).sort()).toEqual([...names].sort());
  });

  it("todas por empresa: las de buzón IMAP leen solo el buzón propio de cada empresa (bóveda)", () => {
    const disabled = Object.entries(JOB_MULTI_POLICIES).filter(([, p]) => p.mode === "disabled-in-multi").map(([n]) => n).sort();
    expect(disabled).toEqual([]);
    expect(JOB_MULTI_POLICIES["email-tpv-ingestion"].reason).toMatch(/imap_tpv/);
    expect(JOB_MULTI_POLICIES["expense-email-ingestion"].reason).toMatch(/imap_expenses/);
  });

  it("una tarea sin política no se arranca en multiempresa (falla cerrado)", () => {
    expect(jobMultiPolicy("tarea-nueva").mode).toBe("disabled-in-multi");
  });

  it("arranque multi: desactivadas con una sola línea informativa; las demás registran su flag y arrancan", () => {
    const started: string[] = [];
    const lines: string[] = [];
    const err = vi.spyOn(console, "error");
    const mk = (name: string) => ({ name, flag: `${name}_flag`, label: name, def: false, start: () => started.push(name) });
    const r = startScheduledJobsMulti(
      [mk("abandoned-checkout"), mk("email-tpv-ingestion"), mk("expense-email-ingestion"), mk("tax-reminder"), mk("tarea-nueva")],
      (l) => lines.push(l),
    );
    const perTenant = ["abandoned-checkout", "email-tpv-ingestion", "expense-email-ingestion", "tax-reminder"];
    expect(r).toEqual(perTenant);
    expect(started).toEqual(perTenant);
    expect(sched.flags).toEqual(perTenant);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/tarea-nueva' no se arranca en multiempresa: Sin política/);
    expect(err).not.toHaveBeenCalled();
  });
});

describe("arranque de las tareas heredadas según el modo", () => {
  it("datáfono (conciliación y revinculación): pasada inicial directa en single, por empresa en multi", async () => {
    const { startMatchingJob } = await import("./services/cardTerminalMatchingService");
    const { startRelinkJob } = await import("./services/cardTerminalRelinkService");
    vi.spyOn(console, "log").mockImplementation(() => undefined);

    startMatchingJob();
    startRelinkJob();
    await flush();
    await flush();
    expect(sched.runs).toEqual([]); // single: como siempre, sin programador en la pasada inicial
    expect([...sched.crons.keys()].sort()).toEqual(["card-terminal-matching", "card-terminal-relink"]);

    process.env.TENANT_MODE = "multi";
    startMatchingJob();
    startRelinkJob();
    await flush();
    expect(sched.runs.sort()).toEqual(["card-terminal-matching", "card-terminal-relink"]);
  });

  it("email comercial: single dispara y olvida como siempre; multi pasa por empresa y espera dentro del contexto", async () => {
    const { startCommercialEmailSyncJob } = await import("./services/commercialEmailService");
    vi.spyOn(console, "log").mockImplementation(() => undefined);

    await startCommercialEmailSyncJob();
    expect(sched.runs).toEqual([]);
    expect(sched.crons.get("commercial-email-sync")!()).toBeUndefined();
    await flush();

    process.env.TENANT_MODE = "multi";
    await startCommercialEmailSyncJob();
    expect(sched.runs).toEqual(["commercial-email-sync"]);
    const ret = sched.crons.get("commercial-email-sync")!();
    expect(ret).toBeInstanceOf(Promise);
    await ret;
  });

  it("anulaciones sin atender: single cierra el pool como antes; multi no cierra el pool de la empresa y espera", async () => {
    const { startCancellationStaleJob } = await import("./cancellationStaleJob");
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    startCancellationStaleJob();
    const handler = sched.crons.get("cancellation-stale")!;

    expect(handler()).toBeUndefined();
    await flush();
    await flush();
    expect(fakeDb.ended.count).toBe(1);

    process.env.TENANT_MODE = "multi";
    const ret = handler();
    expect(ret).toBeInstanceOf(Promise);
    await ret;
    expect(fakeDb.ended.count).toBe(1);
  });
});
