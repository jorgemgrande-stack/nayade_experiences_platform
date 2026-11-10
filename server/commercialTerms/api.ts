/**
 * Condiciones comerciales personalizadas (`/cp/v1/subscriptions/:id/terms…` y `/cp/v1/commercial-terms…`).
 *
 * - Consultar (acuerdos, historial, punto de partida y vista previa): `subscriptions:read`.
 * - Crear, editar, activar, anular, restaurar la tarifa oficial y preparar una contratación: el permiso de precios
 *   personalizados (`requireCustomPricing`, una sola función) y siempre una persona, nunca un token de servicio.
 * - El tenant no tiene ninguna ruta aquí: una empresa no puede modificar sus precios negociados.
 * Nada de esto cobra ni concede o retira licencias.
 */
import express, { type NextFunction, type Request, type Response, type Router } from "express";
import { z } from "zod";
import { getAuth, requireScope } from "../controlPlane/auth";
import { opsLog } from "../_core/ops/log";
import { CONCEPTS } from "./model";
import { CUSTOM_PRICING_SCOPE, canManageCustomPricing, customPricingScopeDefined, requireCustomPricing } from "./permission";
import { TermsError, type CommercialTermsService, type TermsInput } from "./service";

const wrap =
  (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, _next: NextFunction) => {
    fn(req, res).catch((e) => {
      if (e instanceof TermsError) {
        const status = e.code === "not_found" ? 404 : e.code === "invalid_input" ? 400 : 409;
        return void res.status(status).json({ error: e.code, message: e.message, ...(e.details ? { details: e.details } : {}) });
      }
      if (e instanceof z.ZodError) return void res.status(400).json({ error: "invalid_request", message: e.issues.map((i) => `${i.path.join(".") || "cuerpo"}: ${i.message}`).join("; ") });
      opsLog("error", "CommercialTerms", "internal_error", { method: req.method, error: e instanceof Error ? e.name : "error" });
      res.status(500).json({ error: "internal_error", message: "Error interno" });
    });
  };

const id = z.coerce.number().int().positive();
const cents = z.number().int().min(0).max(100_000_000);
const instant = z.number().int().min(0).max(8_640_000_000_000_000);
const longText = z.string().max(5000).nullable().optional();
const reason = z.string().trim().min(5).max(500);
// Estrictos: una partida a medida con clave de producto, activación o capacidad se rechaza aquí (400)
const catalogLine = z
  .object({
    kind: z.literal("catalog"),
    productKey: z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/),
    priceId: z.number().int().positive(),
    quantity: z.number().int().min(1).max(10_000).optional(),
    negotiatedUnitCents: cents.nullable().optional(),
    chargeClass: z.enum(["initial", "extraordinary"]).optional(),
    description: longText,
    conditions: longText,
    startsAt: instant.nullable().optional(),
    endsAt: instant.nullable().optional(),
  })
  .strict();
const customLine = z
  .object({
    kind: z.literal("custom"),
    ref: z.string().regex(/^custom:[a-z0-9-]{1,60}$/).optional(),
    concept: z.enum(CONCEPTS).refine((c) => c !== "core_plan", "un plan Core solo puede ser un producto del catálogo"),
    name: z.string().trim().min(1).max(160),
    description: longText,
    conditions: longText,
    chargeClass: z.enum(["recurring", "initial", "extraordinary"]),
    quantity: z.number().int().min(1).max(10_000).optional(),
    unitCents: cents,
    taxRateBp: z.number().int().min(0).max(10_000),
    startsAt: instant.nullable().optional(),
    endsAt: instant.nullable().optional(),
  })
  .strict();
const adjustment = z
  .object({
    line: z.number().int().min(0).max(59).nullable(),
    type: z.enum(["discount", "surcharge"]),
    mode: z.enum(["percent", "amount"]),
    value: z.number().int().min(1).max(100_000_000),
    recurrence: z.enum(["recurring", "once"]),
    endsAt: instant.nullable().optional(),
    note: z.string().max(200).nullable().optional(),
  })
  .strict();
const termsShape = {
  pricingMode: z.enum(["per_item", "global"]),
  globalAmountCents: cents.nullable().optional(),
  presentation: z.enum(["global", "breakdown"]),
  packageName: z.string().max(160).nullable().optional(),
  conditions: longText,
  effectiveFrom: instant.nullable().optional(),
  effectiveTo: instant.nullable().optional(),
  afterEnd: z.enum(["official_snapshot", "official_current", "next_terms"]).nullable().optional(),
  nextTermsId: z.number().int().positive().nullable().optional(),
  requiresAcceptance: z.boolean().optional(),
  interval: z.enum(["month", "year"]).optional(),
  lines: z.array(z.discriminatedUnion("kind", [catalogLine, customLine])).min(1).max(60),
  adjustments: z.array(adjustment).max(60).optional(),
  reason,
};
const termsInput = z.object(termsShape).strict();
const revision = z.number().int().min(1);

export function createCommercialTermsRouter(svc: CommercialTermsService, hooks: { /** Antes de anular unas condiciones con contrato: comprueba la revisión, revoca el enlace y cancela su contrato. */ release?: (id: number, input: { reason: string; expectedRevision: number }, actor: string) => Promise<{ revision: number }> } = {}): Router {
  const r = express.Router();
  const who = (req: Request) => `${getAuth(req)!.actor.type}:${getAuth(req)!.actor.id}`;
  const manage = requireCustomPricing();
  const read = requireScope("subscriptions:read");

  // Qué puede hacer quien pregunta (para la interfaz; el servidor vuelve a comprobarlo en cada operación)
  r.get("/commercial-terms/access", read, wrap(async (req, res) => {
    const auth = getAuth(req)!;
    res.json({ canManage: auth.actor.type === "operator" && canManageCustomPricing(auth.scopes as ReadonlySet<string>), scope: CUSTOM_PRICING_SCOPE, provisionalRule: !customPricingScopeDefined() });
  }));

  r.get("/subscriptions/:id/terms", read, wrap(async (req, res) => {
    res.json(await svc.ofSubscription(id.parse(req.params.id)));
  }));
  r.get("/subscriptions/:id/terms/base", read, wrap(async (req, res) => void res.json(await svc.base(id.parse(req.params.id)))));
  r.post("/subscriptions/:id/terms", manage, wrap(async (req, res) => {
    const b = termsInput.parse(req.body);
    res.status(201).json({ terms: await svc.createForSubscription(id.parse(req.params.id), b as TermsInput, who(req)) });
  }));
  r.post("/subscriptions/:id/terms/restore-official", manage, wrap(async (req, res) => {
    const b = z.object({ effectiveFrom: instant.nullable().optional(), reason, expectedVersion: revision }).strict().parse(req.body);
    res.json(await svc.restoreOfficial(id.parse(req.params.id), b, who(req)));
  }));

  r.get("/commercial-terms", read, wrap(async (req, res) => {
    const q = z.object({ companyId: z.coerce.number().int().positive() }).parse(req.query);
    res.json(await svc.ofCompany(q.companyId));
  }));
  // Paquete personalizado para una contratación nueva (todavía sin suscripción)
  r.post("/commercial-terms/packages", manage, wrap(async (req, res) => {
    const b = z.object({ ...termsShape, companyId: z.number().int().positive(), currency: z.string().regex(/^[A-Za-z]{3}$/).optional() }).strict().parse(req.body);
    const { companyId, ...input } = b;
    res.status(201).json({ terms: await svc.createPackage(companyId, input as TermsInput, who(req)) });
  }));
  r.get("/commercial-terms/:id", read, wrap(async (req, res) => void res.json(await svc.detail(id.parse(req.params.id)))));
  r.get("/commercial-terms/:id/preview", read, wrap(async (req, res) => void res.json(await svc.preview(id.parse(req.params.id)))));
  r.put("/commercial-terms/:id", manage, wrap(async (req, res) => {
    const b = z.object({ ...termsShape, currency: z.string().regex(/^[A-Za-z]{3}$/).optional(), expectedRevision: revision }).strict().parse(req.body);
    const { expectedRevision, ...input } = b;
    res.json({ terms: await svc.updateDraft(id.parse(req.params.id), input as TermsInput, expectedRevision, who(req)) });
  }));
  r.post("/commercial-terms/:id/activate", manage, wrap(async (req, res) => {
    const b = z.object({ expectedRevision: revision, expectedVersion: revision, reason: reason.nullable().optional() }).strict().parse(req.body);
    res.json(await svc.activate(id.parse(req.params.id), b, who(req)));
  }));
  r.post("/commercial-terms/:id/cancel", manage, wrap(async (req, res) => {
    const b = z.object({ reason, expectedRevision: revision }).strict().parse(req.body);
    const tid = id.parse(req.params.id);
    const released = hooks.release && (await svc.must(tid)).contractId !== null ? await hooks.release(tid, b, who(req)) : null;
    res.json({ terms: await svc.cancelDraft(tid, b, released ? released.revision : b.expectedRevision, who(req)) });
  }));
  r.post("/commercial-terms/:id/prepare-contracting", manage, wrap(async (req, res) => {
    const b = z.object({ expectedRevision: revision, trialDays: z.number().int().min(0).max(60).optional(), reason: reason.nullable().optional() }).strict().parse(req.body);
    res.json(await svc.prepareContracting(id.parse(req.params.id), b, who(req)));
  }));
  return r;
}
