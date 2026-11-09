/**
 * Persistencia de Elephant WhatsApp AI en la BD de la empresa en curso (migración
 * `db/migrations/0062_connect_whatsapp_ai.sql`). Tablas fuera de drizzle/schema.ts y SQL parametrizado (patrón de
 * server/receptionAi/store.ts). Sin las tablas → `WhatsappNotInstalled`. Nada se borra: es el registro de la empresa.
 *
 * Idempotencia: cada mensaje de Meta tiene un id único (`wamid`, clave única): el mismo webhook repetido no duplica
 * mensajes ni vuelve a disparar la IA.
 */
import { sql, type SQL } from "drizzle-orm";
import { getTenantDatabase } from "../_core/dbRegistry";
import { parseHours } from "../../shared/receptionAi";
import {
  DEFAULT_WHATSAPP_SETTINGS,
  nextStatus,
  MESSAGE_STATUSES,
  WHATSAPP_AI_MODES,
  type AiLogMode,
  type AiLogOutcome,
  type MessageDirection,
  type MessageOrigin,
  type MessageStatus,
  type WhatsappSettings,
  type WhatsappSettingsInput,
} from "../../shared/whatsappCloud";

export class WhatsappNotInstalled extends Error {
  constructor() {
    super("WhatsApp Business aún no está preparado en tu empresa: falta aplicar la actualización 0062_connect_whatsapp_ai de su base de datos.");
    this.name = "WhatsappNotInstalled";
  }
}

export interface WaConversation {
  id: number;
  phoneNumberId: string;
  waId: string;
  customerName: string | null;
  status: "open" | "closed";
  needsHuman: boolean;
  unreadCount: number;
  lastPreview: string | null;
  lastInboundAt: string | null;
  lastMessageAt: string;
  aiAutoReplies: number;
  createdAt: string;
}

export interface WaMessage {
  id: number;
  conversationId: number;
  wamid: string | null;
  direction: MessageDirection;
  kind: string;
  body: string;
  templateName: string | null;
  origin: MessageOrigin;
  status: MessageStatus;
  errorCode: string | null;
  errorTitle: string | null;
  sentBy: number | null;
  createdAt: string;
  statusAt: string | null;
}

export interface WaAiLogEntry {
  id: number;
  conversationId: number;
  messageId: number | null;
  mode: AiLogMode;
  outcome: AiLogOutcome;
  reply: string | null;
  actor: number | null;
  createdAt: string;
}

export interface InboundInput {
  wamid: string;
  kind: string;
  body: string;
  at: string;
  /** Aviso de WhatsApp o tipo no admitido: se guarda, sin contar como no leído ni tocar la ventana ni la vista previa. */
  quiet?: boolean;
}
export interface OutboundInput {
  wamid: string | null;
  kind: "text" | "template";
  body: string;
  templateName: string | null;
  origin: MessageOrigin;
  status: MessageStatus;
  sentBy: number | null;
  errorCode?: string | null;
  errorTitle?: string | null;
}

export interface ConversationListFilter {
  limit: number;
  offset: number;
  search?: string;
  needsHuman?: boolean;
}

export interface WhatsappStore {
  settings(): Promise<WhatsappSettings>;
  saveSettings(s: WhatsappSettingsInput, actor: number | null): Promise<void>;
  /** Crea la conversación del cliente si no existe (idempotente por número de la empresa y cliente) y la devuelve. */
  ensureConversation(phoneNumberId: string, waId: string, name: string | null): Promise<WaConversation>;
  conversation(id: number): Promise<WaConversation | null>;
  conversations(f: ConversationListFilter): Promise<{ rows: WaConversation[]; total: number }>;
  /** Mensaje entrante; null si ya estaba (mismo wamid): no se cuenta dos veces. */
  addInbound(conversationId: number, m: InboundInput): Promise<number | null>;
  addOutbound(conversationId: number, m: OutboundInput): Promise<number>;
  message(id: number): Promise<WaMessage | null>;
  messageByWamid(wamid: string): Promise<WaMessage | null>;
  /**
   * Estado de entrega: SOLO avanza (nextStatus, también en SQL de forma atómica): un estado más avanzado que ya llegó
   * por el webhook nunca se pisa (p. ej. «leído» no vuelve a «enviado»). El wamid, si se da, se guarda siempre; los
   * datos del error, solo si el estado cambia. Devuelve si el estado cambió.
   */
  updateMessageStatus(id: number, p: { status: MessageStatus; at: string | null; errorCode?: string | null; errorTitle?: string | null; wamid?: string | null }): Promise<boolean>;
  messages(conversationId: number, limit: number): Promise<WaMessage[]>;
  markRead(conversationId: number): Promise<void>;
  /** Marca o quita «espera a una persona»; al quitarlo (devolver a la IA) reinicia el contador de respuestas automáticas. */
  setNeedsHuman(conversationId: number, value: boolean): Promise<void>;
  /**
   * Reserva atómica de una respuesta automática en la conversación: suma 1 solo si quedan (`< max`) y no espera a una
   * persona. Dos mensajes a la vez de la misma conversación nunca superan el máximo. true si se reservó.
   */
  reserveAutoReply(conversationId: number, max: number): Promise<boolean>;
  /** Devuelve la reserva si la respuesta no llegó a enviarse. */
  releaseAutoReply(conversationId: number): Promise<void>;
  addAiLog(e: { conversationId: number; messageId: number | null; mode: AiLogMode; outcome: AiLogOutcome; reply: string | null; actor: number | null }): Promise<void>;
  aiLog(f: { conversationId?: number; limit: number }): Promise<WaAiLogEntry[]>;
}

// ── Conversión de filas ──────────────────────────────────────────────────────────

type Row = Record<string, any>;
const iso = (v: unknown) => (v == null ? null : v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString());
const str = (v: unknown) => (v == null || v === "" ? null : String(v));
const bool = (v: unknown) => v === true || v === 1 || v === "1";
const num = (v: unknown) => (v == null ? null : Number(v));
const pick = <T extends string>(v: unknown, list: readonly T[], fallback: T): T => (list.includes(v as T) ? (v as T) : fallback);
/** Fechas a la BD como Date (mysql2 las escribe y las lee con la misma zona: ida y vuelta exacta). */
export const toDbTime = (isoString: string) => new Date(isoString);

function toSettings(r: Row | undefined): WhatsappSettings {
  if (!r) return { ...DEFAULT_WHATSAPP_SETTINGS, autoHours: [] };
  return {
    aiMode: pick(r.ai_mode, WHATSAPP_AI_MODES, "off"),
    autoHours: parseHours(r.auto_hours),
    autoDailyLimit: Number(r.auto_daily_limit ?? DEFAULT_WHATSAPP_SETTINGS.autoDailyLimit),
    handoffKeywords: str(r.handoff_keywords),
    extraRules: str(r.extra_rules),
    timezone: String(r.timezone ?? DEFAULT_WHATSAPP_SETTINGS.timezone),
    updatedAt: iso(r.updated_at),
  };
}
function toConversation(r: Row): WaConversation {
  return {
    id: Number(r.id),
    phoneNumberId: String(r.phone_number_id),
    waId: String(r.wa_id),
    customerName: str(r.customer_name),
    status: r.status === "closed" ? "closed" : "open",
    needsHuman: bool(r.needs_human),
    unreadCount: Number(r.unread_count ?? 0),
    lastPreview: str(r.last_preview),
    lastInboundAt: iso(r.last_inbound_at),
    lastMessageAt: iso(r.last_message_at)!,
    aiAutoReplies: Number(r.ai_auto_replies ?? 0),
    createdAt: iso(r.created_at)!,
  };
}
function toMessage(r: Row): WaMessage {
  return {
    id: Number(r.id),
    conversationId: Number(r.conversation_id),
    wamid: str(r.wamid),
    direction: r.direction === "out" ? "out" : "in",
    kind: String(r.kind ?? "text"),
    body: String(r.body ?? ""),
    templateName: str(r.template_name),
    origin: pick(r.origin, ["customer", "agent", "ai_suggested", "ai_auto"] as const, "customer"),
    status: pick(r.status, MESSAGE_STATUSES, "received"),
    errorCode: str(r.error_code),
    errorTitle: str(r.error_title),
    sentBy: num(r.sent_by),
    createdAt: iso(r.created_at)!,
    statusAt: iso(r.status_at),
  };
}
function toLog(r: Row): WaAiLogEntry {
  return {
    id: Number(r.id),
    conversationId: Number(r.conversation_id),
    messageId: num(r.message_id),
    mode: r.mode === "auto" ? "auto" : "suggest",
    outcome: String(r.outcome) as AiLogOutcome,
    reply: str(r.reply),
    actor: num(r.actor),
    createdAt: iso(r.created_at)!,
  };
}
const preview = (s: string) => s.replace(/\s+/g, " ").trim().slice(0, 200);

// ── Memoria (pruebas puras) ──────────────────────────────────────────────────────

export class MemoryWhatsappStore implements WhatsappStore {
  s: WhatsappSettings = { ...DEFAULT_WHATSAPP_SETTINGS, autoHours: [] };
  convs: WaConversation[] = [];
  msgs: WaMessage[] = [];
  logs: WaAiLogEntry[] = [];
  constructor(private readonly clock: () => number = () => Date.now()) {}
  private nowIso = () => new Date(this.clock()).toISOString();

  async settings() {
    return { ...this.s, autoHours: [...this.s.autoHours] };
  }
  async saveSettings(s: WhatsappSettingsInput) {
    this.s = { ...s, autoHours: [...s.autoHours], updatedAt: this.nowIso() };
  }
  async ensureConversation(phoneNumberId: string, waId: string, name: string | null) {
    let c = this.convs.find((x) => x.phoneNumberId === phoneNumberId && x.waId === waId);
    if (!c) {
      c = { id: this.convs.length + 1, phoneNumberId, waId, customerName: name, status: "open", needsHuman: false, unreadCount: 0, lastPreview: null, lastInboundAt: null, lastMessageAt: this.nowIso(), aiAutoReplies: 0, createdAt: this.nowIso() };
      this.convs.push(c);
    } else if (name && c.customerName !== name) c.customerName = name;
    return { ...c };
  }
  async conversation(id: number) {
    const c = this.convs.find((x) => x.id === id);
    return c ? { ...c } : null;
  }
  async conversations(f: ConversationListFilter) {
    let rows = [...this.convs].sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt) || b.id - a.id);
    if (f.needsHuman) rows = rows.filter((c) => c.needsHuman);
    if (f.search) rows = rows.filter((c) => `${c.customerName ?? ""} ${c.waId}`.toLowerCase().includes(f.search!.toLowerCase()));
    return { rows: rows.slice(f.offset, f.offset + f.limit), total: rows.length };
  }
  async addInbound(conversationId: number, m: InboundInput) {
    if (this.msgs.some((x) => x.wamid === m.wamid)) return null;
    const id = this.msgs.length + 1;
    this.msgs.push({ id, conversationId, wamid: m.wamid, direction: "in", kind: m.kind, body: m.body, templateName: null, origin: "customer", status: "received", errorCode: null, errorTitle: null, sentBy: null, createdAt: this.nowIso(), statusAt: null });
    if (m.quiet) return id;
    const c = this.convs.find((x) => x.id === conversationId)!;
    if (!c.lastInboundAt || m.at > c.lastInboundAt) c.lastInboundAt = m.at;
    c.lastMessageAt = this.nowIso();
    c.lastPreview = preview(m.body);
    c.unreadCount++;
    c.status = "open";
    return id;
  }
  async addOutbound(conversationId: number, m: OutboundInput) {
    const id = this.msgs.length + 1;
    this.msgs.push({ id, conversationId, wamid: m.wamid, direction: "out", kind: m.kind, body: m.body, templateName: m.templateName, origin: m.origin, status: m.status, errorCode: m.errorCode ?? null, errorTitle: m.errorTitle ?? null, sentBy: m.sentBy, createdAt: this.nowIso(), statusAt: null });
    const c = this.convs.find((x) => x.id === conversationId)!;
    c.lastMessageAt = this.nowIso();
    c.lastPreview = preview(m.body);
    return id;
  }
  async message(id: number) {
    const m = this.msgs.find((x) => x.id === id);
    return m ? { ...m } : null;
  }
  async messageByWamid(wamid: string) {
    const m = this.msgs.find((x) => x.wamid === wamid);
    return m ? { ...m } : null;
  }
  async updateMessageStatus(id: number, p: { status: MessageStatus; at: string | null; errorCode?: string | null; errorTitle?: string | null; wamid?: string | null }) {
    const m = this.msgs.find((x) => x.id === id)!;
    if (p.wamid !== undefined) m.wamid = p.wamid;
    const next = nextStatus(m.status, p.status);
    if (next === m.status) return false;
    m.status = next;
    m.statusAt = p.at;
    if (p.errorCode !== undefined) m.errorCode = p.errorCode;
    if (p.errorTitle !== undefined) m.errorTitle = p.errorTitle;
    return true;
  }
  async messages(conversationId: number, limit: number) {
    return this.msgs.filter((m) => m.conversationId === conversationId).slice(-limit).map((m) => ({ ...m }));
  }
  async markRead(conversationId: number) {
    const c = this.convs.find((x) => x.id === conversationId);
    if (c) c.unreadCount = 0;
  }
  async setNeedsHuman(conversationId: number, value: boolean) {
    const c = this.convs.find((x) => x.id === conversationId);
    if (c) {
      c.needsHuman = value;
      // Devolver la conversación a la IA reinicia su contador de respuestas automáticas
      if (!value) c.aiAutoReplies = 0;
    }
  }
  async reserveAutoReply(conversationId: number, max: number) {
    const c = this.convs.find((x) => x.id === conversationId);
    if (!c || c.needsHuman || c.aiAutoReplies >= max) return false;
    c.aiAutoReplies++;
    return true;
  }
  async releaseAutoReply(conversationId: number) {
    const c = this.convs.find((x) => x.id === conversationId);
    if (c) c.aiAutoReplies = Math.max(0, c.aiAutoReplies - 1);
  }
  async addAiLog(e: { conversationId: number; messageId: number | null; mode: AiLogMode; outcome: AiLogOutcome; reply: string | null; actor: number | null }) {
    this.logs.push({ id: this.logs.length + 1, ...e, createdAt: this.nowIso() });
  }
  async aiLog(f: { conversationId?: number; limit: number }) {
    return this.logs.filter((l) => f.conversationId == null || l.conversationId === f.conversationId).slice(-f.limit).reverse();
  }
}

// ── BD de la empresa ─────────────────────────────────────────────────────────────

type Db = NonNullable<Awaited<ReturnType<typeof getTenantDatabase>>>;
const rowsOf = (res: unknown): Row[] => (res as [Row[]])[0];
const affected = (res: unknown) => Number((res as [{ affectedRows: number }])[0].affectedRows ?? 0);
const insertId = (res: unknown) => Number((res as [{ insertId: number }])[0].insertId ?? 0);

export function isMissingWhatsappTable(err: unknown): boolean {
  for (let e: any = err, depth = 0; e && depth < 6; e = e.cause, depth++) {
    if (e.code === "ER_NO_SUCH_TABLE" || e.errno === 1146) return /whatsapp_/.test(String(e.sqlMessage ?? e.message ?? ""));
  }
  return false;
}

export class TenantDbWhatsappStore implements WhatsappStore {
  private async exec<T>(fn: (db: Db) => Promise<T>): Promise<T> {
    const db = await getTenantDatabase();
    if (!db) throw new Error("Base de datos no disponible");
    try {
      return await fn(db);
    } catch (e) {
      if (isMissingWhatsappTable(e)) throw new WhatsappNotInstalled();
      throw e;
    }
  }

  settings() {
    return this.exec(async (db) => toSettings(rowsOf(await db.execute(sql`SELECT * FROM whatsapp_settings WHERE id = 1`))[0]));
  }
  saveSettings(s: WhatsappSettingsInput, actor: number | null) {
    return this.exec(async (db) => {
      const hours = JSON.stringify(s.autoHours);
      await db.execute(sql`
        INSERT INTO whatsapp_settings (id, ai_mode, auto_hours, auto_daily_limit, handoff_keywords, extra_rules, timezone, updated_by)
        VALUES (1, ${s.aiMode}, ${hours}, ${s.autoDailyLimit}, ${s.handoffKeywords}, ${s.extraRules}, ${s.timezone}, ${actor})
        ON DUPLICATE KEY UPDATE ai_mode = VALUES(ai_mode), auto_hours = VALUES(auto_hours), auto_daily_limit = VALUES(auto_daily_limit),
          handoff_keywords = VALUES(handoff_keywords), extra_rules = VALUES(extra_rules), timezone = VALUES(timezone), updated_by = VALUES(updated_by)`);
    });
  }
  ensureConversation(phoneNumberId: string, waId: string, name: string | null) {
    return this.exec(async (db) => {
      await db.execute(sql`INSERT IGNORE INTO whatsapp_conversations (phone_number_id, wa_id, customer_name) VALUES (${phoneNumberId}, ${waId}, ${name})`);
      if (name) await db.execute(sql`UPDATE whatsapp_conversations SET customer_name = ${name} WHERE phone_number_id = ${phoneNumberId} AND wa_id = ${waId} AND (customer_name IS NULL OR customer_name <> ${name})`);
      const [r] = rowsOf(await db.execute(sql`SELECT * FROM whatsapp_conversations WHERE phone_number_id = ${phoneNumberId} AND wa_id = ${waId}`));
      return toConversation(r);
    });
  }
  conversation(id: number) {
    return this.exec(async (db) => {
      const [r] = rowsOf(await db.execute(sql`SELECT * FROM whatsapp_conversations WHERE id = ${id}`));
      return r ? toConversation(r) : null;
    });
  }
  conversations(f: ConversationListFilter) {
    return this.exec(async (db) => {
      const where: SQL[] = [sql`1 = 1`];
      if (f.needsHuman) where.push(sql`needs_human = 1`);
      if (f.search) {
        const s = `%${f.search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
        where.push(sql`(customer_name LIKE ${s} OR wa_id LIKE ${s} OR last_preview LIKE ${s})`);
      }
      const w = sql.join(where, sql` AND `);
      const rows = rowsOf(await db.execute(sql`SELECT * FROM whatsapp_conversations WHERE ${w} ORDER BY last_message_at DESC, id DESC LIMIT ${f.limit} OFFSET ${f.offset}`)).map(toConversation);
      const total = Number(rowsOf(await db.execute(sql`SELECT COUNT(*) AS n FROM whatsapp_conversations WHERE ${w}`))[0]?.n ?? 0);
      return { rows, total };
    });
  }
  addInbound(conversationId: number, m: InboundInput) {
    return this.exec(async (db) => {
      const at = toDbTime(m.at);
      const res = await db.execute(sql`
        INSERT IGNORE INTO whatsapp_messages (conversation_id, wamid, direction, kind, body, origin, status, wa_timestamp)
        VALUES (${conversationId}, ${m.wamid}, 'in', ${m.kind}, ${m.body.slice(0, 4096)}, 'customer', 'received', ${at})`);
      if (affected(res) !== 1) return null;
      if (m.quiet) return insertId(res);
      await db.execute(sql`
        UPDATE whatsapp_conversations
           SET last_inbound_at = IF(last_inbound_at IS NULL OR last_inbound_at < ${at}, ${at}, last_inbound_at),
               last_message_at = CURRENT_TIMESTAMP(3), last_preview = ${preview(m.body)}, unread_count = unread_count + 1, status = 'open'
         WHERE id = ${conversationId}`);
      return insertId(res);
    });
  }
  addOutbound(conversationId: number, m: OutboundInput) {
    return this.exec(async (db) => {
      const res = await db.execute(sql`
        INSERT INTO whatsapp_messages (conversation_id, wamid, direction, kind, body, template_name, origin, status, error_code, error_title, sent_by)
        VALUES (${conversationId}, ${m.wamid}, 'out', ${m.kind}, ${m.body.slice(0, 4096)}, ${m.templateName}, ${m.origin}, ${m.status}, ${m.errorCode ?? null}, ${m.errorTitle ?? null}, ${m.sentBy})`);
      await db.execute(sql`UPDATE whatsapp_conversations SET last_message_at = CURRENT_TIMESTAMP(3), last_preview = ${preview(m.body)} WHERE id = ${conversationId}`);
      return insertId(res);
    });
  }
  message(id: number) {
    return this.exec(async (db) => {
      const [r] = rowsOf(await db.execute(sql`SELECT * FROM whatsapp_messages WHERE id = ${id}`));
      return r ? toMessage(r) : null;
    });
  }
  messageByWamid(wamid: string) {
    return this.exec(async (db) => {
      const [r] = rowsOf(await db.execute(sql`SELECT * FROM whatsapp_messages WHERE wamid = ${wamid}`));
      return r ? toMessage(r) : null;
    });
  }
  updateMessageStatus(id: number, p: { status: MessageStatus; at: string | null; errorCode?: string | null; errorTitle?: string | null; wamid?: string | null }) {
    return this.exec(async (db) => {
      // nextStatus en SQL: solo avanza, y nunca desde «leído» ni «no entregado». MySQL asigna de izquierda a derecha con
      // los valores ya cambiados, así que `status` va la última y las demás columnas miran el estado anterior
      const rank = (v: SQL) => sql`FIELD(${v}, 'received', 'pending', 'sent', 'delivered', 'read', 'failed')`;
      const adv = sql`(status NOT IN ('read', 'failed') AND ${rank(sql`status`)} < ${rank(sql`${p.status}`)})`;
      const sets: SQL[] = [];
      if (p.wamid !== undefined) sets.push(sql`wamid = ${p.wamid}`);
      sets.push(sql`status_at = IF(${adv}, ${p.at ? toDbTime(p.at) : null}, status_at)`);
      if (p.errorCode !== undefined) sets.push(sql`error_code = IF(${adv}, ${p.errorCode}, error_code)`);
      if (p.errorTitle !== undefined) sets.push(sql`error_title = IF(${adv}, ${p.errorTitle}, error_title)`);
      sets.push(sql`status = IF(${adv}, ${p.status}, status)`);
      const before = rowsOf(await db.execute(sql`SELECT status FROM whatsapp_messages WHERE id = ${id}`))[0]?.status;
      await db.execute(sql`UPDATE whatsapp_messages SET ${sql.join(sets, sql`, `)} WHERE id = ${id}`);
      const after = rowsOf(await db.execute(sql`SELECT status FROM whatsapp_messages WHERE id = ${id}`))[0]?.status;
      return before !== after;
    });
  }
  messages(conversationId: number, limit: number) {
    return this.exec(async (db) =>
      rowsOf(await db.execute(sql`SELECT * FROM (SELECT * FROM whatsapp_messages WHERE conversation_id = ${conversationId} ORDER BY id DESC LIMIT ${limit}) m ORDER BY id`)).map(toMessage),
    );
  }
  markRead(conversationId: number) {
    return this.exec(async (db) => void (await db.execute(sql`UPDATE whatsapp_conversations SET unread_count = 0 WHERE id = ${conversationId}`)));
  }
  setNeedsHuman(conversationId: number, value: boolean) {
    // Devolver la conversación a la IA (false) reinicia su contador de respuestas automáticas
    return this.exec(async (db) => void (await db.execute(value ? sql`UPDATE whatsapp_conversations SET needs_human = 1 WHERE id = ${conversationId}` : sql`UPDATE whatsapp_conversations SET needs_human = 0, ai_auto_replies = 0 WHERE id = ${conversationId}`)));
  }
  reserveAutoReply(conversationId: number, max: number) {
    // El bloqueo de fila de InnoDB serializa las peticiones simultáneas: nunca se supera el máximo por conversación
    return this.exec(async (db) => affected(await db.execute(sql`UPDATE whatsapp_conversations SET ai_auto_replies = ai_auto_replies + 1 WHERE id = ${conversationId} AND ai_auto_replies < ${max} AND needs_human = 0`)) === 1);
  }
  releaseAutoReply(conversationId: number) {
    return this.exec(async (db) => void (await db.execute(sql`UPDATE whatsapp_conversations SET ai_auto_replies = ai_auto_replies - 1 WHERE id = ${conversationId} AND ai_auto_replies > 0`)));
  }
  addAiLog(e: { conversationId: number; messageId: number | null; mode: AiLogMode; outcome: AiLogOutcome; reply: string | null; actor: number | null }) {
    return this.exec(async (db) => {
      await db.execute(sql`INSERT INTO whatsapp_ai_log (conversation_id, message_id, mode, outcome, reply, actor) VALUES (${e.conversationId}, ${e.messageId}, ${e.mode}, ${e.outcome}, ${e.reply ? e.reply.slice(0, 4096) : null}, ${e.actor})`);
    });
  }
  aiLog(f: { conversationId?: number; limit: number }) {
    return this.exec(async (db) =>
      rowsOf(
        await db.execute(
          f.conversationId != null
            ? sql`SELECT * FROM whatsapp_ai_log WHERE conversation_id = ${f.conversationId} ORDER BY id DESC LIMIT ${f.limit}`
            : sql`SELECT * FROM whatsapp_ai_log ORDER BY id DESC LIMIT ${f.limit}`,
        ),
      ).map(toLog),
    );
  }
}
