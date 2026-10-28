/**
 * Contabilidad del panel de empresa: sin cifras inventadas ni controles que no hacen nada (variaciones fijas,
 * selector de periodo sin efecto, exportaciones «próximamente»).
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const src = fs.readFileSync(path.resolve(__dirname, "../client/src/pages/admin/accounting/AccountingDashboard.tsx"), "utf8");

describe("contabilidad del panel de empresa", () => {
  it("no muestra variaciones porcentuales escritas a mano ni controles sin efecto", () => {
    expect(src).not.toMatch(/change:\s*"[+-]\d/);
    expect(src).not.toContain("Función disponible próximamente");
    expect(src).not.toContain("onValueChange={setPeriod}");
    expect(src).toContain("trpc.accounting.getDashboardMetrics.useQuery");
  });
});
