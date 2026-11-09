/**
 * Contabilidad general de cada empresa (extra `accounting-general`): constantes compartidas por el servidor
 * (server/accountingGeneral) y el panel (/admin/contabilidad/general). Importes en céntimos enteros; el saldo de una
 * cuenta es debe − haber (positivo = deudor).
 */

export const ACC_CAPABILITY = "accounting-general";

export const ACC_ACCOUNT_TYPES = ["asset", "liability", "equity", "income", "expense"] as const;
export type AccAccountType = (typeof ACC_ACCOUNT_TYPES)[number];
export const ACC_ACCOUNT_TYPE_LABELS: Record<AccAccountType, string> = {
  asset: "Activo",
  liability: "Pasivo",
  equity: "Patrimonio neto",
  income: "Ingreso",
  expense: "Gasto",
};

/** Diarios: los mismos códigos que las finanzas corporativas (server/finance/types.ts). */
export const ACC_JOURNALS = ["GEN", "VEN", "COM", "BAN", "CAJ", "APE"] as const;
export type AccJournal = (typeof ACC_JOURNALS)[number];
export const ACC_JOURNAL_LABELS: Record<AccJournal, string> = {
  GEN: "General",
  VEN: "Ventas",
  COM: "Compras y gastos",
  BAN: "Bancos",
  CAJ: "Caja",
  APE: "Apertura",
};
/** Diarios de los asientos manuales. */
export const ACC_MANUAL_JOURNALS = ["GEN", "APE"] as const;

export const ACC_ORIGINS = ["manual", "invoice", "ticket", "collection", "expense", "payment", "cash_close", "cash_move", "reversal"] as const;
export type AccOrigin = (typeof ACC_ORIGINS)[number];
export const ACC_ORIGIN_LABELS: Record<AccOrigin, string> = {
  manual: "Manual",
  invoice: "Factura o abono",
  ticket: "Ticket de caja",
  collection: "Cobro",
  expense: "Gasto",
  payment: "Pago",
  cash_close: "Cierre de caja",
  cash_move: "Movimiento de caja",
  reversal: "Reversión",
};

/** Cuentas que usan los asientos automáticos (editables en Ajustes; deben existir, estar activas y ser imputables). */
export const ACC_MAP_KEYS = [
  "customers",
  "sales",
  "vatOutput",
  "vatInput",
  "suppliers",
  "payroll",
  "withholding",
  "cash",
  "bank",
  "card",
  "cashBridge",
  "centralCash",
  "deposits",
  "defaultExpense",
  "cashShortage",
  "cashOverage",
] as const;
export type AccMapKey = (typeof ACC_MAP_KEYS)[number];
export type AccAccountMap = Record<AccMapKey, string>;

export const ACC_DEFAULT_MAP: AccAccountMap = {
  customers: "430",
  sales: "700",
  vatOutput: "477",
  vatInput: "472",
  suppliers: "410",
  payroll: "465",
  withholding: "4751",
  cash: "570",
  bank: "572",
  card: "572",
  cashBridge: "555",
  centralCash: "5701",
  deposits: "560",
  defaultExpense: "629",
  cashShortage: "678",
  cashOverage: "778",
};

export const ACC_MAP_LABELS: Record<AccMapKey, string> = {
  customers: "Clientes (facturas emitidas y cobros)",
  sales: "Ventas e ingresos (base de facturas, abonos y tickets)",
  vatOutput: "IVA repercutido",
  vatInput: "IVA soportado deducible",
  suppliers: "Proveedores y acreedores (gastos)",
  payroll: "Remuneraciones pendientes (nóminas y Seguridad Social de RRHH)",
  withholding: "Retenciones practicadas (IRPF de gastos)",
  cash: "Caja (efectivo)",
  bank: "Banco (transferencias, domiciliaciones y otros cobros)",
  card: "Cobros con tarjeta, Bizum y pasarela",
  cashBridge: "Puente de caja (gastos pagados desde la caja del TPV y movimientos sin tipo)",
  centralCash: "Caja Central (traspasos y fondos de la caja del TPV)",
  deposits: "Fianzas recibidas (fianzas del alquiler cobradas y devueltas en caja)",
  defaultExpense: "Gasto por defecto (categorías sin cuenta)",
  cashShortage: "Faltantes de caja",
  cashOverage: "Sobrantes de caja",
};

/** Subconjunto del PGC de pymes que se siembra al empezar (el mismo de las finanzas corporativas, adaptado). */
export const ACC_PGC_SEED: ReadonlyArray<{ code: string; name: string; type: AccAccountType; parentCode?: string }> = [
  { code: "100", name: "Capital social", type: "equity" },
  { code: "112", name: "Reserva legal", type: "equity" },
  { code: "113", name: "Reservas voluntarias", type: "equity" },
  { code: "120", name: "Remanente", type: "equity" },
  { code: "121", name: "Resultados negativos de ejercicios anteriores", type: "equity" },
  { code: "129", name: "Resultado del ejercicio", type: "equity" },
  { code: "170", name: "Deudas a largo plazo con entidades de crédito", type: "liability" },
  { code: "206", name: "Aplicaciones informáticas", type: "asset" },
  { code: "211", name: "Construcciones", type: "asset" },
  { code: "213", name: "Maquinaria", type: "asset" },
  { code: "216", name: "Mobiliario", type: "asset" },
  { code: "217", name: "Equipos para procesos de información", type: "asset" },
  { code: "218", name: "Elementos de transporte", type: "asset" },
  { code: "280", name: "Amortización acumulada del inmovilizado intangible", type: "asset" },
  { code: "281", name: "Amortización acumulada del inmovilizado material", type: "asset" },
  { code: "300", name: "Mercaderías", type: "asset" },
  { code: "400", name: "Proveedores", type: "liability" },
  { code: "410", name: "Acreedores por prestaciones de servicios", type: "liability" },
  { code: "430", name: "Clientes", type: "asset" },
  { code: "436", name: "Clientes de dudoso cobro", type: "asset" },
  { code: "438", name: "Anticipos de clientes", type: "liability" },
  { code: "440", name: "Deudores", type: "asset" },
  { code: "460", name: "Anticipos de remuneraciones", type: "asset" },
  { code: "465", name: "Remuneraciones pendientes de pago", type: "liability" },
  { code: "4700", name: "Hacienda Pública, deudora por IVA", type: "asset" },
  { code: "4709", name: "Hacienda Pública, deudora por devolución de impuestos", type: "asset" },
  { code: "471", name: "Organismos de la Seguridad Social, deudores", type: "asset" },
  { code: "472", name: "Hacienda Pública, IVA soportado", type: "asset" },
  { code: "473", name: "Hacienda Pública, retenciones y pagos a cuenta", type: "asset" },
  { code: "4750", name: "Hacienda Pública, acreedora por IVA", type: "liability" },
  { code: "4751", name: "Hacienda Pública, acreedora por retenciones practicadas", type: "liability" },
  { code: "4752", name: "Hacienda Pública, acreedora por impuesto sobre sociedades", type: "liability" },
  { code: "476", name: "Organismos de la Seguridad Social, acreedores", type: "liability" },
  { code: "477", name: "Hacienda Pública, IVA repercutido", type: "liability" },
  { code: "520", name: "Deudas a corto plazo con entidades de crédito", type: "liability" },
  { code: "551", name: "Cuenta corriente con socios y administradores", type: "asset" },
  { code: "555", name: "Partidas pendientes de aplicación", type: "asset" },
  { code: "560", name: "Fianzas recibidas a corto plazo", type: "liability" },
  { code: "570", name: "Caja, euros", type: "asset" },
  { code: "5701", name: "Caja central", type: "asset", parentCode: "570" },
  { code: "572", name: "Bancos e instituciones de crédito c/c vista, euros", type: "asset" },
  { code: "600", name: "Compras de mercaderías", type: "expense" },
  { code: "607", name: "Trabajos realizados por otras empresas", type: "expense" },
  { code: "621", name: "Arrendamientos y cánones", type: "expense" },
  { code: "622", name: "Reparaciones y conservación", type: "expense" },
  { code: "623", name: "Servicios de profesionales independientes", type: "expense" },
  { code: "624", name: "Transportes", type: "expense" },
  { code: "625", name: "Primas de seguros", type: "expense" },
  { code: "626", name: "Servicios bancarios y similares", type: "expense" },
  { code: "627", name: "Publicidad, propaganda y relaciones públicas", type: "expense" },
  { code: "628", name: "Suministros", type: "expense" },
  { code: "629", name: "Otros servicios", type: "expense" },
  { code: "630", name: "Impuesto sobre beneficios", type: "expense" },
  { code: "631", name: "Otros tributos", type: "expense" },
  { code: "640", name: "Sueldos y salarios", type: "expense" },
  { code: "642", name: "Seguridad Social a cargo de la empresa", type: "expense" },
  { code: "649", name: "Otros gastos sociales", type: "expense" },
  { code: "662", name: "Intereses de deudas", type: "expense" },
  { code: "669", name: "Otros gastos financieros", type: "expense" },
  { code: "678", name: "Gastos excepcionales", type: "expense" },
  { code: "680", name: "Amortización del inmovilizado intangible", type: "expense" },
  { code: "681", name: "Amortización del inmovilizado material", type: "expense" },
  { code: "700", name: "Ventas de mercaderías", type: "income" },
  { code: "705", name: "Prestaciones de servicios", type: "income" },
  { code: "706", name: "Descuentos sobre ventas por pronto pago", type: "income" },
  { code: "708", name: "Devoluciones de ventas y operaciones similares", type: "income" },
  { code: "740", name: "Subvenciones, donaciones y legados a la explotación", type: "income" },
  { code: "759", name: "Ingresos por servicios diversos", type: "income" },
  { code: "769", name: "Otros ingresos financieros", type: "income" },
  { code: "778", name: "Ingresos excepcionales", type: "income" },
];

/** Partidas de la cuenta de pérdidas y ganancias (modelo de pymes), en su orden. */
export const ACC_PNL_ITEMS = [
  { key: "p1", label: "1. Importe neto de la cifra de negocios", block: "operating" },
  { key: "p2", label: "2. Variación de existencias de productos terminados y en curso", block: "operating" },
  { key: "p3", label: "3. Trabajos realizados por la empresa para su activo", block: "operating" },
  { key: "p4", label: "4. Aprovisionamientos", block: "operating" },
  { key: "p5", label: "5. Otros ingresos de explotación", block: "operating" },
  { key: "p6", label: "6. Gastos de personal", block: "operating" },
  { key: "p7", label: "7. Otros gastos de explotación", block: "operating" },
  { key: "p8", label: "8. Amortización del inmovilizado", block: "operating" },
  { key: "p9", label: "9. Imputación de subvenciones de inmovilizado no financiero y otras", block: "operating" },
  { key: "p10", label: "10. Excesos de provisiones", block: "operating" },
  { key: "p11", label: "11. Deterioro y resultado por enajenaciones del inmovilizado", block: "operating" },
  { key: "p12", label: "12. Otros resultados", block: "operating" },
  { key: "p13", label: "13. Ingresos financieros", block: "financial" },
  { key: "p14", label: "14. Gastos financieros", block: "financial" },
  { key: "p15", label: "15. Variación de valor razonable en instrumentos financieros", block: "financial" },
  { key: "p16", label: "16. Diferencias de cambio", block: "financial" },
  { key: "p17", label: "17. Deterioro y resultado por enajenaciones de instrumentos financieros", block: "financial" },
  { key: "p18", label: "18. Impuestos sobre beneficios", block: "tax" },
] as const;
export type AccPnlKey = (typeof ACC_PNL_ITEMS)[number]["key"];

/** ¿Es una fecha «AAAA-MM-DD» de calendario? (mismo criterio que server/finance/rules.ts). */
export function isAccDate(s: unknown): s is string {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1) return false;
  return d <= new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Código de cuenta del PGC: de 3 a 12 dígitos. */
export const isAccCode = (s: unknown): s is string => typeof s === "string" && /^\d{3,12}$/.test(s);
