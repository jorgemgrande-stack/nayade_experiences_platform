/**
 * Correos de empresa revisados en Outlook (23/10/2026): asuntos sin «??», sin frases de contacto colgando cuando la
 * empresa no tiene correo de contacto, y cabecera de Outlook del color de la marca.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { cleanSubject, dropEmptyContactLinks } from "./plainText";
import { SYSTEM_TEMPLATES } from "../routers/emailTemplatesRouter";

describe("correos de empresa en Outlook", () => {
  it("ninguna plantilla del sistema empieza el asunto con «?»", () => {
    for (const t of SYSTEM_TEMPLATES) expect(t.subject, t.id).not.toMatch(/^\?/);
  });

  it("los asuntos ya guardados con «??» se limpian al enviar, también tras [PRUEBA]", () => {
    expect(cleanSubject("?? Tu propuesta personalizada · Empresa")).toBe("Tu propuesta personalizada · Empresa");
    expect(cleanSubject("[PRUEBA] ??? Solicitud de canje recibida")).toBe("[PRUEBA] Solicitud de canje recibida");
    expect(cleanSubject("¿Tienes dudas? Escríbenos")).toBe("¿Tienes dudas? Escríbenos");
    expect(cleanSubject("Reserva confirmada")).toBe("Reserva confirmada");
  });

  it("sin correo de contacto, el párrafo con el enlace vacío desaparece; con correo, se queda", () => {
    const empty = `<p style="a">Antes</p><p style="b">O contacta con nosotros en <a href="mailto:" style="c"></a></p><p>Después</p>`;
    expect(dropEmptyContactLinks(empty)).toBe(`<p style="a">Antes</p><p>Después</p>`);
    const full = `<p>Escríbenos a <a href="mailto:hola@empresa.es">hola@empresa.es</a></p>`;
    expect(dropEmptyContactLinks(full)).toBe(full);
    const button = `<table><tr><td>Fila</td></tr></table><table width="100%" style="margin:24px 0;"><tr><td align="center"><!--[if mso]><v:roundrect href="mailto:"></v:roundrect><![endif]--><a href="mailto:">Contactar ahora</a></td></tr></table><p>Fin</p>`;
    expect(dropEmptyContactLinks(button)).toBe(`<table><tr><td>Fila</td></tr></table><p>Fin</p>`);
    const ok = `<table><tr><td><a href="mailto:hola@empresa.es">Contactar</a></td></tr></table>`;
    expect(dropEmptyContactLinks(ok)).toBe(ok);
  });

  it("la cabecera de Outlook usa el color de la marca y no hay erratas en «Escríbenos»", () => {
    const src = fs.readFileSync(path.resolve(__dirname, "../emailTemplates.ts"), "utf8");
    expect(src).not.toContain("background-color:#0d1f3c");
    expect(src).not.toContain("Escrb&iacute;benos");
    expect(src).toContain('if (/^mailto:\\s*$/i.test(href)) return "";');
  });
});
