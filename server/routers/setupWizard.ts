/**
 * «Primeros pasos»: asistente de configuración inicial de cada empresa.
 *
 * Solo guarda el progreso y los datos de empresa, actividad y comunicaciones (en los mismos ajustes que usa
 * Configuración: nada se duplica); el cliente, el producto, el presupuesto, la marca y las invitaciones se crean
 * con los procedimientos que ya existen (crm, products, integrations, admin), que aplican sus propias
 * validaciones, licencias y el límite de usuarios del plan.
 *
 * El recorrido se adapta a la empresa (`buildSetupPlan`): tipo de actividad, capacidades contratadas y datos
 * reales de su propia BD (un paso «de hacer» se completa cuando el dato existe).
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, permissionProcedure } from "../_core/trpc";
import { getTenantMode } from "../_core/tenant";
import { tenantFiscalIdentity } from "../tenantBrand";
import { warmTenantIdentity } from "../_core/tenantIdentity";
import {
  contractedSetupCapabilities,
  countSeatUsers,
  currentLicence,
  readProgress,
  readSettings,
  readSetupCounts,
  recordOnboardingFirstAccess,
  updateProgress,
  upsertSettings,
} from "../setupWizardDb";
import { onboardingFirstAccess, onboardingProgressed } from "../onboardingNotices";
import { ensureStarterPages, missingLegalData, readSiteTokenData } from "../starterSiteDb";
import {
  ACTIVITY_SETTING_KEY,
  BUSINESS_ACTIVITIES,
  COMMS_SETTING_KEYS,
  COMPANY_SETTING_KEYS,
  COUNTRIES,
  FISCAL_FIELDS,
  IDENTITY_FIELDS,
  SECTOR_MODULES,
  SETUP_STEPS,
  SetupWizardError,
  activityProfile,
  availableActivities,
  buildSetupPlan,
  commsSchema,
  companySchema,
  fiscalSchema,
  identitySchema,
  markStep,
  spanishFiscalErrors,
  type CommsData,
  type CompanyData,
  type SetupProgress,
} from "../../shared/setupWizard";

const adminProcedure = permissionProcedure("settings.manage", ["admin"]);

const LABELS: Record<keyof CompanyData, string> = {
  tradeName: "Nombre comercial",
  legalName: "Razón social",
  taxId: "NIF / CIF",
  address: "Dirección fiscal",
  postalCode: "Código postal",
  city: "Ciudad",
  province: "Provincia",
  country: "País",
  currency: "Moneda",
  timezone: "Zona horaria",
  publicPhone: "Teléfono",
  publicEmail: "Email de contacto",
  publicLocation: "Ubicación",
};
const COMMS_LABELS: Record<keyof CommsData, string> = {
  fromName: "Remitente (nombre)",
  replyTo: "Responder a",
  whatsapp: "WhatsApp",
};
const BRAND_LOGO_KEY = "brand_logo_url";

const guard = <T>(fn: () => T): T => {
  try {
    return fn();
  } catch (e) {
    if (e instanceof SetupWizardError) throw new TRPCError({ code: "BAD_REQUEST", message: e.message });
    throw e;
  }
};

const activityIds = BUSINESS_ACTIVITIES.map((a) => a.id) as [string, ...string[]];

type Who = { user: { email?: string | null; name?: string | null } };
const recipient = (ctx: Who) => ({ email: ctx.user.email ?? null, name: ctx.user.name ?? null });

/** Cambia el progreso y, si cruza la mitad de los pasos, avisa del progreso (sin esperar al correo). */
async function changeProgress(ctx: Who, change: Parameters<typeof updateProgress>[0]) {
  // El aviso cuenta los pasos con el mismo recorrido que el asistente (plan), no con el progreso guardado
  const before = (await loadState()).plan;
  const progress = await updateProgress(change);
  void loadState().then((s) => onboardingProgressed(before, s.plan, recipient(ctx))).catch(() => undefined);
  return progress;
}

const filled = (v: string | undefined | null) => !!(v ?? "").trim();

/** Entidad fiscal registrada para la empresa (solo multiempresa): es la que figura en sus facturas. */
async function registryFiscal() {
  if (getTenantMode() !== "multi") return null;
  await warmTenantIdentity().catch(() => undefined);
  return tenantFiscalIdentity();
}

/**
 * Paso «Página web»: la portada y los textos legales iniciales existen desde el primer acceso (se crean si faltan) y
 * se avisa de los datos fiscales que les faltan. Solo en multiempresa; nunca bloquea el asistente.
 */
async function webLegalMissing(): Promise<string[]> {
  if (getTenantMode() !== "multi") return [];
  try {
    await ensureStarterPages();
    return missingLegalData(await readSiteTokenData());
  } catch {
    return [];
  }
}

/** Estado completo: progreso guardado, datos ya existentes (rellenos) y el recorrido adaptado. */
export async function loadState() {
  const keys = [...Object.values(COMPANY_SETTING_KEYS), ...Object.values(COMMS_SETTING_KEYS), ACTIVITY_SETTING_KEY, BRAND_LOGO_KEY];
  const [progress, settings, counts, capabilities, fiscal] = await Promise.all([
    readProgress(),
    readSettings(keys),
    readSetupCounts(),
    contractedSetupCapabilities(),
    registryFiscal(),
  ]);
  const company = {} as Record<keyof CompanyData, string>;
  for (const [field, key] of Object.entries(COMPANY_SETTING_KEYS) as Array<[keyof CompanyData, string]>) company[field] = settings[key] ?? "";
  // Lo que ya consta en el registro se muestra relleno (no se vuelve a pedir)
  if (fiscal) {
    company.legalName ||= fiscal.legalName;
    company.taxId ||= fiscal.taxId;
    company.address ||= fiscal.address ?? "";
    if (!company.country && COUNTRIES.some((c) => c.code === fiscal.country)) company.country = fiscal.country;
  }
  const comms = {} as Record<keyof CommsData, string>;
  for (const [field, key] of Object.entries(COMMS_SETTING_KEYS) as Array<[keyof CommsData, string]>) comms[field] = settings[key] ?? "";
  const activity = settings[ACTIVITY_SETTING_KEY] || null;
  const facts = {
    identity: IDENTITY_FIELDS.every((f) => filled(company[f])),
    fiscal: fiscal !== null || (filled(company.legalName) && filled(company.taxId) && filled(company.address)),
    brand: filled(settings[BRAND_LOGO_KEY]),
    activity: activityProfile(activity) !== null,
    ...counts,
    comms: filled(comms.fromName) || filled(comms.replyTo) || filled(comms.whatsapp),
  };
  const plan = buildSetupPlan({ progress, activity, capabilities, facts });
  return { progress, company, comms, activity, capabilities, facts, plan, fiscalFromRegistry: fiscal !== null };
}

/** Respuesta común de las mutaciones: el progreso y el recorrido recalculado. */
async function after(progress: SetupProgress) {
  const s = await loadState();
  return { progress, nextStep: s.plan.nextStep, plan: s.plan };
}

/** NIF/CIF y código postal de una empresa española: se comprueban también en el servidor, no solo en el formulario. */
async function assertSpanishFiscal(country: string | null | undefined, v: { taxId?: string; postalCode?: string }) {
  const errors = spanishFiscalErrors(country, v);
  // El NIF de la entidad fiscal registrada (el de las facturas) ya lo validó quien la dio de alta: se acepta tal cual
  if (errors.taxId) {
    const registry = await registryFiscal().catch(() => null);
    const norm = (x: string | null | undefined) => (x ?? "").toUpperCase().replace(/[\s.-]/g, "");
    if (registry && norm(registry.taxId) === norm(v.taxId)) delete errors.taxId;
  }
  const first = errors.taxId ?? errors.postalCode;
  if (first) throw new TRPCError({ code: "BAD_REQUEST", message: first });
}

function saveCompanyFields(fields: ReadonlyArray<keyof CompanyData>, input: Partial<Record<keyof CompanyData, string>>) {
  return upsertSettings(
    fields.map((field) => ({
      key: COMPANY_SETTING_KEYS[field],
      value: String(input[field] ?? ""),
      label: LABELS[field],
      category: field === "tradeName" ? "branding" : field === "currency" || field === "timezone" ? "general" : field.startsWith("public") ? "negocio" : "fiscal",
    })),
  );
}

export const setupWizardRouter = router({
  /** Estado completo para pintar el asistente, la bienvenida y el estado de configuración del Inicio. */
  status: adminProcedure.query(async ({ ctx }) => {
    const [state, licence, seatsUsed, legalMissing] = await Promise.all([loadState(), currentLicence().catch(() => null), countSeatUsers(), webLegalMissing()]);
    const { progress } = state;
    // Primer acceso al asistente sin ningún paso dado: guía de los primeros pasos (una sola vez)
    void onboardingFirstAccess(progress, recipient(ctx));
    // Y su fecha, una sola vez: de ella cuentan los recordatorios de configuración incompleta (onboardingReminders.ts)
    if (progress.updatedAt === null && progress.completedAt === null) void recordOnboardingFirstAccess(typeof ctx.user.id === "number" ? ctx.user.id : null, Date.now()).catch(() => undefined);
    const caps = state.capabilities;
    return {
      progress,
      nextStep: state.plan.nextStep,
      percent: state.plan.percent,
      plan: state.plan,
      facts: state.facts,
      company: state.company,
      comms: state.comms,
      activity: state.activity,
      profile: activityProfile(state.activity),
      activities: availableActivities(caps).map((a) => a.id),
      sectorModules: caps === null ? [] : SECTOR_MODULES.filter((m) => caps.has(m.id)),
      seats: { used: seatsUsed, limit: licence?.userLimit ?? null },
      licence: licence ?? { plan: null, userLimit: null, endsAt: null, daysLeft: null, readOnly: false },
      fiscalFromRegistry: state.fiscalFromRegistry,
      /** Datos que faltan para completar los textos legales de la web (vacío si están todos). */
      legalMissing,
    };
  }),

  /** Identidad y datos fiscales de una vez (compatibilidad con la versión anterior del asistente). */
  saveCompany: adminProcedure.input(companySchema).mutation(async ({ input, ctx }) => {
    await assertSpanishFiscal(input.country, input);
    await saveCompanyFields(Object.keys(COMPANY_SETTING_KEYS) as Array<keyof CompanyData>, input);
    const now = Date.now();
    return after(await changeProgress(ctx, (p) => markStep(markStep(p, "company", "done", now), "fiscal", "done", now)));
  }),

  /** Paso «Datos de la empresa». */
  saveIdentity: adminProcedure.input(identitySchema).mutation(async ({ input, ctx }) => {
    await saveCompanyFields(IDENTITY_FIELDS, input);
    return after(await changeProgress(ctx, (p) => markStep(p, "company", "done", Date.now())));
  }),

  /** Paso «Datos fiscales». */
  saveFiscal: adminProcedure.input(fiscalSchema).mutation(async ({ input, ctx }) => {
    // El país es el del paso «Datos de la empresa»; sin él, se da por España
    await assertSpanishFiscal((await readSettings([COMPANY_SETTING_KEYS.country]))[COMPANY_SETTING_KEYS.country], input);
    await saveCompanyFields(FISCAL_FIELDS, input);
    return after(await changeProgress(ctx, (p) => markStep(p, "fiscal", "done", Date.now())));
  }),

  /** Paso «Tipo de actividad». Destaca los pasos prioritarios y adapta textos; no activa módulos ni contrata nada. */
  saveActivity: adminProcedure.input(z.object({ activity: z.enum(activityIds, { message: "Elige una actividad de la lista" }) })).mutation(async ({ input, ctx }) => {
    if (!availableActivities(await contractedSetupCapabilities()).some((a) => a.id === input.activity)) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Tu empresa no tiene contratado ningún módulo sectorial: elige otro tipo de actividad" });
    }
    await upsertSettings([{ key: ACTIVITY_SETTING_KEY, value: input.activity, label: "Tipo de actividad", category: "general" }]);
    return after(await changeProgress(ctx, (p) => markStep(p, "activity", "done", Date.now())));
  }),

  /** Paso «Comunicaciones»: nombre del remitente, dirección de respuesta y WhatsApp de la web. */
  saveComms: adminProcedure.input(commsSchema).mutation(async ({ input, ctx }) => {
    await upsertSettings(
      (Object.keys(COMMS_SETTING_KEYS) as Array<keyof CommsData>).map((field) => ({
        key: COMMS_SETTING_KEYS[field],
        value: String(input[field] ?? ""),
        label: COMMS_LABELS[field],
        category: field === "whatsapp" ? "negocio" : "email",
      })),
    );
    return after(await changeProgress(ctx, (p) => markStep(p, "comms", "done", Date.now())));
  }),

  /** Marca un paso como hecho u omitido (los pasos «de hacer» cuentan como hechos solo si el dato existe). */
  setStep: adminProcedure
    .input(z.object({ step: z.enum(SETUP_STEPS), status: z.enum(["done", "skipped"]) }))
    .mutation(async ({ input, ctx }) => after(await changeProgress(ctx, (p) => guard(() => markStep(p, input.step, input.status, Date.now()))))),

  /** Plazas de usuario del plan (para invitar al equipo). */
  seats: adminProcedure.query(async () => {
    const [licence, used] = await Promise.all([currentLicence().catch(() => null), countSeatUsers()]);
    const limit = licence?.userLimit ?? null;
    return { used, limit, plan: licence?.plan ?? null, available: limit === null ? null : Math.max(0, limit - used) };
  }),
});
