/**
 * Excepción de la pasarela para el webhook de Stripe Connect (cobros con la cuenta de cada empresa): la ÚNICA ruta,
 * además de /api/central/*, que el host de entrada deja llegar al Core. Comprobada también con Caddy real y un destino
 * simulado (ver la descripción del PR): POST pasa sin credenciales; GET 405; host de empresa y otras rutas, igual que antes.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const caddy = fs.readFileSync(path.resolve(__dirname, "../deploy/railway/gateway/Caddyfile"), "utf8").replace(/\r\n/g, "\n");
const PATH_ = "/api/stripe/connect/webhook";
const entry = caddy.slice(caddy.indexOf("handle @app_entry"));
const block = (() => {
  const i = entry.indexOf(`handle ${PATH_} {`);
  let depth = 0;
  for (let j = entry.indexOf("{", i); j < entry.length; j++) {
    if (entry[j] === "{") depth++;
    if (entry[j] === "}" && --depth === 0) return entry.slice(i, j + 1);
  }
  return "";
})();

describe("pasarela: webhook de Stripe Connect", () => {
  it("la ruta exacta solo se abre dentro del host de entrada, una vez", () => {
    expect(caddy.split(PATH_).length - 1).toBe(1);
    expect(entry).toContain(`handle ${PATH_} {`);
    expect(entry.indexOf(`handle ${PATH_} {`)).toBeLessThan(entry.indexOf("handle {\n\t\t\troot * /srv/app-entry"));
    // Nada de comodines ni prefijos: ni «/api/stripe/*» ni «/api/*» ni «handle_path»
    expect(caddy).not.toMatch(/handle(_path)?\s+\/api\/stripe\/\*/);
    expect(caddy).not.toMatch(/handle(_path)?\s+\/api\/\*/);
  });

  it("solo POST, cuerpo limitado y sin credenciales hacia el Core", () => {
    expect(block).toMatch(/@not_post not method POST/);
    expect(block).toMatch(/respond @not_post "Method Not Allowed" 405/);
    expect(block).toMatch(/request_body\s*\{\s*max_size 1MB\s*\}/);
    expect(block).toMatch(/header_up -Authorization/);
    expect(block).toMatch(/header_up -Cookie/);
    expect(block).toMatch(/Cache-Control "no-store"/);
  });

  it("no cambia la política de acceso: los hosts protegidos siguen igual y /api/central/* sigue siendo la otra ruta", () => {
    expect(caddy).toMatch(/@protected \{[\s\S]*not host \{\$PUBLIC_HOSTS:public-hosts\.invalid\}/);
    expect(caddy).toMatch(/basic_auth \{/);
    expect(entry).toContain("handle /api/central/* {");
  });
});
