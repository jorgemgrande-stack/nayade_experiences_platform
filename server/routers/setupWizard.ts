/**
 * «Primeros pasos»: asistente de configuración inicial de cada empresa.
 *
 * Solo guarda el progreso y los datos de empresa/actividad; el cliente, el producto, el presupuesto y
 * las invitaciones se crean con los procedimientos que ya existen (crm, products, admin), que aplican
 * sus propias validaciones, licencias y el límite de usuarios del plan.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, permissionProcedure } from "../_core/trpc";
import { getTenantMode } from "../_core/tenant";
import { tenantFiscalIdentity } from "../tenantBrand";
import { warmTenantIdentity } from "../_core/tenantIdentity";
import { countSeatUsers, currentLicence, readProgress, readSettings, updateProgress, upsertSettings } from "../setupWizardDb";
import {
  ACTIVITY_SETTING_KEY,
  BUSINESS_ACTIVITIES,
  COMPANY_SETTING_KEYS,
  SETUP_STEPS,
  SetupWizardError,
  companySchema,
  markStep,
  nextPendingStep,
  progressPercent,
  type CompanyData,
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

const guard = <T>(fn: () => T): T => {
  try {
    return fn();
  } catch (e) {
    if (e instanceof SetupWizardError) throw new TRPCError({ code: "BAD_REQUEST", message: e.message });
    throw e;
  }
};

const activityIds = BUSINESS_ACTIVITIES.map((a) => a.id) as [string, ...string[]];

export const setupWizardRouter = router({
  /** Estado completo para pintar el asistente (y el aviso de prueba). */
  status: adminProcedure.query(async () => {
    const keys = Object.values(COMPANY_SETTING_KEYS);
    const [progress, settings, licence, seatsUsed] = await Promise.all([
      readProgress(),
      readSettings([...keys, ACTIVITY_SETTING_KEY]),
      currentLicence().catch(() => null),
      countSeatUsers(),
    ]);
    const company = {} as Record<keyof CompanyData, string>;
    for (const [field, key] of Object.entries(COMPANY_SETTING_KEYS) as Array<[keyof CompanyData, string]>) company[field] = settings[key] ?? "";
    // En multiempresa, si el registro ya tiene entidad fiscal, es la que figura en las facturas
    let fiscalFromRegistry = false;
    if (getTenantMode() === "multi") {
      await warmTenantIdentity().catch(() => undefined);
      fiscalFromRegistry = tenantFiscalIdentity() !== null;
    }
    return {
      progress,
      nextStep: nextPendingStep(progress),
      percent: progressPercent(progress),
      company,
      activity: settings[ACTIVITY_SETTING_KEY] || null,
      seats: { used: seatsUsed, limit: licence?.userLimit ?? null },
      licence: licence ?? { plan: null, userLimit: null, endsAt: null, daysLeft: null, readOnly: false },
      fiscalFromRegistry,
    };
  }),

  /** Paso 1: datos de la empresa en sus ajustes (los mismos que Configuración y las facturas). */
  saveCompany: adminProcedure.input(companySchema).mutation(async ({ input }) => {
    await upsertSettings(
      (Object.keys(COMPANY_SETTING_KEYS) as Array<keyof CompanyData>).map((field) => ({
        key: COMPANY_SETTING_KEYS[field],
        value: String(input[field] ?? ""),
        label: LABELS[field],
        category: field === "tradeName" ? "branding" : field === "currency" || field === "timezone" ? "general" : field.startsWith("public") ? "negocio" : "fiscal",
      })),
    );
    const progress = await updateProgress((p) => markStep(p, "company", "done", Date.now()));
    return { progress, nextStep: nextPendingStep(progress) };
  }),

  /** Paso 2: tipo de actividad. Solo adapta textos y accesos; no activa módulos ni contrata nada. */
  saveActivity: adminProcedure.input(z.object({ activity: z.enum(activityIds, { message: "Elige una actividad de la lista" }) })).mutation(async ({ input }) => {
    await upsertSettings([{ key: ACTIVITY_SETTING_KEY, value: input.activity, label: "Tipo de actividad", category: "general" }]);
    const progress = await updateProgress((p) => markStep(p, "activity", "done", Date.now()));
    return { progress, nextStep: nextPendingStep(progress) };
  }),

  /** Marca un paso como hecho u omitido (los pasos 3 a 6 usan los procedimientos existentes). */
  setStep: adminProcedure
    .input(z.object({ step: z.enum(SETUP_STEPS), status: z.enum(["done", "skipped"]) }))
    .mutation(async ({ input }) => {
      const progress = await updateProgress((p) => guard(() => markStep(p, input.step, input.status, Date.now())));
      return { progress, nextStep: nextPendingStep(progress) };
    }),

  /** Plazas de usuario del plan (para el paso de invitaciones). */
  seats: adminProcedure.query(async () => {
    const [licence, used] = await Promise.all([currentLicence().catch(() => null), countSeatUsers()]);
    const limit = licence?.userLimit ?? null;
    return { used, limit, plan: licence?.plan ?? null, available: limit === null ? null : Math.max(0, limit - used) };
  }),
});
