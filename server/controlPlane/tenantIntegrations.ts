/**
 * Ficha 360° → Integraciones de una empresa, SIN secretos: qué proveedores tiene configurados y qué campos obligatorios
 * faltan. Se lee de la tabla cifrada de la propia empresa (`integration_credentials`) solo el proveedor, el campo, la
 * fecha y el autor; NUNCA el valor (ni cifrado). El estado de conexión no se registra hoy: se dice «no comprobado».
 */
import { PROVIDERS } from "../_core/credentials/catalog";

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
  /** Hoy no se guarda ninguna comprobación de conexión ni sincronización: nunca se presenta como «correcta». */
  connection: "not_checked";
}

export function integrationStatus(rows: IntegrationRow[]): IntegrationStatus[] {
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
      connection: "not_checked",
    };
  });
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
