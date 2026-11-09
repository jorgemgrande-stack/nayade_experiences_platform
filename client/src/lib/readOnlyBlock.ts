/**
 * Aviso contextual cuando se intenta crear, editar o guardar con el panel en consulta. Lo dispara el manejador global
 * de errores de las mutaciones (main.tsx) con el rechazo tipado del servidor (capabilityRouteGuard): un único aviso
 * con la acción de reactivar, en lugar del mensaje técnico de cada pantalla. No concede nada: solo informa.
 */
import { toast } from "sonner";
import { navigate } from "wouter/use-browser-location";
import { blockedNotice, isReadOnlyBlockError, type RecoveryView } from "@shared/subscriptionRecovery";

const TOAST_ID = "panel-solo-lectura";
/** Textos del mismo rechazo que las pantallas muestran por su cuenta (se retiran para no duplicar el aviso). */
const DUPLICATE_RE = /solo lectura|ha caducado|no permite hacer cambios/i;

/** Estado de recuperación vigente (lo publica el aviso único del panel al resolverlo con los datos del servidor). */
let current: RecoveryView | null = null;
export function setRecoveryView(view: RecoveryView | null) {
  current = view;
}

function dismissDuplicates() {
  for (const t of toast.getToasts()) {
    if (t.id === TOAST_ID || !("title" in t)) continue;
    if (typeof t.title === "string" && DUPLICATE_RE.test(t.title)) toast.dismiss(t.id);
  }
}

/** Si el error es el rechazo de escritura en consulta, muestra el aviso con la acción de reactivar. */
export function notifyIfReadOnlyBlocked(error: unknown): boolean {
  // Solo en el panel: en la web pública de la empresa el visitante no gestiona la suscripción
  if (!isReadOnlyBlockError(error) || typeof window === "undefined" || !window.location.pathname.startsWith("/admin")) return false;
  const n = blockedNotice(current);
  toast.warning(n.title, {
    id: TOAST_ID,
    description: n.description,
    duration: 8000,
    ...(n.action ? { action: { label: n.action.label, onClick: () => navigate(n.action!.href) } } : {}),
  });
  // Las pantallas avisan en su onError (después de este evento): se retiran sus avisos del mismo rechazo
  setTimeout(dismissDuplicates, 0);
  setTimeout(dismissDuplicates, 150);
  return true;
}
