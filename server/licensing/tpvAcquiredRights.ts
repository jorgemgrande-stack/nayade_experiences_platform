/**
 * Derecho adquirido del TPV (decisión de Jorge del 10/11/2026, opción A): las empresas que, ANTES del cambio de planes,
 * tenían por su licencia los informes por periodo y por cajero y la revisión y los ajustes de cierres (los daba la caja
 * del plan, `bill-cash`, en Essential, Business y Enterprise) los conservan. El nuevo reparto solo vale para las nuevas.
 *
 * Registro explícito por empresa: una licencia de capacidad propia, `tpv-acquired-rights`, con origen
 * `acquired:tpv-2026-11-10`, sin caducidad, concedida por esta siembra (con su evento en `tenant_capability_events`:
 * actor, motivo y fecha). No la toca ninguna suscripción: la sincronización de licencias solo cancela las de su propio
 * origen (`subscription:<id>`), así que se mantiene al renovar y al cambiar de periodicidad.
 *
 * Criterio exacto de la siembra: empresa con la caja del plan concedida para toda la empresa (`bill-cash`, sede '') en
 * estado `active`, `read_only` o `suspended` en el momento de sembrar (no `contracted`, `pending_setup` ni `cancelled`).
 * Se ejecuta ANTES de publicar el código que aplica el nuevo reparto (tarea `tpv-acquired-rights` de backupJob:
 * simulación por defecto, `--apply` para conceder). Idempotente: una empresa que ya la tiene no cambia.
 */
import type mysql from "mysql2/promise";
import type { CapabilityGrant } from "../_core/capabilities/model";
import { licenceSummary } from "../planSeats";
import { TPV_SEED_MARKER_KEY, TPV_SEED_MARKER_VERSION } from "../tpvSeedMarker";

export const TPV_ACQUIRED_RIGHTS_CAPABILITY = "tpv-acquired-rights";
export const TPV_ACQUIRED_RIGHTS_SOURCE = "acquired:tpv-2026-11-10";
export const TPV_ACQUIRED_RIGHTS_ACTOR = "operacion:tpv-derechos-adquiridos";
export const TPV_ACQUIRED_RIGHTS_REASON =
  "Derecho adquirido del TPV (opción A, Jorge, 10/11/2026): conserva los informes por periodo y por cajero y la revisión y los ajustes de cierres que tenía con la caja de su plan";
export const SEED_STATUSES = ["active", "read_only", "suspended"] as const;

export interface SeedStore {
  list(tenantId: string): Promise<CapabilityGrant[]>;
  apply(tenantId: string, changes: Array<{ capabilityId: string; siteId: string; status: "active"; validUntil: null; source: string }>, meta: { actor: string; reason: string | null; now: number }): Promise<unknown[]>;
}

export interface SeedReport {
  apply: boolean;
  criterio: string;
  candidatas: number;
  concedidas: string[];
  yaConcedidas: string[];
  porPlan: Record<string, number>;
}

/** ¿Tenía la empresa la caja del plan? (criterio de la siembra, puro) */
export function hadPlanCash(grants: readonly CapabilityGrant[]): boolean {
  return grants.some((g) => g.capabilityId === "bill-cash" && g.siteId === "" && (SEED_STATUSES as readonly string[]).includes(g.status));
}

export async function seedTpvAcquiredRights(
  d: { candidates: () => Promise<string[]>; store: SeedStore; now?: () => number; writeMarker?: (value: string) => Promise<void> },
  o: { apply: boolean },
): Promise<SeedReport> {
  const now = (d.now ?? Date.now)();
  const report: SeedReport = {
    apply: o.apply,
    criterio: "bill-cash de toda la empresa en estado active, read_only o suspended al sembrar",
    candidatas: 0,
    concedidas: [],
    yaConcedidas: [],
    porPlan: {},
  };
  for (const tenantId of (await d.candidates()).sort()) {
    const grants = await d.store.list(tenantId);
    if (!hadPlanCash(grants)) continue;
    report.candidatas++;
    const plan = licenceSummary(grants, now).plan ?? "sin plan";
    report.porPlan[plan] = (report.porPlan[plan] ?? 0) + 1;
    if (grants.some((g) => g.capabilityId === TPV_ACQUIRED_RIGHTS_CAPABILITY && g.siteId === "" && g.status === "active")) {
      report.yaConcedidas.push(tenantId);
      continue;
    }
    if (o.apply) {
      await d.store.apply(tenantId, [{ capabilityId: TPV_ACQUIRED_RIGHTS_CAPABILITY, siteId: "", status: "active", validUntil: null, source: TPV_ACQUIRED_RIGHTS_SOURCE }], { actor: TPV_ACQUIRED_RIGHTS_ACTOR, reason: TPV_ACQUIRED_RIGHTS_REASON, now });
    }
    report.concedidas.push(tenantId);
  }
  // Marca de «sembrado» (fecha y versión): desde ahora el reparto nuevo se aplica a quien no tenga el derecho
  if (o.apply && d.writeMarker) await d.writeMarker(JSON.stringify({ at: now, version: TPV_SEED_MARKER_VERSION, granted: report.concedidas.length + report.yaConcedidas.length }));
  return report;
}

/** Escribe la marca en `registry_meta` (idempotente: la última siembra manda). */
export function mysqlSeedMarkerWriter(pool: mysql.Pool): (value: string) => Promise<void> {
  return async (value) => {
    await pool.query("INSERT INTO registry_meta (k, v) VALUES (?, ?) ON DUPLICATE KEY UPDATE v = VALUES(v)", [TPV_SEED_MARKER_KEY, value]);
  };
}

/** Empresas del registro con la caja del plan en un estado de la siembra (solo lectura). */
export function mysqlSeedCandidates(pool: mysql.Pool): () => Promise<string[]> {
  return async () => {
    const [rows] = await pool.query<mysql.RowDataPacket[]>(
      "SELECT DISTINCT tenant_id FROM tenant_capabilities WHERE capability_id = 'bill-cash' AND site_id = '' AND status IN ('active','read_only','suspended')",
    );
    return rows.map((r) => String(r.tenant_id));
  };
}
