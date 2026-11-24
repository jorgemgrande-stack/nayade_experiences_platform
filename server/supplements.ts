/**
 * Suplementos opcionales de un producto (p. ej. la alimentación ayurvédica de los retiros de Quantum Soulrise).
 *
 * Modelo (sin tablas nuevas): un suplemento es una fila de `experience_variants` con `supplementGroup` informado
 * (migración 0091). Esas filas NUNCA son una opción del programa: no salen en la lista de opciones de la ficha, no
 * cuentan para el precio «desde», no se pueden elegir como modalidad y no se añaden solas a ningún total.
 *
 *  - Las filas que comparten `supplementGroup` son los TRAMOS de un mismo suplemento. Se distinguen por minQty/maxQty
 *    (p. ej. «individual»: 1–1 a 120 €; «desde 2»: mínimo 2 a 90 € por persona). El tramo lo decide SIEMPRE el servidor
 *    según el número de participantes: quien viaja solo no puede acogerse a la tarifa de grupo aunque envíe su id.
 *  - priceType «per_person»: el importe es por persona (× participantes). «fixed»: importe único por pedido.
 *    «percentage» no se admite en un suplemento (se rechaza). El importe sale de la BD, nunca del cliente.
 *  - Quien solicita o compra envía solo los ids de los suplementos que MARCA; sin ids, no hay suplemento.
 *
 * Funciones puras (sin BD): se prueban aisladas.
 */
import { eurosToCents, variantQuantityProblem } from "./shopCheckoutRules";

export interface SupplementVariant {
  id: number;
  name?: string | null;
  description?: string | null;
  priceModifier?: unknown;
  priceType?: string | null;
  minQty?: number | null;
  maxQty?: number | null;
  supplementGroup?: string | null;
}

export class SupplementError extends Error {}

export const isSupplementVariant = (v: { supplementGroup?: string | null } | null | undefined): boolean => !!v && typeof v.supplementGroup === "string" && v.supplementGroup.trim() !== "";

export interface SupplementLine {
  group: string;
  variantId: number;
  name: string;
  perPerson: boolean;
  /** Céntimos por persona (o por pedido si no es por persona) */
  unitCents: number;
  /** Unidades cobradas: participantes (por persona) o 1 */
  quantity: number;
  totalCents: number;
}

const eur = (cents: number) => `${(cents / 100).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

/**
 * Resuelve los suplementos MARCADOS para `people` participantes. `all` son las variantes vigentes del producto (con o sin
 * suplementos mezclados). Lanza SupplementError si un id no es un suplemento vigente de ESTE producto o si el grupo no
 * admite ese número de participantes.
 */
export function resolveSupplements(requestedIds: number[] | undefined | null, all: SupplementVariant[], people: number): SupplementLine[] {
  const ids = Array.from(new Set((requestedIds ?? []).filter((n) => Number.isInteger(n) && n > 0)));
  if (!ids.length) return [];
  if (!Number.isInteger(people) || people < 1) throw new SupplementError("Indica el número de participantes para añadir un suplemento.");
  const supplements = all.filter((v) => isSupplementVariant(v));
  const lines: SupplementLine[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    const picked = supplements.find((v) => v.id === id);
    if (!picked) throw new SupplementError("El suplemento elegido ya no está disponible. Vuelve a elegirlo.");
    const group = String(picked.supplementGroup).trim();
    if (seen.has(group)) continue; // dos tramos del mismo suplemento = un solo suplemento
    seen.add(group);
    // Tramo que admite este nº de participantes; si hay varios, el más específico (mayor mínimo)
    const fitting = supplements
      .filter((v) => String(v.supplementGroup).trim() === group && !variantQuantityProblem(v, people))
      .sort((a, b) => (b.minQty ?? 0) - (a.minQty ?? 0) || a.id - b.id);
    const tier = fitting[0];
    if (!tier) throw new SupplementError(`«${picked.name ?? "El suplemento"}» no está disponible para ${people} ${people === 1 ? "participante" : "participantes"}.`);
    if (tier.priceType !== "per_person" && tier.priceType !== "fixed") throw new SupplementError(`El suplemento «${tier.name ?? ""}» no tiene un importe válido.`);
    const unitCents = eurosToCents(String(tier.priceModifier ?? "0"));
    if (!Number.isInteger(unitCents) || unitCents <= 0) throw new SupplementError(`El suplemento «${tier.name ?? ""}» no tiene un importe válido.`);
    const perPerson = tier.priceType === "per_person";
    const quantity = perPerson ? people : 1;
    lines.push({ group, variantId: tier.id, name: String(tier.name ?? "Suplemento"), perPerson, unitCents, quantity, totalCents: unitCents * quantity });
  }
  return lines;
}

export const supplementsTotalCents = (lines: SupplementLine[]): number => lines.reduce((s, l) => s + l.totalCents, 0);

/** Texto de una línea para el mensaje de la solicitud, el pedido o el presupuesto. Nunca mezcla el importe con el del programa. */
export function supplementLineText(l: SupplementLine): string {
  return l.perPerson
    ? `${l.name}: ${eur(l.unitCents)} por persona × ${l.quantity} = ${eur(l.totalCents)}`
    : `${l.name}: ${eur(l.totalCents)}`;
}

export interface SupplementOffer {
  group: string;
  name: string;
  description: string | null;
  tiers: Array<{ id: number; name: string; priceModifier: string; priceType: "fixed" | "per_person"; minQty: number | null; maxQty: number | null }>;
}

/** Suplementos ofrecidos de un producto, agrupados por tramos (para la ficha pública). Solo filas vigentes con importe válido. */
export function supplementOffers(all: SupplementVariant[]): SupplementOffer[] {
  const byGroup = new Map<string, SupplementVariant[]>();
  for (const v of all) {
    if (!isSupplementVariant(v)) continue;
    if (v.priceType !== "per_person" && v.priceType !== "fixed") continue;
    if (!(eurosToCents(String(v.priceModifier ?? "0")) > 0)) continue;
    const g = String(v.supplementGroup).trim();
    byGroup.set(g, [...(byGroup.get(g) ?? []), v]);
  }
  return Array.from(byGroup.entries()).map(([group, rows]) => {
    const sorted = [...rows].sort((a, b) => (a.minQty ?? 0) - (b.minQty ?? 0) || a.id - b.id);
    return {
      group,
      name: String(sorted[0].name ?? "Suplemento"),
      description: sorted[0].description ?? null,
      tiers: sorted.map((v) => ({ id: v.id, name: String(v.name ?? ""), priceModifier: String(v.priceModifier ?? "0"), priceType: v.priceType as "fixed" | "per_person", minQty: v.minQty ?? null, maxQty: v.maxQty ?? null })),
    };
  });
}
