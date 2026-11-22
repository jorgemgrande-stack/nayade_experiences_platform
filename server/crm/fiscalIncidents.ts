/**
 * Incidencias fiscales y de cobro de la empresa: hechos que dejan una operación económica a medias (pago cobrado sin
 * factura, plan de cuotas sin completar, paso posterior al cobro que falló). Reutilizan el registro de actividad del CRM
 * (`crm_activity_log`), que ya es persistente, por empresa y visible en la ficha del presupuesto: no hay tabla nueva.
 *
 * Una incidencia es una fila con acción de `FISCAL_INCIDENT_ACTIONS`. Se considera RESUELTA cuando:
 *  - su estado real ya es el correcto (p. ej. la reserva del pago ya tiene factura), o
 *  - existe una fila `fiscal_incident_resolved` que apunta a ella (`details.incidentId`).
 * Esta capa NUNCA emite facturas ni cobra: solo registra y lee. La reconciliación (que sí emite, de forma idempotente) vive
 * en el router del CRM, con las mismas garantías atómicas que el cobro.
 */
import { and, desc, eq, inArray } from "drizzle-orm";
import { crmActivityLog, quotes, reservations } from "../../drizzle/schema";

export const FISCAL_INCIDENT_ACTIONS = [
  "payment_confirmed_without_invoice",
  "installment_plan_failed",
  "post_commit_step_failed",
] as const;
export type FiscalIncidentAction = (typeof FISCAL_INCIDENT_ACTIONS)[number];
export const FISCAL_INCIDENT_RESOLVED = "fiscal_incident_resolved";

type Entity = "lead" | "quote" | "reservation" | "invoice";
// Sustituible en pruebas y compatible con la conexión normal y con una transacción
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Runner = any;

/** Texto breve y sin datos sensibles del error (nunca la traza completa ni valores de entrada). */
export function incidentErrorText(e: unknown): string {
  const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  return msg.replace(/\s+/g, " ").slice(0, 200);
}

/** Registra la incidencia de forma persistente. Si el propio registro falla, lo deja en consola: nunca rompe el flujo. */
export async function recordFiscalIncident(
  runner: Runner,
  entityType: Entity,
  entityId: number,
  action: FiscalIncidentAction,
  actor: { id: number | null; name: string | null },
  details: Record<string, unknown>,
): Promise<void> {
  try {
    await runner.insert(crmActivityLog).values({
      entityType, entityId, action, actorId: actor.id, actorName: actor.name,
      details: { incident: true, ...details }, createdAt: new Date(),
    });
  } catch (e) {
    console.error(`[fiscalIncidents] No se pudo registrar ${action} (${entityType} ${entityId}):`, incidentErrorText(e));
  }
}

export async function markFiscalIncidentResolved(runner: Runner, incident: { id: number; entityType: Entity; entityId: number }, actor: { id: number | null; name: string | null }, how: string): Promise<void> {
  await runner.insert(crmActivityLog).values({
    entityType: incident.entityType, entityId: incident.entityId, action: FISCAL_INCIDENT_RESOLVED,
    actorId: actor.id, actorName: actor.name, details: { incidentId: incident.id, how }, createdAt: new Date(),
  });
}

export interface FiscalIncident {
  id: number;
  action: FiscalIncidentAction;
  entityType: Entity;
  entityId: number;
  at: Date;
  details: Record<string, unknown>;
  /** Se puede reconciliar automáticamente (emitir lo que falta, de forma idempotente). */
  reconcilable: boolean;
}

/** Incidencias abiertas, de la más reciente a la más antigua. Solo lectura. */
export async function listOpenFiscalIncidents(runner: Runner, limit = 200): Promise<FiscalIncident[]> {
  const rows = await runner.select().from(crmActivityLog)
    .where(inArray(crmActivityLog.action, [...FISCAL_INCIDENT_ACTIONS, FISCAL_INCIDENT_RESOLVED]))
    .orderBy(desc(crmActivityLog.id)).limit(limit * 3);
  const resolvedIds = new Set<number>();
  for (const r of rows) if (r.action === FISCAL_INCIDENT_RESOLVED) resolvedIds.add(Number((r.details as Record<string, unknown>)?.incidentId));
  const open: FiscalIncident[] = [];
  for (const r of rows) {
    if (r.action === FISCAL_INCIDENT_RESOLVED || resolvedIds.has(r.id)) continue;
    const details = (r.details ?? {}) as Record<string, unknown>;
    const action = r.action as FiscalIncidentAction;
    if (action === "payment_confirmed_without_invoice" && details.reservationId) {
      const [res] = await runner.select({ invoiceId: reservations.invoiceId }).from(reservations).where(eq(reservations.id, Number(details.reservationId))).limit(1);
      if (res?.invoiceId) continue; // ya tiene factura: resuelta por los hechos
    }
    if (action === "installment_plan_failed" && r.entityType === "quote") {
      const [q] = await runner.select({ paidAt: quotes.paidAt }).from(quotes).where(and(eq(quotes.id, r.entityId))).limit(1);
      if (q?.paidAt) continue; // plan completado y facturado: resuelta por los hechos
    }
    open.push({
      id: r.id, action, entityType: r.entityType as Entity, entityId: r.entityId, at: r.createdAt, details,
      reconcilable: action === "payment_confirmed_without_invoice" || action === "installment_plan_failed",
    });
    if (open.length >= limit) break;
  }
  return open;
}
