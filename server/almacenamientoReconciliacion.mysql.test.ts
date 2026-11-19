/**
 * Reconciliación de almacenamiento y borrado seguro de multimedia con la APLICACIÓN REAL sobre MySQL (opt-in,
 * REGISTRY_TEST_DATABASE_URL), dos empresas sintéticas y disco local como proveedor (con fallos inyectables).
 *
 *  - Informe previo (solo lectura): referenciado / compartido / huérfano / protegido (reciente o en curso) / ajeno / categoría
 *    no reconciliable / referenciado que falta en el proveedor.
 *  - Borrado: exige la huella del informe, solo huérfanos, recomprueba referencias, descuenta el consumo, deja trazabilidad.
 *  - Concurrencia (dos borrados a la vez), fallo del proveedor (parcial + reintento), aislamiento entre empresas.
 *  - cms.deleteMediaFile: libera el objeto solo si nada más lo usa.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { startEssentialApp, data, errCode, type EssentialApp, type Co } from "./essentialApp.testkit";
import { fingerprintOf, objectIdFromRef, planHashOf } from "./_core/files/reconcile";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
vi.setConfig({ testTimeout: 120_000 });
const DAY = 86_400_000;
const sha = (b: Buffer) => crypto.createHash("sha256").update(b).digest("hex");
const PNG = () => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), crypto.randomBytes(2048)]);

describe("reconciliación: utilidades puras", () => {
  it("el id sale de la URL del Core, de la clave del bucket o del id suelto; lo ajeno no", () => {
    const id = "0123456789abcdefghjkmnpqrs";
    expect(objectIdFromRef(`https://x.example/files/${id}/foto.png`)).toBe(id);
    expect(objectIdFromRef(`t/t1-a/o/media/2026/11/${id}.png`)).toBe(id);
    expect(objectIdFromRef(id)).toBe(id);
    expect(objectIdFromRef("https://cdn.example/otra/foto.png")).toBeNull();
    expect(objectIdFromRef(null)).toBeNull();
  });
  it("la huella del conjunto no depende del orden y cambia si cambia cualquier objeto", () => {
    const a = fingerprintOf({ objectId: "a".repeat(26), sha256: "1".repeat(64), sizeBytes: 10, storageKey: "t/x/o/media/a" });
    const b = fingerprintOf({ objectId: "b".repeat(26), sha256: "2".repeat(64), sizeBytes: 20, storageKey: "t/x/o/media/b" });
    expect(planHashOf([a, b])).toBe(planHashOf([b, a]));
    expect(planHashOf([a, b])).not.toBe(planHashOf([a]));
    const a2 = fingerprintOf({ objectId: "a".repeat(26), sha256: "1".repeat(64), sizeBytes: 11, storageKey: "t/x/o/media/a" });
    expect(planHashOf([a2, b])).not.toBe(planHashOf([a, b]));
  });
});

describe.skipIf(!URL_)("reconciliación de almacenamiento y borrado seguro (aplicación real, dos empresas)", () => {
  let ess: EssentialApp;
  let adm = "";
  let agente = "";
  let admB = "";
  let localDir = "";
  let files: typeof import("./_core/files/service");
  let backendMod: typeof import("./_core/files/backend");
  let failDeletes = false;
  const root = (co: Co) => `t/${ess.ids[co]}/o/`;
  const sql = (co: Co, q: string, p: unknown[] = []) => ess.sql(co, q, p);
  const okData = (r: { status: number; json: any }, what: string) => {
    expect(r.status, `${what}: ${JSON.stringify(r.json)}`).toBe(200);
    return data(r as any);
  };
  const backend = () => backendMod.backendFromEnv();

  /** Un objeto en el almacén y su fila. `ageMs` = antigüedad. Devuelve id, clave y bytes. */
  const mk = async (co: Co, o: { category: string; ageMs?: number; status?: string; bytes?: Buffer; withBytes?: boolean; keyRoot?: string; ext?: string }) => {
    const objectId = files.newObjectId();
    const bytes = o.bytes ?? PNG();
    const ext = o.ext ?? "png";
    const key = `${o.keyRoot ?? root(co)}${o.category}/2026/11/${objectId}.${ext}`;
    if (o.withBytes !== false) await backend().put(key, bytes, ext === "png" ? "image/png" : "video/mp4");
    const at = Date.now() - (o.ageMs ?? 3 * DAY);
    await sql(co, "INSERT INTO stored_objects (object_id, storage_key, visibility, category, content_type, size_bytes, sha256, original_name, status, created_at, updated_at, confirmed_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)", [
      objectId, key, o.category === "media" ? "public" : "private", o.category, ext === "png" ? "image/png" : "video/mp4", bytes.length, sha(bytes), `test-${objectId.slice(0, 6)}.${ext}`, o.status ?? "active", at, at, at,
    ]);
    return { objectId, key, bytes, size: bytes.length, sha: sha(bytes) };
  };
  const row = async (co: Co, id: string) => (await sql(co, "SELECT status, deleted_at, bytes_removed_at, error FROM stored_objects WHERE object_id = ?", [id]))[0];
  const exists = async (key: string) => !!(await backend().stat(key));
  const mediaRow = (co: Co, o: { id: string; key: string }, n = "x") =>
    sql(co, "INSERT INTO media_files (filename, originalName, url, fileKey, mimeType, size, type) VALUES (?,?,?,?,?,?,?)", [`${n}.png`, `${n}.png`, `https://${ess.host(co)}/files/${o.id}/${n}.png`, o.key, "image/png", 100, "image"]);
  const learningRes = async (co: Co, objectId: string, n: number) => {
    const now = Date.now();
    await sql(co, "INSERT INTO learning_resources (kind, original_name, mime_type, size_bytes, sha256, stored_object_id, status, created_at, updated_at) VALUES ('video',?,?,?,?,?,'verified',?,?)", [`v${n}.mp4`, "video/mp4", 1, "0".repeat(64), objectId, now, now]);
  };
  const plan = async (cookie = adm, input: Record<string, unknown> = {}) => okData(await ess.q("a", "storage.reconcile", { checkProvider: true, ...input }, cookie), "reconcile");
  const apply = (ids: string[], planHash: string, cookie = adm) => ess.m("a", "storage.reconcileApply", { objectIds: ids, planHash, graceHours: 1 }, cookie);
  const overview = async (cookie = adm) => okData(await ess.q("a", "storage.overview", undefined, cookie), "overview");
  const snapshot = async (co: Co) => JSON.stringify(await sql(co, "SELECT object_id, status, bytes_removed_at, updated_at FROM stored_objects ORDER BY object_id"));

  const fx: Record<string, Awaited<ReturnType<typeof mk>>> = {};

  beforeAll(async () => {
    localDir = fs.mkdtempSync(path.join(os.tmpdir(), "reconcilia-mysql-"));
    ess = await startEssentialApp(URL_!, "recon");
    files = await import("./_core/files/service");
    backendMod = await import("./_core/files/backend");
    for (const k of ["S3_ENDPOINT", "S3_ACCESS_KEY", "S3_SECRET_KEY", "S3_BUCKET"]) delete process.env[k];
    process.env.LOCAL_STORAGE_PATH = localDir;
    delete process.env.STORAGE_PRIVATE_DELIVERY;
    backendMod.resetBackendCache();
    // Proveedor con fallos de borrado inyectables
    files.setFileServiceForTests(
      new files.FileService({
        backend: () =>
          new Proxy(backend(), {
            get(t: any, p: string) {
              if (p === "delete") return async (k: string) => {
                if (failDeletes) throw new files.StorageUnavailableError();
                return t.delete(k);
              };
              const v = t[p];
              return typeof v === "function" ? v.bind(t) : v;
            },
          }),
        attempts: 1,
        retryDelayMs: 1,
      }),
    );
    await ess.grantQuotaException("a", "learning_storage_gb", 25);
    await ess.grantQuotaException("b", "learning_storage_gb", 25);
    adm = await ess.login("a", "admin");
    agente = await ess.login("a", "agente");
    admB = await ess.login("b", "admin");

    // Fixture de la empresa A
    fx.shared = await mk("a", { category: "learning-content", ext: "mp4" }); // dos recursos → un objeto
    await learningRes("a", fx.shared.objectId, 1);
    await learningRes("a", fx.shared.objectId, 2);
    fx.dupOrphan = await mk("a", { category: "learning-content", ext: "mp4", bytes: fx.shared.bytes }); // mismo contenido, sin referencias
    fx.mediaRef = await mk("a", { category: "media" });
    await mediaRow("a", { id: fx.mediaRef.objectId, key: fx.mediaRef.key }, "ref");
    fx.mediaOrphan = await mk("a", { category: "media" });
    fx.recent = await mk("a", { category: "media", ageMs: 60_000 }); // subida reciente sin referencias aún
    fx.pending = await mk("a", { category: "media", status: "pending" }); // subida en curso
    fx.textRef = await mk("a", { category: "media" }); // solo aparece dentro de un texto (ajuste del sistema)
    await sql("a", "INSERT INTO system_settings (`key`, value, label) VALUES (?,?,?)", ["recon_prueba", `{"logo":"https://${ess.host("a")}/files/${fx.textRef.objectId}/logo.png"}`, "prueba"]);
    fx.otherCat = await mk("a", { category: "invoice", ext: "png" }); // categoría sin fuente de referencias conocida
    fx.foreign = await mk("a", { category: "media", keyRoot: `t/otra-empresa-x/o/` }); // clave de otro espacio
    fx.missing = await mk("a", { category: "media", withBytes: false }); // referenciado pero ausente del proveedor
    await mediaRow("a", { id: fx.missing.objectId, key: fx.missing.key }, "ausente");
    // Empresa B: un huérfano propio
    fx.orphanB = await mk("b", { category: "media" });
  }, 300_000);

  afterAll(async () => {
    files?.setFileServiceForTests(null);
    await ess?.close();
    if (localDir) fs.rmSync(localDir, { recursive: true, force: true });
  });

  it("1. el informe previo clasifica todo y NO modifica nada (solo lectura)", async () => {
    const before = await snapshot("a");
    const r = await plan();
    expect(await snapshot("a")).toBe(before);
    const ids = (a: Array<{ objectId: string }>) => a.map((x) => x.objectId).sort();
    expect(ids(r.orphans)).toEqual([fx.dupOrphan.objectId, fx.mediaOrphan.objectId].sort());
    expect(r.orphans.find((o: any) => o.objectId === fx.dupOrphan.objectId).sameHashAsReferenced).toBe(true);
    expect(r.orphans.find((o: any) => o.objectId === fx.mediaOrphan.objectId).sameHashAsReferenced).toBe(false);
    const prot = Object.fromEntries(r.protected.map((p: any) => [p.objectId, p.reason]));
    expect(prot[fx.recent.objectId]).toBe("recent");
    expect(prot[fx.pending.objectId]).toBe("pending");
    expect(r.shared.map((s: any) => s.objectId)).toContain(fx.shared.objectId);
    // referenciado solo por un texto: no es huérfano
    expect(ids(r.orphans)).not.toContain(fx.textRef.objectId);
    // categoría sin fuente conocida: se cuenta pero nunca se propone
    expect(ids(r.orphans)).not.toContain(fx.otherCat.objectId);
    expect(r.byCategory.invoice).toMatchObject({ objects: 1, scanned: false });
    // ajeno: ni orfano ni nada
    expect(ids(r.orphans)).not.toContain(fx.foreign.objectId);
    expect(r.byCategory.media.foreign).toBeGreaterThanOrEqual(1);
    // integridad: referenciado pero ausente del proveedor
    expect(r.missing).toEqual([{ objectId: fx.missing.objectId, category: "media", reason: "absent" }]);
    expect(r.planHash).toMatch(/^[0-9a-f]{64}$/);
    expect(r.scannedColumns).toBeGreaterThan(50);
    // nunca lista objetos de la empresa B
    expect(JSON.stringify(r)).not.toContain(fx.orphanB.objectId);
  });

  it("2. borrar exige la huella del informe: una huella incorrecta no borra nada", async () => {
    const r = await plan();
    const ids = r.orphans.map((o: any) => o.objectId);
    const bad = await apply(ids, "0".repeat(64));
    expect(errCode(bad)).toBe("CONFLICT");
    for (const id of ids) expect((await row("a", id)).status).toBe("active");
    // con la huella de OTRO conjunto tampoco
    const wrongSet = await apply([ids[0]], r.planHash);
    expect(errCode(wrongSet)).toBe("CONFLICT");
    expect((await row("a", ids[0])).status).toBe("active");
  });

  it("3. solo agentes administradores: otro rol y sin sesión quedan fuera", async () => {
    expect((await ess.q("a", "storage.reconcile", undefined, agente)).status).toBe(403);
    expect((await ess.q("a", "storage.reconcile")).status).toBe(401);
    expect((await ess.m("a", "storage.reconcileApply", { objectIds: [fx.mediaOrphan.objectId], planHash: "0".repeat(64) }, agente)).status).toBe(403);
  });

  it("4. una referencia que aparece entre el informe y el borrado salva al objeto; el resto se borra", async () => {
    const r = await plan();
    const ids = r.orphans.map((o: any) => o.objectId);
    // Entre el informe y el borrado alguien empieza a usar el duplicado
    await learningRes("a", fx.dupOrphan.objectId, 3);
    const res = okData(await apply(ids, r.planHash), "apply");
    expect(res.skipped).toEqual([{ objectId: fx.dupOrphan.objectId, reason: "referenced" }]);
    expect(res.deletedIds).toEqual([fx.mediaOrphan.objectId]);
    expect((await row("a", fx.dupOrphan.objectId)).status).toBe("active");
    expect(await exists(fx.dupOrphan.key)).toBe(true);
    // El borrado deja huella: estado, fecha, motivo y quién
    const d = await row("a", fx.mediaOrphan.objectId);
    expect(d.status).toBe("deleted");
    expect(Number(d.deleted_at)).toBeGreaterThan(0);
    expect(Number(d.bytes_removed_at)).toBeGreaterThan(0);
    expect(d.error).toMatch(/^reconcile:orphan by admin:/);
    expect(await exists(fx.mediaOrphan.key)).toBe(false);
    // Los protegidos, el compartido, el referenciado por texto, la categoría no reconciliable y el ajeno siguen intactos
    for (const o of [fx.shared, fx.mediaRef, fx.recent, fx.pending, fx.textRef, fx.otherCat, fx.foreign, fx.missing]) {
      expect((await row("a", o.objectId)).status, o.objectId).toMatch(/active|pending/);
    }
    for (const o of [fx.shared, fx.mediaRef, fx.recent, fx.textRef, fx.otherCat, fx.foreign]) expect(await exists(o.key)).toBe(true);
  });

  it("5. el consumo baja exactamente lo liberado (se calcula de las filas activas)", async () => {
    const before = await overview();
    const orphan = await mk("a", { category: "media" });
    const mid = await overview();
    expect(mid.general.usedBytes - before.general.usedBytes).toBe(orphan.size);
    const r = await plan();
    const mine = r.orphans.filter((o: any) => o.objectId === orphan.objectId).map((o: any) => o.objectId);
    expect(mine).toEqual([orphan.objectId]);
    // El informe lista todos los huérfanos; se borra solo este (el informe con límite 1 da otra huella)
    const small = await plan(adm, { limit: 1, categories: ["media"] });
    const res = okData(await apply(small.orphans.map((o: any) => o.objectId), small.planHash), "apply");
    expect(res.deleted).toBe(1);
    expect(res.freedBytes).toBe(small.orphans[0].sizeBytes);
    const after = await overview();
    expect(mid.general.usedBytes - after.general.usedBytes).toBe(res.freedBytes);
  });

  it("6. dos borrados simultáneos del mismo conjunto: se borra una sola vez, sin dobles descuentos", async () => {
    const o1 = await mk("a", { category: "media" });
    const o2 = await mk("a", { category: "learning-content", ext: "mp4" });
    const r = await plan(adm, { limit: 50 });
    const ids = r.orphans.map((o: any) => o.objectId).filter((id: string) => [o1.objectId, o2.objectId].includes(id));
    expect(ids.sort()).toEqual([o1.objectId, o2.objectId].sort());
    const subset = await plan(adm, { limit: 50 });
    const target = subset.orphans.filter((o: any) => ids.includes(o.objectId));
    // El mismo informe, aplicado a la vez dos veces: solo uno de los dos borra cada objeto
    const hash = planHashOf(target.map((o: any) => o.fingerprint));
    const [a, b] = await Promise.all([apply(ids, hash), apply(ids, hash)]);
    const da = okData(a, "a");
    const db = okData(b, "b");
    expect(da.deleted + db.deleted).toBe(2);
    expect(da.freedBytes + db.freedBytes).toBe(o1.size + o2.size);
    for (const o of [o1, o2]) {
      expect((await row("a", o.objectId)).status).toBe("deleted");
      expect(await exists(o.key)).toBe(false);
    }
  });

  it("7. fallo del proveedor: el objeto queda borrado (deja de contar) con los bytes pendientes y se reintenta después", async () => {
    const o = await mk("a", { category: "media" });
    const before = await overview();
    const r = await plan(adm, { limit: 50 });
    const target = r.orphans.filter((x: any) => x.objectId === o.objectId);
    expect(target).toHaveLength(1);
    failDeletes = true;
    try {
      const res = okData(await apply([o.objectId], planHashOf([target[0].fingerprint])), "apply");
      expect(res).toMatchObject({ deleted: 1, pendingRemoval: 1 });
    } finally {
      failDeletes = false;
    }
    const d = await row("a", o.objectId);
    expect(d.status).toBe("deleted");
    expect(d.bytes_removed_at).toBeNull();
    expect(await exists(o.key)).toBe(true); // el proveedor no llegó a borrarlo
    expect((await overview()).general.usedBytes).toBe(before.general.usedBytes - o.size); // el consumo ya no lo cuenta
    const retry = okData(await ess.m("a", "storage.reconcileRetryRemovals", {}, adm), "retry");
    expect(retry).toMatchObject({ removed: 1, failed: 0 });
    expect(await exists(o.key)).toBe(false);
    expect(Number((await row("a", o.objectId)).bytes_removed_at)).toBeGreaterThan(0);
  });

  it("8. aislamiento: un id de otra empresa no se toca ni aparece nunca; cada empresa solo ve lo suyo", async () => {
    // La empresa A intenta borrar el huérfano de B con una huella construida para un id inexistente en su base
    const hash = planHashOf([`missing:${fx.orphanB.objectId}`]);
    const res = okData(await apply([fx.orphanB.objectId], hash), "apply");
    expect(res.deleted).toBe(0);
    expect(res.skipped).toEqual([{ objectId: fx.orphanB.objectId, reason: "not_found" }]);
    expect((await row("b", fx.orphanB.objectId)).status).toBe("active");
    expect(await exists(fx.orphanB.key)).toBe(true);
    // El informe de B lista solo lo suyo
    const rb = okData(await ess.q("b", "storage.reconcile", { checkProvider: false }, admB), "reconcile B");
    expect(rb.orphans.map((o: any) => o.objectId)).toEqual([fx.orphanB.objectId]);
    expect(JSON.stringify(rb)).not.toContain(fx.shared.objectId);
    // Un objeto cuya clave es de otro espacio no se borra ni siquiera con huella válida
    const mine = await plan(adm, { limit: 50 });
    expect(mine.orphans.map((o: any) => o.objectId)).not.toContain(fx.foreign.objectId);
    const fp = fingerprintOf({ objectId: fx.foreign.objectId, sha256: fx.foreign.sha, sizeBytes: fx.foreign.size, storageKey: fx.foreign.key });
    const forced = okData(await apply([fx.foreign.objectId], planHashOf([fp])), "forzado");
    expect(forced.skipped).toEqual([{ objectId: fx.foreign.objectId, reason: "foreign_tenant" }]);
    expect(await exists(fx.foreign.key)).toBe(true);
  });

  it("9. cms.deleteMediaFile: libera el objeto solo si nada más lo usa", async () => {
    // Imagen real subida por el CMS
    const up = async (content: Buffer) => {
      const boundary = `----t${crypto.randomBytes(6).toString("hex")}`;
      const body = Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="prueba.png"\r\nContent-Type: image/png\r\n\r\n`), content, Buffer.from(`\r\n--${boundary}--\r\n`)]);
      const raw = await new Promise<{ status: number; json: any }>((resolve, reject) => {
        const req = http.request({ host: "127.0.0.1", port: ess.port, path: "/api/upload/image", method: "POST", headers: { host: ess.host("a"), cookie: adm, "content-type": `multipart/form-data; boundary=${boundary}`, "content-length": body.length } }, (res) => {
          const parts: Buffer[] = [];
          res.on("data", (c) => parts.push(Buffer.from(c)));
          res.on("end", () => resolve({ status: res.statusCode ?? 0, json: JSON.parse(Buffer.concat(parts).toString("utf8") || "{}") }));
        });
        req.on("error", reject);
        req.write(body);
        req.end();
      });
      expect(raw.status, JSON.stringify(raw.json)).toBe(200);
      return { id: files.objectIdFromUrl(raw.json.url)!, mediaId: raw.json.id as number, key: raw.json.key as string, url: raw.json.url as string };
    };
    const delR = async (mediaId: number) => okData(await ess.m("a", "cms.deleteMediaFile", { id: mediaId }, adm), "delete");

    // (a) sin otras referencias: se borra la fila Y el objeto, y el consumo vuelve
    const base = await overview();
    const a = await up(PNG());
    const mid = await overview();
    expect(mid.general.usedBytes).toBeGreaterThan(base.general.usedBytes);
    const resA = await delR(a.mediaId);
    expect(resA.storage).toMatchObject({ released: true, reason: "deleted" });
    expect((await row("a", a.id)).status).toBe("deleted");
    expect(await exists(a.key)).toBe(false);
    expect((await sql("a", "SELECT id FROM media_files WHERE id = ?", [a.mediaId])).length).toBe(0);
    expect((await overview()).general.usedBytes).toBe(base.general.usedBytes);

    // (b) otra fila de biblioteca usa el mismo objeto: se borra solo la fila
    const b = await up(PNG());
    await mediaRow("a", { id: b.id, key: b.key }, "copia");
    const resB = await delR(b.mediaId);
    expect(resB.storage).toMatchObject({ released: false, reason: "referenced" });
    expect((await row("a", b.id)).status).toBe("active");
    expect(await exists(b.key)).toBe(true);

    // (c) usado por otro contenido (texto de un ajuste): se conserva
    const c = await up(PNG());
    await sql("a", "INSERT INTO system_settings (`key`, value, label) VALUES (?,?,?)", ["recon_prueba_c", `portada: ${c.url}`, "prueba c"]);
    const resC = await delR(c.mediaId);
    expect(resC.storage).toMatchObject({ released: false, reason: "referenced" });
    expect(await exists(c.key)).toBe(true);

    // (d) el proveedor falla al borrar: la fila de biblioteca desaparece, el objeto deja de contar y los bytes se reintentan
    const d = await up(PNG());
    failDeletes = true;
    let resD;
    try {
      resD = await delR(d.mediaId);
    } finally {
      failDeletes = false;
    }
    expect(resD.storage.released).toBe(true);
    expect((await row("a", d.id)).status).toBe("deleted");
    expect((await row("a", d.id)).bytes_removed_at).toBeNull();
    okData(await ess.m("a", "storage.reconcileRetryRemovals", {}, adm), "retry");
    expect(await exists(d.key)).toBe(false);

    // (e) aislamiento: borrar en A no toca nada de B
    expect((await row("b", fx.orphanB.objectId)).status).toBe("active");
    expect(await exists(fx.orphanB.key)).toBe(true);
  });
});
