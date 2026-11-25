import { describe, expect, it } from "vitest";
import { applicableSupplements, supplementEuros, supplementIdsFor, supplementTierFor, supplementsTotalEuros, type CartSupplement } from "../shared/supplementCart";

const comida: CartSupplement = { group: "alim", name: "Alimentación", tiers: [
  { id: 1, priceModifier: "120.00", priceType: "per_person", minQty: 1, maxQty: 1 },
  { id: 2, priceModifier: "90.00", priceType: "per_person", minQty: 2, maxQty: 5 },
] };
const lifetime: CartSupplement = { group: "lifetime", name: "Lifetime Access", forVariantIds: [10, 11], tiers: [{ id: 3, priceModifier: "144.00", priceType: "fixed", minQty: 1, maxQty: 1 }] };

describe("Suplementos del carrito (solo para mostrar; el servidor decide)", () => {
  it("el tramo y el importe dependen de los participantes", () => {
    expect(supplementTierFor(comida, 1)?.id).toBe(1);
    expect(supplementTierFor(comida, 3)?.id).toBe(2);
    expect(supplementTierFor(comida, 6)).toBeUndefined();
    expect(supplementEuros(comida, 1)).toBe(120);
    expect(supplementEuros(comida, 3)).toBe(270);
    expect(supplementEuros(comida, 6)).toBe(0);
  });
  it("un importe único no se multiplica; el total suma los marcados y los ids se envían por tramo", () => {
    expect(supplementEuros(lifetime, 1)).toBe(144);
    expect(supplementsTotalEuros([lifetime, comida], 1)).toBe(264);
    expect(supplementsTotalEuros(undefined, 2)).toBe(0);
    expect(supplementIdsFor([lifetime, comida], 1)).toEqual([3, 1]);
    expect(supplementIdsFor([lifetime, comida], 2)).toEqual([2]); // Lifetime es de una sola persona: sin tramo no se envía
  });
  it("solo se ofrece con las opciones de su ámbito", () => {
    expect(applicableSupplements([lifetime, comida], 10).map((s) => s.group)).toEqual(["lifetime", "alim"]);
    expect(applicableSupplements([lifetime, comida], 99).map((s) => s.group)).toEqual(["alim"]);
    expect(applicableSupplements([lifetime], undefined)).toEqual([]);
  });
});
