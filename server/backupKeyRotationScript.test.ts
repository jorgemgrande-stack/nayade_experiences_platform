/**
 * Script de rotación de la clave de copias (scripts/railway/rotar-clave-copias.mjs) con una CLI de
 * Railway simulada: nunca muestra material de clave, simula por defecto, escribe solo con
 * --stdin --skip-deploys, conserva bk1, es idempotente y se recupera de un fallo a medias.
 */
import { describe, it, expect } from "vitest";
import crypto from "node:crypto";
import { backupKeyringFromEnv, decryptBuffer, encryptBuffer } from "./_core/ops/backupCrypto";
// @ts-expect-error módulo .mjs sin tipos
import { rotate, fingerprint, RotationError } from "../scripts/railway/rotar-clave-copias.mjs";

const K1 = crypto.randomBytes(32);
const SERVICES = ["backup-job", "restore-drill"];

function fakeRailway(init?: Record<string, Record<string, string>>, failOn?: { service: string; times: number }) {
  const vars: Record<string, Record<string, string>> = init ?? Object.fromEntries(SERVICES.map((s) => [s, { BACKUP_KEYS: `bk1:${K1.toString("base64")}`, BACKUP_ACTIVE_KEY_ID: "bk1", OTRA: "x" }]));
  const calls: string[][] = [];
  let failures = failOn?.times ?? 0;
  const cli = (args: string[], input?: string) => {
    calls.push(args);
    const service = args[args.indexOf("--service") + 1];
    if (args[0] === "variable" && args[1] === "list") return JSON.stringify(vars[service]);
    if (args[0] === "variable" && args[1] === "set") {
      if (!args.includes("--stdin") || !args.includes("--skip-deploys")) throw new Error("escritura sin --stdin/--skip-deploys");
      if (failOn && service === failOn.service && failures > 0) {
        failures--;
        throw new Error("fallo simulado");
      }
      vars[service] = { ...vars[service], [args[2]]: input! };
      return "";
    }
    throw new Error(`orden inesperada ${args.join(" ")}`);
  };
  return { cli, vars, calls };
}

const leaks = (report: unknown, keys: Buffer[]) => {
  const text = JSON.stringify(report);
  return keys.some((k) => {
    const b64 = k.toString("base64");
    for (let i = 0; i + 8 <= b64.length; i++) if (text.includes(b64.slice(i, i + 8))) return true;
    return text.includes(k.toString("hex").slice(0, 16));
  });
};

describe("rotación de la clave de copias (script)", () => {
  it("estado: solo identificadores y huellas", () => {
    const f = fakeRailway();
    const rep = rotate("estado", {}, { cli: f.cli });
    expect(rep.state).toEqual(SERVICES.map((service) => ({ service, active: "bk1", keys: [{ id: "bk1", fingerprint: fingerprint(K1) }] })));
    expect(leaks(rep, [K1])).toBe(false);
  });

  it("simulación por defecto: no escribe nada", () => {
    const f = fakeRailway();
    const rep = rotate("anadir", { id: "bk2" }, { cli: f.cli, random: () => crypto.randomBytes(32) });
    expect(rep.actions.map((a: { action: string }) => a.action)).toEqual(["añadir clave (sin activarla)", "añadir clave (sin activarla)"]);
    expect(f.calls.every((c) => c[1] === "list")).toBe(true);
  });

  it("ciclo completo: añadir, activar y revertir, sin perder bk1 y sin mostrar claves", () => {
    const f = fakeRailway();
    const K2 = crypto.randomBytes(32);
    const add = rotate("anadir", { id: "bk2", apply: true }, { cli: f.cli, random: () => K2 });
    for (const s of SERVICES) {
      expect(f.vars[s].BACKUP_KEYS).toBe(`bk1:${K1.toString("base64")},bk2:${K2.toString("base64")}`);
      expect(f.vars[s].BACKUP_ACTIVE_KEY_ID).toBe("bk1");
      expect(f.vars[s].OTRA).toBe("x");
    }
    const act = rotate("activar", { id: "bk2", apply: true }, { cli: f.cli });
    expect(SERVICES.map((s) => f.vars[s].BACKUP_ACTIVE_KEY_ID)).toEqual(["bk2", "bk2"]);

    // El llavero resultante funciona con el código de copias: lo antiguo (bk1) y lo nuevo (bk2)
    const oldRing = backupKeyringFromEnv({ BACKUP_KEYS: `bk1:${K1.toString("base64")}`, BACKUP_ACTIVE_KEY_ID: "bk1" } as NodeJS.ProcessEnv);
    const ring = backupKeyringFromEnv({ ...f.vars["backup-job"] } as NodeJS.ProcessEnv);
    const old = encryptBuffer(Buffer.from("copia antigua"), oldRing, "crm:crm");
    expect(decryptBuffer(old, ring, "crm:crm").toString()).toBe("copia antigua");
    expect(decryptBuffer(encryptBuffer(Buffer.from("nueva"), ring, "crm:crm"), ring, "crm:crm").toString()).toBe("nueva");
    expect(encryptBuffer(Buffer.from("n"), ring, "a").subarray(6, 9).toString()).toBe("bk2");

    const rev = rotate("revertir", { id: "bk1", apply: true }, { cli: f.cli });
    expect(SERVICES.map((s) => f.vars[s].BACKUP_ACTIVE_KEY_ID)).toEqual(["bk1", "bk1"]);
    expect(f.vars["restore-drill"].BACKUP_KEYS).toContain("bk2:");
    for (const r of [add, act, rev]) expect(leaks(r, [K1, K2])).toBe(false);
  });

  it("idempotente: repetir añadir no cambia nada ni genera otra clave", () => {
    const f = fakeRailway();
    const K2 = crypto.randomBytes(32);
    rotate("anadir", { id: "bk2", apply: true }, { cli: f.cli, random: () => K2 });
    const writes = f.calls.filter((c) => c[1] === "set").length;
    const again = rotate("anadir", { id: "bk2", apply: true }, { cli: f.cli, random: () => crypto.randomBytes(32) });
    expect(again.actions.every((a: { action: string }) => a.action === "sin cambios")).toBe(true);
    expect(f.calls.filter((c) => c[1] === "set").length).toBe(writes);
  });

  it("fallo a medias: el reintento reutiliza la bk2 ya escrita y deja los dos servicios iguales", () => {
    const f = fakeRailway(undefined, { service: "restore-drill", times: 1 });
    const K2 = crypto.randomBytes(32);
    expect(() => rotate("anadir", { id: "bk2", apply: true }, { cli: f.cli, random: () => K2 })).toThrow(/restore-drill/);
    expect(f.vars["backup-job"].BACKUP_KEYS).toContain("bk2:");
    expect(f.vars["restore-drill"].BACKUP_KEYS).not.toContain("bk2:");
    rotate("anadir", { id: "bk2", apply: true }, { cli: f.cli, random: () => crypto.randomBytes(32) });
    expect(f.vars["restore-drill"].BACKUP_KEYS).toBe(f.vars["backup-job"].BACKUP_KEYS);
  });

  it("se niega a seguir con llaveros distintos, a activar una clave ausente o con datos mal formados", () => {
    const other = crypto.randomBytes(32).toString("base64");
    const f = fakeRailway({
      "backup-job": { BACKUP_KEYS: `bk1:${K1.toString("base64")}`, BACKUP_ACTIVE_KEY_ID: "bk1" },
      "restore-drill": { BACKUP_KEYS: `bk1:${other}`, BACKUP_ACTIVE_KEY_ID: "bk1" },
    });
    expect(() => rotate("estado", {}, { cli: f.cli })).toThrow(/distinta entre servicios/);
    expect(() => rotate("activar", { id: "bk2", apply: true }, { cli: fakeRailway().cli })).toThrow(/no está en BACKUP_KEYS/);
    const bad = fakeRailway({ "backup-job": { BACKUP_KEYS: "bk1:corta", BACKUP_ACTIVE_KEY_ID: "bk1" }, "restore-drill": { BACKUP_KEYS: "bk1:corta", BACKUP_ACTIVE_KEY_ID: "bk1" } });
    expect(() => rotate("estado", {}, { cli: bad.cli })).toThrow(RotationError);
    expect(() => rotate("anadir", {}, { cli: fakeRailway().cli })).toThrow(/--id/);
  });

  it("los errores de la CLI no arrastran valores", () => {
    const cli = () => {
      throw new Error(`salida con secreto ${K1.toString("base64")}`);
    };
    try {
      rotate("estado", {}, { cli });
      throw new Error("debía fallar");
    } catch (e) {
      expect(String((e as Error).message)).not.toContain(K1.toString("base64").slice(0, 8));
    }
  });
});
