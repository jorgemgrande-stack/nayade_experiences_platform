/**
 * Elephant Resource Manager — consumo frente a límites (vista del plano de control).
 *
 * Cuotas efectivas de un tenant = las propias (overrides) + los valores por defecto de plataforma
 * para las métricas/periodos que no tenga. El consumo del periodo en curso sale del almacén de uso
 * (cubos horarios, ~15 s de retraso). Las cuotas por minuto son límites de ritmo que aplica el
 * middleware en memoria: su consumo no es acumulable por horas y se informa como no aplicable.
 * No se inventan mediciones: lo que el sistema no mide se declara en `UNMEASURED`.
 */
import { windowStart, type DefaultQuota } from "./quota";
import type { Quota, QuotaEnforcement, QuotaPeriod, UsageStore } from "./types";

export const WARNING_RATIO = 0.8;

export type ResourceState = "ok" | "warning" | "exceeded" | "not_applicable";

export interface ResourceRow {
  metric: string;
  period: QuotaPeriod;
  limit: number;
  enforcement: QuotaEnforcement;
  /** `tenant`: override del tenant; `default`: valor de plataforma. */
  source: "tenant" | "default";
  /** Consumo del periodo en curso; `null` si no es acumulable (límite de ritmo por minuto). */
  used: number | null;
  /** 0–∞ (1 = 100 %); `null` si no aplica o el límite es 0 sin consumo. */
  ratio: number | null;
  state: ResourceState;
  windowStart: number;
}

export interface TenantResources {
  tenantId: string;
  rows: ResourceRow[];
  worst: ResourceState;
  maxRatio: number | null;
}

/** Recursos que hoy no tienen medición fiable (no se muestran cifras para ellos). */
export const UNMEASURED: Array<{ resource: string; note: string }> = [
  { resource: "storage.total.bytes", note: "Solo se mide lo escrito (storage.write.bytes); ni borrados ni ocupación total" },
  { resource: "db.size", note: "Tamaño de la base de datos del tenant" },
  { resource: "users.seats", note: "Usuarios/puestos activos" },
  { resource: "jobs.queued", note: "Trabajos en cola por tenant (solo duración de ejecución: job.run.ms)" },
  { resource: "cpu", note: "Sin métrica de CPU por tenant" },
  { resource: "messaging.sms_whatsapp", note: "SMS y WhatsApp" },
  // Las llamadas a GHL, Vapi y Google Maps sí se miden (ext.<proveedor>.*); falta su coste cuando el proveedor no lo da
  { resource: "integrations.outbound.cost", note: "Coste de GHL (mensajes SMS/WhatsApp) y webhooks salientes; las llamadas a GHL, Vapi y Maps se miden (ext.*)" },
];

const rank: Record<ResourceState, number> = { not_applicable: 0, ok: 1, warning: 2, exceeded: 3 };

export function effectiveQuotas(own: Quota[], defaults: DefaultQuota[]): Array<Omit<Quota, "tenantId"> & { source: "tenant" | "default" }> {
  const key = (q: { metric: string; period: string }) => `${q.metric}|${q.period}`;
  const mine = new Set(own.map(key));
  return [
    ...own.map((q) => ({ metric: q.metric, period: q.period, limit: q.limit, enforcement: q.enforcement, source: "tenant" as const })),
    ...defaults.filter((q) => !mine.has(key(q))).map((q) => ({ ...q, source: "default" as const })),
  ].sort((a, b) => a.metric.localeCompare(b.metric) || a.period.localeCompare(b.period));
}

export function stateFor(used: number | null, limit: number): { ratio: number | null; state: ResourceState } {
  if (used === null) return { ratio: null, state: "not_applicable" };
  if (limit <= 0) return used > 0 ? { ratio: null, state: "exceeded" } : { ratio: null, state: "ok" };
  const ratio = used / limit;
  return { ratio, state: ratio >= 1 ? "exceeded" : ratio >= WARNING_RATIO ? "warning" : "ok" };
}

export async function tenantResources(
  deps: { quotas: { listQuotas(tenantId: string): Promise<Quota[]> }; usage: Pick<UsageStore, "sum">; defaults: DefaultQuota[] },
  tenantId: string,
  now: number,
): Promise<TenantResources> {
  const rows: ResourceRow[] = [];
  for (const q of effectiveQuotas(await deps.quotas.listQuotas(tenantId), deps.defaults)) {
    const from = windowStart(q.period, now);
    const used = q.period === "minute" ? null : await deps.usage.sum(tenantId, q.metric, from, now + 1);
    rows.push({ ...q, used, ...stateFor(used, q.limit), windowStart: from });
  }
  const worst = rows.reduce<ResourceState>((w, r) => (rank[r.state] > rank[w] ? r.state : w), "not_applicable");
  const ratios = rows.map((r) => r.ratio).filter((x): x is number => x !== null);
  return { tenantId, rows, worst, maxRatio: ratios.length ? Math.max(...ratios) : null };
}
