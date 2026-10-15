/**
 * Autenticación de operadores humanos del plano de control (usuario y contraseña).
 *
 *  - Contraseñas con Argon2id (parámetros OWASP: 19 MiB, 2 iteraciones, 1 hilo).
 *  - Sesiones persistentes en BD: el navegador guarda un token aleatorio de 256 bits en una
 *    cookie HttpOnly; en la BD solo está su SHA-256. Caducan por inactividad y por tiempo total,
 *    y se pueden revocar.
 *  - CSRF: token aleatorio por sesión que el cliente envía en `X-CSRF-Token` en cada escritura.
 *  - Fuerza bruta: bloqueo temporal tras N fallos seguidos (persistente); también para usuarios
 *    inexistentes (en memoria), para no revelar qué cuentas existen.
 *  - Auditoría de accesos y de toda operación sensible sobre operadores.
 *
 * Separado de los tokens de servicio (máquina a máquina), que no cambian.
 */
import crypto from "node:crypto";
import { hash as argon2Hash, verify as argon2Verify } from "@node-rs/argon2";
import { ROLE_LABEL, ROLE_SCOPES, canManageRole, isRole, type OperatorRole } from "./operatorRoles";
import { DuplicateOperatorError, LastSuperadminError, type OperatorRecord, type OperatorStatus, type OperatorStore, type SessionRecord } from "./operatorStore";
import type { Scope } from "./auth";

export { SESSION_COOKIE } from "./auth";

export type OperatorErrorCode =
  | "invalid_credentials"
  | "account_locked"
  | "account_disabled"
  | "weak_password"
  | "invalid_input"
  | "not_found"
  | "forbidden"
  | "conflict"
  | "last_superadmin"
  | "invalid_reset_token"
  | "reset_unavailable"
  | "already_initialized";

const STATUS: Record<OperatorErrorCode, number> = {
  invalid_credentials: 401,
  account_locked: 429,
  account_disabled: 403,
  weak_password: 400,
  invalid_input: 400,
  not_found: 404,
  forbidden: 403,
  conflict: 409,
  last_superadmin: 409,
  invalid_reset_token: 400,
  reset_unavailable: 501,
  already_initialized: 409,
};

export class OperatorAuthError extends Error {
  readonly status: number;
  constructor(
    public readonly code: OperatorErrorCode,
    message: string,
    public readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.status = STATUS[code];
  }
}

/** Envío de enlaces de restablecimiento. Sin proveedor configurado no se simula ningún envío. */
export interface ResetMailer {
  sendPasswordReset(to: string, link: string): Promise<void>;
}

export interface OperatorAuthOptions {
  now?: () => number;
  /** Inactividad máxima de una sesión (por defecto 2 h). */
  idleMs?: number;
  /** Duración máxima de una sesión (por defecto 12 h). */
  maxMs?: number;
  /** Fallos seguidos antes del bloqueo (por defecto 5) y duración del bloqueo (15 min). */
  lockThreshold?: number;
  lockMs?: number;
  /** Validez del enlace de restablecimiento (por defecto 30 min). */
  resetTtlMs?: number;
  mailer?: ResetMailer;
  /** URL del CRM a la que apunta el enlace de restablecimiento (se le añade el token). */
  resetUrl?: string;
}

export interface RequestContext {
  ip?: string | null;
  userAgent?: string | null;
}

/** Operador que actúa (para comprobar permisos y auditar). */
export interface ActingOperator {
  id: number;
  username: string;
  role: OperatorRole;
  sessionId?: string;
}

export interface PublicOperator {
  id: number;
  username: string;
  email: string | null;
  displayName: string;
  role: OperatorRole;
  roleLabel: string;
  status: OperatorStatus;
  locked: boolean;
  lastLoginAt: number | null;
  passwordChangedAt: number;
  createdAt: number;
  createdBy: string;
}

export interface ValidSession {
  operator: OperatorRecord;
  session: SessionRecord;
  scopes: readonly Scope[];
}

const ARGON2 = { memoryCost: 19_456, timeCost: 2, parallelism: 1, algorithm: 2 /* Argon2id */ } as const;
const sha256 = (v: string) => crypto.createHash("sha256").update(v).digest("hex");
const randomToken = () => crypto.randomBytes(32).toString("base64url");
const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,63}$/;
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/;
// Contraseñas demasiado comunes (la longitud mínima ya descarta la mayoría)
const COMMON = ["password", "contraseña", "contrasena", "123456789012", "qwertyuiopas", "administrador", "elephant", "bigelephant"];

export function passwordProblem(password: string, username: string): string | null {
  if (typeof password !== "string" || password.length < 12) return "La contraseña debe tener al menos 12 caracteres.";
  if (password.length > 256) return "La contraseña no puede superar 256 caracteres.";
  if (/^(.)\1+$/.test(password)) return "La contraseña no puede repetir un único carácter.";
  const lower = password.toLowerCase();
  if (username && username.length >= 4 && lower.includes(username.toLowerCase())) return "La contraseña no puede contener el nombre de usuario.";
  if (COMMON.some((c) => lower.includes(c))) return "La contraseña es demasiado común.";
  if (new Set(password).size < 6) return "La contraseña tiene muy poca variedad de caracteres.";
  return null;
}

/** Contraseña aleatoria fuerte (≈ 128 bits), legible y sin caracteres ambiguos. */
export function generatePassword(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = crypto.randomBytes(24);
  const chars = Array.from(bytes, (b) => alphabet[b % alphabet.length]);
  return [0, 6, 12, 18].map((i) => chars.slice(i, i + 6).join("")).join("-");
}

export function publicOperator(o: OperatorRecord, now: number): PublicOperator {
  return {
    id: o.id,
    username: o.username,
    email: o.email,
    displayName: o.displayName,
    role: o.role,
    roleLabel: ROLE_LABEL[o.role],
    status: o.status,
    locked: o.lockedUntil !== null && o.lockedUntil > now,
    lastLoginAt: o.lastLoginAt,
    passwordChangedAt: o.passwordChangedAt,
    createdAt: o.createdAt,
    createdBy: o.createdBy,
  };
}

export class OperatorAuthService {
  readonly idleMs: number;
  readonly maxMs: number;
  private readonly now: () => number;
  private readonly lockThreshold: number;
  private readonly lockMs: number;
  private readonly resetTtlMs: number;
  /** Fallos para usuarios inexistentes (no se persisten: no hay cuenta a la que asociarlos). */
  private unknownFailures = new Map<string, { count: number; lockedUntil: number }>();
  private dummyHash: Promise<string>;

  constructor(
    private store: OperatorStore,
    private opts: OperatorAuthOptions = {},
  ) {
    this.now = opts.now ?? Date.now;
    this.idleMs = opts.idleMs ?? 2 * 3600_000;
    this.maxMs = opts.maxMs ?? 12 * 3600_000;
    this.lockThreshold = opts.lockThreshold ?? 5;
    this.lockMs = opts.lockMs ?? 15 * 60_000;
    this.resetTtlMs = opts.resetTtlMs ?? 30 * 60_000;
    // Hash de referencia: un usuario inexistente cuesta lo mismo que uno con contraseña errónea
    this.dummyHash = argon2Hash(randomToken(), ARGON2);
  }

  get resetAvailable(): boolean {
    return !!this.opts.mailer && !!this.opts.resetUrl;
  }

  hashPassword(password: string): Promise<string> {
    return argon2Hash(password, ARGON2);
  }

  private async audit(kind: string, op: { id: number | null; username: string | null }, actor: string, ctx: RequestContext = {}, details: Record<string, unknown> | null = null) {
    await this.store.addEvent({
      at: this.now(),
      operatorId: op.id,
      username: op.username ? op.username.slice(0, 64) : null,
      actor: actor.slice(0, 100),
      kind,
      ip: ctx.ip ? ctx.ip.slice(0, 45) : null,
      userAgent: ctx.userAgent ? ctx.userAgent.slice(0, 255) : null,
      details,
    });
  }

  // ── Inicio y cierre de sesión ──────────────────────────────────────────────

  async login(login: string, password: string, ctx: RequestContext = {}): Promise<{ token: string; session: SessionRecord; operator: OperatorRecord }> {
    const now = this.now();
    const key = String(login ?? "").trim().toLowerCase().slice(0, 254);
    if (!key || typeof password !== "string" || password.length === 0 || password.length > 256) {
      throw new OperatorAuthError("invalid_credentials", "Usuario o contraseña incorrectos.");
    }
    const op = await this.store.findByLogin(key);
    if (!op) {
      await argon2Verify(await this.dummyHash, password).catch(() => false);
      const f = this.unknownFailures.get(key) ?? { count: 0, lockedUntil: 0 };
      if (f.lockedUntil > now) {
        await this.audit("login_locked", { id: null, username: key }, `anon`, ctx);
        throw this.lockedError(f.lockedUntil - now);
      }
      f.count++;
      if (f.count >= this.lockThreshold) Object.assign(f, { count: 0, lockedUntil: now + this.lockMs });
      if (this.unknownFailures.size > 10_000) this.unknownFailures.clear();
      this.unknownFailures.set(key, f);
      await this.audit("login_failed", { id: null, username: key }, "anon", ctx, { reason: "unknown_user" });
      throw new OperatorAuthError("invalid_credentials", "Usuario o contraseña incorrectos.");
    }
    if (op.lockedUntil !== null && op.lockedUntil > now) {
      await this.audit("login_locked", { id: op.id, username: op.username }, "anon", ctx);
      throw this.lockedError(op.lockedUntil - now);
    }
    const ok = await argon2Verify(op.passwordHash, password).catch(() => false);
    if (!ok) {
      const failed = op.failedAttempts + 1;
      const lock = failed >= this.lockThreshold;
      await this.store.update(op.id, { failedAttempts: lock ? 0 : failed, lockedUntil: lock ? now + this.lockMs : op.lockedUntil });
      await this.audit(lock ? "account_locked" : "login_failed", { id: op.id, username: op.username }, "anon", ctx, { reason: "bad_password", attempts: failed });
      throw new OperatorAuthError("invalid_credentials", "Usuario o contraseña incorrectos.");
    }
    // Solo se informa de la desactivación a quien conoce la contraseña
    if (op.status !== "active") {
      await this.audit("login_failed", { id: op.id, username: op.username }, "anon", ctx, { reason: "disabled" });
      throw new OperatorAuthError("account_disabled", "La cuenta está desactivada. Contacta con un administrador.");
    }
    await this.store.update(op.id, { failedAttempts: 0, lockedUntil: null, lastLoginAt: now });
    const { token, session } = await this.createSession(op.id, ctx);
    await this.audit("login_success", { id: op.id, username: op.username }, `operator:${op.username}`, ctx, { session: session.id.slice(0, 12) });
    return { token, session, operator: { ...op, failedAttempts: 0, lockedUntil: null, lastLoginAt: now } };
  }

  private lockedError(remainingMs: number) {
    const minutes = Math.max(1, Math.ceil(remainingMs / 60_000));
    return new OperatorAuthError("account_locked", `Demasiados intentos fallidos. Vuelve a intentarlo dentro de ${minutes} min.`, Math.ceil(remainingMs / 1000));
  }

  private async createSession(operatorId: number, ctx: RequestContext) {
    const now = this.now();
    const token = randomToken();
    const session: SessionRecord = {
      id: sha256(token),
      operatorId,
      csrfToken: randomToken(),
      createdAt: now,
      lastSeenAt: now,
      expiresAt: now + this.maxMs,
      revokedAt: null,
      revokedReason: null,
      ip: ctx.ip ? ctx.ip.slice(0, 45) : null,
      userAgent: ctx.userAgent ? ctx.userAgent.slice(0, 255) : null,
    };
    await this.store.insertSession(session);
    return { token, session };
  }

  /** Valida el token de la cookie. `null` si no existe, está revocada, caducada o la cuenta no está activa. */
  async validateSession(token: string): Promise<ValidSession | null> {
    if (typeof token !== "string" || token.length < 20 || token.length > 128) return null;
    const session = await this.store.getSession(sha256(token));
    const now = this.now();
    if (!session || session.revokedAt !== null || session.expiresAt <= now) return null;
    if (now - session.lastSeenAt > this.idleMs) {
      await this.store.revokeSession(session.id, now, "idle_timeout");
      return null;
    }
    const operator = await this.store.get(session.operatorId);
    if (!operator || operator.status !== "active") return null;
    // Se actualiza como mucho una vez por minuto (no una escritura por petición)
    if (now - session.lastSeenAt > 60_000) await this.store.touchSession(session.id, now);
    return { operator, session, scopes: ROLE_SCOPES[operator.role] };
  }

  async logout(session: SessionRecord, operator: OperatorRecord, ctx: RequestContext = {}) {
    await this.store.revokeSession(session.id, this.now(), "logout");
    await this.audit("logout", { id: operator.id, username: operator.username }, `operator:${operator.username}`, ctx);
  }

  // ── Contraseñas ────────────────────────────────────────────────────────────

  async changeOwnPassword(actor: ActingOperator, current: string, next: string, ctx: RequestContext = {}) {
    const op = await this.store.get(actor.id);
    if (!op) throw new OperatorAuthError("not_found", "Operador no encontrado.");
    if (!(await argon2Verify(op.passwordHash, String(current ?? "")).catch(() => false))) {
      await this.audit("password_change_failed", { id: op.id, username: op.username }, `operator:${op.username}`, ctx);
      throw new OperatorAuthError("invalid_credentials", "La contraseña actual no es correcta.");
    }
    await this.setPasswordInternal(op, next, `operator:${op.username}`, ctx, "password_changed", actor.sessionId);
  }

  private async setPasswordInternal(op: OperatorRecord, next: string, actor: string, ctx: RequestContext, kind: string, keepSessionId?: string) {
    const problem = passwordProblem(next, op.username);
    if (problem) throw new OperatorAuthError("weak_password", problem);
    const now = this.now();
    await this.store.update(op.id, { passwordHash: await this.hashPassword(next), passwordChangedAt: now, failedAttempts: 0, lockedUntil: null, updatedAt: now });
    // El cambio de contraseña cierra el resto de sesiones del operador
    const revoked = await this.store.revokeOperatorSessions(op.id, now, "password_changed", keepSessionId);
    await this.audit(kind, { id: op.id, username: op.username }, actor, ctx, { revokedSessions: revoked });
  }

  /** Solicitud de restablecimiento. Siempre responde igual exista o no la cuenta. */
  async requestReset(login: string, ctx: RequestContext = {}) {
    if (!this.resetAvailable) {
      throw new OperatorAuthError("reset_unavailable", "La recuperación por correo no está configurada en este entorno. Pide a un administrador que restablezca tu contraseña.");
    }
    const op = await this.store.findByLogin(String(login ?? "").trim().toLowerCase());
    if (!op || op.status !== "active" || !op.email) {
      await this.audit("password_reset_requested", { id: op?.id ?? null, username: String(login ?? "").slice(0, 64) }, "anon", ctx, { sent: false });
      return;
    }
    const token = randomToken();
    const now = this.now();
    await this.store.insertReset({ tokenHash: sha256(token), operatorId: op.id, createdAt: now, expiresAt: now + this.resetTtlMs, usedAt: null });
    const sep = this.opts.resetUrl!.includes("?") ? "&" : "?";
    await this.opts.mailer!.sendPasswordReset(op.email, `${this.opts.resetUrl}${sep}token=${encodeURIComponent(token)}`);
    await this.audit("password_reset_requested", { id: op.id, username: op.username }, "anon", ctx, { sent: true });
  }

  /** Restablece con un enlace de un solo uso; cierra todas las sesiones del operador. */
  async confirmReset(token: string, next: string, ctx: RequestContext = {}) {
    const invalid = new OperatorAuthError("invalid_reset_token", "El enlace de restablecimiento no es válido o ha caducado.");
    if (typeof token !== "string" || token.length < 20 || token.length > 128) throw invalid;
    const h = sha256(token);
    const r = await this.store.getReset(h);
    const now = this.now();
    if (!r || r.usedAt !== null || r.expiresAt <= now) throw invalid;
    const op = await this.store.get(r.operatorId);
    if (!op || op.status !== "active") throw invalid;
    const problem = passwordProblem(next, op.username);
    if (problem) throw new OperatorAuthError("weak_password", problem);
    if (!(await this.store.useReset(h, now))) throw invalid;
    await this.setPasswordInternal(op, next, `operator:${op.username}`, ctx, "password_reset_completed");
  }

  // ── Gestión de operadores (sesión de operador con operators:write) ─────────

  async list(): Promise<PublicOperator[]> {
    const now = this.now();
    return (await this.store.list()).map((o) => publicOperator(o, now));
  }

  async get(id: number): Promise<OperatorRecord> {
    const o = await this.store.get(id);
    if (!o) throw new OperatorAuthError("not_found", "Operador no encontrado.");
    return o;
  }

  private normalizeInput(input: { username?: unknown; email?: unknown; displayName?: unknown }) {
    const out: { username?: string; email?: string | null; displayName?: string } = {};
    if (input.username !== undefined) {
      const u = String(input.username).trim().toLowerCase();
      if (!USERNAME_RE.test(u)) throw new OperatorAuthError("invalid_input", "El usuario debe tener 3–64 caracteres: letras minúsculas, números, punto, guion o guion bajo.");
      out.username = u;
    }
    if (input.email !== undefined) {
      const e = input.email === null || input.email === "" ? null : String(input.email).trim().toLowerCase();
      if (e !== null && (!EMAIL_RE.test(e) || e.length > 254)) throw new OperatorAuthError("invalid_input", "El correo no es válido.");
      out.email = e;
    }
    if (input.displayName !== undefined) {
      const n = String(input.displayName).trim();
      if (n.length < 2 || n.length > 120) throw new OperatorAuthError("invalid_input", "El nombre debe tener entre 2 y 120 caracteres.");
      out.displayName = n;
    }
    return out;
  }

  async create(actor: ActingOperator, input: { username: unknown; email?: unknown; displayName: unknown; role: unknown; password: unknown }, ctx: RequestContext = {}) {
    if (!isRole(input.role)) throw new OperatorAuthError("invalid_input", "Rol no válido.");
    if (!canManageRole(actor.role, input.role)) throw new OperatorAuthError("forbidden", "No puedes crear operadores con ese rol.");
    const n = this.normalizeInput({ username: input.username, email: input.email ?? null, displayName: input.displayName });
    const problem = passwordProblem(String(input.password ?? ""), n.username!);
    if (problem) throw new OperatorAuthError("weak_password", problem);
    const now = this.now();
    try {
      const id = await this.store.insert({
        username: n.username!,
        email: n.email ?? null,
        displayName: n.displayName!,
        role: input.role,
        status: "active",
        passwordHash: await this.hashPassword(String(input.password)),
        failedAttempts: 0,
        lockedUntil: null,
        passwordChangedAt: now,
        lastLoginAt: null,
        createdAt: now,
        updatedAt: now,
        createdBy: `operator:${actor.username}`,
      });
      await this.audit("operator_created", { id, username: n.username! }, `operator:${actor.username}`, ctx, { role: input.role });
      return publicOperator(await this.get(id), now);
    } catch (e) {
      if (e instanceof DuplicateOperatorError) throw new OperatorAuthError("conflict", e.field === "email" ? "Ya existe un operador con ese correo." : "Ya existe un operador con ese usuario.");
      throw e;
    }
  }

  async update(actor: ActingOperator, id: number, patch: { email?: unknown; displayName?: unknown; role?: unknown; status?: unknown }, ctx: RequestContext = {}) {
    const target = await this.get(id);
    const self = target.id === actor.id;
    const changesAccess = patch.role !== undefined || patch.status !== undefined;
    if (self && changesAccess) throw new OperatorAuthError("forbidden", "No puedes cambiar tu propio rol ni desactivar tu propia cuenta.");
    if (!self && !canManageRole(actor.role, target.role)) throw new OperatorAuthError("forbidden", "No puedes gestionar a este operador.");
    const n = this.normalizeInput({ email: patch.email, displayName: patch.displayName });
    const next: Parameters<OperatorStore["update"]>[1] = { ...n, updatedAt: this.now() };
    if (patch.role !== undefined) {
      if (!isRole(patch.role)) throw new OperatorAuthError("invalid_input", "Rol no válido.");
      if (!canManageRole(actor.role, patch.role)) throw new OperatorAuthError("forbidden", "No puedes asignar ese rol.");
      next.role = patch.role;
    }
    if (patch.status !== undefined) {
      if (patch.status !== "active" && patch.status !== "disabled") throw new OperatorAuthError("invalid_input", "Estado no válido.");
      next.status = patch.status;
      if (patch.status === "active") Object.assign(next, { failedAttempts: 0, lockedUntil: null });
    }
    const losesSuperadmin = target.role === "superadmin" && target.status === "active" && ((next.role && next.role !== "superadmin") || next.status === "disabled");
    try {
      await this.store.update(id, next, { keepSuperadmin: losesSuperadmin });
    } catch (e) {
      if (e instanceof LastSuperadminError) throw new OperatorAuthError("last_superadmin", "Debe quedar al menos un superadministrador activo.");
      if (e instanceof DuplicateOperatorError) throw new OperatorAuthError("conflict", "Ya existe un operador con ese correo.");
      throw e;
    }
    const now = this.now();
    if (next.status === "disabled") await this.store.revokeOperatorSessions(id, now, "disabled");
    const changed = Object.fromEntries(Object.entries(next).filter(([k]) => k !== "updatedAt" && k !== "failedAttempts" && k !== "lockedUntil"));
    const kind = next.role && next.role !== target.role ? "role_changed" : next.status && next.status !== target.status ? "status_changed" : "operator_updated";
    await this.audit(kind, { id, username: target.username }, `operator:${actor.username}`, ctx, { from: { role: target.role, status: target.status }, changes: changed });
    return publicOperator(await this.get(id), now);
  }

  /** Contraseña nueva fijada por un administrador; cierra todas las sesiones del operador. */
  async setPassword(actor: ActingOperator, id: number, password: unknown, ctx: RequestContext = {}) {
    const target = await this.get(id);
    if (target.id === actor.id) throw new OperatorAuthError("forbidden", "Para cambiar tu propia contraseña usa «Cambiar contraseña» (pide la actual).");
    if (!canManageRole(actor.role, target.role)) throw new OperatorAuthError("forbidden", "No puedes gestionar a este operador.");
    await this.setPasswordInternal(target, String(password ?? ""), `operator:${actor.username}`, ctx, "password_set_by_admin");
  }

  async revokeSessions(actor: ActingOperator, id: number, ctx: RequestContext = {}) {
    const target = await this.get(id);
    if (target.id !== actor.id && !canManageRole(actor.role, target.role)) throw new OperatorAuthError("forbidden", "No puedes gestionar a este operador.");
    // Si son las propias, se conserva la sesión actual
    const n = await this.store.revokeOperatorSessions(id, this.now(), "revoked", target.id === actor.id ? actor.sessionId : undefined);
    await this.audit("sessions_revoked", { id, username: target.username }, `operator:${actor.username}`, ctx, { count: n });
    return n;
  }

  async sessions(id: number) {
    const now = this.now();
    return (await this.store.listSessions(id, now)).map((s) => ({
      id: s.id.slice(0, 12),
      createdAt: s.createdAt,
      lastSeenAt: s.lastSeenAt,
      expiresAt: Math.min(s.expiresAt, s.lastSeenAt + this.idleMs),
      ip: s.ip,
      userAgent: s.userAgent,
    }));
  }

  events(operatorId: number | undefined, limit = 100) {
    return this.store.listEvents({ operatorId, limit: Math.min(Math.max(limit, 1), 500) });
  }

  // ── Herramienta administrativa del servidor (scripts/cp-operators.ts) ──────

  /** Crea el primer superadministrador. Solo si todavía no hay ningún operador. */
  async bootstrap(input: { username: string; displayName: string; email?: string | null; password: string }) {
    if ((await this.store.countOperators()) > 0) throw new OperatorAuthError("already_initialized", "Ya existen operadores: usa la gestión de operadores o reset-password.");
    const n = this.normalizeInput({ username: input.username, displayName: input.displayName, email: input.email ?? null });
    const problem = passwordProblem(input.password, n.username!);
    if (problem) throw new OperatorAuthError("weak_password", problem);
    const now = this.now();
    const id = await this.store.insert({
      username: n.username!,
      email: n.email ?? null,
      displayName: n.displayName!,
      role: "superadmin",
      status: "active",
      passwordHash: await this.hashPassword(input.password),
      failedAttempts: 0,
      lockedUntil: null,
      passwordChangedAt: now,
      lastLoginAt: null,
      createdAt: now,
      updatedAt: now,
      createdBy: "system:cli",
    });
    await this.audit("operator_created", { id, username: n.username! }, "system:cli", {}, { role: "superadmin", bootstrap: true });
    return id;
  }

  /** Restablecimiento desde el servidor (quien lo ejecuta tiene acceso a la BD del registro). */
  async adminResetFromServer(username: string, password: string) {
    const op = await this.store.findByLogin(username);
    if (!op) throw new OperatorAuthError("not_found", "Operador no encontrado.");
    await this.setPasswordInternal(op, password, "system:cli", {}, "password_reset_by_server");
  }
}
