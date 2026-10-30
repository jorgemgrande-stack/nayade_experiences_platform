/**
 * Avisos de seguridad de los operadores contra MySQL real (opt-in con REGISTRY_TEST_DATABASE_URL; ejecutar en serie):
 * historial de dispositivos de las sesiones y cambio de correo verificado (migración 0015, repetible).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";
import { OperatorAuthService } from "./controlPlane/operatorAuth";
import { MysqlOperatorStore } from "./controlPlane/operatorStore";

const url = process.env.REGISTRY_TEST_DATABASE_URL;
const d = url ? describe : describe.skip;
const MIGRATIONS = ["0007_operators.sql", "0015_operator_email_changes.sql"].map((f) => path.resolve(__dirname, "../db/registry", f));
const TABLES = "cp_operator_email_changes, cp_operator_events, cp_password_resets, cp_operator_sessions, cp_operators";
const PW = { root: "ci-only-placeholder-not-a-secret-1", ana: "ci-only-placeholder-not-a-secret-2" };
const CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const FIREFOX = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14.5; rv:131.0) Gecko/20100101 Firefox/131.0";

d("avisos de seguridad de los operadores (MySQL)", () => {
  let admin: mysql.Pool;
  let pool: mysql.Pool;

  beforeAll(async () => {
    admin = mysql.createPool({ uri: url!, multipleStatements: true, connectionLimit: 2 });
    await admin.query(`DROP TABLE IF EXISTS ${TABLES}`);
    await admin.query("CREATE TABLE IF NOT EXISTS registry_meta (k VARCHAR(64) PRIMARY KEY, v VARCHAR(255) NOT NULL)");
    await admin.query("INSERT IGNORE INTO registry_meta (k, v) VALUES ('schema_version', '0006')");
    for (const m of MIGRATIONS) {
      const sql = fs.readFileSync(m, "utf8");
      await admin.query(sql);
      await admin.query(sql); // repetible
    }
    pool = mysql.createPool({ uri: url!, connectionLimit: 4 });
  });

  afterAll(async () => {
    await pool?.end();
    await admin?.query(`DROP TABLE IF EXISTS ${TABLES}`);
    await admin?.end();
  });

  it("dispositivo nuevo respecto a las sesiones guardadas y cambio de correo de un solo uso", async () => {
    const sent: Array<{ kind: string; to: string; link?: string }> = [];
    const svc = new OperatorAuthService(new MysqlOperatorStore(pool, { emailChanges: true }), {
      emailChangeUrl: "https://crm.elephant.example/cp/v1/auth/email-change/confirm",
      securityMail: {
        newLogin: async (to) => void sent.push({ kind: "newLogin", to }),
        emailChangeConfirmation: async (to, i) => void sent.push({ kind: "confirm", to, link: i.link }),
        emailChanged: async (to) => void sent.push({ kind: "changed", to }),
      },
    });
    await svc.bootstrap({ username: "root", displayName: "Raíz", password: PW.root });
    const root = { id: 1, username: "root", role: "superadmin" as const };
    await svc.create(root, { username: "ana", email: "ana@elephant.example", displayName: "Ana", role: "sales", password: PW.ana });
    await svc.login("ana", PW.ana, { userAgent: CHROME });
    await svc.login("ana", PW.ana, { userAgent: CHROME });
    await svc.login("ana", PW.ana, { userAgent: FIREFOX });
    expect(sent.filter((s) => s.kind === "newLogin")).toEqual([{ kind: "newLogin", to: "ana@elephant.example" }]);

    await svc.update(root, 2, { email: "ana.nueva@elephant.example" });
    const link = sent.find((s) => s.kind === "confirm")!.link!;
    const token = new URL(link).searchParams.get("token")!;
    const [rows] = await admin.query<any[]>("SELECT * FROM cp_operator_email_changes");
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain(token);
    await svc.confirmEmailChange(token);
    await expect(svc.confirmEmailChange(token)).rejects.toMatchObject({ code: "invalid_email_change_token" });
    expect((await svc.get(2)).email).toBe("ana.nueva@elephant.example");
    expect(sent.filter((s) => s.kind === "changed").map((s) => s.to)).toEqual(["ana@elephant.example", "ana.nueva@elephant.example"]);
  });
});
