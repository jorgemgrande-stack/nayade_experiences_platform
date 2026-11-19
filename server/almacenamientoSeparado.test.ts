/**
 * Almacenamiento separado (general / Elephant Learning) y máximo por imagen de cada empresa.
 *
 * Reproduce el caso de Quantum Soulrise: plan Essential con 5 GB, ~14 GB de contenido educativo ya guardado. El
 * contenido de formación no debe consumir el almacenamiento general; tiene su propia cuota (0 por defecto, concedida
 * de forma expresa); y el máximo por imagen es 10 MB para todos salvo una condición negociada de esa empresa.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MemoryTenantLimitStore } from "./_core/limits/store";
import { configureLimitAccess } from "./_core/limits/access";
import { MemoryCapabilityStore } from "./_core/capabilities/store";
import { configureCapabilityAccess, _resetCapabilityAccessForTests } from "./_core/capabilities/access";
import { configureQuotaExceptions } from "./_core/erm/exceptionAccess";
import { MemoryQuotaExceptionStore } from "./_core/erm/quotaExceptions";
import { capabilitiesOfTier } from "./catalog/capabilities";
import { runWithTenant } from "./_core/tenant";
import { FileService, FileValidationError } from "./_core/files/service";
import { LocalObjectBackend } from "./_core/files/backend";
import { MemoryObjectMetaStore, categoryInScope, type StoredObjectRow } from "./storedObjectsDb";
import { imageMaxBytes } from "./_core/files/limits";
import { usageLevel } from "./routers/storageUsage";

const GB = 1024 ** 3;
const MB = 1024 * 1024;
const actor = "operator:pruebas";
const DAY = 86_400_000;

const row = (p: Partial<StoredObjectRow> & { objectId: string }): StoredObjectRow =>
  ({
    storageKey: `k/${p.objectId}`, visibility: "private", category: "media", contentType: "image/png", sizeBytes: 1000, sha256: p.objectId, originalName: null,
    ownerType: null, ownerId: null, uploadedBy: null, status: "active", replacesObjectId: null, replacedBy: null, error: null, createdAt: 1, updatedAt: 1,
    confirmedAt: 1, deletedAt: null, bytesRemovedAt: null, ...p,
  }) as StoredObjectRow;

const png = (size: number) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(size - 8)]);
const mp4 = (size: number) => Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypmp42"), Buffer.alloc(size - 12)]);

describe("almacenamiento separado y límite por imagen", () => {
  const env = { ...process.env };
  let dir: string;
  let exceptions = new MemoryQuotaExceptionStore();

  const grant = (tenantId: string, metric: string, newLimit: number) =>
    exceptions.create({ tenantId, metric, period: "total", originalLimit: null, newLimit, reason: "Condición negociada de pruebas", operator: actor, startsAt: Date.now() - DAY, expiresAt: Date.now() + 30 * DAY }, Date.now());

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "almacen-"));
    exceptions = new MemoryQuotaExceptionStore();
    process.env.TENANT_MODE = "multi";
    process.env.APP_URL = "https://empresa.example";
    // Dos empresas Essential con 5 GB contratados
    const caps = new MemoryCapabilityStore();
    for (const t of ["t-quantum", "t-otra"]) {
      await caps.apply(t, capabilitiesOfTier("essential").map((capabilityId) => ({ capabilityId, siteId: "", status: "active" as const, validUntil: null, source: "subscription:1" })), { actor, now: 1 } as never);
    }
    configureCapabilityAccess(caps, { enforce: true, ttlMs: 0 });
    const limits = new MemoryTenantLimitStore();
    for (const t of ["t-quantum", "t-otra"]) await limits.setLimits(t, [{ metric: "storage_gb", limit: 5 }], { source: "subscription:1", actor, now: 1 });
    configureLimitAccess(limits, { enforce: true, ttlMs: 0 });
    configureQuotaExceptions(exceptions, { enforce: true, ttlMs: 0 });
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    process.env = { ...env };
    configureLimitAccess(null);
    configureQuotaExceptions(null);
    _resetCapabilityAccessForTests();
  });

  const service = (meta: MemoryObjectMetaStore) => new FileService({ backend: () => new LocalObjectBackend(dir), meta, retryDelayMs: 1 });

  it("el contenido educativo no cuenta contra los 5 GB generales: Quantum vuelve a poder subir imágenes", async () => {
    const meta = new MemoryObjectMetaStore();
    await meta.insert(row({ objectId: "v1", category: "learning-content", contentType: "video/mp4", sizeBytes: 14 * GB + 100 * MB }));
    for (let i = 0; i < 28; i++) await meta.insert(row({ objectId: `m${i}`, sizeBytes: 2 * MB }));
    expect(await meta.usedBytes("all")).toBe(14 * GB + 100 * MB + 56 * MB);
    expect(await meta.usedBytes("general")).toBe(56 * MB);
    expect(await meta.usedBytes("learning")).toBe(14 * GB + 100 * MB);
    const ok = await runWithTenant("t-quantum", () => service(meta).put({ category: "media", data: png(3 * MB), declaredType: "image/png" }));
    expect(ok.sizeBytes).toBe(3 * MB);
  });

  it("el almacenamiento general sigue limitado: con 5 GB de imágenes y documentos, se rechaza", async () => {
    const meta = new MemoryObjectMetaStore();
    await meta.insert(row({ objectId: "g1", category: "invoice", contentType: "application/pdf", sizeBytes: 5 * GB - 10 }));
    await expect(runWithTenant("t-quantum", () => service(meta).put({ category: "media", data: png(1 * MB), declaredType: "image/png" }))).rejects.toThrow(/almacenamiento contratado \(5 GB\)/);
  });

  it("Learning: por defecto 0 (sin concesión no se sube); con 25 GB cabe hasta ese tope y no más; no se pierde la medición", async () => {
    const meta = new MemoryObjectMetaStore();
    await meta.insert(row({ objectId: "v1", category: "learning-content", contentType: "video/mp4", sizeBytes: 14 * GB }));
    const svc = service(meta);
    await expect(runWithTenant("t-quantum", () => svc.assertStorageQuota("learning-content", 1 * MB))).rejects.toThrow(/almacenamiento de formación asignado \(0 GB\)/);
    await grant("t-quantum", "learning_storage_gb", 25);
    await expect(runWithTenant("t-quantum", () => svc.assertStorageQuota("learning-content", 1 * GB))).resolves.toBeUndefined();
    await expect(runWithTenant("t-quantum", () => svc.assertStorageQuota("learning-content", 12 * GB))).rejects.toThrow(/almacenamiento de formación asignado \(25 GB\)/);
    // Otra empresa no hereda la concesión
    await expect(runWithTenant("t-otra", () => svc.assertStorageQuota("learning-content", 1 * MB))).rejects.toBeInstanceOf(FileValidationError);
    // Lo educativo sigue medido (no se excluye): 14 GB
    expect(await meta.usedBytes("learning")).toBe(14 * GB);
  });

  it("putFile del LMS ahora comprueba la cuota Learning (antes entraba sin contar)", async () => {
    const meta = new MemoryObjectMetaStore();
    const svc = service(meta);
    const file = path.join(dir, "clase.mp4");
    fs.writeFileSync(file, mp4(2048));
    const input = { category: "learning-content" as const, filePath: file, sizeBytes: 2048, sha256: "a".repeat(64), detectType: true, declaredType: "video/mp4" };
    await expect(runWithTenant("t-quantum", () => svc.putFile(input))).rejects.toThrow(/formación/);
    await grant("t-quantum", "learning_storage_gb", 25);
    const stored = await runWithTenant("t-quantum", () => svc.putFile(input));
    expect(stored.contentType).toBe("video/mp4");
  });

  it("máximo por imagen: 10 MB para todos; 25 MB solo para la empresa con condición negociada; nunca más que el techo técnico", async () => {
    const meta = new MemoryObjectMetaStore();
    const svc = service(meta);
    expect(await runWithTenant("t-quantum", () => imageMaxBytes())).toBe(10 * MB);
    await grant("t-quantum", "media_file_mb", 25);
    expect(await runWithTenant("t-quantum", () => imageMaxBytes())).toBe(25 * MB);
    expect(await runWithTenant("t-otra", () => imageMaxBytes())).toBe(10 * MB);
    // Quantum: 12 MB y 25 MB sí; 26 MB no. La otra empresa: 12 MB no
    expect((await runWithTenant("t-quantum", () => svc.put({ category: "media", data: png(12 * MB), declaredType: "image/png" }))).sizeBytes).toBe(12 * MB);
    expect((await runWithTenant("t-quantum", () => svc.put({ category: "media", data: png(25 * MB), declaredType: "image/png" }))).sizeBytes).toBe(25 * MB);
    await expect(runWithTenant("t-quantum", () => svc.put({ category: "media", data: png(26 * MB), declaredType: "image/png" }))).rejects.toThrow(/25 MB/);
    await expect(runWithTenant("t-otra", () => svc.put({ category: "media", data: png(12 * MB), declaredType: "image/png" }))).rejects.toThrow(/10 MB/);
    // Una condición exagerada no supera el techo de la plataforma
    await exceptions.revoke("t-quantum", (await exceptions.exceptions("t-quantum")).find((e) => e.metric === "media_file_mb")!.id, { actor, reason: "Prueba de techo", now: Date.now() });
    await grant("t-quantum", "media_file_mb", 500);
    expect(await runWithTenant("t-quantum", () => imageMaxBytes())).toBe(25 * MB);
  });

  it("desglose por categoría, ámbitos y ficheros repetidos (misma huella), calculado de lo guardado", async () => {
    const meta = new MemoryObjectMetaStore();
    await meta.insert(row({ objectId: "a", category: "learning-content", sha256: "h1", sizeBytes: 100 }));
    await meta.insert(row({ objectId: "b", category: "learning-content", sha256: "h1", sizeBytes: 100 }));
    await meta.insert(row({ objectId: "c", category: "media", sha256: "h2", sizeBytes: 50 }));
    await meta.insert(row({ objectId: "d", category: "data-export", sha256: "h3", sizeBytes: 999 }));
    await meta.insert(row({ objectId: "e", category: "media", sha256: "h4", sizeBytes: 70, status: "deleted" as never }));
    const br = await meta.usageBreakdown!();
    expect(br.categories.find((c) => c.category === "learning-content")).toMatchObject({ objects: 2, bytes: 200, distinctHashes: 1 });
    expect(br.categories.find((c) => c.category === "media")).toMatchObject({ objects: 1, bytes: 50 });
    expect(br.duplicates).toEqual({ groups: 1, extraObjects: 1, extraBytes: 100 });
    // Borrados y exportaciones no cuentan; el resto sí, sin doble contabilización
    expect(await meta.usedBytes("all")).toBe(250);
    expect(await meta.usedBytes("general")).toBe(50);
    expect(await meta.usedBytes("learning")).toBe(200);
    expect(categoryInScope("data-export", "all")).toBe(false);
  });

  it("niveles de consumo", () => {
    expect(usageLevel(0, 5)).toBe("ok");
    expect(usageLevel(4.1 * GB, 5)).toBe("warning");
    expect(usageLevel(4.8 * GB, 5)).toBe("critical");
    expect(usageLevel(5.1 * GB, 5)).toBe("exceeded");
    expect(usageLevel(10 * GB, null)).toBe("ok");
    expect(usageLevel(1, 0)).toBe("exceeded");
  });
});
