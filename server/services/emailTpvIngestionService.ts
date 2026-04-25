import "dotenv/config";
import mysql from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
import { eq, like } from "drizzle-orm";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import cron from "node-cron";
import * as XLSX from "xlsx";
import {
  cardTerminalOperations,
  emailIngestionLogs,
  reservations,
  quotes,
} from "../../drizzle/schema";

// ─── CONFIG ───────────────────────────────────────────────────────────────────

const IMAP_HOST = process.env.IMAP_TPV_HOST ?? "nayadeexperiences.es.correoseguro.dinaserver.com";
const IMAP_PORT = parseInt(process.env.IMAP_TPV_PORT ?? "993");
const IMAP_SECURE = (process.env.IMAP_TPV_SECURE ?? "true") === "true";
const IMAP_USER = process.env.IMAP_TPV_USER ?? "administracion@nayadeexperiences.es";
const IMAP_PASS = process.env.IMAP_TPV_PASS ?? "";
const IMAP_MAILBOX = process.env.IMAP_TPV_MAILBOX ?? "INBOX";
const IMAP_ALLOWED_SENDER = process.env.IMAP_TPV_ALLOWED_SENDER ?? "copia@ticket.comerciaglobalpay.com";
const IMAP_BATCH_SIZE = parseInt(process.env.IMAP_TPV_BATCH_SIZE ?? "50");

// ─── CONCURRENCY LOCK ────────────────────────────────────────────────────────

let isRunning = false;

// ─── DB ───────────────────────────────────────────────────────────────────────

function makeDb() {
  const pool = mysql.createPool(process.env.DATABASE_URL!);
  return drizzle(pool);
}

// ─── TEXT NORMALIZATION ───────────────────────────────────────────────────────

function normalizeText(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[​­﻿ ]/g, " ")
    .replace(/ {2,}/g, " ")
    .trim();
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function normalizeStr(s: string | null | undefined): string {
  return (s ?? "").trim().toUpperCase();
}

function makeDuplicateKey(
  commerceCode: string | null,
  terminalCode: string | null,
  operationNumber: string,
  amount: number,
  dt: Date
): string {
  const dtStr = dt.toISOString().slice(0, 16);
  return [
    normalizeStr(commerceCode),
    normalizeStr(terminalCode),
    normalizeStr(operationNumber),
    amount.toFixed(2),
    dtStr,
  ].join("|");
}

// ─── PARSER HELPERS ───────────────────────────────────────────────────────────

interface ParsedOperation {
  operationNumber: string;
  operationType: "VENTA" | "DEVOLUCION" | "ANULACION" | "OTRO";
  amount: number;
  operationDatetime: Date;
  commerceCode: string | null;
  terminalCode: string | null;
  authorizationCode: string | null;
  card: string | null;
}

type ParsingStrategy = "pdf" | "body" | "excel";

function extractOperationNumber(text: string): string | null {
  const patterns = [
    /OP\.\s*:\s*(\d{4,12})/,
    /OP\s*\.\s+(\d{4,12})/,
    /TRANSACCI[OÓ]N\s*[:\s]+(\d{4,12})/,
    /N[ÚU]MERO\s+DE\s+OPERACI[OÓ]N\s*[:\s]+(\d{4,12})/,
    /N\.\s*OPERACI[OÓ]N\s*[:\s]+(\d{4,12})/,
    /OPERACI[OÓ]N\s*[:\s.]+(\d{4,12})/,
    /N[ÚU]M\.?\s*OP[.\s]*[:\s]+(\d{4,12})/,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m?.[1]) return m[1].trim();
  }
  return null;
}

function extractAmount(text: string): number | null {
  const patterns = [
    /IMPORTE\s*[:\s]+([\d.,]+)\s*EUR/,
    /TOTAL\s*[:\s]+([\d.,]+)\s*EUR/,
    /([\d.,]+)\s*EUR/,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (!m) continue;
    const raw = m[1].trim();
    // Handle both formats: Spanish 1.234,56 and ISO 1234.56
    let cleaned: string;
    if (raw.includes(",") && raw.includes(".")) {
      // Thousand-dot + comma-decimal: 1.234,56 → 1234.56
      cleaned = raw.replace(/\./g, "").replace(",", ".");
    } else {
      // Comma-only decimal: 1234,56 → 1234.56
      cleaned = raw.replace(",", ".");
    }
    const val = parseFloat(cleaned);
    if (!isNaN(val) && val > 0 && val < 1_000_000) return val;
  }
  return null;
}

function extractDate(text: string): Date | null {
  // With time (priority): DD/MM/YYYY HH:MM or DD-MM-YYYY HH:MM
  // Also handles: "COMERCIO - 24/04/2026 12:34"
  const withTime = text.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})\s+(\d{1,2}:\d{2})/);
  if (withTime) {
    const [, d, mo, y, time] = withTime;
    const dt = new Date(`${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}T${time}:00`);
    if (!isNaN(dt.getTime())) return dt;
  }
  // Date only
  const dateOnly = text.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (dateOnly) {
    const [, d, mo, y] = dateOnly;
    const dt = new Date(`${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}T00:00:00`);
    if (!isNaN(dt.getTime())) return dt;
  }
  return null;
}

function extractTerminal(text: string): string | null {
  const patterns = [
    /N[ÚU]MERO\s+DE\s+TERMINAL\s*[:\s]+(\d{5,})/,
    /C[OÓ]D(?:IGO)?\s*(?:DE\s*)?TERMINAL\s*[:\s]+(\d{5,})/,
    /TERMINAL\s*[:\s]+(\d{5,})/,
    /TPV\s*[:\s]+(\d{5,})/,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m?.[1]) return m[1].trim();
  }
  return null;
}

function extractCommerce(text: string): string | null {
  const patterns = [
    /C[OÓ]D(?:IGO)?\s*(?:DE\s*)?COMERCIO\s*[:\s]+(\d{5,})/,
    /COMERCIO\s*[:\s]+(\d{5,})/,
    /NAYADE\s+EXPERIENCES\s+(\d{5,})/,
    /TPV\s+NAYADE\s+EXPERIENCES\s+(\d{5,})/,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m?.[1]) return m[1].trim();
  }
  return null;
}

function extractOperationType(text: string): ParsedOperation["operationType"] {
  if (/DEVOLUCI[OÓ]N/.test(text)) return "DEVOLUCION";
  if (/ANULACI[OÓ]N/.test(text)) return "ANULACION";
  return "VENTA";
}

// ─── TEXT → OPS ───────────────────────────────────────────────────────────────

function parseTicketText(text: string): ParsedOperation | null {
  try {
    const operationNumber = extractOperationNumber(text);
    if (!operationNumber) return null;
    const amount = extractAmount(text);
    if (!amount) return null;
    const authMatch = text.match(/AUTORIZACI[OÓ]N\s*[:\s]+([A-Z0-9]{4,})/);
    const cardMatch = text.match(/TARJETA\s*[:\s]+([\*\dX]{4,})/);
    return {
      operationNumber,
      operationType: extractOperationType(text),
      amount,
      operationDatetime: extractDate(text) ?? new Date(),
      commerceCode: extractCommerce(text),
      terminalCode: extractTerminal(text),
      authorizationCode: authMatch?.[1]?.trim() ?? null,
      card: cardMatch?.[1]?.trim() ?? null,
    };
  } catch {
    return null;
  }
}

function parseSummaryText(text: string): ParsedOperation[] {
  const ops: ParsedOperation[] = [];
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    const operationNumber = extractOperationNumber(line);
    if (!operationNumber) continue;
    const amount = extractAmount(line);
    if (!amount) continue;
    ops.push({
      operationNumber,
      operationType: extractOperationType(line),
      amount,
      operationDatetime: extractDate(line) ?? new Date(),
      commerceCode: extractCommerce(line),
      terminalCode: extractTerminal(line),
      authorizationCode: null,
      card: null,
    });
  }
  return ops;
}

// ─── FORMAT-SPECIFIC PARSERS ─────────────────────────────────────────────────

function parseExcelBuffer(buf: Buffer): ParsedOperation[] {
  try {
    const wb = XLSX.read(buf, { type: "buffer" });
    const ops: ParsedOperation[] = [];
    for (const sheetName of wb.SheetNames) {
      const rows: any[][] = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], {
        header: 1,
        defval: "",
      });
      for (const row of rows) {
        if (!Array.isArray(row)) continue;
        const line = normalizeText(row.map((c: any) => String(c ?? "")).join(" "));
        const operationNumber = extractOperationNumber(line);
        if (!operationNumber) continue;
        const amount = extractAmount(line);
        if (!amount) continue;
        ops.push({
          operationNumber,
          operationType: extractOperationType(line),
          amount,
          operationDatetime: extractDate(line) ?? new Date(),
          commerceCode: extractCommerce(line),
          terminalCode: extractTerminal(line),
          authorizationCode: null,
          card: null,
        });
      }
    }
    return ops;
  } catch {
    return [];
  }
}

async function extractTextFromPdf(buf: Buffer): Promise<string | null> {
  try {
    // Dynamic import avoids test-fixture issue with pdf-parse at module load time
    const pdfModule = await import("pdf-parse");
    const pdfParse = (pdfModule as any).default ?? pdfModule;
    const data = await pdfParse(buf);
    return normalizeText(data.text ?? "");
  } catch (e) {
    console.warn("[EmailTPV] PDF extraction failed:", (e as any)?.message);
    return null;
  }
}

// ─── EMAIL → OPS DISPATCHER ───────────────────────────────────────────────────

async function extractOpsFromEmail(parsed: {
  text?: string | null;
  attachments?: any[];
  subject?: string | null;
}): Promise<{ ops: ParsedOperation[]; strategy: ParsingStrategy }> {
  const attachments = parsed.attachments ?? [];
  const subject = normalizeText(parsed.subject ?? "");
  const isDailySummary =
    subject.includes("DÍA") || subject.includes("DIA") || subject.includes("RESUMEN");

  // 1. PDF attachment — priority
  for (const att of attachments) {
    const isPdf =
      att.contentType === "application/pdf" ||
      (att.filename && /\.pdf$/i.test(att.filename));
    if (!isPdf) continue;
    const pdfText = await extractTextFromPdf(att.content as Buffer);
    if (!pdfText) continue;
    const ops = isDailySummary
      ? parseSummaryText(pdfText)
      : ([parseTicketText(pdfText)].filter(Boolean) as ParsedOperation[]);
    if (ops.length > 0) return { ops, strategy: "pdf" };
  }

  // 2. Excel/CSV attachment
  for (const att of attachments) {
    const isExcel =
      att.contentType?.includes("spreadsheet") ||
      att.contentType?.includes("excel") ||
      (att.filename && /\.(xlsx|xls|csv)$/i.test(att.filename));
    if (!isExcel) continue;
    const ops = parseExcelBuffer(att.content as Buffer);
    if (ops.length > 0) return { ops, strategy: "excel" };
  }

  // 3. Email body (HTML stripped to plain text by mailparser)
  const bodyText = normalizeText(parsed.text ?? "");
  const ops = isDailySummary
    ? parseSummaryText(bodyText)
    : ([parseTicketText(bodyText)].filter(Boolean) as ParsedOperation[]);
  return { ops, strategy: "body" };
}

// ─── AUTO-LINK ────────────────────────────────────────────────────────────────

async function tryAutoLink(
  db: ReturnType<typeof makeDb>,
  operationId: number,
  operationNumber: string,
  now: Date
): Promise<boolean> {
  const pattern = `%Nº operación TPV: ${operationNumber}%`;

  const [res] = await db
    .select({ id: reservations.id })
    .from(reservations)
    .where(like(reservations.notes, pattern))
    .limit(1);
  if (res) {
    await db
      .update(cardTerminalOperations)
      .set({
        linkedEntityType: "reservation",
        linkedEntityId: res.id,
        linkedAt: now,
        linkedBy: "auto-email",
        status: "conciliado",
      })
      .where(eq(cardTerminalOperations.id, operationId));
    return true;
  }

  const [qt] = await db
    .select({ id: quotes.id })
    .from(quotes)
    .where(like(quotes.notes, pattern))
    .limit(1);
  if (qt) {
    await db
      .update(cardTerminalOperations)
      .set({
        linkedEntityType: "quote",
        linkedEntityId: qt.id,
        linkedAt: now,
        linkedBy: "auto-email",
        status: "conciliado",
      })
      .where(eq(cardTerminalOperations.id, operationId));
    return true;
  }

  return false;
}

// ─── RESULT TYPE ─────────────────────────────────────────────────────────────

export interface IngestionResult {
  messagesChecked: number;
  messagesProcessed: number;
  operationsDetected: number;
  operationsInserted: number;
  operationsDuplicate: number;
  operationsLinked: number;
  operationsFailed: number;
  errors: string[];
}

function emptyResult(extra?: Partial<IngestionResult>): IngestionResult {
  return {
    messagesChecked: 0,
    messagesProcessed: 0,
    operationsDetected: 0,
    operationsInserted: 0,
    operationsDuplicate: 0,
    operationsLinked: 0,
    operationsFailed: 0,
    errors: [],
    ...extra,
  };
}

// ─── CORE INGESTION ───────────────────────────────────────────────────────────

export async function runEmailIngestion(retryErrors = false): Promise<IngestionResult> {
  if (isRunning) {
    console.log("[EmailTPV] Already running — skipping");
    return emptyResult({ errors: ["Already running"] });
  }

  if (!IMAP_PASS) {
    console.warn("[EmailTPV] IMAP_TPV_PASS not set — skipping");
    return emptyResult({ errors: ["IMAP_TPV_PASS not configured"] });
  }

  isRunning = true;
  const result = emptyResult();
  const db = makeDb();

  const client = new ImapFlow({
    host: IMAP_HOST,
    port: IMAP_PORT,
    secure: IMAP_SECURE,
    auth: { user: IMAP_USER, pass: IMAP_PASS },
    logger: false,
  });

  try {
    await client.connect();
    const lock = await client.getMailboxLock(IMAP_MAILBOX);

    try {
      // Collect unseen UIDs from allowed sender
      const uids: number[] = [];
      for await (const msg of client.fetch({ seen: false }, { uid: true, envelope: true })) {
        const from = msg.envelope?.from?.[0]?.address ?? "";
        if (from.toLowerCase() !== IMAP_ALLOWED_SENDER.toLowerCase()) continue;
        uids.push(msg.uid);
      }

      // Process newest first (UIDs are ascending → slice from end)
      const batch = uids.slice(-IMAP_BATCH_SIZE);
      result.messagesChecked = batch.length;

      for (const uid of batch) {
        // Isolate each email — never abort the loop on single failure
        try {
          const msgData = (await client.fetchOne(
            uid,
            { source: true },
            { uid: true }
          )) as any;
          if (!msgData?.source) continue;

          const parsed = await simpleParser(msgData.source as Buffer);
          const messageId = parsed.messageId ?? `uid-${uid}`;
          const subject = parsed.subject ?? "";
          const receivedAt = parsed.date ?? new Date();

          // Check existing log entry
          const [existingLog] = await db
            .select({
              id: emailIngestionLogs.id,
              status: emailIngestionLogs.status,
              retryCount: emailIngestionLogs.retryCount,
            })
            .from(emailIngestionLogs)
            .where(eq(emailIngestionLogs.messageId, messageId))
            .limit(1);

          // Skip ok emails always; skip errored emails unless manual retry
          if (existingLog?.status === "ok") continue;
          if (existingLog?.status === "error" && !retryErrors) continue;

          // Extract operations from email (pdf / excel / body)
          const { ops, strategy } = await extractOpsFromEmail({
            text: parsed.text,
            attachments: parsed.attachments ?? [],
            subject,
          });

          result.operationsDetected += ops.length;

          let inserted = 0;
          let duplicate = 0;
          let linked = 0;
          let failed = 0;
          let logStatus: "ok" | "error" | "skipped" = ops.length === 0 ? "skipped" : "ok";
          let logError: string | null = null;
          const now = new Date();

          for (const op of ops) {
            try {
              const dupKey = makeDuplicateKey(
                op.commerceCode,
                op.terminalCode,
                op.operationNumber,
                op.amount,
                op.operationDatetime
              );

              await db.insert(cardTerminalOperations).values({
                operationDatetime: op.operationDatetime,
                operationNumber: op.operationNumber,
                commerceCode: op.commerceCode,
                terminalCode: op.terminalCode,
                operationType: op.operationType,
                amount: String(op.amount.toFixed(2)),
                card: op.card,
                authorizationCode: op.authorizationCode,
                linkedEntityType: "none",
                status: "pendiente",
                duplicateKey: dupKey,
              });

              const [newOp] = await db
                .select({ id: cardTerminalOperations.id })
                .from(cardTerminalOperations)
                .where(eq(cardTerminalOperations.duplicateKey, dupKey))
                .limit(1);

              let wasLinked = false;
              if (newOp) {
                wasLinked = await tryAutoLink(db, newOp.id, op.operationNumber, now);
              }

              inserted++;
              result.operationsInserted++;
              if (wasLinked) {
                linked++;
                result.operationsLinked++;
              }
            } catch (e: any) {
              if (e?.code === "ER_DUP_ENTRY" || e?.message?.includes("duplicate")) {
                duplicate++;
                result.operationsDuplicate++;
              } else {
                failed++;
                result.operationsFailed++;
                logStatus = "error";
                const opErr = `Op ${op.operationNumber}: ${e?.message ?? e}`;
                logError = logError ? `${logError}; ${opErr}` : opErr;
                result.errors.push(`[${messageId}] ${opErr}`);
              }
            }
          }

          const logValues = {
            status: logStatus,
            parsingStrategy: strategy,
            operationsDetected: ops.length,
            operationsInserted: inserted,
            operationsDuplicate: duplicate,
            operationsLinked: linked,
            operationsFailed: failed,
            errorMessage: logError,
          };

          if (existingLog && retryErrors) {
            await db
              .update(emailIngestionLogs)
              .set({ ...logValues, retryCount: (existingLog.retryCount ?? 0) + 1 })
              .where(eq(emailIngestionLogs.id, existingLog.id));
          } else {
            await db.insert(emailIngestionLogs).values({
              messageId,
              subject,
              sender: IMAP_ALLOWED_SENDER,
              receivedAt,
              retryCount: 0,
              ...logValues,
            });
          }

          result.messagesProcessed++;
        } catch (e: any) {
          const msg = `uid ${uid}: ${e?.message ?? e}`;
          result.errors.push(`[IMAP fetch error] ${msg}`);
          console.error("[EmailTPV] Error processing email:", msg);
        }
      }
    } finally {
      lock.release();
    }
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    result.errors.push(`IMAP connection failed: ${msg}`);
    console.error("[EmailTPV] IMAP connection error:", msg);
  } finally {
    isRunning = false;
    try {
      await client.logout();
    } catch {}
  }

  return result;
}

// ─── CRON + BOOT ─────────────────────────────────────────────────────────────

export function startEmailIngestionJob(): void {
  // Immediate run at boot (non-blocking — cron lock prevents double execution)
  setImmediate(() => {
    runEmailIngestion(false)
      .then((r) =>
        console.log(
          `[EmailTPV] Boot run — checked: ${r.messagesChecked}, inserted: ${r.operationsInserted}, linked: ${r.operationsLinked}`
        )
      )
      .catch((e) => console.error("[EmailTPV] Boot run error:", e));
  });

  // Cron every 5 minutes (auto-retry = false)
  cron.schedule("*/5 * * * *", async () => {
    try {
      const r = await runEmailIngestion(false);
      if (r.messagesChecked > 0 || r.errors.length > 0) {
        console.log(
          `[EmailTPV] Cron — checked: ${r.messagesChecked}, inserted: ${r.operationsInserted}, dupes: ${r.operationsDuplicate}, linked: ${r.operationsLinked}`
        );
      }
      if (r.errors.length > 0) console.warn("[EmailTPV] Cron errors:", r.errors);
    } catch (e) {
      console.error("[EmailTPV] Unexpected cron error:", e);
    }
  });

  console.log("[EmailTPV] Job scheduled (boot + every 5 min)");
}
