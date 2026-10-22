/**
 * Marca y URL por empresa (sin red ni base de datos):
 *  - URL pública: solo un dominio propio verificado y activo; si no, el subdominio de plataforma.
 *  - Verificación por TXT con resolvedor DNS FALSO: pendiente → fallido → verificado.
 *  - Identidad fiscal y marca de cada empresa; nunca respaldos de otra instalación en multi.
 *  - Aislamiento con peticiones concurrentes intercaladas.
 *  - single: comportamiento idéntico al anterior.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { TenantDomain } from "./_core/tenantRegistry/contract";

// Ajustes por empresa (la caché real es por tenant; aquí un mapa por tenant del contexto)
const settings = vi.hoisted(() => ({ byTenant: {} as Record<string, Record<string, string>> }));
vi.mock("./config", async () => {
  const { peekTenantContext } = await import("./_core/tenant");
  const get = (k: string, fb = "") => settings.byTenant[peekTenantContext()?.tenantId ?? "default"]?.[k] || fb;
  return { getSystemSettingSync: get, getSystemSetting: async (k: string, fb = "") => get(k, fb) };
});

import { runWithTenant } from "./_core/tenant";
import { MemoryTenantRegistryStore } from "./_core/tenantRegistry/memoryStore";
import { TenantRegistryService, type Actor } from "./_core/tenantRegistry/service";
import { expectedTxtValue, VERIFY_LABEL, verifyAndRecordDomain, type DnsLookup } from "./_core/tenantRegistry/domainVerification";
import { MemoryOrganizationStore } from "./organization/service";
import {
  choosePublicDomain,
  configureTenantIdentity,
  peekTenantIdentity,
  registryIdentitySource,
  warmTenantIdentity,
} from "./_core/tenantIdentity";
import { publicBaseUrl } from "./_core/productIdentity";
import {
  brandName,
  brandSetting,
  formatLegalAddress,
  legacyBrandSetting,
  legacyBrandText,
  legacyUrl,
  resolveLegalCompany,
  tenantCommsConfig,
  tenantFiscalIdentity,
} from "./tenantBrand";

const OP: Actor = { type: "operator", id: "prueba" };
const TARGET = "edge.elephantsource.example";
const saved = { APP_URL: process.env.APP_URL, TENANT_MODE: process.env.TENANT_MODE };

/** Resolvedor DNS falso: registros en memoria, nunca la red. */
function fakeDns(records: { cname?: Record<string, string>; txt?: Record<string, string> }): DnsLookup {
  return {
    async resolveCname(h) {
      const v = records.cname?.[h];
      if (!v) throw Object.assign(new Error("ENODATA"), { code: "ENODATA" });
      return [v];
    },
    async resolveTxt(h) {
      const v = records.txt?.[h];
      if (!v) throw Object.assign(new Error("ENODATA"), { code: "ENODATA" });
      return [[v]];
    },
  };
}

let store: MemoryTenantRegistryStore;
let svc: TenantRegistryService;
let org: MemoryOrganizationStore;

async function seed() {
  store = new MemoryTenantRegistryStore();
  svc = new TenantRegistryService(store, () => {
    throw new Error("sin claves en esta prueba");
  });
  org = new MemoryOrganizationStore();
  for (const [id, name, custom] of [
    ["montana", "Montaña Ejemplo SL", "montana.example"],
    ["costa", "Costa Ejemplo SL", "costa.example"],
  ] as const) {
    await svc.createTenant({ id, displayName: name }, OP);
    await svc.addDomain(id, `${id}.plataforma.example`, "platform_subdomain", OP, { primary: true });
    await svc.activateDomain(`${id}.plataforma.example`, OP);
    await svc.addDomain(id, custom, "custom", OP);
  }
  const now = Date.now();
  const base = { country: "ES", isDefault: true, status: "active" as const, createdAt: now, createdBy: "prueba", updatedAt: now };
  await org.insertFiscalEntity({ ...base, tenantId: "montana", entityId: "principal", legalName: "Montaña Ejemplo SL", taxId: "B00000001", address: "Calle Cumbre 1, 00001 Pico" });
  await org.insertFiscalEntity({ ...base, tenantId: "costa", entityId: "principal", legalName: "Costa Ejemplo SL", taxId: "B00000002", address: "Paseo Playa 2, 00002 Arena" });
  settings.byTenant = {
    montana: { brand_name: "Montaña Ejemplo", brand_logo_url: "https://cdn.montana.example/logo.png", email_from_address: "hola@montana.example", email_reply_to: "reservas@montana.example" },
    // Costa sin ajustes de marca: su nombre sale del registro
    costa: {},
  };
  configureTenantIdentity(registryIdentitySource(store, org));
}

beforeEach(seed);
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  configureTenantIdentity(null);
});

const inTenant = <T>(id: string, fn: () => Promise<T> | T) => runWithTenant(id, async () => (await warmTenantIdentity(), fn()));

describe("elección del dominio público", () => {
  const d = (over: Partial<TenantDomain>): TenantDomain => ({
    domain: "x.example",
    tenantId: "t",
    kind: "custom",
    status: "active",
    isPrimary: false,
    verificationToken: null,
    verifiedAt: new Date(),
    activatedAt: new Date(),
    createdAt: new Date(),
    ...over,
  });
  it("un dominio propio pendiente o solo verificado (no activo) no se usa", () => {
    const platform = d({ domain: "t.plataforma.example", kind: "platform_subdomain" });
    expect(choosePublicDomain([d({ status: "pending_verification", verifiedAt: null }), platform])?.domain).toBe("t.plataforma.example");
    expect(choosePublicDomain([d({ status: "verified" }), platform])?.domain).toBe("t.plataforma.example");
    expect(choosePublicDomain([d({ status: "disabled" }), platform])?.domain).toBe("t.plataforma.example");
  });
  it("activo sin verificación registrada tampoco se usa; verificado y activo sí, el primario primero", () => {
    const platform = d({ domain: "t.plataforma.example", kind: "platform_subdomain" });
    expect(choosePublicDomain([d({ verifiedAt: null }), platform])?.domain).toBe("t.plataforma.example");
    expect(choosePublicDomain([d({ domain: "a.example" }), d({ domain: "b.example", isPrimary: true }), platform])?.domain).toBe("b.example");
  });
  it("sin dominios servibles: ninguno", () => {
    expect(choosePublicDomain([d({ status: "pending_verification", verifiedAt: null })])).toBeNull();
  });
});

describe("verificación del dominio propio (resolvedor DNS falso)", () => {
  it("pendiente → fallido (TXT incorrecto) → verificado (TXT correcto); el token nunca se audita", async () => {
    process.env.TENANT_MODE = "multi";
    const token = (await store.resolveDomain("montana.example"))!.domain.verificationToken!;
    const state = async () => (await inTenant("montana", () => peekTenantIdentity()))!.customDomains[0].state;
    expect(await state()).toBe("pending");

    const wrong = fakeDns({ cname: { "montana.example": TARGET }, txt: { [`${VERIFY_LABEL}.montana.example`]: "elephant-verify=otro" } });
    const r1 = await verifyAndRecordDomain({ reader: store, service: svc }, { domain: "montana.example", platformTarget: TARGET }, OP, wrong);
    expect(r1).toMatchObject({ ok: false, cname: true, txt: false });
    configureTenantIdentity(registryIdentitySource(store, org)); // vacía la instantánea
    expect(await state()).toBe("failed");
    expect((await store.resolveDomain("montana.example"))!.domain.status).toBe("pending_verification");

    const right = fakeDns({ cname: { "montana.example": TARGET }, txt: { [`${VERIFY_LABEL}.montana.example`]: expectedTxtValue(token) } });
    const r2 = await verifyAndRecordDomain({ reader: store, service: svc }, { domain: "montana.example", platformTarget: TARGET }, OP, right);
    expect(r2?.ok).toBe(true);
    configureTenantIdentity(registryIdentitySource(store, org));
    expect(await state()).toBe("verified");
    expect(JSON.stringify(await store.listEvents("montana"))).not.toContain(token);
    // Costa no se ve afectada
    expect((await inTenant("costa", () => peekTenantIdentity()))!.customDomains[0].state).toBe("pending");
  });

  it("un dominio que no está pendiente no se comprueba", async () => {
    expect(await verifyAndRecordDomain({ reader: store, service: svc }, { domain: "montana.plataforma.example", platformTarget: TARGET }, OP, fakeDns({}))).toBeNull();
    expect(await verifyAndRecordDomain({ reader: store, service: svc }, { domain: "nadie.example", platformTarget: TARGET }, OP, fakeDns({}))).toBeNull();
  });
});

describe("multi: URL, marca, fiscal y comunicaciones por empresa", () => {
  beforeEach(() => {
    process.env.TENANT_MODE = "multi";
    process.env.APP_URL = "https://instalacion-unica.example";
  });

  it("dominio propio no verificado no se usa: subdominio de plataforma", async () => {
    expect(await inTenant("montana", () => publicBaseUrl())).toBe("https://montana.plataforma.example");
    expect(await inTenant("costa", () => publicBaseUrl())).toBe("https://costa.plataforma.example");
  });

  it("verificado y activo: el dominio propio; la otra empresa sigue con el suyo", async () => {
    await svc.markDomainVerified("montana.example", OP);
    await svc.activateDomain("montana.example", OP);
    configureTenantIdentity(registryIdentitySource(store, org));
    expect(await inTenant("montana", () => publicBaseUrl())).toBe("https://montana.example");
    expect(await inTenant("montana", () => legacyUrl("https://www.skicenter.es"))).toBe("https://montana.example");
    expect(await inTenant("costa", () => publicBaseUrl())).toBe("https://costa.plataforma.example");
  });

  it("marca de cada empresa; sin ajuste, el nombre del registro; nunca los respaldos heredados", async () => {
    expect(await inTenant("montana", () => brandName())).toBe("Montaña Ejemplo");
    expect(await inTenant("costa", () => brandName())).toBe("Costa Ejemplo SL");
    expect(await inTenant("costa", () => legacyBrandText("Skicenter"))).toBe("Costa Ejemplo SL");
    expect(await inTenant("costa", () => brandSetting("brand_logo_url", "https://cdn.legado.example/logo.png"))).toBe("");
    expect(await inTenant("costa", () => brandSetting("email_reservations", "reservas@legado.example"))).toBe("");
    expect(await inTenant("montana", () => brandSetting("brand_logo_url", "https://cdn.legado.example/logo.png"))).toBe("https://cdn.montana.example/logo.png");
  });

  it("identidad fiscal desde la entidad fiscal de cada empresa (no constantes)", async () => {
    const legal = (id: string) => inTenant(id, () => resolveLegalCompany({ legalCompanyEmail: `admin@${id}.example` }, { multi: true, fiscal: tenantFiscalIdentity() }));
    const m = await legal("montana");
    const c = await legal("costa");
    expect(m).toMatchObject({ name: "Montaña Ejemplo SL", cif: "B00000001", address: "Calle Cumbre 1, 00001 Pico", email: "admin@montana.example" });
    expect(c).toMatchObject({ name: "Costa Ejemplo SL", cif: "B00000002", address: "Paseo Playa 2, 00002 Arena" });
    expect(formatLegalAddress(m)).toBe("Calle Cumbre 1, 00001 Pico");
    // Sin entidad fiscal ni ajustes: vacío, nunca la sociedad de la instalación histórica
    const none = resolveLegalCompany({}, { multi: true, fiscal: null });
    expect(JSON.stringify(none)).not.toMatch(/Iron Elephant|B26987875/);
    expect(none.name).toBe("");
  });

  it("comunicaciones por empresa (preparado, sin enviar)", async () => {
    expect(await inTenant("montana", () => tenantCommsConfig())).toEqual({ fromEmail: "hola@montana.example", fromName: "Montaña Ejemplo", replyTo: "reservas@montana.example" });
    expect(await inTenant("costa", () => tenantCommsConfig())).toEqual({ fromEmail: null, fromName: "Costa Ejemplo SL", replyTo: null });
  });

  it("sin cruces con peticiones concurrentes intercaladas", async () => {
    await svc.markDomainVerified("costa.example", OP);
    await svc.activateDomain("costa.example", OP);
    configureTenantIdentity(registryIdentitySource(store, org));
    const tick = () => new Promise((r) => setTimeout(r, Math.random() * 5));
    const one = (id: "montana" | "costa") =>
      runWithTenant(id, async () => {
        await tick();
        await warmTenantIdentity();
        await tick();
        const url = publicBaseUrl();
        await tick();
        return { id, url, brand: brandName(), cif: tenantFiscalIdentity()?.taxId };
      });
    const out = await Promise.all(Array.from({ length: 60 }, (_, i) => one(i % 2 ? "montana" : "costa")));
    for (const r of out) {
      if (r.id === "montana") expect(r).toEqual({ id: "montana", url: "https://montana.plataforma.example", brand: "Montaña Ejemplo", cif: "B00000001" });
      else expect(r).toEqual({ id: "costa", url: "https://costa.example", brand: "Costa Ejemplo SL", cif: "B00000002" });
    }
  });

  it("sin empresa en el contexto no hay identidad (no se adivina)", async () => {
    expect(await warmTenantIdentity()).toBeNull();
    expect(peekTenantIdentity()).toBeNull();
  });
});

describe("single: sin cambios", () => {
  beforeEach(() => {
    delete process.env.TENANT_MODE;
  });
  it("URL pública: APP_URL o vacío (nunca otro dominio), aunque haya registro configurado", async () => {
    process.env.APP_URL = "https://www.instalacion.example";
    expect(await warmTenantIdentity()).toBeNull();
    expect(publicBaseUrl()).toBe("https://www.instalacion.example");
    delete process.env.APP_URL;
    expect(publicBaseUrl()).toBe("");
    expect(legacyUrl("https://www.skicenter.es")).toBe("");
  });
  it("marca: el ajuste de la propia instalación; sin él, vacío (nunca el texto heredado escrito en el código)", () => {
    settings.byTenant.default = {};
    expect(brandName()).toBe("");
    expect(brandSetting("brand_short_name", "")).toBe("");
    expect(legacyBrandText("Nayade")).toBe("");
    expect(legacyBrandSetting("brand_support_phone", "+34 000")).toBe("");
    settings.byTenant.default = { brand_name: "Mi Marca" };
    expect(brandName()).toBe("Mi Marca");
  });
  it("fiscal: los datos de la propia instalación; sin ellos, vacío (nunca una sociedad fija ni la entidad del registro)", () => {
    const l = resolveLegalCompany({}, { multi: false, fiscal: { entityId: "x", legalName: "Otra", taxId: "B1", country: "ES", address: null } });
    expect(l).toEqual({ name: "", cif: "", address: "", city: "", zip: "", province: "", email: "", phone: "", iban: "" });
    expect(JSON.stringify(l)).not.toMatch(/Iron Elephant|B26987875/);
    const own = resolveLegalCompany({ legalCompanyName: "Propia SL", legalCompanyCif: "B2", legalCompanyAddress: "Calle 1", legalCompanyZip: "28001", legalCompanyCity: "Madrid", legalCompanyProvince: "Madrid" }, { multi: false, fiscal: null });
    expect(own).toMatchObject({ name: "Propia SL", cif: "B2" });
    expect(formatLegalAddress(own)).toBe("Calle 1, 28001 Madrid (Madrid)");
  });
});
