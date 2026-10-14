/**
 * Cifrado de campo de credenciales heredadas: formato, compatibilidad, corrupción,
 * migración idempotente/reanudable/concurrente y reversión. Sin valores en informes ni errores.
 */
import { describe, it, expect, vi } from "vitest";
import crypto from "node:crypto";
import {
  LegacyCryptoError,
  decryptLegacy,
  encryptLegacy,
  isLegacyEncrypted,
  protectLegacySecret,
  revealLegacySecret,
} from "./_core/credentials/legacyFields";
import { applyLegacyEncryption, planLegacyCredentials, rollbackLegacyEncryption } from "./_core/credentials/legacyMigration";
import type { Keyring } from "./_core/credentials/vault";

const k1 = crypto.randomBytes(32);
const k2 = crypto.randomBytes(32);
const ring = (active: "k1" | "k2" = "k1"): Keyring => ({ keys: new Map([["k1", k1], ["k2", k2]]), activeId: active });
const envFor = (active = "k1"): NodeJS.ProcessEnv => ({
  INTEGRATION_KEYS: `k1:${k1.toString("base64")},k2:${k2.toString("base64")}`,
  INTEGRATION_ACTIVE_KEY_ID: active,
  LEGACY_CREDENTIALS_ENCRYPT: "on",
});

const SECRET = "ghl-secret-SUPER-VALUE-12345";

/** Pool mínimo en memoria que entiende las consultas del migrador. */
function fakePool(seed: Record<string, string | null>) {
  const data = new Map<string, string | null>(Object.entries(seed)); // "tabla.clave" → valor
  const audit: unknown[][] = [];
  let failUpdates = 0;
  return {
    data,
    audit,
    failNextUpdates(n: number) {
      failUpdates = n;
    },
    async query(sql: string, args: unknown[] = []): Promise<any> {
      const table = /`(system_settings|site_settings)`/.exec(sql)?.[1];
      if (sql.startsWith("SELECT")) {
        const k = `${table}.${args[0]}`;
        return [data.has(k) ? [{ value: data.get(k) }] : [], []];
      }
      if (sql.startsWith("UPDATE")) {
        if (failUpdates > 0) {
          failUpdates--;
          throw new Error("db caída");
        }
        const [to, key, from] = args as string[];
        const k = `${table}.${key}`;
        if (data.get(k) === from) {
          data.set(k, to);
          return [{ affectedRows: 1 }, []];
        }
        return [{ affectedRows: 0 }, []];
      }
      if (sql.startsWith("INSERT INTO legacy_credential_audit")) {
        audit.push(args);
        return [{}, []];
      }
      return [{}, []]; // CREATE TABLE
    },
  };
}

describe("formato y compatibilidad", () => {
  it("cifra con AES-256-GCM versionado y descifra; AAD ata el valor a su tabla y clave", () => {
    const enc = encryptLegacy(SECRET, "system_settings", "site_ghl_api_key", ring());
    expect(enc.startsWith("enc:v1:k1:")).toBe(true);
    expect(enc).not.toContain(SECRET);
    expect(decryptLegacy(enc, "system_settings", "site_ghl_api_key", ring())).toBe(SECRET);
    expect(() => decryptLegacy(enc, "site_settings", "site_ghl_api_key", ring())).toThrow(LegacyCryptoError);
    expect(() => decryptLegacy(enc, "system_settings", "otra_clave", ring())).toThrow(LegacyCryptoError);
    expect(encryptLegacy(SECRET, "system_settings", "site_ghl_api_key", ring())).not.toBe(enc); // IV aleatorio
  });

  it("lee heredados en claro sin tocarlos y falla cerrado sin clave", () => {
    expect(decryptLegacy(SECRET, "site_settings", "ghlApiKey", null)).toBe(SECRET);
    expect(revealLegacySecret("site_settings", "ghlApiKey", SECRET, {})).toBe(SECRET);
    const enc = encryptLegacy(SECRET, "site_settings", "ghlApiKey", ring());
    expect(revealLegacySecret("site_settings", "ghlApiKey", enc, {})).toBe(""); // sin claves → vacío, nunca el ciphertext
    expect(revealLegacySecret("site_settings", "ghlApiKey", enc, envFor())).toBe(SECRET);
    expect(revealLegacySecret("site_settings", "ghlApiKey", null, envFor())).toBe("");
  });

  it("rotación de clave: lo cifrado con k1 se lee con k1 aunque la activa sea k2", () => {
    const enc = encryptLegacy(SECRET, "site_settings", "ghlApiKey", ring("k1"));
    expect(decryptLegacy(enc, "site_settings", "ghlApiKey", ring("k2"))).toBe(SECRET);
    expect(encryptLegacy(SECRET, "site_settings", "ghlApiKey", ring("k2")).startsWith("enc:v1:k2:")).toBe(true);
  });

  it("corrupción y clave desconocida se detectan sin filtrar el valor", () => {
    const enc = encryptLegacy(SECRET, "site_settings", "ghlApiKey", ring());
    const parts = enc.split(":");
    const raw = Buffer.from(parts[3], "base64");
    raw[raw.length - 1] ^= 0xff;
    const tampered = [...parts.slice(0, 3), raw.toString("base64")].join(":");
    for (const bad of [tampered, "enc:v1:k1:", "enc:v1:k1:AAAA", "enc:v1:zz:" + parts[3], "enc:v1:sinseparador"]) {
      try {
        decryptLegacy(bad, "site_settings", "ghlApiKey", ring());
        throw new Error("debía fallar");
      } catch (e) {
        expect(e).toBeInstanceOf(LegacyCryptoError);
        expect(String((e as Error).message)).not.toContain(SECRET);
      }
    }
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(revealLegacySecret("site_settings", "ghlApiKey", tampered, envFor())).toBe("");
    expect(JSON.stringify(spy.mock.calls)).not.toContain(SECRET);
    spy.mockRestore();
  });

  it("protectLegacySecret solo cifra con la bandera activa y con claves", () => {
    expect(protectLegacySecret("site_settings", "ghlApiKey", SECRET, {})).toBe(SECRET);
    expect(protectLegacySecret("site_settings", "ghlApiKey", SECRET, { ...envFor(), LEGACY_CREDENTIALS_ENCRYPT: "off" })).toBe(SECRET);
    const p = protectLegacySecret("site_settings", "ghlApiKey", SECRET, envFor());
    expect(isLegacyEncrypted(p)).toBe(true);
    expect(protectLegacySecret("site_settings", "ghlApiKey", p, envFor())).toBe(p); // no doble cifrado
    expect(protectLegacySecret("site_settings", "ghlApiKey", "", envFor())).toBe("");
  });
});

describe("migración", () => {
  const seed = () => ({
    "system_settings.site_ghl_api_key": SECRET,
    "site_settings.ghlApiKey": "otra-clave-123456",
    "site_settings.ghlInboxToken": "",
    // ghlInboxWebhookSecret ausente
  });

  it("simulacro por defecto: no escribe nada y no revela valores", async () => {
    const pool = fakePool(seed());
    const rep = await applyLegacyEncryption(pool as any, { ring: ring(), actor: "op" });
    expect(rep.dryRun).toBe(true);
    expect(rep.summary.encrypted).toBe(2);
    expect(pool.data.get("system_settings.site_ghl_api_key")).toBe(SECRET);
    expect(JSON.stringify(rep)).not.toContain(SECRET);
  });

  it("aplica, es idempotente y deja todo verificable", async () => {
    const pool = fakePool(seed());
    const first = await applyLegacyEncryption(pool as any, { ring: ring(), actor: "op", dryRun: false, persistAudit: true });
    expect(first.summary).toMatchObject({ encrypted: 2, skipped: 2, error: 0, conflict: 0 });
    const stored = pool.data.get("system_settings.site_ghl_api_key")!;
    expect(isLegacyEncrypted(stored)).toBe(true);
    expect(decryptLegacy(stored, "system_settings", "site_ghl_api_key", ring())).toBe(SECRET);
    expect(pool.data.get("site_settings.ghlInboxToken")).toBe(""); // vacío intacto
    expect(pool.audit.length).toBe(2);
    expect(JSON.stringify(pool.audit)).not.toContain(SECRET);

    const again = await applyLegacyEncryption(pool as any, { ring: ring(), actor: "op", dryRun: false });
    expect(again.summary.encrypted).toBe(0);
    expect(pool.data.get("system_settings.site_ghl_api_key")).toBe(stored); // sin cambios

    const plan = await planLegacyCredentials(pool as any, ring());
    expect(plan.find((p) => p.key === "site_ghl_api_key")?.state).toBe("encrypted");
    expect(plan.find((p) => p.key === "ghlInboxToken")?.state).toBe("empty");
    expect(plan.find((p) => p.key === "ghlInboxWebhookSecret")?.state).toBe("absent");
  });

  it("reanudable: un fallo parcial se completa en la siguiente ejecución", async () => {
    const pool = fakePool(seed());
    pool.failNextUpdates(1);
    const r1 = await applyLegacyEncryption(pool as any, { ring: ring(), actor: "op", dryRun: false });
    expect(r1.summary).toMatchObject({ encrypted: 1, error: 1 });
    expect(r1.entries.find((e) => e.action === "error")?.code).toBe("db_error");
    const r2 = await applyLegacyEncryption(pool as any, { ring: ring(), actor: "op", dryRun: false });
    expect(r2.summary).toMatchObject({ encrypted: 1, error: 0 });
    const plan = await planLegacyCredentials(pool as any, ring());
    expect(plan.filter((p) => p.state === "plaintext")).toHaveLength(0);
  });

  it("concurrencia: si el valor cambió entre lectura y escritura no se pisa", async () => {
    const pool = fakePool(seed());
    const orig = pool.query.bind(pool);
    let raced = false;
    (pool as any).query = async (sql: string, args: unknown[]) => {
      if (sql.startsWith("UPDATE") && !raced) {
        raced = true;
        pool.data.set("system_settings.site_ghl_api_key", "rotada-por-el-admin"); // cambio concurrente
      }
      return orig(sql, args);
    };
    const rep = await applyLegacyEncryption(pool as any, { ring: ring(), actor: "op", dryRun: false });
    expect(rep.summary.conflict).toBe(1);
    expect(pool.data.get("system_settings.site_ghl_api_key")).toBe("rotada-por-el-admin");
  });

  it("recuperación: la reversión restaura el texto plano y es idempotente", async () => {
    const pool = fakePool(seed());
    await applyLegacyEncryption(pool as any, { ring: ring(), actor: "op", dryRun: false });
    const dry = await rollbackLegacyEncryption(pool as any, { ring: ring(), actor: "op" });
    expect(dry.dryRun).toBe(true);
    expect(isLegacyEncrypted(pool.data.get("system_settings.site_ghl_api_key"))).toBe(true);
    const rb = await rollbackLegacyEncryption(pool as any, { ring: ring(), actor: "op", dryRun: false });
    expect(rb.summary.restored).toBe(2);
    expect(pool.data.get("system_settings.site_ghl_api_key")).toBe(SECRET);
    expect((await rollbackLegacyEncryption(pool as any, { ring: ring(), actor: "op", dryRun: false })).summary.restored).toBe(0);
  });

  it("valor cifrado corrupto: marcado como error y no se toca; sin clave el plan lo ve ilegible", async () => {
    const pool = fakePool({ "system_settings.site_ghl_api_key": "enc:v1:k1:AAAA" });
    const rb = await rollbackLegacyEncryption(pool as any, { ring: ring(), actor: "op", dryRun: false });
    expect(rb.summary.error).toBe(1);
    expect(rb.entries.find((e) => e.action === "error")?.code).toBe("corrupt");
    expect(pool.data.get("system_settings.site_ghl_api_key")).toBe("enc:v1:k1:AAAA");
    const plan = await planLegacyCredentials(pool as any, null);
    expect(plan.find((p) => p.key === "site_ghl_api_key")?.state).toBe("unreadable");
  });
});
