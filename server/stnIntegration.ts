/**
 * Social Token Net Complete — comprobaciones ligeras que usan los tokens internos (campañas por comunidad y
 * recompensas exclusivas) sin depender del resto de la integración (server/stnCompleteDb.ts).
 *
 *  - La integración solo existe si la empresa tiene LAS DOS capacidades (`social-token-net` y
 *    `social-token-net-tokens`), sea por el paquete Complete o por los dos módulos sueltos. Si no puede verificarse, no.
 *  - Miembro → cliente sin identidades nuevas: el cliente del CRM enlazado al miembro (`community_members.client_id`) o,
 *    si no lo hay, el cliente con el mismo correo que su cuenta del Core (users.email = clients.email).
 */
import { sql, type SQL } from "drizzle-orm";
import { getDb } from "./db";
import { getCapabilityAccess } from "./_core/capabilities/access";
import { STN_CAPABILITIES } from "../shared/stnComplete";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type Exec = Pick<Db, "execute">;

/** ¿Tiene la empresa comunidades y tokens a la vez? (`write`: las dos activas; sin `write`: activas o solo lectura). */
export async function stnIntegrationActive(write: boolean): Promise<boolean> {
  try {
    const access = getCapabilityAccess();
    for (const cap of STN_CAPABILITIES) if (!(await access.check(cap, { write })).allowed) return false;
    return true;
  } catch {
    return false;
  }
}

function missingSchema(e: unknown): boolean {
  for (let x: any = e, depth = 0; x && depth < 5; x = x.cause, depth++) {
    if (x.code === "ER_NO_SUCH_TABLE" || x.code === "ER_BAD_FIELD_ERROR") return true;
  }
  return false;
}

async function rows<T>(exec: Exec, q: SQL): Promise<T[]> {
  const [r] = (await exec.execute(q)) as unknown as [T[]];
  return r;
}

/**
 * Comunidades (activas, no archivadas) de las que el cliente del CRM es miembro activo: por el enlace del miembro o por
 * el correo de su cuenta. Sin las tablas de comunidades, ninguna.
 */
export async function clientCommunityIds(clientId: number, exec?: Exec): Promise<Set<number>> {
  try {
    const d = exec ?? (await getDb());
    if (!d) return new Set();
    const r = await rows<{ community_id: number }>(d, sql`SELECT DISTINCT m.community_id FROM community_members m
      JOIN communities c ON c.id = m.community_id
      LEFT JOIN users u ON u.id = m.user_id
      WHERE m.status = 'active' AND c.status = 'active'
        AND (m.client_id = ${clientId} OR (m.client_id IS NULL AND u.email IS NOT NULL AND u.email <> '' AND LOWER(u.email) = (SELECT LOWER(cl.email) FROM clients cl WHERE cl.id = ${clientId})))`);
    return new Set(r.map((x) => Number(x.community_id)));
  } catch (e) {
    if (missingSchema(e)) return new Set();
    throw e;
  }
}

/** Cliente del CRM de un miembro de la comunidad (enlace del miembro o correo de su cuenta); null si no tiene. */
export async function clientIdForMember(communityId: number, userId: number, exec?: Exec): Promise<number | null> {
  const d = exec ?? (await getDb());
  if (!d) return null;
  const [m] = await rows<{ client_id: number | null }>(d, sql`SELECT client_id FROM community_members WHERE community_id = ${communityId} AND user_id = ${userId}`);
  if (m?.client_id) return Number(m.client_id);
  const [c] = await rows<{ id: number }>(d, sql`SELECT cl.id FROM users u JOIN clients cl ON LOWER(cl.email) = LOWER(u.email) WHERE u.id = ${userId} AND u.email IS NOT NULL AND u.email <> '' ORDER BY cl.id LIMIT 1`);
  return c ? Number(c.id) : null;
}
