/**
 * Permiso propio para precios y paquetes personalizados de las suscripciones
 * (`commercial.subscription.custom_pricing.manage`): existe en el plano de control, solo lo tienen superadministrador
 * y administrador, es independiente de `subscriptions:write` y `orders:approve` en los dos sentidos, y ningún token
 * de servicio lo recibe sin que se le asigne expresamente (tampoco el del Core, `core-commerce`). Datos sintéticos.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { authenticate, hashToken, parseTokens, requireScope, SCOPES, type Scope, type ServiceToken } from "./controlPlane/auth";
import { ROLES, ROLE_SCOPES, type OperatorRole } from "./controlPlane/operatorRoles";
import type { ValidSession } from "./controlPlane/operatorAuth";
import { parseSsoUsers } from "./controlPlane/sso";
import { CORE_COMMERCE_SCOPES, CORE_COMMERCE_TOKEN_ID, commerceChannelPlan } from "../scripts/deploy/esRailwayLib";

const CUSTOM_PRICING = "commercial.subscription.custom_pricing.manage" satisfies Scope;
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

describe("el permiso existe y tiene el nombre acordado", () => {
  it("figura una sola vez en SCOPES", () => {
    expect(SCOPES.filter((s) => s === CUSTOM_PRICING)).toEqual([CUSTOM_PRICING]);
  });

  it("es el único ámbito de su familia: no hay variantes que lo concedan por otro nombre", () => {
    expect(SCOPES.filter((s) => /custom_pricing|^commercial\./.test(s))).toEqual([CUSTOM_PRICING]);
  });
});

describe("reparto por rol", () => {
  it("solo superadministrador y administrador", () => {
    const withIt = ROLES.filter((r) => ROLE_SCOPES[r].includes(CUSTOM_PRICING));
    expect(withIt).toEqual(["superadmin", "admin"]);
  });

  it("comercial, soporte y solo lectura no lo tienen, aunque tengan permisos de suscripciones o pedidos", () => {
    for (const r of ["sales", "support", "readonly"] as const) expect(ROLE_SCOPES[r]).not.toContain(CUSTOM_PRICING);
    // Comercial opera pedidos y consulta suscripciones: eso no le da los precios personalizados
    expect(ROLE_SCOPES.sales).toEqual(expect.arrayContaining(["orders:write", "subscriptions:read"]));
  });

  it("los permisos de suscripciones y de aprobación de pedidos no cambian de manos", () => {
    const withScope = (s: Scope) => ROLES.filter((r) => ROLE_SCOPES[r].includes(s));
    expect(withScope("subscriptions:write")).toEqual(["superadmin", "admin"]);
    expect(withScope("orders:approve")).toEqual(["superadmin", "admin"]);
    expect(withScope("orders:write")).toEqual(["superadmin", "admin", "sales"]);
  });
});

describe("tokens de servicio y SSO", () => {
  it("el token del Core (core-commerce) no lo incluye, ni al crearlo ni al rotarlo", () => {
    expect(CORE_COMMERCE_SCOPES as readonly string[]).not.toContain(CUSTOM_PRICING);
    expect([...CORE_COMMERCE_SCOPES].sort()).toEqual(["commerce:purchase", "commerce:support", "commerce:withdrawal"]);
    const plan = commerceChannelPlan({ controlplane: { PORT: "4100", CP_TOKENS: "[]" }, core: {} }, { newTokenSha256: sha("nuevo") });
    const created = (JSON.parse(plan.cpTokens!) as Array<{ id: string; scopes: string[] }>).find((t) => t.id === CORE_COMMERCE_TOKEN_ID)!;
    expect(created.scopes).not.toContain(CUSTOM_PRICING);
    // Rotación: una entrada core-commerce que ya no corresponde al token del Core se sustituye con los mismos tres ámbitos
    const other = { id: "crm", sha256: sha("crm"), scopes: ["subscriptions:write", "orders:approve"] };
    const stale = { id: CORE_COMMERCE_TOKEN_ID, sha256: sha("antiguo"), scopes: ["commerce:purchase"] };
    const rotated = commerceChannelPlan({ controlplane: { PORT: "4100", CP_TOKENS: JSON.stringify([other, stale]) }, core: { CP_COMMERCE_TOKEN: "perdido" } }, { newTokenSha256: sha("nuevo") });
    expect(JSON.parse(rotated.cpTokens!)).toEqual([other, { id: CORE_COMMERCE_TOKEN_ID, sha256: sha("nuevo"), scopes: ["commerce:purchase", "commerce:withdrawal", "commerce:support"] }]);
    // Token del Core aceptado por otra entrada: no se reescribe CP_TOKENS (nadie gana ámbitos)
    const boot = { id: "arranque", sha256: sha("arranque"), scopes: [...CORE_COMMERCE_SCOPES, "ops:read"] };
    const kept = commerceChannelPlan({ controlplane: { PORT: "4100", CP_TOKENS: JSON.stringify([boot]) }, core: { CP_COMMERCE_TOKEN: "arranque" } }, { newTokenSha256: sha("nuevo") });
    expect(kept.cpTokens).toBeNull();
  });

  it("un token existente conserva exactamente sus ámbitos: no hay comodines ni ámbitos implícitos", () => {
    const raw = [
      { id: "crm", sha256: sha("crm"), scopes: ["subscriptions:read", "subscriptions:write", "orders:read", "orders:write", "orders:approve"] },
      { id: CORE_COMMERCE_TOKEN_ID, sha256: sha("core"), scopes: [...CORE_COMMERCE_SCOPES] },
    ];
    const parsed = parseTokens(JSON.stringify(raw));
    expect(parsed.map((t) => t.scopes)).toEqual(raw.map((t) => t.scopes));
    for (const t of parsed) expect(t.scopes).not.toContain(CUSTOM_PRICING);
    // Un comodín o un prefijo no son ámbitos: la entrada entera se descarta
    for (const bad of ["*", "commercial.*", "commercial.subscription", "commercial.subscription.custom_pricing", "commerce:*"]) {
      expect(parseTokens(JSON.stringify([{ id: "x", sha256: sha("x"), scopes: [bad] }]))).toEqual([]);
    }
  });

  it("el nombre con puntos y guion bajo se acepta cuando se asigna expresamente (CP_TOKENS y usuarios SSO)", () => {
    expect(parseTokens(JSON.stringify([{ id: "x", sha256: sha("x"), scopes: [CUSTOM_PRICING] }]))).toHaveLength(1);
    expect(parseSsoUsers(JSON.stringify([{ email: "ana@elephant.test", scopes: [CUSTOM_PRICING] }]))).toEqual([{ email: "ana@elephant.test", scopes: [CUSTOM_PRICING] }]);
  });
});

describe("independencia de subscriptions:write y orders:approve (autenticación real del plano de control)", () => {
  const T = {
    // Todo MENOS el permiso nuevo: ni la suma de los demás ámbitos lo concede
    resto: "ci-only-placeholder-not-a-secret-resto",
    solo: "ci-only-placeholder-not-a-secret-solo-precios",
    core: "ci-only-placeholder-not-a-secret-core-commerce",
  };
  const tokens: ServiceToken[] = [
    { id: "resto", sha256: hashToken(T.resto), scopes: SCOPES.filter((s) => s !== CUSTOM_PRICING) },
    { id: "solo-precios", sha256: hashToken(T.solo), scopes: [CUSTOM_PRICING] },
    { id: CORE_COMMERCE_TOKEN_ID, sha256: hashToken(T.core), scopes: [...CORE_COMMERCE_SCOPES] },
  ];
  let server: http.Server;
  let base: string;

  beforeAll(async () => {
    const session = (role: OperatorRole): ValidSession =>
      ({ operator: { id: 1, username: role, displayName: role, role, status: "active" }, session: { id: `sesion-${role}-000000000000`, operatorId: 1, csrfToken: "csrf" }, scopes: ROLE_SCOPES[role] }) as unknown as ValidSession;
    const app = express();
    app.use(
      authenticate(tokens, undefined, {
        operators: { validateSession: async (t: string) => ((ROLES as readonly string[]).includes(t) ? session(t as OperatorRole) : null) },
        allowedOrigins: new Set(),
      }),
    );
    const ok: express.RequestHandler = (_req, res) => void res.json({ ok: true });
    app.get("/precios", requireScope(CUSTOM_PRICING), ok);
    app.get("/suscripciones", requireScope("subscriptions:write"), ok);
    app.get("/aprobar", requireScope("orders:approve"), ok);
    server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    server?.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  });

  const withToken = async (path: string, token: string) => (await fetch(base + path, { headers: { authorization: `Bearer ${token}` } })).status;
  const withRole = async (path: string, role: OperatorRole) => {
    const res = await fetch(base + path, { headers: { cookie: `be_cp_session=${role}` } });
    return { status: res.status, body: await res.json() };
  };

  it("con todos los demás ámbitos (incluidos subscriptions:write y orders:approve) y sin el nuevo: 403", async () => {
    expect(await withToken("/suscripciones", T.resto)).toBe(200);
    expect(await withToken("/aprobar", T.resto)).toBe(200);
    expect(await withToken("/precios", T.resto)).toBe(403);
  });

  it("solo con el nuevo: gestiona precios, pero ni opera suscripciones ni aprueba pedidos", async () => {
    expect(await withToken("/precios", T.solo)).toBe(200);
    expect(await withToken("/suscripciones", T.solo)).toBe(403);
    expect(await withToken("/aprobar", T.solo)).toBe(403);
  });

  it("el token del Core (commerce:*) no gestiona precios personalizados", async () => {
    expect(await withToken("/precios", T.core)).toBe(403);
  });

  it("por sesión de operador: superadministrador y administrador sí; comercial, soporte y solo lectura 403 con el ámbito exigido", async () => {
    for (const role of ROLES) {
      const r = await withRole("/precios", role);
      if (role === "superadmin" || role === "admin") expect(r, role).toEqual({ status: 200, body: { ok: true } });
      else expect(r, role).toEqual({ status: 403, body: { error: "forbidden", scope: CUSTOM_PRICING } });
    }
  });
});
