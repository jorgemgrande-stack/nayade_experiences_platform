/**
 * Cobro en Stripe de unas condiciones comerciales personalizadas (fase 4). APAGADO por defecto.
 *
 * El importe negociado es la fuente económica efectiva: lo que se envía a Stripe son las partidas YA materializadas en
 * la suscripción (las mismas que factura la simulación), con su importe neto del periodo y su tipo de impuesto.
 *  - No se tocan los Products ni los Prices oficiales de Stripe que usan otros clientes, ni se crean productos públicos
 *    por cada negociación: las partidas viajan como precio en línea de ESA suscripción (`NegotiatedBillingGateway`).
 *  - Idempotencia: cada paso lleva su clave estable; repetir una sincronización (o reintentarla tras un fallo de red,
 *    incluso si Stripe sí llegó a aplicar el paso) no duplica cargos ni abonos.
 *  - Fallos parciales: se guarda qué pasos se completaron; el reintento continúa por donde se quedó.
 *  - Errores y reintentos quedan en el historial del acuerdo (`sync_status`, `sync_detail` y eventos `sync`).
 *
 * Tres cerrojos, todos necesarios para que salga una sola llamada: el interruptor (`enabled`), que exista una pasarela
 * validada (hoy solo el doble de pruebas: el adaptador real se escribe y valida en Stripe Sandbox) y que la suscripción
 * esté enlazada a una suscripción de Stripe. Sin los tres, la suscripción sigue en simulación de facturación.
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
import type { TermsRecord, TermsStore } from "./store";

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
  /** Lo que la suscripción tiene ahora en Stripe (para conciliar). */
  current(subscriptionId: string): Promise<{ items: Array<{ key: string | null; amountCents: number; interval: "month" | "year"; taxRateBp: number | null }> } | null>;
}

export interface BillingLink {
  customerId: string;
  subscriptionId: string;
}

export interface BillingPlan {
  termsId: number;
  subscriptionId: number;
  currency: string;
  items: NegotiatedItem[];
  /** Importes únicos ya vencidos (se envían) y los que aún no han llegado (se enviarán en su fecha). */
  oneOffs: Array<NegotiatedOneOff & { at: number; due: boolean }>;
  recurringNetCents: number;
}

type StepState = { status: "done"; ref: string; at: number };
interface SyncDetail {
  revision: number;
  steps: Record<string, StepState>;
  attempts: number;
  lastError: string | null;
  lastAttemptAt: number | null;
  pendingOneOffs: string[];
}

export type SyncOutcome =
  | { status: "disabled" | "unsupported" | "not_linked"; message: string }
  | { status: "synced"; steps: number; skipped: number; pendingOneOffs: string[] }
  | { status: "failed"; error: string; completed: number; remaining: number };

const live = (i: SubscriptionItem, at: number) => i.effectiveFrom <= at && (i.effectiveTo === null || i.effectiveTo > at);
const voided = (i: SubscriptionItem) => i.effectiveTo !== null && i.effectiveTo <= i.effectiveFrom;

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
      termsStore: TermsStore;
      subscriptionStore: Pick<SubscriptionStore, "get" | "items">;
      now?: () => number;
    },
  ) {
    this.now = d.now ?? Date.now;
  }

  private async terms(id: number): Promise<TermsRecord & { subscriptionId: number }> {
    const t = await this.d.termsStore.get(id);
    if (!t) throw new TermsError("not_found", "Condiciones no encontradas");
    if (t.subscriptionId === null || (t.status !== "active" && t.status !== "scheduled")) throw new TermsError("invalid_state", "Solo se cobran unas condiciones activadas");
    return t as TermsRecord & { subscriptionId: number };
  }

  /** Qué se cobraría: las partidas materializadas del acuerdo, tal como las factura la simulación. No llama a Stripe. */
  async plan(termsId: number): Promise<BillingPlan> {
    const t = await this.terms(termsId);
    const now = this.now();
    const sub = await this.d.subscriptionStore.get(t.subscriptionId);
    if (!sub) throw new TermsError("not_found", "Suscripción no encontrada");
    const own = (await this.d.subscriptionStore.items(t.subscriptionId)).filter((i) => i.termsId === t.id && !voided(i));
    const items: NegotiatedItem[] = own
      .filter((i) => recurringPrice(i.priceKind) && live(i, Math.max(now, t.effectiveFrom ?? 0)))
      .map((i) => ({ key: i.productKey, name: i.productName, product: i.productKey.startsWith("custom:") ? ({ kind: "custom" } as const) : ({ kind: "catalog", productKey: i.productKey } as const), amountCents: i.lineAmountCents ?? i.unitAmountCents * i.quantity, interval: i.priceKind === "yearly" ? ("year" as const) : ("month" as const), taxRateBp: i.taxRateBp }));
    const oneOffs = own
      .filter((i) => i.priceKind === "one_time")
      .map((i) => ({ key: `${i.termsLineId != null ? "charge" : "credit"}:${i.id}`, name: i.productName, amountCents: i.lineAmountCents ?? i.unitAmountCents * i.quantity, taxRateBp: i.taxRateBp, at: i.effectiveFrom, due: i.effectiveFrom <= now }));
    return { termsId: t.id, subscriptionId: t.subscriptionId, currency: sub.currency, items, oneOffs, recurringNetCents: items.reduce((a, i) => a + i.amountCents, 0) };
  }

  private async record(t: TermsRecord, status: "synced" | "failed", detail: SyncDetail, actor: string, message: string) {
    await this.d.termsStore.patch(
      t.id,
      { syncStatus: status, syncDetail: detail },
      { kind: "sync", actor, reason: message.slice(0, 500), before: { syncStatus: t.syncStatus }, after: { syncStatus: status, attempts: detail.attempts, steps: Object.keys(detail.steps).length, pendingOneOffs: detail.pendingOneOffs }, effectiveAt: t.effectiveFrom, acceptanceStatus: t.acceptanceStatus, syncResult: status, economic: null },
      this.now(),
    );
  }

  /**
   * Envía a Stripe las partidas pactadas y los importes únicos vencidos. Con el interruptor apagado, sin pasarela
   * validada o sin enlace con Stripe no hace NINGUNA llamada ni cambia nada. Repetirla es seguro.
   */
  async sync(termsId: number, actor: string): Promise<SyncOutcome> {
    if (!this.d.enabled) return { status: "disabled", message: "El cobro en Stripe de condiciones personalizadas está apagado: la suscripción sigue en simulación de facturación" };
    if (!this.d.gateway) return { status: "unsupported", message: "No hay una pasarela de Stripe validada para condiciones personalizadas (pendiente de la validación en Stripe Sandbox)" };
    const t = await this.terms(termsId);
    const link = this.d.link ? await this.d.link(t.subscriptionId) : null;
    if (!link) return { status: "not_linked", message: "Esta suscripción no se cobra en Stripe: sigue en simulación de facturación" };
    const plan = await this.plan(termsId);
    const prev = (t.syncDetail ?? null) as SyncDetail | null;
    const detail: SyncDetail = { revision: t.revision, steps: { ...(prev?.steps ?? {}) }, attempts: (prev?.attempts ?? 0) + 1, lastError: null, lastAttemptAt: this.now(), pendingOneOffs: plan.oneOffs.filter((o) => !o.due).map((o) => o.key) };
    const metadata = { es_terms: String(t.id), es_subscription: String(t.subscriptionId) };
    // Claves estables: las partidas, por su contenido (otro contenido es otra operación); cada importe único, por su partida
    const steps: Array<{ key: string; run: () => Promise<{ ref: string }> }> = [
      { key: `ct:${t.id}:items:${stableHash(plan.items).slice(0, 24)}`, run: () => this.d.gateway!.applyItems({ subscriptionId: link.subscriptionId, currency: plan.currency, items: plan.items, metadata }, `ct:${t.id}:items:${stableHash(plan.items).slice(0, 24)}`) },
      ...plan.oneOffs.filter((o) => o.due).map((o) => ({ key: `ct:${t.id}:${o.key}`, run: () => this.d.gateway!.addOneOff({ subscriptionId: link.subscriptionId, customerId: link.customerId, currency: plan.currency, item: { key: o.key, name: o.name, amountCents: o.amountCents, taxRateBp: o.taxRateBp }, metadata }, `ct:${t.id}:${o.key}`) })),
    ];
    let done = 0;
    let skipped = 0;
    for (const s of steps) {
      if (detail.steps[s.key]) {
        skipped++;
        continue;
      }
      try {
        const out = await s.run();
        detail.steps[s.key] = { status: "done", ref: out.ref, at: this.now() };
        done++;
      } catch (e) {
        const error = (e instanceof Error ? e.message : "error").slice(0, 300);
        detail.lastError = error;
        opsLog("warn", "CommercialTerms", "billing_sync_failed", { termsId: t.id, step: s.key.split(":")[2] ?? "paso" });
        await this.record(t, "failed", detail, actor, `Sincronización con Stripe fallida: ${error}`);
        return { status: "failed", error, completed: done + skipped, remaining: steps.length - done - skipped };
      }
    }
    await this.record(t, "synced", detail, actor, done ? "Condiciones sincronizadas con Stripe" : "Sincronización con Stripe sin cambios");
    return { status: "synced", steps: done, skipped, pendingOneOffs: detail.pendingOneOffs };
  }

  /** Consistencia entre lo pactado y lo que Stripe tiene: diferencias por partida. Solo lectura. */
  async reconcile(termsId: number) {
    const plan = await this.plan(termsId);
    const t = await this.terms(termsId);
    const link = this.d.enabled && this.d.gateway && this.d.link ? await this.d.link(t.subscriptionId) : null;
    if (!link || !this.d.gateway) return { available: false as const, plan, syncStatus: t.syncStatus, differences: [] };
    const remote = await this.d.gateway.current(link.subscriptionId);
    const differences: Array<{ key: string; expectedCents: number | null; stripeCents: number | null }> = [];
    for (const i of plan.items) {
      const r = remote?.items.find((x) => x.key === i.key);
      if (!r || r.amountCents !== i.amountCents || r.interval !== i.interval || (r.taxRateBp !== null && r.taxRateBp !== i.taxRateBp)) differences.push({ key: i.key, expectedCents: i.amountCents, stripeCents: r?.amountCents ?? null });
    }
    for (const r of remote?.items ?? []) if (!plan.items.some((i) => i.key === r.key)) differences.push({ key: r.key ?? "(sin clave)", expectedCents: null, stripeCents: r.amountCents });
    return { available: true as const, plan, syncStatus: t.syncStatus, consistent: differences.length === 0, differences };
  }
}

/** `/cp/v1/commercial-terms/:id/billing…`: plan de cobro y conciliación (lectura) y sincronización (gestión de precios). */
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
  r.get("/commercial-terms/:id/billing", requireScope("subscriptions:read"), wrap(async (req, res) => void res.json(await svc.reconcile(id.parse(req.params.id)))));
  r.post("/commercial-terms/:id/billing/sync", requireCustomPricing(), wrap(async (req, res) => {
    const a = getAuth(req)!.actor;
    res.json(await svc.sync(id.parse(req.params.id), `${a.type}:${a.id}`));
  }));
  return r;
}
