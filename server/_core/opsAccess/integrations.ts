/**
 * Integraciones de una empresa desde el plano de control, por el canal interno firmado (ver ./token.ts):
 *  - `integrations`: estado real de cada integración (última comprobación, sincronización, error e incidencias);
 *  - `integration_check`: comprobación de SOLO LECTURA con las credenciales de la empresa (consultas GET, inicio de
 *    sesión IMAP sin leer mensajes, verificación SMTP sin enviar). Nunca devuelve ni registra un secreto.
 * El resultado queda registrado en la base de la empresa con el operador como autor.
 */
import { getProvider } from "../credentials/catalog";
import { getVault } from "../credentials/runtime";
import { integrationHealth, recordCheck } from "../credentials/health";
import { testProvider } from "../credentials/testers";
import type { AccessResult } from "./actions";

export interface IntegrationDeps {
  resolve?: (provider: string) => Promise<Record<string, string>>;
  test?: typeof testProvider;
  record?: typeof recordCheck;
  health?: typeof integrationHealth;
}

export async function runIntegrationAction(
  act: "integrations" | "integration_check",
  provider: string | undefined,
  operator: string,
  d: IntegrationDeps = {},
): Promise<AccessResult> {
  if (act === "integrations") return { ok: true, action: act, integrations: await (d.health ?? integrationHealth)() };
  const def = provider ? getProvider(provider) : undefined;
  if (!def) return { ok: false, error: "unknown_provider", message: "Integración desconocida" };
  const values = await (d.resolve ?? ((p: string) => getVault().resolve(p)))(def.id);
  if (!Object.values(values).some((v) => v && v.trim())) return { ok: false, error: "not_configured", message: "La empresa no tiene configurada esta integración" };
  const r = await (d.test ?? testProvider)(def.id, values);
  if (r.outcome && r.outcome !== "unsupported") await (d.record ?? recordCheck)(def.id, r.outcome, r.message, operator.slice(0, 100));
  return { ok: true, action: act, check: { provider: def.id, outcome: r.outcome ?? (r.ok ? "connected" : "error"), message: r.message } };
}
