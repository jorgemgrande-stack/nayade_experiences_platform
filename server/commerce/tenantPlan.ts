/**
 * «Mi plan» de una empresa (solo lectura): lo que tiene contratado, cuánto cuesta, cuándo renueva, el estado del
 * cobro y sus facturas. Lo pide el Core con su token de comercio para el tenant de la sesión; nunca expone datos de
 * otra empresa (la factura se comprueba contra la empresa del tenant).
 *
 * Fuente de verdad: el pedido vigente del orquestador (plan, periodicidad, partidas e importe cotizado) y su
 * suscripción interna (periodo, renovación, baja). Stripe solo aporta el estado del cobro si la suscripción se
 * cobra allí; sin pedido (prueba o alta asistida), contrato = null y el panel muestra la licencia.
 */
import express, { type Request, type Response, type Router } from "express";
import { z } from "zod";
import { requireScope } from "../controlPlane/auth";
import type { CommercialOrder } from "../orchestrator/types";
import type { Subscription as SubscriptionRecord } from "../subscriptions/types";
import type { Invoice } from "../invoicing/types";

/** Estados de un pedido con contrato en curso (de más a menos preferente). */
const LIVE_STATES = ["active", "past_due", "cancel_scheduled", "suspended", "licensed", "subscribed", "confirmed", "contracted"] as const;

export interface TenantPlanDeps {
  companyOfTenant(tenantId: string): Promise<{ id: number; name: string } | null>;
  orders(companyId: number): Promise<CommercialOrder[]>;
  subscription(id: number): Promise<SubscriptionRecord | null>;
  invoices?(companyId: number): Promise<Invoice[]>;
  invoiceHtml?(inv: Invoice): string;
  /** Estado del cobro en Stripe, si la empresa se cobra allí. */
  stripeStatus?(companyId: number): Promise<{ status: string; cancelAtPeriodEnd: boolean } | null>;
  billingPortalEnabled: boolean;
}

export interface TenantPlanSummary {
  company: { name: string };
  contract: {
    orderId: number;
    reference: string | null;
    state: CommercialOrder["state"];
    plan: string;
    interval: "month" | "year";
    items: string[];
    /** Importe recurrente sin IVA del periodo (mensual, o anual en un plan anual). null si el pedido no se cotizó. */
    recurringNetCents: number | null;
    currency: string;
    graceEndsAt: number | null;
  } | null;
  period: { start: number; end: number; renewsAt: number | null; cancelAt: number | null; trialEnd: number | null; status: SubscriptionRecord["status"] } | null;
  billing: { provider: "stripe" | "manual" | "none"; status: string | null; cancelAtPeriodEnd: boolean; portal: boolean };
  invoices: Array<{ id: number; number: string | null; issueDate: string | null; periodLabel: string | null; totalCents: number; currency: string; paymentStatus: Invoice["paymentStatus"]; kind: Invoice["kind"] }>;
}

export class TenantPlanError extends Error {
  constructor(
    readonly code: "invalid_input" | "not_found",
    message: string,
  ) {
    super(message);
  }
}

const TENANT_RE = /^[a-z0-9][a-z0-9-]{1,62}$/;

export class TenantPlanService {
  constructor(private d: TenantPlanDeps) {}

  private async company(tenantId: string) {
    if (!TENANT_RE.test(tenantId)) throw new TenantPlanError("invalid_input", "Empresa no válida");
    const c = await this.d.companyOfTenant(tenantId);
    if (!c) throw new TenantPlanError("not_found", "Empresa no encontrada");
    return c;
  }

  /** Pedido con contrato en curso del tenant (el más reciente del estado más relevante). */
  static currentOrder(orders: CommercialOrder[], tenantId: string): CommercialOrder | null {
    for (const s of LIVE_STATES) {
      const hit = orders.filter((o) => o.state === s && o.tenantId === tenantId).sort((a, b) => b.id - a.id)[0];
      if (hit) return hit;
    }
    return null;
  }

  async summary(tenantId: string): Promise<TenantPlanSummary> {
    const company = await this.company(tenantId);
    const order = TenantPlanService.currentOrder(await this.d.orders(company.id), tenantId);
    const sub = order?.subscriptionId ? await this.d.subscription(order.subscriptionId) : null;
    const stripe = order && this.d.stripeStatus ? await this.d.stripeStatus(company.id).catch(() => null) : null;
    const invoices = this.d.invoices ? (await this.d.invoices(company.id)).filter((i) => i.status !== "draft") : [];
    const cancelAt = sub?.cancelAt ?? null;
    return {
      company: { name: company.name },
      contract: order
        ? {
            orderId: order.id,
            reference: order.reference,
            state: order.state,
            plan: order.request.plan,
            interval: order.request.interval,
            items: order.request.items.map((i) => i.key),
            recurringNetCents: order.quote?.contractAmountCents ?? null,
            currency: order.quote?.currency ?? sub?.currency ?? "EUR",
            graceEndsAt: order.graceEndsAt,
          }
        : null,
      period: sub
        ? { start: sub.currentPeriodStart, end: sub.currentPeriodEnd, renewsAt: cancelAt || sub.status === "canceled" ? null : sub.currentPeriodEnd, cancelAt, trialEnd: sub.trialEnd, status: sub.status }
        : null,
      billing: {
        provider: stripe ? "stripe" : order ? "manual" : "none",
        status: stripe?.status ?? null,
        cancelAtPeriodEnd: stripe?.cancelAtPeriodEnd ?? !!cancelAt,
        portal: !!stripe && this.d.billingPortalEnabled,
      },
      invoices: invoices
        .sort((a, b) => b.id - a.id)
        .slice(0, 24)
        .map((i) => ({ id: i.id, number: i.number, issueDate: i.issueDate, periodLabel: i.periodLabel, totalCents: i.totalCents, currency: i.currency, paymentStatus: i.paymentStatus, kind: i.kind })),
    };
  }

  /** Documento imprimible de una factura EXPEDIDA de la propia empresa (cualquier otra: no encontrada). */
  async invoiceDocument(tenantId: string, invoiceId: number): Promise<string> {
    const company = await this.company(tenantId);
    const inv = this.d.invoices ? (await this.d.invoices(company.id)).find((i) => i.id === invoiceId && i.status !== "draft") : undefined;
    if (!inv || inv.companyId !== company.id || !this.d.invoiceHtml) throw new TenantPlanError("not_found", "Factura no encontrada");
    return this.d.invoiceHtml(inv);
  }
}

/** Rutas para el Core (token de comercio, tenant de la sesión). */
export function createTenantPlanRouter(svc: TenantPlanService): Router {
  const r = express.Router();
  const wrap = (fn: (req: Request, res: Response) => Promise<void>) => (req: Request, res: Response) =>
    fn(req, res).catch((e) => {
      if (e instanceof TenantPlanError) return void res.status(e.code === "not_found" ? 404 : 400).json({ error: e.code, message: e.message });
      res.status(500).json({ error: "internal_error", message: "Error interno" });
    });
  r.get("/tenants/:tenantId/plan", requireScope("commerce:purchase"), wrap(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json({ plan: await svc.summary(String(req.params.tenantId)) });
  }));
  // Como JSON: el panel lo muestra en un iframe aislado (sandbox, sin scripts)
  r.get("/tenants/:tenantId/invoices/:id/document", requireScope("commerce:purchase"), wrap(async (req, res) => {
    const id = z.coerce.number().int().positive().safeParse(req.params.id);
    if (!id.success) return void res.status(400).json({ error: "invalid_input", message: "Factura no válida" });
    res.setHeader("Cache-Control", "no-store");
    res.json({ html: await svc.invoiceDocument(String(req.params.tenantId), id.data) });
  }));
  return r;
}
