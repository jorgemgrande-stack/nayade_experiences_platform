/**
 * Solicitud web estructurada (migración 0076): convocatoria y moneda del lead, modalidad de la inscripción (lógica de BD).
 *
 * Las columnas de 0076 NO están en el `leads` de Drizzle a propósito: `db.select().from(leads)` y `db.insert(leads)`
 * nombran todas las columnas del esquema, así que añadirlas ahí rompería cada lectura y cada alta de lead en una empresa
 * que aún no tenga la migración. Se escriben y se leen aquí, con SQL aparte y tolerando su ausencia
 * (ER_BAD_FIELD_ERROR / ER_NO_SUCH_TABLE → no se escribe nada y se lee null). Los datos constan además en el texto de
 * la solicitud, así que nunca se pierden.
 */
import { sql, type SQL } from "drizzle-orm";
import { getDb } from "./db";
import { isMissingEditionsSchema } from "./editionsDb";
import { buildLeadWebRequestView, type LeadRequestExtras, type LeadRequestFields, type LeadWebRequestView } from "../shared/leadWebRequest";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type Exec = Pick<Db, "execute">;

async function rows<T = Record<string, any>>(exec: Exec, q: SQL): Promise<T[]> {
  const [r] = (await exec.execute(q)) as unknown as [T[]];
  return Array.isArray(r) ? r : [];
}

/** Ejecuta una sentencia que depende de 0076/0070; sin esas columnas o tablas, no hace nada y devuelve false. */
async function tolerant<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (isMissingEditionsSchema(e)) return fallback;
    throw e;
  }
}

/** Convocatoria y moneda de la solicitud en el lead recién creado. */
export async function writeLeadRequestExtras(exec: Exec, leadId: number, extras: { editionId: number | null; currency: string | null }): Promise<boolean> {
  if (extras.editionId == null && extras.currency == null) return false;
  return tolerant(async () => {
    await exec.execute(sql`UPDATE leads SET edition_id = ${extras.editionId}, currency = ${extras.currency} WHERE id = ${leadId}`);
    return true;
  }, false);
}

/** Modalidad elegida en la inscripción recién creada. */
export async function writeEnrollmentVariant(exec: Exec, enrollmentId: number, variantId: number | null): Promise<boolean> {
  if (!enrollmentId || variantId == null) return false;
  return tolerant(async () => {
    await exec.execute(sql`UPDATE edition_enrollments SET variant_id = ${variantId} WHERE id = ${enrollmentId}`);
    return true;
  }, false);
}

/**
 * Bloque «Solicitud web» del lead para el CRM, o null si no es una solicitud de producto. La convocatoria sale de
 * `leads.edition_id` (0076) o, en leads anteriores o sin la migración, de su inscripción (`edition_enrollments.lead_id`).
 */
export async function getLeadWebRequest(lead: LeadRequestFields & { id: number }): Promise<LeadWebRequestView | null> {
  // Un lead que no viene de una solicitud de producto ni tiene sus campos no consulta nada más
  if (!buildLeadWebRequestView(lead)) return null;
  const d = await getDb();
  if (!d) return buildLeadWebRequestView(lead);
  const extra = await tolerant(async () => (await rows<{ edition_id: number | null; currency: string | null }>(d, sql`SELECT edition_id, currency FROM leads WHERE id = ${lead.id} LIMIT 1`))[0] ?? null, null);
  let editionId = extra?.edition_id != null ? Number(extra.edition_id) : null;
  if (editionId == null) {
    const [en] = await tolerant(() => rows<{ edition_id: number }>(d, sql`SELECT edition_id FROM edition_enrollments WHERE lead_id = ${lead.id} ORDER BY id ASC LIMIT 1`), []);
    editionId = en ? Number(en.edition_id) : null;
  }
  const extras: LeadRequestExtras = { currency: extra?.currency ?? null };
  if (editionId != null) {
    const [ed] = await tolerant(() => rows(d, sql`SELECT id, label, starts_at, ends_at, timezone, experience_id FROM product_editions WHERE id = ${editionId} LIMIT 1`), []);
    if (ed) extras.edition = { id: Number(ed.id), label: String(ed.label), startsAt: Number(ed.starts_at), endsAt: ed.ends_at == null ? null : Number(ed.ends_at), timezone: String(ed.timezone || "Europe/Madrid") };
  }
  if (lead.experienceId) {
    const [p] = await rows(d, sql`SELECT id, title, slug FROM experiences WHERE id = ${lead.experienceId} LIMIT 1`);
    if (p) extras.product = { id: Number(p.id), title: String(p.title), slug: p.slug ? String(p.slug) : null };
  }
  return buildLeadWebRequestView(lead, extras);
}
