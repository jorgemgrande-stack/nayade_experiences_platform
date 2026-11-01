/**
 * Asistente de configuración inicial («Primeros pasos»): definiciones compartidas entre el panel y
 * el servidor. Solo datos y reglas puras; la persistencia vive en `server/setupWizardDb.ts`.
 *
 * Dos capas:
 *  - el PROGRESO guardado (`SetupProgress`): qué pasos ha guardado u omitido la empresa;
 *  - el PLAN (`buildSetupPlan`): qué pasos ve, en qué orden y su estado real, según el tipo de actividad, lo
 *    contratado y los datos que ya tiene (un paso «de hacer» está hecho cuando el dato existe, no por un clic).
 */
import { z } from "zod";
import { validatePostalCodeES, validateTaxId } from "./formValidation";
import { normalizeWhatsapp } from "./whatsappButton";

/**
 * Pasos guardables, en el orden de negocio (el mismo para todas las empresas). Compatibilidad: «brand» llegó después
 * de la primera versión, «welcome», «fiscal», «web», «comms» y «sector» en la v2 y «document» en la v3; un progreso
 * guardado sin ellos los lee pendientes (parseProgress). «operation» conserva su identificador y ahora es «Primera
 * venta» (pedido o caja); los presupuestos y facturas tienen su propio paso («document»). «users» ya no es un paso del
 * recorrido: el equipo se invita en «Resumen y puesta en marcha»; se sigue aceptando para no romper progresos guardados.
 */
export const SETUP_STEPS = ["welcome", "company", "fiscal", "activity", "brand", "web", "client", "product", "operation", "document", "comms", "sector", "finish", "users"] as const;
export type SetupStep = (typeof SETUP_STEPS)[number];
export type StepStatus = "pending" | "done" | "skipped";
/** Pasos que cuentan en el progreso guardado (todos menos el heredado «users»). */
export const FLOW_STEPS: readonly SetupStep[] = SETUP_STEPS.filter((s) => s !== "users");

export const STEP_LABELS: Record<SetupStep, { title: string; summary: string }> = {
  welcome: { title: "Bienvenida", summary: "Qué vas a configurar y cómo funciona el asistente." },
  company: { title: "Datos de la empresa", summary: "Nombre comercial, país, moneda y zona horaria." },
  fiscal: { title: "Datos fiscales", summary: "Razón social, NIF, dirección fiscal y contacto público." },
  activity: { title: "Tipo de actividad", summary: "Para destacar los pasos más útiles y adaptar los textos a tu negocio." },
  brand: { title: "Logotipo y colores", summary: "Tu imagen en la web, en los documentos y en la pantalla de acceso." },
  web: { title: "Página web", summary: "Revisa y personaliza las páginas de tu web en el editor." },
  client: { title: "Primer cliente", summary: "Da de alta a tu primer cliente." },
  product: { title: "Primer producto o servicio", summary: "Lo que vendes, con su precio e impuesto." },
  operation: { title: "Primera venta", summary: "Tu primer pedido de la tienda o tu primera venta en caja." },
  document: { title: "Primer presupuesto o factura", summary: "Tu primer presupuesto para un cliente o tu primera factura." },
  comms: { title: "Correo de la empresa", summary: "Con qué nombre salen tus correos y dónde recibes las respuestas." },
  sector: { title: "Tu módulo sectorial", summary: "Primeros pasos del módulo específico de tu sector." },
  finish: { title: "Resumen y puesta en marcha", summary: "Lo que queda pendiente, tu equipo y los siguientes pasos." },
  users: { title: "Tu equipo", summary: "Invita a tu equipo dentro del límite de tu plan." },
};

/**
 * Tipos de actividad. Destacan los pasos prioritarios y adaptan los textos: NO cambian el orden del recorrido, NO
 * activan módulos ni contratan nada.
 * «sectorial» solo se ofrece si la empresa tiene contratado un módulo sectorial.
 */
export const BUSINESS_ACTIVITIES = [
  { id: "comercio", label: "Comercio o tienda", description: "Vendes productos en tienda física, online o en ambas.", productNoun: "producto", productExample: "Camiseta de algodón", clientNoun: "cliente" },
  { id: "servicios", label: "Servicios profesionales", description: "Asesoría, consultoría, reformas, formación, salud, belleza…", productNoun: "servicio", productExample: "Sesión de asesoría (1 hora)", clientNoun: "cliente" },
  { id: "web", label: "Empresa con web", description: "Tu web es tu escaparate principal: captas y vendes desde ella.", productNoun: "producto o servicio", productExample: "Plan mensual", clientNoun: "cliente" },
  { id: "sectorial", label: "Sector específico", description: "Trabajas con el módulo sectorial que tienes contratado.", productNoun: "producto o servicio", productExample: "Mi primer servicio", clientNoun: "cliente" },
] as const;
export type BusinessActivity = (typeof BUSINESS_ACTIVITIES)[number]["id"];
/** Valores guardados por la versión anterior del asistente → tipo actual. */
const LEGACY_ACTIVITIES: Record<string, BusinessActivity> = {
  hosteleria: "comercio",
  turismo: "servicios",
  profesional: "servicios",
  formacion: "servicios",
  otro: "servicios",
};
const LEGACY_NOUNS: Record<string, { productNoun: string; productExample: string; clientNoun: string }> = {
  hosteleria: { productNoun: "producto", productExample: "Menú del día", clientNoun: "cliente" },
  formacion: { productNoun: "curso", productExample: "Curso de iniciación (8 horas)", clientNoun: "alumno" },
};
/** Tipo de actividad actual de un valor guardado (null si no hay ninguno reconocible). */
export function activityProfile(id: string | null | undefined): BusinessActivity | null {
  if (!id) return null;
  if (BUSINESS_ACTIVITIES.some((a) => a.id === id)) return id as BusinessActivity;
  return LEGACY_ACTIVITIES[id] ?? null;
}
export const activityInfo = (id: string | null | undefined) => {
  const base = BUSINESS_ACTIVITIES.find((a) => a.id === activityProfile(id)) ?? BUSINESS_ACTIVITIES[1];
  return id && LEGACY_NOUNS[id] ? { ...base, ...LEGACY_NOUNS[id] } : base;
};

export const CURRENCIES = ["EUR", "USD", "GBP", "CHF", "MXN", "ARS", "COP", "CLP", "PEN"] as const;
export const COUNTRIES: ReadonlyArray<{ code: string; name: string }> = [
  { code: "ES", name: "España" },
  { code: "PT", name: "Portugal" },
  { code: "FR", name: "Francia" },
  { code: "AD", name: "Andorra" },
  { code: "IT", name: "Italia" },
  { code: "DE", name: "Alemania" },
  { code: "GB", name: "Reino Unido" },
  { code: "MX", name: "México" },
  { code: "AR", name: "Argentina" },
  { code: "CO", name: "Colombia" },
  { code: "CL", name: "Chile" },
  { code: "PE", name: "Perú" },
  { code: "US", name: "Estados Unidos" },
];
export const TIMEZONES = [
  "Europe/Madrid",
  "Atlantic/Canary",
  "Europe/Lisbon",
  "Europe/Paris",
  "Europe/Andorra",
  "Europe/Rome",
  "Europe/Berlin",
  "Europe/London",
  "America/Mexico_City",
  "America/Argentina/Buenos_Aires",
  "America/Bogota",
  "America/Santiago",
  "America/Lima",
  "America/New_York",
] as const;

const text = (min: number, max: number, msg: string) => z.string().trim().min(min, msg).max(max, `Máximo ${max} caracteres`);

/** Datos de la empresa (identidad + fiscales y comerciales). */
export const companySchema = z.object({
  tradeName: text(2, 120, "Indica el nombre comercial (mínimo 2 caracteres)"),
  legalName: text(2, 160, "Indica la razón social (mínimo 2 caracteres)"),
  taxId: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9][A-Z0-9.\- ]{3,18}[A-Z0-9]$/, "El NIF debe tener entre 5 y 20 letras o números"),
  address: text(3, 200, "Indica la dirección fiscal"),
  postalCode: z.string().trim().max(12, "Máximo 12 caracteres").optional().default(""),
  city: z.string().trim().max(80, "Máximo 80 caracteres").optional().default(""),
  province: z.string().trim().max(80, "Máximo 80 caracteres").optional().default(""),
  country: z.string().refine((c) => COUNTRIES.some((x) => x.code === c), "Elige un país de la lista"),
  currency: z.enum(CURRENCIES, { message: "Elige una moneda de la lista" }),
  timezone: z.enum(TIMEZONES, { message: "Elige una zona horaria de la lista" }),
  // Contacto público (web y comunicaciones): opcional; sin él, la web de la empresa no muestra ese dato
  publicPhone: z.string().trim().max(40, "Máximo 40 caracteres").optional().default(""),
  publicEmail: z.union([z.literal(""), z.string().trim().max(160, "Máximo 160 caracteres").email("Indica un email válido")]).optional().default(""),
  publicLocation: z.string().trim().max(200, "Máximo 200 caracteres").optional().default(""),
});
export type CompanyData = z.infer<typeof companySchema>;

/** Paso «Identidad de empresa». */
export const IDENTITY_FIELDS = ["tradeName", "country", "currency", "timezone"] as const satisfies ReadonlyArray<keyof CompanyData>;
export const identitySchema = companySchema.pick({ tradeName: true, country: true, currency: true, timezone: true });
/** Paso «Datos fiscales y comerciales». */
export const FISCAL_FIELDS = ["legalName", "taxId", "address", "postalCode", "city", "province", "publicPhone", "publicEmail", "publicLocation"] as const satisfies ReadonlyArray<keyof CompanyData>;
export const fiscalSchema = companySchema.pick({ legalName: true, taxId: true, address: true, postalCode: true, city: true, province: true, publicPhone: true, publicEmail: true, publicLocation: true });

/**
 * Comprobaciones de una empresa española (país España o sin país aún): NIF, NIE o CIF con su dígito de control y
 * código postal de 5 cifras de una provincia real (si se indica). Fuera de España solo se aplica el formato general
 * de `companySchema`. Las usan el asistente, «Datos de la empresa» y el servidor al guardar.
 */
export function spanishFiscalErrors(country: string | null | undefined, v: { taxId?: string | null; postalCode?: string | null }): Partial<Record<"taxId" | "postalCode", string>> {
  if ((country || "ES") !== "ES") return {};
  const out: Partial<Record<"taxId" | "postalCode", string>> = {};
  const tax = validateTaxId(v.taxId ?? "", true);
  if (tax) out.taxId = tax;
  const zip = validatePostalCodeES(v.postalCode ?? "");
  if (zip) out.postalCode = zip;
  return out;
}

/** Clave de ajuste (system_settings) de cada dato de empresa: los mismos que usa Configuración. */
export const COMPANY_SETTING_KEYS: Record<keyof CompanyData, string> = {
  tradeName: "brand_name",
  legalName: "site_legal_name",
  taxId: "brand_nif",
  address: "brand_address",
  postalCode: "site_legal_zip",
  city: "site_legal_city",
  province: "site_legal_province",
  country: "site_legal_country",
  currency: "site_payment_currency",
  timezone: "site_timezone",
  publicPhone: "brand_phone",
  publicEmail: "site_business_email",
  publicLocation: "brand_location",
};

/** Paso «Comunicaciones»: los mismos ajustes que usan el correo de la empresa y el botón de WhatsApp de su web. */
export const commsSchema = z.object({
  fromName: z.string().trim().max(120, "Máximo 120 caracteres").optional().default(""),
  replyTo: z.union([z.literal(""), z.string().trim().max(160, "Máximo 160 caracteres").email("Indica un email válido")]).optional().default(""),
  whatsapp: z
    .union([
      z.literal(""),
      z
        .string()
        .trim()
        .max(25, "Indica un móvil con WhatsApp")
        // El mismo criterio que el botón de la web: un fijo o un número sin prefijo válido daría un enlace roto
        .refine((v) => normalizeWhatsapp(v) !== null, "Indica un móvil con WhatsApp (un fijo no sirve); con prefijo, como +351, si es de fuera de España"),
    ])
    .optional()
    .default(""),
});
export type CommsData = z.infer<typeof commsSchema>;
export const COMMS_SETTING_KEYS: Record<keyof CommsData, string> = {
  fromName: "email_from_name",
  replyTo: "email_reply_to",
  whatsapp: "brand_whatsapp",
};

export const ACTIVITY_SETTING_KEY = "business_activity";
export const PROGRESS_SETTING_KEY = "setup_wizard_progress";

export interface SetupProgress {
  version: 1;
  steps: Record<SetupStep, { status: StepStatus; at: number | null }>;
  completedAt: number | null;
  updatedAt: number | null;
}

/**
 * ¿Mostrar la bienvenida al entrar? Solo a una empresa que aún no ha tocado el asistente (ningún paso guardado ni
 * omitido, tampoco «explorar primero») y no lo ha terminado. Después llega al Inicio, con su estado de configuración.
 */
export function shouldOpenSetupWizard(p: Pick<SetupProgress, "completedAt" | "updatedAt"> | null | undefined): boolean {
  return !!p && p.completedAt === null && p.updatedAt === null;
}

export function emptyProgress(): SetupProgress {
  const steps = {} as SetupProgress["steps"];
  for (const s of SETUP_STEPS) steps[s] = { status: "pending", at: null };
  return { version: 1, steps, completedAt: null, updatedAt: null };
}

/** Lee el progreso guardado; cualquier valor ilegible o ajeno vuelve al inicio sin romper. */
export function parseProgress(raw: string | null | undefined): SetupProgress {
  const base = emptyProgress();
  if (!raw) return base;
  try {
    const v = JSON.parse(raw) as Partial<SetupProgress>;
    if (!v || typeof v !== "object" || v.version !== 1 || typeof v.steps !== "object" || !v.steps) return base;
    const stored = v.steps as Record<string, { status?: unknown; at?: unknown }>;
    for (const s of SETUP_STEPS) {
      const st = stored[s];
      if (st && (st.status === "done" || st.status === "skipped")) base.steps[s] = { status: st.status, at: typeof st.at === "number" ? st.at : null };
    }
    base.completedAt = typeof v.completedAt === "number" ? v.completedAt : null;
    base.updatedAt = typeof v.updatedAt === "number" ? v.updatedAt : null;
    // Progreso de la versión anterior: quien ya había empezado no vuelve a ver la bienvenida, y «Empresa» incluía
    // los datos fiscales
    if (!stored.welcome && base.updatedAt !== null) base.steps.welcome = { status: "done", at: base.updatedAt };
    if (!stored.fiscal && base.steps.company.status !== "pending") base.steps.fiscal = { ...base.steps.company };
    // «Ventas, facturación y TPV» se ha dividido en «Primera venta» y «Primer presupuesto o factura»: lo omitido antes
    // sigue omitido en los dos
    if (!stored.document && base.steps.operation.status === "skipped") base.steps.document = { ...base.steps.operation };
    return base;
  } catch {
    return base;
  }
}

export class SetupWizardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SetupWizardError";
  }
}

/** Marca un paso. «Resumen y puesta en marcha» no se puede omitir; al finalizar queda registrada la fecha. */
export function markStep(p: SetupProgress, step: SetupStep, status: Exclude<StepStatus, "pending">, now: number): SetupProgress {
  if (!SETUP_STEPS.includes(step)) throw new SetupWizardError("Paso desconocido");
  if (step === "finish" && status !== "done") throw new SetupWizardError("El último paso no se puede omitir");
  const next: SetupProgress = { ...p, steps: { ...p.steps, [step]: { status, at: now } }, updatedAt: now };
  if (step === "finish") next.completedAt = p.completedAt ?? now;
  return next;
}

/** Primer paso guardado pendiente en el orden de referencia (null si todo está hecho u omitido). */
export function nextPendingStep(p: SetupProgress): SetupStep | null {
  return FLOW_STEPS.find((s) => p.steps[s].status === "pending") ?? null;
}

/** Porcentaje de pasos guardados resueltos (hechos u omitidos) en el orden de referencia. */
export function progressPercent(p: SetupProgress): number {
  const resolved = FLOW_STEPS.filter((s) => p.steps[s].status !== "pending").length;
  return Math.round((resolved / FLOW_STEPS.length) * 100);
}

// ── Plan: recorrido adaptado a la empresa ─────────────────────────────────────

/** Módulos sectoriales (capacidades del grupo «net») y dónde se empiezan a usar en el panel, si ya tienen pantalla. */
export const SECTOR_MODULES: ReadonlyArray<{ id: string; label: string; href: string | null }> = [
  { id: "hotel-net", label: "Hotel", href: "/admin/hotel" },
  { id: "restaurant-net", label: "Restaurantes", href: "/admin/restaurantes" },
  { id: "travel-net", label: "Viajes", href: "/admin/fiscal/reav" },
  { id: "care-net", label: "Care Net", href: null },
  { id: "ski-school", label: "Escuela de esquí", href: null },
  { id: "ski-rental", label: "Alquiler de material de esquí", href: null },
  { id: "life-net", label: "Life Net", href: null },
  { id: "social-token-net", label: "Social Token Net", href: null },
];

/**
 * Capacidades que hacen visible cada paso (basta una). Sin entrada, el paso se ve siempre.
 * El servidor sigue comprobando cada licencia en sus procedimientos: esto solo decide qué se enseña.
 */
export const STEP_CAPABILITIES: Partial<Record<SetupStep, readonly string[]>> = {
  client: ["crm-contacts"],
  product: ["shop-catalog"],
  web: ["cms-editor", "cms-pages-forms"],
  operation: ["shop-orders", "bill-cash"],
  document: ["crm-quotes", "bill-invoices"],
  comms: ["comms-email", "comms-whatsapp-links"],
  sector: SECTOR_MODULES.map((m) => m.id),
  users: ["admin-users"],
};

/** Datos reales de la empresa que completan pasos sin pedir nada (los lee el servidor de su propia BD). */
export interface SetupFacts {
  /** Nombre comercial, país, moneda y zona horaria guardados. */
  identity: boolean;
  /** Razón social, NIF y dirección guardados (o entidad fiscal ya registrada). */
  fiscal: boolean;
  /** Logotipo guardado. */
  brand: boolean;
  /** Tipo de actividad reconocible guardado. */
  activity: boolean;
  clients: number;
  products: number;
  /** Pedidos registrados (cobrados, o pendientes de cobro si no son un pago online a medias) y ventas en caja cobradas. */
  sales: number;
  /** Presupuestos + facturas. */
  documents: number;
  /** Alguna página editada o con bloques propios. */
  webEdited: boolean;
  /** Nombre del remitente, dirección de respuesta o WhatsApp guardados. */
  comms: boolean;
}

/** Orden de negocio del recorrido: el mismo para todas las empresas (los pasos no contratados se ocultan). */
export const FLOW_ORDER: readonly SetupStep[] = ["welcome", "company", "fiscal", "activity", "brand", "web", "client", "product", "operation", "document", "comms", "sector", "finish"];
/** Pasos prioritarios según el tipo de actividad: se destacan los dos primeros visibles; el orden no cambia. */
const PRIORITY: Record<BusinessActivity, readonly SetupStep[]> = {
  comercio: ["product", "operation", "client"],
  servicios: ["client", "document", "product"],
  web: ["web", "product", "operation"],
  sectorial: ["sector", "client", "product"],
};
/** Pasos que solo se completan con el dato real de la empresa (marcarlos «hechos» sin el dato no cuenta). */
export const DATA_STEPS: readonly SetupStep[] = ["company", "fiscal", "activity", "brand", "web", "client", "product", "operation", "document", "comms"];

export interface PlanStep {
  id: SetupStep;
  status: StepStatus;
  /** Prioritario para su tipo de actividad. */
  recommended: boolean;
  /** Hecho porque el dato ya existe (no hace falta volver a pedirlo). */
  byData: boolean;
}

export interface SetupPlan {
  steps: PlanStep[];
  /** Pasos que no se muestran porque su capacidad no está contratada. */
  hidden: SetupStep[];
  nextStep: SetupStep | null;
  percent: number;
  done: number;
  total: number;
  completedAt: number | null;
}

/**
 * Pasos de configuración que se cuentan y numeran: todos menos la bienvenida y el resumen final (no son tareas que
 * configurar). Es el único número que ven la bienvenida, el asistente («Paso X de N») y el estado del Inicio.
 */
export function configurationSteps<T extends { id: SetupStep }>(steps: readonly T[]): T[] {
  return steps.filter((s) => s.id !== "welcome" && s.id !== "finish");
}

/** Número del paso entre los de configuración (1…N), o null para la bienvenida y el resumen. */
export function configurationStepNumber(steps: readonly { id: SetupStep }[], id: SetupStep): number | null {
  const i = configurationSteps(steps).findIndex((s) => s.id === id);
  return i < 0 ? null : i + 1;
}

/** Paso siguiente a `from` en el recorrido indicado (el último si no hay más). */
export function stepAfter(steps: readonly { id: SetupStep }[], from: SetupStep): SetupStep {
  const i = steps.findIndex((s) => s.id === from);
  return steps[Math.min(i + 1, steps.length - 1)]?.id ?? "finish";
}

/**
 * A dónde ir al terminar u omitir `from`, sobre el plan ya actualizado: el siguiente paso PENDIENTE (lo hecho y lo
 * omitido no se repiten); si no queda ninguno detrás, el primero pendiente desde el principio; si no hay ninguno, el
 * resumen final.
 */
export function nextOpenStep(steps: readonly { id: SetupStep; status: StepStatus }[], from: SetupStep): SetupStep {
  const i = steps.findIndex((s) => s.id === from);
  const open = (s: { id: SetupStep; status: StepStatus }) => s.status === "pending" && s.id !== from && s.id !== "finish" && s.id !== "welcome";
  return steps.slice(i + 1).find(open)?.id ?? steps.find(open)?.id ?? "finish";
}

/** Contratado (activa o en solo lectura) o, sin licencias por capacidad (null), todo salvo lo sectorial. */
export function stepVisible(step: SetupStep, capabilities: ReadonlySet<string> | null): boolean {
  const caps = STEP_CAPABILITIES[step];
  if (!caps) return true;
  if (capabilities === null) return step !== "sector";
  return caps.some((c) => capabilities.has(c));
}

/** Tipos de actividad que se pueden elegir: «sectorial» solo con un módulo sectorial contratado. */
export function availableActivities(capabilities: ReadonlySet<string> | null) {
  const sector = stepVisible("sector", capabilities);
  return BUSINESS_ACTIVITIES.filter((a) => a.id !== "sectorial" || sector);
}

/**
 * Recorrido de la empresa: pasos visibles en el orden de negocio, estado real y siguiente paso.
 *  - Los pasos de DATA_STEPS están hechos solo si el dato existe en la BD de la empresa (un clic en «hecho» no
 *    basta); si no, cuentan como omitidos si se omitieron.
 *  - Módulo sectorial: hecho al confirmarlo (cada módulo tiene su propia configuración).
 *  - Bienvenida: resuelta en cuanto la empresa empieza o elige «explorar primero».
 */
export function buildSetupPlan(input: { progress: SetupProgress; activity: string | null | undefined; capabilities: ReadonlySet<string> | null; facts: SetupFacts }): SetupPlan {
  const { progress: p, capabilities, facts } = input;
  const profile = activityProfile(input.activity);
  const order = FLOW_ORDER;
  const recommended = new Set(profile ? PRIORITY[profile].filter((s) => stepVisible(s, capabilities)).slice(0, 2) : []);
  const byData: Partial<Record<SetupStep, boolean>> = {
    company: facts.identity,
    fiscal: facts.fiscal,
    activity: facts.activity,
    client: facts.clients > 0,
    product: facts.products > 0,
    web: facts.webEdited,
    operation: facts.sales > 0,
    document: facts.documents > 0,
    brand: facts.brand,
    comms: facts.comms,
  };
  const dataOnly = new Set<SetupStep>(DATA_STEPS);
  const statusOf = (s: SetupStep): { status: StepStatus; byData: boolean } => {
    const stored = p.steps[s].status;
    if (s === "finish") return { status: p.completedAt !== null ? "done" : "pending", byData: false };
    if (s === "welcome") return { status: stored !== "pending" || p.updatedAt !== null ? "done" : "pending", byData: false };
    if (byData[s]) return { status: "done", byData: true };
    if (dataOnly.has(s)) return { status: stored === "skipped" ? "skipped" : "pending", byData: false };
    return { status: stored, byData: false };
  };
  const steps: PlanStep[] = [];
  const hidden: SetupStep[] = [];
  for (const id of order) {
    if (!stepVisible(id, capabilities)) {
      hidden.push(id);
      continue;
    }
    steps.push({ id, ...statusOf(id), recommended: recommended.has(id) });
  }
  const resolved = steps.filter((s) => s.status !== "pending").length;
  // Avance: pasos de configuración HECHOS sobre los que se cuentan («X de N pasos hechos»): lo omitido no suma
  const counted = configurationSteps(steps);
  const doneCount = counted.filter((s) => s.status === "done").length;
  return {
    steps,
    hidden,
    nextStep: steps.find((s) => s.status === "pending")?.id ?? null,
    percent: counted.length ? Math.round((doneCount / counted.length) * 100) : 100,
    done: resolved,
    total: steps.length,
    completedAt: p.completedAt,
  };
}
