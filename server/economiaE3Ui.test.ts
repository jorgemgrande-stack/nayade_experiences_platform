/**
 * Lote E3 de Economía (Caja y Movimientos bancarios): los indicadores salen del servidor (no de la página), todos los
 * textos pasan por t() y las claves existen en español y en alemán, el «ajuste» de caja no aparenta una salida y no hay
 * emojis, recortes de Tailwind ni colores literales.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import esBank from "../shared/i18n/locales/es/economyBank";
import esCash from "../shared/i18n/locales/es/economyCash";
import esShell from "../shared/i18n/locales/es/economyShell";
import deBank from "../shared/i18n/locales/de/economyBank";
import deCash from "../shared/i18n/locales/de/economyCash";
import deShell from "../shared/i18n/locales/de/economyShell";
import { flatten, type Messages } from "../shared/i18n/core";

const read = (p: string) => fs.readFileSync(path.resolve(__dirname, "../client/src/pages/admin/accounting", p), "utf8").replace(/\r\n/g, "\n");
const dict = (ns: string, m: unknown) => flatten(m as Messages, ns);
const ES = { ...dict("economyBank", esBank), ...dict("economyCash", esCash), ...dict("economyShell", esShell) };
const DE = { ...dict("economyBank", deBank), ...dict("economyCash", deCash), ...dict("economyShell", deShell) };

const FILES = ["BankMovementsManager.tsx", "CashRegisterManager.tsx"];

describe("Caja y Movimientos bancarios (E3)", () => {
  it("los totales salen del servidor para el filtro completo, sin etiqueta «de esta página»", () => {
    const b = read("BankMovementsManager.tsx");
    const c = read("CashRegisterManager.tsx");
    expect(b).toContain("trpc.bankMovements.movementsSummary.useQuery({ ...baseFilter, conciliation })");
    expect(b).not.toContain("PageOnlyTag");
    expect(b).not.toMatch(/movements\.filter\(\(m\) => m\.status === "pendiente"/);
    expect(c).toContain("trpc.cashRegister.overview.useQuery()");
    expect(c).toContain("trpc.cashRegister.movementsSummary.useQuery(movFilter)");
    expect(c).toContain("trpc.cashRegister.listMovementsPage.useQuery");
    expect(c).not.toContain("shownMovements");
    // La búsqueda viaja al servidor
    expect(b).toContain("search: debouncedSearch || undefined");
    expect(c).toContain("search: debouncedSearch || undefined");
  });

  it("«Sin conciliar» es el filtro por defecto de Movimientos bancarios y «Todos» sigue disponible", () => {
    const b = read("BankMovementsManager.tsx");
    expect(b).toContain('useState<Conciliation>("sin_conciliar")');
    expect(b).toContain('"todos"');
  });

  it("el «ajuste» de caja no se presenta como una salida: se muestra sin signo (el dato no guarda signo y no mueve el saldo)", () => {
    const c = read("CashRegisterManager.tsx");
    expect(c).toMatch(/adjustment: 0 \}/);
    expect(c).toContain("income: 1, transfer_in: 1, opening_balance: 1, expense: -1, transfer_out: -1");
    expect(c).not.toMatch(/isIncome\s*=/);
  });

  it("el estado de las pestañas de Caja vive en la URL y las rutas no cambian", () => {
    const c = read("CashRegisterManager.tsx");
    expect(c).toContain('useUrlParam("tab", TABS, "movimientos")');
    expect(c).toContain("<InnerTabs");
    const nav = fs.readFileSync(path.resolve(__dirname, "../shared/economyNav.ts"), "utf8");
    expect(nav).toContain("`${C}/caja`");
    expect(nav).toContain("`${C}/movimientos-bancarios`");
  });

  it("cada clave usada con t() existe en español y en alemán", () => {
    const missing: string[] = [];
    for (const f of FILES) {
      const src = read(f);
      for (const m of src.matchAll(/\bt\(\s*"((?:economyBank|economyCash|economyShell)\.[A-Za-z0-9_.]+)"/g)) {
        if (!(m[1] in ES)) missing.push(`es:${m[1]}`);
        if (!(m[1] in DE)) missing.push(`de:${m[1]}`);
      }
      // claves compuestas: t(`economyX.grupo.${valor}`) → todas las claves del grupo existen en ambos idiomas
      for (const m of src.matchAll(/\bt\(`((?:economyBank|economyCash)\.[A-Za-z0-9_.]+)\.\$\{/g)) {
        const keys = Object.keys(ES).filter((k) => k.startsWith(`${m[1]}.`));
        if (keys.length === 0) missing.push(`es:${m[1]}.*`);
        for (const k of keys) if (!(k in DE)) missing.push(`de:${k}`);
      }
    }
    expect([...new Set(missing)]).toEqual([]);
  });

  it("los textos dinámicos de Caja y Banco tienen todas sus variantes", () => {
    for (const k of ["sin_conciliar", "conciliado", "gasto_vinculado", "ignorado"]) { expect(ES[`economyBank.state.${k}`]).toBeTruthy(); expect(ES[`economyBank.filter.${k}`]).toBeTruthy(); }
    for (const k of ["income", "expense", "transfer_out", "transfer_in", "opening_balance", "adjustment"]) expect(ES[`economyCash.type.${k}`]).toBeTruthy();
    for (const k of ["balanced", "difference", "reviewed", "adjusted", "accepted_difference", "closed", "reconciled", "open"]) expect(ES[`economyCash.closureStatus.${k}`]).toBeTruthy();
    expect(ES["economyCash.action.adjust.addDescription"]).toBeTruthy();
    expect(ES["economyCash.action.adjust.deductDescription"]).toBeTruthy();
  });

  it("ambos idiomas tienen las mismas claves y los textos alemanes no son copia del español (salvo siglas)", () => {
    expect(Object.keys(DE).sort()).toEqual(Object.keys(ES).sort());
    const NAMES = ["economyBank.imports.status.ok", "economyBank.sync.chip", "economyBank.col.balance", "economyBank.summary.pendingDetail", "economyCash.summary.mismatchDetail"]; // siglas, nombres propios y solo marcadores
    const same = Object.keys(ES).filter((k) => k.startsWith("economyBank.") || k.startsWith("economyCash.")).filter((k) => !NAMES.includes(k) && ES[k] === DE[k] && /[a-záéíóúñ]{4,}/i.test(ES[k]));
    expect(same).toEqual([]);
  });

  it("nada visible queda en español sin pasar por t(): sin literales con acentos ni emojis en el marcado", () => {
    for (const f of FILES) {
      const src = read(f);
      // Texto JSX literal con letras españolas (entre > y <), fuera de comentarios
      const jsxText = [...src.matchAll(/>\s*([^<>{}\n]*[áéíóúñ¿¡][^<>{}\n]*)\s*</g)].map((m) => m[1].trim()).filter((x) => x && !x.startsWith("//") && !x.startsWith("*"));
      expect(jsxText, f).toEqual([]);
      expect(src, f).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
      expect(src, f).not.toContain('toLocaleDateString("es-ES")');
    }
  });

  it("sin la clase de recorte de Tailwind ni colores literales", () => {
    for (const f of [...FILES, "shared/EconomyParts.tsx"]) {
      const src = read(f);
      expect(src, f).not.toMatch(/className="[^"]*\btruncate\b/);
      expect(src, f).not.toMatch(/#[0-9a-fA-F]{6}\b/);
    }
  });
});
