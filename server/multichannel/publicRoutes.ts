/**
 * Venta multicanal · enlace de entrada de cada canal (sin sesión), montado con las rutas públicas de
 * server/netPublic/router.ts. No pasa por /api/trpc: no cambia la lista blanca de server/authGuard.ts.
 *
 *  - POST /canal/<token>/ventas         Ventas y cancelaciones del canal en JSON (una o `{ "sales": [...] }`, hasta 100).
 *  - GET  /canal/<token>/disponibilidad Lo que el canal puede vender cada día (su cupo restante, limitado por el Core).
 *  - POST /canal/ventas y GET /canal/disponibilidad: lo mismo con el token en una cabecera (`X-Canal-Token: <token>` o
 *    `Authorization: Bearer <token>`), para que el secreto no quede en los registros de URL. La forma con el token en la
 *    ruta se mantiene por compatibilidad.
 *
 * El token es el secreto del canal (32 bytes, se guarda solo su huella ligada a la empresa) y la empresa sale del
 * dominio de la petición, nunca del cuerpo. Exige multiempresa y la capacidad `multichannel` con escritura en esa
 * empresa. Un token no válido, revocado, de un canal desactivado o de otra empresa responde siempre lo mismo (404).
 * Cuerpo: solo JSON y como mucho 64 KB (`multichannelBodyParser`, antes del lector general de 50 MB). Límite por IP y
 * por enlace. Idempotente por la referencia de cada venta: el canal puede reintentar sin duplicar reservas.
 */
import crypto from "node:crypto";
import express, { type Request, type RequestHandler, type Response, type Router } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { getCapabilityAccess } from "../_core/capabilities/access";
import { getTenantIdOrDefault, isMultiTenant } from "../_core/tenant";
import { MC_CAPABILITY, MC_LIMITS, parseInboundSale } from "../../shared/multichannel";
import { McNotInstalled, availabilityFeed, ingestSale, resolveInboundChannel, type McAfterRegister } from "../multichannelDb";

/** POST de ventas (lo comprueba el lector de cuerpos). */
export const MC_PUBLIC_POST_PATH = /^\/canal\/(?:[^/]+\/)?ventas\/?$/;

const json = express.json({ limit: MC_LIMITS.inboundBytes, type: () => true });

/** Lector del cuerpo: JSON de 64 KB como mucho. Se monta antes del lector general; si ya se leyó (pruebas), nada. */
export const multichannelBodyParser: RequestHandler = (req, res, next) => {
  if (req.method !== "POST" || !MC_PUBLIC_POST_PATH.test(req.path)) return next();
  if (Number(req.headers["content-length"] ?? 0) > MC_LIMITS.inboundBytes) return void res.status(413).json({ error: "too_large" });
  if (!/^application\/json\b/i.test(String(req.headers["content-type"] ?? ""))) return void res.status(415).json({ error: "unsupported_media_type", message: "Envía las ventas en JSON (Content-Type: application/json)." });
  json(req, res, (err?: unknown) => {
    if (err) return void res.status((err as { type?: string }).type === "entity.too.large" ? 413 : 400).json({ error: (err as { type?: string }).type === "entity.too.large" ? "too_large" : "invalid_json" });
    next();
  });
};

const noStore = (res: Response) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  res.setHeader("Referrer-Policy", "no-referrer");
};
/** Token del canal: el de la ruta o, si no va en ella, el de la cabecera X-Canal-Token o Authorization: Bearer. */
export function inboundTokenOf(req: Pick<Request, "params" | "headers">): string {
  if (req.params?.token) return String(req.params.token).slice(0, 120);
  const h = req.headers["x-canal-token"];
  // Un X-Canal-Token vacío no tapa el de Authorization
  const own = String((Array.isArray(h) ? h[0] : h) ?? "").trim();
  const header = own || (/^Bearer\s+(\S+)\s*$/i.exec(String(req.headers.authorization ?? "").trim())?.[1] ?? "");
  return header.slice(0, 120);
}

const notFound = (res: Response) => void res.status(404).json({ error: "not_found" });
const unavailable = (res: Response) => void res.status(503).json({ error: "unavailable", message: "La Venta multicanal no está disponible en esta empresa." });

/** Multiempresa, empresa resuelta y licencia con escritura; si no, false. */
async function available(): Promise<boolean> {
  if (!isMultiTenant() || getTenantIdOrDefault() === "unresolved") return false;
  try {
    return (await getCapabilityAccess().check(MC_CAPABILITY, { write: true })).allowed;
  } catch {
    return false;
  }
}

function logError(what: string, e: unknown) {
  console.error(JSON.stringify({ ctx: "MulticanalPublic", event: "error", what, error: e instanceof Error ? e.message.slice(0, 200) : "error" }));
}

export interface MultichannelPublicOptions {
  perIpPerMinute?: number;
  perLinkPer10Min?: number;
  after?: McAfterRegister;
}

export function multichannelHandlers(o: MultichannelPublicOptions = {}) {
  const post = async (req: Request, res: Response) => {
    noStore(res);
    try {
      if (!(await available())) return unavailable(res);
      const channel = await resolveInboundChannel(inboundTokenOf(req));
      if (!channel) return notFound(res);
      const body = req.body && typeof req.body === "object" ? (req.body as Record<string, unknown>) : null;
      if (!body) return void res.status(400).json({ error: "invalid_body" });
      const list = Array.isArray(body.sales) ? body.sales : [body];
      if (list.length === 0 || list.length > MC_LIMITS.inboundBatch) return void res.status(400).json({ error: "invalid_body", message: `Envía entre 1 y ${MC_LIMITS.inboundBatch} ventas.` });
      const results = [];
      for (const raw of list) {
        const p = parseInboundSale(raw);
        if (!p.ok) {
          results.push({ ref: raw && typeof raw === "object" ? String((raw as Record<string, unknown>).ref ?? "").slice(0, 128) || null : null, status: "rechazada", duplicate: false, problem: p.problem });
          continue;
        }
        const r = await ingestSale(channel, p.sale, { source: "enlace", after: o.after });
        results.push({ ref: r.ref, status: r.status, duplicate: r.duplicate, problem: r.problem });
      }
      res.status(200).json({ results });
    } catch (e) {
      if (e instanceof McNotInstalled) return unavailable(res);
      logError("ventas", e);
      res.status(500).json({ error: "internal_error" });
    }
  };
  const get = async (req: Request, res: Response) => {
    noStore(res);
    try {
      if (!(await available())) return unavailable(res);
      const channel = await resolveInboundChannel(inboundTokenOf(req));
      if (!channel) return notFound(res);
      const days = Number(req.query.dias ?? req.query.days ?? 60);
      res.status(200).json(await availabilityFeed(channel.id, Number.isFinite(days) ? Math.trunc(days) : 60));
    } catch (e) {
      if (e instanceof McNotInstalled) return unavailable(res);
      logError("disponibilidad", e);
      res.status(500).json({ error: "internal_error" });
    }
  };
  return { post, get };
}

export function createMultichannelPublicRouter(o: MultichannelPublicOptions = {}): Router {
  const r = express.Router({ caseSensitive: true, strict: false });
  const ip = (req: Request) => `ip:${ipKeyGenerator(req.ip ?? "")}`;
  const limiter = (windowMs: number, limit: number, keyGenerator: (req: Request) => string) =>
    rateLimit({ windowMs, limit, standardHeaders: true, legacyHeaders: false, keyGenerator, handler: (_req, res) => void res.status(429).json({ error: "too_many_requests" }) });
  const all = limiter(60_000, o.perIpPerMinute ?? 120, (req) => `mc-all:${ip(req)}`);
  // Por enlace: la huella de la ruta con la empresa, nunca el token
  const perLink = limiter(10 * 60_000, o.perLinkPer10Min ?? 600, (req) => `mc-link:${crypto.createHash("sha256").update(`${getTenantIdOrDefault()}:${inboundTokenOf(req)}`).digest("hex")}`);
  const h = multichannelHandlers(o);
  r.post("/canal/:token/ventas", all, perLink, multichannelBodyParser, h.post);
  r.get("/canal/:token/disponibilidad", all, perLink, h.get);
  // Con el token en una cabecera
  r.post("/canal/ventas", all, perLink, multichannelBodyParser, h.post);
  r.get("/canal/disponibilidad", all, perLink, h.get);
  return r;
}
