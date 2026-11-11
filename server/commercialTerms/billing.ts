/**
 * Cobro en Stripe de una suscripción con condiciones comerciales personalizadas (fase 4). APAGADO por defecto.
 *
 * El importe negociado es la fuente económica efectiva. Lo que se envía a Stripe es lo que la suscripción tiene HOY
 * (sus partidas recurrentes vigentes, las mismas que factura la simulación, con su importe neto del periodo y su tipo
 * de impuesto, y los importes únicos ya vencidos) o, a menos de `LOOKAHEAD_MS` de la renovación de Stripe, lo que
 * regirá en ella: Stripe factura por adelantado en `current_period_end` con lo que tiene en ese instante (`target`).
 * Se planifica por SUSCRIPCIÓN, no por acuerdo: un acuerdo programado no cambia lo que se cobra hoy, y al vencer una
 * condición temporal se envía lo que rige después. Cuota 0 → cobro en pausa con su reanudación; condiciones que
 * terminan sin sucesor → fin en Stripe en su fecha.
 *  - No se tocan los Products ni los Prices oficiales de Stripe que usan otros clientes, ni se crean productos públicos
 *    por cada negociación: las partidas viajan como precio en línea de ESA suscripción (`NegotiatedBillingGateway`).
 *  - Las partidas recurrentes se comparan siempre con lo que Stripe tiene: si coinciden no se envía nada; si no (cambio
 *    de condiciones, fin de un tramo, deriva), se sustituyen. Nunca se envía una lista vacía.
 *  - Cada importe único se envía una sola vez: antes de enviarlo se busca en Stripe por su clave (un reintento días
 *    después, cuando la clave de idempotencia de Stripe ya caducó, no lo duplica).
 *  - Fallos parciales: se guarda qué se completó; el reintento continúa por donde se quedó. Errores y reintentos
 *    quedan en el acuerdo vigente (`sync_status`, `sync_detail`) y en su historial (eventos `sync`).
 *
 * Tres cerrojos, todos necesarios para que salga una sola llamada: el interruptor (`enabled`), una pasarela validada
 * (hoy solo el doble de pruebas: el adaptador real se escribe y valida en Stripe Sandbox) y que la suscripción esté
 * enlazada a una suscripción de Stripe. Sin los tres, la suscripción sigue en simulación de facturación.
 */
import express, { type Request, type Response, type Router } from "express";
import { z } from "zod";
import { getAuth, requireScope } from "../controlPlane/auth";
import { opsLog } from "../_core/ops/log";
import { recordFailure } from "../_core/ops/failureAlerts";
import { addMonthsUTC, isRecurring as recurringPrice, madridAnchor, stableHash } from "../subscriptions/pricing";
import type { SubscriptionStore } from "../subscriptions/store";
import type { SubscriptionItem } from "../subscriptions/types";
import { requireCustomPricing } from "./permission";
import { TermsError } from "./service";
import { TermsConflict, type TermsRecord, type TermsStore } from "./store";

/** Partida recurrente pactada tal como se cobra: un precio en línea de la suscripción, sin Price público. */
export interface NegotiatedItem {
  /** Clave estable de la partida (la del producto o la referencia de la partida a medida). */
  key: string;
  name: string;
  /** Producto de catálogo (se usa su Product de Stripe ya existente) o servicio a medida (Product genérico). */
  product: { kind: "catalog"; productKey: string } | { kind: "custom" };
  /** Importe NETO por periodo, en céntimos. */
  amountCents: number;
  interval: "month" | "year";
  taxRateBp: number;
}
/** Cargo o abono único (con signo) para la próxima factura de la suscripción. */
export interface NegotiatedOneOff {
  /** Clave estable (`charge:<partida>` o `credit:<partida>`): viaja a Stripe como metadato para poder buscarlo. */
  key: string;
  name: string;
  amountCents: number;
  taxRateBp: number;
}

/** Lo ÚNICO que el cobro de condiciones personalizadas necesita de Stripe. No hay forma de crear ni cambiar Prices. */
export interface NegotiatedBillingGateway {
  /** Sustituye las partidas recurrentes por las pactadas, sin prorrateo retroactivo. Idempotente por clave. */
  applyItems(input: { subscriptionId: string; currency: string; items: NegotiatedItem[]; metadata: Record<string, string> }, idempotencyKey: string): Promise<{ ref: string }>;
  /** Añade un importe único a la próxima factura. Idempotente por clave. */
  addOneOff(input: { subscriptionId: string; customerId: string; currency: string; item: NegotiatedOneOff; metadata: Record<string, string> }, idempotencyKey: string): Promise<{ ref: string }>;
  /**
   * Busca un importe único ya enviado por su clave (metadato). Null si Stripe no lo tiene. `voided`: Stripe lo tiene,
   * pero solo en facturas ANULADAS por el cobro en pausa (la renovación de un periodo gratuito): no se cobró y se
   * vuelve a enviar. `forgiven`: está en una factura anulada por otro motivo (un operador la perdonó): no se repite.
   */
  findOneOff(subscriptionId: string, key: string): Promise<{ ref: string; amountCents: number; voided?: boolean; forgiven?: boolean; voidedInvoiceId?: string } | null>;
  /** Lo que la suscripción tiene ahora en Stripe (para comparar antes de enviar y para conciliar). */
  current(subscriptionId: string): Promise<RemoteState | null>;
  /** Programa (o deshace) el fin de la suscripción de Stripe al final del periodo ya pagado. Opcional. */
  setCancelAtPeriodEnd?(subscriptionId: string, cancel: boolean, idempotencyKey: string): Promise<void>;
  /**
   * Pone (o quita) el cobro en pausa: mientras dura, Stripe no cobra nada (sus facturas se anulan). Con `resumesAt`
   * (ms), Stripe lo reanuda solo en esa fecha. Opcional.
   */
  setPaused?(subscriptionId: string, paused: boolean, idempotencyKey: string, resumesAt?: number | null): Promise<void>;
  /** Programa (ms) o deshace (null) el fin de la suscripción de Stripe en una fecha concreta, sin prorrateo. Opcional. */
  setCancelAt?(subscriptionId: string, at: number | null, idempotencyKey: string): Promise<void>;
}

/** Estado de la suscripción en Stripe tal como lo ve el cobro de condiciones personalizadas. */
export interface RemoteState {
  currency: string | null;
  /**
   * `taxRateBp` es el tipo FIJO que lleva la partida en Stripe. `null` = Stripe no tiene un tipo fijo para ella: con
   * la política fiscal live (`stripe_tax_exclusive`) el impuesto lo calcula Stripe Tax en cada factura según el
   * cliente, así que no hay nada que comparar por partida (se compara el modo de impuesto, `tax`, y el impuesto real
   * de cada factura al registrarla).
   */
  items: Array<{ key: string | null; amountCents: number; interval: "month" | "year"; taxRateBp: number | null }>;
  /** Estado de la suscripción en Stripe (active, past_due, canceled…), si la pasarela lo informa. */
  status?: string;
  /** ¿Tiene programado su fin en Stripe? */
  cancelAtPeriodEnd?: boolean;
  /** Fecha exacta (ms) en la que termina en Stripe, si la tiene programada. */
  cancelAt?: number | null;
  /** Fin del periodo en curso en Stripe (ms): su próxima renovación, que es cuando Stripe factura. */
  currentPeriodEnd?: number | null;
  /** Fecha (ms) en la que Stripe reanuda solo el cobro en pausa, si la tiene. */
  pauseResumesAt?: number | null;
  /** Ancla del ciclo en Stripe (ms): con ella se sabe cuándo termina el periodo SIGUIENTE. */
  billingCycleAnchor?: number | null;
  /** Cómo calcula Stripe el impuesto de la suscripción y cómo debería según la política fiscal del entorno. */
  tax?: { mode: "automatic" | "fixed" | "none"; expected: "automatic" | "fixed" | "none" };
  /** ¿Está el cobro en pausa en Stripe? (solo debe estarlo cuando lo pactado es una cuota total de 0). */
  paused?: boolean;
  /** Fin del periodo sin cargo en Stripe (ms), si lo tiene. */
  trialEnd?: number | null;
  /** Cosas hechas fuera de Elephant que cambian lo que se cobra (cupón, cobro en pausa, cobro no automático). */
  anomalies?: string[];
}

export interface BillingLink {
  customerId: string;
  subscriptionId: string;
  /** Fin del periodo en curso en Stripe (ms) según el último evento: su próxima renovación. */
  periodEnd?: number | null;
}

/**
 * Lo que Stripe tiene que tener ANTES de su próxima renovación. Stripe factura por adelantado en `current_period_end`
 * con lo que la suscripción tiene en ese instante: un cambio que rige en la renovación tiene que estar en Stripe antes,
 * no después. Por eso, cuando la renovación está cerca (`LOOKAHEAD_MS`), se prepara lo que regirá en ella.
 */
export interface BillingTarget {
  /** Instante para el que se prepara Stripe: la próxima renovación si está dentro del margen; si no, hoy. */
  at: number;
  /** Acuerdo donde se registra la sincronización: el vigente hoy o, si no hay, el que regirá. null: nada que cobrar. */
  termsId: number | null;
  currency: string;
  /**
   * Partidas que debe tener Stripe. Con el cobro en pausa son las del primer periodo de pago posterior (mientras dura
   * la pausa no se cobran, y así Stripe las tiene ya al reanudarlo). null: no se tocan.
   */
  items: NegotiatedItem[] | null;
  /** ¿Debe estar el cobro en pausa en `at`? (cuota total de 0, o hueco hasta un acuerdo posterior ya conocido). */
  paused: boolean;
  /** Fecha (ms) en la que Stripe debe reanudar solo el cobro: poco antes del primer instante de pago. null: sin fecha. */
  resumesAt: number | null;
  /** Fin (ms) de las condiciones sin otras detrás: la suscripción de Stripe termina ese día. null: no terminan. */
  endAt: number | null;
  /** Importes únicos: `due` = vencidos en `at` (los de la renovación se envían antes de ella). */
  oneOffs: BillingPlan["oneOffs"];
  /** Periodicidad de las cuotas (la de la suscripción de Stripe). */
  interval: "month" | "year";
  /** Lo que rige hoy. */
  today: BillingPlan;
}

export interface BillingPlan {
  subscriptionId: number;
  /** Acuerdo vigente hoy (donde se registra la sincronización); null si la suscripción no tiene condiciones personalizadas vivas. */
  termsId: number | null;
  currency: string;
  items: NegotiatedItem[];
  /** Importes únicos ya vencidos (se envían) y los que aún no han llegado (se enviarán en su fecha). */
  oneOffs: Array<NegotiatedOneOff & { at: number; due: boolean }>;
  recurringNetCents: number;
}

interface SyncDetail {
  /** Suscripción de Stripe a la que se refiere este estado (si cambia el enlace, se empieza de cero). */
  stripeSubscriptionId: string;
  /** Huella de las últimas partidas recurrentes aplicadas y número de veces que se han sustituido. */
  itemsHash: string | null;
  generation: number;
  /** Importes únicos ya enviados: clave → referencia de Stripe. */
  oneOffs: Record<string, string>;
  attempts: number;
  lastError: string | null;
  lastAttemptAt: number | null;
  pendingOneOffs: string[];
  /** Envíos fallidos seguidos (0 tras uno correcto): espacia los reintentos automáticos. */
  failures?: number;
  /**
   * Fin que programó la PROPIA sincronización porque las condiciones terminan sin sucesor: la fecha (ms) y cómo se
   * programó. Solo este fin se deshace solo, y solo si llega un acuerdo posterior antes de esa fecha.
   */
  endedBySync?: { at: number; via: "cancel_at" | "period_end"; /** Fin del periodo de Stripe en el que termina (ms). */ periodEnd?: number | null } | null;
  /** Desde cuándo (ms) la sincronización ha puesto alguna vez el cobro en pausa en esta suscripción de Stripe. */
  pausedSince?: number | null;
  /** Importes únicos enviados que NO se cobraron (anulados o retirados de una suscripción terminada): no cuentan. */
  revoked?: string[];
  /** Cuándo empezó a cobrarse esta suscripción de Stripe (su ancla, ms) y desde cuándo cuenta el contrato (`owedPeriods`). */
  billingFrom?: number | null;
  contractFrom?: number | null;
  /** Facturas de Stripe de esta suscripción que abrieron un periodo de cuota (alta con cuota y renovaciones): su número. */
  periods?: string[];
  /**
   * Lo facturado en suscripciones de Stripe ANTERIORES de la misma contratación (un reinicio tras un fin solo en Stripe):
   * sus periodos de cuota y cuándo empezó a cobrarse la primera. Se arrastra de un estado a otro: nunca se pierde.
   */
  prior?: { periods: string[]; billingFrom: number | null; contractFrom: number | null };
}

/** Espera antes de volver a intentar solo un envío que falla: 15 min, 1 h, 4 h, 16 h y, desde ahí, una vez al día. */
export const syncRetryDelayMs = (failures: number) => Math.min(15 * 60_000 * 4 ** Math.max(0, failures - 1), 24 * 3600_000);
/** Un importe único con más de este tiempo puede haber salido ya de la ventana de importes que se leen de Stripe. */
const ONE_OFF_WINDOW_MS = 60 * 86_400_000;
/**
 * Antelación con la que se prepara en Stripe lo que regirá en su próxima renovación (partidas, pausa e importes únicos
 * de esa fecha). Tres días: con la conciliación cada 15 minutos y reintentos de hasta un día, hay varios intentos antes
 * de la renovación. Es menor que cualquier periodo (mensual o anual), así que nunca se adelanta más de una renovación.
 */
export const LOOKAHEAD_MS = 3 * 86_400_000;
/**
 * La pausa se reanuda este margen ANTES del primer instante de pago: la factura de esa renovación ya se cobra aunque
 * Stripe procese `resumes_at` con retraso. Entre la reanudación y la renovación no se genera ninguna factura.
 */
export const RESUME_MARGIN_MS = 6 * 3600_000;
/**
 * Holgura al contar periodos completos del contrato: la hora del día y el cambio de hora entre las fechas del acuerdo
 * (medianoche de Madrid) y las de Stripe (UTC). Es menor que un día: nunca convierte un tramo corto en un periodo entero.
 */
export const PERIOD_SLACK_MS = 12 * 3600_000;

/**
 * Periodos COMPLETOS del contrato desde `from` hasta `to` (meses de calendario de Madrid desde `from`, o años), con la
 * holgura indicada. Cálculo cerrado: una estimación por meses y un ajuste de una o dos posiciones (sin bucles largos).
 */
export function wholePeriods(from: number, to: number, interval: "month" | "year", slack = 0): number {
  if (to + slack < from) return 0;
  const months = interval === "year" ? 12 : 1;
  const anchor = madridAnchor(from);
  const step = (k: number) => addMonthsUTC(from, k * months, anchor);
  const a = new Date(from);
  const z = new Date(to);
  let k = Math.max(0, Math.floor(((z.getUTCFullYear() - a.getUTCFullYear()) * 12 + z.getUTCMonth() - a.getUTCMonth()) / months) + 1);
  for (let n = 0; n < 4 && k > 0 && step(k) > to + slack; n++) k--;
  for (let n = 0; n < 4 && step(k + 1) <= to + slack; n++) k++;
  return k;
}

/**
 * Cuántos cobros DEBE la suscripción de Stripe enlazada hasta el fin de las condiciones (`endAt`), contados por número y
 * no por la fecha de cada renovación:
 *  - el contrato se cuenta desde el inicio de las cuotas del acuerdo que regía cuando empezó a cobrarse ESTA suscripción
 *    de Stripe (`contractFrom`; nunca una fecha intermedia en la que una partida se partió por un cambio de importe);
 *  - se descuentan los periodos completos del contrato que ya habían pasado cuando empezó a cobrarse (`billingFrom`, el
 *    ancla de Stripe): esos no se cobraron y no se recuperan;
 *  - un acuerdo que sustituye a otro a mitad de vigencia NO reinicia la cuenta: sigue contando desde `contractFrom` y solo
 *    cambia el fin (`endAt`, el del acuerdo nuevo);
 *  - un tramo final que no llega a un periodo entero no se cobra.
 * Así un contrato de N meses pagado con cualquier retraso dentro del primer periodo son N cobros: prevalece el número de
 * periodos del contrato (el último periodo de Stripe acaba ese mismo retraso después del fin).
 */
export function owedPeriods(contractFrom: number, billingFrom: number, endAt: number, interval: "month" | "year"): number {
  const from = Math.min(contractFrom, billingFrom);
  return Math.max(0, wholePeriods(from, endAt, interval, PERIOD_SLACK_MS) - wholePeriods(from, billingFrom, interval));
}

/**
 * ¿Debe Stripe NO renovar en su próxima renovación (`renewal`, su `current_period_end`)? Sí si ya se han facturado los
 * periodos que se deben (`invoiced >= owed`) o si el periodo que empezaría lo haría en el fin o después (nunca se cobra
 * un periodo que empieza cuando el contrato ya terminó). Sin la cuenta (`owed` null: no se sabe cuándo empezó a
 * cobrarse), se para si el periodo siguiente pasaría del fin.
 */
export function stopsAtRenewal(endAt: number | null, renewal: number | null | undefined, invoiced: number, owed: number | null, interval: "month" | "year", anchor?: number | null): boolean {
  if (endAt === null || renewal == null) return false;
  if (renewal >= endAt) return true;
  if (owed !== null) return invoiced >= owed;
  const following = addMonthsUTC(renewal, interval === "year" ? 12 : 1, new Date(anchor ?? renewal).getUTCDate());
  return following > endAt + PERIOD_SLACK_MS;
}

/** Otra operación tiene el arrendamiento de la suscripción (un webhook, otra sincronización). */
export class SyncBusy extends Error {
  constructor() {
    super("La contratación se está procesando");
    this.name = "SyncBusy";
  }
}
/** Stripe guarda las fechas en segundos: se comparan ya redondeadas. */
const toSecond = (ms: number) => Math.floor(ms / 1000) * 1000;

export type SyncOutcome =
  | { status: "disabled" | "unsupported" | "not_linked" | "nothing_to_bill" | "cancel_scheduled" | "busy"; message: string }
  | { status: "synced"; applied: number; skipped: number; pendingOneOffs: string[] }
  | { status: "failed"; error: string; completed: number; remaining: number };

const live = (i: SubscriptionItem, at: number) => i.effectiveFrom <= at && (i.effectiveTo === null || i.effectiveTo > at);
const voided = (i: SubscriptionItem) => i.effectiveTo !== null && i.effectiveTo <= i.effectiveFrom;
const sameItems = (a: NegotiatedItem[], b: Array<{ key: string | null; amountCents: number; interval: string; taxRateBp: number | null }>) =>
  a.length === b.length && a.every((i) => b.some((r) => r.key === i.key && r.amountCents === i.amountCents && r.interval === i.interval && sameTax(r.taxRateBp, i.taxRateBp)));
/** El tipo solo se compara si Stripe tiene uno FIJO en la partida; con Stripe Tax (`null`) lo decide Stripe por factura. */
const sameTax = (stripe: number | null, agreed: number) => stripe === null || stripe === agreed;
/**
 * Importes únicos enviados de una contratación (unión de todos sus estados de sincronización) sin los que constan como
 * NO cobrados. Si una clave tiene varias referencias, manda la que no se ha retirado.
 */
const sentOf = (every: SyncDetail[]) => {
  const revoked = Array.from(new Set(every.flatMap((x) => x.revoked ?? [])));
  const sent: Record<string, string> = {};
  for (const x of every) for (const [key, ref] of Object.entries(x.oneOffs)) if (!revoked.includes(ref)) sent[key] = ref;
  return { sent, revoked };
};
/** El estado de sincronización más reciente primero (a igual hora, el de más intentos: cada envío suma uno). */
const newest = (a: SyncDetail, b: SyncDetail) => (b.lastAttemptAt ?? 0) - (a.lastAttemptAt ?? 0) || b.attempts - a.attempts;
/** Huella de lo que debe tener Stripe (partidas, pausa y fin): si cambia, hay que sincronizar. */
const targetHash = (t: Pick<BillingTarget, "items" | "paused" | "resumesAt" | "endAt">) => stableHash({ i: t.items, p: t.paused, r: t.resumesAt, e: t.endAt }).slice(0, 24);

export class TermsBillingService {
  private now: () => number;
  constructor(
    private d: {
      /** Interruptor: apagado por defecto. Encenderlo exige la autorización del propietario. */
      enabled: boolean;
      /** Pasarela validada. Hoy solo existe el doble de pruebas. */
      gateway?: NegotiatedBillingGateway | null;
      /** Suscripción de Stripe con la que se cobra ESA suscripción (null = simulación). */
      link?: (subscriptionId: number) => Promise<BillingLink | null>;
      /**
       * Instante desde el que se cobra una suscripción ya puesta a cobrar por adelantado (método de pago autorizado
       * antes del inicio del acuerdo; primer cargo en esa fecha). Hasta entonces, lo que se envía y se concilia es lo que
       * regirá ese día. null: se cobra desde ya.
       */
      billFrom?: (subscriptionId: number) => Promise<number | null>;
      /** Las condiciones han cambiado: si hay una sesión de pago abierta que ofrece otra cosa, se cierra. */
      invalidate?: (subscriptionId: number) => Promise<unknown>;
      /** ¿Pidió un operador de forma expresa el fin de la suscripción de Stripe? (entonces un fin solo en Stripe no es una diferencia). */
      cancelRequested?: (subscriptionId: number) => Promise<boolean>;
      /** Antes de planificar: resuelve lo que dependa de la fecha (fin de condiciones temporales), como la simulación. */
      settle?: (subscriptionId: number) => Promise<unknown>;
      /** Una sincronización a la vez por suscripción (el arrendamiento de los webhooks). Lanza `SyncBusy` si está ocupada. */
      serialize?: <T>(subscriptionId: number, fn: () => Promise<T>) => Promise<T>;
      termsStore: TermsStore;
      subscriptionStore: Pick<SubscriptionStore, "get" | "items">;
      now?: () => number;
    },
  ) {
    this.now = d.now ?? Date.now;
  }

  /** ¿Están abiertos los dos cerrojos que no dependen de la suscripción? */
  get open(): boolean {
    return this.d.enabled && !!this.d.gateway;
  }

  /** ¿Está encendido el interruptor? (no dice nada de la pasarela ni del enlace). */
  get enabled(): boolean {
    return this.d.enabled;
  }

  /**
   * Conecta la pasarela validada y el enlace con Stripe (el plano de control monta Stripe después de las condiciones).
   * No abre nada por sí solo: el interruptor sigue mandando y el enlace solo existe para lo que un operador puso a cobrar.
   */
  attach(x: { gateway: NegotiatedBillingGateway; link: (subscriptionId: number) => Promise<BillingLink | null>; billFrom?: (subscriptionId: number) => Promise<number | null>; invalidate?: (subscriptionId: number) => Promise<unknown>; cancelRequested?: (subscriptionId: number) => Promise<boolean>; serialize?: <T>(subscriptionId: number, fn: () => Promise<T>) => Promise<T> }) {
    if (x.serialize) this.d.serialize = x.serialize;
    this.d.gateway = x.gateway;
    this.d.link = x.link;
    this.d.billFrom = x.billFrom;
    this.d.invalidate = x.invalidate;
    this.d.cancelRequested = x.cancelRequested;
  }

  /**
   * ¿Ha cambiado lo que hay que cobrar desde la última vez que se dejó en Stripe? Ocurre sin que nadie toque nada
   * cuando llega una FECHA (termina una condición temporal, empieza un acuerdo programado, vence un cargo único), o
   * cuando el último envío falló. No dice nada de lo que alguien haya cambiado en Stripe a mano (eso solo se avisa).
   * Solo lectura; sin enlace o sin un envío anterior con el que comparar, false.
   */
  async changedSinceSync(subscriptionId: number): Promise<boolean> {
    if (!this.open || !this.d.link) return false;
    const link = await this.d.link(subscriptionId);
    if (!link) return false;
    const t = await this.target(subscriptionId, link.periodEnd ?? null);
    if (t.termsId === null) return false;
    const prev = await this.lastDetail(subscriptionId, link.subscriptionId);
    if (!prev || prev.itemsHash === null) return false;
    // Un envío que falla se reintenta solo, pero cada vez más espaciado (un fallo permanente no se repite cada pasada)
    if (prev.lastError) return this.now() - (prev.lastAttemptAt ?? 0) >= syncRetryDelayMs(prev.failures ?? 1);
    // Lo que debe tener Stripe (partidas, pausa y fin) cambió: por una fecha, o porque se acerca la renovación
    return prev.itemsHash !== targetHash(t) || (!t.paused && t.oneOffs.some((o) => o.due && !prev.oneOffs[o.key]));
  }

  /**
   * Lo que Stripe tiene que tener ANTES de su próxima renovación (`periodEnd`, ms). Stripe factura por adelantado en
   * `current_period_end` con lo que tiene en ese instante; si la renovación está dentro de `LOOKAHEAD_MS`, se prepara lo
   * que regirá en ella (partidas, pausa e importes únicos de esa fecha). Si no, lo de hoy (un cambio a mitad de periodo
   * no se cobra hasta la renovación siguiente: sin prorrateo). Además:
   *  - cuota 0 (o hueco hasta un acuerdo posterior) en ese instante → cobro en pausa, con la fecha de reanudación un
   *    minuto antes del primer instante de pago y las partidas de ese periodo ya puestas;
   *  - condiciones que terminan sin nada detrás → `endAt`, su fecha de fin (se programa en Stripe en cuanto se sabe).
   * Solo lectura; no llama a Stripe.
   */
  async target(subscriptionId: number, periodEnd: number | null, o: { settle?: boolean } = {}): Promise<BillingTarget> {
    const today = await this.plan(subscriptionId, { settle: o.settle });
    const from = this.d.billFrom ? await this.d.billFrom(subscriptionId) : null;
    const base = Math.max(this.now(), from ?? 0);
    const at = periodEnd !== null && periodEnd > base && periodEnd - base <= LOOKAHEAD_MS ? periodEnd : base;
    const ahead = at === base ? today : await this.plan(subscriptionId, { at });
    const sub = await this.d.subscriptionStore.get(subscriptionId);
    const all = sub && sub.status !== "canceled" ? (await this.d.subscriptionStore.items(subscriptionId)).filter((i) => !voided(i) && recurringPrice(i.priceKind)) : [];
    const withTerms = (p: BillingPlan) => p.termsId !== null && p.items.length > 0;
    const paid = (p: BillingPlan) => withTerms(p) && p.recurringNetCents > 0;
    // Primer instante posterior en el que vuelve a haber algo que cobrar (fin de una cuota 0, o inicio del acuerdo siguiente)
    let next: { plan: BillingPlan; at: number } | null = null;
    if (!paid(ahead)) {
      const marks = Array.from(new Set(all.flatMap((i) => [i.effectiveFrom, i.effectiveTo]).filter((x): x is number => x !== null && x > at))).sort((a, b) => a - b);
      for (const m of marks) {
        const p = await this.plan(subscriptionId, { at: m });
        if (paid(p)) {
          next = { plan: p, at: m };
          break;
        }
      }
    }
    // Fin de las condiciones sin nada detrás: todas sus partidas recurrentes (las de hoy y las ya programadas) terminan
    const terms = all.filter((i) => i.termsId != null && (i.effectiveTo === null || i.effectiveTo > base));
    const endAt = terms.length && terms.every((i) => i.effectiveTo !== null) ? toSecond(Math.max(...terms.map((i) => i.effectiveTo!))) : null;
    const paused = withTerms(ahead) ? ahead.recurringNetCents <= 0 : next !== null;
    const resumesAt = !paid(ahead) && next && next.at - RESUME_MARGIN_MS > this.now() ? toSecond(next.at - RESUME_MARGIN_MS) : null;
    return {
      at,
      termsId: today.termsId ?? ahead.termsId ?? next?.plan.termsId ?? null,
      currency: today.currency,
      items: paid(ahead) ? ahead.items : (next?.plan.items ?? null),
      paused,
      resumesAt,
      endAt,
      oneOffs: ahead.oneOffs,
      interval: (today.items[0] ?? ahead.items[0] ?? next?.plan.items[0])?.interval ?? (sub?.interval === "year" ? "year" : "month"),
      today,
    };
  }

  /**
   * Fin de la contratación (cancelada o con su fin programado): la suscripción de Stripe termina al final del periodo
   * ya pagado. Nunca cancela de inmediato ni abona, y nunca deshace un fin. Es lo ÚNICO que sigue llegando a Stripe con
   * el interruptor apagado (para no dejar a Stripe facturando algo que se canceló dentro). Sin enlace no llama a Stripe.
   */
  private async endInStripe(subscriptionId: number, known?: BillingLink | null): Promise<{ canceled: boolean } | null> {
    const gw = this.d.gateway;
    if (!gw?.setCancelAtPeriodEnd) return null;
    const ending = await this.ending(subscriptionId);
    if (!ending) return null;
    const link = known ?? (this.d.link ? await this.d.link(subscriptionId) : null);
    if (!link) return null;
    const remote = await gw.current(link.subscriptionId);
    // También si Stripe tiene un fin POSTERIOR al periodo ya pagado (el de unas condiciones que terminaban más tarde)
    const later = remote?.cancelAt != null && remote.currentPeriodEnd != null && remote.cancelAt > remote.currentPeriodEnd;
    if (remote && remote.status !== "canceled" && (remote.cancelAtPeriodEnd === false || later)) {
      // La clave lleva la versión de la suscripción interna: reprogramar una baja deshecha es OTRA petición para Stripe
      await gw.setCancelAtPeriodEnd(link.subscriptionId, true, `ct:s${subscriptionId}:${link.subscriptionId}:cancel:v${ending.version}:${this.now()}`);
      opsLog("info", "CommercialTerms", "billing_cancel_scheduled", { subscriptionId });
    }
    return ending;
  }

  /**
   * Primer instante FUTURO en el que empieza a regir alguna cuota recurrente de un acuerdo de la suscripción (un
   * acuerdo activado con fecha de inicio futura). null si no hay ninguna pendiente de empezar.
   */
  async nextStart(subscriptionId: number): Promise<number | null> {
    const now = this.now();
    const starts = (await this.d.subscriptionStore.items(subscriptionId)).filter((i) => !voided(i) && i.termsId != null && recurringPrice(i.priceKind) && i.effectiveFrom > now).map((i) => i.effectiveFrom);
    return starts.length ? Math.min(...starts) : null;
  }

  /**
   * Anota importes únicos que YA están cobrados en Stripe por otra vía (el primer pago del Checkout con el que empezó
   * el cobro): la sincronización no los vuelve a enviar. No llama a Stripe.
   */
  async recordSent(subscriptionId: number, stripeSubscriptionId: string, oneOffs: Record<string, string>, actor: string): Promise<void> {
    if (!Object.keys(oneOffs).length) return;
    const plan = await this.plan(subscriptionId);
    if (plan.termsId === null) return;
    const prev = await this.lastDetail(subscriptionId, stripeSubscriptionId);
    // Se conserva todo lo anterior (también el escalado de reintentos de un envío que sigue fallando)
    const detail: SyncDetail = { ...(prev ?? {}), stripeSubscriptionId, itemsHash: prev?.itemsHash ?? null, generation: prev?.generation ?? 0, oneOffs: { ...(prev?.oneOffs ?? {}), ...oneOffs }, attempts: prev?.attempts ?? 0, lastError: prev?.lastError ?? null, lastAttemptAt: prev?.lastAttemptAt ?? this.now(), pendingOneOffs: prev?.pendingOneOffs ?? [] };
    await this.record(plan.termsId, "synced", detail, actor, "Importes únicos cobrados en el primer pago de Stripe");
  }

  /**
   * Importes únicos enviados que NO se cobraron (en una factura anulada, o retirados de una suscripción de Stripe
   * terminada antes de facturarlos): dejan de constar como enviados y se volverán a enviar una vez. No llama a Stripe.
   */
  async revokeOneOffs(subscriptionId: number, stripeSubscriptionId: string, refs: string[], actor: string): Promise<void> {
    if (!refs.length) return;
    const holder = await this.holder(subscriptionId, stripeSubscriptionId);
    if (!holder) return;
    const prev = holder.syncDetail as SyncDetail;
    if (refs.every((r) => (prev.revoked ?? []).includes(r))) return;
    await this.record(holder.id, holder.syncStatus === "failed" ? "failed" : "synced", { ...prev, revoked: Array.from(new Set([...(prev.revoked ?? []), ...refs])) }, actor, "Importes únicos sin cobrar retirados de Stripe: se volverán a enviar una vez");
  }

  /** Acuerdo que guarda el estado de sincronización más reciente de una suscripción de Stripe. */
  private async holder(subscriptionId: number, stripeSubscriptionId: string): Promise<TermsRecord | null> {
    const all = (await this.d.termsStore.list({ subscriptionId })).filter((t) => (t.syncDetail as SyncDetail | null)?.stripeSubscriptionId === stripeSubscriptionId);
    return all.sort((a, b) => newest(a.syncDetail as SyncDetail, b.syncDetail as SyncDetail))[0] ?? null;
  }

  /**
   * Qué se cobraría HOY: las partidas recurrentes vigentes de la suscripción (tal como las factura la simulación) y
   * los importes únicos de sus acuerdos. No llama a Stripe.
   */
  async plan(subscriptionId: number, o: { settle?: boolean; at?: number } = {}): Promise<BillingPlan> {
    // Solo al sincronizar (una escritura): una consulta nunca cambia nada
    if (o.settle) await this.d.settle?.(subscriptionId).catch(() => undefined);
    const sub = await this.d.subscriptionStore.get(subscriptionId);
    if (!sub) throw new TermsError("not_found", "Suscripción no encontrada");
    // «Hoy», salvo que se pida otra fecha o la suscripción esté puesta a cobrar por adelantado (entonces, su inicio)
    const from = o.at === undefined && this.d.billFrom ? await this.d.billFrom(subscriptionId) : null;
    const now = o.at ?? Math.max(this.now(), from ?? 0);
    const all = (await this.d.subscriptionStore.items(subscriptionId)).filter((i) => !voided(i));
    const recurring = sub.status === "canceled" ? [] : all.filter((i) => recurringPrice(i.priceKind) && live(i, now));
    // Solo una suscripción con condiciones personalizadas vivas; las demás las gobierna el circuito ordinario
    const owner = recurring.map((i) => i.termsId).filter((x): x is number => x != null).sort((a, b) => b - a)[0] ?? null;
    const items: NegotiatedItem[] =
      owner === null
        ? []
        : recurring.map((i) => ({ key: i.productKey, name: i.productName, product: i.productKey.startsWith("custom:") ? ({ kind: "custom" } as const) : ({ kind: "catalog", productKey: i.productKey } as const), amountCents: i.lineAmountCents ?? i.unitAmountCents * i.quantity, interval: i.priceKind === "yearly" ? ("year" as const) : ("month" as const), taxRateBp: i.taxRateBp }));
    // Importes únicos de CUALQUIER acuerdo de la suscripción (también de uno ya sustituido o vencido): si vencieron y
    // no se anularon, se deben
    const oneOffs = all
      .filter((i) => i.priceKind === "one_time" && i.termsId != null)
      .map((i) => ({ key: `${i.termsLineId != null ? "charge" : "credit"}:${i.id}`, name: i.productName, amountCents: i.lineAmountCents ?? i.unitAmountCents * i.quantity, taxRateBp: i.taxRateBp, at: i.effectiveFrom, due: i.effectiveFrom <= now }));
    return { subscriptionId, termsId: owner, currency: sub.currency, items, oneOffs, recurringNetCents: items.reduce((a, i) => a + i.amountCents, 0) };
  }

  /** ¿Termina la contratación? (cancelada ya, o con su fin programado). */
  private async ending(subscriptionId: number): Promise<{ canceled: boolean; at: number; version: number } | null> {
    const sub = await this.d.subscriptionStore.get(subscriptionId);
    if (!sub) return null;
    if (sub.status === "canceled") return { canceled: true, at: sub.canceledAt ?? 0, version: sub.version };
    return sub.cancelAt != null ? { canceled: false, at: sub.cancelAt, version: sub.version } : null;
  }

  /** Estado de sincronización más reciente de la suscripción (vive en sus acuerdos; se hereda de uno a otro). */
  private async lastDetail(subscriptionId: number, stripeSubscriptionId: string): Promise<SyncDetail | null> {
    const every = (await this.d.termsStore.list({ subscriptionId })).map((t) => t.syncDetail as SyncDetail | null).filter((x): x is SyncDetail => !!x);
    const all = every.filter((x) => x.stripeSubscriptionId === stripeSubscriptionId);
    // Los importes únicos ya enviados son de la CONTRATACIÓN, no de una suscripción de Stripe: si se vuelve a poner a
    // cobrar con otra, lo cobrado o abonado en la anterior no se repite. Lo que consta como NO cobrado no cuenta
    const { sent, revoked } = sentOf(every);
    // Periodos de cuota facturados en OTRAS suscripciones de Stripe de esta contratación (y lo que ya arrastraban), y el
    // primer inicio de cobro: la cuenta de cobros debidos es de la contratación, no de cada suscripción de Stripe
    const own = new Set(all.flatMap((x) => x.periods ?? []));
    const others = every.filter((x) => x.stripeSubscriptionId !== stripeSubscriptionId);
    const priorPeriods = Array.from(new Set([...others.flatMap((x) => x.periods ?? []), ...every.flatMap((x) => x.prior?.periods ?? [])])).filter((id) => !own.has(id));
    const starts = [...every.map((x) => ({ billingFrom: x.billingFrom ?? null, contractFrom: x.contractFrom ?? null })), ...every.flatMap((x) => (x.prior ? [x.prior] : []))].filter((x) => x.billingFrom != null);
    const origin = priorPeriods.length ? starts.sort((a, b) => a.billingFrom! - b.billingFrom!)[0] : undefined;
    const prior = priorPeriods.length ? { periods: priorPeriods, billingFrom: origin?.billingFrom ?? null, contractFrom: origin?.contractFrom ?? null } : undefined;
    if (!all.length) return every.length ? { stripeSubscriptionId, itemsHash: null, generation: 0, oneOffs: sent, attempts: 0, lastError: null, lastAttemptAt: null, pendingOneOffs: [], revoked, ...(prior ? { prior } : {}) } : null;
    // Unión de lo ya enviado (nunca se «olvida» un importe único) y el estado de partidas más reciente
    const latest = all.slice().sort(newest)[0];
    // Lo que se cuenta de esta suscripción de Stripe se une entre todos sus estados (nunca se pierde un periodo facturado)
    const periods = Array.from(new Set(all.flatMap((x) => x.periods ?? [])));
    const started = all.find((x) => x.billingFrom != null);
    return { ...latest, oneOffs: sent, revoked, periods, ...(prior ? { prior } : {}), billingFrom: started?.billingFrom ?? null, contractFrom: started?.contractFrom ?? null, generation: Math.max(...all.map((x) => x.generation)), attempts: Math.max(...all.map((x) => x.attempts)) };
  }

  /** Importes únicos de la contratación que ya constan enviados a Stripe (en cualquiera de sus suscripciones de Stripe). */
  async sentOneOffs(subscriptionId: number): Promise<Set<string>> {
    const every = (await this.d.termsStore.list({ subscriptionId })).map((t) => t.syncDetail as SyncDetail | null).filter((x): x is SyncDetail => !!x);
    return new Set(Object.keys(sentOf(every).sent));
  }

  private async record(termsId: number, status: "synced" | "failed", detail: SyncDetail, actor: string, message: string) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const t = (await this.d.termsStore.get(termsId)) as TermsRecord;
      // Otra sincronización simultánea pudo registrar pasos: se unen, nunca se pisan
      const prev = t.syncDetail as SyncDetail | null;
      const merged: SyncDetail = prev && prev.stripeSubscriptionId === detail.stripeSubscriptionId ? { ...detail, oneOffs: { ...prev.oneOffs, ...detail.oneOffs }, revoked: Array.from(new Set([...(prev.revoked ?? []), ...(detail.revoked ?? [])])), periods: Array.from(new Set([...(prev.periods ?? []), ...(detail.periods ?? [])])), ...(prev.prior || detail.prior ? { prior: { periods: Array.from(new Set([...(prev.prior?.periods ?? []), ...(detail.prior?.periods ?? [])])), billingFrom: detail.prior?.billingFrom ?? prev.prior?.billingFrom ?? null, contractFrom: detail.prior?.contractFrom ?? prev.prior?.contractFrom ?? null } } : {}), billingFrom: detail.billingFrom ?? prev.billingFrom ?? null, contractFrom: detail.contractFrom ?? prev.contractFrom ?? null, generation: Math.max(prev.generation, detail.generation), attempts: Math.max(prev.attempts + 1, detail.attempts) } : detail;
      try {
        await this.d.termsStore.patch(
          termsId,
          { syncStatus: status, syncDetail: merged },
          // El MISMO fallo repetido no llena el historial: un evento por error distinto (el contador de intentos sí avanza)
          status === "failed" && t.syncStatus === "failed" && prev?.lastError === detail.lastError ? null : { kind: "sync", actor, reason: message.slice(0, 500), before: { syncStatus: t.syncStatus }, after: { syncStatus: status, attempts: merged.attempts, generation: merged.generation, oneOffs: Object.keys(merged.oneOffs).length, pendingOneOffs: merged.pendingOneOffs }, effectiveAt: t.effectiveFrom, acceptanceStatus: t.acceptanceStatus, syncResult: status, economic: null },
          this.now(),
          t.revision,
        );
        return;
      } catch (e) {
        if (!(e instanceof TermsConflict)) throw e;
      }
    }
    throw new TermsError("version_conflict", "No se pudo registrar la sincronización: inténtalo de nuevo");
  }

  /**
   * Deja en Stripe lo que la suscripción tiene que tener ANTES de su próxima renovación (`target`): fin de las
   * condiciones, cobro en pausa, partidas e importes únicos. Con el interruptor apagado, sin pasarela validada o sin
   * enlace con Stripe no hace NINGUNA llamada ni cambia nada. Repetirla es seguro: todo se compara antes con lo que
   * Stripe tiene. Una sola a la vez por suscripción (el mismo arrendamiento que los webhooks); `locked`: quien llama ya lo
   * tiene.
   */
  async sync(subscriptionId: number, actor: string, o: { locked?: boolean } = {}): Promise<SyncOutcome> {
    if (o.locked || !this.d.serialize) return this.syncLocked(subscriptionId, actor);
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.d.serialize(subscriptionId, () => this.syncLocked(subscriptionId, actor));
      } catch (e) {
        if (!(e instanceof SyncBusy)) throw e;
        if (attempt >= 4) return { status: "busy", message: "Otra operación está tratando el cobro de esta suscripción: la conciliación lo completará" };
        await new Promise((r) => setTimeout(r, 200));
      }
    }
  }

  private async syncLocked(subscriptionId: number, actor: string): Promise<SyncOutcome> {
    // Interruptor apagado: no se envía ningún cambio de condiciones. Solo el FIN de una contratación ya enlazada
    if (!this.d.enabled) {
      await this.endInStripe(subscriptionId).catch(() => opsLog("warn", "CommercialTerms", "billing_cancel_failed", { subscriptionId }));
      return { status: "disabled", message: "El cobro en Stripe de condiciones personalizadas está apagado: la suscripción sigue en simulación de facturación" };
    }
    const gw = this.d.gateway;
    if (!gw) return { status: "unsupported", message: "No hay una pasarela de Stripe validada para condiciones personalizadas (pendiente de la validación en Stripe Sandbox)" };
    // Condiciones cambiadas con una sesión de pago abierta: la sesión ya no ofrece lo pactado y se cierra
    await this.d.invalidate?.(subscriptionId).catch(() => undefined);
    const link = this.d.link ? await this.d.link(subscriptionId) : null;
    if (!link) return { status: "not_linked", message: "Esta suscripción no se cobra en Stripe: sigue en simulación de facturación" };
    let t = await this.target(subscriptionId, link.periodEnd ?? null, { settle: true });
    // Fin de la contratación (cancelada o con cancelación programada): Stripe termina al final del periodo ya pagado.
    // Nunca se cancela de inmediato ni se abona nada desde aquí, y nunca se deshace solo un fin pedido dentro
    const ending = await this.endInStripe(subscriptionId, link);
    if (ending?.canceled) return { status: "cancel_scheduled", message: "La contratación está cancelada: la suscripción de Stripe termina al final del periodo ya pagado" };
    // Nunca se vacía una suscripción de Stripe desde aquí: sin condiciones personalizadas (ni hoy ni después) no hay nada que enviar
    if (t.termsId === null) return this.endedAfterTheFact(subscriptionId, link, !!ending, actor);
    const termsId = t.termsId;
    const prev = await this.lastDetail(subscriptionId, link.subscriptionId);
    const detail: SyncDetail = { ...(prev ?? {}), stripeSubscriptionId: link.subscriptionId, itemsHash: prev?.itemsHash ?? null, generation: prev?.generation ?? 0, oneOffs: { ...(prev?.oneOffs ?? {}) }, attempts: (prev?.attempts ?? 0) + 1, lastError: null, lastAttemptAt: this.now(), pendingOneOffs: [], revoked: [...(prev?.revoked ?? [])] };
    let applied = 0;
    let skipped = 0;
    let total = 1;
    const at = (s: string) => `ct:s${subscriptionId}:${link.subscriptionId}:${s}:${this.now()}`;
    try {
      const remote = await gw.current(link.subscriptionId);
      // La renovación de Stripe manda: si el evento que la anotó aquí está atrasado, se usa la que dice Stripe
      if (remote?.currentPeriodEnd != null && remote.currentPeriodEnd !== (link.periodEnd ?? null)) {
        const fresh = await this.target(subscriptionId, remote.currentPeriodEnd);
        if (fresh.termsId !== null) t = fresh;
      }
      const metadata = { es_terms: String(t.termsId), es_subscription: String(subscriptionId) };
      const due = t.oneOffs.filter((o) => o.due);
      detail.pendingOneOffs = t.oneOffs.filter((o) => !o.due).map((o) => o.key);
      detail.itemsHash = targetHash(t);
      total = 1 + due.length;
      const canPause = !!gw.setPaused && remote?.paused !== undefined;
      if (t.paused && !canPause) throw new Error("La cuota recurrente total es 0: el acceso a Stripe no admite poner el cobro en pausa y una suscripción gratuita no se deja en cobro");

      // 1.º Fin de las condiciones sin nada detrás. NUNCA con `cancel_at` (en modo flexible Stripe acortaría el último
      // periodo y lo cobraría prorrateado, sin poder evitarlo; y quitarlo dentro del periodo prorratea). Se usa
      // `cancel_at_period_end` durante el ÚLTIMO periodo que el contrato cubre entero: Stripe no renueva hacia un periodo
      // que pasaría del fin. Va ANTES que las partidas: deshacerlo nunca se calcula con las partidas del sucesor
      const requested = !!(this.d.cancelRequested && (await this.d.cancelRequested(subscriptionId)));
      if (remote && remote.status !== "canceled" && !ending && !requested) {
        const ours = prev?.endedBySync ?? null;
        const cur = remote.cancelAt ?? null;
        const mine = ours !== null && cur !== null && cur === (ours.periodEnd ?? ours.at);
        if (detail.billingFrom == null) await this.noteBillingStart(subscriptionId, detail, remote);
        if (this.stopNow(t, remote, detail)) {
          if (remote.cancelAtPeriodEnd !== true && gw.setCancelAtPeriodEnd) {
            await gw.setCancelAtPeriodEnd(link.subscriptionId, true, at(`end:${t.endAt}`));
            opsLog("warn", "CommercialTerms", "billing_terms_end_scheduled", { subscriptionId, endAt: t.endAt, stripeEnd: remote.currentPeriodEnd ?? null });
            recordFailure("stripe.negotiated_terms_ended");
            detail.endedBySync = { at: t.endAt!, via: "period_end", periodEnd: remote.currentPeriodEnd ?? null };
            applied++;
          } else if (mine) detail.endedBySync = { at: t.endAt!, via: "period_end", periodEnd: cur };
          else if (ours !== null) detail.endedBySync = null;
        } else if (mine) {
          // Llega un acuerdo posterior (o el fin se aleja) antes de la fecha: se deshace SOLO el fin de la sincronización,
          // sin prorrateo (el periodo ya cobrado no se vuelve a cobrar)
          if (ours!.via === "cancel_at" && gw.setCancelAt) await gw.setCancelAt(link.subscriptionId, null, at(`end:${cur}>none`));
          else if (gw.setCancelAtPeriodEnd) await gw.setCancelAtPeriodEnd(link.subscriptionId, false, at(`end:${cur}>none`));
          opsLog("info", "CommercialTerms", "billing_terms_end_undone", { subscriptionId, was: cur });
          detail.endedBySync = null;
          applied++;
        } else if (ours !== null) detail.endedBySync = null;
      }

      // 2.º Partidas y cobro en pausa (cuota 0 o hueco hasta el acuerdo siguiente).
      //  - Al ENTRAR en la pausa: primero la pausa (la renovación gratuita nunca se cobra, ni con las partidas de antes ni
      //    con las de después) y luego las partidas del primer periodo de pago; la reanudación automática solo se pone
      //    cuando esas partidas ya están en Stripe (si no, una pausa anterior pierde su fecha: se envía vacía).
      //  - Al SALIR: primero las partidas y luego se quita la pausa; sin ellas nunca se quita.
      const itemsReady = !t.items || (!!remote && sameItems(t.items, remote.items));
      const applyItems = async () => {
        // Cada intento, clave nueva: Stripe guarda también los errores por clave, y repetirla devolvería el mismo fallo.
        // No duplica nada: antes de enviar se compara siempre con lo que Stripe tiene de verdad
        const hash = stableHash(t.items).slice(0, 24);
        detail.generation += 1;
        await gw.applyItems({ subscriptionId: link.subscriptionId, currency: t.currency, items: t.items!, metadata }, `ct:s${subscriptionId}:${link.subscriptionId}:items:${hash}:g${detail.generation}`);
        applied++;
      };
      const pause = async (resumesAt: number | null) => {
        if (remote!.paused === true && (remote!.pauseResumesAt ?? null) === resumesAt) return;
        // Sin fecha sobre una pausa que ya la tenía: se BORRA (null); en una pausa nueva, simplemente no se envía
        await gw.setPaused!(link.subscriptionId, true, at(`pause:on:${resumesAt ?? "open"}`), resumesAt ?? (remote!.pauseResumesAt ? null : undefined));
        remote!.paused = true;
        remote!.pauseResumesAt = resumesAt;
        opsLog("info", "CommercialTerms", "billing_paused", { subscriptionId, resumesAt });
        applied++;
      };
      if (t.paused && canPause && remote) {
        detail.pausedSince = prev?.pausedSince ?? this.now();
        await pause(itemsReady ? t.resumesAt : null);
        if (!itemsReady) {
          await applyItems();
          await pause(t.resumesAt);
        } else if (t.items) skipped++;
      } else {
        if (t.items && itemsReady) skipped++;
        else if (t.items) await applyItems();
        if (canPause && remote?.paused) {
          await gw.setPaused!(link.subscriptionId, false, at("pause:off"));
          opsLog("info", "CommercialTerms", "billing_unpaused", { subscriptionId });
          applied++;
        }
      }

      // 3.º Importes únicos vencidos (los de la renovación, antes de ella): cada uno, una vez. Antes de enviarlo se busca
      // en Stripe por su clave. Con el cobro en pausa no se envían (Stripe anularía su factura); y uno ya enviado que acabó
      // en una renovación ANULADA POR LA PAUSA no se cobró: se vuelve a enviar, una vez por cada copia anulada. Uno que
      // está en una factura anulada por otro motivo (un operador que la perdonó) no se repite: queda como diferencia
      for (const o of t.paused ? [] : due) {
        const sent = detail.oneOffs[o.key];
        const recheck = !!sent && !sent.startsWith("checkout:") && detail.pausedSince != null && o.at >= this.now() - ONE_OFF_WINDOW_MS;
        if (sent && !recheck) {
          skipped++;
          continue;
        }
        const found = await gw.findOneOff(link.subscriptionId, o.key);
        // Vivo en Stripe (pendiente o facturado), perdonado a propósito, o ya enviado y sin prueba de que la pausa lo anulara
        if ((found && !found.voided) || (sent && !found?.voided)) {
          if (found && !found.voided && !found.forgiven) detail.oneOffs[o.key] = found.ref;
          skipped++;
          continue;
        }
        const out = await gw.addOneOff({ subscriptionId: link.subscriptionId, customerId: link.customerId, currency: t.currency, item: { key: o.key, name: o.name, amountCents: o.amountCents, taxRateBp: o.taxRateBp }, metadata }, `ct:s${subscriptionId}:${link.subscriptionId}:${o.key}${found?.voided ? `:r${found.ref}` : ""}`);
        if (found?.voided) {
          opsLog("warn", "CommercialTerms", "billing_one_off_resent", { subscriptionId, key: o.key, voided: found.ref });
          detail.revoked = Array.from(new Set([...(detail.revoked ?? []), found.ref, ...(sent && sent !== out.ref ? [sent] : [])]));
        }
        detail.oneOffs[o.key] = out.ref;
        applied++;
      }
    } catch (e) {
      const error = (e instanceof Error ? e.message : "error").slice(0, 300);
      detail.lastError = error;
      detail.failures = (prev?.failures ?? 0) + 1;
      opsLog("warn", "CommercialTerms", "billing_sync_failed", { subscriptionId });
      await this.record(termsId, "failed", detail, actor, `Sincronización con Stripe fallida: ${error}`);
      return { status: "failed", error, completed: applied + skipped, remaining: Math.max(0, total - applied - skipped) };
    }
    detail.failures = 0;
    await this.record(termsId, "synced", detail, actor, applied ? "Condiciones sincronizadas con Stripe" : "Sincronización con Stripe sin cambios");
    return { status: "synced", applied, skipped, pendingOneOffs: detail.pendingOneOffs };
  }

  /**
   * Las condiciones terminaron (ya, sin que se programara antes) y ninguna las sustituye: Stripe no puede seguir
   * cobrando sus partidas. Si esta suscripción de Stripe llegó a llevar condiciones, se programa su fin al final del
   * periodo ya pagado y se avisa. Queda anotado como fin de la sincronización (se deshace si llega un acuerdo posterior).
   */
  private async endedAfterTheFact(subscriptionId: number, link: BillingLink, ending: boolean, actor: string): Promise<SyncOutcome> {
    const gw = this.d.gateway!;
    const sent = await this.lastDetail(subscriptionId, link.subscriptionId);
    if (ending || !gw.setCancelAtPeriodEnd || !sent || sent.lastAttemptAt === null) return { status: "nothing_to_bill", message: "La suscripción no tiene condiciones personalizadas vigentes con cuotas recurrentes" };
    const remote = await gw.current(link.subscriptionId);
    if (remote && remote.status !== "canceled" && remote.cancelAtPeriodEnd === false) {
      await gw.setCancelAtPeriodEnd(link.subscriptionId, true, `ct:s${subscriptionId}:${link.subscriptionId}:ended:${this.now()}`);
      opsLog("warn", "CommercialTerms", "billing_terms_ended", { subscriptionId });
      recordFailure("stripe.negotiated_terms_ended");
      const holder = await this.holder(subscriptionId, link.subscriptionId);
      const end = remote.currentPeriodEnd ?? null;
      if (holder && end !== null) await this.record(holder.id, holder.syncStatus === "failed" ? "failed" : "synced", { ...(holder.syncDetail as SyncDetail), endedBySync: { at: this.now(), via: "period_end", periodEnd: end } }, actor, "Condiciones terminadas sin sucesor: fin de la suscripción de Stripe al final del periodo ya pagado").catch(() => undefined);
    }
    return { status: "cancel_scheduled", message: "Las condiciones personalizadas terminaron sin otras que las sustituyan: la suscripción de Stripe termina al final del periodo ya pagado" };
  }

  /** ¿Debe Stripe dejar de renovar ya? Cuenta de cobros debidos frente a periodos facturados (`owedPeriods`). */
  private stopNow(t: BillingTarget, remote: RemoteState, detail: SyncDetail | null): boolean {
    // La cuenta es de la CONTRATACIÓN: desde el primer inicio de cobro (también el de una suscripción de Stripe anterior)
    // y descontando lo ya facturado en las anteriores. Nunca negativa
    const fromPrior = detail?.prior?.billingFrom != null && detail.prior.contractFrom != null;
    const from = fromPrior ? detail!.prior! : detail;
    const total = t.endAt !== null && from?.billingFrom != null && from.contractFrom != null ? owedPeriods(from.contractFrom, from.billingFrom, t.endAt, t.interval) : null;
    // Lo facturado antes solo se descuenta si la cuenta empieza en el inicio de cobro anterior; si empieza en el de esta
    // suscripción (la anterior no llegó a anotarlo), los periodos ya transcurridos ya quedan fuera y descontarlos otra vez
    // dejaría cuotas sin cobrar
    const owed = total === null ? null : Math.max(0, total - (fromPrior ? (detail?.prior?.periods.length ?? 0) : 0));
    return stopsAtRenewal(t.endAt, remote.currentPeriodEnd, detail?.periods?.length ?? 0, owed, t.interval, remote.billingCycleAnchor);
  }

  /**
   * Anota cuándo empezó a cobrarse esta suscripción de Stripe (su ancla) y desde cuándo cuenta el contrato: el inicio de
   * las cuotas del acuerdo que regía entonces (su primera partida recurrente, no una fecha en la que se partió). Una vez
   * anotado no cambia: un acuerdo que sustituye a otro no reinicia la cuenta.
   */
  private async noteBillingStart(subscriptionId: number, detail: SyncDetail, remote: RemoteState | null) {
    const from = remote?.billingCycleAnchor ?? null;
    if (from === null) return;
    const terms = (await this.plan(subscriptionId, { at: from })).termsId;
    const items = terms === null ? [] : (await this.d.subscriptionStore.items(subscriptionId)).filter((i) => !voided(i) && i.termsId === terms && recurringPrice(i.priceKind));
    detail.billingFrom = from;
    detail.contractFrom = items.length ? Math.min(from, ...items.map((i) => i.effectiveFrom)) : from;
  }

  /**
   * Una factura de Stripe abrió un periodo de cuota de esta suscripción (alta con cuota o renovación, cobrada, impagada
   * o anulada por la pausa): cuenta para `owedPeriods`. Idempotente por factura. No llama a Stripe.
   */
  async notePeriod(subscriptionId: number, stripeSubscriptionId: string, invoiceId: string | string[], actor: string): Promise<void> {
    const prev = await this.lastDetail(subscriptionId, stripeSubscriptionId);
    const fresh = (Array.isArray(invoiceId) ? invoiceId : [invoiceId]).filter((id) => !prev?.periods?.includes(id));
    if (!fresh.length) return;
    const holder = await this.holder(subscriptionId, stripeSubscriptionId);
    const termsId = holder?.id ?? (await this.plan(subscriptionId)).termsId ?? (await this.d.termsStore.list({ subscriptionId })).map((x) => x.id).sort((x, y) => y - x)[0] ?? null;
    if (termsId === null) return;
    const base: SyncDetail = prev ?? { stripeSubscriptionId, itemsHash: null, generation: 0, oneOffs: {}, attempts: 0, lastError: null, lastAttemptAt: null, pendingOneOffs: [] };
    const detail: SyncDetail = { ...base, stripeSubscriptionId, periods: [...(base.periods ?? []), ...fresh] };
    await this.record(termsId, holder?.syncStatus === "failed" ? "failed" : "synced", detail, actor, "Periodo de cuota facturado en Stripe");
  }

  /** Facturas que constan como periodos de cuota de esa suscripción de Stripe. */
  async periodsOf(subscriptionId: number, stripeSubscriptionId: string): Promise<string[]> {
    return (await this.lastDetail(subscriptionId, stripeSubscriptionId))?.periods ?? [];
  }

  /** Fin que programó la sincronización en esa suscripción de Stripe (fecha de fin de las condiciones y de Stripe). */
  async scheduledEnd(subscriptionId: number, stripeSubscriptionId: string): Promise<{ at: number; periodEnd: number | null } | null> {
    const e = (await this.lastDetail(subscriptionId, stripeSubscriptionId))?.endedBySync ?? null;
    return e ? { at: e.at, periodEnd: e.periodEnd ?? (e.via === "cancel_at" ? e.at : null) } : null;
  }

  /**
   * Tras un cambio (activación, fin de una condición temporal) o en una fecha de corte: sincroniza si el cobro está
   * abierto y la suscripción se cobra en Stripe; si no, no hace nada. Nunca lanza: un fallo queda registrado.
   */
  async syncIfOpen(subscriptionId: number, actor = "system:terms-billing", o: { locked?: boolean } = {}): Promise<SyncOutcome | null> {
    if (!this.d.gateway) return null;
    // Con el interruptor apagado `sync` solo propaga el fin de una contratación ya enlazada; aquí no hay resultado
    const out = await this.sync(subscriptionId, actor, o).catch((e) => {
      opsLog("warn", "CommercialTerms", "billing_sync_error", { subscriptionId, error: e instanceof Error ? e.name : "error" });
      return null;
    });
    return this.d.enabled ? out : null;
  }

  /** Consistencia entre lo que rige hoy y lo que Stripe tiene: partidas, moneda e importes únicos. Solo lectura. */
  async reconcile(subscriptionId: number, o: { whenOff?: boolean } = {}) {
    const plan = await this.plan(subscriptionId);
    const current = plan.termsId !== null ? await this.d.termsStore.get(plan.termsId) : null;
    // `whenOff` (la conciliación periódica): lo ya enlazado se sigue comparando aunque el interruptor esté apagado
    const link = (this.open || (o.whenOff && !!this.d.gateway)) && this.d.link ? await this.d.link(subscriptionId) : null;
    const gw = this.d.gateway;
    if (!link || !gw) return { available: false as const, plan, syncStatus: current?.syncStatus ?? "none", differences: [] };
    const remote = await gw.current(link.subscriptionId);
    const differences: Array<{ key: string; kind: "item" | "one_off" | "currency" | "tax" | "status"; expectedCents: number | null; stripeCents: number | null }> = [];
    // Sin suscripción en Stripe no hay nada con lo que comparar: es una diferencia en sí
    if (!remote) differences.push({ key: "suscripción", kind: "status", expectedCents: null, stripeCents: null });
    // Impuestos: la suscripción debe calcularlos como dice la política fiscal del entorno (Stripe Tax en live)
    if (remote?.tax && remote.tax.mode !== remote.tax.expected) differences.push({ key: `impuestos:${remote.tax.mode}`, kind: "tax", expectedCents: null, stripeCents: null });
    // Estado: una contratación que termina debe tener su fin programado en Stripe, y una viva no debe estar cancelada allí
    const ending = await this.ending(subscriptionId);
    // Hecho fuera de Elephant y que cambia lo que se cobra: cupón, cobro en pausa, cobro no automático, periodo sin cargo
    for (const a of remote?.anomalies ?? []) differences.push({ key: a, kind: "status", expectedCents: null, stripeCents: null });
    if (remote?.trialEnd && remote.trialEnd > this.now() && !(this.d.billFrom && (await this.d.billFrom(subscriptionId)))) differences.push({ key: "periodo_sin_cargo", kind: "status", expectedCents: null, stripeCents: null });
    // Lo que Stripe tiene que tener ANTES de su próxima renovación (lo de hoy, o lo de la renovación si está cerca)
    const t = await this.target(subscriptionId, remote?.currentPeriodEnd ?? link.periodEnd ?? null);
    const noTerms = t.termsId === null;
    const free = t.paused;
    const requested = !!(this.d.cancelRequested && (await this.d.cancelRequested(subscriptionId)));
    // Fin de las condiciones sin sucesor: en su último periodo, Stripe debe tener el fin programado (`cancel_at_period_end`);
    // entonces es lo esperado, no un fin «solo en Stripe»
    const counted = await this.lastDetail(subscriptionId, link.subscriptionId);
    const stop = !!remote && this.stopNow(t, remote, counted);
    const endExpected = stop && remote?.cancelAtPeriodEnd === true;
    // Cobro en pausa: solo debe estarlo con una cuota total de 0 o un hueco hasta el acuerdo siguiente (y entonces debe estarlo)
    if (remote?.paused === true && !free) differences.push({ key: "cobro_en_pausa", kind: "status", expectedCents: null, stripeCents: null });
    if (remote?.paused === false && free) differences.push({ key: "cobro_sin_pausar", kind: "status", expectedCents: null, stripeCents: null });
    // Fin programado SOLO en Stripe (ni la contratación termina dentro ni lo pidió un operador): Stripe dejaría de cobrar
    // a un cliente que sigue contratado. Se avisa; nunca se deshace ni se da por terminada la contratación sola
    if (remote && !ending && !noTerms && !endExpected && remote.cancelAtPeriodEnd === true && remote.status !== "canceled" && !requested) differences.push({ key: "fin_solo_en_stripe", kind: "status", expectedCents: null, stripeCents: null });
    if (remote && !ending && !requested && remote.status !== "canceled" && stop) {
      // Último periodo de unas condiciones sin nada detrás y Stripe aún renovaría: la sincronización lo programa
      if (remote.cancelAtPeriodEnd !== true && gw.setCancelAtPeriodEnd) differences.push({ key: "fin_condiciones_sin_programar", kind: "status", expectedCents: null, stripeCents: null });
      // Ya programado: se avisa (una vez al día, `reconcileAll`) hasta que llegue un acuerdo posterior o termine
      if (endExpected) differences.push({ key: "fin_por_condiciones", kind: "status", expectedCents: null, stripeCents: null });
    }
    if (remote?.status !== undefined) {
      if (ending && remote.status !== "canceled" && remote.cancelAtPeriodEnd === false) differences.push({ key: "fin_sin_programar", kind: "status", expectedCents: null, stripeCents: null });
      if (!ending && remote.status === "canceled") differences.push({ key: "cancelada_en_stripe", kind: "status", expectedCents: null, stripeCents: null });
    }
    if (remote?.currency && remote.currency.toUpperCase() !== plan.currency.toUpperCase()) differences.push({ key: "moneda", kind: "currency", expectedCents: null, stripeCents: null });
    // Sin partidas que comparar en dos casos: condiciones terminadas con el fin ya programado en Stripe (está terminando)
    // y cobro en pausa sin un periodo de pago posterior conocido (las partidas no se tocan mientras no se cobra)
    const expected = t.items ?? plan.items;
    const skipItems = (noTerms && remote?.cancelAtPeriodEnd === true) || (free && remote?.paused === true && !t.items);
    for (const i of skipItems ? [] : expected) {
      const r = remote?.items.find((x) => x.key === i.key);
      if (!r || r.amountCents !== i.amountCents || r.interval !== i.interval || !sameTax(r.taxRateBp, i.taxRateBp)) differences.push({ key: i.key, kind: "item", expectedCents: i.amountCents, stripeCents: r?.amountCents ?? null });
    }
    for (const r of skipItems ? [] : (remote?.items ?? [])) if (!expected.some((i) => i.key === r.key)) differences.push({ key: r.key ?? "(sin clave)", kind: "item", expectedCents: null, stripeCents: r.amountCents });
    // Importes únicos vencidos: deben estar en Stripe, vivos (no en una factura anulada) y por su importe
    const sent = (await this.lastDetail(subscriptionId, link.subscriptionId))?.oneOffs ?? {};
    for (const o of free && remote?.paused === true ? [] : t.oneOffs.filter((x) => x.due)) {
      const f = await gw.findOneOff(link.subscriptionId, o.key);
      // No se encuentra en Stripe pero consta enviado: cobrado en el primer pago de un Checkout (allí no lleva clave
      // propia) o tan antiguo que ya no entra en los importes que se leen del cliente. No es una diferencia
      if (!f && sent[o.key] && (sent[o.key].startsWith("checkout:") || o.at < this.now() - ONE_OFF_WINDOW_MS)) continue;
      if (!f || f.voided || f.forgiven || f.amountCents !== o.amountCents) differences.push({ key: o.key, kind: "one_off", expectedCents: o.amountCents, stripeCents: f && !f.voided && !f.forgiven ? f.amountCents : null });
    }
    return { available: true as const, plan, syncStatus: current?.syncStatus ?? "none", consistent: differences.length === 0, differences, stripe: remote ? { status: remote.status ?? null, cancelAtPeriodEnd: remote.cancelAtPeriodEnd ?? null, cancelAt: remote.cancelAt ?? null, tax: remote.tax ?? null } : null, target: { at: t.at, paused: t.paused, resumesAt: t.resumesAt, endAt: t.endAt, interval: t.interval } };
  }
}

/**
 * Estado del cobro en Stripe de las condiciones personalizadas para la línea de arranque (`CommercialTerms`), sin
 * datos sensibles. `stripeBilling`: `off` (interruptor apagado: ninguna llamada a Stripe), `on` (encendido y con todo
 * lo necesario) o `switch_on_blocked` (encendido pero falta algo: `stripeBillingReasons`). Encendido, solo se cobra lo
 * que un operador pone a cobrar de forma expresa (`stripeBillingScope`).
 */
export function describeTermsBilling(x: { switchOn: boolean; registry: boolean; stripe: { mode: "test" | "live"; taxPolicy: string | null; urls: boolean } | null; /** Suscripciones ya enlazadas y vivas en Stripe. */ linked?: number }) {
  const reasons = [
    ...(x.registry ? [] : ["crm_migration_0049_missing"]),
    ...(x.stripe ? [] : ["stripe_not_mounted"]),
    ...(x.stripe && !x.stripe.urls ? ["checkout_urls_missing"] : []),
    ...(x.stripe && x.stripe.mode === "live" && !x.stripe.taxPolicy ? ["tax_policy_pending"] : []),
  ];
  return {
    // Apagado con suscripciones ya enlazadas: Stripe las sigue cobrando; no se inicia ni se cambia nada, pero su estado de
    // pago, su conciliación y su FIN siguen funcionando. Para dejar de cobrar a un cliente hay que programar su fin
    stripeBilling: !x.switchOn ? (x.linked ? ("off_with_linked" as const) : ("off" as const)) : reasons.length ? ("switch_on_blocked" as const) : ("on" as const),
    ...(x.linked !== undefined ? { stripeBillingLinked: x.linked } : {}),
    stripeBillingScope: "explicit_start_only" as const,
    ...(x.stripe ? { stripeBillingMode: x.stripe.mode } : {}),
    ...(reasons.length ? { stripeBillingReasons: reasons } : {}),
  };
}

/** `/cp/v1/subscriptions/:id/terms/billing…`: plan de cobro y conciliación (lectura) y sincronización (gestión de precios). */
export function createTermsBillingRouter(svc: TermsBillingService): Router {
  const r = express.Router();
  const id = z.coerce.number().int().positive();
  const wrap = (fn: (req: Request, res: Response) => Promise<void>) => (req: Request, res: Response) =>
    fn(req, res).catch((e) => {
      if (e instanceof TermsError) return void res.status(e.code === "not_found" ? 404 : e.code === "invalid_input" ? 400 : 409).json({ error: e.code, message: e.message });
      if (e instanceof z.ZodError) return void res.status(400).json({ error: "invalid_request", message: "Petición no válida" });
      // Stripe no responde, o la pasarela se niega a tocar una suscripción que no es de condiciones personalizadas
      if (e instanceof Error && (e.name === "StripeGatewayError" || e.name === "NegotiatedGatewayError")) return void res.status(502).json({ error: "stripe_error", message: e.message.slice(0, 300) });
      opsLog("error", "CommercialTerms", "billing_error", { error: e instanceof Error ? e.name : "error" });
      res.status(500).json({ error: "internal_error", message: "Error interno" });
    });
  r.get("/subscriptions/:id/terms/billing", requireScope("subscriptions:read"), wrap(async (req, res) => void res.json(await svc.reconcile(id.parse(req.params.id)))));
  r.post("/subscriptions/:id/terms/billing/sync", requireCustomPricing(), wrap(async (req, res) => {
    const a = getAuth(req)!.actor;
    res.json(await svc.sync(id.parse(req.params.id), `${a.type}:${a.id}`));
  }));
  return r;
}
