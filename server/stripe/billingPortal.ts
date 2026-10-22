/**
 * Acceso de la empresa al portal de facturación de Stripe (Customer Portal) para CONSULTAR y descargar sus
 * facturas y actualizar el método de pago. Solo lo pide el Core en nombre de la persona propietaria (lo comprueba
 * el Core) con el token de comercio (`commerce:purchase`).
 *
 * Por seguridad (sin cobros ni cambios desde el portal mientras no se apruebe):
 *  - apagado salvo CP_BILLING_PORTAL_ENABLED=1;
 *  - siempre con una configuración CONCRETA (CP_BILLING_PORTAL_CONFIGURATION), nunca la por defecto, que se
 *    relee en Stripe en cada apertura y se rechaza si permite cambiar o cancelar la suscripción o editar los
 *    datos de facturación (cualquiera de ellas podría generar cobros, prorrateos o rectificaciones);
 *  - el cliente de Stripe es el de la empresa (CRM → enlace guardado), nunca uno que venga en la petición;
 *  - la vuelta solo a un dominio activo de esa empresa (https).
 * No toca Checkout ni crea cobros.
 */
import type { GwPortalConfig } from "./portal";

export class BillingPortalError extends Error {
  constructor(
    readonly code: "disabled" | "not_found" | "unsafe" | "invalid",
    message: string,
  ) {
    super(message);
    this.name = "BillingPortalError";
  }
}

/** ¿La configuración solo deja ver facturas y cambiar el método de pago? Devuelve los motivos si no. */
export function portalConfigProblems(c: GwPortalConfig): string[] {
  const out: string[] = [];
  if (!c.active) out.push("configuración inactiva");
  if (!c.invoiceHistory) out.push("sin historial de facturas");
  if (c.update.enabled) out.push("permite cambiar el plan (cobros o prorrateos)");
  if (c.cancel.enabled) out.push("permite cancelar la suscripción");
  if (c.customerUpdate.enabled) out.push("permite editar los datos de facturación (rectificaciones pendientes de decisión)");
  return out;
}

export interface BillingPortalDeps {
  enabled: boolean;
  configurationId: string | null;
  companyOfTenant: (tenantId: string) => Promise<number | null>;
  customerOfCompany: (companyId: number) => Promise<string | null>;
  portalConfigurations: () => Promise<GwPortalConfig[]>;
  createSession: (i: { customerId: string; returnUrl: string; configuration: string }) => Promise<{ url: string }>;
  /** Dominios activos de la empresa (registro). */
  tenantDomains: (tenantId: string) => Promise<string[]>;
}

export class BillingPortalService {
  constructor(private d: BillingPortalDeps) {}

  get status() {
    return { enabled: this.d.enabled && !!this.d.configurationId };
  }

  async open(tenantId: string, returnUrl: string): Promise<{ url: string }> {
    if (!this.d.enabled || !this.d.configurationId) throw new BillingPortalError("disabled", "El portal de facturación no está disponible todavía.");
    let back: URL;
    try {
      back = new URL(returnUrl);
    } catch {
      throw new BillingPortalError("invalid", "Dirección de vuelta no válida");
    }
    const domains = (await this.d.tenantDomains(tenantId)).map((x) => x.toLowerCase());
    if (back.protocol !== "https:" || !domains.includes(back.hostname.toLowerCase())) throw new BillingPortalError("invalid", "La dirección de vuelta no es de esta empresa");
    const companyId = await this.d.companyOfTenant(tenantId);
    const customerId = companyId ? await this.d.customerOfCompany(companyId) : null;
    if (!customerId) throw new BillingPortalError("not_found", "Tu empresa aún no tiene facturas en el sistema de cobros.");
    const cfg = (await this.d.portalConfigurations()).find((c) => c.id === this.d.configurationId);
    const problems = cfg ? portalConfigProblems(cfg) : ["la configuración no existe en Stripe"];
    if (problems.length) throw new BillingPortalError("unsafe", `El portal de facturación está desactivado por seguridad: ${problems.join("; ")}.`);
    return this.d.createSession({ customerId, returnUrl: back.toString(), configuration: cfg!.id });
  }
}
