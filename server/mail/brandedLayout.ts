/**
 * Maqueta de correo con la marca de la empresa (kit visual): tabla de 600 px, estilos en línea, botón «a prueba de
 * balas» (VML para Outlook), logotipo o nombre en la cabecera, pie con la identidad legal, enlaces de la web y la baja.
 *
 *  - Compatible con Outlook de escritorio, Gmail, Apple Mail y móviles (tablas anidadas, `role="presentation"`,
 *    condicionales `<!--[if mso]>` y un único bloque `<style>` solo para hacer la tarjeta fluida en pantallas estrechas).
 *  - Todo el contenido variable se escapa aquí: quien llama pasa texto plano (párrafos, títulos, etiquetas) y URLs.
 *  - Sin imágenes externas salvo el logotipo de la empresa. Sin la marca de la plataforma: el correo es de la empresa.
 *  - `text`: versión alternativa completa, con las URLs.
 */
import { brandUiText } from "../../shared/brandUiText";
import type { TenantVisualKit } from "../brand/tenantVisualKit";

export const escapeHtml = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export interface BrandedLink {
  label: string;
  url: string;
}

export interface BrandedEmailSpec {
  locale: string;
  subject: string;
  /** Texto oculto que muestran los clientes junto al asunto. */
  preheader?: string;
  /** Antetítulo en mayúsculas pequeñas (p. ej. «Newsletter»). */
  eyebrow?: string;
  title: string;
  /** Párrafos en TEXTO PLANO (se escapan aquí; un salto de línea simple pasa a `<br>`). */
  paragraphs?: string[];
  /** Alternativa a `paragraphs`: HTML ya seguro (escapado por quien llama). */
  html?: string;
  cta?: BrandedLink;
  secondary?: BrandedLink;
  /** Nota bajo el botón (p. ej. «El enlace caduca en 48 horas»). */
  note?: string;
  /** Por qué recibe este correo y otras líneas pequeñas del pie, antes de la identidad legal. */
  footerNotes?: string[];
  unsubscribe?: BrandedLink;
  /** Enlaces del pie (Privacidad · Contacto · Web). Sin ellos, se toman del kit en el idioma del correo. */
  footerLinks?: BrandedLink[];
  /** Texto de ayuda bajo el botón; sin él, el del idioma. */
  linkFallbackText?: string;
  /** Mostrar la ayuda con el enlace en texto bajo el botón (por defecto sí; no hace falta en un botón secundario como «Visitar la web»). */
  showLinkFallback?: boolean;
}

export interface BrandedEmail {
  html: string;
  text: string;
}

const safeUrl = (u: string) => {
  const s = (u ?? "").trim();
  return /^(https?:\/\/|mailto:|tel:)/i.test(s) ? s : "#";
};

/** Enlaces de pie de serie: Privacidad · Contacto · Web, solo los que existen. */
export function defaultFooterLinks(kit: TenantVisualKit, locale: string): BrandedLink[] {
  const t = brandUiText(locale);
  const out: BrandedLink[] = [];
  const privacy = kit.links.privacy(locale);
  const contact = kit.links.contact(locale);
  const imprint = kit.links.imprint(locale);
  if (privacy) out.push({ label: t.privacy, url: privacy });
  if (contact) out.push({ label: t.contact, url: contact });
  if (imprint) out.push({ label: t.imprint, url: imprint });
  const site = kit.links.site(locale);
  if (site) out.push({ label: t.web, url: site });
  return out;
}

function button(label: string, url: string, bg: string, fg: string, font: string): string {
  const u = escapeHtml(safeUrl(url));
  const l = escapeHtml(label);
  return (
    `<!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${u}" style="height:48px;v-text-anchor:middle;width:280px;" arcsize="50%" strokecolor="${bg}" fillcolor="${bg}"><w:anchorlock/><center style="color:${fg};font-family:Arial,sans-serif;font-size:15px;font-weight:bold;">${l}</center></v:roundrect><![endif]-->` +
    `<!--[if !mso]><!-- --><a href="${u}" target="_blank" style="display:inline-block;background-color:${bg};color:${fg};font-family:${font};font-size:15px;font-weight:600;line-height:20px;text-decoration:none;padding:14px 28px;border-radius:999px;mso-padding-alt:0;">${l}</a><!--<![endif]-->`
  );
}

export function renderBrandedEmail(kit: TenantVisualKit, spec: BrandedEmailSpec): BrandedEmail {
  const c = kit.colors;
  const ui = brandUiText(spec.locale);
  const locale = escapeHtml(spec.locale || "es");
  const body = kit.fonts.body;
  const heading = kit.fonts.heading;
  const brand = kit.brandName || kit.legal.name || "";
  const site = kit.links.site(spec.locale);
  const footerLinks = spec.footerLinks ?? defaultFooterLinks(kit, spec.locale);
  const fallbackText = spec.linkFallbackText ?? ui.linkFallback;

  const header = kit.logoUrl
    ? `<a href="${escapeHtml(safeUrl(site))}" target="_blank" style="text-decoration:none;display:inline-block;"><img src="${escapeHtml(kit.logoUrl)}" alt="${escapeHtml(brand)}" height="72" style="display:block;border:0;outline:none;text-decoration:none;height:72px;max-height:72px;width:auto;max-width:260px;margin:0 auto;" /></a>`
    : `<a href="${escapeHtml(safeUrl(site))}" target="_blank" style="text-decoration:none;color:${c.ink};"><span style="font-family:${heading};font-size:22px;letter-spacing:0.08em;text-transform:uppercase;color:${c.ink};">${escapeHtml(brand)}</span></a>`;

  const paragraphsHtml =
    spec.html ??
    (spec.paragraphs ?? [])
      .flatMap((p) => String(p ?? "").replace(/\r\n/g, "\n").split(/\n{2,}/))
      .map((p) => p.trim())
      .filter(Boolean)
      .map((p) => `<p style="margin:0 0 16px;font-family:${body};font-size:16px;line-height:1.6;color:${c.ink};">${escapeHtml(p).replace(/\n/g, "<br />")}</p>`)
      .join("");

  const ctaHtml = spec.cta
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:28px auto 0;"><tr><td align="center" style="padding:0;">${button(spec.cta.label, spec.cta.url, c.primary, c.buttonText, body)}</td></tr></table>` +
      (spec.note ? `<p style="margin:14px 0 0;font-family:${body};font-size:13px;line-height:1.5;color:${c.muted};text-align:center;">${escapeHtml(spec.note)}</p>` : "") +
      (spec.showLinkFallback === false
        ? ""
        : `<p style="margin:18px 0 0;font-family:${body};font-size:12px;line-height:1.5;color:${c.muted};text-align:center;">${escapeHtml(fallbackText)}<br /><a href="${escapeHtml(safeUrl(spec.cta.url))}" style="color:${c.muted};text-decoration:underline;word-break:break-all;">${escapeHtml(spec.cta.url)}</a></p>`)
    : spec.note
      ? `<p style="margin:14px 0 0;font-family:${body};font-size:13px;line-height:1.5;color:${c.muted};">${escapeHtml(spec.note)}</p>`
      : "";

  const secondaryHtml = spec.secondary
    ? `<p style="margin:22px 0 0;font-family:${body};font-size:14px;line-height:1.5;text-align:center;"><a href="${escapeHtml(safeUrl(spec.secondary.url))}" target="_blank" style="color:${c.primary};text-decoration:underline;font-weight:600;">${escapeHtml(spec.secondary.label)}</a></p>`
    : "";

  const small = (inner: string, extra = "") => `<p style="margin:0 0 6px;font-family:${body};font-size:12px;line-height:18px;color:${c.muted};${extra}">${inner}</p>`;
  const footer = [
    ...(spec.footerNotes ?? []).filter(Boolean).map((n) => small(escapeHtml(n))),
    kit.legal.line ? small(escapeHtml(kit.legal.line)) : "",
    footerLinks.length ? small(footerLinks.map((l) => `<a href="${escapeHtml(safeUrl(l.url))}" target="_blank" style="color:${c.muted};text-decoration:underline;">${escapeHtml(l.label)}</a>`).join(" &nbsp;·&nbsp; ")) : "",
    spec.unsubscribe ? small(`<a href="${escapeHtml(safeUrl(spec.unsubscribe.url))}" target="_blank" style="color:${c.muted};text-decoration:underline;">${escapeHtml(spec.unsubscribe.label)}</a>`, "margin:10px 0 0;") : "",
  ].join("");

  const html =
    `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">` +
    `<html lang="${locale}" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office"><head>` +
    `<meta charset="utf-8" /><meta http-equiv="Content-Type" content="text/html; charset=utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><meta name="x-apple-disable-message-reformatting" /><meta name="color-scheme" content="light" />` +
    `<!--[if mso]><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml><![endif]-->` +
    `<title>${escapeHtml(spec.subject)}</title>` +
    `<style>@media only screen and (max-width:620px){.be-card{width:100% !important;max-width:100% !important;}.be-pad{padding-left:20px !important;padding-right:20px !important;}.be-outer{padding:12px 8px !important;}}</style>` +
    `</head><body style="margin:0;padding:0;background-color:${c.background};-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">` +
    (spec.preheader ? `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${c.background};">${escapeHtml(spec.preheader)}</div>` : "") +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${c.background};"><tr><td align="center" class="be-outer" style="padding:32px 12px;">` +
    `<!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" align="center"><tr><td><![endif]-->` +
    `<table role="presentation" class="be-card" width="600" cellpadding="0" cellspacing="0" border="0" align="center" style="width:600px;max-width:600px;background-color:${c.surface};border:1px solid ${c.border};border-radius:16px;">` +
    `<tr><td align="center" class="be-pad" style="padding:32px 40px 8px;">${header}</td></tr>` +
    `<tr><td class="be-pad" style="padding:20px 40px 8px;">` +
    (spec.eyebrow ? `<p style="margin:0 0 12px;font-family:${body};font-size:12px;letter-spacing:0.16em;text-transform:uppercase;color:${c.accent};font-weight:600;">${escapeHtml(spec.eyebrow)}</p>` : "") +
    `<h1 style="margin:0 0 20px;font-family:${heading};font-size:27px;line-height:1.25;font-weight:normal;color:${c.ink};">${escapeHtml(spec.title)}</h1>` +
    `${paragraphsHtml}${ctaHtml}${secondaryHtml}</td></tr>` +
    `<tr><td class="be-pad" style="padding:28px 40px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="border-top:1px solid ${c.border};font-size:0;line-height:0;">&nbsp;</td></tr></table></td></tr>` +
    `<tr><td class="be-pad" style="padding:16px 40px 32px;">${footer}</td></tr>` +
    `</table>` +
    `<!--[if mso]></td></tr></table><![endif]-->` +
    `</td></tr></table></body></html>`;

  const textParts: string[] = [];
  if (brand) textParts.push(brand, "");
  if (spec.eyebrow) textParts.push(spec.eyebrow.toUpperCase());
  textParts.push(spec.title, "");
  if (spec.paragraphs?.length) textParts.push(spec.paragraphs.join("\n\n").trim(), "");
  if (spec.cta) textParts.push(`${spec.cta.label}: ${spec.cta.url}`);
  if (spec.note) textParts.push(spec.note);
  if (spec.secondary) textParts.push(`${spec.secondary.label}: ${spec.secondary.url}`);
  textParts.push("", "--");
  for (const n of spec.footerNotes ?? []) if (n) textParts.push(n);
  if (kit.legal.line) textParts.push(kit.legal.line);
  for (const l of footerLinks) textParts.push(`${l.label}: ${l.url}`);
  if (spec.unsubscribe) textParts.push(`${spec.unsubscribe.label}: ${spec.unsubscribe.url}`);
  const text = textParts.join("\n").replace(/\n{3,}/g, "\n\n").trim();

  return { html, text };
}
