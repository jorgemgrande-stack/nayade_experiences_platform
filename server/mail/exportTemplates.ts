/**
 * Avisos de la exportación de datos de una EMPRESA (Core), puros: con la marca de la empresa y el diseño común, a
 * la persona propietaria que la pidió. NUNCA llevan el enlace de descarga (es la autorización del ZIP y un correo
 * se reenvía o se queda en buzones ajenos): el botón lleva a la pantalla de exportación del panel, que exige sesión.
 */
import { layout, platformBrand } from "./templates";

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
  const m = layout(platformBrand(), v.warning ? "Tu exportación de datos está lista, con avisos" : "Tu exportación de datos está lista", [`La exportación de datos de ${brand} que solicitaste ya se ha generado, en un ZIP con CSV y JSON.`], panel(v.panelUrl), {
    family: "security",
    eyebrow: "Exportación de datos",
    greeting: v.name ? `Hola, ${v.name}:` : "Hola:",
    blocks: [
      { card: { status: { label: v.warning ? "Lista, con avisos" : "Lista", tone: v.warning ? "warning" : "success" }, rows: [{ label: "Tablas", value: n(v.tables, "tabla", "tablas") }, { label: "Filas", value: n(v.rows, "fila", "filas") }, { label: "Ficheros", value: n(v.files, "fichero", "ficheros") }], foot: { label: "Disponible hasta", value: `${when(v.expiresAt)} (hora de Madrid)` } } },
      ...(v.warning ? [{ notice: { tone: "warning" as const, text: `Atención: ${v.warning}` } }] : []),
      { notice: { tone: "info", text: "Descárgala desde el panel con tu sesión. Por seguridad, este correo no incluye el enlace de descarga." } },
      { p: "Si no has solicitado esta exportación, avisa cuanto antes a soporte." },
    ],
  });
  return { subject: `${v.warning ? "Exportación de datos lista, con avisos" : "Exportación de datos lista"} — ${brand}`, html: m.html, text: m.text };
}

export function exportFailedContent(brand: string, v: { name: string | null; reason: string; panelUrl: string | null }) {
  const m = layout(platformBrand(), "No se ha podido generar tu exportación de datos", [`La exportación de datos de ${brand} que solicitaste no se ha podido generar.`], panel(v.panelUrl), {
    family: "security",
    eyebrow: "Exportación de datos",
    greeting: v.name ? `Hola, ${v.name}:` : "Hola:",
    blocks: [{ notice: { tone: "error", text: v.reason } }, { p: "Tus datos no se han modificado. Puedes volver a solicitarla desde el panel; si vuelve a fallar, contacta con soporte." }],
  });
  return { subject: `No se ha podido generar la exportación de datos — ${brand}`, html: m.html, text: m.text };
}
