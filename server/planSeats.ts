/**
 * Plan contratado, prueba y límite de usuarios de la empresa en curso, deducidos de sus licencias por
 * capacidad (registro, solo lectura). Reglas puras: la lectura de licencias y el recuento de usuarios
 * viven en `server/setupWizardDb.ts`.
 *
 *  - Plan: el nivel más alto con alguna capacidad propia concedida (Enterprise ⊃ Business ⊃ Essential).
 *    La base de Essential es `admin-panel`; sin ella no hay plan (instalación anterior a las licencias:
 *    no se limita nada).
 *  - Usuarios incluidos: los del catálogo oficial (Essential 3, Business 15, Enterprise por contrato).
 *  - Prueba: la licencia base tiene caducidad; vencida (o en `read_only`) la empresa está en solo
 *    lectura, igual que decide el motor de capacidades.
 */
import type { CapabilityGrant } from "./_core/capabilities/model";
import { COMPANY_WIDE } from "./_core/capabilities/model";
import { CAPABILITIES } from "./catalog/capabilities";
import { PRODUCTS } from "./catalog/elephantSourceV1";

export const CORE_PLANS = ["essential", "business", "enterprise"] as const;
export type CorePlan = (typeof CORE_PLANS)[number];
/**
 * Roles que ocupan una plaza de usuario del panel: el personal, incluido el de solo lectura. No la ocupan
 * `user` (sin acceso al panel: cuentas de cliente o con el acceso retirado) ni los portales de socios o
 * proveedores.
 */
export const SEAT_ROLES = ["admin", "monitor", "agente", "adminrest", "controler", "readonly"] as const;
const BASE_CAPABILITY = "admin-panel";
const DAY = 86_400_000;

/** Usuarios incluidos en un plan según el catálogo oficial; null = sin límite fijo (por contrato). */
export function includedUsers(plan: CorePlan): number | null {
  const p = PRODUCTS.find((x) => x.key === plan);
  const q = p?.draft.catalog?.quotas?.find((x) => x.metric === "users");
  return q ? q.included : null;
}

export interface LicenceSummary {
  plan: CorePlan | null;
  userLimit: number | null;
  /** Fin de la licencia base (prueba o fin programado); null si no caduca. */
  endsAt: number | null;
  daysLeft: number | null;
  readOnly: boolean;
}

export function licenceSummary(grants: readonly CapabilityGrant[] | null, now: number): LicenceSummary {
  const none: LicenceSummary = { plan: null, userLimit: null, endsAt: null, daysLeft: null, readOnly: false };
  if (!grants) return none;
  const live = grants.filter((g) => g.siteId === COMPANY_WIDE && g.status !== "cancelled" && g.status !== "contracted");
  const base = live.find((g) => g.capabilityId === BASE_CAPABILITY);
  if (!base) return none;
  const tierOf = new Map(CAPABILITIES.map((c) => [c.id, c.tier]));
  const has = (tier: string) => live.some((g) => tierOf.get(g.capabilityId) === tier);
  const plan: CorePlan = has("enterprise") ? "enterprise" : has("business") ? "business" : "essential";
  const endsAt = base.validUntil;
  const expired = endsAt !== null && endsAt <= now;
  return {
    plan,
    userLimit: includedUsers(plan),
    endsAt,
    daysLeft: endsAt === null ? null : Math.max(0, Math.ceil((endsAt - now) / DAY)),
    readOnly: base.status === "read_only" || base.status === "suspended" || (base.status === "active" && expired),
  };
}

const PLAN_NAMES: Record<CorePlan, string> = { essential: "Essential", business: "Business", enterprise: "Enterprise" };

/** ¿Cabe un usuario más? Sin plan o sin límite, siempre. */
export function seatDecision(summary: Pick<LicenceSummary, "plan" | "userLimit">, used: number, adding = 1): { allowed: true } | { allowed: false; reason: string } {
  if (!summary.plan || summary.userLimit === null) return { allowed: true };
  if (used + adding <= summary.userLimit) return { allowed: true };
  return {
    allowed: false,
    reason: `Tu plan ${PLAN_NAMES[summary.plan]} incluye ${summary.userLimit} usuarios y ya tienes ${used}. Desactiva un usuario o amplía tu plan para invitar a más.`,
  };
}
