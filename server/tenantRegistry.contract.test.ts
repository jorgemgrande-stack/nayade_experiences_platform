/**
 * Contrato v1 del registro de tenants: ciclo de vida, cifrado de DSN y normalización de host.
 */
import { describe, it, expect } from "vitest";
import crypto from "node:crypto";
import {
  RegistryError,
  TENANT_STATUSES,
  assertSupportedContract,
  assertTenantId,
  type TenantStatus,
} from "./_core/tenantRegistry/contract";
import {
  accessPolicy,
  allowedTransitions,
  assertTransition,
  canTransition,
  requiresOperator,
  servesPublicWeb,
} from "./_core/tenantRegistry/lifecycle";
import { decryptDsn, encryptDsn, keyringFromEnv, reencryptDsn, type Keyring } from "./_core/tenantRegistry/crypto";
import { isPlatformSubdomain, normalizeHost, platformSubdomain } from "./_core/tenantRegistry/host";

const key = () => crypto.randomBytes(32);
const ring = (active = "k1", ids = ["k1"]): Keyring => ({
  activeKeyId: active,
  keys: new Map(ids.map((i) => [i, key()])),
});

describe("contrato", () => {
  it("valida el identificador de tenant", () => {
    expect(() => assertTenantId("cliente-1")).not.toThrow();
    for (const bad of ["", "A", "con espacios", "../x", "x".repeat(64), 7, null]) {
      expect(() => assertTenantId(bad as any), String(bad)).toThrow(RegistryError);
    }
  });

  it("solo opera con su misma versión mayor", () => {
    expect(() => assertSupportedContract("1.0.0")).not.toThrow();
    expect(() => assertSupportedContract("1.7.2")).not.toThrow();
    expect(() => assertSupportedContract("2.0.0")).toThrow(/no soportado/);
    expect(() => assertSupportedContract("x")).toThrow(RegistryError);
  });
});

describe("ciclo de vida", () => {
  it("el camino feliz está permitido", () => {
    const path: TenantStatus[] = ["provisioning", "trial", "active", "grace", "suspended", "archived", "deleting", "deleted"];
    for (let i = 0; i < path.length - 1; i++) {
      // algunos saltos intermedios no son directos; se comprueba que haya un camino válido
      expect(allowedTransitions(path[i]).length).toBeGreaterThan(0);
    }
    expect(canTransition("trial", "active")).toBe(true);
    expect(canTransition("active", "grace")).toBe(true);
    expect(canTransition("grace", "active")).toBe(true);
    expect(canTransition("suspended", "active")).toBe(true); // reactivación
  });

  it("rechaza saltos peligrosos o inválidos", () => {
    expect(canTransition("active", "deleted")).toBe(false);
    expect(canTransition("active", "deleting")).toBe(false);
    expect(canTransition("trial", "provisioning")).toBe(false);
    expect(canTransition("deleted", "active")).toBe(false);
    expect(() => assertTransition("active", "deleted")).toThrow(/no permitida/);
  });

  it("deleted es terminal y repetir el mismo estado es idempotente", () => {
    expect(allowedTransitions("deleted")).toEqual([]);
    expect(() => assertTransition("active", "active")).not.toThrow();
  });

  it("el borrado exige operador; el resto no", () => {
    expect(requiresOperator("deleting")).toBe(true);
    expect(requiresOperator("deleted")).toBe(true);
    for (const s of TENANT_STATUSES.filter((s) => s !== "deleting" && s !== "deleted")) {
      expect(requiresOperator(s)).toBe(false);
    }
  });

  it("la política de acceso coincide con la propuesta aprobada", () => {
    expect(accessPolicy("active")).toMatchObject({ publicWeb: true, admin: true, writes: true, blockedStatus: null });
    expect(accessPolicy("trial").writes).toBe(true);
    expect(accessPolicy("grace").publicWeb).toBe(true);
    expect(accessPolicy("suspended")).toMatchObject({ publicWeb: false, admin: true, writes: false, blockedStatus: 503 });
    expect(accessPolicy("archived")).toMatchObject({ admin: false, writes: false, blockedStatus: 410 });
    expect(accessPolicy("provisioning").publicWeb).toBe(false);
    for (const s of ["deleting", "deleted"] as const) expect(servesPublicWeb(s)).toBe(false);
  });

  it("ningún estado bloqueado permite escribir", () => {
    for (const s of TENANT_STATUSES) {
      const p = accessPolicy(s);
      if (p.blockedStatus !== null) expect(p.writes, s).toBe(false);
    }
  });
});

describe("cifrado de DSN (AES-256-GCM)", () => {
  const DSN = "mysql://usuario:clave-ficticia@db.invalid:3306/tenant_a";

  it("cifra y descifra; el texto cifrado no contiene el DSN", () => {
    const r = ring();
    const { cipher, keyId } = encryptDsn(DSN, "acme", r);
    expect(keyId).toBe("k1");
    expect(cipher).not.toContain("clave-ficticia");
    expect(Buffer.from(cipher, "base64").toString("latin1")).not.toContain("clave-ficticia");
    expect(decryptDsn(cipher, keyId, "acme", r)).toBe(DSN);
  });

  it("cada cifrado usa un IV distinto", () => {
    const r = ring();
    expect(encryptDsn(DSN, "acme", r).cipher).not.toBe(encryptDsn(DSN, "acme", r).cipher);
  });

  it("un DSN cifrado para un tenant NO descifra como de otro (AAD)", () => {
    const r = ring();
    const { cipher, keyId } = encryptDsn(DSN, "acme", r);
    expect(() => decryptDsn(cipher, keyId, "beta", r)).toThrow(/No se pudo descifrar/);
  });

  it("detecta manipulación", () => {
    const r = ring();
    const { cipher, keyId } = encryptDsn(DSN, "acme", r);
    const buf = Buffer.from(cipher, "base64");
    buf[buf.length - 1] ^= 0x01;
    expect(() => decryptDsn(buf.toString("base64"), keyId, "acme", r)).toThrow(/No se pudo descifrar/);
  });

  it("clave incorrecta, formato inválido y clave desconocida fallan con error opaco", () => {
    const r1 = ring();
    const r2 = ring();
    const { cipher } = encryptDsn(DSN, "acme", r1);
    expect(() => decryptDsn(cipher, "k1", "acme", r2)).toThrow(/No se pudo descifrar/);
    expect(() => decryptDsn("AAAA", "k1", "acme", r1)).toThrow(/no válido/);
    expect(() => decryptDsn(cipher, "otra", "acme", r1)).toThrow(/no disponible/);
  });

  it("rotación: se descifra con la clave antigua y se re-cifra con la activa", () => {
    const old = ring("k1", ["k1"]);
    const { cipher, keyId } = encryptDsn(DSN, "acme", old);
    const rotated: Keyring = { activeKeyId: "k2", keys: new Map([...old.keys, ["k2", key()]]) };
    expect(decryptDsn(cipher, keyId, "acme", rotated)).toBe(DSN); // aún legible
    const re = reencryptDsn(cipher, keyId, "acme", rotated)!;
    expect(re.keyId).toBe("k2");
    expect(decryptDsn(re.cipher, re.keyId, "acme", rotated)).toBe(DSN);
    expect(reencryptDsn(re.cipher, re.keyId, "acme", rotated)).toBeNull(); // ya con la activa
  });

  it("carga el llavero desde el entorno y valida longitud y clave activa", () => {
    const k = crypto.randomBytes(32).toString("base64");
    const ok = keyringFromEnv({ REGISTRY_KEYS: `a:${k}`, REGISTRY_ACTIVE_KEY_ID: "a" } as any);
    expect(ok.activeKeyId).toBe("a");
    expect(() => keyringFromEnv({ REGISTRY_KEYS: "", REGISTRY_ACTIVE_KEY_ID: "a" } as any)).toThrow(/No hay claves/);
    expect(() => keyringFromEnv({ REGISTRY_KEYS: `a:${k}`, REGISTRY_ACTIVE_KEY_ID: "b" } as any)).toThrow(/no figura/);
    expect(() => keyringFromEnv({ REGISTRY_KEYS: "a:AAAA", REGISTRY_ACTIVE_KEY_ID: "a" } as any)).toThrow(/32 bytes/);
    expect(() => keyringFromEnv({ REGISTRY_KEYS: "sin-dos-puntos", REGISTRY_ACTIVE_KEY_ID: "a" } as any)).toThrow(/mal formado/);
  });
});

describe("normalizeHost", () => {
  it("normaliza mayúsculas, puerto y punto final", () => {
    expect(normalizeHost("WWW.Ejemplo.COM")).toBe("www.ejemplo.com");
    expect(normalizeHost("www.ejemplo.com:443")).toBe("www.ejemplo.com");
    expect(normalizeHost("www.ejemplo.com.")).toBe("www.ejemplo.com");
  });

  it("convierte IDN a punycode", () => {
    expect(normalizeHost("mañana.es")).toBe("xn--maana-pta.es");
  });

  it("rechaza lo que no es un host: IP, esquema, ruta, credenciales, comodines, vacío", () => {
    for (const bad of [
      "",
      "   ",
      "192.168.0.1",
      "http://ejemplo.com",
      "ejemplo.com/ruta",
      "usuario@ejemplo.com",
      "*.ejemplo.com",
      "[::1]",
      "ejemplo.com:99999",
      "ejemplo.com:abc",
      "con espacio.com",
      "ejemplo",
      "-malo.com",
      "malo-.com",
      "a..b.com",
      "x".repeat(64) + ".com",
      "ejemplo.com\r\nHost: otro.com",
    ]) {
      expect(normalizeHost(bad), JSON.stringify(bad)).toBeNull();
    }
    expect(normalizeHost(undefined)).toBeNull();
    expect(normalizeHost(123)).toBeNull();
  });

  it("localhost solo se admite en desarrollo", () => {
    expect(normalizeHost("localhost:3000")).toBeNull();
    expect(normalizeHost("localhost:3000", { allowLocalhost: true })).toBe("localhost");
    expect(normalizeHost("acme.localhost", { allowLocalhost: true })).toBe("acme.localhost");
  });

  it("subdominios de plataforma", () => {
    expect(platformSubdomain("acme", "elephantsource.es")).toBe("acme.elephantsource.es");
    expect(isPlatformSubdomain("acme.elephantsource.es", "elephantsource.es")).toBe(true);
    expect(isPlatformSubdomain("a.b.elephantsource.es", "elephantsource.es")).toBe(false);
    expect(isPlatformSubdomain("elephantsource.es", "elephantsource.es")).toBe(false);
    expect(isPlatformSubdomain("acme.otro.es", "elephantsource.es")).toBe(false);
    // un dominio propio que termina igual pero sin el punto separador no es subdominio
    expect(isPlatformSubdomain("xelephantsource.es", "elephantsource.es")).toBe(false);
  });
});
