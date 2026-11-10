/**
 * Exportaciones CSV de TPV Advanced (patrón de server/tpvReports.ts): separador «;», coma decimal, UTF-8 con BOM para
 * que Excel lea las tildes, y celdas de texto sin fórmulas (lo que empieza por = + - @ se prefija con '). Pura.
 */
import { AUDIT_TYPE_LABELS, AUTH_KIND_LABELS, AUTH_STATUS_LABELS, COUNT_KIND_LABELS, HANDOVER_STATUS_LABELS, type AdvReportSection, type AuditEvent } from "../shared/tpvAdvanced";
import type { AuthorizationRow, CountReportRow, HandoverRow, OperatorReportRow, ShiftReportRow } from "./tpvAdvancedDb";

const num = (n: number) => n.toFixed(2).replace(".", ",");
function madridDateTime(ms: number | null): string {
  if (ms === null) return "";
  return new Intl.DateTimeFormat("es-ES", { timeZone: "Europe/Madrid", dateStyle: "short", timeStyle: "short" }).format(new Date(ms));
}
export function textCell(v: string): string {
  const s = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return `"${s.replace(/"/g, '""')}"`;
}

type Cell = { t: string } | { n: number | null } | { i: number };
const T = (t: string | null): Cell => ({ t: t ?? "" });
const N = (n: number | null): Cell => ({ n });
const I = (i: number): Cell => ({ i });
const D = (ms: number | null): Cell => ({ t: madridDateTime(ms) });
const render = (c: Cell) => ("t" in c ? textCell(c.t) : "n" in c ? (c.n === null ? "" : num(c.n)) : String(c.i));

export interface AdvReportData {
  turnos?: ShiftReportRow[];
  operadores?: OperatorReportRow[];
  arqueos?: CountReportRow[];
  entregas?: (HandoverRow & { register: string })[];
  autorizaciones?: AuthorizationRow[];
  auditoria?: AuditEvent[];
}

export function advSectionCsv(section: AdvReportSection, d: AdvReportData): string {
  let header: string[] = [];
  let rows: Cell[][] = [];
  switch (section) {
    case "turnos":
      header = ["Caja", "Operador", "Inicio", "Fin", "Minutos", "Efectivo al empezar", "Ventas", "Importe ventas", "Efectivo", "Tarjeta", "Bizum", "Otros", "Entradas", "Salidas", "Efectivo esperado", "Efectivo al acabar", "Diferencia"];
      rows = (d.turnos ?? []).map((s) => [T(s.register), T(s.operator), D(s.startedAt), D(s.endedAt), I(s.minutes), N(s.openingCash), I(s.sales), N(s.salesTotal), N(s.cash), N(s.card), N(s.bizum), N(s.other), N(s.cashIn), N(s.cashOut), N(s.expectedCash), N(s.closingCash), N(s.difference)]);
      break;
    case "operadores":
      header = ["Operador", "Turnos", "Minutos", "Ventas", "Importe ventas", "Diferencia de turnos", "Entregas dadas", "Entregas recibidas", "Diferencia al recibir", "Arqueos", "Diferencia de arqueos"];
      rows = (d.operadores ?? []).map((o) => [T(o.operator), I(o.shifts), I(o.minutes), I(o.sales), N(o.salesTotal), N(o.shiftDifference), I(o.handoversGiven), I(o.handoversReceived), N(o.handoverDifference), I(o.counts), N(o.countDifference)]);
      break;
    case "arqueos":
      header = ["Caja", "Tipo", "Fecha", "Hecho por", "Efectivo contado", "Efectivo esperado", "Diferencia efectivo", "Tarjeta declarada", "Tarjeta esperada", "Diferencia tarjeta", "Bizum declarado", "Bizum esperado", "Diferencia Bizum", "Otros declarado", "Otros esperado", "Diferencia otros", "Notas"];
      rows = (d.arqueos ?? []).map((c) => [
        T(c.register), T(COUNT_KIND_LABELS[c.kind]), D(c.createdAt), T(c.createdByName), N(c.countedCash), N(c.expectedCash), N(c.cashDifference),
        N(c.declared.card), N(c.expected.card), N(c.differences.card), N(c.declared.bizum), N(c.expected.bizum), N(c.differences.bizum),
        N(c.declared.other), N(c.expected.other), N(c.differences.other), T(c.notes),
      ]);
      break;
    case "entregas":
      header = ["Caja", "Entrega", "Recibe", "Estado", "Declarado", "Recibido", "Diferencia", "Declarada", "Recibida", "Notas de la entrega", "Notas de la recepción"];
      rows = (d.entregas ?? []).map((h) => [T(h.register), T(h.fromName), T(h.toName), T(HANDOVER_STATUS_LABELS[h.status]), N(h.declaredCash), N(h.receivedCash), N(h.difference), D(h.declaredAt), D(h.receivedAt), T(h.declaredNotes), T(h.receivedNotes)]);
      break;
    case "autorizaciones":
      header = ["Operación", "Estado", "Importe o %", "Umbral", "Referencia", "Motivo", "Pedida por", "Pedida", "Resuelta por", "Resuelta", "Nota", "Aplicada", "Aplicada a"];
      rows = (d.autorizaciones ?? []).map((a) => [T(AUTH_KIND_LABELS[a.kind]), T(AUTH_STATUS_LABELS[a.status]), N(a.amount), N(a.threshold), T(a.reference), T(a.reason), T(a.requestedByName), D(a.requestedAt), T(a.decidedByName), D(a.decidedAt), T(a.decisionNote), D(a.usedAt), T(a.usedRef)]);
      break;
    case "auditoria":
      header = ["Fecha", "Tipo", "Caja", "Persona", "Importe", "Detalle"];
      rows = (d.auditoria ?? []).map((e) => [D(e.at), T(AUDIT_TYPE_LABELS[e.type]), T(e.registerName), T(e.actor), N(e.amount), T(e.detail)]);
      break;
  }
  const lines = [header.map(textCell).join(";"), ...rows.map((r) => r.map(render).join(";"))];
  return "﻿" + lines.join("\r\n") + "\r\n";
}

export function advCsvFilename(section: AdvReportSection, from: string, to: string): string {
  return `tpv-avanzado-${section}-${from}_${to}.csv`;
}
