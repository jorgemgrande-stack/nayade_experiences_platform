/**
 * Segundo factor de los operadores contra MySQL real (opt-in con REGISTRY_TEST_DATABASE_URL; en serie):
 * migración 0012 sobre la 0007, secreto solo cifrado en la BD, sesión pendiente persistente tras
 * «reiniciar», códigos de recuperación de un solo uso también ante carreras, y que sin la 0012 el
 * almacén sigue funcionando como antes.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";
import { OperatorAuthService } from "./controlPlane/operatorAuth";
import { MysqlOperatorStore } from "./controlPlane/operatorStore";
import { operatorAuthFromEnv } from "./controlPlane/operatorSetup";
import { base32Decode, hotp, totpStep } from "./controlPlane/totp";
import { keyringFromEnv } from "./_core/tenantRegistry/crypto";

const url = process.env.REGISTRY_TEST_DATABASE_URL;
const d = url ? describe : describe.skip;
const M0007 = path.resolve(__dirname, "../db/registry/0007_operators.sql");
const M0012 = path.resolve(__dirname, "../db/registry/0012_operator_mfa.sql");
const TABLES = "cp_operator_recovery_codes, cp_operator_events, cp_password_resets, cp_operator_sessions, cp_operators";
const PW = { root: "Raiz-Segura-Prado-2026!" };
const ring = keyringFromEnv({ REGISTRY_KEYS: `k1:${crypto.randomBytes(32).toString("base64")}`, REGISTRY_ACTIVE_KEY_ID: "k1" } as NodeJS.ProcessEnv);

d("segundo factor de los operadores (MySQL)", () => {
  let admin: mysql.Pool;
  const pool = () => mysql.createPool({ uri: url!, connectionLimit: 4 });

  beforeAll(async () => {
    admin = mysql.createPool({ uri: url!, multipleStatements: true, connectionLimit: 2 });
    await admin.query(`DROP TABLE IF EXISTS ${TABLES}`);
    await admin.query("CREATE TABLE IF NOT EXISTS registry_meta (k VARCHAR(64) PRIMARY KEY, v VARCHAR(255) NOT NULL)");
    await admin.query("INSERT IGNORE INTO registry_meta (k, v) VALUES ('schema_version', '0006')");
    await admin.query(fs.readFileSync(M0007, "utf8"));
  });

  afterAll(async () => {
    await admin?.query(`DROP TABLE IF EXISTS ${TABLES}`);
    await admin?.end();
  });

  it("sin la 0012 el acceso sigue igual y el MFA queda desactivado (con el motivo)", async () => {
    const p = pool();
    const setup = await operatorAuthFromEnv(p, { CP_OPERATOR_MFA_ROLES: "superadmin" } as NodeJS.ProcessEnv, { keyring: ring });
    expect(setup.mfa).toMatchObject({ available: false, requiredRoles: [], reason: expect.stringContaining("0012") });
    await setup.service!.bootstrap({ username: "root", displayName: "Raíz", password: PW.root });
    const r = await setup.service!.login("root", PW.root);
    expect(r.mfa).toBe("none");
    expect((await setup.service!.validateSession(r.token))?.scopes.length).toBeGreaterThan(0);
    await p.end();
  });

  it("con la 0012: alta cifrada, login en dos pasos persistente tras reiniciar y recuperación de un solo uso", async () => {
    await admin.query(fs.readFileSync(M0012, "utf8"));
    await admin.query(fs.readFileSync(M0012, "utf8")); // repetible: el ejecutor puede volver a aplicarla al reparar
    const [[meta]] = await admin.query<any[]>("SELECT v FROM registry_meta WHERE k = 'schema_version'");
    expect(meta.v).toBe("0012");

    const p1 = pool();
    const s1 = (await operatorAuthFromEnv(p1, {} as NodeJS.ProcessEnv, { keyring: ring })).service!;
    expect(s1.mfaAvailable).toBe(true);
    const first = await s1.login("root", PW.root);
    const actor = { id: first.operator.id, username: "root", role: "superadmin" as const, sessionId: first.session.id };
    const { secret } = await s1.setupMfa(actor);
    const now = Date.now();
    const { recoveryCodes } = await s1.enableMfa(actor, hotp(base32Decode(secret), totpStep(now)));
    expect(recoveryCodes).toHaveLength(10);

    // En la BD: secreto cifrado y solo hashes de los códigos
    const [[op]] = await admin.query<any[]>("SELECT * FROM cp_operators WHERE username = 'root'");
    expect(op.mfa_enabled_at).toBeTruthy();
    expect(String(op.mfa_secret_cipher)).not.toContain(secret);
    const [codes] = await admin.query<any[]>("SELECT code_hash FROM cp_operator_recovery_codes");
    expect(codes).toHaveLength(10);
    expect(JSON.stringify(codes)).not.toContain(recoveryCodes[0]);

    // Login: sesión pendiente persistida; tras «reiniciar», el código la completa
    const pending = await s1.login("root", PW.root);
    expect(pending.mfa).toBe("pending");
    await p1.end();
    const p2 = pool();
    const s2 = new OperatorAuthService(new MysqlOperatorStore(p2, { mfa: true }), { mfaKeyring: ring });
    expect(await s2.validateSession(pending.token)).toBeNull();
    const done = await s2.verifyMfa(pending.token, recoveryCodes[0]);
    expect((await s2.validateSession(done.token))?.operator.username).toBe("root");
    expect(await s2.validateSession(pending.token)).toBeNull();

    // El mismo código de recuperación dos veces a la vez: solo una gana
    const a = await s2.login("root", PW.root);
    const b = await s2.login("root", PW.root);
    const results = await Promise.allSettled([s2.verifyMfa(a.token, recoveryCodes[1]), s2.verifyMfa(b.token, recoveryCodes[1])]);
    expect(results.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    await p2.end();
  });
});
