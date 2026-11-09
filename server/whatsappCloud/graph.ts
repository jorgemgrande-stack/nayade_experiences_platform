/**
 * Cliente mínimo de la Graph API de Meta para WhatsApp Cloud API con las credenciales PROPIAS de la empresa (credencial
 * `whatsapp_cloud` de su bóveda). `fetch` inyectable: las pruebas simulan Meta y nunca salen a la red.
 *
 *  - El token SIEMPRE en la cabecera Authorization: nunca en la URL, en registros, en mensajes de error ni en respuestas
 *    (los textos de Meta se limpian con `scrub`; mismo criterio que la corrección b0696c65 de Ads Manager).
 *  - Solo https://graph.facebook.com, sin redirecciones y con tiempo máximo por petición.
 *  - Lecturas: datos del número y de la cuenta (verificación) y plantillas de la WABA. Escrituras: enviar un mensaje de
 *    texto o una plantilla aprobada al cliente.
 */
import { GRAPH_BASE, templateParamCount, type WhatsappTemplate } from "../../shared/whatsappCloud";
import { scrub } from "../adsManager/connectors";

export type GraphFetch = (url: string, init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal; redirect?: "error" }) => Promise<{ ok: boolean; status: number; json(): Promise<any> }>;

export interface WhatsappCredentials {
  phoneNumberId: string;
  wabaId: string;
  accessToken: string;
  appSecret: string;
  verifyToken: string;
}

export type GraphErrorKind = "not_configured" | "rejected" | "invalid" | "unavailable";
export class GraphError extends Error {
  constructor(
    readonly kind: GraphErrorKind,
    message: string,
    readonly code: string | null = null,
  ) {
    super(message);
    this.name = "GraphError";
  }
}

const TIMEOUT_MS = 10_000;
export const PHONE_ID_RE = /^\d{5,30}$/;
export const WABA_ID_RE = /^\d{5,30}$/;

/**
 * Lo mínimo para RECIBIR (webhook): el identificador del número y la clave secreta de la app (firma). El token de
 * verificación se comprueba aparte, solo en el alta de la suscripción. La clave de acceso y la WABA solo hacen falta para
 * enviar y leer plantillas.
 */
export function receivingCredentials(v: Record<string, string | undefined>): { phoneNumberId: string; appSecret: string } | null {
  const phoneNumberId = (v.phoneNumberId ?? "").trim();
  const appSecret = (v.appSecret ?? "").trim();
  return PHONE_ID_RE.test(phoneNumberId) && appSecret ? { phoneNumberId, appSecret } : null;
}

/** Credenciales para ENVIAR (número, WABA y clave de acceso) o null: sin ellas no se escribe ni se leen plantillas. */
export function usableCredentials(v: Record<string, string | undefined>): WhatsappCredentials | null {
  const c = { phoneNumberId: (v.phoneNumberId ?? "").trim(), wabaId: (v.wabaId ?? "").trim(), accessToken: (v.accessToken ?? "").trim(), appSecret: (v.appSecret ?? "").trim(), verifyToken: (v.verifyToken ?? "").trim() };
  if (!PHONE_ID_RE.test(c.phoneNumberId) || !WABA_ID_RE.test(c.wabaId) || !c.accessToken) return null;
  return c;
}

async function call(fetchImpl: GraphFetch, token: string, method: "GET" | "POST", path: string, body?: unknown): Promise<any> {
  const url = `${GRAPH_BASE}/${path}`;
  const u = new URL(url);
  if (u.hostname !== "graph.facebook.com" || u.protocol !== "https:") throw new GraphError("invalid", "Destino no permitido.");
  let res: Awaited<ReturnType<GraphFetch>>;
  try {
    res = await fetchImpl(url, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: "error",
    });
  } catch {
    throw new GraphError("unavailable", "No se ha podido conectar con Meta. Inténtalo de nuevo en unos minutos.");
  }
  let json: any = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  if (res.ok) return json;
  const err = json?.error ?? {};
  const code = err.code != null ? String(err.code).slice(0, 16) : null;
  const detail = scrub(String(err.error_user_msg || err.message || ""), [token]);
  if (res.status === 401 || res.status === 403 || code === "190") throw new GraphError("rejected", `Meta ha rechazado la clave de acceso de tu empresa${detail ? `: ${detail}` : ""}.`, code);
  throw new GraphError(res.status >= 500 ? "unavailable" : "invalid", `Meta no ha aceptado la petición (HTTP ${res.status})${detail ? `: ${detail}` : ""}.`, code);
}

export interface ConnectionInfo {
  displayPhoneNumber: string | null;
  verifiedName: string | null;
  qualityRating: string | null;
  nameStatus: string | null;
  accountName: string | null;
}

/** Verificación de la conexión (solo lectura): el número de WhatsApp Business y su cuenta (WABA). */
export async function verifyConnection(fetchImpl: GraphFetch, c: Pick<WhatsappCredentials, "phoneNumberId" | "wabaId" | "accessToken">): Promise<ConnectionInfo> {
  const phone = await call(fetchImpl, c.accessToken, "GET", `${encodeURIComponent(c.phoneNumberId)}?fields=display_phone_number,verified_name,quality_rating,name_status`);
  const waba = await call(fetchImpl, c.accessToken, "GET", `${encodeURIComponent(c.wabaId)}?fields=name`);
  const s = (v: unknown, n = 120) => (typeof v === "string" && v ? v.slice(0, n) : null);
  return { displayPhoneNumber: s(phone?.display_phone_number, 40), verifiedName: s(phone?.verified_name), qualityRating: s(phone?.quality_rating, 20), nameStatus: s(phone?.name_status, 40), accountName: s(waba?.name) };
}

/** Plantillas APROBADAS de la WABA (solo lectura). */
export async function listTemplates(fetchImpl: GraphFetch, c: Pick<WhatsappCredentials, "wabaId" | "accessToken">): Promise<WhatsappTemplate[]> {
  const out: WhatsappTemplate[] = [];
  const j = await call(fetchImpl, c.accessToken, "GET", `${encodeURIComponent(c.wabaId)}/message_templates?fields=name,status,language,category,components&limit=100`);
  for (const t of Array.isArray(j?.data) ? j.data : []) {
    if (String(t?.status ?? "").toUpperCase() !== "APPROVED") continue;
    const body = String((Array.isArray(t.components) ? t.components : []).find((x: any) => String(x?.type).toUpperCase() === "BODY")?.text ?? "").slice(0, 1024);
    const name = String(t.name ?? "");
    const language = String(t.language ?? "");
    if (!/^[a-z0-9_]{1,512}$/.test(name) || !/^[A-Za-z_]{2,15}$/.test(language)) continue;
    out.push({ name, language, category: String(t.category ?? "").slice(0, 30), status: "APPROVED", body, params: templateParamCount(body) });
  }
  return out;
}

/** Envía un mensaje al cliente; devuelve el id del mensaje de Meta (wamid). */
async function send(fetchImpl: GraphFetch, c: Pick<WhatsappCredentials, "phoneNumberId" | "accessToken">, payload: Record<string, unknown>): Promise<string> {
  const j = await call(fetchImpl, c.accessToken, "POST", `${encodeURIComponent(c.phoneNumberId)}/messages`, { messaging_product: "whatsapp", recipient_type: "individual", ...payload });
  const id = j?.messages?.[0]?.id;
  if (typeof id !== "string" || !id) throw new GraphError("unavailable", "Meta no ha devuelto el identificador del mensaje.");
  return id.slice(0, 160);
}

export function sendText(fetchImpl: GraphFetch, c: Pick<WhatsappCredentials, "phoneNumberId" | "accessToken">, to: string, text: string): Promise<string> {
  return send(fetchImpl, c, { to, type: "text", text: { preview_url: false, body: text } });
}

export function sendTemplate(fetchImpl: GraphFetch, c: Pick<WhatsappCredentials, "phoneNumberId" | "accessToken">, to: string, t: { name: string; language: string; params: readonly string[] }): Promise<string> {
  const components = t.params.length ? [{ type: "body", parameters: t.params.map((text) => ({ type: "text", text })) }] : undefined;
  return send(fetchImpl, c, { to, type: "template", template: { name: t.name, language: { code: t.language }, ...(components ? { components } : {}) } });
}
