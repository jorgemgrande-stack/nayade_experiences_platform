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
import { matchRules, LearningRuleError } from "../shared/learning";
import { isQuotePaid } from "../shared/enrollmentCommerce";
import { listRules, grantFromPayment, isMissingLearningSchema } from "./learningDb";
import { readLinkedQuotes } from "./enrollmentCommerceDb";
import { ensureAccount } from "./communitiesDb";
import { sendEmail } from "./mailer";
import { buildNoticeHtml } from "./emailTemplates";
import { publicBaseUrl } from "./_core/productIdentity";
import { companyName } from "./tenantBrand";
import { siteUiText, fillUiText } from "../shared/siteUiText";
import { resolveBuyerLocale } from "./checkoutExtrasDb";

/** Idioma del pedido (el de la web en que compró); sin él, el principal de la empresa. */
async function orderLocale(merchantOrder: string): Promise<string> {
  try {
    const d = await getDb();
    if (!d) return resolveBuyerLocale(null);
    const [rows] = (await d.execute(sql`SELECT changes_log FROM reservations WHERE merchant_order = ${merchantOrder} ORDER BY id LIMIT 1`)) as unknown as [Array<Record<string, any>>];
    const raw = rows?.[0]?.changes_log;
    return resolveBuyerLocale(typeof raw === "string" ? JSON.parse(raw) : raw);
  } catch {
    return resolveBuyerLocale(null);
  }
}

export type FlowResult =
  | { status: "skipped"; reason: "not_found" | "not_confirmed" | "no_rule" | "payment_not_confirmed" | "no_schema" }
  | { status: "granted"; created: number; existing: number; userId: number; accountCreated: boolean; invitationSent: boolean; invitePending: boolean };

const activationPath = (token: string) => `/mi-formacion/activar?token=${encodeURIComponent(token)}`;

/** Envía la invitación de acceso al aula (solo se llama por decisión expresa o con el ajuste activado). */
export async function sendLearningInvitation(invite: { userId: number; name: string; email: string; token: string }, courseTitle?: string, locale?: string): Promise<boolean> {
  const base = publicBaseUrl();
  const company = companyName();
  const lang = locale ?? (await resolveBuyerLocale(null));
  const ui = siteUiText(lang);
  return sendEmail({
    to: invite.email,
    subject: courseTitle ? fillUiText(ui.emLearnInviteSubjectCourse, { course: courseTitle }) : ui.emLearnInviteSubject,
    category: "user_invite",
    idempotencyKey: `learning-invite:${invite.userId}:${invite.token.slice(0, 12)}`,
    html: buildNoticeHtml({
      badge: ui.emLearnBadge,
      locale: lang,
      title: courseTitle ? fillUiText(ui.emLearnInviteTitleCourse, { course: courseTitle }) : ui.emLearnInviteTitle,
      greetingName: invite.name,
      paragraphs: [fillUiText(ui.emLearnInviteText, { company })],
      cta: { label: ui.emLearnInviteCta, url: `${base}${activationPath(invite.token)}` },
      note: ui.emLearnInviteNote,
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

// ─── Pedido de tienda pagado → matrícula ─────────────────────────────────────────────────────────────

export type OrderFlowResult =
  | { status: "skipped"; reason: "no_schema" | "no_paid_lines" | "no_rule" | "no_email" | "error" }
  | { status: "granted"; created: number; existing: number; userId: number; notified: "invitation" | "access" | "pending" | "none"; failed?: number };

const readOrderLines = async (merchantOrder: string) => {
  const d = await getDb();
  if (!d) return null;
  const [rows] = (await d.execute(sql`SELECT id, product_id, variant_id, customer_name, customer_email, amount_paid, amount_total
    FROM reservations WHERE merchant_order = ${merchantOrder} AND status = 'paid' ORDER BY id`)) as unknown as [Array<Record<string, any>>];
  return rows;
};

/** Aviso a una persona que ya tiene cuenta activa: enlace a su aula. Idempotente por usuario y pedido. */
export async function sendLearningAccessNotice(to: { userId: number; name: string; email: string }, merchantOrder: string): Promise<boolean> {
  const base = publicBaseUrl();
  const company = companyName();
  const lang = await orderLocale(merchantOrder);
  const ui = siteUiText(lang);
  return sendEmail({
    to: to.email,
    subject: ui.emLearnAccessSubject,
    category: "user_invite",
    idempotencyKey: `learning-access:${to.userId}:${merchantOrder}`,
    html: buildNoticeHtml({
      badge: ui.emLearnBadge,
      locale: lang,
      title: ui.emLearnInviteTitle,
      greetingName: to.name,
      paragraphs: [fillUiText(ui.emLearnAccessText, { company })],
      cta: { label: ui.emLearnAccessCta, url: `${base}/mi-formacion` },
      note: ui.emLearnAccessNote,
    }),
  }).catch(() => false);
}

/**
 * Pedido de tienda PAGADO → matrícula según las reglas de catálogo (producto + variante comprada).
 *  - Solo líneas `paid` (un pago pendiente, fallido o cancelado no concede nada).
 *  - Cada línea se identifica por su variante guardada al crear el pedido (`reservations.variant_id`); sin regla para esa
 *    variante (p. ej. RECONNECT LIVE) no hay matrícula.
 *  - Idempotente por línea (clave de pago `order:<línea>:<regla>:<usuario>`): reintentos del cobro, avisos repetidos o una
 *    pasada de recuperación no duplican matrículas ni correos. Si todas las líneas con regla ya tienen matrícula, ni siquiera
 *    toca la cuenta (evita rotar la invitación de un alumno que aún no la ha activado).
 *  - NUNCA lanza: el cierre del pedido (factura, correo de pedido) no puede romperse por el LMS. El correo de acceso solo sale
 *    con el ajuste `learning_invite_emails` = true (la empresa lo enciende al abrir la venta).
 */
export async function grantLearningFromOrder(merchantOrder: string, actor: { id: number | null; name: string | null } = { id: null, name: "sistema" }, now = Date.now()): Promise<OrderFlowResult> {
  try {
    const lines = await readOrderLines(merchantOrder);
    if (!lines || !lines.length) return { status: "skipped", reason: "no_paid_lines" };
    const rules = await listRules();
    const matched = lines.filter((l) => matchRules(rules, Number(l.product_id), l.variant_id == null ? null : Number(l.variant_id)).length > 0);
    if (!matched.length) return { status: "skipped", reason: "no_rule" };
    const d = await getDb();
    if (!d) return { status: "skipped", reason: "no_schema" };
    const first = matched[0];
    const email = String(first.customer_email ?? "").trim();
    if (!email) return { status: "skipped", reason: "no_email" };
    // ¿Ya está todo concedido? Entonces no se hace nada más.
    const [done] = (await d.execute(sql`SELECT order_id, user_id FROM learning_enrollments WHERE source = 'payment' AND order_id IN (${sql.join(matched.map((l) => sql`${Number(l.id)}`), sql`, `)})`)) as unknown as [Array<Record<string, any>>];
    const doneIds = new Set(done.map((r) => Number(r.order_id)));
    const pending = matched.filter((l) => !doneIds.has(Number(l.id)));
    if (!pending.length) {
      const [u] = (await d.execute(sql`SELECT id FROM users WHERE LOWER(email) = ${email.toLowerCase()} LIMIT 1`)) as unknown as [Array<Record<string, any>>];
      return { status: "granted", created: 0, existing: matched.length, userId: u?.[0] ? Number(u[0].id) : 0, notified: "none" };
    }
    // Segunda pasada de un pedido con varias líneas (alguna ya concedida): se reutiliza la cuenta ya vinculada, sin rotar su
    // invitación ni volver a avisar (el alumno ya recibió su correo en la primera pasada).
    const earlier = done.length > 0 ? Number(done[0].user_id) : null;
    const acc = earlier != null ? { userId: earlier, invite: null, created: false } : await ensureAccount(String(first.customer_name || email), email);
    let created = 0;
    let failed = 0;
    let lastError: unknown = null;
    // Cada línea por separado: el fallo de una NO impide conceder (ni avisar de) las demás
    for (const l of pending) {
      try {
        const cents = Number(l.amount_paid) > 0 ? Number(l.amount_paid) : Number(l.amount_total);
        const res = await grantFromPayment({
          userId: acc.userId, clientId: null, experienceId: Number(l.product_id), variantId: l.variant_id == null ? null : Number(l.variant_id),
          operation: { kind: "order", id: Number(l.id) }, orderId: Number(l.id),
          payment: { reference: `pedido:${merchantOrder}`, amountCents: cents, verifiedBy: actor.name || "sistema (pasarela)" }, actorUserId: actor.id, now,
        });
        created += res.granted.filter((g) => g.created).length;
      } catch (e) {
        failed++;
        lastError = e;
      }
    }
    if (failed > 0) {
      const code = lastError instanceof LearningRuleError ? lastError.code : lastError instanceof Error ? lastError.name : "error";
      console.error(JSON.stringify({ ctx: "Learning", event: "grant_from_order_failed", merchantOrder, error: code, lines: failed, detail: lastError instanceof Error ? lastError.message.slice(0, 160) : undefined }));
      await recordOrderGrantFailure(merchantOrder, code);
      if (created === 0) return { status: "skipped", reason: "error" };
    }
    let notified: "invitation" | "access" | "pending" | "none" = "none";
    if (created > 0 && earlier == null) {
      const auto = String(await Promise.resolve(getSystemSetting("learning_invite_emails", "false"))).toLowerCase() === "true";
      if (!auto) notified = "pending";
      else if (acc.invite) notified = (await sendLearningInvitation(acc.invite, undefined, await orderLocale(merchantOrder))) ? "invitation" : "pending";
      else notified = (await sendLearningAccessNotice({ userId: acc.userId, name: String(first.customer_name || email), email }, merchantOrder)) ? "access" : "pending";
    }
    return { status: "granted", created, existing: matched.length - pending.length, userId: acc.userId, notified, failed };
  } catch (e) {
    if (isMissingLearningSchema(e)) return { status: "skipped", reason: "no_schema" };
    const code = e instanceof LearningRuleError ? e.code : e instanceof Error ? e.name : "error";
    console.error(JSON.stringify({ ctx: "Learning", event: "grant_from_order_failed", merchantOrder, error: code, detail: e instanceof Error ? e.message.slice(0, 160) : undefined }));
    await recordOrderGrantFailure(merchantOrder, code);
    return { status: "skipped", reason: "error" };
  }
}

/**
 * Un fallo de matrícula NO queda oculto: además del registro de errores, deja constancia en el historial del pedido
 * (`reservations.changes_log`, visible en su ficha) y el pedido aparece en `pendingLearningOrders` hasta que se repare.
 * Reintento: cada nueva pasada del cierre del pedido, o `learning.admin.grantForOrder`.
 */
async function recordOrderGrantFailure(merchantOrder: string, code: string): Promise<void> {
  try {
    const d = await getDb();
    if (!d) return;
    await d.execute(sql`UPDATE reservations SET changes_log = JSON_ARRAY_APPEND(COALESCE(changes_log, JSON_ARRAY()), '$', JSON_OBJECT('ts', ${Date.now()}, 'actor', 'sistema', 'action', 'learning_grant_failed', 'reason', ${String(code).slice(0, 80)}))
      WHERE merchant_order = ${merchantOrder} AND status = 'paid'`);
  } catch {
    /* el registro del fallo nunca debe provocar otro */
  }
}

/** Pedidos pagados cuyas líneas tienen regla de acceso activa y aún NO tienen matrícula (por fallo, correo sin cuenta o reglas activadas después). */
export async function pendingLearningOrders(limit = 200): Promise<Array<{ merchantOrder: string; reservationId: number; productId: number; variantId: number | null; email: string | null; paidAt: number | null }>> {
  const d = await getDb();
  if (!d) return [];
  const rules = await listRules();
  if (!rules.some((r) => r.active)) return [];
  const [lines] = (await d.execute(sql`SELECT r.id, r.merchant_order, r.product_id, r.variant_id, r.customer_email, r.paid_at
    FROM reservations r WHERE r.status = 'paid' AND r.merchant_order IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM learning_enrollments le WHERE le.source = 'payment' AND le.order_id = r.id)
    ORDER BY r.id DESC LIMIT 2000`)) as unknown as [Array<Record<string, any>>];
  return lines
    .filter((l) => matchRules(rules, Number(l.product_id), l.variant_id == null ? null : Number(l.variant_id)).length > 0)
    .slice(0, limit)
    .map((l) => ({ merchantOrder: String(l.merchant_order), reservationId: Number(l.id), productId: Number(l.product_id), variantId: l.variant_id == null ? null : Number(l.variant_id), email: l.customer_email ? String(l.customer_email) : null, paidAt: l.paid_at == null ? null : Number(l.paid_at) }));
}
