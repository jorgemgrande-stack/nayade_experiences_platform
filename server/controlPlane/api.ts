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
import type { CommercialEventReader } from "../commercialEvents/log";
import type { CommercialEventSink } from "../commercialEvents/types";
import { TenantStatusSync } from "../orchestrator/tenantStatus";
import { COMMERCIAL_EVENT_TYPES, type CommercialEventFilter, type CommercialEventType } from "../commercialEvents/types";
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
import { authenticate, getAuth, hashToken, readSessionCookie, requireScope, type ServiceToken } from "./auth";
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
import { CrmError } from "../crm/types";
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
import { quote, type QuoteRequest } from "../catalog/quote";
import { CAPABILITY_STATUSES } from "../_core/capabilities/model";
import type { CapabilityStore } from "../_core/capabilities/store";
import { LicensingError, LicensingService } from "../licensing/service";
import { TrialService, type TrialLimits } from "../trials/service";
import type { TrialStore } from "../trials/store";
import { TrialOnboardingService, type TrialNotifier } from "../trials/onboarding";
import { createPublicTrialRouter, createTrialAdminRouter, type TrialExceptionConversion } from "../trials/api";
import { OrderError } from "../orchestrator/types";
import { OrganizationError, OrganizationService, type OrganizationStore } from "../organization/service";
import { CommercialOrchestrator } from "../orchestrator/service";
import { LifecycleEngine, startLifecycleScheduler } from "../lifecycle/engine";
import type { LifecyclePolicy } from "../lifecycle/policy";
import type { SchedulerLock } from "../trials/scheduler";
import { createStripeRouter } from "../stripe/api";
import { StripeEventProcessor } from "../stripe/events";
import { StripeReconciler, startStripeWorker } from "../stripe/reconcile";
import { stripeWebhookHandler } from "../stripe/webhook";
import { checkoutStatus, sessionIdRe } from "../stripe/status";
import { SelfServiceCheckout, createSelfServiceRouter } from "../stripe/selfService";
import type { GwEvent } from "../stripe/gateway";
import { StripeCheckoutService, type CheckoutUrls } from "../stripe/checkout";
import { checkoutBlockedReason, type StripeConfig } from "../stripe/config";
import type { StripeGateway } from "../stripe/gateway";
import type { ConsentVersions, FiscalScenario, TaxTreatment } from "../stripe/buyerProfile";
import type { StripeStore } from "../stripe/store";
import type { OrderStore } from "../orchestrator/store";
import type { TestPaymentPort } from "../orchestrator/payments";
import { createOrdersRouter, paymentsWebhookHandler } from "../orchestrator/api";
import { createContractActivation } from "../crm/activation";
import type { PlatformMailer } from "../mail/platform";
import type { MailService } from "../mail/service";
import { brevoWebhookHandler } from "../mail/webhook";

/** Aviso por defecto: NO envía nada; solo deja constancia (sin correo ni token) de que hay un aviso pendiente. */
const logOnlyTrialNotifier: TrialNotifier = {
  verification: async (_to, l) => void console.log(JSON.stringify({ ctx: "Trials", event: "verification_not_sent", trialId: l.trialId })),
  welcome: async (_to, i) => void console.log(JSON.stringify({ ctx: "Trials", event: "welcome_not_sent", tenantId: i.tenantId })),
  expiryNotice: async (_to, i) => void console.log(JSON.stringify({ ctx: "Trials", event: "expiry_notice_not_sent", trialId: i.trialId, daysLeft: i.daysLeft })),
};
import { quoteCatalogFromSite } from "../catalog/snapshot";
import { rebindRequestContext, requestIdMiddleware, requestIdOf } from "../_core/ops/requestContext";
import { opsLog } from "../_core/ops/log";
import { diagnoseTenant } from "../_core/ops/diagnostics";
import type { BackupInventory, BackupRecord } from "../_core/ops/backupInventory";
import type { BackupCopyLedger } from "../_core/ops/backupCopies";
import { BACKUP_TENANT_STATUSES } from "../_core/ops/backupJob";

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
  /** Inventario de copias de seguridad (registro, migración 0010). Sin él no hay rutas `/backups`. */
  backups?: {
    inventory: Pick<BackupInventory, "list" | "latestAttempts" | "lastSuccess">;
    maxAgeMs?: number;
    /** Estado del destino secundario (registro 0011); sin él, la respuesta no cambia. */
    copies?: Pick<BackupCopyLedger, "lastSuccess" | "latestAttempts">;
    secondaryMaxAgeMs?: number;
  };
  /** Incidencias operativas y evaluación de alertas. */
  ops?: { incidents: IncidentService; runAlerts?: () => Promise<AlertRunResult> };
  /** Comprobación de la BD del registro para `/readyz` (sin ella, `/readyz` solo indica que el proceso vive). */
  health?: { registryPing: () => Promise<void>; timeoutMs?: number };
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
  /** Licencias por capacidad (registro, migración 0008). Sin ellas no se aplican licencias desde suscripciones. */
  capabilities?: CapabilityStore;
  /**
   * Prueba gratuita de Essential (CRM 0007). Las rutas públicas solo existen con `publicEnabled`
   * (por defecto NO); `notify` es el único canal de comunicaciones (por defecto, solo un registro
   * sin datos personales ni tokens: no se envía nada).
   */
  trials?: { store: TrialStore; publicEnabled?: boolean; autoProvision?: boolean; notify?: TrialNotifier; limits?: Partial<TrialLimits>; blockedDomains?: string[] };
  /** Sedes y entidades fiscales (registro 0009), con los límites del plan contratado. */
  organization?: OrganizationStore;
  /** Registro de eventos comerciales (CRM 0015), solo lectura. */
  commercialEvents?: CommercialEventReader & Partial<CommercialEventSink>;
  /**
   * Orquestador comercial (CRM 0010). Requiere suscripciones, CRM, web y licencias por capacidad. Los
   * pagos simulados son SOLO de prueba (`payments`; con Stripe en live no se admiten y la aplicación no se
   * crea); sin ellos, los pedidos se confirman por aprobación administrativa o por el pago en Stripe.
   */
  /** `mode`: modo de cobro del entorno (el de CP_STRIPE_MODE), también cuando Stripe no llega a montarse. */
  orders?: { store: OrderStore; payments?: TestPaymentPort | null; graceDays?: number; mode?: StripeConfig["mode"] };
  /**
   * Motor de transiciones temporales (server/lifecycle). Requiere `orders`. El plan (solo lectura) siempre
   * se puede consultar; la tarea periódica solo con `policy.enabled` y aplica solo en modo «apply».
   */
  lifecycle?: { policy: LifecyclePolicy; lock?: SchedulerLock };
  /**
   * Stripe Billing en modo pruebas o live (`config.mode`; server/stripe, CRM 0012 y 0013). Rutas de operador
   * en /stripe; Checkout solo con `checkoutEnabled`, URL de vuelta y, en live, una política fiscal decidida.
   * El almacén debe ser del mismo modo que la configuración. Requiere `orders`.
   */
  stripe?: {
    config: StripeConfig;
    store: StripeStore;
    gateway: StripeGateway;
    urls: CheckoutUrls | null;
    checkoutEnabled: boolean;
    /** Verificación oficial de la firma del webhook (cuerpo original). */
    verifyWebhook: (rawBody: Buffer, signature: string) => GwEvent;
    /** Tarea periódica (eventos pendientes y conciliación). Apagada salvo CP_STRIPE_WORKER_ENABLED=1. */
    workerEnabled: boolean;
    /** Estado público del alta tras Checkout (`/public/checkout/status`). Apagado salvo CP_PUBLIC_CHECKOUT_ENABLED=1. */
    publicStatus: boolean;
    /** Contratación por autoservicio (`/public/checkout/start`). Apagada salvo CP_PUBLIC_SELF_SERVICE_ENABLED=1. */
    selfService: boolean;
    /** Versión publicada de las condiciones de contratación (CP_TERMS_VERSION); sin ella el autoservicio no funciona. */
    termsVersion: string | null;
    /**
     * Perfil fiscal del comprador (B2B/B2C): escenarios aprobados (CP_STRIPE_FISCAL_SCENARIOS) y versiones de
     * consentimiento vigentes. Sin ello, ningún escenario está aprobado (en live no se abre Checkout).
     */
    fiscal?: { scenarios: Set<FiscalScenario>; consent: ConsentVersions; taxExpectations?: Map<FiscalScenario, TaxTreatment>; legalUrls?: { terms: string | null; privacy: string | null } };
  };
  /**
   * Correo transaccional centralizado (server/mail, CRM 0011). `platform`: avisos de Elephant Source
   * (pedidos, alta asistida); webhook de Brevo autenticado por cabecera propia (`webhookToken`);
   * `tenantLane`: bandejas de las empresas para aplicar sus eventos; `diagnostics`: consulta de la cuenta.
   */
  mail?: {
    platform: PlatformMailer | null;
    webhookToken?: string | null;
    tenantLane?: (tenantId: string) => Promise<MailService | null>;
    diagnostics?: () => Promise<unknown>;
  };
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
      if (status === 500) opsLog("error", "ControlPlane", "internal_error", { method: req.method, error: e instanceof Error ? e.name : "error" });
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
  // Identificador de correlación: aceptado solo si es seguro (si no, se genera) y devuelto siempre
  app.use(requestIdMiddleware);
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
        res.setHeader("Access-Control-Allow-Headers", "content-type, idempotency-key, x-request-id");
        res.setHeader("Access-Control-Expose-Headers", "X-Request-Id");
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        res.setHeader("Access-Control-Max-Age", "600");
      }
      if (req.method === "OPTIONS") return void res.status(204).end();
      return next();
    }
    if (typeof o === "string" && origins.has(o)) {
      res.setHeader("Access-Control-Allow-Origin", o);
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Headers", d.operators ? "authorization, content-type, x-csrf-token, x-request-id" : "authorization, content-type, x-request-id");
      res.setHeader("Access-Control-Expose-Headers", "X-Request-Id");
      if (d.operators) res.setHeader("Access-Control-Allow-Credentials", "true");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
      res.setHeader("Access-Control-Max-Age", "600");
    }
    if (req.method === "OPTIONS") return void res.status(204).end();
    next();
  });
  // Webhook de Stripe (modo de la configuración): cuerpo ORIGINAL para la firma, por eso va ANTES de
  // express.json. El procesador se conecta más abajo, junto al orquestador; hasta entonces los eventos solo
  // se guardan.
  let stripeKick: ((eventId: string) => void) | undefined;
  if (d.stripe) {
    const st = d.stripe;
    // Un almacén de otro modo leería o escribiría filas del otro entorno: no se crea la aplicación
    if (st.store.mode !== st.config.mode) throw new Error(`El almacén de Stripe es de modo ${st.store.mode} y la configuración de modo ${st.config.mode}`);
    if (st.config.mode === "live" && d.orders?.payments) throw new Error("El proveedor de pagos simulados no puede montarse con Stripe en modo live");
    app.post(
      "/cp/v1/stripe/webhook",
      rateLimit({ windowMs: 60_000, limit: 600, standardHeaders: true, legacyHeaders: false, keyGenerator: (req) => `ip:${ipKeyGenerator(req.ip ?? "")}` }),
      express.raw({ type: "application/json", limit: "1mb" }),
      wrap(stripeWebhookHandler({ verify: st.verifyWebhook, store: st.store, mode: st.config.mode, onRecorded: (id) => stripeKick?.(id) })),
    );
  }
  app.use(express.json({ limit: "256kb", verify: (req, _res, buf) => void ((req as any).rawBody = buf.toString("utf8")) }));
  app.use(rebindRequestContext);

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

  // Webhook de eventos de Brevo: autenticado por la cabecera propia configurada al crearlo (no por token
  // de servicio). Sin token configurado responde 503 y no cambia nada. Ver server/mail/webhook.ts.
  if (d.mail) {
    const mail = d.mail;
    app.post(
      "/cp/v1/mail/brevo/webhook",
      rateLimit({ windowMs: 60_000, limit: 600, standardHeaders: true, legacyHeaders: false, keyGenerator: (req) => `ip:${ipKeyGenerator(req.ip ?? "")}` }),
      wrap(
        brevoWebhookHandler({
          token: mail.webhookToken,
          resolve: async (lane, tenantId) => (lane === "platform" ? (mail.platform?.service ?? null) : mail.tenantLane ? mail.tenantLane(tenantId) : null),
        }),
      ),
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
        const c = readSessionCookie(req);
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
  // Prueba gratuita pública: reservada ANTES del router de captación (que responde 404 a lo demás);
  // el router real se asigna más abajo, cuando existen suscripciones y licencias.
  let publicTrial: express.Router | null = null;
  router.use("/public/trial", (req, res, next) => (publicTrial ? publicTrial(req, res, next) : void res.status(404).json({ error: "not_found" })));
  // Estado público del alta tras Stripe Checkout: reservado ANTES del router de captación; se asigna con
  // el procesador de Stripe y solo con CP_PUBLIC_CHECKOUT_ENABLED=1
  let publicCheckout: express.Router | null = null;
  router.use("/public/checkout", (req, res, next) => (publicCheckout ? publicCheckout(req, res, next) : void res.status(404).json({ error: "not_found" })));
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
  // La auditoría del registro (tenant_events.request_id) guarda el identificador de correlación
  const actor = (req: Request) => ({ ...getAuth(req)!.actor, requestId: requestIdOf(req) });

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
      // Verificado o fallido: queda registrado (estado visible para la empresa)
      if (r.domain.status === "pending_verification") await d.registry.recordDomainVerification(r.domain.domain, v, actor(req));
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

  // Diagnóstico de una empresa (registro, dominios, BD de la empresa, esquema, licencias): solo operadores
  router.get(
    "/tenants/:id/diagnostics",
    requireScope("ops:read"),
    wrap(async (req, res) => {
      const id = idSchema.parse(req.params.id);
      const out = await diagnoseTenant({ reader: d.reader, registry: d.registry, entitlements: d.entitlements, quotas: d.quotas }, id);
      if (!out.ok) opsLog("warn", "Diagnostics", "tenant_not_healthy", { tenantId: id, failed: out.checks.filter((c) => !c.ok).map((c) => c.name) });
      res.json(out);
    }),
  );

  // Copias de seguridad (inventario del registro, migración 0010): solo lectura para operadores
  if (d.backups) {
    const bk = d.backups;
    const maxAge = bk.maxAgeMs ?? 36 * 3_600_000;
    const view = (r: BackupRecord) => ({
      id: r.id,
      status: r.status,
      startedAt: r.startedAt,
      finishedAt: r.finishedAt,
      durationMs: r.durationMs,
      serverAlias: r.serverAlias,
      schemaVersion: r.schemaVersion,
      bytes: r.bytes,
      sha256: r.sha256,
      keyId: r.keyId,
      storage: r.storageKind,
      location: r.location,
      tables: r.tablesCount,
      rows: r.rowsCount,
      error: r.error,
    });
    router.get(
      "/backups",
      requireScope("ops:read"),
      wrap(async (_req, res) => {
        const now = Date.now();
        const [tenants, latest, okTenant, okRegistry, okCrm] = await Promise.all([
          d.reader.listTenants(),
          bk.inventory.latestAttempts(),
          bk.inventory.lastSuccess("tenant"),
          bk.inventory.lastSuccess("registry"),
          bk.inventory.lastSuccess("crm"),
        ]);
        const lastOf = (kind: string, id: string) => latest.find((r) => r.targetKind === kind && r.targetId === id) ?? null;
        const row = (kind: string, id: string, lastOk: number | undefined) => {
          const last = lastOf(kind, id);
          return {
            lastSuccessAt: lastOk ?? null,
            ageHours: lastOk ? Math.round(((now - lastOk) / 3_600_000) * 10) / 10 : null,
            fresh: !!lastOk && now - lastOk <= maxAge,
            lastAttempt: last ? view(last) : null,
            lastError: last?.status === "failed" ? last.error : null,
          };
        };
        const rows = tenants
          .filter((t) => (BACKUP_TENANT_STATUSES as readonly string[]).includes(t.status))
          .map((t) => ({ tenantId: t.id, displayName: t.displayName, status: t.status, ...row("tenant", t.id, okTenant[t.id]) }))
          .sort((a, b) => Number(a.fresh) - Number(b.fresh) || (a.lastSuccessAt ?? 0) - (b.lastSuccessAt ?? 0) || a.tenantId.localeCompare(b.tenantId));
        // Destino secundario: por empresa, última copia correcta y último intento (solo si hay datos)
        let secondary: Record<string, unknown> | null = null;
        if (bk.copies) {
          const [okSec, lastSec] = await Promise.all([bk.copies.lastSuccess("secondary", "tenant"), bk.copies.latestAttempts("secondary")]);
          if (lastSec.length) {
            const secMax = bk.secondaryMaxAgeMs ?? maxAge;
            const perTenant = rows.map((r) => {
              const at = okSec[r.tenantId];
              const last = lastSec.find((x) => x.targetKind === "tenant" && x.targetId === r.tenantId);
              return { tenantId: r.tenantId, lastSuccessAt: at ?? null, fresh: !!at && now - at <= secMax, lastStatus: last?.status ?? null, lastError: last?.status === "failed" ? last.error : null };
            });
            secondary = {
              maxAgeHours: secMax / 3_600_000,
              summary: {
                fresh: perTenant.filter((t) => t.fresh).length,
                stale: perTenant.filter((t) => !t.fresh && t.lastSuccessAt).length,
                never: perTenant.filter((t) => !t.lastSuccessAt).length,
                lastAttemptFailed: lastSec.filter((x) => x.status === "failed").length,
              },
              tenants: perTenant,
            };
          }
        }
        res.json({
          generatedAt: now,
          maxAgeHours: maxAge / 3_600_000,
          secondary,
          summary: {
            tenants: rows.length,
            fresh: rows.filter((r) => r.fresh).length,
            stale: rows.filter((r) => !r.fresh && r.lastSuccessAt).length,
            never: rows.filter((r) => !r.lastSuccessAt).length,
            lastAttemptFailed: rows.filter((r) => r.lastAttempt?.status === "failed").length,
          },
          platform: { registry: row("registry", "registry", okRegistry.registry), crm: row("crm", "crm", okCrm.crm) },
          tenants: rows,
        });
      }),
    );
    router.get(
      "/tenants/:id/backups",
      requireScope("ops:read"),
      wrap(async (req, res) => {
        const id = idSchema.parse(req.params.id);
        const limit = z.coerce.number().int().min(1).max(500).default(50).parse(req.query.limit ?? undefined);
        const [copies, files, okList] = await Promise.all([
          bk.inventory.list({ targetKind: "tenant", targetId: id, limit }),
          bk.inventory.list({ targetKind: "files", targetId: id, limit: 10 }),
          bk.inventory.list({ targetKind: "tenant", targetId: id, status: "ok", limit: 1 }),
        ]);
        const lastOk = okList[0] ?? null;
        res.json({
          tenantId: id,
          lastSuccessAt: lastOk?.finishedAt ?? null,
          fresh: !!lastOk?.finishedAt && Date.now() - lastOk.finishedAt <= maxAge,
          backups: copies.map(view),
          files: files.map(view),
        });
      }),
    );
  }

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
    const crmQuote = webAdmin ? async (r: QuoteRequest) => quote(quoteCatalogFromSite(await webAdmin!.site("published")), r) : undefined;
    router.use("/crm", createCrmRouter(d.crm.service, d.crm.store, { billing: d.billingStore, onboarding, requests: webRequests, assignees, quote: crmQuote }));
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
    if (d.capabilities) {
      // Licencias por capacidad: Elephant Control es la autoridad técnica. Antes del router de
      // suscripciones (que responde 404 a lo que no conoce).
      const licensing = new LicensingService({
        capabilities: d.capabilities,
        subscriptions: d.subscriptions.store,
        crm: crmPort,
        catalog: async () => quoteCatalogFromSite(await webAdmin!.site("published")),
        now: d.subscriptions.now,
      });
      const licErr = (res: express.Response, e: unknown) => {
        if (e instanceof LicensingError) return void res.status(e.code === "not_found" ? 404 : e.code === "invalid_state" ? 409 : 400).json({ error: e.code, message: e.message });
        throw e;
      };
      const subId = z.coerce.number().int().positive();
      const licBody = z.object({ activate: z.boolean().default(true), reason: z.string().trim().max(300).optional() }).strict();
      router.post(
        "/subscriptions/:id/licences/preview",
        requireScope("subscriptions:read"),
        wrap(async (req, res) => {
          const b = licBody.parse(req.body ?? {});
          try {
            res.json(await licensing.preview(subId.parse(req.params.id), { activate: b.activate }));
          } catch (e) {
            licErr(res, e);
          }
        }),
      );
      router.post(
        "/subscriptions/:id/licences/apply",
        requireScope("subscriptions:write"),
        requireScope("entitlements:write"),
        wrap(async (req, res) => {
          const b = licBody.parse(req.body ?? {});
          const a = getAuth(req)!.actor;
          try {
            res.json(await licensing.apply(subId.parse(req.params.id), { activate: b.activate, actor: `${a.type}:${a.id}`, reason: b.reason ?? null }));
          } catch (e) {
            licErr(res, e);
          }
        }),
      );
      router.get(
        "/tenants/:id/capabilities",
        requireScope("tenants:read"),
        wrap(async (req, res) => {
          const id = idSchema.parse(req.params.id);
          if (!(await d.reader.getTenant(id))) throw new RegistryError("not_found", "Tenant no encontrado");
          const [capabilities, events] = await Promise.all([licensing.list(id), licensing.events(id)]);
          res.json({ capabilities, events });
        }),
      );
      router.put(
        "/tenants/:id/capabilities/:capability",
        requireScope("entitlements:write"),
        wrap(async (req, res) => {
          const id = idSchema.parse(req.params.id);
          if (!(await d.reader.getTenant(id))) throw new RegistryError("not_found", "Tenant no encontrado");
          const b = z.object({ status: z.enum(CAPABILITY_STATUSES), reason: z.string().trim().min(5).max(300), siteId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/).optional() }).strict().parse(req.body);
          const a = getAuth(req)!.actor;
          try {
            res.json({ events: await licensing.setStatus(id, req.params.capability, b.status, { actor: `${a.type}:${a.id}`, reason: b.reason, siteId: b.siteId }) });
          } catch (e) {
            licErr(res, e);
          }
        }),
      );
    }
    if (d.organization) {
      const org = new OrganizationService({ store: d.organization, subscriptions: d.subscriptions.store, catalog: async () => quoteCatalogFromSite(await webAdmin!.site("published")), now: d.subscriptions.now });
      const orgErr = (res: express.Response, e: unknown) => {
        if (e instanceof OrganizationError) return void res.status(e.code === "not_found" ? 404 : e.code === "invalid_input" ? 400 : e.code === "limit" ? 422 : 409).json({ error: e.code, message: e.message });
        throw e;
      };
      const tenantOf = async (req: express.Request) => {
        const id = idSchema.parse(req.params.id);
        if (!(await d.reader.getTenant(id))) throw new RegistryError("not_found", "Tenant no encontrado");
        return id;
      };
      const orgRoute = (fn: (req: express.Request, tenantId: string, actor: string) => Promise<unknown>) =>
        wrap(async (req, res) => {
          const tenantId = await tenantOf(req);
          const a = getAuth(req)!.actor;
          try {
            res.json(await fn(req, tenantId, `${a.type}:${a.id}`));
          } catch (e) {
            orgErr(res, e);
          }
        });
      const slug = z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/);
      router.get("/tenants/:id/organization", requireScope("tenants:read"), orgRoute((_req, t) => org.overview(t)));
      router.post(
        "/tenants/:id/fiscal-entities",
        requireScope("tenants:write"),
        orgRoute((req, t, actor) => {
          const b = z.object({ entityId: slug, legalName: z.string().max(200), taxId: z.string().max(32), country: z.string().length(2).optional(), address: z.string().max(300).nullable().optional() }).strict().parse(req.body);
          return org.createFiscalEntity(t, b, actor);
        }),
      );
      router.post("/tenants/:id/fiscal-entities/:entity/archive", requireScope("tenants:write"), orgRoute((req, t) => org.archiveFiscalEntity(t, slug.parse(req.params.entity))));
      router.post(
        "/tenants/:id/sites",
        requireScope("tenants:write"),
        orgRoute((req, t, actor) => {
          const b = z.object({ siteId: slug, name: z.string().max(160), fiscalEntityId: slug.nullable().optional() }).strict().parse(req.body);
          return org.createSite(t, b, actor);
        }),
      );
      router.post("/tenants/:id/sites/:site/archive", requireScope("tenants:write"), orgRoute((req, t) => org.archiveSite(t, slug.parse(req.params.site))));
    }
    // La conversión excepcional de una prueba la monta el orquestador (más abajo); sin él, la ruta responde 409
    const trialConversion: { run?: TrialExceptionConversion } = {};
    if (d.capabilities && d.trials && d.provisioning && d.platformDomain) {
      const crmD = d.crm;
      const trialService = new TrialService({ store: d.trials.store, subscriptions: d.subscriptions.store, now: d.subscriptions.now, limits: d.trials.limits, blockedDomains: d.trials.blockedDomains });
      const catalogPort = catalogFromWebStore(d.web.store);
      const licensingForTrials = new LicensingService({ capabilities: d.capabilities, subscriptions: d.subscriptions.store, crm: crmPort, catalog: async () => quoteCatalogFromSite(await webAdmin!.site("published")), now: d.subscriptions.now });
      const provisioning = d.provisioning;
      const platformDomain = d.platformDomain;
      const onboarding = new TrialOnboardingService({
        trials: trialService,
        provision: (req) => provisioning.run(req, { type: "crm", id: "trial-onboarding" }),
        platformDomain,
        companies: {
          byTenant: async (tenantId) => (await crmD.store.list("companies", { tenantId }, { limit: 1 }))[0] ?? null,
          create: async (input, actor) => {
            let c: { id: number };
            try {
              c = await crmD.service.createCompany({ name: input.name, email: input.email }, actor);
            } catch (e) {
              // Otra empresa (otra prueba o un cliente) ya se llama así: se distingue por su plataforma
              // en lugar de dejar la prueba sin activar para siempre
              if (!(e instanceof CrmError && e.code === "conflict")) throw e;
              c = await crmD.service.createCompany({ name: `${input.name} (${input.tenantId})`, email: input.email }, actor);
            }
            return crmD.store.update("companies", c.id, { tenantId: input.tenantId });
          },
        },
        subscriptions: svc,
        licensing: licensingForTrials,
        priceOf: async (key, kind) => (await catalogPort.offer()).find((p) => p.key === key)?.prices.find((x) => x.kind === kind && x.status === "approved")?.id ?? null,
        notify: d.trials.notify ?? logOnlyTrialNotifier,
        reissueInvite: (tenantId) => provisioning.reissueAdminInvite(tenantId),
        now: d.subscriptions.now,
      });
      router.use("/trials", createTrialAdminRouter({ onboarding, trials: trialService, store: d.trials.store, convert: trialConversion }));
      if (d.trials.publicEnabled) publicTrial = createPublicTrialRouter({ onboarding, autoProvision: !!d.trials.autoProvision });
    }
    if (d.orders && d.capabilities) {
      // El modo sale de la configuración de Stripe aunque Stripe no se monte (p. ej. live sin la 0013)
      if (d.stripe && d.orders.mode && d.orders.mode !== d.stripe.config.mode) throw new Error("El modo de los pedidos no coincide con el de Stripe");
      const ordersMode = d.stripe?.config.mode ?? d.orders.mode ?? "test";
      // Orquestador comercial: encadena contrato → confirmación → suscripción → licencias → activación
      const licensing = new LicensingService({ capabilities: d.capabilities, subscriptions: d.subscriptions.store, crm: crmPort, catalog: async () => quoteCatalogFromSite(await webAdmin!.site("published")), now: d.subscriptions.now });
      const coverageHeld = d.stripe ? async (orderId: number) => (await d.stripe!.store.activeHolds(orderId)).length > 0 : undefined;
      const ordersStore = d.orders.store;
      const tenantStatusSync = new TenantStatusSync({
        getTenant: (id) => d.reader.getTenant(id),
        setStatus: (id, to, a, o) => d.registry.setStatus(id, to, a, o),
        orders: (companyId) => ordersStore.list({ companyId, limit: 1000 }),
        events: d.commercialEvents?.append ? (d.commercialEvents as CommercialEventSink) : undefined,
        now: d.subscriptions.now,
      });
      const orchestrator = new CommercialOrchestrator({
        store: d.orders.store,
        crm: d.crm.service,
        crmStore: d.crm.store,
        subscriptions: svc,
        subscriptionStore: d.subscriptions.store,
        shadow: shadowBilling,
        catalog: catalogFromWebStore(d.web.store),
        quote: async (r) => quote(quoteCatalogFromSite(await webAdmin!.site("published")), r),
        licensing,
        capabilities: d.capabilities,
        platform: d.provisioning && d.platformDomain ? createContractActivation({ provisioning: d.provisioning, platformDomain: d.platformDomain, actor: { type: "crm", id: "orchestrator" }, notifyWelcome: d.mail?.platform?.assistedWelcome() }) : undefined,
        notify: d.mail?.platform ? d.mail.platform.orderNotifier({ crmStore: d.crm.store, orders: d.orders.store, reader: d.reader, mode: ordersMode }) : undefined,
        trials: d.trials ? new TrialService({ store: d.trials.store, subscriptions: d.subscriptions.store, now: d.subscriptions.now, limits: d.trials.limits, blockedDomains: d.trials.blockedDomains }) : undefined,
        payments: d.orders.payments ?? null,
        mode: ordersMode,
        graceDays: d.orders.graceDays,
        coverageHeld,
        // Estado de la empresa en el registro según su situación comercial (nunca la deja en «trial» si ya paga)
        tenantStatus: tenantStatusSync,
        now: d.subscriptions.now,
      });
      // Conversión de una prueba por excepción administrativa: SIEMPRE con pedido y aprobación tipificada
      if (d.trials) {
        const trialStore = d.trials.store;
        trialConversion.run = async (trialId, input, who) => {
          const t = await trialStore.get(trialId);
          if (!t) throw new OrderError("not_found", "Prueba no encontrada");
          const plan = input.plan ?? t.configuration?.plan ?? "essential";
          let { order } = await orchestrator.create({ idempotencyKey: `trial-exception-${String(trialId).padStart(8, "0")}`, trialId, request: { plan, interval: input.interval ?? "month", items: [] } }, who);
          if (order.state === "requested" || order.state === "quoted") order = (await orchestrator.accept(order.id, { signatureRef: `admin-exception:${input.category}`, approvalReason: input.reason }, who)).order;
          let error: string | null = order.lastError;
          if (order.state === "contracted") ({ order, error } = await orchestrator.approve(order.id, { reason: input.reason, category: input.category, reference: input.reference }, who));
          const after = await trialStore.get(trialId);
          return { order, trial: after ? TrialService.view(after) : null, error: order.state === "active" ? null : error };
        };
      }
      router.use("/orders", createOrdersRouter(orchestrator));
      if (d.lifecycle) {
        const policy = d.lifecycle.policy;
        const lifecycle = new LifecycleEngine({
          orders: d.orders.store,
          subscriptions: d.subscriptions.store,
          licensing,
          orchestrator,
          trials: d.trials?.store,
          coverageHeld,
          graceMs: orchestrator.paymentsConfig.graceDays * 86_400_000,
          policy,
          lock: d.lifecycle.lock,
          now: d.subscriptions.now,
        });
        startLifecycleScheduler({ engine: lifecycle, policy });
        // Plan de solo lectura: qué haría el motor ahora (nada se aplica desde aquí)
        router.get(
          "/lifecycle/plan",
          requireScope("ops:read"),
          wrap(async (_req, res) => {
            const { enabled, mode, modeReason, intervalMs, dunningDays, trialNoticeDays, retentionDays } = policy;
            res.json({ policy: { enabled, mode, modeReason, intervalMs, dunningDays, trialNoticeDays, retentionDays, graceDays: orchestrator.paymentsConfig.graceDays }, plan: await lifecycle.plan() });
          }),
        );
      }
      if (d.stripe) {
        const st = d.stripe;
        const stripeCatalog = catalogFromWebStore(d.web.store);
        // En live sin política fiscal, Checkout no se monta aunque se pida (y el servicio también lo rechazaría)
        const checkout = st.checkoutEnabled && st.urls && !checkoutBlockedReason(st.config)
          ? new StripeCheckoutService({ store: st.store, gateway: st.gateway, orders: d.orders.store, crmStore: d.crm.store, catalog: stripeCatalog, urls: st.urls, now: d.subscriptions.now, namespace: st.config.namespace, mode: st.config.mode, taxPolicy: st.config.taxPolicy, fiscalScenarios: st.fiscal?.scenarios, taxExpectations: st.fiscal?.taxExpectations })
          : null;
        const processor = new StripeEventProcessor({ store: st.store, gateway: st.gateway, orders: d.orders.store, orchestrator, now: d.subscriptions.now, namespace: st.config.namespace, mode: st.config.mode, taxExpectations: st.fiscal?.taxExpectations, catalog: stripeCatalog });
        const reconciler = new StripeReconciler({ store: st.store, gateway: st.gateway, processor, now: d.subscriptions.now, retentionDays: st.config.eventsRetentionDays, mode: st.config.mode });
        const rechecks = new Map<string, number>();
        const stripeNow = d.subscriptions.now;
        // Tras guardar un evento del webhook se procesa enseguida (los fallos quedan para el reintento)
        stripeKick = () => void processor.processDue(10).catch(() => undefined);
        if (st.workerEnabled) startStripeWorker({ processor, reconciler });
        const selfServiceOk = st.selfService && !!checkout && !!d.publicIntake && publicOrigins.size > 0;
        if (st.publicStatus || selfServiceOk) {
          const pc = express.Router();
          if (selfServiceOk) {
            const ss = new SelfServiceCheckout({ crm: d.crm.service, orders: d.orders.store, orchestrator, checkout: checkout!, catalog: stripeCatalog, ticketSecret: d.publicIntake!.secret, origins: publicOrigins, termsVersion: st.termsVersion, now: d.subscriptions.now, buyers: st.store, mode: st.config.mode, consent: st.fiscal?.consent });
            pc.use(createSelfServiceRouter(ss, publicOrigins));
          }
          if (st.publicStatus) pc.get(
            "/status",
            rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: true, legacyHeaders: false, keyGenerator: (req) => `ip:${ipKeyGenerator(req.ip ?? "")}` }),
            wrap(async (req, res) => {
              const sessionId = String(req.query.session_id ?? "");
              res.setHeader("Cache-Control", "no-store");
              if (!sessionIdRe(st.config.mode).test(sessionId)) return void res.status(400).json({ error: "invalid_session_id" });
              const view = await checkoutStatus({ store: st.store, orders: d.orders!.store, processor, platformDomain: d.platformDomain ?? null, rechecks, now: stripeNow, mode: st.config.mode }, sessionId);
              if (!view) return void res.status(404).json({ error: "not_found" });
              res.json(view);
            }),
          );
          // Lo que no exista aquí termina aquí (no cae en la captación ni en la autenticación de operadores)
          pc.use((_req, res) => void res.status(404).json({ error: "not_found" }));
          publicCheckout = pc;
        }
        router.use("/stripe", createStripeRouter({ config: st.config, store: st.store, gateway: st.gateway, catalog: stripeCatalog, checkout, processor, reconciler, now: d.subscriptions.now, orders: d.orders.store, fiscal: st.fiscal, legalUrls: st.fiscal?.legalUrls }));
      }
      // Webhook del proveedor de PRUEBAS: autenticado por firma (antes del montaje del router con tokens)
      if (d.orders.payments) app.post("/cp/v1/payments/test/webhook", paymentsWebhookHandler(orchestrator));
    }
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
    // Listado global de altas para Operación SaaS (sin datos personales: ni el correo del administrador)
    const provisioningStatus = z.enum(["pending", "running", "failed", "completed", "aborted"]);
    router.get(
      "/provisioning",
      requireScope("tenants:read"),
      wrap(async (req, res) => {
        const status = provisioningStatus.optional().parse(req.query.status);
        const limit = z.coerce.number().int().min(1).max(200).default(50).parse(req.query.limit);
        const offset = z.coerce.number().int().min(0).max(100_000).default(0).parse(req.query.offset);
        const { items, total } = await d.provisioning!.list({ status, limit, offset });
        res.json({
          provisioning: items.map((r) => {
            const failed = Object.entries(r.steps).find(([, s]) => s?.state === "failed")?.[0] ?? null;
            return {
              tenantId: r.tenantId,
              displayName: r.request.displayName,
              status: r.status,
              attempts: r.attempts,
              completedSteps: Object.values(r.steps).filter((s) => s?.state === "done").length,
              failedStep: r.status === "failed" ? failed : null,
              lastError: r.lastError,
              updatedAt: r.updatedAt,
            };
          }),
          total,
          limit,
          offset,
        });
      }),
    );
    // Reintento idempotente con la petición GUARDADA (el cuerpo no se admite: no se puede cambiar el alta)
    router.post(
      "/provisioning/:id/retry",
      requireScope("provisioning:write"),
      wrap(async (req, res) => {
        if (req.body && Object.keys(req.body).length) throw new ProvisioningError("invalid_request", "El reintento usa la petición guardada: no admite cuerpo");
        const r = await d.provisioning!.retry(idSchema.parse(req.params.id), actor(req));
        res.status(r.status === "completed" ? 200 : 202).json(r);
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

  // Registro de eventos comerciales: solo lectura y siempre acotado a una operación, empresa o tenant
  if (d.commercialEvents) {
    const log = d.commercialEvents;
    router.get(
      "/commercial-events",
      requireScope("ops:read"),
      wrap(async (req, res) => {
        const q = req.query as Record<string, string | undefined>;
        const bad = (message: string) => void res.status(400).json({ error: "invalid_input", message });
        const badInt = ["companyId", "orderId", "subscriptionId", "trialId", "afterId", "limit"].find((k) => q[k] !== undefined && !(Number.isInteger(Number(q[k])) && Number(q[k]) > 0));
        if (badInt) return bad(`${badInt} no es válido`);
        const int = (k: string) => (q[k] === undefined ? undefined : Number(q[k]));
        const f: CommercialEventFilter = {
          correlationId: q.correlationId?.slice(0, 40),
          tenantId: q.tenantId?.slice(0, 63),
          companyId: int("companyId"),
          orderId: int("orderId"),
          subscriptionId: int("subscriptionId"),
          trialId: int("trialId"),
          afterId: int("afterId"),
          limit: Math.min(int("limit") ?? 200, 1000),
        };
        if ([f.correlationId, f.tenantId, f.companyId, f.orderId, f.subscriptionId, f.trialId].every((x) => x === undefined))
          return bad("Indica correlationId, tenantId, companyId, orderId, subscriptionId o trialId");
        if (q.types) {
          const types = q.types.split(",").map((t) => t.trim());
          if (types.some((t) => !(COMMERCIAL_EVENT_TYPES as readonly string[]).includes(t))) return bad("Tipo de evento desconocido");
          f.types = types as CommercialEventType[];
        }
        res.json({ events: await log.list(f) });
      }),
    );
  }

  // Correo: modo efectivo y diagnóstico de la cuenta del proveedor (solo lecturas; nunca envía)
  if (d.mail) {
    const mail = d.mail;
    router.get(
      "/mail/diagnostics",
      requireScope("ops:read"),
      wrap(async (_req, res) => {
        const p = mail.platform?.policy;
        res.json({
          platformOutbox: !!mail.platform,
          mode: mail.platform?.service.mode ?? "off",
          degradedReason: p?.degradedReason ?? null,
          sendingDomain: p?.sendingDomain ?? null,
          webhookConfigured: !!mail.webhookToken && mail.webhookToken.length >= 32,
          provider: mail.diagnostics ? await mail.diagnostics() : null,
        });
      }),
    );
  }

  app.use("/cp/v1", router);
  app.get("/healthz", (_req, res) => void res.json({ ok: true }));
  // Readiness: BD del registro. Sin detalles internos (solo un estado por comprobación).
  app.get("/readyz", (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (!d.health) return void res.json({ status: "ready", checks: {} });
    const ms = d.health.timeoutMs ?? 3000;
    Promise.race([d.health.registryPing(), new Promise((_r, rej) => setTimeout(() => rej(new Error("timeout")), ms).unref?.())]).then(
      () => void res.json({ status: "ready", checks: { registry: "ok" } }),
      () => {
        opsLog("error", "Health", "registry_unavailable", {});
        res.status(503).json({ status: "degraded", checks: { registry: "error" } });
      },
    );
  });
  app.use((_req, res) => void res.status(404).json({ error: "not_found" }));
  // Errores no capturados por las rutas (p. ej. los que delegan con `next(e)`): JSON genérico y log estructurado
  app.use((e: unknown, req: Request, res: Response, _next: NextFunction) => {
    const status = (e as { status?: number; statusCode?: number })?.status ?? (e as { statusCode?: number })?.statusCode;
    if (typeof status === "number" && status >= 400 && status < 500) return void res.status(status).json({ error: "invalid_request" });
    opsLog("error", "ControlPlane", "unhandled_error", { method: req.method, error: e instanceof Error ? e.name : "error" });
    if (res.headersSent) return;
    res.status(500).json({ error: "internal_error", message: "Error interno" });
  });
  return app;
}
