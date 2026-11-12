/**
 * Automatizaciones avanzadas · ejecución de cada acción con lo que ya hace el Core (las dependencias reales están en
 * runtime.ts; las pruebas usan dobles). Con `dry` (modo «probar»), hace las MISMAS comprobaciones y no envía, no crea
 * ni cambia nada.
 *
 * Correo: solo al correo de la entidad (cliente de la reserva, del presupuesto o de la factura; la propia oportunidad),
 * con la marca y el remitente de la empresa (`sendEmail`) y clave de idempotencia por regla, entidad y paso. Nunca a
 * quien tiene las comunicaciones automáticas en pausa. El operativo sale con la categoría «operational». El «comercial»
 * sale con la categoría «marketing», solo a un cliente con el consentimiento de marketing CONCEDIDO y ninguna retirada
 * para ese correo (el de Elephant Campaigns y Brevo), y siempre con su enlace personal de baja (el de Campaigns, que
 * retira el consentimiento); sin enlace de baja disponible, no sale. Respeta la política de la prueba gratuita y el
 * estado del correo de la empresa.
 */
import { ACTION_LABELS, type AutomationAction } from "../../shared/automations";
import { renderText, runKeyText, validEmail, type AutomationEntity, type RunKey, type StoredRule } from "./engine";

export interface ActionOutcome {
  status: "done" | "skipped" | "failed";
  reason: string | null;
  detail: string | null;
}

export interface ActionContext {
  rule: Pick<StoredRule, "id" | "name" | "updatedBy" | "createdBy">;
  entity: AutomationEntity;
  key: RunKey;
  dry: boolean;
}

export interface MailParams {
  to: string;
  subject: string;
  html: string;
  text: string;
  idempotencyKey: string;
  category: "operational" | "marketing";
}

export interface ActionDeps {
  /** Motivo por el que la empresa no puede enviar correo ahora (null = puede). */
  mailBlock(): Promise<string | null>;
  /** ¿La política de la prueba gratuita impide escribir a ese destinatario? */
  trialBlocks(email: string): Promise<boolean>;
  /** ¿Tiene el cliente las comunicaciones automáticas en pausa? (customer_email_prefs) */
  paused(email: string): Promise<boolean>;
  /**
   * Cliente del CRM con ese correo que tiene el consentimiento de marketing CONCEDIDO y ninguna retirada para ese correo
   * (customer_marketing_consents); si no, null.
   */
  commercialRecipient(email: string): Promise<number | null>;
  /** ¿Se pueden enviar correos comerciales? (enlace de baja de Elephant Campaigns disponible) */
  commercialAvailable(): Promise<boolean>;
  /** Enlace personal de baja del cliente que retira su consentimiento; null si no está disponible. */
  unsubscribeLink(clientId: number): Promise<string | null>;
  renderEmail(subject: string, body: string, greetingName: string | null, unsubscribeUrl: string | null): { html: string; text: string };
  sendEmail(p: MailParams): Promise<boolean>;
  validAssignee(userId: number): Promise<boolean>;
  createTask(t: { title: string; description: string | null; dueDate: string; assignedTo: number | null; priority: "baja" | "media" | "alta"; entityType: "lead" | "quote" | null; entityId: number | null }, actorId: number): Promise<number>;
  funnelLicensed(): Promise<boolean>;
  /** ¿Licencia de tareas del CRM (crm-tasks) y de etiquetas (crm-tags) en escritura? */
  tasksLicensed(): Promise<boolean>;
  tagsLicensed(): Promise<boolean>;
  stageExists(stageId: number): Promise<boolean>;
  moveStage(leadId: number, stageId: number, reason: string, actorId: number): Promise<void>;
  tagExists(tagId: number): Promise<boolean>;
  assignTag(tagId: number, leadId: number, actorId: number): Promise<void>;
  addNotice(n: { key: RunKey; title: string; body: string | null; ctaPath: string | null }): Promise<void>;
  /** Día de hoy + n en Madrid (AAAA-MM-DD). */
  dayPlus(days: number): string;
}

const ok = (detail: string | null): ActionOutcome => ({ status: "done", reason: null, detail });
const skip = (reason: string, detail: string | null = null): ActionOutcome => ({ status: "skipped", reason, detail });
const fail = (reason: string, detail: string | null = null): ActionOutcome => ({ status: "failed", reason, detail });
/** Nunca se muestran direcciones completas en el historial: «ana@…». */
export const maskEmail = (e: string) => `${e.split("@")[0].slice(0, 3)}…@${e.split("@")[1] ?? ""}`;

export async function runAction(action: AutomationAction, ctx: ActionContext, d: ActionDeps): Promise<ActionOutcome> {
  const e = ctx.entity;
  const actorId = ctx.rule.updatedBy ?? ctx.rule.createdBy ?? 0;
  const would = (text: string) => (ctx.dry ? `Se haría: ${text}` : text);
  switch (action.kind) {
    case "email": {
      const to = validEmail(e.email);
      if (!to) return skip("sin_correo");
      if (await d.paused(to)) return skip("cliente_en_pausa");
      let unsubscribeUrl: string | null = null;
      // Comercial: la regla lo dice o no trata de una reserva o factura del cliente (leads, presupuestos sin respuesta).
      // Lo comercial exige consentimiento y enlace de baja SIEMPRE, también si la regla dice «operativo»
      const commercial = action.purpose === "commercial" || !(e.type === "reservation" || e.type === "invoice");
      if (commercial) {
        const clientId = await d.commercialRecipient(to);
        if (clientId == null) return skip("sin_consentimiento");
        unsubscribeUrl = await d.unsubscribeLink(clientId);
        if (!unsubscribeUrl) return skip("sin_enlace_de_baja");
      }
      const block = await d.mailBlock();
      if (block) return ctx.dry ? skip("correo_no_disponible", block) : fail("correo_no_disponible", block);
      if (await d.trialBlocks(to).catch(() => false)) return skip("prueba_gratuita");
      const subject = renderText(action.subject, e.vars, true).slice(0, 200);
      if (ctx.dry) return ok(would(`correo «${subject}» a ${maskEmail(to)}`));
      const c = d.renderEmail(subject, renderText(action.body, e.vars), e.name, unsubscribeUrl);
      const category = commercial ? "marketing" : "operational";
      const sent = await d.sendEmail({ to, subject, html: c.html, text: c.text, idempotencyKey: runKeyText(ctx.key), category }).catch(() => false);
      return sent ? ok(`Correo «${subject}» a ${maskEmail(to)}`) : fail("envio_fallido");
    }
    case "task": {
      if (!(await d.tasksLicensed())) return skip("sin_tareas");
      // Responsable: el elegido en la regla (debe seguir en el equipo) o, si no, el de la oportunidad
      let owner: number | null = null;
      if (action.assignedTo != null) {
        if (!(await d.validAssignee(action.assignedTo))) return skip("responsable_no_valido");
        owner = action.assignedTo;
      } else if (e.ownerId != null && (await d.validAssignee(e.ownerId))) owner = e.ownerId;
      const title = renderText(action.title, e.vars, true).slice(0, 200);
      const linked = e.type === "lead" || e.type === "quote" ? { entityType: e.type, entityId: e.id } : e.leadId != null ? { entityType: "lead" as const, entityId: e.leadId } : { entityType: null, entityId: null };
      if (ctx.dry) return ok(would(`tarea «${title}»`));
      const description = `Creada por la automatización «${ctx.rule.name}»${e.type === "reservation" || e.type === "invoice" ? ` (${e.type === "reservation" ? "reserva" : "factura"} ${e.vars.referencia ?? ""})` : ""}.`;
      const id = await d.createTask({ title, description, dueDate: d.dayPlus(action.dueInDays), assignedTo: owner, priority: action.priority, ...linked }, actorId);
      return ok(`Tarea #${id} «${title}»`);
    }
    case "notify": {
      const title = renderText(action.title, e.vars, true).slice(0, 160);
      if (ctx.dry) return ok(would(`aviso al equipo «${title}»`));
      await d.addNotice({ key: ctx.key, title, body: renderText(action.body, e.vars, true).slice(0, 600) || null, ctaPath: e.ctaPath });
      return ok(`Aviso «${title}»`);
    }
    case "lead_stage": {
      if (e.leadId == null) return skip("sin_oportunidad");
      if (!(await d.funnelLicensed())) return skip("sin_embudo");
      if (!(await d.stageExists(action.stageId))) return skip("etapa_no_existe");
      if (ctx.dry) return ok(would(`mover la oportunidad #${e.leadId} de etapa`));
      await d.moveStage(e.leadId, action.stageId, `Automatización «${ctx.rule.name}»`, actorId);
      return ok(`Oportunidad #${e.leadId} movida de etapa`);
    }
    case "lead_tag": {
      if (e.leadId == null) return skip("sin_oportunidad");
      if (!(await d.tagsLicensed())) return skip("sin_etiquetas");
      if (!(await d.tagExists(action.tagId))) return skip("etiqueta_no_existe");
      if (ctx.dry) return ok(would(`etiquetar la oportunidad #${e.leadId}`));
      await d.assignTag(action.tagId, e.leadId, actorId);
      return ok(`Oportunidad #${e.leadId} etiquetada`);
    }
  }
}

export const actionSummary = (a: AutomationAction) => ACTION_LABELS[a.kind];
