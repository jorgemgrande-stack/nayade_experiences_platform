/**
 * Newsletter · almacén en la base de datos de la empresa en curso (tablas de las migraciones 0095 y 0099, fuera de
 * drizzle/schema.ts, con SQL parametrizado como brevoMarketing/store.ts). El aislamiento entre empresas es el de la
 * propia conexión: cada empresa tiene su base de datos.
 */
import { sql } from "drizzle-orm";
import { getDb } from "../db";
import type { SubscriberStatus, TemplatesJson } from "./core";
import type { LocaleSource } from "../../shared/newsletterLocalePolicy";
import type { ApplyImportInput, ImportBatch, ListFilters, ListQuery, MailLogEntry, NewsletterStore, Settings, Stats, StatusCounts, Subscriber, SubscriberEvent } from "./service";

type Row = Record<string, unknown>;
type Tx = { execute: (q: ReturnType<typeof sql>) => Promise<unknown> };
function unpack(r: unknown): { rows: Row[]; affected: number; insertId: number } {
  const [x] = r as unknown as [Row[] | { affectedRows?: number; insertId?: number }];
  if (Array.isArray(x)) return { rows: x, affected: 0, insertId: 0 };
  return { rows: [], affected: Number(x?.affectedRows ?? 0), insertId: Number(x?.insertId ?? 0) };
}
async function exec(q: ReturnType<typeof sql>): Promise<{ rows: Row[]; affected: number; insertId: number }> {
  const db = await getDb();
  if (!db) throw new Error("Base de datos no disponible");
  return unpack(await db.execute(q));
}
const n = (v: unknown) => (v == null ? null : Number(v));
const s = (v: unknown) => (v == null ? null : String(v));

export class NewsletterNotInstalled extends Error {
  constructor() {
    super("La newsletter no está instalada en esta empresa (falta la migración 0095).");
  }
}
const missingTable = (e: unknown) => /ER_NO_SUCH_TABLE|doesn't exist/i.test(String((e as { message?: string; code?: string })?.message ?? "") + String((e as { code?: string })?.code ?? "") + String((e as { cause?: { code?: string; message?: string } })?.cause?.code ?? "") + String((e as { cause?: { message?: string } })?.cause?.message ?? ""));
const isDup = (e: unknown) => /ER_DUP_ENTRY|Duplicate entry/i.test(String((e as { message?: string })?.message ?? "") + String((e as { cause?: { message?: string } })?.cause?.message ?? ""));
async function guarded<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (missingTable(e)) throw new NewsletterNotInstalled();
    throw e;
  }
}

const LOCALE_SOURCES = new Set(["web", "subscriber", "admin", "import"]);
const subFrom = (r: Row): Subscriber => ({
  id: Number(r.id),
  email: String(r.email),
  status: String(r.status) as SubscriberStatus,
  locale: String(r.locale),
  signupLocale: s(r.signup_locale),
  localeSource: (LOCALE_SOURCES.has(String(r.locale_source)) ? String(r.locale_source) : "web") as LocaleSource,
  name: s(r.name),
  importId: n(r.import_id),
  importedAt: n(r.imported_at),
  source: String(r.source),
  page: s(r.page),
  clientId: n(r.client_id),
  consentText: s(r.consent_text),
  consentVersion: s(r.consent_version),
  consentAt: n(r.consent_at),
  confirmExpiresAt: n(r.confirm_expires_at),
  confirmSentCount: Number(r.confirm_sent_count ?? 0),
  lastConfirmSentAt: n(r.last_confirm_sent_at),
  confirmedAt: n(r.confirmed_at),
  unsubscribedAt: n(r.unsubscribed_at),
  unsubscribedBy: s(r.unsubscribed_by),
  welcomeSentAt: n(r.welcome_sent_at),
  crmSyncError: s(r.crm_sync_error),
  createdAt: Number(r.created_at),
  updatedAt: Number(r.updated_at),
});
const counts = (r: Row): StatusCounts => {
  const g = (k: string) => Number(r[k] ?? 0);
  return { active: g("active"), pending: g("pending"), unsubscribed: g("unsubscribed"), imported: g("imported"), total: g("total") };
};
const COUNT_COLS = sql.raw(`SUM(status = 'active') AS active, SUM(status = 'pending') AS pending, SUM(status = 'unsubscribed') AS unsubscribed, SUM(status = 'imported') AS imported, COUNT(*) AS total`);

const DATE_COL = { createdAt: sql.raw("created_at"), confirmedAt: sql.raw("confirmed_at"), unsubscribedAt: sql.raw("unsubscribed_at") } as const;
const SORT_COL = { createdAt: "created_at", email: "email", confirmedAt: "confirmed_at", status: "status", locale: "locale", source: "source" } as const;
const likeEscape = (v: string) => v.replace(/[\\%_]/g, (c) => `\\${c}`);

function where(f: ListFilters) {
  const parts = [sql`1 = 1`];
  const q = f.q?.trim().toLowerCase();
  if (q) parts.push(sql`(email LIKE ${`%${likeEscape(q).slice(0, 100)}%`} OR LOWER(name) LIKE ${`%${likeEscape(q).slice(0, 100)}%`})`);
  if (f.status) parts.push(sql`status = ${f.status}`);
  const locale = f.locale ?? (typeof f.list === "string" && /^newsletter-/.test(f.list) ? f.list.slice("newsletter-".length) : undefined);
  if (locale) parts.push(sql`locale = ${locale.slice(0, 8)}`);
  if (f.source) parts.push(sql`source = ${f.source.slice(0, 64)}`);
  const col = DATE_COL[f.dateField ?? "createdAt"];
  if (f.from != null) parts.push(sql`${col} >= ${f.from}`);
  if (f.to != null) parts.push(sql`${col} <= ${f.to}`);
  return sql.join(parts, sql` AND `);
}

export const mysqlNewsletterStore: NewsletterStore = {
  settings: () =>
    guarded(async () => {
      const { rows } = await exec(sql`SELECT enabled, public_enabled, templates_json FROM newsletter_settings WHERE id = 1`);
      const r = rows[0];
      let templates: TemplatesJson = {};
      try {
        templates = r?.templates_json ? (JSON.parse(String(r.templates_json)) as TemplatesJson) : {};
      } catch {
        templates = {};
      }
      return { enabled: !!Number(r?.enabled ?? 0), publicEnabled: r ? !!Number(r.public_enabled) : true, templates } satisfies Settings;
    }),
  saveSettings: (p, by, now) =>
    guarded(async () => {
      await exec(sql`INSERT IGNORE INTO newsletter_settings (id, enabled, public_enabled, updated_by, updated_at) VALUES (1, 0, 1, ${by.slice(0, 100)}, ${now})`);
      if (p.enabled !== undefined) await exec(sql`UPDATE newsletter_settings SET enabled = ${p.enabled ? 1 : 0}, updated_by = ${by.slice(0, 100)}, updated_at = ${now} WHERE id = 1`);
      if (p.publicEnabled !== undefined) await exec(sql`UPDATE newsletter_settings SET public_enabled = ${p.publicEnabled ? 1 : 0}, updated_by = ${by.slice(0, 100)}, updated_at = ${now} WHERE id = 1`);
      if (p.templates !== undefined) await exec(sql`UPDATE newsletter_settings SET templates_json = ${JSON.stringify(p.templates)}, updated_by = ${by.slice(0, 100)}, updated_at = ${now} WHERE id = 1`);
    }),
  byEmail: (email) => guarded(async () => (await exec(sql`SELECT * FROM newsletter_subscribers WHERE email = ${email}`)).rows.map(subFrom)[0] ?? null),
  byEmails: (emails) =>
    guarded(async () => {
      const out: Subscriber[] = [];
      for (let i = 0; i < emails.length; i += 500) {
        const chunk = emails.slice(i, i + 500);
        if (!chunk.length) break;
        out.push(...(await exec(sql`SELECT * FROM newsletter_subscribers WHERE email IN (${sql.join(chunk.map((e) => sql`${e}`), sql`, `)})`)).rows.map(subFrom));
      }
      return out;
    }),
  byId: (id) => guarded(async () => (await exec(sql`SELECT * FROM newsletter_subscribers WHERE id = ${id}`)).rows.map(subFrom)[0] ?? null),
  byClientId: (clientId) => guarded(async () => (await exec(sql`SELECT * FROM newsletter_subscribers WHERE client_id = ${clientId}`)).rows.map(subFrom)),
  byTokenHash: (h) => guarded(async () => (await exec(sql`SELECT * FROM newsletter_subscribers WHERE confirm_token_hash = ${h}`)).rows.map(subFrom)[0] ?? null),
  insert: (x) =>
    guarded(async () => {
      try {
        const r = await exec(sql`INSERT INTO newsletter_subscribers
          (email, status, locale, signup_locale, locale_source, source, page, consent_text, consent_version, consent_at, ip_hash, confirm_token_hash, confirm_expires_at, created_at, updated_at)
          VALUES (${x.email}, 'pending', ${x.locale}, ${x.locale}, 'web', ${x.source.slice(0, 64)}, ${x.page?.slice(0, 200) ?? null}, ${x.consentText}, ${x.consentVersion}, ${x.now}, ${x.ipHash}, ${x.tokenHash}, ${x.expiresAt}, ${x.now}, ${x.now})`);
        return r.insertId;
      } catch (e) {
        if (isDup(e)) return null;
        throw e;
      }
    }),
  restart: (id, x) =>
    guarded(async () => {
      await exec(sql`UPDATE newsletter_subscribers SET status = 'pending', locale = ${x.locale}, signup_locale = COALESCE(signup_locale, ${x.locale}), locale_source = 'web', source = ${x.source.slice(0, 64)}, page = ${x.page?.slice(0, 200) ?? null},
        consent_text = ${x.consentText}, consent_version = ${x.consentVersion}, consent_at = ${x.now}, ip_hash = ${x.ipHash}, confirm_token_hash = ${x.tokenHash}, confirm_expires_at = ${x.expiresAt},
        confirm_sent_count = 0, last_confirm_sent_at = NULL, confirmed_at = NULL, unsubscribed_at = NULL, unsubscribed_by = NULL, welcome_sent_at = NULL, updated_at = ${x.now} WHERE id = ${id}`);
    }),
  refreshToken: (id, hash, expiresAt, now) => guarded(async () => void (await exec(sql`UPDATE newsletter_subscribers SET confirm_token_hash = ${hash}, confirm_expires_at = ${expiresAt}, updated_at = ${now} WHERE id = ${id} AND status = 'pending'`))),
  touchConfirm: (id, now) => guarded(async () => void (await exec(sql`UPDATE newsletter_subscribers SET confirm_sent_count = confirm_sent_count + 1, last_confirm_sent_at = ${now} WHERE id = ${id}`))),
  activate: (id, now) =>
    guarded(async () => (await exec(sql`UPDATE newsletter_subscribers SET status = 'active', confirmed_at = ${now}, confirm_token_hash = NULL, confirm_expires_at = NULL, updated_at = ${now} WHERE id = ${id} AND status = 'pending'`)).affected === 1),
  deactivate: (id, by, now) =>
    guarded(async () => (await exec(sql`UPDATE newsletter_subscribers SET status = 'unsubscribed', unsubscribed_at = ${now}, unsubscribed_by = ${by.slice(0, 100)}, confirm_token_hash = NULL, confirm_expires_at = NULL, updated_at = ${now} WHERE id = ${id} AND status <> 'unsubscribed'`)).affected === 1),
  patch: (id, p, now) =>
    guarded(async () => {
      const sets = [sql`updated_at = ${now}`];
      if (p.locale !== undefined) sets.push(sql`locale = ${p.locale.slice(0, 8)}`);
      if (p.localeSource !== undefined) sets.push(sql`locale_source = ${p.localeSource}`);
      if (p.name !== undefined) sets.push(sql`name = ${p.name?.slice(0, 200) ?? null}`);
      if (p.clientId !== undefined) sets.push(sql`client_id = ${p.clientId}`);
      if (p.welcomeSentAt !== undefined) sets.push(sql`welcome_sent_at = ${p.welcomeSentAt}`);
      if (p.crmSyncError !== undefined) sets.push(sql`crm_sync_error = ${p.crmSyncError}`);
      await exec(sql`UPDATE newsletter_subscribers SET ${sql.join(sets, sql`, `)} WHERE id = ${id}`);
    }),
  addEvent: (id, e, now) =>
    guarded(async () => void (await exec(sql`INSERT INTO newsletter_events (subscriber_id, action, consent_text, consent_version, ip_hash, actor, detail, created_at)
      VALUES (${id}, ${e.action.slice(0, 32)}, ${e.consentText ?? null}, ${e.consentVersion ?? null}, ${e.ipHash ?? null}, ${e.actor.slice(0, 100)}, ${e.detail?.slice(0, 300) ?? null}, ${now})`))),
  events: (id) =>
    guarded(async () =>
      (await exec(sql`SELECT * FROM newsletter_events WHERE subscriber_id = ${id} ORDER BY id DESC LIMIT 200`)).rows.map(
        (r): SubscriberEvent => ({ id: Number(r.id), action: String(r.action), consentText: s(r.consent_text), consentVersion: s(r.consent_version), actor: String(r.actor), detail: s(r.detail), at: Number(r.created_at) }),
      ),
    ),
  reserveMail: (id, kind, key, now) => guarded(async () => (await exec(sql`INSERT IGNORE INTO newsletter_mail_log (subscriber_id, kind, idempotency_key, status, created_at) VALUES (${id}, ${kind}, ${key.slice(0, 120)}, 'sending', ${now})`)).affected === 1),
  finishMail: (key, status, error, now) => guarded(async () => void (await exec(sql`UPDATE newsletter_mail_log SET status = ${status}, error = ${error?.slice(0, 300) ?? null}, finished_at = ${now} WHERE idempotency_key = ${key.slice(0, 120)}`))),
  mails: (id) =>
    guarded(async () =>
      (await exec(sql`SELECT * FROM newsletter_mail_log WHERE subscriber_id = ${id} ORDER BY id DESC LIMIT 100`)).rows.map(
        (r): MailLogEntry => ({ id: Number(r.id), kind: String(r.kind) as MailLogEntry["kind"], status: String(r.status) as MailLogEntry["status"], error: s(r.error), at: Number(r.created_at), finishedAt: n(r.finished_at) }),
      ),
    ),
  list: (q: ListQuery) =>
    guarded(async () => {
      const w = where(q);
      const size = Math.min(100, Math.max(1, Math.floor(q.pageSize)));
      const off = Math.max(0, Math.floor(q.page - 1)) * size;
      const total = Number((await exec(sql`SELECT COUNT(*) AS c FROM newsletter_subscribers WHERE ${w}`)).rows[0]?.c ?? 0);
      const order = sql.raw(`${SORT_COL[q.sort] ?? "created_at"} ${q.dir === "asc" ? "ASC" : "DESC"}, id DESC`);
      const rows = (await exec(sql`SELECT * FROM newsletter_subscribers WHERE ${w} ORDER BY ${order} LIMIT ${size} OFFSET ${off}`)).rows.map(subFrom);
      return { rows, total };
    }),
  all: (f, limit) => guarded(async () => (await exec(sql`SELECT * FROM newsletter_subscribers WHERE ${where(f)} ORDER BY created_at DESC, id DESC LIMIT ${limit}`)).rows.map(subFrom)),
  stats: (now) =>
    guarded(async (): Promise<Stats> => {
      const d7 = now - 7 * 86400_000;
      const d30 = now - 30 * 86400_000;
      const r = (await exec(sql`SELECT ${COUNT_COLS}, SUM(confirmed_at >= ${d7}) AS joined7d, SUM(confirmed_at >= ${d30}) AS joined30d, SUM(unsubscribed_at >= ${d30}) AS left30d FROM newsletter_subscribers`)).rows[0] ?? {};
      const g = (k: string) => Number(r[k] ?? 0);
      const byLocale = (await exec(sql`SELECT locale, ${COUNT_COLS} FROM newsletter_subscribers GROUP BY locale ORDER BY locale`)).rows.map((x) => ({ locale: String(x.locale), ...counts(x) }));
      return { ...counts(r), joined7d: g("joined7d"), joined30d: g("joined30d"), left30d: g("left30d"), byLocale };
    }),
  facets: () =>
    guarded(async () => ({
      locales: (await exec(sql`SELECT DISTINCT locale AS v FROM newsletter_subscribers ORDER BY locale`)).rows.map((r) => String(r.v)),
      sources: (await exec(sql`SELECT DISTINCT source AS v FROM newsletter_subscribers ORDER BY source`)).rows.map((r) => String(r.v)),
    })),
  recentSignups: (since) => guarded(async () => Number((await exec(sql`SELECT COUNT(*) AS c FROM newsletter_subscribers WHERE created_at >= ${since} OR (consent_at IS NOT NULL AND consent_at >= ${since} AND status = 'pending')`)).rows[0]?.c ?? 0)),
  recordExport: (e, now) => guarded(async () => void (await exec(sql`INSERT INTO newsletter_exports (actor_id, actor, format, row_count, filters, created_at) VALUES (${e.actorId}, ${e.actor.slice(0, 120)}, ${e.format}, ${e.rows}, ${e.filters.slice(0, 600)}, ${now})`))),

  applyImport: (i) =>
    guarded(async () => {
      const db = await getDb();
      if (!db) throw new Error("Base de datos no disponible");
      return db.transaction(async (tx: Tx) => {
        const b = i.batch;
        const batch = unpack(
          await tx.execute(sql`INSERT INTO newsletter_imports (label, file_name, file_sha256, format, default_locale, row_count, created_count, matched_count, rejected_count, send_mails, report_json, actor, created_at)
            VALUES (${b.label.slice(0, 120)}, ${b.fileName.slice(0, 200)}, ${b.sha256}, ${b.format}, ${b.defaultLocale.slice(0, 8)}, ${b.rowCount}, 0, ${b.matchedCount}, ${b.rejectedCount}, 0, ${b.reportJson}, ${b.actor.slice(0, 100)}, ${i.now})`),
        );
        const importId = batch.insertId;
        let created = 0;
        let raced = 0;
        for (const c of i.creates) {
          // Cliente del CRM SOLO si ya existe (un histórico no crea clientes ni consentimientos)
          let clientId: number | null = null;
          try {
            const cl = unpack(await tx.execute(sql`SELECT id FROM clients WHERE LOWER(email) = ${c.email} LIMIT 1`)).rows[0];
            clientId = cl ? Number(cl.id) : null;
          } catch {
            clientId = null;
          }
          const ins = unpack(
            await tx.execute(sql`INSERT IGNORE INTO newsletter_subscribers (email, status, locale, signup_locale, locale_source, name, import_id, imported_at, source, client_id, created_at, updated_at)
              VALUES (${c.email}, 'imported', ${c.locale.slice(0, 8)}, NULL, 'import', ${c.name?.slice(0, 200) ?? null}, ${importId}, ${i.now}, ${c.source.slice(0, 64)}, ${clientId}, ${i.now}, ${i.now})`),
          );
          if (ins.affected !== 1) {
            raced++;
            continue;
          }
          created++;
          await tx.execute(sql`INSERT INTO newsletter_events (subscriber_id, action, actor, detail, created_at) VALUES (${ins.insertId}, 'imported', ${b.actor.slice(0, 100)}, ${`Lote ${importId} «${b.label}» · sin consentimiento acreditado · lista newsletter-${c.locale}`.slice(0, 300)}, ${i.now})`);
        }
        for (const f of i.fillNames) await tx.execute(sql`UPDATE newsletter_subscribers SET name = ${f.name.slice(0, 200)}, updated_at = ${i.now} WHERE id = ${f.id} AND (name IS NULL OR name = '')`);
        await tx.execute(sql`UPDATE newsletter_imports SET created_count = ${created}, matched_count = ${b.matchedCount + raced} WHERE id = ${importId}`);
        return { importId, created, raced };
      });
    }),
  imports: (limit) =>
    guarded(async () =>
      (await exec(sql`SELECT * FROM newsletter_imports ORDER BY id DESC LIMIT ${Math.max(1, Math.min(200, limit))}`)).rows.map(
        (r): ImportBatch => ({
          id: Number(r.id),
          label: String(r.label),
          fileName: String(r.file_name),
          fileSha256: String(r.file_sha256),
          format: String(r.format) === "xlsx" ? "xlsx" : "csv",
          defaultLocale: String(r.default_locale),
          rowCount: Number(r.row_count ?? 0),
          createdCount: Number(r.created_count ?? 0),
          matchedCount: Number(r.matched_count ?? 0),
          rejectedCount: Number(r.rejected_count ?? 0),
          sendMails: !!Number(r.send_mails ?? 0),
          actor: String(r.actor),
          createdAt: Number(r.created_at),
        }),
      ),
    ),
};

/** Correos de la newsletter reservados desde `since` (ms): consumo de la excepción de prueba. null si el módulo no está instalado. */
export async function mailsReservedSince(since: number): Promise<number | null> {
  try {
    const r = await exec(sql`SELECT COUNT(*) AS c FROM newsletter_mail_log WHERE created_at >= ${since}`);
    return Number(r.rows[0]?.c ?? 0);
  } catch (e) {
    if (missingTable(e)) return null;
    throw e;
  }
}
