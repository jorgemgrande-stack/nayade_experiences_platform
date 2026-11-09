/**
 * Automatizaciones avanzadas (namespace `automations`, licenciado con la capacidad `automations-advanced` en
 * server/_core/capabilities/routeGuard.ts y comprobado también aquí: sin licencia, 403; en solo lectura, solo consultas:
 * ver reglas, historial y avisos). Solo administración. Las reglas nacen apagadas; «probar» simula sin enviar ni crear nada.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { adminProcedure, router } from "../_core/trpc";
import { getCapabilityAccess } from "../_core/capabilities/access";
import { AUTOMATIONS_CAPABILITY, RULE_TEMPLATES, ruleInputSchema } from "../../shared/automations";
import { AutomationError } from "./service";
import { automationService, editorOptions, mailStatus } from "./runtime";
import { AutomationsNotInstalled } from "./store";

const CODES: Record<AutomationError["code"], TRPCError["code"]> = { invalid_input: "BAD_REQUEST", not_found: "NOT_FOUND" };

async function handle<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof AutomationError) throw new TRPCError({ code: CODES[e.code], message: e.message });
    if (e instanceof AutomationsNotInstalled) throw new TRPCError({ code: "PRECONDITION_FAILED", message: e.message });
    throw e;
  }
}

const licensed = adminProcedure.use(async ({ type, next }) => {
  const d = await getCapabilityAccess().check(AUTOMATIONS_CAPABILITY, { write: type === "mutation" });
  if (!d.allowed) throw new TRPCError({ code: "FORBIDDEN", message: d.reason || "Las automatizaciones avanzadas no están incluidas en tu plan" });
  return next();
});

const svc = () => automationService();
const id = z.number().int().positive();
const userOf = (ctx: { user: { id: number } }) => ctx.user.id;

export const automationsRouter = router({
  /** Reglas, plantillas, opciones del editor, estado del correo y consumo de hoy. */
  overview: licensed.query(() =>
    handle(async () => {
      const s = svc();
      const [rules, today, options, mail] = await Promise.all([s.rules(), s.today(), editorOptions(), mailStatus()]);
      return { rules, today, options, mail, templates: RULE_TEMPLATES.map((t) => ({ key: t.key, title: t.title, summary: t.summary, trigger: t.rule.trigger, used: rules.some((r) => r.templateKey === t.key) })) };
    }),
  ),
  rule: licensed.input(z.object({ id })).query(({ input }) => handle(() => svc().rule(input.id))),
  history: licensed.input(z.object({ ruleId: id.optional(), limit: z.number().int().min(1).max(500).optional() }).optional()).query(({ input }) => handle(() => svc().history(input?.ruleId, input?.limit))),
  notices: licensed.query(() => handle(() => svc().notices())),

  create: licensed.input(ruleInputSchema).mutation(({ ctx, input }) => handle(() => svc().create(input, userOf(ctx)))),
  createFromTemplate: licensed.input(z.object({ key: z.string().min(1).max(60) })).mutation(({ ctx, input }) => handle(() => svc().createFromTemplate(input.key, userOf(ctx)))),
  update: licensed.input(z.object({ id, rule: ruleInputSchema })).mutation(({ ctx, input }) => handle(() => svc().update(input.id, input.rule, userOf(ctx)))),
  setEnabled: licensed.input(z.object({ id, enabled: z.boolean() })).mutation(({ ctx, input }) => handle(() => svc().setEnabled(input.id, input.enabled, userOf(ctx)))),
  archive: licensed.input(z.object({ id })).mutation(({ ctx, input }) => handle(() => svc().archive(input.id, userOf(ctx)))),
  /** Modo «probar»: qué haría la regla ahora, sin enviar, crear ni registrar nada. */
  simulate: licensed.input(z.object({ rule: ruleInputSchema, ruleId: id.nullish() })).mutation(({ input }) => handle(() => svc().simulate(input.rule, input.ruleId ?? null))),
});
