/**
 * Licencias de una suscripción con condiciones comerciales personalizadas: se aplican SOLAS cuando el acuerdo entra
 * en vigor (activación directa o aceptación del cliente) y cuando la empresa recibe su plataforma después.
 *
 * - Los derechos salen de los PRODUCTOS de catálogo de las partidas vigentes, nunca del importe: los calcula el
 *   servicio de licencias de siempre (`LicensingService.preview`), con origen `subscription:<id>`. Una partida a medida
 *   no existe en el catálogo y no concede nada.
 * - Aplicación RESTRINGIDA (más prudente que el «Aplicar licencias» manual de la ficha): solo da de ALTA capacidades
 *   que la empresa no tiene (o propias ya canceladas), da de BAJA las propias que ya no corresponden y ajusta la
 *   caducidad de las propias activas. NUNCA reactiva una licencia suspendida o en solo lectura (impago, bloqueo de un
 *   operador), NUNCA toca una licencia de otro origen (derechos adquiridos, operador, otra suscripción) aunque sea de
 *   la misma capacidad. Lo que no puede aplicar queda anotado para un operador.
 * - LÍMITES Y CUPOS (usuarios, sedes, almacenamiento): se fijan a la vez que las capacidades, con el mismo cálculo que
 *   las licencias de cualquier suscripción (`LicensingService.limitsFor`): lo incluido en el PLAN vigente del acuerdo
 *   (con su herencia) más las AMPLIACIONES vigentes (unidades × paso de cada complemento). Tampoco aquí interviene el
 *   importe. Se escriben con origen `subscription:<id>` y un evento `entitlement.limit_changed` por cambio. Si OTRO
 *   acuerdo sustituye al vigente sin una ampliación, el límite baja con ella; si el acuerdo simplemente termina sin
 *   partidas posteriores, no hay nada que aplicar y los límites se quedan como estaban. Un límite que hoy pertenece a
 *   OTRA suscripción viva de la empresa (o a otro origen) no se toca, y tampoco se escribe uno sin dueño si hay otra
 *   suscripción viva (también en prueba) en la misma plataforma: queda anotado. Las excepciones de cupo de un operador
 *   viven aparte y siguen por encima del límite contratado: no se pisan.
 * - Una suscripción EN PRUEBA no se toca: sus licencias las gobierna el circuito de la prueba gratuita.
 * - Nunca retroactivo: un acuerdo activado antes de existir esta función no recibe nada solo (sí al dar de alta la
 *   plataforma de su empresa o a mano). Única excepción, la PUESTA AL DÍA de los límites: una suscripción cuyas
 *   licencias ya aplicó esta función antes de que fijara los límites los recibe una sola vez en la siguiente ocasión.
 * - Idempotente: repetirlo no cambia nada si ya está aplicado.
 * - Sin plataforma no hay dónde aplicar: queda «pendiente de plataforma» en el historial y se aplica al enlazarla. La
 *   suscripción toma la plataforma de SU empresa (enlace auditable en su historial).
 * - Si la aplicación falla, queda registrado y se reintenta en la siguiente ocasión (o a mano desde el CRM).
 * - Los cambios que dependen solo de la FECHA (un acuerdo programado que empieza, una partida con fin propio) se
 *   aplican en la siguiente ocasión en que se calcula la facturación de la suscripción; no hay todavía una tarea
 *   periódica que lo haga a la hora exacta.
 * - No toca Stripe ni cobra nada.
 *
 * Interruptor: la aplicación AUTOMÁTICA viene encendida y se apaga con `CP_CUSTOM_TERMS_AUTO_LICENCES=0`. Apagada, el
 * enlace de la plataforma y la aplicación siguen disponibles a mano.
 */
import express, { type Request, type Response, type Router } from "express";
import { z } from "zod";
import { getAuth, requireScope } from "../controlPlane/auth";
import { opsLog } from "../_core/ops/log";
import type { CapabilityChange, CapabilityStore } from "../_core/capabilities/store";
import type { LimitChange, LimitMetric, TenantLimitReader } from "../_core/limits/store";
import type { LicencePlan, LicensingService } from "../licensing/service";
import type { SubscriptionService } from "../subscriptions/service";
import type { SubscriptionStore } from "../subscriptions/store";
import { requireCustomPricing } from "./permission";
import { TermsError } from "./service";
import type { TermsEventDraft, TermsStore } from "./store";

export type LicenceOutcome =
  | { status: "not_applicable" | "manual"; message: string }
  | { status: "pending_tenant"; message: string }
  | { status: "applied"; tenantId: string; linked: boolean; changed: number; capabilities: string[]; skipped: SkippedCapability[]; /** Límites que han cambiado en esta aplicación. */ limits: LimitChange[]; limitsSkipped: SkippedLimit[] }
  | { status: "failed"; tenantId: string | null; error: string };

type SkippedCapability = { capabilityId: string; why: "other_source" | "suspended" | "read_only" };
/** `other_source`: la fila es de otra suscripción viva o de otro origen. `other_subscription`: sin fila propia y hay otra suscripción viva en la plataforma. */
type SkippedLimit = { metric: LimitMetric; why: "other_source" | "other_subscription" };
type ContractedLimit = { metric: LimitMetric; limit: number | null };
const METRIC_LABEL: Record<LimitMetric, string> = { users: "usuarios", sites: "sedes", storage_gb: "almacenamiento (GB)" };
/** El resultado ya registra los límites (los acuerdos aplicados antes de que la automática los fijara, no). */
const recordsLimits = (after: unknown) => !!after && typeof after === "object" && "limits" in after;

const LICENCE_EVENTS = ["licences_applied", "licences_pending", "licences_failed"];

export class TermsLicences {
  private now: () => number;
  constructor(
    private d: {
      /** Aplicación automática (por defecto, sí). */
      auto: boolean;
      licensing: Pick<LicensingService, "preview" | "limitsFor" | "applyLimits">;
      /** Límites vigentes de la empresa (registro 0013): sin él, los límites no se tocan (solo capacidades). */
      limits?: Pick<TenantLimitReader, "limits">;
      /** Registro de licencias: solo para escribir los cambios permitidos. */
      capabilities: Pick<CapabilityStore, "apply">;
      subscriptions: Pick<SubscriptionService, "linkTenant">;
      subscriptionStore: Pick<SubscriptionStore, "get" | "items" | "list">;
      termsStore: Pick<TermsStore, "events" | "log">;
      /** Plataforma de la empresa (la del CRM), si ya la tiene. */
      companyTenant: (companyId: number) => Promise<string | null>;
      now?: () => number;
    },
  ) {
    this.now = d.now ?? Date.now;
  }

  /** Acuerdo del que salen las partidas vigentes (o programadas) de la suscripción; null si no tiene condiciones personalizadas. */
  private async owner(subscriptionId: number): Promise<number | null> {
    const now = this.now();
    const live = (await this.d.subscriptionStore.items(subscriptionId)).filter((i) => i.termsId != null && (i.effectiveTo === null || (i.effectiveTo > now && i.effectiveTo > i.effectiveFrom)));
    const current = live.filter((i) => i.effectiveFrom <= now);
    return (current.length ? current : live).map((i) => i.termsId!).sort((a, b) => b - a)[0] ?? null;
  }

  private event(kind: string, actor: string, reason: string, after: unknown, result: string): TermsEventDraft {
    return { kind, actor, reason: reason.slice(0, 500), before: null, after, effectiveAt: null, acceptanceStatus: null, syncResult: result, economic: null };
  }

  /** Qué cambios de capacidades es seguro aplicar sin una persona delante, y cuáles se dejan sin tocar. */
  private sift(plan: LicencePlan) {
    const safe: CapabilityChange[] = [];
    const skipped: SkippedCapability[] = [];
    for (const c of plan.changes) {
      const cur = plan.current.find((g) => g.capabilityId === c.capabilityId && g.siteId === c.siteId);
      if (!cur) {
        // Alta de una capacidad que la empresa no tiene
        if (c.status !== "cancelled") safe.push(c);
      } else if (cur.source !== plan.source) {
        // De otro origen (derechos adquiridos, operador, otra suscripción): no se toca ni se cambia de dueño
        if (c.status !== "cancelled") skipped.push({ capabilityId: c.capabilityId, why: "other_source" });
      } else if (c.status === "cancelled") {
        // Propia que ya no corresponde: baja
        safe.push(c);
      } else if (cur.status === "suspended" || cur.status === "read_only") {
        // Bloqueada por impago, vencimiento o un operador: nunca se reactiva sola
        skipped.push({ capabilityId: c.capabilityId, why: cur.status });
      } else {
        // Propia activa (cambia la caducidad) o propia cancelada que vuelve a corresponder
        safe.push(c);
      }
    }
    return { safe, skipped };
  }

  /**
   * Límites que corresponden a la suscripción (plan + ampliaciones vigentes) frente a los que tiene hoy la empresa.
   * `mine`: métricas que esta suscripción puede fijar (propias; o sin fila o de una suscripción ya cancelada o
   * inexistente, siempre que no haya OTRA suscripción viva de la empresa en la misma plataforma); `pending`: las de
   * `mine` cuyo valor cambiaría; `skipped`: las que pertenecen a otra suscripción viva o a otro origen y tienen otro
   * valor (`other_source`) y las que no tienen dueño habiendo otra suscripción viva en la plataforma
   * (`other_subscription`). null sin registro de límites. Solo lectura.
   */
  private async limitPlan(subscriptionId: number, tenantId: string): Promise<{ contracted: ContractedLimit[]; mine: LimitMetric[]; pending: ContractedLimit[]; skipped: SkippedLimit[] } | null> {
    if (!this.d.limits) return null;
    const own = `subscription:${subscriptionId}`;
    const contracted = await this.d.licensing.limitsFor(subscriptionId);
    const rows = await this.d.limits.limits(tenantId);
    const mine: LimitMetric[] = [];
    const pending: ContractedLimit[] = [];
    const skipped: SkippedLimit[] = [];
    // Otra suscripción viva (también en prueba) de la empresa en la MISMA plataforma: aunque no haya escrito su fila
    // (sin fila, la empresa aplica lo incluido en su plan), una métrica sin dueño no se da por propia
    const sub = contracted.length ? await this.d.subscriptionStore.get(subscriptionId) : null;
    const sibling = sub ? (await this.d.subscriptionStore.list({ companyId: sub.companyId })).some((s) => s.id !== subscriptionId && s.status !== "canceled" && s.tenantId === tenantId) : false;
    for (const want of contracted) {
      const cur = rows.find((r) => r.metric === want.metric);
      if (cur && cur.source !== own) {
        const other = /^subscription:(\d+)$/.exec(cur.source);
        const otherSub = other ? await this.d.subscriptionStore.get(Number(other[1])) : null;
        // De otra suscripción viva o de otro origen: no se pisa. De una suscripción cancelada o que ya no existe, se releva
        if (!other || (otherSub && otherSub.status !== "canceled")) {
          if (cur.limit !== want.limit) skipped.push({ metric: want.metric, why: "other_source" });
          continue;
        }
      }
      if ((!cur || cur.source !== own) && sibling) {
        // Sin fila (o con la de una suscripción ya cancelada) y con otra suscripción viva en la plataforma: no se escribe
        if (!cur || cur.limit !== want.limit) skipped.push({ metric: want.metric, why: "other_subscription" });
        continue;
      }
      mine.push(want.metric);
      if (!cur || cur.limit !== want.limit) pending.push(want);
    }
    return { contracted, mine, pending, skipped };
  }

  /** Último resultado de licencias de la SUSCRIPCIÓN (de cualquiera de sus acuerdos: el vigente cambia con el tiempo). */
  private async last(subscriptionId: number) {
    return (await this.d.termsStore.events({ subscriptionId })).filter((e) => LICENCE_EVENTS.includes(e.kind)).pop() ?? null;
  }

  /**
   * Deja aplicadas las licencias (capacidades y límites) de la suscripción. `force`: a mano desde el CRM (también con la automática apagada).
   * `changed`: lo contratado acaba de cambiar (se aplica aunque la última vez constara aplicado). Nunca lanza por un
   * fallo de la propagación: lo registra y devuelve `failed`.
   */
  async ensure(subscriptionId: number, actor: string, o: { force?: boolean; changed?: boolean } = {}): Promise<LicenceOutcome> {
    const sub = await this.d.subscriptionStore.get(subscriptionId);
    if (!sub) throw new TermsError("not_found", "Suscripción no encontrada");
    const termsId = await this.owner(subscriptionId);
    if (termsId === null) return { status: "not_applicable", message: "La suscripción no tiene condiciones comerciales personalizadas vigentes" };
    if (!this.d.auto && !o.force) return { status: "manual", message: "La aplicación automática de licencias está apagada: aplícalas desde el CRM" };
    // Las licencias de una prueba gratuita las gobierna su propio circuito (caducidad, solo lectura al vencer)
    if (sub.status === "trialing") return { status: "manual", message: "La suscripción está en periodo de prueba: sus licencias las gobierna la prueba gratuita; se aplicarán las del acuerdo cuando termine la prueba" };
    if (sub.status === "canceled") return { status: "not_applicable", message: "La suscripción está cancelada" };
    const last = await this.last(subscriptionId);
    // Sin plataforma no hay dónde aplicar: la de la suscripción o, si no tiene, la de su empresa
    const companyTenant = sub.tenantId ? null : await this.d.companyTenant(sub.companyId).catch(() => null);
    const tenantId = sub.tenantId ?? companyTenant;
    if (!tenantId) {
      const message = "La empresa todavía no tiene plataforma: las licencias se aplicarán al darla de alta";
      if (last?.kind !== "licences_pending") await this.d.termsStore.log(termsId, this.event("licences_pending", actor, message, { subscriptionId }, "pending"), this.now());
      return { status: "pending_tenant", message };
    }
    // Ya aplicadas y nada ha cambiado: no se repite (sí a mano, tras un cambio o tras un fallo)
    if (!o.force && !o.changed && sub.tenantId && last?.kind === "licences_applied") return { status: "applied", tenantId, linked: false, changed: 0, capabilities: [], skipped: [], limits: [], limitsSkipped: [] };
    try {
      let linked = false;
      if (!sub.tenantId) {
        // Otra llamada simultánea pudo enlazarla ya: no es un fallo
        const fresh = await this.d.subscriptionStore.get(subscriptionId);
        if (!fresh?.tenantId) {
          await this.d.subscriptions.linkTenant(subscriptionId, { tenantId, reason: "Plataforma de la empresa" }, actor);
          linked = true;
        } else if (fresh.tenantId !== tenantId) throw new Error("La suscripción ya pertenece a otra plataforma");
      }
      const plan = await this.d.licensing.preview(subscriptionId, { activate: true });
      // Solo lo que es seguro aplicar sin una persona delante
      const { safe, skipped } = this.sift(plan);
      const applied = safe.length ? await this.d.capabilities.apply(plan.tenantId, safe, { actor, reason: `Licencias de las condiciones comerciales personalizadas #${termsId}`, now: this.now() }) : [];
      const capabilities = plan.changes.filter((c) => c.status === "active" && !skipped.some((s) => s.capabilityId === c.capabilityId)).map((c) => c.capabilityId).sort();
      // Límites y cupos: lo incluido en el plan + las ampliaciones vigentes del acuerdo (después de las capacidades,
      // como en las licencias de cualquier suscripción). Idempotente: sin cambios no escribe nada
      const lim = await this.limitPlan(subscriptionId, plan.tenantId);
      const limits = lim?.mine.length ? await this.d.licensing.applyLimits(subscriptionId, plan.tenantId, actor, { only: lim.mine }) : [];
      const limitsSkipped = lim?.skipped ?? [];
      // Se anota si algo ha cambiado, si es la primera vez o si el último resultado aún no registraba los límites
      if (applied.length || limits.length || linked || last?.kind !== "licences_applied" || (lim && !recordsLimits(last?.after))) {
        const message = [
          linked ? "Plataforma enlazada y licencias aplicadas" : "Licencias aplicadas",
          skipped.length ? ` (${skipped.length} sin tocar: de otro origen, suspendidas o en solo lectura)` : "",
          limits.length ? `; límites: ${limits.map((l) => `${METRIC_LABEL[l.metric]} ${l.to ?? "por contrato"}`).join(", ")}` : "",
          limitsSkipped.length ? `; límites sin tocar (de otra suscripción u otro origen): ${limitsSkipped.map((l) => METRIC_LABEL[l.metric]).join(", ")}` : "",
        ].join("");
        await this.d.termsStore.log(termsId, this.event("licences_applied", actor, message, { subscriptionId, tenantId, linked, changed: applied.length, capabilities, skipped, ...(lim ? { limits, limitsSkipped } : {}) }, "applied"), this.now());
      }
      return { status: "applied", tenantId, linked, changed: applied.length, capabilities, skipped, limits, limitsSkipped };
    } catch (e) {
      const error = (e instanceof Error ? e.message : "error").slice(0, 300);
      opsLog("warn", "CommercialTerms", "licences_failed", { subscriptionId });
      // Un fallo que se repite igual no llena el historial
      const message = `No se pudieron aplicar las licencias: ${error}`.slice(0, 500);
      if (!(last?.kind === "licences_failed" && last.reason === message)) await this.d.termsStore.log(termsId, this.event("licences_failed", actor, message, { subscriptionId, tenantId }, "failed"), this.now()).catch(() => undefined);
      return { status: "failed", tenantId, error };
    }
  }

  /** Tras cambiar lo contratado (activación, aceptación, fin de una condición temporal). Nunca lanza. */
  async afterChange(subscriptionId: number, actor = "system:terms-licences"): Promise<LicenceOutcome | null> {
    return this.ensure(subscriptionId, actor, { changed: true }).catch(() => null);
  }

  /**
   * Pendientes o fallidas: se reintentan cuando hay ocasión (al REGISTRAR la simulación de un periodo, nunca en una
   * consulta). Solo si esta función ya había intentado aplicarlas: un acuerdo anterior a ella no recibe nada solo.
   * Nunca lanza.
   */
  async retryIfPending(subscriptionId: number, actor = "system:terms-licences"): Promise<void> {
    if (!this.d.auto) return;
    try {
      const termsId = await this.owner(subscriptionId);
      if (termsId === null) return;
      const last = await this.last(subscriptionId);
      if (last && last.kind === "licences_applied") {
        // Aplicadas: solo se repite si desde entonces ha entrado o salido alguna partida por FECHA (un acuerdo
        // programado que empieza, una partida con fin propio, el fin de una condición temporal)
        const now = this.now();
        const crossed = (await this.d.subscriptionStore.items(subscriptionId)).some((i) => i.termsId != null && [i.effectiveFrom, i.effectiveTo].some((b) => b !== null && b > last.createdAt && b <= now));
        // …o si aquella aplicación es anterior a que la automática fijara los límites (se ponen al día una vez)
        if (!crossed && !(this.d.limits && !recordsLimits(last.after))) return;
        await this.ensure(subscriptionId, actor, { changed: true });
        return;
      }
      // Sin ningún intento previo no hay nada que reintentar (nunca retroactivo)
      if (!last) return;
      await this.ensure(subscriptionId, actor);
    } catch {
      // Se reintentará en la siguiente ocasión
    }
  }

  /** La empresa acaba de recibir su plataforma: se enlazan y aplican las suscripciones con condiciones personalizadas. */
  async companyOnboarded(companyId: number, actor = "system:terms-licences"): Promise<LicenceOutcome[]> {
    const out: LicenceOutcome[] = [];
    for (const s of (await this.d.subscriptionStore.list({ companyId })).filter((x) => x.status !== "canceled")) {
      const r = await this.ensure(s.id, actor, { changed: true }).catch(() => null);
      if (r && r.status !== "not_applicable") out.push(r);
    }
    return out;
  }

  /**
   * Estado para el CRM: plataforma, licencias y límites que corresponden y último resultado. Solo lectura.
   * `plan.pending` cuenta SOLO lo que la aplicación haría (capacidades y límites): tras aplicarse, 0. Lo que se deja
   * sin tocar a propósito (otro origen, suspendidas) va aparte en `plan.skipped` y `plan.limits.skipped`.
   */
  async status(subscriptionId: number) {
    const sub = await this.d.subscriptionStore.get(subscriptionId);
    if (!sub) throw new TermsError("not_found", "Suscripción no encontrada");
    const termsId = await this.owner(subscriptionId);
    const tenantId = sub.tenantId ?? (await this.d.companyTenant(sub.companyId).catch(() => null));
    const last = termsId !== null ? await this.last(subscriptionId) : null;
    let plan: { capabilities: string[]; pending: number; skipped: SkippedCapability[]; limits: { contracted: ContractedLimit[]; pending: ContractedLimit[]; skipped: SkippedLimit[] } | null } | null = null;
    if (tenantId && sub.tenantId) {
      const p = await this.d.licensing.preview(subscriptionId, { activate: true }).catch(() => null);
      if (p) {
        const { safe, skipped } = this.sift(p);
        const lim = await this.limitPlan(subscriptionId, p.tenantId).catch(() => null);
        plan = {
          capabilities: Array.from(new Set([...p.current.filter((g) => g.source === p.source && g.status === "active").map((g) => g.capabilityId), ...p.changes.filter((c) => c.status === "active").map((c) => c.capabilityId)])).sort(),
          pending: safe.length + (lim?.pending.length ?? 0),
          skipped,
          limits: lim ? { contracted: lim.contracted, pending: lim.pending, skipped: lim.skipped } : null,
        };
      }
    }
    return {
      automatic: this.d.auto,
      termsId,
      tenantId,
      linked: !!sub.tenantId,
      last: last ? { kind: last.kind, at: last.createdAt, actor: last.actor, message: last.reason, detail: last.after } : null,
      plan,
      note: "Las licencias y los límites (usuarios, sedes, almacenamiento) salen de los productos del catálogo incluidos en el acuerdo y de sus unidades, no del importe. Una partida a medida no concede nada.",
    };
  }
}

/** `/cp/v1/subscriptions/:id/terms/licences…`: estado (lectura) y aplicación a mano (gestión de precios + licencias). */
export function createTermsLicencesRouter(svc: TermsLicences): Router {
  const r = express.Router();
  const id = z.coerce.number().int().positive();
  const wrap = (fn: (req: Request, res: Response) => Promise<void>) => (req: Request, res: Response) =>
    fn(req, res).catch((e) => {
      if (e instanceof TermsError) return void res.status(e.code === "not_found" ? 404 : e.code === "invalid_input" ? 400 : 409).json({ error: e.code, message: e.message });
      if (e instanceof z.ZodError) return void res.status(400).json({ error: "invalid_request", message: "Petición no válida" });
      opsLog("error", "CommercialTerms", "licences_error", { error: e instanceof Error ? e.name : "error" });
      res.status(500).json({ error: "internal_error", message: "Error interno" });
    });
  r.get("/subscriptions/:id/terms/licences", requireScope("subscriptions:read"), wrap(async (req, res) => void res.json(await svc.status(id.parse(req.params.id)))));
  r.post("/subscriptions/:id/terms/licences/apply", requireCustomPricing(), requireScope("entitlements:write"), wrap(async (req, res) => {
    const a = getAuth(req)!.actor;
    res.json(await svc.ensure(id.parse(req.params.id), `${a.type}:${a.id}`, { force: true }));
  }));
  return r;
}
