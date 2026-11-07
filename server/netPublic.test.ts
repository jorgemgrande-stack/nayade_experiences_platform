/**
 * Elephant Net · rutas públicas (server/netPublic) sin base de datos: tokens y su huella por empresa, enlace de baja
 * HMAC, reglas del pedido desde la mesa (límites y platos), registro de viajeros del check-in online, cierre del
 * check-in, lector de cuerpos (8 KB, solo formularios), límites de peticiones por IP y por enlace, baja idempotente con
 * propagación a Brevo solo con la clave de la empresa y el código QR del panel.
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TOKEN_RE, newToken, resolveLink, tokenHash } from "./netPublic/links";
import { TABLE_ORDER_LIMITS, orderLinesFromForm } from "./netPublic/restaurantTable";
import { checkinClosedReason, checkinExpiry, guestsFromForm } from "./netPublic/hotelCheckin";
import { unsubscribeToken, verifyUnsubscribeToken } from "./netPublic/brevoUnsubscribe";
import { NET_PUBLIC_BODY_LIMIT, createNetPublicRouter, netPublicBodyParser } from "./netPublic/router";
import { BrevoMarketingService, PUBLIC_UNSUB_SOURCE } from "./brevoMarketing/service";
import { MemoryBrevoMarketingStore } from "./brevoMarketing/store";
import { qrMatrix, qrSvgPath } from "../shared/qrCode";
import type { MenuItem } from "./restaurantNetDb";

const item = (id: number, over: Partial<MenuItem> = {}): MenuItem => ({
  id, restaurantId: 1, name: `Plato ${id}`, description: null, category: "Entrantes", price: 10, taxRate: 10, imageUrl: null, allergens: [], station: null, isActive: true, sortOrder: id, ...over,
});

describe("tokens de los enlaces públicos", () => {
  it("opacos, de 43 caracteres y distintos cada vez", () => {
    const a = newToken();
    const b = newToken();
    expect(a).toMatch(TOKEN_RE);
    expect(a).not.toBe(b);
  });
  it("la huella depende de la empresa: el token de una no vale en otra", () => {
    const t = newToken();
    expect(tokenHash(t, "empresa-a")).not.toBe(tokenHash(t, "empresa-b"));
    expect(tokenHash(t, "empresa-a")).toMatch(/^[a-f0-9]{64}$/);
    expect(tokenHash(t, "empresa-a")).not.toContain(t);
  });
  it("un token mal formado se descarta sin consultar la base de datos", async () => {
    for (const bad of ["", "corto", "x".repeat(44), "../../etc/passwd" + "a".repeat(30), 123, null]) expect(await resolveLink("restaurant_table", bad)).toBeNull();
  });
});

describe("baja de comunicaciones: enlace HMAC por empresa y contacto", () => {
  beforeAll(() => {
    process.env.JWT_SECRET = "clave-de-pruebas-de-la-baja-publica";
  });
  it("vale para su empresa y su contacto; no para otra empresa ni manipulado", () => {
    const t = unsubscribeToken(42, "empresa-a");
    expect(verifyUnsubscribeToken(t, "empresa-a")).toBe(42);
    expect(verifyUnsubscribeToken(t, "empresa-b")).toBeNull();
    const [, sig] = t.split(".");
    expect(verifyUnsubscribeToken(`43.${sig}`, "empresa-a")).toBeNull();
    expect(verifyUnsubscribeToken(`42.${sig.slice(0, -1)}${sig.endsWith("A") ? "B" : "A"}`, "empresa-a")).toBeNull();
    for (const bad of ["", "42", "0.abc", "abc.def", 42]) expect(verifyUnsubscribeToken(bad, "empresa-a")).toBeNull();
  });
  it("clave propia NET_UNSUBSCRIBE_SECRET: rotar JWT_SECRET no rompe las bajas enviadas; las firmadas antes siguen valiendo", () => {
    const jwt = process.env.JWT_SECRET;
    try {
      const old = unsubscribeToken(5, "empresa-a"); // firmado solo con JWT_SECRET (antes de la clave propia)
      process.env.NET_UNSUBSCRIBE_SECRET = "clave-propia-de-bajas-de-al-menos-32-caracteres";
      const own = unsubscribeToken(5, "empresa-a");
      expect(own).not.toBe(old);
      expect(verifyUnsubscribeToken(old, "empresa-a")).toBe(5);
      expect(verifyUnsubscribeToken(own, "empresa-a")).toBe(5);
      process.env.JWT_SECRET = "jwt-rotada-tras-un-incidente-de-sesiones";
      expect(verifyUnsubscribeToken(own, "empresa-a")).toBe(5);
      expect(verifyUnsubscribeToken(own, "empresa-b")).toBeNull();
      // Una clave propia demasiado corta no se usa (se firma con JWT_SECRET)
      process.env.NET_UNSUBSCRIBE_SECRET = "corta";
      expect(verifyUnsubscribeToken(unsubscribeToken(5, "empresa-a"), "empresa-a")).toBe(5);
      expect(verifyUnsubscribeToken(own, "empresa-a")).toBeNull();
    } finally {
      delete process.env.NET_UNSUBSCRIBE_SECRET;
      process.env.JWT_SECRET = jwt;
    }
  });
});

describe("pedido desde la mesa", () => {
  const menu = [item(1), item(2, { price: 4.5 }), item(3, { isActive: false })];
  it("solo platos activos de la carta, con su precio; vacíos y ceros se ignoran", () => {
    const r = orderLinesFromForm({ q1: "2", q2: "1", q9999: "", qx: "5", k: "abc" }, menu);
    expect(r.error).toBeNull();
    expect(r.lines).toEqual([{ menuItemId: 1, name: "Plato 1", quantity: 2, unitPrice: 10 }, { menuItemId: 2, name: "Plato 2", quantity: 1, unitPrice: 4.5 }]);
  });
  it("rechaza platos archivados o de otra carta, cantidades no válidas y pedidos vacíos", () => {
    expect(orderLinesFromForm({ q3: "1" }, menu).error).toMatch(/ya no está disponible/);
    expect(orderLinesFromForm({ q77: "1" }, menu).error).toMatch(/ya no está disponible/);
    expect(orderLinesFromForm({ q1: "-1" }, menu).error).toMatch(/cantidades/);
    expect(orderLinesFromForm({ q1: "1.5" }, menu).error).toMatch(/cantidades/);
    expect(orderLinesFromForm({ q1: "0" }, menu).error).toMatch(/al menos un plato/);
  });
  it("límites: unidades por plato, platos distintos y unidades por pedido", () => {
    expect(orderLinesFromForm({ q1: String(TABLE_ORDER_LIMITS.maxQtyPerLine + 1) }, menu).error).toMatch(/Como máximo 20 unidades/);
    const big = Array.from({ length: 40 }, (_, i) => item(100 + i));
    const many = Object.fromEntries(big.map((m) => [`q${m.id}`, "1"]));
    expect(orderLinesFromForm(many, big).error).toMatch(/30 platos distintos/);
    const heavy = Object.fromEntries(big.slice(0, 4).map((m) => [`q${m.id}`, "20"]));
    expect(orderLinesFromForm(heavy, big).error).toMatch(/60 unidades por pedido/);
  });
});

describe("check-in online: registro de viajeros como en recepción", () => {
  const adult = {
    g0_firstName: "Ana", g0_lastName: "Prueba", g0_sex: "M", g0_birthDate: "1990-05-10", g0_nationality: "España", g0_docType: "DNI", g0_docNumber: "12345678Z",
    g0_docSupportNumber: "ABC123456", g0_address: "Calle Ejemplo 1", g0_country: "España", g0_email: "ana@cliente.example",
  };
  it("titular completo y bloques vacíos ignorados", () => {
    const r = guestsFromForm(adult, 3, "2026-12-20");
    expect(r.errors).toEqual([]);
    expect(r.guests).toHaveLength(1);
    expect(r.guests[0]).toMatchObject({ firstName: "Ana", docNumber: "12345678Z", sex: "M", email: "ana@cliente.example" });
  });
  it("las mismas exigencias de la ficha: documento, DNI válido y parentesco del menor", () => {
    expect(guestsFromForm({ ...adult, g0_docNumber: "12345678A" }, 1, "2026-12-20").errors.join(" ")).toMatch(/DNI no es válido/);
    expect(guestsFromForm({ ...adult, g0_docNumber: "" }, 1, "2026-12-20").errors.join(" ")).toMatch(/documento de identidad/);
    const kid = { ...adult, g1_firstName: "Leo", g1_lastName: "Prueba", g1_sex: "H", g1_birthDate: "2020-01-01", g1_nationality: "España" };
    expect(guestsFromForm(kid, 2, "2026-12-20").errors).toEqual(["Acompañante 1: Falta el parentesco del menor con el adulto que lo acompaña."]);
    expect(guestsFromForm({ ...kid, g1_kinship: "Hijo" }, 2, "2026-12-20").errors).toEqual([]);
    expect(guestsFromForm({}, 2, "2026-12-20").errors).toEqual(["Rellena al menos los datos del titular."]);
    expect(guestsFromForm({ ...adult, g0_sex: "Z" }, 1, "2026-12-20").errors[0]).toMatch(/^Titular:/);
  });
  it("cerrado tras la llegada, en reservas canceladas o con la fecha pasada; caduca al terminar el día de llegada", () => {
    const base = { status: "paid", statusReservation: "CONFIRMADA", checkIn: "2026-12-20" };
    expect(checkinClosedReason(base, "2026-12-19")).toBeNull();
    expect(checkinClosedReason(base, "2026-12-20")).toBeNull();
    expect(checkinClosedReason(base, "2026-12-21")).toMatch(/ya ha pasado/);
    expect(checkinClosedReason({ ...base, statusReservation: "EN_CURSO" }, "2026-12-19")).toMatch(/ya se ha registrado/);
    expect(checkinClosedReason({ ...base, status: "cancelled" }, "2026-12-19")).toMatch(/cancelada/);
    expect(checkinExpiry("2026-12-20")).toBe(Date.parse("2026-12-21T02:00:00Z"));
  });
});

describe("lector de cuerpos y límites de peticiones", () => {
  let server: http.Server;
  let port = 0;
  beforeAll(async () => {
    const app = express();
    app.use(netPublicBodyParser);
    app.post("/eco/:x", (req, res) => res.json({ body: req.body ?? null }));
    app.post("/mesa/:token", (req, res) => res.json({ body: req.body }));
    // Límites bajos para probarlos; las rutas sin capacidad responden «no disponible» (404) sin tocar la BD
    app.use("/limites", createNetPublicRouter({ perIpPerMinute: 3, postsPerIp: 100, postsPerLink: 2 }));
    server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));
  const send = (method: string, path: string, body?: string, type = "application/x-www-form-urlencoded") =>
    new Promise<{ status: number; text: string }>((resolve, reject) => {
      const req = http.request({ host: "127.0.0.1", port, path, method, headers: body !== undefined ? { "content-type": type, "content-length": Buffer.byteLength(body) } : {} }, (res) => {
        let t = "";
        res.on("data", (c) => (t += c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, text: t }));
      });
      req.on("error", reject);
      if (body !== undefined) req.write(body);
      req.end();
    });

  it("formularios de hasta 8 KB; más grande, 413; otro formato, 415; otras rutas, sin cambios", async () => {
    expect(JSON.parse((await send("POST", "/mesa/abc", "q1=2&k=x")).text).body).toEqual({ q1: "2", k: "x" });
    expect((await send("POST", "/mesa/abc", "n=" + "x".repeat(NET_PUBLIC_BODY_LIMIT))).status).toBe(413);
    expect((await send("POST", "/mesa/abc", JSON.stringify({ a: 1 }), "application/json")).status).toBe(415);
    expect((await send("POST", "/eco/abc", JSON.stringify({ a: 1 }), "application/json")).status).toBe(200);
  });

  it("límite por IP en todas las peticiones y por enlace en los envíos (429)", async () => {
    const t1 = "a".repeat(43);
    const t2 = "b".repeat(43);
    const posts = [await send("POST", `/limites/baja/${t1}`, "x=1"), await send("POST", `/limites/baja/${t1}`, "x=1")];
    expect(posts.map((r) => r.status)).toEqual([404, 404]);
    // Tercer envío con el mismo enlace: bloqueado; con otro enlace, no (aún dentro del límite por IP)
    expect((await send("POST", `/limites/baja/${t1}`, "x=1")).status).toBe(429);
    const other = await send("POST", `/limites/baja/${t2}`, "x=1");
    expect(other.status).toBe(429); // 4.ª petición de la IP en el minuto: límite general
    expect(other.text).toMatch(/demasiadas solicitudes/i);
  });

  it("rutas sensibles a mayúsculas: /MESA no la atiende el módulo (ni salta el lector de 8 KB)", async () => {
    const big = "n=" + "x".repeat(NET_PUBLIC_BODY_LIMIT * 2);
    // El lector general de la app no lee formularios: si el router atendiera /MESA, procesaría un cuerpo sin leer
    const r = await send("POST", `/limites/MESA/${"c".repeat(43)}`, big);
    expect(r.status).toBe(404);
    expect(r.text).toMatch(/Cannot POST/);
    expect((await send("GET", `/limites/Mesa/${"c".repeat(43)}`)).text).toMatch(/Cannot GET/);
  });
});

describe("baja idempotente con propagación solo con la clave de la empresa", () => {
  function setup(key: string | null, listId: number | null) {
    const store = new MemoryBrevoMarketingStore();
    store.clientRows.push({ id: 7, name: "Cliente Ficticio", email: "Cliente@Ejemplo.example" });
    const calls: Array<{ url: string; body: unknown }> = [];
    const fetch = (async (url: string, init?: { body?: string }) => {
      calls.push({ url, body: init?.body ? JSON.parse(init.body) : null });
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    }) as never;
    const svc = new BrevoMarketingService({ store, credentials: { apiKey: async () => key, clear: async () => undefined }, fetch });
    if (listId) void store.saveSettings({ listId, listName: "Clientes" });
    return { store, svc, calls };
  }
  it("retira el consentimiento una sola vez y saca el correo de la lista de la empresa", async () => {
    const { store, svc, calls } = setup("clave-ficticia-de-la-empresa", 12);
    await store.setConsent({ clientId: 7, status: "granted", source: "form", evidence: "Formulario web", updatedBy: "user:1" }, { clientId: 7, previousStatus: null, newStatus: "granted", source: "form", evidence: "Formulario web", actor: "user:1" });
    expect(await svc.publicUnsubscribe(7)).toEqual({ changed: true, propagated: true });
    expect(await svc.publicUnsubscribe(7)).toEqual({ changed: false, propagated: true });
    expect((await store.consent(7))?.status).toBe("withdrawn");
    const log = await store.consentLog(7);
    expect(log.filter((l) => l.newStatus === "withdrawn")).toHaveLength(1);
    expect(log.at(-1)).toMatchObject({ previousStatus: "granted", source: PUBLIC_UNSUB_SOURCE, actor: "public:unsubscribe" });
    expect(calls[0]).toEqual({ url: "https://api.brevo.com/v3/contacts/lists/12/contacts/remove", body: { emails: ["cliente@ejemplo.example"] } });
  });
  it("sin clave o sin lista no llama a Brevo; un cliente que no existe no cambia nada", async () => {
    const a = setup(null, 12);
    expect(await a.svc.publicUnsubscribe(7)).toEqual({ changed: true, propagated: false });
    expect(a.calls).toHaveLength(0);
    const b = setup("clave-ficticia-de-la-empresa", null);
    expect((await b.svc.publicUnsubscribe(7)).propagated).toBe(false);
    expect(b.calls).toHaveLength(0);
    expect(await b.svc.publicUnsubscribe(999)).toEqual({ changed: false, propagated: false });
  });
  it("si Brevo falla, la baja en el CRM queda hecha", async () => {
    const store = new MemoryBrevoMarketingStore();
    store.clientRows.push({ id: 7, name: "Cliente", email: "c@ejemplo.example" });
    await store.saveSettings({ listId: 3, listName: "L" });
    const svc = new BrevoMarketingService({ store, credentials: { apiKey: async () => "clave-ficticia", clear: async () => undefined }, fetch: (async () => new Response("{}", { status: 500 })) as never });
    expect(await svc.publicUnsubscribe(7)).toEqual({ changed: true, propagated: false });
    expect((await store.consent(7))?.status).toBe("withdrawn");
  });
});

describe("código QR del panel", () => {
  it("versión mínima según la longitud y patrones de posición en tres esquinas", () => {
    expect(qrMatrix("x".repeat(14)).length).toBe(21);
    expect(qrMatrix("x".repeat(15)).length).toBe(25);
    const url = "https://empresa.elephantsource.es/mesa/" + "a".repeat(43);
    const m = qrMatrix(url);
    const v = (m.length - 17) / 4;
    expect(v).toBe(5);
    const finderAt = (x: number, y: number) => [0, 1, 2, 3, 4, 5, 6].every((i) => m[y][x + i] && m[y + 6][x + i] && m[y + i][x] && m[y + i][x + 6]) && m[y + 3][x + 3];
    expect(finderAt(0, 0) && finderAt(m.length - 7, 0) && finderAt(0, m.length - 7)).toBe(true);
    expect(qrMatrix(url)).toEqual(m);
    const { path, size } = qrSvgPath(m);
    expect(size).toBe(m.length + 8);
    expect(path.startsWith("M4 4h1v1h-1z")).toBe(true);
  });
});
