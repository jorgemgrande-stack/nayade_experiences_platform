import { useMemo } from "react";
import { usePanelSubscription } from "@/hooks/usePanelSubscription";
import { buildVocabulary, type Vocabulary } from "@shared/vocabulary";

export type { Vocabulary } from "@shared/vocabulary";
export { buildVocabulary, visibleCrmTabs } from "@shared/vocabulary";

/**
 * Textos del panel según el modo de la empresa: genéricos para una pyme con licencias por capacidad y
 * los de siempre en la instalación propia de Náyade. Usa la misma consulta (en caché) que el menú.
 */
export function useVocabulary(): Vocabulary {
  const sub = usePanelSubscription();
  const { isLicensed, can, data } = sub;
  // `can` cambia en cada render; el vocabulario solo depende del modo y de las licencias visibles
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => buildVocabulary({ licensed: isLicensed, can }), [isLicensed, data]);
}
