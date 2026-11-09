/**
 * Persistencia de Elephant Reception AI en la BD de la empresa en curso (migración
 * `db/migrations/0056_connect_reception_ai.sql`). Tablas fuera de drizzle/schema.ts y SQL parametrizado (patrón de
 * server/connectCampaigns/store.ts). Sin las tablas → `ReceptionNotInstalled`. Nada se borra: el conocimiento se
 * archiva y las conversaciones se conservan como registro.
 */
import { sql, type SQL } from "drizzle-orm";
import { getTenantDatabase } from "../_core/dbRegistry";
import {
  DEFAULT_SETTINGS,
  RECEPTION_LANGUAGES,
  RECEPTION_OUTCOMES,
  RECEPTION_TONES,
  KNOWLEDGE_KINDS,
  parseHours,
  type KnowledgeItem,
  type KnowledgeKind,
  type ReceptionChannel,
  type ReceptionOutcome,
  type ReceptionSettings,
  type SettingsInput,
} from "../../shared/receptionAi";

export class ReceptionNotInstalled extends Error {
  constructor() {
    super("La recepcionista virtual aún no está preparada en tu empresa: falta aplicar las actualizaciones 0056_connect_reception_ai y 0057_reception_ai_cupos de su base de datos.");
    this.name = "ReceptionNotInstalled";
  }
}

export type MessageRole = "user" | "assistant" | "tool";
/** Cupos diarios del chat (migración 0057): respuestas de la IA y solicitudes creadas desde el chat. */
export type ReceptionQuotaKind = "chat_reply" | "chat_lead";
/** customer: lo escribe o dice el cliente · ai: respuesta de la IA · fallback: respuesta fija sin IA · tool: herramienta de voz. */
export type MessageOrigin = "customer" | "ai" | "fallback" | "tool";

export interface Conversation {
  id: number;
  channel: ReceptionChannel;
  externalRef: string;
  outcome: ReceptionOutcome;
  outcomeSource: "auto" | "manual";
  customerName: string | null;
  customerPhone: string | null;
  customerEmail: string | null;
  leadId: number | null;
  summary: string | null;
  endedReason: string | null;
  durationSeconds: number | null;
  messageCount: number;
  aiReplies: number;
  startedAt: string;
  lastActivityAt: string;
}

export interface StoredMessage {
  id: number;
  role: MessageRole;
  origin: MessageOrigin;
  content: string;
  createdAt: string;
}

export type ConversationPatch = Partial<Pick<Conversation, "outcome" | "outcomeSource" | "customerName" | "customerPhone" | "customerEmail" | "leadId" | "summary" | "endedReason" | "durationSeconds">>;

export interface ConversationFilter {
  channel?: ReceptionChannel;
  outcome?: ReceptionOutcome;
  days: number;
  limit: number;
  offset: number;
  search?: string;
}

export interface KnowledgeInput {
  kind: KnowledgeKind;
  question: string;
  answer: string;
  sortOrder: number;
}

export interface ReceptionStore {
  settings(): Promise<ReceptionSettings>;
  saveSettings(s: SettingsInput, actor: number | null): Promise<void>;
  /** Nueva versión del enlace del chat (el anterior deja de valer). Devuelve la nueva. */
  bumpChatKey(): Promise<number>;
  setVapiSync(p: { assistantId: string; hash: string }): Promise<void>;

  knowledge(includeArchived: boolean): Promise<KnowledgeItem[]>;
  addKnowledge(k: KnowledgeInput, actor: number | null): Promise<number>;
  updateKnowledge(id: number, k: KnowledgeInput): Promise<boolean>;
  archiveKnowledge(id: number, archived: boolean): Promise<boolean>;

  conversationByRef(channel: ReceptionChannel, ref: string): Promise<Conversation | null>;
  /** Crea la conversación si no existe (idempotente por canal y referencia) y la devuelve. */
  ensureConversation(channel: ReceptionChannel, ref: string): Promise<Conversation>;
  updateConversation(id: number, patch: ConversationPatch): Promise<void>;
  addMessage(conversationId: number, role: MessageRole, origin: MessageOrigin, content: string): Promise<void>;
  messages(conversationId: number, limit: number): Promise<StoredMessage[]>;
  conversation(id: number): Promise<Conversation | null>;
  conversations(f: ConversationFilter): Promise<{ rows: Conversation[]; total: number }>;
  /** Respuestas de la IA (chat) en los últimos `seconds` segundos. */
  aiRepliesSince(seconds: number): Promise<number>;
  /**
   * Reserva atómica de una unidad del cupo diario `kind` del día `day` (AAAA-MM-DD en la zona de la empresa). true si
   * quedaba cupo (y ya está consumido); false si se ha llegado a `limit`. Dos peticiones a la vez nunca superan el máximo.
   */
  reserveDaily(kind: ReceptionQuotaKind, day: string, limit: number): Promise<boolean>;
  /** Devuelve al cupo una unidad reservada que no se llegó a usar (la IA no respondió o no se creó la solicitud). */
  releaseDaily(kind: ReceptionQuotaKind, day: string): Promise<void>;
  stats(days: number): Promise<Array<{ channel: ReceptionChannel; outcome: ReceptionOutcome; n: number }>>;
}

// ── Conversión de filas ──────────────────────────────────────────────────────────

type Row = Record<string, any>;
const iso = (v: unknown) => (v == null ? null : v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString());
const num = (v: unknown) => (v == null ? null : Number(v));
const str = (v: unknown) => (v == null || v === "" ? null : String(v));
const bool = (v: unknown) => v === true || v === 1 || v === "1";
const pick = <T extends string>(v: unknown, list: readonly T[], fallback: T): T => (list.includes(v as T) ? (v as T) : fallback);

function toSettings(r: Row | undefined): ReceptionSettings {
  if (!r) return { ...DEFAULT_SETTINGS, humanHours: [] };
  return {
    enabled: bool(r.is_enabled),
    assistantName: String(r.assistant_name ?? DEFAULT_SETTINGS.assistantName),
    language: pick(r.language, RECEPTION_LANGUAGES, "es"),
    tone: pick(r.tone, RECEPTION_TONES, "cercano"),
    greeting: str(r.greeting),
    businessSummary: str(r.business_summary),
    address: str(r.address),
    openingHours: str(r.opening_hours),
    humanHours: parseHours(r.human_hours),
    timezone: String(r.timezone ?? DEFAULT_SETTINGS.timezone),
    includeCatalog: bool(r.include_catalog),
    transferEnabled: bool(r.transfer_enabled),
    transferNumber: str(r.transfer_number),
    leadEnabled: bool(r.lead_enabled),
    callbackEnabled: bool(r.callback_enabled),
    extraRules: str(r.extra_rules),
    chatEnabled: bool(r.chat_enabled),
    chatKeyVersion: Number(r.chat_key_version ?? 1),
    chatDailyLimit: Number(r.chat_daily_limit ?? DEFAULT_SETTINGS.chatDailyLimit),
    vapiAssistantId: str(r.vapi_assistant_id),
    vapiSyncedAt: iso(r.vapi_synced_at),
    vapiSyncedHash: str(r.vapi_synced_hash),
    updatedAt: iso(r.updated_at),
  };
}

const toKnowledge = (r: Row): KnowledgeItem => ({
  id: Number(r.id),
  kind: pick(r.kind, KNOWLEDGE_KINDS, "faq"),
  question: String(r.question),
  answer: String(r.answer),
  sortOrder: Number(r.sort_order ?? 0),
  archived: bool(r.is_archived),
});

const toConversation = (r: Row): Conversation => ({
  id: Number(r.id),
  channel: r.channel === "voice" ? "voice" : "chat",
  externalRef: String(r.external_ref),
  outcome: pick(r.outcome, RECEPTION_OUTCOMES, "open"),
  outcomeSource: r.outcome_source === "manual" ? "manual" : "auto",
  customerName: str(r.customer_name),
  customerPhone: str(r.customer_phone),
  customerEmail: str(r.customer_email),
  leadId: num(r.lead_id),
  summary: str(r.summary),
  endedReason: str(r.ended_reason),
  durationSeconds: num(r.duration_seconds),
  messageCount: Number(r.message_count ?? 0),
  aiReplies: Number(r.ai_replies ?? 0),
  startedAt: iso(r.started_at) ?? new Date(0).toISOString(),
  lastActivityAt: iso(r.last_activity_at) ?? new Date(0).toISOString(),
});

const toMessage = (r: Row): StoredMessage => ({
  id: Number(r.id),
  role: pick(r.role, ["user", "assistant", "tool"] as const, "user"),
  origin: pick(r.origin, ["customer", "ai", "fallback", "tool"] as const, "customer"),
  content: String(r.content),
  createdAt: iso(r.created_at) ?? new Date(0).toISOString(),
});

// ── En memoria (pruebas) ─────────────────────────────────────────────────────────

export class MemoryReceptionStore implements ReceptionStore {
  set: ReceptionSettings = { ...DEFAULT_SETTINGS, humanHours: [] };
  items: KnowledgeItem[] = [];
  convs: Conversation[] = [];
  msgs: Array<StoredMessage & { conversationId: number; at: number }> = [];
  clock: () => number = () => Date.now();
  quotas = new Map<string, number>();

  async settings() {
    return structuredClone(this.set);
  }
  async saveSettings(s: SettingsInput) {
    this.set = { ...this.set, ...structuredClone(s), updatedAt: new Date(this.clock()).toISOString() };
  }
  async bumpChatKey() {
    this.set.chatKeyVersion += 1;
    return this.set.chatKeyVersion;
  }
  async setVapiSync(p: { assistantId: string; hash: string }) {
    this.set.vapiAssistantId = p.assistantId;
    this.set.vapiSyncedHash = p.hash;
    this.set.vapiSyncedAt = new Date(this.clock()).toISOString();
  }
  async knowledge(includeArchived: boolean) {
    return this.items.filter((i) => includeArchived || !i.archived).sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id).map((i) => ({ ...i }));
  }
  async addKnowledge(k: KnowledgeInput) {
    const id = this.items.length + 1;
    this.items.push({ id, ...k, archived: false });
    return id;
  }
  async updateKnowledge(id: number, k: KnowledgeInput) {
    const it = this.items.find((i) => i.id === id);
    if (!it) return false;
    Object.assign(it, k);
    return true;
  }
  async archiveKnowledge(id: number, archived: boolean) {
    const it = this.items.find((i) => i.id === id);
    if (!it) return false;
    it.archived = archived;
    return true;
  }
  async conversationByRef(channel: ReceptionChannel, ref: string) {
    const c = this.convs.find((x) => x.channel === channel && x.externalRef === ref);
    return c ? { ...c } : null;
  }
  async ensureConversation(channel: ReceptionChannel, ref: string) {
    let c = this.convs.find((x) => x.channel === channel && x.externalRef === ref);
    if (!c) {
      const now = new Date(this.clock()).toISOString();
      c = { id: this.convs.length + 1, channel, externalRef: ref, outcome: "open", outcomeSource: "auto", customerName: null, customerPhone: null, customerEmail: null, leadId: null, summary: null, endedReason: null, durationSeconds: null, messageCount: 0, aiReplies: 0, startedAt: now, lastActivityAt: now };
      this.convs.push(c);
    }
    return { ...c };
  }
  async updateConversation(id: number, patch: ConversationPatch) {
    const c = this.convs.find((x) => x.id === id);
    if (c) Object.assign(c, patch, { lastActivityAt: new Date(this.clock()).toISOString() });
  }
  async addMessage(conversationId: number, role: MessageRole, origin: MessageOrigin, content: string) {
    const at = this.clock();
    this.msgs.push({ id: this.msgs.length + 1, conversationId, role, origin, content, createdAt: new Date(at).toISOString(), at });
    const c = this.convs.find((x) => x.id === conversationId);
    if (c) {
      c.messageCount += 1;
      if (origin === "ai") c.aiReplies += 1;
      c.lastActivityAt = new Date(at).toISOString();
    }
  }
  async messages(conversationId: number, limit: number) {
    return this.msgs.filter((m) => m.conversationId === conversationId).slice(-limit).map(({ conversationId: _c, at: _a, ...m }) => m);
  }
  async conversation(id: number) {
    const c = this.convs.find((x) => x.id === id);
    return c ? { ...c } : null;
  }
  async conversations(f: ConversationFilter) {
    const since = this.clock() - f.days * 86_400_000;
    const s = f.search?.toLowerCase();
    const all = this.convs
      .filter((c) => Date.parse(c.startedAt) >= since && (!f.channel || c.channel === f.channel) && (!f.outcome || c.outcome === f.outcome))
      .filter((c) => !s || [c.customerName, c.customerPhone, c.customerEmail, c.summary].some((v) => v?.toLowerCase().includes(s)))
      .reverse();
    return { rows: all.slice(f.offset, f.offset + f.limit).map((c) => ({ ...c })), total: all.length };
  }
  async aiRepliesSince(seconds: number) {
    const since = this.clock() - seconds * 1000;
    return this.msgs.filter((m) => m.origin === "ai" && m.at >= since).length;
  }
  async reserveDaily(kind: ReceptionQuotaKind, day: string, limit: number) {
    const k = `${day}:${kind}`;
    const used = this.quotas.get(k) ?? 0;
    if (used >= limit) return false;
    this.quotas.set(k, used + 1);
    return true;
  }
  async releaseDaily(kind: ReceptionQuotaKind, day: string) {
    const k = `${day}:${kind}`;
    this.quotas.set(k, Math.max(0, (this.quotas.get(k) ?? 0) - 1));
  }
  async stats(days: number) {
    const since = this.clock() - days * 86_400_000;
    const map = new Map<string, { channel: ReceptionChannel; outcome: ReceptionOutcome; n: number }>();
    for (const c of this.convs.filter((x) => Date.parse(x.startedAt) >= since)) {
      const k = `${c.channel}:${c.outcome}`;
      map.set(k, { channel: c.channel, outcome: c.outcome, n: (map.get(k)?.n ?? 0) + 1 });
    }
    return Array.from(map.values());
  }
}

// ── BD de la empresa ─────────────────────────────────────────────────────────────

type Db = NonNullable<Awaited<ReturnType<typeof getTenantDatabase>>>;
const rowsOf = (res: unknown): Row[] => (res as [Row[]])[0];
const affected = (res: unknown) => Number((res as [{ affectedRows: number }])[0].affectedRows ?? 0);
const insertId = (res: unknown) => Number((res as [{ insertId: number }])[0].insertId ?? 0);

export function isMissingReceptionTable(err: unknown): boolean {
  for (let e: any = err, depth = 0; e && depth < 6; e = e.cause, depth++) {
    if (e.code === "ER_NO_SUCH_TABLE" || e.errno === 1146) return /reception_/.test(String(e.sqlMessage ?? e.message ?? ""));
  }
  return false;
}

export class TenantDbReceptionStore implements ReceptionStore {
  private async exec<T>(fn: (db: Db) => Promise<T>): Promise<T> {
    const db = await getTenantDatabase();
    if (!db) throw new Error("Base de datos no disponible");
    try {
      return await fn(db);
    } catch (e) {
      if (isMissingReceptionTable(e)) throw new ReceptionNotInstalled();
      throw e;
    }
  }

  settings() {
    return this.exec(async (db) => toSettings(rowsOf(await db.execute(sql`SELECT * FROM reception_settings WHERE id = 1`))[0]));
  }
  saveSettings(s: SettingsInput, actor: number | null) {
    return this.exec(async (db) => {
      const b = (v: boolean) => (v ? 1 : 0);
      const hours = JSON.stringify(s.humanHours);
      await db.execute(sql`
        INSERT INTO reception_settings (id, is_enabled, assistant_name, language, tone, greeting, business_summary, address, opening_hours, human_hours, timezone,
          include_catalog, transfer_enabled, transfer_number, lead_enabled, callback_enabled, extra_rules, chat_enabled, chat_daily_limit, updated_by)
        VALUES (1, ${b(s.enabled)}, ${s.assistantName}, ${s.language}, ${s.tone}, ${s.greeting}, ${s.businessSummary}, ${s.address}, ${s.openingHours}, ${hours}, ${s.timezone},
          ${b(s.includeCatalog)}, ${b(s.transferEnabled)}, ${s.transferNumber}, ${b(s.leadEnabled)}, ${b(s.callbackEnabled)}, ${s.extraRules}, ${b(s.chatEnabled)}, ${s.chatDailyLimit}, ${actor})
        ON DUPLICATE KEY UPDATE is_enabled = VALUES(is_enabled), assistant_name = VALUES(assistant_name), language = VALUES(language), tone = VALUES(tone),
          greeting = VALUES(greeting), business_summary = VALUES(business_summary), address = VALUES(address), opening_hours = VALUES(opening_hours),
          human_hours = VALUES(human_hours), timezone = VALUES(timezone), include_catalog = VALUES(include_catalog), transfer_enabled = VALUES(transfer_enabled),
          transfer_number = VALUES(transfer_number), lead_enabled = VALUES(lead_enabled), callback_enabled = VALUES(callback_enabled), extra_rules = VALUES(extra_rules),
          chat_enabled = VALUES(chat_enabled), chat_daily_limit = VALUES(chat_daily_limit), updated_by = VALUES(updated_by)`);
    });
  }
  bumpChatKey() {
    return this.exec(async (db) => {
      await db.execute(sql`INSERT IGNORE INTO reception_settings (id) VALUES (1)`);
      await db.execute(sql`UPDATE reception_settings SET chat_key_version = chat_key_version + 1 WHERE id = 1`);
      return Number(rowsOf(await db.execute(sql`SELECT chat_key_version FROM reception_settings WHERE id = 1`))[0]?.chat_key_version ?? 1);
    });
  }
  setVapiSync(p: { assistantId: string; hash: string }) {
    return this.exec(async (db) => {
      await db.execute(sql`INSERT IGNORE INTO reception_settings (id) VALUES (1)`);
      await db.execute(sql`UPDATE reception_settings SET vapi_assistant_id = ${p.assistantId}, vapi_synced_hash = ${p.hash}, vapi_synced_at = CURRENT_TIMESTAMP(3) WHERE id = 1`);
    });
  }

  knowledge(includeArchived: boolean) {
    return this.exec(async (db) =>
      rowsOf(await db.execute(includeArchived ? sql`SELECT * FROM reception_knowledge ORDER BY sort_order, id` : sql`SELECT * FROM reception_knowledge WHERE is_archived = 0 ORDER BY sort_order, id`)).map(toKnowledge),
    );
  }
  addKnowledge(k: KnowledgeInput, actor: number | null) {
    return this.exec(async (db) => insertId(await db.execute(sql`INSERT INTO reception_knowledge (kind, question, answer, sort_order, created_by) VALUES (${k.kind}, ${k.question}, ${k.answer}, ${k.sortOrder}, ${actor})`)));
  }
  updateKnowledge(id: number, k: KnowledgeInput) {
    return this.exec(async (db) => affected(await db.execute(sql`UPDATE reception_knowledge SET kind = ${k.kind}, question = ${k.question}, answer = ${k.answer}, sort_order = ${k.sortOrder} WHERE id = ${id}`)) > 0);
  }
  archiveKnowledge(id: number, archived: boolean) {
    return this.exec(async (db) => {
      const [r] = rowsOf(await db.execute(sql`SELECT id FROM reception_knowledge WHERE id = ${id}`));
      if (!r) return false;
      await db.execute(sql`UPDATE reception_knowledge SET is_archived = ${archived ? 1 : 0} WHERE id = ${id}`);
      return true;
    });
  }

  conversationByRef(channel: ReceptionChannel, ref: string) {
    return this.exec(async (db) => {
      const [r] = rowsOf(await db.execute(sql`SELECT * FROM reception_conversations WHERE channel = ${channel} AND external_ref = ${ref}`));
      return r ? toConversation(r) : null;
    });
  }
  ensureConversation(channel: ReceptionChannel, ref: string) {
    return this.exec(async (db) => {
      await db.execute(sql`INSERT IGNORE INTO reception_conversations (channel, external_ref) VALUES (${channel}, ${ref})`);
      const [r] = rowsOf(await db.execute(sql`SELECT * FROM reception_conversations WHERE channel = ${channel} AND external_ref = ${ref}`));
      return toConversation(r);
    });
  }
  updateConversation(id: number, patch: ConversationPatch) {
    return this.exec(async (db) => {
      const cols: Record<keyof ConversationPatch, string> = {
        outcome: "outcome",
        outcomeSource: "outcome_source",
        customerName: "customer_name",
        customerPhone: "customer_phone",
        customerEmail: "customer_email",
        leadId: "lead_id",
        summary: "summary",
        endedReason: "ended_reason",
        durationSeconds: "duration_seconds",
      };
      const sets: SQL[] = [sql`last_activity_at = CURRENT_TIMESTAMP(3)`];
      for (const [k, col] of Object.entries(cols) as Array<[keyof ConversationPatch, string]>) {
        if (patch[k] !== undefined) sets.push(sql`${sql.raw(col)} = ${patch[k] as any}`);
      }
      await db.execute(sql`UPDATE reception_conversations SET ${sql.join(sets, sql`, `)} WHERE id = ${id}`);
    });
  }
  addMessage(conversationId: number, role: MessageRole, origin: MessageOrigin, content: string) {
    return this.exec(async (db) => {
      await db.execute(sql`INSERT INTO reception_messages (conversation_id, role, origin, content) VALUES (${conversationId}, ${role}, ${origin}, ${content.slice(0, 4000)})`);
      await db.execute(sql`UPDATE reception_conversations SET message_count = message_count + 1, ai_replies = ai_replies + ${origin === "ai" ? 1 : 0}, last_activity_at = CURRENT_TIMESTAMP(3) WHERE id = ${conversationId}`);
    });
  }
  messages(conversationId: number, limit: number) {
    return this.exec(async (db) =>
      rowsOf(await db.execute(sql`SELECT * FROM (SELECT * FROM reception_messages WHERE conversation_id = ${conversationId} ORDER BY id DESC LIMIT ${limit}) m ORDER BY id`)).map(toMessage),
    );
  }
  conversation(id: number) {
    return this.exec(async (db) => {
      const [r] = rowsOf(await db.execute(sql`SELECT * FROM reception_conversations WHERE id = ${id}`));
      return r ? toConversation(r) : null;
    });
  }
  conversations(f: ConversationFilter) {
    return this.exec(async (db) => {
      const where: SQL[] = [sql`started_at >= NOW(3) - INTERVAL ${f.days} DAY`];
      if (f.channel) where.push(sql`channel = ${f.channel}`);
      if (f.outcome) where.push(sql`outcome = ${f.outcome}`);
      if (f.search) {
        const s = `%${f.search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
        where.push(sql`(customer_name LIKE ${s} OR customer_phone LIKE ${s} OR customer_email LIKE ${s} OR summary LIKE ${s})`);
      }
      const w = sql.join(where, sql` AND `);
      const rows = rowsOf(await db.execute(sql`SELECT * FROM reception_conversations WHERE ${w} ORDER BY started_at DESC, id DESC LIMIT ${f.limit} OFFSET ${f.offset}`)).map(toConversation);
      const total = Number(rowsOf(await db.execute(sql`SELECT COUNT(*) AS n FROM reception_conversations WHERE ${w}`))[0]?.n ?? 0);
      return { rows, total };
    });
  }
  aiRepliesSince(seconds: number) {
    return this.exec(async (db) => Number(rowsOf(await db.execute(sql`SELECT COUNT(*) AS n FROM reception_messages WHERE origin = 'ai' AND created_at >= NOW(3) - INTERVAL ${seconds} SECOND`))[0]?.n ?? 0));
  }
  reserveDaily(kind: ReceptionQuotaKind, day: string, limit: number) {
    return this.exec(async (db) => {
      // La fila del día existe (idempotente) y el UPDATE condicionado consume una unidad solo si queda cupo: el bloqueo
      // de fila de InnoDB serializa las peticiones simultáneas, así que nunca se supera el máximo
      await db.execute(sql`INSERT IGNORE INTO reception_ai_cupos (dia, tipo, usados) VALUES (${day}, ${kind}, 0)`);
      return affected(await db.execute(sql`UPDATE reception_ai_cupos SET usados = usados + 1 WHERE dia = ${day} AND tipo = ${kind} AND usados < ${limit}`)) === 1;
    });
  }
  releaseDaily(kind: ReceptionQuotaKind, day: string) {
    return this.exec(async (db) => {
      await db.execute(sql`UPDATE reception_ai_cupos SET usados = usados - 1 WHERE dia = ${day} AND tipo = ${kind} AND usados > 0`);
    });
  }
  stats(days: number) {
    return this.exec(async (db) =>
      rowsOf(await db.execute(sql`SELECT channel, outcome, COUNT(*) AS n FROM reception_conversations WHERE started_at >= NOW(3) - INTERVAL ${days} DAY GROUP BY channel, outcome`)).map((r) => ({
        channel: (r.channel === "voice" ? "voice" : "chat") as ReceptionChannel,
        outcome: pick(r.outcome, RECEPTION_OUTCOMES, "open"),
        n: Number(r.n),
      })),
    );
  }
}
