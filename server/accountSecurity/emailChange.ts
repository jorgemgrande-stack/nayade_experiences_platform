/**
 * Cambio del correo de acceso con verificación (tabla `email_change_tokens` de db/migrations/0017_email_change_tokens.sql,
 * en la base de cada empresa).
 *
 *  1. Solicitud: el propio usuario (con su contraseña actual) o un administrador de su empresa. Se comprueba que el
 *     correo no lo use otro usuario de la empresa, se invalidan las solicitudes anteriores y se envía al correo NUEVO
 *     un enlace con un token de un solo uso (60 minutos). Solo se guarda el hash del token.
 *  2. Confirmación: con la sesión del propio usuario y el token. Se consume de forma atómica (un solo uso real), se
 *     vuelve a comprobar la unicidad y se aplica el cambio. Como al cambiar la contraseña, se cierran todas las
 *     sesiones (`sessionsRevokedAt`) y se anulan los enlaces de recuperación pendientes (iban al correo anterior).
 *  3. Aviso `account.email_changed` al correo ANTERIOR (categoría `security_notice`). Un fallo del aviso no deshace
 *     el cambio.
 *
 * La persona propietaria de la empresa (`company_owner_email`) no puede cambiarlo así: su correo identifica la
 * propiedad de la empresa y se cambia con el equipo de Big Elephant.
 */
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { sql } from "drizzle-orm";
import { getTenantDatabase } from "../_core/dbRegistry";
import { getTrustedBaseUrl } from "../_core/publicUrl";
import { brandName } from "../tenantBrand";
import { getCompanyOwnerEmail } from "../_core/companyOwner";
import { emailChangeVerifyContent, emailChangedContent } from "../mail/accountSecurityTemplates";
import type { MailParams } from "../mailer";

export const EMAIL_CHANGE_TTL_MINUTES = 60;
/** Solicitudes por usuario y hora (evita usar el formulario para enviar correos a terceros). */
export const EMAIL_CHANGE_MAX_PER_HOUR = 5;
export const VERIFY_PATH = "/admin/verificar-correo";

export type EmailChangeErrorCode = "unavailable" | "not_found" | "inactive" | "same_email" | "email_taken" | "bad_password" | "rate_limited" | "invalid_token" | "owner_account";
export class EmailChangeError extends Error {
  constructor(public readonly code: EmailChangeErrorCode) {
    super(code);
  }
}

export const normalizeEmail = (e: string) => e.trim().toLowerCase();
const isOwner = async (deps: { ownerEmail: () => Promise<string | null> }, email: string | null) => {
  const owner = await deps.ownerEmail();
  return !!owner && !!email && normalizeEmail(email) === owner;
};
export const hashToken = (raw: string) => crypto.createHash("sha256").update(`email-change:${raw}`).digest("hex");

export interface EmailChangeUser {
  id: number;
  email: string | null;
  name: string | null;
  isActive: boolean;
  passwordHash: string | null;
}

export interface EmailChangeStore {
  getUser(id: number): Promise<EmailChangeUser | null>;
  /** ¿Usa otro usuario de la empresa ese correo? (sin distinguir mayúsculas) */
  emailTaken(email: string, exceptUserId: number): Promise<boolean>;
  countSince(userId: number, since: Date): Promise<number>;
  invalidatePending(userId: number, at: Date): Promise<void>;
  insert(t: { userId: number; newEmail: string; tokenHash: string; requestedBy: number; createdAt: Date; expiresAt: Date }): Promise<void>;
  findValid(tokenHash: string, now: Date): Promise<{ id: number; userId: number; newEmail: string } | null>;
  /** Consume el token (UPDATE condicionado): `true` solo para la primera llamada. */
  consume(id: number, now: Date): Promise<boolean>;
  /** Aplica el correo nuevo, cierra las sesiones y anula los enlaces de recuperación pendientes. */
  apply(userId: number, newEmail: string, now: Date): Promise<void>;
  pending(userId: number, now: Date): Promise<{ newEmail: string; expiresAt: Date } | null>;
}

export interface EmailChangeDeps {
  store: EmailChangeStore;
  send: (m: MailParams) => Promise<boolean>;
  brand: () => string;
  baseUrl: () => string;
  now: () => Date;
  /** Correo de la persona propietaria de la empresa (`company_owner_email`), o `null`. */
  ownerEmail: () => Promise<string | null>;
}

/**
 * Solicita el cambio. `actorId === userId`: autoservicio (exige la contraseña actual). Si no, la petición la hace un
 * administrador de la empresa (la autorización la comprueba el procedimiento).
 */
export async function requestEmailChange(deps: EmailChangeDeps, i: { actorId: number; userId: number; newEmail: string; currentPassword?: string }): Promise<{ sent: boolean; newEmail: string }> {
  const newEmail = normalizeEmail(i.newEmail);
  const now = deps.now();
  const user = await deps.store.getUser(i.userId);
  if (!user) throw new EmailChangeError("not_found");
  if (!user.isActive) throw new EmailChangeError("inactive");
  if (await isOwner(deps, user.email)) throw new EmailChangeError("owner_account");
  if (i.actorId === i.userId) {
    const ok = !!user.passwordHash && typeof i.currentPassword === "string" && (await bcrypt.compare(i.currentPassword, user.passwordHash));
    if (!ok) throw new EmailChangeError("bad_password");
  }
  if (normalizeEmail(user.email ?? "") === newEmail) throw new EmailChangeError("same_email");
  if (await deps.store.emailTaken(newEmail, user.id)) throw new EmailChangeError("email_taken");
  if ((await deps.store.countSince(user.id, new Date(now.getTime() - 3_600_000))) >= EMAIL_CHANGE_MAX_PER_HOUR) throw new EmailChangeError("rate_limited");

  await deps.store.invalidatePending(user.id, now);
  const raw = crypto.randomBytes(32).toString("base64url");
  await deps.store.insert({ userId: user.id, newEmail, tokenHash: hashToken(raw), requestedBy: i.actorId, createdAt: now, expiresAt: new Date(now.getTime() + EMAIL_CHANGE_TTL_MINUTES * 60_000) });

  const url = `${deps.baseUrl()}${VERIFY_PATH}?token=${encodeURIComponent(raw)}`;
  const m = emailChangeVerifyContent({ brand: deps.brand(), name: user.name, newEmail, url, minutes: EMAIL_CHANGE_TTL_MINUTES });
  const sent = await deps.send({ to: newEmail, subject: m.subject, html: m.html, text: m.text, category: "email_verification" }).catch(() => false);
  return { sent, newEmail };
}

/** Confirma el cambio con el token del enlace y la sesión del propio usuario. */
export async function confirmEmailChange(deps: EmailChangeDeps, i: { userId: number; token: string }): Promise<{ email: string; noticeSent: boolean }> {
  const now = deps.now();
  const row = i.token ? await deps.store.findValid(hashToken(i.token), now) : null;
  // Un token de otro usuario no se consume ni se distingue de uno inválido
  if (!row || row.userId !== i.userId) throw new EmailChangeError("invalid_token");
  if (!(await deps.store.consume(row.id, now))) throw new EmailChangeError("invalid_token");
  const user = await deps.store.getUser(row.userId);
  if (!user || !user.isActive) throw new EmailChangeError("invalid_token");
  if (await isOwner(deps, user.email)) throw new EmailChangeError("owner_account");
  if (await deps.store.emailTaken(row.newEmail, user.id)) throw new EmailChangeError("email_taken");

  const oldEmail = user.email;
  await deps.store.apply(user.id, row.newEmail, now);

  let noticeSent = false;
  if (oldEmail && normalizeEmail(oldEmail) !== row.newEmail) {
    const m = emailChangedContent({ brand: deps.brand(), name: user.name, oldEmail, newEmail: row.newEmail, at: now });
    noticeSent = await deps.send({ to: oldEmail, subject: m.subject, html: m.html, text: m.text, category: "security_notice", idempotencyKey: `account.email_changed:${user.id}:${row.id}` }).catch(() => false);
  }
  return { email: row.newEmail, noticeSent };
}

export async function pendingEmailChange(store: EmailChangeStore, userId: number, now: Date): Promise<{ available: boolean; pending: { newEmail: string; expiresAt: string } | null }> {
  try {
    const p = await store.pending(userId, now);
    return { available: true, pending: p ? { newEmail: p.newEmail, expiresAt: p.expiresAt.toISOString() } : null };
  } catch (e) {
    if (e instanceof EmailChangeError && e.code === "unavailable") return { available: false, pending: null };
    throw e;
  }
}

// ─── Almacén real (base de la empresa en curso) ────────────────────────────────

type Db = NonNullable<Awaited<ReturnType<typeof getTenantDatabase>>>;
const missingTable = (e: unknown) => /ER_NO_SUCH_TABLE|doesn't exist/i.test(String((e as { code?: string }).code ?? "") + String((e as Error)?.message ?? ""));
const affected = (r: unknown) => Number(((Array.isArray(r) ? r[0] : r) as { affectedRows?: number } | undefined)?.affectedRows ?? 0);
const rowsOf = (r: unknown) => ((Array.isArray(r) ? r[0] : r) as Array<Record<string, unknown>>) ?? [];
const toDate = (v: unknown) => (v instanceof Date ? v : new Date(String(v)));

export function sqlEmailChangeStore(resolve: () => Promise<Db | null> = () => getTenantDatabase()): EmailChangeStore {
  const run = async <T>(fn: (d: Db) => Promise<T>): Promise<T> => {
    const d = await resolve();
    if (!d) throw new EmailChangeError("unavailable");
    try {
      return await fn(d);
    } catch (e) {
      if (missingTable(e)) throw new EmailChangeError("unavailable");
      throw e;
    }
  };
  return {
    getUser: (id) =>
      run(async (d) => {
        const r = rowsOf(await d.execute(sql`SELECT id, email, name, isActive, passwordHash FROM users WHERE id = ${id} LIMIT 1`))[0];
        return r ? { id: Number(r.id), email: r.email ? String(r.email) : null, name: r.name ? String(r.name) : null, isActive: !!Number(r.isActive), passwordHash: r.passwordHash ? String(r.passwordHash) : null } : null;
      }),
    emailTaken: (email, exceptUserId) =>
      run(async (d) => rowsOf(await d.execute(sql`SELECT id FROM users WHERE LOWER(email) = ${email} AND id <> ${exceptUserId} LIMIT 1`)).length > 0),
    countSince: (userId, since) =>
      run(async (d) => Number(rowsOf(await d.execute(sql`SELECT COUNT(*) AS n FROM email_change_tokens WHERE user_id = ${userId} AND created_at >= ${since}`))[0]?.n ?? 0)),
    invalidatePending: (userId, at) =>
      run(async (d) => {
        await d.execute(sql`UPDATE email_change_tokens SET used_at = ${at} WHERE user_id = ${userId} AND used_at IS NULL`);
      }),
    insert: (t) =>
      run(async (d) => {
        await d.execute(sql`INSERT INTO email_change_tokens (user_id, new_email, token_hash, requested_by, created_at, expires_at) VALUES (${t.userId}, ${t.newEmail}, ${t.tokenHash}, ${t.requestedBy}, ${t.createdAt}, ${t.expiresAt})`);
      }),
    findValid: (tokenHash, now) =>
      run(async (d) => {
        const r = rowsOf(await d.execute(sql`SELECT id, user_id, new_email FROM email_change_tokens WHERE token_hash = ${tokenHash} AND used_at IS NULL AND expires_at > ${now} LIMIT 1`))[0];
        return r ? { id: Number(r.id), userId: Number(r.user_id), newEmail: String(r.new_email) } : null;
      }),
    consume: (id, now) => run(async (d) => affected(await d.execute(sql`UPDATE email_change_tokens SET used_at = ${now} WHERE id = ${id} AND used_at IS NULL`)) === 1),
    apply: (userId, newEmail, now) =>
      run(async (d) => {
        await d.execute(sql`UPDATE users SET email = ${newEmail}, sessionsRevokedAt = ${now}, updatedAt = ${now} WHERE id = ${userId}`);
        await d.execute(sql`UPDATE password_reset_tokens SET usedAt = ${now} WHERE userId = ${userId} AND usedAt IS NULL`);
      }),
    pending: (userId, now) =>
      run(async (d) => {
        const r = rowsOf(await d.execute(sql`SELECT new_email, expires_at FROM email_change_tokens WHERE user_id = ${userId} AND used_at IS NULL AND expires_at > ${now} ORDER BY id DESC LIMIT 1`))[0];
        return r ? { newEmail: String(r.new_email), expiresAt: toDate(r.expires_at) } : null;
      }),
  };
}

async function defaultSend(m: MailParams): Promise<boolean> {
  const { sendEmail } = await import("../mailer");
  return sendEmail(m);
}

export const defaultEmailChangeDeps = (): EmailChangeDeps => ({ store: sqlEmailChangeStore(), send: defaultSend, brand: brandName, baseUrl: getTrustedBaseUrl, now: () => new Date(), ownerEmail: getCompanyOwnerEmail });
