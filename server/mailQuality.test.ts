/**
 * Banco de pruebas de TODOS los correos con vista previa o constructor propio: se renderizan con datos ficticios (una
 * empresa inventada, «Aventuras Sierra Norte», y la plataforma) y se comprueban de forma automática:
 *  - asunto y cuerpo sin variables sin sustituir ({{…}}, undefined, null, NaN, [object …]);
 *  - sin datos de Náyade, Skicenter ni Skibox;
 *  - enlaces https (o mailto/tel), sin localhost ni http plano, y a dominios esperados;
 *  - imágenes con texto alternativo; diseño adaptable (viewport y ancho máximo) en las plantillas con documento propio;
 *  - versión de texto en los correos de plataforma.
 * Con MAIL_RENDER_DIR, además, guarda cada correo (HTML, texto y asunto) para las capturas y la validación con Postmark.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

const COMPANY: Record<string, string> = {
  brand_name: "Aventuras Sierra Norte",
  brand_primary_color: "#0b5d3b",
  brand_accent_color: "#b4321f",
  brand_logo_url: "https://cdn.aventurassierranorte.example/logo.png",
  brand_phone: "+34 910 000 000",
  brand_support_phone: "+34 910 000 001",
  email_reservations: "reservas@aventurassierranorte.example",
  site_business_email: "hola@aventurassierranorte.example",
  brand_address: "Calle Mayor 12, 28740 Rascafría (Madrid)",
  brand_location: "Rascafría, Madrid",
  brand_nif: "B00000000",
  brand_domain: "aventurassierranorte.example",
  brand_website_url: "https://aventurassierranorte.example",
};
const HOST = "aventuras-sierra-norte.app.bigelephant.es";

vi.hoisted(() => {
  process.env.TENANT_MODE = "multi";
  process.env.APP_URL = "https://aventuras-sierra-norte.app.bigelephant.es";
});
vi.mock("./config", async (orig) => {
  const real = await orig<typeof import("./config")>();
  const get = (k: string, f = "") => COMPANY[k] ?? f;
  return { ...real, getSystemSettingSync: get, getSystemSetting: async (k: string, f = "") => get(k, f), getBusinessEmail: async () => COMPANY.email_reservations };
});
vi.mock("./_core/legacyDb", () => ({ legacyDb: () => ({}), legacyPool: () => ({}) }));
vi.mock("./mailer", () => ({ sendEmail: vi.fn() }));

const { allPreviews } = await import("./notifications/preview");
const { platformTemplates } = await import("./mail/templates");
const { SYSTEM_TEMPLATES, brandedTemplateTexts } = await import("./routers/emailTemplatesRouter");
const { passwordChangedContent } = await import("./mail/securityTemplates");
const { exportReadyContent, exportFailedContent } = await import("./mail/exportTemplates");
const { htmlToText } = await import("./mail/plainText");
const { buildBudgetRequestAdminHtml, buildBudgetRequestUserHtml, buildNoticeHtml, buildInvoiceEmailHtml } = await import("./emailTemplates");

export interface RenderedMail {
  id: string;
  side: "plataforma" | "empresa";
  subject: string;
  html: string;
  text: string;
}

function renderAll(): RenderedMail[] {
  const out: RenderedMail[] = [];
  for (const p of allPreviews()) out.push({ id: `plataforma.${p.id}`, side: "plataforma", subject: p.subject, html: p.html, text: p.text });
  // Plataforma sin vista previa en el catálogo
  const T = platformTemplates();
  const extra: Array<[string, { subject: string; html: string; text?: string }]> = [
    ["plataforma.trial.verification_resent", T.emailVerificationResent({ verifyUrl: "https://bigelephant.es/verificar?t=demo-token" })],
    ["plataforma.tenant_welcome", T.tenantWelcome({ companyName: COMPANY.brand_name, host: HOST, setPasswordUrl: `https://${HOST}/establecer-contrasena?token=demo-token` })],
    ["plataforma.test_payment_confirmed", T.testPaymentConfirmed({ reference: "ES-2026-0042", amountCents: 3509, currency: "EUR" })],
  ];
  for (const [id, c] of extra) out.push({ id, side: "plataforma", subject: c.subject, html: c.html, text: c.text ?? "" });
  // Empresa: plantillas de sistema (asunto con la marca de la empresa)
  for (const t of SYSTEM_TEMPLATES) {
    const b = brandedTemplateTexts(t);
    let html: string;
    try {
      html = t.buildHtml();
    } catch (e) {
      html = `ERROR AL RENDERIZAR: ${(e as Error).message}`;
    }
    out.push({ id: `empresa.${t.id}`, side: "empresa", subject: b.subject, html, text: html.startsWith("ERROR") ? "" : htmlToText(html) });
  }
  const pc = passwordChangedContent(COMPANY.brand_name, "Lucía Martín", new Date(Date.UTC(2026, 9, 23, 9, 30)));
  out.push({ id: "empresa.security.password_changed", side: "empresa", subject: pc.subject, html: pc.html, text: pc.text ?? "" });
  const er = exportReadyContent(COMPANY.brand_name, { name: "Lucía Martín", tables: 42, rows: 18350, files: 127, warning: null, expiresAt: Date.UTC(2026, 9, 30), panelUrl: `https://${HOST}/admin/suscripcion/exportar` });
  out.push({ id: "empresa.data.export_ready", side: "empresa", subject: er.subject, html: er.html, text: er.text ?? "" });
  const ef = exportFailedContent(COMPANY.brand_name, { name: "Lucía Martín", reason: "Tiempo de espera agotado", panelUrl: `https://${HOST}/admin/suscripcion/exportar` });
  out.push({ id: "empresa.data.export_failed", side: "empresa", subject: ef.subject, html: ef.html, text: ef.text ?? "" });
  // Correos que antes se escribían a mano en los procedimientos
  const notice = buildNoticeHtml({ badge: "Invitación", title: "Bienvenido al portal de colaboradores", greetingName: "Lucía Martín", paragraphs: [`Te han invitado al portal de colaboradores de ${COMPANY.brand_name} como miembro de Viajes Norte.`], cta: { label: "Activar mi cuenta", url: `https://${HOST}/partner/activar?token=demo-token` }, note: "Este enlace caduca en 7 días." });
  out.push({ id: "empresa.portal_invite", side: "empresa", subject: `Invitación al portal de colaboradores — Viajes Norte`, html: notice, text: htmlToText(notice) });
  const invoice = buildInvoiceEmailHtml({ clientName: "Lucía Martín", invoiceNumber: "FAC-2026-0042", isCreditNote: false, items: [{ description: "Ruta guiada (2 personas)", quantity: 2, unitPrice: 35, total: 70 }], subtotal: 70, taxRate: 21, taxAmount: 14.7, total: 84.7, pdfUrl: `https://${HOST}/api/ficheros/demo/FAC-2026-0042.pdf` });
  out.push({ id: "empresa.invoice_email", side: "empresa", subject: `Tu factura FAC-2026-0042 — ${COMPANY.brand_name}`, html: invoice, text: htmlToText(invoice) });
  return out;
}

const BAD_TOKEN = /\{\{\s*[\w.]+\s*\}\}|\bundefined\b|\bNaN\b|\[object [A-Za-z]+\]|>\s*null\s*<|:\s*null\b/;
const OTHER_BRANDS = /n[aá]yade|skicenter|skibox|nayadeexperiences/i;
/** Dominios a los que puede apuntar un enlace de estos correos de prueba. */
const ALLOWED_HOSTS = [/\.app\.bigelephant\.es$/, /^(www\.)?bigelephant\.es$/, /\.example$/, /^sis-t\.redsys\.es$/, /^wa\.me$/, /^maps\.google\.com$/, /^www\.google\.com$/];

export function problemsOf(m: RenderedMail): string[] {
  const p: string[] = [];
  if (m.html.startsWith("ERROR AL RENDERIZAR")) return [m.html];
  if (!m.subject.trim()) p.push("asunto vacío");
  if (BAD_TOKEN.test(m.subject)) p.push(`asunto con variable sin sustituir: ${m.subject}`);
  const visible = m.html.replace(/<style[\s\S]*?<\/style>/gi, "");
  const bad = visible.match(BAD_TOKEN);
  if (bad) p.push(`cuerpo con variable sin sustituir: «${bad[0]}»`);
  if (/=>|function\s*\(|BRAND_[A-Z_]+/.test(visible)) p.push("código fuente en el HTML (función sin llamar)");
  if (OTHER_BRANDS.test(m.subject + m.html + m.text)) p.push(`datos de otra empresa: «${(m.subject + m.html + m.text).match(OTHER_BRANDS)![0]}»`);
  for (const href of Array.from(m.html.matchAll(/href="([^"]*)"/gi), (x) => x[1])) {
    if (/^(mailto|tel):/i.test(href)) {
      if (/^mailto:\s*$/i.test(href)) p.push("enlace mailto vacío");
      continue;
    }
    if (!/^https:\/\//i.test(href)) {
      p.push(`enlace no https: ${href.slice(0, 80)}`);
      continue;
    }
    const host = new URL(href.replace(/&amp;/g, "&")).host;
    if (/localhost|127\.0\.0\.1/.test(host)) p.push(`enlace a localhost: ${href}`);
    else if (!ALLOWED_HOSTS.some((r) => r.test(host))) p.push(`enlace a dominio inesperado: ${host}`);
  }
  for (const img of Array.from(m.html.matchAll(/<img\b[^>]*>/gi), (x) => x[0])) if (!/\balt="/i.test(img)) p.push("imagen sin texto alternativo");
  if (/<html/i.test(m.html)) {
    if (!/name="viewport"/i.test(m.html)) p.push("sin meta viewport (móvil)");
    if (!/max-width:\s*\d+px/i.test(m.html)) p.push("sin ancho máximo");
  }
  if (!m.text.trim()) p.push("sin versión de texto");
  else if (/<[a-z][^>]*>|&[a-z]+;/i.test(m.text)) p.push("versión de texto con etiquetas o entidades HTML");
  if (m.side === "empresa" && /#f97316|#e85d04|#ea580c/i.test(m.html)) p.push("naranja heredado en lugar del color de la empresa");
  return p;
}

describe("calidad de todos los correos", () => {
  const mails = renderAll();

  it("se renderizan todos los correos con vista previa o constructor propio", () => {
    expect(mails.length).toBeGreaterThanOrEqual(70);
    expect(new Set(mails.map((m) => m.id)).size).toBe(mails.length);
  });

  it("ningún correo con variables sin sustituir, datos de otra empresa, enlaces dudosos o sin adaptar a móvil", () => {
    const report = mails.map((m) => ({ id: m.id, problems: problemsOf(m) })).filter((r) => r.problems.length);
    const dir = process.env.MAIL_RENDER_DIR;
    if (dir) {
      fs.mkdirSync(dir, { recursive: true });
      for (const m of mails) {
        const base = path.join(dir, m.id.replace(/[^a-z0-9._-]/gi, "_"));
        fs.writeFileSync(`${base}.html`, m.html);
        fs.writeFileSync(`${base}.txt`, m.text);
        fs.writeFileSync(`${base}.json`, JSON.stringify({ id: m.id, side: m.side, subject: m.subject }));
      }
      fs.writeFileSync(path.join(dir, "_problemas.json"), JSON.stringify(report, null, 2));
    }
    expect(report).toEqual([]);
  });

  it("los correos de la empresa usan sus colores; sin colores propios, los de Big Elephant (nunca el naranja heredado)", () => {
    const quote = () => SYSTEM_TEMPLATES.find((t) => t.id === "quote")!.buildHtml();
    const own = quote();
    expect(own).toContain("#0b5d3b");
    expect(own).toContain("#b4321f");
    expect(own).not.toMatch(/#f97316|#0a1628/i);
    const saved = { p: COMPANY.brand_primary_color, a: COMPANY.brand_accent_color };
    try {
      // Sin colores, o con uno ilegible sobre blanco: identidad de Big Elephant
      COMPANY.brand_primary_color = "";
      COMPANY.brand_accent_color = "#ffeb3b";
      const def = quote();
      expect(def).toContain("#171d28");
      expect(def).toContain("#d0161c");
      expect(def).not.toContain("#ffeb3b");
    } finally {
      COMPANY.brand_primary_color = saved.p;
      COMPANY.brand_accent_color = saved.a;
    }
  });

  it("solicitud de presupuesto (formulario público): el HTML del cliente nunca se inserta sin escapar", () => {
    const evil = { name: "<script>alert(1)</script>", email: "x@ejemplo.example", phone: "<b>600</b>", arrivalDate: "hoy", adults: 2, children: 0, selectedCategory: "<i>x</i>", selectedProduct: "<img src=x onerror=alert(1)>", comments: '"><a href="https://malo.example">pincha</a>', submittedAt: "ahora" };
    for (const html of [buildBudgetRequestAdminHtml(evil), buildBudgetRequestUserHtml(evil)]) {
      expect(html).not.toMatch(/<script|<img src=x|href="https:\/\/malo\.example"|<b>600<\/b>|<i>x<\/i>/i);
    }
    expect(buildBudgetRequestAdminHtml(evil)).toContain("&lt;script&gt;");
  });

  it("versión de texto: enlaces legibles y sin HTML", () => {
    const t = htmlToText('<html><head><style>p{}</style></head><body><p>Hola&nbsp;<strong>Ana</strong>,</p><a href="https://x.example/pago?a=1&amp;b=2">Pagar ahora</a><br><a href="mailto:hola@x.example">hola@x.example</a></body></html>');
    expect(t).toBe("Hola Ana,\nPagar ahora (https://x.example/pago?a=1&b=2)\nhola@x.example");
  });

  it("los correos escritos a mano en los procedimientos usan ya las plantillas comunes (sin naranja ni HTML suelto)", () => {
    for (const [f, fn] of [["./routers/partners.ts", "buildNoticeHtml"], ["./routers/suppliers.ts", "buildNoticeHtml"], ["./routers/hr.ts", "buildNoticeHtml"], ["./routers/gestoria.ts", "buildNoticeHtml"], ["./routers/crm.ts", "buildInvoiceEmailHtml"]]) {
      const src = fs.readFileSync(new URL(f, import.meta.url), "utf8");
      expect(src, f).toContain(fn);
      expect(src, f).not.toMatch(/<h2 style="color:#(ea580c|f97316)/i);
    }
  });

  it("aviso genérico: todo el texto de quien llama se escapa", () => {
    const html = buildNoticeHtml({ title: "<b>t</b>", greetingName: "<script>x</script>", paragraphs: ['<a href="https://malo.example">x</a>'], cta: { label: "<i>y</i>", url: "https://ok.example/a?b=1&c=2" } });
    expect(html).not.toMatch(/<script|<b>t<\/b>|href="https:\/\/malo|<i>y<\/i>/);
    expect(html).toContain('href="https://ok.example/a?b=1&amp;c=2"');
  });

  it("móvil: la tabla principal de los correos de empresa se adapta (sin ancho fijo fuera de Outlook)", () => {
    for (const t of SYSTEM_TEMPLATES) {
      const html = t.buildHtml().replace(/<!--\[if (?:\(?gte mso|mso)[\s\S]*?<!\[endif\]-->/g, "");
      expect(html, t.id).not.toMatch(/<table width="600"/);
    }
  });
});

describe("compatibilidad con Outlook de escritorio", () => {
  it("botones de plataforma: relleno y color en la celda, no en el enlace (Outlook pegaba el texto al borde)", () => {
    const html = platformTemplates().tenantWelcome({ companyName: "Aventuras Sierra Norte", host: "a.app.bigelephant.es", setPasswordUrl: "https://a.app.bigelephant.es/establecer-contrasena?token=x" }).html;
    // Outlook de escritorio: botón VML redondeado con su propio texto; el resto, celda con fondo y enlace con relleno
    expect(html).toMatch(/<!--\[if mso\]><v:roundrect [^>]*fillcolor="#FF3131"/);
    expect(html).toMatch(/<td bgcolor="#FF3131"[^>]*><a href="https:\/\/a\.app\.bigelephant\.es\/establecer-contrasena/);
  });
});
