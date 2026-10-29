/**
 * Planificador de alertas: nunca dos evaluaciones a la vez, estado de la última ejecución y de su error, y un solo
 * temporizador aunque se arranque dos veces.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { AlertScheduler } from "./_core/ops/alertScheduler";

afterEach(() => void vi.useRealTimers());

describe("planificador de alertas", () => {
  it("una evaluación a la vez: la que llega con otra en curso se omite y se cuenta", async () => {
    let release!: () => void;
    let calls = 0;
    const s = new AlertScheduler(() => {
      calls++;
      return new Promise((r) => (release = () => r({ raised: 2, resolved: 1, active: ["a", "b"] })));
    });
    const first = s.run();
    expect(await s.run()).toBeNull();
    release();
    expect(await first).toMatchObject({ raised: 2 });
    expect(calls).toBe(1);
    expect(s.status()).toMatchObject({ runs: 1, skipped: 1, running: false, lastResult: { raised: 2, resolved: 1, active: 2 }, lastError: null });
  });

  it("un fallo queda registrado (y en el log) sin parar el motor; la siguiente evaluación vuelve a funcionar", async () => {
    let fail = true;
    const log: string[] = [];
    let t = 1000;
    const s = new AlertScheduler(async () => {
      t += 50;
      if (fail) throw new Error("registro caído");
      return { raised: 0, resolved: 0, active: [] };
    }, { now: () => t, log: (e) => void log.push(e) });
    await expect(s.run()).rejects.toThrow("registro caído");
    expect(s.status()).toMatchObject({ failures: 1, lastError: { error: "Error: registro caído" }, lastDurationMs: 50 });
    expect(log).toEqual(["evaluate_failed"]);
    fail = false;
    await s.run();
    expect(s.status()).toMatchObject({ runs: 1, failures: 1, lastResult: { active: 0 } });
  });

  it("programa cada N segundos (mínimo 30) con un único temporizador", async () => {
    vi.useFakeTimers();
    let calls = 0;
    const s = new AlertScheduler(async () => (calls++, { raised: 0, resolved: 0, active: [] }));
    s.start(10);
    s.start(10);
    expect(s.status()).toMatchObject({ scheduled: true, everySeconds: 30 });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(calls).toBe(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls).toBe(3);
    s.stop();
    expect(s.status().scheduled).toBe(false);
  });
});
