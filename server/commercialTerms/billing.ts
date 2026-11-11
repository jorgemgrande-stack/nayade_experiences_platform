/**
 * Cobro en Stripe de una suscripción con condiciones comerciales personalizadas (fase 4). APAGADO por defecto.
 *
 * El importe negociado es la fuente económica efectiva. Lo que se envía a Stripe es lo que la suscripción tiene HOY:
 * sus partidas recurrentes vigentes (las mismas que factura la simulación, con su importe neto del periodo y su tipo
 * de impuesto) y los importes únicos ya vencidos. Se planifica por SUSCRIPCIÓN, no por acuerdo: un acuerdo programado
 * no cambia lo que se cobra hoy, y al vencer una condición temporal se envía lo que rige después.
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
import { isRecurring as recurringPrice, stableHash } from "../subscriptions/pricing";
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
  /** Busca un importe único ya enviado por su clave (metadato). Null si Stripe no lo tiene. */
  findOneOff(subscriptionId: string, key: string): Promise<{ ref: string; amountCents: number } | null>;
  /** Lo que la suscripción tiene ahora en Stripe (para comparar antes de enviar y para conciliar). */
  current(subscriptionId: string): Promise<{ currency: string | null; items: Array<{ key: string | null; amountCents: number; interval: "month" | "year"; taxRateBp: number | null }> } | null>;
}

export interface BillingLink {
  customerId: string;
  subscriptionId: string;
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
}

export type SyncOutcome =
  | { status: "disabled" | "unsupported" | "not_linked" | "nothing_to_bill"; message: string }
  | { status: "synced"; applied: number; skipped: number; pendingOneOffs: string[] }
  | { status: "failed"; error: string; completed: number; remaining: number };

const live = (i: SubscriptionItem, at: number) => i.effectiveFrom <= at && (i.effectiveTo === null || i.effectiveTo > at);
const voided = (i: SubscriptionItem) => i.effectiveTo !== null && i.effectiveTo <= i.effectiveFrom;
const sameItems = (a: NegotiatedItem[], b: Array<{ key: string | null; amountCents: number; interval: string; taxRateBp: number | null }>) =>
  a.length === b.length && a.every((i) => b.some((r) => r.key === i.key && r.amountCents === i.amountCents && r.interval === i.interval && r.taxRateBp === i.taxRateBp));

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
      /** Antes de planificar: resuelve lo que dependa de la fecha (fin de condiciones temporales), como la simulación. */
      settle?: (subscriptionId: number) => Promise<unknown>;
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

  /**
   * Qué se cobraría HOY: las partidas recurrentes vigentes de la suscripción (tal como las factura la simulación) y
   * los importes únicos de sus acuerdos. No llama a Stripe.
   */
  async plan(subscriptionId: number, o: { settle?: boolean } = {}): Promise<BillingPlan> {
    // Solo al sincronizar (una escritura): una consulta nunca cambia nada
    if (o.settle) await this.d.settle?.(subscriptionId).catch(() => undefined);
    const sub = await this.d.subscriptionStore.get(subscriptionId);
    if (!sub) throw new TermsError("not_found", "Suscripción no encontrada");
    const now = this.now();
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

  /** Estado de sincronización más reciente de la suscripción (vive en sus acuerdos; se hereda de uno a otro). */
  private async lastDetail(subscriptionId: number, stripeSubscriptionId: string): Promise<SyncDetail | null> {
    const all = (await this.d.termsStore.list({ subscriptionId })).map((t) => t.syncDetail as SyncDetail | null).filter((x): x is SyncDetail => !!x && x.stripeSubscriptionId === stripeSubscriptionId);
    if (!all.length) return null;
    // Unión de lo ya enviado (nunca se «olvida» un importe único) y el estado de partidas más reciente
    const latest = all.slice().sort((a, b) => (b.lastAttemptAt ?? 0) - (a.lastAttemptAt ?? 0))[0];
    return { ...latest, oneOffs: Object.assign({}, ...all.map((x) => x.oneOffs)), generation: Math.max(...all.map((x) => x.generation)), attempts: Math.max(...all.map((x) => x.attempts)) };
  }

  private async record(termsId: number, status: "synced" | "failed", detail: SyncDetail, actor: string, message: string) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const t = (await this.d.termsStore.get(termsId)) as TermsRecord;
      // Otra sincronización simultánea pudo registrar pasos: se unen, nunca se pisan
      const prev = t.syncDetail as SyncDetail | null;
      const merged: SyncDetail = prev && prev.stripeSubscriptionId === detail.stripeSubscriptionId ? { ...detail, oneOffs: { ...prev.oneOffs, ...detail.oneOffs }, generation: Math.max(prev.generation, detail.generation), attempts: Math.max(prev.attempts + 1, detail.attempts) } : detail;
      try {
        await this.d.termsStore.patch(
          termsId,
          { syncStatus: status, syncDetail: merged },
          { kind: "sync", actor, reason: message.slice(0, 500), before: { syncStatus: t.syncStatus }, after: { syncStatus: status, attempts: merged.attempts, generation: merged.generation, oneOffs: Object.keys(merged.oneOffs).length, pendingOneOffs: merged.pendingOneOffs }, effectiveAt: t.effectiveFrom, acceptanceStatus: t.acceptanceStatus, syncResult: status, economic: null },
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
   * Deja en Stripe lo que la suscripción tiene hoy. Con el interruptor apagado, sin pasarela validada o sin enlace con
   * Stripe no hace NINGUNA llamada ni cambia nada. Repetirla es seguro.
   */
  async sync(subscriptionId: number, actor: string): Promise<SyncOutcome> {
    if (!this.d.enabled) return { status: "disabled", message: "El cobro en Stripe de condiciones personalizadas está apagado: la suscripción sigue en simulación de facturación" };
    const gw = this.d.gateway;
    if (!gw) return { status: "unsupported", message: "No hay una pasarela de Stripe validada para condiciones personalizadas (pendiente de la validación en Stripe Sandbox)" };
    const link = this.d.link ? await this.d.link(subscriptionId) : null;
    if (!link) return { status: "not_linked", message: "Esta suscripción no se cobra en Stripe: sigue en simulación de facturación" };
    const plan = await this.plan(subscriptionId, { settle: true });
    // Nunca se vacía una suscripción de Stripe desde aquí: sin condiciones personalizadas vivas no hay nada que enviar
    if (plan.termsId === null || !plan.items.length) return { status: "nothing_to_bill", message: "La suscripción no tiene condiciones personalizadas vigentes con cuotas recurrentes" };
    const prev = await this.lastDetail(subscriptionId, link.subscriptionId);
    const detail: SyncDetail = { stripeSubscriptionId: link.subscriptionId, itemsHash: prev?.itemsHash ?? null, generation: prev?.generation ?? 0, oneOffs: { ...(prev?.oneOffs ?? {}) }, attempts: (prev?.attempts ?? 0) + 1, lastError: null, lastAttemptAt: this.now(), pendingOneOffs: plan.oneOffs.filter((o) => !o.due).map((o) => o.key) };
    const metadata = { es_terms: String(plan.termsId), es_subscription: String(subscriptionId) };
    const due = plan.oneOffs.filter((o) => o.due && !detail.oneOffs[o.key]);
    let applied = 0;
    let skipped = plan.oneOffs.filter((o) => o.due).length - due.length;
    const total = 1 + plan.oneOffs.filter((o) => o.due).length;
    try {
      // 1.º Partidas recurrentes: se compara con lo que Stripe tiene de verdad (no con lo que creemos haber enviado)
      const remote = await gw.current(link.subscriptionId);
      if (remote && sameItems(plan.items, remote.items)) skipped++;
      else {
        const hash = stableHash(plan.items).slice(0, 24);
        // Mismo contenido que el último intento fallido → misma clave (si Stripe llegó a aplicarlo, responde igual);
        // contenido distinto, o vuelta a una composición anterior ya sustituida → clave nueva
        const generation = detail.itemsHash === hash && prev?.lastError ? detail.generation : detail.generation + 1;
        detail.itemsHash = hash;
        detail.generation = generation;
        await gw.applyItems({ subscriptionId: link.subscriptionId, currency: plan.currency, items: plan.items, metadata }, `ct:s${subscriptionId}:${link.subscriptionId}:items:${hash}:g${generation}`);
        applied++;
      }
      // 2.º Importes únicos vencidos: cada uno, una vez. Antes de enviarlo se busca en Stripe por su clave
      for (const o of due) {
        const found = await gw.findOneOff(link.subscriptionId, o.key);
        if (found) {
          detail.oneOffs[o.key] = found.ref;
          skipped++;
          continue;
        }
        const out = await gw.addOneOff({ subscriptionId: link.subscriptionId, customerId: link.customerId, currency: plan.currency, item: { key: o.key, name: o.name, amountCents: o.amountCents, taxRateBp: o.taxRateBp }, metadata }, `ct:s${subscriptionId}:${link.subscriptionId}:${o.key}`);
        detail.oneOffs[o.key] = out.ref;
        applied++;
      }
    } catch (e) {
      const error = (e instanceof Error ? e.message : "error").slice(0, 300);
      detail.lastError = error;
      opsLog("warn", "CommercialTerms", "billing_sync_failed", { subscriptionId });
      await this.record(plan.termsId, "failed", detail, actor, `Sincronización con Stripe fallida: ${error}`);
      return { status: "failed", error, completed: applied + skipped, remaining: total - applied - skipped };
    }
    await this.record(plan.termsId, "synced", detail, actor, applied ? "Condiciones sincronizadas con Stripe" : "Sincronización con Stripe sin cambios");
    return { status: "synced", applied, skipped, pendingOneOffs: detail.pendingOneOffs };
  }

  /**
   * Tras un cambio (activación, fin de una condición temporal) o en una fecha de corte: sincroniza si el cobro está
   * abierto y la suscripción se cobra en Stripe; si no, no hace nada. Nunca lanza: un fallo queda registrado.
   */
  async syncIfOpen(subscriptionId: number, actor = "system:terms-billing"): Promise<SyncOutcome | null> {
    if (!this.open) return null;
    return this.sync(subscriptionId, actor).catch((e) => {
      opsLog("warn", "CommercialTerms", "billing_sync_error", { subscriptionId, error: e instanceof Error ? e.name : "error" });
      return null;
    });
  }

  /** Consistencia entre lo que rige hoy y lo que Stripe tiene: partidas, moneda e importes únicos. Solo lectura. */
  async reconcile(subscriptionId: number) {
    const plan = await this.plan(subscriptionId);
    const current = plan.termsId !== null ? await this.d.termsStore.get(plan.termsId) : null;
    const link = this.open && this.d.link ? await this.d.link(subscriptionId) : null;
    const gw = this.d.gateway;
    if (!link || !gw) return { available: false as const, plan, syncStatus: current?.syncStatus ?? "none", differences: [] };
    const remote = await gw.current(link.subscriptionId);
    const differences: Array<{ key: string; kind: "item" | "one_off" | "currency"; expectedCents: number | null; stripeCents: number | null }> = [];
    if (remote?.currency && remote.currency.toUpperCase() !== plan.currency.toUpperCase()) differences.push({ key: "moneda", kind: "currency", expectedCents: null, stripeCents: null });
    for (const i of plan.items) {
      const r = remote?.items.find((x) => x.key === i.key);
      if (!r || r.amountCents !== i.amountCents || r.interval !== i.interval || r.taxRateBp !== i.taxRateBp) differences.push({ key: i.key, kind: "item", expectedCents: i.amountCents, stripeCents: r?.amountCents ?? null });
    }
    for (const r of remote?.items ?? []) if (!plan.items.some((i) => i.key === r.key)) differences.push({ key: r.key ?? "(sin clave)", kind: "item", expectedCents: null, stripeCents: r.amountCents });
    // Importes únicos vencidos: deben estar en Stripe y por su importe
    for (const o of plan.oneOffs.filter((x) => x.due)) {
      const f = await gw.findOneOff(link.subscriptionId, o.key);
      if (!f || f.amountCents !== o.amountCents) differences.push({ key: o.key, kind: "one_off", expectedCents: o.amountCents, stripeCents: f?.amountCents ?? null });
    }
    return { available: true as const, plan, syncStatus: current?.syncStatus ?? "none", consistent: differences.length === 0, differences };
  }
}

/** `/cp/v1/subscriptions/:id/terms/billing…`: plan de cobro y conciliación (lectura) y sincronización (gestión de precios). */
export function createTermsBillingRouter(svc: TermsBillingService): Router {
  const r = express.Router();
  const id = z.coerce.number().int().positive();
  const wrap = (fn: (req: Request, res: Response) => Promise<void>) => (req: Request, res: Response) =>
    fn(req, res).catch((e) => {
      if (e instanceof TermsError) return void res.status(e.code === "not_found" ? 404 : e.code === "invalid_input" ? 400 : 409).json({ error: e.code, message: e.message });
      if (e instanceof z.ZodError) return void res.status(400).json({ error: "invalid_request", message: "Petición no válida" });
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
