import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { SERVER_MESSAGE_KEYS } from "../shared/i18n/serverMessages";
import es from "../shared/i18n/locales/es/serverMessages";
import de from "../shared/i18n/locales/de/serverMessages";

const SERVER_DIR = path.resolve(__dirname);

function serverSources(dir: string, out: string[] = []): string[] {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) {
      if (f !== "node_modules") serverSources(p, out);
    } else if (p.endsWith(".ts") && !p.includes(".test.")) out.push(p);
  }
  return out;
}

describe("mensajes del servidor traducibles en el cliente", () => {
  const code = serverSources(SERVER_DIR).map((f) => fs.readFileSync(f, "utf8")).join("\n");
  const esFlat = es as Record<string, string>;
  const deFlat = de as Record<string, string>;

  it("cada literal del mapa sigue existiendo en el código del servidor", () => {
    const obsolete = Object.keys(SERVER_MESSAGE_KEYS).filter((msg) => !code.includes(msg));
    expect(obsolete).toEqual([]);
  });

  it("cada clave del mapa existe en español y alemán, y el español es el mismo literal", () => {
    for (const [msg, key] of Object.entries(SERVER_MESSAGE_KEYS)) {
      const id = key.replace(/^serverMessages\./, "");
      expect(esFlat[id], key).toBe(msg);
      expect(deFlat[id], key).toBeTruthy();
    }
  });

  it("hay al menos 150 mensajes cubiertos", () => {
    expect(Object.keys(SERVER_MESSAGE_KEYS).length).toBeGreaterThanOrEqual(150);
  });
});
