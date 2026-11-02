/**
 * Reconciliación de la caducidad de las licencias de las pruebas gratuitas.
 *
 * El Core calcula la prueba (fecha de fin y días restantes, solo lectura al vencer) a partir del `validUntil` de las
 * licencias del tenant, que salen de la suscripción interna de la prueba. La fuente autoritativa del fin es la prueba
 * del plano de control (`trial_requests.ends_at`): cada tick recorre las pruebas vivas y, si la suscripción o sus
 * licencias tienen otro fin (p. ej. una ampliación aprobada antes de esta corrección, o una alineación que falló al
 * aprobarla), las alinea con `TrialOnboardingService.syncLicences`. Idempotente: si todo cuadra no escribe nada.
 *
 * ENCENDIDA por defecto (solo alinea fechas con la prueba; nunca suspende, cancela, cobra ni borra). Se apaga con
 * `CP_TRIAL_LICENCE_SYNC=off`; intervalo `CP_TRIAL_LICENCE_SYNC_SECONDS` (60 s – 1 h; 5 min por defecto). Una sola
 * réplica por tick (bloqueo con nombre propio, distinto del de la tarea de pruebas).
 */
import { opsLog } from "../_core/ops/log";
import { LICENCE_SYNC_STATES, type TrialLicenceSync } from "./onboarding";
import type { SchedulerLock } from "./scheduler";
import type { TrialState } from "./machine";
import type { TrialStore } from "./store";

export const LICENCE_SYNC_ACTOR = "system:trial-licence-sync";
export const LICENCE_SYNC_LOCK = "elephant_trials_licence_sync";
export const LICENCE_SYNC_DEFAULT_MS = 5 * 60_000;

export interface LicenceSyncTick {
  at: number;
  skipped: "locked" | "unavailable" | null;
  checked: number;
  aligned: number;
  errors: number;
}

export class TrialLicenceReconciler {
  private now: () => number;
  private log: (level: "info" | "warn" | "error", event: string, data: Record<string, unknown>) => void;
  constructor(
    private d: {
      store: Pick<TrialStore, "list">;
      /** `TrialOnboardingService.syncLicences`; null mientras no esté montada (la monta la API). */
      sync: () => ((trialId: number, actor: string) => Promise<TrialLicenceSync>) | null;
      lock: SchedulerLock;
      now?: () => number;
      batch?: number;
      log?: (level: "info" | "warn" | "error", event: string, data: Record<string, unknown>) => void;
    },
  ) {
    this.now = d.now ?? Date.now;
    this.log = d.log ?? ((level, event, data) => opsLog(level, "Trials", event, data));
  }

  async tick(now = this.now()): Promise<LicenceSyncTick> {
    const out: LicenceSyncTick = { at: now, skipped: null, checked: 0, aligned: 0, errors: 0 };
    const sync = this.d.sync();
    if (!sync) return { ...out, skipped: "unavailable" };
    const release = await this.d.lock.acquire(LICENCE_SYNC_LOCK);
    if (!release) return { ...out, skipped: "locked" };
    const alignedIds: number[] = [];
    try {
      const trials = await this.d.store.list({ states: LICENCE_SYNC_STATES as TrialState[], limit: Math.max(1, Math.min(this.d.batch ?? 1000, 1000)) });
      for (const t of trials) {
        if (!t.tenantId || t.endsAt === null) continue;
        out.checked++;
        try {
          const r = await sync(t.id, LICENCE_SYNC_ACTOR);
          if (r.outcome === "aligned") {
            out.aligned++;
            alignedIds.push(t.id);
            this.log("info", "trial_licences_aligned", { trialId: t.id, tenantId: t.tenantId, endsAt: t.endsAt, subscriptionMoved: !!r.subscriptionMoved, licencesChanged: r.licencesChanged ?? 0, cause: "reconcile" });
          }
        } catch (e) {
          // Se reintenta en el siguiente tick (p. ej. la suscripción cambió a la vez)
          out.errors++;
          this.log("error", "trial_licence_sync_failed", { trialId: t.id, cause: "reconcile", error: e instanceof Error ? e.name : "error", message: e instanceof Error ? e.message.slice(0, 200) : null });
        }
      }
    } finally {
      await release().catch(() => undefined);
    }
    if (out.aligned || out.errors) this.log(out.errors ? "warn" : "info", "licence_sync_tick", { ...out, alignedTrials: alignedIds });
    return out;
  }
}

export function licenceSyncConfigFromEnv(env: NodeJS.ProcessEnv) {
  const raw = Number(env.CP_TRIAL_LICENCE_SYNC_SECONDS ?? LICENCE_SYNC_DEFAULT_MS / 1000);
  const intervalMs = Number.isFinite(raw) ? Math.min(3_600_000, Math.max(60_000, Math.round(raw * 1000))) : LICENCE_SYNC_DEFAULT_MS;
  return { enabled: (env.CP_TRIAL_LICENCE_SYNC ?? "").trim().toLowerCase() !== "off", intervalMs };
}

/**
 * Monta la reconciliación periódica. El primer tick llega al cabo de un minuto (no trabaja al arrancar) y nunca se
 * solapan dos ticks en el mismo proceso. Devuelve `stop()`.
 */
export function startTrialLicenceSync(o: {
  reconciler: TrialLicenceReconciler;
  env: NodeJS.ProcessEnv;
  timers?: { setInterval: typeof setInterval; clearInterval: typeof clearInterval; setTimeout: typeof setTimeout; clearTimeout: typeof clearTimeout };
}) {
  const cfg = licenceSyncConfigFromEnv(o.env);
  console.log(JSON.stringify({ ctx: "Trials", event: "licence_sync", enabled: cfg.enabled, intervalMs: cfg.intervalMs }));
  if (!cfg.enabled) return { ...cfg, stop: () => undefined };
  const timers = o.timers ?? { setInterval, clearInterval, setTimeout, clearTimeout };
  let busy = false;
  let stopped = false;
  const run = async () => {
    if (busy || stopped) return;
    busy = true;
    try {
      await o.reconciler.tick();
    } catch (e) {
      console.log(JSON.stringify({ ctx: "Trials", event: "licence_sync", error: "tick_failed", name: e instanceof Error ? e.name : "error" }));
    } finally {
      busy = false;
    }
  };
  const first = timers.setTimeout(() => void run(), Math.min(cfg.intervalMs, 60_000));
  const every = timers.setInterval(() => void run(), cfg.intervalMs);
  (first as { unref?: () => void }).unref?.();
  (every as { unref?: () => void }).unref?.();
  return {
    ...cfg,
    stop: () => {
      stopped = true;
      timers.clearTimeout(first);
      timers.clearInterval(every);
    },
  };
}
