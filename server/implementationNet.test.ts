/**
 * Elephant Net comercializado (11/11/2026): checklist «primera implantación sectorial» por solución, expediente que se
 * abre solo al pagar un producto Net de sector (cualquier circuito), incidencias como hitos y compromisos de
 * implantación para las condiciones especiales de un paquete. Datos sintéticos en memoria.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { MemoryCrmStore } from "./crm/store";
import { CrmService } from "./crm/service";
import { ImplementationService, type SolutionInfo } from "./implementation/service";
import { MemoryImplementationStore } from "./implementation/store";
import { GENERIC_TEMPLATE, SECTOR_TEMPLATE_KEYS, netCommitmentsText, sectionOf, templateFor } from "./implementation/templates";
import { addedByTerms, circuitOf, paidNetOpener, sectorNetKeys, withPaidNet } from "./implementation/paidNet";
import { NET_PRODUCTS, netProductOf } from "../shared/netProducts";
import { PRODUCT_SPECS } from "./catalog/commercial/specs";
import type { CommercialOrder } from "./orchestrator/types";

const T0 = Date.UTC(2026, 10, 11, 9);
const SOL: Record<string, SolutionInfo> = Object.fromEntries(NET_PRODUCTS.map((p) => [p.key, { key: p.key, name: p.name, mode: p.key === "social-token-net-complete" ? "immediate" : "assisted", commercialStatus: "on_request" } as SolutionInfo]));
const catalog = {
  product: async (key: string) => {
    const n = netProductOf(key);
    if (n) return { key, name: n.name, catalogFamily: key === "life-net" ? "net_module" : "net_bundle" } as never;
    return key === "connect-people" ? ({ key, name: "People", catalogFamily: "connect" } as never) : null;
  },
};

describe("plantillas de primera implantación sectorial", () => {
  it("una por solución de empresa, con los requisitos del catálogo, una comprobación por funcionalidad disponible e «en implantación» sin bloquear", () => {
    for (const key of SECTOR_TEMPLATE_KEYS) {
      const t = templateFor(key);
      const p = netProductOf(key)!;
      expect(t.generic, key).toBe(false);
      expect(t.name).toBe(`Primera implantación sectorial — ${p.name}`);
      const req = PRODUCT_SPECS.find((s) => s.key === key)!.implementation.requirements;
      for (const r of req) expect(t.items.map((i) => i.title), key).toContain(r);
      const available = p.areas.flatMap((a) => a.features.filter((f) => f.status === "available"));
      const checks = t.items.filter((i) => i.kind === "check");
      expect(checks.map((c) => c.title), key).toEqual(available.map((f) => `Comprobar: ${f.label}`));
      expect(checks.every((c) => c.required && c.section === "comprobaciones")).toBe(true);
      const soon = p.areas.flatMap((a) => a.features.filter((f) => f.status === "coming_soon"));
      const pending = t.items.filter((i) => i.section === "en_implantacion");
      expect(pending.length, key).toBe(soon.length ? 1 : 0);
      if (soon.length) expect(pending[0]).toMatchObject({ kind: "pending", required: false });
      for (const f of soon) expect(pending[0].note).toContain(f.label);
      // Nunca una comprobación de algo que está en implantación
      for (const f of soon) expect(checks.map((c) => c.title)).not.toContain(`Comprobar: ${f.label}`);
      expect(t.items.every((i) => i.title.length <= 200)).toBe(true);
    }
    expect(templateFor("hotel-net-complete").items.find((i) => i.section === "en_implantacion")!.title).toContain("Channel Manager");
    // Life Net (personal) y cualquier otro producto: los hitos genéricos de siempre
    expect(templateFor("life-net")).toBe(GENERIC_TEMPLATE);
    expect(templateFor("connect-people")).toBe(GENERIC_TEMPLATE);
    expect(GENERIC_TEMPLATE.items.map((i) => i.title)).toEqual(["Reunión de arranque con el cliente", "Configuración técnica del entorno", "Carga o migración de datos", "Formación del equipo del cliente", "Validación del cliente"]);
  });

  it("secciones de los hitos guardados", () => {
    expect(sectionOf({ kind: "incidencia", required: true })).toBe("incidencias");
    expect(sectionOf({ kind: "check", required: true })).toBe("comprobaciones");
    expect(sectionOf({ kind: "pending", required: false })).toBe("en_implantacion");
    expect(sectionOf({ kind: "pending", required: true })).toBe("configuracion");
    expect(sectionOf({ kind: "milestone", required: true })).toBe("configuracion");
  });

  it("compromisos de implantación para las condiciones especiales: alcance, disponible y en implantación (nunca como terminado)", () => {
    const t = netCommitmentsText("hotel-net-complete")!;
    expect(t).toContain("Compromisos de implantación de Hotel Net.");
    expect(t).toContain("Configuración de habitaciones, tarifas y pasarela de pago propia del alojamiento");
    expect(t).toMatch(/Disponible desde la puesta en marcha: PMS, .*Housekeeping/);
    expect(t).toMatch(/En implantación \(incluido en el precio, sin coste adicional.*\): Channel Manager, Sincronización de inventario y tarifas\./);
    expect(t).toContain("Las comisiones de los canales de venta (OTAs) se pagan aparte a cada canal.");
    expect(t).not.toMatch(/\d+ ?€/);
    // Social Token Net: todo disponible, sin «en implantación»
    expect(netCommitmentsText("social-token-net-complete")).not.toContain("En implantación");
    expect(netCommitmentsText("life-net")).toBeNull();
    expect(netCommitmentsText("connect-people")).toBeNull();
  });
});

describe("expediente al pagar un producto Net y checklist", () => {
  let clock: number;
  let crmStore: MemoryCrmStore;
  let crm: CrmService;
  let store: MemoryImplementationStore;
  let svc: ImplementationService;
  let starts: number;

  beforeEach(() => {
    clock = T0;
    crmStore = new MemoryCrmStore();
    crm = new CrmService({ store: crmStore, activation: { activate: async ({ company }) => ({ tenantId: company.tenantId ?? "sin" }) }, now: () => clock });
    store = new MemoryImplementationStore();
    starts = 0;
    svc = new ImplementationService({
      store,
      crm,
      crmStore,
      solution: async (k) => SOL[k] ?? null,
      platform: { activate: async () => ({ tenantId: "t-nueva" }) },
      starter: { start: async () => (starts++, { subscriptionId: 999, trialEndsAt: null }) },
      notify: async () => ({ queued: true }),
      now: () => clock,
    });
  });

  async function paidCompany(name = "Hotel Pagado SL") {
    const c = await crm.createCompany({ name, email: "admin@hotel.example" }, "test");
    await crm.createContact(c.id, { name: "Ana", email: "admin@hotel.example", isPrimary: true }, "test");
    await crmStore.update("companies", c.id, { tenantId: "t1-hotel" });
    const contract = await crm.createContract({ companyId: c.id, planId: "essential", modules: [], conditions: "Contratación en línea (condiciones generales)", billingInterval: "month" }, "test");
    await crm.setContractStatus(contract.id, "sent", "test");
    await crm.setContractStatus(contract.id, "signed", "test", { signatureRef: "web-terms:v1:abc" });
    await crm.setContractStatus(contract.id, "active", "test");
    return { companyId: c.id, contractId: contract.id };
  }

  it("abre el expediente «en implantación» con la checklist de su solución, una sola vez, y al iniciarlo no crea otra suscripción", async () => {
    const { companyId, contractId } = await paidCompany();
    const r = await svc.openPaid({ companyId, solutionKey: "hotel-net-complete", contractId, subscriptionId: 42, circuit: "panel_purchase", reference: "PED-2026-000042" }, "system:paid-net");
    expect(r.created).toBe(true);
    expect(r.order).toMatchObject({ status: "accepted", contractId, subscriptionId: 42, startMode: "subscription", solutionName: "Hotel Net", queue: "implantacion", leadRequestId: null });
    const ms = await store.milestones(r.order.id);
    expect(ms.map((m) => m.title)).toEqual(templateFor("hotel-net-complete").items.map((i) => i.title));
    const d = await svc.detail(r.order.id);
    expect(d.checklist).toEqual({ key: "hotel-net-complete", name: "Primera implantación sectorial — Hotel Net", generic: false, applied: true });
    expect(d.paid).toEqual({ circuit: "panel_purchase", reference: "PED-2026-000042", billed: true });
    expect(d.events[0].detail).toContain("Hotel Net · pagado (compra desde el panel PED-2026-000042): implantación obligatoria");
    expect(d.milestones.filter((m) => m.section === "comprobaciones").length).toBeGreaterThan(5);
    expect(d.events.map((e) => e.type)).toEqual(["created", "assigned", "paid", "checklist"]);
    // Idempotente: otro pago (o el mismo repetido) de la misma solución devuelve el mismo expediente
    const again = await svc.openPaid({ companyId, solutionKey: "hotel-net-complete", contractId, subscriptionId: 42, circuit: "panel_purchase", reference: "PED-2026-000042" }, "system:paid-net");
    expect(again).toMatchObject({ created: false, order: { id: r.order.id } });
    expect(store.rows).toHaveLength(1);

    // Incidencia: obligatoria, bloquea «preparada» hasta resolverse
    for (const m of ms) await svc.setMilestoneDone(r.order.id, m.id, true, "operator:laura");
    const inc = await svc.addMilestone(r.order.id, { title: "La pasarela de pago rechaza la tarjeta de prueba", kind: "incidencia" }, "operator:laura");
    expect(inc).toMatchObject({ kind: "incidencia", required: true, status: "open" });
    await expect(svc.markReady(r.order.id, {}, "operator:laura")).rejects.toThrow(/La pasarela de pago rechaza/);
    await svc.setMilestoneDone(r.order.id, inc.id, true, "operator:laura");
    await svc.markReady(r.order.id, {}, "operator:laura");
    // Ya preparada: hitos normales cerrados, incidencias abiertas siguen admitiéndose
    await expect(svc.addMilestone(r.order.id, { title: "Otro hito tardío" }, "operator:laura")).rejects.toThrow(/no se cambian/);
    const late = await svc.addMilestone(r.order.id, { title: "El cliente no ve el motor de reservas", kind: "incidencia" }, "operator:laura");
    await svc.setMilestoneDone(r.order.id, late.id, true, "operator:laura");
    // Habilitar (ya tiene plataforma), comunicar e iniciar: la suscripción pagada, sin crear otra
    await svc.enable(r.order.id, "operator:laura");
    const started = await svc.communicate(r.order.id, "operator:laura");
    expect(started).toMatchObject({ status: "started", subscriptionId: 42, tenantId: "t1-hotel" });
    expect(starts).toBe(0);
    expect((await crmStore.get("contracts", contractId))!.status).toBe("active");
    // Una incidencia tras el inicio también se registra (primera implantación); cancelado, no
    await svc.addMilestone(r.order.id, { title: "Duda del cliente tras la puesta en marcha", kind: "incidencia" }, "operator:laura");
    // Con el expediente iniciado, un pago posterior de lo mismo no abre otro
    expect((await svc.openPaid({ companyId, solutionKey: "hotel-net-complete", contractId, subscriptionId: 42, circuit: "order", reference: "x" }, "system:paid-net")).created).toBe(false);
  });

  it("un expediente con hitos propios los conserva al aceptarse; uno nuevo de una solución sin plantilla lleva los genéricos", async () => {
    const { companyId } = await paidCompany("Antiguo SL");
    const opp = await crm.createOpportunity({ companyId, title: "Hotel Net — implantación", planId: "essential" }, "test");
    const { order } = await svc.open({ opportunityId: opp.id, solutionKey: "hotel-net-complete" }, "operator:laura");
    await svc.addMilestone(order.id, { title: "Hito acordado antes de las plantillas" }, "operator:laura");
    await svc.prepareProposal(order.id, { conditions: "Condiciones escritas por una persona para la implantación.", timeline: "Tres semanas", startMode: "subscription" }, "operator:laura");
    const cid = (await store.get(order.id))!.contractId!;
    await crm.setContractStatus(cid, "sent", "test");
    await crm.setContractStatus(cid, "signed", "test", { signatureRef: "firma" });
    await svc.syncAcceptance(order.id, "operator:laura");
    expect((await store.milestones(order.id)).map((m) => m.title)).toEqual(["Hito acordado antes de las plantillas"]);
    expect((await svc.detail(order.id)).checklist).toMatchObject({ key: null, applied: false, generic: true });

    const other = await svc.open({ opportunityId: opp.id, solutionKey: "connect-people" }, "operator:laura");
    await svc.prepareProposal(other.order.id, { conditions: "Condiciones escritas por una persona para la implantación.", timeline: "Dos semanas", startMode: "subscription", planId: "essential" }, "operator:laura");
    const c2 = (await store.get(other.order.id))!.contractId!;
    await crm.setContractStatus(c2, "sent", "test");
    await crm.setContractStatus(c2, "signed", "test", { signatureRef: "firma2" });
    await svc.syncAcceptance(other.order.id, "operator:laura");
    expect((await store.milestones(other.order.id)).map((m) => m.title)).toEqual(GENERIC_TEMPLATE.items.map((i) => i.title));
    expect((await svc.detail(other.order.id)).checklist).toEqual({ key: "generic", name: GENERIC_TEMPLATE.name, generic: true, applied: true });
  });

  it("pedidos activados: abre solo lo NUEVO y solo productos Net de sector de empresa; nunca rompe la activación", async () => {
    const { companyId, contractId } = await paidCompany("Pedidos SL");
    const previous = { request: { plan: "essential", interval: "month", items: [{ key: "restaurant-net-complete" }] } };
    const opener = paidNetOpener({ implementation: svc, catalog, previousOrder: async () => previous as never });
    const order = (over: Partial<CommercialOrder>) => ({ id: 7, kind: "change", idempotencyKey: "purchase-abcdefabcdefabcdef", reference: "PED-7", companyId, contractId, subscriptionId: 70, previousOrderId: 6, request: { plan: "essential", interval: "month", items: [{ key: "restaurant-net-complete" }, { key: "social-token-net-complete" }, { key: "connect-people" }, { key: "life-net" }] }, ...over }) as CommercialOrder;
    const ids = await opener.fromOrder(order({}));
    expect(ids).toHaveLength(1);
    expect(store.rows.map((o) => [o.solutionKey, o.status])).toEqual([["social-token-net-complete", "accepted"]]);
    expect((await svc.detail(ids[0])).paid).toEqual({ circuit: "panel_purchase", reference: "PED-7", billed: true });
    // Social Token Net (activación inmediata): las licencias ya están activas, la implantación acompaña sin bloquear
    expect((await svc.detail(ids[0])).events[0].detail).toContain("licencias ya activas; puesta en marcha acompañada (no bloquea el uso)");
    // Alta nueva (sin pedido anterior): todos sus productos Net de sector
    await opener.fromOrder(order({ id: 8, kind: "trial_conversion", idempotencyKey: "pc-conversion-de-prueba", previousOrderId: null }));
    expect(store.rows.map((o) => o.solutionKey).sort()).toEqual(["restaurant-net-complete", "social-token-net-complete"]);
    // Sin empresa, nada; un fallo se registra y no se propaga
    expect(await opener.fromOrder(order({ companyId: null as never }))).toEqual([]);
    const failing = paidNetOpener({ implementation: { openPaid: async () => { throw new Error("BD caída"); } }, catalog });
    await expect(failing.fromOrder(order({ previousOrderId: null }))).resolves.toEqual([]);
    expect(await sectorNetKeys(catalog, ["life-net", "connect-people", "ski-net-complete", "ski-net-complete"])).toEqual(["ski-net-complete"]);
    expect([circuitOf({ kind: "trial_conversion", idempotencyKey: "pc-x" }), circuitOf({ kind: "change", idempotencyKey: "purchase-x" }), circuitOf({ kind: "new", idempotencyKey: "ss-x" }), circuitOf({ kind: "new", idempotencyKey: "crm-x" })]).toEqual(["trial_conversion", "panel_purchase", "public_checkout", "order"]);
  });

  it("condiciones personalizadas aceptadas con un producto Net: expediente con el circuito «condiciones personalizadas»", async () => {
    const { companyId, contractId } = await paidCompany("Condiciones SL");
    const opener = paidNetOpener({ implementation: svc, catalog });
    const ids = await opener.fromTerms({ companyId, contractId, subscriptionId: 55, productKeys: ["essential", "care-net-complete"], reference: "condiciones #3" });
    expect(ids).toHaveLength(1);
    expect((await store.get(ids[0]))).toMatchObject({ solutionKey: "care-net-complete", status: "accepted", subscriptionId: 55 });
    const det = await svc.detail(ids[0]);
    // Condiciones personalizadas: «contratado», nunca «pagado» (su cobro tiene su propio interruptor)
    expect(det.paid).toEqual({ circuit: "custom_terms", reference: "condiciones #3", billed: false });
    expect(det.events[0].detail).toContain("Care Net · contratado (condiciones personalizadas aceptadas condiciones #3)");
    expect(det.order.conditions).toMatch(/^Contratado \(/);
    // Solo lo NUEVO de un acuerdo: lo que ya estaba en un acuerdo anterior no abre otro expediente
    expect(addedByTerms({ id: 5, lines: [{ productKey: "essential" }, { productKey: "hotel-net-complete" }, { productKey: "care-net-complete" }, { productKey: null }] }, [{ id: 4, lines: [{ productKey: "hotel-net-complete" }] }, { id: 5, lines: [{ productKey: "care-net-complete" }] }])).toEqual(["essential", "care-net-complete"]);
  });

  it("clase B: el paquete personalizado lleva plan Core si falta, el Net a su precio publicado y los compromisos; aceptado, el expediente pasa a implantación", async () => {
    const c = await crm.createCompany({ name: "Restaurante B SL", email: "admin@rest.example" }, "test");
    const opp = await crm.createOpportunity({ companyId: c.id, title: "Restaurant Net — implantación asistida" }, "test");
    const created: Array<{ companyId: number; input: Record<string, unknown> }> = [];
    let plan: string | null = null;
    const terms = new Map<number, { id: number; status: string; companyId: number }>();
    const packages = {
      offer: async () => [
        { key: "essential", name: "Essential", family: "core_plan", prices: [{ id: 11, kind: "monthly", status: "approved" }] },
        { key: "restaurant-net-complete", name: "Restaurant Net", family: "industry_module", prices: [{ id: 41, kind: "monthly", status: "approved" }, { id: 42, kind: "yearly", status: "draft" }] },
        { key: "ski-net-complete", name: "Ski Net", family: "industry_module", prices: [] },
      ],
      companyPlan: async () => plan,
      create: async (companyId: number, input: Record<string, unknown>) => {
        created.push({ companyId, input });
        const t = { id: 300 + created.length, status: "draft", companyId };
        terms.set(t.id, t);
        return t;
      },
      get: async (id: number) => terms.get(id) ?? null,
    };
    const svc2 = new ImplementationService({ store, crm, crmStore, solution: async (k) => SOL[k] ?? null, packages: packages as never, now: () => clock });
    const { order } = await svc2.open({ opportunityId: opp.id, solutionKey: "restaurant-net-complete" }, "operator:laura");
    const r = await svc2.preparePackage(order.id, "operator:laura");
    expect(r).toEqual({ termsId: 301, created: true });
    const input = created[0].input as { lines: unknown[]; conditions: string; requiresAcceptance: boolean; interval: string; packageName: string };
    expect(created[0].companyId).toBe(c.id);
    expect(input.lines).toEqual([
      { kind: "catalog", productKey: "essential", priceId: 11, quantity: 1 },
      { kind: "catalog", productKey: "restaurant-net-complete", priceId: 41, quantity: 1 },
    ]);
    expect(input).toMatchObject({ requiresAcceptance: true, interval: "month", packageName: "Restaurant Net con implantación", pricingMode: "per_item" });
    expect(input.conditions).toContain("Servicio contratado: Restaurant Net, al precio publicado");
    expect(input.conditions).toContain(`expediente ${order.reference}`);
    expect(input.conditions).toContain(netCommitmentsText("restaurant-net-complete")!);
    expect(input.conditions).toMatch(/En implantación \(incluido en el precio[^)]*\): Clientes y preferencias, Escandallos y costes\./);
    // Idempotente mientras el borrador siga sin enviar; enviado (o descartado), se prepara otro
    expect(await svc2.preparePackage(order.id, "operator:laura")).toEqual({ termsId: 301, created: false });
    terms.get(301)!.status = "cancelled";
    plan = "business";
    expect(await svc2.preparePackage(order.id, "operator:laura")).toEqual({ termsId: 302, created: true });
    expect((created[1].input as { lines: Array<{ productKey: string }> }).lines.map((l) => l.productKey)).toEqual(["restaurant-net-complete"]);
    // Enviado a aceptación (o en vigor): se devuelve el mismo, nunca una segunda oferta
    terms.get(302)!.status = "pending_acceptance";
    expect(await svc2.preparePackage(order.id, "operator:laura")).toEqual({ termsId: 302, created: false });
    // Otra oferta viva del mismo producto para la empresa (p. ej. preparada desde «Paquetes»): esa
    const svc3 = new ImplementationService({ store, crm, crmStore, solution: async (k) => SOL[k] ?? null, packages: { ...packages, ofCompany: async () => [{ id: 290, status: "pending_acceptance", companyId: c.id, acceptanceStatus: "pending", productKeys: ["essential", "restaurant-net-complete"] }] } as never, now: () => clock });
    const again = await svc3.open({ opportunityId: opp.id, solutionKey: "travel-net-complete" }, "operator:laura");
    expect(await svc3.preparePackage(order.id, "operator:laura")).toEqual({ termsId: 302, created: false });
    expect(again.created).toBe(true);
    terms.get(302)!.status = "cancelled";
    expect(await svc3.preparePackage(order.id, "operator:laura")).toEqual({ termsId: 290, created: false });
    expect(created).toHaveLength(2);
    // Sin precio publicado o fuera de Net, no
    const ski = await svc2.open({ opportunityId: opp.id, solutionKey: "ski-net-complete" }, "operator:laura");
    await expect(svc2.preparePackage(ski.order.id, "operator:laura")).rejects.toThrow(/no tiene precio mensual publicado/);
    const people = await svc2.open({ opportunityId: opp.id, solutionKey: "connect-people" }, "operator:laura");
    await expect(svc2.preparePackage(people.order.id, "operator:laura")).rejects.toThrow(/solo para los productos Net de empresa/);
    // Un expediente abierto por un pago (aunque quedara sin contrato) no prepara otro contrato
    const paidFile = await svc2.openPaid({ companyId: c.id, solutionKey: "care-net-complete", contractId: null, subscriptionId: null, circuit: "order", reference: "PED-9" }, "system:paid-net");
    expect(paidFile.order.status).toBe("requested");
    await expect(svc2.preparePackage(paidFile.order.id, "operator:laura")).rejects.toThrow(/lo abrió una contratación ya hecha/);
    // Aceptadas las condiciones (contrato firmado y suscripción): el MISMO expediente pasa a implantación con su checklist
    const contract = await crm.createContract({ companyId: c.id, planId: "business", modules: [], conditions: "Condiciones personalizadas aceptadas por el cliente", billingInterval: "month" }, "test");
    const opened = await paidNetOpener({ implementation: svc2, catalog }).fromTerms({ companyId: c.id, contractId: contract.id, subscriptionId: 77, productKeys: ["restaurant-net-complete"], reference: "condiciones #302" });
    expect(opened).toEqual([order.id]);
    const after = (await store.get(order.id))!;
    expect(after).toMatchObject({ status: "accepted", contractId: contract.id, subscriptionId: 77, startMode: "subscription" });
    expect((await svc2.detail(order.id)).paid).toEqual({ circuit: "custom_terms", reference: "condiciones #302", billed: false });
    expect((await store.milestones(order.id)).map((m) => m.title)).toEqual(templateFor("restaurant-net-complete").items.map((i) => i.title));
    // Ya contratado: el paquete no se prepara otra vez desde el expediente
    await expect(svc2.preparePackage(order.id, "operator:laura")).rejects.toThrow(/ya tiene el contrato aceptado/);
    // Sin el puerto de condiciones personalizadas: no disponible
    await expect(svc.preparePackage(ski.order.id, "operator:laura")).rejects.toMatchObject({ code: "unavailable" });
  });

  it("aviso del orquestador: al activarse un pedido abre el expediente y el aviso de siempre sale igual (uno no frena al otro)", async () => {
    const seen: string[] = [];
    const ref = { run: { fromOrder: async () => (seen.push("expediente"), [1]), fromTerms: async () => [] } };
    const mail = async (e: { action: string }) => void seen.push(`correo:${e.action}`);
    const n = withPaidNet(mail as never, ref as never)!;
    await n({ order: {} as never, action: "activate", detail: null });
    await n({ order: {} as never, action: "confirm", detail: null });
    expect(seen).toEqual(["expediente", "correo:activate", "correo:confirm"]);
    // Sin correo configurado, sigue abriendo el expediente
    const only = withPaidNet(undefined, ref as never)!;
    await only({ order: {} as never, action: "activate", detail: null });
    expect(seen.filter((s) => s === "expediente")).toHaveLength(2);
    // Un fallo del correo se propaga (lo registra el orquestador) sin impedir el expediente
    const broken = withPaidNet((async () => { throw new Error("smtp"); }) as never, ref as never)!;
    await expect(broken({ order: {} as never, action: "activate", detail: null })).rejects.toThrow("smtp");
    expect(seen.filter((s) => s === "expediente")).toHaveLength(3);
  });
});
