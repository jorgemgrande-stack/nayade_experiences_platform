/**
 * Administración → Web comercial (`/cp/v1/web/*`): catálogo comercial, precios y contenidos.
 * Ámbitos: `web:read` (consultar), `web:write` (editar borradores y crear precios en borrador),
 * `web:publish` (publicar, despublicar, aprobar y retirar precios). Toda escritura queda auditada.
 */
import express, { type NextFunction, type Request, type Response, type Router } from "express";
import { z } from "zod";
import { getAuth, requireScope } from "../controlPlane/auth";
import { ENTRY_KINDS, FAMILIES, PRICE_KINDS, type EntryKind, type PriceKind } from "./schemas";
import { WebError, type WebAdminService } from "./service";
import { issuePreviewToken } from "./publicSite";
import { commercialQuote, previewPlanChange, quoteResponse, recommendPlan } from "../catalog/commercial/commercialQuote";
import { isNeutral } from "../catalog/commercial/fromCatalog";
import { pendingRules } from "../catalog/commercial/policy";
import { netSimulations } from "../catalog/commercial/netSimulations";
import { parseQuoteRequest } from "../catalog/request";
import { quoteCatalogFromSite } from "../catalog/snapshot";

const wrap =
  (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, _next: NextFunction) => {
    fn(req, res).catch((e) => {
      if (e instanceof WebError) {
        const status = e.code === "not_found" ? 404 : e.code === "invalid_input" ? 400 : 409;
        return void res.status(status).json({ error: e.code, message: e.message, ...(e.details ? { details: e.details } : {}) });
      }
      if (e instanceof z.ZodError) return void res.status(400).json({ error: "invalid_request", message: e.issues.map((i) => i.path.join(".") || i.message).join(", ") });
      console.error("[Web] error interno:", e instanceof Error ? e.name : "error");
      res.status(500).json({ error: "internal_error", message: "Error interno" });
    });
  };

const kindParam = z.enum(ENTRY_KINDS);
const keyParam = z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/);
const id = z.coerce.number().int().positive();
const version = z.number().int().min(1);

export function createWebAdminRouter(svc: WebAdminService, opts: { previewSecret?: string; refs: () => Promise<Record<string, unknown>> }): Router {
  const r = express.Router();
  const who = (req: Request) => `${getAuth(req)!.actor.type}:${getAuth(req)!.actor.id}`;
  const target = (req: Request) => ({ kind: kindParam.parse(req.params.kind) as EntryKind, key: keyParam.parse(req.params.key) });

  r.get("/overview", requireScope("web:read"), wrap(async (_req, res) => void res.json(await svc.overview())));
  r.get("/refs", requireScope("web:read"), wrap(async (_req, res) => void res.json(await opts.refs())));
  r.get("/events", requireScope("web:read"), wrap(async (req, res) => {
    const q = z.object({ entity: z.string().max(20).optional(), key: z.string().max(120).optional(), limit: z.coerce.number().int().min(1).max(500).default(100) }).parse(req.query);
    res.json({ events: await svc.events(q) });
  }));
  r.get("/entries", requireScope("web:read"), wrap(async (req, res) => {
    const q = z.object({ kind: kindParam.optional() }).parse(req.query);
    res.json({ entries: await svc.list(q.kind as EntryKind | undefined) });
  }));
  r.post("/entries", requireScope("web:write"), wrap(async (req, res) => {
    const b = z
      .object({ kind: kindParam, key: keyParam, family: z.enum(FAMILIES).nullable().optional(), sortOrder: z.number().int().min(-10000).max(10000).optional(), draft: z.unknown() })
      .strict()
      .parse(req.body);
    res.status(201).json({ entry: await svc.create(b as Parameters<WebAdminService["create"]>[0], who(req)) });
  }));
  r.get("/entries/:kind/:key", requireScope("web:read"), wrap(async (req, res) => {
    const t = target(req);
    res.json(await svc.get(t.kind, t.key));
  }));
  r.patch("/entries/:kind/:key", requireScope("web:write"), wrap(async (req, res) => {
    const t = target(req);
    const b = z.object({ draft: z.unknown(), sortOrder: z.number().int().min(-10000).max(10000).optional(), expectedVersion: version }).strict().parse(req.body);
    res.json({ entry: await svc.save(t.kind, t.key, b, who(req)) });
  }));
  r.post("/entries/:kind/:key/restore", requireScope("web:write"), wrap(async (req, res) => {
    const t = target(req);
    const b = z.object({ version }).strict().parse(req.body);
    res.json({ entry: await svc.restore(t.kind, t.key, b.version, who(req)) });
  }));
  r.post("/entries/:kind/:key/publish", requireScope("web:publish"), wrap(async (req, res) => {
    const t = target(req);
    const b = z.object({ expectedVersion: version }).strict().parse(req.body);
    res.json({ entry: await svc.publish(t.kind, t.key, b.expectedVersion, who(req)) });
  }));
  r.post("/entries/:kind/:key/unpublish", requireScope("web:publish"), wrap(async (req, res) => {
    const t = target(req);
    res.json({ entry: await svc.unpublish(t.kind, t.key, who(req)) });
  }));

  // ── Precios ──
  r.post("/entries/product/:key/prices", requireScope("web:write"), wrap(async (req, res) => {
    const key = keyParam.parse(req.params.key);
    const b = z
      .object({
        kind: z.enum(PRICE_KINDS),
        amountCents: z.number().int().min(0).max(1_000_000_000),
        currency: z.string().length(3).optional(),
        unit: z.string().max(40).nullable().optional(),
        taxRateBp: z.number().int().min(0).max(10_000),
        taxIncluded: z.boolean().optional(),
        note: z.string().max(300).nullable().optional(),
      })
      .strict()
      .parse(req.body);
    res.status(201).json({ price: await svc.addPrice(key, { ...b, kind: b.kind as PriceKind }, who(req)) });
  }));
  r.post("/prices/:id/approve", requireScope("web:publish"), wrap(async (req, res) => void res.json({ price: await svc.approvePrice(id.parse(req.params.id), who(req)) })));
  r.post("/prices/:id/retire", requireScope("web:publish"), wrap(async (req, res) => void res.json({ price: await svc.retirePrice(id.parse(req.params.id), who(req)) })));
  r.delete("/prices/:id", requireScope("web:write"), wrap(async (req, res) => {
    await svc.deletePrice(id.parse(req.params.id), who(req));
    res.status(204).end();
  }));

  // ── Vista previa: enlace temporal que muestra los borradores en la web ──
  r.post("/preview-token", requireScope("web:write"), wrap(async (req, res) => {
    if (!opts.previewSecret) throw new WebError("invalid_state", "La vista previa necesita la API pública configurada (CP_PUBLIC_FORM_SECRET)");
    const t = issuePreviewToken(opts.previewSecret, Date.now());
    await svc.recordPreview(who(req), t.expiresAt);
    res.status(201).json(t);
  }));

  // ── Sitio tal y como lo vería la web (publicado o vista previa), para la consola ──
  // Catálogo de Elephant Source para el CRM (lo publicado, en el formato del cotizador) y cotización
  // de propuestas: el mismo cálculo que la web, admitiendo lo ya contratado («owned»).
  r.get("/catalog", requireScope("web:read"), wrap(async (_req, res) => {
    const site = await svc.site("published");
    res.json({ catalog: quoteCatalogFromSite(site), capabilities: site.catalog.capabilities });
  }));
  // Propuestas del CRM: SIEMPRE con lo publicado y solo con las reglas comerciales aprobadas. Sin reglas aprobadas,
  // el resultado es idéntico al cotizador del catálogo (mismos importes); `commercial` trae el desglose completo.
  r.post("/quote", requireScope("web:read"), wrap(async (req, res) => {
    const parsed = parseQuoteRequest(req.body, { allowOwned: true });
    if (!parsed.ok) return void res.status(400).json({ error: "invalid_input", message: parsed.message });
    const { catalog, policy } = await svc.commercialCatalog("published");
    res.json(quoteResponse(catalog, policy, parsed.value));
  }));

  // ── Política comercial: revisión y simulador (nunca crean presupuestos ni cambian nada) ──
  r.get("/commercial/review", requireScope("web:read"), wrap(async (_req, res) => void res.json(await svc.commercialReview())));
  // Simulaciones de las soluciones Elephant Net completas con Core incluido (borradores o lo publicado). Nunca cobra.
  r.get("/commercial/net-simulations", requireScope("web:read"), wrap(async (req, res) => {
    const mode = req.query.policy === "published" ? "published" : "proposed";
    const { catalog, policy } = await svc.commercialCatalog(mode);
    res.json({ policy: mode, policyEnabled: (await svc.commercialReview()).policyEnabled, ...netSimulations(catalog, policy) });
  }));
  r.post("/commercial/simulate", requireScope("web:read"), wrap(async (req, res) => {
    const b = z
      .object({
        /** published: reglas aprobadas (lo que verá el cliente); proposed: borradores con las reglas propuestas. */
        policy: z.enum(["published", "proposed"]).default("published"),
        request: z.unknown(),
        changeTo: z.enum(["essential", "business", "enterprise"]).optional(),
        recommend: z.boolean().optional(),
        fiscalEntities: z.number().int().min(1).max(100).optional(),
      })
      .strict()
      .parse(req.body);
    const parsed = parseQuoteRequest(b.request, { allowOwned: true });
    if (!parsed.ok) return void res.status(400).json({ error: "invalid_input", message: parsed.message });
    const { catalog, policy } = await svc.commercialCatalog(b.policy);
    const { plan: _p, ...needs } = parsed.value;
    res.json({
      mode: b.policy,
      catalogVersion: catalog.version,
      policy: { id: policy.id, neutral: isNeutral(policy), pendingRules: pendingRules(policy) },
      quote: commercialQuote(catalog, policy, parsed.value),
      ...(b.changeTo ? { change: previewPlanChange(catalog, policy, { ...parsed.value, fiscalEntities: b.fiscalEntities ?? parsed.value.fiscalEntities }, b.changeTo) } : {}),
      ...(b.recommend ? { recommendation: recommendPlan(catalog, policy, needs) } : {}),
    });
  }));
  r.get("/site", requireScope("web:read"), wrap(async (req, res) => {
    const q = z.object({ mode: z.enum(["published", "preview"]).default("published") }).parse(req.query);
    res.json(await svc.site(q.mode));
  }));
  // Carrusel y ajustes del marketplace del panel (vista previa: borradores sin filtro de fechas)
  r.get("/marketplace", requireScope("web:read"), wrap(async (req, res) => {
    const q = z.object({ mode: z.enum(["published", "preview"]).default("published") }).parse(req.query);
    res.json(await svc.marketplace(q.mode));
  }));

  return r;
}
