/**
 * Identidad corporativa única en la experiencia del cliente: tokens de color por empresa (Big Elephant hasta que
 * configure los suyos, con contraste protegido), página de estado con identidad para navegadores y sin datos de la
 * empresa, y las pantallas de acceso con el mismo armazón.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { BIG_ELEPHANT, NEUTRAL_INK, brandTokens, contrastRatio } from "../shared/loginBrand";
import { statusPageHtml, wantsHtml } from "./_core/tenantRegistry/statusPage";
import { resolveTenantMiddleware } from "./_core/tenantRegistry/tenantMiddleware";
import { accessPolicy } from "./_core/tenantRegistry/lifecycle";

describe("tokens de marca por empresa", () => {
  it("instalación de una sola empresa (Náyade): nada cambia", () => {
    expect(brandTokens({ neutralSite: false, primaryColor: "#123456" })).toBeNull();
    expect(brandTokens(null)).toBeNull();
  });
  it("empresa sin marca: identidad Big Elephant (rojo corporativo), también para el acento y la barra lateral", () => {
    const t = brandTokens({ neutralSite: true })!;
    expect(t["--primary"]).toBe(BIG_ELEPHANT.redInk);
    expect(t["--accent"]).toBe(BIG_ELEPHANT.red);
    expect(t["--sidebar-primary"]).toBe(BIG_ELEPHANT.redInk);
    expect(t["--primary-foreground"]).toBe("#ffffff");
    // Nunca el azul ni el naranja heredados
    expect(Object.values(t).join(" ")).not.toMatch(/oklch|#f5a623|#2563eb/i);
  });
  it("empresa con su color: el suyo, si se lee; si no, el grafito neutro", () => {
    expect(brandTokens({ neutralSite: true, primaryColor: "#0b5d3b" })!["--primary"]).toBe("#0b5d3b");
    const pale = brandTokens({ neutralSite: true, primaryColor: "#fff3a0" })!;
    expect(pale["--primary"]).toBe(NEUTRAL_INK);
    expect(contrastRatio(pale["--primary"], pale["--primary-foreground"])!).toBeGreaterThanOrEqual(4.5);
    // Acento propio ilegible: se usa el principal
    expect(brandTokens({ neutralSite: true, primaryColor: "#0b5d3b", accentColor: "#ffffe0" })!["--accent"]).toBe("#0b5d3b");
  });
});

describe("página de estado", () => {
  it("con identidad de Big Elephant, sin datos de la empresa, y enlace al panel solo si la política lo permite", () => {
    const html = statusPageHtml(503, { adminLink: true });
    expect(html).toContain(BIG_ELEPHANT.logoUrl);
    expect(html).toContain("Servicio no disponible temporalmente");
    expect(html).toContain('href="/login"');
    expect(statusPageHtml(410)).not.toContain('href="/login"');
    expect(wantsHtml("text/html,application/xhtml+xml")).toBe(true);
    expect(wantsHtml("application/json")).toBe(false);
  });

  it("de punta a punta: el navegador recibe la página; la API, el texto de siempre", async () => {
    const resolver = { resolveHost: async () => ({ kind: "resolved", tenant: { tenantId: "acme", status: "suspended", registryVersion: 1, policy: accessPolicy("suspended"), domain: "acme.example", domainKind: "platform_subdomain" } }) } as never;
    const app = express();
    app.use(resolveTenantMiddleware(resolver));
    app.use((_req, res) => void res.send("ok"));
    const server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as AddressInfo).port;
    const get = (p: string, accept: string) =>
      new Promise<{ status: number; type: string; body: string }>((resolve, reject) => {
        const req = http.request({ host: "127.0.0.1", port, path: p, headers: { host: "acme.example", accept } }, (res) => {
          let b = "";
          res.on("data", (c) => (b += c));
          res.on("end", () => resolve({ status: res.statusCode ?? 0, type: String(res.headers["content-type"]), body: b }));
        });
        req.on("error", reject);
        req.end();
      });
    try {
      const page = await get("/", "text/html");
      expect(page.status).toBe(503);
      expect(page.type).toMatch(/text\/html/);
      expect(page.body).toContain("Entrar en el panel");
      expect(page.body).not.toContain("acme");
      const plain = await get("/", "application/json");
      expect(plain).toMatchObject({ status: 503, body: "Service unavailable" });
    } finally {
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
    }
  });
});

describe("pantallas del recorrido del cliente", () => {
  const read = (p: string) => fs.readFileSync(path.resolve(__dirname, "..", p), "utf8");
  it("acceso, recuperación, nueva contraseña y establecer contraseña usan el mismo armazón; sin azules ni naranjas fijos", () => {
    for (const f of ["client/src/pages/Login.tsx", "client/src/pages/ForgotPassword.tsx", "client/src/pages/ResetPassword.tsx", "client/src/pages/SetPassword.tsx"]) {
      const src = read(f);
      expect(src, f).toMatch(/<AuthShell/);
      expect(src, f).not.toMatch(/(bg|from|to|via|text|border)-(blue|orange)-\d/);
    }
  });
  it("sin sesión en el panel no hay una pantalla intermedia con otro aspecto", () => {
    for (const f of ["client/src/pages/admin/AdminDashboard.tsx", "client/src/components/AdminLayout.tsx"]) {
      const src = read(f);
      expect(src, f).toContain("<AuthRequired");
      expect(src, f).not.toContain("Acceso Restringido");
    }
    expect(read("client/src/App.tsx")).not.toMatch(/border-orange-500|bg-\[#080e1c\]/);
  });
  it("establecer contraseña entra directamente en el panel por el inicio de sesión normal", () => {
    const src = read("client/src/pages/SetPassword.tsx");
    expect(src).toContain('fetch("/api/auth/login"');
    expect(src).not.toContain('setLocation("/admin")');
  });
});
