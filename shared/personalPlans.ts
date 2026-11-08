/**
 * Planes PERSONALES de Elephant Core (decisiones de Jorge del 08/11/2026, docs/life-net-alcance.md §3.5 opción B).
 *
 * «Life» es un plan propio (familia `core_plan`), independiente de Essential: un tenant por hogar, con la licencia
 * `LIFE_NET` (capacidad `life-net`) y solo las capacidades base imprescindibles, sin CRM, tienda, CMS ni facturación.
 *
 *  - Precio: 9 € al mes IVA incluido (J3). El catálogo guarda los importes SIN IVA (base 7,44 €, IVA 21 %), como el
 *    resto, para que el Price de Stripe sea `tax_behavior: exclusive`; a un particular siempre se le muestra el final.
 *  - Solo tarifa mensual (J4): exento de la tarifa anual que exigen Essential y Business.
 *  - Prueba gratuita de 14 días desde la activación del hogar (J4), tras su propio interruptor, apagado por defecto.
 *  - 5 miembros del hogar incluidos (J5): métrica `household_members`.
 *  - Solo España peninsular y Baleares en el lanzamiento (J9): escenario `consumer:es_mainland`.
 *  - Life Net no se ofrece a las empresas (J7): sale del escaparate del panel y va a la oferta personal de la web.
 */

/** Clave del plan personal en el catálogo. */
export const LIFE_PLAN = "life";
/** Planes personales (un tenant por hogar). */
export const PERSONAL_PLANS: readonly string[] = [LIFE_PLAN];
/** Productos del catálogo que solo se contratan con un plan personal (y el plan que los concede). */
export const PERSONAL_PRODUCTS: Readonly<Record<string, string>> = { "life-net": LIFE_PLAN };

export const isPersonalPlan = (key: string | null | undefined): boolean => !!key && PERSONAL_PLANS.includes(key);
export const isPersonalProduct = (key: string | null | undefined): boolean => !!key && Object.prototype.hasOwnProperty.call(PERSONAL_PRODUCTS, key);

/** Capacidades del plan Life: la licencia y lo imprescindible para entrar e invitar a los miembros (J2). */
export const LIFE_CAPABILITIES: readonly string[] = ["life-net", "admin-users", "comms-email"];
/** Métrica de los miembros del hogar y miembros incluidos (J5). La lee el módulo Life Net. */
export const HOUSEHOLD_MEMBERS_METRIC = "household_members";
export const LIFE_HOUSEHOLD_MEMBERS_INCLUDED = 5;
/** Días de prueba gratuita del plan Life, desde la activación del hogar (J4). */
export const LIFE_TRIAL_DAYS = 14;
/** Escenario fiscal del lanzamiento (J9). */
export const LIFE_LAUNCH_SCENARIO = "consumer:es_mainland";

/** Tarifa aprobada por Jorge (J3): base sin IVA en céntimos y tipo en puntos básicos. */
export const LIFE_MONTHLY_BASE_CENTS = 744;
export const LIFE_TAX_RATE_BP = 2100;

/** Precio final con impuestos (céntimos), con el mismo redondeo que el cotizador: el IVA se redondea por periodo. */
export const priceWithTaxCents = (baseCents: number, taxRateBp: number): number => baseCents + Math.round((baseCents * taxRateBp) / 10_000);
