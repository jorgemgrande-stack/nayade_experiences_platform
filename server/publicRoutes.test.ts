/**
 * Web pública: 404 real para lo que no existe (sin romper las rutas del cliente) y título de la portada con los
 * datos de la empresa. Las rutas del servidor reflejan exactamente las de client/src/App.tsx.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { CLIENT_ROUTES, PRIVATE_PREFIXES, classifyPublicPath, resolvePublicRoute, type PublicRouteDeps } from "./_core/publicRoutes";

const deps = (over: Partial<PublicRouteDeps> = {}): PublicRouteDeps => ({
  multi: true,
  tenantPage: async (slug) => (slug === "servicios" || slug === "politica-de-privacidad" ? { title: "Servicios", metaTitle: null, metaDescription: "Lo que hacemos" } : null),
  dynamicPageExists: async (slug) => slug === "landing",
  blogLicensed: async () => true,
  blogPostPublished: async (slug) => slug === "publicada",
  moduleAvailable: async (id) => id === "spa",
  ...over,
});

describe("rutas del cliente", () => {
  it("la lista del servidor coincide con las rutas de App.tsx (sin las privadas ni el comodín /:slug)", () => {
    const app = fs.readFileSync(path.join(__dirname, "..", "client", "src", "App.tsx"), "utf8");
    const paths = Array.from(app.matchAll(/<Route path="([^"]+)"/g), (m) => m[1]);
    const isPrivate = (p: string) => PRIVATE_PREFIXES.some((x) => p === x || p.startsWith(`${x}/`));
    const publicPaths = paths.filter((p) => !isPrivate(p) && p !== "/:slug" && p !== "/404");
    expect([...publicPaths].sort()).toEqual([...CLIENT_ROUTES].sort());
  });
});

describe("clasificación", () => {
  it("rutas conocidas, privadas y con parámetros se sirven; lo desconocido es 404", () => {
    for (const p of ["/", "/contacto", "/contacto/", "/experiencias/x", "/restaurantes/a/reservar", "/login", "/admin/lo-que-sea/1", "/empleado"]) {
      expect(classifyPublicPath(p, false).kind, p).toBe("app");
    }
    expect(classifyPublicPath("/no/existe/nada", true).kind).toBe("notFound");
    expect(classifyPublicPath("/assets/falta.js", true).kind).toBe("notFound");
    expect(classifyPublicPath("/404", false).kind).toBe("notFound");
  });

  it("/:slug: página de la empresa en multi; 404 en una sola empresa (como el cliente)", () => {
    expect(classifyPublicPath("/servicios", true)).toEqual({ kind: "tenantPage", slug: "servicios" });
    expect(classifyPublicPath("/servicios", false).kind).toBe("notFound");
    expect(classifyPublicPath("/Mayusculas", true).kind).toBe("notFound");
    expect(classifyPublicPath("/privacidad", true)).toEqual({ kind: "tenantPage", slug: "politica-de-privacidad" });
    expect(classifyPublicPath("/privacidad", false).kind).toBe("app");
  });

  it("secciones sectoriales solo en multi dependen del módulo", () => {
    expect(classifyPublicPath("/hotel/suite", true)).toEqual({ kind: "sector", moduleId: "hotel" });
    expect(classifyPublicPath("/restaurantes", true)).toEqual({ kind: "sector", moduleId: "restaurants" });
    expect(classifyPublicPath("/hotel", false).kind).toBe("app");
  });
});

describe("resolución", () => {
  it("consulta el contenido de la empresa", async () => {
    expect(await resolvePublicRoute("/servicios", deps())).toMatchObject({ status: 200, page: { title: "Servicios" } });
    expect((await resolvePublicRoute("/borrador", deps())).status).toBe(404);
    expect((await resolvePublicRoute("/pagina/landing", deps())).status).toBe(200);
    expect((await resolvePublicRoute("/pagina/otra", deps())).status).toBe(404);
    expect((await resolvePublicRoute("/blog", deps())).status).toBe(200);
    expect((await resolvePublicRoute("/blog/publicada", deps())).status).toBe(200);
    expect((await resolvePublicRoute("/blog/borrador", deps())).status).toBe(404);
    expect((await resolvePublicRoute("/blog", deps({ blogLicensed: async () => false }))).status).toBe(404);
    expect((await resolvePublicRoute("/spa/masaje", deps())).status).toBe(200);
    expect((await resolvePublicRoute("/hotel", deps())).status).toBe(404);
  });

  it("si la comprobación falla se sirve la página (nunca un 404 falso)", async () => {
    const boom = async () => {
      throw new Error("BD caída");
    };
    expect((await resolvePublicRoute("/servicios", deps({ tenantPage: boom }))).status).toBe(200);
  });
});

describe("servidor estático (una sola empresa)", () => {
  let server: http.Server;
  let base = "";
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "web-publica-"));
  const get = (p: string) =>
    new Promise<{ status: number; text: string }>((resolve, reject) => {
      http.get(`${base}${p}`, { headers: { host: "mi-empresa.example" } }, (res) => {
        let b = "";
        res.on("data", (c) => (b += c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, text: b }));
      }).on("error", reject);
    });

  beforeAll(async () => {
    fs.copyFileSync(path.join(__dirname, "..", "client", "index.html"), path.join(dir, "index.html"));
    fs.writeFileSync(path.join(dir, "app.js"), "console.log(1)");
    const { serveStatic } = await import("./_core/vite");
    const app = express();
    serveStatic(app, { distPath: dir, routeDeps: () => deps({ multi: false }) });
    server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }, 120_000);
  afterAll(async () => {
    if (server) await new Promise<void>((r) => server.close(() => r()));
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("la portada pasa por la inyección: título no vacío", async () => {
    const r = await get("/");
    expect(r.status).toBe(200);
    expect(r.text).not.toContain("<title></title>");
    expect(r.text).toMatch(/<title>[^<]+<\/title>/);
    expect(r.text).toContain('<link rel="canonical" href="https://mi-empresa.example"');
  });

  it("rutas conocidas 200; desconocidas 404 con noindex y la misma SPA; ficheros estáticos se sirven", async () => {
    expect((await get("/contacto")).status).toBe(200);
    const nf = await get("/esto-no-existe");
    expect(nf.status).toBe(404);
    expect(nf.text).toContain('<meta name="robots" content="noindex" />');
    expect(nf.text).toContain('<div id="root">');
    expect((await get("/admin/ayuda")).status).toBe(200);
    expect((await get("/app.js")).text).toBe("console.log(1)");
  });
});
