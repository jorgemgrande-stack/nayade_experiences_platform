/**
 * Inicio del panel (Elephant Core): datos para la portada que no tienen ya un procedimiento propio.
 * Equipo (admin, agente y solo lectura). La licencia del namespace la aplica el guardián de rutas
 * (`coreHome` → admin-panel) y cada fuente comprueba además su propia capacidad (coreHomeDb.ts).
 */
import { router, staffProcedure } from "../_core/trpc";
import { homeIndicators, recentActivity } from "../coreHomeDb";

export const coreHomeRouter = router({
  /** Últimos movimientos reales de la empresa: clientes, oportunidades, presupuestos, pedidos, facturas y caja. */
  recentActivity: staffProcedure.query(async () => ({ items: await recentActivity(8) })),
  /** Cifras reales del Inicio (ventas de hoy y del mes, cobros, presupuestos, clientes y pedidos online). */
  indicators: staffProcedure.query(async () => homeIndicators()),
});
