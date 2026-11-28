/** Maqueta de correo con la marca de la empresa: idioma, logotipo, botón, pie legal, baja y escape. */
import { describe, expect, it } from "vitest";
import { minimalKit } from "../brand/tenantVisualKit";
import { renderBrandedEmail } from "./brandedLayout";

const kit = minimalKit({
  brand: "Quantum Soulrise",
  legalLine: "Birgit Haertle · NIF/CIF Y0604962F · Caril Juan Ortiz s/n · indira@yoga-soulretreat.com",
  siteUrl: "https://quantum.example",
  logoUrl: "https://cdn.example/logo.png",
  colors: { primary: "#8f7454", accent: "#b28b4e", ink: "#51483F" },
  pages: { de: { privacy: "/datenschutz", contact: "/kontakt", imprint: "/impressum" }, es: { privacy: "/es/politica-de-privacidad", contact: "/es/contacto" } },
  sitePaths: { es: "/es" },
});

describe("renderBrandedEmail", () => {
  const m = renderBrandedEmail(kit, {
    locale: "es",
    subject: "Confirma tu inscripción",
    eyebrow: "Newsletter",
    title: "Confirma tu inscripción",
    paragraphs: ["Hola,\nte escribimos.", "Pulsa <script>alert(1)</script> el botón."],
    cta: { label: "Confirmar", url: "https://quantum.example/newsletter/confirmar/TOKEN" },
    note: "El enlace caduca en 48 horas.",
    footerNotes: ["Recibes este correo porque te inscribiste."],
    unsubscribe: { label: "Darme de baja", url: "https://quantum.example/newsletter/baja/1.abc" },
  });

  it("idioma, logotipo con alt y colores de la empresa", () => {
    expect(m.html).toContain('<html lang="es"');
    expect(m.html).toContain('<img src="https://cdn.example/logo.png" alt="Quantum Soulrise"');
    expect(m.html).toContain("background-color:#f6f4f1");
    expect(m.html).toContain("background-color:#8f7454;color:#ffffff");
    expect(m.html).toContain('<meta name="viewport"');
    expect(m.html).toContain("<!--[if mso]>");
  });

  it("botón con la URL, ayuda con el enlace en texto y nota", () => {
    expect(m.html).toContain('href="https://quantum.example/newsletter/confirmar/TOKEN"');
    expect(m.html).toContain("Si el botón no funciona, copia este enlace");
    expect(m.html).toContain("El enlace caduca en 48 horas.");
  });

  it("pie: legal, enlaces en el idioma del correo y baja", () => {
    expect(m.html).toContain("NIF/CIF Y0604962F");
    expect(m.html).toContain('href="https://quantum.example/es/politica-de-privacidad"');
    expect(m.html).toContain(">Privacidad<");
    expect(m.html).toContain('href="https://quantum.example/es"');
    expect(m.html).not.toContain("/impressum");
    expect(m.html).toContain('href="https://quantum.example/newsletter/baja/1.abc"');
    expect(m.html).toContain(">Darme de baja<");
  });

  it("escapa el contenido variable y pasa saltos simples a <br>", () => {
    expect(m.html).not.toContain("<script>");
    expect(m.html).toContain("&lt;script&gt;");
    expect(m.html).toContain("Hola,<br />te escribimos.");
  });

  it("texto alternativo completo con las URLs", () => {
    expect(m.text).toContain("Confirmar: https://quantum.example/newsletter/confirmar/TOKEN");
    expect(m.text).toContain("Darme de baja: https://quantum.example/newsletter/baja/1.abc");
    expect(m.text).toContain("NIF/CIF Y0604962F");
    expect(m.text).toContain("Pulsa <script>alert(1)</script> el botón.");
  });

  it("sin logotipo: el nombre en texto, escapado; en alemán los enlaces del pie en alemán", () => {
    const plain = minimalKit({ brand: "Quantum <X>", legalLine: "S.L. · CIF B1", siteUrl: "https://q.example", pages: { "*": { privacy: "/datenschutz" } } });
    const r = renderBrandedEmail(plain, { locale: "de", subject: "Willkommen", title: "Willkommen", paragraphs: ["Hallo"] });
    expect(r.html).not.toContain("<img");
    expect(r.html).toContain("Quantum &lt;X&gt;");
    expect(r.html).toContain('<html lang="de"');
    expect(r.html).toContain(">Datenschutz<");
    expect(r.html).toContain(">Website<");
    expect(r.html).toContain("color:#2b2622");
    expect(r.html).not.toContain("#8f7454");
  });

  it("una URL que no es http(s) no acaba en el href", () => {
    const r = renderBrandedEmail(kit, { locale: "en", subject: "x", title: "x", cta: { label: "Go", url: "javascript:alert(1)" } });
    expect(r.html).not.toContain('href="javascript:');
  });
});
