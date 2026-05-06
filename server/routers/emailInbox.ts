/**
 * emailInbox.ts — tRPC router para el módulo de bandeja de Email Comercial.
 * List, get, mark read, archive, reply, send new.
 */
import { z } from "zod";
import { staffProcedure, router } from "../_core/trpc";
import mysql from "mysql2/promise";
import { sendViaAccountSmtp } from "../services/commercialEmailService";
import { randomBytes } from "crypto";

const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 3 });

function parseJsonField(val: any): any {
  if (!val) return [];
  if (typeof val === "string") {
    try { return JSON.parse(val); } catch { return []; }
  }
  return val;
}

function sanitizeEmail(row: any) {
  return {
    id: Number(row.id),
    accountId: Number(row.account_id),
    messageId: row.message_id,
    inReplyTo: row.in_reply_to ?? null,
    fromEmail: row.from_email,
    fromName: row.from_name ?? null,
    toEmails: parseJsonField(row.to_emails),
    ccEmails: parseJsonField(row.cc_emails),
    subject: row.subject,
    bodyHtml: row.body_html ?? null,
    bodyText: row.body_text ?? null,
    snippet: row.snippet ?? null,
    sentAt: row.sent_at ? new Date(row.sent_at) : null,
    isRead: Boolean(row.is_read),
    isAnswered: Boolean(row.is_answered),
    isArchived: Boolean(row.is_archived),
    isDeleted: Boolean(row.is_deleted),
    isSent: Boolean(row.is_sent),
    folder: row.folder,
    hasAttachments: Boolean(row.has_attachments),
    attachmentsMeta: parseJsonField(row.attachments_meta),
    imapUid: row.imap_uid ? Number(row.imap_uid) : null,
    labels: parseJsonField(row.labels),
    assignedUserId: row.assigned_user_id ? Number(row.assigned_user_id) : null,
    linkedLeadId: row.linked_lead_id ? Number(row.linked_lead_id) : null,
    linkedClientId: row.linked_client_id ? Number(row.linked_client_id) : null,
    linkedQuoteId: row.linked_quote_id ? Number(row.linked_quote_id) : null,
    linkedReservationId: row.linked_reservation_id ? Number(row.linked_reservation_id) : null,
    createdAt: new Date(row.created_at),
  };
}

export const emailInboxRouter = router({
  // ─── Stats (unread per folder) ────────────────────────────────────────────
  getStats: staffProcedure
    .input(z.object({ accountId: z.number().int().positive().optional() }))
    .query(async ({ input }) => {
      const where = input.accountId
        ? "WHERE account_id = ? AND is_deleted = FALSE"
        : "WHERE is_deleted = FALSE";
      const params = input.accountId ? [input.accountId] : [];
      const [rows]: any = await _pool.execute(
        `SELECT
           SUM(CASE WHEN is_archived = FALSE AND is_sent = FALSE AND is_read = FALSE THEN 1 ELSE 0 END) as unreadInbox,
           SUM(CASE WHEN is_archived = FALSE AND is_sent = FALSE THEN 1 ELSE 0 END) as totalInbox,
           SUM(CASE WHEN is_answered = FALSE AND is_sent = FALSE AND is_archived = FALSE AND is_read = TRUE THEN 1 ELSE 0 END) as pendingReply,
           SUM(CASE WHEN is_sent = TRUE THEN 1 ELSE 0 END) as sent,
           SUM(CASE WHEN is_archived = TRUE AND is_sent = FALSE THEN 1 ELSE 0 END) as archived,
           SUM(CASE WHEN is_sent = FALSE AND is_deleted = FALSE AND DATE(sent_at) = CURDATE() THEN 1 ELSE 0 END) as receivedToday
         FROM commercial_emails ${where}`,
        params,
      );
      const r = (rows as any[])[0] ?? {};
      return {
        unreadInbox: Number(r.unreadInbox ?? 0),
        totalInbox: Number(r.totalInbox ?? 0),
        pendingReply: Number(r.pendingReply ?? 0),
        sent: Number(r.sent ?? 0),
        archived: Number(r.archived ?? 0),
        receivedToday: Number(r.receivedToday ?? 0),
      };
    }),

  // ─── List emails ──────────────────────────────────────────────────────────
  listEmails: staffProcedure
    .input(z.object({
      folder: z.enum(["inbox", "sent", "archived", "deleted", "pending"]).default("inbox"),
      imapFolder: z.string().optional(), // carpeta IMAP real (ej: "Work", "Projects/Alpha")
      accountId: z.number().int().positive().optional(),
      search: z.string().optional(),
      onlyUnread: z.boolean().default(false),
      limit: z.number().int().min(1).max(200).default(50),
      offset: z.number().int().min(0).default(0),
    }))
    .query(async ({ input }) => {
      const conditions: string[] = ["is_deleted = FALSE"];
      const params: any[] = [];

      if (input.accountId) {
        conditions.push("account_id = ?");
        params.push(input.accountId);
      }

      if (input.imapFolder) {
        // Carpeta IMAP personalizada: filtra directamente por la columna folder
        conditions.push("folder = ?");
        params.push(input.imapFolder);
      } else {
        switch (input.folder) {
          case "inbox":
            conditions.push("is_archived = FALSE AND is_sent = FALSE");
            break;
          case "sent":
            conditions.push("is_sent = TRUE");
            break;
          case "archived":
            conditions.push("is_archived = TRUE AND is_sent = FALSE");
            break;
          case "deleted":
            conditions[0] = "is_deleted = TRUE";
            break;
          case "pending":
            conditions.push("is_answered = FALSE AND is_sent = FALSE AND is_archived = FALSE AND is_read = TRUE");
            break;
        }
      }

      if (input.onlyUnread) conditions.push("is_read = FALSE");

      if (input.search) {
        const s = `%${input.search.trim()}%`;
        conditions.push("(from_email LIKE ? OR from_name LIKE ? OR subject LIKE ? OR snippet LIKE ?)");
        params.push(s, s, s, s);
      }

      const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

      // LIMIT/OFFSET inlined as validated integers (mysql2 prepared statements
      // have a known issue with LIMIT ? in server-side prepared statements)
      const limit = Math.min(Math.max(1, input.limit), 200);
      const offset = Math.max(0, input.offset);

      const [rows]: any = await _pool.execute(
        `SELECT id, account_id, message_id, in_reply_to, from_email, from_name,
                to_emails, cc_emails, subject, snippet, sent_at,
                is_read, is_answered, is_archived, is_deleted, is_sent, folder,
                has_attachments, labels, linked_lead_id, linked_client_id,
                linked_quote_id, linked_reservation_id, created_at
         FROM commercial_emails ${where}
         ORDER BY sent_at DESC
         LIMIT ${limit} OFFSET ${offset}`,
        params,
      );

      const [countRows]: any = await _pool.execute(
        `SELECT COUNT(*) AS cnt FROM commercial_emails ${where}`,
        params,
      );

      return {
        rows: (rows as any[]).map(sanitizeEmail),
        total: Number((countRows as any[])[0]?.cnt ?? 0),
      };
    }),

  // ─── Get single email (with body) ────────────────────────────────────────
  getEmail: staffProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input }) => {
      const [rows]: any = await _pool.execute(
        "SELECT * FROM commercial_emails WHERE id = ? LIMIT 1",
        [input.id],
      );
      if (!(rows as any[]).length) return null;
      const email = sanitizeEmail((rows as any[])[0]);

      // Mark as read
      await _pool.execute(
        "UPDATE commercial_emails SET is_read = TRUE, updated_at = NOW() WHERE id = ?",
        [input.id],
      ).catch(() => {});

      // CRM context
      let lead: any = null;
      let client: any = null;
      if (email.linkedLeadId) {
        const [lr]: any = await _pool.execute(
          "SELECT id, name, email, phone, source, createdAt FROM leads WHERE id = ? LIMIT 1",
          [email.linkedLeadId],
        );
        lead = (lr as any[])[0] ?? null;
      }
      if (email.linkedClientId) {
        const [cr]: any = await _pool.execute(
          "SELECT id, name, email, phone FROM clients WHERE id = ? LIMIT 1",
          [email.linkedClientId],
        );
        client = (cr as any[])[0] ?? null;
      }

      return { ...email, crmLead: lead, crmClient: client };
    }),

  // ─── Mark read / unread ───────────────────────────────────────────────────
  markRead: staffProcedure
    .input(z.object({ id: z.number().int().positive(), isRead: z.boolean() }))
    .mutation(async ({ input }) => {
      await _pool.execute(
        "UPDATE commercial_emails SET is_read = ?, updated_at = NOW() WHERE id = ?",
        [input.isRead, input.id],
      );
      return { ok: true };
    }),

  // ─── Archive / unarchive ──────────────────────────────────────────────────
  archive: staffProcedure
    .input(z.object({ id: z.number().int().positive(), archived: z.boolean() }))
    .mutation(async ({ input }) => {
      await _pool.execute(
        "UPDATE commercial_emails SET is_archived = ?, updated_at = NOW() WHERE id = ?",
        [input.archived, input.id],
      );
      return { ok: true };
    }),

  // ─── Delete / restore ─────────────────────────────────────────────────────
  setDeleted: staffProcedure
    .input(z.object({ id: z.number().int().positive(), deleted: z.boolean() }))
    .mutation(async ({ input }) => {
      await _pool.execute(
        "UPDATE commercial_emails SET is_deleted = ?, updated_at = NOW() WHERE id = ?",
        [input.deleted, input.id],
      );
      return { ok: true };
    }),

  // ─── Reply to email ───────────────────────────────────────────────────────
  reply: staffProcedure
    .input(z.object({
      emailId: z.number().int().positive(),
      bodyHtml: z.string().min(1),
      bodyText: z.string().optional(),
      cc: z.array(z.string().email()).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const [rows]: any = await _pool.execute(
        "SELECT ce.*, ea.* FROM commercial_emails ce JOIN email_accounts ea ON ce.account_id = ea.id WHERE ce.id = ? LIMIT 1",
        [input.emailId],
      );
      if (!(rows as any[]).length) throw new Error("Email no encontrado");

      const row = (rows as any[])[0];
      const subject = row.subject?.startsWith("Re:") ? row.subject : `Re: ${row.subject}`;
      const toEmails = [row.from_email];

      await sendViaAccountSmtp(row, {
        to: toEmails,
        subject,
        html: input.bodyHtml,
        text: input.bodyText,
        inReplyTo: row.message_id,
        references: row.message_id,
      });

      // Store sent email in DB
      const msgId = `<sent-${randomBytes(16).toString("hex")}@nayade>`;
      await _pool.execute(
        `INSERT INTO commercial_emails
          (account_id, message_id, in_reply_to, from_email, from_name, to_emails, cc_emails,
           subject, body_html, body_text, snippet, sent_at, is_read, is_sent, folder, labels, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), TRUE, TRUE, 'Sent', '[]', NOW(), NOW())`,
        [
          row.account_id,
          msgId,
          row.message_id,
          row.from_email_account ?? row.from_email,
          row.from_name_account ?? row.from_name,
          JSON.stringify(toEmails),
          JSON.stringify(input.cc ?? []),
          subject,
          input.bodyHtml,
          input.bodyText ?? null,
          input.bodyText?.slice(0, 280) ?? null,
        ],
      );

      // Mark original as answered
      await _pool.execute(
        "UPDATE commercial_emails SET is_answered = TRUE, updated_at = NOW() WHERE id = ?",
        [input.emailId],
      );

      return { ok: true };
    }),

  // ─── Send new email ───────────────────────────────────────────────────────
  sendNew: staffProcedure
    .input(z.object({
      accountId: z.number().int().positive(),
      to: z.array(z.string().email()).min(1),
      cc: z.array(z.string().email()).default([]),
      subject: z.string().min(1).max(512),
      bodyHtml: z.string().min(1),
      bodyText: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const [accounts]: any = await _pool.execute(
        "SELECT * FROM email_accounts WHERE id = ? LIMIT 1",
        [input.accountId],
      );
      if (!(accounts as any[]).length) throw new Error("Cuenta no encontrada");
      const account = (accounts as any[])[0];

      await sendViaAccountSmtp(account, {
        to: input.to,
        subject: input.subject,
        html: input.bodyHtml,
        text: input.bodyText,
      });

      const msgId = `<sent-${randomBytes(16).toString("hex")}@nayade>`;
      await _pool.execute(
        `INSERT INTO commercial_emails
          (account_id, message_id, from_email, from_name, to_emails, cc_emails,
           subject, body_html, body_text, snippet, sent_at, is_read, is_sent, folder, labels, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), TRUE, TRUE, 'Sent', '[]', NOW(), NOW())`,
        [
          input.accountId,
          msgId,
          account.from_email,
          account.from_name,
          JSON.stringify(input.to),
          JSON.stringify(input.cc),
          input.subject,
          input.bodyHtml,
          input.bodyText ?? null,
          input.bodyText?.slice(0, 280) ?? null,
        ],
      );

      return { ok: true };
    }),

  // ─── Mark as answered (sin necesidad de responder) ───────────────────────
  markAnswered: staffProcedure
    .input(z.object({ id: z.number().int().positive(), answered: z.boolean() }))
    .mutation(async ({ input }) => {
      await _pool.execute(
        "UPDATE commercial_emails SET is_answered = ?, updated_at = NOW() WHERE id = ?",
        [input.answered, input.id],
      );
      return { ok: true };
    }),

  // ─── Bulk mark all pending as answered ────────────────────────────────────
  bulkMarkAnswered: staffProcedure
    .input(z.object({ accountId: z.number().int().positive().optional() }))
    .mutation(async ({ input }) => {
      const where = input.accountId
        ? "WHERE is_answered = FALSE AND is_sent = FALSE AND is_archived = FALSE AND is_read = TRUE AND account_id = ?"
        : "WHERE is_answered = FALSE AND is_sent = FALSE AND is_archived = FALSE AND is_read = TRUE";
      const params = input.accountId ? [input.accountId] : [];
      const [res]: any = await _pool.execute(
        `UPDATE commercial_emails SET is_answered = TRUE, updated_at = NOW() ${where}`,
        params,
      );
      return { ok: true, updated: (res as any).affectedRows ?? 0 };
    }),

  // ─── Move email to folder (local DB + best-effort IMAP) ──────────────────
  moveToFolder: staffProcedure
    .input(z.object({
      id: z.number().int().positive(),
      targetFolder: z.string().min(1), // IMAP folder path OR virtual: "archived"|"deleted"
    }))
    .mutation(async ({ input }) => {
      if (input.targetFolder === "archived") {
        await _pool.execute(
          "UPDATE commercial_emails SET is_archived = TRUE, updated_at = NOW() WHERE id = ?",
          [input.id],
        );
      } else if (input.targetFolder === "deleted") {
        await _pool.execute(
          "UPDATE commercial_emails SET is_deleted = TRUE, updated_at = NOW() WHERE id = ?",
          [input.id],
        );
      } else {
        // Custom IMAP folder: update folder column, clear archive/delete flags
        await _pool.execute(
          "UPDATE commercial_emails SET folder = ?, is_archived = FALSE, is_deleted = FALSE, updated_at = NOW() WHERE id = ?",
          [input.targetFolder, input.id],
        );
      }
      return { ok: true };
    }),

  // ─── Link to CRM entity ───────────────────────────────────────────────────
  linkCrm: staffProcedure
    .input(z.object({
      emailId: z.number().int().positive(),
      leadId: z.number().int().positive().nullable().optional(),
      clientId: z.number().int().positive().nullable().optional(),
      quoteId: z.number().int().positive().nullable().optional(),
      reservationId: z.number().int().positive().nullable().optional(),
    }))
    .mutation(async ({ input }) => {
      const sets: string[] = ["updated_at = NOW()"];
      const vals: any[] = [];
      if (input.leadId !== undefined) { sets.push("linked_lead_id = ?"); vals.push(input.leadId); }
      if (input.clientId !== undefined) { sets.push("linked_client_id = ?"); vals.push(input.clientId); }
      if (input.quoteId !== undefined) { sets.push("linked_quote_id = ?"); vals.push(input.quoteId); }
      if (input.reservationId !== undefined) { sets.push("linked_reservation_id = ?"); vals.push(input.reservationId); }
      await _pool.execute(
        `UPDATE commercial_emails SET ${sets.join(", ")} WHERE id = ?`,
        [...vals, input.emailId],
      );
      return { ok: true };
    }),
});
