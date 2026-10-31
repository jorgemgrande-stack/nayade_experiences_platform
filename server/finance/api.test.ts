/**
 * API /cp/v1/finance con Express real y la autenticación real del plano de control: lectura con finance:read,
 * contabilizar con finance:post y sesión de operador, cierres con finance:sensitive, errores en español y
 * exportaciones CSV.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { authenticate, hashToken, type Scope } from "../controlPlane/auth";
import { requestIdMiddleware } from "../_core/ops/requestContext";
import type { ValidSession } from "../controlPlane/operatorAuth";
import { createFinanceRouter } from "./api";
import { FinanceService } from "./service";
import { MemoryFinanceStore } from "./store";
import { seededPlan } from "./testkit";

const READ = "ci-only-placeholder-not-a-secret-fin-r";
const WRITE = "ci-only-placeholder-not-a-secret-fin-w";
const CSRF = "csrf-de-prueba-1234567890";
const SESSIONS: Record<string, { role: string; scopes: Scope[] }> = {
  "sesion-admin-000000000000": { role: "admin", scopes: ["finance:read", "finance:expenses", "finance:suppliers", "finance:post", "finance:tax", "finance:config", "finance:export", "finance:sensitive"] },
  // Comercial con permiso de escritura de facturación (hipotético): contabiliza, pero no cierra
  "sesion-comercial-000000000": { role: "sales", scopes: ["finance:read", "finance:expenses", "finance:suppliers", "finance:post", "finance:tax", "finance:export"] },
  "sesion-lectura-00000000000": { role: "readonly", scopes: ["finance:read", "finance:export"] },
};

function fakeSession(token: string): ValidSession | null {
  const s = SESSIONS[token];
  if (!s) return null;
  return { operator: { id: 1, username: token.split("-")[1], displayName: token, role: s.role, status: "active" }, session: { id: `${token}-id-0000000000`, operatorId: 1, csrfToken: CSRF }, scopes: s.scopes } as unknown as ValidSession;
}

describe("API /cp/v1/finance", () => {
  let server: http.Server;
  let base: string;
  const store = new MemoryFinanceStore(seededPlan());
  const svc = new FinanceService({ store, now: () => Date.UTC(2026, 9, 30, 10) });

  beforeAll(async () => {
    await svc.createFiscalYear(2026, { by: "test", requestId: null });
    const app = express();
    app.use(requestIdMiddleware);
    app.use(express.json());
    app.use(
      authenticate(
        [
          { id: "lector", sha256: hashToken(READ), scopes: ["finance:read", "finance:export"], actorType: "crm" },
          { id: "integracion", sha256: hashToken(WRITE), scopes: ["finance:read", "finance:expenses", "finance:suppliers", "finance:post", "finance:tax", "finance:export"], actorType: "crm" },
        ],
        undefined,
        { operators: { validateSession: async (t: string) => fakeSession(t) }, allowedOrigins: new Set() },
      ),
    );
    app.use("/cp/v1/finance", createFinanceRouter(svc));
    server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/cp/v1/finance`;
  });
  afterAll(async () => {
    server?.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  });

  /** `who`: token de servicio (Bearer) o sesión de operador (cookie + CSRF). */
  const call = async (method: string, p: string, who: string, body?: unknown) => {
    const session = who.startsWith("sesion-");
    const headers: Record<string, string> = session ? { cookie: `be_cp_session=${who}`, "x-csrf-token": CSRF, "x-request-id": "req-api-1" } : { authorization: `Bearer ${who}` };
    if (body) headers["content-type"] = "application/json";
    const res = await fetch(base + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
    // Bytes tal cual (res.text() quitaría el BOM)
    const text = Buffer.from(await res.arrayBuffer()).toString("utf8");
    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    return { status: res.status, json, text, headers: res.headers };
  };
  const ADMIN = "sesion-admin-000000000000";
  const SALES = "sesion-comercial-000000000";
  const RO = "sesion-lectura-00000000000";
  const entry = { date: "2026-03-10", journal: "COM", description: "Hosting marzo", lines: [{ accountCode: "629", debitCents: 10_000 }, { accountCode: "472", debitCents: 2_100 }, { accountCode: "410", creditCents: 12_100 }] };

  it("lectura con finance:read (token o sesión); sin él, 403", async () => {
    const accounts = await call("GET", "/accounts", READ);
    expect(accounts.status).toBe(200);
    expect(accounts.json.total).toBe(58);
    expect((await call("GET", "/journals", RO)).json.items).toHaveLength(11);
    expect((await call("GET", "/fiscal-years", READ)).json.items[0].periods).toHaveLength(12);
    expect((await call("GET", "/summary", READ)).json).toMatchObject({ asOf: "2026-10-30", banks: null });
  });

  it("escrituras: 403 sin finance:post, 403 con token de servicio (solo personas), 201 con sesión", async () => {
    expect((await call("POST", "/entries", READ, entry)).status).toBe(403);
    expect((await call("POST", "/entries", RO, entry)).status).toBe(403);
    const svcToken = await call("POST", "/entries", WRITE, entry);
    expect(svcToken.status).toBe(403);
    expect(svcToken.json.error).toBe("operator_session_required");
    const created = await call("POST", "/entries", SALES, { ...entry, post: true });
    expect(created.status).toBe(201);
    expect(created.json.item).toMatchObject({ status: "posted", number: 1, createdBy: "operator:comercial" });
    expect(store.audit.at(-1)).toMatchObject({ action: "entry.create_posted", actor: "operator:comercial", requestId: "req-api-1" });
    expect((await call("POST", "/sync/invoices", WRITE)).status).toBe(403);
    expect((await call("POST", "/sync/invoices", SALES)).status).toBe(503);
  });

  it("cierres, reaperturas y configuración: 403 sin finance:sensitive o finance:config", async () => {
    const denied = await call("POST", "/periods/2026/1/close", SALES);
    expect(denied.status).toBe(403);
    expect(denied.json).toMatchObject({ error: "forbidden", scope: "finance:sensitive" });
    expect((await call("POST", "/fiscal-years/2026/close", SALES)).status).toBe(403);
    expect((await call("POST", "/accounts", SALES, { code: "57200001", name: "BBVA" })).status).toBe(403);
    expect((await call("POST", "/periods/2026/1/close", WRITE)).status).toBe(403);

    expect((await call("POST", "/accounts", ADMIN, { code: "57200001", name: "BBVA" })).json.item).toMatchObject({ parentCode: "572", type: "asset" });
    expect((await call("POST", "/periods/2026/2/close", ADMIN)).json.item).toMatchObject({ month: 2, status: "closed", closedBy: "operator:admin" });
    const closed = await call("POST", "/entries", SALES, { ...entry, date: "2026-02-10", post: true });
    expect(closed.status).toBe(409);
    expect(closed.json).toEqual({ error: "period_closed", message: "El periodo 2026-02 está cerrado" });
    expect((await call("POST", "/periods/2026/2/reopen", ADMIN)).json.item.status).toBe("open");
    // Cerrar el ejercicio con periodos abiertos: 409
    expect((await call("POST", "/fiscal-years/2026/close", ADMIN)).status).toBe(409);
  });

  it("errores de validación y de cuadre en español; 404 de asiento", async () => {
    const unbalanced = await call("POST", "/entries", SALES, { ...entry, lines: [{ accountCode: "629", debitCents: 100 }, { accountCode: "410", creditCents: 90 }] });
    expect(unbalanced.status).toBe(422);
    expect(unbalanced.json.error).toBe("unbalanced");
    expect(unbalanced.json.message).toMatch(/no cuadra/);
    const bad = await call("POST", "/entries", SALES, { ...entry, date: "10/03/2026" });
    expect(bad.status).toBe(400);
    expect(bad.json.error).toBe("invalid_input");
    expect((await call("POST", "/entries", SALES, { ...entry, lines: [{ accountCode: "572", debitCents: 1 }, { accountCode: "410", creditCents: 1 }] })).status).toBe(422);
    expect((await call("GET", "/entries/9999", READ)).status).toBe(404);
    expect((await call("GET", "/entries?limit=1000", READ)).status).toBe(400);
  });

  it("borrador → contabilizar → revertir (idempotente); listado con filtros, mayor y CSV", async () => {
    const d = await call("POST", "/entries", SALES, { ...entry, date: "2026-04-01", description: "Borrador abril" });
    expect(d.json.item.status).toBe("draft");
    expect((await call("POST", `/entries/${d.json.item.id}/post`, READ)).status).toBe(403);
    const p = await call("POST", `/entries/${d.json.item.id}/post`, SALES);
    expect(p.json.item).toMatchObject({ status: "posted", number: 2 });
    const r1 = await call("POST", `/entries/${d.json.item.id}/reverse`, SALES, { date: "2026-04-02", reason: "Duplicado" });
    expect(r1.status).toBe(201);
    const r2 = await call("POST", `/entries/${d.json.item.id}/reverse`, SALES, { date: "2026-04-02", reason: "Duplicado" });
    expect(r2.status).toBe(200);
    expect(r2.json).toMatchObject({ created: false, item: { id: r1.json.item.id } });

    const list = await call("GET", "/entries?from=2026-04-01&to=2026-04-30&account=629&sort=number&dir=asc&limit=10", READ);
    expect(list.json.total).toBe(2);
    expect(list.json.items.map((e: any) => e.origin)).toEqual(["manual", "reversal"]);
    expect((await call("GET", "/entries?origin=reversal", READ)).json.total).toBe(1);
    expect((await call("GET", "/entries?q=Borrador", READ)).json.total).toBe(1);

    const ledger = await call("GET", "/ledger/629?from=2026-04-01&to=2026-12-31", READ);
    expect(ledger.json).toMatchObject({ openingCents: 10_000, closingCents: 10_000 });
    expect(ledger.json.items.map((x: any) => x.balanceCents)).toEqual([20_000, 10_000]);
    expect(ledger.json.items[0]).toMatchObject({ entryNumber: 2, entryDate: "2026-04-01", journalCode: "COM" });

    const tb = await call("GET", "/trial-balance?from=2026-01-01&to=2026-12-31", READ);
    expect(tb.json.totals.debitCents).toBe(tb.json.totals.creditCents);
    const csv = await call("GET", "/journal.csv?from=2026-01-01&to=2026-12-31", READ);
    expect(csv.status).toBe(200);
    expect(csv.headers.get("content-type")).toMatch(/^text\/csv; charset=utf-8/);
    expect(csv.headers.get("content-disposition")).toBe('attachment; filename="libro-diario-2026-01-01-2026-12-31.csv"');
    expect(csv.text.charCodeAt(0)).toBe(0xfeff);
    expect(csv.text).toContain(";629;Otros servicios;100,00;0,00;");
    const tbCsv = await call("GET", "/trial-balance.csv?from=2026-01-01&to=2026-12-31", READ);
    expect(tbCsv.text.split("\r\n")[0]).toBe("﻿Cuenta;Nombre;Sumas debe;Sumas haber;Saldo deudor;Saldo acreedor");
  });

  it("anular: solo borradores y con motivo", async () => {
    const d = await call("POST", "/entries", SALES, { ...entry, date: "2026-05-01" });
    expect((await call("POST", `/entries/${d.json.item.id}/void`, SALES, { reason: "Error" })).json.item.status).toBe("void");
    expect((await call("POST", `/entries/${d.json.item.id}/void`, SALES, { reason: "Error" })).status).toBe(409);
    expect((await call("POST", "/entries/1/void", SALES, { reason: "Error" })).status).toBe(409);
  });
});
