/**
 * Aviso de cookies: no aparece en las páginas de acceso ni en el panel (solo cookies técnicas). En móvil tapaba el
 * botón «Establecer contraseña» del alta de una empresa nueva (encontrado con Playwright a 390 px).
 */
import { describe, it, expect } from "vitest";
import { showsCookieBanner } from "../client/src/components/CookieBanner";

describe("aviso de cookies", () => {
  it("no aparece en el acceso ni en el panel; sí en la web pública de la empresa", () => {
    for (const p of ["/login", "/establecer-contrasena", "/recuperar-contrasena", "/nueva-contrasena", "/admin", "/admin/primeros-pasos", "/admin/crm/clientes"]) expect(showsCookieBanner(p), p).toBe(false);
    for (const p of ["/", "/experiencias", "/contacto", "/administracion-de-fincas", "/login-ayuda"]) expect(showsCookieBanner(p), p).toBe(true);
  });
});

describe("textos del aviso de cookies (LSSI)", () => {
  it("genéricos para cualquier empresa: sin «experiencia» ni nada sectorial", async () => {
    const { COOKIE_TEXTS } = await import("../client/src/components/CookieBanner");
    const { ORIGINAL, restosEn } = await import("../shared/sinNayade");
    const all = Object.values(COOKIE_TEXTS).join(" ");
    expect(all).not.toMatch(ORIGINAL);
    expect(restosEn(all)).toEqual([]);
    expect(all).not.toMatch(/Google Analytics|Hotjar|Meta Pixel|Google Ads/);
    const src = (await import("node:fs")).readFileSync(new URL("../client/src/components/CookieBanner.tsx", import.meta.url), "utf8");
    expect(src.replace(/^\s*(\/\/|\*|\/\*).*$/gm, "")).not.toMatch(/experiencia/i);
  });

  it("informa de la finalidad, pide consentimiento para las no necesarias y permite rechazar al mismo nivel", async () => {
    const { COOKIE_TEXTS } = await import("../client/src/components/CookieBanner");
    expect(COOKIE_TEXTS.body).toMatch(/necesarias/);
    expect(COOKIE_TEXTS.body).toMatch(/consentimiento/);
    expect(COOKIE_TEXTS.body).toMatch(/aceptarlas, rechazarlas/);
    expect(COOKIE_TEXTS.reject).toBe("Rechazar");
    expect(COOKIE_TEXTS.necessary).toMatch(/No necesitan tu consentimiento/);
  });

  it("enlaza a la política de cookies de la propia empresa", async () => {
    const { COOKIE_POLICY_PATH, COOKIE_TEXTS } = await import("../client/src/components/CookieBanner");
    expect(COOKIE_POLICY_PATH).toBe("/cookies");
    expect(COOKIE_TEXTS.policy).toBe("Política de cookies");
    const app = (await import("node:fs")).readFileSync(new URL("../client/src/App.tsx", import.meta.url), "utf8");
    // En la web de una empresa, /cookies sirve SU página «politica-de-cookies» (nunca la de otra)
    expect(app).toMatch(/path="\/cookies">\{\(\) => <SingleOnlyPage Single=\{PoliticaCookies\} slug="politica-de-cookies" \/>\}/);
  });
});
