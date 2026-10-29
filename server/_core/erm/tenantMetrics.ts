/**
 * Resource Manager — MÉTRICAS por empresa con su procedencia. Cada métrica dice si es:
 *  - `measured`: medida directamente (base de medición `es_erm`, cubos horarios);
 *  - `calculated`: calculada en el momento a partir de datos reales (tamaño de la BD, usuarios activos y contratados);
 *  - `estimated`: estimada (ninguna por ahora: el coste estimado está en /resources/costs);
 *  - `unavailable`: el sistema no la mide; nunca se muestra una cifra.
 * Solo cantidades agregadas: ni datos personales ni contenido de negocio.
 */
import type { UsageStore } from "./types";

export type MetricKind = "measured" | "calculated" | "estimated" | "unavailable";

export interface MetricDef {
  id: string;
  label: string;
  unit: "count" | "bytes" | "ms";
  kind: MetricKind;
  /** De dónde sale el dato (o por qué no hay). */
  source: string;
  group: "peticiones" | "trafico" | "almacenamiento" | "usuarios" | "procesamiento" | "comunicaciones" | "exportaciones" | "integraciones" | "infraestructura";
}

export const METRIC_CATALOG: MetricDef[] = [
  { id: "http.request", label: "Peticiones", unit: "count", kind: "measured", source: "Core: cada petición atribuida a la empresa", group: "peticiones" },
  { id: "http.request.ms", label: "Tiempo de servidor (peticiones)", unit: "ms", kind: "measured", source: "Core: duración de cada petición (tiempo de reloj)", group: "procesamiento" },
  { id: "http.response.bytes", label: "Tráfico saliente", unit: "bytes", kind: "measured", source: "Core: bytes de cada respuesta", group: "trafico" },
  { id: "job.run.ms", label: "Tiempo de tareas programadas", unit: "ms", kind: "measured", source: "Core: duración de cada tarea de la empresa", group: "procesamiento" },
  { id: "email.sent", label: "Correos enviados", unit: "count", kind: "measured", source: "Core: cada envío del proveedor de correo", group: "comunicaciones" },
  { id: "llm.tokens.input", label: "IA: tokens de entrada", unit: "count", kind: "measured", source: "Core: tokens que informa el proveedor de IA en cada llamada (cuenta de la plataforma)", group: "procesamiento" },
  { id: "llm.tokens.output", label: "IA: tokens de salida", unit: "count", kind: "measured", source: "Core: tokens generados que informa el proveedor de IA (cuenta de la plataforma)", group: "procesamiento" },
  { id: "llm.own.tokens", label: "IA con cuenta propia: tokens", unit: "count", kind: "measured", source: "Core: tokens con la cuenta de IA de la empresa (los paga ella; sin coste para la plataforma)", group: "procesamiento" },
  { id: "data_export.runs", label: "Exportaciones", unit: "count", kind: "measured", source: "Core: exportaciones de datos generadas", group: "exportaciones" },
  { id: "data_export.bytes", label: "Volumen exportado", unit: "bytes", kind: "measured", source: "Core: tamaño de las exportaciones", group: "exportaciones" },
  { id: "storage.write.bytes", label: "Ficheros subidos", unit: "bytes", kind: "measured", source: "Core: bytes escritos en el almacenamiento (no descuenta borrados)", group: "almacenamiento" },
  { id: "db.size.bytes", label: "Tamaño de la base de datos", unit: "bytes", kind: "calculated", source: "information_schema de la base de la empresa (datos + índices), en el momento", group: "almacenamiento" },
  { id: "users.active", label: "Usuarios activos (30 días)", unit: "count", kind: "calculated", source: "Base de la empresa: usuarios activos con inicio de sesión en los últimos 30 días", group: "usuarios" },
  { id: "users.enabled", label: "Usuarios habilitados", unit: "count", kind: "calculated", source: "Base de la empresa: usuarios no desactivados", group: "usuarios" },
  { id: "users.contracted", label: "Usuarios contratados", unit: "count", kind: "calculated", source: "Límite de usuarios del plan de la suscripción", group: "usuarios" },
  { id: "storage.total.bytes", label: "Almacenamiento ocupado", unit: "bytes", kind: "calculated", source: "Base de la empresa: suma de los ficheros vigentes (stored_objects; sin exportaciones de datos), en el momento", group: "almacenamiento" },
  { id: "email.delivered.30d", label: "Correos entregados (30 días)", unit: "count", kind: "calculated", source: "Bandeja de salida de la empresa (mail_outbox): aceptados o entregados por el proveedor", group: "comunicaciones" },
  { id: "email.problems.30d", label: "Correos con problemas (30 días)", unit: "count", kind: "calculated", source: "Bandeja de salida de la empresa: rebotados, bloqueados, con queja o fallidos", group: "comunicaciones" },
  { id: "jobs.queued", label: "Trabajos en cola", unit: "count", kind: "unavailable", source: "No hay cola por empresa medida (solo la duración de las tareas)", group: "procesamiento" },
  { id: "messaging.sms_whatsapp", label: "SMS y WhatsApp", unit: "count", kind: "unavailable", source: "Sin medición de mensajería", group: "comunicaciones" },
  { id: "integrations.outbound", label: "Llamadas a integraciones", unit: "count", kind: "unavailable", source: "Sin medición de llamadas salientes (GHL, webhooks)", group: "integraciones" },
  { id: "cpu", label: "CPU", unit: "ms", kind: "unavailable", source: "Despliegue compartido: no hay atribución fiable de CPU por empresa", group: "infraestructura" },
  { id: "memory", label: "Memoria", unit: "bytes", kind: "unavailable", source: "Despliegue compartido: no hay atribución fiable de memoria por empresa", group: "infraestructura" },
];

export interface TenantMetric extends MetricDef {
  /** Valor del periodo (medidas) o del momento (calculadas); `null` si no está disponible. */
  value: number | null;
  /** Motivo cuando una métrica medible o calculable no tiene valor ahora mismo. */
  missing?: string;
}

export interface TenantDbProbe {
  /** Tamaño de la base (datos + índices) y usuarios, con las credenciales PROPIAS de la empresa. */
  (tenantId: string): Promise<{ dbSizeBytes: number; usersEnabled: number; usersActive30d: number; storageBytes?: number | null; emailDelivered30d?: number | null; emailProblems30d?: number | null } | null>;
}

export async function tenantMetrics(
  d: { usage?: Pick<UsageStore, "list">; probe?: TenantDbProbe; seatLimit?: (tenantId: string) => Promise<number | null> },
  tenantId: string,
  now: number,
  days: number,
): Promise<{ metrics: TenantMetric[]; measurement: "ok" | "not_configured"; days: number; daily: Array<{ date: string } & Record<string, number | string>>; trend: Record<string, TrendInfo> }> {
  const totals: Record<string, number> = {};
  // Histórico diario (día civil de Madrid) de las métricas medidas, para tendencias
  const byDay = new Map<string, Record<string, number>>();
  if (d.usage) {
    const to = now + 3_600_000;
    for (const r of await d.usage.list(tenantId, to - days * 86_400_000, to)) {
      totals[r.metric] = (totals[r.metric] ?? 0) + r.quantity;
      const day = madridDay(r.hourStart);
      const row = byDay.get(day) ?? {};
      row[r.metric] = (row[r.metric] ?? 0) + r.quantity;
      byDay.set(day, row);
    }
  }
  const daily = Array.from(byDay.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, v]) => ({ date, ...v }));
  const trend = d.usage ? trendOf(daily, METRIC_CATALOG.filter((m) => m.kind === "measured").map((m) => m.id), madridDay(now), days) : {};
  const probe = d.probe ? await d.probe(tenantId).catch(() => null) : null;
  const seats = d.seatLimit ? await d.seatLimit(tenantId).catch(() => undefined) : undefined;
  const metrics = METRIC_CATALOG.map((m): TenantMetric => {
    if (m.kind === "unavailable") return { ...m, value: null };
    if (m.kind === "measured") return d.usage ? { ...m, value: totals[m.id] ?? 0 } : { ...m, value: null, missing: "Medición no configurada en este entorno" };
    if (m.id === "users.contracted") {
      if (seats === undefined) return { ...m, value: null, missing: "Sin información del plan" };
      return seats === null ? { ...m, value: null, missing: "Sin límite técnico (según contrato)" } : { ...m, value: seats };
    }
    if (!probe) return { ...m, value: null, missing: "No se pudo consultar la base de la empresa" };
    const v =
      m.id === "db.size.bytes" ? probe.dbSizeBytes
      : m.id === "users.active" ? probe.usersActive30d
      : m.id === "users.enabled" ? probe.usersEnabled
      : m.id === "storage.total.bytes" ? probe.storageBytes
      : m.id === "email.delivered.30d" ? probe.emailDelivered30d
      : m.id === "email.problems.30d" ? probe.emailProblems30d
      : undefined;
    if (v === undefined || v === null) return { ...m, value: null, missing: "La base de la empresa aún no tiene este dato" };
    return { ...m, value: v };
  });
  return { metrics, measurement: d.usage ? "ok" : "not_configured", days, daily, trend };
}

/** Día civil de Madrid (AAAA-MM-DD) de un instante. */
export const madridDay = (ms: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));

export interface TrendInfo {
  /** Media diaria de los últimos 7 días frente a la de los 7 anteriores (solo con al menos 14 días de periodo). */
  last7: number;
  previous7: number | null;
  change: number | null;
  direction: "up" | "down" | "flat" | "unknown";
}

/** Tendencia por métrica: últimos 7 días frente a los 7 anteriores (días sin consumo cuentan como 0). */
export function trendOf(daily: Array<{ date: string } & Record<string, number | string>>, metrics: string[], today: string, days: number): Record<string, TrendInfo> {
  const back = (n: number) => {
    const t = new Date(`${today}T12:00:00Z`);
    t.setUTCDate(t.getUTCDate() - n);
    return t.toISOString().slice(0, 10);
  };
  const sum = (from: number, to: number, m: string) => daily.filter((r) => r.date > back(to) && r.date <= back(from)).reduce((a, r) => a + Number(r[m] ?? 0), 0);
  const out: Record<string, TrendInfo> = {};
  for (const m of metrics) {
    const last7 = sum(0, 7, m) / 7;
    const previous7 = days >= 14 ? sum(7, 14, m) / 7 : null;
    const change = previous7 === null || previous7 === 0 ? null : (last7 - previous7) / previous7;
    const direction = previous7 === null ? "unknown" : previous7 === 0 ? (last7 > 0 ? "up" : "flat") : Math.abs(change!) < 0.1 ? "flat" : change! > 0 ? "up" : "down";
    out[m] = { last7: Math.round(last7 * 100) / 100, previous7: previous7 === null ? null : Math.round(previous7 * 100) / 100, change: change === null ? null : Math.round(change * 1000) / 1000, direction };
  }
  return out;
}

/** Sonda real: conecta con el DSN de la empresa (sus credenciales) y solo lee agregados de su propia base. */
export function mysqlTenantDbProbe(getDsn: (tenantId: string) => Promise<string | null>, connect: (dsn: string) => Promise<{ query: (sql: string) => Promise<[unknown, unknown]>; end: () => Promise<void> }>): TenantDbProbe {
  return async (tenantId) => {
    const dsn = await getDsn(tenantId);
    if (!dsn) return null;
    const c = await connect(dsn);
    try {
      const [size] = (await c.query("SELECT COALESCE(SUM(data_length + index_length), 0) AS b FROM information_schema.TABLES WHERE table_schema = DATABASE()")) as [Array<{ b: number | string }>, unknown];
      const [u] = (await c.query(
        "SELECT SUM(isActive = 1) AS enabled, SUM(isActive = 1 AND lastSignedIn >= NOW() - INTERVAL 30 DAY AND lastSignedIn > createdAt + INTERVAL 2 SECOND) AS active FROM users",
      )) as [Array<{ enabled: number | string | null; active: number | string | null }>, unknown];
      // Tablas de módulos posteriores al alta de algunas empresas: sin ellas, el dato queda «sin dato» (nunca 0 inventado)
      const optional = async (sql: string): Promise<Array<Record<string, unknown>> | null> => {
        try {
          return ((await c.query(sql)) as [Array<Record<string, unknown>>, unknown])[0];
        } catch (e) {
          if (/ER_NO_SUCH_TABLE|doesn't exist|ER_BAD_FIELD/i.test(String((e as { code?: string }).code ?? "") + String((e as Error).message))) return null;
          throw e;
        }
      };
      const st = await optional("SELECT COALESCE(SUM(size_bytes), 0) AS n FROM stored_objects WHERE status IN ('pending', 'active') AND category <> 'data-export'");
      const ml = await optional(
        "SELECT SUM(status IN ('accepted','delivered')) AS ok, SUM(status IN ('bounced','soft_bounced','blocked','complained','failed')) AS bad FROM mail_outbox WHERE created_at >= (UNIX_TIMESTAMP() - 30 * 86400) * 1000",
      );
      return {
        dbSizeBytes: Number(size[0]?.b ?? 0),
        usersEnabled: Number(u[0]?.enabled ?? 0),
        usersActive30d: Number(u[0]?.active ?? 0),
        storageBytes: st ? Number(st[0]?.n ?? 0) : null,
        emailDelivered30d: ml ? Number(ml[0]?.ok ?? 0) : null,
        emailProblems30d: ml ? Number(ml[0]?.bad ?? 0) : null,
      };
    } finally {
      await c.end().catch(() => undefined);
    }
  };
}
