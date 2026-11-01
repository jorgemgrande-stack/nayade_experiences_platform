/**
 * Cosméticos del cierre de Essential 2.0: textos (mayúsculas, singular, nombre de la pasarela) y contraste AA de
 * las etiquetas y textos que la prueba integral marcó, en claro y en oscuro.
 */
import fs from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import { describe, it, expect } from "vitest";
import { transactionDescription } from "../shared/transactionText";
import { AA, DARK_SURFACE, LIGHT_SURFACE, SEMANTIC_COLORS, mixHex } from "../shared/panelTheme";
import { buildGestoriaInvoiceZip } from "./gestoriaInvoiceExport";
import { resolveExportPeriod } from "../shared/gestoriaExportPeriod";
import type { FiscalDocument } from "./fiscalDocuments";

const read = (p: string) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");

function lum(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  const f = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(n >> 16) + 0.7152 * f((n >> 8) & 255) + 0.0722 * f(n & 255);
}
const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

describe("textos", () => {
  it("variantes de precio en minúscula salvo la inicial", () => {
    const src = read("client/src/pages/admin/products/VariantsManager.tsx");
    expect(src).toContain('"Nueva variante de precio"');
    expect(src).toContain('"Crear variante"');
    expect(src).not.toMatch(/Nueva Variante de Precio|Crear Variante/);
  });

  it("los cobros con tarjeta en la web se muestran «Pago con tarjeta» (también los ya guardados)", () => {
    expect(transactionDescription("Pago online Redsys — 036209E3FE — Cambio de escobillas")).toBe("Pago con tarjeta — 036209E3FE — Cambio de escobillas");
    expect(transactionDescription("Venta en caja TPV-2026-0001")).toBe("Venta en caja TPV-2026-0001");
    expect(transactionDescription(null)).toBeNull();
    expect(read("server/redsysRoutes.ts")).not.toContain("Pago online Redsys");
    for (const f of ["AccountingDashboard", "TransactionsList"]) expect(read(`client/src/pages/admin/accounting/${f}.tsx`)).toContain("transactionDescription(");
  });

  it("LEEME del ZIP de la gestoría: «1 sustituido», «2 sustituidos»", async () => {
    const period = resolveExportPeriod({ kind: "quarter", year: 2026, quarter: 2 } as never);
    const ticket = (n: number, by: string | null): FiscalDocument => ({ kind: "ticket", id: n, number: `TPV-2026-000${n}`, issuedAt: new Date("2026-05-10T10:00:00Z"), clientName: "", clientNif: "", rectifies: "", status: "Cobrado", counts: !by, substitutedBy: by, byRate: [], base: 0, tax: 0, notSubject: 0, total: 0 });
    const readme = async (tickets: FiscalDocument[]) => {
      const out = await buildGestoriaInvoiceZip({ companyName: "Empresa Prueba SL", period, rows: [], originalNumbers: new Map(), pdfFor: async () => Buffer.from("%PDF"), tickets, generatedAt: new Date("2026-07-02T10:00:00Z") });
      return (await JSZip.loadAsync(out.buffer)).file("LEEME.txt")!.async("string");
    };
    expect(await readme([ticket(1, "FAC-2026-0006"), ticket(2, null)])).toContain("Tickets de caja (facturas simplificadas): 2 (1 sustituido por su factura completa)");
    expect(await readme([ticket(1, "FAC-2026-0006"), ticket(2, "FAC-2026-0007")])).toContain("(2 sustituidos por su factura completa)");
  });
});

describe("contraste AA", () => {
  it("las insignias de significado (fondo al 10 % del tono) se leen en los dos modos", () => {
    for (const [name, c] of Object.entries(SEMANTIC_COLORS.light)) {
      expect(ratio(c, mixHex(LIGHT_SURFACE, c, 0.1)), `claro ${name}`).toBeGreaterThanOrEqual(AA);
      expect(ratio(c, mixHex("#ffffff", c, 0.1)), `claro ${name} sobre blanco`).toBeGreaterThanOrEqual(AA);
    }
    for (const [name, c] of Object.entries(SEMANTIC_COLORS.dark)) expect(ratio(c, mixHex(DARK_SURFACE, c, 0.1)), `oscuro ${name}`).toBeGreaterThanOrEqual(AA);
  });

  it("el globo de avisos: texto del fondo de la página sobre el tono de error (no blanco sobre rojo claro)", () => {
    expect(ratio("#ffffff", SEMANTIC_COLORS.light.danger)).toBeGreaterThanOrEqual(AA);
    expect(ratio(DARK_SURFACE, SEMANTIC_COLORS.dark.danger)).toBeGreaterThanOrEqual(AA);
    const src = read("client/src/components/AdminLayout.tsx");
    expect(src).not.toContain("bg-red-500 text-white");
    expect(src.split("bg-danger text-background").length - 1).toBe(2);
  });

  it("textos marcados por la prueba integral con tokens del panel", () => {
    expect(read("client/src/pages/admin/crm/CRMDashboard.tsx")).toContain('<span className="text-info">Env. ');
    expect(read("client/src/pages/admin/crm/ProposalsManager.tsx")).toContain('<span className="text-info">Env. ');
    for (const f of ["client/src/pages/admin/crm/CRMDashboard.tsx", "client/src/pages/admin/crm/ProposalsManager.tsx"]) {
      expect(read(f)).toMatch(/aceptado: +\{ label: "Aceptado", +className: TONE_BADGE\.success \}/);
    }
    const reports = read("client/src/pages/admin/accounting/AccountingReports.tsx");
    expect(reports).toContain('className="gap-2 text-foreground">');
    expect(reports).toContain("font-semibold text-success\">{fmtEurLocal(r.amount)}");
    expect(read("client/src/pages/admin/tpv/TpvScreen.tsx")).toContain('<p className="text-muted-foreground">Caja: <span className="text-foreground font-medium">');
  });
});
