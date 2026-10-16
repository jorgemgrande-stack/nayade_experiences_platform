/**
 * Marca y URL por empresa con la aplicación REAL sobre MySQL (opt-in, REGISTRY_TEST_DATABASE_URL): dos
 * empresas ficticias aprovisionadas desde la baseline («Montaña Ejemplo SL» y «Costa Ejemplo SL»), con el
 * montaje real del registro (`installTenantResolution` + `installTenantBinding`).
 *  - Marca, URL pública, comunicaciones e identidad fiscal correctas por host.
 *  - Un dominio propio no verificado no se usa (ni se sirve); verificado con un resolvedor DNS FALSO, sí.
 *  - Factura y correo con la identidad fiscal y la marca de cada empresa; sin restos de otra instalación.
 *  - Sin cruces con peticiones concurrentes intercaladas.
 * El modo single (sin cambios) se prueba en `tenantIdentity.test.ts`.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import crypto from "node:crypto";
import http from "node:http";
import path from "node:path";
import type { AddressInfo } from "node:net";
import express from "express";
import mysql from "mysql2/promise";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
const run = crypto.randomBytes(3).toString("hex");
const REG_DB = `marca_reg_${run}`;
const TARGET = "edge.elephantsource.example";
const OP = { type: "operator" as const, id: "prueba" };
const LEFTOVERS = /skicenter|n[aá]yade|iron elephant|B26987875|639 57 66 27/i;

const COMPANIES = {
  montana: { id: `mon-${run}`, name: "Montaña Ejemplo SL", custom: `montana-${run}.example`, taxId: "B00000001", address: "Calle Cumbre 1, 00001 Pico" },
  costa: { id: `cos-${run}`, name: "Costa Ejemplo SL", custom: `costa-${run}.example`, taxId: "B00000002", address: "Paseo Playa 2, 00002 Arena" },
} as const;
const platformHost = (k: keyof typeof COMPANIES) => `${COMPANIES[k].id}.elephantsource.es`;

describe.skipIf(!URL_)("marca y URL por empresa (aplicación real, dos empresas)", () => {
  let admin: mysql.Pool;
  let regPool: mysql.Pool;
  let server: http.Server;
  let port: number;
  let svc: import("./_core/tenantRegistry/service").TenantRegistryService;
  let store: import("./_core/tenantRegistry/mysqlStore").MysqlTenantRegistryStore;
  let rt: import("./_core/tenantRegistry/runtime").TenantRuntime;
  let invalidate: (id: string) => void;
  let closeAll: () => Promise<void>;

  function get(host: string, p = "/__marca") {
    return new Promise<{ status: number; json: any }>((resolve, reject) => {
      const req = http.request({ host: "127.0.0.1", port, path: p, method: "GET", headers: { host } }, (res) => {
        let b = "";
        res.on("data", (c) => (b += c));
        res.on("end", () => {
          let json: any = null;
          try {
            json = JSON.parse(b);
          } catch {
            /* texto */
          }
          resolve({ status: res.statusCode ?? 0, json });
        });
      });
      req.on("error", reject);
      req.end();
    });
  }
  const marca = async (host: string) => {
    const r = await get(host);
    if (r.status !== 200) throw new Error(`${host}: ${r.status}`);
    return r.json;
  };
  /** Cambios en el registro: el sondeo de versiones lo haría en ≤15 s; aquí, ya. */
  const refresh = (k: keyof typeof COMPANIES) => {
    invalidate(COMPANIES[k].id);
    rt.resolver.invalidateTenant(COMPANIES[k].id);
    rt.resolver.invalidateDomain(COMPANIES[k].custom);
  };

  beforeAll(async () => {
    const u = new URL(URL_!);
    const regUrl = new URL(URL_!);
    regUrl.pathname = `/${REG_DB}`;
    process.env.TENANT_MODE = "multi";
    process.env.REGISTRY_DATABASE_URL = regUrl.toString();
    process.env.REGISTRY_KEYS = `k1:${crypto.randomBytes(32).toString("base64")}`;
    process.env.REGISTRY_ACTIVE_KEY_ID = "k1";
    process.env.INTEGRATION_KEYS = `ik1:${crypto.randomBytes(32).toString("base64")}`;
    process.env.INTEGRATION_ACTIVE_KEY_ID = "ik1";
    process.env.JWT_SECRET = "jwt-secret-de-prueba-" + run;
    process.env.DATABASE_URL = "mysql://nadie:nada@127.0.0.1:1/no_debe_usarse";
    process.env.APP_URL = "https://instalacion-unica.example"; // no debe aparecer en ninguna empresa
    delete process.env.SUPPORT_JWT_SECRET;

    admin = mysql.createPool({ uri: URL_!, multipleStatements: true, connectionLimit: 6 });
    await admin.query(`CREATE DATABASE ${REG_DB} CHARACTER SET utf8mb4`);
    regPool = mysql.createPool({ uri: regUrl.toString(), multipleStatements: true, connectionLimit: 6 });
    const { migrateRegistry } = await import("./_core/tenantRegistry/migrate");
    const mig = await migrateRegistry(regPool, path.resolve(__dirname, "../db/registry"), { dryRun: false });
    expect(mig.applied).toEqual(expect.arrayContaining(["0000", "0009"]));

    const { MysqlTenantRegistryStore } = await import("./_core/tenantRegistry/mysqlStore");
    const { TenantRegistryService } = await import("./_core/tenantRegistry/service");
    const { keyringFromEnv } = await import("./_core/tenantRegistry/crypto");
    const { ProvisioningService } = await import("./_core/provisioning/service");
    const prov = await import("./_core/provisioning/mysqlAdapters");
    const { EntitlementAdmin } = await import("./_core/modules/mysqlEntitlements");
    const { QuotaAdmin } = await import("./_core/erm/mysqlQuotas");
    const { MysqlOrganizationStore } = await import("./organization/service");
    store = new MysqlTenantRegistryStore(regPool);
    svc = new TenantRegistryService(store, () => keyringFromEnv(process.env));
    const p = new ProvisioningService({
      registry: svc,
      reader: store,
      databases: new prov.MysqlDatabaseProvisioner(admin, { host: u.hostname, port: Number(u.port || 3306) }),
      schema: new prov.MysqlSchemaApplier({ baselinePath: path.resolve(__dirname, "../db/baseline/0000_baseline.sql"), migrationsDir: path.resolve(__dirname, "../db/migrations") }),
      seeder: new prov.MysqlTenantSeeder(),
      entitlements: new EntitlementAdmin(regPool),
      quotas: new QuotaAdmin(regPool),
      store: new prov.MysqlProvisioningStore(regPool),
    });
    const org = new MysqlOrganizationStore(regPool);
    const now = Date.now();
    for (const c of Object.values(COMPANIES)) {
      const r = await p.run({ tenantId: c.id, displayName: c.name, adminEmail: `admin@${c.id}.example`, platformDomain: "elephantsource.es" }, OP);
      expect(r.status).toBe("completed");
      await svc.addDomain(c.id, c.custom, "custom", OP);
      await org.insertFiscalEntity({ tenantId: c.id, entityId: "principal", legalName: c.name, taxId: c.taxId, country: "ES", address: c.address, isDefault: true, status: "active", createdAt: now, createdBy: "prueba", updatedAt: now });
    }
    // Ajustes propios de cada empresa (en SU base): Montaña con marca y remitente; Costa sin marca
    const settings = async (id: string, sys: Record<string, string>, site: Record<string, string>) => {
      const conn = await mysql.createConnection({ uri: (await svc.getActiveDsn(id))! });
      for (const [k, v] of Object.entries(sys)) {
        await conn.query("INSERT INTO system_settings (`key`, value, category, label) VALUES (?, ?, 'brand', ?) ON DUPLICATE KEY UPDATE value = VALUES(value)", [k, v, k]);
      }
      if (!sys.brand_name) await conn.query("DELETE FROM system_settings WHERE `key` = 'brand_name'");
      for (const [k, v] of Object.entries(site)) {
        await conn.query("INSERT INTO site_settings (`key`, value, type, updatedAt) VALUES (?, ?, 'text', NOW()) ON DUPLICATE KEY UPDATE value = VALUES(value)", [k, v]);
      }
      await conn.end();
    };
    await settings(
      COMPANIES.montana.id,
      { brand_name: "Montaña Ejemplo", brand_logo_url: "https://cdn.montana.example/logo.png", email_from_address: "hola@montana.example", email_from_name: "Reservas Montaña", email_reply_to: "reservas@montana.example" },
      { legalCompanyEmail: "facturas@montana.example", legalCompanyIban: "ES0000000000000000000001" },
    );
    await settings(COMPANIES.costa.id, {}, { legalCompanyEmail: "facturas@costa.example" });

    const { installTenantResolution, installTenantBinding } = await import("./_core/tenantRegistry/install");
    const { publicBaseUrl } = await import("./_core/productIdentity");
    const { peekTenantIdentity, invalidateTenantIdentity } = await import("./_core/tenantIdentity");
    const { brandName, tenantCommsConfig } = await import("./tenantBrand");
    const { getLegalCompanySettings, buildInvoiceHtml } = await import("./invoiceHtml");
    const { buildPasswordResetHtml, buildReservationConfirmHtml } = await import("./emailTemplates");
    const { closeAllDatabases } = await import("./_core/dbRegistry");
    invalidate = invalidateTenantIdentity;

    const app = express();
    rt = installTenantResolution(app, process.env)!;
    app.use(express.json());
    installTenantBinding(app);
    app.get("/__marca", async (_req, res) => {
      const legal = await getLegalCompanySettings();
      const invoice = await buildInvoiceHtml({
        invoiceNumber: "FAC-PRUEBA-0001",
        clientName: "Cliente Prueba",
        clientEmail: "cliente@prueba.example",
        itemsJson: [{ description: "Actividad", quantity: 1, unitPrice: 121, total: 121, taxRate: 21 }],
        subtotal: "100.00",
        taxRate: "21",
        taxAmount: "21.00",
        total: "121.00",
        issuedAt: new Date(),
      });
      const email = buildPasswordResetHtml({ name: "Ana", resetUrl: `${publicBaseUrl()}/nueva-contrasena?token=x`, expiryMinutes: 60 });
      const confirm = buildReservationConfirmHtml({ merchantOrder: "R-1", productName: "Actividad", customerName: "Ana", date: "1 de enero", people: 2, amount: "44,00 €" });
      res.json({ url: publicBaseUrl(), brand: brandName(), comms: tenantCommsConfig(), legal, invoice, email, confirm, domains: peekTenantIdentity()?.customDomains });
    });
    server = http.createServer(app);
    await new Promise<void>((res) => server.listen(0, "127.0.0.1", res));
    port = (server.address() as AddressInfo).port;
    closeAll = async () => {
      server.closeAllConnections();
      await new Promise<void>((res) => server.close(() => res()));
      await closeAllDatabases();
      await rt.close();
    };
  }, 300_000);

  afterAll(async () => {
    await closeAll?.();
    await regPool?.end();
    // El contenedor de pruebas es desechable: las BD de las empresas de prueba (id aleatorio) no se reutilizan
    await admin?.end();
  });

  it("antes de verificar: subdominio de plataforma; el dominio propio pendiente no se sirve ni se usa", async () => {
    const m = await marca(platformHost("montana"));
    expect(m.url).toBe(`https://${platformHost("montana")}`);
    expect(m.domains).toEqual([{ domain: COMPANIES.montana.custom, state: "pending", isPrimary: false }]);
    expect((await get(COMPANIES.montana.custom)).status).toBe(404);
    expect(JSON.stringify(m)).not.toContain("instalacion-unica.example");
  });

  it("marca, comunicaciones e identidad fiscal de cada empresa por host", async () => {
    const m = await marca(platformHost("montana"));
    const c = await marca(platformHost("costa"));
    expect(m.brand).toBe("Montaña Ejemplo");
    expect(c.brand).toBe("Costa Ejemplo SL"); // sin ajuste: el nombre del registro
    expect(m.comms).toEqual({ fromEmail: "hola@montana.example", fromName: "Reservas Montaña", replyTo: "reservas@montana.example" });
    expect(c.comms.fromName).toBe("Costa Ejemplo SL");
    expect(m.legal).toMatchObject({ name: "Montaña Ejemplo SL", cif: "B00000001", address: COMPANIES.montana.address, email: "facturas@montana.example" });
    expect(c.legal).toMatchObject({ name: "Costa Ejemplo SL", cif: "B00000002", address: COMPANIES.costa.address, email: "facturas@costa.example", iban: "" });

    // Factura: emisor de cada empresa, sin la otra ni restos de la instalación histórica
    expect(m.invoice).toContain("Montaña Ejemplo SL");
    expect(m.invoice).toContain("CIF: B00000001");
    expect(m.invoice).toContain("https://cdn.montana.example/logo.png");
    expect(m.invoice).not.toContain("Costa Ejemplo");
    expect(c.invoice).toContain("Costa Ejemplo SL");
    expect(c.invoice).toContain("CIF: B00000002");
    expect(c.invoice).not.toContain("Montaña");
    for (const doc of [m.invoice, c.invoice, m.email, c.email, m.confirm, c.confirm]) expect(doc).not.toMatch(LEFTOVERS);
    expect(m.confirm).toContain("https://cdn.montana.example/logo.png");
    expect(c.confirm).not.toContain("montana");
    // Correo transaccional con el enlace a la URL de la empresa
    expect(m.email).toContain(`https://${platformHost("montana")}/nueva-contrasena`);
    expect(c.email).toContain(`https://${platformHost("costa")}/nueva-contrasena`);
  });

  it("verificación con resolvedor DNS falso: Costa falla (no se usa), Montaña se verifica y pasa a ser su URL", async () => {
    const { verifyAndRecordDomain, expectedTxtValue, VERIFY_LABEL } = await import("./_core/tenantRegistry/domainVerification");
    const fake = (txt: Record<string, string>, cname: Record<string, string>) => ({
      resolveCname: async (h: string) => (cname[h] ? [cname[h]] : Promise.reject(new Error("ENODATA"))),
      resolveTxt: async (h: string) => (txt[h] ? [[txt[h]]] : Promise.reject(new Error("ENODATA"))),
    });
    const mToken = (await store.resolveDomain(COMPANIES.montana.custom))!.domain.verificationToken!;
    const cToken = (await store.resolveDomain(COMPANIES.costa.custom))!.domain.verificationToken!;
    const dns = fake(
      { [`${VERIFY_LABEL}.${COMPANIES.montana.custom}`]: expectedTxtValue(mToken), [`${VERIFY_LABEL}.${COMPANIES.costa.custom}`]: expectedTxtValue(mToken) /* el de otra empresa */ },
      { [COMPANIES.montana.custom]: TARGET, [COMPANIES.costa.custom]: TARGET },
    );
    expect((await verifyAndRecordDomain({ reader: store, service: svc }, { domain: COMPANIES.costa.custom, platformTarget: TARGET }, OP, dns))?.ok).toBe(false);
    expect((await verifyAndRecordDomain({ reader: store, service: svc }, { domain: COMPANIES.montana.custom, platformTarget: TARGET }, OP, dns))?.ok).toBe(true);
    expect(JSON.stringify(await store.listEvents(COMPANIES.costa.id))).not.toContain(cToken);
    await svc.activateDomain(COMPANIES.montana.custom, OP);
    await svc.setPrimaryDomain(COMPANIES.montana.id, COMPANIES.montana.custom, OP);
    refresh("montana");
    refresh("costa");

    const m = await marca(COMPANIES.montana.custom);
    expect(m.url).toBe(`https://${COMPANIES.montana.custom}`);
    expect(m.domains).toEqual([{ domain: COMPANIES.montana.custom, state: "verified", isPrimary: true }]);
    expect(m.email).toContain(`https://${COMPANIES.montana.custom}/nueva-contrasena`);
    expect((await marca(platformHost("montana"))).url).toBe(`https://${COMPANIES.montana.custom}`);

    const c = await marca(platformHost("costa"));
    expect(c.url).toBe(`https://${platformHost("costa")}`);
    expect(c.domains).toEqual([{ domain: COMPANIES.costa.custom, state: "failed", isPrimary: false }]);
    expect((await get(COMPANIES.costa.custom)).status).toBe(404);
  });

  it("sin cruces con peticiones concurrentes intercaladas", async () => {
    const hosts = Array.from({ length: 40 }, (_, i) => (i % 2 ? COMPANIES.montana.custom : platformHost("costa")));
    const out = await Promise.all(hosts.map(async (h) => ({ h, r: await marca(h) })));
    for (const { h, r } of out) {
      if (h === COMPANIES.montana.custom) {
        expect(r.url).toBe(`https://${COMPANIES.montana.custom}`);
        expect(r.legal.cif).toBe("B00000001");
        expect(r.brand).toBe("Montaña Ejemplo");
        expect(r.invoice).not.toContain("Costa Ejemplo");
      } else {
        expect(r.url).toBe(`https://${platformHost("costa")}`);
        expect(r.legal.cif).toBe("B00000002");
        expect(r.brand).toBe("Costa Ejemplo SL");
        expect(r.invoice).not.toContain("Montaña");
        expect(JSON.stringify(r)).not.toContain(COMPANIES.montana.custom);
      }
    }
  });
});
