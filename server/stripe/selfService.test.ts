import { describe, it, expect, beforeEach } from "vitest";
import crypto from "node:crypto";
import { issueTicket } from "../crm/publicApi";
import type { CatalogPort } from "../subscriptions/ports";
import type { CommercialOrder } from "../orchestrator/types";
import { SelfServiceCheckout, SelfServiceError, orderKeyOf, selfServiceBody, type SelfServiceBody } from "./selfService";

const SECRET = "s".repeat(40);
let clock = Date.UTC(2026, 9, 18, 10);
const catalogWith = (status: string): CatalogPort => ({ product: async (k: string) => (k === "essential" || k === "business" ? ({ key: k, commercialStatus: status } as never) : null), price: async () => null, offer: async () => [] }) as unknown as CatalogPort;

function setup(o: { status?: string; terms?: string | null } = {}) {
  const calls = { companies: 0, contacts: 0, orders: 0, accepts: 0, checkouts: 0 };
  const orders = new Map<string, CommercialOrder>();
  const svc = new SelfServiceCheckout({
    crm: {
      createCompany: async () => ({ id: 100 + ++calls.companies }),
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
  return { svc, calls };
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
