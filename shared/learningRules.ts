/**
 * Presentación de las reglas de acceso con nombres comerciales.
 * Funciones puras: el router aporta las filas leídas y la pantalla pone las etiquetas de respaldo
 * cuando falta alguna referencia (producto, modalidad o módulo borrados o de otro entorno).
 */
export type RuleLike = { experienceId: number; variantId: number | null; moduleIds: number[] };
type Named = Record<string, unknown>;

const pick = (list: Named[], id: number | null, col: string): string | null => {
  if (id == null) return null;
  const v = list.find((x) => Number(x.id) === id)?.[col];
  return typeof v === "string" && v.trim() ? v : null;
};

export function describeRule<R extends RuleLike>(rule: R, refs: { experiences: Named[]; variants: Named[]; modules: Named[] }) {
  return {
    ...rule,
    experienceName: pick(refs.experiences, rule.experienceId, "title"),
    variantName: pick(refs.variants, rule.variantId, "name"),
    courseTitle: (refs.modules.find((m) => rule.moduleIds.includes(Number(m.id)))?.course_title as string | undefined) ?? null,
    moduleTitles: rule.moduleIds.map((id) => pick(refs.modules, id, "title") ?? `Módulo n.º ${id}`),
  };
}

export const experienceLabel = (r: { experienceName: string | null; experienceId: number }) => r.experienceName ?? `Producto n.º ${r.experienceId}`;
export const variantLabel = (r: { variantName: string | null; variantId: number | null }) =>
  r.variantName ?? (r.variantId == null ? "Cualquier modalidad" : `Modalidad n.º ${r.variantId}`);
export const modulesLabel = (r: { moduleTitles: string[] }) => (r.moduleTitles.length ? r.moduleTitles.join(" · ") : "—");
