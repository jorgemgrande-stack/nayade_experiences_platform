/**
 * Acciones de ACCESOS de una empresa, ejecutadas por el Core en el contexto de esa empresa (ver ./token.ts).
 * Reutilizan los flujos existentes; no hay un segundo motor de usuarios:
 *  - restablecimiento: `requestPasswordReset` (enlace de un solo uso, 60 min, invalida los anteriores);
 *  - invitación: `resendUserInvite` + `sendInviteEmail` (72 h, como el panel de la empresa);
 *  - bloqueo por intentos: `loginThrottle` (desbloquear = limpiar el contador de esa cuenta);
 *  - activar/desactivar: `users.isActive` (desactivar corta las sesiones: el Core lo comprueba en cada petición).
 * Salvaguardas: nunca se devuelve ni se fija una contraseña; la persona propietaria y el último administrador activo
 * no se desactivan; reactivar ocupa plaza; los envíos exigen el correo tecleado por el operador y respetan MAIL_MODE.
 */
import { and, eq, ne } from "drizzle-orm";
import { getDb } from "../../db";
import { users } from "../../../drizzle/schema";
import { getCompanyOwnerEmail } from "../companyOwner";
import { loginLockRemaining, recordLoginSuccess } from "../loginThrottle";
import { mailPolicyFromEnv, type MailPolicy } from "../../mail/policy";
import type { OpsAccessAction } from "./token";

export interface AccessUserView {
  id: number;
  name: string | null;
  email: string | null;
  role: string;
  owner: boolean;
  active: boolean;
  hasPassword: boolean;
  invitation: "accepted" | "pending" | "expired" | "none";
  invitationExpiresAt: string | null;
  lastSignedIn: string | null;
  createdAt: string | null;
  lockedForSeconds: number;
}

export type AccessResult =
  | { ok: true; action: OpsAccessAction; users?: AccessUserView[]; mailMode?: MailPolicy["mode"]; mail?: MailOutcome; active?: boolean }
  | { ok: false; error: AccessError; message: string };

export type AccessError = "not_found" | "confirm_mismatch" | "owner_protected" | "last_admin" | "no_email" | "inactive" | "already_accepted" | "seat_limit" | "db_unavailable";
export type MailOutcome = "sent" | "mail_disabled" | "sandbox_blocked";

const fail = (error: AccessError, message: string): AccessResult => ({ ok: false, error, message });

/** ¿Saldría el correo? off: no sale nada; sandbox: solo a la lista autorizada. Se decide ANTES de crear enlaces. */
export function mailGate(policy: Pick<MailPolicy, "mode" | "allowAddresses" | "allowDomains">, email: string): MailOutcome {
  if (policy.mode === "off") return "mail_disabled";
  if (policy.mode === "sandbox") {
    const e = email.trim().toLowerCase();
    const domain = e.split("@")[1] ?? "";
    if (!policy.allowAddresses.has(e) && !policy.allowDomains.has(domain)) return "sandbox_blocked";
  }
  return "sent";
}

export function invitationState(u: { inviteAccepted: boolean; inviteToken: string | null; inviteTokenExpiry: Date | null }, now = Date.now()): AccessUserView["invitation"] {
  if (u.inviteAccepted) return "accepted";
  if (!u.inviteToken) return "none";
  return u.inviteTokenExpiry && u.inviteTokenExpiry.getTime() > now ? "pending" : "expired";
}

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

export interface AccessActionDeps {
  policy?: () => MailPolicy;
  requestReset?: (email: string) => Promise<unknown>;
  sendInvite?: (u: { id: number; name: string; email: string; role: string }) => Promise<unknown>;
  seatAvailable?: () => Promise<void>;
}

export async function runAccessAction(act: OpsAccessAction, uid: number | undefined, confirm: string | undefined, deps: AccessActionDeps = {}): Promise<AccessResult> {
  const db = await getDb();
  if (!db) return fail("db_unavailable", "Base de datos de la empresa no disponible");
  const ownerEmail = await getCompanyOwnerEmail();

  if (act === "list") {
    const rows = await db.select().from(users).limit(500);
    return {
      ok: true,
      action: act,
      // Modo de correo EFECTIVO de esta instalación: la interfaz avisa antes de ofrecer un envío que no saldría
      mailMode: (deps.policy ?? (() => mailPolicyFromEnv(process.env)))().mode,
      users: rows.map((u) => ({
        id: u.id,
        name: u.name ?? null,
        email: u.email ?? null,
        role: String(u.role),
        owner: !!ownerEmail && (u.email ?? "").toLowerCase() === ownerEmail && u.role === "admin",
        active: !!u.isActive,
        hasPassword: !!u.passwordHash,
        invitation: invitationState({ inviteAccepted: !!u.inviteAccepted, inviteToken: u.inviteToken ?? null, inviteTokenExpiry: u.inviteTokenExpiry ?? null }),
        invitationExpiresAt: iso(u.inviteTokenExpiry),
        lastSignedIn: iso(u.lastSignedIn),
        createdAt: iso(u.createdAt),
        lockedForSeconds: u.email ? Math.ceil(loginLockRemaining(u.email) / 1000) : 0,
      })),
    };
  }

  const [u] = await db.select().from(users).where(eq(users.id, uid!)).limit(1);
  if (!u) return fail("not_found", "El usuario no existe en esta empresa");
  const email = (u.email ?? "").trim().toLowerCase();
  const isOwner = !!ownerEmail && email === ownerEmail && u.role === "admin";
  const policy = (deps.policy ?? (() => mailPolicyFromEnv(process.env)))();

  if (act === "reset" || act === "invite") {
    if (!email) return fail("no_email", "El usuario no tiene correo");
    // Confirmación expresa: el operador teclea el correo del destinatario
    if ((confirm ?? "").trim().toLowerCase() !== email) return fail("confirm_mismatch", "El correo de confirmación no coincide con el del usuario");
    if (!u.isActive) return fail("inactive", "El usuario está desactivado");
    if (act === "invite" && u.inviteAccepted) return fail("already_accepted", "La invitación ya se aceptó: usa el restablecimiento");
    const gate = mailGate(policy, email);
    // Sin envío posible no se crea ningún enlace (nadie lo recibiría): la contraseña y los enlaces vigentes no cambian
    if (gate !== "sent") return { ok: true, action: act, mail: gate };
    if (act === "reset") {
      await (deps.requestReset ?? (async (e: string) => (await import("../../passwordReset")).requestPasswordReset(e)))(email);
    } else {
      await (deps.sendInvite ??
        (async (x) => {
          const { nanoid } = await import("nanoid");
          const token = nanoid(48);
          const { resendUserInvite } = await import("../../db");
          await resendUserInvite(x.id, token, new Date(Date.now() + 72 * 3_600_000));
          const { getTrustedBaseUrl } = await import("../publicUrl");
          const { sendInviteEmail } = await import("../../inviteEmail");
          await sendInviteEmail({ name: x.name, email: x.email, setPasswordUrl: `${getTrustedBaseUrl()}/establecer-contrasena?token=${token}`, role: x.role });
        }))({ id: u.id, name: u.name ?? "", email, role: String(u.role) });
    }
    return { ok: true, action: act, mail: "sent" };
  }

  if (act === "unlock") {
    if (email) recordLoginSuccess(email);
    return { ok: true, action: act };
  }

  // activate / deactivate
  const want = act === "activate";
  if (!!u.isActive === want) return { ok: true, action: act, active: want };
  if (!want) {
    if (isOwner) return fail("owner_protected", "La persona propietaria de la empresa no se desactiva desde aquí");
    if (u.role === "admin") {
      const others = await db.select({ id: users.id }).from(users).where(and(eq(users.role, "admin"), eq(users.isActive, true), ne(users.id, u.id))).limit(1);
      if (!others.length) return fail("last_admin", "Es el último administrador activo de la empresa");
    }
  } else {
    try {
      await (deps.seatAvailable ?? (async () => (await import("../../setupWizardDb")).assertSeatAvailable()))();
    } catch {
      return fail("seat_limit", "La empresa no tiene plazas de usuario libres en su plan");
    }
  }
  await db.update(users).set({ isActive: want, updatedAt: new Date() }).where(eq(users.id, u.id));
  return { ok: true, action: act, active: want };
}
