/**
 * adapters/maps.ts — Google Maps API con clave propia, sin proxy de Manus.
 *
 * Variables de entorno:
 *   GOOGLE_MAPS_API_KEY → clave de API de Google Maps (server-side)
 *
 * Si no está configurada, las llamadas devuelven un error descriptivo.
 */

import { estimateMapsCost, mapsEndpoint, meteredFetch } from "../_core/externalMetering";

const MAPS_BASE = "https://maps.googleapis.com/maps/api";

function getApiKey(): string {
  const key = process.env.GOOGLE_MAPS_API_KEY ?? "";
  if (!key) {
    throw new Error(
      "[Maps] GOOGLE_MAPS_API_KEY no configurada. Añádela al .env para usar la API de Google Maps."
    );
  }
  return key;
}

export async function mapsRequest<T>(
  endpoint: string,
  params: Record<string, string>
): Promise<T> {
  const apiKey = getApiKey();
  const url = new URL(`${MAPS_BASE}/${endpoint}/json`);
  url.searchParams.set("key", apiKey);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }

  const res = await meteredFetch("maps", url.toString(), undefined, { endpoint: mapsEndpoint(endpoint) });
  if (!res.ok) {
    throw new Error(`[Maps] Error ${res.status} en ${endpoint}`);
  }
  estimateMapsCost(endpoint, params);
  return res.json() as Promise<T>;
}
