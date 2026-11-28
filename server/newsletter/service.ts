/**
 * Newsletter · lógica de suscripción (sin base de datos ni correo directos: todo llega por puertos).
 *
 * Flujo: alta pública → suscripción PENDIENTE + correo de confirmación con enlace individual y caducidad → al confirmar
 * pasa a ACTIVA, se registra el consentimiento en el CRM (cliente + consentimiento de marketing) y sale UN correo de
 * bienvenida → la baja (enlace o administración) retira la suscripción y el consentimiento de marketing del cliente.
 *
 * Reglas:
 *  - Ninguna suscripción pasa a activa sin que la propia persona confirme con su enlace: no existe una operación de
 *    «activar» para el personal. Reactivar una baja exige un consentimiento nuevo y su confirmación.
 *  - La respuesta pública es siempre la misma exista o no el correo (no se puede averiguar quién está suscrito).
 *  - Cada correo se registra con una clave de idempotencia ÚNICA: reintentar no duplica la confirmación ni la bienvenida.
 *  - El texto legal aceptado (y su versión) lo fija el servidor desde el bloque publicado, nunca el navegador.
 *  - Un solo contacto por correo, con historial. El idioma es el de la WEB desde la que se inscribe (política en
 *    shared/newsletterLocalePolicy.ts: ruta → traducción del bloque → pista del formulario → principal; nunca país/IP),
 *    contrastado con los idiomas públicos de la empresa. `signup_locale` guarda el de la primera alta y no cambia.
 *  - `imported` (histórico sin consentimiento acreditado) nunca recibe correos; si la persona se inscribe desde la web,
 *    pasa a pendiente con el consentimiento de esa petición y conserva nombre, lote e historial.
 */
import type { MailIdentity, MailTemplate, SubscriberStatus, TemplatesJson, ExportRow } from "./core";
import { CONFIRM_COOLDOWN_MS, CONFIRM_MAX_SENDS, CONFIRM_TTL_MS, LOCALES, consentVersion, newConfirmToken, normalizeEmail, renderMail, resolveTemplate, sha256, unsubscribeToken, cleanText } from "./core";
import { normalizeLocale as normalizeI18nLocale } from "../../shared/i18n";
import { listLabel, listLocales, localeOfSegment, resolveSignupLocale, segmentIdFor, type LocaleSource } from "../../shared/newsletterLocalePolicy";

export type NewsletterErrorCode = "invalid_input" | "no_consent" | "rate_limited" | "unavailable" | "not_found" | "conflict";
export class NewsletterError extends Error {
  constructor(readonly code: NewsletterErrorCode, message: string) {
    super(message);
  }
}

export interface Subscriber {
  id: number;
  email: string;
  status: SubscriberStatus;
  /** Idioma actual (lista `newsletter-<locale>`). Un idioma público de la empresa. */
  locale: string;
  /** Idioma de la web de la PRIMERA alta (no cambia). null en un histórico que aún no se ha inscrito. */
  signupLocale: string | null;
  localeSource: LocaleSource;
  name: string | null;
  importId: number | null;
  importedAt: number | null;
  source: string;
  page: string | null;
  clientId: number | null;
  consentText: string | null;
  consentVersion: string | null;
  consentAt: number | null;
  confirmExpiresAt: number | null;
  confirmSentCount: number;
  lastConfirmSentAt: number | null;
  confirmedAt: number | null;
  unsubscribedAt: number | null;
  unsubscribedBy: string | null;
  welcomeSentAt: number | null;
  crmSyncError: string | null;
  createdAt: number;
  updatedAt: number;
}
export interface SubscriberEvent {
  id: number;
  action: string;
  consentText: string | null;
  consentVersion: string | null;
  actor: string;
  detail: string | null;
  at: number;
}
export interface MailLogEntry {
  id: number;
  kind: "confirm" | "welcome";
  status: "sending" | "sent" | "failed";
  error: string | null;
  at: number;
  finishedAt: number | null;
}
export interface Settings {
  enabled: boolean;
  publicEnabled: boolean;
  templates: TemplatesJson;
}
export interface ListFilters {
  q?: string;
  status?: SubscriberStatus;
  locale?: string;
  /** Alias de `locale`: identificador de lista (`newsletter-de`). */
  list?: string;
  source?: string;
  dateField?: "createdAt" | "confirmedAt" | "unsubscribedAt";
  from?: number;
  to?: number;
}
export interface ListQuery extends ListFilters {
  sort: "createdAt" | "email" | "confirmedAt" | "status" | "locale" | "source";
  dir: "asc" | "desc";
  page: number;
  pageSize: number;
}
export interface StatusCounts {
  active: number;
  pending: number;
  unsubscribed: number;
  imported: number;
  total: number;
}
export interface NewsletterList extends StatusCounts {
  id: string;
  locale: string;
  label: string;
  labelDe: string;
  /** Idioma público de la empresa (si no, solo hay suscriptores antiguos con él). */
  isPublic: boolean;
  isDefault: boolean;
}
export interface Stats extends StatusCounts {
  joined7d: number;
  joined30d: number;
  left30d: number;
  byLocale: Array<{ locale: string } & StatusCounts>;
}
export interface ImportBatch {
  id: number;
  label: string;
  fileName: string;
  fileSha256: string;
  format: "csv" | "xlsx";
  defaultLocale: string;
  rowCount: number;
  createdCount: number;
  matchedCount: number;
  rejectedCount: number;
  sendMails: boolean;
  actor: string;
  createdAt: number;
}
export interface ImportCreate {
  email: string;
  name: string | null;
  locale: string;
  source: string;
}
export interface ApplyImportInput {
  batch: { label: string; fileName: string; sha256: string; format: "csv" | "xlsx"; defaultLocale: string; rowCount: number; matchedCount: number; rejectedCount: number; actor: string; reportJson: string };
  creates: ImportCreate[];
  /** Coincidencias a las que solo se les rellena el nombre vacío. */
  fillNames: Array<{ id: number; name: string }>;
  now: number;
}

export interface NewsletterStore {
  settings(): Promise<Settings>;
  saveSettings(s: Partial<Settings>, by: string, now: number): Promise<void>;
  byEmail(email: string): Promise<Subscriber | null>;
  byEmails(emails: string[]): Promise<Subscriber[]>;
  byId(id: number): Promise<Subscriber | null>;
  byClientId(clientId: number): Promise<Subscriber[]>;
  byTokenHash(hash: string): Promise<Subscriber | null>;
  /** Inserta; si el correo ya existe (carrera entre dos altas) devuelve null. */
  insert(s: { email: string; locale: string; source: string; page: string | null; consentText: string; consentVersion: string; ipHash: string | null; tokenHash: string; expiresAt: number; now: number }): Promise<number | null>;
  /**
   * Nuevo consentimiento sobre una fila existente (baja o histórico): vuelve a PENDIENTE con enlace nuevo. Conserva
   * `signup_locale` (si ya lo tenía), nombre, lote e historial.
   */
  restart(id: number, s: { locale: string; source: string; page: string | null; consentText: string; consentVersion: string; ipHash: string | null; tokenHash: string; expiresAt: number; now: number }): Promise<void>;
  /** Nuevo enlace de confirmación para una suscripción pendiente (reenvío). */
  refreshToken(id: number, tokenHash: string, expiresAt: number, now: number): Promise<void>;
  /** Cuenta un intento de envío de la confirmación (atómico). */
  touchConfirm(id: number, now: number): Promise<void>;
  /** Pasa de pendiente a activa de forma atómica; false si ya no estaba pendiente. */
  activate(id: number, now: number): Promise<boolean>;
  /** Pasa de activa, pendiente o histórico a baja de forma atómica; false si ya estaba de baja. */
  deactivate(id: number, by: string, now: number): Promise<boolean>;
  patch(id: number, p: { locale?: string; localeSource?: LocaleSource; name?: string | null; clientId?: number | null; welcomeSentAt?: number | null; crmSyncError?: string | null }, now: number): Promise<void>;
  addEvent(subscriberId: number, e: { action: string; consentText?: string | null; consentVersion?: string | null; ipHash?: string | null; actor: string; detail?: string | null }, now: number): Promise<void>;
  events(subscriberId: number): Promise<SubscriberEvent[]>;
  /** Reserva la clave del correo; false si ya existía (nadie debe enviarlo otra vez). */
  reserveMail(subscriberId: number, kind: "confirm" | "welcome", key: string, now: number): Promise<boolean>;
  finishMail(key: string, status: "sent" | "failed", error: string | null, now: number): Promise<void>;
  mails(subscriberId: number): Promise<MailLogEntry[]>;
  list(q: ListQuery): Promise<{ rows: Subscriber[]; total: number }>;
  /** Todos los registros del filtro (exportación), con tope. */
  all(f: ListFilters, limit: number): Promise<Subscriber[]>;
  stats(now: number): Promise<Stats>;
  facets(): Promise<{ locales: string[]; sources: string[] }>;
  /** Altas pendientes creadas desde `since` (freno a las altas masivas). */
  recentSignups(since: number): Promise<number>;
  recordExport(e: { actorId: number; actor: string; format: "csv" | "xlsx"; rows: number; filters: string }, now: number): Promise<void>;
  /**
   * Importación histórica en una transacción: lote + suscriptores `imported` (sin consentimiento ni correos) con el
   * cliente del CRM enlazado SOLO si ya existía (no crea clientes) + evento por suscriptor. Devuelve el lote y cuántos
   * se crearon de verdad (una carrera con un alta simultánea cuenta como coincidencia).
   */
  applyImport(i: ApplyImportInput): Promise<{ importId: number; created: number; raced: number }>;
  imports(limit: number): Promise<ImportBatch[]>;
}

export interface CrmPort {
  /** Localiza o crea el cliente del CRM con ese correo (origen «newsletter») y concede el consentimiento de marketing. */
  grant(email: string, evidence: string): Promise<number>;
  /** Retira el consentimiento de marketing del cliente (idempotente). */
  withdraw(clientId: number, evidence: string): Promise<void>;
}
export interface MailPort {
  send(m: { to: string; subject: string; html: string; text: string; idempotencyKey: string; category: "operational" }): Promise<{ ok: boolean; error?: string }>;
}
export interface TenantLocales {
  /** Idiomas públicos de la web de la empresa (principal incluido). */
  tenantLocales: string[];
  defaultLocale: string;
}
export interface NewsletterDeps {
  store: NewsletterStore;
  crm: CrmPort;
  mail: MailPort;
  tenantId: string;
  now: () => number;
  /** Secretos de firma de los enlaces de baja (el primero firma; todos validan). */
  secrets: () => string[];
  baseUrl: () => string;
  identity: () => MailIdentity;
  /** Idiomas reales de la empresa. Sin él: los de las plantillas (de, es, en) con el alemán como principal. */
  locales?: () => Promise<TenantLocales>;
}

export interface SubscribeInput {
  email: unknown;
  consent: unknown;
  /** Idioma declarado por el formulario (solo pista). */
  locale: unknown;
  /** Idioma de la traducción del bloque publicado que se sirvió (lo fija el servidor). */
  blockLocale?: string | null;
  source: string;
  page: string | null;
  /** Texto legal mostrado en el bloque publicado (lo fija el servidor). */
  consentText: string;
  ipHash: string | null;
}
export const PUBLIC_OK = { ok: true as const };

const MAX_SIGNUPS_PER_HOUR = 200;
const HOUR = 60 * 60 * 1000;
const DEFAULT_TENANT_LOCALES: TenantLocales = { tenantLocales: [...LOCALES], defaultLocale: "de" };

export class NewsletterService {
  constructor(private d: NewsletterDeps) {}

  private get now() {
    return this.d.now();
  }
  async tenantLocales(): Promise<TenantLocales> {
    try {
      const t = await this.d.locales?.();
      if (t && t.tenantLocales.length && t.defaultLocale) return t;
    } catch {
      /* sin configuración de idiomas: plantillas */
    }
    return DEFAULT_TENANT_LOCALES;
  }
  private async tpl(kind: "welcome" | "confirm", locale: string, s: Settings): Promise<MailTemplate> {
    return resolveTemplate(kind, locale, s.templates, (await this.tenantLocales()).defaultLocale);
  }
  private unsubUrl(id: number) {
    const [secret] = this.d.secrets();
    return `${this.d.baseUrl().replace(/\/+$/, "")}/newsletter/baja/${unsubscribeToken(id, this.d.tenantId, secret ?? "")}`;
  }

  // ── Alta pública ──
  async subscribe(i: SubscribeInput): Promise<typeof PUBLIC_OK> {
    const settings = await this.d.store.settings();
    if (!settings.enabled || !settings.publicEnabled) throw new NewsletterError("unavailable", "La inscripción no está disponible ahora mismo.");
    const email = normalizeEmail(i.email);
    if (!email) throw new NewsletterError("invalid_input", "invalid_email");
    if (i.consent !== true) throw new NewsletterError("no_consent", "no_consent");
    const t = await this.tenantLocales();
    const { locale, basis } = resolveSignupLocale({ pagePath: i.page, blockLocale: i.blockLocale, hint: i.locale, tenantLocales: t.tenantLocales, defaultLocale: t.defaultLocale });
    const now = this.now;
    const consentText = cleanText(i.consentText, 600);
    if (!consentText) throw new NewsletterError("unavailable", "La inscripción no está disponible ahora mismo.");
    const version = consentVersion(consentText);
    const token = newConfirmToken();
    const fresh = { locale, source: i.source, page: i.page, consentText, consentVersion: version, ipHash: i.ipHash, tokenHash: sha256(token), expiresAt: now + CONFIRM_TTL_MS, now };
    const localeDetail = `Idioma ${locale} (${basis}) · lista ${segmentIdFor(locale)}`;

    const cur = await this.d.store.byEmail(email);
    // Valores previos (el almacén puede devolver la misma referencia que luego actualiza)
    const prevStatus = cur?.status;
    const prevLocale = cur?.locale;
    if (!cur) {
      if ((await this.d.store.recentSignups(now - HOUR)) >= MAX_SIGNUPS_PER_HOUR) throw new NewsletterError("rate_limited", "rate_limited");
      const id = await this.d.store.insert({ email, ...fresh });
      if (id == null) return PUBLIC_OK; // otra petición idéntica llegó a la vez: ya tiene su correo
      await this.d.store.addEvent(id, { action: "requested", consentText, consentVersion: version, ipHash: i.ipHash, actor: "public:form", detail: `${i.source} · ${localeDetail}` }, now);
      await this.sendConfirmation(id, email, locale, token, settings, now);
      return PUBLIC_OK;
    }
    if (cur.status === "active") {
      // Sin pistas hacia fuera (nadie averigua quién está suscrito); dentro queda constancia de la petición, sin tocar idioma ni consentimiento
      await this.d.store.addEvent(cur.id, { action: "resignup_ignored", ipHash: i.ipHash, actor: "public:form", detail: `${i.source} · pedido ${locale}, se conserva ${cur.locale}` }, now);
      return PUBLIC_OK;
    }
    if (cur.status === "unsubscribed" || cur.status === "imported") {
      // Baja: reactivar exige el consentimiento nuevo (esta misma petición) y la confirmación por correo.
      // Histórico: primera alta legítima; conserva nombre, lote e historial y toma el consentimiento de esta petición.
      if ((await this.d.store.recentSignups(now - HOUR)) >= MAX_SIGNUPS_PER_HOUR) throw new NewsletterError("rate_limited", "rate_limited");
      await this.d.store.restart(cur.id, fresh);
      await this.d.store.addEvent(cur.id, { action: prevStatus === "imported" ? "requested" : "resubscribe_requested", consentText, consentVersion: version, ipHash: i.ipHash, actor: "public:form", detail: `${i.source} · ${localeDetail}${prevStatus === "imported" ? " · desde histórico" : ""}` }, now);
      await this.sendConfirmation(cur.id, email, locale, token, settings, now);
      return PUBLIC_OK;
    }
    // Pendiente: reenvío con enlace nuevo, con espera mínima y tope. Si ahora se inscribe desde otra web, cambia de lista.
    if (cur.locale !== locale) {
      await this.d.store.patch(cur.id, { locale, localeSource: "subscriber" }, now);
      await this.d.store.addEvent(cur.id, { action: "updated", actor: "public:form", detail: `Idioma ${prevLocale} → ${locale} (${basis}, nueva petición pendiente)` }, now);
    }
    if (cur.confirmSentCount >= CONFIRM_MAX_SENDS || (cur.lastConfirmSentAt != null && now - cur.lastConfirmSentAt < CONFIRM_COOLDOWN_MS)) return PUBLIC_OK;
    await this.d.store.refreshToken(cur.id, fresh.tokenHash, fresh.expiresAt, now);
    await this.d.store.addEvent(cur.id, { action: "confirmation_resent", ipHash: i.ipHash, actor: "public:form" }, now);
    await this.sendConfirmation(cur.id, email, locale, token, settings, now);
    return PUBLIC_OK;
  }

  private async sendConfirmation(id: number, email: string, locale: string, token: string, settings: Settings, now: number): Promise<boolean> {
    const key = `nl:confirm:${id}:${sha256(token).slice(0, 16)}`;
    if (!(await this.d.store.reserveMail(id, "confirm", key, now))) return false;
    const url = `${this.d.baseUrl().replace(/\/+$/, "")}/newsletter/confirmar/${token}`;
    const m = renderMail(await this.tpl("confirm", locale, settings), locale, this.d.identity(), { buttonUrl: url, tenantDefault: (await this.tenantLocales()).defaultLocale });
    const r = await this.d.mail.send({ to: email, subject: m.subject, html: m.html, text: m.text, idempotencyKey: key, category: "operational" }).catch((e: unknown) => ({ ok: false, error: e instanceof Error ? e.message : "error" }));
    await this.d.store.finishMail(key, r.ok ? "sent" : "failed", r.ok ? null : (r.error ?? "El correo no salió").slice(0, 300), this.now);
    // El contador y la fecha cuentan intentos (también los fallidos): frena el reenvío en bucle
    await this.d.store.touchConfirm(id, this.now);
    return r.ok;
  }

  // ── Confirmación (enlace del correo) ──
  /** Estado de un enlace de confirmación SIN consumirlo (la página pide un botón: los escáneres de enlaces no confirman). */
  async peekConfirm(token: unknown): Promise<{ state: "valid" | "invalid" | "expired"; locale: string }> {
    if (typeof token !== "string") return { state: "invalid", locale: "de" };
    const sub = await this.d.store.byTokenHash(sha256(token));
    if (!sub || sub.status !== "pending") return { state: "invalid", locale: "de" };
    if (sub.confirmExpiresAt == null || this.now > sub.confirmExpiresAt) return { state: "expired", locale: sub.locale };
    return { state: "valid", locale: sub.locale };
  }
  /** Idioma de la persona de un enlace de baja con firma válida (o null si el enlace no vale). */
  async unsubscribeLocale(token: unknown, secrets: readonly string[], verify: (t: unknown, tenant: string, s: readonly string[]) => number | null): Promise<string | null> {
    const id = verify(token, this.d.tenantId, secrets);
    const sub = id == null ? null : await this.d.store.byId(id);
    return sub ? sub.locale : null;
  }

  async confirm(token: unknown): Promise<{ state: "confirmed" | "invalid" | "expired"; locale: string }> {
    if (typeof token !== "string") return { state: "invalid", locale: "de" };
    const sub = await this.d.store.byTokenHash(sha256(token));
    if (!sub || sub.status !== "pending") return { state: "invalid", locale: sub?.locale ?? "de" };
    const now = this.now;
    if (sub.confirmExpiresAt == null || now > sub.confirmExpiresAt) return { state: "expired", locale: sub.locale };
    if (!(await this.d.store.activate(sub.id, now))) return { state: "invalid", locale: sub.locale };
    await this.d.store.addEvent(sub.id, { action: "confirmed", consentText: sub.consentText, consentVersion: sub.consentVersion, actor: "public:link", detail: `lista ${segmentIdFor(sub.locale)}` }, now);
    await this.syncCrm(sub);
    await this.sendWelcome(sub.id, "auto");
    return { state: "confirmed", locale: sub.locale };
  }

  private async syncCrm(sub: Subscriber) {
    try {
      const evidence = `Newsletter · doble confirmación · texto v${sub.consentVersion ?? "?"}: «${(sub.consentText ?? "").slice(0, 300)}»`;
      const clientId = await this.d.crm.grant(sub.email, evidence);
      await this.d.store.patch(sub.id, { clientId, crmSyncError: null }, this.now);
    } catch (e) {
      // La suscripción ya es válida; el fallo queda a la vista y se reintenta desde la ficha
      await this.d.store.patch(sub.id, { crmSyncError: (e instanceof Error ? e.message : "error").slice(0, 300) }, this.now).catch(() => {});
    }
  }

  /** Reintenta el enlace con el CRM (desde la ficha). */
  async retryCrm(id: number, actor: string) {
    const sub = await this.mustGet(id);
    if (sub.status !== "active") throw new NewsletterError("conflict", "Solo una suscripción activa se sincroniza con el CRM.");
    await this.syncCrm(sub);
    await this.d.store.addEvent(id, { action: "crm_resync", actor }, this.now);
  }

  // ── Bienvenida: una sola vez por confirmación ──
  async sendWelcome(id: number, mode: "auto" | "manual", actor = "system"): Promise<{ sent: boolean; reason?: string }> {
    const sub = await this.mustGet(id);
    if (sub.status !== "active" || sub.confirmedAt == null) return { sent: false, reason: "not_active" };
    if (sub.welcomeSentAt != null) return { sent: false, reason: "already_sent" };
    const settings = await this.d.store.settings();
    const mails = await this.d.store.mails(id);
    const failed = mails.filter((m) => m.kind === "welcome" && m.status === "failed").length;
    if (mode === "auto" && failed > 0) return { sent: false, reason: "already_attempted" };
    // Categoría «operational»: es la respuesta directa a la confirmación de la propia persona (la política de correo reserva «marketing» a las automatizaciones). Solo sale a una suscripción ACTIVA y con enlace de baja.
    // Clave por ciclo de confirmación y por intento manual: dos réplicas o un reintento no duplican la bienvenida
    const key = `nl:welcome:${id}:${sub.confirmedAt}:${mode === "auto" ? 0 : failed + 1}`;
    if (!(await this.d.store.reserveMail(id, "welcome", key, this.now))) return { sent: false, reason: "already_attempted" };
    const m = renderMail(await this.tpl("welcome", sub.locale, settings), sub.locale, this.d.identity(), { unsubscribeUrl: this.unsubUrl(id), tenantDefault: (await this.tenantLocales()).defaultLocale });
    const r = await this.d.mail.send({ to: sub.email, subject: m.subject, html: m.html, text: m.text, idempotencyKey: key, category: "operational" }).catch((e: unknown) => ({ ok: false, error: e instanceof Error ? e.message : "error" }));
    await this.d.store.finishMail(key, r.ok ? "sent" : "failed", r.ok ? null : (r.error ?? "El correo no salió").slice(0, 300), this.now);
    if (r.ok) {
      await this.d.store.patch(id, { welcomeSentAt: this.now }, this.now);
      await this.d.store.addEvent(id, { action: "welcome_sent", actor }, this.now);
    }
    return { sent: r.ok, reason: r.ok ? undefined : "mail_failed" };
  }

  // ── Baja ──
  async unsubscribeByToken(token: unknown, secrets: readonly string[], verify: (t: unknown, tenant: string, s: readonly string[]) => number | null): Promise<boolean> {
    const id = verify(token, this.d.tenantId, secrets);
    if (id == null) return false;
    const sub = await this.d.store.byId(id);
    if (!sub) return false;
    await this.unsubscribe(sub, "public:link", "Enlace de baja del correo");
    return true;
  }
  async adminUnsubscribe(id: number, reason: string, actor: string) {
    const sub = await this.mustGet(id);
    await this.unsubscribe(sub, actor, `Baja administrativa: ${cleanText(reason, 200) || "sin motivo indicado"}`);
  }
  private async unsubscribe(sub: Subscriber, actor: string, detail: string) {
    const now = this.now;
    const changed = await this.d.store.deactivate(sub.id, actor, now);
    if (changed) await this.d.store.addEvent(sub.id, { action: actor.startsWith("public") ? "unsubscribed" : "admin_unsubscribed", actor, detail }, now);
    // Aunque ya estuviera de baja, el consentimiento de marketing del cliente se retira siempre (idempotente)
    if (sub.clientId != null) {
      try {
        await this.d.crm.withdraw(sub.clientId, detail);
      } catch (e) {
        await this.d.store.patch(sub.id, { crmSyncError: `Baja sin propagar al CRM: ${(e instanceof Error ? e.message : "error").slice(0, 200)}` }, now).catch(() => {});
      }
    }
  }
  /**
   * El CRM retiró el consentimiento de marketing de un cliente (Brevo marketing, baja pública o leída de Brevo): el
   * suscriptor activo o pendiente con ese cliente o correo queda de baja (`crm:withdrawn`). No vuelve a tocar el CRM.
   */
  async onCrmWithdrawn(clientId: number, email: string | null): Promise<{ unsubscribed: number }> {
    const now = this.now;
    const seen = new Set<number>();
    const subs = [...(await this.d.store.byClientId(clientId))];
    const e = email ? normalizeEmail(email) : null;
    if (e) {
      const byMail = await this.d.store.byEmail(e);
      if (byMail) subs.push(byMail);
    }
    let n = 0;
    for (const sub of subs) {
      if (seen.has(sub.id) || (sub.status !== "active" && sub.status !== "pending")) continue;
      seen.add(sub.id);
      if (await this.d.store.deactivate(sub.id, "crm:withdrawn", now)) {
        await this.d.store.addEvent(sub.id, { action: "unsubscribed", actor: "crm:withdrawn", detail: `Consentimiento de marketing retirado en el CRM (cliente ${clientId})` }, now);
        n++;
      }
    }
    return { unsubscribed: n };
  }

  // ── Administración ──
  private async mustGet(id: number) {
    const s = await this.d.store.byId(id);
    if (!s) throw new NewsletterError("not_found", "Suscriptor no encontrado");
    return s;
  }
  async resendConfirmation(id: number, actor: string) {
    const sub = await this.mustGet(id);
    if (sub.status !== "pending") throw new NewsletterError("conflict", "Solo se reenvía la confirmación a una suscripción pendiente.");
    if (sub.confirmSentCount >= CONFIRM_MAX_SENDS) throw new NewsletterError("rate_limited", "Se alcanzó el máximo de reenvíos de esta suscripción.");
    const now = this.now;
    if (sub.lastConfirmSentAt != null && now - sub.lastConfirmSentAt < CONFIRM_COOLDOWN_MS) throw new NewsletterError("rate_limited", "Espera un par de minutos antes de reenviar.");
    const token = newConfirmToken();
    await this.d.store.refreshToken(id, sha256(token), now + CONFIRM_TTL_MS, now);
    await this.d.store.addEvent(id, { action: "confirmation_resent", actor }, now);
    const ok = await this.sendConfirmation(id, sub.email, sub.locale, token, await this.d.store.settings(), now);
    return { sent: ok };
  }
  /** Cambio de lista desde el panel: solo a un idioma público de la empresa; queda `locale_source = admin` y evento. */
  async updateLocale(id: number, locale: unknown, actor: string) {
    const sub = await this.mustGet(id);
    const l = normalizeI18nLocale(locale);
    const t = await this.tenantLocales();
    const allowed = listLocales(t.tenantLocales, [], t.defaultLocale);
    if (!l || !allowed.includes(l)) throw new NewsletterError("invalid_input", `Idioma no disponible en esta empresa (${allowed.join(", ")}).`);
    if (l === sub.locale) return;
    await this.d.store.patch(id, { locale: l, localeSource: "admin" }, this.now);
    await this.d.store.addEvent(id, { action: "updated", actor, detail: `Idioma ${sub.locale} → ${l} (lista ${segmentIdFor(l)}, cambiado desde el panel)` }, this.now);
  }
  async detail(id: number) {
    const sub = await this.mustGet(id);
    return { subscriber: sub, events: await this.d.store.events(id), mails: await this.d.store.mails(id) };
  }

  /** Listas (una por idioma público de la empresa y por idioma presente en la tabla) con sus recuentos. */
  async lists(): Promise<NewsletterList[]> {
    const [t, stats] = await Promise.all([this.tenantLocales(), this.d.store.stats(this.now)]);
    const pub = listLocales(t.tenantLocales, [], t.defaultLocale);
    const by = new Map(stats.byLocale.map((b) => [b.locale, b]));
    return listLocales(t.tenantLocales, Array.from(by.keys()), t.defaultLocale).map((locale) => {
      const c = by.get(locale) ?? { active: 0, pending: 0, unsubscribed: 0, imported: 0, total: 0 };
      return { id: segmentIdFor(locale), locale, label: listLabel(locale, "es"), labelDe: listLabel(locale, "de"), isPublic: pub.includes(locale), isDefault: locale === (normalizeI18nLocale(t.defaultLocale) ?? "es"), active: c.active, pending: c.pending, unsubscribed: c.unsubscribed, imported: c.imported, total: c.total };
    });
  }

  /** `list=newsletter-xx` es un alias de `locale=xx` (el filtro guardado conserva lo que se pidió). */
  static normalizeFilters(f: ListFilters): ListFilters {
    const out = { ...f };
    const fromList = localeOfSegment(f.list);
    if (fromList && !out.locale) out.locale = fromList;
    return out;
  }

  async exportRows(f: ListFilters, format: "csv" | "xlsx", actor: { id: number; name: string }): Promise<ExportRow[]> {
    const nf = NewsletterService.normalizeFilters(f);
    const rows = await this.d.store.all(nf, 100_000);
    await this.d.store.recordExport({ actorId: actor.id, actor: actor.name, format, rows: rows.length, filters: JSON.stringify(f).slice(0, 600) }, this.now);
    return rows.map((r) => ({ email: r.email, status: r.status, source: r.source, locale: r.locale, signupLocale: r.signupLocale, name: r.name, createdAt: r.createdAt, confirmedAt: r.confirmedAt, unsubscribedAt: r.unsubscribedAt, consentVersion: r.consentVersion }));
  }
}
