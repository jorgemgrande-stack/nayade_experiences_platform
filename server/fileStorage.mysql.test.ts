/**
 * Almacenamiento persistente con la APLICACIÓN REAL sobre MySQL (opt-in, REGISTRY_TEST_DATABASE_URL) y dos
 * empresas nuevas. Proveedor: MinIO si STORAGE_TEST_S3_ENDPOINT (+ STORAGE_TEST_S3_ACCESS_KEY /
 * STORAGE_TEST_S3_SECRET_KEY) está definido —bucket PRIVADO nuevo por ejecución—; si no, disco local en un
 * directorio temporal (así corre también en el CI sin S3).
 *
 *  - Subida de imagen pública (CMS) y de PDF privado; descarga; permisos por rol.
 *  - Aislamiento: id de otra empresa (IDOR), metadatos falsificados con la clave de otra empresa, enlace
 *    firmado de otra empresa, cookie en el host de otra empresa.
 *  - Enlace firmado del Core caducado o alterado; URL prefirmada del proveedor caducada (solo MinIO).
 *  - Borrado autorizado; proveedor no disponible → error controlado sin estado inconsistente.
 *  - Persistencia tras «redespliegue» (aplicación y cliente nuevos sobre el mismo bucket y la misma BD).
 *  - Réplica de ficheros de la copia (formato existente) y restauración individual de un fichero.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import express from "express";
import mysql from "mysql2/promise";
import { CreateBucketCommand, S3Client } from "@aws-sdk/client-s3";
import { startEssentialApp, data, errCode, type EssentialApp, type Co } from "./essentialApp.testkit";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
const S3_ENDPOINT = process.env.STORAGE_TEST_S3_ENDPOINT;
const run = crypto.randomBytes(3).toString("hex");

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), crypto.randomBytes(256)]);
const PDF = Buffer.concat([Buffer.from("%PDF-1.7\n"), crypto.randomBytes(512), Buffer.from("\n%%EOF\n")]);
const HTML = Buffer.from("<!doctype html><html><body><script>document.cookie</script></body></html>");

interface Raw {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
  json: any;
}

function request(port: number, host: string, method: string, p: string, o: { cookie?: string; body?: Buffer; headers?: Record<string, string> } = {}): Promise<Raw> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path: p,
        method,
        headers: { host, ...(o.cookie ? { cookie: o.cookie } : {}), ...(o.body ? { "content-length": o.body.length } : {}), ...(o.headers ?? {}) },
      },
      (res) => {
        const parts: Buffer[] = [];
        res.on("data", (c) => parts.push(Buffer.from(c)));
        res.on("end", () => {
          const body = Buffer.concat(parts);
          let json: any = null;
          try {
            json = JSON.parse(body.toString("utf8"));
          } catch {
            /* binario */
          }
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body, json });
        });
      },
    );
    req.on("error", reject);
    if (o.body) req.write(o.body);
    req.end();
  });
}

/** GET a una URL absoluta (MinIO) con http nativo: el fetch global está bloqueado en estas pruebas. */
function rawGet(url: string): Promise<{ status: number; body: Buffer }> {
  return new Promise((resolve, reject) => {
    http
      .get(url, (res) => {
        const parts: Buffer[] = [];
        res.on("data", (c) => parts.push(Buffer.from(c)));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(parts) }));
      })
      .on("error", reject);
  });
}

function multipart(field: string, filename: string, type: string, content: Buffer) {
  const boundary = `----prueba${crypto.randomBytes(8).toString("hex")}`;
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${field}"; filename="${filename}"\r\nContent-Type: ${type}\r\n\r\n`),
    content,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return { body, headers: { "content-type": `multipart/form-data; boundary=${boundary}` } };
}

describe.skipIf(!URL_)("almacenamiento persistente (aplicación real, dos empresas)", () => {
  let ess: EssentialApp;
  let admA: string;
  let admB: string;
  let agA: string;
  let userA: string;
  let ctlA: string;
  let localDir: string | null = null;
  const bucket = `alm-${run}`;
  let files: typeof import("./_core/files/service");
  let backendMod: typeof import("./_core/files/backend");
  let tenantMod: typeof import("./_core/tenant");
  const pools: mysql.Pool[] = [];
  let publicImage: { id: string; url: string };
  let privatePdf: { id: string; url: string };

  const configureStorage = () => {
    if (S3_ENDPOINT) {
      process.env.S3_ENDPOINT = S3_ENDPOINT;
      process.env.S3_ACCESS_KEY = process.env.STORAGE_TEST_S3_ACCESS_KEY ?? "";
      process.env.S3_SECRET_KEY = process.env.STORAGE_TEST_S3_SECRET_KEY ?? "";
      process.env.S3_BUCKET = bucket;
      process.env.S3_REGION = "us-east-1";
    } else {
      for (const k of ["S3_ENDPOINT", "S3_ACCESS_KEY", "S3_SECRET_KEY", "S3_BUCKET"]) delete process.env[k];
      process.env.LOCAL_STORAGE_PATH = localDir!;
    }
    delete process.env.STORAGE_PRIVATE_DELIVERY;
    backendMod.resetBackendCache();
    files.setFileServiceForTests(null);
  };
  const tenantPool = async (co: Co) => {
    const p = mysql.createPool({ uri: (await ess.registry.service.getActiveDsn(ess.ids[co]))!, connectionLimit: 2 });
    pools.push(p);
    return p;
  };
  const get = (co: Co, p: string, cookie?: string, headers?: Record<string, string>) => request(ess.port, ess.host(co), "GET", p, { cookie, headers });
  const pathOf = (url: string) => new URL(url, "https://x.example").pathname + new URL(url, "https://x.example").search;

  beforeAll(async () => {
    if (!S3_ENDPOINT) localDir = fs.mkdtempSync(path.join(os.tmpdir(), "almacen-mysql-"));
    else {
      const c = new S3Client({
        endpoint: S3_ENDPOINT,
        region: "us-east-1",
        forcePathStyle: true,
        credentials: { accessKeyId: process.env.STORAGE_TEST_S3_ACCESS_KEY ?? "", secretAccessKey: process.env.STORAGE_TEST_S3_SECRET_KEY ?? "" },
      });
      await c.send(new CreateBucketCommand({ Bucket: bucket })); // bucket nuevo: privado (sin política pública)
    }
    ess = await startEssentialApp(URL_!, "alm");
    files = await import("./_core/files/service");
    backendMod = await import("./_core/files/backend");
    tenantMod = await import("./_core/tenant");
    configureStorage(); // después de arrancar: el banco de pruebas limpia las variables S3_*
    admA = await ess.login("a", "admin");
    admB = await ess.login("b", "admin");
    agA = await ess.login("a", "agente");
    userA = await ess.login("a", "user");
    ctlA = await ess.login("a", "controler");
  }, 300_000);

  afterAll(async () => {
    for (const p of pools) await p.end();
    await ess?.close();
    if (localDir) fs.rmSync(localDir, { recursive: true, force: true });
  });

  it("imagen pública del CMS: validación por contenido, URL del Core, entrega solo en el host de su empresa", async () => {
    // Contenido que no es una imagen, aunque se declare como tal
    const fake = multipart("image", "foto.png", "image/png", HTML);
    expect((await request(ess.port, ess.host("a"), "POST", "/api/upload/image", { cookie: admA, ...fake })).status).toBe(400);
    const evil = multipart("image", "logo.svg", "image/svg+xml", Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'));
    expect((await request(ess.port, ess.host("a"), "POST", "/api/upload/image", { cookie: admA, ...evil })).status).toBe(400);
    // Solo administradores suben medios
    const ok = multipart("image", "../../Logo Empresa.png", "image/png", PNG);
    expect((await request(ess.port, ess.host("a"), "POST", "/api/upload/image", { cookie: agA, ...ok })).status).toBe(403);

    const up = await request(ess.port, ess.host("a"), "POST", "/api/upload/image", { cookie: admA, ...ok });
    expect(up.status).toBe(200);
    const id = files.objectIdFromUrl(up.json.url)!;
    expect(id).toBeTruthy();
    expect(up.json.url).toBe(`https://${ess.host("a")}/files/${id}/Logo-Empresa.png`);
    expect(up.json.key).toMatch(new RegExp(`^t/${ess.ids.a}/o/media/\\d{4}/\\d{2}/${id}\\.png$`));
    publicImage = { id, url: up.json.url };
    const [row] = await ess.sql("a", "SELECT visibility, status, content_type, size_bytes, sha256 FROM stored_objects WHERE object_id = ?", [id]);
    expect(row).toMatchObject({ visibility: "public", status: "active", content_type: "image/png", size_bytes: PNG.length, sha256: crypto.createHash("sha256").update(PNG).digest("hex") });
    expect((await ess.sql("a", "SELECT url, fileKey FROM media_files ORDER BY id DESC LIMIT 1"))[0]).toMatchObject({ url: up.json.url, fileKey: up.json.key });

    // Sin sesión, en el host de A: se sirve con caché y sin ejecución
    const pub = await get("a", pathOf(up.json.url));
    expect(pub.status).toBe(200);
    expect(pub.body.equals(PNG)).toBe(true);
    expect(pub.headers["content-type"]).toBe("image/png");
    expect(pub.headers["cache-control"]).toMatch(/^public, max-age=\d+/);
    expect(pub.headers["x-content-type-options"]).toBe("nosniff");
    expect((await get("a", pathOf(up.json.url), undefined, { "if-none-match": pub.headers.etag as string })).status).toBe(304);
    // En el host de B no existe
    expect((await get("b", pathOf(up.json.url))).status).toBe(404);
    // No hay listado
    expect((await get("a", "/files/")).status).toBe(404);
    // El bucket es privado: el objeto no se puede leer directamente del proveedor
    if (S3_ENDPOINT) expect((await rawGet(`${S3_ENDPOINT}/${bucket}/${up.json.key}`)).status).toBe(403);
  });

  it("PDF privado: subida por tRPC, descarga con sesión y permiso de la categoría", async () => {
    const input = { quoteId: 1, fileBase64: PDF.toString("base64"), fileName: "justificante.pdf", mimeType: "application/pdf" };
    expect(errCode(await ess.m("a", "crm.quotes.uploadProofOnly", input, userA))).toBe("FORBIDDEN");
    expect(errCode(await ess.m("a", "crm.quotes.uploadProofOnly", { ...input, fileBase64: HTML.toString("base64") }, agA))).toBe("BAD_REQUEST");
    const r = data(await ess.m("a", "crm.quotes.uploadProofOnly", input, agA));
    const id = files.objectIdFromUrl(r.url)!;
    expect(r.url).toBe(`/api/files/${id}`);
    expect(r.fileKey).toMatch(new RegExp(`^t/${ess.ids.a}/o/transfer-proof/`));
    privatePdf = { id, url: r.url };

    expect((await get("a", r.url)).status).toBe(401); // sin sesión
    expect((await get("a", r.url, userA)).status).toBe(403); // cliente
    expect((await get("a", r.url, ctlA)).status).toBe(403); // rol sin permiso comercial
    const ok = await get("a", r.url, agA);
    expect(ok.status).toBe(200);
    expect(ok.body.equals(PDF)).toBe(true);
    expect(ok.headers["content-type"]).toBe("application/pdf");
    expect(ok.headers["cache-control"]).toBe("private, no-store");
    expect(ok.headers["content-disposition"]).toMatch(/^inline; filename="justificante\.pdf"/);
    expect((await get("a", r.url, admA)).status).toBe(200);
    // Un privado no se sirve por la ruta pública
    expect((await get("a", `/files/${id}/justificante.pdf`)).status).toBe(404);
    if (S3_ENDPOINT) expect((await rawGet(`${S3_ENDPOINT}/${bucket}/${r.fileKey}`)).status).toBe(403);
  });

  it("aislamiento: id de otra empresa, metadatos falsificados, cookie y enlace firmado de otra empresa", async () => {
    // IDOR por id: en B ese objeto no existe (ni con su administrador)
    expect((await get("b", privatePdf.url, admB)).status).toBe(404);
    expect((await request(ess.port, ess.host("b"), "DELETE", privatePdf.url, { cookie: admB })).status).toBe(404);
    // Cookie de A en el host de B: no hay sesión
    expect((await get("b", privatePdf.url, admA)).status).toBe(401);
    // Metadatos falsificados en la BD de B que apuntan a la clave de A: no se sirven
    const [rowA] = await ess.sql("a", "SELECT * FROM stored_objects WHERE object_id = ?", [publicImage.id]);
    const forged = files.newObjectId();
    await ess.sql(
      "b",
      "INSERT INTO stored_objects (object_id, storage_key, visibility, category, content_type, size_bytes, sha256, status, created_at, updated_at) VALUES (?, ?, 'public', 'media', 'image/png', ?, ?, 'active', ?, ?)",
      [forged, rowA.storage_key, rowA.size_bytes, rowA.sha256, Date.now(), Date.now()],
    );
    expect((await get("b", `/files/${forged}/x.png`)).status).toBe(404);
    expect((await get("b", `/api/files/${forged}`, admB)).status).toBe(404);
    // Enlace firmado emitido para A, presentado en B
    process.env.TENANT_MODE = "multi";
    const link = tenantMod.runWithTenant(ess.ids.a, () => files.signedLink(privatePdf.id, 300));
    expect((await get("b", pathOf(link))).status).toBe(403);
    expect((await get("a", pathOf(link))).status).toBe(200);
    // Rutas por clave del bucket: no existen
    expect((await get("a", `/files/${encodeURIComponent(rowA.storage_key)}`)).status).toBe(404);
  });

  it("enlace firmado caducado o alterado; URL prefirmada del proveedor de duración corta", async () => {
    const expired = tenantMod.runWithTenant(ess.ids.a, () => files.signedLink(privatePdf.id, -10));
    const exp = await get("a", pathOf(expired));
    expect(exp.status).toBe(410);
    expect(exp.json.error).toMatch(/caducado/);
    const good = new URL(tenantMod.runWithTenant(ess.ids.a, () => files.signedLink(privatePdf.id, 300)));
    good.searchParams.set("sig", "0".repeat(40));
    expect((await get("a", good.pathname + good.search)).status).toBe(403);

    if (!S3_ENDPOINT) return;
    process.env.STORAGE_PRIVATE_DELIVERY = "redirect";
    process.env.STORAGE_SIGNED_URL_TTL_SECONDS = "5";
    try {
      const redirect = await get("a", privatePdf.url, agA);
      expect(redirect.status).toBe(302);
      const location = String(redirect.headers.location);
      expect(location.startsWith(`${S3_ENDPOINT}/${bucket}/t/${ess.ids.a}/`)).toBe(true);
      expect((await rawGet(location)).body.equals(PDF)).toBe(true);
      // Sin sesión no hay redirección
      expect((await get("a", privatePdf.url)).status).toBe(401);
      // Caducidad real del proveedor
      const [row] = await ess.sql("a", "SELECT storage_key FROM stored_objects WHERE object_id = ?", [privatePdf.id]);
      const short = await backendMod.backendFromEnv().presign!(row.storage_key, 1, { contentType: "application/pdf", disposition: "inline" });
      await new Promise((r) => setTimeout(r, 2500));
      expect((await rawGet(short)).status).toBe(403);
    } finally {
      delete process.env.STORAGE_PRIVATE_DELIVERY;
    }
  });

  it("proveedor no disponible: 503 controlado, fila `failed` y los ficheros previos intactos", async () => {
    const before = await ess.sql("a", "SELECT COUNT(*) AS n FROM stored_objects WHERE status = 'active'");
    files.setFileServiceForTests(
      new files.FileService({
        backend: () => new backendMod.S3ObjectBackend({ bucket, region: "us-east-1", endpoint: "http://127.0.0.1:1", accessKeyId: "x", secretAccessKey: "y", timeoutMs: 1500 }),
        retryDelayMs: 1,
        attempts: 2,
      }),
    );
    try {
      const up = await request(ess.port, ess.host("a"), "POST", "/api/upload/image", { cookie: admA, ...multipart("image", "otra.png", "image/png", PNG) });
      expect(up.status).toBe(503);
      expect(up.json.error).toMatch(/no está disponible/);
      expect(errCode(await ess.m("a", "crm.quotes.uploadProofOnly", { quoteId: 1, fileBase64: PDF.toString("base64"), fileName: "j.pdf", mimeType: "application/pdf" }, agA))).toBe("SERVICE_UNAVAILABLE");
      expect((await get("a", privatePdf.url, agA)).status).toBe(503);
      const failed = await ess.sql("a", "SELECT status, error FROM stored_objects WHERE status = 'failed'");
      expect(failed.length).toBe(2);
      expect(failed.every((f: any) => f.error === "upload")).toBe(true);
      expect(await ess.sql("a", "SELECT COUNT(*) AS n FROM stored_objects WHERE status = 'active'")).toEqual(before);
      // El registro de multimedia no recibió una fila sin fichero
      expect((await ess.sql("a", "SELECT COUNT(*) AS n FROM media_files"))[0].n).toBe(1);
    } finally {
      configureStorage();
    }
    expect((await get("a", privatePdf.url, agA)).body.equals(PDF)).toBe(true);
  });

  it("persistencia tras redespliegue: aplicación y cliente nuevos sobre el mismo bucket y la misma BD", async () => {
    configureStorage(); // proveedor y servicio nuevos (sin estado en memoria)
    const { installTenantResolution, installTenantBinding } = await import("./_core/tenantRegistry/install");
    const { createLocalAuthRouter } = await import("./localAuth");
    const fileRouter = (await import("./fileRoutes")).default;
    const app = express();
    const rt = installTenantResolution(app, process.env)!;
    installTenantBinding(app);
    app.use(createLocalAuthRouter());
    app.use(fileRouter);
    const server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as AddressInfo).port;
    try {
      const pub = await request(port, ess.host("a"), "GET", pathOf(publicImage.url));
      expect(pub.status).toBe(200);
      expect(pub.body.equals(PNG)).toBe(true);
      const priv = await request(port, ess.host("a"), "GET", privatePdf.url, { cookie: agA });
      expect(priv.status).toBe(200);
      expect(priv.body.equals(PDF)).toBe(true);
      expect((await request(port, ess.host("b"), "GET", privatePdf.url, { cookie: admB })).status).toBe(404);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
      await rt.close();
    }
  });

  it("borrado autorizado y restauración individual desde la réplica de ficheros de la copia", async () => {
    const { backupTenantFiles } = await import("./_core/ops/backupJob");
    const { FsBackupStorage, FsMediaSource, S3MediaSource } = await import("./_core/ops/backupStorage");
    const { backupKeyringFromEnv } = await import("./_core/ops/backupCrypto");
    const { restoreStoredObject } = await import("./_core/files/restore");
    const { MysqlObjectMetaStore } = await import("./storedObjectsDb");
    const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), "almacen-copias-"));
    try {
      const storage = new FsBackupStorage(backupDir);
      const ring = backupKeyringFromEnv({ BACKUP_KEYS: `k1:${crypto.randomBytes(32).toString("base64")}`, BACKUP_ACTIVE_KEY_ID: "k1" } as NodeJS.ProcessEnv);
      const media = S3_ENDPOINT
        ? new S3MediaSource({ bucket, region: "us-east-1", endpoint: S3_ENDPOINT, accessKeyId: process.env.S3_ACCESS_KEY!, secretAccessKey: process.env.S3_SECRET_KEY! })
        : new FsMediaSource(localDir!);
      const inventory = { start: async () => 1, succeed: async () => undefined, fail: async (_i: number, _f: number, e: string) => { throw new Error(e); } } as any;
      const res = await backupTenantFiles(ess.ids.a, media, { storage, ring, inventory, runId: "prueba", tmpDir: backupDir, now: Date.now } as any);
      expect(res.status).toBe("ok");

      // Borrado: cliente no; equipo comercial sí (categoría del justificante)
      expect((await request(ess.port, ess.host("a"), "DELETE", privatePdf.url, { cookie: userA })).status).toBe(403);
      expect((await request(ess.port, ess.host("a"), "DELETE", privatePdf.url, { cookie: agA })).status).toBe(200);
      expect((await get("a", privatePdf.url, agA)).status).toBe(404);
      const [del] = await ess.sql("a", "SELECT status, storage_key, bytes_removed_at FROM stored_objects WHERE object_id = ?", [privatePdf.id]);
      expect(del.status).toBe("deleted");
      expect(del.bytes_removed_at).not.toBeNull();
      expect(await backendMod.backendFromEnv().get(del.storage_key)).toBeNull();

      // Restauración individual: simulación y aplicación (contenido + metadatos)
      const poolA = await tenantPool("a");
      const deps = { storage, ring, tenantId: ess.ids.a, backend: backendMod.backendFromEnv(), meta: new MysqlObjectMetaStore(() => poolA) };
      const dry = await restoreStoredObject(deps, privatePdf.id);
      expect(dry).toMatchObject({ applied: false, bytes: PDF.length, contentType: "application/pdf" });
      expect((await get("a", privatePdf.url, agA)).status).toBe(404);
      const done = await restoreStoredObject(deps, privatePdf.id, { apply: true });
      expect(done.applied).toBe(true);
      const back = await get("a", privatePdf.url, agA);
      expect(back.status).toBe(200);
      expect(back.body.equals(PDF)).toBe(true);
      // La réplica de A no sirve para restaurar en el espacio de B
      await expect(restoreStoredObject({ ...deps, tenantId: ess.ids.b }, privatePdf.id)).rejects.toThrow();
    } finally {
      fs.rmSync(backupDir, { recursive: true, force: true });
    }
  });

  it("limpieza de huérfanos: simulación por defecto, solo en el espacio de la empresa", async () => {
    const { MysqlObjectMetaStore } = await import("./storedObjectsDb");
    const backend = backendMod.backendFromEnv();
    const orphan = `t/${ess.ids.a}/o/media/2020/01/${files.newObjectId()}.png`;
    const otherTenant = `t/${ess.ids.b}/o/media/2020/01/${files.newObjectId()}.png`;
    await backend.put(orphan, PNG, "image/png");
    await backend.put(otherTenant, PNG, "image/png");
    const poolA = await tenantPool("a");
    const svc = new files.FileService({ backend: () => backend, meta: new MysqlObjectMetaStore(() => poolA), now: () => Date.now() + 48 * 3600 * 1000 });
    const dry = await tenantMod.runWithTenant(ess.ids.a, () => svc.cleanup());
    expect(dry.bucketOrphans).toContain(orphan);
    expect(dry.bucketOrphans).not.toContain(otherTenant);
    expect(dry.staleUploads.length).toBe(2); // las subidas fallidas de la prueba de proveedor caído
    expect(await backend.get(orphan)).not.toBeNull();
    const done = await tenantMod.runWithTenant(ess.ids.a, () => svc.cleanup({ apply: true }));
    expect(done.errors).toBe(0);
    expect(await backend.get(orphan)).toBeNull();
    expect(await backend.get(otherTenant)).not.toBeNull();
    expect((await get("a", pathOf(publicImage.url))).status).toBe(200);
    expect((await get("a", privatePdf.url, agA)).status).toBe(200);
  });
});
