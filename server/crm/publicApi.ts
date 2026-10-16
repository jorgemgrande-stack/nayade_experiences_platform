/**
 * API PÚBLICA de captación (sin autenticación) para la web comercial: /cp/v1/public/*
 *
 * Solo puede hacer una cosa: registrar una solicitud comercial. No crea tenants, no activa
 * licencias, no lee datos del CRM y no devuelve identificadores internos (solo una referencia).
 *
 * Defensas: origen permitido explícito, ticket de formulario firmado (HMAC) con tiempo mínimo de
 * rellenado, caducidad y un solo uso; campo trampa; límites por IP y por correo; tamaño máximo;
 * validación estricta (zod, campos desconocidos = 400); `Idempotency-Key` obligatoria.
 * Auditoría: cada intento queda en el registro estructurado sin datos personales (IP seudonimizada).
 */
import crypto from "node:crypto";
import express, { type Request, type Response, type Router } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { z } from "zod";
import { CrmError, LEAD_REQUEST_TYPES, type LeadRequestType } from "./types";
import type { WebRequestInput, WebRequestService } from "./webRequests";

export interface PublicIntakeConfig {
  service: WebRequestService;
  /** Secreto del servidor (≥ 32 caracteres) para firmar tickets y seudonimizar IPs. */
  secret: string;
  /** Orígenes de la web autorizados (exactos). */
  origins: Set<string>;
  /** Tiempo mínimo entre pedir el ticket y enviar (por defecto 3 s). */
  minFillMs?: number;
  /** Vida máxima del ticket (por defecto 2 h). */
  maxTicketAgeMs?: number;
  /** Envíos por IP en 10 minutos (por defecto 10). */
  perIp?: number;
  /** Solicitudes nuevas por correo y hora (por defecto 5). */
  perEmailPerHour?: number;
  now?: () => number;
  audit?: (e: Record<string, unknown>) => void;
}

const MAX_BODY_BYTES = 16 * 1024;
const PRIVACY_VERSION = /^[a-z0-9.-]{1,32}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const catalogId = z.string().regex(/^[a-z0-9][a-z0-9-]{0,40}$/);
const optText = (max: number) => z.string().trim().max(max).nullish().transform((v) => (v ? v : null));

export const requestBody = z
  .object({
    type: z.enum(LEAD_REQUEST_TYPES as [string, ...string[]]),
    name: z.string().trim().min(2).max(200),
    email: z.string().trim().max(320).email(),
    phone: z
      .string()
      .trim()
      .max(40)
      .regex(/^[+\d][\d\s().-]{6,}$/)
      .nullish()
      .or(z.literal(""))
      .transform((v) => (v ? v : null)),
    company: z.string().trim().min(1).max(200),
    sector: optText(100),
    message: optText(2000),
    configuration: z
      .object({
        plan: catalogId.nullable(),
        extensions: z.array(catalogId).max(20),
        industries: z.array(catalogId).max(20),
        interests: z.array(catalogId).max(20),
      })
      .strict()
      .nullish()
      .transform((v) => v ?? null),
    interest: catalogId.nullish().transform((v) => v ?? null),
    preferredTime: optText(200),
    sourcePage: z
      .string()
      .max(200)
      .regex(/^\/[^\s]*$/)
      .nullish()
      .transform((v) => v ?? null),
    utm: z
      .object({ source: z.string().max(100), medium: z.string().max(100), campaign: z.string().max(100), term: z.string().max(100), content: z.string().max(100) })
      .partial()
      .strict()
      .nullish()
      .transform((v) => v ?? null),
    consents: z.object({ privacy: z.literal(true), marketing: z.boolean() }).strict(),
    privacyVersion: z.string().regex(PRIVACY_VERSION),
    ticket: z.string().min(10).max(200),
    /** Campo trampa: invisible para personas; si llega relleno, es un robot. */
    website: z.string().max(500).optional(),
  })
  .strict()
  .superRefine((b, ctx) => {
    if ((b.type === "extension_info" || b.type === "module_info") && !b.interest) ctx.addIssue({ code: "custom", path: ["interest"], message: "required" });
    if (b.type === "configuration" && !b.configuration) ctx.addIssue({ code: "custom", path: ["configuration"], message: "required" });
  });

// ── Tickets de formulario ─────────────────────────────────────────────────────

export function issueTicket(secret: string, now: number): string {
  const payload = `v1.${now.toString(36)}.${crypto.randomBytes(12).toString("base64url")}`;
  return `${payload}.${crypto.createHmac("sha256", secret).update(payload).digest("base64url")}`;
}

type TicketCheck = { ok: true; nonce: string; expiresAt: number } | { ok: false; reason: "invalid" | "expired" | "too_fast" };
export function checkTicket(secret: string, ticket: string, now: number, minFillMs: number, maxAgeMs: number): TicketCheck {
  const parts = ticket.split(".");
  if (parts.length !== 4 || parts[0] !== "v1") return { ok: false, reason: "invalid" };
  const payload = parts.slice(0, 3).join(".");
  const expected = crypto.createHmac("sha256", secret).update(payload).digest();
  const given = Buffer.from(parts[3], "base64url");
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return { ok: false, reason: "invalid" };
  const issued = parseInt(parts[1], 36);
  if (!Number.isFinite(issued)) return { ok: false, reason: "invalid" };
  const age = now - issued;
  if (age < minFillMs) return { ok: false, reason: "too_fast" };
  if (age > maxAgeMs) return { ok: false, reason: "expired" };
  return { ok: true, nonce: parts[2], expiresAt: issued + maxAgeMs };
}

// ── Router ────────────────────────────────────────────────────────────────────

const TRANSIENT = new Set(["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "PROTOCOL_CONNECTION_LOST", "ER_CON_COUNT_ERROR", "ER_LOCK_WAIT_TIMEOUT", "ER_LOCK_DEADLOCK"]);

export function createPublicIntakeRouter(cfg: PublicIntakeConfig): Router {
  if (cfg.secret.length < 32) throw new Error("El secreto de la API pública debe tener al menos 32 caracteres");
  const now = cfg.now ?? Date.now;
  const minFill = cfg.minFillMs ?? 3000;
  const maxAge = cfg.maxTicketAgeMs ?? 2 * 60 * 60 * 1000;
  const audit = cfg.audit ?? ((e) => console.log(JSON.stringify({ ctx: "PublicIntake", ...e })));
  const usedNonces = new Map<string, number>();
  const perEmail = new Map<string, number[]>();
  const ipHash = (req: Request) => crypto.createHmac("sha256", cfg.secret).update(`ip:${req.ip ?? ""}`).digest("hex");

  const r = express.Router();

  // Solo desde la web autorizada: sin Origin (o con otro) no hay servicio
  r.use((req, res, next) => {
    const o = req.headers.origin;
    if (typeof o !== "string" || !cfg.origins.has(o)) {
      audit({ event: "rejected", reason: "origin", path: req.path });
      return void res.status(403).json({ error: "origin_not_allowed" });
    }
    next();
  });

  const limited = (limit: number, name: string) =>
    rateLimit({
      windowMs: 10 * 60_000,
      limit,
      standardHeaders: true,
      legacyHeaders: false,
      keyGenerator: (req) => `${name}:${ipKeyGenerator(req.ip ?? "")}`,
      handler: (req, res, _next, opts) => {
        audit({ event: "rejected", reason: "rate_ip", path: req.path, ip: ipHash(req).slice(0, 16) });
        res.setHeader("Retry-After", String(Math.ceil(opts.windowMs / 1000)));
        res.status(429).json({ error: "rate_limited", retryAfterSeconds: Math.ceil(opts.windowMs / 1000) });
      },
    });

  r.get("/form-ticket", limited(60, "ticket"), (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json({ ticket: issueTicket(cfg.secret, now()), minFillSeconds: Math.ceil(minFill / 1000), expiresInSeconds: Math.floor(maxAge / 1000) });
  });

  r.post("/requests", limited(cfg.perIp ?? 10, "requests"), async (req: Request, res: Response) => {
    res.setHeader("Cache-Control", "no-store");
    const ip = ipHash(req);
    const reject = (status: number, error: string, reason: string, extra: Record<string, unknown> = {}) => {
      audit({ event: "rejected", reason, ip: ip.slice(0, 16) });
      res.status(status).json({ error, ...extra });
    };
    try {
      if (Number(req.headers["content-length"] ?? 0) > MAX_BODY_BYTES) return reject(413, "payload_too_large", "size");
      const key = String(req.headers["idempotency-key"] ?? "");
      if (!UUID.test(key)) return reject(400, "invalid_request", "idempotency_key", { fields: ["Idempotency-Key"] });
      const parsed = requestBody.safeParse(req.body);
      if (!parsed.success) {
        // Solo los nombres de campo: nunca se devuelven los valores recibidos
        const fields = Array.from(new Set(parsed.error.issues.map((i) => i.path.join(".") || "body")));
        return reject(400, "invalid_request", "validation", { fields });
      }
      const b = parsed.data;
      if (b.website && b.website.trim()) {
        // Respuesta neutra para no enseñar al robot qué falló; no se guarda nada
        audit({ event: "rejected", reason: "honeypot", ip: ip.slice(0, 16) });
        return void res.status(202).json({ status: "received" });
      }
      const t = checkTicket(cfg.secret, b.ticket, now(), minFill, maxAge);
      if (!t.ok) return reject(400, t.reason === "too_fast" ? "too_fast" : "invalid_ticket", `ticket_${t.reason}`);
      for (const [n, exp] of Array.from(usedNonces)) if (exp < now()) usedNonces.delete(n);

      const email = b.email.toLowerCase();
      const hour = (perEmail.get(email) ?? []).filter((x) => now() - x < 60 * 60_000);
      const input: WebRequestInput = {
        type: b.type as LeadRequestType,
        name: b.name,
        email: b.email,
        phone: b.phone,
        company: b.company,
        sector: b.sector,
        message: b.message,
        configuration: b.configuration,
        interest: b.interest,
        preferredTime: b.preferredTime,
        sourcePage: b.sourcePage,
        utm: b.utm as Record<string, string> | null,
        marketingConsent: b.consents.marketing,
        privacyVersion: b.privacyVersion,
      };
      const idempotencyKey = key.toLowerCase();
      // Un ticket ya usado, o un correo que ha agotado su cupo, solo sirven para repetir la MISMA solicitud
      const blocked = usedNonces.has(t.nonce) ? "ticket_reused" : hour.length >= (cfg.perEmailPerHour ?? 5) ? "rate_email" : null;
      let out: Awaited<ReturnType<WebRequestService["receive"]>>;
      if (blocked) {
        const replay = await cfg.service.replayOf(idempotencyKey, input);
        if (!replay) {
          if (blocked === "rate_email") {
            res.setHeader("Retry-After", "3600");
            return reject(429, "rate_limited", "rate_email", { retryAfterSeconds: 3600 });
          }
          return reject(400, "invalid_ticket", "ticket_reused");
        }
        out = { outcome: "replayed", request: replay };
      } else {
        out = await cfg.service.receive(input, { idempotencyKey, ipHash: ip });
      }
      if (out.outcome === "created") {
        usedNonces.set(t.nonce, t.expiresAt);
        perEmail.set(email, [...hour, now()]);
      }
      audit({ event: "accepted", outcome: out.outcome, type: out.request.type, ip: ip.slice(0, 16) });
      res.status(out.outcome === "created" ? 201 : 200).json({
        status: "received",
        reference: out.request.reference,
        type: out.request.type,
        duplicate: out.outcome === "duplicate",
      });
    } catch (e) {
      if (e instanceof CrmError && e.code === "conflict") return reject(409, "idempotency_conflict", "idempotency_conflict");
      const code = (e as { code?: string }).code;
      if (code && TRANSIENT.has(code)) {
        res.setHeader("Retry-After", "30");
        return reject(503, "unavailable", "backend_unavailable", { retryAfterSeconds: 30 });
      }
      audit({ event: "error", error: e instanceof Error ? e.constructor.name : "unknown" });
      res.status(500).json({ error: "internal_error" });
    }
  });

  r.use((_req, res) => void res.status(404).json({ error: "not_found" }));
  return r;
}
