/**
 * emailAccounts.ts — tRPC router para gestión de cuentas de email comercial.
 * CRUD + test de conexión IMAP/SMTP.
 */
import { z } from "zod";
import { staffProcedure, router } from "../_core/trpc";
import { ImapFlow } from "imapflow";
import nodemailer from "nodemailer";
import mysql from "mysql2/promise";
import { encryptPassword, decryptPassword } from "../utils/emailCrypto";

const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 2 });

// ─── Zod schemas ─────────────────────────────────────────────────────────────

const AccountInput = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email().max(320),
  imapHost: z.string().min(1).max(255),
  imapPort: z.number().int().min(1).max(65535).default(993),
  imapSecure: z.boolean().default(true),
  imapUser: z.string().min(1).max(320),
  imapPassword: z.string().min(1),
  smtpHost: z.string().min(1).max(255),
  smtpPort: z.number().int().min(1).max(65535).default(587),
  smtpSecure: z.boolean().default(false),
  smtpUser: z.string().min(1).max(320),
  smtpPassword: z.string().min(1),
  fromName: z.string().min(1).max(255),
  fromEmail: z.string().email().max(320),
  isDefault: z.boolean().default(false),
  syncEnabled: z.boolean().default(true),
  syncIntervalMinutes: z.number().int().min(1).max(60).default(5),
  folderInbox: z.string().max(100).default("INBOX"),
  folderSent: z.string().max(100).default("Sent"),
  folderArchive: z.string().max(100).default("Archive"),
  folderTrash: z.string().max(100).default("Trash"),
  maxEmailsPerSync: z.number().int().min(10).max(200).default(50),
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sanitizeAccount(row: any) {
  return {
    id: Number(row.id),
    name: row.name,
    email: row.email,
    imapHost: row.imap_host,
    imapPort: Number(row.imap_port),
    imapSecure: Boolean(row.imap_secure),
    imapUser: row.imap_user,
    smtpHost: row.smtp_host,
    smtpPort: Number(row.smtp_port),
    smtpSecure: Boolean(row.smtp_secure),
    smtpUser: row.smtp_user,
    fromName: row.from_name,
    fromEmail: row.from_email,
    isActive: Boolean(row.is_active),
    isDefault: Boolean(row.is_default),
    syncEnabled: Boolean(row.sync_enabled),
    syncIntervalMinutes: Number(row.sync_interval_min),
    lastSyncAt: row.last_sync_at ? new Date(row.last_sync_at) : null,
    lastSyncError: row.last_sync_error ?? null,
    folderInbox: row.folder_inbox,
    folderSent: row.folder_sent,
    folderArchive: row.folder_archive,
    folderTrash: row.folder_trash,
    maxEmailsPerSync: Number(row.max_emails_per_sync),
    createdAt: new Date(row.created_at),
  };
}

// ─── Router ───────────────────────────────────────────────────────────────────

export const emailAccountsRouter = router({
  // List all accounts (passwords never returned)
  list: staffProcedure.query(async () => {
    const [rows]: any = await _pool.execute(
      "SELECT * FROM email_accounts ORDER BY is_default DESC, created_at ASC",
    );
    return (rows as any[]).map(sanitizeAccount);
  }),

  // Create account
  create: staffProcedure
    .input(AccountInput)
    .mutation(async ({ input }) => {
      const imapEnc = encryptPassword(input.imapPassword);
      const smtpEnc = encryptPassword(input.smtpPassword);

      // If new account is default, unset others
      if (input.isDefault) {
        await _pool.execute("UPDATE email_accounts SET is_default = FALSE");
      }

      const [res]: any = await _pool.execute(
        `INSERT INTO email_accounts
          (name, email, imap_host, imap_port, imap_secure, imap_user, imap_password_enc,
           smtp_host, smtp_port, smtp_secure, smtp_user, smtp_password_enc,
           from_name, from_email, is_default, sync_enabled, sync_interval_min,
           folder_inbox, folder_sent, folder_archive, folder_trash, max_emails_per_sync)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          input.name, input.email,
          input.imapHost, input.imapPort, input.imapSecure, input.imapUser, imapEnc,
          input.smtpHost, input.smtpPort, input.smtpSecure, input.smtpUser, smtpEnc,
          input.fromName, input.fromEmail,
          input.isDefault, input.syncEnabled, input.syncIntervalMinutes,
          input.folderInbox, input.folderSent, input.folderArchive,
          input.folderTrash, input.maxEmailsPerSync,
        ],
      );
      return { ok: true, id: Number((res as any).insertId) };
    }),

  // Update account (password fields: empty string = keep existing)
  update: staffProcedure
    .input(AccountInput.extend({ id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const [existing]: any = await _pool.execute(
        "SELECT imap_password_enc, smtp_password_enc FROM email_accounts WHERE id = ? LIMIT 1",
        [input.id],
      );
      if (!(existing as any[]).length) throw new Error("Cuenta no encontrada");

      const imapEnc = input.imapPassword
        ? encryptPassword(input.imapPassword)
        : (existing as any[])[0].imap_password_enc;
      const smtpEnc = input.smtpPassword
        ? encryptPassword(input.smtpPassword)
        : (existing as any[])[0].smtp_password_enc;

      if (input.isDefault) {
        await _pool.execute(
          "UPDATE email_accounts SET is_default = FALSE WHERE id != ?",
          [input.id],
        );
      }

      await _pool.execute(
        `UPDATE email_accounts SET
          name=?, email=?, imap_host=?, imap_port=?, imap_secure=?, imap_user=?, imap_password_enc=?,
          smtp_host=?, smtp_port=?, smtp_secure=?, smtp_user=?, smtp_password_enc=?,
          from_name=?, from_email=?, is_default=?, sync_enabled=?, sync_interval_min=?,
          folder_inbox=?, folder_sent=?, folder_archive=?, folder_trash=?, max_emails_per_sync=?,
          updated_at=NOW()
         WHERE id=?`,
        [
          input.name, input.email,
          input.imapHost, input.imapPort, input.imapSecure, input.imapUser, imapEnc,
          input.smtpHost, input.smtpPort, input.smtpSecure, input.smtpUser, smtpEnc,
          input.fromName, input.fromEmail,
          input.isDefault, input.syncEnabled, input.syncIntervalMinutes,
          input.folderInbox, input.folderSent, input.folderArchive,
          input.folderTrash, input.maxEmailsPerSync,
          input.id,
        ],
      );
      return { ok: true };
    }),

  // Toggle active
  setActive: staffProcedure
    .input(z.object({ id: z.number().int().positive(), isActive: z.boolean() }))
    .mutation(async ({ input }) => {
      await _pool.execute(
        "UPDATE email_accounts SET is_active = ?, updated_at = NOW() WHERE id = ?",
        [input.isActive, input.id],
      );
      return { ok: true };
    }),

  // Delete account
  delete: staffProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      await _pool.execute("DELETE FROM email_accounts WHERE id = ?", [input.id]);
      return { ok: true };
    }),

  // Test IMAP connection
  testImap: staffProcedure
    .input(z.object({
      host: z.string().min(1),
      port: z.number().int(),
      secure: z.boolean(),
      user: z.string().min(1),
      password: z.string().min(1),
      folder: z.string().default("INBOX"),
    }))
    .mutation(async ({ input }) => {
      const client = new ImapFlow({
        host: input.host,
        port: input.port,
        secure: input.secure,
        auth: { user: input.user, pass: input.password },
        logger: false,
      });
      try {
        await client.connect();
        const lock = await client.getMailboxLock(input.folder);
        const status = await client.status(input.folder, { messages: true, unseen: true });
        lock.release();
        await client.logout();
        return {
          ok: true,
          message: `Conexión exitosa — ${status.messages ?? "?"} mensajes, ${status.unseen ?? "?"} no leídos`,
        };
      } catch (err: any) {
        try { await client.logout(); } catch {}
        return { ok: false, message: `Error IMAP: ${err.message}` };
      }
    }),

  // Test SMTP connection
  testSmtp: staffProcedure
    .input(z.object({
      host: z.string().min(1),
      port: z.number().int(),
      secure: z.boolean(),
      user: z.string().min(1),
      password: z.string().min(1),
    }))
    .mutation(async ({ input }) => {
      const transport = nodemailer.createTransport({
        host: input.host,
        port: input.port,
        secure: input.secure,
        auth: { user: input.user, pass: input.password },
        connectionTimeout: 8000,
        greetingTimeout: 8000,
      });
      try {
        await transport.verify();
        return { ok: true, message: "Conexión SMTP verificada correctamente" };
      } catch (err: any) {
        return { ok: false, message: `Error SMTP: ${err.message}` };
      }
    }),

  // Trigger manual sync
  syncNow: staffProcedure
    .input(z.object({ accountId: z.number().int().positive().optional() }))
    .mutation(async ({ input }) => {
      const { runCommercialEmailSync } = await import("../services/commercialEmailService");
      const result = await runCommercialEmailSync();
      return { ok: true, synced: result.synced, errors: result.errors };
    }),

  // ─── IMAP folder management ────────────────────────────────────────────────

  listFolders: staffProcedure
    .input(z.object({ accountId: z.number().int().positive() }))
    .query(async ({ input }) => {
      const [rows]: any = await _pool.execute(
        "SELECT * FROM email_accounts WHERE id = ? LIMIT 1",
        [input.accountId],
      );
      if (!(rows as any[]).length) throw new Error("Cuenta no encontrada");
      const { listImapFolders } = await import("../services/commercialEmailService");
      return await listImapFolders((rows as any[])[0]);
    }),

  createFolder: staffProcedure
    .input(z.object({
      accountId: z.number().int().positive(),
      path: z.string().min(1).max(200),
    }))
    .mutation(async ({ input }) => {
      const [rows]: any = await _pool.execute(
        "SELECT * FROM email_accounts WHERE id = ? LIMIT 1",
        [input.accountId],
      );
      if (!(rows as any[]).length) throw new Error("Cuenta no encontrada");
      const { createImapFolder } = await import("../services/commercialEmailService");
      await createImapFolder((rows as any[])[0], input.path);
      return { ok: true };
    }),

  deleteFolder: staffProcedure
    .input(z.object({
      accountId: z.number().int().positive(),
      path: z.string().min(1),
    }))
    .mutation(async ({ input }) => {
      const [rows]: any = await _pool.execute(
        "SELECT * FROM email_accounts WHERE id = ? LIMIT 1",
        [input.accountId],
      );
      if (!(rows as any[]).length) throw new Error("Cuenta no encontrada");
      const { deleteImapFolder } = await import("../services/commercialEmailService");
      await deleteImapFolder((rows as any[])[0], input.path);
      // Eliminar también los emails locales de esa carpeta
      await _pool.execute(
        "DELETE FROM commercial_emails WHERE account_id = ? AND folder = ?",
        [input.accountId, input.path],
      );
      return { ok: true };
    }),

  renameFolder: staffProcedure
    .input(z.object({
      accountId: z.number().int().positive(),
      oldPath: z.string().min(1),
      newPath: z.string().min(1).max(200),
    }))
    .mutation(async ({ input }) => {
      const [rows]: any = await _pool.execute(
        "SELECT * FROM email_accounts WHERE id = ? LIMIT 1",
        [input.accountId],
      );
      if (!(rows as any[]).length) throw new Error("Cuenta no encontrada");
      const { renameImapFolder } = await import("../services/commercialEmailService");
      await renameImapFolder((rows as any[])[0], input.oldPath, input.newPath);
      // Actualizar registros locales
      await _pool.execute(
        "UPDATE commercial_emails SET folder = ? WHERE account_id = ? AND folder = ?",
        [input.newPath, input.accountId, input.oldPath],
      );
      return { ok: true };
    }),
});
