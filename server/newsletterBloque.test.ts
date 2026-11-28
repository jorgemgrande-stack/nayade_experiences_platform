/**
 * Bloque «Newsletter» del Studio: existe en la biblioteca, nace con los textos sugeridos, sanea lo que llega y la casilla
 * de consentimiento no puede venir premarcada (el formulario público la pinta siempre desmarcada).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createBlock, BLOCK_TYPES, type PageBlock } from "../shared/pageBlocks";
import { moduleDef, LIBRARY_SECTIONS } from "../shared/studio/modules";
import { normalizeBlocks } from "./_core/pageBlocks";

describe("bloque newsletter", () => {
  it("está registrado como módulo y aparece en la biblioteca", () => {
    expect(BLOCK_TYPES).toContain("newsletter");
    const def = moduleDef("newsletter")!;
    expect(def.family).toBe("marketing");
    for (const k of ["title", "intro", "buttonLabel", "consentText", "privacyLabel", "successMessage", "invalidEmailMessage", "noConsentMessage", "errorMessage", "emailLabel", "emailPlaceholder", "tone"]) expect(def.fields.some((f) => f.key === k)).toBe(true);
    expect(LIBRARY_SECTIONS.some((c) => c.types.includes("newsletter"))).toBe(true);
  });
  it("nace con los textos sugeridos por la dirección y es editable (todo son campos de texto del bloque)", () => {
    const b = createBlock("newsletter");
    expect((b.data as { title: string }).title).toBe("Un impulso para tu alma, cada semana.");
    expect((b.data as { intro: string }).intro).toBe("Recibe inspiración, reflexiones y novedades de Indira directamente en tu correo.");
    expect((b.data as { buttonLabel: string }).buttonLabel).toBe("Quiero recibir la newsletter");
  });
  it("sanea el contenido: recorta, descarta valores de aspecto no válidos y no admite HTML en los textos", () => {
    const raw = createBlock("newsletter");
    const dirty = { ...raw, data: { ...raw.data, tone: "neón", title: "<b>Hola</b>".repeat(100), consentText: "x".repeat(900) } } as PageBlock;
    const d = normalizeBlocks([dirty])[0].data as { tone: string; title: string; consentText: string };
    expect(d.tone).toBe("soft");
    expect(d.title.length).toBeLessThanOrEqual(200);
    expect(d.consentText.length).toBeLessThanOrEqual(400);
  });
  it("el formulario público nace con la casilla desmarcada, la exige y manda el texto al servidor para que lo registre", () => {
    const src = readFileSync("client/src/components/site/NewsletterSignup.tsx", "utf8");
    expect(src).toContain("useState(false)"); // consent
    expect(src).toContain("if (!consent)");
    expect(src).not.toMatch(/defaultChecked|checked=\{true\}/);
    expect(src).toContain("/api/newsletter/subscribe");
    expect(src).toContain('name="website"'); // campo trampa
    expect(src).toContain("elapsedMs");
  });
});
