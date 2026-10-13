/**
 * Registro de módulos instalados en el proceso: valida manifiestos, compatibilidad con el
 * Core y dependencias, y calcula el orden de activación (dependencias primero).
 */
import {
  MODULE_ID_RE,
  ModuleError,
  PERMISSION_KEY_RE,
  type ModuleManifest,
  type NavigationItem,
} from "./contract";
import { parseVersion, satisfies } from "./semver";

export function validateManifest(m: ModuleManifest): void {
  if (!MODULE_ID_RE.test(m.id)) throw new ModuleError("invalid_manifest", `Identificador de módulo no válido: ${m.id}`);
  if (!m.name?.trim()) throw new ModuleError("invalid_manifest", `${m.id}: falta el nombre`);
  if (!parseVersion(m.version)) throw new ModuleError("invalid_manifest", `${m.id}: versión no válida`);
  if (!m.coreRange) throw new ModuleError("invalid_manifest", `${m.id}: falta coreRange`);
  for (const p of m.permissions ?? []) {
    if (!PERMISSION_KEY_RE.test(p.key) || !p.key.startsWith(`${m.id}.`)) {
      throw new ModuleError("invalid_manifest", `${m.id}: el permiso ${p.key} debe empezar por "${m.id}."`);
    }
  }
  const ids = new Set<string>();
  for (const n of m.navigation ?? []) {
    if (ids.has(n.id)) throw new ModuleError("invalid_manifest", `${m.id}: entrada de navegación duplicada ${n.id}`);
    ids.add(n.id);
    if (!n.path.startsWith("/")) throw new ModuleError("invalid_manifest", `${m.id}: ruta de navegación no válida`);
    if (n.permission && !(m.permissions ?? []).some((p) => p.key === n.permission)) {
      throw new ModuleError("invalid_manifest", `${m.id}: permiso de navegación no declarado (${n.permission})`);
    }
  }
}

export class ModuleRegistry {
  private modules = new Map<string, ModuleManifest>();

  constructor(private coreVersion: string) {
    if (!parseVersion(coreVersion)) throw new Error("Versión del Core no válida");
  }

  register(m: ModuleManifest): void {
    validateManifest(m);
    if (this.modules.has(m.id)) throw new ModuleError("duplicate", `Módulo ya registrado: ${m.id}`);
    if (!satisfies(this.coreVersion, m.coreRange)) {
      throw new ModuleError("incompatible", `${m.id} ${m.version} requiere Core ${m.coreRange} (actual ${this.coreVersion})`);
    }
    this.modules.set(m.id, m);
  }

  /** Retira un módulo (carga fallida). */
  unregister(id: string): void {
    this.modules.delete(id);
  }

  get(id: string): ModuleManifest | undefined {
    return this.modules.get(id);
  }

  list(): ModuleManifest[] {
    return Array.from(this.modules.values());
  }

  /** Comprueba dependencias y ciclos de todo el conjunto registrado. */
  validate(): void {
    for (const m of Array.from(this.modules.values())) {
      for (const d of m.dependsOn ?? []) {
        const dep = this.modules.get(d.id);
        if (!dep) throw new ModuleError("missing_dependency", `${m.id} depende de ${d.id}, que no está instalado`);
        if (!satisfies(dep.version, d.range)) {
          throw new ModuleError("incompatible", `${m.id} requiere ${d.id} ${d.range} (instalado ${dep.version})`);
        }
      }
    }
    this.activationOrder(); // lanza si hay ciclos
  }

  /** Orden topológico: las dependencias van antes. */
  activationOrder(): string[] {
    const order: string[] = [];
    const state = new Map<string, 1 | 2>();
    const visit = (id: string, trail: string[]) => {
      if (state.get(id) === 2) return;
      if (state.get(id) === 1) throw new ModuleError("cycle", `Dependencia circular: ${[...trail, id].join(" -> ")}`);
      state.set(id, 1);
      for (const d of this.modules.get(id)?.dependsOn ?? []) if (this.modules.has(d.id)) visit(d.id, [...trail, id]);
      state.set(id, 2);
      order.push(id);
    };
    for (const id of Array.from(this.modules.keys()).sort()) visit(id, []);
    return order;
  }

  /** Módulos que dependen (directa o indirectamente) de `id`. */
  dependents(id: string): string[] {
    const out = new Set<string>();
    const walk = (target: string) => {
      for (const m of Array.from(this.modules.values())) {
        if ((m.dependsOn ?? []).some((d) => d.id === target) && !out.has(m.id)) {
          out.add(m.id);
          walk(m.id);
        }
      }
    };
    walk(id);
    return Array.from(out);
  }

  /** Cierre transitivo de dependencias de `id` (incluye `id`). */
  withDependencies(id: string): string[] {
    const out = new Set<string>();
    const walk = (x: string) => {
      if (out.has(x)) return;
      out.add(x);
      for (const d of this.modules.get(x)?.dependsOn ?? []) walk(d.id);
    };
    walk(id);
    return Array.from(out);
  }

  /** Navegación de un conjunto de módulos, filtrada por los permisos del usuario. */
  navigation(
    activeModuleIds: Iterable<string>,
    hasPermission: (key: string) => boolean,
  ): Array<NavigationItem & { moduleId: string }> {
    const items: Array<NavigationItem & { moduleId: string }> = [];
    for (const id of Array.from(activeModuleIds)) {
      const m = this.modules.get(id);
      if (!m) continue;
      for (const n of m.navigation ?? []) {
        if (n.permission && !hasPermission(n.permission)) continue;
        items.push({ ...n, moduleId: id });
      }
    }
    return items.sort((a, b) => (a.order ?? 100) - (b.order ?? 100) || a.label.localeCompare(b.label));
  }
}
