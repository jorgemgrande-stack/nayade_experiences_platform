/**
 * Resource Manager — COSTE ATRIBUIBLE por empresa (solo lectura; nunca cobra ni factura nada).
 *
 * coste de una empresa en un periodo = Σ (consumo medido de cada métrica × tarifa por unidad)
 *                                     + parte del coste fijo compartido (proporcional a sus peticiones).
 *
 * Las tarifas salen de `ERM_COST_MODEL` (JSON) o, si no está, de una ESTIMACIÓN con precios públicos de los proveedores
 * (Railway: tráfico saliente y vCPU; Postmark: correo). La respuesta dice siempre de dónde salen (`source`) y qué no se
 * puede atribuir porque no se mide (almacenamiento, tamaño de la base de datos…): no se inventa nada.
 */
import { z } from "zod";
import type { UsageStore } from "./types";

export interface CostRate {
  metric: string;
  label: string;
  /** Unidad en la que se expresa la tarifa (texto para la interfaz). */
  unit: string;
  /** Cantidad medida que equivale a una unidad (p. ej. 1e9 bytes = 1 GB). */
  per: number;
  /** Céntimos de euro por unidad (admite decimales). */
  centsPerUnit: number;
}

export interface CostModel {
  source: "configuración" | "estimación";
  note: string;
  currency: "EUR";
  rates: CostRate[];
  /** Coste fijo compartido de la plataforma al mes (céntimos): servidores base, bases de datos, plan del proveedor. */
  sharedMonthlyCents: number;
  /** Métrica con la que se reparte el coste compartido. */
  sharedBasis: string;
}

/**
 * Estimación de referencia (24/10/2026, 1 USD ≈ 0,92 EUR), redondeada al alza:
 *  - tráfico saliente: 0,05 USD/GB (Railway) → 4,6 cent/GB;
 *  - tiempo de servidor (peticiones y tareas): 20 USD por vCPU y mes (Railway) → 0,00071 cent/s. Es tiempo de reloj, no
 *    de CPU: cota superior;
 *  - correo: 15 USD por 10.000 (Postmark) → 0,14 cent/correo;
 *  - exportaciones: como tráfico saliente;
 *  - IA (cuenta de la plataforma): precio público del modelo por defecto (gpt-4o-mini, 0,15 USD / 0,60 USD por millón
 *    de tokens de entrada / salida) → 14 / 55 cent por millón. Los tokens con la cuenta propia de la empresa no cuentan.
 * El coste fijo compartido no se estima (0) hasta que se configure con las facturas reales.
 */
export const ESTIMATED_COST_MODEL: CostModel = {
  source: "estimación",
  note: "Tarifas de referencia de los precios públicos de Railway, Postmark y del modelo de IA por defecto; sin coste fijo compartido. Configurar ERM_COST_MODEL con las facturas reales.",
  currency: "EUR",
  rates: [
    { metric: "http.response.bytes", label: "Tráfico saliente", unit: "GB", per: 1e9, centsPerUnit: 4.6 },
    { metric: "http.request.ms", label: "Tiempo de servidor (peticiones)", unit: "hora", per: 3_600_000, centsPerUnit: 2.56 },
    { metric: "job.run.ms", label: "Tiempo de servidor (tareas)", unit: "hora", per: 3_600_000, centsPerUnit: 2.56 },
    { metric: "email.sent", label: "Correo enviado", unit: "correo", per: 1, centsPerUnit: 0.14 },
    { metric: "data_export.bytes", label: "Exportaciones de datos", unit: "GB", per: 1e9, centsPerUnit: 4.6 },
    { metric: "llm.tokens.input", label: "IA: tokens de entrada", unit: "millón de tokens", per: 1e6, centsPerUnit: 14 },
    { metric: "llm.tokens.output", label: "IA: tokens de salida", unit: "millón de tokens", per: 1e6, centsPerUnit: 55 },
    // Referencia pública: imagen ≈ 0,04 USD; transcripción ≈ 0,006 USD por minuto de audio
    { metric: "ai.image.generated", label: "IA: imágenes generadas", unit: "imagen", per: 1, centsPerUnit: 3.7 },
    { metric: "ai.audio.seconds", label: "IA: audio transcrito", unit: "minuto", per: 60, centsPerUnit: 0.56 },
    // Integraciones externas: el coste se mide en micro-USD (devuelto por el proveedor o estimado con
    // EXTERNAL_REFERENCE_PRICES) y aquí solo se convierte a euros (1 USD ≈ 0,92 EUR). GHL no tiene tarifa: su API no
    // se cobra por llamada (va en la suscripción de la cuenta) y los mensajes que cobra no vienen en la respuesta.
    { metric: "ext.vapi.cost.measured_microusd", label: "Vapi: coste devuelto por el proveedor", unit: "USD", per: 1e6, centsPerUnit: 92 },
    { metric: "ext.vapi.cost.estimated_microusd", label: "Vapi: coste estimado (minutos × tarifa)", unit: "USD", per: 1e6, centsPerUnit: 92 },
    { metric: "ext.maps.cost.estimated_microusd", label: "Google Maps: coste estimado (llamadas × tarifa)", unit: "USD", per: 1e6, centsPerUnit: 92 },
  ],
  sharedMonthlyCents: 0,
  sharedBasis: "http.request",
};

/**
 * Precios públicos de referencia de las integraciones externas (USD por unidad), SOLO para estimar cuando la respuesta
 * del proveedor no trae el coste. Son una ESTIMACIÓN: no descuentan los tramos gratuitos mensuales ni los precios
 * negociados. Lo que no tiene precio público conocido no aparece (y no se estima):
 *  - Vapi: tarifa de plataforma de 0,05 USD por minuto (sin el coste del modelo, la voz y la telefonía, que solo se
 *    conoce cuando Vapi devuelve `cost`);
 *  - Google Maps (lista de precios por 1.000 peticiones): geocodificación, rutas, matriz de distancias (por elemento),
 *    elevación y zona horaria 5 USD; búsqueda de sitios (texto y cercanía) 32 USD; detalle de un sitio 17 USD.
 * GHL (HighLevel): sin precio por llamada a la API; no se estima.
 */
export const EXTERNAL_REFERENCE_PRICES = {
  vapi: { minute: 0.05 },
  maps: { geocode: 0.005, directions: 0.005, distancematrix: 0.005, elevation: 0.005, timezone: 0.005, "place/textsearch": 0.032, "place/nearbysearch": 0.032, "place/details": 0.017 },
} as const satisfies Record<string, Record<string, number>>;

const metricRe = /^[a-z][a-z0-9_.]{1,63}$/;
export const costModelInputSchema = z
  .object({
    note: z.string().max(300).optional(),
    rates: z
      .array(
        z
          .object({
            metric: z.string().regex(metricRe),
            label: z.string().min(1).max(80),
            unit: z.string().min(1).max(20),
            per: z.number().positive(),
            centsPerUnit: z.number().min(0).max(1_000_000),
          })
          .strict(),
      )
      .max(30),
    sharedMonthlyCents: z.number().int().min(0).max(100_000_000).default(0),
    sharedBasis: z.string().regex(metricRe).default("http.request"),
  })
  .strict();

/** Modelo de costes del entorno: `ERM_COST_MODEL` válido, o la estimación. Un JSON no válido NO se usa a medias. */
export function costModelFromEnv(env: NodeJS.ProcessEnv): { model: CostModel; error: string | null } {
  const raw = env.ERM_COST_MODEL?.trim();
  if (!raw) return { model: ESTIMATED_COST_MODEL, error: null };
  try {
    const m = costModelInputSchema.parse(JSON.parse(raw));
    return { model: { source: "configuración", note: m.note ?? "Tarifas configuradas en ERM_COST_MODEL", currency: "EUR", rates: m.rates, sharedMonthlyCents: m.sharedMonthlyCents, sharedBasis: m.sharedBasis }, error: null };
  } catch {
    return { model: ESTIMATED_COST_MODEL, error: "ERM_COST_MODEL no es válido: se usa la estimación" };
  }
}

export interface CostLine {
  metric: string;
  label: string;
  unit: string;
  quantity: number;
  units: number;
  cents: number;
}

export interface TenantCost {
  tenantId: string;
  lines: CostLine[];
  variableCents: number;
  sharedCents: number;
  totalCents: number;
  /** Parte de la métrica de reparto que corresponde a la empresa (0–1). */
  sharedShare: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Coste variable de un consumo (totales por métrica). Las métricas sin tarifa no suman. */
export function variableCost(model: CostModel, totals: Record<string, number>): { lines: CostLine[]; cents: number } {
  const lines = model.rates.map((r) => {
    const quantity = totals[r.metric] ?? 0;
    const units = quantity / r.per;
    return { metric: r.metric, label: r.label, unit: r.unit, quantity, units: round2(units * 1000) / 1000, cents: round2(units * r.centsPerUnit) };
  });
  return { lines, cents: round2(lines.reduce((s, l) => s + l.cents, 0)) };
}

/**
 * Costes de varias empresas en un periodo. El coste compartido del periodo (prorrateado a `days`/30) se reparte por la
 * métrica de reparto; si nadie la consumió, a partes iguales.
 */
export async function tenantCosts(usage: Pick<UsageStore, "list">, model: CostModel, tenantIds: string[], now: number, days: number): Promise<{ tenants: TenantCost[]; sharedPeriodCents: number }> {
  const to = now + 3_600_000;
  const from = to - days * 86_400_000;
  const totalsBy = new Map<string, Record<string, number>>();
  for (const id of tenantIds) {
    const t: Record<string, number> = {};
    for (const r of await usage.list(id, from, to)) t[r.metric] = (t[r.metric] ?? 0) + r.quantity;
    totalsBy.set(id, t);
  }
  const sharedPeriodCents = round2((model.sharedMonthlyCents * days) / 30);
  const basisTotal = tenantIds.reduce((s, id) => s + (totalsBy.get(id)![model.sharedBasis] ?? 0), 0);
  const tenants = tenantIds.map((id) => {
    const totals = totalsBy.get(id)!;
    const v = variableCost(model, totals);
    const share = tenantIds.length === 0 ? 0 : basisTotal > 0 ? (totals[model.sharedBasis] ?? 0) / basisTotal : 1 / tenantIds.length;
    const sharedCents = round2(sharedPeriodCents * share);
    return { tenantId: id, lines: v.lines, variableCents: v.cents, sharedCents, totalCents: round2(v.cents + sharedCents), sharedShare: round2(share * 10_000) / 10_000 };
  });
  return { tenants, sharedPeriodCents };
}
