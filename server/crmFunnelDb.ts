/**
 * Embudo de ventas configurable del CRM (capacidad Business `crm-funnel-advanced`): etapas de la empresa, tablero de
 * oportunidades por etapa y paso de una etapa a otra.
 *
 * Todo vive en la BD de la empresa en curso (`getDb()` resuelve la del tenant): una empresa nunca lee ni escribe las
 * etapas ni las oportunidades de otra. Tablas de db/migrations/0021_crm_funnel_stages (fuera de drizzle/schema.ts, como
 * la 0019). Las oportunidades conservan su estado de siempre (`leads.opportunityStatus`), que se actualiza al cambiar de
 * etapa: Essential, los informes y los flujos de siempre siguen viendo lo mismo.
 */
import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, like, or, sql, type SQL } from "drizzle-orm";
import { int, mysqlTable, timestamp, tinyint, varchar } from "drizzle-orm/mysql-core";
import { leads, users } from "../drizzle/schema";
import { getDb, logActivity } from "./db";
import {
  DEFAULT_STAGES, LEAD_STATUS_FOR, LEGACY_STATUSES, STAGE_COLORS, STAGE_KINDS, STAGES_MAX, canRemoveStageKind, effectiveStage, funnelForecast,
  normalizeStageName, sortStages, statusForStage, validateStageForm,
  type FunnelStage, type LegacyStatus, type StageColor, type StageForm, type StageKind,
} from "../shared/crmFunnel";

export const funnelStages = mysqlTable("crm_funnel_stages", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 80 }).notNull(),
  position: int("position").notNull(),
  probability: tinyint("probability", { unsigned: true }).notNull(),
  kind: varchar("kind", { length: 16 }).notNull(),
  color: varchar("color", { length: 16 }).notNull(),
  legacyStatus: varchar("legacy_status", { length: 16 }),
});

export const leadStages = mysqlTable("crm_lead_stages", {
  leadId: int("lead_id").primaryKey(),
  stageId: int("stage_id").notNull(),
  movedBy: int("moved_by"),
  movedAt: timestamp("moved_at", { fsp: 3 }).notNull(),
});

/** Máximo de oportunidades que pinta el tablero (las más recientes); la previsión se calcula sobre las mismas. */
export const BOARD_LIMIT = 1000;

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

async function requireDb(): Promise<Db> {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Base de datos no disponible" });
  return db;
}

const errCode = (e: unknown) => {
  const err = e as { code?: string; cause?: { code?: string } };
  return err?.cause?.code ?? err?.code;
};

/** Sin la migración 0021 aplicada en esta empresa: aviso claro en lugar de un error interno. */
function notReady(e: unknown): never {
  if (errCode(e) === "ER_NO_SUCH_TABLE")
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "El embudo configurable aún no está preparado en tu empresa. Inténtalo de nuevo en unos minutos." });
  throw e;
}

const asKind = (v: string): StageKind => ((STAGE_KINDS as readonly string[]).includes(v) ? (v as StageKind) : "abierta");
const asColor = (v: string): StageColor => ((STAGE_COLORS as readonly string[]).includes(v) ? (v as StageColor) : "gris");
const asLegacy = (v: string | null): LegacyStatus | null => (v && (LEGACY_STATUSES as readonly string[]).includes(v) ? (v as LegacyStatus) : null);

function toStage(r: typeof funnelStages.$inferSelect): FunnelStage {
  return { id: r.id, name: r.name, position: r.position, probability: Number(r.probability), kind: asKind(r.kind), color: asColor(r.color), legacyStatus: asLegacy(r.legacyStatus) };
}

/**
 * Etapas de la empresa, en orden. La primera vez crea las cuatro por defecto (equivalentes a los estados de siempre);
 * la clave única de `legacy_status` impide duplicarlas si dos peticiones llegan a la vez.
 */
export async function listStages(): Promise<FunnelStage[]> {
  const db = await requireDb();
  try {
    let rows = await db.select().from(funnelStages).orderBy(asc(funnelStages.position), asc(funnelStages.id));
    if (rows.length === 0) {
      for (const s of DEFAULT_STAGES) {
        try {
          await db.insert(funnelStages).values({ name: s.name, position: s.position, probability: s.probability, kind: s.kind, color: s.color, legacyStatus: s.legacyStatus });
        } catch (e) {
          if (errCode(e) !== "ER_DUP_ENTRY") throw e;
        }
      }
      rows = await db.select().from(funnelStages).orderBy(asc(funnelStages.position), asc(funnelStages.id));
    }
    return rows.map(toStage);
  } catch (e) {
    return notReady(e);
  }
}

function assertValid(form: StageForm, stages: FunnelStage[], selfId?: number) {
  const errors = validateStageForm(form, stages, selfId);
  const first = Object.values(errors)[0];
  if (first) throw new TRPCError({ code: first.includes("Ya existe") ? "CONFLICT" : "BAD_REQUEST", message: first });
}

export async function createStage(form: StageForm): Promise<{ id: number }> {
  const db = await requireDb();
  const stages = await listStages();
  if (stages.length >= STAGES_MAX) throw new TRPCError({ code: "BAD_REQUEST", message: `El embudo admite como máximo ${STAGES_MAX} etapas.` });
  assertValid(form, stages);
  const position = stages.reduce((m, s) => Math.max(m, s.position), -1) + 1;
  const [res] = (await db.insert(funnelStages).values({
    name: normalizeStageName(form.name), position, probability: form.probability, kind: form.kind, color: form.color, legacyStatus: null,
  })) as unknown as [{ insertId: number }];
  return { id: Number(res.insertId) };
}

export async function updateStage(id: number, form: StageForm): Promise<void> {
  const db = await requireDb();
  const stages = await listStages();
  const cur = stages.find((s) => s.id === id);
  if (!cur) throw new TRPCError({ code: "NOT_FOUND", message: "Etapa no encontrada" });
  assertValid(form, stages, id);
  if (form.kind !== cur.kind) {
    if (cur.legacyStatus) throw new TRPCError({ code: "BAD_REQUEST", message: "Las etapas por defecto no cambian de tipo: crea una etapa nueva." });
    if (!canRemoveStageKind(cur, stages)) throw new TRPCError({ code: "BAD_REQUEST", message: `El embudo necesita al menos una etapa de tipo «${cur.kind}».` });
  }
  await db.update(funnelStages).set({ name: normalizeStageName(form.name), probability: form.probability, kind: form.kind, color: form.color }).where(eq(funnelStages.id, id));
}

/** Nuevo orden: la lista completa de ids de etapa. */
export async function reorderStages(ids: number[]): Promise<void> {
  const db = await requireDb();
  const stages = await listStages();
  const known = new Set(stages.map((s) => s.id));
  if (ids.length !== stages.length || new Set(ids).size !== ids.length || ids.some((i) => !known.has(i)))
    throw new TRPCError({ code: "BAD_REQUEST", message: "El orden debe incluir todas las etapas una sola vez." });
  for (let i = 0; i < ids.length; i++) await db.update(funnelStages).set({ position: i }).where(eq(funnelStages.id, ids[i]));
}

/**
 * Quita una etapa. Sus oportunidades no se tocan: vuelven a la etapa que les corresponde por su estado de siempre.
 * Siempre queda al menos una etapa de cada tipo.
 */
export async function removeStage(id: number): Promise<{ released: number }> {
  const db = await requireDb();
  const stages = await listStages();
  const cur = stages.find((s) => s.id === id);
  if (!cur) throw new TRPCError({ code: "NOT_FOUND", message: "Etapa no encontrada" });
  if (!canRemoveStageKind(cur, stages)) throw new TRPCError({ code: "BAD_REQUEST", message: `El embudo necesita al menos una etapa de tipo «${cur.kind}».` });
  const [res] = (await db.delete(leadStages).where(eq(leadStages.stageId, id))) as unknown as [{ affectedRows?: number }];
  await db.delete(funnelStages).where(eq(funnelStages.id, id));
  return { released: Number(res?.affectedRows ?? 0) };
}

export interface BoardCard {
  id: number;
  name: string;
  company: string | null;
  email: string;
  status: LegacyStatus;
  stageId: number;
  amount: number;
  probability: number;
  lostReason: string | null;
  ownerName: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface BoardFilters {
  search?: string;
}

/** Tablero: etapas, oportunidades en su etapa efectiva y previsión ponderada por etapa y total. */
export async function funnelBoard(f: BoardFilters = {}) {
  const db = await requireDb();
  const stages = await listStages();
  const cond: SQL[] = [];
  const q = f.search?.trim();
  if (q) {
    const p = `%${q}%`;
    cond.push(or(like(leads.name, p), like(leads.email, p), like(leads.company, p)) as SQL);
  }
  // Importe: el último presupuesto no rechazado de la oportunidad y, si no tiene, su presupuesto orientativo
  const quoteTotal = sql<string | null>`(SELECT q.total FROM quotes q WHERE q.leadId = ${leads.id} AND q.status <> 'rechazado' ORDER BY q.id DESC LIMIT 1)`;
  let rows;
  try {
    rows = await db
      .select({
        id: leads.id, name: leads.name, company: leads.company, email: leads.email, status: leads.opportunityStatus, budget: leads.budget,
        quoteTotal, lostReason: leads.lostReason, ownerName: users.name, createdAt: leads.createdAt, updatedAt: leads.updatedAt, stageId: leadStages.stageId,
      })
      .from(leads)
      .leftJoin(leadStages, eq(leadStages.leadId, leads.id))
      .leftJoin(users, eq(users.id, leads.assignedTo))
      .where(cond.length ? and(...cond) : undefined)
      .orderBy(desc(leads.updatedAt), desc(leads.id))
      .limit(BOARD_LIMIT + 1);
  } catch (e) {
    return notReady(e);
  }
  const truncated = rows.length > BOARD_LIMIT;
  const prob = new Map(stages.map((s) => [s.id, s.probability]));
  const cards: BoardCard[] = [];
  for (const r of rows.slice(0, BOARD_LIMIT)) {
    const status = r.status as LegacyStatus;
    const stage = effectiveStage(status, r.stageId, stages);
    if (!stage) continue;
    const amount = Number(r.quoteTotal ?? r.budget ?? 0) || 0;
    cards.push({
      id: r.id, name: r.name, company: r.company, email: r.email, status, stageId: stage.id, amount, probability: prob.get(stage.id) ?? 0,
      lostReason: r.lostReason, ownerName: r.ownerName ?? null, createdAt: r.createdAt, updatedAt: r.updatedAt,
    });
  }
  return { stages: sortStages(stages), cards, forecast: funnelForecast(cards, stages), truncated };
}

/**
 * Pasa una oportunidad a otra etapa. Actualiza también su estado de siempre (y el del lead), y al pasar a una etapa
 * perdida exige y guarda el motivo. Queda en el historial de la oportunidad.
 */
export async function moveLeadToStage(leadId: number, stageId: number, lostReason: string | undefined, actor: { id: number; name: string | null }) {
  const db = await requireDb();
  const stages = await listStages();
  const stage = stages.find((s) => s.id === stageId);
  if (!stage) throw new TRPCError({ code: "NOT_FOUND", message: "Etapa no encontrada" });
  const [lead] = await db.select({ id: leads.id, status: leads.opportunityStatus }).from(leads).where(eq(leads.id, leadId)).limit(1);
  if (!lead) throw new TRPCError({ code: "NOT_FOUND", message: "Oportunidad no encontrada" });
  const reason = lostReason?.trim();
  if (stage.kind === "perdida" && !reason) throw new TRPCError({ code: "BAD_REQUEST", message: "Indica el motivo de la pérdida." });
  const from = lead.status as LegacyStatus;
  const to = statusForStage(stage, from);
  await db
    .update(leads)
    .set({ opportunityStatus: to, status: LEAD_STATUS_FOR[to], ...(stage.kind === "perdida" ? { lostReason: reason } : {}), updatedAt: new Date() })
    .where(eq(leads.id, leadId));
  const movedAt = new Date();
  await db.insert(leadStages).values({ leadId, stageId, movedBy: actor.id, movedAt }).onDuplicateKeyUpdate({ set: { stageId, movedBy: actor.id, movedAt } });
  await logActivity("lead", leadId, "stage_changed", actor.id, actor.name, { stage: stage.name, from, to, ...(reason && stage.kind === "perdida" ? { reason } : {}) });
  return { status: to, stageId };
}
