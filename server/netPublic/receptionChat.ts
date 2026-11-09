/**
 * Elephant Reception AI · chat público de la web de la empresa: `/recepcion/<clave>` (capacidad `reception-ai`).
 * Página HTML del servidor con formularios y sin JavaScript, como el resto de server/netPublic: no pasa por /api/trpc
 * ni cambia la lista blanca de server/authGuard.ts. Se enlaza desde la web de la empresa con un botón o un enlace
 * (las páginas públicas no se dejan incrustar en marcos: `frame-ancestors 'none'`).
 *
 *  - La clave del enlace es una firma de la empresa y de su versión (regenerarla en el panel invalida la anterior).
 *  - Cada conversación lleva su propio identificador aleatorio (`c`, 128 bits) en el formulario y, tras enviar, en la
 *    dirección (sin referer): en la BD solo se guarda su huella.
 *  - Responde la IA central del Core con el conocimiento de la empresa; sin IA, al llegar al máximo diario que elige la
 *    empresa o con la cuota de IA agotada, una respuesta fija que invita a dejar los datos.
 *  - «Déjanos tus datos»: solicitud en el CRM con consentimiento explícito; una por conversación.
 *  - Antiabuso: los límites por IP del router y como mucho 20 mensajes del cliente por conversación.
 */
import crypto from "node:crypto";
import type { Request, Response } from "express";
import { esc, failure, invalidLink, notice, page, unavailable } from "./html";
import { RECEPTION_LIMITS, type ReceptionSettings } from "../../shared/receptionAi";
import { CHAT_KEY_RE, receptionLicensed, receptionService } from "../receptionAi/runtime";
import { ReceptionError, type ChatView, type ReceptionService } from "../receptionAi/service";
import { ReceptionNotInstalled } from "../receptionAi/store";

export const CONVERSATION_RE = /^[a-f0-9]{32}$/;
const TITLE = "Recepción";

export interface ReceptionChatDeps {
  service: () => ReceptionService;
  licensed: (write: boolean) => Promise<boolean>;
}
const defaultDeps: ReceptionChatDeps = { service: receptionService, licensed: receptionLicensed };

const CHAT_CSS =
  "<style>.msgs{display:flex;flex-direction:column;gap:8px}.msg{max-width:85%;padding:10px 12px;border-radius:14px;font-size:15px;line-height:21px;white-space:pre-wrap;overflow-wrap:anywhere}" +
  ".msg.a{background:#f3f4f6;align-self:flex-start}.msg.u{background:#111827;color:#fff;align-self:flex-end}.who{font-size:12px;color:#6b7280;margin:0 0 2px}</style>";

const bodyOf = (req: Request): Record<string, unknown> => (req.body && typeof req.body === "object" ? (req.body as Record<string, unknown>) : {});
const field = (b: Record<string, unknown>, k: string) => (typeof b[k] === "string" ? (b[k] as string) : "");
const newConversation = () => crypto.randomBytes(16).toString("hex");

function chatPage(res: Response, status: number, v: ChatView, conv: string, msg = "", values: Record<string, string> = {}) {
  const bubbles = [{ role: "assistant" as const, content: v.greeting }, ...v.messages]
    .map((m) => `<div class="msg ${m.role === "user" ? "u" : "a"}">${esc(m.content)}</div>`)
    .join("");
  const human = v.phone
    ? `<p>Ahora el equipo está atendiendo: puedes llamar al <a href="tel:${esc(v.phone)}">${esc(v.phone)}</a>.</p>`
    : v.humanHours
      ? `<p class="muted">Horario de atención del equipo: ${esc(v.humanHours)}.</p>`
      : "";
  const ask =
    v.turnsLeft > 0
      ? `<form method="post"><input type="hidden" name="a" value="msg"><input type="hidden" name="c" value="${esc(conv)}">` +
        `<label for="m">Tu mensaje</label><textarea id="m" name="m" rows="3" maxlength="${RECEPTION_LIMITS.chatMessageMax}" required></textarea><p></p><button type="submit">Enviar</button></form>`
      : `<p>Hemos llegado al máximo de mensajes de esta conversación.${v.canLeaveData && !v.leadDone ? " Déjanos tus datos y el equipo te contestará." : ""}</p>`;
  let lead = "";
  if (v.leadDone) lead = `<div class="sheet"><h2>Tus datos</h2><p class="ok">Ya tenemos tu solicitud: el equipo de ${esc(v.companyName)} te contactará.</p></div>`;
  else if (v.canLeaveData) {
    const opts = [v.allowInfo ? `<option value="info"${values.kind === "callback" ? "" : " selected"}>Quiero información o reservar</option>` : "", v.allowCallback ? `<option value="callback"${values.kind === "callback" ? " selected" : ""}>Quiero que me llaméis</option>` : ""].join("");
    const input = (name: string, label: string, type: string, extra = "") =>
      `<label for="l_${name}">${label}</label><input id="l_${name}" name="${name}" type="${type}" value="${esc(values[name] ?? "")}"${extra}>`;
    lead =
      `<form method="post"><div class="sheet"><h2>Déjanos tus datos</h2><p class="muted">El equipo te contestará personalmente.</p>` +
      `<input type="hidden" name="a" value="lead"><input type="hidden" name="c" value="${esc(conv)}">` +
      `<label for="l_kind">Qué necesitas</label><select id="l_kind" name="kind">${opts}</select>` +
      input("name", "Nombre", "text", ' maxlength="160" autocomplete="name" required') +
      input("phone", "Teléfono", "tel", ' maxlength="40" autocomplete="tel"') +
      input("email", "Correo electrónico", "email", ' maxlength="190" autocomplete="email"') +
      `<label for="l_note">Comentario (opcional)</label><textarea id="l_note" name="note" rows="2" maxlength="${RECEPTION_LIMITS.noteMax}">${esc(values.note ?? "")}</textarea>` +
      `<label><input type="checkbox" name="consent" value="1" required>Acepto que ${esc(v.companyName)} use estos datos para responder a mi solicitud.</label>` +
      `<p></p><button type="submit">Enviar mis datos</button></div></form>`;
  }
  page(
    res,
    status,
    `${v.companyName} · ${TITLE}`,
    `${CHAT_CSS}${msg}<div class="sheet"><h1>${esc(v.companyName)}</h1><p class="muted">Te atiende ${esc(v.assistantName)}, un asistente con inteligencia artificial que responde con la información de ${esc(v.companyName)}. Puede equivocarse: las reservas y los precios finales los confirma el equipo. Guardamos esta conversación para atender tu consulta.</p>${human}</div>` +
      `<div class="sheet"><div class="msgs">${bubbles}</div><p></p>${ask}</div>${lead}`,
  );
}

type Gate = { svc: ReceptionService; settings: ReceptionSettings; key: string } | "unavailable" | "invalid";

async function gate(req: Request, deps: ReceptionChatDeps): Promise<Gate> {
  if (!(await deps.licensed(true))) return "unavailable";
  const key = String(req.params.token ?? "").slice(0, 64);
  if (!CHAT_KEY_RE.test(key)) return "invalid";
  const svc = deps.service();
  const settings = await svc.chatGate(key);
  return settings ? { svc, settings, key } : "invalid";
}

function handleError(res: Response, e: unknown, what: string) {
  if (e instanceof ReceptionNotInstalled) return unavailable(res, TITLE);
  console.error(JSON.stringify({ ctx: "ReceptionChat", event: "error", what, error: e instanceof Error ? e.message.slice(0, 200) : "error" }));
  return failure(res, TITLE);
}

export function receptionChatHandlers(deps: ReceptionChatDeps = defaultDeps) {
  async function get(req: Request, res: Response) {
    try {
      const g = await gate(req, deps);
      if (g === "unavailable") return unavailable(res, TITLE);
      if (g === "invalid") return invalidLink(res, TITLE);
      const q = typeof req.query.c === "string" ? req.query.c : "";
      const conv = CONVERSATION_RE.test(q) ? q : newConversation();
      chatPage(res, 200, await g.svc.chatView(g.settings, CONVERSATION_RE.test(q) ? q : null), conv, typeof req.query.ok === "string" ? notice("ok", "Hemos recibido tus datos. El equipo te contactará.") : "");
    } catch (e) {
      handleError(res, e, "recepcion.get");
    }
  }

  async function post(req: Request, res: Response) {
    try {
      const g = await gate(req, deps);
      if (g === "unavailable") return unavailable(res, TITLE);
      if (g === "invalid") return invalidLink(res, TITLE);
      const b = bodyOf(req);
      const conv = field(b, "c");
      if (!CONVERSATION_RE.test(conv)) return chatPage(res, 400, await g.svc.chatView(g.settings, null), newConversation(), notice("err", "La conversación no es válida. Vuelve a escribir tu mensaje."));
      const back = `/recepcion/${g.key}?c=${conv}`;
      if (field(b, "a") === "lead") {
        const values = { kind: field(b, "kind"), name: field(b, "name"), phone: field(b, "phone"), email: field(b, "email"), note: field(b, "note") };
        try {
          await g.svc.chatLead(g.settings, conv, { ...values, kind: values.kind === "callback" ? "callback" : "info", consent: field(b, "consent") === "1" });
        } catch (e) {
          if (e instanceof ReceptionError && e.code === "invalid_input") return chatPage(res, 400, await g.svc.chatView(g.settings, conv), conv, notice("err", e.message), values);
          throw e;
        }
        return res.redirect(303, `${back}&ok=1`);
      }
      const text = field(b, "m");
      if (text.length > RECEPTION_LIMITS.chatMessageMax) return chatPage(res, 400, await g.svc.chatView(g.settings, conv), conv, notice("err", `El mensaje admite como mucho ${RECEPTION_LIMITS.chatMessageMax} caracteres.`));
      try {
        await g.svc.chatSend(g.settings, conv, text);
      } catch (e) {
        if (e instanceof ReceptionError && e.code === "invalid_input") return chatPage(res, 400, await g.svc.chatView(g.settings, conv), conv, notice("err", e.message));
        throw e;
      }
      res.redirect(303, back);
    } catch (e) {
      handleError(res, e, "recepcion.post");
    }
  }

  return { get, post };
}
