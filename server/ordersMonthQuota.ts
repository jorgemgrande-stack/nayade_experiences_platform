/**
 * Cupo de pedidos al mes del plan (Essential 500, Business 5.000, Enterprise por contrato): se MIDE y se AVISA, nunca
 * se bloquea un pedido (política `soft` de `orders_month` en server/_core/erm/policy.ts).
 *
 *  - Pedido = reserva registrada en el mes natural en curso (UTC, como los periodos del Resource Manager) por cualquier
 *    canal (web, TPV, taquilla, partners, cupones…). No cuentan los borradores de carrito ni los cobros fallidos.
 *  - Solo en multiempresa y con plan conocido (mismo criterio que las demás cuotas de negocio: `currentBusinessLimit`).
 *  - El aviso es la fila de «Consumo» del panel (al 80 % «Cerca del límite», al superarlo «Límite alcanzado» sin
 *    cortar nada) y un registro en el log de operaciones, como las demás cuotas `soft`.
 */
import { and, count, gte, notInArray } from "drizzle-orm";
import { reservations } from "../drizzle/schema";
import { getDb } from "./db";
import { currentBusinessLimit } from "./businessQuotas";
import { stateFor } from "./_core/erm/overview";
import { windowStart } from "./_core/erm/quota";
import { opsLog } from "./_core/ops/log";
import type { BusinessLimit } from "./quotaPolicyCatalog";
import type { PanelUsage, PanelUsageRow } from "./commerce/panelUsage";

/** Fila de consumo de pedidos del mes (mismo formato que las del Resource Manager). null si no hay tope. */
export function ordersMonthRow(eff: Pick<BusinessLimit, "limit"> | null, used: number): PanelUsageRow | null {
  if (!eff || eff.limit === null) return null;
  const { ratio, state } = stateFor(used, eff.limit);
  return {
    metric: "orders_month",
    label: "Pedidos",
    unit: "count",
    period: "month",
    periodLabel: "este mes",
    used,
    limit: eff.limit,
    ratio,
    state: state as PanelUsageRow["state"],
    enforcement: "soft",
  };
}

/** Consumo del panel con la fila de pedidos del mes (si aplica) al final. */
export function withOrdersMonth(usage: PanelUsage, orders: PanelUsageRow | null): PanelUsage {
  if (!orders) return usage;
  return { ...usage, available: true, rows: [...(usage.rows ?? []).filter((r) => r.metric !== "orders_month"), orders] };
}

/** Pedidos registrados desde el inicio del mes natural en curso (BD de la empresa en curso). */
export async function countOrdersThisMonth(now = Date.now()): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Base de datos no disponible");
  const from = windowStart("month", now);
  const [row] = await db
    .select({ n: count() })
    .from(reservations)
    .where(and(gte(reservations.createdAt, from), notInArray(reservations.status, ["draft", "failed"])));
  return Number(row?.n ?? 0);
}

/**
 * Consumo de pedidos del mes de la empresa en curso, o null si no aplica (sin plan, instalación única, sin tope o sin
 * datos). Nunca lanza: medir no debe romper la página de consumo.
 */
export async function currentOrdersMonthUsage(count: () => Promise<number> = () => countOrdersThisMonth()): Promise<PanelUsageRow | null> {
  try {
    const eff = await currentBusinessLimit("orders_month");
    if (!eff || eff.limit === null) return null;
    const row = ordersMonthRow(eff, await count());
    if (row && row.state !== "ok") opsLog("warn", "BusinessQuota", row.state === "exceeded" ? "soft_exceeded" : "warning", { metric: "orders_month", used: row.used, limit: row.limit, source: eff.source });
    return row;
  } catch (e) {
    opsLog("warn", "BusinessQuota", "orders_month_unavailable", { error: e instanceof Error ? e.name : "error" });
    return null;
  }
}
