/**
 * Pago de la tienda: aceptación de condiciones (solo si la empresa la configura), idioma de quien compra, participantes
 * y datos opcionales en el correo. Sin base de datos: lógica pura y plantillas.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SITE_UI_TEXT, siteUiText } from "../shared/siteUiText";
import {
  DEFAULT_CHECKOUT_CONFIG,
  checkoutConfigFrom,
  cleanParticipants,
  consentFromLog,
  consentItems,
  consentLogEntry,
  consentSentenceParts,
  consentSentenceText,
  localeFromLog,
  localeLogEntry,
  participantsFromLog,
  participantsLogEntry,
  safeLegalUrl,
} from "../shared/checkoutExtras";
import { checkoutErrorMessage, stageEmailText, validateBuyer } from "../shared/shopOrders";
import { LEGACY_SITE_FEATURES, publicSiteText } from "../shared/publicSite";
import { FALLBACK_GENERIC_STOREFRONT, buildGenericCartLine } from "../shared/storefront";
import { buildNoticeHtml, buildShopOrderEmailHtml } from "./emailTemplates";
import { assertConsentAccepted, buildConsent, uiLocaleOf } from "./checkoutExtrasDb";

const ES = siteUiText("es");
const DE = siteUiText("de");

describe("diccionario del carrito, el pago y los correos", () => {
  it("es, de y en tienen exactamente las mismas claves", () => {
    const keys = (l: keyof typeof SITE_UI_TEXT) => Object.keys(SITE_UI_TEXT[l]).sort();
    expect(keys("de")).toEqual(keys("es"));
    expect(keys("en")).toEqual(keys("es"));
  });
  it("ningún texto de las claves nuevas queda vacío y las variables coinciden entre idiomas", () => {
    const vars = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(",");
    for (const k of Object.keys(SITE_UI_TEXT.es) as Array<keyof typeof SITE_UI_TEXT.es>) {
      if (!/^(co|em)[A-Z]/.test(k) && k !== "participants") continue;
      for (const l of ["es", "de", "en"] as const) {
        const v = SITE_UI_TEXT[l][k] as string;
        expect(v.trim().length, `${l}.${k}`).toBeGreaterThan(0);
        expect(vars(v), `${l}.${k}`).toBe(vars(SITE_UI_TEXT.es[k] as string));
      }
    }
  });
  it("el fallo de pago no habla del banco (también vale para las cancelaciones de Stripe)", () => {
    expect(ES.coErrFailedHelp.toLowerCase()).not.toContain("banco");
    expect(ES.coPaymentNotCompletedHelp.toLowerCase()).not.toContain("banco");
    expect(ES.coErrRejected.toLowerCase()).toContain("tarjeta");
  });
});

describe("textos en el idioma de quien compra", () => {
  it("el español de siempre no cambia sin idioma", () => {
    const base = publicSiteText(LEGACY_SITE_FEATURES);
    expect(base.quantity(2)).toBe("2 personas");
    expect(publicSiteText(null).quantity(1)).toBe("1 unidad");
    expect(publicSiteText(LEGACY_SITE_FEATURES, "es").cartCount(2)).toBe("2 experiencias seleccionadas");
    expect(checkoutErrorMessage({ code: "TOO_MANY_REQUESTS" })).toBe("Has hecho demasiados intentos seguidos. Espera un minuto y vuelve a intentarlo.");
    expect(validateBuyer({ name: "", email: "", wantsInvoice: false }).name).toBe("Escribe tu nombre y apellidos.");
    expect(stageEmailText("delivered")?.subject).toBe("Tu pedido consta como entregado");
  });
  it("en alemán salen carrito, errores de validación y avisos de estado", () => {
    expect(publicSiteText(null, "de").quantity(2)).toBe("2 Stück");
    expect(publicSiteText(LEGACY_SITE_FEATURES, "de-AT").quantity(2)).toBe("2 Personen");
    expect(publicSiteText(null, "de").cartCount(3)).toBe("3 Artikel im Warenkorb");
    expect(checkoutErrorMessage({ code: "NOT_FOUND" }, "de")).toBe(DE.coErrNotFound);
    const e = validateBuyer({ name: "A", email: "no", phone: "1", wantsInvoice: true, nif: "" }, "de");
    expect(e.name).toBe(DE.coErrName);
    expect(e.email).toBe(DE.invalidEmail);
    expect(e.nif).toBe(DE.coErrTaxIdMissing);
    expect(stageEmailText("cancelled", "de")?.title).toBe("Bestellung storniert");
  });
  it("un idioma sin traducción cae en español", () => {
    expect(uiLocaleOf("fr")).toBe("es");
    expect(uiLocaleOf("de-AT")).toBe("de");
    expect(uiLocaleOf(undefined)).toBe("es");
    expect(publicSiteText(null, "fr").quantity(2)).toBe("2 unidades");
  });
  it("la cantidad de una actividad se llama «participantes»", () => {
    expect(ES.participants).toBe("Participantes");
    expect(DE.participants).toBe("Teilnehmende");
    const base = { id: 1, title: "Retiro", slug: "retiro", basePrice: 100, coverImageUrl: null, image1: null };
    const input = (productType: string) => ({ product: { ...base, productType }, variant: undefined, quantity: 2, date: "", storefront: FALLBACK_GENERIC_STOREFRONT });
    const act = buildGenericCartLine(input("actividad"), []);
    const own = buildGenericCartLine(input("own"), []);
    expect(act.ok && act.line.quantityKind).toBe("participants");
    expect(own.ok && own.line.quantityKind).toBeUndefined();
  });
});

describe("aceptación de condiciones", () => {
  it("sin configuración no se exige nada (Náyade, Skicenter…)", () => {
    expect(checkoutConfigFrom({})).toEqual(DEFAULT_CHECKOUT_CONFIG);
    expect(checkoutConfigFrom({ checkout_terms_url: "", checkout_consent_required: "false" }).consentRequired).toBe(false);
    expect(() => assertConsentAccepted(DEFAULT_CHECKOUT_CONFIG, undefined, "es")).not.toThrow();
    expect(() => assertConsentAccepted(DEFAULT_CHECKOUT_CONFIG, false, "de")).not.toThrow();
  });
  it("con una dirección configurada, o el interruptor, se exige y el servidor rechaza sin marcar (en el idioma de la persona)", () => {
    const withUrl = checkoutConfigFrom({ checkout_terms_url: "/condiciones" });
    const withFlag = checkoutConfigFrom({ checkout_consent_required: "true" });
    expect(withUrl.consentRequired).toBe(true);
    expect(withFlag.consentRequired).toBe(true);
    expect(() => assertConsentAccepted(withUrl, undefined, "es")).toThrow(ES.coConsentMissing);
    expect(() => assertConsentAccepted(withUrl, false, "de")).toThrow(DE.coConsentMissing);
    expect(() => assertConsentAccepted(withUrl, true, "de")).not.toThrow();
  });
  it("solo se aceptan direcciones propias o http(s): nunca javascript:", () => {
    expect(safeLegalUrl("/condiciones")).toBe("/condiciones");
    expect(safeLegalUrl("https://empresa.example/terms")).toBe("https://empresa.example/terms");
    expect(safeLegalUrl("javascript:alert(1)")).toBe("");
    expect(safeLegalUrl("//otro.example/x")).toBe("");
    expect(checkoutConfigFrom({ checkout_privacy_url: "javascript:alert(1)" }).consentRequired).toBe(false);
  });
  it("la frase enseña solo lo que tiene dirección; sin direcciones, las tres cosas sin enlace", () => {
    const cfg = checkoutConfigFrom({ checkout_terms_url: "/condiciones", checkout_cancellation_url: "/cancelacion" });
    expect(consentItems(cfg, ES).map((i) => i.kind)).toEqual(["terms", "cancellation"]);
    expect(consentSentenceText(cfg, ES)).toBe("He leído y acepto las condiciones de compra y las condiciones de cancelación.");
    expect(consentSentenceText(cfg, DE)).toBe("Ich habe die Kaufbedingungen und die Stornobedingungen gelesen und akzeptiere sie.");
    const parts = consentSentenceParts(cfg, ES);
    expect(parts.filter((p) => p.href).map((p) => p.href)).toEqual(["/condiciones", "/cancelacion"]);
    expect(parts.map((p) => p.text).join("")).toBe(consentSentenceText(cfg, ES));
    const flagOnly = checkoutConfigFrom({ checkout_consent_required: "true" });
    expect(consentItems(flagOnly, ES)).toHaveLength(3);
    expect(consentSentenceParts(flagOnly, ES).every((p) => !p.href)).toBe(true);
  });
  it("el consentimiento guardado lleva fecha, idioma, IP, texto exacto y huella estable", () => {
    const cfg = checkoutConfigFrom({ checkout_terms_url: "/condiciones", checkout_privacy_url: "/privacidad" });
    const a = buildConsent(cfg, "de", "203.0.113.7", 1_700_000_000_000);
    const b = buildConsent(cfg, "de", "198.51.100.1", 1_800_000_000_000);
    expect(a.text).toBe(consentSentenceText(cfg, DE));
    expect(a.locale).toBe("de");
    expect(a.ip).toBe("203.0.113.7");
    expect(a.acceptedAt).toBe(1_700_000_000_000);
    expect(a.textHash).toMatch(/^[0-9a-f]{64}$/);
    expect(b.textHash).toBe(a.textHash);
    expect(buildConsent(cfg, "es", null).textHash).not.toBe(a.textHash);
    const log = [{ ts: 1, actor: "x", action: "otra" }, consentLogEntry(a)];
    expect(consentFromLog(log)).toEqual(a);
    expect(consentFromLog([])).toBeNull();
    expect(consentFromLog("nada")).toBeNull();
  });
});

describe("idioma y participantes del pedido", () => {
  it("el idioma se guarda y se lee del historial", () => {
    expect(localeFromLog([localeLogEntry("de", 1)])).toBe("de");
    expect(localeFromLog([{ ts: 1, actor: "x", action: "idioma_comprador", to: "no es un idioma" }])).toBeNull();
    expect(localeFromLog(null)).toBeNull();
  });
  it("los participantes se limpian, se recortan a la cantidad y no son obligatorios", () => {
    expect(cleanParticipants(["  Ana  López ", "", "Luis", "Eva"], 2)).toEqual(["Ana López", "Luis"]);
    expect(cleanParticipants(undefined, 3)).toEqual([]);
    expect(cleanParticipants(["a"], 0)).toEqual([]);
    expect(participantsFromLog([participantsLogEntry(["Ana", "Luis"], 1)])).toEqual(["Ana", "Luis"]);
    expect(participantsFromLog([])).toEqual([]);
  });
});

describe("correos del pedido", () => {
  const base = { title: ES.emConfirmedTitle, customerName: "Anna", orderNumber: "PED-1", intro: "x", total: "48,40 €" };
  it("sin idioma ni datos extra, el correo de siempre en español", () => {
    const html = buildShopOrderEmailHtml({ ...base, lines: [{ name: "Retiro", quantity: 2, total: "48,40 €" }] });
    expect(html).toContain("Hola <strong>Anna</strong>,");
    expect(html).toContain("Cantidad");
    expect(html).toContain("Total (IVA incluido)");
    expect(html).not.toContain("Participantes:");
    expect(html).not.toContain("Fecha:");
    expect(html).not.toContain("Punto de encuentro:");
  });
  it("renderiza en alemán con fecha, edición, punto de encuentro y participantes cuando existen", () => {
    const html = buildShopOrderEmailHtml({
      ...base,
      locale: "de",
      title: DE.emConfirmedTitle,
      lines: [{ name: "Retreat", quantity: 2, total: "48,40 €", date: "Montag, 3. August 2026", edition: "Sommer 2026", meetingPoint: "Hauptplatz", participants: ["Anna", "Ben <b>"] }],
    });
    expect(html).toContain("Hallo <strong>Anna</strong>,");
    expect(html).toContain("Menge");
    expect(html).toContain("Gesamt (inkl. MwSt.)");
    expect(html).toContain("Datum:");
    expect(html).toContain("Montag, 3. August 2026");
    expect(html).toContain("Termin:");
    expect(html).toContain("Treffpunkt:");
    expect(html).toContain("Hauptplatz");
    expect(html).toContain("Teilnehmende:");
    expect(html).toContain("Anna, Ben &lt;b&gt;");
    expect(html).not.toContain("Hola");
  });
  it("cada campo opcional se oculta por separado", () => {
    const html = buildShopOrderEmailHtml({ ...base, lines: [{ name: "Retiro", quantity: 1, total: "1 €", meetingPoint: "Plaza" }] });
    expect(html).toContain("Punto de encuentro:");
    expect(html).not.toContain("Edición:");
  });
  it("el aviso de formación sale en alemán con su saludo y su enlace alternativo", () => {
    const html = buildNoticeHtml({ title: DE.emLearnInviteTitle, greetingName: "Anna", paragraphs: ["x"], cta: { label: DE.emLearnInviteCta, url: "https://x.example/a" }, locale: "de" });
    expect(html).toContain("Hallo <strong>Anna</strong>,");
    expect(html).toContain("Falls die Schaltfläche nicht funktioniert");
  });
});

describe("pago del cliente y migración", () => {
  const read = (p: string) => fs.readFileSync(path.resolve(__dirname, "..", p), "utf8");
  it("la casilla solo aparece con la configuración de la empresa, es obligatoria y viaja al servidor", () => {
    const code = read("client/src/pages/Checkout.tsx");
    expect(code).toContain("{cfg.consentRequired && (");
    expect(code).toContain('data-testid="checkout-consent"');
    expect(code).toContain("if (cfg.consentRequired && !consent) errs.consent = t.coConsentMissing;");
    expect(code).toContain("consentAccepted: cfg.consentRequired ? consent : undefined");
    expect(code).toContain("locale,");
    // Participantes: solo con el ajuste activo y cantidad mayor que 1; nunca obligatorios
    expect(code).toContain("cfg.participantsEnabled && i.people > 1");
    expect(code).not.toMatch(/errs\.participants/);
    expect(code).not.toMatch(/\btruncate\b/);
  });
  it("el servidor exige la casilla antes de crear el pedido y guarda el consentimiento", () => {
    const routers = read("server/routers.ts");
    const i = routers.indexOf("checkoutExtras.assertConsentAccepted");
    expect(i).toBeGreaterThan(0);
    expect(i).toBeLessThan(routers.indexOf("merchantOrder = generateMerchantOrder();", i));
    expect(routers).toContain("checkoutExtras.recordCheckoutExtras(merchantOrder");
  });
  it("la migración solo añade ajustes vacíos (INSERT IGNORE), sin tocar el esquema", () => {
    const sql = read("db/migrations/0087_checkout_conditions_settings.sql").replace(/--.*$/gm, "");
    expect(sql).toMatch(/INSERT IGNORE INTO `system_settings`/);
    expect(sql).not.toMatch(/\b(ALTER|DROP|DELETE|UPDATE|TRUNCATE)\b/i);
    for (const k of ["checkout_terms_url", "checkout_privacy_url", "checkout_cancellation_url", "checkout_consent_required", "checkout_participants_enabled"]) expect(sql).toContain(`'${k}'`);
    // Sin valores por defecto que activen nada
    expect(sql).toContain("'checkout_consent_required', 'false'");
    expect(sql).toContain("'checkout_participants_enabled', 'false'");
  });
});
