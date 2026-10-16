/**
 * Guarda del binario de Náyade (`dist/index.js`, mismo comando que `pnpm build`).
 *
 * El servicio de Náyade en Railway podría desplegar solo con cambios que le afectan (filtros de
 * rutas, docs/infra/ARQUITECTURA_LANZAMIENTO.md §2-B). Eso solo es seguro si el binario NO importa
 * el código del plano de control ni las carpetas de migraciones, documentación o scripts. Si alguien
 * añade una importación así, esta prueba falla y obliga a revisar los filtros antes de desplegar.
 */
import { describe, it, expect } from "vitest";
import path from "node:path";
import { build } from "esbuild";

/** Rutas que el servicio de Náyade puede ignorar al decidir si despliega. */
export const OUTSIDE_NAYADE_BUNDLE = ["server/controlPlane/", "server/crm/", "server/web/", "server/subscriptions/", "server/trials/", "db/", "docs/", "scripts/"];

describe("binario de Náyade", () => {
  it("no incluye el plano de control, migraciones de otros carriles, documentación ni scripts", async () => {
    const root = path.resolve(__dirname, "..");
    const r = await build({
      entryPoints: [path.join(root, "server/_core/index.ts")],
      absWorkingDir: root,
      platform: "node",
      packages: "external",
      bundle: true,
      format: "esm",
      write: false,
      metafile: true,
      outdir: "dist",
      logLevel: "silent",
    });
    const inputs = Object.keys(r.metafile!.inputs).map((f) => f.replace(/\\/g, "/"));
    expect(inputs.length).toBeGreaterThan(50);
    const offending = inputs.filter((f) => OUTSIDE_NAYADE_BUNDLE.some((p) => f.startsWith(p)));
    expect(offending, "el binario de Náyade importa rutas excluidas de su despliegue").toEqual([]);
  }, 60_000);
});
