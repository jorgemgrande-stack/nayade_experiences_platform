/**
 * Cabeceras de seguridad comunes a todas las respuestas (web pública, panel, API).
 *
 * Conservadoras a propósito: no se fija una CSP completa (la web usa scripts de terceros de
 * analítica y pago); solo `frame-ancestors`, que impide incrustar la aplicación en otro sitio
 * (clickjacking del panel) sin afectar a lo que la página carga.
 *  - HSTS solo en producción y sobre HTTPS (detrás del proxy, `req.secure` con `trust proxy`).
 */
import type { NextFunction, Request, Response } from "express";

export function securityHeaders(req: Request, res: Response, next: NextFunction): void {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Content-Security-Policy", "frame-ancestors 'self'");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(self)");
  if (process.env.NODE_ENV === "production" && req.secure) {
    res.setHeader("Strict-Transport-Security", "max-age=15552000");
  }
  next();
}
