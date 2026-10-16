/**
 * Canal de ayuda del panel del cliente.
 *
 * Los tickets de soporte viven en el registro (plano de control) y el Core solo puede leerlo, así que
 * desde la empresa no se pueden abrir tickets: el canal es un enlace de correo configurable.
 *  1. Ajuste de la empresa `support_contact_email` (system_settings), si existe y es válido.
 *  2. Variable de la plataforma `ELEPHANT_SUPPORT_EMAIL`.
 *  3. Ninguno: el panel muestra solo el centro de ayuda (sin inventar una dirección).
 */
import { getSystemSetting } from "./config";
import { SUPPORT_EMAIL_RE as EMAIL_RE } from "../shared/helpCenter";

export function validSupportEmail(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length <= 254 && EMAIL_RE.test(t) ? t : null;
}

export async function resolveSupportContact(
  getSetting: (key: string, fallback?: string) => Promise<string> = getSystemSetting,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ email: string | null }> {
  let fromSetting: string | null = null;
  try {
    fromSetting = validSupportEmail(await getSetting("support_contact_email", ""));
  } catch {
    /* sin ajuste legible: se usa el de la plataforma */
  }
  return { email: fromSetting ?? validSupportEmail(env.ELEPHANT_SUPPORT_EMAIL) };
}
