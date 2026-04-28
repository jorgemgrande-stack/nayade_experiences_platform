import { z } from "zod";
import { eq, inArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { getDb } from "../db";
import { router, protectedProcedure, permissionProcedure } from "../_core/trpc";
import { organizations, onboardingStatus, systemSettings } from "../../drizzle/schema";

// Default tenant — Nayade Experiences (id=1).
// Phase 5D will parameterize this per-request when multi-tenant is enabled.
const DEFAULT_ORG_ID = 1;

async function requireDb() {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Base de datos no disponible" });
  return db;
}

const adminProcedure = permissionProcedure("settings.advanced", ["admin"]);

// Maps wizard step id → DB field to set to true
const STEP_FIELDS: Record<string, Partial<typeof onboardingStatus.$inferInsert>> = {
  business_info: { businessInfoCompleted: true },
  fiscal:        { fiscalCompleted: true },
  branding:      { brandingCompleted: true },
  emails:        { emailsCompleted: true },
  modules:       { modulesCompleted: true },
  integrations:  { integrationsReviewed: true },
};

// Settings keys used to compute real progress (not just boolean flags)
const PROGRESS_KEYS = [
  "brand_name",
  "brand_nif",
  "brand_address",
  "brand_logo_url",
  "brand_primary_color",
  "email_reservations",
  "email_admin_alerts",
] as const;

// Env vars to check for the integrations step — only presence, never value.
const ENV_CHECKS = [
  { key: "SMTP_HOST",            label: "SMTP Servidor",               group: "SMTP" },
  { key: "SMTP_USER",            label: "SMTP Usuario",                group: "SMTP" },
  { key: "SMTP_PASS",            label: "SMTP Contraseña",             group: "SMTP" },
  { key: "REDSYS_MERCHANT_CODE", label: "Redsys Código de Comercio",   group: "Redsys" },
  { key: "REDSYS_SECRET_KEY",    label: "Redsys Clave Secreta",        group: "Redsys" },
  { key: "REDSYS_TERMINAL",      label: "Redsys Terminal",             group: "Redsys" },
  { key: "IMAP_TPV_HOST",        label: "IMAP Host (datáfono)",        group: "IMAP" },
  { key: "IMAP_TPV_USER",        label: "IMAP Usuario (datáfono)",     group: "IMAP" },
  { key: "IMAP_TPV_PASS",        label: "IMAP Contraseña (datáfono)",  group: "IMAP" },
  { key: "DATABASE_URL",         label: "Base de datos",               group: "Sistema" },
  { key: "VITE_APP_URL",         label: "URL pública de la app",       group: "Sistema" },
] as const;

export const onboardingRouter = router({
  // Returns onboarding progress for the default org, computed from real DB data.
  getStatus: adminProcedure.query(async () => {
    const db = await requireDb();

    // Get or create onboarding_status record
    let [status] = await db.select()
      .from(onboardingStatus)
      .where(eq(onboardingStatus.organizationId, DEFAULT_ORG_ID))
      .limit(1);

    if (!status) {
      await db.insert(onboardingStatus).values({ organizationId: DEFAULT_ORG_ID });
      [status] = await db.select()
        .from(onboardingStatus)
        .where(eq(onboardingStatus.organizationId, DEFAULT_ORG_ID))
        .limit(1);
    }

    // Fetch relevant settings to compute real progress
    const settingRows = await db
      .select({ key: systemSettings.key, value: systemSettings.value })
      .from(systemSettings)
      .where(inArray(systemSettings.key, [...PROGRESS_KEYS]));

    const val = (key: string) =>
      settingRows.find(s => s.key === key)?.value?.trim() ?? "";
    const has = (key: string) => val(key) !== "";

    // Steps 1–4: derived from real setting values.
    // Steps 5–6: user-confirmed actions (module selection, env review).
    const computed = {
      businessInfoCompleted: has("brand_name"),
      fiscalCompleted:       has("brand_nif") && has("brand_address"),
      brandingCompleted:     has("brand_logo_url") || has("brand_primary_color"),
      emailsCompleted:       has("email_reservations") && has("email_admin_alerts"),
      modulesCompleted:      status.modulesCompleted ?? false,
      integrationsReviewed:  status.integrationsReviewed ?? false,
    };

    const steps = Object.values(computed);
    const progress = Math.round(steps.filter(Boolean).length / steps.length * 100);

    return { ...status, ...computed, progress };
  }),

  // Marks one wizard step as completed (used for steps 5 & 6 which have no DB-derivable signal).
  completeStep: adminProcedure
    .input(z.object({
      step: z.enum(["business_info", "fiscal", "branding", "emails", "modules", "integrations"]),
    }))
    .mutation(async ({ input }) => {
      const db = await requireDb();
      await db.update(onboardingStatus)
        .set(STEP_FIELDS[input.step])
        .where(eq(onboardingStatus.organizationId, DEFAULT_ORG_ID));

      // Stamp completed_at when all 6 steps are done
      const [status] = await db.select()
        .from(onboardingStatus)
        .where(eq(onboardingStatus.organizationId, DEFAULT_ORG_ID))
        .limit(1);
      if (status) {
        const allDone =
          status.businessInfoCompleted && status.fiscalCompleted &&
          status.brandingCompleted && status.emailsCompleted &&
          status.modulesCompleted && status.integrationsReviewed;
        if (allDone && !status.completedAt) {
          await db.update(onboardingStatus)
            .set({ completedAt: new Date() })
            .where(eq(onboardingStatus.organizationId, DEFAULT_ORG_ID));
        }
      }
      return { ok: true };
    }),

  // Returns env var presence only — never the values.
  getEnvStatus: adminProcedure.query(() => {
    return ENV_CHECKS.map(c => ({ ...c, isSet: !!process.env[c.key] }));
  }),

  // Returns the default organization record.
  getOrg: adminProcedure.query(async () => {
    const db = await requireDb();
    const [org] = await db.select()
      .from(organizations)
      .where(eq(organizations.id, DEFAULT_ORG_ID))
      .limit(1);
    return org ?? null;
  }),
});
