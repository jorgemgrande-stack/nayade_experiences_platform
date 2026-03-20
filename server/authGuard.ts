/**
 * authGuard.ts — Middleware Express de protección de rutas tRPC.
 *
 * Intercepta peticiones a /api/trpc que correspondan a procedimientos protegidos
 * (cualquier cosa que no sea una lista blanca de rutas públicas) y devuelve 401
 * si no hay sesión válida.
 *
 * Esto añade una capa de seguridad a nivel de red, complementando el
 * `protectedProcedure` de tRPC que ya valida la sesión en el contexto.
 *
 * Funciona en ambos modos:
 *  - LOCAL_AUTH=true → verifica cookie JWT propia (nayade_session)
 *  - Manus OAuth     → verifica cookie de sesión del SDK de Manus
 */

import type { Request, Response, NextFunction } from "express";
import { verifySessionToken } from "./localAuth";
import { sdk } from "./_core/sdk";

// ─── Rutas tRPC completamente públicas (no requieren sesión) ─────────────────
// Formato: "router.procedure" tal como aparece en la URL de tRPC
// Ejemplo: /api/trpc/auth.me → "auth.me"
const PUBLIC_TRPC_ROUTES = new Set([
  // Auth
  "auth.me",
  "auth.logout",
  // Contenido público de la web
  "cms.getSiteSettings",
  "cms.getSlideshow",
  "cms.getMenuItems",
  "cms.getStaticPage",
  "cms.getHomeModules",
  // Experiencias y productos
  "experiences.getAll",
  "experiences.getBySlug",
  "experiences.getFeatured",
  "categories.getAll",
  "locations.getAll",
  "locations.getBySlug",
  "packs.getAll",
  "packs.getBySlug",
  "packs.getCategories",
  // Hotel y SPA
  "hotel.getRoomTypes",
  "hotel.getRoomBySlug",
  "hotel.getAvailability",
  "hotel.createBooking",
  "spa.getTreatments",
  "spa.getTreatmentBySlug",
  "spa.createBooking",
  // Reseñas
  "reviews.getPublicReviews",
  "reviews.submitReview",
  // Restaurantes (público)
  "restaurants.getAll",
  "restaurants.getBySlug",
  "restaurants.getAvailability",
  "restaurants.getShifts",
  "restaurants.createBooking",
  "restaurants.getBookingByLocator",
  // Leads y presupuestos (formularios públicos)
  "leads.create",
  "quotes.getByPaymentToken",
  "quotes.createPaymentLink",
  // Sistema
  "system.notifyOwner",
]);

// ─── Parsear el nombre del procedimiento desde la URL de tRPC ─────────────────
// /api/trpc/auth.me          → "auth.me"
// /api/trpc/auth.me,hotel.x  → ["auth.me", "hotel.x"]  (batch)
function extractProcedureNames(url: string): string[] {
  // Eliminar query string
  const path = url.split("?")[0];
  // Cuando el middleware está montado en /api/trpc, req.url llega como
  // "/restaurants.getAll" (ya sin el prefijo /api/trpc)
  // También soportamos la URL completa por si acaso
  const procedurePart = path
    .replace(/^\/api\/trpc\//, "")  // URL completa
    .replace(/^\//, "");             // URL relativa (ya sin prefijo)
  if (!procedurePart) return [];
  // Puede ser un batch: "auth.me,hotel.getRoomTypes"
  return procedurePart.split(",").map(p => p.trim()).filter(Boolean);
}

function isPublicRoute(procedures: string[]): boolean {
  return procedures.every(p => PUBLIC_TRPC_ROUTES.has(p));
}

// ─── Extractor de cookie ──────────────────────────────────────────────────────
function getCookie(req: Request, name: string): string | undefined {
  const raw = req.headers.cookie ?? "";
  const cookies = Object.fromEntries(
    raw.split(";").map(c => {
      const idx = c.indexOf("=");
      if (idx === -1) return [c.trim(), ""];
      return [c.slice(0, idx).trim(), decodeURIComponent(c.slice(idx + 1).trim())];
    })
  );
  return cookies[name];
}

// ─── Middleware factory ───────────────────────────────────────────────────────
export function createAuthGuardMiddleware(useLocalAuth: boolean) {
  return async function authGuard(req: Request, res: Response, next: NextFunction) {
    const procedures = extractProcedureNames(req.url ?? "");

    // Si todos los procedimientos son públicos, pasar sin verificar
    if (procedures.length === 0 || isPublicRoute(procedures)) {
      return next();
    }

    // Verificar sesión
    let authenticated = false;

    if (useLocalAuth) {
      // Modo local: verificar JWT en cookie nayade_session
      const token = getCookie(req, "nayade_session");
      if (token) {
        const userId = await verifySessionToken(token);
        authenticated = userId !== null;
      }
    } else {
      // Modo Manus OAuth: usar el SDK de Manus para verificar la sesión
      try {
        const user = await sdk.authenticateRequest(req);
        authenticated = user !== null;
      } catch {
        authenticated = false;
      }
    }

    if (!authenticated) {
      res.status(401).json({
        error: {
          json: {
            message: "No autenticado. Inicia sesión para continuar.",
            code: -32001,
            data: { code: "UNAUTHORIZED", httpStatus: 401 },
          },
        },
      });
      return;
    }

    next();
  };
}
