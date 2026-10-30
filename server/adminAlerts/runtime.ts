/**
 * Ciclo periódico de las alertas administrativas: lee los eventos comerciales nuevos, revisa la gracia a punto de
 * vencer y los tickets sin respuesta, y envía los resúmenes de los avisos agrupados. Una pasada a la vez; un fallo
 * de una parte no impide las demás.
 */
import { opsLog } from "../_core/ops/log";
import type { Ticket, TicketEvent } from "../_core/support/tickets";
import type { ExternalSubscription } from "../external/types";
import type { CommercialOrder } from "../orchestrator/types";
import type { AdminAlertService } from "./service";
import { externalSuspensionNear, suspensionNear, ticketDeadlines, type CommercialEventWatcher } from "./sources";

export interface AlertCycleDeps {
  alerts: AdminAlertService;
  watcher?: CommercialEventWatcher | null;
  pastDueOrders?: () => Promise<CommercialOrder[]>;
  pastDueExternals?: () => Promise<ExternalSubscription[]>;
  openTickets?: () => Promise<Array<{ ticket: Ticket; events: TicketEvent[] }>>;
  now?: () => number;
}

export async function runAlertCycle(d: AlertCycleDeps): Promise<Record<string, number | string>> {
  const now = (d.now ?? Date.now)();
  const out: Record<string, number | string> = {};
  // Sin las tablas (migración aún no aplicada) no se hace nada; se reintenta en el siguiente ciclo
  if (!(await d.alerts.checkReady())) return { ready: "no" };
  const step = async (name: string, f: () => Promise<number>) => {
    try {
      out[name] = await f();
    } catch (e) {
      out[name] = "error";
      opsLog("error", "AdminAlerts", "cycle_step_failed", { step: name, error: e instanceof Error ? e.name : "error" });
    }
  };
  const raiseAll = async (list: Array<{ id: string; facts: Parameters<AdminAlertService["raise"]>[1] }>) => {
    for (const a of list) await d.alerts.raise(a.id, a.facts);
    return list.length;
  };
  if (d.watcher) await step("events", async () => (await d.watcher!.tick()).raised);
  if (d.pastDueOrders) await step("grace", async () => raiseAll(suspensionNear(await d.pastDueOrders!(), now)));
  if (d.pastDueExternals) await step("externalGrace", async () => raiseAll(externalSuspensionNear(await d.pastDueExternals!(), now)));
  if (d.openTickets) await step("tickets", async () => raiseAll(ticketDeadlines(await d.openTickets!(), now, (await d.alerts.settings()).settings.ticketSlaHours)));
  await step("digests", async () => (await d.alerts.flush()).digests);
  return out;
}

/** Arranca el ciclo cada `everyMs` (sin solaparse). */
export function startAlertCycle(d: AlertCycleDeps, everyMs: number): () => void {
  let running = false;
  const t = setInterval(() => {
    if (running) return;
    running = true;
    void runAlertCycle(d).finally(() => (running = false));
  }, everyMs);
  t.unref?.();
  return () => clearInterval(t);
}
