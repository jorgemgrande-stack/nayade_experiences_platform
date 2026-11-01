/**
 * Medición del marketplace del panel (`POST /cp/v1/commerce/tenants/:t/events`): vistas de tarjetas y fichas, clics,
 * campañas e inicios o finales de compra. AGREGADA y sin datos personales: solo empresa, día, tipo, producto y campaña;
 * ni usuario, ni IP, ni navegador. Cada evento lleva un id (uuid del panel) que se cuenta una sola vez.
 *
 * Sin la migración 0042 responde 202 y descarta: el panel puede enviar siempre. Las solicitudes y el interés ya se
 * cuentan por `/requests`.
 */
import express, { type NextFunction, type Request, type Response, type Router } from "express";
import type mysql from "mysql2/promise";
import { z } from "zod";
import { getAuth, requireScope } from "../controlPlane/auth";
import { opsLog } from "../_core/ops/log";

export const PANEL_EVENT_TYPES = ["card_view", "sheet_view", "cta_click", "slide_view", "slide_click", "purchase_start", "purchase_done", "activation_error"] as const;
export type PanelEventType = (typeof PANEL_EVENT_TYPES)[number];
const MAX_AGE_MS = 24 * 3600 * 1000;
const MAX_SKEW_MS = 5 * 60 * 1000;

const key = z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/);
const event = z
  .object({
    id: z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i),
    type: z.enum(PANEL_EVENT_TYPES),
    productKey: key.optional(),
    slideId: key.optional(),
    /** Momento del evento: milisegundos o fecha ISO 8601 (el panel envía ISO). */
    at: z.union([z.number().int(), z.string().datetime({ offset: true }).transform((s) => Date.parse(s))]),
  })
  .strict();
const body = z.object({ events: z.array(event).min(1).max(50) }).strict();
const tenant = z.string().regex(/^[a-z0-9][a-z0-9-]{1,62}$/);

export interface CountRow {
  day: string;
  tenantId: string;
  type: PanelEventType;
  productKey: string;
  slideId: string;
  count: number;
}

export interface PanelEventStore {
  /** Cuenta los eventos cuyo id no se había visto; devuelve cuántos contó. */
  record(tenantId: string, events: Array<{ id: string; type: PanelEventType; productKey: string; slideId: string; day: string }>, now: number): Promise<number>;
  counts(f: { from: string; to: string }): Promise<CountRow[]>;
}

export class MemoryPanelEventStore implements PanelEventStore {
  seen = new Map<string, number>();
  rows = new Map<string, CountRow>();
  async record(tenantId: string, events: Parameters<PanelEventStore["record"]>[1], now: number) {
    let n = 0;
    for (const e of events) {
      if (this.seen.has(e.id)) continue;
      this.seen.set(e.id, now);
      const k = [e.day, tenantId, e.type, e.productKey, e.slideId].join("|");
      const r = this.rows.get(k) ?? { day: e.day, tenantId, type: e.type, productKey: e.productKey, slideId: e.slideId, count: 0 };
      r.count++;
      this.rows.set(k, r);
      n++;
    }
    return n;
  }
  async counts(f: { from: string; to: string }) {
    return Array.from(this.rows.values()).filter((r) => r.day >= f.from && r.day <= f.to);
  }
}

export class MysqlPanelEventStore implements PanelEventStore {
  constructor(private pool: mysql.Pool) {}
  async record(tenantId: string, events: Parameters<PanelEventStore["record"]>[1], now: number) {
    const c = await this.pool.getConnection();
    try {
      await c.beginTransaction();
      let n = 0;
      for (const e of events) {
        const [r] = await c.query<mysql.ResultSetHeader>("INSERT IGNORE INTO marketplace_event_keys (event_id, received_at) VALUES (?, ?)", [e.id.toLowerCase(), new Date(now)]);
        if (!r.affectedRows) continue;
        await c.query(
          "INSERT INTO marketplace_event_counts (day, tenant_id, event_type, product_key, slide_id, count) VALUES (?, ?, ?, ?, ?, 1) ON DUPLICATE KEY UPDATE count = count + 1",
          [e.day, tenantId, e.type, e.productKey, e.slideId],
        );
        n++;
      }
      await c.commit();
      return n;
    } catch (e) {
      await c.rollback().catch(() => undefined);
      throw e;
    } finally {
      c.release();
    }
  }
  async counts(f: { from: string; to: string }) {
    const [rows] = await this.pool.query<mysql.RowDataPacket[]>(
      "SELECT DATE_FORMAT(day, '%Y-%m-%d') AS day, tenant_id, event_type, product_key, slide_id, count FROM marketplace_event_counts WHERE day BETWEEN ? AND ? ORDER BY day",
      [f.from, f.to],
    );
    return rows.map((r) => ({ day: String(r.day), tenantId: r.tenant_id, type: r.event_type as PanelEventType, productKey: r.product_key, slideId: r.slide_id, count: Number(r.count) }));
  }
}

const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Valida y cuenta un lote de una empresa. Los eventos fuera de plazo se descartan (no se cuentan ni fallan el lote). */
export async function recordPanelEvents(store: PanelEventStore | null, tenantId: string, raw: unknown, now: number): Promise<{ accepted: number; counted: number; stale: number }> {
  const b = body.parse(raw);
  const fresh = b.events.filter((e) => e.at >= now - MAX_AGE_MS && e.at <= now + MAX_SKEW_MS);
  const counted = store ? await store.record(tenantId, fresh.map((e) => ({ id: e.id.toLowerCase(), type: e.type, productKey: e.productKey ?? "", slideId: e.slideId ?? "", day: dayOf(e.at) })), now) : 0;
  return { accepted: b.events.length, counted, stale: b.events.length - fresh.length };
}

/** Vista agregada para el CRM: totales por tipo, producto y campaña (y empresas distintas) en un rango de días. */
export async function panelEventSummary(store: PanelEventStore, f: { from: string; to: string }) {
  const rows = await store.counts(f);
  const by = (pick: (r: CountRow) => string) => {
    const m = new Map<string, { total: number; byType: Partial<Record<PanelEventType, number>>; tenants: Set<string> }>();
    for (const r of rows) {
      const k = pick(r);
      if (!k) continue;
      const x = m.get(k) ?? { total: 0, byType: {}, tenants: new Set<string>() };
      x.total += r.count;
      x.byType[r.type] = (x.byType[r.type] ?? 0) + r.count;
      x.tenants.add(r.tenantId);
      m.set(k, x);
    }
    return Array.from(m.entries())
      .map(([k, x]) => ({ key: k, total: x.total, byType: x.byType, tenants: x.tenants.size }))
      .sort((a, b) => b.total - a.total);
  };
  const totals: Partial<Record<PanelEventType, number>> = {};
  for (const r of rows) totals[r.type] = (totals[r.type] ?? 0) + r.count;
  return { from: f.from, to: f.to, totals, products: by((r) => r.productKey), slides: by((r) => r.slideId) };
}

/** Token del Core: `commerce:support` o `commerce:purchase`. */
function requireCore(req: Request, res: Response, next: NextFunction) {
  const scopes = getAuth(req)?.scopes;
  if (!scopes || !(scopes.has("commerce:support") || scopes.has("commerce:purchase"))) return void res.status(403).json({ error: "forbidden", scope: "commerce:support" });
  next();
}

/** Ruta del Core (montar bajo /commerce), con el token de comercio del panel. */
export function createPanelEventsRouter(d: { store: PanelEventStore | null; now?: () => number }): Router {
  const r = express.Router();
  const now = d.now ?? Date.now;
  r.post("/tenants/:tenantId/events", requireCore, express.json({ limit: "32kb" }), (req: Request, res: Response) => {
    const t = tenant.safeParse(req.params.tenantId);
    if (!t.success) return void res.status(400).json({ error: "invalid_request", message: "tenantId" });
    const at = now();
    recordPanelEvents(d.store, t.data, req.body, at).then(
      (out) => {
        res.status(202).json(out);
      },
      (e) => {
        if (e instanceof z.ZodError) return void res.status(400).json({ error: "invalid_request", message: e.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ").slice(0, 300) });
        opsLog("warn", "Commerce", "panel_events_failed", { error: e instanceof Error ? e.name : "error" });
        // La medición nunca rompe el panel: se descarta el lote
        res.status(202).json({ accepted: 0, counted: 0, stale: 0 });
      },
    );
  });
  return r;
}

/** Ruta del CRM (montar bajo /web/marketplace-stats): vista agregada por rango de días (máximo un año). */
export function createPanelStatsRouter(store: PanelEventStore): Router {
  const r = express.Router();
  const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
  r.get("/", requireScope("web:read"), (req, res) => {
    const q = z.object({ from: day, to: day }).safeParse(req.query);
    if (!q.success || q.data.from > q.data.to || Date.parse(q.data.to) - Date.parse(q.data.from) > 366 * 24 * 3600 * 1000) return void res.status(400).json({ error: "invalid_request", message: "from/to (AAAA-MM-DD, máximo un año)" });
    panelEventSummary(store, q.data).then(
      (s) => res.json(s),
      () => res.status(503).json({ error: "unavailable", message: "Medición no disponible" }),
    );
  });
  return r;
}
