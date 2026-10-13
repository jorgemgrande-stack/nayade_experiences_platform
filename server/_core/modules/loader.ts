/**
 * Cargador de módulos externos.
 *
 * Cada entrada de `ELEPHANT_MODULES` (lista separada por comas) es la ruta de un paquete
 * ESM de módulo. Para cada uno: importa, valida el manifiesto contra el Core y los demás
 * módulos, monta su router licenciado y expone sus migraciones. Un módulo defectuoso no
 * impide arrancar al resto ni al Core: se registra el fallo y se omite (y se desregistra).
 */
import express, { type Express } from "express";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { getTenantId } from "../tenant";
import { getSystemSetting } from "../../config";
import { getTenantDatabase } from "../dbRegistry";
import { ModuleError, type ModuleManifest } from "./contract";
import { requireModuleHttp } from "./guard";
import type { ModuleAccess } from "./entitlements";
import type { ModuleRegistry } from "./registry";
import { MODULE_SDK_VERSION, type ModuleContext, type ModuleDefinition } from "./sdk";

export interface LoadedModule {
  manifest: ModuleManifest;
  /** Directorio raíz del paquete (para resolver `migrationsDir`). */
  root: string;
}

export interface LoadReport {
  loaded: LoadedModule[];
  failed: Array<{ spec: string; error: string }>;
}

const loadedModules: LoadedModule[] = [];

/** Módulos externos cargados en este proceso. */
export function getLoadedModules(): LoadedModule[] {
  return loadedModules.slice();
}

/** Solo pruebas. */
export function _resetLoadedModulesForTests(): void {
  loadedModules.length = 0;
}

const context: ModuleContext = {
  tenantId: () => getTenantId(),
  db: () => getTenantDatabase(),
  setting: (k, fb = "") => getSystemSetting(k, fb),
  log: (event, data) => console.warn(JSON.stringify({ ctx: "Module", event, ...data })),
};

function isDefinition(x: unknown): x is ModuleDefinition {
  const d = x as ModuleDefinition;
  return !!d && typeof d === "object" && !!d.manifest && typeof d.register === "function";
}

function entryFile(abs: string): string {
  return abs.endsWith(".mjs") || abs.endsWith(".js") ? abs : path.join(abs, "index.mjs");
}

export async function loadModules(
  specs: string[],
  deps: { app: Express; registry: ModuleRegistry; access: ModuleAccess; baseDir?: string },
): Promise<LoadReport> {
  const report: LoadReport = { loaded: [], failed: [] };
  for (const spec of specs.map((s) => s.trim()).filter(Boolean)) {
    let registeredId: string | null = null;
    try {
      const file = entryFile(path.resolve(deps.baseDir ?? process.cwd(), spec));
      const mod = await import(pathToFileURL(file).href);
      const def = mod.default as unknown;
      if (!isDefinition(def)) throw new ModuleError("invalid_manifest", "El módulo no exporta una definición válida");
      const sdkRange = (def.manifest as ModuleManifest & { sdk?: string }).sdk;
      if (sdkRange && sdkRange.split(".")[0] !== MODULE_SDK_VERSION.split(".")[0]) {
        throw new ModuleError("incompatible", `SDK ${sdkRange} no compatible con ${MODULE_SDK_VERSION}`);
      }
      deps.registry.register(def.manifest); // valida manifiesto y compatibilidad con el Core
      registeredId = def.manifest.id;
      deps.registry.validate(); // dependencias y ciclos con lo ya cargado
      const router = express.Router();
      await def.register({ router, context });
      deps.app.use(`/api/modules/${def.manifest.id}`, requireModuleHttp(deps.access, def.manifest.id), router);
      const entry: LoadedModule = { manifest: def.manifest, root: path.dirname(file) };
      report.loaded.push(entry);
      loadedModules.push(entry);
    } catch (e) {
      if (registeredId) deps.registry.unregister(registeredId);
      report.failed.push({ spec, error: e instanceof Error ? e.message.slice(0, 200) : "error" });
    }
  }
  return report;
}

export function modulesFromEnv(env: NodeJS.ProcessEnv = process.env): string[] {
  return (env.ELEPHANT_MODULES ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}

/**
 * Lee manifiestos de módulos externos SIN montarlos (CLI y operaciones): importa el paquete y
 * devuelve manifiesto + raíz. Los que fallan se omiten.
 */
export async function readModuleManifests(specs: string[], baseDir = process.cwd()): Promise<LoadedModule[]> {
  const out: LoadedModule[] = [];
  for (const spec of specs.map((s) => s.trim()).filter(Boolean)) {
    try {
      const file = entryFile(path.resolve(baseDir, spec));
      const def = (await import(pathToFileURL(file).href)).default as unknown;
      if (isDefinition(def)) out.push({ manifest: def.manifest, root: path.dirname(file) });
    } catch {
      /* módulo ilegible: se omite */
    }
  }
  return out;
}
