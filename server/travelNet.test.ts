/**
 * Travel Net — lógica pura: márgenes (proveedor → sede → global → por defecto), precio por servicio en los tres modos,
 * líneas del presupuesto del Core (REAV o general), ciclo del expediente, máquina de estados de las operaciones,
 * adaptador manual y bonos.
 */
import { describe, it, expect } from "vitest";
import {
  conversionBlocker,
  fileNumber,
  fileTotals,
  marginRuleError,
  operationTransitionError,
  priceService,
  quoteLines,
  resolveMarginRule,
  servicesEditBlocker,
  type MarginRule,
} from "./travelNet/rules";
import { ManualSupplierAdapter, resolveSupplierAdapter } from "./travelNet/adapters";
import { voucherBlocker } from "./travelNet/service";

const rule = (scope: MarginRule["scope"], scopeKey: string, markupBp: number, commissionBp = 0, isActive = true): MarginRule => ({ scope, scopeKey, markupBp, commissionBp, isActive });

describe("márgenes comerciales", () => {
  const rules = [rule("global", "", 1500, 800), rule("sede", "madrid", 1200), rule("proveedor", "7", 3000, 1000), rule("proveedor", "8", 5000, 0, false)];
  it("gana la regla más concreta: proveedor → sede → global", () => {
    expect(resolveMarginRule(rules, { supplierId: 7, siteId: "madrid" })).toEqual({ markupBp: 3000, commissionBp: 1000, source: "proveedor" });
    expect(resolveMarginRule(rules, { supplierId: 9, siteId: "madrid" })).toEqual({ markupBp: 1200, commissionBp: 0, source: "sede" });
    expect(resolveMarginRule(rules, { supplierId: 9, siteId: null })).toEqual({ markupBp: 1500, commissionBp: 800, source: "global" });
  });
  it("una regla desactivada hereda del siguiente nivel; sin reglas, 20 % de recargo", () => {
    expect(resolveMarginRule(rules, { supplierId: 8, siteId: null }).source).toBe("global");
    expect(resolveMarginRule([], { supplierId: 1, siteId: "x" })).toEqual({ markupBp: 2000, commissionBp: 0, source: "defecto" });
  });
  it("valida los porcentajes", () => {
    expect(marginRuleError({ markupBp: -1, commissionBp: 0 })).toMatch(/recargo/);
    expect(marginRuleError({ markupBp: 20001, commissionBp: 0 })).toMatch(/recargo/);
    expect(marginRuleError({ markupBp: 1000, commissionBp: 10001 })).toMatch(/comisión/);
    expect(marginRuleError({ markupBp: 1000, commissionBp: 1500 })).toBeNull();
  });
});

describe("precio por servicio", () => {
  const r = { markupBp: 2500, commissionBp: 1200, source: "global" as const };
  it("neto: PVP = neto × (1 + recargo)", () => {
    expect(priceService({ mode: "neto", amountCents: 10000, rule: r })).toMatchObject({ netCents: 10000, sellingCents: 12500, marginCents: 2500, marginBp: 2000, markupBp: 2500, commissionBp: null, ruleSource: "global" });
  });
  it("comisión: el proveedor fija el PVP; coste = PVP × (1 − comisión)", () => {
    expect(priceService({ mode: "comision", amountCents: 20000, rule: r })).toMatchObject({ netCents: 17600, sellingCents: 20000, marginCents: 2400, commissionBp: 1200, markupBp: null });
  });
  it("manual: PVP y coste a mano, sin regla", () => {
    expect(priceService({ mode: "manual", amountCents: 9000, netCents: 6000, rule: r })).toMatchObject({ netCents: 6000, sellingCents: 9000, marginCents: 3000, ruleSource: "manual" });
    expect(priceService({ mode: "manual", amountCents: -5, rule: r })).toMatchObject({ netCents: 0, sellingCents: 0, marginBp: 0 });
  });
  it("totales del expediente", () => {
    expect(fileTotals([{ netCents: 10000, sellingCents: 12500 }, { netCents: 17600, sellingCents: 20000 }])).toEqual({ netCents: 27600, sellingCents: 32500, marginCents: 4900, marginBp: 1508 });
    expect(fileTotals([])).toEqual({ netCents: 0, sellingCents: 0, marginCents: 0, marginBp: 0 });
  });
});

describe("líneas del presupuesto del Core", () => {
  const services = [
    { kind: "alojamiento", title: "Hotel centro 3 noches", quantity: 1, sellingCents: 45000, serviceDate: "2026-12-01" },
    { kind: "actividad", title: "Excursión", quantity: 2, sellingCents: 9000, serviceDate: null },
    { kind: "otro", title: "Sin precio", quantity: 1, sellingCents: 0, serviceDate: null },
  ];
  it("REAV: IVA dentro del margen (tipo 0 en la línea); sin coste ni margen", () => {
    const l = quoteLines(services, { regime: "reav", taxRateBp: 2100 });
    expect(l).toEqual([
      { description: "Alojamiento: Hotel centro 3 noches", quantity: 1, unitPrice: 450, total: 450, fiscalRegime: "reav", taxRate: 0, serviceDate: "2026-12-01" },
      { description: "Actividad: Excursión", quantity: 2, unitPrice: 45, total: 90, fiscalRegime: "reav", taxRate: 0 },
    ]);
    expect(JSON.stringify(l)).not.toMatch(/net|margen|coste/i);
  });
  it("régimen general: el tipo del expediente", () => {
    expect(quoteLines(services, { regime: "general", taxRateBp: 1000 }).map((x) => x.taxRate)).toEqual([10, 10]);
  });
});

describe("ciclo del expediente", () => {
  it("servicios editables mientras el presupuesto no se acepte", () => {
    expect(servicesEditBlocker("borrador", null)).toBeNull();
    expect(servicesEditBlocker("presupuestado", "enviado")).toBeNull();
    expect(servicesEditBlocker("presupuestado", "aceptado")).toMatch(/aceptó o pagó/);
    expect(servicesEditBlocker("presupuestado", "pagado")).toMatch(/aceptó o pagó/);
    expect(servicesEditBlocker("reservado", "aceptado")).toMatch(/reservado/);
    expect(servicesEditBlocker("cancelado", null)).toMatch(/cancelado/);
  });
  it("conversión en reserva: con presupuesto enviado (o aceptado o pagado) y servicios", () => {
    const f = { status: "presupuestado", quoteId: 5, services: 2 };
    expect(conversionBlocker(f, "enviado")).toBeNull();
    expect(conversionBlocker(f, "aceptado")).toBeNull();
    expect(conversionBlocker(f, "pagado")).toBeNull();
    expect(conversionBlocker(f, "borrador")).toMatch(/Envía el presupuesto/);
    expect(conversionBlocker(f, "rechazado")).toMatch(/rechazado/);
    expect(conversionBlocker({ ...f, quoteId: null }, null)).toMatch(/Genera primero/);
    expect(conversionBlocker({ ...f, services: 0 }, "enviado")).toMatch(/no tiene servicios/);
    expect(conversionBlocker({ ...f, status: "reservado" }, "aceptado")).toMatch(/ya está reservado/);
  });
  it("número de expediente", () => {
    expect(fileNumber(42, 2026)).toBe("EXP-2026-000042");
  });
});

describe("operaciones con proveedores", () => {
  it("transiciones válidas e inválidas", () => {
    expect(operationTransitionError("pending_submission", "submitted")).toBeNull();
    expect(operationTransitionError("submitted", "provider_confirmed")).toBeNull();
    expect(operationTransitionError("provider_confirmed", "consolidated", { locator: "ABC123" })).toBeNull();
    expect(operationTransitionError("provider_confirmed", "consolidated", { locator: " " })).toMatch(/localizador/);
    expect(operationTransitionError("pending_submission", "consolidated", { locator: "X" })).toMatch(/No se puede pasar/);
    expect(operationTransitionError("internally_cancelled", "submitted")).toMatch(/No se puede pasar/);
    expect(operationTransitionError("rara", "submitted")).toMatch(/desconocido/);
  });
  it("adaptador manual: deja la operación enviada y no cancela por su cuenta", async () => {
    const a = resolveSupplierAdapter("api");
    expect(a).toBeInstanceOf(ManualSupplierAdapter);
    expect((await a.submitBooking({} as never)).status).toBe("submitted");
    expect((await a.cancelBooking(null, "x")).cancelled).toBe(false);
  });
  it("bono: expediente reservado y servicio confirmado (o propio)", () => {
    expect(voucherBlocker("presupuestado", "proveedor", null)).toMatch(/reservado/);
    expect(voucherBlocker("reservado", "proveedor", "submitted")).toMatch(/confirma/);
    expect(voucherBlocker("reservado", "proveedor", "provider_confirmed")).toBeNull();
    expect(voucherBlocker("reservado", "proveedor", "consolidated")).toBeNull();
    expect(voucherBlocker("reservado", "propio", null)).toBeNull();
  });
});
