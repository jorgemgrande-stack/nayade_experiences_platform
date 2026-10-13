/**
 * Bóveda de credenciales por tenant: cifrado ligado a tenant/campo, validación, máscara,
 * ausencia de secretos en claro, pruebas de proveedor y sustitución de variables de entorno.
 */
import { describe, it, expect, afterEach } from "vitest";
import crypto from "node:crypto";
import { IntegrationVault, MemoryCredentialStore, decryptValue, encryptValue, keyringFromEnv, mask } from "./_core/credentials/vault";
import { resolveEnvName, validateFields, getProvider } from "./_core/credentials/catalog";
import { testProvider } from "./_core/credentials/testers";
import { setResolvedCredentials, invalidateCredentials } from "./_core/credentials/cache";
import { integrationEnv } from "./_core/tenantConfig";
import { runWithTenant } from "./_core/tenant";

const ring = keyringFromEnv({
  INTEGRATION_KEYS: `k1:${crypto.randomBytes(32).toString("base64")}`,
  INTEGRATION_ACTIVE_KEY_ID: "k1",
} as NodeJS.ProcessEnv)!;

afterEach(() => {
  delete process.env.TENANT_MODE;
  delete process.env.GHL_API_KEY;
  invalidateCredentials();
});

describe("cifrado", () => {
  it("ida y vuelta; el AAD impide moverlo a otro tenant o campo", () => {
    const e = encryptValue("sk-secreto-123456", "acme", "ghl", "apiKey", ring);
    expect(e.cipher).not.toContain("secreto");
    expect(decryptValue(e.cipher, e.keyId, "acme", "ghl", "apiKey", ring)).toBe("sk-secreto-123456");
    expect(() => decryptValue(e.cipher, e.keyId, "otro", "ghl", "apiKey", ring)).toThrow();
    expect(() => decryptValue(e.cipher, e.keyId, "acme", "ghl", "inboxToken", ring)).toThrow();
  });

  it("keyringFromEnv exige 32 bytes y clave activa", () => {
    expect(keyringFromEnv({ INTEGRATION_KEYS: "k1:abc", INTEGRATION_ACTIVE_KEY_ID: "k1" } as NodeJS.ProcessEnv)).toBeNull();
    expect(keyringFromEnv({} as NodeJS.ProcessEnv)).toBeNull();
  });
});

describe("bóveda", () => {
  const mk = (tenant = "acme", r: typeof ring | null = ring) => {
    const store = new MemoryCredentialStore();
    return { store, vault: new IntegrationVault(store, () => tenant, () => r) };
  };

  it("guarda secretos cifrados y nunca los devuelve en el estado", async () => {
    const { store, vault } = mk();
    await vault.save("ghl", { apiKey: "ghl-super-secreta-9999", locationId: "LOC123456" }, "user:1");
    const rows = await store.list("ghl");
    expect(JSON.stringify(rows)).not.toContain("ghl-super-secreta");
    const st = (await vault.status(["ghl"]))[0];
    expect(JSON.stringify(st)).not.toContain("ghl-super-secreta");
    expect(st.fields.find((f) => f.key === "apiKey")).toMatchObject({ set: true, secret: true, display: "••••9999" });
    expect(st.fields.find((f) => f.key === "locationId")).toMatchObject({ display: "LOC123456" });
    expect(st.configured).toBe(true);
  });

  it("resolve devuelve los valores en claro solo para uso interno", async () => {
    const { vault } = mk();
    await vault.save("vapi", { apiKey: "vapi-key-123456789" }, "u");
    expect(await vault.resolve("vapi")).toEqual({ apiKey: "vapi-key-123456789" });
  });

  it("valida formato, campos desconocidos y proveedores", async () => {
    const { vault } = mk();
    await expect(vault.save("ghl", { locationId: "no valido!" }, "u")).rejects.toThrow(/formato/);
    await expect(vault.save("ghl", { nope: "x" }, "u")).rejects.toThrow(/desconocido/);
    await expect(vault.save("zzz", { a: "b" }, "u")).rejects.toThrow(/Proveedor/);
    await expect(vault.save("redsys", { environment: "staging" }, "u")).rejects.toThrow(/no permitido/);
    expect(validateFields(getProvider("redsys")!, { merchantCode: "12345678" })).toEqual([]);
  });

  it("sin claves de cifrado no se guardan secretos", async () => {
    const { vault } = mk("acme", null);
    await expect(vault.save("ghl", { apiKey: "abcdefghijk" }, "u")).rejects.toThrow(/claves de cifrado/);
    await expect(vault.save("ghl", { locationId: "LOC123456" }, "u")).resolves.toBeTruthy(); // no secreto
  });

  it("vacío borra el campo; clear borra el proveedor", async () => {
    const { vault } = mk();
    await vault.save("meta", { capiAccessToken: "tok-abcdefghij", capiTestEventCode: "TEST123" }, "u");
    await vault.save("meta", { capiTestEventCode: "" }, "u");
    expect(Object.keys(await vault.resolve("meta"))).toEqual(["capiAccessToken"]);
    await vault.clear("meta");
    expect(await vault.resolve("meta")).toEqual({});
  });

  it("un tenant no descifra lo de otro aunque comparta almacén", async () => {
    const store = new MemoryCredentialStore();
    const a = new IntegrationVault(store, () => "a", () => ring);
    const b = new IntegrationVault(store, () => "b", () => ring);
    await a.save("vapi", { apiKey: "clave-de-a-123456" }, "u");
    expect(await b.resolve("vapi")).toEqual({});
  });

  it("mask", () => {
    expect(mask("abcdefgh")).toBe("••••efgh");
    expect(mask("abc")).toBe("••••");
  });
});

describe("integrationEnv con bóveda", () => {
  it("single: entorno; multi: credencial del tenant, nunca el entorno", () => {
    process.env.GHL_API_KEY = "de-nayade";
    expect(integrationEnv("GHL_API_KEY")).toBe("de-nayade");
    process.env.TENANT_MODE = "multi";
    runWithTenant("acme", () => {
      expect(integrationEnv("GHL_API_KEY")).toBeUndefined();
      setResolvedCredentials({ ghl: { apiKey: "de-acme" } });
      expect(integrationEnv("GHL_API_KEY")).toBe("de-acme");
    });
    runWithTenant("otro", () => expect(integrationEnv("GHL_API_KEY")).toBeUndefined());
  });

  it("resolveEnvName cubre las variables históricas", () => {
    expect(resolveEnvName("REDSYS_MERCHANT_KEY")).toEqual({ provider: "redsys", field: "merchantKey" });
    expect(resolveEnvName("NO_EXISTE")).toBeNull();
  });
});

describe("pruebas de proveedor", () => {
  it("ghl: distingue correcto, rechazado y sin red; no filtra el secreto", async () => {
    const calls: string[] = [];
    const ok = await testProvider("ghl", { apiKey: "secreto-ghl-xyz", locationId: "LOC1" }, async (url, init) => {
      calls.push(JSON.stringify({ url, h: init?.headers }));
      return { ok: true, status: 200 };
    });
    expect(ok.ok).toBe(true);
    const bad = await testProvider("ghl", { apiKey: "x", locationId: "L" }, async () => ({ ok: false, status: 401 }));
    expect(bad).toEqual({ ok: false, message: "Credenciales rechazadas por el proveedor" });
    const down = await testProvider("vapi", { apiKey: "k" }, async () => {
      throw new Error("ECONNRESET secreto-ghl-xyz");
    });
    expect(down.ok).toBe(false);
    expect(JSON.stringify(down)).not.toContain("secreto");
    expect(testProvider("ghl", {}, async () => ({ ok: true, status: 200 }))).resolves.toMatchObject({ ok: false });
  });

  it("redsys: validación local de la configuración", async () => {
    const r = await testProvider("redsys", { merchantCode: "999008881", merchantKey: Buffer.alloc(24, 1).toString("base64"), environment: "test" });
    expect(r.ok).toBe(true);
    expect((await testProvider("redsys", { merchantCode: "1", merchantKey: "AAAA" })).ok).toBe(false);
  });
});
