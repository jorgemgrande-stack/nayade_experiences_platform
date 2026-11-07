/**
 * Páginas públicas de Elephant Net (carta de mesa, check-in, firma y baja): HTML del servidor, sin JavaScript, con
 * formularios, como el área de puntos (server/loyaltyPortal.ts). Móvil primero y en español.
 *
 * Cabeceras: sin caché, sin referer (el token va en la ruta), sin marcos, sin indexar y CSP que solo permite los estilos
 * en línea y enviar formularios al propio origen.
 */
import type { Response } from "express";
import { brandName } from "../tenantBrand";
import { publicBaseUrl } from "../_core/productIdentity";

export const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export const fmtEur = (n: number) => new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(n);

export function fmtDay(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  return new Intl.DateTimeFormat("es-ES", { dateStyle: "long", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));
}

const CSS =
  "*{box-sizing:border-box}body{margin:0;background:#f6f7f9;font-family:system-ui,'Segoe UI',Arial,sans-serif;color:#111827;-webkit-text-size-adjust:100%}" +
  "main{max-width:640px;margin:0 auto;padding:16px}.sheet{background:#fff;border:1px solid #e5e7eb;border-radius:16px;padding:18px 18px;margin-bottom:14px}" +
  "h1{font-size:22px;margin:0 0 6px}h2{font-size:17px;margin:0 0 10px}h3{font-size:15px;margin:14px 0 6px;color:#374151}" +
  "p{font-size:15px;line-height:22px;color:#374151;margin:0 0 10px}.muted{color:#6b7280;font-size:13px}.ok{color:#047857}.err{color:#b91c1c}" +
  "ul{list-style:none;padding:0;margin:0}li{border-top:1px solid #f0f0f2;padding:12px 0;display:flex;justify-content:space-between;gap:12px;align-items:center}li:first-child{border-top:0}" +
  "button{background:#111827;color:#fff;border:0;border-radius:12px;padding:14px 18px;font-size:16px;font-weight:600;cursor:pointer;width:100%}" +
  "label{display:block;font-size:13px;color:#374151;margin:8px 0 4px}" +
  "input,select,textarea{border:1px solid #d1d5db;border-radius:10px;padding:11px;font:inherit;font-size:16px;width:100%;background:#fff}" +
  "input[type=number]{width:76px;text-align:center}input[type=checkbox]{width:auto;margin-right:8px}.row{display:flex;gap:10px}.row>div{flex:1}" +
  ".notice{border-radius:12px;padding:12px 14px;margin-bottom:14px;font-size:15px}.notice.ok{background:#ecfdf5}.notice.err{background:#fef2f2}" +
  ".terms{white-space:pre-wrap;font-size:14px;line-height:21px;color:#374151;max-height:340px;overflow:auto;border:1px solid #f0f0f2;border-radius:10px;padding:12px}" +
  "fieldset{border:1px solid #e5e7eb;border-radius:12px;padding:12px;margin:0 0 12px}legend{font-weight:600;font-size:14px;padding:0 6px}" +
  "footer{text-align:center;color:#9ca3af;font-size:12px;margin:12px 0 40px}";

export function page(res: Response, status: number, title: string, body: string): void {
  res.status(status);
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
  let company = "";
  try {
    company = brandName();
  } catch {
    company = "";
  }
  res.send(
    `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${esc(title)}</title><style>${CSS}</style></head>` +
      `<body><main>${body}<footer>${esc(company)}</footer></main></body></html>`,
  );
}

/** Respuesta única para cualquier enlace que no vale (inexistente, de otra empresa, revocado, usado o caducado). */
export function invalidLink(res: Response, title: string): void {
  page(res, 404, title, `<div class="sheet"><h1>${esc(title)}</h1><p>Este enlace no es válido o ha caducado. Pide uno nuevo al establecimiento.</p></div>`);
}

/** El servicio no está disponible para esta empresa (sin la capacidad, sin el módulo o sin instalar). */
export function unavailable(res: Response, title: string): void {
  page(res, 404, title, `<div class="sheet"><h1>${esc(title)}</h1><p>Este servicio no está disponible en este momento.</p></div>`);
}

export function failure(res: Response, title: string): void {
  page(res, 500, title, `<div class="sheet"><h1>${esc(title)}</h1><p>No hemos podido completar la operación. Inténtalo de nuevo en unos minutos.</p></div>`);
}

export function tooLarge(res: Response): void {
  page(res, 413, "Solicitud demasiado grande", `<div class="sheet"><p>La solicitud es demasiado grande.</p></div>`);
}

/** URL pública de una ruta en el dominio de la empresa en curso. */
export function publicUrl(path: string): string {
  return `${publicBaseUrl().replace(/\/+$/, "")}${path}`;
}

export const notice = (kind: "ok" | "err", text: string) => `<div class="notice ${kind}">${esc(text)}</div>`;
