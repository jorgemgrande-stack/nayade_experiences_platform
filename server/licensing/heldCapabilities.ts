/**
 * Protección contra el DOBLE COBRO de un módulo o producto Net (11/11/2026): antes de vender un producto en línea
 * (compra desde el panel, conversión de una prueba o pago de Checkout) se comprueba si la empresa YA TIENE vigentes
 * todas las capacidades que concede, vengan de donde vengan: otra suscripción (p. ej. unas condiciones
 * personalizadas, `subscription:<id>`), una activación del equipo (`operator`) o derechos adquiridos. Comprobar solo
 * lo que lleva el pedido vigente dejaba cobrar otra vez lo que la empresa ya tenía por otro camino.
 *
 * Reglas:
 *  - Cuenta una licencia de empresa (`siteId = ''`) en estado contratado, pendiente de configurar o activo, sin caducar.
 *    Solo lectura (prueba vencida), suspendida o cancelada no cuentan: no es un servicio que la empresa tenga.
 *  - El llamante excluye los orígenes que son legítimamente el mismo contrato (la suscripción del pedido vigente en
 *    una ampliación, la propia prueba en su conversión): esos los gobierna su circuito.
 *  - Un producto sin capacidades no se puede comprobar así (y no se bloquea).
 *  - Solo lee: nunca cambia una licencia.
 */
import type { CapabilityReader } from "../_core/capabilities/store";
import type { CatalogPort } from "../subscriptions/ports";

const HELD = new Set(["contracted", "pending_setup", "active"]);

type ProductCaps = { capabilities?: string[]; bundleOf?: string[] };
/** Capacidades de un producto con las de sus componentes (un paquete las concede a través de ellos, como en licencias). */
async function capabilitiesOfProduct(catalog: Pick<CatalogPort, "product">, p: ProductCaps, out = new Set<string>(), depth = 0): Promise<Set<string>> {
  if (depth > 10) return out;
  for (const c of p.capabilities ?? []) out.add(c);
  for (const comp of p.bundleOf ?? []) {
    const cp = await catalog.product(comp).catch(() => null);
    if (cp) await capabilitiesOfProduct(catalog, cp, out, depth + 1);
  }
  return out;
}

export interface HeldProduct {
  key: string;
  name: string;
  /** Orígenes de las licencias que ya lo cubren (sin repetir). */
  sources: string[];
}

/** Texto legible del origen de una licencia. */
export function sourceLabel(source: string): string {
  if (source.startsWith("subscription:")) return "otra suscripción o unas condiciones personalizadas";
  if (source.startsWith("trial:")) return "una prueba gratuita";
  if (source === "operator") return "una activación del equipo de Big Elephant";
  return "derechos adquiridos";
}

/** Mensaje para el cliente: no se cobra dos veces lo que ya tiene. */
export function heldMessage(h: HeldProduct): string {
  const from = Array.from(new Set(h.sources.map(sourceLabel))).join(" y ");
  return `«${h.name}» ya está activo en tu empresa (por ${from}): no se cobra dos veces. Si necesitas cambiar cómo lo tienes contratado, escríbenos y lo revisa el equipo.`;
}

/**
 * Productos de `keys` cuyas capacidades tiene YA la empresa (todas, vigentes) por un origen que no se excluye.
 * Sin plataforma o sin lector de licencias: ninguno.
 */
export async function alreadyHeld(
  d: { capabilities?: CapabilityReader | null; catalog: Pick<CatalogPort, "product"> },
  tenantId: string | null | undefined,
  keys: readonly string[],
  opts: { ignoreSource?: (source: string) => boolean; now: number },
): Promise<HeldProduct[]> {
  if (!tenantId || !d.capabilities || !keys.length) return [];
  const grants = (await d.capabilities.list(tenantId)).filter((g) => g.siteId === "" && HELD.has(g.status) && (g.validUntil === null || g.validUntil > opts.now) && !(opts.ignoreSource?.(g.source) ?? false));
  if (!grants.length) return [];
  const byCap = new Map<string, string[]>();
  for (const g of grants) byCap.set(g.capabilityId, [...(byCap.get(g.capabilityId) ?? []), g.source]);
  const out: HeldProduct[] = [];
  for (const key of Array.from(new Set(keys))) {
    const p = await d.catalog.product(key).catch(() => null);
    const caps = p ? Array.from(await capabilitiesOfProduct(d.catalog, p)) : [];
    if (!p || !caps.length || !caps.every((c) => byCap.has(c))) continue;
    out.push({ key, name: p.name, sources: Array.from(new Set(caps.flatMap((c) => byCap.get(c)!))) });
  }
  return out;
}

/**
 * Comprobación de una venta con alta o conversión (panel y Checkout): ignora solo las licencias de la PRUEBA de la
 * empresa (sus suscripciones en «trialing»), que la propia conversión sustituye. Todo lo demás cuenta.
 */
export function saleGuard(d: {
  capabilities?: CapabilityReader | null;
  catalog: Pick<CatalogPort, "product">;
  companyOfTenant: (tenantId: string) => Promise<number | null>;
  subscriptions: { list(f: { companyId: number }): Promise<Array<{ id: number; status: string }>> };
  now: () => number;
}): (tenantId: string | null | undefined, keys: readonly string[]) => Promise<HeldProduct[]> {
  return async (tenantId, keys) => {
    if (!tenantId || !d.capabilities || !keys.length) return [];
    const companyId = await d.companyOfTenant(tenantId);
    const trialing = new Set(companyId === null ? [] : (await d.subscriptions.list({ companyId })).filter((s) => s.status === "trialing").map((s) => `subscription:${s.id}`));
    return alreadyHeld(d, tenantId, keys, { now: d.now(), ignoreSource: (s) => trialing.has(s) });
  };
}
