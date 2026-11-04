/**
 * Social Token Net · Comunidades — encuestas, propuestas de miembros y reportes (acceso a datos). Lógica pura en
 * shared/communityPolls.ts; comunidades y miembros en server/communitiesDb.ts. Migración 0027_community_polls.
 *
 * Reutilizado de Segolife (server/segolife/community), adaptado a una base de datos por empresa y sin universidades
 * ni estudiantes:
 *  - communityResponseService.ts::submitResponse → submitResponse: una respuesta por persona (clave única, carrera
 *    idempotente), cambio solo si la encuesta lo permite y nunca en «me apunto». Adaptado: cambiar la respuesta no
 *    borra los valores anteriores, los marca como no vigentes (revisión), y la recompensa (tokens) ya no se concede
 *    aquí: se emite el hecho `member.responded` una sola vez (punto de extensión de STN-4).
 *  - communityResultsService.ts::getProposalResults → pollResults: agregación en el servidor por tipo de pregunta.
 *  - communityScoreService.ts → puntuación de la comunidad con la audiencia = miembros activos.
 *  - communityStudentProposalDb.ts → propuestas de miembros: moderación con motivo, apoyos y conversión en encuesta.
 *  - Sin planificador (communityLifecycleScheduler.ts): el estado efectivo se calcula al leer.
 */
import { sql, type SQL } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { getDb } from "./db";
import { recordCommunityEvent, dispatchCommunityEvent } from "./communities/events";
import { getComment, getPost, setCommentHidden, setPostStatus, type Community } from "./communitiesDb";
import {
  ATTENDANCE_VALUES,
  ATTENDANCE_WEIGHTS,
  ResponseError,
  attendanceFromCode,
  buildValueRows,
  canRespondAgain,
  canSupportProposal,
  communityScore,
  effectiveStatus,
  isOpenForResponses,
  isPositiveRespondent,
  medianMinutes,
  type EffectivePollStatus,
  type PollStatus,
  type ProposalStatus,
  type QuestionType,
  type ReportReason,
  type ReportStatus,
  type ReportTarget,
  type ResponsePayload,
  type ResultsVisibility,
  type ValueRow,
} from "../shared/communityPolls";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

async function db(): Promise<Db> {
  const d = await getDb();
  if (!d) throw new Error("Database not available");
  return d;
}
async function rows<T>(q: SQL): Promise<T[]> {
  const [r] = (await (await db()).execute(q)) as unknown as [T[]];
  return r;
}
async function header(q: SQL): Promise<{ affectedRows: number; insertId: number }> {
  const [r] = (await (await db()).execute(q)) as unknown as [{ affectedRows: number; insertId: number }];
  return { affectedRows: Number(r.affectedRows ?? 0), insertId: Number(r.insertId ?? 0) };
}
const n = (v: unknown) => Number(v ?? 0);
const b = (v: unknown) => v === 1 || v === true || v === "1";
const ids = (list: number[]) => sql.join(list.map((i) => sql`${i}`), sql`, `);

async function emit(e: Parameters<typeof recordCommunityEvent>[1]): Promise<void> {
  await dispatchCommunityEvent(await recordCommunityEvent(await db(), e));
}

// ─── Encuestas ────────────────────────────────────────────────────────────────

export interface PollOption {
  id: number;
  label: string;
  sortOrder: number;
  isPositiveIntent: boolean;
}

export interface Poll {
  id: number;
  communityId: number;
  title: string;
  description: string | null;
  questionType: QuestionType;
  status: PollStatus;
  effectiveStatus: EffectivePollStatus;
  startsAt: number | null;
  endsAt: number | null;
  resultsVisibility: ResultsVisibility;
  allowChangeResponse: boolean;
  experienceId: number | null;
  experience: { id: number; title: string; slug: string } | null;
  eventAt: number | null;
  sourceProposalId: number | null;
  publishedAt: number | null;
  closedAt: number | null;
  createdAt: number;
  options: PollOption[];
}

const POLL_SELECT = sql`SELECT p.*, e.title AS experience_title, e.slug AS experience_slug FROM community_polls p LEFT JOIN experiences e ON e.id = p.experience_id`;

function toPoll(r: Record<string, unknown>, options: PollOption[], now: number): Poll {
  const base = {
    status: String(r.status) as PollStatus,
    startsAt: r.starts_at == null ? null : n(r.starts_at),
    endsAt: r.ends_at == null ? null : n(r.ends_at),
  };
  return {
    id: n(r.id),
    communityId: n(r.community_id),
    title: String(r.title),
    description: (r.description as string | null) ?? null,
    questionType: String(r.question_type) as QuestionType,
    ...base,
    effectiveStatus: effectiveStatus(base, now),
    resultsVisibility: String(r.results_visibility) as ResultsVisibility,
    allowChangeResponse: b(r.allow_change_response),
    experienceId: r.experience_id == null ? null : n(r.experience_id),
    experience: r.experience_id != null && r.experience_slug ? { id: n(r.experience_id), title: String(r.experience_title), slug: String(r.experience_slug) } : null,
    eventAt: r.event_at == null ? null : n(r.event_at),
    sourceProposalId: r.source_proposal_id == null ? null : n(r.source_proposal_id),
    publishedAt: r.published_at == null ? null : n(r.published_at),
    closedAt: r.closed_at == null ? null : n(r.closed_at),
    createdAt: n(r.created_at),
    options,
  };
}

async function optionsOf(pollIds: number[]): Promise<Map<number, PollOption[]>> {
  const out = new Map<number, PollOption[]>();
  if (!pollIds.length) return out;
  const list = await rows<Record<string, unknown>>(sql`SELECT id, poll_id, label, sort_order, is_positive_intent FROM community_poll_options WHERE poll_id IN (${ids(pollIds)}) ORDER BY sort_order ASC, id ASC`);
  for (const o of list) {
    const arr = out.get(n(o.poll_id)) ?? [];
    arr.push({ id: n(o.id), label: String(o.label), sortOrder: n(o.sort_order), isPositiveIntent: b(o.is_positive_intent) });
    out.set(n(o.poll_id), arr);
  }
  return out;
}

export async function getPoll(id: number, now = Date.now()): Promise<Poll | null> {
  const [r] = await rows<Record<string, unknown>>(sql`${POLL_SELECT} WHERE p.id = ${id}`);
  if (!r) return null;
  return toPoll(r, (await optionsOf([id])).get(id) ?? [], now);
}

export async function requirePoll(id: number): Promise<Poll> {
  const p = await getPoll(id);
  if (!p) throw new TRPCError({ code: "NOT_FOUND", message: "Encuesta no encontrada." });
  return p;
}

export interface PollListItem extends Poll {
  responses: number;
  respondedByMe: boolean;
}

/** Encuestas de la comunidad. Los miembros no ven borradores ni canceladas; la administración, todas. */
export async function listPolls(communityId: number, viewerId: number, opts: { includeDrafts: boolean }): Promise<PollListItem[]> {
  const now = Date.now();
  const filter = opts.includeDrafts ? sql`` : sql` AND p.status IN ('active', 'closed')`;
  const list = await rows<Record<string, unknown>>(sql`${POLL_SELECT} WHERE p.community_id = ${communityId}${filter} ORDER BY p.created_at DESC LIMIT 200`);
  if (!list.length) return [];
  const pollIds = list.map((r) => n(r.id));
  const opts2 = await optionsOf(pollIds);
  const counts = await rows<{ poll_id: number; c: number; mine: number }>(sql`SELECT poll_id, COUNT(*) AS c, SUM(user_id = ${viewerId}) AS mine FROM community_poll_responses WHERE poll_id IN (${ids(pollIds)}) GROUP BY poll_id`);
  const items = list.map((r) => {
    const p = toPoll(r, opts2.get(n(r.id)) ?? [], now);
    const c = counts.find((x) => n(x.poll_id) === p.id);
    return { ...p, responses: n(c?.c), respondedByMe: n(c?.mine) > 0 };
  });
  // Abiertas primero (la que antes cierra arriba, criterio del feed de Segolife); después programadas y cerradas
  const rank = (s: EffectivePollStatus) => ({ active: 0, scheduled: 1, draft: 2, closed: 3, cancelled: 4 })[s];
  return items.sort((a, z) => rank(a.effectiveStatus) - rank(z.effectiveStatus) || (a.endsAt ?? Infinity) - (z.endsAt ?? Infinity) || z.createdAt - a.createdAt);
}

export interface PollInput {
  title: string;
  description: string | null;
  questionType: QuestionType;
  options: Array<{ label: string; isPositiveIntent: boolean }>;
  startsAt: number | null;
  endsAt: number | null;
  resultsVisibility: ResultsVisibility;
  allowChangeResponse: boolean;
  experienceId: number | null;
  eventAt: number | null;
}

export async function assertExperience(id: number | null): Promise<void> {
  if (id == null) return;
  const [e] = await rows<{ id: number }>(sql`SELECT id FROM experiences WHERE id = ${id}`);
  if (!e) throw new TRPCError({ code: "BAD_REQUEST", message: "El producto del catálogo no existe." });
}

/** Productos del catálogo para enlazar un evento (se reservan con la tienda del Core). */
export async function searchExperiences(q: string): Promise<Array<{ id: number; title: string; slug: string }>> {
  const like = `%${q.trim()}%`;
  const list = await rows<{ id: number; title: string; slug: string }>(sql`SELECT id, title, slug FROM experiences WHERE isActive = 1 AND title LIKE ${like} ORDER BY title ASC LIMIT 20`);
  return list.map((e) => ({ id: n(e.id), title: e.title, slug: e.slug }));
}

export async function createPoll(communityId: number, input: PollInput, opts: { publish: boolean; actorId: number; sourceProposalId?: number | null }): Promise<Poll> {
  await assertExperience(input.experienceId);
  const now = Date.now();
  const status: PollStatus = opts.publish ? "active" : "draft";
  const { insertId } = await header(sql`INSERT INTO community_polls (community_id, title, description, question_type, status, starts_at, ends_at, results_visibility, allow_change_response, experience_id, event_at, source_proposal_id, created_by, published_at, created_at, updated_at)
    VALUES (${communityId}, ${input.title}, ${input.description}, ${input.questionType}, ${status}, ${input.startsAt}, ${input.endsAt}, ${input.resultsVisibility}, ${input.allowChangeResponse ? 1 : 0}, ${input.experienceId}, ${input.eventAt}, ${opts.sourceProposalId ?? null}, ${opts.actorId}, ${opts.publish ? now : null}, ${now}, ${now})`);
  await writeOptions(insertId, input.options);
  if (opts.publish) await emit({ key: `poll.published:${insertId}`, type: "poll.published", communityId, userId: opts.actorId, targetType: "poll", targetId: insertId, now });
  return (await getPoll(insertId))!;
}

async function writeOptions(pollId: number, options: PollInput["options"]): Promise<void> {
  if (!options.length) return;
  await header(sql`INSERT INTO community_poll_options (poll_id, label, sort_order, is_positive_intent) VALUES ${sql.join(options.map((o, i) => sql`(${pollId}, ${o.label}, ${i}, ${o.isPositiveIntent ? 1 : 0})`), sql`, `)}`);
}

/** Editar: un borrador por completo; con respuestas, solo textos, cierre, visibilidad y evento (las opciones quedan fijas). */
export async function updatePoll(poll: Poll, input: PollInput): Promise<Poll> {
  await assertExperience(input.experienceId);
  const [c] = await rows<{ c: number }>(sql`SELECT COUNT(*) AS c FROM community_poll_responses WHERE poll_id = ${poll.id}`);
  const locked = n(c?.c) > 0;
  if (locked && (input.questionType !== poll.questionType || input.options.length !== poll.options.length || input.options.some((o, i) => o.label !== poll.options[i]?.label))) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "La encuesta ya tiene respuestas: no se pueden cambiar el tipo ni las opciones." });
  }
  await header(sql`UPDATE community_polls SET title = ${input.title}, description = ${input.description}, question_type = ${input.questionType}, starts_at = ${input.startsAt}, ends_at = ${input.endsAt},
    results_visibility = ${input.resultsVisibility}, allow_change_response = ${input.allowChangeResponse ? 1 : 0}, experience_id = ${input.experienceId}, event_at = ${input.eventAt}, updated_at = ${Date.now()} WHERE id = ${poll.id}`);
  if (!locked) {
    // Sin respuestas: las opciones se reescriben por posición (las sobrantes quedan fuera de la encuesta con poll_id negativo)
    await header(sql`UPDATE community_poll_options SET poll_id = ${-poll.id} WHERE poll_id = ${poll.id}`);
    await writeOptions(poll.id, input.options);
  } else {
    for (let i = 0; i < input.options.length; i++) await header(sql`UPDATE community_poll_options SET is_positive_intent = ${input.options[i].isPositiveIntent ? 1 : 0} WHERE id = ${poll.options[i].id}`);
  }
  return (await getPoll(poll.id))!;
}

/** Publicar (borrador → abierta), cerrar ya o cancelar. */
export async function setPollStatus(poll: Poll, action: "publish" | "close" | "cancel", actorId: number): Promise<Poll> {
  const now = Date.now();
  if (action === "publish") {
    if (poll.status !== "draft") throw new TRPCError({ code: "BAD_REQUEST", message: "Solo se publica un borrador." });
    await header(sql`UPDATE community_polls SET status = 'active', published_at = ${now}, updated_at = ${now} WHERE id = ${poll.id}`);
    await emit({ key: `poll.published:${poll.id}`, type: "poll.published", communityId: poll.communityId, userId: actorId, targetType: "poll", targetId: poll.id, now });
  } else if (action === "close") {
    if (poll.status !== "active") throw new TRPCError({ code: "BAD_REQUEST", message: "Solo se cierra una encuesta publicada." });
    await header(sql`UPDATE community_polls SET status = 'closed', closed_at = ${now}, ends_at = LEAST(COALESCE(ends_at, ${now}), ${now}), updated_at = ${now} WHERE id = ${poll.id}`);
    await emit({ key: `poll.closed:${poll.id}`, type: "poll.closed", communityId: poll.communityId, userId: actorId, targetType: "poll", targetId: poll.id, now });
  } else {
    await header(sql`UPDATE community_polls SET status = 'cancelled', updated_at = ${now} WHERE id = ${poll.id}`);
  }
  return (await getPoll(poll.id))!;
}

// ─── Respuestas ───────────────────────────────────────────────────────────────

export interface MyResponse {
  respondedAt: number;
  updatedAt: number;
  values: ValueRow[];
}

export async function myResponse(pollId: number, userId: number): Promise<MyResponse | null> {
  const [r] = await rows<{ id: number; responded_at: number; updated_at: number }>(sql`SELECT id, responded_at, updated_at FROM community_poll_responses WHERE poll_id = ${pollId} AND user_id = ${userId}`);
  if (!r) return null;
  const values = await rows<{ option_id: number | null; value_text: string | null; value_number: number | null }>(sql`SELECT option_id, value_text, value_number FROM community_poll_values WHERE response_id = ${r.id} AND current = 1 ORDER BY id ASC`);
  return { respondedAt: n(r.responded_at), updatedAt: n(r.updated_at), values: values.map((v) => ({ optionId: v.option_id == null ? null : n(v.option_id), valueText: v.value_text, valueNumber: v.value_number == null ? null : n(v.value_number) })) };
}

/**
 * Responder (o cambiar la respuesta si la encuesta lo permite). La ventana se comprueba en el servidor. El hecho
 * `member.responded` se emite solo la primera vez (cambiar la respuesta no vuelve a contar).
 */
export async function submitResponse(poll: Poll, userId: number, payload: ResponsePayload): Promise<{ first: boolean }> {
  if (payload.questionType !== poll.questionType) throw new TRPCError({ code: "BAD_REQUEST", message: "El tipo de respuesta no coincide con la pregunta." });
  const now = Date.now();
  if (!isOpenForResponses(poll, now)) throw new TRPCError({ code: "BAD_REQUEST", message: "Esta encuesta no está abierta para responder ahora mismo." });
  let valueRows: ValueRow[];
  try {
    valueRows = buildValueRows(payload, poll.options.map((o) => o.id));
  } catch (e) {
    if (e instanceof ResponseError) throw new TRPCError({ code: "BAD_REQUEST", message: e.message });
    throw e;
  }
  const canChange = canRespondAgain(poll);
  const ins = await header(sql`INSERT IGNORE INTO community_poll_responses (poll_id, user_id, responded_at, updated_at) VALUES (${poll.id}, ${userId}, ${now}, ${now})`);
  const first = ins.affectedRows === 1;
  const [resp] = await rows<{ id: number }>(sql`SELECT id FROM community_poll_responses WHERE poll_id = ${poll.id} AND user_id = ${userId}`);
  const responseId = n(resp.id);
  let revision = 1;
  if (!first) {
    // Carrera o segunda respuesta: misma regla que si se hubiera visto antes (Segolife)
    if (!canChange) throw new TRPCError({ code: "CONFLICT", message: "Ya has respondido y esta encuesta no admite cambios." });
    const [rev] = await rows<{ r: number | null }>(sql`SELECT MAX(revision) AS r FROM community_poll_values WHERE response_id = ${responseId}`);
    revision = n(rev?.r) + 1;
    await header(sql`UPDATE community_poll_values SET current = 0 WHERE response_id = ${responseId} AND current = 1`);
    await header(sql`UPDATE community_poll_responses SET updated_at = ${now} WHERE id = ${responseId}`);
  }
  await header(sql`INSERT INTO community_poll_values (response_id, poll_id, revision, current, option_id, value_text, value_number, created_at) VALUES ${sql.join(
    valueRows.map((v) => sql`(${responseId}, ${poll.id}, ${revision}, 1, ${v.optionId}, ${v.valueText}, ${v.valueNumber}, ${now})`),
    sql`, `,
  )}`);
  if (first) await emit({ key: `member.responded:${poll.id}:${userId}`, type: "member.responded", communityId: poll.communityId, userId, targetType: "poll", targetId: poll.id, data: { questionType: poll.questionType }, now });
  return { first };
}

export async function setValueModeration(valueId: number, patch: { hidden?: boolean; featured?: boolean }): Promise<number> {
  const [v] = await rows<{ poll_id: number }>(sql`SELECT poll_id FROM community_poll_values WHERE id = ${valueId}`);
  if (!v) throw new TRPCError({ code: "NOT_FOUND", message: "Respuesta no encontrada." });
  if (patch.hidden !== undefined) await header(sql`UPDATE community_poll_values SET hidden = ${patch.hidden ? 1 : 0} WHERE id = ${valueId}`);
  if (patch.featured !== undefined) await header(sql`UPDATE community_poll_values SET featured = ${patch.featured ? 1 : 0} WHERE id = ${valueId}`);
  return n(v.poll_id);
}

// ─── Resultados (communityResultsService.ts) ──────────────────────────────────

export interface OptionCount {
  optionId: number;
  label: string;
  count: number;
  percentage: number;
}

export interface PollResults {
  totalResponses: number;
  totalAudience: number;
  participationRate: number;
  singleChoice?: OptionCount[];
  multiselect?: OptionCount[];
  yesNo?: { yes: number; no: number; yesPercentage: number };
  percentageScale?: Array<{ optionId: number; label: string; average: number; count: number }>;
  scale15?: { average: number; distribution: Record<number, number> };
  ranking?: Array<{ optionId: number; label: string; averageRank: number; topChoiceCount: number }>;
  attendanceIntention?: { breakdown: Record<string, number>; predictedInterested: number; predictedStrongIntent: number };
  meApunto?: { count: number };
  openText?: Array<{ id: number; text: string; featured: boolean; hidden: boolean; createdAt: number }>;
  score: ReturnType<typeof communityScore>;
}

/** Resultados agregados en el servidor. La audiencia son los miembros activos de la comunidad. */
export async function pollResults(poll: Poll, includeHidden: boolean): Promise<PollResults> {
  const [tot] = await rows<{ c: number }>(sql`SELECT COUNT(*) AS c FROM community_poll_responses WHERE poll_id = ${poll.id}`);
  const [aud] = await rows<{ c: number }>(sql`SELECT COUNT(*) AS c FROM community_members WHERE community_id = ${poll.communityId} AND status = 'active'`);
  const totalResponses = n(tot?.c);
  const totalAudience = Math.max(n(aud?.c), totalResponses);
  const pct = (a: number, d: number) => (d > 0 ? Math.round((a / d) * 100) : 0);
  const cur = sql`poll_id = ${poll.id} AND current = 1`;
  const out: Omit<PollResults, "score"> = { totalResponses, totalAudience, participationRate: pct(totalResponses, totalAudience) };
  const opts = poll.options;
  switch (poll.questionType) {
    case "single_choice":
    case "multiselect": {
      const r = await rows<{ option_id: number; c: number }>(sql`SELECT option_id, COUNT(*) AS c FROM community_poll_values WHERE ${cur} GROUP BY option_id`);
      const items = opts.map((o) => {
        const c = n(r.find((x) => n(x.option_id) === o.id)?.c);
        return { optionId: o.id, label: o.label, count: c, percentage: pct(c, totalResponses) };
      });
      if (poll.questionType === "single_choice") out.singleChoice = items;
      else out.multiselect = items;
      break;
    }
    case "yes_no": {
      const r = await rows<{ v: string; c: number }>(sql`SELECT value_text AS v, COUNT(*) AS c FROM community_poll_values WHERE ${cur} GROUP BY value_text`);
      const yes = n(r.find((x) => x.v === "yes")?.c);
      out.yesNo = { yes, no: n(r.find((x) => x.v === "no")?.c), yesPercentage: pct(yes, totalResponses) };
      break;
    }
    case "percentage_scale": {
      const r = await rows<{ option_id: number; a: string; c: number }>(sql`SELECT option_id, AVG(value_number) AS a, COUNT(*) AS c FROM community_poll_values WHERE ${cur} GROUP BY option_id`);
      out.percentageScale = opts.map((o) => {
        const f = r.find((x) => n(x.option_id) === o.id);
        return { optionId: o.id, label: o.label, average: f ? Math.round(Number(f.a)) : 0, count: n(f?.c) };
      });
      break;
    }
    case "scale_1_5": {
      const r = await rows<{ v: number; c: number }>(sql`SELECT value_number AS v, COUNT(*) AS c FROM community_poll_values WHERE ${cur} GROUP BY value_number`);
      const distribution: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
      let sum = 0;
      for (const x of r) {
        const v = n(x.v);
        if (v >= 1 && v <= 5) {
          distribution[v] = n(x.c);
          sum += v * n(x.c);
        }
      }
      out.scale15 = { average: totalResponses > 0 ? Math.round((sum / totalResponses) * 10) / 10 : 0, distribution };
      break;
    }
    case "ranking": {
      const r = await rows<{ option_id: number; a: string; top: number }>(sql`SELECT option_id, AVG(value_number) AS a, SUM(value_number = 1) AS top FROM community_poll_values WHERE ${cur} GROUP BY option_id`);
      out.ranking = opts
        .map((o) => {
          const f = r.find((x) => n(x.option_id) === o.id);
          return { optionId: o.id, label: o.label, averageRank: f ? Math.round(Number(f.a) * 10) / 10 : 0, topChoiceCount: n(f?.top) };
        })
        .sort((a, z) => (a.averageRank || Infinity) - (z.averageRank || Infinity));
      break;
    }
    case "attendance_intention": {
      const r = await rows<{ v: number; c: number }>(sql`SELECT value_number AS v, COUNT(*) AS c FROM community_poll_values WHERE ${cur} GROUP BY value_number`);
      const breakdown: Record<string, number> = Object.fromEntries(ATTENDANCE_VALUES.map((v) => [v, 0]));
      let predicted = 0;
      for (const x of r) {
        const v = attendanceFromCode(n(x.v));
        breakdown[v] = n(x.c);
        predicted += n(x.c) * ATTENDANCE_WEIGHTS[v];
      }
      out.attendanceIntention = { breakdown, predictedInterested: Math.round(predicted), predictedStrongIntent: breakdown.definitely };
      break;
    }
    case "me_apunto":
      out.meApunto = { count: totalResponses };
      break;
    case "open_text": {
      const hidden = includeHidden ? sql`` : sql` AND hidden = 0`;
      const r = await rows<{ id: number; value_text: string | null; featured: number; hidden: number; created_at: number }>(sql`SELECT id, value_text, featured, hidden, created_at FROM community_poll_values WHERE ${cur}${hidden} ORDER BY featured DESC, created_at DESC LIMIT 500`);
      out.openText = r.map((x) => ({ id: n(x.id), text: x.value_text ?? "", featured: b(x.featured), hidden: b(x.hidden), createdAt: n(x.created_at) }));
      break;
    }
  }
  // Puntuación de la comunidad: positivos por respuesta (sin N+1: todos los valores vigentes de una vez)
  let positive: number | null = null;
  let strong: number | null = null;
  if (["yes_no", "attendance_intention", "me_apunto", "single_choice"].includes(poll.questionType) && totalResponses > 0) {
    const vals = await rows<{ response_id: number; option_id: number | null; value_text: string | null; value_number: number | null }>(sql`SELECT response_id, option_id, value_text, value_number FROM community_poll_values WHERE ${cur}`);
    const byResp = new Map<number, ValueRow[]>();
    for (const v of vals) {
      const arr = byResp.get(n(v.response_id)) ?? [];
      arr.push({ optionId: v.option_id == null ? null : n(v.option_id), valueText: v.value_text, valueNumber: v.value_number == null ? null : n(v.value_number) });
      byResp.set(n(v.response_id), arr);
    }
    const positiveIds = new Set(poll.options.filter((o) => o.isPositiveIntent).map((o) => o.id));
    const flags = Array.from(byResp.values()).map((v) => isPositiveRespondent(poll.questionType, v, positiveIds));
    if (flags.some((f) => f !== null)) positive = flags.filter((f) => f === true).length;
    if (poll.questionType === "attendance_intention") strong = out.attendanceIntention?.breakdown.definitely ?? 0;
    if (poll.questionType === "me_apunto") strong = totalResponses;
  }
  const times = await rows<{ t: number }>(sql`SELECT responded_at AS t FROM community_poll_responses WHERE poll_id = ${poll.id}`);
  const score = communityScore({ totalResponses, totalAudience, positiveRespondents: positive, strongIntentRespondents: strong, medianResponseMinutes: medianMinutes(poll.publishedAt, times.map((x) => n(x.t))) });
  return { ...out, score };
}

// ─── Propuestas de miembros ───────────────────────────────────────────────────

export interface Proposal {
  id: number;
  communityId: number;
  authorUserId: number;
  authorName: string;
  title: string;
  description: string | null;
  proposedQuestionType: QuestionType | null;
  proposedOptions: string[];
  status: ProposalStatus;
  reasonForMember: string | null;
  internalNote: string | null;
  convertedPollId: number | null;
  createdAt: number;
  supports: number;
  supportedByMe: boolean;
  isOwn: boolean;
}

const PROPOSAL_SELECT = sql`SELECT p.*, COALESCE(cl.name, u.name, u.email) AS author_name FROM community_proposals p LEFT JOIN users u ON u.id = p.author_user_id
  LEFT JOIN community_members mm ON mm.community_id = p.community_id AND mm.user_id = p.author_user_id LEFT JOIN clients cl ON cl.id = mm.client_id`;

function parseOptions(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === "string") {
    try {
      const p = JSON.parse(v);
      return Array.isArray(p) ? p.map(String) : [];
    } catch {
      return [];
    }
  }
  return [];
}

async function toProposals(list: Record<string, unknown>[], viewerId: number): Promise<Proposal[]> {
  if (!list.length) return [];
  const pids = list.map((r) => n(r.id));
  const sup = await rows<{ proposal_id: number; c: number; mine: number }>(sql`SELECT proposal_id, COUNT(*) AS c, SUM(user_id = ${viewerId}) AS mine FROM community_proposal_supports WHERE active = 1 AND proposal_id IN (${ids(pids)}) GROUP BY proposal_id`);
  return list.map((r) => {
    const s = sup.find((x) => n(x.proposal_id) === n(r.id));
    return {
      id: n(r.id),
      communityId: n(r.community_id),
      authorUserId: n(r.author_user_id),
      authorName: String(r.author_name || `Usuario ${n(r.author_user_id)}`),
      title: String(r.title),
      description: (r.description as string | null) ?? null,
      proposedQuestionType: (r.proposed_question_type as QuestionType | null) ?? null,
      proposedOptions: parseOptions(r.proposed_options),
      status: String(r.status) as ProposalStatus,
      reasonForMember: (r.reason_for_member as string | null) ?? null,
      internalNote: (r.internal_note as string | null) ?? null,
      convertedPollId: r.converted_poll_id == null ? null : n(r.converted_poll_id),
      createdAt: n(r.created_at),
      supports: n(s?.c),
      supportedByMe: n(s?.mine) > 0,
      isOwn: n(r.author_user_id) === viewerId,
    };
  });
}

export async function getProposal(id: number, viewerId = 0): Promise<Proposal | null> {
  const [r] = await rows<Record<string, unknown>>(sql`${PROPOSAL_SELECT} WHERE p.id = ${id}`);
  return r ? (await toProposals([r], viewerId))[0] : null;
}

export async function requireProposal(id: number, viewerId = 0): Promise<Proposal> {
  const p = await getProposal(id, viewerId);
  if (!p) throw new TRPCError({ code: "NOT_FOUND", message: "Propuesta no encontrada." });
  return p;
}

/** Los miembros ven las aprobadas y convertidas, y las suyas; la moderación, todas. Más apoyadas primero. */
export async function listProposals(communityId: number, viewerId: number, opts: { moderate: boolean; status?: ProposalStatus }): Promise<Proposal[]> {
  const conds: SQL[] = [sql`p.community_id = ${communityId}`];
  if (opts.status) conds.push(sql`p.status = ${opts.status}`);
  if (!opts.moderate) conds.push(sql`(p.status IN ('approved', 'converted') OR p.author_user_id = ${viewerId})`);
  const list = await rows<Record<string, unknown>>(sql`${PROPOSAL_SELECT} WHERE ${sql.join(conds, sql` AND `)} ORDER BY p.created_at DESC LIMIT 200`);
  const out = await toProposals(list, viewerId);
  const rank = (s: ProposalStatus) => ({ pending: 0, approved: 1, converted: 2, rejected: 3 })[s];
  return out.sort((a, z) => rank(a.status) - rank(z.status) || z.supports - a.supports || z.createdAt - a.createdAt);
}

export interface ProposalInput {
  title: string;
  description: string | null;
  proposedQuestionType: QuestionType | null;
  proposedOptions: string[];
}

export async function submitProposal(community: Community, userId: number, input: ProposalInput): Promise<Proposal> {
  const now = Date.now();
  const { insertId } = await header(sql`INSERT INTO community_proposals (community_id, author_user_id, title, description, proposed_question_type, proposed_options, status, created_at, updated_at)
    VALUES (${community.id}, ${userId}, ${input.title}, ${input.description}, ${input.proposedQuestionType}, ${input.proposedOptions.length ? JSON.stringify(input.proposedOptions) : null}, 'pending', ${now}, ${now})`);
  await emit({ key: `member.proposed:${insertId}`, type: "member.proposed", communityId: community.id, userId, targetType: "proposal", targetId: insertId, now });
  return (await getProposal(insertId, userId))!;
}

/** Apoyar o retirar el apoyo (uno por persona). `member.supported` se emite una sola vez por persona y propuesta. */
export async function toggleSupport(proposal: Proposal, userId: number): Promise<{ supported: boolean; count: number }> {
  if (!canSupportProposal(proposal.status)) throw new TRPCError({ code: "BAD_REQUEST", message: "Esta propuesta ya no admite apoyos." });
  const now = Date.now();
  const [existing] = await rows<{ id: number; active: number }>(sql`SELECT id, active FROM community_proposal_supports WHERE proposal_id = ${proposal.id} AND user_id = ${userId}`);
  let supported: boolean;
  if (existing) {
    supported = !b(existing.active);
    await header(sql`UPDATE community_proposal_supports SET active = ${supported ? 1 : 0}, updated_at = ${now} WHERE id = ${existing.id}`);
  } else {
    await header(sql`INSERT IGNORE INTO community_proposal_supports (proposal_id, user_id, active, created_at, updated_at) VALUES (${proposal.id}, ${userId}, 1, ${now}, ${now})`);
    supported = true;
  }
  if (supported) await emit({ key: `member.supported:${proposal.id}:${userId}`, type: "member.supported", communityId: proposal.communityId, userId, targetType: "proposal", targetId: proposal.id, now });
  const [c] = await rows<{ c: number }>(sql`SELECT COUNT(*) AS c FROM community_proposal_supports WHERE proposal_id = ${proposal.id} AND active = 1`);
  return { supported, count: n(c?.c) };
}

export async function moderateProposal(proposal: Proposal, action: "approve" | "reject", reasonForMember: string | null, internalNote: string | null, actorId: number): Promise<void> {
  if (proposal.status === "converted") throw new TRPCError({ code: "BAD_REQUEST", message: "La propuesta ya se convirtió en encuesta." });
  const status: ProposalStatus = action === "approve" ? "approved" : "rejected";
  if (proposal.status === status) return;
  const now = Date.now();
  await header(sql`UPDATE community_proposals SET status = ${status}, reason_for_member = ${action === "reject" ? reasonForMember : null}, internal_note = ${internalNote}, moderated_by = ${actorId}, moderated_at = ${now}, updated_at = ${now} WHERE id = ${proposal.id}`);
  const type = action === "approve" ? "proposal.approved" : "proposal.rejected";
  await emit({ key: `${type}:${proposal.id}:${now}`, type, communityId: proposal.communityId, userId: actorId, targetType: "proposal", targetId: proposal.id, data: { authorUserId: proposal.authorUserId }, now });
}

/** Convierte la propuesta en una encuesta formal (la administración decide la configuración final). */
export async function convertProposal(proposal: Proposal, input: PollInput, publish: boolean, actorId: number): Promise<Poll> {
  if (proposal.status === "converted" || proposal.status === "rejected") throw new TRPCError({ code: "BAD_REQUEST", message: "Esta propuesta no se puede convertir." });
  const poll = await createPoll(proposal.communityId, input, { publish, actorId, sourceProposalId: proposal.id });
  const now = Date.now();
  await header(sql`UPDATE community_proposals SET status = 'converted', converted_poll_id = ${poll.id}, moderated_by = ${actorId}, moderated_at = ${now}, updated_at = ${now} WHERE id = ${proposal.id}`);
  await emit({ key: `proposal.converted:${proposal.id}`, type: "proposal.converted", communityId: proposal.communityId, userId: actorId, targetType: "proposal", targetId: proposal.id, data: { authorUserId: proposal.authorUserId, pollId: poll.id }, now });
  return poll;
}

// ─── Reportes ─────────────────────────────────────────────────────────────────

/** Comunidad del elemento reportado (para comprobar que quien reporta es miembro). */
export async function reportTargetCommunity(target: ReportTarget, targetId: number): Promise<{ communityId: number; authorUserId: number } | null> {
  if (target === "post") {
    const p = await getPost(targetId);
    return p ? { communityId: p.communityId, authorUserId: p.authorUserId } : null;
  }
  if (target === "comment") {
    const c = await getComment(targetId);
    return c ? { communityId: c.communityId, authorUserId: c.authorUserId } : null;
  }
  const p = await getProposal(targetId);
  return p ? { communityId: p.communityId, authorUserId: p.authorUserId } : null;
}

/** Un reporte por persona y elemento (repetirlo no duplica). */
export async function createReport(communityId: number, target: ReportTarget, targetId: number, reporterId: number, reason: ReportReason, details: string | null): Promise<{ created: boolean }> {
  const r = await header(sql`INSERT IGNORE INTO community_reports (community_id, target_type, target_id, reporter_user_id, reason, details, status, created_at)
    VALUES (${communityId}, ${target}, ${targetId}, ${reporterId}, ${reason}, ${details}, 'open', ${Date.now()})`);
  return { created: r.affectedRows === 1 };
}

export interface ReportGroup {
  targetType: ReportTarget;
  targetId: number;
  preview: string;
  authorName: string | null;
  reports: number;
  reasons: Record<string, number>;
  details: string[];
  status: ReportStatus;
  firstAt: number;
  targetHidden: boolean;
}

/** Reportes agrupados por elemento (lo más reportado primero). */
export async function listReports(communityId: number, status: ReportStatus = "open"): Promise<ReportGroup[]> {
  const list = await rows<{ target_type: string; target_id: number; reason: string; details: string | null; created_at: number }>(sql`SELECT target_type, target_id, reason, details, created_at FROM community_reports WHERE community_id = ${communityId} AND status = ${status} ORDER BY created_at ASC LIMIT 1000`);
  const groups = new Map<string, ReportGroup>();
  for (const r of list) {
    const k = `${r.target_type}:${r.target_id}`;
    const g = groups.get(k) ?? { targetType: r.target_type as ReportTarget, targetId: n(r.target_id), preview: "", authorName: null, reports: 0, reasons: {}, details: [], status, firstAt: n(r.created_at), targetHidden: false };
    g.reports++;
    g.reasons[r.reason] = (g.reasons[r.reason] ?? 0) + 1;
    if (r.details) g.details.push(r.details);
    groups.set(k, g);
  }
  for (const g of Array.from(groups.values())) {
    if (g.targetType === "post") {
      const p = await getPost(g.targetId);
      g.preview = p ? (p.title ? `${p.title} — ` : "") + p.body.slice(0, 200) : "(no disponible)";
      g.authorName = p?.authorName ?? null;
      g.targetHidden = p?.status === "hidden";
    } else if (g.targetType === "comment") {
      const c = await getComment(g.targetId);
      g.preview = c ? c.body.slice(0, 200) : "(no disponible)";
      g.authorName = c?.authorName ?? null;
      g.targetHidden = !!c?.hidden;
    } else {
      const p = await getProposal(g.targetId);
      g.preview = p ? p.title : "(no disponible)";
      g.authorName = p?.authorName ?? null;
      g.targetHidden = p?.status === "rejected";
    }
  }
  return Array.from(groups.values()).sort((a, z) => z.reports - a.reports || a.firstAt - z.firstAt);
}

/** Resolver todos los reportes abiertos de un elemento: ocultarlo (o rechazar la propuesta) o descartarlos. */
export async function resolveReports(communityId: number, target: ReportTarget, targetId: number, action: "hide" | "dismiss", actorId: number): Promise<number> {
  const now = Date.now();
  if (action === "hide") {
    if (target === "post") {
      const p = await getPost(targetId);
      if (p && p.communityId === communityId) await setPostStatus(p, "hidden", actorId, "Ocultada por reportes de la comunidad");
    } else if (target === "comment") {
      const c = await getComment(targetId);
      if (c && c.communityId === communityId) await setCommentHidden(c, true, actorId);
    } else {
      const p = await getProposal(targetId);
      if (p && p.communityId === communityId && p.status !== "converted") await moderateProposal(p, "reject", "Retirada por la moderación", "Reportes de la comunidad", actorId);
    }
  }
  const status: ReportStatus = action === "hide" ? "resolved" : "dismissed";
  const r = await header(sql`UPDATE community_reports SET status = ${status}, resolved_by = ${actorId}, resolved_at = ${now} WHERE community_id = ${communityId} AND target_type = ${target} AND target_id = ${targetId} AND status = 'open'`);
  if (r.affectedRows > 0) {
    const type = action === "hide" ? "report.resolved" : "report.dismissed";
    await emit({ key: `${type}:${target}:${targetId}:${now}`, type, communityId, userId: actorId, targetType: target, targetId, data: { reports: r.affectedRows }, now });
  }
  return r.affectedRows;
}

// ─── Pendientes (campana del panel) ───────────────────────────────────────────

export interface CommunityPending {
  communityId: number;
  name: string;
  members: number;
  posts: number;
  proposals: number;
  reports: number;
}

/** Lo que espera revisión en cada comunidad activa: solicitudes, publicaciones, propuestas y reportes. */
export async function pendingByCommunity(): Promise<CommunityPending[]> {
  const list = await rows<{ id: number; name: string; m: number; p: number; pr: number; r: number }>(sql`SELECT c.id, c.name,
    (SELECT COUNT(*) FROM community_members m WHERE m.community_id = c.id AND m.status = 'pending') AS m,
    (SELECT COUNT(*) FROM community_posts p WHERE p.community_id = c.id AND p.status = 'pending') AS p,
    (SELECT COUNT(*) FROM community_proposals x WHERE x.community_id = c.id AND x.status = 'pending') AS pr,
    (SELECT COUNT(DISTINCT target_type, target_id) FROM community_reports r WHERE r.community_id = c.id AND r.status = 'open') AS r
    FROM communities c WHERE c.status = 'active'`);
  return list
    .map((x) => ({ communityId: n(x.id), name: x.name, members: n(x.m), posts: n(x.p), proposals: n(x.pr), reports: n(x.r) }))
    .filter((x) => x.members + x.posts + x.proposals + x.reports > 0);
}
