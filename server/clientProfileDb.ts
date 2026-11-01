/**
 * Ficha de cliente del CRM (BD de la empresa en curso): filtros del listado, recuentos, duplicados, notas,
 * exportación de lo filtrado y datos extra del historial (tickets de caja y correos enviados).
 *
 * Todo se lee y escribe en la BD de la empresa (`getDb()` resuelve la del tenant): una empresa nunca ve los
 * clientes, notas ni documentos de otra. La tabla de notas es de db/migrations/0019_client_notes.
 */
import { TRPCError } from "@trpc/server";
import { and, asc, count, desc, eq, inArray, like, or, sql, type SQL } from "drizzle-orm";
import { clients, emailCommLog, tpvSales } from "../drizzle/schema";
import { getDb } from "./db";
import { hasTagCondition } from "./crmTagsDb";
import { NOTE_MAX, type ClientKind, type DuplicateMatch } from "../shared/clientProfile";
import { normalizeTaxId } from "../shared/formValidation";
import type { ClientCsvField } from "../shared/clientImportCsv";
import { int, mysqlTable } from "drizzle-orm/mysql-core";

async function requireDb() {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Base de datos no disponible" });
  return db;
}

const rowsOf = (r: unknown) => ((Array.isArray(r) ? r[0] : r) as Array<Record<string, unknown>>) ?? [];
const errCode = (e: unknown) => {
  const err = e as { code?: string; cause?: { code?: string } };
  return err?.cause?.code ?? err?.code;
};
const isMissingTable = (e: unknown) => errCode(e) === "ER_NO_SUCH_TABLE";

// Tabla de notas (migración 0019, fuera de drizzle/schema.ts como la 0017): solo las columnas que se usan para borrar
const clientNotes = mysqlTable("client_notes", { id: int("id").primaryKey(), clientId: int("client_id").notNull() });

// ─── Listado ────────────────────────────────────────────────────────────────

export interface ClientListFilters {
  search?: string;
  tagId?: number;
  type?: ClientKind;
}

const HAS_COMPANY = sql`COALESCE(TRIM(${clients.company}), '') <> ''`;

/** Condición del listado: búsqueda (nombre, correo, empresa, NIF o teléfono), etiqueta y tipo. */
export function clientListConditions(f: ClientListFilters): SQL | undefined {
  const c: SQL[] = [];
  const q = f.search?.trim();
  if (q) {
    const p = `%${q}%`;
    c.push(or(like(clients.name, p), like(clients.email, p), like(clients.company, p), like(clients.nif, p), like(clients.phone, p)) as SQL);
  }
  if (f.tagId) c.push(hasTagCondition(clients.id, "client", f.tagId));
  if (f.type === "empresa") c.push(HAS_COMPANY);
  if (f.type === "particular") c.push(sql`COALESCE(TRIM(${clients.company}), '') = ''`);
  return c.length ? and(...c) : undefined;
}

/** Recuentos de la cabecera: total, empresas, particulares y altas del mes en curso. */
export async function clientStats(now = new Date()): Promise<{ total: number; companies: number; individuals: number; newThisMonth: number }> {
  const db = await requireDb();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const [r] = await db
    .select({
      total: count(),
      companies: sql<number>`COALESCE(SUM(CASE WHEN ${HAS_COMPANY} THEN 1 ELSE 0 END), 0)`,
      newThisMonth: sql<number>`COALESCE(SUM(CASE WHEN ${clients.createdAt} >= ${monthStart} THEN 1 ELSE 0 END), 0)`,
    })
    .from(clients);
  const total = Number(r?.total ?? 0);
  const companies = Number(r?.companies ?? 0);
  return { total, companies, individuals: total - companies, newThisMonth: Number(r?.newThisMonth ?? 0) };
}

/** Exportación CSV de lo filtrado, con las columnas de la plantilla de importación. */
export async function listFilteredClientsForExport(f: ClientListFilters): Promise<Array<Partial<Record<ClientCsvField, string | null>>>> {
  const db = await requireDb();
  return db
    .select({
      name: clients.name, email: clients.email, phone: clients.phone, company: clients.company, nif: clients.nif,
      address: clients.address, city: clients.city, postalCode: clients.postalCode, country: clients.country, notes: clients.notes,
    })
    .from(clients)
    .where(clientListConditions(f))
    .orderBy(asc(clients.name), asc(clients.id));
}

// ─── Duplicados ─────────────────────────────────────────────────────────────

/** Clientes con el mismo correo (sin distinguir mayúsculas) o el mismo NIF (sin espacios, puntos ni guiones). */
export async function findClientDuplicates(input: { email?: string; nif?: string; excludeId?: number }): Promise<DuplicateMatch[]> {
  const db = await requireDb();
  const email = input.email?.trim().toLowerCase() ?? "";
  const nif = input.nif ? normalizeTaxId(input.nif) : "";
  const conds: SQL[] = [];
  if (email) conds.push(sql`LOWER(${clients.email}) = ${email}`);
  if (nif.length >= 8) conds.push(sql`REPLACE(REPLACE(REPLACE(UPPER(${clients.nif}), ' ', ''), '-', ''), '.', '') = ${nif}`);
  if (!conds.length) return [];
  const rows = await db
    .select({ id: clients.id, name: clients.name, company: clients.company, email: clients.email, nif: clients.nif })
    .from(clients)
    .where(and(or(...conds), input.excludeId ? sql`${clients.id} <> ${input.excludeId}` : undefined))
    .limit(5);
  return rows.map((r) => {
    const by: DuplicateMatch["by"] = [];
    if (email && r.email.toLowerCase() === email) by.push("email");
    if (nif.length >= 8 && normalizeTaxId(r.nif ?? "") === nif) by.push("nif");
    return { ...r, by };
  });
}

// ─── Notas ──────────────────────────────────────────────────────────────────

export interface ClientNote {
  id: number;
  body: string;
  authorId: number | null;
  authorName: string | null;
  createdAt: Date;
}

const NOTES_UNAVAILABLE = "Las notas todavía no están disponibles en tu cuenta. Vuelve a intentarlo más tarde.";

async function assertClientExists(clientId: number) {
  const db = await requireDb();
  const [c] = await db.select({ id: clients.id }).from(clients).where(eq(clients.id, clientId)).limit(1);
  if (!c) throw new TRPCError({ code: "NOT_FOUND", message: "El cliente no existe" });
}

/** Notas del cliente, de la más reciente a la más antigua. `available: false` si la tabla aún no existe. */
export async function listClientNotes(clientId: number): Promise<{ available: boolean; items: ClientNote[] }> {
  const db = await requireDb();
  await assertClientExists(clientId);
  try {
    const rows = rowsOf(await db.execute(sql`SELECT id, body, author_id, author_name, created_at FROM client_notes WHERE client_id = ${clientId} ORDER BY created_at DESC, id DESC LIMIT 200`));
    return {
      available: true,
      items: rows.map((r) => ({
        id: Number(r.id),
        body: String(r.body ?? ""),
        authorId: r.author_id == null ? null : Number(r.author_id),
        authorName: r.author_name == null ? null : String(r.author_name),
        createdAt: r.created_at instanceof Date ? r.created_at : new Date(String(r.created_at)),
      })),
    };
  } catch (e) {
    if (isMissingTable(e)) return { available: false, items: [] };
    throw e;
  }
}

export async function addClientNote(clientId: number, rawBody: string, author: { id: number; name: string | null }): Promise<{ id: number }> {
  const body = rawBody.trim();
  if (!body) throw new TRPCError({ code: "BAD_REQUEST", message: "Escribe el texto de la nota." });
  if (body.length > NOTE_MAX) throw new TRPCError({ code: "BAD_REQUEST", message: `La nota no puede pasar de ${NOTE_MAX} caracteres.` });
  const db = await requireDb();
  await assertClientExists(clientId);
  try {
    const [res] = (await db.execute(sql`INSERT INTO client_notes (client_id, body, author_id, author_name) VALUES (${clientId}, ${body}, ${author.id}, ${author.name})`)) as unknown as [{ insertId: number }];
    return { id: Number(res.insertId) };
  } catch (e) {
    if (isMissingTable(e)) throw new TRPCError({ code: "PRECONDITION_FAILED", message: NOTES_UNAVAILABLE });
    throw e;
  }
}

export async function deleteClientNote(clientId: number, noteId: number): Promise<void> {
  const db = await requireDb();
  try {
    const r = await db.delete(clientNotes).where(and(eq(clientNotes.id, noteId), eq(clientNotes.clientId, clientId)));
    const affected = Number((Array.isArray(r) ? (r[0] as { affectedRows?: number }) : (r as { affectedRows?: number }))?.affectedRows ?? 0);
    if (affected === 0) throw new TRPCError({ code: "NOT_FOUND", message: "La nota no existe" });
  } catch (e) {
    if (isMissingTable(e)) throw new TRPCError({ code: "NOT_FOUND", message: "La nota no existe" });
    throw e;
  }
}

/** Al borrar un cliente se borran sus notas (si la tabla existe). */
export async function deleteNotesOfClient(clientId: number): Promise<void> {
  const db = await requireDb();
  try {
    await db.delete(clientNotes).where(eq(clientNotes.clientId, clientId));
  } catch (e) {
    if (!isMissingTable(e)) throw e;
  }
}

// ─── Historial: tickets de caja y correos enviados ─────────────────────────

export interface ClientHistoryExtras {
  /** Pedido → número de ticket, para los pedidos que vienen de una venta en caja. */
  tpvTickets: Record<number, string>;
  emails: Array<{ id: number; subject: string | null; status: string; recipientEmail: string | null; createdAt: Date }>;
}

export async function loadClientHistoryExtras(client: { email: string | null }, refs: { reservationIds: number[] }): Promise<ClientHistoryExtras> {
  const db = await requireDb();
  const tpvTickets: Record<number, string> = {};
  if (refs.reservationIds.length) {
    const sales = await db
      .select({ reservationId: tpvSales.reservationId, ticketNumber: tpvSales.ticketNumber })
      .from(tpvSales)
      .where(inArray(tpvSales.reservationId, refs.reservationIds));
    for (const s of sales) if (s.reservationId != null) tpvTickets[s.reservationId] = s.ticketNumber;
  }
  // Correos enviados AL cliente (no los avisos internos al equipo sobre sus documentos)
  let emails: ClientHistoryExtras["emails"] = [];
  if (client.email) {
    try {
      emails = await db
        .select({ id: emailCommLog.id, subject: emailCommLog.subject, status: emailCommLog.status, recipientEmail: emailCommLog.recipientEmail, createdAt: emailCommLog.createdAt })
        .from(emailCommLog)
        .where(eq(emailCommLog.recipientEmail, client.email))
        .orderBy(desc(emailCommLog.createdAt))
        .limit(100);
    } catch (e) {
      if (!isMissingTable(e)) throw e;
    }
  }
  return { tpvTickets, emails };
}
