/**
 * Política de acceso de la pasarela del Core (igual que la web y el CRM): en production, públicos solo los dominios
 * propios (PUBLIC_HOSTS) y con contraseña los técnicos de Railway; en live, sin autenticación básica (recorridos como
 * en production). Los canales internos /_ops siguen cerrados en todos los entornos.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const caddy = fs.readFileSync(path.resolve(__dirname, "../deploy/railway/gateway/Caddyfile"), "utf8").replace(/\r\n/g, "\n");

describe("pasarela del Core: política de acceso público", () => {
  it("la autenticación básica no se aplica en live ni en los dominios propios; sí en los técnicos de production", () => {
    const block = caddy.slice(caddy.indexOf("@protected {"), caddy.indexOf("basic_auth @protected"));
    expect(block).toContain("not host {$PUBLIC_HOSTS:public-hosts.invalid}");
    expect(block).toContain('not expression `"{$RAILWAY_ENVIRONMENT_NAME:}" == "live"`');
    // Nada más se exime: ni rutas ni comodines nuevos
    expect(block.split("\n").filter((l) => l.trim().startsWith("not ")).length).toBe(3);
  });
  it("los canales internos se cierran antes, en todos los entornos, y nada se indexa", () => {
    expect(caddy.indexOf("handle @internal")).toBeLessThan(caddy.indexOf("@protected {"));
    expect(caddy).toMatch(/@internal path \/_ops \/_ops\/\*\n\s*handle @internal \{\n\s*respond 404/);
    expect(caddy).toContain('X-Robots-Tag "noindex, nofollow"');
  });
});
