/**
 * Pulido del recorrido de una empresa nueva (v2.0.0): mantenimiento de la web solo cuando es una función de la
 * empresa, nombre de la empresa en el panel antes de guardar su identidad, cierre de diálogos con área táctil
 * suficiente y restos de vocabulario de Náyade en modo pyme.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ multi: false, name: "" }));
vi.mock("./_core/tenant", async (orig) => ({ ...(await orig<typeof import("./_core/tenant")>()), isMultiTenant: () => state.multi }));
vi.mock("./db", async (orig) => ({ ...(await orig<typeof import("./db")>()), getDb: async () => null }));
vi.mock("./tenantBrand", async (orig) => ({ ...(await orig<typeof import("./tenantBrand")>()), brandName: () => state.name }));
vi.mock("./_core/tenantIdentity", async (orig) => ({ ...(await orig<typeof import("./_core/tenantIdentity")>()), warmTenantIdentity: async () => null }));

import { maintenanceControlMode } from "../client/src/components/admin/MaintenanceModeControl";
import { buildVocabulary } from "../shared/vocabulary";

const read = (p: string) => fs.readFileSync(path.resolve(__dirname, "..", p), "utf8");

describe("mantenimiento de la web en el encabezado del panel", () => {
  it("una sola empresa: el control de siempre (solo administración)", () => {
    expect(maintenanceControlMode({ role: "admin", install: "single", canWeb: false })).toBe("technical");
    expect(maintenanceControlMode({ role: "agente", install: "single", canWeb: true })).toBeNull();
  });
  it("multiempresa: «Web en mantenimiento» solo si gestiona su web; sin web o sin saber el modo, nada", () => {
    expect(maintenanceControlMode({ role: "admin", install: "multi", canWeb: true })).toBe("web");
    expect(maintenanceControlMode({ role: "admin", install: "multi", canWeb: false })).toBeNull();
    expect(maintenanceControlMode({ role: "admin", install: null, canWeb: true })).toBeNull();
  });
  it("los textos de la empresa son claros y sin términos técnicos ni de reservas", () => {
    const src = read("client/src/components/admin/MaintenanceModeControl.tsx");
    const web = src.slice(src.indexOf("  web: {"), src.indexOf("} as const"));
    expect(web).toContain(`on: "Web en mantenimiento"`);
    expect(web).not.toMatch(/\/admin|rutas|[Rr]eserv|ACTIVO/);
    const msg = src.slice(src.indexOf("const WEB_DEFAULT_MESSAGE"), src.indexOf("const DEFAULT_MESSAGE"));
    expect(msg).not.toMatch(/reserv|actividad/i);
    expect(read("client/src/components/AdminLayout.tsx")).toContain("{maintenanceMode && <MaintenanceModeControl mode={maintenanceMode} />}");
  });
});

describe("nombre de la empresa en el panel antes de guardar su identidad", () => {
  it("multiempresa sin nombre guardado: el del registro; single: sin cambios", async () => {
    const { configRouter } = await import("./routers/configRouter");
    const caller = configRouter.createCaller({ user: null, req: {} as never, res: {} as never } as never);
    state.multi = true;
    state.name = "Panadería Sol";
    expect((await caller.getPublicSettings()).brand_name).toBe("Panadería Sol");
    state.name = "";
    expect((await caller.getPublicSettings()).brand_name).toBeUndefined();
    state.multi = false;
    state.name = "Panadería Sol";
    expect((await caller.getPublicSettings()).brand_name).toBeUndefined();
  });
});

describe("cierre de los diálogos", () => {
  it("área táctil de 40 px y etiqueta en español", () => {
    const src = read("client/src/components/ui/dialog.tsx");
    const close = src.match(/<DialogPrimitive\.Close\s+data-slot="dialog-close"\s+className="([^"]*)"/)?.[1] ?? "";
    expect(close.split(" ")).toEqual(expect.arrayContaining(["size-10", "inline-flex", "items-center", "justify-center"]));
    expect(src).toContain(`<span className="sr-only">Cerrar</span>`);
    expect(src).not.toContain(`<span className="sr-only">Close</span>`);
  });
});

describe("restos de vocabulario de Náyade en modo pyme", () => {
  it("bono de compensación: término según el modo", () => {
    expect(buildVocabulary({ licensed: false }).voucherItem).toBe("Actividad");
    expect(buildVocabulary({ licensed: true }).voucherItem).toBe("Producto o servicio");
    expect(buildVocabulary({ licensed: true }).voucherItemExample).not.toMatch(/Day Pass/);
  });
  it("anulaciones: sin «reserva» ni «actividad» fijas", () => {
    const src = read("client/src/pages/admin/crm/CancellationDetailModal.tsx");
    for (const fixed of ['"Reserva vinculada"', ">Desglose de la reserva<", "Total reserva<", 'label="Vincular reserva"', 'title="Vincular a reserva del CRM"', ">Actividad del bono<", 'placeholder="Ej: Day Pass"', "Busca por número de reserva", "Actividad: <strong"]) {
      expect(src, fixed).not.toContain(fixed);
    }
    expect(src).toContain("useVocabulary()");
  });
  it("catálogo: borrar con un diálogo propio, sin confirm() del navegador", () => {
    const src = read("client/src/pages/admin/products/ExperiencesManager.tsx");
    expect(src).not.toMatch(/(?<![\w`])confirm\(/);
    expect(src).toContain("<AlertDialog open={deleteTarget !== null}");
  });
  it("estado del sistema y asistente antiguo: sin «reservas» ni «Branding» para una pyme", () => {
    expect(read("client/src/pages/admin/settings/ConfigStatus.tsx")).toContain("label: `Email de ${voc.ordersLower}`");
    const legacy = read("client/src/pages/admin/onboarding/OnboardingWizard.tsx");
    expect(legacy).toContain(`sub.install === "multi") return <Redirect to="/admin/primeros-pasos" />`);
    expect(legacy).not.toContain(`title: "Branding"`);
  });
});
