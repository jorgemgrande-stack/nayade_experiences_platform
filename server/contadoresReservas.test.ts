/**
 * Contadores de reservas del panel (crm.reservations.counters): la consulta cruda con pending_payments usa el nombre
 * REAL de la columna de estado (pp_status). Con «pp.status» fallaba con 500 en todas las empresas y el inicio del
 * panel mostraba «No se ha podido cargar la actividad».
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const src = fs.readFileSync(path.resolve(__dirname, "routers/crm.ts"), "utf8");
const schema = fs.readFileSync(path.resolve(__dirname, "../drizzle/schema.ts"), "utf8");
const baseline = fs.readFileSync(path.resolve(__dirname, "../db/baseline/0000_baseline.sql"), "utf8");

describe("contadores de reservas", () => {
  it("el estado de pending_payments se llama pp_status en el esquema, en la base de las empresas y en la consulta", () => {
    expect(schema).toMatch(/status: mysqlEnum\("pp_status"/);
    const table = baseline.slice(baseline.indexOf("CREATE TABLE IF NOT EXISTS `pending_payments`"));
    expect(table.slice(0, table.indexOf(";"))).toContain("`pp_status`");
    expect(src).toContain("pp.reservation_id = r.id AND pp.pp_status = 'paid'");
    expect(src).not.toMatch(/\bpp\.status\s*=/);
  });
});

describe("panel de una empresa sin WhatsApp contratado", () => {
  it("el aviso de WhatsApp (consulta cada 15 s) solo se monta con la capacidad whatsapp-ai", () => {
    const layout = fs.readFileSync(path.resolve(__dirname, "../client/src/components/AdminLayout.tsx"), "utf8");
    expect(layout).toContain('{subscription.mode !== "loading" && subscription.can("whatsapp-ai") && <WhatsAppNotification />}');
    expect(layout.match(/<WhatsAppNotification \/>/g)).toHaveLength(1);
  });
});
