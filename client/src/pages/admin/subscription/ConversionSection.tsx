/**
 * Contratar desde la prueba gratuita, en tres pasos (plan y ampliaciones → datos de facturación → revisión y
 * confirmación) con el resumen económico siempre a la vista. Solo la administración y solo en prueba: el servidor
 * decide si está disponible (subscription.conversionStatus), calcula el importe (conversionPreview) y abre el pago en
 * Stripe Checkout (conversionStart, idempotente). El plan se activa cuando Stripe confirma el cobro (webhook), nunca al
 * volver del pago; los datos de la prueba se conservan.
 *
 * Capas: la selección y sus reglas son de shared/subscriptionCheckout.ts (puro, con pruebas); la disponibilidad de cada
 * ampliación, la del marketplace (connect.catalog); aquí solo hay presentación y llamadas al servidor.
 * Un borrador (selección y datos de facturación, nunca importes ni aceptaciones) permite ir a una ficha, abandonar el
 * pago o recargar y volver sin perder nada; repetir el envío reutiliza la misma clave de idempotencia.
 */
import { randomId } from "@shared/randomId";
import { applyConversionRequest } from "@shared/connectMarketplace";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "wouter";
import { AlertTriangle, ArrowLeft, ArrowRight, Building2, CalendarDays, Check, CheckCircle2, ChevronDown, Clock, ExternalLink, FileText, Info, Layers, Loader2, Lock, PackageCheck, PackagePlus, Rocket, Sparkles, TrendingUp, type LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { Price, ProductIcon } from "@/components/connect/ConnectParts";
import { fichaPath } from "@/components/connect/LockedFeature";
import { useConnectCatalog, type ConnectCatalogItem } from "@/components/connect/useConnect";
import { formatMoney } from "@shared/connectCard";
import { planPresentation, taxLabel } from "@shared/planPresentation";
import type { PanelPlanInfo } from "@shared/subscriptionPlans";
import {
  CHECKOUT_PLANS,
  CHECKOUT_STEPS,
  EMPTY_BUYER,
  EXTENSION_GROUPS,
  buyerPayload,
  checkoutExtensions,
  draftStorageKey,
  maxReachableStep,
  parseDraft,
  reusableKey,
  selectionSignature,
  validSelection,
  validateBuyer,
  type BuyerDraft,
  type BuyerField,
  type CheckoutDraft,
  type CheckoutExtension,
  type CheckoutInterval,
  type CheckoutPlan,
  type CheckoutStep,
  type ExtensionGroupId,
} from "@shared/subscriptionCheckout";

type Line = { key: string; name: string; quantity: number; amountCents: number; interval: CheckoutInterval; status: string };
type Preview = {
  quote: { ok: boolean; errors: string[]; currency: string; lines: Line[]; totals: { monthlyCents: number; yearlyCents: number } };
  taxNotice: string;
  termsVersion: string | null;
  privacyVersion: string | null;
};

/** Textos legales publicados (bigelephant.es): se abren en otra pestaña; la versión aceptada es la del servidor. */
const LEGAL = { terms: "https://www.bigelephant.es/legal/condiciones", privacy: "https://www.bigelephant.es/legal/privacidad" };
const PLAN_ICON: Record<CheckoutPlan, LucideIcon> = { essential: Rocket, business: TrendingUp };
const GROUP_ICON: Record<ExtensionGroupId, LucideIcon> = { available: CheckCircle2, on_request: Clock, coming_soon: CalendarDays, contracted: PackageCheck, not_included: Lock };
const GROUP_TONE: Record<ExtensionGroupId, string> = { available: "emerald", on_request: "amber", coming_soon: "electric", contracted: "turquoise", not_included: "night" };
const reduceMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
const scrollIntoView = (id: string) => requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ behavior: reduceMotion() ? "auto" : "smooth", block: "start" }));
const per = (i: CheckoutInterval) => (i === "year" ? "año" : "mes");

// ── Borrador en el navegador (con try/catch: el almacenamiento puede no estar disponible) ──
function readDraft(key: string | null): CheckoutDraft | null {
  if (!key) return null;
  try {
    return parseDraft(window.sessionStorage.getItem(key), Date.now());
  } catch {
    return null;
  }
}
function writeDraft(key: string, d: Omit<CheckoutDraft, "savedAt"> | null) {
  try {
    if (d) window.sessionStorage.setItem(key, JSON.stringify({ ...d, savedAt: Date.now() }));
    else window.sessionStorage.removeItem(key);
  } catch {
    // sin almacenamiento: la selección vive solo en esta pantalla
  }
}

export interface ConversionRequest {
  plan: CheckoutPlan;
  modules?: string[];
  at: number;
}

/**
 * `requested`: plan elegido desde el comparador o, desde el marketplace («Contratar ahora»), plan y módulos (cada
 * elección nueva lleva otro `at`). `currentPlan`: plan de la prueba. `plans`: planes publicados (nombres y precios).
 */
export function ConversionSection({ requested, currentPlan = null, plans = [] }: { requested?: ConversionRequest | null; currentPlan?: string | null; plans?: PanelPlanInfo[] } = {}) {
  const status = trpc.subscription.conversionStatus.useQuery(undefined, { retry: false, staleTime: 60_000 });
  const enabled = !!status.data?.enabled;
  if (!status.data) return null;
  if (!enabled) {
    return (
      <section id="contratar" className="scroll-mt-4 rounded-3xl border border-border bg-card p-6" aria-labelledby="sub-convert">
        <h2 id="sub-convert" className="text-xl font-extrabold tracking-tight text-foreground">
          Contratar
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          La contratación en línea desde el panel todavía no está disponible. Envíanos una solicitud desde el plan que te interese y te ayudamos a contratarlo sin perder nada de lo que has preparado.
        </p>
      </section>
    );
  }
  return <Checkout requested={requested ?? null} currentPlan={currentPlan} plans={plans} />;
}

function Checkout({ requested, currentPlan, plans }: { requested: ConversionRequest | null; currentPlan: string | null; plans: PanelPlanInfo[] }) {
  const { user } = useAuth();
  const uid = (user as { id?: number } | null)?.id;
  // Sin la persona identificada no se lee ni se escribe ningún borrador (nunca el de otra persona)
  const storageKey = uid ? draftStorageKey(uid) : null;
  const catalog = useConnectCatalog();
  const initial = useMemo(() => readDraft(storageKey), [storageKey]);
  const defaultPlan: CheckoutPlan = (CHECKOUT_PLANS as readonly string[]).includes(currentPlan ?? "") ? (currentPlan as CheckoutPlan) : "essential";
  /** ¿Hay algo elegido o escrito? Solo entonces se guarda el borrador y se avisa de que se ha recuperado. */
  const meaningful = (d: { plan: CheckoutPlan; interval: CheckoutInterval; add: string[]; buyer: BuyerDraft; step: CheckoutStep }) =>
    d.plan !== defaultPlan || d.interval !== "month" || d.add.length > 0 || d.step > 1 || (Object.keys(EMPTY_BUYER) as BuyerField[]).some((k) => d.buyer[k].trim() !== EMPTY_BUYER[k]);
  const [plan, setPlan] = useState<CheckoutPlan>(initial?.plan ?? defaultPlan);
  const [interval, setBilling] = useState<CheckoutInterval>(initial?.interval ?? "month");
  const [add, setAdd] = useState<string[]>(initial?.add ?? []);
  const [buyer, setBuyer] = useState<BuyerDraft>(initial?.buyer ?? EMPTY_BUYER);
  const [step, setStep] = useState<CheckoutStep>(initial?.step ?? 1);
  const [touched, setTouched] = useState<Partial<Record<BuyerField, boolean>>>({});
  const [accepted, setAccepted] = useState({ terms: false, privacy: false });
  const [notes, setNotes] = useState<string[]>(initial && meaningful(initial) ? ["Hemos recuperado la selección que dejaste a medias."] : []);
  const [legalNotice, setLegalNotice] = useState<string | null>(null);

  const extensions = useMemo(() => checkoutExtensions(catalog.items as ConnectCatalogItem[], plan), [catalog.items, plan]);
  // Al cambiar de plan (o al llegar el catálogo) se quita lo que ya no se puede añadir con él
  useEffect(() => {
    // Sin catálogo no se puede comprobar ninguna ampliación: no se envía ninguna (se añaden después)
    if (catalog.isError) {
      setAdd((a) => (a.length ? [] : a));
      return;
    }
    if (!catalog.data) return;
    setAdd((a) => {
      const v = validSelection(a, extensions);
      return v.length === a.length ? a : v;
    });
  }, [catalog.data, catalog.isError, extensions]);

  // Elección desde el comparador o desde el marketplace: se aplica una vez por elección y SUMA a lo ya elegido
  const applied = useRef<number | null>(null);
  useEffect(() => {
    if (!requested || applied.current === requested.at) return;
    if (requested.modules?.length && !catalog.data && !catalog.isError) return;
    applied.current = requested.at;
    setPlan(requested.plan);
    setStep(1);
    if (requested.modules?.length && catalog.isError) {
      setNotes(["No hemos podido comprobar los módulos elegidos ahora mismo: contrata el plan y añádelos después desde su ficha."]);
    } else if (requested.modules?.length) {
      const offered = checkoutExtensions(catalog.items as ConnectCatalogItem[], requested.plan)
        .filter((e) => e.selectable)
        .map((e) => ({ key: e.item.key, name: e.item.name }));
      const r = applyConversionRequest(requested, { offered, currentPlan });
      setAdd((a) => Array.from(new Set([...a, ...r.add])));
      setNotes(r.notes);
    } else setNotes([]);
    scrollIntoView("contratar");
  }, [requested, catalog.data, catalog.isError, catalog.items, currentPlan]);

  // Importe: siempre del servidor; solo vale la respuesta de la última selección
  const sig = selectionSignature({ plan, interval, add });
  const preview = trpc.subscription.conversionPreview.useMutation();
  const [quote, setQuote] = useState<{ sig: string; data: Preview } | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const lastSig = useRef(sig);
  const requestPreview = useCallback(() => {
    const s = selectionSignature({ plan, interval, add });
    lastSig.current = s;
    setQuoteError(null);
    preview
      .mutateAsync({ plan, interval, ...(add.length ? { add } : {}) })
      .then((d) => {
        if (lastSig.current === s) setQuote({ sig: s, data: d as Preview });
      })
      .catch((e: { message?: string }) => {
        if (lastSig.current === s) setQuoteError(e?.message ?? "No se ha podido calcular el importe");
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan, interval, add.join(",")]);
  useEffect(() => {
    requestPreview();
  }, [requestPreview]);
  const p = quote?.sig === sig ? quote.data : null;
  const calculating = !p && !quoteError;

  // Clave de idempotencia de lo que se envía (selección y datos fiscales): la del borrador si es lo mismo y su enlace
  // de pago no ha caducado; cualquier cambio en lo enviado lleva otra clave (nunca la misma clave con otro cuerpo)
  const keySig = selectionSignature({ plan, interval, add, buyer });
  const idem = useRef<{ key: string; sig: string; payExpiresAt: number | null } | null>(null);
  if (idem.current === null) {
    const reused = reusableKey(initial, keySig, Date.now());
    idem.current = { key: reused ?? randomId(), sig: keySig, payExpiresAt: reused ? (initial?.payExpiresAt ?? null) : null };
  }
  if (idem.current.sig !== keySig) idem.current = { key: randomId(), sig: keySig, payExpiresAt: null };

  const [payOpenedAt, setPayOpenedAt] = useState(0);
  useEffect(() => {
    if (!storageKey || !idem.current) return;
    const d = { plan, interval, add, buyer, step };
    writeDraft(storageKey, meaningful(d) ? { ...d, key: idem.current.key, keyFor: idem.current.sig, payExpiresAt: idem.current.payExpiresAt } : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey, plan, interval, add, buyer, step, payOpenedAt]);

  const errors = validateBuyer(buyer);
  const buyerValid = Object.keys(errors).length === 0;
  const quoteOk = !!p?.quote.ok;
  const reach = maxReachableStep({ quoteOk, buyerValid });
  const go = (s: CheckoutStep) => {
    if (s === 2 && !quoteOk) return;
    if (s === 3 && !buyerValid) {
      setTouched({ legalName: true, taxId: true, line1: true, postalCode: true, city: true, country: true });
      setStep(2);
      requestAnimationFrame(() => document.querySelector<HTMLElement>("#contratar [aria-invalid='true']")?.focus());
      return;
    }
    setStep(s);
    scrollIntoView("contratar");
    // El botón pulsado desaparece con el paso: el foco pasa al título del paso nuevo
    requestAnimationFrame(() => document.getElementById("sx-step-actual")?.focus({ preventScroll: true }));
  };

  const sending = useRef(false);
  const [redirecting, setRedirecting] = useState(false);
  // Vuelta con «Atrás» desde el pago (página restaurada de la caché del navegador): el botón vuelve a estar disponible
  useEffect(() => {
    const onShow = (e: PageTransitionEvent) => {
      if (!e.persisted) return;
      sending.current = false;
      setRedirecting(false);
    };
    window.addEventListener("pageshow", onShow);
    return () => window.removeEventListener("pageshow", onShow);
  }, []);
  const start = trpc.subscription.conversionStart.useMutation({
    onSuccess: (r) => {
      // Se guarda la caducidad del enlace: pasado ese momento, un nuevo intento usa otra clave
      if (idem.current) idem.current = { ...idem.current, payExpiresAt: typeof r.expiresAt === "number" ? r.expiresAt : null };
      setPayOpenedAt(Date.now());
      setRedirecting(true);
      window.location.assign(r.url);
    },
    onError: (e) => {
      sending.current = false;
      // Condiciones o textos actualizados durante un despliegue: se piden de nuevo, se vuelven a aceptar y con otra clave
      if (e.data?.code === "CONFLICT" && /condiciones|textos vigentes/i.test(e.message)) {
        idem.current = { key: randomId(), sig: keySig, payExpiresAt: null };
        setAccepted({ terms: false, privacy: false });
        setLegalNotice(e.message);
        requestPreview();
        return;
      }
      toast.error(e.message);
    },
  });
  const canConfirm = quoteOk && buyerValid && !!p?.termsVersion && accepted.terms && accepted.privacy && !start.isPending && !redirecting;
  const confirm = () => {
    if (!canConfirm || !p || sending.current) return;
    sending.current = true;
    start.mutate({
      idempotencyKey: idem.current!.key,
      plan,
      interval,
      ...(add.length ? { add } : {}),
      buyer: buyerPayload(buyer),
      consents: { terms: true, privacy: true, termsVersion: p.termsVersion!, ...(p.privacyVersion ? { privacyVersion: p.privacyVersion } : {}) },
    });
  };

  const planInfo = (k: CheckoutPlan) => plans.find((x) => x.key === k) ?? null;
  const planName = planInfo(plan)?.name ?? (plan === "business" ? "Business" : "Essential");
  // Nombres de lo que se envía (del catálogo o, si no ha llegado, de las líneas del importe del servidor)
  const addNames = add.map((k) => extensions.find((e) => e.item.key === k)?.item.name ?? p?.quote.lines.find((l) => l.key === k)?.name ?? k);

  return (
    <section id="contratar" className="cx-shadow scroll-mt-4 space-y-6 rounded-3xl border border-border bg-card p-4 sm:p-6 lg:p-8" aria-labelledby="sub-convert">
      <div className="flex flex-wrap items-start gap-3">
        <span aria-hidden="true" data-tone="electric" className="cx-tone-chip inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl shadow-lg shadow-black/20">
          <Sparkles className="h-6 w-6" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id="sub-convert" className="text-2xl font-extrabold tracking-tight text-foreground sm:text-3xl">
            Contratar tu plan
          </h2>
          <p className="text-sm text-muted-foreground sm:text-base">Elige plan, periodicidad y ampliaciones. Todo lo que has preparado durante la prueba se conserva.</p>
        </div>
      </div>

      <Stepper step={step} reach={reach} onGo={go} />

      {notes.length > 0 && (
        <div role="status" className="flex gap-2 rounded-2xl border border-border bg-muted/50 p-3 text-sm text-foreground">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-info" aria-hidden="true" />
          <div className="space-y-1">
            {notes.map((n) => (
              <p key={n}>{n}</p>
            ))}
          </div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] xl:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="min-w-0 space-y-6">
          <h3 id="sx-step-actual" tabIndex={-1} className="sr-only">
            Paso {step} de 3: {CHECKOUT_STEPS[step - 1].title}
          </h3>
          {step === 1 && (
            <>
              <Panel icon={<Layers className="h-5 w-5" />} title="Plan seleccionado" intro="Elige el plan con el que quieres seguir.">
                <div role="radiogroup" aria-label="Plan" className="grid gap-3 sm:grid-cols-2">
                  {CHECKOUT_PLANS.map((k) => {
                    const info = planInfo(k);
                    const pr = planPresentation({ key: k, tagline: info?.tagline ?? null });
                    const Icon = PLAN_ICON[k];
                    const price = interval === "year" ? info?.yearly : info?.monthly;
                    const sel = plan === k;
                    return (
                      <label key={k} data-tone={pr.tone} data-selected={sel} className="sx-option relative flex cursor-pointer items-start gap-3 rounded-2xl p-4">
                        <input type="radio" name="sx-plan" value={k} checked={sel} onChange={() => setPlan(k)} className="sr-only" />
                        <span aria-hidden="true" className="cx-tone-chip inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl">
                          <Icon className="h-5 w-5" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-2">
                            <span className="text-lg font-extrabold text-foreground">{info?.name ?? k}</span>
                            {sel && (
                              <span className="sx-tone-tag inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold">
                                <Check className="h-3 w-3" aria-hidden="true" /> Seleccionado
                              </span>
                            )}
                            {k === currentPlan && <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">Tu prueba</span>}
                          </span>
                          {pr.audience && <span className="block text-sm text-muted-foreground">{pr.audience}</span>}
                          {price ? (
                            <span className="mt-1 block text-sm text-foreground">
                              <strong className="text-base font-bold">{formatMoney(price.amountCents, price.currency)}</strong> /{per(interval)} {taxLabel(price)}
                            </span>
                          ) : (
                            <span className="mt-1 block text-sm text-muted-foreground">Precio en el resumen</span>
                          )}
                        </span>
                      </label>
                    );
                  })}
                </div>
                <p className="mt-3 flex items-start gap-1.5 text-xs text-muted-foreground">
                  <Building2 className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span>
                    Enterprise se contrata con nuestro equipo comercial:{" "}
                    <a href="#planes" className="font-medium text-foreground underline underline-offset-4">
                      solicítalo desde su plan
                    </a>
                    .
                  </span>
                </p>
              </Panel>

              <Panel icon={<CalendarDays className="h-5 w-5" />} title="Periodicidad" intro="Cómo quieres que se facture tu plan.">
                <div role="radiogroup" aria-label="Periodicidad" className="grid grid-cols-2 gap-3">
                  {(["month", "year"] as const).map((i) => {
                    const info = planInfo(plan);
                    const price = i === "year" ? info?.yearly : info?.monthly;
                    const sel = interval === i;
                    return (
                      <label key={i} data-tone="violet" data-selected={sel} className="sx-option flex cursor-pointer items-center gap-3 rounded-2xl p-4">
                        <input type="radio" name="sx-interval" value={i} checked={sel} onChange={() => setBilling(i)} className="sr-only" />
                        <span aria-hidden="true" className={cn("inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2", sel ? "border-[color:var(--tone)]" : "border-border")}>
                          {sel && <span className="cx-tone-chip h-2.5 w-2.5 rounded-full" />}
                        </span>
                        <span className="min-w-0">
                          <span className="block font-semibold text-foreground">{i === "year" ? "Anual" : "Mensual"}</span>
                          {price && (
                            <span className="block text-xs text-muted-foreground">
                              {formatMoney(price.amountCents, price.currency)} /{per(i)} {taxLabel(price)}
                            </span>
                          )}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </Panel>

              <Extensions extensions={extensions} loading={catalog.isLoading} error={catalog.isError} selected={add} onToggle={(k, on) => setAdd((a) => (on ? Array.from(new Set([...a, k])) : a.filter((x) => x !== k)))} onPlan={setPlan} />

              <StepNav next={{ label: "Continuar con los datos de facturación", disabled: !quoteOk, onClick: () => go(2) }} hint={!quoteOk && !calculating ? "Revisa la selección: el importe no es válido." : null} />
            </>
          )}

          {step === 2 && (
            <>
              <Panel icon={<Building2 className="h-5 w-5" />} title="Datos de facturación" intro="Empresa o profesional. Se usan para la factura y para calcular los impuestos en el pago.">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field id="legalName" label="Razón social o nombre fiscal" value={buyer.legalName} error={touched.legalName ? errors.legalName : undefined} autoComplete="organization" maxLength={160} onChange={(v) => setBuyer((b) => ({ ...b, legalName: v }))} onBlur={() => setTouched((t) => ({ ...t, legalName: true }))} />
                  <Field id="taxId" label="NIF / CIF u otro identificador fiscal" value={buyer.taxId} error={touched.taxId ? errors.taxId : undefined} maxLength={40} onChange={(v) => setBuyer((b) => ({ ...b, taxId: v }))} onBlur={() => setTouched((t) => ({ ...t, taxId: true }))} />
                  <div className="sm:col-span-2">
                    <Field id="line1" label="Dirección fiscal" value={buyer.line1} error={touched.line1 ? errors.line1 : undefined} autoComplete="address-line1" maxLength={200} onChange={(v) => setBuyer((b) => ({ ...b, line1: v }))} onBlur={() => setTouched((t) => ({ ...t, line1: true }))} />
                  </div>
                  <Field id="postalCode" label="Código postal" value={buyer.postalCode} error={touched.postalCode ? errors.postalCode : undefined} autoComplete="postal-code" maxLength={12} onChange={(v) => setBuyer((b) => ({ ...b, postalCode: v }))} onBlur={() => setTouched((t) => ({ ...t, postalCode: true }))} />
                  <Field id="city" label="Ciudad" value={buyer.city} error={touched.city ? errors.city : undefined} autoComplete="address-level2" maxLength={120} onChange={(v) => setBuyer((b) => ({ ...b, city: v }))} onBlur={() => setTouched((t) => ({ ...t, city: true }))} />
                  <Field
                    id="country"
                    label="País (código de 2 letras, p. ej. ES)"
                    value={buyer.country}
                    error={touched.country ? errors.country : undefined}
                    autoComplete="country"
                    maxLength={2}
                    onChange={(v) => setBuyer((b) => ({ ...b, country: v.toUpperCase() }))}
                    onBlur={() => setTouched((t) => ({ ...t, country: true }))}
                  />
                </div>
                <p className="mt-3 text-xs text-muted-foreground">Los campos son obligatorios. El servidor vuelve a comprobarlos antes de abrir el pago.</p>
              </Panel>
              <StepNav back={{ label: "Volver al plan", onClick: () => go(1) }} next={{ label: "Revisar y confirmar", onClick: () => go(3) }} />
            </>
          )}

          {step === 3 && p && (
            <>
              <Panel icon={<FileText className="h-5 w-5" />} title="Revisión" intro="Comprueba tu selección antes de ir al pago seguro.">
                <dl className="grid gap-3 text-sm sm:grid-cols-2">
                  <Review label="Plan" value={`${planName} · ${interval === "year" ? "anual" : "mensual"}`} onEdit={() => go(1)} />
                  <Review label="Ampliaciones" value={addNames.length > 0 ? addNames.join(", ") : "Sin ampliaciones"} onEdit={() => go(1)} />
                  <Review label="Facturación a" value={`${buyer.legalName.trim()} · ${buyer.taxId.trim()}`} onEdit={() => go(2)} />
                  <Review label="Domicilio fiscal" value={`${buyer.line1.trim()}, ${buyer.postalCode.trim()} ${buyer.city.trim()} (${buyer.country.trim().toUpperCase()})`} onEdit={() => go(2)} />
                </dl>
              </Panel>

              <Panel icon={<Lock className="h-5 w-5" />} title="Condiciones y confirmación">
                <div className="space-y-3">
                  {legalNotice && (
                    <p role="alert" className="flex gap-2 rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm text-foreground">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" /> {legalNotice}
                    </p>
                  )}
                  <div className="flex items-start gap-3 text-sm">
                    <Checkbox id="conv-terms" checked={accepted.terms} disabled={!p.termsVersion} onCheckedChange={(v) => setAccepted((a) => ({ ...a, terms: v === true }))} className="mt-0.5" />
                    <Label htmlFor="conv-terms" className="block font-normal leading-snug">
                      Acepto las{" "}
                      <a href={LEGAL.terms} target="_blank" rel="noopener noreferrer" className="font-medium text-foreground underline underline-offset-4">
                        condiciones de contratación de Elephant Source
                        <span className="sr-only"> (se abre en otra pestaña)</span>
                      </a>
                      {p.termsVersion ? ` (versión ${p.termsVersion})` : ""}.
                    </Label>
                  </div>
                  <div className="flex items-start gap-3 text-sm">
                    <Checkbox id="conv-privacy" checked={accepted.privacy} onCheckedChange={(v) => setAccepted((a) => ({ ...a, privacy: v === true }))} className="mt-0.5" />
                    <Label htmlFor="conv-privacy" className="block font-normal leading-snug">
                      He leído la{" "}
                      <a href={LEGAL.privacy} target="_blank" rel="noopener noreferrer" className="font-medium text-foreground underline underline-offset-4">
                        política de privacidad
                        <span className="sr-only"> (se abre en otra pestaña)</span>
                      </a>
                      {p.privacyVersion ? ` (versión ${p.privacyVersion})` : ""}.
                    </Label>
                  </div>
                  {!p.termsVersion && <p className="text-sm text-danger">Las condiciones de contratación no están publicadas ahora mismo: no se puede contratar en línea.</p>}
                </div>
              </Panel>

              {/* En el móvil, el resumen va justo antes de la confirmación (en escritorio está a la derecha) */}
              <div className="lg:hidden">
                <Summary id="sx-summary-main" p={p} planName={planName} interval={interval} calculating={calculating} error={quoteError} />
              </div>

              <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
                <Button type="button" variant="outline" className="h-12 w-full rounded-xl px-5 sm:w-auto" onClick={() => go(2)}>
                  <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Volver y editar
                </Button>
                <Button type="button" className="cx-cta h-auto min-h-12 w-full whitespace-normal rounded-xl px-6 py-3 text-base font-semibold hover:bg-transparent sm:w-auto" disabled={!canConfirm} onClick={confirm}>
                  {start.isPending || redirecting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Lock className="h-4 w-4" aria-hidden="true" />}
                  {redirecting ? "Abriendo el pago seguro…" : start.isPending ? "Preparando el pago…" : "Confirmar y continuar al pago"}
                </Button>
              </div>
              {start.error?.data?.code === "CONFLICT" && /pago abierto|contratación en curso/.test(start.error.message) && (
                <p className="text-sm text-danger" role="alert">
                  Tienes un pago pendiente. {start.error.message}
                </p>
              )}
              <p className="text-xs text-muted-foreground">El pago se hace en Stripe. Tu plan se activa en cuanto Stripe confirma el cobro; si cierras la ventana antes, no se cobra nada y tu selección te espera aquí.</p>
            </>
          )}
          {step === 3 && !p && (
            <div className="lg:hidden">
              <Summary id="sx-summary-main" p={null} planName={planName} interval={interval} calculating={calculating} error={quoteError} />
            </div>
          )}
        </div>

        <aside className={cn("min-w-0", step === 3 ? "hidden lg:block" : "")} aria-label="Resumen de la contratación">
          <div className="lg:sticky lg:top-4">
            <Summary id="sx-summary-aside" p={p} planName={planName} interval={interval} calculating={calculating} error={quoteError} />
          </div>
        </aside>
      </div>
    </section>
  );
}

function Stepper({ step, reach, onGo }: { step: CheckoutStep; reach: CheckoutStep; onGo: (s: CheckoutStep) => void }) {
  return (
    <nav aria-label="Pasos de la contratación">
      <ol className="flex items-center gap-2 sm:gap-3">
        {CHECKOUT_STEPS.map((s, i) => {
          const state = s.step === step ? "current" : s.step < step ? "done" : "todo";
          const can = s.step <= reach && s.step !== step;
          return (
            <li key={s.step} className={cn("flex min-w-0 items-center gap-2 sm:flex-1 sm:gap-3", state === "current" ? "flex-1" : "flex-none")}>
              <button
                type="button"
                data-state={state}
                disabled={!can}
                onClick={() => onGo(s.step)}
                aria-current={state === "current" ? "step" : undefined}
                className="sx-step flex min-w-0 items-center gap-2 rounded-full pr-2 text-left disabled:cursor-default"
              >
                <span className="sx-step-dot inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold">{state === "done" ? <Check className="h-4 w-4" aria-hidden="true" /> : s.step}</span>
                {/* En el móvil solo se lee el paso actual; el resto, con su número (y su nombre para lectores de pantalla) */}
                <span className={cn("min-w-0 text-sm", state === "current" ? "font-semibold text-foreground" : "sr-only text-muted-foreground sm:not-sr-only")}>
                  {s.title}
                  {state === "done" && <span className="sr-only"> (completado)</span>}
                </span>
              </button>
              {i < CHECKOUT_STEPS.length - 1 && <span aria-hidden="true" data-done={s.step < step} className="sx-step-line h-0.5 min-w-3 flex-1 rounded-full" />}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function Panel({ icon, title, intro, children }: { icon: ReactNode; title: string; intro?: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-border bg-background/40 p-4 sm:p-5">
      <div className="mb-4 flex items-start gap-3">
        <span aria-hidden="true" className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted text-foreground">
          {icon}
        </span>
        <div className="min-w-0">
          <h3 className="text-lg font-bold text-foreground">{title}</h3>
          {intro && <p className="text-sm text-muted-foreground">{intro}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

function Field({
  id,
  label,
  value,
  error,
  onChange,
  onBlur,
  autoComplete,
  maxLength,
  inputMode,
}: {
  id: BuyerField;
  label: string;
  value: string;
  error?: string;
  onChange: (v: string) => void;
  onBlur: () => void;
  autoComplete?: string;
  maxLength?: number;
  inputMode?: "numeric" | "text";
}) {
  const errId = `conv-${id}-error`;
  return (
    <div className="space-y-1.5">
      <Label htmlFor={`conv-${id}`}>
        {label} <span aria-hidden="true" className="cx-red-text">*</span>
      </Label>
      <Input
        id={`conv-${id}`}
        value={value}
        required
        maxLength={maxLength}
        autoComplete={autoComplete}
        inputMode={inputMode}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errId : undefined}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        className="h-11 rounded-xl"
      />
      {error && (
        <p id={errId} className="text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

function Review({ label, value, onEdit }: { label: string; value: string; onEdit: () => void }) {
  return (
    <div className="min-w-0 rounded-xl border border-border bg-card px-3 py-2.5">
      <dt className="flex items-center justify-between gap-2 text-xs uppercase tracking-wider text-muted-foreground">
        {label}
        <button type="button" onClick={onEdit} className="text-xs font-medium normal-case tracking-normal text-foreground underline underline-offset-4">
          Editar<span className="sr-only"> {label.toLowerCase()}</span>
        </button>
      </dt>
      <dd className="mt-1 break-words font-medium text-foreground">{value}</dd>
    </div>
  );
}

function StepNav({ back, next, hint }: { back?: { label: string; onClick: () => void }; next: { label: string; onClick: () => void; disabled?: boolean }; hint?: string | null }) {
  return (
    <div className="space-y-2">
      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
        {back ? (
          <Button type="button" variant="outline" className="h-12 w-full rounded-xl px-5 sm:w-auto" onClick={back.onClick}>
            <ArrowLeft className="h-4 w-4" aria-hidden="true" /> {back.label}
          </Button>
        ) : (
          <span />
        )}
        <Button type="button" className="cx-cta h-auto min-h-12 w-full whitespace-normal rounded-xl px-6 py-3 text-base font-semibold hover:bg-transparent sm:w-auto" disabled={next.disabled} onClick={next.onClick}>
          {next.label} <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
      {hint && <p className="text-right text-sm text-danger">{hint}</p>}
    </div>
  );
}

/** Ampliaciones con la disponibilidad real (la del marketplace), agrupadas como en /admin/ampliar. */
function Extensions({
  extensions,
  loading,
  error,
  selected,
  onToggle,
  onPlan,
}: {
  extensions: CheckoutExtension<ConnectCatalogItem>[];
  loading: boolean;
  error: boolean;
  selected: string[];
  onToggle: (key: string, on: boolean) => void;
  onPlan: (p: CheckoutPlan) => void;
}) {
  return (
    <Panel icon={<PackagePlus className="h-5 w-5" />} title="Módulos adicionales" intro="Las ampliaciones del marketplace, con su disponibilidad real para tu empresa.">
      {loading && <p className="text-sm text-muted-foreground">Cargando las ampliaciones…</p>}
      {error && <p className="text-sm text-muted-foreground">No se han podido cargar las ampliaciones ahora mismo. Puedes contratar el plan y añadirlas después.</p>}
      {!loading && !error && extensions.length === 0 && <p className="text-sm text-muted-foreground">No hay ampliaciones publicadas para tu empresa.</p>}
      <div className="space-y-3">
        {EXTENSION_GROUPS.map((g) => {
          const list = extensions.filter((e) => e.group === g.id);
          if (list.length === 0) return null;
          const GIcon = GROUP_ICON[g.id];
          const count = list.length === 1 ? "1 opción" : `${list.length} opciones`;
          const picked = list.filter((e) => selected.includes(e.item.key)).length;
          return (
            <details key={g.id} className="sx-details overflow-hidden rounded-2xl border border-border bg-card" open={g.id === "available" || picked > 0}>
              <summary className="flex items-center gap-3 px-4 py-3">
                <span aria-hidden="true" data-tone={GROUP_TONE[g.id]} className="cx-tone-chip inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl">
                  <GIcon className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold text-foreground">{g.title}</span>
                  <span className="hidden text-xs text-muted-foreground sm:block">{g.intro}</span>
                  <span className="block text-xs text-muted-foreground sm:hidden">
                    {picked > 0 ? `${picked} elegida${picked > 1 ? "s" : ""} · ` : ""}
                    {count}
                  </span>
                </span>
                <span className="hidden shrink-0 text-right text-xs text-muted-foreground sm:inline">
                  {picked > 0 ? `${picked} elegida${picked > 1 ? "s" : ""} · ` : ""}
                  {count}
                </span>
                <ChevronDown className="sx-chevron h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              </summary>
              <ul className="divide-y divide-border border-t border-border">
                {list.map((e) => (
                  <ExtensionRow key={e.item.key} e={e} checked={selected.includes(e.item.key)} onToggle={onToggle} onPlan={onPlan} />
                ))}
              </ul>
            </details>
          );
        })}
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        ¿Buscas otra cosa?{" "}
        <Link href="/admin/ampliar" className="font-medium text-foreground underline underline-offset-4">
          Explora el marketplace
        </Link>{" "}
        y vuelve: tu selección se conserva.
      </p>
    </Panel>
  );
}

function ExtensionRow({ e, checked, onToggle, onPlan }: { e: CheckoutExtension<ConnectCatalogItem>; checked: boolean; onToggle: (key: string, on: boolean) => void; onPlan: (p: CheckoutPlan) => void }) {
  const id = `conv-mod-${e.item.key}`;
  return (
    <li data-selected={checked} className={cn("flex flex-wrap items-start gap-3 px-4 py-3", checked && "bg-muted/40")}>
      {e.selectable ? (
        <Checkbox id={id} checked={checked} onCheckedChange={(v) => onToggle(e.item.key, v === true)} className="mt-2.5" />
      ) : (
        <span aria-hidden="true" className="mt-2.5 inline-block h-4 w-4 shrink-0" />
      )}
      <ProductIcon item={e.item} size="sm" />
      <div className="min-w-0 flex-1 basis-40">
        {e.selectable ? (
          <Label htmlFor={id} className="block cursor-pointer break-words font-semibold leading-snug text-foreground">
            {e.item.name}
          </Label>
        ) : (
          <p className="break-words font-semibold leading-snug text-foreground">{e.item.name}</p>
        )}
        {e.item.tagline && <p className="text-xs text-muted-foreground">{e.item.tagline}</p>}
        {e.note && <p className="mt-1 text-xs text-foreground">{e.note}</p>}
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          <Link href={fichaPath(e.item.key)} className="inline-flex items-center gap-1 font-medium text-foreground underline underline-offset-4">
            {e.group === "on_request" ? "Ver ficha y solicitar" : "Ver ficha"} <ExternalLink className="h-3 w-3" aria-hidden="true" />
          </Link>
          {e.needsPlan && (
            <button type="button" onClick={() => onPlan(e.needsPlan!)} className="font-medium text-foreground underline underline-offset-4">
              Elegir el plan {e.needsPlan === "business" ? "Business" : "Essential"}
            </button>
          )}
        </div>
      </div>
      {e.group !== "contracted" && e.group !== "coming_soon" && <Price item={e.item} className="basis-full pl-[4.25rem] sm:basis-auto sm:shrink-0 sm:pl-0 sm:text-right" />}
    </li>
  );
}

/** Resumen económico: importes del servidor; los impuestos solo se dan por definitivos en el pago (Stripe Tax). */
function Summary({ id, p, planName, interval, calculating, error }: { id: string; p: Preview | null; planName: string; interval: CheckoutInterval; calculating: boolean; error: string | null }) {
  const cur = p?.quote.currency ?? "EUR";
  return (
    <section className="cx-glow overflow-hidden rounded-2xl border border-border bg-card" aria-labelledby={id} aria-live="polite">
      <div className="border-b border-border px-4 py-3 sm:px-5">
        <h3 id={id} className="text-lg font-bold text-foreground">
          Resumen de tu contratación
        </h3>
        <p className="text-xs text-muted-foreground">
          {planName} · facturación {interval === "year" ? "anual" : "mensual"}
        </p>
      </div>
      <div className="space-y-3 px-4 py-4 sm:px-5">
        {calculating && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Calculando el importe…
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        {p && (
          <>
            {!p.quote.ok && (
              <p role="alert" className="text-sm text-danger">
                {p.quote.errors[0] ?? "Revisa la selección"}
              </p>
            )}
            <table className="w-full text-sm">
              <caption className="sr-only">Detalle del importe</caption>
              <tbody>
                {p.quote.lines.map((l) => (
                  <tr key={l.key} className="border-b border-border last:border-0">
                    <th scope="row" className="py-2 pr-3 text-left font-normal text-foreground">
                      {l.name}
                      {l.quantity > 1 ? ` × ${l.quantity}` : ""}
                    </th>
                    <td className="whitespace-nowrap py-2 text-right text-foreground">
                      {formatMoney(l.amountCents, cur)} /{per(l.interval)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <dl className="space-y-1.5 rounded-xl bg-muted/50 p-3 text-sm">
              {p.quote.totals.monthlyCents > 0 && (
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Base imponible mensual</dt>
                  <dd className="font-semibold text-foreground">{formatMoney(p.quote.totals.monthlyCents, cur)}</dd>
                </div>
              )}
              {p.quote.totals.yearlyCents > 0 && (
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Base imponible anual</dt>
                  <dd className="font-semibold text-foreground">{formatMoney(p.quote.totals.yearlyCents, cur)}</dd>
                </div>
              )}
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Impuestos (IVA)</dt>
                <dd className="text-right text-foreground">Se calculan en el pago</dd>
              </div>
            </dl>
            <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>
                Importe provisional sin impuestos. {p.taxNotice} El total con impuestos se muestra en la página de pago antes de pagar.
              </span>
            </p>
            <p className="text-xs text-muted-foreground">
              La suscripción se renueva automáticamente cada {per(interval)}. Podrás cambiar de plan o cancelarla desde esta página.
            </p>
          </>
        )}
      </div>
    </section>
  );
}
