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

// ─── Public API ───────────────────────────────────────────────────────────────

export async function getSystemSetting(key: string, fallback = ""): Promise<string> {
  try {
    const cached = getCached(settingsCache, key);
    if (cached !== undefined) return cached ?? fallback;

    const db = await getDb();
    if (!db) return fallback;
    const [row] = await db.select({ value: systemSettings.value })
      .from(systemSettings)
      .where(eq(systemSettings.key, key))
      .limit(1);
    const value = row?.value ?? null;
    setCache(settingsCache, key, value);
    return value ?? fallback;
  } catch {
    return fallback;
  }
}

export async function getFeatureFlag(key: string, fallback = true): Promise<boolean> {
  try {
    const cached = getCached(flagsCache, key);
    if (cached !== undefined) return cached;

    const db = await getDb();
    if (!db) return fallback;
    const [row] = await db.select({ enabled: featureFlags.enabled })
      .from(featureFlags)
      .where(eq(featureFlags.key, key))
      .limit(1);
    const value = row !== undefined ? row.enabled : fallback;
    setCache(flagsCache, key, value);
    return value;
  } catch {
    return fallback;
  }
}

// Hardcoded fallbacks preserve current production behavior when DB is empty
const EMAIL_FALLBACKS: Record<string, string> = {
  reservations:  "reservas@nayadeexperiences.es",
  admin_alerts:  "administracion@nayadeexperiences.es",
  accounting:    "administracion@nayadeexperiences.es",
  cancellations: "reservas@nayadeexperiences.es",
  tpv_ingestion: "administracion@nayadeexperiences.es",
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

// ─── Cache invalidation (call after updating flags/settings) ─────────────────

export function invalidateConfigCache(): void {
  settingsCache.clear();
  flagsCache.clear();
}
