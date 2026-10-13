/**
 * Métricas del plano de control en formato de exposición de Prometheus (texto).
 *
 * Solo agregados operativos: recuento de tenants por estado, licencias por estado y uso de
 * la última hora por métrica. Sin identificadores de tenant en etiquetas de alta cardinalidad
 * (el uso por tenant se consulta por `/usage/:id`).
 */
import type { Entitlement } from "../_core/modules/entitlements";
import type { TenantRegistryReader } from "../_core/tenantRegistry/store";
import type { UsageStore } from "../_core/erm/types";

const esc = (v: string) => v.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");

export interface MetricsDeps {
  reader: Pick<TenantRegistryReader, "listTenants">;
  usage?: UsageStore;
  entitlements?: { listEntitlements(tenantId: string): Promise<Entitlement[]> };
  now?: () => number;
}

export async function renderMetrics(d: MetricsDeps): Promise<string> {
  const out: string[] = [];
  const g = (name: string, help: string, rows: Array<[Record<string, string>, number]>) => {
    out.push(`# HELP ${name} ${help}`, `# TYPE ${name} gauge`);
    for (const [labels, v] of rows) {
      const l = Object.entries(labels)
        .map(([k, x]) => `${k}="${esc(x)}"`)
        .join(",");
      out.push(`${name}${l ? `{${l}}` : ""} ${v}`);
    }
  };

  const tenants = await d.reader.listTenants();
  const byStatus = new Map<string, number>();
  for (const t of tenants) byStatus.set(t.status, (byStatus.get(t.status) ?? 0) + 1);
  g("elephant_tenants", "Tenants por estado", Array.from(byStatus.entries()).map(([s, n]) => [{ status: s }, n]));

  if (d.entitlements) {
    const byKey = new Map<string, number>();
    for (const t of tenants) {
      for (const e of await d.entitlements.listEntitlements(t.id)) {
        const k = `${e.moduleId}|${e.status}`;
        byKey.set(k, (byKey.get(k) ?? 0) + 1);
      }
    }
    g(
      "elephant_entitlements",
      "Licencias por módulo y estado",
      Array.from(byKey.entries()).map(([k, n]) => {
        const [module, status] = k.split("|");
        return [{ module, status }, n];
      }),
    );
  }

  if (d.usage) {
    const now = (d.now ?? Date.now)();
    const to = now + 3_600_000;
    const from = to - 2 * 3_600_000; // hora en curso y anterior
    const totals = new Map<string, number>();
    for (const t of tenants) {
      for (const r of await d.usage.list(t.id, from, to)) totals.set(r.metric, (totals.get(r.metric) ?? 0) + r.quantity);
    }
    g("elephant_usage_last_2h", "Uso agregado de las dos últimas horas por métrica", Array.from(totals.entries()).map(([m, v]) => [{ metric: m }, v]));
  }

  out.push("");
  return out.join("\n");
}
