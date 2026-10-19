/**
 * Paquete de recuperación: los dominios PROPIOS que Railway inyecta (`RAILWAY_SERVICE_*_URL=bigelephant.es`, …) no son
 * secretos; todo lo demás se sigue detectando. Valores de prueba ficticios (ninguna credencial real).
 */
import { describe, it, expect } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { FsBackupStorage } from "./_core/ops/backupStorage";
import { backupKeyringFromEnv } from "./_core/ops/backupCrypto";
import { assertNoSecrets, buildRecoveryPackage, readRecoveryPackage, writeRecoveryPackage } from "./_core/ops/recoveryPackage";

// Valores públicos que Railway inyecta en backup-job cuando los servicios tienen dominio propio (production, 19/10/2026)
const RAILWAY_OWN = {
  RAILWAY_SERVICE_WEB_URL: "bigelephant.es",
  RAILWAY_SERVICE_CRM_URL: "admin.bigelephant.es",
  RAILWAY_SERVICE_CORE_GATEWAY_URL: "app.bigelephant.es",
};
const PKG = {
  tenants: [{ domains: [{ domain: "t1-empresa-demo-elephant-a.app.bigelephant.es" }, { domain: "t1-empresa-demo-elephant-a.up.railway.app" }] }],
  web: "www.bigelephant.es",
  crm: "admin.bigelephant.es",
};
const FAKE_PASSWORD = "contrasena-ficticia-123"; // gitleaks:allow
const FAKE_SECRET = "secreto-ficticio-0000000000"; // gitleaks:allow

describe("paquete de recuperación: dominios propios de Big Elephant", () => {
  it("reproduce el fallo de production: los RAILWAY_SERVICE_*_URL de bigelephant.es ya no abortan el paquete", () => {
    expect(() => assertNoSecrets(PKG, RAILWAY_OWN)).not.toThrow();
  });

  it("RECOVERY_PUBLIC_DOMAINS sustituye la lista por defecto", () => {
    expect(() => assertNoSecrets({ x: "a.otro-dominio.es" }, { RAILWAY_SERVICE_X_URL: "otro-dominio.es", RECOVERY_PUBLIC_DOMAINS: "otro-dominio.es" })).not.toThrow();
    // Con una lista propia, bigelephant.es deja de estar exento
    expect(() => assertNoSecrets(PKG, { ...RAILWAY_OWN, RECOVERY_PUBLIC_DOMAINS: "otro-dominio.es" })).toThrow(/RAILWAY_SERVICE_/);
  });

  it("bajo un nombre de dominio de Railway, lo que no sea exactamente bigelephant.es o un subdominio suyo sigue siendo secreto", () => {
    const camouflaged = [
      "evil-bigelephant.es", // sufijo sin punto
      "bigelephant.es.evil.example", // el dominio como prefijo
      "BIGELEPHANT.ES", // mayúsculas: no es como lo inyecta Railway
      "admin.bigelephant.es/ruta",
      "https://admin.bigelephant.es",
      "u:p@admin.bigelephant.es",
      "admin..bigelephant.es",
      "-x.bigelephant.es",
      "token-largo-ficticio",
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.c2lnbmF0dXJhLWZpY3RpY2lh",
      "abcd1234efgh.ijkl5678mnop",
    ];
    for (const value of camouflaged) {
      expect(() => assertNoSecrets({ x: `antes ${value} después` }, { RAILWAY_SERVICE_X_URL: value }), value).toThrow(/RAILWAY_SERVICE_X_URL/);
    }
  });

  it("el dominio propio solo se exime bajo los nombres de dominio de Railway, no bajo otra variable sensible", () => {
    expect(() => assertNoSecrets({ x: "admin.bigelephant.es" }, { CP_WEBHOOK_URL: "admin.bigelephant.es" })).toThrow(/CP_WEBHOOK_URL/);
    expect(() => assertNoSecrets({ x: "app.bigelephant.es" }, { APP_TOKEN: "app.bigelephant.es" })).toThrow(/APP_TOKEN/);
  });

  it("contraseñas, tokens, claves y cadenas de conexión ficticias se siguen detectando junto a los dominios exentos", () => {
    const env = {
      ...RAILWAY_OWN,
      REGISTRY_ADMIN_DATABASE_URL: `mysql://es_cp:${FAKE_PASSWORD}@mysql.railway.internal:3306/es_registry`,
      BACKUP_S3_SECRET_KEY: FAKE_SECRET,
      BACKUP_KEYS: "bk1:" + Buffer.alloc(32, 9).toString("base64"),
      SUPPORT_JWT_SECRET: "jwt-ficticio-".padEnd(40, "x"),
      BREVO_API_KEY: "xkeysib-ficticia-0000000000000000",
    };
    expect(() => assertNoSecrets({ ...PKG, x: FAKE_PASSWORD }, env)).toThrow(/REGISTRY_ADMIN_DATABASE_URL/);
    expect(() => assertNoSecrets({ ...PKG, x: FAKE_SECRET }, env)).toThrow(/BACKUP_S3_SECRET_KEY/);
    expect(() => assertNoSecrets({ ...PKG, x: Buffer.alloc(32, 9).toString("base64") }, env)).toThrow(/BACKUP_KEYS/);
    expect(() => assertNoSecrets({ ...PKG, x: env.SUPPORT_JWT_SECRET }, env)).toThrow(/SUPPORT_JWT_SECRET/);
    expect(() => assertNoSecrets({ ...PKG, x: env.BREVO_API_KEY }, env)).toThrow(/BREVO_API_KEY/);
    expect(() => assertNoSecrets({ ...PKG, x: "mysql://root:otra-ficticia@admin.bigelephant.es:3306/x" }, RAILWAY_OWN)).toThrow(/credenciales/);
    expect(() => assertNoSecrets({ ...PKG, x: "-----BEGIN OPENSSH PRIVATE KEY-----" }, RAILWAY_OWN)).toThrow(/privada/);
    // Y sin ningún secreto en el paquete, con todas esas variables definidas, se genera
    expect(() => assertNoSecrets(PKG, env)).not.toThrow();
  });

  it("de extremo a extremo: el paquete se genera, se cifra y se lee con los dominios de production, sin secretos", async () => {
    const env = {
      ...RAILWAY_OWN,
      REGISTRY_ADMIN_DATABASE_URL: `mysql://es_cp:${FAKE_PASSWORD}@mysql.railway.internal:3306/es_registry`,
      BACKUP_S3_SECRET_KEY: FAKE_SECRET,
      BACKUP_KEYS: "bk1:" + Buffer.alloc(32, 7).toString("base64"),
      RAILWAY_PROJECT_ID: "00000000-0000-0000-0000-000000000000",
    } as NodeJS.ProcessEnv;
    const ring = backupKeyringFromEnv({ BACKUP_KEYS: `bk1:${crypto.randomBytes(32).toString("base64")}`, BACKUP_ACTIVE_KEY_ID: "bk1" } as NodeJS.ProcessEnv);
    const dir = () => fs.mkdtempSync(path.join(os.tmpdir(), "es-recdom-"));
    const pkg = await buildRecoveryPackage({
      runId: "r1",
      now: Date.parse("2026-10-19T12:00:00Z"),
      env,
      reader: {
        listTenants: async () => [{ id: "t1-empresa-demo-elephant-a", displayName: "Demo A", status: "trial", schemaVersion: "0000_baseline" }] as never,
        getActiveDatabase: async () => ({ serverAlias: "mysql-1", state: "active" }) as never,
        listDomains: async () =>
          [
            { domain: "t1-empresa-demo-elephant-a.app.bigelephant.es", kind: "platform_subdomain", status: "active", isPrimary: false },
            { domain: "t1-empresa-demo-elephant-a.up.railway.app", kind: "platform_subdomain", status: "active", isPrimary: true },
          ] as never,
      },
      registry: { database: "es_registry", schemaVersion: "0012" },
      crm: { configured: true, database: "es_crm" },
      destinations: { primary: new FsBackupStorage(dir()), secondary: null },
      ring,
      retention: { primary: { daily: 30, weekly: 12, monthly: 12 } },
      latest: async () => ({ manifestKey: "tenants/t1/x.manifest.json", createdAt: 1 }),
    });
    const text = JSON.stringify(pkg);
    expect(text).toContain("t1-empresa-demo-elephant-a.app.bigelephant.es");
    for (const s of [FAKE_PASSWORD, FAKE_SECRET, Buffer.alloc(32, 7).toString("base64")]) expect(text).not.toContain(s);
    const st = new FsBackupStorage(dir());
    await writeRecoveryPackage(st, ring, pkg, Date.parse("2026-10-19T12:00:00Z"));
    expect((await readRecoveryPackage(st, ring))?.tenants[0].domains.map((d) => d.domain)).toContain("t1-empresa-demo-elephant-a.app.bigelephant.es");
  });
});
