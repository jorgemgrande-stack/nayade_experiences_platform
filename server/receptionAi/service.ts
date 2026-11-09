/**
 * Elephant Reception AI — casos de uso, con todas sus dependencias inyectadas (pruebas sin BD, sin Vapi y sin IA).
 *
 *  - Configuración y base de conocimiento de la recepcionista de la empresa.
 *  - Voz: genera la configuración del asistente y la sincroniza con la cuenta de Vapi DE LA EMPRESA (credencial `vapi`
 *    de su bóveda); atiende las herramientas que el asistente llama durante la llamada (disponibilidad orientativa,
 *    crear solicitud, ¿hay alguien del equipo?) y registra el informe final de cada llamada.
 *  - Texto: chat de la web de la empresa con la IA central del Core y el mismo conocimiento, con un máximo de respuestas
 *    al día que elige la empresa (reserva atómica por día natural de su zona horaria, además de la cuota de IA de la
 *    empresa en Resource Manager) y alta de la solicitud en el CRM con un formulario explícito, con un tope diario de
 *    solicitudes por empresa (la IA del chat no tiene herramientas).
 *  - Registro de conversaciones (llamadas y chats) con su resultado; el equipo puede corregirlo.
 */
import crypto from "node:crypto";
import { usableWebhookSecret } from "../_core/webhookSecret";
import { placeholderEmail } from "../../shared/placeholderEmail";
import {
  DEFAULT_TIMEZONE,
  RECEPTION_LIMITS,
  RECEPTION_MANUAL_OUTCOMES,
  VAPI_TOOL_NAMES,
  buildSystemPrompt,
  buildVapiAssistant,
  cleanText,
  defaultGreeting,
  describeAvailability,
  describeHours,
  isDay,
  isHumanHoursNow,
  isValidTimezone,
  knowledgeProblem,
  localClock,
  matchCatalog,
  normalizePhone,
  oneLine,
  outcomeFromCallReport,
  settingsProblem,
  sortHours,
  type CatalogEntry,
  type KnowledgeKind,
  type ReceptionChannel,
  type ReceptionOutcome,
  type ReceptionSettings,
  type SettingsInput,
  type SlotInfo,
} from "../../shared/receptionAi";
import type { Conversation, ConversationFilter, ReceptionStore, StoredMessage } from "./store";

export const VAPI_BASE_URL = "https://api.vapi.ai";

export class ReceptionError extends Error {
  constructor(
    public readonly code: "invalid_input" | "not_found" | "not_configured" | "unavailable",
    message: string,
  ) {
    super(message);
    this.name = "ReceptionError";
  }
}
const invalid = (m: string) => new ReceptionError("invalid_input", m);

export interface LeadInput {
  name: string;
  email: string;
  phone?: string;
  message: string;
  source: "recepcion_ia_voz" | "recepcion_ia_chat";
  preferredDate?: string;
  numberOfPersons?: number;
}

export type LlmMessage = { role: "system" | "user" | "assistant"; content: string };

export interface ReceptionDeps {
  store: ReceptionStore;
  companyName: () => string;
  catalog: () => Promise<CatalogEntry[]>;
  slots: (productId: number, date: string) => Promise<{ slots: SlotInfo[]; bookedBySlot: Map<number | null, number> }>;
  createLead: (l: LeadInput) => Promise<number>;
  /** IA central del Core (consumo medido y limitado por empresa). Lanza si no está disponible o se agotó la cuota. */
  llm: (messages: LlmMessage[]) => Promise<string>;
  vapi: {
    /** Credencial `vapi` de la bóveda de la empresa. */
    credentials: () => Promise<{ apiKey: string | null; webhookSecret: string | null }>;
    fetch: (url: string, init: RequestInit) => Promise<Response>;
    /** Restricciones del periodo de prueba antes de llamar a Vapi. */
    beforeCall?: () => Promise<void>;
  };
  urls: { tools: () => string; webhook: () => string; chat: (key: string) => string };
  chatKeys: { sign: (version: number) => string; verify: (key: string, version: number) => boolean };
  now?: () => Date;
}

export interface VoiceStatus {
  hasApiKey: boolean;
  hasWebhookSecret: boolean;
  ready: boolean;
  assistantId: string | null;
  syncedAt: string | null;
  /** null: aún no se ha sincronizado nunca. */
  inSync: boolean | null;
  toolsUrl: string;
  webhookUrl: string;
  problems: string[];
}

export interface ChatView {
  companyName: string;
  assistantName: string;
  greeting: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  canLeaveData: boolean;
  allowInfo: boolean;
  allowCallback: boolean;
  humansNow: boolean;
  humanHours: string | null;
  phone: string | null;
  leadDone: boolean;
  turnsLeft: number;
}

const FALLBACK_REPLY = "Ahora mismo no puedo responder a eso. Si nos dejas tus datos en el formulario de abajo, el equipo te contestará.";
/** Al llegar al máximo diario de solicitudes desde el chat: sin crear nada en el CRM. */
export const LEADS_FULL_MESSAGE = "Hoy hemos recibido muchas solicitudes por el chat y no podemos registrar más. Por favor, contacta con nosotros por teléfono o correo electrónico y te atenderemos encantados.";
const sha = (s: string) => crypto.createHash("sha256").update(s).digest("hex");
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;

function parseArgs(v: unknown): Record<string, unknown> {
  if (v && typeof v === "object") return v as Record<string, unknown>;
  if (typeof v === "string") {
    try {
      const p = JSON.parse(v);
      return p && typeof p === "object" ? p : {};
    } catch {
      return {};
    }
  }
  return {};
}
const argStr = (a: Record<string, unknown>, k: string, max = 300) => cleanText(a[k], max, false);
const argInt = (a: Record<string, unknown>, k: string) => {
  const n = Number(a[k]);
  return Number.isInteger(n) && n > 0 && n < 10_000 ? n : null;
};

export type ToolResults = { results: Array<{ toolCallId: string; result: string }> };

/** Llamadas a herramientas de una petición `tool-calls` de Vapi (como mucho 5). */
export function toolCallsOf(payload: any): Array<{ id: string; name: string; args: Record<string, unknown> }> {
  const msg = payload?.message ?? payload ?? {};
  const raw: any[] = Array.isArray(msg.toolCallList)
    ? msg.toolCallList
    : Array.isArray(msg.toolWithToolCallList)
      ? msg.toolWithToolCallList.map((t: any) => t?.toolCall).filter(Boolean)
      : [];
  return raw.slice(0, 5).map((tc) => ({ id: String(tc?.id ?? "").slice(0, 120), name: String(tc?.function?.name ?? tc?.name ?? ""), args: parseArgs(tc?.function?.arguments ?? tc?.arguments) }));
}

/** Misma respuesta para cualquier herramienta cuando la recepcionista no está disponible (sin licencia, apagada…). */
export function unavailableToolResults(payload: any): ToolResults {
  return { results: toolCallsOf(payload).map((c) => ({ toolCallId: c.id, result: "Esta función no está disponible ahora. Ofrece al cliente que vuelva a llamar más tarde." })) };
}

export class ReceptionService {
  private readonly now: () => Date;
  constructor(private readonly d: ReceptionDeps) {
    this.now = d.now ?? (() => new Date());
  }

  // ── Configuración y conocimiento ───────────────────────────────────────────────

  async overview() {
    const [settings, knowledge, catalog] = await Promise.all([this.d.store.settings(), this.d.store.knowledge(true), this.safeCatalog()]);
    return {
      settings,
      knowledge,
      catalog: catalog.map((c) => ({ id: c.id, title: c.title, priceFrom: c.priceFrom, currency: c.currency })),
      humansNow: isHumanHoursNow(settings.humanHours, this.now(), settings.timezone),
      chatUrl: this.d.urls.chat(this.d.chatKeys.sign(settings.chatKeyVersion)),
      defaultGreeting: defaultGreeting(settings, this.d.companyName()),
    };
  }

  async saveSettings(input: SettingsInput, actor: number | null): Promise<ReceptionSettings> {
    const s: SettingsInput = {
      enabled: !!input.enabled,
      assistantName: cleanText(input.assistantName, RECEPTION_LIMITS.assistantNameMax + 20, false) ?? "",
      language: input.language,
      tone: input.tone,
      greeting: cleanText(input.greeting, RECEPTION_LIMITS.greetingMax, false),
      businessSummary: cleanText(input.businessSummary, RECEPTION_LIMITS.businessSummaryMax),
      address: cleanText(input.address, RECEPTION_LIMITS.addressMax, false),
      openingHours: cleanText(input.openingHours, RECEPTION_LIMITS.openingHoursMax, false),
      humanHours: sortHours(input.humanHours ?? []),
      timezone: (input.timezone || "Europe/Madrid").trim(),
      includeCatalog: !!input.includeCatalog,
      transferEnabled: !!input.transferEnabled,
      transferNumber: input.transferNumber ? normalizePhone(input.transferNumber) ?? input.transferNumber.trim() : null,
      leadEnabled: !!input.leadEnabled,
      callbackEnabled: !!input.callbackEnabled,
      extraRules: cleanText(input.extraRules, RECEPTION_LIMITS.extraRulesMax),
      chatEnabled: !!input.chatEnabled,
      chatDailyLimit: Number(input.chatDailyLimit),
    };
    const problem = settingsProblem(s);
    if (problem) throw invalid(problem);
    await this.d.store.saveSettings(s, actor);
    return this.d.store.settings();
  }

  async addKnowledge(k: { kind: KnowledgeKind; question: string; answer: string }, actor: number | null): Promise<number> {
    const item = this.cleanKnowledge(k);
    const all = await this.d.store.knowledge(false);
    if (all.length >= RECEPTION_LIMITS.knowledgeMax) throw invalid(`Como mucho ${RECEPTION_LIMITS.knowledgeMax} contenidos activos: archiva alguno antes de añadir otro.`);
    return this.d.store.addKnowledge({ ...item, sortOrder: all.length ? Math.max(...all.map((i) => i.sortOrder)) + 1 : 0 }, actor);
  }

  async updateKnowledge(id: number, k: { kind: KnowledgeKind; question: string; answer: string; sortOrder?: number }): Promise<void> {
    const item = this.cleanKnowledge(k);
    const current = (await this.d.store.knowledge(true)).find((i) => i.id === id);
    if (!current) throw new ReceptionError("not_found", "Ese contenido no existe.");
    await this.d.store.updateKnowledge(id, { ...item, sortOrder: k.sortOrder ?? current.sortOrder });
  }

  async archiveKnowledge(id: number, archived: boolean): Promise<void> {
    if (!archived && (await this.d.store.knowledge(false)).length >= RECEPTION_LIMITS.knowledgeMax) throw invalid(`Como mucho ${RECEPTION_LIMITS.knowledgeMax} contenidos activos.`);
    if (!(await this.d.store.archiveKnowledge(id, archived))) throw new ReceptionError("not_found", "Ese contenido no existe.");
  }

  private cleanKnowledge(k: { kind: KnowledgeKind; question: string; answer: string }) {
    const question = cleanText(k.question, RECEPTION_LIMITS.questionMax + 1, false) ?? "";
    const answer = cleanText(k.answer, RECEPTION_LIMITS.answerMax + 1) ?? "";
    const problem = knowledgeProblem({ kind: k.kind, question, answer });
    if (problem) throw invalid(problem);
    return { kind: k.kind, question, answer };
  }

  private async safeCatalog(): Promise<CatalogEntry[]> {
    try {
      return await this.d.catalog();
    } catch {
      return [];
    }
  }

  private async promptFor(channel: ReceptionChannel, settings?: ReceptionSettings): Promise<string> {
    const s = settings ?? (await this.d.store.settings());
    const [items, catalog] = await Promise.all([this.d.store.knowledge(false), s.includeCatalog ? this.safeCatalog() : Promise.resolve([])]);
    return buildSystemPrompt({ channel, companyName: this.d.companyName(), settings: s, items, catalog, humansNow: isHumanHoursNow(s.humanHours, this.now(), s.timezone) });
  }

  previewPrompt(channel: ReceptionChannel) {
    return this.promptFor(channel);
  }

  /** Prueba del chat desde el panel: misma IA y mismo conocimiento; no guarda nada ni cuenta en el registro. */
  async tryChat(question: string): Promise<{ reply: string; ai: boolean }> {
    const q = cleanText(question, RECEPTION_LIMITS.chatMessageMax, true);
    if (!q) throw invalid("Escribe una pregunta.");
    try {
      const reply = cleanText(await this.d.llm([{ role: "system", content: await this.promptFor("chat") }, { role: "user", content: q }]), 2000);
      return reply ? { reply, ai: true } : { reply: FALLBACK_REPLY, ai: false };
    } catch (e) {
      throw new ReceptionError("unavailable", e instanceof Error && e.name === "AiUnavailableError" ? e.message : "La IA no ha podido responder ahora mismo. Inténtalo de nuevo en unos minutos.");
    }
  }

  // ── Voz: asistente de Vapi ─────────────────────────────────────────────────────

  private async assistantPayload(settings: ReceptionSettings, secret: string) {
    return buildVapiAssistant({ companyName: this.d.companyName(), settings, systemPrompt: await this.promptFor("voice", settings), toolsUrl: this.d.urls.tools(), webhookUrl: this.d.urls.webhook(), secret });
  }

  async voiceStatus(): Promise<VoiceStatus> {
    const [settings, creds] = await Promise.all([this.d.store.settings(), this.d.vapi.credentials()]);
    const secret = usableWebhookSecret(creds.webhookSecret);
    const problems: string[] = [];
    if (!creds.apiKey) problems.push("Falta la clave de acceso de tu cuenta de Vapi (Configuración › Integraciones › Asistente de voz).");
    if (!secret) problems.push("Falta la clave de verificación de llamadas de Vapi (al menos 24 caracteres), en la misma integración.");
    if (!settings.enabled) problems.push("La recepcionista está desactivada: actívala en «Configuración».");
    let inSync: boolean | null = null;
    if (settings.vapiSyncedHash && secret) inSync = sha(JSON.stringify(await this.assistantPayload(settings, secret))) === settings.vapiSyncedHash;
    else if (settings.vapiSyncedHash) inSync = false;
    return {
      hasApiKey: !!creds.apiKey,
      hasWebhookSecret: !!secret,
      ready: !!creds.apiKey && !!secret && settings.enabled,
      assistantId: settings.vapiAssistantId,
      syncedAt: settings.vapiSyncedAt,
      inSync,
      toolsUrl: this.d.urls.tools(),
      webhookUrl: this.d.urls.webhook(),
      problems,
    };
  }

  /** Crea o actualiza el asistente en la cuenta de Vapi de la empresa. */
  async syncVoice(): Promise<{ assistantId: string; created: boolean }> {
    const [settings, creds] = await Promise.all([this.d.store.settings(), this.d.vapi.credentials()]);
    const secret = usableWebhookSecret(creds.webhookSecret);
    if (!creds.apiKey || !secret) throw new ReceptionError("not_configured", "Configura antes la integración de Vapi de tu empresa: clave de acceso y clave de verificación de llamadas (al menos 24 caracteres).");
    if (!settings.enabled) throw new ReceptionError("not_configured", "Activa la recepcionista en «Configuración» antes de sincronizar el asistente de voz.");
    await this.d.vapi.beforeCall?.();
    const payload = await this.assistantPayload(settings, secret);
    const headers = { Authorization: `Bearer ${creds.apiKey}`, "Content-Type": "application/json" };
    const send = (method: "POST" | "PATCH", url: string) => this.d.vapi.fetch(url, { method, headers, body: JSON.stringify(payload), signal: AbortSignal.timeout(15_000) });
    let res: Response;
    try {
      res = settings.vapiAssistantId ? await send("PATCH", `${VAPI_BASE_URL}/assistant/${encodeURIComponent(settings.vapiAssistantId)}`) : await send("POST", `${VAPI_BASE_URL}/assistant`);
      // El asistente se borró en Vapi: se crea otro
      if (settings.vapiAssistantId && res.status === 404) res = await send("POST", `${VAPI_BASE_URL}/assistant`);
    } catch {
      throw new ReceptionError("unavailable", "No se ha podido conectar con Vapi. Inténtalo de nuevo en unos minutos.");
    }
    if (res.status === 401 || res.status === 403) throw new ReceptionError("not_configured", "Vapi ha rechazado la clave de acceso de tu empresa: revísala en la integración de Vapi.");
    if (!res.ok) throw new ReceptionError("unavailable", `Vapi no ha aceptado la configuración del asistente (HTTP ${res.status}).`);
    let body: any = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    const assistantId = typeof body?.id === "string" ? body.id.slice(0, 80) : settings.vapiAssistantId;
    if (!assistantId) throw new ReceptionError("unavailable", "Vapi no ha devuelto el identificador del asistente.");
    await this.d.store.setVapiSync({ assistantId, hash: sha(JSON.stringify(payload)) });
    return { assistantId, created: assistantId !== settings.vapiAssistantId };
  }

  // ── Voz: herramientas y registro de llamadas ───────────────────────────────────

  /** ¿Es esta llamada del asistente de la recepcionista de esta empresa? */
  private belongs(settings: ReceptionSettings, assistantId: unknown): boolean {
    return !!settings.vapiAssistantId && (assistantId == null || assistantId === settings.vapiAssistantId);
  }

  /** Respuesta a una petición `tool-calls` de Vapi: `{ results: [{ toolCallId, result }] }`. */
  async handleToolCalls(payload: any): Promise<ToolResults> {
    const call = (payload?.message ?? payload ?? {}).call ?? payload?.call ?? {};
    const calls = toolCallsOf(payload);
    const settings = await this.d.store.settings();
    if (!settings.enabled || !this.belongs(settings, call.assistantId)) return unavailableToolResults(payload);
    const callId = typeof call.id === "string" && call.id ? call.id.slice(0, 128) : null;
    const conv = callId ? await this.d.store.ensureConversation("voice", callId) : null;
    if (conv && !conv.customerPhone && typeof call.customer?.number === "string") await this.d.store.updateConversation(conv.id, { customerPhone: call.customer.number.slice(0, 32) });

    const results: Array<{ toolCallId: string; result: string }> = [];
    for (const c of calls) {
      let result: string;
      try {
        result = await this.runTool(settings, c.name, c.args, conv);
      } catch {
        result = "No he podido completar la consulta. Ofrece al cliente dejar una solicitud para que el equipo le conteste.";
      }
      if (conv) await this.d.store.addMessage(conv.id, "tool", "tool", `${c.name}: ${result}`);
      results.push({ toolCallId: c.id, result });
    }
    return { results };
  }

  private async runTool(settings: ReceptionSettings, name: string, a: Record<string, unknown>, conv: Conversation | null): Promise<string> {
    if (name === VAPI_TOOL_NAMES.availability) {
      const service = argStr(a, "servicio", 160);
      const date = argStr(a, "fecha", 20);
      if (!date || !isDay(date)) return "Necesito la fecha en formato AAAA-MM-DD. Pregunta al cliente qué día quiere.";
      const catalog = await this.safeCatalog();
      const entry = service ? matchCatalog(catalog, service) : null;
      if (!entry) {
        const names = catalog.slice(0, 8).map((c) => c.title).join(", ");
        return names ? `No encuentro ese servicio en el catálogo. Servicios publicados: ${names}.` : "No hay servicios publicados en el catálogo: ofrece una solicitud para el equipo.";
      }
      const { slots, bookedBySlot } = await this.d.slots(entry.id, date);
      return describeAvailability({ entry, date, people: argInt(a, "personas"), slots, bookedBySlot, today: localClock(this.now(), settings.timezone).date }).text;
    }
    if (name === VAPI_TOOL_NAMES.humans) {
      if (!settings.transferEnabled || !normalizePhone(settings.transferNumber)) return "No se pueden pasar llamadas al equipo. Ofrece dejar una solicitud.";
      if (isHumanHoursNow(settings.humanHours, this.now(), settings.timezone)) return "Sí: el equipo está atendiendo ahora. Puedes pasar la llamada.";
      const h = describeHours(settings.humanHours);
      return `No: ahora no hay nadie del equipo atendiendo${h ? ` (horario: ${h})` : ""}. Ofrece dejar una solicitud para que le llamen.`;
    }
    if (name === VAPI_TOOL_NAMES.request) {
      const tipo = argStr(a, "tipo", 20) ?? "informacion";
      const isCallback = tipo === "llamada";
      if (isCallback ? !settings.callbackEnabled : !settings.leadEnabled) return "Ese tipo de solicitud no está disponible. Indica al cliente el horario del equipo.";
      if (conv?.leadId) return "La solicitud de esta llamada ya está registrada: el equipo contactará con el cliente.";
      const nombre = argStr(a, "nombre", 160);
      const phoneRaw = argStr(a, "telefono", 40);
      const phone = normalizePhone(phoneRaw) ?? (phoneRaw && phoneRaw.replace(/\D/g, "").length >= 6 ? phoneRaw : null);
      if (!nombre || !phone) return "Faltan datos: necesito el nombre y un teléfono de contacto del cliente.";
      const emailRaw = argStr(a, "email", 190);
      const email = emailRaw && EMAIL_RE.test(emailRaw) ? emailRaw.toLowerCase() : null;
      const motivo = argStr(a, "motivo", 600) ?? "Sin detalle";
      const fecha = argStr(a, "fecha_preferida", 20);
      const personas = argInt(a, "personas");
      const label = isCallback ? "Devolver la llamada" : tipo === "reserva" ? "Reserva" : "Información";
      const leadId = await this.d.createLead({
        name: nombre,
        email: email ?? placeholderEmail("recepcion", `${Date.now()}`),
        phone,
        message: `[Recepcionista IA · llamada] ${label}: ${motivo}${fecha ? ` · Fecha: ${fecha}` : ""}${personas ? ` · Personas: ${personas}` : ""}`,
        source: "recepcion_ia_voz",
        preferredDate: fecha && isDay(fecha) ? fecha : undefined,
        numberOfPersons: personas ?? undefined,
      });
      if (conv) {
        await this.d.store.updateConversation(conv.id, {
          leadId,
          customerName: nombre,
          customerPhone: phone.slice(0, 32),
          customerEmail: email,
          ...(conv.outcomeSource === "manual" ? {} : { outcome: (isCallback ? "callback" : "lead_created") as ReceptionOutcome }),
        });
      }
      return `Solicitud registrada. El equipo contactará con ${nombre} en el ${phone}.`;
    }
    return "Herramienta no disponible.";
  }

  /** Informe final de una llamada (`end-of-call-report`) del asistente de la recepcionista. Devuelve si se registró. */
  async recordCallReport(payload: any): Promise<boolean> {
    const msg = payload?.message ?? payload ?? {};
    if (msg.type !== "end-of-call-report") return false;
    const call = msg.call ?? {};
    const settings = await this.d.store.settings();
    if (!this.belongs(settings, call.assistantId ?? msg.assistantId ?? null) || (call.assistantId == null && msg.assistantId == null)) return false;
    const callId = typeof call.id === "string" && call.id ? call.id.slice(0, 128) : null;
    if (!callId) return false;
    const conv = await this.d.store.ensureConversation("voice", callId);
    let duration: number | null = Number.isFinite(Number(msg.durationSeconds)) ? Math.round(Number(msg.durationSeconds)) : null;
    if (duration == null && call.startedAt && call.endedAt) duration = Math.max(0, Math.round((Date.parse(call.endedAt) - Date.parse(call.startedAt)) / 1000));
    const endedReason = typeof msg.endedReason === "string" ? msg.endedReason.slice(0, 80) : typeof call.endedReason === "string" ? call.endedReason.slice(0, 80) : null;
    const summary = cleanText(msg.analysis?.summary ?? msg.summary, 2000);
    const phone = typeof call.customer?.number === "string" ? call.customer.number.slice(0, 32) : null;
    await this.d.store.updateConversation(conv.id, {
      endedReason,
      durationSeconds: duration,
      ...(summary ? { summary } : {}),
      ...(!conv.customerPhone && phone ? { customerPhone: phone } : {}),
      ...(conv.outcomeSource === "manual" ? {} : { outcome: outcomeFromCallReport(conv.outcome, endedReason, duration) }),
    });
    return true;
  }

  // ── Texto: chat de la web ──────────────────────────────────────────────────────

  /** Configuración si el enlace del chat vale y el chat está activo; si no, null. */
  async chatGate(key: string): Promise<ReceptionSettings | null> {
    const s = await this.d.store.settings();
    if (!s.enabled || !s.chatEnabled) return null;
    return this.d.chatKeys.verify(key, s.chatKeyVersion) ? s : null;
  }

  /** Fecha de hoy (AAAA-MM-DD) en la zona horaria de la empresa: clave de los cupos diarios del chat. */
  private today(settings: ReceptionSettings): string {
    return localClock(this.now(), isValidTimezone(settings.timezone) ? settings.timezone : DEFAULT_TIMEZONE).date;
  }

  private chatRef(token: string) {
    return sha(`reception-chat:${token}`);
  }

  async chatView(settings: ReceptionSettings, token: string | null): Promise<ChatView> {
    const conv = token ? await this.d.store.conversationByRef("chat", this.chatRef(token)) : null;
    const msgs = conv ? await this.d.store.messages(conv.id, 60) : [];
    const humansNow = isHumanHoursNow(settings.humanHours, this.now(), settings.timezone);
    const phone = settings.transferEnabled ? normalizePhone(settings.transferNumber) : null;
    const turns = msgs.filter((m) => m.role === "user").length;
    return {
      companyName: this.d.companyName(),
      assistantName: settings.assistantName,
      greeting: settings.greeting?.trim() || defaultGreeting(settings, this.d.companyName(), "chat"),
      messages: msgs.filter((m) => m.role !== "tool").map((m) => ({ role: m.role === "user" ? "user" : "assistant", content: m.content })),
      canLeaveData: settings.leadEnabled || settings.callbackEnabled,
      allowInfo: settings.leadEnabled,
      allowCallback: settings.callbackEnabled,
      humansNow,
      humanHours: describeHours(settings.humanHours),
      phone: humansNow ? phone : null,
      leadDone: !!conv?.leadId,
      turnsLeft: Math.max(0, RECEPTION_LIMITS.chatTurnsMax - turns),
    };
  }

  /** Mensaje del cliente en el chat: respuesta de la IA (o una respuesta fija si no se puede) guardada en el registro. */
  async chatSend(settings: ReceptionSettings, token: string, text: string): Promise<{ origin: "ai" | "fallback" }> {
    const content = cleanText(text, RECEPTION_LIMITS.chatMessageMax);
    if (!content) throw invalid("Escribe tu mensaje.");
    const conv = await this.d.store.ensureConversation("chat", this.chatRef(token));
    const history = await this.d.store.messages(conv.id, 200);
    if (history.filter((m) => m.role === "user").length >= RECEPTION_LIMITS.chatTurnsMax) {
      return { origin: "fallback" }; // sin guardar más: la página ya indica que se ha llegado al máximo
    }
    await this.d.store.addMessage(conv.id, "user", "customer", content);
    if (!conv.summary) await this.d.store.updateConversation(conv.id, { summary: oneLine(content).slice(0, 300) });

    let reply: string | null = null;
    let origin: "ai" | "fallback" = "fallback";
    // Reserva atómica del turno en el cupo diario ANTES de llamar a la IA: dos mensajes a la vez nunca superan el máximo.
    // Si la IA no llega a responder, el turno se devuelve al cupo (como antes, solo cuentan las respuestas de la IA)
    const day = this.today(settings);
    if (await this.d.store.reserveDaily("chat_reply", day, settings.chatDailyLimit)) {
      try {
        const past = history.filter((m): m is StoredMessage & { role: "user" | "assistant" } => m.role !== "tool").slice(-RECEPTION_LIMITS.chatHistoryMax);
        const messages: LlmMessage[] = [{ role: "system", content: await this.promptFor("chat", settings) }, ...past.map((m) => ({ role: m.role, content: m.content })), { role: "user", content }];
        reply = cleanText(await this.d.llm(messages), 2000);
        if (reply) origin = "ai";
      } catch {
        reply = null;
      }
      if (origin !== "ai") await this.d.store.releaseDaily("chat_reply", day).catch(() => undefined);
    }
    await this.d.store.addMessage(conv.id, "assistant", origin, reply ?? FALLBACK_REPLY);
    if (origin === "ai" && conv.outcome === "open" && conv.outcomeSource === "auto") await this.d.store.updateConversation(conv.id, { outcome: "resolved" });
    return { origin };
  }

  /** Formulario «Déjanos tus datos» del chat: solicitud en el CRM (una por conversación). */
  async chatLead(settings: ReceptionSettings, token: string, f: { kind: "info" | "callback"; name: string; phone: string; email: string; note: string; consent: boolean }): Promise<{ leadId: number; already: boolean }> {
    const isCallback = f.kind === "callback";
    if (isCallback ? !settings.callbackEnabled : !settings.leadEnabled) throw invalid("Ese tipo de solicitud no está disponible.");
    const name = cleanText(f.name, 160, false);
    const phoneRaw = cleanText(f.phone, 40, false);
    const phone = normalizePhone(phoneRaw) ?? (phoneRaw && phoneRaw.replace(/\D/g, "").length >= 6 ? phoneRaw : null);
    const emailRaw = cleanText(f.email, 190, false);
    const email = emailRaw ? (EMAIL_RE.test(emailRaw) ? emailRaw.toLowerCase() : undefined) : null;
    if (!name) throw invalid("Escribe tu nombre.");
    if (email === undefined) throw invalid("El correo electrónico no es válido.");
    if (isCallback && !phone) throw invalid("Para que te llamemos necesitamos un teléfono.");
    if (!phone && !email) throw invalid("Déjanos un teléfono o un correo electrónico.");
    if (!f.consent) throw invalid("Para contactarte necesitamos que aceptes el uso de tus datos para responder a tu solicitud.");

    const conv = await this.d.store.ensureConversation("chat", this.chatRef(token));
    if (conv.leadId) return { leadId: conv.leadId, already: true };
    const note = cleanText(f.note, RECEPTION_LIMITS.noteMax);
    const msgs = (await this.d.store.messages(conv.id, 10)).filter((m) => m.role !== "tool");
    const transcript = msgs.map((m) => `${m.role === "user" ? "Cliente" : "IA"}: ${oneLine(m.content).slice(0, 200)}`).join(" | ");
    const message = `[Recepcionista IA · chat web] ${isCallback ? "Pide que le llamen" : "Solicitud de información"}${note ? `: ${note}` : ""}${transcript ? `\nConversación: ${transcript}` : ""}`.slice(0, 2500);
    // Tope diario de solicitudes desde el chat por empresa (reserva atómica justo antes de crearla): al superarlo no se
    // crea nada en el CRM; si la creación falla, la plaza vuelve al cupo
    const day = this.today(settings);
    if (!(await this.d.store.reserveDaily("chat_lead", day, RECEPTION_LIMITS.chatLeadsPerDay))) throw invalid(LEADS_FULL_MESSAGE);
    let leadId: number;
    try {
      leadId = await this.d.createLead({ name, email: email ?? placeholderEmail("recepcion", `${Date.now()}`), phone: phone ?? undefined, message, source: "recepcion_ia_chat" });
    } catch (e) {
      await this.d.store.releaseDaily("chat_lead", day).catch(() => undefined); // no se creó nada: la plaza vuelve al cupo
      throw e;
    }
    await this.d.store.updateConversation(conv.id, {
      leadId,
      customerName: name,
      customerPhone: phone ? phone.slice(0, 32) : null,
      customerEmail: email,
      ...(conv.outcomeSource === "manual" ? {} : { outcome: (isCallback ? "callback" : "lead_created") as ReceptionOutcome }),
    });
    return { leadId, already: false };
  }

  async regenerateChatKey(): Promise<{ chatUrl: string }> {
    const v = await this.d.store.bumpChatKey();
    return { chatUrl: this.d.urls.chat(this.d.chatKeys.sign(v)) };
  }

  // ── Registro ───────────────────────────────────────────────────────────────────

  conversations(f: ConversationFilter) {
    return this.d.store.conversations(f);
  }

  async conversation(id: number) {
    const c = await this.d.store.conversation(id);
    if (!c) throw new ReceptionError("not_found", "Esa conversación no existe.");
    return { conversation: c, messages: await this.d.store.messages(id, 200) };
  }

  async setOutcome(id: number, outcome: ReceptionOutcome): Promise<void> {
    if (!RECEPTION_MANUAL_OUTCOMES.includes(outcome)) throw invalid("Resultado no válido.");
    if (!(await this.d.store.conversation(id))) throw new ReceptionError("not_found", "Esa conversación no existe.");
    await this.d.store.updateConversation(id, { outcome, outcomeSource: "manual" });
  }

  async stats(days: number) {
    const rows = await this.d.store.stats(days);
    const total = rows.reduce((a, r) => a + r.n, 0);
    const by = (k: (r: (typeof rows)[number]) => boolean) => rows.filter(k).reduce((a, r) => a + r.n, 0);
    return {
      total,
      voice: by((r) => r.channel === "voice"),
      chat: by((r) => r.channel === "chat"),
      outcomes: Object.fromEntries((["open", "resolved", "lead_created", "callback", "derived", "unresolved"] as ReceptionOutcome[]).map((o) => [o, by((r) => r.outcome === o)])) as Record<ReceptionOutcome, number>,
      aiRepliesLast24h: await this.d.store.aiRepliesSince(86_400),
    };
  }
}
