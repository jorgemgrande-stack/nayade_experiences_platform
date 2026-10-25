/**
 * Alertas críticas mínimas por repetición de fallos (ventana deslizante en memoria del proceso).
 *
 *  - Cada fallo relevante se anota con `recordFailure(kind)`. Al alcanzar el umbral dentro de la
 *    ventana se emite un evento `Alerts/threshold_exceeded` y, si el proceso tiene el servicio de
 *    incidencias (plano de control), se abre o actualiza una incidencia deduplicada `rate:<kind>`
 *    (mismo mecanismo que el resto de alertas: notificación solo al abrir/reabrir/escalar).
 *  - En el Core (sin escritura en el registro) la alerta queda en el log estructurado.
 *  - Las incidencias `rate.*` no se cierran solas: las resuelve un operador tras revisarlas.
 */
import type { IncidentService, Severity } from "./incidents";
import { opsLog } from "./log";

export interface FailureRule {
  /** Fallos dentro de la ventana que disparan la alerta. */
  threshold: number;
  windowMs: number;
  severity: Severity;
  title: string;
}

const MIN = 60_000;

/** Reglas por defecto (se pueden ajustar en `configureFailureAlerts`). */
export const DEFAULT_FAILURE_RULES: Record<string, FailureRule> = {
  "provisioning.failed": { threshold: 3, windowMs: 60 * MIN, severity: "critical", title: "Altas de empresa fallidas repetidas" },
  "mail.send_failed": { threshold: 5, windowMs: 15 * MIN, severity: "critical", title: "Fallos de envío de correo repetidos" },
  "orders.failed": { threshold: 3, windowMs: 30 * MIN, severity: "critical", title: "Errores repetidos en la contratación (pedidos/pagos)" },
  "licensing.check_failed": { threshold: 10, windowMs: 5 * MIN, severity: "warning", title: "No se pueden verificar licencias" },
  "notifications.dead": { threshold: 1, windowMs: 60 * MIN, severity: "warning", title: "Comunicaciones: un aviso transaccional se abandonó tras agotar los reintentos" },
  // Seguimiento del proveedor (webhooks): una queja basta para revisar; los rebotes, solo si se repiten
  "mail.complaint": { threshold: 1, windowMs: 24 * 60 * MIN, severity: "warning", title: "Correo: un destinatario ha marcado un aviso como spam (dirección suprimida)" },
  "mail.hard_bounce": { threshold: 5, windowMs: 60 * MIN, severity: "warning", title: "Correo: rebotes permanentes repetidos (revisar direcciones y reputación del dominio)" },
  "mail.rate_limited_deferred": { threshold: 1, windowMs: 60 * MIN, severity: "warning", title: "Avisos de solicitudes retenidos por el límite por hora (se envían solos en la siguiente franja)" },
};

export class FailureAlerts {
  private hits = new Map<string, number[]>();
  private rules: Record<string, FailureRule>;

  constructor(
    private opts: { incidents?: Pick<IncidentService, "raise">; rules?: Record<string, FailureRule>; now?: () => number } = {},
  ) {
    this.rules = { ...DEFAULT_FAILURE_RULES, ...(opts.rules ?? {}) };
  }

  /** Anota un fallo. Devuelve `true` si en esta anotación se alcanza o supera el umbral. */
  async record(kind: string, tenantId?: string | null): Promise<boolean> {
    const rule = this.rules[kind];
    if (!rule) return false;
    const now = (this.opts.now ?? Date.now)();
    const list = (this.hits.get(kind) ?? []).filter((t) => now - t < rule.windowMs);
    list.push(now);
    this.hits.set(kind, list);
    if (list.length < rule.threshold) return false;
    const windowMinutes = Math.round(rule.windowMs / MIN);
    opsLog("error", "Alerts", "threshold_exceeded", { kind, count: list.length, windowMinutes, severity: rule.severity });
    try {
      await this.opts.incidents?.raise({
        dedupeKey: `rate:${kind}`,
        kind: `rate.${kind}`,
        severity: rule.severity,
        title: rule.title,
        tenantId: null,
        details: { count: list.length, windowMinutes, lastTenant: tenantId ?? null },
      });
    } catch {
      opsLog("error", "Alerts", "incident_raise_failed", { kind });
    }
    return true;
  }

  count(kind: string): number {
    const rule = this.rules[kind];
    if (!rule) return 0;
    const now = (this.opts.now ?? Date.now)();
    return (this.hits.get(kind) ?? []).filter((t) => now - t < rule.windowMs).length;
  }
}

let current = new FailureAlerts();

/** Plano de control: conecta las alertas con el servicio de incidencias. */
export function configureFailureAlerts(a: FailureAlerts): void {
  current = a;
}

/** Anota un fallo sin esperar ni lanzar nunca (uso desde rutas de error). */
export function recordFailure(kind: string, tenantId?: string | null): void {
  current.record(kind, tenantId).catch(() => undefined);
}
