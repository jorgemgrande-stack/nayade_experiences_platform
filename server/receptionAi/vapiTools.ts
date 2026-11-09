/**
 * Elephant Reception AI · endpoint de herramientas del asistente de voz (POST /api/vapi/reception/tools) y registro del
 * informe final de cada llamada. Va en server/vapiWebhookRouter.ts (ya montado), fuera de /api/trpc: no cambia la lista
 * blanca de server/authGuard.ts.
 *
 *  - Autenticación: el MISMO secreto del webhook de Vapi de la empresa (credencial `vapi`, campo `webhookSecret`, al
 *    menos 24 caracteres) en la cabecera `x-vapi-secret`, que Vapi envía porque el asistente se sincroniza con él. Sin
 *    secreto utilizable, el endpoint está inactivo (401). Solo multiempresa: la empresa sale del dominio de la petición.
 *  - Sin licencia `reception-ai` activa, sin las tablas o con la recepcionista apagada responde a cada herramienta que
 *    no está disponible (Vapi necesita una respuesta por herramienta para que el asistente siga la conversación).
 */
import express, { type Request, type Response } from "express";
import { getVault } from "../_core/credentials/runtime";
import { isMultiTenant } from "../_core/tenant";
import { checkWebhookSecret } from "../_core/webhookSecret";
import { receptionLicensed, receptionService, RECEPTION_TOOLS_PATH } from "./runtime";
import { unavailableToolResults } from "./service";

async function vapiSecret(): Promise<string> {
  try {
    return (await getVault().resolve("vapi")).webhookSecret ?? "";
  } catch {
    return "";
  }
}

export async function receptionToolsHandler(req: Request, res: Response): Promise<void> {
  if (!isMultiTenant()) {
    res.status(404).json({ error: "No disponible" });
    return;
  }
  const auth = checkWebhookSecret(req.headers["x-vapi-secret"], await vapiSecret());
  if (auth !== "ok") {
    console.warn(JSON.stringify({ ctx: "ReceptionAI", event: "tools_rejected", reason: auth }));
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const payload = req.body ?? {};
  try {
    if (!(await receptionLicensed(true))) {
      res.status(200).json(unavailableToolResults(payload));
      return;
    }
    res.status(200).json(await receptionService().handleToolCalls(payload));
  } catch (e) {
    console.error(JSON.stringify({ ctx: "ReceptionAI", event: "tools_error", error: e instanceof Error ? e.message.slice(0, 200) : "error" }));
    res.status(200).json(unavailableToolResults(payload));
  }
}

/**
 * Informe final de una llamada que llegó al webhook de Vapi (ya autenticado allí): si es del asistente de la
 * recepcionista de esta empresa, se registra en sus conversaciones. Nunca rompe el webhook.
 */
export async function recordReceptionCallReport(payload: unknown): Promise<void> {
  try {
    if (!isMultiTenant()) return;
    const msg = (payload as any)?.message ?? payload;
    if (msg?.type !== "end-of-call-report") return;
    if (!(await receptionLicensed(false))) return;
    await receptionService().recordCallReport(payload);
  } catch (e) {
    // Sin las tablas (empresa sin la migración 0056) u otro fallo: el webhook sigue como siempre
    if (!(e instanceof Error && e.name === "ReceptionNotInstalled")) {
      console.warn(JSON.stringify({ ctx: "ReceptionAI", event: "call_report_error", error: e instanceof Error ? e.message.slice(0, 200) : "error" }));
    }
  }
}

/** Ruta del endpoint de herramientas (cuerpo JSON de 256 KB como mucho). */
export function installReceptionTools(router: express.Router): void {
  router.post(RECEPTION_TOOLS_PATH, express.json({ limit: "256kb" }), (req, res) => void receptionToolsHandler(req, res));
}
