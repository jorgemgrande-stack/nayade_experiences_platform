/**
 * Newsletter · descarga de suscriptores en Excel (.xlsx) y CSV (.csv): GET /api/newsletter/export?format=xlsx|csv + los
 * mismos filtros del listado. Exporta TODOS los registros del filtro (no solo la página visible), solo para el rol de
 * administrador, y deja constancia de quién exportó, cuándo y con qué filtros. Nunca incluye enlaces, huellas ni datos técnicos.
 */
import { Router, type Request, type Response } from "express";
import { requireAdminRole, getAuthUser } from "../_core/expressAuth";
import { filtersSchema } from "./router";
import { toCsv, toXlsx } from "./core";
import { newsletterService } from "./runtime";
import { NewsletterNotInstalled } from "./store";

const router = Router();
const num = (v: unknown) => (typeof v === "string" && /^\d{1,15}$/.test(v) ? Number(v) : undefined);
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);

router.get("/api/newsletter/export", requireAdminRole, async (req: Request, res: Response) => {
  const format = req.query.format === "csv" ? "csv" : req.query.format === "xlsx" ? "xlsx" : null;
  if (!format) return void res.status(400).json({ error: "Formato no válido: usa xlsx o csv." });
  const parsed = filtersSchema.safeParse({
    q: str(req.query.q),
    status: str(req.query.status),
    locale: str(req.query.locale),
    list: str(req.query.list),
    source: str(req.query.source),
    dateField: str(req.query.dateField),
    from: num(req.query.from),
    to: num(req.query.to),
  });
  if (!parsed.success) return void res.status(400).json({ error: "Filtros no válidos." });
  const user = getAuthUser(req);
  try {
    const rows = await newsletterService().exportRows(parsed.data, format, { id: Number(user?.id ?? 0), name: String(user?.name ?? user?.email ?? `user:${user?.id ?? 0}`) });
    const stamp = new Date().toISOString().slice(0, 10);
    const list = parsed.data.list && /^newsletter-[a-z0-9-]{2,12}$/i.test(parsed.data.list) ? parsed.data.list.toLowerCase() : parsed.data.locale ? `newsletter-${parsed.data.locale.toLowerCase()}` : null;
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Disposition", `attachment; filename="${list ? `${list}` : "suscriptores-newsletter"}-${stamp}.${format}"`);
    if (format === "csv") {
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      return void res.send(toCsv(rows));
    }
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    return void res.send(toXlsx(rows));
  } catch (e) {
    if (e instanceof NewsletterNotInstalled) return void res.status(412).json({ error: e.message });
    console.error(JSON.stringify({ ctx: "Newsletter", event: "export_error", error: e instanceof Error ? e.message.slice(0, 200) : "error" }));
    return void res.status(500).json({ error: "No se pudo generar la exportación." });
  }
});

export default router;
