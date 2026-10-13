/**
 * Acceso a documentos y rutas administrativas (hallazgos de seguridad 01A-05):
 *  - vista de factura: enlace firmado o sesión del equipo (el número correlativo no basta),
 *  - HTML de factura con los textos de usuario escapados,
 *  - exportación de liquidaciones: solo administradores,
 *  - rutas de diagnóstico/recuperación: sesión admin o cabecera, nunca token en la URL.
 *
 * BD, sesiones y RBAC simulados. Los valores sensibles son marcadores ficticios.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";

const state = vi.hoisted(() => ({ invoiceRows: [] as any[] }));

vi.mock("mysql2/promise", () => {
  const pool = { execute: async () => [[]], query: async () => [[]] };
  return { default: { createPool: () => pool }, createPool: () => pool };
});

vi.mock("drizzle-orm/mysql2", async () => {
  const schema: any = await import("../drizzle/schema");
  return {
    drizzle: () => ({
      select: () => ({
        from: (table: unknown) => {
          const rows = table === schema.invoices ? state.invoiceRows : [];
          const where = () =>
            Object.assign(Promise.resolve(rows), { limit: async () => rows, orderBy: async () => rows });
          const chain: any = Object.assign(Promise.resolve(rows), { where, limit: async () => rows, orderBy: async () => rows });
          chain.leftJoin = () => chain;
          chain.innerJoin = () => chain;
          return chain;
        },
      }),
      insert: () => ({ values: async () => ({}) }),
      update: () => ({ set: () => ({ where: async () => ({}) }) }),
    }),
  };
});

vi.mock("./localAuth", () => ({
  verifySessionToken: async () => null,
  getUserFromRequest: async (req: { headers: { cookie?: string } }) => {
    const m = /(?:^|;\s*)nayade_session=([^;]*)/.exec(req.headers.cookie ?? "");
    if (!m) return null;
    const users: Record<string, object> = {
      admin: { id: 1, role: "admin", isActive: true },
      agente: { id: 2, role: "agente", isActive: true },
      supplier: { id: 4, role: "supplier", isActive: true },
      inactive: { id: 6, role: "admin", isActive: false },
    };
    return users[decodeURIComponent(m[1])] ?? null;
  },
}));
vi.mock("./_core/sdk", () => ({ sdk: { authenticateRequest: async () => null } }));
vi.mock("./_core/rbac", () => ({
  checkRbacOrLegacy: async (_id: number, role: string, key: string) =>
    key === "crm.view" && ["admin", "agente"].includes(role),
  getUserPermissions: async () => [],
}));

import { signInvoiceLink, verifyInvoiceLink, invoicePreviewPath, secureEqual } from "./_core/signedLinks";
import invoicePreviewRouter from "./invoicePreviewRouter";
import settlementExportRouter from "./settlementExportRoutes";
import redsysRouter from "./redsysRoutes";
import { buildInvoiceHtml } from "./invoiceHtml";

let server: http.Server;
let port: number;
const RECOVERY = "ficticio-recovery-token-pruebas";

function get(path: string, opts: { cookie?: string; headers?: Record<string, string> } = {}, method = "GET") {
  return new Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }>((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        method,
        path,
        headers: { ...(opts.cookie ? { cookie: `nayade_session=${opts.cookie}` } : {}), ...(opts.headers ?? {}) },
      },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body, headers: res.headers }));
      },
    );
    req.on("error", reject);
    req.end();
  });
}

beforeAll(async () => {
  process.env.LOCAL_AUTH = "true";
  process.env.JWT_SECRET = "ficticio-secreto-de-firma-para-pruebas-0000";
  process.env.RECOVERY_TOKEN = RECOVERY;
  const app = express();
  app.use(express.json());
  app.use(invoicePreviewRouter);
  app.use(settlementExportRouter);
  app.use(redsysRouter);
  await new Promise<void>((r) => {
    server = app.listen(0, "127.0.0.1", () => r());
  });
  port = (server.address() as AddressInfo).port;
});
afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});
beforeEach(() => {
  state.invoiceRows = [
    {
      invoiceNumber: "FAC-2026-0001",
      clientName: "Cliente de Prueba",
      clientEmail: "cliente@example.invalid",
      clientPhone: "600000000",
      clientNif: "00000000T",
      clientAddress: "Calle Falsa 1",
      itemsJson: [],
      subtotal: "100.00",
      taxRate: "21",
      taxAmount: "17.36",
      total: "100.00",
      issuedAt: new Date("2026-01-01"),
    },
  ];
});

describe("enlaces firmados", () => {
  it("firma y verifica; una firma o un número distinto falla", () => {
    const sig = signInvoiceLink("FAC-2026-0001");
    expect(verifyInvoiceLink("FAC-2026-0001", sig)).toBe(true);
    expect(verifyInvoiceLink("FAC-2026-0002", sig)).toBe(false);
    expect(verifyInvoiceLink("FAC-2026-0001", sig.slice(0, -1) + (sig.endsWith("a") ? "b" : "a"))).toBe(false);
    expect(verifyInvoiceLink("FAC-2026-0001", undefined)).toBe(false);
    expect(verifyInvoiceLink("FAC-2026-0001", "")).toBe(false);
  });
  it("invoicePreviewPath incluye número y firma", () => {
    const p = invoicePreviewPath("FAC-2026-0001");
    expect(p).toContain("n=FAC-2026-0001");
    expect(p).toContain(`sig=${signInvoiceLink("FAC-2026-0001")}`);
  });
  it("secureEqual", () => {
    expect(secureEqual("a", "a")).toBe(true);
    expect(secureEqual("a", "b")).toBe(false);
    expect(secureEqual("", "")).toBe(false);
    expect(secureEqual(undefined, "a")).toBe(false);
  });
});

describe("GET /api/invoices/preview", () => {
  it("sin firma ni sesión → 401 (el número correlativo no basta)", async () => {
    const r = await get("/api/invoices/preview?n=FAC-2026-0001");
    expect(r.status).toBe(401);
    expect(r.body).not.toContain("Cliente de Prueba");
  });
  it("con firma incorrecta → 401", async () => {
    const r = await get("/api/invoices/preview?n=FAC-2026-0001&sig=00000000000000000000000000000000");
    expect(r.status).toBe(401);
  });
  it("la firma de otra factura no sirve → 401", async () => {
    const r = await get(`/api/invoices/preview?n=FAC-2026-0001&sig=${signInvoiceLink("FAC-2026-0002")}`);
    expect(r.status).toBe(401);
  });
  it("con firma válida → 200 y cabeceras de privacidad", async () => {
    const r = await get(invoicePreviewPath("FAC-2026-0001"));
    expect(r.status).toBe(200);
    expect(r.body).toContain("Cliente de Prueba");
    expect(r.headers["cache-control"]).toContain("no-store");
    expect(r.headers["x-robots-tag"]).toContain("noindex");
  });
  it("con sesión del equipo → 200", async () => {
    const r = await get("/api/invoices/preview?n=FAC-2026-0001", { cookie: "agente" });
    expect(r.status).toBe(200);
  });
  it("con sesión sin permiso (proveedor) o desactivada → 401", async () => {
    expect((await get("/api/invoices/preview?n=FAC-2026-0001", { cookie: "supplier" })).status).toBe(401);
    expect((await get("/api/invoices/preview?n=FAC-2026-0001", { cookie: "inactive" })).status).toBe(401);
  });
  it("no revela si una factura existe a quien no está autorizado", async () => {
    state.invoiceRows = [];
    const r = await get("/api/invoices/preview?n=FAC-2026-9999");
    expect(r.status).toBe(401);
  });
});

describe("buildInvoiceHtml escapa textos de usuario", () => {
  it("neutraliza HTML en cliente, dirección y conceptos", async () => {
    const html = await buildInvoiceHtml({
      invoiceNumber: "FAC-2026-0001",
      clientName: `<script>alert("x")</script>`,
      clientEmail: "a@example.invalid",
      clientPhone: "<img src=x onerror=alert(1)>",
      clientNif: "00000000T",
      clientAddress: `"><svg onload=alert(1)>`,
      itemsJson: [{ description: "<b>Concepto</b>", quantity: 1, unitPrice: 10, total: 10 }],
      subtotal: "10.00",
      taxRate: "21",
      taxAmount: "1.74",
      total: "10.00",
      issuedAt: new Date("2026-01-01"),
    });
    expect(html).not.toContain("<script>alert");
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain("<svg onload");
    expect(html).not.toContain("<b>Concepto</b>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&lt;b&gt;Concepto&lt;/b&gt;");
  });
});

describe("GET /api/settlements/:id/export-excel", () => {
  const path = "/api/settlements/1/export-excel";
  it("sin sesión → 401", async () => {
    expect((await get(path)).status).toBe(401);
  });
  it("con sesión sin rol admin (proveedor, agente) → 403", async () => {
    expect((await get(path, { cookie: "supplier" })).status).toBe(403);
    expect((await get(path, { cookie: "agente" })).status).toBe(403);
  });
  it("usuario desactivado → 401", async () => {
    expect((await get(path, { cookie: "inactive" })).status).toBe(401);
  });
  it("administrador → supera la autenticación (404 por no existir la liquidación simulada)", async () => {
    const r = await get(path, { cookie: "admin" });
    expect([401, 403]).not.toContain(r.status);
  });
});

describe("rutas de diagnóstico y recuperación", () => {
  const diag = "/api/admin/diagnose-order/ORDER123";
  it("token en la URL ya no se acepta → 401", async () => {
    expect((await get(`${diag}?token=${RECOVERY}`)).status).toBe(401);
  });
  it("sin credenciales → 401", async () => {
    expect((await get(diag)).status).toBe(401);
  });
  it("cabecera con token incorrecto → 401", async () => {
    expect((await get(diag, { headers: { "x-recovery-token": RECOVERY + "x" } })).status).toBe(401);
  });
  it("sesión sin rol admin → 401", async () => {
    expect((await get(diag, { cookie: "agente" })).status).toBe(401);
  });
  it("cabecera con el token correcto → supera la autenticación", async () => {
    const r = await get(diag, { headers: { "x-recovery-token": RECOVERY } });
    expect(r.status).not.toBe(401);
  });
  it("sesión admin → supera la autenticación", async () => {
    const r = await get(diag, { cookie: "admin" });
    expect(r.status).not.toBe(401);
  });
  it("recover-order (POST) también exige credenciales", async () => {
    expect((await get("/api/admin/recover-order/ORDER123?token=" + RECOVERY, {}, "POST")).status).toBe(401);
  });
});
