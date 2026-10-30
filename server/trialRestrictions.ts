/**
 * Restricciones de la prueba gratuita en el Core (empresa en curso). La decisión es de `commercialState.ts`; aquí
 * solo se lee el estado de la petición (registro y licencias) y se aplica en los puntos de entrada:
 *  - correo a terceros (`applyTrialMailPolicy`, desde `mailer.sendEmail`);
 *  - integraciones externas de pago (`integrationAllowedNow` / `assertIntegrationAllowed`: GHL y Vapi);
 *  - cuotas de prueba (`enforceTrialQuota`: correo, IA de la plataforma y almacenamiento).
 * Fuera de multiempresa no cambia nada.
 */
import { TRPCError } from "@trpc/server";
import { getTenantMode, peekTenantContext } from "./_core/tenant";
import { getCapabilityAccess } from "./_core/capabilities/access";
import { getErm } from "./_core/erm/runtime";
import { QuotaExceededError } from "./_core/erm/types";
import { opsLog } from "./_core/ops/log";
import {
  exemptTenantsFromEnv,
  integrationAllowed,
  normalizeMailbox,
  resolveCommercialState,
  splitTrialRecipients,
  trialIntegrationMessage,
  trialQuotaExceeded,
  TRIAL_MAIL_ALWAYS_ALLOWED,
  TRIAL_QUOTA_POLICY,
  type CommercialState,
  type PaidIntegration,
} from "./commercialState";

/** Estado comercial de la empresa en curso. */
export async function currentCommercialState(): Promise<CommercialState> {
  const multi = getTenantMode() === "multi";
  const ctx = multi ? peekTenantContext() : undefined;
  const status = ctx?.status ?? null;
  let grants: Parameters<typeof resolveCommercialState>[0]["grants"] = null;
  // Las licencias solo hacen falta si el registro no decide (sin estado o en `trial`)
  if (multi && (!status || status === "trial")) {
    try {
      grants = (await getCapabilityAccess().grants()) ?? [];
    } catch {
      grants = "unavailable";
    }
  }
  return resolveCommercialState({ multi, tenantId: ctx?.tenantId ?? null, status, grants, now: Date.now(), exempt: exemptTenantsFromEnv() });
}

// ── Integraciones de pago ─────────────────────────────────────────────────────

export async function integrationAllowedNow(id: PaidIntegration, state?: CommercialState): Promise<boolean> {
  const s = state ?? (await currentCommercialState());
  const ok = integrationAllowed(s, id);
  if (!ok) opsLog("warn", "TrialRestrictions", "integration_blocked", { tenantId: s.tenantId, integration: id });
  return ok;
}

/** Lanza FORBIDDEN con un mensaje claro si la integración no está disponible en la prueba. */
export async function assertIntegrationAllowed(id: PaidIntegration, state?: CommercialState): Promise<void> {
  if (!(await integrationAllowedNow(id, state))) {
    throw new TRPCError({ code: "FORBIDDEN", message: trialIntegrationMessage(id), cause: new Error("trial_integration_blocked") });
  }
}

// ── Cuotas de prueba ──────────────────────────────────────────────────────────

export interface TrialQuotaDeps {
  state?: () => Promise<CommercialState>;
  /** Consumo en la ventana (por defecto, el que mide Elephant Resource Manager). null: sin medición. */
  usage?: (tenantId: string, metric: string, period: "minute" | "hour" | "day" | "month") => Promise<number | null>;
}

const ermUsage: NonNullable<TrialQuotaDeps["usage"]> = async (tenantId, metric, period) => {
  const erm = getErm();
  if (!erm) return null;
  return (await erm.engine.usage(tenantId, metric, period)).used;
};

/**
 * Aplica la cuota de prueba de `metric` (si la empresa está en prueba). Lanza `QuotaExceededError` (la misma que el
 * Resource Manager, con su tratamiento habitual) si se superaría.
 */
export async function enforceTrialQuota(metric: string, quantity: number, deps: TrialQuotaDeps = {}): Promise<void> {
  const q = TRIAL_QUOTA_POLICY.find((x) => x.metric === metric);
  if (!q) return;
  const s = await (deps.state ?? currentCommercialState)();
  if (!s.restricted || !s.tenantId) return;
  const used = await (deps.usage ?? ermUsage)(s.tenantId, metric, q.period).catch(() => null);
  if (used === null) return;
  if (trialQuotaExceeded(q, used, quantity)) {
    opsLog("warn", "TrialRestrictions", "trial_quota_exceeded", { tenantId: s.tenantId, metric, period: q.period, limit: q.limit });
    throw new QuotaExceededError(metric, { allowed: false, reason: "exceeded", metric, limit: q.limit, used, period: q.period });
  }
}

// ── Correo ────────────────────────────────────────────────────────────────────

export interface TrialMailDeps extends TrialQuotaDeps {
  /** Buzones propios de la empresa entre los candidatos (usuarios del panel). null: no se pudo consultar. */
  ownMailboxes?: (candidates: string[]) => Promise<Set<string> | null>;
  /** Direcciones de la configuración de correo de la empresa (remitente y responder-a). */
  configMailboxes?: () => string[];
}

interface MailLike {
  to: string | string[];
  cc?: string | string[];
  category?: string;
}

async function defaultOwnMailboxes(candidates: string[]): Promise<Set<string> | null> {
  const { panelUserMailboxes } = await import("./subscriptionDb");
  return panelUserMailboxes(candidates);
}

async function defaultConfigMailboxes(): Promise<string[]> {
  const { tenantCommsConfig } = await import("./tenantBrand");
  const c = tenantCommsConfig();
  return [c.fromEmail, c.replyTo].filter((e): e is string => !!e);
}

/**
 * Política de correo de la prueba. Devuelve el envío (con los destinatarios permitidos) o null si no debe salir.
 * Los transaccionales de acceso pasan siempre sin tocar.
 */
export async function applyTrialMailPolicy<T extends MailLike>(params: T, deps: TrialMailDeps = {}): Promise<T | null> {
  if (params.category && TRIAL_MAIL_ALWAYS_ALLOWED.has(params.category)) return params;
  const s = await (deps.state ?? currentCommercialState)();
  if (!s.restricted) return params;
  try {
    await enforceTrialQuota("email.sent", 1, { ...deps, state: async () => s });
  } catch (e) {
    if (e instanceof QuotaExceededError) return null;
    throw e;
  }
  const candidates = [...(Array.isArray(params.to) ? params.to : [params.to]), ...(params.cc === undefined ? [] : Array.isArray(params.cc) ? params.cc : [params.cc])].map(normalizeMailbox);
  const own = new Set<string>((deps.configMailboxes ? deps.configMailboxes() : await defaultConfigMailboxes().catch(() => [])).map(normalizeMailbox));
  const users = await (deps.ownMailboxes ?? defaultOwnMailboxes)(candidates).catch(() => null);
  users?.forEach((u) => own.add(normalizeMailbox(u)));
  const r = splitTrialRecipients(params.to, params.cc, own);
  if (r.removed) opsLog("info", "TrialRestrictions", "trial_mail_third_parties_removed", { tenantId: s.tenantId, removed: r.removed, category: params.category ?? null });
  if (!r.to.length) return null;
  return { ...params, to: r.to, ...(params.cc !== undefined ? { cc: r.cc } : {}) };
}
