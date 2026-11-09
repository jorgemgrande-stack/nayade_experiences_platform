/**
 * Automatizaciones avanzadas con la aplicación real sobre MySQL (opt-in, REGISTRY_TEST_DATABASE_URL): dos empresas nuevas
 * desde la baseline y las migraciones de empresa (incluida la 0062). Licencia automations-advanced (sin ella 403; en
 * solo lectura, solo consultas), solo administración, reglas apagadas al crearse, tarea por empresa (solo hechos tras
 * encender la regla, un disparo por entidad y paso, correo con el proveedor falso del kit, aviso en la campana), modo
 * «probar» sin efectos y aislamiento entre empresas.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startEssentialApp, data, errCode, isLicenseDenied, type Co, type EssentialApp } from "./essentialApp.testkit";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
const CAP = "automations-advanced";

describe.skipIf(!URL_)("Automatizaciones avanzadas · licencia, tarea por empresa, prueba y aislamiento (aplicación real, dos empresas)", () => {
  let ess: EssentialApp;
  let adA: string;
  let agA: string;
  let adB: string;
  let order = 0;

  const m = (proc: string, input: unknown, cookie = adA, co: Co = "a") => ess.m(co, `automations.${proc}`, input, cookie);
  const q = (proc: string, input?: unknown, cookie = adA, co: Co = "a") => ess.q(co, `automations.${proc}`, input, cookie);
  const ok = async (p: Promise<{ status: number; json: any; text: string }>) => {
    const r = await p;
    if (r.status !== 200) throw new Error(`${r.status}: ${r.text.slice(0, 400)}`);
    return data(r);
  };
  const runJob = async (co: Co = "a") => {
    const { runAutomationsPass } = await import("./automations/job");
    const { runWithTenant } = await import("./_core/tenant");
    const { withTenantDb } = await import("./_core/dbRegistry");
    return runWithTenant(ess.ids[co], () => withTenantDb(ess.ids[co], () => runAutomationsPass()));
  };
  /** Reserva pagada (confirmada) en la empresa `co`, pagada ahora. */
  async function paidReservation(co: Co, o: { people: number; email: string; name: string }): Promise<number> {
    const now = Date.now();
    const mo = `AUT${String(++order).padStart(7, "0")}`;
    await ess.sql(co, "INSERT INTO reservations (product_id, product_name, booking_date, people, amount_total, amount_paid, status, status_reservation, status_payment, customer_name, customer_email, merchant_order, reservation_number, created_at, updated_at, paid_at) VALUES (1, 'Kayak QA', '2026-12-01', ?, 12000, 12000, 'paid', 'CONFIRMADA', 'PAGADO', ?, ?, ?, ?, ?, ?, ?)",
      [o.people, o.name, o.email, mo, `RES-QA-${order}`, now, now, now]);
    return (await ess.sql(co, "SELECT id FROM reservations WHERE merchant_order = ?", [mo]))[0].id;
  }
  const runs = (co: Co = "a") => ess.sql(co, "SELECT rule_id, entity_type, entity_id, step_index, action, status, reason, attempts FROM automation_runs ORDER BY id");

  const emailRule = {
    name: "Gracias por tu reserva",
    trigger: "reservation_paid",
    conditions: [],
    dailyCap: 10,
    steps: [{ delayMinutes: 0, action: { kind: "email", purpose: "operational", subject: "Gracias, {{nombre}}", body: "Tu reserva {{referencia}} de {{producto}} está confirmada." } }],
  };

  beforeAll(async () => {
    ess = await startEssentialApp(URL_!, "automat");
    await ess.markPaid("a");
    await ess.markPaid("b");
    adA = await ess.login("a", "admin");
    agA = await ess.login("a", "agente");
    adB = await ess.login("b", "admin");
  }, 300_000);
  afterAll(async () => {
    await ess?.close();
  }, 60_000);

  it("sin la capacidad automations-advanced no responde (403 de licencia) y la tarea no hace nada", async () => {
    expect(isLicenseDenied(await q("overview"), CAP)).toBe(true);
    expect(isLicenseDenied(await m("create", emailRule), CAP)).toBe(true);
    expect(await runJob()).toMatchObject({ skippedAll: "sin_licencia" });
    await ess.setCapability("a", CAP, "active");
    await ess.setCapability("b", CAP, "active");
  }, 60_000);

  it("solo administración; las reglas (también desde plantilla) nacen apagadas y no actúan", async () => {
    expect((await q("overview", undefined, agA)).status).toBe(403);
    expect((await m("create", emailRule, agA)).status).toBe(403);
    const ov = await ok(q("overview"));
    expect(ov.rules).toEqual([]);
    expect(ov.templates.map((t: any) => t.key)).toEqual(expect.arrayContaining(["recordatorio-reserva", "seguimiento-presupuesto", "reserva-grupo"]));
    // Sin recordatorios del Core activos en la empresa nueva, ninguna plantilla avisa de duplicados
    expect(ov.templates.map((t: any) => t.warning)).toEqual(ov.templates.map(() => null));
    const group = await ok(m("createFromTemplate", { key: "reserva-grupo" }));
    const mail = await ok(m("create", emailRule));
    expect([group.enabled, mail.enabled]).toEqual([false, false]);
    expect(errCode(await m("create", { ...emailRule, conditions: [{ field: "people", op: "gte", value: "muchas" }] }))).toBe("BAD_REQUEST");
    await paidReservation("a", { people: 12, email: "ana@clientes.example", name: "Ana QA" });
    expect(await runJob()).toMatchObject({ skippedAll: "sin_reglas_activas" });
    expect(await runs()).toEqual([]);
  }, 60_000);

  it("encendidas: solo lo posterior; correo, aviso y condiciones; un disparo por entidad y paso", async () => {
    const ov = await ok(q("overview"));
    const [group, mail] = ov.rules;
    await ok(m("setEnabled", { id: group.id, enabled: true }));
    await ok(m("setEnabled", { id: mail.id, enabled: true }));
    // La reserva de antes de encender no dispara nada
    await new Promise((r) => setTimeout(r, 20));
    const big = await paidReservation("a", { people: 14, email: "luis@clientes.example", name: "Luis QA" });
    const small = await paidReservation("a", { people: 2, email: "", name: "Sin Correo QA" });
    const before = ess.mails.length;
    const r = await runJob();
    expect(r).toMatchObject({ done: 2, skipped: 1, failed: 0 });
    const mails = ess.mails.slice(before);
    expect(mails.map((x) => x.to[0].email)).toEqual(["luis@clientes.example"]);
    expect(mails[0].subject).toBe("Gracias, Luis QA");
    expect(mails[0].htmlContent).toContain("Kayak QA");
    expect(await runs()).toEqual(expect.arrayContaining([
      expect.objectContaining({ rule_id: group.id, entity_id: big, action: "notify", status: "done", attempts: 1 }),
      expect.objectContaining({ rule_id: mail.id, entity_id: big, action: "email", status: "done", attempts: 1 }),
      expect.objectContaining({ rule_id: mail.id, entity_id: small, action: "email", status: "skipped", reason: "sin_correo" }),
    ]));
    // Segunda pasada: nada nuevo
    expect(await runJob()).toMatchObject({ done: 0, skipped: 0, failed: 0 });
    expect(ess.mails.length).toBe(before + 1);
    // La clave única impide un segundo disparo aunque otra réplica lo intente
    await expect(ess.sql("a", "INSERT INTO automation_runs (rule_id, entity_type, entity_id, step_key, step_index, action, status, run_day) VALUES (?, 'reservation', ?, ?, 0, 'email', 'running', '2026-11-09')", [mail.id, big, mail.steps[0].key])).rejects.toThrow(/Duplicate/);
    // Historial y aviso en la campana del panel (solo la empresa A)
    const hist = await ok(q("history", { ruleId: mail.id }));
    expect(hist.map((h: any) => h.status).sort()).toEqual(["done", "skipped"]);
    expect(hist.find((h: any) => h.status === "done").detail).toMatch(/^Correo «Gracias, Luis QA» a lui…@clientes\.example$/);
    const notices = await ok(q("notices"));
    expect(notices.map((n: any) => n.title)).toEqual(["Reserva de grupo: Luis QA (Kayak QA)"]);
    const feed = data(await ess.q("a", "notifications.feed", undefined, agA));
    expect(feed.sections.find((s: any) => s.kind === "automation").items.map((i: any) => i.title)).toEqual(["Reserva de grupo: Luis QA (Kayak QA)"]);
    const feedB = data(await ess.q("b", "notifications.feed", undefined, adB));
    expect(feedB.sections.find((s: any) => s.kind === "automation").total).toBe(0);
  }, 60_000);

  it("modo «probar»: dice qué haría sin enviar ni registrar nada", async () => {
    const before = ess.mails.length;
    const runsBefore = (await runs()).length;
    const sim = await ok(m("simulate", { rule: emailRule }));
    expect(sim.matched).toBeGreaterThanOrEqual(3);
    expect(sim.items.filter((i: any) => i.outcome === "ejecutaria").length).toBeGreaterThanOrEqual(2);
    expect(sim.items.some((i: any) => i.reason === "sin_correo")).toBe(true);
    expect(ess.mails.length).toBe(before);
    expect((await runs()).length).toBe(runsBefore);
  }, 60_000);

  it("aislamiento: la otra empresa no ve ni ejecuta las reglas de la primera", async () => {
    expect((await ok(q("overview", undefined, adB, "b"))).rules).toEqual([]);
    const [{ id }] = await ess.sql("a", "SELECT MIN(id) AS id FROM automation_rules");
    expect(errCode(await q("rule", { id }, adB, "b"))).toBe("NOT_FOUND");
    expect(errCode(await m("setEnabled", { id, enabled: false }, adB, "b"))).toBe("NOT_FOUND");
    await paidReservation("b", { people: 20, email: "bea@clientes.example", name: "Bea QA" });
    const before = ess.mails.length;
    expect(await runJob("b")).toMatchObject({ skippedAll: "sin_reglas_activas" });
    expect(await runs("b")).toEqual([]);
    expect(ess.mails.length).toBe(before);
    // La reserva de B tampoco la ve la tarea de A
    expect(await runJob("a")).toMatchObject({ done: 0 });
  }, 60_000);

  it("en solo lectura: consultas sí, cambios no, y la tarea no actúa", async () => {
    await ess.setCapability("a", CAP, "read_only");
    expect((await ok(q("overview"))).rules.length).toBe(2);
    expect(isLicenseDenied(await m("create", emailRule), CAP)).toBe(true);
    expect(isLicenseDenied(await m("simulate", { rule: emailRule }), CAP)).toBe(true);
    await paidReservation("a", { people: 3, email: "carla@clientes.example", name: "Carla QA" });
    expect(await runJob()).toMatchObject({ skippedAll: "sin_licencia" });
    await ess.setCapability("a", CAP, "active");
    expect(await runJob()).toMatchObject({ done: 1 });
  }, 60_000);

  it("correo comercial: solo con el consentimiento concedido y sin retirada, como marketing y con el enlace de baja de Campaigns", async () => {
    const commercial = { ...emailRule, name: "Seguimiento comercial", steps: [{ delayMinutes: 0, action: { kind: "email", purpose: "commercial", subject: "Novedades para {{nombre}}", body: "Tenemos novedades." } }] };
    const rule = await ok(m("create", commercial));
    // Sin Elephant Campaigns no hay enlace de baja: la regla no se enciende
    expect(errCode(await m("setEnabled", { id: rule.id, enabled: true }))).toBe("BAD_REQUEST");
    await ess.setCapability("a", "email-campaigns", "active");
    // Apaga las anteriores para mirar solo esta
    for (const r of (await ok(q("overview"))).rules) if (r.id !== rule.id) await ok(m("setEnabled", { id: r.id, enabled: false }));
    await ok(m("setEnabled", { id: rule.id, enabled: true }));
    await ess.sql("a", "INSERT INTO clients (name, email, source) VALUES ('Con Consentimiento QA', 'si@clientes.example', 'manual'), ('Retirado QA', 'no@clientes.example', 'manual')");
    const ids = await ess.sql("a", "SELECT id, email FROM clients WHERE email IN ('si@clientes.example', 'no@clientes.example')");
    const idOf = (e: string) => ids.find((r: any) => r.email === e).id;
    await ess.sql("a", "INSERT INTO customer_marketing_consents (client_id, status, source, granted_at, withdrawn_at, updated_by) VALUES (?, 'granted', 'prueba', NOW(3), NULL, 'prueba'), (?, 'withdrawn', 'prueba', NOW(3), NOW(3), 'prueba')", [idOf("si@clientes.example"), idOf("no@clientes.example")]);
    await new Promise((r) => setTimeout(r, 20));
    await paidReservation("a", { people: 2, email: "si@clientes.example", name: "Con Consentimiento QA" });
    await paidReservation("a", { people: 2, email: "no@clientes.example", name: "Retirado QA" });
    await paidReservation("a", { people: 2, email: "nunca@clientes.example", name: "Sin Ficha QA" });
    const before = ess.mails.length;
    expect(await runJob()).toMatchObject({ done: 1, skipped: 2 });
    const mails = ess.mails.slice(before);
    expect(mails.map((x) => x.to[0].email)).toEqual(["si@clientes.example"]);
    expect(mails[0].htmlContent).toContain(`/baja/${idOf("si@clientes.example")}.`);
    const reasons = (await ok(q("history", { ruleId: rule.id }))).map((h: any) => h.reason ?? h.status).sort();
    expect(reasons).toEqual(["done", "sin_consentimiento", "sin_consentimiento"]);
  }, 60_000);
});
