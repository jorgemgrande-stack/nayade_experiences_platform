/**
 * Comprobación de credenciales por proveedor. Nunca devuelve ni registra el secreto; el
 * resultado es solo `ok` + un motivo genérico. Las llamadas de red usan `fetch` inyectable.
 */
export interface TestResult {
  ok: boolean;
  message: string;
}

type Fetch = (url: string, init?: { method?: string; headers?: Record<string, string>; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number }>;

const TIMEOUT_MS = 8000;

async function get(fetchImpl: Fetch, url: string, headers: Record<string, string>): Promise<TestResult> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const r = await fetchImpl(url, { method: "GET", headers, signal: ctl.signal });
    if (r.ok) return { ok: true, message: "Conexión correcta" };
    if (r.status === 401 || r.status === 403) return { ok: false, message: "Credenciales rechazadas por el proveedor" };
    return { ok: false, message: `El proveedor respondió ${r.status}` };
  } catch {
    return { ok: false, message: "No se pudo contactar con el proveedor" };
  } finally {
    clearTimeout(t);
  }
}

export async function testProvider(
  provider: string,
  v: Record<string, string>,
  fetchImpl: Fetch = fetch as unknown as Fetch,
): Promise<TestResult> {
  switch (provider) {
    case "ghl": {
      if (!v.apiKey || !v.locationId) return { ok: false, message: "Faltan API key o Location ID" };
      return get(fetchImpl, `https://services.leadconnectorhq.com/locations/${encodeURIComponent(v.locationId)}`, {
        Authorization: `Bearer ${v.apiKey}`,
        Version: "2021-07-28",
      });
    }
    case "vapi": {
      if (!v.apiKey) return { ok: false, message: "Falta la API key" };
      return get(fetchImpl, "https://api.vapi.ai/assistant?limit=1", { Authorization: `Bearer ${v.apiKey}` });
    }
    case "meta": {
      if (!v.capiAccessToken) return { ok: false, message: "Falta el token de acceso" };
      return get(fetchImpl, `https://graph.facebook.com/v21.0/me?access_token=${encodeURIComponent(v.capiAccessToken)}`, {});
    }
    case "redsys": {
      // Sin red: Redsys no ofrece un ping; se valida que la configuración sea utilizable
      if (!v.merchantCode || !v.merchantKey) return { ok: false, message: "Faltan código de comercio o clave" };
      const raw = Buffer.from(v.merchantKey, "base64");
      if (raw.length < 16) return { ok: false, message: "La clave de firma no tiene la longitud esperada" };
      if (!["test", "production"].includes(v.environment ?? "test")) return { ok: false, message: "Entorno no válido" };
      return { ok: true, message: `Configuración válida (${v.environment ?? "test"}). El cobro real se verifica con una operación de prueba.` };
    }
    default:
      return { ok: false, message: "Proveedor sin prueba disponible" };
  }
}
