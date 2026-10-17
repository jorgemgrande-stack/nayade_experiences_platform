/**
 * Proveedores de correo detrás de un puerto (`MailProviderPort`):
 *  - Brevo, API HTTP v3 (POST /v3/smtp/email). Documentación oficial:
 *    https://developers.brevo.com/reference/send-transac-email
 *  - SMTP genérico (nodemailer): alternativa para cualquier relé SMTP (también el de Brevo).
 *  - Memoria: pruebas (no sale nada).
 *
 * Ningún proveedor registra destinatarios, asuntos, cuerpos ni la clave: solo códigos de estado.
 * Diagnóstico de cuenta (sin enviar): `brevoDiagnostics`.
 */
import nodemailer from "nodemailer";
import { MailProviderError, type MailProviderPort, type ProviderMessage } from "./types";

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{ status: number; ok: boolean; json(): Promise<unknown>; text(): Promise<string> }>;

export const BREVO_API_BASE = "https://api.brevo.com";

/** Códigos de error documentados por Brevo que se pueden registrar (no repiten datos del mensaje). */
const SAFE_CODE = /^[a-z_]{3,40}$/;

export function brevoProvider(o: { apiKey: string; baseUrl?: string; fetch?: FetchLike; timeoutMs?: number }): MailProviderPort {
  const base = (o.baseUrl ?? BREVO_API_BASE).replace(/\/+$/, "");
  const doFetch: FetchLike = o.fetch ?? ((url, init) => fetch(url, init) as never);
  return {
    name: "brevo",
    async send(m: ProviderMessage) {
      const body = {
        sender: { name: m.from.name, email: m.from.email },
        ...(m.replyTo ? { replyTo: { email: m.replyTo } } : {}),
        to: [{ email: m.to }],
        ...(m.cc?.length ? { cc: m.cc.map((email) => ({ email })) } : {}),
        subject: m.subject,
        htmlContent: m.html,
        ...(m.text ? { textContent: m.text } : {}),
        ...(m.attachments?.length ? { attachment: m.attachments.map((a) => ({ url: a.url, name: a.name })) } : {}),
        tags: [m.tag],
        // X-Mailin-custom vuelve en los webhooks (referencia opaca); sin seguimiento de clics para que
        // los enlaces lleguen directos. `IdempotencyKey` es una cabecera propia (Brevo no documenta
        // deduplicación): la garantía real de no duplicar es la bandeja de salida.
        headers: { "X-Mailin-custom": m.ref, "X-Mailin-no-track": "1", IdempotencyKey: m.idempotencyKey },
      };
      let res: Awaited<ReturnType<FetchLike>>;
      try {
        res = await doFetch(`${base}/v3/smtp/email`, {
          method: "POST",
          headers: { accept: "application/json", "content-type": "application/json", "api-key": o.apiKey },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(o.timeoutMs ?? 15_000),
        });
      } catch (e) {
        throw new MailProviderError(e instanceof Error && e.name === "TimeoutError" ? "timeout" : "network_error", true);
      }
      if (res.status === 201 || res.status === 202) {
        const json = (await res.json().catch(() => ({}))) as { messageId?: unknown };
        return { messageId: typeof json.messageId === "string" ? json.messageId.slice(0, 200) : null };
      }
      // El cuerpo del error puede repetir destinatarios: solo se conserva el código si es seguro
      const json = (await res.json().catch(() => null)) as { code?: unknown } | null;
      const code = typeof json?.code === "string" && SAFE_CODE.test(json.code) ? json.code : `http_${res.status}`;
      const retryable = res.status === 429 || res.status >= 500;
      throw new MailProviderError(code, retryable, res.status);
    },
  };
}

/** SMTP genérico. La conexión se abre al enviar. */
export function smtpProvider(c: { host: string; port: number; secure: boolean; user: string; pass: string }): MailProviderPort {
  const transport = nodemailer.createTransport({ host: c.host, port: c.port, secure: c.secure, auth: { user: c.user, pass: c.pass }, connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 30_000 });
  return {
    name: "smtp",
    async send(m) {
      try {
        const info = await transport.sendMail({
          from: { name: m.from.name, address: m.from.email },
          replyTo: m.replyTo ?? undefined,
          to: m.to,
          cc: m.cc?.length ? m.cc : undefined,
          subject: m.subject,
          html: m.html,
          text: m.text,
          attachments: m.attachments?.map((a) => ({ filename: a.name, path: a.url })),
          headers: { "X-Mailin-custom": m.ref, "X-Elephant-Tag": m.tag },
        });
        return { messageId: typeof info.messageId === "string" ? info.messageId.slice(0, 200) : null };
      } catch (e) {
        const code = String((e as { responseCode?: unknown })?.responseCode ?? "");
        // 5xx SMTP = rechazo definitivo; el resto (red, 4xx temporales) se reintenta
        throw new MailProviderError(code ? `smtp_${code}` : "smtp_error", !code.startsWith("5"));
      }
    },
  };
}

/** En memoria (pruebas). `failWith` simula un fallo en cada envío. */
export function memoryProvider(o: { failWith?: MailProviderError | null } = {}): MailProviderPort & { sent: ProviderMessage[]; failWith: MailProviderError | null } {
  const p = {
    name: "memory",
    sent: [] as ProviderMessage[],
    failWith: o.failWith ?? null,
    async send(m: ProviderMessage) {
      if (p.failWith) throw p.failWith;
      p.sent.push(m);
      return { messageId: `<mem-${p.sent.length}@memory.example>` };
    },
  };
  return p;
}

/**
 * Proveedor según el entorno: Brevo si hay `BREVO_API_KEY`; si no, SMTP si están `SMTP_HOST`,
 * `SMTP_USER` y `SMTP_PASS`; si no, ninguno (los mensajes quedan pendientes y acaban en «failed»).
 */
export function mailProviderFromEnv(env: NodeJS.ProcessEnv): MailProviderPort | null {
  if (env.BREVO_API_KEY) return brevoProvider({ apiKey: env.BREVO_API_KEY, baseUrl: env.BREVO_API_BASE_URL });
  if (env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS)
    return smtpProvider({ host: env.SMTP_HOST, port: Number(env.SMTP_PORT ?? 587), secure: env.SMTP_SECURE === "true", user: env.SMTP_USER, pass: env.SMTP_PASS });
  return null;
}

// ── Diagnóstico de cuenta (solo lecturas; nunca envía) ───────────────────────

export interface BrevoDiagnostics {
  ok: boolean;
  /** Fallos por llamada (código), sin cuerpos de respuesta. */
  errors: Record<string, string>;
  account: { companyName: string | null; plans: { type: string; credits: number | null; creditsType: string | null }[]; transactionalEnabled: boolean | null } | null;
  senders: { email: string; active: boolean }[] | null;
  domains: { domain: string; authenticated: boolean; verified: boolean }[] | null;
  sendingDomain: {
    domain: string;
    found: boolean;
    authenticated: boolean | null;
    verified: boolean | null;
    records: Record<string, { hostName: string | null; type: string | null; ok: boolean | null }>;
  } | null;
  /** Conclusión para el operador. */
  verdict: string[];
}

/**
 * Consulta la cuenta de Brevo con endpoints oficiales de solo lectura:
 *  - GET /v3/account                       https://developers.brevo.com/reference/get-account
 *  - GET /v3/senders                       https://developers.brevo.com/reference/get-senders
 *  - GET /v3/senders/domains               https://developers.brevo.com/reference/get-domains
 *  - GET /v3/senders/domains/{domainName}  https://developers.brevo.com/reference/get-domain-configuration
 * No devuelve el correo de acceso de la cuenta ni los valores de los registros DNS (salen del panel).
 */
export async function brevoDiagnostics(o: { apiKey: string; sendingDomain: string | null; baseUrl?: string; fetch?: FetchLike }): Promise<BrevoDiagnostics> {
  const base = (o.baseUrl ?? BREVO_API_BASE).replace(/\/+$/, "");
  const doFetch: FetchLike = o.fetch ?? ((url, init) => fetch(url, init) as never);
  const errors: Record<string, string> = {};
  const get = async (name: string, path: string): Promise<any> => {
    try {
      const r = await doFetch(`${base}${path}`, { method: "GET", headers: { accept: "application/json", "api-key": o.apiKey }, signal: AbortSignal.timeout(10_000) });
      if (!r.ok) {
        errors[name] = `http_${r.status}`;
        return null;
      }
      return await r.json();
    } catch (e) {
      errors[name] = e instanceof Error && e.name === "TimeoutError" ? "timeout" : "network_error";
      return null;
    }
  };
  const [acc, snd, dom] = await Promise.all([get("account", "/v3/account"), get("senders", "/v3/senders"), get("domains", "/v3/senders/domains")]);
  const account = acc
    ? {
        companyName: typeof acc.companyName === "string" ? acc.companyName : null,
        plans: Array.isArray(acc.plan) ? acc.plan.map((p: any) => ({ type: String(p?.type ?? ""), credits: typeof p?.credits === "number" ? p.credits : null, creditsType: typeof p?.creditsType === "string" ? p.creditsType : null })) : [],
        transactionalEnabled: typeof acc.relay?.enabled === "boolean" ? acc.relay.enabled : null,
      }
    : null;
  const senders = snd && Array.isArray(snd.senders) ? snd.senders.map((s: any) => ({ email: String(s?.email ?? ""), active: s?.active === true })) : null;
  const domains = dom && Array.isArray(dom.domains) ? dom.domains.map((d: any) => ({ domain: String(d?.domain_name ?? ""), authenticated: d?.authenticated === true, verified: d?.verified === true })) : null;
  let sendingDomain: BrevoDiagnostics["sendingDomain"] = null;
  if (o.sendingDomain) {
    const listed = domains?.some((d: { domain: string }) => d.domain === o.sendingDomain) ?? false;
    const cfg = listed ? await get("sendingDomain", `/v3/senders/domains/${encodeURIComponent(o.sendingDomain)}`) : null;
    const records: Record<string, { hostName: string | null; type: string | null; ok: boolean | null }> = {};
    for (const [k, v] of Object.entries((cfg?.dns_records ?? {}) as Record<string, any>))
      records[k] = { hostName: typeof v?.host_name === "string" ? v.host_name : null, type: typeof v?.type === "string" ? v.type : null, ok: typeof v?.status === "boolean" ? v.status : null };
    sendingDomain = { domain: o.sendingDomain, found: listed, authenticated: cfg ? cfg.authenticated === true : null, verified: cfg ? cfg.verified === true : null, records };
  }
  const verdict: string[] = [];
  if (errors.account === "http_401") verdict.push("La clave de API no es válida o no tiene permiso (401).");
  if (account?.transactionalEnabled === false) verdict.push("El envío transaccional de la cuenta está desactivado (relay.enabled = false).");
  if (account?.transactionalEnabled === true) verdict.push("La cuenta tiene el envío transaccional activo.");
  if (o.sendingDomain && sendingDomain && !sendingDomain.found) verdict.push(`El dominio ${o.sendingDomain} no está dado de alta en Brevo (Remitentes, dominios e IP dedicadas → Dominios).`);
  if (sendingDomain?.found && !sendingDomain.authenticated) verdict.push(`El dominio ${o.sendingDomain} está dado de alta pero SIN autenticar: publicar los registros del panel y pulsar «Autenticar».`);
  if (sendingDomain?.authenticated) verdict.push(`El dominio ${o.sendingDomain} está autenticado.`);
  if (!o.sendingDomain) verdict.push("Falta MAIL_SENDING_DOMAIN: no se puede comprobar el dominio de envío.");
  return { ok: Object.keys(errors).length === 0 && sendingDomain?.authenticated === true && account?.transactionalEnabled !== false, errors, account, senders, domains, sendingDomain, verdict };
}
