/**
 * Inventario (Business, inventory-basic): lógica pura (shared/inventory.ts), licencia de rutas y menú, y la migración
 * aditiva. El comportamiento con MySQL real está en server/inventory.mysql.test.ts.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  csvText,
  demandByItem,
  effectiveMin,
  isLowStock,
  itemForLine,
  itemLabel,
  movementsCsv,
  outOfStockMessage,
  stockCsv,
  validateQuantity,
  type TrackedItem,
} from "../shared/inventory";
import { capabilityForProcedure } from "./_core/capabilities/routeGuard";
import { routeCapabilities, TASK_NAV } from "../shared/adminNav";
import { CAPABILITIES } from "./catalog/capabilities";
import { destructiveMigration } from "../scripts/deploy/esRailwayLib";
import { orderLineQuantity } from "./inventoryDb";

const items: TrackedItem[] = [
  { id: 1, productId: 10, variantId: 0, policy: "block" },
  { id: 2, productId: 10, variantId: 7, policy: "allow" },
  { id: 3, productId: 20, variantId: 0, policy: "block" },
];

describe("artículo de una línea de venta", () => {
  it("la variante controlada gana; si no, el producto entero; lo no inventariable, nada", () => {
    expect(itemForLine({ productId: 10, variantId: 7, quantity: 1 }, items)?.id).toBe(2);
    expect(itemForLine({ productId: 10, variantId: 8, quantity: 1 }, items)?.id).toBe(1);
    expect(itemForLine({ productId: 10, quantity: 1 }, items)?.id).toBe(1);
    expect(itemForLine({ productId: 20, variantId: 3, quantity: 1 }, items)?.id).toBe(3);
    expect(itemForLine({ productId: 99, quantity: 1 }, items)).toBeNull();
    expect(itemForLine({ productId: 30, variantId: 7, quantity: 1 }, items)).toBeNull();
  });
  it("varias líneas del mismo artículo se suman; las cantidades no positivas no cuentan", () => {
    const d = demandByItem([{ productId: 10, quantity: 2 }, { productId: 10, variantId: 9, quantity: 3 }, { productId: 10, variantId: 7, quantity: 1 }, { productId: 20, quantity: 0 }, { productId: 99, quantity: 5 }], items);
    expect(Array.from(d.entries()).map(([k, v]) => [k, v.quantity])).toEqual([[1, 5], [2, 1]]);
  });
});

describe("alertas y textos", () => {
  it("mínimo efectivo y alerta", () => {
    expect(effectiveMin({ minStock: null }, 4)).toBe(4);
    expect(effectiveMin({ minStock: 0 }, 4)).toBe(0);
    expect(isLowStock(4, 4)).toBe(true);
    expect(isLowStock(5, 4)).toBe(false);
    expect(isLowStock(0, 0)).toBe(false);
    expect(isLowStock(-1, 0)).toBe(true);
  });
  it("mensajes en español", () => {
    expect(outOfStockMessage("Camiseta", 0)).toMatch(/no tiene existencias/);
    expect(outOfStockMessage("Camiseta", 1)).toMatch(/solo tiene 1 unidad /);
    expect(outOfStockMessage("Camiseta", 3)).toMatch(/3 unidades/);
    expect(itemLabel("Camiseta", "Talla M", 1)).toBe("Camiseta · Talla M");
    expect(itemLabel(null, null, 5)).toBe("Producto #5");
  });
  it("cantidades", () => {
    expect(validateQuantity(3)).toBeNull();
    expect(validateQuantity(0)).not.toBeNull();
    expect(validateQuantity(-2)).not.toBeNull();
    expect(validateQuantity(-2, { allowNegative: true })).toBeNull();
    expect(validateQuantity(1.5)).not.toBeNull();
  });
  it("unidades de una línea de la tienda: unidades reservadas o personas", () => {
    expect(orderLineQuantity({ pricing_type: "per_unit", units_booked: 2, people: 8 })).toBe(2);
    expect(orderLineQuantity({ pricing_type: "per_person", units_booked: null, people: 3 })).toBe(3);
    expect(orderLineQuantity({ people: 0 })).toBe(1);
  });
});

describe("CSV", () => {
  it("celdas sin fórmulas, separador «;» y BOM", () => {
    expect(csvText("=SUMA(A1)")).toBe(`"'=SUMA(A1)"`);
    expect(csvText('di "hola"')).toBe(`"di ""hola"""`);
    const s = stockCsv([{ label: "Camiseta", siteName: "Centro", onHand: 2, min: 3, policy: "block" }]);
    expect(s.startsWith("﻿")).toBe(true);
    expect(s).toContain(`"Camiseta";"Centro";2;3;"Sí";"Bloquear"`);
    const m = movementsCsv([{ createdAt: Date.UTC(2026, 10, 3, 10), label: "Camiseta", siteName: "Centro", kind: "venta", quantity: -2, balanceAfter: 1, reason: null, source: "Venta del TPV · T-1", userName: "Ana", shortfall: false }]);
    expect(m).toContain(`"Venta";-2;1;"";"Venta del TPV · T-1";"Ana";"No"`);
  });
});

describe("licencia y menú", () => {
  it("las rutas del inventario exigen inventory-basic y la capacidad ya no está «planned»", () => {
    for (const p of ["inventory.overview", "inventory.receive", "inventory.transfer", "inventory.exportCsv"]) expect(capabilityForProcedure(p)).toBe("inventory-basic");
    expect(CAPABILITIES.find((c) => c.id === "inventory-basic")).toMatchObject({ tier: "business" });
    expect(CAPABILITIES.find((c) => c.id === "inventory-basic")?.technicalStatus).not.toBe("planned");
    expect(routeCapabilities("/admin/productos/inventario")).toEqual(["inventory-basic"]);
    const entry = TASK_NAV.flatMap((s) => s.items).find((i) => i.href === "/admin/productos/inventario");
    expect(entry).toMatchObject({ label: "Inventario", capabilities: ["inventory-basic"] });
  });
  it("las ventas, el TPV y la tienda siguen con sus licencias de siempre", () => {
    expect(capabilityForProcedure("tpv.createSale")).toBe("bill-cash");
    expect(capabilityForProcedure("reservations.cartCheckout")).toBe("shop-checkout");
  });
});

describe("migración 0025", () => {
  const dir = path.resolve(__dirname, "../db/migrations");
  it("es aditiva (ordinaria) y tiene reversión", () => {
    const up = fs.readFileSync(path.join(dir, "0025_inventory.sql"), "utf8");
    expect(destructiveMigration(up)).toBeNull();
    expect(fs.existsSync(path.join(dir, "0025_inventory.down.sql"))).toBe(true);
  });
});
