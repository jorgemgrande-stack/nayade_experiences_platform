/**
 * Publicación con servicios conectados a GitHub en Railway: el despliegue nativo de un commit se reconoce (y no se
 * vuelve a subir); una subida con `railway up` no cuenta como nativa.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { isNativeDeploy, shaFromDeployMeta } from "../scripts/deploy/esRailwayLib";

const sha = "0123456789abcdef0123456789abcdef01234567";

describe("despliegues nativos de Railway", () => {
  it("nativo: repositorio de GitHub y commit; subida: mensaje «<repo> <commit>»", () => {
    expect(isNativeDeploy({ repo: "jorgemgrande-stack/big-elephant-crm", commitHash: sha, branch: "integration/elephant-source" })).toBe(true);
    expect(isNativeDeploy({ cliMessage: `big-elephant-crm ${sha}` })).toBe(false);
    expect(isNativeDeploy({ repo: "big-elephant-crm", commitHash: "corto" })).toBe(false);
    expect(isNativeDeploy(null)).toBe(false);
    expect(shaFromDeployMeta({ repo: "jorgemgrande-stack/big-elephant-crm", commitHash: sha }, "big-elephant-crm")).toBe(sha);
  });

  it("el CRM nativo con el commit esperado solo se comprueba; la web no entra (su compilación lleva el catálogo)", () => {
    const src = fs.readFileSync(path.resolve(__dirname, "../scripts/deploy/esRailway.ts"), "utf8");
    expect(src).toContain('if (ext.service === "crm" && curNode && isNativeDeploy(curNode.meta) && shaFromDeployMeta(curNode.meta, ext.repo) === sha) {');
    expect(src).toContain("(await functional(env, ext.checks)) && (await servedCrmVersion(env, sha))");
  });
});
