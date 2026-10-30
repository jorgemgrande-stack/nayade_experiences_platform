/**
 * Cuotas de negocio del catálogo aplicadas en el Core (empresa en curso), con la política efectiva: plan + ampliaciones
 * + excepción comercial vigente (o el valor por defecto de la plataforma).
 *
 *  - Solo en modo `multi`: en instalación única no se limita nada (como hasta ahora).
 *  - Solo en altas MANUALES del panel. Nunca en autenticación, cobros, reservas, formularios públicos ni recuperación.
 *  - Si las licencias no se pueden leer, NO se bloquea (se registra): un fallo del registro no debe impedir trabajar con
 *    contactos. (Los usuarios siguen su propia regla, que falla cerrada: server/setupWizardDb.ts.)
 *  - Superar el límite en una cuota dura → 403 con un mensaje claro. Aviso y crítico solo se registran.
 */
import { TRPCError } from "@trpc/server";
import { getCapabilityAccess } from "./_core/capabilities/access";
import { getQuotaExceptionAccess } from "./_core/erm/exceptionAccess";
import { policyOf, quotaVerdict, type QuotaException } from "./_core/erm/policy";
import { opsLog } from "./_core/ops/log";
import { getTenantId, getTenantMode } from "./_core/tenant";
import { licenceSummary } from "./planSeats";
import { businessLimit, type BusinessLimit } from "./quotaPolicyCatalog";

const fmt = (n: number) => n.toLocaleString("es-ES");

export function quotaExceededMessage(eff: Pick<BusinessLimit, "label" | "unit" | "limit" | "source">, used: number): string {
  const origin = eff.source === "exception" ? "la ampliación temporal concedida" : "tu plan";
  return `Has alcanzado el límite de ${eff.label.toLowerCase()} de ${origin} (${fmt(eff.limit ?? 0)} ${eff.unit}; ahora tienes ${fmt(used)}). Amplía tu plan o pide una ampliación a Big Elephant para dar de alta más.`;
}

/** Límite efectivo de una cuota de negocio para la empresa en curso; null si no se aplica (sin plan, single o sin dato). */
export async function currentBusinessLimit(metric: string): Promise<BusinessLimit | null> {
  const policy = policyOf(metric);
  if (!policy || policy.enforcement === "none" || getTenantMode() !== "multi") return null;
  const access = getCapabilityAccess();
  let grants;
  try {
    grants = await access.grants();
  } catch (e) {
    opsLog("warn", "BusinessQuota", "grants_unavailable", { metric, error: e instanceof Error ? e.name : "error" });
    return null;
  }
  const now = access.currentTime();
  const plan = licenceSummary(grants, now).plan;
  if (!plan) return null; // instalación anterior a las licencias: no se limita nada
  const exc = await getQuotaExceptionAccess()?.active(metric).catch(() => null);
  const exceptions: QuotaException[] = exc ? [exc] : [];
  return businessLimit(policy, { grants, contracted: [], exceptions, now }, plan);
}

/**
 * Comprueba que cabe `adding` más de la métrica. `count` da el uso actual (solo se consulta si hay límite).
 * Lanza 403 si la cuota es dura y se superaría.
 */
export async function assertBusinessQuota(metric: string, count: () => Promise<number>, adding = 1): Promise<void> {
  const eff = await currentBusinessLimit(metric);
  if (!eff || eff.limit === null) return;
  const used = await count();
  const v = quotaVerdict(eff, used, adding);
  if (!v.allowed) {
    opsLog("info", "BusinessQuota", "blocked", { tenantId: safeTenant(), metric, used, limit: eff.limit, source: eff.source });
    throw new TRPCError({ code: "FORBIDDEN", message: quotaExceededMessage(eff, used) });
  }
  if (v.level !== "ok") opsLog("warn", "BusinessQuota", v.level, { tenantId: safeTenant(), metric, used: used + adding, limit: eff.limit, source: eff.source });
}

function safeTenant(): string | null {
  try {
    return getTenantId();
  } catch {
    return null;
  }
}
