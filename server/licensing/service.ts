/**
 * Licencias por capacidad a partir de las suscripciones (plano de control).
 *
 * Elephant Control es la autoridad técnica sobre licencias: el CRM gestiona lo comercial, la
 * suscripción guarda lo contratado y AQUÍ se traduce en derechos de uso del tenant.
 *
 *  - Capacidades deseadas = las del plan (con su herencia: Business ⊃ Essential), las de cada
 *    partida viva y, en los paquetes, las de sus componentes. Un paquete no duplica derechos.
 *  - `preview` calcula la diferencia sin escribir; `apply` la aplica en UNA transacción, con un
 *    evento por cambio y el motivo. Idempotente: aplicar dos veces no cambia nada.
 *  - Prueba (`trialing`): licencias con caducidad al final de la prueba; al vencer sin conversión,
 *    el Core las trata como solo lectura (se consultan los datos, no se opera).
 *  - Cancelada: las licencias de esa suscripción pasan a `cancelled` (los datos no se tocan).
 *  - Caducidad por partida (intervalos mixtos): una capacidad que solo conceden partidas con fin
 *    fijado (baja de un complemento, bajada de plan programada) caduca entonces (`validUntil`),
 *    salvo que otra partida ya programada la siga concediendo sin hueco (p. ej. el paquete que
 *    sustituye a sus componentes). Al reaplicar tras ese fin, pasa a `cancelled` sin tocar el resto.
 *  - Nunca cobra ni toca la suscripción.
 */
import { COMPANY_WIDE, type CapabilityGrant, type CapabilityStatus } from "../_core/capabilities/model";
import type { CapabilityChange, CapabilityStore } from "../_core/capabilities/store";
import { CAPABILITY_IDS } from "../catalog/capabilities";
import type { QuoteCatalog, QuoteCatalogProduct } from "../catalog/quote";
import type { CrmPort } from "../subscriptions/ports";
import type { SubscriptionStore } from "../subscriptions/store";
import type { Subscription } from "../subscriptions/types";

export class LicensingError extends Error {
  constructor(
    public code: "not_found" | "invalid_state" | "invalid_input",
    message: string,
  ) {
    super(message);
  }
}

export interface LicencePlan {
  subscriptionId: number;
  tenantId: string;
  source: string;
  status: Subscription["status"];
  validUntil: number | null;
  /** Capacidad → productos que la conceden. */
  desired: Array<{ capabilityId: string; grantedBy: string[] }>;
  changes: CapabilityChange[];
  current: CapabilityGrant[];
}

export class LicensingService {
  private now: () => number;
  constructor(
    private d: {
      capabilities: CapabilityStore;
      subscriptions: Pick<SubscriptionStore, "get" | "items">;
      crm: CrmPort;
      /** Catálogo PUBLICADO en formato del cotizador. */
      catalog: () => Promise<QuoteCatalog>;
      now?: () => number;
    },
  ) {
    this.now = d.now ?? Date.now;
  }

  async preview(subscriptionId: number, o: { activate: boolean }): Promise<LicencePlan> {
    const sub = await this.d.subscriptions.get(subscriptionId);
    if (!sub) throw new LicensingError("not_found", "Suscripción no encontrada");
    // La plataforma sale de la suscripción (p. ej. la de una prueba) o de su contrato
    let tenantId = sub.tenantId ?? null;
    if (!tenantId && sub.contractId) tenantId = (await this.d.crm.contract(sub.contractId))?.tenantId ?? null;
    if (!tenantId) throw new LicensingError("invalid_state", "La suscripción no tiene plataforma (tenant): activa el contrato o da de alta la plataforma antes");
    const source = `subscription:${sub.id}`;
    const now = this.now();
    const all = await this.d.subscriptions.items(sub.id);
    const items = all.filter((i) => i.effectiveFrom <= now && (i.effectiveTo === null || i.effectiveTo > now));
    const catalog = await this.d.catalog();
    const byKey = new Map(catalog.products.map((p) => [p.key, p]));

    const capsOf = (p: QuoteCatalogProduct | undefined, out = new Set<string>(), depth = 0): Set<string> => {
      if (!p || depth > 10) return out;
      p.capabilities.forEach((c) => CAPABILITY_IDS.includes(c) && out.add(c));
      if (p.inherits) capsOf(byKey.get(p.inherits), out, depth + 1);
      for (const comp of p.bundleOf) capsOf(byKey.get(comp), out, depth + 1);
      return out;
    };
    const grants = new Map<string, Set<string>>();
    if (sub.status !== "canceled") {
      for (const it of items) {
        for (const cap of Array.from(capsOf(byKey.get(it.productKey)))) {
          if (!grants.has(cap)) grants.set(cap, new Set());
          grants.get(cap)!.add(it.productKey);
        }
      }
    }
    // Caducidad de cada capacidad: fin de las partidas que la conceden, encadenando las ya
    // programadas que empiezan antes de ese fin (sin hueco); null si alguna no tiene fin
    const capUntil = (cap: string): number | null => {
      const grantors = all.filter((i) => capsOf(byKey.get(i.productKey)).has(cap));
      let until: number | null = Math.max(...items.filter((i) => grantors.includes(i)).map((i) => i.effectiveTo ?? Infinity));
      for (let guard = 0; until !== Infinity && guard < 50; guard++) {
        const next = grantors.filter((i) => i.effectiveFrom > now && i.effectiveFrom <= until! && (i.effectiveTo === null || i.effectiveTo > until!));
        if (!next.length) break;
        until = Math.max(...next.map((i) => i.effectiveTo ?? Infinity));
      }
      return until === Infinity ? null : until;
    };

    const validUntil = sub.status === "trialing" ? sub.trialEnd : null;
    const target: CapabilityStatus = o.activate ? "active" : "contracted";
    const current = await this.d.capabilities.list(tenantId);
    const changes: CapabilityChange[] = [];
    for (const cap of Array.from(grants.keys()).sort()) {
      const cur = current.find((g) => g.capabilityId === cap && g.siteId === COMPANY_WIDE);
      // No se rebaja lo que un operador dejó activo con este mismo origen al pedir solo «contratado»
      const status: CapabilityStatus = !o.activate && cur?.source === source && cur.status === "active" ? "active" : target;
      const own = capUntil(cap);
      const until = own === null ? validUntil : validUntil === null ? own : Math.min(own, validUntil);
      changes.push({ capabilityId: cap, siteId: COMPANY_WIDE, status, validUntil: until, source });
    }
    for (const g of current) {
      if (g.source === source && !grants.has(g.capabilityId) && g.status !== "cancelled") changes.push({ capabilityId: g.capabilityId, siteId: g.siteId, status: "cancelled", validUntil: g.validUntil, source });
    }
    const effective = changes.filter((c) => {
      const cur = current.find((g) => g.capabilityId === c.capabilityId && g.siteId === c.siteId);
      return !cur || cur.status !== c.status || cur.validUntil !== c.validUntil || cur.source !== c.source;
    });
    return {
      subscriptionId: sub.id,
      tenantId,
      source,
      status: sub.status,
      validUntil,
      desired: Array.from(grants.entries()).map(([capabilityId, by]) => ({ capabilityId, grantedBy: Array.from(by).sort() })).sort((a, b) => a.capabilityId.localeCompare(b.capabilityId)),
      changes: effective,
      current,
    };
  }

  async apply(subscriptionId: number, o: { activate: boolean; actor: string; reason?: string | null }) {
    const plan = await this.preview(subscriptionId, { activate: o.activate });
    const events = plan.changes.length ? await this.d.capabilities.apply(plan.tenantId, plan.changes, { actor: o.actor, reason: o.reason ?? `Licencias de la suscripción #${subscriptionId}`, now: this.now() }) : [];
    return { ...plan, applied: events };
  }

  /** Cambio manual de estado de una capacidad (operador): activar, suspender, solo lectura… */
  async setStatus(tenantId: string, capabilityId: string, status: CapabilityStatus, o: { actor: string; reason: string; siteId?: string }) {
    if (!CAPABILITY_IDS.includes(capabilityId)) throw new LicensingError("invalid_input", "Capacidad desconocida");
    if (!o.reason || o.reason.trim().length < 5) throw new LicensingError("invalid_input", "Indica el motivo (mínimo 5 caracteres)");
    const siteId = o.siteId ?? COMPANY_WIDE;
    const cur = (await this.d.capabilities.list(tenantId)).find((g) => g.capabilityId === capabilityId && g.siteId === siteId);
    if (!cur && status !== "active" && status !== "contracted") throw new LicensingError("invalid_state", "Esa capacidad no está contratada");
    return this.d.capabilities.apply(tenantId, [{ capabilityId, siteId, status, validUntil: cur?.validUntil ?? null, source: cur?.source ?? "operator" }], { actor: o.actor, reason: o.reason.trim(), now: this.now() });
  }

  list(tenantId: string) {
    return this.d.capabilities.list(tenantId);
  }
  events(tenantId: string) {
    return this.d.capabilities.events(tenantId);
  }
}
