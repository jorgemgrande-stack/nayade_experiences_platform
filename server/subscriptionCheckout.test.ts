/**
 * Contratación desde «Suscripción»: ampliaciones con la disponibilidad real del marketplace, validación fiscal (las
 * reglas del plano de control), pasos y borrador para volver sin perder nada.
 */
import { describe, expect, it } from "vitest";
import {
  DRAFT_TTL_MS,
  EMPTY_BUYER,
  buyerPayload,
  checkoutExtensions,
  maxReachableStep,
  parseDraft,
  selectionSignature,
  validSelection,
  validateBuyer,
  type CheckoutCatalogItem,
} from "../shared/subscriptionCheckout";

const item = (key: string, o: Partial<CheckoutCatalogItem> = {}): CheckoutCatalogItem => ({
  key,
  name: key,
  kind: "module",
  state: "available",
  commercialStatus: "available",
  plans: [],
  dependencies: [],
  prices: [{ kind: "monthly", amountCents: 1900 }],
  reasons: [],
  checkoutVia: "conversion",
  ...o,
});

describe("ampliaciones en el alta", () => {
  const items = [
    item("connect-people"),
    item("connect-voice", { plans: ["business"] }),
    item("hotel-net", { state: "on_request", commercialStatus: "on_request", checkoutVia: null }),
    item("ski-net", { state: "coming_soon", commercialStatus: "coming_soon", checkoutVia: null }),
    item("connect-whatsapp-ai", { state: "active", checkoutVia: null }),
    item("connect-automations", { state: "not_eligible", checkoutVia: null, reasons: ["Requiere tener contratado Elephant People."] }),
    item("addon-user-essential", { kind: "quantity" }),
    item("sin-precio", { prices: [], checkoutVia: null }),
  ];

  it("solo se marca lo que el servidor admite en el alta con el plan elegido", () => {
    const ess = checkoutExtensions(items, "essential");
    const by = Object.fromEntries(ess.map((e) => [e.item.key, e]));
    expect(by["connect-people"]).toMatchObject({ group: "available", selectable: true });
    expect(by["connect-voice"]).toMatchObject({ group: "not_included", selectable: false, needsPlan: "business", note: "Se contrata con el plan Business." });
    expect(by["hotel-net"]).toMatchObject({ group: "on_request", selectable: false });
    expect(by["ski-net"]).toMatchObject({ group: "coming_soon", selectable: false });
    expect(by["connect-whatsapp-ai"]).toMatchObject({ group: "contracted", selectable: false });
    expect(by["connect-automations"]).toMatchObject({ group: "not_included", selectable: false, note: "Requiere tener contratado Elephant People." });
    expect(by["sin-precio"]).toMatchObject({ group: "available", selectable: false });
    // Las ampliaciones por unidades no entran en el alta
    expect(by["addon-user-essential"]).toBeUndefined();
    const bus = Object.fromEntries(checkoutExtensions(items, "business").map((e) => [e.item.key, e]));
    expect(bus["connect-voice"]).toMatchObject({ group: "available", selectable: true });
  });

  it("al cambiar de plan se descarta lo que ya no cabe (nunca se envía)", () => {
    expect(validSelection(["connect-voice", "connect-people", "hotel-net"], checkoutExtensions(items, "essential"))).toEqual(["connect-people"]);
    expect(validSelection(["connect-voice", "connect-people"], checkoutExtensions(items, "business"))).toEqual(["connect-voice", "connect-people"]);
  });
});

describe("datos de facturación", () => {
  const ok = { legalName: "Skibox SL", taxId: "B12345678", line1: "Calle Mayor 1", postalCode: "28001", city: "Madrid", country: "ES" };
  it("acepta un perfil completo y lo normaliza", () => {
    expect(validateBuyer(ok)).toEqual({});
    expect(buyerPayload({ ...ok, country: "es", legalName: "  Skibox SL " })).toEqual({ type: "business", ...ok, legalName: "Skibox SL" });
  });
  it("explica cada campo que falta o no es válido", () => {
    const e = validateBuyer(EMPTY_BUYER);
    expect(Object.keys(e).sort()).toEqual(["city", "legalName", "line1", "postalCode", "taxId"]);
    expect(validateBuyer({ ...ok, taxId: "B1" }).taxId).toMatch(/entre 4 y 40/);
    expect(validateBuyer({ ...ok, taxId: "B12#45678" }).taxId).toMatch(/Solo letras/);
    expect(validateBuyer({ ...ok, country: "España" }).country).toBeTruthy();
  });
  it("los pasos exigen un importe válido y, para revisar, los datos completos", () => {
    expect(maxReachableStep({ quoteOk: false, buyerValid: true })).toBe(1);
    expect(maxReachableStep({ quoteOk: true, buyerValid: false })).toBe(2);
    expect(maxReachableStep({ quoteOk: true, buyerValid: true })).toBe(3);
  });
});

describe("borrador para volver sin perder nada", () => {
  const now = Date.UTC(2026, 10, 9, 12);
  const key = "0f8fad5b-d9cb-469f-a165-70867728950e";
  const draft = { plan: "business", interval: "year", add: ["connect-people", "connect-people", "../x"], buyer: { legalName: "Skibox SL", country: "es" }, step: 2, key, keyFor: "business|year|connect-people", savedAt: now - 1000 };
  it("recupera la selección, los datos y la clave de idempotencia", () => {
    const d = parseDraft(JSON.stringify(draft), now)!;
    expect(d).toMatchObject({ plan: "business", interval: "year", add: ["connect-people"], step: 2, key });
    expect(d.buyer).toEqual({ ...EMPTY_BUYER, legalName: "Skibox SL", country: "ES" });
    expect(d.keyFor).toBe(selectionSignature({ plan: "business", interval: "year", add: ["connect-people"] }));
  });
  it("descarta lo caducado, lo mal formado o un plan que no se contrata en línea", () => {
    expect(parseDraft(JSON.stringify({ ...draft, savedAt: now - DRAFT_TTL_MS - 1 }), now)).toBeNull();
    expect(parseDraft(JSON.stringify({ ...draft, plan: "enterprise" }), now)).toBeNull();
    expect(parseDraft("{no", now)).toBeNull();
    expect(parseDraft(null, now)).toBeNull();
    expect(parseDraft(JSON.stringify({ ...draft, key: "x" }), now)?.key).toBeNull();
  });
  it("la firma no depende del orden de las ampliaciones", () => {
    expect(selectionSignature({ plan: "essential", interval: "month", add: ["b", "a"] })).toBe(selectionSignature({ plan: "essential", interval: "month", add: ["a", "b"] }));
  });
});
