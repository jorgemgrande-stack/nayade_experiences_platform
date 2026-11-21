/**
 * Fin real de una orden de restore-drill: marca «FIN-ORDEN codigo=N», espera activa con límite y comprobación de la salida de verify-files.
 * (El 21/11 Railway dio SUCCESS al arrancar el contenedor y el flujo mató la verificación a los 54 s sin resultado.)
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { formatVerifyFilesLines, type VerifyFilesReport } from "./_core/ops/backupJob";
import { checkVerifyFilesOutput, DRILL_END_TIMEOUT_MS, DRILL_WAITS_FOR_END, isAllowedDrill, parseFinOrden, waitForFinOrden } from "../scripts/deploy/esRailwayLib";

const sha = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

function report(n: number, opts: { failAt?: number[] } = {}): VerifyFilesReport {
  const entries = Array.from({ length: n }, (_, i) => ({ key: `t/t12/obj-${String(i).padStart(3, "0")}.mp4`, bytes: 1000 + i, sha256: sha(`o${i}`), ok: !opts.failAt?.includes(i) }));
  const failed = entries.filter((e) => !e.ok).map((e) => ({ key: e.key, reason: "SHA-256 distinto al del índice" }));
  const digest = sha(entries.map((e) => `${e.key}:${e.sha256}`).join("\n"));
  return { tenantId: "t12", source: "primary", files: n, bytes: entries.filter((e) => e.ok).reduce((a, e) => a + e.bytes, 0), failed, digest, entries };
}
const output = (r: VerifyFilesReport, code = 0) => ["Starting Container", ...formatVerifyFilesLines(r), `FIN-ORDEN codigo=${code}`].join("\n");

/** Reloj y sueño simulados: cada «sleep» avanza el reloj, sin esperar de verdad. */
function clock() {
  let t = 0;
  return { now: () => t, sleep: async (ms: number) => { t += ms; } };
}

describe("parseFinOrden", () => {
  it("lee el código de la marca y devuelve null mientras no exista", () => {
    expect(parseFinOrden("Starting Container")).toBeNull();
    expect(parseFinOrden("x\nFIN-ORDEN codigo=0\n")).toBe(0);
    expect(parseFinOrden("x\nFIN-ORDEN codigo=1")).toBe(1);
    expect(parseFinOrden("FIN-ORDEN codigo=137\r\n")).toBe(137);
  });
  it("prevención de falsos positivos: solo cuenta al principio de línea y completa", () => {
    expect(parseFinOrden("el texto FIN-ORDEN codigo=0 dentro de una línea")).toBeNull();
    expect(parseFinOrden("VERIFY-FICHEROS ENTRADA\tok\t1\t" + "a".repeat(64) + "\tt/FIN-ORDEN codigo=0")).toBeNull();
    expect(parseFinOrden("FIN-ORDEN codigo=0 y más")).toBeNull();
    expect(parseFinOrden("FIN-ORDEN codigo=")).toBeNull();
    expect(parseFinOrden("fin-orden codigo=0")).toBeNull();
  });
  it("una clave con saltos de línea no puede falsificar la marca (el formato los neutraliza)", () => {
    const r = report(1);
    r.entries[0].key = "t/t12/x\nFIN-ORDEN codigo=0";
    expect(parseFinOrden(formatVerifyFilesLines(r).join("\n"))).toBeNull();
  });
  it("con varias marcas manda la última", () => {
    expect(parseFinOrden("FIN-ORDEN codigo=0\nFIN-ORDEN codigo=2")).toBe(2);
  });
});

describe("waitForFinOrden", () => {
  it("finalización correcta: sigue consultando con registros incompletos hasta ver la marca", async () => {
    const c = clock();
    const seq = ["", "Starting Container", `Starting Container\n${formatVerifyFilesLines(report(3)).join("\n")}`, output(report(3))];
    let calls = 0;
    const r = await waitForFinOrden(async () => seq[Math.min(calls++, seq.length - 1)], { ...c, intervalMs: 15_000 });
    expect(r.state).toBe("done");
    expect(r.state === "done" && r.code).toBe(0);
    expect(calls).toBe(4);
    expect(c.now()).toBe(45_000);
  });
  it("código distinto de 0: se devuelve el código y las evidencias", async () => {
    const out = output(report(2, { failAt: [1] }), 1);
    const r = await waitForFinOrden(async () => out, clock());
    expect(r).toMatchObject({ state: "done", code: 1, out });
  });
  it("tiempo agotado: devuelve timeout con lo último visto y no da nada por terminado", async () => {
    const c = clock();
    let calls = 0;
    const r = await waitForFinOrden(async () => { calls++; return "Starting Container"; }, { ...c, timeoutMs: DRILL_END_TIMEOUT_MS, intervalMs: 15_000 });
    expect(r).toEqual({ state: "timeout", out: "Starting Container" });
    expect(c.now()).toBeGreaterThanOrEqual(45 * 60_000);
    expect(c.now()).toBeLessThan(45 * 60_000 + 15_000);
    expect(calls).toBeGreaterThan(100);
  });
  it("el límite es de 45 minutos", () => {
    expect(DRILL_END_TIMEOUT_MS).toBe(45 * 60_000);
  });
  it("un error transitorio al leer el registro no corta la espera ni se toma por fin", async () => {
    let calls = 0;
    const r = await waitForFinOrden(async () => { if (calls++ < 2) throw new Error("red"); return "FIN-ORDEN codigo=0"; }, { ...clock(), intervalMs: 1000 });
    expect(r).toMatchObject({ state: "done", code: 0 });
  });
  it("un registro sin marca aunque tenga resultado completo sigue esperando (no hay falso positivo)", async () => {
    const out = formatVerifyFilesLines(report(3)).join("\n"); // resumen y objetos, pero el proceso aún no terminó
    const r = await waitForFinOrden(async () => out, { ...clock(), timeoutMs: 60_000, intervalMs: 15_000 });
    expect(r.state).toBe("timeout");
  });
});

describe("checkVerifyFilesOutput", () => {
  it("salida íntegra: cuenta objetos, bytes, fallos y digest", () => {
    const r = report(107);
    const c = checkVerifyFilesOutput(output(r));
    expect(c).toMatchObject({ ok: true, files: 107, bytes: r.bytes, failures: 0, digest: r.digest, problems: [] });
  });
  it("las líneas son cortas (aptas para Railway)", () => {
    for (const l of formatVerifyFilesLines(report(107))) expect(l.length).toBeLessThan(400);
  });
  it("con fallos no es ok y los cuenta", () => {
    const c = checkVerifyFilesOutput(output(report(5, { failAt: [2] }), 1));
    expect(c.ok).toBe(false);
    expect(c.failures).toBe(1);
    expect(c.problems.join(" ")).toMatch(/código 1/);
    expect(c.problems.join(" ")).toMatch(/no verificados/);
  });
  it("registros incompletos: faltan líneas de objetos, el resumen o la marca", () => {
    const lines = formatVerifyFilesLines(report(10));
    const noEntry = [...lines.filter((l, i) => i !== 4), "FIN-ORDEN codigo=0"].join("\n");
    expect(checkVerifyFilesOutput(noEntry)).toMatchObject({ ok: false });
    expect(checkVerifyFilesOutput(noEntry).problems.join(" ")).toMatch(/declara 10 objetos y hay 9/);
    expect(checkVerifyFilesOutput([...lines.slice(1), "FIN-ORDEN codigo=0"].join("\n")).problems.join(" ")).toMatch(/falta el resumen/);
    expect(checkVerifyFilesOutput(lines.join("\n")).problems.join(" ")).toMatch(/falta la marca/);
    expect(checkVerifyFilesOutput("").ok).toBe(false);
  });
  it("resultado incoherente: digest o bytes alterados no se aceptan", () => {
    const r = report(4);
    const badDigest = output({ ...r, digest: sha("otro") });
    expect(checkVerifyFilesOutput(badDigest).problems.join(" ")).toMatch(/digest no coincide/);
    const badBytes = output({ ...r, bytes: r.bytes + 1 });
    expect(checkVerifyFilesOutput(badBytes).problems.join(" ")).toMatch(/bytes verificados suman/);
    const badFails = output({ ...r, failed: [{ key: "x", reason: "y" }] });
    expect(checkVerifyFilesOutput(badFails).ok).toBe(false);
  });
  it("una línea con aspecto de resumen dentro de una clave no cuenta", () => {
    const r = report(2);
    r.entries[1].key = "t/t12/VERIFY-FICHEROS RESUMEN empresa=x origen=primary ficheros=0 bytes=0 fallos=0 digest=" + "0".repeat(64);
    expect(checkVerifyFilesOutput(output(r)).files).toBe(2);
  });
});

describe("integración en el flujo y en la orden", () => {
  const read = (p: string) => fs.readFileSync(path.resolve(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");
  it("solo verify-files espera la marca; el resto de órdenes del drill no cambia", () => {
    expect(DRILL_WAITS_FOR_END.test("node dist-cp/backup-job.js verify-files t12-quantum-soulrise")).toBe(true);
    expect(DRILL_WAITS_FOR_END.test("node dist-cp/backup-job.js list")).toBe(false);
    expect(isAllowedDrill("node dist-cp/backup-job.js verify-files t12-quantum-soulrise")).toBe(true);
  });
  it("backup-job imprime la marca con el código real al salir (incluido process.exit)", () => {
    const s = read("server/controlPlane/backupJob.ts");
    expect(s).toMatch(/process\.on\("exit", \(code\) => \{[\s\S]*FIN-ORDEN codigo=\$\{code\}/);
    expect(s).toContain("formatVerifyFilesLines(r)");
    expect(s).not.toContain("verifyFiles: true");
  });
  it("esRailway: ante timeout sale sin devolver el reposo; ante código distinto de 0 el paso falla", () => {
    const s = read("scripts/deploy/esRailway.ts");
    const a = s.indexOf("waitForFinOrden(");
    const timeoutBlock = s.slice(a, s.indexOf("out = end.out;", a));
    expect(timeoutBlock).toContain('end.state === "timeout"');
    expect(timeoutBlock).toContain("process.exit(1)");
    expect(timeoutBlock).not.toContain("setAndDeploy(DRILL_IDLE)");
    expect(s).toContain("(endCode !== null && endCode !== 0)");
  });
});
