/**
 * Retención de las copias del trabajo programado (abuelo-padre-hijo), sobre el almacenamiento y el
 * inventario a la vez.
 *
 * Por cada destino (empresa, registro, CRM) se conservan, entre sus copias correctas (`ok`):
 *   - la más reciente de cada uno de los últimos `daily` días con copia (30 por defecto),
 *   - la más reciente de cada una de las últimas `weekly` semanas ISO con copia (12),
 *   - la más reciente de cada uno de los últimos `monthly` meses con copia (12),
 *   - y SIEMPRE la copia correcta más reciente (nunca se borra la única copia válida).
 * Las copias fallidas o en curso no se tocan. Los ficheros (`files`) son una réplica incremental y
 * no entran en esta retención.
 *
 * Dry-run por defecto. Si borrar un objeto falla, su fila no se marca como `pruned`.
 */
import type { BackupInventory, BackupRecord } from "./backupInventory";
import type { BackupCopyLedger, BackupCopyRecord } from "./backupCopies";
import type { BackupStorage } from "./backupStorage";
import { safeError } from "./backupInventory";

export interface GfsPolicy {
  daily: number;
  weekly: number;
  monthly: number;
}

export const DEFAULT_GFS: GfsPolicy = { daily: 30, weekly: 12, monthly: 12 };

/** Política desde `<prefijo>DAILY/WEEKLY/MONTHLY` (primario `BACKUP_KEEP_`, secundario `BACKUP_SECONDARY_KEEP_`). */
export function gfsPolicyFromEnv(env: NodeJS.ProcessEnv = process.env, prefix = "BACKUP_KEEP_"): GfsPolicy {
  const n = (v: string | undefined, d: number) => {
    if (v === undefined || v === "") return d;
    const x = Number(v);
    if (!Number.isInteger(x) || x < 0 || x > 3650) throw new Error("Retención de copias no válida (entero entre 0 y 3650)");
    return x;
  };
  return { daily: n(env[`${prefix}DAILY`], DEFAULT_GFS.daily), weekly: n(env[`${prefix}WEEKLY`], DEFAULT_GFS.weekly), monthly: n(env[`${prefix}MONTHLY`], DEFAULT_GFS.monthly) };
}

function isoWeek(ms: number): string {
  const s = new Date(ms);
  const d = new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), s.getUTCDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7)); // jueves de la misma semana ISO
  const week = Math.ceil(((d.getTime() - Date.UTC(d.getUTCFullYear(), 0, 1)) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${week}`;
}

export interface Dated {
  id: number;
  at: number;
}

/** Copias de UN destino que sobran según la política (pura; no toca nada). */
export function selectGfsToDelete<T extends Dated>(items: T[], p: GfsPolicy): T[] {
  const sorted = [...items].sort((a, b) => b.at - a.at || b.id - a.id);
  const keep = new Set<number>();
  const bucket = (key: (ms: number) => string, limit: number) => {
    const seen = new Set<string>();
    for (const it of sorted) {
      const k = key(it.at);
      if (seen.has(k)) continue;
      if (seen.size >= limit) break;
      seen.add(k);
      keep.add(it.id);
    }
  };
  bucket((ms) => new Date(ms).toISOString().slice(0, 10), p.daily);
  bucket(isoWeek, p.weekly);
  bucket((ms) => new Date(ms).toISOString().slice(0, 7), p.monthly);
  if (sorted[0]) keep.add(sorted[0].id); // la más reciente, siempre
  return sorted.filter((x) => !keep.has(x.id));
}

export interface BackupRetentionReport {
  applied: boolean;
  policy: GfsPolicy;
  considered: number;
  toDelete: Array<{ id: number; target: string; at: number; location: string | null }>;
  deleted: number;
  errors: Array<{ id: number; error: string }>;
}

export async function applyBackupRetention(
  d: { inventory: BackupInventory; storage: BackupStorage | null },
  opts: { apply?: boolean; policy?: GfsPolicy; now?: number } = {},
): Promise<BackupRetentionReport> {
  const policy = opts.policy ?? DEFAULT_GFS;
  const all = (await d.inventory.list({ status: "ok", limit: 5000 })).filter((r) => r.targetKind !== "files");
  const groups = new Map<string, BackupRecord[]>();
  for (const r of all) {
    const k = `${r.targetKind}:${r.targetId}`;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  const report: BackupRetentionReport = { applied: !!opts.apply, policy, considered: all.length, toDelete: [], deleted: 0, errors: [] };
  const pruned: number[] = [];
  for (const [target, rows] of Array.from(groups.entries())) {
    const victims = selectGfsToDelete(
      rows.map((r) => ({ id: r.id, at: r.finishedAt ?? r.startedAt, r })),
      policy,
    );
    for (const v of victims) {
      report.toDelete.push({ id: v.id, target, at: v.at, location: v.r.location });
      if (!opts.apply) continue;
      if (!d.storage) {
        report.errors.push({ id: v.id, error: "Sin almacenamiento configurado" });
        continue;
      }
      try {
        if (v.r.location) await d.storage.delete(v.r.location);
        if (v.r.manifestKey) await d.storage.delete(v.r.manifestKey);
        pruned.push(v.id);
      } catch (e) {
        report.errors.push({ id: v.id, error: safeError(e) });
      }
    }
  }
  if (opts.apply && pruned.length) {
    await d.inventory.markPruned(pruned, opts.now ?? Date.now());
    report.deleted = pruned.length;
  }
  return report;
}

export interface CopyRetentionReport extends BackupRetentionReport {
  destination: string;
  /** Destinos cuyo borrado se omitió porque su copia más reciente no se pudo comprobar en el almacenamiento. */
  skipped: Array<{ target: string; reason: string }>;
}

/**
 * Retención INDEPENDIENTE de un destino adicional (hoy el secundario), sobre `backup_copies` y SU
 * almacenamiento: misma política abuelo-padre-hijo, pero con sus propias variables y sin tocar nunca
 * el primario ni `backup_inventory`. Ficheros (réplica incremental) y paquetes de recuperación no
 * entran.
 *
 * Salvaguarda antes de borrar nada de un destino: su copia correcta más reciente debe existir en el
 * almacenamiento con el SHA-256 registrado; si no, ese destino se omite (no se deja sin copias
 * verificables por un borrado). Dry-run por defecto.
 */
export async function applyCopyRetention(
  d: { copies: BackupCopyLedger; storage: BackupStorage | null; destination: "secondary" },
  opts: { apply?: boolean; policy?: GfsPolicy; now?: number } = {},
): Promise<CopyRetentionReport> {
  const policy = opts.policy ?? DEFAULT_GFS;
  const all = (await d.copies.list({ destination: d.destination, status: "ok", limit: 5000 })).filter((r) => r.targetKind !== "files" && r.targetKind !== "config");
  const groups = new Map<string, BackupCopyRecord[]>();
  for (const r of all) {
    const k = `${r.targetKind}:${r.targetId}`;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  const report: CopyRetentionReport = { destination: d.destination, applied: !!opts.apply, policy, considered: all.length, toDelete: [], deleted: 0, errors: [], skipped: [] };
  const pruned: number[] = [];
  for (const [target, rows] of Array.from(groups.entries())) {
    const victims = selectGfsToDelete(
      rows.map((r) => ({ id: r.id, at: r.finishedAt, r })),
      policy,
    );
    if (!victims.length) continue;
    for (const v of victims) report.toDelete.push({ id: v.id, target, at: v.at, location: v.r.location });
    if (!opts.apply) continue;
    if (!d.storage) {
      for (const v of victims) report.errors.push({ id: v.id, error: "Sin almacenamiento configurado" });
      continue;
    }
    const newest = [...rows].sort((a, b) => b.finishedAt - a.finishedAt || b.id - a.id)[0];
    try {
      const h = newest.location ? await d.storage.hash(newest.location) : null;
      if (!h || h.sha256 !== newest.sha256) throw new Error("la copia más reciente no coincide con su SHA-256");
    } catch (e) {
      report.skipped.push({ target, reason: `No se borra nada: ${safeError(e)}` });
      continue;
    }
    for (const v of victims) {
      try {
        if (v.r.location) await d.storage.delete(v.r.location);
        if (v.r.manifestKey) await d.storage.delete(v.r.manifestKey);
        pruned.push(v.id);
      } catch (e) {
        report.errors.push({ id: v.id, error: safeError(e) });
      }
    }
  }
  if (opts.apply && pruned.length) {
    await d.copies.markPruned(pruned, opts.now ?? Date.now());
    report.deleted = pruned.length;
  }
  return report;
}
