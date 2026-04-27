import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { featureFlags, systemSettings } from "../../drizzle/schema";

// ─── In-memory cache (60s TTL) ────────────────────────────────────────────────

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const settingsCache = new Map<string, CacheEntry<string | null>>();
const flagsCache = new Map<string, CacheEntry<boolean>>();
const CACHE_TTL_MS = 60_000;

function getCached<T>(cache: Map<string, CacheEntry<T>>, key: string): T | undefined {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) { cache.delete(key); return undefined; }
  return entry.value;
}

function setCache<T>(cache: Map<string, CacheEntry<T>>, key: string, value: T): void {
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
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
  reservations:  "contacto@tuempresa.com",
  admin_alerts:  "admin@tuempresa.com",
  accounting:    "admin@tuempresa.com",
  cancellations: "contacto@tuempresa.com",
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
  const fallback = EMAIL_FALLBACKS[type];
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
  ];
  await Promise.all(keys.map(k => getSystemSetting(k, "").catch(() => {})));
}

// ─── Cache invalidation (call after updating flags/settings) ─────────────────

export function invalidateConfigCache(): void {
  settingsCache.clear();
  flagsCache.clear();
}
