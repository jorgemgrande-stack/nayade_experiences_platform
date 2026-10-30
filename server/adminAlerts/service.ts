/**
 * Alertas administrativas de Big Elephant (familia D): avisos INTERNOS a la administración cuando ocurre un hecho
 * confirmado (contratación, cobro, soporte, operaciones).
 *
 * Recorrido: hecho confirmado (evento comercial, notificador existente o tarea periódica) → `raise` → registro
 * (`admin_alert_log`, CRM 0030; la clave única es la idempotencia por evento) → reglas del CRM (activada, prioridad,
 * destinatarios, frecuencia) → bandeja de salida de la plataforma (`mail_outbox`) → proveedor.
 *
 * Reglas:
 *  - Nunca rompe el flujo que la llama: `raise` no lanza; un fallo queda anotado.
 *  - Un hecho, un aviso: la clave del evento y la del correo (`admin:<alerta>:<hecho>:<destinatario>`) impiden
 *    duplicados aunque el hecho llegue dos veces o desde dos réplicas. Cada hito de una contratación es una alerta
 *    distinta (contrato aceptado ≠ suscripción creada en Stripe ≠ primer cobro).
 *  - Destinatarios: los configurados en el CRM (por defecto administracion@bigelephant.es), más los propios de cada
 *    alerta y los de `CP_ALERT_EMAIL`. La política de correo manda por encima (modo, autorizados, ámbito, límites).
 *  - Saturación: frecuencia configurable para las no críticas (los repetidos se agrupan en un resumen); las críticas
 *    salen siempre al momento y no se pueden desactivar ni rebajar.
 *  - Escalado: un hecho que se repite (3 veces en 24 h en la misma empresa) sube un nivel de prioridad.
 */
import crypto from "node:crypto";
import { z } from "zod";
import { opsLog } from "../_core/ops/log";
import { normalizeEmail } from "../mail/policy";
import type { SendResult } from "../mail/service";
import type { MailCategory, MailContent } from "../mail/types";
import { CrmError } from "../crm/types";
import type { SettingsStore } from "../crm/leadNotices";
import { ADMIN_ALERTS, alertById, type AdminAlertSpec, type AlertFacts } from "./catalog";
import type { AdminAlertStore, AlertLogQuery, LogStatus } from "./store";
import { adminAlertEmail, adminDigestEmail, SEVERITY_LABEL, type AlertSeverity } from "./templates";

export const ADMIN_ALERTS_KEY = "admin_alerts";
export const DEFAULT_ADMIN_RECIPIENT = "administracion@bigelephant.es";
export const DEFAULT_TEST_RECIPIENT = "jorgemgrande@gmail.com";
const PLATFORM = "platform";
const MAX_RECIPIENTS = 10;
const ESCALATE_AFTER = 3;
const ESCALATE_WINDOW_MS = 24 * 3600_000;
const SEVERITIES: readonly AlertSeverity[] = ["info", "important", "critical"];
const short = (s: string) => crypto.createHash("sha256").update(s).digest("hex").slice(0, 16);

// ── Ajustes ───────────────────────────────────────────────────────────────────

export interface AlertRule {
  enabled: boolean;
  severity: AlertSeverity;
  extraRecipients: string[];
  /** Minutos entre correos de la misma alerta (0 = cada hecho). No aplica a las críticas. */
  frequencyMinutes: number;
}
export interface AdminAlertSettings {
  recipients: string[];
  testRecipient: string;
  /** Plazo de respuesta del equipo a un ticket (horas); al doble, el ticket se escala. */
  ticketSlaHours: number;
  rules: Record<string, AlertRule>;
}

const email = z.string().trim().toLowerCase().max(254).refine((v) => normalizeEmail(v) !== null, "correo no válido");
const ruleSchema = z.object({ enabled: z.boolean(), severity: z.enum(["info", "important", "critical"]), extraRecipients: z.array(email).max(MAX_RECIPIENTS), frequencyMinutes: z.number().int().min(0).max(24 * 60) }).strict();
export const adminSettingsSchema = z.object({ recipients: z.array(email).min(1).max(MAX_RECIPIENTS), testRecipient: email, ticketSlaHours: z.number().int().min(1).max(168), rules: z.record(z.string().max(64), ruleSchema) }).strict();
export const DEFAULT_TICKET_SLA_HOURS = 24;

const defaultRule = (a: AdminAlertSpec): AlertRule => ({ enabled: true, severity: a.severity, extraRecipients: [], frequencyMinutes: a.frequencyMinutes });

export function defaultAdminSettings(): AdminAlertSettings {
  return { recipients: [DEFAULT_ADMIN_RECIPIENT], testRecipient: DEFAULT_TEST_RECIPIENT, ticketSlaHours: DEFAULT_TICKET_SLA_HOURS, rules: Object.fromEntries(ADMIN_ALERTS.map((a) => [a.id, defaultRule(a)])) };
}

const uniqEmails = (list: unknown) => Array.from(new Set((Array.isArray(list) ? list : []).map((x) => normalizeEmail(x)).filter((x): x is string => !!x))).slice(0, MAX_RECIPIENTS);

/**
 * Normaliza lo guardado: alertas nuevas con sus valores por defecto y las CRÍTICAS bloqueadas siempre activas y
 * críticas (no se pueden apagar ni rebajar por accidente, ni con un ajuste antiguo).
 */
export function normalizeAdminSettings(raw: unknown): AdminAlertSettings {
  const base = defaultAdminSettings();
  const v = (raw ?? {}) as Partial<AdminAlertSettings>;
  const recipients = uniqEmails(v.recipients);
  const sla = Number.isInteger(v.ticketSlaHours) && v.ticketSlaHours! >= 1 && v.ticketSlaHours! <= 168 ? v.ticketSlaHours! : base.ticketSlaHours;
  const out: AdminAlertSettings = { recipients: recipients.length ? recipients : base.recipients, testRecipient: normalizeEmail(v.testRecipient) ?? base.testRecipient, ticketSlaHours: sla, rules: base.rules };
  for (const a of ADMIN_ALERTS) {
    const r = v.rules?.[a.id];
    if (!r || typeof r !== "object") continue;
    const sev = SEVERITIES.includes(r.severity) ? r.severity : a.severity;
    const freq = Number.isInteger(r.frequencyMinutes) && r.frequencyMinutes >= 0 && r.frequencyMinutes <= 1440 ? r.frequencyMinutes : a.frequencyMinutes;
    out.rules[a.id] = { enabled: a.locked ? true : r.enabled !== false, severity: a.locked ? "critical" : sev, extraRecipients: uniqEmails(r.extraRecipients), frequencyMinutes: freq };
  }
  return out;
}

/**
 * Vista previa de una alerta con sus DATOS FICTICIOS (pura). Sin `crmUrl`, enlaces a un dominio de ejemplo; con la URL
 * real del CRM (pruebas enviadas), el enlace lleva al listado de la sección, porque el expediente de ejemplo no existe.
 */
export function alertPreview(alertId: string, o: { test?: boolean; crmUrl?: string | null } = {}): (MailContent & { text: string }) | null {
  const spec = alertById(alertId);
  if (!spec) return null;
  const f = spec.sample;
  const link = f.link?.replace(/^\/+/, "");
  const crmUrl = !link ? null : o.crmUrl ? `${o.crmUrl}/${link.replace(/^(#\/(?:clientes|comercial\/[a-z-]+))\/[^/]+$/, "$1")}` : `https://admin.bigelephant.example/${link}`;
  return adminAlertEmail({ alert: spec, severity: spec.severity, intervention: f.intervention ?? spec.intervention, summary: f.summary, company: f.company ?? null, tenantId: f.tenantId ?? null, occurredAt: f.occurredAt, status: f.status, amount: f.amount ?? null, reference: f.reference ?? null, details: f.details ?? [], crmUrl, environment: "pruebas", escalated: null, grouped: 0, test: o.test });
}

// ── Servicio ──────────────────────────────────────────────────────────────────

/** Lo mínimo de la bandeja de la plataforma. */
export interface AlertMailer {
  send(tenantId: string | null, idempotencyKey: string, category: MailCategory, to: string, c: MailContent, o?: { deferOnRateLimit?: boolean; authorizedInternal?: boolean }): Promise<SendResult>;
  policy: { mode: string };
}

export interface AdminAlertDeps {
  store: AdminAlertStore;
  settings: SettingsStore;
  mailer: AlertMailer | null;
  /** `CP_ALERT_EMAIL`: destinatarios del entorno, siempre incluidos. */
  envRecipients?: readonly string[];
  /** Origen del CRM (https://admin…) para el enlace al expediente. */
  crmUrl: string | null;
  /** Entorno que se muestra en el aviso (production, live…). */
  environment?: string | null;
  /**
   * ¿Existen ya las tablas (CRM 0030)? En live el código arranca antes de que la publicación aplique la migración: se
   * comprueba en cada ciclo y, hasta entonces, las alertas no se activan (los avisos internos antiguos siguen).
   */
  tablesReady?: () => Promise<boolean>;
  now?: () => number;
}

export type RaiseOutcome = { status: LogStatus | "duplicate" | "unknown_alert"; recipients: number };

export class AdminAlertService {
  private now: () => number;
  private cache: { at: number; value: AdminAlertSettings } | null = null;
  private ready: boolean;
  constructor(private d: AdminAlertDeps) {
    this.now = d.now ?? Date.now;
    this.ready = !d.tablesReady;
  }

  /** Alertas activas (tablas listas): mientras no, los avisos internos antiguos siguen funcionando. */
  active(): boolean {
    return this.ready;
  }

  /** Comprueba (una vez lista, ya no) si existen las tablas de la migración 0030. */
  async checkReady(): Promise<boolean> {
    if (!this.ready && this.d.tablesReady) this.ready = await this.d.tablesReady().catch(() => false);
    return this.ready;
  }

  status(): { available: boolean; reason: string | null; mailMode: string } {
    if (!this.ready) return { available: false, reason: "migration_0030_missing", mailMode: this.d.mailer?.policy.mode ?? "off" };
    if (!this.d.mailer) return { available: false, reason: "mail_not_configured", mailMode: "off" };
    return { available: true, reason: null, mailMode: this.d.mailer.policy.mode };
  }

  async settings(): Promise<{ settings: AdminAlertSettings; version: number; updatedBy: string | null; updatedAt: number | null }> {
    const row = await this.d.settings.get(ADMIN_ALERTS_KEY);
    return { settings: normalizeAdminSettings(row?.value), version: row?.version ?? 0, updatedBy: row?.updatedBy ?? null, updatedAt: row?.updatedAt ?? null };
  }

  private async current(): Promise<AdminAlertSettings> {
    if (this.cache && this.now() - this.cache.at < 30_000) return this.cache.value;
    const value = (await this.settings()).settings;
    this.cache = { at: this.now(), value };
    return value;
  }

  async save(raw: unknown, expectedVersion: number, by: string, note: string | null = null) {
    const parsed = adminSettingsSchema.safeParse(raw);
    if (!parsed.success) throw new CrmError("invalid_input", `Ajustes no válidos: ${parsed.error.issues.map((i) => `${i.path.join(".")} (${i.message})`).join(", ")}`);
    const unknown = Object.keys(parsed.data.rules).filter((id) => !alertById(id));
    if (unknown.length) throw new CrmError("invalid_input", `Alertas desconocidas: ${unknown.join(", ")}`);
    // Una crítica no se apaga ni se rebaja: se rechaza en lugar de ignorarlo en silencio
    const locked = ADMIN_ALERTS.filter((a) => a.locked && parsed.data.rules[a.id] && (!parsed.data.rules[a.id].enabled || parsed.data.rules[a.id].severity !== "critical"));
    if (locked.length) throw new CrmError("invalid_input", `Las alertas críticas no se pueden desactivar ni rebajar: ${locked.map((a) => a.name).join(", ")}`);
    const value = normalizeAdminSettings(parsed.data);
    const row = await this.d.settings.save(ADMIN_ALERTS_KEY, value, expectedVersion, by.slice(0, 100), note, this.now());
    this.cache = null;
    opsLog("info", "AdminAlerts", "settings_saved", { version: row.version, by: by.slice(0, 100), recipients: value.recipients.length, disabled: ADMIN_ALERTS.filter((a) => !value.rules[a.id].enabled).map((a) => a.id) });
    return this.settings();
  }

  async history(limit = 30) {
    return (await this.d.settings.history(ADMIN_ALERTS_KEY, Math.min(100, Math.max(1, limit)))).map((h) => ({ version: h.version, settings: normalizeAdminSettings(h.value), updatedBy: h.updatedBy, updatedAt: h.updatedAt, note: h.note }));
  }

  /** Destinatarios efectivos de una alerta (generales + propios + entorno), sin repetir. */
  recipientsOf(s: AdminAlertSettings, id: string, skip: readonly string[] = []): string[] {
    const skipSet = new Set(skip.map((x) => x.toLowerCase()));
    return Array.from(new Set([...s.recipients, ...(s.rules[id]?.extraRecipients ?? []), ...(this.d.envRecipients ?? [])].map((x) => x.toLowerCase()))).filter((x) => !skipSet.has(x));
  }

  private link(f: AlertFacts): string | null {
    return this.d.crmUrl && f.link ? `${this.d.crmUrl}/${f.link.replace(/^\/+/, "")}` : null;
  }

  /**
   * Registra un hecho confirmado y avisa según las reglas. Nunca lanza. `duplicate`: el hecho ya estaba registrado
   * (no se vuelve a avisar).
   */
  async raise(alertId: string, f: AlertFacts): Promise<RaiseOutcome> {
    const spec = alertById(alertId);
    // Una alerta pendiente no tiene hecho que la active: nunca se envía
    if (!spec || spec.state !== "conectada") return { status: "unknown_alert", recipients: 0 };
    if (!this.ready) return { status: "unavailable", recipients: 0 };
    try {
      const s = await this.current();
      const rule = s.rules[alertId] ?? defaultRule(spec);
      const now = this.now();
      let severity: AlertSeverity = f.severity ?? rule.severity;
      if (spec.locked) severity = "critical";
      // Escalado por repetición (antes de registrar este hecho): 3 en 24 h en la misma empresa sube un nivel
      let escalated: string | null = f.escalated ?? null;
      if (!escalated && severity !== "critical") {
        const n = await this.d.store.countSince(alertId, f.tenantId ?? null, now - ESCALATE_WINDOW_MS);
        if (n + 1 >= ESCALATE_AFTER) {
          severity = severity === "info" ? "important" : "critical";
          escalated = `se ha repetido ${n + 1} veces en 24 horas${f.tenantId ? " en la misma empresa" : ""}`;
        }
      }
      // Frecuencia: ¿hubo ya un correo de esta alerta dentro de la ventana? (antes de registrar este hecho)
      const inWindow = severity !== "critical" && rule.frequencyMinutes > 0 && !escalated ? !!(await this.d.store.lastSent(alertId, null, now - rule.frequencyMinutes * 60_000)) : false;
      const id = await this.d.store.insert({ alertId, eventKey: f.key, severity, status: "sent", tenantId: f.tenantId ?? null, companyId: f.companyId ?? null, company: f.company ?? null, summary: f.summary, link: this.link(f), occurredAt: f.occurredAt, createdAt: now });
      if (id === null) return { status: "duplicate", recipients: 0 };
      const finish = async (status: LogStatus, n = 0) => {
        await this.d.store.finish(id, status, n);
        return { status, recipients: n };
      };
      if (!rule.enabled) return finish("disabled");
      if (!this.d.mailer) return finish("unavailable");
      // Dentro de la ventana, se agrupa para el resumen
      if (inWindow) return finish("grouped");
      const to = this.recipientsOf(s, alertId, f.skipRecipients);
      if (!to.length) return finish("no_recipients");
      const content = adminAlertEmail({ alert: spec, severity, intervention: f.intervention ?? spec.intervention, summary: f.summary, company: f.company ?? null, tenantId: f.tenantId ?? null, occurredAt: f.occurredAt, status: f.status, amount: f.amount ?? null, reference: f.reference ?? null, details: f.details ?? [], crmUrl: this.link(f), environment: this.d.environment ?? null, escalated, grouped: 0 });
      let queued = 0;
      for (const addr of to) {
        try {
          await this.d.mailer.send(PLATFORM, `admin:${alertId}:${short(f.key)}:${short(addr)}`, spec.category, addr, content, { deferOnRateLimit: true, authorizedInternal: true });
          queued++;
        } catch (e) {
          opsLog("error", "AdminAlerts", "send_failed", { alertId, error: e instanceof Error ? e.name : "error" });
        }
      }
      opsLog("info", "AdminAlerts", "raised", { alertId, severity, recipients: queued, tenantId: f.tenantId ?? null });
      return finish(queued ? "sent" : "failed", queued);
    } catch (e) {
      opsLog("error", "AdminAlerts", "raise_failed", { alertId, error: e instanceof Error ? e.name : "error" });
      return { status: "failed", recipients: 0 };
    }
  }

  /**
   * Resúmenes de los avisos agrupados: cuando vence la ventana de frecuencia de una alerta, un único correo con los
   * hechos acumulados. Idempotente (los agrupados pasan a «resumidos» y la clave del correo es la del resumen).
   */
  async flush(): Promise<{ digests: number }> {
    if (!this.d.mailer || !this.ready) return { digests: 0 };
    const s = await this.current();
    const now = this.now();
    const byAlert = new Map<string, Awaited<ReturnType<AdminAlertStore["grouped"]>>>();
    for (const r of await this.d.store.grouped(500)) byAlert.set(r.alertId, [...(byAlert.get(r.alertId) ?? []), r]);
    let digests = 0;
    for (const [alertId, rows] of Array.from(byAlert.entries())) {
      const spec = alertById(alertId);
      const rule = s.rules[alertId];
      if (!spec || !rule) continue;
      const windowMs = rule.frequencyMinutes * 60_000;
      if (windowMs > 0 && (await this.d.store.lastSent(alertId, null, now - windowMs))) continue;
      const since = Math.min(...rows.map((r) => r.occurredAt));
      const content = adminDigestEmail({ alert: spec, severity: rule.severity, items: rows.map((r) => ({ occurredAt: r.occurredAt, summary: r.summary, company: r.company })), total: rows.length, since, crmUrl: this.d.crmUrl ? `${this.d.crmUrl}/#/soporte/comunicaciones` : null });
      const key = `digest:${rows[0].id}-${rows[rows.length - 1].id}`;
      const logId = await this.d.store.insert({ alertId, eventKey: key, severity: rule.severity, status: "sent", tenantId: null, companyId: null, company: null, summary: `Resumen de ${rows.length} avisos agrupados`, link: null, occurredAt: now, createdAt: now });
      if (logId === null) continue;
      const to = this.recipientsOf(s, alertId);
      let queued = 0;
      for (const addr of to) {
        await this.d.mailer.send(PLATFORM, `admin:${alertId}:${short(key)}:${short(addr)}`, spec.category, addr, content, { deferOnRateLimit: true, authorizedInternal: true }).then(() => queued++, () => undefined);
      }
      await this.d.store.finish(logId, queued ? "sent" : "failed", queued);
      await this.d.store.markDigested(rows.map((r) => r.id), now);
      digests++;
    }
    return { digests };
  }

  /** Vista previa de una alerta con DATOS FICTICIOS (no envía nada). */
  preview(alertId: string, o: { test?: boolean } = {}): (MailContent & { text: string }) | null {
    return alertPreview(alertId, o);
  }

  /**
   * Envío de PRUEBA (datos ficticios, «[PRUEBA]» en el asunto) de cada alerta, una por correo, SOLO al destinatario de
   * pruebas configurado en el CRM. No registra hechos ni avisa a la administración.
   */
  async test(to: string, ids: string[] | null, by: string): Promise<{ results: Array<{ id: string; status: string; reason: string | null; outboxId: number | null }> }> {
    if (!this.d.mailer) throw new CrmError("invalid_state", "El correo de la plataforma no está configurado");
    const s = await this.current();
    const addr = normalizeEmail(to);
    if (!addr || addr !== s.testRecipient) throw new CrmError("invalid_input", `Las pruebas solo se envían al destinatario de pruebas configurado (${s.testRecipient})`);
    const list = ids ? ADMIN_ALERTS.filter((a) => ids.includes(a.id)) : ADMIN_ALERTS;
    const run = this.now().toString(36);
    const results = [];
    for (const a of list) {
      const c = alertPreview(a.id, { test: true, crmUrl: this.d.crmUrl })!;
      const r = await this.d.mailer.send(PLATFORM, `admin-test:${run}:${a.id}`, a.category, addr, c, { authorizedInternal: true });
      results.push({ id: a.id, status: r.status, reason: r.reason, outboxId: r.id });
    }
    opsLog("info", "AdminAlerts", "test_sent", { run, count: results.length, by: by.slice(0, 100) });
    return { results };
  }

  async log(q: AlertLogQuery) {
    return this.ready ? this.d.store.list(q) : [];
  }

  /** Catálogo con la configuración efectiva (para el CRM). */
  async catalog() {
    const { settings, version, updatedBy, updatedAt } = await this.settings();
    return {
      status: this.status(),
      version,
      updatedBy,
      updatedAt,
      settings,
      envRecipients: (this.d.envRecipients ?? []).length,
      alerts: ADMIN_ALERTS.map(({ sample: _s, ...a }) => ({ ...a, severityLabel: SEVERITY_LABEL[a.severity], rule: settings.rules[a.id], recipients: this.recipientsOf(settings, a.id) })),
    };
  }
}
