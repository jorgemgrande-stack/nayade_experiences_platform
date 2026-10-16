/**
 * API del plano de control v1 — superficie para Big Elephant CRM y operadores.
 *
 * Reglas de diseño:
 *  - Servicio SEPARADO del Core (otro proceso, otras credenciales con permiso de escritura en
 *    el registro). El Core nunca monta estas rutas.
 *  - Versionada (`/cp/v1`), autenticada con tokens de servicio con ámbitos, auditada.
 *  - No expone datos empresariales de los tenants ni secretos (DSN, claves, invitaciones
 *    persistentes): solo hechos operativos del registro.
 */
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import { BUILTIN_MODULES } from "../_core/modules/builtin";
import { CORE_VERSION } from "../_core/modules/runtime";
import { assertCanActivate, assertCanDeactivate, buildCatalog, tenantModules, type ModulePriceRef, type PlanRef } from "../_core/modules/catalog";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { DEFAULT_QUOTAS, type DefaultQuota } from "../_core/erm/quota";
import { UNMEASURED, WARNING_RATIO, tenantResources, type ResourceState } from "../_core/erm/overview";
import { z } from "zod";
import { RegistryError } from "../_core/tenantRegistry/contract";
import type { TenantRegistryService } from "../_core/tenantRegistry/service";
import type { TenantRegistryReader } from "../_core/tenantRegistry/store";
import { verifyDomainOwnership, type VerificationResult } from "../_core/tenantRegistry/domainVerification";
import type { ProvisioningService } from "../_core/provisioning/service";
import { ProvisioningError } from "../_core/provisioning/types";
import type { SubscriptionService } from "../_core/billing/service";
import type { BillingStore } from "../_core/billing/ports";
import { BillingError } from "../_core/billing/types";
import type { UsageStore } from "../_core/erm/types";
import type { EntitlementAdmin } from "../_core/modules/mysqlEntitlements";
import type { QuotaAdmin } from "../_core/erm/mysqlQuotas";
import { ModuleError } from "../_core/modules/contract";
import { SESSION_COOKIE, authenticate, getAuth, hashToken, readCookie, requireScope, type ServiceToken } from "./auth";
import type { OperatorAuthService } from "./operatorAuth";
import { createOperatorRouter, createPublicAuthRouter } from "./operatorApi";
import { SsoError, type SsoService } from "./sso";
import { signSupportToken } from "../_core/support/session";
import { TEMPLATES } from "../_core/templates/catalog";
import { renderMetrics } from "./metrics";
import type { IncidentService } from "../_core/ops/incidents";
import type { AlertRunResult } from "../_core/ops/alerts";
import { createCrmRouter } from "../crm/api";
import { CrmOnboarding } from "../crm/onboarding";
import type { CrmService } from "../crm/service";
import type { CrmStore } from "../crm/store";
import type { TicketService } from "../_core/support/tickets";
import { createTicketsRouter } from "./tickets";
import type { SupportAdmin } from "../_core/support/grants";
import { createPublicIntakeRouter, type PublicIntakeConfig } from "../crm/publicApi";
import { WebRequestService } from "../crm/webRequests";
import { WebAdminService } from "../web/service";
import type { WebStore } from "../web/store";
import { createWebAdminRouter } from "../web/api";
import { createPublicSiteRouter } from "../web/publicSite";
import { createSubscriptionsRouter } from "../subscriptions/api";
import { catalogFromWebStore, crmFromStore } from "../subscriptions/ports";
import { SubscriptionService as ContractSubscriptionService } from "../subscriptions/service";
import { ShadowBillingService } from "../subscriptions/shadow";
import type { SubscriptionStore } from "../subscriptions/store";
import { Metrics } from "../_core/metering";

export interface ControlPlaneDeps {
  tokens: ServiceToken[];
  registry: TenantRegistryService;
  reader: TenantRegistryReader;
  entitlements: Pick<EntitlementAdmin, "listEntitlements" | "grant" | "setStatus" | "revoke">;
  quotas: Pick<QuotaAdmin, "listQuotas" | "set" | "remove">;
  provisioning?: ProvisioningService;
  billing?: SubscriptionService;
  billingStore?: BillingStore;
  usage?: UsageStore;
  /** Cuotas por defecto de plataforma (ERM_DEFAULT_QUOTAS); por defecto, las del ERM. */
  quotaDefaults?: DefaultQuota[];
  /** Destino CNAME de la plataforma para verificar dominios propios. */
  platformTarget: string;
  verifyDomain?: typeof verifyDomainOwnership;
  /** Límite de peticiones por minuto y token (por defecto 120). */
  perMinute?: number;
  /** Tope de peticiones por minuto y IP para todo el plano de control (por defecto 600). */
  perIpMinute?: number;
  /** Acceso delegado de soporte (requiere SUPPORT_JWT_SECRET). */
  support?: Pick<SupportAdmin, "create" | "revoke">;
  /** Incidencias operativas y evaluación de alertas. */
  ops?: { incidents: IncidentService; runAlerts?: () => Promise<AlertRunResult> };
  /** Tickets de soporte de clientes. */
  tickets?: TicketService;
  /** SSO corporativo (OIDC → sesión corta). */
  sso?: SsoService;
  /** Dominio base de los subdominios de plataforma (onboarding desde el CRM). */
  platformDomain?: string;
  /** CRM comercial (leads, oportunidades, contratos…). */
  crm?: { service: CrmService; store: CrmStore };
  /** Orígenes del navegador autorizados (CORS). Vacío = ninguno. Nunca comodín. */
  allowedOrigins?: string[];
  supportSecret?: string;
  /** Operadores humanos con usuario y contraseña (sesión por cookie HttpOnly + CSRF). */
  operators?: OperatorAuthService;
  /** Atributo Secure de la cookie de sesión: `auto` (HTTPS) por defecto. */
  cookieSecure?: "auto" | boolean;
  /** Proxies de confianza delante del servicio (`trust proxy` de Express): IP real y HTTPS. */
  trustProxy?: number | string;
  /**
   * API pública de captación de la web comercial (/cp/v1/public/*). Requiere `crm`. Sin esta
   * configuración no se monta: ninguna ruta pública existe por defecto.
   */
  publicIntake?: Omit<PublicIntakeConfig, "service" | "origins"> & { origins: string[] };
  /**
   * Web comercial: catálogo y contenidos administrados desde el CRM (BD del CRM, migración 0004).
   * La lectura pública (/cp/v1/public/site) además requiere `publicIntake` (orígenes y secreto).
   */
  web?: { store: WebStore; onPublish?: (version: string) => void };
  /**
   * Suscripciones v1 en MODO SOMBRA (BD del CRM, migración 0006). Requiere `crm` y `web` (precios
   * aprobados del catálogo). Nunca cobra, emite facturas fiscales ni toca licencias.
   */
  subscriptions?: { store: SubscriptionStore; now?: () => number };
}

const idSchema = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,62}$/);
const periodSchema = z.enum(["minute", "hour", "day", "month"]);

function httpStatus(e: unknown): { status: number; code: string } {
  if (e instanceof RegistryError) {
    const m: Record<string, number> = {
      not_found: 404,
      forbidden: 403,
      conflict: 409,
      stale_version: 409,
      invalid_transition: 409,
      invalid_domain: 400,
    };
    return { status: m[e.code] ?? 400, code: e.code };
  }
  if (e instanceof ProvisioningError) {
    return { status: e.code === "not_found" ? 404 : e.code === "invalid_request" ? 400 : 409, code: e.code };
  }
  if (e instanceof BillingError) {
    return { status: e.code === "not_found" ? 404 : e.code === "invalid_signature" ? 400 : 409, code: e.code };
  }
  if (e instanceof ModuleError) {
    const conflict = e.code === "missing_dependency" || e.code === "dependency_active" || e.code === "dependency_inactive";
    return { status: e.code === "not_found" ? 404 : conflict ? 409 : 400, code: e.code };
  }
  if (e instanceof z.ZodError) return { status: 400, code: "invalid_request" };
  return { status: 500, code: "internal_error" };
}

const wrap =
  (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch((e) => {
      const { status, code } = httpStatus(e);
      if (status === 500) console.error("[ControlPlane] error interno:", e instanceof Error ? e.name : "error");
      // Mensaje genérico en errores internos; los de dominio son seguros y útiles
      const message = status === 500 ? "Error interno" : e instanceof z.ZodError ? e.issues.map((i) => i.path.join(".")).join(", ") : (e as Error).message;
      res.status(status).json({ error: code, message });
      void next;
    });
  };

export function createControlPlaneApp(d: ControlPlaneDeps): Express {
  const app = express();
  app.disable("x-powered-by");
  if (d.trustProxy !== undefined) app.set("trust proxy", d.trustProxy);
  // CORS: solo orígenes explícitos, nunca comodín. Con operadores, credenciales (cookie de sesión)
  // únicamente para esos orígenes; los tokens de servicio siguen en la cabecera Authorization.
  const origins = new Set((d.allowedOrigins ?? []).filter((o) => /^https?:\/\/[^*]+$/.test(o)));
  // La API pública tiene su propia lista de orígenes (la web), sin credenciales ni cabeceras de sesión
  const publicOrigins = new Set((d.publicIntake?.origins ?? []).filter((o) => /^https?:\/\/[^*]+$/.test(o)));
  app.use((req, res, next) => {
    const o = req.headers.origin;
    if (req.path.startsWith("/cp/v1/public/")) {
      if (typeof o === "string" && publicOrigins.has(o)) {
        res.setHeader("Access-Control-Allow-Origin", o);
        res.setHeader("Vary", "Origin");
        res.setHeader("Access-Control-Allow-Headers", "content-type, idempotency-key");
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        res.setHeader("Access-Control-Max-Age", "600");
      }
      if (req.method === "OPTIONS") return void res.status(204).end();
      return next();
    }
    if (typeof o === "string" && origins.has(o)) {
      res.setHeader("Access-Control-Allow-Origin", o);
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Headers", d.operators ? "authorization, content-type, x-csrf-token" : "authorization, content-type");
      if (d.operators) res.setHeader("Access-Control-Allow-Credentials", "true");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
      res.setHeader("Access-Control-Max-Age", "600");
    }
    if (req.method === "OPTIONS") return void res.status(204).end();
    next();
  });
  app.use(express.json({ limit: "256kb", verify: (req, _res, buf) => void ((req as any).rawBody = buf.toString("utf8")) }));

  // Webhook del proveedor de pagos: autenticado por firma, no por token
  if (d.billing) {
    app.post(
      "/cp/v1/billing/webhook",
      wrap(async (req, res) => {
        const sig = String(req.headers["stripe-signature"] ?? req.headers["x-signature"] ?? "");
        const out = await d.billing!.handleWebhook((req as any).rawBody ?? "", sig);
        res.json(out);
      }),
    );
  }

  const router = express.Router();
  // Tope por IP antes que nada: sin él, cada cabecera Authorization inventada estrenaría un cubo nuevo
  // (probar tokens o /auth/oidc sin límite).
  router.use(
    rateLimit({
      windowMs: 60_000,
      limit: d.perIpMinute ?? 600,
      standardHeaders: true,
      legacyHeaders: false,
      keyGenerator: (req) => `ip:${ipKeyGenerator(req.ip ?? "")}`,
    }),
  );
  router.use(
    rateLimit({
      windowMs: 60_000,
      limit: d.perMinute ?? 120,
      standardHeaders: true,
      legacyHeaders: false,
      // Por token o por sesión de operador (no un cubo común); sin credenciales, por IP
      keyGenerator: (req) => {
        // Nunca el token en claro como clave del limitador
        if (req.headers.authorization) return `tok:${hashToken(req.headers.authorization).slice(0, 24)}`;
        const c = readCookie(req, SESSION_COOKIE);
        return c ? `session:${hashToken(c).slice(0, 24)}` : `ip:${ipKeyGenerator(req.ip ?? "")}`;
      },
    }),
  );
  // Intercambio de id_token OIDC por sesión (sin autenticación previa; con límite de tasa)
  if (d.sso) {
    router.post(
      "/auth/oidc",
      wrap(async (req, res) => {
        const b = z.object({ idToken: z.string().min(20).max(8192) }).parse(req.body);
        try {
          res.json(await d.sso!.exchange(b.idToken));
        } catch (e) {
          if (e instanceof SsoError) return void res.status(e.code === "not_authorized" ? 403 : 401).json({ error: e.code });
          throw e;
        }
      }),
    );
  }
  const operatorRoutes = d.operators ? { service: d.operators, allowedOrigins: origins, cookieSecure: d.cookieSecure } : null;
  // Login y restablecimiento de contraseña de operadores: sin sesión previa
  if (operatorRoutes) router.use(createPublicAuthRouter(operatorRoutes));
  // Solicitudes comerciales de la web: cuelgan de los leads del CRM
  const webRequests = d.crm ? new WebRequestService({ store: d.crm.store, crm: d.crm.service }) : undefined;
  // Catálogo y contenidos de la web comercial (las referencias técnicas se leen del Core, no se copian)
  const webAdmin = d.web
    ? new WebAdminService({
        store: d.web.store,
        onPublish: d.web.onPublish,
        refs: {
          moduleIds: BUILTIN_MODULES.map((m) => m.id),
          planIds: () => {
            const b = d.billing as unknown as { getCatalog?: () => { plans: Array<{ id: string }> } } | undefined;
            return typeof b?.getCatalog === "function" ? b.getCatalog().plans.map((p) => p.id) : null;
          },
        },
      })
    : undefined;
  // Lectura pública del sitio (solo lo publicado): antes del router de captación, que exige Origin
  if (webAdmin && d.publicIntake) router.use("/public/site", createPublicSiteRouter({ service: webAdmin, secret: d.publicIntake.secret }));
  // Captación pública desde la web: única ruta sin autenticación que escribe (solo solicitudes)
  if (webRequests && d.publicIntake) router.use("/public", createPublicIntakeRouter({ ...d.publicIntake, origins: publicOrigins, service: webRequests }));
  router.use(
    authenticate(
      d.tokens,
      d.sso ? (t) => d.sso!.verifySession(t) : undefined,
      d.operators ? { operators: d.operators, allowedOrigins: origins } : undefined,
    ),
  );
  router.get("/auth/me", (req, res) => {
    const a = getAuth(req)!;
    res.json({ actor: a.actor, scopes: Array.from(a.scopes) });
  });
  // Sesión, cierre de sesión, contraseña propia y gestión de operadores
  if (operatorRoutes) router.use(createOperatorRouter(operatorRoutes));
  const actor = (req: Request) => getAuth(req)!.actor;

  // ── Tenants ────────────────────────────────────────────────────────────────
  router.get(
    "/tenants",
    requireScope("tenants:read"),
    wrap(async (_req, res) => {
      res.json({ tenants: await d.reader.listTenants() });
    }),
  );

  router.get(
    "/tenants/:id",
    requireScope("tenants:read"),
    wrap(async (req, res) => {
      const id = idSchema.parse(req.params.id);
      const t = await d.reader.getTenant(id);
      if (!t) throw new RegistryError("not_found", "Tenant no encontrado");
      const dbs = (await d.reader.listDatabases(id)).map((x) => ({ id: x.id, state: x.state, keyId: x.keyId, serverAlias: x.serverAlias }));
      res.json({ tenant: t, domains: await d.reader.listDomains(id), databases: dbs });
    }),
  );

  router.get(
    "/tenants/:id/events",
    requireScope("tenants:read"),
    wrap(async (req, res) => {
      const id = idSchema.parse(req.params.id);
      const limit = z.coerce.number().int().min(1).max(500).default(100).parse(req.query.limit ?? undefined);
      res.json({ events: await d.reader.listEvents(id, limit) });
    }),
  );

  router.post(
    "/tenants/:id/status",
    requireScope("tenants:write"),
    wrap(async (req, res) => {
      const id = idSchema.parse(req.params.id);
      const body = z
        .object({
          status: z.enum(["trial", "active", "grace", "suspended", "archived", "deleting", "deleted"]),
          reason: z.string().max(200).optional(),
        })
        .parse(req.body);
      res.json({ tenant: await d.registry.setStatus(id, body.status, actor(req), { reason: body.reason }) });
    }),
  );

  // ── Dominios ───────────────────────────────────────────────────────────────
  router.post(
    "/tenants/:id/domains",
    requireScope("domains:write"),
    wrap(async (req, res) => {
      const id = idSchema.parse(req.params.id);
      const body = z
        .object({ domain: z.string().min(3).max(253), kind: z.enum(["custom", "platform_subdomain"]), primary: z.boolean().optional() })
        .parse(req.body);
      // Límite por plan (si hay motor de suscripciones)
      if (body.kind === "custom" && d.billing) {
        const count = (await d.reader.listDomains(id)).filter((x) => x.kind === "custom" && x.status !== "removed").length;
        if (!(await d.billing.canAddCustomDomain(id, count))) {
          throw new BillingError("domain_limit", "El plan no permite más dominios propios");
        }
      }
      const dom = await d.registry.addDomain(id, body.domain, body.kind, actor(req), { primary: body.primary });
      res.status(201).json({ domain: dom });
    }),
  );

  router.post(
    "/domains/:domain/verify",
    requireScope("domains:write"),
    wrap(async (req, res) => {
      const r = await d.reader.resolveDomain(req.params.domain.toLowerCase());
      if (!r) throw new RegistryError("not_found", "Dominio no encontrado");
      if (!r.domain.verificationToken) {
        res.json({ verified: r.domain.status !== "pending_verification", pending: [] });
        return;
      }
      const verify = d.verifyDomain ?? verifyDomainOwnership;
      const v: VerificationResult = await verify({
        domain: r.domain.domain,
        token: r.domain.verificationToken,
        platformTarget: d.platformTarget,
      });
      if (v.ok && r.domain.status === "pending_verification") await d.registry.markDomainVerified(r.domain.domain, actor(req));
      res.json({ verified: v.ok, cname: v.cname, txt: v.txt, pending: v.pending });
    }),
  );

  router.post(
    "/domains/:domain/activate",
    requireScope("domains:write"),
    wrap(async (req, res) => {
      res.json({ domain: await d.registry.activateDomain(req.params.domain.toLowerCase(), actor(req)) });
    }),
  );

  router.post(
    "/domains/:domain/disable",
    requireScope("domains:write"),
    wrap(async (req, res) => {
      const body = z.object({ reason: z.string().max(200).optional() }).parse(req.body ?? {});
      res.json({ domain: await d.registry.disableDomain(req.params.domain.toLowerCase(), actor(req), body.reason) });
    }),
  );

  // ── Licencias y cuotas ─────────────────────────────────────────────────────
  router.get(
    "/tenants/:id/entitlements",
    requireScope("tenants:read"),
    wrap(async (req, res) => {
      res.json({ entitlements: await d.entitlements.listEntitlements(idSchema.parse(req.params.id)) });
    }),
  );

  router.put(
    "/tenants/:id/entitlements/:module",
    requireScope("entitlements:write"),
    wrap(async (req, res) => {
      const id = idSchema.parse(req.params.id);
      const body = z
        .object({ status: z.enum(["active", "suspended", "expired"]).optional(), validUntil: z.string().datetime().nullable().optional() })
        .parse(req.body ?? {});
      const mod = req.params.module;
      if (!BUILTIN_MODULES.some((m) => m.id === mod)) return void res.status(404).json({ error: "not_found", message: "Módulo desconocido" });
      const current = await d.entitlements.listEntitlements(id);
      // Activar comprueba dependencias; suspender o caducar, que nada activo dependa de él (igual que DELETE)
      if (!body.status || body.status === "active") assertCanActivate(BUILTIN_MODULES, current, mod, Date.now());
      else assertCanDeactivate(BUILTIN_MODULES, current, mod, Date.now());
      await d.entitlements.grant(id, mod, actor(req), { validUntil: body.validUntil ? new Date(body.validUntil) : null });
      if (body.status && body.status !== "active") await d.entitlements.setStatus(id, mod, body.status, actor(req));
      res.json({ entitlements: await d.entitlements.listEntitlements(id) });
    }),
  );

  router.delete(
    "/tenants/:id/entitlements/:module",
    requireScope("entitlements:write"),
    wrap(async (req, res) => {
      const id = idSchema.parse(req.params.id);
      assertCanDeactivate(BUILTIN_MODULES, await d.entitlements.listEntitlements(id), req.params.module, Date.now());
      await d.entitlements.revoke(id, req.params.module, actor(req));
      res.status(204).end();
    }),
  );

  // ── Catálogo de módulos (marketplace) ──────────────────────────────────────
  /** Catálogo comercial si el motor de facturación lo expone (PR #62: getCatalog). */
  const billingCatalog = () => {
    const b = d.billing as unknown as { getCatalog?: () => { plans: PlanRef[]; modules: ModulePriceRef[] } } | undefined;
    return typeof b?.getCatalog === "function" ? b.getCatalog() : null;
  };
  router.get(
    "/modules",
    requireScope("tenants:read"),
    wrap(async (_req, res) => {
      const tenants = (await d.reader.listTenants()).filter((t) => t.status !== "deleted" && t.status !== "archived");
      const now = Date.now();
      const counts = new Map<string, number>();
      for (const t of tenants) {
        for (const e of await d.entitlements.listEntitlements(t.id)) {
          if (e.status === "active" && (!e.validUntil || e.validUntil.getTime() > now)) counts.set(e.moduleId, (counts.get(e.moduleId) ?? 0) + 1);
        }
      }
      const cat = billingCatalog();
      res.json({
        ...buildCatalog({ manifests: BUILTIN_MODULES, coreVersion: CORE_VERSION, plans: cat?.plans, modulePrices: cat?.modules, activeCounts: counts, tenantCount: tenants.length }),
        commercialCatalog: cat !== null,
      });
    }),
  );
  router.get(
    "/tenants/:id/modules",
    requireScope("tenants:read"),
    wrap(async (req, res) => {
      const id = idSchema.parse(req.params.id);
      if (!(await d.reader.getTenant(id))) throw new RegistryError("not_found", "Tenant no encontrado");
      const cat = billingCatalog();
      const sub = d.billingStore ? await d.billingStore.getSubscriptionByTenant(id) : null;
      const planModules = [...(cat?.plans.find((p) => p.id === sub?.planId)?.includedModules ?? []), ...(sub?.modules ?? [])];
      res.json({ modules: tenantModules(BUILTIN_MODULES, await d.entitlements.listEntitlements(id), Date.now(), planModules) });
    }),
  );

  router.get(
    "/tenants/:id/quotas",
    requireScope("tenants:read"),
    wrap(async (req, res) => {
      res.json({ quotas: await d.quotas.listQuotas(idSchema.parse(req.params.id)) });
    }),
  );

  router.put(
    "/tenants/:id/quotas",
    requireScope("quotas:write"),
    wrap(async (req, res) => {
      const id = idSchema.parse(req.params.id);
      const b = z
        .object({
          metric: z.string().regex(/^[a-z][a-z0-9_.]{1,63}$/),
          period: periodSchema,
          limit: z.number().int().min(0),
          enforcement: z.enum(["hard", "soft"]).default("hard"),
        })
        .parse(req.body);
      await d.quotas.set({ tenantId: id, ...b }, actor(req));
      res.json({ quotas: await d.quotas.listQuotas(id) });
    }),
  );

  router.delete(
    "/tenants/:id/quotas/:metric/:period",
    requireScope("quotas:write"),
    wrap(async (req, res) => {
      // Retira el override del tenant: vuelve a aplicar el valor por defecto (cambio auditado)
      const id = idSchema.parse(req.params.id);
      const metric = z.string().regex(/^[a-z][a-z0-9_.]{1,63}$/).parse(req.params.metric);
      const period = periodSchema.parse(req.params.period);
      if (!(await d.quotas.listQuotas(id)).some((q) => q.metric === metric && q.period === period)) {
        throw new RegistryError("not_found", "El tenant no tiene esa cuota propia");
      }
      await d.quotas.remove(id, metric, period, actor(req));
      res.json({ quotas: await d.quotas.listQuotas(id) });
    }),
  );

  router.get(
    "/tenants/:id/quotas/history",
    requireScope("tenants:read"),
    wrap(async (req, res) => {
      const id = idSchema.parse(req.params.id);
      if (!(await d.reader.getTenant(id))) throw new RegistryError("not_found", "Tenant no encontrado");
      const events = (await d.reader.listEvents(id, 500)).filter((e) => e.action.startsWith("quota."));
      res.json({
        history: events.map((e) => ({ at: e.at, action: e.action, actor: `${e.actorType}:${e.actorId}`, details: e.details })),
      });
    }),
  );

  // ── Resource Manager: consumo frente a límites ─────────────────────────────
  const quotaDefaults = d.quotaDefaults ?? DEFAULT_QUOTAS;
  const rankState: Record<ResourceState, number> = { not_applicable: 0, ok: 1, warning: 2, exceeded: 3 };
  const notConfigured = { available: false, reason: "Medición no configurada (ERM_DATABASE_URL)", unmeasured: UNMEASURED };
  router.get(
    "/tenants/:id/resources",
    requireScope("usage:read"),
    wrap(async (req, res) => {
      const id = idSchema.parse(req.params.id);
      if (!(await d.reader.getTenant(id))) throw new RegistryError("not_found", "Tenant no encontrado");
      if (!d.usage) return void res.json(notConfigured);
      const r = await tenantResources({ quotas: d.quotas, usage: d.usage, defaults: quotaDefaults }, id, Date.now());
      res.json({ available: true, ...r, thresholds: { warning: WARNING_RATIO, exceeded: 1 }, unmeasured: UNMEASURED });
    }),
  );
  router.get(
    "/resources/overview",
    requireScope("usage:read"),
    requireScope("tenants:read"),
    wrap(async (req, res) => {
      if (!d.usage) return void res.json(notConfigured);
      const onlyAlerts = req.query.alerts === "1";
      const now = Date.now();
      const tenants = (await d.reader.listTenants()).filter((t) => t.status !== "deleted");
      const rows = [];
      for (const t of tenants) {
        const r = await tenantResources({ quotas: d.quotas, usage: d.usage, defaults: quotaDefaults }, t.id, now);
        if (onlyAlerts && r.worst !== "warning" && r.worst !== "exceeded") continue;
        rows.push({ ...r, displayName: t.displayName, status: t.status });
      }
      rows.sort((a, b) => rankState[b.worst] - rankState[a.worst] || (b.maxRatio ?? -1) - (a.maxRatio ?? -1));
      res.json({
        available: true,
        generatedAt: now,
        thresholds: { warning: WARNING_RATIO, exceeded: 1 },
        measurementLagSeconds: 15,
        tenants: rows,
        unmeasured: UNMEASURED,
      });
    }),
  );

  if (d.ops) {
    const ops = d.ops;
    router.get(
      "/incidents",
      requireScope("ops:read"),
      wrap(async (req, res) => {
        const status = z.enum(["open", "acknowledged", "resolved"]).optional().parse(req.query.status);
        const tenantId = idSchema.optional().parse(req.query.tenantId);
        res.json({ incidents: await ops.incidents.list({ status, tenantId, limit: 200 }) });
      }),
    );
    router.post(
      "/incidents/:id/ack",
      requireScope("ops:write"),
      wrap(async (req, res) => {
        res.json({ incident: await ops.incidents.acknowledge(z.coerce.number().int().positive().parse(req.params.id), getAuth(req)!.actor.id) });
      }),
    );
    router.post(
      "/incidents/:id/resolve",
      requireScope("ops:write"),
      wrap(async (req, res) => {
        res.json({ incident: await ops.incidents.resolve(z.coerce.number().int().positive().parse(req.params.id), getAuth(req)!.actor.id) });
      }),
    );
    if (ops.runAlerts) {
      router.post(
        "/alerts/run",
        requireScope("ops:write"),
        wrap(async (_req, res) => void res.json(await ops.runAlerts!())),
      );
    }
  }

  if (d.crm) {
    const onboarding =
      d.provisioning && d.platformDomain
        ? new CrmOnboarding({ store: d.crm.store, crm: d.crm.service, provisioning: d.provisioning, registry: d.reader, billing: d.billing, platformDomain: d.platformDomain })
        : undefined;
    // Responsables posibles: operadores activos con permisos de escritura en el CRM
    const ops = d.operators;
    const assignees = ops
      ? async () =>
          (await ops.list())
            .filter((o) => o.status === "active" && ["superadmin", "admin", "sales"].includes(o.role))
            .map((o) => ({ value: o.displayName, label: o.displayName }))
      : undefined;
    router.use("/crm", createCrmRouter(d.crm.service, d.crm.store, { billing: d.billingStore, onboarding, requests: webRequests, assignees }));
  }

  if (webAdmin) {
    router.use(
      "/web",
      createWebAdminRouter(webAdmin, {
        previewSecret: d.publicIntake?.secret,
        refs: async () => ({
          modules: BUILTIN_MODULES.map((m) => ({ id: m.id, name: m.name, kind: m.kind, includedInBase: !!m.includedInBase })),
          plans: billingCatalog()?.plans.map((p) => ({ id: p.id, name: p.name })) ?? null,
          metrics: Object.values(Metrics),
        }),
      }),
    );
  }

  if (d.subscriptions && d.crm && d.web) {
    const crmPort = crmFromStore(d.crm.store);
    const svc = new ContractSubscriptionService({ store: d.subscriptions.store, catalog: catalogFromWebStore(d.web.store), crm: crmPort, now: d.subscriptions.now });
    const shadowBilling = new ShadowBillingService({ store: d.subscriptions.store, crm: crmPort, now: d.subscriptions.now });
    router.use("/subscriptions", createSubscriptionsRouter(svc, shadowBilling));
  }

  if (d.tickets) {
    const tickets = d.tickets;
    router.use("/tickets", createTicketsRouter(tickets));
    // Vista por empresa: el tenant de la ruta fuerza el filtro y valida su existencia.
    router.get(
      "/tenants/:id/tickets",
      requireScope("tickets:read"),
      wrap(async (req, res) => {
        const id = idSchema.parse(req.params.id);
        if (!(await d.reader.getTenant(id))) throw new RegistryError("not_found", "Tenant no encontrado");
        const status = z.enum(["open", "in_progress", "waiting_customer", "resolved", "closed"]).optional().parse(req.query.status);
        const limit = z.coerce.number().int().min(1).max(200).default(50).parse(req.query.limit);
        const offset = z.coerce.number().int().min(0).max(100_000).default(0).parse(req.query.offset);
        const { items, total } = await tickets.list({ tenantId: id, status, limit, offset });
        res.json({ tickets: items, total, limit, offset });
      }),
    );
  }

  // ── Métricas (Prometheus) ──────────────────────────────────────────────────
  router.get(
    "/metrics",
    requireScope("usage:read"),
    wrap(async (_req, res) => {
      res.type("text/plain; version=0.0.4").send(await renderMetrics({ reader: d.reader, usage: d.usage, entitlements: d.entitlements }));
    }),
  );

  // ── Plantillas ─────────────────────────────────────────────────────────────
  router.get(
    "/templates",
    requireScope("tenants:read"),
    wrap(async (_req, res) => {
      res.json({
        templates: TEMPLATES.map((t) => ({ id: t.id, name: t.name, description: t.description, sector: t.sector, recommendedModules: t.recommendedModules })),
      });
    }),
  );

  // ── Aprovisionamiento ──────────────────────────────────────────────────────
  if (d.provisioning) {
    router.post(
      "/provisioning",
      requireScope("provisioning:write"),
      wrap(async (req, res) => {
        const b = z
          .object({
            tenantId: z.string(),
            displayName: z.string().min(1).max(200),
            adminEmail: z.string().email(),
            adminName: z.string().max(120).optional(),
            platformDomain: z.string(),
            modules: z.array(z.string()).max(50).optional(),
            trialDays: z.number().int().min(1).max(90).optional(),
            brand: z.record(z.string(), z.string().max(300)).optional(),
            templateId: z.string().max(64).optional(),
          })
          .parse(req.body);
        const r = await d.provisioning!.run(b, actor(req));
        res.status(r.status === "completed" ? 201 : 202).json(r);
      }),
    );
    router.get(
      "/provisioning/:id",
      requireScope("tenants:read"),
      wrap(async (req, res) => {
        const s = await d.provisioning!.status(idSchema.parse(req.params.id));
        if (!s) throw new ProvisioningError("not_found", "Sin alta para ese tenant");
        res.json({ status: s.status, steps: s.steps, attempts: s.attempts, lastError: s.lastError });
      }),
    );
    router.post(
      "/provisioning/:id/abort",
      requireScope("provisioning:write"),
      wrap(async (req, res) => {
        const b = z.object({ reason: z.string().min(3).max(200) }).parse(req.body);
        await d.provisioning!.abort(idSchema.parse(req.params.id), { ...actor(req), type: "operator" }, b.reason);
        res.status(204).end();
      }),
    );
  }

  // ── Facturación ────────────────────────────────────────────────────────────
  if (d.billing && d.billingStore) {
    // Debe registrarse antes de `/billing/:id` para que "plans" no se interprete como id de empresa.
    router.get(
      "/billing/plans",
      requireScope("billing:read"),
      wrap(async (_req, res) => {
        const c = d.billing!.getCatalog();
        res.json({
          plans: c.plans.map((p) => ({
            id: p.id,
            name: p.name,
            kind: p.kind,
            interval: p.interval,
            priceCents: p.priceCents,
            currency: p.currency,
            includedModules: p.includedModules,
            maxCustomDomains: p.maxCustomDomains,
            quotas: p.quotas,
            billable: p.priceCents !== null,
          })),
          modules: c.modules,
          trialDays: c.trialDays,
          graceDays: c.graceDays,
        });
      }),
    );
    router.post(
      "/billing/:id/trial",
      requireScope("billing:write"),
      wrap(async (req, res) => {
        const b = z.object({ planId: z.string(), modules: z.array(z.string()).optional(), customerId: z.string().optional() }).parse(req.body);
        res.status(201).json({ subscription: await d.billing!.startTrial({ tenantId: idSchema.parse(req.params.id), ...b }) });
      }),
    );
    router.post(
      "/billing/:id/subscribe",
      requireScope("billing:write"),
      wrap(async (req, res) => {
        const b = z.object({ customerId: z.string().optional() }).parse(req.body ?? {});
        res.json(await d.billing!.subscribe(idSchema.parse(req.params.id), b));
      }),
    );
    router.post(
      "/billing/:id/plan",
      requireScope("billing:write"),
      wrap(async (req, res) => {
        const b = z.object({ planId: z.string(), when: z.enum(["now", "period_end"]).default("period_end") }).parse(req.body);
        res.json({ subscription: await d.billing!.changePlan(idSchema.parse(req.params.id), b.planId, b.when) });
      }),
    );
    router.post(
      "/billing/:id/cancel",
      requireScope("billing:write"),
      wrap(async (req, res) => {
        const b = z.object({ atPeriodEnd: z.boolean().default(true) }).parse(req.body ?? {});
        res.json({ subscription: await d.billing!.cancel(idSchema.parse(req.params.id), b) });
      }),
    );
    router.get(
      "/billing/:id",
      requireScope("billing:read"),
      wrap(async (req, res) => {
        const id = idSchema.parse(req.params.id);
        res.json({ subscription: await d.billingStore!.getSubscriptionByTenant(id), invoices: await d.billingStore!.listInvoices(id) });
      }),
    );
  }

  // ── Soporte delegado ───────────────────────────────────────────────────────
  if (d.support && d.supportSecret) {
    router.post(
      "/tenants/:id/support-access",
      requireScope("support:write"),
      wrap(async (req, res) => {
        const id = idSchema.parse(req.params.id);
        const b = z
          .object({
            // Se ignora: el acceso queda a nombre de la identidad AUTENTICADA (auditoría no falsificable)
            operator: z.string().min(2).max(100).optional(),
            reason: z.string().min(5).max(300),
            minutes: z.number().int().min(1).max(240),
            readOnly: z.boolean().default(true),
          })
          .parse(req.body);
        const t = await d.reader.getTenant(id);
        if (!t) throw new RegistryError("not_found", "Tenant no encontrado");
        if (t.status === "deleted" || t.status === "deleting") throw new RegistryError("conflict", "El tenant no admite acceso");
        const a = getAuth(req)!.actor;
        const g = await d.support!.create({ tenantId: id, ...b, operator: `${a.type}:${a.id}` });
        const token = await signSupportToken(g, d.supportSecret!);
        const primary = (await d.reader.listDomains(id)).find((x) => x.isPrimary && x.status === "active");
        res.status(201).json({
          grantId: g.id,
          expiresAt: new Date(g.expiresAt).toISOString(),
          readOnly: g.readOnly,
          enterUrl: primary ? `https://${primary.domain}/_support/enter?t=${token}` : null,
          token: primary ? undefined : token,
        });
      }),
    );
    router.delete(
      "/support-access/:grantId",
      requireScope("support:write"),
      wrap(async (req, res) => {
        const a = getAuth(req)!.actor;
        const operator = `${a.type}:${a.id}`; // nunca el nombre que envíe quien llama
        await d.support!.revoke(z.string().regex(/^[a-f0-9]{32}$/).parse(req.params.grantId), operator);
        res.status(204).end();
      }),
    );
  }

  // ── Uso ────────────────────────────────────────────────────────────────────
  if (d.usage) {
    router.get(
      "/usage/:id",
      requireScope("usage:read"),
      wrap(async (req, res) => {
        const id = idSchema.parse(req.params.id);
        const days = z.coerce.number().int().min(1).max(90).default(30).parse(req.query.days ?? undefined);
        const to = Date.now() + 3_600_000;
        const rows = await d.usage!.list(id, to - days * 86_400_000, to);
        const totals: Record<string, number> = {};
        for (const r of rows) totals[r.metric] = (totals[r.metric] ?? 0) + r.quantity;
        res.json({ tenantId: id, days, totals, hourly: rows });
      }),
    );
  }

  app.use("/cp/v1", router);
  app.get("/healthz", (_req, res) => void res.json({ ok: true }));
  app.use((_req, res) => void res.status(404).json({ error: "not_found" }));
  return app;
}
