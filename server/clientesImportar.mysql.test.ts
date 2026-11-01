/**
 * Importar y exportar clientes en CSV con la aplicación real sobre MySQL (opt-in, REGISTRY_TEST_DATABASE_URL):
 * vista previa sin escribir, confirmación con la misma huella, filas desmarcadas, relleno sin sobrescribir, rol de
 * equipo, licencia «Clientes y contactos», límite de contactos del plan y aislamiento entre empresas.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import mysql from "mysql2/promise";
import { startEssentialApp, data, errCode, type EssentialApp } from "./essentialApp.testkit";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;

describe.skipIf(!URL_)("CRM — importar clientes desde CSV (aplicación real, dos empresas)", () => {
  let ess: EssentialApp;
  let agA: string;
  let admA: string;
  let agB: string;

  const count = async (co: "a" | "b") => Number((await ess.sql(co, "SELECT COUNT(*) AS n FROM clients"))[0].n);
  const CSV = [
    "Nombre;Correo electrónico;Teléfono;Ciudad;Notas",
    'Lucía Pérez;lucia@cliente.example;600111000;Madrid;"Prefiere; tardes"',
    "Marta Ruiz;marta@cliente.example;;Sevilla;",
    "Sin Correo;;;;",
    "Luis Gil;luis@cliente.example;;;",
  ].join("\r\n");

  beforeAll(async () => {
    ess = await startEssentialApp(URL_!, "climport");
    agA = await ess.login("a", "agente");
    admA = await ess.login("a", "admin");
    agB = await ess.login("b", "agente");
    await ess.sql("a", "INSERT INTO clients (source, name, email, phone, company, city, tags) VALUES ('manual', 'Marta Ruiz', 'marta@cliente.example', '', 'Ruiz SL', '', '[]')");
  }, 300_000);
  afterAll(async () => {
    await ess?.close();
  });

  it("vista previa: no escribe nada y explica cada fila", async () => {
    const before = await count("a");
    const r = await ess.m("a", "crm.clients.importPreview", { csv: CSV }, agA);
    expect(r.status).toBe(200);
    const plan = data(r);
    expect(plan.totals).toEqual({ create: 2, update: 1, unchanged: 0, review: 0, error: 1 });
    expect(plan.rows.find((x: any) => x.line === 2).values.notes).toBe("Prefiere; tardes");
    expect(plan.rows.find((x: any) => x.line === 3)).toMatchObject({ action: "update", fill: { city: "Sevilla" } });
    expect(await count("a")).toBe(before);
  });

  it("confirmar: altas y relleno de vacíos, sin la fila desmarcada; la huella caducada se rechaza", async () => {
    const plan = data(await ess.m("a", "crm.clients.importPreview", { csv: CSV }, agA));
    // Huella de otra vista previa (los clientes cambiaron): rechazada sin escribir
    expect(errCode(await ess.m("a", "crm.clients.importApply", { csv: CSV, fingerprint: "0".repeat(32) }, agA))).toBe("CONFLICT");
    const res = await ess.m("a", "crm.clients.importApply", { csv: CSV, fingerprint: plan.fingerprint, excludeLines: [5] }, agA);
    expect(res.status).toBe(200);
    expect(data(res)).toMatchObject({ created: 1, updated: 1 });
    const rows = await ess.sql("a", "SELECT name, email, phone, city, company, source FROM clients ORDER BY id");
    expect(rows.map((x: any) => x.email)).toEqual(["marta@cliente.example", "lucia@cliente.example"]);
    expect(rows[0]).toMatchObject({ city: "Sevilla", company: "Ruiz SL" }); // rellena lo vacío, conserva lo demás
    expect(rows[1]).toMatchObject({ name: "Lucía Pérez", phone: "600111000", source: "import" });
    // Reimportar el mismo fichero: nada que hacer con lo ya importado
    const again = data(await ess.m("a", "crm.clients.importPreview", { csv: CSV }, agA));
    expect(again.totals).toMatchObject({ create: 1, unchanged: 2 });
  });

  it("exportar: CSV con todos los clientes de la empresa; B solo los suyos", async () => {
    const e = data(await ess.q("a", "crm.clients.exportCsv", undefined, agA));
    expect(e.count).toBe(2);
    expect(e.csv.split("\r\n")[0]).toBe("﻿nombre;email;telefono;empresa;nif;direccion;ciudad;codigo_postal;pais;notas");
    expect(e.csv).toContain("lucia@cliente.example");
    const eb = data(await ess.q("b", "crm.clients.exportCsv", undefined, agB));
    expect(eb.count).toBe(0);
    expect(eb.csv).not.toContain("cliente.example");
  });

  it("aislamiento: lo que importa B queda en B y no ve los clientes de A", async () => {
    const plan = data(await ess.m("b", "crm.clients.importPreview", { csv: CSV }, agB));
    expect(plan.totals).toMatchObject({ create: 3, update: 0 }); // Marta no existe en B
    expect((await ess.m("b", "crm.clients.importApply", { csv: CSV, fingerprint: plan.fingerprint }, agB)).status).toBe(200);
    expect(await count("b")).toBe(3);
    expect(await count("a")).toBe(2);
  });

  it("rol, tamaño y licencia: solo el equipo; fichero excesivo rechazado; sin «Clientes y contactos» no se importa", async () => {
    for (const role of ["user", "controler"] as const) {
      const c = await ess.login("a", role);
      expect(errCode(await ess.m("a", "crm.clients.importPreview", { csv: CSV }, c))).toBe("FORBIDDEN");
    }
    const big = "nombre;email\n" + "x".repeat(2 * 1024 * 1024);
    expect(errCode(await ess.m("a", "crm.clients.importPreview", { csv: big }, agA))).toBe("BAD_REQUEST");
    expect(errCode(await ess.m("a", "crm.clients.importPreview", { csv: "foo;bar\n1;2" }, agA))).toBe("BAD_REQUEST");
    await ess.setCapability("a", "crm-contacts", null);
    expect((await ess.m("a", "crm.clients.importPreview", { csv: CSV }, admA)).status).toBe(403);
    await ess.setCapability("a", "crm-contacts", "active");
  });

  it("límite de contactos del plan: una importación que lo superaría no da de alta a nadie", async () => {
    const reg = await mysql.createConnection({ uri: process.env.REGISTRY_DATABASE_URL! });
    const now = Date.now();
    const used = await count("a");
    await reg.query(
      "INSERT INTO tenant_quota_exceptions (tenant_id, metric, period, new_limit, reason, operator, starts_at, expires_at, status, created_at, updated_at) VALUES (?, 'contacts', 'total', ?, 'prueba', 'operator:prueba', ?, ?, 'active', ?, ?)",
      [ess.ids.a, used + 1, now - 1000, now + 86_400_000, now, now],
    );
    // Sin esperar a que caduque la caché de excepciones del registro (30 s)
    const { configureQuotaExceptions } = await import("./_core/erm/exceptionAccess");
    const { MysqlQuotaExceptionReader } = await import("./_core/erm/mysqlQuotas");
    const regPool = mysql.createPool({ uri: process.env.REGISTRY_DATABASE_URL!, connectionLimit: 2 });
    configureQuotaExceptions(new MysqlQuotaExceptionReader(regPool), { ttlMs: 0 });
    await reg.end();
    const csv = "nombre;email\nUno;uno@cliente.example\nDos;dos@cliente.example\n";
    const plan = data(await ess.m("a", "crm.clients.importPreview", { csv }, agA));
    const r = await ess.m("a", "crm.clients.importApply", { csv, fingerprint: plan.fingerprint }, agA);
    expect(errCode(r)).toBe("FORBIDDEN");
    expect(r.json.error.json.message).toMatch(/límite de contactos/);
    expect(await count("a")).toBe(used);
    // Cabe uno: desmarcando la segunda fila se importa
    expect((await ess.m("a", "crm.clients.importApply", { csv, fingerprint: plan.fingerprint, excludeLines: [3] }, agA)).status).toBe(200);
    expect(await count("a")).toBe(used + 1);
    configureQuotaExceptions(null);
    await regPool.end();
  });
});
