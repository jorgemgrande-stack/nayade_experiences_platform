/**
 * Life Net · lógica pura, recordatorios (con dependencias simuladas), menú y licencias.
 *
 *  - Validaciones del hogar (titular, NIF opcional, nombre «Hogar de …»), de tareas y de actividades.
 *  - Cupo de miembros: 5 por defecto (J5), el del plan si lo define, sin tope por contrato.
 *  - Estado de las tareas (pendiente, vencida, hecha) con la hora del hogar y seguimiento por miembro.
 *  - Recordatorios: solo con licencia, una vez por elemento y miembro (la reserva decide), los fallidos se marcan.
 *  - Menú de un hogar con solo Life: sin CRM, tienda, web ni facturación; inicio personal.
 */
import { describe, it, expect } from "vitest";
import {
  LIFE_HOUSEHOLD_MEMBERS_INCLUDED,
  addDays,
  defaultHouseholdName,
  eventProblem,
  householdProblem,
  isDay,
  memberLimitOf,
  memberLimitProblem,
  memberTracking,
  prefersLifeHome,
  reminderDue,
  reminderStamp,
  taskProblem,
  taskState,
  wallClock,
} from "../shared/lifeNet";
import { NET_PRODUCTS, netFeatureCounts } from "../shared/netProducts";
import { CORE_EXTENSION_PANELS, CORE_EXTENSION_ROUTES, validatePanelContributions } from "../shared/panelExtensions";
import { panelTargets, resolveNav, TASK_NAV, type NavContext } from "../shared/adminNav";
import { capabilityForProcedure } from "./_core/capabilities/routeGuard";
import { jobMultiPolicy } from "./_core/tenantRegistry/jobPolicy";
import { panelExtensionSources, resolvePanelNavigation } from "./_core/modules/panelNavigation";
import { CAPABILITIES } from "./catalog/capabilities";
import { LIFE_REMINDER_CATEGORY, LIFE_REMINDERS_JOB, reminderEmail, reminderKey, runLifeReminders, type ReminderDeps } from "./lifeNet/reminders";
import type { ReminderTarget } from "./lifeNetDb";

describe("hogar y titular (J6)", () => {
  it("nombre por defecto «Hogar de …» y validaciones del titular", () => {
    expect(defaultHouseholdName({ firstName: " Ana ", lastName: "García López" })).toBe("Hogar de Ana García López");
    expect(defaultHouseholdName(null)).toBe("Mi hogar");
    expect(householdProblem({ firstName: "", lastName: "García" })).toMatch(/nombre/);
    expect(householdProblem({ firstName: "Ana", lastName: " " })).toMatch(/apellidos/);
    expect(householdProblem({ firstName: "Ana", lastName: "García" })).toBeNull();
    expect(householdProblem({ firstName: "Ana", lastName: "García", taxId: "12345678Z" })).toBeNull();
    expect(householdProblem({ firstName: "Ana", lastName: "García", taxId: "12345678A" })).toMatch(/NIF/);
  });
});

describe("miembros del hogar (J5)", () => {
  it("5 incluidos por defecto; el plan manda si define el cupo; null es sin tope", () => {
    expect(LIFE_HOUSEHOLD_MEMBERS_INCLUDED).toBe(5);
    expect(memberLimitOf(undefined)).toBe(5);
    expect(memberLimitOf(7)).toBe(7);
    expect(memberLimitOf(null)).toBeNull();
    expect(memberLimitProblem(4, 5)).toBeNull();
    expect(memberLimitProblem(5, 5)).toMatch(/5 de 5/);
    expect(memberLimitProblem(50, null)).toBeNull();
  });
});

describe("tareas, actividades y recordatorios", () => {
  const now = { day: "2026-11-08", time: "10:00" };
  it("estado de una tarea con la hora del hogar", () => {
    expect(taskState({ status: "done", dueDate: "2020-01-01", dueTime: null }, now)).toBe("done");
    expect(taskState({ status: "pending", dueDate: null, dueTime: null }, now)).toBe("pending");
    expect(taskState({ status: "pending", dueDate: "2026-11-07", dueTime: null }, now)).toBe("overdue");
    expect(taskState({ status: "pending", dueDate: "2026-11-08", dueTime: "09:59" }, now)).toBe("overdue");
    expect(taskState({ status: "pending", dueDate: "2026-11-08", dueTime: "10:00" }, now)).toBe("pending");
    expect(taskState({ status: "pending", dueDate: "2026-11-08", dueTime: null }, now)).toBe("pending");
  });

  it("validaciones de tareas y actividades", () => {
    expect(taskProblem({ title: " " })).toMatch(/qué hay que hacer/);
    expect(taskProblem({ title: "Comprar pan", dueTime: "10:00" })).toMatch(/fecha límite/);
    expect(taskProblem({ title: "Comprar pan", remindDate: "2026-11-08" })).toMatch(/recordatorio/);
    expect(taskProblem({ title: "Comprar pan", dueDate: "2026-02-30" })).toMatch(/fecha/);
    expect(taskProblem({ title: "Comprar pan", dueDate: "2026-11-09", remindDate: "2026-11-08", remindTime: "20:00" })).toBeNull();
    const ev = { title: "Natación", date: "2026-11-10", memberIds: [1] };
    expect(eventProblem({ ...ev, memberIds: [] })).toMatch(/miembro/);
    expect(eventProblem({ ...ev, startTime: "18:00", endTime: "17:00" })).toMatch(/posterior/);
    expect(eventProblem({ ...ev, endTime: "17:00" })).toMatch(/inicio/);
    expect(eventProblem({ ...ev, startTime: "17:00", endTime: "18:00" })).toBeNull();
    expect(reminderStamp(null, null)).toBeNull();
    expect(reminderStamp("2026-11-08", "07:30")).toBe("2026-11-08 07:30");
    expect(reminderStamp("2026-11-08", null)).toBe("invalid");
    expect(isDay("2026-13-01")).toBe(false);
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("hora de pared del hogar y ventana del recordatorio (24 h)", () => {
    const t = new Date("2026-11-08T09:30:00Z"); // 10:30 en Madrid (CET)
    expect(wallClock(t, "Europe/Madrid")).toEqual({ day: "2026-11-08", time: "10:30", stamp: "2026-11-08 10:30" });
    expect(wallClock(t, "zona/inexistente").stamp).toBe("2026-11-08 10:30");
    expect(reminderDue("2026-11-08 10:30", t, "Europe/Madrid")).toBe(true);
    expect(reminderDue("2026-11-08 10:31", t, "Europe/Madrid")).toBe(false);
    expect(reminderDue("2026-11-07 10:29", t, "Europe/Madrid")).toBe(false);
  });

  it("seguimiento por miembro: pendientes, vencidas, hechas y actividades", () => {
    const tasks = [
      { id: 1, status: "pending" as const, dueDate: "2026-11-01", dueTime: null, assigneeIds: [1, 2] },
      { id: 2, status: "pending" as const, dueDate: null, dueTime: null, assigneeIds: [1] },
      { id: 3, status: "done" as const, dueDate: null, dueTime: null, assigneeIds: [2] },
    ];
    const events = [
      { id: 1, date: "2026-11-08", memberIds: [1, 2] },
      { id: 2, date: "2026-11-01", memberIds: [2] },
      { id: 3, date: "2027-01-30", memberIds: [1] },
    ];
    expect(memberTracking([1, 2, 3], tasks, events, now)).toEqual([
      { memberId: 1, pending: 1, overdue: 1, done: 0, upcomingEvents: 1, pastEvents: 0 },
      { memberId: 2, pending: 0, overdue: 1, done: 1, upcomingEvents: 1, pastEvents: 1 },
      { memberId: 3, pending: 0, overdue: 0, done: 0, upcomingEvents: 0, pastEvents: 0 },
    ]);
  });
});

describe("recordatorios por correo (tarea por empresa)", () => {
  const target = (o: Partial<ReminderTarget> = {}): ReminderTarget => ({
    kind: "task", itemId: 7, title: "QA-LIFE Recoger a Leo", date: "2026-11-08", time: "17:00", location: null, remindAt: "2026-11-08 10:00",
    memberId: 3, memberName: "Ana", email: "ana@hogar.example", userName: "Ana García", ...o,
  });
  function deps(o: Partial<ReminderDeps> & { claims?: Set<string>; sent?: ReminderTarget[]; settled?: Array<[number, boolean]> } = {}): ReminderDeps {
    const claims = o.claims ?? new Set<string>();
    return {
      licensed: async () => true,
      timeZone: async () => "Europe/Madrid",
      targets: async () => [target(), target({ memberId: 4, memberName: "Luis", email: "luis@hogar.example" })],
      claim: async (t) => {
        const k = reminderKey(t);
        if (claims.has(k)) return false;
        claims.add(k);
        return true;
      },
      settle: async (t, ok) => void o.settled?.push([t.memberId, ok]),
      send: async (t) => (o.sent?.push(t), true),
      ...o,
    };
  }

  it("sin la capacidad life-net no envía nada", async () => {
    const sent: ReminderTarget[] = [];
    expect(await runLifeReminders(new Date(), deps({ licensed: async () => false, sent }))).toEqual({ sent: 0, failed: 0, skipped: "sin_licencia" });
    expect(await runLifeReminders(new Date(), deps({ licensed: async () => { throw new Error("x"); }, sent }))).toMatchObject({ skipped: "licencia_no_verificable" });
    expect(sent).toEqual([]);
  });

  it("idempotente: la segunda pasada no reenvía", async () => {
    const claims = new Set<string>();
    const sent: ReminderTarget[] = [];
    expect(await runLifeReminders(new Date(), deps({ claims, sent }))).toEqual({ sent: 2, failed: 0 });
    expect(await runLifeReminders(new Date(), deps({ claims, sent }))).toEqual({ sent: 0, failed: 0 });
    expect(sent.map((t) => t.email)).toEqual(["ana@hogar.example", "luis@hogar.example"]);
  });

  it("un envío fallido se marca como fallido (lo reintenta la siguiente pasada)", async () => {
    const settled: Array<[number, boolean]> = [];
    expect(await runLifeReminders(new Date(), deps({ settled, send: async (t) => t.memberId === 3 }))).toEqual({ sent: 1, failed: 1 });
    expect(settled).toEqual([[3, true], [4, false]]);
  });

  it("sin la migración 0047 la empresa se omite sin error", async () => {
    const missing = Object.assign(new Error("Table 'x.life_tasks' doesn't exist"), { code: "ER_NO_SUCH_TABLE", errno: 1146, sqlMessage: "Table 'x.life_tasks' doesn't exist" });
    expect(await runLifeReminders(new Date(), deps({ targets: async () => { throw missing; } }))).toMatchObject({ skipped: "sin_migracion" });
  });

  it("correo transaccional con categoría explícita, clave estable y enlace al panel del hogar", () => {
    expect(LIFE_REMINDER_CATEGORY).toBe("operational");
    expect(reminderKey(target())).toBe("life:reminder:task:7:3:202611081000");
    const c = reminderEmail(target(), "https://hogar.app.bigelephant.es");
    expect(c.subject).toBe("Recordatorio: QA-LIFE Recoger a Leo");
    expect(c.html).toContain("https://hogar.app.bigelephant.es/admin/life/tareas");
    expect(c.html).toContain("Hola, Ana García:");
    expect(reminderEmail(target({ kind: "event", location: "Polideportivo" }), null).html).toContain("Polideportivo");
    expect(jobMultiPolicy(LIFE_REMINDERS_JOB).mode).toBe("per-tenant");
  });
});

describe("panel, menú y licencias", () => {
  const LIFE_ONLY: Record<string, "active"> = { "life-net": "active", "admin-users": "active", "comms-email": "active" };
  const life = panelExtensionSources().filter((s) => s.manifest.id === "life_net");
  const nav = (states: Record<string, "active" | "read_only">, role = "admin") =>
    resolvePanelNavigation(life, { coreVersion: "1.0.0", role, capabilityState: (id) => states[id] ?? null, moduleAvailable: async () => false, hasPermission: async () => false });

  it("las 7 funciones de Life Net figuran como disponibles", () => {
    const p = NET_PRODUCTS.find((x) => x.key === "life-net")!;
    expect(netFeatureCounts(p)).toEqual({ available: 7, comingSoon: 0 });
  });

  it("la API lifeNet.* exige la licencia life-net y las pantallas también", () => {
    expect(capabilityForProcedure("lifeNet.tasks")).toBe("life-net");
    expect(capabilityForProcedure("lifeNet.saveHousehold")).toBe("life-net");
    for (const p of ["/admin/net/life", "/admin/life/agenda", "/admin/life/tareas", "/admin/life/seguimiento", "/admin/life/miembros"]) {
      expect(CORE_EXTENSION_ROUTES.find((r) => r.path === p)?.capabilities, p).toEqual(["life-net"]);
    }
    const known = new Set(CAPABILITIES.map((c) => c.id));
    expect(validatePanelContributions("life_net", CORE_EXTENSION_PANELS.lifeNet.panel, { capability: null, isCapability: (id) => known.has(id), targets: panelTargets() })).toEqual([]);
  });

  it("menú de Life Net: miembros y hogar solo para la administración; nada sin la licencia", async () => {
    const hrefs = (n: Awaited<ReturnType<typeof nav>>) => n.entries.flatMap((e) => (e.kind === "section" ? e.items.map((i) => i.href) : []));
    expect(hrefs(await nav(LIFE_ONLY))).toEqual(["/admin/net/life", "/admin/life/agenda", "/admin/life/tareas", "/admin/life/seguimiento", "/admin/life/miembros"]);
    expect(hrefs(await nav(LIFE_ONLY, "agente"))).toEqual(["/admin/net/life", "/admin/life/agenda", "/admin/life/tareas", "/admin/life/seguimiento"]);
    expect((await nav({ "admin-users": "active" })).entries).toEqual([]);
  });

  it("un hogar con solo Life no ve CRM, tienda, web ni facturación", async () => {
    const ctx: NavContext = { role: "admin", isFlagVisible: () => true, isModuleVisible: () => true, capabilityState: (id) => LIFE_ONLY[id] ?? null };
    const resolved = resolveNav(TASK_NAV, ctx, (await nav(LIFE_ONLY)).entries);
    const labels = resolved.flatMap((s) => s.items.flatMap((i) => [i.label, ...(i.children ?? []).map((c) => c.label)]));
    expect(resolved.map((s) => s.label)).toEqual([null, "Life Net", "Organización", "Suscripción", null]);
    expect(labels).toEqual(["Inicio", "Mi día", "Agenda del hogar", "Tareas y recordatorios", "Seguimiento", "Miembros y hogar", "Usuarios y permisos", "Plan y uso", "Amplía tu empresa", "Ayuda", "Soporte"]);
    for (const banned of ["Clientes", "Pedidos", "Facturas", "Web"]) expect(labels).not.toContain(banned);
  });

  it("inicio personal: plan life o solo Life Net; una empresa con Essential sigue con el suyo", () => {
    const st = (s: Record<string, "active">) => (id: string) => s[id] ?? null;
    expect(prefersLifeHome({ capabilityState: st(LIFE_ONLY) })).toBe(true);
    expect(prefersLifeHome({ planKey: "life", capabilityState: st({ ...LIFE_ONLY, "crm-contacts": "active" }) })).toBe(true);
    expect(prefersLifeHome({ planKey: "essential", capabilityState: st({ ...LIFE_ONLY, "crm-contacts": "active" }) })).toBe(false);
    expect(prefersLifeHome({ planKey: "life", capabilityState: st({}) })).toBe(false);
  });
});
