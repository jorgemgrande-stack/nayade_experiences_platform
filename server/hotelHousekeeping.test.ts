/**
 * Hotel Net · housekeeping — lógica pura: qué tarea toca a cada habitación, transiciones de la tarea, quién puede
 * cambiarla, estado operativo que deja en la habitación e incidencias.
 */
import { describe, it, expect } from "vitest";
import {
  incidentTypeName,
  planTasks,
  roomStateForIncident,
  roomStateForTask,
  taskActorError,
  taskKindForRoom,
  taskTransitionError,
} from "./hotelHousekeeping";

const room = (id: number, operationalStatus = "libre", isActive = true) => ({ id, isActive, operationalStatus });
const none = { departure: false, stayover: false };

describe("tarea del día por habitación", () => {
  it("salida → limpieza de salida; huésped que sigue → repaso; sucia sin huésped → limpieza", () => {
    expect(taskKindForRoom(room(1, "ocupada"), { departure: true, stayover: false })).toBe("salida");
    expect(taskKindForRoom(room(1, "ocupada"), { departure: true, stayover: true })).toBe("salida");
    expect(taskKindForRoom(room(1, "ocupada"), { departure: false, stayover: true })).toBe("repaso");
    expect(taskKindForRoom(room(1, "sucia"), none)).toBe("limpieza");
    expect(taskKindForRoom(room(1, "libre"), none)).toBeNull();
    expect(taskKindForRoom(room(1, "revisada"), none)).toBeNull();
  });
  it("fuera de servicio, bloqueada o desactivada no recibe tarea", () => {
    expect(taskKindForRoom(room(1, "fuera_de_servicio"), { departure: true, stayover: false })).toBeNull();
    expect(taskKindForRoom(room(1, "bloqueada_mantenimiento"), { departure: false, stayover: true })).toBeNull();
    expect(taskKindForRoom(room(1, "sucia", false), none)).toBeNull();
  });
  it("planifica sin repetir las que ya existen", () => {
    const days = new Map([[1, { departure: true, stayover: false }], [2, { departure: false, stayover: true }]]);
    const plan = planTasks([room(1, "ocupada"), room(2, "ocupada"), room(3, "sucia"), room(4)], days, new Set([2]));
    expect(plan).toEqual([{ hotelRoomId: 1, kind: "salida" }, { hotelRoomId: 3, kind: "limpieza" }]);
  });
});

describe("transiciones de la tarea", () => {
  it("válidas", () => {
    expect(taskTransitionError("pendiente", "en_curso")).toBeNull();
    expect(taskTransitionError("pendiente", "hecha")).toBeNull();
    expect(taskTransitionError("en_curso", "hecha")).toBeNull();
    expect(taskTransitionError("en_curso", "pendiente")).toBeNull();
    expect(taskTransitionError("hecha", "inspeccionada")).toBeNull();
    expect(taskTransitionError("hecha", "en_curso")).toBeNull();
  });
  it("inválidas", () => {
    expect(taskTransitionError("pendiente", "inspeccionada")).toMatch(/Solo se inspecciona una tarea hecha/);
    expect(taskTransitionError("en_curso", "inspeccionada")).toMatch(/Solo se inspecciona/);
    expect(taskTransitionError("inspeccionada", "en_curso")).toMatch(/ya está inspeccionada/);
    expect(taskTransitionError("hecha", "hecha")).toMatch(/ya está en ese estado/);
    expect(taskTransitionError("rara", "hecha")).toMatch(/desconocido/);
  });
  it("quién puede: la persona asignada (no inspeccionar) o quien gestiona", () => {
    expect(taskActorError({ assignedUserId: 7 }, { userId: 7, canManage: false }, "hecha")).toBeNull();
    expect(taskActorError({ assignedUserId: 7 }, { userId: 8, canManage: false }, "hecha")).toMatch(/no está asignada a ti/);
    expect(taskActorError({ assignedUserId: null }, { userId: 8, canManage: false }, "en_curso")).toMatch(/no está asignada/);
    expect(taskActorError({ assignedUserId: 7 }, { userId: 7, canManage: false }, "inspeccionada")).toMatch(/Solo recepción/);
    expect(taskActorError({ assignedUserId: null }, { userId: 1, canManage: true }, "inspeccionada")).toBeNull();
  });
});

describe("estado operativo que deja la tarea", () => {
  it("limpieza: en curso → limpieza en curso; hecha → libre; inspeccionada → revisada", () => {
    expect(roomStateForTask("salida", "en_curso", "sucia")).toBe("limpieza_en_curso");
    expect(roomStateForTask("salida", "hecha", "limpieza_en_curso")).toBe("libre");
    expect(roomStateForTask("limpieza", "inspeccionada", "libre")).toBe("revisada");
    expect(roomStateForTask("salida", "pendiente", "limpieza_en_curso")).toBe("sucia");
    expect(roomStateForTask("salida", "pendiente", "sucia")).toBeNull();
  });
  it("el repaso no cambia una habitación ocupada; una bloqueada no cambia por una tarea", () => {
    expect(roomStateForTask("repaso", "hecha", "ocupada")).toBeNull();
    expect(roomStateForTask("salida", "hecha", "fuera_de_servicio")).toBeNull();
    expect(roomStateForTask("salida", "en_curso", "bloqueada_mantenimiento")).toBeNull();
  });
});

describe("incidencias", () => {
  it("nombre del tipo configurable", () => {
    expect(incidentTypeName("  Caja   fuerte ")).toBe("Caja fuerte");
    expect(incidentTypeName("x")).toBeNull();
    expect(incidentTypeName("a".repeat(81))).toBeNull();
  });
  it("bloquear al abrir; al resolver la última, sucia", () => {
    expect(roomStateForIncident("abierta", 0)).toBe("bloqueada_mantenimiento");
    expect(roomStateForIncident("resuelta", 0)).toBe("sucia");
    expect(roomStateForIncident("resuelta", 1)).toBeNull();
  });
});
