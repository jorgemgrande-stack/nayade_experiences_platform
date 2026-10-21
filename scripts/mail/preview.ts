/**
 * Galería estática de las comunicaciones con DATOS FICTICIOS (no envía nada ni lee bases de datos):
 *
 *   pnpm exec tsx scripts/mail/preview.ts [carpeta]      (por defecto ./mail-preview)
 *
 * Escribe un HTML por aviso (`<id>.html`, tal cual se enviaría), su versión de texto (`<id>.txt`) e `index.html` con
 * todas las vistas previas en marcos aislados, agrupadas como en el catálogo.
 */
import fs from "node:fs";
import path from "node:path";
import { TEMPLATE_CATALOG } from "../../server/notifications/catalog";
import { allPreviews } from "../../server/notifications/preview";

const out = path.resolve(process.argv[2] ?? "mail-preview");
fs.mkdirSync(out, { recursive: true });
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const GROUP: Record<string, string> = { trial: "Prueba gratuita", subscription: "Suscripción y pagos", module: "Módulos", billing: "Facturación", support: "Soporte, desistimiento y avisos internos", security: "Seguridad" };

const previews = allPreviews();
for (const p of previews) {
  fs.writeFileSync(path.join(out, `${p.id}.html`), p.html);
  fs.writeFileSync(path.join(out, `${p.id}.txt`), `Asunto: ${p.subject}\n\n${p.text}\n`);
}
const byId = new Map(previews.map((p) => [p.id, p]));
const sections = Object.entries(GROUP)
  .map(([g, title]) => {
    const items = TEMPLATE_CATALOG.filter((t) => t.group === g && byId.has(t.id));
    if (!items.length) return "";
    return `<h2>${esc(title)}</h2>` + items
      .map((t) => {
        const p = byId.get(t.id)!;
        return `<article><header><code>${esc(t.id)}</code><strong>${esc(p.subject)}</strong><span>${esc(t.trigger)}</span></header><iframe sandbox="" loading="lazy" title="${esc(t.id)}" srcdoc="${esc(p.html)}"></iframe><a href="${esc(t.id)}.txt">Versión de texto</a></article>`;
      })
      .join("");
  })
  .join("");
fs.writeFileSync(
  path.join(out, "index.html"),
  `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Comunicaciones de Elephant Source · vista previa</title>` +
    `<style>body{margin:0;padding:24px;font-family:system-ui,sans-serif;background:#efede8;color:#171d28}h1{margin:0 0 4px}p.n{margin:0 0 24px;color:#4b5668}h2{margin:32px 0 12px}` +
    `article{background:#fff;border:1px solid #e3ddd3;border-radius:12px;margin:0 0 20px;overflow:hidden}header{display:grid;gap:4px;padding:14px 16px;border-bottom:1px solid #e3ddd3}header span{color:#4b5668;font-size:13px}` +
    `iframe{display:block;width:100%;height:620px;border:0;background:#f7f5f1}article>a{display:block;padding:10px 16px;font-size:13px}</style></head>` +
    `<body><h1>Comunicaciones de Elephant Source</h1><p class="n">Vista previa con datos ficticios (${previews.length} avisos). Nada de esto se ha enviado.</p>${sections}</body></html>`,
);
console.log(`${previews.length} vistas previas en ${out}`);
