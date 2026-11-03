/**
 * Inventario de la empresa (capacidad Business `inventory-basic`): existencias en unidades de productos físicos o
 * artículos del catálogo, por sede, con historial de movimientos. Lógica pura (sin BD ni React): la usan el servidor
 * (server/inventoryDb.ts), el panel y las pruebas.
 *
 *  - Solo cuentan los productos marcados como «inventariables» (un producto entero o una de sus variantes). Lo no
 *    inventariable funciona exactamente igual que siempre: ni se descuenta ni se bloquea.
 *  - No son plazas: la capacidad de experiencias, horarios, spa u hotel sigue en sus módulos.
 *  - Sede: NULL = sede principal (como cajas y ventas del TPV).
 */

export const INVENTORY_CAPABILITY = "inventory-basic";

/** Qué hacer al vender más de lo que hay. */
export const OVERSELL_POLICIES = ["block", "allow"] as const;
export type OversellPolicy = (typeof OVERSELL_POLICIES)[number];
export const OVERSELL_LABELS: Record<OversellPolicy, string> = {
  block: "Bloquear la venta sin existencias",
  allow: "Permitir la venta con aviso",
};

export const MOVEMENT_KINDS = ["entrada", "venta", "devolucion", "ajuste", "traspaso_salida", "traspaso_entrada"] as const;
export type MovementKind = (typeof MOVEMENT_KINDS)[number];
export const MOVEMENT_LABELS: Record<MovementKind, string> = {
  entrada: "Entrada",
  venta: "Venta",
  devolucion: "Devolución o anulación",
  ajuste: "Ajuste manual",
  traspaso_salida: "Traspaso (salida)",
  traspaso_entrada: "Traspaso (entrada)",
};

/** Documento que origina un movimiento. */
export const SOURCE_LABELS: Record<string, string> = {
  tpv_sale: "Venta del TPV",
  reservation: "Pedido de la tienda online",
  manual: "Panel de inventario",
  transfer: "Traspaso entre sedes",
};

export const QTY_MAX = 1_000_000;
export const REASON_MAX = 300;
export const REFERENCE_MAX = 100;
/** Clave de un cambio hecho desde el panel (la genera el navegador; repetirla no duplica el movimiento). */
export const OPERATION_KEY_RE = /^[A-Za-z0-9_-]{8,64}$/;

/** Fila de existencias de un artículo en una sede. */
export interface StockLevel {
  siteId: string;
  onHand: number;
  /** Mínimo propio de la sede (null = el del artículo). */
  minStock: number | null;
}

/** Mínimo de alerta efectivo de una sede. */
export function effectiveMin(level: Pick<StockLevel, "minStock">, itemMin: number): number {
  return level.minStock ?? itemMin;
}

/** ¿Hay que avisar? Por debajo o en el mínimo (si hay mínimo) o en negativo. */
export function isLowStock(onHand: number, min: number): boolean {
  return onHand < 0 || (min > 0 && onHand <= min);
}

export interface SaleLine {
  productId: number;
  variantId?: number | null;
  quantity: number;
}

export interface TrackedItem {
  id: number;
  productId: number;
  variantId: number;
  policy: OversellPolicy;
}

/**
 * Artículo de inventario de una línea de venta: el de su variante si se controla por variante; si no, el del producto
 * entero. null = no inventariable (la línea se vende como siempre).
 */
export function itemForLine<T extends TrackedItem>(line: SaleLine, items: readonly T[]): T | null {
  const v = line.variantId && line.variantId > 0 ? line.variantId : 0;
  if (v) {
    const byVariant = items.find((i) => i.productId === line.productId && i.variantId === v);
    if (byVariant) return byVariant;
  }
  return items.find((i) => i.productId === line.productId && i.variantId === 0) ?? null;
}

/** Unidades pedidas por artículo (varias líneas del mismo artículo se suman). */
export function demandByItem<T extends TrackedItem>(lines: readonly SaleLine[], items: readonly T[]): Map<number, { item: T; quantity: number }> {
  const out = new Map<number, { item: T; quantity: number }>();
  for (const l of lines) {
    const item = itemForLine(l, items);
    if (!item || !(l.quantity > 0)) continue;
    const prev = out.get(item.id);
    out.set(item.id, { item, quantity: (prev?.quantity ?? 0) + Math.trunc(l.quantity) });
  }
  return out;
}

/** Mensaje de venta bloqueada por falta de existencias. */
export function outOfStockMessage(name: string, available: number): string {
  const n = Math.max(0, available);
  return n === 0
    ? `«${name}» no tiene existencias en esta sede. No se puede vender hasta que entren unidades.`
    : `«${name}» solo tiene ${n} ${n === 1 ? "unidad" : "unidades"} en esta sede. Reduce la cantidad para continuar.`;
}

/** Nombre visible de un artículo. */
export function itemLabel(title: string | null | undefined, variantName: string | null | undefined, productId: number): string {
  const base = title?.trim() || `Producto #${productId}`;
  return variantName?.trim() ? `${base} · ${variantName.trim()}` : base;
}

// ─── Formularios del panel ───────────────────────────────────────────────────

export function validateQuantity(q: unknown, { allowZero = false, allowNegative = false } = {}): string | null {
  if (typeof q !== "number" || !Number.isInteger(q)) return "Indica un número entero de unidades.";
  if (!allowNegative && q < 0) return "La cantidad no puede ser negativa.";
  if (!allowZero && q === 0) return "La cantidad no puede ser cero.";
  if (Math.abs(q) > QTY_MAX) return "Cantidad demasiado grande.";
  return null;
}

// ─── CSV (separador «;», UTF-8 con BOM para que Excel lea las tildes) ──────────

/** Celda de texto segura: entre comillas y sin fórmulas (lo que empieza por = + - @ se prefija con '). */
export function csvText(v: string | null | undefined): string {
  const raw = v ?? "";
  const s = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return `"${s.replace(/"/g, '""')}"`;
}

export function csvDocument(header: string[], rows: string[][]): string {
  return "﻿" + [header.map(csvText).join(";"), ...rows.map((r) => r.join(";"))].join("\r\n") + "\r\n";
}

export function madridDateTime(ms: number): string {
  return new Intl.DateTimeFormat("es-ES", { timeZone: "Europe/Madrid", dateStyle: "short", timeStyle: "short" }).format(new Date(ms));
}

export interface StockCsvRow {
  label: string;
  siteName: string;
  onHand: number;
  min: number;
  policy: OversellPolicy;
}

export function stockCsv(rows: readonly StockCsvRow[]): string {
  return csvDocument(
    ["Artículo", "Sede", "Existencias", "Mínimo", "Alerta", "Venta sin existencias"],
    rows.map((r) => [csvText(r.label), csvText(r.siteName), String(r.onHand), String(r.min), csvText(isLowStock(r.onHand, r.min) ? "Sí" : "No"), csvText(r.policy === "block" ? "Bloquear" : "Permitir")]),
  );
}

export interface MovementCsvRow {
  createdAt: number;
  label: string;
  siteName: string;
  kind: MovementKind;
  quantity: number;
  balanceAfter: number | null;
  reason: string | null;
  source: string;
  userName: string | null;
  shortfall: boolean;
}

export function movementsCsv(rows: readonly MovementCsvRow[]): string {
  return csvDocument(
    ["Fecha", "Artículo", "Sede", "Movimiento", "Cantidad", "Existencias después", "Motivo", "Documento", "Usuario", "Vendido sin existencias"],
    rows.map((r) => [
      csvText(madridDateTime(r.createdAt)),
      csvText(r.label),
      csvText(r.siteName),
      csvText(MOVEMENT_LABELS[r.kind] ?? r.kind),
      String(r.quantity),
      r.balanceAfter == null ? "" : String(r.balanceAfter),
      csvText(r.reason),
      csvText(r.source),
      csvText(r.userName),
      csvText(r.shortfall ? "Sí" : "No"),
    ]),
  );
}
