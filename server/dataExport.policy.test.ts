/**
 * Política de acceso a la exportación tal como está IMPLEMENTADA hoy (docs/elephant-source/EXPORTACION_DATOS.md):
 *
 *  - Prueba, activa, gracia: se puede exportar (escrituras permitidas).
 *  - Suscripción terminada → empresa `suspended` (panel en solo lectura, sin web pública): se puede pedir y
 *    descargar (únicas escrituras permitidas además de la sesión), también con las licencias en solo lectura.
 *  - Fin de los 30 días de solo lectura: el motor de ciclo de vida CANCELA las licencias (`read_only_end`), pero la
 *    empresa sigue `suspended`: la exportación NO depende de ninguna licencia, así que sigue disponible hasta que
 *    un operador archive la empresa. No hay corte automático ni borrado (decisión pendiente).
 *  - Archivada / en borrado / borrada: el resolver bloquea todo (410), también la exportación y las descargas.
 */
import { describe, it, expect } from "vitest";
import { accessPolicy } from "./_core/tenantRegistry/lifecycle";
import { isSessionPath } from "./_core/tenantRegistry/tenantMiddleware";
import { TRPC_ROUTER_CAPABILITIES } from "./_core/capabilities/routeGuard";
import { adminTenantLister } from "./_core/tenantRegistry/jobs";

describe("acceso a la exportación según el estado de la empresa", () => {
  it("prueba, activa y gracia: panel y escrituras", () => {
    for (const s of ["trial", "active", "grace"] as const) expect(accessPolicy(s)).toMatchObject({ admin: true, writes: true });
  });

  it("suspendida (suscripción terminada o impago): panel sin escrituras salvo pedir y descargar la exportación", () => {
    expect(accessPolicy("suspended")).toMatchObject({ admin: true, writes: false, publicWeb: false });
    expect(isSessionPath("/api/trpc/dataExport.request")).toBe(true);
    expect(isSessionPath("/api/trpc/dataExport.link")).toBe(true);
    expect(isSessionPath("/api/trpc/dataExport.request,crm.clients.create")).toBe(false);
  });

  it("la exportación no depende de ninguna licencia: sigue disponible al cancelarse las licencias tras los 30 días", () => {
    expect(Object.keys(TRPC_ROUTER_CAPABILITIES).filter((k) => k === "dataExport" || k.startsWith("dataExport."))).toEqual([]);
  });

  it("archivada, en borrado o borrada: sin panel (el resolver devuelve 410) ni trabajo de exportación", async () => {
    for (const s of ["archived", "deleting", "deleted"] as const) expect(accessPolicy(s)).toMatchObject({ admin: false, writes: false, blockedStatus: 410 });
    const reader = { listTenants: async () => [{ id: "a", status: "suspended" }, { id: "b", status: "archived" }] } as never;
    expect(await adminTenantLister(reader)()).toEqual(["a"]);
  });
});
