/**
 * Utilidades de protección de endpoints públicos, extraídas del arranque para poder probarlas.
 */
import type { NextFunction, Request, RequestHandler, Response } from "express";
import rateLimit from "express-rate-limit";

/*
 * Límite de peticiones por procedimiento tRPC real. Adaptado de Skicenter (server/trpcRateLimit.ts, 7b03841c y
 * bd86d5ed). Los nombres reales llevan el prefijo del router (`public.submitLead`) y pueden venir en lote
 * (`a.b,public.submitLead`) o codificados (`public%2EsubmitLead`): se reconocen todos. Un lote cuenta como UNA
 * petición para el limitador, así que además se limita el número de llamadas limitadas por lote.
 * Las listas son los procedimientos públicos reales de Core (lista blanca de server/authGuard.ts) que escriben
 * datos, envían correo, activan cuentas o inician pagos; una prueba comprueba que existen y son públicos.
 */

/** Formularios, reservas, activaciones y pagos públicos (límite compartido por IP: el de los formularios). */
export const FORM_PROCEDURES: ReadonlySet<string> = new Set([
  "public.submitLead",
  "public.submitBudget",
  "public.submitColegiosLead",
  "public.setPassword",
  "hotel.createHotelBooking",
  "spa.createSpaBooking",
  "restaurants.createBooking",
  "reviews.submitReview",
  "ticketing.createSubmission",
  "cancellations.createRequest",
  "crm.quotes.rejectByToken",
  "crm.quotes.payWithToken",
  "reservations.createAndPay",
  "reservations.cartCheckout",
  "hr.portal.activate",
  "partners.activateInvite",
  "suppliers.activateSupplierInvite",
  "gestoria.portal.activate",
]);

/** Subidas públicas de ficheros (límite más holgado: se pueden adjuntar varios). */
export const UPLOAD_PROCEDURES: ReadonlySet<string> = new Set(["ticketing.uploadCouponAttachment"]);

/**
 * Consultas que permiten adivinar valores secretos por fuerza bruta (códigos de descuento). Límite propio, más
 * holgado que el de formularios: un cliente real puede teclear mal el código varias veces.
 */
export const LOOKUP_PROCEDURES: ReadonlySet<string> = new Set(["discounts.validate"]);

export const MAX_FORM_CALLS_PER_BATCH = 3;
export const MAX_UPLOAD_CALLS_PER_BATCH = 10;
export const MAX_LOOKUP_CALLS_PER_BATCH = 3;

/** Cuenta cuántas llamadas limitadas lleva una ruta de tRPC (`/proc` o `/proc1,proc2` en lote). */
export function classifyTrpcPath(path: string): { form: number; upload: number; lookup: number } {
  let decoded = path.split("?")[0];
  try {
    decoded = decodeURIComponent(decoded);
  } catch {
    /* ruta mal codificada: se usa tal cual */
  }
  const names = decoded.replace(/^\/+/, "").split(",").map((n) => n.trim()).filter(Boolean);
  let form = 0, upload = 0, lookup = 0;
  for (const n of names) {
    if (FORM_PROCEDURES.has(n)) form++;
    else if (UPLOAD_PROCEDURES.has(n)) upload++;
    else if (LOOKUP_PROCEDURES.has(n)) lookup++;
  }
  return { form, upload, lookup };
}

/** ¿La ruta incluye algún formulario o subida pública limitada? (sueltos o en lote) */
export function isLeadProcedurePath(path: string): boolean {
  const c = classifyTrpcPath(path);
  return c.form + c.upload > 0;
}

/** Validación de códigos de descuento: 20 peticiones/min por IP. Frena la búsqueda de códigos por fuerza bruta. */
const discountLookupRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Demasiados intentos. Espera 1 minuto antes de volver a probar el código.", code: "RATE_LIMIT_EXCEEDED" },
});

/**
 * Middleware para `/api/trpc`, ANTES de los guardianes de sesión y licencias. `form` y `upload` son los limitadores
 * del arranque (formularios y subidas); `lookup` por defecto es el de códigos de descuento.
 */
export function createTrpcRateLimitMiddleware(limiters: { form: RequestHandler; upload: RequestHandler; lookup?: RequestHandler }): RequestHandler {
  const lookupLimiter = limiters.lookup ?? discountLookupRateLimit;
  return (req: Request, res: Response, next: NextFunction) => {
    const { form, upload, lookup } = classifyTrpcPath(req.path);
    if (form === 0 && upload === 0 && lookup === 0) return next();
    if (form > MAX_FORM_CALLS_PER_BATCH || upload > MAX_UPLOAD_CALLS_PER_BATCH || lookup > MAX_LOOKUP_CALLS_PER_BATCH) {
      res.status(429).json({ error: "Demasiadas solicitudes en una sola petición.", code: "RATE_LIMIT_EXCEEDED" });
      return;
    }
    // Un lote que mezcla tipos pasa por todos los limitadores que le tocan (cada uno cuenta una petición)
    const chain: RequestHandler[] = [];
    if (form > 0) chain.push(limiters.form);
    if (upload > 0) chain.push(limiters.upload);
    if (lookup > 0) chain.push(lookupLimiter);
    const run = (i: number): void => {
      if (i >= chain.length) return next();
      chain[i](req, res, (err?: unknown) => (err ? next(err) : run(i + 1)));
    };
    run(0);
  };
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
