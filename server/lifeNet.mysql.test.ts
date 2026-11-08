/**
 * Life Net · organización personal y familiar con la aplicación real sobre MySQL (opt-in, REGISTRY_TEST_DATABASE_URL):
 * dos empresas nuevas desde la baseline y las migraciones de empresa (incluida la 0047). Licencia life-net (sin ella y
 * en solo lectura), quién accede (administración y miembros con acceso), hogar y titular, cupo de 5 miembros con perfiles
 * sin acceso, agenda compartida, tareas con varios responsables y quién las hizo, seguimiento por miembro, aislamiento
 * entre empresas y recordatorios por correo idempotentes (proveedor falso: ningún envío real).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startEssentialApp, data, errCode, isLicenseDenied, type EssentialApp } from "./essentialApp.testkit";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
const CAP = "life-net";

/** Fecha AAAA-MM-DD y hora HH:MM de Madrid desplazadas `minutes` desde ahora. */
function madrid(minutes = 0): { day: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(Date.now() + minutes * 60_000));
  const g = (t: string) => parts.find((p) => p.type === t)!.value;
  return { day: `${g("year")}-${g("month")}-${g("day")}`, time: `${g("hour")}:${g("minute")}` };
}

describe.skipIf(!URL_)("Life Net · hogar, miembros, agenda, tareas, seguimiento y recordatorios (aplicación real, dos empresas)", () => {
  let ess: EssentialApp;
  let adA: string;
  let agA: string;
  let coA: string;
  let adB: string;
  let agenteUser = 0;
  let controlerUser = 0;
  let userRole = 0;
  let holder = 0;
  let leo = 0;
  let agente = 0;
  let eventId = 0;
  let taskShared = 0;
  let taskLeo = 0;

  const m = (proc: string, input: unknown, cookie = adA, co: "a" | "b" = "a") => ess.m(co, `lifeNet.${proc}`, input, cookie);
  const q = (proc: string, input?: unknown, cookie = adA, co: "a" | "b" = "a") => ess.q(co, `lifeNet.${proc}`, input, cookie);
  const ok = async (p: Promise<{ status: number; json: any; text: string }>) => {
    const r = await p;
    if (r.status !== 200) throw new Error(`${r.status}: ${r.text.slice(0, 400)}`);
    return data(r);
  };

  beforeAll(async () => {
    ess = await startEssentialApp(URL_!, "lifenet");
    adA = await ess.login("a", "admin");
    agA = await ess.login("a", "agente");
    coA = await ess.login("a", "controler");
    adB = await ess.login("b", "admin");
    agenteUser = await ess.userId("a", "agente");
    controlerUser = await ess.userId("a", "controler");
    userRole = await ess.userId("a", "user");
  }, 300_000);
  afterAll(async () => {
    await ess?.close();
  });

  it("sin la capacidad life-net no responde (403 de licencia)", async () => {
    expect(isLicenseDenied(await q("overview"), CAP)).toBe(true);
    expect(isLicenseDenied(await m("saveHousehold", { holderFirstName: "Ana", holderLastName: "Prueba" }), CAP)).toBe(true);
    await ess.setCapability("a", CAP, "active");
    await ess.setCapability("b", CAP, "active");
  });

  it("solo la administración y los miembros con acceso ven el hogar", async () => {
    const ov = await ok(q("overview"));
    expect(ov.household).toMatchObject({ configured: false, householdName: "Mi hogar", memberLimit: 5, activeMembers: 0 });
    expect(errCode(await q("overview", undefined, agA))).toBe("FORBIDDEN");
    expect(errCode(await q("tasks", { status: "open" }, agA))).toBe("FORBIDDEN");
  });

  it("hogar y titular: nombre y apellidos, NIF opcional y «Hogar de …» por defecto; el titular es el primer miembro", async () => {
    expect(errCode(await m("saveHousehold", { holderFirstName: "Ana", holderLastName: "Prueba", holderTaxId: "12345678A" }))).toBe("BAD_REQUEST");
    expect(errCode(await m("saveHousehold", { holderFirstName: "Ana", holderLastName: "Prueba" }, agA))).toBe("FORBIDDEN");
    const h = await ok(m("saveHousehold", { holderFirstName: "Ana", holderLastName: "QA-LIFE Prueba" }));
    expect(h).toMatchObject({ configured: true, householdName: "Hogar de Ana QA-LIFE Prueba", holderTaxId: null, activeMembers: 1 });
    const h2 = await ok(m("saveHousehold", { householdName: "QA-LIFE Casa de la playa", holderFirstName: "Ana", holderLastName: "QA-LIFE Prueba", holderTaxId: "12345678z" }));
    expect(h2).toMatchObject({ householdName: "QA-LIFE Casa de la playa", holderTaxId: "12345678Z", activeMembers: 1 });
    const members = await ok(q("members"));
    expect(members).toHaveLength(1);
    expect(members[0]).toMatchObject({ displayName: "Ana", relationship: "titular", isHolder: true, hasAccess: true, userId: await ess.userId("a", "admin") });
    holder = members[0].id;
  });

  it("miembros: perfiles sin acceso y vinculados a usuarios del panel; cupo de 5", async () => {
    leo = (await ok(m("upsertMember", { displayName: "Leo", relationship: "hijo", color: "verde", userId: null }))).id;
    agente = (await ok(m("upsertMember", { displayName: "Luis", relationship: "pareja", color: "azul", userId: agenteUser }))).id;
    // Un usuario sin acceso al panel (rol user) no se vincula; el mismo usuario no se vincula dos veces
    expect(errCode(await m("upsertMember", { displayName: "Web", relationship: "otro", color: "gris", userId: userRole }))).toBe("BAD_REQUEST");
    expect(errCode(await m("upsertMember", { displayName: "Otra vez Luis", relationship: "otro", color: "gris", userId: agenteUser }))).toBe("CONFLICT");
    expect(errCode(await m("upsertMember", { displayName: "Titular", relationship: "titular", color: "gris", userId: null }))).toBe("BAD_REQUEST");
    expect(errCode(await m("upsertMember", { displayName: "Del agente", relationship: "otro", color: "gris", userId: null }, agA))).toBe("FORBIDDEN");
    const abuela = (await ok(m("upsertMember", { displayName: "Carmen", relationship: "abuela", color: "rosa", userId: null }))).id;
    await ok(m("upsertMember", { displayName: "Sara", relationship: "hija", color: "violeta", userId: controlerUser }));
    expect((await ok(q("household"))).activeMembers).toBe(5);
    const over = await m("upsertMember", { displayName: "Sexto", relationship: "otro", color: "gris", userId: null });
    expect(errCode(over)).toBe("BAD_REQUEST");
    expect(over.json.error.json.message).toMatch(/5 de 5/);
    // Archivar libera una plaza; recuperar con el cupo lleno no se puede; el titular no se archiva
    expect(errCode(await m("setMemberActive", { id: holder, active: false }))).toBe("BAD_REQUEST");
    await ok(m("setMemberActive", { id: abuela, active: false }));
    const temporal = (await ok(m("upsertMember", { displayName: "Temporal", relationship: "otro", color: "gris", userId: null }))).id;
    expect(errCode(await m("setMemberActive", { id: abuela, active: true }))).toBe("BAD_REQUEST");
    await ok(m("setMemberActive", { id: temporal, active: false }));
    await ok(m("setMemberActive", { id: abuela, active: true }));
    expect((await ok(q("members", { includeArchived: true }))).length).toBe(6);
    expect((await ok(q("members"))).length).toBe(5);
    // Elegibles para vincular: los usuarios del panel (no el rol user)
    const users = await ok(q("linkableUsers"));
    expect(users.map((u: any) => u.id)).toContain(agenteUser);
    expect(users.map((u: any) => u.id)).not.toContain(userRole);
    expect(errCode(await q("linkableUsers", undefined, agA))).toBe("FORBIDDEN");
  });

  it("un miembro con acceso entra; no ve los correos de los demás", async () => {
    const acc = await ok(q("access", undefined, agA));
    expect(acc).toEqual({ isAdmin: false, memberId: agente, canWrite: true });
    const list = await ok(q("members", { includeArchived: true }, agA));
    expect(list.every((x: any) => x.userEmail === null)).toBe(true);
    expect(list).toHaveLength(5);
  });

  it("agenda compartida: actividad con varios miembros, filtro por miembro y quién puede cambiarla", async () => {
    const d = madrid(24 * 60).day;
    const ev = await ok(m("upsertEvent", { title: "QA-LIFE Natación", kind: "actividad", date: d, startTime: "17:00", endTime: "18:00", location: "Polideportivo", memberIds: [leo, agente] }));
    eventId = ev.id;
    expect(ev).toMatchObject({ date: d, startTime: "17:00", endTime: "18:00", memberIds: [leo, agente].sort((x, y) => x - y) });
    await ok(m("upsertEvent", { title: "QA-LIFE Cita médica", kind: "compromiso", date: d, memberIds: [holder] }));
    expect(errCode(await m("upsertEvent", { title: "Sin nadie", kind: "actividad", date: d, memberIds: [] }))).toBe("BAD_REQUEST");
    expect(errCode(await m("upsertEvent", { title: "Con un archivado", kind: "actividad", date: d, memberIds: [999999] }))).toBe("BAD_REQUEST");
    const all = await ok(q("events", { from: d, to: d }));
    expect(all.map((e: any) => e.title)).toEqual(["QA-LIFE Cita médica", "QA-LIFE Natación"]);
    expect((await ok(q("events", { from: d, to: d, memberId: leo }))).map((e: any) => e.title)).toEqual(["QA-LIFE Natación"]);
    // El participante la cambia; la cita del titular no es suya
    await ok(m("upsertEvent", { id: eventId, title: "QA-LIFE Natación (cambio)", kind: "actividad", date: d, startTime: "17:30", memberIds: [leo, agente] }, agA));
    const cita = all.find((e: any) => e.title === "QA-LIFE Cita médica").id;
    expect(errCode(await m("archiveEvent", { id: cita }, agA))).toBe("FORBIDDEN");
    expect(errCode(await q("events", { from: d, to: "2099-01-01" }))).toBe("BAD_REQUEST");
  });

  it("tareas con varios responsables: vencida, hecha por quién y cuándo, y reabrir", async () => {
    const ayer = madrid(-24 * 60).day;
    const t1 = await ok(m("upsertTask", { title: "QA-LIFE Comprar material escolar", dueDate: ayer, assigneeIds: [holder, agente] }));
    taskShared = t1.id;
    expect(t1).toMatchObject({ state: "overdue", status: "pending", assigneeIds: [holder, agente].sort((x, y) => x - y) });
    taskLeo = (await ok(m("upsertTask", { title: "QA-LIFE Ordenar la habitación", assigneeIds: [leo] }))).id;
    expect(errCode(await m("upsertTask", { title: "Hora sin fecha", dueTime: "10:00", assigneeIds: [] }))).toBe("BAD_REQUEST");
    // El miembro la marca como suya
    const done = await ok(m("setTaskDone", { id: taskShared, done: true }, agA));
    expect(done).toMatchObject({ status: "done", state: "done", doneByMemberId: agente, doneByUserId: agenteUser });
    expect(Math.abs(done.doneAt - Date.now())).toBeLessThan(120_000);
    // Solo la administración la marca en nombre de otro; Leo no tiene acceso: la marca la titular por él
    expect(errCode(await m("setTaskDone", { id: taskLeo, done: true, doneByMemberId: leo }, agA))).toBe("FORBIDDEN");
    expect(await ok(m("setTaskDone", { id: taskLeo, done: true, doneByMemberId: leo }))).toMatchObject({ status: "done", doneByMemberId: leo });
    expect(await ok(m("setTaskDone", { id: taskLeo, done: false }))).toMatchObject({ status: "pending", doneByMemberId: null, doneAt: null });
    expect((await ok(q("tasks", { status: "open", memberId: leo }))).map((t: any) => t.id)).toEqual([taskLeo]);
    expect((await ok(q("tasks", { status: "done" }, agA))).map((t: any) => t.id)).toEqual([taskShared]);
  });

  it("seguimiento por miembro: pendientes, vencidas, hechas y actividades", async () => {
    await ok(m("upsertTask", { title: "QA-LIFE Llamar al pediatra", dueDate: madrid(-48 * 60).day, assigneeIds: [holder] }));
    const tr = await ok(q("tracking", undefined, agA));
    const by = new Map(tr.members.map((x: any) => [x.id, x]));
    expect(by.get(holder)).toMatchObject({ pending: 0, overdue: 1, done: 1, upcomingEvents: 1 });
    expect(by.get(agente)).toMatchObject({ pending: 0, overdue: 0, done: 1, upcomingEvents: 1 });
    expect(by.get(leo)).toMatchObject({ pending: 1, overdue: 0, done: 0, upcomingEvents: 1 });
    expect(tr.recentDone[0]).toMatchObject({ id: taskShared, doneByMemberId: agente });
    const ov = await ok(q("overview", undefined, agA));
    expect(ov.memberId).toBe(agente);
    expect(ov.myEvents.map((e: any) => e.id)).toContain(eventId);
  });

  it("aislamiento: otra empresa no ve ni toca el hogar de la primera", async () => {
    expect(errCode(await q("tasks", { status: "all" }, adB, "b"))).toBeUndefined();
    expect(await ok(q("tasks", { status: "all" }, adB, "b"))).toEqual([]);
    expect(await ok(q("members", undefined, adB, "b"))).toEqual([]);
    expect(errCode(await m("setTaskDone", { id: taskLeo, done: true }, adB, "b"))).toBe("NOT_FOUND");
    expect(errCode(await m("archiveEvent", { id: eventId }, adB, "b"))).toBe("NOT_FOUND");
  });

  it("recordatorios: un correo por responsable con acceso, sin reenvíos; los perfiles sin acceso no reciben nada", async () => {
    const { runLifeReminders } = await import("./lifeNet/reminders");
    const { runWithTenant } = await import("./_core/tenant");
    const { withTenantDb } = await import("./_core/dbRegistry");
    const inA = <T>(fn: () => Promise<T>) => runWithTenant(ess.ids.a, () => withTenantDb(ess.ids.a, fn));
    const now = madrid(-5);
    const later = madrid(24 * 60);
    const t = await ok(m("upsertTask", { title: "QA-LIFE Recoger el paquete", dueDate: later.day, remindDate: now.day, remindTime: now.time, assigneeIds: [agente, leo] }));
    await ok(m("upsertEvent", { id: eventId, title: "QA-LIFE Natación (cambio)", kind: "actividad", date: later.day, startTime: "17:30", remindDate: now.day, remindTime: now.time, memberIds: [leo, agente] }));
    // Una ya vencida hace más de 24 h no se envía
    const old = madrid(-26 * 60);
    await ok(m("upsertTask", { title: "QA-LIFE Muy antigua", remindDate: old.day, remindTime: old.time, assigneeIds: [agente] }));
    const before = ess.mails.length;
    const r1 = await inA(() => runLifeReminders());
    expect(r1).toEqual({ sent: 2, failed: 0 });
    const mails = ess.mails.slice(before);
    expect(mails.map((x) => x.to[0].email).sort()).toEqual([`agente@${ess.ids.a}.example`, `agente@${ess.ids.a}.example`]);
    expect(mails.map((x) => x.subject).sort()).toEqual(["Recordatorio: QA-LIFE Natación (cambio)", "Recordatorio: QA-LIFE Recoger el paquete"]);
    // Segunda pasada: nada nuevo
    expect(await inA(() => runLifeReminders())).toEqual({ sent: 0, failed: 0 });
    expect(ess.mails.length).toBe(before + 2);
    const rows = await ess.sql("a", "SELECT item_kind, item_id, member_id, status, attempts FROM life_reminders ORDER BY item_kind");
    expect(rows).toEqual([
      { item_kind: "event", item_id: eventId, member_id: agente, status: "sent", attempts: 1 },
      { item_kind: "task", item_id: t.id, member_id: agente, status: "sent", attempts: 1 },
    ]);
    // Hecha antes de la hora: no se recuerda
    const t2 = await ok(m("upsertTask", { title: "QA-LIFE Ya hecha", remindDate: now.day, remindTime: now.time, assigneeIds: [agente] }));
    await ok(m("setTaskDone", { id: t2.id, done: true }, agA));
    expect(await inA(() => runLifeReminders())).toEqual({ sent: 0, failed: 0 });
    // La otra empresa, sin la capacidad, no ejecuta nada
    await ess.setCapability("b", CAP, null);
    const inB = <T>(fn: () => Promise<T>) => runWithTenant(ess.ids.b, () => withTenantDb(ess.ids.b, fn));
    expect(await inB(() => runLifeReminders())).toMatchObject({ skipped: "sin_licencia" });
  });

  it("en solo lectura se consulta pero no se escribe; el rol de solo lectura del panel tampoco escribe", async () => {
    await ess.setCapability("a", CAP, "read_only");
    expect((await q("tasks", { status: "open" })).status).toBe(200);
    expect(isLicenseDenied(await m("upsertTask", { title: "No", assigneeIds: [] }), CAP)).toBe(true);
    await ess.setCapability("a", CAP, "active");
    // El controler vinculado (rol de panel) escribe; un usuario desvinculado deja de entrar
    expect((await ok(q("access", undefined, coA))).canWrite).toBe(true);
    await ess.sql("a", "UPDATE life_members SET user_id = NULL WHERE user_id = ?", [controlerUser]);
    expect(errCode(await q("overview", undefined, coA))).toBe("FORBIDDEN");
  });
});
