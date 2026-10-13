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
import rateLimit from "express-rate-limit";
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
import { authenticate, getAuth, requireScope, type ServiceToken } from "./auth";
import { signSupportToken } from "../_core/support/session";
import type { SupportAdmin } from "../_core/support/grants";

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
  /** Destino CNAME de la plataforma para verificar dominios propios. */
  platformTarget: string;
  verifyDomain?: typeof verifyDomainOwnership;
  /** Límite de peticiones por minuto y token (por defecto 120). */
  perMinute?: number;
  /** Acceso delegado de soporte (requiere SUPPORT_JWT_SECRET). */
  support?: Pick<SupportAdmin, "create" | "revoke">;
  supportSecret?: string;
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
  if (e instanceof ModuleError) return { status: e.code === "not_found" ? 404 : 400, code: e.code };
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
  app.use(express.json({ limit: "256kb", verify: (req, _res, buf) => void ((req as any).rawBody = buf.toString("utf8")) }));

  // Webhook del proveedor de pagos: autenticado por firma, no por token
  if (d.billing) {
    app.post(
      "/cp/v1/billing/webhook",
      wrap(async (req, res) => {
        const sig = String(req.headers["x-signature"] ?? "");
        const out = await d.billing!.handleWebhook((req as any).rawBody ?? "", sig);
        res.json(out);
      }),
    );
  }

  const router = express.Router();
  router.use(
    rateLimit({
      windowMs: 60_000,
      limit: d.perMinute ?? 120,
      standardHeaders: true,
      legacyHeaders: false,
      // Por token (no por IP): el plano de control se llama desde pocos orígenes de confianza
      keyGenerator: (req) => (req.headers.authorization ?? "anon").slice(0, 80),
    }),
  );
  router.use(authenticate(d.tokens));
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
      res.json({ events: await d.reader.listEvents(id, Math.min(500, Number(req.query.limit ?? 100))) });
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
      await d.entitlements.revoke(id, req.params.module, actor(req));
      res.status(204).end();
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
            operator: z.string().min(2).max(100),
            reason: z.string().min(5).max(300),
            minutes: z.number().int().min(1).max(240),
            readOnly: z.boolean().default(true),
          })
          .parse(req.body);
        const t = await d.reader.getTenant(id);
        if (!t) throw new RegistryError("not_found", "Tenant no encontrado");
        if (t.status === "deleted" || t.status === "deleting") throw new RegistryError("conflict", "El tenant no admite acceso");
        const g = await d.support!.create({ tenantId: id, ...b });
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
        const operator = z.string().min(2).max(100).parse(req.query.operator ?? getAuth(req)!.tokenId);
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
        const days = Math.min(90, Math.max(1, Number(req.query.days ?? 30)));
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
