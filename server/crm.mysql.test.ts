/**
 * CRM con MySQL real (opt-in): esquema, mapeo de columnas (JSON, BIGINT) y flujo completo.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";
import { MysqlCrmStore } from "./crm/mysqlStore";
import { CrmService } from "./crm/service";

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
});
