/**
 * Ensamblado de la bóveda en el proceso: almacén en la BD del tenant en curso, claves del
 * entorno y precarga de credenciales descifradas para el código síncrono.
 */
import { sql } from "drizzle-orm";
import { getTenantDatabase } from "../dbRegistry";
import { getTenantId, isMultiTenant } from "../tenant";
import { PROVIDERS } from "./catalog";
import { hasWarmCredentials, invalidateCredentials, setResolvedCredentials } from "./cache";
import { IntegrationVault, keyringFromEnv, type CredentialStore, type StoredCredential } from "./vault";

class TenantDbCredentialStore implements CredentialStore {
  private async db() {
    const db = await getTenantDatabase();
    if (!db) throw new Error("Base de datos no disponible");
    return db;
  }

  async list(provider?: string): Promise<StoredCredential[]> {
    const db = await this.db();
    const res = (await db.execute(
      provider
        ? sql`SELECT provider, field, is_secret, value, key_id, updated_at FROM integration_credentials WHERE provider = ${provider}`
        : sql`SELECT provider, field, is_secret, value, key_id, updated_at FROM integration_credentials`,
    )) as unknown as [Array<Record<string, unknown>>];
    return res[0].map((r) => ({
      provider: String(r.provider),
      field: String(r.field),
      secret: !!r.is_secret,
      value: String(r.value),
      keyId: r.key_id ? String(r.key_id) : null,
      updatedAt: new Date(String(r.updated_at)),
    }));
  }

  async upsert(c: Omit<StoredCredential, "updatedAt">, updatedBy: string): Promise<void> {
    const db = await this.db();
    await db.execute(sql`
      INSERT INTO integration_credentials (provider, field, is_secret, value, key_id, updated_by)
      VALUES (${c.provider}, ${c.field}, ${c.secret ? 1 : 0}, ${c.value}, ${c.keyId}, ${updatedBy.slice(0, 100)})
      ON DUPLICATE KEY UPDATE is_secret = VALUES(is_secret), value = VALUES(value), key_id = VALUES(key_id), updated_by = VALUES(updated_by)`);
    invalidateCredentials();
  }

  async remove(provider: string, field: string): Promise<void> {
    const db = await this.db();
    await db.execute(sql`DELETE FROM integration_credentials WHERE provider = ${provider} AND field = ${field}`);
    invalidateCredentials();
  }
}

export function getVault(): IntegrationVault {
  return new IntegrationVault(new TenantDbCredentialStore(), () => getTenantId(), () => keyringFromEnv());
}

/**
 * Precarga las credenciales del tenant en curso (multi). No lanza: sin tabla o sin clave el
 * tenant simplemente no tiene integraciones configuradas.
 */
export async function warmIntegrationCreds(): Promise<void> {
  if (!isMultiTenant() || hasWarmCredentials()) return;
  try {
    const vault = getVault();
    const out: Record<string, Record<string, string>> = {};
    for (const p of PROVIDERS) out[p.id] = await vault.resolve(p.id);
    setResolvedCredentials(out);
  } catch {
    setResolvedCredentials({});
  }
}
