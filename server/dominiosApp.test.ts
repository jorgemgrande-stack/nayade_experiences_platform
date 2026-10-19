/** Plan de dominios <empresa>.app.bigelephant.es (scripts/railway/dominios-app.cjs), sin red. */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require_ = createRequire(import.meta.url);
const { plan, RESERVED } = require_("../scripts/railway/dominios-app.cjs") as {
  plan: (tenants: { id: string; status?: string; domains: { domain: string; status?: string }[] }[], platform: string) => any[];
  RESERVED: Set<string>;
};
const P = "app.bigelephant.es";
const byTenant = (rows: any[]) => Object.fromEntries(rows.map((r) => [r.tenant, r]));

describe("dominios-app.cjs: plan de dominios de las empresas", () => {
  it("propone <id>.app.bigelephant.es conservando los dominios actuales", () => {
    const [r] = plan([{ id: "t3-demo", status: "active", domains: [{ domain: "t3-demo.up.railway.app" }] }], P);
    expect(r).toMatchObject({ action: "add", domain: "t3-demo.app.bigelephant.es", current: ["t3-demo.up.railway.app"] });
  });

  it("omite las archivadas o eliminadas y las ya registradas; los retirados no cuentan", () => {
    const rows = byTenant(
      plan(
        [
          { id: "a", status: "archived", domains: [] },
          { id: "b", status: "deleted", domains: [] },
          { id: "c", status: "trial", domains: [{ domain: "c.app.bigelephant.es" }] },
          { id: "d", status: "active", domains: [{ domain: "d.app.bigelephant.es", status: "removed" }] },
        ],
        P,
      ),
    );
    expect(rows.a.action).toBe("skip");
    expect(rows.b).toMatchObject({ action: "skip", reason: "empresa eliminada" });
    expect(rows.c).toMatchObject({ action: "skip", reason: "ya registrado" });
    expect(rows.d.action).toBe("add");
  });

  it("colisiones: etiqueta reservada, no válida, o dominio de otra empresa", () => {
    const rows = byTenant(
      plan(
        [
          { id: "admin", status: "active", domains: [] },
          { id: "Mal_Id", status: "active", domains: [] },
          { id: "x", status: "active", domains: [{ domain: "y.app.bigelephant.es" }] },
          { id: "y", status: "active", domains: [] },
        ],
        P,
      ),
    );
    expect(rows.admin).toMatchObject({ action: "conflict", reason: expect.stringContaining("reservada") });
    expect(rows["Mal_Id"]).toMatchObject({ action: "conflict", reason: expect.stringContaining("etiqueta DNS") });
    expect(rows.y).toMatchObject({ action: "conflict", reason: "ya lo tiene la empresa x" });
  });

  it("la página de entrada (app.bigelephant.es) reserva exactamente las mismas etiquetas", () => {
    const html = fs.readFileSync(path.resolve(__dirname, "../deploy/railway/gateway/app-entry/index.html"), "utf8");
    const m = /var RESERVED = (\[[^\]]*\]);/.exec(html);
    expect(m).not.toBeNull();
    expect(new Set(JSON.parse(m![1]))).toEqual(RESERVED);
  });
});
