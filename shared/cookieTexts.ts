/**
 * Textos del aviso de cookies en cada idioma de la web (es, de, en). Solo texto: la lógica (qué categorías existen, cuándo
 * se pide consentimiento) sigue en shared/cookieCategories.ts. Sin traducción propia, un idioma usa el español.
 */
import { hasOptionalCookies, type CookieCategories } from "./cookieCategories";

export interface CookieUiText {
  title: string;
  configure: string;
  policy: string;
  moreInfo: string;
  necessary: string;
  analytics: string;
  marketing: string;
  preferences: string;
  reject: string;
  accept: string;
  understood: string;
  configureButton: string;
  savePreferences: string;
  catNecessary: string;
  catAlwaysOn: string;
  catAnalytics: string;
  catMarketing: string;
  catPreferences: string;
  /** «{n}» = nombre de la categoría: «Activar cookies analíticas» */
  enable: string;
  disable: string;
  /** Solo se informa: sin cookies opcionales */
  bodyNone: string;
  /** Con cookies opcionales: «{owner}» y «{purposes}» */
  bodyOptional: string;
  ownerOwn: string;
  ownerThird: string;
  ownerBoth: string;
  purposeAnalytics: string;
  purposePreferences: string;
  purposeMarketing: string;
  and: string;
}

export const COOKIE_UI_TEXT: Record<"es" | "de" | "en", CookieUiText> = {
  es: {
    title: "Esta web utiliza cookies",
    configure: "elegir cuáles permites",
    policy: "Política de cookies",
    moreInfo: "Más información en nuestra",
    necessary: "Imprescindibles para que la web funcione (sesión, carrito y seguridad). No necesitan tu consentimiento.",
    analytics: "Nos permiten medir cómo se usa la web para mejorarla.",
    marketing: "Permiten mostrarte publicidad adaptada a tus intereses en otras webs y redes sociales.",
    preferences: "Recuerdan tus ajustes, como el idioma o la región.",
    reject: "Rechazar",
    accept: "Aceptar todas",
    understood: "Entendido",
    configureButton: "Configurar",
    savePreferences: "Guardar preferencias",
    catNecessary: "Necesarias",
    catAlwaysOn: "Siempre activas",
    catAnalytics: "Analíticas",
    catMarketing: "Marketing",
    catPreferences: "Preferencias",
    enable: "Activar cookies {n}",
    disable: "Desactivar cookies {n}",
    bodyNone: "Solo usamos cookies propias necesarias para que la web funcione (sesión, carrito y seguridad). No usamos cookies de análisis ni de publicidad.",
    bodyOptional: "Usamos cookies propias necesarias para que la web funcione y, solo si nos das tu consentimiento, cookies {owner} para {purposes}. Puedes aceptarlas, rechazarlas o",
    ownerOwn: "propias",
    ownerThird: "de terceros",
    ownerBoth: "propias y de terceros",
    purposeAnalytics: "analizar su uso",
    purposePreferences: "recordar tus preferencias",
    purposeMarketing: "mostrarte publicidad adaptada a tus intereses",
    and: "y",
  },
  de: {
    title: "Diese Website verwendet Cookies",
    configure: "auswählen, welche du erlaubst",
    policy: "Cookie-Richtlinie",
    moreInfo: "Weitere Informationen in unserer",
    necessary: "Unverzichtbar für den Betrieb der Website (Sitzung, Warenkorb und Sicherheit). Dafür ist keine Einwilligung nötig.",
    analytics: "Helfen uns zu messen, wie die Website genutzt wird, damit wir sie verbessern können.",
    marketing: "Ermöglichen es, dir auf anderen Websites und in sozialen Netzwerken Werbung passend zu deinen Interessen zu zeigen.",
    preferences: "Merken sich deine Einstellungen, etwa Sprache oder Region.",
    reject: "Ablehnen",
    accept: "Alle akzeptieren",
    understood: "Verstanden",
    configureButton: "Einstellen",
    savePreferences: "Auswahl speichern",
    catNecessary: "Notwendige",
    catAlwaysOn: "Immer aktiv",
    catAnalytics: "Analyse",
    catMarketing: "Marketing",
    catPreferences: "Einstellungen",
    enable: "Cookies für {n} aktivieren",
    disable: "Cookies für {n} deaktivieren",
    bodyNone: "Wir verwenden nur eigene, technisch notwendige Cookies, damit die Website funktioniert (Sitzung, Warenkorb und Sicherheit). Wir setzen keine Analyse- oder Werbe-Cookies ein.",
    bodyOptional: "Wir verwenden eigene, technisch notwendige Cookies, damit die Website funktioniert, und – nur mit deiner Einwilligung – {owner}, um {purposes}. Du kannst sie akzeptieren, ablehnen oder",
    ownerOwn: "eigene Cookies",
    ownerThird: "Drittanbieter-Cookies",
    ownerBoth: "eigene Cookies und Drittanbieter-Cookies",
    purposeAnalytics: "die Nutzung zu analysieren",
    purposePreferences: "deine Einstellungen zu merken",
    purposeMarketing: "dir Werbung passend zu deinen Interessen zu zeigen",
    and: "und",
  },
  en: {
    title: "This website uses cookies",
    configure: "choose which ones you allow",
    policy: "Cookie policy",
    moreInfo: "More information in our",
    necessary: "Essential for the website to work (session, cart and security). They do not need your consent.",
    analytics: "They let us measure how the website is used so we can improve it.",
    marketing: "They let us show you ads matched to your interests on other websites and social networks.",
    preferences: "They remember your settings, such as language or region.",
    reject: "Reject",
    accept: "Accept all",
    understood: "Understood",
    configureButton: "Settings",
    savePreferences: "Save preferences",
    catNecessary: "Necessary",
    catAlwaysOn: "Always on",
    catAnalytics: "Analytics",
    catMarketing: "Marketing",
    catPreferences: "Preferences",
    enable: "Enable {n} cookies",
    disable: "Disable {n} cookies",
    bodyNone: "We only use our own cookies that are necessary for the website to work (session, cart and security). We do not use analytics or advertising cookies.",
    bodyOptional: "We use our own cookies that are necessary for the website to work and, only with your consent, {owner} cookies to {purposes}. You can accept them, reject them or",
    ownerOwn: "our own",
    ownerThird: "third-party",
    ownerBoth: "our own and third-party",
    purposeAnalytics: "analyse its use",
    purposePreferences: "remember your preferences",
    purposeMarketing: "show you ads matched to your interests",
    and: "and",
  },
};

export function cookieUiText(locale: string | null | undefined): CookieUiText {
  const base = (locale ?? "").toLowerCase().split("-")[0];
  return (COOKIE_UI_TEXT as Record<string, CookieUiText>)[base] ?? COOKIE_UI_TEXT.es;
}

const fill = (s: string, vars: Record<string, string>) => s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? vars[k] : m));

/** Fórmula del botón de activar/desactivar una categoría, con su nombre en minúscula. */
export function cookieToggleLabel(t: CookieUiText, on: boolean, category: string): string {
  return fill(on ? t.disable : t.enable, { n: category });
}

/** Texto principal del aviso, en el idioma pedido, para las categorías que la web usa de verdad. */
export function cookieBodyFor(c: CookieCategories, locale: string | null | undefined): string {
  const t = cookieUiText(locale);
  if (!hasOptionalCookies(c)) return t.bodyNone;
  const thirdParty = c.analytics || c.marketing;
  const owner = c.preferences && thirdParty ? t.ownerBoth : c.preferences ? t.ownerOwn : t.ownerThird;
  const parts = [c.analytics ? t.purposeAnalytics : null, c.preferences ? t.purposePreferences : null, c.marketing ? t.purposeMarketing : null].filter((p): p is string => !!p);
  const list = parts.length <= 1 ? (parts[0] ?? "") : `${parts.slice(0, -1).join(", ")} ${t.and} ${parts[parts.length - 1]}`;
  return fill(t.bodyOptional, { owner, purposes: list });
}
