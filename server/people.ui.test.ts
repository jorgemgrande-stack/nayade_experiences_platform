/**
 * Pantallas nuevas de Elephant People renderizadas (sin navegador): primeros pasos del resumen de Personal y horario
 * semanal de la ficha del empleado. Los datos vienen de un doble de tRPC con la forma real de las respuestas.
 */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { peopleOnboarding } from "../shared/peopleOnboarding";

(globalThis as { React?: unknown }).React = React;

const state = vi.hoisted(() => ({ onboarding: undefined as unknown, schedule: [] as unknown[] }));
vi.mock("../client/src/lib/trpc", () => {
  const mutation = () => ({ mutate: () => undefined, isPending: false });
  const invalidate = () => undefined;
  return {
    trpc: {
      useUtils: () => ({ hr: { schedule: { listForEmployee: { invalidate } }, onboarding: { status: { invalidate } } } }),
      hr: {
        onboarding: { status: { useQuery: () => ({ data: state.onboarding }) } },
        schedule: {
          listForEmployee: { useQuery: () => ({ data: state.schedule, isLoading: false }) },
          setWeek: { useMutation: mutation },
        },
      },
    },
  };
});

import PeopleFirstSteps from "../client/src/components/people/PeopleFirstSteps";
import EmployeeScheduleEditor from "../client/src/components/people/EmployeeScheduleEditor";

const render = (el: React.ReactElement) => renderToStaticMarkup(React.createElement(Router, { ssrPath: "/admin/personal" }, el));
const none = { settingsReviewed: false, employees: 0, firstEmployeeId: null, employeesWithSchedule: 0, employeesWithPortal: 0 };

beforeEach(() => {
  state.onboarding = undefined;
  state.schedule = [];
});

describe("primeros pasos de Personal", () => {
  it("recién activada: los cuatro pasos con su enlace y el progreso", () => {
    state.onboarding = peopleOnboarding(none);
    const html = render(React.createElement(PeopleFirstSteps));
    expect(html).toContain("Primeros pasos con Personal");
    expect(html).toContain("0 de 4");
    for (const t of ["Revisa la configuración básica", "Da de alta a tu primer empleado", "Define su horario semanal", "Invítale al portal del empleado"]) expect(html).toContain(t);
    expect(html).toContain('href="/admin/personal/configuracion"');
    expect(html).toContain('href="/admin/personal/empleados"');
  });

  it("con pasos hechos los marca; con todos hechos desaparece; sin datos no pinta nada", () => {
    state.onboarding = peopleOnboarding({ ...none, settingsReviewed: true, employees: 1, firstEmployeeId: 3 });
    const html = render(React.createElement(PeopleFirstSteps));
    expect(html).toContain("2 de 4");
    expect(html).toContain('href="/admin/personal/empleados/3"');
    expect(html).toContain("Hecho");
    state.onboarding = peopleOnboarding({ settingsReviewed: true, employees: 1, firstEmployeeId: 3, employeesWithSchedule: 1, employeesWithPortal: 1 });
    expect(render(React.createElement(PeopleFirstSteps))).toBe("");
    state.onboarding = undefined;
    expect(render(React.createElement(PeopleFirstSteps))).toBe("");
  });
});

describe("horario semanal del empleado", () => {
  it("sin horario: estado vacío con la opción de rellenar la semana laboral; los siete días, lunes primero", () => {
    const html = render(React.createElement(EmployeeScheduleEditor, { employeeId: 1 }));
    expect(html).toContain("Este empleado todavía no tiene horario.");
    expect(html).toContain("Rellenar de lunes a viernes, 9:00 a 17:00");
    const days = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];
    const at = days.map((d) => html.indexOf(`>${d}<`));
    expect(at.every((i) => i > 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  it("con horario guardado: sus tramos y el total semanal", () => {
    state.schedule = [1, 2, 3, 4, 5].map((weekday, i) => ({ id: i + 1, employeeId: 1, weekday, startTime: "09:00", endTime: "17:00" }));
    const html = render(React.createElement(EmployeeScheduleEditor, { employeeId: 1 }));
    expect(html).not.toContain("todavía no tiene horario");
    expect(html.match(/value="09:00"/g)?.length).toBe(5);
    expect(html).toContain("40 h a la semana");
    expect(html).toContain("Guardar horario");
  });
});
