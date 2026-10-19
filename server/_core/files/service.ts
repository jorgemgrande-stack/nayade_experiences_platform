/**
 * Servicio de almacenamiento centralizado: TODA escritura persistente de ficheros pasa por aquí.
 *
 * Subida (`put`):
 *  1. Tipo detectado por contenido y permitido por la categoría; tamaño máximo (categoría y
 *     STORAGE_MAX_BYTES); SVG público solo si es seguro.
 *  2. Clave generada por el servidor (nunca con nombres del cliente): en multiempresa
 *     `t/<empresa>/o/<categoría>/<aaaa>/<mm>/<id>.<ext>`; en instalación única `o/…`.
 *  3. Fila `pending` → subida con reintentos → relectura y comprobación de SHA-256 y tamaño →
 *     fila `active` + ficha de metadatos junto al objeto (`…/o/_meta/<id>.json`, para restaurar
 *     ficheros sueltos desde las copias). Si algo falla, la fila queda `failed`, se intenta borrar lo
 *     subido y se lanza `StorageUnavailableError`: nunca queda un objeto «activo» a medias.
 *  4. Sustitución (`replaces`): el anterior pasa a `replaced` solo DESPUÉS de confirmar el nuevo; su
 *     contenido se conserva hasta la limpieza (periodo de gracia).
 *
 * Entrega: públicos por `/files/<id>/<nombre>`; privados por `/api/files/<id>` (sesión + permiso) o con
 * un enlace firmado del Core con caducidad (`signedLink`). Ver server/fileRoutes.ts.
 */
import crypto from "node:crypto";
import { getLimitAccess } from "../limits/access";
import { backendFromEnv, StorageUnavailableError, type ObjectBackend } from "./backend";
import { detectContentType, extensionFor, isSafeSvg, safeDisplayName } from "./contentType";
import { policyOf, type FileCategory, type Visibility } from "./categories";
import { MysqlObjectMetaStore, type ObjectMetaStore, type StoredObjectRow } from "../../storedObjectsDb";
import { getTenantId, getTenantMode, peekTenantContext } from "../tenant";
import { tenantStoragePrefix } from "../tenantStorage";
import { sessionSecret } from "../sessionSecret";
import { getTrustedBaseUrl } from "../publicUrl";
import { secureEqual } from "../signedLinks";

export { StorageUnavailableError };

const GB = 1024 ** 3;

export class FileValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FileValidationError";
  }
}

export interface PutInput {
  category: FileCategory;
  data: Buffer | Uint8Array | string;
  /** Tipo que declara el llamador (solo orienta variantes de texto/OLE; manda el contenido). */
  declaredType?: string | null;
  originalName?: string | null;
  owner?: { type: string; id: string | number } | null;
  uploadedBy?: number | null;
  /** id del objeto al que sustituye. */
  replaces?: string | null;
}

export interface PutResult {
  objectId: string;
  key: string;
  url: string;
  visibility: Visibility;
  contentType: string;
  sizeBytes: number;
  sha256: string;
}

export interface FileServiceDeps {
  backend?: () => ObjectBackend;
  meta?: ObjectMetaStore;
  now?: () => number;
  /** Reintentos de subida ante fallos transitorios del proveedor. */
  attempts?: number;
  retryDelayMs?: number;
}

const ID_ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";
export const OBJECT_ID_RE = /^[0-9a-hjkmnp-tv-z]{26}$/;

export function newObjectId(): string {
  // 26 caracteres de 5 bits (130 bits aleatorios; 256 es múltiplo de 32: sin sesgo)
  return Array.from(crypto.randomBytes(26), (b) => ID_ALPHABET[b & 31]).join("");
}

const sha256 = (b: Buffer) => crypto.createHash("sha256").update(b).digest("hex");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Raíz de las claves del servicio para la empresa en curso. */
export function objectRoot(): string {
  return getTenantMode() === "multi" ? `${tenantStoragePrefix(getTenantId())}o/` : "o/";
}

export function maxBytesFromEnv(): number {
  const n = Number(process.env.STORAGE_MAX_BYTES);
  return Number.isFinite(n) && n > 0 ? n : 25 * 1024 * 1024;
}

/** ¿Usa el Core el servicio de objetos? Por defecto sí en multiempresa y no en instalación única. */
export function objectStorageEnabled(): boolean {
  const v = (process.env.STORAGE_OBJECTS ?? "").trim().toLowerCase();
  if (v === "on" || v === "1" || v === "true") return true;
  if (v === "off" || v === "0" || v === "false") return false;
  return getTenantMode() === "multi";
}

function trustedBase(): string {
  try {
    return getTrustedBaseUrl();
  } catch {
    return "";
  }
}

// ── Enlaces firmados del Core ───────────────────────────────────────────────

function linkPurpose(objectId: string, exp: number): string {
  const t = getTenantMode() === "multi" ? peekTenantContext()?.tenantId ?? "" : "single";
  return `stored-file:${t}:${objectId}:${exp}`;
}

function signValue(v: string): string {
  const key = sessionSecret();
  if (!key) return "";
  return crypto.createHmac("sha256", key).update(v).digest("hex").slice(0, 40);
}

export function linkTtlSeconds(): number {
  const n = Number(process.env.STORAGE_LINK_TTL_SECONDS);
  return Number.isFinite(n) && n > 0 ? n : 7 * 24 * 3600;
}

/** Enlace firmado y con caducidad a un objeto de la empresa en curso (p. ej. para un correo). */
export function signedLink(objectId: string, ttlSeconds = linkTtlSeconds(), now = Date.now()): string {
  const exp = Math.floor(now / 1000) + ttlSeconds;
  return `${trustedBase()}/api/files/${objectId}?exp=${exp}&sig=${signValue(linkPurpose(objectId, exp))}`;
}

export type LinkCheck = "valid" | "expired" | "invalid";

export function verifySignedLink(objectId: string, exp: unknown, sig: unknown, now = Date.now()): LinkCheck {
  const e = Number(exp);
  if (!Number.isInteger(e) || typeof sig !== "string" || !sig) return "invalid";
  const expected = signValue(linkPurpose(objectId, e));
  if (!expected || !secureEqual(sig, expected)) return "invalid";
  return e * 1000 < now ? "expired" : "valid";
}

// ── URL del Core ────────────────────────────────────────────────────────────

const OWN_URL_RE = /^(?:https?:\/\/[^/]+)?\/(api\/files|files)\/([0-9a-z]{26})(?:[/?#]|$)/;

/** id de objeto si la URL es del servicio (`/files/<id>…` o `/api/files/<id>…`, relativa o absoluta). */
export function objectIdFromUrl(url: unknown): string | null {
  if (typeof url !== "string") return null;
  const m = OWN_URL_RE.exec(url.trim());
  return m && OBJECT_ID_RE.test(m[2]) ? m[2] : null;
}

/** ¿Es una URL http(s)/data: o una ruta de fichero del Core? (para validar entradas que guardan URL). */
export function isAcceptableFileUrl(url: unknown): boolean {
  if (typeof url !== "string") return false;
  if (objectIdFromUrl(url) && url.startsWith("/")) return true;
  try {
    const u = new URL(url);
    // data: se conserva: algunos formularios guardan el adjunto así si el almacenamiento falla
    return u.protocol === "https:" || u.protocol === "http:" || u.protocol === "data:";
  } catch {
    return false;
  }
}

export function urlForRow(row: Pick<StoredObjectRow, "objectId" | "visibility" | "originalName" | "category" | "contentType">): string {
  if (row.visibility === "public") {
    const name = safeDisplayName(row.originalName, `${row.category}.${extensionFor(row.contentType)}`).replace(/\s+/g, "-");
    return `${trustedBase()}/files/${row.objectId}/${encodeURIComponent(name)}`;
  }
  return `/api/files/${row.objectId}`;
}

// ── Servicio ────────────────────────────────────────────────────────────────

export class FileService {
  private backend: () => ObjectBackend;
  readonly meta: ObjectMetaStore;
  private now: () => number;
  private attempts: number;
  private retryDelayMs: number;

  constructor(d: FileServiceDeps = {}) {
    this.backend = d.backend ?? (() => backendFromEnv());
    this.meta = d.meta ?? new MysqlObjectMetaStore();
    this.now = d.now ?? Date.now;
    this.attempts = Math.max(1, d.attempts ?? 3);
    this.retryDelayMs = d.retryDelayMs ?? 250;
  }

  get storage(): ObjectBackend {
    return this.backend();
  }

  /** Valida el contenido para la categoría; devuelve el tipo detectado. */
  validate(category: FileCategory, data: Buffer, declared?: string | null): string {
    const policy = policyOf(category);
    if (!data.length) throw new FileValidationError("El fichero está vacío.");
    const max = Math.min(policy.maxBytes, maxBytesFromEnv());
    if (data.length > max) throw new FileValidationError(`El fichero supera el tamaño máximo permitido (${Math.floor(max / (1024 * 1024))} MB).`);
    const type = detectContentType(data, declared);
    if (!(policy.types as readonly string[]).includes(type)) {
      throw new FileValidationError("El contenido del fichero no corresponde a un tipo permitido.");
    }
    if (type === "image/svg+xml" && policy.visibility === "public" && !isSafeSvg(data)) {
      throw new FileValidationError("El SVG contiene elementos no permitidos (scripts, enlaces externos o eventos).");
    }
    return type;
  }

  private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    let last: unknown;
    for (let i = 0; i < this.attempts; i++) {
      try {
        return await fn();
      } catch (err) {
        last = err;
        if (!(err instanceof StorageUnavailableError)) throw err;
        if (i < this.attempts - 1) await sleep(this.retryDelayMs * 2 ** i);
      }
    }
    throw last;
  }

  async put(input: PutInput): Promise<PutResult> {
    const data = typeof input.data === "string" ? Buffer.from(input.data) : Buffer.from(input.data);
    const contentType = this.validate(input.category, data, input.declaredType);
    // Almacenamiento contratado (plan + ampliaciones, registro 0013): nunca por encima. Sin dato, como hasta ahora
    const limits = getLimitAccess();
    const limitGb = limits ? await limits.limit("storage_gb") : undefined;
    if (typeof limitGb === "number" && this.meta.usedBytes) {
      const usedBefore = await this.meta.usedBytes();
      limits!.report("storage_bytes", usedBefore);
      if (usedBefore + data.length > limitGb * GB) {
        throw new FileValidationError(`Has alcanzado el almacenamiento contratado (${limitGb} GB). Amplía el almacenamiento o libera espacio para subir más ficheros.`);
      }
    }
    const policy = policyOf(input.category);
    const backend = this.backend();
    const at = this.now();
    const d = new Date(at);
    const objectId = newObjectId();
    const key = `${objectRoot()}${input.category}/${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${objectId}.${extensionFor(contentType)}`;
    const hash = sha256(data);
    const row: StoredObjectRow = {
      objectId,
      storageKey: key,
      visibility: policy.visibility,
      category: input.category,
      contentType,
      sizeBytes: data.length,
      sha256: hash,
      originalName: input.originalName ? safeDisplayName(input.originalName) : null,
      ownerType: input.owner?.type ?? null,
      ownerId: input.owner ? String(input.owner.id).slice(0, 64) : null,
      uploadedBy: input.uploadedBy ?? null,
      status: "pending",
      replacesObjectId: input.replaces ?? null,
      replacedBy: null,
      error: null,
      createdAt: at,
      updatedAt: at,
      confirmedAt: null,
      deletedAt: null,
      bytesRemovedAt: null,
    };
    let previous: StoredObjectRow | null = null;
    if (input.replaces) {
      previous = await this.meta.get(input.replaces);
      if (!previous || previous.status !== "active") throw new FileValidationError("El fichero que se quiere sustituir no existe o ya no está activo.");
    }
    await this.meta.insert(row);
    const fail = async (reason: string, err: unknown): Promise<never> => {
      await backend.delete(key).catch(() => undefined);
      await this.meta.update(objectId, { status: "failed", error: reason, updatedAt: this.now() }).catch(() => undefined);
      console.error(JSON.stringify({ ctx: "Storage", event: "put_failed", category: input.category, reason }));
      throw err instanceof StorageUnavailableError ? err : new StorageUnavailableError();
    };
    try {
      await this.withRetry(() => backend.put(key, data, contentType, { sha256: hash, "object-id": objectId }));
    } catch (err) {
      return fail("upload", err);
    }
    // Integridad: lo que hay en el proveedor es exactamente lo subido
    let stored: Buffer | null;
    try {
      stored = await this.withRetry(() => backend.get(key));
    } catch (err) {
      return fail("verify_read", err);
    }
    if (!stored || stored.length !== data.length || sha256(stored) !== hash) return fail("verify_mismatch", null);
    const confirmed = this.now();
    await this.meta.update(objectId, { status: "active", confirmedAt: confirmed, updatedAt: confirmed });
    const active = { ...row, status: "active" as const, confirmedAt: confirmed, updatedAt: confirmed };
    await backend.put(this.sidecarKey(key, objectId), Buffer.from(JSON.stringify(active)), "application/json").catch(() => {
      console.warn(JSON.stringify({ ctx: "Storage", event: "sidecar_failed" }));
    });
    if (previous) await this.meta.update(previous.objectId, { status: "replaced", replacedBy: objectId, updatedAt: confirmed });
    return { objectId, key, url: urlForRow(row), visibility: row.visibility, contentType, sizeBytes: data.length, sha256: hash };
  }

  /** Ficha de metadatos del objeto (misma raíz que el objeto: viaja con las copias de la empresa). */
  sidecarKey(storageKey: string, objectId: string): string {
    // clave = <raíz>/<categoría>/<aaaa>/<mm>/<id>.<ext>  →  <raíz>/_meta/<id>.json
    const root = storageKey.split("/").slice(0, -4).join("/");
    return `${root}/_meta/${objectId}.json`;
  }

  /** Fila servible (activa o sustituida con contenido) de la empresa en curso. */
  async find(objectId: string): Promise<StoredObjectRow | null> {
    if (!OBJECT_ID_RE.test(objectId)) return null;
    const row = await this.meta.get(objectId);
    if (!row || !(row.status === "active" || row.status === "replaced") || row.bytesRemovedAt) return null;
    // Defensa en profundidad: la clave debe estar en el espacio de la empresa en curso
    if (!row.storageKey.startsWith(objectRoot())) return null;
    return row;
  }

  /** Contenido verificado (SHA-256) de un objeto servible. */
  async read(objectId: string): Promise<{ row: StoredObjectRow; data: Buffer } | null> {
    const row = await this.find(objectId);
    if (!row) return null;
    const data = await this.withRetry(() => this.backend().get(row.storageKey));
    if (!data) return null;
    if (sha256(data) !== row.sha256) {
      console.error(JSON.stringify({ ctx: "Storage", event: "integrity_mismatch", objectId }));
      throw new StorageUnavailableError("El fichero almacenado no supera la comprobación de integridad.");
    }
    return { row, data };
  }

  /** Lee un fichero propio a partir de su URL del Core (correo, ZIP…). `null` si no es nuestro o no existe. */
  async readByUrl(url: unknown): Promise<{ row: StoredObjectRow; data: Buffer } | null> {
    const id = objectIdFromUrl(url);
    return id ? this.read(id) : null;
  }

  /**
   * Borrado (la autorización la comprueba el llamador). La fila pasa a `deleted` antes de tocar el
   * bucket: si el proveedor falla, el fichero ya no se sirve y la limpieza lo retirará después.
   */
  async delete(objectId: string): Promise<boolean> {
    const row = await this.find(objectId);
    if (!row) return false;
    const at = this.now();
    await this.meta.update(objectId, { status: "deleted", deletedAt: at, updatedAt: at });
    try {
      await this.backend().delete(row.storageKey);
      await this.backend().delete(this.sidecarKey(row.storageKey, objectId));
      await this.meta.update(objectId, { bytesRemovedAt: this.now() });
    } catch {
      console.warn(JSON.stringify({ ctx: "Storage", event: "delete_deferred", objectId }));
    }
    return true;
  }

  /**
   * Limpieza (por defecto SIMULACIÓN: solo informa). Con `apply`:
   *  - filas `pending`/`failed` más antiguas que la gracia: se retira su contenido si quedó;
   *  - filas `replaced`/`deleted` con contenido aún presente: se retira;
   *  - objetos del bucket bajo la raíz del servicio sin fila (huérfanos): se borran.
   * Nunca toca claves fuera de la raíz del servicio (ficheros heredados).
   */
  async cleanup(o: { apply?: boolean; graceMs?: number } = {}) {
    const apply = !!o.apply;
    const before = this.now() - (o.graceMs ?? 24 * 3600 * 1000);
    const backend = this.backend();
    const report = { apply, staleUploads: [] as string[], superseded: [] as string[], bucketOrphans: [] as string[], errors: 0 };
    for (const r of await this.meta.listStale(["pending", "failed"], before)) {
      report.staleUploads.push(r.objectId);
      if (!apply) continue;
      try {
        await backend.delete(r.storageKey);
        await this.meta.update(r.objectId, { status: "failed", bytesRemovedAt: this.now(), updatedAt: this.now() });
      } catch {
        report.errors++;
      }
    }
    for (const r of await this.meta.listStale(["replaced", "deleted"], before)) {
      report.superseded.push(r.objectId);
      if (!apply) continue;
      try {
        await backend.delete(r.storageKey);
        await backend.delete(this.sidecarKey(r.storageKey, r.objectId));
        await this.meta.update(r.objectId, { bytesRemovedAt: this.now() });
      } catch {
        report.errors++;
      }
    }
    const root = objectRoot();
    const listed = (await backend.list(root)).filter((x) => (x.lastModified ?? 0) < before);
    const data = listed.filter((x) => !x.key.startsWith(`${root}_meta/`));
    const known = await this.meta.knownKeys(data.map((x) => x.key));
    for (const x of data) {
      if (known.has(x.key)) continue;
      report.bucketOrphans.push(x.key);
      if (apply) await backend.delete(x.key).catch(() => report.errors++);
    }
    // Fichas de metadatos sin objeto
    const ids = new Set(data.map((x) => x.key.split("/").pop()!.split(".")[0]));
    for (const x of listed.filter((y) => y.key.startsWith(`${root}_meta/`))) {
      const id = x.key.split("/").pop()!.replace(/\.json$/, "");
      if (ids.has(id)) continue;
      const row = await this.meta.get(id);
      if (row && (row.status === "active" || row.status === "replaced")) continue;
      report.bucketOrphans.push(x.key);
      if (apply) await backend.delete(x.key).catch(() => report.errors++);
    }
    return report;
  }
}

let defaultService: FileService | null = null;

export function fileService(): FileService {
  return (defaultService ??= new FileService());
}

/** Solo pruebas. */
export function setFileServiceForTests(s: FileService | null): void {
  defaultService = s;
}
