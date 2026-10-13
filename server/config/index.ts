import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { featureFlags, systemSettings } from "../../drizzle/schema";
import { TenantCache } from "../_core/tenantScope";
import { getTenantMode } from "../_core/tenant";

// ─── In-memory cache (60s TTL) ────────────────────────────────────────────────

// Una caché por tenant: nunca se comparten valores entre empresas (ver _core/tenantScope).
const CACHE_TTL_MS = 60_000;
const settingsCache = new TenantCache<string | null>(CACHE_TTL_MS);
const flagsCache = new TenantCache<boolean>(CACHE_TTL_MS);

function getCached<T>(cache: TenantCache<T>, key: string): T | undefined {
  return cache.get(key);
}

function setCache<T>(cache: TenantCache<T>, key: string, value: T): void {
  cache.set(key, value);
}

// ─── Async API ────────────────────────────────────────────────────────────────

export async function getSystemSetting(key: string, fallback = ""): Promise<string> {
  try {
    const cached = getCached(settingsCache, key);
    if (cached !== undefined) return cached ?? fallback;

    const db = await getDb();
    if (!db) {
      console.warn(`[config] DB unavailable, using fallback for "${key}"`);
      return fallback;
    }
    const [row] = await db.select({ value: systemSettings.value })
      .from(systemSettings)
      .where(eq(systemSettings.key, key))
      .limit(1);
    const value = row?.value ?? null;
    setCache(settingsCache, key, value);
    if (!value || value.trim() === "") {
      console.warn(`[config] No DB value for "${key}", using fallback "${fallback}"`);
    }
    return value?.trim() || fallback;
  } catch (err) {
    console.warn(`[config] Error reading "${key}", using fallback "${fallback}":`, err);
    return fallback;
  }
}

export async function getFeatureFlag(key: string, fallback = false): Promise<boolean> {
  try {
    const cached = getCached(flagsCache, key);
    if (cached !== undefined) return cached;

    const db = await getDb();
    if (!db) {
      console.warn(`[config] DB unavailable for flag "${key}", using fallback ${fallback}`);
      return fallback;
    }
    const [row] = await db.select({ enabled: featureFlags.enabled })
      .from(featureFlags)
      .where(eq(featureFlags.key, key))
      .limit(1);
    if (row === undefined) {
      console.warn(`[config] Flag "${key}" not found in DB, using fallback ${fallback}`);
    }
    const value = row !== undefined ? row.enabled : fallback;
    setCache(flagsCache, key, value);
    return value;
  } catch (err) {
    console.warn(`[config] Error reading flag "${key}", using fallback ${fallback}:`, err);
    return fallback;
  }
}

// ─── Sync API (reads from cache only; returns fallback if not yet cached) ─────
// Safe for use in synchronous contexts (e.g. email template helpers).
// Always returns the fallback on first call; cache is populated by async callers.

export function getSystemSettingSync(key: string, fallback = ""): string {
  const cached = getCached(settingsCache, key);
  if (cached !== undefined) return cached?.trim() || fallback;
  return fallback;
}

// ─── Business Email helper ───────────────────────────────────────────────────
// Generic fallbacks — deployment-specific values must be set in system_settings.

const EMAIL_FALLBACKS: Record<string, string> = {
  reservations:  "reservas@nayadeexperiences.es",
  admin_alerts:  "admin@tuempresa.com",
  accounting:    "admin@tuempresa.com",
  cancellations: "reservas@nayadeexperiences.es",
  tpv_ingestion: "admin@tuempresa.com",
};

const EMAIL_SETTING_KEYS: Record<string, string> = {
  reservations:  "email_reservations",
  admin_alerts:  "email_admin_alerts",
  accounting:    "email_accounting",
  cancellations: "email_cancellations",
  tpv_ingestion: "email_tpv_ingestion",
};

export async function getBusinessEmail(
  type: "reservations" | "admin_alerts" | "accounting" | "cancellations" | "tpv_ingestion"
): Promise<string> {
  const settingKey = EMAIL_SETTING_KEYS[type];
  // En multiempresa no existe «el correo de la casa»: sin ajuste del tenant no se inventa uno
  // (los respaldos son de Náyade o genéricos y llegarían a un tercero).
  const fallback = getTenantMode() === "multi" ? "" : EMAIL_FALLBACKS[type];
  const fromDb = await getSystemSetting(settingKey, "");
  return fromDb.trim() || fallback;
}

// ─── Cache warming (call at server startup to pre-populate sync cache) ────────

export async function warmConfigCache(): Promise<void> {
  const keys = [
    "email_reservations", "email_admin_alerts", "email_accounting",
    "email_cancellations", "email_tpv_ingestion", "email_noreply_sender",
    "brand_name", "brand_phone", "brand_address", "brand_domain",
    "brand_logo_url", "brand_hero_image_url", "brand_primary_color",
    "brand_accent_color", "brand_website_url", "brand_support_phone", "brand_location",
    "cash_register_tolerance", "cash_alert_threshold",
    "bank_match_tolerance", "card_terminal_tolerance", "card_batch_tolerance",
    // Integraciones por tenant (multiempresa): credenciales de cobro y correo
    "redsys_environment", "redsys_merchant_code", "redsys_merchant_key", "redsys_merchant_terminal",
    "seo_description", "email_cc_all",
  ];
  await Promise.all(keys.map(k => getSystemSetting(k, "").catch(() => {})));
}

// ─── Cache invalidation (call after updating flags/settings) ─────────────────

/** Invalida las cachés del tenant actual (o todas si no hay contexto). */
export function invalidateConfigCache(): void {
  settingsCache.clear();
  flagsCache.clear();
}

export function invalidateConfigCacheForTenant(tenantId: string): void {
  settingsCache.clearTenant(tenantId);
  flagsCache.clearTenant(tenantId);
}

/** Pruebas y apagado. */
export function _clearAllConfigCaches(): void {
  settingsCache.clearAll();
  flagsCache.clearAll();
}
