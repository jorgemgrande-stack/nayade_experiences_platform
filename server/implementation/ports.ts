/**
 * Puertos de la implantación asistida sobre los servicios existentes (sin duplicarlos):
 *  - inicio: suscripción del contrato (modo sombra: sin cargos reales) con prueba o sin ella, y sus licencias;
 *  - solución: nombre, estado comercial y modalidad de la oferta (`catalog.offer`, si ya existe) del catálogo publicado.
 */
import type { CatalogPort } from "../subscriptions/ports";
import type { ItemSpec, SubscriptionService } from "../subscriptions/service";
import type { LicensingService } from "../licensing/service";
import type { WebStore } from "../web/store";
import type { SolutionInfo, StartPort } from "./service";

const DAY = 86_400_000;

export function subscriptionStarter(d: {
  subscriptions: Pick<SubscriptionService, "create" | "list">;
  licensing: Pick<LicensingService, "apply">;
  catalog: Pick<CatalogPort, "offer">;
}): StartPort {
  const priceFor = async (key: string, interval: "month" | "year", core: boolean) => {
    const p = (await d.catalog.offer()).find((x) => x.key === key);
    if (!p) throw new Error(`«${key}» no está publicado en el catálogo`);
    const prefer = p.family === "service" ? ["one_time"] : core ? [interval === "year" ? "yearly" : "monthly"] : interval === "year" ? ["yearly", "monthly"] : ["monthly"];
    for (const k of prefer) {
      const price = p.prices.find((x) => x.kind === k && x.status === "approved");
      if (price) return price.id;
    }
    throw new Error(`«${p.name}» no tiene precio aprobado para esa periodicidad`);
  };
  return {
    async start({ companyId, contract, tenantId, solutionKey, trialDays, reason }, actor) {
      // Idempotente: la suscripción viva de este contrato se reutiliza (nunca dos por contrato)
      let sub = (await d.subscriptions.list({ companyId })).find((s) => s.status !== "canceled" && s.contractId === contract.id);
      if (!sub) {
        const cfg = contract.configuration?.request;
        const planKey = cfg?.plan ?? contract.planId;
        if (!planKey) throw new Error("El contrato no tiene plan");
        const interval = cfg?.interval ?? (contract.billingInterval === "year" ? "year" : "month");
        const plan: ItemSpec = { productKey: planKey, priceId: await priceFor(planKey, interval, true) };
        const addons: ItemSpec[] = [];
        for (const i of cfg?.items ?? []) addons.push({ productKey: i.key, priceId: await priceFor(i.key, interval, false), ...(i.quantity ? { quantity: i.quantity } : {}) });
        // Sin configuración cotizada, la solución implantada entra como complemento (si es un producto con precio aprobado)
        if (!cfg && solutionKey !== planKey) {
          const p = (await d.catalog.offer()).find((x) => x.key === solutionKey);
          if (p && p.family !== "core_plan") addons.push({ productKey: solutionKey, priceId: await priceFor(solutionKey, interval, false) });
        }
        sub = await d.subscriptions.create({ companyId, contractId: contract.id, tenantId, interval, plan, addons, trialDays, reason }, actor);
      }
      await d.licensing.apply(sub.id, { activate: true, actor, reason });
      return { subscriptionId: sub.id, trialEndsAt: sub.trialEnd ?? (trialDays > 0 ? Date.now() + trialDays * DAY : null) };
    },
  };
}

/** Solución del catálogo publicado. Tolera que `catalog.offer` (modalidad inmediata o asistida) aún no exista. */
export function solutionFromWebStore(store: Pick<WebStore, "getEntry">): (key: string) => Promise<SolutionInfo | null> {
  return async (key) => {
    const e = await store.getEntry("product", key);
    if (!e || e.kind !== "product" || e.publication !== "published" || !e.published) return null;
    const p = e.published as { name?: string; catalog?: { commercialStatus?: string; offer?: { mode?: string; modality?: string } | string } };
    const offer = p.catalog?.offer;
    const raw = typeof offer === "string" ? offer : (offer?.mode ?? offer?.modality ?? null);
    const mode = raw === "assisted" || raw === "immediate" ? raw : null;
    return { key, name: p.name ?? key, mode, commercialStatus: p.catalog?.commercialStatus ?? null };
  };
}
