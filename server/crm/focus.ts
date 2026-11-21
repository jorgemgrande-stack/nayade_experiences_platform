/**
 * Criterios únicos de los indicadores accionables del CRM (fase comercial 1I).
 *
 * El panel comercial cuenta con estos mismos predicados y los listados los aplican al filtrar con `focus`, de modo que
 * «el número del indicador» y «los resultados del destino» no pueden divergir. Todo es solo lectura.
 */
import { OPEN_STAGES, type Company, type CompanyLifecycle, type Contract, type Lead, type Opportunity } from "./types";

export const DAY_MS = 86_400_000;
/** Horizonte de renovaciones: contratos activos con renovación hasta dentro de 30 días (incluye fechas ya pasadas). */
export const RENEWAL_HORIZON_DAYS = 30;

export const LEAD_FOCUS = ["active", "unowned", "untouched"] as const;
export type LeadFocus = (typeof LEAD_FOCUS)[number];
export const OPPORTUNITY_FOCUS = ["open", "overdue-next-action", "no-next-action", "no-owner"] as const;
export type OpportunityFocus = (typeof OPPORTUNITY_FOCUS)[number];
export const CONTRACT_FOCUS = ["active", "to-sign", "signed", "renewals"] as const;
export type ContractFocus = (typeof CONTRACT_FOCUS)[number];
export const COMPANY_FOCUS = ["customers", "platform", "prospects"] as const;
export type CompanyFocus = (typeof COMPANY_FOCUS)[number];

const ACTIVE_LEAD = (l: Lead) => !l.archivedAt && (l.status === "new" || l.status === "contacted" || l.status === "qualified");

/** Leads en curso (nuevos, contactados o cualificados, sin archivar) y, de ellos, los que nadie lleva. */
/** «Sin tocar»: nuevos (sin primer contacto) con más de 7 días desde el alta. */
export const UNTOUCHED_DAYS = 7;
export const leadMatches = (f: LeadFocus, l: Lead, now: number = Date.now()): boolean => {
  if (f === "active") return ACTIVE_LEAD(l);
  if (f === "unowned") return ACTIVE_LEAD(l) && !l.owner?.trim();
  return !l.archivedAt && l.status === "new" && now - l.createdAt > UNTOUCHED_DAYS * DAY_MS;
};

export const opportunityMatches = (f: OpportunityFocus, o: Opportunity, now: number): boolean => {
  if (!OPEN_STAGES.includes(o.stage)) return false;
  if (f === "open") return true;
  if (f === "no-owner") return !o.owner?.trim();
  if (f === "overdue-next-action") return o.nextActionAt !== null && o.nextActionAt < now;
  return o.nextActionAt === null;
};

export const contractMatches = (f: ContractFocus, c: Contract, now: number): boolean => {
  if (f === "to-sign") return c.status === "draft" || c.status === "sent";
  if (f === "signed") return c.status === "signed";
  if (f === "active") return c.status === "active";
  return c.status === "active" && c.renewalDate !== null && c.renewalDate <= now + RENEWAL_HORIZON_DAYS * DAY_MS;
};

/** Empresas activas por situación comercial (la fase la calcula `withLifecycle`: prospecto, cliente o con plataforma). */
export const companyMatches = (f: CompanyFocus, c: Company & { lifecycle: CompanyLifecycle }): boolean => {
  if (c.status !== "active") return false;
  if (f === "customers") return c.lifecycle !== "prospect";
  if (f === "platform") return c.lifecycle === "tenant";
  return c.lifecycle === "prospect";
};

/**
 * Origen de un evento del historial, a partir del prefijo de `author`:
 *  - human: personas del equipo (`operator:*`, `user:*`);
 *  - automatic: procesos (`system:*`, `web:*`, `public:*` —quien actúa desde un enlace público—, `panel:*`, `service:*`,
 *    `stripe:*` y las operaciones por lote `operacion:*` / `catalogo:*`);
 *  - unknown: cualquier otro valor. Nunca se atribuye a una persona: se muestra aparte, sin clasificar.
 */
export type ActivityOrigin = "human" | "automatic" | "unknown";
const HUMAN_PREFIX = ["operator", "user"];
const AUTOMATIC_PREFIX = ["system", "web", "public", "panel", "service", "stripe", "operacion", "catalogo", "cron", "webhook"];
export function activityOrigin(author: string | null | undefined): ActivityOrigin {
  const a = (author ?? "").trim();
  const prefix = a.includes(":") ? a.slice(0, a.indexOf(":")).toLowerCase() : "";
  if (prefix && HUMAN_PREFIX.includes(prefix)) return "human";
  if (prefix && AUTOMATIC_PREFIX.includes(prefix)) return "automatic";
  return "unknown";
}
/**
 * Casos ambiguos documentados:
 *  - `panel:*` lo origina el cliente desde su panel (no un comercial): automático;
 *  - `operacion:*` / `catalogo:*` son revisiones por lote lanzadas por el equipo técnico: automático (proceso), aunque
 *    detrás haya una persona;
 *  - un autor sin prefijo (nombre suelto, datos anteriores) es `unknown`: ni humano ni automático.
 */
export const AMBIGUOUS_NOTE =
  "Se clasifica por el prefijo del autor. «panel:*», «operacion:*» y «catalogo:*» se tratan como procesos; un autor sin prefijo reconocible queda como «sin clasificar» y no se atribuye a ninguna persona.";
