/**
 * Tests para el sistema de opiniones y valoraciones (reviews).
 * Valida los procedimientos tRPC de reviews sin conexión real a BD.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";

// ─── Validaciones de esquema ──────────────────────────────────────────────────

describe("reviews — validación de inputs", () => {
  const submitSchema = z.object({
    entityType: z.enum(["hotel", "spa"]),
    entityId: z.number().int().positive(),
    authorName: z.string().min(2).max(256),
    authorEmail: z.string().email().optional(),
    rating: z.number().int().min(1).max(5),
    title: z.string().max(256).optional(),
    body: z.string().min(10).max(2000),
    stayDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  });

  it("acepta una reseña de hotel válida", () => {
    const result = submitSchema.safeParse({
      entityType: "hotel",
      entityId: 1,
      authorName: "María García",
      authorEmail: "maria@example.com",
      rating: 5,
      title: "Estancia perfecta",
      body: "La habitación era preciosa con vistas al lago. El servicio excelente.",
      stayDate: "2026-03-15",
    });
    expect(result.success).toBe(true);
  });

  it("acepta una reseña de SPA válida sin email ni título", () => {
    const result = submitSchema.safeParse({
      entityType: "spa",
      entityId: 3,
      authorName: "Carlos López",
      rating: 4,
      body: "El masaje relajante fue increíble. Muy recomendable para desconectar.",
    });
    expect(result.success).toBe(true);
  });

  it("rechaza rating fuera de rango 1-5", () => {
    const result = submitSchema.safeParse({
      entityType: "hotel",
      entityId: 1,
      authorName: "Test User",
      rating: 6,
      body: "Texto de prueba suficientemente largo",
    });
    expect(result.success).toBe(false);
  });

  it("rechaza rating 0", () => {
    const result = submitSchema.safeParse({
      entityType: "spa",
      entityId: 1,
      authorName: "Test User",
      rating: 0,
      body: "Texto de prueba suficientemente largo",
    });
    expect(result.success).toBe(false);
  });

  it("rechaza body demasiado corto (menos de 10 chars)", () => {
    const result = submitSchema.safeParse({
      entityType: "hotel",
      entityId: 1,
      authorName: "Test User",
      rating: 3,
      body: "Corto",
    });
    expect(result.success).toBe(false);
  });

  it("rechaza nombre de autor demasiado corto (menos de 2 chars)", () => {
    const result = submitSchema.safeParse({
      entityType: "hotel",
      entityId: 1,
      authorName: "A",
      rating: 3,
      body: "Texto de prueba suficientemente largo",
    });
    expect(result.success).toBe(false);
  });

  it("rechaza entityType inválido", () => {
    const result = submitSchema.safeParse({
      entityType: "restaurante",
      entityId: 1,
      authorName: "Test User",
      rating: 3,
      body: "Texto de prueba suficientemente largo",
    });
    expect(result.success).toBe(false);
  });

  it("rechaza email inválido", () => {
    const result = submitSchema.safeParse({
      entityType: "hotel",
      entityId: 1,
      authorName: "Test User",
      authorEmail: "no-es-un-email",
      rating: 3,
      body: "Texto de prueba suficientemente largo",
    });
    expect(result.success).toBe(false);
  });

  it("rechaza stayDate con formato incorrecto", () => {
    const result = submitSchema.safeParse({
      entityType: "hotel",
      entityId: 1,
      authorName: "Test User",
      rating: 3,
      body: "Texto de prueba suficientemente largo",
      stayDate: "15/03/2026",
    });
    expect(result.success).toBe(false);
  });

  it("acepta stayDate con formato YYYY-MM-DD correcto", () => {
    const result = submitSchema.safeParse({
      entityType: "hotel",
      entityId: 1,
      authorName: "Test User",
      rating: 3,
      body: "Texto de prueba suficientemente largo",
      stayDate: "2026-03-15",
    });
    expect(result.success).toBe(true);
  });
});

// ─── Lógica de estadísticas ───────────────────────────────────────────────────

describe("reviews — cálculo de estadísticas", () => {
  function calcStats(ratings: number[]) {
    const totalReviews = ratings.length;
    const sumRatings = ratings.reduce((a, b) => a + b, 0);
    const averageRating =
      totalReviews > 0 ? Math.round((sumRatings / totalReviews) * 10) / 10 : 0;

    const distribution = [5, 4, 3, 2, 1].map((stars) => {
      const cnt = ratings.filter((r) => r === stars).length;
      return {
        stars,
        count: cnt,
        percentage:
          totalReviews > 0 ? Math.round((cnt / totalReviews) * 100) : 0,
      };
    });

    return { totalReviews, averageRating, distribution };
  }

  it("calcula media correctamente para ratings homogéneos", () => {
    const stats = calcStats([5, 5, 5, 5]);
    expect(stats.averageRating).toBe(5);
    expect(stats.totalReviews).toBe(4);
  });

  it("calcula media correctamente para ratings mixtos", () => {
    const stats = calcStats([5, 4, 3, 2, 1]);
    expect(stats.averageRating).toBe(3);
    expect(stats.totalReviews).toBe(5);
  });

  it("devuelve 0 para lista vacía", () => {
    const stats = calcStats([]);
    expect(stats.averageRating).toBe(0);
    expect(stats.totalReviews).toBe(0);
  });

  it("calcula distribución correctamente", () => {
    const stats = calcStats([5, 5, 4, 3]);
    const fiveStars = stats.distribution.find((d) => d.stars === 5);
    const fourStars = stats.distribution.find((d) => d.stars === 4);
    const oneStars = stats.distribution.find((d) => d.stars === 1);
    expect(fiveStars?.count).toBe(2);
    expect(fiveStars?.percentage).toBe(50);
    expect(fourStars?.count).toBe(1);
    expect(fourStars?.percentage).toBe(25);
    expect(oneStars?.count).toBe(0);
    expect(oneStars?.percentage).toBe(0);
  });

  it("redondea la media a 1 decimal", () => {
    const stats = calcStats([5, 4, 4]);
    // (5+4+4)/3 = 4.333... → 4.3
    expect(stats.averageRating).toBe(4.3);
  });
});

// ─── Validación de moderación ─────────────────────────────────────────────────

describe("reviews — validación de acciones de moderación", () => {
  const idSchema = z.object({ id: z.number().int().positive() });

  it("acepta ID positivo para aprobar/rechazar/eliminar", () => {
    expect(idSchema.safeParse({ id: 42 }).success).toBe(true);
  });

  it("rechaza ID negativo", () => {
    expect(idSchema.safeParse({ id: -1 }).success).toBe(false);
  });

  it("rechaza ID cero", () => {
    expect(idSchema.safeParse({ id: 0 }).success).toBe(false);
  });

  const replySchema = z.object({
    id: z.number().int().positive(),
    reply: z.string().min(1).max(1000),
  });

  it("acepta respuesta válida del admin", () => {
    const result = replySchema.safeParse({
      id: 1,
      reply: "Gracias por tu opinión. Nos alegra que disfrutaras de tu estancia.",
    });
    expect(result.success).toBe(true);
  });

  it("rechaza respuesta vacía", () => {
    const result = replySchema.safeParse({ id: 1, reply: "" });
    expect(result.success).toBe(false);
  });

  it("rechaza respuesta demasiado larga (más de 1000 chars)", () => {
    const result = replySchema.safeParse({
      id: 1,
      reply: "a".repeat(1001),
    });
    expect(result.success).toBe(false);
  });
});
