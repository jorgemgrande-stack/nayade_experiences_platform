/**
 * Condiciones aceptadas, idioma y participantes del pedido de la tienda (lógica de BD). Ver shared/checkoutExtras.ts.
 *
 *  - `getCheckoutConfig`: ajustes de la empresa (direcciones de condiciones, interruptores). Sin ellos, nada se exige.
 *  - `assertConsentAccepted`: el servidor exige la casilla ANTES de crear el pedido solo si la empresa lo ha configurado.
 *  - `recordCheckoutExtras`: guarda aceptación (fecha, huella del texto, IP), idioma y participantes en el historial de
 *    cada línea del pedido (sin columnas nuevas).
 *  - `resolveBuyerLocale`: idioma de los correos: el de quien compró; si no consta, el principal de la empresa.
 */
import { createHash } from "crypto";
import { eq, inArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { getDb } from "./db";
import { reservations, systemSettings } from "../drizzle/schema";
import { siteUiText, SITE_UI_TEXT } from "../shared/siteUiText";
import {
  CHECKOUT_SETTINGS,
  DEFAULT_CHECKOUT_CONFIG,
  checkoutConfigFrom,
  cleanParticipants,
  consentLogEntry,
  consentSentenceText,
  localeFromLog,
  localeLogEntry,
  normalizeBuyerLocale,
  participantsLogEntry,
  type CheckoutConfig,
  type OrderConsent,
} from "../shared/checkoutExtras";

export async function getCheckoutConfig(): Promise<CheckoutConfig> {
  try {
    const db = await getDb();
    if (!db) return DEFAULT_CHECKOUT_CONFIG;
    const rows = await db.select({ key: systemSettings.key, value: systemSettings.value }).from(systemSettings).where(inArray(systemSettings.key, Object.values(CHECKOUT_SETTINGS)));
    return checkoutConfigFrom(Object.fromEntries(rows.map((r) => [r.key, r.value])));
  } catch {
    // Sin poder leer los ajustes (o sin ellos aún): comportamiento de siempre
    return DEFAULT_CHECKOUT_CONFIG;
  }
}

/** Idioma de la interfaz para un código dado: solo los que tiene el diccionario; si no, español. */
export function uiLocaleOf(raw: unknown): string {
  const l = normalizeBuyerLocale(raw);
  const base = l?.split("-")[0] ?? "es";
  return Object.prototype.hasOwnProperty.call(SITE_UI_TEXT, base) ? base : "es";
}

/** Con la aceptación exigida y sin aceptar, el pago no se inicia (ni se crea el pedido). */
export function assertConsentAccepted(cfg: CheckoutConfig, accepted: boolean | undefined, locale: unknown): void {
  if (cfg.consentRequired && !accepted) {
    throw new TRPCError({ code: "BAD_REQUEST", message: siteUiText(uiLocaleOf(locale)).coConsentMissing });
  }
}

export function buildConsent(cfg: CheckoutConfig, locale: unknown, ip: string | null, now = Date.now()): OrderConsent {
  const lang = uiLocaleOf(locale);
  const text = consentSentenceText(cfg, siteUiText(lang));
  const urls = { ...(cfg.termsUrl ? { terms: cfg.termsUrl } : {}), ...(cfg.privacyUrl ? { privacy: cfg.privacyUrl } : {}), ...(cfg.cancellationUrl ? { cancellation: cfg.cancellationUrl } : {}) };
  const textHash = createHash("sha256").update(JSON.stringify({ text, urls })).digest("hex");
  return { text, textHash, locale: lang, acceptedAt: now, ip, urls };
}

export interface CheckoutExtrasInput {
  locale: string | null;
  consent: OrderConsent | null;
  /** Nombres por línea del carrito, en el orden en que se crearon las líneas del pedido. */
  participantsByLine: Array<string[] | undefined>;
  quantities: number[];
}

export async function recordCheckoutExtras(merchantOrder: string, x: CheckoutExtrasInput): Promise<void> {
  const nothing = !x.locale && !x.consent && !x.participantsByLine.some((p) => p?.length);
  if (nothing) return;
  const db = await getDb();
  if (!db) return;
  const rows = (await db.select({ id: reservations.id, changesLog: reservations.changesLog }).from(reservations).where(eq(reservations.merchantOrder, merchantOrder))).sort((a, b) => a.id - b.id);
  const now = Date.now();
  for (let i = 0; i < rows.length; i++) {
    const extra: Array<ReturnType<typeof localeLogEntry>> = [];
    if (x.locale) extra.push(localeLogEntry(x.locale, now));
    if (x.consent) extra.push(consentLogEntry(x.consent));
    const names = cleanParticipants(x.participantsByLine[i], x.quantities[i] ?? 0);
    if (names.length) extra.push(participantsLogEntry(names, now));
    if (!extra.length) continue;
    const log = Array.isArray(rows[i].changesLog) ? rows[i].changesLog! : [];
    await db.update(reservations).set({ changesLog: [...log, ...extra] }).where(eq(reservations.id, rows[i].id));
  }
}

/** Idioma de los correos de un pedido: el guardado al comprar; si no, el principal de la empresa; si no, español. */
export async function resolveBuyerLocale(changesLog: unknown): Promise<string> {
  const stored = localeFromLog(changesLog);
  if (stored) return uiLocaleOf(stored);
  try {
    const { isMultiTenant } = await import("./_core/tenant");
    if (!isMultiTenant()) return "es";
    const [{ getI18nConfig }, { sqlI18nRepo }] = await Promise.all([import("./i18nService"), import("./i18nSqlRepo")]);
    return uiLocaleOf((await getI18nConfig(sqlI18nRepo())).defaultLocale);
  } catch {
    return "es";
  }
}
