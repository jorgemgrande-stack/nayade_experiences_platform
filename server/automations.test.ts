/**
 * Automatizaciones avanzadas · pruebas puras (sin BD ni red): condiciones, validación, secuencias con retardo,
 * idempotencia, topes, reintentos, consentimiento, apagado por defecto y modo «probar».
 */
import { describe, expect, it } from "vitest";
import { AUTOMATION_LIMITS, AUTOMATION_TRIGGERS, RULE_TEMPLATES, validateRule, type AutomationRuleInput, type FieldDef } from "../shared/automations";
import { evaluateCondition, madridDay, madridWallToUtc, matchesConditions, planEntity, renderText, type AutomationEntity, type RunRow } from "./automations/engine";
import type { ActionDeps, MailParams } from "./automations/actions";
import { AutomationService } from "./automations/service";
import { MemoryAutomationSources } from "./automations/sources";
import { MemoryAutomationStore } from "./automations/store";

const H = 3_600_000;
const D = 24 * H;
const T0 = Date.UTC(2026, 10, 9, 9, 0); // 09/11/2026 10:00 en Madrid

const num: FieldDef = { key: "n", label: "N", type: "number" };
const txt: FieldDef = { key: "t", label: "T", type: "text" };
const cho: FieldDef = { key: "c", label: "C", type: "choice", options: [{ value: "si", label: "Sí" }, { value: "no", label: "No" }] };

function entity(o: Partial<AutomationEntity> & { id: number; anchorAt: number }): AutomationEntity {
  return { type: "reservation", email: `cliente${o.id}@clientes.example`, name: `Cliente ${o.id}`, leadId: null, ownerId: null, fields: { people: 2, product: "Kayak", amount: 50, channel: "ONLINE_DIRECTO" }, vars: { nombre: `Cliente ${o.id}`, referencia: `RES-${o.id}`, empresa: "Náyade QA" }, ctaPath: "/admin/crm?tab=reservations", ...o };
}

function fakeDeps(o: { consent?: string[]; paused?: string[]; sendOk?: () => boolean; mailBlock?: string | null } = {}) {
  const sent: MailParams[] = [];
  const tasks: Array<{ title: string; assignedTo: number | null }> = [];
  const store = new MemoryAutomationStore();
  const deps: ActionDeps = {
    mailBlock: async () => o.mailBlock ?? null,
    trialBlocks: async () => false,
    paused: async (e) => (o.paused ?? []).includes(e),
    marketingConsent: async (e) => (o.consent ?? []).includes(e),
    renderEmail: (subject, body) => ({ html: `<p>${body}</p>`, text: body }),
    sendEmail: async (p) => {
      if (o.sendOk && !o.sendOk()) return false;
      sent.push(p);
      return true;
    },
    validAssignee: async (id) => id === 7,
    createTask: async (t) => (tasks.push({ title: t.title, assignedTo: t.assignedTo }), tasks.length),
    funnelLicensed: async () => true,
    stageExists: async (id) => id === 3,
    moveStage: async () => undefined,
    tagExists: async (id) => id === 4,
    assignTag: async () => undefined,
    addNotice: (n) => store.addNotice(n),
    dayPlus: (d) => madridDay(T0 + d * D),
  };
  return { deps, sent, tasks, store };
}

function setup(rule: AutomationRuleInput, ents: AutomationEntity[], o: Parameters<typeof fakeDeps>[0] & { licensed?: boolean } = {}) {
  const f = fakeDeps(o);
  let now = T0;
  const sources = new MemoryAutomationSources({ [rule.trigger]: ents });
  const svc = new AutomationService({ store: f.store, sources, actions: f.deps, licensed: async () => o.licensed ?? true, now: () => now });
  return { ...f, sources, svc, at: (t: number) => (now = t), get now() { return now; } };
}

const emailRule = (o: Partial<AutomationRuleInput> = {}): AutomationRuleInput => ({
  name: "Bienvenida",
  trigger: "reservation_paid",
  conditions: [],
  dailyCap: 50,
  steps: [{ delayMinutes: 0, action: { kind: "email", purpose: "operational", subject: "Hola {{nombre}}", body: "Tu reserva {{referencia}}" } }],
  ...o,
});

describe("condiciones", () => {
  it("números, textos (sin mayúsculas), opciones y vacíos", () => {
    expect(evaluateCondition(num, 10, { field: "n", op: "gte", value: "10" })).toBe(true);
    expect(evaluateCondition(num, "9,5", { field: "n", op: "gt", value: "9" })).toBe(true);
    expect(evaluateCondition(num, null, { field: "n", op: "gt", value: "1" })).toBe(false);
    expect(evaluateCondition(num, 3, { field: "n", op: "lt", value: "abc" })).toBe(false);
    expect(evaluateCondition(txt, "Kayak doble", { field: "t", op: "contains", value: "KAYAK" })).toBe(true);
    expect(evaluateCondition(txt, "Web", { field: "t", op: "eq", value: " web " })).toBe(true);
    expect(evaluateCondition(txt, "", { field: "t", op: "empty", value: "" })).toBe(true);
    expect(evaluateCondition(txt, "x", { field: "t", op: "not_empty", value: "" })).toBe(true);
    expect(evaluateCondition(cho, "si", { field: "c", op: "neq", value: "no" })).toBe(true);
    expect(evaluateCondition(cho, "si", { field: "c", op: "contains", value: "s" })).toBe(false);
  });
  it("todas deben cumplirse; un campo desconocido no se cumple", () => {
    const e = { fields: { people: 12, product: "Paddle" } };
    expect(matchesConditions("reservation_paid", [], e)).toBe(true);
    expect(matchesConditions("reservation_paid", [{ field: "people", op: "gte", value: "10" }, { field: "product", op: "contains", value: "paddle" }], e)).toBe(true);
    expect(matchesConditions("reservation_paid", [{ field: "people", op: "gte", value: "10" }, { field: "product", op: "eq", value: "Kayak" }], e)).toBe(false);
    expect(matchesConditions("reservation_paid", [{ field: "inventado", op: "eq", value: "x" }], e)).toBe(false);
  });
});

describe("validación de reglas y plantillas", () => {
  it("rechaza campos, valores y acciones que no encajan con el disparador", () => {
    const bad = validateRule(emailRule({ conditions: [{ field: "people", op: "gte", value: "muchas" }, { field: "nada", op: "eq", value: "1" }], steps: [{ delayMinutes: 0, action: { kind: "lead_tag", tagId: 1 } }] }));
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors.join(" ")).toMatch(/número.*no existe.*solo está disponible/s);
    expect(validateRule(emailRule({ conditions: [{ field: "channel", op: "contains", value: "x" }] })).ok).toBe(false);
  });
  it("ordena los pasos por su momento (después: de menos a más; antes de la reserva: de más a menos)", () => {
    const steps = [600, 0, 60].map((d) => ({ delayMinutes: d, action: { kind: "notify" as const, title: "x", body: "" } }));
    const a = validateRule(emailRule({ steps }));
    const b = validateRule(emailRule({ trigger: "reservation_upcoming", steps }));
    expect(a.ok && a.rule.steps.map((s) => s.delayMinutes)).toEqual([0, 60, 600]);
    expect(b.ok && b.rule.steps.map((s) => s.delayMinutes)).toEqual([600, 60, 0]);
  });
  it("las plantillas son válidas y usan disparadores reales", () => {
    expect(RULE_TEMPLATES.length).toBeGreaterThanOrEqual(5);
    for (const t of RULE_TEMPLATES) {
      expect(validateRule(t.rule).ok, t.key).toBe(true);
      expect(AUTOMATION_TRIGGERS[t.rule.trigger], t.key).toBeTruthy();
    }
    // El seguimiento de presupuestos es comercial: exige consentimiento
    const q = RULE_TEMPLATES.find((t) => t.key === "seguimiento-presupuesto")!;
    expect(q.rule.steps.some((s) => s.action.kind === "email" && s.action.purpose === "commercial")).toBe(true);
  });
  it("textos con variables (desconocidas en blanco, asunto en una línea)", () => {
    expect(renderText("Hola {{nombre}}, {{nada}}fin", { nombre: "Ana" })).toBe("Hola Ana, fin");
    expect(renderText("A\n{{ referencia }}", { referencia: "R-1" }, true)).toBe("A R-1");
  });
  it("hora de Madrid a UTC (invierno y verano)", () => {
    expect(madridWallToUtc("2026-11-09", "10:00")).toBe(Date.UTC(2026, 10, 9, 9, 0));
    expect(madridWallToUtc("2026-07-01", "10:00")).toBe(Date.UTC(2026, 6, 1, 8, 0));
    expect(madridDay(Date.UTC(2026, 10, 9, 23, 30))).toBe("2026-11-10");
  });
});

describe("secuencias con retardo (planEntity)", () => {
  const rule = { trigger: "quote_unanswered" as const, steps: [{ delayMinutes: 3 * 1440, action: { kind: "notify" as const, title: "a", body: "" } }, { delayMinutes: 7 * 1440, action: { kind: "notify" as const, title: "b", body: "" } }] };
  const run = (stepIndex: number, status: RunRow["status"], attempts = 1, lastAttemptAt = T0): RunRow => ({ ruleId: 1, entityType: "quote", entityId: 1, stepIndex, action: "notify", status, reason: null, attempts, lastAttemptAt });
  it("espera, ejecuta el primer paso, espera el segundo y termina", () => {
    expect(planEntity(rule, T0, [], T0 + D, T0)).toEqual({ kind: "wait", until: T0 + 3 * D, late: [] });
    expect(planEntity(rule, T0, [], T0 + 3 * D, T0)).toMatchObject({ kind: "run", step: 0, retry: false });
    expect(planEntity(rule, T0, [run(0, "done")], T0 + 4 * D, T0)).toMatchObject({ kind: "wait", until: T0 + 7 * D });
    expect(planEntity(rule, T0, [run(0, "done")], T0 + 7 * D, T0)).toMatchObject({ kind: "run", step: 1 });
    expect(planEntity(rule, T0, [run(0, "done"), run(1, "skipped")], T0 + 9 * D, T0)).toEqual({ kind: "finished", late: [] });
  });
  it("un paso pasado de plazo queda omitido y la secuencia sigue", () => {
    expect(planEntity(rule, T0, [], T0 + 7 * D, T0)).toMatchObject({ kind: "run", step: 1, late: [0] });
  });
  it("reintentos: espera creciente, como mucho 3 intentos; abandonado «en curso» se recupera", () => {
    expect(planEntity(rule, T0, [run(0, "failed", 1, T0 + 3 * D)], T0 + 3 * D + 10 * 60_000, T0)).toMatchObject({ kind: "wait" });
    expect(planEntity(rule, T0, [run(0, "failed", 1, T0 + 3 * D)], T0 + 3 * D + 15 * 60_000, T0)).toMatchObject({ kind: "run", step: 0, retry: true });
    expect(planEntity(rule, T0, [run(0, "failed", AUTOMATION_LIMITS.maxAttempts)], T0 + 4 * D, T0)).toMatchObject({ kind: "wait", until: T0 + 7 * D });
    expect(planEntity(rule, T0, [run(0, "running", 1, T0 + 3 * D)], T0 + 3 * D + 20 * 60_000, T0)).toMatchObject({ kind: "run", step: 0, retry: true, exhausted: false });
    expect(planEntity(rule, T0, [run(0, "running", 3, T0 + 3 * D)], T0 + 3 * D + 20 * 60_000, T0)).toMatchObject({ kind: "run", exhausted: true });
  });
  it("antes de la reserva: un paso cuyo momento es anterior a la activación no aplica", () => {
    const before = { trigger: "reservation_upcoming" as const, steps: [{ delayMinutes: 1440, action: { kind: "notify" as const, title: "a", body: "" } }, { delayMinutes: 60, action: { kind: "notify" as const, title: "b", body: "" } }] };
    const start = T0 + 2 * H; // reserva dentro de 2 h; regla activada ahora
    expect(planEntity(before, start, [], T0, T0)).toEqual({ kind: "wait", until: start - H, late: [] });
    expect(planEntity(before, start, [], start - H, T0)).toMatchObject({ kind: "run", step: 1 });
  });
});

describe("tarea programada (runPass)", () => {
  it("sin licencia o sin reglas encendidas no hace nada; las reglas nacen apagadas", async () => {
    const s = setup(emailRule(), [entity({ id: 1, anchorAt: T0 + H })], { licensed: false });
    expect(await s.svc.runPass()).toMatchObject({ skippedAll: "sin_licencia" });
    const s2 = setup(emailRule(), [entity({ id: 1, anchorAt: T0 + H })]);
    const r = await s2.svc.create(emailRule(), 1);
    expect(r.enabled).toBe(false);
    s2.at(T0 + 2 * H);
    expect(await s2.svc.runPass()).toMatchObject({ skippedAll: "sin_reglas_activas" });
    expect(s2.sent).toHaveLength(0);
  });

  it("solo lo ocurrido tras encenderla; un disparo por entidad y paso (idempotente entre pasadas)", async () => {
    const s = setup(emailRule(), [entity({ id: 1, anchorAt: T0 - H }), entity({ id: 2, anchorAt: T0 + H }), entity({ id: 3, anchorAt: T0 + 2 * H })]);
    const r = await s.svc.create(emailRule(), 1);
    await s.svc.setEnabled(r.id, true, 1);
    s.at(T0 + 3 * H);
    expect(await s.svc.runPass()).toMatchObject({ done: 2, failed: 0 });
    expect(s.sent.map((m) => m.to)).toEqual(["cliente2@clientes.example", "cliente3@clientes.example"]);
    expect(s.sent[0]).toMatchObject({ subject: "Hola Cliente 2", idempotencyKey: `auto:${r.id}:reservation:2:0` });
    s.at(T0 + 4 * H);
    expect(await s.svc.runPass()).toMatchObject({ done: 0 });
    expect(s.sent).toHaveLength(2);
    // Una segunda réplica que reclama el mismo paso no lo consigue
    expect(await s.store.claim({ ruleId: r.id, entityType: "reservation", entityId: 2, stepIndex: 0 }, "email", s.now, madridDay(s.now))).toBe(false);
    // Apagar y volver a encender no repite lo hecho (y cuenta desde el nuevo encendido)
    await s.svc.setEnabled(r.id, false, 1);
    await s.svc.setEnabled(r.id, true, 1);
    expect(await s.svc.runPass()).toMatchObject({ done: 0 });
    // Editar la regla encendida (otro orden de pasos) no repite disparos sobre lo anterior
    const edited = await s.svc.update(r.id, emailRule({ steps: [{ delayMinutes: 0, action: { kind: "notify", title: "n", body: "" } }, ...emailRule().steps] }), 1);
    expect(edited.enabledAt).toBe(s.now);
    expect(await s.svc.runPass()).toMatchObject({ done: 0 });
    expect(s.sent).toHaveLength(2);
  });

  it("con más de 5000 candidatas antiguas, los hechos nuevos siguen entrando (ventana desde el último paso posible)", async () => {
    const old = Array.from({ length: 6000 }, (_, i) => entity({ id: i + 1, anchorAt: T0 + 1000 + i * 1000 }));
    const fresh = entity({ id: 99_999, anchorAt: T0 + 10 * D - H });
    const s = setup(emailRule(), [...old, fresh]);
    const r = await s.svc.create(emailRule(), 1);
    await s.svc.setEnabled(r.id, true, 1);
    s.at(T0 + 10 * D);
    expect(s.svc.scanSince({ steps: r.steps, enabledAt: T0 }, s.now)).toBe(s.now - AUTOMATION_LIMITS.catchUpMinutes * 60_000);
    expect(await s.svc.runPass()).toMatchObject({ done: 1 });
    expect(s.sent.map((m) => m.to)).toEqual(["cliente99999@clientes.example"]);
  });

  it("topes por día de la regla: lo que no cabe espera al día siguiente", async () => {
    const ents = [1, 2, 3, 4, 5].map((i) => entity({ id: i, anchorAt: T0 + i * 60_000 }));
    const s = setup(emailRule({ dailyCap: 2 }), ents);
    const r = await s.svc.create(emailRule({ dailyCap: 2 }), 1);
    await s.svc.setEnabled(r.id, true, 1);
    s.at(T0 + H);
    expect(await s.svc.runPass()).toMatchObject({ done: 2, deferred: 3 });
    expect(await s.svc.runPass()).toMatchObject({ done: 0, deferred: 3 });
    s.at(T0 + D);
    expect(await s.svc.runPass()).toMatchObject({ done: 2, deferred: 1 });
    expect(s.sent).toHaveLength(4);
  });

  it("reintentos acotados: un envío fallido se reintenta con espera y se da por fallido al tercer intento", async () => {
    const s = setup(emailRule(), [entity({ id: 1, anchorAt: T0 + 60_000 })], { sendOk: () => false });
    const r = await s.svc.create(emailRule(), 1);
    await s.svc.setEnabled(r.id, true, 1);
    s.at(T0 + H);
    expect(await s.svc.runPass()).toMatchObject({ failed: 1 });
    expect(await s.svc.runPass()).toMatchObject({ failed: 0, done: 0 }); // aún en espera
    s.at(T0 + H + 15 * 60_000);
    expect(await s.svc.runPass()).toMatchObject({ failed: 1 });
    s.at(T0 + 2 * H);
    expect(await s.svc.runPass()).toMatchObject({ failed: 1 });
    s.at(T0 + 5 * H);
    expect(await s.svc.runPass()).toMatchObject({ failed: 0, done: 0 });
    expect((await s.svc.history())[0]).toMatchObject({ status: "failed", reason: "envio_fallido", attempts: 3 });
  });

  it("consentimiento: el correo comercial solo a quien lo concedió; nunca a quien tiene las automáticas en pausa", async () => {
    const rule = emailRule({ steps: [{ delayMinutes: 0, action: { kind: "email", purpose: "commercial", subject: "Oferta", body: "x" } }] });
    const ents = [1, 2, 3].map((i) => entity({ id: i, anchorAt: T0 + i * 60_000 }));
    const s = setup(rule, ents, { consent: ["cliente1@clientes.example", "cliente2@clientes.example"], paused: ["cliente2@clientes.example"] });
    const r = await s.svc.create(rule, 1);
    await s.svc.setEnabled(r.id, true, 1);
    s.at(T0 + H);
    expect(await s.svc.runPass()).toMatchObject({ done: 1, skipped: 2 });
    expect(s.sent.map((m) => m.to)).toEqual(["cliente1@clientes.example"]);
    const reasons = (await s.svc.history()).map((h) => [h.entityId, h.reason]);
    expect(reasons).toEqual(expect.arrayContaining([[2, "cliente_en_pausa"], [3, "sin_consentimiento"]]));
    // El operativo no necesita consentimiento, pero sí respeta la pausa
    const s2 = setup(emailRule(), ents, { paused: ["cliente2@clientes.example"] });
    const r2 = await s2.svc.create(emailRule(), 1);
    await s2.svc.setEnabled(r2.id, true, 1);
    s2.at(T0 + H);
    expect(await s2.svc.runPass()).toMatchObject({ done: 2, skipped: 1 });
  });

  it("condiciones, tarea con el responsable de la oportunidad y aviso al equipo (uno por ejecución)", async () => {
    const rule: AutomationRuleInput = {
      name: "Grupo", trigger: "lead_created", dailyCap: 10,
      conditions: [{ field: "people", op: "gte", value: "10" }],
      steps: [{ delayMinutes: 0, action: { kind: "notify", title: "Grupo de {{nombre}}", body: "" } }, { delayMinutes: 60, action: { kind: "task", title: "Llamar a {{nombre}}", dueInDays: 1, priority: "alta", assignedTo: null } }],
    };
    const lead = (id: number, people: number): AutomationEntity => ({ ...entity({ id, anchorAt: T0 + 60_000 }), type: "lead", leadId: id, ownerId: 7, fields: { people } });
    const s = setup(rule, [lead(1, 12), lead(2, 3)]);
    const r = await s.svc.create(rule, 1);
    await s.svc.setEnabled(r.id, true, 1);
    s.at(T0 + 10 * 60_000);
    expect(await s.svc.runPass()).toMatchObject({ done: 1 });
    expect((await s.svc.notices()).map((n) => n.title)).toEqual(["Grupo de Cliente 1"]);
    expect(await s.svc.runPass()).toMatchObject({ done: 0 }); // el segundo paso espera su hora
    s.at(T0 + 2 * H);
    expect(await s.svc.runPass()).toMatchObject({ done: 1 });
    expect(s.tasks).toEqual([{ title: "Llamar a Cliente 1", assignedTo: 7 }]);
    expect(await s.svc.notices()).toHaveLength(1);
  });

  it("si la entidad deja de estar en el disparador (presupuesto aceptado), los pasos pendientes no se ejecutan", async () => {
    const rule: AutomationRuleInput = { name: "Seguimiento", trigger: "quote_unanswered", dailyCap: 10, conditions: [], steps: [{ delayMinutes: 1440, action: { kind: "notify", title: "a", body: "" } }, { delayMinutes: 3 * 1440, action: { kind: "notify", title: "b", body: "" } }] };
    const q: AutomationEntity = { ...entity({ id: 9, anchorAt: T0 + 60_000 }), type: "quote", leadId: 1 };
    const s = setup(rule, [q]);
    const r = await s.svc.create(rule, 1);
    await s.svc.setEnabled(r.id, true, 1);
    s.at(T0 + 2 * D);
    expect(await s.svc.runPass()).toMatchObject({ done: 1 });
    s.sources.byTrigger.quote_unanswered = []; // aceptado: ya no es «sin respuesta»
    s.at(T0 + 4 * D);
    expect(await s.svc.runPass()).toMatchObject({ done: 0 });
    expect(await s.svc.history()).toHaveLength(1);
  });

  it("referencias: no guarda una regla con un responsable, etapa o etiqueta inexistentes", async () => {
    const s = setup(emailRule(), []);
    const lead = (action: AutomationRuleInput["steps"][0]["action"]): AutomationRuleInput => ({ name: "x", trigger: "lead_created", conditions: [], dailyCap: 5, steps: [{ delayMinutes: 0, action }] });
    await expect(s.svc.create(lead({ kind: "task", title: "t", dueInDays: 1, priority: "media", assignedTo: 99 }), 1)).rejects.toThrow(/responsable/);
    await expect(s.svc.create(lead({ kind: "lead_stage", stageId: 99 }), 1)).rejects.toThrow(/etapa/);
    await expect(s.svc.create(lead({ kind: "lead_tag", tagId: 99 }), 1)).rejects.toThrow(/etiqueta/);
    expect((await s.svc.create(lead({ kind: "lead_tag", tagId: 4 }), 1)).steps[0].action).toEqual({ kind: "lead_tag", tagId: 4 });
  });
});

describe("modo «probar» (simulate)", () => {
  it("dice qué haría sin enviar, crear ni registrar nada, con las mismas comprobaciones", async () => {
    const rule = emailRule({ steps: [{ delayMinutes: 0, action: { kind: "email", purpose: "commercial", subject: "Oferta", body: "x" } }, { delayMinutes: 30 * 1440, action: { kind: "notify", title: "n", body: "" } }] });
    const ents = [entity({ id: 1, anchorAt: T0 - 2 * D }), entity({ id: 2, anchorAt: T0 - D }), entity({ id: 3, anchorAt: T0 - 30 * D })];
    const s = setup(rule, ents, { consent: ["cliente1@clientes.example"] });
    const sim = await s.svc.simulate(rule);
    expect(sim.matched).toBe(2); // la de hace 30 días queda fuera de la ventana de 7
    expect(sim.items.map((i) => [i.entityId, i.outcome, i.reason])).toEqual([[1, "ejecutaria", null], [2, "omitiria", "sin_consentimiento"]]);
    expect(sim.items[0].detail).toMatch(/^Se haría: correo «Oferta» a cli…@clientes\.example$/);
    expect(s.sent).toHaveLength(0);
    expect(s.store.runs).toHaveLength(0);
    expect(s.store.noticeRows).toHaveLength(0);
    // Con una regla guardada tiene en cuenta lo ya hecho: el siguiente paso aún espera
    const r = await s.svc.create(rule, 1);
    await s.store.claim({ ruleId: r.id, entityType: "reservation", entityId: 1, stepIndex: 0 }, "email", T0, madridDay(T0));
    await s.store.settle({ ruleId: r.id, entityType: "reservation", entityId: 1, stepIndex: 0 }, "done", null, null, T0);
    const again = await s.svc.simulate(rule, r.id);
    expect(again.items.find((i) => i.entityId === 1)).toMatchObject({ outcome: "esperando", step: 1 });
  });
  it("sin correo en la empresa, el paso de correo se omitiría (y en la tarea queda fallido para reintentar)", async () => {
    const s = setup(emailRule(), [entity({ id: 1, anchorAt: T0 - H })], { mailBlock: "sin_remitente" });
    expect((await s.svc.simulate(emailRule())).items[0]).toMatchObject({ outcome: "omitiria", reason: "correo_no_disponible" });
  });
});
