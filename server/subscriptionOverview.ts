/**
 * Resumen de la suscripción de la empresa para su panel (menú por licencias y página «Suscripción»).
 *
 * Solo PRESENTACIÓN: la autorización real sigue en el servidor, en cada operación
 * (capabilityRouteGuard). Todo sale de las licencias por capacidad del registro y del catálogo
 * oficial v1 (planes y cuotas incluidas); aquí no se calcula ningún precio.
 *
 *  - Modo `single` (instalación de una sola empresa, Náyade): `licensing = "legacy"`; el panel
 *    conserva su menú de siempre.
 *  - Modo `multi` sin licencias por capacidad ni aplicación activa (empresas anteriores al motor):
 *    también `legacy`, para no ocultar nada que hoy funciona.
 *  - Modo `multi` con licencias (o con la aplicación activada): `licensing = "capabilities"`.
 */
import { CAPABILITIES, capability, type CapabilityGroup, type CapabilityTier } from "./catalog/capabilities";
import { PRODUCTS } from "./catalog/elephantSourceV1";
import { decide, type CapabilityGrant } from "./_core/capabilities/model";

export type EffectiveCapabilityStatus = "active" | "read_only" | "expired" | "contracted" | "pending_setup" | "suspended" | "cancelled";

export interface SubscriptionCapability {
  id: string;
  name: string;
  tier: CapabilityTier;
  group: CapabilityGroup;
  status: EffectiveCapabilityStatus;
  validUntil: number | null;
}

export type SubscriptionState = "trial" | "trial_expired" | "active" | "read_only" | "suspended" | "cancelled" | "pending" | "none";

export interface SubscriptionLimit {
  metric: "users" | "sites" | "fiscal_entities";
  label: string;
  /** Incluido en el plan según el catálogo; null = por contrato (sin tope técnico). */
  included: number | null;
  /** Uso actual si el Core puede medirlo; null = no disponible aquí. */
  used: number | null;
}

export interface SubscriptionOverview {
  mode: "single" | "multi";
  licensing: "legacy" | "capabilities";
  plan: { key: "essential" | "business" | "enterprise"; name: string } | null;
  state: SubscriptionState;
  trial: { endsAt: number; daysLeft: number } | null;
  capabilities: SubscriptionCapability[];
  /** Ids con estado activo o de solo lectura (lo que el menú puede mostrar). */
  visible: string[];
  /** Ids de solo lectura (se muestran con aviso). */
  readOnly: string[];
  limits: SubscriptionLimit[];
  /** Enlace a la web comercial para ampliar o contratar (configurable); null si no está configurado. */
  upgradeUrl: string | null;
}

const DAY = 24 * 60 * 60 * 1000;
const PLAN_ORDER: Array<{ key: "enterprise" | "business" | "essential"; tier: CapabilityTier }> = [
  { key: "enterprise", tier: "enterprise" },
  { key: "business", tier: "business" },
  { key: "essential", tier: "essential" },
];
const LIMIT_LABELS: Record<SubscriptionLimit["metric"], string> = { users: "Usuarios", sites: "Sedes", fiscal_entities: "Entidades fiscales" };

/** Estado efectivo de una capacidad (consultar/operar) con las reglas del motor de licencias. */
export function effectiveStatus(grants: CapabilityGrant[], capabilityId: string, now: number): EffectiveCapabilityStatus | null {
  const write = decide(grants, capabilityId, { write: true, now });
  if (write.allowed) return "active";
  if (write.status === "not_contracted") return null;
  const read = decide(grants, capabilityId, { write: false, now });
  if (read.allowed) return write.status === "expired" ? "expired" : "read_only";
  return write.status as EffectiveCapabilityStatus;
}

/** Solo una URL https sin credenciales; cualquier otra cosa se descarta. */
export function safeUpgradeUrl(raw: string | undefined | null): string | null {
  const v = (raw ?? "").trim();
  if (!v) return null;
  try {
    const u = new URL(v);
    if (u.protocol !== "https:" || u.username || u.password) return null;
    return u.toString();
  } catch {
    return null;
  }
}

export function buildSubscriptionOverview(o: {
  mode: "single" | "shadow" | "multi";
  enforcing: boolean;
  grants: CapabilityGrant[];
  now: number;
  usedUsers?: number | null;
  upgradeUrl?: string | null;
}): SubscriptionOverview {
  const mode = o.mode === "multi" ? "multi" : "single";
  const upgradeUrl = safeUpgradeUrl(o.upgradeUrl);
  const base: SubscriptionOverview = { mode, licensing: "legacy", plan: null, state: "none", trial: null, capabilities: [], visible: [], readOnly: [], limits: [], upgradeUrl };
  if (mode === "single") return base;
  if (o.grants.length === 0 && !o.enforcing) return base;

  const caps: SubscriptionCapability[] = [];
  for (const def of CAPABILITIES) {
    const status = effectiveStatus(o.grants, def.id, o.now);
    if (!status) continue;
    const g = o.grants.filter((x) => x.capabilityId === def.id).sort((a, b) => (b.validUntil ?? Infinity) - (a.validUntil ?? Infinity))[0];
    caps.push({ id: def.id, name: def.name, tier: def.tier, group: def.group, status, validUntil: g?.validUntil ?? null });
  }
  const visible = caps.filter((c) => c.status === "active" || c.status === "read_only" || c.status === "expired").map((c) => c.id);
  const readOnly = caps.filter((c) => c.status === "read_only" || c.status === "expired").map((c) => c.id);

  // Plan: el nivel más alto con alguna capacidad propia viva (los planes son acumulativos)
  const live = caps.filter((c) => c.status !== "cancelled");
  const planHit = PLAN_ORDER.find((p) => live.some((c) => capability(c.id)?.tier === p.tier));
  const planProduct = planHit ? PRODUCTS.find((p) => p.key === planHit.key && p.family === "core_plan") : undefined;
  const plan = planHit && planProduct ? { key: planHit.key, name: planProduct.draft.name } : null;

  // Prueba: licencias con caducidad, de origen `trial:` o de una suscripción en prueba (la prueba
  // pública aplica `subscription:<id>` hasta el fin de la prueba); manda la primera que vence. Una
  // suscripción de pago aplica sus licencias sin caducidad. Solo cuentan las ACTIVAS: la solo lectura con plazo
  // tras terminar una suscripción también caduca, pero no es una prueba.
  const trialGrants = o.grants.filter((g) => (g.source.startsWith("trial:") || g.source.startsWith("subscription:")) && g.validUntil !== null && g.status === "active");
  const trialEnd = trialGrants.length ? Math.min(...trialGrants.map((g) => g.validUntil as number)) : null;
  const hasSubscription = o.grants.some((g) => g.source.startsWith("subscription:") && g.validUntil === null && g.status !== "cancelled");
  const trial = trialEnd !== null && !hasSubscription ? { endsAt: trialEnd, daysLeft: Math.max(0, Math.ceil((trialEnd - o.now) / DAY)) } : null;

  const statuses = new Set(caps.map((c) => c.status));
  let state: SubscriptionState;
  if (trial) state = trial.endsAt > o.now ? "trial" : "trial_expired";
  else if (statuses.has("active")) state = "active";
  else if (statuses.has("read_only") || statuses.has("expired")) state = "read_only";
  else if (statuses.has("suspended")) state = "suspended";
  else if (statuses.has("contracted") || statuses.has("pending_setup")) state = "pending";
  else if (statuses.has("cancelled")) state = "cancelled";
  else state = "none";

  const quotas = planProduct?.draft.catalog.quotas ?? [];
  const limits: SubscriptionLimit[] = (Object.keys(LIMIT_LABELS) as SubscriptionLimit["metric"][]).map((metric) => {
    const q = quotas.find((x) => x.metric === metric);
    return { metric, label: LIMIT_LABELS[metric], included: q ? q.included : null, used: metric === "users" ? (o.usedUsers ?? null) : null };
  });

  return { mode, licensing: "capabilities", plan, state, trial, capabilities: caps, visible, readOnly, limits: plan ? limits : [], upgradeUrl };
}
