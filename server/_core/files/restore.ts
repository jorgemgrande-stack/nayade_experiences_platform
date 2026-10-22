/**
 * Restauración INDIVIDUAL de un fichero desde la réplica cifrada de ficheros de la empresa
 * (server/_core/ops/backupJob.ts → `backupTenantFiles`, BACKUP_MEDIA=1).
 *
 * El formato de copias no cambia: la réplica copia todo `t/<empresa>/…`, y el servicio guarda junto a cada
 * objeto su ficha de metadatos (`t/<empresa>/o/_meta/<id>.json`). Con ambas se recupera el contenido
 * Y su fila de `stored_objects` sin restaurar la base de datos entera:
 *  1. Se localizan en el índice de la réplica la ficha y el objeto; se descifran (AAD por empresa y
 *     clave) y se comprueba el SHA-256 del índice y el de la ficha.
 *  2. Por defecto es una SIMULACIÓN: informa de lo que haría. Con `apply`, sube el objeto a su clave
 *     original, vuelve a escribir la ficha y deja la fila `active`.
 */
import crypto from "node:crypto";
import { backupAad, readFilesIndex } from "../ops/backupJob";
import { decryptBuffer, type Keyring } from "../ops/backupCrypto";
import type { BackupStorage } from "../ops/backupStorage";
import { tenantStoragePrefix } from "../tenantStorage";
import type { ObjectBackend } from "./backend";
import type { ObjectMetaStore, StoredObjectRow } from "../../storedObjectsDb";
import { OBJECT_ID_RE } from "./service";

const sha256 = (b: Buffer) => crypto.createHash("sha256").update(b).digest("hex");

export interface RestoreObjectDeps {
  storage: BackupStorage;
  ring: Keyring;
  tenantId: string;
  backend: ObjectBackend;
  meta: ObjectMetaStore;
  now?: () => number;
}

export interface RestoreObjectResult {
  objectId: string;
  storageKey: string;
  bytes: number;
  contentType: string;
  applied: boolean;
}

async function readEntry(d: RestoreObjectDeps, index: NonNullable<Awaited<ReturnType<typeof readFilesIndex>>>, key: string): Promise<Buffer> {
  const e = index.entries[key];
  if (!e) throw new Error(`La réplica no contiene ${key}`);
  const enc = await d.storage.getBuffer(e.object);
  if (!enc) throw new Error(`Falta en la réplica el objeto de ${key}`);
  const plain = decryptBuffer(enc, d.ring, backupAad("files", `${d.tenantId}:${key}`));
  if (sha256(plain) !== e.sha256) throw new Error(`SHA-256 distinto en ${key}`);
  return plain;
}

export async function restoreStoredObject(d: RestoreObjectDeps, objectId: string, o: { apply?: boolean } = {}): Promise<RestoreObjectResult> {
  if (!OBJECT_ID_RE.test(objectId)) throw new Error("Identificador de fichero no válido");
  const index = await readFilesIndex(d.storage, d.ring, d.tenantId);
  if (!index) throw new Error("No hay réplica de ficheros para esa empresa");
  const root = `${tenantStoragePrefix(d.tenantId)}o/`;
  const metaKey = `${root}_meta/${objectId}.json`;
  const row = JSON.parse((await readEntry(d, index, metaKey)).toString("utf8")) as StoredObjectRow;
  if (row.objectId !== objectId || typeof row.storageKey !== "string" || !row.storageKey.startsWith(root) || row.storageKey.includes("..")) {
    throw new Error("La ficha de metadatos no corresponde a esa empresa u objeto");
  }
  const data = await readEntry(d, index, row.storageKey);
  if (sha256(data) !== row.sha256 || data.length !== Number(row.sizeBytes)) throw new Error("El contenido no coincide con su ficha (SHA-256 o tamaño)");
  const result = { objectId, storageKey: row.storageKey, bytes: data.length, contentType: row.contentType, applied: false };
  if (!o.apply) return result;
  const at = (d.now ?? Date.now)();
  await d.backend.put(row.storageKey, data, row.contentType, { sha256: row.sha256, "object-id": objectId });
  const back = await d.backend.get(row.storageKey);
  if (!back || sha256(back) !== row.sha256) throw new Error("Comprobación de integridad fallida tras restaurar");
  const restored: StoredObjectRow = { ...row, status: "active", deletedAt: null, bytesRemovedAt: null, replacedBy: null, error: null, updatedAt: at };
  await d.backend.put(metaKey, Buffer.from(JSON.stringify(restored)), "application/json");
  await d.meta.upsert(restored);
  return { ...result, applied: true };
}
