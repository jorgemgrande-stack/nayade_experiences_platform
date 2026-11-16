/**
 * Sesión de soporte en el Core.
 *
 *  - `/_support/enter?t=<token>` canjea el token de ENTRADA (tipo propio, 120 s, un solo uso por réplica) por una
 *    cookie de SESIÓN distinta (otro tipo), HttpOnly/SameSite=Strict, ligada al tenant del host.
 *    Un enlace filtrado (historial, registros de un proxy) ya no abre nada pasados 2 minutos o tras usarse.
 *  - AUTORIZACIÓN y SESIÓN son cosas distintas. Con duración limitada la sesión dura lo que la concesión (≤ 4 h). Con
 *    «hasta revocación» la autorización no caduca, pero cada sesión sí, con los controles de las sesiones de operador
 *    del CRM: 2 h sin actividad y 12 h como máximo (la cookie se renueva sola con la actividad, nunca más allá de las
 *    12 h). Solo cuenta la actividad real: modificaciones y el aviso del panel al pulsar o escribir (/_support/heartbeat);
 *    las consultas periódicas no. Pasado eso se abre otra desde el CRM, con el operador autenticado allí y la autorización vigente
 *    (`support.session_renewed`). Cada sesión lleva su identificador (`sid`): «Finalizar sesión» la cierra en el
 *    servidor (`support.exited`) sin revocar la autorización; revocar la autorización invalida todas sus sesiones.
 *  - Cada petición con la cookie revalida: firma, caducidad, tenant resuelto == `tid`,
 *    concesión vigente y no revocada (lectura del registro).
 *  - Solo lectura por defecto: métodos que modifican se rechazan en el borde.
 *  - Rutas vetadas SIEMPRE al soporte, también con modificación (gestión de usuarios y permisos, autenticación,
 *    credenciales y secretos, datos bancarios y de pago…; ver ./policy.ts); exportaciones y descargas sensibles solo
 *    con modificación y auditadas.
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

/** Sesiones de una autorización «hasta revocación»: como las de operador del CRM (operatorAuth: 2 h / 12 h). */
export const SUPPORT_SESSION_IDLE_MS = 2 * 3600_000;
export const SUPPORT_SESSION_MAX_MS = 12 * 3600_000;
/** Cada cuánto, con actividad real, se renueva la cookie y se anota la actividad (`support.activity`). */
export const SUPPORT_SESSION_REFRESH_MS = 15 * 60_000;
/** Cuánto se fía cada réplica de «la sesión no consta cerrada» antes de volver a leerlo. */
const ENDED_CACHE_MS = 15_000;

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

/** Validez del enlace de entrada que entrega el CRM: se abre al momento. */
export const SUPPORT_ENTRY_TTL_SECONDS = 120;
const TYP_ENTRY = "es_support_entry";
const TYP_SESSION = "es_support_session";
type SupportTokenKind = "entry" | "session";

/** Sesión concreta dentro de la concesión: identificador, apertura y tope absoluto (ms). */
export interface SupportSessionClaims {
  sid: string;
  sopen: number;
  smax: number;
}

/**
 * Token de soporte. `entry` (por defecto): el enlace de entrada, 120 s y de un solo uso. `session`: la cookie; con
 * duración limitada, hasta el fin de la concesión; con «hasta revocación», 2 h renovables hasta el tope de la sesión.
 * Tipos propios: ni se confunden entre sí ni con los eventos de auditoría (mismo secreto).
 */
export async function signSupportToken(g: SupportGrant, secret: string, ttlSeconds?: number, kind: SupportTokenKind = "entry", session?: SupportSessionClaims): Promise<string> {
  const now = Date.now();
  let ttl: number;
  if (kind === "entry") {
    const untilGrant = g.untilRevoked ? SUPPORT_ENTRY_TTL_SECONDS : Math.floor((g.expiresAt - now) / 1000);
    ttl = Math.min(ttlSeconds ?? SUPPORT_ENTRY_TTL_SECONDS, untilGrant);
  } else if (g.untilRevoked) {
    const cap = Math.floor(((session?.smax ?? now + SUPPORT_SESSION_MAX_MS) - now) / 1000);
    ttl = Math.min(ttlSeconds ?? SUPPORT_SESSION_IDLE_MS / 1000, SUPPORT_SESSION_IDLE_MS / 1000, cap);
  } else {
    const untilGrant = Math.floor((g.expiresAt - now) / 1000);
    ttl = Math.min(ttlSeconds ?? untilGrant, untilGrant, MAX_SUPPORT_MINUTES * 60);
  }
  return new SignJWT({ typ: kind === "entry" ? TYP_ENTRY : TYP_SESSION, gid: g.id, tid: g.tenantId, op: g.operator, ro: g.readOnly, ...(session ? { sid: session.sid, sopen: session.sopen, smax: session.smax } : {}) })
    .setProtectedHeader({ alg: "HS256" })
    .setJti(crypto.randomBytes(12).toString("hex"))
    .setIssuedAt()
    .setExpirationTime(`${Math.max(1, ttl)}s`)
    .sign(new TextEncoder().encode(secret));
}

interface VerifiedToken {
  gid: string;
  tid: string;
  op: string;
  ro: boolean;
  jti: string;
  exp: number;
  iat: number;
  /** Solo en las cookies emitidas desde el 16/11/2026; las anteriores (sin sesión) valen hasta su caducidad. */
  session: SupportSessionClaims | null;
}

async function verify(token: string, kind: SupportTokenKind): Promise<VerifiedToken | null> {
  if (!secretRaw) return null;
  try {
    const { payload } = await jwtVerify(token, key(), { algorithms: ["HS256"] });
    if (payload.typ !== (kind === "entry" ? TYP_ENTRY : TYP_SESSION)) return null;
    if (typeof payload.gid !== "string" || typeof payload.tid !== "string" || typeof payload.jti !== "string" || typeof payload.exp !== "number") return null;
    const session =
      typeof payload.sid === "string" && /^[a-f0-9]{24}$/.test(payload.sid) && typeof payload.sopen === "number" && typeof payload.smax === "number"
        ? { sid: payload.sid, sopen: payload.sopen, smax: payload.smax }
        : null;
    return { gid: payload.gid, tid: payload.tid, op: String(payload.op ?? ""), ro: payload.ro !== false, jti: payload.jti, exp: payload.exp, iat: typeof payload.iat === "number" ? payload.iat : 0, session };
  } catch {
    return null;
  }
}

/** Enlaces de entrada ya canjeados en esta réplica (jti → caducidad, s). */
const usedEntries = new Map<string, number>();
function consumeEntry(jti: string, exp: number): boolean {
  const now = Math.floor(Date.now() / 1000);
  usedEntries.forEach((e, k) => e < now && usedEntries.delete(k));
  if (usedEntries.has(jti)) return false;
  usedEntries.set(jti, exp);
  return true;
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
  /** Sesión concreta (null: cookie anterior a las sesiones identificadas, solo con duración limitada). */
  session: (SupportSessionClaims & { iat: number }) | null;
}

/** Sesiones cerradas o comprobadas como abiertas, por réplica (clave concesión:sesión). */
const endedCache = new Map<string, { ended: boolean; until: number }>();
function markSessionEnded(grantId: string, sid: string, until: number) {
  endedCache.set(`${grantId}:${sid}`, { ended: true, until });
}
async function sessionEnded(g: SupportGrant, s: SupportSessionClaims): Promise<boolean> {
  const k = `${g.id}:${s.sid}`;
  const now = Date.now();
  const hit = endedCache.get(k);
  if (hit && (hit.ended || hit.until > now)) return hit.ended;
  if (endedCache.size > 5000) endedCache.forEach((v, key) => v.until < now && endedCache.delete(key));
  if (!reader?.sessionEnded) return false;
  try {
    const ended = await reader.sessionEnded(g.tenantId, g.id, s.sid, s.sopen);
    endedCache.set(k, { ended, until: ended ? s.smax : now + ENDED_CACHE_MS });
    return ended;
  } catch {
    return true; // sin poder comprobarlo, la sesión no vale (falla cerrado)
  }
}

const identityCache = new WeakMap<Request, Promise<SupportIdentity | null>>();

/** Valida la sesión de soporte de la petición contra el tenant resuelto (una vez por petición). */
export function getSupportIdentity(req: Request): Promise<SupportIdentity | null> {
  const hit = identityCache.get(req);
  if (hit) return hit;
  const p = resolveIdentity(req);
  identityCache.set(req, p);
  return p;
}

async function resolveIdentity(req: Request): Promise<SupportIdentity | null> {
  if (!supportEnabled()) return null;
  const token = supportToken(req);
  if (!token) return null;
  const claims = await verify(token, "session");
  if (!claims) return null;
  const tenant = peekTenantContext()?.tenantId;
  if (!tenant || claims.tid !== tenant) return null; // nunca fuera del tenant concedido
  const grant = await reader!.getGrant(claims.gid);
  if (!grant || grant.tenantId !== tenant || !grantActive(grant)) return null;
  const s = claims.session;
  // «Hasta revocación» solo con sesión identificada (no hay cookies antiguas de esa modalidad)
  if (grant.untilRevoked && !s) return null;
  if (s) {
    if (Date.now() >= s.smax) return null;
    if (await sessionEnded(grant, s)) return null;
  }
  return { grant, readOnly: grant.readOnly, session: s ? { ...s, iat: claims.iat } : null };
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
    supportUntilRevoked: id.grant.untilRevoked,
    // Con «hasta revocación» no hay caducidad de la autorización que mostrar
    supportExpiresAt: id.grant.untilRevoked ? null : id.grant.expiresAt,
  };
}

/**
 * Error en el formato de tRPC (superjson) para las rutas /api/trpc: el panel muestra el mensaje en lugar de
 * «Unable to transform response from server». Un lote recibe un error por procedimiento.
 */
function supportError(req: Request, res: Response, status: number, error: string, message: string) {
  const url = req.originalUrl ?? req.url;
  if (!url.toLowerCase().startsWith("/api/trpc")) return void res.status(status).json({ error, message });
  const code = status === 503 ? "SERVICE_UNAVAILABLE" : "FORBIDDEN";
  const rpc = status === 503 ? -32603 : -32003;
  const raw = url.slice("/api/trpc/".length).split("?")[0] ?? "";
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    // Ruta mal codificada: se responde igual, sin descodificar (nunca una excepción sin capturar)
  }
  const paths = decoded.split(",");
  const one = (path: string) => ({ error: { json: { message, code: rpc, data: { code, httpStatus: status, path, supportError: error } } } });
  const batch = /[?&]batch=1(&|$)/.test(url);
  res.status(status).json(batch ? paths.map(one) : one(paths[0] ?? ""));
}

/**
 * Borde de la sesión de soporte (decisión del propietario, 13/11/2026):
 *  - Solo lectura (rol soporte, o elegida): sin modificaciones ni exportaciones.
 *  - Con modificación (solo administración: admin y superadmin, lo impone el plano de control al conceder): trabajo
 *    ordinario completo (Elephant Studio, contenidos, productos, reservas, CRM…). Cada modificación y exportación se
 *    registra ANTES (si el registro falla, no se hace) y con su resultado.
 *  - En ambos: credenciales, secretos, datos bancarios, autenticación y gestión de usuarios y permisos, vetados.
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

    const AUDIT_DOWN = "No se ha podido registrar la operación de soporte. Inténtalo de nuevo en unos segundos.";
    // 1. Vetado al soporte siempre (también con modificación): usuarios y permisos, autenticación, secretos, pagos…
    if (kind === "forbidden") {
      trace("forbidden");
      void send("blocked", { reason: "forbidden" });
      return supportError(req, res, 403, "support_forbidden", "No disponible en modo soporte: credenciales, secretos, datos bancarios, autenticación y permisos se gestionan con la propia empresa");
    }
    // 2. Exportaciones y descargas sensibles: solo con modificación y con el registro hecho ANTES
    if (kind === "export") {
      if (id.readOnly) {
        trace("export_blocked");
        void send("blocked", { reason: "export_read_only" });
        return supportError(req, res, 403, "support_read_only", "Las exportaciones requieren un acceso de soporte con modificación");
      }
      if (!(await send("export"))) return supportError(req, res, 503, "support_audit_unavailable", AUDIT_DOWN);
      return next();
    }
    if (safe) return next(); // consultas ordinarias: sin registro (ruido)
    // 3. Modificaciones
    if (id.readOnly) {
      trace("write_blocked");
      void send("write_blocked");
      return supportError(req, res, 403, "support_read_only", "Sesión de soporte de solo lectura: los cambios no se guardan. Para modificar, abre desde el CRM un acceso con modificación.");
    }
    if (!(await send("write"))) {
      trace("audit_unavailable");
      return supportError(req, res, 503, "support_audit_unavailable", AUDIT_DOWN);
    }
    res.on("finish", () => void send("write_result", { status: res.statusCode }));
    // Una modificación es actividad real: renueva la sesión «hasta revocación» (las consultas periódicas, no)
    await refreshSession(req, res, id);
    next();
  };
}

export function createSupportRouter(): Router {
  const r = express.Router();

  r.get("/_support/enter", async (req, res) => {
    if (!supportEnabled()) return void res.status(404).end();
    const token = String(req.query.t ?? "");
    const claims = await verify(token, "entry");
    const tenant = peekTenantContext()?.tenantId;
    const grant = claims && claims.tid === tenant ? await reader!.getGrant(claims.gid) : null;
    if (!claims || !grant || grant.tenantId !== tenant || !grantActive(grant)) {
      return void res.status(403).type("text/plain").send("Acceso no válido o caducado");
    }
    // Un solo uso: el mismo enlace no abre una segunda sesión (otra pestaña, otro navegador)
    if (!consumeEntry(claims.jti, claims.exp)) return void res.status(403).type("text/plain").send("Este enlace de acceso ya se ha usado. Pide uno nuevo desde el CRM.");
    // Sesión nueva, identificada por el enlace canjeado (un enlace = una sesión)
    const now = Date.now();
    const session: SupportSessionClaims = { sid: claims.jti, sopen: now, smax: grant.untilRevoked ? now + SUPPORT_SESSION_MAX_MS : grant.expiresAt };
    // La entrada queda en el historial de la empresa antes de abrir el panel; sin registro no se entra
    if (!(await audit({ gid: grant.id, tid: grant.tenantId, ev: "entered", d: { session: session.sid } }))) {
      console.warn(JSON.stringify({ ctx: "Support", event: "enter_audit_unavailable", grant: grant.id, tenant }));
      return void res.status(503).type("text/plain").send("No se ha podido registrar el acceso de soporte. Inténtalo de nuevo en unos minutos.");
    }
    console.warn(JSON.stringify({ ctx: "Support", event: "enter", grant: grant.id, op: grant.operator, tenant, untilRevoked: grant.untilRevoked }));
    // La cookie es una credencial distinta del enlace (tipo «sesión»): el enlace no sirve como cookie ni al revés
    const sessionToken = await signSupportToken(grant, secretRaw!, undefined, "session", session);
    setSessionCookie(req, res, sessionToken, grant.untilRevoked ? session.smax - now : grant.expiresAt - now);
    res.redirect(302, "/admin");
  });

  // Actividad real del operador (el panel lo envía al pulsar o escribir, como mucho cada pocos minutos): renueva la
  // sesión «hasta revocación». Las consultas periódicas del panel (avisos, cuadros que se refrescan solos) NO cuentan:
  // una pestaña abandonada cierra su sesión a las 2 h.
  r.post("/_support/heartbeat", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const origin = req.headers.origin;
    if (typeof origin === "string" && origin !== `${req.protocol}://${req.headers.host}`) return void res.status(403).json({ error: "forbidden_origin" });
    const id = await getSupportIdentity(req).catch(() => null);
    if (!id) return void res.status(401).json({ error: "no_support_session" });
    const renewed = await refreshSession(req, res, id);
    res.json({ ok: true, renewed });
  });

  // Salir del modo soporte. Duración limitada: termina la concesión (el plano de control la revoca al recibir la salida).
  // «Hasta revocación»: cierra SOLO esta sesión (en el servidor: `support.exited` con su identificador); la
  // autorización sigue vigente hasta que se revoque en el CRM. Borra solo la cookie de soporte y devuelve adónde volver.
  // La sesión central del operador no se toca.
  r.post("/_support/exit", async (req, res) => {
    // Solo desde el propio panel: otra empresa del mismo dominio padre (mismo «sitio») no puede cerrar la sesión
    const origin = req.headers.origin;
    if (typeof origin === "string" && origin !== `${req.protocol}://${req.headers.host}`) return void res.status(403).json({ error: "forbidden_origin" });
    const id = await getSupportIdentity(req).catch(() => null);
    let recorded = true;
    if (id) {
      // La salida revoca la concesión en el plano de control: se reintenta para no dejarla viva por un fallo puntual
      let ok = false;
      const d = id.session ? { session: id.session.sid } : {};
      for (let i = 0; i < 3 && !ok; i++) ok = await audit({ gid: id.grant.id, tid: id.grant.tenantId, ev: "exited", d });
      console.warn(JSON.stringify({ ctx: "Support", event: "exit", grant: id.grant.id, op: id.grant.operator, recorded: ok, untilRevoked: id.grant.untilRevoked }));
      recorded = ok;
      // En esta réplica deja de valer al momento; en las demás, en cuanto lean el cierre (≤ 15 s)
      if (ok && id.session) markSessionEnded(id.grant.id, id.session.sid, id.session.smax);
    }
    res.setHeader("Cache-Control", "no-store");
    // Sin el cierre registrado no se aparenta haber salido: la cookie se queda para poder reintentarlo
    if (id && !recorded) {
      return void res.status(503).json({ error: "exit_unrecorded", returnUrl, message: "No se ha podido registrar el cierre en el servidor. Vuelve a intentarlo o revoca el acceso desde el CRM." });
    }
    res.clearCookie(SUPPORT_COOKIE_HOST, { path: "/", secure: true, httpOnly: true, sameSite: "strict" });
    res.clearCookie(SUPPORT_COOKIE, { path: "/" });
    res.json(id?.grant.untilRevoked ? { returnUrl, authorizationKept: true } : { returnUrl });
  });

  return r;
}

/**
 * Renueva la sesión «hasta revocación» (2 h más, nunca más allá de su tope) si toca (cada 15 min como mucho). Solo si la
 * actividad queda registrada: sin rastro no hay renovación. `true` si se ha renovado.
 */
async function refreshSession(req: Request, res: Response, id: SupportIdentity): Promise<boolean> {
  const g = id.grant;
  if (!g.untilRevoked || !id.session || Date.now() - id.session.iat * 1000 < SUPPORT_SESSION_REFRESH_MS) return false;
  const { sid, sopen, smax } = id.session;
  if (!(await audit({ gid: g.id, tid: g.tenantId, ev: "activity", d: { session: sid } }))) return false;
  const token = await signSupportToken(g, secretRaw!, undefined, "session", { sid, sopen, smax });
  setSessionCookie(req, res, token, smax - Date.now());
  return true;
}

/** Cookie de la sesión de soporte (HttpOnly, Strict; por HTTPS con prefijo __Host-). */
function setSessionCookie(req: Request, res: Response, token: string, maxAgeMs: number) {
  const opts = { httpOnly: true, sameSite: "strict" as const, path: "/", maxAge: Math.max(1000, maxAgeMs) };
  if (req.secure) res.cookie(SUPPORT_COOKIE_HOST, token, { ...opts, secure: true });
  else res.cookie(SUPPORT_COOKIE, token, { ...opts, secure: process.env.NODE_ENV === "production" });
}

/** Utilidad para pruebas: memoria de la réplica vacía, como tras un reinicio. */
export function _resetSupportReplicaState() {
  endedCache.clear();
  usedEntries.clear();
}

/** Utilidad para pruebas: token aleatorio no válido. */
export const _randomToken = () => crypto.randomBytes(24).toString("hex");
