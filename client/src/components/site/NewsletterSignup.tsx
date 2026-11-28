/**
 * Formulario público de inscripción a la newsletter (módulo «Newsletter» del Studio). Correo + casilla de consentimiento
 * (desmarcada y obligatoria) + enlace a la política de privacidad. Envía por la ruta pública `/api/newsletter/subscribe`; el servidor toma el
 * texto legal del bloque PUBLICADO (no del navegador), valida, limita las peticiones y manda el correo de confirmación.
 * El envío va por la ruta REST pública `POST /api/newsletter/subscribe` (un visitante sin sesión no pasa por /api/trpc).
 * Antispam: campo trampa invisible y tiempo mínimo de relleno. En el editor y en la vista previa no se envía nada.
 */
import { useId, useRef, useState } from "react";
import { useSiteLocale } from "@/hooks/useSiteLocale";
import { useLegalHref } from "@/hooks/useLegalHref";
import { cn } from "@/lib/utils";
import type { BlockDataMap } from "@shared/pageBlocks";
import { newsletterMessage } from "@shared/newsletterMessages";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Dirección de la página en la que está el bloque («/» es la portada). Igual que los formularios del Studio. */
function currentSlug(): string {
  const parts = window.location.pathname.split("/").filter(Boolean);
  const last = parts[parts.length - 1] ?? "";
  return /^[a-z0-9-]{1,64}$/.test(last) ? last : "inicio";
}

const TONE: Record<BlockDataMap["newsletter"]["tone"], { input: string; button: string; muted: string; link: string }> = {
  soft: { input: "bg-background text-foreground border-border", button: "bg-primary text-primary-foreground hover:bg-primary/90", muted: "text-muted-foreground", link: "text-primary" },
  dark: { input: "bg-background text-foreground border-transparent", button: "bg-background text-foreground hover:bg-background/90", muted: "text-background/75", link: "text-background" },
  brand: { input: "bg-background text-foreground border-transparent", button: "bg-foreground text-background hover:bg-foreground/90", muted: "text-primary-foreground/85", link: "text-primary-foreground" },
};

export function NewsletterSignupForm({ blockId, data, preview, editing }: { blockId: string; data: BlockDataMap["newsletter"]; preview?: boolean; editing?: boolean }) {
  const id = useId();
  const { locale } = useSiteLocale();
  const privacyHref = useLegalHref("privacidad");
  const [pending, setPending] = useState(false);
  const shownAt = useRef(Date.now());
  const [email, setEmail] = useState("");
  const [consent, setConsent] = useState(false);
  const [trap, setTrap] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const tone = TONE[data.tone] ?? TONE.soft;
  const emailId = `${id}-email`;
  const consentId = `${id}-consent`;

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (preview || editing) {
      setError(locale === "de" ? "Vorschau: Es wird nichts gesendet." : locale === "en" ? "Preview: nothing is sent." : "Vista previa: no se envía nada.");
      return;
    }
    if (!EMAIL_RE.test(email.trim())) return setError(newsletterMessage(locale, "invalidEmailMessage", data.invalidEmailMessage));
    if (!consent) return setError(newsletterMessage(locale, "noConsentMessage", data.noConsentMessage));
    setPending(true);
    try {
      const res = await fetch("/api/newsletter/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug: currentSlug(), blockId, email: email.trim(), consent: true, website: trap, elapsedMs: Date.now() - shownAt.current, locale: locale ?? undefined, page: window.location.pathname }),
      });
      const r = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
      if (!res.ok) throw new Error(r.error || "");
      setDone(r.message || newsletterMessage(locale, "successMessage", data.successMessage));
      setEmail("");
      setConsent(false);
    } catch (err) {
      setError((err as Error).message || newsletterMessage(locale, "errorMessage", data.errorMessage));
    } finally {
      setPending(false);
    }
  };

  if (done) {
    return (
      <p role="status" className="rounded-2xl bg-background/90 px-5 py-4 text-base text-foreground shadow-sm">
        {done}
      </p>
    );
  }
  return (
    <form onSubmit={onSubmit} noValidate className="w-full">
      <div aria-hidden className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <label>
          Web
          <input tabIndex={-1} autoComplete="off" value={trap} onChange={(e) => setTrap(e.target.value)} name="website" />
        </label>
      </div>
      <label htmlFor={emailId} className="sr-only">
        {data.emailLabel || "Email"}
      </label>
      <div className="flex flex-col gap-3 sm:flex-row">
        <input
          id={emailId}
          type="email"
          inputMode="email"
          autoComplete="email"
          required
          maxLength={254}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={data.emailPlaceholder || data.emailLabel}
          aria-invalid={!!error || undefined}
          aria-describedby={error ? `${id}-err` : undefined}
          className={cn("h-12 min-w-0 flex-1 rounded-full border px-5 text-base shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring", tone.input)}
        />
        <button type="submit" disabled={pending} className={cn("h-12 shrink-0 rounded-full px-7 text-base font-semibold shadow-sm transition disabled:opacity-60", tone.button)}>
          {data.buttonLabel || "Suscribirme"}
        </button>
      </div>
      <div className="mt-4 flex items-start gap-3">
        <input id={consentId} type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} required className="mt-1 h-4 w-4 shrink-0 rounded border-border accent-[hsl(var(--primary))]" />
        <label htmlFor={consentId} className={cn("text-sm leading-relaxed", tone.muted)}>
          {data.consentText}{" "}
          <a href={privacyHref} className={cn("font-medium underline underline-offset-4", tone.link)} target="_blank" rel="noopener noreferrer">
            {data.privacyLabel || "Privacidad"}
          </a>
        </label>
      </div>
      {error && (
        <p id={`${id}-err`} role="alert" className="mt-3 rounded-xl bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {error}
        </p>
      )}
    </form>
  );
}
