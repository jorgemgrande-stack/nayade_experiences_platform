/**
 * Suplementos realmente pagados de un pedido (migración 0091). El nombre de línea y el importe ya los guarda el pedido; aquí
 * queda ADEMÁS el dato estructurado (qué suplemento, qué tramo, cuánto) que necesita el acceso digital (p. ej. Lifetime Access de
 * RECONNECT) y su reembolso por separado. Nunca impide vender: sin la tabla (migración sin aplicar) se registra y se sigue.
 *
 * También guarda el ÁMBITO de un suplemento: las opciones del programa con las que puede contratarse (`supplement_variant_scope`;
 * sin filas = sin restricción). Sin la tabla, no hay restricción.
 */
import { sql } from "drizzle-orm";
import { getDb } from "./db";
import type { SupplementLine } from "./supplements";

const rowsOf = (res: unknown): Array<Record<string, any>> => ((res as unknown as [Array<Record<string, any>>])[0] ?? []) as Array<Record<string, any>>;

export async function recordOrderSupplements(reservationId: number, merchantOrder: string, productId: number, lines: SupplementLine[], now = Date.now()): Promise<void> {
  if (!lines.length) return;
  try {
    const d = await getDb();
    if (!d) return;
    for (const l of lines) {
      await d.execute(sql`INSERT IGNORE INTO order_supplement_lines
        (reservation_id, merchant_order, product_id, variant_id, supplement_group, name, quantity, unit_cents, total_cents, status, created_at)
        VALUES (${reservationId}, ${merchantOrder}, ${productId}, ${l.variantId}, ${l.group}, ${l.name.slice(0, 255)}, ${l.quantity}, ${l.unitCents}, ${l.totalCents}, 'active', ${now})`);
    }
  } catch (e) {
    console.error(JSON.stringify({ ctx: "Pedido", event: "supplements_not_saved", reservationId, error: e instanceof Error ? e.name : "error" }));
  }
}

export interface PaidSupplementLine {
  id: number;
  reservationId: number;
  merchantOrder: string;
  productId: number;
  variantId: number;
  group: string;
  name: string;
  totalCents: number;
  status: string;
  enrollmentId: number | null;
  customerName: string | null;
  customerEmail: string | null;
}

/** Suplementos ACTIVOS (no reembolsados) de líneas PAGADAS de un pedido. */
export async function paidOrderSupplements(merchantOrder: string): Promise<PaidSupplementLine[]> {
  const d = await getDb();
  if (!d) return [];
  let r: Array<Record<string, any>>;
  try {
    r = rowsOf(await d.execute(sql`SELECT s.*, r.customer_name, r.customer_email FROM order_supplement_lines s
      JOIN reservations r ON r.id = s.reservation_id
      WHERE s.merchant_order = ${merchantOrder} AND s.status = 'active' AND r.status = 'paid' ORDER BY s.id`));
  } catch (e) {
    if (isMissingSupplementSchema(e)) return [];
    throw e;
  }
  return r.map((x) => ({
    id: Number(x.id), reservationId: Number(x.reservation_id), merchantOrder: String(x.merchant_order), productId: Number(x.product_id), variantId: Number(x.variant_id),
    group: String(x.supplement_group), name: String(x.name), totalCents: Number(x.total_cents), status: String(x.status),
    enrollmentId: x.learning_enrollment_id == null ? null : Number(x.learning_enrollment_id),
    customerName: x.customer_name == null ? null : String(x.customer_name), customerEmail: x.customer_email == null ? null : String(x.customer_email),
  }));
}

export function isMissingSupplementSchema(e: unknown): boolean {
  for (let x: any = e, depth = 0; x && depth < 5; x = x.cause, depth++) {
    if (x?.errno === 1146 || x?.code === "ER_NO_SUCH_TABLE") return true;
  }
  return false;
}

/** Enlaza el suplemento pagado con el derecho de acceso que concedió (para reembolsarlo por separado). */
export async function linkSupplementEnrollment(lineId: number, enrollmentId: number): Promise<void> {
  const d = await getDb();
  if (!d) return;
  await d.execute(sql`UPDATE order_supplement_lines SET learning_enrollment_id = ${enrollmentId} WHERE id = ${lineId} AND learning_enrollment_id IS NULL`);
}

/** Marca el suplemento como reembolsado (idempotente). Devuelve la matrícula que concedió, si la había. */
export async function markSupplementRefunded(merchantOrder: string, group: string, reason: string, now = Date.now()): Promise<{ lineId: number; enrollmentId: number | null; alreadyRefunded: boolean } | null> {
  const d = await getDb();
  if (!d) return null;
  const [line] = rowsOf(await d.execute(sql`SELECT id, status, learning_enrollment_id FROM order_supplement_lines WHERE merchant_order = ${merchantOrder} AND supplement_group = ${group} ORDER BY id LIMIT 1`));
  if (!line) return null;
  const enrollmentId = line.learning_enrollment_id == null ? null : Number(line.learning_enrollment_id);
  if (String(line.status) === "refunded") return { lineId: Number(line.id), enrollmentId, alreadyRefunded: true };
  await d.execute(sql`UPDATE order_supplement_lines SET status = 'refunded', refunded_at = ${now}, refund_reason = ${reason.slice(0, 255)} WHERE id = ${Number(line.id)} AND status = 'active'`);
  return { lineId: Number(line.id), enrollmentId, alreadyRefunded: false };
}

/** Toda la reserva reembolsada: sus suplementos activos pasan a «refunded» (los derechos los revoca la propia reserva). */
export async function markOrderSupplementsRefunded(merchantOrder: string, reason: string, now = Date.now()): Promise<void> {
  try {
    const d = await getDb();
    if (!d) return;
    await d.execute(sql`UPDATE order_supplement_lines SET status = 'refunded', refunded_at = ${now}, refund_reason = ${reason.slice(0, 255)} WHERE merchant_order = ${merchantOrder} AND status = 'active'`);
  } catch (e) {
    if (!isMissingSupplementSchema(e)) console.error(JSON.stringify({ ctx: "Pedido", event: "supplements_refund_mark_failed", merchantOrder, error: e instanceof Error ? e.name : "error" }));
  }
}

/** Opciones del programa con las que puede contratarse cada suplemento. Sin entrada (o sin tabla) = sin restricción. */
export async function supplementScopes(supplementVariantIds: number[]): Promise<Map<number, number[]>> {
  const out = new Map<number, number[]>();
  const ids = Array.from(new Set(supplementVariantIds.filter((n) => Number.isInteger(n) && n > 0)));
  if (!ids.length) return out;
  try {
    const d = await getDb();
    if (!d) return out;
    const r = rowsOf(await d.execute(sql`SELECT supplement_variant_id AS s, programme_variant_id AS p FROM supplement_variant_scope WHERE active = 1 AND supplement_variant_id IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})`));
    for (const x of r) out.set(Number(x.s), [...(out.get(Number(x.s)) ?? []), Number(x.p)]);
  } catch (e) {
    if (!isMissingSupplementSchema(e)) throw e;
  }
  return out;
}

export class SupplementScopeError extends Error {}

/**
 * Sustituye el ámbito de un suplemento (administración): las opciones del programa con las que puede contratarse. Se aplica a TODOS
 * los tramos del mismo grupo. Lista vacía = sin restricción. Las opciones deben ser del mismo producto y no ser suplementos.
 */
export async function setSupplementScope(supplementVariantId: number, programmeVariantIds: number[]): Promise<{ tiers: number; options: number }> {
  const d = await getDb();
  if (!d) throw new Error("Sin base de datos");
  const [sup] = rowsOf(await d.execute(sql`SELECT experienceId, supplementGroup FROM experience_variants WHERE id = ${supplementVariantId}`));
  if (!sup || !String(sup.supplementGroup ?? "").trim()) throw new SupplementScopeError("Esa fila no es un suplemento.");
  const options = Array.from(new Set(programmeVariantIds));
  for (const p of options) {
    const [opt] = rowsOf(await d.execute(sql`SELECT experienceId, supplementGroup FROM experience_variants WHERE id = ${p}`));
    if (!opt || Number(opt.experienceId) !== Number(sup.experienceId) || String(opt.supplementGroup ?? "").trim()) throw new SupplementScopeError("Las opciones del ámbito deben ser opciones del programa del mismo producto.");
  }
  const tiers = rowsOf(await d.execute(sql`SELECT id FROM experience_variants WHERE experienceId = ${Number(sup.experienceId)} AND supplementGroup = ${String(sup.supplementGroup)}`)).map((t) => Number(t.id));
  for (const t of tiers) {
    // El ámbito anterior se DESACTIVA (no se borra): queda constancia y la reversión es volver a activarlo
    await d.execute(sql`UPDATE supplement_variant_scope SET active = 0 WHERE supplement_variant_id = ${t}`);
    for (const p of options) await d.execute(sql`INSERT INTO supplement_variant_scope (supplement_variant_id, programme_variant_id, active) VALUES (${t}, ${p}, 1) ON DUPLICATE KEY UPDATE active = 1`);
  }
  return { tiers: tiers.length, options: options.length };
}
