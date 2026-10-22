/**
 * Lectura PÚBLICA del sitio comercial: `/cp/v1/public/site`.
 *
 *  - `GET /` → solo lo publicado (catálogo, precios aprobados, promociones vigentes y contenidos),
 *    sin datos internos. ETag + caché corta (`max-age=30, must-revalidate`): un cambio publicado
 *    llega en segundos. Si la BD falla → 503 explícito: nunca se sirve un catálogo viejo como vigente.
 *  - `GET /preview?token=` → borradores, con un enlace temporal firmado que emite el CRM.
 *    `no-store` y `noindex`.
 *
 * Nunca incluye productos internos de pruebas (`publicSite`, filtrado en el servidor).
 *
 * Es de solo lectura y no exige cabecera Origin (la web lo lee también al compilar, desde el
 * servidor). Tiene su propio límite por IP.
 */
import crypto from "node:crypto";
import express, { type Router } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { quote } from "../catalog/quote";
import { parseQuoteRequest } from "../catalog/request";
import { quoteCatalogFromSite } from "../catalog/snapshot";
import type { WebAdminService } from "./service";

const PREVIEW_TTL_MS = 30 * 60 * 1000;

export function issuePreviewToken(secret: string, now: number, ttlMs = PREVIEW_TTL_MS): { token: string; expiresAt: number } {
  const expiresAt = now + ttlMs;
  const payload = `p1.${expiresAt.toString(36)}`;
  const sig = crypto.createHmac("sha256", secret).update(`preview:${payload}`).digest("base64url");
  return { token: `${payload}.${sig}`, expiresAt };
}

export function checkPreviewToken(secret: string, token: string, now: number): boolean {
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "p1") return false;
  const expected = crypto.createHmac("sha256", secret).update(`preview:${parts[0]}.${parts[1]}`).digest();
  const given = Buffer.from(parts[2], "base64url");
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return false;
  const exp = parseInt(parts[1], 36);
  return Number.isFinite(exp) && exp > now && exp - now <= PREVIEW_TTL_MS + 60_000;
}

export function createPublicSiteRouter(cfg: { service: WebAdminService; secret: string; now?: () => number; maxAgeSeconds?: number; perIp?: number }): Router {
  const now = cfg.now ?? Date.now;
  const r = express.Router();
  r.use(
    rateLimit({
      windowMs: 10 * 60_000,
      limit: cfg.perIp ?? 600,
      standardHeaders: true,
      legacyHeaders: false,
      keyGenerator: (req) => `site:${ipKeyGenerator(req.ip ?? "")}`,
      handler: (_req, res) => void res.status(429).setHeader("Retry-After", "600").json({ error: "rate_limited" }),
    }),
  );
  const unavailable = (res: express.Response) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Retry-After", "30");
    res.status(503).json({ error: "unavailable" });
  };

  r.get("/", async (req, res) => {
    try {
      const site = await cfg.service.publicSite("published");
      const etag = `"${site.version}"`;
      res.setHeader("ETag", etag);
      res.setHeader("Cache-Control", `public, max-age=${cfg.maxAgeSeconds ?? 30}, must-revalidate`);
      res.setHeader("X-Content-Type-Options", "nosniff");
      if (req.headers["if-none-match"] === etag) return void res.status(304).end();
      res.json(site);
    } catch {
      unavailable(res);
    }
  });

  r.get("/preview", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Robots-Tag", "noindex, nofollow");
    const token = typeof req.query.token === "string" ? req.query.token : "";
    if (!checkPreviewToken(cfg.secret, token, now())) return void res.status(401).json({ error: "invalid_token" });
    try {
      res.json(await cfg.service.publicSite("preview"));
    } catch {
      unavailable(res);
    }
  });

  // Cotización del configurador: SIEMPRE sobre el catálogo publicado (precios aprobados). Un solo
  // cálculo para la web, el CRM y las pruebas (server/catalog/quote.ts). No guarda nada.
  r.post("/quote", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const parsed = parseQuoteRequest(req.body, { allowOwned: false });
    if (!parsed.ok) return void res.status(400).json({ error: "invalid_input", message: parsed.message });
    try {
      res.json(quote(quoteCatalogFromSite(await cfg.service.publicSite("published")), parsed.value));
    } catch {
      unavailable(res);
    }
  });

  r.use((_req, res) => void res.status(404).json({ error: "not_found" }));
  return r;
}
