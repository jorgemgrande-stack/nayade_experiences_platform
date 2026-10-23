/**
 * Accesos de las empresas clientes desde el plano de control (Clientes SaaS → empresa → Accesos).
 *
 * El plano de control NO toca la tabla de usuarios: pide al Core, por la red privada, que ejecute la acción en el
 * contexto de la empresa (`/_ops/access`, token firmado de un solo uso; ver server/_core/opsAccess). Aquí se decide
 * QUIÉN puede pedir QUÉ (alcances del operador), se limita la frecuencia y se deja constancia en el historial de la
 * empresa (registro, solo anexado), también cuando falla.
 */
import express, { type Request, type Response, type Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { OPS_ACCESS_PATH, signOpsAccessToken, type OpsAccessAction } from "../_core/opsAccess/token";

export const DEFAULT_CORE_INTERNAL_URL = "http://core.railway.internal:3000";
export const ACCESS_ACTIONS = ["reset", "invite", "unlock", "activate", "deactivate"] as const;
export type AccessUserAction = (typeof ACCESS_ACTIONS)[number];

export interface CoreAccessClient {
  call(c: { tenantId: string; act: OpsAccessAction; uid?: number; confirm?: string; operator: string }): Promise<{ status: number; body: Record<string, unknown> }>;
}

export function coreAccessClient(o: { baseUrl: string; secret: string; fetch?: typeof fetch; timeoutMs?: number }): CoreAccessClient {
  const f = o.fetch ?? fetch;
  const base = o.baseUrl.replace(/\/+$/, "");
  return {
    async call(c) {
      const token = await signOpsAccessToken({ tid: c.tenantId, act: c.act, uid: c.uid, confirm: c.confirm, op: c.operator }, o.secret, 60);
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), o.timeoutMs ?? 15_000);
      try {
        const r = await f(`${base}${OPS_ACCESS_PATH}`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: "{}", signal: ctl.signal });
        const body = (await r.json().catch(() => ({}))) as Record<string, unknown>;
        return { status: r.status, body };
      } catch {
        return { status: 503, body: { error: "core_unreachable", message: "No se pudo contactar con el Core" } };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

export interface TenantAccessRouteDeps {
  client: CoreAccessClient;
  tenantExists: (id: string) => Promise<boolean>;
  record: (req: Request, tenantId: string, action: string, details: Record<string, unknown>) => Promise<void>;
  operatorOf: (req: Request) => string;
  requireRead: express.RequestHandler;
  requireWrite: express.RequestHandler;
  /** Envoltorio de errores del plano de control (Zod → 400, dominio → su código, resto → 500 genérico). */
  wrap: (fn: (req: Request, res: Response) => Promise<void>) => express.RequestHandler;
  perMinute?: number;
}

const idSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{1,62}$/);
const actionBody = z.object({ reason: z.string().trim().min(5).max(300), confirmEmail: z.string().trim().max(254).optional() }).strict();

/** Rutas bajo el router autenticado de /cp/v1. */
export function registerTenantAccessRoutes(router: Router, d: TenantAccessRouteDeps): void {
  const limiter = rateLimit({
    windowMs: 60_000,
    limit: d.perMinute ?? 20,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => `access:${d.operatorOf(req)}`,
    message: { error: "rate_limited", message: "Demasiadas acciones de acceso seguidas; espera un minuto" },
  });
  const send = (res: Response, status: number, body: Record<string, unknown>) => void res.status(status >= 500 ? 502 : status).json(body);

  router.get("/tenants/:id/access", d.requireRead, d.wrap(async (req, res) => {
    {
      const id = idSchema.parse(req.params.id);
      if (!(await d.tenantExists(id))) return void res.status(404).json({ error: "not_found", message: "Empresa no encontrada" });
      const r = await d.client.call({ tenantId: id, act: "list", operator: d.operatorOf(req) });
      if (r.status !== 200) return send(res, r.status, r.body);
      res.json({ tenantId: id, mailMode: r.body.mailMode ?? null, users: r.body.users ?? [] });
    }
  }));

  router.post("/tenants/:id/access/users/:uid/:action", d.requireWrite, limiter, d.wrap(async (req, res) => {
    {
      const id = idSchema.parse(req.params.id);
      const uid = z.coerce.number().int().positive().parse(req.params.uid);
      const action = z.enum(ACCESS_ACTIONS).parse(req.params.action);
      const b = actionBody.parse(req.body ?? {});
      if ((action === "reset" || action === "invite") && !b.confirmEmail)
        return void res.status(400).json({ error: "confirm_required", message: "Escribe el correo del usuario para confirmar el envío" });
      if (!(await d.tenantExists(id))) return void res.status(404).json({ error: "not_found", message: "Empresa no encontrada" });
      const r = await d.client.call({ tenantId: id, act: action, uid, confirm: b.confirmEmail, operator: d.operatorOf(req) });
      const ok = r.status === 200;
      // Historial de la empresa SIEMPRE (también si falla): sin correos ni tokens, solo el usuario (id) y el resultado
      await d.record(req, id, `access.${action}`, { userId: uid, reason: b.reason, result: ok ? "ok" : String(r.body.error ?? r.status), mail: ok ? (r.body.mail ?? null) : null });
      if (!ok) return send(res, r.status, r.body);
      res.json({ ok: true, action, mail: r.body.mail ?? null, active: r.body.active ?? null });
    }
  }));
}
