/**
 * partners.ts — Router tRPC para el módulo Partners / Colaboradores.
 *
 * Fase 1: CRUD de partners desde admin + gestión de usuarios.
 * Fase 2: Portal del partner — activación de cuenta, creación de leads, listado.
 */
import { z } from "zod";
import { adminProcedure, partnerProcedure, publicProcedure, router } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { partners, users, leads } from "../../drizzle/schema";
import { eq, desc } from "drizzle-orm";
import { randomBytes } from "crypto";
import { sendEmail } from "../mailer";
import { createLead as dbCreateLead, getUserByInviteToken, setUserPassword, postConfirmOperation, generateReservationNumber } from "../db";
import { reservations } from "../../drizzle/schema";

const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 3 });
const db = drizzle(_pool);

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

  // ── PUBLIC: Activar cuenta de partner (desde enlace de invitación) ─────────
  activateInvite: publicProcedure
    .input(z.object({
      token: z.string(),
      password: z.string().min(6, "La contraseña debe tener al menos 6 caracteres"),
    }))
    .mutation(async ({ input }) => {
      const user = await getUserByInviteToken(input.token);
      if (!user) throw new TRPCError({ code: "NOT_FOUND", message: "Enlace inválido o ya utilizado" });
      if (user.inviteTokenExpiry && new Date() > user.inviteTokenExpiry) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "El enlace ha expirado. Solicita un nuevo enlace al administrador." });
      }
      const bcrypt = await import("bcryptjs");
      const passwordHash = await bcrypt.hash(input.password, 12);
      await setUserPassword(user.id, passwordHash); // limpia el token, sets inviteAccepted
      await db.update(users).set({ isActive: true } as any).where(eq(users.id, user.id));
      return { ok: true, name: user.name };
    }),

  // ── PARTNER: Crear lead desde el portal ───────────────────────────────────
  createLead: partnerProcedure
    .input(z.object({
      name: z.string().min(2),
      email: z.string().email(),
      phone: z.string().optional(),
      preferredDate: z.string().optional(),
      numberOfAdults: z.number().int().min(1).default(1),
      numberOfChildren: z.number().int().min(0).default(0),
      comments: z.string().optional(),
      selectedCategory: z.string().optional(),
      selectedProduct: z.string().optional(),
      activitiesJson: z.array(z.object({
        experienceId: z.number(),
        experienceTitle: z.string(),
        family: z.string(),
        participants: z.number(),
        details: z.record(z.union([z.string(), z.number()])),
      })).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const user = ctx.user as any;
      const result = await dbCreateLead({
        name: input.name,
        email: input.email,
        phone: input.phone,
        preferredDate: input.preferredDate,
        numberOfAdults: input.numberOfAdults,
        numberOfChildren: input.numberOfChildren,
        numberOfPersons: input.numberOfAdults + (input.numberOfChildren ?? 0),
        message: input.comments,
        source: "PARTNER",
        selectedCategory: input.selectedCategory,
        selectedProduct: input.selectedProduct,
        activitiesJson: input.activitiesJson,
      });
      // Vincular el lead al partner y al usuario que lo creó
      await db.update(leads)
        .set({ partnerId: user.partnerId, partnerUserId: user.id } as any)
        .where(eq(leads.id, result.id));
      return { leadId: result.id };
    }),

  // ── PARTNER: Listar mis leads ─────────────────────────────────────────────
  listMyLeads: partnerProcedure
    .query(async ({ ctx }) => {
      const user = ctx.user as any;
      const rows = await db
        .select()
        .from(leads)
        .where(eq((leads as any).partnerId, user.partnerId))
        .orderBy(desc(leads.createdAt))
        .limit(100);
      return rows;
    }),

  // ── PARTNER: Crear reserva directa confirmada ─────────────────────────────
  createReservation: partnerProcedure
    .input(z.object({
      customerName: z.string().min(2),
      customerEmail: z.string().email(),
      customerPhone: z.string().optional(),
      productId: z.number().int(),
      productName: z.string().min(1),
      bookingDate: z.string().min(1),
      people: z.number().int().min(1),
      amountTotal: z.number().min(0),     // en euros
      notes: z.string().optional(),
      selectedTimeSlotId: z.number().int().optional(),
      selectedTime: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const user = ctx.user as any;

      // Verificar permisos del partner
      const [partner] = await db.select().from(partners).where(eq(partners.id, user.partnerId)).limit(1);
      if (!partner) throw new TRPCError({ code: "FORBIDDEN", message: "Partner no encontrado" });
      if (!partner.canCreateReservations) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Tu partner no tiene permiso para crear reservas directas" });
      }

      // Verificar producto permitido (si hay lista restringida)
      const allowedIds = partner.allowedReservationProductIds as number[] | null;
      if (allowedIds && allowedIds.length > 0 && !allowedIds.includes(input.productId)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Este producto no está disponible para tu partner" });
      }

      const amountCents = Math.round(input.amountTotal * 100);
      const merchantOrder = `PAR${Date.now().toString(36).slice(-8).toUpperCase()}`;
      const reservationNumber = await generateReservationNumber();
      const now = Date.now();

      const [result] = await db.insert(reservations).values({
        productId: input.productId,
        productName: input.productName,
        bookingDate: input.bookingDate,
        people: input.people,
        amountTotal: amountCents,
        amountPaid: 0,
        status: "paid",
        statusReservation: "CONFIRMADA",
        statusPayment: "PENDIENTE",
        channel: "PARTNER",
        paymentMethod: "otro",
        customerName: input.customerName,
        customerEmail: input.customerEmail,
        customerPhone: input.customerPhone ?? null,
        merchantOrder,
        reservationNumber,
        notes: input.notes ?? `Reserva directa creada por partner ${partner.name}`,
        selectedTimeSlotId: input.selectedTimeSlotId ?? null,
        selectedTime: input.selectedTime ?? null,
        partnerId: user.partnerId,
        partnerUserId: user.id,
        createdAt: now,
        updatedAt: now,
      } as any);

      const reservationId = (result as any).insertId as number;

      // Crear booking operativo + transacción contable (fire-and-forget, no bloquea)
      postConfirmOperation({
        reservationId,
        productId: input.productId,
        productName: input.productName,
        serviceDate: input.bookingDate,
        people: input.people,
        amountCents,
        customerName: input.customerName,
        customerEmail: input.customerEmail,
        customerPhone: input.customerPhone,
        totalAmount: input.amountTotal,
        paymentMethod: "otro",
        saleChannel: "delegado",
        sourceChannel: "otro",
      }).catch((e: any) => console.error("[Partners] Error en postConfirmOperation:", e.message));

      return { reservationId, reservationNumber, merchantOrder };
    }),

  // ── PARTNER: Listar mis reservas directas ─────────────────────────────────
  listMyReservations: partnerProcedure
    .query(async ({ ctx }) => {
      const user = ctx.user as any;
      const rows = await db
        .select()
        .from(reservations)
        .where(eq((reservations as any).partnerId, user.partnerId))
        .orderBy(desc(reservations.createdAt))
        .limit(100);
      return rows;
    }),
});
