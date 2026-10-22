/**
 * Servicio de almacenamiento persistente (unitarias, sin red): validación por contenido, claves seguras,
 * integridad tras subir, errores controlados y reintentos, sustitución, borrado, limpieza de huérfanos,
 * enlaces firmados y compatibilidad del modo heredado. La prueba con MySQL + MinIO y dos empresas está en
 * `server/fileStorage.mysql.test.ts`.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { detectContentType, isSafeSvg, safeDisplayName } from "./_core/files/contentType";
import { categoryFromLegacyKey } from "./_core/files/categories";
import { LocalObjectBackend, StorageUnavailableError, type ObjectBackend } from "./_core/files/backend";
import {
  FileService,
  FileValidationError,
  OBJECT_ID_RE,
  isAcceptableFileUrl,
  newObjectId,
  objectIdFromUrl,
  objectStorageEnabled,
  signedLink,
  verifySignedLink,
} from "./_core/files/service";
import { MemoryObjectMetaStore } from "./storedObjectsDb";
import { runWithTenant } from "./_core/tenant";

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 2)]);
const PDF = Buffer.from("%PDF-1.7\n1 0 obj << >> endobj\n%%EOF\n");
const HTML = Buffer.from("<!doctype html><html><body><script>alert(1)</script></body></html>");
const SAFE_SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="url(#g)"/></svg>');
const EVIL_SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(1)</script></svg>');

let dir: string;
let backend: LocalObjectBackend;
let meta: MemoryObjectMetaStore;
let svc: FileService;
const env = { ...process.env };

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "almacen-"));
  backend = new LocalObjectBackend(dir);
  meta = new MemoryObjectMetaStore();
  svc = new FileService({ backend: () => backend, meta, retryDelayMs: 1 });
  process.env.APP_URL = "https://empresa.example";
  delete process.env.TENANT_MODE;
  delete process.env.STORAGE_OBJECTS;
  delete process.env.STORAGE_MAX_BYTES;
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  process.env = { ...env };
});

describe("tipo por contenido", () => {
  it("reconoce firmas y no se fía de lo declarado", () => {
    expect(detectContentType(PNG, "application/pdf")).toBe("image/png");
    expect(detectContentType(JPEG, "image/png")).toBe("image/jpeg");
    expect(detectContentType(PDF, "image/png")).toBe("application/pdf");
    expect(detectContentType(HTML, "image/png")).toBe("text/html");
    expect(detectContentType(SAFE_SVG, "image/png")).toBe("image/svg+xml");
    expect(detectContentType(Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03]), "image/png")).toBe("application/octet-stream");
    expect(detectContentType(Buffer.from("PK\u0003\u0004....word/document.xml"), "application/zip")).toBe("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    expect(detectContentType(Buffer.from("a;b\n1;2\n"), "text/csv")).toBe("text/csv");
  });

  it("SVG: solo el inofensivo es apto como público", () => {
    expect(isSafeSvg(SAFE_SVG)).toBe(true);
    expect(isSafeSvg(EVIL_SVG)).toBe(false);
    expect(isSafeSvg(Buffer.from('<svg><a href="https://otro.example">x</a></svg>'))).toBe(false);
    expect(isSafeSvg(Buffer.from('<svg><image href="javascript:alert(1)"/></svg>'))).toBe(false);
    expect(isSafeSvg(Buffer.from('<svg><foreignObject><div/></foreignObject></svg>'))).toBe(false);
  });

  it("nombres seguros: sin rutas, traversal ni caracteres de control", () => {
    expect(safeDisplayName("../../etc/passwd")).toBe("passwd");
    expect(safeDisplayName("..\\..\\win.ini")).toBe("win.ini");
    expect(safeDisplayName('fac"tura\u0000.pdf')).toBe("factura.pdf");
    expect(safeDisplayName("")).toBe("fichero");
  });

  it("categoría por la clave heredada; lo desconocido es privado", () => {
    expect(categoryFromLegacyKey("nayade/uploads/x.jpg")).toBe("media");
    expect(categoryFromLegacyKey("invoices/FAC-1.pdf")).toBe("invoice");
    expect(categoryFromLegacyKey("partner-billing/x.pdf")).toBe("settlement");
    expect(categoryFromLegacyKey("lo/que/sea")).toBe("internal");
  });
});

describe("subida", () => {
  it("privado: clave del servidor, metadatos, integridad y URL del Core", async () => {
    const r = await svc.put({ category: "invoice", data: PDF, declaredType: "application/pdf", originalName: "../FAC-0001.pdf", owner: { type: "invoice", id: "FAC-0001" } });
    expect(OBJECT_ID_RE.test(r.objectId)).toBe(true);
    expect(r.key).toMatch(new RegExp(`^o/invoice/\\d{4}/\\d{2}/${r.objectId}\\.pdf$`));
    expect(r.url).toBe(`/api/files/${r.objectId}`);
    expect(r.visibility).toBe("private");
    const row = (await meta.get(r.objectId))!;
    expect(row).toMatchObject({ status: "active", contentType: "application/pdf", sizeBytes: PDF.length, originalName: "FAC-0001.pdf", ownerType: "invoice", ownerId: "FAC-0001" });
    expect(row.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect((await svc.read(r.objectId))!.data.equals(PDF)).toBe(true);
    // Ficha de metadatos junto al objeto (para restaurar ficheros sueltos desde la copia)
    expect(fs.existsSync(path.join(dir, "o", "_meta", `${r.objectId}.json`))).toBe(true);
  });

  it("público: URL absoluta del Core (nunca del bucket)", async () => {
    const r = await svc.put({ category: "media", data: PNG, declaredType: "image/png", originalName: "Logo Empresa.png" });
    expect(r.url).toBe(`https://empresa.example/files/${r.objectId}/Logo-Empresa.png`);
    expect(r.visibility).toBe("public");
  });

  it("rechaza contenido no permitido, SVG peligroso como público y tamaño excesivo", async () => {
    await expect(svc.put({ category: "media", data: HTML, declaredType: "image/png" })).rejects.toBeInstanceOf(FileValidationError);
    await expect(svc.put({ category: "media", data: EVIL_SVG, declaredType: "image/svg+xml" })).rejects.toThrow(/SVG/);
    await expect(svc.put({ category: "transfer-proof", data: Buffer.from("MZ\u0090\u0000"), declaredType: "application/pdf" })).rejects.toBeInstanceOf(FileValidationError);
    process.env.STORAGE_MAX_BYTES = "10";
    await expect(svc.put({ category: "invoice", data: PDF })).rejects.toThrow(/tamaño máximo/);
    expect(meta.rows.size).toBe(0); // nada se registra si no se valida
    expect(await svc.put({ category: "media", data: SAFE_SVG }).catch((e) => e)).toBeInstanceOf(FileValidationError); // 10 bytes
    delete process.env.STORAGE_MAX_BYTES;
    expect((await svc.put({ category: "media", data: SAFE_SVG })).contentType).toBe("image/svg+xml");
  });

  it("proveedor caído: error controlado, fila `failed` y nada activo", async () => {
    const down: ObjectBackend = { ...backend, kind: "s3", describe: () => "caído", put: async () => { throw new StorageUnavailableError(); }, get: async () => null, stat: async () => null, delete: async () => undefined, list: async () => [] };
    const s = new FileService({ backend: () => down, meta, retryDelayMs: 1 });
    await expect(s.put({ category: "invoice", data: PDF })).rejects.toBeInstanceOf(StorageUnavailableError);
    const rows = Array.from(meta.rows.values());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "failed", error: "upload" });
    expect(await s.find(rows[0].objectId)).toBeNull();
  });

  it("reintenta fallos transitorios", async () => {
    let calls = 0;
    const flaky: ObjectBackend = Object.assign(Object.create(backend), {
      put: async (k: string, d: Buffer, t: string) => {
        if (++calls === 1) throw new StorageUnavailableError();
        return backend.put(k, d);
      },
    });
    const s = new FileService({ backend: () => flaky, meta, retryDelayMs: 1 });
    const r = await s.put({ category: "invoice", data: PDF });
    expect((await meta.get(r.objectId))!.status).toBe("active");
    expect(calls).toBeGreaterThanOrEqual(2);
  });

  it("integridad: si el proveedor devuelve otra cosa, la subida falla y se retira", async () => {
    const corrupt: ObjectBackend = Object.assign(Object.create(backend), {
      get: async (k: string) => {
        const b = await backend.get(k);
        return b ? Buffer.concat([b, Buffer.from("x")]) : b;
      },
    });
    const s = new FileService({ backend: () => corrupt, meta, retryDelayMs: 1 });
    await expect(s.put({ category: "invoice", data: PDF })).rejects.toBeInstanceOf(StorageUnavailableError);
    const row = Array.from(meta.rows.values())[0];
    expect(row).toMatchObject({ status: "failed", error: "verify_mismatch" });
    expect(await backend.get(row.storageKey)).toBeNull();
  });
});

describe("sustitución, borrado y limpieza", () => {
  it("el anterior se conserva hasta confirmar el nuevo; si el nuevo falla, sigue activo", async () => {
    const a = await svc.put({ category: "media", data: PNG });
    await expect(svc.put({ category: "media", data: HTML, replaces: a.objectId })).rejects.toBeInstanceOf(FileValidationError);
    expect((await meta.get(a.objectId))!.status).toBe("active");
    const b = await svc.put({ category: "media", data: JPEG, replaces: a.objectId });
    expect(await meta.get(a.objectId)).toMatchObject({ status: "replaced", replacedBy: b.objectId });
    expect(await backend.get((await meta.get(a.objectId))!.storageKey)).not.toBeNull(); // contenido aún presente
  });

  it("borrado: deja de servirse y se retira del proveedor", async () => {
    const a = await svc.put({ category: "invoice", data: PDF });
    expect(await svc.delete(a.objectId)).toBe(true);
    expect(await svc.find(a.objectId)).toBeNull();
    expect(await backend.get(a.key)).toBeNull();
    expect((await meta.get(a.objectId))!.bytesRemovedAt).not.toBeNull();
    expect(await svc.delete(a.objectId)).toBe(false);
  });

  it("limpieza: simulación por defecto; con apply retira huérfanos y sustituidos; no toca lo heredado", async () => {
    let now = Date.now();
    const s = new FileService({ backend: () => backend, meta, now: () => now, retryDelayMs: 1 });
    const a = await s.put({ category: "media", data: PNG });
    const b = await s.put({ category: "media", data: JPEG, replaces: a.objectId });
    await backend.put("o/media/2020/01/huerfano0000000000000000000.png", PNG);
    await backend.put("nayade/uploads/heredado.png", PNG);
    now += 48 * 3600 * 1000;
    const dry = await s.cleanup();
    expect(dry.apply).toBe(false);
    expect(dry.superseded).toEqual([a.objectId]);
    expect(dry.bucketOrphans).toEqual(["o/media/2020/01/huerfano0000000000000000000.png"]);
    expect(await backend.get("o/media/2020/01/huerfano0000000000000000000.png")).not.toBeNull();
    const done = await s.cleanup({ apply: true });
    expect(done.errors).toBe(0);
    expect(await backend.get("o/media/2020/01/huerfano0000000000000000000.png")).toBeNull();
    expect(await backend.get((await meta.get(a.objectId))!.storageKey)).toBeNull();
    expect(await backend.get("nayade/uploads/heredado.png")).not.toBeNull();
    expect((await s.read(b.objectId))!.data.equals(JPEG)).toBe(true);
  });
});

describe("multiempresa y enlaces", () => {
  it("claves bajo t/<empresa>/o/ y una fila con clave de otra empresa no se sirve", async () => {
    process.env.TENANT_MODE = "multi";
    const a = await runWithTenant("empresa-a", () => svc.put({ category: "invoice", data: PDF }));
    expect(a.key.startsWith("t/empresa-a/o/invoice/")).toBe(true);
    expect(await runWithTenant("empresa-a", () => svc.find(a.objectId))).not.toBeNull();
    // Defensa en profundidad: aunque la fila apareciera en la BD de B, su clave no es de B
    expect(await runWithTenant("empresa-b", () => svc.find(a.objectId))).toBeNull();
  });

  it("enlace firmado: válido, caducado, alterado y de otra empresa", async () => {
    process.env.TENANT_MODE = "multi";
    process.env.JWT_SECRET = "secreto-de-prueba-solo-ci-000000000000"; // gitleaks:allow
    const id = newObjectId();
    const link = runWithTenant("empresa-a", () => signedLink(id, 60));
    const u = new URL(link);
    const exp = u.searchParams.get("exp");
    const sig = u.searchParams.get("sig");
    expect(runWithTenant("empresa-a", () => verifySignedLink(id, exp, sig))).toBe("valid");
    expect(runWithTenant("empresa-a", () => verifySignedLink(id, exp, sig, Date.now() + 120_000))).toBe("expired");
    expect(runWithTenant("empresa-a", () => verifySignedLink(id, Number(exp) + 1, sig))).toBe("invalid");
    expect(runWithTenant("empresa-b", () => verifySignedLink(id, exp, sig))).toBe("invalid");
    expect(runWithTenant("empresa-a", () => verifySignedLink(newObjectId(), exp, sig))).toBe("invalid");
  });

  it("URL propias y validación de URL guardadas", () => {
    const id = newObjectId();
    expect(objectIdFromUrl(`/api/files/${id}`)).toBe(id);
    expect(objectIdFromUrl(`https://x.example/files/${id}/logo.png`)).toBe(id);
    expect(objectIdFromUrl(`https://bucket.example/t/a/o/${id}.png`)).toBeNull();
    expect(isAcceptableFileUrl(`/api/files/${id}`)).toBe(true);
    expect(isAcceptableFileUrl("https://cdn.example/a.pdf")).toBe(true);
    expect(isAcceptableFileUrl("/otra/ruta")).toBe(false);
    expect(isAcceptableFileUrl("javascript:alert(1)")).toBe(false);
    expect(isAcceptableFileUrl("data:application/pdf;base64,JVBERg==")).toBe(true);
  });

  it("activación: por defecto solo en multiempresa; forzable con STORAGE_OBJECTS", () => {
    expect(objectStorageEnabled()).toBe(false);
    process.env.TENANT_MODE = "multi";
    expect(objectStorageEnabled()).toBe(true);
    process.env.STORAGE_OBJECTS = "off";
    expect(objectStorageEnabled()).toBe(false);
    delete process.env.TENANT_MODE;
    process.env.STORAGE_OBJECTS = "on";
    expect(objectStorageEnabled()).toBe(true);
  });
});

describe("compatibilidad de la instalación única (modo heredado)", () => {
  it("storagePut sin el servicio conserva el comportamiento: disco local y /local-storage", async () => {
    for (const k of ["BUILT_IN_FORGE_API_URL", "BUILT_IN_FORGE_API_KEY", "S3_ACCESS_KEY", "S3_SECRET_KEY", "APP_URL", "RAILWAY_PUBLIC_DOMAIN"]) delete process.env[k];
    process.env.LOCAL_STORAGE_PATH = dir;
    const { vi } = await import("vitest");
    vi.resetModules();
    const { storagePut } = await import("./storage");
    const r = await storagePut("nayade/uploads/heredado.png", PNG, "image/png", { category: "media" });
    expect(r).toEqual({ key: "nayade/uploads/heredado.png", url: "/local-storage/nayade/uploads/heredado.png" });
    expect(fs.readFileSync(path.join(dir, "nayade", "uploads", "heredado.png")).equals(PNG)).toBe(true);
  });
});
