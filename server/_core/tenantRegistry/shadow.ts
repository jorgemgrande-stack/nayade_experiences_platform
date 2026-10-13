/**
 * Modo sombra: antes de activar el modo multiempresa, cada petición se resuelve en el
 * registro y se COMPARA con el comportamiento actual (un único tenant), sin ningún efecto
 * sobre la petición: no bloquea, no cambia de BD, no responde distinto, no lanza.
 *
 * Resultado: contadores (`tenant.shadow`) y avisos de discrepancia con limitación de
 * frecuencia. Cuando no haya discrepancias durante un periodo razonable, se puede activar
 * `TENANT_MODE=multi`.
 */
import type { NextFunction, Request, Response } from "express";
import { Metrics, meter } from "../metering";
import type { TenantResolver } from "./resolver";

export type ShadowVerdict = "match" | "mismatch" | "unknown_domain" | "blocked" | "unavailable";

export interface ShadowResult {
  verdict: ShadowVerdict;
  /** Tenant que resolvió el registro (si lo hubo). */
  resolvedTenantId?: string;
}

/** Compara la resolución del registro con el tenant que hoy atiende la petición. */
export async function evaluateShadow(
  resolver: TenantResolver,
  rawHost: unknown,
  currentTenantId: string,
): Promise<ShadowResult> {
  const out = await resolver.resolveHost(rawHost);
  switch (out.kind) {
    case "resolved":
      return out.tenant.tenantId === currentTenantId
        ? { verdict: "match", resolvedTenantId: out.tenant.tenantId }
        : { verdict: "mismatch", resolvedTenantId: out.tenant.tenantId };
    case "blocked":
      return { verdict: "blocked", resolvedTenantId: out.tenantId };
    case "unknown_domain":
      return { verdict: "unknown_domain" };
    case "unavailable":
      return { verdict: "unavailable" };
  }
}

export interface ShadowOptions {
  /** Tenant que hoy atiende todo el tráfico (p. ej. el de Náyade). */
  currentTenantId: string;
  /** Mínimo entre avisos del mismo host y veredicto (ms). */
  warnEveryMs?: number;
  now?: () => number;
  log?: (line: string) => void;
}

export function shadowMiddleware(resolver: TenantResolver, opts: ShadowOptions) {
  const every = opts.warnEveryMs ?? 60_000;
  const now = opts.now ?? Date.now;
  const log = opts.log ?? ((l) => console.warn(l));
  const lastWarn = new Map<string, number>();

  return (req: Request, _res: Response, next: NextFunction) => {
    // Siempre se continúa de inmediato: la evaluación va «en segundo plano».
    next();
    const host = req.headers.host;
    evaluateShadow(resolver, host, opts.currentTenantId)
      .then((r) => {
        meter(Metrics.TENANT_SHADOW, 1, "count", { verdict: r.verdict });
        if (r.verdict === "match") return;
        const key = `${String(host)}|${r.verdict}`;
        const t = now();
        if (t - (lastWarn.get(key) ?? 0) < every) return;
        lastWarn.set(key, t);
        if (lastWarn.size > 1000) lastWarn.clear();
        log(
          JSON.stringify({
            ctx: "TenantShadow",
            verdict: r.verdict,
            host: typeof host === "string" ? host.slice(0, 120) : null,
            expected: opts.currentTenantId,
            resolved: r.resolvedTenantId ?? null,
          }),
        );
      })
      .catch(() => {
        /* la sombra nunca afecta a la petición */
      });
  };
}
