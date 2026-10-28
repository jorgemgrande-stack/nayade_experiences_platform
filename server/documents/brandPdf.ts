/**
 * PDF corporativo de Big Elephant (contratos, facturas y otros documentos del plano de control), en JavaScript puro
 * (pdf-lib): el contenedor del plano de control no tiene navegador.
 *
 *  - Encabezado en cada página: logotipo oficial (si se pudo cargar; si no, la marca en texto) y los datos del EMISOR
 *    (razón social, NIF y domicilio: la entidad jurídica, nunca solo la marca).
 *  - Pie en cada página: emisor, nota del documento (p. ej. versión y huella) y «Página X de Y».
 *  - El contenido son bloques ya maquetados (título, encabezados, párrafos con número y entradilla, pares clave-valor,
 *    tablas con totales y recuadros). Quien llama decide el texto: aquí no se reescribe nada, solo se compone.
 *  - Fuentes estándar (Helvetica, codificación WinAnsi): cubren el español (tildes, ñ, ¿¡, €, º, ª, ·, —). Un carácter
 *    que no se pueda codificar se sustituye por uno equivalente para que el documento nunca falle por un símbolo.
 */
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";

export interface BrandIssuer {
  legalName: string;
  taxId: string;
  /** Domicilio en una línea (p. ej. «Calle Corazón de María, 57, 1.º D, 28002 Madrid»). */
  address: string;
}

export type PdfBlock =
  | { kind: "title"; text: string; subtitle?: string }
  | { kind: "heading"; text: string; number?: string }
  | { kind: "paragraph"; text: string; number?: string; lead?: string | null; muted?: boolean }
  | { kind: "keyValue"; rows: Array<[string, string]> }
  | { kind: "table"; columns: Array<{ title: string; width: number; align?: "left" | "right" }>; rows: string[][]; totals?: string[] }
  | { kind: "box"; title: string; lines: string[] }
  | { kind: "spacer"; height?: number };

export interface BrandPdfInput {
  /** Título del documento (metadatos del PDF). */
  title: string;
  issuer: BrandIssuer;
  logoPng?: Uint8Array | null;
  /** Nota del pie (p. ej. «CT-2026-000004 · versión 1 · huella SHA-256 …»). */
  footerNote?: string;
  blocks: PdfBlock[];
}

/** Colores de marca (los de los correos de plataforma). */
const C = { ink: rgb(0x17 / 255, 0x1d / 255, 0x28 / 255), text: rgb(0x37 / 255, 0x41 / 255, 0x51 / 255), muted: rgb(0x6b / 255, 0x72 / 255, 0x80 / 255), accent: rgb(1, 0x30 / 255, 0x35 / 255), paper: rgb(0xf7 / 255, 0xf5 / 255, 0xf1 / 255), line: rgb(0xe3 / 255, 0xdd / 255, 0xd3 / 255) };
const A4 = { w: 595.28, h: 841.89 };
const M = { x: 56, top: 112, bottom: 72 };
const SUBST: Record<string, string> = { "→": "->", "←": "<-", "“": '"', "”": '"', "‘": "'", "’": "'", " ": " ", " ": " ", "≤": "<=", "≥": ">=", "✓": "v" };

export const DEFAULT_LOGO_URL = "https://www.bigelephant.es/brand/big-elephant-logo.png";
let logoCache: { at: number; png: Uint8Array | null } | null = null;

/** Logotipo oficial (PNG), con caché de una hora; null si no se puede descargar (el PDF sale con la marca en texto). */
export async function fetchBrandLogo(url = DEFAULT_LOGO_URL, fetcher: typeof fetch = fetch): Promise<Uint8Array | null> {
  if (logoCache && Date.now() - logoCache.at < 3_600_000) return logoCache.png;
  let png: Uint8Array | null = null;
  try {
    const r = await fetcher(url, { signal: AbortSignal.timeout(4000) });
    const buf = r.ok ? new Uint8Array(await r.arrayBuffer()) : null;
    // Solo PNG (firma de 8 bytes) y de tamaño razonable
    png = buf && buf.length < 2_000_000 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 ? buf : null;
  } catch {
    png = null;
  }
  logoCache = { at: Date.now(), png };
  return png;
}

export async function renderBrandPdf(input: BrandPdfInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(input.title);
  pdf.setAuthor(input.issuer.legalName);
  pdf.setProducer("Big Elephant CRM");
  pdf.setCreator("Big Elephant CRM");
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let logo: PDFImage | null = null;
  if (input.logoPng) {
    try {
      logo = await pdf.embedPng(input.logoPng);
    } catch {
      logo = null;
    }
  }
  const safe = sanitizer(regular);
  const width = A4.w - 2 * M.x;
  let page!: PDFPage;
  let y = 0;
  const newPage = () => {
    page = pdf.addPage([A4.w, A4.h]);
    y = A4.h - M.top;
  };
  const ensure = (h: number) => {
    if (y - h < M.bottom) newPage();
  };
  const wrap = (text: string, font: PDFFont, size: number, max: number): string[] => {
    const out: string[] = [];
    for (const raw of safe(text).split("\n")) {
      const words = raw.split(/\s+/).filter(Boolean);
      if (!words.length) {
        out.push("");
        continue;
      }
      let line = "";
      for (const w of words) {
        const next = line ? `${line} ${w}` : w;
        if (font.widthOfTextAtSize(next, size) <= max) line = next;
        else {
          if (line) out.push(line);
          line = w;
        }
      }
      if (line) out.push(line);
    }
    return out;
  };
  const text = (s: string, x: number, yy: number, font: PDFFont, size: number, color = C.text) => page.drawText(safe(s), { x, y: yy, font, size, color });

  newPage();
  for (const b of input.blocks) {
    if (b.kind === "spacer") {
      y -= b.height ?? 10;
      continue;
    }
    if (b.kind === "title") {
      const lines = wrap(b.text, bold, 20, width);
      ensure(lines.length * 26 + 34);
      for (const l of lines) {
        text(l, M.x, y - 20, bold, 20, C.ink);
        y -= 26;
      }
      if (b.subtitle) {
        text(b.subtitle, M.x, y - 12, regular, 10.5, C.muted);
        y -= 18;
      }
      page.drawRectangle({ x: M.x, y: y - 8, width: 48, height: 3, color: C.accent });
      y -= 24;
      continue;
    }
    if (b.kind === "heading") {
      ensure(40);
      y -= 10;
      const label = b.number ? `${b.number}. ${b.text}` : b.text;
      text(label, M.x, y - 12, bold, 12, C.ink);
      y -= 18;
      page.drawLine({ start: { x: M.x, y: y - 2 }, end: { x: M.x + width, y: y - 2 }, thickness: 0.6, color: C.line });
      y -= 10;
      continue;
    }
    if (b.kind === "paragraph") {
      const indent = b.number ? 30 : 0;
      const size = b.muted ? 9 : 10;
      const lead = b.lead ? safe(b.lead) : "";
      const rest = lead && b.text.startsWith(b.lead!) ? b.text.slice(b.lead!.length).trimStart() : b.text;
      const leadW = lead ? bold.widthOfTextAtSize(`${lead} `, size) : 0;
      // Primera línea con la entradilla en negrita; el resto, ajustado al ancho
      const first = wrap(rest, regular, size, width - indent - leadW);
      const firstLine = first.shift() ?? "";
      const tail = first.length ? wrap(first.join(" "), regular, size, width - indent) : [];
      const lines = 1 + tail.length;
      const lh = size * 1.45;
      ensure(lines * lh + 6);
      if (b.number) text(b.number, M.x, y - size, bold, size, C.accent);
      if (lead) text(lead, M.x + indent, y - size, bold, size, C.ink);
      text(firstLine, M.x + indent + leadW, y - size, regular, size, b.muted ? C.muted : C.text);
      y -= lh;
      for (const l of tail) {
        ensure(lh);
        text(l, M.x + indent, y - size, regular, size, b.muted ? C.muted : C.text);
        y -= lh;
      }
      y -= 5;
      continue;
    }
    if (b.kind === "keyValue") {
      const keyW = 110;
      for (const [k, v] of b.rows) {
        const lines = wrap(v, regular, 10, width - keyW);
        ensure(lines.length * 14 + 4);
        text(k, M.x, y - 10, bold, 9, C.muted);
        for (const l of lines) {
          text(l, M.x + keyW, y - 10, regular, 10, C.ink);
          y -= 14;
        }
        y -= 3;
      }
      y -= 6;
      continue;
    }
    if (b.kind === "table") {
      const total = b.columns.reduce((a, c) => a + c.width, 0);
      const cols = b.columns.map((c) => ({ ...c, w: (c.width / total) * width }));
      const all = [b.columns.map((c) => c.title), ...b.rows, ...(b.totals ? [b.totals] : [])];
      // Cada celda se ajusta al ancho de su columna; la fila crece con la celda más alta
      const laid = all.map((row, i) => {
        const isHead = i === 0;
        const isTotal = !!b.totals && i === all.length - 1;
        const font = isHead || isTotal ? bold : regular;
        const size = isHead ? 9 : 10;
        const cells = row.map((cell, j) => wrap(cell, font, size, cols[j].w - 16));
        return { isHead, isTotal, font, size, cells, h: Math.max(1, ...cells.map((c) => c.length)) * (size + 3) + 11 };
      });
      ensure(laid.reduce((a, r) => a + r.h, 0) + 10);
      let lastH = 0;
      for (const r of laid) {
        if (r.isHead) page.drawRectangle({ x: M.x, y: y - r.h, width, height: r.h, color: C.ink });
        else if (r.isTotal) page.drawRectangle({ x: M.x, y: y - r.h, width, height: r.h, color: C.paper });
        let x = M.x;
        r.cells.forEach((lines, j) => {
          const c = cols[j];
          lines.forEach((s, k) => {
            const w = r.font.widthOfTextAtSize(s, r.size);
            const tx = c.align === "right" ? x + c.w - 8 - w : x + 8;
            text(s, tx, y - 7 - r.size - k * (r.size + 3) + 2, r.font, r.size, r.isHead ? rgb(1, 1, 1) : C.ink);
          });
          x += c.w;
        });
        if (!r.isHead) page.drawLine({ start: { x: M.x, y: y - r.h }, end: { x: M.x + width, y: y - r.h }, thickness: 0.5, color: C.line });
        y -= r.h;
        lastH = r.h;
      }
      if (b.totals) page.drawRectangle({ x: M.x, y, width: 3, height: lastH, color: C.accent });
      y -= 14;
      continue;
    }
    if (b.kind === "box") {
      const lines = b.lines.flatMap((l) => wrap(l, regular, 9.5, width - 28));
      const h = 26 + lines.length * 13.5 + 10;
      ensure(h + 6);
      page.drawRectangle({ x: M.x, y: y - h, width, height: h, color: C.paper, borderColor: C.line, borderWidth: 0.6 });
      page.drawRectangle({ x: M.x, y: y - h, width: 3, height: h, color: C.accent });
      text(b.title, M.x + 14, y - 18, bold, 10.5, C.ink);
      let yy = y - 34;
      for (const l of lines) {
        text(l, M.x + 14, yy, regular, 9.5, C.text);
        yy -= 13.5;
      }
      y -= h + 12;
      continue;
    }
  }

  // Encabezado y pie en cada página (con el total de páginas ya conocido)
  const pages = pdf.getPages();
  const issuerLine = `${input.issuer.legalName} · NIF ${input.issuer.taxId}`;
  pages.forEach((p, i) => {
    page = p;
    const top = A4.h - 44;
    if (logo) {
      const h = 26;
      const w = (logo.width / logo.height) * h;
      p.drawImage(logo, { x: M.x, y: top - h + 6, width: w, height: h });
    } else {
      text("Big Elephant", M.x, top - 12, bold, 14, C.ink);
    }
    const right = (s: string, yy: number, font: PDFFont, size: number, color = C.muted) => text(s, A4.w - M.x - font.widthOfTextAtSize(safe(s), size), yy, font, size, color);
    right(input.issuer.legalName, top - 2, bold, 8.5, C.ink);
    right(`NIF ${input.issuer.taxId}`, top - 13, regular, 8);
    right(input.issuer.address, top - 24, regular, 8);
    p.drawLine({ start: { x: M.x, y: top - 34 }, end: { x: A4.w - M.x, y: top - 34 }, thickness: 0.6, color: C.line });
    p.drawLine({ start: { x: M.x, y: 50 }, end: { x: A4.w - M.x, y: 50 }, thickness: 0.6, color: C.line });
    text(issuerLine, M.x, 36, regular, 7.5, C.muted);
    if (input.footerNote) {
      wrap(input.footerNote, regular, 7, width - 70).slice(0, 2).forEach((l, k) => text(l, M.x, 26 - k * 9, regular, 7, C.muted));
    }
    right(`Página ${i + 1} de ${pages.length}`, 36, regular, 7.5);
  });
  return pdf.save();
}

/** Sustituye los caracteres que la fuente estándar no puede codificar (nunca deja que el PDF falle por un símbolo). */
function sanitizer(font: PDFFont) {
  const ok = new Map<string, boolean>();
  const can = (ch: string) => {
    let v = ok.get(ch);
    if (v === undefined) {
      try {
        font.encodeText(ch);
        v = true;
      } catch {
        v = false;
      }
      ok.set(ch, v);
    }
    return v;
  };
  return (s: string) =>
    Array.from(s.replace(/\r/g, ""))
      .map((ch) => (ch === "\n" || can(ch) ? ch : (SUBST[ch] ?? "?")))
      .join("");
}
