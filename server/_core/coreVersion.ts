/**
 * Versión de Elephant Core que ve el panel de la empresa («Acerca de Elephant Core»).
 *
 * La versión y su fecha salen de `shared/version.ts` (fuente única). El commit desplegado es el mismo
 * que registra el paquete de recuperación (`ES_DEPLOY_COMMIT || RAILWAY_GIT_COMMIT_SHA`), abreviado a
 * 7 caracteres y SOLO para administradores: a un usuario normal no le aporta nada. `/healthz` sigue
 * sin versión (ver health.ts).
 */
import { CORE_RELEASED_AT, CORE_VERSION } from "../../shared/version";

export interface CoreVersionInfo {
  version: string;
  releasedAt: string | null;
  /** Commit desplegado (7 caracteres) o null si no se conoce o el usuario no es administrador. */
  commit: string | null;
}

const SHA = /^[0-9a-f]{7,40}$/i;

/** Commit desplegado abreviado, o null si el entorno no lo trae o no parece un SHA. */
export function deployedCommit(env: Record<string, string | undefined> = process.env): string | null {
  const raw = (env.ES_DEPLOY_COMMIT || env.RAILWAY_GIT_COMMIT_SHA || "").trim();
  return SHA.test(raw) ? raw.slice(0, 7).toLowerCase() : null;
}

export function coreVersionInfo(opts: { isAdmin: boolean; env?: Record<string, string | undefined> }): CoreVersionInfo {
  return {
    version: CORE_VERSION,
    releasedAt: /^\d{4}-\d{2}-\d{2}$/.test(CORE_RELEASED_AT) ? CORE_RELEASED_AT : null,
    commit: opts.isAdmin ? deployedCommit(opts.env) : null,
  };
}
