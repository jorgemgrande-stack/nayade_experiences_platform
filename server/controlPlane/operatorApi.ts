/**
 * Rutas HTTP de la autenticación de operadores humanos y de su gestión (`/cp/v1/auth/*`,
 * `/cp/v1/operators/*`). Las de acceso (login, restablecimiento) son públicas con límite de
 * intentos por IP; el resto exige sesión de operador (cookie + CSRF) y los ámbitos de su rol.
 */
import express, { type NextFunction, type Request, type Response, type Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { SESSION_COOKIE, SESSION_COOKIE_HOST, getAuth, readSessionCookie, requireOperatorSession, requireScope } from "./auth";
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

/**
 * Cabeceras Set-Cookie de la sesión. En HTTPS, `__Host-` (Secure, Path=/, sin Domain) y se borra la cookie
 * antigua `be_cp_session` (Path=/cp/v1) si quedara; en HTTP (solo desarrollo), la antigua.
 */
function sessionCookie(req: Request, cfg: OperatorRoutesConfig, token: string, maxAgeSeconds: number): string[] {
  const secure = cfg.cookieSecure === undefined || cfg.cookieSecure === "auto" ? req.secure : cfg.cookieSecure;
  const age = `Max-Age=${Math.max(0, maxAgeSeconds)}`;
  // El token es base64url (sin caracteres que requieran codificación)
  if (!secure) return [[`${SESSION_COOKIE}=${token}`, "Path=/cp/v1", age, "HttpOnly", "SameSite=Strict"].join("; ")];
  return [
    [`${SESSION_COOKIE_HOST}=${token}`, "Path=/", age, "HttpOnly", "SameSite=Strict", "Secure"].join("; "),
    [`${SESSION_COOKIE}=`, "Path=/cp/v1", "Max-Age=0", "HttpOnly", "SameSite=Strict", "Secure"].join("; "),
  ];
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
    mfa: { available: svc.mfaAvailable, enabled: !!v.operator.mfaEnabledAt, required: svc.mfaRequiredFor(v.operator.role), setupRequired: !!v.mfaSetupRequired },
  };
};

/** Respuesta de un acceso completo (login sin segundo factor o tras verificarlo). */
const loginBody = (svc: OperatorAuthService, r: { session: { csrfToken: string; expiresAt: number }; operator: Parameters<typeof publicOperator>[0] }, mfaSetupRequired = false) => ({
  operator: publicOperator(r.operator, Date.now()),
  csrfToken: r.session.csrfToken,
  expiresAt: r.session.expiresAt,
  idleTimeoutSeconds: Math.round(svc.idleMs / 1000),
  mfaSetupRequired,
});

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
    res.json({ passwordLogin: true, passwordReset: svc.resetAvailable, mfa: svc.mfaAvailable, emailChange: svc.emailChangeAvailable });
  });

  r.post(
    "/auth/login",
    checkOrigin(cfg),
    limiter,
    handle(async (req, res) => {
      const b = z.object({ username: z.string().max(254), password: z.string().max(256) }).parse(req.body);
      const result = await svc.login(b.username, b.password, ctxOf(req));
      const { token, session } = result;
      res.setHeader("Set-Cookie", sessionCookie(req, cfg, token, Math.floor((session.expiresAt - session.createdAt) / 1000)));
      res.setHeader("Cache-Control", "no-store");
      // Con segundo factor: la sesión pendiente no da acceso a nada (ni CSRF, ni datos del operador)
      if (result.mfa === "pending") return void res.json({ mfaRequired: true, expiresAt: session.expiresAt });
      res.json(loginBody(svc, result, result.mfa === "setup"));
    }),
  );

  r.post(
    "/auth/mfa/verify",
    checkOrigin(cfg),
    limiter,
    handle(async (req, res) => {
      const b = z.object({ code: z.string().max(32) }).parse(req.body);
      const result = await svc.verifyMfa(readSessionCookie(req) ?? "", b.code, ctxOf(req));
      res.setHeader("Set-Cookie", sessionCookie(req, cfg, result.token, Math.floor((result.session.expiresAt - result.session.createdAt) / 1000)));
      res.setHeader("Cache-Control", "no-store");
      res.json(loginBody(svc, result));
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

  // Confirmación del correo nuevo de un operador. El enlace del correo abre esta página (GET, sin efectos: los
  // analizadores de enlaces de los buzones no confirman nada) y el botón envía el formulario (POST, un solo uso).
  r.get("/auth/email-change/confirm", (req, res) => {
    const token = typeof req.query.token === "string" ? req.query.token.slice(0, 128) : "";
    emailChangePage(res, 200, "Confirma tu nuevo correo", "Pulsa el botón para confirmar el nuevo correo de acceso de tu cuenta de Big Elephant CRM (administración central).", token);
  });

  r.post(
    "/auth/email-change/confirm",
    checkOrigin(cfg),
    limiter,
    express.urlencoded({ extended: false, limit: "2kb" }),
    handle(async (req, res) => {
      // Formulario de la página (HTML) o petición de una aplicación (JSON)
      const form = !req.is("application/json");
      const b = z.object({ token: z.string().max(128) }).safeParse(req.body);
      try {
        await svc.confirmEmailChange(b.success ? b.data.token : "", ctxOf(req));
      } catch (e) {
        if (form && e instanceof OperatorAuthError) return void emailChangePage(res, e.status, "No se ha podido confirmar", e.message);
        throw e;
      }
      if (form) return void emailChangePage(res, 200, "Correo confirmado", "El nuevo correo ya es el de acceso de tu cuenta. Hemos enviado un aviso al correo anterior y al nuevo.");
      res.setHeader("Cache-Control", "no-store");
      res.json({ ok: true });
    }),
  );
  return r;
}

const escapeHtml = (v: string) => v.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Página mínima y autónoma (sin scripts) de la confirmación del correo nuevo. */
function emailChangePage(res: Response, status: number, title: string, text: string, token?: string) {
  const form = token
    ? `<form method="post" action="confirm"><input type="hidden" name="token" value="${escapeHtml(token)}"><button type="submit">Confirmar el nuevo correo</button></form>`
    : "";
  res
    .status(status)
    .set({
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      // El token va en la URL: que no salga en el Referer hacia otros sitios ni la página se pueda incrustar.
      // `same-origin` y no `no-referrer`: con este, el navegador enviaría «Origin: null» al confirmar y se rechazaría.
      "Referrer-Policy": "same-origin",
      "X-Frame-Options": "DENY",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
    })
    .send(
      `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${escapeHtml(title)}</title>` +
        `<style>body{font-family:system-ui,sans-serif;background:#f5f5f4;color:#1c1917;margin:0;padding:48px 16px}main{max-width:480px;margin:0 auto;background:#fff;border-radius:12px;padding:32px;box-shadow:0 1px 3px rgba(0,0,0,.1)}h1{font-size:22px;margin:0 0 12px}p{line-height:1.5}button{background:#1c1917;color:#fff;border:0;border-radius:8px;padding:12px 20px;font-size:16px;cursor:pointer}</style></head>` +
        `<body><main><h1>${escapeHtml(title)}</h1><p>${escapeHtml(text)}</p>${form}</main></body></html>`,
    );
}

/** Rutas con sesión de operador: se montan DESPUÉS de la autenticación. */
export function createOperatorRouter(cfg: OperatorRoutesConfig): Router {
  const r = express.Router();
  const svc = cfg.service;
  const idParam = (req: Request) => z.coerce.number().int().positive().parse(req.params.id);
  // Alta y baja del MFA: pocos intentos por operador (además del bloqueo de la cuenta por códigos erróneos)
  const mfaLimiter = rateLimit({
    windowMs: cfg.loginWindowMs ?? 15 * 60_000,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => `op:${getAuth(req)?.operator?.operator.id ?? "?"}`,
    handler: (_req, res) => void res.status(429).json({ error: "too_many_attempts", message: "Demasiados intentos. Espera unos minutos." }),
  });

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

  // ── Segundo factor del propio operador (también con una sesión que solo puede darlo de alta) ──
  r.get(
    "/auth/mfa",
    requireOperatorSession(),
    handle(async (req, res) => {
      res.setHeader("Cache-Control", "no-store");
      res.json(await svc.mfaStatus(acting(req).id));
    }),
  );

  r.post(
    "/auth/mfa/setup",
    requireOperatorSession(),
    handle(async (req, res) => {
      res.setHeader("Cache-Control", "no-store");
      res.json(await svc.setupMfa(acting(req), ctxOf(req)));
    }),
  );

  r.post(
    "/auth/mfa/enable",
    requireOperatorSession(),
    mfaLimiter,
    handle(async (req, res) => {
      const b = z.object({ code: z.string().max(32) }).parse(req.body);
      res.setHeader("Cache-Control", "no-store");
      res.json(await svc.enableMfa(acting(req), b.code, ctxOf(req)));
    }),
  );

  r.post(
    "/auth/mfa/disable",
    requireOperatorSession(),
    mfaLimiter,
    handle(async (req, res) => {
      const b = z.object({ code: z.string().max(32) }).parse(req.body);
      await svc.disableMfa(acting(req), b.code, ctxOf(req));
      res.json({ ok: true });
    }),
  );

  // ── Gestión de operadores ──────────────────────────────────────────────────
  r.use("/operators", requireOperatorSession());

  r.post(
    "/operators/:id/mfa/reset",
    requireScope("operators:write"),
    handle(async (req, res) => {
      await svc.resetMfa(acting(req), idParam(req), ctxOf(req));
      res.json({ ok: true });
    }),
  );

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
