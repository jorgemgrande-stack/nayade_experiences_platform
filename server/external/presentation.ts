/**
 * Presentación corporativa del contrato de un servicio externo (página de aceptación, vista del operador y PDF).
 *
 * El documento contractual es el TEXTO registrado (`renderContract`), con su versión y su huella SHA-256: es lo que
 * se acepta. Aquí solo se maqueta. `contractView` reparte ese texto en partes, apartados y cláusulas SIN cambiar una
 * palabra (la numeración y las tablas son ayudas de lectura añadidas alrededor), y `presentedLines` devuelve las líneas
 * del texto tal y como aparecen en la presentación, para comprobar que no se pierde ni se altera nada.
 */
import { ISSUER } from "../stripe/issuer";
import type { BrandIssuer, PdfBlock } from "../documents/brandPdf";
import { DEFAULT_LOGO_URL } from "../documents/brandPdf";
import { localDate } from "./schedule";
import { taxCents } from "./document";
import type { ExternalSubscription } from "./types";

export interface ContractClause {
  /** «1.2»: numeración de lectura (no forma parte del texto contractual). */
  number: string;
  /** Entradilla en negrita (p. ej. «Objeto.»): es el principio del propio texto. */
  lead: string | null;
  /** Texto íntegro de la cláusula (líneas del documento, sin el guion de lista). */
  text: string;
  /** Era un elemento de lista («- »): el guion se sustituye por la numeración. */
  bullet: boolean;
}
export interface ContractSection {
  number: number;
  heading: string;
  clauses: ContractClause[];
}
export interface ContractView {
  title: string;
  reference: string;
  version: number;
  sha256: string;
  parties: Array<{ label: string; value: string }>;
  sections: ContractSection[];
  economics: { serviceName: string; baseCents: number; taxRateBp: number; taxCents: number; totalCents: number; currency: string; billingDay: number; firstCharge: string; graceUntilDay: number; timezone: string };
  signer: { name: string; role: string | null } | null;
  declaration: string | null;
}

export const contractIssuer = (): BrandIssuer => ({ legalName: ISSUER.legalName, taxId: ISSUER.taxId, address: `${ISSUER.address.line1}, ${ISSUER.address.line2}, ${ISSUER.address.postalCode} ${ISSUER.address.city}` });

const HEADING = /^[A-ZÁÉÍÓÚÜÑ0-9][A-ZÁÉÍÓÚÜÑ0-9 ,.;:()·/-]{4,}$/;
const LEAD = /^([A-ZÁÉÍÓÚÜÑ¿][^.:\n]{1,40}[.:])(\s|$)/;

/** Reparte el texto registrado en título, partes y apartados con sus cláusulas. No reescribe nada. */
export function contractView(
  text: string,
  meta: { sha256: string; reference: string; version: number; external: Pick<ExternalSubscription, "serviceName" | "amountCents" | "currency" | "taxRateBp" | "billingDay" | "graceDays" | "firstChargeAt" | "timezone">; signer?: { name: string; role: string | null } | null; declaration?: string | null },
): ContractView {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const title = lines[0] ?? "";
  const parties: ContractView["parties"] = [];
  const sections: ContractSection[] = [];
  let cur: ContractSection | null = null;
  let para: string[] = [];
  const flush = (bullet = false) => {
    if (!cur || !para.length) return void (para = []);
    const t = para.join("\n");
    cur.clauses.push({ number: `${cur.number}.${cur.clauses.length + 1}`, lead: LEAD.exec(t)?.[1] ?? null, text: t, bullet });
    para = [];
  };
  for (const raw of lines.slice(1)) {
    const l = raw.trimEnd();
    if (HEADING.test(l.trim()) && /[A-ZÁÉÍÓÚÑ]{4}/.test(l)) {
      flush();
      cur = { number: sections.length + 1, heading: l.trim(), clauses: [] };
      sections.push(cur);
      continue;
    }
    if (!cur) {
      const m = /^([^:]{2,40}):\s(.+)$/.exec(l);
      if (m) parties.push({ label: m[1], value: m[2] });
      else if (l.trim()) parties.push({ label: "", value: l });
      continue;
    }
    if (l.startsWith("- ")) {
      flush();
      para = [l.slice(2)];
      flush(true);
      continue;
    }
    if (!l.trim()) flush();
    else para.push(l);
  }
  flush();
  const x = meta.external;
  const first = localDate(x.firstChargeAt, x.timezone);
  const tax = taxCents(x);
  return {
    title,
    reference: meta.reference,
    version: meta.version,
    sha256: meta.sha256,
    parties,
    sections,
    economics: { serviceName: x.serviceName, baseCents: x.amountCents, taxRateBp: x.taxRateBp, taxCents: tax, totalCents: x.amountCents + tax, currency: x.currency, billingDay: x.billingDay, firstCharge: `${String(first.day).padStart(2, "0")}/${String(first.month).padStart(2, "0")}/${first.year}`, graceUntilDay: x.billingDay + x.graceDays - 1, timezone: x.timezone },
    signer: meta.signer ?? null,
    declaration: meta.declaration ?? null,
  };
}

/**
 * Reconstrucción del texto a partir de la presentación (etiquetas de las partes y guiones de lista incluidos): debe
 * dar exactamente las líneas del documento registrado. Es la garantía de que maquetar no cambia el contenido.
 */
export function presentedLines(v: ContractView): string[] {
  const out = [v.title, ...v.parties.map((p) => (p.label ? `${p.label}: ${p.value}` : p.value))];
  for (const s of v.sections) {
    out.push(s.heading);
    for (const c of s.clauses) out.push(...(c.bullet ? [`- ${c.text}`] : c.text.split("\n")));
  }
  return out;
}

/** Fragmentos de texto que la presentación muestra literalmente, en orden (valores de las partes, apartados y líneas). */
export function presentedFragments(v: ContractView): string[] {
  return [v.title, ...v.parties.flatMap((p) => (p.label ? [p.label, p.value] : [p.value])), ...v.sections.flatMap((s) => [s.heading, ...s.clauses.flatMap((c) => c.text.split("\n"))])];
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
// El mismo formato que el texto contractual (document.ts): separador de miles siempre («1.000,00 €»)
const money = (cents: number, currency: string) => new Intl.NumberFormat("es-ES", { style: "currency", currency, useGrouping: "always" } as unknown as Intl.NumberFormatOptions).format(cents / 100);
const pct = (bp: number) => `${(bp / 100).toLocaleString("es-ES", { maximumFractionDigits: 2 })} %`;

/** Hoja de estilos de la presentación (sin recursos externos salvo el logotipo). */
export const CONTRACT_CSS = `
:root{--ink:#171d28;--text:#374151;--muted:#6b7280;--accent:#ff3035;--paper:#f7f5f1;--line:#e3ddd3}
*{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--text);font:15px/1.6 "Helvetica Neue",Helvetica,Arial,system-ui,sans-serif;-webkit-font-smoothing:antialiased}
.doc{max-width:860px;margin:0 auto;padding:24px 16px 48px}
.sheet{background:#fff;border:1px solid var(--line);border-radius:14px;padding:40px 48px;box-shadow:0 1px 2px rgba(23,29,40,.04)}
.top{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;padding-bottom:18px;border-bottom:1px solid var(--line)}
.top img{height:34px;width:auto;display:block}
.brand{font-weight:700;font-size:18px;color:var(--ink)}
.issuer{text-align:right;font-size:12px;line-height:1.5;color:var(--muted)}
.issuer strong{color:var(--ink);font-size:12.5px}
.eyebrow{margin:28px 0 4px;font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:var(--accent);font-weight:700}
h1{margin:0;font-size:28px;line-height:1.2;color:var(--ink);letter-spacing:-.01em}
.meta{margin-top:8px;font-size:13px;color:var(--muted)}
.rule{width:56px;height:3px;background:var(--accent);margin:18px 0 26px;border-radius:2px}
.parties{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;margin-bottom:26px}
.party{border:1px solid var(--line);border-radius:10px;padding:14px 16px}
.party .k{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);font-weight:700}
.party .v{margin-top:4px;color:var(--ink);font-size:14.5px;line-height:1.45}
.econ{border:1px solid var(--line);border-left:4px solid var(--accent);border-radius:10px;overflow:hidden;margin:0 0 30px}
.econ table{width:100%;border-collapse:collapse;font-size:14.5px}
.econ th{background:var(--ink);color:#fff;font-weight:600;font-size:12px;letter-spacing:.04em;text-transform:uppercase;padding:10px 14px;text-align:left}
.econ td{padding:12px 14px;border-top:1px solid var(--line);color:var(--ink)}
.econ .r{text-align:right;white-space:nowrap}
.econ tr.total td{background:var(--paper);font-weight:700}
.econ .facts{display:flex;flex-wrap:wrap;gap:6px 22px;padding:12px 14px;border-top:1px solid var(--line);font-size:13px;color:var(--muted)}
.econ .facts b{color:var(--ink);font-weight:600}
section.sec{margin:0 0 22px}
h2{font-size:13.5px;color:var(--ink);margin:0 0 10px;padding-bottom:8px;border-bottom:1px solid var(--line);letter-spacing:.06em}
h2 .n{color:var(--accent);margin-right:8px}
.cl{display:grid;grid-template-columns:44px 1fr;gap:4px;margin:0 0 10px}
.cl .n{color:var(--accent);font-weight:700;font-size:13px;padding-top:1px}
.cl .t{white-space:pre-line}
.cl .t b{color:var(--ink)}
.accept{margin-top:30px;border:1px solid var(--line);border-left:4px solid var(--accent);border-radius:10px;background:var(--paper);padding:20px 22px}
.accept h3{margin:0 0 8px;font-size:15px;color:var(--ink)}
.accept p{margin:6px 0}
.accept label{display:block;margin:12px 0;font-size:14.5px}
.accept input[type=text]{display:block;width:100%;margin-top:4px;padding:10px 12px;font:inherit;border:1px solid #cfc8bc;border-radius:8px;background:#fff}
.accept .check{display:flex;gap:10px;align-items:flex-start}
.accept .check input{margin-top:5px;width:18px;height:18px;flex:none}
.btn{display:inline-block;padding:12px 22px;font-family:inherit;font-size:15px;font-weight:600;line-height:1.2;background:var(--ink);color:#fff;border:1px solid var(--ink);border-radius:8px;cursor:pointer;text-decoration:none}
.btn.ghost{background:#fff;color:var(--ink);border:1px solid var(--line)}
.actions{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-top:16px}
.integrity{margin-top:26px;padding-top:14px;border-top:1px solid var(--line);font-size:12px;color:var(--muted);word-break:break-all}
.integrity code{font:12px ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--ink)}
.muted{color:var(--muted);font-size:13.5px}
details.raw{margin-top:14px;font-size:13px}
details.raw pre{white-space:pre-wrap;background:var(--paper);border:1px solid var(--line);border-radius:8px;padding:14px;font:12.5px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace}
.ok{background:#eef8ee;border:1px solid #9c9;padding:16px;border-radius:10px}
.err{background:#fdf0f0;border:1px solid #d99;padding:16px;border-radius:10px}
footer.site{max-width:860px;margin:0 auto;padding:0 16px 32px;font-size:12px;color:var(--muted);text-align:center}
@media (max-width:640px){.sheet{padding:24px 18px;border-radius:10px}.top{flex-direction:column}.issuer{text-align:left}h1{font-size:23px}.cl{grid-template-columns:36px 1fr}.econ thead{display:none}.econ tr{display:block;border-top:1px solid var(--line);padding:6px 0}.econ tbody tr:first-child{border-top:0}.econ td{display:flex;justify-content:space-between;gap:12px;border:0;padding:4px 14px}.econ td[data-label]::before{content:attr(data-label);color:var(--muted);font-weight:400}.econ td.concept{font-weight:600}.econ td:empty,.econ tr.total td:first-child{display:none}}
@media print{body{background:#fff}.doc{padding:0}.sheet{border:0;box-shadow:none;padding:0}.actions,.accept form,details.raw{display:none}}
`;

/** Cabecera corporativa (logotipo oficial y datos del prestador). */
export function contractHeaderHtml(logoUrl: string | null = DEFAULT_LOGO_URL): string {
  const i = contractIssuer();
  return `<header class="top">${logoUrl ? `<img src="${esc(logoUrl)}" alt="Big Elephant" width="150" height="34">` : `<span class="brand">Big Elephant</span>`}<div class="issuer"><strong>${esc(i.legalName)}</strong><br>NIF ${esc(i.taxId)}<br>${esc(i.address)}</div></header>`;
}

/** Cuerpo del contrato maquetado (sin `<html>`): partes, tabla económica, apartados y cláusulas numeradas, firmante. */
export function contractBodyHtml(v: ContractView, o: { logoUrl?: string | null; acceptance?: string; pdfUrl?: string | null; raw?: string } = {}): string {
  const e = v.economics;
  const party = (k: string, val: string) => `<div class="party"><div class="k">${esc(k)}</div><div class="v">${esc(val)}</div></div>`;
  const parties = v.parties.map((p) => party(p.label || "—", p.value)).join("") + (v.signer ? party("Firmante", `${v.signer.name}${v.signer.role ? ` · ${v.signer.role}` : ""}`) : "");
  const clause = (c: ContractClause) => {
    const t = c.lead && c.text.startsWith(c.lead) ? `<b>${esc(c.lead)}</b>${esc(c.text.slice(c.lead.length))}` : esc(c.text);
    return `<div class="cl"><span class="n">${c.number}</span><div class="t">${t}</div></div>`;
  };
  const sections = v.sections.map((s) => `<section class="sec"><h2><span class="n">${s.number}.</span>${esc(s.heading)}</h2>${s.clauses.map(clause).join("")}</section>`).join("");
  return `<div class="doc"><article class="sheet">${contractHeaderHtml(o.logoUrl === undefined ? DEFAULT_LOGO_URL : o.logoUrl)}
<p class="eyebrow">Contrato de servicio</p><h1>${esc(e.serviceName)}</h1>
<p class="meta">${esc(v.title)}</p><div class="rule"></div>
<div class="parties">${parties}</div>
<div class="econ"><table><thead><tr><th>Concepto</th><th class="r">Base</th><th class="r">IVA ${esc(pct(e.taxRateBp))}</th><th class="r">Total</th></tr></thead><tbody>
<tr><td class="concept">${esc(e.serviceName)} · cuota mensual</td><td class="r" data-label="Base">${esc(money(e.baseCents, e.currency))}</td><td class="r" data-label="IVA ${esc(pct(e.taxRateBp))}">${esc(money(e.taxCents, e.currency))}</td><td class="r" data-label="Total">${esc(money(e.totalCents, e.currency))}</td></tr>
<tr class="total"><td>Total mensual</td><td class="r"></td><td class="r"></td><td class="r" data-label="Total mensual">${esc(money(e.totalCents, e.currency))}</td></tr></tbody></table>
<div class="facts"><span>Primer cargo: <b>${esc(e.firstCharge)}</b></span><span>Cargo: <b>día ${e.billingDay} de cada mes</b></span><span>Margen de pago: <b>hasta el día ${e.graceUntilDay}</b></span><span>Periodicidad: <b>mensual</b></span></div></div>
${sections}
${o.acceptance ?? ""}
<div class="integrity">Documento contractual registrado: ${esc(v.reference)}, versión ${v.version}. Huella SHA-256 del texto: <code>${esc(v.sha256)}</code>. La numeración y la tabla económica facilitan la lectura; el texto de las cláusulas es el registrado.${o.raw !== undefined ? `<details class="raw"><summary>Ver el texto contractual registrado</summary><pre>${esc(o.raw)}</pre></details>` : ""}</div>
${o.pdfUrl ? `<div class="actions"><a class="btn ghost" href="${esc(o.pdfUrl)}">Descargar PDF</a></div>` : ""}
</article></div>`;
}

/** Página completa (para la vista del operador o una vista previa). */
export function contractPageHtml(v: ContractView, o: Parameters<typeof contractBodyHtml>[1] = {}): string {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${esc(`${v.reference} · ${v.economics.serviceName}`)}</title><style>${CONTRACT_CSS}</style></head><body>${contractBodyHtml(v, o)}</body></html>`;
}

/** Bloques del PDF corporativo: mismas partes, tabla y cláusulas que la página. */
export function contractPdfBlocks(v: ContractView, acceptance?: { title: string; lines: string[] }): PdfBlock[] {
  const e = v.economics;
  const blocks: PdfBlock[] = [
    { kind: "title", text: `Contrato de servicio · ${e.serviceName}`, subtitle: v.title },
    { kind: "keyValue", rows: [...v.parties.map((p): [string, string] => [p.label || "—", p.value]), ...(v.signer ? [["Firmante", `${v.signer.name}${v.signer.role ? ` · ${v.signer.role}` : ""}`] as [string, string]] : [])] },
    {
      kind: "table",
      columns: [{ title: "Concepto", width: 46 }, { title: "Base", width: 18, align: "right" }, { title: `IVA ${pct(e.taxRateBp)}`, width: 18, align: "right" }, { title: "Total", width: 18, align: "right" }],
      rows: [[`${e.serviceName} · cuota mensual`, money(e.baseCents, e.currency), money(e.taxCents, e.currency), money(e.totalCents, e.currency)]],
      totals: ["Total mensual", "", "", money(e.totalCents, e.currency)],
    },
    { kind: "paragraph", text: `Primer cargo: ${e.firstCharge} · Cargo el día ${e.billingDay} de cada mes · Margen de pago hasta el día ${e.graceUntilDay} · Periodicidad mensual`, muted: true },
  ];
  for (const s of v.sections) {
    blocks.push({ kind: "heading", number: String(s.number), text: s.heading });
    for (const c of s.clauses) blocks.push({ kind: "paragraph", number: c.number, lead: c.lead, text: c.text });
  }
  if (acceptance) blocks.push({ kind: "spacer", height: 6 }, { kind: "box", title: acceptance.title, lines: acceptance.lines });
  return blocks;
}

/** PDF corporativo del contrato (mismo texto, versión y huella que la página). */
export async function renderContractPdf(v: ContractView, o: { logoPng?: Uint8Array | null; acceptance?: { title: string; lines: string[] } } = {}): Promise<Uint8Array> {
  const { renderBrandPdf } = await import("../documents/brandPdf");
  return renderBrandPdf({
    title: `${v.reference} · ${v.economics.serviceName}`,
    issuer: contractIssuer(),
    logoPng: o.logoPng ?? null,
    footerNote: `${v.reference} · versión ${v.version} · huella SHA-256 ${v.sha256}`,
    blocks: contractPdfBlocks(v, o.acceptance),
  });
}
