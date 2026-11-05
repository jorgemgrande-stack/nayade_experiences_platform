/**
 * «Contratar ahora» en el marketplace (/admin/ampliar y fichas): matriz única de acción para todos los productos y su
 * vía de contratación real (`checkoutVia`), calculada por `connect.catalog` con las mismas reglas que valida el servidor.
 *
 *  - Contratado → «Gestionar» (su ruta) o, sin ruta propia, «Abrir módulo» («Mis módulos»).
 *  - Disponible + compra posible → «Contratar ahora» (compra de módulos de siempre, confirmada en la ficha).
 *  - Disponible + prueba + administración + alta activada + módulo que entra en el alta → «Contratar ahora» al formulario
 *    de alta con el plan y el módulo preseleccionados (un único pago; activación con el pago confirmado).
 *  - Resto → «Solicitar información» (con su motivo) o «Me interesa».
 *
 * Con un doble del plano de control: sin Stripe ni red.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";
import type { CommerceClient } from "./commerceClient";

const fake = vi.hoisted(() => ({ state: { conversion: true as boolean | "error", previews: [] as unknown[] } }));

vi.mock("./commerceClient", async (orig) => {
  const real = await orig<typeof import("./commerceClient")>();
  const monthly = (amountCents: number) => ({ amountCents, currency: "EUR", taxIncluded: false, unit: null });
  const mod = (key: string, o: Record<string, unknown> = {}) => ({ key, name: key, family: "connect", kind: "module", metric: null, step: null, commercialStatus: "available", capabilities: [`${key}-cap`], monthly: monthly(1900), purchasable: true, ...o });
  const catalog = {
    purchasesEnabled: true,
    items: [
      mod("connect-people", { name: "Elephant People", capabilities: ["people-hr"] }),
      mod("connect-voice", { commercialStatus: "on_request", purchasable: false }),
      mod("connect-soon", { commercialStatus: "coming_soon", purchasable: false }),
      mod("connect-business", { card: { compatibleWith: ["business"] } }),
      mod("connect-needs", { card: { dependencies: ["connect-people"] } }),
      mod("connect-free", { monthly: null }),
      { key: "addon-users", name: "Usuarios", family: "addon", kind: "quantity", metric: "users", step: 1, commercialStatus: "available", capabilities: [], monthly: monthly(500), purchasable: true },
    ],
  };
  const client: Partial<CommerceClient> = {
    catalog: async () => catalog,
    conversionStatus: async () => {
      if (fake.state.conversion === "error") throw new real.CommerceError(503, "unreachable", "No responde");
      return { enabled: fake.state.conversion, reasons: fake.state.conversion ? [] : ["panel_conversion_disabled"] };
    },
    // Presupuesto del plano de control (importes SIEMPRE del servidor): el Core solo reenvía la selección
    conversionPreview: async (_t, input) => {
      fake.state.previews.push(input);
      const lines = [{ key: input.plan, name: "Essential", quantity: 1, amountCents: 2900, interval: "month", status: "ok" }, ...(input.add ?? []).map((k) => ({ key: k, name: "Elephant People", quantity: 1, amountCents: 1900, interval: "month", status: "ok" }))];
      return { plan: input.plan, interval: input.interval, quote: { ok: true, errors: [], currency: "EUR", lines, totals: { monthlyCents: lines.reduce((a, l) => a + l.amountCents, 0), yearlyCents: 0 } }, taxNotice: "Entorno de pruebas", termsVersion: "v1", privacyVersion: null };
    },
  };
  return { ...real, commerceClientFromEnv: () => client as CommerceClient };
});
vi.mock("./subscriptionDb", async (orig) => ({ ...(await orig<typeof import("./subscriptionDb")>()), countPanelUsers: async () => 1 }));
vi.mock("./supportContact", () => ({ resolveSupportContact: async () => ({ email: "ayuda@elephant.example" }) }));

import { router } from "./_core/trpc";
import { subscriptionRouter } from "./routers/subscriptionRouter";
import { connectRouter } from "./routers/connectRouter";
import { configureCapabilityAccess, _resetCapabilityAccessForTests } from "./_core/capabilities/access";
import { MemoryCapabilityStore } from "./_core/capabilities/store";
import { capabilitiesOfTier } from "./catalog/capabilities";
import { runWithTenant } from "./_core/tenant";
import { SELF_SERVICE_PLANS } from "./stripe/catalog";
import {
  applyConversionRequest,
  checkoutViaFor,
  conversionHref,
  conversionPlanFor,
  parseConversionRequest,
  withPendingOrders,
  type ConnectState,
  type PurchaseBlock,
} from "../shared/connectMarketplace";
import { MINE_PATH, primaryAction, resolveSlides } from "../shared/connectShowcase";
import { parseMarketplaceRoot } from "./connectCard";

const app = router({ subscription: subscriptionRouter, connect: connectRouter });
const ctxFor = (role: string): TrpcContext => ({
  user: { id: 1, openId: "o", email: "ana@empresa.example", name: "Ana", loginMethod: "local", role, createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() } as NonNullable<TrpcContext["user"]>,
  req: { protocol: "https", headers: {} } as TrpcContext["req"],
  res: {} as TrpcContext["res"],
});
const TRIAL = "skibox-prueba";
const PAID = "empresa-pago";
const ENT = "empresa-enterprise";
const clock = Date.UTC(2026, 10, 4, 10);
const store = new MemoryCapabilityStore();
const env = { ...process.env };
const catalogOf = (tenant: string, role = "admin") => runWithTenant(tenant, () => app.createCaller(ctxFor(role)).connect.catalog());
const view = { canPurchase: false, interestEnabled: true };

beforeAll(async () => {
  process.env.TENANT_MODE = "multi";
  configureCapabilityAccess(store, { now: () => clock, enforce: true, ttlMs: 0 });
  const tier = (tier: "essential" | "enterprise", validUntil: number | null, source: string) =>
    capabilitiesOfTier(tier).map((capabilityId) => ({ capabilityId, siteId: "", status: "active" as const, validUntil, source }));
  // Prueba gratuita de Essential (licencias con caducidad, ninguna de pago)
  await store.apply(TRIAL, tier("essential", clock + 14 * 86_400_000, "trial:7"), { actor: "test", reason: null, now: clock });
  await store.apply(PAID, tier("essential", null, "subscription:1"), { actor: "test", reason: null, now: clock });
  await store.apply(ENT, tier("enterprise", null, "subscription:2"), { actor: "test", reason: null, now: clock });
});
afterAll(() => {
  process.env = env;
  _resetCapabilityAccessForTests();
});
beforeEach(() => {
  fake.state.conversion = true;
  fake.state.previews = [];
});

describe("matriz de acción (pura)", () => {
  const item = (state: ConnectState, o: Partial<{ kind: "module" | "quantity"; purchasable: boolean; plans: string[]; dependencies: string[]; prices: unknown[]; commercialStatus: "available" | "on_request" | "coming_soon" }> = {}) => ({
    key: "connect-people",
    state,
    kind: "module" as const,
    purchasable: true,
    plans: [] as string[],
    dependencies: [] as string[],
    prices: [{ kind: "monthly" }] as unknown[],
    commercialStatus: "available" as const,
    openPath: null as string | null,
    ...o,
  });
  const decide = (i: ReturnType<typeof item>, purchaseBlock: PurchaseBlock, conversionEnabled: boolean, currentPlan: string | null = "essential") => {
    const conversionPlan = conversionEnabled ? conversionPlanFor(i, { currentPlan, selfServicePlans: SELF_SERVICE_PLANS }) : null;
    const checkoutVia = checkoutViaFor(i, { purchaseBlock, conversionEnabled, conversionPlan });
    return primaryAction({ ...i, checkoutVia, conversionPlan: checkoutVia === "conversion" ? conversionPlan : null }, { canPurchase: purchaseBlock === null, interestEnabled: true });
  };

  it("prueba + administración + alta activada → «Contratar ahora» al alta con el plan de la prueba y ESTE módulo", () => {
    expect(decide(item("available"), "trial", true)).toEqual({ kind: "convert", label: "Contratar ahora", href: "/admin/suscripcion?contratar=essential&modulos=connect-people#contratar" });
  });
  it("prueba sin alta activada → «Solicitar información» (nunca una promesa que el servidor rechazaría)", () => {
    expect(decide(item("available"), "trial", false)).toMatchObject({ kind: "request", label: "Solicitar información" });
  });
  it("pago de autoservicio, administración y compras abiertas → «Contratar ahora» con la compra de siempre (ficha)", () => {
    expect(decide(item("available"), null, false)).toEqual({ kind: "purchase", label: "Contratar ahora", href: null });
    // No se vende en línea → solicitar
    expect(decide(item("available", { purchasable: false }), null, false).kind).toBe("request");
  });
  it("contratado → «Gestionar» (su ruta) o, sin ruta propia, «Abrir módulo» («Mis módulos»)", () => {
    expect(decide({ ...item("active"), openPath: "/admin/personal" }, "trial", true)).toEqual({ kind: "open", label: "Gestionar", href: "/admin/personal" });
    expect(decide(item("active"), null, false)).toEqual({ kind: "open", label: "Abrir módulo", href: MINE_PATH });
  });
  it("bajo solicitud → «Solicitar información»; próximamente → «Me interesa» (también en la prueba)", () => {
    expect(decide(item("on_request", { commercialStatus: "on_request" }), "trial", true).kind).toBe("request");
    expect(decide(item("coming_soon", { commercialStatus: "coming_soon" }), "trial", true)).toMatchObject({ kind: "interest", label: "Me interesa" });
  });
  it("no administración, Enterprise o compras cerradas → «Solicitar información» (el motivo lo explica la ficha)", () => {
    for (const b of ["role", "plan", "closed", "unavailable"] as const) expect(decide(item("available"), b, true).kind).toBe("request");
  });
  it("el alta solo lleva módulos con precio, sin requisitos de otros módulos y no ampliaciones por unidades", () => {
    expect(decide(item("available", { prices: [] }), "trial", true).kind).toBe("request");
    expect(decide(item("available", { dependencies: ["connect-otro"] }), "trial", true).kind).toBe("request");
    expect(decide(item("available", { kind: "quantity" }), "trial", true).kind).toBe("request");
  });
  it("módulo de otro plan en la prueba: entra en el alta con el plan de autoservicio compatible más bajo", () => {
    expect(decide(item("not_eligible", { plans: ["business", "enterprise"] }), "trial", true)).toMatchObject({ kind: "convert", href: "/admin/suscripcion?contratar=business&modulos=connect-people#contratar" });
    // Solo Enterprise: no hay alta en línea posible
    expect(decide(item("not_eligible", { plans: ["enterprise"] }), "trial", true).kind).toBe("request");
    // Fuera de la prueba, «No disponible para tu plan» nunca se compra
    expect(decide(item("not_eligible", { plans: ["business"] }), null, true).kind).toBe("request");
  });
  it("un pedido propio en curso o un estado que no es de venta nunca ofrece contratar", () => {
    const [pending] = withPendingOrders([{ ...item("available"), reasons: [] }], new Set(["connect-people"]));
    expect(decide(pending as ReturnType<typeof item>, "trial", true).kind).toBe("none");
    for (const s of ["pending_setup", "activating", "incident"] as const) expect(["convert", "purchase"]).not.toContain(decide(item(s), "trial", true).kind);
  });
  it("carrusel: la llamada de una diapositiva de producto se mantiene si se puede contratar en el alta", () => {
    const slides = parseMarketplaceRoot({ slides: [{ id: "x", title: "T", primaryCta: { label: "Contratar People", target: { type: "product", value: "connect-people" } } }] }).slides;
    const p = { key: "connect-people", family: "connect", kind: "module" as const, state: "available" as const, purchasable: true };
    expect(resolveSlides(slides, { items: [{ ...p, checkoutVia: "conversion", conversionPlan: "essential" }], canPurchase: false, now: clock })[0].primaryCta?.label).toBe("Contratar People");
    expect(resolveSlides(slides, { items: [{ ...p, checkoutVia: null }], canPurchase: false, now: clock })[0].primaryCta?.label).toBe("Ver ficha");
  });
});

describe("preselección del formulario de alta", () => {
  const offered = [
    { key: "connect-people", name: "Elephant People" },
    { key: "connect-voice", name: "Elephant Voice" },
  ];
  it("la dirección de «Contratar ahora» se lee de vuelta: plan y módulo", () => {
    expect(parseConversionRequest(new URL(`https://x${conversionHref("essential", ["connect-people"])}`).search)).toEqual({ plan: "essential", modules: ["connect-people"] });
    expect(parseConversionRequest("?contratar=enterprise&modulos=connect-people")).toBeNull();
    expect(parseConversionRequest("?contratar=business&modulos=connect-people,MAL,../x,connect-people")).toEqual({ plan: "business", modules: ["connect-people"] });
    expect(parseConversionRequest("")).toBeNull();
  });
  it("marca el módulo pedido con el plan de la prueba y lo explica", () => {
    const r = applyConversionRequest({ plan: "essential", modules: ["connect-people"] }, { offered, currentPlan: "essential" });
    expect(r).toMatchObject({ plan: "essential", add: ["connect-people"] });
    expect(r.notes).toHaveLength(1);
    expect(r.notes[0]).toContain("Elephant People");
  });
  it("si el módulo pide otro plan, deja elegido ese plan y lo explica", () => {
    const r = applyConversionRequest({ plan: "business", modules: ["connect-people"] }, { offered, currentPlan: "essential" });
    expect(r.plan).toBe("business");
    expect(r.notes.some((n) => n.includes("plan Business"))).toBe(true);
  });
  it("lo que el formulario no ofrece no se marca (y se dice)", () => {
    const r = applyConversionRequest({ plan: "essential", modules: ["connect-otro"] }, { offered, currentPlan: "essential" });
    expect(r.add).toEqual([]);
    expect(r.notes[0]).toMatch(/no se puede añadir/);
  });
});

describe("connect.catalog decide la vía con las reglas del servidor", () => {
  it("Skibox en prueba de Essential, administración y alta activada: People «Contratar ahora» al alta, sin la nota de módulos sueltos", async () => {
    const cat = await catalogOf(TRIAL);
    expect([cat.purchaseBlock, cat.canPurchase, cat.plan?.key]).toEqual(["trial", false, "essential"]);
    expect(cat.conversion).toEqual({ enabled: true, plan: "essential" });
    const by = (k: string) => cat.items.find((i) => i.key === k)!;
    expect(by("connect-people")).toMatchObject({ state: "available", checkoutVia: "conversion", conversionPlan: "essential" });
    expect(primaryAction(by("connect-people"), { canPurchase: cat.canPurchase, interestEnabled: cat.interestEnabled })).toMatchObject({ kind: "convert", label: "Contratar ahora", href: "/admin/suscripcion?contratar=essential&modulos=connect-people#contratar" });
    expect(by("connect-business")).toMatchObject({ state: "not_eligible", checkoutVia: "conversion", conversionPlan: "business" });
    for (const k of ["connect-voice", "connect-soon", "connect-needs", "connect-free", "addon-users"]) expect(by(k).checkoutVia).toBeNull();
  });

  it("prueba con el alta desactivada (o el plano de control sin responder): «Solicitar información» con la nota de la prueba", async () => {
    for (const c of [false, "error"] as const) {
      fake.state.conversion = c;
      const cat = await catalogOf(TRIAL);
      expect(cat.conversion).toEqual({ enabled: false, plan: "essential" });
      const people = cat.items.find((i) => i.key === "connect-people")!;
      expect(people.checkoutVia).toBeNull();
      expect(primaryAction(people, { canPurchase: cat.canPurchase, interestEnabled: false }).kind).toBe("request");
    }
  });

  it("en prueba, quien no administra no ve el alta (solo la administración contrata)", async () => {
    const cat = await catalogOf(TRIAL, "agente");
    expect([cat.purchaseBlock, cat.conversion]).toEqual(["role", null]);
    expect(cat.items.every((i) => i.checkoutVia === null)).toBe(true);
  });

  it("empresa de pago (Essential): compra de siempre; Enterprise: ninguna vía en línea", async () => {
    const paid = await catalogOf(PAID);
    expect([paid.purchaseBlock, paid.conversion]).toEqual([null, null]);
    expect(paid.items.find((i) => i.key === "connect-people")).toMatchObject({ checkoutVia: "purchase", conversionPlan: null });
    expect(paid.items.find((i) => i.key === "connect-business")!.checkoutVia).toBeNull();
    const ent = await catalogOf(ENT);
    expect(ent.purchaseBlock).toBe("plan");
    expect(ent.items.every((i) => i.checkoutVia === null)).toBe(true);
  });

  it("el presupuesto del alta lleva plan + módulo con los importes del servidor (el navegador solo envía claves)", async () => {
    const p = (await runWithTenant(TRIAL, () => app.createCaller(ctxFor("admin")).subscription.conversionPreview({ plan: "essential", interval: "month", add: ["connect-people"] }))) as {
      quote: { lines: Array<{ key: string; amountCents: number }>; totals: { monthlyCents: number } };
    };
    expect(fake.state.previews).toEqual([{ plan: "essential", interval: "month", add: ["connect-people"] }]);
    expect(p.quote.lines.map((l) => [l.key, l.amountCents])).toEqual([
      ["essential", 2900],
      ["connect-people", 1900],
    ]);
    expect(p.quote.totals.monthlyCents).toBe(4800);
    // Importes que no vengan del servidor no se aceptan
    await expect(runWithTenant(TRIAL, () => app.createCaller(ctxFor("admin")).subscription.conversionPreview({ plan: "essential", interval: "month", add: ["connect-people"], amountCents: 1 } as never))).rejects.toMatchObject({ code: "BAD_REQUEST" });
    // Ni fuera de la prueba ni sin administración
    await expect(runWithTenant(PAID, () => app.createCaller(ctxFor("admin")).subscription.conversionPreview({ plan: "essential", interval: "month" }))).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    await expect(runWithTenant(TRIAL, () => app.createCaller(ctxFor("agente")).subscription.conversionPreview({ plan: "essential", interval: "month" }))).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
