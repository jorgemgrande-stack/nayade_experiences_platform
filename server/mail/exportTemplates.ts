/**
 * Avisos de la exportación de datos de una EMPRESA (Core), puros: con la marca de la empresa y el diseño común, a
 * la persona propietaria que la pidió. NUNCA llevan el enlace de descarga (es la autorización del ZIP y un correo
 * se reenvía o se queda en buzones ajenos): el botón lleva a la pantalla de exportación del panel, que exige sesión.
 */
import { layout } from "./templates";

/** Pantalla de exportación del panel de la empresa (destino del botón de los avisos). */
export const EXPORT_PANEL_PATH = "/admin/suscripcion/exportar";

const when = (ms: number) => new Date(ms).toLocaleString("es-ES", { timeZone: "Europe/Madrid", dateStyle: "long", timeStyle: "short" });
const n = (x: number, one: string, many: string) => `${x.toLocaleString("es-ES")} ${x === 1 ? one : many}`;
const panel = (url: string | null) => (url ? { label: "Ir a la exportación", url } : null);

export interface ExportReadyVars {
  name: string | null;
  tables: number;
  rows: number;
  files: number;
  /** Aviso de exportación incompleta (p. ej. ficheros que no estaban en el almacenamiento), o null. */
  warning: string | null;
  expiresAt: number;
  /** URL https de la pantalla de exportación del panel de la empresa, o null (sin botón). */
  panelUrl: string | null;
}

export function exportReadyContent(brand: string, v: ExportReadyVars) {
  const m = layout({ name: brand }, v.warning ? "Tu exportación de datos está lista, con avisos" : "Tu exportación de datos está lista", [
    v.name ? `Hola ${v.name},` : "Hola,",
    `La exportación de datos de ${brand} que solicitaste ya se ha generado: ${n(v.tables, "tabla", "tablas")} (${n(v.rows, "fila", "filas")}) y ${n(v.files, "fichero", "ficheros")}, en un ZIP con CSV y JSON.`,
    ...(v.warning ? [`Atención: ${v.warning}`] : []),
    `Puedes descargarla desde el panel, con tu sesión, hasta el ${when(v.expiresAt)} (hora de Madrid). Por seguridad, este correo no incluye el enlace de descarga.`,
    "Si no has solicitado esta exportación, avisa cuanto antes a soporte.",
  ], panel(v.panelUrl));
  return { subject: `${v.warning ? "Exportación de datos lista, con avisos" : "Exportación de datos lista"} — ${brand}`, html: m.html, text: m.text };
}

export function exportFailedContent(brand: string, v: { name: string | null; reason: string; panelUrl: string | null }) {
  const m = layout({ name: brand }, "No se ha podido generar tu exportación de datos", [
    v.name ? `Hola ${v.name},` : "Hola,",
    `La exportación de datos de ${brand} que solicitaste no se ha podido generar: ${v.reason}`,
    "Tus datos no se han modificado. Puedes volver a solicitarla desde el panel; si vuelve a fallar, contacta con soporte.",
  ], panel(v.panelUrl));
  return { subject: `No se ha podido generar la exportación de datos — ${brand}`, html: m.html, text: m.text };
}
