/**
 * Servicio de Elephant Copilot avanzado (sin dependencias de proceso: todo se inyecta, ver runtime.ts).
 *
 *  - Preguntas: una llamada a la IA con las herramientas que ESE usuario puede usar; si pide herramientas, el Core las
 *    valida (nombre de la lista, permiso, parámetros) y las ejecuta en solo lectura, y una segunda llamada (sin
 *    herramientas) redacta la respuesta con esos datos. Como máximo dos llamadas a la IA por pregunta.
 *  - Consultas rápidas: la misma herramienta ejecutada sin IA (funciona aunque la IA no esté disponible).
 *  - Borradores: respuesta a un cliente, descripción de producto y resumen de un cliente, con los datos del Core.
 *  - Historial por usuario: nadie ve ni continúa la conversación de otro.
 * El consumo de IA lo mide y limita por empresa el ERM dentro de `invokeLLM`; su error de cuota se deja pasar tal cual
 * para que tRPC lo devuelva como 429.
 */
import {
  COPILOT_DRAFT_LABELS,
  COPILOT_LIMITS,
  COPILOT_TOOL_BY_NAME,
  CopilotInputError,
  allowedTools,
  buildChatSystemPrompt,
  buildDraftMessages,
  draftAllowed,
  isToolName,
  madridDay,
  titleFrom,
  toolResultText,
  type CopilotAccess,
  type CopilotDraftKind,
  type CopilotTone,
  type CopilotToolMeta,
  type CopilotToolName,
} from "../../shared/copilot";
import type { CopilotData } from "./data";
import type { Conversation, CopilotStore, StoredMessage, ToolTrace } from "./store";
import { runTool } from "./tools";

export type CopilotErrorCode = "invalid_input" | "not_found" | "forbidden" | "unavailable" | "busy";
export class CopilotError extends Error {
  constructor(public code: CopilotErrorCode, message: string) {
    super(message);
    this.name = "CopilotError";
  }
}

export const AI_UNAVAILABLE_MESSAGE = "Copilot no está disponible: tu empresa no tiene la inteligencia artificial configurada en este momento. Las consultas rápidas siguen funcionando.";
const AI_FAILED_MESSAGE = "La IA no ha podido responder ahora mismo. Inténtalo de nuevo en unos minutos.";
const BUSY_MESSAGE = "Has hecho muchas consultas seguidas a Copilot. Espera unos minutos antes de continuar.";

export interface LlmMessage {
  role: "system" | "user" | "assistant";
  content: string;
}
export interface LlmTool {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}
export interface LlmReply {
  content: string;
  toolCalls: Array<{ name: string; arguments: string }>;
  tokensIn: number;
  tokensOut: number;
}
export type LlmFn = (p: { messages: LlmMessage[]; tools?: LlmTool[]; maxTokens: number }) => Promise<LlmReply>;

export interface CopilotActor {
  userId: number;
  name: string | null;
  access: CopilotAccess;
}

export interface CopilotDeps {
  store: CopilotStore;
  data: CopilotData;
  llm: LlmFn;
  companyName: () => string;
  now?: () => number;
  /** Empresa en curso: separa las peticiones en curso de usuarios con el mismo id en empresas distintas. */
  scope?: () => string;
}

/** Peticiones a la IA en curso por empresa y usuario (en este proceso), para la protección contra ráfagas. */
const IN_FLIGHT = new Map<string, number>();

export interface DraftInput {
  kind: CopilotDraftKind;
  tone: CopilotTone;
  text?: string | null;
  notes?: string | null;
  clienteId?: number | null;
  productoId?: number | null;
}

export const toLlmTool = (t: CopilotToolMeta): LlmTool => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } });

function parseArgs(raw: string): unknown {
  if (!raw || !raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new CopilotInputError("Los parámetros de la herramienta no son JSON válido.");
  }
}

export class CopilotService {
  constructor(private d: CopilotDeps) {}

  private now() {
    return this.d.now ? this.d.now() : Date.now();
  }

  /** Llamada a la IA con la traducción de errores: sin IA → «no disponible»; cuota del ERM → tal cual (429). */
  private async callLlm(p: Parameters<LlmFn>[0]): Promise<LlmReply> {
    try {
      return await this.d.llm(p);
    } catch (e) {
      const name = e instanceof Error ? e.name : "";
      if (name === "AiUnavailableError") throw new CopilotError("unavailable", AI_UNAVAILABLE_MESSAGE);
      // Cuota del ERM (también la de la prueba gratuita) o bloqueo ya traducido a tRPC: tal cual
      if (name === "QuotaExceededError" || name === "TRPCError") throw e;
      throw new CopilotError("unavailable", AI_FAILED_MESSAGE);
    }
  }

  /**
   * Protección contra ráfagas: la petición se apunta como «en curso» ANTES de llamar a la IA, de forma síncrona (sin
   * ningún await por medio), y cuenta junto a las ya guardadas en la ventana. Así las peticiones en paralelo se ven
   * entre sí y no pueden pasar todas a la vez el límite. Al terminar (bien o mal) deja de contar como en curso; si
   * salió bien, ya cuenta su mensaje guardado.
   */
  private async withBurstSlot<T>(userId: number, fn: () => Promise<T>): Promise<T> {
    const key = `${this.d.scope ? this.d.scope() : ""}:${userId}`;
    const position = (IN_FLIGHT.get(key) ?? 0) + 1;
    IN_FLIGHT.set(key, position);
    try {
      const saved = await this.d.store.userRequestsSince(userId, COPILOT_LIMITS.burstWindowSeconds);
      if (saved + position > COPILOT_LIMITS.burstMax) throw new CopilotError("busy", BUSY_MESSAGE);
      return await fn();
    } finally {
      const left = (IN_FLIGHT.get(key) ?? 1) - 1;
      if (left > 0) IN_FLIGHT.set(key, left);
      else IN_FLIGHT.delete(key);
    }
  }

  private allowed(actor: CopilotActor, name: CopilotToolName): boolean {
    return allowedTools(actor.access).some((t) => t.name === name);
  }

  /** Ejecuta una herramienta pedida por la IA o por el panel, solo si el usuario puede usarla. */
  private async execTool(actor: CopilotActor, name: string, args: unknown): Promise<{ trace: ToolTrace; result: unknown }> {
    const safeArgs = args && typeof args === "object" && !Array.isArray(args) ? (args as Record<string, unknown>) : {};
    if (!isToolName(name) || !this.allowed(actor, name)) {
      return { trace: { name: name as CopilotToolName, args: safeArgs, ok: false, error: "Herramienta no disponible para este usuario." }, result: { error: "Esta herramienta no existe o el usuario no tiene permiso para esos datos." } };
    }
    try {
      const result = await runTool(name, safeArgs, this.d.data, this.now());
      return { trace: { name, args: safeArgs, ok: true }, result };
    } catch (e) {
      if (e instanceof CopilotInputError) return { trace: { name, args: safeArgs, ok: false, error: e.message }, result: { error: e.message } };
      return { trace: { name, args: safeArgs, ok: false, error: "No se han podido leer los datos." }, result: { error: "No se han podido leer los datos ahora mismo." } };
    }
  }

  /** Lo que el panel puede ofrecer a este usuario. */
  capabilities(actor: CopilotActor) {
    return {
      tools: allowedTools(actor.access).map((t) => ({ name: t.name, label: t.label, quick: t.quick ?? null })),
      drafts: (Object.keys(COPILOT_DRAFT_LABELS) as CopilotDraftKind[]).filter((k) => draftAllowed(k, actor.access)),
    };
  }

  /** Consulta rápida sin IA. */
  async quick(actor: CopilotActor, name: CopilotToolName, args: Record<string, unknown>) {
    if (!this.allowed(actor, name)) throw new CopilotError("forbidden", "No tienes permiso para consultar esos datos.");
    try {
      return { tool: name, label: COPILOT_TOOL_BY_NAME[name].label, result: await runTool(name, args, this.d.data, this.now()) };
    } catch (e) {
      if (e instanceof CopilotInputError) throw new CopilotError("invalid_input", e.message);
      throw e;
    }
  }

  async ask(actor: CopilotActor, input: { conversationId?: number | null; question: string }): Promise<{ conversationId: number; answer: string; tools: ToolTrace[] }> {
    const question = input.question.trim();
    if (!question) throw new CopilotError("invalid_input", "Escribe una pregunta.");
    if (question.length > COPILOT_LIMITS.questionMax) throw new CopilotError("invalid_input", `La pregunta no puede superar ${COPILOT_LIMITS.questionMax} caracteres.`);
    let conv: Conversation | null = null;
    if (input.conversationId) {
      conv = await this.d.store.conversation(actor.userId, input.conversationId);
      if (!conv || conv.kind !== "chat") throw new CopilotError("not_found", "Esa conversación no existe o no es tuya.");
    }
    return this.withBurstSlot(actor.userId, () => this.answer(actor, conv, question));
  }

  private async answer(actor: CopilotActor, conv: Conversation | null, question: string): Promise<{ conversationId: number; answer: string; tools: ToolTrace[] }> {
    const tools = allowedTools(actor.access);
    const history: StoredMessage[] = conv ? await this.d.store.messages(actor.userId, conv.id, COPILOT_LIMITS.historyMax) : [];
    const messages: LlmMessage[] = [
      { role: "system", content: buildChatSystemPrompt({ companyName: this.d.companyName(), today: madridDay(this.now()), userName: actor.name, tools }) },
      ...history.map((m) => ({ role: m.role, content: m.content }) as LlmMessage),
      { role: "user", content: question },
    ];

    const first = await this.callLlm({ messages, tools: tools.length ? tools.map(toLlmTool) : undefined, maxTokens: COPILOT_LIMITS.maxTokens });
    let answer = first.content.trim();
    let tokensIn = first.tokensIn;
    let tokensOut = first.tokensOut;
    const traces: ToolTrace[] = [];
    if (first.toolCalls.length) {
      const calls = first.toolCalls.slice(0, COPILOT_LIMITS.toolCallsMax);
      const results: string[] = [];
      for (const c of calls) {
        let args: unknown;
        try {
          args = parseArgs(c.arguments);
        } catch (e) {
          traces.push({ name: c.name as CopilotToolName, args: {}, ok: false, error: (e as Error).message });
          results.push(`[${c.name}] error: ${(e as Error).message}`);
          continue;
        }
        const { trace, result } = await this.execTool(actor, c.name, args);
        traces.push(trace);
        results.push(`[${c.name} ${JSON.stringify(trace.args)}] ${toolResultText(result)}`);
      }
      if (first.toolCalls.length > calls.length) results.push(`(Se han omitido ${first.toolCalls.length - calls.length} consultas: máximo ${COPILOT_LIMITS.toolCallsMax} por pregunta.)`);
      const second = await this.callLlm({
        messages: [
          ...messages,
          ...(answer ? [{ role: "assistant" as const, content: answer }] : []),
          { role: "user", content: `Resultados de las herramientas del Core (datos reales de la empresa, solo lectura):\n${results.join("\n")}\n\nCon estos datos, responde ahora a mi pregunta anterior. Si algún resultado es un error, explícalo sin inventar cifras.` },
        ],
        maxTokens: COPILOT_LIMITS.maxTokens,
      });
      answer = second.content.trim();
      tokensIn += second.tokensIn;
      tokensOut += second.tokensOut;
    }
    if (!answer) answer = "No he podido generar una respuesta. Prueba a reformular la pregunta.";

    const conversationId = conv?.id ?? (await this.d.store.createConversation(actor.userId, "chat", titleFrom(question)));
    await this.d.store.addMessages(actor.userId, conversationId, [
      { role: "user", content: question },
      { role: "assistant", content: answer, tools: traces, tokensIn, tokensOut },
    ]);
    return { conversationId, answer, tools: traces };
  }

  async draft(actor: CopilotActor, input: DraftInput): Promise<{ conversationId: number; text: string }> {
    if (!draftAllowed(input.kind, actor.access)) throw new CopilotError("forbidden", "No tienes permiso para este tipo de borrador.");
    const text = input.text?.trim() ?? "";
    const notes = input.notes?.trim() ?? "";
    if (text.length > COPILOT_LIMITS.draftInputMax) throw new CopilotError("invalid_input", `El texto no puede superar ${COPILOT_LIMITS.draftInputMax} caracteres.`);
    if (notes.length > COPILOT_LIMITS.draftNotesMax) throw new CopilotError("invalid_input", `Las indicaciones no pueden superar ${COPILOT_LIMITS.draftNotesMax} caracteres.`);

    let context: unknown = null;
    let subject = "";
    if (input.kind === "respuesta_cliente") {
      if (!text) throw new CopilotError("invalid_input", "Pega el mensaje del cliente al que quieres responder.");
      subject = text;
      if (input.clienteId) context = await this.clientContext(actor, input.clienteId);
    } else if (input.kind === "resumen_cliente") {
      if (!input.clienteId) throw new CopilotError("invalid_input", "Elige el cliente que quieres resumir.");
      context = await this.clientContext(actor, input.clienteId);
      subject = String((context as any)?.cliente?.nombre ?? `cliente ${input.clienteId}`);
    } else {
      if (input.productoId) {
        const p = await this.d.data.product(input.productoId);
        if (!p) throw new CopilotError("not_found", "Ese producto no existe.");
        context = { producto: { nombre: p.title, resumen: p.shortDescription, descripcionActual: p.description?.slice(0, 1500) ?? null, duracion: p.duration, precioDesde: p.basePrice, moneda: p.currency, personasMin: p.minPersons, personasMax: p.maxPersons, incluye: p.includes } };
        subject = p.title;
      } else if (!text) throw new CopilotError("invalid_input", "Elige un producto del catálogo o escribe de qué producto se trata.");
      else subject = text;
    }
    return this.withBurstSlot(actor.userId, async () => {
      const reply = await this.callLlm({ messages: buildDraftMessages({ kind: input.kind, companyName: this.d.companyName(), tone: input.tone, text, notes, context }), maxTokens: COPILOT_LIMITS.maxTokens });
      const out = reply.content.trim();
      if (!out) throw new CopilotError("unavailable", AI_FAILED_MESSAGE);
      const label = COPILOT_DRAFT_LABELS[input.kind];
      const conversationId = await this.d.store.createConversation(actor.userId, "draft", titleFrom(`${label}: ${subject}`));
      const request = [label, text && input.kind !== "resumen_cliente" ? text : subject, notes ? `Indicaciones: ${notes}` : ""].filter(Boolean).join("\n\n");
      await this.d.store.addMessages(actor.userId, conversationId, [
        { role: "user", content: request },
        { role: "assistant", content: out, tokensIn: reply.tokensIn, tokensOut: reply.tokensOut },
      ]);
      return { conversationId, text: out };
    });
  }

  private async clientContext(actor: CopilotActor, clienteId: number) {
    if (!this.allowed(actor, "ficha_cliente")) throw new CopilotError("forbidden", "No tienes permiso para ver los datos de clientes.");
    const r = await runTool("ficha_cliente", { clienteId }, this.d.data, this.now());
    if (!r.encontrado) throw new CopilotError("not_found", "Ese cliente no existe.");
    return r;
  }

  conversations(actor: CopilotActor, archived: boolean) {
    return this.d.store.conversations(actor.userId, { archived, limit: COPILOT_LIMITS.conversationsMax });
  }

  async conversation(actor: CopilotActor, id: number) {
    const conversation = await this.d.store.conversation(actor.userId, id);
    if (!conversation) throw new CopilotError("not_found", "Esa conversación no existe o no es tuya.");
    return { conversation, messages: await this.d.store.messages(actor.userId, id, 200) };
  }

  async archive(actor: CopilotActor, id: number, archived: boolean) {
    if (!(await this.d.store.setArchived(actor.userId, id, archived))) throw new CopilotError("not_found", "Esa conversación no existe o no es tuya.");
    return { ok: true };
  }
}
