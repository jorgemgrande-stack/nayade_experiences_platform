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
    out.push({ id: `empresa.${t.id}`, side: "empresa", subject: b.subject, html, text: "" });
  }
  const pc = passwordChangedContent(COMPANY.brand_name, "Lucía Martín", new Date(Date.UTC(2026, 9, 23, 9, 30)));
  out.push({ id: "empresa.security.password_changed", side: "empresa", subject: pc.subject, html: pc.html, text: pc.text ?? "" });
  const er = exportReadyContent(COMPANY.brand_name, { name: "Lucía Martín", tables: 42, rows: 18350, files: 127, warning: null, expiresAt: Date.UTC(2026, 9, 30), panelUrl: `https://${HOST}/admin/suscripcion/exportar` });
  out.push({ id: "empresa.data.export_ready", side: "empresa", subject: er.subject, html: er.html, text: er.text ?? "" });
  const ef = exportFailedContent(COMPANY.brand_name, { name: "Lucía Martín", reason: "Tiempo de espera agotado", panelUrl: `https://${HOST}/admin/suscripcion/exportar` });
  out.push({ id: "empresa.data.export_failed", side: "empresa", subject: ef.subject, html: ef.html, text: ef.text ?? "" });
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
  if (m.side === "plataforma" && !m.text.trim()) p.push("sin versión de texto");
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

  it("móvil: la tabla principal de los correos de empresa se adapta (sin ancho fijo fuera de Outlook)", () => {
    for (const t of SYSTEM_TEMPLATES) {
      const html = t.buildHtml().replace(/<!--\[if (?:\(?gte mso|mso)[\s\S]*?<!\[endif\]-->/g, "");
      expect(html, t.id).not.toMatch(/<table width="600"/);
    }
  });
});
