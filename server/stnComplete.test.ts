/**
 * Social Token Net Complete — lógica pura (reglas de participación, campañas por comunidad) y licencias: el paquete
 * `social-token-net-complete` concede las dos capacidades (comunidades y tokens) a partir de sus componentes, sin
 * duplicarlas, con el motor de licencias de siempre.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { COMMUNITY_REWARD_EVENTS, REVOKING_EVENTS, STN_CAPABILITIES, isRevocableEvent, isRevokingEvent, isRewardEvent, pickCommunityRule, type CommunityRule } from "../shared/stnComplete";
import { PARTICIPATION_EVENTS } from "../shared/communities";
import { findApplicableCampaign, findCommunityCampaign, type LoyaltyCampaign } from "../shared/loyalty";
import { capabilitiesOf } from "./licensing/service";
import { seedElephantSource } from "./catalog/seed";
import { quoteCatalogFromSite } from "./catalog/snapshot";
import { WebAdminService } from "./web/service";
import { MemoryWebStore } from "./web/store";
import { BUILTIN_MODULES } from "./_core/modules/builtin";
import { PRODUCTS } from "./catalog/elephantSourceV1";

const T0 = Date.UTC(2026, 10, 5, 10);
const rule = (over: Partial<CommunityRule>): CommunityRule => ({
  id: 1, name: "Publicar", eventType: "member.posted", communityId: null, points: 10, limitCount: null, limitPeriod: null, revokeHidden: true, priority: 0, active: true,
  startsAt: null, endsAt: null, createdAt: T0 - 1000, ...over,
});

describe("reglas de participación", () => {
  it("solo hechos de participación dan puntos; ocultar y rechazar retiran los de su contenido", () => {
    expect([...COMMUNITY_REWARD_EVENTS].sort()).toEqual([...PARTICIPATION_EVENTS].sort());
    expect(isRewardEvent("member.posted")).toBe(true);
    expect(isRewardEvent("post.hidden")).toBe(false);
    expect(isRevokingEvent("post.hidden") && isRevokingEvent("comment.hidden") && isRevokingEvent("proposal.rejected")).toBe(true);
    expect(isRevokingEvent("member.blocked")).toBe(false);
    expect(REVOKING_EVENTS).toEqual({ "post.hidden": "member.posted", "comment.hidden": "member.commented", "proposal.rejected": "member.proposed" });
    expect(isRevocableEvent("member.posted")).toBe(true);
    expect(isRevocableEvent("member.reacted")).toBe(false);
  });

  it("elige una sola regla: tipo, comunidad, vigencia en la fecha del hecho y nunca retroactiva", () => {
    const e = { type: "member.posted", communityId: 7, occurredAt: T0 };
    expect(pickCommunityRule([rule({ eventType: "member.commented" })], e)).toBeNull();
    expect(pickCommunityRule([rule({ communityId: 8 })], e)).toBeNull();
    expect(pickCommunityRule([rule({ active: false })], e)).toBeNull();
    expect(pickCommunityRule([rule({ createdAt: T0 + 1 })], e)).toBeNull(); // creada después del hecho
    expect(pickCommunityRule([rule({ endsAt: T0 - 1 })], e)).toBeNull();
    expect(pickCommunityRule([rule({ startsAt: T0 + 1 })], e)).toBeNull();
    // Comunidad concreta antes que «todas» a igual prioridad; la prioridad manda
    expect(pickCommunityRule([rule({ id: 1 }), rule({ id: 2, communityId: 7 })], e)?.id).toBe(2);
    expect(pickCommunityRule([rule({ id: 1, priority: 5 }), rule({ id: 2, communityId: 7 })], e)?.id).toBe(1);
    expect(pickCommunityRule([rule({ id: 3 }), rule({ id: 2 })], e)?.id).toBe(2);
  });
});

describe("campañas por comunidad", () => {
  const camp = (over: Partial<LoyaltyCampaign>): LoyaltyCampaign => ({
    id: 1, name: "Club", scope: "community", scopeId: 7, multiplier: 2, bonusPoints: null, budgetPoints: null, perClientLimit: null, limitPeriod: null, priority: 0, active: true,
    startsAt: null, endsAt: null, ...over,
  });
  const lines = [{ productId: 1, categoryId: 1, amount: 10 }];

  it("en compras solo cubre a los miembros de su comunidad (sin la integración, nunca)", () => {
    expect(findApplicableCampaign([camp({})], lines, T0)).toBeNull();
    expect(findApplicableCampaign([camp({})], lines, T0, { communityIds: null })).toBeNull();
    expect(findApplicableCampaign([camp({})], lines, T0, { communityIds: new Set([8]) })).toBeNull();
    expect(findApplicableCampaign([camp({})], lines, T0, { communityIds: new Set([7]) })?.id).toBe(1);
    // Sigue sin apilar: gana la de mayor prioridad
    const all = camp({ id: 2, scope: "all", scopeId: null, priority: 3 });
    expect(findApplicableCampaign([camp({}), all], lines, T0, { communityIds: new Set([7]) })?.id).toBe(2);
  });

  it("en participación solo cuentan las de esa comunidad", () => {
    expect(findCommunityCampaign([camp({ scope: "all", scopeId: null })], 7, T0)).toBeNull();
    expect(findCommunityCampaign([camp({ scopeId: 8 })], 7, T0)).toBeNull();
    expect(findCommunityCampaign([camp({ id: 4 }), camp({ id: 5, priority: 1 })], 7, T0)?.id).toBe(5);
    expect(findCommunityCampaign([camp({ endsAt: T0 - 1 })], 7, T0)).toBeNull();
  });
});

describe("licencias: Social Token Net Complete concede las dos capacidades", () => {
  let byKey: Map<string, any>;

  beforeAll(async () => {
    const webStore = new MemoryWebStore();
    const web = new WebAdminService({ store: webStore, refs: { moduleIds: BUILTIN_MODULES.map((m) => m.id), planIds: () => null }, now: () => T0 });
    await seedElephantSource(web, webStore);
    const catalog = quoteCatalogFromSite(await web.site("published"));
    byKey = new Map(catalog.products.map((p) => [p.key, p]));
  });

  it("el paquete se compone de Comunidades y Tokens internos y sigue «Próximamente» (no contratable aún)", () => {
    const p = PRODUCTS.find((x) => x.key === "social-token-net-complete")!;
    expect(p.draft.catalog.bundleOf).toEqual(["social-token-net-communities", "social-token-net-tokens"]);
    expect(JSON.stringify(p)).toContain("coming_soon");
  });

  it("el motor de licencias de siempre suma las capacidades de sus componentes: comunidades y tokens, una vez cada una", () => {
    const caps = Array.from(capabilitiesOf(byKey.get("social-token-net-complete"), byKey));
    expect(caps.filter((c) => (STN_CAPABILITIES as readonly string[]).includes(c)).sort()).toEqual([...STN_CAPABILITIES].sort());
    expect(new Set(caps).size).toBe(caps.length);
  });

  it("cada módulo suelto concede solo la suya (sin el otro, la integración no aparece)", () => {
    expect(Array.from(capabilitiesOf(byKey.get("social-token-net-communities"), byKey))).toEqual(["social-token-net"]);
    expect(Array.from(capabilitiesOf(byKey.get("social-token-net-tokens"), byKey))).toEqual(["social-token-net-tokens"]);
  });
});
