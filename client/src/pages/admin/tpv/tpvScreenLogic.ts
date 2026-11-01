/**
 * Lógica pura de la pantalla de venta del TPV (sin React: la usan la pantalla y las pruebas).
 */
import { randomId } from "@shared/randomId";

export type ProductKind = "experience" | "pack" | "spa" | "hotel" | "restaurant" | "extra" | "legoPack";

export interface TpvFilter {
  /** "all", un tipo de producto o "cat:<id>" (categoría propia de la empresa). */
  key: string;
  label: string;
}

/** Nombres de la instalación original (modo single y empresas sin licencias por capacidad). */
export const LEGACY_TYPE_LABELS: Record<string, string> = {
  experience: "Experiencia",
  pack: "Pack",
  spa: "SPA",
  hotel: "Hotel",
  restaurant: "Restaurante",
  extra: "Extra",
  legoPack: "Lego Pack",
};

/** Nombres genéricos para una pyme (lo sectorial solo aparece si lo tiene contratado). */
export const LICENSED_TYPE_LABELS: Record<string, string> = {
  experience: "Producto",
  spa: "Tratamientos",
  hotel: "Alojamiento",
  extra: "Concepto libre",
};

interface CatalogLike {
  licensed?: boolean;
  categories?: Array<{ id: number; name: string }>;
  experiences?: unknown[];
  packs?: unknown[];
  spa?: unknown[];
  hotel?: unknown[];
  legoPacks?: unknown[];
}

/**
 * Filtros de la rejilla.
 *  - Instalación original: los de siempre (Experiencia, Pack, SPA, Hotel, Lego Pack).
 *  - Pyme: sus categorías con productos y, de lo sectorial contratado, solo lo que tenga algo a la venta.
 */
export function buildTpvFilters(catalog: CatalogLike | undefined | null): TpvFilter[] {
  const all = { key: "all", label: "Todos" };
  if (!catalog?.licensed) {
    return [all, ...(["experience", "pack", "spa", "hotel", "legoPack"] as const).map((k) => ({ key: k, label: LEGACY_TYPE_LABELS[k] }))];
  }
  const out: TpvFilter[] = [all];
  for (const c of catalog.categories ?? []) out.push({ key: `cat:${c.id}`, label: c.name });
  if ((catalog.spa?.length ?? 0) > 0) out.push({ key: "spa", label: LICENSED_TYPE_LABELS.spa });
  if ((catalog.hotel?.length ?? 0) > 0) out.push({ key: "hotel", label: LICENSED_TYPE_LABELS.hotel });
  return out;
}

export function matchesTpvFilter(p: { productType: string; categoryId?: number | null }, filter: string): boolean {
  if (filter === "all") return true;
  if (filter.startsWith("cat:")) return p.productType === "experience" && p.categoryId === Number(filter.slice(4));
  return p.productType === filter;
}

/** Nombre del tipo para la etiqueta de una tarjeta. En una pyme, la categoría del producto si la tiene. */
export function productBadge(
  p: { productType: string; categoryId?: number | null },
  licensed: boolean,
  categories: Array<{ id: number; name: string }> = [],
): string {
  if (!licensed) return LEGACY_TYPE_LABELS[p.productType] ?? "";
  if (p.productType === "experience") return categories.find((c) => c.id === p.categoryId)?.name ?? LICENSED_TYPE_LABELS.experience;
  return LICENSED_TYPE_LABELS[p.productType] ?? "";
}

export const LAST_REGISTER_KEY = "tpv:lastRegisterId";

/**
 * Caja con la que empezar: la última elegida si sigue existiendo; si no, la única que haya; si no, ninguna (se pide
 * elegir). Con una sola caja abierta y varias cerradas, la abierta.
 */
export function pickInitialRegister(
  registers: Array<{ id: number; openSession: unknown | null }>,
  lastId: number | null,
): number | null {
  if (registers.length === 0) return null;
  if (lastId !== null && registers.some((r) => r.id === lastId)) return lastId;
  if (registers.length === 1) return registers[0].id;
  const open = registers.filter((r) => r.openSession);
  return open.length === 1 ? open[0].id : null;
}

/**
 * Clave de un intento de cobro (el servidor la usa para no grabar dos veces la misma venta). La pantalla genera una
 * por carrito: un doble clic o un reintento del MISMO carrito reenvía la misma; un carrito distinto, otra.
 */
export function newSaleAttemptKey(rand: () => string = () => randomId()): string {
  return rand().replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64);
}

/**
 * Cobro en efectivo (M6): antes de cobrar se indica lo que entrega el cliente y se ve el cambio. Importes en euros
 * redondeados al céntimo.
 */
const cents = (n: number) => Math.round(n * 100);

/** Lee un importe escrito en la caja («20», «20,50», «20.5»); vacío o no válido: null. */
export function parseTendered(input: string): number | null {
  const s = input.trim().replace(/\s|€/g, "");
  if (!s) return null;
  // «1.234,50» (miles con punto) o «20,5»/«20.5»
  const normal = /,/.test(s) ? s.replace(/\./g, "").replace(",", ".") : s;
  if (!/^\d+(\.\d{0,2})?$/.test(normal)) return null;
  const n = Number(normal);
  return Number.isFinite(n) ? cents(n) / 100 : null;
}

/** ¿Llega lo entregado para cobrar el total? */
export function canChargeCash(total: number, tendered: number | null): boolean {
  return tendered !== null && cents(tendered) >= cents(total) && cents(total) > 0;
}

/** Cambio a devolver (nunca negativo). */
export function cashChange(total: number, tendered: number | null): number {
  if (tendered === null) return 0;
  return Math.max(0, cents(tendered) - cents(total)) / 100;
}

/** Atajos de importe entregado: el exacto y los billetes habituales que lo cubren (sin repetir, de menor a mayor). */
export function quickTenders(total: number): number[] {
  const t = cents(total) / 100;
  if (t <= 0) return [];
  const out = new Set<number>([t]);
  for (const step of [5, 10, 20, 50, 100]) {
    const v = Math.ceil(t / step) * step;
    if (v > t) out.add(v);
  }
  return Array.from(out).sort((a, b) => a - b).slice(0, 5);
}
