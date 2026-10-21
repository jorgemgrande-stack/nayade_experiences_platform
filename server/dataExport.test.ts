/**
 * Exportación de datos de la empresa: contenido del ZIP (CSV, JSON, ficheros, manifiesto), sin secretos, CSV a
 * prueba de fórmulas, control de tamaño, fichero ausente, solo la persona propietaria, una en curso, enlace de
 * como mucho 24 h, registro de enlaces y descargas, y permitida en solo lectura.
 */
import { describe, it, expect, beforeEach } from "vitest";
import JSZip from "jszip";
import { buildExport, ExportTooLargeError, isExcludedTable, redact, toCsv, type ExportSource } from "./dataExport/build";
import { DataExportService, EXPORT_LINK_TTL_MS, LEASE_MS, MAX_ATTEMPTS, MemoryDataExportStore, _resetExportProcessForTests } from "./dataExport/service";
import { isSessionPath } from "./_core/tenantRegistry/tenantMiddleware";

const NOW = Date.UTC(2026, 9, 20, 9);
const source = (over: Partial<ExportSource> = {}): ExportSource => ({
  tables: async () => ["clients", "users", "system_settings", "password_reset_tokens", "integration_credentials", "mail_outbox", "cash_sessions", "__drizzle_migrations"],
  dump: async (t) =>
    ({
      clients: { name: "clients", columns: ["id", "name", "notes"], rows: [{ id: 1, name: "Ana, S.L.", notes: '=HYPERLINK("http://x")' }, { id: 2, name: 'Bea "B"', notes: null }] },
      users: { name: "users", columns: ["id", "email", "passwordHash", "role", "mfaSecret"], rows: [{ id: 1, email: "ana@ejemplo.test", passwordHash: "$2b$10$x", role: "admin", mfaSecret: "JBSW" }] },
      system_settings: { name: "system_settings", columns: ["key", "value"], rows: [{ key: "company_name", value: "Ana SL" }, { key: "stripe_api_key", value: "sk_live_x" }, { key: "smtp_password", value: "p" }] },
      cash_sessions: { name: "cash_sessions", columns: ["id", "openedAt"], rows: [{ id: 1, openedAt: new Date(NOW) }] },
    })[t] ?? { name: t, columns: [], rows: [] },
  files: async () => [
    { objectId: "a".repeat(26), category: "invoice", contentType: "application/pdf", sizeBytes: 4, originalName: "Factura 1.pdf", read: async () => Buffer.from("%PDF") },
    { objectId: "b".repeat(26), category: "media", contentType: "image/png", sizeBytes: 3, originalName: null, read: async () => { throw new Error("no está"); } },
  ],
  ...over,
});
const opts = { tenantId: "acme", requestedBy: 7, now: NOW, maxBytes: 10 * 1048576 };

describe("contenido de la exportación", () => {
  it("CSV escapado y a prueba de fórmulas; JSON equivalente", () => {
    const csv = toCsv(["id", "name", "notes"], [{ id: 1, name: "Ana, S.L.", notes: "=1+1" }, { id: 2, name: 'Bea "B"', notes: null }]);
    expect(csv.startsWith("﻿id,name,notes\r\n")).toBe(true);
    expect(csv).toContain('1,"Ana, S.L.",\'=1+1');
    expect(csv).toContain('2,"Bea ""B""",');
  });

  it("sin secretos: tablas excluidas, columnas y valores sensibles omitidos; las de negocio se incluyen", () => {
    for (const t of ["password_reset_tokens", "integration_credentials", "mail_outbox", "__drizzle_migrations", "data_exports"]) expect(isExcludedTable(t)).toBe(true);
    for (const t of ["cash_sessions", "clients", "invoices", "room_blocks"]) expect(isExcludedTable(t)).toBe(false);
    const u = redact({ name: "users", columns: ["id", "email", "passwordHash", "role", "mfaSecret"], rows: [{ id: 1, email: "a@b.c", passwordHash: "x", role: "admin", mfaSecret: "y" }] });
    expect(u.columns).toEqual(["id", "email", "role"]);
    expect(u.omittedColumns).toEqual(["passwordHash", "mfaSecret"]);
    const s = redact({ name: "system_settings", columns: ["key", "value"], rows: [{ key: "company_name", value: "Ana" }, { key: "stripe_api_key", value: "sk" }] });
    expect(s.rows).toEqual([{ key: "company_name", value: "Ana" }, { key: "stripe_api_key", value: "[omitido: dato sensible]" }]);
    expect(s.omittedValues).toBe(1);
  });

  it("ZIP con datos, ficheros, manifiesto y LÉEME; un fichero ausente no impide exportar el resto", async () => {
    const r = await buildExport(source(), opts);
    const zip = await JSZip.loadAsync(r.zip);
    const names = Object.keys(zip.files).sort();
    expect(names).toEqual(expect.arrayContaining(["manifest.json", "LEEME.txt", "data/clients.csv", "data/clients.json", "data/users.csv", "data/cash_sessions.json", `files/invoice/${"a".repeat(26)}-Factura_1.pdf`]));
    expect(names.some((n) => /password_reset|integration_credentials|mail_outbox|drizzle/.test(n))).toBe(false);
    const all = (await Promise.all(names.filter((n) => !zip.files[n].dir).map((n) => zip.files[n].async("string")))).join("\n");
    for (const secret of ["$2b$10$x", "JBSW", "sk_live_x"]) expect(all).not.toContain(secret);
    const manifest = JSON.parse(await zip.file("manifest.json")!.async("string"));
    expect(manifest).toMatchObject({ format: "elephant-source-export", formatVersion: 1, tenantId: "acme", requestedBy: 7, skippedTables: ["__drizzle_migrations", "integration_credentials", "mail_outbox", "password_reset_tokens"] });
    expect(manifest.files).toEqual([expect.objectContaining({ category: "invoice", sizeBytes: 4 }), expect.objectContaining({ category: "media", missing: true, path: null })]);
    expect(JSON.parse(await zip.file("data/cash_sessions.json")!.async("string"))).toEqual([{ id: 1, openedAt: new Date(NOW).toISOString() }]);
    expect(r).toMatchObject({ tableCount: 4, rowCount: 7, fileCount: 1 });
  });

  it("tamaño máximo: no se genera nada", async () => {
    await expect(buildExport(source(), { ...opts, maxBytes: 200 })).rejects.toBeInstanceOf(ExportTooLargeError);
    const big = source({ files: async () => [{ objectId: "c".repeat(26), category: "media", contentType: "image/png", sizeBytes: 50 * 1048576, originalName: null, read: async () => Buffer.alloc(1) }] });
    await expect(buildExport(big, opts)).rejects.toThrow(/tamaño máximo/);
  });
});

describe("servicio de exportación", () => {
  beforeEach(() => _resetExportProcessForTests());
  const make = (over: { now?: () => number; src?: ExportSource } = {}) => {
    const store = new MemoryDataExportStore();
    const saved: string[] = [];
    const svc = new DataExportService({
      store,
      openSource: async () => over.src ?? source(),
      saveZip: async (z) => {
        saved.push(z.name);
        return "f".repeat(26);
      },
      signedLink: (id, ttl) => `https://acme.example/api/files/${id}?ttl=${ttl}`,
      tenantId: "acme",
      maxBytes: 10 * 1048576,
      now: over.now ?? (() => NOW),
    });
    return { store, svc, saved };
  };

  it("solo la persona propietaria; una en curso a la vez; queda lista con sus recuentos", async () => {
    const { svc, store, saved } = make();
    await expect(svc.request({ id: 8, isOwner: false })).rejects.toMatchObject({ code: "forbidden" });
    await expect(svc.list({ isOwner: false })).rejects.toMatchObject({ code: "forbidden" });
    const e = await svc.request({ id: 7, isOwner: true });
    expect(e.status).toBe("pending");
    await expect(svc.request({ id: 7, isOwner: true })).rejects.toMatchObject({ code: "conflict" });
    await svc.processNext();
    expect(store.rows[0]).toMatchObject({ status: "ready", objectId: "f".repeat(26), tableCount: 4, fileCount: 1, expiresAt: NOW + EXPORT_LINK_TTL_MS });
    expect(saved).toEqual(["exportacion-acme-2026-10-20.zip"]);
    // Terminada, se puede pedir otra (ninguna se borra)
    await svc.request({ id: 7, isOwner: true });
    await svc.processNext();
    expect((await svc.list({ isOwner: true })).map((x) => x.status)).toEqual(["ready", "ready"]);
  });

  it("enlace solo de una lista y nunca más allá de 24 h; cada enlace y descarga queda registrado", async () => {
    let now = NOW;
    const { svc, store } = make({ now: () => now });
    const e = await svc.request({ id: 7, isOwner: true });
    await expect(svc.link({ isOwner: true }, e.id)).rejects.toMatchObject({ code: "invalid_state" });
    await svc.processNext();
    await expect(svc.link({ isOwner: false }, e.id)).rejects.toMatchObject({ code: "forbidden" });
    now = NOW + 20 * 3600_000;
    const l = await svc.link({ isOwner: true }, e.id);
    expect(l.url).toContain(`ttl=${4 * 3600}`);
    expect(store.rows[0].linkCount).toBe(1);
    expect(await store.downloaded("f".repeat(26), now)).toBe(true);
    expect(await store.downloaded("otro", now)).toBe(false);
    expect(store.rows[0].downloadCount).toBe(1);
    now = NOW + EXPORT_LINK_TTL_MS + 1;
    await expect(svc.link({ isOwner: true }, e.id)).rejects.toThrow(/caducó/);
    await expect(svc.link({ isOwner: true }, 99)).rejects.toMatchObject({ code: "not_found" });
  });

  it("un fallo persistente se reintenta y, agotados los intentos, queda registrado con un mensaje claro (sin detalles internos)", async () => {
    let now = NOW;
    const { svc, store } = make({ now: () => now, src: source({ tables: async () => { throw new Error("ECONNRESET 10.0.0.9"); } }) });
    await svc.request({ id: 7, isOwner: true });
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      await svc.processNext();
      now += LEASE_MS + 1;
    }
    expect(store.rows[0]).toMatchObject({ status: "failed", attempts: MAX_ATTEMPTS });
    expect(store.rows[0].error).not.toMatch(/10.0.0.9|ECONNRESET/);
  });

  it("solo lectura: pedir la exportación y su enlace no se bloquean; el resto de escrituras sí", () => {
    expect(isSessionPath("/api/trpc/dataExport.request")).toBe(true);
    expect(isSessionPath("/api/trpc/dataExport.link")).toBe(true);
    expect(isSessionPath("/api/trpc/dataExport.request,clients.create")).toBe(false);
    expect(isSessionPath("/api/trpc/clients.create")).toBe(false);
  });
});
