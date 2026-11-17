/**
 * Botón flotante de WhatsApp configurable por empresa (17/11/2026, Quantum Soulrise): número internacional (antes se
 * perdía cualquier WhatsApp de fuera de España), activo o no, posición y mensaje inicial por idioma de la página.
 */
import { describe, expect, it } from "vitest";
import { buildTheme } from "./_core/theme";
import { DEFAULT_WHATSAPP_BUTTON, parseWhatsappButtonConfig, whatsappHidden, whatsappLabel, whatsappMessageFor, whatsappTarget, WHATSAPP_AVOID_SELECTOR } from "../shared/whatsappButton";
import { whatsappButtonInput } from "./routers/whatsappButton";

const themeOf = (s: Record<string, string>, multi = true) => buildTheme((k) => s[k] || undefined, { multi });
const DE = "Hallo Indira, ich habe deine Website Quantum Soulrise besucht und möchte gerne mehr Informationen erhalten.";
const ES = "Hola Indira, he visitado tu web Quantum Soulrise y me gustaría recibir más información.";
const QUANTUM = { brand_name: "Quantum Soulrise", brand_whatsapp: "+491742013503", whatsapp_button: JSON.stringify({ enabled: true, position: "right", messages: { de: DE, es: ES } }) };

describe("botón de WhatsApp configurable", () => {
  it("número alemán: el tema lo entrega normalizado y el botón ya no lo descarta", () => {
    const t = themeOf({ brand_name: "Quantum Soulrise", brand_whatsapp: "+491742013503" });
    expect(t.contact.whatsapp).toBe("491742013503");
    expect(whatsappTarget(t)?.phone).toBe("491742013503");
  });

  it("mensaje inicial según el idioma de la página; wa.me con el número correcto y sin envío automático", () => {
    const t = themeOf(QUANTUM);
    const de = whatsappTarget(t, "de")!;
    expect(de.url).toBe(`https://wa.me/491742013503?text=${encodeURIComponent(DE)}`);
    expect(decodeURIComponent(whatsappTarget(t, "es")!.url)).toContain(ES);
    expect(whatsappMessageFor(t.whatsappButton, "de-AT")).toBe(DE);
    // Un idioma sin mensaje propio: el texto general
    expect(decodeURIComponent(whatsappTarget(t, "en")!.url)).toContain("Hola Quantum Soulrise, me gustaría recibir información");
    expect(de.position).toBe("right");
  });

  it("desactivado o sin número: sin botón; posición a la izquierda si se elige", () => {
    expect(whatsappTarget(themeOf({ ...QUANTUM, whatsapp_button: JSON.stringify({ enabled: false }) }), "de")).toBeNull();
    expect(whatsappTarget(themeOf({ brand_name: "X", whatsapp_button: JSON.stringify({ enabled: true }) }), "de")).toBeNull();
    expect(whatsappTarget(themeOf({ ...QUANTUM, whatsapp_button: JSON.stringify({ position: "left" }) }), "de")!.position).toBe("left");
  });

  it("sin ajuste (las demás empresas): como hasta ahora", () => {
    expect(themeOf({ brand_name: "Costa", brand_whatsapp: "+34 622 000 111" }).whatsappButton).toEqual(DEFAULT_WHATSAPP_BUTTON);
    expect(decodeURIComponent(whatsappTarget(themeOf({ brand_name: "Costa", brand_whatsapp: "+34 622 000 111" }), "es")!.url)).toBe("https://wa.me/34622000111?text=Hola Costa, me gustaría recibir información");
    // Náyade (single): sin ajuste propio en el tema
    expect(themeOf({}, false).whatsappButton).toBeNull();
  });

  it("lectura defensiva del ajuste y validación de lo que se guarda", () => {
    expect(parseWhatsappButtonConfig("{roto")).toEqual(DEFAULT_WHATSAPP_BUTTON);
    expect(parseWhatsappButtonConfig(JSON.stringify({ position: "arriba", messages: { "<x>": "a", es: "  hola  ", de: 3 } }))).toEqual({ enabled: true, position: "right", messages: { es: "hola" } });
    expect(whatsappButtonInput.safeParse({ enabled: true, whatsapp: "+491742013503", position: "right", messages: { de: DE, es: ES } }).success).toBe(true);
    expect(whatsappButtonInput.safeParse({ enabled: true, whatsapp: "+491742013503", position: "top", messages: {} }).success).toBe(false);
    expect(whatsappButtonInput.safeParse({ enabled: true, whatsapp: "+491742013503", position: "right", messages: { de: "x".repeat(301) } }).success).toBe(false);
  });

  it("etiqueta accesible en el idioma de la página", () => {
    expect([whatsappLabel("de"), whatsappLabel("es"), whatsappLabel("de-CH"), whatsappLabel("xx")]).toEqual(["Über WhatsApp kontaktieren", "Contactar por WhatsApp", "Über WhatsApp kontaktieren", "Contactar por WhatsApp"]);
  });

  it("en móvil se aparta de formularios y botones de envío; en escritorio no se oculta", () => {
    expect(WHATSAPP_AVOID_SELECTOR).toContain('form button[type="submit"]');
    const btn = { left: 300, top: 600, right: 352, bottom: 652 };
    expect(whatsappHidden(btn, [{ left: 0, top: 590, right: 360, bottom: 640 }], 390)).toBe(true);
    expect(whatsappHidden(btn, [{ left: 0, top: 590, right: 360, bottom: 640 }], 1280)).toBe(false);
  });
});
