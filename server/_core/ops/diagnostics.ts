/**
 * Diagnóstico de un tenant: reúne el estado operativo en un informe sin secretos
 * (nunca DSN, claves ni datos de negocio).
 */
import mysql from "mysql2/promise";
import { accessPolicy } from "../tenantRegistry/lifecycle";
import type { TenantRegistryService } from "../tenantRegistry/service";
import type { TenantRegistryReader } from "../tenantRegistry/store";
import type { Entitlement } from "../modules/entitlements";
import type { Quota } from "../erm/types";

export interface DiagnosticCheck {
  name: string;
  ok: boolean;
  detail?: string;
}

export interface TenantDiagnostics {
  tenantId: string;
  generatedAt: string;
  ok: boolean;
  status?: string;
  policy?: { publicWeb: boolean; admin: boolean; writes: boolean };
  schemaVersion?: string | null;
  domains: Array<{ domain: string; status: string; primary: boolean }>;
  entitlements: Array<{ moduleId: string; status: string; validUntil: string | null }>;
  quotas: Array<{ metric: string; period: string; limit: number; enforcement: string }>;
  checks: DiagnosticCheck[];
}

export interface DiagnosticsDeps {
  reader: TenantRegistryReader;
  registry: Pick<TenantRegistryService, "getActiveDsn">;
  entitlements?: { listEntitlements(tenantId: string): Promise<Entitlement[]> };
  quotas?: { listQuotas(tenantId: string): Promise<Quota[]> };
  /** Última versión de esquema esperada (migración más reciente conocida). */
  expectedSchemaVersion?: string;
  now?: () => number;
}

export async function diagnoseTenant(d: DiagnosticsDeps, tenantId: string): Promise<TenantDiagnostics> {
  const out: TenantDiagnostics = {
    tenantId,
    generatedAt: new Date((d.now ?? Date.now)()).toISOString(),
    ok: true,
    domains: [],
    entitlements: [],
    quotas: [],
    checks: [],
  };
  const check = (name: string, ok: boolean, detail?: string) => {
    out.checks.push({ name, ok, detail });
    if (!ok) out.ok = false;
  };

  const t = await d.reader.getTenant(tenantId);
  if (!t) {
    check("tenant_exists", false, "no está en el registro");
    return out;
  }
  out.status = t.status;
  out.schemaVersion = t.schemaVersion;
  out.policy = (({ publicWeb, admin, writes }) => ({ publicWeb, admin, writes }))(accessPolicy(t.status));
  check("status_servable", out.policy.publicWeb || out.policy.admin, `estado ${t.status}`);

  const domains = await d.reader.listDomains(tenantId);
  out.domains = domains.map((x) => ({ domain: x.domain, status: x.status, primary: x.isPrimary }));
  check("has_active_domain", domains.some((x) => x.status === "active"), `${domains.length} dominio(s)`);
  check("one_primary_domain", domains.filter((x) => x.isPrimary).length <= 1);

  const active = await d.reader.getActiveDatabase(tenantId);
  check("has_active_database", !!active, active ? `clave ${active.keyId}` : "sin BD activa");
  if (active) {
    try {
      const dsn = await d.registry.getActiveDsn(tenantId);
      check("dsn_decrypts", !!dsn);
      if (dsn) {
        const conn = await mysql.createConnection({ uri: dsn, connectTimeout: 5000 });
        try {
          const t0 = Date.now();
          await conn.query("SELECT 1");
          check("database_reachable", true, `${Date.now() - t0} ms`);
          const [h] = await conn.query<mysql.RowDataPacket[]>(
            "SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = DATABASE()",
          );
          check("schema_present", Number(h[0].n) > 0, `${h[0].n} tablas`);
          try {
            const [m] = await conn.query<mysql.RowDataPacket[]>("SELECT id FROM __elephant_migrations ORDER BY id DESC LIMIT 1");
            const last = (m[0]?.id as string | undefined) ?? null;
            if (d.expectedSchemaVersion) {
              check("schema_up_to_date", last === d.expectedSchemaVersion, `aplicada ${last ?? "ninguna"}, esperada ${d.expectedSchemaVersion}`);
            }
          } catch {
            check("migrations_table", false, "sin historial de migraciones");
          }
        } finally {
          await conn.end().catch(() => undefined);
        }
      }
    } catch (e) {
      check("database_reachable", false, e instanceof Error ? e.message.slice(0, 120) : "error");
    }
  }

  if (d.entitlements) {
    out.entitlements = (await d.entitlements.listEntitlements(tenantId)).map((e) => ({
      moduleId: e.moduleId,
      status: e.status,
      validUntil: e.validUntil ? e.validUntil.toISOString() : null,
    }));
    const expired = out.entitlements.filter((e) => e.validUntil && new Date(e.validUntil).getTime() < Date.now() && e.status === "active");
    check("entitlements_current", expired.length === 0, expired.length ? `${expired.length} licencia(s) caducada(s) aún activa(s)` : undefined);
  }
  if (d.quotas) {
    out.quotas = (await d.quotas.listQuotas(tenantId)).map((q) => ({ metric: q.metric, period: q.period, limit: q.limit, enforcement: q.enforcement }));
  }
  return out;
}
