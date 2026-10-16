/**
 * Etiquetas (crm-tags) y tareas internas (crm-tasks) del CRM: reglas puras que comparten el servidor
 * y el panel (validación de formularios, vencimiento y textos). Sin dependencias de React ni de BD.
 */

export const TAG_NAME_MAX = 60;
export const TASK_TITLE_MAX = 200;
export const TASK_DESCRIPTION_MAX = 5000;

/** Entidades a las que se puede asignar una etiqueta. */
export const TAG_ENTITY_TYPES = ["client", "lead"] as const;
export type TagEntityType = (typeof TAG_ENTITY_TYPES)[number];

/** Entidades a las que se puede vincular una tarea. */
export const TASK_ENTITY_TYPES = ["client", "lead", "quote"] as const;
export type TaskEntityType = (typeof TASK_ENTITY_TYPES)[number];

export const TASK_STATUSES = ["pendiente", "hecha"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_PRIORITIES = ["baja", "media", "alta"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const TASK_PRIORITY_LABELS: Record<TaskPriority, string> = { baja: "Baja", media: "Media", alta: "Alta" };
export const TASK_ENTITY_LABELS: Record<TaskEntityType, string> = { client: "Cliente", lead: "Oportunidad", quote: "Presupuesto" };

/** Paleta cerrada de colores de etiqueta (contraste AA con texto oscuro sobre fondo claro y al revés). */
export const TAG_COLORS = ["gris", "azul", "verde", "ambar", "rojo", "violeta"] as const;
export type TagColor = (typeof TAG_COLORS)[number];
export const TAG_COLOR_LABELS: Record<TagColor, string> = {
  gris: "Gris", azul: "Azul", verde: "Verde", ambar: "Ámbar", rojo: "Rojo", violeta: "Violeta",
};

/** Nombre de etiqueta normalizado: espacios colapsados y recortados. */
export function normalizeTagName(name: string): string {
  return name.replace(/\s+/g, " ").trim();
}

/** Clave de comparación (sin mayúsculas ni acentos), igual que la intercalación de MySQL. */
export function tagKey(name: string): string {
  return normalizeTagName(name).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

export function validateTagForm(v: { name: string; color?: string | null }, existing: Array<{ id?: number; name: string }> = [], selfId?: number): { name?: string; color?: string } {
  const errors: { name?: string; color?: string } = {};
  const name = normalizeTagName(v.name ?? "");
  if (!name) errors.name = "Indica el nombre de la etiqueta.";
  else if (name.length > TAG_NAME_MAX) errors.name = `El nombre admite como máximo ${TAG_NAME_MAX} caracteres.`;
  else if (existing.some((t) => t.id !== selfId && tagKey(t.name) === tagKey(name))) errors.name = "Ya existe una etiqueta con ese nombre.";
  if (v.color && !(TAG_COLORS as readonly string[]).includes(v.color)) errors.color = "Elige un color de la lista.";
  return errors;
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** true si es una fecha real con formato AAAA-MM-DD. */
export function isValidYmd(s: string): boolean {
  if (!YMD.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export interface TaskFormValues {
  title: string;
  description?: string | null;
  dueDate?: string | null;
  entityType?: string | null;
  entityId?: number | null;
}

export function validateTaskForm(v: TaskFormValues): { title?: string; description?: string; dueDate?: string; entity?: string } {
  const errors: { title?: string; description?: string; dueDate?: string; entity?: string } = {};
  const title = (v.title ?? "").trim();
  if (!title) errors.title = "Indica el título de la tarea.";
  else if (title.length > TASK_TITLE_MAX) errors.title = `El título admite como máximo ${TASK_TITLE_MAX} caracteres.`;
  if (v.description && v.description.length > TASK_DESCRIPTION_MAX) errors.description = `La descripción admite como máximo ${TASK_DESCRIPTION_MAX} caracteres.`;
  if (v.dueDate && !isValidYmd(v.dueDate)) errors.dueDate = "Indica una fecha válida.";
  const hasType = !!v.entityType;
  const hasId = v.entityId != null;
  if (hasType !== hasId) errors.entity = "Indica a la vez el tipo y el elemento vinculado, o ninguno.";
  else if (hasType && !(TASK_ENTITY_TYPES as readonly string[]).includes(v.entityType!)) errors.entity = "Tipo de vínculo no válido.";
  return errors;
}

/** Fecha local AAAA-MM-DD (por defecto, hoy). */
export function localYmd(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Una tarea está vencida si sigue pendiente y su fecha es anterior a hoy. */
export function isTaskOverdue(t: { status: string; dueDate: string | null | undefined }, today: string = localYmd()): boolean {
  return t.status === "pendiente" && !!t.dueDate && t.dueDate.slice(0, 10) < today;
}

/** Vence hoy y sigue pendiente. */
export function isTaskDueToday(t: { status: string; dueDate: string | null | undefined }, today: string = localYmd()): boolean {
  return t.status === "pendiente" && !!t.dueDate && t.dueDate.slice(0, 10) === today;
}

/** Ruta del panel para abrir la entidad vinculada a una tarea. */
export function taskEntityHref(entityType: string | null | undefined, entityId: number | null | undefined, search?: string | null): string | null {
  if (!entityType || entityId == null) return null;
  const q = search ? `&search=${encodeURIComponent(search)}` : "";
  if (entityType === "client") return `/admin/crm/clientes?clientId=${entityId}`;
  if (entityType === "lead") return `/admin/crm?tab=leads${q}`;
  if (entityType === "quote") return `/admin/crm?tab=quotes${q}`;
  return null;
}
