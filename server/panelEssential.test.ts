/**
 * Panel de la empresa (Fase P0): menú por licencias, resumen de suscripción y validaciones de los
 * formularios del recorrido Essential. Lógica pura + el procedimiento `subscription.overview`.
 */
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./subscriptionDb", () => ({
  PANEL_ROLES: ["admin", "agente", "monitor", "adminrest", "controler"],
  countPanelUsers: vi.fn(async () => 2),
}));

import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import { runWithTenant } from "./_core/tenant";
import { _resetCapabilityAccessForTests, configureCapabilityAccess } from "./_core/capabilities/access";
import { MemoryCapabilityStore } from "./_core/capabilities/store";
import type { CapabilityGrant } from "./_core/capabilities/model";
import { CAPABILITY_IDS, capabilitiesOfTier } from "./catalog/capabilities";
import { buildSubscriptionOverview, effectiveStatus, safeUpgradeUrl } from "./subscriptionOverview";
import {
  LEGACY_NAV, LEGACY_SECTIONS, TASK_NAV, capabilityStateFrom, navMode, resolveNav, type NavContext,
} from "../shared/adminNav";
import {
  isValidIban, isValidSpanishTaxId, missingFiscalFields, validateEmail, validateFiscalData, validatePostalCodeES, validateProductForm,
} from "../shared/formValidation";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 16, 10, 0, 0);

const grant = (capabilityId: string, o: Partial<CapabilityGrant> = {}): CapabilityGrant => ({
  tenantId: "acme",
  capabilityId,
  siteId: "",
  status: "active",
  validUntil: null,
  source: "subscription:1",
  updatedAt: NOW,
  updatedBy: "test",
  ...o,
});
const essentialTrial = (endsAt: number) => capabilitiesOfTier("essential").map((id) => grant(id, { source: "trial:7", validUntil: endsAt }));

const allVisible: NavContext = { role: "admin", isFlagVisible: () => true, isModuleVisible: () => true, capabilityState: () => "active" };
const labels = (sections: ReturnType<typeof resolveNav>) => sections.flatMap((s) => s.items.map((i) => i.label));

describe("resumen de suscripción (servidor)", () => {
  it("modo single: menú de siempre, sin plan ni límites", () => {
    const o = buildSubscriptionOverview({ mode: "single", enforcing: false, grants: [grant("crm-leads")], now: NOW });
    expect(o).toMatchObject({ mode: "single", licensing: "legacy", plan: null, state: "none", capabilities: [], limits: [] });
  });

  it("shadow se comporta como single", () => {
    expect(buildSubscriptionOverview({ mode: "shadow", enforcing: false, grants: [], now: NOW }).licensing).toBe("legacy");
  });

  it("multi sin licencias ni aplicación activa (empresa anterior al motor): no se oculta nada", () => {
    expect(buildSubscriptionOverview({ mode: "multi", enforcing: false, grants: [], now: NOW }).licensing).toBe("legacy");
  });

  it("multi con aplicación activa y sin licencias: menú por licencias vacío (falla cerrado)", () => {
    const o = buildSubscriptionOverview({ mode: "multi", enforcing: true, grants: [], now: NOW });
    expect(o.licensing).toBe("capabilities");
    expect(o.visible).toEqual([]);
    expect(o.plan).toBeNull();
  });

  it("prueba Essential en curso: plan, días restantes, capacidades y límites del catálogo", () => {
    const o = buildSubscriptionOverview({ mode: "multi", enforcing: false, grants: essentialTrial(NOW + 10 * DAY + 3600_000), now: NOW, usedUsers: 2 });
    expect(o.licensing).toBe("capabilities");
    expect(o.plan).toEqual({ key: "essential", name: "Essential" });
    expect(o.state).toBe("trial");
    expect(o.trial).toEqual({ endsAt: NOW + 10 * DAY + 3600_000, daysLeft: 11 });
    expect(o.visible.sort()).toEqual(capabilitiesOfTier("essential").sort());
    expect(o.readOnly).toEqual([]);
    expect(o.limits).toEqual([
      { metric: "users", label: "Usuarios", included: 3, used: 2 },
      { metric: "sites", label: "Sedes", included: 1, used: null },
      { metric: "fiscal_entities", label: "Entidades fiscales", included: 1, used: null },
    ]);
  });

  it("prueba pública (suscripción en prueba con caducidad): estado «trial», no «active»; tras pagar, «active»", () => {
    const trialing = capabilitiesOfTier("essential").map((id) => grant(id, { source: "subscription:4", validUntil: NOW + 15 * DAY }));
    const o = buildSubscriptionOverview({ mode: "multi", enforcing: true, grants: trialing, now: NOW });
    expect(o.state).toBe("trial");
    expect(o.trial).toEqual({ endsAt: NOW + 15 * DAY, daysLeft: 15 });
    expect(buildSubscriptionOverview({ mode: "multi", enforcing: true, grants: trialing, now: NOW + 16 * DAY }).state).toBe("trial_expired");
    const paid = capabilitiesOfTier("essential").map((id) => grant(id, { source: "subscription:4", validUntil: null }));
    const p = buildSubscriptionOverview({ mode: "multi", enforcing: true, grants: paid, now: NOW + 16 * DAY });
    expect(p.state).toBe("active");
    expect(p.trial).toBeNull();
  });

  it("prueba vencida: todo en solo lectura y 0 días", () => {
    const o = buildSubscriptionOverview({ mode: "multi", enforcing: true, grants: essentialTrial(NOW - DAY), now: NOW });
    expect(o.state).toBe("trial_expired");
    expect(o.trial?.daysLeft).toBe(0);
    expect(o.readOnly.length).toBe(capabilitiesOfTier("essential").length);
    expect(o.capabilities.every((c) => c.status === "expired")).toBe(true);
  });

  it("suscripción Business con un extra: plan Business, sin prueba, extra visible", () => {
    const grants = [...capabilitiesOfTier("essential"), ...capabilitiesOfTier("business"), "people-hr"].map((id) => grant(id));
    const o = buildSubscriptionOverview({ mode: "multi", enforcing: true, grants, now: NOW });
    expect(o.plan?.key).toBe("business");
    expect(o.state).toBe("active");
    expect(o.trial).toBeNull();
    expect(o.visible).toContain("people-hr");
    expect(o.limits.find((l) => l.metric === "users")?.included).toBe(15);
  });

  it("estados no operables no se muestran como visibles", () => {
    const grants = [grant("crm-leads"), grant("people-hr", { status: "suspended" }), grant("tax-filings", { status: "contracted" }), grant("cms-blog", { status: "read_only" })];
    const o = buildSubscriptionOverview({ mode: "multi", enforcing: true, grants, now: NOW });
    expect(o.visible.sort()).toEqual(["cms-blog", "crm-leads"]);
    expect(o.readOnly).toEqual(["cms-blog"]);
    expect(o.capabilities.find((c) => c.id === "people-hr")?.status).toBe("suspended");
    expect(effectiveStatus(grants, "voice-ai", NOW)).toBeNull();
  });

  it("una licencia solo de una sede no hace visible la capacidad en el menú de empresa", () => {
    const o = buildSubscriptionOverview({ mode: "multi", enforcing: true, grants: [grant("crm-leads"), grant("hotel-net", { siteId: "centro" })], now: NOW });
    expect(o.visible).toEqual(["crm-leads"]);
  });

  it("el enlace de ampliar solo admite https sin credenciales", () => {
    expect(safeUpgradeUrl("https://elephant.example/precios")).toBe("https://elephant.example/precios");
    expect(safeUpgradeUrl("http://elephant.example")).toBeNull();
    expect(safeUpgradeUrl("javascript:alert(1)")).toBeNull();
    expect(safeUpgradeUrl("https://u:p@elephant.example")).toBeNull();
    expect(safeUpgradeUrl("")).toBeNull();
  });
});

describe("subscription.overview (tRPC)", () => {
  const ctxFor = (role: string): TrpcContext => ({
    user: { id: 1, openId: "o", email: "a@empresa.example", name: "Ana", loginMethod: "local", role, createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() } as NonNullable<TrpcContext["user"]>,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  });
  const prevMode = process.env.TENANT_MODE;
  const prevUrl = process.env.ELEPHANT_PRICING_URL;
  beforeEach(() => {
    _resetCapabilityAccessForTests();
  });
  afterEach(() => {
    if (prevMode === undefined) delete process.env.TENANT_MODE;
    else process.env.TENANT_MODE = prevMode;
    if (prevUrl === undefined) delete process.env.ELEPHANT_PRICING_URL;
    else process.env.ELEPHANT_PRICING_URL = prevUrl;
    _resetCapabilityAccessForTests();
  });

  it("un cliente (rol user) no puede consultarlo", async () => {
    await expect(appRouter.createCaller(ctxFor("user")).subscription.overview()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("modo single: legacy", async () => {
    delete process.env.TENANT_MODE;
    const r = await appRouter.createCaller(ctxFor("admin")).subscription.overview();
    expect(r.licensing).toBe("legacy");
  });

  it("modo multi: lee las licencias de la empresa del contexto y no las de otra", async () => {
    process.env.TENANT_MODE = "multi";
    process.env.ELEPHANT_PRICING_URL = "https://elephant.example/planes";
    const store = new MemoryCapabilityStore();
    await store.apply("acme", capabilitiesOfTier("essential").map((id) => ({ capabilityId: id, siteId: "", status: "active" as const, validUntil: Date.now() + 5 * DAY, source: "trial:1" })), { actor: "t", reason: null, now: Date.now() });
    await store.apply("otra", [{ capabilityId: "people-hr", siteId: "", status: "active", validUntil: null, source: "subscription:9" }], { actor: "t", reason: null, now: Date.now() });
    configureCapabilityAccess(store, { enforce: false });
    const r = await runWithTenant("acme", () => appRouter.createCaller(ctxFor("admin")).subscription.overview());
    expect(r.licensing).toBe("capabilities");
    expect(r.plan?.key).toBe("essential");
    expect(r.state).toBe("trial");
    expect(r.trial?.daysLeft).toBe(5);
    expect(r.visible).not.toContain("people-hr");
    expect(r.upgradeUrl).toBe("https://elephant.example/planes");
    expect(r.limits.find((l) => l.metric === "users")?.used).toBe(2);
  });

  it("modo multi con el registro caído: error controlado (el panel cae al menú de siempre)", async () => {
    process.env.TENANT_MODE = "multi";
    const store = new MemoryCapabilityStore();
    store.setFailing(true);
    configureCapabilityAccess(store, { enforce: false });
    await expect(runWithTenant("acme", () => appRouter.createCaller(ctxFor("admin")).subscription.overview())).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
  });
});

describe("menú del panel", () => {
  it("modo de menú: cargando, legacy (solo single o por el servidor), por tareas o error", () => {
    expect(navMode({ isLoading: true, isError: false })).toBe("loading");
    // Un fallo nunca da el menú de siempre: solo el modo single lo da
    expect(navMode({ isLoading: false, isError: true })).toBe("error");
    expect(navMode({ isLoading: false, isError: true, install: "multi" })).toBe("error");
    expect(navMode({ isLoading: false, isError: true, install: "single" })).toBe("legacy");
    expect(navMode({ isLoading: false, isError: false })).toBe("loading");
    expect(navMode({ data: { licensing: "legacy", visible: [], readOnly: [] }, isLoading: false, isError: false })).toBe("legacy");
    expect(navMode({ data: { licensing: "capabilities", visible: [], readOnly: [] }, isLoading: false, isError: false })).toBe("tasks");
  });

  it("Náyade (single): el menú de siempre no pierde ninguna entrada para el administrador", () => {
    const resolved = resolveNav(LEGACY_SECTIONS, allVisible);
    const expected = LEGACY_NAV.filter((i) => i.roles.includes("admin"));
    expect(labels(resolved)).toEqual(expected.map((i) => i.label));
    const hrefs = resolved.flatMap((s) => s.items.flatMap((i) => [i.href, ...(i.children ?? []).map((c) => c.href)]));
    for (const must of ["/admin/crm/clientes", "/admin/productos/lego-packs", "/admin/hotel", "/admin/spa", "/admin/personal/nominas", "/admin/gestoria/iva", "/admin/contabilidad/conciliacion-tpv", "/admin/configuracion/email"]) {
      expect(hrefs).toContain(must);
    }
  });

  it("Náyade: flags y módulos siguen ocultando lo desactivado y los roles se respetan", () => {
    const ctx: NavContext = { ...allVisible, isFlagVisible: (k) => k !== "hotel_module_enabled" && k !== "commercial_email_enabled", isModuleVisible: (m) => m !== "spa" };
    const l = labels(resolveNav(LEGACY_SECTIONS, ctx));
    expect(l).not.toContain("Hotel");
    expect(l).not.toContain("SPA");
    const ac = resolveNav(LEGACY_SECTIONS, ctx).flatMap((s) => s.items).find((i) => i.label === "Atención Comercial");
    expect(ac?.children?.map((c) => c.label)).not.toContain("Email Comercial");
    expect(labels(resolveNav(LEGACY_SECTIONS, { ...allVisible, role: "adminrest" }))).toEqual(["Restaurantes"]);
    expect(labels(resolveNav(LEGACY_SECTIONS, { ...allVisible, role: "controler" }))).toEqual(["Control Diario"]);
  });

  it("empresa Essential: grupos por tareas, sin módulos no contratados", () => {
    const o = buildSubscriptionOverview({ mode: "multi", enforcing: true, grants: essentialTrial(NOW + 5 * DAY), now: NOW });
    const resolved = resolveNav(TASK_NAV, { ...allVisible, capabilityState: capabilityStateFrom(o) });
    expect(resolved.map((s) => s.label)).toEqual([null, "Clientes y ventas", "Catálogo y comercio", "Web", "Facturación", "Organización", "Suscripción", null]);
    const l = labels(resolved);
    for (const must of ["Inicio", "Clientes", "Presupuestos", "Pedidos", "Productos y servicios", "Páginas", "Facturas", "Usuarios y permisos", "Datos de la empresa", "Plan y uso"]) expect(l).toContain(must);
    for (const not of ["Personal", "Impuestos y gestoría", "Hotel", "Restaurantes", "WhatsApp", "Llamadas IA", "Proveedores", "Viajes (REAV)"]) expect(l).not.toContain(not);
    expect(resolved.flatMap((s) => s.items).every((i) => !i.readOnly)).toBe(true);
  });

  it("empresa con un extra contratado: aparece en «Módulos contratados»", () => {
    const grants = [...essentialTrial(NOW + 5 * DAY), grant("people-hr")];
    const o = buildSubscriptionOverview({ mode: "multi", enforcing: true, grants, now: NOW });
    const resolved = resolveNav(TASK_NAV, { ...allVisible, capabilityState: capabilityStateFrom(o) });
    expect(resolved.find((s) => s.id === "contratados")?.items.map((i) => i.label)).toEqual(["Personal"]);
  });

  it("prueba vencida: las entradas siguen visibles pero marcadas como solo lectura", () => {
    const o = buildSubscriptionOverview({ mode: "multi", enforcing: true, grants: essentialTrial(NOW - DAY), now: NOW });
    const items = resolveNav(TASK_NAV, { ...allVisible, capabilityState: capabilityStateFrom(o) }).flatMap((s) => s.items);
    expect(items.find((i) => i.label === "Clientes")?.readOnly).toBe(true);
    expect(items.find((i) => i.label === "Plan y uso")?.readOnly).toBe(false);
  });

  it("sin licencias: solo Inicio, Suscripción, Ayuda y Soporte (nada no contratado aparece como activo)", () => {
    const resolved = resolveNav(TASK_NAV, { ...allVisible, capabilityState: () => null });
    expect(labels(resolved)).toEqual(["Inicio", "Plan y uso", "Amplía tu empresa", "Ayuda", "Soporte"]);
  });

  it("agente comercial: solo ventas y facturación de cara al cliente", () => {
    const resolved = resolveNav(TASK_NAV, { ...allVisible, role: "agente" });
    // «Suscripción» solo con «Amplía tu empresa» (también para el equipo)
    expect(resolved.map((s) => s.id)).toEqual(["inicio", "ventas", "facturacion", "contratados", "suscripcion", "ayuda"]);
    expect(labels(resolved)).not.toContain("Usuarios y permisos");
    expect(labels(resolved)).not.toContain("Plan y uso");
    expect(labels(resolved)).toContain("Amplía tu empresa");
  });

  it("toda capacidad citada en el menú existe en el catálogo", () => {
    const caps = new Set(CAPABILITY_IDS);
    for (const s of TASK_NAV) for (const i of s.items) for (const c of [...(i.capabilities ?? []), ...(i.children ?? []).flatMap((ch) => ch.capabilities ?? [])]) expect(caps.has(c), c).toBe(true);
  });

  it("toda entrada del menú lleva a una pantalla existente (sin pantallas vacías inventadas)", () => {
    const app = fs.readFileSync(path.resolve(__dirname, "../client/src/App.tsx"), "utf8");
    const routes = new Set(Array.from(app.matchAll(/<Route path="([^"]+)"/g), (m) => m[1]));
    for (const s of [...TASK_NAV, ...LEGACY_SECTIONS]) {
      for (const i of s.items) {
        for (const href of [i.href, ...(i.children ?? []).map((c) => c.href)]) {
          const p = href.split(/[?#]/)[0];
          expect(routes.has(p), href).toBe(true);
        }
      }
    }
  });

  it("claves de entrada únicas en el menú por tareas", () => {
    const keys = TASK_NAV.flatMap((s) => s.items.map((i) => i.key ?? i.href));
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("validaciones de formularios", () => {
  it("NIF, NIE y CIF con dígito de control", () => {
    expect(isValidSpanishTaxId("12345678Z")).toBe(true);
    expect(isValidSpanishTaxId("12345678A")).toBe(false);
    expect(isValidSpanishTaxId("X1234567L")).toBe(true);
    expect(isValidSpanishTaxId("B12345674")).toBe(true);
    expect(isValidSpanishTaxId("B12345675")).toBe(false);
    expect(isValidSpanishTaxId("b-1234567-4")).toBe(true);
    expect(isValidSpanishTaxId("P1234567D")).toBe(true);
    expect(isValidSpanishTaxId("ABC")).toBe(false);
  });

  it("IBAN, correo y código postal", () => {
    expect(isValidIban("ES91 2100 0418 4502 0005 1332")).toBe(true);
    expect(isValidIban("ES91 2100 0418 4502 0005 1333")).toBe(false);
    expect(validateEmail("ana@empresa.example")).toBeNull();
    expect(validateEmail("ana@", true)).toMatch(/no es válido/);
    expect(validateEmail("", true)).toMatch(/Indica/);
    expect(validateEmail("")).toBeNull();
    expect(validatePostalCodeES("28001")).toBeNull();
    expect(validatePostalCodeES("99999")).toMatch(/5 cifras/);
  });

  it("datos fiscales: vacío se permite mientras se rellena; lo escrito tiene que ser válido", () => {
    const empty = { legalCompanyName: "", legalCompanyCif: "", legalCompanyAddress: "", legalCompanyCity: "", legalCompanyZip: "", legalCompanyProvince: "", legalCompanyEmail: "", legalCompanyPhone: "", legalCompanyIban: "" };
    expect(validateFiscalData(empty)).toEqual({});
    const bad = validateFiscalData({ ...empty, legalCompanyCif: "B12345675", legalCompanyZip: "123", legalCompanyIban: "ES00" });
    expect(Object.keys(bad).sort()).toEqual(["legalCompanyCif", "legalCompanyIban", "legalCompanyZip"]);
    expect(missingFiscalFields(empty)).toEqual(["razón social", "NIF o CIF", "domicilio fiscal", "código postal", "municipio"]);
    expect(missingFiscalFields({ legalCompanyName: "Acme, S.L.", legalCompanyCif: "B12345674", legalCompanyAddress: "C/ Mayor 1", legalCompanyZip: "28001", legalCompanyCity: "Madrid" })).toEqual([]);
  });

  it("producto: obligatorios, precio, cantidades y descuento", () => {
    const base = { title: "", basePrice: "", categoryId: "", locationId: "", pricingType: "per_person", unitCapacity: "", minPersons: "1", maxPersons: "", discountPercent: "" };
    expect(Object.keys(validateProductForm(base)).sort()).toEqual(["basePrice", "categoryId", "locationId", "title"]);
    const ok = { ...base, title: "Consultoría", basePrice: "49,90", categoryId: "1", locationId: "2" };
    expect(validateProductForm(ok)).toEqual({});
    expect(validateProductForm({ ...ok, basePrice: "-1" }).basePrice).toMatch(/mayor que 0/);
    expect(validateProductForm({ ...ok, minPersons: "5", maxPersons: "2" }).maxPersons).toMatch(/menor que el mínimo/);
    expect(validateProductForm({ ...ok, pricingType: "per_unit" }).unitCapacity).toMatch(/personas/);
    expect(validateProductForm({ ...ok, discountPercent: "150" }).discountPercent).toMatch(/entre 0 y 100/);
  });
});
