/**
 * Historial de Elephant Copilot en la BD de la empresa en curso (migración `db/migrations/0058_connect_copilot.sql`).
 * Tablas fuera de drizzle/schema.ts y SQL parametrizado. Cada conversación es de UN usuario: todas las lecturas y
 * escrituras filtran por su id, también por el de la conversación. Nada se borra: las conversaciones se archivan.
 * Sin las tablas → `CopilotNotInstalled`.
 */
import { sql } from "drizzle-orm";
import { getTenantDatabase } from "../_core/dbRegistry";
import type { CopilotToolName } from "../../shared/copilot";

export class CopilotNotInstalled extends Error {
  constructor() {
    super("Copilot aún no está preparado en tu empresa: falta aplicar la actualización 0058_connect_copilot de su base de datos. Inténtalo de nuevo en unos minutos.");
    this.name = "CopilotNotInstalled";
  }
}

export type ConversationKind = "chat" | "draft";
export type MessageRole = "user" | "assistant";

/** Herramienta consultada para una respuesta (se muestra en el panel como «Consultado: …»). */
export interface ToolTrace {
  name: CopilotToolName;
  args: Record<string, unknown>;
  ok: boolean;
  error?: string;
}

export interface Conversation {
  id: number;
  kind: ConversationKind;
  title: string;
  messageCount: number;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface StoredMessage {
  id: number;
  role: MessageRole;
  content: string;
  tools: ToolTrace[];
  createdAt: string;
}

export interface NewMessage {
  role: MessageRole;
  content: string;
  tools?: ToolTrace[];
  tokensIn?: number;
  tokensOut?: number;
}

export interface CopilotStore {
  createConversation(userId: number, kind: ConversationKind, title: string): Promise<number>;
  /** La conversación si es de ese usuario; si no (o no existe), null. */
  conversation(userId: number, id: number): Promise<Conversation | null>;
  conversations(userId: number, opts: { archived: boolean; limit: number }): Promise<Conversation[]>;
  messages(userId: number, conversationId: number, limit: number): Promise<StoredMessage[]>;
  /** Añade los mensajes a una conversación del usuario (false si no es suya). */
  addMessages(userId: number, conversationId: number, msgs: NewMessage[]): Promise<boolean>;
  setArchived(userId: number, id: number, archived: boolean): Promise<boolean>;
  /** Preguntas y borradores del usuario en los últimos `seconds` segundos (protección contra ráfagas). */
  userRequestsSince(userId: number, seconds: number): Promise<number>;
}

type Row = Record<string, any>;
const iso = (v: unknown) => (v == null ? new Date(0).toISOString() : v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString());
const bool = (v: unknown) => v === true || v === 1 || v === "1";

function parseTools(v: unknown): ToolTrace[] {
  if (typeof v !== "string" || !v) return [];
  try {
    const p = JSON.parse(v);
    return Array.isArray(p) ? (p as ToolTrace[]) : [];
  } catch {
    return [];
  }
}

const toConversation = (r: Row): Conversation => ({
  id: Number(r.id),
  kind: r.kind === "draft" ? "draft" : "chat",
  title: String(r.title ?? ""),
  messageCount: Number(r.message_count ?? 0),
  archived: bool(r.is_archived),
  createdAt: iso(r.created_at),
  updatedAt: iso(r.updated_at),
});

function isMissingSchema(e: unknown): boolean {
  for (let x: any = e, i = 0; x && i < 6; x = x.cause, i++) {
    if ((x.code === "ER_NO_SUCH_TABLE" || x.errno === 1146) && /copilot_/.test(String(x.sqlMessage ?? x.message ?? ""))) return true;
  }
  return false;
}

export class TenantDbCopilotStore implements CopilotStore {
  private async run<T>(fn: (d: NonNullable<Awaited<ReturnType<typeof getTenantDatabase>>>) => Promise<T>): Promise<T> {
    const d = await getTenantDatabase();
    if (!d) throw new Error("Base de datos no disponible");
    try {
      return await fn(d);
    } catch (e) {
      if (isMissingSchema(e)) throw new CopilotNotInstalled();
      throw e;
    }
  }

  private rows(res: unknown): Row[] {
    return (res as [Row[]])[0] ?? [];
  }

  createConversation(userId: number, kind: ConversationKind, title: string) {
    return this.run(async (d) => {
      const res = await d.execute(sql`INSERT INTO copilot_conversations (user_id, kind, title) VALUES (${userId}, ${kind}, ${title.slice(0, 120)})`);
      return Number((res as any)[0]?.insertId);
    });
  }

  conversation(userId: number, id: number) {
    return this.run(async (d) => {
      const r = this.rows(await d.execute(sql`SELECT * FROM copilot_conversations WHERE id = ${id} AND user_id = ${userId} LIMIT 1`))[0];
      return r ? toConversation(r) : null;
    });
  }

  conversations(userId: number, opts: { archived: boolean; limit: number }) {
    return this.run(async (d) =>
      this.rows(await d.execute(sql`SELECT * FROM copilot_conversations WHERE user_id = ${userId} AND is_archived = ${opts.archived ? 1 : 0} ORDER BY updated_at DESC, id DESC LIMIT ${opts.limit}`)).map(toConversation),
    );
  }

  messages(userId: number, conversationId: number, limit: number) {
    return this.run(async (d) => {
      const rows = this.rows(await d.execute(sql`
        SELECT m.id, m.role, m.content, m.tools_json, m.created_at
          FROM copilot_messages m
          JOIN copilot_conversations c ON c.id = m.conversation_id
         WHERE m.conversation_id = ${conversationId} AND c.user_id = ${userId}
         ORDER BY m.id DESC
         LIMIT ${limit}`));
      return rows.reverse().map((r) => ({ id: Number(r.id), role: (r.role === "assistant" ? "assistant" : "user") as MessageRole, content: String(r.content ?? ""), tools: parseTools(r.tools_json), createdAt: iso(r.created_at) }));
    });
  }

  addMessages(userId: number, conversationId: number, msgs: NewMessage[]) {
    return this.run(async (d) => {
      const owner = this.rows(await d.execute(sql`SELECT id FROM copilot_conversations WHERE id = ${conversationId} AND user_id = ${userId} LIMIT 1`))[0];
      if (!owner) return false;
      for (const m of msgs) {
        await d.execute(sql`
          INSERT INTO copilot_messages (conversation_id, user_id, role, content, tools_json, tokens_in, tokens_out)
          VALUES (${conversationId}, ${userId}, ${m.role}, ${m.content.slice(0, 60000)}, ${m.tools?.length ? JSON.stringify(m.tools) : null}, ${Math.max(0, Math.round(m.tokensIn ?? 0))}, ${Math.max(0, Math.round(m.tokensOut ?? 0))})`);
      }
      await d.execute(sql`UPDATE copilot_conversations SET message_count = message_count + ${msgs.length}, updated_at = CURRENT_TIMESTAMP(3) WHERE id = ${conversationId} AND user_id = ${userId}`);
      return true;
    });
  }

  setArchived(userId: number, id: number, archived: boolean) {
    return this.run(async (d) => {
      const res = await d.execute(sql`UPDATE copilot_conversations SET is_archived = ${archived ? 1 : 0} WHERE id = ${id} AND user_id = ${userId}`);
      return Number((res as any)[0]?.affectedRows ?? 0) > 0;
    });
  }

  userRequestsSince(userId: number, seconds: number) {
    return this.run(async (d) => {
      const r = this.rows(await d.execute(sql`SELECT COUNT(*) AS n FROM copilot_messages WHERE user_id = ${userId} AND role = 'user' AND created_at >= (CURRENT_TIMESTAMP(3) - INTERVAL ${seconds} SECOND)`))[0];
      return Number(r?.n ?? 0);
    });
  }
}

// ── En memoria (pruebas) ─────────────────────────────────────────────────────────

export class MemoryCopilotStore implements CopilotStore {
  convs: Array<Conversation & { userId: number }> = [];
  msgs: Array<StoredMessage & { conversationId: number; userId: number; at: number; tokensIn: number; tokensOut: number }> = [];
  clock: () => number = () => Date.now();
  private seq = 0;

  async createConversation(userId: number, kind: ConversationKind, title: string) {
    const now = new Date(this.clock()).toISOString();
    const id = ++this.seq;
    this.convs.push({ id, userId, kind, title, messageCount: 0, archived: false, createdAt: now, updatedAt: now });
    return id;
  }
  async conversation(userId: number, id: number) {
    const c = this.convs.find((x) => x.id === id && x.userId === userId);
    if (!c) return null;
    const { userId: _u, ...rest } = c;
    return { ...rest };
  }
  async conversations(userId: number, opts: { archived: boolean; limit: number }) {
    return this.convs
      .filter((c) => c.userId === userId && c.archived === opts.archived)
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : b.id - a.id))
      .slice(0, opts.limit)
      .map(({ userId: _u, ...rest }) => rest);
  }
  async messages(userId: number, conversationId: number, limit: number) {
    if (!this.convs.some((c) => c.id === conversationId && c.userId === userId)) return [];
    return this.msgs
      .filter((m) => m.conversationId === conversationId)
      .slice(-limit)
      .map(({ id, role, content, tools, createdAt }) => ({ id, role, content, tools, createdAt }));
  }
  async addMessages(userId: number, conversationId: number, msgs: NewMessage[]) {
    const c = this.convs.find((x) => x.id === conversationId && x.userId === userId);
    if (!c) return false;
    const at = this.clock();
    for (const m of msgs) this.msgs.push({ id: this.msgs.length + 1, conversationId, userId, role: m.role, content: m.content, tools: m.tools ?? [], createdAt: new Date(at).toISOString(), at, tokensIn: m.tokensIn ?? 0, tokensOut: m.tokensOut ?? 0 });
    c.messageCount += msgs.length;
    c.updatedAt = new Date(at).toISOString();
    return true;
  }
  async setArchived(userId: number, id: number, archived: boolean) {
    const c = this.convs.find((x) => x.id === id && x.userId === userId);
    if (!c) return false;
    c.archived = archived;
    return true;
  }
  async userRequestsSince(userId: number, seconds: number) {
    const since = this.clock() - seconds * 1000;
    return this.msgs.filter((m) => m.userId === userId && m.role === "user" && m.at >= since).length;
  }
}
