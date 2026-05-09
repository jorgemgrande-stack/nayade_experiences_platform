/**
 * partners.ts — Router tRPC para el módulo Partners / Colaboradores.
 *
 * Fase 1: CRUD de partners desde admin + gestión de usuarios.
 * Fase 2 (futuro): endpoints del portal del partner.
 */
import { z } from "zod";
import { adminProcedure, partnerProcedure, router } from "../_core/trpc";
import { db } from "../db";
import { partners, users } from "../../drizzle/schema";
import { eq, desc, and, like, or } from "drizzle-orm";
import { randomBytes } from "crypto";
import { sendEmail } from "../mailer";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

// ─── Router ──────────────────────────────────────────────────────────────────

export const partnersRouter = router({

  // ── ADMIN: Listar todos los partners ───────────────────────────────────────
  list: adminProcedure
    .input(z.object({
      search: z.string().optional(),
      onlyActive: z.boolean().optional(),
    }).optional())
    .query(async ({ input }) => {
      const rows = await db
        .select()
        .from(partners)
        .orderBy(desc(partners.createdAt));

      let filtered = rows;
      if (input?.onlyActive) {
        filtered = filtered.filter(p => p.isActive);
      }
      if (input?.search) {
        const s = input.search.toLowerCase();
        filtered = filtered.filter(p =>
          p.name.toLowerCase().includes(s) ||
          (p.contactEmail ?? "").toLowerCase().includes(s) ||
          (p.nif ?? "").toLowerCase().includes(s)
        );
      }
      return filtered;
    }),

  // ── ADMIN: Detalle de un partner ───────────────────────────────────────────
  get: adminProcedure
    .input(z.object({ id: z.number().int() }))
    .query(async ({ input }) => {
      const [row] = await db
        .select()
        .from(partners)
        .where(eq(partners.id, input.id))
        .limit(1);
      if (!row) throw new Error("Partner no encontrado");
      return row;
    }),

  // ── ADMIN: Crear partner ───────────────────────────────────────────────────
  create: adminProcedure
    .input(z.object({
      name: z.string().min(2),
      slug: z.string().optional(),
      fiscalName: z.string().optional(),
      nif: z.string().optional(),
      address: z.string().optional(),
      city: z.string().optional(),
      postalCode: z.string().optional(),
      country: z.string().default("ES"),
      contactName: z.string().optional(),
      contactEmail: z.string().email().optional(),
      contactPhone: z.string().optional(),
      billingEmail: z.string().email().optional(),
      canCreateReservations: z.boolean().default(false),
      canCreateLeads: z.boolean().default(true),
      allowedReservationProductIds: z.array(z.number()).optional(),
      allowedLeadProductIds: z.array(z.number()).optional(),
      commissionType: z.enum(["none", "fixed_lead", "fixed_reservation", "percent", "per_product", "manual"]).default("none"),
      commissionValue: z.string().optional(),
      billingEnabled: z.boolean().default(false),
      billingPeriod: z.enum(["weekly", "biweekly", "monthly", "manual"]).default("monthly"),
      monthlyQuota: z.number().int().optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const slug = input.slug || slugify(input.name);
      const [result] = await db.insert(partners).values({
        name: input.name,
        slug,
        fiscalName: input.fiscalName ?? null,
        nif: input.nif ?? null,
        address: input.address ?? null,
        city: input.city ?? null,
        postalCode: input.postalCode ?? null,
        country: input.country,
        contactName: input.contactName ?? null,
        contactEmail: input.contactEmail ?? null,
        contactPhone: input.contactPhone ?? null,
        billingEmail: input.billingEmail ?? null,
        canCreateReservations: input.canCreateReservations,
        canCreateLeads: input.canCreateLeads,
        allowedReservationProductIds: input.allowedReservationProductIds ?? null,
        allowedLeadProductIds: input.allowedLeadProductIds ?? null,
        commissionType: input.commissionType,
        commissionValue: input.commissionValue ?? null,
        billingEnabled: input.billingEnabled,
        billingPeriod: input.billingPeriod,
        monthlyQuota: input.monthlyQuota ?? null,
        notes: input.notes ?? null,
      });
      return { id: (result as any).insertId as number };
    }),

  // ── ADMIN: Editar partner ──────────────────────────────────────────────────
  update: adminProcedure
    .input(z.object({
      id: z.number().int(),
      name: z.string().min(2).optional(),
      fiscalName: z.string().optional(),
      nif: z.string().optional(),
      address: z.string().optional(),
      city: z.string().optional(),
      postalCode: z.string().optional(),
      country: z.string().optional(),
      contactName: z.string().optional(),
      contactEmail: z.string().email().optional().nullable(),
      contactPhone: z.string().optional().nullable(),
      billingEmail: z.string().email().optional().nullable(),
      canCreateReservations: z.boolean().optional(),
      canCreateLeads: z.boolean().optional(),
      allowedReservationProductIds: z.array(z.number()).optional().nullable(),
      allowedLeadProductIds: z.array(z.number()).optional().nullable(),
      commissionType: z.enum(["none", "fixed_lead", "fixed_reservation", "percent", "per_product", "manual"]).optional(),
      commissionValue: z.string().optional().nullable(),
      billingEnabled: z.boolean().optional(),
      billingPeriod: z.enum(["weekly", "biweekly", "monthly", "manual"]).optional(),
      monthlyQuota: z.number().int().optional().nullable(),
      isActive: z.boolean().optional(),
      notes: z.string().optional().nullable(),
    }))
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      const updateData: Record<string, any> = {};
      for (const [k, v] of Object.entries(data)) {
        if (v !== undefined) updateData[k] = v;
      }
      await db.update(partners).set(updateData).where(eq(partners.id, id));
      return { ok: true };
    }),

  // ── ADMIN: Activar / desactivar partner ────────────────────────────────────
  toggleActive: adminProcedure
    .input(z.object({ id: z.number().int(), active: z.boolean() }))
    .mutation(async ({ input }) => {
      await db.update(partners)
        .set({ isActive: input.active })
        .where(eq(partners.id, input.id));
      return { ok: true };
    }),

  // ── ADMIN: Usuarios vinculados a un partner ────────────────────────────────
  listUsers: adminProcedure
    .input(z.object({ partnerId: z.number().int() }))
    .query(async ({ input }) => {
      const rows = await db
        .select({
          id: users.id,
          name: users.name,
          email: users.email,
          phone: users.phone,
          role: users.role,
          isActive: users.isActive,
          inviteAccepted: users.inviteAccepted,
          lastSignedIn: users.lastSignedIn,
          createdAt: users.createdAt,
        })
        .from(users)
        .where(eq((users as any).partnerId, input.partnerId))
        .orderBy(desc(users.createdAt));
      return rows;
    }),

  // ── ADMIN: Invitar recepcionista a un partner ──────────────────────────────
  inviteUser: adminProcedure
    .input(z.object({
      partnerId: z.number().int(),
      name: z.string().min(2),
      email: z.string().email(),
      role: z.enum(["partner_admin", "partner_user"]).default("partner_user"),
    }))
    .mutation(async ({ input, ctx }) => {
      const [partner] = await db
        .select({ name: partners.name })
        .from(partners)
        .where(eq(partners.id, input.partnerId))
        .limit(1);
      if (!partner) throw new Error("Partner no encontrado");

      const token = randomBytes(32).toString("hex");
      const expiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 días

      // Verificar si ya existe un usuario con ese email
      const [existing] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, input.email))
        .limit(1);

      if (existing) {
        // Vincular usuario existente al partner
        await db.update(users)
          .set({
            role: input.role as any,
            ...(({ partnerId: input.partnerId }) as any),
          })
          .where(eq(users.id, existing.id));
      } else {
        // Crear usuario pendiente de activación
        await db.insert(users).values({
          openId: `invite_${token.slice(0, 16)}`,
          name: input.name,
          email: input.email,
          role: input.role as any,
          inviteToken: token,
          inviteTokenExpiry: expiry,
          inviteAccepted: false,
          isActive: false,
          lastSignedIn: new Date(),
        } as any);
        // Setear partnerId
        const [newUser] = await db
          .select({ id: users.id })
          .from(users)
          .where(eq(users.email, input.email))
          .limit(1);
        if (newUser) {
          await db.update(users)
            .set({ ...(({ partnerId: input.partnerId }) as any) })
            .where(eq(users.id, newUser.id));
        }
      }

      // Enviar email de invitación
      const origin = process.env.APP_URL ?? "https://www.nayadeexperiences.es";
      const inviteUrl = `${origin}/partner/activar?token=${token}`;
      await sendEmail({
        to: input.email,
        subject: `Invitación al portal de colaboradores — ${partner.name}`,
        html: `
          <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:32px;">
            <h2 style="color:#ea580c">Bienvenido al portal de colaboradores</h2>
            <p>Hola <strong>${input.name}</strong>,</p>
            <p>Has sido invitado a acceder al portal de colaboradores de <strong>Nayade Experiences</strong> como miembro de <strong>${partner.name}</strong>.</p>
            <p style="margin:24px 0">
              <a href="${inviteUrl}" style="background:#ea580c;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold">
                Activar mi cuenta
              </a>
            </p>
            <p style="color:#666;font-size:13px">Este enlace caduca en 7 días.</p>
          </div>
        `,
      }).catch(() => {});

      return { ok: true };
    }),

  // ── ADMIN: Desvincular usuario de un partner ───────────────────────────────
  removeUser: adminProcedure
    .input(z.object({ userId: z.number().int() }))
    .mutation(async ({ input }) => {
      await db.update(users)
        .set({ role: "user", ...(({ partnerId: null }) as any) })
        .where(eq(users.id, input.userId));
      return { ok: true };
    }),

  // ── PARTNER: Datos de mi partner (para el portal) ─────────────────────────
  getMyPartner: partnerProcedure
    .query(async ({ ctx }) => {
      const user = ctx.user as any;
      const [row] = await db
        .select()
        .from(partners)
        .where(eq(partners.id, user.partnerId))
        .limit(1);
      if (!row) throw new Error("Partner no encontrado");
      return row;
    }),
});
