/**
 * partners.ts — Router Landing Partners
 *
 * Admin (staffProcedure): gestión CRUD de partners y sus productos permitidos.
 * Público (publicProcedure): autenticación por slug+accessKey + creación de presupuestos.
 */

import { router, staffProcedure, publicProcedure } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { eq, and, desc } from "drizzle-orm";
import {
  partners,
  partnerAllowedProducts,
  experiences,
  packs,
} from "../../drizzle/schema";
import { createQuote } from "../services/quoteService";

const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 3 });
const db = drizzle(_pool);

// ─── HELPER: validar partner por slug + accessKey ─────────────────────────────

async function getVerifiedPartner(slug: string, accessKey: string) {
  const [partner] = await db
    .select({
      id: partners.id,
      name: partners.name,
      slug: partners.slug,
      contactName: partners.contactName,
      isActive: partners.isActive,
      canSendQuotes: partners.canSendQuotes,
      canRedeemDirectly: partners.canRedeemDirectly,
    })
    .from(partners)
    .where(
      and(
        eq(partners.slug, slug),
        eq(partners.accessKey, accessKey),
        eq(partners.isActive, true),
      ),
    )
    .limit(1);

  if (!partner) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Partner no encontrado o clave inválida" });
  }
  return partner;
}

// ─── INPUT SCHEMAS ────────────────────────────────────────────────────────────

const partnerAuthInput = z.object({
  slug: z.string().min(1),
  accessKey: z.string().length(64),
});

const quoteItemSchema = z.object({
  description: z.string().min(1),
  quantity: z.number().positive(),
  unitPrice: z.number().nonnegative(),
  total: z.number().nonnegative(),
  fiscalRegime: z.enum(["reav", "general"]).optional(),
  taxRate: z.number().optional(),
  productId: z.number().optional(),
});

// ─── ROUTER ──────────────────────────────────────────────────────────────────

export const partnersRouter = router({

  // ── Admin: listar todos los partners ───────────────────────────────────────
  list: staffProcedure.query(async () => {
    return db
      .select({
        id: partners.id,
        name: partners.name,
        slug: partners.slug,
        contactName: partners.contactName,
        contactEmail: partners.contactEmail,
        contactPhone: partners.contactPhone,
        isActive: partners.isActive,
        canSendQuotes: partners.canSendQuotes,
        canRedeemDirectly: partners.canRedeemDirectly,
        createdAt: partners.createdAt,
        updatedAt: partners.updatedAt,
      })
      .from(partners)
      .orderBy(desc(partners.createdAt));
  }),

  // ── Admin: obtener un partner con sus productos permitidos ─────────────────
  getById: staffProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const [partner] = await db
        .select({
          id: partners.id,
          name: partners.name,
          slug: partners.slug,
          contactName: partners.contactName,
          contactEmail: partners.contactEmail,
          contactPhone: partners.contactPhone,
          isActive: partners.isActive,
          canSendQuotes: partners.canSendQuotes,
          canRedeemDirectly: partners.canRedeemDirectly,
          createdAt: partners.createdAt,
          updatedAt: partners.updatedAt,
        })
        .from(partners)
        .where(eq(partners.id, input.id))
        .limit(1);

      if (!partner) throw new TRPCError({ code: "NOT_FOUND", message: "Partner no encontrado" });

      const allowedProducts = await db
        .select()
        .from(partnerAllowedProducts)
        .where(eq(partnerAllowedProducts.partnerId, input.id));

      return { ...partner, allowedProducts };
    }),

  // ── Admin: crear partner ───────────────────────────────────────────────────
  create: staffProcedure
    .input(
      z.object({
        name: z.string().min(1).max(256),
        slug: z.string().min(1).max(128).regex(/^[a-z0-9-]+$/, "Solo minúsculas, números y guiones"),
        contactName: z.string().max(256).optional(),
        contactEmail: z.string().email().optional(),
        contactPhone: z.string().max(32).optional(),
        canSendQuotes: z.boolean().default(true),
        canRedeemDirectly: z.boolean().default(false),
      }),
    )
    .mutation(async ({ input }) => {
      const { randomBytes } = await import("crypto");
      const accessKey = randomBytes(32).toString("hex");

      const [existing] = await db
        .select({ id: partners.id })
        .from(partners)
        .where(eq(partners.slug, input.slug))
        .limit(1);

      if (existing) {
        throw new TRPCError({ code: "CONFLICT", message: "Ya existe un partner con ese slug" });
      }

      const [result] = await db.insert(partners).values({
        name: input.name,
        slug: input.slug,
        contactName: input.contactName,
        contactEmail: input.contactEmail,
        contactPhone: input.contactPhone,
        accessKey,
        isActive: true,
        canSendQuotes: input.canSendQuotes,
        canRedeemDirectly: input.canRedeemDirectly,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      const partnerId = (result as { insertId: number }).insertId;

      return { success: true, partnerId, accessKey };
    }),

  // ── Admin: actualizar datos del partner ────────────────────────────────────
  update: staffProcedure
    .input(
      z.object({
        id: z.number(),
        name: z.string().min(1).max(256).optional(),
        contactName: z.string().max(256).optional(),
        contactEmail: z.string().email().optional(),
        contactPhone: z.string().max(32).optional(),
        canSendQuotes: z.boolean().optional(),
        canRedeemDirectly: z.boolean().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const { id, ...fields } = input;
      const set: Record<string, unknown> = { ...fields, updatedAt: new Date() };
      await db.update(partners).set(set).where(eq(partners.id, id));
      return { success: true };
    }),

  // ── Admin: activar/desactivar partner ─────────────────────────────────────
  toggleActive: staffProcedure
    .input(z.object({ id: z.number(), isActive: z.boolean() }))
    .mutation(async ({ input }) => {
      await db
        .update(partners)
        .set({ isActive: input.isActive, updatedAt: new Date() })
        .where(eq(partners.id, input.id));
      return { success: true };
    }),

  // ── Admin: regenerar accessKey ────────────────────────────────────────────
  regenerateKey: staffProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const { randomBytes } = await import("crypto");
      const accessKey = randomBytes(32).toString("hex");
      await db
        .update(partners)
        .set({ accessKey, updatedAt: new Date() })
        .where(eq(partners.id, input.id));
      return { success: true, accessKey };
    }),

  // ── Admin: reemplazar productos permitidos ────────────────────────────────
  setAllowedProducts: staffProcedure
    .input(
      z.object({
        partnerId: z.number(),
        products: z.array(
          z.object({
            productId: z.number(),
            productType: z.enum(["experience", "pack"]),
            canQuote: z.boolean().default(true),
            canRedeem: z.boolean().default(false),
          }),
        ),
      }),
    )
    .mutation(async ({ input }) => {
      await db
        .delete(partnerAllowedProducts)
        .where(eq(partnerAllowedProducts.partnerId, input.partnerId));

      if (input.products.length > 0) {
        await db.insert(partnerAllowedProducts).values(
          input.products.map(p => ({
            partnerId: input.partnerId,
            productId: p.productId,
            productType: p.productType,
            canQuote: p.canQuote,
            canRedeem: p.canRedeem,
            createdAt: new Date(),
          })),
        );
      }

      return { success: true };
    }),

  // ─────────────────────────────────────────────────────────────────────────
  // ENDPOINTS PÚBLICOS (autenticación por slug + accessKey en cada request)
  // ─────────────────────────────────────────────────────────────────────────

  // ── Público: verificar credenciales y obtener info del partner ─────────────
  verify: publicProcedure
    .input(partnerAuthInput)
    .query(async ({ input }) => {
      const partner = await getVerifiedPartner(input.slug, input.accessKey);
      return partner;
    }),

  // ── Público: listar productos que el partner puede presupuestar/canjear ────
  getPartnerProducts: publicProcedure
    .input(partnerAuthInput)
    .query(async ({ input }) => {
      const partner = await getVerifiedPartner(input.slug, input.accessKey);

      const allowed = await db
        .select()
        .from(partnerAllowedProducts)
        .where(eq(partnerAllowedProducts.partnerId, partner.id));

      if (allowed.length === 0) return [];

      const expIds = allowed.filter(a => a.productType === "experience").map(a => a.productId);
      const packIds = allowed.filter(a => a.productType === "pack").map(a => a.productId);

      const results: {
        id: number;
        productType: "experience" | "pack";
        title: string;
        basePrice: string | null;
        coverImageUrl: string | null;
        canQuote: boolean;
        canRedeem: boolean;
        fiscalRegime?: string | null;
        taxRate?: string | null;
      }[] = [];

      if (expIds.length > 0) {
        const exps = await db
          .select({
            id: experiences.id,
            title: experiences.title,
            basePrice: experiences.basePrice,
            coverImageUrl: experiences.coverImageUrl,
            fiscalRegime: experiences.fiscalRegime,
            taxRate: experiences.taxRate,
          })
          .from(experiences)
          .where(
            and(
              eq(experiences.isActive, true),
            ),
          );

        for (const exp of exps) {
          if (!expIds.includes(exp.id)) continue;
          const perm = allowed.find(a => a.productId === exp.id && a.productType === "experience")!;
          results.push({
            id: exp.id,
            productType: "experience",
            title: exp.title,
            basePrice: exp.basePrice,
            coverImageUrl: exp.coverImageUrl,
            canQuote: perm.canQuote,
            canRedeem: perm.canRedeem,
            fiscalRegime: exp.fiscalRegime,
            taxRate: exp.taxRate,
          });
        }
      }

      if (packIds.length > 0) {
        const pkList = await db
          .select({
            id: packs.id,
            title: packs.title,
            basePrice: packs.basePrice,
            image1: packs.image1,
          })
          .from(packs)
          .where(eq(packs.isActive, true));

        for (const pk of pkList) {
          if (!packIds.includes(pk.id)) continue;
          const perm = allowed.find(a => a.productId === pk.id && a.productType === "pack")!;
          results.push({
            id: pk.id,
            productType: "pack",
            title: pk.title ?? "",
            basePrice: pk.basePrice ?? null,
            coverImageUrl: pk.image1 ?? null,
            canQuote: perm.canQuote,
            canRedeem: perm.canRedeem,
          });
        }
      }

      return results;
    }),

  // ── Público: crear presupuesto desde la landing del partner ───────────────
  createQuote: publicProcedure
    .input(
      partnerAuthInput.extend({
        clientName: z.string().min(1),
        clientEmail: z.string().email(),
        clientPhone: z.string().optional(),
        title: z.string().min(1),
        items: z.array(quoteItemSchema).min(1),
        subtotal: z.number().nonnegative(),
        discount: z.number().nonnegative().default(0),
        total: z.number().nonnegative(),
        validUntil: z.string().optional(),
        notes: z.string().optional(),
        sendNow: z.boolean().default(false),
        origin: z.string().url().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const partner = await getVerifiedPartner(input.slug, input.accessKey);

      if (!partner.canSendQuotes) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Este partner no tiene permiso para generar presupuestos",
        });
      }

      const result = await createQuote({
        clientName: input.clientName,
        clientEmail: input.clientEmail,
        clientPhone: input.clientPhone,
        title: input.title,
        items: input.items,
        subtotal: input.subtotal,
        discount: input.discount,
        total: input.total,
        validUntil: input.validUntil,
        notes: input.notes,
        sendNow: input.sendNow,
        origin: input.origin,
        agentId: 0,
        source: "partner_landing",
        partnerId: partner.id,
      });

      return result;
    }),
});
