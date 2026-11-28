/**
 * Sesiones recurrentes sobre MySQL REAL (opt-in: REGISTRY_TEST_DATABASE_URL): aplica la migración 0097 en una base temporal propia
 * con `reservations` y `experiences` mínimas y ejecuta el flujo completo con un correo simulado: derecho por compra, idempotencia
 * (reintentos y concurrencia), aviso con y sin Zoom, envío posterior del enlace, fallo y reintento, variantes y reversión de la migración.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import crypto from "node:crypto";
import path from "node:path";
import fs from "node:fs";
import mysql from "mysql2/promise";
import { splitStatements } from "../scripts/db/migrationLib";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
const DB = `recurring_${crypto.randomBytes(3).toString("hex")}`;
const DIR = path.resolve(__dirname, "../db/migrations");

type Sent = { to: string; subject: string; html: string; category?: string; idempotencyKey?: string };
const sent: Sent[] = [];
let mailOk = true;
vi.mock("./mailer", () => ({
  sendEmail: async (p: Sent) => {
    if (!mailOk) return false;
    // el servicio real deduplica por clave de idempotencia
    if (p.idempotencyKey && sent.some((s) => s.idempotencyKey === p.idempotencyKey)) return true;
    sent.push(p);
    return true;
  },
}));

const utc = (s: string) => Date.parse(s);

describe.skipIf(!URL_)("sesiones recurrentes (MySQL real, correo simulado)", () => {
  let admin: mysql.Connection;
  let db: typeof import("./recurringSessionsDb");
  const NOW = utc("2026-11-25T12:00:00Z"); // miércoles

  const line = async (o: { id: number; order: string; product?: number; variant?: number | null; status?: string; people?: number; email?: string; name?: string }) =>
    admin.query("INSERT INTO reservations (id, merchant_order, status, product_id, variant_id, customer_name, customer_email, people, changes_log) VALUES (?,?,?,?,?,?,?,?,?)", [
      o.id, o.order, o.status ?? "paid", o.product ?? 24, o.variant === undefined ? 12 : o.variant, o.name ?? "Ana Prueba", o.email ?? "ana@sintetico.invalid", o.people ?? 1, JSON.stringify({ locale: "es" }),
    ]);
  const offerInput = { productId: 24, variantId: 0, title: "MORNING IMPULSE", weekday: 1, startTime: "07:30", timezone: "Europe/Madrid", durationMinutes: 30, sessionsCount: 4, leadMinutes: 60 };

  beforeAll(async () => {
    admin = await mysql.createConnection({ uri: URL_!, multipleStatements: false });
    await admin.query(`CREATE DATABASE \`${DB}\` CHARACTER SET utf8mb4`);
    await admin.query(`USE \`${DB}\``);
    await admin.query("CREATE TABLE experiences (id INT PRIMARY KEY, title VARCHAR(200) NOT NULL)");
    await admin.query("INSERT INTO experiences (id, title) VALUES (24, 'MORNING IMPULSE'), (25, 'Otro producto')");
    await admin.query(`CREATE TABLE reservations (id INT PRIMARY KEY, merchant_order VARCHAR(64), status VARCHAR(16), product_id INT, variant_id INT NULL, customer_name VARCHAR(200), customer_email VARCHAR(254), people INT DEFAULT 1, changes_log JSON NULL)`);
    for (const st of splitStatements(fs.readFileSync(path.join(DIR, "0097_sesiones_recurrentes.sql"), "utf8"))) await admin.query(st);
    const u = new URL(URL_!);
    u.pathname = `/${DB}`;
    process.env.DATABASE_URL = u.toString();
    process.env.TENANT_MODE = "single";
    db = await import("./recurringSessionsDb");
  }, 60_000);
  afterAll(async () => {
    await admin?.query(`DROP DATABASE IF EXISTS \`${DB}\``).catch(() => undefined);
    await admin?.end().catch(() => undefined);
  });

  it("la oferta se valida (zona horaria, https, hora) y nace INACTIVA", async () => {
    await expect(db.saveOffer({ ...offerInput, timezone: "Mars/Olympus" })).rejects.toBeInstanceOf(db.OfferInvalid);
    await expect(db.saveOffer({ ...offerInput, zoomUrl: "http://zoom.us/j/1" })).rejects.toBeInstanceOf(db.OfferInvalid);
    await expect(db.saveOffer({ ...offerInput, startTime: "7:30" })).rejects.toBeInstanceOf(db.OfferInvalid);
    const id = await db.saveOffer(offerInput, NOW);
    expect(id).toBeGreaterThan(0);
    expect(await db.saveOffer({ ...offerInput, title: "MORNING IMPULSE" }, NOW)).toBe(id); // upsert por producto+variante
    const [o] = await db.listOffers();
    expect(o).toMatchObject({ productId: 24, variantId: 0, active: false, timezone: "Europe/Madrid", timezoneConfirmed: false, zoomUrl: null, weekday: 1, startTime: "07:30", sessionsCount: 4 });
    expect(await db.hasOffers()).toBe(true);
  });

  it("con la oferta inactiva, un pedido pagado no concede nada", async () => {
    await line({ id: 1, order: "ORD-0" });
    sent.length = 0;
    expect(await db.grantRecurringFromOrder("ORD-0", NOW)).toEqual({ status: "skipped", reason: "no_offer" });
    expect(sent).toHaveLength(0);
    expect(await db.listEntitlements()).toHaveLength(0);
  });

  it("oferta activa SIN enlace: derecho con 4 lunes 07:30, UN aviso que no promete Zoom, estado «Zoom pendiente»", async () => {
    await db.saveOffer({ ...offerInput, active: true }, NOW);
    sent.length = 0;
    await line({ id: 2, order: "ORD-1", people: 1 });
    const r = await db.grantRecurringFromOrder("ORD-1", NOW);
    expect(r).toEqual({ status: "granted", created: 1, existing: 0, notified: 1 });
    const [e] = await db.listEntitlements();
    expect(e).toMatchObject({ reservationId: 2, merchantOrder: "ORD-1", customerEmail: "ana@sintetico.invalid", seats: 1, status: "active", noticeStatus: "sent", zoomStatus: "pending", timezone: "Europe/Madrid" });
    expect(e.sessions.map((x) => x.startsOn)).toEqual(["2026-11-30", "2026-12-07", "2026-12-14", "2026-12-21"]);
    expect(e.firstSessionAt).toBe(utc("2026-11-30T06:30:00Z"));
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: "ana@sintetico.invalid", category: "operational", idempotencyKey: `recurring:${e.id}:notice` });
    expect(sent[0].html).toContain("Todavía no hay enlace de Zoom");
    expect(sent[0].html).not.toMatch(/zoom\.us\/j/);
    expect(await db.counts(NOW)).toMatchObject({ total: 1, zoomPending: 1, noticeFailed: 0 });
  });

  it("idempotente: reintento del cobro, aviso repetido o dos pasadas simultáneas no duplican derecho ni correo", async () => {
    sent.length = 0;
    expect(await db.grantRecurringFromOrder("ORD-1", NOW + 60_000)).toEqual({ status: "granted", created: 0, existing: 1, notified: 0 });
    await line({ id: 3, order: "ORD-2", email: "berta@sintetico.invalid", name: "Berta" });
    const [a, b] = await Promise.all([db.grantRecurringFromOrder("ORD-2", NOW), db.grantRecurringFromOrder("ORD-2", NOW)]);
    expect([a, b].map((x) => (x.status === "granted" ? x.created : -1)).sort()).toEqual([0, 1]);
    expect(sent.filter((x) => x.to === "berta@sintetico.invalid")).toHaveLength(1);
    const [[c]] = (await admin.query("SELECT COUNT(*) AS c FROM recurring_session_entitlements")) as any;
    expect(Number(c.c)).toBe(2);
  });

  it("las fechas se fijan AL PAGAR: una pasada posterior no las mueve", async () => {
    const before = (await db.listEntitlements()).find((e) => e.reservationId === 2)!;
    await db.grantRecurringFromOrder("ORD-1", NOW + 9 * 86_400_000);
    const after = (await db.listEntitlements()).find((e) => e.reservationId === 2)!;
    expect(after.sessions).toEqual(before.sessions);
  });

  it("varias plazas, líneas no pagadas y otros productos", async () => {
    sent.length = 0;
    await line({ id: 4, order: "ORD-3", people: 2, email: "dos@sintetico.invalid" });
    await line({ id: 5, order: "ORD-3", status: "pending", email: "pendiente@sintetico.invalid" });
    await line({ id: 6, order: "ORD-3", product: 25, email: "otro@sintetico.invalid" });
    const r = await db.grantRecurringFromOrder("ORD-3", NOW);
    expect(r).toMatchObject({ status: "granted", created: 1 });
    const ents = await db.listEntitlements();
    expect(ents.find((e) => e.reservationId === 4)?.seats).toBe(2);
    expect(ents.find((e) => e.reservationId === 5)).toBeUndefined();
    expect(ents.find((e) => e.reservationId === 6)).toBeUndefined();
    expect(sent.map((x) => x.to)).toEqual(["dos@sintetico.invalid"]);
  });

  it("el enlace de Zoom se configura después: los datos se envían UNA vez a cada derecho pendiente y vigente", async () => {
    sent.length = 0;
    const [o] = await db.listOffers();
    expect(await db.sendZoomAccess((await db.listEntitlements())[0].id)).toBe("no_link"); // aún sin enlace
    await db.saveOffer({ ...offerInput, active: true, zoomUrl: "https://us02web.zoom.us/j/123456789" }, NOW);
    const r = await db.sendZoomToPending(o.id, NOW);
    expect(r).toEqual({ sent: 3, failed: 0, skipped: 0 });
    expect(sent).toHaveLength(3);
    expect(sent.every((x) => x.html.includes("https://us02web.zoom.us/j/123456789") && x.idempotencyKey?.endsWith(":zoom"))).toBe(true);
    expect(await db.sendZoomToPending(o.id, NOW)).toEqual({ sent: 0, failed: 0, skipped: 0 }); // nada pendiente
    expect(await db.counts(NOW)).toMatchObject({ zoomPending: 0 });
  });

  it("nuevas compras con el enlace ya configurado: el aviso lo incluye y no queda Zoom pendiente", async () => {
    sent.length = 0;
    await line({ id: 7, order: "ORD-4", email: "carla@sintetico.invalid" });
    await db.grantRecurringFromOrder("ORD-4", NOW);
    expect(sent).toHaveLength(1);
    expect(sent[0].html).toContain("https://us02web.zoom.us/j/123456789");
    const e = (await db.listEntitlements()).find((x) => x.reservationId === 7)!;
    expect(e).toMatchObject({ noticeStatus: "sent", zoomStatus: "sent" });
  });

  it("si el correo no sale: el aviso queda «failed» con el motivo y se reintenta sin duplicar", async () => {
    sent.length = 0;
    mailOk = false;
    await line({ id: 8, order: "ORD-5", email: "dana@sintetico.invalid" });
    expect(await db.grantRecurringFromOrder("ORD-5", NOW)).toMatchObject({ status: "granted", created: 1, notified: 0 });
    const e = (await db.listEntitlements()).find((x) => x.reservationId === 8)!;
    expect(e).toMatchObject({ noticeStatus: "failed" });
    expect(e.noticeError).toMatch(/correo/i);
    expect(await db.counts(NOW)).toMatchObject({ noticeFailed: 1 });
    mailOk = true;
    expect(await db.retryNotice(e.id, NOW)).toBe("sent");
    expect(sent).toHaveLength(1);
    expect(await db.retryNotice(e.id, NOW)).toBe("skipped"); // ya enviado
    expect(sent).toHaveLength(1);
  });

  it("una reserva «sending» caída (más de 10 min) se puede retomar; una reciente no", async () => {
    await line({ id: 9, order: "ORD-6", email: "eli@sintetico.invalid" });
    mailOk = false;
    await db.grantRecurringFromOrder("ORD-6", NOW);
    mailOk = true;
    const id = (await db.listEntitlements()).find((x) => x.reservationId === 9)!.id;
    await admin.query("UPDATE recurring_session_entitlements SET notice_status = 'sending', notice_claimed_at = ? WHERE id = ?", [NOW, id]);
    expect(await db.deliverNotice(id, NOW + 60_000)).toBe("skipped");
    sent.length = 0;
    expect(await db.deliverNotice(id, NOW + 11 * 60_000)).toBe("sent");
    expect(sent).toHaveLength(1);
  });

  it("una oferta de una variante concreta solo vale para esa variante; la específica manda sobre la general", async () => {
    await db.saveOffer({ ...offerInput, productId: 25, variantId: 77, title: "Solo variante 77", active: true, weekday: 3, startTime: "18:15", sessionsCount: 2 }, NOW);
    sent.length = 0;
    await line({ id: 10, order: "ORD-7", product: 25, variant: 78, email: "otra@sintetico.invalid" });
    await line({ id: 11, order: "ORD-7", product: 25, variant: 77, email: "otra@sintetico.invalid" });
    const r = await db.grantRecurringFromOrder("ORD-7", NOW);
    expect(r).toMatchObject({ status: "granted", created: 1 });
    const e = (await db.listEntitlements()).find((x) => x.reservationId === 11)!;
    expect(e.sessions.map((x) => x.startsOn)).toEqual(["2026-11-25", "2026-12-02"]); // miércoles 18:15
    expect((await db.listEntitlements()).find((x) => x.reservationId === 10)).toBeUndefined();
  });

  it("la reversión conserva los datos (renombra, no borra) y la 0097 se puede volver a aplicar", async () => {
    const down = fs.readFileSync(path.join(DIR, "0097_sesiones_recurrentes.down.sql"), "utf8");
    for (const st of splitStatements(down)) await admin.query(st);
    const [[c]] = (await admin.query("SELECT COUNT(*) AS c FROM retired_recurring_session_entitlements")) as any;
    expect(Number(c.c)).toBeGreaterThan(5);
    expect(await db.grantRecurringFromOrder("ORD-1", NOW)).toEqual({ status: "skipped", reason: "no_schema" }); // sin tablas: no lanza
    for (const st of splitStatements(fs.readFileSync(path.join(DIR, "0097_sesiones_recurrentes.sql"), "utf8"))) await admin.query(st);
    const [[n]] = (await admin.query("SELECT COUNT(*) AS c FROM recurring_session_entitlements")) as any;
    expect(Number(n.c)).toBe(0);
  });
});
