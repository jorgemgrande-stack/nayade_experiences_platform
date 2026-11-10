/**
 * Presentación al cliente de un acuerdo de condiciones personalizadas. La MISMA vista sirve para la oferta, la
 * propuesta, el contrato, el resumen de contratación y el panel de la empresa, de modo que la presentación elegida por
 * el administrador se respeta en todos:
 *
 *  - `global`: nombre del paquete, productos y servicios incluidos, cuota global, impuestos, total, periodicidad y
 *    condiciones. NUNCA los precios internos de cada partida, ni su precio oficial, ni la asignación interna.
 *  - `breakdown`: cada producto y servicio con su precio, sus descuentos o recargos, impuestos y total.
 *
 * Los impuestos y la información contractual obligatoria se muestran siempre. Las facturas no usan esta vista: llevan
 * siempre el detalle fiscal por concepto.
 */
import crypto from "node:crypto";
import { materialize, summarize, type TaxGroup } from "./compute";
import { isRecurring, type Adjustment, type Terms } from "./model";

export const TERMS_TIME_ZONE = "Europe/Madrid" as const;

export interface ClientView {
  presentation: Terms["presentation"];
  packageName: string | null;
  currency: string;
  interval: Terms["interval"];
  /** Productos y servicios incluidos (siempre, también con cuota global). */
  included: Array<{ name: string; description: string | null; kind: "product" | "service"; recurring: boolean; quantity: number; conditions: string | null }>;
  /** Solo con desglose económico. */
  breakdown: null | {
    lines: Array<{ name: string; quantity: number; baseCents: number; adjustments: Array<{ label: string; cents: number }>; netCents: number; taxRateBp: number }>;
  };
  /** Cuota recurrente por periodo al empezar. */
  recurring: { netCents: number; taxes: TaxGroup[]; taxCents: number; totalCents: number };
  /** Pagos iniciales y trabajos extraordinarios (importes únicos, con su fecha). */
  oneTime: Array<{ name: string; description: string | null; at: number; netCents: number; taxRateBp: number; taxCents: number; totalCents: number }>;
  /** Descuentos o recargos de un solo uso sobre la primera cuota (con signo). */
  onceAdjustments: Array<{ label: string; cents: number }>;
  /** Primera contratación: primera cuota, cargos con fecha de inicio y ajustes de un solo uso. */
  first: { netCents: number; taxCents: number; totalCents: number };
  validity: {
    from: number | null;
    /** Null = indefinida. */
    to: number | null;
    afterEnd: Terms["afterEnd"];
    /** Qué ocurre al vencer, con el importe cuando se conoce. */
    afterEndText: string | null;
  };
  /** Cambios de la cuota ya programados dentro de la vigencia (fin de un descuento temporal, partidas con fecha). */
  scheduledChanges: Array<{ at: number; netCents: number; taxCents: number; totalCents: number }>;
  conditions: string | null;
  timeZone: typeof TERMS_TIME_ZONE;
}

export const money = (cents: number, currency: string) => new Intl.NumberFormat("es-ES", { style: "currency", currency, useGrouping: "always" } as unknown as Intl.NumberFormatOptions).format(cents / 100);
export const madridDate = (ms: number) => new Intl.DateTimeFormat("es-ES", { timeZone: TERMS_TIME_ZONE, day: "numeric", month: "long", year: "numeric" }).format(new Date(ms));
export const madridDateTime = (ms: number) => `${madridDate(ms)}, ${new Intl.DateTimeFormat("es-ES", { timeZone: TERMS_TIME_ZONE, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(ms))} (hora peninsular)`;
const percent = (bp: number) => `${(bp / 100).toLocaleString("es-ES", { maximumFractionDigits: 2 })} %`;
const per = (interval: Terms["interval"]) => (interval === "year" ? "al año" : "al mes");

function adjustmentLabel(a: Pick<Adjustment, "type" | "mode" | "value" | "note" | "recurrence" | "endsAt">, currency: string): string {
  const what = a.type === "discount" ? "Descuento" : "Recargo";
  const how = a.mode === "percent" ? percent(a.value) : money(a.value, currency);
  const when = a.recurrence === "once" ? " (una sola vez)" : a.endsAt !== null ? ` (hasta el ${madridDate(a.endsAt)})` : "";
  return `${what} ${how}${when}${a.note ? `: ${a.note}` : ""}`;
}

/**
 * Vista del acuerdo para el cliente. `next` es la condición ya programada que lo sustituye al vencer (si la hay).
 * Con presentación `global` no sale ningún importe por partida recurrente.
 */
export function presentTerms(t: Terms, next?: Terms | null): ClientView {
  const s = summarize(t);
  const start = t.effectiveFrom ?? 0;
  const lineOf = (id: number) => t.lines.find((l) => l.id === id)!;
  const label = (id: number) => adjustmentLabel(t.adjustments.find((a) => a.id === id)!, t.currency);
  let afterEndText: string | null = null;
  if (t.effectiveTo !== null) {
    const after = materialize(t).filter((p) => p.role === "after_end");
    const official = after.reduce((a, p) => a + p.amountCents, 0);
    if (t.afterEnd === "official_snapshot") afterEndText = `Al finalizar esta vigencia se aplicará la tarifa oficial fijada en este acuerdo: ${money(official, t.currency)} ${per(t.interval)}, más impuestos.`;
    else if (t.afterEnd === "official_current") afterEndText = `Al finalizar esta vigencia se aplicará la tarifa oficial de Big Elephant que esté vigente en esa fecha. A título informativo, la tarifa oficial hoy es de ${money(official, t.currency)} ${per(t.interval)}, más impuestos.`;
    else if (t.afterEnd === "next_terms") afterEndText = next ? `Al finalizar esta vigencia se aplicarán las condiciones ya pactadas a partir de esa fecha: ${money(summarize(next).recurring.netCents, next.currency)} ${per(next.interval)}, más impuestos.` : "Al finalizar esta vigencia se aplicarán las condiciones ya pactadas a partir de esa fecha.";
  }
  return {
    presentation: t.presentation,
    packageName: t.packageName,
    currency: t.currency,
    interval: t.interval,
    included: t.lines
      .slice()
      .sort((a, b) => a.sort - b.sort || a.id - b.id)
      .map((l) => ({ name: l.name, description: l.description, kind: l.kind === "catalog" ? ("product" as const) : ("service" as const), recurring: isRecurring(l), quantity: l.quantity, conditions: l.conditions })),
    breakdown:
      t.presentation === "breakdown"
        ? {
            lines: s.recurring.lines.map((l) => ({ name: l.name, quantity: l.quantity, baseCents: l.negotiatedCents, adjustments: l.applied.map((a) => ({ label: label(a.adjustmentId), cents: a.cents })), netCents: l.netCents, taxRateBp: l.taxRateBp })),
          }
        : null,
    recurring: { netCents: s.recurring.netCents, taxes: s.recurring.taxes, taxCents: s.recurring.taxCents, totalCents: s.recurring.totalCents },
    oneTime: s.charges.map((c) => ({ name: c.name, description: lineOf(c.lineId).description, at: c.at, netCents: c.netCents, taxRateBp: c.taxRateBp, taxCents: c.taxCents, totalCents: c.totalCents })),
    onceAdjustments: s.credits.map((c) => ({ label: label(c.adjustmentId), cents: c.cents })),
    first: { netCents: s.first.netCents, taxCents: s.first.taxCents, totalCents: s.first.totalCents },
    validity: { from: t.effectiveFrom, to: t.effectiveTo, afterEnd: t.afterEnd, afterEndText },
    scheduledChanges: s.changes.filter((c) => c.at > start),
    conditions: t.conditions,
    timeZone: TERMS_TIME_ZONE,
  };
}

export const sha256 = (s: string) => crypto.createHash("sha256").update(s, "utf8").digest("hex");

export interface TermsDocumentInput {
  view: ClientView;
  reference: string;
  version: number;
  issuer: { legalName: string; taxId: string; address: string };
  client: { name: string; legalName: string | null; taxId: string | null };
  /** Suscripción existente que se modifica (null = contratación nueva). */
  subscriptionReference: string | null;
  /** Si el acuerdo aún no tiene fecha: «desde su aceptación». */
  startsOnAcceptance: boolean;
}

/**
 * Texto del contrato (condiciones comerciales particulares). Determinista: el mismo acuerdo da siempre el mismo
 * texto y la misma huella, que es lo que se presenta al firmante y lo que se registra como aceptado.
 */
export function renderTermsDocument(i: TermsDocumentInput): string {
  const v = i.view;
  const m = (c: number) => money(c, v.currency);
  const out: string[] = [];
  out.push(`CONDICIONES COMERCIALES PARTICULARES ${i.reference} (versión ${i.version})`);
  out.push(`Prestador: ${i.issuer.legalName} (NIF ${i.issuer.taxId}), ${i.issuer.address}`);
  out.push(`Cliente: ${i.client.legalName ?? i.client.name}${i.client.taxId ? ` (NIF ${i.client.taxId})` : ""}`);
  if (i.subscriptionReference) out.push(`Suscripción: ${i.subscriptionReference}`);
  out.push("");
  out.push("OBJETO");
  out.push(
    i.subscriptionReference
      ? `Estas condiciones particulares modifican las condiciones económicas y el contenido de la suscripción ${i.subscriptionReference} del cliente. En lo no previsto aquí rigen las condiciones generales de contratación de Big Elephant.`
      : "Estas condiciones particulares regulan la contratación de los productos y servicios que se indican. En lo no previsto aquí rigen las condiciones generales de contratación de Big Elephant.",
  );
  out.push("");
  out.push("PRODUCTOS Y SERVICIOS INCLUIDOS");
  if (v.packageName) out.push(`Paquete: ${v.packageName}.`);
  for (const l of v.included) {
    const kind = l.recurring ? "" : " (pago único)";
    out.push(`- ${l.name}${l.quantity > 1 ? ` × ${l.quantity}` : ""}${kind}${l.description ? `. ${l.description}` : ""}${l.conditions ? ` Condiciones particulares: ${l.conditions}` : ""}`);
  }
  out.push("Las funcionalidades y licencias del cliente son las de los productos incluidos, con independencia del precio pactado.");
  out.push("");
  out.push("PRECIO Y PERIODICIDAD");
  if (v.breakdown) {
    for (const l of v.breakdown.lines) {
      out.push(`- ${l.name}${l.quantity > 1 ? ` × ${l.quantity}` : ""}: ${m(l.baseCents)} ${per(v.interval)}${l.adjustments.map((a) => `; ${a.label}: ${m(a.cents)}`).join("")}${l.adjustments.length ? `; importe: ${m(l.netCents)}` : ""} (impuesto ${percent(l.taxRateBp)}).`);
    }
    out.push(`Total negociado: ${m(v.recurring.netCents)} ${per(v.interval)}, más impuestos.`);
  } else {
    out.push(`Cuota global pactada: ${m(v.recurring.netCents)} ${per(v.interval)}, más impuestos, por el conjunto de los productos y servicios recurrentes incluidos.`);
  }
  for (const g of v.recurring.taxes) out.push(`- Impuesto ${percent(g.rateBp)} sobre ${m(g.baseCents)}: ${m(g.taxCents)}.`);
  out.push(`Total con impuestos: ${m(v.recurring.totalCents)} ${per(v.interval)}.`);
  out.push(`Periodicidad de facturación: ${v.interval === "year" ? "anual" : "mensual"}, por periodos anticipados.`);
  out.push("");
  out.push("PAGOS INICIALES Y CARGOS ÚNICOS");
  if (!v.oneTime.length && !v.onceAdjustments.length) out.push("No hay pagos iniciales ni cargos únicos.");
  for (const c of v.oneTime) out.push(`- ${c.name}: ${m(c.netCents)} más impuestos (${percent(c.taxRateBp)}: ${m(c.taxCents)}); total ${m(c.totalCents)}. Se factura una sola vez${i.startsOnAcceptance && v.validity.from === null ? "" : `, el ${madridDate(c.at)}`}.`);
  for (const a of v.onceAdjustments) out.push(`- ${a.label}: ${m(a.cents)} sobre la primera cuota. Se aplica una sola vez.`);
  if (v.oneTime.length || v.onceAdjustments.length) out.push(`Primera contratación (primera cuota, cargos iniciales y ajustes de un solo uso): ${m(v.first.netCents)} más impuestos; total ${m(v.first.totalCents)}.`);
  out.push("Las renovaciones posteriores incluyen únicamente las cuotas recurrentes vigentes.");
  out.push("");
  out.push("VIGENCIA Y CAMBIOS DE PRECIO PROGRAMADOS");
  out.push(`Entrada en vigor: ${v.validity.from === null || i.startsOnAcceptance ? "en el momento de la aceptación de estas condiciones" : `${madridDateTime(v.validity.from)} o, si la aceptación es posterior, en el momento de la aceptación`}.`);
  out.push(v.validity.to === null ? "Vigencia: indefinida, hasta que se modifique mediante un nuevo acuerdo." : `Vigencia: hasta el ${madridDateTime(v.validity.to)}.`);
  for (const c of v.scheduledChanges) out.push(`- Desde el ${madridDate(c.at)}: ${m(c.netCents)} ${per(v.interval)} más impuestos (total ${m(c.totalCents)}).`);
  if (v.validity.afterEndText) out.push(v.validity.afterEndText);
  out.push("Ningún cambio tiene efectos retroactivos sobre facturas ya emitidas.");
  out.push("");
  out.push("RENOVACIÓN");
  out.push(`La suscripción se renueva automáticamente por periodos ${v.interval === "year" ? "anuales" : "mensuales"} con las condiciones vigentes en cada momento conforme a este documento, salvo baja comunicada conforme a las condiciones generales.`);
  out.push("");
  out.push("CONDICIONES ESPECIALES");
  out.push(v.conditions?.trim() ? v.conditions.trim() : "No hay condiciones especiales.");
  out.push("");
  out.push("ACEPTACIÓN");
  out.push("La aceptación electrónica de este documento por un representante autorizado del cliente tiene el mismo valor que su firma. Se conservan la versión, la huella del documento, la identidad declarada y la fecha de la aceptación.");
  return out.join("\n");
}
