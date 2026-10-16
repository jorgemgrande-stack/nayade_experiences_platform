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
  r.get("/site", requireScope("web:read"), wrap(async (req, res) => {
    const q = z.object({ mode: z.enum(["published", "preview"]).default("published") }).parse(req.query);
    res.json(await svc.site(q.mode));
  }));

  return r;
}
