/**
 * Ski Net sin Elephant People: el profesor vinculado usa «Mis clases» del portal del empleado.
 *  - El guardián de licencias tumba una petición agrupada entera si una consulta no está contratada (por eso el portal
 *    envía sus consultas sueltas): agrupadas, `hr.portal.me` arrastraba `skiSchool.myClasses`; sueltas, no.
 *  - Sin Personal (o sin ficha de empleado), un profesor ve solo «Mis clases»; el resto, los avisos de siempre.
 */
import { describe, it, expect } from "vitest";
import { capabilityRouteGuard } from "./_core/capabilities/routeGuard";
import { employeePortalMode, unbatchedTrpcPath } from "../shared/employeePortal";

/** Licencia de Ski Net sin People (lo demás, contratado). */
const skiWithoutPeople = () => ({
  check: async (cap: string) => (cap === "people-hr" ? { allowed: false, reason: "Personal no contratado", status: null } : { allowed: true }),
});

async function guard(url: string): Promise<{ status: number; capability?: string } | "next"> {
  const mw = capabilityRouteGuard(skiWithoutPeople as never);
  return new Promise((resolve) => {
    let status = 0;
    const res = { status: (s: number) => ((status = s), res), json: (b: any) => resolve({ status, capability: b?.error?.json?.data?.capability }) };
    void mw({ url, method: "GET" } as never, res as never, () => resolve("next"));
  });
}

describe("portal del empleado de un profesor de Ski Net sin Elephant People", () => {
  it("agrupadas, el 403 de Personal arrastra «Mis clases»; sueltas, «Mis clases» pasa el guardián", async () => {
    expect(await guard("/hr.portal.me,skiSchool.myClasses?batch=1&input=%7B%7D")).toEqual({ status: 403, capability: "people-hr" });
    expect(await guard("/skiSchool.myClasses")).toBe("next");
    expect(await guard("/hr.portal.me")).toEqual({ status: 403, capability: "people-hr" });
  });

  it("el portal envía sus consultas sueltas; el resto del panel sigue agrupado", () => {
    expect(unbatchedTrpcPath("/empleado")).toBe(true);
    expect(unbatchedTrpcPath("/empleado/clases")).toBe(true);
    expect(unbatchedTrpcPath("/admin")).toBe(false);
    expect(unbatchedTrpcPath("/empleados")).toBe(false);
  });

  it("modo del portal: profesor sin Personal o sin ficha → solo «Mis clases»; sin ser profesor, los avisos", () => {
    const noPeople = { code: "FORBIDDEN", capability: "people-hr" };
    const noFicha = { code: "FORBIDDEN" };
    expect(employeePortalMode(noPeople, true)).toBe("teacher_only");
    expect(employeePortalMode(noFicha, true)).toBe("teacher_only");
    expect(employeePortalMode(noPeople, false)).toBe("unavailable");
    expect(employeePortalMode(noFicha, false)).toBe("not_linked");
    expect(employeePortalMode(null, true)).toBe("full");
    expect(employeePortalMode(undefined, false)).toBe("full");
  });
});
