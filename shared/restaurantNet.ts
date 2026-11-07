/**
 * Restaurant Net · sala, carta y comandas — lógica pura compartida por el servidor (server/restaurantNetDb.ts) y el
 * panel (client/src/pages/admin/restaurantNet/). Sin base de datos ni React.
 *
 * Reglas:
 *  - Los precios de la carta llevan el IVA incluido (como el TPV del Core); el desglose por tipo sale de las líneas no
 *    anuladas, redondeado al céntimo por tipo y con base + cuota = total.
 *  - El estado de una mesa no se guarda: libre, ocupada o «pide la cuenta» según su comanda abierta; una mesa unida
 *    muestra el de su mesa principal.
 *  - Unir mesas: la secundaria pasa a la principal; si la secundaria tenía platos, se mueven a la comanda de la
 *    principal (o su comanda pasa a la principal si esta no tenía).
 */

export const RESTAURANT_NET_CAPABILITY = "restaurant-net";

export const ROOM_KINDS = ["salon", "terraza", "barra", "eventos", "otro"] as const;
export type RoomKind = (typeof ROOM_KINDS)[number];
export const ROOM_KIND_LABELS: Record<RoomKind, string> = {
  salon: "Salón",
  terraza: "Terraza",
  barra: "Barra",
  eventos: "Eventos",
  otro: "Otra",
};

export const TABLE_SHAPES = ["square", "round", "rect"] as const;
export type TableShape = (typeof TABLE_SHAPES)[number];
export const TABLE_SHAPE_LABELS: Record<TableShape, string> = { square: "Cuadrada", round: "Redonda", rect: "Rectangular" };

/** Plano de una sala, en puntos (se escala al ancho de la pantalla). */
export const FLOOR_W = 1000;
export const FLOOR_H = 640;

/** `paying`: el cobro está en curso en el TPV (la comanda no admite cambios hasta que termina o falla). */
export const ORDER_STATUSES = ["open", "bill_requested", "paying", "paid", "cancelled"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];
export const OPEN_ORDER_STATUSES: readonly OrderStatus[] = ["open", "bill_requested", "paying"];
export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  open: "Abierta",
  bill_requested: "Pide la cuenta",
  paying: "Cobrando",
  paid: "Cobrada",
  cancelled: "Cerrada sin cobro",
};

export const ITEM_STATUSES = ["pending", "sent", "preparing", "ready", "served", "void"] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number];

/** Tipos de IVA de la carta (hostelería: 10 % habitual; 21 % bebidas alcohólicas en algunos casos; 4 % y 0 %). */
export const MENU_TAX_RATES = [10, 21, 4, 0] as const;
export const DEFAULT_MENU_TAX_RATE = 10;

/** Los 14 alérgenos de declaración obligatoria (Reglamento UE 1169/2011). */
export const ALLERGENS = [
  { key: "gluten", label: "Gluten" },
  { key: "crustaceos", label: "Crustáceos" },
  { key: "huevos", label: "Huevos" },
  { key: "pescado", label: "Pescado" },
  { key: "cacahuetes", label: "Cacahuetes" },
  { key: "soja", label: "Soja" },
  { key: "lacteos", label: "Lácteos" },
  { key: "frutos_cascara", label: "Frutos de cáscara" },
  { key: "apio", label: "Apio" },
  { key: "mostaza", label: "Mostaza" },
  { key: "sesamo", label: "Sésamo" },
  { key: "sulfitos", label: "Sulfitos" },
  { key: "altramuces", label: "Altramuces" },
  { key: "moluscos", label: "Moluscos" },
] as const;
export type AllergenKey = (typeof ALLERGENS)[number]["key"];
export const ALLERGEN_KEYS: readonly string[] = ALLERGENS.map((a) => a.key);
export const ALLERGEN_LABEL: Record<string, string> = Object.fromEntries(ALLERGENS.map((a) => [a.key, a.label]));

/** Solo las claves conocidas, sin repetir y en el orden oficial. */
export function normalizeAllergens(list: readonly string[] | null | undefined): AllergenKey[] {
  const set = new Set(list ?? []);
  return ALLERGENS.filter((a) => set.has(a.key)).map((a) => a.key);
}

export const PAYMENT_METHODS = ["cash", "card", "bizum", "other"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = { cash: "Efectivo", card: "Tarjeta", bizum: "Bizum", other: "Otro" };

export const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

export const formatEur = (n: number | string | null | undefined): string =>
  (Number(n) || 0).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";

// ─── Totales e IVA ───────────────────────────────────────────────────────────

export interface OrderLine {
  quantity: number;
  unitPrice: number | string;
  taxRate: number | string | null | undefined;
  status: string;
}

export interface TaxLine {
  rate: number;
  base: number;
  amount: number;
}

export interface OrderTotals {
  /** Importe con IVA de las líneas no anuladas. */
  total: number;
  /** Base imponible (suma de las bases del desglose). */
  subtotal: number;
  taxAmount: number;
  /** Desglose por tipo de IVA, de mayor a menor. */
  taxBreakdown: TaxLine[];
  /** Unidades vivas (no anuladas). */
  units: number;
}

export const lineAmount = (l: Pick<OrderLine, "quantity" | "unitPrice">): number => round2((Number(l.unitPrice) || 0) * (Number(l.quantity) || 0));

/** Totales de una comanda: precios con IVA incluido; las líneas anuladas no cuentan. */
export function orderTotals(lines: readonly OrderLine[]): OrderTotals {
  const byRate = new Map<number, number>();
  let units = 0;
  for (const l of lines) {
    if (l.status === "void") continue;
    const rate = Number(l.taxRate ?? DEFAULT_MENU_TAX_RATE);
    const r = Number.isFinite(rate) && rate >= 0 ? rate : DEFAULT_MENU_TAX_RATE;
    byRate.set(r, round2((byRate.get(r) ?? 0) + lineAmount(l)));
    units += Number(l.quantity) || 0;
  }
  const taxBreakdown: TaxLine[] = Array.from(byRate.entries())
    .filter(([, gross]) => gross !== 0)
    .sort((a, b) => b[0] - a[0])
    .map(([rate, gross]) => {
      const base = round2(gross / (1 + rate / 100));
      return { rate, base, amount: round2(gross - base) };
    });
  const total = round2(Array.from(byRate.values()).reduce((s, g) => s + g, 0));
  const subtotal = round2(taxBreakdown.reduce((s, t) => s + t.base, 0));
  return { total, subtotal, taxAmount: round2(total - subtotal), taxBreakdown, units };
}

// ─── Estado de las mesas ─────────────────────────────────────────────────────

export type TableState = "libre" | "ocupada" | "cuenta";
export const TABLE_STATE_LABELS: Record<TableState, string> = { libre: "Libre", ocupada: "Ocupada", cuenta: "Pide la cuenta" };

export interface FloorTable {
  id: number;
  mergedInto: number | null;
}
export interface FloorOrder {
  id: number;
  tableId: number | null;
  status: string;
}

/** Mesa que lleva la comanda: la principal si está unida. */
export const hostTableId = (t: FloorTable): number => t.mergedInto ?? t.id;

/** Estado de cada mesa y comanda que la ocupa (las unidas, la de su principal). */
export function tableStates(tables: readonly FloorTable[], orders: readonly FloorOrder[]): Map<number, { state: TableState; orderId: number | null }> {
  const open = new Map<number, FloorOrder>();
  for (const o of orders) if (o.tableId != null && (OPEN_ORDER_STATUSES as readonly string[]).includes(o.status)) open.set(o.tableId, o);
  const out = new Map<number, { state: TableState; orderId: number | null }>();
  for (const t of tables) {
    const o = open.get(hostTableId(t));
    out.set(t.id, o ? { state: o.status === "open" ? "ocupada" : "cuenta", orderId: o.id } : { state: "libre", orderId: null });
  }
  return out;
}

// ─── Unir y separar mesas ────────────────────────────────────────────────────

export interface MergeTable {
  id: number;
  restaurantId: number;
  mergedInto: number | null;
  isActive: boolean;
}

/** Motivo por el que no se pueden unir (null = se puede). `hasChildren`: la secundaria ya es principal de otras. */
export function mergeProblem(primary: MergeTable | null, secondary: MergeTable | null, secondaryHasChildren: boolean): string | null {
  if (!primary || !secondary) return "No encontramos una de las mesas.";
  if (primary.id === secondary.id) return "Elige dos mesas distintas.";
  if (primary.restaurantId !== secondary.restaurantId) return "Las mesas son de restaurantes distintos.";
  if (!primary.isActive || !secondary.isActive) return "Una de las mesas está archivada.";
  if (primary.mergedInto != null) return "La mesa principal ya está unida a otra: elige su mesa principal.";
  if (secondary.mergedInto != null) return "Esa mesa ya está unida a otra. Sepárala antes.";
  if (secondaryHasChildren) return "Esa mesa ya tiene otras unidas. Une las demás a la principal o sepáralas antes.";
  return null;
}

/**
 * Qué hacer con las comandas al unir: «move» (los platos de la secundaria pasan a la comanda de la principal y la
 * secundaria se cierra), «retable» (la comanda de la secundaria pasa a la principal), «cancelEmpty» (la secundaria no
 * tenía platos: se cierra) o «none».
 */
export function mergePlan(primaryOrderId: number | null, secondaryOrderId: number | null, secondaryLiveItems: number): "move" | "retable" | "cancelEmpty" | "none" {
  if (secondaryOrderId == null) return "none";
  if (secondaryLiveItems === 0) return "cancelEmpty";
  return primaryOrderId != null ? "move" : "retable";
}

// ─── Cobro ───────────────────────────────────────────────────────────────────

/** Clave de idempotencia del cobro de una comanda en el TPV (formato de tpvSaleIdempotency: 8–64, [A-Za-z0-9_-]). */
export const checkoutIdempotencyKey = (orderId: number): string => `rnet-order-${orderId}`;

/** Motivo por el que los pagos no cuadran con el total (null = cuadran). */
export function paymentsProblem(total: number, payments: ReadonlyArray<{ amount: number }>): string | null {
  if (total <= 0) return "La comanda no tiene importe que cobrar. Si no van a pagar nada, libera la mesa.";
  if (!payments.length) return "Indica cómo paga el cliente.";
  if (payments.some((p) => !(p.amount > 0))) return "Cada pago debe tener un importe mayor que cero.";
  const paid = round2(payments.reduce((s, p) => s + p.amount, 0));
  if (Math.abs(paid - total) > 0.009) return `Los pagos (${formatEur(paid)}) no coinciden con el total (${formatEur(total)}).`;
  return null;
}

/** Fecha local de Madrid (AAAA-MM-DD) para las reservas del día. */
export function madridToday(now = new Date()): string {
  return now.toLocaleDateString("en-CA", { timeZone: "Europe/Madrid" });
}
