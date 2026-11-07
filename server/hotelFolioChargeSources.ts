/**
 * Registro de los módulos que cargan consumos al folio del hotel (Restaurant Net, Care Net…). Sin dependencias: el
 * folio (server/hotelFolioDb.ts) lo consulta al anular un cargo externo y cada módulo registra aquí su reversión al
 * cargarse, así el hotel no importa nada de restaurante ni de SPA (sin dependencias circulares).
 */

export const EXTERNAL_CHARGE_MODULES = ["restaurant", "care"] as const;
export type ExternalChargeModule = (typeof EXTERNAL_CHARGE_MODULES)[number];

/** Ejecutor de la transacción del folio (la misma BD de la empresa). */
export type ChargeExec = { execute: (q: any) => Promise<unknown> };

export interface ExternalChargeSource {
  /**
   * Devuelve el origen a pendiente de cobro, dentro de la transacción que anula el cargo. Si no se puede (p. ej. un bono
   * con sesiones ya usadas), lanza un error con el motivo y el cargo no se anula.
   */
  onReverted(tx: ChargeExec, sourceRef: string, info: { reason: string; userId: number | null }): Promise<void>;
}

const sources = new Map<ExternalChargeModule, ExternalChargeSource>();

export function registerExternalChargeSource(module: ExternalChargeModule, source: ExternalChargeSource): void {
  sources.set(module, source);
}

export function externalChargeSource(module: string): ExternalChargeSource | null {
  return sources.get(module as ExternalChargeModule) ?? null;
}

/** Clave de cada línea del cargo en hotel_folio_items (idempotente y reconocible al anular). */
export const externalItemKey = (chargeId: number, n: number): string => `ext:${chargeId}:${n}`;

/** Id del cargo externo de una línea del folio, o null si no lo es. */
export function externalChargeIdOf(sourceKey: string | null | undefined): number | null {
  const m = /^ext:(\d+):\d+$/.exec(sourceKey ?? "");
  return m ? Number(m[1]) : null;
}

export interface ExternalChargeLine {
  description: string;
  quantity: number;
  unitPriceCents: number;
  taxRateBp: number;
}

/** Problema de las líneas de un cargo externo (null = válidas). */
export function externalLinesProblem(lines: readonly ExternalChargeLine[]): string | null {
  if (!lines.length) return "No hay nada que cargar.";
  for (const l of lines) {
    if (!Number.isInteger(l.quantity) || l.quantity < 1) return "Cantidad no válida.";
    if (!Number.isInteger(l.unitPriceCents) || l.unitPriceCents < 1) return "Importe no válido.";
    if (!Number.isInteger(l.taxRateBp) || l.taxRateBp < 0 || l.taxRateBp > 10000) return "Tipo de IVA no válido.";
  }
  return null;
}
