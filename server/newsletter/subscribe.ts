/**
 * Alta pública a la newsletter desde el bloque de la web. Lógica única que comparten la ruta REST pública
 * (`POST /api/newsletter/subscribe`, la que usa el formulario: un visitante sin sesión no pasa por `/api/trpc`) y el
 * procedimiento tRPC `newsletter.subscribe`.
 * Mismo recorrido de seguridad que los formularios del Studio: origen de la propia web, límite por visitante, campo
 * trampa, tiempo mínimo y límite global. Siempre responde igual exista o no el correo.
 */
import { z } from "zod";
import { allowFormSubmit } from "../_core/studioForms";
import { sameSiteRequest } from "../_core/studioFormsSubmit";
import { peekTenantContext } from "../_core/tenant";
import { newsletterLang, newsletterMessage, NEWSLETTER_MESSAGES, type NewsletterMsgKey } from "../../shared/newsletterMessages";
import { cleanText, ipFingerprint } from "./core";
import { ipSecret, newsletterService } from "./runtime";
import { NewsletterError } from "./service";
import { NewsletterNotInstalled } from "./store";

export const subscribeInput = z.object({
  slug: z.string().trim().min(1).max(200),
  blockId: z.string().trim().min(1).max(64),
  email: z.string().max(320),
  consent: z.boolean(),
  website: z.string().max(200).optional(),
  elapsedMs: z.number().int().nonnegative().max(86_400_000).optional(),
  locale: z.string().max(8).optional(),
  page: z.string().max(200).optional(),
});
export type SubscribeInput = z.infer<typeof subscribeInput>;

/** Fallo con su código HTTP y el mensaje (ya en el idioma del visitante) que se le muestra. */
export class SubscribeFailure extends Error {
  constructor(
    public readonly status: 400 | 403 | 404 | 412 | 429 | 500,
    message: string,
  ) {
    super(message);
  }
}

export interface RequestLike {
  headers: Record<string, string | string[] | undefined>;
  ip?: string;
  socket?: { remoteAddress?: string };
}
const hdr = (req: RequestLike, n: string) => {
  const v = req.headers[n];
  return Array.isArray(v) ? v[0] : v;
};

export async function subscribeFromWeb(input: SubscribeInput, req: RequestLike): Promise<{ ok: true; message: string }> {
  const M = NEWSLETTER_MESSAGES[newsletterLang(input.locale)];
  if (!sameSiteRequest({ origin: hdr(req, "origin"), referer: hdr(req, "referer"), hosts: [hdr(req, "x-forwarded-host"), hdr(req, "host")] })) {
    throw new SubscribeFailure(403, M.forbiddenMessage);
  }
  const ip = req.ip || req.socket?.remoteAddress || "desconocida";
  const tenantId = peekTenantContext()?.tenantId ?? "single";
  // Límite por visitante (el mismo que los formularios del Studio); campo trampa y tiempo mínimo: a un envío automático se le responde igual
  if (!allowFormSubmit(`newsletter:${tenantId}:${ip}`)) throw new SubscribeFailure(429, M.rateLimitedMessage);
  const found = await (await import("../pageBuilderDb")).getPublishedNewsletterBlock(input.slug, input.blockId);
  if (!found) throw new SubscribeFailure(404, M.unavailableMessage);
  const msg = (k: NewsletterMsgKey) => newsletterMessage(input.locale, k, cleanText((found.localized as Record<string, unknown> | null)?.[k], 300) || cleanText((found.data as Record<string, unknown>)[k], 300));
  const okMessage = msg("successMessage");
  if ((input.website ?? "").trim() !== "" || (input.elapsedMs != null && input.elapsedMs < 1500)) return { ok: true, message: okMessage };
  const consentText = newsletterMessage(input.locale, "consentText", cleanText((found.localized as Record<string, unknown> | null)?.consentText, 600) || cleanText((found.data as Record<string, unknown>).consentText, 600));
  const path = /^\/[^\s<>"']{0,199}$/.test(input.page ?? "") ? input.page! : `/${found.slug}`;
  try {
    await newsletterService().subscribe({
      email: input.email,
      consent: input.consent,
      locale: input.locale,
      source: `web:${found.slug}`.slice(0, 64),
      page: path,
      consentText,
      ipHash: ipFingerprint(ip, tenantId, ipSecret()),
    });
    return { ok: true, message: okMessage };
  } catch (e) {
    if (e instanceof NewsletterError) {
      if (e.code === "invalid_input") throw new SubscribeFailure(400, msg("invalidEmailMessage"));
      if (e.code === "no_consent") throw new SubscribeFailure(400, msg("noConsentMessage"));
      if (e.code === "rate_limited") throw new SubscribeFailure(429, msg("rateLimitedMessage"));
      throw new SubscribeFailure(412, msg("errorMessage"));
    }
    if (e instanceof NewsletterNotInstalled) throw new SubscribeFailure(412, msg("errorMessage"));
    console.error(JSON.stringify({ ctx: "Newsletter", event: "subscribe_error", error: e instanceof Error ? e.message.slice(0, 200) : "error" }));
    throw new SubscribeFailure(500, msg("errorMessage"));
  }
}
