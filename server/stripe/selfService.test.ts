import { describe, it, expect, beforeEach } from "vitest";
import crypto from "node:crypto";
import { issueTicket } from "../crm/publicApi";
import type { CatalogPort } from "../subscriptions/ports";
import type { CommercialOrder } from "../orchestrator/types";
import { SelfServiceCheckout, SelfServiceError, orderKeyOf, selfServiceBody, type SelfServiceBody } from "./selfService";
import { MemoryStripeStore } from "./store";
import type { ConsentVersions, FiscalScenario, TaxTreatment } from "./buyerProfile";
import type { EligibilityConfig } from "./eligibility";

const SECRET = "s".repeat(40);
let clock = Date.UTC(2026, 9, 18, 10);
const catalogWith = (status: string): CatalogPort => ({ product: async (k: string) => (k === "essential" || k === "business" ? ({ key: k, commercialStatus: status } as never) : null), price: async () => null, offer: async () => [{ key: "essential", name: "Essential", family: "core_plan", commercialStatus: status, prices: [{ id: 1, productKey: "essential", kind: "monthly", amountCents: 2900, currency: "EUR", unit: null, taxRateBp: 2100, taxIncluded: false, status: "approved" }, { id: 2, productKey: "essential", kind: "yearly", amountCents: 27900, currency: "EUR", unit: null, taxRateBp: 2100, taxIncluded: false, status: "approved" }] }, { key: "business", name: "Business", family: "core_plan", commercialStatus: status, prices: [{ id: 3, productKey: "business", kind: "monthly", amountCents: 7900, currency: "EUR", unit: null, taxRateBp: 2100, taxIncluded: false, status: "approved" }, { id: 4, productKey: "business", kind: "yearly", amountCents: 75900, currency: "EUR", unit: null, taxRateBp: 2100, taxIncluded: false, status: "approved" }] }] }) as unknown as CatalogPort;

function setup(o: { status?: string; terms?: string | null; mode?: "test" | "live"; consent?: ConsentVersions; eligibility?: EligibilityConfig; vat?: "valid" | "invalid" | "unavailable" } = {}) {
  const calls = { companies: 0, contacts: 0, orders: 0, accepts: 0, checkouts: 0 };
  const orders = new Map<string, CommercialOrder>();
  const companies: Array<{ name: string; taxId?: string }> = [];
  const buyers = new MemoryStripeStore(o.mode ?? "test");
  const svc = new SelfServiceCheckout({
    buyers,
    mode: o.mode,
    consent: o.consent,
    eligibility: o.eligibility,
    ...(o.vat ? { vat: { verify: async (country: string) => ({ status: o.vat!, country, vatNumber: "123456789", checkedAt: clock, consultationNumber: null, traderName: null, traderAddress: null, detail: null, orderId: null, reused: false }) } } : {}),
    crm: {
      createCompany: async (input) => (companies.push(input), { id: 100 + ++calls.companies }),
      createContact: async () => void calls.contacts++,
    },
    orders: { byKey: async (k) => orders.get(k) ?? null },
    orchestrator: {
      create: async (i) => {
        calls.orders++;
        const ord = { id: 500 + calls.orders, state: "quoted", companyId: i.companyId, idempotencyKey: i.idempotencyKey, request: i.request } as unknown as CommercialOrder;
        orders.set(i.idempotencyKey, ord);
        return { order: ord };
      },
      accept: async (id, input) => {
        calls.accepts++;
        expect(input.signatureRef).toMatch(/^web-terms:v1:[0-9a-f]{16}$/);
        return { order: { id, state: "contracted" } as unknown as CommercialOrder };
      },
    },
    checkout: { start: async (orderId) => (calls.checkouts++, { orderId, sessionId: `cs_test_${orderId}xxxxxxxx`, url: "https://checkout.stripe.com/c/pay/x", expiresAt: clock + 7_200_000, reused: false }) },
    catalog: catalogWith(o.status ?? "available"),
    ticketSecret: SECRET,
    origins: new Set(["https://web.example"]),
    termsVersion: o.terms === undefined ? "v1" : o.terms,
    now: () => clock,
  });
  return { svc, calls, companies, buyers };
}
const body = (over: Partial<SelfServiceBody> = {}): SelfServiceBody => ({
  idempotencyKey: crypto.randomUUID(),
  plan: "essential",
  interval: "month",
  company: { name: "Empresa Autoservicio SL" },
  admin: { name: "Ana Prueba", email: "ana@autoservicio.example" },
  consents: { terms: true, privacy: true, termsVersion: "v1" },
  ticket: issueTicket(SECRET, clock - 10_000),
  ...over,
});

describe("contratación por autoservicio (apagada por defecto)", () => {
  beforeEach(() => void (clock = Date.UTC(2026, 9, 18, 10)));

  it("crea empresa, administrador, pedido contratado y Checkout; el importe no viaja desde el navegador", async () => {
    const { svc, calls } = setup();
    const r = await svc.start(body());
    expect(r.url).toMatch(/^https:\/\/checkout\.stripe\.com\//);
    expect(calls).toEqual({ companies: 1, contacts: 1, orders: 1, accepts: 1, checkouts: 1 });
    expect(selfServiceBody.safeParse({ ...body(), amount: 1 }).success).toBe(false);
    expect(selfServiceBody.safeParse({ ...body(), plan: "enterprise" }).success).toBe(false);
  });

  it("la misma petición (misma clave) repetida: mismo pedido y sesión, sin otra empresa", async () => {
    const { svc, calls } = setup();
    const b = body();
    await svc.start(b);
    await svc.start({ ...b, ticket: issueTicket(SECRET, clock - 10_000) });
    expect(calls.companies).toBe(1);
    expect(calls.orders).toBe(1);
    expect(calls.checkouts).toBe(2);
    expect(orderKeyOf(b.idempotencyKey)).toMatch(/^ss-[0-9a-f]{32}$/);
  });

  it.each([
    ["sin condiciones publicadas", { terms: null }, {}, "terms_unpublished"],
    ["plan «bajo solicitud» (hoy Essential y Business)", { status: "on_request" }, {}, "plan_not_self_service"],
    ["condiciones aceptadas desactualizadas", {}, { consents: { terms: true, privacy: true, termsVersion: "v0" } }, "terms_outdated"],
    ["campo trampa relleno", {}, { website: "http://spam" }, "rejected"],
    ["ticket falso", {}, { ticket: "v1.x.y.z" }, "invalid_ticket"],
    ["formulario enviado demasiado rápido", {}, { ticket: "__FAST__" }, "too_fast"],
  ] as const)("rechaza: %s", async (_n, opts, over, code) => {
    const { svc, calls } = setup(opts as never);
    const b = body(over as never);
    if ((over as { ticket?: string }).ticket === "__FAST__") b.ticket = issueTicket(SECRET, clock);
    await expect(svc.start(b)).rejects.toMatchObject({ code });
    expect(calls.companies).toBe(0);
    expect(calls.checkouts).toBe(0);
  });

  it("límite por correo: tres altas por hora con el mismo administrador", async () => {
    const { svc } = setup();
    for (let i = 0; i < 3; i++) await svc.start(body());
    await expect(svc.start(body())).rejects.toBeInstanceOf(SelfServiceError);
    clock += 3_700_000;
    await expect(svc.start(body({ ticket: issueTicket(SECRET, clock - 10_000) }))).resolves.toBeTruthy();
  });
});

describe("autoservicio con perfil fiscal del comprador (B2B y B2C)", () => {
  beforeEach(() => void (clock = Date.UTC(2026, 9, 19, 10)));
  const DECIDED: ConsentVersions = { terms: "v1", privacy: "2026-10-25", precontract: "pre1", withdrawal: "immediate_execution_ack" };
  // Empresas de la Península y Baleares; particulares de Canarias (sin IVA español: precio final = neto)
  const OPEN: EligibilityConfig = {
    scenarios: new Set<FiscalScenario>(["business:es_mainland", "consumer:es_special"]),
    taxExpectations: new Map<FiscalScenario, TaxTreatment>([
      ["business:es_mainland", "taxed"],
      ["consumer:es_special", "not_subject"],
    ]),
    countries: new Map(),
    consumerRates: new Map([["ES-CN", 0]]),
  };
  const without = (b: SelfServiceBody) => {
    const { company: _c, ...rest } = b;
    return rest as SelfServiceBody;
  };
  const expectCode = async (p: Promise<unknown>, code: string) => {
    const e = await p.catch((x) => x);
    expect(e).toBeInstanceOf(SelfServiceError);
    expect((e as SelfServiceError).code).toBe(code);
  };

  it("live: sin perfil del comprador se rechaza antes de crear nada", async () => {
    const { svc, calls } = setup({ mode: "live", consent: DECIDED });
    await expectCode(svc.start(body()), "buyer_required");
    expect(calls).toEqual({ companies: 0, contacts: 0, orders: 0, accepts: 0, checkouts: 0 });
  });

  it("empresa: la ficha sale del perfil (razón social y NIF) y se guarda el perfil con su consentimiento", async () => {
    const { svc, companies, buyers } = setup({ mode: "live", consent: DECIDED, eligibility: OPEN });
    await svc.start(without(body({ buyer: { type: "business", legalName: "Taller Norte SL", taxId: "B11111119", country: "ES", postalCode: "48001", line1: "Gran Vía, 10", city: "Bilbao" }, consents: { terms: true, privacy: true, termsVersion: "v1", privacyVersion: "2026-10-25" } })));
    expect(companies).toEqual([{ name: "Taller Norte SL", taxId: "B11111119", email: "ana@autoservicio.example" }]);
    expect(await buyers.buyerProfile(501)).toMatchObject({ type: "business", scenario: "business:es_mainland", consent: { source: "web", terms: { version: "v1" }, privacy: { version: "2026-10-25" }, precontract: null } });
  });

  it("particular: sin decisión legal sobre el desistimiento no se contrata (503) y no se crea nada", async () => {
    const { svc, calls } = setup({ mode: "live", consent: { ...DECIDED, withdrawal: "pending" } });
    await expectCode(svc.start(without(body({ buyer: { type: "consumer", firstName: "Lucía", lastName: "Pérez", country: "ES", postalCode: "38001" } }))), "consumer_unavailable");
    expect(calls.companies).toBe(0);
  });

  it("particular: exige precontractual y la casilla propia del desistimiento; con todo, sin razón social ni NIF", async () => {
    const { svc, calls, companies, buyers } = setup({ mode: "live", consent: DECIDED, eligibility: OPEN });
    const consumer = { type: "consumer" as const, firstName: "Lucía", lastName: "Pérez", country: "ES", postalCode: "38001", line1: "Calle del Castillo, 5", city: "Santa Cruz de Tenerife" };
    await expectCode(svc.start(without(body({ buyer: consumer, consents: { terms: true, privacy: true, termsVersion: "v1", privacyVersion: "2026-10-25", precontractVersion: "pre1" } }))), "consent_outdated");
    expect(calls.companies).toBe(0);
    await svc.start(without(body({ buyer: consumer, consents: { terms: true, privacy: true, termsVersion: "v1", privacyVersion: "2026-10-25", precontractVersion: "pre1", immediateExecution: true } })));
    expect(companies).toEqual([{ name: "Lucía Pérez", email: "ana@autoservicio.example" }]);
    expect(await buyers.buyerProfile(501)).toMatchObject({ type: "consumer", territory: "es_canarias", scenario: "consumer:es_special", taxId: null, consent: { precontract: { version: "pre1" }, immediateExecution: { at: clock } } });
  });

  it("sin código postal válido no se adivina el territorio (400) y no se crea nada", async () => {
    const { svc, calls } = setup({ mode: "live", consent: DECIDED });
    await expectCode(svc.start(without(body({ buyer: { type: "business", legalName: "Sin CP SL", taxId: "B22222228", country: "ES" }, consents: { terms: true, privacy: true, termsVersion: "v1", privacyVersion: "2026-10-25" } }))), "territory_unknown");
    expect(calls.companies).toBe(0);
  });

  it("live: un comprador no habilitado (país, NIF o domicilio) se rechaza ANTES de crear empresa, contacto o pedido", async () => {
    const consents = { terms: true as const, privacy: true as const, termsVersion: "v1", privacyVersion: "2026-10-25" };
    const cases: Array<[SelfServiceBody["buyer"], string]> = [
      [{ type: "business", legalName: "Tokyo KK", taxId: "1234567890123", country: "JP", line1: "1-1 Chiyoda", city: "Tokio" }, "country_not_enabled:JP"],
      [{ type: "business", legalName: "Taller Norte SL", taxId: "B12345678", country: "ES", postalCode: "48001", line1: "Gran Vía, 10", city: "Bilbao" }, "tax_id_invalid"],
      [{ type: "business", legalName: "Taller Norte SL", taxId: "B11111119", country: "ES", postalCode: "48001" }, "address_incomplete"],
      [{ type: "business", legalName: "Ceuta SL", taxId: "B11111119", country: "ES", postalCode: "51001", line1: "Paseo del Revellín, 1", city: "Ceuta" }, "scenario_pending:business:es_special"],
    ];
    for (const [buyer] of cases) {
      const { svc, calls } = setup({ mode: "live", consent: DECIDED, eligibility: OPEN });
      await expectCode(svc.start(without(body({ buyer, consents }))), "not_eligible");
      expect(calls).toEqual({ companies: 0, contacts: 0, orders: 0, accepts: 0, checkouts: 0 });
    }
    // Y la consulta pública da el motivo exacto de cada uno (el domicilio no cuenta: lo pide el formulario)
    const { svc } = setup({ mode: "live", consent: DECIDED, eligibility: OPEN });
    for (const [buyer, reason] of cases.filter(([, r]) => r !== "address_incomplete")) {
      const b = buyer as { type: "business"; country: string; postalCode?: string; taxId?: string };
      const r = await svc.eligibility({ type: b.type, country: b.country, postalCode: b.postalCode, taxId: b.taxId });
      expect(r.eligible).toBe(false);
      expect(r.reasons).toContain(reason);
    }
  });

  it("consulta pública: precio final con impuestos para particulares con tipo decidido; neto para empresas; nada se crea", async () => {
    const withMainland: EligibilityConfig = { ...OPEN, scenarios: new Set([...OPEN.scenarios, "consumer:es_mainland"]), taxExpectations: new Map([...OPEN.taxExpectations, ["consumer:es_mainland", "taxed"]]), consumerRates: new Map([...OPEN.consumerRates, ["ES", 2100]]) };
    const { svc, calls } = setup({ mode: "live", consent: DECIDED, eligibility: withMainland });
    expect(await svc.eligibility({ type: "consumer", country: "ES", postalCode: "28002", plan: "essential", interval: "month" })).toEqual({
      eligible: true,
      reasons: [],
      territory: "es_mainland",
      scenario: "consumer:es_mainland",
      price: { netCents: 2900, taxCents: 609, grossCents: 3509, rateBp: 2100 },
    });
    expect((await svc.eligibility({ type: "business", country: "ES", postalCode: "28002", taxId: "B11111119", plan: "essential", interval: "month" })).price).toEqual({ netCents: 2900, taxCents: null, grossCents: null, rateBp: null });
    expect(calls).toEqual({ companies: 0, contacts: 0, orders: 0, accepts: 0, checkouts: 0 });
  });

  it("empresa de la UE con inversión del sujeto pasivo: con VIES caído o NIF-IVA no válido no se crea nada; verificado, sí", async () => {
    const EU: EligibilityConfig = { ...OPEN, scenarios: new Set([...OPEN.scenarios, "business:eu"]), taxExpectations: new Map([...OPEN.taxExpectations, ["business:eu", "reverse_charge"]]) };
    const buyer = { type: "business" as const, legalName: "Firma GmbH", taxId: "DE123456789", country: "DE", postalCode: "10115", line1: "Unter den Linden 1", city: "Berlin" };
    const consents = { terms: true as const, privacy: true as const, termsVersion: "v1", privacyVersion: "2026-10-25" };
    for (const [vat, reason] of [["unavailable", "vat_check_unavailable"], ["invalid", "vat_invalid"]] as const) {
      const { svc, calls } = setup({ mode: "live", consent: DECIDED, eligibility: EU, vat });
      await expectCode(svc.start(without(body({ buyer, consents }))), "not_eligible");
      expect(calls).toEqual({ companies: 0, contacts: 0, orders: 0, accepts: 0, checkouts: 0 });
      expect((await svc.eligibility({ type: "business", country: "DE", postalCode: "10115", taxId: "DE123456789" })).reasons).toEqual([reason]);
    }
    const { svc, calls } = setup({ mode: "live", consent: DECIDED, eligibility: EU, vat: "valid" });
    await svc.start(without(body({ buyer, consents })));
    expect(calls.checkouts).toBe(1);
  });

  it("el cuerpo exige comprador: ni empresa ni perfil → no válido", () => {
    expect(selfServiceBody.safeParse(without(body())).success).toBe(false);
  });
});

describe("checkout unificado: carrito en el autoservicio", () => {
  beforeEach(() => void (clock = Date.UTC(2026, 10, 10, 10)));
  const fakeCart = (calls: string[]) =>
    ({
      checkPlan: async () => undefined,
      offer: async () => ({ plans: [], products: [], catalogVersion: "v", currency: "EUR", taxIncluded: false }),
      validate: async (i: { plan: string; interval: string; products?: string[] }) => {
        calls.push(`${i.plan}+${(i.products ?? []).join(",")}`);
        const line = (productKey: string, cents: number) => ({ productKey, name: productKey, interval: "month" as const, quantity: 1, unitAmountCents: cents, stripePriceId: `price_${productKey}`, stripeProductId: `prod_${productKey}` });
        return {
          request: { plan: i.plan, interval: i.interval, items: (i.products ?? []).map((key) => ({ key })) },
          quote: { catalogVersion: "v", plan: { key: i.plan, name: "Essential", interval: "month" }, lines: [{ key: "essential", family: "core_plan" }, { key: "social-token-net-complete", family: "net_bundle" }], totals: { taxRateBp: 2100 } },
          lines: { recurring: [line("essential", 2900), line("social-token-net-complete", 5900)], deferred: [], firstChargeCents: 8800, monthlyCents: 8800, yearlyCents: 0 },
        };
      },
    }) as never;

  it("sin carrito configurado, un producto se rechaza ANTES de crear nada", async () => {
    const { svc, calls } = setup();
    await expect(svc.start(body({ products: ["social-token-net-complete"] }))).rejects.toMatchObject({ code: "no_online", product: "social-token-net-complete" });
    expect(calls.companies).toBe(0);
  });

  it("presupuesto en live con Stripe Tax: estimación orientativa del 21 % sobre 88 € (no definitiva)", async () => {
    const { svc } = setup();
    const calls: string[] = [];
    const live = new SelfServiceCheckout({ ...(svc as unknown as { d: ConstructorParameters<typeof SelfServiceCheckout>[0] }).d, cart: fakeCart(calls), taxTreatment: "stripe_tax_exclusive" });
    const q = await live.quote({ plan: "essential", interval: "month", products: ["social-token-net-complete"] });
    expect(q.totals.firstChargeNetCents).toBe(8800);
    expect(q.tax).toEqual({ treatment: "stripe_tax_exclusive", estimatedRateBp: 2100, estimatedTaxCents: 1848, estimatedGrossCents: 10648, final: false });
    // Comprador no habilitado (sin escenarios aprobados): sin estimación y con los motivos
    const nb = await live.quote({ plan: "essential", interval: "month", products: [], buyer: { type: "business", country: "ES", postalCode: "28002", taxId: "B12345674" } });
    expect(nb.eligibility?.eligible).toBe(false);
    expect(nb.tax.estimatedRateBp).toBeNull();
    // En pruebas: neto sin impuestos
    const test = new SelfServiceCheckout({ ...(svc as unknown as { d: ConstructorParameters<typeof SelfServiceCheckout>[0] }).d, cart: fakeCart(calls), taxTreatment: "test_net_no_tax" });
    expect((await test.quote({ plan: "essential", interval: "month" })).tax).toMatchObject({ treatment: "test_net_no_tax", estimatedRateBp: null });
  });

  it("el pedido lleva los productos validados por el servidor; sin poder sustituir pedidos, la misma clave con otro carrito se rechaza", async () => {
    const { svc, calls } = setup();
    const seen: string[] = [];
    const created: unknown[] = [];
    const d = (svc as unknown as { d: ConstructorParameters<typeof SelfServiceCheckout>[0] }).d;
    const withCart = new SelfServiceCheckout({ ...d, cart: fakeCart(seen), orchestrator: { ...d.orchestrator, create: async (i) => (created.push(i.request), d.orchestrator.create(i)) } });
    const b = body({ products: ["social-token-net-complete"] });
    await withCart.start(b);
    expect(created).toEqual([{ plan: "essential", interval: "month", items: [{ key: "social-token-net-complete" }] }]);
    expect(seen).toEqual(["essential+social-token-net-complete"]);
    expect(calls.companies).toBe(1);
    await expect(withCart.start({ ...b, products: [], ticket: issueTicket(SECRET, clock - 10_000) })).rejects.toMatchObject({ code: "idempotency_mismatch" });
    expect(calls.companies).toBe(1);
  });
});
