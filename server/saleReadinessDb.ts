/**
 * Preparación para venta online (lógica de BD): reúne los datos del producto, sus variantes, convocatorias y las reglas
 * de la empresa, y los pasa al comprobador puro (shared/saleReadiness.ts). Solo LEE: nunca cambia datos.
 */
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { siteSettings } from "../drizzle/schema";
import { format } from "../shared/i18n/core";
import es from "../shared/i18n/locales/es/saleReadiness";
import { evaluateSaleReadiness, type ReadinessCheck, type ReadinessResult } from "../shared/saleReadiness";
import { offerModeOf } from "../shared/offerMode";
import { getDb, getExperienceById, getVariantsByExperience, todayMadridISO } from "./db";
import { isRedsysConfigured } from "./redsys";
import { isMultiTenant } from "./_core/tenant";

/** Texto de una comprobación en el idioma principal (para los mensajes del servidor). */
export function readinessCheckText(c: ReadinessCheck): string {
  const entry = (es.checks as Record<string, { label: string }>)[c.id];
  return entry ? format(entry.label, c.params, "es") : c.id;
}

async function companyRules() {
  let cancellationPolicy: string | null = null;
  try {
    const db = await getDb();
    if (db) {
      const rows = await db.select().from(siteSettings).where(eq(siteSettings.key, "cancellation_policy")).limit(1);
      cancellationPolicy = rows[0]?.value ?? null;
    }
  } catch {
    cancellationPolicy = null;
  }
  let connect: { status: string; onlineEnabled: boolean; mode: string } | null = null;
  if (isMultiTenant()) {
    try {
      const { activeConnectConfig } = await import("./paymentsConnect/activeConfig");
      const { mysqlPaymentStore } = await import("./paymentsConnect/store");
      const config = await activeConnectConfig();
      const acc = config ? await mysqlPaymentStore().getAccount(config.mode) : null;
      if (acc) connect = { status: acc.status, onlineEnabled: acc.onlineEnabled, mode: acc.mode };
    } catch {
      connect = null;
    }
  }
  return { currency: "EUR", defaultTaxRate: 21, cancellationPolicy, connect, redsysConfigured: isRedsysConfigured() };
}

async function editionsOf(experienceId: number) {
  try {
    const { listEditions } = await import("./editionsDb");
    return await listEditions(experienceId);
  } catch {
    return [];
  }
}

/**
 * Preparación de un producto guardado. `override` permite evaluar el estado que quedaría tras una edición (precio, IVA…)
 * sin haberla guardado todavía.
 */
export async function loadSaleReadiness(experienceId: number, override: Record<string, unknown> = {}, now = Date.now()): Promise<{ result: ReadinessResult; title: string; offerMode: string } | null> {
  const exp = await getExperienceById(experienceId);
  if (!exp) return null;
  const merged = { ...exp, ...override } as typeof exp;
  const [variants, editions, company] = await Promise.all([getVariantsByExperience(experienceId, { includeExpired: true }), editionsOf(experienceId), companyRules()]);
  const result = evaluateSaleReadiness({
    product: {
      offerMode: merged.offerMode,
      basePrice: merged.basePrice,
      currency: merged.currency,
      fiscalRegime: merged.fiscalRegime,
      taxRate: merged.taxRate,
      pricingType: merged.pricingType,
      unitCapacity: merged.unitCapacity,
      minPersons: merged.minPersons,
      maxPersons: merged.maxPersons,
      locationId: merged.locationId,
    },
    variants: variants.map((v) => ({ name: v.name, priceModifier: v.priceModifier, priceType: v.priceType, isRequired: v.isRequired, validUntil: v.validUntil })),
    editions: editions.map((e) => ({ status: e.status, capacity: e.capacity, reserved: e.reserved, startsAt: e.startsAt, endsAt: e.endsAt })),
    company,
    now,
    todayISO: todayMadridISO(new Date(now)),
  });
  return { result, title: String(merged.title), offerMode: offerModeOf(merged) };
}

const list = (cs: ReadinessCheck[]) => cs.map(readinessCheckText).join("; ");

/**
 * Guarda del cambio de modalidad: SOLO al pasar a «precio fijo» desde otra modalidad. Con bloqueos, rechaza con un
 * mensaje claro; con solo avisos, exige la confirmación explícita del administrador. Los productos que ya son de precio
 * fijo no pasan por aquí.
 */
export async function assertCanSwitchToFixed(experienceId: number, override: Record<string, unknown>, confirmed: boolean): Promise<void> {
  const r = await loadSaleReadiness(experienceId, override);
  if (!r) throw new TRPCError({ code: "NOT_FOUND", message: "Producto no encontrado" });
  if (r.result.blockers.length > 0) {
    throw new TRPCError({ code: "BAD_REQUEST", message: format(es.server.blocked, { title: r.title, list: list(r.result.blockers) }, "es") });
  }
  if (r.result.warnings.length > 0 && !confirmed) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: format(es.server.needsConfirm, { title: r.title, list: list(r.result.warnings) }, "es") });
  }
}
