/**
 * Endurecimiento del cobro online de la tienda (cartCheckout / createAndPay): precios por forma de producto en céntimos,
 * validaciones (enteros, opciones, límites de cantidad, importe mínimo), productos no vendibles, aislamiento de empresa,
 * descuentos (rechazo, consumo al confirmar el pago, pagos simultáneos) e idempotencia ante clics repetidos.
 * BD, pasarelas y correo simulados: no hay cobros ni escrituras reales.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const state = vi.hoisted(() => ({
  products: {} as Record<number, any>,
  variants: {} as Record<number, any[]>,
  created: [] as any[],
  stripe: [] as any[],
  redsys: [] as any[],
  discountRows: [] as any[],
  holds: 0,
  orders: {} as Record<string, { email: string; status: string; entries: any[] }>,
  seq: 0,
  db: null as any,
}));

vi.mock("./db", async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    getExperienceById: async (id: number) => state.products[id],
    getVariantsByExperience: async (id: number) => state.variants[id] ?? [],
    createReservation: async (r: any) => {
      state.created.push(r);
      state.orders[r.merchantOrder] ??= { email: r.customerEmail, status: "pending_payment", entries: [] };
      return { id: state.created.length };
    },
    getDb: async () => state.db,
  };
});

vi.mock("./redsys", async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    generateMerchantOrder: () => `TEST${String(++state.seq).padStart(6, "0")}`,
    isRedsysConfigured: () => true,
    buildRedsysForm: (p: { amount: number; merchantOrder: string }) => {
      state.redsys.push(p);
      return { url: "https://sandbox.invalid", fields: { amount: p.amount } };
    },
  };
});

vi.mock("./orderVariant", async (importOriginal) => ({ ...(await importOriginal<any>()), markOrderVariant: async () => {} }));

vi.mock("./inventoryDb", async (importOriginal) => ({ ...(await importOriginal<any>()), assertStockAvailable: async () => {}, markOrderStockLine: async () => {} }));

vi.mock("./pricingRulesDb", async (importOriginal) => ({ ...(await importOriginal<any>()), activeRules: async () => [] }));

vi.mock("./paymentsConnect/publicApi", async (importOriginal) => ({
  ...(await importOriginal<any>()),
  stripeAvailableForPublic: async () => true,
  stripeCheckoutForShopOrder: async (p: any) => {
    state.stripe.push(p);
    return { url: `https://stripe.invalid/${p.merchantOrder}` };
  },
}));

// Almacén de pedidos en memoria para la idempotencia (la consulta SQL real se verifica en el CI con MySQL)
vi.mock("./shopOrdersDb", async (importOriginal) => {
  const actual: any = await importOriginal();
  const rules: any = await import("./shopCheckoutRules");
  return {
    ...actual,
    recordCheckoutDetails: async () => {},
    appendOrderLogEntries: async (mo: string, entries: any[]) => {
      state.orders[mo].entries.push(...entries);
    },
    findPendingOrderByFingerprint: async (email: string, fp: string) =>
      Object.entries(state.orders).find(([, o]) => o.status === "pending_payment" && o.email === email && rules.fingerprintFromLog(o.entries) === fp)?.[0] ?? null,
    countPendingDiscountHolds: async () => state.holds,
  };
});

import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import { discountCodes, discountCodeUses, reservations } from "../drizzle/schema";
import { consumeOrderDiscount } from "./shopOrdersDb";
import { acquireCheckoutLock, discountLogEntry, eurosToCents, variantQuantityProblem, productPeopleProblem } from "./shopCheckoutRules";

const caller = () =>
  appRouter.createCaller({
    user: null,
    req: { protocol: "https", headers: {}, socket: {} } as unknown as TrpcContext["req"],
    res: { clearCookie: () => {}, cookie: () => {} } as unknown as TrpcContext["res"],
  });
const customer = { customerName: "Cliente de Prueba", customerEmail: "cliente@example.invalid", origin: "https://example.invalid" };
const item = (productId: number, over: Record<string, unknown> = {}) => ({ productId, bookingDate: "2026-12-01", people: 2, extras: [] as any, ...over });
const cart = (items: any[], over: Record<string, unknown> = {}) => ({ ...customer, items, ...over });

const product = (id: number, over: Record<string, unknown> = {}) => ({ id, title: `Producto ${id}`, basePrice: "50.00", pricingType: "per_person", isActive: true, isPublished: true, offerMode: "fixed", minPersons: 1, maxPersons: null, ...over });
const dcode = (over: Record<string, unknown> = {}) => ({ id: 7, code: "AMIGOS", discountType: "percent", discountPercent: "10.00", discountAmount: null, status: "active", expiresAt: null, maxUses: null, currentUses: 0, ...over });
const chainDb = () => ({
  select: () => ({ from: () => ({ where: () => ({ limit: async () => state.discountRows }) }) }),
  insert: () => ({ values: async () => ({}) }),
});

beforeEach(() => {
  state.products = { 1: product(1) };
  state.variants = {};
  state.created.length = 0;
  state.stripe.length = 0;
  state.redsys.length = 0;
  state.discountRows = [];
  state.holds = 0;
  state.orders = {};
  state.seq = 0;
  state.db = chainDb();
});

describe("precio por forma de producto (céntimos enteros, calculado en servidor)", () => {
  it("precio por persona con opciones fijas: 55 € × 2", async () => {
    state.variants[1] = [{ id: 10, priceType: "fixed", priceModifier: "55.00", name: "Premium" }];
    const r = await caller().reservations.cartCheckout(cart([item(1, { variantId: 10 })]));
    expect(r.totalAmountCents).toBe(11000);
    expect(state.created[0].amountTotal).toBe(11000);
  });

  it("tarifa individual (máx. 1) frente a «desde 2 participantes» (mín. 2), cada una por persona", async () => {
    state.variants[1] = [
      { id: 10, priceType: "fixed", priceModifier: "90.00", name: "Individual", minQty: null, maxQty: 1 },
      { id: 11, priceType: "per_person", priceModifier: "70.00", name: "Desde 2 participantes", minQty: 2, maxQty: null },
    ];
    expect((await caller().reservations.cartCheckout(cart([item(1, { variantId: 10, people: 1 })]))).totalAmountCents).toBe(9000);
    expect((await caller().reservations.cartCheckout(cart([item(1, { variantId: 11, people: 3 })]))).totalAmountCents).toBe(21000);
    // incumplidos
    await expect(caller().reservations.cartCheckout(cart([item(1, { variantId: 11, people: 1 })]))).rejects.toThrow(/requiere al menos 2 participantes/);
    await expect(caller().reservations.cartCheckout(cart([item(1, { variantId: 10, people: 2 })]))).rejects.toThrow(/admite como máximo 1 participante/);
    expect(state.created).toHaveLength(2);
  });

  it("límites nulos: la opción existente se compra con cualquier cantidad", async () => {
    state.variants[1] = [{ id: 10, priceType: "fixed", priceModifier: "20.00", name: "Normal", minQty: null, maxQty: null }, { id: 11, priceType: "fixed", priceModifier: "20.00", name: "Sin columnas" }];
    for (const v of [10, 11]) for (const people of [1, 50]) {
      expect((await caller().reservations.cartCheckout(cart([item(1, { variantId: v, people })]))).totalAmountCents).toBe(2000 * people);
    }
  });

  it("Basic/Premium con precio base 0: se cobra el precio de la opción; sin opción, no se vende", async () => {
    state.products[1] = product(1, { basePrice: "0.00" });
    state.variants[1] = [
      { id: 10, priceType: "fixed", priceModifier: "49.00", name: "Basic" },
      { id: 11, priceType: "fixed", priceModifier: "99.00", name: "Premium" },
    ];
    expect((await caller().reservations.cartCheckout(cart([item(1, { variantId: 11, people: 1 })]))).totalAmountCents).toBe(9900);
    expect((await caller().reservations.cartCheckout(cart([item(1, { variantId: 10, people: 2 })]))).totalAmountCents).toBe(9800);
    const n = state.created.length;
    await expect(caller().reservations.cartCheckout(cart([item(1)]))).rejects.toThrow(/precio/);
    expect(state.created).toHaveLength(n);
  });

  it("opción obligatoria: sin elegirla no se paga", async () => {
    state.variants[1] = [{ id: 10, priceType: "fixed", priceModifier: "30.00", name: "Talla M", isRequired: true }];
    await expect(caller().reservations.cartCheckout(cart([item(1)]))).rejects.toThrow(/Elige una opción/);
    expect(state.created).toHaveLength(0);
  });

  it("opción porcentual y por unidad, en enteros", async () => {
    state.products[1] = product(1, { basePrice: "100.00" });
    state.variants[1] = [{ id: 10, priceType: "percentage", priceModifier: "12.50", name: "Temporada alta" }];
    expect((await caller().reservations.cartCheckout(cart([item(1, { variantId: 10 })]))).totalAmountCents).toBe(22500);
    state.products[2] = product(2, { basePrice: "25.10", pricingType: "per_unit", unitCapacity: 4, maxUnits: null });
    expect((await caller().reservations.cartCheckout(cart([item(2, { people: 5 })]))).totalAmountCents).toBe(5020); // 2 unidades
  });

  it("decimales: sin errores de coma flotante", () => {
    expect(eurosToCents("19.99")).toBe(1999);
    expect(eurosToCents("0.10") * 3).toBe(30);
    expect(eurosToCents(1.005)).toBe(101);
    expect(eurosToCents("12.5")).toBe(1250);
  });
});

describe("validaciones de entrada", () => {
  it("personas y opción deben ser enteros; no se admite 0, negativos ni fracciones", async () => {
    await expect(caller().reservations.cartCheckout(cart([item(1, { people: 1.5 })]))).rejects.toThrow();
    await expect(caller().reservations.cartCheckout(cart([item(1, { people: 0 })]))).rejects.toThrow();
    await expect(caller().reservations.cartCheckout(cart([item(1, { variantId: 1.2 })]))).rejects.toThrow();
    await expect(caller().reservations.createAndPay({ ...customer, ...item(1, { people: 2.5 }) })).rejects.toThrow();
    expect(state.created).toHaveLength(0);
  });

  it("una opción inexistente o de otro producto se rechaza (no cae al precio base) en carrito y en createAndPay", async () => {
    state.products[2] = product(2);
    state.variants[2] = [{ id: 20, priceType: "fixed", priceModifier: "5.00", name: "Ajena" }];
    await expect(caller().reservations.cartCheckout(cart([item(1, { variantId: 20 })]))).rejects.toThrow(/ya no está disponible/);
    await expect(caller().reservations.cartCheckout(cart([item(1, { variantId: 999 })]))).rejects.toThrow(/ya no está disponible/);
    await expect(caller().reservations.createAndPay({ ...customer, ...item(1, { variantId: 20 }) })).rejects.toThrow(/ya no está disponible/);
    expect(state.created).toHaveLength(0);
  });

  it("límites del producto minPersons/maxPersons; nulos y mínimo 1 por defecto no cambian nada", async () => {
    state.products[1] = product(1, { minPersons: 2, maxPersons: 4 });
    await expect(caller().reservations.cartCheckout(cart([item(1, { people: 1 })]))).rejects.toThrow(/al menos 2/);
    await expect(caller().reservations.cartCheckout(cart([item(1, { people: 5 })]))).rejects.toThrow(/como máximo 4/);
    await expect(caller().reservations.createAndPay({ ...customer, ...item(1, { people: 5 }) })).rejects.toThrow(/como máximo 4/);
    expect((await caller().reservations.cartCheckout(cart([item(1, { people: 3 })]))).totalAmountCents).toBe(15000);
    state.products[1] = product(1, { minPersons: null, maxPersons: null });
    expect((await caller().reservations.cartCheckout(cart([item(1, { people: 1 })]))).totalAmountCents).toBe(5000);
    expect(productPeopleProblem({ title: "x", minPersons: 1, maxPersons: 0 }, 99)).toBeNull();
    expect(variantQuantityProblem(undefined, 1)).toBeNull();
  });

  it("importe mínimo 0,50 € y total 0 €: se rechaza antes de crear reservas y sin llamar a la pasarela", async () => {
    state.products[1] = product(1, { basePrice: "0.20" });
    await expect(caller().reservations.cartCheckout(cart([item(1, { people: 1 })], { provider: "stripe" }))).rejects.toThrow(/mínimo/);
    state.products[1] = product(1, { basePrice: "50.00" });
    state.discountRows = [dcode({ discountPercent: "100.00" })];
    await expect(caller().reservations.cartCheckout(cart([item(1)], { discountCodeId: 7, discountCode: "AMIGOS", provider: "stripe" }))).rejects.toThrow(/0 €/);
    await expect(caller().reservations.cartCheckout(cart([item(1)], { discountCodeId: 7, discountCode: "AMIGOS" }))).rejects.toThrow(/no se ha realizado ningún cobro/i);
    expect(state.created).toHaveLength(0);
    expect(state.stripe).toHaveLength(0);
    expect(state.redsys).toHaveLength(0);
  });
});

describe("productos que no se pueden comprar online (por cualquier vía de la API)", () => {
  const cases: Array<[string, Record<string, unknown>]> = [
    ["bajo petición", { offerMode: "on_request" }],
    ["precio visible solo por solicitud", { offerMode: "priced_request" }],
    ["próximamente", { offerMode: "coming_soon" }],
    ["inactivo", { isActive: false }],
    ["sin publicar", { isPublished: false }],
  ];
  for (const [name, over] of cases) {
    it(`${name}: ni carrito ni createAndPay, sin reservas ni cobro`, async () => {
      state.products[1] = product(1, over);
      await expect(caller().reservations.cartCheckout(cart([item(1)]))).rejects.toThrow();
      await expect(caller().reservations.cartCheckout(cart([item(1)], { provider: "stripe" }))).rejects.toThrow();
      await expect(caller().reservations.createAndPay({ ...customer, ...item(1) })).rejects.toThrow();
      expect(state.created).toHaveLength(0);
      expect(state.stripe).toHaveLength(0);
    });
  }

  it("un producto vendible junto a uno no vendible bloquea todo el carrito sin dejar reservas", async () => {
    state.products[2] = product(2, { offerMode: "on_request" });
    await expect(caller().reservations.cartCheckout(cart([item(1), item(2)]))).rejects.toThrow();
    expect(state.created).toHaveLength(0);
  });
});

describe("aislamiento multiempresa", () => {
  it("un producto que no existe en la base de ESTA empresa (id de otra) no se vende: NOT_FOUND, sin reservas ni cobro", async () => {
    // La base se resuelve por empresa en getDb()/getExperienceById; el id de otra empresa no existe aquí
    await expect(caller().reservations.cartCheckout(cart([item(4242)], { provider: "stripe" }))).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(state.created).toHaveLength(0);
    expect(state.stripe).toHaveLength(0);
  });

  it("la huella de idempotencia no cruza compradores: otro correo = otro pedido", async () => {
    const a = await caller().reservations.cartCheckout(cart([item(1)]));
    const b = await caller().reservations.cartCheckout(cart([item(1)], { customerEmail: "otra@example.invalid" }));
    expect(a.merchantOrder).not.toBe(b.merchantOrder);
  });
});

describe("códigos de descuento", () => {
  const withCode = (over: Record<string, unknown> = {}) => cart([item(1)], { discountCodeId: 7, discountCode: "AMIGOS", ...over });

  it("válido: se descuenta en servidor y el uso NO se consume al crear el carrito (queda anotado para el pago)", async () => {
    state.discountRows = [dcode()];
    const r = await caller().reservations.cartCheckout(withCode({ provider: "stripe" }));
    expect(r.totalAmountCents).toBe(10000);
    expect(state.stripe[0].amountCents).toBe(9000);
    const entry = state.orders[r.merchantOrder].entries.find((e) => e.action === "descuento_codigo");
    expect(JSON.parse(entry.to)).toMatchObject({ id: 7, code: "AMIGOS", discountCents: 1000, originalCents: 10000, finalCents: 9000 });
  });

  it("descuento fijo en céntimos exactos", async () => {
    state.discountRows = [dcode({ discountType: "fixed", discountAmount: "12.34" })];
    await caller().reservations.cartCheckout(withCode({ provider: "stripe" }));
    expect(state.stripe[0].amountCents).toBe(10000 - 1234);
  });

  const bad: Array<[string, Record<string, unknown> | null, RegExp]> = [
    ["inexistente", null, /no existe/],
    ["inactivo", { status: "inactive" }, /inactivo/],
    ["marcado caducado", { status: "expired" }, /caducado/],
    ["caducado por fecha", { expiresAt: new Date(Date.now() - 86_400_000) }, /caducado/],
    ["agotado", { maxUses: 3, currentUses: 3 }, /agotado/],
  ];
  for (const [name, over, re] of bad) {
    it(`${name}: se avisa y se rechaza, sin reservas ni cobro`, async () => {
      state.discountRows = over ? [dcode(over)] : [];
      await expect(caller().reservations.cartCheckout(withCode({ provider: "stripe" }))).rejects.toThrow(re);
      expect(state.created).toHaveLength(0);
      expect(state.stripe).toHaveLength(0);
    });
  }

  it("el id solo no basta: hay que conocer el código", async () => {
    state.discountRows = [dcode()];
    await expect(caller().reservations.cartCheckout(withCode({ discountCode: "OTRO" }))).rejects.toThrow(/no es válido/);
    await expect(caller().reservations.cartCheckout(withCode({ discountCode: undefined }))).rejects.toThrow(/no es válido/);
  });

  it("código de un solo uso con otro pago en curso: el segundo comprador espera (no se agota a la vez)", async () => {
    state.discountRows = [dcode({ maxUses: 1, currentUses: 0 })];
    state.holds = 1;
    await expect(caller().reservations.cartCheckout(withCode())).rejects.toThrow(/otro pago en curso/);
    state.holds = 0;
    await expect(caller().reservations.cartCheckout(withCode())).resolves.toBeTruthy();
  });
});

describe("clics repetidos en «pagar» (idempotencia)", () => {
  it("el mismo carrito reutiliza el pedido pendiente: un solo pedido, y con Stripe la misma sesión (misma clave)", async () => {
    const a = await caller().reservations.cartCheckout(cart([item(1)], { provider: "stripe" }));
    const b = await caller().reservations.cartCheckout(cart([item(1)], { provider: "stripe" }));
    expect(b.merchantOrder).toBe(a.merchantOrder);
    expect(state.created).toHaveLength(1);
    expect(state.stripe.map((s) => s.merchantOrder)).toEqual([a.merchantOrder, a.merchantOrder]);
    expect(b.stripeUrl).toBe(a.stripeUrl);
  });

  it("clics simultáneos: el cerrojo serializa las peticiones con la misma huella (la segunda ve el pedido de la primera) y no bloquea otras", async () => {
    const order: string[] = [];
    const task = async (key: string, n: number, ms: number) => {
      const release = await acquireCheckoutLock(key);
      order.push(`in${n}`);
      await new Promise((r) => setTimeout(r, ms));
      order.push(`out${n}`);
      release();
    };
    await Promise.all([task("a", 1, 20), task("a", 2, 1), task("a", 3, 1), task("b", 4, 1)]);
    const a = order.filter((x) => /[123]$/.test(x));
    expect(a).toEqual(["in1", "out1", "in2", "out2", "in3", "out3"]);
    expect(order.indexOf("in4")).toBeLessThan(order.indexOf("out1"));
  });

  it("un carrito distinto (otra cantidad, fecha u opción) es otro pedido", async () => {
    const a = await caller().reservations.cartCheckout(cart([item(1)]));
    const b = await caller().reservations.cartCheckout(cart([item(1, { people: 3 })]));
    const c = await caller().reservations.cartCheckout(cart([item(1, { bookingDate: "2026-12-02" })]));
    expect(new Set([a.merchantOrder, b.merchantOrder, c.merchantOrder]).size).toBe(3);
  });

  it("reintento legítimo tras pago fallido o caducado: pedido nuevo", async () => {
    const a = await caller().reservations.cartCheckout(cart([item(1)]));
    state.orders[a.merchantOrder].status = "failed";
    const b = await caller().reservations.cartCheckout(cart([item(1)]));
    expect(b.merchantOrder).not.toBe(a.merchantOrder);
    state.orders[b.merchantOrder].status = "cancelled";
    const c = await caller().reservations.cartCheckout(cart([item(1)]));
    expect(c.merchantOrder).not.toBe(b.merchantOrder);
    expect(state.created).toHaveLength(3);
  });
});

describe("consumo del código al confirmar el pago (consumeOrderDiscount)", () => {
  const info = { id: 7, code: "AMIGOS", percent: 10, discountCents: 1000, originalCents: 10000, finalCents: 9000 };
  const mk = (codeOver: Record<string, unknown> = {}, withDiscount = true) => {
    const s: any = {
      code: dcode(codeOver),
      reservations: [{ id: 55, changesLog: withDiscount ? [discountLogEntry(info, 1)] : [] }],
      uses: [] as any[],
      inserts: [] as any[],
      resvUpdates: [] as any[],
    };
    const make = (): any => ({
      select: () => ({
        from: (t: any) => ({
          where: () => {
            const rows = t === reservations ? s.reservations : t === discountCodeUses ? s.uses.filter((u: any) => u.reservationId === s.reservations[0].id) : [{ ...s.code, origin: "manual", compensationVoucherId: null }];
            const p: any = Promise.resolve(rows);
            p.limit = async () => rows.slice(0, 1);
            return p;
          },
        }),
      }),
      update: (t: any) => ({
        set: (v: any) => ({
          where: async () => {
            if (t === discountCodes) {
              const ok = s.code.maxUses === null || s.code.currentUses < s.code.maxUses;
              if (ok) s.code.currentUses++;
              return [{ affectedRows: ok ? 1 : 0 }];
            }
            if (t === reservations) s.resvUpdates.push(v);
            return [{ affectedRows: 1 }];
          },
        }),
      }),
      insert: (t: any) => ({ values: async (v: any) => { if (t === discountCodeUses) { s.uses.push(v); s.inserts.push(v); } } }),
      transaction: async (fn: any) => fn(make()),
    });
    state.db = make();
    return s;
  };

  it("consume un uso y registra la fila de uso del canal online; repetirlo (aviso duplicado) no cuenta de nuevo", async () => {
    const s = mk({ maxUses: 5 });
    expect(await consumeOrderDiscount("TEST000001", 9000)).toBe("consumed");
    expect(s.code.currentUses).toBe(1);
    expect(s.inserts[0]).toMatchObject({ discountCodeId: 7, channel: "online", reservationId: 55, finalAmount: "90.00", discountAmount: "10.00" });
    expect(await consumeOrderDiscount("TEST000001", 9000)).toBe("already");
    expect(await consumeOrderDiscount("TEST000001", 9000)).toBe("already");
    expect(s.code.currentUses).toBe(1);
    expect(s.inserts).toHaveLength(1);
  });

  it("pedido sin código: no hace nada", async () => {
    const s = mk({}, false);
    expect(await consumeOrderDiscount("TEST000001", 9000)).toBe("none");
    expect(s.inserts).toHaveLength(0);
  });

  it("pagos simultáneos de un código de un solo uso: el contador nunca pasa del límite y el exceso queda anotado", async () => {
    const s = mk({ maxUses: 1, currentUses: 0 });
    expect(await consumeOrderDiscount("TEST000001", 9000)).toBe("consumed");
    // segundo pedido distinto que llega ya con el código agotado: pago honrado, sin superar el límite
    s.reservations = [{ id: 56, changesLog: [discountLogEntry(info, 2)] }];
    expect(await consumeOrderDiscount("TEST000002", 9000)).toBe("overused");
    expect(s.code.currentUses).toBe(1);
    expect(s.inserts).toHaveLength(2);
    expect(s.resvUpdates.at(-1).changesLog.at(-1).action).toBe("descuento_agotado_en_pago");
  });

  it("código sin límite de usos: siempre cuenta", async () => {
    const s = mk({ maxUses: null });
    expect(await consumeOrderDiscount("TEST000001", 9000)).toBe("consumed");
    expect(s.code.currentUses).toBe(1);
  });
});
