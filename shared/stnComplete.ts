/**
 * Social Token Net Complete (producto `social-token-net-complete`): integración de Comunidades (`social-token-net`) y
 * Tokens internos (`social-token-net-tokens`). Lógica pura (sin BD ni React): la usan el servidor
 * (server/stnCompleteDb.ts), el panel y las pruebas.
 *
 * No es un tercer motor: los puntos se escriben con el libro de los tokens internos (postMovementInTx) y los hechos se
 * leen del punto de extensión de Comunidades (onCommunityEvent / listCommunityEvents). Solo funciona cuando la empresa
 * tiene las DOS capacidades (el paquete Complete o los dos módulos sueltos); con una sola, cada módulo funciona por su
 * lado y nada de esto aparece.
 */
import type { LimitPeriod } from "./loyalty";
import type { ParticipationEvent } from "./communities";

export const STN_CAPABILITIES = ["social-token-net", "social-token-net-tokens"] as const;

/** Hechos de comunidad que pueden dar puntos (los de participación). */
export const COMMUNITY_REWARD_EVENTS = ["member.joined", "member.posted", "member.commented", "member.reacted", "member.responded", "member.proposed", "member.supported"] as const satisfies readonly ParticipationEvent[];
export type CommunityRewardEvent = (typeof COMMUNITY_REWARD_EVENTS)[number];
export const COMMUNITY_REWARD_EVENT_LABELS: Record<CommunityRewardEvent, string> = {
  "member.joined": "Unirse a una comunidad",
  "member.posted": "Publicar en la comunidad",
  "member.commented": "Comentar una publicación",
  "member.reacted": "Reaccionar («me gusta»)",
  "member.responded": "Responder una encuesta",
  "member.proposed": "Enviar una propuesta",
  "member.supported": "Apoyar una propuesta",
};

/**
 * Hechos de gestión que retiran los puntos de un contenido (si la regla lo indica): ocultar una publicación o un
 * comentario y rechazar una propuesta. Valor: el hecho de participación cuyo premio se retira.
 */
export const REVOKING_EVENTS = {
  "post.hidden": "member.posted",
  "comment.hidden": "member.commented",
  "proposal.rejected": "member.proposed",
} as const satisfies Record<string, CommunityRewardEvent>;
export type RevokingEvent = keyof typeof REVOKING_EVENTS;

/** ¿Puede retirarse el premio de este hecho al ocultar o rechazar su contenido? */
export function isRevocableEvent(e: CommunityRewardEvent): boolean {
  return (Object.values(REVOKING_EVENTS) as string[]).includes(e);
}

export function isRewardEvent(type: string): type is CommunityRewardEvent {
  return (COMMUNITY_REWARD_EVENTS as readonly string[]).includes(type);
}

export function isRevokingEvent(type: string): type is RevokingEvent {
  return Object.prototype.hasOwnProperty.call(REVOKING_EVENTS, type);
}

export const COMMUNITY_RULE_POINTS_MAX = 100_000;

export interface CommunityRule {
  id: number;
  name: string;
  eventType: CommunityRewardEvent;
  /** null = todas las comunidades. */
  communityId: number | null;
  points: number;
  /** Veces que una persona puede ganar puntos con esta regla en el periodo (null = sin límite). */
  limitCount: number | null;
  limitPeriod: LimitPeriod | null;
  /** Retirar los puntos si el contenido se oculta o se rechaza. */
  revokeHidden: boolean;
  priority: number;
  active: boolean;
  startsAt: number | null;
  endsAt: number | null;
  createdAt: number;
}

/**
 * Regla que premia un hecho: activa, del mismo tipo, de esa comunidad (o de todas) y vigente cuando ocurrió el hecho.
 * Nunca retroactiva: un hecho anterior a la creación de la regla no da puntos (la pasada de recuperación no reparte
 * puntos de la actividad antigua al crear una regla). Precedencia: prioridad (mayor) → comunidad concreta antes que
 * «todas» → id más bajo. Un hecho da puntos con UNA sola regla.
 */
export function pickCommunityRule(rules: readonly CommunityRule[], e: { type: string; communityId: number; occurredAt: number }): CommunityRule | null {
  const c = rules
    .filter((r) => r.active && r.eventType === e.type && (r.communityId == null || r.communityId === e.communityId))
    .filter((r) => r.createdAt <= e.occurredAt && (r.startsAt == null || r.startsAt <= e.occurredAt) && (r.endsAt == null || r.endsAt >= e.occurredAt))
    .sort((a, b) => (a.priority !== b.priority ? b.priority - a.priority : (a.communityId == null ? 1 : 0) - (b.communityId == null ? 1 : 0) || a.id - b.id));
  return c[0] ?? null;
}

/** Motivo por el que un hecho no da puntos (para el registro de la pasada de recuperación y las pruebas). */
export type SkipReason = "integration_off" | "program_off" | "not_reward_event" | "no_rule" | "no_client" | "limit" | "content_gone" | "already";

/** Antigüedad máxima de los hechos que recupera la pasada (no reparte puntos de periodos sin la integración activa). */
export const CATCH_UP_WINDOW_MS = 72 * 3600_000;
