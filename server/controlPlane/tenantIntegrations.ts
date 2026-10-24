/**
 * Ficha 360° → Integraciones de una empresa, SIN secretos: qué proveedores tiene configurados y qué campos obligatorios
 * faltan. Se lee de la tabla cifrada de la propia empresa (`integration_credentials`) solo el proveedor, el campo, la
 * fecha y el autor; NUNCA el valor (ni cifrado). El estado de conexión sale de las comprobaciones y sincronizaciones
 * REALES que registra el Core (0015_integration_health); sin ellas, «no comprobado». Tener credenciales no es estar conectado.
 */
import { PROVIDERS } from "../_core/credentials/catalog";
import type { IntegrationHealth } from "../_core/credentials/health";

export type IntegrationState = "not_configured" | "incomplete" | "configured";

export interface IntegrationRow {
  provider: string;
  field: string;
  updatedAt: Date | string | null;
  updatedBy: string | null;
}

export interface IntegrationStatus {
  id: string;
  name: string;
  description: string;
  state: IntegrationState;
  configuredFields: number;
  totalFields: number;
  missingRequired: string[];
  lastChangedAt: string | null;
  lastChangedBy: string | null;
  /** connected / disconnected (credenciales rechazadas) / error / not_checked. Sin configurar, siempre not_checked. */
  connection: IntegrationHealth["connection"];
  stateAt: string | null;
  lastCheck: IntegrationHealth["lastCheck"];
  lastSync: IntegrationHealth["lastSync"];
  lastOkSyncAt: string | null;
  lastError: IntegrationHealth["lastError"];
  incidents: IntegrationHealth["incidents"];
  capabilities: string[];
  /** Cómo se comprueba (solo lectura); null si el proveedor no lo permite. */
  checkMethod: string | null;
  /** Operaciones disponibles desde Admin. Cambiar credenciales es cosa de la empresa: el operador nunca las ve. */
  operations: Array<"check">;
}

export function integrationStatus(rows: IntegrationRow[], health: IntegrationHealth[] | null = null): IntegrationStatus[] {
  return PROVIDERS.map((p) => {
    const mine = rows.filter((r) => r.provider === p.id && p.fields.some((f) => f.key === r.field));
    const keys = new Set(mine.map((r) => r.field));
    const required = p.fields.filter((f) => f.required);
    const missingRequired = required.filter((f) => !keys.has(f.key)).map((f) => f.label);
    const last = mine
      .map((r) => ({ at: r.updatedAt ? new Date(r.updatedAt).getTime() : NaN, by: r.updatedBy }))
      .filter((x) => Number.isFinite(x.at))
      .sort((a, b) => b.at - a.at)[0];
    const state: IntegrationState = keys.size === 0 ? "not_configured" : missingRequired.length ? "incomplete" : "configured";
    return {
      id: p.id,
      name: p.name,
      description: p.description,
      state,
      configuredFields: keys.size,
      totalFields: p.fields.length,
      missingRequired,
      lastChangedAt: last ? new Date(last.at).toISOString() : null,
      lastChangedBy: last?.by ?? null,
      ...healthOf(state, health?.find((h) => h.provider === p.id) ?? null),
      capabilities: p.capabilities,
      checkMethod: p.check,
      operations: state !== "not_configured" && p.check ? ["check"] : [],
    };
  });
}

function healthOf(state: IntegrationState, h: IntegrationHealth | null) {
  // Sin credenciales no hay conexión que valorar, aunque quede historial de cuando las tuvo
  const conn = state === "not_configured" || !h ? { connection: "not_checked" as const, stateAt: null } : { connection: h.connection, stateAt: h.stateAt };
  return { ...conn, lastCheck: h?.lastCheck ?? null, lastSync: h?.lastSync ?? null, lastOkSyncAt: h?.lastOkSyncAt ?? null, lastError: h?.lastError ?? null, incidents: h?.incidents ?? [] };
}

/** Lectura en la base de la empresa con SUS credenciales; solo columnas no sensibles. */
export function mysqlIntegrationRows(
  getDsn: (tenantId: string) => Promise<string | null>,
  connect: (dsn: string) => Promise<{ query: (sql: string) => Promise<[unknown, unknown]>; end: () => Promise<void> }>,
) {
  return async (tenantId: string): Promise<IntegrationRow[] | null> => {
    const dsn = await getDsn(tenantId);
    if (!dsn) return null;
    const c = await connect(dsn);
    try {
      const [rows] = (await c.query("SELECT provider, field, updated_at, updated_by FROM integration_credentials")) as [
        Array<{ provider: string; field: string; updated_at: Date | null; updated_by: string | null }>,
        unknown,
      ];
      return rows.map((r) => ({ provider: r.provider, field: r.field, updatedAt: r.updated_at, updatedBy: r.updated_by }));
    } finally {
      await c.end().catch(() => undefined);
    }
  };
}
