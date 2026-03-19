/**
 * adapters/llm.ts — Wrapper LLM independiente de Manus.
 *
 * Usa la API de OpenAI estándar (o cualquier proveedor compatible como
 * Azure OpenAI, Ollama, LM Studio, etc.) según las variables de entorno:
 *
 *   LLM_API_URL   → base URL (default: https://api.openai.com/v1)
 *   LLM_API_KEY   → Bearer token
 *   LLM_MODEL     → nombre del modelo (default: gpt-4o-mini)
 *
 * Si ninguna clave está configurada, las llamadas devuelven un mensaje de
 * aviso en lugar de lanzar un error, para no romper el arranque local.
 */

export type Role = "system" | "user" | "assistant";

export type Message = {
  role: Role;
  content: string;
};

export type InvokeLLMOptions = {
  messages: Message[];
  model?: string;
  temperature?: number;
  max_tokens?: number;
  response_format?: { type: "json_schema"; json_schema: Record<string, unknown> } | { type: "json_object" };
};

export type LLMResponse = {
  choices: Array<{
    message: { role: string; content: string };
    finish_reason: string;
  }>;
};

function getConfig() {
  return {
    apiUrl: (process.env.LLM_API_URL ?? "https://api.openai.com/v1").replace(/\/$/, ""),
    apiKey: process.env.LLM_API_KEY ?? "",
    model: process.env.LLM_MODEL ?? "gpt-4o-mini",
  };
}

export async function invokeLLM(options: InvokeLLMOptions): Promise<LLMResponse> {
  const { apiUrl, apiKey, model } = getConfig();

  if (!apiKey) {
    console.warn("[LLM] LLM_API_KEY no configurada — devolviendo respuesta mock.");
    return {
      choices: [{
        message: { role: "assistant", content: "[LLM no configurado: establece LLM_API_KEY en .env]" },
        finish_reason: "stop",
      }],
    };
  }

  const body = {
    model: options.model ?? model,
    messages: options.messages,
    temperature: options.temperature ?? 0.7,
    ...(options.max_tokens ? { max_tokens: options.max_tokens } : {}),
    ...(options.response_format ? { response_format: options.response_format } : {}),
  };

  const res = await fetch(`${apiUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`[LLM] Error ${res.status}: ${detail}`);
  }

  return res.json() as Promise<LLMResponse>;
}
