/**
 * Compra de tienda ligada a una convocatoria: reglas puras y circuito de plazas contra una BD SIMULADA en memoria.
 * La simulación interpreta solo las sentencias de este circuito (con la misma semántica que InnoDB: cada UPDATE
 * condicionado es atómico). La concurrencia real con MySQL está en compraConvocatoria.mysql.test.ts (opt-in, CI).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import {
  editionBasePrice,
  editionLocalDate,
  editionNote,
  editionRequirement,
  editionSaleVerdict,
  type SaleEdition,
} from "../shared/editionPurchase";

const NOW = Date.UTC(2037, 0, 1, 12);
const DAY = 86_400_000;

const ed = (over: Partial<SaleEdition> = {}): SaleEdition => ({
  id: 1,
  experienceId: 10,
  label: "Retiro de primavera",
  startsAt: NOW + 30 * DAY,
  endsAt: NOW + 33 * DAY,
  timezone: "Europe/Madrid",
  locationNote: "Casa de retiros",
  capacity: 2,
  reserved: 0,
  status: "open",
  priceOverride: null,
  ...over,
});

describe("reglas puras de la compra por convocatoria", () => {
  it("edición válida, ajena, cerrada, empezada y llena", () => {
    expect(editionSaleVerdict(ed(), 10, 2, NOW)).toEqual({ ok: true, seatsLeft: 2 });
    expect(editionSaleVerdict(ed({ capacity: null }), 10, 50, NOW)).toEqual({ ok: true, seatsLeft: null });
    expect(editionSaleVerdict(ed(), 11, 1, NOW)).toMatchObject({ ok: false, code: "edition_not_found" });
    expect(editionSaleVerdict(null, 10, 1, NOW)).toMatchObject({ ok: false, code: "edition_not_found" });
    for (const status of ["closed", "draft", "waitlist", "cancelled"]) expect(editionSaleVerdict(ed({ status }), 10, 1, NOW)).toMatchObject({ ok: false, code: "not_open" });
    expect(editionSaleVerdict(ed({ startsAt: NOW - 1 }), 10, 1, NOW)).toMatchObject({ ok: false, code: "started" });
    expect(editionSaleVerdict(ed({ reserved: 2 }), 10, 1, NOW)).toMatchObject({ ok: false, code: "sold_out" });
    expect(editionSaleVerdict(ed({ reserved: 1 }), 10, 2, NOW)).toMatchObject({ ok: false, code: "not_enough_seats" });
    expect(editionSaleVerdict(ed(), 10, 0, NOW)).toMatchObject({ ok: false, code: "bad_seats" });
    expect(editionSaleVerdict(ed(), 10, 1.5, NOW)).toMatchObject({ ok: false, code: "bad_seats" });
  });

  it("exige elegir fecha si hay alguna abierta y bloquea la compra si solo hay cerradas o pasadas", () => {
    expect(editionRequirement([], NOW)).toBe("none");
    expect(editionRequirement([ed(), ed({ id: 2, status: "closed" })], NOW)).toBe("choose");
    expect(editionRequirement([ed({ status: "closed" }), ed({ id: 3, startsAt: NOW - DAY })], NOW)).toBe("blocked");
    expect(editionRequirement([ed({ status: "draft" })], NOW)).toBe("blocked");
  });

  it("priceOverride sustituye al precio base; sin él (o a 0) se usa el del producto", () => {
    expect(editionBasePrice(450, 500)).toBe(450);
    expect(editionBasePrice(null, 500)).toBe(500);
    expect(editionBasePrice(0, 500)).toBe(500);
  });

  it("fecha local en la zona de la edición y nota operativa con inicio, fin y lugar", () => {
    // 23:30 UTC del 9 de marzo ya es 10 de marzo en Madrid (UTC+1)
    expect(editionLocalDate(Date.UTC(2037, 2, 9, 23, 30), "Europe/Madrid")).toBe("2037-03-10");
    expect(editionLocalDate(Date.UTC(2037, 2, 9, 23, 30), "America/Bogota")).toBe("2037-03-09");
    expect(editionNote(ed({ startsAt: Date.UTC(2037, 2, 10, 9), endsAt: Date.UTC(2037, 2, 12, 13) }))).toBe("Convocatoria: Retiro de primavera · 2037-03-10 a 2037-03-12 · Casa de retiros");
    expect(editionNote(ed({ endsAt: null, locationNote: "" }))).not.toContain("a 20");
  });
});

// ─── BD simulada ─────────────────────────────────────────────────────────────

interface Res { id: number; status: string; merchant_order: string; inventory_kind: string | null; inventory_ref_id: number | null; inventory_units: number | null; hold_status: string | null; hold_release_reason: string | null; hold_expires_at: number | null; stay_check_in: null; stay_check_out: null }
const store = { editions: [] as Array<Record<string, any>>, res: [] as Res[], nextRes: 1 };
const dialect = new MySqlDialect();

function exec(q: any): [any] {
  const { sql: raw, params } = dialect.sqlToQuery(q);
  const s = raw.replace(/\s+/g, " ").trim();
  const p = params as any[];
  const ok = (n: number): [any] => [{ affectedRows: n }];
  const edition = (id: number) => store.editions.find((e) => e.id === id);
  const holdRows = (f: (r: Res) => boolean) => store.res.filter(f).map((r) => ({ ...r }));
  let m: RegExpMatchArray | null;

  if (s.startsWith("SELECT * FROM product_editions WHERE experience_id")) return [store.editions.filter((e) => e.experience_id === p[0]).map((e) => ({ ...e }))];
  if (s.startsWith("SELECT capacity, reserved FROM product_editions")) return [[{ ...edition(p[0]) }]];
  if (s.startsWith("UPDATE product_editions SET reserved = reserved + ?, updated_at = ? WHERE id = ? AND experience_id = ?")) {
    const [seats, , id, exp, startsAfter, seats2] = p;
    const e = edition(id);
    if (!e || e.experience_id !== exp || e.status !== "open" || !(e.starts_at > startsAfter)) return ok(0);
    if (e.capacity != null && e.reserved + seats2 > e.capacity) return ok(0);
    e.reserved += seats;
    return ok(1);
  }
  if (s.startsWith("UPDATE product_editions SET reserved = reserved + ?, updated_at = ? WHERE id = ? AND status <> 'cancelled'")) {
    const [units, , id, units2] = p;
    const e = edition(id);
    if (!e || e.status === "cancelled" || (e.capacity != null && e.reserved + units2 > e.capacity)) return ok(0);
    e.reserved += units;
    return ok(1);
  }
  if (s.startsWith("UPDATE product_editions SET reserved = GREATEST(reserved - ?, 0)")) {
    const e = edition(p[2]);
    if (e) e.reserved = Math.max(0, e.reserved - p[0]);
    return ok(1);
  }
  if ((m = s.match(/^SELECT .* FROM reservations WHERE inventory_kind = 'edition_seat' AND inventory_ref_id = \? AND hold_status IN/))) {
    return [holdRows((r) => r.inventory_kind === "edition_seat" && r.inventory_ref_id === p[0] && ["retenida", "confirmada"].includes(r.hold_status ?? ""))];
  }
  if (s.startsWith("SELECT id, status, inventory_kind") && s.includes("FROM reservations WHERE id = ?")) return [holdRows((r) => r.id === p[0])];
  if (s.startsWith("SELECT id, status, inventory_kind") && s.includes("WHERE inventory_kind IS NOT NULL AND (")) {
    const now = p[0];
    return [holdRows((r) => r.inventory_kind != null && (
      (["retenida", "confirmada"].includes(r.hold_status ?? "") && ["cancelled", "failed"].includes(r.status)) ||
      (r.hold_status === "retenida" && (r.status === "paid" || (r.hold_expires_at ?? Infinity) <= now)) ||
      (r.hold_status === "liberada" && r.status === "paid")))];
  }
  if (s.startsWith("SELECT id FROM reservations WHERE merchant_order = ? AND inventory_kind IS NOT NULL")) return [holdRows((r) => r.merchant_order === p[0] && r.inventory_kind != null).map((r) => ({ id: r.id }))];
  if (s.startsWith("UPDATE reservations SET inventory_kind = 'edition_seat'")) {
    const r = store.res.find((x) => x.id === p[3])!;
    Object.assign(r, { inventory_kind: "edition_seat", inventory_ref_id: p[0], inventory_units: p[1], hold_status: "retenida", hold_expires_at: p[2], hold_release_reason: null });
    return ok(1);
  }
  if (s.startsWith("UPDATE reservations SET hold_status = 'liberada'")) {
    const r = store.res.find((x) => x.id === p[2])!;
    if (!["retenida", "confirmada"].includes(r.hold_status ?? "")) return ok(0);
    r.hold_status = "liberada";
    r.hold_release_reason = p[0];
    return ok(1);
  }
  if (s.startsWith("UPDATE reservations SET hold_status = ?")) {
    const r = store.res.find((x) => x.id === p[2])!;
    r.hold_status = p[0];
    return ok(1);
  }
  if (s.startsWith("UPDATE reservations SET status = 'cancelled'")) {
    let n = 0;
    for (const r of store.res) if (r.merchant_order === p[1] && r.status === "pending_payment") (r.status = "cancelled"), n++;
    return ok(n);
  }
  throw new Error("SQL no simulado: " + s);
}

vi.mock("./db", () => {
  const fake: any = {
    execute: async (q: any) => {
      await Promise.resolve(); // cede el turno: dos compradores se intercalan
      return exec(q);
    },
    transaction: async (fn: any) => fn(fake),
  };
  return {
    getDb: async () => fake,
    generateReservationNumber: async () => `R-${store.nextRes}`,
    createReservation: async (data: any) => {
      await Promise.resolve();
      const r: Res = { id: store.nextRes++, status: "pending_payment", merchant_order: data.merchantOrder, inventory_kind: null, inventory_ref_id: null, inventory_units: null, hold_status: null, hold_release_reason: null, hold_expires_at: null, stay_check_in: null, stay_check_out: null };
      store.res.push(r);
      return { id: r.id };
    },
  };
});

const { prepareEditionLine, createEditionLine, cancelPendingOrder } = await import("./editionPurchaseDb");
const { applyPaymentToInventoryHolds, syncInventoryHolds, releaseInventoryHold, confirmInventoryHold } = await import("./inventoryHoldsDb");

const seed = (over: Record<string, any> = {}) =>
  store.editions.push({ id: 1, experience_id: 10, label: "Retiro de primavera", starts_at: Date.now() + 30 * DAY, ends_at: Date.now() + 33 * DAY, timezone: "Europe/Madrid", location_note: "Casa de retiros", capacity: 2, reserved: 0, status: "open", price_override: null, ...over });
const data = (order: string) => ({ productId: 10, productName: "Retiro", bookingDate: "2037-03-10", people: 1, amountTotal: 10000, customerName: "A", customerEmail: "a@x.example", merchantOrder: order });
const line = async (people = 1, editionId = 1) => (await prepareEditionLine({ experienceId: 10, editionId, people }))!;
const reserved = () => store.editions[0].reserved;

beforeEach(() => {
  store.editions = [];
  store.res = [];
  store.nextRes = 1;
});

describe("prepareEditionLine (validación del servidor)", () => {
  it("producto sin convocatorias: no cambia nada (null); con editionId ajeno se rechaza", async () => {
    expect(await prepareEditionLine({ experienceId: 10, people: 2 })).toBeNull();
    await expect(prepareEditionLine({ experienceId: 10, editionId: 1, people: 1 })).rejects.toThrow(/no corresponde/);
  });

  it("devuelve fecha local, precio de la edición y nota operativa", async () => {
    seed({ price_override: "450.00", starts_at: Date.UTC(2037, 2, 9, 23, 30), ends_at: Date.UTC(2037, 2, 12, 13) });
    const l = await line(2);
    expect(l).toMatchObject({ editionId: 1, seats: 2, bookingDate: "2037-03-10", priceOverride: 450 });
    expect(l.note).toBe("Convocatoria: Retiro de primavera · 2037-03-10 a 2037-03-12 · Casa de retiros");
  });

  it("exige elegir fecha; edición de otro producto, cerrada o llena se rechazan", async () => {
    seed();
    await expect(prepareEditionLine({ experienceId: 10, people: 1 })).rejects.toThrow(/Elige la fecha/);
    store.editions.push({ ...store.editions[0], id: 2, experience_id: 99 });
    await expect(prepareEditionLine({ experienceId: 10, editionId: 2, people: 1 })).rejects.toThrow(/no corresponde/);
    store.editions[0].reserved = 2;
    await expect(line(1)).rejects.toThrow(/completa/);
    store.editions[0].reserved = 0;
    store.editions[0].status = "closed";
    await expect(line(1)).rejects.toThrow(/No tiene fechas abiertas|no tiene fechas abiertas/i);
  });

  it("producto con fecha y sin ediciones abiertas: la compra directa se bloquea", async () => {
    seed({ status: "closed" });
    await expect(prepareEditionLine({ experienceId: 10, people: 1 })).rejects.toThrow(/no tiene fechas abiertas/);
    store.editions[0].status = "open";
    store.editions[0].starts_at = Date.now() - DAY;
    await expect(prepareEditionLine({ experienceId: 10, editionId: 1, people: 1 })).rejects.toThrow(/no tiene fechas abiertas/);
  });

  it("una retención caducada no hace pasar por completa una edición con sitio", async () => {
    seed({ capacity: 1 });
    const l = await line(1);
    await createEditionLine(l, data("O1"));
    expect(reserved()).toBe(1);
    store.res[0].hold_expires_at = Date.now() - 1000;
    expect(await prepareEditionLine({ experienceId: 10, editionId: 1, people: 1 })).toMatchObject({ editionId: 1 });
    expect(reserved()).toBe(0);
  });
});

describe("retención, liberación y confirmación de plazas", () => {
  it("retiene al crear el pedido pendiente y guarda la edición en la reserva", async () => {
    seed();
    const id = await createEditionLine(await line(2), data("O1"));
    expect(reserved()).toBe(2);
    expect(store.res.find((r) => r.id === id)).toMatchObject({ inventory_kind: "edition_seat", inventory_ref_id: 1, inventory_units: 2, hold_status: "retenida" });
  });

  it("dos compradores, una plaza: solo uno la consigue y el otro recibe un conflicto sin reserva a medias", async () => {
    seed({ capacity: 1 });
    const [a, b] = await Promise.all([line(1), line(1)]); // ambos la ven libre al validar
    const out = await Promise.allSettled([createEditionLine(a, data("A")), createEditionLine(b, data("B"))]);
    expect(out.filter((o) => o.status === "fulfilled")).toHaveLength(1);
    const lost = out.find((o) => o.status === "rejected") as PromiseRejectedResult;
    expect(lost.reason.code).toBe("CONFLICT");
    expect(reserved()).toBe(1);
    expect(store.res.filter((r) => r.hold_status === "retenida")).toHaveLength(1);
  });

  it("pedido de dos líneas: si la segunda no cabe, se anula la primera y se liberan sus plazas", async () => {
    seed({ capacity: 3 });
    store.editions.push({ ...store.editions[0], id: 2, capacity: 1, reserved: 1 });
    const l1 = await line(2, 1);
    await createEditionLine(l1, data("PEDIDO"));
    expect(reserved()).toBe(2);
    const l2 = { ...l1, editionId: 2 };
    await expect(createEditionLine(l2, data("PEDIDO"))).rejects.toMatchObject({ code: "CONFLICT" });
    expect(store.editions[0].reserved).toBe(0);
    expect(store.res.every((r) => r.status === "cancelled" && r.hold_status === "liberada")).toBe(true);
  });

  it("pago confirmado: confirma la retención sin mover el contador, y es idempotente", async () => {
    seed();
    await createEditionLine(await line(2), data("O1"));
    store.res[0].status = "paid";
    expect(await applyPaymentToInventoryHolds("O1", true)).toMatchObject({ confirmed: 1, conflicts: 0 });
    expect(await applyPaymentToInventoryHolds("O1", true)).toMatchObject({ confirmed: 0, conflicts: 0 });
    expect(store.res[0].hold_status).toBe("confirmada");
    expect(reserved()).toBe(2);
  });

  it("pago fallido y cancelación liberan una sola vez (idempotente)", async () => {
    seed();
    await createEditionLine(await line(2), data("O1"));
    expect((await applyPaymentToInventoryHolds("O1", false)).released).toBe(1);
    expect((await applyPaymentToInventoryHolds("O1", false)).released).toBe(0);
    expect(reserved()).toBe(0);
    await createEditionLine(await line(1), data("O2"));
    const id = store.res[1].id;
    expect(await releaseInventoryHold(id, "cancelada")).toBe(true);
    expect(await releaseInventoryHold(id, "cancelada")).toBe(false);
    expect(reserved()).toBe(0);
  });

  it("expiración (tarea de checkouts abandonados): libera la caducada y la de reservas anuladas", async () => {
    seed({ capacity: 3 });
    await createEditionLine(await line(1), data("EXP"));
    await createEditionLine(await line(1), data("ANU"));
    await createEditionLine(await line(1), data("VIVA"));
    store.res[0].hold_expires_at = Date.now() - 1000;
    store.res[1].status = "cancelled";
    const r = await syncInventoryHolds();
    expect(r).toMatchObject({ released: 2, expired: 1 });
    expect(reserved()).toBe(1);
    expect(store.res[2].hold_status).toBe("retenida");
  });

  it("pago tardío tras liberarse: re-ocupa si hay sitio; si otro la tomó, conflicto sin sobrevender", async () => {
    seed({ capacity: 1 });
    await createEditionLine(await line(1), data("LENTO"));
    store.res[0].hold_expires_at = Date.now() - 1000;
    await syncInventoryHolds();
    expect(reserved()).toBe(0);
    store.res[0].status = "paid";
    expect(await confirmInventoryHold(1)).toBe("confirmada");
    expect(reserved()).toBe(1);

    // segundo caso: la plaza liberada la toma otro comprador antes del pago
    store.res = [];
    store.nextRes = 1;
    store.editions[0].reserved = 0;
    await createEditionLine(await line(1), data("LENTO2"));
    store.res[0].hold_expires_at = Date.now() - 1000;
    await syncInventoryHolds();
    await createEditionLine(await line(1), data("OTRO"));
    store.res[0].status = "paid";
    expect(await confirmInventoryHold(1)).toBe("conflicto");
    expect(reserved()).toBe(1);
  });

  it("anular el pedido pendiente libera las plazas y repetirlo no las libera dos veces", async () => {
    seed();
    await createEditionLine(await line(2), data("O1"));
    await cancelPendingOrder("O1");
    await cancelPendingOrder("O1");
    expect(reserved()).toBe(0);
  });
});
