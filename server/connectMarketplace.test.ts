/**
 * Elephant Connect: estado de cada módulo para la empresa (función pura, todos los casos), acción de la ficha,
 * búsqueda y filtros, catálogo con los textos del catálogo oficial e intentos de compra con clave estable.
 */
import { describe, it, expect } from "vitest";
import {
  categoryOf,
  connectAction,
  deriveConnectState,
  filterConnectItems,
  withPendingOrders,
  type ConnectCapabilityStatus,
  type ConnectStateInput,
} from "../shared/connectMarketplace";
import { beginAttempt, DRAFT_TTL_MS, loadAttempt, memoryAttemptStorage, newIdempotencyKey, openOrders, phaseOf, pollDelayMs, recordResult } from "../shared/connectPurchase";
import { buildConnectCatalog } from "./connectMarketplace";
import type { CapabilityGrant } from "./_core/capabilities/model";
import type { PanelCatalogItemView } from "./panelModules";

const mod = (o: Partial<ConnectStateInput> = {}): ConnectStateInput => ({ kind: "module", commercialStatus: "available", capabilities: ["cap-a", "cap-b"], dependencies: [], plans: [], ...o });
const ctx = (caps: Record<string, ConnectCapabilityStatus> = {}, o: { plan?: string | null; active?: string[]; pendingOrder?: boolean } = {}) => ({
  capabilityStatus: (c: string) => caps[c] ?? null,
  plan: o.plan === undefined ? "essential" : o.plan,
  productActive: (k: string) => (o.active ?? []).includes(k),
  productName: (k: string) => `Producto ${k}`,
  pendingOrder: o.pendingOrder,
});

describe("estado de un módulo para la empresa", () => {
  it("contratada y activa solo con TODAS sus capacidades activas", () => {
    expect(deriveConnectState(mod(), ctx({ "cap-a": "active", "cap-b": "active" })).state).toBe("active");
  });
  it("suspendida, solo lectura o caducada: incidencia (nunca se ofrece comprar otra vez)", () => {
    expect(deriveConnectState(mod(), ctx({ "cap-a": "suspended", "cap-b": "active" })).state).toBe("incident");
    expect(deriveConnectState(mod(), ctx({ "cap-a": "read_only", "cap-b": "read_only" })).state).toBe("incident");
    expect(deriveConnectState(mod(), ctx({ "cap-a": "expired", "cap-b": "active" })).state).toBe("incident");
  });
  it("pendiente de configuración y en proceso de activación según la licencia", () => {
    expect(deriveConnectState(mod(), ctx({ "cap-a": "pending_setup", "cap-b": "active" })).state).toBe("pending_setup");
    expect(deriveConnectState(mod(), ctx({ "cap-a": "contracted", "cap-b": "contracted" })).state).toBe("activating");
  });
  it("activación incompleta (unas capacidades sí y otras no): incidencia, el estado prudente", () => {
    expect(deriveConnectState(mod(), ctx({ "cap-a": "active" })).state).toBe("incident");
  });
  it("una licencia cancelada cuenta como no contratada", () => {
    expect(deriveConnectState(mod(), ctx({ "cap-a": "cancelled", "cap-b": "cancelled" })).state).toBe("available");
  });
  it("un pedido propio en curso: en proceso de activación aunque las licencias aún no digan nada", () => {
    expect(deriveConnectState(mod(), ctx({}, { pendingOrder: true })).state).toBe("activating");
    // Las licencias mandan sobre el pedido
    expect(deriveConnectState(mod(), ctx({ "cap-a": "active", "cap-b": "active" }, { pendingOrder: true })).state).toBe("active");
  });
  it("sin contratar: el estado comercial del catálogo", () => {
    expect(deriveConnectState(mod({ commercialStatus: "coming_soon" }), ctx()).state).toBe("coming_soon");
    expect(deriveConnectState(mod({ commercialStatus: "in_preparation" }), ctx())).toEqual({ state: "coming_soon", reasons: ["Está en preparación."] });
    expect(deriveConnectState(mod({ commercialStatus: "on_request" }), ctx()).state).toBe("on_request");
    expect(deriveConnectState(mod(), ctx()).state).toBe("available");
  });
  it("no disponible para tu plan: plan distinto, plan desconocido o requisito sin contratar", () => {
    const addon = mod({ kind: "quantity", capabilities: [], plans: ["business"] });
    expect(deriveConnectState(addon, ctx({}, { plan: "essential" }))).toEqual({ state: "not_eligible", reasons: ["Disponible para el plan Business."] });
    expect(deriveConnectState(addon, ctx({}, { plan: null })).state).toBe("not_eligible");
    expect(deriveConnectState(addon, ctx({}, { plan: "business" })).state).toBe("available");
    const dep = mod({ dependencies: ["base"] });
    expect(deriveConnectState(dep, ctx()).reasons).toEqual(["Requiere tener contratado Producto base."]);
    expect(deriveConnectState(dep, ctx({}, { active: ["base"] })).state).toBe("available");
  });
  it("ampliaciones por unidades nunca salen como «contratadas» (se compran por unidades)", () => {
    expect(deriveConnectState(mod({ kind: "quantity", capabilities: ["cap-a"] }), ctx({ "cap-a": "active" })).state).toBe("available");
  });
  it("sin capacidades conocidas no se puede saber si está contratado: estado comercial", () => {
    expect(deriveConnectState(mod({ capabilities: [], commercialStatus: "on_request" }), ctx()).state).toBe("on_request");
  });
});

describe("acción de la ficha", () => {
  const base = { kind: "module" as const, purchasable: true, canPurchase: true };
  it("contratar solo si está disponible, el catálogo lo vende y la persona puede comprar", () => {
    expect(connectAction({ ...base, state: "available" })).toBe("purchase");
    expect(connectAction({ ...base, state: "available", kind: "quantity" })).toBe("expand");
    expect(connectAction({ ...base, state: "available", canPurchase: false })).toBe("request");
    expect(connectAction({ ...base, state: "available", purchasable: false })).toBe("request");
  });
  it("el resto: solicitar, contactar o nada", () => {
    expect(connectAction({ ...base, state: "on_request" })).toBe("request");
    expect(connectAction({ ...base, state: "not_eligible" })).toBe("request");
    expect(connectAction({ ...base, state: "incident" })).toBe("contact");
    expect(connectAction({ ...base, state: "pending_setup" })).toBe("contact");
    for (const s of ["active", "activating", "coming_soon"] as const) expect(connectAction({ ...base, state: s })).toBe("none");
  });
});

describe("búsqueda, categorías y filtros", () => {
  const items = [
    { key: "a", name: "Personal y fichajes", tagline: "Empleados y nóminas", description: null, family: "connect", kind: "module" as const, state: "active" as const },
    { key: "b", name: "Centralita", tagline: "Llamadas con IA", description: "Atención telefónica", family: "connect", kind: "module" as const, state: "on_request" as const },
    { key: "c", name: "Usuario adicional", tagline: null, description: null, family: "addon", kind: "quantity" as const, state: "available" as const },
    { key: "d", name: "Pack finanzas", tagline: null, description: null, family: "connect_bundle", kind: "module" as const, state: "coming_soon" as const },
  ];
  it("busca sin distinguir mayúsculas ni tildes", () => {
    expect(filterConnectItems(items, { query: "nomina" }).map((i) => i.key)).toEqual(["a"]);
    expect(filterConnectItems(items, { query: "TELEFÓNICA" }).map((i) => i.key)).toEqual(["b"]);
  });
  it("filtra por categoría y por estado", () => {
    expect(categoryOf(items[2])).toBe("capacity");
    expect(filterConnectItems(items, { category: "bundles" }).map((i) => i.key)).toEqual(["d"]);
    expect(filterConnectItems(items, { state: "mine" }).map((i) => i.key)).toEqual(["a"]);
    expect(filterConnectItems(items, { state: "available" }).map((i) => i.key)).toEqual(["c"]);
    expect(filterConnectItems(items, { state: "on_request" }).map((i) => i.key)).toEqual(["b"]);
    expect(filterConnectItems(items, { state: "upcoming" }).map((i) => i.key)).toEqual(["d"]);
  });
  it("un pedido en curso oculta la compra; si las licencias ya dicen algo, mandan ellas", () => {
    const out = withPendingOrders(
      [
        { key: "x", state: "available" as const, reasons: [], purchasable: true },
        { key: "y", state: "active" as const, reasons: [], purchasable: false },
      ],
      new Set(["x", "y"]),
    );
    expect(out.map((i) => [i.key, i.state, i.purchasable])).toEqual([
      ["x", "activating", false],
      ["y", "active", false],
    ]);
  });
});

describe("catálogo de Connect con el catálogo oficial", () => {
  const NOW = Date.UTC(2026, 9, 31, 10);
  const item = (key: string, o: Partial<PanelCatalogItemView> = {}): PanelCatalogItemView => ({
    key,
    name: key,
    family: "connect",
    kind: "module",
    metric: null,
    step: null,
    commercialStatus: "available",
    capabilities: [],
    monthly: { amountCents: 1900, currency: "EUR", taxIncluded: false, unit: null },
    purchasable: true,
    ...o,
  });
  const grant = (capabilityId: string, o: Partial<CapabilityGrant> = {}): CapabilityGrant => ({ tenantId: "t1", capabilityId, siteId: "", status: "active", validUntil: null, source: "subscription:1", updatedAt: NOW, updatedBy: "test", ...o });

  it("textos de la ficha del catálogo oficial, sin nada interno", () => {
    const [pms] = buildConnectCatalog({ items: [item("hotel-net-pms", { family: "net_module", capabilities: ["hotel-net"] })] }, [], NOW, "essential");
    expect(pms.tagline).toBe("Gestión de alojamiento hasta 20 habitaciones.");
    expect(pms.includes.length).toBe(3);
    expect(JSON.stringify(pms)).not.toMatch(/Reutilizable|notes|evidence|costCents/);
  });
  it("lo suspendido no se puede comprar otra vez (aunque el catálogo lo venda)", () => {
    const [p] = buildConnectCatalog({ items: [item("connect-people", { capabilities: ["people-hr"] })] }, [grant("people-hr", { status: "suspended" })], NOW, "essential");
    expect([p.state, p.purchasable]).toEqual(["incident", false]);
  });
  it("un paquete toma las capacidades de sus componentes; los requisitos y planes salen del catálogo", () => {
    const out = buildConnectCatalog(
      {
        items: [
          item("connect-pack-finance", { family: "connect_bundle" }),
          item("hotel-net-booking-engine", { family: "net_module", capabilities: ["hotel-net"] }),
          item("addon-user-business", { family: "addon", kind: "quantity", metric: "users", step: 1 }),
        ],
      },
      [grant("tax-filings"), grant("bank-reconciliation"), grant("bank-import-pos"), grant("supplier-settlements")],
      NOW,
      "essential",
    );
    const [pack, engine, addon] = out;
    expect(pack.capabilities.sort()).toEqual(["bank-import-pos", "bank-reconciliation", "supplier-settlements", "tax-filings"]);
    expect(pack.state).toBe("active");
    expect(engine.dependencies).toEqual([{ key: "hotel-net-pms", name: "Hotel Net · PMS" }]);
    expect(engine.state).toBe("not_eligible");
    expect([addon.state, addon.purchasable, addon.category]).toEqual(["not_eligible", false, "capacity"]);
  });
});

describe("intentos de compra en el navegador: clave estable, sin duplicar", () => {
  const T0 = Date.UTC(2026, 9, 31, 10);
  let n = 0;
  const keys = () => `clave-de-prueba-${String(++n).padStart(4, "0")}`;

  it("reintentar (fallo de red, doble clic, recarga) reutiliza la misma clave", () => {
    const s = memoryAttemptStorage();
    const a = beginAttempt(s, "u1", "connect-people", T0, keys);
    const again = beginAttempt(s, "u1", "connect-people", T0 + 5_000, keys);
    expect(again.idempotencyKey).toBe(a.idempotencyKey);
  });
  it("un resultado intermedio se conserva (también tras recargar) y se retoma; uno definitivo cierra el intento", () => {
    const s = memoryAttemptStorage();
    const a = beginAttempt(s, "u1", "connect-people", T0, keys);
    recordResult(s, "u1", a, { status: "payment_pending", orderId: 7, paymentUrl: "https://invoice.stripe.com/i/x" });
    expect(openOrders(s, "u1").map((o) => [o.productKey, o.orderId, o.idempotencyKey])).toEqual([["connect-people", 7, a.idempotencyKey]]);
    expect(beginAttempt(s, "u1", "connect-people", T0 + 1, keys).idempotencyKey).toBe(a.idempotencyKey);
    recordResult(s, "u1", loadAttempt(s, "u1", "connect-people", T0)!, { status: "applied" });
    expect(openOrders(s, "u1")).toEqual([]);
    // Nueva compra (p. ej. tras una baja): clave nueva
    expect(beginAttempt(s, "u1", "connect-people", T0 + 2, keys).idempotencyKey).not.toBe(a.idempotencyKey);
  });
  it("tras un fallo o caducidad, el siguiente intento usa una clave nueva (sin cargo previo)", () => {
    const s = memoryAttemptStorage();
    const a = beginAttempt(s, "u1", "connect-tax", T0, keys);
    recordResult(s, "u1", a, { status: "failed", orderId: 9 });
    expect(beginAttempt(s, "u1", "connect-tax", T0 + 1, keys).idempotencyKey).not.toBe(a.idempotencyKey);
  });
  it("un intento sin pedido caduca a las 24 h; cada persona tiene los suyos", () => {
    const s = memoryAttemptStorage();
    const a = beginAttempt(s, "u1", "connect-pos", T0, keys);
    expect(loadAttempt(s, "u2", "connect-pos", T0)).toBeNull();
    expect(loadAttempt(s, "u1", "connect-pos", T0 + DRAFT_TTL_MS + 1)).toBeNull();
    expect(beginAttempt(s, "u1", "connect-pos", T0 + DRAFT_TTL_MS + 2, keys).idempotencyKey).not.toBe(a.idempotencyKey);
  });
  it("almacenamiento corrupto: se ignora", () => {
    const s = memoryAttemptStorage();
    s.set("elephant-connect:attempt:u1:x", "{no json");
    expect(loadAttempt(s, "u1", "x", T0)).toBeNull();
    expect(openOrders(s, "u1")).toEqual([]);
  });
  it("clave válida para el backend y fases y esperas del seguimiento", () => {
    expect(newIdempotencyKey(() => "1b4e28ba-2fa1-11d2-883f-0016d3cca427")).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
    expect(newIdempotencyKey(() => "ab")).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
    expect([phaseOf("applied"), phaseOf("processing"), phaseOf("payment_pending"), phaseOf("failed"), phaseOf("expired")]).toEqual(["confirmed", "waiting", "waiting", "closed", "closed"]);
    expect(pollDelayMs("processing", 0)).toBe(3_000);
    expect(pollDelayMs("payment_pending", 10)).toBe(60_000);
    expect(pollDelayMs("applied", 0)).toBe(false);
  });
});
