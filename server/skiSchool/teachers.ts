/**
 * Ski Net · Profesores (lógica pura, sin BD): condiciones de pago por profesor (por hora, % de lo facturado o fijo
 * mensual), horas exigidas por semana prorrateadas al periodo, cálculo de la liquidación (importes en céntimos que se
 * congelan al cerrarla), asistencia por sesión y exportación (CSV y HTML para el PDF).
 */
import { RuleError, dayNumber, toMinutes } from "./rules";

export const PAY_MODES = ["hourly", "percent", "monthly"] as const;
export type PayMode = (typeof PAY_MODES)[number];
export const PAY_MODE_LABEL: Record<PayMode, string> = { hourly: "Por hora", percent: "% de lo facturado", monthly: "Fijo mensual" };

export interface PayTerms {
  payMode: PayMode | null;
  /** Por hora, en céntimos. */
  hourlyRateCents: number | null;
  /** % de lo facturado, en puntos básicos (2500 = 25 %). */
  percentBp: number | null;
  /** Fijo mensual, en céntimos. */
  monthlyCents: number | null;
  /** Horas exigidas por semana, en minutos (null = sin objetivo). */
  requiredMinutesWeek: number | null;
}

const intOrNull = (v: number | null | undefined, min: number, max: number, what: string): number | null => {
  if (v == null) return null;
  if (!Number.isInteger(v) || v < min || v > max) throw new RuleError(`${what}: valor no válido`);
  return v;
};

/** Valida las condiciones: el modo elegido debe llevar su importe. */
export function normalizePayTerms(t: Partial<PayTerms>): PayTerms {
  const payMode = t.payMode ?? null;
  if (payMode !== null && !PAY_MODES.includes(payMode)) throw new RuleError("Modo de pago no válido");
  const out: PayTerms = {
    payMode,
    hourlyRateCents: intOrNull(t.hourlyRateCents, 0, 100_000, "Tarifa por hora"),
    percentBp: intOrNull(t.percentBp, 0, 10_000, "Porcentaje"),
    monthlyCents: intOrNull(t.monthlyCents, 0, 10_000_000, "Fijo mensual"),
    requiredMinutesWeek: intOrNull(t.requiredMinutesWeek, 0, 7 * 24 * 60, "Horas exigidas por semana"),
  };
  if (payMode === "hourly" && out.hourlyRateCents == null) throw new RuleError("Indica la tarifa por hora");
  if (payMode === "percent" && out.percentBp == null) throw new RuleError("Indica el porcentaje de lo facturado");
  if (payMode === "monthly" && out.monthlyCents == null) throw new RuleError("Indica el fijo mensual");
  return out;
}

// ── Horas ───────────────────────────────────────────────────────────────────────

export const MAX_PERIOD_DAYS = 92;

export function periodDays(from: string, to: string): number {
  const a = dayNumber(from);
  const b = dayNumber(to);
  if (b < a) throw new RuleError("La fecha final es anterior a la inicial");
  if (b - a + 1 > MAX_PERIOD_DAYS) throw new RuleError(`El periodo no puede superar ${MAX_PERIOD_DAYS} días`);
  return b - a + 1;
}

export const sessionMinutes = (start: string, end: string) => Math.max(0, toMinutes(end) - toMinutes(start));

/** Minutos exigidos en el periodo: el objetivo semanal prorrateado por días naturales. */
export function proratedRequiredMinutes(requiredMinutesWeek: number | null, from: string, to: string): number | null {
  if (requiredMinutesWeek == null) return null;
  return Math.round((requiredMinutesWeek * periodDays(from, to)) / 7);
}

export interface HoursInput {
  instructorId: number;
  status: string;
  startTime: string;
  endTime: string;
}

/** Minutos programados (asignadas o impartidas) e impartidos por profesor. */
export function hoursByInstructor(sessions: HoursInput[]): Map<number, { scheduled: number; taught: number; sessions: number }> {
  const out = new Map<number, { scheduled: number; taught: number; sessions: number }>();
  for (const s of sessions) {
    if (s.status !== "assigned" && s.status !== "completed") continue;
    const m = sessionMinutes(s.startTime, s.endTime);
    const cur = out.get(s.instructorId) ?? { scheduled: 0, taught: 0, sessions: 0 };
    cur.scheduled += m;
    cur.sessions += 1;
    if (s.status === "completed") cur.taught += m;
    out.set(s.instructorId, cur);
  }
  return out;
}

// ── Liquidación ─────────────────────────────────────────────────────────────────

/** Meses naturales completos del periodo (el fijo mensual solo se liquida por meses completos). */
export function wholeMonths(from: string, to: string): number {
  periodDays(from, to);
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  const lastDay = new Date(Date.UTC(ty, tm, 0)).getUTCDate();
  if (fd !== 1 || td !== lastDay) throw new RuleError("El fijo mensual se liquida por meses completos (del día 1 al último del mes)");
  return (ty - fy) * 12 + (tm - fm) + 1;
}

export interface SettleSession {
  sessionId: number;
  date: string;
  startTime: string;
  endTime: string;
  productName: string;
  /** Lo facturado atribuible a la sesión, en céntimos (solo para el modo %). */
  baseCents: number;
}

export interface SettlementLineDraft {
  sessionId: number | null;
  date: string | null;
  description: string;
  minutes: number;
  baseCents: number;
  amountCents: number;
}

export interface SettlementDraft {
  payMode: PayMode;
  terms: PayTerms;
  minutes: number;
  sessions: number;
  baseCents: number;
  totalCents: number;
  lines: SettlementLineDraft[];
}

/** Calcula la liquidación de las sesiones impartidas del periodo con las condiciones del profesor. */
export function computeSettlement(terms: PayTerms, sessions: SettleSession[], from: string, to: string): SettlementDraft {
  if (!terms.payMode) throw new RuleError("El profesor no tiene condiciones de pago configuradas");
  periodDays(from, to);
  const sorted = [...sessions].sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime) || a.sessionId - b.sessionId);
  const lines: SettlementLineDraft[] = sorted.map((s) => {
    const minutes = sessionMinutes(s.startTime, s.endTime);
    const amountCents = terms.payMode === "hourly" ? Math.round((minutes * terms.hourlyRateCents!) / 60) : terms.payMode === "percent" ? Math.round((s.baseCents * terms.percentBp!) / 10_000) : 0;
    return { sessionId: s.sessionId, date: s.date, description: `${s.productName} · ${s.startTime}–${s.endTime}`, minutes, baseCents: terms.payMode === "percent" ? s.baseCents : 0, amountCents };
  });
  if (terms.payMode === "monthly") {
    const months = wholeMonths(from, to);
    lines.push({ sessionId: null, date: null, description: `Fijo mensual × ${months}`, minutes: 0, baseCents: 0, amountCents: terms.monthlyCents! * months });
  }
  if (terms.payMode !== "monthly" && lines.length === 0) throw new RuleError("No hay sesiones impartidas sin liquidar en ese periodo");
  return {
    payMode: terms.payMode,
    terms,
    minutes: lines.reduce((a, l) => a + l.minutes, 0),
    sessions: sorted.length,
    baseCents: lines.reduce((a, l) => a + l.baseCents, 0),
    totalCents: lines.reduce((a, l) => a + l.amountCents, 0),
    lines,
  };
}

/** Lo facturado de una reserva repartido a partes iguales entre sus sesiones no canceladas (el resto, a la primera). */
export function splitReservation(amountPaidCents: number, sessionIds: number[]): Map<number, number> {
  const out = new Map<number, number>();
  if (!sessionIds.length) return out;
  const ids = [...sessionIds].sort((a, b) => a - b);
  const each = Math.floor(amountPaidCents / ids.length);
  ids.forEach((id, i) => out.set(id, each + (i === 0 ? amountPaidCents - each * ids.length : 0)));
  return out;
}

// ── Asistencia ──────────────────────────────────────────────────────────────────

export const ATTENDANCE_STATUSES = ["present", "absent", "late"] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];

/** Pasar lista: una entrada por cada alumno inscrito, ni más ni menos. */
export function checkAttendance(enrolledIds: number[], entries: Array<{ participantId: number; status: string }>): void {
  const seen = new Set<number>();
  for (const e of entries) {
    if (!ATTENDANCE_STATUSES.includes(e.status as AttendanceStatus)) throw new RuleError("Estado de asistencia no válido");
    if (seen.has(e.participantId)) throw new RuleError("Hay un alumno repetido en la lista");
    if (!enrolledIds.includes(e.participantId)) throw new RuleError("Hay un alumno que no está inscrito en la sesión");
    seen.add(e.participantId);
  }
  if (seen.size !== enrolledIds.length) throw new RuleError("Falta marcar la asistencia de algún alumno");
}

// ── Exportación ─────────────────────────────────────────────────────────────────

export const formatEuros = (cents: number) => (cents / 100).toFixed(2).replace(".", ",");
const formatHours = (minutes: number) => (minutes / 60).toFixed(2).replace(".", ",");

function csvCell(v: string | number | null): string {
  const s = v == null ? "" : String(v);
  // Evita que una hoja de cálculo interprete fórmulas en datos del usuario
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[;"\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export interface SettlementExport {
  id: number;
  instructorName: string;
  periodStart: string;
  periodEnd: string;
  payMode: PayMode;
  minutes: number;
  totalCents: number;
  status: string;
  lines: Array<{ date: string | null; description: string; minutes: number; baseCents: number; amountCents: number }>;
}

/** CSV con «;» y coma decimal (lo que abre bien una hoja de cálculo en español). */
export function settlementCsv(s: SettlementExport): string {
  const rows: Array<Array<string | number | null>> = [
    ["Liquidación", s.id],
    ["Profesor", s.instructorName],
    ["Periodo", `${s.periodStart} a ${s.periodEnd}`],
    ["Modo de pago", PAY_MODE_LABEL[s.payMode]],
    ["Estado", s.status === "closed" ? "Cerrada" : "Anulada"],
    [],
    ["Fecha", "Concepto", "Horas", "Facturado (EUR)", "Importe (EUR)"],
    ...s.lines.map((l) => [l.date, l.description, formatHours(l.minutes), formatEuros(l.baseCents), formatEuros(l.amountCents)]),
    [],
    ["Total", "", formatHours(s.minutes), "", formatEuros(s.totalCents)],
  ];
  return "﻿" + rows.map((r) => r.map(csvCell).join(";")).join("\r\n") + "\r\n";
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** HTML de la liquidación para el generador de PDF del Core. */
export function settlementHtml(s: SettlementExport, companyName: string): string {
  const rows = s.lines
    .map((l) => `<tr><td>${esc(l.date ?? "")}</td><td>${esc(l.description)}</td><td class="n">${formatHours(l.minutes)}</td><td class="n">${formatEuros(l.baseCents)}</td><td class="n">${formatEuros(l.amountCents)}</td></tr>`)
    .join("");
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Liquidación ${s.id}</title>
<style>body{font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#111;margin:32px}h1{font-size:18px;margin:0 0 4px}
p{margin:2px 0;color:#444}table{width:100%;border-collapse:collapse;margin-top:16px}th,td{border-bottom:1px solid #ddd;padding:6px;text-align:left}
th{background:#f3f4f6}.n{text-align:right}tfoot td{font-weight:bold;border-top:2px solid #111}</style></head><body>
<h1>Liquidación nº ${s.id}${s.status === "closed" ? "" : " (anulada)"}</h1>
<p>${esc(companyName)}</p><p>Profesor: <strong>${esc(s.instructorName)}</strong></p>
<p>Periodo: ${esc(s.periodStart)} a ${esc(s.periodEnd)} · ${esc(PAY_MODE_LABEL[s.payMode])}</p>
<table><thead><tr><th>Fecha</th><th>Concepto</th><th class="n">Horas</th><th class="n">Facturado (€)</th><th class="n">Importe (€)</th></tr></thead>
<tbody>${rows}</tbody><tfoot><tr><td colspan="2">Total</td><td class="n">${formatHours(s.minutes)}</td><td></td><td class="n">${formatEuros(s.totalCents)}</td></tr></tfoot></table>
</body></html>`;
}
