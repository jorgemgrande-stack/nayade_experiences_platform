import "dotenv/config";
import mysql from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
import { eq, like, or, and } from "drizzle-orm";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import cron from "node-cron";
import { cardTerminalOperations, emailIngestionLogs, reservations, quotes } from "../../drizzle/schema";

// ─── CONFIG ───────────────────────────────────────────────────────────────────

const IMAP_HOST = process.env.IMAP_TPV_HOST ?? "nayadeexperiences.es.correoseguro.dinaserver.com";
const IMAP_PORT = parseInt(process.env.IMAP_TPV_PORT ?? "993");
const IMAP_SECURE = (process.env.IMAP_TPV_SECURE ?? "true") === "true";
const IMAP_USER = process.env.IMAP_TPV_USER ?? "administracion@nayadeexperiences.es";
const IMAP_PASS = process.env.IMAP_TPV_PASS ?? "";
const IMAP_MAILBOX = process.env.IMAP_TPV_MAILBOX ?? "INBOX";
const IMAP_ALLOWED_SENDER = process.env.IMAP_TPV_ALLOWED_SENDER ?? "copia@ticket.comerciaglobalpay.com";

// ─── DB ───────────────────────────────────────────────────────────────────────

function makeDb() {
  const pool = mysql.createPool(process.env.DATABASE_URL!);
  return drizzle(pool);
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────

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

// ─── EMAIL PARSERS ────────────────────────────────────────────────────────────

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

/** Extracts a decimal amount like "25,00 EUR" or "25.00 EUR" → 25.00 */
function parseAmount(raw: string): number | null {
  const m = raw.replace(/\./g, "").replace(",", ".").match(/([\d.]+)/);
  return m ? parseFloat(m[1]) : null;
}

/** Parse individual ticket email: "Ticket electrónico Venta op. XXXXXX" */
function parseIndividualTicket(text: string): ParsedOperation | null {
  try {
    const opNumMatch = text.match(/op(?:eración|eracion)?\.\s*([A-Z0-9]+)/i)
      ?? text.match(/n[uú]mero de operaci[oó]n[:\s]+([A-Z0-9]+)/i);
    if (!opNumMatch) return null;
    const operationNumber = opNumMatch[1].trim();

    const amountMatch = text.match(/importe[:\s]+([\d.,]+)\s*EUR/i)
      ?? text.match(/([\d.,]+)\s*EUR/i);
    if (!amountMatch) return null;
    const amount = parseAmount(amountMatch[1]);
    if (amount === null || isNaN(amount)) return null;

    const dateMatch = text.match(/fecha[:\s]+(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/i)
      ?? text.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})\s+(\d{1,2}:\d{2})/);
    const timeMatch = text.match(/hora[:\s]+(\d{1,2}:\d{2})/i)
      ?? text.match(/(\d{1,2}:\d{2}:\d{2})/);

    let operationDatetime = new Date();
    if (dateMatch) {
      const [, d, m, y] = dateMatch;
      const year = y.length === 2 ? `20${y}` : y;
      const time = timeMatch ? timeMatch[1] : "00:00";
      operationDatetime = new Date(`${year}-${m.padStart(2, "0")}-${d.padStart(2, "0")}T${time.length === 5 ? time + ":00" : time}`);
    }

    const typeRaw = text.match(/tipo[:\s]+(venta|devoluc|anulaci)/i)?.[1]?.toLowerCase()
      ?? (text.match(/devoluci/i) ? "devoluci" : text.match(/anulaci/i) ? "anulaci" : "venta");
    const operationType: ParsedOperation["operationType"] =
      typeRaw.startsWith("devoluci") ? "DEVOLUCION"
      : typeRaw.startsWith("anulaci") ? "ANULACION"
      : "VENTA";

    const authMatch = text.match(/autorizaci[oó]n[:\s]+([A-Z0-9]+)/i)
      ?? text.match(/c[oó]d(?:igo)?\.\s*autorizaci[oó]n[:\s]+([A-Z0-9]+)/i);
    const authorizationCode = authMatch?.[1]?.trim() ?? null;

    const cardMatch = text.match(/tarjeta[:\s]+(\*{0,4}[\dX*]+)/i);
    const card = cardMatch?.[1]?.trim() ?? null;

    const commerceMatch = text.match(/comercio[:\s]+([A-Z0-9]+)/i)
      ?? text.match(/c[oó]digo comercio[:\s]+([A-Z0-9]+)/i);
    const commerceCode = commerceMatch?.[1]?.trim() ?? null;

    const terminalMatch = text.match(/terminal[:\s]+([A-Z0-9]+)/i)
      ?? text.match(/c[oó]digo terminal[:\s]+([A-Z0-9]+)/i);
    const terminalCode = terminalMatch?.[1]?.trim() ?? null;

    return {
      operationNumber,
      operationType,
      amount,
      operationDatetime,
      commerceCode,
      terminalCode,
      authorizationCode,
      card,
    };
  } catch {
    return null;
  }
}

/** Parse daily summary: "Ticket electrónico Día DD/M/YYYY" — multiple operations in one email */
function parseDailySummary(text: string): ParsedOperation[] {
  const ops: ParsedOperation[] = [];

  // Try to match blocks per operation in a summary table
  // Format varies but usually has rows like: N_OP | TYPE | AMOUNT | AUTH | CARD | DATETIME
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);

  for (const line of lines) {
    // Look for lines that contain a standalone operation reference
    const opMatch = line.match(/\b([0-9]{6,12})\b/);
    const amtMatch = line.match(/([\d.,]+)\s*EUR/i) ?? line.match(/\b([\d]{1,6}[.,]\d{2})\b/);
    if (!opMatch || !amtMatch) continue;
    const amount = parseAmount(amtMatch[1]);
    if (!amount || isNaN(amount) || amount <= 0) continue;

    const operationNumber = opMatch[1];
    const dateMatch = line.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
    const timeMatch = line.match(/(\d{1,2}:\d{2})/);

    let operationDatetime = new Date();
    if (dateMatch) {
      const [, d, m, y] = dateMatch;
      const year = y.length === 2 ? `20${y}` : y;
      const time = timeMatch ? timeMatch[1] : "00:00";
      operationDatetime = new Date(`${year}-${m.padStart(2, "0")}-${d.padStart(2, "0")}T${time}:00`);
    }

    const typeRaw = line.toLowerCase();
    const operationType: ParsedOperation["operationType"] =
      typeRaw.includes("devol") ? "DEVOLUCION"
      : typeRaw.includes("anul") ? "ANULACION"
      : "VENTA";

    ops.push({
      operationNumber,
      operationType,
      amount,
      operationDatetime,
      commerceCode: null,
      terminalCode: null,
      authorizationCode: null,
      card: null,
    });
  }

  return ops;
}

// ─── AUTO-LINK ─────────────────────────────────────────────────────────────────

async function tryAutoLink(
  db: ReturnType<typeof makeDb>,
  operationId: number,
  operationNumber: string,
  now: Date
): Promise<{ entityType: "reservation" | "quote"; entityId: number } | null> {
  const pattern = `%Nº operación TPV: ${operationNumber}%`;

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
    return { entityType: "reservation", entityId: res.id };
  }

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
    return { entityType: "quote", entityId: qt.id };
  }

  return null;
}

// ─── CORE INGESTION ───────────────────────────────────────────────────────────

export interface IngestionResult {
  messagesChecked: number;
  messagesProcessed: number;
  operationsInserted: number;
  operationsDuplicate: number;
  errors: string[];
}

export async function runEmailIngestion(): Promise<IngestionResult> {
  const result: IngestionResult = {
    messagesChecked: 0,
    messagesProcessed: 0,
    operationsInserted: 0,
    operationsDuplicate: 0,
    errors: [],
  };

  if (!IMAP_PASS) {
    result.errors.push("IMAP_TPV_PASS env var not set — skipping ingestion");
    console.warn("[EmailTPV] IMAP_TPV_PASS not set, skipping");
    return result;
  }

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
      const uids: number[] = [];
      for await (const msg of client.fetch({ seen: false }, { uid: true, envelope: true })) {
        const from = msg.envelope?.from?.[0]?.address ?? "";
        if (from.toLowerCase() !== IMAP_ALLOWED_SENDER.toLowerCase()) continue;
        uids.push(msg.uid);
      }

      result.messagesChecked = uids.length;

      for (const uid of uids) {
        const msgData = await client.fetchOne({ uid } as any, { source: true }, { uid: true }) as any;
        if (!msgData?.source) continue;

        const parsed = await simpleParser(msgData.source as Buffer);
        const messageId = parsed.messageId ?? `uid-${uid}`;
        const subject = parsed.subject ?? "";
        const sender = IMAP_ALLOWED_SENDER;
        const receivedAt = parsed.date ?? new Date();
        const bodyText = parsed.text ?? "";

        const existingLog = await db
          .select({ id: emailIngestionLogs.id })
          .from(emailIngestionLogs)
          .where(eq(emailIngestionLogs.messageId, messageId))
          .limit(1);
        if (existingLog.length > 0) {
          result.operationsDuplicate++;
          continue;
        }

        let ops: ParsedOperation[] = [];
        const subjectLower = subject.toLowerCase();
        if (subjectLower.includes("día") || subjectLower.includes("dia") || subjectLower.includes("resumen")) {
          ops = parseDailySummary(bodyText);
        } else {
          const single = parseIndividualTicket(bodyText);
          if (single) ops = [single];
        }

        let inserted = 0;
        let duplicate = 0;
        let logStatus: "ok" | "error" | "skipped" = ops.length === 0 ? "skipped" : "ok";
        let logError: string | null = null;

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

            if (newOp) {
              await tryAutoLink(db, newOp.id, op.operationNumber, new Date());
            }

            inserted++;
            result.operationsInserted++;
          } catch (e: any) {
            if (e?.code === "ER_DUP_ENTRY" || e?.message?.includes("duplicate")) {
              duplicate++;
              result.operationsDuplicate++;
            } else {
              logStatus = "error";
              logError = e?.message ?? String(e);
              result.errors.push(`Op ${op.operationNumber}: ${logError}`);
            }
          }
        }

        await db.insert(emailIngestionLogs).values({
          messageId,
          subject,
          sender,
          receivedAt,
          status: logStatus,
          operationsInserted: inserted,
          operationsDuplicate: duplicate,
          errorMessage: logError,
        });

        result.messagesProcessed++;
      }
    } finally {
      lock.release();
    }
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    result.errors.push(`IMAP connection error: ${msg}`);
    console.error("[EmailTPV] IMAP error:", msg);
  } finally {
    try { await client.logout(); } catch {}
  }

  return result;
}

// ─── CRON JOB ────────────────────────────────────────────────────────────────

export function startEmailIngestionJob(): void {
  cron.schedule("*/5 * * * *", async () => {
    console.log("[EmailTPV] Running scheduled email ingestion...");
    try {
      const result = await runEmailIngestion();
      console.log(
        `[EmailTPV] Done — checked: ${result.messagesChecked}, inserted: ${result.operationsInserted}, dupes: ${result.operationsDuplicate}`
      );
      if (result.errors.length > 0) {
        console.warn("[EmailTPV] Errors:", result.errors);
      }
    } catch (e) {
      console.error("[EmailTPV] Unexpected error in cron:", e);
    }
  });
  console.log("[EmailTPV] Email ingestion job scheduled (every 5 min)");
}
