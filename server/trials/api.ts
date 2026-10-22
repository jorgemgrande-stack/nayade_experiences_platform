/**
 * Rutas de la prueba gratuita de Essential.
 *
 * Públicas (`/cp/v1/public/trial`): SOLO si se habilitan expresamente (CP_PUBLIC_TRIAL_ENABLED). No
 * revelan si un correo ya tiene prueba (respuesta genérica), con campo trampa y límite por IP. Alta,
 * verificación y reenvío del enlace (`/resend`).
 *
 * De operador (`/cp/v1/trials`): listado, revisión (vencidas, ampliaciones y avisos debidos),
 * historial de eventos, activación (crea plataforma y licencias: exige provisioning:write,
 * subscriptions:write y entitlements:write), reenvío del enlace de verificación, vencimiento,
 * ampliación, suspensión y reactivación (con sus licencias), conversión, rechazo, cancelación y envío
 * explícito de avisos.
 */
import express, { type NextFunction, type Request, type Response, type Router } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { z } from "zod";
import { getAuth, requireScope } from "../controlPlane/auth";
import type { TrialOnboardingService } from "./onboarding";
import { TrialError, TrialService } from "./service";
import type { TrialStore } from "./store";
import { TRIAL_STATES } from "./machine";
import { opsLog } from "../_core/ops/log";
import { APPROVAL_CATEGORIES, OrderError, type ApprovalCategory } from "../orchestrator/types";

/**
 * Conversión de una prueba a pago por EXCEPCIÓN administrativa: la hace el orquestador con un pedido de
 * conversión confirmado por aprobación tipificada (categoría, motivo y, si es un cobro fuera de Stripe, su
 * referencia). Sin orquestador no hay conversión por esta vía: se usa POST /orders con el cobro.
 */
export type TrialExceptionConversion = (trialId: number, input: { category: ApprovalCategory; reason: string; reference?: string; plan?: string; interval?: "month" | "year" }, actor: string) => Promise<{ order: unknown; trial: unknown; error: string | null }>;

const ERR_STATUS: Record<string, number> = { invalid_input: 400, not_found: 404, conflict: 409, invalid_state: 409, limit: 429, forbidden: 403, unavailable: 503 };
const wrap = (fn: (req: Request, res: Response) => Promise<void>) => (req: Request, res: Response, next: NextFunction) =>
  fn(req, res).catch((e) => {
    if (e instanceof TrialError || e instanceof OrderError) return void res.status(ERR_STATUS[e.code] ?? 400).json({ error: e.code, message: e.message });
    if (e instanceof z.ZodError) return void res.status(400).json({ error: "invalid_input", message: e.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") });
    next(e);
  });
const who = (req: Request) => `${getAuth(req)!.actor.type}:${getAuth(req)!.actor.id}`;

export function createPublicTrialRouter(o: { onboarding: TrialOnboardingService; autoProvision: boolean; perIpHour?: number; resendPerIpHour?: number }): Router {
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
        // Doble clic o dos pestañas: la otra petición (con el mismo enlace válido, ya comprobado) ganó
        // la carrera. Se informa del estado en curso sin repetir nada.
        if (e instanceof TrialError && e.code === "conflict") {
          const state = await o.onboarding.stateOf(b.id);
          return void res.status(202).json({ state, activationPending: true, domain: null, endsAt: null });
        }
        // Mismo mensaje para «no existe», «token incorrecto» y «caducado»
        if (e instanceof TrialError && (e.code === "not_found" || e.code === "forbidden" || e.code === "invalid_state")) return void res.status(403).json({ error: "invalid_link", message: "El enlace no es válido o ha caducado" });
        throw e;
      }
    }),
  );
  // Reenvío del enlace de verificación: respuesta SIEMPRE igual (no revela si el correo existe, si ya
  // está verificado ni si se ha alcanzado el límite), límite propio por IP además del general.
  const RESEND_ACCEPTED = { status: "accepted", message: "Si hay una solicitud pendiente de verificar con esa dirección, recibirás un enlace nuevo. El anterior deja de funcionar." };
  r.post(
    "/resend",
    rateLimit({
      windowMs: 60 * 60_000,
      limit: o.resendPerIpHour ?? 5,
      standardHeaders: true,
      legacyHeaders: false,
      keyGenerator: (req) => `trial-resend:${ipKeyGenerator(req.ip ?? "")}`,
      handler: (_req, res) => void res.status(429).json({ error: "rate_limited" }),
    }),
    wrap(async (req, res) => {
      res.setHeader("Cache-Control", "no-store");
      const b = z.object({ email: z.string().max(254), website: z.string().max(200).optional() }).strict().parse(req.body);
      // Se responde sin esperar al trabajo: el tiempo de respuesta tampoco revela si el correo existe
      if (!b.website) {
        void o.onboarding.resendVerification({ email: b.email }, "web").catch((e) => opsLog("error", "Trials", "resend_failed", { error: e instanceof Error ? e.name : "error" }));
      }
      res.status(202).json(RESEND_ACCEPTED);
    }),
  );
  r.use((_req, res) => void res.status(404).json({ error: "not_found" }));
  return r;
}

export function createTrialAdminRouter(o: { onboarding: TrialOnboardingService; trials: TrialService; store: TrialStore; convert?: { run?: TrialExceptionConversion } }): Router {
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
    wrap(async (req, res) => {
      const trial = await o.trials.must(id.parse(req.params.id));
      // Historial de la prueba (registro, verificación, activación, prórrogas, caducidad…)
      res.json({ trial: TrialService.view(trial), events: await o.store.events(trial.id) });
    }),
  );
  r.get(
    "/:id/events",
    requireScope("subscriptions:read"),
    wrap(async (req, res) => {
      const t = await o.trials.must(id.parse(req.params.id));
      res.json({ trialId: t.id, state: t.state, events: await o.store.events(t.id) });
    }),
  );
  // Suspender y reactivar cambian también las licencias de la empresa: exigen entitlements:write
  r.post(
    "/:id/suspend",
    requireScope("subscriptions:write"),
    requireScope("entitlements:write"),
    wrap(async (req, res) => {
      const b = z.object({ reason: z.string().trim().min(5).max(300), expectedVersion: z.number().int().min(1) }).strict().parse(req.body);
      res.json({ trial: TrialService.view(await o.onboarding.suspend(id.parse(req.params.id), { reason: b.reason, expectedVersion: b.expectedVersion, actor: who(req) })) });
    }),
  );
  r.post(
    "/:id/reactivate",
    requireScope("subscriptions:write"),
    requireScope("entitlements:write"),
    wrap(async (req, res) => {
      const b = z.object({ expectedVersion: z.number().int().min(1) }).strict().parse(req.body);
      const out = await o.onboarding.reactivate(id.parse(req.params.id), { expectedVersion: b.expectedVersion, actor: who(req) });
      res.json({ trial: TrialService.view(out.trial), licencesChanged: out.licencesChanged });
    }),
  );
  // Alta asistida por operador (beta privada): sin registro público ni correo; devuelve el enlace de acceso
  r.post(
    "/",
    requireScope("provisioning:write"),
    requireScope("subscriptions:write"),
    requireScope("entitlements:write"),
    wrap(async (req, res) => {
      const b = z
        .object({ email: z.string().trim().email().max(254), companyName: z.string().trim().min(2).max(160), idempotencyKey: z.string().min(8).max(80) })
        .strict()
        .parse(req.body);
      res.setHeader("Cache-Control", "no-store");
      const out = await o.onboarding.registerByOperator(b, who(req));
      res.status(201).json({ ...out, trial: TrialService.view(out.trial) });
    }),
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
    "/:id/resend-access",
    requireScope("provisioning:write"),
    wrap(async (req, res) => void res.json(await o.onboarding.resendAccess(id.parse(req.params.id)))),
  );
  // Reenvío del enlace de verificación por operador: mismo servicio y límites que la web; el enlace
  // solo viaja por correo (nunca en la respuesta)
  r.post(
    "/:id/resend-verification",
    requireScope("subscriptions:write"),
    wrap(async (req, res) => {
      res.setHeader("Cache-Control", "no-store");
      res.json(await o.onboarding.resendVerification({ trialId: id.parse(req.params.id) }, who(req)));
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
    requireScope("provisioning:write"),
    requireScope("subscriptions:write"),
    requireScope("entitlements:write"),
    // Es una aprobación administrativa de un pedido: el mismo permiso que POST /orders/:id/approve
    requireScope("orders:approve"),
    wrap(async (req, res) => {
      // Nunca sin pedido: la conversión normal es POST /orders con trialId y su cobro verificado. Esta ruta es la
      // EXCEPCIÓN administrativa auditada (misma aprobación tipificada que /orders/:id/approve).
      const b = z
        .object({
          category: z.enum(APPROVAL_CATEGORIES),
          reason: z.string().trim().min(20).max(300),
          reference: z.string().trim().min(3).max(80).optional(),
          plan: z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/).optional(),
          interval: z.enum(["month", "year"]).optional(),
        })
        .strict()
        .parse(req.body ?? {});
      if (!o.convert?.run) {
        res.status(409).json({ error: "orders_required", message: "La conversión se hace con un pedido (POST /orders con trialId) y su cobro; los pedidos no están activos aquí" });
        return;
      }
      const out = await o.convert.run(id.parse(req.params.id), b, who(req));
      // Como POST /orders/:id/approve: si el pedido no llega a activarse, 409 con el motivo (lo retoma la revisión)
      res.status(out.error ? 409 : 200).json(out);
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
