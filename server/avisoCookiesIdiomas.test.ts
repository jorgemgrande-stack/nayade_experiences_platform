/**
 * Aviso de cookies por idioma: el español es idéntico al de siempre, el alemán y el inglés dicen lo mismo con sus
 * palabras, sin cookies opcionales solo se informa, y el enlace a la política es el del idioma de la página.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { cookieBody, type CookieCategories } from "../shared/cookieCategories";
import { COOKIE_UI_TEXT, cookieBodyFor, cookieToggleLabel, cookieUiText } from "../shared/cookieTexts";

const cases: CookieCategories[] = [
  { analytics: false, marketing: false, preferences: false },
  { analytics: true, marketing: false, preferences: false },
  { analytics: false, marketing: true, preferences: false },
  { analytics: true, marketing: true, preferences: false },
  { analytics: true, marketing: true, preferences: true },
  { analytics: false, marketing: false, preferences: true },
];

describe("texto principal", () => {
  it("en español es exactamente el de siempre, en todas las combinaciones de categorías", () => {
    for (const c of cases) expect(cookieBodyFor(c, "es")).toBe(cookieBody(c));
  });

  it("sin cookies opcionales: solo se informa, en cada idioma", () => {
    const none = cases[0];
    expect(cookieBodyFor(none, "de")).toMatch(/nur eigene, technisch notwendige Cookies/);
    expect(cookieBodyFor(none, "de")).toMatch(/keine Analyse- oder Werbe-Cookies/);
    expect(cookieBodyFor(none, "en")).toMatch(/only use our own cookies/);
    expect(cookieBodyFor(none, "es")).toMatch(/No usamos cookies de análisis ni de publicidad/);
  });

  it("con cookies opcionales: pide consentimiento, con aceptar o rechazar, sin llaves sin rellenar", () => {
    for (const loc of ["es", "de", "en"]) {
      for (const c of cases.slice(1)) {
        const t = cookieBodyFor(c, loc);
        expect(t, `${loc} ${JSON.stringify(c)}`).not.toMatch(/\{\w+\}/);
        expect(t.length).toBeGreaterThan(60);
      }
    }
    expect(cookieBodyFor(cases[4], "de")).toMatch(/nur mit deiner Einwilligung – eigene Cookies und Drittanbieter-Cookies, um die Nutzung zu analysieren, deine Einstellungen zu merken und dir Werbung/);
    expect(cookieBodyFor(cases[1], "en")).toMatch(/only with your consent, third-party cookies to analyse its use/);
  });

  it("un idioma sin texto usa el español; el código regional se reduce al base", () => {
    expect(cookieUiText("fr").title).toBe(COOKIE_UI_TEXT.es.title);
    expect(cookieUiText("de-AT").title).toBe(COOKIE_UI_TEXT.de.title);
    expect(cookieUiText(undefined).title).toBe(COOKIE_UI_TEXT.es.title);
  });
});

describe("textos de la interfaz", () => {
  it("las tres lenguas tienen las mismas claves, ninguna vacía, y el alemán no repite el español", () => {
    const keys = Object.keys(COOKIE_UI_TEXT.es);
    for (const l of ["de", "en"] as const) {
      expect(Object.keys(COOKIE_UI_TEXT[l]).sort()).toEqual([...keys].sort());
      for (const k of keys) expect((COOKIE_UI_TEXT[l] as Record<string, string>)[k], `${l}.${k}`).toBeTruthy();
    }
    for (const k of ["title", "reject", "accept", "understood", "policy", "savePreferences", "catAnalytics"] as const) expect(COOKIE_UI_TEXT.de[k]).not.toBe(COOKIE_UI_TEXT.es[k]);
  });

  it("las etiquetas accesibles de los interruptores salen en el idioma", () => {
    expect(cookieToggleLabel(COOKIE_UI_TEXT.es, false, "analíticas")).toBe("Activar cookies analíticas");
    expect(cookieToggleLabel(COOKIE_UI_TEXT.es, true, "marketing")).toBe("Desactivar cookies marketing");
    expect(cookieToggleLabel(COOKIE_UI_TEXT.de, false, "analyse")).toBe("Cookies für analyse aktivieren");
    expect(cookieToggleLabel(COOKIE_UI_TEXT.en, true, "preferences")).toBe("Disable preferences cookies");
  });
});

describe("componente", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "client/src/components/CookieBanner.tsx"), "utf8");
  it("usa el idioma de la página y el enlace a la política localizado, y no deja textos en español sueltos", () => {
    expect(src).toContain("cookieUiText(locale)");
    expect(src).toContain('useLegalHref("cookies")');
    expect(src).toContain("<Link href={policyHref}");
    for (const s of ["Más información en nuestra", ">Configurar<", "Guardar preferencias\n", "Siempre activas", "Desactivar cookies analíticas"]) expect(src.replace(/\r\n/g, "\n")).not.toContain(s);
  });
  it("la lógica de consentimiento no cambia: sin opcionales solo informa; con opcionales hay aceptar, rechazar y configurar", () => {
    expect(src).toContain("optional ? handleAcceptAll : handleNecessaryOnly");
    expect(src).toContain("onClick={handleNecessaryOnly}");
    expect(src).toContain("{optional && (");
  });
});
