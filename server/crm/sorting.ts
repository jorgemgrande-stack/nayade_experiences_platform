/**
 * Ordenación de los listados del CRM (empresas, leads, contactos, contratos).
 *
 * El cliente solo elige una clave de una lista blanca por listado; cada clave se mapea a un campo
 * fijo del registro con su forma de comparar (texto, número o enumerado con orden lógico). Nunca se
 * usa el texto recibido como nombre de campo. Los nulos van siempre al final y el desempate es por
 * `id` en la misma dirección, para que la paginación sea estable.
 */
import { COMPANY_STATUSES, LEAD_PRIORITIES, LEAD_STATUSES } from "./types";

export const SORT_DIRS = ["asc", "desc"] as const;
export type SortDir = (typeof SORT_DIRS)[number];

type Kind = { type: "text" } | { type: "number" } | { type: "enum"; order: readonly string[] };
interface SortField {
  /** Campo del registro que se compara. */
  field: string;
  kind: Kind;
}

const text: Kind = { type: "text" };
const num: Kind = { type: "number" };
const enumOf = (order: readonly string[]): Kind => ({ type: "enum", order });

export const COMPANY_SORT = {
  name: { field: "name", kind: text },
  createdAt: { field: "createdAt", kind: num },
  updatedAt: { field: "updatedAt", kind: num },
  city: { field: "city", kind: text },
  lifecycle: { field: "lifecycle", kind: enumOf(["prospect", "customer", "tenant"]) },
  status: { field: "status", kind: enumOf(COMPANY_STATUSES) },
} as const satisfies Record<string, SortField>;

export const LEAD_SORT = {
  name: { field: "name", kind: text },
  createdAt: { field: "createdAt", kind: num },
  updatedAt: { field: "updatedAt", kind: num },
  status: { field: "status", kind: enumOf(LEAD_STATUSES) },
  priority: { field: "priority", kind: enumOf(LEAD_PRIORITIES) },
  source: { field: "source", kind: text },
} as const satisfies Record<string, SortField>;

export const CONTACT_SORT = {
  name: { field: "name", kind: text },
  createdAt: { field: "createdAt", kind: num },
  updatedAt: { field: "updatedAt", kind: num },
} as const satisfies Record<string, SortField>;

export const CONTRACT_SORT = {
  reference: { field: "reference", kind: text },
  createdAt: { field: "createdAt", kind: num },
  updatedAt: { field: "updatedAt", kind: num },
  renewalDate: { field: "renewalDate", kind: num },
  amount: { field: "amountCents", kind: num },
  status: { field: "status", kind: enumOf(["draft", "sent", "signed", "active", "cancelled"]) },
} as const satisfies Record<string, SortField>;

export type CompanySortKey = keyof typeof COMPANY_SORT;
export type LeadSortKey = keyof typeof LEAD_SORT;
export type ContactSortKey = keyof typeof CONTACT_SORT;
export type ContractSortKey = keyof typeof CONTRACT_SORT;

/** Claves admitidas de una tabla de ordenación, en forma de tupla para `z.enum`. */
export const sortKeys = <M extends Record<string, SortField>>(m: M) => Object.keys(m) as [keyof M & string, ...(keyof M & string)[]];

export interface SortOpts<K extends string = string> {
  sort?: K;
  dir?: SortDir;
}

const collator = new Intl.Collator("es", { sensitivity: "base", numeric: true });

/** Valor comparable o null (los nulos y vacíos van al final en ambas direcciones). */
function rank(v: unknown, kind: Kind): number | string | null {
  if (v === null || v === undefined || v === "") return null;
  if (kind.type === "number") return typeof v === "number" && Number.isFinite(v) ? v : null;
  if (kind.type === "enum") {
    const i = kind.order.indexOf(String(v));
    return i === -1 ? kind.order.length : i;
  }
  return String(v);
}

/**
 * Comparador para una clave de la lista blanca. Devuelve null si no hay `sort` (o la clave no
 * está en la tabla), y entonces se mantiene el orden actual del listado.
 */
export function sortComparator<M extends Record<string, SortField>>(
  map: M,
  opts: SortOpts,
): ((a: object, b: object) => number) | null {
  if (!opts.sort || !Object.prototype.hasOwnProperty.call(map, opts.sort)) return null;
  const { field, kind } = map[opts.sort];
  const sign = opts.dir === "desc" ? -1 : 1;
  return (a, b) => {
    const va = rank((a as Record<string, unknown>)[field], kind);
    const vb = rank((b as Record<string, unknown>)[field], kind);
    if (va === null || vb === null) {
      if (va !== vb) return va === null ? 1 : -1;
    } else {
      const c = typeof va === "string" && typeof vb === "string" ? collator.compare(va, vb) : (va as number) - (vb as number);
      if (c !== 0) return sign * c;
    }
    return sign * ((a as { id: number }).id - (b as { id: number }).id);
  };
}

/** Ordena una copia de `rows` según `opts`; sin `sort` devuelve las filas tal cual. */
export function applySort<T extends { id: number }, M extends Record<string, SortField>>(rows: T[], map: M, opts: SortOpts): T[] {
  const cmp = sortComparator(map, opts);
  return cmp ? [...rows].sort(cmp) : rows;
}
