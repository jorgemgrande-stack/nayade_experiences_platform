/**
 * Venta multicanal: lógica pura (comisión, informe CSV, venta del enlace, días de cupo, disponibilidad, totales),
 * registro (licencia, menú, bóveda), migración y lector del cuerpo del enlace de entrada. La sobreventa, la
 * idempotencia y el aislamiento entre empresas se prueban con MySQL real en multichannel.mysql.test.ts.
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import type { AddressInfo } from "node:net";
import express from "express";
import { describe, expect, it } from "vitest";
import {
  MC_LIMITS,
  commissionOf,
  daysConsumed,
  daysInclusive,
  nightsOf,
  parseCsvMapping,
  parseInboundSale,
  parseSalesCsv,
  resolveColumns,
  salesCsv,
  sellable,
  totalsByChannel,
  channelProblem,
} from "../shared/multichannel";
import { TRPC_ROUTER_CAPABILITIES, capabilityForProcedure } from "./_core/capabilities/routeGuard";
import { TASK_NAV } from "../shared/adminNav";
import { PROVIDERS } from "./_core/credentials/catalog";
import { inboundTokenHash, newInboundToken, storedSaleInput } from "./multichannelDb";
import { MC_PUBLIC_POST_PATH, createMultichannelPublicRouter, inboundTokenOf, multichannelBodyParser } from "./multichannel/publicRoutes";
import { NET_PUBLIC_PATH } from "./netPublic/router";

describe("comisión", () => {
  it("porcentaje más fijo, redondeado al céntimo", () => {
    expect(commissionOf(10000, { pct: 20, fixedCents: 0 })).toEqual({ commissionCents: 2000, netCents: 8000 });
    expect(commissionOf(3333, { pct: 15, fixedCents: 50 })).toEqual({ commissionCents: 550, netCents: 2783 });
  });
  it("la que informa el canal manda; nunca negativa ni mayor que el bruto", () => {
    expect(commissionOf(10000, { pct: 20, fixedCents: 0 }, 1234)).toEqual({ commissionCents: 1234, netCents: 8766 });
    expect(commissionOf(1000, { pct: 50, fixedCents: 900 })).toEqual({ commissionCents: 1000, netCents: 0 });
    expect(commissionOf(1000, { pct: 10, fixedCents: 0 }, -5)).toEqual({ commissionCents: 0, netCents: 1000 });
  });
  it("valida el canal", () => {
    expect(channelProblem({ name: "x", commissionPct: 10, commissionFixedCents: 0 })).toMatch(/nombre/);
    expect(channelProblem({ name: "Civitatis", commissionPct: 120, commissionFixedCents: 0 })).toMatch(/0 % y 100 %/);
    expect(channelProblem({ name: "Civitatis", commissionPct: 25, commissionFixedCents: 0 })).toBeNull();
  });
});

describe("días que consume una venta", () => {
  it("un día para experiencias y spa; cada noche para hotel", () => {
    expect(daysConsumed("experience", "2026-12-01")).toEqual(["2026-12-01"]);
    expect(daysConsumed("hotel", "2026-12-30", "2027-01-02")).toEqual(["2026-12-30", "2026-12-31", "2027-01-01"]);
    expect(daysConsumed("hotel", "2026-12-30", "2026-12-30")).toEqual([]);
    expect(nightsOf("2026-02-28", "2026-03-01")).toEqual(["2026-02-28"]);
  });
  it("rango de cupo con tope", () => {
    expect(daysInclusive("2026-12-01", "2026-12-03")).toHaveLength(3);
    expect(daysInclusive("2026-12-03", "2026-12-01")).toEqual([]);
    expect(daysInclusive("2026-01-01", "2028-01-01")).toEqual([]);
  });
  it("lo vendible: cupo restante limitado por el Core", () => {
    expect(sellable(10, 4, null)).toBe(6);
    expect(sellable(10, 4, 2)).toBe(2);
    expect(sellable(3, 5, 9)).toBe(0);
  });
});

describe("venta del enlace de entrada", () => {
  it("normaliza la venta", () => {
    const r = parseInboundSale({ ref: "FV-1001", code: "ENTRADA-GENERAL", date: "01/12/2026", time: "21h30", units: 2, amount: "59,90", customer: { name: "Ana  Pérez", email: "ana@cliente.example" } });
    expect(r).toEqual({ ok: true, sale: expect.objectContaining({ ref: "FV-1001", event: "venta", code: "ENTRADA-GENERAL", day: "2026-12-01", time: "21:30", units: 2, grossCents: 5990, customerName: "Ana Pérez" }) });
  });
  it("cancelación por evento o estado", () => {
    expect(parseInboundSale({ ref: "A", event: "cancelacion" })).toMatchObject({ ok: true, sale: { event: "cancelacion" } });
    expect(parseInboundSale({ ref: "A", status: "Refunded" })).toMatchObject({ ok: true, sale: { event: "cancelacion" } });
  });
  it("rechaza lo que no encaja", () => {
    expect(parseInboundSale(null)).toMatchObject({ ok: false });
    expect(parseInboundSale({ code: "X" })).toMatchObject({ ok: false, problem: expect.stringMatching(/referencia/) });
    expect(parseInboundSale({ ref: "A", units: 0 })).toMatchObject({ ok: false });
    expect(parseInboundSale({ ref: "A", units: 2.5 })).toMatchObject({ ok: false });
    expect(parseInboundSale({ ref: "A", units: MC_LIMITS.maxUnits + 1 })).toMatchObject({ ok: false });
  });
});

describe("informe CSV del canal", () => {
  it("reconoce columnas habituales (Weezevent en inglés, Fourvenues en español) y separador «;»", () => {
    const en = "Barcode,Ticket type,Event date,Quantity,Price,Buyer,Email,Status\nB-1,VIP,2026-12-05,1,30.00,Ana,ana@x.example,Valid\nB-2,VIP,2026-12-05,2,60.00,Luis,,Refunded\n";
    const r = parseSalesCsv(en);
    expect(r.missing).toEqual([]);
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0].sale).toMatchObject({ ref: "B-1", code: "VIP", day: "2026-12-05", units: 1, grossCents: 3000, customerName: "Ana", event: "venta" });
    expect(r.rows[1].sale).toMatchObject({ ref: "B-2", event: "cancelacion" });
    const es = "Localizador;Tipo de entrada;Fecha;Entradas;Importe;Comisión;Cliente\nL1;General;05/12/2026;3;1.234,50;120,00;Marta\n";
    expect(parseSalesCsv(es).rows[0].sale).toMatchObject({ ref: "L1", code: "General", day: "2026-12-05", units: 3, grossCents: 123450, commissionCents: 12000 });
  });
  it("el mapeo propio del canal tiene prioridad", () => {
    const cols = resolveColumns(["Nº Pedido", "Día", "Fecha"], { ref: "Nº pedido", day: "día" });
    expect(cols).toMatchObject({ ref: 0, day: 1 });
    expect(parseCsvMapping('{"ref":"Nº Pedido","otra":"x","day":""}')).toEqual({ ref: "Nº Pedido" });
    expect(parseCsvMapping("no es json")).toEqual({});
  });
  it("informa de columnas que faltan y de filas no válidas con su línea", () => {
    expect(parseSalesCsv("Nombre,Importe\nAna,10\n").missing).toEqual(["ref", "day"]);
    const r = parseSalesCsv("ref,fecha,cantidad\n,2026-12-01,1\nX,no-es-fecha,1\nY,2026-12-01,abc\nZ,2026-12-01,\n");
    expect(r.rows.map((x) => [x.line, x.problem ? "mal" : "bien"])).toEqual([[2, "mal"], [3, "mal"], [4, "mal"], [5, "bien"]]);
  });
});

describe("conciliación", () => {
  it("totales por canal: solo las registradas suman importes", () => {
    const t = totalsByChannel([
      { channelId: 1, status: "registrada", units: 2, grossCents: 10000, commissionCents: 2000, netCents: 8000, settlementId: null },
      { channelId: 1, status: "registrada", units: 1, grossCents: 5000, commissionCents: 1000, netCents: 4000, settlementId: 7 },
      { channelId: 1, status: "cancelada", units: 1, grossCents: 5000, commissionCents: 1000, netCents: 4000, settlementId: null },
      { channelId: 2, status: "sin_cupo", units: 1, grossCents: 0, commissionCents: 0, netCents: 0, settlementId: null },
    ]);
    expect(t[0]).toMatchObject({ channelId: 1, registered: 2, units: 3, grossCents: 15000, commissionCents: 3000, netCents: 12000, cancelled: 1, pendingSettlement: 1, pendingNetCents: 8000, settledNetCents: 4000 });
    expect(t[1]).toMatchObject({ channelId: 2, registered: 0, rejected: 1 });
  });
  it("el CSV exportado neutraliza fórmulas y escapa separadores", () => {
    const csv = salesCsv([{ a: "=HYPERLINK(1)", b: 'x;"y"' }], [["a", "A"], ["b", "B"]]);
    expect(csv).toBe("A;B\r\n'=HYPERLINK(1);\"x;\"\"y\"\"\"");
  });
});

describe("enlace de entrada", () => {
  it("token de 43 caracteres; la huella depende de la empresa", () => {
    const t = newInboundToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(inboundTokenHash(t, "a")).not.toBe(inboundTokenHash(t, "b"));
  });
  it("rutas propias, fuera de las rutas de formularios de Net", () => {
    expect(MC_PUBLIC_POST_PATH.test("/canal/abc/ventas")).toBe(true);
    expect(MC_PUBLIC_POST_PATH.test("/canal/abc/otra")).toBe(false);
    expect(MC_PUBLIC_POST_PATH.test("/canal/ventas")).toBe(true);
    expect(NET_PUBLIC_PATH.test("/canal/abc")).toBe(false);
  });

  async function serve(app: express.Express) {
    const server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as AddressInfo).port;
    const send = (method: string, p: string, body?: string, type = "application/json") =>
      new Promise<{ status: number; json: any }>((resolve, reject) => {
        const req = http.request({ host: "127.0.0.1", port, path: p, method, headers: body !== undefined ? { "content-type": type, "content-length": Buffer.byteLength(body) } : {} }, (res) => {
          let b = "";
          res.on("data", (c) => (b += c));
          res.on("end", () => resolve({ status: res.statusCode ?? 0, json: b ? JSON.parse(b) : null }));
        });
        req.on("error", reject);
        if (body !== undefined) req.write(body);
        req.end();
      });
    return { send, close: () => new Promise<void>((r) => server.close(() => r())) };
  }

  it("token del canal: el de la ruta o, si no, el de la cabecera X-Canal-Token o Authorization: Bearer", () => {
    expect(inboundTokenOf({ params: { token: "de-la-ruta" }, headers: { "x-canal-token": "otro" } } as any)).toBe("de-la-ruta");
    expect(inboundTokenOf({ params: {}, headers: { "x-canal-token": " abc " } } as any)).toBe("abc");
    expect(inboundTokenOf({ params: {}, headers: { authorization: "Bearer xyz" } } as any)).toBe("xyz");
    expect(inboundTokenOf({ params: {}, headers: { authorization: "Basic xyz" } } as any)).toBe("");
    expect(inboundTokenOf({ params: {}, headers: {} } as any)).toBe("");
  });

  it("lector del cuerpo: solo JSON y como mucho 64 KB", async () => {
    const app = express();
    app.use(multichannelBodyParser);
    app.post("/canal/:token/ventas", (req, res) => void res.json({ body: req.body }));
    const s = await serve(app);
    try {
      expect((await s.send("POST", "/canal/x/ventas", "ref=1", "application/x-www-form-urlencoded")).status).toBe(415);
      expect((await s.send("POST", "/canal/x/ventas", "{no json")).status).toBe(400);
      expect((await s.send("POST", "/canal/x/ventas", JSON.stringify({ ref: "a".repeat(MC_LIMITS.inboundBytes) }))).status).toBe(413);
      expect((await s.send("POST", "/canal/x/ventas", JSON.stringify({ ref: "A-1" }))).json).toEqual({ body: { ref: "A-1" } });
    } finally {
      await s.close();
    }
  });

  it("en la instalación única no se sirve (503) y no toca la base de datos", async () => {
    const app = express();
    app.use(createMultichannelPublicRouter());
    const s = await serve(app);
    try {
      expect((await s.send("POST", "/canal/" + "a".repeat(43) + "/ventas", JSON.stringify({ ref: "A-1" }))).status).toBe(503);
      expect((await s.send("GET", "/canal/" + "a".repeat(43) + "/disponibilidad")).status).toBe(503);
    } finally {
      await s.close();
    }
  });
});

describe("registro", () => {
  it("el namespace multichannel exige la capacidad multichannel", () => {
    expect(TRPC_ROUTER_CAPABILITIES.multichannel).toBe("multichannel");
    expect(capabilityForProcedure("multichannel.channels")).toBe("multichannel");
  });
  it("menú de módulos contratados, solo administración", () => {
    const item = TASK_NAV.flatMap((s) => s.items).find((i) => i.href === "/admin/multicanal");
    expect(item).toMatchObject({ capabilities: ["multichannel"], roles: ["admin"] });
  });
  it("credenciales de Fourvenues y Weezevent preparadas en la bóveda, solo con la capacidad", () => {
    for (const id of ["fourvenues", "weezevent"]) {
      const p = PROVIDERS.find((x) => x.id === id)!;
      expect(p.panel).toMatchObject({ group: "channels", requires: ["multichannel"] });
      expect(p.fields.find((f) => f.key === "apiKey")?.secret).toBe(true);
    }
  });
  it("la migración 0059 solo crea tablas y su reversión las quita", () => {
    const dir = path.resolve(__dirname, "../db/migrations");
    const up = fs.readFileSync(path.join(dir, "0059_extra_multicanal.sql"), "utf8");
    const statements = up.replace(/--.*$/gm, "").split(";").map((s) => s.trim()).filter(Boolean);
    expect(statements.length).toBe(7);
    for (const s of statements) expect(s).toMatch(/^CREATE TABLE IF NOT EXISTS mc_[a-z_]+ \(/);
    const down = fs.readFileSync(path.join(dir, "0059_extra_multicanal.down.sql"), "utf8");
    expect(down.match(/mc_[a-z_]+/g)?.sort()).toEqual(statements.map((s) => s.match(/mc_[a-z_]+/)![0]).sort());
  });
});

describe("reintento con los datos originales", () => {
  it("recupera la venta tal como llegó (sale_input), no las columnas por defecto", () => {
    const sale = parseInboundSale({ ref: "L-1", code: "LOFT", date: "2026-12-01", endDate: "2026-12-04", units: 1, people: 2, amount: 450, commission: 60, customer: { name: "Ana", email: "ana@cliente.example", phone: "600" } });
    if (!sale.ok) throw new Error(sale.problem);
    const { event: _e, ...rest } = sale.sale;
    const row = { external_ref: "L-1", sale_input: JSON.stringify(rest), service_day: "2026-12-01", units: 1, gross_cents: 0, product_code: null, external_code: null };
    expect(storedSaleInput(row)).toEqual(sale.sale);
  });
  it("sin sale_input, usa las columnas guardadas (código del producto incluido)", () => {
    expect(storedSaleInput({ external_ref: "X", product_code: "KAYAK", service_day: "2026-12-01", service_end_day: null, service_time: "10:00", units: 2, gross_cents: 5000, customer_name: "Eva", customer_email: null, customer_phone: null })).toMatchObject({ code: "KAYAK", day: "2026-12-01", time: "10:00", units: 2, grossCents: 5000, customerName: "Eva" });
  });
});
