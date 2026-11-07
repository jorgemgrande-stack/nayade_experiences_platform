/**
 * Reglas de Ski Net · Escuela (lógica pura, sin BD). Portado y desacoplado del motor de planning de origen:
 * horario de la escuela, niveles, modalidades e idiomas y límites de carga son CONFIGURABLES por sede (con una
 * plantilla por defecto), no constantes. Reglas duras para asignar un profesor a una sesión:
 *   activo · modalidad · nivel · idioma · edad · jornada semanal declarada · ausencias · solape ·
 *   carga diaria máxima · sesiones consecutivas máximas · desplazamiento entre puntos de encuentro.
 * La «propuesta de profesor» solo ordena a los compatibles (menos carga ese día primero); no asigna nada.
 */

export interface CodeLabel {
  code: string;
  label: string;
}

export interface PlanningLimits {
  /** Sesiones máximas por profesor y día. */
  maxDailySessions: number;
  /** Sesiones seguidas sin hueco. */
  maxConsecutiveSessions: number;
  /** Minutos mínimos entre dos sesiones con distinto punto de encuentro. */
  minTransferMinutes: number;
}

export interface SchoolConfig {
  levels: CodeLabel[];
  modalities: CodeLabel[];
  languages: CodeLabel[];
  /** Horario de clases de la sede (HH:MM). */
  dayStart: string;
  dayEnd: string;
  limits: PlanningLimits;
}

/** Plantilla por defecto (la empresa la cambia por sede). */
export const DEFAULT_SCHOOL_CONFIG: SchoolConfig = {
  levels: [
    { code: "A", label: "Nivel A · Iniciación" },
    { code: "B", label: "Nivel B · Principiante" },
    { code: "C", label: "Nivel C · Intermedio" },
    { code: "D", label: "Nivel D · Avanzado" },
  ],
  modalities: [
    { code: "ski", label: "Esquí" },
    { code: "snowboard", label: "Snowboard" },
  ],
  languages: [
    { code: "es", label: "Español" },
    { code: "en", label: "Inglés" },
    { code: "fr", label: "Francés" },
    { code: "pt", label: "Portugués" },
  ],
  dayStart: "09:00",
  dayEnd: "17:00",
  limits: { maxDailySessions: 6, maxConsecutiveSessions: 4, minTransferMinutes: 15 },
};

export const PRODUCT_KINDS = ["private", "group", "kids"] as const;
export type ProductKind = (typeof PRODUCT_KINDS)[number];
export const PRODUCT_KIND_LABEL: Record<ProductKind, string> = { private: "Clase particular", group: "Cursillo / colectiva", kids: "Escuelita" };

export const SESSION_STATUSES = ["pending", "assigned", "completed", "cancelled"] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];

export const ABSENCE_KINDS = ["day_off", "partial_block"] as const;
export type AbsenceKind = (typeof ABSENCE_KINDS)[number];

export class RuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RuleError";
  }
}

// ── Fechas y horas ──────────────────────────────────────────────────────────────

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
export const MAX_RANGE_DAYS = 31;

export function isTime(t: string): boolean {
  return TIME_RE.test(t);
}

export function toMinutes(t: string): number {
  const m = TIME_RE.exec(t);
  if (!m) throw new RuleError(`Hora no válida: ${t}`);
  return Number(m[1]) * 60 + Number(m[2]);
}

export function fromMinutes(total: number): string {
  if (!Number.isInteger(total) || total < 0 || total >= 24 * 60) throw new RuleError("La hora resultante sale del día");
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/** Día (YYYY-MM-DD) → número de día UTC. Lanza si no es una fecha real. */
export function dayNumber(s: string): number {
  const m = DAY_RE.exec(s);
  if (!m) throw new RuleError(`Fecha no válida: ${s}`);
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (new Date(t).toISOString().slice(0, 10) !== s) throw new RuleError(`Fecha no válida: ${s}`);
  return t / 86_400_000;
}

/** Día de la semana (0 = domingo … 6 = sábado), independiente de la zona horaria del servidor. */
export function dayOfWeek(date: string): number {
  return new Date(dayNumber(date) * 86_400_000).getUTCDay();
}

export function checkRange(from: string, to: string): void {
  const a = dayNumber(from);
  const b = dayNumber(to);
  if (b < a) throw new RuleError("La fecha final es anterior a la inicial");
  if (b - a + 1 > MAX_RANGE_DAYS) throw new RuleError(`El rango no puede superar ${MAX_RANGE_DAYS} días`);
}

/** Solape estricto de dos franjas HH:MM (contiguas no se solapan). */
export function overlaps(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return aStart < bEnd && bStart < aEnd;
}

export function checkSlot(start: string, end: string, what = "La franja"): void {
  if (!isTime(start) || !isTime(end)) throw new RuleError(`${what}: hora no válida (HH:MM)`);
  if (end <= start) throw new RuleError(`${what}: la hora final debe ser posterior a la inicial`);
}

// ── Configuración ───────────────────────────────────────────────────────────────

const CODE_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,15}$/;

function codeList(list: unknown, what: string, max: number): CodeLabel[] {
  if (!Array.isArray(list) || list.length === 0) throw new RuleError(`${what}: indica al menos uno`);
  if (list.length > max) throw new RuleError(`${what}: como mucho ${max}`);
  const seen = new Set<string>();
  return list.map((x) => {
    const code = String((x as CodeLabel)?.code ?? "").trim();
    const label = String((x as CodeLabel)?.label ?? "").trim();
    if (!CODE_RE.test(code)) throw new RuleError(`${what}: código no válido (${code || "vacío"})`);
    if (seen.has(code.toLowerCase())) throw new RuleError(`${what}: código repetido (${code})`);
    seen.add(code.toLowerCase());
    if (label.length < 1 || label.length > 60) throw new RuleError(`${what}: nombre no válido para ${code}`);
    return { code, label };
  });
}

function intIn(v: unknown, min: number, max: number, what: string): number {
  if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > max) throw new RuleError(`${what}: entre ${min} y ${max}`);
  return v;
}

/** Configuración completa y válida a partir de la guardada (o de nada: plantilla por defecto). Lanza `RuleError`. */
export function normalizeConfig(raw: Partial<SchoolConfig> | null | undefined): SchoolConfig {
  const d = DEFAULT_SCHOOL_CONFIG;
  const r = raw ?? {};
  const dayStart = r.dayStart ?? d.dayStart;
  const dayEnd = r.dayEnd ?? d.dayEnd;
  checkSlot(dayStart, dayEnd, "Horario de la escuela");
  const l = { ...d.limits, ...(r.limits ?? {}) };
  return {
    levels: codeList(r.levels ?? d.levels, "Niveles", 12),
    modalities: codeList(r.modalities ?? d.modalities, "Modalidades", 6),
    languages: codeList(r.languages ?? d.languages, "Idiomas", 12),
    dayStart,
    dayEnd,
    limits: {
      maxDailySessions: intIn(l.maxDailySessions, 1, 20, "Sesiones máximas por día"),
      maxConsecutiveSessions: intIn(l.maxConsecutiveSessions, 1, 20, "Sesiones consecutivas máximas"),
      minTransferMinutes: intIn(l.minTransferMinutes, 0, 120, "Minutos de desplazamiento"),
    },
  };
}

/** Códigos declarados (sin repetir) que existen en la lista configurada. Lanza si alguno no existe. */
export function pickCodes(codes: string[] | undefined, allowed: CodeLabel[], what: string): string[] {
  const out: string[] = [];
  for (const c of codes ?? []) {
    const hit = allowed.find((a) => a.code.toLowerCase() === String(c).trim().toLowerCase());
    if (!hit) throw new RuleError(`${what}: «${c}» no está configurado en la escuela`);
    if (!out.includes(hit.code)) out.push(hit.code);
  }
  return out;
}

/** Un código opcional válido de la lista configurada (null = sin requisito). */
export function pickCode(code: string | null | undefined, allowed: CodeLabel[], what: string): string | null {
  if (code == null || code === "") return null;
  return pickCodes([code], allowed, what)[0];
}

// ── Disponibilidad y asignación ─────────────────────────────────────────────────

export interface WeeklySlot {
  /** 0 = domingo … 6 = sábado. */
  day: number;
  start: string;
  end: string;
}

/** Valida y ordena la jornada semanal (sin franjas solapadas el mismo día). */
export function normalizeWeekly(slots: WeeklySlot[]): WeeklySlot[] {
  if (slots.length > 42) throw new RuleError("Demasiadas franjas de disponibilidad");
  const out = slots.map((s) => {
    if (!Number.isInteger(s.day) || s.day < 0 || s.day > 6) throw new RuleError("Día de la semana no válido");
    checkSlot(s.start, s.end, "Disponibilidad");
    return { day: s.day, start: s.start, end: s.end };
  });
  out.sort((a, b) => a.day - b.day || a.start.localeCompare(b.start));
  for (let i = 1; i < out.length; i++) {
    if (out[i].day === out[i - 1].day && overlaps(out[i].start, out[i].end, out[i - 1].start, out[i - 1].end)) throw new RuleError("Hay franjas de disponibilidad solapadas el mismo día");
  }
  return out;
}

export interface InstructorProfile {
  id: number;
  fullName: string;
  active: boolean;
  /** Vacío = cualquier modalidad. */
  modalities: string[];
  /** Vacío = cualquier nivel. */
  levels: string[];
  /** Por orden de preferencia; vacío = no se evalúa. */
  languages: string[];
  minAge: number | null;
  maxAge: number | null;
  /** Vacío = sin jornada declarada (disponible en el horario de la escuela). */
  weekly: WeeklySlot[];
}

export interface AbsencePeriod {
  startDate: string;
  endDate: string;
  kind: AbsenceKind;
  /** Solo `partial_block`. */
  startTime: string | null;
  endTime: string | null;
}

export interface BusySession {
  id: number;
  startTime: string;
  endTime: string;
  meetingPoint: string | null;
}

export interface SlotRequest {
  date: string;
  startTime: string;
  endTime: string;
  modality: string | null;
  level: string | null;
  language: string | null;
  /** Edades de los alumnos inscritos (las desconocidas no cuentan). */
  ages: number[];
  meetingPoint: string | null;
}

export type Verdict = { ok: true; reasons: string[]; sessionsThatDay: number } | { ok: false; reason: string };

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Ausencias que tocan la fecha y franja pedidas. */
export function blockingAbsence(absences: AbsencePeriod[], date: string, start: string, end: string): AbsencePeriod | null {
  return (
    absences.find((a) => {
      if (a.startDate > date || a.endDate < date) return false;
      if (a.kind === "day_off") return true;
      return !!a.startTime && !!a.endTime && overlaps(start, end, a.startTime, a.endTime);
    }) ?? null
  );
}

/**
 * ¿Puede este profesor dar esta sesión? `busy` son SUS sesiones no canceladas de ese día (sin la propia sesión).
 * Devuelve el primer motivo de rechazo, con texto claro para el panel.
 */
export function evaluateInstructor(p: InstructorProfile, req: SlotRequest, absences: AbsencePeriod[], busy: BusySession[], limits: PlanningLimits): Verdict {
  if (!p.active) return { ok: false, reason: "el profesor está dado de baja" };
  if (req.modality && p.modalities.length > 0 && !p.modalities.some((m) => same(m, req.modality!))) return { ok: false, reason: `no imparte la modalidad ${req.modality}` };
  if (req.level && p.levels.length > 0 && !p.levels.some((l) => same(l, req.level!))) return { ok: false, reason: `no imparte el nivel ${req.level}` };
  if (req.language && p.languages.length > 0 && !p.languages.some((l) => same(l, req.language!))) return { ok: false, reason: `no habla el idioma de la clase (${req.language})` };
  for (const age of req.ages) {
    if (p.minAge != null && age < p.minAge) return { ok: false, reason: `hay un alumno por debajo de la edad mínima que enseña (${p.minAge})` };
    if (p.maxAge != null && age > p.maxAge) return { ok: false, reason: `hay un alumno por encima de la edad máxima que enseña (${p.maxAge})` };
  }

  const dow = dayOfWeek(req.date);
  const today = p.weekly.filter((w) => w.day === dow);
  if (p.weekly.length > 0 && !today.some((w) => w.start <= req.startTime && w.end >= req.endTime)) return { ok: false, reason: "fuera de su disponibilidad semanal" };

  const abs = blockingAbsence(absences, req.date, req.startTime, req.endTime);
  if (abs) return { ok: false, reason: abs.kind === "day_off" ? "tiene una ausencia ese día" : `tiene un bloqueo de ${abs.startTime} a ${abs.endTime}` };

  const clash = busy.find((s) => overlaps(req.startTime, req.endTime, s.startTime, s.endTime));
  if (clash) return { ok: false, reason: `se solapa con otra sesión suya (${clash.startTime}–${clash.endTime})` };
  if (busy.length + 1 > limits.maxDailySessions) return { ok: false, reason: `supera la carga máxima diaria (${limits.maxDailySessions} sesiones)` };

  const sorted = [...busy].sort((a, b) => a.startTime.localeCompare(b.startTime));
  const before = sorted.filter((s) => s.endTime <= req.startTime).pop() ?? null;
  const after = sorted.find((s) => s.startTime >= req.endTime) ?? null;
  const differs = (a: string | null, b: string | null) => !!a?.trim() && !!b?.trim() && !same(a, b);
  if (before && differs(before.meetingPoint, req.meetingPoint) && toMinutes(req.startTime) - toMinutes(before.endTime) < limits.minTransferMinutes) {
    return { ok: false, reason: `no le da tiempo a desplazarse desde la sesión anterior (mínimo ${limits.minTransferMinutes} min)` };
  }
  if (after && differs(after.meetingPoint, req.meetingPoint) && toMinutes(after.startTime) - toMinutes(req.endTime) < limits.minTransferMinutes) {
    return { ok: false, reason: `no le da tiempo a desplazarse a la sesión siguiente (mínimo ${limits.minTransferMinutes} min)` };
  }

  // Racha de sesiones seguidas (sin hueco) que incluye la nueva
  const chain = [...sorted.map((s) => ({ s: s.startTime, e: s.endTime, n: false })), { s: req.startTime, e: req.endTime, n: true }].sort((a, b) => a.s.localeCompare(b.s));
  const i = chain.findIndex((c) => c.n);
  let lo = i;
  while (lo > 0 && chain[lo - 1].e === chain[lo].s) lo--;
  let hi = i;
  while (hi < chain.length - 1 && chain[hi].e === chain[hi + 1].s) hi++;
  if (hi - lo + 1 > limits.maxConsecutiveSessions) return { ok: false, reason: `supera el máximo de sesiones seguidas (${limits.maxConsecutiveSessions})` };

  const reasons: string[] = [];
  if (req.language && p.languages.length > 0 && same(p.languages[0], req.language)) reasons.push("idioma principal de la clase");
  if (req.modality && p.modalities.length === 1 && same(p.modalities[0], req.modality)) reasons.push(`especialista en ${req.modality}`);
  if (req.level && p.levels.some((l) => same(l, req.level!))) reasons.push(`imparte el nivel ${req.level}`);
  reasons.push(busy.length === 0 ? "sin otras sesiones ese día" : `${busy.length} sesión(es) más ese día`);
  return { ok: true, reasons, sessionsThatDay: busy.length };
}

export interface Proposal {
  candidates: Array<{ instructorId: number; fullName: string; reasons: string[] }>;
  discarded: Array<{ instructorId: number; fullName: string; reason: string }>;
}

/**
 * Propuesta simple de profesor: los compatibles por reglas duras, primero los de menos sesiones ese día y
 * después los que dan la clase en su idioma principal. No asigna ni puntúa.
 */
export function proposeInstructors(
  pool: InstructorProfile[],
  req: SlotRequest,
  absencesOf: (id: number) => AbsencePeriod[],
  busyOf: (id: number) => BusySession[],
  limits: PlanningLimits,
): Proposal {
  const ok: Array<{ instructorId: number; fullName: string; reasons: string[]; load: number; primaryLang: boolean }> = [];
  const discarded: Proposal["discarded"] = [];
  for (const p of pool) {
    const v = evaluateInstructor(p, req, absencesOf(p.id), busyOf(p.id), limits);
    if (v.ok) ok.push({ instructorId: p.id, fullName: p.fullName, reasons: v.reasons, load: v.sessionsThatDay, primaryLang: !!req.language && p.languages.length > 0 && same(p.languages[0], req.language) });
    else discarded.push({ instructorId: p.id, fullName: p.fullName, reason: v.reason });
  }
  ok.sort((a, b) => a.load - b.load || Number(b.primaryLang) - Number(a.primaryLang) || a.fullName.localeCompare(b.fullName, "es"));
  return { candidates: ok.map(({ instructorId, fullName, reasons }) => ({ instructorId, fullName, reasons })), discarded };
}

// ── Alumnos ─────────────────────────────────────────────────────────────────────

export interface EnrollmentSlot {
  sessionId: number;
  startTime: string;
  endTime: string;
  participantName: string;
}

/** El mismo alumno (por nombre, sin mayúsculas ni espacios) no puede estar en dos clases a la vez el mismo día. */
export function findOverlappingEnrollment(sameDay: EnrollmentSlot[], incoming: { startTime: string; endTime: string; participantName: string }): EnrollmentSlot | null {
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
  const who = norm(incoming.participantName);
  return sameDay.find((o) => overlaps(o.startTime, o.endTime, incoming.startTime, incoming.endTime) && norm(o.participantName) === who) ?? null;
}

/** Comprueba que un alumno encaja en la sesión: plaza libre, nivel y edad del producto. Lanza `RuleError`. */
export function checkEnrollment(
  session: { capacity: number; level: string | null; enrolled: number },
  product: { minAge: number | null; maxAge: number | null },
  participant: { age: number | null; level: string | null },
): void {
  if (session.enrolled >= session.capacity) throw new RuleError(`La sesión está completa (${session.capacity} plazas)`);
  if (session.level && participant.level && !same(session.level, participant.level)) throw new RuleError(`El alumno es de nivel ${participant.level} y la sesión es de nivel ${session.level}`);
  if (participant.age != null) {
    if (product.minAge != null && participant.age < product.minAge) throw new RuleError(`Este producto es a partir de ${product.minAge} años`);
    if (product.maxAge != null && participant.age > product.maxAge) throw new RuleError(`Este producto es hasta ${product.maxAge} años`);
  }
}
