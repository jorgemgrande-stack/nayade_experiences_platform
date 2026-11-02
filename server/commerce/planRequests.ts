/**
 * Solicitudes comerciales de PLAN desde la página Suscripción del panel de cada empresa
 * (`/cp/v1/commerce/tenants/:t/plan-requests`), llamadas por el servidor del Core con la empresa y la persona de la
 * sesión. Cubren lo que no se completa en línea: contratar un plan con contratación asistida, ampliar o cambiar de plan
 * cuando el autoservicio no lo ofrece.
 *
 * Reutiliza el CRM central, sin tablas nuevas:
 *  - Empresa ya registrada en el CRM (lo normal: toda empresa con plataforma tiene ficha): OPORTUNIDAD comercial de
 *    la empresa, con el plan solicitado (`planId`), próxima acción para el equipo y una nota con el detalle (empresa,
 *    plataforma, plan actual, plan solicitado, persona y fecha). El título lleva el origen «Suscripción — Elephant Core».
 *  - Sin ficha de empresa: SOLICITUD web del CRM (lead + «Configuración» con el plan), con su aviso al equipo.
 *
 * Sin duplicados: una oportunidad ABIERTA de este origen para el mismo plan se reutiliza (se anota la repetición);
 * la solicitud web usa su idempotencia y su ventana de repetidos. Nada toca Stripe, precios ni la suscripción.
 *
 * Aislamiento: la empresa sale del token del Core y de la ruta; la consulta solo devuelve las solicitudes de ESA empresa.
 * Ámbito: `commerce:support` o `commerce:purchase` (el token del Core).
 */
import express, { type NextFunction, type Request, type Response, type Router } from "express";
import { z } from "zod";
import { getAuth } from "../controlPlane/auth";
import { opsLog } from "../_core/ops/log";
import { quoteCatalogFromSite } from "../catalog/snapshot";
import type { SiteDocument } from "../web/service";
import type { WebRequestService } from "../crm/webRequests";
import type { CrmService } from "../crm/service";
import type { CrmStore } from "../crm/store";
import type { Opportunity, OpportunityStage } from "../crm/types";
import { panelIdempotencyKey } from "./panelRequests";

export const PLAN_REQUEST_ORIGIN = "Suscripción — Elephant Core";
export const PLAN_REQUEST_SOURCE = "panel:/admin/suscripcion";
const AUTHOR = "panel:suscripcion";

export type PlanRequestKind = "contract" | "upgrade" | "change";
const KIND_LABEL: Record<PlanRequestKind, string> = { contract: "Contratación", upgrade: "Ampliación", change: "Cambio" };

const tenant = z.string().regex(/^[a-z0-9][a-z0-9-]{1,62}$/);
const planKey = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/);
export const planRequestBody = z
  .object({
    plan: planKey,
    kind: z.enum(["contract", "upgrade", "change"]),
    currentPlan: planKey.nullable(),
    /** La prueba gratuita no es un plan de pago: se indica aparte. */
    trial: z.boolean(),
    message: z.string().trim().max(2000).optional(),
    requester: z.object({ name: z.string().trim().min(1).max(160), email: z.string().trim().toLowerCase().email().max(200), userId: z.string().max(64).optional() }).strict(),
    idempotencyKey: z.string().regex(/^[A-Za-z0-9_-]{8,80}$/),
  })
  .strict();
export type PlanRequestBody = z.infer<typeof planRequestBody>;

/** Estado que ve el cliente (sin detalles internos del embudo). */
export type PlanRequestStatus = "received" | "in_progress" | "completed" | "closed";
export interface PlanRequestView {
  reference: string;
  plan: string;
  planName: string;
  status: PlanRequestStatus;
  createdAt: number;
  updatedAt: number | null;
}

export class PlanRequestError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

const OPEN: ReadonlySet<OpportunityStage> = new Set<OpportunityStage>(["prospecting", "contacted", "qualification", "demo", "proposal", "negotiation"]);
export const statusOfStage = (s: OpportunityStage): PlanRequestStatus => (s === "prospecting" ? "received" : s === "won" ? "completed" : s === "lost" ? "closed" : "in_progress");
const requestStatus = (s: string): PlanRequestStatus => (s === "pending" ? "received" : s === "attended" ? "in_progress" : "closed");

const titleFor = (kind: PlanRequestKind, planName: string) => `${PLAN_REQUEST_ORIGIN}: ${KIND_LABEL[kind]} de ${planName}`;
const isOurs = (o: Opportunity) => o.title.startsWith(`${PLAN_REQUEST_ORIGIN}:`);
export const opportunityReference = (id: number) => `OP-${id}`;

function publishedPlans(site: SiteDocument): Map<string, string> {
  return new Map(
    quoteCatalogFromSite(site)
      .products.filter((p) => p.family === "core_plan" && p.commercialStatus !== "unpublished")
      .map((p) => [p.key, p.name]),
  );
}

type Deps = { site: SiteDocument; crm: CrmService; store: CrmStore; requests: WebRequestService; now?: () => number };

const companyOf = async (store: CrmStore, tenantId: string) => (await store.list("companies", {}, { desc: true, limit: 5000 })).find((c) => c.tenantId === tenantId) ?? null;

/** Una por empresa a la vez: dos clics seguidos no crean dos oportunidades. */
const locks = new Map<string, Promise<unknown>>();
async function serialized<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(key) ?? Promise.resolve();
  const run = prev.catch(() => undefined).then(fn);
  locks.set(key, run);
  try {
    return await run;
  } finally {
    if (locks.get(key) === run) locks.delete(key);
  }
}

export async function receivePlanRequest(d: Deps, tenantId: string, b: PlanRequestBody): Promise<{ outcome: "created" | "duplicate" | "replayed"; request: PlanRequestView }> {
  const plans = publishedPlans(d.site);
  const planName = plans.get(b.plan);
  if (!planName) throw new PlanRequestError(404, "not_found", "Ese plan no está en el catálogo");
  if (!b.trial && b.currentPlan === b.plan) throw new PlanRequestError(409, "invalid_state", "Ya tienes ese plan");
  const now = (d.now ?? Date.now)();
  const currentName = b.trial ? `Prueba gratuita${b.currentPlan ? ` de ${plans.get(b.currentPlan) ?? b.currentPlan}` : ""}` : b.currentPlan ? (plans.get(b.currentPlan) ?? b.currentPlan) : "sin plan";
  const company = await companyOf(d.store, tenantId);
  const detail = [
    `${KIND_LABEL[b.kind]} de plan solicitada desde ${PLAN_REQUEST_ORIGIN}.`,
    `Empresa: ${company?.name ?? tenantId} (plataforma ${tenantId}).`,
    `Plan actual: ${currentName}. Plan solicitado: ${planName}.`,
    `Solicitado por: ${b.requester.name} <${b.requester.email}>${b.requester.userId ? ` (usuario ${b.requester.userId})` : ""}.`,
    `Fecha: ${new Date(now).toISOString().slice(0, 16).replace("T", " ")} UTC.`,
    b.message ? `Mensaje: ${b.message}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  if (company) {
    return serialized(`plan:${tenantId}`, async () => {
      const open = (await d.store.list("opportunities", { companyId: company.id }, { desc: true, limit: 500 })).find((o) => isOurs(o) && o.planId === b.plan && OPEN.has(o.stage));
      if (open) {
        await d.crm.log("opportunity", open.id, "note", `Solicitud repetida desde ${PLAN_REQUEST_ORIGIN}; no se ha duplicado.\n${detail}`, AUTHOR);
        return { outcome: "duplicate" as const, request: { reference: opportunityReference(open.id), plan: b.plan, planName, status: statusOfStage(open.stage), createdAt: open.createdAt, updatedAt: open.updatedAt } };
      }
      const o = await d.crm.createOpportunity({ companyId: company.id, title: titleFor(b.kind, planName), planId: b.plan, nextAction: `Contactar con ${b.requester.name} (${b.requester.email}) por la solicitud de ${planName}`, nextActionAt: now }, AUTHOR);
      await d.crm.log("opportunity", o.id, "note", detail, AUTHOR);
      return { outcome: "created" as const, request: { reference: opportunityReference(o.id), plan: b.plan, planName, status: statusOfStage(o.stage), createdAt: o.createdAt, updatedAt: o.updatedAt } };
    });
  }

  // Sin ficha de empresa en el CRM: solicitud comercial (lead) con el plan en su configuración
  const { outcome, request } = await d.requests.receive(
    {
      type: "configuration",
      name: b.requester.name,
      email: b.requester.email,
      company: tenantId,
      message: detail,
      configuration: { plan: b.plan, extensions: [], industries: [], interests: [] },
      sourcePage: PLAN_REQUEST_SOURCE,
      marketingConsent: false,
      privacyVersion: "panel-cliente",
    },
    { idempotencyKey: panelIdempotencyKey(tenantId, `plan-${b.idempotencyKey}`), ipHash: null },
  );
  return { outcome, request: { reference: request.reference, plan: b.plan, planName, status: requestStatus(request.status), createdAt: request.createdAt, updatedAt: request.attendedAt } };
}

/** Solicitudes de plan de ESTA empresa (las más recientes primero). */
export async function listPlanRequests(d: Pick<Deps, "site" | "store">, tenantId: string): Promise<PlanRequestView[]> {
  const plans = publishedPlans(d.site);
  const company = await companyOf(d.store, tenantId);
  if (!company) return [];
  const opps = (await d.store.list("opportunities", { companyId: company.id }, { desc: true, limit: 500 })).filter(isOurs);
  return opps.slice(0, 20).map((o) => ({ reference: opportunityReference(o.id), plan: o.planId ?? "", planName: (o.planId && plans.get(o.planId)) || o.planId || "", status: statusOfStage(o.stage), createdAt: o.createdAt, updatedAt: o.updatedAt }));
}

function requireCore(req: Request, res: Response, next: NextFunction) {
  const scopes = getAuth(req)?.scopes;
  if (!scopes || !(scopes.has("commerce:support") || scopes.has("commerce:purchase"))) return void res.status(403).json({ error: "forbidden", scope: "commerce:support" });
  next();
}

/** Rutas del Core (montar bajo /commerce). */
export function createPlanRequestsRouter(d: { site: () => Promise<SiteDocument>; crm: CrmService; store: CrmStore; requests: WebRequestService }): Router {
  const r = express.Router();
  const fail = (res: Response, e: unknown) => {
    if (e instanceof PlanRequestError) return void res.status(e.status).json({ error: e.code, message: e.message });
    opsLog("error", "Commerce", "plan_request_failed", { error: e instanceof Error ? e.name : "error" });
    res.status(500).json({ error: "internal_error", message: "Error interno" });
  };
  r.post("/tenants/:tenantId/plan-requests", requireCore, (req: Request, res: Response) => {
    res.setHeader("Cache-Control", "no-store");
    const t = tenant.safeParse(req.params.tenantId);
    const b = planRequestBody.safeParse(req.body);
    if (!t.success || !b.success) return void res.status(400).json({ error: "invalid_request", message: b.success ? "tenantId" : b.error.issues.map((i) => i.path.join(".") || i.message).join(", ") });
    d.site()
      .then((site) => receivePlanRequest({ site, crm: d.crm, store: d.store, requests: d.requests }, t.data, b.data))
      .then((x) => void res.status(x.outcome === "created" ? 201 : 200).json(x))
      .catch((e) => fail(res, e));
  });
  r.get("/tenants/:tenantId/plan-requests", requireCore, (req: Request, res: Response) => {
    res.setHeader("Cache-Control", "no-store");
    const t = tenant.safeParse(req.params.tenantId);
    if (!t.success) return void res.status(400).json({ error: "invalid_request", message: "tenantId" });
    d.site()
      .then((site) => listPlanRequests({ site, store: d.store }, t.data))
      .then((requests) => void res.json({ requests }))
      .catch((e) => fail(res, e));
  });
  return r;
}
