/**
 * integrations.ts — configuración de integraciones por tenant (solo administradores).
 *
 * Disponible en modo multiempresa (en `single` las integraciones siguen en su configuración
 * actual y este router no hace nada). Los secretos se guardan cifrados y NUNCA se devuelven.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { adminProcedure, router } from "../_core/trpc";
import { isMultiTenant } from "../_core/tenant";
import { getVault } from "../_core/credentials/runtime";
import { getProvider } from "../_core/credentials/catalog";
import { testProvider } from "../_core/credentials/testers";
import { getDb } from "../db";
import { sql } from "drizzle-orm";
import { getSystemSetting, invalidateConfigCache } from "../config";
import { cleanThemeValues, THEME_EDITABLE_KEYS, ThemeValueError } from "../_core/theme";

/** Ajustes de identidad editables por el administrador del tenant (web y pantalla de acceso). */
const THEME_KEYS = THEME_EDITABLE_KEYS;
const THEME_LABEL: Record<string, string> = {
  brand_name: "Nombre comercial", brand_logo_url: "Logotipo", brand_favicon_url: "Favicon",
  theme_primary_color: "Color principal", theme_accent_color: "Color de acento", theme_font_family: "Tipografía",
  theme_radius: "Radio de bordes", seo_description: "Descripción (SEO)", brand_phone: "Teléfono",
  brand_location: "Dirección", email_reservations: "Correo de contacto", brand_hero_image_url: "Imagen principal de la web",
  login_background_url: "Fondo de la pantalla de acceso", login_welcome_title: "Titular de la pantalla de acceso",
  login_welcome_message: "Mensaje de bienvenida de la pantalla de acceso",
  analytics_ga4_id: "Google Analytics 4", analytics_meta_pixel_id: "Pixel de Meta",
};
/** Colores que el asistente antiguo y Configuración guardan como `brand_*`: se muestran si no hay `theme_*`. */
const COLOR_FALLBACK: Record<string, string> = { theme_primary_color: "brand_primary_color", theme_accent_color: "brand_accent_color" };

function requireMulti() {
  if (!isMultiTenant()) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Disponible solo en multiempresa" });
  }
}

const providerSchema = z.string().regex(/^[a-z]{2,16}$/);

export const integrationsRouter = router({
  /** Identidad corporativa pública (marca, logotipo, colores, tipografía). */
  themeGet: adminProcedure.query(async () => {
    const out: Record<string, string> = {};
    for (const k of THEME_KEYS) out[k] = await getSystemSetting(k, "");
    // En multiempresa el tema público usa `brand_*_color` cuando falta `theme_*`: se muestra lo que se ve
    if (isMultiTenant()) for (const [k, alt] of Object.entries(COLOR_FALLBACK)) if (!out[k]) out[k] = await getSystemSetting(alt, "");
    return out;
  }),

  themeSave: adminProcedure
    .input(z.object({ values: z.record(z.string().max(64), z.string().max(600)) }))
    .mutation(async ({ ctx, input }) => {
      let clean: Record<string, string>;
      try {
        clean = cleanThemeValues(input.values);
      } catch (e) {
        if (e instanceof ThemeValueError) throw new TRPCError({ code: "BAD_REQUEST", message: `${THEME_LABEL[e.key] ?? e.key}: ${e.message}` });
        throw e;
      }
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Base de datos no disponible" });
      for (const [k, v] of Object.entries(clean)) {
        await db.execute(sql`INSERT INTO system_settings (${sql.raw("`key`")}, value, category, label) VALUES (${k}, ${v}, 'theme', ${THEME_LABEL[k] ?? k})
          ON DUPLICATE KEY UPDATE value = VALUES(value)`);
      }
      invalidateConfigCache();
      console.warn(JSON.stringify({ ctx: "Theme", event: "saved", fields: Object.keys(clean), user: ctx.user.id }));
      return { saved: Object.keys(clean) };
    }),
  available: adminProcedure.query(() => ({ available: isMultiTenant() })),

  list: adminProcedure.query(async () => {
    requireMulti();
    return getVault().status();
  }),

  save: adminProcedure
    .input(z.object({ provider: providerSchema, values: z.record(z.string().max(64), z.string().max(1024)) }))
    .mutation(async ({ ctx, input }) => {
      requireMulti();
      if (!getProvider(input.provider)) throw new TRPCError({ code: "BAD_REQUEST", message: "Proveedor desconocido" });
      try {
        const r = await getVault().save(input.provider, input.values, `user:${ctx.user.id}`);
        // Auditoría sin valores: solo qué proveedor y qué campos
        console.warn(JSON.stringify({ ctx: "Integrations", event: "saved", provider: input.provider, fields: r.saved, user: ctx.user.id }));
        return r;
      } catch (e) {
        throw new TRPCError({ code: "BAD_REQUEST", message: e instanceof Error ? e.message : "Error" });
      }
    }),

  clear: adminProcedure.input(z.object({ provider: providerSchema })).mutation(async ({ ctx, input }) => {
    requireMulti();
    await getVault().clear(input.provider);
    console.warn(JSON.stringify({ ctx: "Integrations", event: "cleared", provider: input.provider, user: ctx.user.id }));
    return { ok: true };
  }),

  test: adminProcedure.input(z.object({ provider: providerSchema })).mutation(async ({ input }) => {
    requireMulti();
    const values = await getVault().resolve(input.provider);
    return testProvider(input.provider, values);
  }),
});
