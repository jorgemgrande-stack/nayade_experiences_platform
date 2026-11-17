/**
 * Estado de la solicitud comercial de un producto del marketplace para la empresa (17/11/2026). Lo calcula el plano
 * de control con lo que de verdad hay en el CRM y en los expedientes de implantación, y el panel lo muestra en la
 * tarjeta y en la ficha para que nadie pida dos veces sin saber que ya hay algo en curso.
 *
 *  - `requested`: solicitud registrada, pendiente de que el equipo la atienda (o expediente recién abierto).
 *  - `contract_pending`: el equipo ha preparado la propuesta; falta que la empresa acepte el contrato.
 *  - `implementation_pending`: contrato aceptado; el equipo prepara y configura el servicio.
 *
 * «Disponible», «Activo» y «No disponible comercialmente» siguen siendo los estados del catálogo y de las licencias
 * (shared/connectMarketplace.ts); esto solo se superpone a lo que todavía no está contratado.
 */
export const CONNECT_REQUEST_STAGES = ["requested", "contract_pending", "implementation_pending"] as const;
export type ConnectRequestStage = (typeof CONNECT_REQUEST_STAGES)[number];

export const CONNECT_REQUEST_STAGE_LABEL: Record<ConnectRequestStage, string> = {
  requested: "Solicitud pendiente",
  contract_pending: "Pendiente de aceptación contractual",
  implementation_pending: "Pendiente de implantación",
};

export const CONNECT_REQUEST_STAGE_TEXT: Record<ConnectRequestStage, string> = {
  requested: "Hemos recibido la solicitud. Nuestro equipo te contactará para preparar la propuesta.",
  contract_pending: "La propuesta está preparada: falta aceptar el contrato. Nada se cobra hasta que lo aceptes.",
  implementation_pending: "Contrato aceptado: estamos preparando y configurando el servicio contigo.",
};

export interface ConnectRequestState {
  stage: ConnectRequestStage;
  /** Referencia de la solicitud (SOL-…) o del expediente de implantación. */
  reference: string;
}

/**
 * Etapa de un expediente de implantación abierto. `available` («comunicada al cliente») ya está en manos de la
 * empresa (lo dicen sus licencias) y `started`/`cancelled` están cerrados: sin etapa.
 */
export function stageOfImplementation(status: string): ConnectRequestStage | null {
  if (status === "requested") return "requested";
  if (status === "proposal") return "contract_pending";
  if (status === "accepted" || status === "ready" || status === "enabled") return "implementation_pending";
  return null;
}

/** Lectura defensiva de lo que envía el plano de control (dato ajeno: nunca se confía en su forma). */
export function parseConnectRequestState(raw: unknown): ConnectRequestState | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { stage?: unknown; reference?: unknown };
  if (!(CONNECT_REQUEST_STAGES as readonly unknown[]).includes(r.stage)) return null;
  if (typeof r.reference !== "string" || !/^[A-Za-z0-9-]{1,40}$/.test(r.reference)) return null;
  return { stage: r.stage as ConnectRequestStage, reference: r.reference };
}
