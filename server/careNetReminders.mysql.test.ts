/**
 * Care Net · recordatorios de cita con la aplicación real sobre MySQL (opt-in, REGISTRY_TEST_DATABASE_URL): dos
 * empresas nuevas desde la baseline y las migraciones de empresa (incluida la 0051). Ajustes (apagados por defecto,
 * solo la administración los cambia), tarea por empresa (un correo por cita y antelación, sin reenvíos, omitidos con
 * motivo), estado en el listado, «Enviar recordatorio ahora» (también en prueba gratuita) y aislamiento. Ningún correo real
 * (proveedor falso del kit).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startEssentialApp, data, errCode, type EssentialApp } from "./essentialApp.testkit";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
const CAP = "care-net";
const OP = { type: "operator" as const, id: "prueba-care-recordatorios" };

function madrid(minutes = 0): { day: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(Date.now() + minutes * 60_000));
  const g = (t: string) => parts.find((p) => p.type === t)!.value;
  return { day: `${g("year")}-${g("month")}-${g("day")}`, time: `${g("hour")}:${g("minute")}` };
}

describe.skipIf(!URL_)("Care Net · recordatorios de cita (aplicación real, dos empresas nuevas)", () => {
  let ess: EssentialApp;
  let adA: string;
  let agA: string;
  let adB: string;
  let masaje = 0;
  let order = 0;
  const at = madrid(23 * 60); // cita dentro de 23 h: abierta la ventana de 24 h, no la de 2 h

  const m = (proc: string, input: unknown, cookie = adA, co: "a" | "b" = "a") => ess.m(co, `careNet.${proc}`, input, cookie);
  const q = (proc: string, input: unknown, cookie = adA, co: "a" | "b" = "a") => ess.q(co, `careNet.${proc}`, input, cookie);
  const ok = async (p: Promise<{ status: number; json: any; text: string }>) => {
    const r = await p;
    if (r.status !== 200) throw new Error(`${r.status}: ${r.text.slice(0, 400)}`);
    return data(r);
  };
  /** Reserva de SPA del Core en una franja nueva (pagada y confirmada salvo que se indique). */
  async function booking(o: { email?: string; status?: string; hold?: string; when?: { day: string; time: string } } = {}): Promise<number> {
    const w = o.when ?? at;
    await ess.sql("a", "INSERT INTO spa_slots (treatmentId, resourceId, date, startTime, endTime, capacity, bookedCount) VALUES (?, (SELECT id FROM spa_resources LIMIT 1), ?, ?, ?, 2, 1)", [masaje, w.day, w.time, w.time]);
    const [{ id: slotId }] = await ess.sql("a", "SELECT MAX(id) AS id FROM spa_slots");
    const now = Date.now();
    const mo = `REM${String(++order).padStart(7, "0")}`;
    await ess.sql("a", "INSERT INTO reservations (product_id, product_name, booking_date, people, amount_total, status, customer_name, customer_email, merchant_order, created_at, updated_at, inventory_kind, inventory_ref_id, inventory_units, hold_status) VALUES (?, 'SPA: Masaje relajante', ?, 1, 4500, ?, 'Ana Ficticia', ?, ?, ?, ?, 'spa_slot', ?, 1, ?)",
      [masaje, w.day, o.status ?? "paid", o.email ?? "ana@clientes.example", mo, now, now, slotId, o.hold ?? "confirmada"]);
    return (await ess.sql("a", "SELECT id FROM reservations WHERE merchant_order = ?", [mo]))[0].id;
  }
  const runJob = async (co: "a" | "b" = "a") => {
    const { runCareReminders } = await import("./careNetReminders");
    const { runWithTenant } = await import("./_core/tenant");
    const { withTenantDb } = await import("./_core/dbRegistry");
    return runWithTenant(ess.ids[co], () => withTenantDb(ess.ids[co], () => runCareReminders()));
  };
  const sends = (id: number) => ess.sql("a", "SELECT lead_hours, status, reason, attempts FROM care_reminder_sends WHERE reservation_id = ? ORDER BY lead_hours", [id]);

  beforeAll(async () => {
    ess = await startEssentialApp(URL_!, "carerem");
    const { EntitlementAdmin } = await import("./_core/modules/mysqlEntitlements");
    const ent = new EntitlementAdmin((ess.registry.store as any).q);
    for (const co of ["a", "b"] as const) await ent.grant(ess.ids[co], "spa", OP);
    await ess.setCapability("a", CAP, "active");
    await ess.setCapability("b", CAP, "active");
    adA = await ess.login("a", "admin");
    agA = await ess.login("a", "agente");
    adB = await ess.login("b", "admin");
    await ess.sql("a", "INSERT INTO spa_categories (slug, name) VALUES ('masajes', 'Masajes')");
    const [{ id: cat }] = await ess.sql("a", "SELECT id FROM spa_categories WHERE slug = 'masajes'");
    await ess.sql("a", "INSERT INTO spa_treatments (slug, name, categoryId, price) VALUES ('masaje', 'Masaje relajante', ?, 45)", [cat]);
    masaje = (await ess.sql("a", "SELECT id FROM spa_treatments WHERE slug = 'masaje'"))[0].id;
    await ess.sql("a", "INSERT INTO spa_resources (type, name) VALUES ('terapeuta', 'Lucía')");
  }, 300_000);
  afterAll(async () => {
    await ess?.close();
  });

  it("ajustes: apagados por defecto; solo la administración los cambia", async () => {
    const s = await ok(q("reminderSettings", undefined, agA));
    expect(s).toMatchObject({ installed: true, settings: { enabled: false, leadHours: [24], extraText: "" } });
    expect(await runJob()).toMatchObject({ skippedAll: "desactivado" });
    expect((await m("saveReminderSettings", { enabled: true, leadHours: [24, 2], extraText: "" }, agA)).status).toBe(403);
    expect(errCode(await m("saveReminderSettings", { enabled: true, leadHours: [], extraText: "" }))).toBe("BAD_REQUEST");
    expect(errCode(await m("saveReminderSettings", { enabled: true, leadHours: [5], extraText: "" }))).toBe("BAD_REQUEST");
    const saved = await ok(m("saveReminderSettings", { enabled: true, leadHours: [2, 24], extraText: "Llega 10 minutos antes." }));
    expect(saved).toEqual({ enabled: true, leadHours: [24, 2], extraText: "Llega 10 minutos antes." });
  });

  // La prueba gratuita (el Core no envía a terceros → «omitido · prueba_gratuita») se cubre con dobles en
  // careNetReminders.test.ts: las empresas del kit no están restringidas.
  it("un correo por cita y antelación, sin reenvíos; omitidos con motivo", async () => {
    const r = await booking();
    const noMail = await booking({ email: "" });
    const pending = await booking({ status: "pending_payment", hold: "retenida" });
    const cancelled = await booking({ status: "cancelled", hold: "liberada" });
    const past = await booking({ when: madrid(-30) });
    const before = ess.mails.length;
    expect(await runJob()).toEqual({ sent: 1, failed: 0, skipped: 1 });
    const mails = ess.mails.slice(before);
    expect(mails.map((x) => x.to[0].email)).toEqual(["ana@clientes.example"]);
    expect(mails[0].subject).toMatch(new RegExp(`^Recordatorio de tu cita en .+, ${at.time}$`));
    for (const s of ["Masaje relajante", "Profesional: Lucía", at.time, "Llega 10 minutos antes."]) expect(mails[0].htmlContent).toContain(s);
    expect(await sends(r)).toEqual([{ lead_hours: 24, status: "sent", reason: null, attempts: 1 }]);
    expect(await sends(noMail)).toEqual([{ lead_hours: 24, status: "skipped", reason: "sin_correo", attempts: 0 }]);
    for (const id of [pending, cancelled, past]) expect(await sends(id)).toEqual([]);
    // Segunda pasada: nada nuevo
    expect(await runJob()).toEqual({ sent: 0, failed: 0, skipped: 0 });
    expect(ess.mails.length).toBe(before + 1);
    // Estado en el listado del panel
    const st = await ok(q("reminderStatus", { from: at.day, to: at.day }, agA));
    expect(st.find((x: any) => x.reservationId === r).summary).toMatchObject({ status: "sent", label: "Enviado · 24 h antes" });
    expect(st.find((x: any) => x.reservationId === noMail).summary.status).toBe("skipped");
  });

  it("«Enviar recordatorio ahora»: confirmadas y futuras con correo; sin doble clic", async () => {
    const r = await booking();
    const pending = await booking({ status: "pending_payment", hold: "retenida" });
    const before = ess.mails.length;
    // En prueba gratuita el Core solo envía a los buzones de la empresa: queda omitido, sin correo
    expect(await ok(m("sendReminderNow", { reservationId: r }, agA))).toMatchObject({ ok: false, status: "skipped" });
    expect(await sends(r)).toEqual([{ lead_hours: 0, status: "skipped", reason: "prueba_gratuita", attempts: 1 }]);
    expect(ess.mails.length).toBe(before);
    // Empresa de pago: sale
    await ess.markPaid("a");
    await ess.setCapability("a", CAP, "active");
    expect(await ok(m("sendReminderNow", { reservationId: r }, agA))).toEqual({ ok: true, status: "sent" });
    expect(errCode(await m("sendReminderNow", { reservationId: r }, agA))).toBe("BAD_REQUEST");
    expect(errCode(await m("sendReminderNow", { reservationId: pending }, agA))).toBe("BAD_REQUEST");
    expect(ess.mails.length).toBe(before + 1);
    expect(ess.mails[before].to[0].email).toBe("ana@clientes.example");
    expect(await sends(r)).toEqual([{ lead_hours: 0, status: "sent", reason: null, attempts: 2 }]);
    // El automático sigue su curso (el manual no cuenta como 24 h)
    expect((await runJob()).sent).toBe(1);
  });

  it("aislamiento: la otra empresa no ve ni envía recordatorios de la primera", async () => {
    expect(await ok(q("reminderStatus", { from: at.day, to: at.day }, adB, "b"))).toEqual([]);
    const [{ id }] = await ess.sql("a", "SELECT MAX(id) AS id FROM reservations");
    expect(errCode(await m("sendReminderNow", { reservationId: id }, adB, "b"))).toBe("BAD_REQUEST");
    expect(await runJob("b")).toMatchObject({ skippedAll: "desactivado" });
    await ess.setCapability("b", CAP, null);
    expect(await runJob("b")).toMatchObject({ skippedAll: "sin_licencia" });
  });
});
