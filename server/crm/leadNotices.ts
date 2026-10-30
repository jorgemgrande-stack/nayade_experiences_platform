/**
 * Avisos INTERNOS de las solicitudes comerciales de la web (www.bigelephant.es) al equipo.
 *
 * Recorrido: formulario → API pública (/cp/v1/public/requests) → `WebRequestService.receive` (la solicitud se
 * GUARDA primero) → `onCreated` → aquí → bandeja de salida de la plataforma (`mail_outbox`) → Postmark.
 *
 * Reglas:
 *  - Primero se registra la solicitud; el aviso va después y nunca la rompe: un fallo del correo solo queda anotado.
 *  - No depende del navegador: el aviso sale del servidor al registrar, y un barrido periódico recupera las
 *    solicitudes recientes que se quedaron sin aviso (proceso reiniciado, base caída un instante…).
 *  - Destinatarios: SOLO operadores activos del CRM (cuentas con correo verificado por su propio acceso), elegidos
 *    por tipo de solicitud desde el CRM (`crm_settings.lead_notices`, con historial). Sin configurar = sin avisos.
 *    Nunca se escribe una dirección a mano, nunca se avisa al cliente.
 *  - La política de correo manda por encima de todo (modo, lista de destinatarios autorizados, ámbito, supresiones
 *    por rebote y límites): este módulo no puede ampliar a quién sale un correo.
 *  - Idempotencia: una clave por solicitud y destinatario (`lead-request:<id>:o<operador>`); los reintentos del
 *    formulario, del barrido o de otra réplica nunca duplican. Reintentos de fallos temporales: los de la bandeja
 *    (espera creciente, límite de intentos). Reenvío manual: clave nueva (`…:r<n>`), con registro de quién.
 *  - Interruptores: el ajuste `enabled` (global y por tipo) desde el CRM y `CP_LEAD_NOTICES=off` en el entorno.
 *    Apagar los avisos no detiene la captación.
 */
import { z } from "zod";
import type mysql from "mysql2/promise";
import { opsLog } from "../_core/ops/log";
import type { MailLedgerReader } from "../mail/store";
import type { MailCategory, MailContent, MailStatus } from "../mail/types";
import { RATE_DEFERRED, type SendResult } from "../mail/service";
import type { CrmService } from "./service";
import type { CrmStore } from "./store";
import { CrmError, LEAD_REQUEST_LABEL, LEAD_REQUEST_TYPES, type Lead, type LeadRequest, type LeadRequestType } from "./types";

export const LEAD_NOTICES_KEY = "lead_notices";
export const LEAD_NOTICE_CATEGORY: MailCategory = "lead_request_notice";
const PLATFORM = "platform";
const AUTHOR = "system:lead-notices";
/** Roles que pueden recibir avisos comerciales (los que atienden solicitudes). */
export const NOTICE_ROLES = ["superadmin", "admin", "sales"] as const;
/** El barrido solo recupera solicitudes de las últimas 2 horas (nunca reenvía el histórico al reactivar). */
const SWEEP_WINDOW_MS = 2 * 60 * 60 * 1000;
/** …y deja un margen para que el aviso inmediato termine antes de considerarla «sin aviso». */
const SWEEP_GRACE_MS = 60 * 1000;
const MAX_RECIPIENTS = 10;
const MAX_RESENDS = 5;

// ── Ajustes ───────────────────────────────────────────────────────────────────

export interface LeadNoticeRule {
  enabled: boolean;
  /** Ids de operadores del CRM. */
  recipients: number[];
}
export interface LeadNoticeSettings {
  enabled: boolean;
  rules: Record<LeadRequestType, LeadNoticeRule>;
}

const rule = z.object({ enabled: z.boolean(), recipients: z.array(z.number().int().positive()).max(MAX_RECIPIENTS) }).strict();
export const settingsSchema = z
  .object({
    enabled: z.boolean(),
    rules: z.object(Object.fromEntries(LEAD_REQUEST_TYPES.map((t) => [t, rule])) as Record<LeadRequestType, typeof rule>).strict(),
  })
  .strict();

/** Sin configurar: todo apagado y sin destinatarios (nunca se avisa a nadie por defecto). */
export function defaultSettings(): LeadNoticeSettings {
  return { enabled: false, rules: Object.fromEntries(LEAD_REQUEST_TYPES.map((t) => [t, { enabled: false, recipients: [] as number[] }])) as unknown as Record<LeadRequestType, LeadNoticeRule> };
}

/** Normaliza lo guardado (tipos nuevos que no existían al guardarse quedan apagados). */
export function normalizeSettings(raw: unknown): LeadNoticeSettings {
  const base = defaultSettings();
  const v = (raw ?? {}) as Partial<LeadNoticeSettings>;
  const out: LeadNoticeSettings = { enabled: v.enabled === true, rules: base.rules };
  for (const t of LEAD_REQUEST_TYPES) {
    const r = v.rules?.[t];
    if (r && typeof r === "object") out.rules[t] = { enabled: r.enabled === true, recipients: Array.from(new Set((r.recipients ?? []).filter((x) => Number.isInteger(x) && x > 0))).slice(0, MAX_RECIPIENTS) };
  }
  return out;
}

export interface SettingRow {
  key: string;
  value: unknown;
  version: number;
  updatedBy: string;
  updatedAt: number;
}
export interface SettingHistoryRow extends SettingRow {
  note: string | null;
}

/** Ajustes del CRM con versión optimista e historial inmutable (CRM 0025). */
export interface SettingsStore {
  get(key: string): Promise<SettingRow | null>;
  /** Guarda si la versión actual es `expectedVersion` (0 = no existía); si no, conflicto. */
  save(key: string, value: unknown, expectedVersion: number, by: string, note: string | null, now: number): Promise<SettingRow>;
  history(key: string, limit: number): Promise<SettingHistoryRow[]>;
  version(key: string, version: number): Promise<SettingHistoryRow | null>;
}

export class MemorySettingsStore implements SettingsStore {
  private rows = new Map<string, SettingRow>();
  private hist: SettingHistoryRow[] = [];
  async get(key: string) {
    const r = this.rows.get(key);
    return r ? structuredClone(r) : null;
  }
  async save(key: string, value: unknown, expectedVersion: number, by: string, note: string | null, now: number) {
    const cur = this.rows.get(key);
    if ((cur?.version ?? 0) !== expectedVersion) throw new CrmError("conflict", "Otra persona ha cambiado estos ajustes; recarga y vuelve a intentarlo");
    const row: SettingRow = { key, value: structuredClone(value), version: expectedVersion + 1, updatedBy: by, updatedAt: now };
    this.rows.set(key, row);
    this.hist.push({ ...structuredClone(row), note });
    return structuredClone(row);
  }
  async history(key: string, limit: number) {
    return this.hist.filter((h) => h.key === key).sort((a, b) => b.version - a.version).slice(0, limit).map((h) => structuredClone(h));
  }
  async version(key: string, version: number) {
    const h = this.hist.find((x) => x.key === key && x.version === version);
    return h ? structuredClone(h) : null;
  }
}

const parseJson = (v: unknown) => (typeof v === "string" ? JSON.parse(v) : v);

export class MysqlSettingsStore implements SettingsStore {
  constructor(private pool: Pick<mysql.Pool, "query" | "getConnection">) {}
  async get(key: string) {
    const [rows] = (await this.pool.query("SELECT setting_key, value_json, version, updated_by, updated_at FROM crm_settings WHERE setting_key = ?", [key])) as unknown as [any[]];
    const r = rows[0];
    return r ? { key: r.setting_key, value: parseJson(r.value_json), version: Number(r.version), updatedBy: r.updated_by, updatedAt: Number(r.updated_at) } : null;
  }
  async save(key: string, value: unknown, expectedVersion: number, by: string, note: string | null, now: number) {
    const conn = await this.pool.getConnection();
    const json = JSON.stringify(value);
    const next = expectedVersion + 1;
    try {
      await conn.beginTransaction();
      const [cur] = (await conn.query("SELECT version FROM crm_settings WHERE setting_key = ? FOR UPDATE", [key])) as unknown as [any[]];
      if ((cur[0] ? Number(cur[0].version) : 0) !== expectedVersion) throw new CrmError("conflict", "Otra persona ha cambiado estos ajustes; recarga y vuelve a intentarlo");
      if (cur[0]) await conn.query("UPDATE crm_settings SET value_json = ?, version = ?, updated_by = ?, updated_at = ? WHERE setting_key = ?", [json, next, by, now, key]);
      else await conn.query("INSERT INTO crm_settings (setting_key, value_json, version, updated_by, updated_at) VALUES (?, ?, ?, ?, ?)", [key, json, next, by, now]);
      await conn.query("INSERT INTO crm_settings_history (setting_key, version, value_json, updated_by, updated_at, note) VALUES (?, ?, ?, ?, ?, ?)", [key, next, json, by, now, note]);
      await conn.commit();
    } catch (e) {
      await conn.rollback().catch(() => undefined);
      throw e;
    } finally {
      conn.release();
    }
    return { key, value, version: next, updatedBy: by, updatedAt: now };
  }
  async history(key: string, limit: number) {
    const [rows] = (await this.pool.query("SELECT setting_key, version, value_json, updated_by, updated_at, note FROM crm_settings_history WHERE setting_key = ? ORDER BY version DESC LIMIT ?", [key, limit])) as unknown as [any[]];
    return rows.map((r) => ({ key: r.setting_key, value: parseJson(r.value_json), version: Number(r.version), updatedBy: r.updated_by, updatedAt: Number(r.updated_at), note: r.note ?? null }));
  }
  async version(key: string, version: number) {
    const [rows] = (await this.pool.query("SELECT setting_key, version, value_json, updated_by, updated_at, note FROM crm_settings_history WHERE setting_key = ? AND version = ?", [key, version])) as unknown as [any[]];
    const r = rows[0];
    return r ? { key: r.setting_key, value: parseJson(r.value_json), version: Number(r.version), updatedBy: r.updated_by, updatedAt: Number(r.updated_at), note: r.note ?? null } : null;
  }
}

/** ¿Existe la migración 0025? Sin ella, el módulo no se monta (las solicitudes se registran igual). */
export async function settingsTablesReady(pool: Pick<mysql.Pool, "query">): Promise<boolean> {
  return pool.query("SELECT 1 FROM crm_settings_history LIMIT 0").then(() => true, () => false);
}

// ── Servicio ──────────────────────────────────────────────────────────────────

export interface NoticeOperator {
  id: number;
  email: string | null;
  displayName: string;
  role: string;
  status: string;
}

/** Lo mínimo de la bandeja de la plataforma que necesita este módulo. */
export interface NoticeMailer {
  send(tenantId: string | null, idempotencyKey: string, category: MailCategory, to: string, c: MailContent, o?: { deferOnRateLimit?: boolean }): Promise<SendResult>;
  t: { leadRequestNotice(i: Parameters<LeadNoticeTemplate>[0]): MailContent };
  policy: { mode: string };
}
type LeadNoticeTemplate = (i: {
  typeLabel: string;
  reference: string;
  receivedAt: number;
  company: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  sector: string | null;
  product: string | null;
  message: string | null;
  sourcePage: string | null;
  owner: string | null;
  crmUrl: string | null;
}) => MailContent;

export interface NoticeView {
  id: number;
  status: MailStatus;
  reason: string | null;
  recipient: string;
  attempts: number;
  lastError: string | null;
  resend: boolean;
  createdAt: number;
  updatedAt: number;
}
/** Resumen para la bandeja: el peor estado manda (fallo > pendiente > entregado). */
export type NoticeSummary = { state: "none" | "pending" | "deferred" | "sent" | "delivered" | "failed" | "skipped"; count: number };

export type NotifyOutcome =
  | { status: "sent"; queued: number; results: Array<{ operatorId: number; status: MailStatus; duplicate: boolean }> }
  | { status: "disabled" | "no_recipients" | "unavailable"; reason: string };

const FAILED: ReadonlySet<MailStatus> = new Set<MailStatus>(["failed", "bounced", "blocked", "complained"]);
const DONE: ReadonlySet<MailStatus> = new Set<MailStatus>(["accepted", "delivered", "soft_bounced"]);

export function summarize(rows: Array<{ status: MailStatus; reason?: string | null }>): NoticeSummary {
  if (!rows.length) return { state: "none", count: 0 };
  const has = (f: (s: MailStatus) => boolean) => rows.some((r) => f(r.status));
  const state = has((s) => FAILED.has(s))
    ? "failed"
    : rows.some((r) => r.status === "pending" && r.reason === RATE_DEFERRED)
      ? "deferred"
      : has((s) => s === "pending" || s === "sending")
      ? "pending"
      : rows.every((r) => r.status === "delivered")
        ? "delivered"
        : has((s) => DONE.has(s))
          ? "sent"
          : "skipped";
  return { state, count: rows.length };
}

/** Texto del producto o servicio solicitado (ids del catálogo, tal y como llegan de la web). */
export function productOf(r: Pick<LeadRequest, "configuration" | "interest">): string | null {
  const c = r.configuration;
  const parts = c ? [c.plan ? `plan ${c.plan}` : null, c.extensions.length ? `extensiones: ${c.extensions.join(", ")}` : null, c.industries.length ? `sector: ${c.industries.join(", ")}` : null, c.interests.length ? `interés: ${c.interests.join(", ")}` : null].filter(Boolean) : [];
  if (r.interest) parts.push(r.interest);
  return parts.length ? parts.join(" · ") : null;
}

export interface LeadNoticeDeps {
  settings: SettingsStore;
  store: Pick<CrmStore, "get" | "list">;
  crm: Pick<CrmService, "log">;
  /** Sin bandeja de plataforma (correo no configurado): los ajustes se gestionan pero no sale nada. */
  mailer: NoticeMailer | null;
  ledger: MailLedgerReader | null;
  operators: () => Promise<NoticeOperator[]>;
  /** Origen del CRM (https://admin…): el enlace del aviso abre la ficha y exige iniciar sesión. */
  crmUrl: string | null;
  /** `CP_LEAD_NOTICES=off`: interruptor de entorno, por encima de los ajustes. */
  killSwitch?: boolean;
  now?: () => number;
  log?: (event: string, data: Record<string, unknown>) => void;
}

export class LeadNoticeService {
  private now: () => number;
  private log: (event: string, data: Record<string, unknown>) => void;
  constructor(private d: LeadNoticeDeps) {
    this.now = d.now ?? Date.now;
    this.log = d.log ?? ((event, data) => opsLog(event.endsWith("_failed") ? "error" : "info", "LeadNotices", event, data));
  }

  /** Estado del módulo para el CRM: si puede enviar y por qué no. */
  status(): { available: boolean; reason: string | null; mailMode: string } {
    if (this.d.killSwitch) return { available: false, reason: "disabled_by_environment", mailMode: this.d.mailer?.policy.mode ?? "off" };
    if (!this.d.mailer) return { available: false, reason: "mail_not_configured", mailMode: "off" };
    return { available: true, reason: null, mailMode: this.d.mailer.policy.mode };
  }

  async settings(): Promise<{ settings: LeadNoticeSettings; version: number; updatedBy: string | null; updatedAt: number | null }> {
    const row = await this.d.settings.get(LEAD_NOTICES_KEY);
    return { settings: normalizeSettings(row?.value), version: row?.version ?? 0, updatedBy: row?.updatedBy ?? null, updatedAt: row?.updatedAt ?? null };
  }

  /** Operadores que pueden recibir avisos: activos, con correo y con un rol comercial o de administración. */
  async candidates(): Promise<Array<{ id: number; displayName: string; email: string; role: string }>> {
    return (await this.d.operators())
      .filter((o) => o.status === "active" && !!o.email && (NOTICE_ROLES as readonly string[]).includes(o.role))
      .map((o) => ({ id: o.id, displayName: o.displayName, email: o.email!, role: o.role }));
  }

  async save(raw: unknown, expectedVersion: number, by: string, note: string | null = null) {
    const parsed = settingsSchema.safeParse(raw);
    if (!parsed.success) throw new CrmError("invalid_input", `Ajustes no válidos: ${parsed.error.issues.map((i) => i.path.join(".")).join(", ")}`);
    const valid = new Set((await this.candidates()).map((c) => c.id));
    const unknown = LEAD_REQUEST_TYPES.flatMap((t) => parsed.data.rules[t].recipients.filter((id) => !valid.has(id)));
    if (unknown.length) throw new CrmError("invalid_input", "Solo pueden recibir avisos operadores activos del CRM con correo y rol comercial o de administración");
    const value = normalizeSettings(parsed.data);
    const row = await this.d.settings.save(LEAD_NOTICES_KEY, value, expectedVersion, by.slice(0, 100), note, this.now());
    this.log("settings_saved", { version: row.version, by: by.slice(0, 100), enabled: value.enabled, types: LEAD_REQUEST_TYPES.filter((t) => value.rules[t].enabled) });
    return this.settings();
  }

  async history(limit = 30) {
    return (await this.d.settings.history(LEAD_NOTICES_KEY, Math.min(100, Math.max(1, limit)))).map((h) => ({ version: h.version, settings: normalizeSettings(h.value), updatedBy: h.updatedBy, updatedAt: h.updatedAt, note: h.note }));
  }

  /** Recupera una versión anterior como versión NUEVA (el historial no se reescribe). Revalida los destinatarios. */
  async restore(version: number, expectedVersion: number, by: string) {
    const h = await this.d.settings.version(LEAD_NOTICES_KEY, version);
    if (!h) throw new CrmError("not_found", "Versión no encontrada");
    const value = normalizeSettings(h.value);
    // Un operador desactivado desde entonces no vuelve a recibir avisos
    const valid = new Set((await this.candidates()).map((c) => c.id));
    for (const t of LEAD_REQUEST_TYPES) value.rules[t].recipients = value.rules[t].recipients.filter((id) => valid.has(id));
    return this.save(value, expectedVersion, by, `Recuperada la versión ${version}`);
  }

  /** Correos que recibirán el aviso comercial de un tipo (para que otro aviso del mismo hecho no les llegue dos veces). */
  async noticeEmails(type: LeadRequestType): Promise<string[]> {
    if (!this.status().available) return [];
    const { settings } = await this.settings();
    if (!settings.enabled || !settings.rules[type].enabled) return [];
    return (await this.recipientsFor(type, settings)).map((c) => c.email.toLowerCase());
  }

  /** Destinatarios efectivos de un tipo (operadores válidos AHORA). */
  private async recipientsFor(type: LeadRequestType, s: LeadNoticeSettings) {
    const ids = new Set(s.rules[type].recipients);
    return (await this.candidates()).filter((c) => ids.has(c.id));
  }

  /** Tras registrar una solicitud NUEVA. Nunca lanza: la captación no depende del correo. */
  async onCreated(request: LeadRequest): Promise<void> {
    try {
      const out = await this.notify(request.id, "receive");
      if (out.status !== "sent") await this.note(request.leadId, `Aviso interno de ${request.reference} no enviado: ${REASON_LABEL[out.reason] ?? out.reason}`);
    } catch (e) {
      this.log("notify_failed", { requestId: request.id, error: e instanceof Error ? e.name : "error" });
    }
  }

  /** Avisa de una solicitud a los destinatarios de su tipo. `resend`: reenvío manual con clave nueva. */
  async notify(requestId: number, origin: "receive" | "sweep" | "resend", by?: string): Promise<NotifyOutcome> {
    const st = this.status();
    if (!st.available) return { status: "unavailable", reason: st.reason! };
    const request = await this.d.store.get("leadRequests", requestId);
    if (!request) throw new CrmError("not_found", "Solicitud no encontrada");
    const lead = await this.d.store.get("leads", request.leadId);
    if (!lead) throw new CrmError("not_found", "Lead no encontrado");
    const { settings } = await this.settings();
    if (!settings.enabled) return { status: "disabled", reason: "notices_disabled" };
    if (!settings.rules[request.type].enabled) return { status: "disabled", reason: "type_disabled" };
    const to = await this.recipientsFor(request.type, settings);
    if (!to.length) return { status: "no_recipients", reason: "no_recipients" };
    let suffix = "";
    if (origin === "resend") {
      const prev = await this.notices(requestId);
      const n = prev.filter((p) => p.resend).length / Math.max(1, to.length);
      if (n >= MAX_RESENDS) throw new CrmError("invalid_state", `Como mucho ${MAX_RESENDS} reenvíos por solicitud`);
      suffix = `:r${Math.floor(n) + 1}`;
    }
    const content = this.d.mailer!.t.leadRequestNotice(this.contentFor(request, lead));
    const results: Array<{ operatorId: number; status: MailStatus; duplicate: boolean }> = [];
    for (const op of to) {
      // Una entrega fallida a un destinatario no impide avisar a los demás
      try {
        // Si se alcanza el límite por hora, el aviso se retiene para la siguiente franja: nunca se pierde
        const r = await this.d.mailer!.send(PLATFORM, `lead-request:${request.id}:o${op.id}${suffix}`, LEAD_NOTICE_CATEGORY, op.email, content, { deferOnRateLimit: true });
        results.push({ operatorId: op.id, status: r.status, duplicate: r.duplicate });
      } catch (e) {
        this.log("send_failed", { requestId: request.id, operatorId: op.id, error: e instanceof Error ? e.name : "error" });
        results.push({ operatorId: op.id, status: "failed", duplicate: false });
      }
    }
    const fresh = results.filter((r) => !r.duplicate);
    this.log("notified", { requestId: request.id, type: request.type, origin, recipients: to.length, queued: fresh.length, statuses: results.map((r) => r.status) });
    if (fresh.length && origin !== "receive") await this.note(lead.id, `Aviso interno de ${request.reference} ${origin === "resend" ? `reenviado por ${by ?? "el equipo"}` : "enviado por el barrido de recuperación"} a ${fresh.length} destinatario(s)`);
    else if (fresh.length) await this.note(lead.id, `Aviso interno de ${request.reference} enviado a ${fresh.length} destinatario(s) del equipo`);
    return { status: "sent", queued: fresh.length, results };
  }

  /** Avisos de una solicitud (trazabilidad: destinatario enmascarado, estado, intentos, último error). */
  async notices(requestId: number): Promise<NoticeView[]> {
    if (!this.d.ledger) return [];
    const rows = await this.d.ledger.list({ tenantId: PLATFORM, template: `lead-request:${requestId}`, limit: 60 });
    return rows.map((r) => ({ id: r.id, status: r.status, reason: r.reason, recipient: r.recipient, attempts: r.attempts, lastError: r.lastError, resend: /:r\d+$/.test(r.idempotencyKey), createdAt: r.createdAt, updatedAt: r.updatedAt }));
  }

  async summaries(requestIds: number[]): Promise<Record<number, NoticeSummary>> {
    const out: Record<number, NoticeSummary> = {};
    for (const id of requestIds) out[id] = summarize(await this.notices(id));
    return out;
  }

  /** Avisos retenidos ahora por el límite por hora (alerta del CRM): saldrán solos en la siguiente franja. */
  async deferred(): Promise<{ count: number; nextAt: number | null }> {
    if (!this.d.ledger) return { count: 0, nextAt: null };
    const rows = (await this.d.ledger.list({ tenantId: PLATFORM, category: LEAD_NOTICE_CATEGORY, status: "pending", limit: 200 })).filter((r) => r.reason === RATE_DEFERRED);
    const next = rows.map((r) => r.nextAttemptAt).filter((x): x is number => x !== null);
    return { count: rows.length, nextAt: next.length ? Math.min(...next) : null };
  }

  /**
   * Recupera las solicitudes recientes (2 h) que no tienen ningún aviso: un proceso reiniciado justo después de
   * registrar o un fallo de la base al encolar. Idempotente (misma clave): ejecutarlo en dos réplicas no duplica.
   */
  async sweep(): Promise<{ checked: number; notified: number }> {
    if (!this.status().available) return { checked: 0, notified: 0 };
    const { settings } = await this.settings();
    if (!settings.enabled) return { checked: 0, notified: 0 };
    const now = this.now();
    const recent = (await this.d.store.list("leadRequests", { status: "pending" }, { desc: true, limit: 200 })).filter((r) => r.createdAt > now - SWEEP_WINDOW_MS && r.createdAt < now - SWEEP_GRACE_MS);
    let notified = 0;
    for (const r of recent) {
      if (!settings.rules[r.type].enabled) continue;
      if ((await this.notices(r.id)).length) continue;
      const out = await this.notify(r.id, "sweep").catch((e) => {
        this.log("sweep_failed", { requestId: r.id, error: e instanceof Error ? e.name : "error" });
        return null;
      });
      if (out?.status === "sent" && out.queued) notified++;
    }
    if (notified) this.log("sweep", { checked: recent.length, notified });
    return { checked: recent.length, notified };
  }

  /**
   * Aviso de PRUEBA a los destinatarios configurados de un tipo, sin crear ninguna solicitud ni oportunidad: sirve
   * para comprobar la entrega real en production. Marcado como prueba en el asunto y con datos ficticios evidentes.
   */
  async test(type: LeadRequestType, by: string): Promise<NotifyOutcome> {
    const st = this.status();
    if (!st.available) return { status: "unavailable", reason: st.reason! };
    const { settings } = await this.settings();
    const to = await this.recipientsFor(type, settings);
    if (!to.length) return { status: "no_recipients", reason: "no_recipients" };
    const base = this.d.mailer!.t.leadRequestNotice({
      typeLabel: LEAD_REQUEST_LABEL[type],
      reference: "SOL-PRUEBA",
      receivedAt: this.now(),
      company: "Empresa de prueba (no es una solicitud real)",
      name: "Prueba del aviso interno",
      email: null,
      phone: null,
      sector: null,
      product: null,
      message: `Correo de comprobación enviado desde el CRM por ${by.slice(0, 100)}. No hay ninguna solicitud que atender.`,
      sourcePage: null,
      owner: null,
      crmUrl: this.d.crmUrl ? `${this.d.crmUrl}/#/comercial/leads` : null,
    });
    const content = { ...base, subject: `[PRUEBA] ${base.subject}` };
    const stamp = this.now();
    const results: Array<{ operatorId: number; status: MailStatus; duplicate: boolean }> = [];
    for (const op of to) {
      const r = await this.d.mailer!.send(PLATFORM, `lead-notice-test:${type}:${stamp}:o${op.id}`, LEAD_NOTICE_CATEGORY, op.email, content);
      results.push({ operatorId: op.id, status: r.status, duplicate: r.duplicate });
    }
    this.log("test_sent", { type, by: by.slice(0, 100), recipients: to.length, statuses: results.map((r) => r.status) });
    return { status: "sent", queued: results.length, results };
  }

  private contentFor(r: LeadRequest, l: Lead): Parameters<LeadNoticeTemplate>[0] {
    return {
      typeLabel: LEAD_REQUEST_LABEL[r.type],
      reference: r.reference,
      receivedAt: r.createdAt,
      company: l.companyName ?? null,
      name: l.name,
      email: l.email ?? null,
      phone: l.phone ?? null,
      sector: r.sector ?? null,
      product: productOf(r),
      message: r.message ?? null,
      sourcePage: r.sourcePage ?? null,
      owner: l.owner ?? null,
      crmUrl: this.d.crmUrl ? `${this.d.crmUrl}/#/comercial/leads/${l.id}` : null,
    };
  }

  private async note(leadId: number, text: string) {
    await this.d.crm.log("lead", leadId, "note", text.slice(0, 1000), AUTHOR).catch(() => undefined);
  }
}

const REASON_LABEL: Record<string, string> = {
  disabled_by_environment: "avisos desactivados en el entorno",
  mail_not_configured: "correo de la plataforma no configurado",
  notices_disabled: "avisos desactivados en el CRM",
  type_disabled: "avisos desactivados para este tipo de solicitud",
  no_recipients: "sin destinatarios configurados",
};

/** Origen del CRM para los enlaces: `CP_CRM_URL` o, si falta, el origen de `CP_RESET_URL` (la página del CRM). */
export function crmUrlFromEnv(env: NodeJS.ProcessEnv): string | null {
  for (const raw of [env.CP_CRM_URL, env.CP_RESET_URL]) {
    try {
      if (raw) {
        const u = new URL(raw.trim());
        if (u.protocol === "https:") return u.origin;
      }
    } catch {
      /* no válida */
    }
  }
  return null;
}
