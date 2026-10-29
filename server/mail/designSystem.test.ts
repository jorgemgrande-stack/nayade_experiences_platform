/** Sistema de diseño de los correos y catálogo maestro (server/mail/design.ts, testCatalog.ts). */
import { describe, expect, it } from "vitest";
import { renderEmail, assetBase, CORPORATE } from "./design";
import { allTestEmails, TEMPLATES } from "./testCatalog";
import { DEFAULT_MAIL_LOGO_URL, PLATFORM_LEGAL_LINE } from "./policy";

const brand = { name: "Big Elephant", supportEmail: "soporte@bigelephant.es", logoUrl: DEFAULT_MAIL_LOGO_URL, legal: PLATFORM_LEGAL_LINE };

describe("catálogo maestro de comunicaciones", () => {
  const all = allTestEmails();
  it("todas las plantillas: id único, nombre, familia, servicio, evento y estado", () => {
    expect(all.length).toBe(TEMPLATES.length);
    expect(all.length).toBeGreaterThanOrEqual(75);
    expect(new Set(all.map((e) => e.id)).size).toBe(all.length);
    for (const e of all) {
      expect(e.name.length, e.id).toBeGreaterThan(5);
      expect(["experiential", "transactional", "security"]).toContain(e.family);
      expect(["controlplane", "core", "crm"]).toContain(e.service);
      expect(["conectada", "sin_disparador", "interna"]).toContain(e.state);
    }
  });
  it("contenido completo y seguro: asunto, HTML, texto, sin variables vacías, solo https, sin datos de clientes", () => {
    for (const e of all) {
      expect(e.subject.length, e.id).toBeGreaterThan(5);
      expect(e.subject, e.id).not.toMatch(/[\r\n]/);
      expect(e.html, e.id).toMatch(/^<!doctype html><html lang="es">/);
      expect(e.text.length, e.id).toBeGreaterThan(40);
      for (const x of [e.subject, e.html, e.text]) expect(x, e.id).not.toMatch(/undefined|NaN|\[object |\bnull\b/);
      for (const m of e.html.matchAll(/href="([^"]+)"/g)) expect(m[1], e.id).toMatch(/^https:\/\//);
      // Datos ficticios: enlaces de muestra a dominios de ejemplo, nunca a una cuenta real
      for (const m of e.html.matchAll(/href="([^"]+)"/g)) expect(m[1], e.id).toMatch(/\.example\/|\.example$|^https:\/\/www\.bigelephant\.es(\/|$)/);
    }
  });
  it("legibles sin imágenes: cada imagen tiene dimensiones y su información está también en el texto", () => {
    for (const e of all) {
      for (const img of e.html.matchAll(/<img [^>]+>/g)) {
        expect(img[0], e.id).toMatch(/ width="\d+"/);
        expect(img[0], e.id).toMatch(/ alt="/);
      }
      // Sin imágenes, el texto plano conserva el título y el pie corporativo
      expect(e.text, e.id).toContain(PLATFORM_LEGAL_LINE);
    }
  });
  it("las comerciales llevan la baja; las de servicio, nada comercial", () => {
    for (const e of all) {
      if (e.group === "comercial") expect(e.text, e.id).toMatch(/Baja de comunicaciones comerciales/);
      else expect(e.text, e.id).toMatch(/No es publicidad/);
    }
  });
});

describe("componentes", () => {
  it("cabecera con el logotipo oficial sin alterar, lema y pie con la línea legal", () => {
    const m = renderEmail(brand, { family: "transactional", title: "Prueba", intro: ["Hola"] });
    expect(m.html).toContain(`<img src="${DEFAULT_MAIL_LOGO_URL}"`);
    expect(m.html).toContain("Tu negocio,<br>más lejos.");
    expect(m.html).toContain(PLATFORM_LEGAL_LINE);
    for (const l of CORPORATE.links) expect(m.html).toContain(`${CORPORATE.web}${l.path}`);
  });
  it("tarjeta con estado, total y pie; línea de progreso; aviso; versión de texto equivalente", () => {
    const m = renderEmail(brand, {
      family: "transactional",
      title: "Tu servicio está contratado",
      blocks: [
        { card: { status: { label: "Programada", tone: "success" }, rows: [{ label: "Cuota mensual", value: "1.000,00 €" }], total: { label: "Total mensual", value: "1.210,00 €" }, foot: { label: "Primer cobro previsto", value: "1 de noviembre de 2026" } } },
        { timeline: [{ label: "Contrato firmado", state: "done" }, { label: "Primer cobro", state: "current" }, { label: "Facturas", state: "todo" }] },
        { notice: { tone: "info", text: "No se ha realizado ningún cargo." } },
      ],
    });
    expect(m.text).toContain("Estado: Programada");
    expect(m.text).toContain("Total mensual: 1.210,00 €");
    expect(m.text).toContain("[x] Contrato firmado");
    expect(m.text).toContain("[>] Primer cobro");
    expect(m.text).toContain("No se ha realizado ningún cargo.");
    expect(m.html).toContain("1.210,00 €");
  });
  it("escapa todo valor variable y descarta enlaces no https", () => {
    const m = renderEmail(brand, { family: "security", title: "<b>x</b>", intro: ["<script>alert(1)</script>"], cta: { label: "Ir", url: "javascript:alert(1)" } });
    expect(m.html).not.toContain("<script>");
    expect(m.html).not.toContain("javascript:");
    expect(m.html).toContain("&lt;b&gt;x&lt;/b&gt;");
  });
  it("modo neutro de empresa (sin logotipo de plataforma): su nombre, sin ilustraciones ni pie corporativo", () => {
    const m = renderEmail({ name: "Empresa Demo" }, { family: "experiential", title: "Hola", hero: "bienvenida" });
    expect(m.html).not.toContain("<img");
    expect(m.html).toContain("Empresa Demo");
    expect(m.html).not.toContain("IRON ELEPHANT");
  });
  it("recursos: base por entorno (live o production) o la configurada en https", () => {
    expect(assetBase({ RAILWAY_ENVIRONMENT_NAME: "live" })).toBe("https://elephant-source-web-live.up.railway.app/brand/mail");
    expect(assetBase({ RAILWAY_ENVIRONMENT_NAME: "production" })).toBe("https://www.bigelephant.es/brand/mail");
    expect(assetBase({ MAIL_ASSET_BASE: "https://cdn.example/m/" })).toBe("https://cdn.example/m");
    expect(assetBase({ MAIL_ASSET_BASE: "http://inseguro.example" })).toBe("https://www.bigelephant.es/brand/mail");
  });
});
