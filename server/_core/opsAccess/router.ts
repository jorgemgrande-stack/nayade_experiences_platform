/**
 * `POST /_ops/access` en el Core: ejecuta una acción de accesos firmada por el plano de control (ver ./token.ts) en el
 * contexto de la empresa indicada EN EL TOKEN. Se monta antes de resolver la empresa por el host (como el acceso
 * centralizado). Sin secreto configurado, responde 404 (el canal no existe).
 */
import express, { type Router } from "express";
import { OPS_ACCESS_PATH, verifyOpsAccessToken } from "./token";
import type { AccessResult } from "./actions";
import type { OpsAccessAction } from "./token";

export interface OpsAccessRouterDeps {
  secret: string | undefined;
  /** ¿La empresa existe y admite la gestión de accesos? (registro; nunca borrada) */
  tenantAllowed: (tenantId: string) => Promise<boolean>;
  /** Ejecuta en el contexto de la empresa (pool, configuración, identidad y correo de esa empresa). */
  run: (tenantId: string, act: OpsAccessAction, uid: number | undefined, confirm: string | undefined, ctx: { provider?: string; operator: string }) => Promise<AccessResult>;
  log?: (event: string, data: Record<string, unknown>) => void;
  now?: () => number;
}

const STATUS: Record<string, number> = { not_found: 404, confirm_mismatch: 409, owner_protected: 409, last_admin: 409, no_email: 409, inactive: 409, already_accepted: 409, seat_limit: 409, db_unavailable: 503, unknown_provider: 404, not_configured: 409 };

export function createOpsAccessRouter(d: OpsAccessRouterDeps): Router {
  const r = express.Router();
  const seen = new Map<string, number>(); // jti → caducidad (s): un token no se usa dos veces
  const now = d.now ?? Date.now;
  const log = d.log ?? ((event, data) => console.log(JSON.stringify({ ctx: "OpsAccess", event, ...data })));
  r.post(OPS_ACCESS_PATH, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (!d.secret || d.secret.length < 32) return void res.status(404).end();
    const auth = String(req.headers.authorization ?? "");
    const c = await verifyOpsAccessToken(auth.startsWith("Bearer ") ? auth.slice(7) : "", d.secret);
    if (!c) {
      log("rejected", { reason: "invalid_token" });
      return void res.status(401).json({ error: "unauthorized" });
    }
    const t = Math.floor(now() / 1000);
    seen.forEach((exp, k) => exp < t && seen.delete(k));
    if (seen.has(c.jti)) {
      log("rejected", { reason: "replay", tenantId: c.tid });
      return void res.status(409).json({ error: "replay" });
    }
    seen.set(c.jti, c.exp);
    if (!(await d.tenantAllowed(c.tid).catch(() => false))) return void res.status(404).json({ error: "tenant_not_found" });
    try {
      const out = await d.run(c.tid, c.act, c.uid, c.confirm, { provider: c.prv, operator: c.op });
      // Sin correos ni nombres en el registro: empresa, acción, usuario (id), operador y resultado
      log("done", { tenantId: c.tid, action: c.act, userId: c.uid ?? null, ...(c.prv ? { provider: c.prv } : {}), operator: c.op, ok: out.ok, ...(out.ok ? { mail: out.mail ?? null } : { error: out.error }) });
      if (!out.ok) return void res.status(STATUS[out.error] ?? 400).json({ error: out.error, message: out.message });
      res.json(out);
    } catch (e) {
      log("failed", { tenantId: c.tid, action: c.act, error: e instanceof Error ? e.name : "error" });
      res.status(500).json({ error: "internal" });
    }
  });
  return r;
}
