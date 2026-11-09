/**
 * Elephant Voice («Llamadas IA», capacidad `voice-ai`): puesta en marcha del asistente de Vapi de la empresa. Función
 * pura que usan el servidor (voiceSetup.status) y el panel: a partir de los datos reales de la empresa decide qué pasos
 * están hechos.
 *
 * Pasos: clave privada de Vapi guardada y aceptada por Vapi → asistente elegido → número elegido → avisos de llamadas
 * (webhook) configurados en Vapi hacia el dominio de la empresa con su clave de verificación → primera llamada recibida.
 * «Listo» = los cinco hechos. Nada de esto cobra: los minutos de Vapi los factura Vapi en la cuenta de la empresa.
 */

export const VOICE_CAPABILITY = "voice-ai";
export const VOICE_CALLS_PATH = "/admin/atencion-comercial/agente-ia";
export const VOICE_SETUP_PATH = "/admin/atencion-comercial/agente-ia/puesta-en-marcha";
/** Endpoint del Core que recibe los avisos de Vapi (server/vapiWebhookRouter.ts). */
export const VOICE_WEBHOOK_PATH = "/api/vapi/webhook";
/** Mensajes que el asistente envía al Core: el informe final de cada llamada (registro, lead y minutos). */
export const VOICE_SERVER_MESSAGES = ["end-of-call-report"] as const;

export type VoiceStepId = "apiKey" | "assistant" | "phoneNumber" | "webhook" | "testCall";
/** done: hecho · todo: pendiente · blocked: necesita antes otro paso · attention: algo falla */
export type VoiceStepStatus = "done" | "todo" | "blocked" | "attention";

export interface VoiceStep {
  id: VoiceStepId;
  title: string;
  description: string;
  status: VoiceStepStatus;
  detail: string;
}

export interface VoiceSetupFacts {
  /** Bóveda por empresa disponible (multiempresa). */
  available: boolean;
  key: {
    saved: boolean;
    /** Resultado de la última comprobación de la clave posterior a guardarla (null: sin comprobar). */
    check: "connected" | "rejected" | "error" | null;
    checkMessage: string | null;
  };
  assistant: { id: string | null; name: string | null };
  phoneNumber: { id: string | null; number: string | null };
  /** Clave de verificación de llamadas utilizable (al menos 24 caracteres). */
  secretUsable: boolean;
  /** Clave guardada pero demasiado corta para el Core (el webhook la rechaza). */
  secretTooShort: boolean;
  /** Cuándo se configuraron los avisos en Vapi por última vez (ISO). */
  connectedAt: string | null;
  /** Último aviso de Vapi aceptado por el Core para esta empresa (ISO). */
  lastEventAt: string | null;
  /** Última llamada registrada para esta empresa. */
  lastCall: { at: string; durationSeconds: number | null; status: string | null } | null;
}

export interface VoiceSetup {
  steps: VoiceStep[];
  completed: number;
  total: number;
  ready: boolean;
  missing: string[];
}

const fmt = (iso: string) =>
  new Date(iso).toLocaleString("es-ES", { timeZone: "Europe/Madrid", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

/** ¿El último aviso aceptado es posterior a la configuración del webhook? (la llamada de prueba ya entró) */
export function testCallReceived(f: Pick<VoiceSetupFacts, "connectedAt" | "lastEventAt">): boolean {
  if (!f.connectedAt || !f.lastEventAt) return false;
  return Date.parse(f.lastEventAt) >= Date.parse(f.connectedAt);
}

export function voiceSetup(f: VoiceSetupFacts): VoiceSetup {
  const keyOk = f.key.saved && f.key.check === "connected";
  const keyStatus: VoiceStepStatus = keyOk ? "done" : f.key.saved && f.key.check === "rejected" ? "attention" : "todo";
  const assistantDone = keyOk && !!f.assistant.id;
  const phoneDone = keyOk && !!f.phoneNumber.id;
  const webhookDone = assistantDone && phoneDone && f.secretUsable && !!f.connectedAt;
  const callDone = webhookDone && testCallReceived(f);
  const after = (cond: boolean, done: boolean): VoiceStepStatus => (done ? "done" : cond ? "todo" : "blocked");

  const steps: VoiceStep[] = [
    {
      id: "apiKey",
      title: "Pega la clave privada de tu cuenta de Vapi",
      description: "Está en dashboard.vapi.ai, en «API Keys»: usa la «Private Key». Se guarda cifrada en la bóveda de tu empresa y no se vuelve a mostrar.",
      status: keyStatus,
      detail: !f.available
        ? "En esta instalación la cuenta de Vapi la configura el equipo técnico."
        : !f.key.saved
          ? "Todavía no hay ninguna clave guardada."
          : keyOk
            ? "Clave guardada y aceptada por Vapi."
            : f.key.check === "rejected"
              ? "Vapi rechazó la clave guardada: pega la clave privada (no la pública)."
              : `Clave guardada sin comprobar${f.key.checkMessage ? `: ${f.key.checkMessage}` : "."}`,
    },
    {
      id: "assistant",
      title: "Elige el asistente que atiende las llamadas",
      description: "Uno de los asistentes que ya tienes creados en Vapi.",
      status: after(keyOk, assistantDone),
      detail: assistantDone ? `Asistente: ${f.assistant.name ?? f.assistant.id}.` : keyOk ? "Sin elegir." : "Disponible cuando Vapi acepte la clave.",
    },
    {
      id: "phoneNumber",
      title: "Elige el número de teléfono",
      description: "El número de tu cuenta de Vapi al que llaman tus clientes: se le asigna el asistente elegido.",
      status: after(keyOk, phoneDone),
      detail: phoneDone ? `Número: ${f.phoneNumber.number ?? f.phoneNumber.id}.` : keyOk ? "Sin elegir." : "Disponible cuando Vapi acepte la clave.",
    },
    {
      id: "webhook",
      title: "Conecta las llamadas con tu panel",
      description:
        "La plataforma configura en Vapi la dirección de tu empresa y una clave de verificación de al menos 24 caracteres: cada llamada terminada llega a «Llamadas IA» de tu empresa (y solo de la tuya).",
      status: f.secretTooShort && !webhookDone ? "attention" : after(assistantDone && phoneDone, webhookDone),
      detail: webhookDone
        ? `Configurado el ${fmt(f.connectedAt!)}.`
        : f.secretTooShort
          ? "La clave de verificación guardada tiene menos de 24 caracteres y la plataforma la rechaza: al conectar se genera una nueva y se configura en Vapi."
          : assistantDone && phoneDone
            ? "Pulsa «Conectar con Vapi»."
            : "Disponible cuando elijas asistente y número.",
    },
    {
      id: "testCall",
      title: "Haz una llamada de prueba",
      description: "Llama al número elegido y cuelga cuando quieras: al terminar, Vapi envía el informe de la llamada y aparece aquí.",
      status: after(webhookDone, callDone),
      detail: callDone
        ? `Llamada de prueba recibida: último aviso el ${fmt(f.lastEventAt!)}.`
        : webhookDone
          ? f.lastEventAt
            ? `Aún no ha llegado ninguna llamada desde la conexión (último aviso anterior: ${fmt(f.lastEventAt)}).`
            : "Aún no ha llegado ninguna llamada."
          : "Disponible cuando las llamadas estén conectadas.",
    },
  ];

  const missing: string[] = [];
  if (!keyOk) missing.push("Guardar la clave privada de Vapi (y que Vapi la acepte).");
  if (!assistantDone) missing.push("Elegir el asistente.");
  if (!phoneDone) missing.push("Elegir el número de teléfono.");
  if (!webhookDone) missing.push("Conectar las llamadas con el panel.");
  if (!callDone) missing.push("Recibir una llamada de prueba.");
  return { steps, completed: steps.filter((s) => s.status === "done").length, total: steps.length, ready: missing.length === 0, missing };
}

/** Recurso de Vapi tal y como se muestra en el panel (sin secretos: ni claves ni direcciones completas de terceros). */
export interface VoiceAssistantOption {
  id: string;
  name: string;
  /** core: ya envía sus avisos a esta empresa · other: a otra dirección (se muestra solo su dominio) · none: a ninguna */
  serverTarget: "core" | "other" | "none";
  otherHost: string | null;
}

export interface VoicePhoneOption {
  id: string;
  number: string | null;
  name: string | null;
  provider: string | null;
  assistantId: string | null;
}
