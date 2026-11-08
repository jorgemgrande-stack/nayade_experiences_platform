/**
 * Hotel Net · descarga de los calendarios iCal de los canales con protección SSRF real.
 *
 *  - Cada salto (la URL y cada redirección, como mucho 3) se valida con `normalizeFeedUrl` (solo https:443, sin
 *    credenciales) y su nombre se resuelve por DNS: si CUALQUIERA de las direcciones no es pública, se rechaza.
 *  - La conexión va a la dirección ya validada (búsqueda fijada en la petición: sin segunda resolución, así un DNS que
 *    cambia entre la comprobación y la conexión no cuela una IP interna); el certificado se valida con el nombre (SNI).
 *  - Tiempo máximo total, tamaño máximo (por cabecera y contando lo recibido), sin compresión ni cookies.
 *  - Los errores son mensajes para el panel, sin el camino ni la consulta de la URL (llevan el secreto del canal).
 */
import dns from "node:dns/promises";
import https from "node:https";
import net from "node:net";
import { ICAL_LIMITS, isPublicAddress, normalizeFeedUrl } from "./hotelIcal";

export interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}
export type Resolver = (hostname: string) => Promise<ResolvedAddress[]>;

export interface HopResponse {
  status: number;
  location: string | null;
  body: string;
}
/** Una petición GET a `url` conectando a `address` (ya validada). */
export type HopGetter = (url: URL, address: ResolvedAddress, opts: { timeoutMs: number; maxBytes: number; signal: AbortSignal }) => Promise<HopResponse>;

export class IcalFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IcalFetchError";
  }
}

export const systemResolver: Resolver = async (hostname) =>
  (await dns.lookup(hostname, { all: true, verbatim: true })).map((a) => ({ address: a.address, family: a.family === 6 ? 6 : 4 }));

/** Direcciones públicas del destino o error si no hay ninguna o alguna no lo es. */
export async function resolvePublicTarget(url: URL, resolve: Resolver): Promise<ResolvedAddress> {
  const host = url.hostname.replace(/^\[|\]$/g, "");
  let list: ResolvedAddress[];
  if (net.isIP(host)) list = [{ address: host, family: net.isIP(host) === 6 ? 6 : 4 }];
  else {
    try {
      list = await resolve(host);
    } catch {
      throw new IcalFetchError(`No se encuentra el servidor ${host}.`);
    }
  }
  if (!list.length) throw new IcalFetchError(`No se encuentra el servidor ${host}.`);
  if (list.some((a) => !isPublicAddress(a.address))) throw new IcalFetchError(`El servidor ${host} resuelve a una dirección privada o reservada: no se descarga.`);
  return list[0];
}

export const httpsHop: HopGetter = (url, address, opts) =>
  new Promise<HopResponse>((resolve, reject) => {
    const host = url.hostname.replace(/^\[|\]$/g, "");
    const req = https.request(
      {
        protocol: "https:",
        host,
        port: 443,
        path: `${url.pathname}${url.search}`,
        method: "GET",
        servername: net.isIP(host) ? undefined : host,
        agent: false,
        timeout: opts.timeoutMs,
        signal: opts.signal,
        headers: { Accept: "text/calendar, text/plain;q=0.8, */*;q=0.1", "Accept-Encoding": "identity", "User-Agent": "BigElephant-HotelNet-iCal/1.0" },
        // Conexión fijada a la dirección validada: no hay segunda resolución
        lookup: ((_h: string, o: { all?: boolean }, cb: (...a: unknown[]) => void) =>
          o?.all ? cb(null, [{ address: address.address, family: address.family }]) : cb(null, address.address, address.family)) as never,
      },
      (res) => {
        const status = res.statusCode ?? 0;
        const location = typeof res.headers.location === "string" ? res.headers.location : null;
        if (status >= 300 && status < 400) {
          res.resume();
          return resolve({ status, location, body: "" });
        }
        const declared = Number(res.headers["content-length"] ?? 0);
        if (declared > opts.maxBytes) {
          res.destroy();
          return reject(new IcalFetchError("El calendario del canal es demasiado grande."));
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (c: Buffer) => {
          size += c.length;
          if (size > opts.maxBytes) {
            res.destroy();
            reject(new IcalFetchError("El calendario del canal es demasiado grande."));
            return;
          }
          chunks.push(c);
        });
        res.on("end", () => resolve({ status, location, body: Buffer.concat(chunks).toString("utf8") }));
        res.on("error", (e) => reject(e));
      },
    );
    req.on("timeout", () => req.destroy(new IcalFetchError("El canal no ha respondido a tiempo.")));
    req.on("error", (e) => reject(e));
    req.end();
  });

function publicMessage(e: unknown): string {
  if (e instanceof IcalFetchError) return e.message;
  const code = (e as { code?: string })?.code ?? "";
  const name = (e as { name?: string })?.name ?? "";
  if (name === "AbortError" || code === "ABORT_ERR") return "El canal no ha respondido a tiempo.";
  if (/CERT|SSL|TLS/i.test(code)) return "El certificado del servidor del canal no es válido.";
  if (code === "ECONNREFUSED" || code === "ECONNRESET" || code === "EHOSTUNREACH" || code === "ETIMEDOUT") return "No se ha podido conectar con el canal.";
  return "No se ha podido descargar el calendario del canal.";
}

/**
 * Descarga un calendario iCal. Devuelve el texto o un error legible. `resolve` y `get` se sustituyen en las pruebas.
 */
export async function fetchIcal(
  rawUrl: string,
  deps: { resolve?: Resolver; get?: HopGetter; timeoutMs?: number; maxBytes?: number; maxRedirects?: number; signal?: AbortSignal } = {},
): Promise<{ ok: true; body: string } | { ok: false; error: string }> {
  const resolve = deps.resolve ?? systemResolver;
  const get = deps.get ?? httpsHop;
  const timeoutMs = deps.timeoutMs ?? ICAL_LIMITS.timeoutMs;
  const maxBytes = deps.maxBytes ?? ICAL_LIMITS.maxBytes;
  const maxRedirects = deps.maxRedirects ?? ICAL_LIMITS.maxRedirects;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  // Cancelación desde fuera (el trabajo programado agota su tiempo): se corta igual que por tiempo
  const onAbort = () => ctl.abort();
  if (deps.signal?.aborted) ctl.abort();
  else deps.signal?.addEventListener("abort", onAbort, { once: true });
  try {
    let current = rawUrl;
    for (let hop = 0; ; hop++) {
      const n = normalizeFeedUrl(current);
      if (!n.ok) throw new IcalFetchError(hop ? `Redirección no admitida: ${n.error}` : n.error);
      const url = new URL(n.url);
      const address = await resolvePublicTarget(url, resolve);
      if (ctl.signal.aborted) throw new IcalFetchError("El canal no ha respondido a tiempo.");
      const r = await get(url, address, { timeoutMs, maxBytes, signal: ctl.signal });
      if (r.status >= 300 && r.status < 400) {
        if (!r.location) throw new IcalFetchError(`El canal ha respondido ${r.status} sin destino.`);
        if (hop >= maxRedirects) throw new IcalFetchError("Demasiadas redirecciones.");
        current = new URL(r.location, url).toString();
        continue;
      }
      if (r.status === 401 || r.status === 403) throw new IcalFetchError(`El canal deniega el acceso (${r.status}): revisa la URL o genera otra en el canal.`);
      if (r.status === 404 || r.status === 410) throw new IcalFetchError(`El canal ya no publica este calendario (${r.status}): copia de nuevo la URL.`);
      if (r.status !== 200) throw new IcalFetchError(`El canal ha respondido ${r.status}.`);
      return { ok: true, body: r.body };
    }
  } catch (e) {
    return { ok: false, error: ctl.signal.aborted ? "El canal no ha respondido a tiempo." : publicMessage(e) };
  } finally {
    clearTimeout(timer);
    deps.signal?.removeEventListener("abort", onAbort);
  }
}
