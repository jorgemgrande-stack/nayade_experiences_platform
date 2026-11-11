/**
 * Licencias de una suscripción con condiciones comerciales personalizadas: se aplican SOLAS cuando el acuerdo entra
 * en vigor (activación directa o aceptación del cliente) y cuando la empresa recibe su plataforma después.
 *
 * - Los derechos salen de los PRODUCTOS de catálogo de las partidas vigentes, nunca del importe: los calcula y aplica
 *   el servicio de licencias de siempre (`LicensingService`), con origen `subscription:<id>`. Una partida a medida no
 *   existe en el catálogo y no concede nada. Las licencias de otro origen (derechos adquiridos, operador, otras
 *   suscripciones) no se tocan.
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
import type { LicensingService } from "../licensing/service";
import type { SubscriptionService } from "../subscriptions/service";
import type { SubscriptionStore } from "../subscriptions/store";
import { requireCustomPricing } from "./permission";
import { TermsError } from "./service";
import type { TermsEventDraft, TermsStore } from "./store";

export type LicenceOutcome =
  | { status: "not_applicable" | "manual"; message: string }
  | { status: "pending_tenant"; message: string }
  | { status: "applied"; tenantId: string; linked: boolean; changed: number; capabilities: string[] }
  | { status: "failed"; tenantId: string | null; error: string };

const LICENCE_EVENTS = ["licences_applied", "licences_pending", "licences_failed"];

export class TermsLicences {
  private now: () => number;
  constructor(
    private d: {
      /** Aplicación automática (por defecto, sí). */
      auto: boolean;
      licensing: Pick<LicensingService, "preview" | "apply">;
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

  private async last(termsId: number) {
    return (await this.d.termsStore.events({ termsId })).filter((e) => LICENCE_EVENTS.includes(e.kind)).pop() ?? null;
  }

  /**
   * Deja aplicadas las licencias de la suscripción. `force`: a mano desde el CRM (también con la automática apagada).
   * `changed`: lo contratado acaba de cambiar (se aplica aunque la última vez constara aplicado). Nunca lanza por un
   * fallo de la propagación: lo registra y devuelve `failed`.
   */
  async ensure(subscriptionId: number, actor: string, o: { force?: boolean; changed?: boolean } = {}): Promise<LicenceOutcome> {
    const sub = await this.d.subscriptionStore.get(subscriptionId);
    if (!sub) throw new TermsError("not_found", "Suscripción no encontrada");
    const termsId = await this.owner(subscriptionId);
    if (termsId === null) return { status: "not_applicable", message: "La suscripción no tiene condiciones comerciales personalizadas vigentes" };
    if (!this.d.auto && !o.force) return { status: "manual", message: "La aplicación automática de licencias está apagada: aplícalas desde el CRM" };
    const last = await this.last(termsId);
    // Sin plataforma no hay dónde aplicar: la de la suscripción o, si no tiene, la de su empresa
    const companyTenant = sub.tenantId ? null : await this.d.companyTenant(sub.companyId).catch(() => null);
    const tenantId = sub.tenantId ?? companyTenant;
    if (!tenantId) {
      const message = "La empresa todavía no tiene plataforma: las licencias se aplicarán al darla de alta";
      if (last?.kind !== "licences_pending") await this.d.termsStore.log(termsId, this.event("licences_pending", actor, message, { subscriptionId }, "pending"), this.now());
      return { status: "pending_tenant", message };
    }
    // Ya aplicadas y nada ha cambiado: no se repite (sí a mano, tras un cambio o tras un fallo)
    if (!o.force && !o.changed && sub.tenantId && last?.kind === "licences_applied") return { status: "applied", tenantId, linked: false, changed: 0, capabilities: [] };
    try {
      let linked = false;
      if (!sub.tenantId) {
        await this.d.subscriptions.linkTenant(subscriptionId, { tenantId, reason: "Plataforma de la empresa" }, actor);
        linked = true;
      }
      const out = await this.d.licensing.apply(subscriptionId, { activate: true, actor, reason: `Licencias de las condiciones comerciales personalizadas #${termsId}` });
      const capabilities = out.changes.filter((c) => c.status === "active").map((c) => c.capabilityId).sort();
      if (out.applied.length || linked || last?.kind !== "licences_applied") {
        await this.d.termsStore.log(termsId, this.event("licences_applied", actor, linked ? "Plataforma enlazada y licencias aplicadas" : "Licencias aplicadas", { subscriptionId, tenantId, linked, changed: out.applied.length, capabilities }, "applied"), this.now());
      }
      return { status: "applied", tenantId, linked, changed: out.applied.length, capabilities };
    } catch (e) {
      const error = (e instanceof Error ? e.message : "error").slice(0, 300);
      opsLog("warn", "CommercialTerms", "licences_failed", { subscriptionId });
      await this.d.termsStore.log(termsId, this.event("licences_failed", actor, `No se pudieron aplicar las licencias: ${error}`, { subscriptionId, tenantId }, "failed"), this.now()).catch(() => undefined);
      return { status: "failed", tenantId, error };
    }
  }

  /** Tras cambiar lo contratado (activación, aceptación, fin de una condición temporal). Nunca lanza. */
  async afterChange(subscriptionId: number, actor = "system:terms-licences"): Promise<LicenceOutcome | null> {
    return this.ensure(subscriptionId, actor, { changed: true }).catch(() => null);
  }

  /** Pendientes o fallidas: se reintentan cuando hay ocasión (antes de calcular la facturación). Nunca lanza. */
  async retryIfPending(subscriptionId: number, actor = "system:terms-licences"): Promise<void> {
    if (!this.d.auto) return;
    try {
      const termsId = await this.owner(subscriptionId);
      if (termsId === null) return;
      const last = await this.last(termsId);
      if (last && last.kind === "licences_applied") {
        // Aplicadas: solo se repite si desde entonces ha entrado o salido alguna partida por FECHA (un acuerdo
        // programado que empieza, una partida con fin propio, el fin de una condición temporal)
        const now = this.now();
        const crossed = (await this.d.subscriptionStore.items(subscriptionId)).some((i) => i.termsId != null && [i.effectiveFrom, i.effectiveTo].some((b) => b !== null && b > last.createdAt && b <= now));
        if (!crossed) return;
        await this.ensure(subscriptionId, actor, { changed: true });
        return;
      }
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

  /** Estado para el CRM: plataforma, licencias que corresponden y último resultado. Solo lectura. */
  async status(subscriptionId: number) {
    const sub = await this.d.subscriptionStore.get(subscriptionId);
    if (!sub) throw new TermsError("not_found", "Suscripción no encontrada");
    const termsId = await this.owner(subscriptionId);
    const tenantId = sub.tenantId ?? (await this.d.companyTenant(sub.companyId).catch(() => null));
    const last = termsId !== null ? await this.last(termsId) : null;
    let plan: { capabilities: string[]; pending: number } | null = null;
    if (tenantId && sub.tenantId) {
      const p = await this.d.licensing.preview(subscriptionId, { activate: true }).catch(() => null);
      if (p) plan = { capabilities: Array.from(new Set([...p.current.filter((g) => g.source === p.source && g.status === "active").map((g) => g.capabilityId), ...p.changes.filter((c) => c.status === "active").map((c) => c.capabilityId)])).sort(), pending: p.changes.length };
    }
    return {
      automatic: this.d.auto,
      termsId,
      tenantId,
      linked: !!sub.tenantId,
      last: last ? { kind: last.kind, at: last.createdAt, actor: last.actor, message: last.reason, detail: last.after } : null,
      plan,
      note: "Las licencias salen de los productos del catálogo incluidos en el acuerdo, no del importe. Una partida a medida no concede ninguna.",
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
