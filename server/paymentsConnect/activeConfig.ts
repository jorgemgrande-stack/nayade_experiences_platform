/**
 * ¿Con qué conexión cobra HOY esta empresa? Real si la plataforma tiene el modo Real configurado, la empresa está
 * autorizada expresamente para él y su cuenta real está verificada con los cobros en línea encendidos; si no, Prueba.
 * Es la única decisión: el resto del código recibe la configuración ya elegida y nunca mezcla modos.
 */
import { getTenantIdOrDefault } from "../_core/tenant";
import { onlinePaymentsAvailable } from "../../shared/paymentAccounts";
import { connectConfigState, liveAllowedFor, type ConnectConfig } from "./config";
import { mysqlPaymentStore } from "./store";

export async function activeConnectConfig(tenantId: string = getTenantIdOrDefault()): Promise<ConnectConfig | null> {
  const live = liveAllowedFor(tenantId);
  if (live) {
    try {
      const a = await mysqlPaymentStore().getAccount("live");
      if (a && onlinePaymentsAvailable({ status: a.status, onlineEnabled: a.onlineEnabled })) return live;
    } catch {
      // Sin leer la cuenta real no se cobra en real; cae a Prueba (si existe)
    }
  }
  return connectConfigState().config;
}
