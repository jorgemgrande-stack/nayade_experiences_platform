/**
 * Motor de importación de Elephant Studio: medios por URL (hash, duplicados, original intacto) y páginas en BORRADOR
 * (idempotente por hash de contenido). Trabaja contra PUERTOS (`ImportDeps`): el mismo motor sirve a la CLI, a un
 * procedimiento de servidor y a las pruebas (puertos en memoria). El motor solo escribe a través de los puertos que
 * recibe, que están ligados a UN tenant: no hay estado global ni caché compartida entre tenants.
 *
 * Reglas:
 *  - Sin `apply` es un ensayo: no escribe nada (ni medios, ni páginas, ni registro). Sí descarga y calcula hashes
 *    para poder informar de duplicados.
 *  - Nunca publica salvo `publish` explícito Y `status: "published"` en la página del documento.
 *  - Una página que ya existe solo se toca si la creó la importación y nadie la ha cambiado a mano desde entonces;
 *    en otro caso se omite salvo `overwrite` (que solo reescribe el borrador, nunca publica por sí solo).
 */
import crypto from "node:crypto";
import { normalizeBlocks } from "../_core/pageBlocks";
import type { PageBlock } from "../../shared/pageBlocks";
import { MEDIA_REF_PREFIX, isTranslation, validateImportDocument, type ImportDocument, type ImportMedia, type ImportPage } from "../../shared/studioImport";
import type { Downloaded } from "./download";

// ─── Puertos ──────────────────────────────────────────────────────────────────

export interface MediaManifestEntry {
  sha256: string;
  objectId: string;
  /** Ruta pública del medio (`/files/<id>/<nombre>`). */
  url: string;
  sourceUrl: string;
  originalFilename: string;
  contentType: string;
  sizeBytes: number;
  capturedAt: number;
  importRunId: string;
  alt?: string | null;
  license?: string | null;
  credit?: string | null;
  sourceNote?: string | null;
}

export interface PageRecord {
  slug: string;
  /** Hash del contenido importado (con los medios como `/__media/<sha256>`): decide «sin cambios». */
  contentHash: string;
  /** Hash del estado de la página justo después de escribirla: detecta ediciones manuales posteriores. */
  writtenHash: string;
  locale: string | null;
  importRunId: string;
  updatedAt: number;
}

export interface PageState {
  title: string;
  metaTitle: string | null;
  metaDescription: string | null;
  isPublished: boolean;
  /** Lo que ve el editor: borrador si lo hay; si no, lo publicado. */
  blocks: PageBlock[];
}

export interface ImportStore {
  findMediaBySha(sha256: string): Promise<MediaManifestEntry | null>;
  findMediaBySourceUrl(sourceUrl: string): Promise<MediaManifestEntry | null>;
  insertMedia(m: MediaManifestEntry): Promise<void>;
  getPageRecord(slug: string): Promise<PageRecord | null>;
  upsertPageRecord(r: PageRecord): Promise<void>;
  insertRun(r: RunRecord): Promise<void>;
}

export interface MediaStorage {
  put(input: { data: Buffer; contentType: string; originalName: string; importRunId: string }): Promise<{ objectId: string; url: string }>;
}

export interface PageGateway {
  getState(slug: string): Promise<PageState | null>;
  create(input: { slug: string; title: string }): Promise<void>;
  saveDraft(input: { slug: string; title: string; metaTitle: string | null; metaDescription: string | null; blocks: PageBlock[] }): Promise<void>;
  publish(slug: string, author: string | null): Promise<void>;
  setInMenu(slug: string, zone: "header" | "footer"): Promise<void>;
}

/**
 * Escritura de traducciones (E-1, multidioma nativo): `savePageTranslationDraft` de server/i18nService.ts. Opcional: sin
 * este puerto (E-1 aún no integrado, o empresa sin idiomas) las páginas en otro idioma se OMITEN con un aviso; nunca se
 * escriben como páginas del principal. Siempre como borrador: la importación no valida ni publica traducciones.
 */
export interface TranslationGateway {
  saveDraft(input: { translationOf: string; locale: string; slug: string; title: string; metaTitle: string | null; metaDescription: string | null; blocks: PageBlock[] }): Promise<"created" | "updated" | "unchanged">;
}

export interface ImportDeps {
  translations?: TranslationGateway;
  store: ImportStore;
  storage: MediaStorage;
  pages: PageGateway;
  download: (url: string) => Promise<Downloaded>;
  now?: () => number;
}

export interface ImportOptions {
  apply: boolean;
  publish?: boolean;
  overwrite?: boolean;
  /** Quién lanza la importación (auditoría). */
  actor: string;
  tenant: string;
  /** Reutiliza un medio ya importado con la misma URL de origen sin volver a descargarlo (por defecto, sí). */
  refreshMedia?: boolean;
  runId?: string;
}

// ─── Informe ──────────────────────────────────────────────────────────────────

export type MediaStatus = "created" | "reused" | "reused_by_source" | "duplicate_in_batch" | "error";
export type PageStatus = "created" | "updated" | "unchanged" | "skipped" | "error";

export interface MediaReportItem {
  id: string;
  sourceUrl: string;
  status: MediaStatus;
  sha256?: string;
  objectId?: string;
  url?: string;
  sizeBytes?: number;
  contentType?: string;
  /** Si es duplicado: id local del medio con el que coincide, o ref del medio ya existente. */
  duplicateOf?: string;
  error?: string;
}

export interface PageReportItem {
  slug: string;
  status: PageStatus;
  published: boolean;
  locale?: string | null;
  reason?: string;
  error?: string;
}

export interface ImportReport {
  runId: string;
  tenant: string;
  mode: "dry-run" | "apply";
  actor: string;
  startedAt: string;
  finishedAt: string;
  flags: { publish: boolean; overwrite: boolean; refreshMedia: boolean };
  schemaVersion: number;
  summary: {
    media: Record<MediaStatus, number>;
    pages: Record<PageStatus, number>;
    menuLinks: number;
    errors: number;
  };
  media: MediaReportItem[];
  duplicates: Array<{ sha256: string; ids: string[]; existingObjectId?: string }>;
  pages: PageReportItem[];
  menu: Array<{ zone: "header" | "footer"; pageSlug: string; status: "linked" | "skipped" | "error"; error?: string }>;
  errors: string[];
}

export interface RunRecord {
  runId: string;
  actor: string;
  schemaVersion: number;
  flags: string;
  summary: string;
  report: string;
  createdAt: number;
}

// ─── Utilidades ───────────────────────────────────────────────────────────────

/** JSON canónico (claves ordenadas): mismo contenido, mismo hash. */
export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(",")}}`;
  }
  return JSON.stringify(v) ?? "null";
}

export const sha256Hex = (v: string | Buffer) => crypto.createHash("sha256").update(v).digest("hex");

export function pageStateHash(s: Pick<PageState, "title" | "metaTitle" | "metaDescription" | "blocks">): string {
  return sha256Hex(canonicalJson({ title: s.title, metaTitle: s.metaTitle ?? null, metaDescription: s.metaDescription ?? null, blocks: s.blocks }));
}

interface RefCtx {
  /** Valor con el que se sustituye `media:<id>`; null = referencia sin resolver. */
  resolve: (id: string) => string | null;
  alt: (id: string) => string | null;
  onMissing: (id: string) => void;
}

/** Sustituye en profundidad las cadenas `media:<id>` (sin estado compartido: todo va en `ctx`). */
function mapRefs(value: unknown, ctx: RefCtx): unknown {
  if (typeof value === "string") {
    if (!value.startsWith(MEDIA_REF_PREFIX)) return value;
    const id = value.slice(MEDIA_REF_PREFIX.length);
    const r = ctx.resolve(id);
    if (r === null) ctx.onMissing(id);
    return r ?? "";
  }
  if (Array.isArray(value)) return value.map((v) => mapRefs(v, ctx));
  if (value && typeof value === "object") {
    const src = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(src)) out[k] = mapRefs(v, ctx);
    // Texto alternativo: si el campo está vacío y el medio referenciado lo trae, se usa
    for (const altKey of ["alt", "imageAlt"] as const) {
      if (altKey in src && !String(src[altKey] ?? "").trim()) {
        const refKey = Object.keys(src).find((k) => typeof src[k] === "string" && (src[k] as string).startsWith(MEDIA_REF_PREFIX));
        const alt = refKey ? ctx.alt(String(src[refKey]).slice(MEDIA_REF_PREFIX.length)) : null;
        if (alt) out[altKey] = alt;
      }
    }
    return out;
  }
  return value;
}

function emptyCounts<T extends string>(keys: readonly T[]): Record<T, number> {
  return Object.fromEntries(keys.map((k) => [k, 0])) as Record<T, number>;
}

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

// ─── Medios ───────────────────────────────────────────────────────────────────

interface ResolvedMedia {
  sha256: string;
  url: string;
  alt: string | null;
}

async function importMedia(doc: ImportDocument, deps: ImportDeps, o: ImportOptions, runId: string, now: () => number, report: ImportReport): Promise<Map<string, ResolvedMedia>> {
  const resolved = new Map<string, ResolvedMedia>();
  const batch = new Map<string, string>(); // sha256 → id local que lo trajo primero
  const refreshMedia = !!o.refreshMedia;
  for (const m of doc.media) {
    const item: MediaReportItem = { id: m.id, sourceUrl: m.sourceUrl, status: "error" };
    report.media.push(item);
    try {
      const known = refreshMedia ? null : await deps.store.findMediaBySourceUrl(m.sourceUrl);
      if (known) {
        Object.assign(item, { status: "reused_by_source", sha256: known.sha256, objectId: known.objectId, url: known.url, sizeBytes: known.sizeBytes, contentType: known.contentType });
        resolved.set(m.id, { sha256: known.sha256, url: known.url, alt: m.alt ?? known.alt ?? null });
        if (!batch.has(known.sha256)) batch.set(known.sha256, m.id);
        continue;
      }
      const dl = await deps.download(m.sourceUrl);
      Object.assign(item, { sha256: dl.sha256, sizeBytes: dl.sizeBytes, contentType: dl.contentType });
      const first = batch.get(dl.sha256);
      if (first) {
        // Duplicado exacto dentro del lote: se reutiliza el medio ya tratado
        const prev = resolved.get(first)!;
        Object.assign(item, { status: "duplicate_in_batch", duplicateOf: first, url: prev.url });
        resolved.set(m.id, { sha256: dl.sha256, url: prev.url, alt: m.alt ?? prev.alt });
        continue;
      }
      const existing = await deps.store.findMediaBySha(dl.sha256);
      if (existing) {
        Object.assign(item, { status: "reused", objectId: existing.objectId, url: existing.url, duplicateOf: existing.objectId });
        resolved.set(m.id, { sha256: dl.sha256, url: existing.url, alt: m.alt ?? existing.alt ?? null });
        batch.set(dl.sha256, m.id);
        continue;
      }
      const filename = (m.originalFilename?.trim() || dl.filename).slice(0, 200);
      if (!o.apply) {
        Object.assign(item, { status: "created", url: `/files/<pendiente>/${encodeURIComponent(filename)}` });
        resolved.set(m.id, { sha256: dl.sha256, url: item.url!, alt: m.alt ?? null });
        batch.set(dl.sha256, m.id);
        continue;
      }
      const put = await deps.storage.put({ data: dl.data, contentType: dl.contentType, originalName: filename, importRunId: runId });
      await deps.store.insertMedia({
        sha256: dl.sha256, objectId: put.objectId, url: put.url, sourceUrl: m.sourceUrl, originalFilename: filename, contentType: dl.contentType,
        sizeBytes: dl.sizeBytes, capturedAt: now(), importRunId: runId, alt: m.alt ?? null, license: m.license ?? null, credit: m.credit ?? null, sourceNote: m.sourceNote ?? null,
      });
      Object.assign(item, { status: "created", objectId: put.objectId, url: put.url });
      resolved.set(m.id, { sha256: dl.sha256, url: put.url, alt: m.alt ?? null });
      batch.set(dl.sha256, m.id);
    } catch (e) {
      item.status = "error";
      item.error = errMsg(e);
      report.errors.push(`media ${m.id}: ${item.error}`);
    }
  }
  // Informe de duplicados: agrupa por hash los medios que no son la primera aparición
  const groups = new Map<string, { ids: string[]; existingObjectId?: string }>();
  for (const it of report.media) {
    if (!it.sha256 || (it.status !== "duplicate_in_batch" && it.status !== "reused")) continue;
    const g = groups.get(it.sha256) ?? { ids: [] as string[], existingObjectId: undefined };
    if (it.status === "reused") g.existingObjectId = it.objectId;
    g.ids.push(it.id);
    if (it.duplicateOf && it.status === "duplicate_in_batch" && !g.ids.includes(it.duplicateOf)) g.ids.unshift(it.duplicateOf);
    groups.set(it.sha256, g);
  }
  for (const [sha, g] of Array.from(groups.entries())) report.duplicates.push({ sha256: sha, ...g });
  return resolved;
}

// ─── Páginas ──────────────────────────────────────────────────────────────────

/** Ids de bloque deterministas (misma página, mismo contenido → mismos ids): sin ellos cada pasada cambiaría el hash. */
function stableBlockId(slug: string, index: number, given?: string): string {
  return given ?? `imp-${sha256Hex(`${slug}:${index}`).slice(0, 10)}-${index}`;
}

function prepareBlocks(page: ImportPage): unknown[] {
  return page.blocks.map((b, i) => {
    const { locale: _locale, ...rest } = b;
    return { ...rest, id: stableBlockId(page.slug, i, b.id) };
  });
}

async function importPages(doc: ImportDocument, media: Map<string, ResolvedMedia>, deps: ImportDeps, o: ImportOptions, runId: string, now: () => number, report: ImportReport) {
  const failedMedia = new Set(report.media.filter((m) => m.status === "error").map((m) => m.id));
  for (const page of doc.pages) {
    const item: PageReportItem = { slug: page.slug, status: "error", published: false, locale: page.locale ?? null };
    report.pages.push(item);
    try {
      const missing = new Set<string>();
      const raw = prepareBlocks(page);
      // Para el hash, cada medio es su SHA-256 (estable aunque cambie el id de objeto o aún no exista en un ensayo)
      const alt = (id: string) => media.get(id)?.alt ?? null;
      const forHash = raw.map((b) => mapRefs(b, { resolve: (id) => (media.has(id) ? `/__media/${media.get(id)!.sha256}` : null), alt, onMissing: (id) => missing.add(id) }));
      if (missing.size) {
        const bad = Array.from(missing).map((id) => (failedMedia.has(id) ? `${id} (falló su descarga)` : id));
        throw new Error(`Faltan medios para esta página: ${bad.join(", ")}`);
      }
      const finalRaw = raw.map((b) => mapRefs(b, { resolve: (id) => media.get(id)?.url ?? null, alt, onMissing: () => undefined }));
      const blocks = normalizeBlocks(finalRaw); // validación y saneado del Studio (lanza con mensaje claro)
      const normalizedForHash = normalizeBlocks(forHash);
      const metaTitle = page.seo?.title?.trim() || null;
      const metaDescription = page.seo?.description?.trim() || null;
      const contentHash = sha256Hex(canonicalJson({ title: page.title.trim(), locale: page.locale ?? null, metaTitle, metaDescription, blocks: normalizedForHash }));

      if (isTranslation(doc, page)) {
        if (!deps.translations) {
          item.status = "skipped";
          item.reason = `Página en idioma «${page.locale}» distinto del principal: el multidioma (E-1) no está disponible en esta ejecución; no se importa`;
          continue;
        }
        item.status = "unchanged";
        if (o.apply) {
          item.status = await deps.translations.saveDraft({ translationOf: page.translationOf!, locale: page.locale!, slug: page.slug, title: page.title.trim(), metaTitle, metaDescription, blocks });
        } else item.reason = "Traducción: el ensayo no la compara";
        continue;
      }
      const state = await deps.pages.getState(page.slug);
      const record = state ? await deps.store.getPageRecord(page.slug) : null;
      const wantPublish = !!o.publish && page.status === "published";
      let kind: "created" | "updated";

      if (!state) kind = "created";
      else {
        const manual = !record || pageStateHash(state) !== record.writtenHash;
        if (manual && !o.overwrite) {
          item.status = "skipped";
          item.published = state.isPublished;
          item.reason = !record ? "La página ya existe y no la creó una importación (use --overwrite para reescribir su borrador)" : "La página se ha modificado a mano desde la última importación (use --overwrite)";
          continue;
        }
        if (!manual && record!.contentHash === contentHash && !(wantPublish && !state.isPublished)) {
          item.status = "unchanged";
          item.published = state.isPublished;
          continue;
        }
        kind = "updated";
        if (manual) item.reason = "Reescrita con --overwrite";
      }

      item.status = kind;
      if (!o.apply) {
        item.published = wantPublish;
        continue;
      }
      if (kind === "created") await deps.pages.create({ slug: page.slug, title: page.title.trim() });
      await deps.pages.saveDraft({ slug: page.slug, title: page.title.trim(), metaTitle, metaDescription, blocks });
      if (wantPublish) {
        await deps.pages.publish(page.slug, `importación ${runId}`);
        item.published = true;
      }
      const after = await deps.pages.getState(page.slug);
      if (!after) throw new Error("La página no se puede releer tras escribirla");
      await deps.store.upsertPageRecord({ slug: page.slug, contentHash, writtenHash: pageStateHash(after), locale: page.locale ?? null, importRunId: runId, updatedAt: now() });
    } catch (e) {
      item.status = "error";
      item.error = errMsg(e);
      report.errors.push(`página ${page.slug}: ${item.error}`);
    }
  }
}

async function importMenu(doc: ImportDocument, deps: ImportDeps, o: ImportOptions, report: ImportReport) {
  const failed = new Set(report.pages.filter((p) => p.status === "error" || p.status === "skipped").map((p) => p.slug));
  for (const zone of ["header", "footer"] as const) {
    for (const it of doc.menu?.[zone] ?? []) {
      const entry = { zone, pageSlug: it.pageSlug, status: "linked" as "linked" | "skipped" | "error", error: undefined as string | undefined };
      report.menu.push(entry);
      if (failed.has(it.pageSlug)) {
        entry.status = "skipped";
        continue;
      }
      if (!o.apply) continue;
      try {
        await deps.pages.setInMenu(it.pageSlug, zone);
        report.summary.menuLinks++;
      } catch (e) {
        entry.status = "error";
        entry.error = errMsg(e);
        report.errors.push(`menú ${zone}/${it.pageSlug}: ${entry.error}`);
      }
    }
  }
}

// ─── Punto de entrada ─────────────────────────────────────────────────────────

export async function runImport(raw: unknown, deps: ImportDeps, o: ImportOptions): Promise<ImportReport> {
  const now = deps.now ?? Date.now;
  const runId = o.runId ?? `imp-${now().toString(36)}-${crypto.randomBytes(4).toString("hex")}`;
  const startedAt = new Date(now()).toISOString();
  const base: ImportReport = {
    runId, tenant: o.tenant, mode: o.apply ? "apply" : "dry-run", actor: o.actor, startedAt, finishedAt: startedAt,
    flags: { publish: !!o.publish, overwrite: !!o.overwrite, refreshMedia: !!o.refreshMedia }, schemaVersion: 0,
    summary: { media: emptyCounts(["created", "reused", "reused_by_source", "duplicate_in_batch", "error"] as const), pages: emptyCounts(["created", "updated", "unchanged", "skipped", "error"] as const), menuLinks: 0, errors: 0 },
    media: [], duplicates: [], pages: [], menu: [], errors: [],
  };
  const v = validateImportDocument(raw);
  if (!v.ok || !v.doc) {
    base.errors = v.errors.map((e) => `documento: ${e}`);
    base.summary.errors = base.errors.length;
    return base; // un documento inválido no toca nada ni deja registro
  }
  const doc = v.doc;
  base.schemaVersion = doc.schemaVersion;
  const media = await importMedia(doc, deps, o, runId, now, base);
  await importPages(doc, media, deps, o, runId, now, base);
  await importMenu(doc, deps, o, base);
  for (const m of base.media) base.summary.media[m.status]++;
  for (const p of base.pages) base.summary.pages[p.status]++;
  base.summary.errors = base.errors.length;
  base.finishedAt = new Date(now()).toISOString();
  if (o.apply) {
    // Auditoría: quién, cuándo, con qué opciones y qué resultó (solo al aplicar; el ensayo no escribe nada)
    const json = JSON.stringify(base);
    await deps.store.insertRun({
      runId, actor: o.actor.slice(0, 120), schemaVersion: doc.schemaVersion, flags: JSON.stringify(base.flags), summary: JSON.stringify(base.summary),
      report: json.length > 900_000 ? JSON.stringify({ ...base, media: [], pages: base.pages.map((p) => ({ slug: p.slug, status: p.status })), truncated: true }) : json, createdAt: now(),
    });
  }
  return base;
}

/** Informe en Markdown para quien opera la importación. */
export function reportToMarkdown(r: ImportReport): string {
  const L: string[] = [];
  L.push(`# Informe de importación ${r.runId}`, "", `- Tenant: \`${r.tenant}\``, `- Modo: **${r.mode === "apply" ? "aplicado" : "ensayo (no se ha escrito nada)"}**`, `- Operador: ${r.actor}`, `- Inicio: ${r.startedAt} · Fin: ${r.finishedAt}`, `- Opciones: publicar=${r.flags.publish}, overwrite=${r.flags.overwrite}, refrescar medios=${r.flags.refreshMedia}`, "");
  const m = r.summary.media;
  const p = r.summary.pages;
  L.push("## Resumen", "", `- Medios: ${m.created} nuevos, ${m.reused} reutilizados por hash, ${m.reused_by_source} por URL de origen, ${m.duplicate_in_batch} duplicados en el lote, ${m.error} con error`);
  L.push(`- Páginas: ${p.created} creadas, ${p.updated} actualizadas, ${p.unchanged} sin cambios, ${p.skipped} omitidas, ${p.error} con error`, `- Enlaces de menú: ${r.summary.menuLinks}`, `- Errores: ${r.summary.errors}`, "");
  if (r.duplicates.length) {
    L.push("## Duplicados", "");
    for (const d of r.duplicates) L.push(`- \`${d.sha256.slice(0, 12)}…\`: ${d.ids.join(", ")}${d.existingObjectId ? ` (ya existía como ${d.existingObjectId})` : ""}`);
    L.push("");
  }
  if (r.media.length) {
    L.push("## Medios", "", "| Id | Estado | Hash | Tamaño | Tipo |", "|---|---|---|---|---|");
    for (const x of r.media) L.push(`| ${x.id} | ${x.status}${x.error ? `: ${x.error}` : ""} | ${x.sha256?.slice(0, 12) ?? ""} | ${x.sizeBytes ?? ""} | ${x.contentType ?? ""} |`);
    L.push("");
  }
  if (r.pages.length) {
    L.push("## Páginas", "", "| Dirección | Estado | Publicada | Detalle |", "|---|---|---|---|");
    for (const x of r.pages) L.push(`| ${x.slug} | ${x.status} | ${x.published ? "sí" : "no"} | ${x.error ?? x.reason ?? ""} |`);
    L.push("");
  }
  if (r.errors.length) L.push("## Errores", "", ...r.errors.map((e) => `- ${e}`), "");
  return L.join("\n");
}

