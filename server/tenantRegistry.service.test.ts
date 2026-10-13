/**
 * Servicio y almacén del registro: escrituras auditadas, unicidad de dominios, ciclo de vida,
 * concurrencia optimista, atomicidad y verificación de dominios.
 */
import { describe, it, expect, beforeEach } from "vitest";
import crypto from "node:crypto";
import { RegistryError } from "./_core/tenantRegistry/contract";
import { MemoryTenantRegistryStore } from "./_core/tenantRegistry/memoryStore";
import { TenantRegistryService, type Actor } from "./_core/tenantRegistry/service";
import { keyringFromEnv, type Keyring } from "./_core/tenantRegistry/crypto";
import { expectedTxtValue, verifyDomainOwnership } from "./_core/tenantRegistry/domainVerification";

const SECRET_DSN = "mysql://usuario:CLAVE-FICTICIA-123@db.invalid:3306/acme";
const OP: Actor = { type: "operator", id: "jorge" };
const SYS: Actor = { type: "system", id: "scheduler" };

let store: MemoryTenantRegistryStore;
let svc: TenantRegistryService;
let ring: Keyring;

beforeEach(() => {
  store = new MemoryTenantRegistryStore();
  ring = keyringFromEnv({
    REGISTRY_KEYS: `k1:${crypto.randomBytes(32).toString("base64")}`,
    REGISTRY_ACTIVE_KEY_ID: "k1",
  } as any);
  svc = new TenantRegistryService(store, () => ring);
});

describe("tenants", () => {
  it("crea un tenant en provisioning con versión 1 y evento de auditoría", async () => {
    const t = await svc.createTenant({ id: "acme", displayName: "Acme S.L." }, OP);
    expect(t).toMatchObject({ id: "acme", status: "provisioning", registryVersion: 1 });
    const ev = await store.listEvents("acme");
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ action: "tenant.created", actorType: "operator", actorId: "jorge", toState: "provisioning" });
  });

  it("rechaza identificadores no válidos y duplicados", async () => {
    await expect(svc.createTenant({ id: "../x", displayName: "x" }, OP)).rejects.toThrow(RegistryError);
    await svc.createTenant({ id: "acme", displayName: "A" }, OP);
    await expect(svc.createTenant({ id: "acme", displayName: "B" }, OP)).rejects.toThrow(/ya existe/);
  });

  it("aplica transiciones válidas, audita y sube la versión", async () => {
    await svc.createTenant({ id: "acme", displayName: "A" }, OP);
    const t = await svc.setStatus("acme", "trial", SYS);
    expect(t.status).toBe("trial");
    expect(t.registryVersion).toBe(2);
    expect((await store.listEvents("acme")).at(-1)).toMatchObject({ action: "status.changed", fromState: "provisioning", toState: "trial" });
  });

  it("rechaza transiciones inválidas y las idempotentes no cambian nada", async () => {
    await svc.createTenant({ id: "acme", displayName: "A" }, OP);
    await expect(svc.setStatus("acme", "suspended", OP, { reason: "x" })).rejects.toThrow(/no permitida/);
    const same = await svc.setStatus("acme", "provisioning", OP);
    expect(same.registryVersion).toBe(1);
  });

  it("suspender/archivar exige motivo; borrar exige operador y motivo", async () => {
    await svc.createTenant({ id: "acme", displayName: "A" }, OP);
    await svc.setStatus("acme", "trial", SYS);
    await svc.setStatus("acme", "active", SYS);
    await expect(svc.setStatus("acme", "suspended", SYS)).rejects.toThrow(/exige un motivo/);
    await svc.setStatus("acme", "suspended", SYS, { reason: "impago" });
    await svc.setStatus("acme", "archived", SYS, { reason: "fin de retención" });
    await expect(svc.setStatus("acme", "deleting", SYS, { reason: "baja" })).rejects.toThrow(/solo puede fijarlo un operador/);
    await expect(svc.setStatus("acme", "deleting", OP)).rejects.toThrow(/exige un motivo/);
    const t = await svc.setStatus("acme", "deleting", OP, { reason: "baja solicitada" });
    expect(t.status).toBe("deleting");
  });

  it("concurrencia optimista: una versión desfasada se rechaza", async () => {
    await svc.createTenant({ id: "acme", displayName: "A" }, OP);
    await svc.setStatus("acme", "trial", SYS); // versión 2
    await expect(svc.setStatus("acme", "active", SYS, { expectedVersion: 1 })).rejects.toThrow(/cambió/);
  });
});

describe("dominios", () => {
  beforeEach(async () => {
    await svc.createTenant({ id: "acme", displayName: "A" }, OP);
    await svc.createTenant({ id: "beta", displayName: "B" }, OP);
  });

  it("un dominio pertenece a un único tenant (aunque cambie el formato)", async () => {
    await svc.addDomain("acme", "Tienda.Ejemplo.com", "custom", OP);
    await expect(svc.addDomain("beta", "tienda.ejemplo.com", "custom", OP)).rejects.toThrow(/ya está registrado/);
    await expect(svc.addDomain("beta", "TIENDA.EJEMPLO.COM:443", "custom", OP)).rejects.toThrow(/ya está registrado/);
  });

  it("rechaza dominios inválidos", async () => {
    for (const bad of ["192.168.1.1", "http://x.com", "*.x.com", "localhost", "x"]) {
      await expect(svc.addDomain("acme", bad, "custom", OP), bad).rejects.toThrow(/Dominio no válido/);
    }
  });

  it("el dominio propio requiere verificación; el de plataforma nace verificado", async () => {
    const c = await svc.addDomain("acme", "mitienda.com", "custom", OP);
    expect(c).toMatchObject({ status: "pending_verification" });
    expect(c.verificationToken).toMatch(/^[0-9a-f]{48}$/);
    await expect(svc.activateDomain("mitienda.com", OP)).rejects.toThrow(/verificados/);

    const p = await svc.addDomain("acme", "acme.elephantsource.es", "platform_subdomain", OP);
    expect(p.status).toBe("verified");
    expect((await svc.activateDomain("acme.elephantsource.es", OP)).status).toBe("active");
  });

  it("verificar → activar y quedar resoluble con su tenant", async () => {
    await svc.addDomain("acme", "mitienda.com", "custom", OP);
    await svc.markDomainVerified("mitienda.com", SYS);
    await svc.activateDomain("mitienda.com", SYS);
    const r = await store.resolveDomain("mitienda.com");
    expect(r?.tenant.id).toBe("acme");
    expect(r?.domain.status).toBe("active");
  });

  it("solo un dominio primario por tenant", async () => {
    await svc.addDomain("acme", "a.acme.elephantsource.es", "platform_subdomain", OP, { primary: true });
    await svc.addDomain("acme", "b.acme.elephantsource.es", "platform_subdomain", OP);
    await svc.setPrimaryDomain("acme", "b.acme.elephantsource.es", OP);
    const primaries = (await store.listDomains("acme")).filter((d) => d.isPrimary);
    expect(primaries.map((d) => d.domain)).toEqual(["b.acme.elephantsource.es"]);
  });

  it("no se puede fijar como primario el dominio de otro tenant", async () => {
    await svc.addDomain("beta", "b.elephantsource.es", "platform_subdomain", OP);
    await expect(svc.setPrimaryDomain("acme", "b.elephantsource.es", OP)).rejects.toThrow(/no pertenece/);
  });

  it("cada cambio de dominio sube la versión del tenant (invalida cachés)", async () => {
    const v0 = (await store.getTenant("acme"))!.registryVersion;
    await svc.addDomain("acme", "x.elephantsource.es", "platform_subdomain", OP);
    await svc.activateDomain("x.elephantsource.es", OP);
    expect((await store.getTenant("acme"))!.registryVersion).toBeGreaterThan(v0 + 1);
  });
});

describe("bases de datos y credenciales", () => {
  beforeEach(async () => {
    await svc.createTenant({ id: "acme", displayName: "A" }, OP);
    await svc.createTenant({ id: "beta", displayName: "B" }, OP);
  });

  it("el DSN solo se guarda cifrado y nunca aparece en el registro ni en los eventos", async () => {
    const ref = await svc.registerDatabase("acme", SECRET_DSN, OP, { serverAlias: "mysql-a" });
    expect(ref.state).toBe("pending");
    const everything = JSON.stringify({
      dbs: await store.listDatabases("acme"),
      events: await store.listEvents("acme"),
      tenant: await store.getTenant("acme"),
    });
    expect(everything).not.toContain("CLAVE-FICTICIA");
    expect(everything).not.toContain("db.invalid");
  });

  it("activar una BD retira la anterior y solo hay una activa", async () => {
    const a = await svc.registerDatabase("acme", SECRET_DSN, OP);
    await svc.activateDatabase("acme", a.id, OP);
    const b = await svc.registerDatabase("acme", SECRET_DSN.replace("acme", "acme2"), OP);
    await svc.activateDatabase("acme", b.id, OP);
    const all = await store.listDatabases("acme");
    expect(all.filter((d) => d.state === "active").map((d) => d.id)).toEqual([b.id]);
    expect(all.find((d) => d.id === a.id)!.state).toBe("retired");
    await expect(svc.activateDatabase("acme", a.id, OP)).rejects.toThrow(/retirada/);
  });

  it("getActiveDsn descifra para su tenant y es null si no hay BD activa", async () => {
    expect(await svc.getActiveDsn("acme")).toBeNull();
    const a = await svc.registerDatabase("acme", SECRET_DSN, OP);
    expect(await svc.getActiveDsn("acme")).toBeNull(); // aún pendiente
    await svc.activateDatabase("acme", a.id, OP);
    expect(await svc.getActiveDsn("acme")).toBe(SECRET_DSN);
  });

  it("no se puede activar la BD de otro tenant", async () => {
    const a = await svc.registerDatabase("acme", SECRET_DSN, OP);
    await expect(svc.activateDatabase("beta", a.id, OP)).rejects.toThrow(/no encontrada/);
  });

  it("la credencial copiada de un tenant a otro no descifra (AAD)", async () => {
    const a = await svc.registerDatabase("acme", SECRET_DSN, OP);
    await svc.activateDatabase("acme", a.id, OP);
    // Simula una manipulación directa del almacén: copiar el cifrado de acme a beta
    const stolen = (await store.getActiveDatabase("acme"))!;
    await store.transaction(async (tx) => {
      const b = await tx.insertDatabase({ tenantId: "beta", state: "active", dsnCipher: stolen.dsnCipher, keyId: stolen.keyId, serverAlias: null });
      expect(b.tenantId).toBe("beta");
    });
    await expect(svc.getActiveDsn("beta")).rejects.toThrow(/No se pudo descifrar/);
  });

  it("rotación: re-cifra con la clave activa y sigue descifrando", async () => {
    const a = await svc.registerDatabase("acme", SECRET_DSN, OP);
    await svc.activateDatabase("acme", a.id, OP);
    ring = { activeKeyId: "k2", keys: new Map([...ring.keys, ["k2", crypto.randomBytes(32)]]) };
    expect(await svc.rotateKeys(OP)).toBe(1);
    expect((await store.getActiveDatabase("acme"))!.keyId).toBe("k2");
    expect(await svc.getActiveDsn("acme")).toBe(SECRET_DSN);
    expect(await svc.rotateKeys(OP)).toBe(0);
  });

  it("rechaza DSN que no sean mysql://", async () => {
    await expect(svc.registerDatabase("acme", "postgres://x", OP)).rejects.toThrow(/mysql/);
  });
});

describe("atomicidad y auditoría", () => {
  it("un fallo a mitad de operación no deja cambios parciales", async () => {
    await svc.createTenant({ id: "acme", displayName: "A" }, OP);
    const before = JSON.stringify(await store.listEvents("acme"));
    await expect(
      store.transaction(async (tx) => {
        await tx.insertEvent({ tenantId: "acme", actorType: "system", actorId: "x", action: "parcial", fromState: null, toState: null, details: null, requestId: null });
        throw new Error("fallo simulado");
      }),
    ).rejects.toThrow("fallo simulado");
    expect(JSON.stringify(await store.listEvents("acme"))).toBe(before);
  });

  it("los eventos no admiten claves de aspecto sensible", async () => {
    await svc.createTenant({ id: "acme", displayName: "A" }, OP);
    await svc.addDomain("acme", "mitienda.com", "custom", OP);
    const text = JSON.stringify(await store.listEvents("acme"));
    expect(text).not.toMatch(/verificationToken|[0-9a-f]{48}/);
  });

  it("operaciones concurrentes sobre el mismo tenant se serializan", async () => {
    await svc.createTenant({ id: "acme", displayName: "A" }, OP);
    await svc.setStatus("acme", "trial", SYS);
    const results = await Promise.allSettled([
      svc.setStatus("acme", "active", SYS),
      svc.setStatus("acme", "grace", SYS),
    ]);
    // ambas son válidas en secuencia (trial→active, active→grace); el resultado final es coherente
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
    expect((await store.getTenant("acme"))!.status).toBe("grace");
  });
});

describe("verificación de dominios (CNAME + TXT)", () => {
  const TOKEN = "t0k3n";
  const dnsWith = (cname: string[] | Error, txt: string[][] | Error) => ({
    resolveCname: async () => { if (cname instanceof Error) throw cname; return cname; },
    resolveTxt: async () => { if (txt instanceof Error) throw txt; return txt; },
  });

  it("OK cuando CNAME y TXT son correctos (con punto final y mayúsculas)", async () => {
    const r = await verifyDomainOwnership(
      { domain: "tienda.ejemplo.com", token: TOKEN, platformTarget: "edge.elephantsource.es" },
      dnsWith(["EDGE.elephantsource.es."], [[expectedTxtValue(TOKEN)]]),
    );
    expect(r).toMatchObject({ ok: true, cname: true, txt: true, pending: [] });
  });

  it("falla si falta el CNAME, el TXT o apuntan a otro sitio, e indica qué configurar", async () => {
    const base = { domain: "tienda.ejemplo.com", token: TOKEN, platformTarget: "edge.elephantsource.es" };
    const noCname = await verifyDomainOwnership(base, dnsWith(new Error("ENODATA"), [[expectedTxtValue(TOKEN)]]));
    expect(noCname.ok).toBe(false);
    expect(noCname.pending.join(" ")).toMatch(/CNAME/);

    const wrongTarget = await verifyDomainOwnership(base, dnsWith(["otro.host.com"], [[expectedTxtValue(TOKEN)]]));
    expect(wrongTarget.cname).toBe(false);

    const wrongTxt = await verifyDomainOwnership(base, dnsWith(["edge.elephantsource.es"], [["elephant-verify=otro"]]));
    expect(wrongTxt.txt).toBe(false);
    expect(wrongTxt.pending.join(" ")).toMatch(/_elephant-verify\.tienda\.ejemplo\.com/);
  });

  it("une los fragmentos de un TXT largo", async () => {
    const v = expectedTxtValue("abcdef");
    const r = await verifyDomainOwnership(
      { domain: "x.ejemplo.com", token: "abcdef", platformTarget: "edge.elephantsource.es" },
      dnsWith(["edge.elephantsource.es"], [[v.slice(0, 10), v.slice(10)]]),
    );
    expect(r.ok).toBe(true);
  });

  it("rechaza datos de entrada no válidos sin consultar DNS", async () => {
    let called = false;
    const spy = { resolveCname: async () => { called = true; return []; }, resolveTxt: async () => { called = true; return []; } };
    const r = await verifyDomainOwnership({ domain: "192.168.0.1", token: TOKEN, platformTarget: "edge.es" }, spy);
    expect(r.ok).toBe(false);
    expect(called).toBe(false);
  });
});
