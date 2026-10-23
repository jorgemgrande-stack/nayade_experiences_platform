/**
 * Avisos de consumo a cada empresa: cuando un recurso de su plan (correo, IA, ficheros, exportaciones) llega al 80 %
 * o al 100 % del límite del periodo, se avisa a su contacto principal en el CRM.
 *
 * Una vez por recurso, periodo y umbral: la clave de la bandeja de salida (`usage:<empresa>:<métrica>:<periodo>:
 * <inicio del periodo>:<umbral>`) lo hace idempotente aunque la comprobación se repita. Sale por la bandeja de la
 * plataforma, así que respeta MAIL_MODE (con `off`, no sale nada).
 */
import { tenantResources } from "../_core/erm/overview";
import { windowStart, type DefaultQuota } from "../_core/erm/quota";
import type { Quota, UsageStore } from "../_core/erm/types";
import { panelUsage, type PanelUsageRow } from "./panelUsage";

export interface UsageNotice {
  tenantId: string;
  key: string;
  label: string;
  periodLabel: string;
  used: string;
  limit: string;
  level: "warning" | "exceeded";
  /** Al llegar al límite se detiene (hard) o solo se avisa (soft). */
  hard: boolean;
  host: string | null;
}

const nf = new Intl.NumberFormat("es-ES");
/** Cifra legible de un consumo (bytes en KB/MB/GB; el resto con separador de miles). */
export function formatUsageAmount(n: number, unit: PanelUsageRow["unit"]): string {
  if (unit !== "bytes") return nf.format(n) + (unit === "tokens" ? " tokens" : "");
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${new Intl.NumberFormat("es-ES", { maximumFractionDigits: v < 10 && i > 0 ? 1 : 0 }).format(v)} ${units[i]}`;
}

/** Estados de la empresa en los que tiene sentido avisar (está usando la plataforma). */
const ACTIVE = new Set(["active", "trial", "grace"]);

export async function runUsageNotices(d: {
  reader: { listTenants(): Promise<Array<{ id: string; status: string }>> };
  quotas: { listQuotas(tenantId: string): Promise<Quota[]> };
  usage: Pick<UsageStore, "sum">;
  defaults: DefaultQuota[];
  recipientOf: (tenantId: string) => Promise<string | null>;
  hostOf?: (tenantId: string) => Promise<string | null>;
  notify: (to: string, n: UsageNotice) => Promise<void>;
  now?: number;
}): Promise<{ checked: number; notified: number; withoutRecipient: number }> {
  const now = d.now ?? Date.now();
  const out = { checked: 0, notified: 0, withoutRecipient: 0 };
  for (const t of await d.reader.listTenants()) {
    if (!ACTIVE.has(t.status)) continue;
    out.checked++;
    const rows = panelUsage(await tenantResources({ quotas: d.quotas, usage: d.usage, defaults: d.defaults }, t.id, now)).rows.filter(
      (r) => r.state === "warning" || r.state === "exceeded",
    );
    if (!rows.length) continue;
    const to = await d.recipientOf(t.id).catch(() => null);
    if (!to) {
      out.withoutRecipient++;
      continue;
    }
    const host = d.hostOf ? await d.hostOf(t.id).catch(() => null) : null;
    for (const r of rows) {
      const level = r.state as UsageNotice["level"];
      await d.notify(to, {
        tenantId: t.id,
        key: `usage:${t.id}:${r.metric}:${r.period}:${windowStart(r.period, now)}:${level === "exceeded" ? 100 : 80}`,
        label: r.label,
        periodLabel: r.periodLabel,
        used: formatUsageAmount(r.used, r.unit),
        limit: formatUsageAmount(r.limit, r.unit),
        level,
        hard: r.enforcement === "hard",
        host,
      });
      out.notified++;
    }
  }
  return out;
}

/** Contacto principal (activo, con email) de la empresa del CRM enlazada a la plataforma, si es única. */
export async function crmContactOf(store: { list(kind: string, filter: Record<string, unknown>): Promise<unknown[]> }, tenantId: string): Promise<string | null> {
  const companies = (await store.list("companies", { tenantId })) as Array<{ id: number }>;
  if (companies.length !== 1) return null;
  const contacts = ((await store.list("contacts", { companyId: companies[0].id })) as Array<{ status?: string; email?: string | null; isPrimary?: boolean }>).filter(
    (c) => c.status !== "inactive" && c.email,
  );
  return (contacts.find((c) => c.isPrimary) ?? contacts[0])?.email ?? null;
}
