/**
 * Adaptador REAL de `NegotiatedBillingGateway` sobre la integración de Stripe que ya existe (`server/stripe/gateway.ts`):
 * la misma clave restringida, la misma versión de API, el mismo prefijo de entorno en las claves de idempotencia
 * (`es-<ns>-…`) y en `metadata.es_env`, y la misma comprobación de `livemode` en cada objeto. No hay otra cuenta, otra
 * clave ni otro webhook.
 *
 *  - Las partidas negociadas viajan como precio EN LÍNEA de ESA suscripción (`price_data`): un producto de catálogo
 *    sobre su Product de Stripe ya enlazado (`stripe_prices`); una partida a medida, sobre UN Product genérico. Nunca
 *    se crea ni se modifica un Price público ni un Product del catálogo (este adaptador no tiene operación para ello).
 *  - Impuestos como el resto del cobro live (`stripe_tax_exclusive`): importes sin IVA (`tax_behavior=exclusive`) y el
 *    impuesto lo calcula Stripe Tax (`automatic_tax` de la suscripción). No se envían tipos fijos. Por eso `current()`
 *    devuelve `taxRateBp = null` en cada partida («el tipo lo decide Stripe») y la comparación de partidas no lo
 *    compara; a cambio informa del modo de impuesto de la suscripción y del esperado, y el impuesto REAL de cada
 *    factura se contrasta con el tipo pactado al registrarla (`stripeBilling.ts`).
 *  - Sin efectos retroactivos: `proration_behavior=none`. El cambio rige desde la próxima factura.
 *  - Segundo cerrojo: antes de CUALQUIER lectura o escritura se relee la suscripción y se exige que esté marcada como
 *    negociada (`es_negotiated`), que sea de este entorno, que no sea de un pedido ni de un servicio externo y que un
 *    operador la haya puesto a cobrar (`allowed`). Una suscripción ordinaria de un cliente nunca pasa de ahí.
 */
import crypto from "node:crypto";
import type { StripeMode, StripeTaxPolicy } from "../stripe/config";
import type { GwNegotiatedSubscription, StripeGateway } from "../stripe/gateway";
import type { NegotiatedBillingGateway, NegotiatedItem, NegotiatedOneOff, RemoteState } from "./billing";

/** Metadato que marca una suscripción de Stripe creada para unas condiciones personalizadas. */
export const NEGOTIATED_MARK = "es_negotiated";
/** Product genérico de las partidas a medida (id estable). En live lo crea el propietario; aquí nunca. */
export const CUSTOM_SERVICE_PRODUCT_ID = "es_terms_custom_service";
export const CUSTOM_SERVICE_PRODUCT_NAME = "Servicio a medida";

export class NegotiatedGatewayError extends Error {
  constructor(
    public readonly code: "not_negotiated" | "not_found" | "product_not_linked" | "custom_product_missing" | "invalid_items" | "interval_change" | "unsupported",
    message: string,
  ) {
    super(message);
    this.name = "NegotiatedGatewayError";
  }
}

export interface NegotiatedGatewayDeps {
  gateway: Pick<StripeGateway, "product"> & Partial<Pick<StripeGateway, "negotiatedSubscription" | "replaceNegotiatedItems" | "tagSubscriptionItem" | "setPauseCollection" | "createInvoiceItem" | "invoiceItemsOfCustomer" | "ensureServiceProduct" | "setCancelAtPeriodEnd" | "setCancelAt" | "invoice">>;
  namespace: string;
  mode: StripeMode;
  /** Política fiscal del entorno: decide el modo de impuesto que se espera en la suscripción. */
  taxPolicy: StripeTaxPolicy | null;
  /** Products de Stripe del catálogo enlazado: clave del producto → id del Product. Solo lectura. */
  catalogProducts: () => Promise<Map<string, string>>;
  /** Id del Product genérico de partidas a medida (por defecto, `CUSTOM_SERVICE_PRODUCT_ID`). */
  customProductId?: string;
  /** ¿Puso un operador esta suscripción de Stripe a cobrar condiciones personalizadas? (segundo cerrojo). */
  allowed: (stripeSubscriptionId: string) => Promise<boolean>;
}

const hash = (v: unknown) => crypto.createHash("sha256").update(JSON.stringify(v)).digest("hex").slice(0, 12);
/** Las claves de idempotencia de Stripe admiten 255 caracteres: se acota y se deja solo lo imprimible. */
const idem = (ns: string, key: string) => `es-${ns}-${key.replace(/[^A-Za-z0-9:_.-]/g, "_")}`.slice(0, 250);

/**
 * Product de Stripe de cada producto del catálogo, a partir de los precios YA enlazados (`stripe_prices`): su
 * `lookup_key` es `es:<producto>:<tipo>:<moneda>:v<precio>`. Solo lectura; si un producto tuviera dos Products
 * distintos (no debería), no se resuelve y la partida se rechaza en lugar de elegir uno.
 */
export function catalogProductsOf(links: Array<{ lookupKey: string; stripeProductId: string; status?: string }>): Map<string, string> {
  const out = new Map<string, string>();
  const clash = new Set<string>();
  for (const l of links) {
    if (l.status && l.status !== "active") continue;
    const key = /^es:([^:]+):/.exec(l.lookupKey)?.[1];
    if (!key) continue;
    if (out.has(key) && out.get(key) !== l.stripeProductId) clash.add(key);
    out.set(key, l.stripeProductId);
  }
  clash.forEach((k) => out.delete(k));
  return out;
}

/** Modo de impuesto que la política fiscal espera en la suscripción. */
export const expectedTaxMode = (policy: StripeTaxPolicy | null): "automatic" | "none" => (policy === "stripe_tax_exclusive" ? "automatic" : "none");

export class StripeNegotiatedGateway implements NegotiatedBillingGateway {
  private customProduct: string | null = null;
  constructor(private d: NegotiatedGatewayDeps) {}

  /** ¿Tiene el acceso a Stripe las operaciones que necesita el cobro negociado? */
  static supported(gw: Partial<StripeGateway>): boolean {
    return !!gw.negotiatedSubscription && !!gw.replaceNegotiatedItems && !!gw.tagSubscriptionItem && !!gw.createInvoiceItem && !!gw.invoiceItemsOfCustomer;
  }

  /** Relee la suscripción y aplica el segundo cerrojo. Nada se lee ni se escribe en una suscripción que no lo pase. */
  private async owned(id: string): Promise<GwNegotiatedSubscription> {
    if (!this.d.gateway.negotiatedSubscription) throw new NegotiatedGatewayError("unsupported", "El acceso a Stripe no admite condiciones personalizadas");
    // Primero el registro propio (sin llamar a Stripe): solo lo que un operador puso a cobrar
    if (!(await this.d.allowed(id))) throw new NegotiatedGatewayError("not_negotiated", "Esta suscripción de Stripe no se puso a cobrar con condiciones personalizadas: no se toca");
    const s = await this.d.gateway.negotiatedSubscription(id);
    if (!s) throw new NegotiatedGatewayError("not_found", "La suscripción no existe en Stripe");
    const m = s.metadata;
    if (m[NEGOTIATED_MARK] !== "1" || m.es_env !== this.d.namespace || m.es_order_id || m.es_external_id)
      throw new NegotiatedGatewayError("not_negotiated", "La suscripción de Stripe no es de condiciones personalizadas de este entorno: no se toca");
    return s;
  }

  /** Clave de cada partida de Stripe: su metadato o, si no lo lleva (recién creada por Checkout), su Product de catálogo. */
  private async keyed(s: GwNegotiatedSubscription) {
    const byProduct = new Map<string, string>();
    const products = await this.d.catalogProducts();
    products.forEach((productId, key) => byProduct.set(productId, byProduct.has(productId) ? "" : key));
    const count = new Map<string, number>();
    for (const i of s.items) count.set(i.productId, (count.get(i.productId) ?? 0) + 1);
    return s.items.map((i) => ({ item: i, key: i.metadata.es_line || (count.get(i.productId) === 1 ? byProduct.get(i.productId) || null : null) }));
  }

  async current(subscriptionId: string): Promise<RemoteState | null> {
    const s = await this.owned(subscriptionId);
    const fixed = s.items.some((i) => i.taxRateBp !== null);
    return {
      currency: s.currency,
      items: (await this.keyed(s)).map(({ item: i, key }) => ({
        key,
        amountCents: i.unitAmount * i.quantity,
        // Una periodicidad que no sea mensual o anual simple nunca coincide con lo pactado
        interval: (i.intervalCount === 1 || i.intervalCount === null) && (i.interval === "month" || i.interval === "year") ? i.interval : ("other" as never),
        // Con Stripe Tax no hay tipo fijo por partida: lo decide Stripe en cada factura
        taxRateBp: s.automaticTax ? null : i.taxRateBp,
      })),
      status: s.status,
      cancelAtPeriodEnd: s.cancelAtPeriodEnd || s.cancelAt !== null,
      // Fecha exacta del fin (con `cancel_at_period_end`, Stripe la fija en el fin del periodo)
      cancelAt: s.cancelAt !== null ? s.cancelAt * 1000 : s.cancelAtPeriodEnd && s.currentPeriodEnd !== null ? s.currentPeriodEnd * 1000 : null,
      currentPeriodEnd: s.currentPeriodEnd !== null ? s.currentPeriodEnd * 1000 : null,
      trialEnd: s.trialEnd ? s.trialEnd * 1000 : null,
      anomalies: s.anomalies ?? [],
      ...(s.paused !== undefined && this.d.gateway.setPauseCollection ? { paused: s.paused, pauseResumesAt: s.pauseResumesAt ? s.pauseResumesAt * 1000 : null } : {}),
      tax: { mode: s.automaticTax ? "automatic" : fixed ? "fixed" : "none", expected: expectedTaxMode(this.d.taxPolicy) },
    };
  }

  async customServiceProduct(): Promise<string> {
    if (this.customProduct) return this.customProduct;
    const id = this.d.customProductId ?? CUSTOM_SERVICE_PRODUCT_ID;
    const p = await this.d.gateway.product(id);
    if (p && p.active) return (this.customProduct = p.id);
    // En pruebas se crea solo (sandbox); en live lo crea el propietario: aquí nunca se escribe el catálogo real
    if (!p && this.d.mode === "test" && this.d.gateway.ensureServiceProduct)
      return (this.customProduct = await this.d.gateway.ensureServiceProduct({ id, name: CUSTOM_SERVICE_PRODUCT_NAME, metadata: { es_env: this.d.namespace, es_kind: "terms_custom_service" } }));
    throw new NegotiatedGatewayError("custom_product_missing", `Falta en Stripe el Product genérico de las partidas a medida («${id}»${p ? ", está archivado" : ""}): debe crearlo el propietario antes de cobrar una partida a medida`);
  }

  /** Product de Stripe de cada partida pactada. No crea nada en el catálogo. */
  async productsFor(items: NegotiatedItem[]): Promise<Map<string, string>> {
    const catalog = await this.d.catalogProducts();
    const out = new Map<string, string>();
    for (const i of items) {
      if (i.product.kind === "custom") out.set(i.key, await this.customServiceProduct());
      else {
        const id = catalog.get(i.product.productKey);
        if (!id) throw new NegotiatedGatewayError("product_not_linked", `El producto «${i.product.productKey}» no tiene Product enlazado en Stripe (catálogo sin sincronizar para ese producto)`);
        out.set(i.key, id);
      }
    }
    return out;
  }

  /** Comprobaciones de forma de las partidas pactadas antes de enviarlas (también las usa el alta por Checkout). */
  static check(items: NegotiatedItem[]) {
    if (!items.length) throw new NegotiatedGatewayError("invalid_items", "No hay partidas recurrentes que cobrar");
    if (new Set(items.map((i) => i.key)).size !== items.length) throw new NegotiatedGatewayError("invalid_items", "Hay partidas con la misma clave");
    if (items.some((i) => !Number.isInteger(i.amountCents) || i.amountCents < 0)) throw new NegotiatedGatewayError("invalid_items", "Hay partidas recurrentes con un importe no válido");
    if (new Set(items.map((i) => i.interval)).size !== 1) throw new NegotiatedGatewayError("invalid_items", "Las partidas no comparten periodicidad: Stripe no las admite en una misma suscripción");
    // Una suscripción de 0 no requiere pago: al pasar después a ser de pago Stripe reinicia el ciclo y cobra en el momento
    if (items.reduce((a, i) => a + i.amountCents, 0) <= 0) throw new NegotiatedGatewayError("invalid_items", "La cuota recurrente total es 0: una suscripción gratuita no se pone ni se deja en cobro en Stripe");
  }

  async applyItems(input: { subscriptionId: string; currency: string; items: NegotiatedItem[]; metadata: Record<string, string> }, idempotencyKey: string) {
    if (!this.d.gateway.replaceNegotiatedItems) throw new NegotiatedGatewayError("unsupported", "El acceso a Stripe no admite condiciones personalizadas");
    StripeNegotiatedGateway.check(input.items);
    const s = await this.owned(input.subscriptionId);
    if (s.currency && s.currency !== input.currency.toUpperCase()) throw new NegotiatedGatewayError("invalid_items", `La moneda pactada (${input.currency}) no es la de la suscripción de Stripe (${s.currency})`);
    // Cambiar la periodicidad reinicia el ciclo de cobro en Stripe (cargo inmediato): no se hace desde aquí
    const interval = input.items[0].interval;
    if (s.items.some((i) => i.interval !== interval || (i.intervalCount ?? 1) !== 1)) throw new NegotiatedGatewayError("interval_change", "Cambio de periodicidad: todavía no se aplica en Stripe de forma automática (reiniciaría el ciclo de cobro)");
    const products = await this.productsFor(input.items);
    // Se conserva lo que ya coincide (misma clave, importe, Product y sin tipos fijos sobrantes) y se sustituye el resto
    // Además de Product, importe, periodicidad y cantidad: sin tipos fijos y con el importe sin impuestos (lo único que
    // crea Elephant); una partida tocada a mano en Stripe con otro tratamiento fiscal no cuenta como la pactada
    const same = (item: GwNegotiatedSubscription["items"][number], want: NegotiatedItem) => item.taxRateBp === null && (item.taxBehavior ?? "exclusive") === "exclusive" && item.quantity === 1 && item.unitAmount === want.amountCents && item.interval === want.interval && item.productId === products.get(want.key);
    const keep = new Set<string>();
    const remove: string[] = [];
    const untagged: GwNegotiatedSubscription["items"] = [];
    for (const item of s.items) {
      const key = item.metadata.es_line;
      const want = key ? input.items.find((i) => i.key === key) : undefined;
      if (want && !keep.has(key) && same(item, want)) keep.add(key);
      // Sin clave, o con una clave que ya no se pacta (un acuerdo nuevo da claves nuevas a sus partidas a medida)
      else untagged.push(item);
    }
    // Partidas sin clave vigente (las que crea Checkout, o las de un acuerdo anterior): si una es EXACTAMENTE una de las
    // pactadas (Product, importe, periodicidad y cantidad) solo se le pone su clave, con un cambio de metadatos. Lo que el
    // cliente ya está pagando nunca se sustituye por algo idéntico
    for (const item of untagged) {
      const want = this.d.gateway.tagSubscriptionItem ? input.items.find((i) => !keep.has(i.key) && same(item, i)) : undefined;
      if (!want) {
        remove.push(item.id);
        continue;
      }
      await this.d.gateway.tagSubscriptionItem!(item.id, { es_line: want.key, es_env: this.d.namespace }, idem(this.d.namespace, `tag:${item.id}:${hash([item.metadata.es_line ?? "", want.key, Date.now()])}`));
      keep.add(want.key);
    }
    const add = input.items.filter((i) => !keep.has(i.key)).map((i) => ({ productId: products.get(i.key)!, unitAmount: i.amountCents, currency: input.currency, interval: i.interval, metadata: { es_line: i.key, es_env: this.d.namespace } }));
    if (!remove.length && !add.length) return { ref: s.id };
    // La clave incluye lo que se retira: un reintento sobre el mismo estado repite la clave; sobre otro, es otra petición
    const out = await this.d.gateway.replaceNegotiatedItems({ subscriptionId: s.id, remove: remove.sort(), add, metadata: { ...input.metadata, es_env: this.d.namespace, [NEGOTIATED_MARK]: "1" } }, idem(this.d.namespace, `${idempotencyKey}:${hash(remove.slice().sort())}`));
    return { ref: out.id };
  }

  async addOneOff(input: { subscriptionId: string; customerId: string; currency: string; item: NegotiatedOneOff; metadata: Record<string, string> }, idempotencyKey: string) {
    if (!this.d.gateway.createInvoiceItem) throw new NegotiatedGatewayError("unsupported", "El acceso a Stripe no admite condiciones personalizadas");
    if (!Number.isInteger(input.item.amountCents) || input.item.amountCents === 0) throw new NegotiatedGatewayError("invalid_items", "Importe único no válido");
    const s = await this.owned(input.subscriptionId);
    if (s.customerId !== input.customerId) throw new NegotiatedGatewayError("not_negotiated", "El cliente de Stripe no es el de la suscripción: no se añade el importe");
    const out = await this.d.gateway.createInvoiceItem(
      { customerId: s.customerId, subscriptionId: s.id, amount: input.item.amountCents, currency: input.currency, description: input.item.name, metadata: { ...(input.metadata.es_subscription ? { es_subscription: input.metadata.es_subscription } : {}), es_key: input.item.key, es_stripe_subscription: s.id, es_env: this.d.namespace, [NEGOTIATED_MARK]: "1" } },
      idem(this.d.namespace, idempotencyKey),
    );
    return { ref: out.id };
  }

  async findOneOff(subscriptionId: string, key: string) {
    if (!this.d.gateway.invoiceItemsOfCustomer) throw new NegotiatedGatewayError("unsupported", "El acceso a Stripe no admite condiciones personalizadas");
    const s = await this.owned(subscriptionId);
    const hits = (await this.d.gateway.invoiceItemsOfCustomer(s.customerId)).filter((i) => i.metadata.es_key === key && i.metadata.es_env === this.d.namespace && (i.metadata.es_stripe_subscription === s.id || (!!s.metadata.es_terms_subscription && i.metadata.es_subscription === s.metadata.es_terms_subscription)));
    if (!hits.length) return null;
    // Un importe que acabó en una factura ANULADA (p. ej. la renovación de un cobro en pausa) no se cobró: no cuenta
    const status = new Map<string, string | null>();
    for (const id of Array.from(new Set(hits.map((i) => i.invoiceId).filter((x): x is string => !!x)))) status.set(id, this.d.gateway.invoice ? ((await this.d.gateway.invoice(id))?.status ?? null) : null);
    const alive = hits.filter((i) => !i.invoiceId || status.get(i.invoiceId) !== "void");
    if (!alive.length) return { ref: hits[0].id, amountCents: 0, voided: true };
    // Si hubiera más de uno (no debería), se devuelve la suma: la conciliación lo verá como un importe distinto
    return { ref: alive[0].id, amountCents: alive.reduce((a, i) => a + i.amount, 0) };
  }

  /**
   * Cobro en pausa (cuota pactada de 0, o hueco hasta el acuerdo siguiente) o su vuelta. Mientras dura, Stripe no
   * cobra nada (anula sus facturas). Con `resumesAt` (ms), Stripe lo reanuda solo en esa fecha.
   */
  async setPaused(subscriptionId: string, paused: boolean, idempotencyKey: string, resumesAt?: number | null) {
    if (!this.d.gateway.setPauseCollection) throw new NegotiatedGatewayError("unsupported", "El acceso a Stripe no admite poner el cobro en pausa");
    const s = await this.owned(subscriptionId);
    await this.d.gateway.setPauseCollection(s.id, paused, idem(this.d.namespace, idempotencyKey), paused && resumesAt ? Math.floor(resumesAt / 1000) : null);
  }

  /** Fin de la suscripción de Stripe en una fecha (ms) o deshacerlo (null). Sin prorrateo: no cobra ni abona nada. */
  async setCancelAt(subscriptionId: string, at: number | null, idempotencyKey: string) {
    if (!this.d.gateway.setCancelAt) throw new NegotiatedGatewayError("unsupported", "El acceso a Stripe no admite programar el fin en una fecha");
    const s = await this.owned(subscriptionId);
    await this.d.gateway.setCancelAt(s.id, at === null ? null : Math.floor(at / 1000), idem(this.d.namespace, idempotencyKey));
  }

  /** Fin al final del periodo ya pagado (o deshacerlo). No cobra ni abona nada. */
  async setCancelAtPeriodEnd(subscriptionId: string, cancel: boolean, idempotencyKey: string) {
    if (!this.d.gateway.setCancelAtPeriodEnd) throw new NegotiatedGatewayError("unsupported", "El acceso a Stripe no admite programar el fin de la suscripción");
    const s = await this.owned(subscriptionId);
    await this.d.gateway.setCancelAtPeriodEnd(s.id, cancel, idem(this.d.namespace, idempotencyKey));
  }
}
