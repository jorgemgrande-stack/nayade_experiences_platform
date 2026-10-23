/**
 * Buzones IMAP por empresa (tickets del datáfono y justificantes de gastos): cada empresa usa solo su buzón,
 * configurado en su bóveda; sin él, la ingesta no lee nada y nunca usa el buzón del entorno ni el de otra empresa.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { setResolvedCredentials, invalidateCredentials } from "./_core/credentials/cache";
import { getProvider, validateFields, resolveEnvName } from "./_core/credentials/catalog";
import { runWithTenant } from "./_core/tenant";
import { tenantImapConfig } from "./services/imapConfig";

const read = (rel: string) => fs.readFileSync(path.join(__dirname, rel), "utf8");

describe("buzones IMAP de cada empresa", () => {
  beforeEach(() => {
    process.env.TENANT_MODE = "multi";
    // El buzón de la instalación (entorno) nunca debe usarse en multiempresa
    process.env.IMAP_TPV_HOST = "imap.instalacion.example";
    process.env.IMAP_TPV_USER = "buzon@instalacion.example";
    process.env.IMAP_TPV_PASS = "secreto-del-entorno";
  });
  afterEach(() => {
    delete process.env.TENANT_MODE;
    delete process.env.IMAP_TPV_HOST;
    delete process.env.IMAP_TPV_USER;
    delete process.env.IMAP_TPV_PASS;
    invalidateCredentials();
  });

  it("cada empresa lee solo su buzón; sin configurar, ninguno (ni el del entorno)", async () => {
    const a = await runWithTenant("empresa-a", async () => {
      setResolvedCredentials({ imap_tpv: { host: "imap.a.example", user: "tickets@a.example", pass: "pa", allowedSender: "copia@banco.example" } });
      return tenantImapConfig("IMAP_TPV");
    });
    const b = await runWithTenant("empresa-b", async () => {
      setResolvedCredentials({ imap_tpv: { host: "imap.b.example", user: "tickets@b.example", pass: "pb", port: "143", secure: "false", mailbox: "Tickets" } });
      return tenantImapConfig("IMAP_TPV");
    });
    const c = await runWithTenant("empresa-c", async () => {
      setResolvedCredentials({});
      return tenantImapConfig("IMAP_TPV");
    });
    expect(a).toEqual({ host: "imap.a.example", port: 993, secure: true, user: "tickets@a.example", pass: "pa", mailbox: "INBOX", allowedSender: "copia@banco.example" });
    expect(b).toEqual({ host: "imap.b.example", port: 143, secure: false, user: "tickets@b.example", pass: "pb", mailbox: "Tickets", allowedSender: null });
    expect(c).toBeNull();
  });

  it("los buzones son proveedores de la bóveda con validación y contraseña secreta", () => {
    for (const id of ["imap_tpv", "imap_expenses"]) {
      const p = getProvider(id)!;
      expect(p, id).toBeDefined();
      expect(p.fields.find((f) => f.key === "pass")!.secret).toBe(true);
      expect(validateFields(p, { host: "imap.ok.example", port: "993", user: "u@ok.example", pass: "con espacios vale" })).toEqual([]);
      expect(validateFields(p, { host: "mal host", port: "x" }).length).toBe(2);
    }
    expect(resolveEnvName("IMAP_TPV_PASS")).toEqual({ provider: "imap_tpv", field: "pass" });
    expect(resolveEnvName("IMAP_EXPENSE_HOST")).toEqual({ provider: "imap_expenses", field: "host" });
  });

  it("las ingestas usan solo un buzón configurado, sin respaldos fijos de otra instalación", () => {
    const tpv = read("services/emailTpvIngestionService.ts");
    const gastos = read("services/expenseEmailIngestionService.ts");
    expect(tpv).toContain('const cfg: ImapConfig | null = tenantImapConfig("IMAP_TPV");');
    expect(gastos).toContain('const cfg: ImapConfig | null = tenantImapConfig("IMAP_EXPENSE");');
    for (const src of [tpv, gastos]) expect(src).not.toMatch(/skicenter|dinaserver/);
  });
});
