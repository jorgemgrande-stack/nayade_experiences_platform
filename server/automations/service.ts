/**
 * Automatizaciones avanzadas · servicio: reglas de la empresa (crear, editar, encender, archivar, desde plantilla), la
 * pasada de la tarea programada y la simulación («probar»).
 *
 * Pasada (una por empresa y cada 10 minutos, `connect-automations`): solo con la licencia `automations-advanced` en
 * escritura; solo reglas ENCENDIDAS (todas nacen apagadas) y solo hechos posteriores a su activación. Para cada entidad
 * candidata que cumple las condiciones, el paso que toca (engine.planEntity) se reserva en `automation_runs` (clave
 * única por regla, entidad y paso) antes de actuar y se cierra con su resultado. Topes: de la regla y de la empresa por
 * día, y de acciones por pasada; lo que no cabe espera a la siguiente. Reintentos: hasta 3 intentos con espera creciente.
 */
import { AUTOMATION_LIMITS, AUTOMATION_TRIGGERS, RULE_TEMPLATES, validateRule, type AutomationRuleInput, type TriggerDef } from "../../shared/automations";
import { runAction, type ActionDeps, type ActionOutcome } from "./actions";
import { capAllows, madridDay, matchesConditions, planEntity, runKeyOf, stepDueAt, type AutomationEntity, type RunRow, type StoredRule } from "./engine";
import type { AutomationSources } from "./sources";
import type { AutomationStore } from "./store";

export class AutomationError extends Error {
  constructor(public readonly code: "invalid_input" | "not_found", message: string) {
    super(message);
    this.name = "AutomationError";
  }
}

export interface RefChecks {
  validAssignee(userId: number): Promise<boolean>;
  funnelLicensed(): Promise<boolean>;
  stageExists(id: number): Promise<boolean>;
  tagExists(id: number): Promise<boolean>;
}

export interface AutomationServiceDeps {
  store: AutomationStore;
  sources: AutomationSources;
  actions: ActionDeps;
  /** ¿Licencia `automations-advanced` en escritura? (sin ella o en solo lectura, la tarea no hace nada) */
  licensed(): Promise<boolean>;
  now?: () => number;
}

export interface PassResult {
  rules: number;
  done: number;
  skipped: number;
  failed: number;
  /** Pasos que tocaban pero no cupieron en los topes: se ejecutan en una pasada siguiente. */
  deferred: number;
  skippedAll?: string;
}

export interface SimulationItem {
  entity: string;
  entityType: string;
  entityId: number;
  step: number | null;
  action: string | null;
  outcome: "ejecutaria" | "omitiria" | "esperando" | "terminada";
  reason: string | null;
  detail: string | null;
  at: number | null;
}

const SCAN = 500;
const MAX_PAGES = 10;
const DAY = 86_400_000;

export class AutomationService {
  constructor(private readonly d: AutomationServiceDeps) {}
  private now = () => (this.d.now ? this.d.now() : Date.now());

  // ─── Reglas ────────────────────────────────────────────────────────────────

  rules() {
    return this.d.store.listRules();
  }

  async rule(id: number): Promise<StoredRule> {
    const r = await this.d.store.getRule(id);
    if (!r || r.archived) throw new AutomationError("not_found", "La regla no existe.");
    return r;
  }

  /** Validación completa: forma, campos y referencias (responsable, etapa y etiqueta que existan). */
  async validate(input: AutomationRuleInput): Promise<AutomationRuleInput> {
    const v = validateRule(input);
    if (!v.ok) throw new AutomationError("invalid_input", v.errors.join(" "));
    const a = this.d.actions;
    for (const s of v.rule.steps) {
      const x = s.action;
      if (x.kind === "task" && !(await a.tasksLicensed())) throw new AutomationError("invalid_input", "Crear tareas necesita las tareas del CRM, que tu plan no incluye.");
      if (x.kind === "lead_tag" && !(await a.tagsLicensed())) throw new AutomationError("invalid_input", "Poner etiquetas necesita las etiquetas del CRM, que tu plan no incluye.");
      if (x.kind === "task" && x.assignedTo != null && !(await a.validAssignee(x.assignedTo))) throw new AutomationError("invalid_input", "El responsable de la tarea no es del equipo comercial.");
      if (x.kind === "lead_stage") {
        if (!(await a.funnelLicensed())) throw new AutomationError("invalid_input", "Mover de etapa necesita el embudo de ventas avanzado.");
        if (!(await a.stageExists(x.stageId))) throw new AutomationError("invalid_input", "La etapa elegida no existe.");
      }
      if (x.kind === "lead_tag" && !(await a.tagExists(x.tagId))) throw new AutomationError("invalid_input", "La etiqueta elegida no existe.");
    }
    return v.rule;
  }

  async create(input: AutomationRuleInput, userId: number | null, templateKey: string | null = null): Promise<StoredRule> {
    const id = await this.d.store.createRule(await this.validate(input), userId, templateKey);
    return this.rule(id);
  }

  /** Plantilla lista para activar: se crea APAGADA para revisarla antes. */
  createFromTemplate(key: string, userId: number | null) {
    const t = RULE_TEMPLATES.find((x) => x.key === key);
    if (!t) throw new AutomationError("not_found", "La plantilla no existe.");
    return this.create(structuredClone(t.rule), userId, t.key);
  }

  async update(id: number, input: AutomationRuleInput, userId: number | null) {
    await this.rule(id);
    // Una regla encendida que cambia empieza de nuevo: sus pasos nuevos no se aplican a lo ocurrido antes (ni repiten disparos)
    if (!(await this.d.store.updateRule(id, await this.validate(input), userId, this.now()))) throw new AutomationError("not_found", "La regla no existe.");
    return this.rule(id);
  }

  async setEnabled(id: number, enabled: boolean, userId: number | null) {
    const r = await this.rule(id);
    if (enabled) {
      await this.validate(r); // una referencia borrada desde que se guardó no se activa
      // El correo comercial solo sale con su enlace de baja (el de Elephant Campaigns): sin él, la regla no se enciende
      if (r.steps.some((s) => s.action.kind === "email" && s.action.purpose === "commercial") && !(await this.d.actions.commercialAvailable()))
        throw new AutomationError("invalid_input", "Esta regla envía un correo comercial y necesita el enlace de baja de Elephant Campaigns, que tu empresa no tiene. Cambia el correo a operativo o quita ese paso.");
    }
    await this.d.store.setEnabled(id, enabled, this.now(), userId);
    return this.rule(id);
  }

  async archive(id: number, userId: number | null) {
    await this.rule(id);
    await this.d.store.archive(id, userId);
    return { ok: true as const };
  }

  history(ruleId?: number, limit = 100) {
    return this.d.store.history({ ruleId, limit: Math.min(500, Math.max(1, limit)) });
  }

  async today() {
    const day = madridDay(this.now());
    return { day, used: await this.d.store.usedOn(day), cap: AUTOMATION_LIMITS.companyDailyMax };
  }

  notices(days = 7, limit = 50) {
    return this.d.store.notices(this.now() - days * DAY, limit);
  }

  // ─── Candidatas ────────────────────────────────────────────────────────────

  private horizonOf(rule: Pick<StoredRule, "trigger" | "steps">, now: number) {
    const max = Math.max(0, ...rule.steps.map((s) => s.delayMinutes));
    return now + (max + 60) * 60_000;
  }

  /**
   * Desde cuándo buscar candidatas en una pasada: lo posterior a encender la regla, pero nunca más atrás que el último
   * paso más el margen de recuperación. Lo anterior ya no puede ejecutar ningún paso (estaría fuera de plazo), así que
   * no ocupa la ventana de búsqueda: con mucho volumen, los hechos nuevos siempre entran.
   */
  scanSince(rule: Pick<StoredRule, "steps" | "enabledAt">, now: number): number {
    const maxDelay = Math.max(0, ...rule.steps.map((s) => s.delayMinutes));
    return Math.max(rule.enabledAt ?? now, now - (maxDelay + AUTOMATION_LIMITS.catchUpMinutes) * 60_000);
  }

  private async *pages(rule: Pick<StoredRule, "trigger" | "steps" | "conditions">, since: number, now: number): AsyncGenerator<AutomationEntity[]> {
    const horizon = this.horizonOf(rule, now);
    for (let p = 0; p < MAX_PAGES; p++) {
      const raw = await this.d.sources.candidates(rule.trigger, { since, now, horizon, limit: SCAN, offset: p * SCAN });
      yield raw.filter((e) => matchesConditions(rule.trigger, rule.conditions, e));
      if (raw.length < SCAN) return;
    }
  }

  // ─── Pasada de la tarea programada ─────────────────────────────────────────

  async runPass(): Promise<PassResult> {
    const out: PassResult = { rules: 0, done: 0, skipped: 0, failed: 0, deferred: 0 };
    try {
      if (!(await this.d.licensed())) return { ...out, skippedAll: "sin_licencia" };
    } catch {
      return { ...out, skippedAll: "licencia_no_verificable" };
    }
    const now = this.now();
    const day = madridDay(now);
    const rules = (await this.d.store.listRules()).filter((r) => r.enabled && !r.archived && r.enabledAt != null);
    if (!rules.length) return { ...out, skippedAll: "sin_reglas_activas" };
    let companyUsed = await this.d.store.usedOn(day);
    let budget = AUTOMATION_LIMITS.perRun;
    for (const rule of rules) {
      out.rules++;
      let ruleUsed = await this.d.store.usedOn(day, rule.id);
      let capped = false;
      const entityType = (AUTOMATION_TRIGGERS[rule.trigger] as TriggerDef).entity;
      for await (const list of this.pages(rule, this.scanSince(rule, now), now)) {
        const runs = await this.d.store.runsFor(rule.id, entityType, list.map((e) => e.id));
        for (const e of list) {
          const plan = planEntity(rule, e.anchorAt, runs.filter((r) => r.entityId === e.id), now, rule.enabledAt!);
          for (const i of plan.late) {
            await this.d.store.skip(runKeyOf(rule.id, e, rule.steps, i), rule.steps[i].action.kind, "fuera_de_plazo", now, day);
            out.skipped++;
          }
          if (plan.kind !== "run") continue;
          const key = runKeyOf(rule.id, e, rule.steps, plan.step);
          const action = rule.steps[plan.step].action;
          if (plan.exhausted) {
            await this.d.store.settle(key, "failed", "error", "El proceso se interrumpió y se agotaron los intentos", now);
            out.failed++;
            continue;
          }
          if (capped || budget <= 0 || !capAllows({ ruleUsed, ruleCap: rule.dailyCap, companyUsed, companyCap: AUTOMATION_LIMITS.companyDailyMax })) {
            capped = true;
            out.deferred++;
            continue;
          }
          if (!(await this.d.store.claim(key, action.kind, now, day))) continue;
          budget--;
          let r: ActionOutcome;
          try {
            r = await runAction(action, { rule, entity: e, key, dry: false }, this.d.actions);
          } catch (err) {
            r = { status: "failed", reason: "error", detail: err instanceof Error ? err.message.slice(0, 200) : null };
          }
          await this.d.store.settle(key, r.status, r.reason, r.detail, now);
          if (r.status === "done") {
            ruleUsed++;
            companyUsed++;
            out.done++;
          } else if (r.status === "skipped") out.skipped++;
          else out.failed++;
        }
      }
    }
    return out;
  }

  // ─── Simulación («probar»): mismas reglas, sin enviar, crear ni registrar nada ─

  /**
   * Qué haría la regla AHORA si hubiera estado activa los últimos días: entidades candidatas que cumplen las condiciones,
   * el paso que les tocaría y el resultado de sus comprobaciones (consentimiento, correo, pausa…). Con una regla guardada
   * se tiene en cuenta lo que ya ejecutó.
   */
  async simulate(input: AutomationRuleInput, ruleId: number | null = null): Promise<{ matched: number; items: SimulationItem[]; truncated: boolean; lookbackDays: number }> {
    const rule = await this.validate(input);
    const now = this.now();
    const since = now - AUTOMATION_LIMITS.simulateLookbackDays * DAY;
    const entityType = (AUTOMATION_TRIGGERS[rule.trigger] as TriggerDef).entity;
    const items: SimulationItem[] = [];
    let matched = 0;
    for await (const list of this.pages(rule, since, now)) {
      const runs: RunRow[] = ruleId ? await this.d.store.runsFor(ruleId, entityType, list.map((e) => e.id)) : [];
      for (const e of list) {
        matched++;
        if (items.length >= AUTOMATION_LIMITS.simulateMax) continue;
        const label = `${e.vars.referencia ?? `#${e.id}`}${e.name ? ` · ${e.name}` : ""}`;
        const plan = planEntity(rule, e.anchorAt, runs.filter((r) => r.entityId === e.id), now, since, Number.POSITIVE_INFINITY);
        const base = { entity: label, entityType: e.type, entityId: e.id };
        if (plan.kind === "finished") {
          items.push({ ...base, step: null, action: null, outcome: "terminada", reason: null, detail: null, at: null });
          continue;
        }
        if (plan.kind === "wait") {
          const next = rule.steps.findIndex((s) => stepDueAt(rule.trigger, e.anchorAt, s.delayMinutes) > now);
          items.push({ ...base, step: next >= 0 ? next : null, action: next >= 0 ? rule.steps[next].action.kind : null, outcome: "esperando", reason: null, detail: null, at: plan.until });
          continue;
        }
        const action = rule.steps[plan.step].action;
        const r = await runAction(action, { rule: { id: ruleId ?? 0, name: rule.name, updatedBy: null, createdBy: null }, entity: e, key: runKeyOf(ruleId ?? 0, e, rule.steps, plan.step), dry: true }, this.d.actions).catch(
          (err): ActionOutcome => ({ status: "failed", reason: "error", detail: err instanceof Error ? err.message.slice(0, 200) : null }),
        );
        items.push({ ...base, step: plan.step, action: action.kind, outcome: r.status === "done" ? "ejecutaria" : "omitiria", reason: r.reason, detail: r.detail, at: stepDueAt(rule.trigger, e.anchorAt, rule.steps[plan.step].delayMinutes) });
      }
    }
    return { matched, items, truncated: matched > items.length, lookbackDays: AUTOMATION_LIMITS.simulateLookbackDays };
  }
}
