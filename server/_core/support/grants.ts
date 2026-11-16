/**
 * Acceso delegado de soporte: concesiones auditadas.
 *
 *  - Una concesión (AUTORIZACIÓN) la crea un operador (plano de control) para UN tenant, con motivo y una de dos
 *    duraciones: limitada (hasta 4 h) o «hasta revocación» (sin caducidad fija; solo administración). Nace de solo
 *    lectura salvo que se pida lo contrario.
 *  - La SESIÓN del operador en el panel es otra cosa (ver ./session.ts): corta, renovable y ligada a la autorización.
 *    Revocar la autorización invalida al instante todas sus sesiones (cada petición la vuelve a leer).
 *  - El Core solo LEE las concesiones (registro, solo lectura) y valida cada petición.
 *  - Revocable en cualquier momento; todo queda en `tenant_events`.
 *
 * Sin cambios de esquema: «hasta revocación» se guarda con `expires_at` en una fecha centinela (UNTIL_REVOKED_EXPIRES_AT,
 * por debajo del límite de TIMESTAMP de MySQL); el código nunca la muestra como caducidad. El cierre de una sesión
 * concreta queda como evento `support.exited` con su identificador (`session`) en `tenant_events`.
 */
import crypto from "node:crypto";
import type mysql from "mysql2/promise";

export const MAX_SUPPORT_MINUTES = 240;
/** Centinela de «hasta revocación» (31/12/2037 UTC): no es una caducidad, solo marca la modalidad. */
export const UNTIL_REVOKED_EXPIRES_AT = Date.UTC(2037, 11, 31);
/**
 * Umbral de detección (1/1/2037): una concesión limitada dura como mucho 4 h, así que cualquier fin posterior es «hasta
 * revocación». Con margen de sobra para un desfase de zona horaria entre quien escribe y quien lee la fecha.
 */
const UNTIL_REVOKED_THRESHOLD = Date.UTC(2037, 0, 1);
/** Última actividad que se busca en el historial (acota la consulta en accesos de meses). */
const LAST_ACTIVITY_WINDOW_DAYS = 30;

export interface SupportGrant {
  id: string;
  tenantId: string;
  operator: string;
  reason: string;
  readOnly: boolean;
  /** Para «hasta revocación», el centinela: usar `untilRevoked` para decidir y mostrar. */
  expiresAt: number;
  /** Sin caducidad fija: vigente hasta que se revoque. */
  untilRevoked: boolean;
  createdAt: number;
  revokedAt: number | null;
}

export interface SupportGrantReader {
  getGrant(id: string): Promise<SupportGrant | null>;
  /** ¿Consta cerrada la sesión `sessionId` de la concesión (abierta en `sinceMs` o después)? */
  sessionEnded?(tenantId: string, grantId: string, sessionId: string, sinceMs: number): Promise<boolean>;
}

/** Fecha en milisegundos como expresión SQL que no depende de la zona horaria del proceso Node. */
const SINCE_SQL = "FROM_UNIXTIME(? / 1000)";

export interface GrantInput {
  tenantId: string;
  operator: string;
  reason: string;
  /** Duración limitada (1–240). Se ignora con `untilRevoked`. */
  minutes?: number;
  untilRevoked?: boolean;
  readOnly?: boolean;
}

export const isUntilRevoked = (expiresAt: number) => expiresAt >= UNTIL_REVOKED_THRESHOLD;

export function grantActive(g: SupportGrant, now = Date.now()): boolean {
  return g.revokedAt === null && (g.untilRevoked || g.expiresAt > now);
}

export class MemorySupportStore implements SupportGrantReader {
  grants = new Map<string, SupportGrant>();
  endedSessions = new Set<string>();
  async getGrant(id: string) {
    return this.grants.get(id) ?? null;
  }
  async sessionEnded(_tenantId: string, grantId: string, sessionId: string) {
    return this.endedSessions.has(`${grantId}:${sessionId}`);
  }
  endSession(grantId: string, sessionId: string) {
    this.endedSessions.add(`${grantId}:${sessionId}`);
  }
  create(input: GrantInput, now = Date.now()): SupportGrant {
    const g = buildGrant(input, now);
    this.grants.set(g.id, g);
    return g;
  }
  revoke(id: string, now = Date.now()) {
    const g = this.grants.get(id);
    if (g) g.revokedAt = now;
  }
}

export function buildGrant(input: GrantInput, now: number): SupportGrant {
  if (!input.reason || input.reason.trim().length < 5) throw new Error("El motivo es obligatorio");
  const untilRevoked = input.untilRevoked === true;
  if (!untilRevoked && !(typeof input.minutes === "number" && input.minutes >= 1 && input.minutes <= MAX_SUPPORT_MINUTES)) {
    throw new Error(`La duración debe estar entre 1 y ${MAX_SUPPORT_MINUTES} minutos`);
  }
  return {
    id: crypto.randomBytes(16).toString("hex"),
    tenantId: input.tenantId,
    operator: input.operator.slice(0, 100),
    reason: input.reason.trim().slice(0, 300),
    readOnly: input.readOnly ?? true,
    expiresAt: untilRevoked ? UNTIL_REVOKED_EXPIRES_AT : now + input.minutes! * 60_000,
    untilRevoked,
    createdAt: now,
    revokedAt: null,
  };
}

const map = (r: any): SupportGrant => {
  const expiresAt = new Date(r.expires_at).getTime();
  return {
    id: r.id,
    tenantId: r.tenant_id,
    operator: r.operator,
    reason: r.reason,
    readOnly: !!r.read_only,
    expiresAt,
    untilRevoked: isUntilRevoked(expiresAt),
    createdAt: new Date(r.created_at).getTime(),
    revokedAt: r.revoked_at ? new Date(r.revoked_at).getTime() : null,
  };
};

/** Concesión vigente con su contexto, para la gestión de accesos del CRM. */
export interface SupportGrantListed extends SupportGrant {
  tenantName: string | null;
  /** Último evento de la concesión (entrada, renovación, actividad, modificación…). */
  lastActivityAt: number | null;
}

export class MysqlSupportReader implements SupportGrantReader {
  constructor(protected pool: Pick<mysql.Pool, "query">) {}
  async getGrant(id: string) {
    const [rows] = await this.pool.query<mysql.RowDataPacket[]>("SELECT * FROM support_grants WHERE id = ?", [id]);
    return rows[0] ? map(rows[0]) : null;
  }
  /** Por el índice (tenant_id, at): solo los eventos desde que se abrió la sesión (con 1 min de margen de reloj). */
  async sessionEnded(tenantId: string, grantId: string, sessionId: string, sinceMs: number) {
    return this.sessionEvent(tenantId, grantId, sessionId, "support.exited", sinceMs - 60_000);
  }

  /** ¿Hay ya un evento `action` de esa sesión (desde `sinceMs`)? */
  protected async sessionEvent(tenantId: string, grantId: string, sessionId: string, action: string, sinceMs: number) {
    const [rows] = await this.pool.query<mysql.RowDataPacket[]>(
      `SELECT 1 FROM tenant_events WHERE tenant_id = ? AND at >= ${SINCE_SQL} AND action = ? AND JSON_UNQUOTE(JSON_EXTRACT(details, '$.grantId')) = ? AND JSON_UNQUOTE(JSON_EXTRACT(details, '$.session')) = ? LIMIT 1`,
      [tenantId, Math.floor(sinceMs), action, grantId, sessionId],
    );
    return rows.length > 0;
  }
}

// Última actividad: solo los últimos 30 días del historial de la empresa (por el índice tenant_id, at)
const LISTED_SQL = `SELECT g.*, t.display_name AS tenant_name,
  (SELECT MAX(e.at) FROM tenant_events e WHERE e.tenant_id = g.tenant_id
     AND e.at >= GREATEST(g.created_at, NOW(3) - INTERVAL ${LAST_ACTIVITY_WINDOW_DAYS} DAY) AND e.action LIKE 'support.%'
     AND JSON_UNQUOTE(JSON_EXTRACT(e.details, '$.grantId')) = g.id) AS last_activity_at
  FROM support_grants g JOIN tenants t ON t.id = g.tenant_id
  WHERE g.revoked_at IS NULL AND g.expires_at > NOW(3)`;
// Las «hasta revocación» primero (no se pierden en el listado por antiguas), luego las más recientes
const LISTED_ORDER = "ORDER BY (g.expires_at >= '2037-01-01') DESC, g.created_at DESC";

/** Escrituras del plano de control, con evento de auditoría en la misma transacción. */
export class SupportAdmin extends MysqlSupportReader {
  constructor(private admin: mysql.Pool) {
    super(admin);
  }

  async create(input: GrantInput): Promise<SupportGrant> {
    const g = buildGrant(input, Date.now());
    const conn = await this.admin.getConnection();
    try {
      await conn.beginTransaction();
      const [t] = await conn.query<mysql.RowDataPacket[]>("SELECT id FROM tenants WHERE id = ? FOR UPDATE", [g.tenantId]);
      if (!t[0]) throw new Error("Tenant no encontrado");
      await conn.query(
        "INSERT INTO support_grants (id, tenant_id, operator, reason, read_only, expires_at) VALUES (?,?,?,?,?,?)",
        [g.id, g.tenantId, g.operator, g.reason, g.readOnly ? 1 : 0, new Date(g.expiresAt)],
      );
      await conn.query(
        "INSERT INTO tenant_events (tenant_id, actor_type, actor_id, action, details) VALUES (?,?,?,?,?)",
        [
          g.tenantId,
          "operator",
          g.operator,
          "support.granted",
          JSON.stringify({ grantId: g.id, reason: g.reason, readOnly: g.readOnly, untilRevoked: g.untilRevoked, grantedBy: g.operator, beneficiary: g.operator, expiresAt: g.untilRevoked ? null : new Date(g.expiresAt).toISOString() }),
        ],
      );
      await conn.commit();
      return g;
    } catch (e) {
      await conn.rollback().catch(() => undefined);
      throw e;
    } finally {
      conn.release();
    }
  }

  /** Concesiones vigentes (sin revocar ni caducar) de un tenant, las más recientes primero. */
  async listActive(tenantId: string): Promise<SupportGrantListed[]> {
    const [rows] = await this.admin.query<mysql.RowDataPacket[]>(`${LISTED_SQL} AND g.tenant_id = ? ${LISTED_ORDER} LIMIT 50`, [tenantId]);
    return rows.map(listed);
  }

  /** Concesiones vigentes de todas las empresas (gestión de accesos delegados del CRM). */
  async listAllActive(): Promise<SupportGrantListed[]> {
    const [rows] = await this.admin.query<mysql.RowDataPacket[]>(`${LISTED_SQL} ${LISTED_ORDER} LIMIT 500`);
    return rows.map(listed);
  }

  /** ¿Ya se abrió una sesión con este enlace de entrada (mismo identificador)? Un enlace = una sesión, en todas las réplicas. */
  async sessionEntered(tenantId: string, grantId: string, sessionId: string): Promise<boolean> {
    return this.sessionEvent(tenantId, grantId, sessionId, "support.entered", Date.now() - 10 * 60_000);
  }

  /** Evento de auditoría de una sesión de soporte (lo envía el Core firmado; ver controlPlane/supportAudit.ts). */
  async record(tenantId: string, operator: string, action: string, details: Record<string, unknown>): Promise<void> {
    await this.admin.query("INSERT INTO tenant_events (tenant_id, actor_type, actor_id, action, details) VALUES (?,?,?,?,?)", [tenantId, "operator", operator.slice(0, 100), action.slice(0, 60), JSON.stringify(details)]);
  }

  /** Revoca la autorización (y con ella todas sus sesiones). `by`: quién revoca (identidad autenticada). */
  async revoke(id: string, by: string): Promise<SupportGrant> {
    const g = await this.getGrant(id);
    if (!g) throw new Error("Concesión no encontrada");
    const conn = await this.admin.getConnection();
    try {
      await conn.beginTransaction();
      const [r] = await conn.query<mysql.ResultSetHeader>("UPDATE support_grants SET revoked_at = NOW(3) WHERE id = ? AND revoked_at IS NULL", [id]);
      if (r.affectedRows > 0) {
        await conn.query(
          "INSERT INTO tenant_events (tenant_id, actor_type, actor_id, action, details) VALUES (?,?,?,?,?)",
          [g.tenantId, "operator", by.slice(0, 100), "support.revoked", JSON.stringify({ grantId: id, revokedBy: by.slice(0, 100), beneficiary: g.operator, readOnly: g.readOnly, untilRevoked: g.untilRevoked })],
        );
      }
      await conn.commit();
      return { ...g, revokedAt: g.revokedAt ?? Date.now() };
    } catch (e) {
      await conn.rollback().catch(() => undefined);
      throw e;
    } finally {
      conn.release();
    }
  }
}

const listed = (r: any): SupportGrantListed => ({ ...map(r), tenantName: r.tenant_name ?? null, lastActivityAt: r.last_activity_at ? new Date(r.last_activity_at).getTime() : null });
