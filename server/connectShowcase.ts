/**
 * Marketplace de Elephant Connect en el servidor: ruta real de cada módulo contratado (para «Abrir módulo») y envío de
 * la medición al canal comercial.
 *
 * Medición:
 *  - Sin datos personales: solo tipo, producto, diapositiva, fecha y un identificador aleatorio del evento.
 *  - Deduplicación por sesión (persona + tipo + producto + diapositiva durante 30 minutos) y por identificador, además
 *    de la del navegador.
 *  - Nunca falla para la persona: si el canal no tiene todavía la ruta (404) se deja de intentar durante un rato, y
 *    cualquier otro error se registra y se ignora.
 */
import { CommerceError, type CommerceClient } from "./commerceClient";
import { opsLog } from "./_core/ops/log";
import { chunkEvents, eventKey, freshEvents, type ConnectEvent } from "../shared/connectShowcase";
import type { PanelContributions } from "../shared/panelExtensions";

/** Primera ruta del menú que aporta un módulo (su portada), o null. */
export function panelOpenPath(panel: PanelContributions | undefined | null): string | null {
  if (!panel) return null;
  return panel.section?.items?.[0]?.path ?? panel.items?.[0]?.path ?? panel.settings?.[0]?.path ?? null;
}

/**
 * Resolución «capacidades del producto → ruta del módulo» a partir de las extensiones instaladas. Un producto que
 * concede varias capacidades abre la primera que tenga entrada en el menú.
 */
export function openPathResolver(sources: Array<{ capability: string | null; panel?: PanelContributions | null }>): (capabilities: string[]) => string | null {
  const byCap = new Map<string, string>();
  for (const s of sources) {
    const p = panelOpenPath(s.panel);
    if (s.capability && p && !byCap.has(s.capability)) byCap.set(s.capability, p);
  }
  return (caps) => {
    for (const c of caps) {
      const p = byCap.get(c);
      if (p) return p;
    }
    return null;
  };
}

const SESSION_MS = 30 * 60_000;
const MISSING_TTL_MS = 10 * 60_000;
const seen = new Map<string, number>();
let missingSince: number | null = null;

export function _resetConnectEventsForTests() {
  seen.clear();
  missingSince = null;
}

/** Eventos de este lote que no se han contado ya en esta sesión (memoria del proceso, con caducidad). */
export function acceptEvents(scope: string, events: ConnectEvent[], now: number): ConnectEvent[] {
  if (seen.size > 20_000) for (const [k, t] of Array.from(seen)) if (now - t > SESSION_MS) seen.delete(k);
  return freshEvents(events, now).filter((e) => {
    const byKey = `${scope}|${eventKey(e)}`;
    const byId = `id|${e.id}`;
    const tk = seen.get(byKey);
    if (seen.has(byId) || (tk !== undefined && now - tk < SESSION_MS)) return false;
    seen.set(byKey, now);
    seen.set(byId, now);
    return true;
  });
}

/** Envía la medición al canal. Devuelve cuántos eventos se han enviado (0 si no había canal o no tiene la ruta). */
export async function forwardEvents(client: CommerceClient | null, tenantId: string, events: ConnectEvent[], now: number): Promise<number> {
  if (!client?.events || events.length === 0) return 0;
  if (missingSince !== null && now - missingSince < MISSING_TTL_MS) return 0;
  let sent = 0;
  for (const batch of chunkEvents(events)) {
    try {
      await client.events(tenantId, batch);
      missingSince = null;
      sent += batch.length;
    } catch (e) {
      // 404: el canal aún no recibe medición → silencio y se vuelve a probar más tarde
      if (e instanceof CommerceError && e.status === 404) missingSince = now;
      else opsLog("warn", "Connect", "events_forward_failed", { tenantId, status: e instanceof CommerceError ? e.status : null });
      break;
    }
  }
  return sent;
}
