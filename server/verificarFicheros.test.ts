/**
 * Simulacro de recuperación de ficheros, solo de comprobación (`verify-files`): descifra y compara hashes sin escribir nada.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { backupKeyringFromEnv, encryptBuffer } from "./_core/ops/backupCrypto";
import { backupAad, filesIndexKey, verifyTenantFiles } from "./_core/ops/backupJob";
import type { BackupStorage } from "./_core/ops/backupStorage";
import { isAllowedDrill } from "../scripts/deploy/esRailwayLib";

const ring = backupKeyringFromEnv({ BACKUP_KEYS: `k1:${crypto.randomBytes(32).toString("base64")}`, BACKUP_ACTIVE_KEY_ID: "k1" } as NodeJS.ProcessEnv);
const sha = (b: Buffer) => crypto.createHash("sha256").update(b).digest("hex");

function memoryStorage() {
  const m = new Map<string, Buffer>();
  const writes: string[] = [];
  const storage = {
    kind: "fs" as const,
    describe: () => "memoria",
    putFile: async () => { writes.push("putFile"); },
    putBuffer: async (k: string, d: Buffer) => { writes.push("putBuffer"); m.set(k, d); },
    getFile: async () => undefined,
    getBuffer: async (k: string) => m.get(k) ?? null,
    hash: async (k: string) => ({ sha256: sha(m.get(k) ?? Buffer.alloc(0)), bytes: (m.get(k) ?? Buffer.alloc(0)).length }),
    list: async () => [],
    delete: async () => { writes.push("delete"); },
  } as unknown as BackupStorage;
  return { m, storage, writes };
}

/** Réplica sintética de una empresa: índice cifrado + un objeto cifrado por fichero. */
function seed(tenant: string, files: Record<string, Buffer>, tamper?: { badHash?: string; missing?: string; badSize?: string }) {
  const { m, storage, writes } = memoryStorage();
  const entries: Record<string, unknown> = {};
  for (const [name, plain] of Object.entries(files)) {
    const key = `t/${tenant}/${name}`;
    const object = `files/${tenant}/objects/${sha(plain).slice(0, 16)}.enc`;
    if (name !== tamper?.missing) m.set(object, encryptBuffer(plain, ring, backupAad("files", `${tenant}:${key}`)));
    entries[key] = { bytes: name === tamper?.badSize ? plain.length + 1 : plain.length, etag: null, sha256: name === tamper?.badHash ? "0".repeat(64) : sha(plain), object, copiedAt: "2026-11-21T00:00:00.000Z" };
  }
  const index = { format: "elephant-files-index", version: 1, tenantId: tenant, updatedAt: "2026-11-21T00:00:00.000Z", entries };
  m.set(filesIndexKey(tenant), encryptBuffer(Buffer.from(JSON.stringify(index)), ring, backupAad("files-index", tenant)));
  return { storage, writes };
}

const FILES = { "a/video.mp4": crypto.randomBytes(5000), "b/guia.pdf": Buffer.from("%PDF-1.4 prueba"), "c/audio.mp3": crypto.randomBytes(777) };

describe("verify-files: simulacro de recuperación solo de comprobación", () => {
  it("verifica todos los ficheros por SHA-256 y tamaño, y devuelve un resumen estable", async () => {
    const { storage } = seed("t-demo", FILES);
    const r = await verifyTenantFiles({ storage, ring }, "t-demo");
    expect(r).toMatchObject({ tenantId: "t-demo", files: 3, failed: [] });
    expect(r.bytes).toBe(5000 + 15 + 777);
    expect(r.entries.every((e) => e.ok)).toBe(true);
    const again = await verifyTenantFiles({ storage, ring }, "t-demo");
    expect(again.digest).toBe(r.digest);
    expect(r.entries.map((e) => e.key)).toEqual(["t/t-demo/a/video.mp4", "t/t-demo/b/guia.pdf", "t/t-demo/c/audio.mp3"]);
  });

  it("no escribe nada: ni en la réplica ni en disco", async () => {
    const before = fs.readdirSync(os.tmpdir()).length;
    const { storage, writes } = seed("t-demo", FILES);
    const seeded = writes.length; // lo que escribió la propia siembra (putBuffer de la prueba no se cuenta: usa el mapa)
    await verifyTenantFiles({ storage, ring }, "t-demo");
    expect(writes.length).toBe(seeded);
    expect(writes.filter((w) => w !== "putBuffer")).toEqual([]);
    expect(fs.readdirSync(os.tmpdir()).length).toBeLessThanOrEqual(before + 1);
  });

  it("informa de TODOS los fallos sin detenerse en el primero (hash, tamaño y objeto ausente)", async () => {
    const { storage } = seed("t-demo", FILES, { badHash: "a/video.mp4", badSize: "b/guia.pdf", missing: "c/audio.mp3" });
    const r = await verifyTenantFiles({ storage, ring }, "t-demo");
    expect(r.failed.map((f) => f.key).sort()).toEqual(["t/t-demo/a/video.mp4", "t/t-demo/b/guia.pdf", "t/t-demo/c/audio.mp3"]);
    expect(r.failed.find((f) => f.key.endsWith("video.mp4"))?.reason).toMatch(/SHA-256/);
    expect(r.failed.find((f) => f.key.endsWith("guia.pdf"))?.reason).toMatch(/tamaño/);
    expect(r.failed.find((f) => f.key.endsWith("audio.mp3"))?.reason).toMatch(/falta/);
  });

  it("un objeto manipulado (cifrado alterado) se detecta", async () => {
    const { storage } = seed("t-demo", FILES);
    const obj = (await (storage as unknown as { getBuffer: (k: string) => Promise<Buffer | null> }).getBuffer(`files/t-demo/objects/${sha(FILES["b/guia.pdf"]).slice(0, 16)}.enc`))!;
    obj[obj.length - 1] ^= 0xff;
    const r = await verifyTenantFiles({ storage, ring }, "t-demo");
    expect(r.failed.map((f) => f.key)).toEqual(["t/t-demo/b/guia.pdf"]);
  });

  it("sin réplica de ficheros para la empresa falla con un mensaje claro", async () => {
    const { storage } = memoryStorage();
    await expect(verifyTenantFiles({ storage, ring }, "t-vacia")).rejects.toThrow(/No hay réplica/);
  });

  it("un índice con la clave de otra empresa no se da por bueno", async () => {
    const { m, storage } = memoryStorage();
    const key = "t/otra-empresa/x.pdf";
    const idx = { format: "elephant-files-index", version: 1, tenantId: "t-demo", updatedAt: "x", entries: { [key]: { bytes: 1, etag: null, sha256: "0".repeat(64), object: "o", copiedAt: "x" } } };
    m.set(filesIndexKey("t-demo"), encryptBuffer(Buffer.from(JSON.stringify(idx)), ring, backupAad("files-index", "t-demo")));
    const r = await verifyTenantFiles({ storage, ring }, "t-demo");
    expect(r.failed[0].reason).toMatch(/otra empresa/);
  });

  it("la orden solo se admite en el drill con una empresa y nunca restaura ni escribe", () => {
    expect(isAllowedDrill("node dist-cp/backup-job.js verify-files t12-quantum-soulrise")).toBe(true);
    for (const bad of [
      "node dist-cp/backup-job.js verify-files",
      "node dist-cp/backup-job.js verify-files a,b",
      "node dist-cp/backup-job.js verify-files t12; rm -rf /",
      "node dist-cp/backup-job.js restore-files t12-quantum-soulrise --out /tmp/x",
      "node dist-cp/backup-job.js restore-files t12-quantum-soulrise --to-media",
    ]) expect(isAllowedDrill(bad), bad).toBe(false);
  });

  it("el flujo la declara como acción protegida (no está entre las ordinarias de production)", async () => {
    const { ORDINARY_PRODUCTION_ACTIONS } = await import("../scripts/deploy/esRailwayLib");
    const wf = fs.readFileSync(path.resolve(__dirname, "../.github/workflows/deploy-elephant-source.yml"), "utf8");
    expect(wf).toContain("- verificar-ficheros");
    expect(ORDINARY_PRODUCTION_ACTIONS as readonly string[]).not.toContain("verificar-ficheros");
  });
});
