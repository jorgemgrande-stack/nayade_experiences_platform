/**
 * Páginas iniciales de la web de una empresa (server/_core/templates/starterSite.ts): portada y textos legales
 * genéricos con los datos de la empresa como marcadores. Regresión de la verificación de Essential (01/11/2026): «/»
 * llevaba al acceso, /privacidad daba 404 y el texto escrito en una página perdía los párrafos.
 */
import { describe, expect, it } from "vitest";
import { sanitizeRichHtml } from "./_core/htmlSanitize";
import { isLegalPlaceholder, isLegalPageSlug } from "../shared/tenantNav";
import { STARTER_PAGES, STARTER_PAGE_SLUGS, SITE_TOKENS, missingSiteTokens, plainTextToHtml, renderSiteTokens } from "./_core/templates/starterSite";
import { missingLegalData } from "./starterSiteDb";

const FULL = { nombre: "Asesoría Norte", razon_social: "Asesoría Norte SL", nif: "B12345678", domicilio: "Calle Mayor 1, 28001 Madrid", email: "hola@norte.example", telefono: "910 000 000", direccion: "Madrid" };
const page = (slug: string) => STARTER_PAGES.find((p) => p.slug === slug)!;
const serve = (content: string, data: Record<string, string>) => renderSiteTokens(sanitizeRichHtml(plainTextToHtml(content)), data);
const NAYADE = /n[aá]yade|experiencias?\b|actividad|reserva|lego|hotel|\bspa\b|REAV/i;

describe("páginas iniciales", () => {
  it("portada y los tres textos legales; los legales son los que enlazan el pie y el aviso de cookies", () => {
    expect(STARTER_PAGE_SLUGS).toEqual(["inicio", "aviso-legal", "politica-de-privacidad", "politica-de-cookies"]);
    for (const s of STARTER_PAGE_SLUGS.slice(1)) expect(isLegalPageSlug(s)).toBe(true);
  });

  it("genéricas: sin textos de otra empresa ni de un sector, y nunca confundidas con el relleno de las plantillas", () => {
    for (const p of STARTER_PAGES) {
      expect(p.content + p.title).not.toMatch(NAYADE);
      expect(isLegalPlaceholder(p.slug, p.content)).toBe(false);
      // HTML que pasa el saneado sin perder nada
      expect(sanitizeRichHtml(p.content)).toBe(p.content);
    }
  });

  it("los datos que pueden faltar solo van dentro de un elemento de lista (si falta, se quita la línea)", () => {
    for (const p of STARTER_PAGES) {
      const outside = p.content.replace(/<li\b[^>]*>[\s\S]*?<\/li>/g, "");
      const used = Array.from(outside.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/g)).map((m) => m[1]);
      expect(used.every((t) => t === "nombre")).toBe(true);
    }
  });

  it("textos legales con lo que exigen la LSSI y el RGPD", () => {
    expect(page("aviso-legal").content).toMatch(/Ley 34\/2002/);
    for (const t of ["razon_social", "nif", "domicilio", "email"]) expect(page("aviso-legal").content).toContain(`{{${t}}}`);
    const priv = page("politica-de-privacidad").content;
    for (const w of ["Responsable", "finalidades", "Base legal", "Conservación", "Destinatarios", "derechos", "Agencia Española de Protección de Datos"]) expect(priv.toLowerCase()).toContain(w.toLowerCase());
    expect(page("politica-de-cookies").content).toMatch(/técnicas[\s\S]*análisis/);
  });

  it("con todos los datos: se rellenan escapados", () => {
    const html = serve(page("aviso-legal").content, FULL);
    expect(html).toContain("<li>NIF: B12345678</li>");
    expect(html).toContain("<li>Titular: Asesoría Norte SL</li>");
    expect(html).not.toMatch(/\{\{/);
    expect(missingSiteTokens(page("aviso-legal").content, FULL)).toEqual([]);
  });

  it("sin datos fiscales: no se inventa nada; esas líneas no se muestran y la página sigue siendo válida", () => {
    const data = { nombre: "Asesoría Norte" };
    const html = serve(page("aviso-legal").content, data);
    expect(html).not.toMatch(/\{\{|NIF:|Titular:|Domicilio:/);
    expect(html).toContain("<li>Nombre comercial: Asesoría Norte</li>");
    const home = serve(page("inicio").content, data);
    expect(home).toContain("<h1>Asesoría Norte</h1>");
    expect(home).not.toMatch(/Teléfono|<ul><\/ul>/);
    expect(missingSiteTokens(page("aviso-legal").content, data).sort()).toEqual(["domicilio", "email", "nif", "razon_social", "telefono"]);
    expect(missingLegalData(data)).toEqual(["razón social", "NIF", "domicilio fiscal", "correo electrónico de contacto"]);
    expect(missingLegalData(FULL)).toEqual([]);
  });

  it("los datos no pueden inyectar HTML; marcadores desconocidos se dejan como texto", () => {
    const html = serve("<p>{{nombre}}</p><ul><li>NIF: {{nif}}</li></ul><p>{{otro}}</p>", { nombre: '<img src=x onerror="alert(1)">', nif: "<script>x</script>" });
    expect(html).not.toMatch(/<img|<script/);
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(html).toContain("<p>{{otro}}</p>");
    expect(SITE_TOKENS).toContain("nif");
  });
});

describe("texto sin formato", () => {
  it("una línea en blanco separa párrafos y un salto de línea se respeta", () => {
    expect(plainTextToHtml("Somos una asesoría.\n\nTe ayudamos con tus impuestos.")).toBe("<p>Somos una asesoría.</p><p>Te ayudamos con tus impuestos.</p>");
    expect(plainTextToHtml("Línea 1\r\nLínea 2")).toBe("<p>Línea 1<br>Línea 2</p>");
    expect(plainTextToHtml("")).toBe("");
  });

  it("se escapa (y pasa el saneado); el HTML no se toca", () => {
    expect(plainTextToHtml("3 < 5 & \"hola\"")).toBe("<p>3 &lt; 5 &amp; &quot;hola&quot;</p>");
    expect(plainTextToHtml("<p>Ya es HTML</p>")).toBe("<p>Ya es HTML</p>");
    // Guardado ya saneado: sus entidades no se escapan dos veces
    expect(plainTextToHtml("2 &lt; 3 &amp; tres &#39;x&#39;")).toBe("<p>2 &lt; 3 &amp; tres &#39;x&#39;</p>");
    expect(serve("<p>a</p><script>alert(1)</script>", {})).toBe("<p>a</p>");
  });
});
