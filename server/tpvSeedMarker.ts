/**
 * Marca de «derecho adquirido sembrado» del TPV (seguro pedido por main el 10/11/2026): la escribe la tarea
 * `tpv-acquired-rights --apply` en `registry_meta` (clave `tpv_acquired_rights_seed`, con fecha y versión). Mientras no
 * exista, el reparto nuevo NO se aplica a las empresas Essential: conservan todo, como hasta ahora. Cuando existe, el
 * reparto se aplica solo a quien no tenga el derecho adquirido.
 *
 * Lectura con caché corta. Sin registro configurado (instalación única) o si no se puede leer: «sin marca» (el seguro
 * mantiene lo de siempre; nunca se quita nada por un fallo).
 */
export const TPV_SEED_MARKER_KEY = "tpv_acquired_rights_seed";
export const TPV_SEED_MARKER_VERSION = "tpv-2026-11-10/1";

export interface TpvSeedMarker {
  at: number;
  version: string;
  granted: number;
}

type Reader = (key: string) => Promise<string | null>;
let reader: Reader | null = null;
let cache: { at: number; value: TpvSeedMarker | null } | null = null;
const TTL = 60_000;

export function configureTpvSeedMarker(r: Reader | null): void {
  reader = r;
  cache = null;
}

export function _resetTpvSeedMarkerCache(): void {
  cache = null;
}

export function parseTpvSeedMarker(raw: string | null): TpvSeedMarker | null {
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as Partial<TpvSeedMarker>;
    if (!Number.isFinite(Number(p.at)) || typeof p.version !== "string") return null;
    return { at: Number(p.at), version: p.version, granted: Number(p.granted ?? 0) };
  } catch {
    return null;
  }
}

/** Marca vigente o null (sin sembrar, sin registro o sin poder leerla). */
export async function tpvSeedMarker(now = Date.now()): Promise<TpvSeedMarker | null> {
  if (!reader) return null;
  if (cache && now - cache.at < TTL) return cache.value;
  try {
    const value = parseTpvSeedMarker(await reader(TPV_SEED_MARKER_KEY));
    cache = { at: now, value };
    return value;
  } catch {
    return null;
  }
}
