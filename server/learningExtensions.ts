/**
 * Elephant LMS: ampliaciones individuales de acceso por módulo (+30 / +60 días) compradas desde el aula.
 *
 * Circuito: el alumno pide «Ampliar este módulo» → el SERVIDOR comprueba que el módulo es suyo, lee el precio de la variante
 * del catálogo de ampliaciones (ajuste `learning_extension_catalog`) y crea un pedido de tienda pendiente con la marca
 * `learning_extension` (matrícula, módulo, días y persona) → se paga por la pasarela de siempre → con el pago confirmado por
 * el aviso firmado, `finalizePaidShopOrder` llama a `applyExtensionsForOrder` → `extendModuleAccess` (idempotente).
 *
 * Reglas:
 *  - El precio y los días salen siempre del catálogo en servidor; el cliente solo elige 30 o 60.
 *  - Sin catálogo configurado no se ofrece nada y no se puede crear ningún pedido.
 *  - Un pedido no pagado (pendiente, fallido, cancelado) no amplía; uno reembolsado o con disputa perdida tampoco se aplica
 *    si llega tarde, y si ya estaba aplicado queda REGISTRADO y se avisa, sin retirar el acceso ni tocar facturas.
 *  - Nunca lanza desde el cierre del pedido: un fallo se registra en el historial del pedido y se puede reintentar.
 */
import { sql } from "drizzle-orm";
import { getDb } from "./db";
import { getSystemSetting } from "./config";
import { eurosToCents, variantUnitCents, assertChargeable } from "./shopCheckoutRules";
import { LearningError, extendModuleAccess, isMissingLearningSchema } from "./learningDb";
import { EXTENSION_CATALOG_SETTING, EXTENSION_LOG_ACTION, MODULE_EXTENSION_DAYS, parseExtensionConfig } from "../shared/learning";

type Row = Record<string, any>;
const n = (v: unknown) => Number(v ?? 0);

async function rowsOf(q: ReturnType<typeof sql>): Promise<Row[]> {
  const d = await getDb();
  if (!d) throw new Error("Base de datos no disponible");
  const [r] = (await d.execute(q)) as unknown as [Row[]];
  return Array.isArray(r) ? r : [];
}

const parseLog = (raw: unknown): any[] => {
  try {
    const v = typeof raw === "string" ? JSON.parse(raw) : raw;
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
};

export interface ExtensionOffer {
  days: 30 | 60;
  variantId: number;
  variantName: string;
  priceCents: number;
}
export interface ExtensionCatalog {
  experienceId: number;
  productName: string;
  offers: ExtensionOffer[];
}

/** Producto de ampliaciones configurado (o null). Barato: solo lee el ajuste. */
export async function extensionProductId(): Promise<number | null> {
  return parseExtensionConfig(await getSystemSetting(EXTENSION_CATALOG_SETTING, ""))?.experienceId ?? null;
}

/**
 * Catálogo de ampliaciones con el precio fijado por el servidor (variante del producto configurado). Una variante inexistente,
 * de otro producto, caducada o sin precio válido no se ofrece. Sin ajuste válido: lista vacía.
 */
export async function loadExtensionCatalog(): Promise<ExtensionCatalog | null> {
  const cfg = parseExtensionConfig(await getSystemSetting(EXTENSION_CATALOG_SETTING, ""));
  if (!cfg) return null;
  const { getExperienceById, getVariantsByExperience } = await import("./db");
  const product = await getExperienceById(cfg.experienceId);
  if (!product) return null;
  const baseCents = eurosToCents(String(product.basePrice ?? "0"));
  const variants = await getVariantsByExperience(cfg.experienceId);
  const today = new Intl.DateTimeFormat("sv", { timeZone: "Europe/Madrid" }).format(new Date());
  const offers: ExtensionOffer[] = [];
  for (const c of cfg.variants) {
    const v = variants.find((x) => x.id === c.variantId);
    if (!v || (v.validUntil && String(v.validUntil) < today)) continue;
    const priceCents = variantUnitCents(Number.isFinite(baseCents) ? baseCents : 0, v as any);
    if (!Number.isFinite(priceCents) || priceCents < 50) continue;
    offers.push({ days: c.days, variantId: v.id, variantName: v.name, priceCents });
  }
  return offers.length ? { experienceId: cfg.experienceId, productName: String(product.title), offers } : null;
}

export interface ExtensionCatalogAdminView {
  /** Ajuste guardado tal cual (o null si no hay ninguno válido). */
  config: { experienceId: number; variants: Array<{ days: 30 | 60; variantId: number }> } | null;
  /** Catálogo resuelto con precios (null si el ajuste no da ninguna oferta vendible). */
  catalog: ExtensionCatalog | null;
}

/** Lectura para la administración: el ajuste guardado y el catálogo resuelto con precios. */
export async function getExtensionCatalog(): Promise<ExtensionCatalogAdminView> {
  return { config: parseExtensionConfig(await getSystemSetting(EXTENSION_CATALOG_SETTING, "")), catalog: await loadExtensionCatalog() };
}

/**
 * Guarda el catálogo de ampliaciones (ajuste `learning_extension_catalog`) tras comprobar que el producto existe y que las variantes
 * de 30 y 60 días son suyas, están vigentes y tienen precio > 0. Los precios NO se escriben aquí: siguen saliendo de las variantes
 * (hoy, 33 € y 55 € en Quantum). No crea productos ni variantes ni cobra nada.
 */
export async function setExtensionCatalog(input: { experienceId: number; variants: { 30: number; 60: number } }, actorUserId: number | null): Promise<ExtensionCatalogAdminView> {
  const { getExperienceById, getVariantsByExperience } = await import("./db");
  const product = await getExperienceById(input.experienceId);
  if (!product) throw new LearningError("NOT_FOUND", "El producto de ampliaciones no existe.");
  if (input.variants[30] === input.variants[60]) throw new LearningError("BAD_REQUEST", "Las variantes de 30 y 60 días deben ser distintas.");
  const baseCents = eurosToCents(String(product.basePrice ?? "0"));
  const all = await getVariantsByExperience(input.experienceId, { includeExpired: true, includeSupplements: true });
  const today = new Intl.DateTimeFormat("sv", { timeZone: "Europe/Madrid" }).format(new Date());
  for (const days of MODULE_EXTENSION_DAYS) {
    const v = all.find((x) => x.id === input.variants[days]);
    if (!v) throw new LearningError("BAD_REQUEST", `La variante de ${days} días no pertenece a ese producto.`);
    if (v.validUntil && String(v.validUntil) < today) throw new LearningError("BAD_REQUEST", `La variante de ${days} días («${v.name}») está caducada.`);
    const priceCents = variantUnitCents(Number.isFinite(baseCents) ? baseCents : 0, v as any);
    if (!Number.isFinite(priceCents) || priceCents <= 0) throw new LearningError("BAD_REQUEST", `La variante de ${days} días («${v.name}») no tiene un precio mayor que cero.`);
  }
  const value = JSON.stringify({ experienceId: input.experienceId, variants: { "30": input.variants[30], "60": input.variants[60] } });
  const d = await getDb();
  if (!d) throw new Error("Base de datos no disponible");
  await d.execute(sql`INSERT INTO system_settings (\`key\`, value, value_type, category, label, description)
    VALUES (${EXTENSION_CATALOG_SETTING}, ${value}, 'json', 'learning', 'Catálogo de ampliaciones de módulo (Elephant Learning)', ${`Guardado desde la administración${actorUserId ? ` por el usuario ${actorUserId}` : ""}`})
    ON DUPLICATE KEY UPDATE value = VALUES(value)`);
  const { invalidateConfigCache } = await import("./config");
  invalidateConfigCache();
  return getExtensionCatalog();
}

/** Ofertas visibles para el alumno (solo días y precio). */
export async function extensionOffers(): Promise<Array<{ days: 30 | 60; priceCents: number }>> {
  const c = await loadExtensionCatalog().catch(() => null);
  return (c?.offers ?? []).map((o) => ({ days: o.days, priceCents: o.priceCents }));
}

export interface ExtensionTarget {
  enrollmentId: number;
  moduleId: number;
  moduleTitle: string;
  courseTitle: string;
  endsAt: number;
}

/**
 * Módulos que ESTA persona puede ampliar en un curso: matrículas suyas (nunca de otra persona), no revocadas ni suspendidas ni de
 * demostración, que incluyen el módulo y cuyo módulo caduca. Si hay varias matrículas, la de fin más tardío.
 */
export async function extendableModules(userId: number, courseId: number): Promise<Map<number, ExtensionTarget>> {
  const list = await rowsOf(sql`SELECT e.id, e.ends_at, e.status, e.source, c.title AS course_title FROM learning_enrollments e JOIN learning_courses c ON c.id = e.course_id
    WHERE e.user_id = ${userId} AND e.course_id = ${courseId} AND e.status IN ('active', 'expired') AND e.source <> 'demo' AND c.status = 'published'`);
  const out = new Map<number, ExtensionTarget>();
  for (const e of list) {
    const mods = await rowsOf(sql`SELECT em.module_id, em.ends_at, m.title FROM learning_enrollment_modules em JOIN learning_modules m ON m.id = em.module_id WHERE em.enrollment_id = ${n(e.id)}`);
    for (const m of mods) {
      const endsAt = m.ends_at != null ? n(m.ends_at) : e.ends_at != null ? n(e.ends_at) : null;
      if (endsAt == null) continue;
      const prev = out.get(n(m.module_id));
      if (!prev || endsAt > prev.endsAt) out.set(n(m.module_id), { enrollmentId: n(e.id), moduleId: n(m.module_id), moduleTitle: String(m.title), courseTitle: String(e.course_title), endsAt });
    }
  }
  return out;
}

export interface PreparedExtensionOrder {
  merchantOrder: string;
  amountCents: number;
  description: string;
  customerName: string;
  customerEmail: string;
  reused: boolean;
}

/**
 * Crea (o reutiliza, si ya hay uno pendiente igual) el pedido de ampliación de un módulo de LA PERSONA autenticada. No cobra
 * nada: devuelve lo necesario para abrir el pago. Rechaza ofertas no configuradas y módulos que no sean suyos.
 */
export async function prepareExtensionOrder(p: { userId: number; courseId: number; moduleId: number; days: number }): Promise<PreparedExtensionOrder> {
  if (!(MODULE_EXTENSION_DAYS as readonly number[]).includes(p.days)) throw new LearningError("BAD_REQUEST", "Solo se amplían 30 o 60 días.");
  const catalog = await loadExtensionCatalog();
  const offer = catalog?.offers.find((o) => o.days === p.days);
  if (!catalog || !offer) throw new LearningError("BAD_REQUEST", "Esta ampliación no está disponible.");
  const target = (await extendableModules(p.userId, p.courseId)).get(p.moduleId);
  if (!target) throw new LearningError("FORBIDDEN", "No puedes ampliar este módulo.");
  const [user] = await rowsOf(sql`SELECT name, email FROM users WHERE id = ${p.userId}`);
  const email = String(user?.email ?? "").trim();
  if (!email) throw new LearningError("BAD_REQUEST", "Tu cuenta no tiene correo: no se puede emitir el pedido.");
  assertChargeable(offer.priceCents);
  const name = String(user?.name || email);
  const description = `${catalog.productName} · ${offer.variantName} — ${target.moduleTitle}`.slice(0, 250);
  const mark = (e: any) => e?.action === EXTENSION_LOG_ACTION && n(e.userId) === p.userId && n(e.enrollmentId) === target.enrollmentId && n(e.moduleId) === p.moduleId && n(e.days) === p.days;

  // Un pedido pendiente igual (clics repetidos, pago reabierto) se reutiliza en lugar de crear otro
  const pending = await rowsOf(sql`SELECT merchant_order, amount_total, changes_log FROM reservations WHERE status = 'pending_payment' AND product_id = ${catalog.experienceId} AND variant_id = ${offer.variantId}
    AND LOWER(customer_email) = ${email.toLowerCase()} AND quote_id IS NULL ORDER BY id DESC LIMIT 20`);
  const same = pending.find((r) => n(r.amount_total) === offer.priceCents && parseLog(r.changes_log).some(mark));
  if (same) return { merchantOrder: String(same.merchant_order), amountCents: offer.priceCents, description, customerName: name, customerEmail: email, reused: true };

  const { generateMerchantOrder } = await import("./redsys");
  const { createReservation } = await import("./db");
  const { markOrderVariant } = await import("./orderVariant");
  const { appendOrderLogEntries } = await import("./shopOrdersDb");
  const merchantOrder = generateMerchantOrder();
  const today = new Intl.DateTimeFormat("sv", { timeZone: "Europe/Madrid" }).format(new Date());
  const created = await createReservation({
    productId: catalog.experienceId, productName: description, bookingDate: today, people: 1, amountTotal: offer.priceCents,
    customerName: name, customerEmail: email, merchantOrder, notes: `Ampliación de acceso de ${p.days} días: ${target.courseTitle} · ${target.moduleTitle}`,
  });
  await markOrderVariant(created.id, offer.variantId);
  await appendOrderLogEntries(merchantOrder, [{ ts: Date.now(), actor: `alumno:${p.userId}`, action: EXTENSION_LOG_ACTION, userId: p.userId, enrollmentId: target.enrollmentId, moduleId: p.moduleId, days: p.days, priceCents: offer.priceCents } as any]);
  return { merchantOrder, amountCents: offer.priceCents, description, customerName: name, customerEmail: email, reused: false };
}

export type ApplyExtensionResult = { reservationId: number; status: "applied" | "already_applied" | "skipped" | "failed"; reason?: string; newEndsAt?: number };

const REFUND_ACTIONS = new Set(["stripe_refund_full", "stripe_dispute_lost"]);

async function appendLog(reservationId: number, entry: Record<string, unknown>): Promise<void> {
  try {
    await (await getDb())?.execute(sql`UPDATE reservations SET changes_log = JSON_ARRAY_APPEND(COALESCE(changes_log, JSON_ARRAY()), '$', CAST(${JSON.stringify({ ts: Date.now(), actor: "sistema", ...entry })} AS JSON)) WHERE id = ${reservationId}`);
  } catch {
    /* el registro nunca debe provocar otro fallo */
  }
}

/**
 * Pedido PAGADO con líneas de ampliación → `extendModuleAccess`. Idempotente (la clave es pedido + módulo + días): un aviso o un
 * cierre repetidos no amplían dos veces. NUNCA lanza.
 */
export async function applyExtensionsForOrder(merchantOrder: string, now = Date.now()): Promise<ApplyExtensionResult[]> {
  const results: ApplyExtensionResult[] = [];
  try {
    const lines = await rowsOf(sql`SELECT id, product_id, variant_id, status, changes_log FROM reservations WHERE merchant_order = ${merchantOrder} ORDER BY id`);
    for (const l of lines) {
      const log = parseLog(l.changes_log);
      const mark = log.find((e) => e?.action === EXTENSION_LOG_ACTION);
      if (!mark) continue;
      const id = n(l.id);
      if (String(l.status) !== "paid") { results.push({ reservationId: id, status: "skipped", reason: "not_paid" }); continue; }
      if (log.some((e) => REFUND_ACTIONS.has(String(e?.action)))) { results.push({ reservationId: id, status: "skipped", reason: "refunded" }); continue; }
      try {
        const userId = n(mark.userId), enrollmentId = n(mark.enrollmentId), moduleId = n(mark.moduleId), days = n(mark.days);
        const cfg = parseExtensionConfig(await getSystemSetting(EXTENSION_CATALOG_SETTING, ""));
        // El producto y la variante de la línea deben ser los del catálogo para esos días: la marca sola no basta
        if (!cfg || cfg.experienceId !== n(l.product_id) || cfg.variants.find((v) => v.days === days)?.variantId !== n(l.variant_id)) throw new LearningError("CONFLICT", "La línea no coincide con el catálogo de ampliaciones.");
        const [enr] = await rowsOf(sql`SELECT user_id FROM learning_enrollments WHERE id = ${enrollmentId}`);
        if (!enr || n(enr.user_id) !== userId) throw new LearningError("FORBIDDEN", "La matrícula no es de la persona que hizo el pedido.");
        const r = await extendModuleAccess(enrollmentId, moduleId, days, { orderRef: merchantOrder, paymentRef: `pedido:${merchantOrder}` }, { userId: null }, now);
        if (r.applied) {
          await appendLog(id, { action: "learning_extension_applied", enrollmentId, moduleId, days, newEndsAt: r.newEndsAt });
          results.push({ reservationId: id, status: "applied", newEndsAt: r.newEndsAt });
        } else results.push({ reservationId: id, status: "already_applied", newEndsAt: r.newEndsAt });
      } catch (e) {
        const reason = e instanceof Error ? e.message.slice(0, 160) : "error";
        console.error(JSON.stringify({ ctx: "Learning", event: "extension_failed", merchantOrder, reason }));
        await appendLog(id, { action: "learning_extension_failed", reason });
        results.push({ reservationId: id, status: "failed", reason });
      }
    }
  } catch (e) {
    if (!isMissingLearningSchema(e)) console.error(JSON.stringify({ ctx: "Learning", event: "extension_order_error", merchantOrder, error: e instanceof Error ? e.name : "error" }));
  }
  return results;
}

/**
 * Reembolso total o disputa perdida de un pedido con ampliaciones YA aplicadas: deja constancia en el historial de la matrícula
 * (`module_extension_refunded`) para que la administración decida. NO retira el acceso ni toca facturas. Idempotente.
 */
export async function flagExtensionRefund(merchantOrder: string, reason: string): Promise<number> {
  try {
    const exts = await rowsOf(sql`SELECT idempotency_key, enrollment_id, module_id, days FROM learning_module_extensions WHERE order_ref = ${merchantOrder}`);
    let flagged = 0;
    for (const x of exts) {
      const events = await rowsOf(sql`SELECT detail FROM learning_access_events WHERE enrollment_id = ${n(x.enrollment_id)} AND type = 'module_extension_refunded'`);
      if (events.some((ev) => (typeof ev.detail === "string" ? JSON.parse(ev.detail) : ev.detail)?.key === x.idempotency_key)) continue;
      await (await getDb())?.execute(sql`INSERT INTO learning_access_events (enrollment_id, type, actor_user_id, detail, created_at)
        VALUES (${n(x.enrollment_id)}, 'module_extension_refunded', NULL, ${JSON.stringify({ key: x.idempotency_key, moduleId: n(x.module_id), days: n(x.days), merchantOrder, reason, note: "El acceso ampliado NO se ha retirado: decisión de la administración." })}, ${Date.now()})`);
      flagged++;
    }
    return flagged;
  } catch (e) {
    if (isMissingLearningSchema(e)) return 0;
    throw e;
  }
}
