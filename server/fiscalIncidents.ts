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
import { createHash } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { crmActivityLog, quotes, reservations } from "../drizzle/schema";

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
  return msg
    .split(/\bparams:/i)[0]          // el mensaje de la capa de BD puede incluir los parámetros de la consulta (datos personales)
    .replace(/'[^']*'/g, "'?'")       // valores entre comillas (p. ej. «Duplicate entry '…'»)
    .replace(/\s+/g, " ")
    .slice(0, 200);
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

async function toOpenIncident(runner: Runner, r: any): Promise<FiscalIncident | null> {
  const details = (r.details ?? {}) as Record<string, unknown>;
  const action = r.action as FiscalIncidentAction;
  if (action === "payment_confirmed_without_invoice" && details.reservationId) {
    const [res] = await runner.select({ invoiceId: reservations.invoiceId }).from(reservations).where(eq(reservations.id, Number(details.reservationId))).limit(1);
    if (res?.invoiceId) return null; // ya tiene factura: resuelta por los hechos
  }
  if (action === "installment_plan_failed" && r.entityType === "quote") {
    const [q] = await runner.select({ paidAt: quotes.paidAt }).from(quotes).where(and(eq(quotes.id, r.entityId))).limit(1);
    if (q?.paidAt) return null; // plan completado y facturado: resuelta por los hechos
  }
  return {
    id: r.id, action, entityType: r.entityType as Entity, entityId: r.entityId, at: r.createdAt, details,
    reconcilable: action === "payment_confirmed_without_invoice" || action === "installment_plan_failed",
  };
}

/** Una incidencia concreta si sigue abierta (búsqueda directa por id: no depende de ninguna ventana de la lista). */
export async function getOpenFiscalIncident(runner: Runner, id: number): Promise<FiscalIncident | null> {
  const [r] = await runner.select().from(crmActivityLog).where(eq(crmActivityLog.id, id)).limit(1);
  if (!r || !(FISCAL_INCIDENT_ACTIONS as readonly string[]).includes(r.action)) return null;
  const resolved = await runner.select({ id: crmActivityLog.id, details: crmActivityLog.details }).from(crmActivityLog)
    .where(and(eq(crmActivityLog.action, FISCAL_INCIDENT_RESOLVED), eq(crmActivityLog.entityType, r.entityType), eq(crmActivityLog.entityId, r.entityId)));
  if (resolved.some((x: any) => Number((x.details as Record<string, unknown>)?.incidentId) === id)) return null;
  return toOpenIncident(runner, r);
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
    const inc = await toOpenIncident(runner, r);
    if (inc) open.push(inc);
    if (open.length >= limit) break;
  }
  return open;
}

/** Propuesta de reconciliación pendiente de aprobación. NO emite ni vincula nada: solo describe lo que se haría. */
export const FISCAL_RECONCILE_PROPOSED = "fiscal_reconcile_proposed";

export type ReconcileProposalPlan =
  | { kind: "issue_invoice"; ppId: number; reservationId: number | null; quoteId: number | null; amountCents: number; paymentMethod: string }
  /** `reservationId`: la reserva viva del presupuesto que el cierre del plan completaría (o null si crearía una nueva). */
  | { kind: "confirm_plan"; quoteId: number; reservationId: number | null };

/** Aprobación de una propuesta concreta (y de su versión) por un administrador DISTINTO del proponente. No aplica nada. */
export const FISCAL_RECONCILE_APPROVED = "fiscal_reconcile_approved";
/** Intento denegado (p. ej. autoaprobación): solo auditoría, sin efectos. */
export const FISCAL_RECONCILE_DENIED = "fiscal_reconcile_denied";

/** Vista previa de efectos económicos: SOLO importes y recuentos agregados, sin datos personales. */
export interface ReconcilePreview {
  invoicesToIssue: number;
  invoiceAmountCents: number;
  reservationsLinked: number;
  reservationsCreated: number;
  documentNumbersConsumed: number;
  historicalDocumentsModified: 0;
  note?: string;
}

/** Versión del contenido de la propuesta: cambia si cambia el plan, el motivo o la vista previa. */
export function reconcileProposalVersion(content: { plan: unknown; reason: string; preview: unknown }): string {
  const canon = (v: any): any => Array.isArray(v) ? v.map(canon)
    : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v;
  return createHash("sha256").update(JSON.stringify(canon({ plan: content.plan, reason: content.reason, preview: content.preview }))).digest("hex").slice(0, 16);
}

export interface ReconcileProposal {
  id: number; incidentId: number; plan: ReconcileProposalPlan; proposedBy: number | null; at: Date;
  reason: string; preview: ReconcilePreview | null;
  /** Versión guardada al proponer. */
  version: string | null;
  /** Versión recalculada con el contenido ACTUAL de la fila: si difiere de `version`, la propuesta fue alterada. */
  currentVersion: string;
  entityType: Entity; entityId: number;
}

export async function recordReconcileProposal(
  runner: Runner, incident: { id: number; entityType: Entity; entityId: number }, plan: ReconcileProposalPlan,
  actor: { id: number | null; name: string | null }, reason: string, preview: ReconcilePreview,
): Promise<{ id: number; version: string }> {
  const version = reconcileProposalVersion({ plan, reason, preview });
  const [r] = await runner.insert(crmActivityLog).values({
    entityType: incident.entityType, entityId: incident.entityId, action: FISCAL_RECONCILE_PROPOSED,
    actorId: actor.id, actorName: actor.name, details: { incidentId: incident.id, plan, reason, preview, version }, createdAt: new Date(),
  });
  return { id: Number((r as { insertId: number }).insertId), version };
}

/** Propuesta indicada (si pertenece a esa incidencia) o la más reciente de la incidencia. */
export async function getReconcileProposal(runner: Runner, incidentId: number, proposalId?: number): Promise<ReconcileProposal | null> {
  const rows = await runner.select().from(crmActivityLog)
    .where(and(eq(crmActivityLog.action, FISCAL_RECONCILE_PROPOSED), ...(proposalId ? [eq(crmActivityLog.id, proposalId)] : [])))
    .orderBy(desc(crmActivityLog.id)).limit(proposalId ? 1 : 500);
  const hit = rows.find((r: any) => Number((r.details as Record<string, unknown>)?.incidentId) === incidentId);
  if (!hit) return null;
  const d = hit.details as any;
  const reason = String(d.reason ?? "");
  return {
    id: hit.id, incidentId, plan: d.plan as ReconcileProposalPlan, proposedBy: hit.actorId ?? null, at: hit.createdAt,
    reason, preview: (d.preview ?? null) as ReconcilePreview | null, version: d.version ? String(d.version) : null,
    currentVersion: reconcileProposalVersion({ plan: d.plan, reason, preview: d.preview ?? null }),
    entityType: hit.entityType as Entity, entityId: hit.entityId,
  };
}

/** Aprobación registrada de esa propuesta (la primera), o null. */
export async function getReconcileApproval(runner: Runner, proposal: { id: number; entityType: Entity; entityId: number }): Promise<{ id: number; version: string; approvedBy: number | null } | null> {
  const rows = await runner.select().from(crmActivityLog)
    .where(and(eq(crmActivityLog.action, FISCAL_RECONCILE_APPROVED), eq(crmActivityLog.entityType, proposal.entityType), eq(crmActivityLog.entityId, proposal.entityId)))
    .orderBy(crmActivityLog.id);
  const hit = rows.find((r: any) => Number((r.details as Record<string, unknown>)?.proposalId) === proposal.id);
  if (!hit) return null;
  return { id: hit.id, version: String((hit.details as any).version ?? ""), approvedBy: hit.actorId ?? null };
}

/** Separación de funciones: quien propuso no aprueba. Sin proponente identificable también se deniega. */
export function canApproveProposal(proposedBy: number | null, approverId: number | null | undefined): boolean {
  return proposedBy != null && approverId != null && proposedBy !== approverId;
}
