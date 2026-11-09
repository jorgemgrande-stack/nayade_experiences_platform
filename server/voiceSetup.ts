/**
 * Elephant Voice («Llamadas IA», capacidad `voice-ai`): puesta en marcha del asistente de Vapi de la empresa en el panel.
 *
 * Reutiliza lo existente, sin caminos paralelos:
 *  - la clave privada de Vapi y la clave de verificación de llamadas se guardan en la bóveda de la empresa (proveedor
 *    `vapi`, cifrado de vault.ts), las mismas que leen el webhook (server/vapiWebhookRouter.ts), «Llamadas IA»
 *    (server/routers/vapiCalls.ts) y la Recepcionista IA (server/receptionAi/*). Nunca se devuelven ni se registran:
 *    solo la máscara de la clave;
 *  - la clave se valida con el probador de la bóveda (listado de un asistente, solo lectura) antes de guardarla;
 *  - la clave de verificación respeta el mínimo del Core (24 caracteres, server/_core/webhookSecret.ts): si la empresa
 *    no tiene una utilizable, se genera aquí una conforme (32 caracteres) y se configura en Vapi; nunca se relaja;
 *  - los avisos llegan al webhook existente del dominio de ESTA empresa (`<dominio>/api/vapi/webhook`), que resuelve la
 *    empresa por el dominio y comprueba su clave: el aislamiento multiempresa es el de siempre;
 *  - «último evento» es la última sincronización correcta del estado de integraciones (`recordSync("vapi")`, que el
 *    webhook anota con cada aviso aceptado) y la última fila de `vapi_calls`.
 *
 * Escrituras en Vapi (solo al pulsar «Conectar con Vapi»): el `server` (dirección + clave) y `serverMessages` del
 * asistente elegido, y el asistente del número elegido. Todo lo demás es lectura. Sin estado nuevo en la base: la
 * elección se guarda como campos no secretos (ocultos) del proveedor `vapi` de la bóveda.
 *
 * Todo pasa por dependencias inyectables para probarlo sin base de datos y con Vapi simulado.
 */
import crypto from "node:crypto";
import { getProvider } from "./_core/credentials/catalog";
import { fieldProblems } from "./_core/credentials/presentation";
import type { ProviderStatus } from "./_core/credentials/vault";
import type { CheckOutcome } from "./_core/credentials/health";
import type { TestResult } from "./_core/credentials/testers";
import { MIN_WEBHOOK_SECRET_LENGTH, usableWebhookSecret } from "./_core/webhookSecret";
import {
  VOICE_SERVER_MESSAGES,
  VOICE_WEBHOOK_PATH,
  voiceSetup,
  type VoiceAssistantOption,
  type VoicePhoneOption,
  type VoiceSetup,
  type VoiceSetupFacts,
} from "../shared/voiceSetup";

export const VAPI_PROVIDER = "vapi";
export const VAPI_API = "https://api.vapi.ai";
/** Campos de la elección guardada (no secretos, ocultos en «Integraciones y pagos»). */
export const SETUP_FIELDS = ["setupAssistantId", "setupAssistantName", "setupPhoneNumberId", "setupPhoneNumber", "setupConnectedAt"] as const;
/** Límite de ritmo de las consultas a Vapi por empresa: como mucho 20 cada 10 minutos. */
export const VAPI_CALL_LIMIT = { max: 20, windowMs: 10 * 60_000 } as const;
export const VAPI_TIMEOUT_MS = 15_000;
/** Recursos que se listan como mucho (asistentes y números). */
export const LIST_LIMIT = 100;

export type VoiceSetupErrorCode = "BAD_REQUEST" | "PRECONDITION_FAILED" | "TOO_MANY_REQUESTS" | "BAD_GATEWAY" | "CONFLICT" | "NOT_FOUND";

export class VoiceSetupError extends Error {
  constructor(
    readonly code: VoiceSetupErrorCode,
    message: string,
  ) {
    super(message);
  }
}

interface HealthLike {
  provider: string;
  lastCheck: { at: string; outcome: CheckOutcome; message: string } | null;
  lastOkSyncAt: string | null;
}

export interface VoiceSetupDeps {
  /** Bóveda por empresa disponible (multiempresa). */
  multi: () => boolean;
  /** Empresa en curso (clave del límite de ritmo). */
  tenantId: () => string;
  /** Dirección pública del webhook de la empresa en curso ("" si no tiene dominio público). */
  webhookUrl: () => string;
  vault: () => {
    status(providerIds?: string[]): Promise<ProviderStatus[]>;
    resolve(provider: string): Promise<Record<string, string>>;
    save(provider: string, values: Record<string, string>, updatedBy: string): Promise<{ saved: string[] }>;
  };
  health: () => Promise<HealthLike[]>;
  recordCheck: (outcome: CheckOutcome, message: string, actor: string) => Promise<void>;
  /** Comprobación de la clave (probador de la bóveda: solo lectura). */
  checkKey: (apiKey: string) => Promise<TestResult>;
  /** `fetch` hacia la API de Vapi (medido en producción; simulado en pruebas). */
  vapiFetch: (url: string, init: RequestInit) => Promise<Response>;
  /** Restricciones del periodo de prueba antes de llamar a Vapi (lanza si no se permite). */
  beforeVapi: () => Promise<void>;
  /** Última llamada registrada de la empresa en curso; con `assistantId`, solo de ese asistente. */
  lastCall: (assistantId: string | null) => Promise<VoiceSetupFacts["lastCall"]>;
  /** Límite de ritmo: true si se admite otra llamada a Vapi con esta clave (y la cuenta). */
  allow: (key: string) => boolean;
  /** Clave de verificación nueva (al menos 24 caracteres). */
  newSecret: () => string;
  now: () => Date;
}

export interface VoiceSetupView extends VoiceSetup {
  multi: boolean;
  /** Máscara de la clave guardada (nunca la clave). */
  keyMasked: string | null;
  /** Dirección a la que Vapi envía los avisos (pública: es el dominio de la empresa). */
  webhookUrl: string | null;
  secret: { set: boolean; usable: boolean; tooShort: boolean };
  assistant: { id: string | null; name: string | null };
  phoneNumber: { id: string | null; number: string | null };
  connectedAt: string | null;
  lastEventAt: string | null;
  lastCall: VoiceSetupFacts["lastCall"];
}

/**
 * Dirección del webhook de la empresa: SOLO su dominio público (`tenantPublicUrl()`), con https. Sin él, "" (y
 * conectar responde PRECONDITION_FAILED): nunca la dirección de la plataforma, que no es de la empresa.
 */
export function voiceWebhookUrl(tenantUrl: string | null | undefined): string {
  const base = (tenantUrl ?? "").trim().replace(/\/+$/, "");
  return /^https:\/\/[^\s/]+$/.test(base) ? `${base}${VOICE_WEBHOOK_PATH}` : "";
}

/** Clave nueva conforme al Core: 24 bytes aleatorios en base64url (32 caracteres). */
export function generateWebhookSecret(): string {
  return crypto.randomBytes(24).toString("base64url");
}

const actorOf = (id: number) => `user:${id}`;
const clip = (v: unknown, max: number): string | null => (typeof v === "string" && v.trim() ? v.replace(/[\r\n\t]+/g, " ").trim().slice(0, max) : null);
const normUrl = (u: string) => u.trim().replace(/\/+$/, "");
const hostOf = (u: string): string | null => {
  try {
    return new URL(u).hostname || null;
  } catch {
    return null;
  }
};

function requireMulti(deps: VoiceSetupDeps): void {
  if (!deps.multi()) throw new VoiceSetupError("PRECONDITION_FAILED", "En esta instalación la cuenta de Vapi la configura el equipo técnico.");
}

function limit(deps: VoiceSetupDeps): void {
  if (!deps.allow(`vapi-setup:${deps.tenantId()}`)) {
    throw new VoiceSetupError("TOO_MANY_REQUESTS", "Has consultado Vapi muchas veces seguidas: espera unos minutos antes de volver a intentarlo.");
  }
}

// ─── Estado ──────────────────────────────────────────────────────────────────────────────────────────────────────────

export async function getVoiceSetup(deps: VoiceSetupDeps): Promise<VoiceSetupView> {
  const multi = deps.multi();
  if (!multi) {
    const facts = emptyFacts(false);
    return { ...voiceSetup(facts), multi, keyMasked: null, webhookUrl: null, secret: { set: false, usable: false, tooShort: false }, assistant: facts.assistant, phoneNumber: facts.phoneNumber, connectedAt: null, lastEventAt: null, lastCall: null };
  }
  const [statuses, values, health] = await Promise.all([
    deps.vault().status([VAPI_PROVIDER]),
    deps.vault().resolve(VAPI_PROVIDER),
    deps.health().catch(() => [] as HealthLike[]),
  ]);
  // La llamada de prueba es del asistente conectado
  const lastCall = await deps.lastCall(values.setupAssistantId || null).catch(() => null);
  const fields = statuses.find((s) => s.id === VAPI_PROVIDER)?.fields ?? [];
  const keyField = fields.find((f) => f.key === "apiKey");
  const h = health.find((x) => x.provider === VAPI_PROVIDER);
  // La comprobación solo cuenta si es posterior a guardar la clave
  const keyAt = keyField?.updatedAt ? Date.parse(keyField.updatedAt) : 0;
  const check = h?.lastCheck && Date.parse(h.lastCheck.at) >= keyAt ? h.lastCheck : null;
  const secretRaw = values.webhookSecret ?? "";
  const usable = !!usableWebhookSecret(secretRaw);
  const facts: VoiceSetupFacts = {
    available: true,
    key: { saved: !!keyField?.set, check: check?.outcome ?? null, checkMessage: check?.message ?? null },
    assistant: { id: values.setupAssistantId || null, name: values.setupAssistantName || null },
    phoneNumber: { id: values.setupPhoneNumberId || null, number: values.setupPhoneNumber || null },
    secretUsable: usable,
    secretTooShort: !!secretRaw && !usable,
    // Instante de la conexión con el MISMO reloj que el último aviso (la base de datos de la empresa): la fecha de la
    // fila de la bóveda; el valor guardado, si no la hay
    connectedAt: values.setupConnectedAt ? (fields.find((f) => f.key === "setupConnectedAt")?.updatedAt ?? values.setupConnectedAt) : null,
    lastEventAt: h?.lastOkSyncAt ?? null,
    lastCall,
  };
  const url = deps.webhookUrl();
  return {
    ...voiceSetup(facts),
    multi,
    keyMasked: keyField?.set ? keyField.display : null,
    webhookUrl: url || null,
    secret: { set: !!secretRaw, usable, tooShort: facts.secretTooShort },
    assistant: facts.assistant,
    phoneNumber: facts.phoneNumber,
    connectedAt: facts.connectedAt,
    lastEventAt: facts.lastEventAt,
    lastCall,
  };
}

function emptyFacts(available: boolean): VoiceSetupFacts {
  return {
    available,
    key: { saved: false, check: null, checkMessage: null },
    assistant: { id: null, name: null },
    phoneNumber: { id: null, number: null },
    secretUsable: false,
    secretTooShort: false,
    connectedAt: null,
    lastEventAt: null,
    lastCall: null,
  };
}

// ─── Clave privada ───────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Valida la clave contra Vapi (listado de un asistente: solo lectura) y, si Vapi la acepta, la guarda en la bóveda de
 * la empresa. Si es de otra cuenta (distinta de la guardada), se olvida la elección de asistente y número.
 */
export async function saveVoiceKey(deps: VoiceSetupDeps, rawKey: string, actor: { id: number }): Promise<{ saved: true; selectionReset: boolean }> {
  requireMulti(deps);
  const apiKey = rawKey.trim();
  const provider = getProvider(VAPI_PROVIDER)!;
  if (!apiKey) throw new VoiceSetupError("BAD_REQUEST", "Pega la clave privada de tu cuenta de Vapi.");
  const problems = fieldProblems(provider, { apiKey });
  if (problems.length) throw new VoiceSetupError("BAD_REQUEST", problems.join(" "));
  limit(deps);
  await deps.beforeVapi();
  const r = await deps.checkKey(apiKey).catch((): TestResult => ({ ok: false, message: "No se pudo contactar con el proveedor", outcome: "error" }));
  if (!r.ok) {
    if (r.outcome === "rejected") throw new VoiceSetupError("BAD_REQUEST", "Vapi ha rechazado esta clave. Usa la «Private Key» de dashboard.vapi.ai (la pública no sirve).");
    throw new VoiceSetupError("BAD_GATEWAY", "No se ha podido comprobar la clave con Vapi. Inténtalo de nuevo en unos minutos.");
  }
  const current = await deps.vault().resolve(VAPI_PROVIDER);
  const selectionReset = !!current.apiKey && current.apiKey !== apiKey && SETUP_FIELDS.some((k) => !!current[k]);
  const values: Record<string, string> = { apiKey };
  if (current.apiKey && current.apiKey !== apiKey) for (const k of SETUP_FIELDS) values[k] = "";
  try {
    await deps.vault().save(VAPI_PROVIDER, values, actorOf(actor.id));
  } catch (e) {
    throw new VoiceSetupError("BAD_REQUEST", e instanceof Error ? e.message : "No se pudo guardar la clave");
  }
  await deps.recordCheck("connected", "Clave de Vapi comprobada en la puesta en marcha de Llamadas IA", actorOf(actor.id)).catch(() => undefined);
  // Auditoría sin valores
  console.warn(JSON.stringify({ ctx: "VoiceSetup", event: "key_saved", selectionReset, user: actor.id }));
  return { saved: true, selectionReset };
}

// ─── API de Vapi ─────────────────────────────────────────────────────────────────────────────────────────────────────

async function vapiCall(deps: VoiceSetupDeps, apiKey: string, method: "GET" | "PATCH", path: string, body?: unknown): Promise<{ status: number; json: any }> {
  let res: Response;
  try {
    res = await deps.vapiFetch(`${VAPI_API}${path}`, {
      method,
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(VAPI_TIMEOUT_MS),
    });
  } catch {
    throw new VoiceSetupError("BAD_GATEWAY", "No se ha podido conectar con Vapi. Inténtalo de nuevo en unos minutos.");
  }
  if (res.status === 401 || res.status === 403) throw new VoiceSetupError("PRECONDITION_FAILED", "Vapi ha rechazado la clave guardada: vuelve a pegar la clave privada de tu cuenta.");
  // Nunca se reenvía el cuerpo de Vapi al panel (puede traer claves del asistente)
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

const listOf = (j: any): any[] => (Array.isArray(j) ? j : Array.isArray(j?.results) ? j.results : Array.isArray(j?.data) ? j.data : []);

/** A dónde envía un asistente sus avisos (sin exponer la dirección de un tercero: solo su dominio). */
export function serverTargetOf(assistant: any, webhookUrl: string): Pick<VoiceAssistantOption, "serverTarget" | "otherHost"> {
  const url = typeof assistant?.server?.url === "string" && assistant.server.url ? assistant.server.url : typeof assistant?.serverUrl === "string" ? assistant.serverUrl : "";
  if (!url) return { serverTarget: "none", otherHost: null };
  if (webhookUrl && normUrl(url) === normUrl(webhookUrl)) return { serverTarget: "core", otherHost: null };
  return { serverTarget: "other", otherHost: hostOf(url) };
}

export function assistantOption(a: any, webhookUrl: string): VoiceAssistantOption | null {
  const id = clip(a?.id, 80);
  if (!id) return null;
  return { id, name: clip(a?.name, 120) ?? "Asistente sin nombre", ...serverTargetOf(a, webhookUrl) };
}

export function phoneOption(p: any): VoicePhoneOption | null {
  const id = clip(p?.id, 80);
  if (!id) return null;
  return { id, number: clip(p?.number, 40) ?? clip(p?.sipUri, 120), name: clip(p?.name, 120), provider: clip(p?.provider, 40), assistantId: clip(p?.assistantId, 80) };
}

async function savedKey(deps: VoiceSetupDeps): Promise<Record<string, string>> {
  const values = await deps.vault().resolve(VAPI_PROVIDER);
  if (!values.apiKey) throw new VoiceSetupError("PRECONDITION_FAILED", "Guarda antes la clave privada de tu cuenta de Vapi.");
  return values;
}

/** Asistentes y números de la cuenta de Vapi de la empresa (solo lectura). */
export async function listVoiceResources(deps: VoiceSetupDeps): Promise<{ assistants: VoiceAssistantOption[]; phoneNumbers: VoicePhoneOption[] }> {
  requireMulti(deps);
  const { apiKey } = await savedKey(deps);
  limit(deps);
  await deps.beforeVapi();
  const [a, p] = await Promise.all([vapiCall(deps, apiKey, "GET", `/assistant?limit=${LIST_LIMIT}`), vapiCall(deps, apiKey, "GET", `/phone-number?limit=${LIST_LIMIT}`)]);
  if (a.status >= 400 || p.status >= 400) throw new VoiceSetupError("BAD_GATEWAY", `Vapi no ha devuelto tus asistentes y números (HTTP ${a.status >= 400 ? a.status : p.status}).`);
  const url = deps.webhookUrl();
  return {
    assistants: listOf(a.json).map((x) => assistantOption(x, url)).filter((x): x is VoiceAssistantOption => !!x),
    phoneNumbers: listOf(p.json).map(phoneOption).filter((x): x is VoicePhoneOption => !!x),
  };
}

// ─── Conectar ────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface ConnectInput {
  assistantId: string;
  phoneNumberId: string;
  /** Confirmación explícita para quitar los avisos de otra dirección o el asistente que ya tenía el número. */
  replaceExisting: boolean;
}

export interface ConnectResult {
  assistantName: string;
  phoneNumber: string | null;
  /** null: se reutiliza la clave de verificación guardada · missing / too_short: se ha generado una nueva conforme. */
  secretGenerated: null | "missing" | "too_short";
  webhookUrl: string;
}

/**
 * Configura en Vapi el asistente elegido (dirección del webhook de ESTA empresa + clave de verificación de al menos 24
 * caracteres, y solo el informe final de cada llamada) y le asigna el número elegido. Si el asistente ya enviaba sus
 * avisos a otra dirección, o el número tenía otro asistente, exige confirmación.
 */
export async function connectVoice(deps: VoiceSetupDeps, input: ConnectInput, actor: { id: number }): Promise<ConnectResult> {
  requireMulti(deps);
  const webhookUrl = deps.webhookUrl();
  if (!/^https:\/\//.test(webhookUrl)) throw new VoiceSetupError("PRECONDITION_FAILED", "Tu empresa aún no tiene una dirección pública con https: no se puede conectar Vapi todavía.");
  const values = await savedKey(deps);
  const idRe = /^[A-Za-z0-9-]{8,80}$/;
  if (!idRe.test(input.assistantId) || !idRe.test(input.phoneNumberId)) throw new VoiceSetupError("BAD_REQUEST", "Elige un asistente y un número de la lista.");
  limit(deps);
  await deps.beforeVapi();
  const key = values.apiKey;
  const [a, p] = await Promise.all([
    vapiCall(deps, key, "GET", `/assistant/${encodeURIComponent(input.assistantId)}`),
    vapiCall(deps, key, "GET", `/phone-number/${encodeURIComponent(input.phoneNumberId)}`),
  ]);
  if (a.status === 404) throw new VoiceSetupError("NOT_FOUND", "Ese asistente ya no existe en tu cuenta de Vapi: vuelve a cargar la lista.");
  if (p.status === 404) throw new VoiceSetupError("NOT_FOUND", "Ese número ya no existe en tu cuenta de Vapi: vuelve a cargar la lista.");
  if (a.status >= 400 || p.status >= 400) throw new VoiceSetupError("BAD_GATEWAY", `Vapi no ha devuelto el asistente o el número (HTTP ${a.status >= 400 ? a.status : p.status}).`);
  const assistant = assistantOption(a.json, webhookUrl);
  const phone = phoneOption(p.json);
  if (!assistant || !phone) throw new VoiceSetupError("BAD_GATEWAY", "Vapi ha devuelto una respuesta inesperada.");
  // Antes de escribir nada en Vapi: lo que devolvió es lo pedido y lo que se guardará pasa la validación de la bóveda
  // (así el guardado final no puede fallar por formato con Vapi ya cambiado)
  if (!idRe.test(assistant.id) || !idRe.test(phone.id) || assistant.id !== input.assistantId || phone.id !== input.phoneNumberId) {
    throw new VoiceSetupError("BAD_GATEWAY", "Vapi ha devuelto un asistente o un número que no corresponde: no se ha cambiado nada.");
  }
  const selection = {
    setupAssistantId: assistant.id,
    setupAssistantName: assistant.name,
    setupPhoneNumberId: phone.id,
    setupPhoneNumber: phone.number ?? phone.name ?? phone.id,
    setupConnectedAt: deps.now().toISOString(),
  };
  if (fieldProblems(getProvider(VAPI_PROVIDER)!, selection).length) {
    throw new VoiceSetupError("BAD_GATEWAY", "Vapi ha devuelto un nombre o un número que no se puede guardar: no se ha cambiado nada.");
  }

  if (!input.replaceExisting) {
    const conflicts: string[] = [];
    if (assistant.serverTarget === "other") conflicts.push(`el asistente «${assistant.name}» envía ahora sus avisos a ${assistant.otherHost ?? "otra dirección"} y dejará de hacerlo`);
    if (phone.assistantId && phone.assistantId !== assistant.id) conflicts.push(`el número ${phone.number ?? phone.id} tiene ahora otro asistente y pasará a atenderlo «${assistant.name}»`);
    if (conflicts.length) throw new VoiceSetupError("CONFLICT", `Confirma el cambio: ${conflicts.join("; ")}.`);
  }

  // Clave de verificación: la guardada si cumple el mínimo del Core; si no, una nueva conforme (antes de tocar Vapi:
  // sin clave utilizable el webhook ya estaba inactivo, así que guardarla primero no corta nada que funcionase)
  let secret = usableWebhookSecret(values.webhookSecret ?? "");
  let secretGenerated: ConnectResult["secretGenerated"] = null;
  if (!secret) {
    secretGenerated = values.webhookSecret ? "too_short" : "missing";
    secret = deps.newSecret();
    if (!usableWebhookSecret(secret) || secret.length < MIN_WEBHOOK_SECRET_LENGTH) throw new Error("Clave de verificación generada no válida");
    await deps.vault().save(VAPI_PROVIDER, { webhookSecret: secret }, actorOf(actor.id));
  }

  const timeout = typeof a.json?.server?.timeoutSeconds === "number" ? { timeoutSeconds: a.json.server.timeoutSeconds } : {};
  const pa = await vapiCall(deps, key, "PATCH", `/assistant/${encodeURIComponent(assistant.id)}`, {
    server: { url: webhookUrl, secret, ...timeout },
    serverMessages: [...VOICE_SERVER_MESSAGES],
  });
  if (pa.status >= 400) throw new VoiceSetupError("BAD_GATEWAY", `Vapi no ha aceptado la configuración del asistente (HTTP ${pa.status}).`);
  if (phone.assistantId !== assistant.id) {
    const pp = await vapiCall(deps, key, "PATCH", `/phone-number/${encodeURIComponent(phone.id)}`, { assistantId: assistant.id });
    if (pp.status >= 400) throw new VoiceSetupError("BAD_GATEWAY", `El asistente ya está conectado, pero Vapi no ha aceptado asignarle el número (HTTP ${pp.status}). Asígnalo en dashboard.vapi.ai › Phone Numbers o inténtalo de nuevo.`);
  }

  try {
    await deps.vault().save(VAPI_PROVIDER, selection, actorOf(actor.id));
  } catch {
    throw new VoiceSetupError("BAD_GATEWAY", "Vapi ya está configurado, pero no se ha podido guardar la elección en tu panel. Pulsa «Conectar con Vapi» de nuevo.");
  }
  await deps.recordCheck("connected", "Llamadas conectadas: asistente y número configurados en Vapi", actorOf(actor.id)).catch(() => undefined);
  console.warn(JSON.stringify({ ctx: "VoiceSetup", event: "connected", secretGenerated, user: actor.id }));
  return { assistantName: assistant.name, phoneNumber: phone.number, secretGenerated, webhookUrl };
}

// ─── Comprobar y desconectar ─────────────────────────────────────────────────────────────────────────────────────────

/** Comprueba en Vapi (solo lectura) que el asistente sigue apuntando a esta empresa y que el número lo tiene asignado. */
export async function verifyVoice(deps: VoiceSetupDeps): Promise<{ ok: boolean; problems: string[] }> {
  requireMulti(deps);
  const values = await savedKey(deps);
  if (!values.setupAssistantId || !values.setupPhoneNumberId) return { ok: false, problems: ["Aún no has conectado ningún asistente."] };
  limit(deps);
  await deps.beforeVapi();
  const url = deps.webhookUrl();
  const [a, p] = await Promise.all([
    vapiCall(deps, values.apiKey, "GET", `/assistant/${encodeURIComponent(values.setupAssistantId)}`),
    vapiCall(deps, values.apiKey, "GET", `/phone-number/${encodeURIComponent(values.setupPhoneNumberId)}`),
  ]);
  const problems: string[] = [];
  if (a.status === 404) problems.push("El asistente conectado ya no existe en Vapi.");
  else if (a.status >= 400) problems.push(`Vapi no ha devuelto el asistente (HTTP ${a.status}).`);
  else {
    const t = serverTargetOf(a.json, url);
    if (t.serverTarget !== "core") problems.push(t.serverTarget === "other" ? `El asistente envía ahora sus avisos a ${t.otherHost ?? "otra dirección"}: vuelve a conectarlo.` : "El asistente ya no tiene la dirección de tu panel: vuelve a conectarlo.");
  }
  if (p.status === 404) problems.push("El número conectado ya no existe en Vapi.");
  else if (p.status >= 400) problems.push(`Vapi no ha devuelto el número (HTTP ${p.status}).`);
  else if (clip(p.json?.assistantId, 80) !== values.setupAssistantId) problems.push("El número tiene ahora otro asistente (o ninguno): vuelve a conectarlo.");
  if (!usableWebhookSecret(values.webhookSecret ?? "")) problems.push(`La clave de verificación de llamadas no tiene al menos ${MIN_WEBHOOK_SECRET_LENGTH} caracteres: vuelve a conectar.`);
  return { ok: problems.length === 0, problems };
}

/**
 * Desconecta: borra de la bóveda la clave de Vapi, la clave de verificación y la elección. Desde ese momento el webhook
 * de la empresa rechaza los avisos (sin clave queda inactivo). El historial de llamadas se conserva. En Vapi no se toca
 * nada (la clave ya no está): el panel indica cómo quitar la dirección del asistente si se quiere.
 */
export async function disconnectVoice(deps: VoiceSetupDeps, actor: { id: number }): Promise<{ disconnected: true }> {
  requireMulti(deps);
  const provider = getProvider(VAPI_PROVIDER)!;
  const values: Record<string, string> = {};
  for (const f of provider.fields) values[f.key] = "";
  await deps.vault().save(VAPI_PROVIDER, values, actorOf(actor.id));
  console.warn(JSON.stringify({ ctx: "VoiceSetup", event: "disconnected", user: actor.id }));
  return { disconnected: true };
}

// ─── Dependencias reales (empresa en curso) ──────────────────────────────────────────────────────────────────────────

/** Límite de ritmo en memoria (ventana deslizante) compartido por el proceso. */
let defaultLimiter: ((key: string) => boolean) | null = null;

export async function defaultVoiceSetupDeps(): Promise<VoiceSetupDeps> {
  const [{ isMultiTenant, getTenantId }, { getVault }, health, { testProvider }, { meteredFetch }, { tenantPublicUrl }, { createRateLimiter }, { getDb }, { sql }] = await Promise.all([
    import("./_core/tenant"),
    import("./_core/credentials/runtime"),
    import("./_core/credentials/health"),
    import("./_core/credentials/testers"),
    import("./_core/externalMetering"),
    import("./_core/tenantIdentity"),
    import("./financeSyncSetup"),
    import("./db"),
    import("drizzle-orm"),
  ]);
  defaultLimiter ??= createRateLimiter(VAPI_CALL_LIMIT.max, VAPI_CALL_LIMIT.windowMs);
  return {
    multi: () => isMultiTenant(),
    tenantId: () => getTenantId(),
    // Solo el dominio público de la empresa en curso: nunca APP_URL de la plataforma (los avisos irían a otra parte)
    webhookUrl: () => voiceWebhookUrl(tenantPublicUrl()),
    vault: () => getVault(),
    health: async () => (await health.integrationHealth()).providers,
    recordCheck: (outcome, message, actor) => health.recordCheck(VAPI_PROVIDER, outcome, message, actor),
    checkKey: (apiKey) => testProvider(VAPI_PROVIDER, { apiKey }, (u, init) => meteredFetch("vapi", u, init as RequestInit, { endpoint: "assistant.list" }) as never),
    vapiFetch: (u, init) => meteredFetch("vapi", u, init, { endpoint: "setup" }),
    beforeVapi: async () => (await import("./trialRestrictions")).assertIntegrationAllowed("vapi"),
    lastCall: async (assistantId) => {
      const db = await getDb();
      if (!db) return null;
      try {
        const [rows] = (await (db as any).execute((assistantId
          ? sql`SELECT createdAt, durationSeconds, status FROM vapi_calls WHERE assistantId = ${assistantId} ORDER BY id DESC LIMIT 1`
          : sql`SELECT createdAt, durationSeconds, status FROM vapi_calls ORDER BY id DESC LIMIT 1`))) as [Array<Record<string, unknown>>];
        const r = rows?.[0];
        if (!r) return null;
        return { at: new Date(String(r.createdAt)).toISOString(), durationSeconds: r.durationSeconds == null ? null : Number(r.durationSeconds), status: r.status ? String(r.status) : null };
      } catch (e) {
        if (/ER_NO_SUCH_TABLE|doesn't exist/i.test(`${(e as { code?: string }).code ?? ""} ${(e as Error).message ?? ""}`)) return null;
        throw e;
      }
    },
    allow: (k) => defaultLimiter!(k),
    newSecret: generateWebhookSecret,
    now: () => new Date(),
  };
}
