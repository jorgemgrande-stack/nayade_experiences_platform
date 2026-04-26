import { z } from "zod";
import { eq } from "drizzle-orm";
import mysql from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../_core/trpc";
import { organizations, onboardingStatus } from "../../drizzle/schema";

// Default tenant — Nayade Experiences (id=1).
// Phase 5D will parameterize this per-request when multi-tenant is enabled.
const DEFAULT_ORG_ID = 1;

function getDb() {
  const pool = mysql.createPool(process.env.DATABASE_URL!);
  return drizzle(pool);
}

const adminProcedure = protectedProcedure.use(({ ctx, next }) => {
  if ((ctx.user as { role: string }).role !== "admin") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Acceso restringido a administradores" });
  }
  return next({ ctx });
});

// Maps wizard step id → DB field to set to true
const STEP_FIELDS: Record<string, Partial<typeof onboardingStatus.$inferInsert>> = {
  business_info: { businessInfoCompleted: true },
  fiscal:        { fiscalCompleted: true },
  branding:      { brandingCompleted: true },
  emails:        { emailsCompleted: true },
  modules:       { modulesCompleted: true },
  integrations:  { integrationsReviewed: true },
};

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
  // Returns onboarding progress for the default org.
  getStatus: adminProcedure.query(async () => {
    const db = getDb();
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

    const steps = [
      status.businessInfoCompleted,
      status.fiscalCompleted,
      status.brandingCompleted,
      status.emailsCompleted,
      status.modulesCompleted,
      status.integrationsReviewed,
    ];
    const completed = steps.filter(Boolean).length;
    const progress = Math.round((completed / steps.length) * 100);

    return { ...status, progress };
  }),

  // Marks one wizard step as completed.
  completeStep: adminProcedure
    .input(z.object({
      step: z.enum(["business_info", "fiscal", "branding", "emails", "modules", "integrations"]),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();
      await db.update(onboardingStatus)
        .set(STEP_FIELDS[input.step])
        .where(eq(onboardingStatus.organizationId, DEFAULT_ORG_ID));

      // If all 6 steps done, stamp completed_at
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
    const db = getDb();
    const [org] = await db.select()
      .from(organizations)
      .where(eq(organizations.id, DEFAULT_ORG_ID))
      .limit(1);
    return org ?? null;
  }),
});
