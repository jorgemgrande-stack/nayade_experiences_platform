/**
 * Preparación de un producto para la venta online directa (modalidad «precio fijo»).
 *
 * Módulo puro y determinista (sin servidor, base de datos ni red): recibe el producto, sus variantes, convocatorias y
 * las reglas de la empresa que ya conoce quien lo llama, y devuelve comprobaciones y un veredicto. No cambia ningún dato.
 *
 *  - «técnico»: lo que el sistema puede verificar solo (precio coherente, IVA, moneda, participantes, ubicación, canal de cobro).
 *  - «comercial»: lo que decide la Dirección o la empresa (fechas, plazas, política de cancelación, qué recibe el cliente).
 *    Mientras no esté decidido se marca como pendiente; nunca se inventa.
 *
 * Gravedad: `ok` (comprobado), `warning` (conviene confirmarlo, no impide) y `blocker` (no se puede vender así).
 * Las etiquetas viven en `shared/i18n/locales/{es,de}/saleReadiness.ts`, bajo la misma clave `checks.<id>`.
 */

export type CheckSeverity = "ok" | "warning" | "blocker";
export type CheckScope = "technical" | "commercial";
export type ReadinessParams = Record<string, string | number>;

export interface ReadinessCheck {
  /** Clave estable de la comprobación (también la del texto en el catálogo de idiomas). */
  id: string;
  scope: CheckScope;
  severity: CheckSeverity;
  params?: ReadinessParams;
}

export interface ReadinessProduct {
  offerMode?: string | null;
  basePrice: string | number | null;
  currency?: string | null;
  fiscalRegime?: string | null;
  taxRate?: string | number | null;
  pricingType?: string | null;
  unitCapacity?: number | null;
  minPersons?: number | null;
  maxPersons?: number | null;
  locationId?: number | null;
}

export interface ReadinessVariant {
  name?: string;
  priceModifier?: string | number | null;
  priceType?: string | null;
  isRequired?: boolean | null;
  /** Último día de vigencia (YYYY-MM-DD) o null. */
  validUntil?: string | null;
}

export interface ReadinessEdition {
  status: string;
  capacity: number | null;
  reserved?: number;
  startsAt: number;
  endsAt?: number | null;
}

export interface ReadinessCompany {
  /** Moneda de la empresa (EUR). */
  currency?: string | null;
  /** IVA general de la empresa, si se conoce. */
  defaultTaxRate?: number | null;
  /** Política de cancelación/devolución publicada (null o vacía = sin política). */
  cancellationPolicy?: string | null;
  /** Cuenta de cobros Stripe Connect de la empresa (null = sin cuenta). */
  connect?: { status: string; onlineEnabled: boolean; mode?: string | null } | null;
  /** ¿Hay otra pasarela (Redsys) configurada para cobrar el carrito? */
  redsysConfigured?: boolean;
}

export interface ReadinessInput {
  product: ReadinessProduct;
  variants: ReadinessVariant[];
  editions: ReadinessEdition[];
  /** ¿El producto se vende por fechas/convocatorias (retiros, experiencias, formaciones)? null = se deduce de si tiene convocatorias. */
  needsDates?: boolean | null;
  /** Qué recibe el cliente al pagar. null = se deduce (con convocatorias: matrícula; si no: reserva). */
  delivery?: "reservation" | "enrollment" | null;
  company: ReadinessCompany;
  /** Ahora, en milisegundos (se inyecta: el módulo no lee el reloj). */
  now: number;
  /** Hoy en Madrid (YYYY-MM-DD), para la vigencia de las variantes. */
  todayISO: string;
}

export interface ReadinessResult {
  checks: ReadinessCheck[];
  blockers: ReadinessCheck[];
  warnings: ReadinessCheck[];
  /** Bloqueos técnicos (lo que el sistema puede arreglar o verificar). */
  technicalBlockers: ReadinessCheck[];
  /** Todo lo comercial aún sin cerrar (bloqueos y avisos): decisión de Dirección o de la empresa. */
  commercialPending: ReadinessCheck[];
  /** `technically_ready`: ningún bloqueo técnico. `missing_data`: hay bloqueos técnicos. */
  verdict: "technically_ready" | "missing_data";
  /** Puede pasar a precio fijo sin confirmaciones: ningún bloqueo y ningún aviso. */
  clean: boolean;
  /** Puede pasar a precio fijo (con confirmación explícita si hay avisos): ningún bloqueo de ningún tipo. */
  canSwitchToFixed: boolean;
}

const num = (v: unknown): number => {
  if (v == null || v === "") return NaN;
  return Number(String(v).replace(",", "."));
};

/** Precio efectivo por persona de una variante, como lo calcula el pedido (porcentaje sobre la base; si no, precio directo). */
export function variantEffectivePrice(base: number, v: ReadinessVariant): number {
  const mod = Number.isFinite(num(v.priceModifier)) ? num(v.priceModifier) : 0;
  return v.priceType === "percentage" ? base + (base * mod) / 100 : mod;
}

const FUTURE_OPEN = new Set(["open", "waitlist"]);

export function evaluateSaleReadiness(input: ReadinessInput): ReadinessResult {
  const { product: p, company: c } = input;
  const checks: ReadinessCheck[] = [];
  const add = (id: string, scope: CheckScope, severity: CheckSeverity, params?: ReadinessParams) => {
    checks.push(params ? { id, scope, severity, params } : { id, scope, severity });
  };

  // ── Precio y variantes ─────────────────────────────────────────────────────
  const base = num(p.basePrice);
  const baseOk = Number.isFinite(base) && base > 0;
  const live = input.variants.filter((v) => !v.validUntil || v.validUntil >= input.todayISO);
  if (input.variants.length > 0 && live.length === 0) add("variants_all_expired", "technical", "blocker");
  if (live.length === 0) {
    if (input.variants.length === 0) add(baseOk ? "price_ok" : "price_missing", "technical", baseOk ? "ok" : "blocker");
  } else {
    const prices = live.map((v) => variantEffectivePrice(baseOk ? base : 0, v));
    const zero = live.filter((_, i) => !(prices[i] > 0));
    if (zero.length > 0) add("variant_price_zero", "technical", "blocker", { n: zero.length, names: zero.map((v) => v.name ?? "?").join(", ") });
    const anyRequired = live.some((v) => v.isRequired);
    if (!baseOk && !anyRequired) {
      // Base 0 con variantes de pago NO es gratuito: sin elegir variante no hay precio y el pedido se rechaza
      add("base_zero_variant_not_required", "technical", "blocker");
    } else if (baseOk && !anyRequired && live.length > 1) {
      add("variant_optional_base_default", "technical", "warning", { base: base.toFixed(2) });
    }
    if (zero.length === 0 && (baseOk || anyRequired)) {
      const min = Math.min(...prices);
      const max = Math.max(...prices);
      add("price_variants_ok", "technical", "ok", { n: live.length, min: min.toFixed(2), max: max.toFixed(2) });
    }
  }

  // ── Moneda ─────────────────────────────────────────────────────────────────
  const cur = (p.currency ?? "").toUpperCase();
  const companyCur = (c.currency ?? "EUR").toUpperCase();
  add(cur === companyCur ? "currency_ok" : "currency_mismatch", "technical", cur === companyCur ? "ok" : "blocker", { currency: cur || "?", expected: companyCur });

  // ── IVA / régimen fiscal ───────────────────────────────────────────────────
  const regime = p.fiscalRegime ?? "general";
  const rate = num(p.taxRate);
  if (regime === "general") {
    if (!Number.isFinite(rate) || rate < 0 || rate > 100) add("tax_missing", "technical", "blocker");
    else if (c.defaultTaxRate != null && rate !== c.defaultTaxRate) add("tax_differs", "technical", "warning", { rate, expected: c.defaultTaxRate });
    else add("tax_ok", "technical", "ok", { rate });
  } else {
    add("tax_special_regime", "technical", "warning", { regime });
  }

  // ── Participantes y tarifa por número de personas ──────────────────────────
  const min = p.minPersons ?? 1;
  const max = p.maxPersons ?? null;
  if (p.pricingType === "per_unit" && !((p.unitCapacity ?? 0) > 0)) add("unit_capacity_missing", "technical", "blocker");
  else if (!(min >= 1) || (max != null && max < min)) add("participants_invalid", "technical", "blocker", { min, max: max ?? "-" });
  else if (max == null) add("participants_unbounded", "technical", "warning", { min });
  else add("participants_ok", "technical", "ok", { min, max });

  // ── Ubicación ──────────────────────────────────────────────────────────────
  add((p.locationId ?? 0) > 0 ? "location_ok" : "location_missing", "technical", (p.locationId ?? 0) > 0 ? "ok" : "blocker");

  // ── Fechas, ediciones y plazas ─────────────────────────────────────────────
  const needsDates = input.needsDates ?? input.editions.length > 0;
  if (needsDates) {
    const sellable = input.editions.filter((e) => FUTURE_OPEN.has(e.status) && (e.endsAt ?? e.startsAt + 24 * 3600_000) >= input.now);
    if (input.editions.length === 0) add("dates_missing", "commercial", "blocker");
    else if (sellable.length === 0) add("dates_none_open", "commercial", "blocker");
    else {
      add("dates_ok", "commercial", "ok", { n: sellable.length });
      const open = sellable.filter((e) => e.status === "open");
      if (open.length > 0 && open.every((e) => e.capacity == null)) add("seats_undefined", "commercial", "warning");
      else if (open.length > 0 && open.every((e) => e.capacity != null && (e.reserved ?? 0) >= e.capacity)) add("seats_full", "commercial", "warning");
    }
    // El carrito reserva por fecha elegida; no consta que reste plazas de la convocatoria
    add("seats_not_linked_to_checkout", "technical", "warning");
  } else {
    add("dates_not_applicable", "commercial", "ok");
  }

  // ── Condiciones comerciales de la empresa ──────────────────────────────────
  const policy = (c.cancellationPolicy ?? "").trim();
  add(policy ? "cancellation_policy_ok" : "cancellation_policy_missing", "commercial", policy ? "ok" : "warning");
  // El pedido recoge los datos del comprador (nombre, correo, teléfono); no los de cada participante
  if (max == null || max > 1) add("participant_data_buyer_only", "commercial", "warning");
  else add("participant_data_ok", "commercial", "ok");

  // ── Qué recibe el cliente tras pagar ───────────────────────────────────────
  const delivery = input.delivery ?? (input.editions.length > 0 ? "enrollment" : "reservation");
  if (delivery === "enrollment") add("delivery_enrollment_unconfirmed", "commercial", "warning");
  else add("delivery_reservation_ok", "technical", "ok");

  // ── Canal de cobro ─────────────────────────────────────────────────────────
  const cn = c.connect;
  if (cn && cn.status === "verificada" && cn.onlineEnabled) {
    add("payments_connect_ok", "technical", "ok");
    if (cn.mode === "test") add("payments_test_mode", "technical", "warning");
  } else if (c.redsysConfigured) {
    add("payments_redsys_ok", "technical", "ok");
  } else if (!cn) {
    add("connect_not_connected", "technical", "blocker");
  } else if (cn.status !== "verificada") {
    add("connect_not_verified", "technical", "blocker");
  } else {
    add("connect_switch_off", "technical", "blocker");
  }

  const blockers = checks.filter((k) => k.severity === "blocker");
  const warnings = checks.filter((k) => k.severity === "warning");
  const technicalBlockers = blockers.filter((k) => k.scope === "technical");
  const commercialPending = checks.filter((k) => k.scope === "commercial" && k.severity !== "ok");
  return {
    checks,
    blockers,
    warnings,
    technicalBlockers,
    commercialPending,
    verdict: technicalBlockers.length === 0 ? "technically_ready" : "missing_data",
    clean: blockers.length === 0 && warnings.length === 0,
    canSwitchToFixed: blockers.length === 0,
  };
}

/** Todas las claves de comprobación posibles (las usan las pruebas de los catálogos de idiomas). */
export const READINESS_CHECK_IDS = [
  "variants_all_expired", "price_ok", "price_missing", "variant_price_zero", "base_zero_variant_not_required",
  "variant_optional_base_default", "price_variants_ok", "currency_ok", "currency_mismatch", "tax_missing", "tax_differs",
  "tax_ok", "tax_special_regime", "unit_capacity_missing", "participants_invalid", "participants_unbounded",
  "participants_ok", "location_ok", "location_missing", "dates_missing", "dates_none_open", "dates_ok", "seats_undefined",
  "seats_full", "seats_not_linked_to_checkout", "dates_not_applicable", "cancellation_policy_ok",
  "cancellation_policy_missing", "participant_data_buyer_only", "participant_data_ok", "delivery_enrollment_unconfirmed",
  "delivery_reservation_ok", "payments_connect_ok", "payments_test_mode", "payments_redsys_ok", "connect_not_connected",
  "connect_not_verified", "connect_switch_off",
] as const;
