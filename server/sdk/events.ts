/**
 * Bus de eventos tipado y en proceso (mínimo). No es una cola: no persiste ni reintenta.
 *
 *  - Cada evento viaja en un sobre con la empresa y la sede del contexto en que se emite.
 *  - Los suscriptores se ejecutan en orden; el fallo de uno se registra y NO afecta al emisor ni a los
 *    demás (un módulo defectuoso no rompe la operación de otro).
 */
import type { EventMap } from "./contract";
import { getCompanyContext } from "./context";

export interface EventEnvelope<K extends string = string, P = unknown> {
  type: K;
  payload: P;
  tenantId: string;
  siteId: string | null;
  at: number;
}

type Handler<E extends EventMap, K extends keyof E & string> = (ev: EventEnvelope<K, E[K]>) => void | Promise<void>;

export class EventBus<E extends EventMap = EventMap> {
  private handlers = new Map<string, Array<Handler<E, any>>>();

  constructor(private opts: { now?: () => number; onHandlerError?: (type: string, err: unknown) => void } = {}) {}

  /** Suscribe y devuelve la función para cancelar la suscripción. */
  on<K extends keyof E & string>(type: K, handler: Handler<E, K>): () => void {
    const list = this.handlers.get(type) ?? [];
    list.push(handler);
    this.handlers.set(type, list);
    return () => {
      const cur = this.handlers.get(type) ?? [];
      this.handlers.set(
        type,
        cur.filter((h) => h !== handler),
      );
    };
  }

  async emit<K extends keyof E & string>(type: K, payload: E[K]): Promise<EventEnvelope<K, E[K]>> {
    const ctx = getCompanyContext();
    const ev: EventEnvelope<K, E[K]> = { type, payload, tenantId: ctx.tenantId, siteId: ctx.siteId, at: (this.opts.now ?? Date.now)() };
    for (const h of (this.handlers.get(type) ?? []).slice()) {
      try {
        await h(ev);
      } catch (err) {
        (this.opts.onHandlerError ?? ((t: string) => console.warn(JSON.stringify({ ctx: "SdkEvents", event: "handler_failed", type: t }))))(type, err);
      }
    }
    return ev;
  }

  listenerCount(type: keyof E & string): number {
    return (this.handlers.get(type) ?? []).length;
  }
}
