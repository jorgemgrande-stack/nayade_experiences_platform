/**
 * Ticketing Router — Módulo de Canje de Cupones Groupon
 * Gestión completa: recepción → validación OCR → conversión a reserva → liquidación
 */
import { router, protectedProcedure, publicProcedure } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import {
  ticketingProducts,
  couponRedemptions,
  experiences,
  reservations,
  clients,
} from "../../drizzle/schema";
import { eq, desc, and, like, or, sql, count } from "drizzle-orm";
import { sendEmail as sharedSendEmail } from "../mailer";
import { storagePut } from "../storage";
import { invokeLLM } from "../_core/llm";

const _pool = mysql.createPool(process.env.DATABASE_URL!);
const db = drizzle(_pool);

const COPY_EMAIL = "reservas@nayadeexperiences.es";

async function sendEmail(opts: { to: string; subject: string; html: string }) {
  const sent = await sharedSendEmail(opts);
  if (!sent) console.warn("[Ticketing] SMTP not configured, skipping email");
  else await sharedSendEmail({ to: COPY_EMAIL, subject: `[COPIA] ${opts.subject}`, html: opts.html });
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function adminProcedure() {
  return protectedProcedure.use(({ ctx, next }) => {
    if (!["admin", "agente"].includes(ctx.user.role)) {
      throw new TRPCError({ code: "FORBIDDEN", message: "Acceso restringido a administradores y agentes" });
    }
    return next({ ctx });
  });
}

/**
 * Motor OCR asistido — extrae datos del cupón usando LLM con visión
 * Retorna un score de confianza (0-100) y los datos extraídos
 */
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
    const prompt = `Analiza esta imagen/PDF de un cupón de Groupon y extrae la siguiente información en JSON:
- coupon_code: código del cupón
- security_code: código de seguridad
- product_name: nombre del producto/experiencia
- customer_name: nombre del cliente
- expiry_date: fecha de caducidad (si aparece)
- provider: proveedor (Groupon, Wonderbox, etc.)

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

    const content = response.choices?.[0]?.message?.content;
    if (!content) throw new Error("No OCR response");

    const extracted = typeof content === "string" ? JSON.parse(content) : content;

    // Calcular score de confianza según pesos definidos en el spec
    let score = 0;

    // Código cupón (30%)
    const couponMatch = extracted.coupon_code &&
      formData.couponCode &&
      extracted.coupon_code.replace(/\s/g, "").toLowerCase() ===
      formData.couponCode.replace(/\s/g, "").toLowerCase();
    if (couponMatch) score += 30;
    else if (extracted.coupon_code && formData.couponCode &&
      extracted.coupon_code.replace(/\s/g, "").toLowerCase().includes(
        formData.couponCode.replace(/\s/g, "").toLowerCase().slice(0, 4)
      )) score += 15;

    // Código seguridad (30%)
    if (formData.securityCode) {
      const secMatch = extracted.security_code &&
        extracted.security_code.replace(/\s/g, "").toLowerCase() ===
        formData.securityCode.replace(/\s/g, "").toLowerCase();
      if (secMatch) score += 30;
      else if (extracted.security_code) score += 10;
    } else {
      score += 20; // No se proporcionó, no penalizar
    }

    // Producto (25%)
    if (formData.productName && extracted.product_name) {
      const prodWords = formData.productName.toLowerCase().split(/\s+/);
      const ocrWords = extracted.product_name.toLowerCase();
      const matchCount = prodWords.filter((w) => w.length > 3 && ocrWords.includes(w)).length;
      score += Math.min(25, Math.round((matchCount / Math.max(prodWords.length, 1)) * 25));
    } else {
      score += 12; // Parcial si no hay producto
    }

    // Fecha validez (10%) — si no ha caducado
    if (extracted.expiry_date) {
      try {
        const parts = extracted.expiry_date.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
        if (parts) {
          const [, d, m, y] = parts;
          const expiry = new Date(`${y.length === 2 ? "20" + y : y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`);
          if (expiry > new Date()) score += 10;
        } else {
          score += 5; // Fecha presente pero no parseable
        }
      } catch {
        score += 5;
      }
    } else {
      score += 5;
    }

    // Nombre cliente (5%)
    if (formData.customerName && extracted.customer_name) {
      const nameWords = formData.customerName.toLowerCase().split(/\s+/);
      const ocrName = extracted.customer_name.toLowerCase();
      const nameMatch = nameWords.some((w) => w.length > 2 && ocrName.includes(w));
      if (nameMatch) score += 5;
    } else {
      score += 3;
    }

    score = Math.min(100, Math.max(0, score));

    let status: "alta" | "media" | "baja" | "conflicto";
    if (score >= 90) status = "alta";
    else if (score >= 70) status = "media";
    else if (score >= 40) status = "baja";
    else status = "conflicto";

    return { score, status, rawData: extracted };
  } catch (err) {
    console.error("[Ticketing OCR] Error:", err);
    return { score: 0, status: "conflicto", rawData: { error: String(err) } };
  }
}

/**
 * Verificación de duplicados
 */
async function checkDuplicates(couponCode: string, securityCode: string | undefined, email: string, phone: string | undefined, requestedDate: string | undefined, productTicketingId: number | undefined): Promise<{
  hardDuplicate: boolean;
  softDuplicate: boolean;
  notes: string;
}> {
  // Duplicidad dura: mismo couponCode o mismo securityCode
  const hardConditions = [like(couponRedemptions.couponCode, couponCode)];
  if (securityCode) {
    hardConditions.push(like(couponRedemptions.securityCode, securityCode));
  }

  const hardDupes = await db
    .select({ id: couponRedemptions.id, couponCode: couponRedemptions.couponCode })
    .from(couponRedemptions)
    .where(or(...hardConditions))
    .limit(5);

  if (hardDupes.length > 0) {
    return {
      hardDuplicate: true,
      softDuplicate: false,
      notes: `Duplicado duro detectado: mismo código de cupón o seguridad ya existe (IDs: ${hardDupes.map((d) => d.id).join(", ")})`,
    };
  }

  // Duplicidad blanda: mismo email + fecha o mismo teléfono + producto
  const softNotes: string[] = [];

  if (email && requestedDate) {
    const emailDateDupes = await db
      .select({ id: couponRedemptions.id })
      .from(couponRedemptions)
      .where(and(
        eq(couponRedemptions.email, email),
        eq(couponRedemptions.requestedDate, requestedDate),
      ))
      .limit(3);
    if (emailDateDupes.length > 0) {
      softNotes.push(`Mismo email + fecha (IDs: ${emailDateDupes.map((d) => d.id).join(", ")})`);
    }
  }

  if (phone && productTicketingId) {
    const phoneProductDupes = await db
      .select({ id: couponRedemptions.id })
      .from(couponRedemptions)
      .where(and(
        eq(couponRedemptions.phone, phone),
        eq(couponRedemptions.productTicketingId, productTicketingId),
      ))
      .limit(3);
    if (phoneProductDupes.length > 0) {
      softNotes.push(`Mismo teléfono + producto (IDs: ${phoneProductDupes.map((d) => d.id).join(", ")})`);
    }
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
  couponCode: string;
  provider: string;
  productName: string;
  requestedDate?: string;
}): string {
  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"/></head>
<body style="font-family:Arial,sans-serif;background:#f8fafc;padding:20px;">
  <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
    <div style="background:#1a3a6b;padding:24px 32px;text-align:center;">
      <h1 style="color:#fff;margin:0;font-size:22px;">Náyade Experiences</h1>
      <p style="color:rgba(255,255,255,0.7);margin:4px 0 0;font-size:13px;">Solicitud de canje recibida</p>
    </div>
    <div style="padding:32px;">
      <h2 style="color:#1a3a6b;margin-top:0;">Hola, ${data.customerName}</h2>
      <p style="color:#374151;line-height:1.6;">Hemos recibido tu solicitud de canje del cupón <strong>${data.provider}</strong>. Nuestro equipo la revisará y se pondrá en contacto contigo en breve para confirmar tu reserva.</p>
      <div style="background:#f0f7ff;border-radius:8px;padding:16px 20px;margin:20px 0;">
        <p style="margin:0 0 8px;color:#1a3a6b;font-weight:700;font-size:13px;text-transform:uppercase;letter-spacing:1px;">Detalles de tu solicitud</p>
        <table style="width:100%;font-size:14px;color:#374151;">
          <tr><td style="padding:4px 0;color:#6b7280;">Proveedor:</td><td style="padding:4px 0;font-weight:600;">${data.provider}</td></tr>
          <tr><td style="padding:4px 0;color:#6b7280;">Experiencia:</td><td style="padding:4px 0;font-weight:600;">${data.productName}</td></tr>
          <tr><td style="padding:4px 0;color:#6b7280;">Código cupón:</td><td style="padding:4px 0;font-weight:600;font-family:monospace;">${data.couponCode}</td></tr>
          ${data.requestedDate ? `<tr><td style="padding:4px 0;color:#6b7280;">Fecha solicitada:</td><td style="padding:4px 0;font-weight:600;">${data.requestedDate}</td></tr>` : ""}
        </table>
      </div>
      <p style="color:#374151;line-height:1.6;">Si tienes alguna duda, puedes contactarnos en <a href="mailto:reservas@nayadeexperiences.es" style="color:#f97316;">reservas@nayadeexperiences.es</a> o llamarnos al <strong>+34 930 34 77 91</strong>.</p>
    </div>
    <div style="background:#f8fafc;padding:16px 32px;text-align:center;border-top:1px solid #e5e7eb;">
      <p style="color:#9ca3af;font-size:12px;margin:0;">Náyade Experiences · Los Ángeles de San Rafael, Segovia · www.nayadeexperiences.es</p>
    </div>
  </div>
</body>
</html>`;
}

// ─── ROUTER ──────────────────────────────────────────────────────────────────

const adminProc = protectedProcedure.use(({ ctx, next }) => {
  if (!["admin", "agente"].includes(ctx.user.role)) {
    throw new TRPCError({ code: "FORBIDDEN" });
  }
  return next({ ctx });
});

export const ticketingRouter = router({
  // ── PRODUCTOS TICKETING ──────────────────────────────────────────────────

  /** Admin: listar todos los productos ticketing */
  listProducts: adminProc.query(async () => {
    return db.select().from(ticketingProducts).orderBy(desc(ticketingProducts.createdAt));
  }),

  /** Admin: obtener producto ticketing por ID */
  getProduct: adminProc
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const [product] = await db.select().from(ticketingProducts).where(eq(ticketingProducts.id, input.id)).limit(1);
      if (!product) throw new TRPCError({ code: "NOT_FOUND" });
      return product;
    }),

  /** Admin: crear producto ticketing */
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

  /** Admin: actualizar producto ticketing */
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

  /** Admin: eliminar producto ticketing */
  deleteProduct: adminProc
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await db.delete(ticketingProducts).where(eq(ticketingProducts.id, input.id));
      return { success: true };
    }),

  /** Público: listar productos ticketing activos (para el formulario de canje) */
  listActiveProducts: publicProcedure
    .input(z.object({ provider: z.string().default("Groupon") }))
    .query(async ({ input }) => {
      return db
        .select({ id: ticketingProducts.id, name: ticketingProducts.name, provider: ticketingProducts.provider })
        .from(ticketingProducts)
        .where(and(eq(ticketingProducts.active, true), eq(ticketingProducts.provider, input.provider)));
    }),

  // ── SOLICITUDES DE CANJE ─────────────────────────────────────────────────

  /** Público: crear solicitud de canje (desde /canjear-cupon) */
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
      // 1. Verificar duplicados
      const dupCheck = await checkDuplicates(
        input.couponCode,
        input.securityCode,
        input.email,
        input.phone,
        input.requestedDate,
        input.productTicketingId,
      );

      if (dupCheck.hardDuplicate) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Este código de cupón ya ha sido registrado en el sistema. Si crees que es un error, contacta con nosotros.",
        });
      }

      // 2. Obtener nombre del producto ticketing
      let productName = "Experiencia Náyade";
      if (input.productTicketingId) {
        const [prod] = await db
          .select({ name: ticketingProducts.name })
          .from(ticketingProducts)
          .where(eq(ticketingProducts.id, input.productTicketingId))
          .limit(1);
        if (prod) productName = prod.name;
      }

      // 3. Insertar solicitud
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
        statusFinancial: "pendiente_canje_proveedor",
        duplicateFlag: dupCheck.softDuplicate,
        duplicateNotes: dupCheck.notes || null,
      });

      const redemptionId = (result as { insertId: number }).insertId;

      // 4. Lanzar OCR en background si hay adjunto
      if (input.attachmentUrl) {
        setImmediate(async () => {
          try {
            const ocr = await runOcrExtraction(input.attachmentUrl!, {
              couponCode: input.couponCode,
              securityCode: input.securityCode,
              productName,
              customerName: input.customerName,
            });
            await db.update(couponRedemptions)
              .set({
                ocrConfidenceScore: ocr.score,
                ocrStatus: ocr.status,
                ocrRawData: ocr.rawData,
                // Auto-validar si score >= 90
                statusOperational: ocr.score >= 90 ? "validado" : "recibido",
              })
              .where(eq(couponRedemptions.id, redemptionId));
          } catch (err) {
            console.error("[Ticketing OCR background]", err);
          }
        });
      }

      // 5. Enviar email de confirmación al cliente
      try {
        await sendEmail({
          to: input.email,
          subject: `Hemos recibido tu solicitud de canje — ${input.provider}`,
          html: buildRedemptionConfirmationHtml({
            customerName: input.customerName,
            couponCode: input.couponCode,
            provider: input.provider,
            productName,
            requestedDate: input.requestedDate,
          }),
        });
      } catch (err) {
        console.error("[Ticketing] Error sending confirmation email:", err);
      }

      return {
        success: true,
        redemptionId,
        softDuplicate: dupCheck.softDuplicate,
        message: "Solicitud de canje registrada correctamente. Recibirás un email de confirmación.",
      };
    }),

  /** Admin: listar solicitudes de canje con filtros */
  listRedemptions: adminProc
    .input(z.object({
      page: z.number().int().min(1).default(1),
      pageSize: z.number().int().min(1).max(100).default(25),
      provider: z.string().optional(),
      statusOperational: z.enum(["recibido", "validado", "reserva_generada", "disfrutado", "incidencia", "cancelado"]).optional(),
      statusFinancial: z.enum(["pendiente_canje_proveedor", "canjeado_en_proveedor", "pendiente_cobro", "cobrado", "discrepancia"]).optional(),
      ocrStatus: z.enum(["alta", "media", "baja", "conflicto"]).optional(),
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
      if (input.ocrStatus) conditions.push(eq(couponRedemptions.ocrStatus, input.ocrStatus));
      if (input.duplicateFlag !== undefined) conditions.push(eq(couponRedemptions.duplicateFlag, input.duplicateFlag));
      if (input.search) {
        conditions.push(or(
          like(couponRedemptions.customerName, `%${input.search}%`),
          like(couponRedemptions.email, `%${input.search}%`),
          like(couponRedemptions.couponCode, `%${input.search}%`),
        ));
      }

      const where = conditions.length > 0 ? (conditions.length === 1 ? conditions[0] : and(...conditions)) : undefined;
      const offset = (input.page - 1) * input.pageSize;

      const [items, [{ total }]] = await Promise.all([
        db.select().from(couponRedemptions)
          .where(where)
          .orderBy(desc(couponRedemptions.createdAt))
          .limit(input.pageSize)
          .offset(offset),
        db.select({ total: count() }).from(couponRedemptions).where(where),
      ]);

      return { items, total, page: input.page, pageSize: input.pageSize, totalPages: Math.ceil(total / input.pageSize) };
    }),

  /** Admin: obtener detalle de una solicitud */
  getRedemption: adminProc
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const [item] = await db.select().from(couponRedemptions).where(eq(couponRedemptions.id, input.id)).limit(1);
      if (!item) throw new TRPCError({ code: "NOT_FOUND" });

      // Obtener producto ticketing si existe
      let ticketingProduct = null;
      if (item.productTicketingId) {
        const [tp] = await db.select().from(ticketingProducts).where(eq(ticketingProducts.id, item.productTicketingId)).limit(1);
        ticketingProduct = tp ?? null;
      }

      // Obtener producto real si existe
      let realProduct = null;
      if (item.productRealId) {
        const [rp] = await db.select({ id: experiences.id, title: experiences.title }).from(experiences).where(eq(experiences.id, item.productRealId)).limit(1);
        realProduct = rp ?? null;
      }

      return { ...item, ticketingProduct, realProduct };
    }),

  /** Admin: actualizar estado y datos de una solicitud */
  updateRedemption: adminProc
    .input(z.object({
      id: z.number(),
      statusOperational: z.enum(["recibido", "validado", "reserva_generada", "disfrutado", "incidencia", "cancelado"]).optional(),
      statusFinancial: z.enum(["pendiente_canje_proveedor", "canjeado_en_proveedor", "pendiente_cobro", "cobrado", "discrepancia"]).optional(),
      productRealId: z.number().nullable().optional(),
      notes: z.string().nullable().optional(),
      duplicateFlag: z.boolean().optional(),
      duplicateNotes: z.string().nullable().optional(),
      realAmount: z.string().nullable().optional(),
      settlementJustificantUrl: z.string().nullable().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const { id, ...data } = input;
      await db.update(couponRedemptions)
        .set({ ...data as Record<string, unknown>, adminUserId: ctx.user.id })
        .where(eq(couponRedemptions.id, id));
      return { success: true };
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

      const ocr = await runOcrExtraction(item.attachmentUrl, {
        couponCode: item.couponCode,
        securityCode: item.securityCode ?? undefined,
        productName,
        customerName: item.customerName,
      });

      await db.update(couponRedemptions)
        .set({
          ocrConfidenceScore: ocr.score,
          ocrStatus: ocr.status,
          ocrRawData: ocr.rawData,
        })
        .where(eq(couponRedemptions.id, input.id));

      return { score: ocr.score, status: ocr.status, rawData: ocr.rawData };
    }),

  /** Admin: convertir solicitud validada en reserva real */
  convertToReservation: adminProc
    .input(z.object({
      id: z.number(),
      productRealId: z.number(),
      reservationDate: z.string(),
      participants: z.number().int().min(1),
    }))
    .mutation(async ({ input, ctx }) => {
      const [item] = await db.select().from(couponRedemptions).where(eq(couponRedemptions.id, input.id)).limit(1);
      if (!item) throw new TRPCError({ code: "NOT_FOUND" });
      if (item.statusOperational === "reserva_generada") {
        throw new TRPCError({ code: "CONFLICT", message: "Esta solicitud ya tiene una reserva generada" });
      }

      // Obtener o crear cliente
      let clientId: number | null = null;
      const [existingClient] = await db
        .select({ id: clients.id })
        .from(clients)
        .where(sql`${clients.email} = ${item.email}`)
        .limit(1);
      clientId = existingClient?.id ?? null;

      if (!clientId) {
        const [newClient] = await db.insert(clients).values({
          name: item.customerName,
          email: item.email,
          phone: item.phone ?? null,
          source: "ticketing",
        });
        clientId = (newClient as { insertId: number }).insertId;
      }

      // Crear reserva
      const merchantOrder = `TKT-${Date.now()}`;
      // Get product name for reservation
      const [expRow] = await db.select({ title: experiences.title }).from(experiences).where(eq(experiences.id, input.productRealId)).limit(1);
      const now = Date.now();
      const [resResult] = await db.insert(reservations).values({
        productId: input.productRealId,
        productName: expRow?.title ?? "Experiencia Náyade",
        bookingDate: input.reservationDate,
        people: input.participants,
        amountTotal: 0, // Cupón = sin cargo
        amountPaid: 0,
        status: "paid",
        channel: "otro",
        merchantOrder,
        notes: `Canje cupón ${item.provider} — Código: ${item.couponCode} — Redemption ID: ${item.id}`,
        customerName: item.customerName,
        customerEmail: item.email,
        customerPhone: item.phone ?? null,
        createdAt: now,
        updatedAt: now,
        paidAt: now,
      });

      const reservationId = (resResult as { insertId: number }).insertId;

      // Actualizar solicitud
      await db.update(couponRedemptions)
        .set({
          statusOperational: "reserva_generada",
          productRealId: input.productRealId,
          reservationId,
          adminUserId: ctx.user.id,
        })
        .where(eq(couponRedemptions.id, input.id));

      return { success: true, reservationId };
    }),

  /** Admin: métricas del módulo ticketing */
  getMetrics: adminProc.query(async () => {
    const [metrics] = await db.select({
      total: count(),
    }).from(couponRedemptions);

    const byStatus = await db
      .select({
        status: couponRedemptions.statusOperational,
        count: count(),
      })
      .from(couponRedemptions)
      .groupBy(couponRedemptions.statusOperational);

    const byFinancial = await db
      .select({
        status: couponRedemptions.statusFinancial,
        count: count(),
      })
      .from(couponRedemptions)
      .groupBy(couponRedemptions.statusFinancial);

    const byOcr = await db
      .select({
        status: couponRedemptions.ocrStatus,
        count: count(),
      })
      .from(couponRedemptions)
      .groupBy(couponRedemptions.ocrStatus);

    const incidencias = byStatus.find((s) => s.status === "incidencia")?.count ?? 0;
    const pendientesCanje = byFinancial.find((s) => s.status === "pendiente_canje_proveedor")?.count ?? 0;
    const cobrados = byFinancial.find((s) => s.status === "cobrado")?.count ?? 0;

    return {
      total: metrics.total,
      byStatus,
      byFinancial,
      byOcr,
      incidencias,
      pendientesCanje,
      cobrados,
    };
  }),
});
