/**
 * Elephant LMS · licencia de módulo para las rutas que NO pasan por una guarda HTTP: la tarea programada `learning-sweep` y los
 * ganchos de comercio que conceden matrículas nuevas (pedido de tienda pagado, inscripción confirmada).
 *
 * Mismo interruptor que las guardas tRPC y Express (`LEARNING_LICENSE_ENFORCED`, apagado por defecto): con él apagado devuelve `true`
 * sin consultar nada, así que el comportamiento actual no cambia. Con él encendido exige la licencia `learning` de la empresa en curso
 * y, si no puede verificarla, responde `false` (se cierra); lo omitido no se pierde: el barrido lo recupera cuando vuelve la licencia.
 * No lanza nunca. Las protecciones del alumno (reembolso, disputa, revocación) NO pasan por aquí: siguen funcionando siempre.
 */
import type { ModuleAccess } from "./_core/modules/entitlements";
import { learningEnforced } from "./_core/modules/routeGuard";

export async function learningLicensed(getAccess?: () => ModuleAccess): Promise<boolean> {
  if (!learningEnforced()) return true;
  try {
    const access = getAccess ? getAccess() : (await import("./_core/modules/runtime")).getModuleAccess();
    return await access.isModuleAvailable("learning");
  } catch {
    return false;
  }
}
