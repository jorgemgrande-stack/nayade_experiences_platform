/**
 * Diagnóstico de integridad de facturas y cobros de UNA empresa (SOLO LECTURA). Lo ejecuta la orden `invoice-integrity` de
 * restore-drill dentro de la red privada de Railway, empresa por empresa, con una sesión MySQL de solo lectura.
 *
 * Garantías:
 *  - únicamente SELECT (el ejecutor abre la sesión con `SET SESSION TRANSACTION READ ONLY`);
 *  - sin datos personales: solo ids, números de documento, estados, importes y fechas;
 *  - resultados acotados (MAX_LIST) y recuentos completos; ante una tabla ausente, la comprobación se marca «sin tabla».
 *
 * No repara nada: describe lo que se ve. Cualquier regularización exige autorización expresa y separada.
 */

export type Query = (sql: string, params?: unknown[]) => Promise<Array<Record<string, unknown>>>;

const MAX_LIST = 100;

export interface Check<T = Record<string, unknown>> {
  total: number | null;
  muestra: T[];
  nota?: string;
}

export interface InvoiceIntegrityReport {
  /** C1: reservas cuyo invoiceId no existe en invoices (factura borrada o enlace roto). */
  reservasConFacturaInexistente: Check;
  /** C2: facturas cuyo reservationId no existe en reservations. */
  facturasConReservaInexistente: Check;
  /** C3: presupuestos con más de una factura que no es abono; «conPlanDeCuotas» evita confundirlos con cuotas legítimas. */
  presupuestosConVariasFacturas: Check;
  /** C4a: facturas con quoteId que apunta a un presupuesto que ya no existe. */
  facturasConPresupuestoInexistente: Check;
  /** C4b: presupuestos con número de factura sin factura con ese número (factura borrada). */
  presupuestosConNumeroSinFactura: Check;
  /** C5: huecos y duplicados en la numeración de facturas por serie y año. */
  numeracion: { series: Array<Record<string, unknown>>; contadores: Array<Record<string, unknown>>; numerosRegistradosSinFactura: Check };
  /** C6: facturas «generada» sin reserva ni cobro del presupuesto (candidatas a huérfanas por fallo a medias). */
  facturasHuerfanasProbables: Check;
  /** C7a: presupuestos cobrados (paidAt) sin ninguna factura. */
  presupuestosCobradosSinFactura: Check;
  /** C7b: presupuestos con más de una reserva no cancelada. */
  presupuestosConVariasReservas: Check;
  /** C8: pagos confirmados sin factura (marcados por el sistema, o reservas pagadas por pago pendiente sin factura). */
  pagosSinFactura: { marcadosPorElSistema: Check; pagosPendientesCobradosSinFactura: Check };
  /** C9: cobros de Stripe duplicados detectados por el sistema (si la empresa usa Stripe). */
  cobrosStripeDuplicados: Check;
}

async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T | (T & { nota: string })> {
  try {
    return await fn();
  } catch (e) {
    const code = (e as { code?: string })?.code;
    const note = code === "ER_NO_SUCH_TABLE" ? "sin tabla" : code === "ER_BAD_FIELD_ERROR" ? "columna ausente" : "error de lectura";
    return { ...(fallback as object), nota: note } as T & { nota: string };
  }
}

const num = (v: unknown) => (v == null ? null : Number(v));

async function listAndCount(q: Query, fromWhere: string, columns: string, orderBy: string, params: unknown[] = []): Promise<Check> {
  const [c] = await q(`SELECT COUNT(*) AS n FROM (SELECT 1 ${fromWhere}) t`, params);
  const rows = await q(`SELECT ${columns} ${fromWhere} ORDER BY ${orderBy} LIMIT ${MAX_LIST}`, params);
  return { total: num(c?.n) ?? 0, muestra: rows };
}

/** Prefijo y año de un número «FAC-2026-0007» → { serie: "FAC-2026", n: 7 }; null si no sigue el patrón. */
export function parseInvoiceNumber(value: string): { serie: string; n: number } | null {
  const m = /^(.*?)-?(\d{1,})$/.exec(value);
  if (!m) return null;
  return { serie: m[1].replace(/-$/, ""), n: Number(m[2]) };
}

/** Huecos y duplicados por serie a partir de la lista de números emitidos (función pura, probada aparte). */
export function analyseNumbering(numbers: string[]): Array<{ serie: string; emitidas: number; minimo: number; maximo: number; huecos: number[]; totalHuecos: number; duplicados: number[]; fueraDePatron: number }> {
  const bySerie = new Map<string, number[]>();
  let outside = 0;
  for (const raw of numbers) {
    const p = parseInvoiceNumber(raw);
    if (!p) {
      outside++;
      continue;
    }
    const arr = bySerie.get(p.serie) ?? [];
    arr.push(p.n);
    bySerie.set(p.serie, arr);
  }
  return Array.from(bySerie.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([serie, ns]) => {
    const sorted = [...ns].sort((a, b) => a - b);
    const seen = new Set<number>();
    const dup = new Set<number>();
    for (const n of sorted) (seen.has(n) ? dup : seen).add(n);
    const huecos: number[] = [];
    for (let n = sorted[0]; n <= sorted[sorted.length - 1]; n++) if (!seen.has(n)) huecos.push(n);
    return { serie, emitidas: sorted.length, minimo: sorted[0], maximo: sorted[sorted.length - 1], huecos: huecos.slice(0, MAX_LIST), totalHuecos: huecos.length, duplicados: Array.from(dup).slice(0, MAX_LIST), fueraDePatron: outside };
  });
}

export async function invoiceIntegrity(q: Query): Promise<InvoiceIntegrityReport> {
  const empty: Check = { total: null, muestra: [] };

  const reservasConFacturaInexistente = await safe(() => listAndCount(q,
    "FROM reservations r LEFT JOIN invoices i ON i.id = r.invoiceId WHERE r.invoiceId IS NOT NULL AND i.id IS NULL",
    "r.id AS reservaId, r.invoiceId, r.invoiceNumber, r.status", "r.id"), empty);

  const facturasConReservaInexistente = await safe(() => listAndCount(q,
    "FROM invoices i LEFT JOIN reservations r ON r.id = i.reservationId WHERE i.reservationId IS NOT NULL AND r.id IS NULL",
    "i.id AS facturaId, i.invoiceNumber, i.reservationId, i.status, i.total", "i.id"), empty);

  const presupuestosConVariasFacturas = await safe(() => listAndCount(q,
    "FROM invoices i LEFT JOIN quotes qt ON qt.id = i.quoteId WHERE i.quoteId IS NOT NULL AND (i.invoiceType IS NULL OR i.invoiceType <> 'abono') GROUP BY i.quoteId HAVING COUNT(*) > 1",
    "i.quoteId, COUNT(*) AS facturas, GROUP_CONCAT(i.invoiceNumber ORDER BY i.id SEPARATOR ',') AS numeros, GROUP_CONCAT(i.status ORDER BY i.id SEPARATOR ',') AS estados, MAX(qt.payment_plan_id IS NOT NULL) AS conPlanDeCuotas, MIN(i.issuedAt) AS primera, MAX(i.issuedAt) AS ultima",
    "i.quoteId"), empty);

  const facturasConPresupuestoInexistente = await safe(() => listAndCount(q,
    "FROM invoices i LEFT JOIN quotes qt ON qt.id = i.quoteId WHERE i.quoteId IS NOT NULL AND qt.id IS NULL",
    "i.id AS facturaId, i.invoiceNumber, i.quoteId, i.status, i.total", "i.id"), empty);

  const presupuestosConNumeroSinFactura = await safe(() => listAndCount(q,
    "FROM quotes qt LEFT JOIN invoices i ON i.invoiceNumber = qt.invoiceNumber WHERE qt.invoiceNumber IS NOT NULL AND qt.invoiceNumber <> '' AND i.id IS NULL",
    "qt.id AS presupuestoId, qt.invoiceNumber, qt.status, qt.paidAt", "qt.id"), empty);

  // Numeración: facturas que no son abono (los abonos tienen su propia serie)
  const numbering = await safe(async () => {
    const rows = await q("SELECT invoiceNumber FROM invoices WHERE invoiceType IS NULL OR invoiceType <> 'abono'");
    return analyseNumbering(rows.map((r) => String(r.invoiceNumber)));
  }, [] as ReturnType<typeof analyseNumbering>);
  const contadores = await safe(() => q(
    "SELECT c.document_type AS tipo, c.`year` AS anio, c.prefix, c.current_number AS contador FROM document_counters c WHERE c.document_type IN ('factura','abono') ORDER BY c.document_type, c.`year`, c.id"), [] as Array<Record<string, unknown>>);
  const numerosRegistradosSinFactura = await safe(() => listAndCount(q,
    "FROM document_number_logs l LEFT JOIN invoices i ON i.invoiceNumber = l.document_number WHERE l.document_type = 'factura' AND i.id IS NULL",
    "l.document_number AS numero, l.generated_at AS generadoEn, l.context", "l.id"), empty);

  const facturasHuerfanasProbables = await safe(() => listAndCount(q,
    "FROM invoices i JOIN quotes qt ON qt.id = i.quoteId WHERE i.status = 'generada' AND i.reservationId IS NULL AND qt.paidAt IS NULL",
    "i.id AS facturaId, i.invoiceNumber, i.quoteId, i.issuedAt, i.total", "i.id"), empty);

  const presupuestosCobradosSinFactura = await safe(() => listAndCount(q,
    "FROM quotes qt LEFT JOIN invoices i ON i.quoteId = qt.id WHERE qt.paidAt IS NOT NULL AND i.id IS NULL",
    "qt.id AS presupuestoId, qt.status, qt.paidAt, qt.total", "qt.id"), empty);

  const presupuestosConVariasReservas = await safe(() => listAndCount(q,
    "FROM reservations r WHERE r.quote_id IS NOT NULL AND r.status <> 'cancelled' GROUP BY r.quote_id HAVING COUNT(*) > 1",
    "r.quote_id AS quoteId, COUNT(*) AS reservas, GROUP_CONCAT(r.id ORDER BY r.id SEPARATOR ',') AS ids", "r.quote_id"), empty);

  const marcadosPorElSistema = await safe(() => listAndCount(q,
    "FROM crm_activity_log a WHERE a.entityType = 'quote' AND a.action = 'payment_confirmed_without_invoice'",
    "a.entityId AS quoteId, a.createdAt", "a.id"), empty);
  const pagosPendientesCobradosSinFactura = await safe(() => listAndCount(q,
    "FROM pending_payments p JOIN reservations r ON r.id = p.reservation_id WHERE p.pp_status = 'paid' AND (r.invoiceId IS NULL OR r.invoiceId = 0)",
    "p.id AS pagoPendienteId, p.quote_id AS quoteId, p.reservation_id AS reservaId, p.amount_cents AS cent", "p.id"), empty);

  const cobrosStripeDuplicados = await safe(() => listAndCount(q,
    "FROM payment_events e WHERE e.outcome = 'duplicate_payment'",
    "e.event_id AS evento, e.received_at AS recibidoEn", "e.received_at"), empty);

  return {
    reservasConFacturaInexistente,
    facturasConReservaInexistente,
    presupuestosConVariasFacturas,
    facturasConPresupuestoInexistente,
    presupuestosConNumeroSinFactura,
    numeracion: { series: numbering as Array<Record<string, unknown>>, contadores: contadores as Array<Record<string, unknown>>, numerosRegistradosSinFactura },
    facturasHuerfanasProbables,
    presupuestosCobradosSinFactura,
    presupuestosConVariasReservas,
    pagosSinFactura: { marcadosPorElSistema, pagosPendientesCobradosSinFactura },
    cobrosStripeDuplicados,
  };
}
