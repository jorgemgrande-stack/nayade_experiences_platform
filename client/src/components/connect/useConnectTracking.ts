/**
 * Medición del marketplace desde el panel: vistas de tarjetas, fichas y diapositivas, clics y contrataciones.
 *
 *  - Sin datos personales: tipo, producto, diapositiva, fecha y un identificador aleatorio del evento.
 *  - Cada cosa se cuenta una vez por sesión del navegador (y el servidor vuelve a deduplicar).
 *  - Se envía en lotes por `connect.track`; si falla, se descarta en silencio (nunca molesta a la persona).
 */
import { useCallback, useEffect, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { randomId } from "@shared/randomId";
import { chunkEvents, eventKey, freshEvents, type ConnectEvent, type ConnectEventType } from "@shared/connectShowcase";

const SEEN_KEY = "cx-medicion-v1";
const FLUSH_MS = 1500;

let queue: ConnectEvent[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let sender: ((events: ConnectEvent[]) => void) | null = null;
let memorySeen: Set<string> | null = null;

function seen(): Set<string> {
  if (memorySeen) return memorySeen;
  memorySeen = new Set();
  try {
    const raw = window.sessionStorage.getItem(SEEN_KEY);
    if (raw) for (const k of JSON.parse(raw) as string[]) memorySeen.add(k);
  } catch {
    // sin almacenamiento de sesión: se deduplica solo en memoria
  }
  return memorySeen;
}

function remember(k: string) {
  const s = seen();
  s.add(k);
  try {
    window.sessionStorage.setItem(SEEN_KEY, JSON.stringify(Array.from(s).slice(-500)));
  } catch {
    // ignorado
  }
}

function flush() {
  timer = null;
  const events = freshEvents(queue, Date.now());
  queue = [];
  if (!sender || events.length === 0) return;
  for (const batch of chunkEvents(events)) sender(batch);
}

/** Registra un evento (una sola vez por sesión para el mismo tipo, producto y diapositiva). */
export function trackConnect(type: ConnectEventType, o: { productKey?: string; slideId?: string } = {}) {
  const e: ConnectEvent = { id: randomId(), type, ...(o.productKey ? { productKey: o.productKey } : {}), ...(o.slideId ? { slideId: o.slideId } : {}), at: new Date().toISOString() };
  const k = eventKey(e);
  if (seen().has(k)) return;
  remember(k);
  queue.push(e);
  if (!timer) timer = setTimeout(flush, FLUSH_MS);
}

/** Conecta el envío por `connect.track` (una vez por página del marketplace). */
export function useConnectTrackingSender() {
  const m = trpc.connect.track.useMutation({ onError: () => undefined });
  const { mutate } = m;
  useEffect(() => {
    sender = (events) => mutate({ events });
    return () => {
      if (timer) {
        clearTimeout(timer);
        flush();
      }
      sender = null;
    };
  }, [mutate]);
}

/** Cuenta la vista de un elemento cuando al menos la mitad está en pantalla. */
export function useViewTracking<T extends Element>(type: ConnectEventType, o: { productKey?: string; slideId?: string; enabled?: boolean }) {
  const ref = useRef<T | null>(null);
  const { productKey, slideId, enabled = true } = o;
  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;
    if (typeof IntersectionObserver === "undefined") {
      trackConnect(type, { productKey, slideId });
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((x) => x.isIntersecting)) {
          trackConnect(type, { productKey, slideId });
          io.disconnect();
        }
      },
      { threshold: 0.5 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [type, productKey, slideId, enabled]);
  return useCallback((el: T | null) => {
    ref.current = el;
  }, []);
}
