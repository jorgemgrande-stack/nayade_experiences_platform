/**
 * Formulario público de «Solicitar información» de un producto «bajo petición» o «próximamente» (E-6). La solicitud
 * entra en el CRM de la empresa con el producto como origen; no hay compra ni cobro. Con una convocatoria elegida
 * (E-4) se convierte en una solicitud de plaza.
 */
import { useId, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { useSiteLocale } from "@/hooks/useSiteLocale";
import { consentSentence, fillUiText, siteUiText } from "@shared/siteUiText";
import { formatIsoDayShort, plannedEndDay, requestedStartProblem, todayIso } from "@shared/requestDates";

export interface ProductRequestTarget {
  productId: number;
  productTitle: string;
  /** Convocatoria elegida (solicitud de plaza) */
  editionId?: number;
  editionLabel?: string;
  /** Opción/modalidad elegida en la ficha */
  variantId?: number;
  /** Pide también el número de plazas */
  withSeats?: boolean;
  /** Texto del botón de envío (por defecto «Enviar solicitud») */
  submitLabel?: string;
  /**
   * Producto sin convocatoria que admite pedir una fecha de inicio: el periodo es un dato del producto
   * (request_dates_from / request_dates_until). La fecha es una petición; no implica disponibilidad.
   */
  requestDates?: { from: string | null; until: string };
  /** Límites de participantes por compra (de la opción elegida y del producto) */
  minPeople?: number;
  maxPeople?: number;
  /** Suplementos opcionales del producto (alimentación…): se muestran aparte, desmarcados; el servidor fija el importe */
  supplements?: SupplementOffer[];
}

export interface SupplementOffer {
  group: string;
  name: string;
  description: string | null;
  tiers: Array<{ id: number; name: string; priceModifier: string; priceType: "fixed" | "per_person"; minQty: number | null; maxQty: number | null }>;
}

/** Tramo que corresponde a n participantes (el más específico); solo para MOSTRAR: el servidor lo vuelve a decidir. */
function tierFor(o: SupplementOffer, n: number) {
  return [...o.tiers]
    .filter((t) => n >= (t.minQty ?? 1) && (t.maxQty == null || n <= t.maxQty))
    .sort((a, b) => (b.minQty ?? 0) - (a.minQty ?? 0))[0];
}
const money = (v: string) => `${Number(v).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })} €`;

export function ProductRequestDialog({ target, open, onOpenChange, preview }: { target: ProductRequestTarget | null; open: boolean; onOpenChange: (o: boolean) => void; preview?: boolean }) {
  const id = useId();
  const shownAt = useRef(Date.now());
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [message, setMessage] = useState("");
  const [seats, setSeats] = useState("1");
  const [startDate, setStartDate] = useState("");
  const [consent, setConsent] = useState(false);
  const [picked, setPicked] = useState<string[]>([]); // grupos de suplemento marcados: siempre vacío al abrir
  const [trap, setTrap] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [sent, setSent] = useState<string | null>(null);
  const submit = trpc.public.submitLead.useMutation();
  // Textos en el idioma de la página; la solicitud declara ese mismo idioma (el de la URL, no el del navegador)
  const site = useSiteLocale();
  const t = siteUiText(site.locale);

  const close = (o: boolean) => {
    onOpenChange(o);
    if (!o) {
      setSent(null);
      setErrors({});
      setPicked([]);
    } else {
      shownAt.current = Date.now();
      setPicked([]);
    }
  };

  const offers = target?.supplements ?? [];
  const nSeats = Math.max(1, Math.min(50, Math.trunc(Number(seats)) || 1));
  const chosenSupplementIds = offers.filter((o) => picked.includes(o.group)).map((o) => tierFor(o, nSeats)?.id).filter((x): x is number => typeof x === "number");
  const tierLabel = (tr: SupplementOffer["tiers"][number]) =>
    `${money(tr.priceModifier)} ${tr.priceType === "per_person" ? t.supplementPerPerson : ""}`.trim() +
    (tr.maxQty === 1 ? ` (${t.supplementIndividual})` : tr.minQty && tr.minQty > 1 ? ` (${fillUiText(t.supplementFromPeople, { n: tr.minQty })})` : "");

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!target) return;
    const found: Record<string, string> = {};
    if (name.trim().length < 2) found.name = t.nameRequired;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) found.email = t.invalidEmail;
    if (phone.trim() && !/^[+0-9 ().-]{6,25}$/.test(phone.trim())) found.phone = t.invalidPhone;
    if (!consent) found.consent = t.consentRequired;
    if (target.requestDates) {
      const problem = requestedStartProblem(startDate, { from: target.requestDates.from, until: target.requestDates.until, durationDays: null }, Date.now());
      if (problem) {
        found.startDate = problem === "invalid" ? t.requestDateInvalid : problem === "past" ? t.requestDatePast : fillUiText(t.requestDateOutside, { from: target.requestDates.from ? formatIsoDayShort(target.requestDates.from) : formatIsoDayShort(plannedEndDay(todayIso(Date.now()), 2) as string), until: formatIsoDayShort(target.requestDates.until) });
      }
      const n = Math.trunc(Number(seats));
      if (!Number.isInteger(n) || n < (target.minPeople ?? 1) || (target.maxPeople != null && n > target.maxPeople)) {
        found.seats = target.maxPeople != null ? `${t.requestParticipantsLabel}: ${target.minPeople ?? 1}–${target.maxPeople}` : `${t.requestParticipantsLabel}: ≥ ${target.minPeople ?? 1}`;
      }
    }
    setErrors(found);
    const first = Object.keys(found)[0];
    if (first) {
      document.getElementById(`${id}-${first}`)?.focus();
      return;
    }
    if (preview) {
      toast.info(t.previewRequestNotSent);
      return;
    }
    try {
      const r = await submit.mutateAsync({
        name: name.trim(),
        email: email.trim(),
        phone: phone.trim() || undefined,
        message: message.trim() || undefined,
        productRequest: {
          experienceId: target.productId,
          editionId: target.editionId,
          seats: target.withSeats || target.requestDates || offers.length ? Math.max(1, Math.min(50, Math.trunc(Number(seats)) || 1)) : undefined,
          supplementIds: chosenSupplementIds.length ? chosenSupplementIds : undefined,
          startDate: target.requestDates ? startDate : undefined,
          consent,
          website: trap,
          elapsedMs: Date.now() - shownAt.current,
          page: window.location.pathname,
          variantId: target.variantId,
          lang: site.locale.split("-")[0].slice(0, 5).toLowerCase() || undefined,
        },
      });
      setSent((r as { message?: string }).message || t.requestReceived);
    } catch (err) {
      toast.error((err as Error).message || t.requestFailed);
    }
  };

  const err = (k: string) => (errors[k] ? <p id={`${id}-${k}-error`} className="mt-1 text-xs text-destructive">{errors[k]}</p> : null);
  const props = (k: string) => (errors[k] ? { "aria-invalid": true as const, "aria-describedby": `${id}-${k}-error` } : {});

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-heading">{target?.editionId ? t.requestSeat : t.requestInfo}</DialogTitle>
          <DialogDescription>
            {target?.productTitle}
            {target?.editionLabel ? ` · ${target.editionLabel}` : ""}
          </DialogDescription>
        </DialogHeader>
        {sent ? (
          <div className="space-y-4">
            <p role="status" className="rounded-lg bg-primary/10 px-4 py-3 text-foreground">{sent}</p>
            <Button className="w-full" onClick={() => close(false)}>{t.close}</Button>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4" noValidate>
            {/* Campo trampa: invisible para las personas (y para los lectores de pantalla) */}
            <div aria-hidden className="absolute -left-[9999px] h-px w-px overflow-hidden">
              <label>
                Web
                <input tabIndex={-1} autoComplete="off" value={trap} onChange={(e) => setTrap(e.target.value)} name="website" />
              </label>
            </div>
            <div>
              <Label htmlFor={`${id}-name`}>{t.nameLabel}</Label>
              <Input id={`${id}-name`} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" className="mt-1" {...props("name")} />
              {err("name")}
            </div>
            <div>
              <Label htmlFor={`${id}-email`}>{t.emailLabel}</Label>
              <Input id={`${id}-email`} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" className="mt-1" {...props("email")} />
              {err("email")}
            </div>
            <div>
              <Label htmlFor={`${id}-phone`}>{t.phoneLabel}</Label>
              <Input id={`${id}-phone`} type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" className="mt-1" {...props("phone")} />
              {err("phone")}
            </div>
            {target?.requestDates && (
              <>
                <div>
                  <Label htmlFor={`${id}-startDate`}>{t.requestStartDateLabel}</Label>
                  <Input id={`${id}-startDate`} type="date" value={startDate} min={target.requestDates.from && target.requestDates.from > todayIso(Date.now()) ? target.requestDates.from : plannedEndDay(todayIso(Date.now()), 2) ?? undefined} max={target.requestDates.until} onChange={(e) => setStartDate(e.target.value)} className="mt-1 w-48" {...props("startDate")} />
                  {err("startDate")}
                  <p className="mt-1 text-xs text-muted-foreground">{t.requestStartDateHelp}</p>
                </div>
                <div>
                  <Label htmlFor={`${id}-seats`}>{t.requestParticipantsLabel}</Label>
                  <Input id={`${id}-seats`} type="number" inputMode="numeric" min={target.minPeople ?? 1} max={target.maxPeople ?? 50} value={seats} onChange={(e) => setSeats(e.target.value)} className="mt-1 w-28" {...props("seats")} />
                  {err("seats")}
                </div>
              </>
            )}
            {offers.length > 0 && !target?.requestDates && !target?.withSeats && (
              <div>
                <Label htmlFor={`${id}-seats`}>{t.requestParticipantsLabel}</Label>
                <Input id={`${id}-seats`} type="number" inputMode="numeric" min={1} max={50} value={seats} onChange={(e) => setSeats(e.target.value)} className="mt-1 w-28" />
              </div>
            )}
            {offers.map((o) => {
              const cur = tierFor(o, nSeats);
              return (
                <div key={o.group} className="rounded-lg border border-dashed p-3">
                  <label className="flex items-start gap-2 text-sm">
                    <input type="checkbox" checked={picked.includes(o.group)} onChange={(e) => setPicked(e.target.checked ? [...picked, o.group] : picked.filter((g) => g !== o.group))} className="mt-0.5 h-4 w-4" />
                    <span>
                      <span className="font-medium">{t.supplementOptional}: {o.name}</span>
                      {cur && <span className="ml-1 text-muted-foreground">· {tierLabel(cur)}</span>}
                    </span>
                  </label>
                  {o.tiers.length > 1 && <p className="mt-1 pl-6 text-xs text-muted-foreground">{o.tiers.map(tierLabel).join(" · ")}</p>}
                  {o.description && <p className="mt-1 pl-6 text-xs text-muted-foreground">{o.description}</p>}
                  <p className="mt-1 pl-6 text-xs text-muted-foreground">{t.supplementNotIncluded}</p>
                </div>
              );
            })}
            {target?.withSeats && (
              <div>
                <Label htmlFor={`${id}-seats`}>{t.seatsLabel}</Label>
                <Input id={`${id}-seats`} type="number" inputMode="numeric" min={1} max={50} value={seats} onChange={(e) => setSeats(e.target.value)} className="mt-1 w-28" />
              </div>
            )}
            <div>
              <Label htmlFor={`${id}-message`}>{t.messageLabel}</Label>
              <Textarea id={`${id}-message`} value={message} onChange={(e) => setMessage(e.target.value)} rows={3} maxLength={2000} className="mt-1" />
            </div>
            <div>
              <label className="flex items-start gap-2 text-sm text-muted-foreground">
                <input id={`${id}-consent`} type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 h-4 w-4" {...props("consent")} />
                <span>{consentSentence(t)}</span>
              </label>
              {err("consent")}
            </div>
            <Button type="submit" className="w-full" disabled={submit.isPending}>
              {submit.isPending ? t.sending : target?.submitLabel || t.sendRequest}
            </Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
