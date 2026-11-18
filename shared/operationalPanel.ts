/**
 * Panel operativo del Inicio: lo que el propietario tiene que mirar hoy del circuito comercial de solicitudes y
 * convocatorias, en una sola tarjeta. Reglas puras (servidor y panel): límites, ventanas de fechas, enlaces a las
 * pantallas de siempre y cuándo se enseña la tarjeta. Las lecturas están en server/operationalPanelDb.ts.
 *
 *  - Solicitudes web nuevas (oportunidades `web_solicitud_producto` / `web_solicitud_plaza` en estado «nuevo»).
 *  - Inscripciones «solicitada» / «lista de espera» por convocatoria.
 *  - Inscripciones con presupuesto enlazado aún sin cobrar (el pago se deriva SIEMPRE del presupuesto).
 *  - Participantes confirmados por convocatoria próxima.
 *  - Sesiones de los próximos 30 días («hora por confirmar» si no tienen hora; nunca se inventa).
 *  - Servicios incluidos pendientes de programar.
 *
 * Una sección vacía no se enseña; la tarjeta entera solo aparece si la empresa tiene convocatorias o solicitudes web.
 */
import { WEB_REQUEST_SOURCE_LABELS, isWebRequestSource, productEditionsHref } from "./leadWebRequest";
import { effectiveQuoteStatus, isQuoteDead, isQuotePaid, quotePaymentView } from "./enrollmentCommerce";
import { addDaysToDate } from "./editionSessions";
import { utcMsToLocal } from "./editions";

/** Elementos por lista (los totales se cuentan aparte, sin límite). */
export const PANEL_LIST_LIMIT = 10;
/** Sesiones de hoy a hoy + N días (día local de la zona de cada sesión). */
export const PANEL_SESSION_DAYS = 30;
export const SESSION_TIME_TBC = "hora por confirmar";

// ─── Enlaces a las pantallas de siempre ──────────────────────────────────────

/** Oportunidad en el CRM: la pestaña de oportunidades filtrada por su correo (o su nombre si no tiene). */
export function leadHref(lead: { email?: string | null; name?: string | null }): string {
  const q = (lead.email || lead.name || "").trim();
  return q ? `/admin/crm?tab=leads&search=${encodeURIComponent(q)}` : "/admin/crm?tab=leads";
}

/** Presupuesto en el CRM por su número (como el bloque de inscripciones del panel de convocatorias). */
export function quoteHref(quoteNumber: string): string {
  return `/admin/crm?tab=quotes&search=${encodeURIComponent(quoteNumber)}`;
}

/** Inscripciones, sesiones y servicios de una convocatoria: las convocatorias de su producto. */
export const editionHref = (experienceId: number): string => productEditionsHref(experienceId);

/** Hora de una sesión tal como se enseña: la suya o «hora por confirmar». */
export const sessionTimeLabel = (startTime: string | null | undefined): string => (startTime && /^\d{2}:\d{2}$/.test(startTime) ? startTime : SESSION_TIME_TBC);

// ─── Ventana de sesiones ─────────────────────────────────────────────────────

/** Día local («YYYY-MM-DD») en una zona horaria (zona no válida → UTC). */
export function localDay(now: number, tz: string): string {
  try {
    return utcMsToLocal(now, tz).slice(0, 10);
  } catch {
    return new Date(now).toISOString().slice(0, 10);
  }
}

/** Días que se piden a la BD: con un día de margen a cada lado (cada sesión se filtra después en su propia zona). */
export function sessionQueryRange(now: number, days = PANEL_SESSION_DAYS): { from: string; to: string } {
  const today = new Date(now).toISOString().slice(0, 10);
  return { from: addDaysToDate(today, -1), to: addDaysToDate(today, days + 1) };
}

/** ¿La sesión cae entre hoy y hoy + `days` en SU zona horaria? */
export function inSessionWindow(s: { startsOn: string; timezone?: string | null }, now: number, days = PANEL_SESSION_DAYS): boolean {
  const today = localDay(now, s.timezone || "Europe/Madrid");
  return s.startsOn >= today && s.startsOn <= addDaysToDate(today, days);
}

// ─── Datos de entrada (filas ya leídas) ──────────────────────────────────────

export interface RawWebRequest {
  id: number;
  name: string;
  email: string;
  source: string;
  product: string | null;
  variant: string | null;
  lang: string | null;
  edition: string | null;
  isTest: boolean;
  createdAt: number;
}

export interface RawPendingEdition {
  editionId: number;
  experienceId: number;
  productTitle: string;
  editionLabel: string;
  startsAt: number;
  timezone: string;
  requested: number;
  waitlisted: number;
}

export interface RawLinkedQuote {
  enrollmentId: number;
  name: string;
  enrollmentStatus: string;
  editionId: number;
  experienceId: number;
  productTitle: string;
  editionLabel: string;
  quoteId: number;
  quoteNumber: string;
  quoteStatus: string;
  paidAt: unknown;
  total: number;
}

export interface RawUpcomingEdition {
  id: number;
  experienceId: number;
  productTitle: string;
  label: string;
  status: string;
  startsAt: number;
  endsAt: number | null;
  timezone: string;
  capacity: number | null;
  /** Plazas confirmadas */
  reserved: number;
  confirmedEnrollments: number;
  sessionCount: number;
}

export interface RawSession {
  sessionId: number;
  editionId: number;
  experienceId: number;
  productTitle: string;
  editionLabel: string;
  startsOn: string;
  startTime: string | null;
  durationMinutes: number | null;
  timezone: string;
  index: number;
  total: number;
  participants: number;
}

export interface RawPendingService {
  id: number;
  enrollmentId: number;
  label: string;
  seq: number;
  durationMinutes: number | null;
  personName: string;
  editionId: number;
  experienceId: number;
  productTitle: string;
  editionLabel: string;
}

/** Lo que leyó el servidor. `null` en una sección = no se lee (sin licencia de esa parte). */
export interface RawOperationalPanel {
  editionCount: number;
  webRequests: { total: number; rows: RawWebRequest[] } | null;
  pendingEditions: { total: number; rows: RawPendingEdition[] } | null;
  linkedQuotes: { total: number; rows: RawLinkedQuote[] } | null;
  upcomingEditions: RawUpcomingEdition[] | null;
  sessions: RawSession[] | null;
  pendingServices: { total: number; rows: RawPendingService[] } | null;
}

// ─── Resultado ───────────────────────────────────────────────────────────────

export interface PanelSection<T> {
  total: number;
  items: T[];
}

export interface OperationalPanel {
  /** Se enseña la tarjeta: la empresa tiene convocatorias o solicitudes web. */
  visible: boolean;
  /** Nada pendiente en ninguna sección (la tarjeta lo dice en una línea). */
  allClear: boolean;
  webRequests: PanelSection<{ leadId: number; name: string; sourceLabel: string; product: string | null; variant: string | null; lang: string | null; edition: string | null; isTest: boolean; createdAt: number; href: string }>;
  pendingEnrollments: PanelSection<{ editionId: number; productTitle: string; editionLabel: string; startsAt: number; timezone: string; requested: number; waitlisted: number; href: string }>;
  unpaidQuotes: PanelSection<{ enrollmentId: number; name: string; enrollmentStatus: string; productTitle: string; editionLabel: string; quoteId: number; quoteNumber: string; paymentLabel: string; total: number; href: string; editionHref: string }>;
  upcomingEditions: PanelSection<{ editionId: number; productTitle: string; editionLabel: string; startsAt: number; timezone: string; participants: number; confirmedEnrollments: number; capacity: number | null; sessionCount: number; href: string }>;
  upcomingSessions: PanelSection<{ sessionId: number; editionId: number; productTitle: string; editionLabel: string; startsOn: string; startTime: string | null; timeLabel: string; durationMinutes: number | null; index: number; total: number; participants: number; href: string }>;
  pendingServices: PanelSection<{ id: number; enrollmentId: number; label: string; seq: number; durationMinutes: number | null; personName: string; productTitle: string; editionLabel: string; href: string }>;
}

function empty<T>(): PanelSection<T> {
  return { total: 0, items: [] };
}

/** ¿El presupuesto enlazado sigue pendiente de cobro? (vigente y sin pagar; el pago se deriva de estado + fecha de pago) */
export function isUnpaidLinkedQuote(status: string | null | undefined, paidAt: unknown): boolean {
  const s = effectiveQuoteStatus(status, paidAt);
  return !!s && !isQuotePaid(s) && !isQuoteDead(s);
}

/** Convocatoria «próxima» para el panel: publicada (no borrador ni cancelada) y sin terminar. */
export function isUpcomingEdition(e: Pick<RawUpcomingEdition, "status" | "startsAt" | "endsAt">, now: number): boolean {
  if (e.status === "draft" || e.status === "cancelled") return false;
  return (e.endsAt ?? e.startsAt + 86_400_000) >= now;
}

/** Arma el panel a partir de lo leído: filtra, recorta, enlaza y decide si se enseña. Pura. */
export function buildOperationalPanel(raw: RawOperationalPanel, now: number, limit = PANEL_LIST_LIMIT): OperationalPanel {
  const webRequests = raw.webRequests
    ? {
      total: raw.webRequests.total,
      items: raw.webRequests.rows.slice(0, limit).map((r) => ({
        leadId: r.id,
        name: r.name,
        sourceLabel: isWebRequestSource(r.source) ? WEB_REQUEST_SOURCE_LABELS[r.source] : "Solicitud web",
        product: r.product || null,
        variant: r.variant || null,
        lang: r.lang && /^[a-z]{2}$/.test(r.lang.trim().toLowerCase()) ? r.lang.trim().toLowerCase() : null,
        edition: r.edition || null,
        isTest: r.isTest,
        createdAt: r.createdAt,
        href: leadHref(r),
      })),
    }
    : empty<OperationalPanel["webRequests"]["items"][number]>();

  const pendingEnrollments = raw.pendingEditions
    ? {
      total: raw.pendingEditions.total,
      items: raw.pendingEditions.rows.filter((r) => r.requested + r.waitlisted > 0).slice(0, limit).map((r) => ({
        editionId: r.editionId, productTitle: r.productTitle, editionLabel: r.editionLabel, startsAt: r.startsAt, timezone: r.timezone,
        requested: r.requested, waitlisted: r.waitlisted, href: editionHref(r.experienceId),
      })),
    }
    : empty<OperationalPanel["pendingEnrollments"]["items"][number]>();

  // Presupuestos: la BD ya excluye los cobrados y los muertos; aquí se vuelve a comprobar con la misma regla de siempre
  const unpaidRows = raw.linkedQuotes ? raw.linkedQuotes.rows.filter((r) => r.enrollmentStatus !== "cancelada" && isUnpaidLinkedQuote(r.quoteStatus, r.paidAt)) : [];
  const unpaidQuotes = raw.linkedQuotes
    ? {
      total: Math.max(0, raw.linkedQuotes.total - (raw.linkedQuotes.rows.length - unpaidRows.length)),
      items: unpaidRows.slice(0, limit).map((r) => ({
        enrollmentId: r.enrollmentId, name: r.name, enrollmentStatus: r.enrollmentStatus, productTitle: r.productTitle, editionLabel: r.editionLabel,
        quoteId: r.quoteId, quoteNumber: r.quoteNumber, paymentLabel: quotePaymentView(effectiveQuoteStatus(r.quoteStatus, r.paidAt)).label, total: r.total,
        href: quoteHref(r.quoteNumber), editionHref: editionHref(r.experienceId),
      })),
    }
    : empty<OperationalPanel["unpaidQuotes"]["items"][number]>();

  const upcoming = (raw.upcomingEditions ?? []).filter((e) => isUpcomingEdition(e, now)).sort((a, b) => a.startsAt - b.startsAt || a.id - b.id);
  const upcomingEditions = {
    total: upcoming.length,
    items: upcoming.slice(0, limit).map((e) => ({
      editionId: e.id, productTitle: e.productTitle, editionLabel: e.label, startsAt: e.startsAt, timezone: e.timezone,
      participants: e.reserved, confirmedEnrollments: e.confirmedEnrollments, capacity: e.capacity, sessionCount: e.sessionCount, href: editionHref(e.experienceId),
    })),
  };

  const sessions = (raw.sessions ?? []).filter((s) => inSessionWindow(s, now)).sort((a, b) => (a.startsOn < b.startsOn ? -1 : a.startsOn > b.startsOn ? 1 : (a.startTime ?? "99:99").localeCompare(b.startTime ?? "99:99") || a.sessionId - b.sessionId));
  const upcomingSessions = {
    total: sessions.length,
    items: sessions.slice(0, limit).map((s) => ({
      sessionId: s.sessionId, editionId: s.editionId, productTitle: s.productTitle, editionLabel: s.editionLabel, startsOn: s.startsOn, startTime: s.startTime,
      timeLabel: sessionTimeLabel(s.startTime), durationMinutes: s.durationMinutes, index: s.index, total: s.total, participants: s.participants, href: editionHref(s.experienceId),
    })),
  };

  const pendingServices = raw.pendingServices
    ? {
      total: raw.pendingServices.total,
      items: raw.pendingServices.rows.slice(0, limit).map((s) => ({
        id: s.id, enrollmentId: s.enrollmentId, label: s.label, seq: s.seq, durationMinutes: s.durationMinutes, personName: s.personName,
        productTitle: s.productTitle, editionLabel: s.editionLabel, href: editionHref(s.experienceId),
      })),
    }
    : empty<OperationalPanel["pendingServices"]["items"][number]>();

  const sections = [webRequests, pendingEnrollments, unpaidQuotes, upcomingEditions, upcomingSessions, pendingServices];
  return {
    visible: raw.editionCount > 0 || webRequests.total > 0,
    allClear: sections.every((s) => s.total === 0),
    webRequests,
    pendingEnrollments,
    unpaidQuotes,
    upcomingEditions,
    upcomingSessions,
    pendingServices,
  };
}

/** Panel vacío (sin datos o sin poder leer): la tarjeta no se enseña. */
export const EMPTY_OPERATIONAL_PANEL: OperationalPanel = buildOperationalPanel(
  { editionCount: 0, webRequests: null, pendingEditions: null, linkedQuotes: null, upcomingEditions: null, sessions: null, pendingServices: null },
  0,
);
