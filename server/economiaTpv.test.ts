/**
 * Lote E4 de Economía (TPV: Operaciones, Remesas y estado de la conciliación), sin base de datos: composición de los
 * filtros, suma exacta de decimales, y comprobaciones de la pantalla (cifras del servidor, textos con t(), es/de, rutas).
 * Los totales contra MySQL real están en economiaTpv.mysql.test.ts.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { addDecimals, buildBatchConditions, buildOperationConditions } from "./cardTerminalQuery";
import esPos from "../shared/i18n/locales/es/economyPos";
import dePos from "../shared/i18n/locales/de/economyPos";
import esBatches from "../shared/i18n/locales/es/economyBatches";
import deBatches from "../shared/i18n/locales/de/economyBatches";
import esShell from "../shared/i18n/locales/es/economyShell";
import deShell from "../shared/i18n/locales/de/economyShell";
import { flatten, type Messages } from "../shared/i18n/core";

const dialect = new MySqlDialect();
const op = (f: Parameters<typeof buildOperationConditions>[0], o?: Parameters<typeof buildOperationConditions>[1]) => { const w = buildOperationConditions(f, o); return w ? dialect.sqlToQuery(w) : null; };
const bt = (f: Parameters<typeof buildBatchConditions>[0], o?: Parameters<typeof buildBatchConditions>[1]) => { const w = buildBatchConditions(f, o); return w ? dialect.sqlToQuery(w) : null; };
const root = path.resolve(__dirname, "..");
const read = (p: string) => fs.readFileSync(path.resolve(root, p), "utf8").replace(/\r\n/g, "\n");
const dict = (ns: string, m: unknown) => flatten(m as Messages, ns);
const ES = { ...dict("economyPos", esPos), ...dict("economyBatches", esBatches), ...dict("economyShell", esShell) };
const DE = { ...dict("economyPos", dePos), ...dict("economyBatches", deBatches), ...dict("economyShell", deShell) };

describe("filtro de operaciones del datáfono (listado y resumen comparten el mismo where)", () => {
  it("sin filtros no hay where", () => {
    expect(op({})).toBeNull();
    expect(op({ status: "todos", operationType: "todos", search: "  " })).toBeNull();
  });
  it("la búsqueda es parametrizada, escapa comodines y mira nº, tarjeta, terminal, comercio y autorización", () => {
    const r = op({ search: "50%_" })!;
    expect(r.sql).toContain("like");
    expect(r.sql).not.toContain("50");
    expect(r.params).toEqual(Array(5).fill("%50\\%\\_%"));
    for (const col of ["operation_number", "card", "terminal_code", "commerce_code", "authorization_code"]) expect(r.sql).toContain(`\`${col}\``);
  });
  it("estado, tipo, importación y fechas viajan como parámetros", () => {
    const r = op({ status: "pendiente", operationType: "VENTA", importId: 3, dateFrom: "2026-01-01", dateTo: "2026-02-01" })!;
    expect(r.params.slice(0, 3)).toEqual(["pendiente", "VENTA", 3]);
    expect(r.params).toHaveLength(5);
  });
  it("sin el estado elegido (para repartir el filtro por estados) no se filtra por estado", () => {
    expect(op({ status: "pendiente" }, { withStatus: false })).toBeNull();
    expect(op({ status: "pendiente", operationType: "VENTA" }, { withStatus: false })!.params).toEqual(["VENTA"]);
  });
});

describe("filtro de remesas (listado y resumen comparten el mismo where)", () => {
  it("sin filtros no hay where; periodo, estado y terminal van como parámetros", () => {
    expect(bt({})).toBeNull();
    expect(bt({ fromDate: "2026-11-01", toDate: "2026-11-25", status: "difference", terminalCode: "T1" })!.params).toEqual(["2026-11-01", "2026-11-25", "difference", "T1"]);
  });
  it("el estado de la conciliación del periodo no depende del estado elegido en la lista", () => {
    expect(bt({ fromDate: "2026-11-01", status: "difference" }, { withStatus: false })!.params).toEqual(["2026-11-01"]);
  });
});

describe("suma de decimales exacta (céntimos enteros, sin coma flotante)", () => {
  it("suma, signos y siete cifras", () => {
    expect(addDecimals("0.10", "0.20")).toBe("0.30");
    expect(addDecimals("9999999.99", "0.01")).toBe("10000000.00");
    expect(addDecimals("-1234567.89", "1234567.88")).toBe("-0.01");
    expect(addDecimals("-5.5", "2")).toBe("-3.50");
  });
  it("vacío y valores inválidos → cero", () => {
    expect(addDecimals()).toBe("0.00");
    expect(addDecimals(null, undefined, "abc", "")).toBe("0.00");
  });
});

describe("Operaciones, Remesas y Conciliación (E4): pantallas", () => {
  const FILES = ["client/src/pages/admin/accounting/CardTerminalOperationsManager.tsx", "client/src/pages/admin/accounting/CardTerminalBatchesManager.tsx"];

  it("las cifras salen del servidor para el filtro completo, sin etiqueta «de esta página»", () => {
    const o = read(FILES[0]);
    const b = read(FILES[1]);
    expect(o).toContain("trpc.cardTerminalOperations.summary.useQuery");
    expect(o).not.toContain("PageOnlyTag");
    expect(o).not.toMatch(/ops\.filter\(/);
    expect(o).toContain("search: search || undefined");
    expect(b).toContain("trpc.cardTerminalBatches.summary.useQuery");
    expect(b).toContain("trpc.cardTerminalBatches.listPage.useQuery");
    expect(b).not.toContain("PageOnlyTag");
    expect(b).not.toMatch(/batches\.filter\(/);
    expect(b).not.toContain("limit: 100");
  });

  it("«Reprocesar fecha» valida con isValidIsoDate, usa un diálogo y no el prompt() nativo", () => {
    const o = read(FILES[0]);
    expect(o).toContain('import { isValidIsoDate } from "@/lib/isoDate"');
    expect(o).not.toMatch(/\bprompt\(/);
    expect(o).toContain('type="date"');
    expect(o).toContain("<FormFooter>");
    expect(o).toContain("error={reprocessTouched && reprocessInvalid");
    expect(o).not.toContain("/^d{4}");
  });

  it("«Logs de ingesta» e «Historial de importaciones» ya no cuelgan bajo la lista: van al panel «Importaciones y correo»", () => {
    const o = read(FILES[0]);
    expect(o).toContain("economyPos.imports.title");
    expect(o).toContain("<Sheet open={importsOpen}");
    expect(o).toContain("emailIngestion.listLogs.useQuery");
    expect(o).toContain("enabled: importsOpen && importsTab");
  });

  it("el detalle de remesa es un cajón (pantalla completa en móvil) con pie fijo y acciones principales a la vista", () => {
    const b = read(FILES[1]);
    expect(b).toContain("<Sheet open={selectedId != null}");
    expect(b).toContain('className="flex w-full flex-col gap-0 p-0 sm:max-w-xl"');
    expect(b).toContain('t("economyBatches.action.accept")');
    expect(b).toContain('t("economyBatches.action.reconcile")');
    // destructivas en el menú
    expect(b).toMatch(/key: "reject"[^}]*danger: true/);
    expect(b).toMatch(/key: "delete"[\s\S]*danger: true/);
    // el movimiento sugerido muestra fecha, importe y concepto, no un identificador
    expect(b).toContain("suggestedMovement.fecha");
    expect(b).toContain("suggestedMovement.importe");
    expect(b).toContain("suggestedMovement.movimiento");
    expect(b).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
  });

  it("la lógica de conciliación no cambia: mismas mutaciones y mismas condiciones de cada acción", () => {
    const b = read(FILES[1]);
    for (const m of ["generate", "runMatching", "acceptSuggestion", "rejectSuggestion", "reconcile", "unreconcile", "markIgnored", "deleteBatch", "removeOperation", "justifyDifference"]) expect(b).toContain(`trpc.cardTerminalBatches.${m}.useMutation`);
    expect(b).toContain("const canReconcile = !!detail && !isReconciled(detail.status) && detail.status !== \"ignored\"");
    expect(b).toContain("isSuggested(detail.status) && !!detail.suggestedBankMovementId");
    expect(b).toContain('detail.status === "difference"');
    expect(b).toContain('detail.status === "pending"');
  });

  it("la ruta antigua de Conciliación redirige a Remesas conservando el contexto", () => {
    const c = read("client/src/pages/admin/accounting/CardTerminalConciliationDashboard.tsx");
    expect(c).toContain("/admin/contabilidad/remesas-tpv");
    expect(c).toContain("window.location.search");
    expect(c).toContain("window.location.hash");
    expect(read("client/src/App.tsx")).toContain('path="/admin/contabilidad/conciliacion-tpv"');
  });

  it("cada clave usada con t() existe en español y en alemán", () => {
    const missing: string[] = [];
    for (const f of FILES) {
      const src = read(f);
      for (const m of src.matchAll(/\bt\(\s*"((?:economyPos|economyBatches|economyShell)\.[A-Za-z0-9_.]+)"/g)) {
        if (!(m[1] in ES)) missing.push(`es:${m[1]}`);
        if (!(m[1] in DE)) missing.push(`de:${m[1]}`);
      }
      for (const m of src.matchAll(/\bt\(`((?:economyPos|economyBatches)\.[A-Za-z0-9_.]+)\.\$\{/g)) {
        const keys = Object.keys(ES).filter((k) => k.startsWith(`${m[1]}.`));
        if (keys.length === 0) missing.push(`es:${m[1]}.*`);
        for (const k of keys) if (!(k in DE)) missing.push(`de:${k}`);
      }
    }
    expect([...new Set(missing)]).toEqual([]);
  });

  it("los textos dinámicos tienen todas sus variantes", () => {
    for (const k of ["pendiente", "conciliado", "incidencia", "ignorado", "included_in_batch", "settled"]) expect(ES[`economyPos.status.${k}`]).toBeTruthy();
    for (const k of ["VENTA", "DEVOLUCION", "ANULACION", "OTRO"]) expect(ES[`economyPos.type.${k}`]).toBeTruthy();
    for (const k of ["pending", "suggested", "auto_ready", "reconciled", "difference", "ignored", "review_required"]) expect(ES[`economyBatches.status.${k}`]).toBeTruthy();
    for (const k of ["DEVOLUCION", "ANULACION"]) expect(ES[`economyPos.link.kind.${k}`]).toBeTruthy();
    for (const k of ["reservation", "quote"]) expect(ES[`economyBatches.detail.entity.${k}`]).toBeTruthy();
  });

  it("ambos idiomas tienen las mismas claves y los textos alemanes no son copia del español (salvo siglas)", () => {
    expect(Object.keys(DE).sort()).toEqual(Object.keys(ES).sort());
    const same = Object.keys(ES).filter((k) => k.startsWith("economyPos.") || k.startsWith("economyBatches.")).filter((k) => !k.endsWith(".terminal") && ES[k] === DE[k] && /[a-záéíóúñ]{4,}/i.test(ES[k])); // «Terminal» es la misma palabra
    expect(same).toEqual([]);
  });

  it("nada visible queda en español sin pasar por t(): sin literales con acentos ni emojis en el marcado", () => {
    for (const f of [...FILES, "client/src/pages/admin/accounting/CardTerminalConciliationDashboard.tsx"]) {
      const src = read(f);
      const jsxText = [...src.matchAll(/>\s*([^<>{}\n]*[áéíóúñ¿¡][^<>{}\n]*)\s*</g)].map((m) => m[1].trim()).filter((x) => x && !x.startsWith("//") && !x.startsWith("*"));
      expect(jsxText, f).toEqual([]);
      expect(src, f).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
      expect(src, f).not.toContain('toLocaleDateString("es-ES")');
      expect(src, f).not.toContain('toLocaleString("es-ES"');
    }
  });

  it("sin la clase de recorte de Tailwind ni colores literales", () => {
    for (const f of FILES) {
      const src = read(f);
      expect(src, f).not.toMatch(/className="[^"]*\btruncate\b/);
      expect(src, f).not.toMatch(/#[0-9a-fA-F]{6}\b/);
    }
  });
});
