/**
 * Permisos de las finanzas corporativas: un ámbito propio por capacidad (`finance:*`, en `controlPlane/auth.ts` y
 * repartidos por rol en `controlPlane/operatorRoles.ts`), exigidos SIEMPRE en el servidor; el CRM solo oculta lo que no
 * se puede.
 *
 *  | Capacidad | Ámbito            | Además             | Qué cubre                                                         |
 *  |-----------|-------------------|--------------------|-------------------------------------------------------------------|
 *  | read      | finance:read      | —                  | consulta financiera (libros, informes, análisis, gestoría)        |
 *  | expenses  | finance:expenses  | —                  | gastos (borradores), recurrentes, categorías, centros de coste,   |
 *  |           |                   |                    | documentos, cuentas de banco y caja, importar extractos y         |
 *  |           |                   |                    | ficheros de Stripe, ignorar movimientos                           |
 *  | suppliers | finance:suppliers | —                  | alta y edición de proveedores                                     |
 *  | post      | finance:post      | sesión de operador | contabilizar, revertir, asientos manuales, conciliar, sincronizar |
 *  |           |                   |                    | facturas, contabilizar Stripe, nóminas, revisión diaria           |
 *  | tax       | finance:tax       | sesión de operador | gestoría: calendario, borradores, presentaciones, pagos,          |
 *  |           |                   |                    | aplazamientos, expedientes, ajustes del 200                       |
 *  | config    | finance:config    | sesión de operador | plan contable, alta de ejercicios, configuración de Stripe/fiscal |
 *  | export    | finance:export    | —                  | CSV, ZIP y libros registro                                        |
 *  | sensitive | finance:sensitive | sesión de operador | cerrar/reabrir periodos, ejercicios y trimestres; reabrir         |
 *  |           |                   |                    | obligaciones presentadas                                          |
 *
 * «Sesión de operador» = solo personas (cookie de operador), nunca un token de servicio ni SSO.
 * Cada denegación (403) se registra en el log estructurado (`Finance` / `permission_denied`) sin datos sensibles:
 * método, patrón de la ruta (sin identificadores), ámbito, motivo y actor.
 */
import type { Request, RequestHandler } from "express";
import { opsLog } from "../_core/ops/log";
import { getAuth, type Scope } from "../controlPlane/auth";

export const FINANCE_CAPABILITIES = ["read", "expenses", "suppliers", "post", "tax", "config", "export", "sensitive"] as const;
export type FinanceCapability = (typeof FINANCE_CAPABILITIES)[number];

/** Ámbito que exige cada capacidad. */
export const FINANCE_SCOPE: Record<FinanceCapability, Scope> = {
  read: "finance:read",
  expenses: "finance:expenses",
  suppliers: "finance:suppliers",
  post: "finance:post",
  tax: "finance:tax",
  config: "finance:config",
  export: "finance:export",
  sensitive: "finance:sensitive",
};

/** Capacidades que además exigen sesión de operador humano. */
export const FINANCE_OPERATOR_ONLY: ReadonlySet<FinanceCapability> = new Set<FinanceCapability>(["post", "tax", "config", "sensitive"]);

/** Marca que lleva el primer manejador de cada capacidad (la prueba de rutas la lee para comprobar el reparto). */
export const FINANCE_CAPABILITY_TAG = Symbol.for("finance.capability");

function denied(req: Request, scope: Scope, reason: "missing_scope" | "operator_session_required"): void {
  const auth = getAuth(req);
  opsLog("warn", "Finance", "permission_denied", {
    method: req.method,
    route: `${req.baseUrl}${typeof req.route?.path === "string" ? req.route.path : ""}`,
    scope,
    reason,
    actorType: auth?.actor.type ?? "anonymous",
    actorId: auth?.actor.id ?? null,
  });
}

function guard(cap: FinanceCapability): RequestHandler[] {
  const scope = FINANCE_SCOPE[cap];
  const checkScope: RequestHandler = (req, res, next) => {
    if (!getAuth(req)?.scopes.has(scope)) {
      denied(req, scope, "missing_scope");
      res.status(403).json({ error: "forbidden", scope, message: `Ámbito requerido: ${scope}` });
      return;
    }
    next();
  };
  Object.defineProperty(checkScope, FINANCE_CAPABILITY_TAG, { value: cap });
  if (!FINANCE_OPERATOR_ONLY.has(cap)) return [checkScope];
  const checkOperator: RequestHandler = (req, res, next) => {
    if (!getAuth(req)?.operator) {
      denied(req, scope, "operator_session_required");
      res.status(403).json({ error: "operator_session_required", message: "Esta operación requiere iniciar sesión como operador" });
      return;
    }
    next();
  };
  return [checkScope, checkOperator];
}

/** Capacidad de un manejador (o `undefined` si no es una comprobación de finanzas). */
export const capabilityOf = (h: unknown): FinanceCapability | undefined =>
  typeof h === "function" ? (h as unknown as Record<symbol, FinanceCapability | undefined>)[FINANCE_CAPABILITY_TAG] : undefined;

/** Consulta financiera. */
export const canRead = guard("read");
/** Gastos, recurrentes, categorías, centros de coste, documentos, bancos y caja operativos. */
export const canExpenses = guard("expenses");
/** Proveedores. */
export const canSuppliers = guard("suppliers");
/** Contabilizar, revertir, asientos manuales, conciliar, sincronizar, Stripe, nóminas: solo personas. */
export const canPost = guard("post");
/** Gestoría: solo personas. */
export const canTax = guard("tax");
/** Configuración contable, de Stripe y fiscal; plan contable y ejercicios: solo personas. */
export const canConfig = guard("config");
/** Exportaciones CSV, ZIP y libros. */
export const canExport = guard("export");
/** Cierres y reaperturas: solo personas. */
export const canSensitive = guard("sensitive");
