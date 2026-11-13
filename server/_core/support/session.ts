/**
 * Sesión de soporte en el Core.
 *
 *  - `/_support/enter?t=<token>` canjea el token (de un solo uso práctico: TTL corto) por una
 *    cookie HttpOnly/SameSite=Strict ligada al tenant del host.
 *  - Cada petición con la cookie revalida: firma, caducidad, tenant resuelto == `tid`,
 *    concesión vigente y no revocada (lectura del registro).
 *  - Solo lectura por defecto: métodos que modifican se rechazan en el borde.
 *  - Rutas vetadas SIEMPRE al soporte (gestión de usuarios y permisos, secretos de integraciones, datos completos de
 *    pago…; ver ./policy.ts); exportaciones y descargas sensibles solo con modificación y auditadas.
 *  - Auditoría persistente en el historial de la empresa (./audit.ts): entrada, salida, cada modificación con su
 *    resultado, intentos bloqueados y exportaciones. Sin registro no hay entrada ni modificación (falla cerrado).
 *  - Los tokens jamás se registran; se registran concesión, operador, recurso, método y resultado.
 */
import crypto from "node:crypto";
import type { NextFunction, Request, RequestHandler, Response, Router } from "express";
import express from "express";
import { SignJWT, jwtVerify } from "jose";
import { peekTenantContext } from "../tenant";
import { MAX_SUPPORT_MINUTES, grantActive, type SupportGrant, type SupportGrantReader } from "./grants";
import { supportAuditSender, type SupportAuditSender } from "./audit";
import { classifySupportRequest } from "./policy";

export const SUPPORT_COOKIE = "es_support";
/**
 * Por HTTPS la sesión de soporte va en `__Host-es_support` (Secure, Path=/, sin Domain): ninguna otra empresa del
 * mismo dominio padre (`*.app.bigelephant.es`) puede fijarla. Las sesiones de soporte duran minutos, así que no
 * hace falta transición: por HTTPS solo vale la nueva; la de sin prefijo queda para desarrollo sin HTTPS.
 */
export const SUPPORT_COOKIE_HOST = "__Host-es_support";
const supportToken = (req: Request) => cookieOf(req, SUPPORT_COOKIE_HOST) ?? (req.secure ? undefined : cookieOf(req, SUPPORT_COOKIE));

let reader: SupportGrantReader | null = null;
let secretRaw: string | undefined;
let audit: SupportAuditSender = async () => false;
/** Adónde vuelve el operador al salir del modo soporte (el CRM central). */
let returnUrl = "https://admin.bigelephant.es/";
const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);

export function configureSupport(
  r: SupportGrantReader | null,
  secret: string | undefined = process.env.SUPPORT_JWT_SECRET,
  o: { audit?: SupportAuditSender; auditUrl?: string; returnUrl?: string } = {},
): void {
  reader = r;
  secretRaw = secret && secret.length >= 32 ? secret : undefined;
  audit = o.audit ?? (secretRaw ? supportAuditSender({ secret: secretRaw, url: o.auditUrl || process.env.SUPPORT_AUDIT_URL }) : async () => false);
  returnUrl = o.returnUrl || process.env.SUPPORT_RETURN_URL || "https://admin.bigelephant.es/";
}

/**
 * Evento de auditoría desde un procedimiento tRPC (exportación o intento vetado) de la sesión de soporte en curso.
 * `false` si no consta registrado (quien lo pide decide si falla cerrado).
 */
export async function auditSupportEvent(grantId: string, ev: Parameters<SupportAuditSender>[0]["ev"], d: { method?: string; resource?: string; reason?: string } = {}): Promise<boolean> {
  const tid = peekTenantContext()?.tenantId;
  if (!tid || !supportEnabled()) return false;
  return audit({ gid: grantId, tid, ev, d });
}

/** Operador sin el prefijo técnico («operator:jorge» → «jorge»), para mostrarlo. */
const operatorLabel = (op: string) => op.replace(/^(operator|crm):/, "");

const key = () => new TextEncoder().encode(secretRaw ?? "");
export const supportEnabled = () => !!reader && !!secretRaw;

export async function signSupportToken(g: SupportGrant, secret: string, ttlSeconds?: number): Promise<string> {
  const ttl = Math.min(ttlSeconds ?? Math.floor((g.expiresAt - Date.now()) / 1000), MAX_SUPPORT_MINUTES * 60);
  return new SignJWT({ gid: g.id, tid: g.tenantId, op: g.operator, ro: g.readOnly })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${Math.max(1, ttl)}s`)
    .sign(new TextEncoder().encode(secret));
}

async function verify(token: string): Promise<{ gid: string; tid: string; op: string; ro: boolean } | null> {
  if (!secretRaw) return null;
  try {
    const { payload } = await jwtVerify(token, key(), { algorithms: ["HS256"] });
    if (typeof payload.gid !== "string" || typeof payload.tid !== "string") return null;
    return { gid: payload.gid, tid: payload.tid, op: String(payload.op ?? ""), ro: payload.ro !== false };
  } catch {
    return null;
  }
}

function cookieOf(req: Request, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i !== -1 && part.slice(0, i).trim() === name) {
      try {
        return decodeURIComponent(part.slice(i + 1).trim());
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

export interface SupportIdentity {
  grant: SupportGrant;
  readOnly: boolean;
}

/** Valida la sesión de soporte de la petición contra el tenant resuelto. */
export async function getSupportIdentity(req: Request): Promise<SupportIdentity | null> {
  if (!supportEnabled()) return null;
  const token = supportToken(req);
  if (!token) return null;
  const claims = await verify(token);
  if (!claims) return null;
  const tenant = peekTenantContext()?.tenantId;
  if (!tenant || claims.tid !== tenant) return null; // nunca fuera del tenant concedido
  const grant = await reader!.getGrant(claims.gid);
  if (!grant || grant.tenantId !== tenant || !grantActive(grant)) return null;
  return { grant, readOnly: grant.readOnly };
}

/** Usuario sintético para el contexto tRPC/autorización (rol admin; lectura impuesta en el borde). */
export async function getSupportUser(req: Request) {
  const id = await getSupportIdentity(req);
  if (!id) return null;
  const now = new Date();
  return {
    id: -1,
    openId: `support:${id.grant.id}`,
    name: `Soporte Big Elephant (${operatorLabel(id.grant.operator)})`,
    email: null,
    loginMethod: "support",
    role: "admin" as const,
    partnerId: null,
    supplierId: null,
    phone: null,
    avatarUrl: null,
    isActive: true,
    passwordHash: null,
    inviteToken: null,
    inviteTokenExpiry: null,
    inviteAccepted: true,
    createdAt: now,
    updatedAt: now,
    lastSignedIn: now,
    supportGrantId: id.grant.id,
    // Para la banda «Modo soporte» del panel (nunca el token)
    supportOperator: operatorLabel(id.grant.operator),
    supportReadOnly: id.readOnly,
    supportExpiresAt: id.grant.expiresAt,
  };
}

/**
 * Borde de la sesión de soporte: rutas vetadas, solo lectura, exportaciones y auditoría de cada modificación.
 * Sin sesión de soporte no hace nada.
 */
export function supportReadOnlyGuard(log: (l: string) => void = (l) => console.warn(l)): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!supportEnabled() || !supportToken(req)) return next();
    const id = await getSupportIdentity(req);
    if (!id) return next(); // cookie no válida: la sesión de soporte simplemente no existe
    if (req.path.startsWith("/_support/")) return next();
    const g = id.grant;
    const { kind, resource } = classifySupportRequest(req.method, req.originalUrl ?? req.url);
    const safe = SAFE.has(req.method);
    const trace = (event: string) => log(JSON.stringify({ ctx: "Support", event, grant: g.id, op: g.operator, method: req.method, path: resource.slice(0, 120) }));
    const send = (ev: Parameters<SupportAuditSender>[0]["ev"], d: { status?: number; reason?: string } = {}) =>
      audit({ gid: g.id, tid: g.tenantId, ev, d: { method: req.method, resource, ...d } });

    // 1. Vetado al soporte siempre (también con modificación): usuarios y permisos, secretos, pagos completos…
    if (kind === "forbidden") {
      trace("forbidden");
      void send("blocked", { reason: "forbidden" });
      return void res.status(403).json({ error: "support_forbidden", message: "No disponible en modo soporte" });
    }
    // 2. Exportaciones y descargas sensibles: solo con modificación y con el registro hecho ANTES
    if (kind === "export") {
      if (id.readOnly) {
        trace("export_blocked");
        void send("blocked", { reason: "export_read_only" });
        return void res.status(403).json({ error: "support_read_only", message: "Las exportaciones requieren un acceso de soporte con modificación" });
      }
      if (!(await send("export"))) return void res.status(503).json({ error: "support_audit_unavailable", message: "No se ha podido registrar la operación de soporte" });
      return next();
    }
    if (safe) return next(); // consultas ordinarias: sin registro (ruido)
    // 3. Modificaciones
    if (id.readOnly) {
      trace("write_blocked");
      void send("write_blocked");
      return void res.status(403).json({ error: "support_read_only" });
    }
    if (!(await send("write"))) {
      trace("audit_unavailable");
      return void res.status(503).json({ error: "support_audit_unavailable", message: "No se ha podido registrar la operación de soporte" });
    }
    res.on("finish", () => void send("write_result", { status: res.statusCode }));
    next();
  };
}

export function createSupportRouter(): Router {
  const r = express.Router();

  r.get("/_support/enter", async (req, res) => {
    if (!supportEnabled()) return void res.status(404).end();
    const token = String(req.query.t ?? "");
    const claims = await verify(token);
    const tenant = peekTenantContext()?.tenantId;
    const grant = claims && claims.tid === tenant ? await reader!.getGrant(claims.gid) : null;
    if (!claims || !grant || grant.tenantId !== tenant || !grantActive(grant)) {
      return void res.status(403).type("text/plain").send("Acceso no válido o caducado");
    }
    // La entrada queda en el historial de la empresa antes de abrir el panel; sin registro no se entra
    if (!(await audit({ gid: grant.id, tid: grant.tenantId, ev: "entered", d: {} }))) {
      console.warn(JSON.stringify({ ctx: "Support", event: "enter_audit_unavailable", grant: grant.id, tenant }));
      return void res.status(503).type("text/plain").send("No se ha podido registrar el acceso de soporte. Inténtalo de nuevo en unos minutos.");
    }
    console.warn(JSON.stringify({ ctx: "Support", event: "enter", grant: grant.id, op: grant.operator, tenant }));
    const opts = { httpOnly: true, sameSite: "strict" as const, path: "/", maxAge: Math.max(1000, grant.expiresAt - Date.now()) };
    if (req.secure) res.cookie(SUPPORT_COOKIE_HOST, token, { ...opts, secure: true });
    else res.cookie(SUPPORT_COOKIE, token, { ...opts, secure: process.env.NODE_ENV === "production" });
    res.redirect(302, "/admin");
  });

  // Salir del modo soporte: termina la concesión (el plano de control la revoca al recibir la salida), borra SOLO la
  // cookie de soporte y devuelve adónde volver (el CRM). La sesión central del operador no se toca.
  r.post("/_support/exit", async (req, res) => {
    const id = await getSupportIdentity(req).catch(() => null);
    if (id) {
      const ok = await audit({ gid: id.grant.id, tid: id.grant.tenantId, ev: "exited", d: {} });
      console.warn(JSON.stringify({ ctx: "Support", event: "exit", grant: id.grant.id, op: id.grant.operator, recorded: ok }));
    }
    res.clearCookie(SUPPORT_COOKIE_HOST, { path: "/", secure: true, httpOnly: true, sameSite: "strict" });
    res.clearCookie(SUPPORT_COOKIE, { path: "/" });
    res.setHeader("Cache-Control", "no-store");
    res.json({ returnUrl });
  });

  return r;
}

/** Utilidad para pruebas: token aleatorio no válido. */
export const _randomToken = () => crypto.randomBytes(24).toString("hex");
