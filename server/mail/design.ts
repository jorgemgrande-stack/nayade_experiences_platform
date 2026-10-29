/**
 * Sistema de diseño de los correos de Big Elephant (estándar visual aprobado por la dirección, 29/10/2026).
 *
 * Tres familias editoriales con el mismo lenguaje: A · experiencial (bienvenida, onboarding, novedades), B ·
 * transaccional premium (contratos, suscripciones, pagos, facturas) y C · seguridad y servicio (contraseñas,
 * invitaciones, soporte, avisos). Componentes: cabecera con el logotipo oficial, antetítulo, título, ilustración,
 * tarjetas de datos con estado y total, avisos, pasos, línea de progreso, ayuda, consejos, botón «a prueba de
 * clientes» y pie corporativo. Siempre con versión de texto plano equivalente.
 *
 * Compatibilidad: maquetación con tablas y estilos en línea (Outlook de escritorio, Gmail, Apple Mail, móviles),
 * 600 px de ancho, imágenes con dimensiones y texto alternativo, enlaces https absolutos. Se lee igual con las
 * imágenes bloqueadas (ninguna información va solo en una imagen). Todo valor variable se escapa.
 *
 * Marca: el logotipo es el OFICIAL, sin alterar; las ilustraciones son derivadas del anagrama (silueta intacta).
 * Los avisos de una EMPRESA (sin logotipo de plataforma) usan el modo neutro: su nombre, sin ilustraciones ni el
 * pie de Big Elephant.
 */
import type { MailContent } from "./types";

export type Family = "experiential" | "transactional" | "security";
export type Tone = "info" | "success" | "warning" | "error";
export type Hero =
  | "bienvenida" | "contrato" | "seguridad" | "pago" | "calendario" | "aviso" | "exito" | "soporte" | "novedades" | "modulos" | "dominio" | "datos" | "equipo";
export type IconName = "info" | "escudo" | "ayuda" | "empresa" | "equipo" | "grafico" | "calendario" | "check" | "alerta";

export type Block =
  | { p: string }
  | { h2: string }
  | { card: { rows: Array<{ label: string; value: string }>; status?: { label: string; tone: Tone }; total?: { label: string; value: string }; foot?: { label: string; value: string } } }
  | { notice: { tone: Tone; text: string } }
  | { steps: Array<{ title: string; text: string; icon?: IconName; url?: string }> }
  | { timeline: Array<{ label: string; date?: string; state: "done" | "current" | "todo" }> }
  | { help: { title: string; text: string; link?: { label: string; url: string } } }
  | { tip: { icon: IconName; title: string; text: string; link?: { label: string; url: string } } }
  | { button: { label: string; url: string } };

export interface EmailBrand {
  /** Nombre que firma el correo (Big Elephant o la empresa). */
  name: string;
  supportEmail?: string | null;
  /** Logotipo de plataforma (https). Sin él: modo neutro de empresa. */
  logoUrl?: string | null;
  legal?: string | null;
}

export interface EmailSpec {
  family: Family;
  /** Antetítulo en mayúsculas (rojo), p. ej. «CONFIRMACIÓN DE CONTRATACIÓN». */
  eyebrow?: string;
  title: string;
  /** Parte del título en rojo, en una segunda línea (familia A). */
  titleAccent?: string;
  hero?: Hero;
  greeting?: string;
  intro?: string[];
  blocks?: Block[];
  cta?: { label: string; url: string } | null;
  /** Texto de la bandeja de entrada (por defecto, el primer párrafo). */
  preheader?: string;
  /** Asunto (por defecto, el título). */
  subject?: string;
  /** Comunicación comercial: añade la baja en el pie. Las de servicio no llevan nada comercial. */
  commercial?: boolean;
}

/** Paleta del estándar aprobado. */
export const T = {
  red: "#FF3131", redDark: "#D91F26", redSoft: "#FFF1F0", redLine: "#FFD9D6",
  ink: "#111827", text: "#374151", muted: "#6B7280", line: "#ECECEF", surface: "#F7F7F9", white: "#FFFFFF",
  navy: "#141A26", navyText: "#C9CED8", blue: "#2F6FE4", blueSoft: "#EAF2FF", green: "#1F9D55", greenSoft: "#E8F6EE", amber: "#B45309", amberSoft: "#FFF4E5",
};
const FONT = "'Segoe UI',-apple-system,BlinkMacSystemFont,Roboto,Helvetica,Arial,sans-serif";
const F = `font-family:${FONT}`;
const TONE: Record<Tone, { fg: string; bg: string; line: string; icon: IconName }> = {
  info: { fg: T.blue, bg: T.blueSoft, line: "#D6E4FF", icon: "info" },
  success: { fg: T.green, bg: T.greenSoft, line: "#CDEBD9", icon: "check" },
  warning: { fg: T.amber, bg: T.amberSoft, line: "#FBE1BF", icon: "alerta" },
  error: { fg: T.redDark, bg: T.redSoft, line: T.redLine, icon: "alerta" },
};

/** Datos corporativos del pie (una sola fuente; las plantillas los heredan). */
export const CORPORATE = {
  name: "BIG ELEPHANT",
  legalName: "IRON ELEPHANT CONSULTING, S.L.",
  taxId: "B26987875",
  address: "Calle Corazón de María, 57, 1.º D · 28002 Madrid",
  supportEmail: "soporte@bigelephant.es",
  web: "https://www.bigelephant.es",
  tagline: ["Tu negocio,", "más lejos."],
  links: [
    { label: "Centro de ayuda", path: "/soporte" },
    { label: "Política de privacidad", path: "/politica-de-privacidad" },
    { label: "Términos del servicio", path: "/terminos-y-condiciones" },
  ],
};

const esc = (s: string) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Solo https (o http a la propia máquina en desarrollo). */
export function safeUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.protocol === "https:" || (u.protocol === "http:" && /^(localhost|127\.0\.0\.1)$/.test(u.hostname))) return u.toString();
  } catch {
    /* no válida */
  }
  return null;
}

/**
 * Base pública de los recursos gráficos (`MAIL_ASSET_BASE`, https). Por defecto, la web del entorno: la de live en
 * live y www.bigelephant.es en el resto (production).
 */
export function assetBase(env: Record<string, string | undefined> = process.env): string {
  const raw = (env.MAIL_ASSET_BASE ?? "").trim().replace(/\/+$/, "");
  if (raw && safeUrl(raw)) return raw;
  return env.RAILWAY_ENVIRONMENT_NAME === "live" ? "https://elephant-source-web-live.up.railway.app/brand/mail" : "https://www.bigelephant.es/brand/mail";
}
const asset = (name: string) => `${assetBase()}/${name}.png`;

const ALT: Record<Hero, string> = {
  bienvenida: "Elefante de Big Elephant trabajando con un portátil",
  contrato: "Elefante de Big Elephant junto a un contrato firmado",
  seguridad: "Elefante de Big Elephant con un candado",
  pago: "Elefante de Big Elephant con una factura y una tarjeta",
  calendario: "Elefante de Big Elephant junto a un calendario",
  aviso: "Elefante de Big Elephant con una señal de aviso",
  exito: "Elefante de Big Elephant con una marca de confirmación",
  soporte: "Elefante de Big Elephant conversando con el equipo de soporte",
  novedades: "Elefante de Big Elephant con un megáfono",
  modulos: "Elefante de Big Elephant con piezas que encajan",
  dominio: "Elefante de Big Elephant junto a un globo terráqueo",
  datos: "Elefante de Big Elephant con una descarga",
  equipo: "Elefante de Big Elephant con una campana de aviso",
};

// ── Componentes ──────────────────────────────────────────────────────────────

function button(label: string, url: string, align: "left" | "center" = "left"): string {
  const link = safeUrl(url);
  if (!link) return "";
  const a = `<a href="${esc(link)}" target="_blank" style="display:inline-block;${F};font-size:15px;font-weight:600;line-height:20px;color:#ffffff;text-decoration:none;padding:14px 30px;border-radius:999px">${esc(label)}&nbsp;&rarr;</a>`;
  // Outlook de escritorio: botón VML redondeado; el resto, la celda con fondo (el relleno va en la celda y en el enlace)
  const vml = `<!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" href="${esc(link)}" style="height:48px;v-text-anchor:middle;width:${Math.max(200, label.length * 9 + 70)}px" arcsize="50%" stroke="f" fillcolor="${T.red}"><center style="color:#ffffff;font-family:Segoe UI,Arial,sans-serif;font-size:15px;font-weight:bold">${esc(label)} &rarr;</center></v:roundrect><![endif]-->`;
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="${align}" style="margin:22px ${align === "center" ? "auto" : "0"} 6px"><tr><td>${vml}<!--[if !mso]><!--><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="${T.red}" style="border-radius:999px;background:${T.red};box-shadow:0 6px 16px rgba(255,49,49,.28)">${a}</td></tr></table><!--<![endif]--></td></tr></table>`;
}

function icon(name: IconName, size = 40): string {
  return `<img src="${esc(asset(`icono-${name}`))}" width="${size}" height="${size}" alt="" style="display:block;border:0;width:${size}px;height:${size}px">`;
}

function pill(label: string, tone: Tone): string {
  const t = TONE[tone];
  return `<span style="display:inline-block;${F};font-size:12px;font-weight:600;line-height:16px;color:${t.fg};background:${t.bg};border:1px solid ${t.line};border-radius:999px;padding:3px 10px;white-space:nowrap">${esc(label)}</span>`;
}

function card(c: Extract<Block, { card: unknown }>["card"]): string {
  const row = (label: string, value: string, last = false) =>
    `<tr><td style="padding:11px 18px;${F};font-size:14px;line-height:20px;color:${T.muted};border-bottom:${last ? "0" : `1px solid ${T.line}`}">${esc(label)}</td><td align="right" style="padding:11px 18px;${F};font-size:14px;line-height:20px;color:${T.ink};text-align:right;border-bottom:${last ? "0" : `1px solid ${T.line}`}">${esc(value)}</td></tr>`;
  const head = c.status ? `<tr><td style="padding:12px 18px;${F};font-size:13px;color:${T.muted};border-bottom:1px solid ${T.line}">Estado</td><td align="right" style="padding:12px 18px;text-align:right;border-bottom:1px solid ${T.line}">${pill(c.status.label, c.status.tone)}</td></tr>` : "";
  const rows = c.rows.map((r, i) => row(r.label, r.value, i === c.rows.length - 1 && !c.total && !c.foot)).join("");
  const total = c.total
    ? `<tr><td bgcolor="${T.redSoft}" style="background:${T.redSoft};padding:15px 18px;${F};font-size:16px;font-weight:700;color:${T.ink}">${esc(c.total.label)}</td><td bgcolor="${T.redSoft}" align="right" style="background:${T.redSoft};padding:15px 18px;${F};font-size:21px;font-weight:800;color:${T.ink};text-align:right;white-space:nowrap">${esc(c.total.value)}</td></tr>`
    : "";
  const foot = c.foot ? `<tr><td style="padding:12px 18px;${F};font-size:13px;color:${T.muted}">${esc(c.foot.label)}</td><td align="right" style="padding:12px 18px;${F};font-size:14px;font-weight:700;color:${T.ink};text-align:right">${esc(c.foot.value)}</td></tr>` : "";
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:18px 0;border:1px solid ${T.line};border-radius:12px;border-collapse:separate;overflow:hidden;background:${T.surface}">${head}${rows}${total}${foot}</table>`;
}

function notice(n: { tone: Tone; text: string }): string {
  const t = TONE[n.tone];
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:16px 0"><tr><td width="36" valign="top" style="padding:2px 12px 0 0">${icon(t.icon, 28)}</td><td style="${F};font-size:13px;line-height:20px;color:${T.text}">${esc(n.text)}</td></tr></table>`;
}

function steps(list: Extract<Block, { steps: unknown }>["steps"]): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:14px 0">${list
    .map((s, i) => {
      const n = `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td width="30" height="30" align="center" bgcolor="${i === 0 ? T.red : "#C9CCD3"}" style="width:30px;height:30px;border-radius:15px;background:${i === 0 ? T.red : "#C9CCD3"};${F};font-size:13px;font-weight:700;color:#ffffff;line-height:30px">${i + 1}</td></tr></table>`;
      const link = s.url ? safeUrl(s.url) : null;
      const title = link ? `<a href="${esc(link)}" style="color:${T.ink};text-decoration:none">${esc(s.title)}</a>` : esc(s.title);
      return `<tr><td width="42" valign="middle" style="padding:12px 0">${n}</td>${s.icon ? `<td width="56" valign="middle" style="padding:12px 12px 12px 0">${icon(s.icon, 44)}</td>` : ""}<td valign="middle" style="padding:12px 0;border-bottom:${i === list.length - 1 ? "0" : `1px solid ${T.line}`}"><div style="${F};font-size:15px;font-weight:700;line-height:20px;color:${T.ink}">${title}</div><div style="${F};font-size:13px;line-height:19px;color:${T.muted};margin-top:2px">${esc(s.text)}</div></td></tr>`;
    })
    .join("")}</table>`;
}

function timeline(list: Extract<Block, { timeline: unknown }>["timeline"]): string {
  const w = Math.floor(100 / list.length);
  const dot = (s: "done" | "current" | "todo") =>
    s === "todo"
      ? `<td width="26" height="26" style="width:26px;height:26px;border:2px solid #C9CCD3;border-radius:15px;background:#ffffff">&nbsp;</td>`
      : `<td width="30" height="30" align="center" bgcolor="${T.red}" style="width:30px;height:30px;border-radius:15px;background:${T.red};${F};font-size:15px;font-weight:700;color:#ffffff;line-height:30px">${s === "done" ? "&#10003;" : "&#9679;"}</td>`;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:16px 0 8px;border-top:2px solid ${T.line}"><tr>${list
    .map(
      (s) =>
        `<td width="${w}%" align="center" valign="top" style="padding:0 4px"><table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:-16px auto 8px"><tr>${dot(s.state)}</tr></table><div style="${F};font-size:13px;font-weight:700;line-height:17px;color:${T.ink}">${esc(s.label)}</div>${s.date ? `<div style="${F};font-size:12px;line-height:16px;color:${s.state === "current" ? T.red : T.muted};margin-top:3px">${esc(s.date)}</div>` : ""}</td>`,
    )
    .join("")}</tr></table>`;
}

function softBox(iconName: IconName, title: string, text: string, link?: { label: string; url: string }): string {
  const url = link ? safeUrl(link.url) : null;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:22px 0 4px;background:${T.redSoft};border-radius:14px"><tr><td width="64" valign="top" style="padding:20px 0 20px 20px">${icon(iconName, 44)}</td><td valign="top" style="padding:20px 22px 20px 14px"><div style="${F};font-size:15px;font-weight:700;line-height:20px;color:${T.ink}">${esc(title)}</div><div style="${F};font-size:13px;line-height:20px;color:${T.text};margin-top:4px">${esc(text)}</div>${url ? `<div style="margin-top:8px"><a href="${esc(url)}" style="${F};font-size:13px;font-weight:600;color:${T.blue};text-decoration:underline">${esc(link!.label)} &rarr;</a></div>` : ""}</td></tr></table>`;
}

function block(b: Block): string {
  if ("p" in b) return `<p style="margin:0 0 14px;${F};font-size:15px;line-height:24px;color:${T.text}">${esc(b.p)}</p>`;
  if ("h2" in b) return `<h2 style="margin:26px 0 6px;${F};font-size:18px;font-weight:700;line-height:24px;color:${T.ink}">${esc(b.h2)}</h2>`;
  if ("card" in b) return card(b.card);
  if ("notice" in b) return notice(b.notice);
  if ("steps" in b) return steps(b.steps);
  if ("timeline" in b) return timeline(b.timeline);
  if ("help" in b) return softBox("ayuda", b.help.title, b.help.text, b.help.link);
  if ("tip" in b) return softBox(b.tip.icon, b.tip.title, b.tip.text, b.tip.link);
  if ("button" in b) {
    const link = safeUrl(b.button.url);
    return link ? button(b.button.label, link, "center") + `<p style="margin:10px 0 4px;${F};font-size:12px;line-height:18px;color:${T.muted};text-align:center">Si el botón no funciona, copia esta dirección en el navegador:<br><span style="word-break:break-all;color:${T.text}">${esc(link)}</span></p>` : "";
  }
  return "";
}

/** Versión de texto plano de un bloque (misma información que el HTML). */
function blockText(b: Block): string[] {
  if ("p" in b) return [b.p, ""];
  if ("h2" in b) return [b.h2.toUpperCase(), ""];
  if ("card" in b) return [...(b.card.status ? [`Estado: ${b.card.status.label}`] : []), ...b.card.rows.map((r) => `${r.label}: ${r.value}`), ...(b.card.total ? [`${b.card.total.label}: ${b.card.total.value}`] : []), ...(b.card.foot ? [`${b.card.foot.label}: ${b.card.foot.value}`] : []), ""];
  if ("notice" in b) return [b.notice.text, ""];
  if ("steps" in b) return [...b.steps.map((s, i) => `${i + 1}. ${s.title}: ${s.text}${s.url ? ` (${s.url})` : ""}`), ""];
  if ("timeline" in b) return [...b.timeline.map((s) => `${s.state === "done" ? "[x]" : s.state === "current" ? "[>]" : "[ ]"} ${s.label}${s.date ? ` · ${s.date}` : ""}`), ""];
  if ("help" in b) return [`${b.help.title}: ${b.help.text}${b.help.link ? ` ${b.help.link.label}: ${b.help.link.url}` : ""}`, ""];
  if ("tip" in b) return [`${b.tip.title}: ${b.tip.text}${b.tip.link ? ` ${b.tip.link.label}: ${b.tip.link.url}` : ""}`, ""];
  if ("button" in b) return [`${b.button.label}: ${b.button.url}`, ""];
  return [];
}

// ── Composición ──────────────────────────────────────────────────────────────

/** Correo completo con el estándar visual. Plataforma (con logotipo) o empresa (modo neutro). */
export function renderEmail(brand: EmailBrand, s: EmailSpec): MailContent & { text: string } {
  const platform = !!safeUrl(brand.logoUrl);
  const intro = s.intro ?? [];
  const blocks = s.blocks ?? [];
  const cta = s.cta && safeUrl(s.cta.url) ? s.cta : null;
  const firstText = intro[0] ?? (blocks.find((b) => "p" in b) as { p: string } | undefined)?.p ?? s.title;
  const preheader = (s.preheader ?? firstText).slice(0, 140);
  const subject = s.subject ?? s.title;
  const hero = platform && s.hero ? s.hero : null;
  const support = brand.supportEmail ?? (platform ? CORPORATE.supportEmail : null);

  const header = platform
    ? `<tr><td style="padding:26px 34px 20px;border-bottom:${s.family === "experiential" ? "0" : `3px solid ${T.red}`}"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td valign="middle"><img src="${esc(safeUrl(brand.logoUrl)!)}" width="184" height="23" alt="Big Elephant" style="display:block;border:0;width:184px;height:auto;max-width:100%"></td><td align="right" valign="middle" style="${F};font-size:12px;line-height:16px;color:${T.muted}">${CORPORATE.tagline.map(esc).join("<br>")}</td></tr></table></td></tr>`
    : `<tr><td style="padding:24px 34px 18px;border-bottom:3px solid ${T.ink}"><span style="${F};font-size:18px;font-weight:700;color:${T.ink}">${esc(brand.name)}</span></td></tr>`;

  const titleHtml = `${esc(s.title)}${s.titleAccent ? `<br><span style="color:${T.red}">${esc(s.titleAccent)}</span>` : ""}`;
  const heroImg = hero ? `<img src="${esc(asset(`hero-${hero}`))}" width="210" height="168" alt="${esc(ALT[hero])}" class="be-hero" style="display:block;border:0;width:210px;height:auto;max-width:100%">` : "";
  const top =
    `<tr><td class="be-pad" style="padding:30px 34px 6px;${s.family === "experiential" && hero ? `background:${T.redSoft};` : ""}">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>` +
    `<td valign="middle" class="be-col">` +
    (s.eyebrow ? `<div style="${F};font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:${T.red};margin:0 0 10px">${esc(s.eyebrow)}</div>` : "") +
    `<h1 class="be-h1" style="margin:0 0 14px;${F};font-size:28px;font-weight:800;line-height:34px;color:${T.ink}">${titleHtml}</h1>` +
    (s.greeting ? `<p style="margin:0 0 10px;${F};font-size:15px;line-height:22px;color:${T.ink}">${esc(s.greeting)}</p>` : "") +
    intro.map((p) => `<p style="margin:0 0 12px;${F};font-size:15px;line-height:23px;color:${T.text}">${esc(p)}</p>`).join("") +
    (s.family === "experiential" && cta ? button(cta.label, cta.url) : "") +
    `</td>` +
    (heroImg ? `<td width="210" valign="middle" align="right" class="be-col be-heroCell" style="padding-left:12px">${heroImg}</td>` : "") +
    `</tr></table></td></tr>`;

  const body =
    `<tr><td class="be-pad" style="padding:6px 34px 30px">` +
    blocks.map(block).join("") +
    (s.family !== "experiential" && cta ? button(cta.label, cta.url, "center") : "") +
    (cta ? `<p style="margin:14px 0 0;${F};font-size:12px;line-height:18px;color:${T.muted};text-align:center">Si el botón no funciona, copia esta dirección en el navegador:<br><span style="word-break:break-all;color:${T.text}">${esc(safeUrl(cta.url)!)}</span></p>` : "") +
    `</td></tr>`;

  const links = CORPORATE.links.map((l) => `<a href="${CORPORATE.web}${l.path}" style="color:#ffffff;text-decoration:underline">${esc(l.label)}</a>`).join(" &nbsp;·&nbsp; ");
  const unsubscribe = s.commercial ? `<div style="margin-top:8px"><a href="${CORPORATE.web}/soporte" style="color:${T.navyText};text-decoration:underline">Darte de baja de las comunicaciones comerciales</a></div>` : "";
  // Línea legal oficial (titular, NIF y domicilio): la de la marca de plataforma, una sola fuente
  const legal = brand.legal ?? `${CORPORATE.name} es un servicio de ${CORPORATE.legalName} · NIF ${CORPORATE.taxId} · ${CORPORATE.address}`;
  const footer = platform
    ? `<tr><td bgcolor="${T.navy}" style="background:${T.navy};border-radius:0 0 16px 16px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>` +
      `<td width="96" valign="bottom" class="be-footArt" style="padding:0"><img src="${esc(asset("pie-elefante"))}" width="96" height="96" alt="" style="display:block;border:0;width:96px;height:96px;border-radius:0 0 0 16px"></td>` +
      `<td valign="middle" style="padding:22px 26px 22px 14px;${F};font-size:12px;line-height:18px;color:${T.navyText}">` +
      `<div style="font-weight:700;color:#ffffff;letter-spacing:.04em">${CORPORATE.name}</div>` +
      `<div>${esc(legal)}</div>` +
      `<div><span style="color:#ffffff">${esc(support ?? CORPORATE.supportEmail)}</span> &nbsp;·&nbsp; <a href="${CORPORATE.web}" style="color:#ffffff;text-decoration:none">www.bigelephant.es</a></div>` +
      `<div style="margin-top:8px">${links}</div>` +
      `<div style="margin-top:8px;color:#8A93A3">${s.commercial ? "Recibes este correo porque aceptaste recibir novedades de Big Elephant." : "Mensaje de servicio relacionado con tu cuenta. No es publicidad."}</div>` +
      unsubscribe +
      `</td></tr></table></td></tr>`
    : `<tr><td style="padding:18px 34px 24px;border-top:1px solid ${T.line};${F};font-size:12px;line-height:18px;color:${T.muted}">Mensaje automático de ${esc(brand.name)} relacionado con tu cuenta.${support ? ` ¿Dudas? Escríbenos a ${esc(support)}.` : ""}</td></tr>`;

  const html =
    `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="X-UA-Compatible" content="IE=edge">` +
    `<meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><title>${esc(subject)}</title>` +
    `<!--[if mso]><noscript><xml xmlns:o="urn:schemas-microsoft-com:office:office"><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->` +
    `<style>body{margin:0;padding:0}a{color:${T.blue}}@media (max-width:620px){.be-outer{padding:0!important}.be-wrap{border-radius:0!important}.be-pad{padding-left:20px!important;padding-right:20px!important}.be-h1{font-size:24px!important;line-height:30px!important}.be-col{display:block!important;width:100%!important}.be-heroCell{padding:8px 0 0!important;text-align:center!important}.be-hero{margin:0 auto!important;width:180px!important}.be-footArt{display:none!important}}</style></head>` +
    `<body style="margin:0;padding:0;background:${T.surface};-webkit-text-size-adjust:100%">` +
    `<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all">${esc(preheader)}&#8199;&#65279;&#847;&#8199;&#65279;&#847;</div>` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${T.surface}" style="background:${T.surface}"><tr><td align="center" class="be-outer" style="padding:28px 12px">` +
    `<!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="be-wrap" bgcolor="#ffffff" style="max-width:600px;background:#ffffff;border-radius:16px;border:1px solid ${T.line}">` +
    header + top + body + footer +
    `</table><!--[if mso]></td></tr></table><![endif]--></td></tr></table></body></html>`;

  const text = [
    ...(s.eyebrow ? [s.eyebrow.toUpperCase()] : []),
    s.title + (s.titleAccent ? ` ${s.titleAccent}` : ""),
    "",
    ...(s.greeting ? [s.greeting, ""] : []),
    ...intro.flatMap((p) => [p, ""]),
    ...blocks.flatMap(blockText),
    ...(cta ? [`${cta.label}: ${safeUrl(cta.url)}`, ""] : []),
    "—",
    ...(platform
      ? [brand.legal ?? `${CORPORATE.name} es un servicio de ${CORPORATE.legalName} · NIF ${CORPORATE.taxId} · ${CORPORATE.address}`, `${support ?? CORPORATE.supportEmail} · www.bigelephant.es`, ...CORPORATE.links.map((l) => `${l.label}: ${CORPORATE.web}${l.path}`), ...(s.commercial ? [`Baja de comunicaciones comerciales: ${CORPORATE.web}/soporte`] : ["Mensaje de servicio relacionado con tu cuenta. No es publicidad."])]
      : [`Mensaje automático de ${brand.name} relacionado con tu cuenta.${support ? ` ¿Dudas? Escríbenos a ${support}.` : ""}`]),
  ].join("\n");
  return { subject, html, text };
}

/** Formatos españoles comunes. */
export const fmt = {
  date: (ms: number) => new Date(ms).toLocaleDateString("es-ES", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Madrid" }),
  short: (ms: number) => new Date(ms).toLocaleDateString("es-ES", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/Madrid" }),
  money: (cents: number, currency = "EUR") => new Intl.NumberFormat("es-ES", { style: "currency", currency, useGrouping: "always" } as Intl.NumberFormatOptions).format(cents / 100),
};
