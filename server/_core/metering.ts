/**
 * Medición de recursos (interfaz preparatoria para Elephant Resource Manager).
 *
 * Este módulo SOLO define el contrato y los puntos de emisión. No almacena, no agrega, no
 * aplica cuotas ni factura: eso pertenece al Resource Manager. Por defecto el destino es
 * nulo (no hace nada), de modo que emitir eventos no cambia el comportamiento ni el coste.
 *
 * Principios:
 *  - Emitir nunca debe romper la operación medida: `meter()` no lanza jamás.
 *  - Cada evento lleva el tenant (de AsyncLocalStorage) para poder atribuir el consumo.
 *  - La cardinalidad de las etiquetas es baja: nada de ids de usuario ni rutas completas.
 *  - Sin datos personales en los eventos.
 */
import { getTenantIdOrDefault } from "./tenant";

export type MeterValue = string | number | boolean | null;

export type MeterEvent = {
  tenantId: string;
  /** Nombre estable de la métrica (ver `Metrics`). */
  metric: string;
  quantity: number;
  /** Unidad: "count", "byte", "ms", "token"… */
  unit: string;
  /** Marca de tiempo (ms desde epoch). */
  at: number;
  meta?: Record<string, MeterValue>;
};

export interface MeterSink {
  record(event: MeterEvent): void;
}

/** Métricas conocidas. Añadir aquí al instrumentar un recurso nuevo. */
export const Metrics = {
  HTTP_REQUEST: "http.request",
  HTTP_REQUEST_MS: "http.request.ms",
  HTTP_RESPONSE_BYTES: "http.response.bytes",
  STORAGE_WRITE_BYTES: "storage.write.bytes",
  EMAIL_SENT: "email.sent",
  LLM_TOKENS_INPUT: "llm.tokens.input",
  LLM_TOKENS_OUTPUT: "llm.tokens.output",
  /** Tokens con la cuenta de IA PROPIA de la empresa: se miden, pero no son coste de la plataforma. */
  LLM_OWN_TOKENS: "llm.own.tokens",
  JOB_RUN_MS: "job.run.ms",
  TENANT_SHADOW: "tenant.shadow",
  /** Espera por hueco en el presupuesto de conexiones (ms) hasta obtenerlo. */
  DB_POOL_WAIT_MS: "db.pool.wait.ms",
  /** Peticiones/jobs rechazados por presupuesto de conexiones agotado (503). */
  DB_POOL_REJECTED: "db.pool.rejected",
  /** Pools de empresa cerrados por presión (lru) o inactividad (idle). */
  DB_POOL_EVICTED: "db.pool.evicted",
  /** Exportaciones de datos solicitadas, bytes generados (sin comprimir) y duración de cada generación. */
  DATA_EXPORT_RUNS: "data_export.runs",
  DATA_EXPORT_BYTES: "data_export.bytes",
  DATA_EXPORT_MS: "data_export.ms",
  /** IA de la plataforma fuera del modelo de texto: imágenes generadas y segundos de audio transcritos. */
  AI_IMAGES: "ai.image.generated",
  AI_AUDIO_SECONDS: "ai.audio.seconds",
} as const;

const noopSink: MeterSink = { record() {} };
let sink: MeterSink = noopSink;

/** Fija el destino de los eventos. `null` restaura el destino nulo. */
export function setMeterSink(s: MeterSink | null): void {
  sink = s ?? noopSink;
}

/** Registra un consumo. Nunca lanza. */
export function meter(
  metric: string,
  quantity = 1,
  unit = "count",
  meta?: Record<string, MeterValue>,
  /** Tenant explícito (p. ej. en callbacks donde el contexto asíncrono ya no existe). */
  tenantId?: string,
): void {
  try {
    if (!Number.isFinite(quantity)) return;
    sink.record({ tenantId: tenantId ?? getTenantIdOrDefault(), metric, quantity, unit, at: Date.now(), meta });
  } catch {
    // Medir no puede afectar a la operación medida.
  }
}

/** Ejecuta `fn` y registra su duración (ms) y si terminó bien. Propaga el resultado y los errores. */
export async function measure<T>(
  metric: string,
  fn: () => Promise<T>,
  meta?: Record<string, MeterValue>,
): Promise<T> {
  const t0 = Date.now();
  try {
    const r = await fn();
    meter(metric, Date.now() - t0, "ms", { ...meta, ok: true });
    return r;
  } catch (e) {
    meter(metric, Date.now() - t0, "ms", { ...meta, ok: false });
    throw e;
  }
}

/** Destino en memoria para pruebas. */
export class InMemoryMeterSink implements MeterSink {
  readonly events: MeterEvent[] = [];
  record(event: MeterEvent): void {
    this.events.push(event);
  }
  clear(): void {
    this.events.length = 0;
  }
}
