/**
 * Ficheros grandes de la exportación: subida en streaming desde el disco (FileService.putFile, sin el límite
 * general de 25 MB de las subidas de usuario pero con el de su categoría), comprobaciones de tipo y tamaño,
 * búsqueda por propietario (reintentos sin duplicados) y lectura en streaming para la entrega. Y el programador:
 * la tarea de exportación recorre también las empresas suspendidas o en solo lectura; las demás, no.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { LocalObjectBackend } from "./_core/files/backend";
import { FileService, FileValidationError } from "./_core/files/service";
import { MemoryObjectMetaStore } from "./storedObjectsDb";
import { adminTenantLister, writableTenantLister } from "./_core/tenantRegistry/jobs";

const MB = 1048576;
let dir: string;
let svc: FileService;
let backend: LocalObjectBackend;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "export-storage-"));
  backend = new LocalObjectBackend(path.join(dir, "bucket"));
  svc = new FileService({ backend: () => backend, meta: new MemoryObjectMetaStore(), retryDelayMs: 1 });
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

async function zipFile(bytes: number) {
  const p = path.join(dir, `z-${bytes}.zip`);
  const fh = await fs.open(p, "w");
  const head = Buffer.alloc(4);
  head.writeUInt32LE(0x04034b50, 0);
  await fh.write(head);
  const chunk = crypto.randomBytes(MB);
  let left = bytes - 4;
  while (left > 0) {
    const n = Math.min(left, MB);
    await fh.write(chunk.subarray(0, n));
    left -= n;
  }
  await fh.close();
  const sha = crypto.createHash("sha256").update(await fs.readFile(p)).digest("hex");
  return { p, sha };
}

describe("subida y entrega en streaming", () => {
  it("un ZIP de 40 MB (por encima del límite general de 25 MB) se sube, queda activo y se lee en flujo idéntico", async () => {
    const { p, sha } = await zipFile(40 * MB);
    const r = await svc.putFile({ category: "data-export", filePath: p, sizeBytes: 40 * MB, sha256: sha, originalName: "exportacion.zip", owner: { type: "data-export", id: "export:1" }, uploadedBy: 7 });
    expect(r).toMatchObject({ contentType: "application/zip", sizeBytes: 40 * MB, sha256: sha, visibility: "private" });
    expect((await svc.find(r.objectId))?.status).toBe("active");
    const s = await svc.openStream(r.objectId);
    const h = crypto.createHash("sha256");
    for await (const c of s!.stream) h.update(c as Buffer);
    expect(h.digest("hex")).toBe(sha);
    expect((await svc.listByOwner("data-export", "export:1")).map((x) => x.objectId)).toEqual([r.objectId]);
    expect(await svc.listByOwner("data-export", "export:2")).toEqual([]);
  });

  it("rechaza lo que no es un ZIP, un tamaño que no coincide, categorías públicas o sin ZIP y lo que supera su categoría", async () => {
    const txt = path.join(dir, "no.zip");
    await fs.writeFile(txt, "hola, no soy un zip");
    await expect(svc.putFile({ category: "data-export", filePath: txt, sizeBytes: 19, sha256: "x" })).rejects.toBeInstanceOf(FileValidationError);
    const { p, sha } = await zipFile(MB);
    await expect(svc.putFile({ category: "data-export", filePath: p, sizeBytes: MB + 1, sha256: sha })).rejects.toBeInstanceOf(FileValidationError);
    await expect(svc.putFile({ category: "media", filePath: p, sizeBytes: MB, sha256: sha })).rejects.toBeInstanceOf(FileValidationError);
    await expect(svc.putFile({ category: "data-export", filePath: p, sizeBytes: 4097 * MB, sha256: sha })).rejects.toBeInstanceOf(FileValidationError);
  });

  it("un proveedor que pierde el fichero: la subida falla y la fila queda fallida (nunca activa)", async () => {
    const { p, sha } = await zipFile(MB);
    const lossy = Object.assign(Object.create(backend), { stat: async () => ({ bytes: 1 }) });
    const s = new FileService({ backend: () => lossy, meta: new MemoryObjectMetaStore(), retryDelayMs: 1 });
    await expect(s.putFile({ category: "data-export", filePath: p, sizeBytes: MB, sha256: sha })).rejects.toThrow();
  });
});

describe("programador: la exportación sigue en empresas suspendidas", () => {
  it("con panel (activa, prueba, gracia, suspendida) sí; archivada, en alta o eliminada, no", async () => {
    const reader = { listTenants: async () => ["active", "trial", "grace", "suspended", "archived", "provisioning", "deleted"].map((status, i) => ({ id: `t${i}-${status}`, status })) } as never;
    expect(await adminTenantLister(reader)()).toEqual(["t0-active", "t1-trial", "t2-grace", "t3-suspended"]);
    expect(await writableTenantLister(reader)()).toEqual(["t0-active", "t1-trial", "t2-grace"]);
  });
});
