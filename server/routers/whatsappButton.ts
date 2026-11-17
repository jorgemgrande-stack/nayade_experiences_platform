/**
 * whatsappButton.* — botón flotante de WhatsApp de la web pública de la empresa (17/11/2026): activo o no, número
 * (el WhatsApp de la empresa, `brand_whatsapp`, el mismo de «Primeros pasos»), posición y mensaje inicial por idioma.
 * Solo enlaza con wa.me: no envía nada ni usa servicios de chat de terceros. Sin claves ni secretos: se puede
 * gestionar también desde una sesión de soporte con modificación (queda registrada).
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { adminProcedure, router } from "../_core/trpc";
import { readSettings, upsertSettings } from "../setupWizardDb";
import { normalizeWhatsapp, parseWhatsappButtonConfig, WHATSAPP_BUTTON_SETTING, WHATSAPP_LOCALE_RE, WHATSAPP_MESSAGE_MAX, WHATSAPP_POSITIONS } from "../../shared/whatsappButton";

const WHATSAPP_SETTING = "brand_whatsapp";

export const whatsappButtonInput = z
  .object({
    enabled: z.boolean(),
    /** Móvil con WhatsApp; con prefijo internacional si no es de España (como +49…). */
    whatsapp: z.string().trim().max(25),
    position: z.enum(WHATSAPP_POSITIONS),
    messages: z.record(z.string().regex(WHATSAPP_LOCALE_RE), z.string().trim().max(WHATSAPP_MESSAGE_MAX)),
  })
  .strict();

export const whatsappButtonRouter = router({
  get: adminProcedure.query(async () => {
    const s = await readSettings([WHATSAPP_SETTING, WHATSAPP_BUTTON_SETTING]);
    const whatsapp = (s[WHATSAPP_SETTING] ?? "").trim();
    return { whatsapp, valid: normalizeWhatsapp(whatsapp) !== null, ...parseWhatsappButtonConfig(s[WHATSAPP_BUTTON_SETTING]) };
  }),

  save: adminProcedure.input(whatsappButtonInput).mutation(async ({ input }) => {
    const phone = input.whatsapp ? normalizeWhatsapp(input.whatsapp) : null;
    if (input.whatsapp && !phone) throw new TRPCError({ code: "BAD_REQUEST", message: "Indica un móvil con WhatsApp (un fijo no sirve); con prefijo, como +49, si es de fuera de España" });
    if (input.enabled && !phone) throw new TRPCError({ code: "BAD_REQUEST", message: "Para mostrar el botón hace falta el número de WhatsApp de la empresa" });
    const messages = Object.fromEntries(Object.entries(input.messages).filter(([, m]) => m.length > 0));
    await upsertSettings([
      { key: WHATSAPP_SETTING, value: input.whatsapp, label: "WhatsApp de la empresa", category: "negocio" },
      { key: WHATSAPP_BUTTON_SETTING, value: JSON.stringify({ enabled: input.enabled, position: input.position, messages }), label: "Botón flotante de WhatsApp de la web", category: "web", valueType: "json" },
    ]);
    const s = await readSettings([WHATSAPP_SETTING, WHATSAPP_BUTTON_SETTING]);
    return { whatsapp: (s[WHATSAPP_SETTING] ?? "").trim(), valid: phone !== null, ...parseWhatsappButtonConfig(s[WHATSAPP_BUTTON_SETTING]) };
  }),
});
