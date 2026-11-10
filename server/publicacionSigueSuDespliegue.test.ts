/**
 * La publicación con `railway up` espera a SU despliegue, no al último del servicio. Incidente del 10/11/2026 en live:
 * el despliegue subido (f0bde492) pasó la comprobación de salud, pero un despliegue nativo posterior (be0fb32b,
 * esperando a su CI) lo sustituyó; la espera seguía «al último», se agotó y volvió atrás lo que estaba bien.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { ownDeployState } from "../scripts/deploy/esRailwayLib";

const OWN = "nayade_experiences_platform f0bde4924a0f3dda2676c9174c4ccc833b576e1e";
const up = (id: string, status: string, mark = OWN) => ({ id, status, meta: { reason: "deploy", cliMessage: mark } });
const native = (id: string, status: string, sha = "be0fb32bf49711ef406d9a9ded347c47f5e3ba8b") => ({ id, status, meta: { reason: "deploy", repo: "jorgemgrande-stack/nayade_experiences_platform", commitHash: sha, branch: "integration/elephant-source" } });
const prev = { id: "b017225e", status: "SUCCESS", meta: { cliMessage: "nayade_experiences_platform 884dad23a4d8446a3ece931b8539f451c7734933" } };

describe("la publicación sigue su propio despliegue", () => {
  it("caso normal: espera mientras compila y termina con el estado del propio", () => {
    expect(ownDeployState([prev], { after: "b017225e", mark: OWN })).toEqual({ state: "pending", id: null });
    expect(ownDeployState([up("af9a29ed", "BUILDING"), prev], { after: "b017225e", mark: OWN })).toEqual({ state: "pending", id: "af9a29ed" });
    expect(ownDeployState([up("af9a29ed", "SUCCESS"), prev], { after: "b017225e", mark: OWN })).toEqual({ state: "done", id: "af9a29ed", status: "SUCCESS" });
    expect(ownDeployState([up("af9a29ed", "FAILED"), prev], { after: "b017225e", mark: OWN })).toEqual({ state: "done", id: "af9a29ed", status: "FAILED" });
  });

  it("un despliegue nativo posterior que espera a su CI no se confunde con el propio", () => {
    // Antes: «el último» era df94ec1c (sin terminar) → espera agotada y vuelta atrás. Ahora: el propio ya terminó bien
    expect(ownDeployState([native("df94ec1c", "WAITING"), up("af9a29ed", "SUCCESS"), prev], { after: "b017225e", mark: OWN })).toEqual({ state: "done", id: "af9a29ed", status: "SUCCESS" });
    expect(ownDeployState([native("df94ec1c", "WAITING"), up("af9a29ed", "DEPLOYING"), prev], { after: "b017225e", mark: OWN })).toEqual({ state: "pending", id: "af9a29ed" });
  });

  it("si el posterior sustituye al propio, es «superseded»: no es un fallo del propio ni se vuelve atrás", () => {
    expect(ownDeployState([native("df94ec1c", "WAITING"), up("af9a29ed", "REMOVED"), prev], { after: "b017225e", mark: OWN })).toEqual({ state: "superseded", id: "af9a29ed", by: "df94ec1c" });
  });

  it("solo cuenta la subida con el mensaje de esta publicación y posterior al punto de partida", () => {
    const otherUp = up("x1", "SUCCESS", "nayade_experiences_platform 1111111111111111111111111111111111111111");
    expect(ownDeployState([otherUp, prev], { after: "b017225e", mark: OWN })).toEqual({ state: "pending", id: null });
    // Sin el punto de partida entre los consultados, se sigue esperando (nunca se toma una subida antigua)
    expect(ownDeployState([up("viejo", "SUCCESS")], { after: "b017225e", mark: OWN })).toEqual({ state: "pending", id: null });
    // Una subida anterior con el mismo commit (otra ejecución) no cuenta
    expect(ownDeployState([prev, up("viejo", "SUCCESS")], { after: "b017225e", mark: OWN })).toEqual({ state: "pending", id: null });
  });

  it("las publicaciones del Core, el CRM y la web usan la espera del propio despliegue", () => {
    const src = fs.readFileSync(path.resolve(__dirname, "../scripts/deploy/esRailway.ts"), "utf8");
    expect(src).toContain("await waitOwnOrCancel(sid, sc.environmentId, before, mark)");
    expect(src).toContain("await waitOwnOrCancel(sid, sc.environmentId, before, note)");
    expect(src).not.toContain("await waitOrCancel(");
  });
});
