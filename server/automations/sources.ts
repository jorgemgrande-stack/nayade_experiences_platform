/**
 * Automatizaciones avanzadas · entidades candidatas de cada disparador, leídas con una consulta periódica sobre las tablas
 * que el Core ya mantiene (sin bus de eventos nuevo). Solo las que SIGUEN en el estado del disparador: un presupuesto
 * aceptado o una factura cobrada dejan de aparecer y sus pasos pendientes ya no se ejecutan. BD de la empresa en curso.
 *
 *  - lead_created: `leads` creadas desde `since`.
 *  - quote_unanswered: `quotes` enviadas (o vistas) desde `since`, sin pagar ni aceptar.
 *  - reservation_paid: `reservations` pagadas desde `since` (paid_at), no anuladas.
 *  - reservation_upcoming: reservas pagadas y no anuladas con fecha entre hoy y el horizonte.
 *  - invoice_unpaid: `invoices` (facturas, no abonos) emitidas desde `since` en estado emitida o enviada.
 */
import { sql, type SQL } from "drizzle-orm";
import { getTenantDatabase } from "../_core/dbRegistry";
import type { AutomationTrigger } from "../../shared/automations";
import { dayText, eurText, madridDay, madridWallToUtc, type AutomationEntity } from "./engine";

export interface CandidateQuery {
  since: number;
  now: number;
  /** Solo «reserva próxima»: hasta cuándo mirar (ms). */
  horizon: number;
  limit: number;
  offset: number;
}

export interface AutomationSources {
  candidates(trigger: AutomationTrigger, q: CandidateQuery): Promise<AutomationEntity[]>;
}

type Row = Record<string, any>;
const ms = (v: unknown): number => (v == null ? 0 : v instanceof Date ? v.getTime() : typeof v === "number" ? v : new Date(String(v)).getTime());
const num = (v: unknown): number | null => (v == null || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const str = (v: unknown): string | null => (v == null ? null : String(v));

export class TenantDbAutomationSources implements AutomationSources {
  constructor(private readonly company: () => string) {}

  private async rows(q: SQL): Promise<Row[]> {
    const d = await getTenantDatabase();
    if (!d) throw new Error("Base de datos no disponible");
    return ((await d.execute(q)) as unknown as [Row[]])[0] ?? [];
  }

  async candidates(trigger: AutomationTrigger, q: CandidateQuery): Promise<AutomationEntity[]> {
    const company = this.company();
    const since = new Date(q.since);
    const now = new Date(q.now);
    switch (trigger) {
      case "lead_created": {
        const rows = await this.rows(sql`SELECT id, name, email, company, source, priority, status, selectedProduct, numberOfPersons, budget, assignedTo, createdAt
          FROM leads WHERE createdAt >= ${since} AND createdAt <= ${now} ORDER BY createdAt, id LIMIT ${q.limit} OFFSET ${q.offset}`);
        return rows.map((r) => ({
          type: "lead", id: Number(r.id), anchorAt: ms(r.createdAt), email: str(r.email), name: str(r.name), leadId: Number(r.id), ownerId: num(r.assignedTo),
          fields: { source: str(r.source), priority: str(r.priority), status: str(r.status), company: str(r.company), product: str(r.selectedProduct), people: num(r.numberOfPersons), budget: num(r.budget) },
          vars: { nombre: str(r.name) ?? "", referencia: `#${r.id}`, fecha: dayText(madridDay(ms(r.createdAt))), importe: eurText(num(r.budget)), producto: str(r.selectedProduct) ?? "", empresa: company },
          ctaPath: "/admin/crm?tab=leads",
        }));
      }
      case "quote_unanswered": {
        const rows = await this.rows(sql`SELECT q.id, q.quoteNumber, q.title, q.total, q.status, q.sentAt, q.viewedAt, q.leadId, l.name, l.email, l.assignedTo
          FROM quotes q LEFT JOIN leads l ON l.id = q.leadId
          WHERE q.status IN ('enviado', 'visualizado') AND q.paidAt IS NULL AND q.acceptedAt IS NULL AND q.sentAt IS NOT NULL AND q.sentAt >= ${since} AND q.sentAt <= ${now}
          ORDER BY q.sentAt, q.id LIMIT ${q.limit} OFFSET ${q.offset}`);
        return rows.map((r) => ({
          type: "quote", id: Number(r.id), anchorAt: ms(r.sentAt), email: str(r.email), name: str(r.name), leadId: num(r.leadId), ownerId: num(r.assignedTo),
          fields: { total: num(r.total), title: str(r.title), viewed: r.viewedAt ? "si" : "no" },
          vars: { nombre: str(r.name) ?? "", referencia: str(r.quoteNumber) ?? `#${r.id}`, fecha: dayText(madridDay(ms(r.sentAt))), importe: eurText(num(r.total)), producto: str(r.title) ?? "", empresa: company },
          ctaPath: "/admin/crm?tab=quotes",
        }));
      }
      case "reservation_paid":
      case "reservation_upcoming": {
        const upcoming = trigger === "reservation_upcoming";
        const where = upcoming
          ? sql`booking_date >= ${madridDay(q.now)} AND booking_date <= ${madridDay(q.horizon)}`
          : sql`paid_at >= ${q.since} AND paid_at <= ${q.now}`;
        const rows = await this.rows(sql`SELECT id, reservation_number, merchant_order, product_name, booking_date, selected_time, people, amount_total, channel, customer_name, customer_email, paid_at
          FROM reservations WHERE status = 'paid' AND (status_reservation IS NULL OR status_reservation NOT IN ('ANULADA', 'NO_SHOW')) AND ${where}
          ORDER BY ${upcoming ? sql`booking_date, id` : sql`paid_at, id`} LIMIT ${q.limit} OFFSET ${q.offset}`);
        const out: AutomationEntity[] = [];
        for (const r of rows) {
          const start = madridWallToUtc(String(r.booking_date), str(r.selected_time) ?? "00:00");
          const anchorAt = upcoming ? start : num(r.paid_at);
          if (anchorAt == null) continue;
          // Una reserva de hoy que ya empezó no es «próxima»
          if (upcoming && (anchorAt <= q.now || anchorAt > q.horizon)) continue;
          const amount = num(r.amount_total);
          out.push({
            type: "reservation", id: Number(r.id), anchorAt, email: str(r.customer_email), name: str(r.customer_name), leadId: null, ownerId: null,
            fields: { product: str(r.product_name), amount: amount == null ? null : amount / 100, people: num(r.people), channel: str(r.channel) },
            vars: {
              nombre: str(r.customer_name) ?? "", referencia: str(r.reservation_number) ?? str(r.merchant_order) ?? `#${r.id}`,
              fecha: `${dayText(String(r.booking_date))}${r.selected_time ? `, ${String(r.selected_time).slice(0, 5)}` : ""}`,
              importe: eurText(amount == null ? null : amount / 100), producto: str(r.product_name) ?? "", empresa: company,
            },
            ctaPath: "/admin/crm?tab=reservations",
          });
        }
        return out;
      }
      case "invoice_unpaid": {
        const rows = await this.rows(sql`SELECT id, invoiceNumber, clientName, clientEmail, total, status, issuedAt
          FROM invoices WHERE invoiceType = 'factura' AND status IN ('generada', 'enviada') AND issuedAt >= ${since} AND issuedAt <= ${now}
          ORDER BY issuedAt, id LIMIT ${q.limit} OFFSET ${q.offset}`);
        return rows.map((r) => ({
          type: "invoice", id: Number(r.id), anchorAt: ms(r.issuedAt), email: str(r.clientEmail), name: str(r.clientName), leadId: null, ownerId: null,
          fields: { total: num(r.total), status: str(r.status) },
          vars: { nombre: str(r.clientName) ?? "", referencia: str(r.invoiceNumber) ?? `#${r.id}`, fecha: dayText(madridDay(ms(r.issuedAt))), importe: eurText(num(r.total)), producto: "", empresa: company },
          ctaPath: "/admin/crm?tab=invoices",
        }));
      }
    }
  }
}

/** Fuente en memoria (pruebas): entidades por disparador, filtradas por la misma ventana. */
export class MemoryAutomationSources implements AutomationSources {
  constructor(public byTrigger: Partial<Record<AutomationTrigger, AutomationEntity[]>> = {}) {}
  async candidates(trigger: AutomationTrigger, q: CandidateQuery) {
    const before = trigger === "reservation_upcoming";
    return (this.byTrigger[trigger] ?? [])
      .filter((e) => (before ? e.anchorAt > q.now && e.anchorAt <= q.horizon : e.anchorAt >= q.since && e.anchorAt <= q.now))
      .slice(q.offset, q.offset + q.limit);
  }
}
