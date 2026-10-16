/**
 * Rutas REST de autenticación (/api/auth/*) con una base de datos sin tablas: responden con un error
 * genérico (503 / 500) y el proceso sigue vivo (sin rechazos no gestionados, que en Node 22 lo tumban).
 * Express real; la BD es un doble que falla como MySQL cuando falta la tabla.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";

vi.mock("./db", () => {
  const fail = () => {
    throw Object.assign(new Error("Table 'empresa.users' doesn't exist"), { code: "ER_NO_SUCH_TABLE", errno: 1146 });
  };
  // Cualquier consulta encadenada (select().from().where().limit()) acaba rechazando
  const chain: any = new Proxy(function () {}, { get: (_t, p) => (p === "then" ? (_ok: unknown, ko: (e: unknown) => void) => { try { fail(); } catch (e) { ko(e); } } : chain), apply: () => chain });
  return { getDb: async () => ({ select: () => chain, update: () => chain, insert: () => chain }) };
});
vi.mock("./mailer", () => ({ sendEmail: vi.fn(async () => true) }));
vi.mock("./emailManager", () => ({ logDirectEmail: vi.fn(async () => undefined) }));

import { createLocalAuthRouter, COOKIE_NAME } from "./localAuth";
import { createPasswordResetRouter } from "./passwordReset";

let server: http.Server;
let port = 0;
const unhandled: unknown[] = [];
const onUnhandled = (e: unknown) => void unhandled.push(e);

const call = (method: string, p: string, body?: unknown, headers: Record<string, string> = {}) =>
  new Promise<{ status: number; text: string }>((resolve, reject) => {
    const data = body === undefined ? undefined : JSON.stringify(body);
    const req = http.request(
      { host: "127.0.0.1", port, path: p, method, headers: { ...headers, ...(data ? { "content-type": "application/json", "content-length": Buffer.byteLength(data) } : {}) } },
      (res) => {
        let b = "";
        res.on("data", (c) => (b += c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, text: b }));
      },
    );
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });

beforeAll(async () => {
  process.on("unhandledRejection", onUnhandled);
  const app = express();
  app.use(express.json());
  app.use(createLocalAuthRouter());
  app.use(createPasswordResetRouter());
  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  port = (server.address() as AddressInfo).port;
});
afterAll(async () => {
  process.off("unhandledRejection", onUnhandled);
  server.closeAllConnections();
  await new Promise<void>((r) => server.close(() => r()));
});

describe("/api/auth/* con la base de datos sin tablas", () => {
  it("login: 503 genérico, sin detalles internos y el servidor sigue respondiendo", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const r = await call("POST", "/api/auth/login", { email: "ana@empresa.example", password: "una-clave-cualquiera" }); // gitleaks:allow
    expect(r.status).toBe(503);
    expect(r.text).not.toMatch(/doesn't exist|ER_NO_SUCH_TABLE|empresa\.users|at \w+ \(/);
    // Sigue vivo: otra petición responde
    expect((await call("POST", "/api/auth/logout")).status).toBe(200);
  });

  it("me con una sesión: 503 genérico (antes, rechazo no gestionado)", async () => {
    process.env.JWT_SECRET ??= "ci-only-placeholder-not-a-secret-000000000000";
    const { SignJWT } = await import("jose");
    const token = await new SignJWT({ userId: 1 }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("1h").sign(new TextEncoder().encode(process.env.JWT_SECRET));
    const r = await call("GET", "/api/auth/me", undefined, { cookie: `${COOKIE_NAME}=${token}` });
    expect([401, 503]).toContain(r.status);
    expect(r.text).not.toMatch(/doesn't exist|ER_NO_SUCH_TABLE/);
  });

  it("recuperación y restablecimiento de contraseña: error genérico, nunca caída", async () => {
    const forgot = await call("POST", "/api/auth/forgot-password", { email: "ana@empresa.example" });
    expect([200, 500, 503]).toContain(forgot.status);
    const reset = await call("POST", "/api/auth/reset-password", { token: "x".repeat(40), password: "otra-clave-larga-1" }); // gitleaks:allow
    expect([400, 500, 503]).toContain(reset.status);
    const valid = await call("GET", "/api/auth/validate-reset-token?token=" + "x".repeat(40));
    expect(valid.status).toBeLessThan(600);
    for (const r of [forgot, reset, valid]) expect(r.text).not.toMatch(/doesn't exist|ER_NO_SUCH_TABLE/);
  });

  it("ningún rechazo sin gestionar", async () => {
    await new Promise((r) => setTimeout(r, 20));
    expect(unhandled).toEqual([]);
  });
});
