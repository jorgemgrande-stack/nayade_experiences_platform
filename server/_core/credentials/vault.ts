/**
 * Bóveda de credenciales de integraciones por tenant.
 *
 *  - Cifrado AES-256-GCM con la clave activa (`INTEGRATION_KEYS`, `id:base64[,id:base64]`,
 *    `INTEGRATION_ACTIVE_KEY_ID`). AAD = `tenant|proveedor|campo`: un valor no puede copiarse
 *    a otro campo ni a otro tenant.
 *  - Los secretos nunca se devuelven en claro por la API (solo máscara con últimos 4).
 *  - Sin claves configuradas no se pueden guardar secretos (falla cerrado).
 */
import crypto from "node:crypto";
import { getProvider, validateFields, type CredentialField } from "./catalog";

export interface Keyring {
  keys: Map<string, Buffer>;
  activeId: string;
}

export function keyringFromEnv(env: NodeJS.ProcessEnv = process.env): Keyring | null {
  const raw = env.INTEGRATION_KEYS;
  const active = env.INTEGRATION_ACTIVE_KEY_ID;
  if (!raw || !active) return null;
  const keys = new Map<string, Buffer>();
  for (const part of raw.split(",")) {
    const i = part.indexOf(":");
    if (i < 1) continue;
    const buf = Buffer.from(part.slice(i + 1).trim(), "base64");
    if (buf.length === 32) keys.set(part.slice(0, i).trim(), buf);
  }
  return keys.has(active) ? { keys, activeId: active } : null;
}

const aad = (tenantId: string, provider: string, field: string) => Buffer.from(`${tenantId}|${provider}|${field}`);

export function encryptValue(plain: string, tenantId: string, provider: string, field: string, ring: Keyring) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", ring.keys.get(ring.activeId)!, iv);
  c.setAAD(aad(tenantId, provider, field));
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return { cipher: Buffer.concat([iv, c.getAuthTag(), ct]).toString("base64"), keyId: ring.activeId };
}

export function decryptValue(cipherB64: string, keyId: string, tenantId: string, provider: string, field: string, ring: Keyring): string {
  const key = ring.keys.get(keyId);
  if (!key) throw new Error("Clave de credenciales no disponible");
  const raw = Buffer.from(cipherB64, "base64");
  const d = crypto.createDecipheriv("aes-256-gcm", key, raw.subarray(0, 12));
  d.setAAD(aad(tenantId, provider, field));
  d.setAuthTag(raw.subarray(12, 28));
  try {
    return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString("utf8");
  } catch {
    throw new Error("No se pudo descifrar la credencial");
  }
}

export interface StoredCredential {
  provider: string;
  field: string;
  secret: boolean;
  /** Texto plano para campos no secretos; cifrado (base64) para secretos. */
  value: string;
  keyId: string | null;
  updatedAt: Date;
}

export interface CredentialStore {
  list(provider?: string): Promise<StoredCredential[]>;
  upsert(c: Omit<StoredCredential, "updatedAt">, updatedBy: string): Promise<void>;
  remove(provider: string, field: string): Promise<void>;
}

export class MemoryCredentialStore implements CredentialStore {
  rows = new Map<string, StoredCredential>();
  async list(provider?: string) {
    return Array.from(this.rows.values()).filter((r) => !provider || r.provider === provider);
  }
  async upsert(c: Omit<StoredCredential, "updatedAt">) {
    this.rows.set(`${c.provider}.${c.field}`, { ...c, updatedAt: new Date() });
  }
  async remove(provider: string, field: string) {
    this.rows.delete(`${provider}.${field}`);
  }
}

export function mask(v: string): string {
  return v.length <= 4 ? "••••" : "••••" + v.slice(-4);
}

export interface ProviderStatus {
  id: string;
  name: string;
  description: string;
  configured: boolean;
  fields: Array<{
    key: string;
    label: string;
    secret: boolean;
    required: boolean;
    options?: string[];
    hint?: string;
    set: boolean;
    /** Valor visible (no secretos) o máscara (secretos). */
    display: string | null;
    updatedAt: string | null;
  }>;
}

export class IntegrationVault {
  constructor(
    private store: CredentialStore,
    private tenantId: () => string,
    private ring: () => Keyring | null,
  ) {}

  async status(providerIds?: string[]): Promise<ProviderStatus[]> {
    const { PROVIDERS } = await import("./catalog");
    const all = await this.store.list();
    const out: ProviderStatus[] = [];
    for (const p of PROVIDERS) {
      if (providerIds && !providerIds.includes(p.id)) continue;
      const fields = p.fields.map((f) => {
        const row = all.find((r) => r.provider === p.id && r.field === f.key);
        let display: string | null = null;
        if (row) {
          if (!f.secret) display = row.value;
          else {
            try {
              display = mask(this.reveal(row));
            } catch {
              display = "••••";
            }
          }
        }
        return {
          key: f.key,
          label: f.label,
          secret: f.secret,
          required: !!f.required,
          options: f.options,
          hint: f.hint,
          set: !!row,
          display,
          updatedAt: row ? row.updatedAt.toISOString() : null,
        };
      });
      out.push({ id: p.id, name: p.name, description: p.description, configured: fields.some((f) => f.set), fields });
    }
    return out;
  }

  private reveal(row: StoredCredential): string {
    if (!row.secret) return row.value;
    const ring = this.ring();
    if (!ring || !row.keyId) throw new Error("Sin claves de credenciales");
    return decryptValue(row.value, row.keyId, this.tenantId(), row.provider, row.field, ring);
  }

  /** Valores en claro de un proveedor (uso interno de los adaptadores; jamás hacia el cliente). */
  async resolve(provider: string): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    for (const row of await this.store.list(provider)) {
      try {
        out[row.field] = this.reveal(row);
      } catch {
        /* campo ilegible: se omite */
      }
    }
    return out;
  }

  async save(provider: string, values: Record<string, string>, updatedBy: string): Promise<{ saved: string[] }> {
    const p = getProvider(provider);
    if (!p) throw new Error("Proveedor desconocido");
    const problems = validateFields(p, values);
    if (problems.length) throw new Error(problems.join("; "));
    const saved: string[] = [];
    for (const [k, v] of Object.entries(values)) {
      const f = p.fields.find((x) => x.key === k) as CredentialField;
      if (v === "") {
        await this.store.remove(provider, k);
        saved.push(k);
        continue;
      }
      if (f.secret) {
        const ring = this.ring();
        if (!ring) throw new Error("No hay claves de cifrado configuradas: no se pueden guardar secretos");
        const enc = encryptValue(v, this.tenantId(), provider, k, ring);
        await this.store.upsert({ provider, field: k, secret: true, value: enc.cipher, keyId: enc.keyId }, updatedBy);
      } else {
        await this.store.upsert({ provider, field: k, secret: false, value: v, keyId: null }, updatedBy);
      }
      saved.push(k);
    }
    return { saved };
  }

  async clear(provider: string): Promise<void> {
    for (const row of await this.store.list(provider)) await this.store.remove(provider, row.field);
  }
}
