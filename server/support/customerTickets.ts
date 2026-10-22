/**
 * Soporte desde el PANEL de cada empresa (`/cp/v1/commerce/tenants/:t/tickets/*`), llamado por el servidor del Core
 * con la empresa de la sesión. Reutiliza el servicio de tickets del equipo (mismos avisos por correo y mismo
 * historial) con tres garantías:
 *  - Aislamiento: el tenant de la ruta filtra todo; el ticket de otra empresa se comporta como inexistente.
 *  - Nunca se exponen notas internas, prioridad, asignación ni identidades del equipo.
 *  - La empresa solo crea, responde y reabre; cambiar el estado lo hace el equipo.
 *
 * Ámbito: `commerce:support` o, mientras no se reparta el token del Core, `commerce:purchase` (el mismo token de
 * servicio que ya actúa por la empresa de la sesión).
 */
import express, { type NextFunction, type Request, type Response, type Router } from "express";
import { z } from "zod";
import { getAuth } from "../controlPlane/auth";
import { opsLog } from "../_core/ops/log";
import { TicketError, type Ticket, type TicketEvent, type TicketService } from "../_core/support/tickets";

export const CUSTOMER_TICKET_CATEGORIES = ["general", "billing", "technical", "account", "data"] as const;

export interface CustomerTicketView {
  id: number;
  title: string;
  category: string;
  status: Ticket["status"];
  createdAt: number;
  updatedAt: number;
  resolvedAt: number | null;
}
export interface CustomerTicketEntry {
  at: number;
  kind: "created" | "comment" | "status";
  /** `customer`: alguien de la empresa; `support`: el equipo de Elephant Source (sin nombre). */
  author: "customer" | "support";
  text: string | null;
  status: Ticket["status"] | null;
}

const CUSTOMER_PREFIX = "customer:";
export const customerActor = (tenantId: string, who: string) => `${CUSTOMER_PREFIX}${tenantId}/${who}`.slice(0, 100);

export function ticketView(t: Ticket): CustomerTicketView {
  return { id: t.id, title: t.title, category: t.category, status: t.status, createdAt: t.createdAt, updatedAt: t.updatedAt, resolvedAt: t.resolvedAt };
}

/** Historial visible para la empresa: alta, respuestas públicas y cambios de estado. Nunca notas internas. */
export function customerTimeline(t: Ticket, events: TicketEvent[]): CustomerTicketEntry[] {
  const out: CustomerTicketEntry[] = [];
  for (const e of events) {
    if (e.internal) continue;
    const author = e.actor.startsWith(CUSTOMER_PREFIX) ? "customer" : "support";
    if (e.kind === "created") out.push({ at: e.at, kind: "created", author, text: t.description, status: null });
    else if (e.kind === "comment" && e.comment) out.push({ at: e.at, kind: "comment", author, text: e.comment, status: null });
    else if (e.kind === "status") out.push({ at: e.at, kind: "status", author, text: e.comment, status: e.toValue as Ticket["status"] });
  }
  return out;
}

const tenant = z.string().regex(/^[a-z0-9][a-z0-9-]{1,62}$/);
const id = z.coerce.number().int().positive();
/** Quién de la empresa actúa (correo de su usuario del panel): queda en el historial y recibe los avisos. */
const who = z.string().trim().email().max(200);

const wrap =
  (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, _next: NextFunction) => {
    fn(req, res).catch((e) => {
      if (e instanceof TicketError) {
        const status = e.code === "not_found" ? 404 : e.code === "invalid_input" ? 400 : 409;
        return void res.status(status).json({ error: e.code, message: e.message });
      }
      if (e instanceof z.ZodError) return void res.status(400).json({ error: "invalid_request", message: e.issues.map((i) => i.path.join(".") || i.message).join(", ") });
      opsLog("error", "Support", "customer_ticket_failed", { method: req.method, error: e instanceof Error ? e.name : "error" });
      res.status(500).json({ error: "internal_error", message: "Error interno" });
    });
  };

/** Token del Core: `commerce:support` o `commerce:purchase`. */
function requireCoreSupport(req: Request, res: Response, next: NextFunction) {
  const scopes = getAuth(req)?.scopes;
  if (!scopes || !(scopes.has("commerce:support") || scopes.has("commerce:purchase"))) return void res.status(403).json({ error: "forbidden", scope: "commerce:support" });
  next();
}

/** Rutas del Core (montar bajo /commerce). */
export function createCustomerTicketsRouter(tickets: TicketService): Router {
  const r = express.Router();
  r.use("/tenants/:tenantId/tickets", requireCoreSupport, (_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });

  r.get("/tenants/:tenantId/tickets", wrap(async (req, res) => {
    const t = tenant.parse(req.params.tenantId);
    const { items, total } = await tickets.list({ tenantId: t, limit: 100 });
    res.json({ tickets: items.map(ticketView), total });
  }));

  r.post("/tenants/:tenantId/tickets", wrap(async (req, res) => {
    const t = tenant.parse(req.params.tenantId);
    const b = z
      .object({ title: z.string().trim().min(3).max(200), description: z.string().trim().min(10).max(10_000), category: z.enum(CUSTOMER_TICKET_CATEGORIES).optional(), requestedBy: who })
      .strict()
      .parse(req.body);
    const ticket = await tickets.create({ tenantId: t, title: b.title, description: b.description, category: b.category ?? "general", requester: b.requestedBy }, customerActor(t, b.requestedBy));
    res.status(201).json({ ticket: ticketView(ticket) });
  }));

  r.get("/tenants/:tenantId/tickets/:id", wrap(async (req, res) => {
    const t = tenant.parse(req.params.tenantId);
    const { ticket, events } = await tickets.get(id.parse(req.params.id), { tenantId: t });
    res.json({ ticket: ticketView(ticket), timeline: customerTimeline(ticket, events) });
  }));

  // Respuesta de la empresa. Si el equipo esperaba su respuesta, vuelve a estar «en curso»
  r.post("/tenants/:tenantId/tickets/:id/comments", wrap(async (req, res) => {
    const t = tenant.parse(req.params.tenantId);
    const n = id.parse(req.params.id);
    const b = z.object({ text: z.string().trim().min(1).max(5000), requestedBy: who }).strict().parse(req.body);
    const actor = customerActor(t, b.requestedBy);
    const before = (await tickets.get(n, { tenantId: t })).ticket;
    if (before.status === "resolved") throw new TicketError("invalid_transition", "La incidencia está resuelta: reábrela si necesitas seguir");
    await tickets.comment(n, b.text, actor, { tenantId: t });
    if (before.status === "waiting_customer") await tickets.setStatus(n, "in_progress", actor, undefined, t);
    const { ticket, events } = await tickets.get(n, { tenantId: t });
    res.status(201).json({ ticket: ticketView(ticket), timeline: customerTimeline(ticket, events) });
  }));

  // Reabrir una incidencia resuelta (una cerrada ya no se reabre: se abre otra)
  r.post("/tenants/:tenantId/tickets/:id/reopen", wrap(async (req, res) => {
    const t = tenant.parse(req.params.tenantId);
    const n = id.parse(req.params.id);
    const b = z.object({ reason: z.string().trim().min(3).max(2000), requestedBy: who }).strict().parse(req.body);
    const cur = (await tickets.get(n, { tenantId: t })).ticket;
    if (cur.status !== "resolved") throw new TicketError("invalid_transition", "Solo se puede reabrir una incidencia resuelta");
    await tickets.setStatus(n, "open", customerActor(t, b.requestedBy), b.reason, t);
    const { ticket, events } = await tickets.get(n, { tenantId: t });
    res.json({ ticket: ticketView(ticket), timeline: customerTimeline(ticket, events) });
  }));

  return r;
}
