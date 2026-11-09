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
  it("solo lectura o caducada: el texto solo promete la consulta que permite hoy el servidor", () => {
    const reason = (caps: Record<string, ConnectCapabilityStatus>, consultation?: { available: boolean; until: number | null; endedAt: number | null } | null) =>
      deriveConnectState(mod(), { ...ctx(caps), consultation }).reasons[0];
    const RO = { "cap-a": "read_only", "cap-b": "read_only" } as const;
    const EXP = { "cap-a": "expired", "cap-b": "expired" } as const;
    expect(reason(RO)).toBe("Está en solo lectura: puedes consultar tus datos, pero no trabajar con ellos.");
    // Caducada sin el dato de consulta: no se promete consulta
    expect(reason(EXP)).not.toMatch(/consultar/);
    // Prueba vencida que se puede leer
    expect(reason(EXP, { available: true, until: null, endedAt: null })).toMatch(/puedes consultar/);
    // Consulta con plazo
    expect(reason(RO, { available: true, until: Date.UTC(2026, 11, 9, 12), endedAt: null })).toContain("hasta el 9 de diciembre de 2026 a las ");
    // Plazo de consulta terminado: ni «solo lectura» ni «puedes consultar»
    const closed = reason(EXP, { available: false, until: null, endedAt: Date.UTC(2026, 10, 1, 12) });
    expect(closed).toContain("El plazo de consulta terminó el 1 de noviembre de 2026");
    expect(closed).not.toMatch(/puedes consultar|solo lectura/);
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

  it("licencia en solo lectura: la ficha solo promete la consulta real de esas capacidades (y nada en modo sombra)", () => {
    const H = 60 * 60 * 1000;
    const people = (grants: CapabilityGrant[], opts?: { enforcing?: boolean }) =>
      buildConnectCatalog({ items: [item("connect-people", { capabilities: ["people-hr"] })] }, grants, NOW, "essential", () => null, opts)[0].reasons[0];
    // Solo lectura con plazo vigente: «hasta el …» con la hora
    expect(people([grant("people-hr", { status: "read_only", validUntil: NOW + 48 * H })])).toMatch(/solo lectura hasta el .* a las /);
    // Plazo de consulta terminado: no se promete consulta
    const ended = people([grant("people-hr", { status: "read_only", validUntil: NOW - H })]);
    expect(ended ?? "").not.toMatch(/puedes consultar/);
    // Modo sombra: el servidor deja leer, no se anuncia que la consulta terminó
    expect(people([grant("people-hr", { status: "read_only", validUntil: NOW - H })], { enforcing: false }) ?? "").not.toMatch(/terminó/);
  });
  it("textos de la ficha del catálogo oficial, sin nada interno", () => {
    const [people] = buildConnectCatalog({ items: [item("connect-people", { capabilities: ["people-hr"] })] }, [], NOW, "essential");
    expect(people.tagline).toBe("Gestión de empleados y control horario, integrada en tu empresa.");
    expect(people.includes.length).toBe(7);
    expect(people.net).toBeNull();
    expect(JSON.stringify(people)).not.toMatch(/Reutilizable|notes|evidence|costCents/);
  });

  // Elephant Net unificado (07/11/2026): 7 productos y ninguna extensión sectorial suelta
  const allNet = () => [
    ...["hotel-net-pms", "hotel-net-channel-manager", "hotel-net-booking-engine", "hotel-net-housekeeping", "care-net-agenda", "social-token-net-communities", "social-token-net-tokens"].map((k) => item(k, { family: "net_module" })),
    ...["hotel-net-complete", "care-net-complete", "restaurant-net-complete", "ski-net-complete", "travel-net-complete", "social-token-net-complete"].map((k) => item(k, { family: "net_bundle", commercialStatus: "coming_soon", purchasable: false })),
    item("life-net", { family: "net_module", capabilities: ["life-net"], commercialStatus: "coming_soon", purchasable: false }),
  ];
  it("Net: solo los 7 productos, con nombre sin «Complete», licencia y funcionalidades por áreas; Life Net, solo para un hogar", () => {
    // Life Net es personal (decisión J7 del 08/11/2026): fuera del escaparate de las empresas
    const out = buildConnectCatalog({ items: allNet() }, [], NOW, "essential");
    expect(out.map((i) => i.name).sort()).toEqual(["Care Net", "Hotel Net", "Restaurant Net", "Ski Net", "Social Token Net", "Travel Net"]);
    const home = buildConnectCatalog({ items: allNet() }, [], NOW, "life");
    expect(home.map((i) => i.name)).toEqual(["Life Net"]);
    const hotel = out.find((i) => i.key === "hotel-net-complete")!;
    expect(hotel.net).toMatchObject({ licence: "HOTEL_NET", segment: "business", homePath: "/admin/net/hotel", legacyContracted: [] });
    expect(hotel.includes).toEqual(["PMS", "Motor de reservas", "Channel Manager (próximamente)", "Housekeeping", "Informes"]);
    expect(hotel.capabilities).toEqual(["hotel-net"]);
    expect(home.find((i) => i.key === "life-net")!.net!.segment).toBe("personal");
    expect(JSON.stringify(out)).not.toMatch(/Complete/);
  });
  it("Net en implantación acompañada (revisión del 07/11/2026): lo activa el equipo y se solicita, nunca se compra en línea", () => {
    const five = ["hotel-net-complete", "restaurant-net-complete", "care-net-complete", "ski-net-complete", "travel-net-complete"];
    const items = allNet().map((i) => (five.includes(i.key) ? { ...i, commercialStatus: "on_request" as const, purchasable: false } : i));
    const out = buildConnectCatalog({ items }, [], NOW, "essential");
    for (const key of five) {
      const p = out.find((i) => i.key === key)!;
      expect([p.state, p.purchasable], key).toEqual(["on_request", false]);
      expect(p.reasons, key).toEqual(["Lo activa nuestro equipo contigo (implantación acompañada)."]);
      expect(connectAction({ state: p.state, kind: p.kind, purchasable: p.purchasable, canPurchase: true }), key).toBe("request");
    }
    expect(out.find((i) => i.key === "social-token-net-complete")!.state).toBe("coming_soon");
  });
  it("Net: una contratación anterior que da todas las funciones equivale al producto (sin nueva compra)", () => {
    const items = allNet().map((i) => (i.key === "hotel-net-pms" ? { ...i, activation: { state: "active" } } : i.key === "hotel-net-complete" ? { ...i, commercialStatus: "available" as const, purchasable: true } : i));
    const hotel = buildConnectCatalog({ items }, [grant("hotel-net")], NOW, "essential").find((i) => i.key === "hotel-net-complete")!;
    expect([hotel.state, hotel.purchasable]).toEqual(["active", false]);
    expect(hotel.net!.legacyContracted).toEqual([{ key: "hotel-net-pms", name: "hotel-net-pms" }]);
    expect(hotel.reasons.join(" ")).toMatch(/conservas el acceso y tus condiciones, sin cargos adicionales/);
  });
  it("Net: una contratación anterior parcial se puede sustituir por el producto (prorrateo, sin cargo doble)", () => {
    const items = allNet().map((i) => (i.key === "social-token-net-communities" ? { ...i, activation: { state: "active" } } : i.key === "social-token-net-complete" ? { ...i, commercialStatus: "available" as const, purchasable: true } : i));
    const stn = buildConnectCatalog({ items }, [grant("social-token-net")], NOW, "essential").find((i) => i.key === "social-token-net-complete")!;
    expect([stn.state, stn.purchasable]).toEqual(["available", true]);
    expect(stn.reasons.join(" ")).toMatch(/Sustituye a social-token-net-communities/);
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
          item("addon-user-business", { family: "addon", kind: "quantity", metric: "users", step: 1 }),
        ],
      },
      [grant("tax-filings"), grant("bank-reconciliation"), grant("bank-import-pos"), grant("supplier-settlements")],
      NOW,
      "essential",
    );
    const [pack, addon] = out;
    expect(pack.capabilities.sort()).toEqual(["bank-import-pos", "bank-reconciliation", "supplier-settlements", "tax-filings"]);
    expect(pack.state).toBe("active");
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
