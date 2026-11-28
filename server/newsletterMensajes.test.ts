/** Mensajes del formulario de newsletter: nunca en español en una web alemana o inglesa. */
import { describe, expect, it } from "vitest";
import { NEWSLETTER_MESSAGES, newsletterLang, newsletterMessage, type NewsletterMsgKey } from "../shared/newsletterMessages";

const KEYS = Object.keys(NEWSLETTER_MESSAGES.es) as NewsletterMsgKey[];

describe("newsletter · mensajes por idioma", () => {
  it("los tres idiomas tienen todos los textos y los de alemán e inglés no son el español", () => {
    for (const l of ["de", "en"] as const) for (const k of KEYS) {
      expect(NEWSLETTER_MESSAGES[l][k], `${l}.${k}`).toBeTruthy();
      expect(NEWSLETTER_MESSAGES[l][k], `${l}.${k}`).not.toBe(NEWSLETTER_MESSAGES.es[k]);
    }
  });
  it("el texto del bloque manda; el español de fábrica guardado en el bloque se sustituye en alemán e inglés", () => {
    expect(newsletterMessage("de", "invalidEmailMessage", "Eigener Text")).toBe("Eigener Text");
    expect(newsletterMessage("de", "invalidEmailMessage", NEWSLETTER_MESSAGES.es.invalidEmailMessage)).toBe(NEWSLETTER_MESSAGES.de.invalidEmailMessage);
    expect(newsletterMessage("en", "errorMessage", "")).toBe(NEWSLETTER_MESSAGES.en.errorMessage);
    expect(newsletterMessage("es", "invalidEmailMessage", NEWSLETTER_MESSAGES.es.invalidEmailMessage)).toBe(NEWSLETTER_MESSAGES.es.invalidEmailMessage);
  });
  it("idioma desconocido o ausente: alemán (idioma principal de la web)", () => {
    expect(newsletterLang(undefined)).toBe("de");
    expect(newsletterLang("fr")).toBe("de");
    expect(newsletterLang("EN-us")).toBe("en");
  });
});
