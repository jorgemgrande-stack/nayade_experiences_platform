/**
 * Elephant People (Personal) como extensión contratable, con la APLICACIÓN REAL sobre MySQL (opt-in,
 * REGISTRY_TEST_DATABASE_URL). Dos empresas NUEVAS aprovisionadas desde la baseline con Essential y
 * CAPABILITY_ENFORCEMENT=on. Recorrido:
 *
 *  1. Empresa nueva: las tablas de Personal existen en su propia BD (baseline), vacías.
 *  2. Sin la extensión: sus APIs (panel, portal del empleado, lecturas heredadas y subidas) dan 403 por licencia;
 *     sin entrada de menú y la ruta /admin/personal queda «no incluida» (candado).
 *  3. Activación (licencia en el registro, lo que aplica Elephant Connect tras el cobro): menú y rutas; primeros pasos.
 *  4. Roles: solo administración gestiona Personal; el empleado solo usa su portal.
 *  5. Alta de empleado, horario, acceso al portal, fichaje, ausencia aprobada y nómina básica visible en su portal.
 *  6. Aislamiento: la segunda empresa no ve nada y la sesión del empleado no sirve en otra empresa.
 *  7. Desactivación: todo bloqueado otra vez (también el portal) y los datos se conservan; al reactivar reaparecen.
 *
 * Ningún correo real: el proveedor de correo del banco de pruebas solo registra.
 *
 *   REGISTRY_TEST_DATABASE_URL=mysql://root:root@127.0.0.1:33341/registro_test \
 *     pnpm vitest run server/people.contratable.e2e.mysql.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { CommerceClient } from "./commerceClient";
import { startEssentialApp, data, errCode, isLicenseDenied, type EssentialApp, type Co, type Res } from "./essentialApp.testkit";

// Doble del plano de control (nunca el real): la ficha de Elephant People tal como está publicada, «bajo solicitud»
vi.mock("./commerceClient", async (orig) => {
  const real = await orig<typeof import("./commerceClient")>();
  const catalog = {
    purchasesEnabled: true,
    items: [
      { key: "connect-people", name: "Elephant People", family: "connect", kind: "module", metric: null, step: null, commercialStatus: "on_request", capabilities: ["people-hr"], monthly: null, purchasable: false },
    ],
  };
  const client: Partial<CommerceClient> = { catalog: async () => catalog as never };
  return { ...real, commerceClientFromEnv: () => client as CommerceClient };
});

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
vi.setConfig({ testTimeout: 60_000 });
const CAP = "people-hr";
/** Vocabulario de la instalación sectorial original: nunca debe verlo una pyme. */
const FOREIGN = /n[aá]yade|skicenter|monitores|temporada|actividades acu[aá]ticas|\bREAV\b/i;
const HR_TABLES = [
  "hr_bonus", "hr_irpf_ledger", "hr_leave_balance", "hr_leave_requests", "hr_payroll_batches", "hr_payslips",
  "hr_schedule_exceptions", "hr_schedule_templates", "hr_settings", "hr_ss_ledger", "hr_time_clock",
  "monitors", "monitor_documents", "monitor_payroll",
];

const evidence: string[] = [];
const note = (s: string) => evidence.push(s);

describe.skipIf(!URL_)("Elephant People contratable (aplicación real, dos empresas Essential)", () => {
  let ess: EssentialApp;
  const adm: Record<Co, string> = { a: "", b: "" };
  let agA = "";
  let userA = "";
  let empA = "";
  const A = { employeeId: 0, leaveId: 0, payslipId: 0, clockId: 0 };
  const EMP_EMAIL = "lucia.empleada@empresa-a.example";
  const EMP_PASS = "clave-portal-empleada-1";

  const ok = (r: Res, what: string) => {
    if (r.status !== 200) throw new Error(`${what}: HTTP ${r.status} ${r.text.slice(0, 500)}`);
    return data(r);
  };
  const menu = async (co: Co, cookie: string) => {
    const { capabilityStateFrom, routeAccess } = await import("../shared/adminNav");
    const ov = ok(await ess.q(co, "subscription.overview", undefined, cookie), "overview");
    const can = capabilityStateFrom(ov);
    const nav = ok(await ess.q(co, "panel.navigation", undefined, cookie), "panel.navigation") as { entries: Array<{ moduleId: string; item?: { label: string; href: string; children?: Array<{ label: string }> } }>; routes?: any[] };
    const people = nav.entries.find((e) => e.moduleId === "people" && e.item);
    return { can, people, access: routeAccess("/admin/personal/empleados/1", can, nav.routes) };
  };
  const count = async (co: Co, table: string) => Number((await ess.sql(co, `SELECT COUNT(*) AS n FROM \`${table}\``))[0].n);

  beforeAll(async () => {
    // Autenticación local como en el despliegue multiempresa (la usan también las subidas de archivos)
    process.env.LOCAL_AUTH = "true";
    ess = await startEssentialApp(URL_!, "people");
    adm.a = await ess.login("a", "admin");
    adm.b = await ess.login("b", "admin");
    agA = await ess.login("a", "agente");
    userA = await ess.login("a", "user");
  }, 300_000);

  afterAll(async () => {
    // eslint-disable-next-line no-console
    console.log(["", "EVIDENCIA — Elephant People contratable:", ...evidence.map((e) => `  · ${e}`)].join("\n"));
    await ess?.close();
  });

  it("1. empresa nueva Essential: las tablas de Personal están en su propia BD y vacías", async () => {
    for (const co of ["a", "b"] as Co[]) {
      const rows = await ess.sql(co, "SELECT TABLE_NAME AS t FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()");
      const tables = new Set(rows.map((r) => String(r.t)));
      expect(HR_TABLES.filter((t) => !tables.has(t))).toEqual([]);
      for (const t of ["monitors", "hr_time_clock", "hr_payslips", "hr_leave_requests"]) expect(await count(co, t)).toBe(0);
    }
    const [dbA] = await ess.sql("a", "SELECT DATABASE() AS d");
    const [dbB] = await ess.sql("b", "SELECT DATABASE() AS d");
    expect(dbA.d).not.toBe(dbB.d);
    note(`1 baseline: ${HR_TABLES.length} tablas de Personal en la BD de cada empresa (${dbA.d} ≠ ${dbB.d}), vacías; sin migración nueva`);
  });

  it("2. sin la extensión: 403 por licencia en servidor (panel, portal, lecturas heredadas y subidas) y candado", async () => {
    for (const co of ["a", "b"] as Co[]) {
      const cookie = adm[co];
      const m = await menu(co, cookie);
      expect(m.can(CAP)).toBeNull();
      expect(m.people).toBeUndefined();
      expect(m.access).toBe("not_included");
      expect(isLicenseDenied(await ess.q(co, "hr.employees.list", {}, cookie), CAP)).toBe(true);
      expect(isLicenseDenied(await ess.m(co, "hr.employees.create", { fullName: "Ana Empleada" }, cookie), CAP)).toBe(true);
      expect(isLicenseDenied(await ess.q(co, "hr.onboarding.status", undefined, cookie), CAP)).toBe(true);
      expect(isLicenseDenied(await ess.q(co, "hr.portal.me", undefined, cookie), CAP)).toBe(true);
      expect(isLicenseDenied(await ess.m(co, "hr.portal.activate", { token: "x".repeat(64), password: "secreta-123" }), CAP)).toBe(true);
      expect(isLicenseDenied(await ess.q(co, "operations.monitors.list", {}, cookie), CAP)).toBe(true);
      for (const p of ["/api/upload/monitor-doc", "/api/upload/monitor-photo"]) {
        const r = await ess.call(co, "POST", p, { cookie });
        expect([p, r.status, r.json?.capability, r.json?.error]).toEqual([p, 403, CAP, "Esta función no está incluida en tu plan."]);
      }
      const item = (ok(await ess.q(co, "connect.catalog", undefined, cookie), "connect.catalog").items as any[]).find((i) => i.key === "connect-people");
      expect(item).toBeTruthy();
      expect([item.state, item.capabilities]).toEqual(["on_request", [CAP]]);
    }
    note("2 sin People en A y B: hr.* (también portal y activación), operations.monitors.* y subidas REST → 403 capability=people-hr; sin menú; /admin/personal «no incluido»; ficha connect-people «bajo solicitud» (candado de LockedFeature)");
  });

  it("3. activación: entrada de menú «Personal» con sus apartados, ruta permitida y primeros pasos pendientes", async () => {
    await ess.setCapability("a", CAP, "active");
    const m = await menu("a", adm.a);
    expect(m.can(CAP)).toBe("active");
    expect(m.people?.item?.label).toBe("Personal");
    expect(m.people?.item?.href).toBe("/admin/personal");
    expect(m.people?.item?.children?.map((c) => c.label)).toEqual(["Resumen", "Empleados", "Fichajes", "Nóminas", "Vacaciones", "Configuración"]);
    expect(m.access).toBe("allowed");
    expect((ok(await ess.q("a", "connect.catalog", undefined, adm.a), "catálogo").items as any[]).find((i) => i.key === "connect-people").state).toBe("active");
    const st = ok(await ess.q("a", "hr.onboarding.status", undefined, adm.a), "onboarding");
    expect([st.completed, st.total, st.allDone]).toEqual([0, 4, false]);
    expect(st.steps.map((s: any) => s.id)).toEqual(["settings", "firstEmployee", "schedule", "portal"]);
    for (const s of st.steps) expect(FOREIGN.test(`${s.title} ${s.description}`)).toBe(false);
    // B sigue sin la extensión
    expect((await menu("b", adm.b)).people).toBeUndefined();
    expect(isLicenseDenied(await ess.q("b", "hr.employees.list", {}, adm.b), CAP)).toBe(true);
    note("3 activación en A: menú Personal (Resumen, Empleados, Fichajes, Nóminas, Vacaciones, Configuración), ruta permitida, primeros pasos 0/4; B sigue bloqueada");
  });

  it("4. roles: solo administración gestiona Personal", async () => {
    for (const [who, cookie] of [["agente", agA], ["user", userA]] as const) {
      const r = await ess.q("a", "hr.employees.list", {}, cookie);
      expect([who, r.status, errCode(r)]).toEqual([who, 403, "FORBIDDEN"]);
      expect(isLicenseDenied(r, CAP)).toBe(false);
      expect(errCode(await ess.m("a", "hr.employees.create", { fullName: "Intruso" }, cookie))).toBe("FORBIDDEN");
      // Tampoco usan el portal del empleado
      expect(errCode(await ess.q("a", "hr.portal.me", undefined, cookie))).toBe("FORBIDDEN");
    }
    note("4 roles: agente y usuario → FORBIDDEN (permiso, no licencia) en hr.employees.* y en el portal del empleado");
  });

  it("5. alta de empleado → horario → acceso al portal → fichaje, ausencia y nómina", async () => {
    // Configuración básica (paso 1)
    ok(await ess.m("a", "hr.settings.update", { ssCompanyPercent: 31, defaultHolidayDays: 23, defaultWeeklyHours: 40 }, adm.a), "settings");
    expect(errCode(await ess.m("a", "hr.employees.create", { fullName: "L" }, adm.a))).toBe("BAD_REQUEST");
    A.employeeId = ok(await ess.m("a", "hr.employees.create", { fullName: "Lucía Empleada", email: EMP_EMAIL, position: "Administración", department: "Oficina", contractType: "indefinido", weeklyHours: 40 }, adm.a), "alta").id;
    expect(A.employeeId).toBeGreaterThan(0);

    // Horario semanal: validación en servidor con mensaje en español y alta de L-V
    const bad = await ess.m("a", "hr.schedule.setWeek", { employeeId: A.employeeId, slots: [{ weekday: 1, startTime: "14:00", endTime: "09:00" }] }, adm.a);
    expect([errCode(bad), bad.json?.error?.json?.message]).toEqual(["BAD_REQUEST", "Lunes: la hora de salida debe ser posterior a la de entrada."]);
    expect(errCode(await ess.m("a", "hr.schedule.setWeek", { employeeId: 999999, slots: [] }, adm.a))).toBe("NOT_FOUND");
    const week = [1, 2, 3, 4, 5].map((weekday) => ({ weekday, startTime: "09:00", endTime: "17:00" }));
    ok(await ess.m("a", "hr.schedule.setWeek", { employeeId: A.employeeId, slots: week }, adm.a), "horario");
    expect((ok(await ess.q("a", "hr.schedule.listForEmployee", { employeeId: A.employeeId }, adm.a), "horario") as any[]).length).toBe(5);

    // Acceso al portal: nunca convierte una cuenta del panel en empleado
    const adminEmail = (await ess.sql("a", "SELECT email FROM users WHERE role = 'admin' LIMIT 1"))[0].email;
    const other = ok(await ess.m("a", "hr.employees.create", { fullName: "Persona Con Correo Del Panel", email: adminEmail }, adm.a), "alta 2").id;
    const taken = await ess.m("a", "hr.employees.createPortalAccess", { employeeId: other, sendEmailNow: false }, adm.a);
    expect([errCode(taken), taken.json?.error?.json?.message]).toEqual(["BAD_REQUEST", "Ese correo ya pertenece a un usuario del panel. Usa otro correo para el acceso al portal del empleado."]);
    expect((await ess.sql("a", "SELECT role FROM users WHERE email = ?", [adminEmail]))[0].role).toBe("admin");
    ok(await ess.m("a", "hr.employees.delete", { id: other }, adm.a), "baja de la ficha de prueba");

    const before = ess.mails.length;
    const inv = ok(await ess.m("a", "hr.employees.createPortalAccess", { employeeId: A.employeeId, sendEmailNow: true }, adm.a), "acceso portal");
    expect(inv.inviteUrl).toMatch(new RegExp(`^https://${ess.ids.a.replace(/[-]/g, "\\-")}\\.elephantsource\\.es/empleado/activar\\?token=[0-9a-f]{64}$`));
    const mail = ess.mails.slice(before).find((m) => m.to.some((t) => t.email === EMP_EMAIL));
    if (inv.emailSent) {
      expect(mail?.subject).toMatch(/Portal del Empleado/);
      expect(FOREIGN.test(`${mail?.subject} ${mail?.htmlContent}`)).toBe(false);
      expect(mail?.htmlContent).toContain("podrás fichar");
    }
    const token = new URL(inv.inviteUrl).searchParams.get("token")!;
    expect(errCode(await ess.m("a", "hr.portal.activate", { token, password: "corta" }))).toBe("BAD_REQUEST");
    ok(await ess.m("a", "hr.portal.activate", { token, password: EMP_PASS }), "activación");
    expect(errCode(await ess.m("a", "hr.portal.activate", { token, password: EMP_PASS }))).toBe("NOT_FOUND");
    const login = await ess.call("a", "POST", "/api/auth/login", { body: { email: EMP_EMAIL, password: EMP_PASS } });
    expect(login.status).toBe(200);
    empA = login.cookie!;

    // Portal: sus datos, sin datos fiscales internos; nada de la administración
    const me = ok(await ess.q("a", "hr.portal.me", undefined, empA), "portal.me");
    expect([me.id, me.fullName]).toEqual([A.employeeId, "Lucía Empleada"]);
    expect(me).not.toHaveProperty("irpfPercent");
    expect(errCode(await ess.q("a", "hr.employees.list", {}, empA))).toBe("FORBIDDEN");
    expect(errCode(await ess.q("a", "hr.payslips.list", {}, empA))).toBe("FORBIDDEN");
    expect(ok(await ess.q("a", "hr.schedule.myTheoreticalToday", undefined, empA), "horas previstas")).toHaveProperty("date");

    // Fichaje: entrada idempotente y salida
    const in1 = ok(await ess.m("a", "hr.timeClock.clockIn", {}, empA), "entrada");
    const in2 = ok(await ess.m("a", "hr.timeClock.clockIn", {}, empA), "entrada repetida");
    expect([in2.id, in2.alreadyOpen]).toEqual([in1.id, true]);
    ok(await ess.m("a", "hr.timeClock.clockOut", {}, empA), "salida");
    const out2 = await ess.m("a", "hr.timeClock.clockOut", {}, empA);
    expect([errCode(out2), out2.json?.error?.json?.message]).toEqual(["BAD_REQUEST", "No tienes ningún fichaje abierto. Ficha entrada primero."]);
    A.clockId = in1.id;
    const mine = ok(await ess.q("a", "hr.timeClock.myList", {}, empA), "mis fichajes") as any[];
    expect(mine.map((r) => [r.id, r.status])).toEqual([[A.clockId, "closed"]]);
    const all = ok(await ess.q("a", "hr.timeClock.list", {}, adm.a), "fichajes (admin)");
    expect(JSON.stringify(all)).toContain(`"id":${A.clockId}`);

    // Ausencia: la pide en su portal y la aprueba administración
    const y = new Date().getFullYear() + 1;
    expect(errCode(await ess.m("a", "hr.leaves.request", { type: "vacaciones", fromDate: `${y}-08-10`, toDate: `${y}-08-03` }, empA))).toBe("BAD_REQUEST");
    A.leaveId = ok(await ess.m("a", "hr.leaves.request", { type: "vacaciones", fromDate: `${y}-08-03`, toDate: `${y}-08-07`, reason: "Vacaciones de verano" }, empA), "solicitud").id;
    const pending = ok(await ess.q("a", "hr.leaves.listAll", { status: "pendiente" }, adm.a), "pendientes") as any[];
    expect(pending.map((r) => [r.id, r.employeeName])).toEqual([[A.leaveId, "Lucía Empleada"]]);
    ok(await ess.m("a", "hr.leaves.approve", { id: A.leaveId }, adm.a), "aprobación");
    expect((ok(await ess.q("a", "hr.leaves.listMine", undefined, empA), "mis ausencias") as any[]).map((r) => r.status)).toEqual(["aprobada"]);

    // Nómina básica: la registra administración y la empleada la ve en su portal con el neto calculado
    const period = `${new Date().getFullYear()}-01`;
    A.payslipId = ok(await ess.m("a", "hr.payslips.upsert", { employeeId: A.employeeId, period, grossSalary: 1800, irpfAmount: 200, ssEmployee: 115 }, adm.a), "nómina").id;
    const slips = ok(await ess.q("a", "hr.portal.myPayslips", undefined, empA), "mis nóminas") as any[];
    expect(slips.map((s) => [s.id, s.period, Number(s.netSalary)])).toEqual([[A.payslipId, period, 1485]]);

    const st = ok(await ess.q("a", "hr.onboarding.status", undefined, adm.a), "onboarding");
    expect([st.completed, st.allDone]).toEqual([4, true]);
    note(`5 A: alta #${A.employeeId}, horario L-V 40 h, invitación (correo ${inv.emailSent ? "registrado" : "no enviado"}) → activación → portal; fichaje #${A.clockId} (entrada idempotente), vacaciones #${A.leaveId} aprobadas, nómina ${period} neto 1485 € visible al empleado; primeros pasos 4/4`);
  });

  it("6. aislamiento: la segunda empresa no ve nada y la sesión del empleado no sirve en ella", async () => {
    await ess.setCapability("b", CAP, "active");
    try {
      expect(ok(await ess.q("b", "hr.employees.list", {}, adm.b), "lista B")).toEqual([]);
      expect(errCode(await ess.q("b", "hr.employees.get", { id: A.employeeId }, adm.b))).toBe("NOT_FOUND");
      expect(ok(await ess.q("b", "hr.leaves.listAll", {}, adm.b), "ausencias B")).toEqual([]);
      expect(ok(await ess.q("b", "hr.onboarding.status", undefined, adm.b), "onboarding B").completed).toBe(0);
      // La cookie de la empleada de A no abre el portal (ni nada) en B
      const cross = await ess.q("b", "hr.portal.me", undefined, empA);
      expect(cross.status).not.toBe(200);
      expect([401, 403]).toContain(cross.status);
      expect((await ess.m("b", "hr.timeClock.clockIn", {}, empA)).status).not.toBe(200);
      // Ni la cookie de administración de A en B
      expect((await ess.q("b", "hr.employees.list", {}, adm.a)).status).not.toBe(200);
      for (const t of ["monitors", "hr_time_clock", "hr_leave_requests", "hr_payslips", "hr_schedule_templates"]) expect([t, await count("b", t)]).toEqual([t, 0]);
      const login = await ess.call("b", "POST", "/api/auth/login", { body: { email: EMP_EMAIL, password: EMP_PASS } });
      expect(login.status).not.toBe(200);
    } finally {
      await ess.setCapability("b", CAP, null);
    }
    note("6 B (con People): lista vacía, ficha de A → NOT_FOUND, sus tablas a 0; cookies de A (empleada y admin) y login de la empleada en B → rechazados");
  });

  it("7. desactivación: todo bloqueado (también el portal), datos conservados; solo lectura y reactivación", async () => {
    const snapshot = async () => Object.fromEntries(await Promise.all(["monitors", "hr_time_clock", "hr_leave_requests", "hr_payslips", "hr_schedule_templates", "hr_irpf_ledger"].map(async (t) => [t, await count("a", t)] as const)));
    const kept = await snapshot();
    expect(kept).toMatchObject({ monitors: 1, hr_time_clock: 1, hr_leave_requests: 1, hr_payslips: 1, hr_schedule_templates: 5 });

    await ess.setCapability("a", CAP, null);
    const m = await menu("a", adm.a);
    expect([m.can(CAP), m.people, m.access]).toEqual([null, undefined, "not_included"]);
    expect((ok(await ess.q("a", "connect.catalog", undefined, adm.a), "catálogo").items as any[]).find((i) => i.key === "connect-people").state).toBe("on_request");
    expect(isLicenseDenied(await ess.q("a", "hr.employees.list", {}, adm.a), CAP)).toBe(true);
    expect(isLicenseDenied(await ess.q("a", "hr.portal.me", undefined, empA), CAP)).toBe(true);
    expect(isLicenseDenied(await ess.m("a", "hr.timeClock.clockIn", {}, empA), CAP)).toBe(true);
    expect(isLicenseDenied(await ess.q("a", "operations.monitors.get", { id: A.employeeId }, adm.a), CAP)).toBe(true);
    expect((await ess.call("a", "POST", "/api/upload/monitor-doc", { cookie: adm.a })).status).toBe(403);
    expect(await snapshot()).toEqual(kept);

    // Solo lectura (p. ej. impago o fin de periodo): se consulta, no se modifica
    await ess.setCapability("a", CAP, "read_only");
    expect((ok(await ess.q("a", "hr.employees.list", {}, adm.a), "lista en solo lectura") as any[]).map((e) => e.id)).toEqual([A.employeeId]);
    expect(isLicenseDenied(await ess.m("a", "hr.timeClock.clockIn", {}, empA), CAP)).toBe(true);
    const ro = await ess.call("a", "POST", "/api/upload/monitor-doc", { cookie: adm.a });
    expect([ro.status, ro.json?.error]).toEqual([403, "Esta función está en solo lectura: no se pueden hacer cambios."]);

    // Reactivación: los mismos datos, sin rehacer nada
    await ess.setCapability("a", CAP, "active");
    expect(ok(await ess.q("a", "hr.portal.me", undefined, empA), "portal reactivado").id).toBe(A.employeeId);
    expect((ok(await ess.q("a", "hr.portal.myPayslips", undefined, empA), "nóminas reactivado") as any[]).length).toBe(1);
    expect(await snapshot()).toEqual(kept);
    await ess.setCapability("a", CAP, null);
    note(`7 desactivación en A: menú fuera, hr.* y portal → 403 people-hr, subida → 403; datos intactos ${JSON.stringify(kept)}; solo lectura consulta sí / cambios no; reactivación con los mismos datos`);
  });
});
