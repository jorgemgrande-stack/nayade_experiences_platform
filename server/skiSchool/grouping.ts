/**
 * Ski Net · Cursillos y grupos por niveles (lógica pura, sin BD). Portado y desacoplado de `teachingPlanningGrouping.ts`
 * y `teachingPlanningEmptyGroups.ts` del origen.
 *
 * Un TURNO es un producto colectivo (cursillo o escuelita) en un día y una hora. Sus alumnos sin grupo (bolsa de
 * inscripción) se reparten así:
 *  1. Clave de agrupación: nivel (exacto), tramo de edad y, salvo en la escuelita, idioma.
 *  2. Primero se completan las sesiones del turno compatibles con plazas libres (las más llenas antes, para consolidar).
 *  3. El resto va a sesiones nuevas del mismo producto, equilibradas (tamaños que difieren como mucho en uno) y sin
 *     superar el aforo.
 *  4. Las sesiones del turno sin alumnos se señalan (grupos vacíos) para que se cancelen o se reutilicen.
 * La propuesta lleva una huella: se aplica solo si, al aplicarla, sale exactamente la misma que se revisó.
 */
import { createHash } from "node:crypto";

export interface AgeBand {
  code: string;
  label: string;
  min: number;
  max: number;
}

/** Tramos de edad de la agrupación (los de la escuelita son más estrechos). */
export const AGE_BANDS: AgeBand[] = [
  { code: "3-5", label: "3 a 5 años", min: 0, max: 5 },
  { code: "6-8", label: "6 a 8 años", min: 6, max: 8 },
  { code: "9-12", label: "9 a 12 años", min: 9, max: 12 },
  { code: "13-17", label: "13 a 17 años", min: 13, max: 17 },
  { code: "adultos", label: "18 años o más", min: 18, max: 200 },
];
export const NO_AGE = "sin-edad";

export function ageBand(age: number | null | undefined): string {
  if (age == null) return NO_AGE;
  return AGE_BANDS.find((b) => age >= b.min && age <= b.max)?.code ?? NO_AGE;
}
export const ageBandLabel = (code: string) => AGE_BANDS.find((b) => b.code === code)?.label ?? "Edad sin indicar";

export interface PoolStudent {
  poolId: number;
  name: string;
  age: number | null;
  level: string | null;
  language: string | null;
}
export interface TurnSession {
  id: number;
  capacity: number;
  level: string | null;
  language: string | null;
  /** Edades de los alumnos inscritos (las desconocidas no cuentan). */
  ages: number[];
  enrolled: number;
}

export type ProposedGroup =
  | { kind: "incorporate"; sessionId: number; level: string | null; language: string | null; ageBand: string; poolIds: number[]; names: string[] }
  | { kind: "new_session"; level: string | null; language: string | null; ageBand: string; poolIds: number[]; names: string[] };

export interface GroupingProposal {
  groups: ProposedGroup[];
  /** Sesiones del turno sin alumnos (ni ahora ni con la propuesta): candidatas a cancelarse. */
  emptySessionIds: number[];
  fingerprint: string;
}

const norm = (v: string | null | undefined) => (v ?? "").trim().toLowerCase();

/** Reparte `n` alumnos en grupos equilibrados de como mucho `cap`. */
export function balancedSizes(n: number, cap: number): number[] {
  if (n <= 0) return [];
  const groups = Math.ceil(n / cap);
  const base = Math.floor(n / groups);
  return Array.from({ length: groups }, (_, i) => base + (i < n % groups ? 1 : 0));
}

function sessionBand(s: TurnSession): string | null {
  const bands = Array.from(new Set(s.ages.map(ageBand)));
  return bands.length ? bands[0] : null;
}

export function planGroups(students: PoolStudent[], sessions: TurnSession[], o: { capacity: number; useLanguage: boolean }): GroupingProposal {
  if (!Number.isInteger(o.capacity) || o.capacity < 1) throw new Error("Aforo no válido");
  const keyOf = (level: string | null, band: string, language: string | null) => `${norm(level)}|${band}|${o.useLanguage ? norm(language) : ""}`;
  const byKey = new Map<string, PoolStudent[]>();
  for (const s of [...students].sort((a, b) => a.poolId - b.poolId)) {
    const k = keyOf(s.level, ageBand(s.age), s.language);
    byKey.set(k, [...(byKey.get(k) ?? []), s]);
  }
  const free = new Map(sessions.map((s) => [s.id, Math.max(0, s.capacity - s.enrolled)]));
  const groups: ProposedGroup[] = [];
  for (const k of Array.from(byKey.keys()).sort()) {
    const list = byKey.get(k)!;
    const { level, language } = list[0];
    const band = ageBand(list[0].age);
    let rest = [...list];
    // 2. Sesiones compatibles con plazas: mismo nivel, idioma compatible y mismo tramo de edad que sus alumnos
    const candidates = sessions
      .filter((s) => norm(s.level) === norm(level) && (!o.useLanguage || !s.language || norm(s.language) === norm(language)))
      .filter((s) => {
        const b = sessionBand(s);
        return b === null || b === band;
      })
      .sort((a, b) => b.enrolled - a.enrolled || a.id - b.id);
    for (const s of candidates) {
      const room = free.get(s.id) ?? 0;
      if (!rest.length || room <= 0) continue;
      const take = rest.slice(0, room);
      rest = rest.slice(take.length);
      free.set(s.id, room - take.length);
      groups.push({ kind: "incorporate", sessionId: s.id, level, language: o.useLanguage ? language : null, ageBand: band, poolIds: take.map((t) => t.poolId), names: take.map((t) => t.name) });
    }
    // 3. Sesiones nuevas equilibradas
    for (const size of balancedSizes(rest.length, o.capacity)) {
      const take = rest.slice(0, size);
      rest = rest.slice(size);
      groups.push({ kind: "new_session", level, language: o.useLanguage ? language : null, ageBand: band, poolIds: take.map((t) => t.poolId), names: take.map((t) => t.name) });
    }
  }
  const incorporated = new Set(groups.filter((g) => g.kind === "incorporate").map((g) => (g as { sessionId: number }).sessionId));
  const emptySessionIds = sessions.filter((s) => s.enrolled === 0 && !incorporated.has(s.id)).map((s) => s.id);
  const fingerprint = createHash("sha256")
    .update(JSON.stringify({ g: groups.map((g) => [g.kind, g.kind === "incorporate" ? g.sessionId : null, g.poolIds]), s: sessions.map((s) => [s.id, s.enrolled, s.capacity]).sort() }))
    .digest("hex")
    .slice(0, 32);
  return { groups, emptySessionIds, fingerprint };
}

/**
 * ¿Se pueden fusionar dos grupos del mismo turno? Mismo nivel (o alguno sin nivel), mismo idioma si los dos lo fijan y
 * caben en el destino. Devuelve el motivo si no.
 */
export function mergeProblem(target: { capacity: number; level: string | null; language: string | null; enrolled: number }, source: { level: string | null; language: string | null; enrolled: number }): string | null {
  if (target.level && source.level && norm(target.level) !== norm(source.level)) return `Los grupos son de niveles distintos (${target.level} y ${source.level})`;
  if (target.language && source.language && norm(target.language) !== norm(source.language)) return `Los grupos son de idiomas distintos (${target.language} y ${source.language})`;
  if (target.enrolled + source.enrolled > target.capacity) return `No caben: ${target.enrolled + source.enrolled} alumnos para ${target.capacity} plazas`;
  return null;
}
