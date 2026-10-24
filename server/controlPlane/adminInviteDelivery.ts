/**
 * Entrega de la invitación del administrador tras un alta. Si el Core puede enviar correo de acceso a esa empresa
 * (`MAIL_MODE` y ámbito del Core), la invitación sale por correo desde el Core —que vuelve a crear el enlace y anula
 * el del alta— y el enlace NO se devuelve al operador. Si no puede (correo apagado, sandbox o fuera de ámbito), se
 * mantiene la entrega manual: el enlace se muestra una sola vez al operador, como hasta ahora.
 */
import type { CoreAccessClient } from "./tenantAccess";

export type AdminInviteDelivery =
  | { delivery: "email" }
  | { delivery: "operator"; reason: "mail_disabled" | "sandbox_blocked" | "scope_blocked" | "core_unavailable" | "admin_not_found" };

export async function deliverAdminInvite(client: CoreAccessClient, o: { tenantId: string; adminEmail: string; operator: string }): Promise<AdminInviteDelivery> {
  const email = o.adminEmail.trim().toLowerCase();
  const list = await client.call({ tenantId: o.tenantId, act: "list", operator: o.operator });
  if (list.status !== 200) return { delivery: "operator", reason: "core_unavailable" };
  // Sin correo posible para esta empresa no se toca nada: el enlace del alta sigue siendo el único vigente
  const am = list.body.accessMail as { invite?: boolean } | null | undefined;
  if (list.body.mailMode === "off") return { delivery: "operator", reason: "mail_disabled" };
  if (am && am.invite === false) return { delivery: "operator", reason: "scope_blocked" };
  const users = (Array.isArray(list.body.users) ? list.body.users : []) as Array<{ id?: number; email?: string | null }>;
  const admin = users.find((u) => (u.email ?? "").toLowerCase() === email);
  if (!admin?.id) return { delivery: "operator", reason: "admin_not_found" };
  const r = await client.call({ tenantId: o.tenantId, act: "invite", uid: admin.id, confirm: email, operator: o.operator });
  if (r.status !== 200) return { delivery: "operator", reason: "core_unavailable" };
  const mail = r.body.mail;
  if (mail === "sent") return { delivery: "email" };
  return { delivery: "operator", reason: mail === "sandbox_blocked" || mail === "scope_blocked" ? mail : "mail_disabled" };
}

/**
 * Aplica la entrega a un resultado de aprovisionamiento: si la invitación salió por correo, se retira el enlace de la
 * respuesta. Un fallo del Core nunca rompe el alta: se conserva la entrega manual.
 */
export async function withAdminInviteDelivery<T extends { status: string; adminInviteToken?: string }>(
  result: T,
  deliver: (() => Promise<AdminInviteDelivery>) | null,
): Promise<T & { adminInvite?: AdminInviteDelivery }> {
  if (result.status !== "completed" || !result.adminInviteToken || !deliver) return result;
  const d = await deliver().catch((): AdminInviteDelivery => ({ delivery: "operator", reason: "core_unavailable" }));
  if (d.delivery === "email") {
    const { adminInviteToken: _omit, ...rest } = result;
    return { ...(rest as T), adminInvite: d };
  }
  return { ...result, adminInvite: d };
}
