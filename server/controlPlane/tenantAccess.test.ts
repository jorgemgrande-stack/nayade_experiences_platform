/**
 * Accesos de las empresas (Clientes SaaS → Accesos): canal firmado plano de control → Core, salvaguardas y rutas.
 */
import express from "express";
import { SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import { OPS_ACCESS_PATH, signOpsAccessToken, verifyOpsAccessToken } from "../_core/opsAccess/token";
import { createOpsAccessRouter } from "../_core/opsAccess/router";
import { invitationState, mailGate } from "../_core/opsAccess/actions";
import { registerTenantAccessRoutes, type CoreAccessClient } from "./tenantAccess";

const SECRET = "s".repeat(40);
const OTHER = "o".repeat(40);

async function post(app: express.Express, path: string, headers: Record<string, string> = {}, body?: unknown) {
  const srv = app.listen(0);
  const port = (srv.address() as { port: number }).port;
  try {
    const r = await fetch(`http://127.0.0.1:${port}${path}`, { method: body === undefined && !path.startsWith("/cp") ? "POST" : body === "GET" ? "GET" : "POST", headers: { "content-type": "application/json", ...headers }, body: body === "GET" ? undefined : JSON.stringify(body ?? {}) });
    return { status: r.status, body: (await r.json().catch(() => ({}))) as Record<string, unknown> };
  } finally {
    srv.close();
  }
}

describe("token del canal interno de accesos", () => {
  it("firma y verifica empresa, acción, usuario, confirmación y operador", async () => {
    const t = await signOpsAccessToken({ tid: "t5-skibox", act: "reset", uid: 7, confirm: "a@b.es", op: "operator:jorge" }, SECRET);
    const c = await verifyOpsAccessToken(t, SECRET);
    expect(c).toMatchObject({ tid: "t5-skibox", act: "reset", uid: 7, confirm: "a@b.es", op: "operator:jorge" });
    expect(c!.jti).toMatch(/[0-9a-f-]{36}/);
  });

  it("rechaza otro secreto, un token de soporte firmado con el secreto en bruto y acciones sin usuario", async () => {
    const t = await signOpsAccessToken({ tid: "t5-skibox", act: "list", op: "operator:x" }, SECRET);
    expect(await verifyOpsAccessToken(t, OTHER)).toBeNull();
    const support = await new SignJWT({ tid: "t5-skibox", act: "list", op: "x" }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("60s").sign(new TextEncoder().encode(SECRET));
    expect(await verifyOpsAccessToken(support, SECRET)).toBeNull();
    const noUser = await signOpsAccessToken({ tid: "t5-skibox", act: "deactivate", op: "operator:x" }, SECRET);
    expect(await verifyOpsAccessToken(noUser, SECRET)).toBeNull();
    expect(await verifyOpsAccessToken(t, undefined)).toBeNull();
  });
});

describe("router del Core /_ops/access", () => {
  const app = (over: Partial<Parameters<typeof createOpsAccessRouter>[0]> = {}, seen: unknown[] = []) => {
    const a = express();
    a.use(
      createOpsAccessRouter({
        secret: SECRET,
        tenantAllowed: async (id) => id !== "borrada",
        run: async (tid, act, uid, confirm) => {
          seen.push({ tid, act, uid, confirm });
          if (uid === 99) return { ok: false, error: "last_admin", message: "último" };
          return { ok: true, action: act, users: [] };
        },
        log: () => {},
        ...over,
      }),
    );
    return a;
  };

  it("sin secreto el canal no existe; sin token o con uno falso, 401", async () => {
    expect((await post(app({ secret: undefined }), OPS_ACCESS_PATH)).status).toBe(404);
    expect((await post(app(), OPS_ACCESS_PATH)).status).toBe(401);
    const bad = await signOpsAccessToken({ tid: "t5-skibox", act: "list", op: "x" }, OTHER);
    expect((await post(app(), OPS_ACCESS_PATH, { authorization: `Bearer ${bad}` })).status).toBe(401);
  });

  it("la empresa sale del token, un token no se reutiliza y una empresa borrada no admite nada", async () => {
    const seen: Array<{ tid: string }> = [];
    const a = app({}, seen);
    const t = await signOpsAccessToken({ tid: "t5-skibox", act: "list", op: "x" }, SECRET);
    expect((await post(a, OPS_ACCESS_PATH, { authorization: `Bearer ${t}`, host: "otra-empresa.example" })).status).toBe(200);
    expect(seen[0].tid).toBe("t5-skibox");
    expect((await post(a, OPS_ACCESS_PATH, { authorization: `Bearer ${t}` })).status).toBe(409);
    const gone = await signOpsAccessToken({ tid: "borrada", act: "list", op: "x" }, SECRET);
    expect((await post(a, OPS_ACCESS_PATH, { authorization: `Bearer ${gone}` })).status).toBe(404);
  });

  it("las salvaguardas del Core llegan como 409 con su código", async () => {
    const t = await signOpsAccessToken({ tid: "t5-skibox", act: "deactivate", uid: 99, op: "x" }, SECRET);
    const r = await post(app(), OPS_ACCESS_PATH, { authorization: `Bearer ${t}` });
    expect(r).toMatchObject({ status: 409, body: { error: "last_admin" } });
  });
});

describe("reglas de envío e invitaciones", () => {
  const policy = (mode: "off" | "sandbox" | "live", allow: string[] = []) => ({ mode, allowAddresses: new Set(allow), allowDomains: new Set<string>() });
  it("con MAIL_MODE=off no sale nada; en sandbox solo a la lista; en live, sí", () => {
    expect(mailGate(policy("off"), "admin@skibox.es")).toBe("mail_disabled");
    expect(mailGate(policy("sandbox", ["jgrande@bigelephant.es"]), "admin@skibox.es")).toBe("sandbox_blocked");
    expect(mailGate(policy("sandbox", ["jgrande@bigelephant.es"]), "JGrande@bigelephant.es")).toBe("sent");
    expect(mailGate(policy("live"), "admin@skibox.es")).toBe("sent");
  });
  it("estado de la invitación", () => {
    const now = Date.now();
    expect(invitationState({ inviteAccepted: true, inviteToken: null, inviteTokenExpiry: null }, now)).toBe("accepted");
    expect(invitationState({ inviteAccepted: false, inviteToken: "x", inviteTokenExpiry: new Date(now + 1000) }, now)).toBe("pending");
    expect(invitationState({ inviteAccepted: false, inviteToken: "x", inviteTokenExpiry: new Date(now - 1000) }, now)).toBe("expired");
    expect(invitationState({ inviteAccepted: false, inviteToken: null, inviteTokenExpiry: null }, now)).toBe("none");
  });
});

describe("rutas del plano de control", () => {
  const make = (client: CoreAccessClient, events: unknown[], canWrite = true) => {
    const a = express();
    a.use(express.json());
    const r = express.Router();
    registerTenantAccessRoutes(r, {
      client,
      tenantExists: async (id) => id === "t5-skibox",
      record: async (_req, id, action, details) => void events.push({ id, action, details }),
      operatorOf: () => "operator:jorge",
      requireRead: (_q, _s, n) => n(),
      requireWrite: (_q, s, n) => (canWrite ? n() : void s.status(403).json({ error: "forbidden" })),
      wrap: (fn) => (q, s) => void fn(q, s).catch((e) => s.status(e?.name === "ZodError" ? 400 : 500).json({ error: "x" })),
    });
    a.use("/cp/v1", r);
    return a;
  };
  const calls: unknown[] = [];
  const client: CoreAccessClient = {
    call: async (c) => {
      calls.push(c);
      if (c.act === "list") return { status: 200, body: { mailMode: "off", users: [{ id: 1 }] } };
      if (c.act === "deactivate") return { status: 409, body: { error: "owner_protected" } };
      return { status: 200, body: { ok: true, mail: "mail_disabled" } };
    },
  };

  it("lista los usuarios con el modo de correo; empresa desconocida, 404", async () => {
    const r = await post(make(client, []), "/cp/v1/tenants/t5-skibox/access", {}, "GET");
    expect(r).toMatchObject({ status: 200, body: { tenantId: "t5-skibox", mailMode: "off", users: [{ id: 1 }] } });
    expect((await post(make(client, []), "/cp/v1/tenants/t9-nadie/access", {}, "GET")).status).toBe(404);
  });

  it("un envío exige motivo y el correo tecleado; el resultado y el motivo quedan en el historial sin correos", async () => {
    const ev: Array<{ action: string; details: Record<string, unknown> }> = [];
    const a = make(client, ev);
    expect((await post(a, "/cp/v1/tenants/t5-skibox/access/users/3/reset", {}, { reason: "corto" , confirmEmail: undefined })).status).toBe(400);
    expect((await post(a, "/cp/v1/tenants/t5-skibox/access/users/3/reset", {}, { reason: "El cliente lo ha pedido por teléfono" })).status).toBe(400);
    const ok = await post(a, "/cp/v1/tenants/t5-skibox/access/users/3/reset", {}, { reason: "El cliente lo ha pedido por teléfono", confirmEmail: "admin@skibox.es" });
    expect(ok).toMatchObject({ status: 200, body: { ok: true, mail: "mail_disabled" } });
    expect(ev.at(-1)).toMatchObject({ action: "access.reset", details: { userId: 3, result: "ok", mail: "mail_disabled" } });
    expect(JSON.stringify(ev)).not.toContain("admin@skibox.es");
  });

  it("los rechazos del Core también quedan en el historial y llegan con su código", async () => {
    const ev: Array<{ action: string; details: Record<string, unknown> }> = [];
    const r = await post(make(client, ev), "/cp/v1/tenants/t5-skibox/access/users/1/deactivate", {}, { reason: "Baja solicitada por el cliente" });
    expect(r).toMatchObject({ status: 409, body: { error: "owner_protected" } });
    expect(ev.at(-1)).toMatchObject({ action: "access.deactivate", details: { result: "owner_protected" } });
  });

  it("sin permiso de escritura no se ejecuta nada y una acción desconocida no existe", async () => {
    const n = calls.length;
    expect((await post(make(client, [], false), "/cp/v1/tenants/t5-skibox/access/users/1/unlock", {}, { reason: "Desbloqueo pedido" })).status).toBe(403);
    expect((await post(make(client, []), "/cp/v1/tenants/t5-skibox/access/users/1/password", {}, { reason: "Fijar contraseña" })).status).toBe(400);
    expect(calls.length).toBe(n);
  });
});
