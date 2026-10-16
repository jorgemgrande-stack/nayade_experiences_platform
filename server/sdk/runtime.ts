/**
 * Instancia del SDK en el proceso: registro de módulos, guardián de licencias y bus de eventos.
 *
 * Es independiente del registro global de módulos del Core (`getModuleRegistry`): registrar aquí un
 * módulo del SDK no cambia el catálogo de módulos del plano de control ni las licencias por módulo.
 */
import type { SdkModuleDefinition } from "./contract";
import { EventBus } from "./events";
import { ModuleGate, SdkModuleRegistry } from "./registry";

export interface SdkRuntime {
  registry: SdkModuleRegistry;
  gate: ModuleGate;
  events: EventBus<any>;
}

let runtime: SdkRuntime | null = null;

export function getSdkRuntime(): SdkRuntime {
  if (!runtime) {
    const registry = new SdkModuleRegistry();
    runtime = { registry, gate: new ModuleGate(registry), events: new EventBus() };
  }
  return runtime;
}

/** Idempotente: registra (y valida) el módulo si no lo estaba. */
export function installSdkModule(def: SdkModuleDefinition<any>): SdkRuntime {
  const rt = getSdkRuntime();
  if (!rt.registry.get(def.manifest.id)) rt.registry.registerAll([def]);
  return rt;
}

/** Solo pruebas. */
export function _resetSdkRuntimeForTests(): void {
  runtime = null;
}
