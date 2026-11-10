/**
 * Permiso para gestionar precios y paquetes personalizados: UNA sola función, para poder cambiar la regla en un sitio.
 *
 * - Permiso propio (decisión del propietario, 10/11/2026): `commercial.subscription.custom_pricing.manage`, separado de
 *   los de suscripciones y de aprobación de pedidos (tenerlos no da este, y este no da aquellos).
 * - Mientras ese permiso no exista en la lista de ámbitos del plano de control (su alta se publica por el procedimiento
 *   protegido), vale la regla provisional: `subscriptions:write` Y `orders:approve` a la vez. En cuanto el ámbito existe,
 *   se exige SOLO el permiso propio, sin cambiar este código.
 * - Siempre una persona (operador o sesión corporativa): nunca un token de servicio, aunque llevara el ámbito.
 */
import type { RequestHandler } from "express";
import { SCOPES, getAuth } from "../controlPlane/auth";

export const CUSTOM_PRICING_SCOPE = "commercial.subscription.custom_pricing.manage";
export const PROVISIONAL_SCOPES = ["subscriptions:write", "orders:approve"] as const;

/** ¿El permiso propio ya existe en este despliegue? */
export const customPricingScopeDefined = (known: readonly string[] = SCOPES): boolean => known.includes(CUSTOM_PRICING_SCOPE);

export function canManageCustomPricing(scopes: ReadonlySet<string>, known: readonly string[] = SCOPES): boolean {
  if (customPricingScopeDefined(known)) return scopes.has(CUSTOM_PRICING_SCOPE);
  return PROVISIONAL_SCOPES.every((s) => scopes.has(s));
}

export function requireCustomPricing(known: readonly string[] = SCOPES): RequestHandler {
  return (req, res, next) => {
    const auth = getAuth(req);
    if (!auth || auth.actor.type !== "operator") {
      res.status(403).json({ error: "operator_session_required", message: "Los precios personalizados solo los gestiona un administrador central con su sesión" });
      return;
    }
    if (!canManageCustomPricing(auth.scopes as ReadonlySet<string>, known)) {
      res.status(403).json({ error: "forbidden", scope: CUSTOM_PRICING_SCOPE, message: "No tienes permiso para gestionar precios y paquetes personalizados" });
      return;
    }
    next();
  };
}
