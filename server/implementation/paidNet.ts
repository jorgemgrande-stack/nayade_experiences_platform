/**
 * Producto Net de sector PAGADO → expediente de implantación (11/11/2026): nadie paga sin preparación técnica.
 *
 * Cuando un pedido con un producto `net_bundle` de empresa (Hotel, Restaurant, Care, Ski, Travel, Social Token Net)
 * queda ACTIVO por cualquier circuito (compra desde el panel, conversión de la prueba, contratación en la web u otro
 * pedido), o cuando se aceptan unas condiciones personalizadas que lo incluyen, se abre solo (idempotente) el
 * expediente de implantación de esa empresa y solución (`ImplementationService.openPaid`). Life Net es personal: no.
 *
 * Reglas: solo lo NUEVO de un pedido (en un cambio, lo que no estaba en el pedido anterior); nunca rompe la activación
 * (un fallo solo se registra y se puede abrir el expediente a mano); no toca licencias ni cobros.
 */
import { opsLog } from "../_core/ops/log";
import { netProductOf } from "../../shared/netProducts";
import type { CommercialOrder } from "../orchestrator/types";
import type { CatalogPort } from "../subscriptions/ports";
import type { OrderNotifier } from "../orchestrator/service";
import type { ImplementationService, PaidCircuit } from "./service";

export const PAID_NET_ACTOR = "system:paid-net";

/** Claves de `keys` que son un producto Net de sector de empresa (`net_bundle` del catálogo, no personal). */
export async function sectorNetKeys(catalog: Pick<CatalogPort, "product">, keys: readonly string[]): Promise<string[]> {
  const out: string[] = [];
  for (const key of Array.from(new Set(keys))) {
    const net = netProductOf(key);
    if (!net || net.segment !== "business") continue;
    const p = await catalog.product(key).catch(() => null);
    if (p && (p.catalogFamily ?? "net_bundle") === "net_bundle") out.push(key);
  }
  return out;
}

/** Circuito de un pedido activado, por su tipo y su clave. Puro. */
export function circuitOf(o: Pick<CommercialOrder, "kind" | "idempotencyKey">): PaidCircuit {
  if (o.kind === "trial_conversion") return "trial_conversion";
  if (o.idempotencyKey.startsWith("purchase-")) return "panel_purchase";
  if (o.idempotencyKey.startsWith("ss-")) return "public_checkout";
  return "order";
}

export interface PaidNetDeps {
  implementation: Pick<ImplementationService, "openPaid">;
  catalog: Pick<CatalogPort, "product">;
  /** Pedido anterior de un cambio (para abrir solo lo nuevo). */
  previousOrder?: (id: number) => Promise<Pick<CommercialOrder, "request"> | null>;
}

export function paidNetOpener(d: PaidNetDeps) {
  const open = async (keys: string[], base: { companyId: number; contractId: number | null; subscriptionId: number | null; circuit: PaidCircuit; reference: string }) => {
    const opened: number[] = [];
    for (const key of await sectorNetKeys(d.catalog, keys)) {
      try {
        const r = await d.implementation.openPaid({ ...base, solutionKey: key }, PAID_NET_ACTOR);
        opened.push(r.order.id);
        if (r.created) opsLog("info", "Implementation", "paid_net_opened", { companyId: base.companyId, solutionKey: key, orderId: r.order.id, circuit: base.circuit });
      } catch (e) {
        opsLog("warn", "Implementation", "paid_net_open_failed", { companyId: base.companyId, solutionKey: key, circuit: base.circuit, error: e instanceof Error ? e.name : "error" });
      }
    }
    return opened;
  };
  return {
    /** Pedido que acaba de quedar ACTIVO (aviso `activate` del orquestador). */
    async fromOrder(o: Pick<CommercialOrder, "id" | "kind" | "idempotencyKey" | "reference" | "companyId" | "contractId" | "subscriptionId" | "previousOrderId" | "request">): Promise<number[]> {
      if (!o.companyId) return [];
      let keys = (o.request?.items ?? []).map((i) => i.key);
      if (o.previousOrderId && d.previousOrder) {
        const prev = await d.previousOrder(o.previousOrderId).catch(() => null);
        const had = new Set((prev?.request?.items ?? []).map((i) => i.key));
        keys = keys.filter((k) => !had.has(k));
      }
      if (!keys.length) return [];
      return open(keys, { companyId: o.companyId, contractId: o.contractId, subscriptionId: o.subscriptionId, circuit: circuitOf(o), reference: o.reference ?? `#${o.id}` });
    },
    /** Condiciones personalizadas aceptadas y activadas: productos de sus partidas. */
    async fromTerms(i: { companyId: number; contractId: number | null; subscriptionId: number | null; productKeys: string[]; reference: string }): Promise<number[]> {
      if (!i.productKeys.length) return [];
      return open(i.productKeys, { companyId: i.companyId, contractId: i.contractId, subscriptionId: i.subscriptionId, circuit: "custom_terms", reference: i.reference });
    },
  };
}
export type PaidNetOpener = ReturnType<typeof paidNetOpener>;

/**
 * Aviso del orquestador con la apertura del expediente al ACTIVARSE un pedido (además del aviso de siempre, si lo hay).
 * Se ejecutan los dos aunque uno falle; ninguno forma parte de la transición.
 */
export function withPaidNet(notify: OrderNotifier | undefined, ref: { run?: PaidNetOpener }): OrderNotifier | undefined {
  return async (e) => {
    const jobs: Array<Promise<unknown>> = [];
    if (e.action === "activate" && ref.run) jobs.push(ref.run.fromOrder(e.order));
    if (notify) jobs.push(notify(e));
    const out = await Promise.allSettled(jobs);
    const failed = out.find((r): r is PromiseRejectedResult => r.status === "rejected");
    if (failed) throw failed.reason;
  };
}

/**
 * Productos que un acuerdo de condiciones personalizadas AÑADE respecto a los acuerdos anteriores de la empresa (en
 * vigor, programados, sustituidos o vencidos): solo eso abre expediente al aceptarse (una revisión no reabre lo que ya
 * estaba contratado). Pura.
 */
export function addedByTerms(terms: { id: number; lines: Array<{ productKey: string | null }> }, before: Array<{ id: number; lines: Array<{ productKey: string | null }> }>): string[] {
  const had = new Set(before.filter((t) => t.id !== terms.id).flatMap((t) => t.lines.map((l) => l.productKey)).filter((k): k is string => !!k));
  return Array.from(new Set(terms.lines.map((l) => l.productKey).filter((k): k is string => !!k && !had.has(k))));
}
