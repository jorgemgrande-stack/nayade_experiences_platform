/**
 * Textos de interfaz que componen los modelos puros de «Suscripción», el aviso de recuperación, el comparador de planes y
 * el escaparate de ampliaciones (`shared/subscriptionHeader.ts`, `subscriptionRecovery.ts`, `planPresentation.ts`,
 * `subscriptionPlans.ts`, `subscriptionCheckout.ts`, `connectMarketplace.ts`, `connectCard.ts`, `netOffer.ts`…).
 *
 * Esos modelos producen español y lo comparten el servidor, las pruebas y el cliente: no cambian. Aquí, igual que en
 * `navLabels.ts` y `studioLabels`, el español es la clave y solo está lo que se traduce. Sin traducción se muestra el
 * español (respaldo). Solo traduce INTERFAZ: nunca contenido de la empresa ni del catálogo publicado (nombres, resúmenes,
 * ventajas o límites de los planes y productos, que son contenido del plano de control).
 *
 * Mecánica:
 *  1. Las fechas en español («9 de diciembre de 2026», con «a las 11:00» si llevan hora) se sustituyen por `{date}` y se
 *     vuelven a escribir en alemán («9. Dezember 2026 um 11:00 Uhr»): el texto con fecha es una sola entrada.
 *  2. Búsqueda exacta del texto completo.
 *  3. Patrones con parámetros (importes, cantidades, nombres).
 *  4. Si no, por frases (los avisos unen frases con un espacio): cada frase se busca por separado.
 */
import type { Locale } from "./core";
import { PANEL_TEXT_DE } from "./panelTextDe";

const MONTHS_ES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const MONTHS_DE = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];

const DATE_RE = new RegExp(`(\\d{1,2}) de (${MONTHS_ES.join("|")}) de (\\d{4})(?: a las (\\d{2}):(\\d{2}))?`, "g");

interface Dated {
  text: string;
  dates: string[];
}

/** Sustituye cada fecha española por `{date}` y devuelve su versión alemana, en orden. */
function extractDates(es: string): Dated {
  const dates: string[] = [];
  const text = es.replace(DATE_RE, (_m, d: string, mo: string, y: string, hh?: string, mm?: string) => {
    const base = `${Number(d)}. ${MONTHS_DE[MONTHS_ES.indexOf(mo)]} ${y}`;
    dates.push(hh ? `${base} um ${hh}:${mm} Uhr` : base);
    return "{date}";
  });
  return { text, dates };
}

const fillDates = (de: string, dates: string[]): string => {
  let i = 0;
  return de.replace(/\{date\}/g, () => dates[i++] ?? "");
};

/** Patrones con parámetros: el texto español completo y su plantilla alemana (`$1`, `$2`…). */
const PATTERNS: Array<[RegExp, string]> = [
  [/^Te quedan (\d+) días$/, "Noch $1 Tage"],
  [/^(.+) \+ IVA$/, "$1 zzgl. MwSt."],
  [/^(.+) al mes \(IVA incluido\), según el precio publicado\.$/, "$1 pro Monat (inkl. MwSt.), laut veröffentlichtem Preis."],
  [/^(.+) al mes \(IVA aparte\), según el precio publicado\.$/, "$1 pro Monat (zzgl. MwSt.), laut veröffentlichtem Preis."],
  [/^Contratar (.+) e iniciar la implantación$/, "$1 buchen und Einführung starten"],
  [/^Se añade a tu plan actual: (.+)\.$/, "Wird zu deinem aktuellen Tarif hinzugefügt: $1."],
  [/^Se contrata con el plan (.+)\.$/, "Wird mit dem Tarif $1 gebucht."],
  [/^Disponible para el plan (.+); no hemos podido comprobar tu plan\.$/, "Verfügbar für den Tarif $1; wir konnten deinen Tarif nicht prüfen."],
  [/^Disponible para el plan (.+)\.$/, "Verfügbar für den Tarif $1."],
  [/^Requiere tener contratado (.+)\.$/, "Erfordert, dass $1 gebucht ist."],
  [/^Contrata tu plan y (.+) en un solo pago; se activa al confirmarse el pago\.$/, "Buche deinen Tarif und $1 in einer einzigen Zahlung; die Aktivierung erfolgt nach Zahlungsbestätigung."],
  [/^(.+) se contrata con el plan (.+): lo dejamos elegido en el formulario de alta\.$/, "$1 wird mit dem Tarif $2 gebucht: Wir haben ihn im Buchungsformular für dich ausgewählt."],
  [/^Hemos marcado (.+) en «Módulos adicionales»\. Revisa el importe y continúa al pago: se activa al confirmarse el pago\.$/, "Wir haben $1 unter «Zusatzmodule» markiert. Prüfe den Betrag und fahre mit der Zahlung fort: Die Aktivierung erfolgt nach Zahlungsbestätigung."],
  [/^(.+) se contrata con el plan (.+), el más bajo compatible: lo hemos elegido por ti\.$/, "$1 wird mit dem Tarif $2 gebucht, dem günstigsten kompatiblen: Wir haben ihn für dich ausgewählt."],
  [/^Me interesa (.+)$/, "Ich interessiere mich für $1"],
  [/^Contactar sobre (.+)$/, "Kontakt zu $1"],
  [/^Solicitar información de (.+)$/, "Informationen zu $1 anfordern"],
  [/^Solicitar el cambio a (.+)$/, "Wechsel zu $1 anfragen"],
  [/^Solicitar la ampliación a (.+)$/, "Upgrade auf $1 anfragen"],
  [/^Solicitar (.+)$/, "$1 anfragen"],
  [/^(IVA incluido|IVA no incluido) \((.+) %\)$/, "#TAX#$1|$2"],
  [/^\/ (mes|año)$/, "#PER#$1"],
  [/^Activo hasta (.+) · renovación cancelada$/, "Aktiv bis $1 · Verlängerung gekündigt"],
  [/^Siguiente intento (.+)$/, "Nächster Versuch $1"],
];

function applyPattern(es: string): string | null {
  for (const [re, tpl] of PATTERNS) {
    const m = re.exec(es);
    if (!m) continue;
    if (tpl.startsWith("#TAX#")) {
      const rate = m[2].replace(/\s/g, " ");
      return `${m[1] === "IVA incluido" ? "inkl. MwSt." : "zzgl. MwSt."} (${rate} %)`;
    }
    if (tpl.startsWith("#PER#")) return m[1] === "mes" ? "/ Monat" : "/ Jahr";
    return tpl.replace(/\$(\d)/g, (_x, n: string) => {
      const part = m[Number(n)] ?? "";
      // Los importes y nombres propios pasan tal cual; la lista de planes («Business o Enterprise») lleva su «o»
      const p2 = re.source.includes("el plan") ? part.replace(/ o /g, " oder ") : part;
      // Fechas numéricas de Madrid (31/12/2026) con el separador alemán
      return p2.replace(/(\d{2})\/(\d{2})\/(\d{4})/g, "$1.$2.$3");
    });
  }
  return null;
}

const SENTENCE_SPLIT = /(?<=[.!?])\s+(?=[A-ZÁÉÍÓÚÑ¿¡«])/;

/** Traduce un texto ya sin fechas; null si alguna parte no tiene traducción. */
function lookup(text: string): string | null {
  const exact = PANEL_TEXT_DE[text];
  if (exact !== undefined) return exact;
  const pat = applyPattern(text);
  if (pat !== null) return pat;
  return null;
}

/** Traduce un texto de interfaz del español al idioma pedido; sin traducción devuelve el español. */
export function panelText(es: string, locale: Locale): string {
  if (locale !== "de" || !es) return es;
  const { text, dates } = extractDates(es);
  const whole = lookup(text);
  if (whole !== null) return fillDates(whole, dates);
  const parts = text.split(SENTENCE_SPLIT);
  if (parts.length < 2) return es;
  let any = false;
  const out = parts.map((p) => {
    const r = lookup(p);
    if (r === null) return p;
    any = true;
    return r;
  });
  return any ? fillDates(out.join(" "), dates) : es;
}

/** Frases de un texto que no tienen traducción alemana (vacío si todo está traducido). Para las pruebas. */
export function panelTextMissing(es: string): string[] {
  const { text } = extractDates(es);
  if (lookup(text) !== null) return [];
  const parts = text.split(SENTENCE_SPLIT);
  return parts.filter((p) => lookup(p) === null);
}
