/**
 * Automatizaciones avanzadas · ensamblado en el proceso con lo que ya tiene el Core (nada duplicado):
 *  - correo: `sendEmail` (servicio de correo de la empresa, su remitente y su marca con `buildNoticeHtml`), estado del
 *    correo y política de la prueba gratuita de los recordatorios de Care Net (`mailBlockReason`, `trialBlocksNow`);
 *  - pausa del cliente: `customer_email_prefs.automationsPaused` (Centro de comunicaciones);
 *  - consentimiento de marketing: `customer_marketing_consents` (el de Elephant Campaigns y Brevo, migración 0042);
 *  - tareas: `crmTasksDb.createTask`; etapas: `crmFunnelDb.moveLeadToStage` (con su historial); etiquetas:
 *    `crmTagsDb.assignTag`; avisos: campana del panel (fuente «automation» de server/routers/notifications.ts).
 */
import { sql } from "drizzle-orm";
import { getCapabilityAccess } from "../_core/capabilities/access";
import { getTenantDatabase } from "../_core/dbRegistry";
import { sendEmail } from "../mailer";
import { buildNoticeHtml } from "../emailTemplates";
import { companyName } from "../tenantBrand";
import { AUTOMATIONS_CAPABILITY } from "../../shared/automations";
import type { ActionDeps } from "./actions";
import { madridDay } from "./engine";
import { AutomationService } from "./service";
import { TenantDbAutomationSources } from "./sources";
import { TenantDbAutomationStore } from "./store";

const store = new TenantDbAutomationStore();
const sources = new TenantDbAutomationSources(() => companyName());

async function firstRow(q: ReturnType<typeof sql>): Promise<Record<string, any> | null> {
  const d = await getTenantDatabase();
  if (!d) throw new Error("Base de datos no disponible");
  return (((await d.execute(q)) as unknown as [Record<string, any>[]])[0] ?? [])[0] ?? null;
}

const missingTable = (e: unknown) => {
  for (let x: any = e, i = 0; x && i < 6; x = x.cause, i++) if (x.code === "ER_NO_SUCH_TABLE" || x.errno === 1146) return true;
  return false;
};

async function licensedFor(cap: string, write: boolean): Promise<boolean> {
  return (await getCapabilityAccess().check(cap, { write })).allowed;
}

export const coreActionDeps: ActionDeps = {
  mailBlock: async () => (await import("../careNetReminders")).mailBlockReason(),
  trialBlocks: async (email) => (await import("../careNetReminders")).trialBlocksNow(email),
  paused: async (email) => {
    const r = await firstRow(sql`SELECT automationsPaused FROM customer_email_prefs WHERE email = ${email} LIMIT 1`);
    return !!r && (r.automationsPaused === true || Number(r.automationsPaused) === 1);
  },
  marketingConsent: async (email) => {
    try {
      const r = await firstRow(sql`SELECT c.status FROM customer_marketing_consents c JOIN clients cl ON cl.id = c.client_id WHERE LOWER(cl.email) = ${email} ORDER BY c.updated_at DESC LIMIT 1`);
      return r?.status === "granted";
    } catch (e) {
      // Sin la tabla de consentimientos (migración 0042) nadie tiene el consentimiento: el correo comercial no sale
      if (missingTable(e)) return false;
      throw e;
    }
  },
  renderEmail: (subject, body, greetingName) => {
    const company = companyName();
    const paragraphs = body.split(/\n+/).map((p) => p.trim()).filter(Boolean);
    const html = buildNoticeHtml({ badge: company, title: subject, greetingName, paragraphs, note: `Mensaje automático de ${company}.` });
    const text = [`Hola${greetingName ? `, ${greetingName}` : ""}:`, "", ...paragraphs, "", company].join("\n");
    return { html, text };
  },
  sendEmail: (p) => sendEmail({ to: p.to, subject: p.subject, html: p.html, text: p.text, category: "operational", idempotencyKey: p.idempotencyKey }),
  validAssignee: async (userId) => (await (await import("../crmTasksDb")).listAssignees()).some((u) => u.id === userId),
  createTask: async (t, actorId) => (await (await import("../crmTasksDb")).createTask(t, actorId)).id,
  funnelLicensed: () => licensedFor("crm-funnel-advanced", true).catch(() => false),
  stageExists: async (id) => (await (await import("../crmFunnelDb")).listStages()).some((s) => s.id === id),
  moveStage: async (leadId, stageId, reason, actorId) => {
    await (await import("../crmFunnelDb")).moveLeadToStage(leadId, stageId, reason, { id: actorId, name: "Automatización" });
  },
  tagExists: async (id) => (await (await import("../crmTagsDb")).listTags()).some((t) => t.id === id),
  assignTag: async (tagId, leadId, actorId) => (await import("../crmTagsDb")).assignTag(tagId, "lead", leadId, actorId),
  addNotice: (n) => store.addNotice(n),
  dayPlus: (days) => madridDay(Date.now() + days * 86_400_000),
};

export function automationService(): AutomationService {
  return new AutomationService({ store, sources, actions: coreActionDeps, licensed: () => licensedFor(AUTOMATIONS_CAPABILITY, true) });
}

/** Opciones del editor: responsables, etapas (si hay embudo avanzado) y etiquetas. */
export async function editorOptions() {
  const [{ listAssignees }, { listTags }] = await Promise.all([import("../crmTasksDb"), import("../crmTagsDb")]);
  const funnel = await coreActionDeps.funnelLicensed();
  const safe = async <T>(p: () => Promise<T>, fallback: T) => {
    try {
      return await p();
    } catch {
      return fallback;
    }
  };
  return {
    assignees: await safe(listAssignees, []),
    tags: await safe(async () => (await listTags()).map((t) => ({ id: t.id, name: t.name })), [] as Array<{ id: number; name: string }>),
    stages: funnel ? await safe(async () => (await (await import("../crmFunnelDb")).listStages()).map((s) => ({ id: s.id, name: s.name })), [] as Array<{ id: number; name: string }>) : null,
  };
}

/** Estado del correo de la empresa para el panel. */
export async function mailStatus(): Promise<{ ready: boolean; message: string | null }> {
  return (await import("../careNetReminders")).reminderMailStatus();
}
