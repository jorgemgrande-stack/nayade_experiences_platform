/**
 * Área de puntos del cliente (Social Token Net · Tokens internos, STN-2) — /mis-puntos, sin cuenta ni contraseña.
 *
 * El Core no tiene portal de clientes finales: el cliente del CRM entra con un ENLACE FIRMADO que recibe por correo
 * (no hay un segundo sistema de usuarios ni sesiones nuevas). Enlace = `<cliente>.<caducidad>.<firma>`, firma
 * HMAC-SHA256 con la clave de sesiones (JWT_SECRET) y el propósito ligado a la empresa: un enlace de A nunca abre el
 * área de B, y caduca a los 30 días. El cliente puede pedir un enlace nuevo con su correo (siempre la misma respuesta,
 * exista o no) y la administración puede enviárselo desde su monedero.
 *
 * Páginas HTML del servidor, sin JavaScript (formularios), como las páginas públicas del Centro de envíos:
 *  - GET  /mis-puntos?t=…            saldo, recompensas, códigos pendientes e historial.
 *  - POST /mis-puntos/canjear?t=…    canjea una recompensa y muestra el código de un solo uso.
 *  - GET  /mis-puntos/enlace         pedir un enlace nuevo; POST lo envía si el correo es de un cliente.
 * Sin la extensión activa o con el programa desactivado, el área no está disponible. Límite de peticiones por IP.
 */
import crypto from "node:crypto";
import express, { type Request, type Response, type Router } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { sql } from "drizzle-orm";
import { getDb } from "./db";
import { sessionSecret } from "./_core/sessionSecret";
import { secureEqual } from "./_core/signedLinks";
import { getTenantIdOrDefault } from "./_core/tenant";
import { publicBaseUrl } from "./_core/productIdentity";
import { brandName } from "./tenantBrand";
import { sendEmail } from "./mailer";
import { buildNoticeHtml } from "./emailTemplates";
import { clientLedger, expireWallet, getProgram, loyaltyLicensed, walletOf, type Actor } from "./loyaltyDb";
import { availableRewards, expireRedemptions, listRedemptions, redeemReward } from "./loyaltyRewardsDb";
import {
  LEDGER_KIND_LABELS,
  OPERATION_KEY_RE,
  PORTAL_LINK_DAYS,
  PORTAL_TOKEN_RE,
  REDEMPTION_STATUS_LABELS,
  equivalenceText,
  formatRedemptionCode,
} from "../shared/loyalty";

// ─── Enlaces firmados ────────────────────────────────────────────────────────

function mac(clientId: number, exp: number): string {
  const key = sessionSecret();
  if (!key) return "";
  return crypto.createHmac("sha256", key).update(`loyalty-portal:${getTenantIdOrDefault()}:${clientId}:${exp}`).digest("base64url").slice(0, 32);
}

export function portalToken(clientId: number, now = Date.now()): string {
  const exp = Math.floor(now / 1000) + PORTAL_LINK_DAYS * 86_400;
  return `${clientId}.${exp}.${mac(clientId, exp)}`;
}

/** Cliente de un enlace con firma válida y sin caducar; si no, null. */
export function verifyPortalToken(token: unknown, now = Date.now()): number | null {
  if (typeof token !== "string") return null;
  const m = PORTAL_TOKEN_RE.exec(token.trim());
  if (!m) return null;
  const clientId = Number(m[1]);
  const exp = Number(m[2]);
  if (exp * 1000 < now) return null;
  const expected = mac(clientId, exp);
  return expected && secureEqual(m[3], expected) ? clientId : null;
}

export function portalUrl(clientId: number): string {
  return `${publicBaseUrl()}/mis-puntos?t=${encodeURIComponent(portalToken(clientId))}`;
}

/** Envía al cliente el enlace a su área de puntos. Devuelve si el correo ha salido. */
export async function sendPortalLink(clientId: number): Promise<boolean> {
  const w = await walletOf(clientId);
  if (!w?.email) return false;
  const program = await getProgram();
  const company = brandName() || "tu tienda";
  return sendEmail({
    to: w.email,
    category: "operational",
    subject: `Tus ${program.pointsName} en ${company}`,
    html: buildNoticeHtml({
      badge: "Fidelización",
      title: `Tus ${program.pointsName}`,
      greetingName: w.name,
      paragraphs: [`Desde este enlace puedes consultar tu saldo de ${program.pointsName} en ${company}, ver las recompensas disponibles y canjearlas.`],
      cta: { label: "Ver mis puntos", url: portalUrl(clientId) },
      note: `El enlace es personal y caduca en ${PORTAL_LINK_DAYS} días. Si no lo has pedido tú, ignora este correo.`,
    }),
    idempotencyKey: `loyalty-portal:${clientId}:${Math.floor(Date.now() / 600_000)}`,
  });
}

// ─── Páginas ─────────────────────────────────────────────────────────────────

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const fmtN = (v: number) => v.toLocaleString("es-ES");
const fmtDate = (ms: number) => new Intl.DateTimeFormat("es-ES", { dateStyle: "medium", timeZone: "Europe/Madrid" }).format(new Date(ms));
const CSS =
  "body{margin:0;background:#f6f7f9;font-family:system-ui,'Segoe UI',Arial,sans-serif;color:#111827}main{max-width:640px;margin:32px auto;padding:0 16px}" +
  ".sheet{background:#fff;border:1px solid #e5e7eb;border-radius:16px;padding:24px 26px;margin-bottom:16px}h1{font-size:24px;margin:0 0 8px}h2{font-size:18px;margin:0 0 12px}" +
  "p{font-size:15px;line-height:23px;color:#374151;margin:0 0 10px}.big{font-size:40px;font-weight:700;margin:4px 0}.muted{color:#6b7280;font-size:13px}" +
  "ul{list-style:none;padding:0;margin:0}li{border-top:1px solid #f0f0f2;padding:12px 0;display:flex;justify-content:space-between;gap:12px;align-items:center}li:first-child{border-top:0}" +
  "button{background:#111827;color:#fff;border:0;border-radius:10px;padding:10px 18px;font-size:14px;font-weight:600;cursor:pointer}button[disabled]{opacity:.45;cursor:not-allowed}" +
  ".code{font-family:ui-monospace,Consolas,monospace;font-size:28px;letter-spacing:3px;font-weight:700;background:#f3f4f6;border-radius:10px;padding:12px 16px;display:inline-block}" +
  "input{border:1px solid #d1d5db;border-radius:10px;padding:10px;font:inherit;width:100%;box-sizing:border-box;margin-bottom:10px}.plus{color:#047857}.minus{color:#b91c1c}footer{text-align:center;color:#9ca3af;font-size:12px;margin:12px 0 40px}";

function page(res: Response, status: number, title: string, body: string) {
  res.status(status);
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
  const company = brandName();
  res.send(
    `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${esc(title)}</title><style>${CSS}</style></head>` +
      `<body><main>${body}<footer>${esc(company)}${company ? " · " : ""}Los puntos son internos de la empresa: no son dinero ni se pueden transferir.</footer></main></body></html>`,
  );
}

const tokenOf = (req: Request) => (typeof req.query.t === "string" ? req.query.t.slice(0, 200) : "");

function linkForm(note = ""): string {
  return `<div class="sheet"><h1>Mis puntos</h1>${note ? `<p>${esc(note)}</p>` : ""}<p>Escribe el correo con el que compras y te enviaremos un enlace para ver tus puntos.</p>` +
    `<form method="post" action="/mis-puntos/enlace"><input type="email" name="email" required maxlength="200" autocomplete="email" placeholder="tu@correo.es"><button type="submit">Enviarme el enlace</button></form></div>`;
}

const unavailable = (res: Response) => page(res, 404, "Mis puntos", `<div class="sheet"><h1>Mis puntos</h1><p>El programa de puntos no está disponible en este momento.</p></div>`);

async function available(write: boolean): Promise<boolean> {
  try {
    if (!(await loyaltyLicensed(write))) return false;
    return (await getProgram()).enabled;
  } catch {
    return false;
  }
}

async function renderArea(res: Response, clientId: number, token: string, notice = "") {
  await expireRedemptions(clientId);
  await expireWallet(clientId);
  const [w, program, rewards, mine, ledger] = await Promise.all([walletOf(clientId), getProgram(), availableRewards(clientId), listRedemptions({ clientId, status: "emitido", limit: 20, offset: 0 }), clientLedger(clientId, 30)]);
  if (!w) return page(res, 404, "Mis puntos", linkForm("Este enlace ya no es válido."));
  const name = program.pointsName;
  const eq = program.eqPoints && program.eqEuros ? { points: program.eqPoints, euros: program.eqEuros } : null;
  const action = `/mis-puntos/canjear?t=${encodeURIComponent(token)}`;
  const rewardsHtml = rewards.length
    ? `<ul>${rewards.map((r) => {
        const can = w.balance >= r.costPoints && r.remaining !== 0;
        const key = crypto.randomBytes(12).toString("hex");
        return `<li><div><strong>${esc(r.name)}</strong>${r.exclusive ? ` <span class="muted">· exclusiva para miembros</span>` : ""}${r.description ? `<div class="muted">${esc(r.description)}</div>` : ""}<div class="muted">${fmtN(r.costPoints)} ${esc(name)}${r.remaining != null ? ` · quedan ${fmtN(r.remaining)}` : ""}</div></div>` +
          `<form method="post" action="${esc(action)}"><input type="hidden" name="reward" value="${r.id}"><input type="hidden" name="key" value="${key}"><button type="submit"${can ? "" : " disabled"}>Canjear</button></form></li>`;
      }).join("")}</ul>`
    : `<p class="muted">Todavía no hay recompensas disponibles.</p>`;
  const codesHtml = mine.items.length
    ? `<div class="sheet"><h2>Códigos pendientes de usar</h2><p class="muted">Enséñalos en el mostrador o en la caja. Cada código vale una sola vez.</p><ul>${mine.items.map((c) => `<li><div><strong>${esc(c.rewardName)}</strong><div class="muted">Válido hasta el ${fmtDate(c.expiresAt)}</div></div><span class="code">${esc(formatRedemptionCode(c.code))}</span></li>`).join("")}</ul></div>`
    : "";
  const historyHtml = ledger.length
    ? `<ul>${ledger.map((l) => `<li><div>${esc(LEDGER_KIND_LABELS[l.kind] ?? l.kind)}${l.reason ? `<div class="muted">${esc(l.reason)}</div>` : ""}<div class="muted">${fmtDate(l.createdAt)}</div></div><strong class="${l.direction === "credit" ? "plus" : "minus"}">${l.direction === "credit" ? "+" : "−"}${fmtN(l.amount)}</strong></li>`).join("")}</ul>`
    : `<p class="muted">Sin movimientos todavía.</p>`;
  page(
    res,
    200,
    "Mis puntos",
    `${notice}<div class="sheet"><h1>Hola, ${esc(w.name)}</h1><p class="muted">Tu saldo</p><div class="big">${fmtN(w.balance)} ${esc(name)}</div>${equivalenceText(Math.max(0, w.balance), eq) ? `<p class="muted">${esc(equivalenceText(Math.max(0, w.balance), eq))}</p>` : ""}</div>` +
      `${codesHtml}<div class="sheet"><h2>Recompensas</h2>${rewardsHtml}</div><div class="sheet"><h2>Últimos movimientos</h2>${historyHtml}</div>`,
  );
}

export function createLoyaltyPortalRouter(): Router {
  const r = express.Router();
  const limiter = rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: true, legacyHeaders: false, keyGenerator: (req) => `ip:${ipKeyGenerator(req.ip ?? "")}` });
  const linkLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 5, standardHeaders: true, legacyHeaders: false, keyGenerator: (req) => `ip:${ipKeyGenerator(req.ip ?? "")}` });
  const form = express.urlencoded({ extended: false, limit: "4kb" });

  r.get("/mis-puntos", limiter, async (req, res) => {
    try {
      if (!(await available(false))) return unavailable(res);
      const token = tokenOf(req);
      const clientId = verifyPortalToken(token);
      if (!clientId) return page(res, token ? 404 : 200, "Mis puntos", linkForm(token ? "Este enlace no es válido o ha caducado." : ""));
      await renderArea(res, clientId, token);
    } catch (e) {
      console.error("[Fidelización] Área de puntos:", (e as Error).message);
      page(res, 500, "Mis puntos", `<div class="sheet"><p>No hemos podido cargar tus puntos. Inténtalo de nuevo en unos minutos.</p></div>`);
    }
  });

  r.post("/mis-puntos/canjear", limiter, form, async (req, res) => {
    const token = tokenOf(req);
    try {
      if (!(await available(true))) return unavailable(res);
      const clientId = verifyPortalToken(token);
      if (!clientId) return page(res, 404, "Mis puntos", linkForm("Este enlace no es válido o ha caducado."));
      const body = (req.body ?? {}) as Record<string, unknown>;
      const rewardId = Number(body.reward);
      const key = String(body.key ?? "");
      if (!Number.isInteger(rewardId) || rewardId <= 0 || !OPERATION_KEY_RE.test(key)) return renderArea(res, clientId, token, `<div class="sheet"><p>No se ha podido canjear: vuelve a intentarlo.</p></div>`);
      const w = await walletOf(clientId);
      const actor: Actor = { id: null, name: w?.name ? `Cliente: ${w.name}` : "Cliente" };
      try {
        const out = await redeemReward({ clientId, rewardId, key: `cliente-${clientId}-${key}`, actor, channel: "cliente" });
        return renderArea(res, clientId, token, `<div class="sheet"><h2>Canje hecho: ${esc(out.rewardName)}</h2><p>Enseña este código en el mostrador o en la caja. Vale una sola vez, hasta el ${fmtDate(out.expiresAt)}.</p><p><span class="code">${esc(formatRedemptionCode(out.code))}</span></p></div>`);
      } catch (e) {
        return renderArea(res, clientId, token, `<div class="sheet"><p>${esc((e as Error).message || "No se ha podido canjear.")}</p></div>`);
      }
    } catch (e) {
      console.error("[Fidelización] Canje desde el área de puntos:", (e as Error).message);
      page(res, 500, "Mis puntos", `<div class="sheet"><p>No hemos podido completar el canje. Inténtalo de nuevo en unos minutos.</p></div>`);
    }
  });

  r.get("/mis-puntos/enlace", limiter, async (_req, res) => {
    if (!(await available(false))) return unavailable(res);
    page(res, 200, "Mis puntos", linkForm());
  });

  r.post("/mis-puntos/enlace", linkLimiter, form, async (req, res) => {
    try {
      if (!(await available(true))) return unavailable(res);
      const email = String(((req.body ?? {}) as Record<string, unknown>).email ?? "").trim().toLowerCase().slice(0, 200);
      if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        const d = await getDb();
        const [c] = d ? ((await d.execute(sql`SELECT id FROM clients WHERE LOWER(email) = ${email} LIMIT 1`)) as unknown as [Array<{ id: number }>])[0] : [];
        if (c) await sendPortalLink(Number(c.id)).catch((e) => console.error("[Fidelización] Enlace del área de puntos no enviado:", (e as Error).message));
      }
      // Misma respuesta exista o no el correo: no se revela quién es cliente
      page(res, 200, "Mis puntos", `<div class="sheet"><h1>Revisa tu correo</h1><p>Si ese correo es de un cliente, en unos minutos recibirás un enlace para ver tus puntos.</p></div>`);
    } catch (e) {
      console.error("[Fidelización] Petición de enlace:", (e as Error).message);
      page(res, 500, "Mis puntos", `<div class="sheet"><p>No hemos podido enviar el enlace. Inténtalo de nuevo en unos minutos.</p></div>`);
    }
  });

  return r;
}
