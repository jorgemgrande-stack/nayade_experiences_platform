/**
 * Exportación de datos de punta a punta con la aplicación real sobre MySQL (opt-in, REGISTRY_TEST_DATABASE_URL;
 * dos empresas nuevas desde la baseline y todas las migraciones, incluida 0012):
 * solicitud por tRPC (solo la persona propietaria) → trabajo en segundo plano → lista → enlace firmado →
 * descarga en streaming de un ZIP válido con los datos de SU empresa; el enlace no vale en el host de la otra; el
 * aviso por correo queda en la bandeja sin salir (MAIL_MODE de pruebas); límites y permisos.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import JSZip from "jszip";
import { startEssentialApp, data, errCode, type EssentialApp } from "./essentialApp.testkit";
import { runTenantJob } from "./_core/tenantRegistry/scheduler";
import { exportService } from "./dataExport/runtime";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;

describe.skipIf(!URL_)("exportación de datos de punta a punta (aplicación real, dos empresas)", { timeout: 60_000 }, () => {
  let ess: EssentialApp;
  let admA: string;
  let agA: string;
  let admB: string;
  beforeAll(async () => {
    ess = await startEssentialApp(URL_!, "exp");
    admA = await ess.login("a", "admin");
    agA = await ess.login("a", "agente");
    admB = await ess.login("b", "admin");
    const me = data(await ess.q("a", "auth.me", undefined, admA));
    await ess.sql("a", "INSERT INTO system_settings (`key`, value, category, label) VALUES ('company_owner_email', ?, 'general', 'Propietaria') ON DUPLICATE KEY UPDATE value = VALUES(value)", [me.email]);
  }, 300_000);
  afterAll(async () => {
    await ess?.close();
  });

  // Un «tic» del trabajo programado data-export (en producción, cada minuto, en el mismo proceso)
  const tick = () => runTenantJob("data-export", () => exportService().processNext(), { includeReadOnly: true });
  const waitReady = async () => {
    for (let i = 0; i < 100; i++) {
      await tick();
      const rows = data(await ess.q("a", "dataExport.list", undefined, admA)) as Array<{ id: number; status: string }>;
      if (rows[0] && rows[0].status !== "pending") return rows[0];
      await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error("la exportación no terminó");
  };

  it("permisos: solo la persona propietaria de cada empresa", async () => {
    expect(data(await ess.q("a", "dataExport.status", undefined, admA))).toMatchObject({ canExport: true, linkHours: 24, maxMb: 1024 });
    expect(data(await ess.q("a", "dataExport.status", undefined, agA)).canExport).toBe(false);
    expect(errCode(await ess.m("a", "dataExport.request", undefined, agA))).toBe("FORBIDDEN");
    expect(errCode(await ess.m("a", "dataExport.request"))).toBe("UNAUTHORIZED");
  });

  it("solicitud → trabajo en segundo plano → lista con métricas → enlace → descarga de un ZIP válido de su empresa", async () => {
    const r = await ess.m("a", "dataExport.request", undefined, admA);
    expect(r.status).toBe(200);
    expect(data(r)).toMatchObject({ status: "pending" });
    expect(errCode(await ess.m("a", "dataExport.request", undefined, admA))).toBe("CONFLICT");
    const row = (await waitReady()) as Record<string, unknown> & { id: number };
    expect(row).toMatchObject({ status: "ready", attempts: 1, warning: null });
    expect(Number(row.uncompressedBytes)).toBeGreaterThan(0);
    expect(Number(row.tableCount)).toBeGreaterThan(10);

    const link = data(await ess.m("a", "dataExport.link", { id: row.id }, admA)) as { url: string };
    const u = new URL(link.url);
    const dl = await ess.call("a", "GET", `${u.pathname}${u.search}`, { headers: { accept: "application/zip" } });
    expect(dl.status).toBe(200);
    // El enlace de A en el host de B: no vale (la firma incluye la empresa y el fichero no existe allí)
    expect([403, 404]).toContain((await ess.call("b", "GET", `${u.pathname}${u.search}`)).status);
    expect(errCode(await ess.m("a", "dataExport.link", { id: row.id }, agA))).toBe("FORBIDDEN");

    const [db] = await ess.sql("a", "SELECT object_id, download_count FROM data_exports WHERE id = ?", [row.id]);
    expect(Number(db.download_count)).toBe(1);
    const [obj] = await ess.sql("a", "SELECT category, owner_type, owner_id, status FROM stored_objects WHERE object_id = ?", [db.object_id]);
    expect(obj).toMatchObject({ category: "data-export", owner_type: "data-export", owner_id: `export:${row.id}`, status: "active" });
  });

  it("el ZIP descargado contiene los datos de la empresa (y solo los suyos), sin secretos; B tiene las suyas aparte", async () => {
    expect(errCode(await ess.m("b", "dataExport.link", { id: 1 }, admB))).toBe("NOT_FOUND");
    const [db] = await ess.sql("a", "SELECT id FROM data_exports ORDER BY id DESC LIMIT 1");
    const link = data(await ess.m("a", "dataExport.link", { id: Number(db.id) }, admA)) as { url: string };
    const u = new URL(link.url);
    const res = await new Promise<{ status: number; body: Buffer }>((resolve, reject) =>
      http.get({ host: "127.0.0.1", port: ess.port, path: `${u.pathname}${u.search}`, headers: { host: ess.host("a") } }, (r) => {
        const parts: Buffer[] = [];
        r.on("data", (c: Buffer) => parts.push(c));
        r.on("end", () => resolve({ status: r.statusCode ?? 0, body: Buffer.concat(parts) }));
      }).on("error", reject),
    );
    expect(res.status).toBe(200);
    const zip = await JSZip.loadAsync(res.body);
    const manifest = JSON.parse(await zip.file("manifest.json")!.async("string"));
    expect(manifest).toMatchObject({ tenantId: ess.ids.a, complete: true });
    expect(zip.file("data/users.csv")).not.toBeNull();
    const users = await zip.file("data/users.csv")!.async("string");
    expect(users.split("\r\n")[0]).not.toMatch(/password/i);
    expect(JSON.stringify(manifest)).not.toContain(ess.ids.b);
  });

  it("aviso «Exportación disponible» generado en la bandeja de la empresa (sin envío real) y límite diario", async () => {
    const out = await ess.sql("a", "SELECT category, idempotency_key, status FROM mail_outbox WHERE category = 'data_export'");
    expect(out.map((x: any) => x.idempotency_key)).toEqual(expect.arrayContaining([expect.stringMatching(/^data-export:\d+:ready$/)]));
    // Límite diario (3 por defecto): ya hay 1; dos más y la cuarta se rechaza
    for (let i = 0; i < 2; i++) {
      expect((await ess.m("a", "dataExport.request", undefined, admA)).status).toBe(200);
      await waitReady();
    }
    expect(errCode(await ess.m("a", "dataExport.request", undefined, admA))).toBe("TOO_MANY_REQUESTS");
  });

  it("recuperación tras un reinicio: una generación cortada (arriendo caducado) se retoma y termina", async () => {
    const old = Date.now() - 3600_000;
    await ess.sql("a", "INSERT INTO data_exports (requested_by, status, requested_at, attempts, started_at, heartbeat_at) VALUES (1, 'pending', ?, 1, ?, ?)", [old, old, old]);
    const [row] = await ess.sql("a", "SELECT id FROM data_exports WHERE status = 'pending'");
    // Varias pasadas como en el resto del fichero: una sola podía coincidir con el cerrojo de la tarea y dejarla
    // pendiente (prueba inestable). Lo que se comprueba no cambia: se retoma una vez y termina.
    let after: { status: string; attempts: number } | undefined;
    for (let i = 0; i < 20; i++) {
      await tick();
      [after] = await ess.sql("a", "SELECT status, attempts FROM data_exports WHERE id = ?", [row.id]);
      if (after?.status !== "pending") break;
      await new Promise((r) => setTimeout(r, 200));
    }
    expect(after).toMatchObject({ status: "ready", attempts: 2 });
  });

  it("retirada a los 7 días: el ZIP (copia) se borra del almacenamiento; la fila y los ficheros originales se conservan", async () => {
    const [before] = await ess.sql("a", "SELECT COUNT(*) AS n FROM stored_objects WHERE category <> 'data-export' AND status = 'active'");
    const [r] = await ess.sql("a", "SELECT id, object_id FROM data_exports WHERE status = 'ready' ORDER BY id LIMIT 1");
    const eightDaysAgo = Date.now() - 8 * 24 * 3600_000;
    await ess.sql("a", "UPDATE data_exports SET completed_at = ?, expires_at = ? WHERE id = ?", [eightDaysAgo, eightDaysAgo + 24 * 3600_000, r.id]);
    const { _resetExportProcessForTests } = await import("./dataExport/service");
    _resetExportProcessForTests();
    await tick();
    const [row] = await ess.sql("a", "SELECT status, purged_at FROM data_exports WHERE id = ?", [r.id]);
    expect(row.status).toBe("ready");
    expect(Number(row.purged_at)).toBeGreaterThan(0);
    const [obj] = await ess.sql("a", "SELECT status FROM stored_objects WHERE object_id = ?", [r.object_id]);
    expect(obj.status).toBe("deleted");
    const [after] = await ess.sql("a", "SELECT COUNT(*) AS n FROM stored_objects WHERE category <> 'data-export' AND status = 'active'");
    expect(Number(after.n)).toBe(Number(before.n));
    expect(errCode(await ess.m("a", "dataExport.link", { id: Number(r.id) }, admA))).toBe("PRECONDITION_FAILED");
    // La otra empresa no se ve afectada
    expect((data(await ess.q("b", "dataExport.list", undefined, admB)) as unknown[]).every((x: any) => x.purgedAt === null)).toBe(true);
  });
});
