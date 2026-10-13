/**
 * Retención de datos operativos.
 *
 *  - Copias: se conservan las últimas `keepLast`, una por mes durante `keepMonthly` meses y
 *    todo lo reciente (< `minAgeDays`). Nunca se borra la última copia de un tenant.
 *  - Uso agregado: se eliminan cubos horarios más antiguos que `usageDays`.
 *  - Incidencias resueltas: se purgan pasados `incidentDays`.
 *  - `tenant_events` es de solo anexado: no se toca.
 *
 * Dry-run por defecto; devuelve exactamente qué haría.
 */
import fs from "node:fs";
import path from "node:path";
import type mysql from "mysql2/promise";

export interface RetentionPolicy {
  keepLast: number;
  keepMonthly: number;
  minAgeDays: number;
  usageDays: number;
  incidentDays: number;
}

export const DEFAULT_RETENTION: RetentionPolicy = { keepLast: 7, keepMonthly: 12, minAgeDays: 3, usageDays: 400, incidentDays: 180 };

export interface BackupFile {
  tenantId: string;
  file: string;
  createdAt: number;
}

/** Selecciona qué copias de UN tenant se eliminan según la política. */
export function selectBackupsToDelete(files: BackupFile[], p: RetentionPolicy, now: number): BackupFile[] {
  const sorted = [...files].sort((a, b) => b.createdAt - a.createdAt);
  const keep = new Set<string>();
  sorted.slice(0, p.keepLast).forEach((f) => keep.add(f.file));
  const seenMonths = new Set<string>();
  for (const f of sorted) {
    const d = new Date(f.createdAt);
    const m = `${d.getUTCFullYear()}-${d.getUTCMonth()}`;
    if (!seenMonths.has(m) && seenMonths.size < p.keepMonthly) {
      seenMonths.add(m);
      keep.add(f.file);
    }
    if (now - f.createdAt < p.minAgeDays * 86_400_000) keep.add(f.file);
  }
  if (sorted[0]) keep.add(sorted[0].file); // la más reciente, siempre
  return sorted.filter((f) => !keep.has(f.file));
}

export function scanBackups(dir: string): BackupFile[] {
  if (!fs.existsSync(dir)) return [];
  const out: BackupFile[] = [];
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith(".manifest.json")) continue;
    try {
      const m = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as { tenantId: string; createdAt: string; file: string };
      out.push({ tenantId: m.tenantId, file: m.file, createdAt: new Date(m.createdAt).getTime() });
    } catch {
      /* manifiesto ilegible: no se toca */
    }
  }
  return out;
}

export interface RetentionReport {
  backupsDeleted: string[];
  usageRowsDeleted: number;
  incidentsDeleted: number;
  applied: boolean;
}

export async function runRetention(
  d: { backupDir?: string; usagePool?: Pick<mysql.Pool, "query">; registryPool?: Pick<mysql.Pool, "query"> },
  opts: { apply?: boolean; policy?: Partial<RetentionPolicy>; now?: number } = {},
): Promise<RetentionReport> {
  const p = { ...DEFAULT_RETENTION, ...opts.policy };
  const now = opts.now ?? Date.now();
  const report: RetentionReport = { backupsDeleted: [], usageRowsDeleted: 0, incidentsDeleted: 0, applied: !!opts.apply };

  if (d.backupDir) {
    const byTenant = new Map<string, BackupFile[]>();
    for (const b of scanBackups(d.backupDir)) byTenant.set(b.tenantId, [...(byTenant.get(b.tenantId) ?? []), b]);
    for (const files of Array.from(byTenant.values())) {
      for (const f of selectBackupsToDelete(files, p, now)) {
        report.backupsDeleted.push(f.file);
        if (opts.apply) {
          fs.rmSync(path.join(d.backupDir, f.file), { force: true });
          fs.rmSync(path.join(d.backupDir, f.file.replace(/\.sql\.gz$/, ".manifest.json")), { force: true });
        }
      }
    }
  }

  if (d.usagePool) {
    const cutoff = new Date(now - p.usageDays * 86_400_000);
    if (opts.apply) {
      const [r] = await d.usagePool.query<mysql.ResultSetHeader>("DELETE FROM usage_hourly WHERE hour_start < ?", [cutoff]);
      report.usageRowsDeleted = r.affectedRows;
    } else {
      const [r] = await d.usagePool.query<mysql.RowDataPacket[]>("SELECT COUNT(*) AS n FROM usage_hourly WHERE hour_start < ?", [cutoff]);
      report.usageRowsDeleted = Number(r[0].n);
    }
  }

  if (d.registryPool) {
    const cutoff = now - p.incidentDays * 86_400_000;
    if (opts.apply) {
      const [r] = await d.registryPool.query<mysql.ResultSetHeader>("DELETE FROM ops_incidents WHERE status = 'resolved' AND resolved_at < ?", [cutoff]);
      report.incidentsDeleted = r.affectedRows;
    } else {
      const [r] = await d.registryPool.query<mysql.RowDataPacket[]>("SELECT COUNT(*) AS n FROM ops_incidents WHERE status = 'resolved' AND resolved_at < ?", [cutoff]);
      report.incidentsDeleted = Number(r[0].n);
    }
  }
  return report;
}
