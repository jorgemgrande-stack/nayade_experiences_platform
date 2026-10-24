/**
 * Resource Manager — lecturas derivadas del consumo MEDIDO (base `es_erm`), sin inventar datos:
 *  - anomalías: días con un consumo muy por encima (o una caída a cero) frente a la referencia de los 14 días anteriores;
 *  - estado de los recolectores: cuándo llegó el último dato de cada empresa (el Core vuelca cada ~15 s por hora);
 *  - exportación diaria por empresa y métrica (día civil de Madrid);
 *  - política de exceso de cuota: qué pasa al aviso y al límite. La suspensión NUNCA es automática.
 */
import { madridDay } from "./tenantMetrics";
import type { UsageStore } from "./types";

const DAY = 86_400_000;
const HOUR = 3_600_000;

export interface Anomaly {
  tenantId: string;
  metric: string;
  date: string;
  value: number;
  baseline: number;
  kind: "spike" | "drop";
  /** Veces la referencia (pico) o 0 (caída). */
  factor: number;
}

/** Métricas que tiene sentido vigilar (volumen de uso); umbral mínimo para no avisar por ruido. */
export const WATCHED: Record<string, number> = {
  "http.request": 500,
  "http.response.bytes": 50_000_000,
  "http.request.ms": 600_000,
  "job.run.ms": 600_000,
  "email.sent": 50,
  "storage.write.bytes": 100_000_000,
  "data_export.bytes": 100_000_000,
};

/**
 * Anomalía del último día completo frente a los 14 anteriores (los días sin consumo cuentan como 0):
 *  - pico: valor ≥ máximo(media + 3·desviación, 3·media) y por encima del umbral mínimo de la métrica;
 *  - caída: 0 cuando la media de referencia supera el umbral (posible fallo de medición o de servicio).
 */
export function detectAnomalies(tenantId: string, daily: Map<string, Record<string, number>>, lastFullDay: string): Anomaly[] {
  const back = (n: number) => {
    const t = new Date(`${lastFullDay}T12:00:00Z`);
    t.setUTCDate(t.getUTCDate() - n);
    return t.toISOString().slice(0, 10);
  };
  const out: Anomaly[] = [];
  for (const [metric, min] of Object.entries(WATCHED)) {
    const ref = Array.from({ length: 14 }, (_, i) => daily.get(back(i + 1))?.[metric] ?? 0);
    const mean = ref.reduce((a, x) => a + x, 0) / ref.length;
    const sd = Math.sqrt(ref.reduce((a, x) => a + (x - mean) ** 2, 0) / ref.length);
    const v = daily.get(lastFullDay)?.[metric] ?? 0;
    if (v >= min && v >= Math.max(mean + 3 * sd, 3 * mean)) out.push({ tenantId, metric, date: lastFullDay, value: v, baseline: round(mean), kind: "spike", factor: mean > 0 ? round(v / mean) : Infinity });
    else if (v === 0 && mean >= min) out.push({ tenantId, metric, date: lastFullDay, value: 0, baseline: round(mean), kind: "drop", factor: 0 });
  }
  return out;
}

const round = (x: number) => Math.round(x * 100) / 100;

export async function dailyUsage(usage: UsageStore, tenantId: string, from: number, to: number): Promise<Map<string, Record<string, number>>> {
  const byDay = new Map<string, Record<string, number>>();
  for (const r of await usage.list(tenantId, from, to)) {
    const day = madridDay(r.hourStart);
    const row = byDay.get(day) ?? {};
    row[r.metric] = (row[r.metric] ?? 0) + r.quantity;
    byDay.set(day, row);
  }
  return byDay;
}

export interface CollectorStatus {
  tenantId: string;
  state: "ok" | "stale" | "no_data";
  lastHour: string | null;
  ageHours: number | null;
}

/**
 * Último cubo con datos de cada empresa en las últimas 48 h. Una empresa activa recibe al menos las peticiones de su
 * propia salud y de sus tareas: sin datos en 3 horas, el recolector (o el servicio) no está midiendo.
 */
export async function collectorStatus(usage: UsageStore, tenantIds: string[], now: number): Promise<CollectorStatus[]> {
  const out: CollectorStatus[] = [];
  for (const id of tenantIds) {
    const rows = await usage.list(id, now - 48 * HOUR, now + HOUR);
    const last = rows.reduce((m, r) => Math.max(m, r.hourStart), -1);
    if (last < 0) out.push({ tenantId: id, state: "no_data", lastHour: null, ageHours: null });
    else {
      const age = (now - (last + HOUR)) / HOUR;
      out.push({ tenantId: id, state: age > 3 ? "stale" : "ok", lastHour: new Date(last).toISOString(), ageHours: Math.max(0, Math.round(age * 10) / 10) });
    }
  }
  return out;
}

/** CSV diario (día de Madrid) de las empresas indicadas: tenant, métrica, día, cantidad. Sin datos personales. */
export async function exportDailyCsv(usage: UsageStore, tenantIds: string[], from: number, to: number): Promise<string> {
  const lines = ["empresa,metrica,dia,cantidad"];
  for (const id of tenantIds) {
    const d = await dailyUsage(usage, id, from, to);
    for (const day of Array.from(d.keys()).sort()) {
      for (const [metric, q] of Object.entries(d.get(day)!).sort(([a], [b]) => a.localeCompare(b))) lines.push(`${id},${metric},${day},${q}`);
    }
  }
  return "﻿" + lines.join("\r\n") + "\r\n";
}

/**
 * Política de exceso de cuota (la misma para todas las cuotas; documentada en el runbook del Resource Manager):
 *  - aviso (≥ 80 %): se muestra en Admin;
 *  - límite (≥ 100 %): cuota «hard» → se rechaza el consumo que la supere; «soft» → se permite y se avisa;
 *  - suspensión del servicio: nunca automática; requiere una política aprobada y una decisión de una persona.
 */
export const OVERAGE_POLICY = {
  warningAt: 0.8,
  atWarning: "Aviso en Admin (vista de recursos y ficha de la empresa)",
  atLimit: { hard: "Se rechaza solo el consumo que supere la cuota; el resto del servicio sigue funcionando", soft: "Se permite y se avisa" },
  suspension: "Nunca automática: no hay una política de suspensión aprobada",
  approved: false,
} as const;

export function lastFullMadridDay(now: number): string {
  return madridDay(now - DAY);
}
