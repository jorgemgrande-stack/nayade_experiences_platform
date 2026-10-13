/**
 * Operaciones de envío del inbox GHL (S8, parte 2): validación, propiedad de la
 * conversación, límites por usuario, auditoría sin datos personales, errores genéricos
 * y salvaguarda del purgado en la sincronización.
 *
 * BD y fetch simulados: no se contacta con GHL ni se envía ningún WhatsApp.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";

const state = vi.hoisted(() => ({
  conversationRows: [] as any[],
  localConversations: [] as any[],
  executed: [] as string[],
  fetchCalls: [] as Array<{ url: string; body: any }>,
  fetchPlan: [] as Array<{ ok: boolean; status: number; json?: any; text?: string }>,
  logs: [] as string[],
}));

vi.mock("mysql2/promise", () => {
  const pool = {
    execute: async (sql: string) => {
      state.executed.push(sql);
      if (/SELECT ghlContactId FROM ghl_conversations/i.test(sql)) return [state.conversationRows];
      if (/SELECT ghlConversationId FROM ghl_conversations/i.test(sql)) return [state.localConversations];
      return [[]];
    },
  };
  return { default: { createPool: () => pool }, createPool: () => pool };
});

vi.mock("drizzle-orm/mysql2", () => ({
  drizzle: () => ({
    insert: () => ({
      values: () =>
        Object.assign(Promise.resolve([{ insertId: 1 }]), { onDuplicateKeyUpdate: () => Promise.resolve([{}]) }),
    }),
    update: () => ({ set: () => ({ where: () => Promise.resolve([{}]) }) }),
  }),
}));

vi.mock("./localAuth", () => ({
  getUserFromRequest: async (req: { headers: { cookie?: string } }) => {
    const m = /(?:^|;\s*)nayade_session=([^;]*)/.exec(req.headers.cookie ?? "");
    if (!m) return null;
    const users: Record<string, object> = {
      admin: { id: 1, role: "admin", isActive: true },
      agente: { id: 2, role: "agente", isActive: true },
      agente3: { id: 3, role: "agente", isActive: true },
      agente4: { id: 4, role: "agente", isActive: true },
      agente5: { id: 5, role: "agente", isActive: true },
    };
    return users[decodeURIComponent(m[1])] ?? null;
  },
}));
vi.mock("./_core/sdk", () => ({ sdk: { authenticateRequest: async () => null } }));
vi.mock("./_core/rbac", () => ({
  checkRbacOrLegacy: async (_i: number, role: string, key: string) => key === "crm.view" && ["admin", "agente"].includes(role),
  getUserPermissions: async () => [],
}));

import ghlInboxRouter from "./routes/ghlInboxRouter";

let server: http.Server;
let port: number;

function call(method: string, path: string, cookie: string | undefined, body?: unknown) {
  return new Promise<{ status: number; body: string; json: any }>((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        method,
        path,
        headers: {
          ...(cookie ? { cookie: `nayade_session=${cookie}` } : {}),
          ...(payload ? { "content-type": "application/json", "content-length": Buffer.byteLength(payload) } : {}),
        },
      },
      (res) => {
        let b = "";
        res.on("data", (c) => (b += c));
        res.on("end", () => {
          let json: any;
          try {
            json = JSON.parse(b);
          } catch {
            json = undefined;
          }
          resolve({ status: res.statusCode ?? 0, body: b, json });
        });
      },
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

const okJson = (json: any) => ({ ok: true, status: 200, json });

beforeAll(async () => {
  process.env.LOCAL_AUTH = "true";
  process.env.GHL_PRIVATE_INTEGRATION_TOKEN = "ficticio-token-de-pruebas";
  process.env.GHL_LOCATION_ID = "loc-ficticia";
  vi.stubGlobal("fetch", async (url: string, init?: { body?: string }) => {
    state.fetchCalls.push({ url: String(url), body: init?.body ? JSON.parse(init.body) : undefined });
    const next = state.fetchPlan.shift() ?? { ok: true, status: 200, json: {} };
    return {
      ok: next.ok,
      status: next.status,
      json: async () => next.json ?? {},
      text: async () => next.text ?? "",
    };
  });
  const logSpy = (...a: unknown[]) => state.logs.push(a.map(String).join(" "));
  vi.spyOn(console, "log").mockImplementation(logSpy);
  vi.spyOn(console, "warn").mockImplementation(logSpy);
  vi.spyOn(console, "error").mockImplementation(logSpy);
  const app = express();
  app.use(ghlInboxRouter);
  await new Promise<void>((r) => {
    server = app.listen(0, "127.0.0.1", () => r());
  });
  port = (server.address() as AddressInfo).port;
});
afterAll(async () => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  await new Promise<void>((r) => server.close(() => r()));
});
beforeEach(() => {
  state.conversationRows = [];
  state.localConversations = [];
  state.executed.length = 0;
  state.fetchCalls.length = 0;
  state.fetchPlan.length = 0;
  state.logs.length = 0;
});

describe("reply", () => {
  const path = "/api/ghl/conversations/CONV12345/reply";

  it("identificador de conversación no válido → 400 y sin llamadas externas", async () => {
    const r = await call("POST", "/api/ghl/conversations/..%2Fetc/reply", "agente", { message: "hola" });
    expect(r.status).toBe(400);
    expect(state.fetchCalls).toHaveLength(0);
  });

  it("mensaje vacío o ausente → 400", async () => {
    expect((await call("POST", path, "agente", { message: "   " })).status).toBe(400);
    expect((await call("POST", path, "agente", {})).status).toBe(400);
    expect((await call("POST", path, "agente", { message: 123 })).status).toBe(400);
    expect(state.fetchCalls).toHaveLength(0);
  });

  it("mensaje demasiado largo → 400", async () => {
    const r = await call("POST", path, "agente", { message: "a".repeat(4097) });
    expect(r.status).toBe(400);
    expect(state.fetchCalls).toHaveLength(0);
  });

  it("conversación que no existe en el inbox local → 404 y NO se llama a GHL", async () => {
    state.conversationRows = [];
    const r = await call("POST", path, "agente", { message: "hola" });
    expect(r.status).toBe(404);
    expect(state.fetchCalls).toHaveLength(0);
  });

  it("conversación existente → se envía y se conserva la forma de respuesta", async () => {
    state.conversationRows = [{ ghlContactId: "contact-1" }];
    state.fetchPlan.push(okJson({ messageId: "msg-1", conversationId: "CONV12345" }));
    const r = await call("POST", path, "agente", { message: "Hola, prueba" });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ ok: true, messageId: "msg-1" });
    expect(state.fetchCalls).toHaveLength(1);
    expect(state.fetchCalls[0].url).toContain("/conversations/messages");
    expect(state.fetchCalls[0].body).toMatchObject({ conversationId: "CONV12345", message: "Hola, prueba" });
  });

  it("el error de GHL no llega al cliente", async () => {
    state.conversationRows = [{ ghlContactId: "contact-1" }];
    state.fetchPlan.push({ ok: false, status: 403, text: "DETALLE_INTERNO_DE_GHL_NO_MOSTRAR" });
    const r = await call("POST", path, "agente", { message: "Hola" });
    expect(r.body).not.toContain("DETALLE_INTERNO_DE_GHL_NO_MOSTRAR");
    expect(r.json.ok).toBe(false);
  });

  it("la auditoría registra usuario y longitud, nunca el mensaje", async () => {
    state.conversationRows = [{ ghlContactId: "contact-1" }];
    state.fetchPlan.push(okJson({ messageId: "msg-2" }));
    await call("POST", path, "agente", { message: "TEXTO_CONFIDENCIAL_DEL_MENSAJE" });
    const audit = state.logs.find((l) => l.includes('"msg":"audit"') && l.includes('"op":"reply"'));
    expect(audit).toBeTruthy();
    expect(audit).toContain('"userId":2');
    expect(audit).toContain('"chars":30');
    expect(state.logs.join("\n")).not.toContain("TEXTO_CONFIDENCIAL_DEL_MENSAJE");
  });
});

describe("conversations/new", () => {
  const path = "/api/ghl/conversations/new";

  it("teléfono ausente o con formato no válido → 400", async () => {
    expect((await call("POST", path, "agente3", {})).status).toBe(400);
    expect((await call("POST", path, "agente3", { phone: "abc; DROP TABLE" })).status).toBe(400);
    expect(state.fetchCalls).toHaveLength(0);
  });

  it("plantilla, nombre y mensaje no válidos → 400", async () => {
    expect((await call("POST", path, "agente3", { phone: "+34600000000", templateId: "../x" })).status).toBe(400);
    expect((await call("POST", path, "agente3", { phone: "+34600000000", contactName: "n".repeat(121) })).status).toBe(400);
    expect((await call("POST", path, "agente3", { phone: "+34600000000", message: "m".repeat(4097) })).status).toBe(400);
    expect(state.fetchCalls).toHaveLength(0);
  });

  it("acepta los formatos de teléfono habituales de la ficha de cliente", async () => {
    for (const phone of ["+34 600 00 00 00", "600000000", "(+34) 600-000-000"]) {
      state.fetchPlan.length = 0;
      state.fetchPlan.push(
        okJson({ contact: { id: "c1" } }),
        okJson({ conversation: { id: "CONV99999" } }),
      );
      const r = await call("POST", path, "agente4", { phone, contactName: "Persona" });
      expect(r.status, phone).toBe(200);
      expect(r.json.ok, phone).toBe(true);
    }
  });

  it("los errores de GHL no llegan al cliente", async () => {
    state.fetchPlan.push({ ok: true, status: 200, json: {} }); // búsqueda sin contacto
    state.fetchPlan.push({ ok: false, status: 422, text: "DETALLE_INTERNO_CONTACTO" });
    const r = await call("POST", path, "agente4", { phone: "+34600000001", contactName: "Persona" });
    expect(r.body).not.toContain("DETALLE_INTERNO_CONTACTO");
    expect(r.json.ok).toBe(false);
  });
});

describe("límites por usuario", () => {
  it("supera el límite de conversaciones nuevas → 429; otro usuario no se ve afectado", async () => {
    const path = "/api/ghl/conversations/new";
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) {
      statuses.push((await call("POST", path, "agente5", { phone: "no-valido" })).status);
    }
    expect(statuses.slice(0, 10).every((s) => s === 400)).toBe(true);
    expect(statuses.slice(10).every((s) => s === 429)).toBe(true);

    const other = await call("POST", path, "admin", { phone: "no-valido" });
    expect(other.status).toBe(400);
  });
});

describe("sync", () => {
  it("una respuesta vacía de GHL NO purga las conversaciones locales", async () => {
    state.localConversations = [{ ghlConversationId: "LOCAL1" }, { ghlConversationId: "LOCAL2" }];
    state.fetchPlan.push(okJson({ conversations: [] }));
    const r = await call("POST", "/api/ghl/inbox/sync", "admin", {});
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ ok: true, purged: 0 });
    expect(state.executed.some((q) => /DELETE FROM ghl_conversations/i.test(q))).toBe(false);
  });

  it("con resultados, conserva el comportamiento de purgado de las ausentes", async () => {
    state.localConversations = [{ ghlConversationId: "OLD1" }];
    state.fetchPlan.push(okJson({ conversations: [{ id: "NEW1", contactId: "c", lastMessageBody: "x" }] }));
    const r = await call("POST", "/api/ghl/inbox/sync", "admin", {});
    expect(r.json).toMatchObject({ ok: true, purged: 1 });
    expect(state.executed.some((q) => /DELETE FROM ghl_conversations/i.test(q))).toBe(true);
  });

  it("el error de GHL no llega al cliente", async () => {
    state.fetchPlan.push({ ok: false, status: 500, text: "DETALLE_INTERNO_SYNC" });
    const r = await call("POST", "/api/ghl/inbox/sync", "admin", {});
    expect(r.body).not.toContain("DETALLE_INTERNO_SYNC");
    expect(r.json.ok).toBe(false);
  });
});
