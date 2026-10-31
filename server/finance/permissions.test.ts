/**
 * Permisos separados de las finanzas: recorre el router COMPLETO de /cp/v1/finance (todas las fases montadas) y
 * comprueba que ninguna ruta queda sin ámbito y que cada una exige exactamente el previsto en la tabla; el reparto
 * por rol; y que las denegaciones (403) quedan registradas en el log estructurado sin datos sensibles.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express, { type Router } from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { authenticate, hashToken, SCOPES, type Scope } from "../controlPlane/auth";
import { ROLE_SCOPES } from "../controlPlane/operatorRoles";
import type { ValidSession } from "../controlPlane/operatorAuth";
import { setLogSink } from "../_core/ops/log";
import { createFinanceRouter } from "./api";
import { capabilityOf, FINANCE_CAPABILITIES, FINANCE_OPERATOR_ONLY, FINANCE_SCOPE, type FinanceCapability } from "./permissions";

/** Ruta (MÉTODO patrón) → capacidad exigida. Cualquier ruta nueva de /finance tiene que figurar aquí. */
const EXPECTED: Record<string, FinanceCapability> = {
  // Libro (fase 1A)
  "GET /accounts": "read",
  "POST /accounts": "config",
  "PATCH /accounts/:code": "config",
  "GET /journals": "read",
  "GET /fiscal-years": "read",
  "POST /fiscal-years": "config",
  "POST /fiscal-years/:year/close": "sensitive",
  "POST /periods/:year/:month/close": "sensitive",
  "POST /periods/:year/:month/reopen": "sensitive",
  "GET /entries": "read",
  "GET /entries/:id": "read",
  "POST /entries": "post",
  "POST /entries/:id/post": "post",
  "POST /entries/:id/void": "post",
  "POST /entries/:id/reverse": "post",
  "GET /ledger/:code": "read",
  "GET /trial-balance": "read",
  "GET /journal.csv": "export",
  "GET /trial-balance.csv": "export",
  "POST /sync/invoices": "post",
  "GET /sync/status": "read",
  "GET /summary": "read",
  // Operaciones (fase 1B)
  "GET /cost-centers": "read",
  "POST /cost-centers": "expenses",
  "PATCH /cost-centers/:id": "expenses",
  "GET /categories": "read",
  "POST /categories": "expenses",
  "PATCH /categories/:id": "expenses",
  "GET /suppliers": "read",
  "POST /suppliers": "suppliers",
  "GET /suppliers/:id": "read",
  "PATCH /suppliers/:id": "suppliers",
  "GET /suppliers/:id/statement": "read",
  "GET /expenses": "read",
  "POST /expenses": "expenses",
  "GET /expenses/:id": "read",
  "PATCH /expenses/:id": "expenses",
  "POST /expenses/:id/register": "post",
  "POST /expenses/:id/void": "post",
  "POST /expenses/:id/payments": "post",
  "POST /expense-payments/:id/reverse": "post",
  "GET /documents": "read",
  "POST /documents": "expenses",
  "GET /documents/:id/content": "read",
  "POST /documents/:id/archive": "expenses",
  "GET /recurring": "read",
  "GET /recurring/preview": "read",
  "POST /recurring/run": "expenses",
  "POST /recurring": "expenses",
  "PATCH /recurring/:id": "expenses",
  "GET /bank-accounts": "read",
  "POST /bank-accounts": "expenses",
  "PATCH /bank-accounts/:id": "expenses",
  "POST /bank-imports": "expenses",
  "GET /bank-imports": "read",
  "GET /bank-movements": "read",
  "GET /bank-movements/:id/suggestions": "read",
  "POST /bank-movements/:id/match": "post",
  "POST /bank-movements/:id/unmatch": "post",
  "POST /bank-movements/:id/ignore": "expenses",
  "GET /cash-accounts": "read",
  "POST /cash-accounts": "expenses",
  "GET /cash-movements": "read",
  "POST /cash-movements": "post",
  // Stripe y conciliación (fase 2)
  "GET /stripe/settings": "read",
  "PATCH /stripe/settings": "config",
  "POST /stripe/imports": "expenses",
  "GET /stripe/imports": "read",
  "GET /stripe/transactions": "read",
  "POST /stripe/post": "post",
  "GET /stripe/payouts": "read",
  "GET /stripe/summary": "read",
  "GET /reconciliation/invoices": "read",
  "GET /reconciliation/payouts/:id": "read",
  "POST /reconciliation/payouts/:id/link-bank": "post",
  "POST /reconciliation/payouts/:id/unlink-bank": "post",
  "POST /reconciliation/transactions/:id/review": "post",
  // Gestoría (fase 3)
  "GET /tax/settings": "read",
  "PATCH /tax/settings": "config",
  "GET /tax/dashboard": "read",
  "GET /tax/calendar": "read",
  "POST /tax/calendar/generate": "tax",
  "GET /tax/obligations": "read",
  "GET /tax/obligations/:id": "read",
  "POST /tax/obligations/:id/calculate": "tax",
  "POST /tax/obligations/:id/review": "tax",
  "POST /tax/obligations/:id/present": "tax",
  "POST /tax/obligations/:id/pay": "tax",
  "POST /tax/obligations/:id/mark": "tax",
  "POST /tax/obligations/:id/reopen": "sensitive",
  "POST /tax/quarters/:year/:quarter/close": "sensitive",
  "GET /tax/models/:model/preview": "read",
  "GET /tax/registers/issued.csv": "export",
  "GET /tax/registers/received.csv": "export",
  "GET /tax/payrolls": "read",
  "POST /tax/payrolls": "post",
  "POST /tax/payrolls/:id/post": "post",
  "POST /tax/payrolls/:id/pay": "post",
  "GET /tax/deferrals": "read",
  "POST /tax/deferrals": "tax",
  "PATCH /tax/deferrals/:id": "tax",
  "POST /tax/deferrals/:id/installments/:n/pay": "tax",
  "GET /tax/dossiers": "read",
  "GET /tax/dossiers/:id": "read",
  "POST /tax/dossiers": "tax",
  "PATCH /tax/dossiers/:id": "tax",
  "POST /tax/dossiers/:id/log": "tax",
  "GET /tax/export.zip": "export",
  "GET /tax/corporate/:year": "read",
  "POST /tax/corporate/:year/adjustments": "tax",
  // Parametrización fiscal (CRM 0039)
  "POST /tax/settings/validate": "config",
  "GET /tax/corporate/presets": "read",
  "PUT /tax/corporate/:year/config": "tax",
  "POST /tax/corporate/:year/entry": "tax",
  "POST /tax/corporate/:year/entry/reverse": "tax",
  "POST /stripe/imports/preview": "expenses",
  "GET /stripe/fee-vat-rules": "read",
  "POST /stripe/fee-vat-rules": "config",
  "POST /stripe/fee-vat-rules/:id/void": "config",
  "GET /analysis/settings": "read",
  "PATCH /analysis/settings": "config",
  // Análisis (fase 4)
  "GET /daily": "read",
  "GET /daily/reviews": "read",
  "POST /daily/:date/review": "post",
  "GET /reports/:report.csv": "export",
  "GET /reports/pnl": "read",
  "GET /reports/balance": "read",
  "GET /reports/cashflow": "read",
  "GET /reports/aging": "read",
  "GET /reports/expenses": "read",
  "GET /analytics/revenue-margin": "read",
  "GET /analytics/conversion-health": "read",
};

type Layer = { route?: { path: string; methods: Record<string, boolean>; stack: { handle: unknown; name?: string }[] } };

/** Router completo con servicios de mentira (las rutas no se ejecutan: solo se inspecciona el montaje), con la 0039. */
function fullRouter(): Router {
  const fake = {} as never;
  return createFinanceRouter(fake, fake, fake, fake, fake, fake, true);
}

function routesOf(r: Router): { key: string; caps: FinanceCapability[]; handlers: unknown[] }[] {
  return (r.stack as Layer[])
    .filter((l) => l.route)
    .flatMap((l) =>
      Object.keys(l.route!.methods)
        .filter((m) => l.route!.methods[m])
        .map((m) => {
          const handlers = l.route!.stack.map((s) => s.handle);
          return { key: `${m.toUpperCase()} ${l.route!.path}`, caps: handlers.map(capabilityOf).filter((c): c is FinanceCapability => !!c), handlers };
        }),
    );
}

describe("permisos de /cp/v1/finance: ruta → ámbito", () => {
  const routes = routesOf(fullRouter());

  it("cada ruta montada figura en la tabla y exige EXACTAMENTE una capacidad, la prevista, en primer lugar", () => {
    expect(routes.length).toBeGreaterThan(100);
    const actual = Object.fromEntries(routes.map((r) => [r.key, r.caps]));
    const unknown = routes.filter((r) => !(r.key in EXPECTED)).map((r) => r.key);
    expect(unknown, "rutas de /finance sin entrada en la tabla de permisos").toEqual([]);
    const missing = Object.keys(EXPECTED).filter((k) => !(k in actual));
    expect(missing, "rutas de la tabla que ya no existen").toEqual([]);
    for (const r of routes) {
      expect(r.caps, r.key).toEqual([EXPECTED[r.key]]);
      // La comprobación va antes que cualquier otro manejador (también antes de leer cuerpos grandes)
      expect(capabilityOf(r.handlers[0]), r.key).toBe(EXPECTED[r.key]);
    }
  });

  it("las capacidades de operador añaden la comprobación de sesión justo después del ámbito", () => {
    for (const r of routes) {
      const cap = EXPECTED[r.key];
      const n = FINANCE_OPERATOR_ONLY.has(cap) ? 2 : 1;
      // ámbito (+ sesión) + manejador final (+ lector de cuerpo grande en las subidas)
      expect(r.handlers.length, r.key).toBeGreaterThanOrEqual(n + 1);
    }
    expect([...FINANCE_OPERATOR_ONLY].sort()).toEqual(["config", "post", "sensitive", "tax"]);
  });

  it("todas las capacidades se usan y sus ámbitos existen en el plano de control", () => {
    const used = new Set(Object.values(EXPECTED));
    expect([...used].sort()).toEqual([...FINANCE_CAPABILITIES].sort());
    for (const c of FINANCE_CAPABILITIES) expect(SCOPES).toContain(FINANCE_SCOPE[c]);
  });
});

describe("reparto de los ámbitos de finanzas por rol", () => {
  const fin = (role: keyof typeof ROLE_SCOPES) => ROLE_SCOPES[role].filter((s) => s.startsWith("finance:")).sort();
  const ALL = Object.values(FINANCE_SCOPE).sort();

  it("superadmin y admin: todos; readonly: solo consulta; comercial y soporte: ninguno", () => {
    expect(fin("superadmin")).toEqual(ALL);
    expect(fin("admin")).toEqual(ALL);
    expect(fin("readonly")).toEqual(["finance:read"]);
    // Comercial conserva su consulta comercial con billing:read; ni contabilidad, ni gestoría, ni exportaciones
    expect(fin("sales")).toEqual([]);
    expect(fin("support")).toEqual([]);
  });

  it("la facturación (billing:*) no cambia", () => {
    expect(ROLE_SCOPES.sales).toContain("billing:read");
    expect(ROLE_SCOPES.sales).not.toContain("billing:write");
    expect(ROLE_SCOPES.readonly).toContain("billing:read");
    expect(ROLE_SCOPES.support).not.toContain("billing:read");
  });
});

describe("denegaciones registradas", () => {
  const CSRF = "csrf-de-prueba-1234567890";
  const READ_TOKEN = "ci-only-placeholder-not-a-secret-fin-perm";
  const lines: string[] = [];
  let server: http.Server;
  let base: string;

  beforeAll(async () => {
    setLogSink((_level, line) => void lines.push(line));
    const session = (scopes: Scope[]): ValidSession =>
      ({ operator: { id: 7, username: "lectora", displayName: "Lectora", role: "readonly", status: "active" }, session: { id: "sesion-lectora-id-000000000", operatorId: 7, csrfToken: CSRF }, scopes }) as unknown as ValidSession;
    const app = express();
    app.use(express.json());
    app.use(
      authenticate([{ id: "lector", sha256: hashToken(READ_TOKEN), scopes: ["finance:read", "finance:post"], actorType: "crm" }], undefined, {
        operators: { validateSession: async (t: string) => (t === "sesion-lectora" ? session(ROLE_SCOPES.readonly as Scope[]) : null) },
        allowedOrigins: new Set(),
      }),
    );
    app.use("/cp/v1/finance", fullRouter());
    server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/cp/v1/finance`;
  });
  afterAll(async () => {
    setLogSink(null);
    server?.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  });

  it("sin el ámbito: 403 con el ámbito exigido y una línea `permission_denied` sin identificadores ni cuerpo", async () => {
    const res = await fetch(`${base}/periods/2026/3/close`, { method: "POST", headers: { cookie: "be_cp_session=sesion-lectora", "x-csrf-token": CSRF, "content-type": "application/json" }, body: JSON.stringify({ secreto: "no-se-registra" }) });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "forbidden", scope: "finance:sensitive" });
    const ev = lines.map((l) => JSON.parse(l)).filter((l) => l.event === "permission_denied");
    expect(ev.at(-1)).toEqual({ ctx: "Finance", event: "permission_denied", method: "POST", route: "/cp/v1/finance/periods/:year/:month/close", scope: "finance:sensitive", reason: "missing_scope", actorType: "operator", actorId: "lectora" });
    expect(lines.join("\n")).not.toContain("no-se-registra");
  });

  it("con el ámbito pero con token de servicio en una capacidad de operador: 403 registrado", async () => {
    const res = await fetch(`${base}/entries`, { method: "POST", headers: { authorization: `Bearer ${READ_TOKEN}`, "content-type": "application/json" }, body: "{}" });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("operator_session_required");
    expect(JSON.parse(lines.at(-1)!)).toMatchObject({ event: "permission_denied", route: "/cp/v1/finance/entries", scope: "finance:post", reason: "operator_session_required", actorType: "crm", actorId: "lector" });
  });

  it("exportar exige finance:export aunque se tenga finance:read", async () => {
    const res = await fetch(`${base}/journal.csv`, { headers: { cookie: "be_cp_session=sesion-lectora" } });
    expect(res.status).toBe(403);
    expect((await res.json()).scope).toBe("finance:export");
  });
});
