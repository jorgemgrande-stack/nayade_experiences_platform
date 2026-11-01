/**
 * Marketplace premium de Elephant Connect y Elephant Net en el Core:
 *  - lectura tolerante de la ficha del canal (`card`, forma de la PR #567): con ficha completa, parcial, null y con
 *    campos raros; lo vacío usa la reserva de la semilla; nada interno ni inseguro pasa;
 *  - no se muestra nada inventado: sin ficha ni semilla, la ficha va vacía;
 *  - acción por estado («Contratar» solo con compra en línea abierta, «Me interesa» solo con solicitudes);
 *  - `connect.request`: oportunidad en el CRM con la identidad de la sesión, o ticket si el canal aún no tiene
 *    solicitudes; errores claros; «Me interesa» desaparece si el canal no las acepta.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";
import type { CommerceClient, ModuleRequestInput } from "./commerceClient";
import { SIM_ACTIVE_CAPABILITIES, SIM_CATALOG } from "./connectFichas.testkit";

const fake = vi.hoisted(() => ({
  requests: [] as Array<{ tenantId: string; input: unknown }>,
  tickets: [] as Array<{ tenantId: string; input: unknown }>,
  mode: "ok" as "ok" | "duplicate" | "route_missing" | "not_visible" | "conflict" | "forbidden",
  catalog: null as unknown,
}));

vi.mock("./commerceClient", async (orig) => {
  const real = await orig<typeof import("./commerceClient")>();
  const client: Partial<CommerceClient> = {
    catalog: async () => fake.catalog,
    request: async (tenantId, input) => {
      fake.requests.push({ tenantId, input });
      if (fake.mode === "route_missing") throw new real.CommerceError(404, "route_missing", "No se pudo completar la operación");
      if (fake.mode === "not_visible") throw new real.CommerceError(404, "not_found", "Ese producto no está en tu catálogo");
      if (fake.mode === "conflict") throw new real.CommerceError(409, "invalid_state", "Ese producto todavía no está disponible: usa «Me interesa»");
      if (fake.mode === "forbidden") throw new real.CommerceError(403, "forbidden", "forbidden");
      return { outcome: fake.mode === "duplicate" ? "duplicate" : "created", reference: "SOL-2026-0042", status: "pending" };
    },
    openTicket: async (tenantId, input) => {
      fake.tickets.push({ tenantId, input });
      return { id: 7 };
    },
  };
  return { ...real, commerceClientFromEnv: () => client as CommerceClient };
});
vi.mock("./supportContact", () => ({ resolveSupportContact: async () => ({ email: "ayuda@elephant.example" }) }));

import { router } from "./_core/trpc";
import { connectRouter, _resetConnectRequestsProbeForTests } from "./routers/connectRouter";
import { configureCapabilityAccess, _resetCapabilityAccessForTests } from "./_core/capabilities/access";
import { MemoryCapabilityStore } from "./_core/capabilities/store";
import { capabilitiesOfTier } from "./catalog/capabilities";
import { runWithTenant } from "./_core/tenant";
import { parseConnectCard, advertisesRequests, parseMarketplaceHeaders } from "./connectCard";
import { buildConnectCatalog, type ChannelCatalogItem } from "./connectMarketplace";
import { brandHeaders, connectAction, CONNECT_BRANDS } from "../shared/connectMarketplace";
import { EMPTY_SHEET, headlinePrice, periodLabel, sortPrices, taxLabel } from "../shared/connectCard";

const NOW = Date.UTC(2026, 10, 1, 12);
const T = "empresa-fichas";
const store = new MemoryCapabilityStore();
const env = { ...process.env };
const app = router({ connect: connectRouter });
const ctxFor = (role = "admin", email = "ana@empresa.example"): TrpcContext => ({
  user: { id: 3, openId: "o", email, name: "Ana Pérez", loginMethod: "local", role, createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() } as NonNullable<TrpcContext["user"]>,
  req: { protocol: "https", headers: {} } as TrpcContext["req"],
  res: {} as TrpcContext["res"],
});
const as = <X>(fn: () => Promise<X>) => runWithTenant(T, fn);
const grants = () =>
  [...capabilitiesOfTier("essential"), ...SIM_ACTIVE_CAPABILITIES].map((capabilityId) => ({ capabilityId, siteId: "", status: "active" as const, validUntil: null, source: "subscription:1" }));
const item = (key: string) => SIM_CATALOG.items.find((i) => i.key === key)!;
const built = () => buildConnectCatalog(SIM_CATALOG, grants() as never, NOW, "essential");
const one = (key: string) => built().find((i) => i.key === key)!;

beforeAll(async () => {
  process.env.TENANT_MODE = "multi";
  configureCapabilityAccess(store, { now: () => NOW, enforce: true, ttlMs: 30_000 });
  await store.apply(T, grants(), { actor: "test", reason: null, now: NOW });
});
afterAll(() => {
  process.env = env;
  _resetCapabilityAccessForTests();
});
beforeEach(() => {
  fake.requests.length = 0;
  fake.tickets.length = 0;
  fake.mode = "ok";
  fake.catalog = SIM_CATALOG;
  _resetConnectRequestsProbeForTests();
});

describe("lectura tolerante de la ficha del canal", () => {
  it("sin ficha (null, ausente o no objeto) → null; nunca lanza", () => {
    for (const raw of [null, undefined, "texto", 3, [], true]) expect(parseConnectCard(raw)).toBeNull();
  });

  it("ficha completa: textos, listas, precios, condiciones y preguntas", () => {
    const c = parseConnectCard(item("connect-campaigns").card)!;
    expect(c.tagline).toBe("Lema de prueba (ficha completa)");
    expect(c.presentation).toMatchObject({ icon: "megaphone", highlight: true });
    expect(c.commercial?.benefits).toHaveLength(4);
    expect(c.commercial?.terms).toEqual({ commitment: "Sin permanencia (prueba)", cancellation: "Baja al final del periodo (prueba)", activation: "En 48 horas (prueba)" });
    expect(c.prices).toEqual([
      { kind: "monthly", amountCents: 1900, currency: "EUR", unit: null, taxRateBp: 2100, taxIncluded: false },
      { kind: "yearly", amountCents: 19000, currency: "EUR", unit: null, taxRateBp: 2100, taxIncluded: false },
    ]);
    // La modalidad publicada: solo su etiqueta, nunca los motivos internos
    expect(c.offer).toEqual({ label: "Implantación asistida", activationNotes: null });
    expect(JSON.stringify(c)).not.toContain("MOTIVO INTERNO");
  });

  it("textos y listas vacíos = sin contenido (null)", () => {
    const c = parseConnectCard(item("hotel-net-channel-manager").card)!;
    expect([c.tagline, c.description, c.includes, c.requirements, c.dependencies, c.compatibleWith, c.commercial]).toEqual([null, null, null, null, null, null, null]);
  });

  it("campos raros: se ignoran uno a uno sin tumbar el resto; nada interno, sin direcciones inseguras", () => {
    const c = parseConnectCard(item("social-token-net-communities").card)!;
    expect(c.tagline).toBeNull();
    expect(c.includes).toBeNull();
    expect(c.presentation).toMatchObject({ icon: null, highlight: null });
    expect(c.commercial?.headline).toBeNull();
    expect(c.commercial?.benefits).toEqual(["Beneficio raro (prueba)"]);
    expect(c.commercial?.faq).toEqual([]);
    expect(c.commercial?.media).toMatchObject({ cover: null, screenshots: [] });
    expect(c.commercial?.terms).toBeNull();
    expect(c.prices).toEqual([]);
    expect(JSON.stringify(c)).not.toMatch(/INTERNO|costCents|campoDesconocido|javascript:|http:\/\//);
  });

  it("medios: solo https con texto alternativo", () => {
    const c = parseConnectCard({ commercial: { media: { cover: { src: "https://cdn.example/p.png", alt: "Pantalla" }, screenshots: [{ src: "https://cdn.example/1.png", alt: "Uno", caption: "Pie" }, { src: "https://cdn.example/2.png", alt: "" }] } } })!;
    expect(c.commercial?.media).toMatchObject({ cover: { src: "https://cdn.example/p.png", alt: "Pantalla", caption: null }, screenshots: [{ src: "https://cdn.example/1.png", alt: "Uno", caption: "Pie" }] });
  });

  it("cabeceras del marketplace: opcionales; sin ellas, las de siempre", () => {
    expect(brandHeaders(parseMarketplaceHeaders(undefined))).toEqual({ connect: { title: CONNECT_BRANDS[0].title, intro: CONNECT_BRANDS[0].subtitle }, net: { title: CONNECT_BRANDS[1].title, intro: CONNECT_BRANDS[1].subtitle } });
    expect(brandHeaders(parseMarketplaceHeaders({ net: { title: "Net de prueba", intro: 4 } })).net).toEqual({ title: "Net de prueba", intro: CONNECT_BRANDS[1].subtitle });
  });

  it("solicitudes: las anuncia el canal o la versión con fichas (`card` presente, aunque sea null)", () => {
    expect(advertisesRequests({ items: [{ key: "a" }] })).toBe(false);
    expect(advertisesRequests({ items: [{ key: "a", card: null }] })).toBe(true);
    expect(advertisesRequests({ items: [], requests: { enabled: true } })).toBe(true);
  });
});

describe("ficha resuelta: catálogo central, reserva de la semilla y nada inventado", () => {
  it("ficha completa: manda el catálogo central", () => {
    const i = one("connect-campaigns");
    expect(i.contentSource).toBe("card");
    expect(i.state).toBe("available");
    expect(i.highlight).toBe(true);
    expect(i.icon).toBe("megaphone");
    expect(i.sheet.headline).toBe("Titular de prueba: ficha completa");
    expect(i.forWho).toBe("Empresas de prueba del canal simulado.");
    expect(i.prices.map((p) => p.kind)).toEqual(["monthly", "yearly"]);
    expect(i.sheet.offer).toBe("Implantación asistida");
    // Relacionados: solo los que están en el catálogo de la empresa
    expect(i.sheet.related).toEqual(["connect-people", "hotel-net-pms"]);
  });

  it("ficha parcial: lo vacío usa la semilla oficial; las secciones sin datos quedan vacías", () => {
    const i = one("connect-people");
    expect(i.contentSource).toBe("card");
    expect(i.sheet.headline).toBe("Titular de prueba: ficha parcial");
    expect(i.sheet.benefits).toEqual(["Beneficio parcial (prueba)"]);
    expect(i.tagline).toBeTruthy(); // de la semilla
    expect([i.sheet.valueProposition, i.sheet.longDescription, i.sheet.problem]).toEqual([null, null, null]);
    expect(i.sheet.faq).toEqual([]);
    expect(i.sheet.terms).toEqual({ commitment: null, cancellation: null, activation: null });
    // Sin precios en la ficha: el mensual publicado del canal
    expect(i.prices).toEqual([{ kind: "monthly", amountCents: 1900, currency: "EUR", unit: null, taxRateBp: null, taxIncluded: false }]);
  });

  it("sin ficha: la semilla para los textos y ninguna sección comercial", () => {
    const i = one("connect-voice");
    expect(i.contentSource).toBe("seed");
    expect(i.sheet).toEqual(EMPTY_SHEET);
    expect(i.highlight).toBe(false);
  });

  it("sin ficha ni semilla: nada inventado", () => {
    const raw: ChannelCatalogItem = { key: "producto-nuevo", name: "Producto nuevo", family: "connect", kind: "module", metric: null, step: null, commercialStatus: "on_request", capabilities: ["x-nueva"], monthly: null, purchasable: false, card: null };
    const [i] = buildConnectCatalog({ items: [raw] }, [], NOW, "essential");
    expect(i).toMatchObject({ contentSource: "none", tagline: null, description: null, includes: [], requirements: [], forWho: null, thirdPartyCosts: null, icon: null, prices: [], sheet: EMPTY_SHEET });
  });

  it("los cuatro estados en Connect y en Net", () => {
    const states = Object.fromEntries(built().map((i) => [i.key, i.state]));
    expect(states).toMatchObject({
      "connect-campaigns": "available",
      "connect-people": "on_request",
      "connect-voice": "coming_soon",
      "connect-deals": "active",
      "restaurant-net-bookings": "available",
      "hotel-net-pms": "on_request",
      "hotel-net-channel-manager": "coming_soon",
      "care-net-agenda": "active",
    });
  });
});

describe("precios: periodicidad e IVA", () => {
  it("etiquetas", () => {
    expect([periodLabel("monthly"), periodLabel("yearly"), periodLabel("one_time"), periodLabel("rara")]).toEqual(["/ mes", "/ año", "pago único", ""]);
    expect(taxLabel({ taxIncluded: false, taxRateBp: 2100 })).toBe("IVA no incluido (21 %)");
    expect(taxLabel({ taxIncluded: true, taxRateBp: null })).toBe("IVA incluido");
  });
  it("«desde»: el mensual si hay varios; orden mensual → anual → pago único", () => {
    const p = (kind: string, amountCents: number) => ({ kind, amountCents, currency: "EUR", unit: null, taxRateBp: 2100, taxIncluded: false });
    expect(sortPrices([p("one_time", 1), p("yearly", 2), p("monthly", 3)]).map((x) => x.kind)).toEqual(["monthly", "yearly", "one_time"]);
    expect(headlinePrice([p("yearly", 2), p("monthly", 3)])).toMatchObject({ price: { kind: "monthly" }, from: true });
    expect(headlinePrice([p("monthly", 3)])).toMatchObject({ from: false });
    expect(headlinePrice([])).toBeNull();
  });
});

describe("acción según el estado", () => {
  const base = { kind: "module" as const, purchasable: true, canPurchase: true };
  it("«Contratar» solo si se vende en línea y esta persona puede comprar ahora", () => {
    expect(connectAction({ ...base, state: "available" })).toBe("purchase");
    expect(connectAction({ ...base, state: "available", canPurchase: false })).toBe("request");
    expect(connectAction({ ...base, state: "available", purchasable: false })).toBe("request");
  });
  it("«Me interesa» solo con solicitudes en el canal", () => {
    expect(connectAction({ ...base, state: "coming_soon", interestEnabled: true })).toBe("interest");
    expect(connectAction({ ...base, state: "coming_soon", interestEnabled: false })).toBe("none");
    expect(connectAction({ ...base, state: "coming_soon" })).toBe("none");
  });
  it("contratado: ninguna acción de compra", () => {
    expect(connectAction({ ...base, state: "active", interestEnabled: true })).toBe("none");
    expect(connectAction({ ...base, state: "on_request", interestEnabled: true })).toBe("request");
  });
});

describe("connect.catalog y connect.request", () => {
  const caller = () => app.createCaller(ctxFor());

  it("el catálogo con fichas ofrece «Me interesa»; el antiguo (sin `card`), no", async () => {
    expect((await as(() => caller().connect.catalog())).interestEnabled).toBe(true);
    fake.catalog = { ...SIM_CATALOG, items: SIM_CATALOG.items.map(({ card: _c, ...rest }) => rest) };
    const old = await as(() => caller().connect.catalog());
    expect(old.interestEnabled).toBe(false);
    expect(old.brands).toEqual(brandHeaders(null));
  });

  it("solicitar información → oportunidad con la identidad de la sesión y clave de idempotencia válida", async () => {
    const r = await as(() => caller().connect.request({ key: "connect-people", type: "info", message: "Somos 12" }));
    expect(r).toEqual({ via: "lead", outcome: "created", reference: "SOL-2026-0042", email: "ana@empresa.example" });
    const sent = fake.requests[0].input as ModuleRequestInput;
    expect(sent).toMatchObject({ type: "info", interest: "connect-people", message: "Somos 12", requester: { name: "Ana Pérez", email: "ana@empresa.example" } });
    expect(sent.idempotencyKey).toMatch(/^[A-Za-z0-9_-]{8,80}$/);
    // La misma petición repetida lleva la misma clave
    await as(() => caller().connect.request({ key: "connect-people", type: "info", message: "Somos 12" }));
    expect((fake.requests[1].input as ModuleRequestInput).idempotencyKey).toBe(sent.idempotencyKey);
    expect(fake.tickets).toHaveLength(0);
  });

  it("solicitud ya abierta: se dice tal cual", async () => {
    fake.mode = "duplicate";
    expect(await as(() => caller().connect.request({ key: "connect-voice", type: "waitlist" }))).toMatchObject({ via: "lead", outcome: "duplicate", reference: "SOL-2026-0042" });
  });

  it("sin solicitudes en el canal: información por soporte; «Me interesa» no disponible y desaparece del catálogo", async () => {
    fake.mode = "route_missing";
    expect(await as(() => caller().connect.request({ key: "connect-people", type: "info" }))).toEqual({ via: "ticket", email: "ana@empresa.example" });
    expect(fake.tickets).toHaveLength(1);
    expect(fake.tickets[0].input).toMatchObject({ requestedBy: "ana@empresa.example" });
    await expect(as(() => caller().connect.request({ key: "connect-voice", type: "waitlist" }))).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect((await as(() => caller().connect.catalog())).interestEnabled).toBe(false);
  });

  it("errores del canal en español claro y sin ticket de reserva", async () => {
    fake.mode = "not_visible";
    await expect(as(() => caller().connect.request({ key: "connect-people", type: "info" }))).rejects.toMatchObject({ code: "NOT_FOUND", message: "Este producto ya no está disponible en tu catálogo." });
    fake.mode = "conflict";
    await expect(as(() => caller().connect.request({ key: "connect-people", type: "info" }))).rejects.toMatchObject({ code: "CONFLICT" });
    fake.mode = "forbidden";
    await expect(as(() => caller().connect.request({ key: "connect-people", type: "info" }))).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(fake.tickets).toHaveLength(0);
    expect((await as(() => caller().connect.catalog())).interestEnabled).toBe(true);
  });

  it("consulta sobre algo contratado: siempre por soporte", async () => {
    expect(await as(() => caller().connect.request({ key: "care-net-agenda", type: "contact" }))).toMatchObject({ via: "ticket" });
    expect(fake.requests).toHaveLength(0);
  });

  it("solo productos del catálogo de la empresa; solo roles del panel; con correo válido", async () => {
    await expect(as(() => caller().connect.request({ key: "no-existe", type: "info" }))).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(as(() => app.createCaller(ctxFor("user")).connect.request({ key: "connect-people", type: "info" }))).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(as(() => app.createCaller(ctxFor("admin", "no-es-correo")).connect.request({ key: "connect-people", type: "info" }))).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(fake.requests).toHaveLength(0);
  });
});

describe("cliente del canal: 404 de ruta inexistente frente a producto no visible", () => {
  const body: ModuleRequestInput = { type: "info", interest: "connect-people", requester: { name: "Ana", email: "ana@empresa.example" }, idempotencyKey: "cx-12345678" };

  it("ruta inexistente (sin explicación) → route_missing", async () => {
    const real = await vi.importActual<typeof import("./commerceClient")>("./commerceClient");
    const c = real.commerceClientFromEnv({ CP_COMMERCE_URL: "https://cp.example", CP_COMMERCE_TOKEN: "t" } as NodeJS.ProcessEnv, async () => ({ status: 404, json: async () => ({ error: "not_found" }) }))!;
    await expect(c.request("t1", body)).rejects.toMatchObject({ status: 404, code: "route_missing" });
    const c2 = real.commerceClientFromEnv({ CP_COMMERCE_URL: "https://cp.example", CP_COMMERCE_TOKEN: "t" } as NodeJS.ProcessEnv, async () => ({ status: 404, json: async () => ({ error: "not_found", message: "Ese producto no está en tu catálogo" }) }))!;
    await expect(c2.request("t1", body)).rejects.toMatchObject({ status: 404, code: "not_found" });
    const c3 = real.commerceClientFromEnv({ CP_COMMERCE_URL: "https://cp.example", CP_COMMERCE_TOKEN: "t" } as NodeJS.ProcessEnv, async () => ({ status: 201, json: async () => ({ request: { outcome: "created", reference: "SOL-1", status: "pending" } }) }))!;
    expect(await c3.request("t1", body)).toEqual({ outcome: "created", reference: "SOL-1", status: "pending" });
  });

  it("el catálogo adjunta `marketplace` si viene junto a él", async () => {
    const real = await vi.importActual<typeof import("./commerceClient")>("./commerceClient");
    const c = real.commerceClientFromEnv({ CP_COMMERCE_URL: "https://cp.example", CP_COMMERCE_TOKEN: "t" } as NodeJS.ProcessEnv, async () => ({ status: 200, json: async () => ({ catalog: { items: [] }, marketplace: { net: { title: "X" } } }) }))!;
    expect(await c.catalog("t1")).toEqual({ items: [], marketplace: { net: { title: "X" } } });
  });
});
