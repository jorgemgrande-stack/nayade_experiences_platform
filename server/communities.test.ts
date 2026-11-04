/**
 * Social Token Net · Comunidades — lógica pura (shared/communities.ts): permisos por rol, entrada según visibilidad,
 * revisión previa, un nivel de respuesta, saneado del texto (de Segolife), indicadores y serie semanal; y el punto de
 * extensión de eventos (entrega única, fallos de suscriptores aislados).
 */
import { describe, it, expect, vi } from "vitest";
import {
  canModerateMember,
  engagementIndicators,
  initialPostStatus,
  isSafeImageUrl,
  joinStatus,
  permissionsFor,
  replyProblem,
  sanitizeText,
  slugify,
  weekStartUtc,
  weeklySeries,
} from "../shared/communities";
import { dispatchCommunityEvent, onCommunityEvent, recordCommunityEvent, type CommunityDomainEvent } from "./communities/events";

const active = { allowMemberPosts: true, status: "active" as const };

describe("permisos por rol dentro de la comunidad", () => {
  it("sin rol no hay nada; el miembro participa; la moderación modera; solo el administrador gestiona miembros", () => {
    expect(Object.values(permissionsFor(null, active)).every((v) => v === false)).toBe(true);
    expect(permissionsFor("member", active)).toMatchObject({ read: true, post: true, comment: true, react: true, moderate: false, blockMembers: false, manageMembers: false, announce: false });
    expect(permissionsFor("moderator", active)).toMatchObject({ moderate: true, blockMembers: true, manageMembers: false, announce: true });
    expect(permissionsFor("admin", active)).toMatchObject({ moderate: true, manageMembers: true, announce: true });
  });
  it("sin publicaciones de miembros, solo la moderación publica; archivada, nadie escribe", () => {
    expect(permissionsFor("member", { allowMemberPosts: false, status: "active" }).post).toBe(false);
    expect(permissionsFor("moderator", { allowMemberPosts: false, status: "active" }).post).toBe(true);
    const archived = permissionsFor("admin", { allowMemberPosts: true, status: "archived" });
    expect(archived).toMatchObject({ read: true, post: false, comment: false, react: false, announce: false, moderate: true });
  });
  it("un moderador solo actúa sobre miembros; nadie sobre sí mismo", () => {
    expect(canModerateMember("moderator", "member", false)).toBe(true);
    expect(canModerateMember("moderator", "moderator", false)).toBe(false);
    expect(canModerateMember("moderator", "admin", false)).toBe(false);
    expect(canModerateMember("admin", "moderator", false)).toBe(true);
    expect(canModerateMember("admin", "member", true)).toBe(false);
    expect(canModerateMember("member", "member", false)).toBe(false);
  });
});

describe("entrada y publicación", () => {
  it("abierta entra activa, con solicitud queda pendiente, privada no admite unirse", () => {
    expect(joinStatus("open")).toBe("active");
    expect(joinStatus("request")).toBe("pending");
    expect(joinStatus("private")).toBeNull();
  });
  it("revisión previa solo para miembros", () => {
    expect(initialPostStatus("member", "pre")).toBe("pending");
    expect(initialPostStatus("member", "none")).toBe("published");
    expect(initialPostStatus("moderator", "pre")).toBe("published");
    expect(initialPostStatus("admin", "pre")).toBe("published");
  });
  it("un solo nivel de respuesta (regla de Segolife)", () => {
    expect(replyProblem({ postId: 1, parentCommentId: null, hidden: false }, 1)).toBeNull();
    expect(replyProblem({ postId: 1, parentCommentId: 7, hidden: false }, 1)).toMatch(/comentario principal/);
    expect(replyProblem({ postId: 2, parentCommentId: null, hidden: false }, 1)).toMatch(/ya no está disponible/);
    expect(replyProblem({ postId: 1, parentCommentId: null, hidden: true }, 1)).toMatch(/ya no está disponible/);
    expect(replyProblem(null, 1)).toMatch(/ya no está disponible/);
  });
  it("texto sin etiquetas, recortado y acotado (sanitizeOpenText de Segolife)", () => {
    expect(sanitizeText("  <b>Hola</b> <script>x</script>mundo ", 100)).toBe("Hola xmundo");
    expect(sanitizeText("a".repeat(50), 10)).toHaveLength(10);
    expect(sanitizeText("<p></p>   ", 10)).toBe("");
  });
  it("dirección de la comunidad y de las imágenes", () => {
    expect(slugify("Club de Socios Ñandú — 2026")).toBe("club-de-socios-nandu-2026");
    expect(slugify("¡¡!!")).toBe("comunidad");
    expect(isSafeImageUrl("https://cdn.example/a.jpg")).toBe(true);
    expect(isSafeImageUrl("/api/files/abc")).toBe(true);
    expect(isSafeImageUrl("//evil.example/a.jpg")).toBe(false);
    expect(isSafeImageUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeImageUrl("http://inseguro.example/a.jpg")).toBe(false);
  });
});

describe("indicadores de participación", () => {
  it("tasas sin dividir por cero", () => {
    expect(engagementIndicators({ activeMembers: 0, participants: 0, posts: 0, comments: 0, reactions: 0 })).toEqual({ participationRate: 0, interactionsPerPost: 0, interactionsPerMember: 0 });
    expect(engagementIndicators({ activeMembers: 4, participants: 3, posts: 2, comments: 3, reactions: 4 })).toEqual({ participationRate: 75, interactionsPerPost: 3.5, interactionsPerMember: 2.3 });
    expect(engagementIndicators({ activeMembers: 2, participants: 5, posts: 1, comments: 0, reactions: 0 }).participationRate).toBe(100);
  });
  it("serie semanal de 8 semanas, la actual al final", () => {
    const now = Date.UTC(2026, 10, 4, 12); // miércoles
    expect(new Date(weekStartUtc(now)).getUTCDay()).toBe(1);
    const s = weeklySeries([now, now - 3600_000, now - 7 * 86_400_000, now - 100 * 86_400_000], now);
    expect(s).toHaveLength(8);
    expect(s.at(-1)!.count).toBe(2);
    expect(s.at(-2)!.count).toBe(1);
    expect(s.reduce((a, w) => a + w.count, 0)).toBe(3);
  });
});

describe("punto de extensión: eventos de dominio", () => {
  const exec = (affectedRows: number) => ({ execute: vi.fn(async () => [{ affectedRows, insertId: 9 }]) }) as any;
  it("solo un hecho nuevo produce evento; el repetido (misma clave) no", async () => {
    const e = await recordCommunityEvent(exec(1), { key: "member.posted:5", type: "member.posted", communityId: 1, userId: 3, targetType: "post", targetId: 5, now: 1000 });
    expect(e).toMatchObject({ id: 9, key: "member.posted:5", type: "member.posted", communityId: 1, userId: 3, targetId: 5, occurredAt: 1000 });
    expect(await recordCommunityEvent(exec(0), { key: "member.posted:5", type: "member.posted", communityId: 1, userId: 3 })).toBeNull();
  });
  it("entrega a los suscriptores; un fallo no impide a los demás; darse de baja funciona", async () => {
    const got: string[] = [];
    const offBad = onCommunityEvent(() => {
      throw new Error("fallo del suscriptor");
    });
    const offGood = onCommunityEvent((e) => void got.push(e.key));
    const ev: CommunityDomainEvent = { id: 1, key: "k1", type: "member.commented", tenantId: null, communityId: 1, userId: 2, targetType: "comment", targetId: 3, data: null, occurredAt: 0 };
    await dispatchCommunityEvent(ev);
    offGood();
    await dispatchCommunityEvent({ ...ev, key: "k2" });
    await dispatchCommunityEvent(null);
    offBad();
    expect(got).toEqual(["k1"]);
  });
});
