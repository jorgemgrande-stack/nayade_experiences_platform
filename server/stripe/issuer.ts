/**
 * Entidad que factura las suscripciones de Elephant Source (decisión DF-1, confirmada el 18/10/2026).
 *
 *  - La ENTIDAD JURÍDICA (razón social y NIF) es la que figura como emisora en facturas y documentos de
 *    cobro. La MARCA (Big Elephant / Elephant Source) es solo el nombre comercial: nunca la sustituye.
 *  - No son secretos: son datos públicos de la sociedad y se versionan para poder revisarlos.
 *  - Solo identifican al emisor. Ni activan Stripe Tax, ni aplican tipos de IVA, ni emiten facturas
 *    fiscales: eso depende de las decisiones fiscales de docs/elephant-source/FISCALIDAD_STRIPE.md.
 */

export interface Issuer {
  legalName: string;
  /** NIF de la sociedad (CIF): letra de forma jurídica, 7 cifras y carácter de control. */
  taxId: string;
  /** Tipo de identificador fiscal en Stripe (`POST /v1/tax_ids`, emisor de la cuenta). */
  stripeTaxIdType: "es_cif";
  tradeName: string;
  address: { line1: string; line2: string; postalCode: string; city: string; country: "ES" };
  currency: "EUR";
}

export const ISSUER: Issuer = Object.freeze({
  legalName: "IRON ELEPHANT CONSULTING, S.L.",
  taxId: "B26987875",
  stripeTaxIdType: "es_cif",
  tradeName: "Big Elephant / Elephant Source",
  address: Object.freeze({ line1: "Calle Corazón de María, 57", line2: "1.º D", postalCode: "28002", city: "Madrid", country: "ES" as const }),
  currency: "EUR",
}) as Issuer;

const CIF = /^([ABCDEFGHJKLMNPQRSUVW])(\d{7})([0-9A-J])$/;

/**
 * Comprueba el carácter de control de un NIF de persona jurídica (Orden EHA/451/2008).
 * Las formas A, B, E y H llevan cifra de control; K, P, Q, S, N y W, letra; el resto admite ambas.
 */
export function isValidSpanishCif(value: string): boolean {
  const m = CIF.exec(value.trim().toUpperCase());
  if (!m) return false;
  const [, kind, digits, control] = m;
  let sum = 0;
  for (let i = 0; i < 7; i++) {
    const d = Number(digits[i]);
    if (i % 2 === 0) {
      const x = d * 2;
      sum += Math.floor(x / 10) + (x % 10);
    } else sum += d;
  }
  const digit = (10 - (sum % 10)) % 10;
  const letter = "JABCDEFGHI"[digit];
  if ("ABEH".includes(kind)) return control === String(digit);
  if ("KPQSNW".includes(kind)) return control === letter;
  return control === String(digit) || control === letter;
}

/** Línea del emisor para documentos y avisos: razón social y NIF (no la marca). */
export const issuerLine = (i: Issuer = ISSUER) => `${i.legalName} (NIF ${i.taxId})`;

/** Dirección en una línea, como figura en las facturas. */
export const issuerAddress = (i: Issuer = ISSUER) => `${i.address.line1}, ${i.address.line2}, ${i.address.postalCode} ${i.address.city}, España`;

/** Vista para el estado de Stripe y el CRM (sin nada sensible). */
export const describeIssuer = (i: Issuer = ISSUER) => ({ legalName: i.legalName, taxId: i.taxId, tradeName: i.tradeName, address: issuerAddress(i), currency: i.currency });
