/**
 * Lote E2 de Economía (Transacciones y Gastos): los indicadores salen del resumen del servidor (no de la página), todos los
 * textos pasan por t() y las claves existen en español y en alemán.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import es from "../shared/i18n/locales/es/economyTx";
import esExp from "../shared/i18n/locales/es/economyExp";
import esShell from "../shared/i18n/locales/es/economyShell";
import esCfg from "../shared/i18n/locales/es/accountingConfig";
import de from "../shared/i18n/locales/de/economyTx";
import deExp from "../shared/i18n/locales/de/economyExp";
import deShell from "../shared/i18n/locales/de/economyShell";
import deCfg from "../shared/i18n/locales/de/accountingConfig";
import { flatten, type Messages } from "../shared/i18n/core";

const read = (p: string) => fs.readFileSync(path.resolve(__dirname, "../client/src/pages/admin/accounting", p), "utf8").replace(/\r\n/g, "\n");
const dict = (ns: string, m: unknown) => flatten(m as Messages, ns);
const ES = { ...dict("economyTx", es), ...dict("economyExp", esExp), ...dict("economyShell", esShell), ...dict("accountingConfig", esCfg) };
const DE = { ...dict("economyTx", de), ...dict("economyExp", deExp), ...dict("economyShell", deShell), ...dict("accountingConfig", deCfg) };

const FILES = ["TransactionsList.tsx", "ExpensesManager.tsx", "RecurringExpensesManager.tsx", "ExpenseCategoriesManager.tsx", "ExpenseSuppliersManager.tsx", "CostCentersManager.tsx", "shared/EconomyUi.tsx", "shared/EconomyParts.tsx"];

describe("Transacciones y Gastos (E2)", () => {
  it("los totales salen del servidor para el filtro completo, sin etiqueta «de esta página»", () => {
    const tx = read("TransactionsList.tsx");
    const ex = read("ExpensesManager.tsx");
    expect(tx).toContain("trpc.accounting.getTransactionsSummary.useQuery(filterParams)");
    expect(ex).toContain("trpc.financial.expenses.filterSummary.useQuery(filterInput)");
    for (const src of [tx, ex]) expect(src).not.toContain("PageOnlyTag");
    // La búsqueda de gastos viaja al servidor (antes filtraba solo la página cargada)
    expect(ex).toContain("search: debouncedSearch || undefined");
    expect(ex).not.toMatch(/\.filter\(\(e\) => \{\s*if \(search/);
  });

  it("cada clave usada con t() existe en español y en alemán", () => {
    const missing: string[] = [];
    for (const f of FILES) {
      const src = read(f);
      for (const m of src.matchAll(/\bt\(\s*"((?:economyTx|economyExp|economyShell|accountingConfig)\.[A-Za-z0-9_.]+)"/g)) {
        if (!(m[1] in ES)) missing.push(`es:${m[1]}`);
        if (!(m[1] in DE)) missing.push(`de:${m[1]}`);
      }
    }
    expect([...new Set(missing)]).toEqual([]);
  });

  it("ambos idiomas tienen las mismas claves y los textos alemanes no son copia del español (salvo siglas)", () => {
    expect(Object.keys(DE).sort()).toEqual(Object.keys(ES).sort());
    const NAMES = ["economyTx.method.bizum", "economyTx.method.redsys", "economyTx.regime.reav", "economyTx.detail.reference"]; // nombres propios y siglas
    const same = Object.keys(ES).filter((k) => k.startsWith("economyTx.") || k.startsWith("economyExp.")).filter((k) => !NAMES.includes(k) && ES[k] === DE[k] && /[a-záéíóúñ]{4,}/i.test(ES[k]));
    expect(same).toEqual([]);
  });

  it("sin clase truncate ni colores literales en las pantallas del lote", () => {
    for (const f of FILES) {
      const src = read(f);
      expect(src, f).not.toMatch(/className="[^"]*\btruncate\b/);
      expect(src, f).not.toMatch(/#[0-9a-fA-F]{6}\b/);
    }
  });
});
