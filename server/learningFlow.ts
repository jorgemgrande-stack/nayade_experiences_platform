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
import { matchRules, matchExactRules, LearningRuleError } from "../shared/learning";
import { effectiveQuoteStatus, isQuotePaid } from "../shared/enrollmentCommerce";
import { listRules, grantFromPayment, isMissingLearningSchema } from "./learningDb";
import { paidOrderSupplements, linkSupplementEnrollment, markSupplementRefunded, markOrderSupplementsRefunded, isMissingSupplementSchema } from "./orderSupplements";
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
async function grantMainLearningFromOrder(merchantOrder: string, actor: { id: number | null; name: string | null } = { id: null, name: "sistema" }, now = Date.now()): Promise<OrderFlowResult> {
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
    const [done] = (await d.execute(sql`SELECT order_id, user_id FROM learning_enrollments WHERE source = 'payment' AND idempotency_key NOT LIKE 'pay:order-supplement:%' AND order_id IN (${sql.join(matched.map((l) => sql`${Number(l.id)}`), sql`, `)})`)) as unknown as [Array<Record<string, any>>];
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
 * Suplementos PAGADOS de un pedido → derecho propio (p. ej. Lifetime Access de RECONNECT: acceso permanente a los tres módulos).
 *  - Solo casa con la regla de ESA variante-suplemento (nunca con reglas genéricas): sin regla activa no concede nada.
 *  - Una matrícula APARTE de la del programa (clave pay:order-supplement:<línea>:r<regla>:u<usuario>): conceder el suplemento
 *    dos veces es imposible, y reembolsarlo (refundOrderSupplement) solo retira esa matrícula, nunca la del programa.
 *  - Con pedido completo reembolsado, la matrícula del suplemento comparte order_id y se revoca con las demás.
 *  - Nunca lanza: un fallo se registra en el historial del pedido (igual que el programa) y se reintenta.
 */
export async function grantSupplementsFromOrder(merchantOrder: string, actor: { id: number | null; name: string | null } = { id: null, name: "sistema" }, now = Date.now()): Promise<{ created: number; existing: number; failed: number; userId: number | null }> {
  const none = { created: 0, existing: 0, failed: 0, userId: null as number | null };
  try {
    const supps = await paidOrderSupplements(merchantOrder);
    if (!supps.length) return none;
    const rules = await listRules();
    const todo = supps.filter((s) => matchExactRules(rules, s.productId, s.variantId).length > 0);
    if (!todo.length) return none;
    const email = String(todo[0].customerEmail ?? "").trim();
    if (!email) return none;
    const d = await getDb();
    if (!d) return none;
    // La cuenta ya existe casi siempre (la creó la matrícula del programa): se reutiliza SIN rotar su invitación
    const [u] = (await d.execute(sql`SELECT id FROM users WHERE LOWER(email) = ${email.toLowerCase()} LIMIT 1`)) as unknown as [Array<Record<string, any>>];
    const userId = u?.[0] ? Number(u[0].id) : (await ensureAccount(String(todo[0].customerName || email), email)).userId;
    let created = 0;
    let existing = 0;
    let failed = 0;
    for (const s of todo) {
      try {
        const res = await grantFromPayment({
          userId, clientId: null, experienceId: s.productId, variantId: s.variantId, operation: { kind: "order-supplement", id: s.id }, orderId: s.reservationId,
          payment: { reference: `pedido:${merchantOrder}:${s.group}`, amountCents: s.totalCents, verifiedBy: actor.name || "sistema (pasarela)" }, actorUserId: actor.id, now, exactVariantOnly: true,
        });
        for (const g of res.granted) (g.created ? created++ : existing++);
        const first = res.granted[0];
        if (first && s.enrollmentId == null) await linkSupplementEnrollment(s.id, first.enrollment.id);
      } catch (e) {
        failed++;
        const code = e instanceof LearningRuleError ? e.code : e instanceof Error ? e.name : "error";
        console.error(JSON.stringify({ ctx: "Learning", event: "grant_supplement_failed", merchantOrder, group: s.group, error: code, detail: e instanceof Error ? e.message.slice(0, 160) : undefined }));
        await recordOrderGrantFailure(merchantOrder, `suplemento:${code}`);
      }
    }
    return { created, existing, failed, userId };
  } catch (e) {
    if (isMissingLearningSchema(e) || isMissingSupplementSchema(e)) return none;
    console.error(JSON.stringify({ ctx: "Learning", event: "grant_supplement_failed", merchantOrder, error: e instanceof Error ? e.name : "error" }));
    return none;
  }
}

/**
 * Pedido de tienda PAGADO → matrícula del programa y, aparte, la de sus suplementos pagados (Lifetime Access). Las dos son
 * idempotentes e independientes: el fallo de una no impide la otra.
 */
export async function grantLearningFromOrder(merchantOrder: string, actor: { id: number | null; name: string | null } = { id: null, name: "sistema" }, now = Date.now()): Promise<OrderFlowResult> {
  const main = await grantMainLearningFromOrder(merchantOrder, actor, now);
  const supp = await grantSupplementsFromOrder(merchantOrder, actor, now);
  if (main.status === "skipped" && supp.created + supp.existing > 0 && supp.userId != null) {
    return { status: "granted", created: supp.created, existing: supp.existing, userId: supp.userId, notified: "none", ...(supp.failed ? { failed: supp.failed } : {}) };
  }
  return main;
}


// ─── Presupuesto PAGADO → derecho (retiros sin convocatoria) ─────────────────────────────────────────────

export type QuoteFlowResult =
  | { status: "skipped"; reason: "not_found" | "not_paid" | "no_lead" | "no_rule" | "no_email" | "no_schema" | "via_enrollment" | "via_order" | "no_amount" | "error" }
  | { status: "needs_terms"; quoteId: number; minDays: number }
  | { status: "granted"; created: number; existing: number; userId: number; blockedByTerms: number };

/** Duración contratada confirmada de un presupuesto (null si nadie la ha confirmado o si no existe la migración 0093). */
async function contractedDaysOf(quoteId: number): Promise<number | null> {
  try {
    const d = await getDb();
    if (!d) return null;
    const [r] = (await d.execute(sql`SELECT contracted_days FROM quote_access_terms WHERE quote_id = ${quoteId} LIMIT 1`)) as unknown as [Array<Record<string, any>>];
    return r?.[0] ? Number(r[0].contracted_days) : null;
  } catch {
    return null;
  }
}

/**
 * Reserva CONFIRMADA y pago VERIFICADO → derecho de acceso, para retiros SIN convocatoria. La «confirmación previa de
 * disponibilidad» es el propio presupuesto: solo el equipo lo emite, con la fecha confirmada, tras aceptar la petición; que esté
 * PAGADO (pasarela autenticada o cobro manual verificado) es el pago confirmado. Con él:
 *  - la opción y el producto salen de la solicitud que originó el presupuesto (lead) y casan con las reglas ACTIVAS del catálogo;
 *  - una regla con duración mínima exige la duración CONTRATADA confirmada (opciones de duración variable: «5–6 días»): sin
 *    confirmación o con menos días NO se concede nunca, y el presupuesto queda «pendiente de confirmar duración»;
 *  - idempotente por presupuesto, regla y persona (la misma clave que cualquier otra operación): reintentos, barridos y
 *    recuperaciones manuales no duplican nada;
 *  - no duplica lo que ya concede una inscripción a convocatoria o un pedido de tienda del mismo presupuesto.
 * Nunca lanza por falta de esquema.
 */
export async function grantLearningFromQuote(quoteId: number, actor: { id: number | null; name: string | null } = { id: null, name: "sistema" }, now = Date.now()): Promise<QuoteFlowResult> {
  try {
    const d = await getDb();
    if (!d) return { status: "skipped", reason: "no_schema" };
    const [q] = ((await d.execute(sql`SELECT id, quoteNumber, status, total, paidAt, leadId FROM quotes WHERE id = ${quoteId}`)) as unknown as [Array<Record<string, any>>])[0] ?? [];
    if (!q) return { status: "skipped", reason: "not_found" };
    const status = effectiveQuoteStatus(String(q.status), q.paidAt) ?? String(q.status);
    if (!isQuotePaid(status)) return { status: "skipped", reason: "not_paid" };
    const cents = Math.round(Number(q.total ?? 0) * 100);
    if (!(cents > 0)) return { status: "skipped", reason: "no_amount" };
    const [enr] = ((await d.execute(sql`SELECT 1 FROM edition_enrollments WHERE quote_id = ${quoteId} LIMIT 1`).catch(() => [[]])) as unknown as [Array<Record<string, any>>]);
    if (enr?.length) return { status: "skipped", reason: "via_enrollment" };
    const [viaOrder] = (await d.execute(sql`SELECT 1 FROM learning_enrollments le JOIN reservations r ON r.id = le.order_id WHERE r.quote_id = ${quoteId} LIMIT 1`)) as unknown as [Array<Record<string, any>>];
    if (viaOrder?.length) return { status: "skipped", reason: "via_order" };
    const [lead] = ((await d.execute(sql`SELECT id, name, email, experienceId, variant_id FROM leads WHERE id = ${Number(q.leadId)}`)) as unknown as [Array<Record<string, any>>])[0] ?? [];
    if (!lead || lead.experienceId == null) return { status: "skipped", reason: "no_lead" };
    const experienceId = Number(lead.experienceId);
    const variantId = lead.variant_id == null ? null : Number(lead.variant_id);
    const matched = matchRules(await listRules(), experienceId, variantId);
    if (!matched.length) return { status: "skipped", reason: "no_rule" };
    const email = String(lead.email ?? "").trim();
    if (!email) return { status: "skipped", reason: "no_email" };
    const contractedDays = await contractedDaysOf(quoteId);
    const needing = matched.filter((r) => r.minContractedDays && (contractedDays == null || contractedDays < r.minContractedDays));
    if (needing.length === matched.length) return { status: "needs_terms", quoteId, minDays: Math.min(...needing.map((r) => r.minContractedDays as number)) };
    const [u] = (await d.execute(sql`SELECT id FROM users WHERE LOWER(email) = ${email.toLowerCase()} LIMIT 1`)) as unknown as [Array<Record<string, any>>];
    const acc = u?.[0] ? { userId: Number(u[0].id), invite: null, created: false } : await ensureAccount(String(lead.name || email), email);
    const res = await grantFromPayment({
      userId: acc.userId, clientId: null, experienceId, variantId, operation: { kind: "quote", id: quoteId }, quoteId,
      payment: { reference: String(q.quoteNumber || `quote:${quoteId}`), amountCents: cents, verifiedBy: actor.name || "sistema (presupuesto pagado)" }, actorUserId: actor.id, now, contractedDays,
    });
    const created = res.granted.filter((g) => g.created).length;
    const auto = String(await Promise.resolve(getSystemSetting("learning_invite_emails", "false"))).toLowerCase() === "true";
    if (created > 0 && auto) {
      if (acc.invite) await sendLearningInvitation(acc.invite);
      else await sendLearningAccessNotice({ userId: acc.userId, name: String(lead.name || email), email }, `quote:${q.quoteNumber ?? quoteId}`);
    }
    return { status: "granted", created, existing: res.granted.length - created, userId: acc.userId, blockedByTerms: res.blockedByTerms };
  } catch (e) {
    if (isMissingLearningSchema(e)) return { status: "skipped", reason: "no_schema" };
    console.error(JSON.stringify({ ctx: "Learning", event: "grant_from_quote_failed", quoteId, error: e instanceof Error ? e.name : "error", detail: e instanceof Error ? e.message.slice(0, 160) : undefined }));
    return { status: "skipped", reason: "error" };
  }
}

export interface PendingQuote { quoteId: number; quoteNumber: string; email: string | null; experienceId: number; variantId: number | null; needsTermsMinDays: number | null; paidAt: number | null }

/** Presupuestos PAGADOS con regla activa y aún sin derecho; los de duración variable llevan los días mínimos que falta confirmar. */
export async function pendingLearningQuotes(limit = 200): Promise<PendingQuote[]> {
  const d = await getDb();
  if (!d) return [];
  const rules = await listRules();
  if (!rules.some((r) => r.active)) return [];
  let rowsQ: Array<Record<string, any>> = [];
  try {
    [rowsQ] = (await d.execute(sql`SELECT q.id, q.quoteNumber, q.status, q.paidAt, l.email, l.experienceId, l.variant_id
      FROM quotes q JOIN leads l ON l.id = q.leadId
      WHERE l.experienceId IS NOT NULL AND (q.paidAt IS NOT NULL OR q.status IN ('pagado', 'convertido_reserva', 'facturado'))
        AND NOT EXISTS (SELECT 1 FROM learning_enrollments le WHERE le.source = 'payment' AND le.quote_id = q.id)
      ORDER BY q.id DESC LIMIT 1000`)) as unknown as [Array<Record<string, any>>];
  } catch (e) {
    if (isMissingLearningSchema(e)) return [];
    throw e;
  }
  const out: PendingQuote[] = [];
  for (const r of rowsQ) {
    if (!isQuotePaid(effectiveQuoteStatus(String(r.status), r.paidAt) ?? String(r.status))) continue;
    const variantId = r.variant_id == null ? null : Number(r.variant_id);
    const matched = matchRules(rules, Number(r.experienceId), variantId);
    if (!matched.length) continue;
    const days = await contractedDaysOf(Number(r.id));
    const needing = matched.filter((m) => m.minContractedDays && (days == null || days < m.minContractedDays));
    out.push({ quoteId: Number(r.id), quoteNumber: String(r.quoteNumber ?? ""), email: r.email ? String(r.email) : null, experienceId: Number(r.experienceId), variantId, needsTermsMinDays: needing.length === matched.length ? Math.min(...needing.map((m) => m.minContractedDays as number)) : null, paidAt: r.paidAt ? new Date(r.paidAt).getTime() : null });
    if (out.length >= limit) break;
  }
  return out;
}

/** Barrido (tarea programada y recuperación): concede lo pendiente de presupuestos pagados y reintenta los pedidos pendientes. Idempotente. */
export async function sweepLearningGrants(now = Date.now()): Promise<{ quotes: number; granted: number; needsTerms: number; orders: number }> {
  const out = { quotes: 0, granted: 0, needsTerms: 0, orders: 0 };
  for (const p of await pendingLearningQuotes(50)) {
    out.quotes++;
    if (p.needsTermsMinDays != null) { out.needsTerms++; continue; }
    const r = await grantLearningFromQuote(p.quoteId, { id: null, name: "sistema (barrido)" }, now);
    if (r.status === "granted" && r.created > 0) out.granted++;
  }
  for (const p of (await pendingLearningOrders(50)).filter((o) => o.paidAt != null)) {
    const r = await grantLearningFromOrder(p.merchantOrder, { id: null, name: "sistema (barrido)" }, now);
    if (r.status === "granted" && r.created > 0) out.orders++;
  }
  return out;
}

/** La administración confirma los días CONTRATADOS de un presupuesto (duración variable) y, si basta, se concede el derecho. */
export async function confirmQuoteContractedDays(quoteId: number, days: number, reason: string, actorUserId: number | null, now = Date.now()): Promise<QuoteFlowResult> {
  if (!Number.isInteger(days) || days < 1 || days > 365) throw new LearningRuleError("BAD_REQUEST", "Los días contratados deben ser un entero entre 1 y 365.");
  if (!reason.trim()) throw new LearningRuleError("REASON_REQUIRED", "Indica el motivo o el acuerdo con la persona.");
  const d = await getDb();
  if (!d) return { status: "skipped", reason: "no_schema" };
  await d.execute(sql`INSERT INTO quote_access_terms (quote_id, contracted_days, reason, confirmed_by, confirmed_at) VALUES (${quoteId}, ${days}, ${reason.trim().slice(0, 255)}, ${actorUserId}, ${now})
    ON DUPLICATE KEY UPDATE contracted_days = VALUES(contracted_days), reason = VALUES(reason), confirmed_by = VALUES(confirmed_by), confirmed_at = VALUES(confirmed_at)`);
  return grantLearningFromQuote(quoteId, { id: actorUserId, name: null }, now);
}

/**
 * Reembolso de UN suplemento (p. ej. Lifetime Access) sin tocar el resto del pedido: marca la línea como reembolsada y revoca
 * SOLO la matrícula que ese suplemento concedió. La matrícula del programa y las ampliaciones siguen intactas. Idempotente.
 * El reembolso del dinero se hace en Stripe; esto solo retira el derecho (decisión de administración, con motivo).
 */
export async function refundOrderSupplement(merchantOrder: string, group: string, reason: string, actorUserId: number | null): Promise<{ refunded: boolean; revokedEnrollmentId: number | null; alreadyRefunded: boolean }> {
  const m = await markSupplementRefunded(merchantOrder, group, reason);
  if (!m) throw new LearningRuleError("BAD_REQUEST", "Ese pedido no tiene ese suplemento.");
  let revoked: number | null = null;
  if (m.enrollmentId != null) {
    const { revokeEnrollment, getEnrollment } = await import("./learningDb");
    const e = await getEnrollment(m.enrollmentId);
    if (e && e.status !== "revoked") {
      await revokeEnrollment(m.enrollmentId, `Reembolso del suplemento «${group}»: ${reason}`.slice(0, 300), actorUserId as unknown as number);
      revoked = m.enrollmentId;
    }
  }
  return { refunded: true, revokedEnrollmentId: revoked, alreadyRefunded: m.alreadyRefunded };
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
export interface PendingLearningOrder { merchantOrder: string; reservationId: number; productId: number; variantId: number | null; email: string | null; paidAt: number | null }

async function pendingMainLearningOrders(limit = 200): Promise<PendingLearningOrder[]> {
  const d = await getDb();
  if (!d) return [];
  const rules = await listRules();
  if (!rules.some((r) => r.active)) return [];
  const [lines] = (await d.execute(sql`SELECT r.id, r.merchant_order, r.product_id, r.variant_id, r.customer_email, r.paid_at
    FROM reservations r WHERE r.status = 'paid' AND r.merchant_order IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM learning_enrollments le WHERE le.source = 'payment' AND le.idempotency_key NOT LIKE 'pay:order-supplement:%' AND le.order_id = r.id)
    ORDER BY r.id DESC LIMIT 2000`)) as unknown as [Array<Record<string, any>>];
  return lines
    .filter((l) => matchRules(rules, Number(l.product_id), l.variant_id == null ? null : Number(l.variant_id)).length > 0)
    .slice(0, limit)
    .map((l) => ({ merchantOrder: String(l.merchant_order), reservationId: Number(l.id), productId: Number(l.product_id), variantId: l.variant_id == null ? null : Number(l.variant_id), email: l.customer_email ? String(l.customer_email) : null, paidAt: l.paid_at == null ? null : Number(l.paid_at) }));
}

/** Pedidos pagados con un suplemento (p. ej. Lifetime Access) de regla activa y aún sin su matrícula. */
async function pendingSupplementOrders(): Promise<PendingLearningOrder[]> {
  const d = await getDb();
  if (!d) return [];
  const rules = await listRules();
  if (!rules.some((r) => r.active)) return [];
  try {
    const [lines] = (await d.execute(sql`SELECT s.merchant_order, s.reservation_id, s.product_id, s.variant_id, r.customer_email, r.paid_at
      FROM order_supplement_lines s JOIN reservations r ON r.id = s.reservation_id
      WHERE s.status = 'active' AND s.learning_enrollment_id IS NULL AND r.status = 'paid' ORDER BY s.id DESC LIMIT 500`)) as unknown as [Array<Record<string, any>>];
    return lines
      .filter((l) => matchExactRules(rules, Number(l.product_id), Number(l.variant_id)).length > 0)
      .map((l) => ({ merchantOrder: String(l.merchant_order), reservationId: Number(l.reservation_id), productId: Number(l.product_id), variantId: Number(l.variant_id), email: l.customer_email ? String(l.customer_email) : null, paidAt: l.paid_at == null ? null : Number(l.paid_at) }));
  } catch (e) {
    if (isMissingSupplementSchema(e)) return [];
    throw e;
  }
}

/** Pedidos pagados con regla activa y aún sin matrícula: los del programa y los de sus suplementos. */
export async function pendingLearningOrders(limit = 200): Promise<PendingLearningOrder[]> {
  const main = await pendingMainLearningOrders(limit);
  const seen = new Set(main.map((m) => m.merchantOrder));
  const extra = (await pendingSupplementOrders()).filter((m) => !seen.has(m.merchantOrder));
  return [...main, ...extra].slice(0, limit);
}

/**
 * Reembolso o disputa de un pedido de tienda: protege el acceso del alumno SIN borrar nada (la matrícula y su historial
 * quedan; solo cambia su estado, con motivo y rastro).
 *  - «revoke»: reembolso total o disputa perdida (el cobro ya no existe).
 *  - «suspend»: disputa abierta (reversible mientras se resuelve).
 *  - «reactivate»: disputa ganada; solo reabre las suspendidas por esta misma vía (motivo «Stripe: …»), nunca una suspensión manual.
 * Idempotente (repetirlo no cambia nada). Sin el esquema del LMS no hace nada. Un fallo real SÍ se propaga: el evento de
 * Stripe queda «failed» y se reintenta, para que el acceso no quede abierto en silencio.
 */
export async function changeLearningAccessForOrder(merchantOrder: string, action: "revoke" | "suspend" | "reactivate", reason: string): Promise<{ changed: number; extensionsFlagged?: number }> {
  try {
    const d = await getDb();
    if (!d) return { changed: 0 };
    const [list] = (await d.execute(sql`SELECT e.id AS id, e.status AS status FROM learning_enrollments e
      JOIN reservations r ON r.id = e.order_id WHERE e.source = 'payment' AND r.merchant_order = ${merchantOrder}`)) as unknown as [Array<Record<string, any>>];
    const { revokeEnrollment, suspendEnrollment, reactivateEnrollment } = await import("./learningDb");
    // Sin usuario que actúe: lo ejecuta el sistema por aviso firmado de la pasarela
    const actor = null as unknown as number;
    let changed = 0;
    for (const e of list) {
      const id = Number(e.id);
      const status = String(e.status);
      if (action === "revoke" && status !== "revoked") {
        await revokeEnrollment(id, reason, actor);
        changed++;
      } else if (action === "suspend" && status === "active") {
        await suspendEnrollment(id, reason, actor);
        changed++;
      } else if (action === "reactivate" && status === "suspended") {
        const [ev] = (await d.execute(sql`SELECT detail FROM learning_access_events WHERE enrollment_id = ${id} AND type = 'suspended' ORDER BY id DESC LIMIT 1`)) as unknown as [Array<Record<string, any>>];
        let why = "";
        try {
          const raw = ev?.[0]?.detail;
          why = String((typeof raw === "string" ? JSON.parse(raw) : raw)?.reason ?? "");
        } catch {
          why = "";
        }
        if (why.startsWith("Stripe:")) {
          await reactivateEnrollment(id, reason, actor);
          changed++;
        }
      }
    }
    // Todo el pedido reembolsado: sus suplementos pagados dejan de constar como activos (sus matrículas ya se revocaron arriba)
    if (action === "revoke") await markOrderSupplementsRefunded(merchantOrder, reason);
    // Ampliación de módulo ya aplicada de un pedido reembolsado: solo se REGISTRA y se avisa (no se retira acceso ni se tocan facturas)
    let extensionsFlagged = 0;
    if (action === "revoke") {
      // Solo constancia y aviso: un fallo aquí NO debe dejar sin revocar las matrículas del pedido ni reintentar el evento de la pasarela
      try {
        extensionsFlagged = await (await import("./learningExtensions")).flagExtensionRefund(merchantOrder, reason);
      } catch (e) {
        console.error(JSON.stringify({ ctx: "Learning", event: "extension_refund_flag_failed", merchantOrder, error: e instanceof Error ? e.name : "error" }));
      }
    }
    return { changed, extensionsFlagged };
  } catch (e) {
    if (isMissingLearningSchema(e)) return { changed: 0 };
    throw e;
  }
}
