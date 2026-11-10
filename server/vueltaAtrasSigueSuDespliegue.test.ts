/**
 * La vuelta atrás (y las demás órdenes que crean un despliegue: redespliegue de la misma imagen, subidas del
 * procedimiento protegido, restore-drill) espera a SU despliegue, no al último del servicio. Mismo patrón que corrigió
 * la PR #766 en `publish`: si llega un despliegue nativo a la vez (una fusión que espera a su CI), «el último» es el
 * nativo y la orden esperaba al que no era.
 *
 * Metadatos reales de Railway (core de live, 10/11/2026): la vuelta atrás 238fd6fe al despliegue nativo b017225e copia
 * su origen (repo, commitHash, imageDigest) y lleva `reason: "rollback"`; Railway no devuelve su identificador.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { isRollbackOf, ownDeployState } from "../scripts/deploy/esRailwayLib";

const REPO = "jorgemgrande-stack/nayade_experiences_platform";
const SHA_PREV = "884dad23a4d8446a3ece931b8539f451c7734933";
const SHA_NEW = "be0fb32bf49711ef406d9a9ded347c47f5e3ba8b";
const IMG_PREV = "sha256:4f2c815f37a21b1f6a8102fa0d3a371f08cbee2fea6ebc73184412852e93068d";
const nativeMeta = (sha: string, image?: string) => ({ reason: "deploy", repo: REPO, commitHash: sha, branch: "integration/elephant-source", ...(image ? { imageDigest: image } : {}) });
const upMeta = (sha: string, image?: string) => ({ reason: "deploy", cliMessage: `nayade_experiences_platform ${sha}`, ...(image ? { imageDigest: image } : {}) });
const node = (id: string, status: string, meta: unknown) => ({ id, status, meta });

// Destino de la vuelta atrás (nativo, ya retirado) y lo que había justo antes de pedirla
const target = node("b017225e", "REMOVED", nativeMeta(SHA_PREV, IMG_PREV));
const failed = node("af9a29ed", "FAILED", upMeta("f0bde4924a0f3dda2676c9174c4ccc833b576e1e"));
const rb = (status: string) => node("238fd6fe", status, { ...nativeMeta(SHA_PREV, IMG_PREV), reason: "rollback" });
const incoming = (status: string) => node("df94ec1c", status, nativeMeta(SHA_NEW));
const want = { after: "af9a29ed", rollbackOf: target.meta };

describe("la vuelta atrás sigue su propio despliegue", () => {
  it("caso normal: espera mientras arranca y termina con el estado de la vuelta atrás", () => {
    expect(ownDeployState([failed, target], want)).toEqual({ state: "pending", id: null });
    expect(ownDeployState([rb("DEPLOYING"), failed, target], want)).toEqual({ state: "pending", id: "238fd6fe" });
    expect(ownDeployState([rb("SUCCESS"), failed, target], want)).toEqual({ state: "done", id: "238fd6fe", status: "SUCCESS" });
    expect(ownDeployState([rb("CRASHED"), failed, target], want)).toEqual({ state: "done", id: "238fd6fe", status: "CRASHED" });
  });

  it("un despliegue nativo que llega a la vez no se toma por la vuelta atrás", () => {
    // Antes: «el último» era el nativo. Sin terminar → espera agotada aunque la vuelta atrás ya estuviera activa
    expect(ownDeployState([incoming("WAITING"), rb("SUCCESS"), failed, target], want)).toEqual({ state: "done", id: "238fd6fe", status: "SUCCESS" });
    // Antes: nativo terminado (p. ej. SKIPPED o FAILED) → se daba ese estado por el de la vuelta atrás, aún en curso
    expect(ownDeployState([incoming("SKIPPED"), rb("DEPLOYING"), failed, target], want)).toEqual({ state: "pending", id: "238fd6fe" });
    expect(ownDeployState([incoming("FAILED"), rb("SUCCESS"), failed, target], want)).toEqual({ state: "done", id: "238fd6fe", status: "SUCCESS" });
    // El nativo aparece ANTES que la vuelta atrás: tampoco es ella
    expect(ownDeployState([incoming("SUCCESS"), failed, target], want)).toEqual({ state: "pending", id: null });
    expect(ownDeployState([rb("SUCCESS"), incoming("REMOVED"), failed, target], want)).toEqual({ state: "done", id: "238fd6fe", status: "SUCCESS" });
  });

  it("si un despliegue posterior la sustituye, es «superseded» y se dice cuál", () => {
    expect(ownDeployState([incoming("SUCCESS"), rb("REMOVED"), failed, target], want)).toEqual({ state: "superseded", id: "238fd6fe", by: "df94ec1c" });
  });

  it("también la sustituye un nativo creado antes que ella (esperaba a su CI) y activado después", () => {
    expect(ownDeployState([rb("REMOVED"), incoming("SUCCESS"), failed, target], want)).toEqual({ state: "superseded", id: "238fd6fe", by: "df94ec1c" });
    expect(ownDeployState([rb("REMOVED"), incoming("DEPLOYING"), failed, target], want)).toEqual({ state: "superseded", id: "238fd6fe", by: "df94ec1c" });
    // Lo mismo para una subida con marca (publicación) y para una orden seguida por identificador
    const mark = "nayade_experiences_platform f0bde4924a0f3dda2676c9174c4ccc833b576e1e";
    const up = node("af9a29ed", "REMOVED", { reason: "deploy", cliMessage: mark });
    expect(ownDeployState([up, incoming("SUCCESS"), target], { after: "b017225e", mark })).toEqual({ state: "superseded", id: "af9a29ed", by: "df94ec1c" });
    expect(ownDeployState([up, incoming("SUCCESS"), target], { after: "b017225e", id: "af9a29ed" })).toEqual({ state: "superseded", id: "af9a29ed", by: "df94ec1c" });
    // Retirada sin nadie que la sustituya (el anterior nuevo falló, se omitió o también está retirado): es su estado, no «superseded»
    expect(ownDeployState([rb("REMOVED"), incoming("FAILED"), failed, target], want)).toEqual({ state: "done", id: "238fd6fe", status: "REMOVED" });
    expect(ownDeployState([rb("REMOVED"), incoming("SKIPPED"), failed, target], want)).toEqual({ state: "done", id: "238fd6fe", status: "REMOVED" });
    // Lo que había ANTES del punto de partida nunca cuenta como sustituto
    expect(ownDeployState([rb("REMOVED"), failed, node("prev", "SUCCESS", nativeMeta(SHA_NEW)), target], want)).toEqual({ state: "done", id: "238fd6fe", status: "REMOVED" });
  });

  it("solo cuenta una vuelta atrás nueva y con el origen del destino", () => {
    // Una vuelta atrás anterior al punto de partida (otra ejecución) no cuenta
    expect(ownDeployState([failed, rb("SUCCESS"), target], want)).toEqual({ state: "pending", id: null });
    // Sin el punto de partida entre los consultados se sigue esperando
    expect(ownDeployState([rb("SUCCESS")], want)).toEqual({ state: "pending", id: null });
    // Una vuelta atrás a OTRO despliegue (otra ejecución a la vez) no es la nuestra
    const other = node("x1", "SUCCESS", { ...nativeMeta(SHA_NEW), reason: "rollback" });
    expect(ownDeployState([other, failed, target], want)).toEqual({ state: "pending", id: null });
    // Un redespliegue o una subida con el mismo commit no es una vuelta atrás
    expect(ownDeployState([node("x2", "SUCCESS", nativeMeta(SHA_PREV, IMG_PREV)), failed, target], want)).toEqual({ state: "pending", id: null });
    expect(ownDeployState([node("x3", "SUCCESS", { ...nativeMeta(SHA_PREV, IMG_PREV), reason: "redeploy" }), failed, target], want)).toEqual({ state: "pending", id: null });
  });

  it("isRollbackOf: exige reason «rollback» y que ningún dato de origen común se contradiga", () => {
    expect(isRollbackOf(rb("SUCCESS").meta, target.meta)).toBe(true);
    expect(isRollbackOf(target.meta, target.meta)).toBe(false);
    expect(isRollbackOf(null, target.meta)).toBe(false);
    // Destino subido con `railway up`: se compara el mensaje de la subida (y la imagen)
    const upTarget = upMeta(SHA_PREV, IMG_PREV);
    expect(isRollbackOf({ ...upTarget, reason: "rollback" }, upTarget)).toBe(true);
    expect(isRollbackOf({ ...upMeta(SHA_NEW, IMG_PREV), reason: "rollback" }, upTarget)).toBe(false);
    expect(isRollbackOf({ ...upTarget, imageDigest: "sha256:otra", reason: "rollback" }, upTarget)).toBe(false);
    // Sin datos comunes que comparar (o sin metadatos del destino) vale cualquier vuelta atrás
    expect(isRollbackOf({ reason: "rollback" }, upTarget)).toBe(true);
    expect(isRollbackOf({ reason: "rollback", commitHash: SHA_NEW }, null)).toBe(true);
  });

  it("la subida con mensaje nunca toma por propia una vuelta atrás a una subida con el mismo mensaje", () => {
    const mark = `nayade_experiences_platform ${SHA_PREV}`;
    const rollbackToUp = node("r1", "SUCCESS", { ...upMeta(SHA_PREV), reason: "rollback" });
    expect(ownDeployState([rollbackToUp, failed], { after: "af9a29ed", mark })).toEqual({ state: "pending", id: null });
  });
});

describe("las órdenes que devuelven el identificador esperan a ese despliegue", () => {
  const redeploy = (status: string) => node("re1", status, { ...nativeMeta(SHA_PREV, IMG_PREV), reason: "redeploy" });

  it("redespliegue de la misma imagen: se sigue por identificador aunque llegue otro despliegue", () => {
    expect(ownDeployState([target], { after: "b017225e", id: "re1" })).toEqual({ state: "pending", id: null });
    expect(ownDeployState([incoming("WAITING"), redeploy("DEPLOYING"), target], { after: "b017225e", id: "re1" })).toEqual({ state: "pending", id: "re1" });
    expect(ownDeployState([incoming("WAITING"), redeploy("SUCCESS"), target], { after: "b017225e", id: "re1" })).toEqual({ state: "done", id: "re1", status: "SUCCESS" });
    expect(ownDeployState([incoming("FAILED"), redeploy("DEPLOYING"), target], { after: "b017225e", id: "re1" })).toEqual({ state: "pending", id: "re1" });
    expect(ownDeployState([incoming("SUCCESS"), redeploy("REMOVED"), target], { after: "b017225e", id: "re1" })).toEqual({ state: "superseded", id: "re1", by: "df94ec1c" });
  });

  it("con identificador no hace falta el punto de partida (despliegue nativo en curso del CRM)", () => {
    expect(ownDeployState([incoming("BUILDING"), target], { after: null, id: "df94ec1c" })).toEqual({ state: "pending", id: "df94ec1c" });
    expect(ownDeployState([node("z9", "WAITING", nativeMeta("1".repeat(40))), incoming("SUCCESS"), target], { after: null, id: "df94ec1c" })).toEqual({ state: "done", id: "df94ec1c", status: "SUCCESS" });
  });

  it("sin identificador ni marca se toma el primero que apareció tras el punto de partida, nunca el último", () => {
    expect(ownDeployState([target], { after: "b017225e", first: true })).toEqual({ state: "pending", id: null });
    expect(ownDeployState([incoming("WAITING"), redeploy("SUCCESS"), target], { after: "b017225e", first: true })).toEqual({ state: "done", id: "re1", status: "SUCCESS" });
  });
});

describe("esRailway.ts no espera «al último despliegue del servicio»", () => {
  const src = fs.readFileSync(path.resolve(__dirname, "../scripts/deploy/esRailway.ts"), "utf8");

  it("no queda ninguna espera sobre el último despliegue", () => {
    expect(src).not.toMatch(/\bwaitFor\(/);
    // `latest` solo sirve para anotar el punto de partida (o el despliegue que se va a redesplegar), nunca para esperar
    const waitOwn = src.slice(src.indexOf("async function waitOwn("), src.indexOf("const waitOwnOrCancel"));
    expect(waitOwn).toContain("const nodes = await deployments(serviceIdValue, environmentId, 20);");
    expect(waitOwn).toContain("ownDeployState(nodes, target)");
    expect(waitOwn).not.toContain("latest(");
  });

  it("la vuelta atrás espera a la suya y no se cancela al agotarse la espera", () => {
    const fn = src.slice(src.indexOf("async function rollback("), src.indexOf("/** Comprobaciones funcionales del entorno"));
    expect(fn).toContain("deploymentRollback(id:$id)");
    expect(fn).toContain("rollbackOf: target?.meta ?? null");
    expect(fn).not.toContain("cancel: true");
  });

  it("los redespliegues de la misma imagen pasan por redeploySameImage (espera por identificador)", () => {
    expect(src.match(/await redeploySameImage\(/g)?.length).toBe(6);
    // Fuera de redeploySameImage solo queda el de restore-drill, que también recoge el identificador
    expect(src.match(/deploymentRedeploy\(id:\$id, usePreviousImageTag:true\)\{ id \}/g)?.length).toBe(2);
    expect(src).toContain("own ? { after: before, id: own } : { after: before, first: true }");
  });

  it("solo la publicación ordinaria cancela su subida al agotarse la espera", () => {
    expect(src.match(/cancel: true/g)?.length).toBe(1);
    expect(src.match(/await waitOwnOrCancel\(/g)?.length).toBe(2);
  });
});

describe("los llamadores tratan los estados nuevos de la espera", () => {
  const src = fs.readFileSync(path.resolve(__dirname, "../scripts/deploy/esRailway.ts"), "utf8").replace(/\r/g, "");
  const block = (from: string, to: string) => src.slice(src.indexOf(from), src.indexOf(to, src.indexOf(from)));

  it("revert: una vuelta atrás que no queda en SUCCESS hace fallar la orden aunque el servicio responda", () => {
    const revert = block('if (cmd === "revert")', 'if (cmd === "rollback-recorded")');
    expect(revert).toContain('if (reverted !== "SUCCESS") process.exit(1);');
    expect(revert.indexOf('if (reverted !== "SUCCESS")')).toBeLessThan(revert.indexOf("functional(env)"));
  });

  it("drill: con la espera agotada falla sin relanzar el reposo; un reposo que no queda bien se avisa", () => {
    const drill = src.slice(src.indexOf('if (cmd === "drill")'));
    expect(drill.indexOf('if (d.status === "TIMEOUT")')).toBeGreaterThan(0);
    expect(drill.indexOf('if (d.status === "TIMEOUT")')).toBeLessThan(drill.indexOf("await setAndDeploy(DRILL_IDLE)"));
    expect(drill).toMatch(/if \(d\.status === "TIMEOUT"\) \{[\s\S]{0,400}?process\.exit\(1\);/);
    expect(drill).toContain('if (idle.status === "SUCCESS")');
  });

  it("identificador que no aparece: tras varias consultas se sigue al primero posterior, con aviso", () => {
    const waitOwn = block("async function waitOwn(", "const waitOwnOrCancel");
    expect(waitOwn).toContain("ownDeployState(nodes, { after: target.after, first: true })");
    expect(waitOwn).toContain("++missing >= 4");
  });
});
