/**
 * Finanzas corporativas de Big Elephant, fase 1A: libro contable (`/cp/v1/finance/*`, CRM 0033). Permisos en
 * ./permissions.ts (lectura = billing:read; contabilizar = billing:write + sesión de operador; cierres y configuración
 * = además rol admin o superadmin).
 *
 *   GET  /finance/accounts                              lectura         plan contable
 *   POST /finance/accounts                              configuración   alta de subcuenta { code, name, parentCode?, type? }
 *   PATCH /finance/accounts/:code                       configuración   nombre y activa
 *   GET  /finance/fiscal-years                          lectura         ejercicios con sus periodos
 *   POST /finance/fiscal-years                          billing:write   alta de ejercicio { year } (doce periodos)
 *   POST /finance/periods/:year/:month/close|reopen     cierre          cerrar o reabrir un periodo
 *   POST /finance/fiscal-years/:year/close              cierre          regularización, cierre y apertura (idempotente)
 *   GET  /finance/journals                              lectura         diarios
 *   GET  /finance/entries?from&to&journal&origin&account&status&q&limit&offset&sort&dir   lectura   asientos
 *   GET  /finance/entries/:id                           lectura         asiento con sus líneas
 *   POST /finance/entries                               contabilizar    asiento manual { date, journal, description, lines[], post? }
 *   POST /finance/entries/:id/post                      contabilizar    contabilizar un borrador
 *   POST /finance/entries/:id/void                      contabilizar    anular un borrador { reason }
 *   POST /finance/entries/:id/reverse                   contabilizar    revertir { date, reason } (idempotente)
 *   GET  /finance/ledger/:code?from&to                  lectura         mayor con saldo acumulado
 *   GET  /finance/trial-balance?from&to&excludeClosing  lectura         sumas y saldos
 *   GET  /finance/journal.csv?from&to                   lectura         libro diario en CSV
 *   GET  /finance/trial-balance.csv?from&to             lectura         sumas y saldos en CSV
 *   POST /finance/sync/invoices                         contabilizar    asientos de las facturas expedidas (idempotente)
 *   GET  /finance/sync/status                           lectura         última sincronización y facturas pendientes
 *   GET  /finance/summary                               lectura         resumen del panel (null = aún no disponible)
 */
import express, { type NextFunction, type Request, type Response, type Router } from "express";
import { z } from "zod";
import { getAuth } from "../controlPlane/auth";
import { requestIdOf } from "../_core/ops/requestContext";
import { opsLog } from "../_core/ops/log";
import { canClose, canOperate, canPost, canRead } from "./permissions";
import type { FinanceService } from "./service";
import { ACCOUNT_TYPES, ENTRY_ORIGINS, ENTRY_STATUSES, FINANCE_ERROR_STATUS, FinanceError, JOURNAL_CODES, type Entry, type FinanceActor } from "./types";

/**
 * Forma que consume el CRM (anexo CRM-ESPERA): `entryDate`, `debitCents` = total del asiento y `accountName` en
 * cada línea.
 */
export function entryDto(e: Entry, names: ReadonlyMap<string, string>) {
  const { date, lines, ...rest } = e;
  return {
    ...rest,
    entryDate: date,
    debitCents: lines.reduce((a, l) => a + l.debitCents, 0),
    lines: lines.map((l) => ({ ...l, accountName: names.get(l.accountCode) ?? null })),
  };
}

const wrap =
  (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, _next: NextFunction) => {
    fn(req, res).catch((e) => {
      if (e instanceof FinanceError) return void res.status(FINANCE_ERROR_STATUS[e.code]).json({ error: e.code, message: e.message });
      if (e instanceof z.ZodError) return void res.status(400).json({ error: "invalid_input", message: `Datos no válidos: ${e.issues.map((i) => `${i.path.join(".") || "petición"} (${i.message})`).join("; ")}`.slice(0, 500) });
      opsLog("error", "Finance", "request_failed", { path: req.path, message: e instanceof Error ? e.message.slice(0, 200) : String(e) });
      res.status(500).json({ error: "internal", message: "Error interno" });
    });
  };

const actorOf = (req: Request): FinanceActor => {
  const a = getAuth(req)!.actor;
  return { by: `${a.type}:${a.id}`.slice(0, 100), requestId: requestIdOf(req) ?? null };
};

const id = z.coerce.number().int().positive();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "fecha AAAA-MM-DD");
const accountCode = z.string().regex(/^\d{3,12}$/, "código de cuenta de 3 a 12 dígitos");
const cents = z.number().int().min(0);
const optRef = z.number().int().positive().nullable().optional();
const range = z.object({ from: date.optional(), to: date.optional() }).strict();

const lineSchema = z
  .object({
    accountCode,
    debitCents: cents.default(0),
    creditCents: cents.default(0),
    description: z.string().max(300).nullable().optional(),
    costCenterId: optRef,
    supplierId: optRef,
    companyId: optRef,
    taxRateBp: z.number().int().min(0).max(10_000).nullable().optional(),
    taxBaseCents: z.number().int().nullable().optional(),
  })
  .strict();

const manualSchema = z
  .object({
    date,
    journal: z.enum(JOURNAL_CODES),
    description: z.string().max(500),
    lines: z.array(lineSchema).min(1).max(500),
    post: z.boolean().optional(),
  })
  .strict();

const entriesQuery = z
  .object({
    from: date.optional(),
    to: date.optional(),
    journal: z.enum(JOURNAL_CODES).optional(),
    origin: z.enum(ENTRY_ORIGINS).optional(),
    account: z.string().regex(/^\d{1,12}$/).optional(),
    status: z.enum(ENTRY_STATUSES).optional(),
    q: z.string().trim().min(1).max(100).optional(),
    limit: z.coerce.number().int().min(1).max(200).optional(),
    offset: z.coerce.number().int().min(0).optional(),
    sort: z.enum(["date", "number", "id"]).optional(),
    dir: z.enum(["asc", "desc"]).optional(),
  })
  .strict();

function sendCsv(res: Response, name: string, csv: string) {
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${name}"`);
  res.setHeader("Cache-Control", "no-store");
  res.send(csv);
}

export function createFinanceRouter(svc: FinanceService): Router {
  const r = express.Router();
  const names = async () => new Map((await svc.accounts()).map((a) => [a.code, a.name]));
  const one = async (e: Entry) => entryDto(e, await names());

  // Plan contable y diarios
  r.get("/accounts", ...canRead, wrap(async (_req, res) => {
    const items = await svc.accounts();
    res.json({ items, total: items.length });
  }));
  r.post("/accounts", ...canClose, wrap(async (req, res) => {
    const b = z.object({ code: z.string().max(12), name: z.string().max(160), parentCode: z.string().max(12).nullable().optional(), type: z.enum(ACCOUNT_TYPES).optional() }).strict().parse(req.body);
    res.status(201).json({ item: await svc.createAccount(b, actorOf(req)) });
  }));
  r.patch("/accounts/:code", ...canClose, wrap(async (req, res) => {
    const b = z.object({ name: z.string().max(160).optional(), active: z.boolean().optional() }).strict().parse(req.body);
    res.json({ item: await svc.patchAccount(accountCode.parse(req.params.code), b, actorOf(req)) });
  }));
  r.get("/journals", ...canRead, wrap(async (_req, res) => {
    const items = await svc.journals();
    res.json({ items, total: items.length });
  }));

  // Ejercicios y periodos
  r.get("/fiscal-years", ...canRead, wrap(async (_req, res) => {
    const items = await svc.fiscalYears();
    res.json({ items, total: items.length });
  }));
  // Crear un ejercicio (doce periodos abiertos) no es sensible: basta billing:write (anexo CRM-ESPERA)
  r.post("/fiscal-years", ...canOperate, wrap(async (req, res) => {
    const b = z.object({ year: z.number().int() }).strict().parse(req.body);
    res.status(201).json({ item: await svc.createFiscalYear(b.year, actorOf(req)) });
  }));
  r.post("/fiscal-years/:year/close", ...canClose, wrap(async (req, res) => {
    const out = await svc.closeFiscalYear(z.coerce.number().int().parse(req.params.year), actorOf(req));
    const n = await names();
    const dto = (e: Entry | null) => (e ? entryDto(e, n) : null);
    res.json({ item: { ...out, regularization: dto(out.regularization), closing: dto(out.closing), opening: dto(out.opening) } });
  }));
  for (const action of ["close", "reopen"] as const) {
    r.post(`/periods/:year/:month/${action}`, ...canClose, wrap(async (req, res) => {
      const year = z.coerce.number().int().parse(req.params.year);
      const month = z.coerce.number().int().parse(req.params.month);
      res.json({ item: await svc.setPeriodStatus(year, month, action === "close" ? "closed" : "open", actorOf(req)) });
    }));
  }

  // Asientos
  r.get("/entries", ...canRead, wrap(async (req, res) => {
    const out = await svc.listEntries(entriesQuery.parse(req.query));
    const n = await names();
    res.json({ items: out.items.map((e) => entryDto(e, n)), total: out.total });
  }));
  r.get("/entries/:id", ...canRead, wrap(async (req, res) => void res.json({ item: await one(await svc.getEntry(id.parse(req.params.id))) })));
  r.post("/entries", ...canPost, wrap(async (req, res) => {
    const b = manualSchema.parse(req.body);
    res.status(201).json({ item: await one(await svc.createManual(b, actorOf(req))) });
  }));
  r.post("/entries/:id/post", ...canPost, wrap(async (req, res) => void res.json({ item: await one(await svc.post(id.parse(req.params.id), actorOf(req))) })));
  r.post("/entries/:id/void", ...canPost, wrap(async (req, res) => {
    const b = z.object({ reason: z.string().max(300) }).strict().parse(req.body);
    res.json({ item: await one(await svc.voidDraft(id.parse(req.params.id), b.reason, actorOf(req))) });
  }));
  r.post("/entries/:id/reverse", ...canPost, wrap(async (req, res) => {
    const b = z.object({ date, reason: z.string().max(300) }).strict().parse(req.body);
    const out = await svc.reverse(id.parse(req.params.id), b, actorOf(req));
    res.status(out.created ? 201 : 200).json({ item: await one(out.entry), created: out.created });
  }));

  // Informes y exportaciones
  r.get("/ledger/:code", ...canRead, wrap(async (req, res) => {
    const q = range.parse(req.query);
    res.json(await svc.ledger(accountCode.parse(req.params.code), q.from, q.to));
  }));
  r.get("/trial-balance", ...canRead, wrap(async (req, res) => {
    const q = range.extend({ excludeClosing: z.enum(["1", "0"]).optional() }).parse(req.query);
    res.json(await svc.trialBalance(q.from, q.to, q.excludeClosing === "1"));
  }));
  r.get("/journal.csv", ...canRead, wrap(async (req, res) => {
    const q = range.parse(req.query);
    const out = await svc.journalCsv(q.from, q.to);
    sendCsv(res, `libro-diario-${out.from}-${out.to}.csv`, out.csv);
  }));
  r.get("/trial-balance.csv", ...canRead, wrap(async (req, res) => {
    const q = range.extend({ excludeClosing: z.enum(["1", "0"]).optional() }).parse(req.query);
    const out = await svc.trialBalanceCsv(q.from, q.to, q.excludeClosing === "1");
    sendCsv(res, `sumas-y-saldos-${out.from}-${out.to}.csv`, out.csv);
  }));

  // Sincronización con la facturación propia y resumen
  r.post("/sync/invoices", ...canPost, wrap(async (req, res) => void res.json(await svc.syncInvoices(actorOf(req)))));
  r.get("/sync/status", ...canRead, wrap(async (_req, res) => void res.json(await svc.syncStatus())));
  r.get("/summary", ...canRead, wrap(async (_req, res) => void res.json(await svc.summary())));

  return r;
}
