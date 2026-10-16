/**
 * Restauración de copias del trabajo programado.
 *
 * Reglas:
 *  - Siempre en una base NUEVA (CREATE DATABASE sin IF NOT EXISTS: si el nombre existe, falla). Nunca
 *    se toca la base original ni las de otras empresas.
 *  - Antes de restaurar: firma del manifiesto (HMAC) y SHA-256 del objeto almacenado. Después: SHA-256
 *    del volcado, filas, CHECKSUM TABLE y triggers contra el manifiesto.
 *  - Solo con confirmación explícita (`switch`) se apunta el registro de ESA empresa a la base
 *    restaurada: se registra el DSN nuevo (cifrado) y se activa, lo que retira la anterior (sin
 *    borrarla) e incrementa la versión del registro (invalida las cachés del Core).
 *  - El registro y el CRM se restauran en una base nueva y NUNCA se conmutan aquí: el cambio es de
 *    configuración (variable de entorno del servicio), con el servicio detenido. Ver el runbook.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import mysql from "mysql2/promise";
import { compareWithManifest, restoreBackup, type VerificationReport } from "./backup";
import { decryptFile, verifyManifest, type Keyring } from "./backupCrypto";
import type { BackupInventory, BackupRecord, BackupTargetKind } from "./backupInventory";
import type { BackupStorage } from "./backupStorage";
import { backupAad, type SignedBackupManifest } from "./backupJob";
import type { TenantRegistryService, Actor } from "../tenantRegistry/service";
import type { TenantRegistryReader } from "../tenantRegistry/store";
import { databaseNameFor } from "../provisioning/mysqlAdapters";
import type { DatabaseServers } from "../provisioning/servers";

export class RestoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RestoreError";
  }
}

const DB_RE = /^[a-z][a-z0-9_]{1,63}$/;

/** Descarga el manifiesto, comprueba su firma y la del objeto, y descifra el volcado en `workDir`. */
export async function fetchVerifiedBackup(
  d: { storage: BackupStorage; ring: Keyring },
  manifestKey: string,
  workDir: string,
): Promise<{ manifest: SignedBackupManifest; sqlGz: string }> {
  const buf = await d.storage.getBuffer(manifestKey);
  if (!buf) throw new RestoreError("El manifiesto no existe en el almacenamiento");
  let parsed: SignedBackupManifest;
  try {
    parsed = JSON.parse(buf.toString("utf8")) as SignedBackupManifest;
  } catch {
    throw new RestoreError("Manifiesto ilegible");
  }
  const manifest = verifyManifest(parsed, d.ring);
  if (manifest.format !== "elephant-backup" || manifest.version !== 2) throw new RestoreError("Formato de manifiesto no admitido");
  const enc = path.join(workDir, "copy.sql.gz.enc");
  await d.storage.getFile(manifest.object.key, enc);
  const h = crypto.createHash("sha256");
  for await (const c of fs.createReadStream(enc) as AsyncIterable<Buffer>) h.update(c);
  if (h.digest("hex") !== manifest.object.sha256) throw new RestoreError("El objeto almacenado no coincide con el manifiesto (SHA-256)");
  const sqlGz = path.join(workDir, "copy.sql.gz");
  await decryptFile(enc, sqlGz, d.ring, backupAad(manifest.target.kind, manifest.target.id));
  fs.rmSync(enc, { force: true });
  return { manifest, sqlGz };
}

function dsnWithDatabase(url: string, db: string): string {
  const u = new URL(url);
  u.pathname = `/${db}`;
  return u.toString();
}

export interface RestoreReport {
  target: { kind: BackupTargetKind; id: string };
  backup: { manifestKey: string; createdAt: string; keyId: string; inventoryId: number | null };
  serverAlias: string | null;
  database: string;
  verification: VerificationReport;
  switched: boolean;
  registryVersion?: number;
  databaseRef?: number;
}

/**
 * Restaura en una base NUEVA `database` del servidor de `adminUrl` y verifica. No conmuta nada.
 * `definer`: dueño de los triggers restaurados.
 */
export async function restoreIntoNewDatabase(
  d: { storage: BackupStorage; ring: Keyring },
  input: { manifestKey: string; adminUrl: string; database: string; definer?: { user: string; host: string }; expectTarget?: { kind: BackupTargetKind; id: string }; tmpDir?: string },
): Promise<{ manifest: SignedBackupManifest; verification: VerificationReport }> {
  if (!DB_RE.test(input.database)) throw new RestoreError("Nombre de base de datos no válido");
  const work = fs.mkdtempSync(path.join(input.tmpDir ?? os.tmpdir(), "es-rs-"));
  const admin = await mysql.createConnection({ uri: input.adminUrl });
  try {
    const { manifest, sqlGz } = await fetchVerifiedBackup(d, input.manifestKey, work);
    if (input.expectTarget && (manifest.target.kind !== input.expectTarget.kind || manifest.target.id !== input.expectTarget.id)) {
      throw new RestoreError(`La copia es de ${manifest.target.kind}:${manifest.target.id}, no de ${input.expectTarget.kind}:${input.expectTarget.id}`);
    }
    // Base NUEVA: si existe, error (nunca se sobrescribe)
    try {
      await admin.query(`CREATE DATABASE \`${input.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    } catch (e: unknown) {
      if ((e as { code?: string })?.code === "ER_DB_CREATE_EXISTS") throw new RestoreError(`La base ${input.database} ya existe: la restauración solo se hace en una base nueva`);
      throw e;
    }
    const target = dsnWithDatabase(input.adminUrl, input.database);
    const r = await restoreBackup(target, sqlGz, { definer: input.definer });
    const cmp = await compareWithManifest(target, manifest);
    const problems = r.sha256 !== manifest.dump.sha256 ? ["El SHA-256 del volcado no coincide con el manifiesto", ...cmp.problems] : cmp.problems;
    return { manifest, verification: { ...cmp, ok: problems.length === 0, problems } };
  } finally {
    await admin.end().catch(() => undefined);
    fs.rmSync(work, { recursive: true, force: true });
  }
}

/** Nombre de la base restaurada de una empresa: `es_<empresa>_r<AAAAMMDDhhmmss>`. */
export function restoredDatabaseName(tenantId: string, at: number): string {
  const stamp = new Date(at).toISOString().replace(/[-:T]/g, "").slice(0, 14);
  const name = `${databaseNameFor(tenantId)}_r${stamp}`;
  if (!DB_RE.test(name)) throw new RestoreError("Nombre de base restaurada no válido (identificador de empresa demasiado largo)");
  return name;
}

/** Usuario propio de una base restaurada (≤ 32 caracteres, determinista por base). */
export const restoredUserFor = (database: string) => `esr_${crypto.createHash("sha256").update(database).digest("hex").slice(0, 16)}`;

async function pickBackup(inventory: BackupInventory, kind: BackupTargetKind, id: string, backupId?: number): Promise<BackupRecord> {
  const rec = backupId ? await inventory.get(backupId) : (await inventory.list({ targetKind: kind, targetId: id, status: "ok", limit: 1 }))[0];
  if (!rec) throw new RestoreError("No hay copia correcta en el inventario");
  if (rec.targetKind !== kind || rec.targetId !== id) throw new RestoreError("Esa copia no pertenece a este destino");
  if (rec.status !== "ok" || !rec.manifestKey) throw new RestoreError(`La copia ${rec.id} no es válida (estado ${rec.status})`);
  return rec;
}

export interface TenantRestoreDeps {
  storage: BackupStorage;
  ring: Keyring;
  inventory: BackupInventory;
  servers: DatabaseServers;
  registry: Pick<TenantRegistryService, "registerDatabase" | "activateDatabase">;
  reader: Pick<TenantRegistryReader, "getTenant" | "getActiveDatabase">;
  now?: () => number;
  tmpDir?: string;
}

/**
 * Restaura una empresa en una base NUEVA (en su servidor actual o en `serverAlias`), con un usuario
 * propio, y la verifica. Con `switch: true` y verificación correcta, apunta el registro a ella.
 */
export async function restoreTenant(
  d: TenantRestoreDeps,
  input: { tenantId: string; backupId?: number; serverAlias?: string; switch?: boolean; actor: Actor },
): Promise<RestoreReport> {
  const now = d.now ?? Date.now;
  const tenant = await d.reader.getTenant(input.tenantId);
  if (!tenant) throw new RestoreError("Empresa no encontrada en el registro");
  const rec = await pickBackup(d.inventory, "tenant", input.tenantId, input.backupId);
  const alias = input.serverAlias ?? (await d.reader.getActiveDatabase(input.tenantId))?.serverAlias ?? rec.serverAlias;
  if (!alias) throw new RestoreError("No se sabe en qué servidor restaurar: indica el servidor");
  const server = d.servers.server(alias);
  const adminUrl = d.servers.adminUrl(alias);

  const database = restoredDatabaseName(input.tenantId, now());
  const user = restoredUserFor(database);
  const host = "%";
  const password = crypto.randomBytes(24).toString("base64url");
  const admin = d.servers.admin(alias);
  await admin.query("CREATE USER IF NOT EXISTS ?@? IDENTIFIED BY ?", [user, host, password]);
  await admin.query("ALTER USER ?@? IDENTIFIED BY ?", [user, host, password]);
  // Permiso solo sobre la base restaurada (MySQL admite conceder sobre una base aún inexistente)
  await admin.query(`GRANT ALL PRIVILEGES ON \`${database}\`.* TO ?@?`, [user, host]);
  const { manifest, verification } = await restoreIntoNewDatabase(
    { storage: d.storage, ring: d.ring },
    { manifestKey: rec.manifestKey!, adminUrl, database, definer: { user, host }, expectTarget: { kind: "tenant", id: input.tenantId }, tmpDir: d.tmpDir },
  );

  const report: RestoreReport = {
    target: { kind: "tenant", id: input.tenantId },
    backup: { manifestKey: rec.manifestKey!, createdAt: manifest.createdAt, keyId: manifest.keyId, inventoryId: rec.id },
    serverAlias: alias,
    database,
    verification,
    switched: false,
  };
  if (!input.switch) return report;
  if (!verification.ok) throw new RestoreError(`Verificación fallida: no se conmuta (${verification.problems.slice(0, 3).join("; ")})`);

  const dsn = `mysql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${server.host}:${server.port}/${database}`;
  // El usuario propio debe poder conectar antes de apuntar el registro a la base
  const probe = await mysql.createConnection({ uri: dsn });
  try {
    await probe.query("SELECT 1");
  } finally {
    await probe.end().catch(() => undefined);
  }
  const ref = await d.registry.registerDatabase(input.tenantId, dsn, input.actor, { serverAlias: alias });
  const active = await d.registry.activateDatabase(input.tenantId, ref.id, input.actor);
  const after = await d.reader.getTenant(input.tenantId);
  return { ...report, switched: true, databaseRef: active.id, registryVersion: after?.registryVersion };
}

/** Restaura el registro o el CRM en una base NUEVA del servidor indicado y la verifica (sin conmutar). */
export async function restorePlatformDatabase(
  d: { storage: BackupStorage; ring: Keyring; inventory?: BackupInventory },
  input: { kind: "registry" | "crm"; manifestKey?: string; backupId?: number; adminUrl: string; database: string; tmpDir?: string },
): Promise<RestoreReport> {
  let manifestKey = input.manifestKey;
  let inventoryId: number | null = null;
  if (!manifestKey) {
    if (!d.inventory) throw new RestoreError("Indica el manifiesto (sin inventario disponible)");
    const rec = await pickBackup(d.inventory, input.kind, input.kind, input.backupId);
    manifestKey = rec.manifestKey!;
    inventoryId = rec.id;
  }
  const { manifest, verification } = await restoreIntoNewDatabase(
    { storage: d.storage, ring: d.ring },
    { manifestKey, adminUrl: input.adminUrl, database: input.database, expectTarget: { kind: input.kind, id: input.kind }, tmpDir: input.tmpDir },
  );
  return {
    target: { kind: input.kind, id: input.kind },
    backup: { manifestKey, createdAt: manifest.createdAt, keyId: manifest.keyId, inventoryId },
    serverAlias: null,
    database: input.database,
    verification,
    switched: false,
  };
}
