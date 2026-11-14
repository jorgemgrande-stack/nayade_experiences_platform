/**
 * Importación de Studio: validador del formato, SSRF y descarga (servidor HTTP local de prueba), hash y duplicados,
 * idempotencia, ensayo sin escritura, reglas de publicación/sobrescritura y aislamiento entre tenants.
 * Sin base de datos ni red real: puertos en memoria y dominios de ejemplo.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import fs from "node:fs";
import path from "node:path";
import { importJsonSchema, validateImportDocument } from "../../shared/studioImport";
import { blockedHostReason, isBlockedAddress, resolvePublicAddress } from "./netGuard";
import { downloadMedia, DownloadError } from "./download";
import {
  pageStateHash, reportToMarkdown, runImport, sha256Hex,
  type ImportDeps, type ImportStore, type MediaManifestEntry, type PageGateway, type PageRecord, type PageState, type RunRecord,
} from "./engine";
import type { PageBlock } from "../../shared/pageBlocks";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const PNG_A = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("imagen-a-ejemplo")]);
const PNG_B = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("imagen-b-ejemplo")]);
const PDF = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.from("documento de ejemplo")]);

let server: http.Server;
let base: string;
const hits: string[] = [];

beforeAll(async () => {
  server = http.createServer((req, res) => {
    hits.push(req.url ?? "");
    const send = (status: number, type: string, body: Buffer | string, extra: Record<string, string> = {}) => {
      res.writeHead(status, { "content-type": type, ...extra });
      res.end(body);
    };
    switch (req.url) {
      case "/a.png": return send(200, "image/png", PNG_A);
      case "/a-copia.png": return send(200, "image/png", PNG_A);
      case "/b.png": return send(200, "image/png", PNG_B);
      case "/doc.pdf": return send(200, "application/pdf", PDF);
      case "/redir": return send(302, "text/plain", "", { location: "/a.png" });
      case "/loop": return send(302, "text/plain", "", { location: "/loop" });
      case "/to-internal": return send(302, "text/plain", "", { location: "https://169.254.169.254/latest/meta-data" });
      case "/html": return send(200, "text/html", "<html></html>");
      case "/disfraz.png": return send(200, "image/png", "<html><script>x</script></html>");
      case "/gz.png": return send(200, "image/png", PNG_A, { "content-encoding": "gzip" });
      case "/big.png": return send(200, "image/png", Buffer.concat([PNG_A, Buffer.alloc(3000)]));
      case "/lento.png": return void setTimeout(() => send(200, "image/png", PNG_A), 600);
      default: return send(404, "text/plain", "no");
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://files.example.test:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

/** Resolutor de prueba: los dominios de ejemplo apuntan al servidor local. */
const localResolver = async () => ["127.0.0.1"];
const dl = (u: string, o: Parameters<typeof downloadMedia>[1] = {}) => downloadMedia(u, { unsafeTestMode: true, resolver: localResolver, ...o });

// ─── Validador ───────────────────────────────────────────────────────────────

const validDoc = () => ({
  schemaVersion: 1,
  site: { defaultLocale: "es" },
  media: [{ id: "hero", sourceUrl: "https://files.example.test/a.png", originalFilename: "portada.png", alt: "Portada de ejemplo", license: "CC-BY", credit: "Autor de ejemplo", sourceNote: "Archivo de muestra" }],
  pages: [
    {
      slug: "inicio-ejemplo", title: "Inicio de ejemplo", locale: "es", seo: { title: "Titulo seo", description: "Descripcion seo" },
      blocks: [
        { type: "hero", data: { title: "Hola", subtitle: "Mundo", imageUrl: "media:hero", imageAlt: "", buttonLabel: "Ir", buttonUrl: "/contacto" } },
        { type: "text", data: { title: "Texto", html: "<p>Un párrafo <strong>de ejemplo</strong></p>", align: "left" } },
      ],
    },
  ],
  menu: { header: [{ pageSlug: "inicio-ejemplo" }] },
});

describe("validador del formato", () => {
  it("acepta un documento válido y aplica el estado BORRADOR por defecto", () => {
    const v = validateImportDocument(validDoc());
    expect(v.ok).toBe(true);
    expect(v.doc!.pages[0].status).toBe("draft");
  });
  it("rechaza versión desconocida, claves extra y tipos de bloque inexistentes", () => {
    expect(validateImportDocument({ ...validDoc(), schemaVersion: 2 }).ok).toBe(false);
    expect(validateImportDocument({ ...validDoc(), extra: 1 }).ok).toBe(false);
    const d = validDoc();
    (d.pages[0].blocks[0] as { type: string }).type = "inexistente";
    expect(validateImportDocument(d).ok).toBe(false);
  });
  it("detecta ids de medio repetidos, referencias rotas, slugs repetidos o inválidos y menú huérfano", () => {
    const d = validDoc();
    d.media.push({ ...d.media[0] });
    d.pages.push({ ...d.pages[0] });
    d.pages[0].blocks[1].data = { title: "x", html: "media:no-existe" };
    d.pages.push({ slug: "Mal Slug", title: "x", blocks: [] } as never);
    d.menu = { header: [{ pageSlug: "otra" }] };
    const v = validateImportDocument(d);
    expect(v.ok).toBe(false);
    const all = v.errors.join("\n");
    expect(all).toContain("repetido");
    expect(all).toContain("no existe");
    expect(all).toContain("slug");
    expect(all).toContain("menu.header[0]");
  });
  it("exige https y sin credenciales en los medios; valida el idioma opcional", () => {
    const d = validDoc();
    d.media[0].sourceUrl = "http://files.example.test/a.png";
    expect(validateImportDocument(d).errors.join()).toContain("https");
    const d2 = validDoc();
    d2.media[0].sourceUrl = "https://usuario:clave@files.example.test/a.png";
    expect(validateImportDocument(d2).ok).toBe(false);
    const d3 = validDoc();
    (d3.pages[0] as { locale: string }).locale = "es_ES!";
    expect(validateImportDocument(d3).ok).toBe(false);
    (d3.pages[0] as { locale: string }).locale = "pt-BR"; // E-1: minúsculas
    expect(validateImportDocument(d3).ok).toBe(false);
    const dt = validDoc();
    (dt.pages as unknown[]).push({ slug: "seite", title: "Seite", locale: "de", blocks: [] });
    expect(validateImportDocument(dt).errors.join()).toContain("translationOf");
    (dt.pages[1] as { translationOf?: string }).translationOf = "inicio-ejemplo";
    expect(validateImportDocument(dt).ok).toBe(true);
    const d4 = validDoc();
    delete (d4.pages[0] as { locale?: string }).locale;
    expect(validateImportDocument(d4).ok).toBe(true);
  });
  it("el JSON Schema publicado en docs/ coincide con el generado", () => {
    const file = path.resolve(__dirname, "../../docs/studio/import-format.schema.json");
    expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual(JSON.parse(JSON.stringify(importJsonSchema())));
  });
});

// ─── SSRF ────────────────────────────────────────────────────────────────────

describe("bloqueo SSRF", () => {
  it.each([
    "127.0.0.1", "127.8.9.10", "10.0.0.5", "172.16.3.4", "172.31.255.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "255.255.255.255",
    "::1", "::", "fe80::1", "fc00::1", "fd12:3456::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:169.254.169.254", "64:ff9b::a9fe:a9fe", "2002:7f00:1::1",
  ])("bloquea %s", (ip) => expect(isBlockedAddress(ip)).toBe(true));
  it.each(["8.8.8.8", "93.184.216.34", "2606:4700:4700::1111", "172.32.0.1", "11.0.0.1"])("permite %s", (ip) => expect(isBlockedAddress(ip)).toBe(false));
  it("rechaza hosts internos por nombre", () => {
    for (const h of ["localhost", "app.localhost", "metadata.google.internal", "servidor.local", "intranet", "x.internal"]) expect(blockedHostReason(h)).not.toBeNull();
    expect(blockedHostReason("files.example.com")).toBeNull();
  });
  it("rechaza un host si CUALQUIERA de sus direcciones es privada (DNS mixto)", async () => {
    await expect(resolvePublicAddress("files.example.com", async () => ["93.184.216.34", "127.0.0.1"])).rejects.toThrow(/no permitido/);
    await expect(resolvePublicAddress("files.example.com", async () => ["93.184.216.34"])).resolves.toBe("93.184.216.34");
  });
  it("las formas numéricas de IP (decimal, hex, octal) se normalizan y se bloquean", async () => {
    for (const u of ["https://2130706433/a.png", "https://0x7f000001/a.png", "https://0177.0.0.1/a.png", "https://[::1]/a.png", "https://[::ffff:127.0.0.1]/a.png", "https://localhost/a.png", "https://169.254.169.254/latest/meta-data"]) {
      await expect(downloadMedia(u, { resolver: async () => ["93.184.216.34"] })).rejects.toMatchObject({ code: "blocked" });
    }
  });
  it("sin modo de pruebas rechaza http y el servidor local aunque el nombre parezca público", async () => {
    await expect(downloadMedia(`${base}/a.png`, { resolver: localResolver })).rejects.toMatchObject({ code: "url" });
    await expect(downloadMedia("https://files.example.test/a.png", { resolver: localResolver })).rejects.toMatchObject({ code: "blocked" });
  });
  it("DNS rebinding: se conecta a la IP validada, no a una segunda resolución", async () => {
    let calls = 0;
    const flip = async () => (++calls === 1 ? ["127.0.0.1"] : ["10.0.0.9"]);
    const r = await dl(`${base}/a.png`, { resolver: flip });
    expect(r.sha256).toBe(sha256Hex(PNG_A));
    expect(calls).toBe(1); // una sola resolución por salto: el socket usa la IP ya validada
  });
  it("una redirección a una IP interna (metadatos de la nube) se bloquea al revalidar el destino", async () => {
    await expect(dl(`${base}/to-internal`)).rejects.toMatchObject({ code: "blocked" });
  });
  it("un nombre que resuelve a una red privada (no loopback) se rechaza también en modo de pruebas", async () => {
    await expect(dl(`${base}/a.png`, { resolver: async () => ["10.1.2.3"] })).rejects.toMatchObject({ code: "blocked" });
  });
});

// ─── Descarga ────────────────────────────────────────────────────────────────

describe("descarga de medios", () => {
  it("conserva el original byte a byte y calcula su SHA-256", async () => {
    const r = await dl(`${base}/a.png`);
    expect(Buffer.compare(r.data, PNG_A)).toBe(0);
    expect(r.sha256).toBe(sha256Hex(PNG_A));
    expect(r.contentType).toBe("image/png");
    expect(r.filename).toBe("a.png");
  });
  it("acepta PDF y sigue redirecciones limitadas", async () => {
    expect((await dl(`${base}/doc.pdf`)).contentType).toBe("application/pdf");
    expect((await dl(`${base}/redir`)).redirects).toBe(1);
    await expect(dl(`${base}/loop`)).rejects.toMatchObject({ code: "redirect" });
  });
  it("rechaza tipos no permitidos, contenido que no coincide, compresión, tamaño y tiempo", async () => {
    await expect(dl(`${base}/html`)).rejects.toMatchObject({ code: "type" });
    await expect(dl(`${base}/disfraz.png`)).rejects.toMatchObject({ code: "type" });
    await expect(dl(`${base}/gz.png`)).rejects.toMatchObject({ code: "encoding" });
    await expect(dl(`${base}/big.png`, { maxBytes: 1000 })).rejects.toMatchObject({ code: "size" });
    await expect(dl(`${base}/lento.png`, { timeoutMs: 150 })).rejects.toMatchObject({ code: "timeout" });
    await expect(dl(`${base}/nada`)).rejects.toMatchObject({ code: "status" });
  });
});

// ─── Puertos en memoria (un tenant = un conjunto de puertos) ─────────────────

class MemTenant {
  media: MediaManifestEntry[] = [];
  records = new Map<string, PageRecord>();
  runs: RunRecord[] = [];
  objects: Array<{ id: string; data: Buffer; name: string }> = [];
  pages = new Map<string, { title: string; metaTitle: string | null; metaDescription: string | null; isPublished: boolean; draft: PageBlock[] | null; published: PageBlock[] | null }>();
  menu: string[] = [];
  writes = 0;
  constructor(readonly name: string) {}

  store: ImportStore = {
    findMediaBySha: async (s) => this.media.find((m) => m.sha256 === s) ?? null,
    findMediaBySourceUrl: async (u) => this.media.find((m) => m.sourceUrl === u) ?? null,
    insertMedia: async (m) => { this.writes++; this.media.push(m); },
    getPageRecord: async (s) => this.records.get(s) ?? null,
    upsertPageRecord: async (r) => { this.writes++; this.records.set(r.slug, r); },
    insertRun: async (r) => { this.writes++; this.runs.push(r); },
  };
  pagesPort: PageGateway = {
    getState: async (slug) => {
      const p = this.pages.get(slug);
      return p ? ({ title: p.title, metaTitle: p.metaTitle, metaDescription: p.metaDescription, isPublished: p.isPublished, blocks: p.draft ?? p.published ?? [] } satisfies PageState) : null;
    },
    create: async ({ slug, title }) => { this.writes++; this.pages.set(slug, { title, metaTitle: title, metaDescription: null, isPublished: false, draft: [], published: null }); },
    saveDraft: async (i) => { this.writes++; const p = this.pages.get(i.slug)!; Object.assign(p, { title: i.title, metaTitle: i.metaTitle, metaDescription: i.metaDescription, draft: i.blocks }); },
    publish: async (slug) => { this.writes++; const p = this.pages.get(slug)!; p.published = p.draft; p.draft = null; p.isPublished = true; },
    setInMenu: async (slug, zone) => { this.writes++; if (!this.menu.includes(`${zone}:${slug}`)) this.menu.push(`${zone}:${slug}`); },
  };
  deps(download: ImportDeps["download"] = (u) => dl(u)): ImportDeps {
    let n = 0;
    return {
      store: this.store, pages: this.pagesPort, download,
      storage: { put: async (i) => { this.writes++; const id = `${this.name}${String(++n).padStart(3, "0")}`.padEnd(26, "0"); this.objects.push({ id, data: i.data, name: i.originalName }); return { objectId: id, url: `/files/${id}/${encodeURIComponent(i.originalName)}` }; } },
    };
  }
}

const doc = () => ({
  schemaVersion: 1,
  media: [
    { id: "m1", sourceUrl: `${base.replace("http:", "https:")}/a.png`, originalFilename: "uno.png", alt: "Alt uno" },
    { id: "m2", sourceUrl: `${base.replace("http:", "https:")}/a-copia.png`, originalFilename: "dos.png" },
    { id: "m3", sourceUrl: `${base.replace("http:", "https:")}/b.png`, originalFilename: "tres.png", license: "CC0" },
  ],
  pages: [
    {
      slug: "pagina-uno", title: "Página uno", seo: { title: "SEO uno", description: "Desc uno" },
      blocks: [
        { type: "hero", data: { title: "Hola", subtitle: "", imageUrl: "media:m1", imageAlt: "", buttonLabel: "", buttonUrl: "" } },
        { type: "gallery", data: { title: "Galería", images: [{ url: "media:m2", alt: "" }, { url: "media:m3", alt: "Tres" }], layout: "grid", lightbox: "on" } },
      ],
    },
    { slug: "pagina-dos", title: "Página dos", locale: "es", blocks: [{ type: "text", data: { title: "T", html: "<p>Hola</p>", align: "left" } }] },
  ],
  menu: { header: [{ pageSlug: "pagina-uno" }] },
});

// La descarga de las pruebas usa http local: se redirige https://files.example.test:<puerto> al servidor local
const localDownload: ImportDeps["download"] = (u) => dl(u.replace("https:", "http:"));
const opts = (t: MemTenant, o: Partial<Parameters<typeof runImport>[2]> = {}) => ({ apply: true, actor: "prueba", tenant: t.name, ...o });

describe("importador: medios y duplicados", () => {
  it("crea medios, detecta el duplicado exacto del lote y lo informa; el original queda intacto", async () => {
    const t = new MemTenant("tenanta");
    const r = await runImport(doc(), t.deps(localDownload), opts(t));
    expect(r.summary.media).toMatchObject({ created: 2, duplicate_in_batch: 1, error: 0 });
    expect(t.objects).toHaveLength(2); // el duplicado no genera un segundo objeto
    expect(Buffer.compare(t.objects[0].data, PNG_A)).toBe(0);
    expect(r.duplicates).toEqual([{ sha256: sha256Hex(PNG_A), ids: ["m1", "m2"] }]);
    const manifest = t.media.find((m) => m.sha256 === sha256Hex(PNG_A))!;
    expect(manifest).toMatchObject({ originalFilename: "uno.png", contentType: "image/png", sizeBytes: PNG_A.length, importRunId: r.runId });
    expect(manifest.capturedAt).toBeGreaterThan(0);
    expect(manifest.sourceUrl).toContain("/a.png");
  });
  it("reutiliza un medio ya existente en el tenant (mismo hash, otra URL) sin duplicarlo", async () => {
    const t = new MemTenant("tenanta");
    await runImport(doc(), t.deps(localDownload), opts(t));
    const before = t.objects.length;
    const d = doc();
    d.media = [{ id: "otro", sourceUrl: `${base.replace("http:", "https:")}/a-copia.png`, originalFilename: "otro.png" } as never];
    d.pages = [];
    d.menu = undefined as never;
    // misma URL ya vista: reutilizada por origen sin descargar; con refresh se descarga y se reutiliza por hash
    const r1 = await runImport(d, t.deps(localDownload), opts(t));
    expect(r1.summary.media.reused_by_source + r1.summary.media.reused).toBe(1);
    const r2 = await runImport(d, t.deps(localDownload), opts(t, { refreshMedia: true }));
    expect(r2.media[0]).toMatchObject({ status: "reused" });
    expect(t.objects.length).toBe(before);
  });
  it("un medio que falla no impide el resto, y la página que lo usa no se escribe", async () => {
    const t = new MemTenant("tenanta");
    const d = doc();
    d.media[0].sourceUrl = `${base.replace("http:", "https:")}/html`;
    const r = await runImport(d, t.deps(localDownload), opts(t));
    expect(r.summary.media.error).toBe(1);
    expect(r.pages.find((p) => p.slug === "pagina-uno")).toMatchObject({ status: "error" });
    expect(r.pages.find((p) => p.slug === "pagina-dos")).toMatchObject({ status: "created" });
    expect(t.pages.has("pagina-uno")).toBe(false);
    expect(r.summary.errors).toBeGreaterThan(0);
  });
});

describe("importador: páginas, idempotencia y publicación", () => {
  it("crea en BORRADOR (sin publicar), resuelve los medios y el alt, y deja el menú", async () => {
    const t = new MemTenant("tenanta");
    const r = await runImport(doc(), t.deps(localDownload), opts(t, { publish: true })); // --publish sin status "published": no publica
    expect(r.summary.pages).toMatchObject({ created: 2, error: 0 });
    const p = t.pages.get("pagina-uno")!;
    expect(p.isPublished).toBe(false);
    expect(p.published).toBeNull();
    const hero = p.draft![0] as Extract<PageBlock, { type: "hero" }>;
    expect(hero.data.imageUrl).toMatch(/^\/files\/tenanta001/);
    expect(hero.data.imageAlt).toBe("Alt uno"); // alt tomado del medio
    const gal = p.draft![1] as Extract<PageBlock, { type: "gallery" }>;
    expect(gal.data.images[0].url).toBe(hero.data.imageUrl); // duplicado del lote: mismo medio
    expect(p.metaTitle).toBe("SEO uno");
    expect(t.menu).toEqual(["header:pagina-uno"]);
  });
  it("es idempotente: repetir no duplica ni escribe (sin cambios) y actualiza solo si cambia el contenido", async () => {
    const t = new MemTenant("tenanta");
    await runImport(doc(), t.deps(localDownload), opts(t));
    const objects = t.objects.length;
    const writes = t.writes;
    const r2 = await runImport(doc(), t.deps(localDownload), opts(t));
    expect(r2.summary.pages).toMatchObject({ unchanged: 2, created: 0, updated: 0 });
    expect(r2.summary.media).toMatchObject({ reused_by_source: 2, duplicate_in_batch: 1 });
    expect(t.objects.length).toBe(objects);
    expect(t.writes - writes).toBe(2); // el registro de auditoría y el enlace de menú (idempotente: ya existía)
    const changed = doc();
    changed.pages[1].title = "Página dos (cambiada)";
    const r3 = await runImport(changed, t.deps(localDownload), opts(t));
    expect(r3.summary.pages).toMatchObject({ unchanged: 1, updated: 1 });
    const r4 = await runImport(changed, t.deps(localDownload), opts(t));
    expect(r4.summary.pages).toMatchObject({ unchanged: 2 });
  });
  it("publica solo con --publish Y status published; después sigue siendo idempotente", async () => {
    const t = new MemTenant("tenanta");
    const d = doc();
    (d.pages[1] as { status?: string }).status = "published";
    await runImport(d, t.deps(localDownload), opts(t));
    expect(t.pages.get("pagina-dos")!.isPublished).toBe(false);
    const r = await runImport(d, t.deps(localDownload), opts(t, { publish: true }));
    expect(r.pages.find((p) => p.slug === "pagina-dos")).toMatchObject({ status: "updated", published: true });
    expect(t.pages.get("pagina-dos")!.isPublished).toBe(true);
    expect(t.pages.get("pagina-uno")!.isPublished).toBe(false);
    const again = await runImport(d, t.deps(localDownload), opts(t, { publish: true }));
    expect(again.summary.pages.unchanged).toBe(2);
  });
  it("no pisa una página existente creada a mano, ni una editada a mano tras importarla, salvo --overwrite (solo borrador)", async () => {
    const t = new MemTenant("tenanta");
    t.pages.set("pagina-dos", { title: "A mano", metaTitle: null, metaDescription: null, isPublished: true, draft: null, published: [] });
    const r = await runImport(doc(), t.deps(localDownload), opts(t));
    expect(r.pages.find((p) => p.slug === "pagina-dos")).toMatchObject({ status: "skipped" });
    expect(t.pages.get("pagina-dos")!.title).toBe("A mano");
    // con overwrite se reescribe el borrador pero NO se publica
    const o = await runImport(doc(), t.deps(localDownload), opts(t, { overwrite: true }));
    expect(o.pages.find((p) => p.slug === "pagina-dos")).toMatchObject({ status: "updated", published: false });
    expect(t.pages.get("pagina-dos")!.published).toEqual([]);
    expect(t.pages.get("pagina-dos")!.isPublished).toBe(true);
    // edición manual posterior a una importación
    const t2 = new MemTenant("tenantb");
    await runImport(doc(), t2.deps(localDownload), opts(t2));
    t2.pages.get("pagina-uno")!.title = "Editada por la persona";
    const changed = doc();
    changed.pages[0].title = "Nuevo título importado";
    const r2 = await runImport(changed, t2.deps(localDownload), opts(t2));
    expect(r2.pages.find((p) => p.slug === "pagina-uno")).toMatchObject({ status: "skipped" });
    expect(t2.pages.get("pagina-uno")!.title).toBe("Editada por la persona");
  });
  it("conserva el idioma opcional de la página en el registro sin alterar la página", async () => {
    const t = new MemTenant("tenanta");
    await runImport(doc(), t.deps(localDownload), opts(t));
    expect(t.records.get("pagina-dos")!.locale).toBe("es");
    expect(t.records.get("pagina-uno")!.locale).toBeNull();
  });
  it("una página en otro idioma NUNCA se escribe como página del principal: se omite sin multidioma, o va al puerto de traducciones como borrador", async () => {
    const d = doc();
    (d.pages as unknown[]).push({ slug: "seite-eins", title: "Seite eins", locale: "de", translationOf: "pagina-uno", blocks: [{ type: "text", data: { title: "T", html: "<p>Hallo</p>", align: "left" } }] });
    const t = new MemTenant("tenanta");
    const r = await runImport(d, t.deps(localDownload), opts(t));
    expect(r.pages.find((p) => p.slug === "seite-eins")).toMatchObject({ status: "skipped" });
    expect(t.pages.has("seite-eins")).toBe(false);
    const calls: unknown[] = [];
    const t2 = new MemTenant("tenantb");
    const deps = { ...t2.deps(localDownload), translations: { saveDraft: async (i: unknown) => { calls.push(i); return "created" as const; } } };
    const r2 = await runImport(d, deps, opts(t2));
    expect(r2.pages.find((p) => p.slug === "seite-eins")).toMatchObject({ status: "created" });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ translationOf: "pagina-uno", locale: "de", slug: "seite-eins" });
    expect(t2.pages.has("seite-eins")).toBe(false);
  });
  it("un bloque que el Studio no admite da error en esa página sin romper las demás", async () => {
    const t = new MemTenant("tenanta");
    const d = doc();
    (d.pages[1].blocks[0] as { data: unknown }).data = { title: "T", html: "x".repeat(60_000), align: "left" };
    const r = await runImport(d, t.deps(localDownload), opts(t));
    expect(r.pages.find((p) => p.slug === "pagina-dos")).toMatchObject({ status: "error" });
    expect(r.pages.find((p) => p.slug === "pagina-uno")).toMatchObject({ status: "created" });
  });
});

describe("importador: ensayo (dry-run)", () => {
  it("no escribe nada: ni medios, ni páginas, ni menú, ni registro; informa de lo que haría", async () => {
    const t = new MemTenant("tenanta");
    const r = await runImport(doc(), t.deps(localDownload), opts(t, { apply: false }));
    expect(t.writes).toBe(0);
    expect(t.objects).toHaveLength(0);
    expect(t.pages.size).toBe(0);
    expect(t.runs).toHaveLength(0);
    expect(r.mode).toBe("dry-run");
    expect(r.summary.pages.created).toBe(2);
    expect(r.summary.media).toMatchObject({ created: 2, duplicate_in_batch: 1 });
  });
  it("tras aplicar, un ensayo informa «sin cambios» (el hash no depende de ids de objeto)", async () => {
    const t = new MemTenant("tenanta");
    await runImport(doc(), t.deps(localDownload), opts(t));
    const writes = t.writes;
    const r = await runImport(doc(), t.deps(localDownload), opts(t, { apply: false, refreshMedia: true }));
    expect(r.summary.pages).toMatchObject({ unchanged: 2 });
    expect(t.writes).toBe(writes);
  });
  it("un documento inválido no toca nada ni deja registro", async () => {
    const t = new MemTenant("tenanta");
    const r = await runImport({ schemaVersion: 9 }, t.deps(localDownload), opts(t));
    expect(r.summary.errors).toBeGreaterThan(0);
    expect(t.writes).toBe(0);
  });
});

describe("auditoría e informe", () => {
  it("al aplicar queda un registro con operador, opciones y resumen; el Markdown lo describe", async () => {
    const t = new MemTenant("tenanta");
    const r = await runImport(doc(), t.deps(localDownload), opts(t, { actor: "operador-ejemplo" }));
    expect(t.runs).toHaveLength(1);
    expect(t.runs[0]).toMatchObject({ runId: r.runId, actor: "operador-ejemplo", schemaVersion: 1 });
    expect(JSON.parse(t.runs[0].summary).pages.created).toBe(2);
    const md = reportToMarkdown(r);
    expect(md).toContain(r.runId);
    expect(md).toContain("## Duplicados");
    expect(md).toContain("pagina-uno");
  });
});

describe("aislamiento entre tenants", () => {
  it("importar en A no escribe nada en B; el mismo hash en B se importa como nuevo en B", async () => {
    const a = new MemTenant("tenanta");
    const b = new MemTenant("tenantb");
    await runImport(doc(), a.deps(localDownload), opts(a));
    expect(b.writes).toBe(0);
    expect(b.media).toHaveLength(0);
    expect(b.pages.size).toBe(0);
    const rb = await runImport(doc(), b.deps(localDownload), opts(b));
    expect(rb.summary.media.created).toBe(2); // el duplicado se detecta SOLO dentro del tenant
    expect(rb.summary.media.reused).toBe(0);
    expect(b.objects.map((o) => o.id).every((id) => id.startsWith("tenantb"))).toBe(true);
    expect(a.objects.map((o) => o.id).every((id) => id.startsWith("tenanta"))).toBe(true);
    expect(a.runs[0].runId).not.toBe(b.runs[0].runId);
  });
  it("una ejecución concurrente en dos tenants no mezcla datos", async () => {
    const a = new MemTenant("tenanta");
    const b = new MemTenant("tenantb");
    const da = doc();
    const db = doc();
    db.pages = [{ slug: "solo-b", title: "Solo B", blocks: [] } as never];
    db.menu = undefined as never;
    await Promise.all([runImport(da, a.deps(localDownload), opts(a)), runImport(db, b.deps(localDownload), opts(b))]);
    expect([...a.pages.keys()].sort()).toEqual(["pagina-dos", "pagina-uno"]);
    expect([...b.pages.keys()]).toEqual(["solo-b"]);
  });
  it("los adaptadores reales no guardan estado entre tenants (sin cachés ni variables de módulo)", () => {
    const src = fs.readFileSync(path.resolve(__dirname, "adapters.ts"), "utf8") + fs.readFileSync(path.resolve(__dirname, "engine.ts"), "utf8");
    expect(src).not.toMatch(/^let\s|^var\s|new Map\(\)\s*;?\s*$/m);
    expect(pageStateHash({ title: "a", metaTitle: null, metaDescription: null, blocks: [] })).toHaveLength(64);
  });
});
