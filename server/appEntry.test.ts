/**
 * Página de entrada de las empresas (deploy/railway/gateway/app-entry) y su pasarela. El pase del acceso
 * centralizado se envía por POST al host de la empresa y el Core exige `Origin: https://<host central>`.
 * Regresión del 19/10/2026: `<meta name="referrer" content="no-referrer">` en la página hacía que el navegador
 * enviara `Origin: null` y TODO login central acababa en /login?acceso=caducado (la cabecera no basta: la etiqueta
 * <meta> tiene prioridad).
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const html = fs.readFileSync(path.resolve(__dirname, "../deploy/railway/gateway/app-entry/index.html"), "utf8");
const caddy = fs.readFileSync(path.resolve(__dirname, "../deploy/railway/gateway/Caddyfile"), "utf8");
// Políticas con las que el navegador SÍ envía el origen en un POST a otro host
const SENDS_ORIGIN = ["origin", "origin-when-cross-origin", "strict-origin", "strict-origin-when-cross-origin", "unsafe-url", "no-referrer-when-downgrade"];

describe("página de entrada: el pase llega con el origen de la página central", () => {
  it("la etiqueta <meta name=referrer> permite enviar el origen (no-referrer/same-origin lo anulan)", () => {
    const metas = [...html.matchAll(/<meta\s+name="referrer"\s+content="([^"]+)"/gi)].map((m) => m[1].toLowerCase());
    for (const v of metas) expect(SENDS_ORIGIN, `meta referrer=${v}`).toContain(v);
  });

  it("la cabecera Referrer-Policy de la entrada también lo permite", () => {
    const block = caddy.slice(caddy.indexOf("handle @app_entry"));
    const m = /Referrer-Policy "([^"]+)"/.exec(block);
    expect(m).not.toBeNull();
    expect(SENDS_ORIGIN).toContain(m![1].toLowerCase());
  });

  it("el formulario del pase va por POST y la CSP permite enviarlo a otro host (form-action https:)", () => {
    expect(html).toMatch(/<form id="handoff" method="post"/);
    expect(caddy).toMatch(/form-action https:/);
    expect(caddy).toMatch(/connect-src 'self'/);
  });
});

describe("página de entrada: acceso con la identidad oficial de Big Elephant", () => {
  it("logotipo oficial y rojo corporativo; mostrar/ocultar contraseña accesible; validación por campo; sin credenciales de ejemplo", () => {
    expect(html).toContain('src="/big-elephant-logo.png"');
    expect(html).toMatch(/--red: #ff3035/);
    expect(html).toMatch(/id="password-toggle"/);
    expect(html).toMatch(/aria-controls="password"/);
    expect(html).toMatch(/aria-pressed="false"/);
    expect(html).toMatch(/setAttribute\("aria-invalid", "true"\)/);
    expect(html).toMatch(/Revisa el correo: debe tener el formato/);
    expect(html).not.toMatch(/placeholder="[^"]*@[^"]*"/);
    expect(html).not.toMatch(/type="password"[^>]*value="[^"]+"/);
  });
});
