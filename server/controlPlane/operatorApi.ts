/**
 * Rutas HTTP de la autenticación de operadores humanos y de su gestión (`/cp/v1/auth/*`,
 * `/cp/v1/operators/*`). Las de acceso (login, restablecimiento) son públicas con límite de
 * intentos por IP; el resto exige sesión de operador (cookie + CSRF) y los ámbitos de su rol.
 */
import express, { type NextFunction, type Request, type Response, type Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { SESSION_COOKIE, getAuth, requireOperatorSession, requireScope } from "./auth";
import { OperatorAuthError, publicOperator, type ActingOperator, type OperatorAuthService, type RequestContext } from "./operatorAuth";
import { ROLES, ROLE_LABEL, assignableRoles } from "./operatorRoles";

export interface OperatorRoutesConfig {
  service: OperatorAuthService;
  allowedOrigins: ReadonlySet<string>;
  /** `auto` (por defecto): cookie Secure si la petición llega por HTTPS. */
  cookieSecure?: "auto" | boolean;
  /** Intentos fallidos de login por IP y ventana (por defecto 20 / 15 min). */
  loginLimit?: number;
  loginWindowMs?: number;
}

const ctxOf = (req: Request): RequestContext => ({ ip: req.ip ?? null, userAgent: String(req.headers["user-agent"] ?? "") || null });

const handle =
  (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch((e) => {
      if (e instanceof OperatorAuthError) {
        if (e.retryAfterSeconds) res.setHeader("Retry-After", String(e.retryAfterSeconds));
        return void res.status(e.status).json({ error: e.code, message: e.message });
      }
      if (e instanceof z.ZodError) return void res.status(400).json({ error: "invalid_request", message: "Datos no válidos" });
      console.error("[ControlPlane] error en autenticación de operadores:", e instanceof Error ? e.name : "error");
      res.status(500).json({ error: "internal_error", message: "Error interno" });
      void next;
    });
  };

function sessionCookie(req: Request, cfg: OperatorRoutesConfig, token: string, maxAgeSeconds: number) {
  const secure = cfg.cookieSecure === undefined || cfg.cookieSecure === "auto" ? req.secure : cfg.cookieSecure;
  // El token es base64url (sin caracteres que requieran codificación)
  return [`${SESSION_COOKIE}=${token}`, "Path=/cp/v1", `Max-Age=${Math.max(0, maxAgeSeconds)}`, "HttpOnly", "SameSite=Strict", ...(secure ? ["Secure"] : [])].join("; ");
}

/** Rechaza peticiones de navegador desde orígenes no autorizados (login CSRF). */
function checkOrigin(cfg: OperatorRoutesConfig) {
  return (req: Request, res: Response, next: NextFunction) => {
    const o = req.headers.origin;
    if (typeof o === "string" && !cfg.allowedOrigins.has(o)) {
      res.status(403).json({ error: "origin_not_allowed", message: "Origen no autorizado" });
      return;
    }
    next();
  };
}

const acting = (req: Request): ActingOperator => {
  const v = getAuth(req)!.operator!;
  return { id: v.operator.id, username: v.operator.username, role: v.operator.role, sessionId: v.session.id };
};

const sessionBody = (svc: OperatorAuthService, req: Request) => {
  const a = getAuth(req)!;
  const v = a.operator!;
  const now = Date.now();
  return {
    operator: publicOperator(v.operator, now),
    scopes: Array.from(a.scopes),
    csrfToken: v.session.csrfToken,
    expiresAt: v.session.expiresAt,
    idleTimeoutSeconds: Math.round(svc.idleMs / 1000),
    assignableRoles: assignableRoles(v.operator.role),
  };
};

/** Rutas sin sesión previa: se montan ANTES de la autenticación. */
export function createPublicAuthRouter(cfg: OperatorRoutesConfig): Router {
  const r = express.Router();
  const svc = cfg.service;
  const limiter = rateLimit({
    windowMs: cfg.loginWindowMs ?? 15 * 60_000,
    limit: cfg.loginLimit ?? 20,
    // Solo cuentan los intentos fallidos: entrar bien no consume cupo
    skipSuccessfulRequests: true,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req, res) => void res.status(429).json({ error: "too_many_attempts", message: "Demasiados intentos desde esta conexión. Espera unos minutos." }),
  });

  r.get("/auth/options", (_req, res) => {
    res.json({ passwordLogin: true, passwordReset: svc.resetAvailable });
  });

  r.post(
    "/auth/login",
    checkOrigin(cfg),
    limiter,
    handle(async (req, res) => {
      const b = z.object({ username: z.string().max(254), password: z.string().max(256) }).parse(req.body);
      const { token, session, operator } = await svc.login(b.username, b.password, ctxOf(req));
      res.setHeader("Set-Cookie", sessionCookie(req, cfg, token, Math.floor((session.expiresAt - session.createdAt) / 1000)));
      res.setHeader("Cache-Control", "no-store");
      res.json({
        operator: publicOperator(operator, Date.now()),
        csrfToken: session.csrfToken,
        expiresAt: session.expiresAt,
        idleTimeoutSeconds: Math.round(svc.idleMs / 1000),
      });
    }),
  );

  r.post(
    "/auth/password-reset/request",
    checkOrigin(cfg),
    limiter,
    handle(async (req, res) => {
      const b = z.object({ username: z.string().min(1).max(254) }).parse(req.body);
      await svc.requestReset(b.username, ctxOf(req));
      res.status(202).json({ message: "Si la cuenta existe y tiene correo, recibirás un enlace para restablecer la contraseña." });
    }),
  );

  r.post(
    "/auth/password-reset/confirm",
    checkOrigin(cfg),
    limiter,
    handle(async (req, res) => {
      const b = z.object({ token: z.string().max(128), password: z.string().max(256) }).parse(req.body);
      await svc.confirmReset(b.token, b.password, ctxOf(req));
      res.json({ ok: true });
    }),
  );
  return r;
}

/** Rutas con sesión de operador: se montan DESPUÉS de la autenticación. */
export function createOperatorRouter(cfg: OperatorRoutesConfig): Router {
  const r = express.Router();
  const svc = cfg.service;
  const idParam = (req: Request) => z.coerce.number().int().positive().parse(req.params.id);

  r.get("/auth/session", requireOperatorSession(), (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json(sessionBody(svc, req));
  });

  r.post(
    "/auth/logout",
    requireOperatorSession(),
    handle(async (req, res) => {
      const v = getAuth(req)!.operator!;
      await svc.logout(v.session, v.operator, ctxOf(req));
      res.setHeader("Set-Cookie", sessionCookie(req, cfg, "", 0));
      res.status(204).end();
    }),
  );

  r.post(
    "/auth/password",
    requireOperatorSession(),
    handle(async (req, res) => {
      const b = z.object({ currentPassword: z.string().max(256), newPassword: z.string().max(256) }).parse(req.body);
      await svc.changeOwnPassword(acting(req), b.currentPassword, b.newPassword, ctxOf(req));
      res.json({ ok: true });
    }),
  );

  // ── Gestión de operadores ──────────────────────────────────────────────────
  r.use("/operators", requireOperatorSession());

  r.get(
    "/operators",
    requireScope("operators:read"),
    handle(async (req, res) => {
      res.json({ operators: await svc.list(), roles: ROLES.map((id) => ({ id, label: ROLE_LABEL[id] })), assignableRoles: assignableRoles(acting(req).role) });
    }),
  );

  r.post(
    "/operators",
    requireScope("operators:write"),
    handle(async (req, res) => {
      const b = z
        .object({ username: z.string().max(64), email: z.string().max(254).nullable().optional(), displayName: z.string().max(120), role: z.string().max(20), password: z.string().max(256) })
        .parse(req.body);
      res.status(201).json({ operator: await svc.create(acting(req), b, ctxOf(req)) });
    }),
  );

  r.patch(
    "/operators/:id",
    requireScope("operators:write"),
    handle(async (req, res) => {
      const b = z
        .object({ email: z.string().max(254).nullable().optional(), displayName: z.string().max(120).optional(), role: z.string().max(20).optional(), status: z.string().max(20).optional() })
        .strict()
        .parse(req.body);
      res.json({ operator: await svc.update(acting(req), idParam(req), b, ctxOf(req)) });
    }),
  );

  r.post(
    "/operators/:id/password",
    requireScope("operators:write"),
    handle(async (req, res) => {
      const b = z.object({ password: z.string().max(256) }).parse(req.body);
      await svc.setPassword(acting(req), idParam(req), b.password, ctxOf(req));
      res.json({ ok: true });
    }),
  );

  r.get(
    "/operators/:id/sessions",
    requireScope("operators:read"),
    handle(async (req, res) => {
      const id = idParam(req);
      await svc.get(id);
      res.json({ sessions: await svc.sessions(id) });
    }),
  );

  r.post(
    "/operators/:id/sessions/revoke",
    requireScope("operators:write"),
    handle(async (req, res) => {
      res.json({ revoked: await svc.revokeSessions(acting(req), idParam(req), ctxOf(req)) });
    }),
  );

  r.get(
    "/operators/:id/events",
    requireScope("operators:read"),
    handle(async (req, res) => {
      const id = idParam(req);
      await svc.get(id);
      res.json({ events: await svc.events(id, 100) });
    }),
  );
  return r;
}
