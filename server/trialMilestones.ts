/**
 * Hitos de activación de una empresa en prueba (encargo del 09/11/2026, fase 6): el Core comunica al plano de control
 * el primer acceso de la administración al panel y la primera acción útil (cliente, presupuesto o factura, venta o
 * producto) por `POST /cp/v1/commerce/tenants/:tenantId/trial-milestones` (server/trials/api.ts). El plano de control
 * los anota una sola vez por prueba y los ignora si la empresa no tiene prueba.
 *
 * Nunca bloquea ni falla: se envía en segundo plano, una vez por proceso y empresa (memoria con caducidad), y si el
 * plano de control aún no tiene la ruta (404) se deja de intentar durante un rato. Sin datos personales.
 */
import { CommerceError, type CommerceClient } from "./commerceClient";
import { opsLog } from "./_core/ops/log";
import { firstActionOf, type FirstStepFacts, type TrialMilestone } from "../shared/trialFirstSteps";

/** Tras un envío aceptado no se repite en este proceso; tras un fallo se reintenta pasado este plazo. */
const RETRY_MS = 30 * 60_000;
const sent = new Map<string, number>();
let missingSince: number | null = null;

export function _resetTrialMilestonesForTests() {
  sent.clear();
  missingSince = null;
}

async function send(client: CommerceClient, tenantId: string, milestone: TrialMilestone, detail: string | null, now: number): Promise<boolean> {
  const k = `${tenantId}|${milestone}`;
  const last = sent.get(k);
  if (last !== undefined && (last === Infinity || now - last < RETRY_MS)) return false;
  sent.set(k, now);
  try {
    await client.trialMilestone!(tenantId, milestone, detail);
    sent.set(k, Infinity);
    return true;
  } catch (e) {
    if (e instanceof CommerceError && e.status === 404) missingSince = now;
    // Otro rechazo del plano de control (permiso o formato): no se insiste en este proceso
    else if (e instanceof CommerceError && e.status >= 400 && e.status < 500 && e.status !== 429) {
      sent.set(k, Infinity);
      opsLog("warn", "Trials", "trial_milestone_rejected", { tenantId, milestone, status: e.status });
    } else opsLog("warn", "Trials", "trial_milestone_failed", { tenantId, milestone, status: e instanceof CommerceError ? e.status : null });
    return false;
  }
}

/**
 * Comunica los hitos que correspondan con los datos reales de la empresa. Devuelve los enviados ahora. Sin canal de
 * comercio (instalación de una sola empresa o sin configurar) no hace nada.
 */
export async function reportTrialMilestones(client: CommerceClient | null, tenantId: string | null, facts: FirstStepFacts, now: number): Promise<TrialMilestone[]> {
  if (!client?.trialMilestone || !tenantId) return [];
  if (missingSince !== null && now - missingSince < RETRY_MS) return [];
  if (sent.size > 20_000) sent.clear();
  const out: TrialMilestone[] = [];
  if (await send(client, tenantId, "first_access", null, now)) out.push("first_access");
  // El plano de control aún no tiene la ruta: no se insiste con el segundo hito
  if (missingSince === now) return out;
  const action = firstActionOf(facts);
  if (action && (await send(client, tenantId, "first_action", action, now))) out.push("first_action");
  return out;
}
