/**
 * Hotel Net · housekeeping — lógica pura: qué tarea toca a cada habitación en un día, transiciones de la tarea y el
 * estado operativo que deja en la habitación, e incidencias. El acceso a datos vive en `hotelHousekeepingDb.ts`.
 */
import { OUT_OF_SERVICE_STATUSES, type RoomOperationalStatus } from "./hotelPms";

export const HK_TASK_KINDS = ["salida", "repaso", "limpieza"] as const;
export type HkTaskKind = (typeof HK_TASK_KINDS)[number];

export const HK_TASK_STATUSES = ["pendiente", "en_curso", "hecha", "inspeccionada"] as const;
export type HkTaskStatus = (typeof HK_TASK_STATUSES)[number];

export const INCIDENT_PRIORITIES = ["baja", "media", "alta"] as const;
export const INCIDENT_STATUSES = ["abierta", "en_curso", "resuelta"] as const;
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];

/** Tipos de incidencia que se crean la primera vez (la empresa los cambia, desactiva o amplía). */
export const DEFAULT_INCIDENT_TYPES = ["Iluminación", "Televisión", "Climatización", "Fontanería", "Limpieza especial", "Otro"] as const;

/** Roles del panel a los que se pueden asignar tareas (no los de solo lectura). */
export const HK_ASSIGNEE_ROLES = ["admin", "agente", "monitor", "adminrest", "controler"] as const;

export interface HkRoom {
  id: number;
  isActive: boolean;
  operationalStatus: string;
}

/** Ocupación de una habitación el día de la tarea, a partir de sus estancias. */
export interface HkRoomDay {
  /** Un huésped sale ese día (o ya salió). */
  departure: boolean;
  /** Un huésped sigue alojado esa noche (no sale ese día). */
  stayover: boolean;
}

/**
 * Tarea que toca a la habitación ese día (o null):
 *  - fuera de servicio, bloqueada o desactivada → ninguna;
 *  - con salida → limpieza de salida (aunque entre otro huésped el mismo día);
 *  - con huésped que sigue → repaso;
 *  - sucia sin salida ni huésped → limpieza.
 */
export function taskKindForRoom(room: HkRoom, day: HkRoomDay): HkTaskKind | null {
  if (!room.isActive || (OUT_OF_SERVICE_STATUSES as readonly string[]).includes(room.operationalStatus)) return null;
  if (day.departure) return "salida";
  if (day.stayover) return "repaso";
  if (room.operationalStatus === "sucia") return "limpieza";
  return null;
}

/** Tareas que faltan por crear (una por habitación y día: las que ya existen no se repiten). */
export function planTasks(rooms: readonly HkRoom[], days: ReadonlyMap<number, HkRoomDay>, existingRoomIds: ReadonlySet<number>) {
  const out: Array<{ hotelRoomId: number; kind: HkTaskKind }> = [];
  for (const r of rooms) {
    if (existingRoomIds.has(r.id)) continue;
    const kind = taskKindForRoom(r, days.get(r.id) ?? { departure: false, stayover: false });
    if (kind) out.push({ hotelRoomId: r.id, kind });
  }
  return out;
}

const NEXT: Record<HkTaskStatus, readonly HkTaskStatus[]> = {
  pendiente: ["en_curso", "hecha"],
  en_curso: ["pendiente", "hecha"],
  hecha: ["en_curso", "inspeccionada"],
  inspeccionada: [],
};

/** Motivo por el que la tarea no puede pasar a `to`, o null. Una tarea inspeccionada ya no cambia. */
export function taskTransitionError(from: string, to: HkTaskStatus): string | null {
  if (!(HK_TASK_STATUSES as readonly string[]).includes(from)) return "Estado de tarea desconocido.";
  if (from === to) return "La tarea ya está en ese estado.";
  if (!NEXT[from as HkTaskStatus].includes(to)) {
    if (from === "inspeccionada") return "La tarea ya está inspeccionada.";
    if (to === "inspeccionada") return "Solo se inspecciona una tarea hecha.";
    return "Cambio de estado no permitido.";
  }
  return null;
}

/**
 * Estado operativo que deja la tarea en la habitación (null: no lo cambia). El repaso de una habitación ocupada no lo
 * cambia (sigue ocupada); la limpieza de salida o a petición: en curso → limpieza en curso; hecha → libre;
 * inspeccionada → revisada. Una habitación fuera de servicio o bloqueada no cambia por una tarea.
 */
export function roomStateForTask(kind: string, to: HkTaskStatus, currentRoomStatus: string): RoomOperationalStatus | null {
  if (kind === "repaso") return null;
  if ((OUT_OF_SERVICE_STATUSES as readonly string[]).includes(currentRoomStatus)) return null;
  if (to === "en_curso") return "limpieza_en_curso";
  if (to === "hecha") return "libre";
  if (to === "inspeccionada") return "revisada";
  if (to === "pendiente") return currentRoomStatus === "limpieza_en_curso" ? "sucia" : null;
  return null;
}

/** Puede cambiar la tarea quien la tiene asignada o quien gestiona el hotel; inspeccionar, solo quien gestiona. */
export function taskActorError(task: { assignedUserId: number | null }, actor: { userId: number; canManage: boolean }, to: HkTaskStatus): string | null {
  if (actor.canManage) return null;
  if (to === "inspeccionada") return "Solo recepción o la gobernanta pueden inspeccionar.";
  if (task.assignedUserId !== actor.userId) return "La tarea no está asignada a ti.";
  return null;
}

/** Normaliza el nombre de un tipo de incidencia (espacios) y lo valida. */
export function incidentTypeName(v: string): string | null {
  const s = v.replace(/\s+/g, " ").trim();
  return s.length >= 2 && s.length <= 80 ? s : null;
}

/**
 * Estado operativo que deja una incidencia que bloquea la habitación: al abrirse, bloqueada por mantenimiento; al
 * resolverse, sucia (hay que limpiarla antes de venderla), salvo que otra incidencia abierta la siga bloqueando.
 */
export function roomStateForIncident(event: "abierta" | "resuelta", otherOpenBlocking: number): RoomOperationalStatus | null {
  if (event === "abierta") return "bloqueada_mantenimiento";
  return otherOpenBlocking > 0 ? null : "sucia";
}
