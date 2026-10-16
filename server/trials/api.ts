/**
 * Rutas de la prueba gratuita de Essential.
 *
 * Públicas (`/cp/v1/public/trial`): SOLO si se habilitan expresamente (CP_PUBLIC_TRIAL_ENABLED). No
 * revelan si un correo ya tiene prueba (respuesta genérica), con campo trampa y límite por IP.
 *
 * De operador (`/cp/v1/trials`): listado, revisión (vencidas, ampliaciones y avisos debidos),
 * activación (crea plataforma y licencias: exige provisioning:write, subscriptions:write y
 * entitlements:write), vencimiento, ampliación, conversión, rechazo, cancelación y envío explícito de
 * avisos.
 */
import express, { type NextFunction, type Request, type Response, type Router } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { z } from "zod";
import { getAuth, requireScope } from "../controlPlane/auth";
import type { TrialOnboardingService } from "./onboarding";
import { TrialError, TrialService } from "./service";
import type { TrialStore } from "./store";
import { TRIAL_STATES } from "./machine";

const ERR_STATUS: Record<string, number> = { invalid_input: 400, not_found: 404, conflict: 409, invalid_state: 409, limit: 429, forbidden: 403 };
const wrap = (fn: (req: Request, res: Response) => Promise<void>) => (req: Request, res: Response, next: NextFunction) =>
  fn(req, res).catch((e) => {
    if (e instanceof TrialError) return void res.status(ERR_STATUS[e.code] ?? 400).json({ error: e.code, message: e.message });
    if (e instanceof z.ZodError) return void res.status(400).json({ error: "invalid_input", message: e.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") });
    next(e);
  });
const who = (req: Request) => `${getAuth(req)!.actor.type}:${getAuth(req)!.actor.id}`;

export function createPublicTrialRouter(o: { onboarding: TrialOnboardingService; autoProvision: boolean; perIpHour?: number }): Router {
  const r = express.Router();
  r.use(
    rateLimit({
      windowMs: 60 * 60_000,
      limit: o.perIpHour ?? 20,
      standardHeaders: true,
      legacyHeaders: false,
      keyGenerator: (req) => `trial:${ipKeyGenerator(req.ip ?? "")}`,
      handler: (_req, res) => void res.status(429).json({ error: "rate_limited" }),
    }),
  );
  const ACCEPTED = { status: "pending_verification", message: "Si los datos son correctos, recibirás un correo para verificar la dirección y empezar la prueba." };
  r.post(
    "/",
    wrap(async (req, res) => {
      res.setHeader("Cache-Control", "no-store");
      const b = z
        .object({ email: z.string().max(254), companyName: z.string().max(160), idempotencyKey: z.string().max(80), website: z.string().max(200).optional() })
        .strict()
        .parse(req.body);
      // Campo trampa: los robots lo rellenan; se responde igual que a una persona, sin crear nada
      if (b.website) return void res.status(202).json(ACCEPTED);
      try {
        await o.onboarding.register({ email: b.email, companyName: b.companyName, idempotencyKey: b.idempotencyKey, ip: req.ip ?? null });
      } catch (e) {
        // No se revela si el correo ya tiene una prueba en curso
        if (e instanceof TrialError && e.code === "conflict") return void res.status(202).json(ACCEPTED);
        throw e;
      }
      res.status(202).json(ACCEPTED);
    }),
  );
  r.post(
    "/verify",
    wrap(async (req, res) => {
      res.setHeader("Cache-Control", "no-store");
      const b = z.object({ id: z.number().int().positive(), token: z.string().min(20).max(100) }).strict().parse(req.body);
      try {
        const out = await o.onboarding.verify(b.id, b.token, { autoProvision: o.autoProvision });
        // Si la activación falló, el correo sigue verificado: se informa sin detalles internos
        res.status(out.activationError ? 202 : 200).json({
          state: out.activation ? out.activation.trial.state : out.trial.state,
          activationPending: !out.activation,
          domain: out.activation?.domain ?? null,
          endsAt: out.activation?.trial.endsAt ?? null,
        });
      } catch (e) {
        // Mismo mensaje para «no existe», «token incorrecto» y «caducado»
        if (e instanceof TrialError && (e.code === "not_found" || e.code === "forbidden" || e.code === "invalid_state")) return void res.status(403).json({ error: "invalid_link", message: "El enlace no es válido o ha caducado" });
        throw e;
      }
    }),
  );
  r.use((_req, res) => void res.status(404).json({ error: "not_found" }));
  return r;
}

export function createTrialAdminRouter(o: { onboarding: TrialOnboardingService; trials: TrialService; store: TrialStore }): Router {
  const r = express.Router();
  const id = z.coerce.number().int().positive();
  const listActive = async () => (await o.store.list({ states: ["active"] })).map((t) => ({ id: t.id, email: t.email, endsAt: t.endsAt }));

  r.get(
    "/",
    requireScope("subscriptions:read"),
    wrap(async (req, res) => {
      const states = z.array(z.enum(TRIAL_STATES)).optional().parse(typeof req.query.state === "string" ? req.query.state.split(",") : undefined);
      res.json({ trials: (await o.store.list({ states, limit: 200 })).map((t) => TrialService.view(t)) });
    }),
  );
  r.get(
    "/review",
    requireScope("subscriptions:read"),
    wrap(async (_req, res) => {
      const [review, notices] = await Promise.all([o.trials.dueForReview(), o.onboarding.noticesDue(listActive)]);
      res.json({ ...review, expired: review.expired.map((t) => TrialService.view(t)), extensionRequests: review.extensionRequests.map((t) => TrialService.view(t)), noticesDue: notices.map((n) => ({ id: n.id, endsAt: n.endsAt, daysLeft: n.daysLeft })) });
    }),
  );
  r.get(
    "/:id",
    requireScope("subscriptions:read"),
    wrap(async (req, res) => void res.json({ trial: TrialService.view(await o.trials.must(id.parse(req.params.id))) })),
  );
  r.post(
    "/:id/activate",
    requireScope("provisioning:write"),
    requireScope("subscriptions:write"),
    requireScope("entitlements:write"),
    wrap(async (req, res) => {
      const out = await o.onboarding.activate(id.parse(req.params.id), who(req));
      res.json({ ...out, trial: TrialService.view(out.trial) });
    }),
  );
  r.post(
    "/:id/expire",
    requireScope("subscriptions:write"),
    wrap(async (req, res) => void res.json({ trial: TrialService.view(await o.onboarding.expire(id.parse(req.params.id), who(req))) })),
  );
  r.post(
    "/:id/extension/approve",
    requireScope("subscriptions:write"),
    wrap(async (req, res) => {
      const b = z.object({ days: z.number().int().min(1).max(30), expectedVersion: z.number().int().min(1) }).strict().parse(req.body);
      res.json({ trial: TrialService.view(await o.trials.approveExtension(id.parse(req.params.id), b.expectedVersion, b.days, who(req))) });
    }),
  );
  r.post(
    "/:id/convert",
    requireScope("subscriptions:write"),
    requireScope("entitlements:write"),
    wrap(async (req, res) => {
      const b = z.object({ plan: z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/).optional() }).strict().parse(req.body ?? {});
      const out = await o.onboarding.convert(id.parse(req.params.id), { plan: b.plan, actor: who(req) });
      res.json({ ...out, trial: TrialService.view(out.trial) });
    }),
  );
  for (const action of ["reject", "cancel"] as const) {
    r.post(
      `/:id/${action}`,
      requireScope("subscriptions:write"),
      wrap(async (req, res) => {
        const b = z.object({ reason: z.string().trim().min(5).max(300), expectedVersion: z.number().int().min(1) }).strict().parse(req.body);
        const tid = id.parse(req.params.id);
        const t = action === "reject" ? await o.trials.reject(tid, b.expectedVersion, b.reason, who(req)) : await o.trials.cancel(tid, b.expectedVersion, b.reason, who(req));
        res.json({ trial: TrialService.view(t) });
      }),
    );
  }
  r.post(
    "/notices/send",
    requireScope("subscriptions:write"),
    wrap(async (_req, res) => {
      const due = await o.onboarding.noticesDue(listActive);
      res.json(await o.onboarding.sendNotices(due));
    }),
  );
  return r;
}
