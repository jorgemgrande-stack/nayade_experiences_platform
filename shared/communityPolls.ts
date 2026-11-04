/**
 * Social Token Net · Comunidades — encuestas, preguntas y propuestas de miembros: lógica pura (sin BD ni React).
 *
 * Reutilizado de Segolife (server/segolife/community), sin universidades ni estudiantes:
 *  - Los 9 tipos de pregunta y su validación de opciones (communityQuestionTypeValidation.ts).
 *  - Las filas de valor de cada respuesta y su validación (communityResponseService.ts::buildValueRows), «me apunto»
 *    como compromiso de un solo uso (canStudentRespondAgain → canRespondAgain).
 *  - Intención de asistencia con códigos y pesos, y «respondente positivo» (communityIntentService.ts).
 *  - Ventana de respuesta y visibilidad de resultados (communityDb.ts::isProposalOpenForResponses,
 *    computeResultsVisible). Sin planificador: el estado efectivo se calcula al leer (programada / abierta / cerrada).
 *  - Puntuación de la comunidad sobre una pregunta (communityScoreService.ts::computeCommunityScore).
 *  - Las «ideas de estudiantes» pasan a ser PROPUESTAS DE MIEMBROS (communityStudentProposalDb.ts): moderación,
 *    apoyos y conversión en encuesta formal.
 */

// ─── Tipos de pregunta ────────────────────────────────────────────────────────

export const QUESTION_TYPES = ["single_choice", "yes_no", "percentage_scale", "scale_1_5", "multiselect", "ranking", "attendance_intention", "me_apunto", "open_text"] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];
export const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  single_choice: "Elección única",
  yes_no: "Sí o no",
  percentage_scale: "Valoración de 0 a 100 por criterio",
  scale_1_5: "Escala del 1 al 5",
  multiselect: "Elección múltiple",
  ranking: "Ordenar por preferencia",
  attendance_intention: "Intención de asistencia",
  me_apunto: "Me apunto",
  open_text: "Respuesta libre",
};

/** Únicos tipos con opciones configurables; el resto tiene respuestas fijas en código. */
export const QUESTION_TYPES_WITH_OPTIONS: readonly QuestionType[] = ["single_choice", "multiselect", "ranking", "percentage_scale"];
export const MIN_OPTIONS = 2;
export const MAX_OPTIONS = 20;
export const OPTION_MAX = 200;
export const OPEN_TEXT_MAX = 1000;

export interface OptionsValidation {
  ok: boolean;
  error?: string;
  cleanOptions: string[];
}

/** Coherencia entre tipo y opciones (la misma regla para la administración y para las propuestas de miembros). */
export function validateQuestionOptions(type: QuestionType, options: string[] | null | undefined): OptionsValidation {
  const cleanOptions = (options ?? []).map((o) => o.replace(/<[^>]*>/g, "").trim().slice(0, OPTION_MAX)).filter(Boolean);
  if (QUESTION_TYPES_WITH_OPTIONS.includes(type)) {
    if (cleanOptions.length < MIN_OPTIONS) return { ok: false, error: `Este tipo de pregunta necesita al menos ${MIN_OPTIONS} opciones`, cleanOptions };
    if (cleanOptions.length > MAX_OPTIONS) return { ok: false, error: `Máximo ${MAX_OPTIONS} opciones`, cleanOptions };
    if (new Set(cleanOptions.map((o) => o.toLowerCase())).size !== cleanOptions.length) return { ok: false, error: "Hay opciones repetidas", cleanOptions };
    return { ok: true, cleanOptions };
  }
  if (cleanOptions.length > 0) return { ok: false, error: "Este tipo de pregunta no admite opciones", cleanOptions: [] };
  return { ok: true, cleanOptions: [] };
}

// ─── Intención de asistencia ──────────────────────────────────────────────────

export const ATTENDANCE_VALUES = ["no", "maybe", "probably", "definitely"] as const;
export type AttendanceValue = (typeof ATTENDANCE_VALUES)[number];
export const ATTENDANCE_LABELS: Record<AttendanceValue, string> = { no: "No iré", maybe: "Quizá", probably: "Probablemente", definitely: "Seguro que voy" };
/** Código guardado en value_number. */
export const ATTENDANCE_CODES: Record<AttendanceValue, number> = { no: 0, maybe: 1, probably: 2, definitely: 3 };
/** Peso analítico 0-1 (heurística inicial de Segolife; siempre se muestra junto al dato bruto). */
export const ATTENDANCE_WEIGHTS: Record<AttendanceValue, number> = { no: 0, maybe: 0.35, probably: 0.7, definitely: 1 };
export const attendanceFromCode = (code: number): AttendanceValue => ATTENDANCE_VALUES[code] ?? "no";
export const isPositiveAttendance = (v: AttendanceValue) => v === "probably" || v === "definitely";

// ─── Respuestas ───────────────────────────────────────────────────────────────

export type ResponsePayload =
  | { questionType: "single_choice"; optionId: number }
  | { questionType: "yes_no"; value: "yes" | "no" }
  | { questionType: "percentage_scale"; values: Array<{ optionId: number; value: number }> }
  | { questionType: "scale_1_5"; value: number }
  | { questionType: "multiselect"; optionIds: number[] }
  | { questionType: "ranking"; orderedOptionIds: number[] }
  | { questionType: "attendance_intention"; value: AttendanceValue }
  | { questionType: "me_apunto" }
  | { questionType: "open_text"; text: string };

export interface ValueRow {
  optionId: number | null;
  valueText: string | null;
  valueNumber: number | null;
}

export class ResponseError extends Error {
  constructor(public code: "INVALID_PAYLOAD" | "CLOSED" | "ALREADY_RESPONDED", message: string) {
    super(message);
    this.name = "ResponseError";
  }
}

/** Texto libre sin etiquetas, recortado y acotado (sanitizeOpenText de Segolife). */
export const sanitizeOpenText = (raw: string) => raw.replace(/<[^>]*>/g, "").trim().slice(0, OPEN_TEXT_MAX);

/** Filas de valor de una respuesta (una por opción marcada, ordenada o puntuada). Lanza ResponseError si no es válida. */
export function buildValueRows(payload: ResponsePayload, optionIds: number[]): ValueRow[] {
  const valid = new Set(optionIds);
  const bad = (m: string): never => {
    throw new ResponseError("INVALID_PAYLOAD", m);
  };
  switch (payload.questionType) {
    case "single_choice":
      if (!valid.has(payload.optionId)) bad("Opción no válida para esta pregunta");
      return [{ optionId: payload.optionId, valueText: null, valueNumber: null }];
    case "yes_no":
      if (payload.value !== "yes" && payload.value !== "no") bad("Respuesta no válida");
      return [{ optionId: null, valueText: payload.value, valueNumber: null }];
    case "percentage_scale":
      if (!payload.values.length) bad("Puntúa al menos un criterio");
      if (new Set(payload.values.map((v) => v.optionId)).size !== payload.values.length) bad("Criterios repetidos");
      for (const v of payload.values) {
        if (!valid.has(v.optionId)) bad("Criterio no válido para esta pregunta");
        if (!Number.isInteger(v.value) || v.value < 0 || v.value > 100) bad("Cada criterio se puntúa de 0 a 100");
      }
      return payload.values.map((v) => ({ optionId: v.optionId, valueText: null, valueNumber: v.value }));
    case "scale_1_5":
      if (!Number.isInteger(payload.value) || payload.value < 1 || payload.value > 5) bad("El valor debe ser un número entero del 1 al 5");
      return [{ optionId: null, valueText: null, valueNumber: payload.value }];
    case "multiselect":
      if (!payload.optionIds.length) bad("Elige al menos una opción");
      if (new Set(payload.optionIds).size !== payload.optionIds.length) bad("Opciones repetidas");
      for (const id of payload.optionIds) if (!valid.has(id)) bad("Opción no válida para esta pregunta");
      return payload.optionIds.map((id) => ({ optionId: id, valueText: null, valueNumber: null }));
    case "ranking":
      if (payload.orderedOptionIds.length !== optionIds.length) bad("Ordena todas las opciones");
      if (new Set(payload.orderedOptionIds).size !== payload.orderedOptionIds.length) bad("Opciones repetidas en el orden");
      for (const id of payload.orderedOptionIds) if (!valid.has(id)) bad("Opción no válida para esta pregunta");
      return payload.orderedOptionIds.map((id, i) => ({ optionId: id, valueText: null, valueNumber: i + 1 }));
    case "attendance_intention": {
      const code = ATTENDANCE_CODES[payload.value];
      if (code === undefined) bad("Intención de asistencia no válida");
      return [{ optionId: null, valueText: payload.value, valueNumber: code }];
    }
    case "me_apunto":
      return [{ optionId: null, valueText: "me_apunto", valueNumber: null }];
    case "open_text": {
      const text = sanitizeOpenText(payload.text);
      if (!text) bad("La respuesta no puede estar vacía");
      return [{ optionId: null, valueText: text, valueNumber: null }];
    }
  }
}

/** «Me apunto» es un compromiso de un solo uso: nunca se cambia, diga lo que diga la configuración. */
export function canRespondAgain(poll: { questionType: QuestionType; allowChangeResponse: boolean }): boolean {
  return poll.questionType !== "me_apunto" && poll.allowChangeResponse;
}

// ─── Estado, ventana y resultados ─────────────────────────────────────────────

export const POLL_STATUSES = ["draft", "active", "closed", "cancelled"] as const;
export type PollStatus = (typeof POLL_STATUSES)[number];
export type EffectivePollStatus = PollStatus | "scheduled";
export const POLL_STATUS_LABELS: Record<EffectivePollStatus, string> = { draft: "Borrador", scheduled: "Programada", active: "Abierta", closed: "Cerrada", cancelled: "Cancelada" };

export const RESULTS_VISIBILITY = ["immediate", "after_vote", "after_close", "never"] as const;
export type ResultsVisibility = (typeof RESULTS_VISIBILITY)[number];
export const RESULTS_VISIBILITY_LABELS: Record<ResultsVisibility, string> = {
  immediate: "Siempre visibles para los miembros",
  after_vote: "Visibles después de responder",
  after_close: "Visibles al cerrar",
  never: "Solo para la administración",
};

export interface PollWindow {
  status: PollStatus;
  startsAt: number | null;
  endsAt: number | null;
}

/** Estado efectivo: una abierta con inicio futuro está programada y una vencida está cerrada (sin planificador). */
export function effectiveStatus(p: PollWindow, now: number): EffectivePollStatus {
  if (p.status !== "active") return p.status;
  if (p.startsAt != null && p.startsAt > now) return "scheduled";
  if (p.endsAt != null && p.endsAt < now) return "closed";
  return "active";
}

export const isOpenForResponses = (p: PollWindow, now: number) => effectiveStatus(p, now) === "active";

export function resultsVisible(p: PollWindow & { resultsVisibility: ResultsVisibility }, hasResponded: boolean, now: number): boolean {
  const closed = effectiveStatus(p, now) === "closed";
  return p.resultsVisibility === "immediate" || (p.resultsVisibility === "after_vote" && (hasResponded || closed)) || (p.resultsVisibility === "after_close" && closed);
}

/** «Respondente positivo» según el tipo de pregunta; null si el tipo no tiene esa noción (nunca se infiere). */
export function isPositiveRespondent(type: QuestionType, values: ValueRow[], positiveOptionIds: Set<number>): boolean | null {
  switch (type) {
    case "yes_no":
      return values[0]?.valueText === "yes";
    case "attendance_intention":
      return values[0]?.valueNumber == null ? null : isPositiveAttendance(attendanceFromCode(values[0].valueNumber));
    case "me_apunto":
      return values.length > 0;
    case "single_choice":
      return values[0]?.optionId == null ? null : positiveOptionIds.has(values[0].optionId);
    default:
      return null;
  }
}

// ─── Puntuación de la comunidad (communityScoreService.ts) ────────────────────

export interface ScoreInput {
  totalResponses: number;
  totalAudience: number;
  positiveRespondents: number | null;
  strongIntentRespondents: number | null;
  medianResponseMinutes: number | null;
}

export interface ScoreDimension {
  key: "participation" | "positiveIntent" | "strongIntent" | "velocity" | "sampleQuality";
  label: string;
  rawValue: number;
  normalizedScore: number;
  weight: number;
}

const WEIGHTS = { participation: 0.25, positiveIntent: 0.3, strongIntent: 0.2, velocity: 0.15, sampleQuality: 0.1 } as const;
export const MIN_RESPONSES_FOR_SCORE = 3;
const SAMPLE_SATURATION = 20;
const VELOCITY_REFERENCE_MINUTES = 60;
const clamp = (v: number) => Math.max(0, Math.min(100, v));

export function communityScore(i: ScoreInput): { score: number; insufficientData: boolean; dimensions: ScoreDimension[] } {
  if (i.totalResponses < MIN_RESPONSES_FOR_SCORE) return { score: 0, insufficientData: true, dimensions: [] };
  const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);
  const dims: ScoreDimension[] = [];
  const part = pct(i.totalResponses, i.totalAudience);
  dims.push({ key: "participation", label: "Participación", weight: WEIGHTS.participation, rawValue: part, normalizedScore: clamp(part) });
  if (i.positiveRespondents !== null) {
    const v = pct(i.positiveRespondents, i.totalResponses);
    dims.push({ key: "positiveIntent", label: "Intención positiva", weight: WEIGHTS.positiveIntent, rawValue: v, normalizedScore: clamp(v) });
  }
  if (i.strongIntentRespondents !== null) {
    const v = pct(i.strongIntentRespondents, i.totalResponses);
    dims.push({ key: "strongIntent", label: "Intención fuerte", weight: WEIGHTS.strongIntent, rawValue: v, normalizedScore: clamp(v) });
  }
  if (i.medianResponseMinutes !== null) {
    dims.push({ key: "velocity", label: "Rapidez de respuesta", weight: WEIGHTS.velocity, rawValue: i.medianResponseMinutes, normalizedScore: clamp(Math.round(100 - (i.medianResponseMinutes / VELOCITY_REFERENCE_MINUTES) * 100)) });
  }
  dims.push({ key: "sampleQuality", label: "Tamaño de la muestra", weight: WEIGHTS.sampleQuality, rawValue: i.totalResponses, normalizedScore: clamp(Math.round((i.totalResponses / SAMPLE_SATURATION) * 100)) });
  const ws = dims.reduce((s, d) => s + d.weight, 0);
  return { score: Math.round(dims.reduce((s, d) => s + d.normalizedScore * d.weight, 0) / ws), insufficientData: false, dimensions: dims };
}

/** Mediana de minutos desde la publicación hasta cada respuesta (null sin respuestas o sin fecha de publicación). */
export function medianMinutes(publishedAt: number | null, respondedAt: number[]): number | null {
  if (publishedAt == null || !respondedAt.length) return null;
  const mins = respondedAt.map((t) => Math.max(0, (t - publishedAt) / 60_000)).sort((a, b) => a - b);
  const mid = Math.floor(mins.length / 2);
  return Math.round(mins.length % 2 ? mins[mid] : (mins[mid - 1] + mins[mid]) / 2);
}

// ─── Propuestas de miembros (antes «ideas de estudiantes») ────────────────────

export const PROPOSAL_STATUSES = ["pending", "approved", "rejected", "converted"] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];
export const PROPOSAL_STATUS_LABELS: Record<ProposalStatus, string> = { pending: "Pendiente de revisión", approved: "Aprobada", rejected: "Rechazada", converted: "Convertida en encuesta" };

/** Solo se apoyan las propuestas visibles para la comunidad (aprobadas) o pendientes de revisión, nunca rechazadas. */
export const canSupportProposal = (status: ProposalStatus) => status === "pending" || status === "approved";

// ─── Reportes de contenido ────────────────────────────────────────────────────

export const REPORT_TARGETS = ["post", "comment", "proposal"] as const;
export type ReportTarget = (typeof REPORT_TARGETS)[number];
export const REPORT_REASONS = ["spam", "offensive", "off_topic", "personal_data", "other"] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];
export const REPORT_REASON_LABELS: Record<ReportReason, string> = {
  spam: "Spam o publicidad",
  offensive: "Ofensivo o irrespetuoso",
  off_topic: "Fuera de tema",
  personal_data: "Datos personales de otra persona",
  other: "Otro motivo",
};
export const REPORT_STATUSES = ["open", "resolved", "dismissed"] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];
export const REPORT_STATUS_LABELS: Record<ReportStatus, string> = { open: "Pendiente", resolved: "Contenido ocultado", dismissed: "Descartado" };
