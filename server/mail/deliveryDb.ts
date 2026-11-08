/**
 * Trazabilidad del correo transaccional en el CRM de la empresa: estado de entrega de cada envío a un cliente y si su
 * dirección está suprimida (rebote duro, queja o baja). Lee la bandeja de salida de la propia empresa (migración 0010:
 * mail_outbox, mail_events, mail_suppressions), sin tablas nuevas.
 *
 * La bandeja no guarda la dirección completa una vez enviado (solo su huella SHA-256 y la versión enmascarada): los envíos
 * de un cliente se localizan por la huella de su correo y siempre dentro de la empresa en curso.
 */
import type mysql from "mysql2/promise";
import { getTenantDatabase } from "../_core/dbRegistry";
import { getTenantIdOrDefault } from "../_core/tenant";
import { normalizeEmail, recipientHash } from "./policy";
import type { MailStatus } from "./types";

export interface ClientMailSend {
  id: number;
  category: string;
  status: MailStatus;
  reason: string | null;
  provider: string | null;
  subject: string;
  createdAt: number;
  updatedAt: number;
  /** Último evento del proveedor (entregado, rebote…) con su motivo saneado, si lo hay. */
  lastEvent: { kind: string; detail: string | null; at: number } | null;
}

export interface ClientMailDelivery {
  /** false si la empresa no tiene la bandeja de salida (sin migración): nada que mostrar. */
  available: boolean;
  email: string | null;
  suppressed: { reason: string; since: number } | null;
  sends: ClientMailSend[];
}

/** Estados que significan que el correo no le ha llegado (o no le llegará). */
export const UNDELIVERED: ReadonlySet<MailStatus> = new Set<MailStatus>(["bounced", "blocked", "complained", "failed"]);

const rowsOf = (r: unknown) => ((Array.isArray(r) ? r[0] : r) as Array<Record<string, unknown>>) ?? [];
const missingTable = (e: unknown) => (e as { code?: string })?.code === "ER_NO_SUCH_TABLE";

async function tenantPool(): Promise<Pick<mysql.Pool, "query"> | null> {
  const db = await getTenantDatabase();
  return db ? (db as unknown as { $client: mysql.Pool }).$client : null;
}

/** Envíos (los 50 últimos) y supresión de una dirección en la empresa en curso. */
export async function clientMailDelivery(rawEmail: string | null | undefined, pool?: Pick<mysql.Pool, "query"> | null): Promise<ClientMailDelivery> {
  const email = normalizeEmail(rawEmail ?? "");
  if (!email) return { available: true, email: null, suppressed: null, sends: [] };
  const p = pool ?? (await tenantPool());
  if (!p) return { available: false, email, suppressed: null, sends: [] };
  const tenantId = getTenantIdOrDefault();
  const hash = recipientHash(email);
  try {
    const [sup, sends] = await Promise.all([
      p.query("SELECT reason, created_at FROM mail_suppressions WHERE tenant_id = ? AND recipient_hash = ? LIMIT 1", [tenantId, hash]),
      p.query(
        "SELECT id, category, status, reason, provider, subject, created_at, updated_at FROM mail_outbox WHERE tenant_id = ? AND recipient_hash = ? ORDER BY created_at DESC, id DESC LIMIT 50",
        [tenantId, hash],
      ),
    ]);
    const list = rowsOf(sends);
    const ids = list.map((r) => Number(r.id));
    const events = new Map<number, ClientMailSend["lastEvent"]>();
    if (ids.length) {
      const evs = rowsOf(
        await p.query(
          "SELECT outbox_id, kind, detail, created_at FROM mail_events WHERE tenant_id = ? AND outbox_id IN (?) AND kind LIKE 'provider\\_%' ORDER BY created_at ASC, id ASC",
          [tenantId, ids],
        ),
      );
      for (const e of evs) events.set(Number(e.outbox_id), { kind: String(e.kind).replace(/^provider_/, ""), detail: e.detail == null ? null : String(e.detail), at: Number(e.created_at) });
    }
    const s = rowsOf(sup)[0];
    return {
      available: true,
      email,
      suppressed: s ? { reason: String(s.reason), since: Number(s.created_at) } : null,
      sends: list.map((r) => ({
        id: Number(r.id),
        category: String(r.category),
        status: String(r.status) as MailStatus,
        reason: r.reason == null ? null : String(r.reason),
        provider: r.provider == null ? null : String(r.provider),
        subject: String(r.subject ?? ""),
        createdAt: Number(r.created_at),
        updatedAt: Number(r.updated_at),
        lastEvent: events.get(Number(r.id)) ?? null,
      })),
    };
  } catch (e) {
    if (missingTable(e)) return { available: false, email, suppressed: null, sends: [] };
    throw e;
  }
}

/** Recuento por estado de los envíos de la empresa por un proveedor desde `since` (panel de Postmark). */
export async function providerDeliveryStats(provider: string, since: number, pool?: Pick<mysql.Pool, "query"> | null): Promise<Record<string, number> | null> {
  const p = pool ?? (await tenantPool());
  if (!p) return null;
  try {
    const rows = rowsOf(
      await p.query("SELECT status, COUNT(*) AS n FROM mail_outbox WHERE tenant_id = ? AND provider = ? AND created_at >= ? GROUP BY status", [getTenantIdOrDefault(), provider, since]),
    );
    return Object.fromEntries(rows.map((r) => [String(r.status), Number(r.n)]));
  } catch (e) {
    if (missingTable(e)) return null;
    throw e;
  }
}
