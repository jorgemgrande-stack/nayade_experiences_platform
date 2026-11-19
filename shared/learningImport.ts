/**
 * Elephant LMS: planificador PURO de la importación de inventarios de Articulate (sin BD ni red).
 *
 * Entrada: los inventarios JSON (uno por módulo) con secciones → lecciones → bloques. Salida: un plan con el curso, sus
 * módulos, lecciones y bloques (con sus títulos originales en alemán, orden y URL de origen) y un informe de cobertura:
 * recuentos frente a los declarados por el inventario, recursos pendientes de fichero, posibles duplicados y avisos.
 *
 * Reglas:
 *  - Solo estructura. Nunca se inventan ficheros: un vídeo, audio o PDF queda como recurso `pending` hasta que llegue el fichero.
 *  - Las URLs compartidas de Articulate quedan como trazabilidad (origen), nunca como recurso permanente.
 *  - Idempotente por claves de origen (`source_key`): reimportar no duplica.
 *  - Los créditos visibles (p. ej. «By Sabrina Fleschutz») se conservan en el expediente y no se atribuyen a nadie.
 */

export type InventoryBlockType = "texto" | "video" | "audio" | "audio_meditacion" | "pdf" | "enlace_externo" | "enlace_youtube" | "youtube_incrustado";
export const INVENTORY_BLOCK_TYPES: readonly InventoryBlockType[] = ["texto", "video", "audio", "audio_meditacion", "pdf", "enlace_externo", "enlace_youtube", "youtube_incrustado"];

export type BlockKind = "text" | "video" | "audio" | "pdf" | "external_link";
export type ResourceKind = "video" | "audio" | "pdf";

export interface PlanBlock {
  sourceKey: string;
  position: number;
  kind: BlockKind;
  title: string;
  originalTitle: string;
  body: string | null;
  externalUrl: string | null;
  durationSeconds: number | null;
  activity: string | null;
  /** Recurso que debe llegar como fichero (null si el bloque no lleva fichero propio) */
  resource: null | { kind: ResourceKind; originalName: string | null; sizeHint: string | null; provenance: string };
}
export interface PlanLesson { sourceKey: string; position: number; title: string; sourceUrl: string | null; blocks: PlanBlock[] }
export interface PlanModule { sourceKey: string; position: number; title: string; originalTitle: string; sourceUrl: string | null; lessons: PlanLesson[] }

export interface DuplicateHint { reason: string; a: string; b: string }
export interface ImportReport {
  counts: { modules: number; lessons: number; blocks: number; videos: number; audios: number; pdfs: number; externalLinks: number; texts: number };
  perModule: Array<{ module: number; lessons: number; videos: number; audios: number; pdfs: number; externalLinks: number; declared: Record<string, number | undefined>; mismatches: string[] }>;
  pendingResources: Array<{ where: string; kind: ResourceKind; originalName: string | null }>;
  duplicates: DuplicateHint[];
  notes: string[];
}
export interface ImportPlan {
  course: { slug: string; title: string; language: string; sourceNote: string };
  modules: PlanModule[];
  report: ImportReport;
}

export class InventoryError extends Error {
  constructor(readonly problems: string[]) {
    super(`Inventario no válido: ${problems.slice(0, 5).join(" · ")}${problems.length > 5 ? ` (+${problems.length - 5})` : ""}`);
  }
}

const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown, max = 600): string | null => (typeof v === "string" && v.trim() ? v.replace(/\s+/g, " ").trim().slice(0, max) : null);

/** «mm:ss» o «h:mm:ss» → segundos (null si no hay o no es válido). */
export function parseDuration(v: unknown): number | null {
  if (typeof v !== "string") return null;
  const m = /^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})$/.exec(v.trim());
  if (!m) return null;
  return (m[1] ? Number(m[1]) * 3600 : 0) + Number(m[2]) * 60 + Number(m[3]);
}

function kindOf(t: InventoryBlockType): BlockKind {
  switch (t) {
    case "texto": return "text";
    case "video": return "video";
    case "audio":
    case "audio_meditacion": return "audio";
    case "pdf": return "pdf";
    default: return "external_link";
  }
}
const normTitle = (s: string) => s.toLowerCase().replace(/[^a-z0-9äöüß]+/g, "");

export function planInventory(files: unknown[], opts: { courseSlug: string; courseTitle: string; language?: string }): ImportPlan {
  const problems: string[] = [];
  const modules: PlanModule[] = [];
  const perModule: ImportReport["perModule"] = [];
  const notes: string[] = [];
  const credits: string[] = [];
  const seenModules = new Set<number>();

  if (!Array.isArray(files) || !files.length) throw new InventoryError(["No hay ningún inventario."]);
  for (let fi = 0; fi < files.length; fi++) {
    const f = files[fi];
    const at = `Archivo ${fi + 1}`;
    if (!isObj(f)) { problems.push(`${at}: no es un objeto.`); continue; }
    const mod = f.modulo;
    if (!Number.isInteger(mod) || mod < 1 || mod > 99) { problems.push(`${at}: «modulo» debe ser un entero 1–99.`); continue; }
    if (seenModules.has(mod)) { problems.push(`${at}: el módulo ${mod} está repetido.`); continue; }
    seenModules.add(mod);
    if (!Array.isArray(f.secciones) || !f.secciones.length) { problems.push(`Módulo ${mod}: sin secciones.`); continue; }
    const sec = f.secciones[0];
    if (f.secciones.length > 1) notes.push(`Módulo ${mod}: ${f.secciones.length} secciones; el módulo toma el título de la primera y reúne todas sus lecciones.`);
    const modTitle = str(f.secciones[0]?.titulo, 300) ?? str(f.titulo, 300);
    if (!modTitle) { problems.push(`Módulo ${mod}: sin título.`); continue; }
    const origin = str(f.url, 600);
    const lessons: PlanLesson[] = [];
    const ctr = { videos: 0, audios: 0, pdfs: 0, links: 0 };
    let lessonSeq = 0;
    for (const s of f.secciones) {
      if (!isObj(s) || !Array.isArray(s.lecciones)) { problems.push(`Módulo ${mod}: sección sin lecciones.`); continue; }
      for (const l of s.lecciones) {
        if (!isObj(l)) { problems.push(`Módulo ${mod}: lección no válida.`); continue; }
        lessonSeq += 1;
        const lt = str(l.titulo, 300);
        if (!lt) { problems.push(`Módulo ${mod}, lección ${lessonSeq}: sin título.`); continue; }
        if (!Array.isArray(l.bloques)) { problems.push(`Módulo ${mod}, lección ${lessonSeq}: sin bloques.`); continue; }
        const blocks: PlanBlock[] = [];
        const orders = new Set<number>();
        for (const b of l.bloques) {
          if (!isObj(b)) { problems.push(`Módulo ${mod}, lección ${lessonSeq}: bloque no válido.`); continue; }
          const where = `M${mod} L${lessonSeq} B${b.orden}`;
          const tipo = b.tipo as InventoryBlockType;
          if (!INVENTORY_BLOCK_TYPES.includes(tipo)) { problems.push(`${where}: tipo «${String(b.tipo)}» desconocido.`); continue; }
          if (!Number.isInteger(b.orden) || b.orden < 1 || orders.has(b.orden)) { problems.push(`${where}: orden inválido o repetido.`); continue; }
          orders.add(b.orden);
          const title = str(b.titulo, 300);
          if (!title) { problems.push(`${where}: sin título.`); continue; }
          const kind = kindOf(tipo);
          const url = kind === "external_link" ? str(b.url, 600) : null;
          if (kind === "external_link" && (!url || !/^https:\/\//i.test(url))) { problems.push(`${where}: enlace sin URL https válida.`); continue; }
          const rk: ResourceKind | null = kind === "video" || kind === "audio" || kind === "pdf" ? kind : null;
          if (kind === "video") ctr.videos += 1;
          if (kind === "audio") ctr.audios += 1;
          if (kind === "pdf") ctr.pdfs += 1;
          if (kind === "external_link") ctr.links += 1;
          const attributionNote = mod === 3 && isObj(f.portada) && str(f.portada.credito_visible) ? ` · crédito visible en la portada del módulo: «${str(f.portada.credito_visible)}» (significado pendiente de verificar)` : "";
          blocks.push({
            sourceKey: `b${b.orden}`, position: b.orden, kind, title, originalTitle: title,
            body: kind === "text" ? str(b.descripcion, 4000) : str(b.etiqueta, 300),
            externalUrl: url, durationSeconds: parseDuration(b.duracion), activity: str(b.actividad, 40),
            resource: rk ? { kind: rk, originalName: str(b.archivo, 300), sizeHint: str(b.tamano, 40), provenance: `Articulate ${origin ?? ""} · módulo ${mod}, lección ${lessonSeq}, bloque ${b.orden}${tipo === "audio" || tipo === "audio_meditacion" ? " · se muestra en reproductor de vídeo (¿archivo de audio aparte?)" : ""}${attributionNote}`.trim() } : null,
          });
        }
        blocks.sort((x, y) => x.position - y.position);
        lessons.push({ sourceKey: `l${lessonSeq}`, position: lessonSeq, title: lt, sourceUrl: str(l.url, 600), blocks });
      }
    }
    if (isObj(f.portada) && str(f.portada.credito_visible)) credits.push(`Módulo ${mod}: portada con «${str(f.portada.credito_visible)}»${str(f.portada.presentacion_visible) ? ` y «${str(f.portada.presentacion_visible)}»` : ""}.`);
    for (const p of Array.isArray(f.pendientes) ? f.pendientes : []) if (str(p)) notes.push(`Módulo ${mod} · pendiente: ${str(p, 400)}`);
    const rec = isObj(f.recuento) ? f.recuento : {};
    const mism: string[] = [];
    const chk = (label: string, got: number, want: unknown) => { if (typeof want === "number" && want !== got) mism.push(`${label}: inventario ${want}, importado ${got}`); };
    chk("lecciones", lessons.length, rec.lecciones);
    chk("vídeos", ctr.videos, rec.videos);
    chk("PDF", ctr.pdfs, rec.pdf_descargables);
    chk("recursos «Audio»", ctr.audios, rec.audios_titulados);
    perModule.push({ module: mod, lessons: lessons.length, videos: ctr.videos, audios: ctr.audios, pdfs: ctr.pdfs, externalLinks: ctr.links, declared: { lecciones: rec.lecciones, videos: rec.videos, pdf: rec.pdf_descargables, audios: rec.audios_titulados }, mismatches: mism });
    modules.push({ sourceKey: `m${mod}`, position: mod, title: modTitle, originalTitle: str(f.titulo, 300) ?? modTitle, sourceUrl: origin, lessons });
  }
  if (problems.length) throw new InventoryError(problems);
  modules.sort((a, b) => a.position - b.position);

  // Posibles duplicados entre módulos (título + duración, o nombre + tamaño del fichero): se avisan, nunca se fusionan
  const duplicates: DuplicateHint[] = [];
  const index = new Map<string, string>();
  for (const m of modules) for (const l of m.lessons) for (const b of l.blocks) {
    const here = `M${m.position} L${l.position} B${b.position} «${b.title}»`;
    const keys: Array<[string, string]> = [];
    if (b.resource && b.durationSeconds != null) keys.push([`t|${b.kind}|${normTitle(b.title.replace(/\s*-\s*(video|audio|text)\s*$/i, ""))}|${b.durationSeconds}`, "mismo título y duración"]);
    if (b.resource?.originalName && b.resource.sizeHint) keys.push([`f|${b.resource.originalName.toLowerCase()}|${b.resource.sizeHint}`, "mismo nombre y tamaño de fichero"]);
    for (const [k, reason] of keys) {
      const prev = index.get(k);
      if (prev && !duplicates.some((d) => d.a === prev && d.b === here)) duplicates.push({ reason, a: prev, b: here });
      else if (!prev) index.set(k, here);
    }
  }

  const all = modules.flatMap((m) => m.lessons.flatMap((l) => l.blocks.map((b) => ({ m, l, b }))));
  const report: ImportReport = {
    counts: {
      modules: modules.length, lessons: modules.reduce((n, m) => n + m.lessons.length, 0), blocks: all.length,
      videos: all.filter((x) => x.b.kind === "video").length, audios: all.filter((x) => x.b.kind === "audio").length, pdfs: all.filter((x) => x.b.kind === "pdf").length,
      externalLinks: all.filter((x) => x.b.kind === "external_link").length, texts: all.filter((x) => x.b.kind === "text").length,
    },
    perModule,
    pendingResources: all.filter((x) => x.b.resource).map((x) => ({ where: `M${x.m.position} L${x.l.position} B${x.b.position} «${x.b.title}»`, kind: x.b.resource!.kind, originalName: x.b.resource!.originalName })),
    duplicates,
    notes,
  };
  const sourceNote = [`Importado de inventarios de Articulate (${modules.length} módulos). Las URLs de origen son solo trazabilidad.`, ...credits].join(" ").slice(0, 600);
  return { course: { slug: opts.courseSlug, title: opts.courseTitle, language: opts.language ?? "de", sourceNote }, modules, report };
}
