import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { meteringReferences } from "../scripts/deploy/esRailwayLib";

describe("medición del plano de control (Resource Manager)", () => {
  it("en live el plano de control lee la base del ERM por referencia a la variable del Core", () => {
    expect(meteringReferences("live")).toEqual({ controlplane: { ERM_DATABASE_URL: "${{core.ERM_DATABASE_URL}}" } });
  });
  it("en production, la misma referencia (se aplica solo con aprobación en el entorno protegido)", () => {
    expect(meteringReferences("production")).toEqual({ controlplane: { ERM_DATABASE_URL: "${{core.ERM_DATABASE_URL}}" } });
    expect(meteringReferences("staging")).toEqual({});
  });
  it("se aplica con las referencias de almacenamiento, con su comprobación y restauración", () => {
    const src = fs.readFileSync(path.resolve(__dirname, "../scripts/deploy/esRailway.ts"), "utf8");
    expect(src).toContain("Object.entries({ ...storageReferences(env), ...meteringReferences(env) })");
  });
});
