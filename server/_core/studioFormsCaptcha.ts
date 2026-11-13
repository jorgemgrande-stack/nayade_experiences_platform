/**
 * Elephant Studio — Turnstile de Cloudflare para los formularios (E-7). Sin dependencias de base de datos: las claves
 * llegan de la bóveda de credenciales de LA EMPRESA en curso (cifradas con AAD tenant|proveedor|campo).
 */
export interface CaptchaConfig {
  siteKey: string;
  secretKey: string;
}

export const TURNSTILE_PROVIDER = "turnstile";
const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/** Claves de Turnstile de la empresa en curso (bóveda cifrada de SU base de datos); null si no están completas. */
export async function readCaptchaConfig(vault: { resolve: (provider: string) => Promise<Record<string, string>> }): Promise<CaptchaConfig | null> {
  try {
    const v = await vault.resolve(TURNSTILE_PROVIDER);
    return v.siteKey && v.secretKey ? { siteKey: v.siteKey, secretKey: v.secretKey } : null;
  } catch {
    return null;
  }
}

/** Verifica el resultado del widget con el secreto de la empresa. Cualquier fallo del servicio = no verificado. */
export async function verifyTurnstile(token: string, secretKey: string, ip: string, fetchFn: typeof fetch = fetch): Promise<boolean> {
  if (!token || token.length > 2048 || !secretKey) return false;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 5000);
  try {
    const body = new URLSearchParams({ secret: secretKey, response: token });
    if (ip && ip !== "desconocida") body.set("remoteip", ip);
    const res = await fetchFn(SITEVERIFY, { method: "POST", body, signal: ctl.signal });
    if (!res.ok) return false;
    const json = (await res.json()) as { success?: boolean };
    return json.success === true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

