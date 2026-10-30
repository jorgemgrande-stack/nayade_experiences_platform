/**
 * Persistencia de operadores, sesiones, restablecimientos y auditoría (BD del registro,
 * migración db/registry/0007_operators.sql). Nunca se guardan contraseñas ni tokens en claro:
 * solo el hash Argon2id de la contraseña y el SHA-256 de los tokens de sesión y restablecimiento.
 */
import type mysql from "mysql2/promise";
import type { OperatorRole } from "./operatorRoles";

export type OperatorStatus = "active" | "disabled";

export interface OperatorRecord {
  id: number;
  username: string;
  email: string | null;
  displayName: string;
  role: OperatorRole;
  status: OperatorStatus;
  passwordHash: string;
  failedAttempts: number;
  lockedUntil: number | null;
  passwordChangedAt: number;
  lastLoginAt: number | null;
  createdAt: number;
  updatedAt: number;
  createdBy: string;
  /** Segundo factor (TOTP): secreto cifrado con el llavero del registro y su clave; null sin alta. */
  mfaSecretCipher?: string | null;
  mfaKeyId?: string | null;
  /** Cuándo se confirmó el alta; null = sin MFA (o alta sin confirmar). */
  mfaEnabledAt?: number | null;
  /** Último paso TOTP aceptado: un código no se puede reutilizar. */
  mfaLastStep?: number | null;
}

/** `none`: sesión normal · `pending`: falta el código · `setup`: su rol exige MFA y aún no lo tiene. */
export type SessionMfaState = "none" | "pending" | "setup";

export interface SessionRecord {
  /** SHA-256 hex del token de sesión (el token solo lo conoce el navegador, en una cookie HttpOnly). */
  id: string;
  operatorId: number;
  csrfToken: string;
  createdAt: number;
  lastSeenAt: number;
  expiresAt: number;
  revokedAt: number | null;
  revokedReason: string | null;
  ip: string | null;
  userAgent: string | null;
  mfaState?: SessionMfaState;
}

export interface ResetRecord {
  tokenHash: string;
  operatorId: number;
  createdAt: number;
  expiresAt: number;
  usedAt: number | null;
}

/** Cambio de correo pendiente de confirmar desde el correo nuevo (migración 0015; solo el SHA-256 del enlace). */
export interface EmailChangeRecord {
  tokenHash: string;
  operatorId: number;
  /** Correo vigente al pedirlo: si cambia antes de confirmar, el enlace deja de valer. */
  oldEmail: string | null;
  newEmail: string;
  requestedBy: string;
  createdAt: number;
  expiresAt: number;
  usedAt: number | null;
}

export interface OperatorEvent {
  id: number;
  at: number;
  operatorId: number | null;
  username: string | null;
  actor: string;
  kind: string;
  ip: string | null;
  userAgent: string | null;
  details: Record<string, unknown> | null;
}

export type OperatorPatch = Partial<
  Pick<
    OperatorRecord,
    | "email"
    | "displayName"
    | "role"
    | "status"
    | "passwordHash"
    | "failedAttempts"
    | "lockedUntil"
    | "passwordChangedAt"
    | "lastLoginAt"
    | "updatedAt"
    | "mfaSecretCipher"
    | "mfaKeyId"
    | "mfaEnabledAt"
    | "mfaLastStep"
  >
>;

/** Error del almacén cuando el cambio dejaría la instalación sin superadministradores activos. */
export class LastSuperadminError extends Error {
  constructor() {
    super("last_superadmin");
  }
}
/** Usuario o correo ya existentes. */
export class DuplicateOperatorError extends Error {
  constructor(public readonly field: "username" | "email") {
    super("duplicate");
  }
}

export interface OperatorStore {
  countOperators(): Promise<number>;
  findByLogin(login: string): Promise<OperatorRecord | null>;
  get(id: number): Promise<OperatorRecord | null>;
  list(): Promise<OperatorRecord[]>;
  insert(rec: Omit<OperatorRecord, "id">): Promise<number>;
  /**
   * Aplica el cambio. Con `keepSuperadmin`, falla con LastSuperadminError si después no quedaría
   * ningún superadministrador activo (comprobación atómica en la misma transacción).
   */
  update(id: number, patch: OperatorPatch, opts?: { keepSuperadmin?: boolean }): Promise<void>;

  insertSession(s: SessionRecord): Promise<void>;
  getSession(id: string): Promise<SessionRecord | null>;
  touchSession(id: string, at: number): Promise<void>;
  revokeSession(id: string, at: number, reason: string): Promise<void>;
  /** Revoca las sesiones vivas de un operador (salvo `exceptId`) y devuelve cuántas. */
  revokeOperatorSessions(operatorId: number, at: number, reason: string, exceptId?: string): Promise<number>;
  listSessions(operatorId: number, now: number): Promise<SessionRecord[]>;

  insertReset(r: ResetRecord): Promise<void>;
  getReset(tokenHash: string): Promise<ResetRecord | null>;
  /** Marca el enlace como usado; `false` si ya lo estaba (un solo uso, también ante carreras). */
  useReset(tokenHash: string, at: number): Promise<boolean>;

  /**
   * User-agents de las sesiones del operador abiertas desde `since` (revocadas o caducadas incluidas), salvo
   * `exceptId` y salvo las que se quedaron a la espera del segundo factor (solo prueban la contraseña).
   */
  recentSessionAgents(operatorId: number, since: number, exceptId: string): Promise<string[]>;

  /** El almacén guarda cambios de correo pendientes (en MySQL, con la migración 0015 aplicada). */
  readonly emailChangeSupported: boolean;
  insertEmailChange(r: EmailChangeRecord): Promise<void>;
  getEmailChange(tokenHash: string): Promise<EmailChangeRecord | null>;
  /** Marca el enlace como usado; `false` si ya lo estaba (un solo uso, también ante carreras). */
  useEmailChange(tokenHash: string, at: number): Promise<boolean>;
  /** Anula los cambios de correo pendientes del operador (al pedir otro): solo vale el último enlace. */
  cancelEmailChanges(operatorId: number, at: number): Promise<void>;

  addEvent(e: Omit<OperatorEvent, "id">): Promise<void>;
  listEvents(q: { operatorId?: number; limit: number }): Promise<OperatorEvent[]>;

  /**
   * Registra un intento fallido de forma ATÓMICA (una sola sentencia condicional, sin leer-modificar-
   * escribir): suma 1 y, al llegar a `threshold`, bloquea hasta `lockUntil` y reinicia el contador. Si la
   * cuenta ya está bloqueada (`locked_until > now`) no cuenta nada y devuelve `alreadyLocked`.
   */
  registerFailure(id: number, now: number, threshold: number, lockUntil: number): Promise<{ alreadyLocked: boolean; locked: boolean }>;
  /**
   * Consume un paso TOTP de forma ATÓMICA: solo si es posterior al último aceptado. `false` si ya se usó
   * (también ante dos verificaciones simultáneas con el mismo código).
   */
  consumeTotpStep(id: number, step: number): Promise<boolean>;

  /** El almacén guarda el segundo factor (en MySQL, con la migración 0012 aplicada). */
  readonly mfaSupported: boolean;
  /** Cambia el estado MFA y la caducidad de una sesión viva. */
  updateSession(id: string, patch: { mfaState: SessionMfaState; expiresAt: number; lastSeenAt: number }): Promise<void>;
  /** Sustituye los códigos de recuperación del operador (SHA-256); con `[]` los elimina. */
  replaceRecoveryCodes(operatorId: number, hashes: string[], at: number): Promise<void>;
  /** Consume un código; `false` si no existe, es de otro operador o ya se usó (también ante carreras). */
  useRecoveryCode(operatorId: number, hash: string, at: number): Promise<boolean>;
  countRecoveryCodes(operatorId: number): Promise<number>;
}

// ── Memoria (pruebas) ────────────────────────────────────────────────────────

export class MemoryOperatorStore implements OperatorStore {
  operators: OperatorRecord[] = [];
  sessions = new Map<string, SessionRecord>();
  resets = new Map<string, ResetRecord>();
  events: OperatorEvent[] = [];
  private seq = 0;

  async countOperators() {
    return this.operators.length;
  }
  async findByLogin(login: string) {
    const l = login.toLowerCase();
    return clone(this.operators.find((o) => o.username === l || (o.email !== null && o.email === l)) ?? null);
  }
  async get(id: number) {
    return clone(this.operators.find((o) => o.id === id) ?? null);
  }
  async list() {
    return this.operators.map((o) => clone(o)!);
  }
  async insert(rec: Omit<OperatorRecord, "id">) {
    if (this.operators.some((o) => o.username === rec.username)) throw new DuplicateOperatorError("username");
    if (rec.email && this.operators.some((o) => o.email === rec.email)) throw new DuplicateOperatorError("email");
    const id = ++this.seq;
    this.operators.push({ ...rec, id });
    return id;
  }
  async update(id: number, patch: OperatorPatch, opts: { keepSuperadmin?: boolean } = {}) {
    const o = this.operators.find((x) => x.id === id);
    if (!o) return;
    if (patch.email && this.operators.some((x) => x.id !== id && x.email === patch.email)) throw new DuplicateOperatorError("email");
    const next = { ...o, ...patch };
    if (opts.keepSuperadmin) {
      const after = this.operators.map((x) => (x.id === id ? next : x));
      if (!after.some((x) => x.role === "superadmin" && x.status === "active")) throw new LastSuperadminError();
    }
    Object.assign(o, patch);
  }
  async insertSession(s: SessionRecord) {
    this.sessions.set(s.id, { ...s });
  }
  async getSession(id: string) {
    const s = this.sessions.get(id);
    return s ? { ...s } : null;
  }
  async touchSession(id: string, at: number) {
    const s = this.sessions.get(id);
    if (s) s.lastSeenAt = at;
  }
  async revokeSession(id: string, at: number, reason: string) {
    const s = this.sessions.get(id);
    if (s && s.revokedAt === null) Object.assign(s, { revokedAt: at, revokedReason: reason });
  }
  async revokeOperatorSessions(operatorId: number, at: number, reason: string, exceptId?: string) {
    let n = 0;
    for (const s of Array.from(this.sessions.values())) {
      if (s.operatorId === operatorId && s.revokedAt === null && s.id !== exceptId) {
        Object.assign(s, { revokedAt: at, revokedReason: reason });
        n++;
      }
    }
    return n;
  }
  async listSessions(operatorId: number, now: number) {
    return Array.from(this.sessions.values()).filter((s) => s.operatorId === operatorId && s.revokedAt === null && s.expiresAt > now).map((s) => ({ ...s }));
  }
  async insertReset(r: ResetRecord) {
    this.resets.set(r.tokenHash, { ...r });
  }
  async getReset(h: string) {
    const r = this.resets.get(h);
    return r ? { ...r } : null;
  }
  async useReset(h: string, at: number) {
    const r = this.resets.get(h);
    if (!r || r.usedAt !== null) return false;
    r.usedAt = at;
    return true;
  }
  async recentSessionAgents(operatorId: number, since: number, exceptId: string) {
    return Array.from(this.sessions.values())
      .filter((s) => s.operatorId === operatorId && s.createdAt >= since && s.id !== exceptId && s.mfaState !== "pending" && !!s.userAgent)
      .map((s) => s.userAgent!);
  }
  emailChanges = new Map<string, EmailChangeRecord>();
  emailChangeSupported = true;
  async insertEmailChange(r: EmailChangeRecord) {
    this.emailChanges.set(r.tokenHash, { ...r });
  }
  async getEmailChange(h: string) {
    const r = this.emailChanges.get(h);
    return r ? { ...r } : null;
  }
  async useEmailChange(h: string, at: number) {
    const r = this.emailChanges.get(h);
    if (!r || r.usedAt !== null) return false;
    r.usedAt = at;
    return true;
  }
  async cancelEmailChanges(operatorId: number, at: number) {
    for (const r of Array.from(this.emailChanges.values())) if (r.operatorId === operatorId && r.usedAt === null) r.usedAt = at;
  }
  async addEvent(e: Omit<OperatorEvent, "id">) {
    this.events.push({ ...e, id: this.events.length + 1 });
  }
  async listEvents(q: { operatorId?: number; limit: number }) {
    return this.events
      .filter((e) => q.operatorId === undefined || e.operatorId === q.operatorId)
      .slice()
      .reverse()
      .slice(0, q.limit);
  }

  readonly mfaSupported: boolean;
  recovery: Array<{ operatorId: number; hash: string; createdAt: number; usedAt: number | null }> = [];
  constructor(opts: { mfa?: boolean } = {}) {
    this.mfaSupported = opts.mfa ?? true;
  }
  // Sin `await` entre la lectura y la escritura: en un solo proceso de JS equivale a la sentencia atómica
  async registerFailure(id: number, now: number, threshold: number, lockUntil: number) {
    const o = this.operators.find((x) => x.id === id);
    if (!o) return { alreadyLocked: false, locked: false };
    if (o.lockedUntil !== null && o.lockedUntil > now) return { alreadyLocked: true, locked: true };
    const n = o.failedAttempts + 1;
    if (n >= threshold) Object.assign(o, { failedAttempts: 0, lockedUntil: lockUntil });
    else o.failedAttempts = n;
    return { alreadyLocked: false, locked: n >= threshold };
  }
  async consumeTotpStep(id: number, step: number) {
    const o = this.operators.find((x) => x.id === id);
    if (!o || (o.mfaLastStep !== null && o.mfaLastStep !== undefined && o.mfaLastStep >= step)) return false;
    o.mfaLastStep = step;
    return true;
  }
  async updateSession(id: string, patch: { mfaState: SessionMfaState; expiresAt: number; lastSeenAt: number }) {
    const s = this.sessions.get(id);
    if (s && s.revokedAt === null) Object.assign(s, patch);
  }
  async replaceRecoveryCodes(operatorId: number, hashes: string[], at: number) {
    this.recovery = this.recovery.filter((r) => r.operatorId !== operatorId).concat(hashes.map((hash) => ({ operatorId, hash, createdAt: at, usedAt: null })));
  }
  async useRecoveryCode(operatorId: number, hash: string, at: number) {
    const r = this.recovery.find((x) => x.operatorId === operatorId && x.hash === hash && x.usedAt === null);
    if (!r) return false;
    r.usedAt = at;
    return true;
  }
  async countRecoveryCodes(operatorId: number) {
    return this.recovery.filter((r) => r.operatorId === operatorId && r.usedAt === null).length;
  }
}

const clone = <T>(v: T): T => (v === null ? v : { ...(v as object) }) as T;

// ── MySQL ────────────────────────────────────────────────────────────────────

type Row = Record<string, any>;
const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

function toOperator(r: Row): OperatorRecord {
  return {
    id: Number(r.id),
    username: r.username,
    email: r.email ?? null,
    displayName: r.display_name,
    role: r.role,
    status: r.status,
    passwordHash: r.password_hash,
    failedAttempts: Number(r.failed_attempts),
    lockedUntil: num(r.locked_until),
    passwordChangedAt: Number(r.password_changed_at),
    lastLoginAt: num(r.last_login_at),
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
    createdBy: r.created_by,
    // Sin la migración 0012 las columnas no existen: sin MFA
    mfaSecretCipher: r.mfa_secret_cipher ?? null,
    mfaKeyId: r.mfa_key_id ?? null,
    mfaEnabledAt: num(r.mfa_enabled_at),
    mfaLastStep: num(r.mfa_last_step),
  };
}
function toSession(r: Row): SessionRecord {
  return {
    id: r.id,
    operatorId: Number(r.operator_id),
    csrfToken: r.csrf_token,
    createdAt: Number(r.created_at),
    lastSeenAt: Number(r.last_seen_at),
    expiresAt: Number(r.expires_at),
    revokedAt: num(r.revoked_at),
    revokedReason: r.revoked_reason ?? null,
    ip: r.ip ?? null,
    userAgent: r.user_agent ?? null,
    mfaState: (r.mfa_state as SessionMfaState | undefined) ?? "none",
  };
}

const COLUMN: Record<keyof OperatorPatch, string> = {
  email: "email",
  displayName: "display_name",
  role: "role",
  status: "status",
  passwordHash: "password_hash",
  failedAttempts: "failed_attempts",
  lockedUntil: "locked_until",
  passwordChangedAt: "password_changed_at",
  lastLoginAt: "last_login_at",
  updatedAt: "updated_at",
  mfaSecretCipher: "mfa_secret_cipher",
  mfaKeyId: "mfa_key_id",
  mfaEnabledAt: "mfa_enabled_at",
  mfaLastStep: "mfa_last_step",
};
const MFA_PATCH_KEYS = new Set<keyof OperatorPatch>(["mfaSecretCipher", "mfaKeyId", "mfaEnabledAt", "mfaLastStep"]);

const isDuplicate = (e: any) => e?.code === "ER_DUP_ENTRY";
const dupField = (e: any): "username" | "email" => (String(e?.message ?? "").includes("uq_operator_email") ? "email" : "username");

export class MysqlOperatorStore implements OperatorStore {
  readonly mfaSupported: boolean;
  readonly emailChangeSupported: boolean;
  /**
   * `mfa`: la migración 0012 está aplicada · `emailChanges`: la 0015 está aplicada (lo comprueba
   * operatorAuthFromEnv al arrancar).
   */
  constructor(
    private pool: mysql.Pool,
    opts: { mfa?: boolean; emailChanges?: boolean } = {},
  ) {
    this.mfaSupported = opts.mfa ?? false;
    this.emailChangeSupported = opts.emailChanges ?? false;
  }

  async countOperators() {
    const [rows] = await this.pool.query<any[]>("SELECT COUNT(*) AS n FROM cp_operators");
    return Number(rows[0].n);
  }
  async findByLogin(login: string) {
    const l = login.toLowerCase();
    const [rows] = await this.pool.query<any[]>("SELECT * FROM cp_operators WHERE username = ? OR email = ? LIMIT 1", [l, l]);
    return rows[0] ? toOperator(rows[0]) : null;
  }
  async get(id: number) {
    const [rows] = await this.pool.query<any[]>("SELECT * FROM cp_operators WHERE id = ?", [id]);
    return rows[0] ? toOperator(rows[0]) : null;
  }
  async list() {
    const [rows] = await this.pool.query<any[]>("SELECT * FROM cp_operators ORDER BY username");
    return rows.map(toOperator);
  }
  async insert(r: Omit<OperatorRecord, "id">) {
    try {
      const [res] = await this.pool.query<any>(
        `INSERT INTO cp_operators (username, email, display_name, role, status, password_hash, failed_attempts, locked_until,
           password_changed_at, last_login_at, created_at, updated_at, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [r.username, r.email, r.displayName, r.role, r.status, r.passwordHash, r.failedAttempts, r.lockedUntil, r.passwordChangedAt, r.lastLoginAt, r.createdAt, r.updatedAt, r.createdBy],
      );
      return Number(res.insertId);
    } catch (e) {
      if (isDuplicate(e)) throw new DuplicateOperatorError(dupField(e));
      throw e;
    }
  }
  async update(id: number, patch: OperatorPatch, opts: { keepSuperadmin?: boolean } = {}) {
    const keys = (Object.keys(patch) as Array<keyof OperatorPatch>).filter((k) => this.mfaSupported || !MFA_PATCH_KEYS.has(k));
    if (keys.length === 0) return;
    const conn = await this.pool.getConnection();
    try {
      await conn.beginTransaction();
      if (opts.keepSuperadmin) {
        // Bloquea los superadministradores activos: dos bajas simultáneas no pueden dejar cero
        await conn.query("SELECT id FROM cp_operators WHERE role = 'superadmin' AND status = 'active' FOR UPDATE");
      }
      await conn.query(`UPDATE cp_operators SET ${keys.map((k) => `${COLUMN[k]} = ?`).join(", ")} WHERE id = ?`, [...keys.map((k) => patch[k] ?? null), id]);
      if (opts.keepSuperadmin) {
        const [rows] = await conn.query<any[]>("SELECT COUNT(*) AS n FROM cp_operators WHERE role = 'superadmin' AND status = 'active'");
        if (Number(rows[0].n) === 0) {
          await conn.rollback();
          throw new LastSuperadminError();
        }
      }
      await conn.commit();
    } catch (e) {
      await conn.rollback().catch(() => undefined);
      if (isDuplicate(e)) throw new DuplicateOperatorError(dupField(e));
      throw e;
    } finally {
      conn.release();
    }
  }

  async insertSession(s: SessionRecord) {
    const mfa = this.mfaSupported ? ", mfa_state" : "";
    await this.pool.query(
      `INSERT INTO cp_operator_sessions (id, operator_id, csrf_token, created_at, last_seen_at, expires_at, revoked_at, revoked_reason, ip, user_agent${mfa})
       VALUES (?,?,?,?,?,?,?,?,?,?${this.mfaSupported ? ",?" : ""})`,
      [s.id, s.operatorId, s.csrfToken, s.createdAt, s.lastSeenAt, s.expiresAt, s.revokedAt, s.revokedReason, s.ip, s.userAgent, ...(this.mfaSupported ? [s.mfaState ?? "none"] : [])],
    );
  }
  async registerFailure(id: number, now: number, threshold: number, lockUntil: number) {
    // Fila bloqueada (FOR UPDATE) durante la lectura y la escritura: entre peticiones o réplicas simultáneas
    // el contador no se pierde y solo la petición que alcanza el umbral ve `locked` (una auditoría, un cierre).
    const conn = await this.pool.getConnection();
    try {
      await conn.beginTransaction();
      const [rows] = await conn.query<any[]>("SELECT failed_attempts, locked_until FROM cp_operators WHERE id = ? FOR UPDATE", [id]);
      const until = num(rows[0]?.locked_until);
      if (!rows[0] || (until !== null && until > now)) {
        await conn.commit();
        return { alreadyLocked: !!rows[0], locked: !!rows[0] };
      }
      const n = Number(rows[0].failed_attempts) + 1;
      const locked = n >= threshold;
      await conn.query("UPDATE cp_operators SET failed_attempts = ?, locked_until = ? WHERE id = ?", [locked ? 0 : n, locked ? lockUntil : until, id]);
      await conn.commit();
      return { alreadyLocked: false, locked };
    } catch (e) {
      await conn.rollback().catch(() => {});
      throw e;
    } finally {
      conn.release();
    }
  }
  async consumeTotpStep(id: number, step: number) {
    if (!this.mfaSupported) return false;
    const [res] = await this.pool.query<any>("UPDATE cp_operators SET mfa_last_step = ? WHERE id = ? AND (mfa_last_step IS NULL OR mfa_last_step < ?)", [step, id, step]);
    return Number(res.affectedRows) === 1;
  }
  async updateSession(id: string, patch: { mfaState: SessionMfaState; expiresAt: number; lastSeenAt: number }) {
    if (!this.mfaSupported) return;
    await this.pool.query("UPDATE cp_operator_sessions SET mfa_state = ?, expires_at = ?, last_seen_at = ? WHERE id = ? AND revoked_at IS NULL", [
      patch.mfaState,
      patch.expiresAt,
      patch.lastSeenAt,
      id,
    ]);
  }
  async replaceRecoveryCodes(operatorId: number, hashes: string[], at: number) {
    if (!this.mfaSupported) return;
    const conn = await this.pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query("DELETE FROM cp_operator_recovery_codes WHERE operator_id = ?", [operatorId]);
      if (hashes.length) await conn.query("INSERT INTO cp_operator_recovery_codes (operator_id, code_hash, created_at) VALUES ?", [hashes.map((h) => [operatorId, h, at])]);
      await conn.commit();
    } catch (e) {
      await conn.rollback().catch(() => undefined);
      throw e;
    } finally {
      conn.release();
    }
  }
  async useRecoveryCode(operatorId: number, hash: string, at: number) {
    if (!this.mfaSupported) return false;
    const [res] = await this.pool.query<any>("UPDATE cp_operator_recovery_codes SET used_at = ? WHERE operator_id = ? AND code_hash = ? AND used_at IS NULL", [at, operatorId, hash]);
    return Number(res.affectedRows) === 1;
  }
  async countRecoveryCodes(operatorId: number) {
    if (!this.mfaSupported) return 0;
    const [rows] = await this.pool.query<any[]>("SELECT COUNT(*) AS n FROM cp_operator_recovery_codes WHERE operator_id = ? AND used_at IS NULL", [operatorId]);
    return Number(rows[0].n);
  }
  async getSession(id: string) {
    const [rows] = await this.pool.query<any[]>("SELECT * FROM cp_operator_sessions WHERE id = ?", [id]);
    return rows[0] ? toSession(rows[0]) : null;
  }
  async touchSession(id: string, at: number) {
    await this.pool.query("UPDATE cp_operator_sessions SET last_seen_at = ? WHERE id = ? AND revoked_at IS NULL", [at, id]);
  }
  async revokeSession(id: string, at: number, reason: string) {
    await this.pool.query("UPDATE cp_operator_sessions SET revoked_at = ?, revoked_reason = ? WHERE id = ? AND revoked_at IS NULL", [at, reason, id]);
  }
  async revokeOperatorSessions(operatorId: number, at: number, reason: string, exceptId?: string) {
    const [res] = await this.pool.query<any>(
      "UPDATE cp_operator_sessions SET revoked_at = ?, revoked_reason = ? WHERE operator_id = ? AND revoked_at IS NULL AND id <> ?",
      [at, reason, operatorId, exceptId ?? ""],
    );
    return Number(res.affectedRows);
  }
  async listSessions(operatorId: number, now: number) {
    const [rows] = await this.pool.query<any[]>(
      "SELECT * FROM cp_operator_sessions WHERE operator_id = ? AND revoked_at IS NULL AND expires_at > ? ORDER BY last_seen_at DESC LIMIT 50",
      [operatorId, now],
    );
    return rows.map(toSession);
  }

  async insertReset(r: ResetRecord) {
    await this.pool.query("INSERT INTO cp_password_resets (token_hash, operator_id, created_at, expires_at, used_at) VALUES (?,?,?,?,?)", [
      r.tokenHash,
      r.operatorId,
      r.createdAt,
      r.expiresAt,
      r.usedAt,
    ]);
  }
  async getReset(h: string) {
    const [rows] = await this.pool.query<any[]>("SELECT * FROM cp_password_resets WHERE token_hash = ?", [h]);
    const r = rows[0];
    return r ? { tokenHash: r.token_hash, operatorId: Number(r.operator_id), createdAt: Number(r.created_at), expiresAt: Number(r.expires_at), usedAt: num(r.used_at) } : null;
  }
  async useReset(h: string, at: number) {
    const [res] = await this.pool.query<any>("UPDATE cp_password_resets SET used_at = ? WHERE token_hash = ? AND used_at IS NULL", [at, h]);
    return Number(res.affectedRows) === 1;
  }

  async recentSessionAgents(operatorId: number, since: number, exceptId: string) {
    const [rows] = await this.pool.query<any[]>(
      `SELECT DISTINCT user_agent FROM cp_operator_sessions
        WHERE operator_id = ? AND created_at >= ? AND id <> ? AND user_agent IS NOT NULL${this.mfaSupported ? " AND mfa_state <> 'pending'" : ""}
        LIMIT 200`,
      [operatorId, since, exceptId],
    );
    return rows.map((r) => String(r.user_agent));
  }

  async insertEmailChange(r: EmailChangeRecord) {
    await this.pool.query(
      "INSERT INTO cp_operator_email_changes (token_hash, operator_id, old_email, new_email, requested_by, created_at, expires_at, used_at) VALUES (?,?,?,?,?,?,?,?)",
      [r.tokenHash, r.operatorId, r.oldEmail, r.newEmail, r.requestedBy.slice(0, 100), r.createdAt, r.expiresAt, r.usedAt],
    );
  }
  async getEmailChange(h: string) {
    const [rows] = await this.pool.query<any[]>("SELECT * FROM cp_operator_email_changes WHERE token_hash = ?", [h]);
    const r = rows[0];
    return r
      ? { tokenHash: r.token_hash, operatorId: Number(r.operator_id), oldEmail: r.old_email ?? null, newEmail: r.new_email, requestedBy: r.requested_by, createdAt: Number(r.created_at), expiresAt: Number(r.expires_at), usedAt: num(r.used_at) }
      : null;
  }
  async useEmailChange(h: string, at: number) {
    const [res] = await this.pool.query<any>("UPDATE cp_operator_email_changes SET used_at = ? WHERE token_hash = ? AND used_at IS NULL", [at, h]);
    return Number(res.affectedRows) === 1;
  }
  async cancelEmailChanges(operatorId: number, at: number) {
    await this.pool.query("UPDATE cp_operator_email_changes SET used_at = ? WHERE operator_id = ? AND used_at IS NULL", [at, operatorId]);
  }

  async addEvent(e: Omit<OperatorEvent, "id">) {
    await this.pool.query(
      "INSERT INTO cp_operator_events (at, operator_id, username, actor, kind, ip, user_agent, details) VALUES (?,?,?,?,?,?,?,?)",
      [e.at, e.operatorId, e.username, e.actor, e.kind, e.ip, e.userAgent, e.details ? JSON.stringify(e.details) : null],
    );
  }
  async listEvents(q: { operatorId?: number; limit: number }) {
    const [rows] = await this.pool.query<any[]>(
      `SELECT * FROM cp_operator_events ${q.operatorId !== undefined ? "WHERE operator_id = ?" : ""} ORDER BY at DESC, id DESC LIMIT ?`,
      q.operatorId !== undefined ? [q.operatorId, q.limit] : [q.limit],
    );
    return rows.map((r) => ({
      id: Number(r.id),
      at: Number(r.at),
      operatorId: num(r.operator_id),
      username: r.username ?? null,
      actor: r.actor,
      kind: r.kind,
      ip: r.ip ?? null,
      userAgent: r.user_agent ?? null,
      details: r.details ? (typeof r.details === "string" ? JSON.parse(r.details) : r.details) : null,
    }));
  }
}
