/**
 * Planificador de las alertas operativas: una evaluación a la vez (si la anterior sigue en curso, la nueva se omite),
 * con el estado de la última ejecución visible en el Control Center (GET /cp/v1/alerts/status). Sin intervalo
 * configurado (CP_ALERTS_EVERY_SECONDS) no se programa nada, pero la evaluación manual sigue disponible.
 */
import type { AlertRunResult } from "./alerts";

export interface AlertSchedulerStatus {
  scheduled: boolean;
  everySeconds: number | null;
  running: boolean;
  runs: number;
  failures: number;
  skipped: number;
  lastStartedAt: number | null;
  lastFinishedAt: number | null;
  lastDurationMs: number | null;
  lastResult: { raised: number; resolved: number; active: number } | null;
  lastError: { at: number; error: string } | null;
}

export class AlertScheduler {
  private s: AlertSchedulerStatus = { scheduled: false, everySeconds: null, running: false, runs: 0, failures: 0, skipped: 0, lastStartedAt: null, lastFinishedAt: null, lastDurationMs: null, lastResult: null, lastError: null };
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private evaluate: () => Promise<AlertRunResult>,
    private opts: { now?: () => number; log?: (event: string, detail: Record<string, unknown>) => void } = {},
  ) {}

  private now() {
    return (this.opts.now ?? Date.now)();
  }

  /** Una evaluación; si ya hay una en curso devuelve null sin lanzar otra. */
  async run(): Promise<AlertRunResult | null> {
    if (this.s.running) {
      this.s.skipped++;
      return null;
    }
    this.s.running = true;
    const started = this.now();
    this.s.lastStartedAt = started;
    try {
      const r = await this.evaluate();
      this.s.runs++;
      this.s.lastResult = { raised: r.raised, resolved: r.resolved, active: r.active.length };
      return r;
    } catch (e) {
      this.s.failures++;
      this.s.lastError = { at: this.now(), error: e instanceof Error ? `${e.name}: ${e.message}`.slice(0, 300) : "error" };
      // Un fallo de la evaluación no puede pasar desapercibido: la monitorización quedaría muerta
      this.opts.log?.("evaluate_failed", { error: e instanceof Error ? e.name : "error" });
      throw e;
    } finally {
      this.s.running = false;
      this.s.lastFinishedAt = this.now();
      this.s.lastDurationMs = this.s.lastFinishedAt - started;
    }
  }

  /** Programa la evaluación periódica (mínimo 30 s). Llamarlo dos veces no crea un segundo temporizador. */
  start(everySeconds: number) {
    if (this.timer) return;
    const every = Math.max(30, Math.floor(everySeconds));
    this.s.scheduled = true;
    this.s.everySeconds = every;
    this.timer = setInterval(() => void this.run().catch(() => undefined), every * 1000);
    this.timer.unref?.();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.s.scheduled = false;
  }

  status(): AlertSchedulerStatus {
    return { ...this.s, lastResult: this.s.lastResult ? { ...this.s.lastResult } : null, lastError: this.s.lastError ? { ...this.s.lastError } : null };
  }
}
