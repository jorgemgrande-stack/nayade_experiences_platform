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
import { LIFE_PLAN } from "../../shared/personalPlans";
import { LANDING_STEPS, countLandingStep, summarizeLanding, type TrialFunnelCounter } from "./funnel";
import { normalizeChannel } from "./profile";
import { TRIAL_FUNNEL_STAGES, TRIAL_MILESTONES } from "./store";

/** Procedencia que envía la web (UTM, dominio de referencia y página de entrada); se sanea en ./profile.ts. */
const attributionSchema = z
  .object({
    source: z.string().max(200).nullable().optional(),
    medium: z.string().max(200).nullable().optional(),
    campaign: z.string().max(200).nullable().optional(),
    term: z.string().max(200).nullable().optional(),
    content: z.string().max(200).nullable().optional(),
    referrerHost: z.string().max(253).nullable().optional(),
    landingPath: z.string().max(300).nullable().optional(),
    // Solo la red del clic de anuncio (gclid → google, fbclid → meta, msclkid → microsoft), nunca el identificador
    adClick: z.string().max(20).nullable().optional(),
  })
  // Claves desconocidas (gclid, fbclid…) se descartan: la medición nunca impide registrarse
  .strip();

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

export function createPublicTrialRouter(o: { onboarding: TrialOnboardingService; autoProvision: boolean; perIpHour?: number; resendPerIpHour?: number; funnel?: TrialFunnelCounter | null; funnelPerIpHour?: number; now?: () => number }): Router {
  const r = express.Router();
  // Contador anónimo de la página (visita e inicio del formulario): antes del límite del alta, con el suyo propio.
  // Responde 202 siempre (también sin la migración 0046 o si falla): la medición nunca molesta a quien se registra.
  r.post(
    "/funnel",
    rateLimit({
      windowMs: 60 * 60_000,
      limit: o.funnelPerIpHour ?? 60,
      standardHeaders: true,
      legacyHeaders: false,
      keyGenerator: (req) => `trial-funnel:${ipKeyGenerator(req.ip ?? "")}`,
      handler: (_req, res) => void res.status(202).json({ counted: false }),
    }),
    (req, res) => {
      res.setHeader("Cache-Control", "no-store");
      const b = z.object({ step: z.enum(LANDING_STEPS), attribution: attributionSchema.optional() }).strict().safeParse(req.body);
      if (!b.success) return void res.status(400).json({ error: "invalid_input" });
      countLandingStep(o.funnel ?? null, b.data.step, b.data.attribution ?? null, (o.now ?? Date.now)()).then(
        (counted) => void res.status(202).json({ counted }),
        (e) => {
          opsLog("warn", "Trials", "landing_count_failed", { error: e instanceof Error ? e.name : "error" });
          res.status(202).json({ counted: false });
        },
      );
    },
  );
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
        .object({
          email: z.string().max(254),
          companyName: z.string().max(160).optional(),
          // Formulario de captación (09/11/2026): responsable, sector, teléfono, país, aceptaciones y procedencia
          fullName: z.string().max(160).optional(),
          sector: z.string().max(60).optional(),
          phone: z.string().max(40).optional(),
          country: z.string().max(4).optional(),
          termsAccepted: z.boolean().optional(),
          termsVersion: z.string().max(60).optional(),
          marketingConsent: z.boolean().optional(),
          attribution: attributionSchema.optional(),
          // Plan personal Life (08/11/2026): titular particular y nombre del hogar, nunca razón social; con su interruptor
          plan: z.literal(LIFE_PLAN).optional(),
          holder: z.object({ firstName: z.string().max(80), lastName: z.string().max(120), taxId: z.string().max(20).optional() }).strict().optional(),
          householdName: z.string().max(160).optional(),
          idempotencyKey: z.string().max(80),
          website: z.string().max(200).optional(),
        })
        .strict()
        .refine((x) => (x.plan === LIFE_PLAN ? !!x.holder && x.companyName === undefined : x.companyName !== undefined && !x.holder && x.householdName === undefined), { message: "Datos del alta no válidos" })
        .parse(req.body);
      // Campo trampa: los robots lo rellenan; se responde igual que a una persona, sin crear nada
      if (b.website) return void res.status(202).json(ACCEPTED);
      // Desde el 09/11/2026 toda alta pública exige la aceptación expresa con su versión (también la del formulario
      // anterior y la del plan Life): sin ella, 400 con el motivo para la persona y no se crea nada
      const terms = { accepted: b.termsAccepted, version: b.termsVersion };
      try {
        if (b.plan === LIFE_PLAN) await o.onboarding.registerLife({ email: b.email, holder: b.holder!, householdName: b.householdName ?? null, terms, idempotencyKey: b.idempotencyKey, ip: req.ip ?? null });
        else
          await o.onboarding.register({
            email: b.email,
            companyName: b.companyName!,
            // Con el formulario nuevo, el responsable va con su aceptación expresa; el anterior (solo correo y empresa) sigue valiendo
            profile: b.fullName !== undefined ? { fullName: b.fullName, sector: b.sector ?? null, phone: b.phone ?? null, country: b.country ?? null, termsAccepted: b.termsAccepted === true, termsVersion: b.termsVersion ?? null, marketingConsent: b.marketingConsent === true } : null,
            attribution: b.attribution ?? null,
            terms,
            idempotencyKey: b.idempotencyKey,
            ip: req.ip ?? null,
          });
      } catch (e) {
        // No se revela si el correo ya tiene una prueba en curso. Si sigue sin verificar, se le reenvía el enlace (con la
        // espera mínima y el máximo diario de siempre): quien perdió el correo no se queda sin poder empezar.
        if (e instanceof TrialError && e.code === "conflict") {
          void o.onboarding.resendVerification({ email: b.email }, "web").catch((err) => opsLog("error", "Trials", "resend_failed", { error: err instanceof Error ? err.name : "error" }));
          return void res.status(202).json(ACCEPTED);
        }
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

export function createTrialAdminRouter(o: { onboarding: TrialOnboardingService; trials: TrialService; store: TrialStore; convert?: { run?: TrialExceptionConversion }; funnel?: TrialFunnelCounter | null }): Router {
  const r = express.Router();
  const id = z.coerce.number().int().positive();
  const listActive = async () => (await o.store.list({ states: ["active"] })).map((t) => ({ id: t.id, email: t.email, endsAt: t.endsAt }));

  // Embudo de captación y activación (sin datos personales): página (contador anónimo) y etapas de las pruebas
  // registradas en el rango, por canal de procedencia y sector. Días AAAA-MM-DD, ambos incluidos, máximo un año.
  r.get(
    "/funnel",
    requireScope("subscriptions:read"),
    wrap(async (req, res) => {
      const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
      const q = z.object({ from: day, to: day }).parse(req.query);
      const from = Date.parse(`${q.from}T00:00:00Z`);
      const to = Date.parse(`${q.to}T00:00:00Z`) + 86_400_000;
      if (!(from < to) || to - from > 367 * 86_400_000) throw new TrialError("invalid_input", "Rango de días no válido (máximo un año)");
      // Registros técnicos fuera: pruebas marcadas y canales técnicos (visitas y altas de verificación)
      const testChannels = o.funnel ? await o.funnel.testChannels().catch(() => []) : [];
      const exclude = new Set(testChannels.map((c) => c.channel));
      const [{ rows, truncated, excluded }, landing] = await Promise.all([o.store.funnel({ from, to, excludeChannels: exclude }), o.funnel ? o.funnel.counts({ from: q.from, to: q.to }).catch(() => null) : Promise.resolve(null)]);
      const totals = Object.fromEntries(TRIAL_FUNNEL_STAGES.map((s) => [s, rows.reduce((n, x) => n + x.stages[s], 0)]));
      res.json({ from: q.from, to: q.to, truncated, landing: landing ? summarizeLanding(landing, exclude) : null, totals, rows, excluded: { trials: excluded, channels: testChannels.map((c) => c.channel) } });
    }),
  );

  // Canales técnicos del embudo (CRM 0047): marcar uno lo saca del embudo sin borrar nada; queda quién, cuándo y por qué
  r.get(
    "/funnel/test-channels",
    requireScope("subscriptions:read"),
    wrap(async (_req, res) => {
      res.json({ channels: o.funnel ? await o.funnel.testChannels() : [] });
    }),
  );
  r.post(
    "/funnel/test-channels",
    requireScope("subscriptions:write"),
    wrap(async (req, res) => {
      const b = z.object({ channel: z.string().trim().min(1).max(60), reason: z.string().trim().min(5).max(200) }).strict().parse(req.body);
      if (!o.funnel) throw new TrialError("unavailable", "El contador del embudo no está disponible");
      // El mismo valor que guardan los contadores y las pruebas (minúsculas, sin «www.», espacios a guiones)
      const channel = normalizeChannel(b.channel);
      if (!channel) throw new TrialError("invalid_input", "Canal no válido: usa el utm_source o el dominio tal como aparece en el embudo");
      let marked: boolean;
      try {
        marked = await o.funnel.markTestChannel({ channel, reason: b.reason, actor: who(req), createdAt: Date.now() });
      } catch (e) {
        if ((e as { code?: string } | null)?.code === "ER_NO_SUCH_TABLE") throw new TrialError("unavailable", "Falta la migración 0047 del CRM");
        throw e;
      }
      opsLog("info", "Trials", "funnel_test_channel_marked", { channel, actor: who(req), marked });
      res.status(marked ? 201 : 200).json({ marked, channels: await o.funnel.testChannels() });
    }),
  );

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
  // Marca de registro técnico o de prueba (auditada en el historial como `marked_test`)
  r.post(
    "/:id/mark-test",
    requireScope("subscriptions:write"),
    wrap(async (req, res) => {
      const b = z.object({ reason: z.string().trim().min(5).max(200) }).strict().parse(req.body);
      res.json({ trial: TrialService.view(await o.trials.markTest(id.parse(req.params.id), b.reason, who(req))) });
    }),
  );
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
      res.json({ trial: TrialService.view(await o.onboarding.approveExtension(id.parse(req.params.id), { expectedVersion: b.expectedVersion, days: b.days, actor: who(req) })) });
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

/**
 * Hitos de activación de una prueba (`POST /cp/v1/commerce/tenants/:tenantId/trial-milestones`), con el token de
 * comercio del Core (el tenant sale de la sesión del panel, nunca del navegador): primer acceso del propietario y
 * primera acción útil. Una sola vez por prueba; sin prueba, no hace nada. Sin datos personales.
 */
export function createTrialMilestoneRouter(o: { trials: TrialService }): Router {
  const r = express.Router();
  const tenant = z.string().regex(/^[a-z0-9][a-z0-9-]{1,62}$/);
  r.post(
    "/tenants/:tenantId/trial-milestones",
    (req, res, next) => {
      const scopes = getAuth(req)?.scopes;
      if (!scopes || !(scopes.has("commerce:support") || scopes.has("commerce:purchase"))) return void res.status(403).json({ error: "forbidden", scope: "commerce:support" });
      next();
    },
    express.json({ limit: "4kb" }),
    wrap(async (req, res) => {
      const t = tenant.parse(req.params.tenantId);
      const b = z.object({ milestone: z.enum(TRIAL_MILESTONES), detail: z.string().regex(/^[a-z0-9_-]{1,40}$/).optional() }).strict().parse(req.body);
      const out = await o.trials.recordMilestone(t, b.milestone, b.detail ?? null, `core:${t}`);
      res.status(202).json(out);
    }),
  );
  return r;
}
