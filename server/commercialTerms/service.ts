/**
 * Condiciones comerciales personalizadas: operaciones (borrador, vista previa, activación, restaurar la tarifa oficial,
 * fin de condiciones temporales y paquetes para contrataciones nuevas). Diseño:
 * docs/elephant-source/CONDICIONES_PERSONALIZADAS.md.
 *
 * Reglas:
 *  - Activar un acuerdo NO crea otra suscripción: en una sola mutación (bloqueo + versión esperada + evento) cierra las
 *    partidas vigentes y abre las del acuerdo, con el importe efectivo ya resuelto y sin descuento (nada se aplica dos veces).
 *  - Los derechos salen de los productos de catálogo incluidos. Una partida a medida se materializa sin activación y con
 *    una clave que no existe en el catálogo: nunca concede licencias. Aquí no se concede ni se retira ninguna licencia.
 *  - Sin efectos retroactivos: la fecha efectiva nunca es anterior al momento de activar ni al inicio del periodo en curso.
 *  - Un acuerdo que exige aceptación del cliente no se activa hasta que conste aceptado.
 *  - Una suscripción cobrada por Stripe no admite condiciones personalizadas mientras no se abra expresamente (fase 4).
 *  - Motivo obligatorio e historial inmutable en cada operación.
 */
import crypto from "node:crypto";
import { legacyProductText } from "../catalog/quote";
import type { CatalogPort, CatalogPrice, CatalogProduct, CrmPort } from "../subscriptions/ports";
import { coverage, isRecurring as recurringPrice, lineAmounts, recurringKind, stableHash } from "../subscriptions/pricing";
import { activeAt, licencePlan, lineKindOf, type SubscriptionService } from "../subscriptions/service";
import type { NewItem, SubscriptionStore } from "../subscriptions/store";
import { SubscriptionError, type Subscription, type SubscriptionItem } from "../subscriptions/types";
import { difference, groupTax, materialize, recurringAt, summarize, type PlannedItem, type TermsSummary } from "./compute";
import { madridDateTime } from "./presentation";
import { declaredServiceStart, isRecurring, termsEconomicOnly, validateTerms, type Adjustment, type AfterEnd, type ChargeClass, type Concept, type Presentation, type PricingMode, type Terms, type TermsInterval, type TermsLine } from "./model";
import { TermsConflict, type AdjustmentDraft, type LineDraft, type TermsEventDraft, type TermsHead, type TermsRecord, type TermsStore } from "./store";

export class TermsError extends Error {
  constructor(
    public readonly code: "not_found" | "invalid_input" | "invalid_state" | "version_conflict",
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "TermsError";
  }
}
function bad(msg: string, details?: Record<string, unknown>): never {
  throw new TermsError("invalid_input", msg, details);
}
function state(msg: string, details?: Record<string, unknown>): never {
  throw new TermsError("invalid_state", msg, details);
}

export interface CatalogLineInput {
  kind: "catalog";
  productKey: string;
  priceId: number;
  quantity?: number;
  /** Precio unitario neto negociado; null u omitido = el oficial. */
  negotiatedUnitCents?: number | null;
  /** Solo con un precio de pago único: pago inicial (por defecto) o trabajo extraordinario. */
  chargeClass?: "initial" | "extraordinary";
  description?: string | null;
  conditions?: string | null;
  startsAt?: number | null;
  endsAt?: number | null;
}
export interface CustomLineInput {
  kind: "custom";
  /** Referencia estable de una partida a medida ya existente (al modificar un acuerdo); la genera el servidor. */
  ref?: string;
  concept: Concept;
  name: string;
  description?: string | null;
  conditions?: string | null;
  chargeClass: ChargeClass;
  quantity?: number;
  unitCents: number;
  taxRateBp: number;
  startsAt?: number | null;
  endsAt?: number | null;
}
export type LineInput = CatalogLineInput | CustomLineInput;
export interface AdjustmentInput {
  /** Posición de la partida en `lines`; null = a todo el acuerdo. */
  line: number | null;
  type: "discount" | "surcharge";
  mode: "percent" | "amount";
  value: number;
  recurrence: "recurring" | "once";
  endsAt?: number | null;
  note?: string | null;
}
export interface TermsInput {
  pricingMode: PricingMode;
  globalAmountCents?: number | null;
  presentation: Presentation;
  packageName?: string | null;
  conditions?: string | null;
  /** Null u omitido = al activar. Para «en la próxima renovación», la fecha de la renovación. */
  effectiveFrom?: number | null;
  effectiveTo?: number | null;
  afterEnd?: AfterEnd | null;
  nextTermsId?: number | null;
  requiresAcceptance?: boolean;
  /** Periodicidad: en una suscripción, la suya salvo que se cambie para la próxima renovación; en un paquete, obligatoria. */
  interval?: TermsInterval;
  currency?: string;
  lines: LineInput[];
  adjustments?: AdjustmentInput[];
  reason: string;
}

const CONCEPT_OF: Record<string, Concept> = { core_plan: "core_plan", net_module: "net", net_bundle: "net", industry_module: "net", connect: "connect", connect_bundle: "connect", extension: "connect", addon: "connect", extra: "connect", service: "professional_service" };
const REASON_MIN = 5;
const NEEDS_RECURRING = "El acuerdo necesita al menos una cuota recurrente (un producto del catálogo o una partida a medida)";
/** Lo que se dice de las licencias cuando el acuerdo no incluye ningún producto del catálogo. */
export const NO_LICENCES_NOTE = "Este acuerdo es puramente económico: solo tiene partidas a medida o servicios que no dependen de Elephant Core. No concede licencias, capacidades ni límites y no da de alta ni necesita ninguna plataforma.";
const PLAN_FROM_START = "Una suscripción necesita su plan Core desde la entrada en vigor del acuerdo: el plan no puede empezar después ni haber terminado ya";
const TRIAL_NEEDS_PLAN = "La suscripción está en prueba gratuita: un acuerdo sin plan Core le quitaría el plan de la prueba. Incluye el plan en el acuerdo o espera a que la prueba termine";
const ONCE_WITH_SERVICE_START = "Con fecha de inicio propia en todas las cuotas, un ajuste de un solo uso sobre las cuotas no tiene un primer periodo en el que aplicarse: usa un ajuste recurrente con fecha de fin o aplícalo a un cargo único";
const text = (v: string | null | undefined, max: number) => v?.trim().slice(0, max) || null;

/** Estado efectivo en un instante: un acuerdo activado con fecha futura está «programado»; pasado su fin, «vencido». */
export function effectiveStatus(t: Pick<TermsRecord, "status" | "effectiveFrom" | "effectiveTo"> & { closedAt?: number | null }, now: number): TermsRecord["status"] {
  if (t.status !== "active" && t.status !== "scheduled") return t.status;
  // Sustituido por otro acuerdo con fecha futura: vale hasta entonces
  if (t.closedAt != null && t.closedAt <= now) return "superseded";
  if (t.effectiveTo !== null && t.effectiveTo <= now) return "expired";
  return t.effectiveFrom !== null && t.effectiveFrom > now ? "scheduled" : "active";
}

/** Clave de la partida de suscripción que materializa un abono de un solo uso. */
const creditKey = (adjustmentId: number) => `ajuste:${adjustmentId}`;
const isVoid = (i: SubscriptionItem) => i.effectiveTo !== null && i.effectiveTo <= i.effectiveFrom;

export class CommercialTermsService {
  private now: () => number;
  constructor(
    private d: {
      store: TermsStore;
      subscriptions: SubscriptionService;
      subscriptionStore: SubscriptionStore;
      catalog: CatalogPort;
      crm: CrmPort;
      now?: () => number;
      stripeBilled?: (subscriptionId: number) => Promise<boolean>;
      /** Tras cambiar lo que una suscripción tiene contratado (activación, fin de una condición temporal). Nunca bloquea. */
      afterChange?: (subscriptionId: number, actor: string) => Promise<unknown>;
    },
  ) {
    this.now = d.now ?? Date.now;
  }

  // ── Resolución de las partidas contra el catálogo ──────────────────────────────

  private async currentPrice(product: CatalogProduct, kind: CatalogPrice["kind"], currency: string): Promise<CatalogPrice | null> {
    const offer = (await this.d.catalog.offer()).find((p) => p.key === product.key);
    return offer?.prices.filter((p) => p.kind === kind && p.currency === currency).sort((a, b) => b.id - a.id)[0] ?? null;
  }

  /**
   * Partida de catálogo: solo productos contratables por esa empresa. No entra uno en hoja de ruta, «próximamente», sin
   * publicar, interno o heredado, salvo que la suscripción YA lo tenga (`kept`); «bajo solicitud» sí (venta asistida).
   * La instantánea de activación la pone siempre el servidor.
   */
  private async catalogLine(i: CatalogLineInput, ctx: { interval: TermsInterval; currency: string; kept: ReadonlySet<string> }, sort: number): Promise<LineDraft> {
    const product = await this.d.catalog.product(i.productKey);
    if (!product) bad(`El producto «${i.productKey}» no existe o no está publicado`);
    const kept = ctx.kept.has(product.key);
    if (!kept) {
      if (product.technicalStatus === "planned") state(`«${product.name}» está en hoja de ruta: no es contratable`);
      if (product.commercialStatus === "coming_soon" || product.commercialStatus === "unpublished") state(`«${product.name}» aún no se puede contratar (${product.commercialStatus === "coming_soon" ? "próximamente" : "no publicado"})`);
      if (product.internalOnly) state(`«${product.name}» es un producto interno de pruebas`);
      if (product.legacy) {
        const successor = await this.d.catalog.product(product.legacy.replacedBy);
        state(legacyProductText(product.name, successor?.name ?? product.legacy.replacedBy));
      }
    }
    const price = await this.d.catalog.price(i.priceId);
    if (!price || price.productKey !== product.key) bad(`«${product.name}»: el precio de referencia no pertenece a ese producto`);
    if (price.status !== "approved" && !kept) state(`«${product.name}»: el precio oficial de referencia debe estar aprobado y vigente`);
    if (price.currency !== ctx.currency) bad(`«${product.name}»: el precio está en ${price.currency} y el acuerdo en ${ctx.currency}`);
    if (price.kind === "usage") bad(`«${product.name}»: los consumos no forman parte de un acuerdo de condiciones personalizadas`);
    let chargeClass: ChargeClass;
    if (recurringPrice(price.kind)) {
      if (price.kind !== recurringKind(ctx.interval)) bad(`«${product.name}»: con periodicidad ${ctx.interval === "year" ? "anual" : "mensual"} se necesita su precio ${ctx.interval === "year" ? "anual" : "mensual"} de referencia`);
      if (i.chargeClass) bad(`«${product.name}»: una cuota recurrente no es un cargo único`);
      chargeClass = "recurring";
    } else {
      if (product.family === "core_plan") bad("Un plan Core es siempre una cuota recurrente");
      chargeClass = i.chargeClass ?? "initial";
    }
    const quantity = i.quantity ?? 1;
    // Un producto por empresa y sin unidad de cobro se contrata una sola vez (la misma regla del cotizador)
    if (quantity > 1 && product.scope === "company" && !product.chargeUnit && !product.addonFor) bad(`«${product.name}» se contrata una sola vez por empresa`);
    const officialUnitCents = price.taxIncluded ? Math.round((price.amountCents * 10_000) / (10_000 + price.taxRateBp)) : price.amountCents;
    return {
      ref: product.key,
      kind: "catalog",
      concept: CONCEPT_OF[product.catalogFamily ?? product.family] ?? "other",
      productKey: product.key,
      priceId: price.id,
      catalog: { family: product.family, activationKind: product.activationKind, activationRef: product.activationRef, ...lineKindOf(product) },
      name: product.name,
      description: text(i.description, 2000),
      conditions: text(i.conditions, 2000),
      chargeClass,
      quantity,
      officialUnitCents,
      negotiatedUnitCents: i.negotiatedUnitCents ?? null,
      taxRateBp: price.taxRateBp,
      startsAt: i.startsAt ?? null,
      endsAt: i.endsAt ?? null,
      sort,
    };
  }

  /** Partida a medida: solo económica. Su referencia nunca coincide con un producto del catálogo. */
  private async customLine(i: CustomLineInput, sort: number): Promise<LineDraft> {
    // El esquema de la API ya rechaza cualquier campo de producto o activación; esta es la segunda barrera
    const extra = Object.keys(i).filter((k) => ["productKey", "priceId", "catalog", "activationKind", "activationRef", "capability", "capabilities", "family"].includes(k));
    if (extra.length) bad(`Una partida a medida no puede llevar producto, activación ni capacidades (${extra.join(", ")})`);
    // «custom:…»: los dos puntos no caben en una clave de producto, así que nunca coincidirá con el catálogo
    const ref = i.ref ?? `custom:${crypto.randomBytes(6).toString("hex")}`;
    if (!/^custom:[a-z0-9-]{1,60}$/.test(ref)) bad("Referencia de partida a medida no válida");
    return {
      ref,
      kind: "custom",
      concept: i.concept,
      productKey: null,
      priceId: null,
      catalog: null,
      name: (i.name ?? "").trim().slice(0, 160),
      description: text(i.description, 2000),
      conditions: text(i.conditions, 2000),
      chargeClass: i.chargeClass,
      quantity: i.quantity ?? 1,
      officialUnitCents: null,
      negotiatedUnitCents: i.unitCents,
      taxRateBp: i.taxRateBp,
      startsAt: i.startsAt ?? null,
      endsAt: i.endsAt ?? null,
      sort,
    };
  }

  private async resolve(input: TermsInput, ctx: { companyId: number; subscriptionId: number | null; interval: TermsInterval; currency: string; kept: ReadonlySet<string>; self?: number; trialing?: boolean }) {
    const reason = (input.reason ?? "").trim();
    if (reason.length < REASON_MIN) bad(`Indica el motivo (al menos ${REASON_MIN} caracteres)`);
    if (!Array.isArray(input.lines) || input.lines.length > 60) bad("Entre 1 y 60 partidas");
    const lines: LineDraft[] = [];
    for (let n = 0; n < input.lines.length; n++) {
      const l = input.lines[n];
      lines.push(l.kind === "catalog" ? await this.catalogLine(l, ctx, n) : l.kind === "custom" ? await this.customLine(l, n) : bad("Tipo de partida no válido"));
    }
    const adjustments: AdjustmentDraft[] = (input.adjustments ?? []).map((a) => {
      if (a.line !== null && !lines[a.line]) bad("Un ajuste apunta a una partida que no existe");
      return { lineRef: a.line === null ? null : lines[a.line].ref, type: a.type, mode: a.mode, value: a.value, recurrence: a.recurrence, endsAt: a.endsAt ?? null, note: text(a.note, 200) };
    });
    const now = this.now();
    if (input.effectiveFrom != null && input.effectiveFrom < now - 60_000) bad("La fecha efectiva no puede ser anterior a ahora: un cambio no tiene efectos retroactivos");
    const head: Omit<TermsHead, "companyId" | "subscriptionId"> = {
      pricingMode: input.pricingMode,
      globalAmountCents: input.pricingMode === "global" ? (input.globalAmountCents ?? null) : null,
      interval: ctx.interval,
      currency: ctx.currency,
      presentation: input.presentation,
      packageName: text(input.packageName, 160),
      conditions: text(input.conditions, 5000),
      effectiveFrom: input.effectiveFrom ?? null,
      effectiveTo: input.effectiveTo ?? null,
      afterEnd: input.afterEnd ?? null,
      nextTermsId: input.nextTermsId ?? null,
      requiresAcceptance: input.requiresAcceptance === true,
      reason: reason.slice(0, 500),
    };
    const probe = this.asTerms(head, lines, adjustments, { id: ctx.self ?? 0, companyId: ctx.companyId, subscriptionId: ctx.subscriptionId, effectiveFrom: head.effectiveFrom ?? now });
    const problems = validateTerms(probe);
    if (problems.length) bad(problems.join("; "), { problems });
    if (head.presentation !== "global" && head.presentation !== "breakdown") bad("Presentación no válida");
    if (head.nextTermsId !== null) await this.checkNext(head.nextTermsId, ctx, head.effectiveTo!);
    // Una suscripción es, como mínimo, una cuota recurrente (antes lo garantizaba el plan Core obligatorio)
    if (!lines.some(isRecurring)) bad(NEEDS_RECURRING);
    await this.checkComposition(lines);
    // …y en cada tramo de fechas: el plan tiene que cubrir la vigencia de todo producto que dependa de él
    await this.checkWindows({ lines, effectiveTo: head.effectiveTo }, head.effectiveFrom ?? now);
    if (ctx.trialing && !lines.some(isPlanLine)) state(TRIAL_NEEDS_PLAN, { reason: "trial_needs_plan" });
    if (ctx.subscriptionId === null && declaredServiceStart(probe) !== null && adjustments.some((a) => a.recurrence === "once" && (a.lineRef === null || lines.some((l) => l.ref === a.lineRef && isRecurring(l))))) bad(ONCE_WITH_SERVICE_START);
    return { head, lines, adjustments, probe };
  }

  /** Acuerdo «en memoria» a partir de un borrador sin guardar (ids provisionales), para validar y calcular. */
  private asTerms(head: Omit<TermsHead, "companyId" | "subscriptionId">, lines: LineDraft[], adjustments: AdjustmentDraft[], o: { id: number; companyId: number; subscriptionId: number | null; effectiveFrom: number }): Terms {
    const ls: TermsLine[] = lines.map((l, n) => ({ ...l, id: n + 1 }));
    const as: Adjustment[] = adjustments.map(({ lineRef, ...a }, n) => ({ ...a, id: n + 1, lineId: lineRef === null ? null : (ls.find((l) => l.ref === lineRef)?.id ?? -1) }));
    return { ...head, id: o.id, companyId: o.companyId, subscriptionId: o.subscriptionId, versionNo: 0, status: "draft", effectiveFrom: o.effectiveFrom, lines: ls, adjustments: as };
  }

  /** La condición siguiente ya programada: de la misma suscripción (o empresa), sin activar y que empiece donde acaba esta. */
  private async checkNext(nextId: number, ctx: { companyId: number; subscriptionId: number | null }, effectiveTo: number) {
    const next = await this.d.store.get(nextId);
    if (!next || next.companyId !== ctx.companyId || next.subscriptionId !== ctx.subscriptionId) bad("La condición siguiente no pertenece a esta suscripción");
    if (next.status !== "draft") state("La condición siguiente debe ser un borrador: se activa junto con esta");
    if (next.effectiveFrom !== effectiveTo) bad("La condición siguiente debe empezar exactamente cuando termina esta");
    if (next.requiresAcceptance) state("La condición siguiente se acepta junto con esta: no puede exigir su propia aceptación");
    if (next.afterEnd === "next_terms") state("Solo se encadena una condición programada: la siguiente no puede llevar otra detrás");
    await this.checkComposition(next.lines);
    await this.checkWindows(next, effectiveTo);
    return next;
  }

  /**
   * Composición del catálogo (como mucho un plan Core, dependencias, compatibilidad) de las cuotas recurrentes de
   * catálogo. El plan Core es obligatorio solo si alguna de ellas depende de él según el catálogo: un acuerdo con solo
   * partidas a medida (o con productos que el catálogo no ata a Core) no lo necesita.
   */
  private async checkComposition(lines: Array<Pick<TermsLine, "kind" | "chargeClass" | "productKey" | "catalog">>) {
    const items = lines.filter((l) => l.kind === "catalog" && l.chargeClass === "recurring").map((l) => ({ productKey: l.productKey!, family: l.catalog!.family, activationKind: l.catalog!.activationKind }));
    try {
      await this.d.subscriptions.checkComposition(items, { planOptional: true });
    } catch (e) {
      if (e instanceof SubscriptionError) throw new TermsError(e.code === "invalid_input" ? "invalid_input" : "invalid_state", e.message, e.details);
      throw e;
    }
  }

  /**
   * Composición en CADA tramo de fechas del acuerdo (cada inicio o fin propio de una cuota de catálogo): la vigencia del
   * plan Core tiene que cubrir la de todo producto que dependa de él, y la de un producto, la de los que lo requieren.
   * Sin esto, un producto podría regir sin plan entre dos fechas.
   */
  private async checkWindows(t: { lines: Array<Pick<TermsLine, "kind" | "chargeClass" | "productKey" | "catalog" | "startsAt" | "endsAt">>; effectiveTo: number | null }, from: number) {
    const rec = t.lines.filter((l) => l.kind === "catalog" && l.chargeClass === "recurring");
    const startOf = (l: (typeof rec)[number]) => Math.max(l.startsAt ?? from, from);
    const points = Array.from(new Set([from, ...rec.map(startOf), ...rec.filter((l) => l.endsAt !== null).map((l) => l.endsAt!)]))
      .filter((p) => p >= from && (t.effectiveTo === null || p < t.effectiveTo))
      .sort((a, b) => a - b);
    for (const p of points) {
      try {
        await this.checkComposition(rec.filter((l) => startOf(l) <= p && (l.endsAt === null || l.endsAt > p)));
      } catch (e) {
        if (!(e instanceof TermsError) || p === from) throw e;
        throw new TermsError(e.code, `Desde el ${madridDateTime(p)}: ${e.message}. La vigencia del plan Core (o del producto requerido) debe cubrir la de los productos que dependen de él`, { ...e.details, at: p });
      }
    }
  }

  /**
   * Como siempre: si el acuerdo lleva plan Core, el plan rige desde la entrada en vigor (un acuerdo no deja la
   * suscripción «a la espera» de su plan). Un acuerdo sin ninguna partida de plan no pasa por aquí.
   */
  private assertPlanFromStart(lines: Array<Pick<TermsLine, "kind" | "chargeClass" | "catalog" | "startsAt" | "endsAt">>, at: number) {
    const plans = lines.filter(isPlanLine);
    if (plans.length && !plans.some((l) => (l.startsAt ?? at) <= at && (l.endsAt === null || l.endsAt > at))) state(PLAN_FROM_START, { reason: "core_plan_required" });
  }

  // ── Borradores ─────────────────────────────────────────────────────────────────

  private async subscriptionCtx(subscriptionId: number, input: Pick<TermsInput, "interval">, self?: number) {
    const sub = await this.d.subscriptionStore.get(subscriptionId);
    if (!sub) throw new TermsError("not_found", "Suscripción no encontrada");
    if (sub.status === "canceled") state("La suscripción está cancelada: reactívala antes de personalizar sus condiciones");
    const items = await this.d.subscriptionStore.items(subscriptionId);
    const kept = new Set(items.filter((i) => i.effectiveTo === null || i.effectiveTo > this.now()).map((i) => i.productKey));
    return { sub, items, ctx: { companyId: sub.companyId, subscriptionId, interval: input.interval ?? sub.interval, currency: sub.currency, kept, self, trialing: sub.status === "trialing" } };
  }

  private event(kind: string, actor: string, reason: string, o: Partial<TermsEventDraft> = {}): TermsEventDraft {
    return { kind, actor, reason, before: null, after: null, effectiveAt: null, acceptanceStatus: null, syncResult: null, economic: null, ...o };
  }
  private shape(t: Pick<Terms, "pricingMode" | "globalAmountCents" | "presentation" | "interval" | "effectiveFrom" | "effectiveTo" | "afterEnd" | "nextTermsId"> & { lines: Array<Pick<TermsLine, "ref" | "name" | "kind" | "chargeClass" | "quantity" | "officialUnitCents" | "negotiatedUnitCents" | "taxRateBp">>; adjustments: unknown[] }) {
    return {
      pricingMode: t.pricingMode,
      globalAmountCents: t.globalAmountCents,
      presentation: t.presentation,
      interval: t.interval,
      effectiveFrom: t.effectiveFrom,
      effectiveTo: t.effectiveTo,
      afterEnd: t.afterEnd,
      nextTermsId: t.nextTermsId,
      lines: t.lines.map((l) => ({ ref: l.ref, name: l.name, kind: l.kind, chargeClass: l.chargeClass, quantity: l.quantity, officialUnitCents: l.officialUnitCents, negotiatedUnitCents: l.negotiatedUnitCents, taxRateBp: l.taxRateBp })),
      adjustments: t.adjustments,
    };
  }
  private economic(s: TermsSummary) {
    return { recurringNetCents: s.recurring.netCents, recurringTaxCents: s.recurring.taxCents, recurringTotalCents: s.recurring.totalCents, officialCents: s.recurring.officialCents, oneTimeNetCents: s.chargesTotals.netCents, onceAdjustmentsCents: s.credits.reduce((a, c) => a + c.cents, 0), firstNetCents: s.first.netCents, firstTotalCents: s.first.totalCents };
  }

  /** Borrador de condiciones para una suscripción existente. */
  async createForSubscription(subscriptionId: number, input: TermsInput, actor: string): Promise<TermsRecord> {
    const { ctx } = await this.subscriptionCtx(subscriptionId, input);
    const r = await this.resolve(input, ctx);
    return this.d.store.create({ ...r.head, companyId: ctx.companyId, subscriptionId }, r.lines, r.adjustments, this.event("draft_created", actor, r.head.reason, { after: this.shape({ ...r.head, lines: r.lines, adjustments: r.adjustments }), effectiveAt: r.head.effectiveFrom, acceptanceStatus: r.head.requiresAcceptance ? "pending" : "not_required", economic: this.economic(summarize(r.probe)) }), this.now());
  }

  /** Borrador de paquete personalizado para una empresa (contratación nueva: todavía sin suscripción). */
  async createPackage(companyId: number, input: TermsInput, actor: string): Promise<TermsRecord> {
    if (!(await this.d.crm.company(companyId))) bad("La empresa no existe");
    if (input.interval !== "month" && input.interval !== "year") bad("Indica la periodicidad del paquete");
    if (input.effectiveFrom != null) bad("Un paquete entra en vigor al preparar su contratación (o cuando el cliente lo acepta): no lleva fecha efectiva");
    const currency = (input.currency ?? "EUR").toUpperCase();
    const ctx = { companyId, subscriptionId: null, interval: input.interval, currency, kept: new Set<string>() };
    const r = await this.resolve(input, ctx);
    return this.d.store.create({ ...r.head, companyId, subscriptionId: null }, r.lines, r.adjustments, this.event("draft_created", actor, r.head.reason, { after: this.shape({ ...r.head, lines: r.lines, adjustments: r.adjustments }), effectiveAt: r.head.effectiveFrom, acceptanceStatus: r.head.requiresAcceptance ? "pending" : "not_required", economic: this.economic(summarize(r.probe)) }), this.now());
  }

  async must(id: number): Promise<TermsRecord> {
    const t = await this.d.store.get(id);
    if (!t) throw new TermsError("not_found", "Condiciones no encontradas");
    return t;
  }
  private conflict<T>(p: Promise<T>): Promise<T> {
    return p.catch((e) => {
      if (e instanceof TermsConflict) throw new TermsError("version_conflict", e.message, { current: e.current });
      if (e instanceof SubscriptionError) throw new TermsError(e.code === "conflict" ? "invalid_state" : e.code, e.message, e.details);
      throw e;
    });
  }

  /** Guarda una revisión nueva de un borrador. Un acuerdo activado o enviado a aceptación no se edita: se crea otro. */
  async updateDraft(id: number, input: TermsInput, expectedRevision: number, actor: string): Promise<TermsRecord> {
    const cur = await this.must(id);
    if (cur.status !== "draft") state("Solo se edita un borrador: unas condiciones activadas o enviadas a aceptación no se reescriben (crea unas nuevas)");
    await this.assertNotMaterialized(cur);
    await this.assertNotChained(cur);
    let ctx: { companyId: number; subscriptionId: number | null; interval: TermsInterval; currency: string; kept: ReadonlySet<string>; self?: number; trialing?: boolean };
    if (cur.subscriptionId !== null) ctx = (await this.subscriptionCtx(cur.subscriptionId, input, id)).ctx;
    else {
      if (input.effectiveFrom != null) bad("Un paquete entra en vigor al preparar su contratación (o cuando el cliente lo acepta): no lleva fecha efectiva");
      ctx = { companyId: cur.companyId, subscriptionId: null, interval: input.interval ?? cur.interval, currency: (input.currency ?? cur.currency).toUpperCase(), kept: new Set<string>(), self: id };
    }
    const r = await this.resolve(input, ctx);
    return this.conflict(
      this.d.store.saveDraft(id, expectedRevision, r.head, r.lines, r.adjustments, this.event("draft_updated", actor, r.head.reason, { before: this.shape(cur), after: this.shape({ ...r.head, lines: r.lines, adjustments: r.adjustments }), effectiveAt: r.head.effectiveFrom, acceptanceStatus: r.head.requiresAcceptance ? "pending" : "not_required", economic: this.economic(summarize(r.probe)) }), this.now()),
    );
  }

  /**
   * Una condición «siguiente» forma parte de lo que otro acuerdo ha enviado ya a aceptación (figura en su contrato):
   * mientras siga pendiente, no se toca.
   */
  private async assertNotChained(t: Pick<TermsRecord, "id" | "companyId">) {
    const waiting = (await this.d.store.list({ companyId: t.companyId, status: ["pending_acceptance"] })).find((x) => x.nextTermsId === t.id);
    if (waiting) state("Estas condiciones forman parte de un acuerdo enviado a aceptación: retíralo antes de cambiarlas", { reason: "chained_pending_acceptance", termsId: waiting.id });
  }

  /**
   * ¿Se podría activar ahora? Las mismas comprobaciones de la activación, sin cambiar nada. Se usa antes de enviar a
   * aceptación y antes de registrar la aceptación del cliente: no se acepta lo que no se va a poder activar.
   */
  async preflight(id: number): Promise<void> {
    const t = await this.must(id);
    const now = this.now();
    if (t.status !== "draft" && t.status !== "pending_acceptance") state("Estas condiciones ya no son un borrador");
    if (t.effectiveTo !== null && t.effectiveTo <= Math.max(now, t.effectiveFrom ?? 0)) state("La vigencia de estas condiciones ya ha terminado: actualiza las fechas");
    if (t.afterEnd === "next_terms" && t.nextTermsId !== null) await this.checkNext(t.nextTermsId, t, t.effectiveTo!);
    if (t.subscriptionId === null) {
      await this.checkPackage(t);
      return;
    }
    const sub = await this.d.subscriptionStore.get(t.subscriptionId);
    if (!sub) throw new TermsError("not_found", "Suscripción no encontrada");
    if (sub.status === "canceled") state("La suscripción está cancelada: reactívala antes de modificarla");
    if (now >= sub.currentPeriodEnd) state("Hay renovaciones vencidas sin aplicar: aplícalas antes de modificar la suscripción");
    if (this.d.stripeBilled && (await this.d.stripeBilled(sub.id))) state("Esta suscripción se cobra por Stripe: las condiciones personalizadas con cobro en Stripe aún no están habilitadas", { reason: "stripe_billed" });
    const at = this.effectiveAt(t, sub);
    if (t.interval !== sub.interval && at !== sub.currentPeriodEnd) state("Un cambio de periodicidad entra en vigor en la próxima renovación: indica esa fecha como fecha efectiva");
    const live = this.liveAt(t, at);
    const problems = validateTerms(live);
    if (problems.length) state(`Las condiciones ya no son válidas con la fecha efectiva real: ${problems.join("; ")}`, { problems });
    if (sub.status === "trialing" && !live.lines.some(isPlanLine)) state(TRIAL_NEEDS_PLAN, { reason: "trial_needs_plan" });
    if (sub.startedAt > now && at < sub.startedAt && (await this.d.subscriptionStore.items(sub.id)).length > 0) state(notStarted(sub.startedAt), { reason: "not_started" });
    this.assertPlanFromStart(live.lines, at);
    await this.checkWindows(live, at);
  }

  /** Una activación que se cortó a medias ya dejó las partidas en la suscripción: solo cabe repetirla para completarla. */
  private async assertNotMaterialized(t: Pick<TermsRecord, "id" | "subscriptionId">) {
    if (t.subscriptionId === null) return;
    if ((await this.d.subscriptionStore.items(t.subscriptionId)).some((i) => i.termsId === t.id)) state("Estas condiciones ya se aplicaron a la suscripción en una activación que no terminó: repite la activación para completarla", { reason: "activation_incomplete" });
  }

  /** Descarta un borrador (queda en el historial como anulado; nunca se borra). */
  async cancelDraft(id: number, input: { reason: string }, expectedRevision: number, actor: string): Promise<TermsRecord> {
    const cur = await this.must(id);
    const reason = (input.reason ?? "").trim();
    if (reason.length < REASON_MIN) bad(`Indica el motivo (al menos ${REASON_MIN} caracteres)`);
    if (cur.status !== "draft" && cur.status !== "pending_acceptance") state("Solo se anula un borrador o unas condiciones pendientes de aceptación");
    await this.assertNotMaterialized(cur);
    await this.assertNotChained(cur);
    return this.conflict(this.d.store.patch(id, { status: "cancelled", closedAt: this.now() }, this.event("cancelled", actor, reason.slice(0, 500), { before: { status: cur.status }, after: { status: "cancelled" } }), this.now(), expectedRevision));
  }

  // ── Vista previa ───────────────────────────────────────────────────────────────

  /** Fecha efectiva real si se activara ahora: nunca antes de ahora ni del inicio del periodo en curso. */
  private effectiveAt(t: Pick<Terms, "effectiveFrom">, sub: Subscription | null): number {
    return Math.max(t.effectiveFrom ?? 0, this.now(), sub?.currentPeriodStart ?? 0);
  }

  /** Cuota recurrente vigente de una suscripción en un instante (lo anterior a un cambio). */
  private current(sub: Subscription, items: SubscriptionItem[], at: number) {
    const live = sub.status === "canceled" ? [] : activeAt(items, at).filter((i) => recurringPrice(i.priceKind));
    const lines = live.map((i) => ({ ref: i.productKey, name: i.productName, quantity: i.quantity, taxRateBp: i.taxRateBp, netCents: lineAmounts(i, at).netCents, termsId: i.termsId ?? null }));
    const tax = groupTax(lines);
    const netCents = lines.reduce((a, l) => a + l.netCents, 0);
    const taxCents = tax.reduce((a, b) => a + b, 0);
    return { lines: lines.map((l, k) => ({ ...l, taxCents: tax[k] })), netCents, taxCents, totalCents: netCents + taxCents };
  }

  /**
   * Antes de confirmar: condiciones anteriores y nuevas, diferencia económica, fecha efectiva, prorrateo estimado,
   * próximo importe a cobrar y efecto sobre las licencias. No cambia nada.
   */
  async preview(id: number) {
    const t = await this.must(id);
    const now = this.now();
    const sub = t.subscriptionId !== null ? await this.d.subscriptionStore.get(t.subscriptionId) : null;
    const items = sub ? await this.d.subscriptionStore.items(sub.id) : [];
    const pending = t.status === "draft" || t.status === "pending_acceptance";
    // Paquete solo económico con fecha de inicio propia: las cuotas rigen desde esa fecha (periodos completos); lo que
    // no lleva fecha (un cargo único) se debe al contratar
    const serviceFrom = pending && t.subscriptionId === null ? this.serviceStart(t) : null;
    const from = pending ? (serviceFrom ?? this.effectiveAt(t, sub)) : (t.effectiveFrom ?? now);
    const at: Terms = { ...t, effectiveFrom: from, lines: serviceFrom === null ? t.lines : t.lines.map((l) => (!isRecurring(l) && (l.startsAt === null || l.startsAt < now) ? { ...l, startsAt: now } : l)) };
    const summary = summarize(at);
    const onContracting = serviceFrom === null ? [] : summary.charges.filter((c) => c.at < serviceFrom);
    const before = sub ? this.current(sub, items, Math.max(now, Math.min(from, sub.currentPeriodEnd - 1))) : null;
    // Prorrateo estimado de un cambio a mitad de periodo: por cada cuota, el resto del periodo al importe nuevo menos
    // la parte no consumida del anterior ya cobrado. Nunca negativo (sin abonos por lo no consumido)
    let prorationNetCents = 0;
    if (sub && from > sub.currentPeriodStart && from < sub.currentPeriodEnd) {
      const frac = coverage(sub.currentPeriodStart, sub.currentPeriodEnd, Math.max(from, sub.trialEnd ?? 0), null);
      for (const l of summary.recurring.lines) {
        const ref = t.lines.find((x) => x.id === l.lineId)!.ref;
        const prev = before?.lines.find((b) => b.ref === ref);
        prorationNetCents += Math.max(0, Math.floor(l.netCents * frac) - (prev ? Math.floor(prev.netCents * frac) : 0));
      }
    }
    // Próximo cobro: la primera renovación desde la fecha efectiva, con los ajustes de un solo uso
    const nextAt = sub ? (from >= sub.currentPeriodEnd ? from : sub.currentPeriodEnd) : from;
    const renewal = recurringAt(at, nextAt);
    const credit = summary.credits.reduce((a, c) => a + c.cents, 0);
    const nextLines = [...renewal.lines.map((l) => ({ netCents: l.netCents, taxRateBp: l.taxRateBp })), ...summary.credits.flatMap((c) => c.parts.map((p) => ({ netCents: p.cents, taxRateBp: p.taxRateBp })))];
    const nextNet = Math.max(0, renewal.netCents + credit);
    const nextTax = nextNet === 0 ? 0 : groupTax(nextLines).reduce((a, b) => a + b, 0);
    // Licencias: salen de los productos de catálogo, nunca del importe ni de una partida a medida
    const planBefore = sub ? licencePlan(sub, items, Math.max(now, Math.min(from, sub.currentPeriodEnd - 1))) : null;
    const after = t.lines.filter((l) => l.kind === "catalog" && isRecurring(l) && (l.startsAt ?? from) <= from && (l.endsAt === null || l.endsAt > from));
    const modulesAfter = after.filter((l) => l.catalog!.activationKind === "module" && l.catalog!.activationRef).map((l) => l.catalog!.activationRef!);
    const modulesBefore = planBefore?.modules.map((m) => m.moduleId) ?? [];
    const productsBefore = new Map((sub && sub.status !== "canceled" ? activeAt(items, Math.max(now, Math.min(from, sub.currentPeriodEnd - 1))) : []).filter((i) => recurringPrice(i.priceKind) && !i.productKey.includes(":")).map((i) => [i.productKey, { name: i.productName, plan: i.family === "core_plan" }] as const));
    const planLineAfter = after.find((l) => l.catalog!.family === "core_plan") ?? null;
    const planKeyBefore = Array.from(productsBefore).find(([, p]) => p.plan) ?? null;
    const planAfter = after.find((l) => l.catalog!.family === "core_plan" && l.catalog!.activationKind === "plan")?.catalog!.activationRef ?? null;
    // Sin ningún producto de catálogo (ni ahora ni programado): el acuerdo es solo económico y no concede nada
    const grantsNothing = termsEconomicOnly(t.lines);
    return {
      terms: { ...t, effectiveStatus: effectiveStatus(t, now) },
      effectiveFrom: from,
      timeZone: "Europe/Madrid" as const,
      summary,
      before,
      difference: difference(before, summary.recurring),
      // Lo negociado frente a la tarifa oficial de referencia (negativo = por debajo de la tarifa)
      differenceVsOfficialCents: summary.recurring.netCents - summary.recurring.officialCents,
      prorationNetCents,
      nextCharge: { at: nextAt, netCents: nextNet, taxCents: nextTax, totalCents: nextNet + nextTax },
      nextRenewalAt: sub ? sub.currentPeriodEnd : null,
      /**
       * Paquete solo económico con fecha de inicio: el servicio y sus cuotas empiezan en `at` (meses completos de
       * calendario de Madrid desde entonces) y `onContracting` es lo que se debe ya al contratar (cargos únicos).
       */
      serviceStart:
        serviceFrom === null
          ? null
          : { at: serviceFrom, onContracting: { netCents: onContracting.reduce((a, c) => a + c.netCents, 0), taxCents: onContracting.reduce((a, c) => a + c.taxCents, 0), totalCents: onContracting.reduce((a, c) => a + c.totalCents, 0) } },
      licences: {
        note: grantsNothing ? NO_LICENCES_NOTE : "Los derechos dependen de los productos incluidos, no del importe. Una partida a medida no concede licencias.",
        /** El acuerdo no concede licencias, límites ni plataforma (solo partidas a medida). */
        grantsNothing,
        planBefore: planBefore?.plan ?? null,
        // El plan Core como PRODUCTO (el catálogo actual concede sus derechos por capacidades, no por una referencia de plan)
        planProductBefore: planKeyBefore ? { key: planKeyBefore[0], name: planKeyBefore[1].name } : null,
        planProductAfter: planLineAfter ? { key: planLineAfter.productKey!, name: planLineAfter.name } : null,
        planAfter,
        added: modulesAfter.filter((m) => !modulesBefore.includes(m)),
        removed: modulesBefore.filter((m) => !modulesAfter.includes(m)),
        kept: modulesAfter.filter((m) => modulesBefore.includes(m)),
        // Productos de catálogo (los que conceden derechos) que entran, salen o se conservan
        products: {
          added: after.filter((l) => !productsBefore.has(l.productKey!)).map((l) => ({ key: l.productKey!, name: l.name, plan: l.catalog!.family === "core_plan" })),
          removed: Array.from(productsBefore).filter(([k]) => !after.some((l) => l.productKey === k)).map(([key, p]) => ({ key, name: p.name, plan: p.plan })),
          kept: after.filter((l) => productsBefore.has(l.productKey!)).map((l) => ({ key: l.productKey!, name: l.name, plan: l.catalog!.family === "core_plan" })),
        },
      },
    };
  }

  // ── Activación ─────────────────────────────────────────────────────────────────

  private newItem(t: Pick<Terms, "id" | "interval" | "lines">, p: PlannedItem, actor: string): NewItem {
    const now = this.now();
    const base = { quantity: p.quantity, taxRateBp: p.taxRateBp, taxIncluded: false, discount: null, effectiveFrom: p.from, effectiveTo: p.to, createdAt: now, createdBy: actor, termsId: t.id, lineAmountCents: p.amountCents, priceSource: "contract" as const, unit: null };
    if (p.role === "credit") {
      // Abono de un solo uso: partida económica sin producto ni activación
      return { ...base, family: "service", lineKind: "service", metric: null, productKey: creditKey(p.adjustmentId!), productName: p.name, activationKind: "none", activationRef: null, priceId: null, priceKind: "one_time", unitAmountCents: 0, termsLineId: null };
    }
    const line = t.lines.find((l) => l.id === p.lineId)!;
    const priceKind = isRecurring(line) ? recurringKind(t.interval) : ("one_time" as const);
    const unitAmountCents = Math.max(0, Math.round(p.amountCents / p.quantity));
    if (line.kind === "custom") {
      // Partida a medida: clave que no existe en el catálogo y sin activación. Nunca concede licencias
      return { ...base, family: "service", lineKind: "service", metric: null, productKey: line.ref, productName: line.name, activationKind: "none", activationRef: null, priceId: null, priceKind, unitAmountCents, termsLineId: line.id };
    }
    const c = line.catalog!;
    return { ...base, family: c.family, lineKind: c.lineKind, metric: c.metric, productKey: line.productKey!, productName: line.name, activationKind: c.activationKind, activationRef: c.activationRef, priceId: line.priceId, priceKind, unitAmountCents, termsLineId: line.id };
  }

  /**
   * Activa unas condiciones sobre su suscripción (inmediatas, en la próxima renovación o en una fecha futura). Una
   * sola mutación de la suscripción; después se marca el acuerdo. Si el proceso se corta entre ambas, repetir la
   * activación completa el segundo paso sin volver a materializar (recuperación ante fallos parciales).
   */
  async activate(id: number, input: { expectedRevision: number; expectedVersion: number; reason?: string | null }, actor: string, internal: { at?: number } = {}) {
    const t = await this.must(id);
    if (t.subscriptionId === null) state("Es un paquete para una contratación nueva: prepara la contratación para crear su suscripción");
    if (t.status !== "draft" && t.status !== "pending_acceptance") state("Estas condiciones ya no son un borrador");
    if (t.revision !== input.expectedRevision) throw new TermsError("version_conflict", `Otra persona modificó estas condiciones antes (revisión actual ${t.revision}). Recarga para no perder cambios.`, { current: t.revision });
    // Lo que depende de la aceptación del cliente no se activa por adelantado
    if (t.requiresAcceptance && t.acceptanceStatus !== "accepted") state("Estas condiciones exigen la aceptación del cliente: envíalas a aceptación; se activarán al aceptarse", { reason: "acceptance_required" });
    const subscriptionId = t.subscriptionId;
    if (this.d.stripeBilled && (await this.d.stripeBilled(subscriptionId))) state("Esta suscripción se cobra por Stripe: las condiciones personalizadas con cobro en Stripe aún no están habilitadas", { reason: "stripe_billed" });
    const next = t.afterEnd === "next_terms" && t.nextTermsId !== null ? await this.checkNext(t.nextTermsId, t, t.effectiveTo!) : null;
    const reason = text(input.reason, 500) ?? t.reason;
    // Paquete cuya contratación se cortó tras crear su suscripción y se completa con «activar»: como al preparar la
    // contratación, rige desde el primer instante de esa suscripción (la partida del alta no llega a facturarse)
    if (internal.at === undefined && (await this.d.store.events({ termsId: t.id })).some((e) => e.kind === "subscription_created" && (e.after as { subscriptionId?: number } | null)?.subscriptionId === subscriptionId)) {
      const created = await this.d.subscriptionStore.get(subscriptionId);
      if (created && created.version === 1) internal = { at: created.currentPeriodStart };
    }
    const now = this.now();
    const existing = await this.d.subscriptionStore.items(subscriptionId);
    // Contratación nueva: el acuerdo rige desde el primer instante de una suscripción recién creada para él
    const newContract = internal.at !== undefined;
    let from: number;
    let beforePicture: ReturnType<CommercialTermsService["current"]> | null = null;
    if (existing.some((i) => i.termsId === t.id)) {
      // Ya materializado en un intento anterior: solo falta marcar el acuerdo. Debe ser la MISMA revisión que se aplicó
      const applied = (await this.d.subscriptionStore.events(subscriptionId)).filter((e) => e.kind === "terms_applied" && (e.after as { termsId?: number } | null)?.termsId === t.id).pop();
      const info = (applied?.after ?? {}) as { revision?: number; effectiveFrom?: number };
      if (info.revision !== t.revision) state("Estas condiciones se aplicaron con otra revisión del borrador: no se puede completar la activación; crea unas condiciones nuevas", { reason: "revision_mismatch" });
      from = info.effectiveFrom ?? Math.min(...existing.filter((i) => i.termsId === t.id).map((i) => i.effectiveFrom));
    } else {
      const out = await this.conflict(
        this.d.subscriptionStore.mutate(subscriptionId, input.expectedVersion, actor, now, async (tx, sub) => {
          if (sub.status === "canceled") state("La suscripción está cancelada: reactívala antes de modificarla");
          if (now >= sub.currentPeriodEnd) state("Hay renovaciones vencidas sin aplicar: aplícalas antes de modificar la suscripción");
          const at = internal.at ?? this.effectiveAt(t, sub);
          if (t.effectiveTo !== null && t.effectiveTo <= at) state("La vigencia de estas condiciones ya ha terminado: actualiza las fechas");
          if (t.interval !== sub.interval && at !== sub.currentPeriodEnd) state("Un cambio de periodicidad entra en vigor en la próxima renovación: indica esa fecha como fecha efectiva");
          const items = await tx.items();
          const live = this.liveAt(t, at);
          const problems = validateTerms(live);
          if (problems.length) state(`Las condiciones ya no son válidas con la fecha efectiva real: ${problems.join("; ")}`, { problems });
          if (sub.status === "trialing" && !live.lines.some(isPlanLine)) state(TRIAL_NEEDS_PLAN, { reason: "trial_needs_plan" });
          // Suscripción económica que aún no ha empezado: un cambio no puede regir antes de su fecha de inicio (el
          // periodo previo no es un mes: no hay cuota que prorratear)
          if (!newContract && sub.startedAt > now && at < sub.startedAt) state(notStarted(sub.startedAt), { reason: "not_started" });
          this.assertPlanFromStart(live.lines, at);
          await this.checkWindows(live, at);
          const before = this.current(sub, items, Math.max(now, Math.min(at, sub.currentPeriodEnd - 1)));
          const planned = [...materialize(live).map((p) => ({ t: live as Pick<Terms, "id" | "interval" | "lines">, p })), ...(next ? materialize(next).map((p) => ({ t: next as Pick<Terms, "id" | "interval" | "lines">, p })) : [])];
          // Cierra lo vigente: las cuotas recurrentes en la fecha efectiva; los cargos y abonos de un acuerdo anterior aún
          // no llegados se anulan (ventana vacía). Lo ya facturado y los consumos no se tocan
          const closed: Array<{ item: string; effectiveTo: number }> = [];
          for (const i of items) {
            if (i.priceKind === "usage" || isVoid(i)) continue;
            if (i.priceKind === "one_time") {
              if (i.termsId != null && i.effectiveFrom > at) await tx.endItem(i.id, i.effectiveFrom);
              continue;
            }
            if (i.effectiveTo === null || i.effectiveTo > at) {
              await tx.endItem(i.id, Math.max(i.effectiveFrom, at));
              closed.push({ item: i.productKey, effectiveTo: Math.max(i.effectiveFrom, at) });
            }
          }
          const created: SubscriptionItem[] = [];
          for (const { t: owner, p } of planned) created.push(await tx.insertItem(this.newItem(owner, p, actor)));
          const s = summarize(live);
          return {
            // Sin cambio de periodicidad, cualquier cambio de periodicidad pendiente (de un acuerdo anterior) queda sin efecto
            patch: { pendingInterval: t.interval !== sub.interval ? t.interval : null },
            event: {
              kind: "terms_applied" as const,
              // En una contratación nueva la partida del alta queda sin ventana (nunca rige ni se factura): no es un «antes»
              before: newContract ? { newContract: true } : { termsId: before.lines.find((l) => l.termsId !== null)?.termsId ?? null, recurringNetCents: before.netCents, items: closed },
              after: { termsId: t.id, revision: t.revision, pricingMode: t.pricingMode, effectiveFrom: at, effectiveTo: t.effectiveTo, recurringNetCents: s.recurring.netCents, items: created.map((c) => ({ item: c.productKey, lineAmountCents: c.lineAmountCents ?? null, effectiveFrom: c.effectiveFrom, effectiveTo: c.effectiveTo })) },
              reason,
            },
            result: { at, before: newContract ? null : before },
          };
        }),
      );
      from = out.result.at;
      beforePicture = out.result.before;
    }
    const live: Terms = this.liveAt(t, from);
    const summary = summarize(live);
    const economic = { ...this.economic(summary), newContract, before: beforePicture ? { recurringNetCents: beforePicture.netCents } : null, difference: beforePicture ? difference(beforePicture, summary.recurring) : null };
    // Los acuerdos anteriores de la suscripción quedan sustituidos desde la fecha efectiva
    for (const old of await this.d.store.list({ subscriptionId, status: ["active", "scheduled"] })) {
      if (old.id === t.id || old.id === next?.id || (old.closedAt !== null && old.closedAt <= from)) continue;
      // Con fecha futura, el acuerdo anterior sigue vigente hasta entonces (`closedAt`); si aún no había empezado, o el
      // cambio es inmediato, queda sustituido ya
      const still = from > now && (old.effectiveFrom ?? 0) < from;
      await this.d.store.patch(old.id, still ? { closedAt: from } : { status: "superseded", closedAt: from }, this.event("superseded", actor, reason, { before: { status: old.status }, after: { status: "superseded", by: t.id }, effectiveAt: from }), now);
    }
    if (next) {
      await this.d.store.patch(next.id, { status: "scheduled", activatedAt: now, activatedBy: actor, summary: summarize(next), inputHash: stableHash(this.shape(next)) }, this.event("activated", actor, reason, { after: this.shape(next), effectiveAt: next.effectiveFrom, acceptanceStatus: t.acceptanceStatus, syncResult: "not_applicable", economic: this.economic(summarize(next)) }), now);
    }
    const done = await this.d.store.patch(
      t.id,
      { status: from > now ? "scheduled" : "active", effectiveFrom: from, activatedAt: now, activatedBy: actor, summary, inputHash: stableHash(this.shape(live)) },
      this.event("activated", actor, reason, { before: beforePicture ? { recurringNetCents: beforePicture.netCents, lines: beforePicture.lines } : null, after: this.shape(live), effectiveAt: from, acceptanceStatus: t.acceptanceStatus, syncResult: "not_applicable", economic }),
      now,
    );
    await this.d.afterChange?.(subscriptionId, actor).catch(() => undefined);
    return { terms: done, subscription: (await this.d.subscriptionStore.get(subscriptionId))!, effectiveFrom: from, summary };
  }

  /**
   * El acuerdo con la fecha efectiva REAL: un cargo único con fecha anterior se lleva a esa fecha (si no, nacería
   * fuera del periodo y nunca se facturaría) y una cuota con inicio propio ya pasado empieza con el acuerdo.
   */
  private liveAt(t: TermsRecord, at: number): TermsRecord {
    return { ...t, effectiveFrom: at, lines: t.lines.map((l) => (l.startsAt !== null && l.startsAt <= at ? { ...l, startsAt: isRecurring(l) ? null : at } : l)) };
  }

  // ── Punto de partida y restauración de la tarifa oficial ───────────────────────

  /** Acuerdo vigente de una suscripción (activado y dentro de su vigencia), si lo hay. */
  async currentTerms(subscriptionId: number): Promise<TermsRecord | null> {
    const now = this.now();
    const all = await this.d.store.list({ subscriptionId, status: ["active", "scheduled"] });
    // Además, con partidas suyas vivas: si otra operación (p. ej. la conversión de una prueba) las cerró, ya no rige
    const liveTerms = new Set((await this.d.subscriptionStore.items(subscriptionId)).filter((i) => i.termsId != null && i.effectiveFrom <= now && (i.effectiveTo === null || i.effectiveTo > now)).map((i) => i.termsId!));
    return all.filter((t) => effectiveStatus(t, now) === "active" && liveTerms.has(t.id)).sort((a, b) => b.id - a.id)[0] ?? null;
  }

  /**
   * Punto de partida para modificar las condiciones de una suscripción: lo que tiene AHORA, en el formato de entrada.
   * Solo cuotas recurrentes vigentes y cargos aún no llegados: lo ya facturado y los ajustes de un solo uso ya
   * aplicados no se arrastran (no se cobran ni se descuentan dos veces).
   */
  async base(subscriptionId: number): Promise<{ subscriptionVersion: number; termsId: number | null; interval: TermsInterval; input: Omit<TermsInput, "reason">; official: Array<{ line: number; officialUnitCents: number | null; name: string; family: string | null }> }> {
    const { sub, items } = await this.subscriptionCtx(subscriptionId, {});
    const now = this.now();
    const cur = await this.currentTerms(subscriptionId);
    const lines: LineInput[] = [];
    const official: Array<{ line: number; officialUnitCents: number | null; name: string; family: string | null }> = [];
    const adjustments: AdjustmentInput[] = [];
    if (cur) {
      const kept = cur.lines.filter((l) => (isRecurring(l) ? l.endsAt === null || l.endsAt > now : (l.startsAt ?? cur.effectiveFrom ?? 0) > now));
      const future = (v: number | null) => (v !== null && v > now ? v : null);
      for (const l of kept) {
        official.push({ line: lines.length, officialUnitCents: l.officialUnitCents, name: l.name, family: l.catalog?.family ?? null });
        lines.push(
          l.kind === "catalog"
            ? { kind: "catalog", productKey: l.productKey!, priceId: l.priceId!, quantity: l.quantity, negotiatedUnitCents: l.negotiatedUnitCents, ...(isRecurring(l) ? { startsAt: future(l.startsAt) } : { chargeClass: l.chargeClass as "initial" | "extraordinary", startsAt: l.startsAt }), description: l.description, conditions: l.conditions, endsAt: l.endsAt }
            : { kind: "custom", ref: l.ref, concept: l.concept, name: l.name, description: l.description, conditions: l.conditions, chargeClass: l.chargeClass, quantity: l.quantity, unitCents: l.negotiatedUnitCents!, taxRateBp: l.taxRateBp, startsAt: isRecurring(l) ? future(l.startsAt) : l.startsAt, endsAt: l.endsAt },
        );
      }
      for (const a of cur.adjustments.filter((x) => x.recurrence === "recurring" && (x.endsAt === null || x.endsAt > now))) {
        const idx = a.lineId === null ? null : kept.findIndex((l) => l.id === a.lineId);
        if (idx === -1) continue;
        adjustments.push({ line: idx, type: a.type, mode: a.mode, value: a.value, recurrence: "recurring", endsAt: a.endsAt, note: a.note });
      }
      // Una condición encadenada (`next_terms`) no se arrastra: el punto de partida queda indefinido
      const chained = cur.afterEnd === "next_terms";
      return { subscriptionVersion: sub.version, termsId: cur.id, interval: sub.interval, input: { pricingMode: cur.pricingMode, globalAmountCents: cur.globalAmountCents, presentation: cur.presentation, packageName: cur.packageName, conditions: cur.conditions, effectiveTo: chained ? null : cur.effectiveTo, afterEnd: chained ? null : cur.afterEnd, requiresAcceptance: cur.requiresAcceptance, lines, adjustments }, official };
    }
    // Sin acuerdo previo: las partidas tal como están contratadas (precio de catálogo o de contrato y su descuento)
    const origin = new Map<number, TermsRecord | null>();
    for (const i of activeAt(items, now).filter((x) => recurringPrice(x.priceKind))) {
      if (i.priceId === null) {
        // Partida a medida de un acuerdo ya vencido: se conserva con su referencia, su concepto y su precio
        if (i.termsId == null || !/^custom:/.test(i.productKey)) continue;
        if (!origin.has(i.termsId)) origin.set(i.termsId, await this.d.store.get(i.termsId));
        const src = origin.get(i.termsId)?.lines.find((l) => l.id === i.termsLineId);
        const amount = i.lineAmountCents ?? i.unitAmountCents * i.quantity;
        const whole = amount % i.quantity === 0;
        official.push({ line: lines.length, officialUnitCents: null, name: i.productName, family: null });
        lines.push({ kind: "custom", ref: i.productKey, concept: src?.concept ?? "other", name: i.productName, description: src?.description ?? null, conditions: src?.conditions ?? null, chargeClass: "recurring", quantity: whole ? i.quantity : 1, unitCents: whole ? amount / i.quantity : amount, taxRateBp: i.taxRateBp });
        continue;
      }
      const price = await this.d.catalog.price(i.priceId);
      const officialUnit = price ? (price.taxIncluded ? Math.round((price.amountCents * 10_000) / (10_000 + price.taxRateBp)) : price.amountCents) : null;
      const unit = i.lineAmountCents != null ? Math.round(i.lineAmountCents / i.quantity) : i.taxIncluded ? Math.round((i.unitAmountCents * 10_000) / (10_000 + i.taxRateBp)) : i.unitAmountCents;
      official.push({ line: lines.length, officialUnitCents: officialUnit, name: i.productName, family: i.family });
      if (i.discount && (i.discount.endsAt === null || i.discount.endsAt > now)) {
        adjustments.push({ line: lines.length, type: "discount", mode: i.discount.kind, value: i.discount.kind === "percent" ? i.discount.value * 100 : i.discount.value, recurrence: "recurring", endsAt: i.discount.endsAt, note: i.discount.note });
      }
      lines.push({ kind: "catalog", productKey: i.productKey, priceId: i.priceId, quantity: i.quantity, negotiatedUnitCents: officialUnit !== null && unit !== officialUnit ? unit : null });
    }
    return { subscriptionVersion: sub.version, termsId: null, interval: sub.interval, input: { pricingMode: "per_item", presentation: "breakdown", lines, adjustments }, official };
  }

  /**
   * Restaura las tarifas oficiales: las partidas de catálogo pasan al precio oficial VIGENTE hoy (queda fijado en el
   * acuerdo), sin ajustes; las partidas a medida conservan su precio. Es un acuerdo más, con su historial.
   */
  async restoreOfficial(subscriptionId: number, input: { effectiveFrom?: number | null; reason: string; expectedVersion: number }, actor: string) {
    const { sub } = await this.subscriptionCtx(subscriptionId, {});
    const b = await this.base(subscriptionId);
    const lines: LineInput[] = [];
    for (const l of b.input.lines) {
      if (l.kind === "custom") {
        lines.push(l);
        continue;
      }
      const product = await this.d.catalog.product(l.productKey);
      const ref = await this.d.catalog.price(l.priceId);
      const cur = product && ref ? await this.currentPrice(product, ref.kind, sub.currency) : null;
      lines.push({ ...l, priceId: cur?.id ?? l.priceId, negotiatedUnitCents: null });
    }
    const draft = await this.createForSubscription(subscriptionId, { pricingMode: "per_item", presentation: "breakdown", effectiveFrom: input.effectiveFrom ?? null, lines, adjustments: [], reason: input.reason }, actor);
    try {
      return await this.activate(draft.id, { expectedRevision: draft.revision, expectedVersion: input.expectedVersion }, actor);
    } catch (e) {
      // Si no llegó a aplicarse, el borrador no queda huérfano (si se aplicó a medias, se completa repitiendo la activación)
      const left = await this.d.store.get(draft.id);
      const applied = (await this.d.subscriptionStore.items(subscriptionId)).some((i) => i.termsId === draft.id);
      if (left?.status === "draft" && !applied) await this.d.store.patch(draft.id, { status: "cancelled", closedAt: this.now() }, this.event("cancelled", actor, "La restauración de la tarifa oficial no pudo aplicarse", { before: { status: "draft" }, after: { status: "cancelled" } }), this.now());
      throw e;
    }
  }

  // ── Fin de las condiciones temporales ──────────────────────────────────────────

  /**
   * Condiciones temporales ya vencidas de una suscripción. Las partidas posteriores ya están materializadas y entran
   * solas; aquí solo se resuelve la opción «tarifa oficial vigente en la fecha del cambio»: se lee el catálogo de hoy y,
   * si el importe difiere del provisional, se sustituye la partida y se registra el importe aplicado. Idempotente; si no
   * se ejecuta, sigue valiendo la tarifa provisional (la fijada al pactar).
   */
  async settleDue(subscriptionId: number, actor = "system:terms"): Promise<{ settled: number }> {
    const now = this.now();
    let settled = 0;
    for (const t of await this.d.store.list({ subscriptionId, status: ["active", "scheduled"] })) {
      if (t.effectiveTo === null || t.effectiveTo > now) continue;
      // Sustituido por otro acuerdo antes de vencer: sus partidas posteriores ya no existen
      if (t.closedAt !== null && t.closedAt <= t.effectiveTo) continue;
      const end = t.effectiveTo;
      const applied: Array<{ item: string; provisionalCents: number; appliedCents: number; priceId: number | null }> = [];
      if (t.afterEnd === "official_current") {
        const sub = await this.d.subscriptionStore.get(subscriptionId);
        if (!sub || sub.status === "canceled") continue;
        const changes: Array<{ old: SubscriptionItem; priceId: number; cents: number }> = [];
        const items = await this.d.subscriptionStore.items(subscriptionId);
        for (const i of items.filter((x) => x.termsId === t.id && x.effectiveFrom === end && !isVoid(x) && recurringPrice(x.priceKind) && x.termsLineId != null)) {
          const line = t.lines.find((l) => l.id === i.termsLineId);
          if (!line || line.kind !== "catalog") continue;
          const product = await this.d.catalog.product(line.productKey!);
          const price = product ? await this.currentPrice(product, i.priceKind, sub.currency) : null;
          // Producto retirado o sin precio aprobado: sigue valiendo la tarifa fijada al pactar
          const unit = price ? (price.taxIncluded ? Math.round((price.amountCents * 10_000) / (10_000 + price.taxRateBp)) : price.amountCents) : null;
          const cents = unit === null ? (i.lineAmountCents ?? 0) : unit * i.quantity;
          applied.push({ item: i.productKey, provisionalCents: i.lineAmountCents ?? 0, appliedCents: cents, priceId: price?.id ?? i.priceId });
          if (price && cents !== i.lineAmountCents) changes.push({ old: i, priceId: price.id, cents });
        }
        if (changes.length) {
          await this.conflict(
            this.d.subscriptionStore.mutate(subscriptionId, null, actor, now, async (tx) => {
              for (const c of changes) {
                const { id: _id, subscriptionId: _sid, ...snap } = c.old;
                await tx.endItem(c.old.id, c.old.effectiveFrom);
                await tx.insertItem({ ...snap, priceId: c.priceId, lineAmountCents: c.cents, unitAmountCents: Math.round(c.cents / c.old.quantity), createdAt: now, createdBy: actor });
              }
              return { patch: {}, event: { kind: "terms_settled" as const, before: { termsId: t.id, items: changes.map((c) => ({ item: c.old.productKey, lineAmountCents: c.old.lineAmountCents ?? null })) }, after: { effectiveFrom: end, items: changes.map((c) => ({ item: c.old.productKey, lineAmountCents: c.cents, priceId: c.priceId })) }, reason: "Fin de la condición temporal: tarifa oficial vigente en la fecha del cambio" }, result: null };
            }),
          );
        }
      }
      await this.d.store.patch(t.id, { status: "expired", closedAt: end }, this.event("expired", actor, "Fin de la vigencia de la condición temporal", { before: { status: t.status }, after: { status: "expired", afterEnd: t.afterEnd, applied }, effectiveAt: end }), now);
      settled++;
    }
    if (settled) await this.d.afterChange?.(subscriptionId, actor).catch(() => undefined);
    return { settled };
  }

  // ── Paquetes: contratación nueva ───────────────────────────────────────────────

  /**
   * Fecha FUTURA en la que empieza el servicio de un paquete solo económico cuyas cuotas llevan todas su fecha de
   * inicio (`declaredServiceStart`); null en cualquier otro caso (el paquete empieza al contratarlo, como siempre). Un
   * paquete con plan Core nunca se ancla a futuro: su plan rige desde la contratación.
   */
  private serviceStart(t: Pick<Terms, "lines">): number | null {
    const declared = declaredServiceStart({ effectiveFrom: null, lines: t.lines });
    return declared !== null && declared > this.now() ? declared : null;
  }

  /** Lo que se comprueba de un paquete antes de crear su suscripción (y antes de enviarlo a aceptación). */
  private async checkPackage(t: TermsRecord) {
    const now = this.now();
    if (!t.lines.some(isRecurring)) state(NEEDS_RECURRING);
    // El plan Core solo es obligatorio si algún producto del paquete depende de él (lo decide la composición)
    await this.checkComposition(t.lines);
    const live = this.liveAt(t, now);
    const problems = validateTerms(live);
    if (problems.length) state(`Las condiciones no son válidas si el paquete se contratase ahora: ${problems.join("; ")}`, { problems });
    this.assertPlanFromStart(live.lines, now);
    await this.checkWindows(live, now);
    if (declaredServiceStart({ effectiveFrom: null, lines: t.lines }) !== null && t.adjustments.some((a) => a.recurrence === "once" && (a.lineId === null || t.lines.some((l) => l.id === a.lineId && isRecurring(l))))) state(ONCE_WITH_SERVICE_START);
  }

  /**
   * Prepara la contratación de un paquete: crea la suscripción de la empresa (con el plan Core del paquete o, si el
   * paquete no lleva ninguno, sin plan ni plataforma) y le aplica el acuerdo desde su primer instante. Un paquete solo
   * económico cuyas cuotas llevan todas una fecha de inicio futura nace con un periodo previo hasta esa fecha y, desde
   * ella, periodos completos de calendario de Madrid (`serviceStart`): la primera cuota es un periodo completo, sin
   * parte proporcional. Sin cobros (la suscripción nace en modo simulación de facturación).
   */
  async prepareContracting(id: number, input: { expectedRevision: number; trialDays?: number; reason?: string | null }, actor: string) {
    const t = await this.must(id);
    if (t.status !== "draft" && t.status !== "pending_acceptance") state("Este paquete ya no es un borrador");
    if (t.subscriptionId !== null) {
      // Reintento: la suscripción del paquete ya se creó en un intento anterior y falta aplicarle el acuerdo
      const made = (await this.d.store.events({ termsId: id })).some((e) => e.kind === "subscription_created" && (e.after as { subscriptionId?: number } | null)?.subscriptionId === t.subscriptionId);
      if (!made) state("Estas condiciones ya pertenecen a una suscripción");
      if (t.revision !== input.expectedRevision) throw new TermsError("version_conflict", `Otra persona modificó este paquete antes (revisión actual ${t.revision}). Recarga para no perder cambios.`, { current: t.revision });
      const existing = (await this.d.subscriptionStore.get(t.subscriptionId))!;
      return this.activate(t.id, { expectedRevision: t.revision, expectedVersion: existing.version, reason: input.reason }, actor, { at: existing.currentPeriodStart });
    }
    if (t.revision !== input.expectedRevision) throw new TermsError("version_conflict", `Otra persona modificó este paquete antes (revisión actual ${t.revision}). Recarga para no perder cambios.`, { current: t.revision });
    if (t.requiresAcceptance && t.acceptanceStatus !== "accepted") state("Este paquete exige la aceptación del cliente: envíalo a aceptación; la contratación se prepara al aceptarse", { reason: "acceptance_required" });
    await this.checkPackage(t);
    const plan = t.lines.find(isPlanLine);
    const reason = text(input.reason, 500) ?? t.reason;
    if (!plan && (input.trialDays ?? 0) > 0) bad("Un paquete sin plan Core no tiene periodo de prueba: no hay plataforma que probar");
    const sub = await this.conflict(
      plan
        ? this.d.subscriptions.create({ companyId: t.companyId, interval: t.interval, currency: t.currency, trialDays: input.trialDays ?? 0, plan: { productKey: plan.productKey!, priceId: plan.priceId! }, reason, newSale: true }, actor)
        : this.d.subscriptions.createWithoutPlan({ companyId: t.companyId, interval: t.interval, currency: t.currency, serviceStartAt: this.serviceStart(t) ?? undefined, reason }, actor),
    );
    const linked = await this.d.store.patch(t.id, { subscriptionId: sub.id }, this.event("subscription_created", actor, text(input.reason, 500) ?? t.reason, { after: { subscriptionId: sub.id, reference: sub.reference } }), this.now());
    // Desde el primer instante de la suscripción: la partida del alta queda sin ventana y nunca se factura
    return this.activate(t.id, { expectedRevision: linked.revision, expectedVersion: sub.version, reason: input.reason }, actor, { at: sub.currentPeriodStart });
  }

  // ── Lectura ────────────────────────────────────────────────────────────────────

  async detail(id: number) {
    const t = await this.must(id);
    return { terms: { ...t, effectiveStatus: effectiveStatus(t, this.now()) }, events: await this.d.store.events({ termsId: id }) };
  }

  /** Acuerdos e historial completo de una suscripción (todas las modificaciones y sus responsables). */
  async ofSubscription(subscriptionId: number) {
    if (!(await this.d.subscriptionStore.get(subscriptionId))) throw new TermsError("not_found", "Suscripción no encontrada");
    const now = this.now();
    const [terms, events, current] = await Promise.all([this.d.store.list({ subscriptionId }), this.d.store.events({ subscriptionId }), this.currentTerms(subscriptionId)]);
    // Cuota recurrente que rige HOY según el acuerdo vigente (la congelada en `summary` es la del día en que entró en vigor)
    const today = current ? recurringAt(current, now) : null;
    return { current: current ? current.id : null, currentRecurring: today ? { netCents: today.netCents, taxCents: today.taxCents, totalCents: today.totalCents, officialCents: today.officialCents } : null, terms: terms.map((t) => ({ ...t, effectiveStatus: effectiveStatus(t, now) })), events, timeZone: "Europe/Madrid" as const };
  }

  async ofCompany(companyId: number) {
    const now = this.now();
    const all = await this.d.store.list({ companyId });
    const out = [];
    for (const t of all) {
      // Paquete cuya contratación se cortó tras crear la suscripción: sigue siendo un borrador y se puede reintentar
      const interruptedPackage = (t.status === "draft" || t.status === "pending_acceptance") && t.subscriptionId !== null && (await this.d.store.events({ termsId: t.id })).some((e) => e.kind === "subscription_created");
      out.push({ ...t, effectiveStatus: effectiveStatus(t, now), interruptedPackage });
    }
    return { terms: out };
  }
}

/** Cuota recurrente de un plan Core del catálogo. */
const isPlanLine = (l: Pick<TermsLine, "kind" | "chargeClass" | "catalog">) => l.kind === "catalog" && l.chargeClass === "recurring" && l.catalog?.family === "core_plan";
const notStarted = (at: number) => `La suscripción todavía no ha empezado (empieza el ${madridDateTime(at)}): el cambio debe entrar en vigor en esa fecha o después`;
