/**
 * Lote E5 de Economía (Resumen, Control diario, Cuenta de resultados e Informes de ventas): composición, formato único de
 * euros, textos con t() en español y alemán, sin colores literales ni formateadores propios, y las cifras que pinta la
 * pantalla son las del servidor (el formato no redondea ni recalcula).
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { formatAxisEur, formatEur, formatPercent } from "../client/src/lib/money";
import { flatten, type Messages } from "../shared/i18n/core";
import esSummary from "../shared/i18n/locales/es/economySummary";
import esDaily from "../shared/i18n/locales/es/economyDaily";
import esPl from "../shared/i18n/locales/es/economyPl";
import esReport from "../shared/i18n/locales/es/economyReport";
import deSummary from "../shared/i18n/locales/de/economySummary";
import deDaily from "../shared/i18n/locales/de/economyDaily";
import dePl from "../shared/i18n/locales/de/economyPl";
import deReport from "../shared/i18n/locales/de/economyReport";

const read = (p: string) => fs.readFileSync(path.resolve(__dirname, "../client/src/pages/admin/accounting", p), "utf8").replace(/\r\n/g, "\n");
const dict = (ns: string, m: unknown) => flatten(m as Messages, ns);
const ES = { ...dict("economySummary", esSummary), ...dict("economyDaily", esDaily), ...dict("economyPl", esPl), ...dict("economyReport", esReport) };
const DE = { ...dict("economySummary", deSummary), ...dict("economyDaily", deDaily), ...dict("economyPl", dePl), ...dict("economyReport", deReport) };

const SCREENS = ["AccountingDashboard.tsx", "DailyControlCenter.tsx", "ProfitLossReport.tsx", "AccountingReports.tsx"];
const FILES = [...SCREENS, "shared/EconomyReport.tsx", "shared/profitLossCsv.ts"];
const NS = "economy(?:Summary|Daily|Pl|Report)";

describe("Formato de cifras de las cuatro pantallas (E5)", () => {
  // Los mismos importes que devuelve la API simulada (siete cifras, negativos, céntimos)
  const SERVER = [4_567_890.12, 1_234_567.89, -123_456.78, 4_321_000.5, 2673.86, -0.004, 0];

  it("el euro sale con miles siempre, coma decimal, «−» real y el símbolo sin partirse (español y alemán)", () => {
    expect(SERVER.map((v) => formatEur(v))).toEqual([
      "4.567.890,12 €", "1.234.567,89 €", "−123.456,78 €", "4.321.000,50 €", "2.673,86 €", "0,00 €", "0,00 €",
    ]);
    expect(SERVER.map((v) => formatEur(v, { locale: "de" }))).toEqual(SERVER.map((v) => formatEur(v)));
  });

  it("el formato no cambia el valor: cada texto, leído de vuelta, es el importe del servidor a dos decimales", () => {
    for (const v of SERVER.slice(0, 5)) {
      const back = Number(formatEur(v).replace(/[^\d,−-]/g, "").replace(/\./g, "").replace("−", "-").replace(",", "."));
      expect(back).toBeCloseTo(v, 2);
    }
  });

  it("los porcentajes y los ejes usan el idioma y no inventan decimales", () => {
    expect(formatPercent(29.7)).toBe("29,7 %");
    expect(formatPercent(12)).toBe("12 %");
    expect(formatPercent(-33.2, { locale: "de" })).toBe("−33,2 %");
    expect(formatPercent(53, { maxDecimals: 0 })).toBe("53 %");
    expect(formatAxisEur(1_400_000)).toBe("1,4 M €");
    expect(formatAxisEur(220_000)).toBe("220 mil €");
    expect(formatAxisEur(0)).toBe("0 €");
    expect(formatAxisEur(-250_000)).toMatch(/^−250/);
  });

  it("las pantallas no llevan toFixed, toLocaleString, Intl propio ni formateadores locales de euros", () => {
    for (const f of [...SCREENS, "shared/EconomyReport.tsx"]) {
      const src = read(f);
      expect(src, f).not.toContain("toFixed(");
      expect(src, f).not.toContain("toLocaleString");
      expect(src, f).not.toContain("toLocaleDateString");
      expect(src, f).not.toContain("Intl.NumberFormat");
      expect(src, f).not.toMatch(/const (fmt|fmtEur|fmtEurLocal)\b/);
      expect(src, f).not.toMatch(/function fmt\w*\(/);
    }
  });

  it("el único toFixed está en la exportación CSV (formato de intercambio) y no en la pantalla", () => {
    expect(read("shared/profitLossCsv.ts")).toContain("toFixed(2)");
    expect(read("ProfitLossReport.tsx")).toContain("buildProfitLossCsv");
  });
});

describe("Composición de las cuatro pantallas (E5)", () => {
  it("las consultas y los permisos no cambian", () => {
    const r = read("AccountingDashboard.tsx");
    for (const q of ["accounting.getSummary", "accounting.getTransactions", "accounting.getDashboardMetrics", "cardTerminalBatches.getReconciliationStats", "bankMovements.getExpenseStats", "bankMovements.getCashflowForecast", "gestoria.executiveSummary", "financial.expenses.distortionKpi"]) expect(r).toContain(`trpc.${q}.useQuery`);
    for (const cap of ["tax-filings", "bank-import-pos", "supplier-settlements", "crm-quotes"]) expect(r).toContain(`"${cap}"`);
    expect(read("DailyControlCenter.tsx")).toContain("trpc.dailyControl.cancelOperation.useMutation");
    expect(read("DailyControlCenter.tsx")).toContain("cancelMut.mutate({ type: cancelOp.type, id: cancelOp.id })");
    expect(read("ProfitLossReport.tsx")).toContain("trpc.financial.profitLoss.report.useQuery({ dateFrom, dateTo, conciliatedOnly, view })");
    expect(read("AccountingReports.tsx")).toContain("trpc.accounting.getReports.useQuery");
  });

  it("Resumen: cifras clave y gráfico primero; salud, tesorería, conciliación y gastos en una fila de atención ordenada por urgencia", () => {
    const r = read("AccountingDashboard.tsx");
    expect(r.indexOf("<KeyBand")).toBeGreaterThan(0);
    expect(r.indexOf("<KeyBand")).toBeLessThan(r.indexOf("<ResponsiveContainer"));
    expect(r.indexOf("<ResponsiveContainer")).toBeLessThan(r.indexOf("<AttentionRow"));
    expect(r.indexOf("<AttentionRow")).toBeLessThan(r.indexOf("economySummary.latest.title"));
    for (const id of ['id: "health"', 'id: "cash"', 'id: "recon"', 'id: "expenses"']) expect(r).toContain(id);
    expect(r).toContain("<EconomyTable");
    expect(r).toContain("transacciones`}>{t(\"economySummary.latest.all\")}");
    expect(r).toContain("<CollapsibleSection");
    const rep = read("shared/EconomyReport.tsx");
    expect(rep).toContain("ATTENTION_ORDER");
    expect(rep).toMatch(/danger: 0, warning: 1/);
  });

  it("Control diario: pestañas en la URL, operaciones con tarjetas, paginación de 25, anular en menú con etiqueta y sin sección duplicada de ayer", () => {
    const d = read("DailyControlCenter.tsx");
    expect(d).toContain('useUrlParam("tab", TABS, "hoy")');
    expect(d).toContain('const TABS = ["hoy", "caja", "actividades", "fiscal"] as const');
    expect(d).toContain("<InnerTabs");
    expect(d).toContain("useState(25)");
    expect(d).toContain("<EconomyPager");
    expect(d).toContain("<RowActions");
    expect(d).toContain('t("economyDaily.ops.cancel")');
    expect(d).toContain("mobileCard={opCard}");
    expect(d).toContain("<EconomyFilterBar");
    expect(d).not.toContain("comparison");
    expect(d).not.toContain("Cascade:");
    // la comparativa con ayer vive como flecha en cada cifra
    expect(d.match(/withDelta\(kpis\?\.pct/g)?.length).toBe(3);
    expect(d).not.toMatch(/\bprompt\(|window\.confirm\(/);
  });

  it("Cuenta de resultados: un único «Ver como», etiqueta persistente, tres cifras, gráfico, puente y desglose en pestañas con la misma tabla", () => {
    const p = read("ProfitLossReport.tsx");
    expect(p).toContain('t("economyPl.viewAs")');
    expect(p).toContain('data-testid="pl-mode-tag"');
    expect(p).toContain("<ComposedChart");
    expect(p.indexOf("<ComposedChart")).toBeLessThan(p.indexOf("<SegmentedTabs"));
    expect(p).toContain('const DESGLOSE = ["canal", "producto", "categoria", "centro"] as const');
    expect(p.match(/<EconomyTable/g)?.length).toBe(2);
    expect(p).toContain("economyPl.bridge.title");
    expect(p).toContain("economyPl.distortion.title");
    expect(p).not.toContain("getCashflowForecast");
  });

  it("Informes: nombre único, periodo fijo y apilado, canal y método en una tarjeta con pestañas, IVA en tabla con tarjetas, sin previsión ni rentabilidad duplicadas", () => {
    const a = read("AccountingReports.tsx");
    expect(a).toContain("sticky top-0");
    expect(a).toContain("grid-cols-1 gap-3 sm:grid-cols-2");
    expect(a).toContain("<SegmentedTabs");
    expect(a).toContain("<EconomyTable");
    expect(a).not.toContain("getCashflowForecast");
    expect(a).not.toContain("Rentabilidad por canal");
    expect(a).toContain('href="/admin/contabilidad/dashboard"');
    expect(a).toContain('href="/admin/contabilidad/cuenta-resultados"');
    const shell = fs.readFileSync(path.resolve(__dirname, "../shared/i18n/locales/es/economyShell.ts"), "utf8");
    expect(shell).toContain('reports: "Informes de ventas"');
  });

  it("sin <table> crudas, sin hexadecimales ni colores fijos y sin recortes de Tailwind", () => {
    for (const f of FILES) {
      const src = read(f);
      expect(src, f).not.toContain("<table");
      expect(src, f).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(src, f).not.toMatch(/\b(?:bg|text|border|fill|stroke)-(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/);
      expect(src, f).not.toMatch(/className="[^"]*\btruncate\b/);
      expect(src, f).not.toMatch(/\bp-6\b/);
    }
    const rep = read("shared/EconomyReport.tsx");
    expect(rep).toContain('"var(--chart-1)"');
  });
});

describe("Textos de las cuatro pantallas (E5)", () => {
  it("cada clave usada con t() existe en español y en alemán", () => {
    const missing: string[] = [];
    for (const f of FILES) {
      const src = read(f);
      for (const m of src.matchAll(new RegExp(`\\bt\\(\\s*"(${NS}\\.[A-Za-z0-9_.]+)"`, "g"))) {
        if (!(m[1] in ES)) missing.push(`es:${m[1]}`);
        if (!(m[1] in DE)) missing.push(`de:${m[1]}`);
      }
      // claves compuestas: todas las del grupo existen en ambos idiomas
      for (const m of src.matchAll(new RegExp(`\\bt\\(\`(${NS}\\.[A-Za-z0-9_.]+)\\.\\$\\{`, "g"))) {
        const keys = Object.keys(ES).filter((k) => k.startsWith(`${m[1]}.`));
        if (keys.length === 0) missing.push(`es:${m[1]}.*`);
        for (const k of keys) if (!(k in DE)) missing.push(`de:${k}`);
      }
    }
    expect([...new Set(missing)]).toEqual([]);
  });

  it("las claves dinámicas tienen todas sus variantes", () => {
    for (const k of ["completado", "pendiente", "fallido", "reembolsado"]) expect(ES[`economySummary.status.${k}`]).toBeTruthy();
    for (const k of ["cobro_reserva", "cobro_tpv", "devolucion", "anulacion", "factura", "caja_in", "caja_out"]) { expect(ES[`economyDaily.kind.${k}`]).toBeTruthy(); expect(ES[`economyDaily.kindFilter.${k}`]).toBeTruthy(); }
    for (const k of ["paid", "pending", "cancelled", "refunded"]) expect(ES[`economyDaily.status.tpv.${k}`]).toBeTruthy();
    for (const k of ["paid", "pending_payment", "draft", "cancelled", "failed", "refunded"]) expect(ES[`economyDaily.status.reservation.${k}`]).toBeTruthy();
    for (const k of ["PAGADO", "PENDIENTE", "PAGO_PARCIAL", "PENDIENTE_VALIDACION"]) expect(ES[`economyDaily.payStatus.${k}`]).toBeTruthy();
    for (const k of ["canal", "producto", "categoria", "centro"]) { expect(ES[`economyPl.breakdown.tab.${k}`]).toBeTruthy(); expect(ES[`economyPl.breakdown.col.${k}`]).toBeTruthy(); }
    for (const k of ["web", "tpv", "phone", "agency", "direct", "admin"]) expect(ES[`economyPl.channel.${k}`]).toBeTruthy();
    for (const k of ["tpv", "web", "online", "crm", "admin", "delegado", "otro"]) expect(ES[`economyReport.channel.${k}`]).toBeTruthy();
    for (const k of ["efectivo", "tarjeta", "tarjeta_fisica", "bizum", "redsys", "tarjeta_redsys", "link_pago", "transferencia", "otro"]) expect(ES[`economyReport.method.${k}`]).toBeTruthy();
  });

  it("ambos idiomas tienen las mismas claves y el alemán no es copia del español (salvo siglas y marcadores)", () => {
    expect(Object.keys(DE).sort()).toEqual(Object.keys(ES).sort());
    const SAME_OK = ["economyDaily.ops.typeTpv", "economyPl.tag", "economyPl.channel.web", "economyPl.channel.admin", "economyReport.channel.web", "economyReport.channel.online", "economyReport.channel.admin", "economyReport.method.bizum", "economyDaily.channels.people", "economyPl.view.fiscal", "economyDaily.ops.people", "economyDaily.act.people", "economyDaily.fiscal.resNote"];
    const same = Object.keys(ES).filter((k) => !SAME_OK.includes(k) && ES[k] === DE[k] && /[a-záéíóúñ]{4,}/i.test(ES[k]));
    expect(same).toEqual([]);
  });

  it("nada visible queda en español sin pasar por t(): sin literales con acentos ni emojis en el marcado", () => {
    for (const f of SCREENS) {
      const src = read(f);
      const jsxText = [...src.matchAll(/>\s*([^<>{}\n]*[áéíóúñ¿¡][^<>{}\n]*)\s*</g)].map((m) => m[1].trim()).filter((x) => x && !x.startsWith("//") && !x.startsWith("*"));
      expect(jsxText, f).toEqual([]);
      expect(src, f).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
      const attrs = [...src.matchAll(/(?:title|aria-label|placeholder|label)="([^"{}]*[áéíóúñ¿¡][^"{}]*)"/g)].map((m) => m[1]);
      expect(attrs, f).toEqual([]);
    }
  });
});
