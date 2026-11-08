/**
 * Sistema visual del marketplace (/admin/ampliar): tonos de color, tono de cada estado comercial y paginación de los
 * carriles. Solo presentación: no decide qué productos se muestran, su estado ni sus acciones (eso es de
 * `connectMarketplace` y `connectShowcase`).
 *
 * Paleta «premium cinematic»: azul noche, azul eléctrico, violeta, magenta, turquesa, esmeralda y ámbar. El rojo
 * corporativo de Big Elephant queda como acento de marca (no es un tono de producto).
 */
import type { SheetAccent } from "./connectCard";
import type { ConnectState } from "./connectMarketplace";

export const MARKET_TONES = ["night", "electric", "violet", "magenta", "turquoise", "emerald", "amber"] as const;
export type MarketTone = (typeof MARKET_TONES)[number];

/** Color de acento publicado en el catálogo (`layout.accentColor`) → tono del marketplace. */
const FROM_ACCENT: Record<SheetAccent, MarketTone> = {
  blue: "electric",
  teal: "turquoise",
  violet: "violet",
  amber: "amber",
  rose: "magenta",
  slate: "night",
};

/** Tono por defecto según el icono del producto (sector o función), para que cada línea tenga su color reconocible. */
const ICON_TONE: Record<string, MarketTone> = {
  hotel: "electric",
  bed: "electric",
  chef: "amber",
  utensils: "amber",
  heart: "magenta",
  stethoscope: "magenta",
  mountain: "turquoise",
  globe: "turquoise",
  plane: "turquoise",
  map: "turquoise",
  "map-pin": "turquoise",
  compass: "turquoise",
  leaf: "emerald",
  banknote: "emerald",
  coins: "emerald",
  wallet: "emerald",
  "credit-card": "emerald",
  landmark: "emerald",
  book: "emerald",
  megaphone: "magenta",
  share: "magenta",
  ticket: "magenta",
  tag: "magenta",
  mail: "electric",
  message: "electric",
  messages: "electric",
  phone: "electric",
  sparkles: "violet",
  bot: "violet",
  workflow: "violet",
  rocket: "violet",
  search: "violet",
  database: "night",
  server: "night",
  users: "amber",
  "user-plus": "amber",
  "id-card": "amber",
  handshake: "amber",
  calendar: "electric",
  store: "magenta",
  package: "violet",
  pen: "amber",
  "file-text": "amber",
};

/** Rotación de respaldo (sin azul noche, que es el fondo) para iconos desconocidos: estable por clave. */
const ROTATION: MarketTone[] = ["electric", "violet", "turquoise", "magenta", "emerald", "amber"];

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export interface TonedItem {
  key: string;
  icon?: string | null;
  sheet?: { layout?: { accentColor?: SheetAccent | null } | null } | null;
}

/** Tono de un producto: el acento publicado manda; si no, el de su icono; si no, uno estable según su clave. */
export function toneOf(item: TonedItem): MarketTone {
  const accent = item.sheet?.layout?.accentColor;
  if (accent && Object.prototype.hasOwnProperty.call(FROM_ACCENT, accent)) return FROM_ACCENT[accent];
  if (item.icon && Object.prototype.hasOwnProperty.call(ICON_TONE, item.icon)) return ICON_TONE[item.icon];
  return ROTATION[hash(item.key) % ROTATION.length];
}

/** Color del indicador de cada estado comercial (el texto lo pone siempre `CONNECT_STATE_SHORT`). */
export type StateTone = "emerald" | "amber" | "violet" | "electric" | "slate" | "danger";
export const STATE_TONE: Record<ConnectState, StateTone> = {
  available: "emerald",
  on_request: "amber",
  coming_soon: "violet",
  active: "electric",
  pending_setup: "amber",
  activating: "electric",
  not_eligible: "slate",
  incident: "danger",
};

/** Degradado de cada acceso del marketplace (líneas, paquetes y mis módulos). */
export const ACCESS_TONES = {
  connect: ["electric", "violet"],
  net: ["electric", "turquoise"],
  bundles: ["magenta", "violet"],
  mine: ["turquoise", "emerald"],
} as const satisfies Record<string, readonly [MarketTone, MarketTone]>;

/** Número de «páginas» de un carril (una página = el ancho visible). Nunca menos de 1. */
export function railPages(scrollWidth: number, clientWidth: number): number {
  if (!(clientWidth > 0) || !(scrollWidth > clientWidth + 1)) return 1;
  return Math.max(1, Math.ceil((scrollWidth - 1) / clientWidth));
}

/** Página visible de un carril; al final del desplazamiento, siempre la última. */
export function railPage(scrollLeft: number, scrollWidth: number, clientWidth: number): number {
  const pages = railPages(scrollWidth, clientWidth);
  if (pages === 1) return 0;
  if (scrollLeft + clientWidth >= scrollWidth - 2) return pages - 1;
  return Math.min(pages - 1, Math.max(0, Math.round(scrollLeft / clientWidth)));
}

/** Posición de la página `page` de un carril (acotada a su recorrido). */
export function railOffset(page: number, scrollWidth: number, clientWidth: number): number {
  const max = Math.max(0, scrollWidth - clientWidth);
  return Math.min(max, Math.max(0, page * clientWidth));
}
