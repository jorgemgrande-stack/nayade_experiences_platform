/**
 * ¿Con qué conexión cobra HOY esta empresa? Real si la plataforma tiene el modo Real configurado, la empresa está
 * autorizada expresamente para él y su cuenta real está verificada con los cobros en línea encendidos; si no, Prueba.
 * Es la única decisión: el resto del código recibe la configuración ya elegida y nunca mezcla modos.
 *
 * Excepción de seguridad: en production, una empresa AUTORIZADA para el modo Real cuyo cobro real aún no está listo NO cae a
 * Prueba (el público vería un pago de mentira en una web real). En entornos que no son production, Prueba sigue siendo el
 * modo de trabajo.
 */
import { getTenantIdOrDefault } from "../_core/tenant";
import { onlinePaymentsAvailable } from "../../shared/paymentAccounts";
import { connectConfigState, liveAllowedFor, type ConnectConfig } from "./config";
import { mysqlPaymentStore } from "./store";

/** Decisión pura (sin base de datos ni entorno) para poder probarla. */
export function chooseActiveConfig(p: { live: ConnectConfig | null; liveReady: boolean; test: ConnectConfig | null; production: boolean }): ConnectConfig | null {
  if (p.live && p.liveReady) return p.live;
  // Autorizada para Real pero sin cobro real listo: en production no se expone el modo de pruebas
  if (p.live && p.production) return null;
  return p.test;
}

export async function activeConnectConfig(tenantId: string = getTenantIdOrDefault(), env: NodeJS.ProcessEnv = process.env): Promise<ConnectConfig | null> {
  const live = liveAllowedFor(tenantId, env);
  let liveReady = false;
  if (live) {
    try {
      const a = await mysqlPaymentStore().getAccount("live");
      liveReady = !!a && onlinePaymentsAvailable({ status: a.status, onlineEnabled: a.onlineEnabled });
    } catch {
      // Sin leer la cuenta real no se cobra en real
    }
  }
  return chooseActiveConfig({ live, liveReady, test: connectConfigState(env).config, production: env.NODE_ENV === "production" });
}
