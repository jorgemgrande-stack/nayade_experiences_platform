/**
 * Travel Net — lógica pura (sin base de datos): márgenes comerciales, precio de cada servicio, líneas del presupuesto
 * del Core, ciclo del expediente y máquina de estados de las operaciones con proveedores.
 *
 * Importes en céntimos; porcentajes en puntos básicos (1000 = 10 %).
 *
 * Precio de un servicio (pricing_mode):
 *  - `neto`: el proveedor da un coste neto; PVP = neto × (1 + recargo de la regla vigente).
 *  - `comision`: el proveedor fija el PVP y paga una comisión; coste = PVP × (1 − comisión).
 *  - `manual`: PVP y coste a mano (inventario propio o acuerdo puntual).
 * Regla vigente: la del proveedor; si no, la de la sede; si no, la global; si no, 20 % de recargo y 0 % de comisión.
 */

export const SERVICE_KINDS = ["alojamiento", "actividad", "transporte", "seguro", "traslado", "otro"] as const;
export type ServiceKind = (typeof SERVICE_KINDS)[number];

export const SERVICE_SOURCES = ["proveedor", "propio"] as const;
export const PRICING_MODES = ["neto", "comision", "manual"] as const;
export type PricingMode = (typeof PRICING_MODES)[number];

export const MARGIN_SCOPES = ["global", "sede", "proveedor"] as const;
export type MarginScope = (typeof MARGIN_SCOPES)[number];
export type RuleSource = MarginScope | "defecto" | "manual";

export const DEFAULT_MARKUP_BP = 2000;
export const DEFAULT_COMMISSION_BP = 0;
export const MAX_MARKUP_BP = 20000;
export const MAX_COMMISSION_BP = 10000;

export interface MarginRule {
  scope: MarginScope;
  scopeKey: string;
  markupBp: number;
  commissionBp: number;
  isActive: boolean;
}

export interface ResolvedRule {
  markupBp: number;
  commissionBp: number;
  source: RuleSource;
}

/** Regla vigente para un servicio: proveedor → sede → global → por defecto. Las desactivadas heredan del siguiente. */
export function resolveMarginRule(rules: readonly MarginRule[], ctx: { supplierId: number | null; siteId: string | null }): ResolvedRule {
  const find = (scope: MarginScope, key: string) => rules.find((r) => r.isActive && r.scope === scope && r.scopeKey === key);
  const hit =
    (ctx.supplierId != null ? find("proveedor", String(ctx.supplierId)) : undefined) ??
    (ctx.siteId ? find("sede", ctx.siteId) : undefined) ??
    find("global", "");
  if (hit) return { markupBp: hit.markupBp, commissionBp: hit.commissionBp, source: hit.scope };
  return { markupBp: DEFAULT_MARKUP_BP, commissionBp: DEFAULT_COMMISSION_BP, source: "defecto" };
}

export function marginRuleError(r: { markupBp: number; commissionBp: number }): string | null {
  if (!Number.isInteger(r.markupBp) || r.markupBp < 0 || r.markupBp > MAX_MARKUP_BP) return "El recargo debe estar entre el 0 % y el 200 %.";
  if (!Number.isInteger(r.commissionBp) || r.commissionBp < 0 || r.commissionBp > MAX_COMMISSION_BP) return "La comisión debe estar entre el 0 % y el 100 %.";
  return null;
}

export interface ServicePrice {
  netCents: number;
  sellingCents: number;
  marginCents: number;
  /** Margen sobre el PVP, en puntos básicos. */
  marginBp: number;
  markupBp: number | null;
  commissionBp: number | null;
  ruleSource: RuleSource;
}

const round = (n: number) => Math.round(n);

/**
 * Precio de un servicio. `amountCents` es el neto (modo neto), el PVP del proveedor (modo comisión) o el PVP (manual,
 * con `netCents` aparte). Nunca devuelve importes negativos.
 */
export function priceService(input: { mode: PricingMode; amountCents: number; netCents?: number; rule: ResolvedRule }): ServicePrice {
  const amount = Math.max(0, round(input.amountCents));
  let net: number;
  let selling: number;
  let markup: number | null = null;
  let commission: number | null = null;
  let source: RuleSource = input.rule.source;
  if (input.mode === "neto") {
    net = amount;
    markup = input.rule.markupBp;
    selling = round(net * (1 + markup / 10000));
  } else if (input.mode === "comision") {
    selling = amount;
    commission = input.rule.commissionBp;
    net = round(selling * (1 - commission / 10000));
  } else {
    selling = amount;
    net = Math.max(0, round(input.netCents ?? 0));
    source = "manual";
  }
  const margin = selling - net;
  return { netCents: net, sellingCents: selling, marginCents: margin, marginBp: selling > 0 ? round((margin / selling) * 10000) : 0, markupBp: markup, commissionBp: commission, ruleSource: source };
}

export interface FileTotals {
  netCents: number;
  sellingCents: number;
  marginCents: number;
  marginBp: number;
}

export function fileTotals(services: ReadonlyArray<{ netCents: number; sellingCents: number }>): FileTotals {
  const net = services.reduce((s, x) => s + x.netCents, 0);
  const selling = services.reduce((s, x) => s + x.sellingCents, 0);
  return { netCents: net, sellingCents: selling, marginCents: selling - net, marginBp: selling > 0 ? round(((selling - net) / selling) * 10000) : 0 };
}

export interface QuoteLine {
  description: string;
  quantity: number;
  unitPrice: number;
  total: number;
  fiscalRegime: "reav" | "general";
  taxRate: number;
  serviceDate?: string;
}

const KIND_LABEL: Record<string, string> = {
  alojamiento: "Alojamiento", actividad: "Actividad", transporte: "Transporte", seguro: "Seguro", traslado: "Traslado", otro: "Servicio",
};

/**
 * Líneas del presupuesto del Core (precios con IVA incluido): una por servicio con su PVP. En REAV el IVA va
 * incluido en el margen (taxRate 0 en la línea, como el resto de líneas REAV del Core); en régimen general, el tipo
 * del expediente. El coste neto y el margen nunca salen en el presupuesto.
 */
export function quoteLines(
  services: ReadonlyArray<{ kind: string; title: string; quantity: number; sellingCents: number; serviceDate: string | null }>,
  fiscal: { regime: "reav" | "general"; taxRateBp: number },
): QuoteLine[] {
  return services
    .filter((s) => s.sellingCents > 0)
    .map((s) => {
      const qty = Math.max(1, s.quantity);
      const total = s.sellingCents / 100;
      return {
        description: `${KIND_LABEL[s.kind] ?? "Servicio"}: ${s.title}`,
        quantity: qty,
        unitPrice: Math.round((total / qty) * 100) / 100,
        total,
        fiscalRegime: fiscal.regime,
        taxRate: fiscal.regime === "reav" ? 0 : fiscal.taxRateBp / 100,
        ...(s.serviceDate ? { serviceDate: s.serviceDate } : {}),
      };
    });
}

// ─── Expediente ───────────────────────────────────────────────────────────────

export const FILE_STATUSES = ["borrador", "presupuestado", "reservado", "cerrado", "cancelado"] as const;
export type FileStatus = (typeof FILE_STATUSES)[number];

/** Estados del presupuesto del Core en los que todavía se puede rehacer (ni aceptado, ni pagado, ni convertido). */
export const QUOTE_EDITABLE = ["borrador", "enviado", "visualizado"] as const;
/** Estados del presupuesto del Core que impiden convertirlo en reserva. */
export const QUOTE_DEAD = ["rechazado", "expirado", "perdido"] as const;

/** Motivo por el que no se pueden cambiar los servicios del expediente, o null. */
export function servicesEditBlocker(fileStatus: string, quoteStatus: string | null): string | null {
  if (fileStatus === "cancelado") return "El expediente está cancelado.";
  if (fileStatus === "reservado" || fileStatus === "cerrado") return "El expediente ya está reservado: sus servicios no se cambian.";
  if (quoteStatus && !(QUOTE_EDITABLE as readonly string[]).includes(quoteStatus)) return "El presupuesto ya se aceptó o pagó: no se cambian los servicios.";
  return null;
}

/** Motivo por el que no se puede convertir en reserva, o null. */
export function conversionBlocker(f: { status: string; quoteId: number | null; services: number }, quoteStatus: string | null): string | null {
  if (f.status === "cancelado") return "El expediente está cancelado.";
  if (f.status === "reservado" || f.status === "cerrado") return "El expediente ya está reservado.";
  if (!f.quoteId) return "Genera primero el presupuesto.";
  if (f.services === 0) return "El expediente no tiene servicios.";
  if (quoteStatus && (QUOTE_DEAD as readonly string[]).includes(quoteStatus)) return "El presupuesto está rechazado, caducado o perdido.";
  if (quoteStatus === "borrador") return "Envía el presupuesto al cliente antes de convertirlo.";
  return null;
}

/** Número de expediente: EXP-AAAA-000123 (año del alta). */
export function fileNumber(id: number, year: number): string {
  return `EXP-${year}-${String(id).padStart(6, "0")}`;
}

// ─── Operaciones con proveedores ──────────────────────────────────────────────

export const OPERATION_STATUSES = [
  "pending_submission", "submitted", "pending_provider_confirmation", "provider_confirmed", "alternative_proposed",
  "alternative_accepted", "alternative_rejected", "requires_manual_action", "consolidated", "provider_cancelled",
  "internally_cancelled", "expired_no_response", "failed",
] as const;
export type OperationStatus = (typeof OPERATION_STATUSES)[number];

export const OPERATION_STATUS_LABEL: Record<OperationStatus, string> = {
  pending_submission: "Pendiente de envío",
  submitted: "Enviada al proveedor",
  pending_provider_confirmation: "Pendiente de confirmación",
  provider_confirmed: "Confirmada por el proveedor",
  alternative_proposed: "Alternativa propuesta",
  alternative_accepted: "Alternativa aceptada",
  alternative_rejected: "Alternativa rechazada",
  requires_manual_action: "Requiere acción manual",
  consolidated: "Consolidada",
  provider_cancelled: "Cancelada por el proveedor",
  internally_cancelled: "Cancelada internamente",
  expired_no_response: "Expirada sin respuesta",
  failed: "Fallida",
};

const TRANSITIONS: Record<OperationStatus, readonly OperationStatus[]> = {
  pending_submission: ["submitted", "internally_cancelled", "failed"],
  submitted: ["pending_provider_confirmation", "provider_confirmed", "requires_manual_action", "failed", "expired_no_response"],
  pending_provider_confirmation: ["provider_confirmed", "alternative_proposed", "provider_cancelled", "requires_manual_action", "expired_no_response"],
  provider_confirmed: ["consolidated", "provider_cancelled", "requires_manual_action"],
  alternative_proposed: ["alternative_accepted", "alternative_rejected"],
  alternative_accepted: ["pending_provider_confirmation", "consolidated"],
  alternative_rejected: ["pending_submission", "internally_cancelled", "requires_manual_action"],
  requires_manual_action: ["pending_submission", "submitted", "pending_provider_confirmation", "provider_confirmed", "internally_cancelled", "failed"],
  consolidated: ["provider_cancelled", "internally_cancelled"],
  provider_cancelled: [],
  internally_cancelled: [],
  expired_no_response: ["pending_submission", "requires_manual_action", "internally_cancelled"],
  failed: ["pending_submission", "requires_manual_action"],
};

export function allowedOperationTransitions(from: string): readonly OperationStatus[] {
  return TRANSITIONS[from as OperationStatus] ?? [];
}

export function operationTransitionError(from: string, to: OperationStatus, opts: { locator?: string | null } = {}): string | null {
  if (!(OPERATION_STATUSES as readonly string[]).includes(from)) return "Estado de operación desconocido.";
  if (!allowedOperationTransitions(from).includes(to)) return `No se puede pasar de «${OPERATION_STATUS_LABEL[from as OperationStatus]}» a «${OPERATION_STATUS_LABEL[to]}».`;
  if (to === "consolidated" && !opts.locator?.trim()) return "Para consolidar hace falta el localizador del proveedor.";
  return null;
}

/** Estados en los que el servicio está firme y se puede emitir su bono. */
export const VOUCHER_STATUSES: readonly OperationStatus[] = ["provider_confirmed", "consolidated"];

/** Agrupación para la bandeja de operaciones. */
export const OPERATION_BUCKETS = {
  pendientes: ["pending_submission"],
  en_curso: ["submitted", "pending_provider_confirmation", "provider_confirmed", "alternative_proposed", "alternative_accepted", "alternative_rejected"],
  atencion: ["requires_manual_action", "expired_no_response", "failed"],
  consolidadas: ["consolidated"],
  canceladas: ["provider_cancelled", "internally_cancelled"],
} as const satisfies Record<string, readonly OperationStatus[]>;
export type OperationBucket = keyof typeof OPERATION_BUCKETS;

/** Plazo de respuesta por defecto del proveedor tras el envío (48 h). */
export const DEFAULT_SLA_MS = 48 * 60 * 60 * 1000;
