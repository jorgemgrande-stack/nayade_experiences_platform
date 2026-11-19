/**
 * Elephant LMS: circuito comercial → matrícula.
 *
 *   Catálogo → solicitud/inscripción → presupuesto → COBRO CONFIRMADO → inscripción confirmada → matrícula → acceso.
 *
 * El acceso solo se libera con una inscripción CONFIRMADA y un presupuesto efectivamente COBRADO (cobro manual verificado o
 * pasarela autenticada): un presupuesto creado o aceptado sin cobro, un justificante sin verificar o una solicitud no
 * conceden nada. Confirmar la plaza «sin pago» (con motivo) tampoco da acceso al contenido. Las reglas por modalidad son
 * de catálogo (learning_access_rules): sin regla (p. ej. RECONNECT LIVE) no hay matrícula.
 *
 * La cuenta del alumno es la del Core (rol de cliente) con invitación de un solo uso. El CORREO de invitación no sale solo:
 * solo con el ajuste `learning_invite_emails` = true o por la acción expresa «Enviar invitación» de la administración
 * (lección del 16/11: los avisos de un tenant salen de verdad a personas reales).
 */
import { sql } from "drizzle-orm";
import { getDb } from "./db";
import { getSystemSetting } from "./config";
import { matchRules } from "../shared/learning";
import { isQuotePaid } from "../shared/enrollmentCommerce";
import { listRules, grantFromPayment, isMissingLearningSchema } from "./learningDb";
import { readLinkedQuotes } from "./enrollmentCommerceDb";
import { ensureAccount } from "./communitiesDb";
import { sendEmail } from "./mailer";
import { buildNoticeHtml } from "./emailTemplates";
import { publicBaseUrl } from "./_core/productIdentity";
import { companyName } from "./tenantBrand";

export type FlowResult =
  | { status: "skipped"; reason: "not_found" | "not_confirmed" | "no_rule" | "payment_not_confirmed" | "no_schema" }
  | { status: "granted"; created: number; existing: number; userId: number; accountCreated: boolean; invitationSent: boolean; invitePending: boolean };

const activationPath = (token: string) => `/mi-formacion/activar?token=${encodeURIComponent(token)}`;

/** Envía la invitación de acceso al aula (solo se llama por decisión expresa o con el ajuste activado). */
export async function sendLearningInvitation(invite: { userId: number; name: string; email: string; token: string }, courseTitle?: string): Promise<boolean> {
  const base = publicBaseUrl();
  const company = companyName();
  return sendEmail({
    to: invite.email,
    subject: courseTitle ? `Acceso a tu curso «${courseTitle}»` : "Acceso a tu formación",
    category: "user_invite",
    idempotencyKey: `learning-invite:${invite.userId}:${invite.token.slice(0, 12)}`,
    html: buildNoticeHtml({
      badge: "Formación",
      title: courseTitle ? `Ya puedes acceder a «${courseTitle}»` : "Ya puedes acceder a tu formación",
      greetingName: invite.name,
      paragraphs: [`${company} te ha dado acceso a su formación digital. Crea tu contraseña para entrar en tu aula privada.`],
      cta: { label: "Crear mi contraseña y entrar", url: `${base}${activationPath(invite.token)}` },
      note: "El enlace es personal, caduca en 7 días y solo puede usarse una vez. Si no esperabas esta invitación, ignora este mensaje.",
    }),
  }).catch(() => false);
}

/**
 * Libera el acceso de una inscripción si procede. Nunca lanza por falta de esquema o de reglas: el circuito comercial
 * existente no debe romperse nunca por el LMS. Idempotente.
 */
export async function grantLearningFromEnrollment(enrollmentId: number, actor: { id: number | null; name: string | null }, now = Date.now()): Promise<FlowResult> {
  const d = await getDb();
  if (!d) return { status: "skipped", reason: "no_schema" };
  try {
    const [r] = ((await d.execute(sql`SELECT e.id, e.client_id, e.name, e.email, e.status, e.variant_id, e.quote_id, ed.experience_id
      FROM edition_enrollments e JOIN product_editions ed ON ed.id = e.edition_id WHERE e.id = ${enrollmentId}`)) as unknown as [Array<Record<string, any>>])[0] ?? [];
    if (!r) return { status: "skipped", reason: "not_found" };
    if (r.status !== "confirmada") return { status: "skipped", reason: "not_confirmed" };
    const experienceId = Number(r.experience_id);
    const variantId = r.variant_id == null ? null : Number(r.variant_id);
    if (!matchRules(await listRules(), experienceId, variantId).length) return { status: "skipped", reason: "no_rule" };
    const quote = r.quote_id ? (await readLinkedQuotes(d, [Number(r.quote_id)])).get(Number(r.quote_id)) : undefined;
    if (!quote || !isQuotePaid(quote.status) || !(quote.total > 0)) return { status: "skipped", reason: "payment_not_confirmed" };
    const acc = await ensureAccount(String(r.name), String(r.email));
    const res = await grantFromPayment({
      userId: acc.userId, clientId: r.client_id == null ? null : Number(r.client_id), experienceId, variantId, operation: { kind: "enrollment", id: enrollmentId }, enrollmentId, quoteId: Number(r.quote_id),
      payment: { reference: quote.quoteNumber || `quote:${quote.id}`, amountCents: Math.round(quote.total * 100), verifiedBy: actor.name || (actor.id != null ? `Usuario ${actor.id}` : "sistema") },
      actorUserId: actor.id, now,
    });
    const created = res.granted.filter((g) => g.created).length;
    let invitationSent = false;
    const auto = String(await Promise.resolve(getSystemSetting("learning_invite_emails", "false"))).toLowerCase() === "true";
    if (created > 0 && acc.invite && auto) invitationSent = await sendLearningInvitation(acc.invite);
    return { status: "granted", created, existing: res.granted.length - created, userId: acc.userId, accountCreated: acc.created, invitationSent, invitePending: !!acc.invite && !invitationSent };
  } catch (e) {
    if (isMissingLearningSchema(e)) return { status: "skipped", reason: "no_schema" };
    throw e;
  }
}

/** Hook seguro para el circuito de inscripciones: registra el fallo pero nunca interrumpe la confirmación de la plaza. */
export async function safeGrantAfterConfirm(enrollmentId: number, actor: { id: number | null; name: string | null }): Promise<void> {
  try {
    await grantLearningFromEnrollment(enrollmentId, actor);
  } catch (e) {
    console.error(JSON.stringify({ ctx: "Learning", event: "grant_after_confirm_failed", enrollmentId, error: e instanceof Error ? e.name : "error" }));
  }
}
