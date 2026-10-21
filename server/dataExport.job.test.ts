/**
 * Exportación como trabajo asíncrono: la solicitud solo se registra; el trabajo la reclama con arriendo, la genera
 * en streaming a un temporal protegido y la sube. Pruebas de permisos y límites por empresa, reinicios (arriendo
 * caducado → reintento; intentos agotados → fallida y aviso), reintentos sin ZIP duplicados, descarte si deja de
 * estar en curso, tamaño (estimado y real), espacio temporal, cuotas del gestor de recursos y su medición,
 * concurrencia por proceso, limpieza de temporales, memoria con ficheros y tablas grandes, y avisos.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import JSZip from "jszip";
import type { ExportSource } from "./dataExport/build";
import {
  DataExportService,
  LEASE_MS,
  MAX_ATTEMPTS,
  MemoryDataExportStore,
  TEMP_MAX_AGE_MS,
  _resetExportProcessForTests,
  exportMaxBytes,
  type ExportNotice,
  type OpenedSource,
} from "./dataExport/service";
import { QuotaExceededError } from "./_core/erm/types";

const NOW = Date.UTC(2026, 9, 21, 9);
const MB = 1048576;
let tmp: string;

beforeEach(async () => {
  _resetExportProcessForTests();
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "export-job-"));
});
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

const source = (o: { rows?: number; files?: ExportSource["files"]; estimate?: number; gate?: Promise<void> } = {}): OpenedSource => ({
  tables: async () => {
    await o.gate;
    return ["clients", "users"];
  },
  columns: async (t) => (t === "users" ? ["id", "email", "passwordHash"] : ["id", "name"]),
  rows: async function* (t) {
    if (t === "users") return yield [{ id: 1, email: "ana@acme.example", passwordHash: "$2b$secreto" }];
    const total = o.rows ?? 3;
    for (let i = 0; i < total; i += 1000) yield Array.from({ length: Math.min(1000, total - i) }, (_, k) => ({ id: i + k + 1, name: `Cliente ${i + k + 1}` }));
  },
  files: o.files ?? (async () => [{ objectId: "a".repeat(26), category: "invoice", contentType: "application/pdf", sizeBytes: 4, originalName: "F1.pdf", open: async () => Readable.from([Buffer.from("%PDF")]) }]),
  estimate: async () => o.estimate ?? 1000,
});

function make(o: { src?: () => OpenedSource; now?: () => number; saveFails?: number; uploadThenFail?: number; maxBytes?: number; free?: number | null; quota?: (m: string, q: number) => Promise<void>; dailyLimit?: number } = {}) {
  const store = new MemoryDataExportStore();
  const objects = new Map<string, { owner: string; zip: Buffer }>();
  const sent: ExportNotice[] = [];
  const metered: Array<[string, number]> = [];
  let saveCalls = 0;
  let n = 0;
  const svc = new DataExportService({
    store,
    openSource: async () => (o.src ?? (() => source()))(),
    saveZip: async (z) => {
      saveCalls++;
      if (o.saveFails && saveCalls <= o.saveFails) throw Object.assign(new Error("proveedor caído"), { name: "StorageUnavailableError" });
      const id = String(++n).padStart(26, "0");
      objects.set(id, { owner: z.owner, zip: await fs.readFile(z.filePath) });
      // Subida hecha y caída del proceso antes de registrarla
      if (o.uploadThenFail && saveCalls <= o.uploadThenFail) throw Object.assign(new Error("se cortó"), { name: "StorageUnavailableError" });
      return id;
    },
    listOwned: async (owner) => [...objects].filter(([, v]) => v.owner === owner).map(([id]) => id),
    removeObject: async (id) => void objects.delete(id),
    signedLink: (id, ttl) => `https://acme.example/api/files/${id}?exp=${ttl}&sig=x`,
    requester: async () => ({ email: "ana@acme.example", name: "Ana" }),
    notify: async (x) => void sent.push(x),
    quota: o.quota,
    meter: (m, q) => void metered.push([m, q]),
    tmpRoot: tmp,
    freeBytes: async () => (o.free === undefined ? null : o.free),
    tenantId: "acme",
    maxBytes: o.maxBytes ?? 10 * MB,
    dailyLimit: o.dailyLimit,
    now: o.now ?? (() => NOW),
  });
  return { store, svc, objects, sent, metered };
}
const owner = { id: 7, isOwner: true };
const tempEntries = async () => {
  const out: string[] = [];
  for (const t of await fs.readdir(tmp).catch(() => [] as string[])) for (const j of await fs.readdir(path.join(tmp, t)).catch(() => [] as string[])) out.push(`${t}/${j}`);
  return out;
};

describe("solicitud: solo se registra; permisos y límites por empresa", () => {
  it("solo la persona propietaria; una en curso; límite diario", async () => {
    const { svc, store } = make({ dailyLimit: 2 });
    await expect(svc.request({ id: 8, isOwner: false })).rejects.toMatchObject({ code: "forbidden" });
    await expect(svc.list({ isOwner: false })).rejects.toMatchObject({ code: "forbidden" });
    await expect(svc.link({ isOwner: false }, 1)).rejects.toMatchObject({ code: "forbidden" });
    const e = await svc.request(owner);
    expect(e).toMatchObject({ status: "pending", attempts: 0 });
    await expect(svc.request(owner)).rejects.toMatchObject({ code: "conflict" });
    await svc.processNext();
    await svc.request(owner);
    await svc.processNext();
    await expect(svc.request(owner)).rejects.toMatchObject({ code: "rate_limited" });
    expect(store.rows.map((r) => r.status)).toEqual(["ready", "ready"]);
  });

  it("cuota de solicitudes del gestor de recursos: se rechaza sin registrar nada", async () => {
    const { svc, store } = make({ quota: async (m) => { if (m === "data_export.runs") throw new QuotaExceededError(m, {} as never); } });
    await expect(svc.request(owner)).rejects.toMatchObject({ code: "rate_limited" });
    expect(store.rows).toEqual([]);
  });
});

describe("generación en el trabajo", () => {
  it("lista con sus recuentos; sin secretos; temporales borrados; consumo y duración medidos; aviso", async () => {
    const { svc, store, objects, sent, metered } = make();
    await svc.request(owner);
    expect(await svc.processNext()).toBe("ready");
    const row = store.rows[0];
    expect(row).toMatchObject({ status: "ready", tableCount: 2, rowCount: 4, fileCount: 1, attempts: 1, missingFiles: 0, warning: null });
    expect(row.uncompressedBytes).toBeGreaterThan(0);
    const [[id, obj]] = [...objects];
    expect(row.objectId).toBe(id);
    expect(obj.owner).toBe("export:1");
    const zip = await JSZip.loadAsync(obj.zip);
    expect(await zip.file("data/clients.csv")!.async("string")).toContain("Cliente 3");
    expect(JSON.parse(await zip.file("data/users.json")!.async("string"))).toEqual([{ id: 1, email: "ana@acme.example" }]);
    expect(await zip.file(`files/invoice/${"a".repeat(26)}-F1.pdf`)!.async("string")).toBe("%PDF");
    const all = (await Promise.all(Object.values(zip.files).map((f) => f.async("string")))).join("");
    expect(all).not.toContain("$2b$secreto");
    expect(await tempEntries()).toEqual([]);
    expect(metered.map(([m]) => m)).toEqual(expect.arrayContaining(["data_export.runs", "data_export.bytes", "data_export.ms"]));
    expect(sent.map((s) => s.kind)).toEqual(["ready"]);
    expect(await svc.processNext()).toBe("idle");
  });

  it("incompleta (fichero ausente): lista con aviso, nunca como completa", async () => {
    const { svc, store } = make({ src: () => source({ files: async () => [{ objectId: "b".repeat(26), category: "media", contentType: "image/png", sizeBytes: 3, originalName: null, open: async () => { throw new Error("no está"); } }] }) });
    await svc.request(owner);
    await svc.processNext();
    expect(store.rows[0]).toMatchObject({ status: "ready", missingFiles: 1 });
    expect(store.rows[0].warning).toMatch(/incompleta/);
  });
});

describe("reinicios y reintentos", () => {
  it("proceso caído: el arriendo caduca, otro intento la retoma; agotados los intentos queda fallida y se avisa", async () => {
    let now = NOW;
    const { svc, store, sent } = make({ now: () => now });
    await svc.request(owner);
    // Simula MAX_ATTEMPTS generaciones que se cortan (reclamada y sin terminar)
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      expect(await store.claim(now, now - LEASE_MS, MAX_ATTEMPTS)).not.toBeNull();
      expect(await svc.processNext()).toBe("idle"); // el arriendo aún vale: nadie la toca
      now += LEASE_MS + 1;
    }
    expect(await svc.processNext()).toBe("idle");
    expect(store.rows[0]).toMatchObject({ status: "failed", attempts: MAX_ATTEMPTS });
    expect(store.rows[0].error).toMatch(/interrumpió/);
    expect(sent.map((s) => s.kind)).toEqual(["failed"]);
  });

  it("un corte retomado termina bien en el siguiente intento", async () => {
    let now = NOW;
    const { svc, store } = make({ now: () => now });
    await svc.request(owner);
    await store.claim(now, now - LEASE_MS, MAX_ATTEMPTS);
    now += LEASE_MS + 1;
    expect(await svc.processNext()).toBe("ready");
    expect(store.rows[0]).toMatchObject({ status: "ready", attempts: 2 });
  });

  it("fallo transitorio del almacenamiento: vuelve a la cola y se reintenta; sin ZIP duplicados aunque la subida llegara a hacerse", async () => {
    let now = NOW;
    const { svc, store, objects } = make({ now: () => now, uploadThenFail: 1 });
    await svc.request(owner);
    expect(await svc.processNext()).toBe("retry");
    expect(store.rows[0]).toMatchObject({ status: "pending", attempts: 1 });
    expect(objects.size).toBe(1); // subido pero sin registrar
    expect(await svc.processNext()).toBe("idle"); // espera a que caduque el latido
    now += LEASE_MS + 1;
    expect(await svc.processNext()).toBe("ready");
    expect(objects.size).toBe(1);
    expect(store.rows[0].objectId).toBe([...objects.keys()][0]);
    expect(await tempEntries()).toEqual([]);
  });

  it("si mientras se generaba dejó de estar en curso, el ZIP recién subido se retira (sin huérfanos)", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { svc, store, objects } = make({ src: () => source({ gate }) });
    await svc.request(owner);
    const running = svc.processNext();
    await new Promise((r) => setTimeout(r, 20));
    await store.markFailed(1, "cancelada", NOW);
    release();
    expect(await running).toBe("failed");
    expect(objects.size).toBe(0);
  });
});

describe("tamaño, espacio y cuotas", () => {
  it("estimación por encima del máximo: fallida sin escribir nada ni reintentar; aviso con el procedimiento", async () => {
    const { svc, store, sent } = make({ src: () => source({ estimate: 20 * MB }), maxBytes: 10 * MB });
    await svc.request(owner);
    expect(await svc.processNext()).toBe("failed");
    expect(store.rows[0]).toMatchObject({ status: "failed", attempts: 1 });
    expect(store.rows[0].error).toMatch(/tamaño máximo.*soporte/);
    expect(sent.map((s) => s.kind)).toEqual(["failed"]);
    expect(await tempEntries()).toEqual([]);
  });

  it("supera el máximo mientras se escribe (estimación corta): se aborta y se borra el temporal", async () => {
    const { svc, store } = make({ src: () => source({ rows: 200_000, estimate: 1 }), maxBytes: 1 * MB });
    await svc.request(owner);
    expect(await svc.processNext()).toBe("failed");
    expect(store.rows[0].error).toMatch(/tamaño máximo/);
    expect(await tempEntries()).toEqual([]);
  });

  it("sin espacio temporal suficiente: fallida con mensaje claro", async () => {
    const { svc, store } = make({ free: 1024 });
    await svc.request(owner);
    expect(await svc.processNext()).toBe("failed");
    expect(store.rows[0].error).toMatch(/espacio temporal/);
  });

  it("cuota mensual de volumen: fallida (no se reintenta)", async () => {
    const { svc, store } = make({ quota: async (m) => { if (m === "data_export.bytes") throw new QuotaExceededError(m, {} as never); } });
    await svc.request(owner);
    expect(await svc.processNext()).toBe("failed");
    expect(store.rows[0].error).toMatch(/límite de exportaciones/);
  });

  it("máximo por empresa: excepción autorizada (procedimiento de exportaciones grandes) y techo de 4096 MB", () => {
    const env = { DATA_EXPORT_MAX_MB: "1024", DATA_EXPORT_MAX_MB_OVERRIDES: "grande:3072, otra:9999" } as NodeJS.ProcessEnv;
    expect(exportMaxBytes(env, "acme")).toBe(1024 * MB);
    expect(exportMaxBytes(env, "grande")).toBe(3072 * MB);
    expect(exportMaxBytes(env, "otra")).toBe(4096 * MB);
    expect(exportMaxBytes({} as NodeJS.ProcessEnv)).toBe(1024 * MB);
  });
});

describe("concurrencia y temporales", () => {
  it("una generación a la vez por proceso: otra empresa espera su turno", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const a = make({ src: () => source({ gate }) });
    const b = make();
    await a.svc.request(owner);
    await b.svc.request(owner);
    const running = a.svc.processNext();
    await new Promise((r) => setTimeout(r, 20));
    expect(await b.svc.processNext()).toBe("busy");
    release();
    expect(await running).toBe("ready");
    expect(await b.svc.processNext()).toBe("ready");
  });

  it("temporales de un proceso caído: se retiran pasadas TEMP_MAX_AGE_MS; los recientes no", async () => {
    const old = path.join(tmp, "acme", "9-1");
    const recent = path.join(tmp, "acme", "10-1");
    await fs.mkdir(old, { recursive: true });
    await fs.mkdir(recent, { recursive: true });
    await fs.writeFile(path.join(old, "export.zip"), "x");
    const past = new Date(Date.now() - TEMP_MAX_AGE_MS - 60_000);
    await fs.utimes(old, past, past);
    const { svc } = make({ now: () => Date.now() });
    await svc.processNext();
    expect(await tempEntries()).toEqual(["acme/10-1"]);
  });
});

describe("memoria acotada con datos grandes (streaming)", () => {
  it("120 000 filas y un fichero de 64 MB en flujo: el montón no crece con el tamaño de la exportación", async () => {
    const big = 64 * MB;
    const chunk = Buffer.alloc(MB, 7);
    const { svc, store, objects } = make({
      maxBytes: 200 * MB,
      src: () =>
        source({
          rows: 120_000,
          files: async () => [{ objectId: "c".repeat(26), category: "media", contentType: "video/mp4", sizeBytes: big, originalName: "video.mp4", open: async () => Readable.from((function* () { for (let i = 0; i < big / MB; i++) yield chunk; })()) }],
        }),
    });
    await svc.request(owner);
    global.gc?.();
    const before = process.memoryUsage().heapUsed;
    let peak = before;
    const timer = setInterval(() => (peak = Math.max(peak, process.memoryUsage().heapUsed)), 5);
    expect(await svc.processNext()).toBe("ready");
    clearInterval(timer);
    const row = store.rows[0];
    expect(row.uncompressedBytes!).toBeGreaterThan(big);
    // El ZIP entero (ya en el «almacenamiento» de prueba) no cuenta: lo que importa es el pico DURANTE la generación
    expect(peak - before).toBeLessThan(48 * MB);
    expect(objects.size).toBe(1);
  }, 60_000);
});
