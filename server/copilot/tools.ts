/**
 * Herramientas de solo lectura de Elephant Copilot: validación de parámetros (zod) y ejecución sobre el puerto de
 * datos (server/copilot/data.ts). La IA solo puede pedir una de estas herramientas con sus parámetros; no hay forma
 * de que ejecute una consulta propia. Cada resultado lleva su periodo para que la respuesta lo cite.
 */
import { z } from "zod";
import { unpaidAfterCredits } from "../coreHomeDb";
import {
  COPILOT_LIMITS,
  COPILOT_TOOL_BY_NAME,
  CopilotInputError,
  addDays,
  bucketOf,
  daysBetween,
  isDay,
  madridDay,
  madridDayStartMs,
  resolveRange,
  slotRunsOn,
  type CopilotToolName,
} from "../../shared/copilot";
import type { CopilotData, ReservationRow } from "./data";

const day = z.string().refine(isDay, "Fecha no válida (AAAA-MM-DD).");
const lim = (max: number, def: number) => z.coerce.number().int().min(1).max(max).default(def);
const range = { desde: day.optional(), hasta: day.optional() };

export const TOOL_ARGS = {
  ventas_periodo: z.object({ ...range, agrupar: z.enum(["dia", "semana", "mes"]).optional() }),
  top_productos: z.object({ ...range, orden: z.enum(["importe", "personas"]).default("importe"), limite: lim(10, 5) }),
  reservas_proximas: z.object({ desde: day.optional(), dias: lim(31, 7), limite: lim(COPILOT_LIMITS.rowsMax, 30) }),
  ocupacion: z.object({ desde: day.optional(), dias: lim(14, 7) }),
  buscar_clientes: z.object({ texto: z.string().max(80).optional(), limite: lim(10, 5) }),
  ficha_cliente: z.object({ clienteId: z.coerce.number().int().positive() }),
  oportunidades_abiertas: z.object({ ...range, limite: lim(20, 10) }),
  presupuestos_pendientes: z.object({ limite: lim(20, 10) }),
  facturas_pendientes: z.object({ limite: lim(30, 15) }),
  ausencias_rrhh: z.object({ ...range }),
} satisfies Record<CopilotToolName, z.ZodTypeAny>;

const euros = (cents: number) => Math.round(cents) / 100;
const round2 = (n: number) => Math.round(n * 100) / 100;
const dayOf = (ms: number | null) => (ms == null ? null : madridDay(ms));
const saleCents = (r: { amountPaid: number; amountTotal: number }) => (r.amountPaid > 0 ? r.amountPaid : r.amountTotal);

function reservationOut(r: ReservationRow) {
  return {
    numero: r.number ?? `#${r.id}`,
    fecha: r.bookingDate,
    hora: r.time,
    producto: r.productName,
    personas: r.people,
    cliente: r.customerName,
    pago: r.status === "paid" ? (r.statusPayment === "PAGO_PARCIAL" ? "pago parcial" : "pagada") : "pendiente de pago",
    estado: r.statusReservation ?? null,
  };
}

/** Parámetros validados de una herramienta (los que la IA no indica toman su valor por defecto). */
export function parseToolArgs<N extends CopilotToolName>(name: N, raw: unknown): z.infer<(typeof TOOL_ARGS)[N]> {
  // Lo que la IA deja en null cuenta como no indicado; lo que no es de la herramienta se ignora
  const clean = raw && typeof raw === "object" && !Array.isArray(raw) ? Object.fromEntries(Object.entries(raw).filter(([, v]) => v != null && v !== "")) : {};
  const r = TOOL_ARGS[name].safeParse(clean);
  if (!r.success) throw new CopilotInputError(`Parámetros no válidos para ${COPILOT_TOOL_BY_NAME[name].label}: ${r.error.issues.map((i) => `${i.path.join(".") || "parámetros"} ${i.message}`).join("; ")}`);
  return r.data as z.infer<(typeof TOOL_ARGS)[N]>;
}

/** Ejecuta una herramienta YA autorizada con sus parámetros validados. */
export async function runTool(name: CopilotToolName, rawArgs: unknown, data: CopilotData, now: number): Promise<Record<string, unknown>> {
  switch (name) {
    case "ventas_periodo": {
      const a = parseToolArgs(name, rawArgs);
      const { from, to } = resolveRange(a, now, 30);
      const rows = await data.paidSales(madridDayStartMs(from), madridDayStartMs(addDays(to, 1)));
      const by = a.agrupar ?? (daysBetween(from, to) > 92 ? "mes" : daysBetween(from, to) > 31 ? "semana" : "dia");
      // Una operación por pedido: las líneas de un pedido comparten su número (como la portada y el resumen contable)
      const ops = new Set<string>();
      const series = new Map<string, { cents: number; ops: Set<string> }>();
      let cents = 0;
      for (const r of rows) {
        const key = r.merchantOrder ? `p:${r.merchantOrder}` : `r:${r.id}`;
        const c = saleCents(r);
        cents += c;
        ops.add(key);
        const b = bucketOf(madridDay(r.at), by);
        const s = series.get(b) ?? { cents: 0, ops: new Set<string>() };
        s.cents += c;
        s.ops.add(key);
        series.set(b, s);
      }
      return {
        periodo: { desde: from, hasta: to },
        total: euros(cents),
        operaciones: ops.size,
        ticketMedio: ops.size ? round2(euros(cents) / ops.size) : 0,
        agrupadoPor: by,
        evolucion: Array.from(series.entries()).sort(([x], [y]) => (x < y ? -1 : 1)).map(([k, s]) => ({ periodo: k, total: euros(s.cents), operaciones: s.ops.size })),
        nota: "Ventas cobradas (pedidos, reservas y caja), con impuestos.",
      };
    }
    case "top_productos": {
      const a = parseToolArgs(name, rawArgs);
      const { from, to } = resolveRange(a, now, 30);
      const rows = await data.paidSales(madridDayStartMs(from), madridDayStartMs(addDays(to, 1)));
      const by = new Map<string, { cents: number; people: number; lines: number }>();
      for (const r of rows) {
        const k = r.productName || `Producto ${r.productId}`;
        const s = by.get(k) ?? { cents: 0, people: 0, lines: 0 };
        s.cents += saleCents(r);
        s.people += r.people;
        s.lines += 1;
        by.set(k, s);
      }
      const sorted = Array.from(by.entries()).sort(([an, x], [bn, y]) => (a.orden === "personas" ? y.people - x.people : y.cents - x.cents) || an.localeCompare(bn, "es"));
      return {
        periodo: { desde: from, hasta: to },
        orden: a.orden,
        productos: sorted.slice(0, a.limite).map(([producto, s]) => ({ producto, importe: euros(s.cents), personas: s.people, ventas: s.lines })),
        productosConVentas: by.size,
      };
    }
    case "reservas_proximas": {
      const a = parseToolArgs(name, rawArgs);
      const from = a.desde ?? madridDay(now);
      const to = addDays(from, a.dias - 1);
      const rows = await data.reservations(from, to, 1000);
      return {
        periodo: { desde: from, hasta: to },
        reservas: rows.length,
        personas: rows.reduce((s, r) => s + r.people, 0),
        pendientesDePago: rows.filter((r) => r.status !== "paid").length,
        detalle: rows.slice(0, a.limite).map(reservationOut),
        ...(rows.length > a.limite ? { nota: `Se muestran ${a.limite} de ${rows.length}${rows.length >= 1000 ? " o más" : ""}.` } : {}),
      };
    }
    case "ocupacion": {
      const a = parseToolArgs(name, rawArgs);
      const from = a.desde ?? madridDay(now);
      const to = addDays(from, a.dias - 1);
      const rows = await data.reservations(from, to, 5000);
      const slots = await data.activeSlots(Array.from(new Set(rows.map((r) => r.productId))));
      const out = new Map<string, { fecha: string; producto: string; productId: number; personas: number }>();
      for (const r of rows) {
        const k = `${r.bookingDate}|${r.productId}`;
        const s = out.get(k) ?? { fecha: r.bookingDate, producto: r.productName, productId: r.productId, personas: 0 };
        s.personas += r.people;
        out.set(k, s);
      }
      const dias = Array.from(out.values())
        .sort((x, y) => (x.fecha < y.fecha ? -1 : x.fecha > y.fecha ? 1 : x.producto.localeCompare(y.producto, "es")))
        .map((s) => {
          const own = slots.filter((sl) => sl.productId === s.productId && slotRunsOn(sl.daysOfWeek, s.fecha));
          const withCap = own.filter((sl) => sl.capacity != null && sl.capacity > 0);
          const aforo = withCap.length && withCap.length === own.length ? withCap.reduce((t, sl) => t + (sl.capacity ?? 0), 0) : null;
          return { fecha: s.fecha, producto: s.producto, personas: s.personas, aforo, ocupacion: aforo ? `${Math.round((s.personas / aforo) * 100)} %` : null };
        });
      return {
        periodo: { desde: from, hasta: to },
        dias: dias.slice(0, 120),
        nota: "Personas de reservas pagadas o pendientes de pago no anuladas. El aforo solo se calcula si todos los horarios del producto ese día tienen aforo.",
      };
    }
    case "buscar_clientes": {
      const a = parseToolArgs(name, rawArgs);
      const text = a.texto?.trim() || null;
      const rows = await data.searchClients(text, a.limite);
      return {
        busqueda: text ?? "(mejores clientes por gasto)",
        clientes: rows.map((c) => ({ id: c.id, nombre: c.name, empresa: c.company, ciudad: c.city, reservas: c.totalBookings, gastoTotal: round2(c.totalSpent), ultimaReserva: dayOf(c.lastBookingAt), alta: dayOf(c.createdAt) })),
      };
    }
    case "ficha_cliente": {
      const a = parseToolArgs(name, rawArgs);
      const c = await data.client(a.clienteId);
      if (!c) return { encontrado: false, aviso: `No hay ningún cliente con id ${a.clienteId}.` };
      const res = await data.clientReservations(c.id, c.email, 10);
      return {
        encontrado: true,
        cliente: { id: c.id, nombre: c.name, email: c.email, telefono: c.phone, empresa: c.company, ciudad: c.city, etiquetas: c.tags, notas: c.notes ? c.notes.slice(0, 800) : null, reservas: c.totalBookings, gastoTotal: round2(c.totalSpent), ultimaReserva: dayOf(c.lastBookingAt), alta: dayOf(c.createdAt) },
        ultimasReservas: res.map(reservationOut),
      };
    }
    case "oportunidades_abiertas": {
      const a = parseToolArgs(name, rawArgs);
      const r = a.desde || a.hasta ? resolveRange(a, now, 30) : null;
      const { rows, byStatus } = await data.openLeads(r ? madridDayStartMs(r.from) : null, r ? madridDayStartMs(addDays(r.to, 1)) : null, a.limite);
      return {
        periodo: r ? { desde: r.from, hasta: r.to } : "todas las abiertas",
        porEstado: Object.fromEntries(byStatus.map((s) => [s.status, s.n])),
        total: byStatus.reduce((t, s) => t + s.n, 0),
        oportunidades: rows.map((l) => ({ id: l.id, nombre: l.name, empresa: l.company, estado: l.status, prioridad: l.priority, origen: l.source, interes: l.product, alta: dayOf(l.createdAt), ultimoContacto: dayOf(l.lastContactAt) })),
      };
    }
    case "presupuestos_pendientes": {
      const a = parseToolArgs(name, rawArgs);
      const r = await data.pendingQuotes(a.limite);
      return {
        pendientes: r.count,
        importeTotal: round2(r.total),
        presupuestos: r.rows.map((x) => ({ numero: x.number, titulo: x.title, importe: round2(x.total), estado: x.status === "visualizado" ? "visto por el cliente" : "enviado", enviado: dayOf(x.sentAt), validoHasta: dayOf(x.validUntil) })),
      };
    }
    case "facturas_pendientes": {
      const a = parseToolArgs(name, rawArgs);
      const rows = await data.unpaidInvoices();
      const credits = await data.credits(rows.map((r) => r.id));
      const credited = new Map<number, number>();
      for (const c of credits) if (c.creditNoteForId != null) credited.set(c.creditNoteForId, (credited.get(c.creditNoteForId) ?? 0) + Math.abs(c.total));
      const totals = unpaidAfterCredits(rows, credits);
      const today = madridDay(now);
      const detail = rows
        .map((r) => ({ r, left: round2(r.total - (credited.get(r.id) ?? 0)) }))
        .filter((x) => x.left > 0)
        .map(({ r, left }) => ({ numero: r.number, cliente: r.clientName, pendiente: left, emitida: dayOf(r.issuedAt), dias: r.issuedAt ? Math.max(0, daysBetween(madridDay(r.issuedAt), today)) : null, estado: r.status }));
      return {
        facturasPendientes: totals.count,
        importePendiente: totals.amount,
        detalle: detail.slice(0, a.limite),
        ...(detail.length > a.limite ? { nota: `Se muestran las ${a.limite} más antiguas de ${detail.length}.` } : {}),
      };
    }
    case "ausencias_rrhh": {
      const a = parseToolArgs(name, rawArgs);
      const { from, to } = resolveRange(a, now, 7, true);
      const r = await data.hrSummary(from, to);
      return {
        periodo: { desde: from, hasta: to },
        ausenciasAprobadas: r.leave.map((l) => ({ tipo: l.type, solicitudes: l.requests, dias: l.days })),
        solicitudesPendientes: r.pending,
        fichajesAbiertosAhora: r.openClocks,
      };
    }
  }
}
