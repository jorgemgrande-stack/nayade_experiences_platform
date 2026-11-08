/**
 * Persistencia de Elephant Campaigns en la BD de la empresa (migración `db/migrations/0054_connect_campaigns.sql`).
 * Tablas fuera de drizzle/schema.ts y SQL parametrizado (patrón de server/brevoMarketing/store.ts). Los consentimientos
 * son los de Brevo marketing (`customer_marketing_consents`, 0042) y los segmentos, las etiquetas del CRM
 * (`crm_tag_links`, 0008). Sin las tablas → `CampaignsNotInstalled`.
 */
import { sql } from "drizzle-orm";
import { getTenantDatabase } from "../_core/dbRegistry";
import type { CampaignBlock, CampaignStatus } from "../../shared/connectCampaigns";
import type { AudienceRow } from "./plan";

export class CampaignsNotInstalled extends Error {
  constructor() {
    super("Las campañas de correo aún no están instaladas en la base de datos de la empresa");
    this.name = "CampaignsNotInstalled";
  }
}

export type TagMode = "any" | "all";
export interface CampaignStats {
  sent: number;
  delivered: number;
  opens: number;
  clicks: number;
  unsubscribed: number;
  bounces: number;
  complaints: number;
}
export interface DraftInput {
  name: string;
  subject: string;
  previewText: string | null;
  senderId: number | null;
  senderName: string | null;
  senderEmail: string | null;
  replyTo: string | null;
  blocks: CampaignBlock[];
  tagIds: number[];
  tagMode: TagMode;
}
export interface Campaign extends DraftInput {
  id: number;
  status: CampaignStatus;
  scheduledAt: string | null;
  brevoListId: number | null;
  brevoCampaignId: number | null;
  brevoTestCampaignId: number | null;
  brevoStatus: string | null;
  processIds: number[];
  recipients: number;
  sendClaimedAt: string | null;
  sentAt: string | null;
  errorMessage: string | null;
  stats: CampaignStats | null;
  statsAt: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}
export interface CampaignEvent {
  kind: string;
  detail: string | null;
  actor: string;
  createdAt: string;
}
export interface CampaignSettings {
  folderId: number | null;
  attributeReady: boolean;
}

export interface CampaignStore {
  settings(): Promise<CampaignSettings>;
  saveSettings(p: Partial<CampaignSettings>): Promise<void>;

  list(limit: number): Promise<Campaign[]>;
  get(id: number): Promise<Campaign | null>;
  create(d: DraftInput, actor: string): Promise<number>;
  /** Solo un borrador se edita; devuelve si se cambió. */
  updateDraft(id: number, d: DraftInput, actor: string): Promise<boolean>;

  /** Borrador (o fallida sin envío reservado) → preparing. Atómico: devuelve si esta petición lo consiguió. */
  claimLaunch(id: number, scheduledAt: Date | null, actor: string): Promise<boolean>;
  setPrepared(id: number, p: { listId: number; processIds: number[]; recipients: number }): Promise<void>;
  /** Guarda el id de la campaña de Brevo solo si aún no había otro (dos peticiones a la vez: gana la primera). */
  setBrevoCampaign(id: number, brevoCampaignId: number, kind: "send" | "test"): Promise<boolean>;
  /** Reserva el envío ANTES de pedírselo a Brevo; solo una petición lo consigue (no se envía dos veces). */
  claimSend(id: number): Promise<boolean>;
  setStatus(id: number, status: CampaignStatus, p?: { errorMessage?: string | null; sentAt?: Date | null; brevoStatus?: string | null }): Promise<void>;
  saveStats(id: number, stats: CampaignStats | null, brevoStatus: string): Promise<void>;
  /** Campañas que el job revisa: preparándose, programadas o enviadas con estadísticas viejas. */
  due(limit: number, statsOlderThanMs: number): Promise<number[]>;

  saveRecipients(id: number, listId: number, rows: Array<{ clientId: number; email: string }>): Promise<void>;
  /** Clientes de la campaña por correo (de su lista de Brevo actual). */
  recipientsByEmail(id: number, listId: number): Promise<Map<string, number[]>>;

  /** Clientes con consentimiento CONCEDIDO del segmento (sin etiquetas: todos los que lo tienen). */
  audience(tagIds: number[], mode: TagMode): Promise<AudienceRow[]>;
  /** Correos (normalizados) de fichas con el consentimiento retirado. */
  withdrawnEmails(): Promise<Set<string>>;
  tags(): Promise<Array<{ id: number; name: string; color: string | null; consenting: number }>>;

  event(id: number, kind: string, detail: string | null, actor: string): Promise<void>;
  events(id: number): Promise<CampaignEvent[]>;
}

// ── En memoria (pruebas) ─────────────────────────────────────────────────────────

const nowIso = () => new Date().toISOString();

export class MemoryCampaignStore implements CampaignStore {
  private set: CampaignSettings = { folderId: null, attributeReady: false };
  rows: Campaign[] = [];
  ev: Array<CampaignEvent & { id: number }> = [];
  rec = new Map<number, Array<{ clientId: number; email: string; listId: number }>>();
  // CRM simulado
  clients: Array<{ id: number; email: string | null; name: string | null }> = [];
  consents = new Map<number, "granted" | "withdrawn">();
  tagLinks: Array<{ tagId: number; clientId: number }> = [];
  tagRows: Array<{ id: number; name: string }> = [];

  async settings() {
    return { ...this.set };
  }
  async saveSettings(p: Partial<CampaignSettings>) {
    Object.assign(this.set, p);
  }
  async list(limit: number) {
    return [...this.rows].reverse().slice(0, limit).map((r) => structuredClone(r));
  }
  async get(id: number) {
    const r = this.rows.find((x) => x.id === id);
    return r ? structuredClone(r) : null;
  }
  async create(d: DraftInput, actor: string) {
    const id = this.rows.length + 1;
    this.rows.push({
      ...structuredClone(d),
      id,
      status: "draft",
      scheduledAt: null,
      brevoListId: null,
      brevoCampaignId: null,
      brevoTestCampaignId: null,
      brevoStatus: null,
      processIds: [],
      recipients: 0,
      sendClaimedAt: null,
      sentAt: null,
      errorMessage: null,
      stats: null,
      statsAt: null,
      createdBy: actor,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    });
    return id;
  }
  private row(id: number) {
    return this.rows.find((x) => x.id === id)!;
  }
  async updateDraft(id: number, d: DraftInput) {
    const r = this.rows.find((x) => x.id === id);
    if (!r || r.status !== "draft") return false;
    Object.assign(r, structuredClone(d), { updatedAt: nowIso() });
    return true;
  }
  async claimLaunch(id: number, scheduledAt: Date | null) {
    const r = this.rows.find((x) => x.id === id);
    if (!r || !(r.status === "draft" || r.status === "failed") || r.sendClaimedAt) return false;
    Object.assign(r, { status: "preparing", scheduledAt: scheduledAt?.toISOString() ?? null, errorMessage: null });
    return true;
  }
  async setPrepared(id: number, p: { listId: number; processIds: number[]; recipients: number }) {
    Object.assign(this.row(id), { brevoListId: p.listId, processIds: [...p.processIds], recipients: p.recipients });
  }
  async setBrevoCampaign(id: number, brevoCampaignId: number, kind: "send" | "test") {
    const r = this.row(id);
    const k = kind === "test" ? "brevoTestCampaignId" : "brevoCampaignId";
    if (r[k] != null) return false;
    r[k] = brevoCampaignId;
    return true;
  }
  async claimSend(id: number) {
    const r = this.row(id);
    if (r.status !== "preparing" || r.sendClaimedAt) return false;
    r.sendClaimedAt = nowIso();
    return true;
  }
  async setStatus(id: number, status: CampaignStatus, p: { errorMessage?: string | null; sentAt?: Date | null; brevoStatus?: string | null } = {}) {
    const r = this.row(id);
    r.status = status;
    if (p.errorMessage !== undefined) r.errorMessage = p.errorMessage;
    if (p.sentAt !== undefined) r.sentAt = p.sentAt?.toISOString() ?? null;
    if (p.brevoStatus !== undefined) r.brevoStatus = p.brevoStatus;
  }
  async saveStats(id: number, stats: CampaignStats | null, brevoStatus: string) {
    Object.assign(this.row(id), { stats, brevoStatus, statsAt: nowIso() });
  }
  async due(limit: number, olderMs: number) {
    const cut = Date.now() - olderMs;
    return this.rows
      .filter((r) => r.status === "preparing" || r.status === "scheduled" || (r.status === "sent" && (!r.statsAt || new Date(r.statsAt).getTime() < cut)))
      .slice(0, limit)
      .map((r) => r.id);
  }
  async saveRecipients(id: number, listId: number, rows: Array<{ clientId: number; email: string }>) {
    const cur = (this.rec.get(id) ?? []).filter((x) => !rows.some((r) => r.clientId === x.clientId));
    this.rec.set(id, [...cur, ...rows.map((r) => ({ ...r, listId }))]);
  }
  async recipientsByEmail(id: number, listId: number) {
    const m = new Map<string, number[]>();
    for (const r of this.rec.get(id) ?? []) if (r.listId === listId) m.set(r.email, [...(m.get(r.email) ?? []), r.clientId]);
    return m;
  }
  async audience(tagIds: number[], mode: TagMode) {
    return this.clients
      .filter((c) => this.consents.get(c.id) === "granted")
      .filter((c) => {
        if (!tagIds.length) return true;
        const mine = new Set(this.tagLinks.filter((l) => l.clientId === c.id).map((l) => l.tagId));
        return mode === "all" ? tagIds.every((t) => mine.has(t)) : tagIds.some((t) => mine.has(t));
      })
      .map((c) => ({ clientId: c.id, email: c.email, name: c.name }));
  }
  async withdrawnEmails() {
    return new Set(this.clients.filter((c) => this.consents.get(c.id) === "withdrawn" && c.email).map((c) => c.email!.trim().toLowerCase()));
  }
  async tags() {
    return this.tagRows.map((t) => ({ ...t, color: null, consenting: this.tagLinks.filter((l) => l.tagId === t.id && this.consents.get(l.clientId) === "granted").length }));
  }
  async event(id: number, kind: string, detail: string | null, actor: string) {
    this.ev.push({ id: this.ev.length + 1, kind, detail, actor, createdAt: nowIso(), campaignId: id } as never);
  }
  async events(id: number) {
    return this.ev.filter((e) => (e as unknown as { campaignId: number }).campaignId === id).map(({ kind, detail, actor, createdAt }) => ({ kind, detail, actor, createdAt }));
  }
}

// ── BD de la empresa ─────────────────────────────────────────────────────────────

type Row = Record<string, unknown>;
type Db = NonNullable<Awaited<ReturnType<typeof getTenantDatabase>>>;
const rowsOf = (res: unknown): Row[] => (res as [Row[]])[0];
const affected = (res: unknown) => Number((res as [{ affectedRows: number }])[0].affectedRows);
const iso = (v: unknown) => (v == null ? null : v instanceof Date ? v.toISOString() : String(v));
const num = (v: unknown) => (v == null ? null : Number(v));
const str = (v: unknown) => (v == null ? null : String(v));
const ids = (v: unknown): number[] =>
  String(v ?? "")
    .split(",")
    .map((x) => Number(x))
    .filter((x) => Number.isInteger(x) && x > 0);
const ms = (v: unknown) => (v == null ? null : new Date(Number(v)).toISOString());

function isMissingTable(err: unknown): boolean {
  for (let e: any = err, depth = 0; e && depth < 5; e = e.cause, depth++) {
    if (e.code === "ER_NO_SUCH_TABLE" || e.errno === 1146) return /campaign_|customer_marketing_|crm_tag/.test(String(e.sqlMessage ?? e.message ?? ""));
  }
  return false;
}

function parseBlocks(v: unknown): CampaignBlock[] {
  try {
    const b = JSON.parse(String(v ?? "[]"));
    return Array.isArray(b) ? (b as CampaignBlock[]) : [];
  } catch {
    return [];
  }
}

const toCampaign = (r: Row): Campaign => ({
  id: Number(r.id),
  name: String(r.name),
  subject: String(r.subject ?? ""),
  previewText: str(r.preview_text),
  senderId: num(r.sender_id),
  senderName: str(r.sender_name),
  senderEmail: str(r.sender_email),
  replyTo: str(r.reply_to),
  blocks: parseBlocks(r.blocks),
  tagIds: ids(r.tag_ids),
  tagMode: r.tag_mode === "all" ? "all" : "any",
  status: r.status as CampaignStatus,
  scheduledAt: ms(r.scheduled_at),
  brevoListId: num(r.brevo_list_id),
  brevoCampaignId: num(r.brevo_campaign_id),
  brevoTestCampaignId: num(r.brevo_test_campaign_id),
  brevoStatus: str(r.brevo_status),
  processIds: ids(r.import_process_ids),
  recipients: Number(r.recipients ?? 0),
  sendClaimedAt: iso(r.send_claimed_at),
  sentAt: ms(r.sent_at),
  errorMessage: str(r.error_message),
  stats:
    r.stats_at == null
      ? null
      : {
          sent: Number(r.stat_sent ?? 0),
          delivered: Number(r.stat_delivered ?? 0),
          opens: Number(r.stat_opens ?? 0),
          clicks: Number(r.stat_clicks ?? 0),
          unsubscribed: Number(r.stat_unsubscribed ?? 0),
          bounces: Number(r.stat_bounces ?? 0),
          complaints: Number(r.stat_complaints ?? 0),
        },
  statsAt: iso(r.stats_at),
  createdBy: String(r.created_by),
  createdAt: iso(r.created_at)!,
  updatedAt: iso(r.updated_at)!,
});

export class TenantDbCampaignStore implements CampaignStore {
  private async exec<T>(fn: (db: Db) => Promise<T>): Promise<T> {
    const db = await getTenantDatabase();
    if (!db) throw new Error("Base de datos no disponible");
    try {
      return await fn(db);
    } catch (e) {
      if (isMissingTable(e)) throw new CampaignsNotInstalled();
      throw e;
    }
  }

  settings() {
    return this.exec(async (db) => {
      const [r] = rowsOf(await db.execute(sql`SELECT folder_id, attribute_ready FROM campaign_settings WHERE id = 1`));
      return { folderId: num(r?.folder_id), attributeReady: Number(r?.attribute_ready ?? 0) === 1 };
    });
  }
  saveSettings(p: Partial<CampaignSettings>) {
    return this.exec(async (db) => {
      await db.execute(sql`INSERT IGNORE INTO campaign_settings (id) VALUES (1)`);
      const sets = [];
      if (p.folderId !== undefined) sets.push(sql`folder_id = ${p.folderId}`);
      if (p.attributeReady !== undefined) sets.push(sql`attribute_ready = ${p.attributeReady ? 1 : 0}`);
      if (sets.length) await db.execute(sql`UPDATE campaign_settings SET ${sql.join(sets, sql`, `)} WHERE id = 1`);
    });
  }

  list(limit: number) {
    return this.exec(async (db) => rowsOf(await db.execute(sql`SELECT * FROM campaign_campaigns ORDER BY id DESC LIMIT ${limit}`)).map(toCampaign));
  }
  get(id: number) {
    return this.exec(async (db) => {
      const [r] = rowsOf(await db.execute(sql`SELECT * FROM campaign_campaigns WHERE id = ${id}`));
      return r ? toCampaign(r) : null;
    });
  }
  create(d: DraftInput, actor: string) {
    return this.exec(async (db) => {
      const res = await db.execute(sql`
        INSERT INTO campaign_campaigns (name, subject, preview_text, sender_id, sender_name, sender_email, reply_to, blocks, tag_ids, tag_mode, created_by, updated_by)
        VALUES (${d.name}, ${d.subject}, ${d.previewText}, ${d.senderId}, ${d.senderName}, ${d.senderEmail}, ${d.replyTo}, ${JSON.stringify(d.blocks)}, ${d.tagIds.join(",") || null}, ${d.tagMode}, ${actor.slice(0, 100)}, ${actor.slice(0, 100)})`);
      return Number((res as unknown as [{ insertId: number }])[0].insertId);
    });
  }
  updateDraft(id: number, d: DraftInput, actor: string) {
    return this.exec(async (db) =>
      affected(
        await db.execute(sql`
          UPDATE campaign_campaigns SET name = ${d.name}, subject = ${d.subject}, preview_text = ${d.previewText}, sender_id = ${d.senderId}, sender_name = ${d.senderName},
            sender_email = ${d.senderEmail}, reply_to = ${d.replyTo}, blocks = ${JSON.stringify(d.blocks)}, tag_ids = ${d.tagIds.join(",") || null}, tag_mode = ${d.tagMode}, updated_by = ${actor.slice(0, 100)}
          WHERE id = ${id} AND status = 'draft'`),
      ) > 0,
    );
  }

  claimLaunch(id: number, scheduledAt: Date | null, actor: string) {
    return this.exec(
      async (db) =>
        affected(
          await db.execute(sql`
            UPDATE campaign_campaigns SET status = 'preparing', scheduled_at = ${scheduledAt ? scheduledAt.getTime() : null}, error_message = NULL, updated_by = ${actor.slice(0, 100)}
            WHERE id = ${id} AND status IN ('draft', 'failed') AND send_claimed_at IS NULL`),
        ) === 1,
    );
  }
  setPrepared(id: number, p: { listId: number; processIds: number[]; recipients: number }) {
    return this.exec(async (db) => {
      await db.execute(sql`UPDATE campaign_campaigns SET brevo_list_id = ${p.listId}, import_process_ids = ${p.processIds.join(",").slice(0, 500) || null}, recipients = ${p.recipients} WHERE id = ${id}`);
    });
  }
  setBrevoCampaign(id: number, brevoCampaignId: number, kind: "send" | "test") {
    return this.exec(
      async (db) =>
        affected(
          await db.execute(
            kind === "test"
              ? sql`UPDATE campaign_campaigns SET brevo_test_campaign_id = ${brevoCampaignId} WHERE id = ${id} AND brevo_test_campaign_id IS NULL`
              : sql`UPDATE campaign_campaigns SET brevo_campaign_id = ${brevoCampaignId} WHERE id = ${id} AND brevo_campaign_id IS NULL`,
          ),
        ) === 1,
    );
  }
  claimSend(id: number) {
    return this.exec(
      async (db) => affected(await db.execute(sql`UPDATE campaign_campaigns SET send_claimed_at = CURRENT_TIMESTAMP(3) WHERE id = ${id} AND status = 'preparing' AND send_claimed_at IS NULL`)) === 1,
    );
  }
  setStatus(id: number, status: CampaignStatus, p: { errorMessage?: string | null; sentAt?: Date | null; brevoStatus?: string | null } = {}) {
    return this.exec(async (db) => {
      const sets = [sql`status = ${status}`];
      if (p.errorMessage !== undefined) sets.push(sql`error_message = ${p.errorMessage?.slice(0, 500) ?? null}`);
      if (p.sentAt !== undefined) sets.push(sql`sent_at = ${p.sentAt ? p.sentAt.getTime() : null}`);
      if (p.brevoStatus !== undefined) sets.push(sql`brevo_status = ${p.brevoStatus?.slice(0, 20) ?? null}`);
      await db.execute(sql`UPDATE campaign_campaigns SET ${sql.join(sets, sql`, `)} WHERE id = ${id}`);
    });
  }
  saveStats(id: number, s: CampaignStats | null, brevoStatus: string) {
    return this.exec(async (db) => {
      await db.execute(sql`
        UPDATE campaign_campaigns SET brevo_status = ${brevoStatus.slice(0, 20)}, stats_at = CURRENT_TIMESTAMP(3)
          ${s ? sql`, stat_sent = ${s.sent}, stat_delivered = ${s.delivered}, stat_opens = ${s.opens}, stat_clicks = ${s.clicks}, stat_unsubscribed = ${s.unsubscribed}, stat_bounces = ${s.bounces}, stat_complaints = ${s.complaints}` : sql``}
        WHERE id = ${id}`);
    });
  }
  due(limit: number, statsOlderThanMs: number) {
    return this.exec(async (db) =>
      rowsOf(
        await db.execute(sql`
          SELECT id FROM campaign_campaigns
          WHERE status IN ('preparing', 'scheduled')
             OR (status = 'sent' AND sent_at > ${Date.now() - 30 * 86_400_000} AND (stats_at IS NULL OR stats_at < NOW(3) - INTERVAL ${Math.max(1, Math.round(statsOlderThanMs / 1000))} SECOND))
          ORDER BY id LIMIT ${limit}`),
      ).map((r) => Number(r.id)),
    );
  }

  saveRecipients(id: number, listId: number, rows: Array<{ clientId: number; email: string }>) {
    if (!rows.length) return Promise.resolve();
    return this.exec(async (db) => {
      for (let i = 0; i < rows.length; i += 500) {
        const values = rows.slice(i, i + 500).map((r) => sql`(${id}, ${r.clientId}, ${r.email}, ${listId})`);
        await db.execute(sql`
          INSERT INTO campaign_recipients (campaign_id, client_id, email_normalized, brevo_list_id) VALUES ${sql.join(values, sql`, `)}
          ON DUPLICATE KEY UPDATE email_normalized = VALUES(email_normalized), brevo_list_id = VALUES(brevo_list_id)`);
      }
    });
  }
  recipientsByEmail(id: number, listId: number) {
    return this.exec(async (db) => {
      const m = new Map<string, number[]>();
      for (const r of rowsOf(await db.execute(sql`SELECT client_id, email_normalized FROM campaign_recipients WHERE campaign_id = ${id} AND brevo_list_id = ${listId}`))) {
        const e = String(r.email_normalized);
        m.set(e, [...(m.get(e) ?? []), Number(r.client_id)]);
      }
      return m;
    });
  }

  audience(tagIds: number[], mode: TagMode) {
    const tags = tagIds.length
      ? mode === "all"
        ? sql`AND c.id IN (SELECT entity_id FROM crm_tag_links WHERE entity_type = 'client' AND tag_id IN (${sql.join(
            tagIds.map((t) => sql`${t}`),
            sql`, `,
          )}) GROUP BY entity_id HAVING COUNT(DISTINCT tag_id) = ${tagIds.length})`
        : sql`AND c.id IN (SELECT entity_id FROM crm_tag_links WHERE entity_type = 'client' AND tag_id IN (${sql.join(
            tagIds.map((t) => sql`${t}`),
            sql`, `,
          )}))`
      : sql``;
    return this.exec(async (db) =>
      rowsOf(await db.execute(sql`SELECT c.id, c.email, c.name FROM clients c JOIN customer_marketing_consents m ON m.client_id = c.id AND m.status = 'granted' WHERE 1 = 1 ${tags}`)).map((r) => ({
        clientId: Number(r.id),
        email: str(r.email),
        name: str(r.name),
      })),
    );
  }
  withdrawnEmails() {
    return this.exec(
      async (db) =>
        new Set(
          rowsOf(await db.execute(sql`SELECT LOWER(TRIM(c.email)) AS e FROM clients c JOIN customer_marketing_consents m ON m.client_id = c.id AND m.status = 'withdrawn' WHERE c.email IS NOT NULL`)).map((r) =>
            String(r.e),
          ),
        ),
    );
  }
  tags() {
    return this.exec(async (db) =>
      rowsOf(
        await db.execute(sql`
          SELECT t.id, t.name, t.color, COUNT(DISTINCT m.client_id) AS consenting FROM crm_tags t
          LEFT JOIN crm_tag_links l ON l.tag_id = t.id AND l.entity_type = 'client'
          LEFT JOIN customer_marketing_consents m ON m.client_id = l.entity_id AND m.status = 'granted'
          GROUP BY t.id, t.name, t.color ORDER BY t.name`),
      ).map((r) => ({ id: Number(r.id), name: String(r.name), color: str(r.color), consenting: Number(r.consenting ?? 0) })),
    );
  }

  event(id: number, kind: string, detail: string | null, actor: string) {
    return this.exec(async (db) => {
      await db.execute(sql`INSERT INTO campaign_events (campaign_id, kind, detail, actor) VALUES (${id}, ${kind.slice(0, 20)}, ${detail?.slice(0, 500) ?? null}, ${actor.slice(0, 100)})`);
    });
  }
  events(id: number) {
    return this.exec(async (db) =>
      rowsOf(await db.execute(sql`SELECT kind, detail, actor, created_at FROM campaign_events WHERE campaign_id = ${id} ORDER BY id DESC LIMIT 50`)).map((r) => ({
        kind: String(r.kind),
        detail: str(r.detail),
        actor: String(r.actor),
        createdAt: iso(r.created_at)!,
      })),
    );
  }
}
