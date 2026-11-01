import fs from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { presetRange, validateRange, madridToday, formatDateKey } from "../client/src/pages/admin/tpv/tpvReportsLogic";
import { TASK_NAV, LEGACY_NAV } from "../shared/adminNav";
import { capabilityForProcedure } from "./_core/capabilities/routeGuard";

const read = (p: string) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");

describe("pantalla de informes del TPV", () => {
  it("periodos rápidos contados desde hoy en Madrid (también pasada la medianoche peninsular)", () => {
    // 31/12/2026 23:30 UTC = 01/01/2027 00:30 en Madrid
    const now = new Date("2026-12-31T23:30:00Z");
    expect(madridToday(now)).toBe("2027-01-01");
    expect(presetRange("hoy", now)).toEqual({ dateFrom: "2027-01-01", dateTo: "2027-01-01" });
    expect(presetRange("ayer", now)).toEqual({ dateFrom: "2026-12-31", dateTo: "2026-12-31" });
    expect(presetRange("7dias", now)).toEqual({ dateFrom: "2026-12-26", dateTo: "2027-01-01" });
    expect(presetRange("mes", now)).toEqual({ dateFrom: "2027-01-01", dateTo: "2027-01-01" });
    expect(presetRange("mesAnterior", now)).toEqual({ dateFrom: "2026-12-01", dateTo: "2026-12-31" });
    expect(presetRange("mesAnterior", new Date("2026-03-15T10:00:00Z"))).toEqual({ dateFrom: "2026-02-01", dateTo: "2026-02-28" });
  });

  it("valida el periodo antes de pedirlo", () => {
    expect(validateRange("2026-06-01", "2026-06-30")).toBeNull();
    expect(validateRange("2026-06-30", "2026-06-01")).toMatch(/posterior/);
    expect(validateRange("", "2026-06-01")).toMatch(/dos fechas/);
    expect(validateRange("2025-01-01", "2026-06-01")).toMatch(/un año/);
    expect(formatDateKey("2026-06-10")).toBe("10/06/2026");
  });

  it("calcula en el servidor y exporta por sección; sin términos sectoriales", () => {
    const src = read("client/src/pages/admin/tpv/TpvReports.tsx");
    expect(src).toContain("trpc.tpv.reports.summary.useQuery");
    expect(src).toContain("utils.tpv.reports.exportCsv.fetch");
    // Solo tRPC: ni fetch directo ni axios
    expect(src).not.toMatch(/(^|[^.\w])fetch\(|axios/);
    expect(src).not.toMatch(/experiencia|actividad|reserva|hotel|\bspa\b|REAV/i);
    expect(read("client/src/App.tsx")).toContain('path="/admin/tpv/informes"');
    expect(read("client/src/pages/admin/tpv/TpvBackoffice.tsx")).toContain('href="/admin/tpv/informes"');
  });

  it("menú y licencia: «Informes de caja» bajo Caja con la licencia del TPV", () => {
    const caja = TASK_NAV.flatMap((s) => s.items).find((i) => i.key === "t-caja")!;
    expect(caja.children?.map((c) => [c.label, c.href])).toContainEqual(["Informes de caja", "/admin/tpv/informes"]);
    expect(caja.children?.every((c) => c.capabilities?.includes("bill-cash"))).toBe(true);
    expect(LEGACY_NAV.find((i) => i.label === "TPV")!.children!.map((c) => c.href)).toContain("/admin/tpv/informes");
    for (const p of ["tpv.reports.summary", "tpv.reports.exportCsv", "tpv.reports.registers"]) expect(capabilityForProcedure(p)).toBe("bill-cash");
  });
});
