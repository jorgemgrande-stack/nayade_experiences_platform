/**
 * ─── MÓDULO REAV — Lógica centralizada ──────────────────────────────────────
 *
 * PRINCIPIO FUNDAMENTAL: El sistema determina si una operación es REAV
 * ÚNICAMENTE desde la configuración del producto (fiscalRegime, providerPercent,
 * agencyMarginPercent). Ningún otro módulo (factura, TPV, reserva) puede decidir
 * si aplica REAV ni hardcodear porcentajes.
 *
 * FÓRMULAS (Régimen Especial Agencias de Viaje):
 *   costeProveedor  = precio × (coste_pct / 100)
 *   margenAgencia   = precio × (margen_pct / 100)
 *   baseImponible   = margenAgencia / 1.21
 *   iva             = margenAgencia − baseImponible
 *
 * IMPACTO CONTABLE:
 *   - Ingresos = solo margen (nunca PVP)
 *   - IVA = IVA sobre margen
 *   - Facturas: NO mostrar IVA ni desglosar (se mantiene diseño actual)
 */

export interface ProductoFiscal {
  fiscalRegime: "reav" | "general" | "mixed";
  providerPercent: string | number | null;   // % coste proveedor (e.g. 60)
  agencyMarginPercent: string | number | null; // % margen agencia (e.g. 40)
}

export interface LineaREAV {
  productoId: number;
  descripcion: string;
  precio: number;          // PVP de la línea (precio × cantidad)
  costePct: number;        // % coste proveedor (heredado del producto)
  margenPct: number;       // % margen agencia (heredado del producto)
  costeProveedor: number;  // calculado
  margenAgencia: number;   // calculado
  baseImponible: number;   // calculado
  iva: number;             // calculado
}

export interface ResultadoREAV {
  esREAV: boolean;
  lineas: LineaREAV[];
  totales: {
    ventaTotal: number;       // suma de precios (PVP)
    costeTotal: number;       // suma de costes proveedor
    margenTotal: number;      // suma de márgenes agencia
    baseImponibleTotal: number;
    ivaTotal: number;
  };
  errores: string[];          // errores de validación (bloquean la venta)
  advertencias: string[];     // advertencias no bloqueantes
}

/**
 * Valida la configuración fiscal de un producto REAV.
 * Devuelve errores bloqueantes si la configuración es incoherente.
 */
export function validarConfiguracionREAV(producto: ProductoFiscal): string[] {
  const errores: string[] = [];
  if (producto.fiscalRegime !== "reav") return errores;

  const costePct = parseFloat(String(producto.providerPercent ?? 0));
  const margenPct = parseFloat(String(producto.agencyMarginPercent ?? 0));

  if (isNaN(costePct) || costePct <= 0) {
    errores.push("Producto REAV sin porcentaje de coste proveedor configurado.");
  }
  if (isNaN(margenPct) || margenPct <= 0) {
    errores.push("Producto REAV sin porcentaje de margen de agencia configurado.");
  }
  if (!isNaN(costePct) && !isNaN(margenPct) && costePct > 0 && margenPct > 0) {
    const suma = costePct + margenPct;
    if (Math.abs(suma - 100) > 0.5) {
      errores.push(
        `Configuración REAV incoherente: coste (${costePct}%) + margen (${margenPct}%) = ${suma.toFixed(2)}% (debe ser ~100%).`
      );
    }
  }
  return errores;
}

/**
 * Calcula los valores REAV para una línea de producto.
 * Recibe el precio total de la línea (precio unitario × cantidad).
 */
export function calcularLineaREAV(params: {
  productoId: number;
  descripcion: string;
  precio: number;
  producto: ProductoFiscal;
}): LineaREAV {
  const costePct = parseFloat(String(params.producto.providerPercent ?? 0));
  const margenPct = parseFloat(String(params.producto.agencyMarginPercent ?? 0));

  const costeProveedor = parseFloat((params.precio * (costePct / 100)).toFixed(2));
  const margenAgencia = parseFloat((params.precio * (margenPct / 100)).toFixed(2));
  const baseImponible = parseFloat((margenAgencia / 1.21).toFixed(2));
  const iva = parseFloat((margenAgencia - baseImponible).toFixed(2));

  return {
    productoId: params.productoId,
    descripcion: params.descripcion,
    precio: params.precio,
    costePct,
    margenPct,
    costeProveedor,
    margenAgencia,
    baseImponible,
    iva,
  };
}

/**
 * Calcula el resultado REAV completo para un conjunto de líneas de venta.
 * Cada línea incluye el producto con su configuración fiscal.
 *
 * @param lineas - Array de líneas de venta con datos del producto
 * @returns ResultadoREAV con totales, errores de validación y advertencias
 */
export function calcularREAV(lineas: Array<{
  productoId: number;
  descripcion: string;
  precio: number;
  producto: ProductoFiscal;
}>): ResultadoREAV {
  const errores: string[] = [];
  const advertencias: string[] = [];
  const lineasREAV: LineaREAV[] = [];

  const lineasConREAV = lineas.filter(l => l.producto.fiscalRegime === "reav");
  const esREAV = lineasConREAV.length > 0;

  if (!esREAV) {
    return {
      esREAV: false,
      lineas: [],
      totales: { ventaTotal: 0, costeTotal: 0, margenTotal: 0, baseImponibleTotal: 0, ivaTotal: 0 },
      errores,
      advertencias,
    };
  }

  for (const linea of lineasConREAV) {
    // Validar configuración del producto
    const erroresLinea = validarConfiguracionREAV(linea.producto);
    errores.push(...erroresLinea.map(e => `[${linea.descripcion}] ${e}`));

    if (erroresLinea.length === 0) {
      lineasREAV.push(calcularLineaREAV(linea));
    }
  }

  const ventaTotal = parseFloat(lineasREAV.reduce((s, l) => s + l.precio, 0).toFixed(2));
  const costeTotal = parseFloat(lineasREAV.reduce((s, l) => s + l.costeProveedor, 0).toFixed(2));
  const margenTotal = parseFloat(lineasREAV.reduce((s, l) => s + l.margenAgencia, 0).toFixed(2));
  const baseImponibleTotal = parseFloat(lineasREAV.reduce((s, l) => s + l.baseImponible, 0).toFixed(2));
  const ivaTotal = parseFloat(lineasREAV.reduce((s, l) => s + l.iva, 0).toFixed(2));

  return {
    esREAV,
    lineas: lineasREAV,
    totales: { ventaTotal, costeTotal, margenTotal, baseImponibleTotal, ivaTotal },
    errores,
    advertencias,
  };
}

/**
 * Versión simplificada para una sola línea de producto.
 * Útil cuando ya se sabe que el producto es REAV y solo se necesita el cálculo.
 */
export function calcularREAVSimple(precio: number, costePct: number, margenPct: number): {
  costeProveedor: number;
  margenAgencia: number;
  baseImponible: number;
  iva: number;
} {
  const costeProveedor = parseFloat((precio * (costePct / 100)).toFixed(2));
  const margenAgencia = parseFloat((precio * (margenPct / 100)).toFixed(2));
  const baseImponible = parseFloat((margenAgencia / 1.21).toFixed(2));
  const iva = parseFloat((margenAgencia - baseImponible).toFixed(2));
  return { costeProveedor, margenAgencia, baseImponible, iva };
}
