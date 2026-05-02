import "dotenv/config";
import mysql from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
import { eq, like, and, gte, lte, inArray, sql } from "drizzle-orm";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import cron from "node-cron";
import * as XLSX from "xlsx";
import {
  cardTerminalOperations,
  cardTerminalBatches,
  cardTerminalBatchOperations,
  emailIngestionLogs,
  reservations,
  quotes,
  tpvSales,
  bankMovements,
  bankFileImports,
} from "../../drizzle/schema";
import { madridStartOfDayUtc, madridEndOfDayUtc } from "../utils/timezone";

// CONFIG

const IMAP_HOST = process.env.IMAP_TPV_HOST ?? "nayadeexperiences.es.correoseguro.dinaserver.com";
const IMAP_PORT = parseInt(process.env.IMAP_TPV_PORT ?? "993");
const IMAP_SECURE = (process.env.IMAP_TPV_SECURE ?? "true") === "true";
const IMAP_USER = process.env.IMAP_TPV_USER ?? "administracion@nayadeexperiences.es";
const IMAP_PASS = process.env.IMAP_TPV_PASS ?? "";
const IMAP_MAILBOX = process.env.IMAP_TPV_MAILBOX ?? "INBOX";
const IMAP_ALLOWED_SENDER = process.env.IMAP_TPV_ALLOWED_SENDER ?? "copia@ticket.comerciaglobalpay.com";
const IMAP_BATCH_SIZE = parseInt(process.env.IMAP_TPV_BATCH_SIZE ?? "50");

// CONCURRENCY LOCK

let isRunning = false;

// DB

const _emailTpvPool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 3 });
const _emailTpvDb = drizzle(_emailTpvPool);

function makeDb() {
  return _emailTpvDb;
}

// TEXT NORMALIZATION
// Strips accents (NFD decompose + remove combining marks) so all patterns can use plain ASCII.
// Example: "Transacción" -> "TRANSACCION", "Número" -> "NUMERO"

function normalizeText(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip combining diacritics
    .toUpperCase()
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[​‌‍­﻿ ]/g, " ") // invisible/nbsp chars
    .replace(/ {2,}/g, " ")
    .trim();
}

/** Extract readable text from parsed email. Falls back to stripping HTML tags if no text/plain part. */
function getEmailText(parsed: { text?: string | null; html?: string | false | null }): string {
  if (parsed.text && parsed.text.trim().length > 10) return parsed.text;
  if (parsed.html && typeof parsed.html === "string") {
    return parsed.html
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n")
      .replace(/<\/li>/gi, "\n")
      .replace(/<\/tr>/gi, "\n")
      .replace(/<\/td>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&#\d+;/g, " ");
  }
  return "";
}

// HELPERS

function normalizeStr(s: string | null | undefined): string {
  return (s ?? "").trim().toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
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

// PARSER HELPERS
// All functions expect text already passed through normalizeText() — plain ASCII uppercase.

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

// Exact Comercia Global Payments format (verified from real email):
//   Transaccion: 193598
//   numero de operacion 193598  (in body text)
//   Op.: VENTA  (operation type, NOT the number)

function extractOperationNumber(text: string): string | null {
  const patterns = [
    /TRANSACCION[:\s]+(\d{4,12})/,           // Transaccion: 193598
    /NUMERO\s+DE\s+OPERACION[:\s]+(\d{4,12})/, // Numero de operacion 193598
    /N\.\s*OPERACION[:\s]+(\d{4,12})/,
    /OP\.\s*:\s*(\d{4,12})/,                  // Op.: 193598  (only when numeric)
    /OP\.\s+(\d{4,12})/,                       // Op. 193598
    /OPERACION[:\s.]+(\d{4,12})/,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m?.[1]) return m[1].trim();
  }
  return null;
}

function extractAmount(text: string): number | null {
  const patterns = [
    /IMPORTE[:\s]+([\d.,]+)\s*EUR/,
    /TOTAL[:\s]+([\d.,]+)\s*EUR/,
    /([\d.,]+)\s*EUR/,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (!m) continue;
    const raw = m[1].trim();
    // Spanish format 1.234,56 -> 1234.56  OR  plain 1,00 -> 1.00
    const cleaned = (raw.includes(",") && raw.includes("."))
      ? raw.replace(/\./g, "").replace(",", ".")
      : raw.replace(",", ".");
    const val = parseFloat(cleaned);
    if (!isNaN(val) && val > 0 && val < 1_000_000) return val;
  }
  return null;
}

function extractDate(text: string): Date | null {
  // Priority: date + time  — e.g. "FECHA: 24/04/2026 12:34"
  const withTime = text.match(/(\d{1,2})[/\-](\d{1,2})[/\-](\d{4})\s+(\d{1,2}:\d{2})/);
  if (withTime) {
    const [, d, mo, y, time] = withTime;
    const dt = new Date(`${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}T${time}:00`);
    if (!isNaN(dt.getTime())) return dt;
  }
  const dateOnly = text.match(/(\d{1,2})[/\-](\d{1,2})[/\-](\d{4})/);
  if (dateOnly) {
    const [, d, mo, y] = dateOnly;
    const dt = new Date(`${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}T00:00:00`);
    if (!isNaN(dt.getTime())) return dt;
  }
  return null;
}

function extractTerminal(text: string): string | null {
  const patterns = [
    /NUMERO\s+DE\s+TERMINAL[:\s]+(\d{5,})/, // Numero de terminal 01510839
    /TERMINAL[:\s]+(\d{5,})/,
    /COD(?:IGO)?\s*(?:DE\s*)?TERMINAL[:\s]+(\d{5,})/,
    /TPV[:\s]+(\d{5,})/,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m?.[1]) return m[1].trim();
  }
  return null;
}

function extractCommerce(text: string): string | null {
  const patterns = [
    /TPV\s+NAYADE\s+EXPERIENCES\s+(\d{5,})/, // TPV NAYADE EXPERIENCES 369471107
    /NAYADE\s+EXPERIENCES\s+(\d{5,})/,
    /COD(?:IGO)?\s*(?:DE\s*)?COMERCIO[:\s]+(\d{5,})/,
    /COMERCIO[:\s]+(\d{5,})/,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m?.[1]) return m[1].trim();
  }
  return null;
}

// Op.: VENTA / Op.: DEVOLUCION / Op.: ANULACION — read the explicit type field first
function extractOperationType(text: string): ParsedOperation["operationType"] {
  const explicit = text.match(/OP\.[:\s]+(VENTA|DEVOLUCION|ANULACION|OTRO)/);
  if (explicit) {
    const v = explicit[1];
    if (v === "DEVOLUCION") return "DEVOLUCION";
    if (v === "ANULACION") return "ANULACION";
    if (v === "OTRO") return "OTRO";
    return "VENTA";
  }
  if (/DEVOLUCION/.test(text)) return "DEVOLUCION";
  if (/ANULACION/.test(text)) return "ANULACION";
  return "VENTA";
}

// BATCH HELPERS

/** Extracts YYYY-MM-DD from normalized subject.
 *  Handles: "TICKET ELECTRONICO DIA 24/4/2026" and "LISTADO DE OPERACIONES 1/5/2026 19:23" */
function parseBatchDateFromSubject(subject: string): string | null {
  const m1 = subject.match(/DIA\s+(\d{1,2})[/](\d{1,2})[/](\d{4})/);
  if (m1) {
    const [, d, mo, y] = m1;
    return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  const m2 = subject.match(/OPERACIONES\s+(\d{1,2})[/](\d{1,2})[/](\d{4})/);
  if (m2) {
    const [, d, mo, y] = m2;
    return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  return null;
}

/** Parses VENTAS / DEVOLUCIONES totals from the normalized email body */
function parseSummaryTotals(text: string): { ventas: number; devoluciones: number } {
  let ventas = 0;
  let devoluciones = 0;
  const ventasM = text.match(/VENTAS\s+([\d.,]+)\s*EUR/);
  if (ventasM) {
    const raw = ventasM[1].includes(",") && ventasM[1].includes(".")
      ? ventasM[1].replace(/\./g, "").replace(",", ".")
      : ventasM[1].replace(",", ".");
    ventas = parseFloat(raw) || 0;
  }
  const devM = text.match(/DEVOLUCIONES\s+([\d.,]+)\s*EUR/);
  if (devM) {
    const raw = devM[1].includes(",") && devM[1].includes(".")
      ? devM[1].replace(/\./g, "").replace(",", ".")
      : devM[1].replace(",", ".");
    devoluciones = parseFloat(raw) || 0;
  }
  return { ventas, devoluciones };
}

async function createProvisionalBankMovement(
  db: ReturnType<typeof makeDb>,
  batchDate: string,
  totalNet: number,
  terminalCode: string | null,
): Promise<void> {
  if (totalNet <= 0) return;
  const dupKey = `tpv-prov-${batchDate}-${terminalCode ?? "ALL"}`;

  const [existing] = await db
    .select({ id: bankMovements.id })
    .from(bankMovements)
    .where(eq(bankMovements.duplicateKey, dupKey))
    .limit(1);
  if (existing) return;

  // T+1: estimated bank settlement date
  const d = new Date(batchDate + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + 1);
  const settlementDate = d.toISOString().slice(0, 10);

  const [importRes] = await db.insert(bankFileImports).values({
    fileName: `tpv-comercia-provisional-${batchDate}`,
    fileType: "tpv_email",
    importedRows: 1,
    duplicatesSkipped: 0,
    status: "ok",
  });
  const importId = (importRes as any).insertId as number;

  await db.insert(bankMovements).values({
    importId,
    fecha: settlementDate,
    fechaValor: settlementDate,
    movimiento: `Remesa TPV Comercia ${batchDate}`,
    masDatos: `Liquidacion automatica desde email Comercia. Fecha operaciones: ${batchDate}. Confirmar contra extracto bancario.`,
    importe: totalNet.toFixed(2),
    duplicateKey: dupKey,
    status: "pendiente",
    conciliationStatus: "pendiente",
    notes: `Provisional — generado automaticamente desde email Comercia del ${batchDate}.`,
  });
}

async function createBatchFromEmail(
  db: ReturnType<typeof makeDb>,
  opts: {
    batchDate: string;
    terminalCode: string | null;
    commerceCode: string | null;
    ventas: number;
    devoluciones: number;
    opIds: number[];
  }
): Promise<void> {
  if (opts.opIds.length === 0) return;
  const { batchDate, terminalCode, commerceCode, ventas, devoluciones, opIds } = opts;
  const totalNet = ventas - devoluciones;

  const existing = await db
    .select({ id: cardTerminalBatches.id })
    .from(cardTerminalBatches)
    .where(
      and(
        eq(cardTerminalBatches.batchDate, batchDate),
        terminalCode
          ? eq(cardTerminalBatches.terminalCode, terminalCode)
          : sql`${cardTerminalBatches.terminalCode} IS NULL`,
        commerceCode
          ? eq(cardTerminalBatches.commerceCode, commerceCode)
          : sql`${cardTerminalBatches.commerceCode} IS NULL`
      )
    )
    .limit(1);

  // Merge opIds from this email with ALL ops already in DB for this calendar day.
  // Prevents batches with partial counts when individual ticket emails arrived before the summary.
  const dayOps = await db
    .select({ id: cardTerminalOperations.id })
    .from(cardTerminalOperations)
    .where(and(
      gte(cardTerminalOperations.operationDatetime, madridStartOfDayUtc(batchDate)),
      lte(cardTerminalOperations.operationDatetime, madridEndOfDayUtc(batchDate)),
    ));
  const mergedOpIds = [...new Set([...opIds, ...dayOps.map(o => o.id)])];

  let batchId: number;
  if (existing.length > 0) {
    batchId = existing[0].id;
    // Update totals in case email was reprocessed with corrected data
    await db.update(cardTerminalBatches).set({
      totalSales: ventas.toFixed(2),
      totalRefunds: devoluciones.toFixed(2),
      totalNet: totalNet.toFixed(2),
      operationCount: mergedOpIds.length,
      linkedOperationsCount: mergedOpIds.length,
    }).where(eq(cardTerminalBatches.id, batchId));
  } else {
    const [res] = await db.insert(cardTerminalBatches).values({
      batchDate,
      terminalCode: terminalCode || null,
      commerceCode: commerceCode || null,
      currency: "EUR",
      totalSales: ventas.toFixed(2),
      totalRefunds: devoluciones.toFixed(2),
      totalNet: totalNet.toFixed(2),
      operationCount: mergedOpIds.length,
      linkedOperationsCount: mergedOpIds.length,
      status: "pending",
    });
    batchId = (res as any).insertId as number;
  }

  // Find which opIds are already linked to this batch
  const alreadyLinked = await db
    .select({ cardTerminalOperationId: cardTerminalBatchOperations.cardTerminalOperationId })
    .from(cardTerminalBatchOperations)
    .where(inArray(cardTerminalBatchOperations.cardTerminalOperationId, mergedOpIds));
  const linkedSet = new Set(alreadyLinked.map(r => r.cardTerminalOperationId));

  for (const opId of mergedOpIds) {
    if (linkedSet.has(opId)) continue;
    const [op] = await db
      .select({ amount: cardTerminalOperations.amount, operationType: cardTerminalOperations.operationType, status: cardTerminalOperations.status })
      .from(cardTerminalOperations)
      .where(eq(cardTerminalOperations.id, opId))
      .limit(1);
    if (!op) continue;
    try {
      await db.insert(cardTerminalBatchOperations).values({
        batchId,
        cardTerminalOperationId: opId,
        amount: String(op.amount),
        operationType: op.operationType,
      });
    } catch { /* duplicate — skip */ }
    // Only advance pendiente → included_in_batch; leave conciliado/settled untouched
    if (op.status === "pendiente") {
      await db.update(cardTerminalOperations)
        .set({ status: "included_in_batch" })
        .where(eq(cardTerminalOperations.id, opId));
    }
  }
}

// TEXT -> OPS

function parseTicketText(text: string): ParsedOperation | null {
  try {
    const operationNumber = extractOperationNumber(text);
    if (!operationNumber) return null;
    const amount = extractAmount(text);
    if (!amount) return null;

    const authMatch = text.match(/AUTORIZACION[:\s]+([A-Z0-9]{4,})/);
    const cardMatch = text.match(/(?:TARJETA|NUMERO DE TARJETA)[:\s]+([\*\dX]+)/);

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
  // Try full-text first in case it's a single-page PDF summary
  const single = parseTicketText(text);
  if (single) {
    ops.push(single);
  }
  // Then scan line by line for multi-operation summaries
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    const operationNumber = extractOperationNumber(line);
    if (!operationNumber) continue;
    if (ops.some((o) => o.operationNumber === operationNumber)) continue; // dedup
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

// FORMAT-SPECIFIC PARSERS

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
    const pdfModule = await import("pdf-parse");
    const pdfParse = (pdfModule as any).default ?? pdfModule;
    const data = await pdfParse(buf);
    return normalizeText(data.text ?? "");
  } catch (e) {
    console.warn("[EmailTPV] PDF extraction failed:", (e as any)?.message);
    return null;
  }
}

// EMAIL -> OPS DISPATCHER

async function extractOpsFromEmail(parsed: {
  text?: string | null;
  html?: string | false | null;
  attachments?: any[];
  subject?: string | null;
}): Promise<{ ops: ParsedOperation[]; strategy: ParsingStrategy }> {
  const attachments = parsed.attachments ?? [];
  const subject = normalizeText(parsed.subject ?? "");
  const isDailySummary = subject.includes("DIA") || subject.includes("RESUMEN") || subject.includes("LISTADO DE OPERACIONES");

  // 1. PDF attachment (priority)
  for (const att of attachments) {
    const isPdf =
      att.contentType === "application/pdf" ||
      (att.filename && /\.pdf$/i.test(att.filename));
    if (!isPdf) continue;
    const pdfText = await extractTextFromPdf(att.content as Buffer);
    if (!pdfText) continue;
    const ops = isDailySummary ? parseSummaryText(pdfText) : ([parseTicketText(pdfText)].filter(Boolean) as ParsedOperation[]);
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

  // 3. Email body (text/plain or stripped HTML)
  const rawText = getEmailText(parsed);
  const bodyText = normalizeText(rawText);
  const ops = isDailySummary
    ? parseSummaryText(bodyText)
    : ([parseTicketText(bodyText)].filter(Boolean) as ParsedOperation[]);
  return { ops, strategy: "body" };
}

// AUTO-LINK

async function tryAutoLink(
  db: ReturnType<typeof makeDb>,
  operationId: number,
  operationNumber: string,
  amount: number,
  operationDatetime: Date,
  now: Date
): Promise<boolean> {
  const pattern = `%Nº operación TPV: ${operationNumber}%`;

  // 1. Buscar en reservations.notes (aplica a pagos Redsys online)
  const [res] = await db
    .select({ id: reservations.id })
    .from(reservations)
    .where(like(reservations.notes, pattern))
    .limit(1);
  if (res) {
    await db.update(cardTerminalOperations).set({
      linkedEntityType: "reservation",
      linkedEntityId: res.id,
      linkedAt: now,
      linkedBy: "auto-email",
      status: "conciliado",
    }).where(eq(cardTerminalOperations.id, operationId));
    return true;
  }

  // 2. Buscar en quotes.notes
  const [qt] = await db
    .select({ id: quotes.id })
    .from(quotes)
    .where(like(quotes.notes, pattern))
    .limit(1);
  if (qt) {
    await db.update(cardTerminalOperations).set({
      linkedEntityType: "quote",
      linkedEntityId: qt.id,
      linkedAt: now,
      linkedBy: "auto-email",
      status: "conciliado",
    }).where(eq(cardTerminalOperations.id, operationId));
    return true;
  }

  // 3. Fallback: buscar en tpv_sales por importe + ventana [-2h, +30min]
  // Aplica a cobros del TPV físico donde tpv_sales ya sabe qué reserva es.
  const opMs = operationDatetime.getTime();
  const [sale] = await db
    .select({ id: tpvSales.id, reservationId: tpvSales.reservationId })
    .from(tpvSales)
    .where(and(
      eq(tpvSales.total, String(amount.toFixed(2))),
      gte(tpvSales.createdAt, opMs - 2 * 60 * 60 * 1000),
      lte(tpvSales.createdAt, opMs + 30 * 60 * 1000),
      eq(tpvSales.status, "paid"),
    ))
    .limit(1);
  if (sale && sale.reservationId != null) {
    await db.update(cardTerminalOperations).set({
      linkedEntityType: "reservation",
      linkedEntityId: sale.reservationId,
      linkedAt: now,
      linkedBy: "auto-email",
      status: "conciliado",
    }).where(eq(cardTerminalOperations.id, operationId));
    return true;
  }

  return false;
}

// RESULT TYPE

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

// CORE INGESTION

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
      // Search by date window instead of seen flag — DB messageId handles dedup.
      // This also catches emails already marked read externally (e.g. opened in Outlook).
      const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
      const uids: number[] = [];
      for await (const msg of client.fetch({ since }, { uid: true, envelope: true })) {
        const from = msg.envelope?.from?.[0]?.address ?? "";
        if (from.toLowerCase() !== IMAP_ALLOWED_SENDER.toLowerCase()) continue;
        uids.push(msg.uid);
      }

      // Newest IMAP_BATCH_SIZE emails (UIDs ascending = oldest first, slice from end = newest)
      const batch = uids.slice(-IMAP_BATCH_SIZE);
      result.messagesChecked = batch.length;

      for (const uid of batch) {
        try {
          const msgData = (await client.fetchOne(uid, { source: true }, { uid: true })) as any;
          if (!msgData?.source) continue;

          const parsed = await simpleParser(msgData.source as Buffer);
          const messageId = parsed.messageId ?? `uid-${uid}`;
          const subject = parsed.subject ?? "";
          const receivedAt = parsed.date ?? new Date();

          const [existingLog] = await db
            .select({
              id: emailIngestionLogs.id,
              status: emailIngestionLogs.status,
              retryCount: emailIngestionLogs.retryCount,
            })
            .from(emailIngestionLogs)
            .where(eq(emailIngestionLogs.messageId, messageId))
            .limit(1);

          // ok = always skip; error = skip on cron, allow on manual retry; skipped = re-try always
          if (existingLog?.status === "ok") continue;
          if (existingLog?.status === "error" && !retryErrors) continue;

          const { ops, strategy } = await extractOpsFromEmail({
            text: parsed.text,
            html: parsed.html,
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
          const allOpIds: number[] = []; // collect IDs of all ops (new + dup) for batch creation

          for (const op of ops) {
            const dupKey = makeDuplicateKey(
              op.commerceCode,
              op.terminalCode,
              op.operationNumber,
              op.amount,
              op.operationDatetime
            );
            try {
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
                allOpIds.push(newOp.id);
                wasLinked = await tryAutoLink(db, newOp.id, op.operationNumber, op.amount, op.operationDatetime, now);
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
                // Still need the existing op ID for batch linking
                try {
                  const [existingOp] = await db
                    .select({ id: cardTerminalOperations.id })
                    .from(cardTerminalOperations)
                    .where(eq(cardTerminalOperations.duplicateKey, dupKey))
                    .limit(1);
                  if (existingOp) allOpIds.push(existingOp.id);
                } catch { /* ignore */ }
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

          // Auto-create remesa for daily summary emails
          const normalizedSubject = normalizeText(subject);
          const isDailySummaryEmail = normalizedSubject.includes("DIA") || normalizedSubject.includes("RESUMEN") || normalizedSubject.includes("LISTADO DE OPERACIONES");
          if (isDailySummaryEmail && allOpIds.length > 0) {
            const batchDate = parseBatchDateFromSubject(normalizedSubject);
            if (batchDate) {
              const bodyText = normalizeText(getEmailText({ text: parsed.text, html: parsed.html }));
              const { ventas, devoluciones } = parseSummaryTotals(bodyText);
              const effectiveVentas      = ventas      > 0 ? ventas      : ops.filter(o => o.operationType === "VENTA").reduce((s, o) => s + o.amount, 0);
              const effectiveDevoluciones = devoluciones > 0 ? devoluciones : ops.filter(o => o.operationType === "DEVOLUCION").reduce((s, o) => s + o.amount, 0);
              const firstOp = ops[0];
              try {
                await createBatchFromEmail(db, {
                  batchDate,
                  terminalCode: firstOp?.terminalCode ?? null,
                  commerceCode: firstOp?.commerceCode ?? null,
                  ventas:       effectiveVentas,
                  devoluciones: effectiveDevoluciones,
                  opIds: allOpIds,
                });
                await createProvisionalBankMovement(
                  db,
                  batchDate,
                  effectiveVentas - effectiveDevoluciones,
                  firstOp?.terminalCode ?? null,
                );
              } catch (batchErr: any) {
                console.warn("[EmailTPV] Batch/provisional creation failed:", batchErr?.message);
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
          } else if (!existingLog) {
            await db.insert(emailIngestionLogs).values({
              messageId,
              subject,
              sender: IMAP_ALLOWED_SENDER,
              receivedAt,
              retryCount: 0,
              ...logValues,
            });
          }

          // Mark as seen so future runs don't re-fetch it (dedup via messageId is the real guard)
          await client.messageFlagsAdd(uid, ["\\Seen"], { uid: true });

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
    try { await client.logout(); } catch {}
  }

  return result;
}

// CRON + BOOT

export function startEmailIngestionJob(): void {
  setImmediate(() => {
    runEmailIngestion(false)
      .then((r) =>
        console.log(
          `[EmailTPV] Boot run — checked: ${r.messagesChecked}, inserted: ${r.operationsInserted}, linked: ${r.operationsLinked}`
        )
      )
      .catch((e) => console.error("[EmailTPV] Boot run error:", e));
  });

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

