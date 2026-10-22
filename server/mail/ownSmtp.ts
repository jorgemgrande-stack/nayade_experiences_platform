/**
 * Correo saliente propio de una empresa (decisión del 23/10/2026).
 *
 * Por defecto, el correo de cada empresa sale por el servicio central de Big Elephant (`mailProviderFromEnv`). Una
 * empresa puede configurar en Integraciones su propio SMTP (bóveda, proveedor `mail_smtp`, contraseña cifrada). Solo
 * se usa si el remitente pertenece a un dominio propio VERIFICADO de la empresa en el registro. El envío sigue
 * gobernado por la misma política (`MAIL_MODE`: off por defecto, sandbox o live autorizado), así que nada sale hasta
 * que el envío externo esté autorizado.
 */
import { isMultiTenant } from "../_core/tenant";
import { credentialFor } from "../_core/credentials/cache";
import { peekTenantIdentity, type TenantRegistryIdentity } from "../_core/tenantIdentity";
import { normalizeEmail } from "./policy";

export interface OwnSmtp {
  config: { host: string; port: number; secure: boolean; user: string; pass: string };
  fromEmail: string;
  /** Dominio del remitente: dominio de envío de la política de esta empresa. */
  domain: string;
}

const trim = (v: string | undefined) => (v ?? "").trim();

/** ¿El dominio del remitente es (o cuelga de) un dominio verificado de la empresa? */
export function senderDomainVerified(domain: string, identity: Pick<TenantRegistryIdentity, "customDomains"> | null): boolean {
  if (!identity) return false;
  return identity.customDomains.some(
    (d) => d.state === "verified" && (d.domain === domain || d.domain.endsWith(`.${domain}`) || domain.endsWith(`.${d.domain}`)),
  );
}

/** SMTP propio de la empresa en curso, o `null` (sin configurar, incompleto o con un remitente no verificado). */
export function tenantOwnSmtp(identity: Pick<TenantRegistryIdentity, "customDomains"> | null = isMultiTenant() ? peekTenantIdentity() : null): OwnSmtp | null {
  if (!isMultiTenant()) return null;
  const host = trim(credentialFor("mail_smtp", "host"));
  const user = trim(credentialFor("mail_smtp", "user"));
  const pass = credentialFor("mail_smtp", "pass") ?? "";
  const fromEmail = normalizeEmail(credentialFor("mail_smtp", "fromEmail") ?? "");
  if (!host || !user || !pass || !fromEmail) return null;
  const domain = fromEmail.slice(fromEmail.lastIndexOf("@") + 1);
  if (!senderDomainVerified(domain, identity)) return null;
  const port = parseInt(trim(credentialFor("mail_smtp", "port")) || "587", 10);
  return {
    config: { host, port: Number.isFinite(port) ? port : 587, secure: trim(credentialFor("mail_smtp", "secure")) === "true", user, pass },
    fromEmail,
    domain,
  };
}
