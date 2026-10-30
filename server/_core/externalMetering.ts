/**
 * Medición de las integraciones externas de pago (GHL, Vapi, Google Maps) por empresa.
 *
 * `meteredFetch` sustituye a `fetch` en las llamadas salientes existentes: hace exactamente la misma llamada y, además,
 * anota en el Resource Manager la operación (`ext.<proveedor>.calls`), el error si lo hubo (red o HTTP ≥ 400) y la
 * latencia. La empresa sale del contexto asíncrono, como el resto de la medición.
 *
 * Reglas:
 *  - Medir nunca rompe la llamada: cualquier fallo de la medición se ignora y la respuesta (o el error) del proveedor
 *    llega intacta a quien llama. No se lee el cuerpo de la respuesta.
 *  - Cada medición lleva su origen en `meta.origin`: `measured` (cantidad real de la respuesta) o `estimated` (tarifa
 *    pública de referencia de costs.ts). El coste estimado y el medido van además en métricas distintas.
 *  - Etiquetas de baja cardinalidad: el punto de acceso sin identificadores, nunca la URL completa (lleva claves).
 */
import { EXTERNAL_REFERENCE_PRICES } from "./erm/costs";
import { extMetrics, meter, Metrics, type ExternalProvider } from "./metering";

export type MeasureOrigin = "measured" | "estimated";

/** Punto de acceso legible y sin identificadores: «/contacts/abc123/notes» → «contacts/:id/notes». */
export function endpointOf(input: string | URL): string {
  try {
    const path = new URL(String(input)).pathname;
    const parts = path
      .split("/")
      .filter(Boolean)
      .slice(0, 4)
      .map((p) => (/\d/.test(p) || p.length >= 16 ? ":id" : p.toLowerCase().replace(/[^a-z0-9_-]/g, "")));
    return parts.join("/").slice(0, 60) || "/";
  } catch {
    return "desconocido";
  }
}

const safe = (f: () => void) => {
  try {
    f();
  } catch {
    // La medición nunca afecta a la llamada medida.
  }
};

/** Anota una llamada saliente ya hecha (status `null`: fallo de red). Nunca lanza. */
export function meterExternalCall(provider: ExternalProvider, endpoint: string, ms: number, status: number | null): void {
  safe(() => {
    const m = extMetrics(provider);
    const meta = { origin: "measured" as const, endpoint, status };
    meter(m.calls, 1, "count", meta);
    meter(m.ms, Math.max(0, ms), "ms", meta);
    if (status === null || status >= 400) meter(m.errors, 1, "count", meta);
  });
}

/** Anota un coste en USD (se guarda en micro-USD) con su origen. Nunca lanza. */
export function meterExternalCost(provider: ExternalProvider, usd: number, origin: MeasureOrigin, meta: Record<string, string | number | null> = {}): void {
  safe(() => {
    if (!Number.isFinite(usd) || usd <= 0) return;
    const m = extMetrics(provider);
    meter(origin === "measured" ? m.costMeasured : m.costEstimated, Math.round(usd * 1e6), "microusd", { ...meta, origin });
  });
}

/** `fetch` medido. Misma firma y mismo resultado que `fetch`; la medición no puede alterar ni la respuesta ni el error. */
export async function meteredFetch(provider: ExternalProvider, input: string | URL, init?: RequestInit, o: { endpoint?: string } = {}): Promise<Response> {
  let endpoint = "desconocido";
  safe(() => (endpoint = o.endpoint ?? endpointOf(input)));
  const t0 = Date.now();
  let res: Response;
  try {
    res = await globalThis.fetch(input, init);
  } catch (e) {
    meterExternalCall(provider, endpoint, Date.now() - t0, null);
    throw e;
  }
  let status: number | null = null;
  safe(() => (status = typeof res.status === "number" ? res.status : null));
  meterExternalCall(provider, endpoint, Date.now() - t0, status ?? 0);
  return res;
}

/** Punto de acceso de Google Maps sin prefijo ni formato: «/maps/api/place/details/json» → «place/details». */
export function mapsEndpoint(endpoint: string): string {
  return endpoint.replace(/^\/+/, "").replace(/^maps\/api\//, "").replace(/\/(json|xml)$/, "");
}

/**
 * Coste ESTIMADO de una llamada correcta a Google Maps con la tarifa pública del punto de acceso (sin tarifa conocida,
 * no se estima). La matriz de distancias se cobra por elemento: orígenes × destinos (separados por «|»). Nunca lanza.
 */
export function estimateMapsCost(endpoint: string, params: Record<string, unknown> = {}): void {
  safe(() => {
    const key = mapsEndpoint(endpoint) as keyof typeof EXTERNAL_REFERENCE_PRICES.maps;
    const price = EXTERNAL_REFERENCE_PRICES.maps[key];
    if (!price) return;
    const count = (v: unknown) => (typeof v === "string" && v ? v.split("|").length : 1);
    const units = key === "distancematrix" ? count(params.origins) * count(params.destinations) : 1;
    meterExternalCost("maps", price * units, "estimated", { endpoint: key, units });
  });
}

/**
 * Consumo de una llamada de voz de Vapi terminada: minutos (medidos con la duración del proveedor) y coste. Si Vapi
 * devuelve `cost` (USD), es el coste MEDIDO; si no, se ESTIMA con la tarifa pública por minuto. Nunca lanza.
 */
export function meterVoiceCall(durationSeconds: unknown, costUsd: unknown, source: "webhook" | "sync"): void {
  safe(() => {
    const secs = typeof durationSeconds === "number" && Number.isFinite(durationSeconds) && durationSeconds > 0 ? durationSeconds : 0;
    const cost = typeof costUsd === "number" && Number.isFinite(costUsd) && costUsd > 0 ? costUsd : null;
    if (!secs && cost === null) return;
    if (secs) meter(Metrics.EXT_VAPI_SECONDS, Math.round(secs), "s", { origin: "measured", source });
    if (cost !== null) meterExternalCost("vapi", cost, "measured", { source });
    else meterExternalCost("vapi", (secs / 60) * EXTERNAL_REFERENCE_PRICES.vapi.minute, "estimated", { source });
  });
}
