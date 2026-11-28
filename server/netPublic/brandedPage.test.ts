/** Página pública con la marca de la empresa: cabeceras, CSP con el origen del logotipo, botón POST y escape. */
import { describe, expect, it } from "vitest";
import type { Response } from "express";
import { minimalKit } from "../brand/tenantVisualKit";
import { brandedPage, brandedPageCsp } from "./brandedPage";

function fakeRes() {
  const headers: Record<string, string> = {};
  const out = { status: 0, body: "", headers };
  const res = {
    status(s: number) { out.status = s; return res; },
    setHeader(k: string, v: string) { headers[k.toLowerCase()] = v; return res; },
    send(b: string) { out.body = b; return res; },
  } as unknown as Response;
  return { res, out };
}

const kit = minimalKit({
  brand: "Quantum Soulrise",
  legalLine: "Birgit Haertle · NIF/CIF Y0604962F",
  siteUrl: "https://quantum.example",
  logoUrl: "https://t12.cdn.example/files/logo.png",
  colors: { primary: "#8f7454", accent: "#b28b4e", ink: "#51483F" },
  pages: { de: { privacy: "/datenschutz", contact: "/kontakt", imprint: "/impressum" }, es: { privacy: "/es/politica-de-privacidad", contact: "/es/contacto" } },
  sitePaths: { es: "/es" },
});

describe("brandedPage", () => {
  it("confirmar (botón POST): idioma, CSP con img-src del logotipo, cabeceras y marca", () => {
    const { res, out } = fakeRes();
    brandedPage(res, 200, kit, { locale: "es", kind: "info", title: "Confirma tu inscripción", text: "Pulsa el botón.", cta: { label: "Confirmar mi inscripción", method: "POST" } });
    expect(out.status).toBe(200);
    expect(out.headers["content-type"]).toContain("text/html");
    expect(out.headers["cache-control"]).toBe("no-store");
    expect(out.headers["x-robots-tag"]).toContain("noindex");
    expect(out.headers["content-security-policy"]).toBe("default-src 'none'; style-src 'unsafe-inline'; img-src 'self' https://t12.cdn.example; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
    expect(out.body).toContain('<html lang="es"');
    expect(out.body).toContain('<form method="post" action=""><button type="submit" class="btn">Confirmar mi inscripción</button></form>');
    expect(out.body).toContain('<img src="https://t12.cdn.example/files/logo.png" alt="Quantum Soulrise"');
    expect(out.body).toContain("NIF/CIF Y0604962F");
    expect(out.body).toContain('href="https://quantum.example/es/politica-de-privacidad">Privacidad</a>');
    expect(out.body).toContain('href="https://quantum.example/es">Volver a Quantum Soulrise</a>');
    expect(out.body).not.toContain("<script");
  });

  it("error con botón GET y texto escapado; en alemán todo en alemán", () => {
    const { res, out } = fakeRes();
    brandedPage(res, 404, kit, { locale: "de", kind: "error", title: "Ungültiger <Link>", text: "Dieser Link ist ungültig & alt.", cta: { label: "Erneut anmelden", url: "https://quantum.example/" } });
    expect(out.status).toBe(404);
    expect(out.body).toContain("Ungültiger &lt;Link&gt;");
    expect(out.body).toContain("ungültig &amp; alt.");
    expect(out.body).toContain('<a class="btn" href="https://quantum.example/">Erneut anmelden</a>');
    expect(out.body).toContain(">Datenschutz</a>");
    expect(out.body).toContain(">Impressum</a>");
    expect(out.body).toContain("Zurück zu Quantum Soulrise");
    expect(out.body).not.toContain("Privacidad");
  });

  it("sin logotipo: nombre en texto y CSP solo con 'self'", () => {
    const plain = minimalKit({ brand: "Casa <Rural>", legalLine: "", siteUrl: "https://casa.example" });
    expect(brandedPageCsp(plain)).toContain("img-src 'self';");
    const { res, out } = fakeRes();
    brandedPage(res, 503, plain, { locale: "en", kind: "warning", title: "Not available", text: "Try again later." });
    expect(out.body).not.toContain("<img");
    expect(out.body).toContain('<span class="name">Casa &lt;Rural&gt;</span>');
    expect(out.body).toContain("Back to Casa &lt;Rural&gt;");
  });
});
