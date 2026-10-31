/**
 * Tokens de un solo uso guardados como hash, sobre MySQL real (opt-in, REGISTRY_TEST_DATABASE_URL).
 * Adaptado de Skicenter (83623238, 7599aa3f). Base desechable con el esquema de empresa (baseline + migraciones); datos sintéticos
 * (.example); el correo se captura en memoria, no sale nada.
 *  - Recuperación de contraseña: la BD guarda solo el hash; el enlace del correo funciona; el hash no sirve.
 *  - Invitación: la BD guarda solo el hash; el enlace funciona una sola vez; el hash no sirve.
 *  - Compatibilidad: un token antiguo guardado en claro sigue valiendo hasta caducar.
 *  - Alta de empresa (seedAdmin y reenvío): la BD guarda el hash y el token devuelto canjea la invitación.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import type { AddressInfo } from "node:net";
import express from "express";
import mysql from "mysql2/promise";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
const DB = `ott_${crypto.randomBytes(3).toString("hex")}`;

const outbox = vi.hoisted(() => ({ mails: [] as Array<{ to: string; text?: string; html: string }> }));
vi.mock("./mailer", async (orig) => ({
  ...(await orig<typeof import("./mailer")>()),
  sendEmail: async (p: { to: string; html: string; text?: string }) => {
    outbox.mails.push(p);
    return true;
  },
}));
vi.mock("./emailManager", async (orig) => ({ ...(await orig<typeof import("./emailManager")>()), logDirectEmail: async () => undefined }));

describe.skipIf(!URL_)("tokens de un solo uso guardados como hash", () => {
  let admin: mysql.Pool;
  let pool: mysql.Pool;
  let dsn: string;
  let server: http.Server;
  let base: string;
  const saved = { ...process.env };

  const post = async (p: string, body: unknown) => {
    const r = await fetch(base + p, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return { status: r.status, json: (await r.json().catch(() => null)) as any };
  };
  const get = async (p: string) => {
    const r = await fetch(base + p);
    return { status: r.status, json: (await r.json().catch(() => null)) as any };
  };
  async function addUser(email: string): Promise<number> {
    const [r] = await pool.query<mysql.ResultSetHeader>(
      "INSERT INTO users (openId, name, email, loginMethod, role, isActive) VALUES (?, 'Persona de prueba', ?, 'local', 'agente', 1)",
      [`local-${crypto.randomBytes(6).toString("hex")}`, email],
    );
    return r.insertId;
  }
  const dump = async (table: string) => JSON.stringify((await pool.query(`SELECT * FROM ${table}`))[0]);

  beforeAll(async () => {
    admin = mysql.createPool({ uri: URL_!, connectionLimit: 2 });
    await admin.query(`CREATE DATABASE ${DB} CHARACTER SET utf8mb4`);
    const u = new URL(URL_!);
    u.pathname = `/${DB}`;
    dsn = u.toString();
    pool = mysql.createPool({ uri: dsn, connectionLimit: 4 });
    const { MysqlSchemaApplier } = await import("./_core/provisioning/mysqlAdapters");
    await new MysqlSchemaApplier({
      baselinePath: path.resolve(__dirname, "../db/baseline/0000_baseline.sql"),
      migrationsDir: path.resolve(__dirname, "../db/migrations"),
    }).apply(dsn);
    delete process.env.TENANT_MODE;
    process.env.DATABASE_URL = dsn;
    process.env.APP_URL = "https://empresa.example";
    const { createPasswordResetRouter } = await import("./passwordReset");
    const app = express();
    app.use(express.json());
    app.use(createPasswordResetRouter());
    server = app.listen(0);
    await new Promise((r) => server.once("listening", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }, 120_000);

  afterAll(async () => {
    process.env = saved;
    if (server) await new Promise((r) => server.close(r));
    await pool?.end().catch(() => undefined);
    await admin?.query(`DROP DATABASE IF EXISTS ${DB}`);
    await admin?.end();
  });

  it("recuperación de contraseña: la BD guarda solo el hash y el enlace del correo funciona una vez", async () => {
    const { requestPasswordReset } = await import("./passwordReset");
    const { hashOneTimeToken } = await import("./oneTimeToken");
    const email = "recupera@empresa.example";
    await addUser(email);
    expect(await requestPasswordReset(email)).toBe("sent");
    const mail = outbox.mails.at(-1)!;
    const token = /token=([0-9a-f]+)/.exec(mail.html)![1];
    const stored = await dump("password_reset_tokens");
    expect(stored).not.toContain(token);
    expect(stored).toContain(hashOneTimeToken(token));

    // El valor guardado no sirve como token
    const [[row]] = (await pool.query("SELECT token FROM password_reset_tokens ORDER BY id DESC LIMIT 1")) as any;
    expect((await get(`/api/auth/validate-reset-token?token=${encodeURIComponent(row.token)}`)).json).toEqual({ valid: false });
    expect((await post("/api/auth/reset-password", { token: row.token, password: "clave-nueva-123" })).status).toBe(400);

    expect((await get(`/api/auth/validate-reset-token?token=${token}`)).json).toEqual({ valid: true });
    expect((await post("/api/auth/reset-password", { token, password: "clave-nueva-123" })).status).toBe(200);
    expect((await post("/api/auth/reset-password", { token, password: "otra-clave-123" })).status).toBe(400);
  });

  it("compatibilidad: un enlace antiguo guardado en claro sigue valiendo hasta caducar", async () => {
    const uid = await addUser("antiguo@empresa.example");
    const vigente = crypto.randomBytes(48).toString("hex");
    const caducado = crypto.randomBytes(48).toString("hex");
    await pool.query("INSERT INTO password_reset_tokens (userId, token, expiresAt) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 1 HOUR))", [uid, vigente]);
    await pool.query("INSERT INTO password_reset_tokens (userId, token, expiresAt) VALUES (?, ?, DATE_SUB(NOW(), INTERVAL 1 MINUTE))", [uid, caducado]);
    expect((await post("/api/auth/reset-password", { token: caducado, password: "clave-nueva-123" })).status).toBe(400);
    expect((await post("/api/auth/reset-password", { token: vigente, password: "clave-nueva-123" })).status).toBe(200);
  });

  it("invitación: la BD guarda solo el hash, el enlace se canjea una vez y el hash no sirve", async () => {
    const db = await import("./db");
    const token = crypto.randomBytes(24).toString("hex");
    const { id } = await db.createInvitedUser({ name: "Invitada", email: "invitada@empresa.example", role: "agente", inviteToken: token, inviteTokenExpiry: new Date(Date.now() + 2 * 86_400_000) });
    const stored = await dump("users");
    expect(stored).not.toContain(token);
    const [[row]] = (await pool.query("SELECT inviteToken FROM users WHERE id = ?", [id])) as any;
    expect(row.inviteToken).toMatch(/^sha256:[0-9a-f]{64}$/);

    expect(await db.getUserByInviteToken(row.inviteToken)).toBeNull();
    expect(await db.redeemInviteToken(id, row.inviteToken, "hash-falso")).toBe(false);
    expect((await db.getUserByInviteToken(token))?.id).toBe(id);
    const [a, b] = await Promise.all([db.redeemInviteToken(id, token, "hash-1"), db.redeemInviteToken(id, token, "hash-2")]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
    expect(await db.getUserByInviteToken(token)).toBeNull();

    // Reenvío: también guarda el hash
    const { id: id2 } = await db.createInvitedUser({ name: "Otra", email: "otra@empresa.example", role: "agente", inviteToken: "primer-token-de-prueba-0001", inviteTokenExpiry: new Date(Date.now() + 2 * 86_400_000) });
    await db.resendUserInvite(id2, "segundo-token-de-prueba-0002", new Date(Date.now() + 2 * 86_400_000));
    expect(await dump("users")).not.toContain("segundo-token-de-prueba-0002");
    expect(await db.getUserByInviteToken("primer-token-de-prueba-0001")).toBeNull();
    expect((await db.getUserByInviteToken("segundo-token-de-prueba-0002"))?.id).toBe(id2);
  });

  it("compatibilidad: una invitación antigua en claro (64 hex) sigue valiendo hasta caducar", async () => {
    const db = await import("./db");
    const antiguo = crypto.randomBytes(32).toString("hex");
    await pool.query(
      "INSERT INTO users (openId, name, email, loginMethod, role, isActive, inviteToken, inviteTokenExpiry, inviteAccepted) VALUES ('local-antiguo', 'Antigua', 'antigua@empresa.example', 'local', 'agente', 1, ?, DATE_ADD(NOW(), INTERVAL 1 DAY), 0)",
      [antiguo],
    );
    const user = await db.getUserByInviteToken(antiguo);
    expect(user).not.toBeNull();
    expect(await db.redeemInviteToken(user!.id, antiguo, "hash-x")).toBe(true);
  });

  it("alta de empresa: seedAdmin y el reenvío guardan el hash y el token devuelto canjea la invitación", async () => {
    const { MysqlTenantSeeder } = await import("./_core/provisioning/mysqlAdapters");
    const db = await import("./db");
    const seeder = new MysqlTenantSeeder();
    const out = await seeder.seedAdmin(dsn, { email: "duena@empresa.example", name: "Dueña" });
    expect(out.created).toBe(true);
    expect(await dump("users")).not.toContain(out.inviteToken!);
    const again = await seeder.reissueAdminInvite(dsn, { email: "duena@empresa.example" });
    expect(await dump("users")).not.toContain(again!.inviteToken);
    expect(await db.getUserByInviteToken(out.inviteToken!)).toBeNull();
    const user = await db.getUserByInviteToken(again!.inviteToken);
    expect(user?.email).toBe("duena@empresa.example");
    expect(await db.redeemInviteToken(user!.id, again!.inviteToken, "hash-y")).toBe(true);
  });
});
