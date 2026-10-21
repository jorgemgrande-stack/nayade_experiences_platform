/**
 * Trazabilidad de la bandeja sobre MySQL real (opt-in, REGISTRY_TEST_DATABASE_URL), con la migración del CRM (0011)
 * y datos sintéticos (.example). Nada sale: MAIL_MODE=off.
 *  - Lista: orden, filtros, paginación, sin direcciones completas ni cuerpos.
 *  - El filtro por plantilla trata «_» y «%» como literales (no amplía la búsqueda).
 *  - Historial con los eventos del proveedor y sin duplicados.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";
import { mailPolicyFromEnv } from "./mail/policy";
import { memoryProvider } from "./mail/providers";
import { MailService, mailRef } from "./mail/service";
import { MysqlMailStore } from "./mail/store";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
const DB = `mail_ledger_${crypto.randomBytes(3).toString("hex")}`;
const CRM_UP = path.resolve(__dirname, "../db/crm/migrations/0011_platform_mail_outbox.sql");

describe.skipIf(!URL_)("trazabilidad de la bandeja sobre MySQL", () => {
  let admin: mysql.Pool;
  let pool: mysql.Pool;
  let store: MysqlMailStore;
  let svc: MailService;
  const ids: number[] = [];

  beforeAll(async () => {
    admin = mysql.createPool({ uri: URL_!, connectionLimit: 2 });
    await admin.query(`CREATE DATABASE ${DB} CHARACTER SET utf8mb4`);
    const u = new URL(URL_!);
    u.pathname = `/${DB}`;
    pool = mysql.createPool({ uri: u.toString(), connectionLimit: 4 });
    const sql = fs.readFileSync(CRM_UP, "utf8").split(/\r?\n/).filter((l) => !/^\s*--/.test(l)).join("\n").split(/;\s*\n/).map((s) => s.trim()).filter(Boolean);
    for (const s of sql) await pool.query(s);
    store = new MysqlMailStore(pool);
    svc = new MailService({ lane: "platform", store, provider: memoryProvider(), policy: mailPolicyFromEnv({ MAIL_MODE: "off", MAIL_SENDING_DOMAIN: "bigelephant.es" } as NodeJS.ProcessEnv) });
    for (const [tenantId, key] of [
      ["acme", "notif:subscription.suspended:v1:e1"],
      ["acme", "trial:7:expiry:1800000000:3"],
      ["costa", "notif:module.activated:v1:e2"],
      ["costa", "trial-welcome:costa:abc"],
      ["costa", "notif:ops_x:v1:e3"],
    ]) {
      const r = await svc.send({ tenantId, idempotencyKey: key, category: "operational", to: "ana@pruebas.example", subject: `Aviso ${key}`, html: "<p>cuerpo</p>", sender: { lane: "platform" } });
      ids.push(r.id!);
    }
  });

  afterAll(async () => {
    await pool?.end();
    await admin?.query(`DROP DATABASE IF EXISTS ${DB}`);
    await admin?.end();
  });

  it("lista: más reciente primero, sin dirección completa ni cuerpo, filtros y paginación", async () => {
    const all = await store.list({});
    expect(all.map((r) => r.id)).toEqual([...ids].reverse());
    const json = JSON.stringify(all);
    expect(json).not.toContain("ana@pruebas.example");
    expect(json).not.toContain("<p>cuerpo</p>");
    expect(all.every((r) => r.status === "skipped" && r.reason === "mode_off")).toBe(true);
    expect((await store.list({ tenantId: "acme" })).map((r) => r.template)).toEqual(["trial", "subscription.suspended"]);
    expect((await store.list({ beforeId: ids[2], limit: 1 })).map((r) => r.id)).toEqual([ids[1]]);
    expect((await store.list({ status: "delivered" })).length).toBe(0);
  });

  it("el filtro por plantilla no amplía la búsqueda con «_» ni «%»", async () => {
    expect((await store.list({ template: "trial" })).map((r) => r.idempotencyKey)).toEqual(["trial:7:expiry:1800000000:3"]);
    expect((await store.list({ template: "module.activated" })).length).toBe(1);
    expect((await store.list({ template: "ops_x" })).length).toBe(0); // «ops_x» sin punto busca un notificador, no una plantilla
    expect((await store.list({ template: "ops%" })).length).toBe(0);
  });

  it("historial con los eventos del proveedor, sin duplicar el mismo evento", async () => {
    const ev = { kind: "delivered" as const, ref: mailRef("platform", "acme", ids[0]), messageId: null, email: "ana@pruebas.example", eventId: "pm-evt-1", reason: null };
    expect(await svc.applyEvent(ev)).toBe("applied");
    expect(await svc.applyEvent(ev)).toBe("duplicate");
    const h = (await store.history(ids[0]))!;
    expect(h.events.filter((e) => e.fromProvider).map((e) => e.kind)).toEqual(["provider_delivered"]);
    expect(await store.history(999_999)).toBeNull();
  });
});
