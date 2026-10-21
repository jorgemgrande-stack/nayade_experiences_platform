/**
 * Portal de facturación de Stripe para la persona propietaria: apagado por defecto; solo con una configuración
 * concreta que NO permita cambiar ni cancelar el plan ni editar datos de facturación (sin cobros ni rectificaciones);
 * el cliente de Stripe es el de la empresa (nunca uno de la petición); vuelta solo a un dominio activo de la empresa.
 * Y el Core: solo la persona propietaria lo pide.
 */
import { describe, it, expect } from "vitest";
import { BillingPortalService, portalConfigProblems, type BillingPortalDeps } from "./stripe/billingPortal";
import type { GwPortalConfig } from "./stripe/portal";

const safe: GwPortalConfig = {
  id: "bpc_seguro",
  isDefault: false,
  active: true,
  invoiceHistory: true,
  paymentMethodUpdate: true,
  customerUpdate: { enabled: false, allowedUpdates: [] },
  cancel: { enabled: false, mode: null, prorationBehavior: null },
  update: { enabled: false, defaultAllowedUpdates: [], products: [], prorationBehavior: null, scheduleAtPeriodEnd: [] },
  termsUrl: null,
  privacyUrl: null,
};
const sessions: Array<{ customerId: string; returnUrl: string; configuration: string }> = [];
const deps = (o: Partial<BillingPortalDeps> = {}): BillingPortalDeps => ({
  enabled: true,
  configurationId: "bpc_seguro",
  companyOfTenant: async (t) => (t === "acme" ? 11 : t === "costa" ? 22 : null),
  customerOfCompany: async (c) => (c === 11 ? "cus_acme" : null),
  portalConfigurations: async () => [safe, { ...safe, id: "bpc_default", isDefault: true, update: { ...safe.update, enabled: true } }],
  createSession: async (i) => (sessions.push(i), { url: `https://billing.stripe.test/s/${i.customerId}` }),
  tenantDomains: async (t) => (t === "acme" ? ["acme.app.bigelephant.es", "www.acme.example"] : ["costa.app.bigelephant.es"]),
  ...o,
});

describe("configuración del portal", () => {
  it("solo facturas y método de pago; cualquier opción que cambie la suscripción o los datos fiscales se rechaza", () => {
    expect(portalConfigProblems(safe)).toEqual([]);
    expect(portalConfigProblems({ ...safe, update: { ...safe.update, enabled: true } })).toEqual([expect.stringMatching(/cambiar el plan/)]);
    expect(portalConfigProblems({ ...safe, cancel: { enabled: true, mode: "at_period_end", prorationBehavior: "none" } })).toEqual([expect.stringMatching(/cancelar/)]);
    expect(portalConfigProblems({ ...safe, customerUpdate: { enabled: true, allowedUpdates: ["tax_id"] } })).toEqual([expect.stringMatching(/datos de facturación/)]);
    expect(portalConfigProblems({ ...safe, active: false, invoiceHistory: false })).toHaveLength(2);
  });
});

describe("apertura del portal", () => {
  it("apagado por defecto (sin flag o sin configuración concreta)", async () => {
    await expect(new BillingPortalService(deps({ enabled: false })).open("acme", "https://acme.app.bigelephant.es/admin/suscripcion")).rejects.toMatchObject({ code: "disabled" });
    await expect(new BillingPortalService(deps({ configurationId: null })).open("acme", "https://acme.app.bigelephant.es/admin/suscripcion")).rejects.toMatchObject({ code: "disabled" });
    expect(new BillingPortalService(deps({ configurationId: null })).status).toEqual({ enabled: false });
  });

  it("con la configuración segura: sesión del cliente de SU empresa y vuelta a su dominio", async () => {
    sessions.length = 0;
    const r = await new BillingPortalService(deps()).open("acme", "https://www.acme.example/admin/suscripcion");
    expect(r.url).toContain("cus_acme");
    expect(sessions).toEqual([{ customerId: "cus_acme", returnUrl: "https://www.acme.example/admin/suscripcion", configuration: "bpc_seguro" }]);
  });

  it("vuelta a otro dominio, http o no válida: rechazada sin abrir nada", async () => {
    sessions.length = 0;
    const svc = new BillingPortalService(deps());
    for (const back of ["https://costa.app.bigelephant.es/admin", "http://acme.app.bigelephant.es/admin", "https://evil.example/", "no-es-url"]) await expect(svc.open("acme", back), back).rejects.toMatchObject({ code: "invalid" });
    expect(sessions).toEqual([]);
  });

  it("empresa sin cliente en Stripe: no encontrado; configuración que deja de ser segura: desactivado por seguridad", async () => {
    await expect(new BillingPortalService(deps()).open("costa", "https://costa.app.bigelephant.es/admin/suscripcion")).rejects.toMatchObject({ code: "not_found" });
    const unsafe = deps({ portalConfigurations: async () => [{ ...safe, cancel: { enabled: true, mode: "immediately", prorationBehavior: "create_prorations" } }] });
    await expect(new BillingPortalService(unsafe).open("acme", "https://acme.app.bigelephant.es/admin/suscripcion")).rejects.toMatchObject({ code: "unsafe" });
    const missing = deps({ configurationId: "bpc_no_existe" });
    await expect(new BillingPortalService(missing).open("acme", "https://acme.app.bigelephant.es/admin/suscripcion")).rejects.toMatchObject({ code: "unsafe" });
  });
});
