/**
 * Política de acceso de la pasarela del Core (igual que la web y el CRM): en production, públicos los dominios de
 * PUBLIC_HOSTS y los dominios propios ACTIVOS de las empresas (lo decide el registro: GET /_ops/public-host); con
 * contraseña todo lo demás (técnicos de Railway, desconocidos, propios sin activar). En live, sin autenticación básica.
 * Los canales internos /_ops siguen cerrados en todos los entornos.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const caddy = fs.readFileSync(path.resolve(__dirname, "../deploy/railway/gateway/Caddyfile"), "utf8").replace(/\r\n/g, "\n");
const block = (start: string) => {
  const i = caddy.indexOf(start);
  expect(i).toBeGreaterThan(-1);
  let depth = 0;
  for (let j = caddy.indexOf("{", i); j < caddy.length; j++) {
    if (caddy[j] === "{") depth++;
    else if (caddy[j] === "}" && --depth === 0) return caddy.slice(i, j + 1);
  }
  throw new Error(`bloque sin cerrar: ${start}`);
};

describe("pasarela del Core: política de acceso público", () => {
  it("la autenticación básica no se aplica en live ni en PUBLIC_HOSTS; nada más se exime por configuración", () => {
    const m = block("@protected {");
    expect(m).toContain("not host {$PUBLIC_HOSTS:public-hosts.invalid}");
    expect(m).toContain('not expression `"{$RAILWAY_ENVIRONMENT_NAME:}" == "live"`');
    expect(m).toContain("not path /__gateway/health");
    expect(m.split("\n").filter((l) => l.trim().startsWith("not ")).length).toBe(3);
  });

  it("fuera de PUBLIC_HOSTS decide el registro: solo un 2xx del Core exime; cualquier otra respuesta pide la contraseña", () => {
    const r = block("route @protected {");
    expect(r).toContain("reverse_proxy {$UPSTREAM} {");
    expect(r).toContain("method GET");
    expect(r).toContain("rewrite /_ops/public-host");
    // A la consulta solo viajan el host y la ruta: ni credenciales ni cookies
    expect(r).toContain("header_up -Authorization");
    expect(r).toContain("header_up -Cookie");
    expect(r).toContain("header_up X-Forwarded-Uri {uri}");
    expect(r).toContain("@public_domain status 2xx");
    const pub = block("handle_response @public_domain {");
    expect(pub).not.toMatch(/basic_auth|reverse_proxy|respond/);
    const rest = r.slice(r.indexOf(pub) + pub.length);
    const deny = rest.slice(rest.indexOf("handle_response {"));
    expect(deny).toContain("basic_auth {");
    expect(deny).toContain("{$GATEWAY_USER} {$GATEWAY_PASSWORD_HASH}");
    // La decisión va antes que los bloques handle (terminales); ya no hay un basic_auth suelto
    expect(caddy).toMatch(/\n\torder route before handle\n/);
    expect(caddy).not.toContain("basic_auth @protected");
    expect(caddy.match(/basic_auth/g)).toHaveLength(1);
  });

  it("los canales internos se cierran antes, en todos los entornos, y nada se indexa salvo los dominios propios activos", () => {
    expect(caddy.indexOf("handle @internal")).toBeLessThan(caddy.indexOf("@protected {"));
    expect(caddy).toMatch(/@internal path \/_ops \/_ops\/\*\n\s*handle @internal \{\n\s*respond 404/);
    expect(caddy).toContain('header X-Robots-Tag "noindex, nofollow"');
    expect(block("handle_response @public_domain {")).toContain("header -X-Robots-Tag");
  });
});
