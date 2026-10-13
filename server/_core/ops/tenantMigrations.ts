/**
 * Migraciones por tenant: aplica el esquema pendiente a todas las BD de tenants servibles.
 *
 *  - Dry-run por defecto: informa de cuántas migraciones tiene pendientes cada tenant.
 *  - Con `apply`: primero un tenant «canario»; si falla, se detiene todo (nada más se toca).
 *  - Después el resto con concurrencia acotada; el fallo de uno no impide los demás y queda
 *    registrado. La versión de esquema de cada tenant se actualiza en el registro.
 *  - Nunca toca tenants en alta, archivados o eliminados.
 */
import type { Actor, TenantRegistryService } from "../tenantRegistry/service";
import type { TenantRegistryReader } from "../tenantRegistry/store";
import type { SchemaApplier } from "../provisioning/ports";

export interface TenantMigrationResult {
  tenantId: string;
  outcome: "planned" | "up_to_date" | "migrated" | "failed" | "skipped";
  pending?: string[];
  schemaVersion?: string;
  error?: string;
}

const MIGRATABLE = new Set(["trial", "active", "grace", "suspended"]);

export interface MigrationDeps {
  reader: TenantRegistryReader;
  registry: Pick<TenantRegistryService, "getActiveDsn" | "setSchemaVersion">;
  schema: SchemaApplier & { plan?: (dsn: string) => Promise<string[]> };
  actor: Actor;
  /** Módulos externos: instalación y licencias del tenant (opcional). */
  modules?: {
    install(dsn: string, moduleIds: string[]): Promise<{ installed: string[] }>;
    licensedFor(tenantId: string): Promise<string[]>;
  };
}

export async function migrateAllTenants(
  d: MigrationDeps,
  opts: { apply?: boolean; concurrency?: number; only?: string[] } = {},
): Promise<TenantMigrationResult[]> {
  const tenants = (await d.reader.listTenants())
    .filter((t) => MIGRATABLE.has(t.status))
    .filter((t) => !opts.only || opts.only.includes(t.id));
  const results: TenantMigrationResult[] = [];

  const one = async (tenantId: string): Promise<TenantMigrationResult> => {
    try {
      const dsn = await d.registry.getActiveDsn(tenantId);
      if (!dsn) return { tenantId, outcome: "skipped", error: "sin base de datos activa" };
      if (!opts.apply) {
        const pending = d.schema.plan ? await d.schema.plan(dsn) : [];
        return { tenantId, outcome: pending.length ? "planned" : "up_to_date", pending };
      }
      const before = d.schema.plan ? await d.schema.plan(dsn) : [];
      const v = await d.schema.apply(dsn);
      if (d.modules) await d.modules.install(dsn, await d.modules.licensedFor(tenantId));
      await d.registry.setSchemaVersion(tenantId, v.schemaVersion, d.actor);
      return { tenantId, outcome: before.length || !d.schema.plan ? "migrated" : "up_to_date", pending: before, schemaVersion: v.schemaVersion };
    } catch (e) {
      return { tenantId, outcome: "failed", error: e instanceof Error ? e.message.slice(0, 200) : "error" };
    }
  };

  if (tenants.length === 0) return results;

  if (!opts.apply) {
    for (const t of tenants) results.push(await one(t.id));
    return results;
  }

  // Canario: el primero; si falla, no se toca nada más
  const [canary, ...rest] = tenants;
  const c = await one(canary.id);
  results.push(c);
  if (c.outcome === "failed") {
    for (const t of rest) results.push({ tenantId: t.id, outcome: "skipped", error: "canario fallido" });
    return results;
  }

  const limit = Math.max(1, opts.concurrency ?? 3);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, rest.length) }, async () => {
      while (i < rest.length) {
        const t = rest[i++];
        results.push(await one(t.id));
      }
    }),
  );
  return results;
}
