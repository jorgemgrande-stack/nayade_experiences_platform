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
import { LIMIT_METRICS, type LimitChange, type LimitMetric, type TenantLimitStore } from "../_core/limits/store";
import type { CommercialEventDraft, CommercialEventSink } from "../commercialEvents/types";
import { cleanData } from "../commercialEvents/derive";
import { opsLog } from "../_core/ops/log";

/** Capacidades que concede un producto (con su herencia y, en los paquetes, las de sus componentes). */
function capabilitiesOf(p: QuoteCatalogProduct | undefined, byKey: Map<string, QuoteCatalogProduct>, out = new Set<string>(), depth = 0): Set<string> {
  if (!p || depth > 10) return out;
  p.capabilities.forEach((c) => CAPABILITY_IDS.includes(c) && out.add(c));
  if (p.inherits) capabilitiesOf(byKey.get(p.inherits), byKey, out, depth + 1);
  for (const comp of p.bundleOf) capabilitiesOf(byKey.get(comp), byKey, out, depth + 1);
  return out;
}

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
      /** Límites contratados (registro 0013); sin ellos, solo se aplican las capacidades. */
      limits?: Pick<TenantLimitStore, "setLimits">;
      /** Registro de eventos comerciales (entitlement.limit_changed). */
      events?: CommercialEventSink;
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
    const capsOf = (p: QuoteCatalogProduct | undefined) => capabilitiesOf(p, byKey);
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
    const cancelled = events.filter((e) => e.toStatus === "cancelled" && e.fromStatus !== "cancelled").map((e) => e.capabilityId);
    if (cancelled.length) await this.removalsEffective(subscriptionId, plan.tenantId, cancelled, o.actor);
    const limits = await this.applyLimits(subscriptionId, plan.tenantId, o.actor);
    return { ...plan, applied: events, limits };
  }

  /**
   * Baja EFECTIVA de módulos: partidas cuya baja ya se cumplió (fin <= ahora) y cuyas licencias acaba de cancelar ESTA
   * sincronización. Un evento por partida (`subscription.module_removal_effective`) con el producto retirado. Nunca por
   * una baja solo programada, por el plan Core (cambio de plan), por una ampliación por cantidad, por un paquete que
   * sustituye a sus componentes (sus licencias siguen) ni por el fin de toda la suscripción (tiene su propio aviso).
   * Mismo patrón que los límites: las licencias se escriben en su propia transacción y el evento después, idempotente
   * por partida (repetir la sincronización no lo duplica).
   */
  private async removalsEffective(subscriptionId: number, tenantId: string, cancelled: string[], actor: string) {
    if (!this.d.events) return;
    const sub = await this.d.subscriptions.get(subscriptionId);
    if (!sub || sub.status === "canceled") return;
    const now = this.now();
    const all = await this.d.subscriptions.items(sub.id);
    const byKey = new Map((await this.d.catalog()).products.map((p) => [p.key, p]));
    const liveKeys = new Set(all.filter((i) => i.effectiveFrom <= now && (i.effectiveTo === null || i.effectiveTo > now)).map((i) => i.productKey));
    const gone = new Set(cancelled);
    const drafts: CommercialEventDraft[] = all
      .filter((i) => i.effectiveTo !== null && i.effectiveTo <= now && i.family !== "core_plan" && i.lineKind !== "quantity" && !liveKeys.has(i.productKey))
      .map((i) => ({ item: i, caps: Array.from(capabilitiesOf(byKey.get(i.productKey), byKey)).filter((c) => gone.has(c)).sort() }))
      .filter((x) => x.caps.length > 0)
      .map(({ item, caps }) => ({
        key: `subscription:${sub.id}:item:${item.id}:removal_effective`,
        type: "subscription.module_removal_effective" as const,
        aggregate: { type: "subscription" as const, id: String(sub.id), version: sub.version },
        correlationId: `subscription:${sub.id}`,
        tenantId,
        companyId: sub.companyId,
        orderId: null,
        subscriptionId: sub.id,
        trialId: null,
        paymentId: null,
        stripeRef: null,
        fromState: sub.status,
        toState: sub.status,
        actor,
        occurredAt: now,
        data: cleanData({ before: { item: item.productKey, priceId: item.priceId, family: item.family }, after: { effectiveTo: item.effectiveTo }, capabilities: caps }),
      }));
    if (!drafts.length) return;
    await this.d.events.append(null, drafts).catch((e) => opsLog("error", "Licensing", "removal_event_failed", { subscriptionId: sub.id, error: e instanceof Error ? e.name : "error" }));
  }

  /**
   * Límites contratados de la suscripción (registro 0013): lo incluido en el plan, con su herencia, más las
   * ampliaciones vigentes (unidades × paso). null = por contrato (sin tope técnico). Una suscripción terminada no
   * los cambia (la empresa queda en solo lectura con los que tenía).
   */
  async limitsFor(subscriptionId: number): Promise<Array<{ metric: LimitMetric; limit: number | null }>> {
    const sub = await this.d.subscriptions.get(subscriptionId);
    if (!sub) throw new LicensingError("not_found", "Suscripción no encontrada");
    const now = this.now();
    const items = (await this.d.subscriptions.items(sub.id)).filter((i) => i.effectiveFrom <= now && (i.effectiveTo === null || i.effectiveTo > now));
    const catalog = await this.d.catalog();
    const byKey = new Map(catalog.products.map((p) => [p.key, p]));
    const planItem = items.find((i) => i.family === "core_plan");
    const included = (metric: string): number | null | undefined => {
      for (let p = planItem ? byKey.get(planItem.productKey) : undefined, g = 0; p && g < 10; p = p.inherits ? byKey.get(p.inherits) : undefined, g++) {
        const q = p.quotas.find((x) => x.metric === metric);
        if (q) return q.included;
      }
      return undefined;
    };
    const out: Array<{ metric: LimitMetric; limit: number | null }> = [];
    for (const metric of LIMIT_METRICS) {
      const base = included(metric);
      if (base === undefined) continue; // el plan no define esa métrica: no se fija límite
      if (base === null) {
        out.push({ metric, limit: null });
        continue;
      }
      const extra = items.reduce((a, i) => {
        const p = byKey.get(i.productKey);
        return p?.addonFor?.metric === metric ? a + i.quantity * p.addonFor.step : a;
      }, 0);
      out.push({ metric, limit: base + extra });
    }
    return out;
  }

  private async applyLimits(subscriptionId: number, tenantId: string, actor: string): Promise<LimitChange[]> {
    if (!this.d.limits) return [];
    const sub = await this.d.subscriptions.get(subscriptionId);
    if (!sub || sub.status === "canceled") return [];
    const now = this.now();
    const changes = await this.d.limits.setLimits(tenantId, await this.limitsFor(subscriptionId), { source: `subscription:${subscriptionId}`, actor, now });
    if (changes.length && this.d.events) {
      await this.d.events
        .append(
          null,
          changes.map((c) => ({
            key: `subscription:${sub.id}:v${sub.version}:limit:${c.metric}:${c.to ?? "contract"}`,
            type: "entitlement.limit_changed" as const,
            aggregate: { type: "subscription" as const, id: String(sub.id), version: sub.version },
            correlationId: `subscription:${sub.id}`,
            tenantId,
            companyId: sub.companyId,
            orderId: null,
            subscriptionId: sub.id,
            trialId: null,
            paymentId: null,
            stripeRef: null,
            fromState: c.from === undefined ? null : String(c.from ?? "contract"),
            toState: String(c.to ?? "contract"),
            actor,
            occurredAt: now,
            data: { metric: c.metric, from: c.from ?? null, to: c.to },
          })),
        )
        .catch(() => undefined);
    }
    return changes;
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
