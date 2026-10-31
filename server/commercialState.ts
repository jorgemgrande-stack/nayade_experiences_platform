/**
 * Estado comercial de una empresa: ÚNICA fuente de verdad para las restricciones de la prueba gratuita en el flujo
 * actual (orquestador y Stripe; el motor antiguo `_core/billing` no se usa en production).
 *
 * Sale de lo que ya existe, sin tablas nuevas:
 *  - el estado de la empresa en el REGISTRO, que mueve el orquestador (`orchestrator/tenantStatus.ts`):
 *    `active` = pedido activo (exige confirmación: pago verificado o aprobación administrativa registrada),
 *    `grace` = impago dentro de la gracia de 7 días, `suspended` = suspendida;
 *  - las LICENCIAS de la empresa (Elephant Control): las de la prueba caducan (de ahí los días que quedan) y una de
 *    pago sin caducidad indica una empresa contratada aunque el registro siga en `trial` (alta asistida por un
 *    operador, sin pedido en el orquestador; misma regla que `trialPayments.ts`);
 *  - los PEDIDOS del orquestador, cuando quien consulta los tiene a mano: un pedido de la empresa con confirmación
 *    `payment` o `admin_approval` es el primer pago confirmado.
 *
 * Fases: `unmanaged` (instalación propia, fuera de multiempresa), `trial`, `trial_expired`, `contracted`, `grace`,
 * `suspended`, `inactive` (alta en curso, archivada…), `legacy` (sin estado ni licencias: empresas anteriores) y
 * `unknown` (no se pudo verificar).
 *
 * Restricciones de la prueba (`restricted`): solo en `trial` y `trial_expired`. `unknown` NO restringe (una caída del
 * origen de licencias no debe cortar el correo ni las integraciones de una empresa que ya opera); los cobros reales
 * siguen fallando cerrado en `trialPayments.ts`.
 *
 * Exención explícita por empresa (`TRIAL_RESTRICTIONS_EXEMPT_TENANTS`, lista separada por comas). Sin la variable se
 * aplica la lista por defecto: `t5-skibox`, empresa real que ya opera y que el registro mantiene en `trial`. Con la
 * variable definida (también vacía) manda exactamente su contenido.
 */
import { grantsShowPaid, grantsShowTrial } from "./trialPayments";
import type { CapabilityGrant } from "./_core/capabilities/model";
import type { CommercialOrder } from "./orchestrator/types";
import { Metrics } from "./_core/metering";
import type { DefaultQuota } from "./_core/erm/quota";

export type CommercialPhase = "unmanaged" | "trial" | "trial_expired" | "contracted" | "grace" | "suspended" | "inactive" | "legacy" | "unknown";

export interface CommercialState {
  tenantId: string | null;
  phase: CommercialPhase;
  /** En prueba (vigente o vencida). */
  inTrial: boolean;
  trialEndsAt: number | null;
  /** Días que quedan de prueba (0 si ya venció); null fuera de prueba. */
  trialDaysLeft: number | null;
  /** Primer pago (o aprobación administrativa) confirmado. */
  firstPaymentConfirmed: boolean;
  /** Exenta por identificador (TRIAL_RESTRICTIONS_EXEMPT_TENANTS). */
  exempt: boolean;
  /** ¿Se aplican las restricciones de la prueba? */
  restricted: boolean;
}

type GrantView = Pick<CapabilityGrant, "source" | "status" | "validUntil">;
type OrderView = Pick<CommercialOrder, "tenantId" | "confirmation">;

export const DEFAULT_TRIAL_EXEMPT_TENANTS: readonly string[] = ["t5-skibox"];
export const TRIAL_EXEMPT_ENV = "TRIAL_RESTRICTIONS_EXEMPT_TENANTS";

/** Empresas exentas de las restricciones de la prueba. */
export function exemptTenantsFromEnv(env: NodeJS.ProcessEnv = process.env): ReadonlySet<string> {
  const raw = env[TRIAL_EXEMPT_ENV];
  if (raw === undefined) return new Set(DEFAULT_TRIAL_EXEMPT_TENANTS);
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

const DAY = 86_400_000;

/** Fin de la prueba según las licencias (la primera que vence; misma regla que la página «Suscripción»). */
export function trialEndFromGrants(grants: GrantView[]): number | null {
  const t = grants.filter((g) => (g.source.startsWith("trial:") || g.source.startsWith("subscription:")) && g.validUntil !== null && g.status === "active");
  return t.length ? Math.min(...t.map((g) => g.validUntil as number)) : null;
}

/** ¿Algún pedido de esta empresa con la contratación confirmada (pago verificado o aprobación administrativa)? */
export function ordersShowConfirmed(tenantId: string | null, orders: OrderView[] | null | undefined): boolean {
  if (!tenantId || !orders) return false;
  return orders.some((o) => o.tenantId === tenantId && !!o.confirmation && (o.confirmation.kind === "payment" || o.confirmation.kind === "admin_approval"));
}

/** Decisión pura. */
export function resolveCommercialState(i: {
  multi: boolean;
  tenantId: string | null;
  /** Estado del registro (null: sin contexto, p. ej. en un trabajo programado). */
  status: string | null;
  grants: GrantView[] | null | "unavailable";
  orders?: OrderView[] | null;
  now: number;
  exempt?: ReadonlySet<string>;
}): CommercialState {
  const exempt = !!i.tenantId && (i.exempt ?? new Set(DEFAULT_TRIAL_EXEMPT_TENANTS)).has(i.tenantId);
  const grants = Array.isArray(i.grants) ? i.grants : null;
  const paid = grants ? grantsShowPaid(grants) : false;
  const trialEnd = grants ? trialEndFromGrants(grants) : null;
  // Prueba detenida: sus licencias ya no están activas (suspendida por un operador o en solo lectura), aunque no
  // conste fecha de fin. Cuenta como vencida: sin esto seguiría con toda la cuota de prueba.
  const trialGrants = grants ? grants.filter((g) => g.validUntil !== null && g.status !== "cancelled") : [];
  const trialStopped = trialGrants.length > 0 && trialGrants.every((g) => g.status === "suspended" || g.status === "read_only");
  const trialPhase = (): CommercialPhase => (trialStopped || (trialEnd !== null && trialEnd <= i.now) ? "trial_expired" : "trial");

  let phase: CommercialPhase;
  if (!i.multi) phase = "unmanaged";
  else if (i.status === "active") phase = "contracted";
  else if (i.status === "grace") phase = "grace";
  else if (i.status === "suspended") phase = "suspended";
  else if (i.status === "trial") phase = paid ? "contracted" : trialPhase();
  else if (i.status) phase = "inactive";
  else if (i.grants === "unavailable") phase = "unknown";
  else if (paid) phase = "contracted";
  else if (grants && grantsShowTrial(grants)) phase = trialPhase();
  else phase = "legacy";

  const inTrial = phase === "trial" || phase === "trial_expired";
  const firstPaymentConfirmed = phase === "unmanaged" || phase === "contracted" || phase === "grace" || phase === "legacy" || ordersShowConfirmed(i.tenantId, i.orders);
  return {
    tenantId: i.tenantId,
    phase,
    inTrial,
    trialEndsAt: inTrial ? trialEnd : null,
    trialDaysLeft: inTrial && trialEnd !== null ? Math.max(0, Math.ceil((trialEnd - i.now) / DAY)) : null,
    firstPaymentConfirmed,
    exempt,
    restricted: inTrial && !exempt,
  };
}

// ── Dominio propio ────────────────────────────────────────────────────────────

export const CUSTOM_DOMAIN_TRIAL_MESSAGE =
  "El dominio propio se activa tras el primer pago confirmado. Durante la prueba gratuita la web funciona con el subdominio de la plataforma: contrata el plan para conectar tu dominio.";

/** Dominio propio: solo con el primer pago confirmado (o exenta). El subdominio de plataforma no pasa por aquí. */
export function customDomainDecision(s: CommercialState): { allowed: true } | { allowed: false; code: "custom_domain_requires_payment"; message: string } {
  if (s.exempt || s.firstPaymentConfirmed) return { allowed: true };
  return { allowed: false, code: "custom_domain_requires_payment", message: CUSTOM_DOMAIN_TRIAL_MESSAGE };
}

// ── Integraciones externas de pago ────────────────────────────────────────────

/**
 * Integraciones externas con coste que NO se usan durante la prueba. La IA de la plataforma no está aquí: en prueba
 * se permite hasta la cuota de prueba (`TRIAL_QUOTA_POLICY`).
 */
export const TRIAL_BLOCKED_INTEGRATIONS = ["ghl", "vapi"] as const;
export type PaidIntegration = (typeof TRIAL_BLOCKED_INTEGRATIONS)[number];
const INTEGRATION_NAMES: Record<PaidIntegration, string> = { ghl: "GoHighLevel", vapi: "Vapi (agente de voz)" };

export function trialIntegrationMessage(id: PaidIntegration): string {
  return `Durante la prueba gratuita no está disponible la integración con ${INTEGRATION_NAMES[id]}: se activa al contratar un plan.`;
}

/** Equivalente de `isIntegrationAllowed` del motor antiguo para el flujo actual. */
export function integrationAllowed(s: CommercialState, id: PaidIntegration): boolean {
  return !(s.restricted && (TRIAL_BLOCKED_INTEGRATIONS as readonly string[]).includes(id));
}

// ── Correo durante la prueba ──────────────────────────────────────────────────

/**
 * Correo de la empresa durante la prueba (decisión): solo sale hacia los buzones PROPIOS de la empresa (usuarios del
 * panel y las direcciones de su configuración de correo). Los terceros (sus clientes) se retiran del envío; si no
 * queda nadie, el correo no sale. Además, todo el correo no transaccional cuenta contra el tope diario de la política
 * de prueba. Se eligió el filtro por destinatario (y no solo un tope) porque un tope bajo seguiría permitiendo
 * escribir a terceros en nombre de una empresa sin verificar.
 *
 * Nunca se bloquean los transaccionales de acceso (invitación, verificación, restablecimiento y seguridad).
 */
export const TRIAL_MAIL_ALWAYS_ALLOWED: ReadonlySet<string> = new Set(["user_invite", "password_reset", "security_notice", "email_verification"]);

export const TRIAL_MAIL_MESSAGE = "Durante la prueba gratuita los correos solo se envían a los buzones de tu propia empresa; los envíos a clientes se activan al contratar un plan.";

const norm = (e: string) => {
  const m = e.match(/<([^>]+)>\s*$/);
  return (m ? m[1] : e).trim().toLowerCase();
};
const asList = (v: string | string[] | undefined): string[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

/** Separa los destinatarios propios de los terceros. Pura. */
export function splitTrialRecipients(to: string | string[], cc: string | string[] | undefined, own: ReadonlySet<string>) {
  const keep = (l: string[]) => l.filter((e) => own.has(norm(e)));
  const allTo = asList(to);
  const allCc = asList(cc);
  const keptTo = keep(allTo);
  const keptCc = keep(allCc);
  return { to: keptTo, cc: keptCc, removed: allTo.length + allCc.length - keptTo.length - keptCc.length };
}

export const normalizeMailbox = norm;

// ── Cuotas de prueba ──────────────────────────────────────────────────────────

/**
 * Política de cuotas «trial» (configuración en el código, sin migración). Más baja que los valores por defecto de la
 * plataforma (`_core/erm/quota.ts`). Elephant Resource Manager puede consultarla con `quotaPolicyForPhase`; mientras
 * no la incorpore, el Core la aplica en los puntos de consumo (correo, IA de la plataforma y almacenamiento) con el
 * consumo que ya mide el Resource Manager.
 */
export const TRIAL_QUOTA_POLICY: readonly DefaultQuota[] = [
  { metric: Metrics.EMAIL_SENT, period: "day", limit: 50, enforcement: "hard" },
  { metric: Metrics.LLM_TOKENS_INPUT, period: "month", limit: 200_000, enforcement: "hard" },
  { metric: Metrics.LLM_TOKENS_OUTPUT, period: "month", limit: 100_000, enforcement: "hard" },
  { metric: Metrics.AI_IMAGES, period: "month", limit: 20, enforcement: "hard" },
  { metric: Metrics.STORAGE_WRITE_BYTES, period: "month", limit: 1024 ** 3, enforcement: "hard" },
];

/**
 * Prueba vencida o detenida: sin consumo de pago (IA, imágenes y escritura de ficheros a 0). El correo conserva el
 * límite de la prueba: la recuperación de acceso y los avisos para regularizar deben seguir llegando (en prueba, el
 * correo a terceros ya está limitado a los buzones propios).
 */
export const TRIAL_EXPIRED_QUOTA_POLICY: readonly DefaultQuota[] = TRIAL_QUOTA_POLICY.map((q) => (q.metric === Metrics.EMAIL_SENT ? q : { ...q, limit: 0 }));

/** Política de cuotas propia de la fase (null: la del plan o la de la plataforma). */
export function quotaPolicyForPhase(s: Pick<CommercialState, "restricted"> & Partial<Pick<CommercialState, "phase">>): readonly DefaultQuota[] | null {
  if (!s.restricted) return null;
  return s.phase === "trial_expired" ? TRIAL_EXPIRED_QUOTA_POLICY : TRIAL_QUOTA_POLICY;
}

/** ¿Se superaría la cuota de prueba? `quantity` 0 comprueba que no esté ya agotada. Pura. */
export function trialQuotaExceeded(q: Pick<DefaultQuota, "limit">, used: number, quantity: number): boolean {
  return quantity > 0 ? used + quantity > q.limit : used >= q.limit;
}
