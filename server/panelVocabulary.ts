/**
 * Vocabulario del panel en el servidor (textos de avisos y secciones que genera el Core), con el mismo
 * criterio que el panel: genérico para una pyme con licencias por capacidad y el de siempre en la
 * instalación propia o en empresas anteriores al motor de licencias. Solo presentación: no autoriza nada.
 */
import { getTenantMode } from "./_core/tenant";
import { getCapabilityAccess } from "./_core/capabilities/access";
import { buildSubscriptionOverview, type SubscriptionOverview } from "./subscriptionOverview";
import { buildVocabulary, type Vocabulary } from "../shared/vocabulary";

/** Vocabulario a partir del resumen de suscripción (puro, para pruebas). */
export function vocabularyFromOverview(o: Pick<SubscriptionOverview, "licensing" | "visible"> | null): Vocabulary {
  if (!o || o.licensing !== "capabilities") return buildVocabulary({ licensed: false });
  const visible = new Set(o.visible);
  return buildVocabulary({ licensed: true, can: (id) => visible.has(id) });
}

/**
 * Vocabulario de la empresa en curso. En multiempresa, si no se pueden leer las licencias, el genérico
 * sin módulos sectoriales (nunca el de la instalación propia).
 */
export async function panelVocabulary(): Promise<Vocabulary> {
  const mode = getTenantMode();
  if (mode !== "multi") return vocabularyFromOverview(null);
  try {
    const access = getCapabilityAccess();
    return vocabularyFromOverview(buildSubscriptionOverview({ mode, enforcing: access.enforcing(), grants: await access.list(), now: access.currentTime() }));
  } catch {
    return buildVocabulary({ licensed: true, can: () => false });
  }
}
