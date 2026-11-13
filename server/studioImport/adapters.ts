/**
 * Adaptadores reales del motor de importación: tablas `studio_import_*` (migración 0067), almacén de ficheros del Core
 * (`FileService`, categoría `import-asset`) y la capa del constructor de páginas (`pageBuilderDb`).
 *
 * Todo se resuelve contra la BD y el almacén del tenant EN CURSO (`legacyDb()`/`getDb()`/`objectRoot()` leen el
 * contexto de `runWithTenant`/`withTenantDb`): este módulo no guarda estado entre llamadas ni entre tenants.
 */
import crypto from "node:crypto";
import { sql, type SQL } from "drizzle-orm";
import { legacyDb } from "../_core/legacyDb";
import { fileService } from "../_core/files/service";
import * as builder from "../pageBuilderDb";
import type { ImportDeps, ImportStore, MediaManifestEntry, MediaStorage, PageGateway, PageRecord, RunRecord } from "./engine";
import { downloadMedia } from "./download";
import type { PageBlock } from "../../shared/pageBlocks";

type Row = Record<string, unknown>;

async function rows(q: SQL): Promise<Row[]> {
  const [r] = (await (legacyDb() as unknown as { execute: (q: SQL) => Promise<unknown> }).execute(q)) as unknown as [Row[]];
  return Array.isArray(r) ? r : [];
}
async function run(q: SQL): Promise<void> {
  await (legacyDb() as unknown as { execute: (q: SQL) => Promise<unknown> }).execute(q);
}

const urlHash = (u: string) => crypto.createHash("sha256").update(u).digest("hex");

function toMedia(r: Row): MediaManifestEntry {
  return {
    sha256: String(r.sha256), objectId: String(r.object_id), url: String(r.url), sourceUrl: String(r.source_url), originalFilename: String(r.original_filename),
    contentType: String(r.content_type), sizeBytes: Number(r.size_bytes), capturedAt: Number(r.captured_at), importRunId: String(r.import_run_id),
    alt: (r.alt as string | null) ?? null, license: (r.license as string | null) ?? null, credit: (r.credit as string | null) ?? null, sourceNote: (r.source_note as string | null) ?? null,
  };
}

export class MysqlImportStore implements ImportStore {
  async findMediaBySha(sha256: string) {
    const [r] = await rows(sql`SELECT * FROM studio_import_media WHERE sha256 = ${sha256} LIMIT 1`);
    return r ? toMedia(r) : null;
  }
  async findMediaBySourceUrl(sourceUrl: string) {
    const [r] = await rows(sql`SELECT * FROM studio_import_media WHERE source_url_hash = ${urlHash(sourceUrl)} AND source_url = ${sourceUrl} ORDER BY id DESC LIMIT 1`);
    return r ? toMedia(r) : null;
  }
  async insertMedia(m: MediaManifestEntry) {
    await run(sql`INSERT INTO studio_import_media
      (sha256, object_id, url, source_url, source_url_hash, original_filename, content_type, size_bytes, captured_at, import_run_id, alt, license, credit, source_note)
      VALUES (${m.sha256}, ${m.objectId}, ${m.url}, ${m.sourceUrl}, ${urlHash(m.sourceUrl)}, ${m.originalFilename}, ${m.contentType}, ${m.sizeBytes}, ${m.capturedAt}, ${m.importRunId}, ${m.alt ?? null}, ${m.license ?? null}, ${m.credit ?? null}, ${m.sourceNote ?? null})
      ON DUPLICATE KEY UPDATE id = id`);
  }
  async getPageRecord(slug: string): Promise<PageRecord | null> {
    const [r] = await rows(sql`SELECT * FROM studio_import_pages WHERE slug = ${slug} LIMIT 1`);
    return r ? { slug, contentHash: String(r.content_hash), writtenHash: String(r.written_hash), locale: (r.locale as string | null) ?? null, importRunId: String(r.import_run_id), updatedAt: Number(r.updated_at) } : null;
  }
  async upsertPageRecord(p: PageRecord) {
    await run(sql`INSERT INTO studio_import_pages (slug, content_hash, written_hash, locale, import_run_id, updated_at)
      VALUES (${p.slug}, ${p.contentHash}, ${p.writtenHash}, ${p.locale}, ${p.importRunId}, ${p.updatedAt})
      ON DUPLICATE KEY UPDATE content_hash = VALUES(content_hash), written_hash = VALUES(written_hash), locale = VALUES(locale), import_run_id = VALUES(import_run_id), updated_at = VALUES(updated_at)`);
  }
  async insertRun(r: RunRecord) {
    await run(sql`INSERT INTO studio_import_runs (run_id, actor, schema_version, flags, summary, report, created_at)
      VALUES (${r.runId}, ${r.actor}, ${r.schemaVersion}, ${r.flags}, ${r.summary}, ${r.report}, ${r.createdAt})`);
  }
}

export class CoreMediaStorage implements MediaStorage {
  async put(i: { data: Buffer; contentType: string; originalName: string; importRunId: string }) {
    // `put` guarda los bytes tal cual (sin recomprimir) y los verifica por SHA-256 tras subirlos
    const r = await fileService().put({ category: "import-asset", data: i.data, declaredType: i.contentType, originalName: i.originalName, owner: { type: "studio-import", id: i.importRunId } });
    return { objectId: r.objectId, url: r.url.startsWith("http") ? new URL(r.url).pathname : r.url };
  }
}

export class StudioPageGateway implements PageGateway {
  async getState(slug: string) {
    const editor = await builder.getPageEditor(slug);
    if (!editor) return null;
    return { title: editor.page.title, metaTitle: editor.page.metaTitle ?? null, metaDescription: editor.page.metaDescription ?? null, isPublished: editor.page.isPublished, blocks: editor.blocks };
  }
  async create(i: { slug: string; title: string }) {
    await builder.createSitePage({ title: i.title, slug: i.slug, template: "blank", addToMenu: false });
  }
  async saveDraft(i: { slug: string; title: string; metaTitle: string | null; metaDescription: string | null; blocks: PageBlock[] }) {
    await builder.updatePageSettings({ slug: i.slug, title: i.title, metaTitle: i.metaTitle, metaDescription: i.metaDescription });
    await builder.savePageDraft(i.slug, i.blocks);
  }
  async publish(slug: string, author: string | null) {
    await builder.publishPage(slug, undefined, author);
  }
  async setInMenu(slug: string, zone: "header" | "footer") {
    await builder.setPageInMenu(slug, zone, true);
  }
}

/** Dependencias reales para el tenant en curso. Las descargas usan la política SSRF completa (sin modo de pruebas). */
export function realImportDeps(): ImportDeps {
  return { store: new MysqlImportStore(), storage: new CoreMediaStorage(), pages: new StudioPageGateway(), download: (u) => downloadMedia(u) };
}
