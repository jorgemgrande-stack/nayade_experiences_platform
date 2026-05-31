/**
 * Router: Notifications feed (campana del AdminLayout).
 *
 * Un solo endpoint `feed` agrega 6 fuentes de alertas para el admin/agente,
 * excluyendo los items que el usuario ha silenciado con `dismiss`. Cada
 * sección viene con su severidad, CTA y un máximo de 5 items de muestra.
 *
 * Fuentes:
 *   - lead                  → leads opportunityStatus='nueva' sin contacto >3d
 *                              y sin ruido GHL (noreply@*, "Contacto GHL", etc.)
 *   - quote                 → quotes status='enviado' enviadas hace >48h
 *   - cancellation          → cancellation_requests en estado pending
 *   - pending_payment       → pendingPayments status='pending' con dueDate vencida
 *   - tpv_alert             → 4 sub-tipos críticos de cardTerminalBatches/operations
 *   - upcoming_reservation  → reservas confirmadas (paid) con bookingDate=mañana
 *
 * Dismiss es por-usuario: silenciar un item afecta solo a quien lo silencia.
 */

import { z } from "zod";
import { router, staffProcedure } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { and, desc, eq, gte, isNull, lte, or, sql, inArray, not, lt } from "drizzle-orm";
import {
  leads,
  quotes,
  cancellationRequests,
  pendingPayments,
  reservations,
  cardTerminalBatches,
  cardTerminalOperations,
  bankMovements,
  adminNotificationDismissals,
} from "../../drizzle/schema";

const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 1 });
const db = drizzle(_pool);

// ─── Tipos del feed ─────────────────────────────────────────────────────────

type Severity = "info" | "warning" | "critical";

type FeedKind =
  | "lead"
  | "quote"
  | "cancellation"
  | "pending_payment"
  | "tpv_alert"
  | "upcoming_reservation";

interface FeedItem {
  kind: FeedKind;
  entityId: number;          // id de la entidad real (o sintético para tpv_alert)
  title: string;             // p.ej. nombre del cliente
  subtitle: string | null;   // p.ej. email · fecha
  amount: number | null;     // €, si aplica
  severity: Severity;
  ctaPath: string;           // a dónde lleva el click
  createdAtMs: number;       // para ordenar
}

interface FeedSection {
  kind: FeedKind;
  label: string;
  icon: string;              // emoji corto para no acoplar a iconos
  severity: Severity;
  total: number;             // # items NO silenciados
  items: FeedItem[];         // sample (máx 5)
  ctaAllPath: string;        // "ver todos"
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const STALE_QUOTE_DAYS = 2;
const STALE_LEAD_DAYS = 3;
const NOISE_EMAIL_PATTERNS = ["noreply@%"];

function todayYmd(): string {
  return new Date().toISOString().slice(0, 10);
}
function tomorrowYmd(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}
function msAgoMs(days: number): number {
  return Date.now() - days * 24 * 60 * 60 * 1000;
}
function dateAgoYmd(days: number): string {
  const d = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

async function getDismissedIds(userId: number, kind: FeedKind): Promise<Set<number>> {
  const rows = await db
    .select({ entityId: adminNotificationDismissals.entityId })
    .from(adminNotificationDismissals)
    .where(and(
      eq(adminNotificationDismissals.userId, userId),
      eq(adminNotificationDismissals.kind, kind),
    ));
  return new Set(rows.map(r => r.entityId));
}

// ─── Sources ────────────────────────────────────────────────────────────────

async function sourceLeads(userId: number): Promise<FeedSection> {
  const dismissed = await getDismissedIds(userId, "lead");
  const staleThresholdMs = msAgoMs(STALE_LEAD_DAYS);

  // Excluir ruido GHL: email noreply@*, sin email + nombre que arranca por "Contacto"
  // Esta query devuelve todos los candidatos; filtramos en memoria los dismissed.
  const rows = await db
    .select({
      id: leads.id,
      name: leads.name,
      email: leads.email,
      budget: leads.budget,
      createdAt: leads.createdAt,
    })
    .from(leads)
    .where(and(
      eq(leads.opportunityStatus, "nueva"),
      or(
        isNull(leads.lastContactAt),
        sql`UNIX_TIMESTAMP(${leads.lastContactAt}) * 1000 < ${staleThresholdMs}`,
      ),
      // Anti-ruido: descartar contactos GHL auto-creados sin interacción real.
      sql`(${leads.email} IS NULL OR ${leads.email} NOT LIKE 'noreply@%')`,
      sql`(${leads.name} IS NULL OR ${leads.name} NOT LIKE 'Contacto GHL%')`,
    ))
    .orderBy(desc(leads.createdAt));

  const filtered = rows.filter(r => !dismissed.has(r.id));
  const items: FeedItem[] = filtered.slice(0, 5).map(r => ({
    kind: "lead" as const,
    entityId: r.id,
    title: r.name ?? "(sin nombre)",
    subtitle: r.email ?? null,
    amount: r.budget ? Number(r.budget) : null,
    severity: "warning" as const,
    ctaPath: `/admin/crm?tab=leads`,
    createdAtMs: r.createdAt ? r.createdAt.getTime() : 0,
  }));

  return {
    kind: "lead",
    label: "Leads sin atender",
    icon: "👤",
    severity: filtered.length > 0 ? "warning" : "info",
    total: filtered.length,
    items,
    ctaAllPath: "/admin/crm?tab=leads",
  };
}

async function sourceQuotes(userId: number): Promise<FeedSection> {
  const dismissed = await getDismissedIds(userId, "quote");
  const staleThresholdMs = msAgoMs(STALE_QUOTE_DAYS);

  // quotes no tiene clientName; viene del lead vinculado via leadId.
  const rows = await db
    .select({
      id: quotes.id,
      quoteNumber: quotes.quoteNumber,
      title: quotes.title,
      total: quotes.total,
      sentAt: quotes.sentAt,
      clientName: leads.name,
    })
    .from(quotes)
    .leftJoin(leads, eq(quotes.leadId, leads.id))
    .where(and(
      eq(quotes.status, "enviado"),
      sql`${quotes.sentAt} IS NOT NULL`,
      sql`UNIX_TIMESTAMP(${quotes.sentAt}) * 1000 < ${staleThresholdMs}`,
    ))
    .orderBy(desc(quotes.sentAt));

  const filtered = rows.filter(r => !dismissed.has(r.id));
  const items: FeedItem[] = filtered.slice(0, 5).map(r => ({
    kind: "quote" as const,
    entityId: r.id,
    title: r.clientName ?? r.title ?? "(sin cliente)",
    subtitle: r.quoteNumber ?? null,
    amount: r.total ? Number(r.total) : null,
    severity: "warning" as const,
    ctaPath: `/admin/crm?tab=quotes`,
    createdAtMs: r.sentAt ? r.sentAt.getTime() : 0,
  }));

  return {
    kind: "quote",
    label: `Presupuestos sin respuesta (>${STALE_QUOTE_DAYS}d)`,
    icon: "📄",
    severity: filtered.length > 0 ? "warning" : "info",
    total: filtered.length,
    items,
    ctaAllPath: "/admin/crm?tab=quotes",
  };
}

async function sourceCancellations(userId: number): Promise<FeedSection> {
  const dismissed = await getDismissedIds(userId, "cancellation");

  const rows = await db
    .select({
      id: cancellationRequests.id,
      fullName: cancellationRequests.fullName,
      locator: cancellationRequests.locator,
      refundableAmount: cancellationRequests.refundableAmount,
      activityDate: cancellationRequests.activityDate,
      createdAt: cancellationRequests.createdAt,
    })
    .from(cancellationRequests)
    .where(inArray(cancellationRequests.operationalStatus, [
      "recibida", "en_revision", "pendiente_documentacion", "pendiente_decision",
    ] as any))
    .orderBy(desc(cancellationRequests.createdAt));

  const filtered = rows.filter(r => !dismissed.has(r.id));
  const items: FeedItem[] = filtered.slice(0, 5).map(r => ({
    kind: "cancellation" as const,
    entityId: r.id,
    title: r.fullName ?? `#${r.id}`,
    subtitle: r.locator ?? r.activityDate ?? null,
    amount: r.refundableAmount ? Number(r.refundableAmount) : null,
    severity: "warning" as const,
    ctaPath: `/admin/crm?tab=anulaciones`,
    createdAtMs: r.createdAt ? r.createdAt.getTime() : 0,
  }));

  return {
    kind: "cancellation",
    label: "Anulaciones pendientes",
    icon: "⚠️",
    severity: filtered.length > 0 ? "critical" : "info",
    total: filtered.length,
    items,
    ctaAllPath: "/admin/crm?tab=anulaciones",
  };
}

async function sourcePendingPayments(userId: number): Promise<FeedSection> {
  const dismissed = await getDismissedIds(userId, "pending_payment");
  const today = todayYmd();

  const rows = await db
    .select({
      id: pendingPayments.id,
      clientName: pendingPayments.clientName,
      productName: pendingPayments.productName,
      amountCents: pendingPayments.amountCents,
      dueDate: pendingPayments.dueDate,
      createdAt: pendingPayments.createdAt,
    })
    .from(pendingPayments)
    .where(and(
      eq(pendingPayments.status, "pending"),
      lt(pendingPayments.dueDate, today),
    ))
    .orderBy(pendingPayments.dueDate);

  const filtered = rows.filter(r => !dismissed.has(r.id));
  const items: FeedItem[] = filtered.slice(0, 5).map(r => ({
    kind: "pending_payment" as const,
    entityId: r.id,
    title: r.clientName ?? "(sin cliente)",
    subtitle: `${r.productName ?? ""} · vence ${r.dueDate}`.trim(),
    amount: r.amountCents ? r.amountCents / 100 : null,
    severity: "critical" as const,
    ctaPath: `/admin/crm?tab=pagos_pendientes`,
    createdAtMs: Number(r.createdAt) || 0,
  }));

  return {
    kind: "pending_payment",
    label: "Pagos pendientes vencidos",
    icon: "💸",
    severity: filtered.length > 0 ? "critical" : "info",
    total: filtered.length,
    items,
    ctaAllPath: "/admin/crm?tab=pagos_pendientes",
  };
}

// Alertas TPV (4 KPIs agregados) — usan entityId sintético (-1..-4) porque
// no corresponden a una sola entidad concreta. El dismiss silencia el sub-tipo
// hasta que vuelva a aparecer nuevas filas que lo activen.
const TPV_ALERT_KEYS = [
  { entityId: -1, key: "stale_batches",     label: "Lotes TPV >2d sin conciliar",     icon: "⏱️" },
  { entityId: -2, key: "difference_batches",label: "Lotes TPV con diferencia",        icon: "⚖️" },
  { entityId: -3, key: "stale_movements",   label: "Movimientos banco >2d sin casar", icon: "🏦" },
  { entityId: -4, key: "unlinked_ops",      label: "Operaciones TPV sin vincular",    icon: "🔗" },
] as const;

async function sourceTpvAlerts(userId: number): Promise<FeedSection> {
  const dismissed = await getDismissedIds(userId, "tpv_alert");
  const twoDaysAgo = dateAgoYmd(2);

  const [staleBatches, differenceBatches, staleMovements, unlinkedOps] = await Promise.all([
    db.select({ cnt: sql<number>`COUNT(*)` }).from(cardTerminalBatches)
      .where(and(
        sql`${cardTerminalBatches.status} IN ('pending','suggested','auto_ready','review_required')`,
        lte(cardTerminalBatches.batchDate, twoDaysAgo),
      )),
    db.select({ cnt: sql<number>`COUNT(*)` }).from(cardTerminalBatches)
      .where(eq(cardTerminalBatches.status, "difference")),
    db.select({ cnt: sql<number>`COUNT(*)` }).from(bankMovements)
      .where(and(
        sql`CAST(${bankMovements.importe} AS DECIMAL(12,2)) > 0`,
        eq(bankMovements.conciliationStatus, "pendiente"),
        eq(bankMovements.status, "pendiente"),
        lte(bankMovements.fecha, twoDaysAgo),
      )),
    db.select({ cnt: sql<number>`COUNT(*)` }).from(cardTerminalOperations)
      .where(sql`${cardTerminalOperations.linkedEntityId} IS NULL AND ${cardTerminalOperations.status} NOT IN ('ignorado','incidencia','included_in_batch','settled')`),
  ]);

  const counts: Record<string, number> = {
    stale_batches:      Number(staleBatches[0]?.cnt ?? 0),
    difference_batches: Number(differenceBatches[0]?.cnt ?? 0),
    stale_movements:    Number(staleMovements[0]?.cnt ?? 0),
    unlinked_ops:       Number(unlinkedOps[0]?.cnt ?? 0),
  };

  const items: FeedItem[] = TPV_ALERT_KEYS
    .filter(k => counts[k.key] > 0 && !dismissed.has(k.entityId))
    .map(k => ({
      kind: "tpv_alert" as const,
      entityId: k.entityId,
      title: k.label,
      subtitle: `${counts[k.key]} ${counts[k.key] === 1 ? "elemento" : "elementos"}`,
      amount: null,
      severity: "critical" as const,
      ctaPath: "/admin/contabilidad/operaciones-tpv",
      createdAtMs: Date.now(),
    }));

  return {
    kind: "tpv_alert",
    label: "Conciliación TPV crítica",
    icon: "🖥️",
    severity: items.length > 0 ? "critical" : "info",
    total: items.length,
    items,
    ctaAllPath: "/admin/contabilidad/operaciones-tpv",
  };
}

async function sourceUpcomingReservations(userId: number): Promise<FeedSection> {
  const dismissed = await getDismissedIds(userId, "upcoming_reservation");
  const tomorrow = tomorrowYmd();

  const rows = await db
    .select({
      id: reservations.id,
      reservationNumber: reservations.reservationNumber,
      customerName: reservations.customerName,
      productName: reservations.productName,
      people: reservations.people,
      bookingDate: reservations.bookingDate,
      createdAt: reservations.createdAt,
    })
    .from(reservations)
    .where(and(
      eq(reservations.status, "paid"),
      eq(reservations.bookingDate, tomorrow),
    ))
    .orderBy(reservations.createdAt);

  const filtered = rows.filter(r => !dismissed.has(r.id));
  const items: FeedItem[] = filtered.slice(0, 5).map(r => ({
    kind: "upcoming_reservation" as const,
    entityId: r.id,
    title: r.customerName ?? r.reservationNumber ?? `#${r.id}`,
    subtitle: `${r.productName ?? ""} · ${r.people ?? 1} pax`,
    amount: null,
    severity: "info" as const,
    ctaPath: `/admin/crm?tab=reservations`,
    createdAtMs: Number(r.createdAt) || 0,
  }));

  return {
    kind: "upcoming_reservation",
    label: "Reservas mañana",
    icon: "📅",
    severity: "info",
    total: filtered.length,
    items,
    ctaAllPath: "/admin/crm?tab=reservations",
  };
}

// ─── Router ─────────────────────────────────────────────────────────────────

export const notificationsRouter = router({
  /**
   * Feed agregado. Devuelve las 6 secciones en orden de severidad.
   * Polling recomendado: cada 60s.
   */
  feed: staffProcedure.query(async ({ ctx }) => {
    const userId = ctx.user.id;
    const [
      sLeads, sQuotes, sCancellations, sPending, sTpv, sUpcoming,
    ] = await Promise.all([
      sourceLeads(userId),
      sourceQuotes(userId),
      sourceCancellations(userId),
      sourcePendingPayments(userId),
      sourceTpvAlerts(userId),
      sourceUpcomingReservations(userId),
    ]);

    const sections: FeedSection[] = [
      sCancellations,  // critical primero
      sPending,
      sTpv,
      sLeads,
      sQuotes,
      sUpcoming,       // info al final (no es alerta)
    ];

    // Total cuenta las secciones "actionable" (excluye upcoming_reservation,
    // que es solo informativa).
    const totalAlerts = sections
      .filter(s => s.kind !== "upcoming_reservation")
      .reduce((sum, s) => sum + s.total, 0);

    return { sections, totalAlerts };
  }),

  /** Silencia un item concreto para este usuario. Idempotente. */
  dismiss: staffProcedure
    .input(z.object({
      kind: z.enum([
        "lead", "quote", "cancellation", "pending_payment", "tpv_alert", "upcoming_reservation",
      ]),
      entityId: z.number().int(),
    }))
    .mutation(async ({ input, ctx }) => {
      // INSERT IGNORE-equivalent vía ON DUPLICATE KEY UPDATE no-op
      await db.execute(sql`
        INSERT INTO admin_notification_dismissals (user_id, kind, entity_id, dismissed_at)
        VALUES (${ctx.user.id}, ${input.kind}, ${input.entityId}, ${Date.now()})
        ON DUPLICATE KEY UPDATE dismissed_at = VALUES(dismissed_at)
      `);
      return { ok: true };
    }),

  /** Silencia todos los items actuales de una sección para este usuario. */
  dismissAll: staffProcedure
    .input(z.object({
      kind: z.enum([
        "lead", "quote", "cancellation", "pending_payment", "tpv_alert", "upcoming_reservation",
      ]),
    }))
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.user.id;
      // Recolectar entityIds vigentes de la sección y dismiss-arlos todos.
      let entityIds: number[] = [];
      if (input.kind === "lead") {
        const s = await sourceLeads(userId);
        entityIds = s.items.map(i => i.entityId);
        // Si la sección tiene más de 5 items, también dismiss los no-mostrados.
        if (s.total > entityIds.length) {
          const rows = await db.select({ id: leads.id }).from(leads)
            .where(eq(leads.opportunityStatus, "nueva"));
          entityIds = rows.map(r => r.id);
        }
      } else if (input.kind === "quote") {
        const rows = await db.select({ id: quotes.id }).from(quotes)
          .where(eq(quotes.status, "enviado"));
        entityIds = rows.map(r => r.id);
      } else if (input.kind === "cancellation") {
        const rows = await db.select({ id: cancellationRequests.id }).from(cancellationRequests)
          .where(inArray(cancellationRequests.operationalStatus, [
            "recibida", "en_revision", "pendiente_documentacion", "pendiente_decision",
          ] as any));
        entityIds = rows.map(r => r.id);
      } else if (input.kind === "pending_payment") {
        const rows = await db.select({ id: pendingPayments.id }).from(pendingPayments)
          .where(eq(pendingPayments.status, "pending"));
        entityIds = rows.map(r => r.id);
      } else if (input.kind === "tpv_alert") {
        entityIds = TPV_ALERT_KEYS.map(k => k.entityId);
      } else if (input.kind === "upcoming_reservation") {
        const rows = await db.select({ id: reservations.id }).from(reservations)
          .where(eq(reservations.bookingDate, tomorrowYmd()));
        entityIds = rows.map(r => r.id);
      }

      if (entityIds.length === 0) return { ok: true, dismissed: 0 };

      // Batch insert con ON DUPLICATE KEY UPDATE.
      const now = Date.now();
      const values = entityIds.map(id => sql`(${ctx.user.id}, ${input.kind}, ${id}, ${now})`);
      await db.execute(sql`
        INSERT INTO admin_notification_dismissals (user_id, kind, entity_id, dismissed_at)
        VALUES ${sql.join(values, sql`, `)}
        ON DUPLICATE KEY UPDATE dismissed_at = VALUES(dismissed_at)
      `);
      return { ok: true, dismissed: entityIds.length };
    }),
});
