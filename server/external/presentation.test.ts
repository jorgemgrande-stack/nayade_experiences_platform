/**
 * Presentación corporativa del contrato: el texto registrado se maqueta sin perder ni cambiar una línea (página y
 * PDF), con la tabla económica, el firmante y la huella; y el PDF sale paginado con el pie del emisor.
 */
import { describe, it, expect } from "vitest";
import { PDFDocument } from "pdf-lib";
import { billingTerms, renderContract, sha256 } from "./document";
import { chargeInstant } from "./schedule";
import { contractBodyHtml, contractPdfBlocks, contractView, presentedFragments, presentedLines, renderContractPdf } from "./presentation";

const CONDITIONS = `Objeto. Big Elephant presta a Nextair SL el servicio tecnológico gestionado SkiNet sobre la plataforma Skicenter, cuya infraestructura es externa a Elephant Source y propiedad o responsabilidad de Nextair SL en los términos acordados.

Servicio en curso. El servicio SkiNet ya está operativo y se viene prestando a la fecha de firma. Este contrato formaliza su prestación y establece su facturación mensual a partir de la mensualidad de noviembre de 2026; no se facturan periodos anteriores.

Alcance. Mantenimiento correctivo y evolutivo, soporte técnico y operación del servicio según lo acordado entre las partes.

Duración y baja. Duración indefinida desde la firma. Cualquiera de las partes puede resolverlo con un preaviso de 30 días naturales, por escrito; la baja surte efecto al final de la mensualidad en curso, sin devolución de la mensualidad ya facturada.

Pago. Cuota mensual por anticipado el día 1 de cada mes mediante el método de pago autorizado en Stripe. El impago no detiene por sí solo la infraestructura del cliente; las partes resolverán las incidencias de cobro de buena fe.`;

const external = { serviceName: "SkiNet — Servicio tecnológico gestionado", amountCents: 100_000, currency: "EUR", taxRateBp: 2100, billingDay: 1, billingHour: 8, timezone: "Europe/Madrid", graceDays: 5, firstChargeAt: chargeInstant("2026-11-01", 8, "Europe/Madrid"), externalRef: "skicenter:nextair" };
const text = renderContract({ contract: { id: 4, reference: "CT-2026-000004", version: 1, conditions: CONDITIONS }, company: { name: "Nextair", legalName: "NEXTAIR SL", taxId: "B16408031" } as never, external: external as never });
const view = contractView(text, { sha256: sha256(text), reference: "CT-2026-000004", version: 1, external, signer: { name: "Victor Manuel Allen Perez", role: "Representante autorizado" }, declaration: "Yo, Victor Manuel Allen Perez, declaro…" });
const unescape = (s: string) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");

describe("presentación corporativa del contrato", () => {
  it("reparte el texto registrado sin perder ni cambiar ninguna línea, y la huella es la del texto", () => {
    expect(presentedLines(view)).toEqual(text.split("\n").filter((l) => l.trim()));
    expect(view.sha256).toBe(sha256(text));
    expect(view.parties.map((p) => p.label)).toEqual(["Prestador", "Cliente", "Referencia del servicio"]);
    expect(view.sections.map((s) => s.heading)).toEqual(["CONDICIONES ECONÓMICAS Y DE COBRO", "CONDICIONES DEL SERVICIO"]);
    expect(view.sections[0].clauses.map((c) => c.text)).toEqual(billingTerms(external));
    expect(view.sections[1].clauses.map((c) => [c.number, c.lead])).toEqual([["2.1", "Objeto."], ["2.2", "Servicio en curso."], ["2.3", "Alcance."], ["2.4", "Duración y baja."], ["2.5", "Pago."]]);
  });

  it("la página muestra cada línea del texto en orden, la tabla económica, el firmante, el emisor y la huella", () => {
    const html = contractBodyHtml(view, { raw: text });
    const visible = unescape(html.replace(/<details[\s\S]*<\/details>/, "").replace(/<\/?b>/g, "").replace(/<[^>]+>/g, "\n"));
    let at = 0;
    for (const l of presentedFragments(view)) {
      const i = visible.indexOf(l, at);
      expect(i, `línea no presentada o fuera de orden: ${l}`).toBeGreaterThanOrEqual(0);
      at = i + 1;
    }
    const flat = (visible + html).replace(/[  ]/g, " ");
    for (const s of ["1.000,00 €", "210,00 €", "1.210,00 €", "IVA 21 %", "01/11/2026", "hasta el día 5", "Victor Manuel Allen Perez", "IRON ELEPHANT CONSULTING, S.L.", "B26987875", view.sha256, "big-elephant-logo.png"]) expect(flat).toContain(s);
    // Sin scripts ni recursos externos salvo el logotipo
    expect(html).not.toMatch(/<script|<iframe|<link /i);
  });

  it("el PDF lleva los mismos bloques y sale paginado, con el título y el emisor", async () => {
    const blocks = contractPdfBlocks(view, { title: "Aceptación electrónica pendiente", lines: ["x"] });
    const texts = blocks.flatMap((b) => (b.kind === "paragraph" ? [b.text] : b.kind === "heading" ? [b.text] : b.kind === "keyValue" ? b.rows.map(([k, v]) => `${k}: ${v}`) : b.kind === "title" ? [b.subtitle ?? ""] : []));
    for (const l of presentedFragments(view)) expect(texts.some((t) => t.split("\n").includes(l) || t === l || t.startsWith(`${l}: `) || t.endsWith(`: ${l}`)), `falta en el PDF: ${l}`).toBe(true);
    const pdf = await renderContractPdf(view, { acceptance: { title: "Aceptación electrónica pendiente", lines: ["Firmante previsto: Victor Manuel Allen Perez."] } });
    expect(Buffer.from(pdf.slice(0, 5)).toString()).toBe("%PDF-");
    const doc = await PDFDocument.load(pdf);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
    expect(doc.getTitle()).toBe("CT-2026-000004 · SkiNet — Servicio tecnológico gestionado");
    expect(doc.getAuthor()).toBe("IRON ELEPHANT CONSULTING, S.L.");
  });

  it("un contrato largo pasa a varias páginas y un símbolo no codificable no rompe el PDF", async () => {
    const long = renderContract({ contract: { id: 9, reference: "CT-9", version: 2, conditions: Array.from({ length: 40 }, (_, i) => `Cláusula ${i + 1}. Texto de prueba suficientemente largo para ocupar varias líneas → con flechas y “comillas”.`).join("\n\n") }, company: { name: "Otra", legalName: "OTRA SL", taxId: null } as never, external: external as never });
    const v = contractView(long, { sha256: sha256(long), reference: "CT-9", version: 2, external });
    expect(presentedLines(v)).toEqual(long.split("\n").filter((l) => l.trim()));
    const doc = await PDFDocument.load(await renderContractPdf(v));
    expect(doc.getPageCount()).toBeGreaterThan(1);
  });
});
