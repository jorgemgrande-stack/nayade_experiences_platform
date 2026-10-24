/**
 * Empresa suspendida: sin web pública, pero con su panel accesible (política del ciclo de vida). Comprobado en live el
 * 25/10/2026: el panel no cargaba porque sus ficheros (`/assets/…`) y las pantallas de acceso respondían 503.
 */
import { describe, it, expect } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { isOperatorPath, resolveTenantMiddleware } from "./_core/tenantRegistry/tenantMiddleware";
import { accessPolicy } from "./_core/tenantRegistry/lifecycle";

describe("rutas disponibles con la web pública cerrada", () => {
  it("panel, API, ficheros de la aplicación y pantallas de acceso, sí; la web pública, no", () => {
    for (const p of ["/admin", "/admin/crm", "/api/trpc/auth.me", "/assets/index-abc.js", "/assets/x.css", "/login", "/recuperar-contrasena", "/nueva-contrasena", "/establecer-contrasena", "/favicon.ico"]) expect(isOperatorPath(p), p).toBe(true);
    for (const p of ["/", "/experiencias", "/hotel/suite", "/login-falso", "/adminx", "/assetsx/a.js", "/pagina/contacto"]) expect(isOperatorPath(p), p).toBe(false);
  });

  it("de punta a punta: suspendida sirve el panel y bloquea la web; las escrituras de negocio siguen bloqueadas", async () => {
    const policy = accessPolicy("suspended");
    const resolver = { resolveHost: async () => ({ kind: "resolved", tenant: { tenantId: "acme", status: "suspended", registryVersion: 1, policy, domain: "acme.example", domainKind: "platform_subdomain" } }) } as never;
    const app = express();
    app.use(resolveTenantMiddleware(resolver));
    app.use((_req, res) => void res.status(200).send("ok"));
    const server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as AddressInfo).port;
    const st = (method: string, p: string) =>
      new Promise<number>((resolve, reject) => {
        const req = http.request({ host: "127.0.0.1", port, path: p, method, headers: { host: "acme.example" } }, (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        });
        req.on("error", reject);
        req.end();
      });
    try {
      expect(await st("GET", "/assets/index-abc.js")).toBe(200);
      expect(await st("GET", "/login")).toBe(200);
      expect(await st("GET", "/admin")).toBe(200);
      expect(await st("GET", "/")).toBe(503);
      expect(await st("GET", "/experiencias")).toBe(503);
      // Iniciar sesión sí; una escritura de negocio no
      expect(await st("POST", "/api/auth/login")).toBe(200);
      expect(await st("POST", "/api/trpc/crm.clients.create")).toBe(403);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
    }
  });
});
