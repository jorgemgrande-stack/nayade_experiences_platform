/**
 * Mapas de los lugares de servicio de cada empresa, a partir de SUS datos (coordenadas o dirección). Nunca un mapa
 * fijo: sin coordenadas ni dirección, no hay mapa.
 */

export interface MappableLocation {
  latitude?: string | number | null;
  longitude?: string | number | null;
  address?: string | null;
}

function coords(l: MappableLocation): { lat: number; lng: number } | null {
  if (l.latitude == null || l.longitude == null || l.latitude === "" || l.longitude === "") return null;
  const lat = Number(l.latitude);
  const lng = Number(l.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  if (lat === 0 && lng === 0) return null;
  return { lat, lng };
}

function query(l: MappableLocation): string | null {
  const c = coords(l);
  if (c) return `${c.lat},${c.lng}`;
  const a = l.address?.trim();
  return a ? a : null;
}

/** Mapa incrustable (sin clave de API), o null si el lugar no tiene ubicación. */
export function mapEmbedUrl(l: MappableLocation): string | null {
  const q = query(l);
  return q ? `https://maps.google.com/maps?q=${encodeURIComponent(q)}&z=15&output=embed` : null;
}

/** Enlace «Cómo llegar» en Google Maps, o null si el lugar no tiene ubicación. */
export function mapLinkUrl(l: MappableLocation): string | null {
  const q = query(l);
  return q ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}` : null;
}
