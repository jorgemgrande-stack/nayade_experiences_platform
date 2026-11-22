/**
 * Guarda de adopción del sistema visual (Elephant Design System) en TODO el panel (`pages/admin` y `components/admin`).
 * Lote 0 del plan de la auditoría UX (auditoria_ux_panel/INFORME-UX-CONSOLIDADO.md, apartado F.2).
 *
 * Complementa a `panelColoresGuard.test.ts` (que solo cubre una lista de pantallas migradas) con un TRINQUETE por fichero: para
 * cada regla se cuenta cuántas líneas la incumplen y ese número nunca puede subir respecto a `panelAdopcion.baseline.json`.
 * Una pantalla nueva parte de cero. Al migrar una pantalla el número baja y se actualiza la línea base:
 *
 *     UPDATE_PANEL_BASELINE=1 pnpm vitest run server/panelAdopcion.test.ts
 *
 * (el modo de actualización solo BAJA cifras: nunca sube una línea base; si hace falta subirla, se edita a mano con revisión).
 * Cada ejecución imprime además el informe de adopción (cuántas pantallas usan ya los componentes comunes).
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.join(__dirname, "../client/src");
const BASELINE_FILE = path.join(__dirname, "panelAdopcion.baseline.json");
const DIRS = ["pages/admin", "components/admin"];

/** Reglas: cada una cuenta LÍNEAS que la incumplen. */
const RULES: Record<string, { re: RegExp; why: string }> = {
  // Botón o insignia con color de módulo en vez de significado/marca (bg-orange-600, bg-blue-500…)
  coloresFijos: {
    re: /\b(?:bg|text|border|ring|from|to|via)-(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/,
    why: "usa un color fijo del tema: usa `primary` (marca) o un tono con significado (`success`, `warning`, `danger`, `info` o `@/lib/panelTones`)",
  },
  // Hexadecimales incrustados en clases: bg-[#0d1526]
  hexEnClases: { re: /\b(?:bg|text|border|ring|from|to|via|fill|stroke)-\[#[0-9a-fA-F]{3,8}\]/, why: "hexadecimal en una clase: usa un token semántico (`bg-card`, `bg-muted`, `border-border`…)" },
  // Texto ilegible por pequeño
  textoMinusculo: { re: /\btext-\[(?:9|10|11)px\]/, why: "texto de 9–11 px: usa `text-xs` como mínimo" },
  // Geometría fuera del sistema
  geometriaAjena: { re: /\b(?:rounded-2xl|rounded-3xl|shadow-xl|shadow-2xl)\b/, why: "radio o sombra fuera del sistema: usa `rounded-lg`/`rounded-xl` y `shadow-sm`/`shadow-md`" },
  // Confirmaciones y avisos nativos del navegador
  dialogosNativos: { re: /(?<![\w.])(?:window\.)?(?:confirm|alert)\(/, why: "diálogo nativo del navegador: usa el diálogo de confirmación de la aplicación" },
};

function listFiles(dir: string): string[] {
  const out: string[] = [];
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return out;
  for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
    const rel = path.posix.join(dir, e.name);
    if (e.isDirectory()) out.push(...listFiles(rel));
    else if (/\.tsx$/.test(e.name) && !/\.test\.tsx$/.test(e.name)) out.push(rel);
  }
  return out;
}

type Counts = Record<string, number>;
function measure(): Record<string, Counts> {
  const result: Record<string, Counts> = {};
  for (const f of DIRS.flatMap(listFiles).sort()) {
    const lines = fs.readFileSync(path.join(ROOT, f), "utf8").split(/\r?\n/);
    const c: Counts = {};
    for (const [name, rule] of Object.entries(RULES)) {
      const n = lines.filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l) && rule.re.test(l)).length;
      if (n > 0) c[name] = n;
    }
    if (Object.keys(c).length) result[f] = c;
  }
  return result;
}

describe("adopción del sistema visual en todo el panel (trinquete por fichero)", () => {
  const current = measure();
  const baseline: Record<string, Counts> = fs.existsSync(BASELINE_FILE) ? JSON.parse(fs.readFileSync(BASELINE_FILE, "utf8")) : {};

  if (process.env.UPDATE_PANEL_BASELINE === "1") {
    it("actualiza la línea base (solo baja cifras)", () => {
      const next: Record<string, Counts> = {};
      for (const [f, c] of Object.entries(current)) {
        for (const [rule, n] of Object.entries(c)) {
          const old = baseline[f]?.[rule];
          // Si el fichero ya tenía línea base, solo se admite bajar; si es nuevo, parte de lo que tiene (la primera generación)
          const value = Object.keys(baseline).length === 0 || old === undefined ? n : Math.min(old, n);
          if (old !== undefined && n > old) throw new Error(`${f}: «${rule}» sube de ${old} a ${n}; la línea base no puede subir`);
          (next[f] ??= {})[rule] = value;
        }
      }
      fs.writeFileSync(BASELINE_FILE, JSON.stringify(next, null, 2) + "\n");
      expect(true).toBe(true);
    });
    return;
  }

  it("ningún fichero empeora ninguna regla respecto a la línea base", () => {
    const worse: string[] = [];
    for (const [f, c] of Object.entries(current)) {
      for (const [rule, n] of Object.entries(c)) {
        const allowed = baseline[f]?.[rule] ?? 0;
        if (n > allowed) worse.push(`${f}: ${n} línea(s) con «${rule}» (permitidas ${allowed}) — ${RULES[rule].why}`);
      }
    }
    expect(worse, worse.join("\n")).toEqual([]);
  });

  it("la línea base no guarda deuda ya saldada (si baja una cifra, hay que bajarla aquí)", () => {
    const stale: string[] = [];
    for (const [f, c] of Object.entries(baseline)) {
      for (const [rule, n] of Object.entries(c)) {
        const now = current[f]?.[rule] ?? 0;
        if (now < n) stale.push(`${f}: «${rule}» ahora ${now}, la línea base dice ${n} → UPDATE_PANEL_BASELINE=1 pnpm vitest run server/panelAdopcion.test.ts`);
      }
    }
    expect(stale, stale.join("\n")).toEqual([]);
  });

  it("informe de adopción de los componentes comunes (informativo)", () => {
    const files = DIRS.flatMap(listFiles).filter((f) => f.startsWith("pages/admin"));
    const uses = (re: RegExp) => files.filter((f) => re.test(fs.readFileSync(path.join(ROOT, f), "utf8"))).length;
    const report = {
      pantallasAdmin: files.length,
      conPanelPageHeader: uses(/PanelPageHeader/),
      conKpiCard: uses(/\bKpiCard\b/),
      conEstadosComunes: uses(/\bPanel(?:Empty|Loading|Error)\b/),
      conStatusBadge: uses(/\bStatusBadge\b/),
      conTablaCruda: uses(/<table[\s>]/),
      totales: Object.fromEntries(Object.keys(RULES).map((r) => [r, Object.values(current).reduce((s, c) => s + (c[r] ?? 0), 0)])),
    };
    console.log("[ADOPCION] " + JSON.stringify(report));
    expect(report.pantallasAdmin).toBeGreaterThan(50);
  });

  it("prueba negativa: una línea con un botón naranja o un hexadecimal SÍ incumple las reglas", () => {
    expect(RULES.coloresFijos.re.test('<Button className="bg-orange-600 text-white">')).toBe(true);
    expect(RULES.hexEnClases.re.test('<div className="bg-[#0d1526]">')).toBe(true);
    expect(RULES.dialogosNativos.re.test("if (!confirm('¿Seguro?')) return;")).toBe(true);
    expect(RULES.coloresFijos.re.test('<Button className="bg-primary text-primary-foreground">')).toBe(false);
    expect(RULES.dialogosNativos.re.test("onConfirm(handleX)")).toBe(false);
  });
});
