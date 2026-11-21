/**
 * Purga definitiva de las empresas técnicas (20/11/2026: ids 8, 11, 12 y 13) contra MySQL real (opt-in, REGISTRY_TEST_DATABASE_URL; bases aisladas
 * con todas las migraciones del CRM y del registro): borra solo lo de la lista cerrada, de hijos a padres; una empresa
 * real y Nextair intactas; las copias de seguridad se conservan; una factura o un dato live de una empresa de prueba
 * bloquea todo. Fuera del CRM y del registro: bases restauradas sobrantes, medición (es_erm) y ficheros del bucket.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import mysql from "mysql2/promise";
import { loadMigrations, splitStatements } from "../scripts/db/migrationLib";
import { ACCEPTANCE_EXEMPT_COMPANY_IDS, PURGE_COMPANIES_WITHOUT_TENANT, PURGE_TARGETS, PURGE_TEST_LEADS, applyPurge, planHashOf, planPurge, verifyPurge } from "./_core/ops/purgeTestCompanies";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
const T = Date.UTC(2026, 9, 28, 9);

async function freshDb(admin: mysql.Pool, name: string) {
  await admin.query(`DROP DATABASE IF EXISTS ${name}`);
  await admin.query(`CREATE DATABASE ${name} CHARACTER SET utf8mb4`);
  const u = new URL(URL_!);
  u.pathname = `/${name}`;
  return mysql.createPool({ uri: u.toString(), connectionLimit: 4, multipleStatements: false });
}
async function runSql(pool: mysql.Pool, file: string) {
  const ddl = fs.readFileSync(file, "utf8").replace(/^--.*$/gm, "");
  for (const s of ddl.split(/;\s*(?:\r?\n|$)/).map((x) => x.trim()).filter(Boolean)) await pool.query(s);
}
/** Inserta una fila rellenando las columnas obligatorias que no se indican (solo para sembrar la prueba). */
async function seed(pool: mysql.Pool, table: string, values: Record<string, unknown>) {
  const [cols] = await pool.query<mysql.RowDataPacket[]>(`SHOW COLUMNS FROM \`${table}\``);
  const row: Record<string, unknown> = { ...values };
  for (const c of cols) {
    const name = String(c.Field);
    if (name in row || c.Null === "YES" || c.Default !== null || /auto_increment|GENERATED/i.test(String(c.Extra))) continue;
    const ct = String(c.Type);
    row[name] = /^enum/.test(ct) ? /'([^']*)'/.exec(ct)![1] : /int|decimal|double|float/.test(ct) ? 1 : /json/.test(ct) ? "{}" : /timestamp|datetime/.test(ct) ? new Date(T) : /^date/.test(ct) ? "2026-10-28" : /char|text/.test(ct) ? `${name}-${Math.random().toString(36).slice(2, 8)}`.slice(0, Number(/\((\d+)\)/.exec(ct)?.[1] ?? 60)) : 1;
  }
  const keys = Object.keys(row);
  const [r] = await pool.query<mysql.ResultSetHeader>(`INSERT INTO \`${table}\` (${keys.map((k) => `\`${k}\``).join(",")}) VALUES (${keys.map(() => "?").join(",")})`, keys.map((k) => row[k]));
  return r.insertId;
}

describe.skipIf(!URL_)("purga de las empresas de prueba (MySQL real)", () => {
  let admin: mysql.Pool;
  let crm: mysql.Pool;
  let reg: mysql.Pool;
  const realIds: number[] = [];
  const contractOf: Record<number, number> = {};
  const LEFTOVERS = ["es_elephant_demo_r20261020101010", "es_t9_empresa_real_r20261020101010"];
  // Bucket de medios simulado: ficheros de Elephant Demo y de la empresa real
  const bucket = new Set(["t/elephant-demo/logo.png", "t/elephant-demo/docs/a.pdf", "t/t9-empresa-real/logo.png"]);
  const media = { describe: () => "memoria", list: async (p: string) => Array.from(bucket).filter((k) => k.startsWith(p)).map((key) => ({ key, bytes: 10 })) };
  const resources = () => ({ servers: [{ alias: "mysql-1", admin }], media });

  beforeAll(async () => {
    admin = mysql.createPool({ uri: URL_!, connectionLimit: 2 });
    crm = await freshDb(admin, "purge_test_crm");
    reg = await freshDb(admin, "purge_test_registry");
    await runSql(crm, path.resolve(__dirname, "../db/crm/0000_crm.sql"));
    for (const m of loadMigrations(path.resolve(__dirname, "../db/crm/migrations")).migrations) for (const s of splitStatements(m.up)) await crm.query(s);
    for (const f of fs.readdirSync(path.resolve(__dirname, "../db/registry")).filter((x) => /^\d{4}_.*\.sql$/.test(x) && !x.endsWith(".down.sql")).sort()) await runSql(reg, path.resolve(__dirname, "../db/registry", f));
    await crm.query("SET FOREIGN_KEY_CHECKS = 0");
    await reg.query("SET FOREIGN_KEY_CHECKS = 0");
    const company = async (id: number, name: string, tenantId: string | null) => seed(crm, "crm_companies", { id, name, tenant_id: tenantId, created_at: T });
    const withTenantIds: Record<string, number> = { "elephant-demo": 11, "prueba-condiciones-129": 12 };
    const all = [
      ...PURGE_COMPANIES_WITHOUT_TENANT.map((t) => ({ id: t.companyId, name: t.companyName, tenantId: null as string | null, test: true })),
      ...PURGE_TARGETS.map((t) => ({ id: withTenantIds[t.tenantId], name: t.companyName, tenantId: t.tenantId as string | null, test: true })),
      { id: 30, name: "Empresa Real", tenantId: "t9-empresa-real" as string | null, test: false },
      { id: 31, name: "Nextair", tenantId: null as string | null, test: false },
      // Una empresa real con el nombre «parecido» a una técnica: nunca se toca
      { id: 32, name: "PRUEBA TÉCNICA Otra", tenantId: null as string | null, test: false },
    ];
    for (const c of all) {
      const id = await company(c.id, c.name, c.tenantId);
      if (!c.test) realIds.push(id);
      await seed(crm, "crm_contacts", { company_id: id, first_name: "Persona" });
      const contract = await seed(crm, "crm_contracts", { company_id: id, tenant_id: c.tenantId, reference: `CT-T-${id}` });
      contractOf[id] = contract;
      // Aceptación contractual de la empresa 12 (exenta) y de una empresa real (no entra en el plan)
      if (id === 12 || id === 30) {
        await seed(crm, "crm_contract_acceptances", { contract_id: contract, contract_version: 2, status: "accepted", accepted_at: T, token_sha256: `${"a".repeat(63)}${id % 10}`, document_sha256: "d".repeat(64), consent_text: "Acepto", expires_at: T + 1000, created_by: "operator:test", created_at: T });
      }
      await seed(crm, "subscriptions", { company_id: id, tenant_id: c.tenantId, contract_id: contract });
      // Pedido con pago y evento del proveedor (el evento solo enlaza con el pago, no con la empresa)
      const order = await seed(crm, "commercial_orders", { company_id: id });
      const payment = await seed(crm, "commercial_payments", { order_id: order });
      await seed(crm, "commercial_payment_events", { provider_event_id: `evt_${id}`, payment_id: payment });
      if (c.tenantId) {
        await seed(reg, "tenants", { id: c.tenantId });
        await seed(reg, "tenant_domains", { tenant_id: c.tenantId, domain: `${c.tenantId}.example.test` });
        // Auditoría inmutable (trigger de solo anexado, como en production)
        await seed(reg, "tenant_events", { tenant_id: c.tenantId, actor_type: "system", actor_id: "alta", action: "created" });
        await seed(reg, "backup_inventory", { target_kind: "tenant", target_id: c.tenantId });
      }
    }
    // Leads: los técnicos de la lista cerrada (solo enlazados por converted_company_id o sin empresa), uno de una empresa técnica por
    // company_id, y los reales (uno convertido en una empresa real). Cada lead, con su solicitud web; algunos, con oportunidad e historial.
    const lead = (id: number, name: string, email: string | null, extra: Record<string, unknown> = {}) => seed(crm, "crm_leads", { id, name, email, status: "converted", created_at: T, ...extra });
    await seed(crm, "crm_opportunities", { id: 101, company_id: 12, title: "Oportunidad técnica", created_at: T, updated_at: T });
    await seed(crm, "crm_opportunities", { id: 102, company_id: 30, title: "Oportunidad real", created_at: T, updated_at: T });
    await lead(1, "Prueba controlada lanzamiento", "prueba.lanzamiento@bigelephant.es", { status: "new" });
    await lead(2, "Prueba Implantación Sintética", "implantacion-202610311012@example.com", { converted_company_id: 8 });
    await lead(3, "Administrador", "jgrande@skicenter.es", { converted_company_id: 30, converted_opportunity_id: 102 });
    await lead(4, "Jorge Grande (prueba técnica)", "jorgemgrande@gmail.com", { converted_company_id: 12, converted_opportunity_id: 101 });
    await lead(5, "Jorge Grande (prueba técnica)", "jorgemgrande@gmail.com", { company_id: 12, converted_company_id: 12 });
    await lead(11, "Prueba Técnica Captación", "jgrande@bigelephant.es", { status: "new" });
    await lead(12, "PRUEBA TÉCNICA Condiciones 129", "prueba-connect@bigelephant.es", { converted_company_id: 12 });
    await lead(13, "Felipe Ramos", "real@example.org", { status: "new" });
    for (const id of [1, 2, 3, 4, 5, 11, 12, 13]) await seed(crm, "crm_lead_requests", { lead_id: id, reference: `SOL-T${id}`, idempotency_key: crypto.randomUUID(), created_at: T });
    for (const [type, id] of [["lead", 1], ["lead", 3], ["opportunity", 101], ["opportunity", 102]] as const) await seed(crm, "crm_activities", { entity_type: type, entity_id: id, kind: "note", summary: `nota ${type} ${id}`, created_at: T });
    await crm.query("SET FOREIGN_KEY_CHECKS = 1");
    await reg.query("SET FOREIGN_KEY_CHECKS = 1");
    // Servidor de bases: una restauración sobrante de Elephant Demo, otra de la empresa real y la medición de ambas
    for (const db of LEFTOVERS) await admin.query(`CREATE DATABASE IF NOT EXISTS \`${db}\``);
    await admin.query("CREATE DATABASE IF NOT EXISTS es_erm");
    await admin.query("CREATE TABLE IF NOT EXISTS es_erm.usage_hourly (tenant_id VARCHAR(63) NOT NULL, metric VARCHAR(32) NOT NULL, n INT NOT NULL)");
    await admin.query("INSERT INTO es_erm.usage_hourly VALUES ('elephant-demo','requests',3),('elephant-demo','storage',1),('t9-empresa-real','requests',7)");
  }, 120_000);

  afterAll(async () => {
    await crm?.end();
    await reg?.end();
    await admin?.query("DROP DATABASE IF EXISTS purge_test_crm");
    await admin?.query("DROP DATABASE IF EXISTS purge_test_registry");
    for (const db of LEFTOVERS) await admin?.query(`DROP DATABASE IF EXISTS \`${db}\``);
    await admin?.query("DROP DATABASE IF EXISTS es_erm");
    await admin?.end();
  });

  // prueba-condiciones-129 sirve desde una base restaurada (`_r<fecha>`), como en production
  const dbName = async (t: string) => `es_${t.replace(/-/g, "_")}${t === "prueba-condiciones-129" ? "_r20261016221031" : ""}`;

  it("una base con un nombre ajeno (ni el propio ni el de una restauración) bloquea la purga", async () => {
    const plan = await planPurge({ crm, registry: reg, tenantDbName: async (t) => (t === PURGE_TARGETS[0].tenantId ? "es_t9_empresa_real" : dbName(t)), expectedDbName: (t) => `es_${t.replace(/-/g, "_")}` });
    expect(plan.problems.join()).toMatch(/no tiene el nombre propio/);
  });

  it("una factura de una empresa de prueba bloquea la purga sin tocar nada", async () => {
    const [[c]] = await crm.query<mysql.RowDataPacket[]>("SELECT id FROM crm_companies WHERE name = ?", [PURGE_TARGETS[0].companyName]);
    await crm.query("SET FOREIGN_KEY_CHECKS = 0");
    const inv = await seed(crm, "invoices", { company_id: c.id, source_key: "charge:999" });
    await crm.query("SET FOREIGN_KEY_CHECKS = 1");
    const plan = await planPurge({ crm, registry: reg, tenantDbName: dbName, expectedDbName: (t) => `es_${t.replace(/-/g, "_")}` });
    expect(plan.problems.join()).toMatch(/invoices/);
    await expect(applyPurge({ crm, registry: reg }, plan, plan.planHash)).rejects.toThrow(/No se purga nada/);
    await crm.query("DELETE FROM invoices WHERE id = ?", [inv]);
  });

  it("la lista cerrada son exactamente las empresas 8, 11, 12 y 13; Skibox y las demás quedan fuera", async () => {
    expect(PURGE_COMPANIES_WITHOUT_TENANT.map((x) => x.companyId).sort((a, b) => a - b)).toEqual([8, 13]);
    expect(PURGE_TARGETS.map((x) => x.tenantId).sort()).toEqual(["elephant-demo", "prueba-condiciones-129"]);
    expect(ACCEPTANCE_EXEMPT_COMPANY_IDS).toEqual([12]);
    const plan = await planPurge({ crm, registry: reg, tenantDbName: dbName, expectedDbName: (t) => `es_${t.replace(/-/g, "_")}`, resources: resources() });
    expect(plan.companies.map((c) => c.id).sort((a, b) => a - b)).toEqual([8, 11, 12, 13]);
    expect(plan.companies.some((c) => realIds.includes(c.id))).toBe(false);
  });

  it("una aceptación contractual de una empresa NO exenta (la 13) bloquea toda la purga; la de la 12 consta en la evidencia", async () => {
    const plan0 = await planPurge({ crm, registry: reg, tenantDbName: dbName, expectedDbName: (t) => `es_${t.replace(/-/g, "_")}`, resources: resources() });
    expect(plan0.problems).toEqual([]);
    expect(plan0.acceptanceEvidence).toHaveLength(1);
    expect(plan0.acceptanceEvidence[0]).toMatchObject({ companyId: 12, contractId: contractOf[12], contractReference: "CT-T-12", contractVersion: 2, status: "accepted", documentSha256: "d".repeat(64), hasAcceptedIpHash: false });
    expect(plan0.acceptanceEvidence[0].consentTextSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(plan0.planHash).toMatch(/^[0-9a-f]{64}$/);
    // La huella es determinista: el mismo plan, la misma huella; y no depende de ella misma
    expect(planHashOf(plan0)).toBe(plan0.planHash);
    const plan1 = await planPurge({ crm, registry: reg, tenantDbName: dbName, expectedDbName: (t) => `es_${t.replace(/-/g, "_")}`, resources: resources() });
    expect(plan1.planHash).toBe(plan0.planHash);
    // La medición del Resource Manager crece cada hora: más filas de medición NO cambian la huella; más filas de datos, sí
    expect(planHashOf({ ...plan0, measurement: plan0.measurement.map((m) => ({ ...m, rows: m.rows + 2 })) })).toBe(plan0.planHash);
    expect(planHashOf({ ...plan0, steps: plan0.steps.map((x, i) => (i === 0 ? { ...x, rows: x.rows + 1 } : x)) })).not.toBe(plan0.planHash);
    const extra = await seed(crm, "crm_contract_acceptances", { contract_id: contractOf[13], contract_version: 1, status: "accepted", accepted_at: T, token_sha256: "b".repeat(64), document_sha256: "e".repeat(64), expires_at: T + 1000, created_by: "operator:test", created_at: T });
    const blocked = await planPurge({ crm, registry: reg, tenantDbName: dbName, expectedDbName: (t) => `es_${t.replace(/-/g, "_")}`, resources: resources() });
    expect(blocked.problems.join()).toMatch(/crm_contract_acceptances/);
    expect(blocked.planHash).not.toBe(plan0.planHash);
    await expect(applyPurge({ crm, registry: reg }, blocked, blocked.planHash)).rejects.toThrow(/No se purga nada/);
    await crm.query("DELETE FROM crm_contract_acceptances WHERE id = ?", [extra]);
  });

  it("una empresa con el nombre de una técnica pero otro id, o una técnica sin plataforma que ahora tiene tenant, aborta el plan", async () => {
    await crm.query("UPDATE crm_companies SET tenant_id = 't8-otro-tenant' WHERE id = 13");
    const a = await planPurge({ crm, registry: reg, tenantDbName: dbName, expectedDbName: (t) => `es_${t.replace(/-/g, "_")}`, resources: resources() });
    expect(a.problems.join()).toMatch(/no coincide exactamente/);
    await crm.query("UPDATE crm_companies SET tenant_id = NULL WHERE id = 13");
    await crm.query("UPDATE crm_companies SET name = 'PRUEBA TÉCNICA Ampliaciones' WHERE id = 32");
    const b = await planPurge({ crm, registry: reg, tenantDbName: dbName, expectedDbName: (t) => `es_${t.replace(/-/g, "_")}`, resources: resources() });
    expect(b.problems.join()).toMatch(/no coincide exactamente/);
    await crm.query("UPDATE crm_companies SET name = 'PRUEBA TÉCNICA Otra' WHERE id = 32");
  });

  it("HUELLA INCORRECTA: con un planHash distinto del autorizado (o sin él, o con el plan manipulado) no se borra NADA, ni una fila ni una base ni un fichero", async () => {
    const dropped: string[] = [];
    const deletedFiles: string[] = [];
    const deps = { crm, registry: reg, dropDatabase: async (t: string) => void dropped.push(t), servers: resources().servers, deleteMedia: async (k: string) => void deletedFiles.push(k) };
    const snapshot = async () => {
      const [[c]] = await crm.query<mysql.RowDataPacket[]>("SELECT (SELECT COUNT(*) FROM crm_companies) companies, (SELECT COUNT(*) FROM crm_contacts) contacts, (SELECT COUNT(*) FROM crm_contracts) contracts, (SELECT COUNT(*) FROM crm_contract_acceptances) acceptances, (SELECT COUNT(*) FROM subscriptions) subs");
      const [[r]] = await reg.query<mysql.RowDataPacket[]>("SELECT (SELECT COUNT(*) FROM tenants WHERE status <> 'deleted') live, (SELECT COUNT(*) FROM tenant_domains) domains, (SELECT COUNT(*) FROM tenant_events WHERE action = 'purged') purged");
      return JSON.stringify([c, r, Array.from(bucket).sort()]);
    };
    const plan = await planPurge({ crm, registry: reg, tenantDbName: dbName, expectedDbName: (t) => `es_${t.replace(/-/g, "_")}`, resources: resources() });
    expect(plan.problems).toEqual([]);
    const before = await snapshot();
    const wrong = "0".repeat(64);
    await expect(applyPurge(deps, plan, wrong)).rejects.toThrow(/no coincide con el autorizado/);
    await expect(applyPurge(deps, plan, null)).rejects.toThrow(/Sin huella de plan autorizada/);
    await expect(applyPurge(deps, plan, "no-es-una-huella")).rejects.toThrow(/Sin huella de plan autorizada/);
    // Plan manipulado (una fila más a borrar) con la huella autorizada original: tampoco
    const tampered = { ...plan, steps: plan.steps.map((s, i) => (i === 0 ? { ...s, rows: s.rows + 1 } : s)) };
    await expect(applyPurge(deps, tampered, plan.planHash)).rejects.toThrow(/no coincide con su propia huella/);
    // Una huella autorizada de OTRO plan (p. ej. la de una simulación anterior de production) tampoco sirve
    await expect(applyPurge(deps, plan, "9d0c1fdd82f8db98658d13cff457abaf05958e43d9904e1ecfa4eddcefaf5650", "1:test")).rejects.toThrow(/no coincide con el autorizado/);
    expect(dropped).toEqual([]);
    expect(deletedFiles).toEqual([]);
    expect(await snapshot()).toBe(before);
  });

  it("sin poder mirar el bucket de medios no se purga nada (quedarían ficheros huérfanos)", async () => {
    const plan = await planPurge({ crm, registry: reg, tenantDbName: dbName, resources: { media: { unavailable: "BACKUP_MEDIA no activado" } } });
    expect(plan.problems.join()).toMatch(/ficheros/);
    expect(plan.files.checked).toBe(false);
  });

  const tablesOf = (plan: Awaited<ReturnType<typeof planPurge>>) => plan.steps.map((s) => `${s.db}.${s.table}`);
  const planNow = () => planPurge({ crm, registry: reg, tenantDbName: dbName, expectedDbName: (t) => `es_${t.replace(/-/g, "_")}`, resources: resources() });

  it("los leads técnicos son una lista cerrada (1, 2, 4, 11, 12): entran con sus solicitudes e historial; los reales y las oportunidades reales, no", async () => {
    expect(PURGE_TEST_LEADS.map((l) => l.id)).toEqual([1, 2, 4, 11, 12]);
    const plan = await planNow();
    expect(plan.problems).toEqual([]);
    expect(plan.leads.map((l) => l.id)).toEqual([1, 2, 4, 11, 12]);
    expect(plan.missingLeads).toEqual([]);
    const rowsOf = (t: string) => plan.steps.find((x) => x.table === t)?.rows;
    expect(rowsOf("crm_leads")).toBe(6); // los 5 de la lista + el lead 5, de la empresa 12 por company_id
    expect(rowsOf("crm_lead_requests")).toBe(6);
    expect(rowsOf("crm_activities")).toBe(2); // historial del lead 1 y de la oportunidad técnica; no el del lead 3 ni el de la oportunidad real
    expect(plan.steps.find((x) => x.table === "crm_leads")!.params.flat(2)).not.toContain(3);
  });

  it("integridad referencial: un lead fuera de la lista que apunta a una empresa que se purga, o uno de la lista que apunta a una real, aborta el plan", async () => {
    const base = await planNow();
    // 1) Un lead real (13) convertido en la empresa técnica 12 → quedaría una referencia rota
    await crm.query("UPDATE crm_leads SET converted_company_id = 12 WHERE id = 13");
    const a = await planNow();
    expect(a.problems.join()).toMatch(/leads 13 no están en la lista pero apuntan/);
    expect(a.planHash).not.toBe(base.planHash);
    await expect(applyPurge({ crm, registry: reg }, a, a.planHash)).rejects.toThrow(/No se purga nada/);
    await crm.query("UPDATE crm_leads SET converted_company_id = NULL WHERE id = 13");
    // 2) Un lead real (3) con la oportunidad de una empresa técnica
    await crm.query("UPDATE crm_leads SET converted_opportunity_id = 101 WHERE id = 3");
    expect((await planNow()).problems.join()).toMatch(/leads 3 no están en la lista pero apuntan/);
    await crm.query("UPDATE crm_leads SET converted_opportunity_id = 102 WHERE id = 3");
    // 3) Un lead de la lista convertido en una empresa real → no se toca nada
    await crm.query("UPDATE crm_leads SET converted_company_id = 30 WHERE id = 1");
    expect((await planNow()).problems.join()).toMatch(/lead técnico 1 está convertido en la empresa 30, que no se purga/);
    await crm.query("UPDATE crm_leads SET converted_company_id = NULL WHERE id = 1");
    // 4) Un lead de la lista con otro nombre o correo → no se toca nada
    await crm.query("UPDATE crm_leads SET email = 'otra@persona.es' WHERE id = 11");
    expect((await planNow()).problems.join()).toMatch(/lead 11 .* no coincide exactamente/);
    await crm.query("UPDATE crm_leads SET email = 'jgrande@bigelephant.es' WHERE id = 11");
    expect((await planNow()).problems).toEqual([]);
  });

  it("verifyPurge detecta una referencia colgante sin clave ajena (lead → empresa inexistente, historial → entidad inexistente)", async () => {
    await crm.query("UPDATE crm_leads SET converted_company_id = 9999 WHERE id = 13");
    await seed(crm, "crm_activities", { entity_type: "opportunity", entity_id: 9999, kind: "note", summary: "huérfana", created_at: T });
    const v = await verifyPurge({ crm, registry: reg, resources: resources() });
    expect(v.ok).toBe(false);
    expect(v.remaining.join()).toMatch(/converted_company_id sin empresa/);
    expect(v.remaining.join()).toMatch(/crm_activities \(opportunity\) sin entidad/);
    await crm.query("UPDATE crm_leads SET converted_company_id = NULL WHERE id = 13");
    await crm.query("DELETE FROM crm_activities WHERE entity_id = 9999");
  });

  it("purga solo la lista cerrada, de hijos a padres, conserva las copias y deja la empresa real y Nextair intactas", async () => {
    const plan = await planPurge({ crm, registry: reg, tenantDbName: dbName, expectedDbName: (t) => `es_${t.replace(/-/g, "_")}`, resources: resources() });
    expect(plan.problems).toEqual([]);
    expect(plan.companies.map((c) => c.name)).toContain("Elephant Demo");
    expect(plan.extraDatabases).toEqual([{ tenantId: "elephant-demo", server: "mysql-1", database: "es_elephant_demo_r20261020101010" }]);
    expect(plan.measurement).toEqual([{ server: "mysql-1", table: "usage_hourly", rows: 2 }]);
    expect(plan.files.byTenant).toEqual([{ tenantId: "elephant-demo", objects: 2, bytes: 20, keys: ["t/elephant-demo/logo.png", "t/elephant-demo/docs/a.pdf"] }]);
    expect(plan.companies.map((c) => c.tenantId).sort()).toEqual([null, null, ...PURGE_TARGETS.map((t) => t.tenantId)].sort());
    expect(tablesOf(plan)).toContain("crm.crm_contract_acceptances");
    const tables = plan.steps.map((s) => `${s.db}.${s.table}`);
    expect(tables).toEqual(expect.arrayContaining(["crm.crm_contacts", "crm.crm_contracts", "crm.subscriptions", "crm.crm_companies", "registry.tenant_domains"]));
    expect(tables.some((t) => t.includes("backup_"))).toBe(false);
    // La auditoría no se borra y el tenant queda como lápida
    expect(tables).not.toContain("registry.tenant_events");
    expect(tables).not.toContain("registry.tenants");
    expect(plan.retire.map((x) => x.tenantId).sort()).toEqual(PURGE_TARGETS.map((t) => t.tenantId).sort());
    expect(tables.indexOf("crm.crm_companies")).toBeGreaterThan(tables.indexOf("crm.crm_contacts"));
    expect(tables).toEqual(expect.arrayContaining(["crm.commercial_payment_events", "crm.commercial_payments", "crm.commercial_orders"]));
    expect(tables.indexOf("crm.commercial_payments")).toBeGreaterThan(tables.indexOf("crm.commercial_payment_events"));
    expect(plan.databases.filter((x) => x.restored).map((x) => x.database)).toEqual(["es_prueba_condiciones_129_r20261016221031"]);
    const dropped: string[] = [];
    const restored: string[] = [];
    const done = await applyPurge(
      { crm, registry: reg, dropDatabase: async (t) => void dropped.push(t), dropRestoredDatabase: async (_t, db) => void restored.push(db), servers: resources().servers, deleteMedia: async (k) => void bucket.delete(k) },
      plan,
      plan.planHash,
      "44830001:jorgemgrande-stack",
    );
    expect(done.deletedFiles).toBe(2);
    expect(Array.from(bucket)).toEqual(["t/t9-empresa-real/logo.png"]);
    const [schemas] = await admin.query<mysql.RowDataPacket[]>("SELECT SCHEMA_NAME n FROM information_schema.SCHEMATA WHERE SCHEMA_NAME IN (?)", [LEFTOVERS]);
    expect(schemas.map((r) => r.n)).toEqual(["es_t9_empresa_real_r20261020101010"]);
    const [usage] = await admin.query<mysql.RowDataPacket[]>("SELECT tenant_id FROM es_erm.usage_hourly");
    expect(usage.map((r) => r.tenant_id)).toEqual(["t9-empresa-real"]);
    expect(dropped.sort()).toEqual(PURGE_TARGETS.map((t) => t.tenantId).sort());
    expect(restored).toEqual(["es_prueba_condiciones_129_r20261016221031"]);
    expect(done.deleted.find((d) => d.table === "commercial_payment_events")?.rows).toBe(4);
    const [[events]] = await crm.query<mysql.RowDataPacket[]>("SELECT COUNT(*) n FROM commercial_payment_events");
    expect(Number(events.n)).toBe(3);
    expect(done.deleted.find((d) => d.table === "crm_companies")?.rows).toBe(4);
    expect(done.deleted.find((d) => d.table === "crm_contract_acceptances")?.rows).toBe(1);
    expect(await verifyPurge({ crm, registry: reg, resources: resources() })).toEqual({ ok: true, remaining: [] });
    // Leads: solo quedan los reales (3 y 13), con sus solicitudes, su historial y sus oportunidades; ninguna referencia colgante
    const [leadsLeft] = await crm.query<mysql.RowDataPacket[]>("SELECT id FROM crm_leads ORDER BY id");
    expect(leadsLeft.map((r) => r.id)).toEqual([3, 13]);
    const [reqLeft] = await crm.query<mysql.RowDataPacket[]>("SELECT lead_id FROM crm_lead_requests ORDER BY lead_id");
    expect(reqLeft.map((r) => r.lead_id)).toEqual([3, 13]);
    const [actLeft] = await crm.query<mysql.RowDataPacket[]>("SELECT entity_type, entity_id FROM crm_activities WHERE entity_type IN ('lead','opportunity') ORDER BY entity_id");
    expect(actLeft.map((r) => `${r.entity_type}:${r.entity_id}`)).toEqual(["lead:3", "opportunity:102"]);
    const [oppLeft] = await crm.query<mysql.RowDataPacket[]>("SELECT id FROM crm_opportunities ORDER BY id");
    expect(oppLeft.map((r) => r.id)).toEqual([102]);
    expect(done.deleted.find((x) => x.table === "crm_leads")?.rows).toBe(6);
    expect(done.deleted.find((x) => x.table === "crm_lead_requests")?.rows).toBe(6);
    const [left] = await crm.query<mysql.RowDataPacket[]>("SELECT name FROM crm_companies ORDER BY name");
    expect(left.map((r) => r.name)).toEqual(["Empresa Real", "Nextair", "PRUEBA TÉCNICA Otra"]);
    const [[accLeft]] = await crm.query<mysql.RowDataPacket[]>("SELECT COUNT(*) n FROM crm_contract_acceptances");
    expect(Number(accLeft.n)).toBe(1);
    const [[contacts]] = await crm.query<mysql.RowDataPacket[]>("SELECT COUNT(*) n FROM crm_contacts WHERE company_id IN (?)", [realIds]);
    expect(Number(contacts.n)).toBe(3);
    const [[sk]] = await reg.query<mysql.RowDataPacket[]>("SELECT COUNT(*) n FROM tenants WHERE id = 't9-empresa-real' AND status <> 'deleted'");
    expect(Number(sk.n)).toBe(1);
    const [states] = await reg.query<mysql.RowDataPacket[]>("SELECT id, status FROM tenants WHERE id IN (?)", [PURGE_TARGETS.map((t) => t.tenantId)]);
    expect(states.every((r) => r.status === "deleted")).toBe(true);
    const [[dom]] = await reg.query<mysql.RowDataPacket[]>("SELECT COUNT(*) n FROM tenant_domains WHERE tenant_id IN (?)", [PURGE_TARGETS.map((t) => t.tenantId)]);
    expect(Number(dom.n)).toBe(0);
    const [ev] = await reg.query<mysql.RowDataPacket[]>("SELECT tenant_id, action FROM tenant_events ORDER BY id");
    expect(ev.filter((r) => r.action === "purged").map((r) => r.tenant_id).sort()).toEqual(PURGE_TARGETS.map((t) => t.tenantId).sort());
    // El manifiesto queda en la auditoría inmutable: huella del plan, empresas y evidencias de las aceptaciones
    const [purged] = await reg.query<mysql.RowDataPacket[]>("SELECT details FROM tenant_events WHERE action = 'purged' LIMIT 1");
    const details = typeof purged[0].details === "string" ? JSON.parse(purged[0].details) : purged[0].details;
    expect(details.planHash).toBe(plan.planHash);
    // Queda registrado el valor autorizado (parámetro obligatorio del workflow) y la ejecución que lo autorizó
    expect(details.expectedPlanHash).toBe(plan.planHash);
    expect(details.auditRef).toBe("44830001:jorgemgrande-stack");
    expect(details.companies.map((c: { id: number }) => c.id).sort((a: number, b: number) => a - b)).toEqual([8, 11, 12, 13]);
    expect(details.acceptances).toHaveLength(1);
    expect(ev.filter((r) => r.action === "created").length).toBe(PURGE_TARGETS.length + 1);
    const [[backups]] = await reg.query<mysql.RowDataPacket[]>("SELECT COUNT(*) n FROM backup_inventory");
    expect(Number(backups.n)).toBe(PURGE_TARGETS.length + 1);
    // Repetir es inocuo: ya no queda nada que purgar
    const again = await planPurge({ crm, registry: reg, tenantDbName: async () => null });
    expect(again.steps).toEqual([]);
    expect(again.retire).toEqual([]);
    expect(again.missing.length).toBe(PURGE_TARGETS.length);
    expect(again.missingCompanies).toEqual([8, 13]);
    expect(again.missingLeads).toEqual([1, 2, 4, 11, 12]);
  });
});
