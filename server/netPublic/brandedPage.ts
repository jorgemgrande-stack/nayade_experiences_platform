/**
 * Página pública con la marca de la empresa (kit visual): HTML del servidor, sin JavaScript, con un solo mensaje y una
 * acción (botón GET o POST). La usan los enlaces que llegan por correo (confirmar o dar de baja la newsletter) y sus
 * estados (hecho, enlace no válido, caducado, no disponible, demasiadas solicitudes).
 *
 * Cabeceras como `page()` de html.ts (sin caché, sin referer, sin marcos, sin indexar) y CSP que solo permite estilos
 * en línea, el logotipo de la empresa (`img-src 'self'` más su origen) y enviar formularios al propio origen.
 * `page()` sigue tal cual para la carta, el check-in y la firma: este envoltorio es nuevo y no cambia su aspecto.
 */
import type { Response } from "express";
import { brandUiText } from "../../shared/brandUiText";
import type { TenantVisualKit } from "../brand/tenantVisualKit";
import { escapeHtml as esc } from "../mail/brandedLayout";

export type BrandedPageKind = "success" | "info" | "error" | "warning";

export interface BrandedPageSpec {
  locale: string;
  kind: BrandedPageKind;
  title: string;
  text: string;
  cta?: { label: string; url?: string; method?: "GET" | "POST" };
  secondary?: { label: string; url: string };
  /** Enlaces del pie además de los de la web. Sin ellos, Privacidad · Contacto · Aviso legal del kit. */
  links?: Array<{ label: string; url: string }>;
}

const safeHref = (u: string | undefined) => {
  const s = (u ?? "").trim();
  return /^(https?:\/\/|\/(?!\/)|mailto:|tel:)/i.test(s) ? s : "#";
};

function originOf(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/** Icono sutil por estado: círculo fino con marca, i, o signo de exclamación. */
function icon(kind: BrandedPageKind, color: string): string {
  const inner =
    kind === "success"
      ? `<path d="M12 20.5l5 5 11-11" fill="none" stroke="${color}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>`
      : kind === "info"
        ? `<circle cx="20" cy="13" r="1.8" fill="${color}"/><path d="M20 18v10" stroke="${color}" stroke-width="2.4" stroke-linecap="round"/>`
        : `<path d="M20 11v11" stroke="${color}" stroke-width="2.4" stroke-linecap="round"/><circle cx="20" cy="27.5" r="1.8" fill="${color}"/>`;
  return `<svg width="40" height="40" viewBox="0 0 40 40" aria-hidden="true" focusable="false"><circle cx="20" cy="20" r="18.5" fill="none" stroke="${color}" stroke-width="1.6"/>${inner}</svg>`;
}

export function brandedPageHtml(kit: TenantVisualKit, p: BrandedPageSpec): string {
  const c = kit.colors;
  const ui = brandUiText(p.locale);
  const brand = kit.brandName || kit.legal.name || "";
  const site = kit.links.site(p.locale);
  const iconColor = p.kind === "success" ? c.primary : p.kind === "info" ? c.accent : c.muted;
  const footerLinks = p.links ?? [
    ...(kit.links.privacy(p.locale) ? [{ label: ui.privacy, url: kit.links.privacy(p.locale)! }] : []),
    ...(kit.links.contact(p.locale) ? [{ label: ui.contact, url: kit.links.contact(p.locale)! }] : []),
    ...(kit.links.imprint(p.locale) ? [{ label: ui.imprint, url: kit.links.imprint(p.locale)! }] : []),
  ];
  const css =
    `*{box-sizing:border-box}html,body{margin:0;padding:0}body{background:${c.background};color:${c.ink};font-family:${kit.fonts.body};-webkit-text-size-adjust:100%;min-height:100vh}` +
    `.wrap{max-width:560px;margin:0 auto;padding:clamp(16px,4vw,40px) 16px 48px}` +
    `.head{text-align:center;padding:8px 0 24px}.head a{text-decoration:none;color:${c.ink}}.head img{display:block;margin:0 auto;height:64px;max-height:64px;width:auto;max-width:240px}` +
    `.head .name{font-family:${kit.fonts.heading};font-size:20px;letter-spacing:.08em;text-transform:uppercase}` +
    `.card{background:${c.surface};border:1px solid ${c.border};border-radius:16px;padding:clamp(24px,5vw,40px);text-align:center;overflow-wrap:anywhere}` +
    `.icon{margin:0 auto 18px;width:40px;height:40px}` +
    `h1{font-family:${kit.fonts.heading};font-weight:normal;font-size:clamp(24px,5vw,30px);line-height:1.25;margin:0 0 14px;color:${c.ink}}` +
    `p{font-size:17px;line-height:1.6;margin:0 0 12px;color:${c.ink}}` +
    `.btn{display:inline-block;background:${c.primary};color:${c.buttonText};border:0;border-radius:999px;padding:14px 28px;font:inherit;font-size:15px;font-weight:600;line-height:20px;cursor:pointer;text-decoration:none;margin-top:16px;max-width:100%}` +
    `.btn:hover{filter:brightness(1.05)}form{margin:0}` +
    `.sec{display:block;margin-top:18px;font-size:14px;color:${c.primary};text-decoration:underline;font-weight:600}` +
    `footer{text-align:center;margin-top:28px;color:${c.muted};font-size:12px;line-height:1.6}footer p{font-size:12px;line-height:1.6;color:${c.muted};margin:0 0 6px}footer a{color:${c.muted};text-decoration:underline}footer .back{display:inline-block;margin-top:10px;color:${c.primary};font-weight:600}`;

  const header = kit.logoUrl
    ? `<a href="${esc(safeHref(site))}"><img src="${esc(kit.logoUrl)}" alt="${esc(brand)}" height="64" /></a>`
    : `<a href="${esc(safeHref(site))}"><span class="name">${esc(brand)}</span></a>`;

  let cta = "";
  if (p.cta) {
    if ((p.cta.method ?? "GET") === "POST") cta = `<form method="post" action="${p.cta.url ? esc(safeHref(p.cta.url)) : ""}"><button type="submit" class="btn">${esc(p.cta.label)}</button></form>`;
    else cta = `<a class="btn" href="${esc(safeHref(p.cta.url))}">${esc(p.cta.label)}</a>`;
  }
  const secondary = p.secondary ? `<a class="sec" href="${esc(safeHref(p.secondary.url))}">${esc(p.secondary.label)}</a>` : "";
  const links = footerLinks.length ? `<p>${footerLinks.map((l) => `<a href="${esc(safeHref(l.url))}">${esc(l.label)}</a>`).join(" &nbsp;·&nbsp; ")}</p>` : "";
  const back = site ? `<a class="back" href="${esc(safeHref(site))}">${esc(ui.backTo.replace("{brand}", brand))}</a>` : "";

  return (
    `<!doctype html><html lang="${esc(p.locale || "es")}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><meta name="color-scheme" content="light"><title>${esc(p.title)}${brand ? ` · ${esc(brand)}` : ""}</title><style>${css}</style></head>` +
    `<body><div class="wrap"><div class="head">${header}</div>` +
    `<main class="card"><div class="icon">${icon(p.kind, iconColor)}</div><h1>${esc(p.title)}</h1><p>${esc(p.text)}</p>${cta}${secondary}</main>` +
    `<footer>${brand ? `<p>${esc(brand)}</p>` : ""}${kit.legal.line && kit.legal.line !== brand ? `<p>${esc(kit.legal.line)}</p>` : ""}${links}${back}</footer>` +
    `</div></body></html>`
  );
}

/** Política de contenido: estilos en línea, el logotipo (propio origen más el del logotipo) y formularios al propio origen. */
export function brandedPageCsp(kit: TenantVisualKit): string {
  const logoOrigin = originOf(kit.logoUrl);
  const img = ["'self'", logoOrigin ?? ""].filter(Boolean).join(" ");
  return `default-src 'none'; style-src 'unsafe-inline'; img-src ${img}; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`;
}

export function brandedPage(res: Response, status: number, kit: TenantVisualKit, p: BrandedPageSpec): void {
  res.status(status);
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  res.setHeader("Content-Security-Policy", brandedPageCsp(kit));
  res.send(brandedPageHtml(kit, p));
}
