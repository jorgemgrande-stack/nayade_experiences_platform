/**
 * Tickets de soporte contra MySQL real (opt-in con REGISTRY_TEST_DATABASE_URL; ejecutar en serie).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";
import { MysqlTicketStore, TicketService } from "./_core/support/tickets";

const url = process.env.REGISTRY_TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

d("tickets de soporte (MySQL)", () => {
  let pool: mysql.Pool;
  let svc: TicketService;

  beforeAll(async () => {
    pool = mysql.createPool({ uri: url!, multipleStatements: true, connectionLimit: 2 });
    await pool.query("DROP TABLE IF EXISTS support_ticket_events, support_tickets");
    await pool.query("CREATE TABLE IF NOT EXISTS registry_meta (k VARCHAR(64) PRIMARY KEY, v VARCHAR(255) NOT NULL)");
    await pool.query("INSERT IGNORE INTO registry_meta (k, v) VALUES ('schema_version', '0000')");
    const sql = fs.readFileSync(path.resolve(__dirname, "../db/registry/0006_support_tickets.sql"), "utf8");
    await pool.query(sql);
    svc = new TicketService(new MysqlTicketStore(pool), async (t) => t === "acme" || t === "beta");
  });

  afterAll(async () => {
    await pool?.query("DROP TABLE IF EXISTS support_ticket_events, support_tickets");
    await pool?.end();
  });

  it("migración idempotente, ciclo, historial, filtros y aislamiento", async () => {
    const sql = fs.readFileSync(path.resolve(__dirname, "../db/registry/0006_support_tickets.sql"), "utf8");
    await pool.query(sql); // segunda ejecución sin error

    const a = await svc.create({ tenantId: "acme", title: "Caída del panel", description: "No abre", priority: "high" }, "crm:agent");
    const b = await svc.create({ tenantId: "beta", title: "Factura", description: "Duplicada 100%_x" }, "crm:agent");
    await svc.assign(a.id, "marta", "crm:agent");
    await svc.setStatus(a.id, "in_progress", "crm:agent");
    await svc.comment(a.id, "Investigando", "crm:agent", { internal: true });
    await svc.setStatus(a.id, "resolved", "crm:agent", "Resuelto");

    const detail = await svc.get(a.id);
    expect(detail.ticket).toMatchObject({ status: "resolved", assignee: "marta" });
    expect(detail.ticket.resolvedAt).toBeTypeOf("number");
    expect(detail.events.map((e) => e.kind)).toEqual(["created", "assignee", "status", "comment", "status"]);
    expect(detail.events[3].internal).toBe(true);

    const acme = await svc.list({ tenantId: "acme" });
    expect(acme.items.map((t) => t.id)).toEqual([a.id]);
    expect(acme.total).toBe(1);
    await expect(svc.get(b.id, { tenantId: "acme" })).rejects.toMatchObject({ code: "not_found" });
    // los comodines LIKE se escapan: "%" no coincide con todo
    expect((await svc.list({ q: "100%_x" })).items.map((t) => t.id)).toEqual([b.id]);
    expect((await svc.list({ q: "%" })).total).toBe(1);
    await expect(svc.create({ tenantId: "nope", title: "x", description: "y" }, "crm:agent")).rejects.toMatchObject({ code: "not_found" });
  });
});
