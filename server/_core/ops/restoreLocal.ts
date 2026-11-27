/**
 * Restauración LOCAL y AISLADA de la copia de UNA empresa, sin registro.
 *
 * Diferencias con `restoreTenant` (que exige el registro de production y escribe en `backup_restores`):
 *  - No abre el registro ni el CRM: se niega a ejecutar si hay variables REGISTRY_*, CRM_*, PROVISIONING_*
 *    o DATABASE_URL definidas (preferible fallar a mezclar entornos por descuido).
 *  - Solo lee del almacenamiento de copias (envoltorio de solo lectura: cualquier escritura lanza).
 *  - El MySQL de destino debe ser local (localhost, 127.0.0.1, ::1) y la conexión real, de bucle local.
 *  - Reutiliza `restoreIntoNewDatabase` (firma HMAC, SHA-256, AAD `tenant:<empresa>`, base NUEVA,
 *    filas y CHECKSUM TABLE). Salida: solo contadores y veredicto, nunca filas ni secretos.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import mysql from "mysql2/promise";
import type { BackupStorage, StoredObject } from "./backupStorage";
import type { Keyring } from "./backupCrypto";
import { fetchVerifiedBackup, restoreIntoNewDatabase, RestoreError } from "./backupRestore";
import { safeError } from "./backupInventory";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const FORBIDDEN_HOST_SUFFIXES = [".railway.internal", ".rlwy.net", ".railway.app"];
/** Variables del entorno de production que, si existen, hacen fallar el script. */
const FORBIDDEN_ENV = /^(REGISTRY_|CRM_|PROVISIONING_)|^DATABASE_URL$/;
const TENANT_ID_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;
const MANIFEST_KEY_RE = /^tenants\/([a-z0-9][a-z0-9-]{0,62})\/\d{4}\/\d{2}\/[A-Za-z0-9._-]+\.manifest\.json$/;

/** Rechaza cualquier URL de MySQL que no sea de este equipo. Devuelve la URL analizada. */
export function assertLocalMysqlUrl(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new RestoreError("La URL del MySQL de destino no es válida");
  }
  if (u.protocol !== "mysql:") throw new RestoreError("La URL de destino debe empezar por mysql://");
  const host = u.hostname.toLowerCase();
  if (FORBIDDEN_HOST_SUFFIXES.some((s) => host.endsWith(s)) || host === "rlwy.net") {
    throw new RestoreError("Destino rechazado: es un host de Railway");
  }
  if (!LOCAL_HOSTS.has(host)) throw new RestoreError("Destino rechazado: solo se admite localhost, 127.0.0.1 o ::1");
  // Parámetros que pueden redirigir la conexión a otro sitio
  u.searchParams.forEach((_v, k) => {
    if (/^(host|socketpath|hostname|stream)$/i.test(k)) throw new RestoreError("Destino rechazado: parámetros de conexión no admitidos");
  });
  return u;
}

/** Falla si el entorno contiene variables propias de production (nunca las abre ni las imprime). */
export function assertIsolatedEnv(env: NodeJS.ProcessEnv): void {
  const bad = Object.keys(env).filter((k) => FORBIDDEN_ENV.test(k) && env[k]);
  if (bad.length) {
    throw new RestoreError(`Entorno no aislado: hay variables de production definidas (${bad.sort().join(", ")}). Ejecuta el script en una sesión sin ellas.`);
  }
}

/** Almacenamiento de solo lectura: cualquier escritura lanza. */
export function readOnlyStorage(inner: BackupStorage): BackupStorage {
  const deny = (): never => {
    throw new RestoreError("Almacenamiento de copias de solo lectura: este script nunca escribe en él");
  };
  return {
    kind: inner.kind,
    describe: () => inner.describe(),
    putFile: deny,
    putBuffer: deny,
    delete: deny,
    getFile: (k, d) => inner.getFile(k, d),
    getBuffer: (k) => inner.getBuffer(k),
    hash: (k) => inner.hash(k),
    list: (p) => inner.list(p),
  };
}

export function assertTenantId(id: string): string {
  if (!TENANT_ID_RE.test(id)) throw new RestoreError("Identificador de empresa no válido");
  return id;
}

/** Empresa a la que pertenece una clave de manifiesto `tenants/<empresa>/AAAA/MM/…manifest.json`. */
export function tenantOfManifestKey(key: string): string {
  const m = MANIFEST_KEY_RE.exec(key);
  if (!m) throw new RestoreError("La clave del manifiesto debe ser tenants/<empresa>/AAAA/MM/….manifest.json");
  return m[1];
}

/** Lista los manifiestos de una empresa (más reciente primero). Solo lectura. */
export async function listTenantCopies(storage: BackupStorage, tenantId: string): Promise<StoredObject[]> {
  assertTenantId(tenantId);
  const all = await storage.list(`tenants/${tenantId}/`);
  return all.filter((o) => o.key.endsWith(".manifest.json")).sort((a, b) => b.key.localeCompare(a.key));
}

export interface LocalRestoreReport {
  simulacion: boolean;
  empresa: string;
  manifiesto: string;
  copia: { creada: string; clave: string; tablas: number; filas: number; triggers: number; firmaYSha256: "ok" };
  destino: { host: string; baseNueva: string };
  aislamiento: { hostLocal: true; conexionBucleLocal: boolean | null; variablesProductionAusentes: true; almacenamientoSoloLectura: true };
  verificacion?: { ok: boolean; tablas: number; filas: number; problemas: string[] };
}

/**
 * Simulación (`apply` falso): firma, SHA-256 y descifrado, sin tocar MySQL.
 * Con `apply`: crea la base NUEVA en el MySQL local y la verifica.
 */
export async function restoreTenantLocal(
  d: { storage: BackupStorage; ring: Keyring; env: NodeJS.ProcessEnv; tmpDir?: string },
  input: { manifestKey: string; adminUrl: string; database: string; apply: boolean },
): Promise<LocalRestoreReport> {
  assertIsolatedEnv(d.env);
  const url = assertLocalMysqlUrl(input.adminUrl);
  const tenantId = tenantOfManifestKey(input.manifestKey);
  const storage = readOnlyStorage(d.storage);
  const base = { empresa: tenantId, manifiesto: input.manifestKey, destino: { host: url.hostname, baseNueva: input.database } };
  const isolation = { hostLocal: true as const, variablesProductionAusentes: true as const, almacenamientoSoloLectura: true as const };
  const summary = (m: { createdAt: string; keyId: string; tables: Record<string, { rows: number }>; triggers: string[] }) => {
    const tables = Object.values(m.tables);
    return { creada: m.createdAt, clave: m.keyId, tablas: tables.length, filas: tables.reduce((n, t) => n + t.rows, 0), triggers: m.triggers.length, firmaYSha256: "ok" as const };
  };

  if (!input.apply) {
    // Simulación: verifica firma, SHA-256 y descifrado en un directorio temporal que se borra
    const work = fs.mkdtempSync(path.join(d.tmpDir ?? os.tmpdir(), "es-rl-"));
    try {
      const { manifest } = await fetchVerifiedBackup({ storage, ring: d.ring }, input.manifestKey, work);
      if (manifest.target.kind !== "tenant" || manifest.target.id !== tenantId) throw new RestoreError("La copia no es de la empresa indicada en la clave");
      return { simulacion: true, ...base, copia: summary(manifest), aislamiento: { ...isolation, conexionBucleLocal: null } };
    } finally {
      fs.rmSync(work, { recursive: true, force: true });
    }
  }

  // Comprobación real de la conexión: dirección remota de bucle local
  let loopback = false;
  const probe = await mysql.createConnection({ uri: input.adminUrl });
  try {
    const addr = (probe as unknown as { connection?: { stream?: { remoteAddress?: string } } }).connection?.stream?.remoteAddress ?? "";
    loopback = addr === "127.0.0.1" || addr === "::1" || addr === "::ffff:127.0.0.1";
  } finally {
    await probe.end().catch(() => undefined);
  }
  if (!loopback) throw new RestoreError("La conexión al MySQL de destino no es de bucle local: se aborta");

  try {
    const { manifest, verification } = await restoreIntoNewDatabase(
      { storage, ring: d.ring },
      { manifestKey: input.manifestKey, adminUrl: input.adminUrl, database: input.database, expectTarget: { kind: "tenant", id: tenantId }, tmpDir: d.tmpDir },
    );
    return {
      simulacion: false,
      ...base,
      copia: summary(manifest),
      aislamiento: { ...isolation, conexionBucleLocal: true },
      verificacion: { ok: verification.ok, tablas: verification.tables, filas: verification.rows, problemas: verification.problems },
    };
  } catch (e) {
    if (e instanceof RestoreError) throw e;
    throw new RestoreError(safeError(e));
  }
}
