/**
 * Sesión, cookies y endpoints públicos (01A-07):
 *  - un usuario desactivado pierde el acceso aunque su JWT siga vigente,
 *  - una cookie mal codificada no tumba la petición,
 *  - los formularios públicos están realmente limitados (nombres reales de procedimiento),
 *  - la subida pública de cupones deriva la extensión del tipo MIME,
 *  - el almacenamiento local no sirve HTML/SVG como contenido ejecutable.
 */
import { describe, it, expect, beforeEach, beforeAll, afterAll, vi } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";

const state = vi.hoisted(() => ({
  userRow: null as any,
  storedKeys: [] as string[],
}));

vi.mock("./db", async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    getDb: async () => ({
      select: () => ({
        from: () => ({ where: () => ({ limit: async () => (state.userRow ? [state.userRow] : []) }) }),
      }),
    }),
    createMediaFile: async () => ({}),
  };
});

vi.mock("./storage", () => ({
  storagePut: async (key: string) => {
    state.storedKeys.push(key);
    return { url: `https://cdn.invalid/${key}`, key };
  },
}));

import { signSessionToken, getUserFromRequest } from "./localAuth";
import { createAuthGuardMiddleware } from "./authGuard";
import { isLeadProcedurePath, localStorageSecurityHeaders } from "./_core/publicEndpointGuards";
import uploadRouter from "./uploadRoutes";

const req = (cookie?: string) => ({ headers: cookie ? { cookie } : {} }) as any;

describe("getUserFromRequest", () => {
  beforeEach(() => {
    state.userRow = { id: 5, role: "agente", isActive: true, name: "Persona" };
  });

  it("usuario activo con sesión válida → devuelto", async () => {
    const token = await signSessionToken(5);
    const u = await getUserFromRequest(req(`nayade_session=${token}`));
    expect(u).toMatchObject({ id: 5 });
  });

  it("usuario desactivado con JWT vigente → null", async () => {
    state.userRow = { id: 5, role: "agente", isActive: false };
    const token = await signSessionToken(5);
    expect(await getUserFromRequest(req(`nayade_session=${token}`))).toBeNull();
  });

  it("cookie mal codificada → null, sin lanzar", async () => {
    await expect(getUserFromRequest(req("nayade_session=%E0%A4%A"))).resolves.toBeNull();
    await expect(getUserFromRequest(req("otra=%; nayade_session=%"))).resolves.toBeNull();
  });

  it("sin cookie → null", async () => {
    expect(await getUserFromRequest(req())).toBeNull();
  });

  it("una cookie ajena mal codificada no impide leer la de sesión", async () => {
    const token = await signSessionToken(5);
    const u = await getUserFromRequest(req(`_ga=%; nayade_session=${token}`));
    expect(u).toMatchObject({ id: 5 });
  });
});

describe("authGuard con cookie mal codificada", () => {
  it("responde 401 (no lanza) en una ruta protegida", async () => {
    const guard = createAuthGuardMiddleware(true);
    const res: any = { statusCode: 200, status(c: number) { this.statusCode = c; return this; }, json() { return this; } };
    const next = vi.fn();
    await expect(
      guard({ url: "/api/trpc/crm.leads.list", headers: { cookie: "nayade_session=%" } } as any, res, next),
    ).resolves.toBeUndefined();
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });
});

describe("limitación de formularios públicos", () => {
  it("detecta los nombres reales de procedimiento, sueltos o en lote", () => {
    expect(isLeadProcedurePath("/public.submitLead")).toBe(true);
    expect(isLeadProcedurePath("/public.submitBudget")).toBe(true);
    expect(isLeadProcedurePath("/public.submitColegiosLead")).toBe(true);
    expect(isLeadProcedurePath("/auth.me,public.submitLead")).toBe(true);
    expect(isLeadProcedurePath("/public.submitLead,auth.me")).toBe(true);
  });
  it("no afecta a otros procedimientos", () => {
    expect(isLeadProcedurePath("/auth.me")).toBe(false);
    expect(isLeadProcedurePath("/public.getExperiences")).toBe(false);
    expect(isLeadProcedurePath("/submitLead")).toBe(false); // el nombre antiguo (inexistente)
    expect(isLeadProcedurePath("/public.submitLeadExtra")).toBe(false);
  });
});

describe("almacenamiento local", () => {
  function run(path: string) {
    const headers: Record<string, string> = {};
    const res: any = { setHeader: (k: string, v: string) => (headers[k.toLowerCase()] = v) };
    const next = vi.fn();
    localStorageSecurityHeaders({ path } as any, res, next);
    expect(next).toHaveBeenCalled();
    return headers;
  }
  it("nosniff siempre; descarga forzada para html, svg y xml", () => {
    expect(run("/x/foto.png")["x-content-type-options"]).toBe("nosniff");
    expect(run("/x/foto.png")["content-disposition"]).toBeUndefined();
    for (const p of ["/a.html", "/a.HTM", "/a.svg", "/a.xml", "/a.xhtml"]) {
      expect(run(p)["content-disposition"], p).toBe("attachment");
    }
  });
});

describe("POST /api/upload-coupon", () => {
  let server: http.Server;
  let port: number;
  beforeAll(async () => {
    const app = express();
    app.use(uploadRouter);
    await new Promise<void>((r) => (server = app.listen(0, "127.0.0.1", () => r())));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(async () => {
    await new Promise<void>((r) => server.close(() => r()));
  });

  function upload(filename: string, mimetype: string) {
    const boundary = "----pruebas" + Math.random().toString(16).slice(2);
    const body = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mimetype}\r\n\r\n`,
      ),
      Buffer.from("contenido-de-prueba"),
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    return new Promise<{ status: number; json: any }>((resolve, reject) => {
      const r = http.request(
        {
          host: "127.0.0.1",
          port,
          method: "POST",
          path: "/api/upload-coupon",
          headers: { "content-type": `multipart/form-data; boundary=${boundary}`, "content-length": body.length },
        },
        (res) => {
          let b = "";
          res.on("data", (c) => (b += c));
          res.on("end", () => resolve({ status: res.statusCode ?? 0, json: JSON.parse(b || "{}") }));
        },
      );
      r.on("error", reject);
      r.end(body);
    });
  }

  beforeEach(() => {
    state.storedKeys.length = 0;
  });

  it("la extensión sale del tipo MIME, no del nombre enviado", async () => {
    const r = await upload("evil.html", "image/png");
    expect(r.status).toBe(200);
    expect(state.storedKeys).toHaveLength(1);
    expect(state.storedKeys[0]).toMatch(/\.png$/);
    expect(state.storedKeys[0]).not.toMatch(/html/i);
  });

  it("PDF conserva la extensión .pdf", async () => {
    await upload("recibo.PDF.exe", "application/pdf");
    expect(state.storedKeys[0]).toMatch(/\.pdf$/);
  });

  it("tipos no permitidos se rechazan", async () => {
    const r = await upload("x.html", "text/html");
    expect(r.status).toBe(400);
    expect(state.storedKeys).toHaveLength(0);
  });
});
