/**
 * Las ingestas IMAP (TPV y gastos) tienen un buzón GLOBAL en el entorno (instalación de una sola empresa). En
 * multiempresa nunca se usa: cada empresa configura el suyo en su bóveda (ver tenantImapConfig.test.ts). Sin él, la
 * ingesta no abre ninguna conexión IMAP aunque el entorno tenga credenciales.
 */
import { describe, it, expect, afterEach, vi } from "vitest";

const imap = vi.hoisted(() => {
  process.env.IMAP_TPV_PASS = "clave-imap-global-de-prueba";
  process.env.IMAP_EXPENSE_PASS = "clave-imap-global-de-prueba";
  return { created: 0 };
});
vi.mock("imapflow", () => ({
  ImapFlow: class {
    constructor() {
      imap.created++;
      throw new Error("conexión IMAP simulada");
    }
  },
}));

import { runEmailIngestion } from "./services/emailTpvIngestionService";
import { runExpenseEmailIngestion } from "./services/expenseEmailIngestionService";
import { withTenantDb, setConnectionResolver, closeAllDatabases } from "./_core/dbRegistry";

afterEach(async () => {
  delete process.env.TENANT_MODE;
  setConnectionResolver(null);
  await closeAllDatabases();
});

describe("ingesta IMAP con credenciales globales en multiempresa", () => {
  it("TPV: en multi sin buzón propio no se ejecuta (ni con el buzón del entorno ni con el pool precargado)", async () => {
    process.env.TENANT_MODE = "multi";
    setConnectionResolver((id) => `mysql://u:p@127.0.0.1:1/db_${id}`);
    const r = await withTenantDb("empresa-b", () => runEmailIngestion(false));
    expect(r.errors).toEqual([]);
    expect(r.operationsInserted).toBe(0);
    expect(imap.created).toBe(0);
  });

  it("gastos: en multi sin buzón propio no se ejecuta", async () => {
    process.env.TENANT_MODE = "multi";
    setConnectionResolver((id) => `mysql://u:p@127.0.0.1:1/db_${id}`);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const r = await withTenantDb("empresa-b", () => runExpenseEmailIngestion());
    expect(r).toEqual({ processed: 0, duplicated: 0, errors: 0 });
    expect(imap.created).toBe(0);
    warn.mockRestore();
  });

  it("single: la guarda no interviene (Náyade sigue igual)", async () => {
    const r = await runEmailIngestion(false).catch((e) => ({ errors: [String(e)] }));
    expect(JSON.stringify(r)).not.toMatch(/multiempresa/);
    expect(imap.created).toBeGreaterThan(0); // intenta conectar, como hoy
  });
});
