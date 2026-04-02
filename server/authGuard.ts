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
 *
 * IMPORTANTE: Esta lista debe incluir TODOS los procedimientos que se llaman
 * desde páginas públicas (sin login). Si falta alguno, los usuarios sin sesión
 * (incluyendo móviles/Safari sin cookies de admin) recibirán 401.
 */

import type { Request, Response, NextFunction } from "express";
import { verifySessionToken } from "./localAuth";
import { sdk } from "./_core/sdk";

// ─── Rutas tRPC completamente públicas (no requieren sesión) ─────────────────
// Formato: "router.procedure" tal como aparece en la URL de tRPC
// Ejemplo: /api/trpc/auth.me → "auth.me"
const PUBLIC_TRPC_ROUTES = new Set([
  // ── Auth ──────────────────────────────────────────────────────────────────
  "auth.me",
  "auth.logout",

  // ── Router "public" — contenido público general ───────────────────────────
  "public.getFeaturedExperiences",
  "public.getExperiences",
  "public.getExperienceBySlug",
  "public.getVariantsByExperience",
  "public.setPassword",
  "public.getCategories",
  "public.getLocations",
  "public.getSlideshowItems",
  "public.getMenuItems",
  "public.submitLead",
  "public.submitBudget",
  "public.getPublicPage",
  "public.getPublicPageBlocks",

  // ── CMS público ───────────────────────────────────────────────────────────
  "cms.getSiteSettings",
  "cms.getSlideshow",
  "cms.getMenuItems",
  "cms.getStaticPage",
  "cms.getHomeModules",

  // ── Módulos de la home ────────────────────────────────────────────────────
  "homeModules.getModule",
  "homeModules.getAllModules",

  // ── Experiencias y productos (router legacy) ──────────────────────────────
  "experiences.getAll",
  "experiences.getBySlug",
  "experiences.getFeatured",
  "categories.getAll",
  "locations.getAll",
  "locations.getBySlug",

  // ── Hotel ─────────────────────────────────────────────────────────────────
  "hotel.getRoomTypes",
  "hotel.getRoomBySlug",
  "hotel.getRoomTypeBySlug",
  "hotel.getAvailability",
  "hotel.searchAvailability",
  "hotel.getRoomCalendar",
  "hotel.createBooking",
  "hotel.createHotelBooking",

  // ── SPA ───────────────────────────────────────────────────────────────────
  "spa.getCategories",
  "spa.getTreatments",
  "spa.getTreatmentBySlug",
  "spa.getAvailableSlots",
  "spa.getSlotsByMonth",
  "spa.createBooking",
  "spa.createSpaBooking",

  // ── Reseñas ───────────────────────────────────────────────────────────────
  "reviews.getPublicReviews",
  "reviews.submitReview",

  // ── Restaurantes — router nuevo (sin 'e') ─────────────────────────────────
  "restaurants.getAll",
  "restaurants.getBySlug",
  "restaurants.getAvailability",
  "restaurants.getShifts",
  "restaurants.createBooking",
  "restaurants.getBookingByLocator",

  // ── Restaurantes — router legacy (con 'e') ────────────────────────────────
  "restaurantes.getAll",
  "restaurantes.getBySlug",

  // ── Leads y presupuestos (formularios públicos) ───────────────────────────
  "public.submitLead",
  "public.submitBudget",

  // ── Presupuestos por token (página pública /presupuesto/:token) ───────────
  "crm.quotes.getByToken",
  "crm.quotes.rejectByToken",
  "crm.quotes.payWithToken",

  // ── Galería pública ──────────────────────────────────────────────────────
  "gallery.getItems",
  "gallery.getCategories",

  // ── Reservas (estado público) ─────────────────────────────────────────────
  "reservations.getStatus",
  "reservations.getByLocator",

  // ── Sistema ───────────────────────────────────────────────────────────────
  "system.notifyOwner",

  // ── Lego Packs (páginas públicas /lego-packs/*) ─────────────────────────────
  "legoPacks.listPublic",
  "legoPacks.listPublicByCategory",
  "legoPacks.getBySlug",
  "legoPacks.calculatePrice",

  // ── Packs (páginas públicas /packs/*) ──────────────────────────────────────
  "packs.getTitlesByCategory",
  "packs.getBySlug",
  "packs.getAll",

  // ── Time Slots (selector de horarios en fichas públicas) ─────────────────
  "timeSlots.getByProduct",

  // ── Descuentos y cupones (validación pública en carrito/checkout) ──────────
  "discounts.validate",

  // ── Ticketing (formularios públicos de incidencias/solicitudes) ─────────
  "ticketing.listActiveProducts",
  "ticketing.createSubmission",

  // ── Cancelaciones (solicitud pública de cancelación) ─────────────────────
  "cancellations.createRequest",

  // ── Reservas Redsys (pago online público) ────────────────────────────────
  "reservations.createAndPay",
  "reservations.cartCheckout",
  "reservations.getStatus",
  "reservations.getByLocator",
]);

// ─── Parsear el nombre del procedimiento desde la URL de tRPC ─────────────────
// /api/trpc/auth.me          → "auth.me"
// /api/trpc/auth.me,hotel.x  → ["auth.me", "hotel.x"]  (batch)
function extractProcedureNames(url: string): string[] {
  // Eliminar query string
  const path = url.split("?")[0];
  // Eliminar el prefijo /api/trpc/
  const procedurePart = path.replace(/^\/api\/trpc\//, "").replace(/^\//, "");
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
