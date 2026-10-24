/**
 * Versiones de esquema de las empresas: la última migración disponible en esta versión del código (db/migrations,
 * incluida en la imagen del plano de control) frente a la aplicada en cada empresa (registro). Solo lectura.
 * El código es único para todas las empresas; lo que varía por empresa es su esquema.
 */
import fs from "node:fs";
import path from "node:path";

const MIGRATION_RE = /^(\d{4}_[a-z0-9_]+)\.sql$/;

/** Migraciones de empresa disponibles (sin las de vuelta atrás), en orden. */
export function tenantMigrations(dir = path.resolve(process.cwd(), "db/migrations")): string[] {
  try {
    return fs
      .readdirSync(dir)
      .map((f) => MIGRATION_RE.exec(f)?.[1])
      .filter((x): x is string => !!x)
      .sort();
  } catch {
    return [];
  }
}

export type SchemaState = "up_to_date" | "behind" | "ahead" | "unknown";

export function schemaState(applied: string | null, latest: string | null, known: string[]): SchemaState {
  if (!applied || !latest) return "unknown";
  if (applied === latest) return "up_to_date";
  const i = known.indexOf(applied);
  if (i < 0) return applied > latest ? "ahead" : "unknown";
  return "behind";
}

export function pendingCount(applied: string | null, known: string[]): number | null {
  if (!applied) return null;
  const i = known.indexOf(applied);
  return i < 0 ? null : known.length - 1 - i;
}
