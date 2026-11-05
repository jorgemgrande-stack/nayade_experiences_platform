/**
 * Social Token Net Complete — integración de Comunidades y Tokens internos (acceso a datos). Lógica pura en
 * shared/stnComplete.ts. NO es un tercer motor:
 *  - Los hechos se leen del punto de extensión de Comunidades: `onCommunityEvent` (al momento, en el contexto de la
 *    empresa) y `listCommunityEvents` (pasada de recuperación por si un aviso se perdió: reinicio, fallo puntual).
 *  - Los puntos se escriben con el libro de los tokens internos (`postMovementInTx`, monedero bloqueado, idempotencia
 *    por clave) y se retiran con `reverseMovementInTx` (anulación de signo contrario, una sola vez).
 *
 * Garantías:
 *  - Un hecho da puntos UNA sola vez: `loyalty_community_awards.event_key` es única y el movimiento lleva la clave
 *    `community:<event_key>`; el aviso inmediato y la recuperación pueden coincidir sin duplicar nada.
 *  - Límites por persona y periodo contados bajo el bloqueo del monedero (dos hechos simultáneos de la misma persona
 *    quedan en serie) y medidos en la fecha del hecho (la recuperación decide igual que el aviso inmediato).
 *  - Ocultar una publicación o un comentario y rechazar una propuesta retiran sus puntos si la regla lo indica.
 *  - Solo con las DOS capacidades activas (paquete Complete o módulos sueltos). Sin una de ellas no se premia nada y los
 *    datos se conservan: al volver, todo sigue donde estaba.
 *  - Miembro → cliente del CRM sin identidades nuevas (server/stnIntegration.ts); sin cliente, el hecho no da puntos.
 */
import { sql, type SQL } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { getDb } from "./db";
import { opsLog } from "./_core/ops/log";
import { peekTenantContext } from "./_core/tenant";
import { listCommunityEvents, onCommunityEvent, type CommunityDomainEvent } from "./communities/events";
import { campaignExtraInTx, ensureWallet, getProgram, isMissingLoyaltySchema, listCampaigns, periodSinceMs, postMovementInTx, reverseMovementInTx, type Actor, type LoyaltyExec } from "./loyaltyDb";
import { clientIdForMember, stnIntegrationActive } from "./stnIntegration";
import { addMonthsMs, findCommunityCampaign, type LimitPeriod } from "../shared/loyalty";
import { PARTICIPATION_EVENTS } from "../shared/communities";
import {
  CATCH_UP_WINDOW_MS,
  COMMUNITY_REWARD_EVENTS,
  REVOKING_EVENTS,
  isRewardEvent,
  isRevokingEvent,
  pickCommunityRule,
  type CommunityRewardEvent,
  type CommunityRule,
  type SkipReason,
} from "../shared/stnComplete";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

const SYSTEM: Actor = { id: null, name: "Comunidades" };

async function db(): Promise<Db> {
  const d = await getDb();
  if (!d) throw new Error("Database not available");
  return d;
}

async function rows<T>(exec: LoyaltyExec, q: SQL): Promise<T[]> {
  const [r] = (await exec.execute(q)) as unknown as [T[]];
  return r;
}

async function header(exec: LoyaltyExec, q: SQL): Promise<{ affectedRows: number; insertId: number }> {
  const [r] = (await exec.execute(q)) as unknown as [{ affectedRows: number; insertId: number }];
  return { affectedRows: r.affectedRows ?? 0, insertId: Number(r.insertId ?? 0) };
}

async function inTx<T>(fn: (tx: LoyaltyExec) => Promise<T>): Promise<T> {
  const d = await db();
  return d.transaction((tx) => fn(tx as unknown as LoyaltyExec));
}

const n = (v: unknown): number => Number(v ?? 0);
const nOrNull = (v: unknown): number | null => (v == null ? null : Number(v));

export async function assertStn(write: boolean): Promise<void> {
  if (!(await stnIntegrationActive(write))) {
    throw new TRPCError({ code: "FORBIDDEN", message: "La integración de comunidades y puntos necesita Social Token Net Complete (o Comunidades y Tokens internos a la vez)." });
  }
}

// ─── Reglas de participación ─────────────────────────────────────────────────

function toRule(r: any): CommunityRule {
  return {
    id: n(r.id), name: r.name, eventType: r.event_type as CommunityRewardEvent, communityId: nOrNull(r.community_id), points: n(r.points), limitCount: nOrNull(r.limit_count),
    limitPeriod: (r.limit_period ?? null) as LimitPeriod | null, revokeHidden: !!n(r.revoke_hidden), priority: n(r.priority), active: !!n(r.active),
    startsAt: nOrNull(r.starts_at), endsAt: nOrNull(r.ends_at), createdAt: n(r.created_at),
  };
}

export async function listCommunityRules(exec?: LoyaltyExec, onlyActive = false): Promise<CommunityRule[]> {
  const r = await rows<any>(exec ?? (await db()), onlyActive
    ? sql`SELECT * FROM loyalty_community_rules WHERE active = 1 ORDER BY priority DESC, id`
    : sql`SELECT * FROM loyalty_community_rules ORDER BY active DESC, priority DESC, id`);
  return r.map(toRule);
}

export type CommunityRuleInput = Omit<CommunityRule, "id" | "createdAt">;

export async function saveCommunityRule(id: number | null, r: CommunityRuleInput): Promise<{ id: number }> {
  const d = await db();
  const now = Date.now();
  if (r.communityId != null) {
    const [c] = await rows<any>(d, sql`SELECT id FROM communities WHERE id = ${r.communityId}`);
    if (!c) throw new TRPCError({ code: "NOT_FOUND", message: "Comunidad no encontrada" });
  }
  if (id) {
    const res = await header(d, sql`UPDATE loyalty_community_rules SET name = ${r.name}, event_type = ${r.eventType}, community_id = ${r.communityId}, points = ${r.points},
      limit_count = ${r.limitCount}, limit_period = ${r.limitPeriod}, revoke_hidden = ${r.revokeHidden ? 1 : 0}, priority = ${r.priority}, active = ${r.active ? 1 : 0},
      starts_at = ${r.startsAt}, ends_at = ${r.endsAt}, updated_at = ${now} WHERE id = ${id}`);
    if (!res.affectedRows) throw new TRPCError({ code: "NOT_FOUND", message: "Regla no encontrada" });
    return { id };
  }
  const res = await header(d, sql`INSERT INTO loyalty_community_rules (name, event_type, community_id, points, limit_count, limit_period, revoke_hidden, priority, active, starts_at, ends_at, created_at, updated_at)
    VALUES (${r.name}, ${r.eventType}, ${r.communityId}, ${r.points}, ${r.limitCount}, ${r.limitPeriod}, ${r.revokeHidden ? 1 : 0}, ${r.priority}, ${r.active ? 1 : 0}, ${r.startsAt}, ${r.endsAt}, ${now}, ${now})`);
  return { id: res.insertId };
}

// ─── Premiar y retirar ───────────────────────────────────────────────────────

export type HandleResult = { outcome: "granted"; points: number; clientId: number; ledgerId: number } | { outcome: "revoked"; count: number } | { outcome: "skipped"; reason: SkipReason };

/** ¿Sigue visible el contenido del hecho? (la recuperación no premia lo que ya se ocultó o rechazó). */
async function contentGone(exec: LoyaltyExec, e: CommunityDomainEvent): Promise<boolean> {
  if (e.targetId == null) return false;
  if (e.type === "member.posted") return (await rows<any>(exec, sql`SELECT id FROM community_posts WHERE id = ${e.targetId} AND status = 'hidden'`)).length > 0;
  if (e.type === "member.commented") return (await rows<any>(exec, sql`SELECT id FROM community_comments WHERE id = ${e.targetId} AND hidden = 1`)).length > 0;
  if (e.type === "member.proposed") return (await rows<any>(exec, sql`SELECT id FROM community_proposals WHERE id = ${e.targetId} AND status = 'rejected'`)).length > 0;
  return false;
}

async function awardEvent(e: CommunityDomainEvent): Promise<HandleResult> {
  if (!e.userId) return { outcome: "skipped", reason: "no_client" };
  const d = await db();
  const [done] = await rows<any>(d, sql`SELECT id FROM loyalty_community_awards WHERE event_key = ${e.key}`);
  if (done) return { outcome: "skipped", reason: "already" };
  const program = await getProgram(d);
  if (!program.enabled) return { outcome: "skipped", reason: "program_off" };
  const rule = pickCommunityRule(await listCommunityRules(d, true), { type: e.type, communityId: e.communityId, occurredAt: e.occurredAt });
  if (!rule) return { outcome: "skipped", reason: "no_rule" };
  if (await contentGone(d, e)) return { outcome: "skipped", reason: "content_gone" };
  const clientId = await clientIdForMember(e.communityId, e.userId, d);
  if (!clientId) return { outcome: "skipped", reason: "no_client" };
  await ensureWallet(clientId);
  return inTx(async (tx): Promise<HandleResult> => {
    const now = Date.now();
    // Orden fijo de bloqueo (como el resto del libro): monedero → campaña
    await tx.execute(sql`SELECT id FROM loyalty_wallets WHERE client_id = ${clientId} FOR UPDATE`);
    const [again] = await rows<any>(tx, sql`SELECT id FROM loyalty_community_awards WHERE event_key = ${e.key}`);
    if (again) return { outcome: "skipped", reason: "already" };
    if (rule.limitCount != null) {
      const since = periodSinceMs(rule.limitPeriod, e.occurredAt);
      const [c] = await rows<any>(tx, since == null
        ? sql`SELECT COUNT(*) AS c FROM loyalty_community_awards WHERE rule_id = ${rule.id} AND client_id = ${clientId} AND status = 'granted'`
        : sql`SELECT COUNT(*) AS c FROM loyalty_community_awards WHERE rule_id = ${rule.id} AND client_id = ${clientId} AND status = 'granted' AND occurred_at >= ${since}`);
      if (n(c?.c) >= rule.limitCount) return { outcome: "skipped", reason: "limit" };
    }
    const { campaign, extra, requestedExtra } = await campaignExtraInTx(tx, findCommunityCampaign(await listCampaigns(tx, true), e.communityId, now), rule.points, clientId, now);
    const points = rule.points + extra;
    const mv = await postMovementInTx(tx, {
      clientId, kind: "emision", direction: "credit", amount: points, reason: rule.name, sourceType: "community", sourceId: String(e.id), sourceRef: e.type,
      campaignId: extra > 0 ? campaign!.id : null, campaignPoints: extra, expiresAt: program.expiryMonths ? addMonthsMs(now, program.expiryMonths) : null,
      idemKey: `community:${e.key}`, metadata: { eventKey: e.key, communityId: e.communityId, communityRuleId: rule.id, targetType: e.targetType, targetId: e.targetId, campaignExtraRequested: requestedExtra },
      actor: SYSTEM,
    });
    await tx.execute(sql`INSERT INTO loyalty_community_awards (event_id, event_key, event_type, community_id, user_id, client_id, rule_id, campaign_id, target_type, target_id, ledger_id, points, status, occurred_at, created_at)
      VALUES (${e.id}, ${e.key}, ${e.type}, ${e.communityId}, ${e.userId}, ${clientId}, ${rule.id}, ${extra > 0 ? campaign!.id : null}, ${e.targetType}, ${e.targetId}, ${mv.ledgerId}, ${mv.amount}, 'granted', ${e.occurredAt}, ${now})`);
    return { outcome: "granted", points: mv.amount, clientId, ledgerId: mv.ledgerId };
  });
}

const REVOKE_REASON: Record<keyof typeof REVOKING_EVENTS, string> = {
  "post.hidden": "Publicación ocultada en la comunidad",
  "comment.hidden": "Comentario ocultado en la comunidad",
  "proposal.rejected": "Propuesta rechazada en la comunidad",
};

async function revokeForEvent(e: CommunityDomainEvent & { type: keyof typeof REVOKING_EVENTS }): Promise<HandleResult> {
  if (e.targetId == null || !e.targetType) return { outcome: "revoked", count: 0 };
  const d = await db();
  const list = await rows<any>(d, sql`SELECT a.id, a.client_id, a.rule_id FROM loyalty_community_awards a JOIN loyalty_community_rules r ON r.id = a.rule_id
    WHERE a.event_type = ${REVOKING_EVENTS[e.type]} AND a.target_type = ${e.targetType} AND a.target_id = ${e.targetId} AND a.status = 'granted' AND r.revoke_hidden = 1`);
  let count = 0;
  for (const a of list) {
    const done = await inTx(async (tx) => {
      await tx.execute(sql`SELECT id FROM loyalty_wallets WHERE client_id = ${a.client_id} FOR UPDATE`);
      const [cur] = await rows<any>(tx, sql`SELECT ledger_id, status FROM loyalty_community_awards WHERE id = ${a.id} FOR UPDATE`);
      if (!cur || cur.status !== "granted") return false;
      await reverseMovementInTx(tx, n(cur.ledger_id), REVOKE_REASON[e.type], SYSTEM);
      await tx.execute(sql`UPDATE loyalty_community_awards SET status = 'revoked', revoked_at = ${Date.now()}, revoke_reason = ${REVOKE_REASON[e.type]} WHERE id = ${a.id}`);
      return true;
    });
    if (done) count++;
  }
  return { outcome: "revoked", count };
}

/** Procesa un hecho de comunidad (premia, retira o nada). Idempotente: repetirlo no cambia nada. */
export async function handleCommunityEvent(e: CommunityDomainEvent): Promise<HandleResult> {
  if (!isRewardEvent(e.type) && !isRevokingEvent(e.type)) return { outcome: "skipped", reason: "not_reward_event" };
  if (!(await stnIntegrationActive(true))) {
    // Sin la integración, el hecho no da puntos ni ahora ni después: la recuperación no lo procesará al volver
    await saveCursor(e.id).catch(() => undefined);
    return { outcome: "skipped", reason: "integration_off" };
  }
  try {
    if (isRevokingEvent(e.type)) return await revokeForEvent(e as CommunityDomainEvent & { type: keyof typeof REVOKING_EVENTS });
    return await awardEvent(e);
  } catch (err) {
    if (isMissingLoyaltySchema(err)) return { outcome: "skipped", reason: "integration_off" };
    throw err;
  }
}

// ─── Pasada de recuperación ──────────────────────────────────────────────────

const CATCH_UP_TYPES = [...COMMUNITY_REWARD_EVENTS, ...(Object.keys(REVOKING_EVENTS) as Array<keyof typeof REVOKING_EVENTS>)];

/**
 * Recorre los hechos de comunidad posteriores a la última posición (solo los de las últimas 72 h: no reparte puntos de
 * periodos sin la integración) y procesa los que el aviso inmediato no llegó a procesar. Idempotente; dos pasadas a la
 * vez no duplican nada.
 */
export async function catchUpCommunityRewards(opts: { maxBatches?: number; now?: number } = {}): Promise<{ processed: number; granted: number; revoked: number; lastEventId: number }> {
  const out = { processed: 0, granted: 0, revoked: 0, lastEventId: 0 };
  if (!(await stnIntegrationActive(true))) return out;
  try {
    const d = await db();
    const [cur] = await rows<any>(d, sql`SELECT last_event_id FROM loyalty_community_sync WHERE id = 1`);
    let after = n(cur?.last_event_id);
    const minAt = (opts.now ?? Date.now()) - CATCH_UP_WINDOW_MS;
    for (let batch = 0; batch < (opts.maxBatches ?? 10); batch++) {
      const events = await listCommunityEvents({ afterId: after, limit: 500, types: CATCH_UP_TYPES });
      if (!events.length) break;
      for (const e of events) {
        if (e.occurredAt >= minAt) {
          const r = await handleCommunityEvent(e).catch((err) => {
            opsLog("warn", "SocialTokenNet", "catch_up_event_failed", { key: e.key, error: err instanceof Error ? err.message : String(err) });
            return null;
          });
          if (r === null) {
            // Se detiene en el hecho que falló: la siguiente pasada lo reintenta
            await saveCursor(after);
            out.lastEventId = after;
            return out;
          }
          out.processed++;
          if (r.outcome === "granted") out.granted++;
          if (r.outcome === "revoked") out.revoked += r.count;
        }
        after = e.id;
      }
      await saveCursor(after);
      if (events.length < 500) break;
    }
    out.lastEventId = after;
    return out;
  } catch (e) {
    if (isMissingLoyaltySchema(e)) return out;
    throw e;
  }
}

async function saveCursor(lastEventId: number): Promise<void> {
  const now = Date.now();
  // Nunca retrocede (dos pasadas a la vez)
  await (await db()).execute(sql`INSERT INTO loyalty_community_sync (id, last_event_id, updated_at) VALUES (1, ${lastEventId}, ${now})
    ON DUPLICATE KEY UPDATE last_event_id = GREATEST(last_event_id, VALUES(last_event_id)), updated_at = VALUES(updated_at)`);
}

// ─── Suscripción al punto de extensión ───────────────────────────────────────

const CATCH_UP_EVERY_MS = 10 * 60_000;
const lastCatchUp = new Map<string, number>();
let unsubscribe: (() => void) | null = null;

/**
 * Conecta la integración con Comunidades (una sola vez por proceso). Cada hecho se procesa al momento y, como mucho
 * cada 10 minutos por empresa, se aprovecha para la pasada de recuperación (sin trabajos programados aparte).
 */
export function registerStnCompleteIntegration(): () => void {
  if (unsubscribe) return unsubscribe;
  const off = onCommunityEvent(async (e) => {
    await handleCommunityEvent(e);
    const tenant = peekTenantContext()?.tenantId ?? "default";
    const now = Date.now();
    if (now - (lastCatchUp.get(tenant) ?? 0) >= CATCH_UP_EVERY_MS) {
      lastCatchUp.set(tenant, now);
      await catchUpCommunityRewards({ maxBatches: 2 });
    }
  });
  unsubscribe = () => {
    off();
    unsubscribe = null;
  };
  return unsubscribe;
}

// ─── Estadísticas y administración integrada ─────────────────────────────────

export interface CommunityLoyaltyStats {
  communityId: number;
  name: string;
  slug: string;
  status: string;
  activeMembers: number;
  /** Hechos de participación (total y últimos 30 días). */
  participation: number;
  participation30: number;
  /** Puntos concedidos por participar (incluida la campaña) y retirados al ocultar o rechazar. */
  pointsIssued: number;
  pointsRevoked: number;
  /** Puntos extra de las campañas de esta comunidad (compras y participación; las anulaciones restan). */
  campaignPoints: number;
  /** Puntos canjeados por sus miembros (todas sus recompensas) y canjes de recompensas exclusivas de la comunidad. */
  memberRedeemed: number;
  exclusiveRedemptions: number;
}

const PARTICIPATION = sql.join(PARTICIPATION_EVENTS.map((t) => sql`${t}`), sql`, `);

/** Miembros activos con su cliente del CRM resuelto (enlace o correo de la cuenta). */
const MEMBER_CLIENT = sql`SELECT m.id AS member_id, m.community_id, m.user_id, m.status, COALESCE(m.client_id, (SELECT cl.id FROM clients cl WHERE LOWER(cl.email) = LOWER(u.email) AND u.email <> '' ORDER BY cl.id LIMIT 1)) AS client_id
  FROM community_members m LEFT JOIN users u ON u.id = m.user_id`;

export async function unifiedStats(): Promise<CommunityLoyaltyStats[]> {
  const d = await db();
  const communities = await rows<any>(d, sql`SELECT id, name, slug, status FROM communities ORDER BY status, name`);
  const since30 = Date.now() - 30 * 86_400_000;
  const members = await rows<any>(d, sql`SELECT community_id, COUNT(*) AS c FROM community_members WHERE status = 'active' GROUP BY community_id`);
  const part = await rows<any>(d, sql`SELECT community_id, COUNT(*) AS c, COALESCE(SUM(created_at >= ${since30}), 0) AS c30 FROM community_activity WHERE type IN (${PARTICIPATION}) GROUP BY community_id`);
  const awards = await rows<any>(d, sql`SELECT community_id, COALESCE(SUM(points), 0) AS issued, COALESCE(SUM(CASE WHEN status = 'revoked' THEN points ELSE 0 END), 0) AS revoked FROM loyalty_community_awards GROUP BY community_id`);
  const camp = await rows<any>(d, sql`SELECT c.scope_id AS community_id, COALESCE(SUM(l.campaign_points), 0) AS p FROM loyalty_ledger l JOIN loyalty_campaigns c ON c.id = l.campaign_id
    WHERE c.scope = 'community' GROUP BY c.scope_id`);
  const redeemed = await rows<any>(d, sql`SELECT mc.community_id, COALESCE(SUM(CASE WHEN l.kind = 'canje' THEN l.amount WHEN l.kind = 'anulacion' AND l.source_type = 'redemption' THEN -l.amount ELSE 0 END), 0) AS p
    FROM (SELECT DISTINCT community_id, client_id FROM (${MEMBER_CLIENT}) x WHERE x.status = 'active' AND x.client_id IS NOT NULL) mc
    JOIN loyalty_ledger l ON l.client_id = mc.client_id AND l.source_type = 'redemption' GROUP BY mc.community_id`);
  const exclusive = await rows<any>(d, sql`SELECT rc.community_id, COUNT(*) AS c FROM loyalty_reward_communities rc JOIN loyalty_redemptions r ON r.reward_id = rc.reward_id
    WHERE rc.active = 1 AND r.status IN ('emitido', 'usado') GROUP BY rc.community_id`);
  const by = (list: any[], id: number, f: string) => n(list.find((x) => n(x.community_id) === id)?.[f]);
  return communities.map((c) => {
    const id = n(c.id);
    return {
      communityId: id, name: c.name, slug: c.slug, status: c.status, activeMembers: by(members, id, "c"), participation: by(part, id, "c"), participation30: by(part, id, "c30"),
      pointsIssued: by(awards, id, "issued"), pointsRevoked: by(awards, id, "revoked"), campaignPoints: by(camp, id, "p"), memberRedeemed: Math.max(0, by(redeemed, id, "p")),
      exclusiveRedemptions: by(exclusive, id, "c"),
    };
  });
}

export interface TopMember {
  userId: number | null;
  clientId: number | null;
  name: string;
  email: string | null;
  participation: number;
  points: number;
  balance: number | null;
}

/** Miembros con más participación y con más puntos ganados participando (de una comunidad o de todas). */
export async function topMembers(communityId: number | null, limit = 10): Promise<{ byParticipation: TopMember[]; byPoints: TopMember[] }> {
  const d = await db();
  const inCommunity = communityId ? sql` AND a.community_id = ${communityId}` : sql``;
  const byPart = await rows<any>(d, sql`SELECT a.actor_user_id AS user_id, COUNT(*) AS c, u.name, u.email FROM community_activity a LEFT JOIN users u ON u.id = a.actor_user_id
    WHERE a.type IN (${PARTICIPATION}) AND a.actor_user_id IS NOT NULL${inCommunity} GROUP BY a.actor_user_id, u.name, u.email ORDER BY c DESC, a.actor_user_id LIMIT ${limit}`);
  const byPts = await rows<any>(d, sql`SELECT a.client_id, SUM(a.points) AS p, COUNT(*) AS c, cl.name, cl.email, w.balance FROM loyalty_community_awards a
    LEFT JOIN clients cl ON cl.id = a.client_id LEFT JOIN loyalty_wallets w ON w.client_id = a.client_id
    WHERE a.status = 'granted'${inCommunity} GROUP BY a.client_id, cl.name, cl.email, w.balance ORDER BY p DESC, a.client_id LIMIT ${limit}`);
  // Puntos por participar de los más participativos (por su cuenta de usuario)
  const userIds = byPart.map((x) => n(x.user_id));
  const ptsByUser = userIds.length
    ? await rows<any>(d, sql`SELECT a.user_id, MAX(a.client_id) AS client_id, SUM(a.points) AS p FROM loyalty_community_awards a WHERE a.status = 'granted' AND a.user_id IN (${sql.join(userIds.map((i) => sql`${i}`), sql`, `)})${inCommunity} GROUP BY a.user_id`)
    : [];
  return {
    byParticipation: byPart.map((x) => {
      const p = ptsByUser.find((y) => n(y.user_id) === n(x.user_id));
      return { userId: n(x.user_id), clientId: p ? n(p.client_id) : null, name: x.name || x.email || `Usuario ${x.user_id}`, email: x.email ?? null, participation: n(x.c), points: n(p?.p), balance: null };
    }),
    byPoints: byPts.map((x) => ({ userId: null, clientId: n(x.client_id), name: x.name || `Cliente ${x.client_id}`, email: x.email ?? null, participation: n(x.c), points: n(x.p), balance: nOrNull(x.balance) })),
  };
}

/** Desde la comunidad: saldo de puntos de cada miembro (con su cliente del CRM) y lo ganado participando en ella. */
export async function memberPoints(communityId: number): Promise<Array<{ memberId: number; clientId: number | null; balance: number | null; communityPoints: number }>> {
  const d = await db();
  const list = await rows<any>(d, sql`SELECT x.member_id, x.client_id, w.balance,
      (SELECT COALESCE(SUM(a.points), 0) FROM loyalty_community_awards a WHERE a.community_id = ${communityId} AND a.user_id = x.user_id AND a.status = 'granted') AS cp
    FROM (${MEMBER_CLIENT} WHERE m.community_id = ${communityId}) x LEFT JOIN loyalty_wallets w ON w.client_id = x.client_id`);
  return list.map((r) => ({ memberId: n(r.member_id), clientId: nOrNull(r.client_id), balance: r.client_id == null ? null : n(r.balance), communityPoints: n(r.cp) }));
}

/** Desde el monedero: comunidades del cliente (por el enlace del miembro o el correo de su cuenta) y lo ganado en cada una. */
export async function walletCommunities(clientId: number): Promise<Array<{ communityId: number; name: string; role: string; status: string; points: number }>> {
  const d = await db();
  const list = await rows<any>(d, sql`SELECT x.community_id, x.user_id, x.status, m.role, c.name,
      (SELECT COALESCE(SUM(a.points), 0) FROM loyalty_community_awards a WHERE a.community_id = x.community_id AND a.client_id = ${clientId} AND a.status = 'granted') AS p
    FROM (${MEMBER_CLIENT}) x JOIN community_members m ON m.id = x.member_id JOIN communities c ON c.id = x.community_id
    WHERE x.client_id = ${clientId} ORDER BY c.name`);
  return list.map((r) => ({ communityId: n(r.community_id), name: r.name, role: r.role, status: r.status, points: n(r.p) }));
}

/** Comunidades para los selectores (reglas, campañas y recompensas exclusivas). */
export async function communityOptions(): Promise<Array<{ id: number; name: string; status: string }>> {
  const r = await rows<any>(await db(), sql`SELECT id, name, status FROM communities ORDER BY status, name`);
  return r.map((c) => ({ id: n(c.id), name: c.name, status: c.status }));
}

/** Reserva una recompensa a los miembros de esas comunidades (lista vacía = para todos los clientes). */
export async function setRewardCommunities(rewardId: number, communityIds: number[]): Promise<{ communityIds: number[] }> {
  const ids = Array.from(new Set(communityIds)).sort((a, b) => a - b);
  return inTx(async (tx) => {
    const [rw] = await rows<any>(tx, sql`SELECT id FROM loyalty_rewards WHERE id = ${rewardId} FOR UPDATE`);
    if (!rw) throw new TRPCError({ code: "NOT_FOUND", message: "Recompensa no encontrada" });
    if (ids.length) {
      const found = await rows<any>(tx, sql`SELECT id FROM communities WHERE id IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})`);
      if (found.length !== ids.length) throw new TRPCError({ code: "NOT_FOUND", message: "Comunidad no encontrada" });
    }
    const now = Date.now();
    const keep = ids.length ? sql` AND community_id NOT IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})` : sql``;
    // Nada se borra: la comunidad que se quita queda inactiva
    await tx.execute(sql`UPDATE loyalty_reward_communities SET active = 0, updated_at = ${now} WHERE reward_id = ${rewardId} AND active = 1${keep}`);
    for (const c of ids) {
      await tx.execute(sql`INSERT INTO loyalty_reward_communities (reward_id, community_id, active, created_at, updated_at) VALUES (${rewardId}, ${c}, 1, ${now}, ${now})
        ON DUPLICATE KEY UPDATE active = 1, updated_at = VALUES(updated_at)`);
    }
    return { communityIds: ids };
  });
}
