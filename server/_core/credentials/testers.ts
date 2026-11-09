import { VeturisApiError } from "../../travelNet/veturis/protocol";
import { VeturisClient, VeturisNetworkError, type VeturisFetch } from "../../travelNet/veturis/client";
import { postmarkServerInfo } from "../../mail/tenantPostmark";
import type { FetchLike } from "../../mail/providers";
import { MailHostError, resolveMailHost, systemHostResolver, type HostResolver } from "./mailHost";
import { testSeoProvider, type SeoFetch } from "../../seoControl/connectors";

/**
 * Comprobación de credenciales por proveedor. Nunca devuelve ni registra el secreto; el
 * resultado es solo `ok` + un motivo genérico. Las llamadas de red usan `fetch` inyectable.
 */
export interface TestResult {
  ok: boolean;
  message: string;
  /** connected: correcta · rejected: el proveedor rechaza las credenciales · error: no se pudo completar · unsupported: sin prueba */
  outcome?: "connected" | "rejected" | "error" | "unsupported";
}

const done = (r: TestResult): TestResult => ({ ...r, outcome: r.outcome ?? (r.ok ? "connected" : "error") });

type Fetch = (url: string, init?: { method?: string; headers?: Record<string, string>; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number }>;

const TIMEOUT_MS = 8000;

async function get(fetchImpl: Fetch, url: string, headers: Record<string, string>): Promise<TestResult> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const r = await fetchImpl(url, { method: "GET", headers, signal: ctl.signal });
    if (r.ok) return { ok: true, message: "Conexión correcta" };
    if (r.status === 401 || r.status === 403) return { ok: false, message: "Credenciales rechazadas por el proveedor", outcome: "rejected" };
    return { ok: false, message: `El proveedor respondió ${r.status}` };
  } catch {
    return { ok: false, message: "No se pudo contactar con el proveedor" };
  } finally {
    clearTimeout(t);
  }
}

/** Puertos de red para buzones (inyectables en pruebas). Solo inician sesión: no leen ni envían nada. */
export interface MailProbes {
  imapLogin: (o: { host: string; port: number; secure: boolean; user: string; pass: string; mailbox: string }) => Promise<void>;
  smtpVerify: (o: { host: string; port: number; secure: boolean; user: string; pass: string }) => Promise<void>;
}

const AUTH_FAIL = /auth|login|credential|password|535|534|invalid user|authenticationfailed/i;

/** Tiempos de ImapFlow en la comprobación: conexión y saludo acotados (por debajo de los 20 s del asistente). */
export const IMAP_CHECK_TIMEOUTS = { connectionTimeout: 12_000, greetingTimeout: 6_000, socketTimeout: TIMEOUT_MS } as const;

/** Cliente IMAP mínimo que usa la comprobación (inyectable en pruebas). */
export interface ImapCheckClient {
  connect(): Promise<void>;
  getMailboxLock(path: string, opts: { readOnly: boolean }): Promise<{ release(): void }>;
  logout(): Promise<void>;
}
export type ImapClientFactory = (opts: Record<string, unknown>) => Promise<ImapCheckClient>;
const imapflowFactory: ImapClientFactory = async (opts) => {
  const { ImapFlow } = await import("imapflow");
  return new ImapFlow(opts as unknown as ConstructorParameters<typeof ImapFlow>[0]) as unknown as ImapCheckClient;
};

/**
 * Inicio de sesión IMAP real de la comprobación. SSRF: solo servidores públicos (MailHostError si no); se conecta a la
 * IP validada con el nombre original como SNI y para validar el certificado. No lee ni marca mensajes.
 */
export async function imapLoginCheck(o: Parameters<MailProbes["imapLogin"]>[0], resolve: HostResolver = systemHostResolver, makeClient: ImapClientFactory = imapflowFactory): Promise<void> {
  const target = await resolveMailHost(o.host, resolve);
  const client = await makeClient({ host: target.address, servername: target.servername, port: o.port, secure: o.secure, auth: { user: o.user, pass: o.pass }, logger: false, ...IMAP_CHECK_TIMEOUTS });
  try {
    await client.connect();
    // Abre la carpeta en solo lectura (no marca nada como leído) y sale
    const lock = await client.getMailboxLock(o.mailbox, { readOnly: true });
    lock.release();
  } finally {
    await client.logout().catch(() => undefined);
  }
}

const realProbes: MailProbes = {
  imapLogin: (o) => imapLoginCheck(o),
  async smtpVerify(o) {
    const nodemailer = await import("nodemailer");
    const t = nodemailer.createTransport({ host: o.host, port: o.port, secure: o.secure, auth: { user: o.user, pass: o.pass }, connectionTimeout: TIMEOUT_MS, greetingTimeout: TIMEOUT_MS, socketTimeout: TIMEOUT_MS });
    try {
      await t.verify(); // conexión + autenticación, sin enviar ningún mensaje
    } finally {
      t.close();
    }
  },
};

async function mailbox(kind: "imap" | "smtp", v: Record<string, string>, probes: MailProbes): Promise<TestResult> {
  if (!v.host || !v.user || !v.pass) return { ok: false, message: "Faltan servidor, usuario o contraseña", outcome: "error" };
  const defPort = kind === "imap" ? 993 : 587;
  const port = Number.parseInt(v.port || String(defPort), 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return { ok: false, message: "Puerto no válido", outcome: "error" };
  const secure = kind === "imap" ? (v.secure || "true") === "true" : v.secure ? v.secure === "true" : port === 465;
  try {
    if (kind === "imap") await probes.imapLogin({ host: v.host, port, secure, user: v.user, pass: v.pass, mailbox: v.mailbox || "INBOX" });
    else await probes.smtpVerify({ host: v.host, port, secure, user: v.user, pass: v.pass });
    return { ok: true, message: kind === "imap" ? "Buzón accesible (inicio de sesión correcto, sin leer mensajes)" : "Servidor de envío accesible (autenticación correcta, sin enviar nada)" };
  } catch (e) {
    if (e instanceof MailHostError) return { ok: false, message: e.message, outcome: "error" };
    const raw = String((e as { responseText?: string; response?: string; message?: string }).responseText ?? (e as { response?: string }).response ?? (e as Error).message ?? "");
    if (AUTH_FAIL.test(raw) || (e as { authenticationFailed?: boolean }).authenticationFailed) return { ok: false, message: "El servidor rechaza el usuario o la contraseña", outcome: "rejected" };
    return { ok: false, message: kind === "imap" ? "No se pudo conectar con el servidor IMAP" : "No se pudo conectar con el servidor SMTP", outcome: "error" };
  }
}

/**
 * Veturis no tiene un «ping»: se hace una búsqueda de disponibilidad (solo lectura, no reserva nada) dentro de 60
 * días. Unas credenciales malas responden con un error de acceso.
 */
async function veturisCheck(v: Record<string, string>, fetchImpl: VeturisFetch): Promise<TestResult> {
  if (!v.user || !v.password || !v.agencyUser || !v.agencyPassword) return { ok: false, message: "Faltan el usuario, la clave o los datos de la agencia" };
  const env = v.environment === "live" ? "live" : "test";
  const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
  const client = new VeturisClient({ user: v.user, password: v.password, agencyUser: v.agencyUser, agencyPassword: v.agencyPassword, environment: env }, { fetch: fetchImpl, maxCalls: 1 });
  try {
    await client.search({ hotelIds: ["1"], checkIn: day(60), checkOut: day(61), rooms: [{ adults: 2, childrenAges: [] }] });
    return { ok: true, message: `Conexión correcta con Veturis (${env === "live" ? "real" : "pruebas"})` };
  } catch (e) {
    if (e instanceof VeturisNetworkError && e.rejected) return { ok: false, message: "Veturis rechaza las credenciales", outcome: "rejected" };
    if (e instanceof VeturisApiError && VETURIS_AUTH_RE.test(e.message)) return { ok: false, message: "Veturis rechaza las credenciales", outcome: "rejected" };
    if (e instanceof VeturisApiError) return { ok: false, message: "Veturis respondió con un error: revisa los datos o contacta con su soporte" };
    return { ok: false, message: "No se pudo contactar con Veturis (revisa que la IP del servidor esté autorizada)" };
  }
}
const VETURIS_AUTH_RE = /usuari|user|password|contrase|login|autentic|acceso|access|credencial|agenc/i;

export async function testProvider(
  provider: string,
  v: Record<string, string>,
  fetchImpl: Fetch = fetch as unknown as Fetch,
  probes: MailProbes = realProbes,
): Promise<TestResult> {
  return done(await testProviderRaw(provider, v, fetchImpl, probes));
}

async function testProviderRaw(provider: string, v: Record<string, string>, fetchImpl: Fetch, probes: MailProbes): Promise<TestResult> {
  switch (provider) {
    case "imap_tpv":
    case "imap_expenses":
      return mailbox("imap", v, probes);
    case "mail_smtp":
      return mailbox("smtp", v, probes);
    case "ghl": {
      if (!v.apiKey || !v.locationId) return { ok: false, message: "Faltan API key o Location ID" };
      return get(fetchImpl, `https://services.leadconnectorhq.com/locations/${encodeURIComponent(v.locationId)}`, {
        Authorization: `Bearer ${v.apiKey}`,
        Version: "2021-07-28",
      });
    }
    case "vapi": {
      if (!v.apiKey) return { ok: false, message: "Falta la API key" };
      return get(fetchImpl, "https://api.vapi.ai/assistant?limit=1", { Authorization: `Bearer ${v.apiKey}` });
    }
    case "meta": {
      // Ads Manager: con cuenta publicitaria se comprueba que la clave de lectura (o la de la Conversions API) la ve
      const token = v.capiAccessToken || v.adsAccessToken;
      if (!token) return { ok: false, message: "Falta el token de acceso" };
      const account = v.adAccountId?.match(/^(?:act_)?(\d{5,20})$/)?.[1];
      if (account) return get(fetchImpl, `https://graph.facebook.com/v21.0/act_${account}?fields=name`, { Authorization: `Bearer ${v.adsAccessToken || token}` });
      // El token va en la cabecera, nunca en la URL (no queda en registros intermedios ni en mensajes de error)
      return get(fetchImpl, "https://graph.facebook.com/v21.0/me", { Authorization: `Bearer ${token}` });
    }
    case "google_ads": {
      // Solo lectura: renueva el acceso y consulta un día de la cuenta (Elephant Ads Manager)
      const { fetchGoogleDaily } = await import("../../adsManager/connectors");
      const day = new Date().toISOString().slice(0, 10);
      const r = await fetchGoogleDaily(
        { customerId: v.customerId ?? "", loginCustomerId: v.loginCustomerId || undefined, developerToken: v.developerToken ?? "", clientId: v.clientId ?? "", clientSecret: v.clientSecret ?? "", refreshToken: v.refreshToken ?? "" },
        day,
        day,
        fetchImpl as unknown as import("../../adsManager/connectors").AdsFetch,
      );
      if (r.ok) return { ok: true, message: `Conexión correcta con Google Ads (${r.accountName ?? r.accountId}, ${r.currency})` };
      if (r.error.kind === "AUTH_ERROR" || r.error.kind === "PERMISSION_ERROR") return { ok: false, message: r.error.message, outcome: "rejected" };
      return { ok: false, message: r.error.message };
    }
    case "whatsapp_cloud": {
      // Elephant WhatsApp AI: datos del número y de su cuenta (solo lectura); la clave en la cabecera, nunca en la URL
      const { verifyConnection, usableCredentials } = await import("../../whatsappCloud/graph");
      const c = usableCredentials(v);
      if (!c) return { ok: false, message: "Faltan el identificador del número, el de la cuenta o la clave de acceso" };
      try {
        const info = await verifyConnection(fetchImpl as unknown as import("../../whatsappCloud/graph").GraphFetch, c);
        return { ok: true, message: `Conexión correcta con WhatsApp Business (${[info.displayPhoneNumber, info.verifiedName].filter(Boolean).join(" · ") || "número verificado"})` };
      } catch (e) {
        const rejected = (e as { kind?: string }).kind === "rejected";
        return { ok: false, message: e instanceof Error && e.name === "GraphError" ? e.message : "No se pudo contactar con Meta", ...(rejected ? { outcome: "rejected" as const } : {}) };
      }
    }
    case "brevo_marketing": {
      if (!v.apiKey) return { ok: false, message: "Falta la clave API" };
      return get(fetchImpl, "https://api.brevo.com/v3/account", { "api-key": v.apiKey, accept: "application/json" });
    }
    case "postmark": {
      // Solo lectura: servidor y flujo (debe ser transaccional). Nunca envía ni registra el webhook
      if (!v.serverToken) return { ok: false, message: "Falta el token del servidor" };
      const r = await postmarkServerInfo({ serverToken: v.serverToken, messageStream: v.messageStream, fetch: fetchImpl as unknown as FetchLike });
      return { ok: r.ok, message: [r.message, ...r.warnings].join(" "), outcome: r.outcome };
    }
    case "veturis":
      return veturisCheck(v, fetchImpl as unknown as VeturisFetch);
    // Elephant SEO Control: solo lectura con las credenciales de la empresa (server/seoControl/connectors.ts)
    case "google_search_console":
    case "google_business_profile":
    case "tripadvisor":
      // Con el fetch global por defecto se usa el del conector (sustituible en pruebas); si no, el inyectado
      return (await testSeoProvider(provider, v, fetchImpl === (globalThis.fetch as unknown) ? undefined : (fetchImpl as unknown as SeoFetch)))!;
    case "redsys": {
      // Sin red: Redsys no ofrece un ping; se valida que la configuración sea utilizable
      if (!v.merchantCode || !v.merchantKey) return { ok: false, message: "Faltan el número de comercio o la clave secreta" };
      const raw = Buffer.from(v.merchantKey, "base64");
      if (raw.length < 16) return { ok: false, message: "La clave secreta no tiene la longitud esperada: cópiala de nuevo tal cual te la dio el banco" };
      if (!["test", "production"].includes(v.environment ?? "test")) return { ok: false, message: "Elige «Modo pruebas» o «Modo real»" };
      return { ok: true, message: `Datos correctos (${(v.environment ?? "test") === "production" ? "modo real" : "modo pruebas"}). El banco confirma la conexión con el primer pago; haz uno de prueba para asegurarte.` };
    }
    default:
      return { ok: false, message: "Proveedor sin prueba disponible", outcome: "unsupported" };
  }
}
