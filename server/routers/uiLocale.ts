/** Router: idioma de la interfaz del panel (individual por usuario). */
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { legacyDb } from "../_core/legacyDb";
import { LOCALES } from "../../shared/i18n/core";
import { readUiLocale, writeUiLocale } from "../uiLocale";

export const uiLocaleRouter = router({
  /** Idioma guardado de ESTE usuario (null = nunca eligió: idioma principal). */
  get: protectedProcedure.query(async ({ ctx }) => ({ locale: await readUiLocale(legacyDb(), ctx.user.id) })),

  /** Guarda el idioma del usuario que llama; no toca a nadie más. En modo soporte no se escribe (la persona atendida no cambia). */
  set: protectedProcedure.input(z.object({ locale: z.enum(LOCALES) })).mutation(async ({ ctx, input }) => {
    if ((ctx.user as { supportGrantId?: unknown }).supportGrantId) return { persisted: false as const };
    return { persisted: await writeUiLocale(legacyDb(), ctx.user.id, input.locale) };
  }),
});
