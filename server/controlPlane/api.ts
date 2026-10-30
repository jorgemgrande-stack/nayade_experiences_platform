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
import mysql from "mysql2/promise";
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import { BUILTIN_MODULES } from "../_core/modules/builtin";
import type { CommercialEventDispatchQueue, CommercialEventReader } from "../commercialEvents/log";
import { TEMPLATE_CATALOG, catalogView } from "../notifications/catalog";
import { hasPreview, previewTemplate } from "../notifications/preview";
import { allTestEmails } from "../mail/testCatalog";
import { MAIL_STATUSES } from "../mail/types";
import type { MailLedgerReader } from "../mail/store";
import { choosePublicDomain } from "../_core/tenantIdentity";
import { NotificationDispatcher } from "../notifications/dispatcher";
import type { CommercialEventSink } from "../commercialEvents/types";
import { TenantStatusSync } from "../orchestrator/tenantStatus";
import { COMMERCIAL_EVENT_TYPES, type CommercialEventFilter, type CommercialEventType } from "../commercialEvents/types";
import { CORE_VERSION } from "../_core/modules/runtime";
import { assertCanActivate, assertCanDeactivate, buildCatalog, tenantModules, type ModulePriceRef, type PlanRef } from "../_core/modules/catalog";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { DEFAULT_QUOTAS, type DefaultQuota } from "../_core/erm/quota";
import { UNMEASURED, WARNING_RATIO, tenantResources, type ResourceState } from "../_core/erm/overview";
import { ESTIMATED_COST_MODEL, tenantCosts, type CostModel } from "../_core/erm/costs";
import { mysqlTenantDbProbe, tenantMetrics, type TenantDbProbe } from "../_core/erm/tenantMetrics";
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
import { QuotaExceptionError, withState, type QuotaExceptionStore } from "../_core/erm/quotaExceptions";
import { BUSINESS_METRICS, POLICY_CRITICAL_RATIO, POLICY_WARNING_RATIO, explainLimit } from "../_core/erm/policy";
import { limitWithoutExceptions, tenantPolicy } from "../quotaPolicyCatalog";
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
import type { AlertSchedulerStatus } from "../_core/ops/alertScheduler";
import { createCrmRouter } from "../crm/api";
import { CrmOnboarding } from "../crm/onboarding";
import type { CrmService } from "../crm/service";
import { CrmError } from "../crm/types";
import type { CrmStore } from "../crm/store";
import type { TicketService } from "../_core/support/tickets";
import { createTicketsRouter } from "./tickets";
import { createCustomerTicketsRouter } from "../support/customerTickets";
import type { SupportAdmin } from "../_core/support/grants";
import { createPublicIntakeRouter, type PublicIntakeConfig } from "../crm/publicApi";
import { WebRequestService } from "../crm/webRequests";
import type { LeadNoticeService } from "../crm/leadNotices";
import { createLeadNoticesRouter } from "../crm/leadNoticesApi";
import type { AdminAlertService } from "../adminAlerts/service";
import { createAdminAlertsRouter } from "../adminAlerts/api";
import type { DataRequestService } from "../dataRequests/service";
import { createDataRequestsRouter } from "../dataRequests/api";
import type { CommunicationsService } from "../communications/service";
import { createCommunicationsRouter } from "../communications/api";
import { createCommunicationsPublicRouter } from "../communications/publicApi";
import { LEAD_REQUEST_LABEL, type LeadRequest } from "../crm/types";
import { creditNoteNotice, domainConnectedNotice, domainPendingNotice, purchasePendingNotice, type CustomerNoticeDeps } from "../notifications/customerTriggers";
import { WebAdminService } from "../web/service";
import type { WebStore } from "../web/store";
import { createWebAdminRouter } from "../web/api";
import { createPublicSiteRouter } from "../web/publicSite";
import { createSubscriptionsRouter } from "../subscriptions/api";
import { catalogFromWebStore, crmFromStore } from "../subscriptions/ports";
import { SubscriptionService as ContractSubscriptionService } from "../subscriptions/service";
import { ShadowBillingService } from "../subscriptions/shadow";
import type { SubscriptionStore } from "../subscriptions/store";
import { revenueByTenant, revenueMetrics } from "../revenue/metrics";
import { AtRiskError, AtRiskService, type AtRiskDeps } from "../revenue/atRisk";
import { Metrics } from "../_core/metering";
import { quote, type QuoteRequest } from "../catalog/quote";
import { CAPABILITY_STATUSES } from "../_core/capabilities/model";
import type { CapabilityStore } from "../_core/capabilities/store";
import { LicensingError, LicensingService } from "../licensing/service";
import type { TenantLimitStore } from "../_core/limits/store";
import { TrialService, type TrialLimits } from "../trials/service";
import type { TrialStore } from "../trials/store";
import { TrialOnboardingService, type TrialNotifier } from "../trials/onboarding";
import { createPublicTrialRouter, createTrialAdminRouter, type TrialExceptionConversion } from "../trials/api";
import { OrderError, TERMINAL_STATES } from "../orchestrator/types";
import { OrganizationError, OrganizationService, type OrganizationStore } from "../organization/service";
import { CommercialOrchestrator } from "../orchestrator/service";
import { LifecycleEngine, startLifecycleScheduler } from "../lifecycle/engine";
import type { LifecyclePolicy } from "../lifecycle/policy";
import type { SchedulerLock } from "../trials/scheduler";
import { createStripeRouter } from "../stripe/api";
import { StripeEventProcessor } from "../stripe/events";
import type { SubscriptionChangeStore } from "../stripe/changes";
import type { InvoiceLineStore } from "../stripe/invoiceLines";
import { ModulePurchaseService } from "../stripe/purchases";
import { DeferredItemsService } from "../stripe/deferredItems";
import { ExternalService, type ExternalUrls } from "../external/service";
import type { ExternalStore } from "../external/store";
import { createContractAcceptanceRouter, createExternalRouter } from "../external/api";
import { InvoicingService } from "../invoicing/service";
import type { InvoicingStore } from "../invoicing/store";
import { ChargeService, type ChargeStore } from "../invoicing/charges";
import { createInvoicingRouter } from "../invoicing/api";
import { invoiceHtml } from "../invoicing/document";
import { TenantPlanService, createTenantPlanRouter } from "../commerce/tenantPlan";
import { ChargePaymentService, type ChargePaymentStore } from "../invoicing/chargePayments";
import type { CompanyFiscal } from "../invoicing/rules";
import { ISSUER } from "../stripe/issuer";
import { createBillingPortalRouter, createPurchasesRouter } from "../stripe/purchasesApi";
import { createPanelCatalogRouter } from "../commerce/panelCatalog";
import { createPanelUsageRouter } from "../commerce/panelUsage";
import { BillingPortalService } from "../stripe/billingPortal";
import { StripeReconciler, startStripeWorker } from "../stripe/reconcile";
import { stripeWebhookHandler } from "../stripe/webhook";
import { checkoutStatus, sessionIdRe } from "../stripe/status";
import { SelfServiceCheckout, createSelfServiceRouter } from "../stripe/selfService";
import { VatVerifier, type ViesPort } from "../stripe/vies";
import { WithdrawalService } from "../withdrawals/service";
import { createWithdrawalAdminRouter, createWithdrawalCommerceRouter } from "../withdrawals/api";
import type { WithdrawalStore } from "../withdrawals/store";
import type { GwEvent } from "../stripe/gateway";
import { StripeCheckoutService, type CheckoutUrls } from "../stripe/checkout";
import { checkoutBlockedReason, type StripeConfig } from "../stripe/config";
import type { StripeGateway } from "../stripe/gateway";
import type { ConsentVersions, FiscalScenario, TaxTreatment } from "../stripe/buyerProfile";
import type { StripeStore } from "../stripe/store";
import type { OrderStore } from "../orchestrator/store";
import type { TestPaymentPort } from "../orchestrator/payments";
import { createOrdersRouter, paymentsWebhookHandler } from "../orchestrator/api";
import { subscriptionBilling } from "../orchestrator/subscriptionBilling";
import { buildRelationshipExport, RelationshipNotFoundError } from "./relationshipExport";
import { CalendarUnavailableError } from "./madridCalendar";
import { createContractActivation } from "../crm/activation";
import type { PlatformMailer } from "../mail/platform";
import type { MailService } from "../mail/service";
import { maskRecipient, normalizeEmail, type MailPolicy } from "../mail/policy";
import { MANAGED_CATEGORIES, MAX_MANAGED_ADDRESSES, type SandboxAccess } from "../mail/sandboxAccess";
import { brevoWebhookHandler, postmarkWebhookHandler } from "../mail/webhook";

/** Aviso por defecto: NO envía nada; solo deja constancia (sin correo ni token) de que hay un aviso pendiente. */
const logOnlyTrialNotifier: TrialNotifier = {
  verification: async (_to, l) => void console.log(JSON.stringify({ ctx: "Trials", event: "verification_not_sent", trialId: l.trialId })),
  welcome: async (_to, i) => void console.log(JSON.stringify({ ctx: "Trials", event: "welcome_not_sent", tenantId: i.tenantId })),
  expiryNotice: async (_to, i) => void console.log(JSON.stringify({ ctx: "Trials", event: "expiry_notice_not_sent", trialId: i.trialId, daysLeft: i.daysLeft })),
  statusNotice: async (_to, i) => void console.log(JSON.stringify({ ctx: "Trials", event: "status_notice_not_sent", trialId: i.trialId, kind: i.kind })),
};
import { quoteCatalogFromSite } from "../catalog/snapshot";
import { rebindRequestContext, requestIdMiddleware, requestIdOf } from "../_core/ops/requestContext";
import { opsLog } from "../_core/ops/log";
import { diagnoseTenant } from "../_core/ops/diagnostics";
import type { BackupInventory, BackupRecord } from "../_core/ops/backupInventory";
import type { BackupCopyLedger } from "../_core/ops/backupCopies";
import { BACKUP_TENANT_STATUSES } from "../_core/ops/backupJob";
import { registerTenantAccessRoutes, type CoreAccessClient } from "./tenantAccess";
import { deliverAdminInvite, withAdminInviteDelivery } from "./adminInviteDelivery";
import type { IntegrationHealth } from "../_core/credentials/health";
import type { ModulesTechnicalReport } from "../_core/modules/technical";
import { moduleLayers } from "./tenantModulesTechnical";
import { CostModelConflict, activeCostModel, type CostModelStore } from "../_core/erm/costModelStore";
import { costModelInputSchema } from "../_core/erm/costs";
import { OVERAGE_POLICY, WATCHED, collectorStatus, dailyUsage, detectAnomalies, exportDailyCsv, lastFullMadridDay } from "../_core/erm/insights";
import { integrationStatus, mysqlIntegrationRows, type IntegrationRow } from "./tenantIntegrations";
import { pendingCount, schemaState, tenantMigrations } from "./schemaVersions";

export interface ControlPlaneDeps {
  tokens: ServiceToken[];
  registry: TenantRegistryService;
  reader: TenantRegistryReader;
  /** `apply`/`remove`/`listModuleTenants`/`activeCounts` los da `EntitlementAdmin` (MySQL); sin ellos esas rutas responden 501. */
  entitlements: Pick<EntitlementAdmin, "listEntitlements" | "grant" | "setStatus" | "revoke"> &
    Partial<Pick<EntitlementAdmin, "apply" | "remove" | "listModuleTenants" | "activeCounts">>;
  quotas: Pick<QuotaAdmin, "listQuotas" | "set" | "remove">;
  provisioning?: ProvisioningService;
  billing?: SubscriptionService;
  billingStore?: BillingStore;
  usage?: UsageStore;
  /** Modelo de costes del Resource Manager (ERM_COST_MODEL); por defecto, la estimación. */
  costModel?: { model: CostModel; error: string | null };
  /** Tarifas editables desde Admin (registro 0014); sin ella, solo las del entorno o la estimación. */
  costModelStore?: CostModelStore;
  /** Sonda de agregados de la base de cada empresa (tamaño y usuarios); por defecto, con su DSN del registro. */
  tenantDbProbe?: TenantDbProbe;
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
  ops?: { incidents: IncidentService; runAlerts?: () => Promise<AlertRunResult | null>; alertStatus?: () => AlertSchedulerStatus };
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
  /** Accesos de las empresas (Clientes SaaS → Accesos): el Core ejecuta cada acción en el contexto de la empresa. */
  tenantAccess?: { client: CoreAccessClient };
  /** Lectura de las integraciones de una empresa (solo proveedor, campo, fecha y autor); por defecto, con su DSN. */
  integrationRows?: (tenantId: string) => Promise<IntegrationRow[] | null>;
  /** Migraciones de empresa disponibles en esta versión del código (por defecto, db/migrations de la imagen). */
  schemaMigrations?: () => string[];
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
  /** Límites contratados y uso declarado por cada empresa (registro 0013). */
  limits?: TenantLimitStore;
  /** Excepciones comerciales de cuota con caducidad (registro 0016). Sin ellas, las rutas de excepciones responden 501. */
  quotaExceptions?: QuotaExceptionStore;
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
  /** Desistimiento de consumidores (CRM 0022). Sin él, la función de desistimiento no se monta. */
  withdrawals?: { store: WithdrawalStore };
  /**
   * Servicios recurrentes de clientes externos (server/external, CRM 0026): contrato, aceptación digital, autorización
   * del método de pago y cobro con Stripe Billing, sin aprovisionar nada en Elephant Core. Requiere `stripe`.
   */
  external?: { store: ExternalStore; urls: ExternalUrls; ipSalt?: string; liveEnabled?: boolean };
  /**
   * Facturación propia (server/invoicing, CRM 0027): facturas por devengo de los servicios externos con el estado de
   * cobro leído de su historial. Sin `issueEnabled` solo prepara borradores (nunca expide).
   */
  invoicing?: { store: InvoicingStore; issueEnabled: boolean; seriesCode: string; charges?: ChargeStore; chargePayments?: ChargePaymentStore };
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
    /** VIES (cliente y días de validez de una comprobación). Sin él, la inversión del sujeto pasivo no se cobra en live. */
    vies?: { client: ViesPort; maxAgeDays: number };
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
    fiscal?: {
      scenarios: Set<FiscalScenario>;
      consent: ConsentVersions;
      taxExpectations?: Map<FiscalScenario, TaxTreatment>;
      legalUrls?: { terms: string | null; privacy: string | null };
      /** Países por escenario (CP_STRIPE_SCENARIO_COUNTRIES) y tipos para particulares (CP_STRIPE_CONSUMER_RATES). */
      countries?: Map<FiscalScenario, Set<string> | "*">;
      consumerRates?: Map<string, number>;
    };
    /**
     * Compra de módulos y ampliaciones desde la plataforma (CRM 0018). `enabled` (CP_COMMERCE_PURCHASES_ENABLED)
     * apagado por defecto; sin `changes`, ni se monta ni se reconocen suscripciones multipartida.
     */
    purchases?: { enabled: boolean; changes: SubscriptionChangeStore; internalTenants?: ReadonlySet<string> };
    /** Portal de facturación (CP_BILLING_PORTAL_ENABLED y CP_BILLING_PORTAL_CONFIGURATION): apagado por defecto. */
    billingPortal?: { enabled: boolean; configurationId: string | null };
    /** Detalle por línea de las facturas cobradas y reparto de reembolsos (CRM 0019). Sin él, como hasta ahora. */
    invoiceLines?: InvoiceLineStore;
  };
  /**
   * Correo transaccional centralizado (server/mail, CRM 0011). `platform`: avisos de Elephant Source
   * (pedidos, alta asistida); webhook de Brevo autenticado por cabecera propia (`webhookToken`);
   * `tenantLane`: bandejas de las empresas para aplicar sus eventos; `diagnostics`: consulta de la cuenta.
   */
  mail?: {
    platform: PlatformMailer | null;
    webhookToken?: string | null;
    /** Token de la cabecera propia del webhook de Postmark (≥ 32 caracteres); sin él, 503. */
    postmarkWebhookToken?: string | null;
    tenantLane?: (tenantId: string) => Promise<MailService | null>;
    diagnostics?: () => Promise<unknown>;
    /** Trazabilidad de la bandeja de PLATAFORMA (solo lectura; sin direcciones completas ni cuerpos). */
    ledger?: MailLedgerReader | null;
    /** Buzones y tipos internos del correo de pruebas autorizados desde el CRM, con la política del entorno (el techo). */
    sandbox?: SandboxAccess | null;
    policy?: MailPolicy;
  };
  /**
   * Comunicaciones transaccionales (server/notifications): despachador de eventos comerciales. `since` es el
   * corte (ms): nada anterior se notifica. Sin él, solo se publica el catálogo (no se despacha nada).
   */
  notifications?: { since: number };
  /** Avisos internos de las solicitudes web al equipo (server/crm/leadNotices.ts; CRM 0025). */
  leadNotices?: LeadNoticeService | null;
  /** Alertas administrativas (familia D; server/adminAlerts, CRM 0030). */
  adminAlerts?: AdminAlertService | null;
  /** Solicitudes de derechos de protección de datos (RGPD; server/dataRequests, CRM 0032). */
  dataRequests?: DataRequestService | null;
  /** Centro de envíos del CRM y consentimiento comercial por contacto (server/communications, CRM 0031). */
  communications?: CommunicationsService | null;
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
    // Webhook de Postmark (proveedor alternativo): mismo mecanismo con su propio token (POSTMARK_WEBHOOK_TOKEN)
    app.post(
      "/cp/v1/mail/postmark/webhook",
      rateLimit({ windowMs: 60_000, limit: 600, standardHeaders: true, legacyHeaders: false, keyGenerator: (req) => `ip:${ipKeyGenerator(req.ip ?? "")}` }),
      wrap(
        postmarkWebhookHandler({
          token: mail.postmarkWebhookToken,
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
  const leadNotices = d.leadNotices ?? null;
  const adminAlerts = d.adminAlerts ?? null;
  const crmStoreForAlerts = d.crm?.store;
  // Alerta administrativa de la solicitud (sin repetirla a quien ya recibe el aviso comercial de ese tipo)
  const leadAlert = async (r: LeadRequest) => {
    if (!adminAlerts || !crmStoreForAlerts) return;
    const lead = (await crmStoreForAlerts.get("leads", r.leadId).catch(() => null)) as { companyName?: string | null } | null;
    await adminAlerts.raise("admin.lead_request", {
      key: `lead-request:${r.id}`,
      occurredAt: r.createdAt,
      company: lead?.companyName ?? null,
      summary: `${LEAD_REQUEST_LABEL[r.type]} desde la web${r.sourcePage ? ` (${r.sourcePage.slice(0, 80)})` : ""}.`,
      status: { label: "Pendiente de atender", tone: "info" },
      reference: r.reference,
      link: `#/comercial/leads/${r.leadId}`,
      skipRecipients: leadNotices ? await leadNotices.noticeEmails(r.type).catch(() => []) : [],
    });
  };
  const webRequests = d.crm
    ? new WebRequestService({
        store: d.crm.store,
        crm: d.crm.service,
        onCreated:
          leadNotices || adminAlerts
            ? async (r) => {
                if (leadNotices) await leadNotices.onCreated(r);
                await leadAlert(r).catch(() => undefined);
              }
            : undefined,
      })
    : undefined;
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
  // Aceptación pública de contratos de servicios externos (solo con el token del enlace): se asigna con Stripe
  let publicAcceptance: express.Router | null = null;
  router.use("/public/contract-acceptance", (req, res, next) => (publicAcceptance ? publicAcceptance(req, res, next) : void res.status(404).json({ error: "not_found" })));
  router.use("/public/checkout", (req, res, next) => (publicCheckout ? publicCheckout(req, res, next) : void res.status(404).json({ error: "not_found" })));
  // Baja de comunicaciones comerciales y encuesta de soporte del Centro de envíos (solo con el enlace firmado)
  if (d.communications) router.use("/public/comunicaciones", createCommunicationsPublicRouter(d.communications));
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
          reason: z.string().trim().max(200).optional(),
        })
        .parse(req.body);
      // Suspender, archivar o borrar deja a la empresa sin servicio: siempre con un motivo que quede en la auditoría
      if (["suspended", "archived", "deleting", "deleted"].includes(body.status) && (body.reason ?? "").length < 5) {
        return void res.status(400).json({ error: "reason_required", message: "Indica el motivo (al menos 5 caracteres) para suspender, archivar o borrar una empresa" });
      }
      res.json({ tenant: await d.registry.setStatus(id, body.status, actor(req), { reason: body.reason }) });
    }),
  );

  // Avisos al cliente sin evento comercial propio (dominio, compra pendiente, rectificativa): server/notifications/customerTriggers.ts
  const customerNotices: CustomerNoticeDeps | null = d.mail?.platform && d.crm ? { send: (t, k, c, to, content) => d.mail!.platform!.send(t, k, c, to, content), crmStore: d.crm.store, supportEmail: d.mail.platform.policy.supportEmail ?? null } : null;

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
      if (customerNotices && dom.kind === "custom" && dom.status === "pending_verification" && d.platformTarget) void domainPendingNotice(customerNotices, { tenantId: id, domain: dom.domain, platformTarget: d.platformTarget, token: dom.verificationToken ?? null });
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
      const dom = await d.registry.activateDomain(req.params.domain.toLowerCase(), actor(req));
      if (customerNotices && dom.kind === "custom") void domainConnectedNotice(customerNotices, { tenantId: dom.tenantId, domain: dom.domain });
      res.json({ domain: dom });
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

  const reasonSchema = z
    .string()
    .trim()
    .min(5, "El motivo debe tener al menos 5 caracteres")
    .max(300, "El motivo admite como máximo 300 caracteres")
    .optional();
  const unknownModule = (res: Response) => void res.status(404).json({ error: "not_found", message: "Módulo desconocido" });
  const notAvailable = (res: Response) =>
    void res.status(501).json({ error: "not_implemented", message: "Operación de licencias no disponible en este despliegue" });
  const entitlementView = (e: { moduleId: string; status: string; validUntil: Date | null; source: string }) => ({
    moduleId: e.moduleId,
    status: e.status,
    validUntil: e.validUntil ? e.validUntil.toISOString() : null,
    source: e.source,
  });

  // PUT = estado final de la licencia (status por defecto «active»; validUntil omitido = sin caducidad).
  // Idempotente y en una sola transacción: repetir la misma petición no deja evento ni sube la versión.
  router.put(
    "/tenants/:id/entitlements/:module",
    requireScope("entitlements:write"),
    wrap(async (req, res) => {
      const id = idSchema.parse(req.params.id);
      const body = z
        .object({
          status: z.enum(["active", "suspended", "expired"]).optional(),
          validUntil: z.string().datetime().nullable().optional(),
          reason: reasonSchema,
        })
        .parse(req.body ?? {});
      const mod = req.params.module;
      if (!BUILTIN_MODULES.some((m) => m.id === mod)) return unknownModule(res);
      if (!d.entitlements.apply) return notAvailable(res);
      const status = body.status ?? "active";
      const current = await d.entitlements.listEntitlements(id);
      // Activar comprueba dependencias; suspender o caducar, que nada activo dependa de él (igual que DELETE)
      if (status === "active") assertCanActivate(BUILTIN_MODULES, current, mod, Date.now());
      else assertCanDeactivate(BUILTIN_MODULES, current, mod, Date.now());
      const r = await d.entitlements.apply(id, mod, { status, validUntil: body.validUntil ? new Date(body.validUntil) : null }, actor(req), body.reason);
      res.json({
        changed: r.changed,
        previous: r.previous ? entitlementView(r.previous) : null,
        entitlement: entitlementView(r.entitlement),
        entitlements: await d.entitlements.listEntitlements(id),
      });
    }),
  );

  // Retira solo la licencia: los datos de la empresa no se tocan. Sin licencia → sin cambios ni evento.
  router.delete(
    "/tenants/:id/entitlements/:module",
    requireScope("entitlements:write"),
    wrap(async (req, res) => {
      const id = idSchema.parse(req.params.id);
      const mod = req.params.module;
      if (!BUILTIN_MODULES.some((m) => m.id === mod)) return unknownModule(res);
      if (!d.entitlements.remove) return notAvailable(res);
      const rawReason = typeof req.query.reason === "string" ? req.query.reason : (req.body as { reason?: unknown } | undefined)?.reason;
      const reason = reasonSchema.parse(rawReason);
      assertCanDeactivate(BUILTIN_MODULES, await d.entitlements.listEntitlements(id), mod, Date.now());
      const r = await d.entitlements.remove(id, mod, actor(req), reason);
      res.json({ changed: r.changed, previous: r.previous ? entitlementView(r.previous) : null });
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
      let counts = new Map<string, number>();
      if (d.entitlements.activeCounts) counts = await d.entitlements.activeCounts(new Date(now));
      else {
        for (const t of tenants) {
          for (const e of await d.entitlements.listEntitlements(t.id)) {
            if (e.status === "active" && (!e.validUntil || e.validUntil.getTime() > now)) counts.set(e.moduleId, (counts.get(e.moduleId) ?? 0) + 1);
          }
        }
      }
      const cat = billingCatalog();
      res.json({
        ...buildCatalog({ manifests: BUILTIN_MODULES, coreVersion: CORE_VERSION, plans: cat?.plans, modulePrices: cat?.modules, activeCounts: counts, tenantCount: tenants.length }),
        commercialCatalog: cat !== null,
      });
    }),
  );
  // Qué empresas usan un módulo: una sola consulta al registro, sin datos empresariales.
  router.get(
    "/modules/:module/tenants",
    requireScope("tenants:read"),
    wrap(async (req, res) => {
      const m = BUILTIN_MODULES.find((x) => x.id === req.params.module);
      if (!m) return unknownModule(res);
      if (!d.entitlements.listModuleTenants) return notAvailable(res);
      const base = Boolean(m.includedInBase);
      const now = Date.now();
      const tenants = (await d.entitlements.listModuleTenants(m.id, base)).map((r) => {
        const lapsed = r.licenseStatus === "active" && r.validUntil !== null && r.validUntil.getTime() <= now;
        return {
          tenantId: r.tenantId,
          displayName: r.displayName,
          tenantStatus: r.tenantStatus,
          included: base,
          state: base ? "included" : lapsed ? "expired" : r.licenseStatus,
          license: r.licenseStatus
            ? {
                status: r.licenseStatus,
                validUntil: r.validUntil ? r.validUntil.toISOString() : null,
                source: r.source,
                updatedAt: r.updatedAt ? r.updatedAt.toISOString() : null,
              }
            : null,
        };
      });
      res.json({
        module: { id: m.id, name: m.name, kind: m.kind, includedInBase: base },
        total: tenants.length,
        active: tenants.filter((t) => t.state === "included" || t.state === "active").length,
        tenants,
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
  // Capas de cada módulo para la empresa: instalado (Core), habilitado (Core), contratado y comercializable
  router.get(
    "/tenants/:id/modules/technical",
    requireScope("tenants:read"),
    wrap(async (req, res) => {
      const id = idSchema.parse(req.params.id);
      const t = await d.reader.getTenant(id);
      if (!t || t.status === "deleted") throw new RegistryError("not_found", "Tenant no encontrado");
      const cat = billingCatalog();
      const sub = d.billingStore ? await d.billingStore.getSubscriptionByTenant(id) : null;
      const planModules = [...(cat?.plans.find((p) => p.id === sub?.planId)?.includedModules ?? []), ...(sub?.modules ?? [])];
      const licensed = tenantModules(BUILTIN_MODULES, await d.entitlements.listEntitlements(id), Date.now(), planModules);
      let report: ModulesTechnicalReport | null = null;
      if (d.tenantAccess && !["provisioning", "archived", "deleting"].includes(t.status)) {
        const a = getAuth(req)!.actor;
        const r = await d.tenantAccess.client.call({ tenantId: id, act: "modules", operator: `${a.type}:${a.id}` }).catch(() => null);
        if (r?.status === 200 && r.body.modules) report = r.body.modules as ModulesTechnicalReport;
      }
      res.json({
        tenantId: id,
        technicalAvailable: report !== null,
        commercialCatalog: cat !== null,
        coreVersion: report?.coreVersion ?? null,
        contractVersion: report?.contractVersion ?? null,
        modules: moduleLayers(licensed, report, cat),
        loadFailures: report?.loadFailures ?? [],
        obsolete: report?.obsolete ?? [],
      });
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

  // ── Política de consumo: límite efectivo con su desglose y excepciones comerciales con caducidad (registro 0016) ──
  const policyOfTenant = async (id: string, now: number) =>
    tenantPolicy({
      grants: d.capabilities ? await d.capabilities.list(id) : null,
      contracted: d.limits ? await d.limits.limits(id) : [],
      overrides: await d.quotas.listQuotas(id),
      defaults: d.quotaDefaults ?? DEFAULT_QUOTAS,
      exceptions: d.quotaExceptions ? await d.quotaExceptions.exceptions(id) : [],
      now,
    });
  const existingTenant = async (req: Request) => {
    const id = idSchema.parse(req.params.id);
    const t = await d.reader.getTenant(id);
    if (!t || t.status === "deleted") throw new RegistryError("not_found", "Tenant no encontrado");
    return id;
  };
  const noExceptions = (res: express.Response) =>
    void res.status(501).json({ error: "not_available", message: "Excepciones de cuota no disponibles: falta la migración 0016 del registro" });
  const exceptionError = (res: express.Response, e: unknown) => {
    if (e instanceof QuotaExceptionError) return void res.status(e.code === "not_found" ? 404 : e.code === "conflict" ? 409 : 400).json({ error: e.code, message: e.message });
    throw e;
  };
  router.get(
    "/tenants/:id/quotas/policy",
    requireScope("tenants:read"),
    wrap(async (req, res) => {
      const id = await existingTenant(req);
      const now = Date.now();
      const p = await policyOfTenant(id, now);
      res.json({
        tenantId: id,
        generatedAt: now,
        plan: p.plan,
        thresholds: { warning: POLICY_WARNING_RATIO, critical: POLICY_CRITICAL_RATIO },
        business: p.business.map((b) => ({ ...b, explanation: explainLimit(b) })),
        resources: p.resources.map((r) => ({ ...r, explanation: explainLimit(r) })),
        exceptionsAvailable: !!d.quotaExceptions,
        exceptions: d.quotaExceptions ? (await d.quotaExceptions.exceptions(id)).map((e) => withState(e, now)) : [],
      });
    }),
  );
  router.get(
    "/tenants/:id/quotas/exceptions",
    requireScope("tenants:read"),
    wrap(async (req, res) => {
      const id = await existingTenant(req);
      if (!d.quotaExceptions) return noExceptions(res);
      const now = Date.now();
      res.json({ exceptions: (await d.quotaExceptions.exceptions(id)).map((e) => withState(e, now)) });
    }),
  );
  router.get(
    "/tenants/:id/quotas/exceptions/history",
    requireScope("tenants:read"),
    wrap(async (req, res) => {
      const id = await existingTenant(req);
      if (!d.quotaExceptions) return noExceptions(res);
      res.json({ history: await d.quotaExceptions.history(id, 200) });
    }),
  );
  router.post(
    "/tenants/:id/quotas/exceptions",
    requireScope("quotas:write"),
    wrap(async (req, res) => {
      const id = await existingTenant(req);
      if (!d.quotaExceptions) return noExceptions(res);
      const b = z
        .object({
          metric: z.string().regex(/^[a-z][a-z0-9_.]{1,63}$/),
          period: z.enum(["total", "minute", "hour", "day", "month"]).default("total"),
          newLimit: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).nullable(),
          reason: z.string().max(300),
          startsAt: z.number().int().positive().optional(),
          expiresAt: z.number().int().positive(),
        })
        .strict()
        .parse(req.body);
      // Las cuotas de negocio no tienen periodo; las del Resource Manager, siempre
      if ((b.period === "total") !== BUSINESS_METRICS.includes(b.metric)) {
        return void res.status(400).json({ error: "invalid_input", message: b.period === "total" ? "Métrica de negocio desconocida (o falta el periodo de una métrica del Resource Manager)" : "Las cuotas de negocio no llevan periodo" });
      }
      const now = Date.now();
      const original = limitWithoutExceptions(await policyOfTenant(id, now), b.metric, b.period);
      const a = getAuth(req)!.actor;
      try {
        const e = await d.quotaExceptions.create(
          { tenantId: id, metric: b.metric, period: b.period, originalLimit: original ?? null, newLimit: b.newLimit, reason: b.reason, operator: `${a.type}:${a.id}`, startsAt: b.startsAt ?? now, expiresAt: b.expiresAt },
          now,
        );
        res.status(201).json({ exception: withState(e, now) });
      } catch (e) {
        exceptionError(res, e);
      }
    }),
  );
  router.post(
    "/tenants/:id/quotas/exceptions/:eid/revoke",
    requireScope("quotas:write"),
    wrap(async (req, res) => {
      const id = await existingTenant(req);
      if (!d.quotaExceptions) return noExceptions(res);
      const eid = z.coerce.number().int().positive().parse(req.params.eid);
      const b = z.object({ reason: z.string().max(300) }).strict().parse(req.body);
      const a = getAuth(req)!.actor;
      const now = Date.now();
      try {
        res.json({ exception: withState(await d.quotaExceptions.revoke(id, eid, { actor: `${a.type}:${a.id}`, reason: b.reason, now }), now) });
      } catch (e) {
        exceptionError(res, e);
      }
    }),
  );

  // ── Resource Manager: consumo frente a límites ─────────────────────────────
  const quotaDefaults = d.quotaDefaults ?? DEFAULT_QUOTAS;
  const rankState: Record<ResourceState, number> = { not_applicable: 0, ok: 1, warning: 2, exceeded: 3 };
  const notConfigured = { available: false, reason: "Medición no configurada (ERM_DATABASE_URL)", unmeasured: UNMEASURED };
  /** Ingreso recurrente por plataforma (real y modo sombra); null si no hay fuente de ingresos montada. */
  const tenantRevenue = async (now: number) => {
    if (!d.external && !d.subscriptions) return null;
    const external = d.external ? await d.external.store.list() : [];
    const tenantOfCompany = new Map<number, string | null>();
    if (d.crm) for (const id of Array.from(new Set(external.map((x) => x.companyId)))) tenantOfCompany.set(id, (await d.crm.store.get("companies", id))?.tenantId ?? null);
    let shadow: Parameters<typeof revenueByTenant>[0]["shadow"] = null;
    if (d.subscriptions) {
      const subscriptions = await d.subscriptions.store.list({ status: "active", limit: 1000 });
      shadow = { subscriptions, items: new Map(await Promise.all(subscriptions.map(async (x) => [x.id, await d.subscriptions!.store.items(x.id)] as const))) };
    }
    return revenueByTenant({ external, tenantOfCompany, shadow, now });
  };
  // Límite de usuarios del plan (se asigna si hay organización y suscripciones; si no, «sin información del plan»)
  let seatLimitOf: ((tenantId: string) => Promise<number | null>) | undefined;
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
  // Métricas de la empresa con su procedencia (medida / calculada / no disponible). Las calculadas leen agregados de la
  // base de la empresa con SUS credenciales (tamaño y usuarios); nunca datos personales
  const tenantProbe = d.tenantDbProbe ?? mysqlTenantDbProbe((id) => d.registry.getActiveDsn(id), (dsn) => mysql.createConnection({ uri: dsn, connectTimeout: 5_000 }));
  router.get(
    "/tenants/:id/metrics",
    requireScope("usage:read"),
    wrap(async (req, res) => {
      const id = idSchema.parse(req.params.id);
      const t = await d.reader.getTenant(id);
      if (!t || t.status === "deleted") throw new RegistryError("not_found", "Tenant no encontrado");
      const days = z.coerce.number().int().min(1).max(90).default(30).parse(req.query.days ?? undefined);
      const live = !["provisioning", "archived", "deleting"].includes(t.status);
      res.json({ tenantId: id, ...(await tenantMetrics({ usage: d.usage, probe: live ? tenantProbe : undefined, seatLimit: seatLimitOf }, id, Date.now(), days)) });
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
  // Coste atribuible por empresa (solo lectura): consumo medido × tarifa + parte del coste compartido. Dato económico
  // interno: exige también billing:read
  router.get(
    "/resources/costs",
    requireScope("usage:read"),
    requireScope("billing:read"),
    wrap(async (req, res) => {
      if (!d.usage) return void res.json(notConfigured);
      const days = z.coerce.number().int().min(1).max(90).default(30).parse(req.query.days ?? undefined);
      const only = req.query.tenant === undefined ? undefined : idSchema.parse(req.query.tenant);
      const { model, error, origin, version } = activeCostModel(d.costModelStore ? await d.costModelStore.get() : null, d.costModel ?? { model: ESTIMATED_COST_MODEL, error: null });
      const all = (await d.reader.listTenants()).filter((t) => t.status !== "deleted");
      if (only && !all.some((t) => t.id === only)) throw new RegistryError("not_found", "Tenant no encontrado");
      const now = Date.now();
      // El reparto del coste compartido siempre se calcula entre TODAS las empresas, aunque se pida una sola
      const r = await tenantCosts(d.usage, model, all.map((t) => t.id), now, days);
      const name = new Map(all.map((t) => [t.id, t] as const));
      // Ingreso recurrente por plataforma (real y modo sombra) para el margen; el coste es una estimación del modelo
      const revenue = await tenantRevenue(now);
      const rows = r.tenants
        .filter((t) => !only || t.tenantId === only)
        .map((t) => {
          const rev = revenue?.get(t.tenantId) ?? null;
          const periodRevenueCents = rev ? Math.round((rev.realMrrCents * days) / 30) : null;
          return {
            ...t,
            displayName: name.get(t.tenantId)?.displayName ?? t.tenantId,
            status: name.get(t.tenantId)?.status ?? null,
            revenue: revenue ? { realMrrCents: rev?.realMrrCents ?? 0, shadowMrrCents: rev?.shadowMrrCents ?? 0, periodCents: periodRevenueCents ?? 0 } : null,
            // Margen solo con ingreso real (sin él no hay margen que estimar, no un margen negativo)
            marginCents: rev && rev.realMrrCents > 0 ? Math.round((periodRevenueCents! - t.totalCents) * 100) / 100 : null,
          };
        })
        .sort((a, b) => b.totalCents - a.totalCents);
      res.json({
        available: true,
        generatedAt: now,
        days,
        currency: model.currency,
        model: { source: model.source, origin, version, note: model.note, rates: model.rates, sharedMonthlyCents: model.sharedMonthlyCents, sharedBasis: model.sharedBasis, error },
        sharedPeriodCents: r.sharedPeriodCents,
        totals: { variableCents: Math.round(rows.reduce((s, t) => s + t.variableCents, 0) * 100) / 100, totalCents: Math.round(rows.reduce((s, t) => s + t.totalCents, 0) * 100) / 100 },
        tenants: rows,
        // Qué es medido, qué es estimado y qué no está disponible
        basis: { usage: "medido", cost: "estimado (tarifas del modelo)", revenue: revenue ? "contratado real; el modo sombra aparte y sin sumar" : "no disponible" },
        // Lo que no se mide no se atribuye (suele ser el mayor coste: almacenamiento y bases de datos)
        unattributed: UNMEASURED,
      });
    }),
  );
  // Métricas de ingresos del Control Center (solo lectura): MRR real de los servicios con cobro, cobrado en la ventana,
  // riesgo, próximos cargos y churn; el modo sombra aparte. Dato económico interno: billing:read
  router.get(
    "/revenue/metrics",
    requireScope("billing:read"),
    wrap(async (req, res) => {
      if (!d.external && !d.subscriptions) return void res.json({ available: false, reason: "Sin servicios externos ni suscripciones montados en este plano de control" });
      const days = z.coerce.number().int().min(1).max(365).default(30).parse(req.query.days ?? undefined);
      const external = d.external ? await d.external.store.list() : [];
      const events = new Map(await Promise.all(external.map(async (x) => [x.id, await d.external!.store.events(x.id)] as const)));
      let shadow: Parameters<typeof revenueMetrics>[0]["shadow"] = null;
      if (d.subscriptions) {
        const subscriptions = await d.subscriptions.store.list({ status: "active", limit: 1000 });
        shadow = { subscriptions, items: new Map(await Promise.all(subscriptions.map(async (s) => [s.id, await d.subscriptions!.store.items(s.id)] as const))) };
      }
      res.json({ available: true, sources: { external: !!d.external, shadow: !!d.subscriptions }, ...revenueMetrics({ external, events, shadow, now: Date.now(), windowDays: days }) });
    }),
  );
  // Tarifas de coste: vigentes, de dónde salen e historial de cambios. Editar exige billing:write, motivo y la versión
  // sobre la que se cambia (dos personas no se pisan). Sin tarifas guardadas, sigue la estimación declarada.
  router.get(
    "/resources/rates",
    requireScope("usage:read"),
    requireScope("billing:read"),
    wrap(async (_req, res) => {
      const stored = d.costModelStore ? await d.costModelStore.get() : null;
      const a = activeCostModel(stored, d.costModel ?? { model: ESTIMATED_COST_MODEL, error: null });
      res.json({
        editable: !!d.costModelStore,
        origin: a.origin,
        version: a.version ?? 0,
        model: { note: a.model.note, currency: a.model.currency, rates: a.model.rates, sharedMonthlyCents: a.model.sharedMonthlyCents, sharedBasis: a.model.sharedBasis },
        error: a.error,
        updatedBy: stored?.updatedBy ?? null,
        updatedAt: stored?.updatedAt ?? null,
        history: d.costModelStore ? await d.costModelStore.history(20) : [],
      });
    }),
  );
  router.put(
    "/resources/rates",
    requireScope("billing:write"),
    wrap(async (req, res) => {
      if (!d.costModelStore) return void res.status(501).json({ error: "not_available", message: "Tarifas editables no disponibles: falta la migración 0014 del registro" });
      const b = z.object({ model: costModelInputSchema, expectedVersion: z.number().int().min(0), reason: z.string().trim().min(5).max(300) }).strict().parse(req.body ?? {});
      const a = getAuth(req)!.actor;
      try {
        const saved = await d.costModelStore.save(b.model, { expectedVersion: b.expectedVersion, reason: b.reason, actor: `${a.type}:${a.id}`, now: Date.now() });
        res.json({ version: saved.version, updatedBy: saved.updatedBy, updatedAt: saved.updatedAt });
      } catch (e) {
        if (e instanceof CostModelConflict) return void res.status(409).json({ error: "conflict", message: e.message, currentVersion: e.current });
        throw e;
      }
    }),
  );
  // Anomalías del último día completo frente a los 14 anteriores (solo consumo medido)
  router.get(
    "/resources/anomalies",
    requireScope("usage:read"),
    requireScope("tenants:read"),
    wrap(async (_req, res) => {
      if (!d.usage) return void res.json(notConfigured);
      const usage = d.usage;
      const now = Date.now();
      const day = lastFullMadridDay(now);
      const tenants = (await d.reader.listTenants()).filter((t) => t.status !== "deleted" && t.status !== "archived");
      const anomalies = [];
      for (const t of tenants) anomalies.push(...detectAnomalies(t.id, await dailyUsage(usage, t.id, now - 17 * 86_400_000, now), day).map((x) => ({ ...x, displayName: t.displayName })));
      res.json({ available: true, generatedAt: now, day, reference: "14 días anteriores", watched: WATCHED, anomalies });
    }),
  );
  // Estado de la medición por empresa: cuándo llegó el último dato
  router.get(
    "/resources/collectors",
    requireScope("usage:read"),
    requireScope("tenants:read"),
    wrap(async (_req, res) => {
      if (!d.usage) return void res.json(notConfigured);
      const now = Date.now();
      const tenants = (await d.reader.listTenants()).filter((t) => t.status !== "deleted" && t.status !== "archived");
      const name = new Map(tenants.map((t) => [t.id, t.displayName]));
      const rows = (await collectorStatus(d.usage, tenants.map((t) => t.id), now)).map((r) => ({ ...r, displayName: name.get(r.tenantId) ?? r.tenantId }));
      res.json({
        available: true,
        generatedAt: now,
        staleAfterHours: 3,
        collectors: rows,
        summary: { ok: rows.filter((r) => r.state === "ok").length, stale: rows.filter((r) => r.state === "stale").length, noData: rows.filter((r) => r.state === "no_data").length },
      });
    }),
  );
  // Exportación diaria del consumo medido (CSV, día de Madrid; máximo 92 días; sin datos personales)
  router.get(
    "/resources/export",
    requireScope("usage:read"),
    requireScope("tenants:read"),
    wrap(async (req, res) => {
      if (!d.usage) return void res.json(notConfigured);
      const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
      const q = z.object({ from: day, to: day, tenant: idSchema.optional() }).strict().parse(req.query);
      // Margen de 2 h por la diferencia con Madrid; las filas se filtran después por su día de Madrid
      const from = Date.parse(`${q.from}T00:00:00Z`) - 2 * 3_600_000;
      const to = Date.parse(`${q.to}T00:00:00Z`) + 86_400_000;
      if (!Number.isFinite(from) || !Number.isFinite(to) || q.to < q.from) return void res.status(400).json({ error: "invalid_input", message: "Periodo no válido" });
      if (to - from > 93 * 86_400_000) return void res.status(400).json({ error: "invalid_input", message: "Como máximo 92 días por exportación" });
      const all = (await d.reader.listTenants()).filter((t) => t.status !== "deleted");
      if (q.tenant && !all.some((t) => t.id === q.tenant)) throw new RegistryError("not_found", "Tenant no encontrado");
      const ids = q.tenant ? [q.tenant] : all.map((t) => t.id);
      const lines = (await exportDailyCsv(d.usage, ids, from, to)).split("\r\n");
      const csv = lines.filter((l, i) => i === 0 || l === "" || (l.split(",")[2] >= q.from && l.split(",")[2] <= q.to)).join("\r\n");
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="consumo-${q.from}-${q.to}.csv"`);
      res.send(csv);
    }),
  );
  // Política de exceso de cuota vigente (qué pasa al aviso y al límite; la suspensión nunca es automática)
  router.get("/resources/policy", requireScope("usage:read"), (_req, res) => void res.json(OVERAGE_POLICY));
  // Consumo de la propia empresa para su panel (solo lectura, mismo token que la compra)
  router.use("/commerce", createPanelUsageRouter({ quotas: d.quotas, usage: d.usage, defaults: quotaDefaults }));

  // Diagnóstico de una empresa (registro, dominios, BD de la empresa, esquema, licencias): solo operadores
  router.get(
    "/tenants/:id/diagnostics",
    requireScope("ops:read"),
    wrap(async (req, res) => {
      const id = idSchema.parse(req.params.id);
      const expectedSchemaVersion = (d.schemaMigrations ?? tenantMigrations)().at(-1);
      const out = await diagnoseTenant({ reader: d.reader, registry: d.registry, entitlements: d.entitlements, quotas: d.quotas, expectedSchemaVersion }, id);
      if (!out.ok) opsLog("warn", "Diagnostics", "tenant_not_healthy", { tenantId: id, failed: out.checks.filter((c) => !c.ok).map((c) => c.name) });
      res.json(out);
    }),
  );

  // Integraciones de la empresa sin secretos (ficha 360°): proveedor, campos configurados y obligatorios que faltan
  const integrationRows = d.integrationRows ?? mysqlIntegrationRows((id) => d.registry.getActiveDsn(id), (dsn) => mysql.createConnection({ uri: dsn, connectTimeout: 5_000 }));
  router.get(
    "/tenants/:id/integrations",
    requireScope("tenants:read"),
    wrap(async (req, res) => {
      const id = idSchema.parse(req.params.id);
      const t = await d.reader.getTenant(id);
      if (!t || t.status === "deleted") throw new RegistryError("not_found", "Tenant no encontrado");
      const rows = ["provisioning", "archived", "deleting"].includes(t.status) ? null : await integrationRows(id).catch(() => null);
      if (!rows) return void res.json({ tenantId: id, available: false, reason: "No se pudo consultar la base de la empresa", integrations: [] });
      // Estado real desde el Core (comprobaciones y sincronizaciones registradas en la base de la empresa)
      let health: IntegrationHealth[] | null = null;
      let healthAvailable = false;
      if (d.tenantAccess) {
        const a = getAuth(req)!.actor;
        const r = await d.tenantAccess.client.call({ tenantId: id, act: "integrations", operator: `${a.type}:${a.id}` }).catch(() => null);
        const h = r?.status === 200 ? (r.body.integrations as { available?: boolean; providers?: IntegrationHealth[] } | undefined) : undefined;
        if (h?.available) {
          health = h.providers ?? [];
          healthAvailable = true;
        }
      }
      res.json({ tenantId: id, available: true, healthAvailable, integrations: integrationStatus(rows, health) });
    }),
  );
  // Comprobación de una integración AHORA, de solo lectura y con las credenciales de la empresa (nunca vistas aquí)
  if (d.tenantAccess) {
    const access = d.tenantAccess;
    router.post(
      "/tenants/:id/integrations/:provider/check",
      requireScope("support:write"),
      wrap(async (req, res) => {
        const id = idSchema.parse(req.params.id);
        const provider = z.string().regex(/^[a-z][a-z_]{1,31}$/).parse(req.params.provider);
        const b = z.object({ reason: z.string().trim().min(5).max(300) }).strict().parse(req.body ?? {});
        const t = await d.reader.getTenant(id);
        if (!t || t.status === "deleted" || t.status === "deleting") throw new RegistryError("not_found", "Tenant no encontrado");
        const a = getAuth(req)!.actor;
        const r = await access.client.call({ tenantId: id, act: "integration_check", prv: provider, operator: `${a.type}:${a.id}` });
        const ok = r.status === 200;
        const check = ok ? (r.body.check as { outcome: string; message: string }) : null;
        await d.registry.recordEvent(id, actor(req), "integration.check", { provider, reason: b.reason, result: ok ? check!.outcome : String(r.body.error ?? r.status) });
        if (!ok) return void res.status(r.status === 503 ? 503 : r.status === 404 ? 404 : 409).json({ error: r.body.error ?? "check_failed", message: String(r.body.message ?? "No se pudo comprobar") });
        res.json({ tenantId: id, provider, ...check });
      }),
    );
  }

  // Versiones de esquema: la última migración de empresa de este código frente a la aplicada en cada una
  router.get(
    "/platform/versions",
    requireScope("tenants:read"),
    wrap(async (_req, res) => {
      const known = (d.schemaMigrations ?? tenantMigrations)();
      const latest = known.at(-1) ?? null;
      const tenants = (await d.reader.listTenants())
        .filter((t) => t.status !== "deleted")
        .map((t) => ({ tenantId: t.id, displayName: t.displayName, status: t.status, schemaVersion: t.schemaVersion ?? null, state: schemaState(t.schemaVersion ?? null, latest, known), pending: pendingCount(t.schemaVersion ?? null, known) }));
      const n = (st: string) => tenants.filter((t) => t.state === st).length;
      res.json({ tenantSchema: { latest, available: known.length }, summary: { upToDate: n("up_to_date"), behind: n("behind"), ahead: n("ahead"), unknown: n("unknown") }, tenants });
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
        // null: ya había una evaluación en curso (no se lanzan dos a la vez)
        wrap(async (_req, res) => {
          const r = await ops.runAlerts!();
          res.json(r ?? { skipped: true, reason: "Ya hay una evaluación en curso" });
        }),
      );
    }
    // Estado del motor de alertas: si está programado, cada cuánto, la última evaluación y su último error
    router.get(
      "/alerts/status",
      requireScope("ops:read"),
      wrap(async (_req, res) => void res.json(ops.alertStatus ? { available: true, ...ops.alertStatus() } : { available: false })),
    );
  }

  if (d.crm) {
    const onboarding =
      d.provisioning && d.platformDomain
        ? new CrmOnboarding({
            store: d.crm.store,
            crm: d.crm.service,
            provisioning: d.provisioning,
            registry: d.reader,
            billing: d.billing,
            platformDomain: d.platformDomain,
            deliverInvite: d.tenantAccess ? (tenantId, adminEmail, a) => deliverAdminInvite(d.tenantAccess!.client, { tenantId, adminEmail, operator: `${a.type}:${a.id}` }) : undefined,
          })
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
    const knownTenants = async () => new Set((await d.reader.listTenants()).filter((t) => t.status !== "deleted").map((t) => t.id));
    if (leadNotices) router.use("/crm/lead-notices", createLeadNoticesRouter(leadNotices));
    if (adminAlerts) router.use("/admin-alerts", createAdminAlertsRouter(adminAlerts));
    if (d.dataRequests) router.use("/data-requests", createDataRequestsRouter(d.dataRequests));
    // Centro de envíos y consentimiento por contacto (antes del router del CRM: /crm/contacts/:id/consent)
    if (d.communications) router.use(createCommunicationsRouter(d.communications));
    router.use(
      "/crm",
      createCrmRouter(d.crm.service, d.crm.store, { billing: d.billingStore, onboarding, requests: webRequests, assignees, quote: crmQuote, knownTenants, noticeSummaries: leadNotices ? (ids) => leadNotices.summaries(ids) : undefined }),
    );
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
    // Uso real para no bajar ampliaciones por debajo de lo usado: sedes, aquí; usuarios y almacenamiento los aporta la empresa (PR 3)
    const orgStore = d.organization;
    const svc = new ContractSubscriptionService({
      store: d.subscriptions.store,
      catalog: catalogFromWebStore(d.web.store),
      crm: crmPort,
      now: d.subscriptions.now,
      usage: {
        of: async (tenantId, metric) => {
          if (metric === "sites" && orgStore) return (await orgStore.sites(tenantId)).filter((x) => x.status === "active").length;
          // Usuarios y almacenamiento: lo que declara la propia empresa (registro 0013); sin dato, null
          const used = d.limits ? (await d.limits.usage(tenantId)).find((u) => u.metric === (metric === "storage_gb" ? "storage_bytes" : metric)) : undefined;
          if (!used) return null;
          return metric === "storage_gb" ? Math.ceil(used.used / 1024 ** 3) : used.used;
        },
      },
      // Precio de contrato (I-10): nunca en una suscripción cobrada por Stripe, por pagos verificados o por enlace
      stripeBilled: async (sid) => {
        if (!d.orders) return false;
        if ((await subscriptionBilling(d.orders.store, sid)).source === "stripe") return true;
        const orders = new Set((await d.orders.store.list({ subscriptionId: sid, limit: 50 })).map((o) => o.id));
        if (!d.stripe || !orders.size) return false;
        const sub = await d.subscriptions?.store.get(sid);
        for (const id of sub ? await d.stripe.store.subscriptionsOfCompany(sub.companyId) : []) if (orders.has((await d.stripe.store.subscription(id))?.orderId ?? -1)) return true;
        return false;
      },
    });
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
        limits: d.limits,
        events: d.commercialEvents?.append ? (d.commercialEvents as CommercialEventSink) : undefined,
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
      const org = new OrganizationService({ store: d.organization, subscriptions: d.subscriptions.store, catalog: async () => quoteCatalogFromSite(await webAdmin!.site("published")), now: d.subscriptions.now, exceptions: d.quotaExceptions });
      seatLimitOf = async (tenantId) => (await org.limits(tenantId)).users;
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
      const licensingForTrials = new LicensingService({ capabilities: d.capabilities, subscriptions: d.subscriptions.store, crm: crmPort, catalog: async () => quoteCatalogFromSite(await webAdmin!.site("published")), now: d.subscriptions.now, limits: d.limits, events: d.commercialEvents?.append ? (d.commercialEvents as CommercialEventSink) : undefined });
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
    // Cobro de cargos (server/invoicing/chargePayments): lo crea el bloque de facturación; el procesador de Stripe lo consulta
    const chargePaymentsRef: { svc?: ChargePaymentService } = {};
    const atRiskStripe: { deps?: AtRiskDeps["stripe"] } = {};
    if (d.orders && d.capabilities) {
      // El modo sale de la configuración de Stripe aunque Stripe no se monte (p. ej. live sin la 0013)
      if (d.stripe && d.orders.mode && d.orders.mode !== d.stripe.config.mode) throw new Error("El modo de los pedidos no coincide con el de Stripe");
      const ordersMode = d.stripe?.config.mode ?? d.orders.mode ?? "test";
      // Orquestador comercial: encadena contrato → confirmación → suscripción → licencias → activación
      const licensing = new LicensingService({ capabilities: d.capabilities, subscriptions: d.subscriptions.store, crm: crmPort, catalog: async () => quoteCatalogFromSite(await webAdmin!.site("published")), now: d.subscriptions.now, limits: d.limits, events: d.commercialEvents?.append ? (d.commercialEvents as CommercialEventSink) : undefined });
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
          const exceptionKey = `trial-exception-${String(trialId).padStart(8, "0")}`;
          // Con un pedido de conversión ya abierto (p. ej. el cliente está pagando), la excepción no se superpone: se
          // aprueba o se cancela ese pedido primero. Así nunca queda un pedido parado sin prueba que convertir
          const open = (await ordersStore.list({ trialId, limit: 50 })).find((o) => o.idempotencyKey !== exceptionKey && o.state !== "active" && !TERMINAL_STATES.has(o.state));
          if (open) throw new OrderError("conflict", `La prueba ya tiene un pedido de conversión abierto (#${open.id}, ${open.state}): apruébalo o cancélalo antes de convertirla por excepción`);
          let { order } = await orchestrator.create({ idempotencyKey: exceptionKey, trialId, request: { plan, interval: input.interval ?? "month", items: [] } }, who);
          if (order.state === "requested" || order.state === "quoted") order = (await orchestrator.accept(order.id, { signatureRef: `admin-exception:${input.category}`, approvalReason: input.reason }, who)).order;
          let error: string | null = order.lastError;
          if (order.state === "contracted") ({ order, error } = await orchestrator.approve(order.id, { reason: input.reason, category: input.category, reference: input.reference }, who));
          const after = await trialStore.get(trialId);
          return { order, trial: after ? TrialService.view(after) : null, error: order.state === "active" ? null : error };
        };
      }
      router.use("/orders", createOrdersRouter(orchestrator));
      // Desistimiento de consumidores (CRM 0022): solicitud desde la cuenta (Core) y gestión de operadores. Sin
      // política jurídica aprobada no ejecuta reembolsos ni bajas: registra, evalúa, avisa y guarda la resolución
      if (d.withdrawals) {
        const withdrawals = new WithdrawalService({
          store: d.withdrawals.store,
          crmStore: d.crm.store,
          orders: d.orders.store,
          buyers: d.stripe?.store ?? { buyerProfile: async () => null },
          subscriptions: d.subscriptions.store,
          notify: d.mail?.platform?.withdrawalNotifier(),
          events: d.commercialEvents?.append ? (d.commercialEvents as CommercialEventSink) : undefined,
          now: d.subscriptions.now,
        });
        router.use("/commerce", createWithdrawalCommerceRouter(withdrawals));
        router.use("/withdrawals", createWithdrawalAdminRouter(withdrawals));
      }
      if (d.lifecycle) {
        const policy = d.lifecycle.policy;
        const lifecycle = new LifecycleEngine({
          orders: d.orders.store,
          subscriptions: d.subscriptions.store,
          licensing,
          orchestrator,
          trials: d.trials?.store,
          coverageHeld,
          capabilities: d.capabilities,
          events: d.commercialEvents?.append ? (d.commercialEvents as CommercialEventSink) : undefined,
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
      // Catálogo de módulos y ampliaciones para el panel de cada empresa (solo lectura, mismo token que la compra)
      if (webAdmin) {
        const wa = webAdmin;
        router.use("/commerce", createPanelCatalogRouter({ site: () => wa.site("published"), purchasesEnabled: !!d.stripe?.purchases?.enabled, internalTenants: d.stripe?.purchases?.internalTenants }));
      }
      // Servicios externos en un entorno sin Stripe: contrato, aceptación y seguimiento (sin autorización de pago ni cobros)
      if (d.external && !d.stripe) {
        const svc = new ExternalService({ store: d.external.store, crm: d.crm.service, crmStore: d.crm.store, mode: "test", namespace: "sin-stripe", urls: d.external.urls, ipSalt: d.external.ipSalt, mail: d.mail?.platform?.externalMail(), now: d.subscriptions.now });
        router.use("/external", createExternalRouter(svc));
        publicAcceptance = createContractAcceptanceRouter(svc);
      }
      if (d.stripe) {
        const st = d.stripe;
        const stripeCatalog = catalogFromWebStore(d.web.store);
        // VIES con registro (CRM 0021) y reutilización de comprobaciones recientes
        const vat = st.vies ? new VatVerifier({ vies: st.vies.client, store: st.store, now: d.subscriptions.now, maxAgeDays: st.vies.maxAgeDays }) : undefined;
        // Cotizador del servidor (catálogo publicado): plan, módulos y ampliaciones del Checkout y de las compras
        const siteAdmin = webAdmin;
        const serverQuote = siteAdmin ? async (r: QuoteRequest) => quote(quoteCatalogFromSite(await siteAdmin.site("published")), r) : undefined;
        // Partidas mensuales de un plan anual: primer mes en el Checkout y recurrentes al activarse (mismo almacén de cambios)
        const deferredItems = serverQuote && st.purchases?.changes ? new DeferredItemsService({ namespace: st.config.namespace, catalog: stripeCatalog, store: st.store, gateway: st.gateway, changes: st.purchases.changes, quote: serverQuote, now: d.subscriptions.now }) : null;
        // En live sin política fiscal, Checkout no se monta aunque se pida (y el servicio también lo rechazaría)
        const checkout = st.checkoutEnabled && st.urls && !checkoutBlockedReason(st.config)
          ? new StripeCheckoutService({ store: st.store, gateway: st.gateway, orders: d.orders.store, crmStore: d.crm.store, catalog: stripeCatalog, urls: st.urls, now: d.subscriptions.now, namespace: st.config.namespace, mode: st.config.mode, taxPolicy: st.config.taxPolicy, fiscalScenarios: st.fiscal?.scenarios, taxExpectations: st.fiscal?.taxExpectations, vat, eligibility: { countries: st.fiscal?.countries, consumerRates: st.fiscal?.consumerRates, consent: st.fiscal?.consent }, quote: serverQuote, deferredItems: !!deferredItems })
          : null;
        // Partidas contratadas para el PRÓXIMO periodo (las que Stripe debe cobrar en la renovación): conciliación
        const subItems = d.subscriptions.store;
        const contractedItems = async (o: { subscriptionId: number | null }) => {
          if (!o.subscriptionId) return null;
          const sub = await svc.must(o.subscriptionId).catch(() => null);
          if (!sub || sub.status === "canceled") return null;
          const out = new Map<string, number>();
          for (const i of await subItems.items(sub.id))
            if ((i.family === "core_plan" || i.family === "extension" || i.family === "industry_module") && i.effectiveFrom <= sub.currentPeriodEnd && (i.effectiveTo === null || i.effectiveTo > sub.currentPeriodEnd))
              out.set(i.productKey, (out.get(i.productKey) ?? 0) + i.quantity);
          return out;
        };
        // Servicios de clientes externos: mismo Stripe (Customer por empresa, webhooks, conciliación), sin pedidos ni licencias
        const externalSvc = d.external
          ? new ExternalService({ store: d.external.store, crm: d.crm.service, crmStore: d.crm.store, stripeStore: st.store, gateway: st.gateway, mode: st.config.mode, namespace: st.config.namespace, urls: d.external.urls, ipSalt: d.external.ipSalt, liveEnabled: d.external.liveEnabled, mail: d.mail?.platform?.externalMail(), now: d.subscriptions.now })
          : null;
        const externalStore = d.external?.store;
        const processor = new StripeEventProcessor({ store: st.store, gateway: st.gateway, orders: d.orders.store, orchestrator, now: d.subscriptions.now, namespace: st.config.namespace, mode: st.config.mode, taxExpectations: st.fiscal?.taxExpectations, vat, catalog: stripeCatalog, changes: st.purchases?.changes, invoiceLines: st.invoiceLines, contractedItems, deferredItems: deferredItems ? (o, s) => deferredItems.attach(o, s) : undefined, external: externalSvc && externalStore ? { handleSetupSession: async (id) => ((await externalStore.bySetupSession(id)) ? externalSvc.handleSetupSession(id) : null), handleSubscription: (sub, hint) => externalSvc.handleSubscription(sub, hint), handleCharge: (c, inv, sub) => externalSvc.handleCharge(c, inv, sub) } : undefined, charges: { handleSession: (id) => (chargePaymentsRef.svc ? chargePaymentsRef.svc.handleSession(id) : Promise.resolve(null)) } });
        if (externalSvc) {
          router.use("/external", createExternalRouter(externalSvc));
          publicAcceptance = createContractAcceptanceRouter(externalSvc);
        }
        const reconciler = new StripeReconciler({ store: st.store, gateway: st.gateway, processor, now: d.subscriptions.now, retentionDays: st.config.eventsRetentionDays, mode: st.config.mode });
        const rechecks = new Map<string, number>();
        const stripeNow = d.subscriptions.now;
        // Tras guardar un evento del webhook se procesa enseguida (los fallos quedan para el reintento)
        stripeKick = () => void processor.processDue(10).catch(() => undefined);
        if (st.workerEnabled) startStripeWorker({ processor, reconciler, ...(externalSvc ? { extra: () => externalSvc.evaluateOverdue() } : {}) });
        const selfServiceOk = st.selfService && !!checkout && !!d.publicIntake && publicOrigins.size > 0;
        if (st.publicStatus || selfServiceOk) {
          const pc = express.Router();
          if (selfServiceOk) {
            const ss = new SelfServiceCheckout({ crm: d.crm.service, orders: d.orders.store, orchestrator, checkout: checkout!, catalog: stripeCatalog, ticketSecret: d.publicIntake!.secret, origins: publicOrigins, termsVersion: st.termsVersion, now: d.subscriptions.now, buyers: st.store, mode: st.config.mode, consent: st.fiscal?.consent, vat, eligibility: st.fiscal ? { scenarios: st.fiscal.scenarios, taxExpectations: st.fiscal.taxExpectations ?? new Map(), countries: st.fiscal.countries ?? new Map(), consumerRates: st.fiscal.consumerRates ?? new Map(), consent: st.fiscal.consent } : undefined });
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
        if (st.purchases) {
          const purchases = new ModulePurchaseService({
            enabled: st.purchases.enabled,
            internalTenants: st.purchases.internalTenants,
            mode: st.config.mode,
            namespace: st.config.namespace,
            billingMode: st.config.billingMode ?? "classic",
            orchestrator,
            orders: d.orders.store,
            crmStore: d.crm.store,
            catalog: stripeCatalog,
            quote: async (r) => quote(quoteCatalogFromSite(await webAdmin!.site("published")), r),
            gateway: st.gateway,
            stripeStore: st.store,
            changes: st.purchases.changes,
            subscriptions: svc,
            subscriptionItems: d.subscriptions.store,
            settle: (subId, inv) => processor.handleSubscription(subId, inv),
            onPaymentPending: customerNotices
              ? async (i) => {
                  const order = await d.orders!.store.get(i.orderId);
                  if (!order) return;
                  const key = order.request?.items?.[0]?.key ?? null;
                  const productName = key ? ((await stripeCatalog.product(key).catch(() => null))?.name ?? key) : null;
                  await purchasePendingNotice(customerNotices, { orderId: order.id, companyId: order.companyId, tenantId: order.tenantId, productName, paymentUrl: i.paymentUrl });
                }
              : undefined,
            now: d.subscriptions.now,
          });
          router.use("/commerce", createPurchasesRouter(purchases));
        }
        // Portal de facturación de Stripe (solo consulta de facturas y método de pago; apagado por defecto)
        router.use(
          "/commerce",
          createBillingPortalRouter(
            new BillingPortalService({
              enabled: st.billingPortal?.enabled ?? false,
              configurationId: st.billingPortal?.configurationId ?? null,
              companyOfTenant: async (t) => {
                const c = (await d.crm!.store.list("companies", { tenantId: t }, { limit: 2 })) as Array<{ id: number }>;
                return c.length === 1 ? c[0].id : null;
              },
              customerOfCompany: async (companyId) => (await st.store.customerByCompany(companyId))?.stripeCustomerId ?? null,
              portalConfigurations: () => st.gateway.portalConfigurations(),
              createSession: (i) => st.gateway.createPortalSession(i),
              tenantDomains: async (t) => (await d.reader.listDomains(t)).filter((x) => x.status === "active").map((x) => x.domain),
            }),
          ),
        );
        // Recuperación de cobros (bandeja «Cobros en riesgo»): Stripe solo para releer, reintentar y el portal
        atRiskStripe.deps = {
          mode: st.config.mode,
          liveRetryAllowed: process.env.CP_RECOVERY_LIVE_RETRY === "1",
          invoice: (id) => st.gateway.invoice(id),
          failure: st.gateway.invoicePaymentFailure ? (id) => st.gateway.invoicePaymentFailure!(id) : undefined,
          pay: st.gateway.payInvoice ? (id, key) => st.gateway.payInvoice!(id, key) : undefined,
          subscriptionOf: async (companyId) => {
            const subs = await st.store.subscriptionsOfCompany(companyId);
            return subs.length === 1 ? st.gateway.subscription(subs[0]) : null;
          },
          settle: async (sub) => String(await processor.handleSubscription(sub.id)),
          portal: async (companyId) => {
            const link = await st.store.customerByCompany(companyId);
            const c = (await d.crm!.store.get("companies", companyId)) as { tenantId?: string | null } | null;
            const domain = c?.tenantId ? (await d.reader.listDomains(c.tenantId)).find((x) => x.status === "active")?.domain : undefined;
            if (!link || !domain) return null;
            return st.gateway.createPortalSession({ customerId: link.stripeCustomerId, returnUrl: `https://${domain}/admin/suscripcion`, ...(st.billingPortal?.configurationId ? { configuration: st.billingPortal.configurationId } : {}) });
          },
        };
        router.use("/stripe", createStripeRouter({ config: st.config, store: st.store, gateway: st.gateway, catalog: stripeCatalog, checkout, processor, reconciler, now: d.subscriptions.now, orders: d.orders.store, fiscal: st.fiscal, legalUrls: st.fiscal?.legalUrls }));
      }
      // Webhook del proveedor de PRUEBAS: autenticado por firma (antes del montaje del router con tokens)
      if (d.orders.payments) app.post("/cp/v1/payments/test/webhook", paymentsWebhookHandler(orchestrator));
      // Bandeja «Cobros en riesgo»: impagos de suscripciones SaaS y de servicios externos, con acciones de recuperación
      const atRisk = new AtRiskService({
        orders: () => ordersStore.list({ states: ["past_due", "suspended"], limit: 500 }),
        company: async (id) => (await d.crm!.store.get("companies", id)) as { id: number; name: string; tenantId?: string | null } | null,
        invoices: d.stripe ? (orderId) => d.stripe!.store.listInvoiceRecords({ orderId, limit: 20 }) : undefined,
        events: d.commercialEvents ? (orderId) => d.commercialEvents!.list({ orderId, limit: 50 }) : undefined,
        get stripe() {
          return atRiskStripe.deps;
        },
        external: d.external
          ? async () => {
              const external = await d.external!.store.list();
              const events = new Map(await Promise.all(external.filter((x) => x.status === "past_due").map(async (x) => [x.id, await d.external!.store.events(x.id)] as const)));
              return revenueMetrics({ external, events, shadow: null, now: Date.now(), windowDays: 30 }).atRisk;
            }
          : undefined,
      });
      const atRiskWrap = (fn: (req: Request, res: Response) => Promise<void>) =>
        wrap(async (req, res) => {
          try {
            await fn(req, res);
          } catch (e) {
            if (!(e instanceof AtRiskError)) throw e;
            res.status(e.code === "not_found" ? 404 : e.code === "forbidden" ? 403 : 409).json({ error: e.code, message: e.message });
          }
        });
      const orderParam = (req: Request) => z.coerce.number().int().positive().parse(req.params.orderId);
      router.get("/revenue/at-risk", requireScope("billing:read"), atRiskWrap(async (_req, res) => void res.json(await atRisk.list())));
      router.post("/revenue/at-risk/:orderId/sync", requireScope("billing:write"), atRiskWrap(async (req, res) => {
        const out = await atRisk.sync(orderParam(req));
        opsLog("info", "Recovery", "sync", { orderId: orderParam(req), outcome: out.outcome, by: getAuth(req)?.tokenId ?? "operador" });
        res.json(out);
      }));
      router.post("/revenue/at-risk/:orderId/retry", requireScope("billing:write"), atRiskWrap(async (req, res) => {
        const out = await atRisk.retry(orderParam(req));
        opsLog("info", "Recovery", "retry", { orderId: orderParam(req), status: out.status, by: getAuth(req)?.tokenId ?? "operador" });
        res.json(out);
      }));
      router.post("/revenue/at-risk/:orderId/portal", requireScope("billing:write"), atRiskWrap(async (req, res) => {
        const out = await atRisk.portal(orderParam(req));
        opsLog("info", "Recovery", "portal_link", { orderId: orderParam(req), by: getAuth(req)?.tokenId ?? "operador" });
        res.setHeader("Cache-Control", "no-store");
        res.json(out);
      }));
    }
    // Origen del cobro (Stripe o simulación) desde los pedidos; sin pedidos activos, todo es simulación
    const orderStore = d.orders?.store;
    router.use("/subscriptions", createSubscriptionsRouter(svc, shadowBilling, orderStore ? (sid) => subscriptionBilling(orderStore, sid) : undefined));
    // Facturación propia: emisor de las facturas = entidad jurídica de DF-1 (server/stripe/issuer.ts, solo lectura)
    if (d.invoicing) {
      const crmStore = d.crm.store;
      const issuer = { legalName: ISSUER.legalName, taxId: ISSUER.taxId, address: `${ISSUER.address.line1}, ${ISSUER.address.line2}`, postalCode: ISSUER.address.postalCode, city: ISSUER.address.city, country: ISSUER.address.country };
      const invoicing = new InvoicingService({
        store: d.invoicing.store,
        external: d.external?.store,
        company: async (id) => (await crmStore.get("companies", id)) as CompanyFiscal | null,
        issuer,
        seriesCode: d.invoicing.seriesCode,
        issueEnabled: d.invoicing.issueEnabled,
        // Factura expedida: alerta a la administración y, si es rectificativa, aviso al cliente con su número
        onIssued: async (inv) => {
          const company = ((await crmStore.get("companies", inv.companyId)) as { name?: string } | null)?.name ?? null;
          await adminAlerts?.raise("admin.invoice_issued", { key: `invoice:${inv.id}:issued`, occurredAt: inv.issuedAt ?? Date.now(), companyId: inv.companyId, company, summary: `${inv.kind === "rectification" ? "Factura rectificativa" : "Factura"} ${inv.number ?? ""} expedida.`.replace("  ", " "), status: { label: "Expedida", tone: "success" }, reference: inv.number, amount: { cents: inv.totalCents, currency: inv.currency }, link: "#/comercial/facturacion" });
          if (inv.kind === "rectification" && inv.number && customerNotices) await creditNoteNotice(customerNotices, { invoiceId: inv.id, companyId: inv.companyId, number: inv.number });
        },
        now: d.subscriptions.now,
      });
      // Cargos extraordinarios y gastos variables (CRM 0028): solo con su tabla
      const company = async (id: number) => (await crmStore.get("companies", id)) as CompanyFiscal | null;
      const charges = d.invoicing.charges ? new ChargeService({ charges: d.invoicing.charges, invoices: d.invoicing.store, company, now: d.subscriptions.now }) : undefined;
      // Cobro de los cargos aprobados (CRM 0029): pago externo siempre; enlace de Stripe solo con Stripe y con la página
      // pública del CRM para las vueltas
      if (charges && d.invoicing.chargePayments) {
        const pub = d.external?.urls.acceptance;
        chargePaymentsRef.svc = new ChargePaymentService({
          payments: d.invoicing.chargePayments,
          charges,
          invoices: d.invoicing.store,
          company: async (id) => (await crmStore.get("companies", id)) as Awaited<ReturnType<ConstructorParameters<typeof ChargePaymentService>[0]["company"]>>,
          gateway: pub ? d.stripe?.gateway : undefined,
          stripeStore: d.stripe?.store,
          mode: d.stripe?.config.mode ?? "test",
          namespace: d.stripe?.config.namespace ?? "sin-stripe",
          liveEnabled: d.external?.liveEnabled,
          urls: { success: pub ? `${pub}/pago-recibido` : "", cancel: pub ? `${pub}/pago-cancelado` : "" },
          now: d.subscriptions.now,
        });
      }
      router.use("/invoicing", createInvoicingRouter(invoicing, issuer, charges, chargePaymentsRef.svc));
    }
    // «Mi plan» de cada empresa (solo lectura, token de comercio del Core): contrato, periodo, cobro y facturas propias
    if (orderStore) {
      const crmStore = d.crm.store;
      const inv = d.invoicing;
      const stripe = d.stripe;
      const issuer = { legalName: ISSUER.legalName, taxId: ISSUER.taxId, address: `${ISSUER.address.line1}, ${ISSUER.address.line2}`, postalCode: ISSUER.address.postalCode, city: ISSUER.address.city, country: ISSUER.address.country };
      const plan = new TenantPlanService({
        companyOfTenant: async (t) => {
          const c = (await crmStore.list("companies", { tenantId: t }, { limit: 2 })) as Array<{ id: number; name: string }>;
          return c.length === 1 ? { id: c[0].id, name: c[0].name } : null;
        },
        orders: (companyId) => orderStore.list({ companyId }),
        subscription: (id) => svc.must(id).catch(() => null),
        invoices: inv ? (companyId) => inv.store.list({ companyId, limit: 100 }) : undefined,
        invoiceHtml: inv ? (i) => invoiceHtml(i, issuer) : undefined,
        stripeStatus: stripe
          ? async (companyId) => {
              const subs = await stripe.store.subscriptionsOfCompany(companyId);
              if (subs.length !== 1) return null;
              const s = await stripe.gateway.subscription(subs[0]);
              return s ? { status: s.status, cancelAtPeriodEnd: s.cancelAtPeriodEnd || !!s.cancelAt } : null;
            }
          : undefined,
        billingPortalEnabled: stripe?.billingPortal?.enabled ?? false,
      });
      router.use("/commerce", createTenantPlanRouter(plan));
    }
    // Catálogo de comunicaciones (solo lectura) y despacho manual de las pendientes
    router.get("/notifications/catalog", requireScope("ops:read"), wrap(async (_req, res) => void res.json({ templates: catalogView() })));
    const queue = d.commercialEvents as (typeof d.commercialEvents & Partial<CommercialEventDispatchQueue>) | undefined;
    if (d.notifications && d.mail?.platform && queue?.claimDispatch && queue.finishDispatch) {
      const mailer = d.mail.platform;
      const products = catalogFromWebStore(d.web.store);
      const dispatcher = new NotificationDispatcher({
        queue: queue as CommercialEventDispatchQueue,
        send: (t, k, c, to, content) => mailer.send(t, k, c, to, content),
        crmStore: d.crm.store,
        orders: d.orders?.store,
        hostOf: async (tenantId) => choosePublicDomain(await d.reader.listDomains(tenantId))?.domain ?? null,
        productName: async (key) => (await products.product(key))?.name ?? null,
        supportEmail: mailer.policy.supportEmail ?? null,
        since: d.notifications.since,
        now: d.subscriptions.now,
      });
      router.post("/notifications/dispatch", requireScope("ops:write"), wrap(async (_req, res) => void res.json(await dispatcher.run(100))));
    }
  }

  // Vista previa de las comunicaciones con DATOS FICTICIOS (no envía nada ni lee datos de clientes)
  // Centro de Plantillas: catálogo maestro (todas las comunicaciones) con metadatos y su vista previa con datos ficticios
  router.get("/notifications/templates", requireScope("ops:read"), wrap(async (_req, res) => void res.json({ templates: allTestEmails().map(({ html: _h, text: _t, ...m }) => m) })));
  router.get(
    "/notifications/templates/:id",
    requireScope("ops:read"),
    wrap(async (req, res) => {
      const t = allTestEmails().find((x) => x.id === String(req.params.id));
      if (!t) return void res.status(404).json({ error: "not_found", message: "Plantilla no encontrada" });
      res.setHeader("Cache-Control", "no-store");
      res.json({ template: t });
    }),
  );
  router.get("/notifications/preview", requireScope("ops:read"), wrap(async (_req, res) => void res.json({ ids: TEMPLATE_CATALOG.filter(hasPreview).map((t) => t.id) })));
  router.get(
    "/notifications/preview/:id",
    requireScope("ops:read"),
    wrap(async (req, res) => {
      const p = previewTemplate(String(req.params.id));
      if (!p) return void res.status(404).json({ error: "not_found", message: "Esa comunicación no tiene vista previa (la envía Stripe o aún no tiene disparador)" });
      res.json({ preview: p });
    }),
  );

  // Envío de PRUEBA de las comunicaciones de plataforma (datos ficticios) a UN destinatario, por la bandeja real. Solo con
  // MAIL_MODE=sandbox: la política entrega únicamente a la lista de autorizados. En live u off, 409 (nunca a clientes).
  if (d.mail?.platform) {
    const mailer = d.mail.platform;
    router.post(
      "/notifications/test-send",
      requireScope("ops:write"),
      wrap(async (req, res) => {
        const b = z.object({ to: z.string().trim().email().max(254), ids: z.array(z.string().max(80)).max(120).optional() }).strict().parse(req.body);
        if (mailer.policy.mode === "off") return void res.status(409).json({ error: "mail_off", message: "El correo de la plataforma está desactivado (MAIL_MODE=off)" });
        // Con el correo real, las pruebas (datos ficticios) solo van a buzones autorizados por su dirección exacta: los del
        // entorno o los de CRM → Correo de pruebas. Nunca a un cliente.
        const to = normalizeEmail(b.to);
        if (mailer.policy.mode === "live" && !(to && (mailer.policy.allowAddresses.has(to) || d.mail?.sandbox?.snapshot().addresses.has(to))))
          return void res.status(403).json({ error: "test_recipient_not_allowed", message: "Con el correo real, las pruebas solo se envían a buzones de prueba autorizados (Comunicaciones → Alertas administrativas → Correo de pruebas)" });
        const run = Date.now().toString(36);
        // Catálogo maestro (todas las plantillas, datos ficticios); cada una, un mensaje con su número en el asunto
        const list = allTestEmails().filter((x) => !b.ids || b.ids.includes(x.id));
        const results: Array<{ id: string; name: string; status: string; reason: string | null; outboxId: number | null }> = [];
        for (let n = 0; n < list.length; n++) {
          const p = list[n];
          const subject = `[PRUEBA ${String(n + 1).padStart(2, "0")}/${list.length}] Big Elephant — ${p.name}`;
          const r = await mailer.send(null, `test:${run}:${p.id}`, "operational", b.to, { subject, html: p.html, text: p.text });
          results.push({ id: p.id, name: p.name, status: r.status, reason: r.reason, outboxId: r.id });
        }
        // Entrega inmediata (sin esperar al ciclo de la bandeja); el resultado del proveedor queda en la trazabilidad
        await mailer.service.drain(list.length).catch(() => undefined);
        opsLog("info", "Mail", "test_send", { run, count: results.length, by: getAuth(req)?.tokenId ?? "operador" });
        res.json({ run, sent: results.length, results });
      }),
    );
  }

  // Trazabilidad de los avisos de plataforma: qué se envió, a quién (enmascarado), por qué evento, cuándo, estado,
  // error e historial (incluidos los eventos del proveedor). Solo lectura; sin direcciones completas ni cuerpos.
  if (d.mail?.ledger) {
    const ledger = d.mail.ledger;
    const listQuery = z
      .object({
        status: z.enum(MAIL_STATUSES).optional(),
        category: z.string().trim().regex(/^[a-z_]{1,40}$/).optional(),
        tenantId: z.string().trim().regex(/^[a-z0-9][a-z0-9_-]{0,62}$/).optional(),
        template: z.string().trim().regex(/^[a-z][a-z0-9_.-]{0,80}$/).optional(),
        beforeId: z.coerce.number().int().positive().optional(),
        limit: z.coerce.number().int().min(1).max(200).optional(),
      })
      .strict();
    router.get("/mail/outbox", requireScope("ops:read"), wrap(async (req, res) => void res.json({ messages: await ledger.list(listQuery.parse(req.query)) })));
    router.get(
      "/mail/outbox/:id",
      requireScope("ops:read"),
      wrap(async (req, res) => {
        const id = z.coerce.number().int().positive().parse(req.params.id);
        const h = await ledger.history(id);
        if (!h) return void res.status(404).json({ error: "not_found", message: "Mensaje no encontrado" });
        res.json(h);
      }),
    );
  }

  // Correo de pruebas gestionado desde el CRM: buzones y tipos internos que se suman a los del entorno. Solo cuentan en
  // sandbox (no cambian el modo ni el ámbito de empresas); editar exige operators:write y queda versionado.
  if (d.mail?.sandbox && d.mail.policy) {
    const sandbox = d.mail.sandbox;
    const policy = d.mail.policy;
    const view = async () => ({
      mode: policy.mode,
      environment: {
        addresses: Array.from(policy.allowAddresses).map(maskRecipient),
        domains: Array.from(policy.allowDomains),
        categories: policy.scope.categories ? Array.from(policy.scope.categories) : null,
        tenants: policy.scope.tenants ? Array.from(policy.scope.tenants) : null,
      },
      managed: await sandbox.read(),
      managedCategories: MANAGED_CATEGORIES,
      maxAddresses: MAX_MANAGED_ADDRESSES,
    });
    const body = z.object({ addresses: z.array(z.string().max(254)).max(50), categories: z.array(z.string().max(40)).max(10), expectedVersion: z.number().int().min(0) }).strict();
    router.get("/mail/sandbox", requireScope("ops:read"), wrap(async (_req, res) => void res.json(await view())));
    router.get("/mail/sandbox/history", requireScope("ops:read"), wrap(async (_req, res) => void res.json({ history: await sandbox.history(20) })));
    router.put(
      "/mail/sandbox",
      requireScope("operators:write"),
      wrap(async (req, res) => {
        const b = body.parse(req.body);
        const auth = getAuth(req)!;
        await sandbox.save({ addresses: b.addresses, categories: b.categories }, b.expectedVersion, `${auth.actor.type}:${auth.actor.id}`);
        res.json(await view());
      }),
    );
  }

  if (d.tickets) {
    const tickets = d.tickets;
    router.use("/tickets", createTicketsRouter(tickets));
    // Soporte desde el panel de cada empresa (token del Core; nunca notas internas ni datos del equipo)
    router.use("/commerce", createCustomerTicketsRouter(tickets));
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

  // ── Documentación de la relación contractual (operadores; entrega por procedimiento verificable) ──
  router.get(
    "/tenants/:id/relationship-export",
    requireScope("billing:read"),
    requireScope("tickets:read"),
    wrap(async (req, res) => {
      const id = idSchema.parse(req.params.id);
      try {
        const bundle = await buildRelationshipExport(
          id,
          {
            tenant: async (t) => {
              const x = await d.reader.getTenant(t);
              return x ? { id: x.id, displayName: x.displayName, status: x.status, statusReason: x.statusReason, createdAt: x.createdAt, updatedAt: x.updatedAt } : null;
            },
            orders: d.orders ? async () => (await d.orders!.store.list({ limit: 500 })) as unknown as Array<Record<string, unknown> & { id: number; tenantId: string | null }> : undefined,
            billing: d.billingStore ? async (t) => ({ subscription: await d.billingStore!.getSubscriptionByTenant(t), invoices: await d.billingStore!.listInvoices(t) }) : undefined,
            stripeInvoices: d.stripe ? (orderId) => d.stripe!.store.listInvoiceRecords({ orderId, limit: 200 }) : undefined,
            fiscalDocuments: d.stripe ? (orderId) => d.stripe!.store.listFiscalDocuments({ orderId, limit: 200 }) : undefined,
            tickets: d.tickets
              ? async (t) => {
                  const { items } = await d.tickets!.list({ tenantId: t, limit: 200, offset: 0 });
                  return Promise.all(items.map((x) => d.tickets!.get(x.id, { tenantId: t }))) as unknown as Array<{ ticket: Record<string, unknown>; events: Array<Record<string, unknown> & { internal: boolean }> }>;
                }
              : undefined,
          },
          {
            now: Date.now(),
            by: getAuth(req)?.tokenId ?? "operador",
            // Fecha de la solicitud de la persona propietaria (para el plazo de 5 días hábiles)
            requestedAt: req.query.requestedAt ? z.coerce.date().parse(req.query.requestedAt).getTime() : undefined,
          },
        );
        res.setHeader("Cache-Control", "no-store");
        res.setHeader("Content-Disposition", `attachment; filename="relacion-${id}.json"`);
        res.json(bundle);
      } catch (e) {
        if (e instanceof RelationshipNotFoundError) return void res.status(404).json({ error: "not_found", message: "Tenant no encontrado" });
        if (e instanceof CalendarUnavailableError) return void res.status(409).json({ error: "calendar_unavailable", message: e.message });
        throw e;
      }
    }),
  );

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
        const a = actor(req);
        const access = d.tenantAccess;
        const r = await withAdminInviteDelivery(
          await d.provisioning!.run(b, a),
          access ? () => deliverAdminInvite(access.client, { tenantId: b.tenantId, adminEmail: b.adminEmail, operator: `${a.type}:${a.id}` }) : null,
        );
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

  // ── Accesos de las empresas clientes ─────────────────────────────────────────
  if (d.tenantAccess) {
    registerTenantAccessRoutes(router, {
      client: d.tenantAccess.client,
      tenantExists: async (id) => {
        const t = await d.reader.getTenant(id);
        return !!t && t.status !== "deleted" && t.status !== "deleting";
      },
      record: (req, id, action, details) => d.registry.recordEvent(id, actor(req), action, details),
      operatorOf: (req) => {
        const a = getAuth(req)!.actor;
        return `${a.type}:${a.id}`;
      },
      requireRead: requireScope("tenants:read"),
      requireWrite: requireScope("support:write"),
      wrap,
    });
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
