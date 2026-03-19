/**
 * adapters/imageGeneration.ts — Generación de imágenes sin depender de Manus.
 *
 * Usa la API de OpenAI DALL-E (o cualquier proveedor compatible).
 * Si IMAGE_API_KEY no está configurado, devuelve una URL de placeholder.
 *
 * Variables de entorno:
 *   IMAGE_API_URL   → base URL (default: https://api.openai.com/v1)
 *   IMAGE_API_KEY   → API key (puede ser la misma que LLM_API_KEY)
 *   IMAGE_MODEL     → modelo (default: dall-e-3)
 */

import { storagePut } from "./storage";

export type GenerateImageOptions = {
  prompt: string;
  originalImages?: Array<{ url?: string; b64Json?: string; mimeType?: string }>;
};

export type GenerateImageResponse = {
  url?: string;
};

function getImageConfig() {
  return {
    apiUrl: (process.env.IMAGE_API_URL ?? process.env.LLM_API_URL ?? "https://api.openai.com/v1").replace(/\/$/, ""),
    apiKey: process.env.IMAGE_API_KEY ?? process.env.LLM_API_KEY ?? "",
    model: process.env.IMAGE_MODEL ?? "dall-e-3",
  };
}

export async function generateImage(options: GenerateImageOptions): Promise<GenerateImageResponse> {
  const { apiUrl, apiKey, model } = getImageConfig();

  if (!apiKey) {
    console.warn("[ImageGen] IMAGE_API_KEY no configurada — devolviendo placeholder.");
    return { url: `https://placehold.co/1024x1024/1a2744/ffffff?text=Imagen+no+disponible` };
  }

  const res = await fetch(`${apiUrl}/images/generations`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      prompt: options.prompt,
      n: 1,
      size: "1024x1024",
      response_format: "b64_json",
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`[ImageGen] Error ${res.status}: ${detail}`);
  }

  const data = (await res.json()) as { data: Array<{ b64_json: string }> };
  const b64 = data.data[0]?.b64_json;
  if (!b64) throw new Error("[ImageGen] Respuesta vacía del servicio de imágenes.");

  const buffer = Buffer.from(b64, "base64");
  const { url } = await storagePut(`generated/${Date.now()}.png`, buffer, "image/png");
  return { url };
}
