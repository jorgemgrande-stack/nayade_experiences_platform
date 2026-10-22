/**
 * Seguridad de /api/ghl/* (S8): sesión obligatoria salvo webhooks, SSE sin token en URL,
 * webhook con secreto en tiempo constante y fail-closed.
 *
 * BD y fetch simulados: ninguna prueba contacta con GHL ni envía WhatsApp.
 * Los valores "secretos" son marcadores ficticios.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";

// El router usa el pool compartido del registro: necesita una DATABASE_URL (el driver está simulado)
vi.hoisted(() => {
  process.env.DATABASE_URL ||= "mysql://test:test@127.0.0.1:3306/test";
});

const state = vi.hoisted(() => ({
  inserts: [] as unknown[],
  fetchCalls: 0,
}));

vi.mock("mysql2/promise", () => {
  const pool = { execute: async () => [[]] };
  return { default: { createPool: () => pool }, createPool: () => pool };
});

vi.mock("drizzle-orm/mysql2", () => ({
  drizzle: () => ({
    insert: () => ({
      values: (v: unknown) => {
        state.inserts.push(v);
        return Object.assign(Promise.resolve([{ insertId: 1 }]), {
          onDuplicateKeyUpdate: () => Promise.resolve([{}]),
        });
      },
    }),
  }),
}));

// Sesiones simuladas: el valor de la cookie nayade_session decide el usuario.
vi.mock("./localAuth", () => ({
  getUserFromRequest: async (req: { headers: { cookie?: string } }) => {
    const raw = req.headers.cookie ?? "";
    const m = /(?:^|;\s*)nayade_session=([^;]*)/.exec(raw);
    if (!m) return null;
    const value = decodeURIComponent(m[1]); // lanza con "%" como el original
    const users: Record<string, object> = {
      admin: { id: 1, role: "admin", isActive: true },
      agente: { id: 2, role: "agente", isActive: true },
      partner: { id: 3, role: "partner_admin", isActive: true },
      supplier: { id: 4, role: "supplier", isActive: true },
      employee: { id: 5, role: "employee", isActive: true },
      inactive: { id: 6, role: "admin", isActive: false },
    };
    return users[value] ?? null;
  },
}));

vi.mock("./_core/sdk", () => ({ sdk: { authenticateRequest: async () => null } }));

vi.mock("./_core/rbac", () => ({
  checkRbacOrLegacy: async (_id: number, role: string, key: string) =>
    key === "crm.view" && ["admin", "agente"].includes(role),
  getUserPermissions: async () => [],
}));

import ghlInboxRouter from "./routes/ghlInboxRouter";

let server: http.Server;
let port: number;
const WEBHOOK_SECRET = "ficticio-secreto-webhook-para-pruebas";

type Res = { status: number; headers: http.IncomingHttpHeaders; body: string };

function request(
  method: string,
  path: string,
  opts: { cookie?: string; headers?: Record<string, string>; body?: unknown } = {},
): Promise<Res> {
  return new Promise((resolve, reject) => {
    const payload = opts.body === undefined ? undefined : JSON.stringify(opts.body);
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        method,
        path,
        headers: {
          ...(opts.cookie ? { cookie: `nayade_session=${opts.cookie}` } : {}),
          ...(payload ? { "content-type": "application/json", "content-length": Buffer.byteLength(payload) } : {}),
          ...(opts.headers ?? {}),
        },
      },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
      },
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

/** Abre un SSE y devuelve el primer fragmento recibido y una función para cerrarlo. */
function openSse(cookie?: string): Promise<{ status: number; first: string; close: () => void }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        method: "GET",
        path: "/api/ghl/inbox/stream",
        headers: cookie ? { cookie: `nayade_session=${cookie}` } : {},
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status !== 200) {
          let b = "";
          res.on("data", (c) => (b += c));
          res.on("end", () => resolve({ status, first: b, close: () => {} }));
          return;
        }
        res.once("data", (chunk) => {
          resolve({ status, first: String(chunk), close: () => req.destroy() });
        });
      },
    );
    req.on("error", (e) => {
      if ((e as NodeJS.ErrnoException).code !== "ECONNRESET") reject(e);
    });
    req.end();
  });
}

beforeAll(async () => {
  process.env.LOCAL_AUTH = "true";
  vi.stubGlobal("fetch", async () => {
    state.fetchCalls++;
    throw new Error("fetch bloqueado en pruebas: no se debe contactar con servicios externos");
  });
  const app = express();
  app.use(ghlInboxRouter);
  await new Promise<void>((r) => {
    server = app.listen(0, "127.0.0.1", () => r());
  });
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await new Promise<void>((r) => server.close(() => r()));
});

beforeEach(() => {
  state.inserts.length = 0;
  state.fetchCalls = 0;
  process.env.GHL_WEBHOOK_SECRET = WEBHOOK_SECRET;
});

const PROTECTED: Array<[string, string]> = [
  ["GET", "/api/ghl/templates"],
  ["GET", "/api/ghl/inbox/health"],
  ["POST", "/api/ghl/inbox/sync"],
  ["POST", "/api/ghl/conversations/new"],
  ["POST", "/api/ghl/conversations/CONV123/reply"],
  ["GET", "/api/ghl/ruta-inventada-que-no-existe"],
];

describe("rutas protegidas /api/ghl/*", () => {
  for (const [method, path] of PROTECTED) {
    it(`${method} ${path} sin sesión → 401 y sin llamadas externas`, async () => {
      const r = await request(method, path, { body: method === "POST" ? { message: "hola", phone: "+34600000000" } : undefined });
      expect(r.status).toBe(401);
      expect(JSON.parse(r.body)).toMatchObject({ ok: false });
      expect(state.fetchCalls).toBe(0);
      expect(r.headers["cache-control"]).toBe("no-store");
    });
  }

  it("sin sesión, una ruta inexistente también es 401 (denegar por defecto)", async () => {
    const r = await request("DELETE", "/api/ghl/cualquier/cosa");
    expect(r.status).toBe(401);
  });

  for (const role of ["partner", "supplier", "employee"]) {
    it(`rol sin permiso crm.view (${role}) → 403`, async () => {
      for (const [method, path] of PROTECTED.slice(0, 5)) {
        const r = await request(method, path, { cookie: role, body: method === "POST" ? { message: "x" } : undefined });
        expect(r.status, `${method} ${path}`).toBe(403);
      }
      expect(state.fetchCalls).toBe(0);
    });
  }

  it("usuario desactivado → 401", async () => {
    const r = await request("GET", "/api/ghl/templates", { cookie: "inactive" });
    expect(r.status).toBe(401);
  });

  it("cookie malformada → 401 (no tumba el proceso)", async () => {
    const r = await request("GET", "/api/ghl/templates", { cookie: "%" });
    expect(r.status).toBe(401);
  });

  it("sesión desconocida → 401", async () => {
    const r = await request("GET", "/api/ghl/templates", { cookie: "no-existe" });
    expect(r.status).toBe(401);
  });

  for (const role of ["admin", "agente"]) {
    it(`equipo con permiso (${role}) accede y conserva la forma de respuesta`, async () => {
      const r = await request("GET", "/api/ghl/templates", { cookie: role });
      expect(r.status).toBe(200);
      expect(JSON.parse(r.body)).toMatchObject({ ok: false, templates: [] });
      expect(state.fetchCalls).toBe(0);
    });
  }
});

describe("webhook entrante del inbox", () => {
  const payload = { type: "UnknownEventForTests", id: "evt-test-1", locationId: "loc-x" };

  it("secreto correcto por cabecera → aceptado y registrado", async () => {
    const r = await request("POST", "/api/ghl/inbox/webhook", {
      headers: { "x-ghl-secret": WEBHOOK_SECRET },
      body: payload,
    });
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toMatchObject({ ok: true });
    expect(state.inserts.length).toBe(1);
  });

  it("secreto correcto por query (compatibilidad) → aceptado", async () => {
    const r = await request("POST", `/api/ghl/inbox/webhook?secret=${encodeURIComponent(WEBHOOK_SECRET)}`, { body: payload });
    expect(r.status).toBe(200);
    expect(state.inserts.length).toBe(1);
  });

  it("secreto incorrecto → 200 silencioso y NO se procesa", async () => {
    const r = await request("POST", "/api/ghl/inbox/webhook", {
      headers: { "x-ghl-secret": WEBHOOK_SECRET + "x" },
      body: payload,
    });
    expect(r.status).toBe(200);
    expect(state.inserts.length).toBe(0);
  });

  it("sin secreto en la petición → no se procesa", async () => {
    const r = await request("POST", "/api/ghl/inbox/webhook", { body: payload });
    expect(r.status).toBe(200);
    expect(state.inserts.length).toBe(0);
  });

  it("producción sin secreto configurado → fail-closed (no se procesa)", async () => {
    const prev = process.env.NODE_ENV;
    delete process.env.GHL_WEBHOOK_SECRET;
    process.env.NODE_ENV = "production";
    try {
      const r = await request("POST", "/api/ghl/inbox/webhook", { body: payload });
      expect(r.status).toBe(200);
      expect(state.inserts.length).toBe(0);
    } finally {
      process.env.NODE_ENV = prev;
    }
  });

  it("sin secreto configurado → inactivo también fuera de producción", async () => {
    const prev = process.env.GHL_WEBHOOK_SECRET;
    delete process.env.GHL_WEBHOOK_SECRET;
    try {
      const r = await request("POST", "/api/ghl/inbox/webhook", { body: payload });
      expect(r.status).toBe(200);
      expect(state.inserts.length).toBe(0);
    } finally {
      process.env.GHL_WEBHOOK_SECRET = prev;
    }
  });

  for (const [label, weak] of [["demasiado corto", "corto-12345"], ["antiguo valor por defecto publicado", "NAYADE2026_ULTRA"]]) {
    it(`secreto ${label} → inactivo aunque la petición lo envíe`, async () => {
      const prev = process.env.GHL_WEBHOOK_SECRET;
      process.env.GHL_WEBHOOK_SECRET = weak;
      try {
        const r = await request("POST", "/api/ghl/inbox/webhook", { headers: { "x-ghl-secret": weak }, body: payload });
        expect(r.status).toBe(200);
        expect(state.inserts.length).toBe(0);
      } finally {
        process.env.GHL_WEBHOOK_SECRET = prev;
      }
    });
  }

  it("el webhook de leads (/api/ghl/webhook) no queda interceptado por el guard", async () => {
    const r = await request("POST", "/api/ghl/webhook", { body: {} });
    // Este router no define esa ruta (la sirve ghlWebhookRouter): 404, nunca 401/403.
    expect(r.status).toBe(404);
  });
});

describe("SSE /api/ghl/inbox/stream", () => {
  it("sin cookie → 401, aunque se envíe el token histórico en la URL", async () => {
    const r = await request("GET", "/api/ghl/inbox/stream?token=cualquier-valor");
    expect(r.status).toBe(401);
  });

  it("rol sin permiso → 403", async () => {
    const r = await request("GET", "/api/ghl/inbox/stream", { cookie: "partner" });
    expect(r.status).toBe(403);
  });

  it("con sesión del equipo → 200 text/event-stream", async () => {
    const s = await openSse("agente");
    try {
      expect(s.status).toBe(200);
      expect(s.first).toContain("connected");
    } finally {
      s.close();
    }
  });

  it("limita las conexiones simultáneas por usuario y las libera al cerrar", async () => {
    const open: Array<{ close: () => void }> = [];
    try {
      for (let i = 0; i < 10; i++) {
        const s = await openSse("admin");
        expect(s.status).toBe(200);
        open.push(s);
      }
      const over = await openSse("admin");
      expect(over.status).toBe(429);

      // Otro usuario no se ve afectado
      const other = await openSse("agente");
      expect(other.status).toBe(200);
      other.close();

      // Al cerrar una, vuelve a haber hueco
      open.pop()!.close();
      await new Promise((r) => setTimeout(r, 100));
      const again = await openSse("admin");
      expect(again.status).toBe(200);
      open.push(again);
    } finally {
      open.forEach((s) => s.close());
    }
  });

  it("los eventos no contienen datos personales (contrato)", async () => {
    const { ghlInboxEmitter } = await import("./ghlInboxEvents");
    const s = await openSse("admin");
    // El primer fragmento es el "connected"; el contrato lo fija el emisor.
    expect(s.first).not.toMatch(/phone|email|body|customerName|message/i);
    s.close();
    expect(typeof ghlInboxEmitter.emit).toBe("function");
  });
});
