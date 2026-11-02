/**
 * Embudo de ventas configurable (capacidad Business `crm-funnel-advanced`): etapas por empresa, equivalencia con los
 * cuatro estados de siempre de las oportunidades (`leads.opportunityStatus`) y previsión ponderada.
 *
 * Reglas puras, compartidas por el servidor y el panel. Las empresas sin la capacidad (Essential) siguen con los cuatro
 * estados y su vista de siempre: nada de esto cambia su estado ni sus datos.
 */

export const LEGACY_STATUSES = ["nueva", "enviada", "ganada", "perdida"] as const;
export type LegacyStatus = (typeof LEGACY_STATUSES)[number];

export const STAGE_KINDS = ["abierta", "ganada", "perdida"] as const;
export type StageKind = (typeof STAGE_KINDS)[number];
export const STAGE_KIND_LABELS: Record<StageKind, string> = { abierta: "Abierta", ganada: "Ganada", perdida: "Perdida" };

/** Colores semánticos (el panel los traduce a su paleta): nunca un color libre. */
export const STAGE_COLORS = ["gris", "azul", "violeta", "ambar", "verde", "rojo"] as const;
export type StageColor = (typeof STAGE_COLORS)[number];
export const STAGE_COLOR_LABELS: Record<StageColor, string> = { gris: "Gris", azul: "Azul", violeta: "Violeta", ambar: "Ámbar", verde: "Verde", rojo: "Rojo" };

export const STAGE_NAME_MAX = 80;
export const STAGES_MAX = 20;
export const LOST_REASON_MAX = 500;

export interface FunnelStage {
  id: number;
  name: string;
  position: number;
  probability: number;
  kind: StageKind;
  color: StageColor;
  /** Estado de siempre al que equivale (solo las cuatro etapas por defecto); null en las etapas propias. */
  legacyStatus: LegacyStatus | null;
}

/** Etapas por defecto: equivalen a los cuatro estados actuales, en el mismo orden. */
export const DEFAULT_STAGES: ReadonlyArray<Omit<FunnelStage, "id">> = [
  { name: "Nueva", position: 0, probability: 10, kind: "abierta", color: "azul", legacyStatus: "nueva" },
  { name: "Propuesta enviada", position: 1, probability: 50, kind: "abierta", color: "violeta", legacyStatus: "enviada" },
  { name: "Ganada", position: 2, probability: 100, kind: "ganada", color: "verde", legacyStatus: "ganada" },
  { name: "Perdida", position: 3, probability: 0, kind: "perdida", color: "rojo", legacyStatus: "perdida" },
];

/** Tipo de etapa que corresponde a un estado de siempre. */
export const kindOfStatus = (s: LegacyStatus): StageKind => (s === "ganada" ? "ganada" : s === "perdida" ? "perdida" : "abierta");

export const sortStages = <T extends Pick<FunnelStage, "position" | "id">>(stages: readonly T[]): T[] =>
  [...stages].sort((a, b) => a.position - b.position || a.id - b.id);

/**
 * Etapa en la que se muestra una oportunidad. La elegida en el embudo manda mientras sea coherente con su estado (una
 * etapa abierta para una oportunidad nueva o enviada, la ganada para una ganada…). Si no tiene o ya no lo es (porque
 * otro flujo de siempre cambió su estado: aceptación de un presupuesto, marcar como perdida…), se deriva del estado:
 * la etapa equivalente a ese estado y, si se borró, la primera etapa del mismo tipo.
 */
export function effectiveStage(status: LegacyStatus, explicitStageId: number | null | undefined, stages: readonly FunnelStage[]): FunnelStage | null {
  const kind = kindOfStatus(status);
  if (explicitStageId != null) {
    const s = stages.find((x) => x.id === explicitStageId);
    if (s && s.kind === kind) return s;
  }
  const same = stages.find((x) => x.legacyStatus === status);
  if (same) return same;
  return sortStages(stages.filter((x) => x.kind === kind))[0] ?? null;
}

/**
 * Estado de siempre que deja una oportunidad al pasar a una etapa (para que Essential, los informes y los flujos de
 * siempre sigan viendo lo mismo). Ganada y perdida, el suyo; una abierta por defecto, el suyo; una abierta propia
 * conserva el estado si ya estaba abierta y, si venía de cerrada, queda «enviada» (en negociación).
 */
export function statusForStage(stage: Pick<FunnelStage, "kind" | "legacyStatus">, current: LegacyStatus): LegacyStatus {
  if (stage.kind === "ganada") return "ganada";
  if (stage.kind === "perdida") return "perdida";
  if (stage.legacyStatus === "nueva" || stage.legacyStatus === "enviada") return stage.legacyStatus;
  return current === "nueva" || current === "enviada" ? current : "enviada";
}

/** Estado general del lead (`leads.status`) que acompaña a cada estado de oportunidad, como en los flujos de siempre. */
export const LEAD_STATUS_FOR: Record<LegacyStatus, "nuevo" | "contactado" | "convertido" | "perdido"> = {
  nueva: "nuevo",
  enviada: "contactado",
  ganada: "convertido",
  perdida: "perdido",
};

export interface ForecastCard {
  stageId: number;
  amount: number;
}
export interface StageForecast {
  stageId: number;
  count: number;
  amount: number;
  weighted: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Previsión ponderada: por etapa, número de oportunidades, suma de importes y suma de importe × probabilidad. El total
 * ponderado y el importe abierto solo cuentan las etapas abiertas (lo ganado va aparte y lo perdido no suma).
 */
export function funnelForecast(cards: readonly ForecastCard[], stages: readonly FunnelStage[]): {
  stages: StageForecast[];
  openAmount: number;
  weightedTotal: number;
  wonAmount: number;
} {
  const by = new Map<number, StageForecast>(stages.map((s) => [s.id, { stageId: s.id, count: 0, amount: 0, weighted: 0 }]));
  const prob = new Map(stages.map((s) => [s.id, Math.max(0, Math.min(100, s.probability)) / 100]));
  for (const c of cards) {
    const f = by.get(c.stageId);
    if (!f) continue;
    const amount = Number.isFinite(c.amount) ? c.amount : 0;
    f.count += 1;
    f.amount += amount;
    f.weighted += amount * (prob.get(c.stageId) ?? 0);
  }
  const list = sortStages(stages).map((s) => {
    const f = by.get(s.id)!;
    return { ...f, amount: round2(f.amount), weighted: round2(f.weighted) };
  });
  const kindOf = new Map(stages.map((s) => [s.id, s.kind]));
  const sumBy = (k: StageKind, field: "amount" | "weighted") => round2(list.filter((f) => kindOf.get(f.stageId) === k).reduce((a, f) => a + f[field], 0));
  return { stages: list, openAmount: sumBy("abierta", "amount"), weightedTotal: sumBy("abierta", "weighted"), wonAmount: sumBy("ganada", "amount") };
}

export const normalizeStageName = (s: string) => s.replace(/\s+/g, " ").trim();

export interface StageForm {
  name: string;
  probability: number;
  kind: StageKind;
  color: StageColor;
}

/** Errores del formulario de etapa (vacío si es válido). `others`: el resto de etapas, para el nombre repetido. */
export function validateStageForm(f: StageForm, others: ReadonlyArray<Pick<FunnelStage, "id" | "name">> = [], selfId?: number): Partial<Record<keyof StageForm, string>> {
  const e: Partial<Record<keyof StageForm, string>> = {};
  const name = normalizeStageName(f.name ?? "");
  if (!name) e.name = "Indica el nombre de la etapa.";
  else if (name.length > STAGE_NAME_MAX) e.name = `El nombre admite como máximo ${STAGE_NAME_MAX} caracteres.`;
  else if (others.some((o) => o.id !== selfId && normalizeStageName(o.name).toLocaleLowerCase("es") === name.toLocaleLowerCase("es"))) e.name = "Ya existe una etapa con ese nombre.";
  if (!Number.isInteger(f.probability) || f.probability < 0 || f.probability > 100) e.probability = "La probabilidad va de 0 a 100.";
  else if (f.kind === "ganada" && f.probability !== 100) e.probability = "Una etapa ganada tiene probabilidad 100.";
  else if (f.kind === "perdida" && f.probability !== 0) e.probability = "Una etapa perdida tiene probabilidad 0.";
  if (!STAGE_KINDS.includes(f.kind)) e.kind = "Elige el tipo de etapa.";
  if (!STAGE_COLORS.includes(f.color)) e.color = "Elige un color de la lista.";
  return e;
}

/**
 * ¿Se puede quitar (o cambiar de tipo) esta etapa? El embudo necesita siempre al menos una etapa de cada tipo: sin
 * abierta no hay dónde poner lo nuevo, y sin ganada o perdida no se podría cerrar una oportunidad.
 */
export function canRemoveStageKind(stage: Pick<FunnelStage, "id" | "kind">, stages: ReadonlyArray<Pick<FunnelStage, "id" | "kind">>): boolean {
  return stages.some((s) => s.id !== stage.id && s.kind === stage.kind);
}
