/**
 * «Primera implantación sectorial» (11/11/2026): checklist reutilizable por solución Net (Hotel, Restaurant, Care,
 * Ski, Travel y Social Token) en lugar de los hitos genéricos. Se construye SOLO con datos del catálogo, sin textos
 * propios de cada producto:
 *
 *   1. Configuración: arranque, los requisitos de implantación del catálogo (`specs.ts` → `implementation.requirements`),
 *      formación y validación del cliente (hitos obligatorios).
 *   2. Comprobaciones funcionales: una por cada funcionalidad marcada como DISPONIBLE en `shared/netProducts.ts`
 *      (tipo «check», obligatorias). Lo que está «en implantación» queda como un pendiente NO obligatorio: nunca se
 *      presenta como terminado ni bloquea la puesta en marcha de lo disponible.
 *   3. Incidencias: hitos de tipo «incidencia» que el equipo añade cuando aparecen (no hay subsistema aparte); una
 *      incidencia abierta es obligatoria (bloquea «técnicamente preparada» hasta resolverse).
 *
 * Cualquier otra solución sigue con los hitos genéricos (`DEFAULT_MILESTONES`). Los expedientes que ya tienen hitos
 * los conservan: la plantilla solo se aplica a un expediente sin hitos.
 *
 * También da el texto de los COMPROMISOS DE IMPLANTACIÓN de un producto Net (alcance, disponible hoy y en
 * implantación) para las «condiciones especiales» de un paquete personalizado: mismo origen, mismas palabras.
 */
import { PRODUCT_SPECS } from "../catalog/commercial/specs";
import { netProductOf, type NetArea } from "../../shared/netProducts";
import { addonAssistedOf, assistedRegistryOf } from "../../shared/addonAssisted";

/**
 * Producto con plantilla propia: Net de empresa, Elephant Connect de contratación asistida (12/11/2026) o ampliación de
 * capacidad del Core (13/11/2026).
 */
type TemplateProduct = { key: string; name: string; areas: NetArea[]; note?: string };
const connectTemplate = (key: string): TemplateProduct | null => assistedRegistryOf(key);
import type { MilestoneKind } from "./store";

export interface ChecklistItem {
  title: string;
  kind: MilestoneKind;
  required: boolean;
  /** Sección de la checklist (configuración, comprobaciones, en implantación). */
  section: ChecklistSection;
  note?: string | null;
}
export type ChecklistSection = "configuracion" | "comprobaciones" | "en_implantacion" | "incidencias";
export interface ChecklistTemplate {
  /** Clave de la plantilla: la del producto, o «generic». */
  key: string;
  name: string;
  generic: boolean;
  items: ChecklistItem[];
}

export const SECTION_LABEL: Record<ChecklistSection, string> = {
  configuracion: "Configuración",
  comprobaciones: "Comprobaciones funcionales",
  en_implantacion: "En implantación (no bloquea)",
  incidencias: "Incidencias",
};

/** Soluciones con plantilla de primera implantación (las sectoriales de empresa; Life Net es personal y no lleva). */
export const SECTOR_TEMPLATE_KEYS = ["hotel-net-complete", "restaurant-net-complete", "care-net-complete", "ski-net-complete", "travel-net-complete", "social-token-net-complete"] as const;

const GENERIC: ChecklistItem[] = [
  { title: "Reunión de arranque con el cliente", kind: "milestone", required: true, section: "configuracion" },
  { title: "Configuración técnica del entorno", kind: "milestone", required: true, section: "configuracion" },
  { title: "Carga o migración de datos", kind: "milestone", required: true, section: "configuracion" },
  { title: "Formación del equipo del cliente", kind: "milestone", required: true, section: "configuracion" },
  { title: "Validación del cliente", kind: "milestone", required: true, section: "configuracion" },
];
export const GENERIC_TEMPLATE: ChecklistTemplate = { key: "generic", name: "Hitos genéricos de implantación", generic: true, items: GENERIC };

const t200 = (s: string) => (s.length > 200 ? `${s.slice(0, 197)}…` : s);
const features = (p: TemplateProduct, status: "available" | "coming_soon") => p.areas.flatMap((a) => a.features.filter((f) => f.status === status).map((f) => ({ area: a.title, label: f.label })));
const requirementsOf = (key: string) => PRODUCT_SPECS.find((s) => s.key === key)?.implementation.requirements ?? [];

/** Plantilla de una solución: la sectorial si la tiene; si no, la genérica. Pura. */
export function templateFor(solutionKey: string): ChecklistTemplate {
  const net = (SECTOR_TEMPLATE_KEYS as readonly string[]).includes(solutionKey) ? netProductOf(solutionKey) : null;
  const p: TemplateProduct | null = net ?? connectTemplate(solutionKey);
  if (!p) return GENERIC_TEMPLATE;
  // Ampliación de capacidad (13/11/2026): no hay entorno que preparar; se confirman las unidades y se comprueba que el
  // límite ampliado llega al panel tras la aceptación del contrato
  if (addonAssistedOf(solutionKey)) {
    const addonItems: ChecklistItem[] = [
      { title: t200(`Confirmar con el cliente las unidades de ${p.name}`), kind: "milestone", required: true, section: "configuracion" },
      ...features(p, "available").map((f): ChecklistItem => ({ title: t200(`Comprobar: ${f.label}`), kind: "check", required: true, section: "comprobaciones", note: f.area })),
      { title: "Comprobar en el panel del cliente el límite ampliado tras la aceptación del contrato", kind: "check", required: true, section: "comprobaciones" },
    ];
    return { key: p.key, name: `Implantación de ${p.name}`, generic: false, items: addonItems };
  }
  const items: ChecklistItem[] = [
    { title: `Reunión de arranque de ${p.name} con el cliente`, kind: "milestone", required: true, section: "configuracion" },
    ...requirementsOf(p.key).map((r): ChecklistItem => ({ title: t200(r), kind: "milestone", required: true, section: "configuracion" })),
    { title: "Carga de los datos iniciales del cliente", kind: "milestone", required: true, section: "configuracion" },
    ...features(p, "available").map((f): ChecklistItem => ({ title: t200(`Comprobar: ${f.label}`), kind: "check", required: true, section: "comprobaciones", note: f.area })),
    { title: "Formación del equipo del cliente", kind: "milestone", required: true, section: "configuracion" },
    { title: "Validación del cliente (recorrido completo)", kind: "milestone", required: true, section: "configuracion" },
  ];
  const soon = features(p, "coming_soon");
  if (soon.length) items.push({ title: t200(`En implantación, incluido sin coste: ${soon.map((f) => f.label).join(", ")}`), kind: "pending", required: false, section: "en_implantacion", note: `${soon.map((f) => f.label).join(", ")}. Se comunica al cliente como «en implantación»; no bloquea la puesta en marcha de lo disponible.`.slice(0, 1000) });
  return { key: p.key, name: net ? `Primera implantación sectorial — ${p.name}` : `Implantación de ${p.name}`, generic: false, items };
}

/** Sección de un hito ya guardado (para pintar la checklist; los genéricos son de configuración). Pura. */
export function sectionOf(m: { kind: MilestoneKind; required: boolean }): ChecklistSection {
  if (m.kind === "incidencia") return "incidencias";
  if (m.kind === "check") return "comprobaciones";
  if (m.kind === "pending" && !m.required) return "en_implantacion";
  return "configuracion";
}

/** Detalle del evento «checklist» (el historial guarda la plantilla aplicada): `<clave> · <nombre>`. */
export const checklistEventDetail = (t: ChecklistTemplate) => `${t.key} · ${t.name} (${t.items.length} tareas)`;
export const checklistKeyOf = (detail: string | null) => (detail ?? "").split(" · ")[0] || null;

/**
 * Compromisos de implantación de un producto Net para las «condiciones especiales» de un paquete personalizado:
 * alcance (requisitos del catálogo), lo disponible hoy y lo que está EN IMPLANTACIÓN (nunca como terminado), y las
 * condiciones propias del producto. null si la clave no es un producto Net de empresa. Pura.
 */
export function netCommitmentsText(key: string): string | null {
  const net = netProductOf(key);
  const p: TemplateProduct | null = net ? (net.segment === "business" ? net : null) : connectTemplate(key);
  if (!p) return null;
  const lines: string[] = [];
  lines.push(`Compromisos de implantación de ${p.name}.`);
  const req = requirementsOf(key);
  if (addonAssistedOf(key)) lines.push("Alcance: al aceptar el contrato, Big Elephant aplica las unidades contratadas a los límites de la empresa; no requiere migración de datos.");
  else lines.push(`Alcance de la implantación: Big Elephant prepara el entorno con el cliente (reunión de arranque, ${req.length ? `${req.map((r) => r.replace(/\.$/, "")).join("; ")}; ` : ""}carga de los datos iniciales, formación del equipo y validación del recorrido completo) antes de ponerlo en marcha.`);
  const ready = features(p, "available");
  if (ready.length) lines.push(`Disponible desde la puesta en marcha: ${ready.map((f) => f.label).join(", ")}.`);
  const soon = features(p, "coming_soon");
  if (soon.length) lines.push(`En implantación (incluido en el precio, sin coste adicional, sin fecha comprometida en este documento; no forma parte de lo entregado hasta que se comunique como disponible): ${soon.map((f) => f.label).join(", ")}.`);
  if (p.note) lines.push(p.note);
  return lines.join("\n");
}
