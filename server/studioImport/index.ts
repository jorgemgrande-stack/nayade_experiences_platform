/**
 * Función de servidor reutilizable de la importación de Studio: ejecuta un documento contra UN tenant. El contexto de
 * tenant y el arriendo de su base de datos se fijan aquí (`withTenantDb`), de modo que todo lo que escribe el motor
 * (páginas, medios, registro) va a la BD y al almacén de ese tenant y a ningún otro.
 */
import { withTenantDb } from "../_core/dbRegistry";
import { realImportDeps } from "./adapters";
import { runImport, type ImportDeps, type ImportOptions, type ImportReport } from "./engine";

export type StudioImportOptions = Omit<ImportOptions, "tenant"> & { deps?: ImportDeps };

export function runStudioImport(tenant: string, document: unknown, opts: StudioImportOptions): Promise<ImportReport> {
  const { deps, ...rest } = opts;
  return withTenantDb(tenant, () => runImport(document, deps ?? realImportDeps(), { ...rest, tenant }));
}

export * from "./engine";
export { downloadMedia, MEDIA_ALLOWED_MIME } from "./download";
