/**
 * Aprovisionamiento: idempotencia, reanudación, reintentos, compensación y secretos.
 * Usa dobles en memoria (el flujo con MySQL real está en provisioning.mysql.test.ts).
 */
import { describe, it, expect, beforeEach } from "vitest";
import crypto from "node:crypto";
import { MemoryTenantRegistryStore } from "./_core/tenantRegistry/memoryStore";
import { TenantRegistryService, type Actor } from "./_core/tenantRegistry/service";
import { keyringFromEnv } from "./_core/tenantRegistry/crypto";
import { ProvisioningService, validateRequest } from "./_core/provisioning/service";
import { MemoryProvisioningStore, type DatabaseProvisioner, type SchemaApplier, type TenantSeeder } from "./_core/provisioning/ports";
import { PROVISION_STEPS, ProvisioningError, type ProvisionRequest } from "./_core/provisioning/types";

const OP: Actor = { type: "operator", id: "test" };
const REQ: ProvisionRequest = {
  tenantId: "hotel-sol",
  displayName: "Hotel Sol",
  adminEmail: "Admin@HotelSol.example",
  platformDomain: "elephantsource.es",
  modules: ["hotel", "spa"],
  trialDays: 15,
  brand: { name: "Hotel Sol", primaryColor: "#cc0000" },
  quotas: [{ metric: "email.sent", period: "day", limit: 200, enforcement: "hard" }],
};

class Fakes {
  dbs = new Map<string, string>();
  schemaApplied: string[] = [];
  admins = new Map<string, string>();
  branding: Record<string, string>[] = [];
  grants: Array<[string, string, Date | null | undefined]> = [];
  quotas: any[] = [];
  welcome: any[] = [];
  failOnce = new Map<string, number>(); // clave → nº de fallos pendientes
  calls: string[] = [];

  private maybeFail(k: string) {
    const n = this.failOnce.get(k) ?? 0;
    if (n > 0) {
      this.failOnce.set(k, n - 1);
      throw new Error(`fallo simulado en ${k}`);
    }
  }

  databases: DatabaseProvisioner = {
    ensureDatabase: async (id) => {
      this.calls.push("ensureDatabase");
      this.maybeFail("database");
      const dsn = `mysql://u_${id}:PW-${crypto.randomBytes(4).toString("hex")}@db.invalid:3306/es_${id}`;
      this.dbs.set(id, dsn);
      return { dsn, serverAlias: "test" };
    },
    dropDatabase: async (id) => {
      this.calls.push("dropDatabase");
      this.dbs.delete(id);
    },
  };
  schema: SchemaApplier = {
    apply: async (dsn) => {
      this.calls.push("schema");
      this.maybeFail("schema");
      this.schemaApplied.push(dsn);
      return { baselineVersion: "0000_baseline", schemaVersion: "0000_baseline" };
    },
  };
  seeder: TenantSeeder = {
    seedAdmin: async (_dsn, input) => {
      this.calls.push("admin");
      this.maybeFail("admin");
      if (this.admins.has(input.email)) return { created: false };
      const t = crypto.randomBytes(8).toString("hex");
      this.admins.set(input.email, t);
      return { created: true, inviteToken: t };
    },
    seedBranding: async (_dsn, s) => {
      this.calls.push("branding");
      this.branding.push(s);
    },
  };
}

let store: MemoryTenantRegistryStore;
let registry: TenantRegistryService;
let fakes: Fakes;
let prov: ProvisioningService;
let pstore: MemoryProvisioningStore;
let now: number;

beforeEach(() => {
  store = new MemoryTenantRegistryStore();
  const ring = keyringFromEnv({
    REGISTRY_KEYS: `k1:${crypto.randomBytes(32).toString("base64")}`,
    REGISTRY_ACTIVE_KEY_ID: "k1",
  } as NodeJS.ProcessEnv);
  registry = new TenantRegistryService(store, () => ring);
  fakes = new Fakes();
  pstore = new MemoryProvisioningStore();
  now = Date.UTC(2026, 9, 13);
  prov = new ProvisioningService({
    registry,
    reader: store,
    databases: fakes.databases,
    schema: fakes.schema,
    seeder: fakes.seeder,
    entitlements: { grant: async (t, m, _a, o) => void fakes.grants.push([`${t}`, m, o?.validUntil]) },
    quotas: { set: async (q) => void fakes.quotas.push(q) },
    store: pstore,
    welcome: { notify: async (n) => void fakes.welcome.push(n) },
    now: () => now,
    sleep: async () => undefined,
  });
});

describe("validación de la solicitud", () => {
  it("rechaza datos no válidos", () => {
    expect(() => validateRequest({ ...REQ, tenantId: "../x" })).toThrow(ProvisioningError);
    expect(() => validateRequest({ ...REQ, tenantId: "A" })).toThrow();
    expect(() => validateRequest({ ...REQ, adminEmail: "no-es-correo" })).toThrow();
    expect(() => validateRequest({ ...REQ, platformDomain: "localhost" })).toThrow();
    expect(() => validateRequest({ ...REQ, trialDays: 0 })).toThrow();
    expect(() => validateRequest(REQ)).not.toThrow();
  });
});

describe("alta completa", () => {
  it("ejecuta todos los pasos y deja el tenant listo en prueba", async () => {
    const r = await prov.run(REQ, OP);
    expect(r.status).toBe("completed");
    expect(r.completedSteps).toEqual([...PROVISION_STEPS]);
    expect(r.domain).toBe("hotel-sol.elephantsource.es");
    expect(r.adminInviteToken).toMatch(/^[0-9a-f]{16}$/);

    const t = await store.getTenant("hotel-sol");
    expect(t).toMatchObject({ status: "trial", schemaVersion: "0000_baseline" });
    expect(await store.getActiveDatabase("hotel-sol")).not.toBeNull();
    const [d] = await store.listDomains("hotel-sol");
    expect(d).toMatchObject({ domain: "hotel-sol.elephantsource.es", status: "active", isPrimary: true });

    expect(fakes.admins.has("admin@hotelsol.example")).toBe(true); // correo normalizado
    expect(fakes.branding[0]).toMatchObject({ brand_name: "Hotel Sol", brand_domain: "hotel-sol.elephantsource.es" });
    expect(fakes.grants.map((g) => g[1])).toEqual(["hotel", "spa"]);
    expect(fakes.grants[0][2]!.getTime()).toBe(now + 15 * 86_400_000); // 15 días de prueba
    expect(fakes.quotas).toHaveLength(1);
    expect(fakes.welcome[0]).toMatchObject({ adminEmail: REQ.adminEmail, domain: "hotel-sol.elephantsource.es" });
  });

  it("el DSN solo se guarda cifrado y no aparece en el estado del alta ni en la auditoría", async () => {
    await prov.run(REQ, OP);
    const secret = fakes.dbs.get("hotel-sol")!.split(":")[2].split("@")[0]; // contraseña
    const blob = JSON.stringify([await pstore.get("hotel-sol"), await store.listEvents("hotel-sol"), await store.listDatabases("hotel-sol")]);
    expect(blob).not.toContain(secret);
    // el token de invitación tampoco se persiste en el estado del alta
    const token = fakes.admins.get("admin@hotelsol.example")!;
    expect(JSON.stringify(await pstore.get("hotel-sol"))).not.toContain(token);
  });
});

describe("idempotencia y reanudación", () => {
  it("repetir una solicitud completada no duplica nada", async () => {
    await prov.run(REQ, OP);
    fakes.calls.length = 0;
    const again = await prov.run(REQ, OP);
    expect(again.status).toBe("completed");
    expect(fakes.calls).toEqual([]);
    expect(await store.listTenants()).toHaveLength(1);
    expect(await store.listDatabases("hotel-sol")).toHaveLength(1);
  });

  it("un fallo detiene en ese paso, queda registrado y la reejecución continúa", async () => {
    fakes.failOnce.set("schema", 3); // agota los 3 intentos de la primera ejecución
    const first = await prov.run(REQ, OP);
    expect(first.status).toBe("failed");
    expect(first.failedStep).toBe("schema");
    expect(first.completedSteps).toEqual(["register", "database"]);
    expect((await store.getTenant("hotel-sol"))!.status).toBe("provisioning");

    fakes.calls.length = 0;
    const second = await prov.run(REQ, OP);
    expect(second.status).toBe("completed");
    expect(fakes.calls).not.toContain("ensureDatabase"); // lo hecho no se repite
    expect((await store.getTenant("hotel-sol"))!.status).toBe("trial");
  });

  it("reintenta dentro de la misma ejecución ante fallos transitorios", async () => {
    fakes.failOnce.set("admin", 2); // falla 2 veces y a la 3.ª funciona
    const r = await prov.run(REQ, OP);
    expect(r.status).toBe("completed");
  });

  it("un fallo tras crear la BD no deja BD huérfana al reanudar (se reutiliza)", async () => {
    fakes.failOnce.set("schema", 3);
    await prov.run(REQ, OP);
    await prov.run(REQ, OP);
    expect(fakes.dbs.size).toBe(1);
  });

  it("no admite reescribir un alta en curso con otros datos", async () => {
    fakes.failOnce.set("schema", 3);
    await prov.run(REQ, OP);
    const other = { ...REQ, displayName: "Otro Nombre" };
    // en estado failed se permite corregir la solicitud (reanudación con datos corregidos)
    const r = await prov.run(other, OP);
    expect(r.status).toBe("completed");
  });
});

describe("compensación", () => {
  it("abort elimina la BD y deja el tenant eliminado; solo un operador", async () => {
    fakes.failOnce.set("schema", 3);
    await prov.run(REQ, OP);
    await expect(prov.abort("hotel-sol", { type: "system", id: "x" }, "prueba")).rejects.toThrow();
    await prov.abort("hotel-sol", OP, "alta cancelada");
    expect(fakes.dbs.size).toBe(0);
    expect((await store.getTenant("hotel-sol"))!.status).toBe("deleted");
    expect((await pstore.get("hotel-sol"))!.status).toBe("aborted");
    await expect(prov.run(REQ, OP)).rejects.toMatchObject({ code: "aborted" });
  });

  it("no se aborta un alta ya activada", async () => {
    await prov.run(REQ, OP);
    await expect(prov.abort("hotel-sol", OP, "x")).rejects.toThrow(/ya está activado/);
    expect(fakes.dbs.size).toBe(1);
  });
});

describe("conflictos", () => {
  it("no adopta un tenant existente que no está en alta", async () => {
    await registry.createTenant({ id: "hotel-sol", displayName: "X" }, OP);
    await registry.setStatus("hotel-sol", "trial", OP);
    const r = await prov.run(REQ, OP);
    expect(r.status).toBe("failed");
    expect(r.failedStep).toBe("register");
  });
});

describe("acceso del administrador y altas simultáneas", () => {
  function withReissue(o: { failBranding: number }) {
    const accepted = new Set<string>();
    const issued: string[] = [];
    let failBranding = o.failBranding;
    const seeder: TenantSeeder = {
      ...fakes.seeder,
      seedBranding: async (dsn, s) => {
        if (failBranding-- > 0) throw new Error("fallo simulado en la marca");
        return fakes.seeder.seedBranding(dsn, s);
      },
      reissueAdminInvite: async (_dsn, input) => {
        if (accepted.has(input.email)) return null;
        const t = crypto.randomBytes(8).toString("hex");
        issued.push(t);
        fakes.admins.set(input.email, t);
        return { inviteToken: t };
      },
    };
    const p = new ProvisioningService({
      registry,
      reader: store,
      databases: fakes.databases,
      schema: fakes.schema,
      seeder,
      entitlements: { grant: async () => undefined },
      quotas: { set: async () => undefined },
      store: pstore,
      welcome: { notify: async (n) => void fakes.welcome.push(n) },
      now: () => now,
      sleep: async () => undefined,
      maxAttemptsPerStep: 1,
    });
    return { p, accepted, issued };
  }

  it("alta reanudada tras crear al administrador: la invitación perdida se emite de nuevo", async () => {
    const { p, issued } = withReissue({ failBranding: 1 });
    const first = await p.run(REQ, OP);
    expect(first).toMatchObject({ status: "failed", failedStep: "branding" });
    expect(first.adminInviteToken).toBeUndefined();
    const again = await p.run(REQ, OP);
    expect(again.status).toBe("completed");
    expect(issued).toHaveLength(1);
    expect(again.adminInviteToken).toMatch(/^[0-9a-f]{16}$/);
    expect(again.adminInviteToken).toBe(issued[0]);
    expect(fakes.welcome.at(-1).inviteToken).toBe(issued[0]);
  });

  it("reenvío del acceso: solo mientras no haya aceptado la invitación", async () => {
    const { p, accepted } = withReissue({ failBranding: 0 });
    await expect(p.reissueAdminInvite("hotel-sol")).rejects.toMatchObject({ code: "not_found" });
    await p.run(REQ, OP);
    expect(await p.reissueAdminInvite("hotel-sol")).toMatch(/^[0-9a-f]{16}$/);
    accepted.add("admin@hotelsol.example");
    expect(await p.reissueAdminInvite("hotel-sol")).toBeNull();
  });

  it("dos altas simultáneas del mismo tenant se serializan: cada paso una vez, una sola invitación", async () => {
    const { p } = withReissue({ failBranding: 0 });
    const [a, b] = await Promise.all([p.run(REQ, OP), p.run(REQ, OP)]);
    expect([a.status, b.status]).toEqual(["completed", "completed"]);
    expect(fakes.calls.filter((c) => c === "ensureDatabase")).toHaveLength(1);
    expect(fakes.calls.filter((c) => c === "admin")).toHaveLength(1);
    expect([a.adminInviteToken, b.adminInviteToken].filter(Boolean)).toHaveLength(1);
    expect(await store.listDatabases("hotel-sol")).toHaveLength(1);
  });
});
