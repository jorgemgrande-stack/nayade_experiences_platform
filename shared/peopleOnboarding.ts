/**
 * Elephant People: primeros pasos al activar la extensión y validación del horario semanal. Funciones puras que usan
 * el servidor (hr.onboarding.status, hr.schedule.setWeek) y el panel.
 */

export type PeopleStepId = "settings" | "firstEmployee" | "schedule" | "portal";

export interface PeopleStep {
  id: PeopleStepId;
  title: string;
  description: string;
  href: string;
  done: boolean;
}

export interface PeopleOnboardingFacts {
  settingsReviewed: boolean;
  employees: number;
  /** Primer empleado (para enlazar los pasos que se hacen en su ficha). */
  firstEmployeeId: number | null;
  employeesWithSchedule: number;
  employeesWithPortal: number;
}

export interface PeopleOnboarding {
  steps: PeopleStep[];
  completed: number;
  total: number;
  allDone: boolean;
}

/** Pasos en orden. Los que dependen de un empleado llevan a su ficha (o al listado si aún no hay ninguno). */
export function peopleOnboarding(f: PeopleOnboardingFacts): PeopleOnboarding {
  const employeeHref = f.firstEmployeeId ? `/admin/personal/empleados/${f.firstEmployeeId}` : "/admin/personal/empleados";
  const steps: PeopleStep[] = [
    {
      id: "settings",
      title: "Revisa la configuración básica",
      description: "Jornada semanal, días de vacaciones y porcentaje de Seguridad Social de la empresa.",
      href: "/admin/personal/configuracion",
      done: f.settingsReviewed,
    },
    {
      id: "firstEmployee",
      title: "Da de alta a tu primer empleado",
      description: "Datos personales, contrato y puesto.",
      href: "/admin/personal/empleados",
      done: f.employees > 0,
    },
    {
      id: "schedule",
      title: "Define su horario semanal",
      description: "Sirve para comparar las horas fichadas con las previstas.",
      href: employeeHref,
      done: f.employeesWithSchedule > 0,
    },
    {
      id: "portal",
      title: "Invítale al portal del empleado",
      description: "Desde el portal ficha, consulta sus nóminas y documentos y pide vacaciones.",
      href: employeeHref,
      done: f.employeesWithPortal > 0,
    },
  ];
  const completed = steps.filter((s) => s.done).length;
  return { steps, completed, total: steps.length, allDone: completed === steps.length };
}

/** Tramo de horario: día de la semana (0 = domingo … 6 = sábado) y horas HH:MM. */
export interface ScheduleSlot {
  weekday: number;
  startTime: string;
  endTime: string;
}

export const WEEKDAY_LABELS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"] as const;

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

/** Errores del horario en español (vacío = válido). Un día puede tener varios tramos (jornada partida), sin solaparse. */
export function scheduleErrors(slots: readonly ScheduleSlot[]): string[] {
  const errors: string[] = [];
  if (slots.length > 28) errors.push("Como máximo 4 tramos por día.");
  for (const s of slots) {
    const day = WEEKDAY_LABELS[s.weekday];
    if (!Number.isInteger(s.weekday) || !day) {
      errors.push("Día de la semana no válido.");
      continue;
    }
    if (!HHMM.test(s.startTime) || !HHMM.test(s.endTime)) {
      errors.push(`${day}: las horas deben tener el formato HH:MM.`);
      continue;
    }
    if (minutes(s.endTime) <= minutes(s.startTime)) errors.push(`${day}: la hora de salida debe ser posterior a la de entrada.`);
  }
  if (errors.length) return errors;
  for (let d = 0; d < 7; d++) {
    const day = slots.filter((s) => s.weekday === d).sort((a, b) => minutes(a.startTime) - minutes(b.startTime));
    if (day.length > 4) errors.push(`${WEEKDAY_LABELS[d]}: como máximo 4 tramos.`);
    for (let i = 1; i < day.length; i++) {
      if (minutes(day[i].startTime) < minutes(day[i - 1].endTime)) errors.push(`${WEEKDAY_LABELS[d]}: hay tramos que se solapan.`);
    }
  }
  return errors;
}

/** Horas semanales previstas por el horario (decimales). */
export function weeklyScheduledHours(slots: readonly ScheduleSlot[]): number {
  return slots.reduce((t, s) => t + (minutes(s.endTime) - minutes(s.startTime)) / 60, 0);
}
