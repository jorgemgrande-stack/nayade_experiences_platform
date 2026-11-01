import { useEffect, useMemo, useRef, useState } from "react";
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

/**
 * Valor inicial de un campo que sale del vocabulario (p. ej. las condiciones de un presupuesto): sigue al vocabulario
 * mientras el usuario no lo cambie, porque las licencias de la empresa llegan después del primer pintado.
 */
export function useVocabularyDefault(value: string): [string, (v: string) => void] {
  const [state, setState] = useState(value);
  const last = useRef(value);
  useEffect(() => {
    setState((cur) => (cur === last.current ? value : cur));
    last.current = value;
  }, [value]);
  return [state, setState];
}
