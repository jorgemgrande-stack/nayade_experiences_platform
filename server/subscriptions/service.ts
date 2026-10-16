/**
 * Operaciones de suscripción (v1, modo sombra). Reglas:
 *  - El precio que vale es el ACEPTADO: cada partida guarda su instantánea (importe, moneda, impuesto,
 *    descuento, versión de precio). Ningún cambio del catálogo la modifica.
 *  - Solo productos publicados y precios aprobados en el momento de aceptarlos; tipo de precio
 *    coherente con la familia y la periodicidad; misma moneda que la suscripción.
 *  - Dependencias y compatibilidad del catálogo comprobadas en cada cambio.
 *  - Toda operación exige la versión leída (concurrencia optimista) y queda en el historial.
 *  - Nada de esto cobra, emite facturas fiscales ni toca licencias: `licencePlan` solo CALCULA qué
 *    licencias corresponderían (adaptador de lectura), no las aplica.
 */
import type { CatalogPort, CatalogProduct, CrmPort } from "./ports";
import { isRecurring, monthlyEquivalent, periodEnd, recurringKind } from "./pricing";
import type { NewItem, SubscriptionStore, SubscriptionTx } from "./store";
import { SubscriptionError, type Discount, type Family, type Interval, type Subscription, type SubscriptionItem } from "./types";

export interface ItemSpec {
  productKey: string;
  priceId: number;
  quantity?: number;
  discount?: Discount | null;
}
export type When = "now" | "period_end";

const ADDON_FAMILIES: Family[] = ["extension", "industry_module", "service", "usage"];
const MAX_TRIAL_DAYS = 60;
const DAY = 86_400_000;

export const activeAt = (items: SubscriptionItem[], at: number) =>
  items.filter((i) => i.effectiveFrom <= at && (i.effectiveTo === null || i.effectiveTo > at));

function bad(msg: string, details?: Record<string, unknown>): never {
  throw new SubscriptionError("invalid_input", msg, details);
}
function state(msg: string, details?: Record<string, unknown>): never {
  throw new SubscriptionError("invalid_state", msg, details);
}

function checkDiscount(d: Discount | null | undefined): Discount | null {
  if (!d) return null;
  if (d.kind === "percent" && !(Number.isInteger(d.value) && d.value >= 1 && d.value <= 100)) bad("Descuento porcentual entre 1 y 100");
  if (d.kind === "amount" && !(Number.isInteger(d.value) && d.value >= 1)) bad("Descuento en céntimos ≥ 1");
  return { kind: d.kind, value: d.value, endsAt: d.endsAt ?? null, note: d.note?.trim().slice(0, 200) || null };
}

export class SubscriptionService {
  private now: () => number;
  constructor(private d: { store: SubscriptionStore; catalog: CatalogPort; crm: CrmPort; now?: () => number }) {
    this.now = d.now ?? Date.now;
  }

  // ── Instantánea contractual ────────────────────────────────────────────────

  /** Copia las condiciones aceptadas: tras esto, el catálogo puede cambiar sin afectar al contrato. */
  private async snapshot(spec: ItemSpec, allowed: Family[], sub: { interval: Interval; currency: string }, at: number, actor: string): Promise<{ item: NewItem; product: CatalogProduct }> {
    const product = await this.d.catalog.product(spec.productKey);
    if (!product) bad(`El producto «${spec.productKey}» no existe o no está publicado`);
    if (product.technicalStatus === "planned") state(`«${product.name}» está en hoja de ruta: no es contratable`);
    if (product.commercialStatus === "coming_soon" || product.commercialStatus === "unpublished") state(`«${product.name}» aún no se puede contratar (${product.commercialStatus === "coming_soon" ? "próximamente" : "no publicado"})`);
    if (!allowed.includes(product.family)) bad(`«${product.name}» es de la familia ${product.family}; aquí se esperaba ${allowed.join(" o ")}`);
    const price = await this.d.catalog.price(spec.priceId);
    if (!price || price.productKey !== product.key) bad("El precio no pertenece a ese producto");
    if (price.status !== "approved") state("Solo se aceptan precios aprobados y vigentes");
    if (price.currency !== sub.currency) bad(`El precio está en ${price.currency} y la suscripción en ${sub.currency}`);
    const expectedKind = product.family === "service" ? "one_time" : product.family === "usage" ? "usage" : recurringKind(sub.interval);
    if (price.kind !== expectedKind) bad(`Para «${product.name}» con periodicidad ${sub.interval === "year" ? "anual" : "mensual"} se necesita un precio ${expectedKind}`);
    const quantity = spec.quantity ?? 1;
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10_000) bad("Cantidad entre 1 y 10.000");
    return {
      product,
      item: {
        family: product.family,
        productKey: product.key,
        productName: product.name,
        activationKind: product.activationKind,
        activationRef: product.activationRef,
        priceId: price.id,
        priceSource: "catalog",
        priceKind: price.kind,
        unitAmountCents: price.amountCents,
        unit: price.unit,
        quantity,
        taxRateBp: price.taxRateBp,
        taxIncluded: price.taxIncluded,
        discount: checkDiscount(spec.discount),
        effectiveFrom: at,
        effectiveTo: null,
        createdAt: this.now(),
        createdBy: actor,
      },
    };
  }

  /** Dependencias y compatibilidad de una composición (claves de producto activas). */
  private async checkComposition(items: Array<Pick<SubscriptionItem, "productKey" | "family">>) {
    const keys = new Set(items.map((i) => i.productKey));
    const plan = items.find((i) => i.family === "core_plan");
    if (!plan) state("Una suscripción necesita exactamente un plan Core");
    if (items.filter((i) => i.family === "core_plan").length > 1) state("Solo puede haber un plan Core a la vez");
    const problems: string[] = [];
    for (const i of items) {
      const p = await this.d.catalog.product(i.productKey);
      if (!p) continue; // producto retirado del catálogo: la partida contratada sigue valiendo
      for (const dep of p.dependencies) if (!keys.has(dep)) problems.push(`«${p.name}» requiere «${dep}»`);
      if (i.family !== "core_plan" && p.compatibleWith.length && !p.compatibleWith.includes(plan.productKey)) {
        problems.push(`«${p.name}» no es compatible con el plan «${plan.productKey}»`);
      }
    }
    if (problems.length) state(problems.join("; "), { problems });
  }

  // ── Alta ───────────────────────────────────────────────────────────────────

  async create(
    input: {
      companyId: number;
      contractId?: number | null;
      tenantId?: string | null;
      interval: Interval;
      currency?: string;
      startAt?: number;
      trialDays?: number;
      plan: ItemSpec;
      addons?: ItemSpec[];
      reason?: string | null;
    },
    actor: string,
  ): Promise<Subscription> {
    const company = await this.d.crm.company(input.companyId);
    if (!company) bad("La empresa no existe");
    let contract = null;
    if (input.contractId) {
      contract = await this.d.crm.contract(input.contractId);
      if (!contract || contract.companyId !== input.companyId) bad("El contrato no pertenece a esa empresa");
      if (!["signed", "active"].includes(contract.status)) state("Solo se suscribe un contrato firmado o activo");
    }
    const currency = (input.currency ?? contract?.currency ?? "EUR").toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) bad("Moneda no válida");
    const trialDays = input.trialDays ?? 0;
    if (!Number.isInteger(trialDays) || trialDays < 0 || trialDays > MAX_TRIAL_DAYS) bad(`Prueba entre 0 y ${MAX_TRIAL_DAYS} días`);
    const start = input.startAt ?? this.now();
    const anchorDay = new Date(start).getUTCDate();
    const end = periodEnd(start, input.interval, anchorDay);
    const sub = { interval: input.interval, currency };
    const plan = await this.snapshot(input.plan, ["core_plan"], sub, start, actor);
    const addons = [];
    for (const a of input.addons ?? []) addons.push(await this.snapshot(a, ADDON_FAMILIES, sub, start, actor));
    const all = [plan.item, ...addons.map((a) => a.item)];
    if (new Set(all.map((i) => i.productKey)).size !== all.length) bad("Un producto no puede contratarse dos veces en la misma suscripción");
    await this.checkComposition(all);
    return this.d.store.create(
      {
        companyId: input.companyId,
        contractId: input.contractId ?? null,
        tenantId: input.tenantId ?? contract?.tenantId ?? null,
        status: trialDays > 0 ? "trialing" : "active",
        mode: "shadow",
        currency,
        interval: input.interval,
        pendingInterval: null,
        startedAt: start,
        anchorDay,
        currentPeriodStart: start,
        currentPeriodEnd: end,
        trialEnd: trialDays > 0 ? start + trialDays * DAY : null,
        cancelAt: null,
        canceledAt: null,
        createdAt: this.now(),
        createdBy: actor,
      },
      all,
      { kind: "created", before: null, after: { plan: plan.item.productKey, addons: addons.map((a) => a.item.productKey), interval: input.interval, currency }, reason: input.reason ?? null },
    );
  }

  // ── Cambios ────────────────────────────────────────────────────────────────

  private assertOpen(sub: Subscription) {
    if (sub.status === "canceled") state("La suscripción está cancelada: reactívala antes de modificarla");
    if (this.now() >= sub.currentPeriodEnd) state("Hay renovaciones vencidas sin aplicar: aplícalas antes de modificar la suscripción");
  }
  private effectAt(sub: Subscription, when: When) {
    return when === "now" ? Math.max(this.now(), sub.currentPeriodStart) : sub.currentPeriodEnd;
  }
  private assertNoScheduled(items: SubscriptionItem[], sub: Subscription, family?: Family) {
    const future = items.filter((i) => i.effectiveFrom > this.now() && (!family || i.family === family));
    if (future.length) state("Ya hay un cambio programado para la próxima renovación; espera a que se aplique", { scheduled: future.map((i) => i.productKey) });
    void sub;
  }

  /** Subida: inmediata (se prorratea en la simulación). Bajada: a fin de periodo (sin abonos, D-S3). */
  async changePlan(id: number, input: { plan: ItemSpec; when?: When; reason?: string | null }, expectedVersion: number, actor: string) {
    return this.d.store.mutate(id, expectedVersion, actor, this.now(), async (tx, sub) => {
      this.assertOpen(sub);
      const items = await tx.items();
      this.assertNoScheduled(items, sub, "core_plan");
      const current = activeAt(items, this.now()).find((i) => i.family === "core_plan");
      if (!current) state("La suscripción no tiene plan Core vigente");
      const probe = await this.snapshot(input.plan, ["core_plan"], sub, 0, actor);
      if (probe.item.productKey === current.productKey && probe.item.priceId === current.priceId) bad("Es el mismo plan y el mismo precio");
      const upgrade = monthlyEquivalent(probe.item) >= monthlyEquivalent(current);
      const when: When = input.when ?? (upgrade ? "now" : "period_end");
      if (!upgrade && when === "now") state("Una bajada de plan se aplica a fin de periodo (sin abonos por la parte no consumida)");
      const at = this.effectAt(sub, when);
      const next = { ...probe.item, effectiveFrom: at };
      await this.checkComposition([...activeAt(items, at).filter((i) => i.id !== current.id && (i.effectiveTo === null || i.effectiveTo > at)), next]);
      await tx.endItem(current.id, at);
      const created = await tx.insertItem(next);
      return {
        patch: {},
        event: {
          kind: "plan_changed",
          before: { plan: current.productKey, priceId: current.priceId, unitAmountCents: current.unitAmountCents },
          after: { plan: created.productKey, priceId: created.priceId, unitAmountCents: created.unitAmountCents, effectiveFrom: at, direction: upgrade ? "up" : "down" },
          reason: input.reason ?? null,
        },
        result: created,
      };
    });
  }

  async addItem(id: number, input: { item: ItemSpec; when?: When; reason?: string | null }, expectedVersion: number, actor: string) {
    return this.d.store.mutate(id, expectedVersion, actor, this.now(), async (tx, sub) => {
      this.assertOpen(sub);
      const items = await tx.items();
      const probe = await this.snapshot(input.item, ADDON_FAMILIES, sub, 0, actor);
      const when: When = probe.item.family === "usage" || probe.item.family === "service" ? "now" : (input.when ?? "now");
      const at = this.effectAt(sub, when);
      const live = items.filter((i) => i.effectiveTo === null || i.effectiveTo > at);
      if (live.some((i) => i.productKey === probe.item.productKey)) state(`«${probe.item.productName}» ya está contratado`);
      const next = { ...probe.item, effectiveFrom: at };
      await this.checkComposition([...activeAt(items, at), next]);
      const created = await tx.insertItem(next);
      return {
        patch: {},
        event: { kind: "item_added", before: null, after: { item: created.productKey, family: created.family, priceId: created.priceId, unitAmountCents: created.unitAmountCents, effectiveFrom: at }, reason: input.reason ?? null },
        result: created,
      };
    });
  }

  /** Por defecto a fin de periodo; nunca devuelve importes (D-S3). El plan Core no se quita: se cancela. */
  async removeItem(id: number, itemId: number, input: { when?: When; reason?: string | null }, expectedVersion: number, actor: string) {
    return this.d.store.mutate(id, expectedVersion, actor, this.now(), async (tx, sub) => {
      this.assertOpen(sub);
      const items = await tx.items();
      const it = items.find((i) => i.id === itemId);
      if (!it) throw new SubscriptionError("not_found", "Partida no encontrada");
      if (it.family === "core_plan") state("El plan Core no se quita: cambia de plan o cancela la suscripción");
      if (it.family === "service" && it.effectiveFrom <= this.now()) state("Un servicio de pago único ya prestado no se puede quitar");
      if (it.effectiveTo !== null && it.effectiveTo <= this.now()) state("La partida ya no está vigente");
      const at = this.effectAt(sub, input.when ?? "period_end");
      const remaining = activeAt(items, at).filter((i) => i.id !== it.id);
      await this.checkComposition(remaining);
      await tx.endItem(it.id, at);
      return {
        patch: {},
        event: { kind: "item_removed", before: { item: it.productKey, priceId: it.priceId }, after: { effectiveTo: at }, reason: input.reason ?? null },
        result: { itemId: it.id, effectiveTo: at },
      };
    });
  }

  /** Cancelación programada a fin de periodo: no habrá más renovaciones ni cálculos posteriores. */
  async scheduleCancel(id: number, input: { reason: string }, expectedVersion: number, actor: string) {
    if (!input.reason?.trim()) bad("Indica el motivo de la cancelación");
    return this.d.store.mutate(id, expectedVersion, actor, this.now(), async (_tx, sub) => {
      this.assertOpen(sub);
      if (sub.cancelAt !== null) state("La cancelación ya está programada");
      return {
        patch: { cancelAt: sub.currentPeriodEnd },
        event: { kind: "cancel_scheduled", before: null, after: { cancelAt: sub.currentPeriodEnd }, reason: input.reason.trim().slice(0, 500) },
        result: { cancelAt: sub.currentPeriodEnd },
      };
    });
  }

  /**
   * Reactivación: deshace una cancelación programada o, si ya está cancelada, abre un periodo nuevo
   * desde ahora con las MISMAS condiciones contratadas (no relee el catálogo).
   */
  /**
   * Fin anticipado de la prueba (conversión): la suscripción pasa a activa y empieza su primer periodo
   * de pago hoy, con las mismas condiciones contratadas. No cobra nada (modo sombra).
   */
  async endTrial(id: number, input: { reason?: string | null }, expectedVersion: number, actor: string) {
    return this.d.store.mutate(id, expectedVersion, actor, this.now(), async (_tx, sub) => {
      if (sub.status !== "trialing") state("La suscripción no está en periodo de prueba");
      const start = this.now();
      const anchorDay = new Date(start).getUTCDate();
      return {
        patch: { status: "active", trialEnd: null, anchorDay, currentPeriodStart: start, currentPeriodEnd: periodEnd(start, sub.interval, anchorDay) },
        event: { kind: "trial_ended", before: { trialEnd: sub.trialEnd }, after: { currentPeriodStart: start }, reason: input.reason ?? null },
        result: { ended: true },
      };
    });
  }

  async reactivate(id: number, input: { reason?: string | null }, expectedVersion: number, actor: string) {
    return this.d.store.mutate(id, expectedVersion, actor, this.now(), async (tx, sub) => {
      if (sub.status !== "canceled") {
        if (sub.cancelAt === null) state("La suscripción no tiene ninguna cancelación que deshacer");
        return { patch: { cancelAt: null }, event: { kind: "cancel_undone", before: { cancelAt: sub.cancelAt }, after: null, reason: input.reason ?? null }, result: { reopened: false } };
      }
      const items = await tx.items();
      // Condiciones vigentes justo antes de cancelar (no las programadas que nunca llegaron a aplicarse)
      const lastActive = activeAt(items, (sub.canceledAt ?? 0) - 1).filter((i) => i.family !== "service");
      if (!lastActive.some((i) => i.family === "core_plan")) state("No se encuentran las condiciones vigentes al cancelar");
      const start = Math.max(this.now(), sub.canceledAt ?? 0);
      const anchorDay = new Date(start).getUTCDate();
      for (const i of lastActive) {
        const { id: _i, subscriptionId: _s, ...rest } = i;
        await tx.insertItem({ ...rest, effectiveFrom: start, effectiveTo: null, createdAt: this.now(), createdBy: actor });
      }
      return {
        patch: { status: "active", canceledAt: null, cancelAt: null, anchorDay, currentPeriodStart: start, currentPeriodEnd: periodEnd(start, sub.interval, anchorDay), trialEnd: null },
        event: { kind: "reactivated", before: { canceledAt: sub.canceledAt }, after: { currentPeriodStart: start, items: lastActive.map((i) => i.productKey) }, reason: input.reason ?? null },
        result: { reopened: true },
      };
    });
  }

  /**
   * Cambio de periodicidad a partir de la próxima renovación: cada partida recurrente vigente
   * necesita su precio aprobado del nuevo tipo (mensual ↔ anual).
   */
  async changeInterval(id: number, input: { interval: Interval; prices: Array<{ itemId: number; priceId: number }>; reason?: string | null }, expectedVersion: number, actor: string) {
    return this.d.store.mutate(id, expectedVersion, actor, this.now(), async (tx, sub) => {
      this.assertOpen(sub);
      if (sub.cancelAt !== null) state("Hay una cancelación programada");
      if (input.interval === (sub.pendingInterval ?? sub.interval)) bad("Ya es la periodicidad vigente o programada");
      const items = await tx.items();
      this.assertNoScheduled(items, sub);
      const at = sub.currentPeriodEnd;
      const recurring = activeAt(items, this.now()).filter((i) => isRecurring(i.priceKind) && (i.effectiveTo === null || i.effectiveTo > at));
      const map = new Map(input.prices.map((p) => [p.itemId, p.priceId]));
      const missing = recurring.filter((i) => !map.has(i.id));
      if (missing.length) bad(`Falta el precio ${input.interval === "year" ? "anual" : "mensual"} de: ${missing.map((i) => i.productName).join(", ")}`);
      const created: SubscriptionItem[] = [];
      for (const i of recurring) {
        const snap = await this.snapshot({ productKey: i.productKey, priceId: map.get(i.id)!, quantity: i.quantity, discount: i.discount }, [i.family], { interval: input.interval, currency: sub.currency }, at, actor);
        await tx.endItem(i.id, at);
        created.push(await tx.insertItem(snap.item));
      }
      return {
        patch: { pendingInterval: input.interval },
        event: { kind: "interval_change_scheduled", before: { interval: sub.interval }, after: { interval: input.interval, effectiveFrom: at, items: created.map((c) => ({ item: c.productKey, priceId: c.priceId })) }, reason: input.reason ?? null },
        result: created,
      };
    });
  }

  /** Consumo de una partida de uso; la misma clave de idempotencia cuenta una sola vez. */
  async recordUsage(id: number, input: { itemId: number; quantity: number; idempotencyKey: string; source: string; periodStart?: number }) {
    const sub = await this.must(id);
    this.assertOpen(sub);
    const it = (await this.d.store.items(id)).find((i) => i.id === input.itemId);
    if (!it || it.family !== "usage") bad("La partida no es de consumo");
    if (!Number.isInteger(input.quantity) || input.quantity < 0) bad("Cantidad entera ≥ 0");
    if (!/^[A-Za-z0-9:._-]{8,128}$/.test(input.idempotencyKey)) bad("Clave de idempotencia no válida (8–128 caracteres)");
    return this.d.store.addUsage({
      itemId: it.id,
      periodStart: input.periodStart ?? sub.currentPeriodStart,
      quantity: input.quantity,
      source: input.source.slice(0, 40),
      idempotencyKey: input.idempotencyKey,
      createdAt: this.now(),
    });
  }

  /**
   * Aplica las renovaciones vencidas (SIMULACIÓN: nunca se programa sola). Avanza periodo a periodo
   * aplicando cambios de periodicidad programados y cancelaciones; cada paso es una mutación.
   */
  async applyRenewals(id: number, actor: string, maxPeriods = 24): Promise<Subscription> {
    let sub = await this.must(id);
    for (let n = 0; n < maxPeriods && sub.status !== "canceled" && this.now() >= sub.currentPeriodEnd; n++) {
      sub = (
        await this.d.store.mutate(id, sub.version, actor, this.now(), async (tx, cur) => {
          if (cur.cancelAt !== null && cur.cancelAt <= cur.currentPeriodEnd) {
            for (const i of await tx.items()) if (i.effectiveTo === null || i.effectiveTo > cur.currentPeriodEnd) await tx.endItem(i.id, Math.max(i.effectiveFrom, cur.currentPeriodEnd));
            return {
              patch: { status: "canceled" as const, canceledAt: cur.currentPeriodEnd },
              event: { kind: "canceled" as const, before: { status: cur.status }, after: { canceledAt: cur.currentPeriodEnd }, reason: "Cancelación programada aplicada al fin del periodo" },
              result: null,
            };
          }
          const interval = cur.pendingInterval ?? cur.interval;
          const start = cur.currentPeriodEnd;
          const end = periodEnd(start, interval, cur.anchorDay);
          return {
            patch: {
              interval,
              pendingInterval: null,
              currentPeriodStart: start,
              currentPeriodEnd: end,
              status: cur.status === "trialing" && cur.trialEnd !== null && cur.trialEnd <= start ? ("active" as const) : cur.status,
            },
            event: { kind: "renewed" as const, before: { periodStart: cur.currentPeriodStart, interval: cur.interval }, after: { periodStart: start, periodEnd: end, interval }, reason: null },
            result: null,
          };
        })
      ).subscription;
    }
    return sub;
  }

  // ── Lectura ────────────────────────────────────────────────────────────────

  async must(id: number) {
    const s = await this.d.store.get(id);
    if (!s) throw new SubscriptionError("not_found", "Suscripción no encontrada");
    return s;
  }

  async detail(id: number) {
    const subscription = await this.must(id);
    const [items, events, shadowInvoices] = await Promise.all([this.d.store.items(id), this.d.store.events(id), this.d.store.shadowInvoices(id)]);
    const company = await this.d.crm.company(subscription.companyId);
    const contract = subscription.contractId ? await this.d.crm.contract(subscription.contractId) : null;
    return { subscription, company, contract, items, events, shadowInvoices, licencePlan: licencePlan(subscription, items, this.now()) };
  }

  list(f?: { companyId?: number; status?: Subscription["status"] }) {
    return this.d.store.list(f);
  }

  offer() {
    return this.d.catalog.offer();
  }
}

/**
 * Adaptador de LECTURA hacia las licencias: qué plan y módulos corresponderían hoy según las partidas
 * vigentes. No concede ni retira nada (no hay segundo sistema de licencias); sirve para comparar con
 * las licencias reales cuando se autorice enlazarlas.
 */
export function licencePlan(sub: Subscription, items: SubscriptionItem[], now: number) {
  const live = sub.status === "canceled" ? [] : activeAt(items, now);
  return {
    applied: false as const,
    note: "Simulación: no se concede ni se retira ninguna licencia.",
    plan: live.find((i) => i.family === "core_plan" && i.activationKind === "plan")?.activationRef ?? null,
    modules: live
      .filter((i) => i.activationKind === "module" && i.activationRef)
      .map((i) => ({ moduleId: i.activationRef!, source: i.productKey, validUntil: sub.cancelAt ?? sub.currentPeriodEnd })),
  };
}

export type { SubscriptionTx };
