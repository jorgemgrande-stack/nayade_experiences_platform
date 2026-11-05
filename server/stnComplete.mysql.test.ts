/**
 * Social Token Net Complete (comunidades + tokens internos) con la aplicación real sobre MySQL (opt-in,
 * REGISTRY_TEST_DATABASE_URL): dos empresas nuevas desde la baseline y las migraciones de empresa (incluida la 0030).
 * Con una sola de las dos capacidades no hay integración; con las dos, la participación da puntos una sola vez aunque el
 * hecho se repita (aviso inmediato + pasada de recuperación), respeta los límites por persona y periodo, se retira al
 * ocultar o rechazar el contenido, las campañas por comunidad solo alcanzan a sus miembros, las recompensas exclusivas
 * solo las ven y canjean los miembros, cada empresa solo ve lo suyo y desactivar no pierde nada. Clientes ficticios,
 * compras simuladas en el TPV (sin movimientos bancarios).
 */
import crypto from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startEssentialApp, data, errCode, isLicenseDenied, type EssentialApp } from "./essentialApp.testkit";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
const COMM = "social-token-net";
const TOK = "social-token-net-tokens";
const PASS = "clave-de-miembro-segura-1";
const baseRule = { communityId: null, limitCount: null, limitPeriod: null, revokeHidden: true, priority: 0, active: true, startsAt: null, endsAt: null };
const baseCampaign = { scopeId: null, multiplier: null, bonusPoints: null, budgetPoints: null, perClientLimit: null, limitPeriod: null, priority: 0, active: true, startsAt: null, endsAt: null };
const baseReward = { description: null, stock: null, perClientLimit: null, limitPeriod: null, codeValidDays: 30, active: true, startsAt: null, endsAt: null };

describe.skipIf(!URL_)("Social Token Net Complete (aplicación real, dos empresas nuevas)", () => {
  let ess: EssentialApp;
  let adA: string;
  let adB: string;
  let communityId = 0;
  let otherCommunityId = 0;
  let productId = 0;
  let sessionId = 0;
  let rewardId = 0;
  const client: Record<string, number> = {};
  const cookie: Record<string, string> = {};
  const posts: Record<string, number> = {};

  const people = [
    { key: "Lucia", name: "Lucía Ficticia", email: "lucia@socios-a.example" },
    { key: "Marcos", name: "Marcos Ficticio", email: "marcos@socios-a.example" },
    { key: "Ciro", name: "Ciro Ficticio", email: "ciro@socios-a.example" },
  ];
  const key = () => crypto.randomBytes(12).toString("hex");
  const balance = async (who: string) => Number((await ess.sql("a", "SELECT balance FROM loyalty_wallets WHERE client_id = ?", [client[who]]))[0]?.balance ?? 0);
  const awards = async () => Number((await ess.sql("a", "SELECT COUNT(*) AS n FROM loyalty_community_awards"))[0].n);
  const sell = (who: string) =>
    ess.m("a", "tpv.createSale", {
      sessionId, clientId: client[who],
      items: [{ productType: "experience", productId, productName: "Camiseta", quantity: 1, unitPrice: 10 }],
      payments: [{ method: "cash", amount: 10 }],
    }, adA);
  /** Recompensas que ve el cliente en su área de puntos (sin sus códigos ya canjeados ni su historial). */
  const portal = async (who: string) => {
    const url: string = data(await ess.q("a", "loyalty.portalLink", { clientId: client[who] }, adA)).url;
    const html = (await ess.call("a", "GET", url.slice(url.indexOf("/mis-puntos")))).text;
    expect(html).toContain("<h2>Recompensas</h2>");
    return html.split("<h2>Recompensas</h2>")[1].split("<h2>")[0];
  };

  async function activate(email: string): Promise<string> {
    const mail = [...ess.mails].reverse().find((m) => m.to.some((t) => t.email === email) && /Invitación a la comunidad/.test(m.subject));
    expect(mail, `invitación a ${email}`).toBeTruthy();
    const token = /token=([a-f0-9]{64})/.exec(mail!.htmlContent)?.[1];
    expect((await ess.m("a", "public.setPassword", { token, password: PASS })).status).toBe(200);
    const login = await ess.call("a", "POST", "/api/auth/login", { body: { email, password: PASS } });
    expect(login.status).toBe(200);
    return login.cookie!;
  }

  beforeAll(async () => {
    ess = await startEssentialApp(URL_!, "stncomplete");
    adA = await ess.login("a", "admin");
    adB = await ess.login("b", "admin");
    for (const p of people) {
      await ess.sql("a", "INSERT INTO clients (name, email, source) VALUES (?, ?, 'manual')", [p.name, p.email]);
      client[p.key] = (await ess.sql("a", "SELECT id FROM clients WHERE email = ?", [p.email]))[0].id;
    }
    await ess.sql("b", "INSERT INTO clients (name, email, source) VALUES ('Carla Ficticia', 'carla@socios-b.example', 'manual')");
    // TPV de la empresa A para las compras simuladas
    await ess.m("a", "products.createCategory", { slug: "tienda", name: "Tienda" }, adA);
    await ess.m("a", "products.createLocation", { slug: "local", name: "Local" }, adA);
    const [cat] = await ess.sql("a", "SELECT id FROM categories WHERE slug = 'tienda'");
    const [loc] = await ess.sql("a", "SELECT id FROM locations LIMIT 1");
    expect((await ess.m("a", "products.create", { slug: "camiseta", title: "Camiseta", categoryId: cat.id, locationId: loc.id, basePrice: "10.00", taxRate: "21" }, adA)).status).toBe(200);
    productId = (await ess.sql("a", "SELECT id FROM experiences WHERE slug = 'camiseta'"))[0].id;
    await ess.sql("a", "UPDATE experiences SET isPresentialSale = 1 WHERE id = ?", [productId]);
    const reg = data(await ess.m("a", "tpv.createRegister", { name: "Caja" }, adA));
    sessionId = data(await ess.m("a", "tpv.openSession", { registerId: reg.id, openingAmount: 0 }, adA)).id;
  }, 300_000);
  afterAll(async () => {
    await ess?.close();
  });

  it("con una sola de las dos capacidades, cada módulo funciona por su lado y no hay integración", async () => {
    // Solo comunidades: comunidad con Lucía y Marcos (clientes del CRM); publicar no da puntos
    await ess.setCapability("a", COMM, "active");
    const c = await ess.m("a", "communities.admin.create", { name: "Club de Socios", visibility: "private", allowMemberPosts: true, postModeration: "none" }, adA);
    communityId = data(c).id;
    otherCommunityId = data(await ess.m("a", "communities.admin.create", { name: "Club de Remo", visibility: "private", allowMemberPosts: true, postModeration: "none" }, adA)).id;
    const add = await ess.m("a", "communities.admin.members.add", { communityId, clientIds: [client.Lucia, client.Marcos], role: "member" }, adA);
    expect(add.status).toBe(200);
    for (const p of people.slice(0, 2)) cookie[p.key] = await activate(p.email);
    expect(data(await ess.q("a", "communities.admin.integration", undefined, adA))).toEqual({ active: false });
    expect(isLicenseDenied(await ess.q("a", "socialNet.stats", undefined, adA), TOK)).toBe(true);
    expect((await ess.m("a", "communities.member.createPost", { communityId, body: "Antes de los puntos" }, cookie.Lucia)).status).toBe(200);

    // Solo tokens: el programa funciona, la integración no aparece
    await ess.setCapability("a", COMM, null);
    await ess.setCapability("a", TOK, "active");
    expect((await ess.m("a", "loyalty.saveProgram", { enabled: true, pointsName: "puntos", eqPoints: null, eqEuros: null, expiryMonths: null }, adA)).status).toBe(200);
    expect(data(await ess.q("a", "loyalty.overview", undefined, adA)).integration).toBe(false);
    expect(errCode(await ess.q("a", "socialNet.rules", undefined, adA))).toBe("FORBIDDEN");
    expect(errCode(await ess.m("a", "loyalty.saveCampaign", { id: null, campaign: { ...baseCampaign, name: "Socios", scope: "community", scopeId: communityId, multiplier: 2 } }, adA))).toBe("FORBIDDEN");

    // Las dos: integración activa
    await ess.setCapability("a", COMM, "active");
    expect(data(await ess.q("a", "loyalty.overview", undefined, adA)).integration).toBe(true);
    expect(data(await ess.q("a", "communities.admin.integration", undefined, adA))).toEqual({ active: true });
    expect(await awards()).toBe(0);
  });

  it("participación: puntos una sola vez aunque el hecho se repita; nunca retroactiva", async () => {
    const save = (rule: Record<string, unknown>) => ess.m("a", "socialNet.saveRule", { id: null, rule: { ...baseRule, ...rule } }, adA);
    expect((await save({ name: "Publicar en el club", eventType: "member.posted", communityId, points: 10 })).status).toBe(200);
    expect((await save({ name: "Comentar", eventType: "member.commented", points: 3, revokeHidden: false })).status).toBe(200);
    expect((await save({ name: "Me gusta", eventType: "member.reacted", points: 2, limitCount: 2, limitPeriod: "day" })).status).toBe(200);
    expect((await save({ name: "Proponer", eventType: "member.proposed", points: 5 })).status).toBe(200);
    expect((await save({ name: "Unirse", eventType: "member.joined", points: 50 })).status).toBe(200);
    // Una cuenta del equipo sin administración no configura
    const agA = await ess.login("a", "agente");
    expect(errCode(await ess.m("a", "socialNet.saveRule", { id: null, rule: { ...baseRule, name: "No", eventType: "member.posted", points: 1 } }, agA))).toBe("FORBIDDEN");

    const p1 = await ess.m("a", "communities.member.createPost", { communityId, title: "Hola", body: "Primera publicación con puntos" }, cookie.Lucia);
    posts.p1 = data(p1).id;
    expect(await balance("Lucia")).toBe(10);
    const c1 = await ess.m("a", "communities.member.addComment", { postId: posts.p1, body: "¡Bienvenida!" }, cookie.Marcos);
    posts.c1 = data(c1).id;
    expect(await balance("Marcos")).toBe(3);
    // Quitar y volver a dar «me gusta» no repite el premio
    for (let i = 0; i < 3; i++) await ess.m("a", "communities.member.react", { target: "post", targetId: posts.p1 }, cookie.Marcos);
    expect(await balance("Marcos")).toBe(5);
    // La pasada de recuperación no repite nada de lo ya premiado; unirse antes de crear la regla no da puntos
    const before = await awards();
    expect(data(await ess.m("a", "socialNet.catchUp", undefined, adA))).toMatchObject({ granted: 0 });
    expect(data(await ess.m("a", "socialNet.catchUp", undefined, adA))).toMatchObject({ granted: 0 });
    expect(await awards()).toBe(before);
    expect(await balance("Lucia")).toBe(10);
    // Libro: un movimiento por hecho, con su clave
    const ledger = await ess.sql("a", "SELECT idem_key FROM loyalty_ledger WHERE source_type = 'community'");
    expect(ledger).toHaveLength(3);
    expect(new Set(ledger.map((l: any) => l.idem_key)).size).toBe(3);
    // En otra comunidad, la regla de «Club de Socios» no aplica (y Lucía no es miembro)
    expect((await ess.sql("a", "SELECT COUNT(*) AS n FROM loyalty_community_awards WHERE event_type = 'member.joined'"))[0].n).toBe(0);
  });

  it("límites por persona y periodo", async () => {
    posts.p2 = data(await ess.m("a", "communities.member.createPost", { communityId, body: "Segunda" }, cookie.Lucia)).id;
    expect(await balance("Lucia")).toBe(20);
    await ess.m("a", "communities.member.react", { target: "post", targetId: posts.p2 }, cookie.Marcos); // 2.º «me gusta» del día
    expect(await balance("Marcos")).toBe(7);
    await ess.m("a", "communities.member.react", { target: "comment", targetId: posts.c1 }, cookie.Marcos); // 3.º: fuera del límite
    expect(await balance("Marcos")).toBe(7);
    expect((await ess.sql("a", "SELECT COUNT(*) AS n FROM loyalty_community_awards WHERE event_type = 'member.reacted'"))[0].n).toBe(2);
  });

  it("retirada: ocultar o rechazar el contenido retira sus puntos (si la regla lo indica), una sola vez", async () => {
    expect((await ess.m("a", "communities.admin.posts.setStatus", { postId: posts.p2, status: "hidden", note: "Fuera de tema" }, adA)).status).toBe(200);
    expect(await balance("Lucia")).toBe(10);
    // Volver a ocultar (tras mostrarla) no retira dos veces
    await ess.m("a", "communities.admin.posts.setStatus", { postId: posts.p2, status: "published" }, adA);
    await ess.m("a", "communities.admin.posts.setStatus", { postId: posts.p2, status: "hidden", note: "Otra vez" }, adA);
    expect(await balance("Lucia")).toBe(10);
    const [aw] = await ess.sql("a", "SELECT status, revoke_reason FROM loyalty_community_awards WHERE target_type = 'post' AND target_id = ?", [posts.p2]);
    expect(aw).toMatchObject({ status: "revoked", revoke_reason: "Publicación ocultada en la comunidad" });
    // La regla de comentarios no retira
    expect((await ess.m("a", "communities.admin.comments.setHidden", { commentId: posts.c1, hidden: true }, adA)).status).toBe(200);
    expect(await balance("Marcos")).toBe(7);
    // Propuesta rechazada
    const prop = data(await ess.m("a", "communities.member.propose", { communityId, title: "Excursión al faro", description: "Con picnic" }, cookie.Lucia));
    expect(await balance("Lucia")).toBe(15);
    expect((await ess.m("a", "communities.admin.proposals.moderate", { proposalId: prop.id, action: "reject", reasonForMember: "Ya está prevista" }, adA)).status).toBe(200);
    expect(await balance("Lucia")).toBe(10);
    // Libro: la emisión y su anulación quedan (nada se borra)
    expect((await ess.sql("a", "SELECT COUNT(*) AS n FROM loyalty_ledger WHERE source_type = 'community' AND kind = 'anulacion'"))[0].n).toBe(2);
  });

  it("recuperación: un hecho que no llegó a premiarse se premia en la pasada, una sola vez", async () => {
    const [m] = await ess.sql("a", "SELECT user_id FROM community_members WHERE community_id = ? AND client_id = ?", [communityId, client.Marcos]);
    await ess.sql("a", "INSERT INTO community_activity (community_id, actor_user_id, type, target_type, target_id, event_key, data, created_at) VALUES (?, ?, 'member.commented', 'comment', 999999, 'member.commented:999999', NULL, ?)", [communityId, m.user_id, Date.now()]);
    expect(data(await ess.m("a", "socialNet.catchUp", undefined, adA))).toMatchObject({ granted: 1 });
    expect(await balance("Marcos")).toBe(10);
    expect(data(await ess.m("a", "socialNet.catchUp", undefined, adA))).toMatchObject({ granted: 0 });
    expect(await balance("Marcos")).toBe(10);
    // Dos pasadas a la vez sobre el mismo hecho perdido: se premia una sola vez
    await ess.sql("a", "INSERT INTO community_activity (community_id, actor_user_id, type, target_type, target_id, event_key, data, created_at) VALUES (?, ?, 'member.commented', 'comment', 999998, 'member.commented:999998', NULL, ?)", [communityId, m.user_id, Date.now()]);
    const both = await Promise.all([ess.m("a", "socialNet.catchUp", undefined, adA), ess.m("a", "socialNet.catchUp", undefined, adA)]);
    expect(both.map((r) => data(r).granted).reduce((a, b) => a + b, 0)).toBe(1);
    expect(await balance("Marcos")).toBe(13);
    // Hechos de comunidad fuera de la ventana de recuperación (72 h): nunca se reparten tarde
    await ess.sql("a", "INSERT INTO community_activity (community_id, actor_user_id, type, target_type, target_id, event_key, data, created_at) VALUES (?, ?, 'member.commented', 'comment', 999997, 'member.commented:999997', NULL, ?)", [communityId, m.user_id, Date.now() - 4 * 86_400_000]);
    expect(data(await ess.m("a", "socialNet.catchUp", undefined, adA))).toMatchObject({ granted: 0 });
    expect(await balance("Marcos")).toBe(13);
  });

  it("campaña por comunidad: dobla la participación en ella y las compras de sus miembros (no las de quien no es miembro)", async () => {
    expect((await ess.m("a", "loyalty.saveRule", { id: null, rule: { name: "1 punto por euro", trigger: "purchase", actionKey: null, scope: "all", scopeId: null, calc: "per_euro", rate: 1, fixedPoints: null, minSpend: null, maxPoints: null, limitCount: null, limitPeriod: null, priority: 0, active: true, startsAt: null, endsAt: null } }, adA)).status).toBe(200);
    // Sin comunidad elegida no se guarda
    expect((await ess.m("a", "loyalty.saveCampaign", { id: null, campaign: { ...baseCampaign, name: "Socios", scope: "community", multiplier: 2 } }, adA)).status).toBe(400);
    const camp = await ess.m("a", "loyalty.saveCampaign", { id: null, campaign: { ...baseCampaign, name: "Socios ×2", scope: "community", scopeId: communityId, multiplier: 2 } }, adA);
    expect(camp.status).toBe(200);
    posts.p3 = data(await ess.m("a", "communities.member.createPost", { communityId, body: "Con campaña" }, cookie.Lucia)).id;
    expect(await balance("Lucia")).toBe(30);
    expect(data(await sell("Lucia")).loyalty.points).toBe(20);
    expect(await balance("Lucia")).toBe(50);
    expect(data(await sell("Ciro")).loyalty.points).toBe(10);
    // Campaña de otra comunidad: no aplica a los miembros de esta
    await ess.m("a", "loyalty.saveCampaign", { id: data(camp).id, campaign: { ...baseCampaign, name: "Socios ×2", scope: "community", scopeId: otherCommunityId, multiplier: 2 } }, adA);
    expect(data(await sell("Lucia")).loyalty.points).toBe(10);
    await ess.m("a", "loyalty.saveCampaign", { id: data(camp).id, campaign: { ...baseCampaign, name: "Socios ×2", scope: "community", scopeId: communityId, multiplier: 2, active: false } }, adA);
    expect(await balance("Lucia")).toBe(60);
  });

  it("recompensa exclusiva: solo la ven y la canjean los miembros", async () => {
    rewardId = data(await ess.m("a", "loyalty.saveReward", { id: null, reward: { ...baseReward, name: "Cena de socios", costPoints: 5 } }, adA)).id;
    expect(data(await ess.m("a", "socialNet.setRewardCommunities", { rewardId, communityIds: [communityId] }, adA))).toEqual({ communityIds: [communityId] });
    expect((data(await ess.q("a", "loyalty.rewards", undefined, adA)) as any[]).find((r) => r.id === rewardId).communityIds).toEqual([communityId]);
    await ess.m("a", "loyalty.adjust", { clientId: client.Ciro, direction: "credit", amount: 50, reason: "saldo de prueba", key: key() }, adA);
    expect(errCode(await ess.m("a", "loyalty.redeemForClient", { clientId: client.Ciro, rewardId, key: key() }, adA))).toBe("FORBIDDEN");
    const ok = await ess.m("a", "loyalty.redeemForClient", { clientId: client.Lucia, rewardId, key: key() }, adA);
    expect(ok.status).toBe(200);
    expect(await balance("Lucia")).toBe(55);
    expect(await portal("Lucia")).toContain("Cena de socios");
    expect(await portal("Ciro")).not.toContain("Cena de socios");
    // Quitar la exclusividad la abre a todos (sin borrar nada); volver a ponerla la cierra
    expect(data(await ess.m("a", "socialNet.setRewardCommunities", { rewardId, communityIds: [] }, adA))).toEqual({ communityIds: [] });
    expect(await portal("Ciro")).toContain("Cena de socios");
    await ess.m("a", "socialNet.setRewardCommunities", { rewardId, communityIds: [communityId] }, adA);
    expect(await portal("Ciro")).not.toContain("Cena de socios");
    expect((await ess.sql("a", "SELECT COUNT(*) AS n FROM loyalty_reward_communities"))[0].n).toBe(1);
  });

  it("estadísticas unificadas y administración integrada (comunidad ↔ monedero)", async () => {
    const stats = data(await ess.q("a", "socialNet.stats", undefined, adA)) as any[];
    const club = stats.find((s) => s.communityId === communityId);
    // Emitidos por participar: 10 + 3 + 2 + 10 + 2 + 5 + 3 + 3 + 20; retirados: 10 + 5
    expect(club).toMatchObject({ activeMembers: 2, pointsIssued: 58, pointsRevoked: 15, campaignPoints: 20, memberRedeemed: 5, exclusiveRedemptions: 1 });
    expect(club.participation).toBeGreaterThan(0);
    const top = data(await ess.q("a", "socialNet.topMembers", { communityId }, adA));
    expect(top.byPoints[0]).toMatchObject({ clientId: client.Lucia, points: 30 });
    expect(top.byParticipation.map((m: any) => m.email)).toEqual(expect.arrayContaining(["lucia@socios-a.example", "marcos@socios-a.example"]));
    const mp = data(await ess.q("a", "socialNet.memberPoints", { communityId }, adA)) as any[];
    expect(mp.find((x) => x.clientId === client.Lucia)).toMatchObject({ balance: 55, communityPoints: 30 });
    expect(data(await ess.q("a", "socialNet.walletCommunities", { clientId: client.Lucia }, adA))).toEqual([{ communityId, name: "Club de Socios", role: "member", status: "active", points: 30 }]);
    expect(data(await ess.q("a", "socialNet.walletCommunities", { clientId: client.Ciro }, adA))).toEqual([]);
  });

  it("aislamiento: la otra empresa no ve ni premia nada de esta", async () => {
    await ess.setCapability("b", COMM, "active");
    await ess.setCapability("b", TOK, "active");
    expect(data(await ess.q("b", "socialNet.stats", undefined, adB))).toEqual([]);
    expect(data(await ess.q("b", "socialNet.rules", undefined, adB))).toEqual([]);
    expect(data(await ess.q("b", "socialNet.memberPoints", { communityId }, adB))).toEqual([]);
    expect(data(await ess.q("b", "socialNet.walletCommunities", { clientId: client.Lucia }, adB))).toEqual([]);
    expect(errCode(await ess.m("b", "socialNet.setRewardCommunities", { rewardId, communityIds: [] }, adB))).toBe("NOT_FOUND");
    expect((await ess.sql("b", "SELECT COUNT(*) AS n FROM loyalty_community_awards"))[0].n).toBe(0);
    expect((await ess.sql("a", "SELECT COUNT(*) AS n FROM loyalty_reward_communities WHERE active = 1"))[0].n).toBe(1);
  });

  it("desactivar Complete (o una de sus partes) no pierde datos ni premia; al volver, todo sigue igual", async () => {
    const before = { awards: await awards(), rules: (data(await ess.q("a", "socialNet.rules", undefined, adA)) as any[]).length, lucia: await balance("Lucia") };
    // Sin comunidades: la exclusiva no se ve ni se canjea; la campaña de comunidad no aplica
    await ess.m("a", "loyalty.saveCampaign", { id: null, campaign: { ...baseCampaign, name: "Socios ×3", scope: "community", scopeId: communityId, multiplier: 3 } }, adA);
    await ess.setCapability("a", COMM, null);
    expect(data(await ess.q("a", "loyalty.overview", undefined, adA)).integration).toBe(false);
    expect(await portal("Lucia")).not.toContain("Cena de socios");
    expect(errCode(await ess.m("a", "loyalty.redeemForClient", { clientId: client.Lucia, rewardId, key: key() }, adA))).toBe("FORBIDDEN");
    expect(data(await sell("Lucia")).loyalty.points).toBe(10);
    // Sin tokens: publicar no da puntos (ni después, al volver)
    await ess.setCapability("a", COMM, "active");
    await ess.setCapability("a", TOK, null);
    expect((await ess.m("a", "communities.member.createPost", { communityId, body: "Sin puntos" }, cookie.Lucia)).status).toBe(200);
    expect(data(await ess.q("a", "communities.admin.integration", undefined, adA))).toEqual({ active: false });
    // Las dos de nuevo: reglas, premios y saldos intactos; lo publicado sin la integración no se recupera
    await ess.setCapability("a", TOK, "active");
    expect(data(await ess.m("a", "socialNet.catchUp", undefined, adA))).toMatchObject({ granted: 0 });
    expect(await awards()).toBe(before.awards);
    expect((data(await ess.q("a", "socialNet.rules", undefined, adA)) as any[])).toHaveLength(before.rules);
    expect(await balance("Lucia")).toBe(before.lucia + 10);
    expect(await portal("Lucia")).toContain("Cena de socios");
    expect((await ess.sql("a", "SELECT COUNT(*) AS n FROM loyalty_reward_communities WHERE active = 1"))[0].n).toBe(1);
  });
});
