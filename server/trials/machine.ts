/**
 * Máquina de estados de la prueba autónoma de 15 días (preparación; no conectada a la web).
 *
 *   pending_verification ─verify→ verified ─request_provisioning→ provisioning ─provisioned→ active
 *                                     ↑                  └─provisioning_failed─┘
 *   pending_verification ─resend_verification→ pending_verification (enlace nuevo; el anterior deja de valer)
 *   pending_verification ─expire_verification→ cancelled (sin verificar y con el enlace caducado: libera el correo)
 *   active ─mark_expired→ expired   (solo si ya venció: una persona o la tarea programada, apagada por defecto)
 *   active|expired ─approve_extension→ active
 *   active|expired ─suspend→ suspended ─reactivate→ active
 *   active|expired|suspended ─convert→ converted (suscripción)
 *   pending_verification|verified ─reject→ rejected
 *   cualquier estado no terminal ─cancel→ cancelled
 *
 * Estados terminales: converted, rejected, cancelled.
 */
export const TRIAL_STATES = ["pending_verification", "verified", "provisioning", "active", "expired", "suspended", "converted", "rejected", "cancelled"] as const;
export type TrialState = (typeof TRIAL_STATES)[number];
export const TERMINAL: ReadonlySet<TrialState> = new Set<TrialState>(["converted", "rejected", "cancelled"]);

export type TrialAction =
  | "verify"
  | "resend_verification"
  | "expire_verification"
  | "request_provisioning"
  | "provisioned"
  | "provisioning_failed"
  | "request_extension"
  | "approve_extension"
  | "mark_expired"
  | "suspend"
  | "reactivate"
  | "convert"
  | "reject"
  | "cancel";

const NON_TERMINAL = TRIAL_STATES.filter((s) => !TERMINAL.has(s));

export const TRANSITIONS: Record<TrialAction, { from: readonly TrialState[]; to: TrialState | "same" }> = {
  verify: { from: ["pending_verification"], to: "verified" },
  resend_verification: { from: ["pending_verification"], to: "same" },
  expire_verification: { from: ["pending_verification"], to: "cancelled" },
  request_provisioning: { from: ["verified"], to: "provisioning" },
  provisioned: { from: ["provisioning"], to: "active" },
  provisioning_failed: { from: ["provisioning"], to: "verified" },
  request_extension: { from: ["active", "expired"], to: "same" },
  approve_extension: { from: ["active", "expired"], to: "active" },
  mark_expired: { from: ["active"], to: "expired" },
  suspend: { from: ["active", "expired"], to: "suspended" },
  reactivate: { from: ["suspended"], to: "active" },
  convert: { from: ["active", "expired", "suspended"], to: "converted" },
  reject: { from: ["pending_verification", "verified"], to: "rejected" },
  cancel: { from: NON_TERMINAL, to: "cancelled" },
};

/** Estado de destino, o null si la acción no está permitida desde `from`. */
export function nextState(from: TrialState, action: TrialAction): TrialState | null {
  const t = TRANSITIONS[action];
  if (!t.from.includes(from)) return null;
  return t.to === "same" ? from : t.to;
}
