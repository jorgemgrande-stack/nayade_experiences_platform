/**
 * Fuente de la pantalla «Ventas» (CRM) para las pruebas que leen el código.
 *
 * `CRMDashboard.tsx` se dividió en un contenedor fino (`crm/CRMDashboard.tsx`) más un módulo por
 * pestaña (`crm/tabs/`), los diálogos grandes (`crm/modals/`) y lo compartido (`crm/shared/`).
 * Las pruebas de texto que antes leían un único fichero leen ahora la suma de todos, de modo que
 * siguen comprobando lo mismo estén donde estén las líneas.
 */
import fs from "node:fs";
import path from "node:path";

const CRM_DIR = path.resolve(__dirname, "../client/src/pages/admin/crm");
const SUBDIRS = ["tabs", "modals", "shared"] as const;

/** Rutas (relativas a `client/src/pages/admin/crm`) de todos los ficheros que salieron de CRMDashboard.tsx. */
export function crmDashboardFiles(): string[] {
  const out = ["CRMDashboard.tsx"];
  for (const d of SUBDIRS) {
    const dir = path.join(CRM_DIR, d);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir).sort()) if (/\.tsx?$/.test(f)) out.push(`${d}/${f}`);
  }
  return out;
}

/** Texto de CRMDashboard.tsx y de los módulos en que se dividió, concatenado. */
export function crmDashboardFuentes(): string {
  return crmDashboardFiles().map((f) => fs.readFileSync(path.join(CRM_DIR, f), "utf8")).join("\n");
}
