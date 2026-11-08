/**
 * Contratos y firma electrónica (capacidad `contracts-esign`) — acceso a datos y reglas. Lógica pura en
 * shared/contractsEsign.ts y server/contractsEsign/content.ts; procedimientos en server/routers/contractsEsign.ts;
 * página pública de firma en server/netPublic/contractSign.ts (`/contrato/<token>`).
 *
 *  - Todo vive en la BD de la empresa (`getDb()` resuelve la de la petición). Tablas `esign_*` de
 *    db/migrations/0049_connect_contratos_firma, a propósito fuera de `drizzle/schema.ts` (como las de Life Net). Sin la
 *    migración, cada operación responde que el módulo aún no está preparado.
 *  - Plantillas con versión: cada cambio de título o texto sube la versión. El contrato guarda el texto ya rellenado
 *    (cliente del CRM, fecha, importe…) y la versión de la que sale; se edita solo en borrador.
 *  - Al enviarlo a firma (o firmarlo en el panel) se FIJA el contenido: JSON canónico con su huella SHA-256. Firmar
 *    comprueba antes que la huella sigue correspondiendo al contenido.
 *  - Firma simple, como el contrato de alquiler de Ski Net: aceptación expresa, nombre escrito, DNI/NIF opcional, fecha,
 *    IP, navegador y quién la recoge (`user:<id>` en el panel, `public:link:<id>` con el enlace).
 *  - Enlace de firma (`esign_links`): token opaco (solo su huella, ligada a la empresa), caduca y es de UN SOLO USO
 *    (firmar o rechazar lo pasa a `used`). Un enlace activo por contrato; emitir otro revoca el anterior.
 *  - Evidencias (`esign_events`): cada paso con fecha, quién, IP y navegador. El PDF firmado se genera al firmar (si
 *    hay Chromium) o al descargarlo por primera vez, y se guarda con su huella (`esign_documents`).
 *  - Nada se borra: un contrato se anula; una plantilla se desactiva.
 */
import { TRPCError } from "@trpc/server";
import { sql, type SQL } from "drizzle-orm";
import { getDb } from "./db";
import { brandName } from "./tenantBrand";
import { TOKEN_RE, newToken, tokenHash } from "./netPublic/links";
import {
  CONTRACT_STATUSES,
  ESIGN_LIMITS,
  checkSigner,
  formatAmount,
  formatLongDay,
  isLinkExpired,
  linkHours,
  nextStatus,
  renderTemplate,
  templateProblem,
  type ContractStatus,
} from "../shared/contractsEsign";
import { contentHash, hasBlanks, sha256, signRequestEmail, signedContractHtml, verifiedContent, type EvidenceEvent, type SignedContent } from "./contractsEsign/content";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type Exec = Pick<Db, "execute">;

export const ESIGN_NOT_INSTALLED_MESSAGE =
  "Contratos y firma aún no está preparado en tu empresa: falta aplicar la actualización 0049_connect_contratos_firma de su base de datos. Inténtalo de nuevo en unos minutos.";

const bad = (message: string) => new TRPCError({ code: "BAD_REQUEST", message });
const conflict = (message: string) => new TRPCError({ code: "CONFLICT", message });
const notFound = (what: string) => new TRPCError({ code: "NOT_FOUND", message: `${what} no existe o ya no está disponible.` });
const num = (v: unknown) => Number(v ?? 0);
const numOrNull = (v: unknown) => (v == null ? null : Number(v));
const str = (v: unknown) => (v == null ? null : String(v));
const oneLine = (v: string) => v.replace(/[\r\n\t]+/g, " ").trim();

/** Falta la migración 0049 (o una de sus tablas) en esta empresa. */
export function isMissingEsignSchema(e: unknown): boolean {
  for (let x: any = e, i = 0; x && i < 6; x = x.cause, i++) {
    if ((x.code === "ER_NO_SUCH_TABLE" || x.errno === 1146) && /esign_/.test(String(x.sqlMessage ?? x.message ?? ""))) return true;
  }
  return false;
}

async function database(): Promise<Db> {
  const d = await getDb();
  if (!d) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Base de datos no disponible" });
  return d;
}

async function run<T>(fn: (d: Db) => Promise<T>): Promise<T> {
  try {
    return await fn(await database());
  } catch (e) {
    if (isMissingEsignSchema(e)) throw new TRPCError({ code: "PRECONDITION_FAILED", message: ESIGN_NOT_INSTALLED_MESSAGE, cause: e });
    throw e;
  }
}

async function rows<T = any>(exec: Exec, q: SQL): Promise<T[]> {
  const [r] = (await exec.execute(q)) as unknown as [T[]];
  return r;
}
async function header(exec: Exec, q: SQL): Promise<{ affectedRows: number; insertId: number }> {
  const [r] = (await exec.execute(q)) as unknown as [{ affectedRows: number; insertId: number }];
  return { affectedRows: Number(r.affectedRows ?? 0), insertId: Number(r.insertId ?? 0) };
}

/** Fecha de hoy en Madrid (AAAA-MM-DD). */
export const todayMadrid = (now = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);

const company = () => {
  try {
    return brandName() || "La empresa";
  } catch {
    return "La empresa";
  }
};

export interface Evidence {
  ip: string | null;
  userAgent: string | null;
}
const NO_EVIDENCE: Evidence = { ip: null, userAgent: null };
const clip = (e: Evidence): Evidence => ({ ip: e.ip ? e.ip.slice(0, 64) : null, userAgent: e.userAgent ? e.userAgent.slice(0, 300) : null });

async function logEvent(exec: Exec, contractId: number, event: string, actor: string, ev: Evidence = NO_EVIDENCE, extra: { contentHash?: string | null; detail?: string | null } = {}, now = Date.now()) {
  const e = clip(ev);
  await exec.execute(sql`INSERT INTO esign_events (contract_id, event, actor, ip, user_agent, content_hash, detail, created_at)
    VALUES (${contractId}, ${event}, ${actor.slice(0, 100)}, ${e.ip}, ${e.userAgent}, ${extra.contentHash ?? null}, ${extra.detail ? extra.detail.slice(0, 500) : null}, ${now})`);
}

// ─── Plantillas ──────────────────────────────────────────────────────────────

export interface Template {
  id: number;
  title: string;
  body: string;
  version: number;
  isActive: boolean;
  updatedAt: number;
}
const toTemplate = (r: any): Template => ({ id: num(r.id), title: String(r.title), body: String(r.body), version: num(r.version), isActive: num(r.is_active) === 1, updatedAt: num(r.updated_at) });

export function listTemplates(includeInactive = false): Promise<Template[]> {
  return run(async (d) =>
    (await rows(d, includeInactive ? sql`SELECT * FROM esign_templates ORDER BY is_active DESC, title, id` : sql`SELECT * FROM esign_templates WHERE is_active = 1 ORDER BY title, id`)).map(toTemplate),
  );
}

export function saveTemplate(input: { id?: number; title: string; body: string }, userId: number, now = Date.now()): Promise<Template> {
  const title = oneLine(input.title);
  const body = input.body.replace(/\r\n/g, "\n").trim();
  const p = templateProblem({ title, body });
  if (p) throw bad(p);
  return run(async (d) => {
    if (input.id == null) {
      const r = await header(d, sql`INSERT INTO esign_templates (title, body, version, is_active, created_by, created_at, updated_by, updated_at)
        VALUES (${title}, ${body}, 1, 1, ${userId}, ${now}, ${userId}, ${now})`);
      return toTemplate((await rows(d, sql`SELECT * FROM esign_templates WHERE id = ${r.insertId}`))[0]);
    }
    const [cur] = await rows(d, sql`SELECT * FROM esign_templates WHERE id = ${input.id}`);
    if (!cur) throw notFound("La plantilla");
    // Solo sube la versión si cambia lo que se firma (título o texto)
    if (String(cur.title) !== title || String(cur.body) !== body) {
      await d.execute(sql`UPDATE esign_templates SET title = ${title}, body = ${body}, version = version + 1, updated_by = ${userId}, updated_at = ${now} WHERE id = ${input.id}`);
    }
    return toTemplate((await rows(d, sql`SELECT * FROM esign_templates WHERE id = ${input.id}`))[0]);
  });
}

export function setTemplateActive(id: number, active: boolean, userId: number, now = Date.now()): Promise<{ ok: true }> {
  return run(async (d) => {
    const r = await header(d, sql`UPDATE esign_templates SET is_active = ${active ? 1 : 0}, updated_by = ${userId}, updated_at = ${now} WHERE id = ${id}`);
    if (!r.affectedRows) throw notFound("La plantilla");
    return { ok: true as const };
  });
}

// ─── Clientes del CRM ────────────────────────────────────────────────────────

export interface ClientLite {
  id: number;
  name: string;
  email: string | null;
  nif: string | null;
  company: string | null;
}
const toClient = (r: any): ClientLite => ({ id: num(r.id), name: String(r.name ?? ""), email: str(r.email) || null, nif: str(r.nif) || null, company: str(r.company) || null });

export function searchClients(q: string): Promise<ClientLite[]> {
  const term = q.trim().slice(0, 100);
  return run(async (d) => {
    const like = `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const list = term
      ? await rows(d, sql`SELECT id, name, email, nif, company FROM clients WHERE name LIKE ${like} OR email LIKE ${like} OR nif LIKE ${like} ORDER BY name LIMIT 20`)
      : await rows(d, sql`SELECT id, name, email, nif, company FROM clients ORDER BY id DESC LIMIT 20`);
    return list.map(toClient);
  });
}

// ─── Contratos ───────────────────────────────────────────────────────────────

export interface ContractRow {
  id: number;
  templateId: number | null;
  templateVersion: number | null;
  clientId: number;
  quoteId: number | null;
  reservationId: number | null;
  title: string;
  body: string;
  amount: string | null;
  contractDate: string;
  customerName: string;
  customerEmail: string | null;
  status: ContractStatus;
  contentJson: string | null;
  contentHash: string | null;
  sentAt: number | null;
  signerName: string | null;
  signerTaxId: string | null;
  signedAt: number | null;
  signedIp: string | null;
  signedUserAgent: string | null;
  signedBy: string | null;
  signedMethod: "panel" | "link" | null;
  closedAt: number | null;
  closedBy: string | null;
  closeReason: string | null;
  createdBy: number;
  createdAt: number;
  updatedAt: number;
}
const toContract = (r: any): ContractRow => ({
  id: num(r.id),
  templateId: numOrNull(r.template_id),
  templateVersion: numOrNull(r.template_version),
  clientId: num(r.client_id),
  quoteId: numOrNull(r.quote_id),
  reservationId: numOrNull(r.reservation_id),
  title: String(r.title),
  body: String(r.body),
  amount: r.amount == null ? null : Number(r.amount).toFixed(2),
  contractDate: String(r.contract_date),
  customerName: String(r.customer_name),
  customerEmail: str(r.customer_email),
  status: (CONTRACT_STATUSES as readonly string[]).includes(String(r.status)) ? (r.status as ContractStatus) : "draft",
  contentJson: str(r.content_json),
  contentHash: str(r.content_hash),
  sentAt: numOrNull(r.sent_at),
  signerName: str(r.signer_name),
  signerTaxId: str(r.signer_tax_id),
  signedAt: numOrNull(r.signed_at),
  signedIp: str(r.signed_ip),
  signedUserAgent: str(r.signed_user_agent),
  signedBy: str(r.signed_by),
  signedMethod: r.signed_method === "panel" || r.signed_method === "link" ? r.signed_method : null,
  closedAt: numOrNull(r.closed_at),
  closedBy: str(r.closed_by),
  closeReason: str(r.close_reason),
  createdBy: num(r.created_by),
  createdAt: num(r.created_at),
  updatedAt: num(r.updated_at),
});

async function contractRow(exec: Exec, id: number): Promise<ContractRow> {
  const [r] = await rows(exec, sql`SELECT * FROM esign_contracts WHERE id = ${id}`);
  if (!r) throw notFound("El contrato");
  return toContract(r);
}

export function listContracts(f: { status?: ContractStatus; q?: string } = {}) {
  return run(async (d) => {
    const where: SQL[] = [];
    if (f.status) where.push(sql`status = ${f.status}`);
    const term = (f.q ?? "").trim().slice(0, 100);
    if (term) {
      const like = `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      where.push(sql`(customer_name LIKE ${like} OR title LIKE ${like} OR customer_email LIKE ${like})`);
    }
    const cond = where.length ? sql`WHERE ${sql.join(where, sql` AND `)}` : sql``;
    const list = await rows(d, sql`SELECT id, title, customer_name, customer_email, amount, status, contract_date, sent_at, signed_at, closed_at, created_at
      FROM esign_contracts ${cond} ORDER BY id DESC LIMIT 200`);
    return list.map((r) => ({
      id: num(r.id),
      title: String(r.title),
      customerName: String(r.customer_name),
      customerEmail: str(r.customer_email),
      amount: r.amount == null ? null : Number(r.amount).toFixed(2),
      status: String(r.status) as ContractStatus,
      contractDate: String(r.contract_date),
      sentAt: numOrNull(r.sent_at),
      signedAt: numOrNull(r.signed_at),
      closedAt: numOrNull(r.closed_at),
      createdAt: num(r.created_at),
    }));
  });
}

async function activeLinkOf(exec: Exec, contractId: number, now = Date.now()) {
  const [l] = await rows(exec, sql`SELECT id, expires_at, created_at FROM esign_links WHERE contract_id = ${contractId} AND status = 'active' LIMIT 1`);
  if (!l || isLinkExpired(num(l.expires_at), now)) return null;
  return { id: num(l.id), expiresAt: num(l.expires_at), createdAt: num(l.created_at) };
}

export function getContract(id: number) {
  return run(async (d) => {
    const c = await contractRow(d, id);
    const events = (await rows(d, sql`SELECT * FROM esign_events WHERE contract_id = ${id} ORDER BY id`)).map((e) => ({
      id: num(e.id),
      event: String(e.event),
      actor: String(e.actor),
      ip: str(e.ip),
      userAgent: str(e.user_agent),
      contentHash: str(e.content_hash),
      detail: str(e.detail),
      createdAt: num(e.created_at),
    }));
    const link = c.status === "sent" ? await activeLinkOf(d, id) : null;
    const [doc] = await rows(d, sql`SELECT pdf_hash, created_at FROM esign_documents WHERE contract_id = ${id}`);
    const { contentJson: _json, ...rest } = c;
    return { ...rest, blanks: hasBlanks(c.body), link, pdf: doc ? { hash: String(doc.pdf_hash), createdAt: num(doc.created_at) } : null, events };
  });
}

/** Valores de las variables a partir del cliente del CRM y los datos del contrato. */
function valuesFor(client: any, x: { contractDate: string; amount: number | null; title: string }) {
  const address = [client.address, client.postalCode, client.city].map((v: unknown) => (v == null ? "" : String(v).trim())).filter(Boolean).join(", ");
  return {
    "cliente.nombre": str(client.name),
    "cliente.email": str(client.email),
    "cliente.nif": str(client.nif),
    "cliente.telefono": str(client.phone),
    "cliente.direccion": address,
    "cliente.empresa": str(client.company),
    "empresa.nombre": company(),
    fecha: formatLongDay(x.contractDate),
    importe: formatAmount(x.amount),
    "contrato.titulo": x.title,
  };
}

export function createContract(
  input: { templateId: number; clientId: number; amount?: number | null; contractDate?: string | null; quoteId?: number | null; reservationId?: number | null },
  userId: number,
  now = Date.now(),
): Promise<{ id: number; missing: string[] }> {
  if (input.amount != null && (!Number.isFinite(input.amount) || input.amount < 0 || input.amount > 99_999_999)) throw bad("El importe no es válido.");
  return run((d) =>
    d.transaction(async (tx) => {
      const [t] = await rows(tx, sql`SELECT * FROM esign_templates WHERE id = ${input.templateId} AND is_active = 1`);
      if (!t) throw notFound("La plantilla");
      const [client] = await rows(tx, sql`SELECT id, name, email, phone, company, nif, address, city, postalCode FROM clients WHERE id = ${input.clientId}`);
      if (!client) throw notFound("El cliente");
      if (input.quoteId != null && !(await rows(tx, sql`SELECT id FROM quotes WHERE id = ${input.quoteId}`)).length) throw notFound("El presupuesto");
      if (input.reservationId != null && !(await rows(tx, sql`SELECT id FROM reservations WHERE id = ${input.reservationId}`)).length) throw notFound("La reserva");
      const contractDate = input.contractDate && /^\d{4}-\d{2}-\d{2}$/.test(input.contractDate) ? input.contractDate : todayMadrid(new Date(now));
      const amount = input.amount ?? null;
      const titleR = renderTemplate(String(t.title), valuesFor(client, { contractDate, amount, title: String(t.title) }));
      const title = oneLine(titleR.text).slice(0, ESIGN_LIMITS.titleMax);
      const bodyR = renderTemplate(String(t.body), valuesFor(client, { contractDate, amount, title }));
      const r = await header(tx, sql`INSERT INTO esign_contracts (template_id, template_version, client_id, quote_id, reservation_id, title, body, amount, contract_date,
          customer_name, customer_email, status, created_by, created_at, updated_at)
        VALUES (${num(t.id)}, ${num(t.version)}, ${num(client.id)}, ${input.quoteId ?? null}, ${input.reservationId ?? null}, ${title}, ${bodyR.text},
          ${amount == null ? null : amount.toFixed(2)}, ${contractDate}, ${String(client.name).slice(0, 256)}, ${str(client.email)?.slice(0, 256) || null}, 'draft', ${userId}, ${now}, ${now})`);
      await logEvent(tx, r.insertId, "created", `user:${userId}`, NO_EVIDENCE, { detail: `Plantilla «${oneLine(String(t.title)).slice(0, 120)}» v${num(t.version)}` }, now);
      return { id: r.insertId, missing: Array.from(new Set([...titleR.missing, ...bodyR.missing])) };
    }),
  );
}

export function updateDraft(input: { id: number; title: string; body: string; amount?: number | null }, userId: number, now = Date.now()): Promise<{ ok: true }> {
  const title = oneLine(input.title);
  const body = input.body.replace(/\r\n/g, "\n").trim();
  if (title.length < 2 || title.length > ESIGN_LIMITS.titleMax) throw bad("Escribe el título del contrato (como mucho 200 caracteres).");
  if (body.length < ESIGN_LIMITS.bodyMin || body.length > ESIGN_LIMITS.bodyMax) throw bad("El texto del contrato no es válido (demasiado corto o demasiado largo).");
  if (input.amount != null && (!Number.isFinite(input.amount) || input.amount < 0 || input.amount > 99_999_999)) throw bad("El importe no es válido.");
  return run(async (d) => {
    const c = await contractRow(d, input.id);
    const n = nextStatus(c.status, "edit");
    if (!n.ok) throw conflict(n.error);
    const amount = input.amount === undefined ? c.amount : input.amount == null ? null : input.amount.toFixed(2);
    const r = await header(d, sql`UPDATE esign_contracts SET title = ${title}, body = ${body}, amount = ${amount}, updated_at = ${now} WHERE id = ${input.id} AND status = 'draft'`);
    if (!r.affectedRows) throw conflict("El contrato ya no está en borrador.");
    await logEvent(d, input.id, "edited", `user:${userId}`, NO_EVIDENCE, {}, now);
    return { ok: true as const };
  });
}

/**
 * Fija el contenido que se firma (si aún no lo estaba) y devuelve su huella. Una vez fijado no cambia: se comprueba que
 * la huella guardada sigue correspondiendo al contenido.
 */
async function freeze(exec: Exec, c: ContractRow, now: number): Promise<{ content: SignedContent; hash: string }> {
  if (c.contentHash) {
    const content = verifiedContent(c.contentJson, c.contentHash);
    if (!content) throw conflict("El contrato no coincide con su huella: no se puede firmar.");
    return { content, hash: c.contentHash };
  }
  if (hasBlanks(c.body) || hasBlanks(c.title)) throw bad("Faltan datos por completar en el contrato (________). Edita el borrador antes de enviarlo o firmarlo.");
  const content: SignedContent = {
    contractId: c.id,
    company: company(),
    title: c.title,
    body: c.body,
    customerName: c.customerName,
    customerEmail: c.customerEmail,
    amount: c.amount,
    contractDate: c.contractDate,
    templateId: c.templateId,
    templateVersion: c.templateVersion,
  };
  const hash = contentHash(content);
  const r = await header(exec, sql`UPDATE esign_contracts SET content_json = ${JSON.stringify(content)}, content_hash = ${hash}, updated_at = ${now}
    WHERE id = ${c.id} AND status = 'draft' AND content_hash IS NULL`);
  if (!r.affectedRows) throw conflict("El contrato ha cambiado mientras tanto. Vuelve a abrirlo.");
  return { content, hash };
}

// ─── Enlaces de firma ────────────────────────────────────────────────────────

export interface EsignLink {
  id: number;
  contractId: number;
  status: "active" | "revoked" | "used";
  expiresAt: number;
}
const toLink = (r: any): EsignLink => ({ id: num(r.id), contractId: num(r.contract_id), status: r.status, expiresAt: num(r.expires_at) });

async function revokeActive(exec: Exec, contractId: number, actor: string, now: number): Promise<number> {
  return (await header(exec, sql`UPDATE esign_links SET status = 'revoked', revoked_at = ${now}, revoked_by = ${actor.slice(0, 100)} WHERE contract_id = ${contractId} AND status = 'active'`)).affectedRows;
}

/**
 * Enlace de un token: activo y sin caducar. Cualquier otro caso (formato, inexistente, de otra empresa, revocado, usado
 * o caducado) es null, sin distinguir: la página pública responde siempre lo mismo.
 */
export async function resolveEsignLink(token: unknown, now = Date.now()): Promise<EsignLink | null> {
  if (typeof token !== "string" || !TOKEN_RE.test(token)) return null;
  return run(async (d) => {
    const [r] = await rows(d, sql`SELECT * FROM esign_links WHERE token_hash = ${tokenHash(token)} LIMIT 1`);
    if (!r) return null;
    const l = toLink(r);
    if (l.status !== "active" || isLinkExpired(l.expiresAt, now)) return null;
    return l;
  });
}

/** Consume un enlace de un solo uso. Devuelve si lo consumió ESTA llamada (dos a la vez: solo una). */
async function consume(exec: Exec, linkId: number, now: number): Promise<boolean> {
  return (await header(exec, sql`UPDATE esign_links SET status = 'used', used_at = ${now} WHERE id = ${linkId} AND status = 'active' AND expires_at > ${now}`)).affectedRows === 1;
}

export interface SendDeps {
  sendMail: (m: { to: string; subject: string; html: string; text: string; idempotencyKey: string }) => Promise<boolean>;
  publicUrl: (path: string) => string;
}
async function defaultSendDeps(): Promise<SendDeps> {
  const [{ sendEmail }, { publicUrl }] = await Promise.all([import("./mailer"), import("./netPublic/html")]);
  return {
    sendMail: (m) => sendEmail({ ...m, category: "contract_invitation" }).catch(() => false),
    publicUrl,
  };
}

/**
 * Envía a firma: fija el contenido, emite un enlace nuevo (revoca el anterior) y, si se pide y hay correo, se lo manda
 * al cliente con el correo transaccional de la empresa. La URL con el token solo se devuelve aquí, una vez.
 */
export async function sendForSignature(
  input: { id: number; hours?: number | null; email: boolean },
  userId: number,
  deps?: SendDeps,
  now = Date.now(),
): Promise<{ url: string; expiresAt: number; mailed: boolean; mailError: string | null }> {
  const dep = deps ?? (await defaultSendDeps());
  const actor = `user:${userId}`;
  const { url, expiresAt, c, hash } = await run((d) =>
    d.transaction(async (tx) => {
      const c = await contractRow(tx, input.id);
      const n = nextStatus(c.status, "send");
      if (!n.ok) throw conflict(n.error);
      const { hash } = await freeze(tx, c, now);
      await header(tx, sql`UPDATE esign_contracts SET status = 'sent', sent_at = COALESCE(sent_at, ${now}), updated_at = ${now} WHERE id = ${c.id} AND status IN ('draft', 'sent')`);
      await revokeActive(tx, c.id, actor, now);
      const token = newToken();
      const expiresAt = now + linkHours(input.hours) * 3_600_000;
      const l = await header(tx, sql`INSERT INTO esign_links (contract_id, token_hash, status, expires_at, created_by, created_at) VALUES (${c.id}, ${tokenHash(token)}, 'active', ${expiresAt}, ${actor}, ${now})`);
      if (c.status === "draft") await logEvent(tx, c.id, "sent", actor, NO_EVIDENCE, { contentHash: hash }, now);
      await logEvent(tx, c.id, "link_issued", actor, NO_EVIDENCE, { contentHash: hash, detail: `Enlace ${l.insertId}, caduca ${new Date(expiresAt).toISOString()}` }, now);
      return { url: dep.publicUrl(`/contrato/${token}`), expiresAt, c, hash, linkId: l.insertId };
    }),
  );
  if (!input.email) return { url, expiresAt, mailed: false, mailError: null };
  if (!c.customerEmail) return { url, expiresAt, mailed: false, mailError: "El cliente no tiene correo electrónico: copia el enlace y envíaselo tú." };
  const m = signRequestEmail({ company: company(), customerName: c.customerName, title: c.title, amount: c.amount, url, expiresAt, recipient: c.customerEmail });
  const mailed = await dep.sendMail({ to: c.customerEmail, subject: m.subject, html: m.html, text: m.text, idempotencyKey: `esign:link:${c.id}:${hash.slice(0, 16)}:${expiresAt}` });
  await run((d) => logEvent(d, c.id, mailed ? "mail_sent" : "mail_failed", actor, NO_EVIDENCE, { detail: c.customerEmail }));
  return { url, expiresAt, mailed, mailError: mailed ? null : "No se pudo enviar el correo. Copia el enlace y envíaselo tú." };
}

export function revokeSignLink(id: number, userId: number, now = Date.now()): Promise<{ revoked: boolean }> {
  return run(async (d) => {
    await contractRow(d, id);
    const n = await revokeActive(d, id, `user:${userId}`, now);
    if (n) await logEvent(d, id, "link_revoked", `user:${userId}`, NO_EVIDENCE, {}, now);
    return { revoked: n > 0 };
  });
}

// ─── Firma, rechazo y anulación ──────────────────────────────────────────────

export interface PdfDeps {
  htmlToPdf: (html: string) => Promise<Buffer>;
}
const defaultPdf: PdfDeps = { htmlToPdf: async (h) => (await import("./pdfGenerator")).htmlToPdf(h) };

/** Registra la firma (panel o enlace). Solo firma una llamada: la que cambia el estado. */
async function recordSignature(
  exec: Exec,
  c: ContractRow,
  signer: { signerName: string; signerTaxId: string | null },
  ev: Evidence,
  method: "panel" | "link",
  actor: string,
  now: number,
): Promise<{ hash: string } | null> {
  const n = nextStatus(c.status, "sign");
  if (!n.ok) throw conflict(n.error);
  const { hash } = await freeze(exec, c, now);
  const e = clip(ev);
  const r = await header(exec, sql`UPDATE esign_contracts SET status = 'signed', signer_name = ${signer.signerName}, signer_tax_id = ${signer.signerTaxId}, signed_at = ${now},
      signed_ip = ${e.ip}, signed_user_agent = ${e.userAgent}, signed_by = ${actor.slice(0, 100)}, signed_method = ${method}, updated_at = ${now}
    WHERE id = ${c.id} AND status IN ('draft', 'sent') AND content_hash = ${hash}`);
  if (!r.affectedRows) return null;
  await logEvent(exec, c.id, "signed", actor, ev, { contentHash: hash, detail: `${signer.signerName}${signer.signerTaxId ? ` · ${signer.signerTaxId}` : ""} · ${method === "link" ? "enlace" : "panel"}` }, now);
  return { hash };
}

/** PDF firmado: el guardado o, si aún no lo hay, se genera y se guarda (con su huella y un evento). */
async function ensurePdf(id: number, pdf: PdfDeps, now = Date.now(), generate = true): Promise<{ data: Buffer; hash: string }> {
  return run(async (d) => {
    const [doc] = await rows(d, sql`SELECT pdf, pdf_hash FROM esign_documents WHERE contract_id = ${id}`);
    if (doc) return { data: Buffer.from(doc.pdf as Buffer), hash: String(doc.pdf_hash) };
    if (!generate) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "El PDF firmado aún no se ha generado: lo genera la primera descarga de un usuario con la licencia activa." });
    const c = await contractRow(d, id);
    if (c.status !== "signed" || !c.signedAt || !c.signerName || !c.signedMethod) throw conflict("El PDF firmado solo existe cuando el contrato está firmado.");
    const content = verifiedContent(c.contentJson, c.contentHash);
    if (!content) throw conflict("El contrato no coincide con su huella.");
    const events: EvidenceEvent[] = (await rows(d, sql`SELECT * FROM esign_events WHERE contract_id = ${id} ORDER BY id`)).map((e) => ({
      event: String(e.event), actor: String(e.actor), ip: str(e.ip), userAgent: str(e.user_agent), detail: str(e.detail), createdAt: num(e.created_at),
    }));
    const html = signedContractHtml(content, c.contentHash!, { signerName: c.signerName, signerTaxId: c.signerTaxId, signedAt: c.signedAt, ip: c.signedIp, userAgent: c.signedUserAgent, method: c.signedMethod, signedBy: c.signedBy ?? "" }, events);
    const data = await pdf.htmlToPdf(html);
    const hash = sha256(data);
    // Dos descargas a la vez: se queda el primero que se guarda
    const r = await header(d, sql`INSERT IGNORE INTO esign_documents (contract_id, pdf, pdf_hash, content_hash, created_at) VALUES (${id}, ${data}, ${hash}, ${c.contentHash}, ${now})`);
    if (r.affectedRows) {
      await logEvent(d, id, "pdf", "system", NO_EVIDENCE, { contentHash: c.contentHash, detail: `SHA-256 del PDF: ${hash}` }, now);
      return { data, hash };
    }
    const [again] = await rows(d, sql`SELECT pdf, pdf_hash FROM esign_documents WHERE contract_id = ${id}`);
    return { data: Buffer.from(again.pdf as Buffer), hash: String(again.pdf_hash) };
  });
}

/** Tras firmar: intenta dejar ya el PDF guardado (sin Chromium se generará al descargarlo). */
async function pdfAfterSign(id: number, pdf: PdfDeps) {
  try {
    await ensurePdf(id, pdf);
  } catch (e) {
    console.warn(JSON.stringify({ ctx: "ContractsEsign", event: "pdf_deferred", contractId: id, error: e instanceof Error ? e.message.slice(0, 160) : "error" }));
  }
}

export async function signInPanel(input: { id: number; signerName: string; signerTaxId?: string | null; accepted: boolean }, userId: number, ev: Evidence, pdf: PdfDeps = defaultPdf, now = Date.now()) {
  const s = checkSigner(input);
  if (!s.ok) throw bad(s.error);
  const actor = `user:${userId}`;
  const r = await run((d) =>
    d.transaction(async (tx) => {
      const c = await contractRow(tx, input.id);
      const signed = await recordSignature(tx, c, s, ev, "panel", actor, now);
      if (!signed) throw conflict("El contrato ya no se puede firmar (ha cambiado mientras tanto).");
      await revokeActive(tx, c.id, actor, now);
      return signed;
    }),
  );
  await pdfAfterSign(input.id, pdf);
  return { ok: true as const, contentHash: r.hash };
}

export function voidContract(id: number, reason: string, userId: number, now = Date.now()): Promise<{ ok: true }> {
  const why = oneLine(reason).slice(0, ESIGN_LIMITS.reasonMax);
  if (why.length < 3) throw bad("Indica el motivo de la anulación.");
  const actor = `user:${userId}`;
  return run((d) =>
    d.transaction(async (tx) => {
      const c = await contractRow(tx, id);
      const n = nextStatus(c.status, "void");
      if (!n.ok) throw conflict(n.error);
      const r = await header(tx, sql`UPDATE esign_contracts SET status = 'void', closed_at = ${now}, closed_by = ${actor}, close_reason = ${why}, updated_at = ${now} WHERE id = ${id} AND status IN ('draft', 'sent')`);
      if (!r.affectedRows) throw conflict("El contrato ha cambiado mientras tanto.");
      await revokeActive(tx, id, actor, now);
      await logEvent(tx, id, "void", actor, NO_EVIDENCE, { contentHash: c.contentHash, detail: why }, now);
      return { ok: true as const };
    }),
  );
}

export async function downloadPdf(id: number, pdf: PdfDeps = defaultPdf, o: { generate?: boolean } = {}): Promise<{ filename: string; base64: string; sha256: string }> {
  const r = await ensurePdf(id, pdf, Date.now(), o.generate ?? true).catch((e) => {
    if (e instanceof TRPCError) throw e;
    console.error(JSON.stringify({ ctx: "ContractsEsign", event: "pdf_failed", contractId: id, error: e instanceof Error ? e.message.slice(0, 160) : "error" }));
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "No se ha podido generar el PDF en este momento. La firma y sus evidencias están guardadas; inténtalo de nuevo en unos minutos." });
  });
  return { filename: `contrato-${id}-firmado.pdf`, base64: r.data.toString("base64"), sha256: r.hash };
}

// ─── Página pública (/contrato/<token>) ──────────────────────────────────────

export interface PublicContract {
  linkId: number;
  contractId: number;
  hash: string;
  content: SignedContent;
}

/** Contrato pendiente de firma del enlace (contenido fijado y verificado); null si no lo hay. Anota la primera visita. */
export function contractOfLink(link: EsignLink, ev: Evidence = NO_EVIDENCE, now = Date.now()): Promise<PublicContract | null> {
  return run(async (d) => {
    const [r] = await rows(d, sql`SELECT * FROM esign_contracts WHERE id = ${link.contractId}`);
    if (!r) return null;
    const c = toContract(r);
    if (c.status !== "sent") return null;
    const content = verifiedContent(c.contentJson, c.contentHash);
    if (!content) return null;
    const detail = `Enlace ${link.id}`;
    if (!(await rows(d, sql`SELECT id FROM esign_events WHERE contract_id = ${c.id} AND event = 'viewed' AND detail = ${detail} LIMIT 1`)).length) {
      await logEvent(d, c.id, "viewed", `public:link:${link.id}`, ev, { contentHash: c.contentHash, detail }, now);
    }
    return { linkId: link.id, contractId: c.id, hash: c.contentHash!, content };
  });
}

export type PublicSignResult = { ok: true; signerName: string; contentHash: string } | { ok: false; error: string } | { ok: false; used: true };

/**
 * Firma con el enlace (una sola vez). Primero se valida la firma (un error se muestra y el enlace sigue valiendo);
 * después se CONSUME el enlace y firma en la misma transacción: dos envíos a la vez, uno firma y el otro ve «no válido».
 */
export async function signWithLink(link: EsignLink, input: { signerName: string; signerTaxId?: string | null; accepted: boolean }, ev: Evidence, pdf: PdfDeps = defaultPdf, now = Date.now()): Promise<PublicSignResult> {
  const s = checkSigner(input);
  if (!s.ok) return { ok: false, error: s.error };
  const actor = `public:link:${link.id}`;
  const r = await run((d) =>
    d.transaction(async (tx) => {
      if (!(await consume(tx, link.id, now))) return null;
      const c = await contractRow(tx, link.contractId);
      if (c.status !== "sent") throw conflict("used");
      // Si la firma no se registra (carrera), se deshace todo: el enlace no queda consumido con el contrato sin firmar
      const signed = await recordSignature(tx, c, s, ev, "link", actor, now);
      if (!signed) throw conflict("used");
      return signed;
    }),
  ).catch((e) => {
    if (e instanceof TRPCError && (e.code === "CONFLICT" || e.code === "NOT_FOUND")) return null;
    throw e;
  });
  if (!r) return { ok: false, used: true };
  await pdfAfterSign(link.contractId, pdf);
  return { ok: true, signerName: s.signerName, contentHash: r.hash };
}

/** Rechazo con el enlace (consume el enlace). Motivo opcional. */
export async function rejectWithLink(link: EsignLink, reason: string, ev: Evidence, now = Date.now()): Promise<{ ok: true } | { ok: false; used: true }> {
  const why = oneLine(reason).slice(0, ESIGN_LIMITS.reasonMax) || null;
  const actor = `public:link:${link.id}`;
  const done = await run((d) =>
    d.transaction(async (tx) => {
      if (!(await consume(tx, link.id, now))) return false;
      const c = await contractRow(tx, link.contractId);
      if (!nextStatus(c.status, "reject").ok) throw conflict("used");
      const r = await header(tx, sql`UPDATE esign_contracts SET status = 'rejected', closed_at = ${now}, closed_by = ${actor}, close_reason = ${why}, updated_at = ${now} WHERE id = ${c.id} AND status = 'sent'`);
      if (!r.affectedRows) throw conflict("used");
      await logEvent(tx, c.id, "rejected", actor, ev, { contentHash: c.contentHash, detail: why }, now);
      return true;
    }),
  ).catch((e) => {
    if (e instanceof TRPCError && (e.code === "CONFLICT" || e.code === "NOT_FOUND")) return false;
    throw e;
  });
  return done ? { ok: true } : { ok: false, used: true };
}
