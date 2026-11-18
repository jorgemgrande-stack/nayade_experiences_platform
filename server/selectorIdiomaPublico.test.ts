/**
 * El selector de idioma de la cabecera lo pintan visitantes sin sesión: las dos consultas que lo alimentan tienen
 * que estar en la lista de rutas tRPC públicas de la pasarela de autenticación; si no, responden 401, el cliente
 * toma la web por monolingüe y el selector no aparece (solo lo ve quien tiene sesión).
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const guard = fs.readFileSync(path.join(__dirname, "authGuard.ts"), "utf8");
const routers = fs.readFileSync(path.join(__dirname, "routers.ts"), "utf8");
const publicRoutes = new Set(Array.from(guard.matchAll(/"([a-zA-Z]+\.[a-zA-Z]+)"/g)).map((m) => m[1]));

describe("selector de idioma para visitantes", () => {
  it("las consultas del selector son rutas públicas", () => {
    expect(publicRoutes.has("public.getSiteLocales")).toBe(true);
    expect(publicRoutes.has("public.getPageAlternates")).toBe(true);
  });

  it("son procedimientos públicos del router (no protegidos)", () => {
    expect(routers).toMatch(/getSiteLocales: publicProcedure/);
    expect(routers).toMatch(/getPageAlternates: publicProcedure/);
  });

  it("las consultas públicas que usa el cliente del selector no se quedan fuera de la lista", () => {
    const client = fs.readFileSync(path.join(__dirname, "..", "client/src/components/LanguageSwitcher.tsx"), "utf8") + fs.readFileSync(path.join(__dirname, "..", "client/src/hooks/useSiteLocale.ts"), "utf8");
    const used = Array.from(client.matchAll(/trpc\.(public\.[a-zA-Z]+)\.use/g)).map((m) => m[1]);
    expect(used.length).toBeGreaterThan(1);
    for (const r of used) expect(publicRoutes.has(r), r).toBe(true);
  });
});
