import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { placeholderNames } from "../shared/i18n/core";
import { STUDIO_DE, studioText } from "../shared/i18n/studioLabels";
import * as modules from "../shared/studio/modules";
import * as blocks from "../shared/pageBlocks";

/** Textos de interfaz de Elephant Studio y del CMS (español → alemán). Cada `tx("…")` y cada etiqueta del catálogo debe estar traducida. */
const ROOT = path.resolve(__dirname, "..");
const SCOPES = [
  "client/src/pages/admin/studio",
  "client/src/components/admin/studio",
  "client/src/components/admin/pageBuilder",
  "client/src/pages/admin/cms",
];

function files(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...files(rel));
    else if (/\.(tsx?|ts)$/.test(e.name)) out.push(rel);
  }
  return out;
}

function usedKeys(): Map<string, string> {
  const used = new Map<string, string>();
  const re = /\btx\(\s*("(?:[^"\\]|\\.)*")/g;
  for (const dir of SCOPES) {
    for (const f of files(dir)) {
      const src = fs.readFileSync(path.join(ROOT, f), "utf8");
      for (const m of src.matchAll(re)) used.set(JSON.parse(m[1]) as string, f);
    }
  }
  return used;
}

function catalogStrings(): Set<string> {
  const out = new Set<string>();
  const KEYS = new Set(["label", "description", "hint", "placeholder", "itemLabel"]);
  const walk = (v: unknown, depth = 0) => {
    if (depth > 8 || v == null) return;
    if (Array.isArray(v)) return v.forEach((x) => walk(x, depth + 1));
    if (typeof v === "object") {
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
        if (KEYS.has(k) && typeof x === "string" && /[A-Za-zÀ-ÿ]/.test(x)) out.add(x);
        else if (k !== "build" && k !== "newItem") walk(x, depth + 1);
      }
    }
  };
  for (const ns of [modules, blocks]) for (const val of Object.values(ns)) if (typeof val !== "function") walk(val);
  return out;
}

describe("textos de interfaz de Studio y CMS (es → de)", () => {
  it("todo texto usado con tx() tiene traducción alemana y conserva los parámetros", () => {
    const missing: string[] = [];
    const badParams: string[] = [];
    for (const [key, file] of usedKeys()) {
      const de = STUDIO_DE[key];
      if (!de) { missing.push(`${path.basename(file)}: ${key}`); continue; }
      if ([...placeholderNames(key)].sort().join() !== [...placeholderNames(de)].sort().join()) badParams.push(key);
    }
    expect(missing, `faltan traducciones:\n${missing.join("\n")}`).toEqual([]);
    expect(badParams, `parámetros distintos:\n${badParams.join("\n")}`).toEqual([]);
  });

  it("todas las etiquetas del catálogo de módulos, plantillas y secciones están traducidas", () => {
    const missing = [...catalogStrings()].filter((s) => !STUDIO_DE[s]);
    expect(missing, `faltan traducciones del catálogo:\n${missing.join("\n")}`).toEqual([]);
  });

  it("no hay traducciones vacías y el español no cambia", () => {
    for (const [k, v] of Object.entries(STUDIO_DE)) expect(v.trim(), k).not.toBe("");
    expect(studioText("Guardar borrador", "es")).toBe("Guardar borrador");
    expect(studioText("Guardar borrador", "de")).toBe("Entwurf speichern");
    expect(studioText("texto sin traducción", "de")).toBe("texto sin traducción");
  });
});
