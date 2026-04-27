/**
 * Ticketing Router — Pipeline de Cupones & Plataformas
 * Flujo: Recibido → Pendiente → Reserva generada
 * Financiero: Pendiente canjear → Canjeado | Incidencia
 */
import { router, protectedProcedure, publicProcedure } from "../_core/trpc";
import { checkRbacOrLegacy } from "../_core/rbac";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import {
  ticketingProducts,
  couponRedemptions,
  couponEmailConfig,
  experiences,
  reservations,
  clients,
  platforms,
  platformProducts,
  platformSettlements,
} from "../../drizzle/schema";
import { eq, desc, and, like, or, sql, count, inArray, sum } from "drizzle-orm";
import { sendEmail as sharedSendEmail } from "../mailer";
import { storagePut } from "../storage";
import { invokeLLM } from "../_core/llm";
import { buildReservationConfirmHtml, buildCouponRedemptionReceivedHtml, buildCouponPostponedHtml, buildCouponInternalAlertHtml } from "../emailTemplates";
import { postConfirmOperation, logActivity, generateReservationNumber } from "../db";
import { assertModuleEnabled } from "../_core/flagGuard";
import { getSystemSettingSync } from "../config";

const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 3 });
const db = drizzle(_pool);

const getCopyEmail = () => getSystemSettingSync("email_reservations", "contacto@tuempresa.com");

// ─── PROVEEDORES FIJOS ────────────────────────────────────────────────────────
export const FIXED_PROVIDERS = [
  "Groupon",
  "Smartbox",
  "CheckYeti",
  "Atrapalo",
  "Jumping",
  "Alpine Resort",
  "Civitatis",
] as const;

type FixedProvider = typeof FIXED_PROVIDERS[number];

// ─── STATUS TYPES ─────────────────────────────────────────────────────────────
type StatusOperational = "recibido" | "pendiente" | "reserva_generada";
type StatusFinancial = "pendiente_canjear" | "canjeado" | "incidencia";

// ─── EMAIL HELPER ─────────────────────────────────────────────────────────────
async function sendEmail(opts: { to: string; subject: string; html: string }) {
  const sent = await sharedSendEmail(opts);
  if (!sent) console.warn("[Ticketing] SMTP not configured, skipping email");
  else await sharedSendEmail({ to: getCopyEmail(), subject: `[COPIA] ${opts.subject}`, html: opts.html });
}

// ─── ADMIN PROCEDURE (RBAC-aware) ────────────────────────────────────────────
// Uses ticketing.manage permission; fallback: admin or agente (legacy behavior).
// assertModuleEnabled preserved. Zero changes to individual procedure definitions.
const adminProc = protectedProcedure.use(async ({ ctx, next }) => {
  await assertModuleEnabled("ticketing_module_enabled");
  const allowed = await checkRbacOrLegacy(
    ctx.user.id,
    ctx.user.role as string,
    "ticketing.manage",
    ["admin", "agente"],
  );
  if (!allowed) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Acceso restringido a administradores y agentes" });
  }
  return next({ ctx });
});

// ─── OCR ENGINE ──────────────────────────────────────────────────────────────
async function runOcrExtraction(attachmentUrl: string, formData: {
  couponCode: string;
  securityCode?: string;
  productName?: string;
  customerName: string;
}): Promise<{
  score: number;
  status: "alta" | "media" | "baja" | "conflicto";
  rawData: Record<string, unknown>;
}> {
  try {
    const prompt = `Analiza esta imagen/PDF de un cupón y extrae la siguiente información en JSON:
- coupon_code: código del cupón
- security_code: código de seguridad
- product_name: nombre del producto/experiencia
- customer_name: nombre del cliente
- expiry_date: fecha de caducidad (si aparece)
- provider: proveedor (Groupon, Smartbox, etc.)

Responde SOLO con JSON válido, sin texto adicional.`;

    const response = await invokeLLM({
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: attachmentUrl, detail: "high" } },
          ],
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "coupon_ocr",
          strict: true,
          schema: {
            type: "object",
            properties: {
              coupon_code: { type: "string" },
              security_code: { type: "string" },
              product_name: { type: "string" },
              customer_name: { type: "string" },
              expiry_date: { type: "string" },
              provider: { type: "string" },
            },
            required: ["coupon_code", "security_code", "product_name", "customer_name", "expiry_date", "provider"],
            additionalProperties: false,
          },
        },
      },
    });

    const rawData = JSON.parse(response.choices[0].message.content as string) as Record<string, unknown>;
    let score = 50;
    let conflicts = 0;

    if (rawData.coupon_code && typeof rawData.coupon_code === "string") {
      const extracted = (rawData.coupon_code as string).replace(/\s/g, "").toUpperCase();
      const provided = formData.couponCode.replace(/\s/g, "").toUpperCase();
      if (extracted === provided) score += 30;
      else { score -= 20; conflicts++; }
    }
    if (rawData.customer_name && typeof rawData.customer_name === "string") {
      const extracted = (rawData.customer_name as string).toLowerCase();
      const provided = formData.customerName.toLowerCase();
      if (extracted.includes(provided.split(" ")[0]) || provided.includes(extracted.split(" ")[0])) score += 10;
    }
    if (rawData.security_code && formData.securityCode) {
      const extracted = (rawData.security_code as string).replace(/\s/g, "").toUpperCase();
      const provided = formData.securityCode.replace(/\s/g, "").toUpperCase();
      if (extracted === provided) score += 10;
      else { score -= 10; conflicts++; }
    }

    score = Math.max(0, Math.min(100, score));
    const status: "alta" | "media" | "baja" | "conflicto" =
      conflicts > 0 ? "conflicto" : score >= 80 ? "alta" : score >= 60 ? "media" : "baja";

    return { score, status, rawData };
  } catch {
    return { score: 0, status: "baja", rawData: {} };
  }
}

// ─── DUPLICATE CHECK ─────────────────────────────────────────────────────────
async function checkDuplicates(
  couponCode: string,
  securityCode?: string,
  email?: string,
  phone?: string,
  requestedDate?: string,
  productTicketingId?: number,
): Promise<{ hardDuplicate: boolean; softDuplicate: boolean; notes: string }> {
  const hardConditions = [like(couponRedemptions.couponCode, couponCode)];
  if (securityCode) {
    hardConditions.push(like(couponRedemptions.securityCode, securityCode));
  }
  const hardDupes = await db
    .select({ id: couponRedemptions.id })
    .from(couponRedemptions)
    .where(and(...hardConditions))
    .limit(1);

  if (hardDupes.length > 0) {
    return { hardDuplicate: true, softDuplicate: false, notes: "Código de cupón duplicado (hard)" };
  }

  const softNotes: string[] = [];
  if (email && requestedDate) {
    const emailDateDupes = await db
      .select({ id: couponRedemptions.id })
      .from(couponRedemptions)
      .where(and(eq(couponRedemptions.email, email), eq(couponRedemptions.requestedDate, requestedDate)))
      .limit(1);
    if (emailDateDupes.length > 0) softNotes.push("Mismo email y fecha");
  }
  if (phone && productTicketingId) {
    const phoneProdDupes = await db
      .select({ id: couponRedemptions.id })
      .from(couponRedemptions)
      .where(and(eq(couponRedemptions.phone, phone), eq(couponRedemptions.productTicketingId, productTicketingId)))
      .limit(1);
    if (phoneProdDupes.length > 0) softNotes.push("Mismo teléfono y producto");
  }

  return {
    hardDuplicate: false,
    softDuplicate: softNotes.length > 0,
    notes: softNotes.join("; "),
  };
}

// ─── EMAIL TEMPLATES ─────────────────────────────────────────────────────────
function buildRedemptionConfirmationHtml(data: {
  customerName: string;
  email: string;
  phone?: string;
  coupons: { couponCode: string; provider: string }[];
  submissionId: string;
  requestedDate?: string;
}) {
  return buildCouponRedemptionReceivedHtml({ customerName: data.customerName, coupons: data.coupons, submissionId: data.submissionId, requestedDate: data.requestedDate });
}
function buildPostponeEmailHtml(data: {
  customerName: string;
  couponCode: string;
  provider: string;
  productName: string;
  requestedDate?: string;
}) {
  return buildCouponPostponedHtml({ customerName: data.customerName, couponCode: data.couponCode, provider: data.provider, productName: data.productName, requestedDate: data.requestedDate });
}
function buildInternalAlertHtml(data: {
  customerName: string;
  email: string;
  phone?: string;
  coupons: { couponCode: string; provider: string }[];
  submissionId: string;
  requestedDate?: string;
}) {
  return buildCouponInternalAlertHtml({ customerName: data.customerName, email: data.email, phone: data.phone, coupons: data.coupons, submissionId: data.submissionId, requestedDate: data.requestedDate });
}
// ─── ROUTER ───────────────────────────────────────────────────────────────────
export const ticketingRouter = router({

  // ── PRODUCTOS TICKETING ──────────────────────────────────────────────────
  listProducts: adminProc.query(async () => {
    return db.select().from(ticketingProducts).orderBy(desc(ticketingProducts.createdAt));
  }),

  getProduct: adminProc
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const [product] = await db.select().from(ticketingProducts).where(eq(ticketingProducts.id, input.id)).limit(1);
      if (!product) throw new TRPCError({ code: "NOT_FOUND" });
      return product;
    }),

  createProduct: adminProc
    .input(z.object({
      name: z.string().min(1),
      provider: z.string().default("Groupon"),
      linkedProductId: z.number().optional(),
      stationsAllowed: z.array(z.string()).optional(),
      rules: z.string().optional(),
      commission: z.string().optional(),
      expectedPrice: z.string().optional(),
      active: z.boolean().default(true),
    }))
    .mutation(async ({ input }) => {
      const [result] = await db.insert(ticketingProducts).values({
        name: input.name,
        provider: input.provider,
        linkedProductId: input.linkedProductId ?? null,
        stationsAllowed: input.stationsAllowed ?? null,
        rules: input.rules ?? null,
        commission: input.commission ?? "20.00",
        expectedPrice: input.expectedPrice ?? null,
        active: input.active,
      });
      return { id: (result as { insertId: number }).insertId };
    }),

  updateProduct: adminProc
    .input(z.object({
      id: z.number(),
      name: z.string().min(1).optional(),
      provider: z.string().optional(),
      linkedProductId: z.number().nullable().optional(),
      stationsAllowed: z.array(z.string()).nullable().optional(),
      rules: z.string().nullable().optional(),
      commission: z.string().optional(),
      expectedPrice: z.string().nullable().optional(),
      active: z.boolean().optional(),
    }))
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      await db.update(ticketingProducts).set(data as Record<string, unknown>).where(eq(ticketingProducts.id, id));
      return { success: true };
    }),

  deleteProduct: adminProc
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await db.delete(ticketingProducts).where(eq(ticketingProducts.id, input.id));
      return { success: true };
    }),

  /** Público: listar productos activos de plataforma para el formulario de canje */
  listActiveProducts: publicProcedure
    .input(z.object({ provider: z.string().default("Groupon") }))
    .query(async ({ input }) => {
      const rows = await db
        .select({
          id: platformProducts.id,
          name: platformProducts.externalProductName,
          provider: platforms.name,
          expiresAt: platformProducts.expiresAt,
        })
        .from(platformProducts)
        .innerJoin(platforms, eq(platformProducts.platformId, platforms.id))
        .where(
          and(
            eq(platformProducts.active, true),
            eq(platforms.active, true),
            sql`LOWER(${platforms.name}) = LOWER(${input.provider})`,
          )
        )
        .orderBy(platformProducts.externalProductName);
      const now = new Date();
      return rows
        .filter((r): r is { id: number; name: string; provider: string; expiresAt: Date | null } => !!r.name)
        .filter((r) => !r.expiresAt || r.expiresAt > now);
    }),

  // ── UPLOAD ADJUNTO CUPÓN (base64, público) ───────────────────────────────
  /** Público: recibe archivo en base64 → intenta subir a storage; si no está
   *  configurado, devuelve la data URL para guardarla directamente en DB. */
  uploadCouponAttachment: publicProcedure
    .input(z.object({
      filename: z.string().max(256),
      mimeType: z.string().max(128),
      base64Data: z.string().max(14 * 1024 * 1024), // ~10MB en base64
    }))
    .mutation(async ({ input }) => {
      const allowed = ["image/jpeg", "image/jpg", "image/png", "image/webp", "application/pdf"];
      if (!allowed.includes(input.mimeType)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Tipo no permitido. Solo JPG, PNG, WEBP o PDF." });
      }
      const buffer = Buffer.from(input.base64Data, "base64");
      if (buffer.length > 10 * 1024 * 1024) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "El archivo no puede superar 10MB." });
      }
      // Intentar subir a storage (S3/Forge)
      try {
        const ext = input.filename.split(".").pop()?.toLowerCase() || "bin";
        const ts = Date.now();
        const random = Math.random().toString(36).substring(2, 10);
        const key = `nayade/coupons/${ts}-${random}.${ext}`;
        const { url } = await storagePut(key, buffer, input.mimeType);
        // Si la URL es local (/local-storage/...) también aceptamos — son archivos en /tmp
        return { url };
      } catch {
        // Storage no configurado → guardar como data URL en DB (MEDIUMTEXT soporta ~16MB)
        const dataUrl = `data:${input.mimeType};base64,${input.base64Data}`;
        return { url: dataUrl };
      }
    }),

  // ── SOLICITUDES DE CANJE (MULTI-CUPÓN) ───────────────────────────────────
  /** Público: crear múltiples cupones en un mismo envío */
  createSubmission: publicProcedure
    .input(z.object({
      provider: z.string().default("Groupon"),
      customerName: z.string().min(1),
      email: z.string().email(),
      phone: z.string().optional(),
      coupons: z.array(z.object({
        couponCode: z.string().min(1),
        securityCode: z.string().optional(),
        productTicketingId: z.number().optional(),
        platformProductId: z.number().optional(),
        attachmentUrl: z.string().optional(),
        provider: z.string().default("Groupon"),
      })).min(1).max(10),
      requestedDate: z.string().optional(),
      station: z.string().optional(),
      participants: z.number().int().min(1).default(1),
      children: z.number().int().min(0).default(0),
      comments: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const submissionId = crypto.randomUUID();
      const results: { couponCode: string; accepted: boolean; reason?: string; redemptionId?: number }[] = [];
      const validResults: { couponCode: string; provider: string }[] = [];

      for (const coupon of input.coupons) {
        const dupCheck = await checkDuplicates(coupon.couponCode, coupon.securityCode, input.email, input.phone, input.requestedDate, coupon.productTicketingId);
        if (dupCheck.hardDuplicate) {
          results.push({ couponCode: coupon.couponCode, accepted: false, reason: "Código duplicado" });
          continue;
        }
        let productName = "Experiencia Náyade";
        if (coupon.productTicketingId) {
          const [prod] = await db.select({ name: ticketingProducts.name }).from(ticketingProducts).where(eq(ticketingProducts.id, coupon.productTicketingId)).limit(1);
          if (prod) productName = prod.name;
        }
        const [result] = await db.insert(couponRedemptions).values({
          provider: coupon.provider ?? input.provider,
          productTicketingId: coupon.productTicketingId ?? null,
          platformProductId: coupon.platformProductId ?? null,
          customerName: input.customerName,
          email: input.email,
          phone: input.phone ?? null,
          couponCode: coupon.couponCode,
          securityCode: coupon.securityCode ?? null,
          attachmentUrl: coupon.attachmentUrl ?? null,
          requestedDate: input.requestedDate ?? null,
          station: input.station ?? null,
          participants: input.participants,
          children: input.children,
          comments: input.comments ?? null,
          statusOperational: "recibido",
          statusFinancial: "pendiente_canjear",
          duplicateFlag: dupCheck.softDuplicate,
          duplicateNotes: dupCheck.notes || null,
          submissionId,
          originSource: "web",
          channelEntry: "web",
        });
        const redemptionId = (result as { insertId: number }).insertId;
        results.push({ couponCode: coupon.couponCode, accepted: true, redemptionId });
        validResults.push({ couponCode: coupon.couponCode, provider: coupon.provider ?? input.provider });

        // OCR en background
        if (coupon.attachmentUrl) {
          const attachUrl = coupon.attachmentUrl;
          const pName = productName;
          setImmediate(async () => {
            try {
              const ocr = await runOcrExtraction(attachUrl, { couponCode: coupon.couponCode, securityCode: coupon.securityCode, productName: pName, customerName: input.customerName });
              await db.update(couponRedemptions).set({ ocrConfidenceScore: ocr.score, ocrStatus: ocr.status, ocrRawData: ocr.rawData }).where(eq(couponRedemptions.id, redemptionId));
            } catch { /* silent */ }
          });
        }
      }

      // Upsert cliente en CRM — siempre, independientemente de si los cupones son válidos
      // (el simple hecho de rellenar el formulario debe crear el cliente)
      try {
        const [existingCuponClient] = await db.select({ id: clients.id, name: clients.name, phone: clients.phone }).from(clients).where(eq(clients.email, input.email)).limit(1);
        if (existingCuponClient) {
          await db.update(clients).set({
            name: existingCuponClient.name?.trim() ? existingCuponClient.name : input.customerName,
            phone: existingCuponClient.phone?.trim() ? existingCuponClient.phone : (input.phone ?? ""),
            updatedAt: new Date(),
          }).where(eq(clients.id, existingCuponClient.id));
        } else {
          await db.insert(clients).values({ source: "cupon", name: input.customerName, email: input.email, phone: input.phone ?? "", company: "", tags: [], isConverted: false, totalBookings: 0 });
        }
      } catch (e) {
        console.error("[createSubmission] Error al crear/actualizar cliente en CRM:", e);
      }

      if (validResults.length > 0) {
        // Email confirmación cliente
        sendEmail({
          to: input.email,
          subject: `Hemos recibido tu solicitud de canje — ${input.provider}`,
          html: buildRedemptionConfirmationHtml({ customerName: input.customerName, email: input.email, phone: input.phone, coupons: validResults, submissionId, requestedDate: input.requestedDate }),
        }).catch(console.error);

        // Alerta interna
        const [cfg] = await db.select().from(couponEmailConfig).limit(1);
        if (!cfg || cfg.autoSendInternalAlert) {
          const alertEmail = cfg?.internalAlertEmail ?? getCopyEmail();
          sendEmail({ to: alertEmail, subject: `[Ticketing] Nuevo envío: ${validResults.length} cupón${validResults.length > 1 ? "es" : ""} — ${input.customerName}`, html: buildInternalAlertHtml({ customerName: input.customerName, email: input.email, phone: input.phone, coupons: validResults, submissionId, requestedDate: input.requestedDate }) }).catch(console.error);
        }
      }

      return { success: true, submissionId, results, totalAccepted: validResults.length, totalRejected: results.length - validResults.length };
    }),

  /** Admin: alta manual de cupón */
  createManualRedemption: adminProc
    .input(z.object({
      provider: z.string().default("Groupon"),
      productTicketingId: z.number().optional(),
      customerName: z.string().min(1),
      email: z.string().email(),
      phone: z.string().optional(),
      couponCode: z.string().min(1),
      securityCode: z.string().optional(),
      attachmentUrl: z.string().optional(),
      requestedDate: z.string().optional(),
      station: z.string().optional(),
      participants: z.number().int().min(1).default(1),
      children: z.number().int().min(0).default(0),
      comments: z.string().optional(),
      channelEntry: z.enum(["web", "email", "whatsapp", "telefono", "presencial", "manual"]).default("manual"),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const dupCheck = await checkDuplicates(input.couponCode, input.securityCode, input.email, input.phone, input.requestedDate, input.productTicketingId);
      if (dupCheck.hardDuplicate) throw new TRPCError({ code: "CONFLICT", message: "Código de cupón duplicado." });
      let productName = "Experiencia Náyade";
      if (input.productTicketingId) {
        const [prod] = await db.select({ name: ticketingProducts.name }).from(ticketingProducts).where(eq(ticketingProducts.id, input.productTicketingId)).limit(1);
        if (prod) productName = prod.name;
      }
      const submissionId = crypto.randomUUID();
      const [result] = await db.insert(couponRedemptions).values({
        provider: input.provider,
        productTicketingId: input.productTicketingId ?? null,
        customerName: input.customerName,
        email: input.email,
        phone: input.phone ?? null,
        couponCode: input.couponCode,
        securityCode: input.securityCode ?? null,
        attachmentUrl: input.attachmentUrl ?? null,
        requestedDate: input.requestedDate ?? null,
        station: input.station ?? null,
        participants: input.participants,
        children: input.children,
        comments: input.comments ?? null,
        notes: input.notes ?? null,
        statusOperational: "recibido",
        statusFinancial: "pendiente_canjear",
        duplicateFlag: dupCheck.softDuplicate,
        duplicateNotes: dupCheck.notes || null,
        submissionId,
        originSource: "admin_manual_entry",
        channelEntry: input.channelEntry,
        createdByAdminId: ctx.user.id,
      });
      const redemptionId = (result as { insertId: number }).insertId;
      // Upsert cliente en CRM — SELECT + INSERT/UPDATE
      try {
        const [existingAdminClient] = await db.select({ id: clients.id, name: clients.name, phone: clients.phone }).from(clients).where(eq(clients.email, input.email)).limit(1);
        if (existingAdminClient) {
          await db.update(clients).set({
            name: existingAdminClient.name?.trim() ? existingAdminClient.name : input.customerName,
            phone: existingAdminClient.phone?.trim() ? existingAdminClient.phone : (input.phone ?? ""),
            updatedAt: new Date(),
          }).where(eq(clients.id, existingAdminClient.id));
        } else {
          await db.insert(clients).values({ source: "cupon", name: input.customerName, email: input.email, phone: input.phone ?? "", company: "", tags: [], isConverted: false, totalBookings: 0 });
        }
      } catch { /* silent */ }
      if (input.attachmentUrl) {
        const attachUrl = input.attachmentUrl;
        const pName = productName;
        setImmediate(async () => {
          try {
            const ocr = await runOcrExtraction(attachUrl, { couponCode: input.couponCode, securityCode: input.securityCode, productName: pName, customerName: input.customerName });
            await db.update(couponRedemptions).set({ ocrConfidenceScore: ocr.score, ocrStatus: ocr.status, ocrRawData: ocr.rawData }).where(eq(couponRedemptions.id, redemptionId));
          } catch { /* silent */ }
        });
      }
      return { success: true, redemptionId, submissionId, softDuplicate: dupCheck.softDuplicate };
    }),

  // ── PIPELINE — LISTADO Y FILTROS ─────────────────────────────────────────
  /** Admin: listar cupones con filtros de pipeline */
  listCoupons: adminProc
    .input(z.object({
      page: z.number().int().min(1).default(1),
      pageSize: z.number().int().min(1).max(100).default(25),
      provider: z.string().optional(),
      statusOperational: z.enum(["recibido", "pendiente", "reserva_generada"]).optional(),
      statusFinancial: z.enum(["pendiente_canjear", "canjeado", "incidencia"]).optional(),
      duplicateFlag: z.boolean().optional(),
      search: z.string().optional(),
      dateFrom: z.string().optional(),
      dateTo: z.string().optional(),
    }))
    .query(async ({ input }) => {
      const conditions = [];
      if (input.provider) conditions.push(eq(couponRedemptions.provider, input.provider));
      if (input.statusOperational) conditions.push(eq(couponRedemptions.statusOperational, input.statusOperational));
      if (input.statusFinancial) conditions.push(eq(couponRedemptions.statusFinancial, input.statusFinancial));
      if (input.duplicateFlag !== undefined) conditions.push(eq(couponRedemptions.duplicateFlag, input.duplicateFlag));
      if (input.search) {
        conditions.push(or(
          like(couponRedemptions.customerName, `%${input.search}%`),
          like(couponRedemptions.email, `%${input.search}%`),
          like(couponRedemptions.couponCode, `%${input.search}%`),
          like(couponRedemptions.phone, `%${input.search}%`),
          like(couponRedemptions.provider, `%${input.search}%`),
          like(couponRedemptions.station, `%${input.search}%`),
          like(couponRedemptions.notes, `%${input.search}%`),
        ));
      }
      const where = conditions.length > 0 ? (conditions.length === 1 ? conditions[0] : and(...conditions)) : undefined;
      const offset = (input.page - 1) * input.pageSize;
      const [items, [{ total }]] = await Promise.all([
        db.select().from(couponRedemptions).where(where).orderBy(desc(couponRedemptions.createdAt)).limit(input.pageSize).offset(offset),
        db.select({ total: count() }).from(couponRedemptions).where(where),
      ]);
      return { items, total, page: input.page, pageSize: input.pageSize, totalPages: Math.ceil(total / input.pageSize) };
    }),

  /** Admin: obtener detalle de un cupón */
  getRedemption: adminProc
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const [item] = await db.select().from(couponRedemptions).where(eq(couponRedemptions.id, input.id)).limit(1);
      if (!item) throw new TRPCError({ code: "NOT_FOUND" });
      let ticketingProduct = null;
      if (item.productTicketingId) {
        const [tp] = await db.select().from(ticketingProducts).where(eq(ticketingProducts.id, item.productTicketingId)).limit(1);
        ticketingProduct = tp ?? null;
      }
      let realProduct = null;
      if (item.productRealId) {
        const [rp] = await db.select({ id: experiences.id, title: experiences.title }).from(experiences).where(eq(experiences.id, item.productRealId)).limit(1);
        realProduct = rp ?? null;
      }
      return { ...item, ticketingProduct, realProduct };
    }),

  // ── PIPELINE — ACCIONES ───────────────────────────────────────────────────
  /** Admin: actualizar estado de un cupón */
  updateCouponStatus: adminProc
    .input(z.object({
      id: z.number(),
      statusOperational: z.enum(["recibido", "pendiente", "reserva_generada"]).optional(),
      statusFinancial: z.enum(["pendiente_canjear", "canjeado", "incidencia"]).optional(),
      notes: z.string().nullable().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const { id, ...data } = input;
      await db.update(couponRedemptions).set({ ...data as Record<string, unknown>, adminUserId: ctx.user.id }).where(eq(couponRedemptions.id, id));
      return { success: true };
    }),

  /** Admin: posponer cupón — estado Pendiente + email automático */
  postponeCoupon: adminProc
    .input(z.object({
      id: z.number(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const [item] = await db.select().from(couponRedemptions).where(eq(couponRedemptions.id, input.id)).limit(1);
      if (!item) throw new TRPCError({ code: "NOT_FOUND" });

      let productName = "Experiencia Náyade";
      if (item.productTicketingId) {
        const [tp] = await db.select({ name: ticketingProducts.name }).from(ticketingProducts).where(eq(ticketingProducts.id, item.productTicketingId)).limit(1);
        if (tp) productName = tp.name;
      }

      await db.update(couponRedemptions)
        .set({ statusOperational: "pendiente", notes: input.notes ?? item.notes, adminUserId: ctx.user.id })
        .where(eq(couponRedemptions.id, input.id));

      // Email automático al cliente
      sendEmail({
        to: item.email,
        subject: `Información sobre tu solicitud de canje — ${item.provider}`,
        html: buildPostponeEmailHtml({
          customerName: item.customerName,
          couponCode: item.couponCode,
          provider: item.provider,
          productName,
          requestedDate: item.requestedDate ?? undefined,
        }),
      }).catch(console.error);

      return { success: true };
    }),

  /** Admin: marcar incidencia */
  markIncidence: adminProc
    .input(z.object({
      id: z.number(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      await db.update(couponRedemptions)
        .set({ statusFinancial: "incidencia", notes: input.notes ?? null, adminUserId: ctx.user.id })
        .where(eq(couponRedemptions.id, input.id));
      return { success: true };
    }),

  /** Admin: convertir cupón en reserva real */
  convertToReservation: adminProc
    .input(z.object({
      id: z.number(),
      platformProductId: z.number().optional(), // ID del producto de plataforma (nuevo flujo)
      productRealId: z.number().optional(),      // ID de experiencia interna (fallback)
      reservationDate: z.string(),
      participants: z.number().int().min(1),
      providerTag: z.string().optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const [item] = await db.select().from(couponRedemptions).where(eq(couponRedemptions.id, input.id)).limit(1);
      if (!item) throw new TRPCError({ code: "NOT_FOUND" });
      if (item.statusOperational === "reserva_generada") {
        throw new TRPCError({ code: "CONFLICT", message: "Esta solicitud ya tiene una reserva generada" });
      }
      if (item.statusFinancial !== "canjeado") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "El cupón debe estar marcado como canjeado por la plataforma antes de poder convertirlo en reserva" });
      }

      // Resolver producto: primero por platformProductId, luego por productRealId
      let resolvedExperienceId: number | null = null;
      let resolvedProductName = "Experiencia Náyade";
      let resolvedPvpPrice = "0";
      let resolvedNetPrice = "0";

      if (input.platformProductId) {
        const [pp] = await db
          .select({ experienceId: platformProducts.experienceId, externalProductName: platformProducts.externalProductName, pvpPrice: platformProducts.pvpPrice, netPrice: platformProducts.netPrice, expTitle: experiences.title })
          .from(platformProducts)
          .leftJoin(experiences, eq(platformProducts.experienceId, experiences.id))
          .where(eq(platformProducts.id, input.platformProductId))
          .limit(1);
        if (pp) {
          resolvedExperienceId = pp.experienceId ?? null;
          resolvedProductName = pp.externalProductName ?? pp.expTitle ?? "Experiencia Náyade";
          resolvedPvpPrice = pp.pvpPrice ?? "0";
          resolvedNetPrice = pp.netPrice ?? "0";
        }
      } else if (input.productRealId) {
        const [expRow] = await db.select({ title: experiences.title, basePrice: experiences.basePrice }).from(experiences).where(eq(experiences.id, input.productRealId)).limit(1);
        resolvedExperienceId = input.productRealId;
        resolvedProductName = expRow?.title ?? "Experiencia Náyade";
        resolvedPvpPrice = expRow?.basePrice ?? "0";
      }

      // Obtener o crear cliente
      let clientId: number | null = null;
      const [existingClient] = await db.select({ id: clients.id }).from(clients).where(sql`${clients.email} = ${item.email}`).limit(1);
      clientId = existingClient?.id ?? null;
      if (!clientId) {
        const [newClient] = await db.insert(clients).values({ name: item.customerName, email: item.email, phone: item.phone ?? null, source: "ticketing" });
        clientId = (newClient as { insertId: number }).insertId;
      }

      // Crear reserva en CRM
      const merchantOrder = `TKT-${Date.now()}`;
      const now = Date.now();
      const providerTag = input.providerTag ?? item.provider;
      const couponNotes = `Canje cupón ${providerTag} — Código: ${item.couponCode} — Producto: ${resolvedProductName}${input.notes ? ` — ${input.notes}` : ""}`;
      const reservationNumber = await generateReservationNumber();
      const [resResult] = await db.insert(reservations).values({
        productId: resolvedExperienceId ?? 0,
        productName: resolvedProductName,
        bookingDate: input.reservationDate,
        people: input.participants,
        amountTotal: Math.round(parseFloat(resolvedPvpPrice) * input.participants * 100),
        amountPaid: Math.round(parseFloat(resolvedNetPrice) * input.participants * 100),
        status: "paid",
        channel: "PARTNER",
        statusReservation: "CONFIRMADA",
        statusPayment: "PAGADO",
        originSource: "coupon_redemption",
        platformName: providerTag ?? null,
        redemptionId: item.id,
        merchantOrder,
        reservationNumber,
        notes: couponNotes,
        customerName: item.customerName,
        customerEmail: item.email,
        customerPhone: item.phone ?? null,
        createdAt: now,
        updatedAt: now,
        paidAt: now,
      });
      const reservationId = (resResult as { insertId: number }).insertId;

      // Actualizar cupón con todos los datos de trazabilidad
      // statusFinancial se mantiene "canjeado" (ya verificado arriba)
      await db.update(couponRedemptions)
        .set({
          statusOperational: "reserva_generada",
          productRealId: resolvedExperienceId ?? (input.productRealId ?? null),
          reservationId,
          platformProductId: input.platformProductId ?? null,
          adminUserId: ctx.user.id,
        })
        .where(eq(couponRedemptions.id, input.id));

      // Enviar email de confirmación al cliente con los datos de la reserva
      const bookingDateFormatted = input.reservationDate
        ? new Date(input.reservationDate).toLocaleDateString("es-ES", { weekday: "long", year: "numeric", month: "long", day: "numeric" })
        : "Por confirmar";
      const totalAmount = (parseFloat(resolvedPvpPrice) * input.participants).toFixed(2).replace(".", ",");
      const confirmHtml = buildReservationConfirmHtml({
        merchantOrder,
        productName: resolvedProductName,
        customerName: item.customerName,
        date: bookingDateFormatted,
        people: input.participants,
        amount: `${totalAmount} €`,
        extras: `Cupón ${item.provider ?? ""} — Código: ${item.couponCode}`,
      });
      sendEmail({
        to: item.email,
        subject: `✅ Reserva confirmada — ${resolvedProductName} | Náyade Experiences`,
        html: confirmHtml,
      }).catch(console.error);

      // BUG FIX (cupón convertToReservation): Crear booking operativo + transacción contable
      try {
        const pvpTotal = parseFloat(resolvedPvpPrice) * input.participants;
        const netTotal = parseFloat(resolvedNetPrice) * input.participants;
        await postConfirmOperation({
          reservationId,
          productId: resolvedExperienceId ?? 0,
          productName: resolvedProductName,
          serviceDate: input.reservationDate ?? new Date().toISOString().split("T")[0],
          people: input.participants,
          amountCents: Math.round(netTotal * 100),
          customerName: item.customerName,
          customerEmail: item.email,
          customerPhone: item.phone ?? null,
          totalAmount: pvpTotal,
          paymentMethod: "otro",
          saleChannel: "delegado",
          reservationRef: merchantOrder,
          description: `Cupón ${item.provider ?? "externo"} — ${item.couponCode} — ${resolvedProductName}`,
          sourceChannel: "otro",
        });
      } catch (e) {
        console.error("[Ticketing convertToReservation] Error en postConfirmOperation:", e);
      }

      // Registrar en el log de actividad del dashboard
      await logActivity(
        "reservation",
        reservationId,
        "coupon_converted_to_reservation",
        ctx.user.id,
        ctx.user.name,
        {
          couponCode: item.couponCode,
          provider: item.provider,
          productName: resolvedProductName,
          customerName: item.customerName,
          participants: input.participants,
          merchantOrder,
        }
      ).catch(() => {});

      return { success: true, reservationId, productName: resolvedProductName, pvpPrice: resolvedPvpPrice, netPrice: resolvedNetPrice };
    }),

  /** Admin: re-ejecutar OCR manualmente */
  rerunOcr: adminProc
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const [item] = await db.select().from(couponRedemptions).where(eq(couponRedemptions.id, input.id)).limit(1);
      if (!item) throw new TRPCError({ code: "NOT_FOUND" });
      if (!item.attachmentUrl) throw new TRPCError({ code: "BAD_REQUEST", message: "No hay adjunto para analizar" });
      let productName = "Experiencia Náyade";
      if (item.productTicketingId) {
        const [tp] = await db.select({ name: ticketingProducts.name }).from(ticketingProducts).where(eq(ticketingProducts.id, item.productTicketingId)).limit(1);
        if (tp) productName = tp.name;
      }
      const ocr = await runOcrExtraction(item.attachmentUrl, { couponCode: item.couponCode, securityCode: item.securityCode ?? undefined, productName, customerName: item.customerName });
      await db.update(couponRedemptions).set({ ocrConfidenceScore: ocr.score, ocrStatus: ocr.status, ocrRawData: ocr.rawData }).where(eq(couponRedemptions.id, input.id));
      return { score: ocr.score, status: ocr.status, rawData: ocr.rawData };
    }),

  // ── DASHBOARD MÉTRICAS ────────────────────────────────────────────────────
  getDashboardStats: adminProc.query(async () => {
    const [total] = await db.select({ count: count() }).from(couponRedemptions);

    const byOperational = await db
      .select({ status: couponRedemptions.statusOperational, count: count() })
      .from(couponRedemptions)
      .groupBy(couponRedemptions.statusOperational);

    const byFinancial = await db
      .select({ status: couponRedemptions.statusFinancial, count: count() })
      .from(couponRedemptions)
      .groupBy(couponRedemptions.statusFinancial);

    const recibidos = byOperational.find((s) => s.status === "recibido")?.count ?? 0;
    const pendientes = byOperational.find((s) => s.status === "pendiente")?.count ?? 0;
    const convertidos = byOperational.find((s) => s.status === "reserva_generada")?.count ?? 0;
    const incidencias = byFinancial.find((s) => s.status === "incidencia")?.count ?? 0;
    const canjeados = byFinancial.find((s) => s.status === "canjeado")?.count ?? 0;
    const totalCount = total.count;
    const conversionRate = totalCount > 0 ? Math.round((convertidos / totalCount) * 100) : 0;

    return {
      total: totalCount,
      recibidos,
      pendientes,
      convertidos,
      incidencias,
      canjeados,
      conversionRate,
      byOperational,
      byFinancial,
    };
  }),

  // ── EMAIL CONFIG ─────────────────────────────────────────────────────────
  getEmailConfig: adminProc.query(async () => {
    const [cfg] = await db.select().from(couponEmailConfig).limit(1);
    return cfg ?? { id: 0, autoSendCouponReceived: true, autoSendCouponValidated: true, autoSendInternalAlert: true, emailMode: "per_submission" as const, internalAlertEmail: getCopyEmail(), updatedAt: new Date() };
  }),

  updateEmailConfig: adminProc
    .input(z.object({
      autoSendCouponReceived: z.boolean().optional(),
      autoSendCouponValidated: z.boolean().optional(),
      autoSendInternalAlert: z.boolean().optional(),
      emailMode: z.enum(["per_submission", "per_coupon"]).optional(),
      internalAlertEmail: z.string().email().optional(),
    }))
    .mutation(async ({ input }) => {
      const [existing] = await db.select({ id: couponEmailConfig.id }).from(couponEmailConfig).limit(1);
      if (existing) {
        await db.update(couponEmailConfig).set(input).where(eq(couponEmailConfig.id, existing.id));
      } else {
        await db.insert(couponEmailConfig).values({ autoSendCouponReceived: true, autoSendCouponValidated: true, autoSendInternalAlert: true, emailMode: "per_submission", internalAlertEmail: getCopyEmail(), ...input });
      }
      return { success: true };
    }),

  // ── CONCILIACIÓN FINANCIERA ───────────────────────────────────────────────
  updateFinancial: adminProc
    .input(z.object({
      id: z.number(),
      statusFinancial: z.enum(["pendiente_canjear", "canjeado", "incidencia"]).optional(),
      realAmount: z.string().optional().nullable(),
      settlementJustificantUrl: z.string().url().optional().nullable(),
      settledAt: z.string().optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const { id, settledAt, ...rest } = input;
      const updateData: Record<string, unknown> = { ...rest };
      if (settledAt) updateData.settledAt = new Date(settledAt);
      await db.update(couponRedemptions).set(updateData).where(eq(couponRedemptions.id, id));
      return { success: true };
    }),

  /** Admin: subir adjunto de cupón */
  uploadAttachment: adminProc
    .input(z.object({
      id: z.number(),
      fileBase64: z.string(),
      fileName: z.string(),
      mimeType: z.string(),
    }))
    .mutation(async ({ input }) => {
      const buffer = Buffer.from(input.fileBase64, "base64");
      const key = `ticketing/attachments/${input.id}-${Date.now()}-${input.fileName}`;
      const { url } = await storagePut(key, buffer, input.mimeType);
      await db.update(couponRedemptions).set({ attachmentUrl: url }).where(eq(couponRedemptions.id, input.id));
      return { url };
    }),

  /** Admin: marcar cupón como canjeado + convertir en reserva si no la tiene ya */
  markAsRedeemed: adminProc
    .input(z.object({
      id: z.number(),
      notes: z.string().optional(),
      justificantBase64: z.string().optional(),
      justificantFileName: z.string().optional(),
      justificantMimeType: z.string().optional(),
      platformProductId: z.number().optional(),
      reservationDate: z.string().optional(),
      participants: z.number().int().min(1).default(1),
    }))
    .mutation(async ({ input, ctx }) => {
      const [item] = await db.select().from(couponRedemptions).where(eq(couponRedemptions.id, input.id)).limit(1);
      if (!item) throw new TRPCError({ code: "NOT_FOUND" });

      // ── 1. Subir comprobante si se adjuntó ────────────────────────────────
      let justificantUrl: string | null = null;
      if (input.justificantBase64 && input.justificantFileName && input.justificantMimeType) {
        const buffer = Buffer.from(input.justificantBase64, "base64");
        try {
          const key = `ticketing/justificantes/${input.id}-${Date.now()}-${input.justificantFileName}`;
          const { url } = await storagePut(key, buffer, input.justificantMimeType);
          justificantUrl = url;
        } catch {
          justificantUrl = `data:${input.justificantMimeType};base64,${input.justificantBase64}`;
        }
      }

      // ── 2. Crear reserva en CRM si no existe ya ───────────────────────────
      let reservationId = item.reservationId ?? null;
      if (!reservationId && input.reservationDate) {
        let resolvedExperienceId: number | null = null;
        let resolvedProductName = "Experiencia Náyade";
        let resolvedPvpPrice = "0";
        let resolvedNetPrice = "0";

        if (input.platformProductId) {
          const [pp] = await db
            .select({ experienceId: platformProducts.experienceId, externalProductName: platformProducts.externalProductName, pvpPrice: platformProducts.pvpPrice, netPrice: platformProducts.netPrice, expTitle: experiences.title })
            .from(platformProducts)
            .leftJoin(experiences, eq(platformProducts.experienceId, experiences.id))
            .where(eq(platformProducts.id, input.platformProductId))
            .limit(1);
          if (pp) {
            resolvedExperienceId = pp.experienceId ?? null;
            resolvedProductName = pp.externalProductName ?? pp.expTitle ?? "Experiencia Náyade";
            resolvedPvpPrice = pp.pvpPrice ?? "0";
            resolvedNetPrice = pp.netPrice ?? "0";
          }
        }

        const [existingClient] = await db.select({ id: clients.id }).from(clients).where(sql`${clients.email} = ${item.email}`).limit(1);
        let clientId = existingClient?.id ?? null;
        if (!clientId) {
          const [newClient] = await db.insert(clients).values({ name: item.customerName, email: item.email, phone: item.phone ?? null, source: "ticketing" });
          clientId = (newClient as { insertId: number }).insertId;
        }

        const merchantOrder = `TKT-${Date.now()}`;
        const now = Date.now();
        const couponNotes = `Canje cupón ${item.provider} — Código: ${item.couponCode} — Producto: ${resolvedProductName}${input.notes ? ` — ${input.notes}` : ""}`;
        const reservationNumber = await generateReservationNumber();
        const [resResult] = await db.insert(reservations).values({
          productId: resolvedExperienceId ?? 0,
          productName: resolvedProductName,
          bookingDate: input.reservationDate,
          people: input.participants,
          amountTotal: Math.round(parseFloat(resolvedPvpPrice) * input.participants * 100),
          amountPaid: Math.round(parseFloat(resolvedNetPrice) * input.participants * 100),
          status: "paid",
          channel: "PARTNER",
          statusReservation: "CONFIRMADA",
          statusPayment: "PAGADO",
          originSource: "coupon_redemption",
          platformName: item.provider ?? null,
          redemptionId: item.id,
          merchantOrder,
          reservationNumber,
          notes: couponNotes,
          customerName: item.customerName,
          customerEmail: item.email,
          customerPhone: item.phone ?? null,
          createdAt: now,
          updatedAt: now,
          paidAt: now,
        });
        reservationId = (resResult as { insertId: number }).insertId;

        try {
          const pvpTotal = parseFloat(resolvedPvpPrice) * input.participants;
          const netTotal = parseFloat(resolvedNetPrice) * input.participants;
          await postConfirmOperation({
            reservationId,
            experienceId: resolvedExperienceId ?? 0,
            date: input.reservationDate,
            people: input.participants,
            pvpTotal,
            netTotal,
            customerName: item.customerName,
            customerEmail: item.email,
            sourceChannel: "otro",
          });
        } catch (e) {
          console.error("[markAsRedeemed] Error en postConfirmOperation:", e);
        }

        await logActivity("reservation", reservationId, "coupon_converted_to_reservation", ctx.user.id, ctx.user.name, {
          provider: item.provider, couponCode: item.couponCode, productName: resolvedProductName, customerName: item.customerName,
        });
      }

      // ── 3. Marcar canjeado + reserva_generada si aplica ───────────────────
      const updateData: Record<string, unknown> = {
        statusFinancial: "canjeado",
        statusOperational: reservationId ? "reserva_generada" : item.statusOperational,
        settledAt: new Date(),
        adminUserId: ctx.user.id,
      };
      if (reservationId && !item.reservationId) updateData.reservationId = reservationId;
      if (input.platformProductId && !item.platformProductId) updateData.platformProductId = input.platformProductId;
      if (justificantUrl) updateData.settlementJustificantUrl = justificantUrl;
      if (input.notes) updateData.notes = input.notes;

      await db.update(couponRedemptions).set(updateData).where(eq(couponRedemptions.id, input.id));
      return { success: true, justificantUrl, reservationId };
    }),

  /** Admin: eliminar un cupón por ID (borrado físico) */
  deleteRedemption: adminProc
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const [item] = await db.select({ id: couponRedemptions.id, couponCode: couponRedemptions.couponCode })
        .from(couponRedemptions).where(eq(couponRedemptions.id, input.id)).limit(1);
      if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "Cupón no encontrado" });
      await db.delete(couponRedemptions).where(eq(couponRedemptions.id, input.id));
      return { success: true, deletedId: input.id, couponCode: item.couponCode };
    }),

  // ── PLATAFORMAS ───────────────────────────────────────────────────────────
  listPlatforms: adminProc.query(async () => {
    return db.select().from(platforms).orderBy(platforms.name);
  }),

  getPlatform: adminProc
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const [p] = await db.select().from(platforms).where(eq(platforms.id, input.id)).limit(1);
      if (!p) throw new TRPCError({ code: "NOT_FOUND" });
      return p;
    }),

  createPlatform: adminProc
    .input(z.object({
      name: z.string().min(1),
      slug: z.string().min(1),
      logoUrl: z.string().url().optional(),
      active: z.boolean().default(true),
      settlementFrequency: z.enum(["quincenal", "mensual", "trimestral"]).default("mensual"),
      commissionPct: z.string().optional(),
      externalUrl: z.string().url().optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const [result] = await db.insert(platforms).values({
        name: input.name,
        slug: input.slug,
        logoUrl: input.logoUrl ?? null,
        active: input.active,
        settlementFrequency: input.settlementFrequency,
        commissionPct: input.commissionPct ?? "20.00",
        externalUrl: input.externalUrl ?? null,
        notes: input.notes ?? null,
      });
      return { id: (result as { insertId: number }).insertId };
    }),

  updatePlatform: adminProc
    .input(z.object({
      id: z.number(),
      name: z.string().min(1).optional(),
      slug: z.string().min(1).optional(),
      logoUrl: z.string().url().nullable().optional(),
      active: z.boolean().optional(),
      settlementFrequency: z.enum(["quincenal", "mensual", "trimestral"]).optional(),
      commissionPct: z.string().optional(),
      externalUrl: z.string().url().nullable().optional(),
      notes: z.string().nullable().optional(),
    }))
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      await db.update(platforms).set(data as Record<string, unknown>).where(eq(platforms.id, id));
      return { success: true };
    }),

  togglePlatform: adminProc
    .input(z.object({ id: z.number(), active: z.boolean() }))
    .mutation(async ({ input }) => {
      await db.update(platforms).set({ active: input.active }).where(eq(platforms.id, input.id));
      return { success: true };
    }),

  deletePlatform: adminProc
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await db.delete(platformProducts).where(eq(platformProducts.platformId, input.id));
      await db.delete(platforms).where(eq(platforms.id, input.id));
      return { success: true };
    }),

  // ── PRODUCTOS DE PLATAFORMA ───────────────────────────────────────────────
  listPlatformProducts: adminProc
    .input(z.object({ platformId: z.number() }))
    .query(async ({ input }) => {
      const rows = await db
        .select({
          id: platformProducts.id,
          platformId: platformProducts.platformId,
          experienceId: platformProducts.experienceId,
          externalLink: platformProducts.externalLink,
          externalProductName: platformProducts.externalProductName,
          pvpPrice: platformProducts.pvpPrice,
          netPrice: platformProducts.netPrice,
          expiresAt: platformProducts.expiresAt,
          active: platformProducts.active,
          createdAt: platformProducts.createdAt,
          updatedAt: platformProducts.updatedAt,
          experienceTitle: experiences.title,
          experienceBasePrice: experiences.basePrice,
        })
        .from(platformProducts)
        .leftJoin(experiences, eq(platformProducts.experienceId, experiences.id))
        .where(eq(platformProducts.platformId, input.platformId))
        .orderBy(platformProducts.createdAt);
      return rows;
    }),

  /** Lista productos activos de una plataforma para el selector del modal Convertir */
  listActivePlatformProducts: adminProc
    .input(z.object({ platformId: z.number() }))
    .query(async ({ input }) => {
      const rows = await db
        .select({
          id: platformProducts.id,
          externalProductName: platformProducts.externalProductName,
          pvpPrice: platformProducts.pvpPrice,
          netPrice: platformProducts.netPrice,
          expiresAt: platformProducts.expiresAt,
          externalLink: platformProducts.externalLink,
          experienceId: platformProducts.experienceId,
          experienceTitle: experiences.title,
        })
        .from(platformProducts)
        .leftJoin(experiences, eq(platformProducts.experienceId, experiences.id))
        .where(and(eq(platformProducts.platformId, input.platformId), eq(platformProducts.active, true)))
        .orderBy(platformProducts.externalProductName);
      return rows;
    }),

  createPlatformProduct: adminProc
    .input(z.object({
      platformId: z.number(),
      experienceId: z.number().optional(),
      externalLink: z.string().optional(),
      externalProductName: z.string().optional(),
      pvpPrice: z.string().optional(),
      netPrice: z.string().optional(),
      expiresAt: z.string().optional(), // ISO date string
      active: z.boolean().default(true),
    }))
    .mutation(async ({ input }) => {
      const [result] = await db.insert(platformProducts).values({
        platformId: input.platformId,
        experienceId: input.experienceId ?? null,
        externalLink: input.externalLink ?? null,
        externalProductName: input.externalProductName ?? null,
        pvpPrice: input.pvpPrice ?? null,
        netPrice: input.netPrice ?? null,
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
        active: input.active,
      });
      return { id: (result as { insertId: number }).insertId };
    }),

  updatePlatformProduct: adminProc
    .input(z.object({
      id: z.number(),
      experienceId: z.number().nullable().optional(),
      externalLink: z.string().nullable().optional(),
      externalProductName: z.string().nullable().optional(),
      pvpPrice: z.string().nullable().optional(),
      netPrice: z.string().nullable().optional(),
      expiresAt: z.string().nullable().optional(),
      active: z.boolean().optional(),
    }))
    .mutation(async ({ input }) => {
      const { id, expiresAt, ...rest } = input;
      const updateData: Record<string, unknown> = { ...rest };
      if (expiresAt !== undefined) updateData.expiresAt = expiresAt ? new Date(expiresAt) : null;
      await db.update(platformProducts).set(updateData).where(eq(platformProducts.id, id));
      return { success: true };
    }),

  deletePlatformProduct: adminProc
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await db.delete(platformProducts).where(eq(platformProducts.id, input.id));
      return { success: true };
    }),

  /** Estadísticas de cupones por producto de plataforma */
  getProductStats: adminProc
    .input(z.object({ platformId: z.number() }))
    .query(async ({ input }) => {
      // 1. Obtener todos los productos de la plataforma con sus precios
      const prods = await db
        .select({
          id: platformProducts.id,
          pvpPrice: platformProducts.pvpPrice,
          netPrice: platformProducts.netPrice,
        })
        .from(platformProducts)
        .where(eq(platformProducts.platformId, input.platformId));

      if (prods.length === 0) return {};

      // 2. Obtener el nombre de la plataforma para el fallback por provider
      const [plat] = await db
        .select({ name: platforms.name })
        .from(platforms)
        .where(eq(platforms.id, input.platformId))
        .limit(1);
      const platformName = plat?.name ?? "";

      // 3. Obtener todos los cupones relacionados con esta plataforma:
      //    - Los que tienen platformProductId apuntando a un producto de esta plataforma (flujo nuevo)
      //    - Los que tienen provider coincidente con el nombre de la plataforma (flujo legacy)
      const prodIds = prods.map((p) => p.id);
      const allCoupons = await db
        .select({
          platformProductId: couponRedemptions.platformProductId,
          provider: couponRedemptions.provider,
          statusFinancial: couponRedemptions.statusFinancial,
          statusOperational: couponRedemptions.statusOperational,
          customerName: couponRedemptions.customerName,
        })
        .from(couponRedemptions)
        .where(
          or(
            inArray(couponRedemptions.platformProductId, prodIds),
            like(couponRedemptions.provider, `%${platformName}%`),
          )
        );

      // 4. Inicializar mapa con 0 para todos los productos
      const statsMap: Record<number, {
        total: number;
        canjeados: number;
        pendientes: number;
        incidencias: number;
        anulados: number;
        pvpTotal: number;
        netoTotal: number;
        customerNames: string[];
      }> = {};
      for (const p of prods) {
        statsMap[p.id] = { total: 0, canjeados: 0, pendientes: 0, incidencias: 0, anulados: 0, pvpTotal: 0, netoTotal: 0, customerNames: [] };
      }

      // 5. Agregar cada cupón al producto correcto
      for (const c of allCoupons) {
        // Primero intentar por platformProductId; si no, fallback al único producto (si solo hay uno)
        let targetId: number | null = (c.platformProductId != null && statsMap[c.platformProductId]) ? c.platformProductId : null;
        if (!targetId && prods.length === 1) targetId = prods[0].id;
        if (!targetId) continue;

        const st = statsMap[targetId];
        const prod = prods.find((p) => p.id === targetId);
        const pvp = parseFloat(prod?.pvpPrice ?? "0");
        const neto = parseFloat(prod?.netPrice ?? "0");

        st.total++;
        if (c.customerName && !st.customerNames.includes(c.customerName)) {
          st.customerNames.push(c.customerName);
        }
        if (c.statusFinancial === "canjeado") { st.canjeados++; st.netoTotal += neto; }
        else if (c.statusFinancial === "pendiente_canjear") st.pendientes++;
        else if (c.statusFinancial === "incidencia") st.incidencias++;
        if ((c.statusOperational as string) === "anulado") st.anulados++;
        if (c.statusFinancial !== "incidencia") st.pvpTotal += pvp;
      }

      return statsMap;
    }),

  // ── LIQUIDACIONES DE PLATAFORMA ───────────────────────────────────────────────
  listSettlements: adminProc
    .input(z.object({ platformId: z.number().optional() }))
    .query(async ({ input }) => {
      const where = input.platformId ? eq(platformSettlements.platformId, input.platformId) : undefined;
      const rows = await db
        .select({
          id: platformSettlements.id,
          platformId: platformSettlements.platformId,
          periodLabel: platformSettlements.periodLabel,
          periodFrom: platformSettlements.periodFrom,
          periodTo: platformSettlements.periodTo,
          totalCoupons: platformSettlements.totalCoupons,
          totalAmount: platformSettlements.totalAmount,
          netTotal: platformSettlements.netTotal,
          status: platformSettlements.status,
          justificantUrl: platformSettlements.justificantUrl,
          invoiceRef: platformSettlements.invoiceRef,
          couponIds: platformSettlements.couponIds,
          notes: platformSettlements.notes,
          emittedAt: platformSettlements.emittedAt,
          paidAt: platformSettlements.paidAt,
          createdAt: platformSettlements.createdAt,
          platformName: platforms.name,
          platformFrequency: platforms.settlementFrequency,
        })
        .from(platformSettlements)
        .leftJoin(platforms, eq(platformSettlements.platformId, platforms.id))
        .where(where)
        .orderBy(desc(platformSettlements.createdAt));
      return rows;
    }),

  /** Devuelve los cupones individuales incluidos en una liquidación */
  getSettlementCoupons: adminProc
    .input(z.object({ settlementId: z.number() }))
    .query(async ({ input }) => {
      const [settlement] = await db
        .select({ couponIds: platformSettlements.couponIds })
        .from(platformSettlements)
        .where(eq(platformSettlements.id, input.settlementId))
        .limit(1);
      if (!settlement?.couponIds?.length) return [];
      const rows = await db
        .select({
          id: couponRedemptions.id,
          couponCode: couponRedemptions.couponCode,
          customerName: couponRedemptions.customerName,
          provider: couponRedemptions.provider,
          settledAt: couponRedemptions.settledAt,
          netPrice: platformProducts.netPrice,
          pvpPrice: platformProducts.pvpPrice,
          productName: platformProducts.externalProductName,
        })
        .from(couponRedemptions)
        .leftJoin(platformProducts, eq(couponRedemptions.platformProductId, platformProducts.id))
        .where(inArray(couponRedemptions.id, settlement.couponIds));
      return rows;
    }),

  /** Genera una liquidación agrupando los cupones canjeados del periodo que aún no tienen liquidación */
  generateSettlement: adminProc
    .input(z.object({
      platformId: z.number(),
      periodLabel: z.string().min(1),
      periodFrom: z.string(),  // YYYY-MM-DD
      periodTo: z.string(),    // YYYY-MM-DD
      notes: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const [platformRow] = await db
        .select({ name: platforms.name })
        .from(platforms)
        .where(eq(platforms.id, input.platformId))
        .limit(1);
      if (!platformRow) throw new TRPCError({ code: "NOT_FOUND", message: "Plataforma no encontrada" });

      // Liberar cupones cuya liquidación fue borrada sin pasar por deleteSettlement
      await db.execute(sql`
        UPDATE coupon_redemptions
        SET settlementId = NULL
        WHERE settlementId IS NOT NULL
          AND settlementId NOT IN (SELECT id FROM platform_settlements)
      `);

      const couponsInPeriod = await db
        .select({
          id: couponRedemptions.id,
          netPrice: platformProducts.netPrice,
          pvpPrice: platformProducts.pvpPrice,
        })
        .from(couponRedemptions)
        .leftJoin(platformProducts, eq(couponRedemptions.platformProductId, platformProducts.id))
        .where(and(
          or(
            eq(platformProducts.platformId, input.platformId),
            eq(couponRedemptions.provider, platformRow.name),
          )!,
          eq(couponRedemptions.statusFinancial, "canjeado"),
          sql`${couponRedemptions.settlementId} IS NULL`,
          sql`DATE(${couponRedemptions.createdAt}) >= ${input.periodFrom}`,
          sql`DATE(${couponRedemptions.createdAt}) <= ${input.periodTo}`,
        ));

      const couponIds = couponsInPeriod.map((c) => c.id);
      const netTotal = couponsInPeriod.reduce((sum, c) => sum + parseFloat(c.netPrice ?? "0"), 0);
      const totalAmount = couponsInPeriod.reduce((sum, c) => sum + parseFloat(c.pvpPrice ?? "0"), 0);

      const [result] = await db.insert(platformSettlements).values({
        platformId: input.platformId,
        periodLabel: input.periodLabel,
        periodFrom: input.periodFrom,
        periodTo: input.periodTo,
        totalCoupons: couponIds.length,
        totalAmount: totalAmount.toFixed(2),
        netTotal: netTotal.toFixed(2),
        couponIds,
        status: "pendiente",
        notes: input.notes ?? null,
      });
      const settlementId = (result as { insertId: number }).insertId;

      // Vincular cupones a esta liquidación
      if (couponIds.length > 0) {
        await db.update(couponRedemptions)
          .set({ settlementId })
          .where(inArray(couponRedemptions.id, couponIds));
      }

      return { id: settlementId, totalCoupons: couponIds.length, netTotal, totalAmount };
    }),

  /** Lista los cupones incluidos en una liquidación */
  listSettlementCoupons: adminProc
    .input(z.object({ settlementId: z.number() }))
    .query(async ({ input }) => {
      const rows = await db
        .select({
          id: couponRedemptions.id,
          couponCode: couponRedemptions.couponCode,
          customerName: couponRedemptions.customerName,
          email: couponRedemptions.email,
          provider: couponRedemptions.provider,
          statusFinancial: couponRedemptions.statusFinancial,
          createdAt: couponRedemptions.createdAt,
          pvpPrice: platformProducts.pvpPrice,
          netPrice: platformProducts.netPrice,
          productName: platformProducts.externalProductName,
        })
        .from(couponRedemptions)
        .leftJoin(platformProducts, eq(couponRedemptions.platformProductId, platformProducts.id))
        .where(eq(couponRedemptions.settlementId, input.settlementId))
        .orderBy(couponRedemptions.createdAt);
      return rows;
    }),

  createSettlement: adminProc
    .input(z.object({
      platformId: z.number(),
      periodLabel: z.string().min(1),
      periodFrom: z.string().optional(),
      periodTo: z.string().optional(),
      totalCoupons: z.number().int().min(0).default(0),
      totalAmount: z.string().default("0.00"),
      netTotal: z.string().default("0.00"),
      invoiceRef: z.string().optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const [result] = await db.insert(platformSettlements).values({
        platformId: input.platformId,
        periodLabel: input.periodLabel,
        periodFrom: input.periodFrom ?? null,
        periodTo: input.periodTo ?? null,
        totalCoupons: input.totalCoupons,
        totalAmount: input.totalAmount,
        netTotal: input.netTotal,
        invoiceRef: input.invoiceRef ?? null,
        status: "pendiente",
        notes: input.notes ?? null,
      });
      return { id: (result as { insertId: number }).insertId };
    }),

  updateSettlement: adminProc
    .input(z.object({
      id: z.number(),
      status: z.enum(["pendiente", "emitida", "pagada"]).optional(),
      totalCoupons: z.number().int().min(0).optional(),
      totalAmount: z.string().optional(),
      netTotal: z.string().optional(),
      invoiceRef: z.string().nullable().optional(),
      justificantUrl: z.string().nullable().optional(),
      emittedAt: z.string().optional(),
      paidAt: z.string().optional(),
      notes: z.string().nullable().optional(),
    }))
    .mutation(async ({ input }) => {
      const { id, emittedAt, paidAt, status, ...rest } = input;
      const updateData: Record<string, unknown> = { ...rest };
      if (status) {
        updateData.status = status;
        if (status === "emitida" && !emittedAt) updateData.emittedAt = new Date();
        if (status === "pagada" && !paidAt) updateData.paidAt = new Date();
      }
      if (emittedAt) updateData.emittedAt = new Date(emittedAt);
      if (paidAt) updateData.paidAt = new Date(paidAt);
      await db.update(platformSettlements).set(updateData).where(eq(platformSettlements.id, id));
      return { success: true };
    }),

  deleteSettlement: adminProc
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      // Liberar los cupones vinculados antes de borrar la liquidación
      await db.update(couponRedemptions)
        .set({ settlementId: null })
        .where(eq(couponRedemptions.settlementId, input.id));
      await db.delete(platformSettlements).where(eq(platformSettlements.id, input.id));
      return { success: true };
    }),

  /** Admin: avanzar estado de liquidación en un paso (pendiente→emitida→pagada) */
  advanceSettlementStatus: adminProc
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const [settlement] = await db
        .select({ status: platformSettlements.status })
        .from(platformSettlements)
        .where(eq(platformSettlements.id, input.id))
        .limit(1);
      if (!settlement) throw new TRPCError({ code: "NOT_FOUND" });
      const transitions: Record<string, string> = { pendiente: "emitida", emitida: "pagada" };
      const nextStatus = transitions[settlement.status ?? "pendiente"];
      if (!nextStatus) throw new TRPCError({ code: "BAD_REQUEST", message: "La liquidación ya está en estado final (Pagada)" });
      const updateData: Record<string, unknown> = { status: nextStatus };
      if (nextStatus === "emitida") updateData.emittedAt = new Date();
      if (nextStatus === "pagada") updateData.paidAt = new Date();
      await db.update(platformSettlements).set(updateData).where(eq(platformSettlements.id, input.id));
      return { success: true, newStatus: nextStatus };
    }),

  // ── CANJE PÚBLICO ─────────────────────────────────────────────────────────
  /** Público: crear solicitud de canje individual (desde /canjear-cupon) */
  createRedemption: publicProcedure
    .input(z.object({
      provider: z.string().default("Groupon"),
      productTicketingId: z.number().optional(),
      customerName: z.string().min(1),
      email: z.string().email(),
      phone: z.string().optional(),
      couponCode: z.string().min(1),
      securityCode: z.string().optional(),
      attachmentUrl: z.string().url().optional(),
      requestedDate: z.string().optional(),
      station: z.string().optional(),
      participants: z.number().int().min(1).default(1),
      children: z.number().int().min(0).default(0),
      comments: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const dupCheck = await checkDuplicates(input.couponCode, input.securityCode, input.email, input.phone, input.requestedDate, input.productTicketingId);
      if (dupCheck.hardDuplicate) {
        throw new TRPCError({ code: "CONFLICT", message: "Este código de cupón ya ha sido registrado. Si crees que es un error, contacta con nosotros." });
      }
      let productName = "Experiencia Náyade";
      if (input.productTicketingId) {
        const [prod] = await db.select({ name: ticketingProducts.name }).from(ticketingProducts).where(eq(ticketingProducts.id, input.productTicketingId)).limit(1);
        if (prod) productName = prod.name;
      }
      const submissionId = crypto.randomUUID();
      const [result] = await db.insert(couponRedemptions).values({
        provider: input.provider,
        productTicketingId: input.productTicketingId ?? null,
        customerName: input.customerName,
        email: input.email,
        phone: input.phone ?? null,
        couponCode: input.couponCode,
        securityCode: input.securityCode ?? null,
        attachmentUrl: input.attachmentUrl ?? null,
        requestedDate: input.requestedDate ?? null,
        station: input.station ?? null,
        participants: input.participants,
        children: input.children,
        comments: input.comments ?? null,
        statusOperational: "recibido",
        statusFinancial: "pendiente_canjear",
        duplicateFlag: dupCheck.softDuplicate,
        duplicateNotes: dupCheck.notes || null,
        submissionId,
      });
      const redemptionId = (result as { insertId: number }).insertId;
      // Upsert cliente en CRM — SELECT + INSERT/UPDATE
      try {
        const [existingClient2] = await db.select({ id: clients.id, name: clients.name, phone: clients.phone }).from(clients).where(eq(clients.email, input.email)).limit(1);
        if (existingClient2) {
          await db.update(clients).set({
            name: existingClient2.name?.trim() ? existingClient2.name : input.customerName,
            phone: existingClient2.phone?.trim() ? existingClient2.phone : (input.phone ?? ""),
            updatedAt: new Date(),
          }).where(eq(clients.id, existingClient2.id));
        } else {
          await db.insert(clients).values({ source: "cupon", name: input.customerName, email: input.email, phone: input.phone ?? "", company: "", tags: [], isConverted: false, totalBookings: 0 });
        }
      } catch { /* silent */ }
      if (input.attachmentUrl) {
        setImmediate(async () => {
          try {
            const ocr = await runOcrExtraction(input.attachmentUrl!, { couponCode: input.couponCode, securityCode: input.securityCode, productName, customerName: input.customerName });
            await db.update(couponRedemptions).set({ ocrConfidenceScore: ocr.score, ocrStatus: ocr.status, ocrRawData: ocr.rawData }).where(eq(couponRedemptions.id, redemptionId));
          } catch { /* silent */ }
        });
      }
      try {
        await sendEmail({
          to: input.email,
          subject: `Hemos recibido tu solicitud de canje — ${input.provider}`,
          html: buildRedemptionConfirmationHtml({ customerName: input.customerName, email: input.email, phone: input.phone, coupons: [{ couponCode: input.couponCode, provider: input.provider }], submissionId, requestedDate: input.requestedDate }),
        });
      } catch { /* silent */ }
      return { success: true, redemptionId, softDuplicate: dupCheck.softDuplicate, message: "Solicitud registrada correctamente. Recibirás un email de confirmación." };
    }),
});

