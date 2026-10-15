/**
 * CRM con MySQL real (opt-in): esquema, mapeo de columnas (JSON, BIGINT) y flujo completo.
 */
import crypto from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";
import { MysqlCrmStore } from "./crm/mysqlStore";
import { CrmService } from "./crm/service";
import { WebRequestService } from "./crm/webRequests";
import { DuplicateKeyError } from "./crm/store";
import { loadMigrations, splitStatements } from "../scripts/db/migrationLib";

const CRM_MIGRATIONS = path.resolve(__dirname, "../db/crm/migrations");
/** Aplica (o revierte) las migraciones del CRM como lo haría scripts/db/migrate.ts. */
async function runCrmMigrations(pool: mysql.Pool, direction: "up" | "down") {
  const { migrations, errors } = loadMigrations(CRM_MIGRATIONS);
  if (errors.length) throw new Error(errors.join("; "));
  const list = direction === "up" ? migrations : [...migrations].reverse();
  for (const m of list) for (const s of splitStatements(direction === "up" ? m.up : m.down!)) await pool.query(s);
}

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;

describe.skipIf(!URL_)("CRM con MySQL real", () => {
  let admin: mysql.Pool;
  let pool: mysql.Pool;
  let crm: CrmService;

  beforeAll(async () => {
    admin = mysql.createPool({ uri: URL_!, connectionLimit: 2 });
    await admin.query("DROP DATABASE IF EXISTS crm_test");
    await admin.query("CREATE DATABASE crm_test CHARACTER SET utf8mb4");
    const u = new URL(URL_!);
    u.pathname = "/crm_test";
    pool = mysql.createPool({ uri: u.toString(), connectionLimit: 4 });
    const ddl = fs.readFileSync(path.resolve(__dirname, "../db/crm/0000_crm.sql"), "utf8").replace(/^--.*$/gm, "");
    for (const s of ddl.split(/;\s*(?:\r?\n|$)/).map((x) => x.trim()).filter(Boolean)) await pool.query(s);
    await runCrmMigrations(pool, "up");
    crm = new CrmService({
      store: new MysqlCrmStore(pool),
      activation: { activate: async ({ company }) => ({ tenantId: "t-" + company.id }) },
    });
  });
  afterAll(async () => {
    await pool?.end();
    await admin?.query("DROP DATABASE IF EXISTS crm_test");
    await admin?.end();
  });

  it("flujo lead → empresa → oportunidad → contrato activo", async () => {
    const lead = await crm.createLead({ name: "Ana Ñ", email: "ana@mysql.example", companyName: "Empresa Ñ" }, "t");
    const r = await crm.convertLead(lead.id, { opportunity: { title: "Alta", amountCents: 250000 } }, "t");
    expect(r.opportunity!.amountCents).toBe(250000);
    await crm.moveStage(r.opportunity!.id, "proposal", "t");
    const c = await crm.createContract({ companyId: r.company.id, planId: "base", modules: ["hotel", "spa"] }, "t");
    expect(c.modules).toEqual(["hotel", "spa"]);
    await crm.setContractStatus(c.id, "sent", "t");
    await crm.setContractStatus(c.id, "signed", "t");
    const act = await crm.setContractStatus(c.id, "active", "t");
    expect(act).toMatchObject({ status: "active", tenantId: `t-${r.company.id}` });
    const d = await crm.dashboard();
    expect(d.activeContracts).toBe(1);
    const tl = await crm.timeline("contract", c.id);
    expect(tl.length).toBeGreaterThanOrEqual(3);
  });

  it("restricciones: un tenant solo puede pertenecer a una empresa", async () => {
    const [rows] = await pool.query<mysql.RowDataPacket[]>("SELECT id, tenant_id FROM crm_companies WHERE tenant_id IS NOT NULL LIMIT 1");
    await expect(
      pool.query("INSERT INTO crm_companies (name, tenant_id, created_at) VALUES ('Duplicada', ?, 1)", [rows[0].tenant_id]),
    ).rejects.toMatchObject({ code: "ER_DUP_ENTRY" });
  });

  it("v2: ficha, contacto principal (único también en BD), lead con prioridad y oportunidad ampliada", async () => {
    const co = await crm.createCompany({ name: "Ñandú Kayak S.L.", taxId: "B777", email: "info@nandu.example", country: "ES", city: "Málaga" }, "t");
    const got = await crm.getCompany(co.id);
    expect(got).toMatchObject({ taxId: "B777", country: "ES", city: "Málaga", status: "active", lifecycle: "prospect", updatedAt: null });
    const a = await crm.createContact(co.id, { firstName: "Ana", lastName: "Ñ", email: "ana@nandu.example" }, "t");
    const b = await crm.createContact(co.id, { firstName: "Bea", phone: "600" }, "t");
    expect(a.isPrimary).toBe(true);
    expect(b.isPrimary).toBe(false);
    await crm.updateContact(b.id, { isPrimary: true }, "t");
    expect((await crm.listContacts({ companyId: co.id })).items.filter((c) => c.isPrimary).map((c) => c.id)).toEqual([b.id]);
    // La restricción de BD impide dos principales aunque se salte el servicio
    await expect(pool.query("UPDATE crm_contacts SET is_primary = 1 WHERE id = ?", [a.id])).rejects.toMatchObject({ code: "ER_DUP_ENTRY" });

    const l = await crm.createLead({ name: "Leo", email: "leo@nandu.example", priority: "urgent", companyId: co.id }, "t");
    expect((await crm.listLeads({ priority: "urgent" })).items.map((x) => x.id)).toContain(l.id);
    const r = await crm.convertLead(l.id, { opportunity: { title: "Pro", planId: "pro", modules: ["hotel"] } }, "t");
    expect(r.company.id).toBe(co.id);
    await crm.moveStage(r.opportunity!.id, "qualification", "t");
    const o = await crm.updateOpportunity(r.opportunity!.id, { nextAction: "Demo", nextActionAt: 1_800_000_000_000, modules: ["hotel", "spa"] }, "t");
    expect(o).toMatchObject({ stage: "qualification", modules: ["hotel", "spa"], nextActionAt: 1_800_000_000_000, contactId: r.contact.id });
  });

  it("contratos v2: referencia única, versiones JSON, firma registrada y renovación", async () => {
    const co = await crm.createCompany({ name: "Contratos MySQL" }, "t");
    await crm.createContact(co.id, { firstName: "Eva", email: "eva@ct.example" }, "t");
    const c = await crm.createContract({ companyId: co.id, planId: "base", billingInterval: "month", autoRenew: true, conditions: "Condición ñ", noticeDays: 15 }, "t");
    expect(c.reference).toMatch(/^CT-\d{4}-\d{6}$/);
    const v2 = await crm.updateContract(c.id, { amountCents: 2500, reason: "Precio pactado" }, "t");
    expect(v2).toMatchObject({ version: 2, autoRenew: true, noticeDays: 15 });
    const d = await crm.getContract(c.id);
    expect(d.versions.map((v) => v.version)).toEqual([2, 1]);
    expect(d.versions[0].snapshot).toMatchObject({ amountCents: 2500, autoRenew: true, conditions: "Condición ñ" });
    await expect(pool.query("UPDATE crm_contracts SET reference = (SELECT r FROM (SELECT reference AS r FROM crm_contracts WHERE id = ?) x) WHERE id <> ? LIMIT 1", [c.id, c.id])).rejects.toMatchObject({ code: "ER_DUP_ENTRY" });
    for (const st of ["sent", "signed", "active"] as const) await crm.setContractStatus(c.id, st, "t", { signatureRef: "papel" });
    const act = (await crm.getContract(c.id)).contract;
    expect(act).toMatchObject({ status: "active", signatureMethod: "manual", signatureRef: "papel" });
    expect(act.renewalDate).toBeGreaterThan(act.startDate!);
    const r = await crm.renewContract(c.id, "t");
    expect(r).toMatchObject({ previousContractId: c.id, startDate: act.renewalDate, status: "draft" });
  });

  it("solicitudes web: JSON opcional, claves únicas en BD e idempotencia entre instancias", async () => {
    const st = new MysqlCrmStore(pool);
    const crmSvc = new CrmService({ store: st });
    // Dos instancias del servicio (p. ej. dos réplicas): la BD es la que garantiza la unicidad
    const a = new WebRequestService({ store: st, crm: crmSvc });
    const b = new WebRequestService({ store: st, crm: crmSvc });
    const input = {
      type: "trial" as const,
      name: "Web MySQL",
      email: "web@mysql.example",
      company: "Empresa Web",
      configuration: { plan: "business", extensions: [], industries: ["spa"], interests: [] },
      marketingConsent: true,
      privacyVersion: "2026-10-borrador",
    };
    const k = crypto.randomUUID();
    const [r1, r2] = await Promise.all([a.receive(input, { idempotencyKey: k, ipHash: "a".repeat(64) }), b.receive(input, { idempotencyKey: k, ipHash: "a".repeat(64) })]);
    expect(r1.request.reference).toBe(r2.request.reference);
    expect([r1.outcome, r2.outcome].sort()).toEqual(["created", "replayed"]);
    const [[n]] = (await pool.query<mysql.RowDataPacket[]>("SELECT COUNT(*) AS n FROM crm_lead_requests WHERE idempotency_key = ?", [k])) as any;
    expect(Number(n.n)).toBe(1);
    const stored = (await st.get("leadRequests", r1.request.id))!;
    expect(stored).toMatchObject({ configuration: { plan: "business", industries: ["spa"] }, utm: null, marketingConsent: true, attendedAt: null, leadId: r1.request.leadId });
    // Sin configuración se guarda NULL, no una lista vacía
    const c = await a.receive({ ...input, type: "contact", configuration: null, message: "Hola" }, { idempotencyKey: crypto.randomUUID(), ipHash: null });
    const [[raw]] = (await pool.query<mysql.RowDataPacket[]>("SELECT configuration FROM crm_lead_requests WHERE id = ?", [c.request.id])) as any;
    expect(raw.configuration).toBeNull();
    expect((await st.get("leadRequests", c.request.id))!.configuration).toBeNull();
    // La clave única de la BD se traduce a DuplicateKeyError
    await expect(st.insert("leadRequests", { ...stored, reference: "SOL-OTRAREF1" } as never)).rejects.toBeInstanceOf(DuplicateKeyError);
    // La FK impide solicitudes huérfanas
    await expect(pool.query("INSERT INTO crm_lead_requests (lead_id, reference, type, privacy_accepted_at, privacy_version, idempotency_key, payload_hash, created_at) VALUES (999999, 'SOL-HUERFANA', 'contact', 1, 'v', ?, ?, 1)", [crypto.randomUUID(), "x".repeat(64)])).rejects.toMatchObject({ code: "ER_NO_REFERENCED_ROW_2" });
    // Atender desde el CRM
    const v = await a.setStatus(r1.request.id, "attended", "operator:laura");
    expect(v.attendedAt).toEqual(expect.any(Number));
    expect((await st.get("leads", r1.request.leadId))!.status).toBe("contacted");
  });

  it("las migraciones del CRM se revierten y se vuelven a aplicar conservando los datos base", async () => {
    const [[before]] = (await pool.query<mysql.RowDataPacket[]>("SELECT COUNT(*) AS n FROM crm_companies")) as any;
    await runCrmMigrations(pool, "down");
    const [reqTable] = await pool.query<mysql.RowDataPacket[]>("SHOW TABLES LIKE 'crm_lead_requests'");
    expect(reqTable).toHaveLength(0);
    const [cols] = await pool.query<mysql.RowDataPacket[]>("SHOW COLUMNS FROM crm_contacts LIKE 'is_primary'");
    expect(cols).toHaveLength(0);
    const [[stage]] = (await pool.query<mysql.RowDataPacket[]>("SELECT COUNT(*) AS n FROM crm_opportunities WHERE stage = 'qualification'")) as any;
    expect(Number(stage.n)).toBe(0); // etapa nueva reasignada a una existente
    await runCrmMigrations(pool, "up");
    const [[after]] = (await pool.query<mysql.RowDataPacket[]>("SELECT COUNT(*) AS n FROM crm_companies")) as any;
    expect(Number(after.n)).toBe(Number(before.n));
  });
});
