/**
 * Estructura del panel (v2.0.0): sin caída al menú de Náyade por un fallo, rutas no contratadas,
 * mensajes de error legibles y el modo de instalación en los ajustes públicos.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { toast } from "sonner";
import {
  INSTALL_MODE_SETTING, UPGRADE_PATH, capabilityStateFrom, installModeFrom, navMode, routeAccess, routeCapabilities,
} from "../shared/adminNav";
import { errorMessage, errorToastMessage, serverMessage, toastError } from "../client/src/lib/errorMessage";
import { sanitizeErrorShape } from "./_core/trpc";
import { NOT_ADMIN_ERR_MSG, UNAUTHED_ERR_MSG } from "../shared/const";

const env = { ...process.env };
afterEach(() => {
  if (env.TENANT_MODE === undefined) delete process.env.TENANT_MODE;
  else process.env.TENANT_MODE = env.TENANT_MODE;
});

const ESSENTIAL = [
  "crm-contacts", "crm-accounts", "crm-activity", "crm-tags", "crm-leads", "crm-quotes", "crm-tasks",
  "shop-catalog", "shop-variants", "shop-store", "shop-checkout", "shop-orders", "shop-coupons",
  "cms-editor", "cms-domain", "cms-pages-forms", "cms-blog", "cms-seo",
  "bill-invoices", "bill-series", "bill-taxes", "bill-payments", "bill-cash", "bill-reports",
  "admin-panel", "admin-users", "comms-email", "comms-whatsapp-links", "auto-basic",
];
const essential = capabilityStateFrom({ licensing: "capabilities", visible: ESSENTIAL, readOnly: [] });

describe("modo del panel (navMode)", () => {
  it("multiempresa: un fallo da «error», nunca el menú de siempre", () => {
    expect(navMode({ isLoading: false, isError: true, install: "multi" })).toBe("error");
    expect(navMode({ isLoading: false, isError: true, install: null })).toBe("error");
    expect(navMode({ isLoading: true, isError: false, install: "multi" })).toBe("loading");
    // Consulta desactivada (sin sesión o rol sin panel): esperar, no inventar un menú
    expect(navMode({ isLoading: false, isError: false, install: "multi" })).toBe("loading");
  });

  it("single (Náyade): el menú de siempre aunque la suscripción falle o no haya llegado", () => {
    expect(navMode({ isLoading: false, isError: true, install: "single" })).toBe("legacy");
    expect(navMode({ isLoading: true, isError: false, install: "single" })).toBe("legacy");
  });

  it("los datos del servidor mandan", () => {
    expect(navMode({ data: { licensing: "capabilities", visible: [], readOnly: [] }, isLoading: false, isError: true, install: "single" })).toBe("tasks");
    expect(navMode({ data: { licensing: "legacy", visible: [], readOnly: [] }, isLoading: false, isError: false, install: "multi" })).toBe("legacy");
  });

  it("modo de instalación desde los ajustes públicos", () => {
    expect(installModeFrom({ [INSTALL_MODE_SETTING]: "multi" })).toBe("multi");
    expect(installModeFrom({ [INSTALL_MODE_SETTING]: "single", brand_name: "X" })).toBe("single");
    expect(installModeFrom({ [INSTALL_MODE_SETTING]: "otro" })).toBeNull();
    expect(installModeFrom({})).toBeNull();
    expect(installModeFrom(undefined)).toBeNull();
  });
});

describe("config.getPublicSettings incluye el modo de instalación", () => {
  it("single y multi, también sin base de datos", async () => {
    const { configRouter } = await import("./routers/configRouter");
    const caller = configRouter.createCaller({ user: null, req: {} as never, res: {} as never } as never);
    delete process.env.TENANT_MODE;
    expect((await caller.getPublicSettings())[INSTALL_MODE_SETTING]).toBe("single");
    process.env.TENANT_MODE = "shadow";
    expect((await caller.getPublicSettings())[INSTALL_MODE_SETTING]).toBe("single");
  });
});

describe("guardián de rutas no contratadas", () => {
  it("Essential: lo contratado se abre; lo no contratado da «no incluido»", () => {
    for (const path of ["/admin/crm/clientes", "/admin/crm", "/admin/productos/experiencias", "/admin/cms/blog", "/admin/contabilidad/informes", "/admin/numeracion", "/admin/usuarios", "/admin/configuracion/marca"]) {
      expect(routeAccess(path, essential), path).toBe("allowed");
    }
    for (const path of ["/admin/personal", "/admin/personal/empleados/7", "/admin/gestoria/iva", "/admin/hotel", "/admin/restaurantes/reservas", "/admin/fiscal/reav", "/admin/atencion-comercial/whatsapp", "/admin/atencion-comercial/agente-ia", "/admin/suppliers", "/admin/settlements", "/admin/marketing/cupones", "/admin/contabilidad/movimientos-bancarios", "/admin/partners"]) {
      expect(routeAccess(path, essential), path).toBe("not_included");
    }
  });

  it("rutas sin capacidad (inicio, suscripción, ayuda, mi cuenta, ampliar) siempre se abren", () => {
    const none = () => null;
    for (const path of ["/admin", "/admin/suscripcion", "/admin/ayuda/clientes", "/admin/soporte", "/admin/mi-cuenta", UPGRADE_PATH, "/admin/primeros-pasos"]) {
      expect(routeCapabilities(path), path).toBeNull();
      expect(routeAccess(path, none), path).toBe("allowed");
    }
  });

  it("la entrada más específica gana y la consulta (?tab=) no cuenta", () => {
    expect(routeCapabilities("/admin/marketing/descuentos")).toEqual(["shop-coupons"]);
    expect(routeCapabilities("/admin/contabilidad/caja")).toEqual(["bill-cash"]);
    expect(routeCapabilities("/admin/contabilidad/gastos")).toEqual(["bill-reports"]);
    expect(routeCapabilities("/admin/crm?tab=invoices")).toEqual(expect.arrayContaining(["crm-leads", "bill-invoices", "shop-orders"]));
    expect(routeAccess("/admin/marketing/descuentos", essential)).toBe("allowed");
  });

  it("solo lectura se distingue de no incluido", () => {
    const ro = capabilityStateFrom({ licensing: "capabilities", visible: ["bill-reports"], readOnly: ["bill-reports"] });
    expect(routeAccess("/admin/contabilidad/dashboard", ro)).toBe("read_only");
    expect(routeAccess("/admin/crm/clientes", ro)).toBe("not_included");
  });
});

describe("mensajes de error", () => {
  const trpcErr = (message: string, code?: string, httpStatus?: number) => ({ message, data: code || httpStatus ? { code, httpStatus } : undefined });

  it("textos de sesión y permiso en español con su código (contrato del cliente)", () => {
    expect(UNAUTHED_ERR_MSG).toMatch(/^Inicia sesión.*\(10001\)$/);
    expect(NOT_ADMIN_ERR_MSG).toMatch(/\(10002\)$/);
    expect(NOT_ADMIN_ERR_MSG).not.toMatch(/permission|login/i);
  });

  it("aviso: mensaje funcional del servidor, sin su código", () => {
    expect(errorToastMessage(trpcErr("Ya existe un código con ese nombre", "CONFLICT", 409))).toBe("Ya existe un código con ese nombre");
    expect(errorToastMessage(trpcErr(NOT_ADMIN_ERR_MSG, "FORBIDDEN", 403))).toBe("No tienes permiso para realizar esta acción");
    expect(serverMessage(trpcErr("Tu usuario es de solo lectura: no puede modificar datos."))).toBe("Tu usuario es de solo lectura: no puede modificar datos.");
  });

  it("aviso: nada técnico ni en inglés", () => {
    expect(errorToastMessage(trpcErr("Database not available", "INTERNAL_SERVER_ERROR", 500))).toBe("No se ha podido completar la operación. Inténtalo de nuevo.");
    expect(errorToastMessage(trpcErr('[{"code":"too_small","minimum":1,"path":["name"]}]', "BAD_REQUEST", 400))).toMatch(/^Revisa los datos/);
    expect(errorToastMessage(trpcErr("Failed to fetch"))).toMatch(/No hay conexión/);
    expect(errorToastMessage(trpcErr(UNAUTHED_ERR_MSG, "UNAUTHORIZED", 401))).toMatch(/sesión ha caducado/);
    expect(errorToastMessage(null, "No se ha podido guardar.")).toBe("No se ha podido guardar.");
  });

  it("errorMessage conserva su comportamiento en pantallas de datos", () => {
    expect(errorMessage(trpcErr("x", "FORBIDDEN", 403))).toMatch(/plan o tu usuario/);
    expect(errorMessage(trpcErr("cualquier cosa", "INTERNAL_SERVER_ERROR", 500))).toBe("No se han podido cargar los datos.");
  });

  it("toastError muestra el aviso común", () => {
    toastError(trpcErr("Database not available", "INTERNAL_SERVER_ERROR", 500));
    expect(toast.error).toHaveBeenCalledWith("No se ha podido completar la operación. Inténtalo de nuevo.");
  });

  it("servidor: «Database not available» y similares llegan como mensaje genérico", () => {
    const shape = (message: string) => ({ message, code: -32603, data: { code: "INTERNAL_SERVER_ERROR", httpStatus: 500 } });
    for (const m of ["Database not available", "DB not available", "DB no disponible", "Base de datos no disponible", "RBAC: DB connection unavailable", "BUILT_IN_FORGE_API_URL is not configured", "TENANT_MODE=multi requiere REGISTRY_DATABASE_URL"]) {
      const err = new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: m });
      expect(sanitizeErrorShape(shape(m), err).message, m).toBe("Error interno. Inténtalo más tarde.");
    }
    const ok = new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "No se pudo generar el PDF" });
    expect(sanitizeErrorShape(shape(ok.message), ok).message).toBe("No se pudo generar el PDF");
  });
});
