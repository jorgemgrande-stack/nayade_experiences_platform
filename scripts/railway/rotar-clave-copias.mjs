#!/usr/bin/env node
/**
 * Rotación de la clave de cifrado de copias (BACKUP_KEYS / BACKUP_ACTIVE_KEY_ID) en Railway, sin que
 * ninguna clave aparezca en la terminal, en los logs ni en ficheros. Procedimiento completo:
 * docs/runbooks/ROTACION_CLAVE_COPIAS.md.
 *
 *   node scripts/railway/rotar-clave-copias.mjs estado
 *   node scripts/railway/rotar-clave-copias.mjs anadir   --id bk2 [--apply]   genera bk2 y la AÑADE (no la activa)
 *   node scripts/railway/rotar-clave-copias.mjs activar  --id bk2 [--apply]   las copias nuevas se cifran con bk2
 *   node scripts/railway/rotar-clave-copias.mjs revertir --id bk1 [--apply]   vuelve a activar bk1 (bk2 se conserva)
 *
 * Garantías:
 *  - Simulación salvo `--apply`. Nunca borra ni sustituye una clave existente: no hay orden para retirar claves.
 *  - Lee las variables con la CLI de Railway dentro del proceso y escribe con `--stdin --skip-deploys`.
 *  - Solo imprime identificadores de clave y huellas (HMAC-SHA256 con etiqueta fija, 12 hex; no reversibles).
 *  - Exige el mismo llavero en todos los servicios antes y lo comprueba de nuevo después de escribir.
 */
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import { pathToFileURL } from "node:url";

export const DEFAULTS = {
  project: "5f32ccca-3f72-4c48-bc63-57881cb9e166",
  environment: "production",
  services: ["backup-job", "restore-drill"],
};
const KEY_ID_RE = /^[a-z0-9_-]{1,32}$/i;

export class RotationError extends Error {}

export const fingerprint = (key) => crypto.createHmac("sha256", "elephant-backup-fingerprint:v1").update(key).digest("hex").slice(0, 12);

/** Llavero `id:base64(32),…` → Map(id → Buffer). Mismas reglas que backupKeyringFromEnv. */
export function parseKeys(raw) {
  const keys = new Map();
  for (const part of String(raw ?? "").split(",").map((s) => s.trim()).filter(Boolean)) {
    const idx = part.indexOf(":");
    if (idx < 1) throw new RotationError("BACKUP_KEYS mal formado (esperado id:base64)");
    const id = part.slice(0, idx);
    const key = Buffer.from(part.slice(idx + 1), "base64");
    if (!KEY_ID_RE.test(id)) throw new RotationError("Identificador de clave no válido en BACKUP_KEYS");
    if (key.length !== 32) throw new RotationError(`La clave ${id} no tiene 32 bytes`);
    if (keys.has(id)) throw new RotationError(`La clave ${id} está repetida`);
    keys.set(id, key);
  }
  if (!keys.size) throw new RotationError("BACKUP_KEYS vacío");
  return keys;
}

const serializeKeys = (keys) => [...keys].map(([id, k]) => `${id}:${k.toString("base64")}`).join(",");

/** CLI real de Railway. `run(args, input?)` devuelve stdout; nunca se imprime. */
export function railwayCli(bin = process.env.RAILWAY_BIN || "railway") {
  return (args, input) => execFileSync(bin, args, { input, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], maxBuffer: 16 * 1024 * 1024 });
}

function readService(cli, o, service) {
  let vars;
  try {
    vars = JSON.parse(cli(["variable", "list", "--service", service, "--environment", o.environment, "--project", o.project, "--json"]));
  } catch {
    throw new RotationError(`No se pudieron leer las variables de ${service}`);
  }
  const keys = parseKeys(vars.BACKUP_KEYS);
  const active = vars.BACKUP_ACTIVE_KEY_ID ?? "";
  if (!keys.has(active)) throw new RotationError(`${service}: BACKUP_ACTIVE_KEY_ID no figura en BACKUP_KEYS`);
  return { service, keys, active };
}

function readAll(cli, o) {
  return o.services.map((s) => readService(cli, o, s));
}

export function describe(states) {
  return states.map((s) => ({ service: s.service, active: s.active, keys: [...s.keys].map(([id, k]) => ({ id, fingerprint: fingerprint(k) })) }));
}

/** Las claves que comparten identificador deben ser idénticas en todos los servicios. */
function assertConsistent(states) {
  const seen = new Map();
  for (const s of states) {
    for (const [id, k] of s.keys) {
      const prev = seen.get(id);
      if (prev && !prev.equals(k)) throw new RotationError(`La clave ${id} es distinta entre servicios: revisar a mano antes de seguir`);
      seen.set(id, k);
    }
  }
  return seen;
}

function setVar(cli, o, service, name, value) {
  try {
    cli(["variable", "set", name, "--stdin", "--skip-deploys", "--service", service, "--environment", o.environment, "--project", o.project], value);
  } catch {
    throw new RotationError(`No se pudo escribir ${name} en ${service}`);
  }
}

/**
 * Ejecuta una fase. Devuelve un informe sin secretos: { phase, apply, actions[], after? }.
 * `random` solo se inyecta en las pruebas.
 */
export function rotate(phase, args, deps = {}) {
  const o = { ...DEFAULTS, ...(deps.options ?? {}) };
  const cli = deps.cli ?? railwayCli();
  const random = deps.random ?? (() => crypto.randomBytes(32));
  const apply = !!args.apply;
  const id = args.id;
  const states = readAll(cli, o);
  const all = assertConsistent(states);
  const actions = [];

  if (phase === "estado") return { phase, apply: false, actions, state: describe(states) };
  if (!id || !KEY_ID_RE.test(id)) throw new RotationError("Falta --id <identificador de clave>");

  if (phase === "anadir") {
    const key = all.get(id) ?? random();
    if (!Buffer.isBuffer(key) || key.length !== 32) throw new RotationError("La clave generada no tiene 32 bytes");
    for (const s of states) {
      if (s.keys.has(id)) {
        actions.push({ service: s.service, action: "sin cambios", id, fingerprint: fingerprint(key) });
        continue;
      }
      const next = new Map(s.keys);
      next.set(id, key);
      parseKeys(serializeKeys(next));
      actions.push({ service: s.service, action: "añadir clave (sin activarla)", id, fingerprint: fingerprint(key), keysAfter: [...next.keys()] });
      if (apply) setVar(cli, o, s.service, "BACKUP_KEYS", serializeKeys(next));
    }
  } else if (phase === "activar" || phase === "revertir") {
    for (const s of states) {
      if (!s.keys.has(id)) throw new RotationError(`${s.service}: la clave ${id} no está en BACKUP_KEYS (añádela antes)`);
    }
    for (const s of states) {
      if (s.active === id) {
        actions.push({ service: s.service, action: "sin cambios", active: id });
        continue;
      }
      actions.push({ service: s.service, action: `activar ${id}`, from: s.active, to: id });
      if (apply) setVar(cli, o, s.service, "BACKUP_ACTIVE_KEY_ID", id);
    }
  } else {
    throw new RotationError(`Fase desconocida: ${phase}`);
  }

  if (!apply) return { phase, apply, actions };
  // Comprobación posterior: relectura completa, llaveros coherentes y ninguna clave anterior perdida o cambiada
  const after = readAll(cli, o);
  const allAfter = assertConsistent(after);
  for (const [kid, k] of all) {
    if (!allAfter.get(kid)?.equals(k)) throw new RotationError(`Tras escribir, la clave ${kid} falta o ha cambiado: revisar de inmediato`);
  }
  for (const s of after) {
    if (!s.keys.has(id)) throw new RotationError(`Tras escribir, ${s.service} no tiene la clave ${id}`);
    if ((phase === "activar" || phase === "revertir") && s.active !== id) throw new RotationError(`Tras escribir, ${s.service} no tiene ${id} activa`);
  }
  return { phase, apply, actions, after: describe(after) };
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--apply") out.apply = true;
    else if (a === "--id") out.id = argv[++i];
    else out._.push(a);
  }
  return out;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const args = parseArgs(process.argv.slice(2));
  try {
    const rep = rotate(args._[0] ?? "estado", args);
    console.log(JSON.stringify(rep, null, 2));
    if (!rep.apply && rep.actions.length) console.log("\n(simulación: no se ha escrito nada; añade --apply para aplicar)");
  } catch (e) {
    console.error(e instanceof RotationError ? `ERROR: ${e.message}` : "ERROR inesperado (sin detalles para no exponer valores)");
    process.exitCode = 1;
  }
}
