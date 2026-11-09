/**
 * Foto de solo lectura de lo que cobra y licencia (suscripciones, partidas, pedidos, pagos, suscripciones de Stripe y
 * licencias): recuentos por estado y una huella por tabla. Sirve para demostrar que una operación del catálogo
 * (importar o publicar fichas) no ha cambiado nada de eso: dos fotos con la misma huella = nada ha cambiado.
 * Sin datos personales (solo identificadores internos, estados, importes y fechas técnicas).
 */
import crypto from "node:crypto";
import type { Pool, RowDataPacket } from "mysql2/promise";
import { NET_COMPLETE } from "./policy";
import { NET_PRODUCTS } from "../../../shared/netProducts";

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
const REGISTRY_TABLES: TableSpec[] = [
  { table: "tenant_entitlements", columns: ["tenant_id", "module_id", "status", "valid_until"], order: "tenant_id, module_id", status: "status" },
  { table: "tenant_capabilities", columns: ["tenant_id", "capability_id", "status", "valid_until"], order: "tenant_id, capability_id", status: "status" },
];

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

/** Claves del catálogo de Elephant Net: las siete soluciones y sus antiguos módulos sueltos (heredados desde el 09/11/2026). */
const NET_KEYS = NET_PRODUCTS.flatMap((p) => [p.key, ...p.legacyKeys]);
const NET_SOLUTIONS = new Set(NET_PRODUCTS.map((p) => p.key));
/** Capacidades que conceden los productos Net (server/catalog/capabilities.ts). */
export const NET_CAPABILITIES = ["hotel-net", "ski-school", "ski-rental", "travel-net", "restaurant-net", "care-net", "social-token-net", "social-token-net-tokens", "life-net"] as const;

/**
 * Contrataciones de Elephant Net (solo lectura, sin datos personales): partidas vivas por producto en suscripciones no
 * canceladas (empresas, partidas e importe), empresas con módulos sueltos y con solución completa, y licencias Net por
 * capacidad y estado, con su huella. Sirve para demostrar que la unificación comercial no cambia ningún contrato.
 */
export async function netContracts(crm: Pool, registry: Pool, now = Date.now()) {
  const out: { porProducto: Record<string, { empresas: number; partidas: number; importeCents: number }>; empresasConModulosSueltos: number[]; empresasConCompleto: number[]; licencias: Record<string, Record<string, number>> | "ausente"; huellaLicencias: string | null } = {
    porProducto: {},
    empresasConModulosSueltos: [],
    empresasConCompleto: [],
    licencias: {},
    huellaLicencias: null,
  };
  try {
    const [rows] = await crm.query<RowDataPacket[]>(
      `SELECT s.company_id, i.product_key, i.unit_amount_cents, i.quantity FROM subscription_items i JOIN subscriptions s ON s.id = i.subscription_id WHERE s.status <> 'canceled' AND (i.effective_to IS NULL OR i.effective_to > ?) AND i.product_key IN (${NET_KEYS.map(() => "?").join(",")}) ORDER BY i.id`,
      [now, ...NET_KEYS],
    );
    const companies = new Map<string, Set<number>>();
    const modules = new Set<number>();
    const solutions = new Set<number>();
    for (const r of rows) {
      const k = String(r.product_key);
      const c = Number(r.company_id);
      const p = (out.porProducto[k] ??= { empresas: 0, partidas: 0, importeCents: 0 });
      p.partidas++;
      p.importeCents += Number(r.unit_amount_cents) * Number(r.quantity ?? 1);
      if (!companies.has(k)) companies.set(k, new Set());
      companies.get(k)!.add(c);
      (NET_SOLUTIONS.has(k) ? solutions : modules).add(c);
    }
    for (const [k, s] of Array.from(companies)) out.porProducto[k].empresas = s.size;
    out.empresasConModulosSueltos = Array.from(modules).sort((a, b) => a - b);
    out.empresasConCompleto = Array.from(solutions).sort((a, b) => a - b);
  } catch (e) {
    if ((e as { code?: string }).code !== "ER_NO_SUCH_TABLE") throw e;
  }
  try {
    const [rows] = await registry.query<RowDataPacket[]>(
      `SELECT tenant_id, capability_id, status, valid_until FROM tenant_capabilities WHERE capability_id IN (${NET_CAPABILITIES.map(() => "?").join(",")}) ORDER BY tenant_id, capability_id`,
      [...NET_CAPABILITIES],
    );
    const lic: Record<string, Record<string, number>> = {};
    const h = crypto.createHash("sha256");
    for (const r of rows) {
      const cap = String(r.capability_id);
      const st = String(r.status);
      lic[cap] ??= {};
      lic[cap][st] = (lic[cap][st] ?? 0) + 1;
      h.update(JSON.stringify([r.tenant_id, cap, st, r.valid_until instanceof Date ? r.valid_until.toISOString() : r.valid_until]) + "\n");
    }
    out.licencias = lic;
    out.huellaLicencias = h.digest("hex").slice(0, 16);
  } catch (e) {
    if ((e as { code?: string }).code !== "ER_NO_SUCH_TABLE") throw e;
    out.licencias = "ausente";
  }
  return out;
}

export async function commercialIntegrity(crm: Pool, registry: Pool): Promise<Record<string, TableSnapshot | "ausente" | Awaited<ReturnType<typeof coreAudit>> | Awaited<ReturnType<typeof netContracts>>>> {
  const out: Record<string, TableSnapshot | "ausente" | Awaited<ReturnType<typeof coreAudit>> | Awaited<ReturnType<typeof netContracts>>> = {};
  for (const t of CRM_TABLES) out[t.table] = await snapshot(crm, t);
  for (const t of REGISTRY_TABLES) out[t.table] = await snapshot(registry, t);
  out.coreUnico = await coreAudit(crm);
  out.net = await netContracts(crm, registry);
  return out;
}
