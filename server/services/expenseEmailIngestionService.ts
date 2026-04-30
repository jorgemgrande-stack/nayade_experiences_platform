/**
 * expenseEmailIngestionService.ts
 *
 * Lee la bandeja de entrada IMAP buscando correos cuyo asunto comience por #gasto.
 * Formato esperado: "#gasto #123,45€ Concepto opcional"
 *
 * Variables de entorno:
 *   IMAP_EXPENSE_HOST    (default: same as IMAP_TPV_HOST)
 *   IMAP_EXPENSE_PORT    (default: 993)
 *   IMAP_EXPENSE_SECURE  (default: true)
 *   IMAP_EXPENSE_USER    (default: administracion@nayadeexperiences.es)
 *   IMAP_EXPENSE_PASS    — obligatoria; sin ella el job no arranca
 *   IMAP_EXPENSE_MAILBOX (default: INBOX)
 *
 * Feature flag: expense_email_ingestion_enabled
 */

import mysql from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
import { eq, desc } from "drizzle-orm";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import cron from "node-cron";
import { expenses, expenseFiles, expenseEmailIngestionLogs } from "../../drizzle/schema";
import { storagePut } from "../storage";

// ─── CONFIG ──────────────────────────────────────────────────────────────────

const IMAP_HOST    = process.env.IMAP_EXPENSE_HOST    ?? process.env.IMAP_TPV_HOST    ?? "nayadeexperiences.es.correoseguro.dinaserver.com";
const IMAP_PORT    = parseInt(process.env.IMAP_EXPENSE_PORT    ?? process.env.IMAP_TPV_PORT    ?? "993");
const IMAP_SECURE  = (process.env.IMAP_EXPENSE_SECURE  ?? process.env.IMAP_TPV_SECURE  ?? "true") === "true";
const IMAP_USER    = process.env.IMAP_EXPENSE_USER    ?? process.env.IMAP_TPV_USER    ?? "administracion@nayadeexperiences.es";
const IMAP_PASS    = process.env.IMAP_EXPENSE_PASS    ?? process.env.IMAP_TPV_PASS    ?? "";
const IMAP_MAILBOX = process.env.IMAP_EXPENSE_MAILBOX ?? "INBOX";

// Tipos MIME y extensiones aceptadas como justificante
const ACCEPTED_MIMES = new Set([
  "application/pdf",
  "image/jpeg", "image/jpg", "image/png", "image/heic", "image/heif",
]);
const ACCEPTED_EXTS = new Set([".pdf", ".jpg", ".jpeg", ".png", ".heic", ".heif"]);

// ─── CONCURRENCY LOCK ────────────────────────────────────────────────────────

let isRunning = false;

// ─── DB ──────────────────────────────────────────────────────────────────────

const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 3 });
const db = drizzle(_pool);

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function randomSuffix() {
  return Math.random().toString(36).slice(2, 8);
}

/**
 * Elimina prefijos de spam comunes antes de procesar el asunto.
 * Ej: "(Spam) #gasto ..." → "#gasto ..."
 */
function normalizeSubject(subject: string): string {
  return subject.trim().replace(/^\[?spam\]?\s*/i, "").trim();
}

/**
 * Parsea el asunto del email para extraer importe y concepto.
 * Formato: "#gasto #123,45€ Concepto" o "#gasto #123.45€ Concepto"
 * Devuelve null si el asunto no es válido o no tiene importe.
 */
function parseSubject(subject: string): { amount: number; concept: string } | null {
  const trimmed = normalizeSubject(subject);
  if (!trimmed.toLowerCase().startsWith("#gasto")) return null;

  // Captura: #gasto #IMPORTE€ [concepto]
  // Acepta: 123 / 123.45 / 123,45 / 1.234,56 / 1234,56
  const match = trimmed.match(/^#gasto\s+#([\d]+[.,]?[\d]*)€?\s*(.*)/i);
  if (!match) return null;

  const rawAmount = match[1].replace(",", ".");
  const amount = parseFloat(rawAmount);
  if (isNaN(amount) || amount <= 0) return null;

  const concept = (match[2] ?? "").trim() || "Gasto desde email";
  return { amount, concept };
}

function isAcceptedAttachment(contentType: string, filename: string): boolean {
  const mime = contentType.toLowerCase().split(";")[0].trim();
  if (ACCEPTED_MIMES.has(mime)) return true;
  const ext = filename.toLowerCase().match(/\.[^.]+$/)?.[0] ?? "";
  return ACCEPTED_EXTS.has(ext);
}

async function getOrCreateDefaultCategoryId(): Promise<number> {
  const pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 1 });
  try {
    const [rows] = await pool.query("SELECT id FROM expense_categories WHERE name = 'Sin clasificar' LIMIT 1") as any[];
    const found = (rows as any[])[0];
    if (found) return found.id;

    const [res] = await pool.query(
      "INSERT INTO expense_categories (name, description) VALUES ('Sin clasificar', 'Categoría por defecto para gastos creados desde email')"
    ) as any[];
    return (res as any).insertId;
  } finally {
    await pool.end();
  }
}

async function getDefaultCostCenterId(): Promise<number> {
  const pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 1 });
  try {
    const [rows] = await pool.query("SELECT id FROM cost_centers ORDER BY id ASC LIMIT 1") as any[];
    const first = (rows as any[])[0];
    if (first) return first.id;

    const [res] = await pool.query(
      "INSERT INTO cost_centers (name, description) VALUES ('General', 'Centro de coste general')"
    ) as any[];
    return (res as any).insertId;
  } finally {
    await pool.end();
  }
}

// ─── MAIN JOB ────────────────────────────────────────────────────────────────

export async function runExpenseEmailIngestion(): Promise<{ processed: number; duplicated: number; errors: number }> {
  const result = { processed: 0, duplicated: 0, errors: 0 };

  if (!IMAP_PASS) {
    console.warn("[ExpenseMailIngestion] IMAP_EXPENSE_PASS no configurada — job desactivado");
    return result;
  }

  if (isRunning) {
    console.log("[ExpenseMailIngestion] Job ya en ejecución, saltando...");
    return result;
  }

  isRunning = true;

  const client = new ImapFlow({
    host: IMAP_HOST,
    port: IMAP_PORT,
    secure: IMAP_SECURE,
    auth: { user: IMAP_USER, pass: IMAP_PASS },
    logger: false,
    tls: { rejectUnauthorized: false },
  });

  try {
    await client.connect();
    const lock = await client.getMailboxLock(IMAP_MAILBOX);

    try {
      // Buscar correos de los últimos 30 días sin filtrar por leído/no leído.
      // La deduplicación se gestiona por messageId en expenseEmailIngestionLogs.
      const since = new Date();
      since.setDate(since.getDate() - 30);
      const uids = await client.search({ since });
      if (!uids.length) return result;

      for (const uid of uids) {
        try {
          const msg = await client.fetchOne(String(uid), { source: true }, { uid: true });
          if (!msg?.source) continue;

          const parsed = await simpleParser(msg.source);
          const subject    = parsed.subject ?? "";
          const messageId  = parsed.messageId ?? `uid-${uid}-${Date.now()}`;
          const sender     = parsed.from?.text ?? "";
          const receivedAt = parsed.date ?? new Date();

          // Solo procesar emails con asunto #gasto (normalizar prefijos spam primero)
          if (!normalizeSubject(subject).toLowerCase().startsWith("#gasto")) {
            // No es un gasto — no marcar como leído (otros jobs pueden necesitarlo)
            continue;
          }

          // Control de duplicados por messageId
          const [dupRows] = await db
            .select({ id: expenseEmailIngestionLogs.id })
            .from(expenseEmailIngestionLogs)
            .where(eq(expenseEmailIngestionLogs.messageId, messageId))
            .limit(1);

          if (dupRows) {
            // Ya procesado — saltar silenciosamente (sin insertar nueva fila de log)
            result.duplicated++;
            continue;
          }

          // Parsear asunto
          const parsed_subject = parseSubject(subject);
          if (!parsed_subject) {
            await db.insert(expenseEmailIngestionLogs).values({
              messageId,
              subject,
              sender,
              receivedAt,
              status: "missing_amount",
              errorMessage: "No se pudo extraer importe del asunto. Formato: #gasto #123,45€ Concepto",
            });
            await client.messageFlagsAdd(String(uid), ["\\Seen"], { uid: true });
            result.errors++;
            console.log(`[ExpenseMailIngestion] Sin importe válido: "${subject}"`);
            continue;
          }

          const { amount, concept } = parsed_subject;
          const expenseDate = receivedAt.toISOString().slice(0, 10);

          // Categoría y centro de coste por defecto
          let categoryId: number;
          let costCenterId: number;
          try {
            [categoryId, costCenterId] = await Promise.all([
              getOrCreateDefaultCategoryId(),
              getDefaultCostCenterId(),
            ]);
          } catch (lookupErr: any) {
            await db.insert(expenseEmailIngestionLogs).values({
              messageId,
              subject,
              sender,
              receivedAt,
              status: "error",
              errorMessage: `Error obteniendo categoría/CC: ${lookupErr.message}`,
            });
            result.errors++;
            continue;
          }

          // Filtrar adjuntos válidos
          const validAttachments = (parsed.attachments ?? []).filter(
            att => isAcceptedAttachment(att.contentType ?? "", att.filename ?? "")
          );
          const hasAttachments = validAttachments.length > 0;

          // Crear el gasto
          const rawPool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 1 });
          let expenseId: number;
          try {
            const [expRes] = await rawPool.query(
              `INSERT INTO expenses
                (date, concept, amount, categoryId, costCenterId, paymentMethod, status, notes,
                 source, emailMessageId, emailFrom, missingAttachment, createdAt, updatedAt)
               VALUES (?, ?, ?, ?, ?, 'transfer', 'pending', ?, 'email', ?, ?, ?, NOW(), NOW())`,
              [
                expenseDate,
                concept,
                amount.toFixed(2),
                categoryId,
                costCenterId,
                "Gasto creado automáticamente desde email",
                messageId,
                sender,
                !hasAttachments ? 1 : 0,
              ]
            ) as any[];
            expenseId = (expRes as any).insertId;
          } finally {
            await rawPool.end();
          }

          // Guardar adjuntos en S3/local
          let savedCount = 0;
          for (const att of validAttachments) {
            try {
              const fileName = att.filename ?? `adjunto-${savedCount + 1}`;
              const storageKey = `expenses/${expenseId}/${fileName}-${randomSuffix()}`;
              const { url } = await storagePut(storageKey, att.content, att.contentType ?? "application/octet-stream");

              await db.insert(expenseFiles).values({
                expenseId,
                filePath: url,
                fileName,
                mimeType: att.contentType ?? "application/octet-stream",
              });
              savedCount++;
            } catch (attErr: any) {
              console.error(`[ExpenseMailIngestion] Error guardando adjunto de gasto ${expenseId}:`, attErr.message);
            }
          }

          // Registrar log de éxito
          await db.insert(expenseEmailIngestionLogs).values({
            messageId,
            subject,
            sender,
            receivedAt,
            status: "processed",
            expenseId,
            amountDetected: amount.toFixed(2),
            attachmentsCount: savedCount,
          });

          await client.messageFlagsAdd(String(uid), ["\\Seen"], { uid: true });
          result.processed++;

          console.log(
            `[ExpenseMailIngestion] ✓ Gasto id=${expenseId} | ${amount.toFixed(2)} € | "${concept}" | ${savedCount} adjunto(s) | ${hasAttachments ? "" : "⚠ sin adjunto"}`
          );

        } catch (msgErr: any) {
          console.error(`[ExpenseMailIngestion] Error procesando uid=${uid}:`, msgErr.message);
          result.errors++;
        }
      }
    } finally {
      lock.release();
    }

    await client.logout();
  } catch (imapErr: any) {
    console.error("[ExpenseMailIngestion] Error de conexión IMAP:", imapErr.message);
    result.errors++;
  } finally {
    isRunning = false;
  }

  return result;
}

// ─── CRON + BOOT ─────────────────────────────────────────────────────────────

export function startExpenseEmailIngestionJob(): void {
  setImmediate(() => {
    runExpenseEmailIngestion()
      .then(r => {
        if (r.processed > 0 || r.errors > 0) {
          console.log(`[ExpenseMailIngestion] Boot run — procesados: ${r.processed}, duplicados: ${r.duplicated}, errores: ${r.errors}`);
        }
      })
      .catch(e => console.error("[ExpenseMailIngestion] Boot run error:", e));
  });

  cron.schedule("*/10 * * * *", () => {
    runExpenseEmailIngestion()
      .then(r => {
        if (r.processed > 0 || r.errors > 0) {
          console.log(`[ExpenseMailIngestion] Cron — procesados: ${r.processed}, duplicados: ${r.duplicated}, errores: ${r.errors}`);
        }
      })
      .catch(e => console.error("[ExpenseMailIngestion] Cron error:", e));
  });

  console.log("[ExpenseMailIngestion] Job iniciado (boot + cada 10 min)");
}
