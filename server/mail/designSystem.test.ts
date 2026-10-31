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
      expect(["experiential", "transactional", "security", "admin"]).toContain(e.family);
      expect(e.family === "admin", e.id).toBe(e.group === "administracion");
      expect(["controlplane", "core", "crm"]).toContain(e.service);
      expect(["conectada", "sin_disparador", "interna", "externa"]).toContain(e.state);
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
      for (const m of e.html.matchAll(/href="([^"]+)"/g)) expect(m[1], e.id).toMatch(/\.example\/|\.example$|^https:\/\/www\.bigelephant\.es(\/|$)|^https:\/\/www\.(instagram|facebook)\.com\//);
    }
  });
  it("legibles sin imágenes: cada imagen tiene dimensiones y su información está también en el texto", () => {
    for (const e of all) {
      for (const img of e.html.matchAll(/<img [^>]+>/g)) {
        expect(img[0], e.id).toMatch(/ width="\d+"/);
        expect(img[0], e.id).toMatch(/ alt="/);
      }
      // Sin imágenes, el texto plano conserva el título y el pie corporativo
      expect(e.text, e.id).toContain("Big Elephant · www.bigelephant.es");
    }
  });
  it("las comerciales llevan la baja; las de servicio, nada comercial", () => {
    for (const e of all) {
      if (e.group === "comercial") expect(e.text, e.id).toMatch(/Baja de comunicaciones comerciales/);
      // Familia D: avisos internos, con su propio pie (nada comercial)
      else if (e.family === "admin") expect(e.text, e.id).toMatch(/Aviso interno para la administración/);
      else expect(e.text, e.id).toMatch(/No es publicidad/);
      expect(e.text, e.id).not.toMatch(e.group === "comercial" ? /^$/ : /Baja de comunicaciones comerciales/);
    }
  });
});

describe("componentes", () => {
  it("cabecera con el logotipo oficial sin alterar y lema", () => {
    const m = renderEmail(brand, { family: "transactional", title: "Prueba", intro: ["Hola"] });
    expect(m.html).toContain(`<img src="${DEFAULT_MAIL_LOGO_URL}"`);
    expect(m.html).toContain("Tu negocio,<br>más lejos.");
  });
  it("pie corporativo aprobado: blanco, logotipo oficial, redes y enlaces; sin domicilio ni bloque oscuro", () => {
    const m = renderEmail(brand, { family: "transactional", title: "Prueba", intro: ["Hola"] });
    const foot = m.html.slice(m.html.indexOf('class="be-foot"'));
    // El mismo archivo oficial del logotipo que la cabecera, enlazado a la web
    expect(foot).toContain(`<a href="${CORPORATE.web}" target="_blank" style="text-decoration:none"><img src="${DEFAULT_MAIL_LOGO_URL}"`);
    expect(foot).toContain('href="https://www.instagram.com/bigelephantnet/"');
    expect(foot).toContain('href="https://www.facebook.com/profile.php?id=61595651785681&amp;locale=es_ES"');
    expect(foot).toMatch(/social-instagram\.png" width="40" height="40" alt="Instagram"/);
    expect(foot).toMatch(/social-facebook\.png" width="40" height="40" alt="Facebook"/);
    for (const l of CORPORATE.links) expect(foot).toContain(`<a href="${CORPORATE.web}${l.path}" target="_blank"`);
    expect(foot.indexOf("Centro de ayuda")).toBeLessThan(foot.indexOf("Política de privacidad"));
    expect(foot.indexOf("Política de privacidad")).toBeLessThan(foot.indexOf("Términos del servicio"));
    for (const x of [m.html, m.text]) {
      expect(x).not.toMatch(/Corazón de María|28002|pie-elefante|#141A26|IRON ELEPHANT/);
      expect(x).toContain("Mensaje de servicio relacionado con tu cuenta. No es publicidad.");
      expect(x).not.toMatch(/darte de baja|Baja de comunicaciones/i);
    }
    // El soporte configurado se ofrece en la línea de servicio
    expect(m.text).toContain("¿Dudas? Escríbenos a soporte@bigelephant.es.");
  });
  it("pie comercial: destinatario, baja real e identificación del titular (sin domicilio)", () => {
    const unsubscribeUrl = "https://www.bigelephant.es/cp/v1/communications/baja?t=abc";
    const m = renderEmail(brand, { family: "experiential", title: "Novedades", commercial: true, unsubscribeUrl, recipient: "ana@cliente.example" });
    expect(m.html).toContain('Este email se ha enviado a <span style="color:#374151">ana@cliente.example</span>.');
    expect(m.html).toContain(`puedes <a href="${unsubscribeUrl}" target="_blank" style="color:#111827;text-decoration:underline">darte de baja aquí</a>.`);
    expect(m.html).toContain("Big Elephant es un servicio de IRON ELEPHANT CONSULTING, S.L. · NIF B26987875");
    expect(m.html).not.toMatch(/No es publicidad|Corazón de María/);
    expect(m.text).toContain("Este email se ha enviado a ana@cliente.example.");
    expect(m.text).toContain(`Baja de comunicaciones comerciales: ${unsubscribeUrl}`);
    // Sin destinatario conocido, sin la frase; sin enlace firmado, la página de soporte
    const anon = renderEmail(brand, { family: "experiential", title: "Novedades", commercial: true });
    expect(anon.html).not.toContain("Este email se ha enviado");
    expect(anon.html).toContain('<a href="https://www.bigelephant.es/soporte" target="_blank" style="color:#111827;text-decoration:underline">darte de baja aquí</a>');
  });
  it("misma identidad visual en las variantes del pie (servicio, interna y comercial)", () => {
    const shell = (h: string) => h.slice(h.indexOf('class="be-foot"'), h.indexOf("margin-top:14px"));
    const v = [renderEmail(brand, { family: "security", title: "A" }), renderEmail(brand, { family: "admin", title: "B" }), renderEmail(brand, { family: "experiential", title: "C", commercial: true })].map((m) => shell(m.html));
    expect(new Set(v).size).toBe(1);
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

describe("estado del catálogo", () => {
  it("cada plantilla sin disparador lleva su motivo funcional concreto", () => {
    const pending = allTestEmails().filter((e) => e.state === "sin_disparador");
    for (const e of pending) expect((e as { pending?: string }).pending?.length, e.id).toBeGreaterThan(40);
  });
  it("las que envía Stripe figuran como gestionadas externamente, no como pendientes", () => {
    const ext = allTestEmails().filter((e) => e.state === "externa");
    expect(ext.map((e) => e.id).sort()).toEqual(["billing.payment_reminder", "billing.upcoming_charge"]);
    for (const e of ext) expect(e.managedBy, e.id).toMatch(/^Gestionada por Stripe/);
  });
});
