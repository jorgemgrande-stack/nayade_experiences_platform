/**
 * Elephant Studio — piezas reales de un envío de formulario (E-7): constancia en la BD de la empresa en curso,
 * claves de Turnstile de su bóveda de credenciales, aviso por el correo de la empresa. El recorrido (y su orden) está
 * en `studioFormsSubmit.ts`; aquí solo se conecta con la base de datos, la bóveda y el correo.
 */
import { sql } from "drizzle-orm";
import { getDb, createLead } from "../db";
import { escapeHtml } from "./tenantSeo";
import { getVault } from "./credentials/runtime";
import { readCaptchaConfig, verifyTurnstile } from "./studioFormsCaptcha";
import { ENV } from "./env";
import { allowFormSubmit } from "./studioForms";
import { type SubmitDeps, type SubmissionRecord, type OwnerNotice } from "./studioFormsSubmit";

type Row = Record<string, unknown>;
async function rows(q: ReturnType<typeof sql>): Promise<Row[]> {
  const db = await getDb();
  if (!db) throw new Error("Base de datos no disponible");
  const [r] = (await db.execute(q)) as unknown as [Row[]];
  return Array.isArray(r) ? r : [];
}

async function findRecent(email: string, slug: string, blockId: string, since: number) {
  try {
    const [r] = await rows(sql`SELECT lead_id FROM studio_form_submissions WHERE email = ${email} AND form_slug = ${slug} AND block_id = ${blockId} AND created_at >= ${since} ORDER BY id DESC LIMIT 1`);
    return r ? { leadId: Number(r.lead_id) } : null;
  } catch (e) {
    // Sin la tabla (migración 0066 aún sin aplicar) el formulario sigue funcionando como siempre, sin detección de duplicados
    console.warn("[studioForms] sin tabla de envíos:", (e as Error).message);
    return null;
  }
}

async function recordSubmission(r: SubmissionRecord) {
  try {
    await rows(sql`INSERT INTO studio_form_submissions
      (lead_id, form_slug, block_id, form_title, email, consent_given, consent_text, consent_version, consent_at, ip_hash, page, utm_json, is_duplicate, created_at)
      VALUES (${r.leadId}, ${r.slug}, ${r.blockId}, ${r.formTitle}, ${r.email}, ${r.consent ? 1 : 0}, ${r.consent?.text ?? null}, ${r.consent?.version ?? null}, ${r.consent?.at ?? null},
        ${r.ipHash}, ${r.page}, ${JSON.stringify(r.utm)}, ${r.duplicate ? 1 : 0}, ${r.at})`);
  } catch (e) {
    console.warn("[studioForms] no se pudo guardar la constancia del envío:", (e as Error).message);
  }
}

async function addLeadNote(leadId: number, text: string) {
  const db = await getDb();
  if (!db) return;
  const { leads } = await import("../../drizzle/schema");
  const { eq } = await import("drizzle-orm");
  const [lead] = await db.select({ notes: leads.internalNotes }).from(leads).where(eq(leads.id, leadId)).limit(1);
  if (!lead) return;
  const notes = Array.isArray(lead.notes) ? lead.notes : [];
  await db.update(leads).set({ internalNotes: [...notes, { text: text.slice(0, 8000), authorId: 0, authorName: "Formulario web", createdAt: new Date().toISOString() }] }).where(eq(leads.id, leadId));
}

async function notifyOwner(n: OwnerNotice) {
  try {
    const { internalNoticeEmail } = await import("../config");
    const to = (await internalNoticeEmail()).trim();
    if (!to) return;
    const { sendManagedEmail } = await import("../emailManager");
    const row = (l: string, v?: string) => (v ? `<tr><td style="padding:2px 12px 2px 0;color:#555">${escapeHtml(l)}</td><td>${escapeHtml(v)}</td></tr>` : "");
    const html = `<p>${n.duplicate ? "Nuevo envío del mismo formulario (se ha anotado en la oportunidad existente)" : "Nueva oportunidad desde un formulario de tu web"}.</p>
<table>${row("Formulario", n.formTitle)}${row("Página", n.page)}${row("Nombre", n.name)}${row("Correo", n.email)}${row("Teléfono", n.phone)}</table>
<pre style="white-space:pre-wrap;font-family:inherit">${escapeHtml(n.message)}</pre>`;
    // Plantilla «operativa» (categoría operational): aviso interno, nunca marketing; el destinatario es el correo de la propia empresa
    await sendManagedEmail({
      templateKey: "studio_form_admin",
      triggerEvent: "lead_submitted",
      recipientEmail: to,
      subject: `Nuevo envío de formulario — ${n.formTitle.replace(/[\r\n]+/g, " ").slice(0, 80)}`,
      html,
      relatedEntityType: "lead",
      relatedEntityId: n.leadId,
      leadId: n.leadId,
      isAutomatic: false,
    });
  } catch (e) {
    console.warn("[studioForms] aviso al propietario fallido:", (e as Error).message);
  }
}

/** Dependencias reales del recorrido para la empresa en curso. */
export async function defaultSubmitDeps(): Promise<SubmitDeps> {
  const { getPublishedFormBlock } = await import("../pageBuilderDb");
  const { withTenantLock } = await import("../tpvSaleIdempotency");
  const { peekTenantContext } = await import("./tenant");
  return {
    tenantId: peekTenantContext()?.tenantId ?? "single",
    now: () => Date.now(),
    allow: (k) => allowFormSubmit(k),
    getForm: getPublishedFormBlock,
    captchaConfig: () => readCaptchaConfig(getVault()),
    verifyCaptcha: (t, s, ip) => verifyTurnstile(t, s, ip),
    findRecent,
    createLead: async (lead) => (await createLead({ ...lead, source: "web_formulario", leadSourceCode: "HOME_FORM" })).id,
    addLeadNote,
    recordSubmission,
    notifyOwner,
    lock: (key, fn) => withTenantLock("forms_submit", key, 8, "Estamos procesando tu envío. Espera unos segundos.", fn),
    ipSecret: ENV.cookieSecret,
  };
}
