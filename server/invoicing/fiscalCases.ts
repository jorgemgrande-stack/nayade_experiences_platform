/**
 * Tratamiento fiscal por caso del comprador en la facturación propia de Big Elephant (IRON ELEPHANT CONSULTING, S.L.,
 * emisor establecido en la península). Reglas PURAS, sin BD ni red.
 *
 *  - CLASIFICACIÓN: tipo de comprador (empresa o particular) × territorio (península y Baleares, Canarias, Ceuta, Melilla,
 *    UE, territorios especiales de la UE, fuera de la UE) × naturaleza del servicio (hoy solo SaaS prestado por vía
 *    electrónica). Una empresa de la UE solo cuenta como tal con el NIF-IVA VÁLIDO en VIES.
 *  - TRATAMIENTO: cada caso lleva el tratamiento que se desprende de la norma citada, la mención legal de la factura como
 *    PLANTILLA y, salvo el caso vigente (empresa de la península y Baleares), `requiresAdvisor: true` con la pregunta
 *    concreta para la gestoría. Donde la norma no permite decidir sin análisis (`undetermined`), no se inventa nada: el
 *    caso no se puede activar.
 *  - ACTIVACIÓN: todo caso distinto de `business:es_mainland` está DESACTIVADO por defecto. Se activa solo con
 *    `CP_INVOICING_FISCAL_CASES` (lista separada por comas) y, para las facturas simplificadas, `CP_INVOICING_SIMPLIFIED=1`.
 *    Activarlo aquí no cambia quién puede comprar: eso lo decide la elegibilidad de Stripe (CP_STRIPE_FISCAL_SCENARIOS).
 *    Un caso desactivado se bloquea exactamente como hasta ahora.
 *
 * Los tratamientos se derivan de la MATRIZ FISCAL versionada (`fiscalMatrix.ts`): estado, impuesto, mención, norma,
 * obligaciones, evidencias y decisiones previas por caso. Un caso bloqueado en la matriz no se puede activar.
 *
 * Nada de esto es asesoramiento fiscal: es la preparación técnica para cuando la gestoría confirme cada supuesto.
 */
import type { BuyerType, Territory } from "../stripe/buyerProfile";
import { isActivatable, LEGAL_REFS, ruleFor, type EuB2cRegime, type FiscalRule } from "./fiscalMatrix";
import { isValidSpanishTaxId } from "./rules";

/** Naturaleza del servicio facturado. Solo existe una: la suscripción SaaS (servicio prestado por vía electrónica). */
export type ServiceNature = "electronic_saas";

export const FISCAL_CASES = [
  "business:es_mainland",
  "consumer:es_mainland",
  "business:es_canarias",
  "business:es_ceuta",
  "business:es_melilla",
  "consumer:es_canarias",
  "consumer:es_ceuta",
  "consumer:es_melilla",
  "business:eu_vies",
  "business:eu_unverified",
  "consumer:eu",
  "business:eu_special",
  "consumer:eu_special",
  "business:non_eu",
  "consumer:non_eu",
] as const;
export type FiscalCase = (typeof FISCAL_CASES)[number];

/** El único caso vigente (aprobado y a la venta): siempre activo, con el comportamiento de siempre. */
export const BASE_CASE: FiscalCase = "business:es_mainland";

export type TreatmentCode = "taxed_es" | "not_subject" | "reverse_charge" | "oss_destination" | "undetermined";

export interface FiscalTreatment {
  case: FiscalCase;
  code: TreatmentCode;
  /** Tipo de IVA esperado en puntos básicos: 2100, 0, o null (el del Estado de destino, o sin determinar). */
  expectedRateBp: number | null;
  /** Fundamento normativo citado (artículos). */
  legalBasis: string[];
  /** Plantilla de la mención legal de la factura ({territorio} se sustituye); null = sin mención. */
  mention: string | null;
  requiresAdvisor: boolean;
  /** Identificadores de `ADVISOR_QUESTIONS` que afectan a este caso. */
  advisor: string[];
  /** Trámites previos de Big Elephant antes de poder activarlo. */
  prerequisites: string[];
  /** Si se puede activar por configuración (un caso sin determinar, nunca). */
  activatable: boolean;
}

/**
 * Supuestos que debe confirmar la gestoría, con la norma en que se apoya cada uno y la pregunta concreta. Es la lista
 * de referencia (docs/elephant-source/FACTURACION_FISCAL.md la reproduce).
 */
export const ADVISOR_QUESTIONS: Record<string, { basis: string; question: string }> = {
  devengo_cobro_anticipado: {
    basis: "Ley 37/1992, art. 75.Uno.7.º y art. 75.Dos",
    question:
      "En las suscripciones cobradas por Stripe al inicio de cada periodo, ¿es correcto tomar como fecha de devengo (fecha de operación) la del cobro cuando es anterior o igual al inicio del periodo (art. 75.Dos), y la del inicio del periodo (exigibilidad, art. 75.Uno.7.º) cuando el cobro llega después por un reintento?",
  },
  periodo_prestacion: {
    basis: "Real Decreto 1619/2012, art. 6.1 (fecha de las operaciones o del pago anticipado cuando es distinta de la de expedición, y descripción de la operación)",
    question: "¿Basta con indicar el periodo de prestación (desde–hasta) en la línea y en la cabecera, junto a la fecha de operación, o debe constar de otra forma?",
  },
  descuento_por_linea: {
    basis: "Ley 37/1992, art. 78.Tres.2.º (descuentos simultáneos a la operación fuera de la base); Real Decreto 1619/2012, art. 6.1.f) (descuentos no incluidos en el precio unitario)",
    question:
      "Cuando Stripe aplica un cupón a toda la factura, ¿es correcto repartir el descuento entre las líneas en proporción a su importe (como hace Stripe) y mostrar por línea el importe bruto, el descuento y la base, comprobando que la cuota de cada línea es la cobrada?",
  },
  saldo_a_favor: {
    basis: "Ley 37/1992, art. 78.Tres.2.º y art. 80.Dos (modificación de la base por descuentos posteriores a la operación)",
    question:
      "El saldo a favor del cliente en Stripe (créditos por prorrateos anteriores) se trata como forma de pago y no reduce la base. ¿Es correcto, o alguno de esos saldos debe documentarse como rectificativa de la factura que lo originó?",
  },
  consumidor_peninsula: {
    basis: "Ley 37/1992, art. 69.Uno.2.º y art. 90.Uno",
    question: "¿Confirma que la suscripción SaaS a particulares de la península y Baleares tributa al 21 % por la sede del prestador?",
  },
  factura_simplificada: {
    basis: "Real Decreto 1619/2012, art. 4.1.a) (≤ 400 € IVA incluido) y art. 7",
    question:
      "¿Procede la factura simplificada (serie propia EBS) para particulares sin NIF de la península y Baleares hasta 400 € IVA incluido, con el contenido del art. 7? El límite de 3.000 € del art. 4.2 solo alcanza a los sectores que enumera, entre los que no está el SaaS: ¿confirma que no se aplica?",
  },
  rectificativa_simplificada: {
    basis: "Real Decreto 1619/2012, art. 15, art. 4.1.b) y art. 7.1.a)",
    question: "Las rectificativas de facturas simplificadas son a su vez simplificadas (art. 4.1.b) y, como el art. 7.1.a) obliga a separar en series las simplificadas de las completas del mismo año, van en su serie propia EBSR (las de completas, en EBR). ¿Conforme?",
  },
  canarias_ceuta_melilla_empresa: {
    basis: "Ley 37/1992, art. 3.Uno y art. 69.Uno.1.º; Ley 20/1991 (IGIC), art. 19.1.2.º; IPSI de Ceuta y Melilla",
    question:
      "Venta SaaS a empresas o profesionales establecidos en Canarias, Ceuta o Melilla: ¿confirma que es operación no sujeta al IVA (servicio localizado en la sede del destinatario, fuera del territorio de aplicación), el texto de la mención y que no tenemos obligaciones formales de IGIC o IPSI como prestadores (inversión del sujeto pasivo en Canarias)?",
  },
  canarias_ceuta_melilla_particular: {
    basis: "Ley 37/1992, art. 69.Uno.2.º y art. 69.Dos (la excepción no alcanza a Canarias, Ceuta y Melilla); Ley 20/1991 (IGIC); IPSI",
    question: "Venta SaaS a particulares de Canarias, Ceuta o Melilla: ¿qué impuesto se repercute (IVA español, IGIC o IPSI) y qué registros nos exige? Hoy no se puede activar.",
  },
  ue_empresa_isp: {
    basis: "Ley 37/1992, art. 69.Uno.1.º; Directiva 2006/112/CE, arts. 44 y 196; Real Decreto 1619/2012, art. 6.1 (mención «Inversión del sujeto pasivo»); Reglamento de Ejecución (UE) 282/2011, art. 18",
    question:
      "Venta SaaS a empresas de otro Estado miembro con NIF-IVA válido en VIES: ¿confirma la no sujeción en España con la mención «Inversión del sujeto pasivo», la declaración en el modelo 349 y que antes debemos estar dados de alta en el Registro de Operadores Intracomunitarios (hoy nuestro NIF-IVA no consta válido en VIES)?",
  },
  ue_empresa_sin_vies: {
    basis: "Reglamento de Ejecución (UE) 282/2011, art. 18; Ley 37/1992, art. 69",
    question: "Empresa de la UE cuyo NIF-IVA no es válido en VIES: ¿se trata como particular (IVA del país de destino por OSS o el español bajo el umbral) o no se le vende? Hoy no se puede activar.",
  },
  ue_particular_oss: {
    basis: "Directiva 2006/112/CE, art. 58; Ley 37/1992, art. 73 (umbral de 10.000 €) y régimen de la Unión (arts. 163 unvicies y siguientes); Reglamento de Ejecución (UE) 282/2011, art. 24 ter",
    question:
      "Particulares de otros Estados miembros: ¿se aplica desde el primer euro el IVA del país del cliente con el régimen de la Unión (alta en OSS, modelo 035, declaración en el 369), o el IVA español mientras no se superen los 10.000 € (art. 73)? ¿Qué pruebas de localización conservamos? ¿Qué factura se expide (completa, simplificada o ninguna)?",
  },
  ue_territorio_especial: {
    basis: "Directiva 2006/112/CE, art. 6; Ley 37/1992, art. 3",
    question: "Compradores de territorios de la UE excluidos del IVA comunitario (ultramar francés, Åland, Monte Athos…): ¿qué tratamiento procede? Hoy no se puede activar.",
  },
  tercer_pais_empresa: {
    basis: "Ley 37/1992, art. 69.Uno.1.º y art. 70.Dos (utilización o explotación efectivas)",
    question:
      "Venta SaaS a empresas establecidas fuera de la UE: ¿confirma la no sujeción en España, el texto de la mención, la prueba suficiente de su condición de empresario (identificador fiscal) y que no aplica la regla de utilización efectiva del art. 70.Dos?",
  },
  tercer_pais_particular: {
    basis: "Ley 37/1992, arts. 69.Uno.2.º, 69.Dos (texto vigente, sin los servicios electrónicos) y 70.Uno.4.º; Directiva 2006/112/CE, art. 58",
    question: "Venta SaaS a particulares de fuera de la UE: el art. 69.Dos vigente ya no incluye los servicios prestados por vía electrónica. ¿Se entienden realizados en España por la regla general (art. 69.Uno.2.º) o fuera, por el art. 58 de la Directiva? ¿Qué países exigen registro propio desde la primera venta (Reino Unido, Suiza, Noruega, EE. UU.…)? Hoy no se puede activar.",
  },
};

/** Tratamiento de una regla de la matriz (`fiscalMatrix.ts`), con la forma de siempre. */
function treatmentOfRule(r: FiscalRule): FiscalTreatment {
  return {
    case: r.case,
    code: r.treatment,
    expectedRateBp: r.tax.rateBp,
    legalBasis: r.legal.map((id) => LEGAL_REFS[id].label),
    mention: r.mention,
    requiresAdvisor: r.advisor.length > 0,
    advisor: r.advisor,
    prerequisites: r.decisions.filter((d) => d.kind === "censal" || d.kind === "tecnica").map((d) => d.text),
    activatable: r.status !== "blocked",
  };
}

/** Tratamiento por caso, derivado de la matriz (para `consumer:eu`, la fila sin régimen declarado: bloqueada). */
export const TREATMENTS: Record<FiscalCase, FiscalTreatment> = Object.fromEntries(FISCAL_CASES.map((c) => [c, treatmentOfRule(ruleFor(c))])) as Record<FiscalCase, FiscalTreatment>;

/** Tratamiento del caso con la configuración (el régimen declarado de los particulares de la UE). */
export const treatmentOf = (c: FiscalCase, cfg: Pick<FiscalCasesConfig, "euB2cRegime"> = NO_EXTRA_CASES): FiscalTreatment => treatmentOfRule(ruleFor(c, cfg.euB2cRegime));

const TERRITORY_NAME: Partial<Record<Territory, string>> = { es_canarias: "Canarias", es_ceuta: "Ceuta", es_melilla: "Melilla" };

/** Caso fiscal de un comprador. Una empresa de la UE solo es `eu_vies` con el NIF-IVA válido en VIES. */
export function fiscalCaseOf(i: { type: BuyerType; territory: Territory; viesValid?: boolean; nature?: ServiceNature }): FiscalCase {
  const t = i.territory;
  if (t === "es_mainland") return `${i.type}:es_mainland`;
  if (t === "es_canarias" || t === "es_ceuta" || t === "es_melilla") return `${i.type}:${t}`;
  if (t === "eu") return i.type === "consumer" ? "consumer:eu" : i.viesValid ? "business:eu_vies" : "business:eu_unverified";
  if (t === "eu_special") return `${i.type}:eu_special`;
  return `${i.type}:non_eu`;
}

/** Mención legal del caso con el territorio sustituido (null = ninguna). */
export function legalMentionOf(c: FiscalCase, territory?: Territory | null): string | null {
  const m = TREATMENTS[c].mention;
  return m ? m.replace("{territorio}", (territory && TERRITORY_NAME[territory]) || "su territorio") : null;
}

export class InvoicingConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvoicingConfigError";
  }
}

export interface FiscalCasesConfig {
  /** Casos activados además del vigente. Vacío = solo `business:es_mainland` (el comportamiento de siempre). */
  enabled: Set<FiscalCase>;
  /** Facturas simplificadas para particulares sin NIF (serie propia). */
  simplified: boolean;
  /**
   * Régimen de los particulares de otros Estados miembros (art. 73 Ley 37/1992), DECLARADO por Big Elephant
   * (`CP_INVOICING_EU_B2C_REGIME`): sin superar el umbral ni optar (IVA español) o en destino por el régimen de la Unión.
   * null = sin declarar: `consumer:eu` bloqueado. Nunca se infiere.
   */
  euB2cRegime: EuB2cRegime | null;
}

export const NO_EXTRA_CASES: FiscalCasesConfig = { enabled: new Set(), simplified: false, euB2cRegime: null };

/**
 * `CP_INVOICING_FISCAL_CASES` (casos separados por comas) y `CP_INVOICING_SIMPLIFIED=1`. Sin ellas, nada activado. Un
 * caso desconocido o que no se puede activar impide arrancar (nunca se interpreta a medias).
 */
export function fiscalCasesFromEnv(env: NodeJS.ProcessEnv = process.env): FiscalCasesConfig {
  const enabled = new Set<FiscalCase>();
  const r = (env.CP_INVOICING_EU_B2C_REGIME ?? "").trim();
  if (r && r !== "below_threshold" && r !== "destination_oss") throw new InvoicingConfigError("CP_INVOICING_EU_B2C_REGIME: solo «below_threshold» o «destination_oss»");
  const euB2cRegime: EuB2cRegime | null = r ? (r as EuB2cRegime) : null;
  for (const raw of (env.CP_INVOICING_FISCAL_CASES ?? "").split(",")) {
    const c = raw.trim().toLowerCase();
    if (!c || c === BASE_CASE) continue;
    if (!(FISCAL_CASES as readonly string[]).includes(c)) throw new InvoicingConfigError(`CP_INVOICING_FISCAL_CASES: caso desconocido «${c}» (admitidos: ${FISCAL_CASES.filter((x) => isActivatable(x, euB2cRegime) && x !== BASE_CASE).join(", ")})`);
    if (!isActivatable(c as FiscalCase, euB2cRegime)) throw new InvoicingConfigError(`CP_INVOICING_FISCAL_CASES: el caso «${c}» está bloqueado en la matriz fiscal (${ruleFor(c as FiscalCase, euB2cRegime).blockedReason}) y no se puede activar`);
    enabled.add(c as FiscalCase);
  }
  const s = (env.CP_INVOICING_SIMPLIFIED ?? "").trim();
  if (s && s !== "0" && s !== "1") throw new InvoicingConfigError("CP_INVOICING_SIMPLIFIED: solo «0» o «1»");
  return { enabled, simplified: s === "1", euB2cRegime };
}

export const isCaseEnabled = (c: FiscalCase, cfg: FiscalCasesConfig) => c === BASE_CASE || cfg.enabled.has(c);

/** Límite general de la factura simplificada: 400 € IVA incluido (art. 4.1.a del RD 1619/2012). */
export const SIMPLIFIED_LIMIT_CENTS = 40_000;

/**
 * ¿Factura simplificada o completa? Un particular CON NIF recibe factura completa. Sin NIF, simplificada solo si está
 * activada, el caso es un particular de la península y Baleares (IVA español) y el total no pasa de 400 € IVA incluido.
 * Si no, el motivo del bloqueo.
 */
export function simplifiedDecision(i: { fiscalCase: FiscalCase; hasTaxId: boolean; totalCents: number; cfg: FiscalCasesConfig }): { invoiceType: "complete" | "simplified"; problem: string | null } {
  if (i.hasTaxId) return { invoiceType: "complete", problem: null };
  if (!i.fiscalCase.startsWith("consumer:")) return { invoiceType: "complete", problem: "falta el NIF" };
  if (!i.cfg.simplified) return { invoiceType: "complete", problem: "falta el NIF (las facturas simplificadas para particulares no están activadas: CP_INVOICING_SIMPLIFIED)" };
  // Solo con IVA español (art. 4 RD 1619/2012): particulares de la península y Baleares o de la UE bajo el umbral del art. 73
  if (!ruleFor(i.fiscalCase, i.cfg.euB2cRegime).simplifiedAllowed) return { invoiceType: "complete", problem: "falta el NIF: la factura simplificada solo está preparada para particulares de la península y Baleares (o de otros Estados miembros con IVA español bajo el umbral del art. 73)" };
  if (i.totalCents > SIMPLIFIED_LIMIT_CENTS) {
    const eur = (c: number) => `${(c / 100).toFixed(2).replace(".", ",")} €`;
    return { invoiceType: "complete", problem: `el total (${eur(i.totalCents)}) supera el límite de la factura simplificada (400 € IVA incluido, art. 4.1.a del RD 1619/2012): hacen falta el NIF y el domicilio del cliente para la factura completa` };
  }
  return { invoiceType: "simplified", problem: null };
}

/** Problemas del IVA cobrado frente al tratamiento del caso (activado). Vacío = casa. */
export function rateProblems(lines: Array<{ taxRateBp: number; taxCents: number }>, t: FiscalTreatment): string[] {
  const pct = (bp: number) => `${(bp / 100).toLocaleString("es-ES")} %`;
  if (t.code === "undetermined") return [`el caso fiscal ${t.case} no tiene un tratamiento determinado`];
  if (t.expectedRateBp !== null) {
    const rates = Array.from(new Set(lines.filter((l) => l.taxRateBp !== t.expectedRateBp).map((l) => l.taxRateBp)));
    return rates.length ? [`el IVA cobrado en Stripe (${rates.map(pct).join(", ")}) no es el ${pct(t.expectedRateBp)} que corresponde al caso ${t.case}: requiere revisión fiscal`] : [];
  }
  // Destino (OSS): lo calcula Stripe Tax con el tipo del país del cliente; debe haber impuesto y un único tipo
  const rates = Array.from(new Set(lines.filter((l) => l.taxCents !== 0).map((l) => l.taxRateBp)));
  if (!lines.some((l) => l.taxCents > 0)) return [`el caso ${t.case} lleva el IVA del país del cliente y Stripe no cobró impuesto`];
  return rates.length > 1 ? [`el caso ${t.case} lleva un único tipo del país del cliente y Stripe cobró varios (${rates.map(pct).join(", ")})`] : [];
}

/**
 * NIF del comprador para la factura completa de un caso activado: español con su letra de control; de otro país, con
 * forma mínima (la validez de un NIF-IVA de la UE la da VIES al clasificar el caso, nunca su formato).
 */
export function isValidCaseTaxId(country: string, taxId: string): boolean {
  if (country === "ES") return isValidSpanishTaxId(taxId);
  return /^[A-Z0-9]{4,40}$/.test(taxId);
}
