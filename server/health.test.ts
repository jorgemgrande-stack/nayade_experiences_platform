/**
 * Endpoints de salud: /healthz (liveness) y /readyz (readiness con comprobación de BD).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { createHealthRouter } from "./_core/health";

function serve(router: express.Router) {
  const app = express();
  app.use(router);
  return new Promise<{ server: http.Server; port: number }>((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => resolve({ server, port: (server.address() as AddressInfo).port }));
  });
}

function get(port: number, path: string) {
  return new Promise<{ status: number; body: any; headers: http.IncomingHttpHeaders }>((resolve, reject) => {
    http
      .get({ host: "127.0.0.1", port, path }, (res) => {
        let b = "";
        res.on("data", (c) => (b += c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: JSON.parse(b), headers: res.headers }));
      })
      .on("error", reject);
  });
}

describe("/healthz", () => {
  let s: { server: http.Server; port: number };
  beforeAll(async () => {
    // El ping fallaría: /healthz no debe depender de él
    s = await serve(createHealthRouter({ ping: async () => { throw new Error("BD caída"); } }));
  });
  afterAll(() => new Promise<void>((r) => s.server.close(() => r())));

  it("responde 200 aunque la base de datos esté caída", async () => {
    const r = await get(s.port, "/healthz");
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ status: "ok" });
    expect(r.headers["cache-control"]).toBe("no-store");
  });
});

describe("/readyz", () => {
  it("200 cuando la base de datos responde", async () => {
    const s = await serve(createHealthRouter({ ping: async () => undefined }));
    const r = await get(s.port, "/readyz");
    await new Promise<void>((res) => s.server.close(() => res()));
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ status: "ready", checks: { database: "ok" } });
  });

  it("503 cuando la base de datos falla, sin filtrar el mensaje de error", async () => {
    const s = await serve(
      createHealthRouter({ ping: async () => { throw new Error("ER_ACCESS_DENIED mysql://user:pass@host"); } }),
    );
    const r = await get(s.port, "/readyz");
    await new Promise<void>((res) => s.server.close(() => res()));
    expect(r.status).toBe(503);
    expect(r.body).toEqual({ status: "degraded", checks: { database: "error" } });
    expect(JSON.stringify(r.body)).not.toMatch(/ER_ACCESS|mysql:|pass|host/);
  });

  it("503 si la base de datos no responde dentro del tiempo máximo", async () => {
    const s = await serve(
      createHealthRouter({ ping: () => new Promise<void>(() => {}), timeoutMs: 100 }),
    );
    const t0 = Date.now();
    const r = await get(s.port, "/readyz");
    await new Promise<void>((res) => s.server.close(() => res()));
    expect(r.status).toBe(503);
    expect(Date.now() - t0).toBeLessThan(2000);
  });
});
