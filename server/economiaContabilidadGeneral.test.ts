/**
 * Lote E6 de Economía (Contabilidad general), sin base de datos: comprobaciones de la pantalla
 * /admin/contabilidad/general. Solo presentación: las cifras salen del servidor con el formato único, no quedan
 * formateadores propios ni diálogos nativos, la sincronización al abrir sigue igual y las claves es/de están completas.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import es from "../shared/i18n/locales/es/economyLedger";
import de from "../shared/i18n/locales/de/economyLedger";
import esShell from "../shared/i18n/locales/es/economyShell";
import deShell from "../shared/i18n/locales/de/economyShell";
import { flatten, type Messages } from "../shared/i18n/core";
import { formatEurCents, formatAmount } from "../client/src/lib/money";
import { ACC_MAP_KEYS, ACC_ORIGINS, ACC_JOURNALS, ACC_ACCOUNT_TYPES } from "../shared/accountingGeneral";

const root = path.resolve(__dirname, "..");
const read = (p: string) => fs.readFileSync(path.resolve(root, p), "utf8").replace(/\r\n/g, "\n");
const FILE = "client/src/pages/admin/accounting/GeneralAccounting.tsx";
const src = read(FILE);
const ES = flatten(es as unknown as Messages, "economyLedger");
const DE = flatten(de as unknown as Messages, "economyLedger");

describe("Contabilidad general (E6): cifras con el formato único", () => {
  it("siete cifras y negativos, en español y en alemán, sin cambiar el valor", () => {
    expect(formatEurCents(123456789, { locale: "es" })).toBe("1.234.567,89 €");
    expect(formatEurCents(123456789, { locale: "de" })).toBe("1.234.567,89 €");
    expect(formatEurCents(-12345678, { locale: "es" })).toBe("−123.456,78 €");
    expect(formatEurCents(654321, { locale: "es" })).toBe("6.543,21 €");
    expect(formatEurCents(-5, { locale: "de" })).toBe("−0,05 €");
    expect(formatEurCents(null, { nullAs: "—" })).toBe("—");
    expect(formatAmount(98765432 / 100, { locale: "de" })).toBe("987.654,32");
  });

  it("no hay formateadores propios: sin toFixed, toLocale*, Intl, formatAmount/formatEurCents sueltos ni céntimos a mano", () => {
    expect(src).not.toMatch(/toFixed\(/);
    expect(src).not.toMatch(/toLocale(String|DateString|TimeString)?\(/);
    expect(src).not.toMatch(/\bIntl\./);
    expect(src).not.toMatch(/from "@\/lib\/money"/);
    expect(src).toContain('import { useMoney } from "@/lib/useMoney"');
    expect(src).not.toMatch(/\/ 100\)\.to/);
  });

  it("los importes salen de los céntimos del servidor sin recalcular (solo máx/valor absoluto para repartir el saldo en deudor o acreedor)", () => {
    expect(src).toContain("m.cents(r.balanceCents, { nullAs: NONE })");
    expect(src).toContain("m.cents(q.data!.openingCents, { nullAs: NONE })");
    expect(src).toContain("m.cents(q.data!.closingCents, { nullAs: NONE })");
    expect(src).toContain("Math.max(r.balanceCents, 0)");
    expect(src).toContain("Math.max(-r.balanceCents, 0)");
    expect(src).toContain("m.cents(q.data!.totals.debitCents)");
  });
});

describe("Contabilidad general (E6): pantalla sin nativos ni residuos", () => {
  it("sin prompt(), confirm() ni alert() nativos; «Revertir» pide el motivo en un diálogo con pie fijo", () => {
    expect(src).not.toMatch(/\b(window\.)?(prompt|confirm|alert)\(/);
    expect(src).toContain("<Dialog open={!!revert}");
    expect(src).toContain("<FormFooter>");
    expect(src).toContain("reverse.mutate({ id: revert.id, reason: reason.trim() })");
    expect(src).toContain('t("economyLedger.journal.revertDialog.reason")');
  });

  it("sin truncate, sin colores literales y sin tablas crudas sin patrón móvil", () => {
    expect(src).not.toMatch(/\btruncate\b/);
    expect(src).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(src).not.toMatch(/<table\b/);
    expect(src).not.toMatch(/<Tabs\b|<TabsList\b|<TabsTrigger\b/);
    expect(src).toContain("<InnerTabs");
    expect(src).toContain('useUrlParam("tab", TAB_KEYS, "resumen")');
  });

  it("no queda texto en español dentro del JSX ni en atributos visibles", () => {
    const jsxText = src.split("\n").filter((l) => /^\s*[A-ZÁÉÍÓÚa-záéíóú¿¡][^{}<>=;()]*[a-záéíóú]{3}\s*$/.test(l) && !/^\s*(\/\/|\*|\/\*|import|export|const|type|interface|return|if|else)/.test(l) && !l.includes("t(\""));
    expect(jsxText).toEqual([]);
    expect(src).not.toMatch(/(placeholder|aria-label|title|label)="[A-ZÁÉÍÓÚa-záéíóú]/);
  });

  it("la barra de acciones fija recoge el cuadre y «Contabilizar» / «Guardar ajustes» con las mismas acciones", () => {
    expect(src).toContain("sticky bottom-0");
    expect(src).toContain('t("economyLedger.manual.submit")');
    expect(src).toContain('form="acc-settings-form"');
    expect(src).toContain("const balanced = !invalid && debit === credit && debit > 0;");
    expect(src).toContain("disabled={!balanced || !description.trim() || create.isPending}");
    expect(src).toContain("save.mutate({ startDate: d.startDate, lockedUntil: d.lockedUntil || null, map: d.map })");
  });
});

describe("Contabilidad general (E6): la sincronización y las operaciones no cambian", () => {
  it("al abrir la pantalla se ejecuta una vez la misma mutación `sync`, en el mismo punto y con el mismo tratamiento de errores", () => {
    expect(src).toContain("const sync = trpc.accountingGeneral.sync.useMutation({\n    onSuccess: () => utils.accountingGeneral.invalidate(),");
    expect(src).toContain('if (e.data?.code !== "FORBIDDEN") toastError(e);');
    expect(src).toContain("const started = useRef(false);\n  useEffect(() => {\n    if (started.current) return;\n    started.current = true;\n    sync.mutate();\n    // eslint-disable-next-line react-hooks/exhaustive-deps\n  }, []);");
    // «Actualizar asientos» sigue llamando a la misma mutación
    expect(src).toContain("onSync={() => sync.mutate()}");
    expect(src.match(/sync\.mutate\(/g)).toHaveLength(2);
  });

  it("las mismas consultas y mutaciones que antes (nada nuevo, nada quitado)", () => {
    const used = [...new Set(src.match(/trpc\.accountingGeneral\.[A-Za-z]+/g))].sort();
    expect(used).toEqual(
      [
        "accounts", "confirmExpenseTax", "createAccount", "createEntry", "journal", "ledger", "overview", "profitAndLoss",
        "reverseEntry", "saveCategoryAccount", "saveSettings", "settings", "sync", "trialBalance", "updateAccount",
      ].map((n) => `trpc.accountingGeneral.${n}`),
    );
    expect(src).toContain("utils.accountingGeneral.export.fetch({ kind, ...period, account: account ?? null })");
  });

  it("el cálculo del cuadre y la conversión del texto a céntimos no cambian", () => {
    expect(src).toContain("const n = Number(t.includes(\",\") ? t.replace(/\\./g, \"\").replace(\",\", \".\") : t);");
    expect(src).toContain("return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;");
    expect(src).toContain("const debit = parsed.reduce((a, l) => a + (l.d ?? 0), 0);");
    expect(src).toContain("const credit = parsed.reduce((a, l) => a + (l.c ?? 0), 0);");
  });

  it("el título único de la pantalla es «Contabilidad general» (sin «Extra»)", () => {
    expect(flatten(esShell as unknown as Messages, "economyShell")["economyShell.screen.general"]).toBe("Contabilidad general");
    expect(flatten(deShell as unknown as Messages, "economyShell")["economyShell.screen.general"]).toBe("Allgemeine Buchhaltung");
    expect(src).not.toMatch(/Extra/);
  });
});

describe("Contabilidad general (E6): claves es/de", () => {
  it("el alemán tiene exactamente las mismas claves y ningún valor vacío", () => {
    expect(Object.keys(DE).sort()).toEqual(Object.keys(ES).sort());
    for (const [k, v] of Object.entries(DE)) expect(v.trim(), k).not.toBe("");
  });

  it("los marcadores {…} coinciden en ambos idiomas", () => {
    const ph = (s: string) => (s.match(/\{[a-zA-Z]+\}/g) ?? []).sort().join(",");
    for (const k of Object.keys(ES)) expect(ph(DE[k]), k).toBe(ph(ES[k]));
  });

  it("todas las claves que usa la pantalla existen (incluidas las compuestas)", () => {
    const keys = new Set<string>();
    for (const m of src.matchAll(/t\("(economyLedger\.[A-Za-z.]+)"/g)) keys.add(m[1]);
    for (const k of keys) expect(ES[k], k).toBeTruthy();
    for (const o of ACC_ORIGINS) expect(ES[`economyLedger.origin.${o}`], o).toBeTruthy();
    for (const j of ACC_JOURNALS) expect(ES[`economyLedger.journalName.${j}`], j).toBeTruthy();
    for (const a of ACC_ACCOUNT_TYPES) expect(ES[`economyLedger.accountType.${a}`], a).toBeTruthy();
    for (const k of ACC_MAP_KEYS) expect(ES[`economyLedger.map.${k}`], k).toBeTruthy();
    for (const t of ["resumen", "diario", "mayor", "sumas", "pyg", "manual", "cuentas", "ajustes"]) expect(ES[`economyLedger.tab.${t}`], t).toBeTruthy();
    for (const g of ["period", "sales", "people", "treasury", "other", "categories"]) expect(ES[`economyLedger.settings.section.${g}`], g).toBeTruthy();
  });

  it("las etiquetas del idioma principal coinciden con las de siempre del módulo compartido", async () => {
    const shared = await import("../shared/accountingGeneral");
    for (const o of ACC_ORIGINS) expect(ES[`economyLedger.origin.${o}`]).toBe(shared.ACC_ORIGIN_LABELS[o]);
    for (const j of ACC_JOURNALS) expect(ES[`economyLedger.journalName.${j}`]).toBe(shared.ACC_JOURNAL_LABELS[j]);
    for (const a of ACC_ACCOUNT_TYPES) expect(ES[`economyLedger.accountType.${a}`]).toBe(shared.ACC_ACCOUNT_TYPE_LABELS[a]);
    for (const k of ACC_MAP_KEYS) expect(ES[`economyLedger.map.${k}`]).toBe(shared.ACC_MAP_LABELS[k]);
  });
});
