/**
 * Foto de solo lectura de lo que cobra y licencia (suscripciones, partidas, pedidos, pagos, suscripciones de Stripe y
 * licencias): recuentos por estado y una huella por tabla. Sirve para demostrar que una operación del catálogo
 * (importar o publicar fichas) no ha cambiado nada de eso: dos fotos con la misma huella = nada ha cambiado.
 * Sin datos personales (solo identificadores internos, estados, importes y fechas técnicas).
 */
import crypto from "node:crypto";
import type { Pool, RowDataPacket } from "mysql2/promise";
import { NET_COMPLETE } from "./policy";

interface TableSpec {
  table: string;
  columns: string[];
  order: string;
  status?: string;
}

const CRM_TABLES: TableSpec[] = [
  { table: "subscriptions", columns: ["id", "status", "billing_interval", "pending_interval", "current_period_end", "cancel_at", "version"], order: "id", status: "status" },
  { table: "subscription_items", columns: ["id", "subscription_id", "product_key", "price_id", "price_source", "price_kind", "unit_amount_cents", "quantity", "discount_kind", "discount_value", "effective_from", "effective_to"], order: "id" },
  { table: "commercial_orders", columns: ["id", "kind", "state", "subscription_id", "version"], order: "id", status: "state" },
  { table: "commercial_payments", columns: ["id", "order_id", "purpose", "amount_cents", "status"], order: "id", status: "status" },
  { table: "stripe_subscriptions", columns: ["stripe_subscription_id", "status", "cancel_at_period_end", "current_period_end", "price_ids_json", "version"], order: "stripe_subscription_id", status: "status" },
];
const REGISTRY_TABLES: TableSpec[] = [{ table: "tenant_entitlements", columns: ["tenant_id", "module_id", "status", "valid_until"], order: "tenant_id, module_id", status: "status" }];

export interface TableSnapshot {
  filas: number;
  porEstado?: Record<string, number>;
  huella: string;
}

async function snapshot(pool: Pool, t: TableSpec): Promise<TableSnapshot | "ausente"> {
  try {
    const [rows] = await pool.query<RowDataPacket[]>(`SELECT ${t.columns.map((c) => `\`${c}\``).join(", ")} FROM \`${t.table}\` ORDER BY ${t.order}`);
    const h = crypto.createHash("sha256");
    for (const r of rows) h.update(JSON.stringify(t.columns.map((c) => (r[c] instanceof Date ? (r[c] as Date).toISOString() : r[c]))) + "\n");
    const out: TableSnapshot = { filas: rows.length, huella: h.digest("hex").slice(0, 16) };
    if (t.status) out.porEstado = rows.reduce<Record<string, number>>((m, r) => ((m[String(r[t.status!])] = (m[String(r[t.status!])] ?? 0) + 1), m), {});
    return out;
  } catch (e) {
    if ((e as { code?: string }).code === "ER_NO_SUCH_TABLE") return "ausente";
    throw e;
  }
}

/**
 * Ninguna empresa paga Elephant Core dos veces: sobre las partidas vivas de las suscripciones no canceladas, por empresa.
 *  - coreCobradoDosVeces: más de una licencia Core con importe (siempre un error);
 *  - netConCoreAparte: Net completo y Core cobrado aparte (contratos históricos, legítimo: dos cuotas);
 *  - netSinCore: Net completo sin ninguna partida de Core (debería llevar la de Core incluido cuando se active).
 * Solo identificadores internos de empresa, nunca datos personales.
 */
export async function coreAudit(crm: Pool, now = Date.now()) {
  try {
    const [rows] = await crm.query<RowDataPacket[]>(
      "SELECT s.company_id, i.family, i.product_key, i.unit_amount_cents, i.discount_kind, i.discount_value FROM subscription_items i JOIN subscriptions s ON s.id = i.subscription_id WHERE s.status <> 'canceled' AND (i.effective_to IS NULL OR i.effective_to > ?)",
      [now],
    );
    const by = new Map<number, { paidCore: number; anyCore: number; nets: number }>();
    for (const r of rows) {
      const c = by.get(Number(r.company_id)) ?? { paidCore: 0, anyCore: 0, nets: 0 };
      if (r.family === "core_plan") {
        c.anyCore++;
        const full = r.discount_kind === "percent" && Number(r.discount_value) >= 100;
        if (Number(r.unit_amount_cents) > 0 && !full) c.paidCore++;
      }
      if ((NET_COMPLETE as readonly string[]).includes(String(r.product_key))) c.nets++;
      by.set(Number(r.company_id), c);
    }
    const list = (f: (c: { paidCore: number; anyCore: number; nets: number }) => boolean) => Array.from(by).filter(([, c]) => f(c)).map(([id]) => id).sort((a, b) => a - b);
    return { empresas: by.size, coreCobradoDosVeces: list((c) => c.paidCore > 1), netConCoreAparte: list((c) => c.nets > 0 && c.paidCore > 0), netSinCore: list((c) => c.nets > 0 && c.anyCore === 0) };
  } catch (e) {
    if ((e as { code?: string }).code === "ER_NO_SUCH_TABLE") return "ausente" as const;
    throw e;
  }
}

export async function commercialIntegrity(crm: Pool, registry: Pool): Promise<Record<string, TableSnapshot | "ausente" | Awaited<ReturnType<typeof coreAudit>>>> {
  const out: Record<string, TableSnapshot | "ausente" | Awaited<ReturnType<typeof coreAudit>>> = {};
  for (const t of CRM_TABLES) out[t.table] = await snapshot(crm, t);
  for (const t of REGISTRY_TABLES) out[t.table] = await snapshot(registry, t);
  out.coreUnico = await coreAudit(crm);
  return out;
}
