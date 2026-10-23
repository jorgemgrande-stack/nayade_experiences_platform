/**
 * Consumo de la propia empresa frente a los límites de su plan, para su PANEL (`GET /cp/v1/commerce/tenants/:t/usage`).
 *
 * Sale de Elephant Resource Manager (cuotas efectivas + almacén de uso), igual que la vista de operador
 * (`/tenants/:id/resources`), pero solo con los recursos que entiende una empresa (correo, IA, almacenamiento,
 * exportaciones) y con nombres legibles. Solo lectura y solo de la empresa de la ruta: el token de servicio del Core
 * es el mismo que el de la compra (`commerce:purchase`).
 */
import express, { type NextFunction, type Request, type Response, type Router } from "express";
import { z } from "zod";
import { requireScope } from "../controlPlane/auth";
import { opsLog } from "../_core/ops/log";
import { Metrics } from "../_core/metering";
import { tenantResources, WARNING_RATIO, type ResourceState, type TenantResources } from "../_core/erm/overview";
import type { DefaultQuota } from "../_core/erm/quota";
import type { Quota, QuotaPeriod, UsageStore } from "../_core/erm/types";

/** Recursos que se muestran a la empresa, en este orden, con su nombre y su unidad. */
export const PANEL_USAGE_METRICS: ReadonlyArray<{ metric: string; label: string; unit: "count" | "tokens" | "bytes" }> = [
  { metric: Metrics.EMAIL_SENT, label: "Correos enviados", unit: "count" },
  { metric: Metrics.LLM_TOKENS_INPUT, label: "Inteligencia artificial: texto enviado", unit: "tokens" },
  { metric: Metrics.LLM_TOKENS_OUTPUT, label: "Inteligencia artificial: texto generado", unit: "tokens" },
  { metric: Metrics.STORAGE_WRITE_BYTES, label: "Ficheros subidos", unit: "bytes" },
  { metric: Metrics.DATA_EXPORT_RUNS, label: "Exportaciones de datos", unit: "count" },
  { metric: Metrics.DATA_EXPORT_BYTES, label: "Volumen exportado", unit: "bytes" },
];

const PERIOD_LABEL: Record<Exclude<QuotaPeriod, "minute">, string> = { hour: "esta hora", day: "hoy", month: "este mes" };

export interface PanelUsageRow {
  metric: string;
  label: string;
  unit: "count" | "tokens" | "bytes";
  period: Exclude<QuotaPeriod, "minute">;
  periodLabel: string;
  used: number;
  limit: number;
  ratio: number | null;
  state: Exclude<ResourceState, "not_applicable">;
  /** `hard`: al llegar al límite se detiene; `soft`: se avisa pero no se corta. */
  enforcement: "hard" | "soft";
}

export interface PanelUsage {
  available: boolean;
  rows: PanelUsageRow[];
  warningRatio: number;
  /** Retraso aproximado de la medición (cubos horarios). */
  lagSeconds: number;
}

/** Vista de la empresa a partir de los recursos del ERM: solo los recursos conocidos y acumulables. */
export function panelUsage(r: Pick<TenantResources, "rows">): PanelUsage {
  const rows: PanelUsageRow[] = [];
  for (const def of PANEL_USAGE_METRICS) {
    for (const row of r.rows.filter((x) => x.metric === def.metric && x.period !== "minute" && x.used !== null && x.state !== "not_applicable")) {
      const period = row.period as Exclude<QuotaPeriod, "minute">;
      rows.push({
        metric: def.metric,
        label: def.label,
        unit: def.unit,
        period,
        periodLabel: PERIOD_LABEL[period],
        used: row.used as number,
        limit: row.limit,
        ratio: row.ratio,
        state: row.state as PanelUsageRow["state"],
        enforcement: row.enforcement,
      });
    }
  }
  return { available: true, rows, warningRatio: WARNING_RATIO, lagSeconds: 15 };
}

const tenant = z.string().regex(/^[a-z0-9][a-z0-9-]{1,62}$/);

/** Rutas del Core (montar bajo /commerce). Sin almacén de uso: `available: false`. */
export function createPanelUsageRouter(d: {
  quotas: { listQuotas(tenantId: string): Promise<Quota[]> };
  usage: Pick<UsageStore, "sum"> | null | undefined;
  defaults: DefaultQuota[];
  now?: () => number;
}): Router {
  const r = express.Router();
  r.get("/tenants/:tenantId/usage", requireScope("commerce:purchase"), (req: Request, res: Response, _next: NextFunction) => {
    const parsed = tenant.safeParse(req.params.tenantId);
    if (!parsed.success) return void res.status(400).json({ error: "invalid_request", message: "tenantId" });
    res.setHeader("Cache-Control", "no-store");
    if (!d.usage) return void res.json({ usage: { available: false, rows: [], warningRatio: WARNING_RATIO, lagSeconds: 15 } satisfies PanelUsage });
    tenantResources({ quotas: d.quotas, usage: d.usage, defaults: d.defaults }, parsed.data, (d.now ?? Date.now)())
      .then((t) => res.json({ usage: panelUsage(t) }))
      .catch((e) => {
        opsLog("error", "Commerce", "panel_usage_failed", { error: e instanceof Error ? e.name : "error" });
        res.status(500).json({ error: "internal_error", message: "Error interno" });
      });
  });
  return r;
}
