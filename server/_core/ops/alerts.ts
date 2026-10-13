/**
 * Alertas operativas: evalúa reglas sobre el estado real (registro, uso, cuotas, licencias,
 * copias) y abre/cierra incidencias de forma idempotente.
 */
import type { Entitlement } from "../modules/entitlements";
import type { Quota, UsageStore } from "../erm/types";
import { windowStart } from "../erm/quota";
import type { TenantRegistryReader } from "../tenantRegistry/store";
import type { IncidentService } from "./incidents";

export interface AlertDeps {
  reader: Pick<TenantRegistryReader, "listTenants">;
  incidents: IncidentService;
  usage?: UsageStore;
  quotas?: { listQuotas(tenantId: string): Promise<Quota[]> };
  entitlements?: { listEntitlements(tenantId: string): Promise<Entitlement[]> };
  /** Último respaldo verificado por tenant (ms epoch). */
  lastBackupAt?: () => Promise<Record<string, number>>;
  /** Tenants con alta fallida. */
  failedProvisioning?: () => Promise<string[]>;
  now?: () => number;
  /** Antigüedad máxima de un respaldo (por defecto 36 h; crítico al doble). */
  backupMaxAgeMs?: number;
}

export interface AlertRunResult {
  raised: number;
  resolved: number;
  active: string[];
}

const DAY = 86_400_000;

export async function runAlerts(d: AlertDeps): Promise<AlertRunResult> {
  const now = (d.now ?? Date.now)();
  const active = new Set<string>();
  let raised = 0;
  const raise = async (
    key: string,
    kind: string,
    severity: "info" | "warning" | "critical",
    title: string,
    tenantId: string | null,
    details: Record<string, string | number | boolean | null> = {},
  ) => {
    active.add(key);
    await d.incidents.raise({ dedupeKey: key, kind, severity, title, tenantId, details });
    raised++;
  };

  const tenants = await d.reader.listTenants();
  const backups = d.lastBackupAt ? await d.lastBackupAt() : null;
  const maxAge = d.backupMaxAgeMs ?? 36 * 3_600_000;

  for (const t of tenants) {
    if (t.status === "grace") await raise(`tenant.grace:${t.id}`, "tenant.grace", "warning", `Impago en gracia: ${t.displayName}`, t.id);
    if (t.status === "suspended") await raise(`tenant.suspended:${t.id}`, "tenant.suspended", "warning", `Tenant suspendido: ${t.displayName}`, t.id, { reason: t.statusReason });

    if (backups && (t.status === "active" || t.status === "trial" || t.status === "grace")) {
      const last = backups[t.id];
      const age = last ? now - last : Infinity;
      if (age > maxAge) {
        await raise(
          `backup.stale:${t.id}`,
          "backup.stale",
          age > 2 * maxAge ? "critical" : "warning",
          `Sin copia reciente: ${t.displayName}`,
          t.id,
          { ageHours: last ? Math.round(age / 3_600_000) : null },
        );
      }
    }

    if (d.quotas && d.usage && (t.status === "active" || t.status === "trial" || t.status === "grace")) {
      for (const q of await d.quotas.listQuotas(t.id)) {
        if (q.period === "minute" || q.limit <= 0) continue;
        const from = windowStart(q.period, now);
        const used = await d.usage.sum(t.id, q.metric, from, now + 3_600_000);
        const ratio = used / q.limit;
        if (ratio >= 0.8) {
          await raise(
            `quota:${t.id}:${q.metric}:${q.period}`,
            "quota.near",
            ratio >= 1 ? "critical" : "warning",
            `Cuota ${ratio >= 1 ? "agotada" : "al " + Math.round(ratio * 100) + " %"}: ${q.metric} (${q.period})`,
            t.id,
            { used: Math.round(used), limit: q.limit },
          );
        }
      }
    }

    if (d.entitlements) {
      for (const e of await d.entitlements.listEntitlements(t.id)) {
        if (e.status === "active" && e.validUntil) {
          const left = e.validUntil.getTime() - now;
          if (left > 0 && left < 3 * DAY) {
            await raise(`entitlement.expiring:${t.id}:${e.moduleId}`, "entitlement.expiring", "info", `Licencia a punto de caducar: ${e.moduleId}`, t.id, { hoursLeft: Math.round(left / 3_600_000) });
          }
        }
      }
    }
  }

  if (d.failedProvisioning) {
    for (const id of await d.failedProvisioning()) {
      await raise(`provisioning.failed:${id}`, "provisioning.failed", "warning", `Alta fallida: ${id}`, id);
    }
  }

  // Lo que ya no se observa se cierra solo
  let resolved = 0;
  for (const prefix of ["tenant.", "backup.", "quota.", "entitlement.", "provisioning."]) {
    resolved += await d.incidents.autoResolve(active, prefix);
  }
  return { raised, resolved, active: Array.from(active) };
}
