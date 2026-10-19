import { describe, it, expect, beforeEach } from "vitest";
import crypto from "node:crypto";
import { issueTicket } from "../crm/publicApi";
import type { CatalogPort } from "../subscriptions/ports";
import type { CommercialOrder } from "../orchestrator/types";
import { SelfServiceCheckout, SelfServiceError, orderKeyOf, selfServiceBody, type SelfServiceBody } from "./selfService";
import { MemoryStripeStore } from "./store";
import type { ConsentVersions } from "./buyerProfile";

const SECRET = "s".repeat(40);
let clock = Date.UTC(2026, 9, 18, 10);
const catalogWith = (status: string): CatalogPort => ({ product: async (k: string) => (k === "essential" || k === "business" ? ({ key: k, commercialStatus: status } as never) : null), price: async () => null, offer: async () => [] }) as unknown as CatalogPort;

function setup(o: { status?: string; terms?: string | null; mode?: "test" | "live"; consent?: ConsentVersions } = {}) {
  const calls = { companies: 0, contacts: 0, orders: 0, accepts: 0, checkouts: 0 };
  const orders = new Map<string, CommercialOrder>();
  const companies: Array<{ name: string; taxId?: string }> = [];
  const buyers = new MemoryStripeStore(o.mode ?? "test");
  const svc = new SelfServiceCheckout({
    buyers,
    mode: o.mode,
    consent: o.consent,
    crm: {
      createCompany: async (input) => (companies.push(input), { id: 100 + ++calls.companies }),
      createContact: async () => void calls.contacts++,
    },
    orders: { byKey: async (k) => orders.get(k) ?? null },
    orchestrator: {
      create: async (i) => {
        calls.orders++;
        const ord = { id: 500 + calls.orders, state: "quoted", companyId: i.companyId, idempotencyKey: i.idempotencyKey } as unknown as CommercialOrder;
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
  const DECIDED: ConsentVersions = { terms: "v1", privacy: "p1", precontract: "pre1", withdrawal: "immediate_execution_ack" };
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
    const { svc, companies, buyers } = setup({ mode: "live", consent: DECIDED });
    await svc.start(without(body({ buyer: { type: "business", legalName: "Taller Norte SL", taxId: "B11111111", country: "ES", postalCode: "48001" }, consents: { terms: true, privacy: true, termsVersion: "v1", privacyVersion: "p1" } })));
    expect(companies).toEqual([{ name: "Taller Norte SL", taxId: "B11111111", email: "ana@autoservicio.example" }]);
    expect(await buyers.buyerProfile(501)).toMatchObject({ type: "business", scenario: "business:es_mainland", consent: { source: "web", terms: { version: "v1" }, privacy: { version: "p1" }, precontract: null } });
  });

  it("particular: sin decisión legal sobre el desistimiento no se contrata (503) y no se crea nada", async () => {
    const { svc, calls } = setup({ mode: "live", consent: { ...DECIDED, withdrawal: "pending" } });
    await expectCode(svc.start(without(body({ buyer: { type: "consumer", firstName: "Lucía", lastName: "Pérez", country: "ES", postalCode: "38001" } }))), "consumer_unavailable");
    expect(calls.companies).toBe(0);
  });

  it("particular: exige precontractual y la casilla propia del desistimiento; con todo, sin razón social ni NIF", async () => {
    const { svc, calls, companies, buyers } = setup({ mode: "live", consent: DECIDED });
    const consumer = { type: "consumer" as const, firstName: "Lucía", lastName: "Pérez", country: "ES", postalCode: "38001" };
    await expectCode(svc.start(without(body({ buyer: consumer, consents: { terms: true, privacy: true, termsVersion: "v1", privacyVersion: "p1", precontractVersion: "pre1" } }))), "consent_outdated");
    expect(calls.companies).toBe(0);
    await svc.start(without(body({ buyer: consumer, consents: { terms: true, privacy: true, termsVersion: "v1", privacyVersion: "p1", precontractVersion: "pre1", immediateExecution: true } })));
    expect(companies).toEqual([{ name: "Lucía Pérez", email: "ana@autoservicio.example" }]);
    expect(await buyers.buyerProfile(501)).toMatchObject({ type: "consumer", territory: "es_canarias", scenario: "consumer:es_special", taxId: null, consent: { precontract: { version: "pre1" }, immediateExecution: { at: clock } } });
  });

  it("sin código postal válido no se adivina el territorio (400) y no se crea nada", async () => {
    const { svc, calls } = setup({ mode: "live", consent: DECIDED });
    await expectCode(svc.start(without(body({ buyer: { type: "business", legalName: "Sin CP SL", taxId: "B22222222", country: "ES" }, consents: { terms: true, privacy: true, termsVersion: "v1", privacyVersion: "p1" } }))), "territory_unknown");
    expect(calls.companies).toBe(0);
  });

  it("el cuerpo exige comprador: ni empresa ni perfil → no válido", () => {
    expect(selfServiceBody.safeParse(without(body())).success).toBe(false);
  });
});
