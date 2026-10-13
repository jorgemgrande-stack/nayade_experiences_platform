/**
 * SDK de módulos de Elephant Source (contrato para repositorios de módulos).
 *
 * Un módulo externo es un paquete ESM cuyo `default` export cumple `ModuleDefinition`:
 *
 *   export default defineModule({
 *     manifest: { id: "ski", name: "Ski", version: "1.0.0", kind: "sector", coreRange: "^1.0.0", ... },
 *     register(host) { host.router.get("/ping", (_req, res) => res.json({ ok: true })); },
 *   });
 *
 * El Core monta su router en `/api/modules/<id>` detrás de la comprobación de licencia, con el
 * tenant ya resuelto, y aplica sus migraciones (`manifest.migrationsDir`) por tenant.
 */
import type { Router } from "express";
import type { ModuleManifest } from "./contract";

export const MODULE_SDK_VERSION = "1.0.0";

export interface ModuleContext {
  /** Tenant de la operación en curso (lanza fuera de una petición/tarea). */
  tenantId(): string;
  /** Pool de la BD del tenant en curso. */
  db(): Promise<import("../dbRegistry").Database | null>;
  /** Ajustes del tenant (lectura). */
  setting(key: string, fallback?: string): Promise<string>;
  /** Escribe un aviso estructurado (sin datos personales). */
  log(event: string, data?: Record<string, string | number | boolean | null>): void;
}

export interface ModuleHost {
  /** Router montado en `/api/modules/<id>`; ya licenciado y con tenant. */
  router: Router;
  context: ModuleContext;
}

export interface ModuleDefinition {
  manifest: ModuleManifest;
  register(host: ModuleHost): void | Promise<void>;
}

export function defineModule(def: ModuleDefinition): ModuleDefinition {
  return def;
}
