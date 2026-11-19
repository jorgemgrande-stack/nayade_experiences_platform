/**
 * Ensamblado de los cobros por empresa con las piezas reales (almacén MySQL de la empresa en curso, pasarela Stripe
 * Connect y presupuestos del CRM). Aquí no hay reglas: están en service.ts.
 */
import { withTenantDb } from "../_core/dbRegistry";
import { warmIntegrationCreds } from "../_core/credentials/runtime";
import { warmTenantIdentity } from "../_core/tenantIdentity";
import { warmConfigCache } from "../config";
import { warmEmailVocabulary } from "../emailVocabulary";
import type { TenantRegistryReader } from "../_core/tenantRegistry/store";
import { accessPolicy } from "../_core/tenantRegistry/lifecycle";
import { connectConfigState, type ConnectConfig } from "./config";
import { stripeConnectGateway } from "./gateway";
import { realQuotePort } from "./quotePort";
import { createConnectWebhookRouter } from "./webhookRoute";
import { mysqlPaymentStore } from "./store";
import type { PaymentsDeps } from "./service";

export function realPaymentsDeps(tenantId: string, config: ConnectConfig): PaymentsDeps {
  return { store: mysqlPaymentStore(), gateway: stripeConnectGateway(config), config, quotes: realQuotePort(), tenantId };
}

/** Webhook central de cuentas conectadas: empresa servible según el registro, ejecución en su contexto y con sus ajustes. */
export function createRealConnectWebhookRouter(reader: Pick<TenantRegistryReader, "getTenant">) {
  return createConnectWebhookRouter({
    config: () => connectConfigState().config,
    tenantAllowed: async (id) => {
      const t = await reader.getTenant(id);
      if (!t) return false;
      const p = accessPolicy(t.status);
      // Se necesita poder escribir (aplicar un pago): una empresa suspendida o en solo lectura no recibe efectos
      return !!(p.publicWeb || p.admin) && t.status !== "deleted" && t.status !== "deleting";
    },
    runInTenant: (id, fn) =>
      withTenantDb(id, async () => {
        await Promise.all([warmConfigCache(), warmIntegrationCreds(), warmTenantIdentity(), warmEmailVocabulary()]);
        return fn();
      }),
    paymentsFor: realPaymentsDeps,
  });
}
