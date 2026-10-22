/**
 * Buzón IMAP de una ingesta de correo (tickets del datáfono o justificantes de gastos).
 *
 * Multiempresa: las credenciales de la propia empresa (bóveda, proveedores `imap_tpv` e `imap_expenses`). Sin host,
 * usuario o contraseña, la ingesta no lee nada: nunca un buzón del entorno ni de otra empresa.
 */
import { integrationEnv } from "../_core/tenantConfig";

export interface ImapConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  mailbox: string;
  allowedSender: string | null;
}

export function tenantImapConfig(prefix: "IMAP_TPV" | "IMAP_EXPENSE"): ImapConfig | null {
  const host = integrationEnv(`${prefix}_HOST`)?.trim();
  const user = integrationEnv(`${prefix}_USER`)?.trim();
  const pass = integrationEnv(`${prefix}_PASS`);
  if (!host || !user || !pass) return null;
  const port = parseInt(integrationEnv(`${prefix}_PORT`) || "993", 10);
  return {
    host,
    port: Number.isFinite(port) ? port : 993,
    secure: (integrationEnv(`${prefix}_SECURE`) || "true") === "true",
    user,
    pass,
    mailbox: integrationEnv(`${prefix}_MAILBOX`)?.trim() || "INBOX",
    allowedSender: integrationEnv(`${prefix}_ALLOWED_SENDER`)?.trim() || null,
  };
}
