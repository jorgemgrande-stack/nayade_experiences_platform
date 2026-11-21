import { describe, expect, it } from "vitest";
import { readUiLocale, writeUiLocale } from "./uiLocale";

/** El idioma de la interfaz es individual: cada consulta va acotada al usuario de la sesión y nunca toca a otros. */
type Q = { queryChunks?: unknown[] };
const flat = (q: Q) => (q.queryChunks ?? []).map((c) => (typeof c === "object" && c && "value" in (c as object) ? (c as { value: unknown }).value : c));
const text = (q: Q) => flat(q).flat().map(String).join(" ");

function fakeDb(rows: Array<Record<string, unknown>> = [], fail = false) {
  const calls: Q[] = [];
  return {
    calls,
    execute: async (q: Q) => {
      calls.push(q);
      if (fail) throw new Error("Table 'user_ui_prefs' doesn't exist");
      return [rows];
    },
  };
}

describe("idioma de la interfaz por usuario", () => {
  it("lee solo la fila del usuario pedido", async () => {
    const db = fakeDb([{ ui_locale: "de" }]);
    expect(await readUiLocale(db as never, 42)).toBe("de");
    expect(text(db.calls[0])).toContain("WHERE user_id =");
    expect(db.calls[0].queryChunks).toContain(42);
  });

  it("escribe una sola fila por usuario (clave primaria user_id) sin tocar otras", async () => {
    const db = fakeDb();
    expect(await writeUiLocale(db as never, 7, "de")).toBe(true);
    const sql = text(db.calls[0]);
    expect(sql).toContain("INSERT INTO user_ui_prefs");
    expect(sql).toContain("ON DUPLICATE KEY UPDATE ui_locale");
    expect(sql).not.toMatch(/UPDATE users|DELETE|WHERE/);
    expect(db.calls[0].queryChunks).toContain(7);
  });

  it("sin la tabla (migración sin aplicar) no rompe: lectura null y escritura sin persistir", async () => {
    const db = fakeDb([], true);
    expect(await readUiLocale(db as never, 1)).toBeNull();
    expect(await writeUiLocale(db as never, 1, "de")).toBe(false);
  });

  it("un valor guardado no válido se ignora (vuelve al idioma principal)", async () => {
    expect(await readUiLocale(fakeDb([{ ui_locale: "xx" }]) as never, 1)).toBeNull();
  });
});
