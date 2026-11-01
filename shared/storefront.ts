/**
 * Tienda online pública: qué ficha de producto se sirve y cómo se calcula lo que se añade al carrito.
 *
 *  - Ficha SECTORIAL (la de actividades de la instalación propia): sin licencias por capacidad, es decir, la
 *    instalación de una sola empresa o una empresa anterior al motor de licencias. Conserva fecha, personas,
 *    horarios y modalidades como siempre.
 *  - Ficha GENÉRICA (pyme con licencias por capacidad): nombre, imágenes, descripción, precio con IVA y dos
 *    decimales, variantes y cantidad desde 1. Solo pide fecha a un SERVICIO cuando la empresa tiene contratadas
 *    las reservas y citas (`bookings-generic`); nunca cifras de reseñas, seguro, cancelación ni dificultad que el
 *    producto no configure.
 *
 * Solo presentación y cálculo estimado: el importe real lo calcula siempre el servidor al pagar.
 */

export type StorefrontKind = "sector" | "generic";

export interface Storefront {
  kind: StorefrontKind;
  /** La empresa puede vender servicios con fecha (reservas y citas genéricas contratadas). */
  datedServices: boolean;
  /** Los correos de pedido llegan al comprador (no en la prueba gratuita). Sin dato: no se promete. */
  buyerEmails?: boolean;
}

export interface StorefrontInput {
  mode: "single" | "shadow" | "multi";
  /** Cómo licencia la empresa: por capacidad (pyme) o con el sistema anterior. */
  licensing: "legacy" | "capabilities";
  /** Capacidad visible (activa o en solo lectura). */
  can: (capabilityId: string) => boolean;
}

/** Capacidad que habilita la venta de servicios con fecha en la ficha genérica. */
export const DATED_SERVICES_CAPABILITY = "bookings-generic";

export function resolveStorefront(input: StorefrontInput): Storefront {
  if (input.mode !== "multi" || input.licensing !== "capabilities") return { kind: "sector", datedServices: true };
  return { kind: "generic", datedServices: input.can(DATED_SERVICES_CAPABILITY) };
}

/** Sin poder leer las licencias en multiempresa: ficha genérica sin fechas (nunca promesas de otra empresa). */
export const FALLBACK_GENERIC_STOREFRONT: Storefront = { kind: "generic", datedServices: false };

// ─── Rutas ───────────────────────────────────────────────────────────────────

export const SHOP_PATH = "/tienda";
export const SECTOR_LIST_PATH = "/experiencias";

export function productPath(slug: string, kind: StorefrontKind = "generic"): string {
  return `${kind === "generic" ? SHOP_PATH : SECTOR_LIST_PATH}/${encodeURIComponent(slug)}`;
}

/**
 * Dirección canónica de una ruta de catálogo según la ficha de la empresa: `null` si ya es la buena.
 * `/experiencias[/slug]` lleva a `/tienda[/slug]` en una pyme y al revés en la instalación sectorial.
 */
export function canonicalCatalogPath(path: string, kind: StorefrontKind): string | null {
  const m = /^\/(experiencias|tienda)(?:\/([^/?#]+))?\/?$/.exec(path);
  if (!m) return null;
  const want = kind === "generic" ? "tienda" : "experiencias";
  if (m[1] === want) return null;
  return m[2] ? `/${want}/${m[2]}` : `/${want}`;
}

// ─── Precio ──────────────────────────────────────────────────────────────────

const EUR = new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Importe en euros con dos decimales, formato es-ES («24,20 €»). `null` si no es un importe válido. */
export function formatEuros(value: unknown): string | null {
  const n = typeof value === "number" ? value : Number(value);
  if (value === null || value === undefined || value === "" || !Number.isFinite(n)) return null;
  // ` ` (espacio duro de Intl) se sustituye por uno normal para comparar y copiar sin sorpresas
  return EUR.format(roundCents(n)).replace(/ /g, " ");
}

export function roundCents(n: number): number {
  return Math.round(n * 100) / 100;
}

export interface VariantLike {
  id: number;
  name: string;
  priceModifier?: string | number | null;
  priceType?: string | null;
  isRequired?: boolean | null;
}

/**
 * Precio unitario de una variante, igual que el servidor al cobrar: `percentage` ajusta el precio base y el
 * resto sustituye el precio por el de la variante.
 */
export function variantUnitPrice(basePrice: number, variant: VariantLike | undefined | null): number {
  if (!variant) return roundCents(basePrice);
  const mod = Number(variant.priceModifier ?? 0);
  if (!Number.isFinite(mod)) return roundCents(basePrice);
  return roundCents(variant.priceType === "percentage" ? basePrice + (basePrice * mod) / 100 : mod);
}

/** Precio «desde» para la ficha: el menor entre el base y sus variantes con precio. */
export function fromPrice(basePrice: number, variants: VariantLike[]): number {
  const prices = variants.map((v) => variantUnitPrice(basePrice, v)).filter((p) => p > 0);
  return prices.length ? Math.min(...prices) : roundCents(basePrice);
}

// ─── Cantidad ────────────────────────────────────────────────────────────────

export const MAX_QUANTITY = 99;

/** Cantidad entera entre 1 y el máximo (el servidor admite hasta 100 por línea). */
export function clampQuantity(q: unknown, max: number = MAX_QUANTITY): number {
  const n = Math.floor(Number(q));
  const top = Math.max(1, Math.min(MAX_QUANTITY, Math.floor(max) || MAX_QUANTITY));
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n, top);
}

// ─── Fecha ───────────────────────────────────────────────────────────────────

export interface ProductLike {
  productType?: string | null;
}

/** La ficha genérica pide fecha solo a un servicio y solo si la empresa vende servicios con fecha. */
export function needsServiceDate(product: ProductLike, storefront: Storefront): boolean {
  if (storefront.kind === "sector") return true;
  return storefront.datedServices && product.productType === "actividad";
}

// ─── Línea de carrito ────────────────────────────────────────────────────────

export interface GenericCartInput {
  product: {
    id: number;
    title: string;
    slug: string;
    basePrice: string | number;
    coverImageUrl?: string | null;
    image1?: string | null;
    productType?: string | null;
  };
  variant?: VariantLike | null;
  quantity: number;
  date?: string | null;
  storefront: Storefront;
}

export type GenericCartResult =
  | { ok: true; line: GenericCartLine }
  | { ok: false; reason: "variant_required" | "date_required" | "no_price" };

export interface GenericCartLine {
  productId: number;
  productName: string;
  productSlug: string;
  productImage: string;
  bookingDate: string;
  people: number;
  minPersons: number;
  maxPersons: number;
  variantId?: number;
  variantName?: string;
  pricePerPerson: number;
  estimatedTotal: number;
  extras: never[];
  pricingType: "per_person";
}

/**
 * Línea del carrito actual para la ficha genérica: la cantidad viaja como «personas» (el carrito y el cobro la
 * multiplican por el precio unitario) y, sin servicio con fecha, la fecha va vacía. Sin descuentos propios del
 * producto: el cobro no los aplica, así que la ficha tampoco los promete (los códigos de descuento van al pagar).
 */
export function buildGenericCartLine(input: GenericCartInput, variants: VariantLike[] = []): GenericCartResult {
  const base = Number(input.product.basePrice);
  if (!Number.isFinite(base) || base <= 0) return { ok: false, reason: "no_price" };
  if (!input.variant && variants.some((v) => v.isRequired)) return { ok: false, reason: "variant_required" };
  const dated = needsServiceDate(input.product, input.storefront);
  const date = (input.date ?? "").trim();
  if (dated && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, reason: "date_required" };
  const unit = variantUnitPrice(base, input.variant);
  if (!(unit > 0)) return { ok: false, reason: "no_price" };
  const qty = clampQuantity(input.quantity);
  return {
    ok: true,
    line: {
      productId: input.product.id,
      productName: input.product.title,
      productSlug: input.product.slug,
      productImage: input.product.coverImageUrl || input.product.image1 || "",
      bookingDate: dated ? date : "",
      people: qty,
      minPersons: 1,
      maxPersons: MAX_QUANTITY,
      variantId: input.variant?.id,
      variantName: input.variant?.name,
      pricePerPerson: unit,
      estimatedTotal: roundCents(unit * qty),
      extras: [],
      pricingType: "per_person",
    },
  };
}
