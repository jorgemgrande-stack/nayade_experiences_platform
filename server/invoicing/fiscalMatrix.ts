/**
 * MATRIZ FISCAL versionada de la facturación propia de Big Elephant (IRON ELEPHANT CONSULTING, S.L., prestador
 * establecido únicamente en la península). Datos y reglas PURAS, sin BD ni red. Es la única fuente de los tratamientos:
 * `fiscalCases.ts` deriva de aquí `TREATMENTS` y las menciones.
 *
 * Cada regla (caso del comprador × territorio, y para particulares de la UE la variante del art. 73) declara:
 *  - `status`: `enabled` (vigente y a la venta), `ready` (la norma consultada determina el tratamiento: se puede activar
 *    por configuración cuando Big Elephant tome las decisiones que se indican) o `blocked` (la norma consultada no basta
 *    para determinarlo con seguridad; `blockedReason` dice por qué). Nada se activa solo: ni el alta en el ROI o la OSS,
 *    ni abrir un territorio a la venta (eso es CP_STRIPE_FISCAL_SCENARIOS, que esta matriz nunca toca).
 *  - impuesto, tipo y quién lo ingresa; mención legal; norma con su URL oficial (`LEGAL_REFS`, con `verified` = el texto
 *    se abrió y se cotejó; si no, queda «pendiente de cotejo con el texto oficial»); obligaciones censales y declarativas;
 *    evidencias que deben constar en cada factura; decisiones previas.
 *
 * `FISCAL_MATRIX_VERSION` se guarda en cada factura expedida junto con la regla aplicada: si la matriz cambia, cambia la
 * versión, y cada factura conserva con qué regla se expidió. Nada de esto es asesoramiento fiscal.
 */
import type { BuyerType, Territory } from "../stripe/buyerProfile";
import type { FiscalCase, TreatmentCode } from "./fiscalCases";

/** Versión de la matriz. Cambia con cualquier cambio de regla, mención, evidencia exigida o estado. */
export const FISCAL_MATRIX_VERSION = "2026-11-03.1";

export type RuleStatus = "enabled" | "ready" | "blocked";

/** Régimen de los particulares de otros Estados miembros (art. 73 Ley 37/1992): declarado, nunca inferido. */
export type EuB2cRegime = "below_threshold" | "destination_oss";

/** Variante de regla: el caso tal cual o, para `consumer:eu`, según el régimen declarado. */
export type RuleId = FiscalCase | `consumer:eu@${EuB2cRegime}`;

export interface LegalRef {
  label: string;
  url: string;
  /** true = texto abierto y cotejado (03/11/2026); false = pendiente de cotejo con el texto oficial. */
  verified: boolean;
}

const BOE_LIVA = "https://www.boe.es/buscar/act.php?id=BOE-A-1992-28740";
const BOE_RD = "https://www.boe.es/buscar/act.php?id=BOE-A-2012-14696";
const BOE_IGIC = "https://www.boe.es/buscar/act.php?id=BOE-A-1991-14463";

/**
 * Referencias normativas. Las de BOE se cotejaron con el texto consolidado vigente (servicio de datos abiertos del BOE,
 * mismo texto que la URL). Los reglamentos de la UE, con su publicación en el DOUE reproducida por el BOE. La Directiva
 * 2006/112/CE no se pudo abrir (EUR-Lex rechaza la descarga automática): pendiente de cotejo.
 */
export const LEGAL_REFS = {
  liva_3: { label: "Ley 37/1992, art. 3 (territorio de aplicación: excluye Canarias, Ceuta y Melilla)", url: `${BOE_LIVA}#a3`, verified: true },
  liva_69_1_1: { label: "Ley 37/1992, art. 69.Uno.1.º (destinatario empresario: sede del destinatario)", url: `${BOE_LIVA}#a69`, verified: true },
  liva_69_1_2: { label: "Ley 37/1992, art. 69.Uno.2.º (destinatario no empresario: sede del prestador)", url: `${BOE_LIVA}#a69`, verified: true },
  liva_69_2: { label: "Ley 37/1992, art. 69.Dos (excepciones para no empresarios fuera de la Comunidad; no incluye los servicios prestados por vía electrónica)", url: `${BOE_LIVA}#a69`, verified: true },
  liva_69_3_4: { label: "Ley 37/1992, art. 69.Tres.4.º (servicios prestados por vía electrónica: suministro y alojamiento de sitios informáticos, programas…)", url: `${BOE_LIVA}#a69`, verified: true },
  liva_70_1_4: { label: "Ley 37/1992, art. 70.Uno.4.º (servicios electrónicos a no empresarios establecidos en el territorio de aplicación)", url: `${BOE_LIVA}#a70`, verified: true },
  liva_70_1_8: { label: "Ley 37/1992, art. 70.Uno.8.º (servicios electrónicos de un prestador establecido solo en España a no empresarios de otro Estado miembro, sin superar el límite del art. 73 ni optar)", url: `${BOE_LIVA}#a70`, verified: true },
  liva_70_2: { label: "Ley 37/1992, art. 70.Dos (utilización o explotación efectivas: solo servicios del art. 69.Dos a no empresarios y arrendamiento de medios de transporte)", url: `${BOE_LIVA}#a70`, verified: true },
  liva_73: { label: "Ley 37/1992, art. 73 (límite de 10.000 € del año natural precedente; al superarlo en el año en curso, destino; opción mínima de dos años naturales; sin fraccionar)", url: `${BOE_LIVA}#a73`, verified: true },
  liva_75_1_7: { label: "Ley 37/1992, art. 75.Uno.7.º (tracto sucesivo: devengo al resultar exigible cada parte del precio)", url: `${BOE_LIVA}#a75`, verified: true },
  liva_75_2: { label: "Ley 37/1992, art. 75.Dos (pagos anticipados: devengo en el cobro por los importes percibidos)", url: `${BOE_LIVA}#a75`, verified: true },
  liva_78_3_2: { label: "Ley 37/1992, art. 78.Tres.2.º (descuentos previos o simultáneos fuera de la base)", url: `${BOE_LIVA}#a78`, verified: true },
  liva_80_2: { label: "Ley 37/1992, art. 80.Dos (modificación de la base si se altera el precio después de la operación)", url: `${BOE_LIVA}#a80`, verified: true },
  liva_90_1: { label: "Ley 37/1992, art. 90.Uno (tipo general del 21 %)", url: `${BOE_LIVA}#a90`, verified: true },
  liva_163_unvicies: { label: "Ley 37/1992, arts. 163 unvicies y 163 duovicies (régimen de la Unión: ámbito y obligaciones formales)", url: `${BOE_LIVA}#a163unvicies`, verified: true },
  liva_164_1: { label: "Ley 37/1992, art. 164.Uno.1.º, 2.º, 3.º y 5.º (declaraciones censales, NIF, factura y declaración recapitulativa)", url: `${BOE_LIVA}#a164`, verified: true },
  rd_4: { label: "Real Decreto 1619/2012, art. 4 (simplificada: 400 € IVA incluido o rectificativa; 3.000 € solo en los sectores del apartado 2, entre los que no está el SaaS)", url: `${BOE_RD}#a4`, verified: true },
  rd_6: { label: "Real Decreto 1619/2012, art. 6.1 (contenido; serie específica de rectificativas; descuentos; mención «inversión del sujeto pasivo»)", url: `${BOE_RD}#a6`, verified: true },
  rd_7: { label: "Real Decreto 1619/2012, art. 7.1.a) (simplificadas en series separadas de las completas del mismo año; series propias de rectificativas)", url: `${BOE_RD}#a7`, verified: true },
  rd_11: { label: "Real Decreto 1619/2012, art. 11 (plazo de expedición)", url: `${BOE_RD}#a11`, verified: true },
  rd_15: { label: "Real Decreto 1619/2012, art. 15 (facturas rectificativas)", url: `${BOE_RD}#a15`, verified: true },
  igic_17: { label: "Ley 20/1991 (IGIC), art. 17 (servicios a empresarios establecidos en Canarias; servicios electrónicos a no empresarios de Canarias)", url: `${BOE_IGIC}#a17`, verified: true },
  igic_19: { label: "Ley 20/1991 (IGIC), art. 19.1.2.º.a) (inversión del sujeto pasivo cuando el prestador no está establecido en Canarias)", url: `${BOE_IGIC}#a19`, verified: true },
  ue282_18: { label: "Reglamento de Ejecución (UE) 282/2011, art. 18 (condición de sujeto pasivo del cliente: NIF-IVA confirmado; clientes fuera de la Comunidad)", url: "https://www.boe.es/buscar/doc.php?id=DOUE-L-2011-80529", verified: true },
  ue282_24ter: { label: "Reglamento de Ejecución (UE) 282/2011, arts. 24 ter.d) y 24 septies (dos pruebas no contradictorias de la localización del consumidor), redacción del Reglamento (UE) 1042/2013", url: "https://www.boe.es/buscar/doc.php?id=DOUE-L-2013-82115", verified: true },
  ue282_24ter_2017: { label: "Reglamento de Ejecución (UE) 2017/2459 (art. 24 ter: una sola prueba de un tercero si las ventas no superan 100.000 €)", url: "https://www.boe.es/buscar/doc.php?id=DOUE-L-2017-82606", verified: true },
  dir_6: { label: "Directiva 2006/112/CE, art. 6 (territorios excluidos del IVA comunitario)", url: "https://eur-lex.europa.eu/legal-content/ES/TXT/?uri=CELEX:32006L0112", verified: false },
  dir_44_196: { label: "Directiva 2006/112/CE, arts. 44 y 196 (sede del destinatario sujeto pasivo e inversión del sujeto pasivo)", url: "https://eur-lex.europa.eu/legal-content/ES/TXT/?uri=CELEX:32006L0112", verified: false },
  dir_58: { label: "Directiva 2006/112/CE, art. 58 (servicios electrónicos a no sujetos pasivos: lugar de establecimiento del cliente)", url: "https://eur-lex.europa.eu/legal-content/ES/TXT/?uri=CELEX:32006L0112", verified: false },
  aeat_roi: { label: "AEAT: identificación para operaciones con otros empresarios de la UE (ROI, modelo 036, VIES, modelo 349)", url: "https://sede.agenciatributaria.gob.es/Sede/iva/iva-operaciones-comercio-exterior/identificacion-realizar-operaciones-otros-empresarios-ue.html", verified: true },
  aeat_oss_alta: { label: "AEAT: alta en los regímenes de ventanilla única (formulario 035; aplicación desde el trimestre siguiente o desde el inicio si se comunica antes del día 10)", url: "https://sede.agenciatributaria.gob.es/Sede/iva/iva-comercio-electronico/registro-regimen-unionregimen-exterior-regimen_intermediario.html", verified: true },
  aeat_oss_369: { label: "AEAT: modelo 369, régimen de la Unión (los servicios localizados en España van al 303)", url: "https://sede.agenciatributaria.gob.es/Sede/iva/iva-comercio-electronico/presentacion-autoliquidaciones-periodicas-modelo-369/regimen-union.html", verified: true },
} as const satisfies Record<string, LegalRef>;
export type LegalRefId = keyof typeof LEGAL_REFS;

/** Evidencias que una regla exige que consten (y casen con lo cobrado) en cada factura. */
export type EvidenceKind =
  /** Nombre o razón social del comprador. */
  | "buyer_name"
  /** NIF español con su letra de control. */
  | "tax_id_es"
  /** NIF-IVA de otro Estado miembro VÁLIDO en VIES, con la fecha de la comprobación (art. 18.1.a Reglamento 282/2011). */
  | "vies_valid"
  /** Identificador fiscal del país del cliente fuera de la UE como prueba de su condición de empresario (art. 18.3.b). */
  | "tax_id_foreign"
  /** Dirección de facturación completa del territorio del caso. */
  | "billing_address"
  /** Dirección con la que Stripe calculó el impuesto: si consta, del mismo territorio. */
  | "stripe_tax_address"
  /** Dos pruebas NO contradictorias e INDEPENDIENTES de la localización del consumidor (arts. 24 ter.d y 24 septies). */
  | "location_two_proofs"
  /** El impuesto cobrado por Stripe Tax es el de la regla. */
  | "stripe_tax_rate"
  /** Umbral de 10.000 € del art. 73 comprobado (año anterior y en curso, sin fraccionar). */
  | "eu_b2c_threshold";

export type DecisionKind = "censal" | "comercial" | "configuracion" | "tecnica";
export interface Decision {
  kind: DecisionKind;
  text: string;
}

export interface FiscalRule {
  id: RuleId;
  case: FiscalCase;
  buyer: BuyerType;
  territory: Territory;
  label: string;
  status: RuleStatus;
  blockedReason: string | null;
  treatment: TreatmentCode;
  tax: {
    /** Impuesto que grava la operación (o «ninguno en España»). */
    name: string;
    /** Tipo en puntos básicos: 2100, 0, o null (el del Estado de consumo, que calcula Stripe Tax, o sin determinar). */
    rateBp: number | null;
    /** Quién lo declara e ingresa. */
    payer: "prestador" | "destinatario" | "sin_determinar";
  };
  /** Plantilla de la mención legal ({territorio} se sustituye); null = ninguna. */
  mention: string | null;
  legal: LegalRefId[];
  obligations: string[];
  evidence: EvidenceKind[];
  /** Decisiones de Big Elephant previas a activar la regla. Ninguna se toma automáticamente. */
  decisions: Decision[];
  /** Puntos para la gestoría (`ADVISOR_QUESTIONS`). */
  advisor: string[];
  /** Factura simplificada posible (sin NIF del cliente, ≤ 400 € IVA incluido). */
  simplifiedAllowed: boolean;
}

const OPEN = (scenario: string): Decision => ({ kind: "comercial", text: `Abrir la venta del escenario ${scenario} (CP_STRIPE_FISCAL_SCENARIOS): decisión de Jorge, nunca automática` });
const ACTIVATE = (c: string): Decision => ({ kind: "configuracion", text: `Activar el caso en la facturación (CP_INVOICING_FISCAL_CASES=${c})` });
const BASE_EVIDENCE: EvidenceKind[] = ["buyer_name", "billing_address", "stripe_tax_address", "stripe_tax_rate"];
const OBL_303 = "Autoliquidación del IVA repercutido (modelo 303) y libro registro de facturas expedidas";

const R = (r: Omit<FiscalRule, "blockedReason" | "simplifiedAllowed"> & { blockedReason?: string; simplifiedAllowed?: boolean }): FiscalRule => ({ blockedReason: null, simplifiedAllowed: false, ...r });

const ccmBusinessBlocked = (c: FiscalCase, territory: Territory, name: string): FiscalRule =>
  R({
    id: c,
    case: c,
    buyer: "business",
    territory,
    label: `Empresa o profesional establecido en ${name}`,
    status: "blocked",
    blockedReason: `IVA: no sujeta (art. 69.Uno.1.º y art. 3 de la Ley 37/1992). Pero no se ha cotejado la normativa del IPSI de ${name} (quién es sujeto pasivo, registro y mención): sin ella no se puede expedir con seguridad`,
    treatment: "not_subject",
    tax: { name: `IVA: no sujeta. IPSI de ${name}: sin determinar`, rateBp: 0, payer: "sin_determinar" },
    mention: null,
    legal: ["liva_3", "liva_69_1_1"],
    obligations: ["IPSI: pendiente de determinar"],
    evidence: [],
    decisions: [{ kind: "tecnica", text: `Cotejar el IPSI de ${name} con la gestoría` }],
    advisor: ["canarias_ceuta_melilla_empresa"],
  });

const ccmConsumerBlocked = (c: FiscalCase, territory: Territory, name: string, reason: string, legal: LegalRefId[]): FiscalRule =>
  R({ id: c, case: c, buyer: "consumer", territory, label: `Particular de ${name}`, status: "blocked", blockedReason: reason, treatment: "undetermined", tax: { name: "Sin determinar", rateBp: null, payer: "sin_determinar" }, mention: null, legal, obligations: [], evidence: [], decisions: [], advisor: ["canarias_ceuta_melilla_particular"] });

/** La matriz: una fila por caso y, para los particulares de la UE, una por régimen del art. 73. */
export const FISCAL_MATRIX: readonly FiscalRule[] = [
  R({
    id: "business:es_mainland",
    case: "business:es_mainland",
    buyer: "business",
    territory: "es_mainland",
    label: "Empresa o profesional de la península o Baleares",
    status: "enabled",
    treatment: "taxed_es",
    tax: { name: "IVA español", rateBp: 2100, payer: "prestador" },
    mention: null,
    legal: ["liva_69_1_1", "liva_69_3_4", "liva_90_1", "liva_75_2", "liva_75_1_7", "rd_6"],
    obligations: [OBL_303],
    evidence: [...BASE_EVIDENCE, "tax_id_es"],
    decisions: [],
    advisor: [],
  }),
  R({
    id: "consumer:es_mainland",
    case: "consumer:es_mainland",
    buyer: "consumer",
    territory: "es_mainland",
    label: "Particular de la península o Baleares",
    status: "ready",
    treatment: "taxed_es",
    tax: { name: "IVA español", rateBp: 2100, payer: "prestador" },
    mention: null,
    legal: ["liva_69_1_2", "liva_70_1_4", "liva_90_1", "rd_4", "rd_7"],
    obligations: [OBL_303, "Factura completa (EB) si da su NIF; simplificada (EBS) sin NIF hasta 400 € IVA incluido"],
    evidence: BASE_EVIDENCE,
    decisions: [OPEN("consumer:es_mainland"), { kind: "comercial", text: "Decidir el desistimiento de particulares (CP_CONSUMER_WITHDRAWAL)" }, ACTIVATE("consumer:es_mainland"), { kind: "configuracion", text: "Facturas simplificadas: CP_INVOICING_SIMPLIFIED=1" }],
    advisor: ["consumidor_peninsula", "factura_simplificada", "rectificativa_simplificada"],
    simplifiedAllowed: true,
  }),
  R({
    id: "business:es_canarias",
    case: "business:es_canarias",
    buyer: "business",
    territory: "es_canarias",
    label: "Empresa o profesional establecido en Canarias",
    status: "ready",
    treatment: "not_subject",
    tax: { name: "IVA: no sujeta. IGIC: sujeta, con inversión del sujeto pasivo", rateBp: 0, payer: "destinatario" },
    mention: "Operación no sujeta al IVA: destinatario empresario o profesional establecido en {territorio}, fuera del territorio de aplicación del impuesto (arts. 3 y 69.Uno.1.º de la Ley 37/1992). IGIC: inversión del sujeto pasivo (art. 19.1.2.º.a) de la Ley 20/1991).",
    legal: ["liva_3", "liva_69_1_1", "igic_17", "igic_19"],
    obligations: ["Ninguna autoliquidación por la operación: en el IGIC el sujeto pasivo es el destinatario", "Consignar la base como operación no sujeta por reglas de localización en el modelo 303 (casilla pendiente de cotejo)"],
    evidence: [...BASE_EVIDENCE, "tax_id_es"],
    decisions: [OPEN("business:es_special"), ACTIVATE("business:es_canarias")],
    advisor: ["canarias_ceuta_melilla_empresa"],
  }),
  ccmBusinessBlocked("business:es_ceuta", "es_ceuta", "Ceuta"),
  ccmBusinessBlocked("business:es_melilla", "es_melilla", "Melilla"),
  ccmConsumerBlocked(
    "consumer:es_canarias",
    "es_canarias",
    "Canarias",
    "El servicio electrónico a un particular de Canarias se localiza en Canarias (art. 17 de la Ley 20/1991) y el IGIC lo debe el prestador (sin inversión: el destinatario no es empresario). Exige alta y declaraciones ante la Agencia Tributaria Canaria y el tipo del IGIC, que no están preparados ni comprobados en Stripe Tax",
    ["liva_3", "igic_17", "igic_19"],
  ),
  ccmConsumerBlocked("consumer:es_ceuta", "es_ceuta", "Ceuta", "La Ley 37/1992 no excluye expresamente estos servicios (art. 69.Uno.2.º; el art. 70.Uno.4.º exige que el particular esté en el territorio de aplicación) y no se ha cotejado el IPSI de Ceuta: tratamiento sin determinar", ["liva_3", "liva_69_1_2", "liva_70_1_4"]),
  ccmConsumerBlocked("consumer:es_melilla", "es_melilla", "Melilla", "La Ley 37/1992 no excluye expresamente estos servicios (art. 69.Uno.2.º; el art. 70.Uno.4.º exige que el particular esté en el territorio de aplicación) y no se ha cotejado el IPSI de Melilla: tratamiento sin determinar", ["liva_3", "liva_69_1_2", "liva_70_1_4"]),
  R({
    id: "business:eu_vies",
    case: "business:eu_vies",
    buyer: "business",
    territory: "eu",
    label: "Empresa de otro Estado miembro con NIF-IVA válido en VIES",
    status: "ready",
    treatment: "reverse_charge",
    tax: { name: "IVA del Estado del destinatario, autoliquidado por él", rateBp: 0, payer: "destinatario" },
    mention: "Inversión del sujeto pasivo. Operación no sujeta al IVA español (art. 69.Uno.1.º de la Ley 37/1992; arts. 44 y 196 de la Directiva 2006/112/CE).",
    legal: ["liva_69_1_1", "rd_6", "ue282_18", "dir_44_196", "liva_164_1", "aeat_roi"],
    obligations: ["Alta de Big Elephant en el Registro de Operadores Intracomunitarios (modelo 036) con NIF-IVA válido en VIES", "Declaración recapitulativa (modelo 349, prestaciones intracomunitarias de servicios)", "NIF-IVA del cliente en la factura", "Base en el modelo 303 como operación no sujeta por reglas de localización (casilla pendiente de cotejo)"],
    evidence: [...BASE_EVIDENCE, "vies_valid"],
    decisions: [{ kind: "censal", text: "Alta de Big Elephant en el ROI (modelo 036): decisión censal de Jorge" }, OPEN("business:eu"), ACTIVATE("business:eu_vies")],
    advisor: ["ue_empresa_isp"],
  }),
  R({
    id: "business:eu_unverified",
    case: "business:eu_unverified",
    buyer: "business",
    territory: "eu",
    label: "Empresa de otro Estado miembro sin NIF-IVA válido en VIES",
    status: "blocked",
    blockedReason: "El art. 18 del Reglamento 282/2011 solo permite tratar al cliente como sujeto pasivo con el NIF-IVA confirmado, y como no sujeto pasivo si no lo ha comunicado; un NIF-IVA comunicado pero no válido no encaja en ninguno",
    treatment: "undetermined",
    tax: { name: "Sin determinar", rateBp: null, payer: "sin_determinar" },
    mention: null,
    legal: ["ue282_18"],
    obligations: [],
    evidence: [],
    decisions: [],
    advisor: ["ue_empresa_sin_vies"],
  }),
  R({
    id: "consumer:eu",
    case: "consumer:eu",
    buyer: "consumer",
    territory: "eu",
    label: "Particular de otro Estado miembro (sin régimen declarado)",
    status: "blocked",
    blockedReason: "Depende de si Big Elephant ha superado el umbral de 10.000 € o ha optado por tributar en destino (art. 73): debe declararse expresamente (CP_INVOICING_EU_B2C_REGIME), nunca se infiere",
    treatment: "undetermined",
    tax: { name: "Según el régimen declarado", rateBp: null, payer: "prestador" },
    mention: null,
    legal: ["liva_70_1_8", "liva_73"],
    obligations: [],
    evidence: [],
    decisions: [{ kind: "configuracion", text: "Declarar el régimen: CP_INVOICING_EU_B2C_REGIME=below_threshold o destination_oss" }],
    advisor: ["ue_particular_oss"],
  }),
  R({
    id: "consumer:eu@below_threshold",
    case: "consumer:eu",
    buyer: "consumer",
    territory: "eu",
    label: "Particular de otro Estado miembro, sin superar 10.000 € ni haber optado (art. 73)",
    status: "ready",
    treatment: "taxed_es",
    tax: { name: "IVA español", rateBp: 2100, payer: "prestador" },
    mention: null,
    legal: ["liva_70_1_8", "liva_73", "liva_90_1"],
    obligations: [OBL_303, "Vigilar el umbral de 10.000 € (año anterior y en curso, sin IVA, sin fraccionar): al superarlo, esa operación y las siguientes tributan en destino"],
    evidence: [...BASE_EVIDENCE, "eu_b2c_threshold"],
    decisions: [{ kind: "configuracion", text: "Declarar que Big Elephant no superó 10.000 € el año anterior ni ha optado: CP_INVOICING_EU_B2C_REGIME=below_threshold" }, OPEN("consumer:eu"), { kind: "comercial", text: "Decidir el desistimiento de particulares (CP_CONSUMER_WITHDRAWAL)" }, ACTIVATE("consumer:eu"), { kind: "tecnica", text: "Stripe Tax sin registro OSS (cobra el IVA español)" }],
    advisor: ["ue_particular_oss", "factura_simplificada"],
    simplifiedAllowed: true,
  }),
  R({
    id: "consumer:eu@destination_oss",
    case: "consumer:eu",
    buyer: "consumer",
    territory: "eu",
    label: "Particular de otro Estado miembro, en destino por el régimen de la Unión (OSS)",
    status: "ready",
    treatment: "oss_destination",
    tax: { name: "IVA del Estado miembro de consumo", rateBp: null, payer: "prestador" },
    mention: null,
    legal: ["liva_73", "liva_163_unvicies", "ue282_24ter", "ue282_24ter_2017", "dir_58", "aeat_oss_alta", "aeat_oss_369"],
    obligations: ["Alta en el régimen de la Unión (formulario 035)", "Autoliquidación del régimen de la Unión (modelo 369) por trimestre natural", "Si no se ha superado el umbral, la opción por destino vincula al menos dos años naturales (art. 73.Dos)"],
    evidence: [...BASE_EVIDENCE, "location_two_proofs"],
    decisions: [{ kind: "censal", text: "Alta de Big Elephant en el régimen de la Unión (formulario 035) y, si no se superó el umbral, opción por destino: decisión censal de Jorge" }, { kind: "configuracion", text: "CP_INVOICING_EU_B2C_REGIME=destination_oss" }, { kind: "tecnica", text: "Registro OSS en Stripe Tax y una segunda prueba de localización independiente (país de la tarjeta o del banco, IP)" }, OPEN("consumer:eu"), ACTIVATE("consumer:eu")],
    advisor: ["ue_particular_oss"],
  }),
  ...(["business", "consumer"] as const).map((b) =>
    R({
      id: `${b}:eu_special`,
      case: `${b}:eu_special`,
      buyer: b,
      territory: "eu_special",
      label: `${b === "business" ? "Empresa" : "Particular"} de un territorio de la UE excluido del IVA comunitario`,
      status: "blocked",
      blockedReason: "Territorio excluido de la armonización (Directiva 2006/112/CE, art. 6, pendiente de cotejo): el tratamiento depende del territorio concreto y no se ha determinado",
      treatment: "undetermined",
      tax: { name: "Sin determinar", rateBp: null, payer: "sin_determinar" },
      mention: null,
      legal: ["dir_6", "liva_3"],
      obligations: [],
      evidence: [],
      decisions: [],
      advisor: ["ue_territorio_especial"],
    }),
  ),
  R({
    id: "business:non_eu",
    case: "business:non_eu",
    buyer: "business",
    territory: "non_eu",
    label: "Empresa establecida fuera de la UE",
    status: "ready",
    treatment: "not_subject",
    tax: { name: "IVA español: no sujeta (impuestos del país del cliente: a su cargo según su ley)", rateBp: 0, payer: "destinatario" },
    mention: "Operación no sujeta al IVA: destinatario empresario o profesional establecido fuera del territorio de aplicación del impuesto (art. 69.Uno.1.º de la Ley 37/1992).",
    legal: ["liva_69_1_1", "liva_70_2", "ue282_18"],
    obligations: ["Base en el modelo 303 como operación no sujeta por reglas de localización (casilla pendiente de cotejo)", "Obligaciones en el país del cliente: revisar por país antes de abrirlo"],
    evidence: [...BASE_EVIDENCE, "tax_id_foreign"],
    decisions: [OPEN("business:non_eu"), { kind: "comercial", text: "Revisar por país las obligaciones locales antes de abrir la venta" }, ACTIVATE("business:non_eu")],
    advisor: ["tercer_pais_empresa"],
  }),
  R({
    id: "consumer:non_eu",
    case: "consumer:non_eu",
    buyer: "consumer",
    territory: "non_eu",
    label: "Particular establecido fuera de la UE",
    status: "blocked",
    blockedReason: "El texto vigente del art. 69.Dos ya no incluye los servicios electrónicos, el art. 70.Uno.4.º solo alcanza a particulares del territorio de aplicación y la regla general (art. 69.Uno.2.º) los localizaría en España, frente al art. 58 de la Directiva (pendiente de cotejo); además, muchos países exigen registro propio desde la primera venta",
    treatment: "undetermined",
    tax: { name: "Sin determinar", rateBp: null, payer: "sin_determinar" },
    mention: null,
    legal: ["liva_69_1_2", "liva_69_2", "liva_70_1_4", "dir_58"],
    obligations: [],
    evidence: [],
    decisions: [],
    advisor: ["tercer_pais_particular"],
  }),
];

const BY_ID = new Map<RuleId, FiscalRule>(FISCAL_MATRIX.map((r) => [r.id, r]));
export const ruleById = (id: RuleId): FiscalRule => BY_ID.get(id)!;

/** Regla de un caso: para `consumer:eu`, la del régimen declarado; sin declararlo, la fila bloqueada. */
export function ruleFor(c: FiscalCase, regime: EuB2cRegime | null = null): FiscalRule {
  if (c === "consumer:eu" && regime) return ruleById(`consumer:eu@${regime}`);
  return ruleById(c);
}

/** ¿Se puede activar el caso por configuración? Nunca uno bloqueado; `consumer:eu` solo con el régimen declarado. */
export const isActivatable = (c: FiscalCase, regime: EuB2cRegime | null = null) => ruleFor(c, regime).status !== "blocked";

// ---------------------------------------------------------------------------------------------------------------
// Evidencias

/** Fuente de una prueba de localización (art. 24 septies del Reglamento 282/2011). */
export type LocationSource = "billing_address" | "stripe_tax_address" | "ip_address" | "payment_instrument" | "bank_account" | "mobile_country_code";
export interface LocationProof {
  source: LocationSource;
  country: string;
  postalCode?: string | null;
  /** Una prueba que deriva de otra (la dirección de Stripe Tax procede de la de facturación) no es independiente. */
  derivedFrom?: LocationSource | null;
}

/** Evidencias que se guardan en cada factura (`invoices.fiscal_json`). */
export interface FiscalEvidence {
  matrixVersion: string;
  ruleId: RuleId;
  ruleStatus: RuleStatus;
  legalBasis: string[];
  buyer: { type: BuyerType; territory: Territory | null; country: string; postalCode: string | null; taxId: string | null; condition: "business_declared" | "business_vies" | "consumer" };
  vies: { vatNumber: string; status: string; checkedAt: number } | null;
  location: LocationProof[];
  stripeTax: { stripeInvoiceId: string; taxCents: number; totalCents: number; amountPaidCents: number; rates: number[]; customerCountry: string | null; customerPostalCode: string | null };
  dates: {
    operationDate: string;
    accrualBasis: "advance_payment" | "due_date" | null;
    /** Exigibilidad contractual: inicio del periodo que se paga (art. 75.Uno.7.º). */
    dueDate: string | null;
    collectionDate: string | null;
    periodStart: number | null;
    periodEnd: number | null;
    /** Se completa al expedir. */
    issueDate: string | null;
  };
  amounts: { grossCents: number; discountCents: number; baseCents: number; taxCents: number; totalCents: number; balanceAppliedCents: number };
}

const norm = (x: string | null | undefined) => (x ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

/** Problemas de las evidencias frente a lo que exige la regla. Vacío = constan y casan. */
export function evidenceProblems(rule: FiscalRule, ev: FiscalEvidence, ctx: { threshold?: string | null } = {}): string[] {
  const out: string[] = [];
  if (rule.status === "blocked") return [`el caso fiscal ${rule.id} está bloqueado: ${rule.blockedReason}`];
  for (const k of rule.evidence) {
    if (k === "vies_valid") {
      if (!ev.vies || ev.vies.status !== "valid") out.push("falta la comprobación VIES válida del NIF-IVA del cliente (art. 18.1.a del Reglamento 282/2011)");
      else {
        const t = norm(ev.buyer.taxId);
        const v = norm(ev.vies.vatNumber);
        if (!t || (t !== v && t !== v.slice(2))) out.push("la comprobación VIES no es del NIF-IVA de la factura");
      }
    }
    if (k === "tax_id_foreign" && !norm(ev.buyer.taxId)) out.push("falta el identificador fiscal del cliente de fuera de la UE que acredita su condición de empresario (art. 18.3.b del Reglamento 282/2011)");
    if (k === "location_two_proofs") {
      const independent = ev.location.filter((p) => !p.derivedFrom);
      const countries = new Set(independent.map((p) => p.country));
      const kinds = new Set(independent.map((p) => p.source));
      if (countries.size > 1) out.push(`las pruebas de localización se contradicen (${Array.from(countries).join(", ")})`);
      else if (kinds.size < 2) out.push(`faltan pruebas de localización: el art. 24 ter.d) del Reglamento 282/2011 exige dos no contradictorias del art. 24 septies y solo consta ${independent.map((p) => p.source).join(", ") || "ninguna"}`);
      else if (!countries.has(ev.buyer.country)) out.push("las pruebas de localización no son del país del comprador declarado");
    }
    if (k === "eu_b2c_threshold" && ctx.threshold) out.push(ctx.threshold);
  }
  if (rule.tax.rateBp === null && rule.treatment === "oss_destination" && ev.stripeTax.taxCents <= 0) out.push("el IVA del Estado de consumo no consta cobrado en Stripe Tax");
  return out;
}

/** Límite del art. 73 de la Ley 37/1992 en céntimos (sin IVA). */
export const EU_B2C_THRESHOLD_CENTS = 1_000_000;

/**
 * Umbral de 10.000 € con IVA español (régimen `below_threshold`): bases de los particulares de otros Estados miembros
 * del año anterior y del año en curso (incluida esta). Con el del año anterior superado no cabe; si esta venta lo supera
 * en el año, desde ella tributa en destino (art. 73.Uno, párrafo segundo). null = dentro del límite.
 */
export function euB2cThresholdProblem(i: { previousYearCents: number; currentYearCents: number; thisBaseCents: number }): string | null {
  const eur = (c: number) => `${(c / 100).toFixed(2).replace(".", ",")} €`;
  if (i.previousYearCents > EU_B2C_THRESHOLD_CENTS) return `las ventas a particulares de otros Estados miembros del año anterior (${eur(i.previousYearCents)}) superan 10.000 € (art. 73): no se puede aplicar el IVA español; hay que pasar al régimen de la Unión`;
  if (i.currentYearCents + i.thisBaseCents > EU_B2C_THRESHOLD_CENTS) return `con esta venta las ventas a particulares de otros Estados miembros del año (${eur(i.currentYearCents + i.thisBaseCents)}) superan 10.000 €: desde esta operación tributa en destino (art. 73.Uno); hay que pasar al régimen de la Unión`;
  return null;
}

// ---------------------------------------------------------------------------------------------------------------
// Créditos (saldo a favor aplicado por Stripe)

/** Origen fiscal del saldo a favor aplicado en una factura. Lo decide una persona; nunca se infiere. */
export type CreditOrigin = "payment_means" | "price_adjustment";
export interface CreditDecision {
  appliedCents: number;
  origin: CreditOrigin;
  /** Ajuste de precio: la factura anterior cuyo precio se altera (art. 80.Dos) y su rectificativa. */
  originalInvoiceId: number | null;
  rectificationInvoiceId: number | null;
  reason: string;
  decidedBy: string;
  decidedAt: number;
}

/**
 * ¿Se puede expedir con el saldo a favor aplicado? Sin saldo, sí. Con saldo, solo si consta su origen: medio de pago
 * (saldo monetario: no toca la base) o ajuste del precio de una factura anterior con su rectificativa enlazada. Si no,
 * el motivo del bloqueo.
 */
export function creditProblem(balanceAppliedCents: number, d: CreditDecision | null | undefined): string | null {
  const eur = (c: number) => `${(c / 100).toFixed(2).replace(".", ",")} €`;
  if (balanceAppliedCents <= 0) return null;
  if (!d || d.appliedCents !== balanceAppliedCents) return `saldo a favor del cliente aplicado en Stripe (${eur(balanceAppliedCents)}) de origen fiscal no determinado: indicar si es un saldo monetario (medio de pago) o un ajuste del precio de una factura anterior (rectificativa, art. 80.Dos de la Ley 37/1992 y art. 15 del RD 1619/2012)`;
  if (d.origin === "price_adjustment" && (!d.originalInvoiceId || !d.rectificationInvoiceId)) return "el saldo a favor es un ajuste del precio de una factura anterior y falta su rectificativa enlazada";
  return null;
}

/** Base de la rectificativa de un ajuste de precio: el saldo (IVA incluido) al tipo único de la factura original. */
export function adjustmentBase(balanceCents: number, rateBp: number): number | null {
  const base = Math.round((balanceCents * 10_000) / (10_000 + rateBp));
  const tax = Math.round((base * rateBp) / 10_000);
  return base > 0 && Math.abs(base + tax - balanceCents) <= 1 ? base : null;
}
