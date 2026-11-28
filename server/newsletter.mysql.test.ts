/**
 * Newsletter sobre MySQL REAL (opt-in: REGISTRY_TEST_DATABASE_URL): aplica las migraciones 0042 (consentimiento de
 * marketing) y 0095 (newsletter) en una base temporal propia, con una tabla `clients` mínima, y ejecuta el almacén, el
 * enlace con el CRM y el servicio completo con un correo simulado: alta, duplicado, confirmación, bienvenida única,
 * consentimiento de marketing, baja, reactivación, listado con filtros, exportación y revertir la migración sin perder datos.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import crypto from "node:crypto";
import path from "node:path";
import fs from "node:fs";
import mysql from "mysql2/promise";
import { splitStatements } from "../scripts/db/migrationLib";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
const DB = `newsletter_${crypto.randomBytes(3).toString("hex")}`;
const DIR = path.resolve(__dirname, "../db/migrations");
const SECRET = "t".repeat(40);

describe.skipIf(!URL_)("newsletter (MySQL real, correo simulado)", () => {
  let admin: mysql.Connection;
  let svc: import("./newsletter/service").NewsletterService;
  let store: typeof import("./newsletter/store").mysqlNewsletterStore;
  let sent: Array<{ to: string; text: string; category: string; idempotencyKey: string }> = [];
  let now = Date.now();

  beforeAll(async () => {
    admin = await mysql.createConnection({ uri: URL_!, multipleStatements: false });
    await admin.query(`CREATE DATABASE \`${DB}\` CHARACTER SET utf8mb4`);
    await admin.query(`USE \`${DB}\``);
    // Tabla `clients` mínima (la real es de drizzle/schema.ts) y las migraciones reales
    await admin.query(`CREATE TABLE clients (id INT AUTO_INCREMENT PRIMARY KEY, leadId INT NULL, source VARCHAR(64) NOT NULL DEFAULT 'lead', name VARCHAR(256) NOT NULL, email VARCHAR(256) NOT NULL UNIQUE, createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
    for (const f of ["0042_brevo_marketing.sql", "0095_newsletter.sql"]) for (const s of splitStatements(fs.readFileSync(path.join(DIR, f), "utf8"))) await admin.query(s);
    const u = new URL(URL_!);
    u.pathname = `/${DB}`;
    process.env.DATABASE_URL = u.toString();
    process.env.TENANT_MODE = "single";
    const { NewsletterService } = await import("./newsletter/service");
    const runtime = await import("./newsletter/runtime");
    store = (await import("./newsletter/store")).mysqlNewsletterStore;
    svc = new NewsletterService({
      store,
      crm: runtime.crmPort,
      mail: { send: async (m) => (sent.push(m), { ok: true }) },
      tenantId: "t-mysql",
      now: () => now,
      secrets: () => [SECRET],
      baseUrl: () => "https://q.example",
      identity: () => ({ brand: "Quantum", legalLine: "Quantum S.L." }),
    });
    await store.saveSettings({ enabled: true }, "test", now);
  });
  afterAll(async () => {
    await admin?.query(`DROP DATABASE IF EXISTS \`${DB}\``).catch(() => undefined);
    await admin?.end().catch(() => undefined);
  });

  const input = (email: string, locale = "es") => ({ email, consent: true, locale, source: "web:inicio", page: "/", consentText: "Acepto la newsletter y la privacidad.", ipHash: null });
  const confirmToken = () => /\/newsletter\/confirmar\/([A-Za-z0-9_-]{43})/.exec(sent.filter((m) => m.idempotencyKey.startsWith("nl:confirm")).at(-1)!.text)![1];
  const [one] = [() => admin.query(`SELECT * FROM customer_marketing_consents`)];
  void one;

  it("ajustes: el módulo nace apagado y se activa solo cuando se guarda", async () => {
    await admin.query("DELETE FROM newsletter_settings");
    expect((await store.settings()).enabled).toBe(false);
    await store.saveSettings({ enabled: true, templates: { welcome: { es: { subject: "Hola ✨" } } } }, "test", now);
    const s = await store.settings();
    expect(s).toMatchObject({ enabled: true, publicEnabled: true });
    expect(s.templates.welcome?.es?.subject).toBe("Hola ✨");
  });

  it("alta → pendiente → confirmación → activa con cliente del CRM, consentimiento y una bienvenida", async () => {
    sent = [];
    await svc.subscribe(input("Ana@Example.com"));
    await svc.subscribe(input("ana@example.com")); // duplicado inmediato: una fila, un correo
    const [[c]] = (await admin.query("SELECT COUNT(*) AS c FROM newsletter_subscribers")) as any;
    expect(Number(c.c)).toBe(1);
    expect(sent).toHaveLength(1);
    const sub = (await store.byEmail("ana@example.com"))!;
    expect(sub.status).toBe("pending");
    expect(sub.confirmExpiresAt).toBeGreaterThan(now);
    const stored = JSON.stringify((await admin.query("SELECT confirm_token_hash FROM newsletter_subscribers"))[0]);
    expect(stored).not.toContain(confirmToken()); // solo la huella
    expect(await svc.confirm(confirmToken())).toMatchObject({ state: "confirmed" });
    await svc.confirm(confirmToken()).catch(() => undefined);
    const after = (await store.byEmail("ana@example.com"))!;
    expect(after).toMatchObject({ status: "active", crmSyncError: null });
    expect(after.clientId).toBeGreaterThan(0);
    const [[cl]] = (await admin.query("SELECT source, email FROM clients WHERE id = ?", [after.clientId])) as any;
    expect(cl).toMatchObject({ source: "newsletter", email: "ana@example.com" });
    const [[cons]] = (await admin.query("SELECT status, source FROM customer_marketing_consents WHERE client_id = ?", [after.clientId])) as any;
    expect(cons).toMatchObject({ status: "granted" });
    expect(sent.filter((m) => m.idempotencyKey.startsWith("nl:welcome"))).toHaveLength(1);
    expect((await store.mails(after.id)).map((m) => `${m.kind}:${m.status}`).sort()).toEqual(["confirm:sent", "welcome:sent"]);
    expect((await store.events(after.id)).map((e) => e.action).sort()).toEqual(["confirmed", "requested", "welcome_sent"]);
  });

  it("un cliente que ya existía no se duplica", async () => {
    await admin.query("INSERT INTO clients (name, email, source) VALUES ('Berta', 'berta@example.com', 'manual')");
    sent = [];
    await svc.subscribe(input("berta@example.com", "de"));
    await svc.confirm(confirmToken());
    const [rows] = (await admin.query("SELECT id, source FROM clients WHERE email = 'berta@example.com'")) as any;
    expect(rows).toHaveLength(1);
    expect(rows[0].source).toBe("manual");
    expect((await store.byEmail("berta@example.com"))!.clientId).toBe(rows[0].id);
  });

  it("baja: retira la suscripción y el consentimiento de marketing, con historial; reactivar exige confirmar de nuevo", async () => {
    const { unsubscribeToken, verifyUnsubscribeToken } = await import("./newsletter/core");
    const sub = (await store.byEmail("ana@example.com"))!;
    const tok = unsubscribeToken(sub.id, "t-mysql", SECRET);
    expect(await svc.unsubscribeByToken(tok, [SECRET], verifyUnsubscribeToken)).toBe(true);
    expect(await svc.unsubscribeByToken(tok, [SECRET], verifyUnsubscribeToken)).toBe(true);
    expect((await store.byId(sub.id))!.status).toBe("unsubscribed");
    const [[cons]] = (await admin.query("SELECT status FROM customer_marketing_consents WHERE client_id = ?", [sub.clientId])) as any;
    expect(cons.status).toBe("withdrawn");
    const [log] = (await admin.query("SELECT new_status FROM customer_marketing_consent_log WHERE client_id = ? ORDER BY id", [sub.clientId])) as any;
    expect(log.map((r: any) => r.new_status)).toEqual(["granted", "withdrawn"]);
    now += 86_400_000;
    sent = [];
    await svc.subscribe(input("ana@example.com"));
    expect((await store.byId(sub.id))!.status).toBe("pending");
    await svc.confirm(confirmToken());
    expect((await store.byId(sub.id))!.status).toBe("active");
    expect(sent.filter((m) => m.idempotencyKey.startsWith("nl:welcome"))).toHaveLength(1);
  });

  it("listado con filtros, orden y paginación; estadísticas; exportación completa del filtro y su constancia", async () => {
    for (let i = 0; i < 7; i++) await svc.subscribe(input(`u${i}@example.com`, i % 2 ? "de" : "es"));
    const all = await store.list({ sort: "email", dir: "asc", page: 1, pageSize: 5 });
    expect(all.total).toBe(9);
    expect(all.rows).toHaveLength(5);
    expect(all.rows.map((r) => r.email)).toEqual([...all.rows.map((r) => r.email)].sort());
    expect((await store.list({ q: "u1@", sort: "createdAt", dir: "desc", page: 1, pageSize: 25 })).total).toBe(1);
    expect((await store.list({ status: "pending", locale: "de", sort: "createdAt", dir: "desc", page: 1, pageSize: 25 })).total).toBe(3);
    expect((await store.list({ q: "%", sort: "createdAt", dir: "desc", page: 1, pageSize: 25 })).total).toBe(0); // el comodín se escapa
    expect(await store.stats(now)).toMatchObject({ active: 2, pending: 7, unsubscribed: 0, total: 9 });
    const rows = await svc.exportRows({ status: "pending" }, "xlsx", { id: 1, name: "Admin" });
    expect(rows).toHaveLength(7);
    const [[ex]] = (await admin.query("SELECT actor, format, row_count, filters FROM newsletter_exports")) as any;
    expect(ex).toMatchObject({ actor: "Admin", format: "xlsx", row_count: 7 });
    expect(await store.facets()).toEqual({ locales: ["de", "es"], sources: ["web:inicio"] });
  });

  it("la clave de idempotencia es única en la base: dos réplicas no reservan el mismo correo", async () => {
    const id = (await store.byEmail("ana@example.com"))!.id;
    const a = await Promise.all([store.reserveMail(id, "welcome", "k-dup", now), store.reserveMail(id, "welcome", "k-dup", now)]);
    expect(a.sort()).toEqual([false, true]);
  });

  it("dos altas simultáneas del mismo correo crean una sola fila", async () => {
    sent = [];
    await Promise.all([svc.subscribe(input("carrera@example.com")), svc.subscribe(input("carrera@example.com"))]);
    const [[c]] = (await admin.query("SELECT COUNT(*) AS c FROM newsletter_subscribers WHERE email = 'carrera@example.com'")) as any;
    expect(Number(c.c)).toBe(1);
  });

  it("la reversión conserva los datos (renombra, no borra)", async () => {
    const down = fs.readFileSync(path.join(DIR, "0095_newsletter.down.sql"), "utf8");
    for (const s of splitStatements(down)) await admin.query(s);
    const [[c]] = (await admin.query("SELECT COUNT(*) AS c FROM retired_newsletter_subscribers")) as any;
    expect(Number(c.c)).toBeGreaterThan(5);
    // Volver a aplicar la 0095 tras revertirla funciona (los CHECK no chocan) y deja las tablas nuevas vacías
    for (const s of splitStatements(fs.readFileSync(path.join(DIR, "0095_newsletter.sql"), "utf8"))) await admin.query(s);
    const [[n]] = (await admin.query("SELECT COUNT(*) AS c FROM newsletter_subscribers")) as any;
    expect(Number(n.c)).toBe(0);
  });
});
