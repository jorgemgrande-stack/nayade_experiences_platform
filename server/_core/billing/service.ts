/**
 * Motor de suscripciones SaaS.
 *
 * Ciclo: trialing (15 d) → active ⇄ past_due (7 d de gracia) → suspended (reversible) →
 * canceled/ended. Todo cobro es idempotente; los webhooks se verifican y se deduplican; las
 * transiciones se reflejan en el registro de tenants y en las licencias a través de
 * `TenantEffects`.
 */
import type { BillingNotifier, BillingStore, PaymentProvider, TenantEffects } from "./ports";
import {
  BillingError,
  DAY,
  type Catalog,
  type Interval,
  type Invoice,
  type InvoiceLine,
  type Plan,
  type Subscription,
} from "./types";

export interface BillingDeps {
  catalog: Catalog;
  store: BillingStore;
  provider: PaymentProvider;
  effects: TenantEffects;
  notifier?: BillingNotifier;
  now?: () => number;
  id?: () => string;
  /**
   * Interruptor general de cobros. `false`: se emiten facturas pero NO se cobra, y no se
   * degrada ni suspende a nadie por impago (hasta elegir proveedor y tarifas). Por defecto `true`
   * en el motor; la fábrica de producción lo fija a `false` salvo configuración explícita.
   */
  chargesEnabled?: boolean;
}

function addInterval(from: number, interval: Interval): number {
  const d = new Date(from);
  if (interval === "year") d.setUTCFullYear(d.getUTCFullYear() + 1);
  else d.setUTCMonth(d.getUTCMonth() + 1);
  return d.getTime();
}

export class SubscriptionService {
  private readonly now: () => number;
  private readonly newId: () => string;

  constructor(private d: BillingDeps) {
    this.now = d.now ?? Date.now;
    this.newId = d.id ?? (() => `sub_${Math.random().toString(36).slice(2, 12)}${Date.now().toString(36)}`);
  }

  // ── Consultas de política ──────────────────────────────────────────────────

  private plan(id: string): Plan {
    const p = this.d.catalog.plans.find((x) => x.id === id);
    if (!p) throw new BillingError("invalid_plan", `Plan desconocido: ${id}`);
    return p;
  }

  /** Catálogo público de planes y módulos (solo datos; sin estado de ningún tenant). */
  getCatalog(): Catalog {
    return this.d.catalog;
  }

  async maxCustomDomains(tenantId: string): Promise<number> {
    const s = await this.d.store.getSubscriptionByTenant(tenantId);
    if (!s) return 0;
    return s.status === "trialing" ? this.d.catalog.trial.maxCustomDomains : this.plan(s.planId).maxCustomDomains;
  }

  async canAddCustomDomain(tenantId: string, currentCount: number): Promise<boolean> {
    return currentCount < (await this.maxCustomDomains(tenantId));
  }

  /** Durante la prueba las integraciones externas están limitadas a una lista. */
  async isIntegrationAllowed(tenantId: string, integrationId: string): Promise<boolean> {
    const s = await this.d.store.getSubscriptionByTenant(tenantId);
    if (!s || s.status === "suspended" || s.status === "ended" || s.status === "canceled") return false;
    if (s.status === "trialing") return this.d.catalog.trial.integrations.includes(integrationId);
    return true;
  }

  // ── Alta y conversión ──────────────────────────────────────────────────────

  async startTrial(input: { tenantId: string; planId: string; modules?: string[]; customerId?: string | null }): Promise<Subscription> {
    const plan = this.plan(input.planId);
    if (plan.kind !== "base") throw new BillingError("invalid_plan", "La prueba requiere un plan base");
    if (await this.d.store.getSubscriptionByTenant(input.tenantId)) {
      throw new BillingError("duplicate", "El tenant ya tiene una suscripción");
    }
    const t = this.now();
    const trialEnd = t + this.d.catalog.trialDays * DAY;
    const sub: Subscription = {
      id: this.newId(),
      tenantId: input.tenantId,
      planId: plan.id,
      modules: (input.modules ?? []).filter((m) => !plan.includedModules.includes(m)),
      status: "trialing",
      currentPeriodStart: t,
      currentPeriodEnd: trialEnd,
      trialEnd,
      graceEnd: null,
      cancelAtPeriodEnd: false,
      pendingPlanId: null,
      currency: plan.currency,
      providerCustomerId: input.customerId ?? null,
      createdAt: t,
      canceledAt: null,
      attempts: 0,
    };
    await this.d.store.putSubscription(sub);
    await this.d.effects.setTenantStatus(sub.tenantId, "trial");
    await this.grantAll(sub, new Date(trialEnd));
    for (const q of this.d.catalog.trial.quotas) await this.d.effects.setQuota(sub.tenantId, q);
    return sub;
  }

  /** Convierte la prueba (o reactiva) cobrando el primer periodo. */
  async subscribe(tenantId: string, opts: { customerId?: string | null } = {}): Promise<{ subscription: Subscription; invoice: Invoice; paid: boolean; chargesDisabled?: boolean }> {
    const sub = await this.mustSub(tenantId);
    if (!["trialing", "suspended", "past_due"].includes(sub.status)) {
      throw new BillingError("invalid_state", `No se puede contratar desde ${sub.status}`);
    }
    if (opts.customerId) sub.providerCustomerId = opts.customerId;
    const t = this.now();
    const periodEnd = addInterval(t, this.plan(sub.planId).interval);
    return this.chargePeriod(sub, t, periodEnd);
  }

  // ── Cambios ────────────────────────────────────────────────────────────────

  async changePlan(tenantId: string, newPlanId: string, when: "now" | "period_end"): Promise<Subscription> {
    const sub = await this.mustSub(tenantId);
    const next = this.plan(newPlanId);
    if (next.kind !== "base") throw new BillingError("invalid_plan", "Solo se cambia entre planes base");
    if (when === "period_end" || sub.status === "trialing") {
      if (sub.status === "trialing") {
        sub.planId = next.id;
        sub.modules = sub.modules.filter((m) => !next.includedModules.includes(m));
        await this.d.store.putSubscription(sub);
        await this.grantAll(sub, new Date(sub.currentPeriodEnd));
      } else {
        sub.pendingPlanId = next.id;
        await this.d.store.putSubscription(sub);
      }
      return sub;
    }
    if (sub.status !== "active") throw new BillingError("invalid_state", "Solo se cambia de plan inmediato con la suscripción activa");

    if (!this.chargesOn()) throw new BillingError("invalid_state", "Cobros desactivados: el cambio inmediato no está disponible");
    const cur = this.plan(sub.planId);
    if (cur.interval !== next.interval) throw new BillingError("invalid_plan", "El cambio inmediato exige el mismo intervalo");
    if (cur.priceCents === null || next.priceCents === null) throw new BillingError("no_price", "Plan sin tarifa definida");
    const t = this.now();
    const remaining = Math.max(0, sub.currentPeriodEnd - t) / (sub.currentPeriodEnd - sub.currentPeriodStart);
    const diff = Math.round((next.priceCents - cur.priceCents) * remaining);
    if (diff > 0) {
      const inv = await this.issueInvoice(sub, [{ description: `Cambio a ${next.name} (prorrateo)`, amountCents: diff }], t, t, sub.currentPeriodEnd);
      const ok = await this.collect(sub, inv);
      if (!ok) throw new BillingError("invalid_state", "El cobro del cambio de plan fue rechazado");
    }
    sub.planId = next.id;
    sub.modules = sub.modules.filter((m) => !next.includedModules.includes(m));
    sub.pendingPlanId = null;
    await this.d.store.putSubscription(sub);
    await this.grantAll(sub, new Date(sub.currentPeriodEnd));
    return sub;
  }

  async addModule(tenantId: string, moduleId: string): Promise<Subscription> {
    const sub = await this.mustSub(tenantId);
    const plan = this.plan(sub.planId);
    if (plan.includedModules.includes(moduleId) || sub.modules.includes(moduleId)) return sub;
    const price = this.d.catalog.modules.find((m) => m.moduleId === moduleId && m.interval === plan.interval);
    if (!price) throw new BillingError("invalid_plan", `Módulo no disponible: ${moduleId}`);
    if (sub.status === "active") {
      if (!this.chargesOn()) throw new BillingError("invalid_state", "Cobros desactivados: no se pueden contratar módulos");
      if (price.priceCents === null) throw new BillingError("no_price", "Módulo sin tarifa definida");
      const t = this.now();
      const remaining = Math.max(0, sub.currentPeriodEnd - t) / (sub.currentPeriodEnd - sub.currentPeriodStart);
      const amount = Math.round(price.priceCents * remaining);
      if (amount > 0) {
        const inv = await this.issueInvoice(sub, [{ description: `Módulo ${moduleId} (prorrateo)`, amountCents: amount }], t, t, sub.currentPeriodEnd);
        if (!(await this.collect(sub, inv))) throw new BillingError("invalid_state", "El cobro del módulo fue rechazado");
      }
    } else if (sub.status !== "trialing") {
      throw new BillingError("invalid_state", "Estado no válido para añadir módulos");
    }
    sub.modules = [...sub.modules, moduleId];
    await this.d.store.putSubscription(sub);
    await this.d.effects.grantModule(tenantId, moduleId, new Date(sub.currentPeriodEnd));
    return sub;
  }

  async cancel(tenantId: string, opts: { atPeriodEnd?: boolean } = {}): Promise<Subscription> {
    const sub = await this.mustSub(tenantId);
    if (sub.status === "ended" || sub.status === "canceled") return sub;
    if (opts.atPeriodEnd ?? true) {
      sub.cancelAtPeriodEnd = true;
      await this.d.store.putSubscription(sub);
      return sub;
    }
    await this.end(sub);
    return sub;
  }

  async reactivate(tenantId: string): Promise<{ subscription: Subscription; invoice: Invoice; paid: boolean }> {
    const sub = await this.mustSub(tenantId);
    if (sub.status !== "suspended" && sub.status !== "past_due") {
      throw new BillingError("invalid_state", "Solo se reactiva una suscripción suspendida o en mora");
    }
    sub.cancelAtPeriodEnd = false;
    return this.subscribe(tenantId);
  }

  // ── Proceso periódico ──────────────────────────────────────────────────────

  /** Avanza el estado de todas las suscripciones. Idempotente. */
  async tick(): Promise<{ renewed: number; pastDue: number; suspended: number; ended: number }> {
    const out = { renewed: 0, pastDue: 0, suspended: 0, ended: 0 };
    const t = this.now();
    for (const sub of await this.d.store.listSubscriptions()) {
      try {
        if (sub.status === "trialing" && t >= (sub.trialEnd ?? Infinity)) {
          await this.suspend(sub, "trial_expired");
          out.suspended++;
        } else if (sub.status === "active" && t >= sub.currentPeriodEnd) {
          if (!this.chargesOn() && !sub.cancelAtPeriodEnd) continue; // sin cobros: no se renueva ni se factura
          if (sub.cancelAtPeriodEnd) {
            await this.end(sub);
            out.ended++;
          } else {
            const r = await this.renew(sub);
            if (r.paid) out.renewed++;
            else out.pastDue++;
          }
        } else if (sub.status === "past_due") {
          if (!this.chargesOn()) continue;
          if (sub.graceEnd !== null && t >= sub.graceEnd) {
            await this.suspend(sub, "unpaid");
            out.suspended++;
          } else if (t >= sub.currentPeriodEnd + sub.attempts * DAY) {
            const r = await this.retry(sub);
            if (r?.paid) out.renewed++;
          }
        }
      } catch {
        // Un fallo en una suscripción no detiene las demás; se reintentará en el siguiente ciclo
      }
    }
    return out;
  }

  // ── Webhooks y conciliación ────────────────────────────────────────────────

  async handleWebhook(rawBody: string, signature: string): Promise<{ processed: boolean; duplicate: boolean }> {
    const ev = this.d.provider.verifyWebhook(rawBody, signature); // lanza invalid_signature
    const first = await this.d.store.recordEvent(ev.id, this.now());
    if (!first) return { processed: false, duplicate: true };
    const inv = await this.d.store.getInvoice(ev.invoiceId);
    if (!inv) return { processed: false, duplicate: false };
    const sub = await this.d.store.getSubscription(inv.subscriptionId);
    if (ev.type === "payment.succeeded" && inv.status === "open") {
      inv.status = "paid";
      inv.paidAt = ev.at;
      inv.providerChargeId = ev.chargeId;
      await this.d.store.putInvoice(inv);
      if (sub && (sub.status === "past_due" || sub.status === "suspended")) {
        await this.activate(sub, inv.periodStart, inv.periodEnd);
      }
    } else if (ev.type === "payment.failed" && inv.status === "open" && sub) {
      await this.markPastDue(sub);
    }
    return { processed: true, duplicate: false };
  }

  /** Compara los cobros del proveedor con las facturas: devuelve las discrepancias. */
  async reconcile(from: number, to: number) {
    const charges = await this.d.provider.listCharges(from, to);
    const report = {
      unknownInvoice: [] as string[],
      amountMismatch: [] as string[],
      paidAtProviderOpenHere: [] as string[],
      paidHereNoCharge: [] as string[],
    };
    const seen = new Set<string>();
    for (const c of charges) {
      const inv = await this.d.store.getInvoice(c.invoiceId);
      if (!inv) {
        report.unknownInvoice.push(c.chargeId);
        continue;
      }
      seen.add(inv.id);
      if (c.amountCents !== inv.amountCents) report.amountMismatch.push(inv.id);
      if (c.ok && inv.status === "open") report.paidAtProviderOpenHere.push(inv.id);
    }
    for (const sub of await this.d.store.listSubscriptions()) {
      for (const inv of await this.d.store.listInvoices(sub.tenantId)) {
        if (inv.status === "paid" && inv.paidAt && inv.paidAt >= from && inv.paidAt < to && !seen.has(inv.id)) {
          report.paidHereNoCharge.push(inv.id);
        }
      }
    }
    return report;
  }

  // ── Internos ───────────────────────────────────────────────────────────────

  private async mustSub(tenantId: string): Promise<Subscription> {
    const s = await this.d.store.getSubscriptionByTenant(tenantId);
    if (!s) throw new BillingError("not_found", "El tenant no tiene suscripción");
    return s;
  }

  private periodLines(sub: Subscription, plan: Plan): InvoiceLine[] {
    if (plan.priceCents === null) throw new BillingError("no_price", `El plan ${plan.id} no tiene tarifa definida`);
    const lines: InvoiceLine[] = [{ description: `Suscripción ${plan.name}`, amountCents: plan.priceCents }];
    for (const m of sub.modules) {
      const price = this.d.catalog.modules.find((x) => x.moduleId === m && x.interval === plan.interval);
      if (!price || price.priceCents === null) throw new BillingError("no_price", `El módulo ${m} no tiene tarifa definida`);
      lines.push({ description: `Módulo ${m}`, amountCents: price.priceCents });
    }
    return lines;
  }

  private async issueInvoice(sub: Subscription, lines: InvoiceLine[], at: number, periodStart: number, periodEnd: number): Promise<Invoice> {
    const year = new Date(at).getUTCFullYear();
    const inv: Invoice = {
      id: `inv_${this.newId()}`,
      number: await this.d.store.nextInvoiceNumber(year),
      tenantId: sub.tenantId,
      subscriptionId: sub.id,
      status: "open",
      currency: sub.currency,
      amountCents: lines.reduce((a, l) => a + l.amountCents, 0),
      lines,
      issuedAt: at,
      dueAt: at,
      paidAt: null,
      periodStart,
      periodEnd,
      providerChargeId: null,
    };
    await this.d.store.putInvoice(inv);
    return inv;
  }

  /** Cobra la factura (idempotente por factura). Marca pagada si procede. */
  private async collect(sub: Subscription, inv: Invoice): Promise<boolean> {
    if (inv.amountCents === 0) {
      inv.status = "paid";
      inv.paidAt = this.now();
      await this.d.store.putInvoice(inv);
      return true;
    }
    const r = await this.d.provider.charge({
      customerId: sub.providerCustomerId,
      amountCents: inv.amountCents,
      currency: inv.currency,
      idempotencyKey: `charge:${inv.id}:${sub.attempts}`,
      description: `Factura ${inv.number}`,
      invoiceId: inv.id,
    });
    inv.providerChargeId = r.chargeId;
    if (r.ok) {
      inv.status = "paid";
      inv.paidAt = this.now();
    }
    await this.d.store.putInvoice(inv);
    return r.ok;
  }

  private chargesOn(): boolean {
    return this.d.chargesEnabled !== false;
  }

  private async chargePeriod(sub: Subscription, start: number, end: number): Promise<{ subscription: Subscription; invoice: Invoice; paid: boolean; chargesDisabled?: boolean }> {
    const plan = this.plan(sub.pendingPlanId ?? sub.planId);
    const lines = this.periodLines(sub, plan);
    const invoice = await this.issueInvoice(sub, lines, start, start, end);
    if (!this.chargesOn()) {
      // Cobros desactivados: factura abierta, sin cobro y sin cambio de estado
      return { subscription: sub, invoice, paid: false, chargesDisabled: true };
    }
    const paid = await this.collect(sub, invoice);
    if (paid) {
      if (sub.pendingPlanId) {
        sub.planId = sub.pendingPlanId;
        sub.pendingPlanId = null;
        sub.modules = sub.modules.filter((m) => !plan.includedModules.includes(m));
      }
      await this.activate(sub, start, end);
    } else {
      await this.markPastDue(sub);
    }
    return { subscription: sub, invoice, paid };
  }

  private async renew(sub: Subscription) {
    const start = sub.currentPeriodEnd;
    const plan = this.plan(sub.pendingPlanId ?? sub.planId);
    return this.chargePeriod(sub, start, addInterval(start, plan.interval));
  }

  private async retry(sub: Subscription) {
    sub.attempts++;
    const open = (await this.d.store.listInvoices(sub.tenantId)).filter((i) => i.status === "open").sort((a, b) => b.issuedAt - a.issuedAt)[0];
    if (!open) return null;
    const paid = await this.collect(sub, open);
    if (paid) {
      await this.activate(sub, open.periodStart, open.periodEnd);
    } else {
      await this.d.store.putSubscription(sub);
    }
    return { paid };
  }

  private async activate(sub: Subscription, start: number, end: number) {
    const wasSuspended = sub.status === "suspended";
    sub.status = "active";
    sub.currentPeriodStart = start;
    sub.currentPeriodEnd = end;
    sub.trialEnd = null;
    sub.graceEnd = null;
    sub.attempts = 0;
    await this.d.store.putSubscription(sub);
    await this.d.effects.setTenantStatus(sub.tenantId, "active");
    await this.grantAll(sub, new Date(end));
    const plan = this.plan(sub.planId);
    for (const q of plan.quotas) await this.d.effects.setQuota(sub.tenantId, q);
    if (wasSuspended) await this.d.notifier?.notify("reactivated", sub.tenantId);
  }

  private async markPastDue(sub: Subscription) {
    if (sub.status !== "past_due") {
      sub.status = "past_due";
      sub.graceEnd = this.now() + this.d.catalog.graceDays * DAY;
      sub.attempts = 1;
      await this.d.store.putSubscription(sub);
      await this.d.effects.setTenantStatus(sub.tenantId, "grace", "payment_failed");
      await this.d.notifier?.notify("payment_failed", sub.tenantId);
    } else {
      await this.d.store.putSubscription(sub);
    }
  }

  private async suspend(sub: Subscription, reason: string) {
    sub.status = "suspended";
    await this.d.store.putSubscription(sub);
    await this.d.effects.setTenantStatus(sub.tenantId, "suspended", reason);
    for (const m of this.allModules(sub)) await this.d.effects.setModuleStatus(sub.tenantId, m, "suspended");
    await this.d.notifier?.notify("suspended", sub.tenantId);
  }

  private async end(sub: Subscription) {
    sub.status = "ended";
    sub.canceledAt = this.now();
    await this.d.store.putSubscription(sub);
    await this.d.effects.setTenantStatus(sub.tenantId, "archived", "canceled");
    for (const m of this.allModules(sub)) await this.d.effects.revokeModule(sub.tenantId, m);
    await this.d.notifier?.notify("canceled", sub.tenantId);
  }

  private allModules(sub: Subscription): string[] {
    return Array.from(new Set([...this.plan(sub.planId).includedModules, ...sub.modules]));
  }

  private async grantAll(sub: Subscription, until: Date) {
    for (const m of this.allModules(sub)) await this.d.effects.grantModule(sub.tenantId, m, until);
  }
}
