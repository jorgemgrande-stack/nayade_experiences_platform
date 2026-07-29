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
import { partners, users, leads, partnerBillingBatches, partnerBillingBatchItems, experiences, transactions, siteSettings } from "../../drizzle/schema";
import { eq, desc, and, gte, lte, notInArray, inArray, sql } from "drizzle-orm";
import { randomBytes } from "crypto";
import { sendEmail } from "../mailer";
import { buildPartnerReservationConfirmHtml } from "../emailTemplates";
import { createLead as dbCreateLead, getUserByInviteToken, setUserPassword, createBookingFromReservation, upsertClientFromReservation, generateReservationNumber, getGHLCredentials } from "../db";
import { reservations } from "../../drizzle/schema";
import { storagePut } from "../storage";
import { htmlToPdf } from "../pdfGenerator";
import { createGHLContact, triggerGHLWorkflow, syncLeadUrlsToGHL } from "../ghl";

const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 1 });
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

function fmtDateEs(d: string | null | undefined): string {
  if (!d) return "—";
  const parsed = new Date(d);
  return isNaN(parsed.getTime()) ? d : parsed.toLocaleDateString("es-ES");
}

// Genera el PDF de una liquidación de partner (factura legible y descargable) y lo
// sube a S3, devolviendo su URL. Modelado sobre la liquidación de proveedores.
async function generatePartnerBillingPdfAndUpload(data: {
  batchNumber: string;
  partnerName: string;
  partnerFiscalName?: string | null;
  partnerNif?: string | null;
  partnerAddress?: string | null;
  partnerCity?: string | null;
  partnerPostalCode?: string | null;
  periodStart: string;
  periodEnd: string;
  totalAmount: string;
  notes?: string | null;
  issuedAt: Date;
  items: { reservationNumber: string | null; bookingDate: string | null; customerName: string | null; productName: string | null; amount: string }[];
  companyData?: { name: string; cif: string; address: string; email: string; phone: string };
}): Promise<{ url: string; key: string }> {
  const lineRows = data.items.map((it) => `
    <tr>
      <td style="padding:9px 12px;border-bottom:1px solid #e5e7eb;font-family:monospace;font-size:12px;color:#6b7280;">${it.reservationNumber ?? "—"}</td>
      <td style="padding:9px 12px;border-bottom:1px solid #e5e7eb;text-align:center;">${fmtDateEs(it.bookingDate)}</td>
      <td style="padding:9px 12px;border-bottom:1px solid #e5e7eb;">${it.customerName ?? "—"}</td>
      <td style="padding:9px 12px;border-bottom:1px solid #e5e7eb;">${it.productName ?? "—"}</td>
      <td style="padding:9px 12px;border-bottom:1px solid #e5e7eb;text-align:right;font-weight:600;">${parseFloat(it.amount || "0").toFixed(2)} €</td>
    </tr>`).join("");

  const partnerAddrLine = [
    data.partnerAddress,
    [data.partnerPostalCode, data.partnerCity].filter(Boolean).join(" "),
  ].filter(Boolean).join(", ");

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8"/>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family: 'Helvetica Neue', Arial, sans-serif; color: #1a1a2e; background: #fff; }
  .doc-header { background: #1a3a6b; padding: 20px 40px; display: flex; align-items: center; justify-content: space-between; gap: 20px; }
  .logo-block { display: flex; align-items: center; gap: 16px; flex-shrink: 0; }
  .logo-block img { width: 90px; height: 90px; border-radius: 50%; border: 3px solid rgba(255,255,255,0.85); object-fit: cover; display: block; }
  .brand-text .brand-name { font-size: 20px; font-weight: 900; letter-spacing: 2px; text-transform: uppercase; color: #fff; line-height: 1.1; }
  .brand-text .brand-sub { font-size: 10px; letter-spacing: 3px; text-transform: uppercase; color: rgba(255,255,255,0.65); margin-top: 3px; }
  .company-info { text-align: right; color: rgba(255,255,255,0.80); font-size: 11.5px; line-height: 1.7; }
  .company-info strong { color: #fff; font-size: 12.5px; display: block; }
  .doc-type-band { background: #7c3aed; padding: 8px 40px; display: flex; align-items: center; justify-content: space-between; }
  .doc-type-band .doc-label { color: #fff; font-size: 12px; font-weight: 700; letter-spacing: 2px; text-transform: uppercase; }
  .doc-type-band .doc-ref { color: #fff; font-size: 13px; font-weight: 700; }
  .body-content { padding: 28px 40px; }
  .parties { display: flex; gap: 28px; margin-bottom: 24px; }
  .party { flex: 1; background: #f8fafc; border-radius: 8px; padding: 14px 16px; border: 1px solid #e5e7eb; }
  .party h3 { font-size: 10px; text-transform: uppercase; letter-spacing: 1.5px; color: #1a3a6b; margin-bottom: 8px; font-weight: 700; }
  .party p { font-size: 13px; line-height: 1.7; color: #374151; }
  .period-badge { display: inline-block; background: #f3f0ff; border: 1px solid #ddd6fe; border-radius: 8px; padding: 8px 16px; font-size: 13px; color: #5b21b6; margin-bottom: 20px; font-weight: 600; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 13px; }
  thead tr { background: #1a3a6b; color: #fff; }
  thead th { padding: 10px 12px; text-align: left; font-size: 12px; font-weight: 600; }
  tbody tr:nth-child(even) { background: #f8fafc; }
  .totals-wrap { display: flex; justify-content: flex-end; margin-bottom: 24px; }
  .totals { width: 320px; border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden; }
  .totals .total-row { background: #7c3aed; color: #fff; }
  .totals .total-row td { padding: 11px 14px; font-size: 15px; font-weight: 700; }
  .footer { padding: 16px 40px; border-top: 2px solid #1a3a6b; text-align: center; color: #9ca3af; font-size: 11px; line-height: 1.8; }
  .notes { background: #fafafa; border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px 16px; margin-bottom: 20px; font-size: 13px; color: #374151; }
</style>
</head>
<body>
  <div class="doc-header">
    <div class="logo-block">
      <img src="https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/logo-nayade_20a42bc4.jpg" alt="Náyade" />
      <div class="brand-text">
        <div class="brand-name">Náyade</div>
        <div class="brand-sub">Experiences</div>
      </div>
    </div>
    <div class="company-info">
      <strong>${data.companyData?.name ?? "Náyade Experiences S.L."}</strong>
      ${data.companyData?.address ?? "Los Ángeles de San Rafael, Segovia"}<br/>
      ${data.companyData?.email ?? "reservas@nayadeexperiences.es"} &middot; ${data.companyData?.phone ?? "+34 639 57 66 27"}
    </div>
  </div>
  <div class="doc-type-band">
    <span class="doc-label">Liquidación de Partner</span>
    <span class="doc-ref">${data.batchNumber} &nbsp;&middot;&nbsp; ${data.issuedAt.toLocaleDateString("es-ES")}</span>
  </div>

  <div class="body-content">
  <div class="parties">
    <div class="party">
      <h3>Emisor</h3>
      <p><strong>${data.companyData?.name ?? "Náyade Experiences S.L."}</strong><br/>
      ${data.companyData?.address ?? "Los Ángeles de San Rafael, Segovia"}<br/>
      CIF: ${data.companyData?.cif ?? ""}</p>
    </div>
    <div class="party">
      <h3>Partner</h3>
      <p><strong>${data.partnerFiscalName || data.partnerName}</strong><br/>
      ${data.partnerNif ? "NIF: " + data.partnerNif + "<br/>" : ""}
      ${partnerAddrLine ? partnerAddrLine : ""}</p>
    </div>
  </div>

  <div class="period-badge">
    Período de liquidación: <strong>${data.periodStart}</strong> &mdash; <strong>${data.periodEnd}</strong>
  </div>

  <table>
    <thead>
      <tr>
        <th>Reserva</th>
        <th style="text-align:center">Fecha</th>
        <th>Huésped</th>
        <th>Actividad</th>
        <th style="text-align:right">Importe</th>
      </tr>
    </thead>
    <tbody>${lineRows}</tbody>
  </table>

  <div class="totals-wrap"><table class="totals">
    <tr class="total-row"><td>TOTAL LIQUIDACIÓN</td><td style="text-align:right">${parseFloat(data.totalAmount || "0").toFixed(2)} €</td></tr>
  </table></div>

  ${data.notes ? `<div class="notes"><strong>Notas:</strong> ${data.notes}</div>` : ""}

  </div>
  <div class="footer">
    <p>${data.companyData?.name ?? "Náyade Experiences S.L."} &middot; www.skicenter.es</p>
    <p>Documento de liquidación de las reservas intermediadas por el partner durante el período indicado.</p>
  </div>
</body>
</html>`;

  try {
    const pdfBuffer = await htmlToPdf(html);
    const key = `partner-billing/${data.batchNumber}-${Date.now()}.pdf`;
    const { url } = await storagePut(key, pdfBuffer, "application/pdf");
    return { url, key };
  } catch (pdfErr) {
    console.error("[PDF] Error generando liquidación de partner, guardando HTML como fallback:", pdfErr);
    const key = `partner-billing/${data.batchNumber}-${Date.now()}.html`;
    const { url } = await storagePut(key, Buffer.from(html), "text/html");
    return { url, key };
  }
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
      // Drizzle 0.44+: pasar undefined (no null) para campos opcionales evita
      // problemas de generación SQL con columnas JSON y DECIMAL sin default.
      const insertValues: Record<string, any> = {
        name: input.name,
        slug,
        country: input.country,
        canCreateReservations: input.canCreateReservations,
        canCreateLeads: input.canCreateLeads,
        commissionType: input.commissionType,
        billingEnabled: input.billingEnabled,
        billingPeriod: input.billingPeriod,
      };
      if (input.fiscalName)    insertValues.fiscalName    = input.fiscalName;
      if (input.nif)           insertValues.nif           = input.nif;
      if (input.address)       insertValues.address       = input.address;
      if (input.city)          insertValues.city          = input.city;
      if (input.postalCode)    insertValues.postalCode    = input.postalCode;
      if (input.contactName)   insertValues.contactName   = input.contactName;
      if (input.contactEmail)  insertValues.contactEmail  = input.contactEmail;
      if (input.contactPhone)  insertValues.contactPhone  = input.contactPhone;
      if (input.billingEmail)  insertValues.billingEmail  = input.billingEmail;
      if (input.commissionValue) insertValues.commissionValue = input.commissionValue;
      if (input.monthlyQuota !== undefined) insertValues.monthlyQuota = input.monthlyQuota;
      if (input.notes)         insertValues.notes         = input.notes;
      if (input.allowedReservationProductIds?.length) {
        insertValues.allowedReservationProductIds = input.allowedReservationProductIds;
      }
      if (input.allowedLeadProductIds?.length) {
        insertValues.allowedLeadProductIds = input.allowedLeadProductIds;
      }

      try {
        const [result] = await db.insert(partners).values(insertValues as any);
        return { id: (result as any).insertId as number };
      } catch (e: any) {
        const cause = e.cause ?? e;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: cause.sqlMessage ?? cause.message ?? e.message,
        });
      }
    }),

  // ── ADMIN: Editar partner ──────────────────────────────────────────────────
  update: adminProcedure
    .input(z.object({
      id: z.number().int(),
      name: z.string().min(2).optional(),
      fiscalName: z.string().optional().nullable(),
      nif: z.string().optional().nullable(),
      address: z.string().optional().nullable(),
      city: z.string().optional().nullable(),
      postalCode: z.string().optional().nullable(),
      country: z.string().optional().nullable(),
      contactName: z.string().optional().nullable(),
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
        // Vincular usuario existente al partner y guardar token de activación
        // No tocar isActive: si ya tenía cuenta activa, puede seguir entrando
        await db.update(users)
          .set({
            role: input.role as any,
            inviteToken: token,
            inviteTokenExpiry: expiry,
            ...(({ partnerId: input.partnerId }) as any),
          } as any)
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
      const origin = process.env.APP_URL ?? "https://www.skicenter.es";
      const inviteUrl = `${origin}/partner/activar?token=${token}`;
      await sendEmail({
        to: input.email,
        subject: `Invitación al portal de colaboradores — ${partner.name}`,
        html: `
          <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:32px;">
            <h2 style="color:#ea580c">Bienvenido al portal de colaboradores</h2>
            <p>Hola <strong>${input.name}</strong>,</p>
            <p>Has sido invitado a acceder al portal de colaboradores de <strong>Skicenter</strong> como miembro de <strong>${partner.name}</strong>.</p>
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
      preferredTime: z.string().optional(),
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
        // z.record requiere keySchema + valueSchema (Zod v4+).
        details: z.record(z.string(), z.union([z.string(), z.number()])),
      })).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const user = ctx.user as any;
      const result = await dbCreateLead({
        name: input.name,
        email: input.email,
        phone: input.phone,
        preferredDate: input.preferredDate,
        preferredTime: input.preferredTime,
        numberOfAdults: input.numberOfAdults,
        numberOfChildren: input.numberOfChildren,
        numberOfPersons: input.numberOfAdults + (input.numberOfChildren ?? 0),
        message: input.comments,
        source: "PARTNER",
        leadSourceCode: "PARTNERS",
        selectedCategory: input.selectedCategory,
        selectedProduct: input.selectedProduct,
        activitiesJson: input.activitiesJson,
      });
      // dbCreateLead devuelve `number` (fast-path para fuentes externas tipo
      // GHL/Vapi) o `{ id, success }` para creaciones normales. Normalizamos.
      const leadId = typeof result === "number" ? result : result.id;
      // Vincular el lead al partner y al usuario que lo creó
      await db.update(leads)
        .set({ partnerId: user.partnerId, partnerUserId: user.id } as any)
        .where(eq(leads.id, leadId));
      return { leadId };
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
        status: "pending_payment",
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

      // Crear booking operativo + upsert cliente (fire-and-forget).
      // NO se crea transacción contable aquí: el pago quedará pendiente hasta que
      // la liquidación del partner se marque como cobrada.
      Promise.all([
        createBookingFromReservation({
          reservationId,
          productId: input.productId,
          productName: input.productName,
          bookingDate: input.bookingDate,
          people: input.people,
          amountCents,
          customerName: input.customerName,
          customerEmail: input.customerEmail,
          customerPhone: input.customerPhone,
          sourceChannel: "otro",
        }),
        upsertClientFromReservation({
          name: input.customerName,
          email: input.customerEmail,
          phone: input.customerPhone ?? null,
          source: "reserva_delegado",
          leadId: null,
        }),
      ]).catch((e: any) => console.error("[Partners] Error en post-reserva:", e.message));

      // Email de confirmación al cliente (solo si proporcionó email).
      // Fire-and-forget: si falla el email, la reserva sigue su curso.
      if (input.customerEmail) {
        try {
          const [resForUrl] = await db.select({ publicToken: reservations.publicToken })
            .from(reservations).where(eq(reservations.id, reservationId)).limit(1);
          const baseUrl = process.env.APP_URL ?? "https://www.skicenter.es";
          const reservationUrl = resForUrl?.publicToken ? `${baseUrl}/presupuesto/${resForUrl.publicToken}` : undefined;
          const bookingDateFormatted = (() => {
            try {
              return new Date(input.bookingDate).toLocaleDateString("es-ES", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
            } catch { return input.bookingDate; }
          })();
          const html = buildPartnerReservationConfirmHtml({
            merchantOrder: reservationNumber,
            productName: input.productName,
            customerName: input.customerName,
            date: bookingDateFormatted,
            people: input.people,
            partnerName: partner.name,
            reservationUrl,
          });
          sendEmail({
            to: input.customerEmail,
            subject: `✅ Reserva confirmada — ${input.productName} · Náyade Experiences`,
            html,
          })
            // Trazabilidad: evita un segundo envío si más tarde se toca esta
            // reserva desde el editor genérico de CRM.
            .then(() => db.update(reservations)
              .set({ confirmationEmailSentAt: new Date() } as any)
              .where(eq(reservations.id, reservationId)))
            .catch((e: any) => console.error("[Partners] Error enviando email cliente:", e?.message));
        } catch (emailErr: any) {
          console.error("[Partners] Error preparando email cliente:", emailErr?.message);
        }
      }

      // GHL: reutilizar contacto existente o crear nuevo, siempre disparar workflow
      try {
        const ghlCreds = await getGHLCredentials();
        if (ghlCreds) {
          const [existingLead] = await db
            .select({ ghlContactId: leads.ghlContactId })
            .from(leads)
            .where(eq(leads.email, input.customerEmail))
            .limit(1);

          const ghlContactId = existingLead?.ghlContactId
            ?? await createGHLContact({
              name: input.customerName,
              email: input.customerEmail,
              phone: input.customerPhone ?? undefined,
              tags: ["reserva_confirmada", "reserva_partner"],
            }, ghlCreds);

          if (ghlContactId) {
            // Sincronizar presupuesto_url al contacto (WhatsApp lee {{contact.presupuesto_url}})
            const [resForUrl] = await db.select({ publicToken: reservations.publicToken })
              .from(reservations).where(eq(reservations.id, reservationId)).limit(1);
            if (resForUrl?.publicToken) {
              const base = process.env.APP_URL ?? "https://www.skicenter.es";
              syncLeadUrlsToGHL({
                ghlContactId,
                quoteUrl: `${base}/presupuesto/${resForUrl.publicToken}`,
                email: input.customerEmail,
                phone: input.customerPhone ?? undefined,
                credentials: ghlCreds,
              });
            }
            const webhookUrl = process.env.GHL_RESERVATION_WEBHOOK_URL;
            if (webhookUrl) {
              await triggerGHLWorkflow(webhookUrl, {
                contactId: ghlContactId,
                reservationId,
                reservationNumber,
                merchantOrder,
                productName: input.productName,
                bookingDate: input.bookingDate,
                people: input.people,
                amountPaid: amountCents,
                customerName: input.customerName,
                customerEmail: input.customerEmail,
                customerPhone: input.customerPhone ?? null,
                source: "reserva_partner",
                partnerName: partner.name,
              });
            }
          }
        }
      } catch (ghlErr: any) {
        console.error("[Partners] Error en integración GHL:", ghlErr.message);
      }

      return { reservationId, reservationNumber, merchantOrder };
    }),

  // ── ADMIN: Productos disponibles para crear una reserva de partner ────────
  adminAvailableProducts: adminProcedure
    .query(async () => {
      // Catálogo COMPLETO para el administrador cuando registra una reserva
      // delegada de un partner desde /admin/partners. A diferencia del endpoint
      // `getAvailableProducts` (partnerProcedure, que respeta
      // `allowedReservationProductIds` del partner), aquí el admin tiene
      // libertad total: ve toda actividad ACTIVA, esté publicada o no en
      // web. Esto alinea la experiencia con la del CRM Comercial.
      return db
        .select({
          id: experiences.id,
          title: experiences.title,
          basePrice: experiences.basePrice,
          pricingType: experiences.pricingType,
        })
        .from(experiences)
        .where(eq(experiences.isActive, true))
        .orderBy(experiences.title);
    }),

  // ── ADMIN: Crear una reserva delegada (1..N líneas) en nombre de un partner ─
  //
  // Modelo: misma estrategia que el carrito web Redsys → cada actividad es una
  // fila independiente en `reservations` con el MISMO `merchantOrder`. Esto
  // mantiene intactos: asignación de monitor, REAV, liquidación al partner
  // (1 reserva → 1 línea de factura del partner_billing_batch_items) y emails
  // individuales por reserva si se necesitan.
  //
  // Datos compartidos por TODAS las líneas:
  //   · cliente (nombre/email/teléfono)
  //   · partner + canal "PARTNER" + paymentMethod "otro"
  //   · merchantOrder
  //   · delegationNote + delegationProof (un justificante para la operación)
  //
  // Datos por línea: producto, fecha, hora, personas, importe.
  //
  // Email: se envía UN solo email al cliente listando todas las actividades
  // (no N emails idénticos) — ver bloque al final del handler.
  adminCreateReservation: adminProcedure
    .input(z.object({
      partnerId: z.number().int(),
      customerName: z.string().min(2),
      customerEmail: z.string().email(),
      customerPhone: z.string().optional(),
      notes: z.string().optional(),
      // Justificante (único para toda la operación, no por línea)
      delegationNote: z.string().optional(),
      delegationProof: z.object({
        fileName: z.string(),
        mimeType: z.string(),
        dataBase64: z.string(),
      }).optional(),
      // 1..N líneas, cada una con su propio producto/fecha/hora/personas/importe
      lines: z.array(z.object({
        productId: z.number().int(),
        productName: z.string().min(1),
        bookingDate: z.string().min(1),
        selectedTime: z.string().optional(),
        selectedTimeSlotId: z.number().int().optional(),
        people: z.number().int().min(1),
        amountTotal: z.number().min(0), // en euros
      })).min(1).max(20),
    }))
    .mutation(async ({ input }) => {
      const [partner] = await db.select().from(partners).where(eq(partners.id, input.partnerId)).limit(1);
      if (!partner) throw new TRPCError({ code: "NOT_FOUND", message: "Partner no encontrado" });

      const merchantOrder = `PAR${Date.now().toString(36).slice(-8).toUpperCase()}`;
      const now = Date.now();

      // Subir el justificante (PDF / imagen) una sola vez para toda la operación.
      let delegationProofUrl: string | null = null;
      let delegationProofKey: string | null = null;
      if (input.delegationProof) {
        const allowed: Record<string, string> = {
          "application/pdf": "pdf", "image/jpeg": "jpg", "image/jpg": "jpg", "image/png": "png",
        };
        const ext = allowed[input.delegationProof.mimeType];
        if (!ext) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "El justificante debe ser PDF, JPG o PNG" });
        }
        const buffer = Buffer.from(input.delegationProof.dataBase64, "base64");
        if (buffer.length > 8 * 1024 * 1024) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "El justificante no puede superar 8 MB" });
        }
        const key = `partners/delegacion/${merchantOrder}_${Date.now()}.${ext}`;
        const stored = await storagePut(key, buffer, input.delegationProof.mimeType);
        delegationProofUrl = stored.url;
        delegationProofKey = stored.key;
      }

      // Insertar 1 fila por línea. Cada una con su propio reservationNumber pero
      // compartiendo merchantOrder, cliente, partner y justificante.
      const created: Array<{
        reservationId: number;
        reservationNumber: string;
        line: typeof input.lines[number];
        amountCents: number;
      }> = [];
      const defaultNote = `Reserva creada por el administrador para el partner ${partner.name}`;
      for (const line of input.lines) {
        const amountCents = Math.round(line.amountTotal * 100);
        const reservationNumber = await generateReservationNumber();
        const [result] = await db.insert(reservations).values({
          productId: line.productId,
          productName: line.productName,
          bookingDate: line.bookingDate,
          people: line.people,
          amountTotal: amountCents,
          amountPaid: 0,
          status: "pending_payment",
          statusReservation: "CONFIRMADA",
          statusPayment: "PENDIENTE",
          channel: "PARTNER",
          paymentMethod: "otro",
          customerName: input.customerName,
          customerEmail: input.customerEmail,
          customerPhone: input.customerPhone ?? null,
          merchantOrder,
          reservationNumber,
          notes: input.notes ?? defaultNote,
          selectedTimeSlotId: line.selectedTimeSlotId ?? null,
          selectedTime: line.selectedTime ?? null,
          delegationNote: input.delegationNote?.trim() || null,
          delegationProofUrl,
          delegationProofKey,
          partnerId: partner.id,
          partnerUserId: null,
          createdAt: now,
          updatedAt: now,
        } as any);
        const reservationId = (result as any).insertId as number;
        created.push({ reservationId, reservationNumber, line, amountCents });
      }

      // Booking operativo por línea + upsert del cliente UNA vez (fire-and-forget).
      // Sin transacción contable: el pago queda pendiente hasta la liquidación.
      Promise.all([
        ...created.map((c) => createBookingFromReservation({
          reservationId: c.reservationId,
          productId: c.line.productId,
          productName: c.line.productName,
          bookingDate: c.line.bookingDate,
          people: c.line.people,
          amountCents: c.amountCents,
          customerName: input.customerName,
          customerEmail: input.customerEmail,
          customerPhone: input.customerPhone,
          sourceChannel: "otro",
        })),
        upsertClientFromReservation({
          name: input.customerName,
          email: input.customerEmail,
          phone: input.customerPhone ?? null,
          source: "reserva_delegado",
          leadId: null,
        }),
      ]).catch((e: any) => console.error("[Partners] Error en post-reserva (admin):", e.message));

      // Email de confirmación al cliente: UNO solo agregando todas las líneas.
      // Para 1 línea conserva el formato clásico; para >1 muestra resumen.
      if (input.customerEmail) {
        try {
          const first = created[0];
          const [resForUrl] = await db.select({ publicToken: reservations.publicToken })
            .from(reservations).where(eq(reservations.id, first.reservationId)).limit(1);
          const baseUrl = process.env.APP_URL ?? "https://www.skicenter.es";
          const reservationUrl = resForUrl?.publicToken ? `${baseUrl}/presupuesto/${resForUrl.publicToken}` : undefined;
          const fmtDate = (s: string) => {
            try {
              return new Date(s).toLocaleDateString("es-ES", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
            } catch { return s; }
          };
          const totalPeople = created.reduce((s, c) => s + c.line.people, 0);
          const isMulti = created.length > 1;

          // Para multi-línea: concatenamos las actividades en `productName` y
          // listamos el desglose (SIN importes, pago gestionado por el partner) en detailHtml.
          const productName = isMulti
            ? `${created.length} actividades reservadas`
            : created[0].line.productName;
          const dateLabel = isMulti
            ? "Varias fechas (ver detalle abajo)"
            : fmtDate(created[0].line.bookingDate);
          const detailLines = created
            .map((c) => {
              const t = c.line.selectedTime ? ` · ${c.line.selectedTime}` : "";
              return `• ${c.line.productName} — ${fmtDate(c.line.bookingDate)}${t} · ${c.line.people} pers`;
            })
            .join("<br/>");

          const html = buildPartnerReservationConfirmHtml({
            merchantOrder,
            productName,
            customerName: input.customerName,
            date: dateLabel,
            people: totalPeople,
            partnerName: partner.name,
            detailHtml: isMulti ? detailLines : undefined,
            reservationUrl,
          });
          const subject = isMulti
            ? `✅ Reserva confirmada — ${created.length} actividades · Náyade Experiences`
            : `✅ Reserva confirmada — ${created[0].line.productName} · Náyade Experiences`;
          sendEmail({ to: input.customerEmail, subject, html })
            // Trazabilidad: evita un segundo envío si más tarde se toca alguna
            // de estas reservas desde el editor genérico de CRM.
            .then(() => Promise.all(created.map(c => db.update(reservations)
              .set({ confirmationEmailSentAt: new Date() } as any)
              .where(eq(reservations.id, c.reservationId)))))
            .catch((e: any) => console.error("[Partners] Error enviando email cliente:", e?.message));
        } catch (emailErr: any) {
          console.error("[Partners] Error preparando email cliente:", emailErr?.message);
        }
      }

      // Devolvemos info de todas las reservas creadas. El frontend usa la
      // primera reservationNumber para el toast de confirmación (la operación
      // es 1, aunque genere N reservas).
      return {
        merchantOrder,
        reservations: created.map((c) => ({
          reservationId: c.reservationId,
          reservationNumber: c.reservationNumber,
        })),
        // Compat retro con el formato anterior (un consumidor que lea
        // `reservationNumber` plano debería seguir funcionando).
        reservationId: created[0].reservationId,
        reservationNumber: created[0].reservationNumber,
      };
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

  // ─── FACTURACIÓN AGRUPADA ─────────────────────────────────────────────────

  // ── ADMIN: Listar liquidaciones ───────────────────────────────────────────
  listBatches: adminProcedure
    .input(z.object({
      partnerId: z.number().int().optional(),
      status: z.enum(["borrador", "emitida", "cobrada", "anulada"]).optional(),
    }).optional())
    .query(async ({ input }) => {
      const rows = await db
        .select({
          id: partnerBillingBatches.id,
          batchNumber: partnerBillingBatches.batchNumber,
          partnerId: partnerBillingBatches.partnerId,
          periodType: partnerBillingBatches.periodType,
          periodStart: partnerBillingBatches.periodStart,
          periodEnd: partnerBillingBatches.periodEnd,
          totalAmount: partnerBillingBatches.totalAmount,
          status: partnerBillingBatches.status,
          notes: partnerBillingBatches.notes,
          createdAt: partnerBillingBatches.createdAt,
          partnerName: partners.name,
          partnerFiscalName: partners.fiscalName,
          partnerNif: partners.nif,
        })
        .from(partnerBillingBatches)
        .leftJoin(partners, eq(partnerBillingBatches.partnerId, partners.id))
        .orderBy(desc(partnerBillingBatches.createdAt));

      let filtered = rows;
      if (input?.partnerId) filtered = filtered.filter(r => r.partnerId === input.partnerId);
      if (input?.status) filtered = filtered.filter(r => r.status === input.status);
      return filtered;
    }),

  // ── ADMIN: Detalle de una liquidación ─────────────────────────────────────
  getBatch: adminProcedure
    .input(z.object({ id: z.number().int() }))
    .query(async ({ input }) => {
      const [batch] = await db
        .select({
          id: partnerBillingBatches.id,
          batchNumber: partnerBillingBatches.batchNumber,
          partnerId: partnerBillingBatches.partnerId,
          periodType: partnerBillingBatches.periodType,
          periodStart: partnerBillingBatches.periodStart,
          periodEnd: partnerBillingBatches.periodEnd,
          totalAmount: partnerBillingBatches.totalAmount,
          status: partnerBillingBatches.status,
          notes: partnerBillingBatches.notes,
          createdAt: partnerBillingBatches.createdAt,
          partnerName: partners.name,
          partnerFiscalName: partners.fiscalName,
          partnerNif: partners.nif,
          partnerAddress: partners.address,
          partnerCity: partners.city,
          partnerPostalCode: partners.postalCode,
          partnerBillingEmail: partners.billingEmail,
        })
        .from(partnerBillingBatches)
        .leftJoin(partners, eq(partnerBillingBatches.partnerId, partners.id))
        .where(eq(partnerBillingBatches.id, input.id))
        .limit(1);

      if (!batch) throw new TRPCError({ code: "NOT_FOUND" });

      const items = await db
        .select({
          id: partnerBillingBatchItems.id,
          reservationId: partnerBillingBatchItems.reservationId,
          amount: partnerBillingBatchItems.amount,
          description: partnerBillingBatchItems.description,
          customerName: reservations.customerName,
          customerEmail: reservations.customerEmail,
          productName: reservations.productName,
          bookingDate: reservations.bookingDate,
          people: reservations.people,
          reservationNumber: reservations.reservationNumber,
          amountTotal: reservations.amountTotal,
        })
        .from(partnerBillingBatchItems)
        .leftJoin(reservations, eq(partnerBillingBatchItems.reservationId, reservations.id))
        .where(eq(partnerBillingBatchItems.batchId, input.id));

      return { ...batch, items };
    }),

  // ── ADMIN: Generar PDF descargable de una liquidación ──────────────────────
  generateBatchPdf: adminProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ input }) => {
      const [batch] = await db
        .select({
          batchNumber: partnerBillingBatches.batchNumber,
          periodStart: partnerBillingBatches.periodStart,
          periodEnd: partnerBillingBatches.periodEnd,
          totalAmount: partnerBillingBatches.totalAmount,
          notes: partnerBillingBatches.notes,
          createdAt: partnerBillingBatches.createdAt,
          partnerName: partners.name,
          partnerFiscalName: partners.fiscalName,
          partnerNif: partners.nif,
          partnerAddress: partners.address,
          partnerCity: partners.city,
          partnerPostalCode: partners.postalCode,
        })
        .from(partnerBillingBatches)
        .leftJoin(partners, eq(partnerBillingBatches.partnerId, partners.id))
        .where(eq(partnerBillingBatches.id, input.id))
        .limit(1);

      if (!batch) throw new TRPCError({ code: "NOT_FOUND" });

      const items = await db
        .select({
          amount: partnerBillingBatchItems.amount,
          customerName: reservations.customerName,
          productName: reservations.productName,
          bookingDate: reservations.bookingDate,
          reservationNumber: reservations.reservationNumber,
        })
        .from(partnerBillingBatchItems)
        .leftJoin(reservations, eq(partnerBillingBatchItems.reservationId, reservations.id))
        .where(eq(partnerBillingBatchItems.batchId, input.id));

      // Datos fiscales de la empresa desde siteSettings (mismos que las liquidaciones de proveedor)
      const settingsRows = await db.select().from(siteSettings)
        .where(sql`\`key\` IN ('legalCompanyName','legalCompanyCif','legalCompanyAddress','legalCompanyEmail','legalCompanyPhone')`);
      const s: Record<string, string> = Object.fromEntries(settingsRows.map(r => [r.key, r.value ?? ""]));
      const companyData = {
        name: s.legalCompanyName || "Náyade Experiences S.L.",
        cif: s.legalCompanyCif || "",
        address: s.legalCompanyAddress || "Los Ángeles de San Rafael, Segovia",
        email: s.legalCompanyEmail || "reservas@nayadeexperiences.es",
        phone: s.legalCompanyPhone || "+34 639 57 66 27",
      };

      const { url, key } = await generatePartnerBillingPdfAndUpload({
        batchNumber: batch.batchNumber,
        partnerName: batch.partnerName ?? "—",
        partnerFiscalName: batch.partnerFiscalName,
        partnerNif: batch.partnerNif,
        partnerAddress: batch.partnerAddress,
        partnerCity: batch.partnerCity,
        partnerPostalCode: batch.partnerPostalCode,
        periodStart: batch.periodStart,
        periodEnd: batch.periodEnd,
        totalAmount: batch.totalAmount ?? "0",
        notes: batch.notes,
        issuedAt: new Date(batch.createdAt),
        items: items.map(it => ({
          reservationNumber: it.reservationNumber,
          bookingDate: it.bookingDate,
          customerName: it.customerName,
          productName: it.productName,
          amount: it.amount ?? "0",
        })),
        companyData,
      });

      return { url, key };
    }),

  // ── ADMIN: Reservas sin liquidar de un partner en un período ──────────────
  getUnbilled: adminProcedure
    .input(z.object({
      partnerId: z.number().int(),
      periodStart: z.string().min(1),
      periodEnd: z.string().min(1),
    }))
    .query(async ({ input }) => {
      const allItems = await db
        .select({ rid: partnerBillingBatchItems.reservationId })
        .from(partnerBillingBatchItems);
      const billedIds = allItems.map(r => r.rid);

      const conds: any[] = [
        eq((reservations as any).partnerId, input.partnerId),
        gte(reservations.bookingDate, input.periodStart),
        lte(reservations.bookingDate, input.periodEnd),
      ];
      if (billedIds.length > 0) conds.push(notInArray(reservations.id, billedIds));

      const rows = await db
        .select()
        .from(reservations)
        .where(and(...conds))
        .orderBy(reservations.bookingDate);
      return rows;
    }),

  // ── ADMIN: Crear una liquidación ──────────────────────────────────────────
  createBatch: adminProcedure
    .input(z.object({
      partnerId: z.number().int(),
      periodType: z.enum(["weekly", "biweekly", "monthly", "manual"]).default("monthly"),
      periodStart: z.string().min(1),
      periodEnd: z.string().min(1),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const [partner] = await db.select().from(partners).where(eq(partners.id, input.partnerId)).limit(1);
      if (!partner) throw new TRPCError({ code: "NOT_FOUND", message: "Partner no encontrado" });

      const allItems = await db
        .select({ rid: partnerBillingBatchItems.reservationId })
        .from(partnerBillingBatchItems);
      const billedIds = allItems.map(r => r.rid);

      const conds: any[] = [
        eq((reservations as any).partnerId, input.partnerId),
        gte(reservations.bookingDate, input.periodStart),
        lte(reservations.bookingDate, input.periodEnd),
      ];
      if (billedIds.length > 0) conds.push(notInArray(reservations.id, billedIds));

      const unbilled = await db.select().from(reservations).where(and(...conds));
      if (unbilled.length === 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "No hay reservas sin liquidar en ese período" });
      }

      const totalEuros = unbilled.reduce((acc, r) => acc + (r.amountTotal ?? 0) / 100, 0);

      // Número secuencial: LIQ-YYYY-XXXX
      const year = new Date().getFullYear();
      const [countRow] = await db
        .select({ cnt: sql<number>`COUNT(*)` })
        .from(partnerBillingBatches)
        .where(sql`YEAR(\`createdAt\`) = ${year}`);
      const seq = (Number((countRow as any).cnt ?? 0) + 1).toString().padStart(4, "0");
      const batchNumber = `LIQ-${year}-${seq}`;

      const user = ctx.user as any;
      const [result] = await db.insert(partnerBillingBatches).values({
        batchNumber,
        partnerId: input.partnerId,
        periodType: input.periodType,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        totalAmount: totalEuros.toFixed(2),
        status: "borrador",
        notes: input.notes ?? null,
        createdBy: user.id,
      } as any);
      const batchId = (result as any).insertId as number;

      await db.insert(partnerBillingBatchItems).values(
        unbilled.map(r => ({
          batchId,
          reservationId: r.id,
          amount: ((r.amountTotal ?? 0) / 100).toFixed(2),
          description: `${r.productName ?? ""} · ${r.bookingDate ?? ""} · ${r.customerName ?? ""}`,
        } as any))
      );

      return { batchId, batchNumber, total: totalEuros, itemCount: unbilled.length };
    }),

  // ── ADMIN: Cambiar estado de una liquidación ──────────────────────────────
  updateBatchStatus: adminProcedure
    .input(z.object({
      id: z.number().int(),
      status: z.enum(["borrador", "emitida", "cobrada", "anulada"]),
    }))
    .mutation(async ({ input }) => {
      const [existing] = await db
        .select()
        .from(partnerBillingBatches)
        .where(eq(partnerBillingBatches.id, input.id))
        .limit(1);
      if (!existing) throw new TRPCError({ code: "NOT_FOUND" });

      const now = Date.now();
      await db
        .update(partnerBillingBatches)
        .set({ status: input.status })
        .where(eq(partnerBillingBatches.id, input.id));

      // Al marcar como cobrada: liquidar reservas + crear transacciones contables
      if (input.status === "cobrada") {
        const items = await db
          .select({ reservationId: partnerBillingBatchItems.reservationId, amount: partnerBillingBatchItems.amount })
          .from(partnerBillingBatchItems)
          .where(eq(partnerBillingBatchItems.batchId, input.id));

        const reservationIds = items.map(i => i.reservationId).filter((id): id is number => id != null);

        if (reservationIds.length > 0) {
          // Obtener datos de las reservas para crear las transacciones
          const resRows = await db
            .select()
            .from(reservations)
            .where(inArray(reservations.id, reservationIds));

          // Actualizar todas las reservas a pagadas
          await db.update(reservations)
            .set({
              status: "paid",
              statusPayment: "PAGADO",
              paidAt: now,
              updatedAt: now,
            } as any)
            .where(inArray(reservations.id, reservationIds));

          // Actualizar amountPaid por separado (igual a amountTotal para cada una)
          for (const res of resRows) {
            await db.update(reservations)
              .set({ amountPaid: res.amountTotal ?? 0 } as any)
              .where(eq(reservations.id, res.id));
          }

          // Crear transacciones contables (una por reserva, idempotente)
          for (const res of resRows) {
            const existingTx = await db
              .select({ id: transactions.id })
              .from(transactions)
              .where(eq((transactions as any).reservationId, res.id))
              .limit(1);
            if (existingTx.length > 0) continue;

            const txNumber = `TX-PAR-${existing.batchNumber}-${res.id}`;
            await db.insert(transactions).values({
              transactionNumber: txNumber,
              type: "ingreso",
              amount: String(((res.amountTotal ?? 0) / 100).toFixed(2)),
              currency: "EUR",
              paymentMethod: "otro",
              status: "completado",
              description: `Liquidación partner ${existing.batchNumber} — ${res.productName ?? ""} · ${res.bookingDate ?? ""} · ${res.customerName ?? ""}`,
              processedAt: new Date(now),
              clientName: res.customerName ?? null,
              clientEmail: res.customerEmail ?? null,
              clientPhone: res.customerPhone ?? null,
              productName: res.productName ?? null,
              saleChannel: "delegado",
              taxBase: "0",
              taxAmount: "0",
              reavMargin: "0",
              fiscalRegime: "general",
              reservationId: res.id,
            } as any);
          }

          console.log(`[Partners] Batch ${existing.batchNumber} cobrada — ${reservationIds.length} reservas liquidadas`);
        }
      }

      return { ok: true };
    }),

  // ── ADMIN: Eliminar liquidación (solo borrador) ───────────────────────────
  deleteBatch: adminProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ input }) => {
      const [existing] = await db
        .select()
        .from(partnerBillingBatches)
        .where(eq(partnerBillingBatches.id, input.id))
        .limit(1);
      if (!existing) throw new TRPCError({ code: "NOT_FOUND" });
      if (existing.status !== "borrador") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Solo se pueden eliminar liquidaciones en borrador" });
      }
      await db.delete(partnerBillingBatchItems).where(eq(partnerBillingBatchItems.batchId, input.id));
      await db.delete(partnerBillingBatches).where(eq(partnerBillingBatches.id, input.id));
      return { ok: true };
    }),

  // ── PARTNER: Notas/anuncios del admin al partner ─────────────────────────
  getAnnouncements: partnerProcedure
    .query(async ({ ctx }) => {
      const user = ctx.user as any;
      const [partner] = await db
        .select({ announcements: partners.announcements })
        .from(partners)
        .where(eq(partners.id, user.partnerId))
        .limit(1);
      const all = (partner?.announcements as any[]) ?? [];
      const now = new Date();
      return all.filter((a: any) => !a.expiresAt || new Date(a.expiresAt) > now);
    }),

  // ── ADMIN: Guardar notas/anuncios para un partner ─────────────────────────
  adminSaveAnnouncements: adminProcedure
    .input(z.object({
      partnerId: z.number().int(),
      announcements: z.array(z.object({
        id: z.string(),
        text: z.string().min(1),
        isNew: z.boolean(),
        createdAt: z.string(),
        expiresAt: z.string().nullable().optional(),
      })),
    }))
    .mutation(async ({ input }) => {
      await db.update(partners)
        .set({ announcements: input.announcements } as any)
        .where(eq(partners.id, input.partnerId));
      return { ok: true };
    }),

  // ── PARTNER: Productos disponibles para reservar ─────────────────────────
  getAvailableProducts: partnerProcedure
    .query(async ({ ctx }) => {
      const user = ctx.user as any;
      const [partner] = await db
        .select({ allowedReservationProductIds: partners.allowedReservationProductIds })
        .from(partners)
        .where(eq(partners.id, user.partnerId))
        .limit(1);

      const allProds = await db
        .select({
          id: experiences.id,
          title: experiences.title,
          basePrice: experiences.basePrice,
          pricingType: experiences.pricingType,
        })
        .from(experiences)
        .where(and(eq(experiences.isActive, true), eq(experiences.isPublished, true)))
        .orderBy(experiences.sortOrder);

      const allowedIds = partner?.allowedReservationProductIds as number[] | null;
      if (allowedIds && allowedIds.length > 0) {
        return allProds.filter(p => allowedIds.includes(p.id));
      }
      return allProds;
    }),

  // ── ADMIN: Todos los productos (para configurar allowed en el formulario) ─
  adminGetAllProducts: adminProcedure
    .query(async () => {
      return db
        .select({
          id: experiences.id,
          title: experiences.title,
          basePrice: experiences.basePrice,
          isActive: experiences.isActive,
          isPublished: experiences.isPublished,
        })
        .from(experiences)
        .orderBy(experiences.sortOrder);
    }),

  // ── ADMIN: Leads generados por un partner ────────────────────────────────
  adminListLeads: adminProcedure
    .input(z.object({ partnerId: z.number().int() }))
    .query(async ({ input }) => {
      const rows = await db
        .select({
          id: leads.id,
          name: leads.name,
          email: leads.email,
          phone: leads.phone,
          status: leads.status,
          opportunityStatus: leads.opportunityStatus,
          priority: leads.priority,
          selectedCategory: (leads as any).selectedCategory,
          createdAt: leads.createdAt,
        })
        .from(leads)
        .where(eq((leads as any).partnerId, input.partnerId))
        .orderBy(desc(leads.createdAt))
        .limit(200);
      return rows;
    }),

  // ── ADMIN: Reservas generadas por un partner ─────────────────────────────
  adminListReservations: adminProcedure
    .input(z.object({ partnerId: z.number().int() }))
    .query(async ({ input }) => {
      const rows = await db
        .select({
          id: reservations.id,
          reservationNumber: (reservations as any).reservationNumber,
          productName: reservations.productName,
          bookingDate: reservations.bookingDate,
          people: reservations.people,
          amountTotal: reservations.amountTotal,
          customerName: reservations.customerName,
          customerEmail: reservations.customerEmail,
          status: reservations.status,
          statusReservation: (reservations as any).statusReservation,
          createdAt: reservations.createdAt,
        })
        .from(reservations)
        .where(eq((reservations as any).partnerId, input.partnerId))
        .orderBy(desc(reservations.createdAt))
        .limit(200);
      return rows;
    }),
});
