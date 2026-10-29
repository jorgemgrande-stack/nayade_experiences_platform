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
