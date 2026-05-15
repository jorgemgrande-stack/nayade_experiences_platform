import { z } from "zod";
import { router, publicProcedure } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import {
  expenseCategories,
  expenseFiles,
  expenses,
  costCenters,
} from "../../drizzle/schema";
import { and, eq } from "drizzle-orm";
import { storagePut } from "../storage";

const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 1 });
const db = drizzle(_pool);

function randomSuffix() {
  return Math.random().toString(36).slice(2, 8);
}
function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

// ─── Rate limiting ─────────────────────────────────────────────────────────────
// 10 submissions per IP per 15 minutes
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;

function checkRateLimit(ip: string): void {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return;
  }
  entry.count++;
  if (entry.count > RATE_LIMIT_MAX) {
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: "Demasiadas solicitudes. Inténtalo de nuevo en unos minutos.",
    });
  }
}

// ─── Token validation ──────────────────────────────────────────────────────────
function validateToken(token: string | undefined): void {
  const expected = process.env.PUBLIC_EXPENSE_FORM_TOKEN?.trim();
  if (!expected || !token || token !== expected) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Formulario no disponible." });
  }
}

// ─── File constraints ──────────────────────────────────────────────────────────
const ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "application/pdf",
]);
const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB

// ─── Router ────────────────────────────────────────────────────────────────────
export const publicExpensesRouter = router({
  // Lista categorías activas (requiere token válido)
  categories: publicProcedure
    .input(z.object({ token: z.string() }))
    .query(async ({ input }) => {
      validateToken(input.token);
      return db
        .select({ id: expenseCategories.id, name: expenseCategories.name })
        .from(expenseCategories)
        .where(eq(expenseCategories.active, true))
        .orderBy(expenseCategories.name);
    }),

  // Envía un gasto desde el formulario público
  submit: publicProcedure
    .input(
      z.object({
        token: z.string(),
        amount: z.string().min(1),
        categoryId: z.number().int().positive(),
        notes: z.string().max(2000).optional(),
        // Adjunto opcional — base64 + metadatos
        file: z
          .object({
            fileName: z.string().min(1).max(255),
            mimeType: z.string().min(1),
            base64: z.string().min(1),
          })
          .optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      validateToken(input.token);

      // Rate limit por IP
      const forwarded = (ctx.req.headers["x-forwarded-for"] as string | undefined)
        ?.split(",")[0]
        ?.trim();
      const ip = forwarded ?? (ctx.req.socket as any)?.remoteAddress ?? "unknown";
      checkRateLimit(ip);

      // Validar importe
      const amountNum = parseFloat(input.amount.replace(",", "."));
      if (isNaN(amountNum) || amountNum <= 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "El importe debe ser mayor que 0.",
        });
      }

      // Validar archivo si se adjunta
      if (input.file) {
        if (!ALLOWED_MIME.has(input.file.mimeType)) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Formato no permitido. Usa JPG, PNG, WEBP o PDF.",
          });
        }
        const buf = Buffer.from(input.file.base64, "base64");
        if (buf.byteLength > MAX_FILE_BYTES) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "El archivo supera el tamaño máximo permitido (10 MB).",
          });
        }
      }

      // Categoría válida y activa
      const [category] = await db
        .select({ id: expenseCategories.id })
        .from(expenseCategories)
        .where(
          and(
            eq(expenseCategories.id, input.categoryId),
            eq(expenseCategories.active, true),
          ),
        )
        .limit(1);
      if (!category) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Categoría no válida." });
      }

      // Centro de coste por defecto (primero activo)
      const [defaultCC] = await db
        .select({ id: costCenters.id })
        .from(costCenters)
        .where(eq(costCenters.active, true))
        .limit(1);
      if (!defaultCC) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "No hay centros de coste configurados. Contacta con administración.",
        });
      }

      // Concepto desde notas o texto por defecto
      const concept = input.notes?.trim()
        ? input.notes.trim().slice(0, 200)
        : "Gasto enviado desde formulario público";

      // Crear gasto
      const [res] = await db.insert(expenses).values({
        date: todayStr(),
        concept,
        amount: amountNum.toFixed(2),
        categoryId: input.categoryId,
        costCenterId: defaultCC.id,
        supplierId: null,
        paymentMethod: "transfer",
        status: "pending",
        notes: input.notes ?? null,
        source: "manual",
        // OCR fase 2: añadir campo ocrStatus: "pending_review" cuando se implemente
        // Para extraer: importe, fecha, proveedor, categoría sugerida del ticket adjunto
      });
      const expenseId = (res as { insertId: number }).insertId;

      // Guardar adjunto si se proporcionó
      if (input.file) {
        const fileBuffer = Buffer.from(input.file.base64, "base64");
        const key = `expenses/${expenseId}/${input.file.fileName}-${randomSuffix()}`;
        const { url } = await storagePut(key, fileBuffer, input.file.mimeType);
        await db.insert(expenseFiles).values({
          expenseId,
          filePath: url,
          fileName: input.file.fileName,
          mimeType: input.file.mimeType,
        });
      }

      return { ok: true, expenseId };
    }),
});
