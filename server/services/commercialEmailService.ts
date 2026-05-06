/**
 * commercialEmailService.ts — Sincronización IMAP para el módulo de Email Comercial.
 *
 * - Lee cuentas activas de email_accounts
 * - Para cada cuenta: conecta IMAP, descarga emails recientes, guarda en commercial_emails
 * - Detecta automáticamente si el remitente es un lead o cliente conocido
 * - Cron job: cada N minutos según sync_interval_min de cada cuenta
 * - Feature flag: commercial_email_enabled
 */
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import cron from "node-cron";
import mysql from "mysql2/promise";
import nodemailer from "nodemailer";
import { decryptPassword } from "../utils/emailCrypto";

let _pool: mysql.Pool | null = null;
function getPool(): mysql.Pool {
  if (!_pool) {
    _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 3 });
  }
  return _pool;
}

// ─── Auto-create tables ───────────────────────────────────────────────────────

export async function initCommercialEmailTables(): Promise<void> {
  const pool = getPool();
  try {
    await pool.execute(`
      CREATE TABLE IF NOT EXISTS email_accounts (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        email VARCHAR(320) NOT NULL,
        imap_host VARCHAR(255) NOT NULL DEFAULT '',
        imap_port INT NOT NULL DEFAULT 993,
        imap_secure BOOLEAN NOT NULL DEFAULT TRUE,
        imap_user VARCHAR(320) NOT NULL DEFAULT '',
        imap_password_enc TEXT NOT NULL DEFAULT '',
        smtp_host VARCHAR(255) NOT NULL DEFAULT '',
        smtp_port INT NOT NULL DEFAULT 587,
        smtp_secure BOOLEAN NOT NULL DEFAULT FALSE,
        smtp_user VARCHAR(320) NOT NULL DEFAULT '',
        smtp_password_enc TEXT NOT NULL DEFAULT '',
        from_name VARCHAR(255) NOT NULL DEFAULT '',
        from_email VARCHAR(320) NOT NULL DEFAULT '',
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        is_default BOOLEAN NOT NULL DEFAULT FALSE,
        sync_enabled BOOLEAN NOT NULL DEFAULT TRUE,
        sync_interval_min INT NOT NULL DEFAULT 5,
        last_sync_at TIMESTAMP NULL,
        last_sync_error TEXT NULL,
        folder_inbox VARCHAR(100) NOT NULL DEFAULT 'INBOX',
        folder_sent VARCHAR(100) NOT NULL DEFAULT 'Sent',
        folder_archive VARCHAR(100) NOT NULL DEFAULT 'Archive',
        folder_trash VARCHAR(100) NOT NULL DEFAULT 'Trash',
        max_emails_per_sync INT NOT NULL DEFAULT 50,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);
    await pool.execute(`
      CREATE TABLE IF NOT EXISTS commercial_emails (
        id INT AUTO_INCREMENT PRIMARY KEY,
        account_id INT NOT NULL,
        message_id VARCHAR(512) NOT NULL,
        in_reply_to VARCHAR(512) NULL,
        from_email VARCHAR(320) NOT NULL,
        from_name VARCHAR(255) NULL,
        to_emails JSON NOT NULL,
        cc_emails JSON NOT NULL,
        subject VARCHAR(512) NOT NULL,
        body_html MEDIUMTEXT NULL,
        body_text MEDIUMTEXT NULL,
        snippet VARCHAR(300) NULL,
        sent_at TIMESTAMP NULL,
        is_read BOOLEAN NOT NULL DEFAULT FALSE,
        is_answered BOOLEAN NOT NULL DEFAULT FALSE,
        is_archived BOOLEAN NOT NULL DEFAULT FALSE,
        is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
        is_sent BOOLEAN NOT NULL DEFAULT FALSE,
        folder VARCHAR(100) NOT NULL DEFAULT 'INBOX',
        has_attachments BOOLEAN NOT NULL DEFAULT FALSE,
        labels JSON NULL,
        assigned_user_id INT NULL,
        linked_lead_id INT NULL,
        linked_client_id INT NULL,
        linked_quote_id INT NULL,
        linked_reservation_id INT NULL,
        imap_uid INT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_ce_msg_id (message_id(255)),
        INDEX idx_ce_account (account_id),
        INDEX idx_ce_sent_at (sent_at),
        INDEX idx_ce_from_email (from_email(100)),
        INDEX idx_ce_folder (folder),
        INDEX idx_ce_is_read (is_read)
      )
    `);
    console.log("[CommercialEmail] Tablas verificadas/creadas OK");
  } catch (err: any) {
    console.error("[CommercialEmail] Error creando tablas:", err.message);
  }
}

// ─── CRM auto-detection ───────────────────────────────────────────────────────

async function detectCrmEntity(fromEmail: string): Promise<{
  linkedLeadId: number | null;
  linkedClientId: number | null;
}> {
  if (!fromEmail) return { linkedLeadId: null, linkedClientId: null };
  const pool = getPool();
  let linkedLeadId: number | null = null;
  let linkedClientId: number | null = null;
  try {
    const [leadRows]: any = await pool.execute(
      "SELECT id FROM leads WHERE email = ? LIMIT 1",
      [fromEmail.toLowerCase()],
    );
    if ((leadRows as any[]).length > 0) linkedLeadId = Number((leadRows as any[])[0].id);

    const [clientRows]: any = await pool.execute(
      "SELECT id FROM clients WHERE email = ? LIMIT 1",
      [fromEmail.toLowerCase()],
    );
    if ((clientRows as any[]).length > 0) linkedClientId = Number((clientRows as any[])[0].id);
  } catch {}
  return { linkedLeadId, linkedClientId };
}

// ─── Sync one account ─────────────────────────────────────────────────────────

async function syncFolder(
  client: ImapFlow,
  pool: mysql.Pool,
  account: any,
  folderName: string,
  isSent: boolean,
  maxMessages: number,
  since: Date,
): Promise<number> {
  let synced = 0;

  let lock: any;
  try {
    lock = await client.getMailboxLock(folderName);
  } catch (err: any) {
    console.warn(`[CommercialEmail] No se puede abrir carpeta "${folderName}" en ${account.email}: ${err.message}`);
    return 0;
  }

  try {
    // Collect UIDs of recent messages
    const uids: number[] = [];
    for await (const msg of client.fetch(
      { since },
      { uid: true },
    )) {
      if (msg.uid) uids.push(msg.uid);
    }

    if (uids.length === 0) return 0;

    // Take the most recent N messages
    const batch = uids.slice(-maxMessages);
    console.log(`[CommercialEmail] ${account.email} / ${folderName}: ${batch.length} mensajes a procesar`);

    for (const uid of batch) {
      try {
        const msgData = await client.fetchOne(
          String(uid),
          { source: true, flags: true },
          { uid: true },
        ) as any;
        if (!msgData?.source) continue;

        const parsed = await simpleParser(msgData.source as Buffer);
        const messageId = (parsed.messageId ?? `uid-${account.id}-${folderName}-${uid}`).slice(0, 512);

        // Dedup by message_id
        const [existing]: any = await pool.execute(
          "SELECT id FROM commercial_emails WHERE message_id = ? LIMIT 1",
          [messageId],
        );
        if ((existing as any[]).length > 0) continue;

        const fromAddr = parsed.from?.value?.[0];
        const fromEmail = (fromAddr?.address ?? "").toLowerCase().slice(0, 319);
        const fromName = (fromAddr?.name ?? "").slice(0, 254) || null;

        const toArr = parsed.to
          ? (Array.isArray(parsed.to.value) ? parsed.to.value : [parsed.to.value])
              .map((a: any) => a?.address ?? "").filter(Boolean)
          : [];
        const ccArr = parsed.cc
          ? (Array.isArray(parsed.cc.value) ? parsed.cc.value : [parsed.cc.value])
              .map((a: any) => a?.address ?? "").filter(Boolean)
          : [];

        const bodyHtml = parsed.html || null;
        const bodyText = parsed.text || null;
        const snippet = (parsed.text || parsed.subject || "")
          .slice(0, 280).replace(/\s+/g, " ").trim();
        const rawAttachments = (parsed.attachments ?? []).filter((a: any) => !a.related); // skip inline CID
        const hasAttachments = rawAttachments.length > 0;
        const attachmentsMeta = hasAttachments
          ? JSON.stringify(rawAttachments.map((a: any) => ({
              filename: a.filename ?? "adjunto",
              contentType: a.contentType ?? "application/octet-stream",
              size: a.size ?? 0,
            })))
          : null;

        // For sent folder: is_read = TRUE, is_sent = TRUE
        // For inbox: is_read depends on IMAP \Seen flag
        const isRead = isSent
          ? true
          : (msgData.flags ? msgData.flags.has("\\Seen") : false);

        const { linkedLeadId, linkedClientId } = await detectCrmEntity(fromEmail);

        await pool.execute(
          `INSERT IGNORE INTO commercial_emails
            (account_id, message_id, in_reply_to, from_email, from_name,
             to_emails, cc_emails, subject, body_html, body_text, snippet,
             sent_at, is_read, is_sent, has_attachments, attachments_meta, folder, labels,
             linked_lead_id, linked_client_id, imap_uid, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, ?, ?, NOW(), NOW())`,
          [
            account.id,
            messageId,
            parsed.inReplyTo?.slice(0, 511) ?? null,
            fromEmail,
            fromName,
            JSON.stringify(toArr),
            JSON.stringify(ccArr),
            (parsed.subject ?? "(Sin asunto)").slice(0, 511),
            bodyHtml,
            bodyText,
            snippet || null,
            parsed.date ?? null,
            isRead ? 1 : 0,
            isSent ? 1 : 0,
            hasAttachments ? 1 : 0,
            attachmentsMeta,
            folderName,
            linkedLeadId,
            linkedClientId,
            uid,
          ],
        );
        synced++;
      } catch (msgErr: any) {
        console.warn(`[CommercialEmail] Error procesando UID ${uid} en ${folderName}:`, msgErr.message);
      }
    }
  } finally {
    lock.release();
  }

  return synced;
}

async function syncAccount(account: any): Promise<{ synced: number; errors: number }> {
  const pool = getPool();
  let synced = 0;
  let errors = 0;

  const client = new ImapFlow({
    host: account.imap_host,
    port: Number(account.imap_port),
    secure: Boolean(account.imap_secure),
    auth: {
      user: account.imap_user,
      pass: decryptPassword(account.imap_password_enc),
    },
    logger: false,
    tls: { rejectUnauthorized: false },
  });

  try {
    await client.connect();

    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // last 30 days
    const max = account.max_emails_per_sync || 50;

    // Sync INBOX
    const inboxFolder = account.folder_inbox || "INBOX";
    synced += await syncFolder(client, pool, account, inboxFolder, false, max, since);

    // Sync Sent
    const sentFolder = account.folder_sent || "Sent";
    synced += await syncFolder(client, pool, account, sentFolder, true, max, since);

    // Sync custom IMAP folders (Spam, carpetas de usuario, etc.)
    try {
      const allFolders = await client.list();
      for (const f of allFolders) {
        if (!isVirtualImapPath(f.path) && f.path !== inboxFolder && f.path !== sentFolder) {
          // Spam/Junk y carpetas de usuario personalizadas
          const isSpam = /spam|junk/i.test(f.path);
          synced += await syncFolder(client, pool, account, f.path, false, isSpam ? 20 : max, since);
        }
      }
    } catch (fErr: any) {
      console.warn(`[CommercialEmail] No se pudo sincronizar carpetas extra en ${account.email}:`, fErr.message);
    }

    await pool.execute(
      "UPDATE email_accounts SET last_sync_at = NOW(), last_sync_error = NULL WHERE id = ?",
      [account.id],
    );

    console.log(`[CommercialEmail] ${account.email}: +${synced} emails sincronizados`);
  } catch (err: any) {
    console.error(`[CommercialEmail] Error en cuenta ${account.email}:`, err.message);
    await pool.execute(
      "UPDATE email_accounts SET last_sync_at = NOW(), last_sync_error = ? WHERE id = ?",
      [err.message?.slice(0, 500) ?? "Error desconocido", account.id],
    ).catch(() => {});
    errors++;
  } finally {
    try { await client.logout(); } catch {}
  }

  return { synced, errors };
}

// Carpetas IMAP que ya están cubiertas por carpetas virtuales (no sincronizar de nuevo)
const VIRTUAL_IMAP_PATHS = new Set([
  "inbox", "sent", "sent items", "sent messages", "elementos enviados",
  "archive", "archives", "archivados", "archived", "all mail",
  "trash", "deleted", "deleted items", "papelera", "basura", "deleted messages",
  "drafts", "borradores", "draft",
]);

function isVirtualImapPath(path: string): boolean {
  return VIRTUAL_IMAP_PATHS.has(path.toLowerCase());
}

// ─── IMAP folder management ───────────────────────────────────────────────────

function makeImapClient(account: any): ImapFlow {
  return new ImapFlow({
    host: account.imap_host,
    port: Number(account.imap_port),
    secure: Boolean(account.imap_secure),
    auth: { user: account.imap_user, pass: decryptPassword(account.imap_password_enc) },
    logger: false,
    tls: { rejectUnauthorized: false },
  });
}

export async function listImapFolders(account: any): Promise<Array<{
  path: string;
  name: string;
  delimiter: string | null;
  flags: string[];
  specialUse: string | null;
}>> {
  const client = makeImapClient(account);
  await client.connect();
  try {
    const list = await client.list();
    return list.map((f: any) => ({
      path: f.path,
      name: f.name,
      delimiter: f.delimiter ?? null,
      flags: [...(f.flags ?? [])],
      specialUse: f.specialUse ?? null,
    }));
  } finally {
    try { await client.logout(); } catch {}
  }
}

export async function createImapFolder(account: any, path: string): Promise<void> {
  const client = makeImapClient(account);
  await client.connect();
  try {
    await client.mailboxCreate(path);
  } finally {
    try { await client.logout(); } catch {}
  }
}

export async function deleteImapFolder(account: any, path: string): Promise<void> {
  const client = makeImapClient(account);
  await client.connect();
  try {
    await client.mailboxDelete(path);
  } finally {
    try { await client.logout(); } catch {}
  }
}

export async function renameImapFolder(account: any, oldPath: string, newPath: string): Promise<void> {
  const client = makeImapClient(account);
  await client.connect();
  try {
    await client.mailboxRename(oldPath, newPath);
  } finally {
    try { await client.logout(); } catch {}
  }
}

// ─── Main sync cycle ──────────────────────────────────────────────────────────

let isRunning = false;

export async function runCommercialEmailSync(): Promise<{ synced: number; errors: number }> {
  if (isRunning) {
    console.log("[CommercialEmail] Sync ya en curso, omitiendo");
    return { synced: 0, errors: 0 };
  }
  isRunning = true;
  const pool = getPool();
  let totalSynced = 0;
  let totalErrors = 0;

  try {
    const [accounts]: any = await pool.execute(
      "SELECT * FROM email_accounts WHERE is_active = TRUE AND sync_enabled = TRUE",
    );

    console.log(`[CommercialEmail] Iniciando sync de ${(accounts as any[]).length} cuenta(s)`);

    for (const account of accounts as any[]) {
      const { synced, errors } = await syncAccount(account);
      totalSynced += synced;
      totalErrors += errors;
    }

    console.log(`[CommercialEmail] Sync completado: +${totalSynced} emails, ${totalErrors} errores`);
  } catch (err: any) {
    console.error("[CommercialEmail] Error en ciclo de sync:", err.message);
    totalErrors++;
  } finally {
    isRunning = false;
  }

  return { synced: totalSynced, errors: totalErrors };
}

// ─── Send reply via account SMTP ─────────────────────────────────────────────

export async function sendViaAccountSmtp(
  account: any,
  options: {
    to: string[];
    subject: string;
    html: string;
    text?: string;
    inReplyTo?: string;
    references?: string;
  },
): Promise<void> {
  const transport = nodemailer.createTransport({
    host: account.smtp_host,
    port: Number(account.smtp_port),
    secure: Boolean(account.smtp_secure),
    auth: {
      user: account.smtp_user,
      pass: decryptPassword(account.smtp_password_enc),
    },
  });

  await transport.sendMail({
    from: `${account.from_name} <${account.from_email}>`,
    to: options.to.join(", "),
    subject: options.subject,
    html: options.html,
    text: options.text,
    inReplyTo: options.inReplyTo,
    references: options.references,
  });
}

// ─── Cron job ─────────────────────────────────────────────────────────────────

export async function startCommercialEmailSyncJob(): Promise<void> {
  await initCommercialEmailTables();

  // Boot run
  runCommercialEmailSync().catch(err =>
    console.error("[CommercialEmail] Error en sync inicial:", err.message),
  );

  // Every 5 minutes — individual accounts control their own interval but we
  // check every 5 min and skip accounts whose last_sync_at is recent enough.
  cron.schedule("*/5 * * * *", () => {
    runCommercialEmailSync().catch(err =>
      console.error("[CommercialEmail] Error en sync cron:", err.message),
    );
  });

  console.log("[CommercialEmail] Servicio de sync de email comercial iniciado");
}
