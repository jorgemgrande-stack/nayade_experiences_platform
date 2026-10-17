/**
 * Utilidades de protección de endpoints públicos, extraídas del arranque para poder probarlas.
 */
import type { NextFunction, Request, Response } from "express";

/**
 * Procedimientos tRPC públicos que reciben formularios (leads/presupuestos).
 * Los nombres reales llevan el prefijo del router (`public.submitLead`) y pueden venir
 * agrupados en una sola petición (`a.b,public.submitLead`). También los formularios públicos de
 * ticketing y su subida de adjuntos (sin sesión): mismo límite que los leads.
 */
const LEAD_PROCEDURE_RE =
  /(^|[/,])(public\.(submitLead|submitBudget|submitColegiosLead)|ticketing\.(createSubmission|uploadCouponAttachment))(,|$)/;

export function isLeadProcedurePath(path: string): boolean {
  return LEAD_PROCEDURE_RE.test(path);
}

/**
 * Cabeceras para los ficheros subidos servidos desde el almacenamiento local: nunca deben
 * ejecutarse en el origen de la aplicación (sin sniffing y descarga de formatos con scripts).
 */
export function localStorageSecurityHeaders(req: Request, res: Response, next: NextFunction) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (/\.(html?|svg|xml|xhtml)$/i.test(req.path)) {
    res.setHeader("Content-Disposition", "attachment");
  }
  next();
}
