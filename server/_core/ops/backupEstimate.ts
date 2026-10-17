/**
 * Estimación del almacenamiento y del coste mensual de las copias en UN destino a partir de lo medido
 * (tamaño medio por copia de cada destino de copia) y de la política.
 *
 *   copias conservadas por destino  K  = simulación de la retención abuelo-padre-hijo en régimen estable
 *   almacenamiento (GB)             S  = Σ_destinos K · tamaño_medio + ficheros (réplica, sin retención)
 *   operaciones de escritura / mes  A  = ejecuciones/día · 30 · (2 por base + 2 por empresa con ficheros + 2 del paquete) + ficheros nuevos
 *   operaciones de lectura / mes    B  = ejecuciones/día · 30 · (2 por base + 1 por empresa con ficheros + 2 del paquete) + ficheros nuevos
 *   coste/mes                       = S · precio_GB_mes + A/10⁶ · precio_A + B/10⁶ · precio_B
 *
 * Las ejecuciones intradía sobrantes se purgan en la retención siguiente: en régimen estable no
 * suman almacenamiento (como mucho una copia extra por destino entre dos retenciones).
 */
import { selectGfsToDelete, type GfsPolicy } from "./backupRetention";

const DAY = 86_400_000;

/** Copias que quedan por destino en régimen estable (simula 2 años de ejecuciones). */
export function steadyStateCopies(policy: GfsPolicy, runsPerDay: number): number {
  const runs = Math.max(1, Math.min(96, Math.round(runsPerDay)));
  const start = Date.UTC(2024, 0, 1);
  const items: Array<{ id: number; at: number }> = [];
  let id = 0;
  for (let day = 0; day < 730; day++) for (let r = 0; r < runs; r++) items.push({ id: ++id, at: start + day * DAY + Math.floor((r * DAY) / runs) });
  return items.length - selectGfsToDelete(items, policy).length + 1; // +1: la copia extra entre retenciones
}

export interface EstimateInput {
  policy: GfsPolicy;
  runsPerDay: number;
  /** Tamaño medio (bytes cifrados) de una copia de cada destino de base de datos. */
  databases: Array<{ kind: string; id: string; avgBytes: number }>;
  /** Bytes cifrados de la réplica de ficheros (todas las empresas) y ficheros nuevos al mes. */
  filesBytes: number;
  newFilesPerMonth?: number;
  tenantsWithFiles?: number;
  prices?: { perGbMonth: number; perMillionA: number; perMillionB: number };
}

export interface EstimateResult {
  copiesPerTarget: number;
  storedBytes: number;
  storedGb: number;
  opsA: number;
  opsB: number;
  monthlyCost: number | null;
}

export function estimateMonthly(i: EstimateInput): EstimateResult {
  const k = steadyStateCopies(i.policy, i.runsPerDay);
  const dbBytes = i.databases.reduce((n, d) => n + d.avgBytes * k, 0);
  const storedBytes = dbBytes + i.filesBytes;
  const runsMonth = i.runsPerDay * 30;
  const nDb = i.databases.length;
  const nFiles = i.tenantsWithFiles ?? 0;
  const newFiles = i.newFilesPerMonth ?? 0;
  // +2: paquete de recuperación (fechado y «latest») en cada ejecución
  const opsA = runsMonth * (2 * nDb + 2 * nFiles + 2) + newFiles;
  const opsB = runsMonth * (2 * nDb + nFiles + 2) + newFiles;
  const storedGb = storedBytes / 1e9;
  const monthlyCost = i.prices ? storedGb * i.prices.perGbMonth + (opsA / 1e6) * i.prices.perMillionA + (opsB / 1e6) * i.prices.perMillionB : null;
  return { copiesPerTarget: k, storedBytes, storedGb, opsA, opsB, monthlyCost };
}
