/**
 * Exportación desde el portal de la empresa: una exportación incompleta nunca se presenta como completa; una
 * generación interrumpida no bloquea para siempre; avisos «disponible» y «fallida» (solo a quien la pidió, sin el
 * enlace de descarga, con el diseño común y en el catálogo); aislamiento entre empresas del enlace y de los datos;
 * permisos (solo la persona propietaria) y disponibilidad en solo lectura.
 */
import { describe, it, expect, afterEach } from "vitest";
import JSZip from "jszip";
import { buildExport, type ExportSource } from "./dataExport/build";
import { DataExportService, INTERRUPTED_MESSAGE, MemoryDataExportStore, STALE_PENDING_MS, type ExportNotice } from "./dataExport/service";
import { EXPORT_PANEL_PATH, exportFailedContent, exportReadyContent } from "./mail/exportTemplates";
import { TEMPLATE_CATALOG } from "./notifications/catalog";
import { previewTemplate } from "./notifications/preview";
import { isSessionPath } from "./_core/tenantRegistry/tenantMiddleware";
import { runWithTenant } from "./_core/tenant";
import { newObjectId, signedLink, verifySignedLink } from "./_core/files/service";

const NOW = Date.UTC(2026, 9, 21, 9);
const PANEL = `https://acme.example${EXPORT_PANEL_PATH}`;

const file = (id: string, ok = true) => ({
  objectId: id.repeat(26),
  category: "invoice",
  contentType: "application/pdf",
  sizeBytes: 4,
  originalName: `F-${id}.pdf`,
  read: async () => {
    if (!ok) throw new Error("no está");
    return Buffer.from("%PDF");
  },
});
const source = (files = [file("a")], tenantRows = [{ id: 1, name: "Cliente de Acme" }]): ExportSource => ({
  tables: async () => ["clients"],
  dump: async () => ({ name: "clients", columns: ["id", "name"], rows: tenantRows }),
  files: async () => files,
});

function make(o: { src?: ExportSource; now?: () => number; notify?: (n: ExportNotice) => Promise<void> } = {}) {
  const store = new MemoryDataExportStore();
  const sent: ExportNotice[] = [];
  const svc = new DataExportService({
    store,
    source: o.src ?? source(),
    saveZip: async () => "f".repeat(26),
    signedLink: (id, ttl) => `https://acme.example/api/files/${id}?exp=${ttl}&sig=firma`,
    tenantId: "acme",
    maxBytes: 10 * 1048576,
    now: o.now ?? (() => NOW),
    notify: o.notify ?? (async (n) => void sent.push(n)),
  });
  return { store, svc, sent };
}
const owner = { id: 7, isOwner: true, email: "ana@acme.example", name: "Ana" };

describe("exportación incompleta: nunca como completa", () => {
  it("manifiesto y LÉEME la marcan incompleta si falta un fichero; completa si no falta nada", async () => {
    const partial = await buildExport(source([file("a"), file("b", false)]), { tenantId: "acme", requestedBy: 7, now: NOW, maxBytes: 1048576 });
    const zip = await JSZip.loadAsync(partial.zip);
    const manifest = JSON.parse(await zip.file("manifest.json")!.async("string"));
    expect(manifest).toMatchObject({ complete: false, missingFiles: 1 });
    expect(await zip.file("LEEME.txt")!.async("string")).toMatch(/INCOMPLETA/);
    expect(partial).toMatchObject({ fileCount: 1, missingFileCount: 1 });

    const full = await buildExport(source(), { tenantId: "acme", requestedBy: 7, now: NOW, maxBytes: 1048576 });
    const z2 = await JSZip.loadAsync(full.zip);
    expect(JSON.parse(await z2.file("manifest.json")!.async("string"))).toMatchObject({ complete: true, missingFiles: 0 });
    expect(await z2.file("LEEME.txt")!.async("string")).not.toMatch(/INCOMPLETA/);
  });

  it("la fila queda lista con aviso (no con error) y el correo lo dice", async () => {
    const { svc, store, sent } = make({ src: source([file("a"), file("b", false), file("c", false)]) });
    await (await svc.request(owner)).done;
    expect(store.rows[0]).toMatchObject({ status: "ready", error: null, fileCount: 1 });
    expect(store.rows[0].warning).toMatch(/2 ficheros .*incompleta/);
    expect(sent.map((n) => n.kind)).toEqual(["ready"]);
    const m = exportReadyContent("Acme", { name: "Ana", tables: 1, rows: 1, files: 1, warning: sent[0].export.warning, expiresAt: NOW, panelUrl: PANEL });
    expect(m.subject).toMatch(/con avisos/);
    expect(m.text).toMatch(/Atención: 2 ficheros/);
  });
});

describe("generación interrumpida (reinicio del contenedor)", () => {
  it("una «en curso» antigua se da por fallida al volver a pedir o listar; una reciente sigue bloqueando", async () => {
    let now = NOW;
    const { svc, store } = make({ now: () => now });
    await store.insertPending(7, NOW); // la de antes del reinicio: nunca terminará
    await expect(svc.request(owner)).rejects.toMatchObject({ code: "conflict" });
    now = NOW + STALE_PENDING_MS + 1;
    expect((await svc.list({ isOwner: true }))[0]).toMatchObject({ status: "failed", error: INTERRUPTED_MESSAGE });
    await (await svc.request(owner)).done;
    expect(store.rows.map((r) => r.status)).toEqual(["failed", "ready"]);
  });

  it("si otra solicitud la dio por interrumpida, al terminar no se marca lista ni se avisa", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let now = NOW;
    const slow: ExportSource = { ...source(), tables: async () => (await gate, ["clients"]) };
    const { svc, store, sent } = make({ src: slow, now: () => now });
    const { done } = await svc.request(owner);
    now = NOW + STALE_PENDING_MS + 1;
    await svc.list({ isOwner: true });
    release();
    await done;
    expect(store.rows[0].status).toBe("failed");
    expect(sent).toEqual([]);
  });
});

describe("avisos «Exportación disponible» y «Exportación fallida»", () => {
  it("disponible: a quien la pidió, con sus recuentos; fallida: con el motivo limpio", async () => {
    const ok = make();
    await (await ok.svc.request(owner)).done;
    expect(ok.sent).toEqual([expect.objectContaining({ kind: "ready", to: { email: "ana@acme.example", name: "Ana" } })]);
    expect(ok.sent[0].export).toMatchObject({ status: "ready", tableCount: 1, rowCount: 1, fileCount: 1, warning: null });

    const ko = make({ src: { ...source(), tables: async () => { throw new Error("ECONNRESET 10.0.0.9"); } } });
    await (await ko.svc.request(owner)).done;
    expect(ko.sent.map((n) => n.kind)).toEqual(["failed"]);
    expect(ko.sent[0].export.error).not.toMatch(/10\.0\.0\.9|ECONNRESET/);
  });

  it("sin correo de quien la pidió no se avisa; un fallo del aviso no cambia el resultado", async () => {
    const silent = make();
    await (await silent.svc.request({ ...owner, email: " " })).done;
    expect(silent.sent).toEqual([]);
    const broken = make({ notify: async () => { throw new Error("SMTP caído"); } });
    await (await broken.svc.request(owner)).done;
    expect(broken.store.rows[0].status).toBe("ready");
  });

  it("plantillas: sin el enlace de descarga, solo https, valores escapados y botón al panel", () => {
    const ready = exportReadyContent("Acme <b>", { name: "<script>x</script>", tables: 3, rows: 12000, files: 2, warning: null, expiresAt: NOW, panelUrl: PANEL });
    const failed = exportFailedContent("Acme", { name: null, reason: "La exportación supera el tamaño máximo.", panelUrl: PANEL });
    for (const m of [ready, failed]) {
      expect(m.html).not.toMatch(/\/api\/files\/|sig=|exp=/);
      expect(m.text).not.toMatch(/\/api\/files\/|sig=/);
      for (const h of m.html.matchAll(/href="([^"]+)"/g)) expect(h[1]).toBe(PANEL);
      expect(m.html).toMatch(/<html lang="es">/);
      expect(m.text).toMatch(/No es publicidad/);
      expect(m.html).not.toContain("Elephant Source");
    }
    expect(ready.html).not.toContain("<script>x");
    expect(ready.html).toContain("&lt;script&gt;");
    expect(ready.text).toMatch(/12\.000 filas/);
    expect(ready.text).toMatch(/no incluye el enlace de descarga/);
    expect(failed.subject).toMatch(/No se ha podido generar/);
    // Sin URL del panel o con una no https: sin botón ni enlaces
    expect(exportFailedContent("Acme", { name: null, reason: "x", panelUrl: null }).html).not.toMatch(/href=/);
    expect(exportFailedContent("Acme", { name: null, reason: "x", panelUrl: "http://acme.example/x" }).html).not.toMatch(/href=/);
  });

  it("en el catálogo, con vista previa, categoría propia (sin copia global) y destinataria la propia persona", () => {
    for (const id of ["data.export_ready", "data.export_failed"]) {
      const t = TEMPLATE_CATALOG.find((x) => x.id === id)!;
      expect(t).toMatchObject({ group: "data", category: "data_export", recipient: "account_user", status: "legacy" });
      const p = previewTemplate(id)!;
      expect(p.html).toContain(EXPORT_PANEL_PATH);
      expect(p.html).not.toMatch(/sig=/);
    }
  });
});

describe("aislamiento entre empresas y permisos", () => {
  const env = { mode: process.env.TENANT_MODE, jwt: process.env.JWT_SECRET };
  afterEach(() => {
    process.env.TENANT_MODE = env.mode;
    process.env.JWT_SECRET = env.jwt;
  });

  it("el enlace de descarga de una empresa no vale en otra (la firma incluye la empresa)", () => {
    process.env.TENANT_MODE = "multi";
    process.env.JWT_SECRET = "secreto-de-prueba-solo-ci-000000000000"; // gitleaks:allow
    const id = newObjectId();
    const u = new URL(runWithTenant("acme", () => signedLink(id, 24 * 3600)));
    expect(runWithTenant("acme", () => verifySignedLink(id, u.searchParams.get("exp"), u.searchParams.get("sig")))).toBe("valid");
    expect(runWithTenant("costa", () => verifySignedLink(id, u.searchParams.get("exp"), u.searchParams.get("sig")))).toBe("invalid");
  });

  it("cada servicio exporta solo los datos de su empresa y guarda su propio registro", async () => {
    const zips: Buffer[] = [];
    const mk = (tenantId: string, rows: Array<Record<string, unknown>>) =>
      new DataExportService({ store: new MemoryDataExportStore(), source: source([], rows), saveZip: async (z) => (zips.push(z), "f".repeat(26)), signedLink: () => "", tenantId, maxBytes: 1048576, now: () => NOW });
    const a = mk("acme", [{ id: 1, name: "Cliente de Acme" }]);
    const b = mk("costa", [{ id: 1, name: "Cliente de Costa" }]);
    await (await a.request(owner)).done;
    await (await b.request(owner)).done;
    const csvA = await (await JSZip.loadAsync(zips[0])).file("data/clients.csv")!.async("string");
    expect(csvA).toContain("Cliente de Acme");
    expect(csvA).not.toContain("Costa");
    expect((await b.list({ isOwner: true })).length).toBe(1);
  });

  it("solo la persona propietaria pide, lista y descarga; en solo lectura pedir y descargar siguen permitidos", async () => {
    const { svc } = make();
    const admin = { id: 8, isOwner: false, email: "otro@acme.example", name: null };
    await expect(svc.request(admin)).rejects.toMatchObject({ code: "forbidden" });
    await expect(svc.list(admin)).rejects.toMatchObject({ code: "forbidden" });
    await expect(svc.link(admin, 1)).rejects.toMatchObject({ code: "forbidden" });
    expect(isSessionPath("/api/trpc/dataExport.request")).toBe(true);
    expect(isSessionPath("/api/trpc/dataExport.link")).toBe(true);
    expect(isSessionPath("/api/trpc/dataExport.request,users.create")).toBe(false);
  });
});
