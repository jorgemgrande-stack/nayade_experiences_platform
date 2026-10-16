/**
 * Asistente de configuración inicial («Primeros pasos»): definiciones compartidas entre el panel y
 * el servidor. Solo datos y reglas puras; la persistencia vive en `server/setupWizardDb.ts`.
 */
import { z } from "zod";

export const SETUP_STEPS = ["company", "activity", "client", "product", "operation", "users", "finish"] as const;
export type SetupStep = (typeof SETUP_STEPS)[number];
export type StepStatus = "pending" | "done" | "skipped";

export const STEP_LABELS: Record<SetupStep, { title: string; summary: string }> = {
  company: { title: "Empresa", summary: "Nombre comercial, datos fiscales, moneda y zona horaria." },
  activity: { title: "Actividad", summary: "A qué se dedica tu negocio, para adaptar los textos y accesos." },
  client: { title: "Primer cliente", summary: "Da de alta a tu primer cliente." },
  product: { title: "Primer producto o servicio", summary: "Lo que vendes, con su precio e impuesto." },
  operation: { title: "Primera operación", summary: "Prepara tu primer presupuesto o pedido." },
  users: { title: "Usuarios", summary: "Invita a tu equipo dentro del límite de tu plan." },
  finish: { title: "Finalizar", summary: "Repaso y siguientes pasos." },
};

/**
 * Tipos de actividad. Solo adaptan textos y accesos directos del asistente: NO activan módulos ni
 * contratan nada.
 */
export const BUSINESS_ACTIVITIES = [
  { id: "servicios", label: "Servicios", productNoun: "servicio", productExample: "Sesión de asesoría (1 hora)", clientNoun: "cliente" },
  { id: "comercio", label: "Comercio o tienda", productNoun: "producto", productExample: "Camiseta de algodón", clientNoun: "cliente" },
  { id: "hosteleria", label: "Hostelería y restauración", productNoun: "producto", productExample: "Menú del día", clientNoun: "cliente" },
  { id: "turismo", label: "Turismo, ocio y actividades", productNoun: "actividad", productExample: "Ruta guiada de medio día", clientNoun: "cliente" },
  { id: "profesional", label: "Despacho profesional", productNoun: "servicio", productExample: "Consulta inicial", clientNoun: "cliente" },
  { id: "formacion", label: "Formación", productNoun: "curso", productExample: "Curso de iniciación (8 horas)", clientNoun: "alumno" },
  { id: "otro", label: "Otra actividad", productNoun: "producto o servicio", productExample: "Mi primer servicio", clientNoun: "cliente" },
] as const;
export type BusinessActivity = (typeof BUSINESS_ACTIVITIES)[number]["id"];
export const activityInfo = (id: string | null | undefined) => BUSINESS_ACTIVITIES.find((a) => a.id === id) ?? BUSINESS_ACTIVITIES[BUSINESS_ACTIVITIES.length - 1];

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

/** Datos de la empresa (paso 1). */
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
});
export type CompanyData = z.infer<typeof companySchema>;

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
};
export const ACTIVITY_SETTING_KEY = "business_activity";
export const PROGRESS_SETTING_KEY = "setup_wizard_progress";

export interface SetupProgress {
  version: 1;
  steps: Record<SetupStep, { status: StepStatus; at: number | null }>;
  completedAt: number | null;
  updatedAt: number | null;
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
    for (const s of SETUP_STEPS) {
      const st = (v.steps as Record<string, { status?: unknown; at?: unknown }>)[s];
      if (st && (st.status === "done" || st.status === "skipped")) base.steps[s] = { status: st.status, at: typeof st.at === "number" ? st.at : null };
    }
    base.completedAt = typeof v.completedAt === "number" ? v.completedAt : null;
    base.updatedAt = typeof v.updatedAt === "number" ? v.updatedAt : null;
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

/** Marca un paso. «Finalizar» no se puede omitir; al finalizar queda registrada la fecha. */
export function markStep(p: SetupProgress, step: SetupStep, status: Exclude<StepStatus, "pending">, now: number): SetupProgress {
  if (!SETUP_STEPS.includes(step)) throw new SetupWizardError("Paso desconocido");
  if (step === "finish" && status !== "done") throw new SetupWizardError("El último paso no se puede omitir");
  const next: SetupProgress = { ...p, steps: { ...p.steps, [step]: { status, at: now } }, updatedAt: now };
  if (step === "finish") next.completedAt = p.completedAt ?? now;
  return next;
}

/** Primer paso pendiente (null si todo está hecho u omitido). */
export function nextPendingStep(p: SetupProgress): SetupStep | null {
  return SETUP_STEPS.find((s) => p.steps[s].status === "pending") ?? null;
}

/** Porcentaje de pasos resueltos (hechos u omitidos). */
export function progressPercent(p: SetupProgress): number {
  const resolved = SETUP_STEPS.filter((s) => p.steps[s].status !== "pending").length;
  return Math.round((resolved / SETUP_STEPS.length) * 100);
}
