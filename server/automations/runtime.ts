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
import { AUTOMATIONS_CAPABILITY, type CoreReminders } from "../../shared/automations";
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
  commercialRecipient: async (email) => {
    try {
      const d = await getTenantDatabase();
      if (!d) throw new Error("Base de datos no disponible");
      const rows = ((await d.execute(sql`SELECT c.id, m.status FROM clients c JOIN customer_marketing_consents m ON m.client_id = c.id WHERE LOWER(TRIM(c.email)) = ${email}`)) as unknown as [Record<string, any>[]])[0] ?? [];
      // Como Campaigns: una retirada para ese correo (en cualquier ficha) manda sobre cualquier concesión
      if (rows.some((r) => r.status !== "granted")) return null;
      const granted = rows.find((r) => r.status === "granted");
      return granted ? Number(granted.id) : null;
    } catch (e) {
      // Sin la tabla de consentimientos (migración 0042) nadie tiene el consentimiento: el correo comercial no sale
      if (missingTable(e)) return null;
      throw e;
    }
  },
  commercialAvailable: async () => (await import("../netPublic/brevoUnsubscribe")).unsubscribeAvailable(),
  unsubscribeLink: async (clientId) => {
    const u = await import("../netPublic/brevoUnsubscribe");
    if (!(await u.unsubscribeAvailable())) return null;
    // Sin clave de firma el enlace no serviría: entonces no hay enlace (y el correo comercial no sale)
    return u.UNSUB_TOKEN_RE.test(u.unsubscribeToken(clientId)) ? u.unsubscribeUrl(clientId) : null;
  },
  renderEmail: (subject, body, greetingName, unsubscribeUrl) => {
    const company = companyName();
    const paragraphs = body.split(/\n+/).map((p) => p.trim()).filter(Boolean);
    const note = unsubscribeUrl
      ? `Recibes este correo porque aceptaste recibir comunicaciones comerciales de ${company}. Para darte de baja: ${unsubscribeUrl}`
      : `Mensaje automático de ${company}.`;
    const html = buildNoticeHtml({ badge: company, title: subject, greetingName, paragraphs, note });
    const text = [`Hola${greetingName ? `, ${greetingName}` : ""}:`, "", ...paragraphs, "", company, ...(unsubscribeUrl ? ["", note] : [])].join("\n");
    return { html, text };
  },
  sendEmail: (p) => sendEmail({ to: p.to, subject: p.subject, html: p.html, text: p.text, category: p.category, idempotencyKey: p.idempotencyKey }),
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

/**
 * Recordatorios que el Core ya envía en la empresa en curso, para avisar en las plantillas: el job de correo del Centro
 * de comunicaciones encendido y con alguna regla activa, y los recordatorios de cita de Care Net activados. Sin poder
 * comprobarlo (sin tablas), se da por no activo.
 */
export async function coreReminders(): Promise<CoreReminders> {
  const safe = async (fn: () => Promise<boolean>) => {
    try {
      return await fn();
    } catch {
      return false;
    }
  };
  const [emailAutomation, careNetReminders] = await Promise.all([
    safe(async () => {
      const { getFeatureFlag } = await import("../config");
      if (!(await getFeatureFlag("email_automation_job_enabled"))) return false;
      const r = await firstRow(sql`SELECT COUNT(*) AS n FROM email_automation_rules WHERE isActive = 1`);
      return Number(r?.n ?? 0) > 0;
    }),
    safe(async () => (await (await import("../careNetRemindersDb")).getReminderSettings()).enabled),
  ]);
  return { emailAutomation, careNetReminders };
}
