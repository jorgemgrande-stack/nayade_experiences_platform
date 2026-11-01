/**
 * Elephant People como extensión contratable: licencia en servidor de TODAS sus rutas (tRPC y subidas), primeros
 * pasos, horario semanal y vocabulario genérico. La operación real con dos empresas sobre MySQL está en
 * server/people.contratable.e2e.mysql.test.ts.
 */
import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { capabilityForProcedure } from "./_core/capabilities/routeGuard";
import { requireCapability } from "./_core/capabilities/restGuard";
import type { CapabilityAccess } from "./_core/capabilities/access";
import { peopleOnboarding, scheduleErrors, weeklyScheduledHours } from "../shared/peopleOnboarding";
import { CORE_EXTENSION_PANELS } from "../shared/panelExtensions";

const root = path.resolve(__dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");

describe("licencia people-hr en servidor", () => {
  it("todos los procedimientos de hr.* (panel y portal del empleado) exigen people-hr", async () => {
    const { appRouter } = await import("./routers");
    const procs = Object.keys((appRouter as unknown as { _def: { procedures: Record<string, unknown> } })._def.procedures);
    const hr = procs.filter((p) => p.startsWith("hr."));
    expect(hr.length).toBeGreaterThan(60);
    for (const p of ["hr.portal.me", "hr.timeClock.clockIn", "hr.leaves.request", "hr.payslips.upsert", "hr.schedule.setWeek", "hr.onboarding.status", "hr.portal.activate"]) expect(hr).toContain(p);
    for (const p of hr) expect([p, capabilityForProcedure(p)]).toEqual([p, "people-hr"]);
  }, 60_000); // importa el router completo

  it("las lecturas heredadas de fichas de empleado (operations.monitors.*) también exigen people-hr", async () => {
    const { appRouter } = await import("./routers");
    const procs = Object.keys((appRouter as unknown as { _def: { procedures: Record<string, unknown> } })._def.procedures);
    const legacy = procs.filter((p) => p.startsWith("operations.monitors."));
    expect(legacy.length).toBeGreaterThan(0);
    for (const p of legacy) expect(capabilityForProcedure(p)).toBe("people-hr");
    // El resto de operaciones no cambia de licencia
    expect(capabilityForProcedure("operations.calendar.getEvents")).toBeUndefined();
  }, 60_000);

  it("el manifiesto de la extensión declara el namespace hr con la capacidad people-hr", () => {
    expect(CORE_EXTENSION_PANELS.people.capability).toBe("people-hr");
    expect(CORE_EXTENSION_PANELS.people.panel.api).toEqual(["hr"]);
  });

  it("las subidas de foto y documentos de empleado pasan por el guardián de licencia", () => {
    const src = read("server/uploadRoutes.ts");
    for (const route of ["/api/upload/monitor-photo", "/api/upload/monitor-doc"]) {
      const at = src.indexOf(`"${route}"`);
      expect(at).toBeGreaterThan(0);
      expect(src.slice(at, at + 200)).toContain('requireCapability("people-hr")');
    }
  });
});

describe("guardián REST por capacidad", () => {
  async function run(decision: Awaited<ReturnType<CapabilityAccess["check"]>> | Error, method: "GET" | "POST") {
    const check = vi.fn(async () => {
      if (decision instanceof Error) throw decision;
      return decision;
    });
    const app = express();
    app.all("/x", requireCapability("people-hr", () => ({ check }) as unknown as CapabilityAccess), (_req, res) => res.json({ ok: true }));
    const server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as AddressInfo).port;
    try {
      const res = await new Promise<{ status: number; body: any }>((resolve, reject) => {
        const req = http.request({ host: "127.0.0.1", port, path: "/x", method }, (r) => {
          let b = "";
          r.on("data", (c) => (b += c));
          r.on("end", () => resolve({ status: r.statusCode ?? 0, body: JSON.parse(b) }));
        });
        req.on("error", reject);
        req.end();
      });
      return { ...res, write: (check.mock.calls[0] as unknown[] | undefined)?.[1] };
    } finally {
      server.close();
    }
  }

  it("permitido → pasa; las escrituras se comprueban como escritura", async () => {
    const r = await run({ allowed: true, status: "active" }, "POST");
    expect(r.status).toBe(200);
    expect(r.write).toEqual({ write: true });
    expect((await run({ allowed: true, status: "read_only" }, "GET")).write).toEqual({ write: false });
  });

  it("no contratada → 403 con mensaje en español sin términos técnicos", async () => {
    const r = await run({ allowed: false, status: "not_contracted", reason: "Capacidad no contratada: people-hr" }, "POST");
    expect(r.status).toBe(403);
    expect(r.body).toMatchObject({ error: "Esta función no está incluida en tu plan.", capability: "people-hr" });
    const ro = await run({ allowed: false, status: "read_only", reason: "people-hr está en solo lectura" }, "POST");
    expect(ro.body.error).toMatch(/solo lectura/);
  });

  it("si no puede comprobarse, falla cerrado (503)", async () => {
    const r = await run(new Error("registro caído"), "POST");
    expect(r.status).toBe(503);
    expect(r.body.error).toMatch(/No se pudo verificar la licencia/);
  });
});

describe("primeros pasos de Personal", () => {
  const none = { settingsReviewed: false, employees: 0, firstEmployeeId: null, employeesWithSchedule: 0, employeesWithPortal: 0 };

  it("empresa recién activada: cuatro pasos pendientes, en orden", () => {
    const o = peopleOnboarding(none);
    expect(o.steps.map((s) => s.id)).toEqual(["settings", "firstEmployee", "schedule", "portal"]);
    expect([o.completed, o.total, o.allDone]).toEqual([0, 4, false]);
    expect(o.steps.find((s) => s.id === "schedule")!.href).toBe("/admin/personal/empleados");
  });

  it("con el primer empleado, los pasos de horario y portal llevan a su ficha; todo hecho → allDone", () => {
    const o = peopleOnboarding({ ...none, employees: 1, firstEmployeeId: 7 });
    expect(o.steps.find((s) => s.id === "schedule")!.href).toBe("/admin/personal/empleados/7");
    expect(o.completed).toBe(1);
    expect(peopleOnboarding({ settingsReviewed: true, employees: 1, firstEmployeeId: 7, employeesWithSchedule: 1, employeesWithPortal: 1 }).allDone).toBe(true);
  });
});

describe("horario semanal", () => {
  it("acepta jornada partida y suma las horas", () => {
    const week = [1, 2, 3, 4, 5].flatMap((weekday) => [
      { weekday, startTime: "09:00", endTime: "14:00" },
      { weekday, startTime: "16:00", endTime: "19:00" },
    ]);
    expect(scheduleErrors(week)).toEqual([]);
    expect(weeklyScheduledHours(week)).toBe(40);
    expect(scheduleErrors([])).toEqual([]);
  });

  it("rechaza horas mal escritas, salida anterior a la entrada y tramos solapados (mensajes en español)", () => {
    expect(scheduleErrors([{ weekday: 1, startTime: "9", endTime: "14:00" }])).toEqual(["Lunes: las horas deben tener el formato HH:MM."]);
    expect(scheduleErrors([{ weekday: 2, startTime: "14:00", endTime: "09:00" }])).toEqual(["Martes: la hora de salida debe ser posterior a la de entrada."]);
    expect(scheduleErrors([{ weekday: 3, startTime: "09:00", endTime: "14:00" }, { weekday: 3, startTime: "13:00", endTime: "18:00" }])).toEqual(["Miércoles: hay tramos que se solapan."]);
    expect(scheduleErrors([{ weekday: 9, startTime: "09:00", endTime: "14:00" }])).toEqual(["Día de la semana no válido."]);
  });
});

describe("vocabulario genérico de Personal", () => {
  const FOREIGN = /n[aá]yade|skicenter|temporada|kayak|paddle|monitores|actividades acu[aá]ticas/i;
  const files = [
    ...fs.readdirSync(path.join(root, "client/src/pages/admin/hr")).map((f) => `client/src/pages/admin/hr/${f}`),
    ...fs.readdirSync(path.join(root, "client/src/components/people")).map((f) => `client/src/components/people/${f}`),
    ...fs.readdirSync(path.join(root, "client/src/pages/employee")).filter((f) => f !== "EmployeeLayout.tsx").map((f) => `client/src/pages/employee/${f}`),
    "shared/peopleOnboarding.ts",
  ];

  it("ni las pantallas del panel ni las del portal usan términos de la instalación sectorial original", () => {
    for (const f of files) expect([f, FOREIGN.exec(read(f))?.[0] ?? null]).toEqual([f, null]);
  });

  it("el portal solo usa el logotipo y teléfono originales fuera de la web neutra de cada empresa", () => {
    const src = read("client/src/pages/employee/EmployeeLayout.tsx");
    expect(src).toContain("neutral ? phone : NAYADE_PHONE");
    expect(src).toContain('(neutral ? "" : LOGO_FALLBACK)');
  });

  it("el correo de invitación al portal describe lo que ya existe (sin «próximas funcionalidades»)", () => {
    const src = read("server/routers/hr.ts");
    expect(src).not.toMatch(/próximas funcionalidades/);
    expect(src).toMatch(/podrás fichar, consultar tus datos, nóminas y documentos y solicitar vacaciones o permisos/);
  });
});
