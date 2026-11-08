/**
 * Salud del Postmark propio de la empresa en curso: la marca de verificación (`verifiedFor`, cifrada en la bóveda) solo
 * existe tras una comprobación correcta (servidor Live y flujo Transactional) de ESE token y flujo; un rechazo de la
 * cuenta al enviar la borra y deja registrada la incidencia, y los envíos siguientes vuelven al envío de siempre.
 */
import { getVault } from "../_core/credentials/runtime";
import { recordCheck } from "../_core/credentials/health";
import { opsLog } from "../_core/ops/log";
import { getTenantIdOrDefault } from "../_core/tenant";
import { POSTMARK_PROVIDER_ID, postmarkFingerprint } from "./tenantPostmark";
import type { MailProviderError } from "./types";

/** Tras comprobar: guarda (correcta) o borra (incorrecta) la marca de verificación de los valores comprobados. */
export async function setPostmarkVerification(values: Record<string, string>, ok: boolean, actor: string): Promise<void> {
  const verifiedFor = ok && values.serverToken ? postmarkFingerprint(values.serverToken, values.messageStream) : "";
  if (!verifiedFor && !values.verifiedFor) return;
  await getVault().save(POSTMARK_PROVIDER_ID, { verifiedFor }, actor);
}

/** Postmark rechazó la cuenta al enviar: integración no sana hasta volver a comprobarla. Nunca lanza. */
export async function markPostmarkUnhealthy(e: MailProviderError): Promise<void> {
  opsLog("warn", "Mail", "tenant_postmark_rejected", { tenantId: getTenantIdOrDefault(), code: e.code });
  await getVault()
    .save(POSTMARK_PROVIDER_ID, { verifiedFor: "" }, "system:mail")
    .catch(() => undefined);
  await recordCheck(POSTMARK_PROVIDER_ID, "rejected", `Postmark rechazó un envío (${e.code}): revisa el token, la aprobación de la cuenta o la firma del remitente y vuelve a comprobar. Mientras tanto, los correos salen por el servicio de Elephant Source.`, "system:mail").catch(() => undefined);
}
