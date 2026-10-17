/**
 * Etiquetas del CRM (crm-tags): catálogo por empresa y asignación a clientes y oportunidades.
 *
 * Todo vive en la BD de la empresa en curso (`getDb()` resuelve la del tenant): una empresa nunca
 * lee ni escribe etiquetas de otra. Tablas de db/migrations/0008_crm_tags_tasks.
 */
import { TRPCError } from "@trpc/server";
import { and, asc, count, eq, inArray, sql, type SQL } from "drizzle-orm";
import type { AnyMySqlColumn } from "drizzle-orm/mysql-core";
import { clients, crmTagLinks, crmTags, leads } from "../drizzle/schema";
import { getDb } from "./db";
import { normalizeTagName, type TagEntityType } from "../shared/crmTagsTasks";

async function requireDb() {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Base de datos no disponible" });
  return db;
}

const isDuplicate = (e: unknown) => {
  const err = e as { code?: string; cause?: { code?: string } };
  return err?.code === "ER_DUP_ENTRY" || err?.cause?.code === "ER_DUP_ENTRY";
};

export interface TagRow {
  id: number;
  name: string;
  color: string | null;
  usage: number;
}

/** Catálogo de etiquetas con el número de clientes y oportunidades que la llevan. */
export async function listTags(): Promise<TagRow[]> {
  const db = await requireDb();
  const rows = await db
    .select({ id: crmTags.id, name: crmTags.name, color: crmTags.color, usage: count(crmTagLinks.id) })
    .from(crmTags)
    .leftJoin(crmTagLinks, eq(crmTagLinks.tagId, crmTags.id))
    .groupBy(crmTags.id, crmTags.name, crmTags.color)
    .orderBy(asc(crmTags.name));
  return rows.map((r) => ({ ...r, usage: Number(r.usage) }));
}

export async function createTag(input: { name: string; color?: string | null }, userId: number): Promise<{ id: number }> {
  const db = await requireDb();
  const name = normalizeTagName(input.name);
  try {
    const [res] = await db.insert(crmTags).values({ name, color: input.color ?? null, createdBy: userId });
    return { id: Number((res as { insertId: number }).insertId) };
  } catch (e) {
    if (isDuplicate(e)) throw new TRPCError({ code: "CONFLICT", message: "Ya existe una etiqueta con ese nombre" });
    throw e;
  }
}

export async function updateTag(id: number, input: { name?: string; color?: string | null }): Promise<void> {
  const db = await requireDb();
  const [cur] = await db.select({ id: crmTags.id }).from(crmTags).where(eq(crmTags.id, id)).limit(1);
  if (!cur) throw new TRPCError({ code: "NOT_FOUND", message: "Etiqueta no encontrada" });
  const set: { name?: string; color?: string | null } = {};
  if (input.name !== undefined) set.name = normalizeTagName(input.name);
  if (input.color !== undefined) set.color = input.color;
  if (!Object.keys(set).length) return;
  try {
    await db.update(crmTags).set(set).where(eq(crmTags.id, id));
  } catch (e) {
    if (isDuplicate(e)) throw new TRPCError({ code: "CONFLICT", message: "Ya existe una etiqueta con ese nombre" });
    throw e;
  }
}

/** Borra la etiqueta y todas sus asignaciones. */
export async function deleteTag(id: number): Promise<void> {
  const db = await requireDb();
  const [cur] = await db.select({ id: crmTags.id }).from(crmTags).where(eq(crmTags.id, id)).limit(1);
  if (!cur) throw new TRPCError({ code: "NOT_FOUND", message: "Etiqueta no encontrada" });
  await db.transaction(async (tx) => {
    await tx.delete(crmTagLinks).where(eq(crmTagLinks.tagId, id));
    await tx.delete(crmTags).where(eq(crmTags.id, id));
  });
}

async function assertEntity(entityType: TagEntityType, entityId: number): Promise<void> {
  const db = await requireDb();
  const table = entityType === "client" ? clients : leads;
  const [row] = await db.select({ id: table.id }).from(table).where(eq(table.id, entityId)).limit(1);
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: entityType === "client" ? "Cliente no encontrado" : "Oportunidad no encontrada" });
}

/** Asigna una etiqueta a un cliente u oportunidad. Idempotente. */
export async function assignTag(tagId: number, entityType: TagEntityType, entityId: number, userId: number): Promise<void> {
  const db = await requireDb();
  const [tag] = await db.select({ id: crmTags.id }).from(crmTags).where(eq(crmTags.id, tagId)).limit(1);
  if (!tag) throw new TRPCError({ code: "NOT_FOUND", message: "Etiqueta no encontrada" });
  await assertEntity(entityType, entityId);
  await db
    .insert(crmTagLinks)
    .values({ tagId, entityType, entityId, createdBy: userId })
    .onDuplicateKeyUpdate({ set: { tagId } });
}

/** Quita una etiqueta de un cliente u oportunidad. Idempotente. */
export async function unassignTag(tagId: number, entityType: TagEntityType, entityId: number): Promise<void> {
  const db = await requireDb();
  await db
    .delete(crmTagLinks)
    .where(and(eq(crmTagLinks.tagId, tagId), eq(crmTagLinks.entityType, entityType), eq(crmTagLinks.entityId, entityId)));
}

/** Etiquetas de varios clientes u oportunidades: { [entityId]: etiquetas }. */
export async function tagsForEntities(entityType: TagEntityType, ids: number[]): Promise<Record<number, Array<{ id: number; name: string; color: string | null }>>> {
  const out: Record<number, Array<{ id: number; name: string; color: string | null }>> = {};
  if (!ids.length) return out;
  const db = await requireDb();
  const rows = await db
    .select({ entityId: crmTagLinks.entityId, id: crmTags.id, name: crmTags.name, color: crmTags.color })
    .from(crmTagLinks)
    .innerJoin(crmTags, eq(crmTags.id, crmTagLinks.tagId))
    .where(and(eq(crmTagLinks.entityType, entityType), inArray(crmTagLinks.entityId, ids)))
    .orderBy(asc(crmTags.name));
  for (const r of rows) (out[r.entityId] ??= []).push({ id: r.id, name: r.name, color: r.color });
  return out;
}

/** Condición SQL «la entidad lleva esta etiqueta», para filtrar listados (clientes, oportunidades). */
export function hasTagCondition(idColumn: AnyMySqlColumn, entityType: TagEntityType, tagId: number): SQL {
  return sql`${idColumn} IN (SELECT ${crmTagLinks.entityId} FROM ${crmTagLinks} WHERE ${crmTagLinks.tagId} = ${tagId} AND ${crmTagLinks.entityType} = ${entityType})`;
}
