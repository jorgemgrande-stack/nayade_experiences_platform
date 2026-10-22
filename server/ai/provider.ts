/**
 * Proveedor de IA de cada petición (decisión del 23/10/2026).
 *
 * Multiempresa, por orden:
 *  1. Clave propia de la empresa (bóveda, proveedor `ai`). Prevista: el catálogo de integraciones aún no la ofrece,
 *     así que hoy nunca hay ninguna.
 *  2. Servicio central de Big Elephant (`ES_AI_API_URL`, `ES_AI_API_KEY`, `ES_AI_MODEL`; compatible con OpenAI).
 *  3. Ninguno: la IA no está disponible para esa empresa.
 * Nunca la cuenta heredada de la instalación original (`BUILT_IN_FORGE_*`). El consumo se mide y se limita por empresa
 * en Elephant Resource Manager (`meter` / `enforceQuota` en `_core/llm.ts`).
 *
 * Instalación de una sola empresa: la de siempre (`BUILT_IN_FORGE_*`).
 */
import { isMultiTenant } from "../_core/tenant";
import { credentialFor } from "../_core/credentials/cache";
import { ENV } from "../_core/env";

export type AiSource = "tenant" | "central" | "installation";

export interface AiProviderConfig {
  source: AiSource;
  /** URL completa del endpoint de chat. */
  chatUrl: string;
  apiKey: string;
  model: string;
}

const DEFAULT_MODEL = "gpt-4o-mini";
const INSTALLATION_MODEL = "gemini-2.5-flash";
const trim = (v: string | undefined | null) => (v ?? "").trim();
const chatUrlOf = (base: string) => `${base.replace(/\/+$/, "")}/chat/completions`;

export function resolveAiProvider(): AiProviderConfig | null {
  if (isMultiTenant()) {
    const tenantKey = trim(credentialFor("ai", "apiKey"));
    if (tenantKey) {
      return {
        source: "tenant",
        chatUrl: chatUrlOf(trim(credentialFor("ai", "apiUrl")) || "https://api.openai.com/v1"),
        apiKey: tenantKey,
        model: trim(credentialFor("ai", "model")) || DEFAULT_MODEL,
      };
    }
    const centralKey = trim(process.env.ES_AI_API_KEY);
    const centralUrl = trim(process.env.ES_AI_API_URL);
    if (centralKey && centralUrl) {
      return { source: "central", chatUrl: chatUrlOf(centralUrl), apiKey: centralKey, model: trim(process.env.ES_AI_MODEL) || DEFAULT_MODEL };
    }
    return null;
  }
  if (!ENV.forgeApiKey) return null;
  const base = ENV.forgeApiUrl && ENV.forgeApiUrl.trim() ? `${ENV.forgeApiUrl.replace(/\/$/, "")}/v1` : "https://forge.manus.im/v1";
  return { source: "installation", chatUrl: chatUrlOf(base), apiKey: ENV.forgeApiKey, model: INSTALLATION_MODEL };
}

export class AiUnavailableError extends Error {
  constructor() {
    super("La inteligencia artificial no está disponible para esta empresa.");
    this.name = "AiUnavailableError";
  }
}
