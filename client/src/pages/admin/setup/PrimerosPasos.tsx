/**
 * «Primeros pasos»: asistente de configuración inicial de la empresa.
 *
 * El progreso se guarda en el servidor (por empresa): se puede dejar a medias y continuar después.
 * Cada paso se puede omitir. El cliente, el producto, el presupuesto y las invitaciones se crean con
 * los procedimientos que ya existen; el límite de usuarios del plan lo comprueba el servidor.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { toast } from "sonner";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  AlertTriangle, Building2, Briefcase, Check, CheckCircle2, ChevronLeft, ChevronRight, CircleDashed,
  FileText, HelpCircle, Loader2, Package, PartyPopper, SkipForward, UserPlus, Users,
} from "lucide-react";
import {
  BUSINESS_ACTIVITIES, COUNTRIES, CURRENCIES, SETUP_STEPS, STEP_LABELS, TIMEZONES, activityInfo, companySchema,
  type CompanyData, type SetupStep, type StepStatus,
} from "@shared/setupWizard";

const ICONS: Record<SetupStep, React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>> = {
  company: Building2,
  activity: Briefcase,
  client: Users,
  product: Package,
  operation: FileText,
  users: UserPlus,
  finish: PartyPopper,
};

const HELP: Record<SetupStep, string> = {
  company: "Estos datos aparecen en tus presupuestos y facturas. Los puedes cambiar más tarde en Configuración.",
  activity: "Solo adapta los textos y ejemplos del panel. No activa módulos ni contrata nada.",
  client: "Tus clientes quedan en el CRM con su historial. Puedes importar o añadir más después.",
  product: "El precio se indica sin impuestos; el impuesto se suma en presupuestos y facturas.",
  operation: "Un presupuesto se envía al cliente para que lo acepte; un pedido o reserva es una venta confirmada.",
  users: "Cada persona entra con su propio usuario. El número de usuarios depende de tu plan.",
  finish: "Puedes volver a este asistente cuando quieras desde su enlace.",
};

const TAX_RATES = ["21", "10", "4", "0"] as const;

const errMsg = (e: unknown) => (e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message) : "No se pudo guardar");
const slugify = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "elemento";

// ─── Campos accesibles ────────────────────────────────────────────────────────

function Field({ id, label, error, hint, required, children }: { id: string; label: string; error?: string; hint?: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium text-foreground">
        {label}
        {required && <span className="text-destructive" aria-hidden="true"> *</span>}
      </label>
      {children}
      {hint && !error && (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} role="alert" className="text-xs font-medium text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
const describedBy = (id: string, error?: string, hint?: string) => (error ? `${id}-error` : hint ? `${id}-hint` : undefined);

const selectClass =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-[invalid=true]:border-destructive";

// ─── Página ───────────────────────────────────────────────────────────────────

export default function PrimerosPasos() {
  const utils = trpc.useUtils();
  const status = trpc.setupWizard.status.useQuery(undefined, { retry: false });
  const [current, setCurrent] = useState<SetupStep | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  // Al cargar, se continúa por el primer paso pendiente
  useEffect(() => {
    if (current || !status.data) return;
    setCurrent(status.data.nextStep ?? "finish");
  }, [status.data, current]);
  // El foco va al título del paso al cambiar (lectores de pantalla y teclado)
  useEffect(() => {
    headingRef.current?.focus();
  }, [current]);

  const setStep = trpc.setupWizard.setStep.useMutation({
    onSuccess: () => utils.setupWizard.status.invalidate(),
    onError: (e) => toast.error(errMsg(e)),
  });

  if (status.isLoading || (!current && !status.error)) {
    return (
      <AdminLayout title="Primeros pasos">
        <div className="flex items-center gap-2 p-8 text-muted-foreground" role="status">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Cargando…
        </div>
      </AdminLayout>
    );
  }
  if (status.error || !status.data || !current) {
    return (
      <AdminLayout title="Primeros pasos">
        <div role="alert" className="m-6 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm">
          No se pudo cargar el asistente: {status.error?.message ?? "inténtalo de nuevo"}.
        </div>
      </AdminLayout>
    );
  }

  const d = status.data;
  const readOnly = d.licence.readOnly;
  const stepState = (s: SetupStep): StepStatus => d.progress.steps[s].status;
  const idx = SETUP_STEPS.indexOf(current);
  const go = (s: SetupStep) => setCurrent(s);
  const goNext = () => setCurrent(SETUP_STEPS[Math.min(idx + 1, SETUP_STEPS.length - 1)]);
  const complete = async (s: SetupStep, st: "done" | "skipped") => {
    await setStep.mutateAsync({ step: s, status: st });
    if (s !== "finish") goNext();
  };
  const Icon = ICONS[current];
  const activity = activityInfo(d.activity);

  return (
    <AdminLayout title="Primeros pasos">
      <div className="mx-auto max-w-5xl space-y-5 px-4 py-6 sm:px-6">
        <header className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-xl font-semibold text-foreground sm:text-2xl">Configura tu empresa</h1>
              <p className="text-sm text-muted-foreground">Siete pasos cortos. Puedes omitir cualquiera y continuar más tarde: el progreso se guarda.</p>
            </div>
            {d.licence.plan && (
              <p className="rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground">
                Plan <strong className="text-foreground">{d.licence.plan === "essential" ? "Essential" : d.licence.plan === "business" ? "Business" : "Enterprise"}</strong>
                {d.licence.daysLeft !== null && !readOnly && <> · prueba: {d.licence.daysLeft === 1 ? "queda 1 día" : `quedan ${d.licence.daysLeft} días`}</>}
              </p>
            )}
          </div>
          <div className="flex items-center gap-3">
            <Progress value={d.percent} className="h-2" aria-label="Avance de Primeros pasos" aria-valuetext={`${d.percent}% completado`} />
            <span className="w-12 text-right text-sm tabular-nums text-muted-foreground">{d.percent}%</span>
          </div>
          {readOnly && (
            <div role="alert" className="flex gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">
              <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
              <p>Tu periodo de prueba ha terminado: la cuenta está en solo lectura. Tus datos se conservan; contrata un plan para seguir trabajando.</p>
            </div>
          )}
        </header>

        <div className="grid gap-5 lg:grid-cols-[240px_1fr]">
          <nav aria-label="Pasos de Primeros pasos">
            <ol className="flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible">
              {SETUP_STEPS.map((s, i) => {
                const st = stepState(s);
                const active = s === current;
                return (
                  <li key={s} className="shrink-0">
                    <button
                      type="button"
                      onClick={() => go(s)}
                      aria-current={active ? "step" : undefined}
                      className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${
                        active ? "bg-primary/10 font-medium text-primary" : "text-muted-foreground hover:bg-muted"
                      }`}
                    >
                      <span
                        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                          st === "done" ? "bg-emerald-600 text-white" : st === "skipped" ? "bg-muted text-muted-foreground" : active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                        }`}
                        aria-hidden="true"
                      >
                        {st === "done" ? <Check className="h-3.5 w-3.5" /> : st === "skipped" ? <SkipForward className="h-3 w-3" /> : i + 1}
                      </span>
                      <span>
                        {STEP_LABELS[s].title}
                        <span className="sr-only">{st === "done" ? " (hecho)" : st === "skipped" ? " (omitido)" : " (pendiente)"}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </nav>

          <section aria-labelledby="paso-actual" className="rounded-2xl border border-border bg-card p-5 sm:p-6">
            <div className="mb-5 flex items-start gap-3">
              <div className="rounded-xl bg-primary/10 p-2.5 text-primary">
                <Icon className="h-5 w-5" aria-hidden />
              </div>
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">
                  Paso {idx + 1} de {SETUP_STEPS.length}
                </p>
                <h2 id="paso-actual" ref={headingRef} tabIndex={-1} className="text-lg font-semibold text-foreground outline-none">
                  {STEP_LABELS[current].title}
                </h2>
                <p className="text-sm text-muted-foreground">{STEP_LABELS[current].summary}</p>
              </div>
            </div>

            <details className="mb-5 rounded-lg border border-border/60 bg-muted/30 p-3 text-sm">
              <summary className="flex cursor-pointer items-center gap-2 font-medium text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
                <HelpCircle className="h-4 w-4" aria-hidden="true" /> ¿Para qué sirve este paso?
              </summary>
              <p className="mt-2 text-muted-foreground">{HELP[current]}</p>
            </details>

            {current === "company" && <CompanyStep initial={d.company} fiscalFromRegistry={d.fiscalFromRegistry} disabled={readOnly} onSaved={goNext} />}
            {current === "activity" && <ActivityStep initial={d.activity} disabled={readOnly} onSaved={goNext} />}
            {current === "client" && <ClientStep noun={activity.clientNoun} disabled={readOnly} onCreated={() => complete("client", "done")} />}
            {current === "product" && <ProductStep noun={activity.productNoun} example={activity.productExample} disabled={readOnly} onCreated={() => complete("product", "done")} />}
            {current === "operation" && <OperationStep disabled={readOnly} onCreated={() => complete("operation", "done")} />}
            {current === "users" && <UsersStep disabled={readOnly} onInvited={() => utils.setupWizard.status.invalidate()} />}
            {current === "finish" && <FinishStep steps={d.progress.steps} completedAt={d.progress.completedAt} onGo={go} />}

            <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
              <Button type="button" variant="ghost" onClick={() => go(SETUP_STEPS[Math.max(idx - 1, 0)])} disabled={idx === 0}>
                <ChevronLeft className="mr-1 h-4 w-4" aria-hidden="true" /> Anterior
              </Button>
              <div className="flex flex-wrap gap-2">
                {current !== "finish" && (
                  <Button type="button" variant="outline" disabled={setStep.isPending || readOnly} onClick={() => complete(current, "skipped")}>
                    Omitir este paso
                  </Button>
                )}
                {(current === "operation" || current === "users") && (
                  <Button type="button" disabled={setStep.isPending || readOnly} onClick={() => complete(current, "done")}>
                    Hecho, continuar <ChevronRight className="ml-1 h-4 w-4" aria-hidden="true" />
                  </Button>
                )}
                {current === "finish" && !d.progress.completedAt && (
                  <Button type="button" disabled={setStep.isPending || readOnly} onClick={() => complete("finish", "done").then(() => toast.success("¡Listo! Tu empresa está configurada."))}>
                    <CheckCircle2 className="mr-1 h-4 w-4" aria-hidden="true" /> Finalizar
                  </Button>
                )}
              </div>
            </div>
          </section>
        </div>
      </div>
    </AdminLayout>
  );
}

// ─── Paso 1: empresa ──────────────────────────────────────────────────────────

function CompanyStep({ initial, fiscalFromRegistry, disabled, onSaved }: { initial: Record<keyof CompanyData, string>; fiscalFromRegistry: boolean; disabled: boolean; onSaved: () => void }) {
  const utils = trpc.useUtils();
  const [v, setV] = useState<Record<keyof CompanyData, string>>({
    ...initial,
    country: initial.country || "ES",
    currency: initial.currency || "EUR",
    timezone: initial.timezone || "Europe/Madrid",
  });
  const [errors, setErrors] = useState<Partial<Record<keyof CompanyData, string>>>({});
  const save = trpc.setupWizard.saveCompany.useMutation({
    onSuccess: async () => {
      toast.success("Datos de la empresa guardados");
      await utils.setupWizard.status.invalidate();
      onSaved();
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  const set = (k: keyof CompanyData) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setV((x) => ({ ...x, [k]: e.target.value }));
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const r = companySchema.safeParse(v);
    if (!r.success) {
      const out: Partial<Record<keyof CompanyData, string>> = {};
      for (const i of r.error.issues) out[i.path[0] as keyof CompanyData] ??= i.message;
      setErrors(out);
      const first = Object.keys(out)[0];
      if (first) document.getElementById(`co-${first}`)?.focus();
      return;
    }
    setErrors({});
    save.mutate(r.data);
  };
  const input = (k: keyof CompanyData, label: string, o: { required?: boolean; hint?: string; autoComplete?: string } = {}) => (
    <Field id={`co-${k}`} label={label} error={errors[k]} hint={o.hint} required={o.required}>
      <Input
        id={`co-${k}`}
        value={v[k]}
        onChange={set(k)}
        autoComplete={o.autoComplete}
        aria-invalid={!!errors[k]}
        aria-required={o.required}
        aria-describedby={describedBy(`co-${k}`, errors[k], o.hint)}
        disabled={disabled}
      />
    </Field>
  );
  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      {fiscalFromRegistry && (
        <p className="rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
          Tu empresa ya tiene una entidad fiscal registrada por el equipo de Elephant Source: es la que figura en las facturas. Lo que guardes aquí se usa como datos de contacto y respaldo.
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        {input("tradeName", "Nombre comercial", { required: true, autoComplete: "organization" })}
        {input("legalName", "Razón social", { required: true, hint: "Tal y como figura en el registro mercantil o en Hacienda." })}
        {input("taxId", "NIF / CIF", { required: true })}
        {input("address", "Dirección fiscal", { required: true, autoComplete: "street-address" })}
        {input("postalCode", "Código postal", { autoComplete: "postal-code" })}
        {input("city", "Ciudad", { autoComplete: "address-level2" })}
        {input("province", "Provincia", { autoComplete: "address-level1" })}
        <Field id="co-country" label="País" error={errors.country} required>
          <select id="co-country" className={selectClass} value={v.country} onChange={set("country")} aria-invalid={!!errors.country} aria-describedby={describedBy("co-country", errors.country)} disabled={disabled}>
            {COUNTRIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field id="co-currency" label="Moneda" error={errors.currency} required>
          <select id="co-currency" className={selectClass} value={v.currency} onChange={set("currency")} aria-invalid={!!errors.currency} aria-describedby={describedBy("co-currency", errors.currency)} disabled={disabled}>
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </Field>
        <Field id="co-timezone" label="Zona horaria" error={errors.timezone} required>
          <select id="co-timezone" className={selectClass} value={v.timezone} onChange={set("timezone")} aria-invalid={!!errors.timezone} aria-describedby={describedBy("co-timezone", errors.timezone)} disabled={disabled}>
            {TIMEZONES.map((t) => (
              <option key={t} value={t}>
                {t.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Button type="submit" disabled={save.isPending || disabled}>
        {save.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden="true" />} Guardar y continuar
      </Button>
    </form>
  );
}

// ─── Paso 2: actividad ────────────────────────────────────────────────────────

function ActivityStep({ initial, disabled, onSaved }: { initial: string | null; disabled: boolean; onSaved: () => void }) {
  const utils = trpc.useUtils();
  const [value, setValue] = useState(initial ?? "");
  const [error, setError] = useState<string>();
  const save = trpc.setupWizard.saveActivity.useMutation({
    onSuccess: async () => {
      await utils.setupWizard.status.invalidate();
      onSaved();
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (!value) return setError("Elige la actividad que mejor describe tu negocio");
        setError(undefined);
        save.mutate({ activity: value as (typeof BUSINESS_ACTIVITIES)[number]["id"] });
      }}
      className="space-y-4"
    >
      <fieldset aria-describedby={error ? "act-error" : undefined}>
        <legend className="mb-2 text-sm font-medium text-foreground">¿A qué se dedica tu negocio?</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {BUSINESS_ACTIVITIES.map((a) => (
            <label
              key={a.id}
              className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 text-sm focus-within:ring-2 focus-within:ring-ring ${value === a.id ? "border-primary bg-primary/5" : "border-border"}`}
            >
              <input type="radio" name="actividad" value={a.id} checked={value === a.id} onChange={() => setValue(a.id)} disabled={disabled} className="h-4 w-4 accent-primary" />
              {a.label}
            </label>
          ))}
        </div>
        {error && (
          <p id="act-error" role="alert" className="mt-2 text-xs font-medium text-destructive">
            {error}
          </p>
        )}
      </fieldset>
      <Button type="submit" disabled={save.isPending || disabled}>
        Guardar y continuar
      </Button>
    </form>
  );
}

// ─── Paso 3: primer cliente ───────────────────────────────────────────────────

function ClientStep({ noun, disabled, onCreated }: { noun: string; disabled: boolean; onCreated: () => Promise<void> }) {
  const [v, setV] = useState({ name: "", email: "", phone: "", nif: "" });
  const [errors, setErrors] = useState<{ name?: string; email?: string }>({});
  const create = trpc.crm.clients.create.useMutation({
    onSuccess: async () => {
      toast.success(`Primer ${noun} creado`);
      await onCreated();
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const out: typeof errors = {};
    if (v.name.trim().length < 2) out.name = "Indica el nombre (mínimo 2 caracteres)";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email.trim())) out.email = "Indica un correo válido";
    setErrors(out);
    if (Object.keys(out).length) return void document.getElementById(`cl-${Object.keys(out)[0]}`)?.focus();
    create.mutate({ name: v.name.trim(), email: v.email.trim(), phone: v.phone.trim() || undefined, nif: v.nif.trim() || undefined });
  };
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement>) => setV((x) => ({ ...x, [k]: e.target.value }));
  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="cl-name" label="Nombre o razón social" error={errors.name} required>
          <Input id="cl-name" value={v.name} onChange={set("name")} aria-invalid={!!errors.name} aria-required aria-describedby={describedBy("cl-name", errors.name)} disabled={disabled} />
        </Field>
        <Field id="cl-email" label="Correo electrónico" error={errors.email} required>
          <Input id="cl-email" type="email" value={v.email} onChange={set("email")} aria-invalid={!!errors.email} aria-required aria-describedby={describedBy("cl-email", errors.email)} disabled={disabled} />
        </Field>
        <Field id="cl-phone" label="Teléfono">
          <Input id="cl-phone" type="tel" value={v.phone} onChange={set("phone")} disabled={disabled} />
        </Field>
        <Field id="cl-nif" label="NIF (opcional)">
          <Input id="cl-nif" value={v.nif} onChange={set("nif")} disabled={disabled} />
        </Field>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={create.isPending || disabled}>
          Crear {noun}
        </Button>
        <Link href="/admin/crm/clientes" className="text-sm text-primary underline-offset-4 hover:underline">
          Ir a clientes
        </Link>
      </div>
    </form>
  );
}

// ─── Paso 4: primer producto o servicio ───────────────────────────────────────

function ProductStep({ noun, example, disabled, onCreated }: { noun: string; example: string; disabled: boolean; onCreated: () => Promise<void> }) {
  const utils = trpc.useUtils();
  const categories = trpc.products.getCategories.useQuery();
  const locations = trpc.products.getLocations.useQuery();
  const createCategory = trpc.products.createCategory.useMutation();
  const createLocation = trpc.products.createLocation.useMutation();
  const createProduct = trpc.products.create.useMutation();
  const [v, setV] = useState({ title: "", price: "", tax: "21", customTax: "", unit: "per_unit" as "per_unit" | "per_person" });
  const [errors, setErrors] = useState<{ title?: string; price?: string; tax?: string }>({});
  const [busy, setBusy] = useState(false);
  const taxValue = v.tax === "otro" ? v.customTax : v.tax;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const out: typeof errors = {};
    const price = Number(v.price.replace(",", "."));
    const tax = Number(taxValue.replace(",", "."));
    if (v.title.trim().length < 2) out.title = "Indica el nombre (mínimo 2 caracteres)";
    if (!Number.isFinite(price) || price < 0 || v.price.trim() === "") out.price = "Indica un precio válido (0 o más)";
    if (!Number.isFinite(tax) || tax < 0 || tax > 100 || taxValue.trim() === "") out.tax = "Indica un impuesto entre 0 y 100 %";
    setErrors(out);
    if (Object.keys(out).length) return void document.getElementById(`pr-${Object.keys(out)[0]}`)?.focus();
    setBusy(true);
    try {
      // Una categoría y una ubicación por defecto si la empresa aún no tiene (los productos las exigen)
      const categoryId = categories.data?.[0]?.id ?? (await createCategory.mutateAsync({ slug: "general", name: "General" })).id;
      const locationId = locations.data?.[0]?.id ?? (await createLocation.mutateAsync({ slug: "principal", name: "Principal" })).id;
      await createProduct.mutateAsync({
        slug: `${slugify(v.title)}-${Math.random().toString(36).slice(2, 6)}`,
        title: v.title.trim(),
        categoryId,
        locationId,
        basePrice: price.toFixed(2),
        taxRate: String(tax),
        pricingType: v.unit,
      });
      await Promise.all([utils.products.getCategories.invalidate(), utils.products.getLocations.invalidate()]);
      toast.success(`Primer ${noun} creado`);
      await onCreated();
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="pr-title" label="Nombre" error={errors.title} hint={`Por ejemplo: ${example}`} required>
          <Input id="pr-title" value={v.title} onChange={(e) => setV((x) => ({ ...x, title: e.target.value }))} aria-invalid={!!errors.title} aria-required aria-describedby={describedBy("pr-title", errors.title, `Por ejemplo: ${example}`)} disabled={disabled} />
        </Field>
        <Field id="pr-price" label="Precio sin impuestos" error={errors.price} required>
          <Input id="pr-price" inputMode="decimal" value={v.price} onChange={(e) => setV((x) => ({ ...x, price: e.target.value }))} aria-invalid={!!errors.price} aria-required aria-describedby={describedBy("pr-price", errors.price)} disabled={disabled} />
        </Field>
        <Field id="pr-tax" label="Impuesto (IVA)" error={errors.tax} required>
          <select id="pr-tax" className={selectClass} value={v.tax} onChange={(e) => setV((x) => ({ ...x, tax: e.target.value }))} aria-invalid={!!errors.tax} aria-describedby={describedBy("pr-tax", errors.tax)} disabled={disabled}>
            {TAX_RATES.map((t) => (
              <option key={t} value={t}>
                {t} %
              </option>
            ))}
            <option value="otro">Otro…</option>
          </select>
        </Field>
        {v.tax === "otro" && (
          <Field id="pr-customTax" label="Impuesto personalizado (%)">
            <Input id="pr-customTax" inputMode="decimal" value={v.customTax} onChange={(e) => setV((x) => ({ ...x, customTax: e.target.value }))} disabled={disabled} />
          </Field>
        )}
        <Field id="pr-unit" label="Se cobra">
          <select id="pr-unit" className={selectClass} value={v.unit} onChange={(e) => setV((x) => ({ ...x, unit: e.target.value as "per_unit" | "per_person" }))} disabled={disabled}>
            <option value="per_unit">Por unidad</option>
            <option value="per_person">Por persona</option>
          </select>
        </Field>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={busy || disabled}>
          {busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden="true" />} Crear {noun}
        </Button>
        <Link href="/admin/productos/experiencias" className="text-sm text-primary underline-offset-4 hover:underline">
          Ir al catálogo
        </Link>
      </div>
    </form>
  );
}

// ─── Paso 5: primera operación ────────────────────────────────────────────────

function OperationStep({ disabled, onCreated }: { disabled: boolean; onCreated: () => Promise<void> }) {
  const clients = trpc.crm.clients.list.useQuery({ limit: 1, offset: 0 });
  const products = trpc.products.getAll.useQuery();
  const createQuote = trpc.crm.quotes.createDirect.useMutation({
    onSuccess: async (r) => {
      toast.success(`Presupuesto ${r.quoteNumber ?? ""} creado como borrador`);
      await onCreated();
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  const client = clients.data?.items?.[0];
  const product = useMemo(() => (products.data ?? [])[0] as { id: number; title: string; basePrice: string | number; taxRate?: string | number | null } | undefined, [products.data]);
  const canDraft = !!client && !!product;
  const draft = () => {
    if (!client || !product) return;
    const unit = Number(product.basePrice) || 0;
    const tax = Number(product.taxRate ?? 21);
    createQuote.mutate({
      clientName: client.name,
      clientEmail: client.email,
      title: `Presupuesto para ${client.name}`,
      items: [{ description: product.title, quantity: 1, unitPrice: unit, total: unit, taxRate: tax, productId: product.id }],
      subtotal: unit,
      taxRate: tax,
      total: Math.round(unit * (1 + tax / 100) * 100) / 100,
      sendNow: false,
    });
  };
  return (
    <div className="space-y-4 text-sm">
      <p className="text-muted-foreground">Elige cómo quieres registrar tu primera venta:</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-border p-4">
          <h3 className="font-medium text-foreground">Presupuesto</h3>
          <p className="mt-1 text-muted-foreground">Para enviar una propuesta que el cliente acepta antes de pagar.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button type="button" size="sm" disabled={!canDraft || createQuote.isPending || disabled} onClick={draft}>
              Crear borrador con mi primer cliente y producto
            </Button>
            <Link href="/admin/crm/presupuestos" className="self-center text-primary underline-offset-4 hover:underline">
              Ir a presupuestos
            </Link>
          </div>
          {!canDraft && <p className="mt-2 text-xs text-muted-foreground">Para el borrador automático necesitas un cliente y un producto (pasos 3 y 4).</p>}
          <p className="mt-2 text-xs text-muted-foreground">El borrador no se envía al cliente.</p>
        </div>
        <div className="rounded-xl border border-border p-4">
          <h3 className="font-medium text-foreground">Pedido o reserva</h3>
          <p className="mt-1 text-muted-foreground">Para registrar una venta ya confirmada.</p>
          <Link href="/admin/crm/reservas" className="mt-3 inline-block text-primary underline-offset-4 hover:underline">
            Ir a pedidos y reservas
          </Link>
        </div>
      </div>
    </div>
  );
}

// ─── Paso 6: usuarios ─────────────────────────────────────────────────────────

function UsersStep({ disabled, onInvited }: { disabled: boolean; onInvited: () => void }) {
  const utils = trpc.useUtils();
  const seats = trpc.setupWizard.seats.useQuery();
  const [v, setV] = useState({ name: "", email: "", role: "user" as "user" | "admin" });
  const [errors, setErrors] = useState<{ name?: string; email?: string }>({});
  const invite = trpc.admin.createUser.useMutation({
    onSuccess: async () => {
      toast.success(`Invitación enviada a ${v.email}`);
      setV({ name: "", email: "", role: "user" });
      await utils.setupWizard.seats.invalidate();
      onInvited();
    },
    // El límite del plan lo decide el servidor: su mensaje se muestra tal cual
    onError: (e) => toast.error(errMsg(e)),
  });
  const full = seats.data?.available === 0;
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const out: typeof errors = {};
    if (v.name.trim().length < 2) out.name = "Indica el nombre (mínimo 2 caracteres)";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email.trim())) out.email = "Indica un correo válido";
    setErrors(out);
    if (Object.keys(out).length) return void document.getElementById(`us-${Object.keys(out)[0]}`)?.focus();
    invite.mutate({ name: v.name.trim(), email: v.email.trim(), role: v.role });
  };
  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      {seats.data && (
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {seats.data.limit === null ? (
            <>Usuarios activos: {seats.data.used}.</>
          ) : (
            <>
              Usuarios: <strong className="text-foreground">{seats.data.used}</strong> de {seats.data.limit} incluidos en tu plan
              {full ? ". Has llegado al límite: desactiva un usuario o amplía tu plan para invitar a más." : "."}
            </>
          )}
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-3">
        <Field id="us-name" label="Nombre" error={errors.name} required>
          <Input id="us-name" value={v.name} onChange={(e) => setV((x) => ({ ...x, name: e.target.value }))} aria-invalid={!!errors.name} aria-required aria-describedby={describedBy("us-name", errors.name)} disabled={disabled || full} />
        </Field>
        <Field id="us-email" label="Correo electrónico" error={errors.email} required>
          <Input id="us-email" type="email" value={v.email} onChange={(e) => setV((x) => ({ ...x, email: e.target.value }))} aria-invalid={!!errors.email} aria-required aria-describedby={describedBy("us-email", errors.email)} disabled={disabled || full} />
        </Field>
        <Field id="us-role" label="Permisos">
          <select id="us-role" className={selectClass} value={v.role} onChange={(e) => setV((x) => ({ ...x, role: e.target.value as "user" | "admin" }))} disabled={disabled || full}>
            <option value="user">Empleado</option>
            <option value="admin">Administrador</option>
          </select>
        </Field>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={invite.isPending || disabled || full}>
          {invite.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden="true" />} Enviar invitación
        </Button>
        <Link href="/admin/usuarios" className="text-sm text-primary underline-offset-4 hover:underline">
          Gestionar usuarios
        </Link>
      </div>
    </form>
  );
}

// ─── Paso 7: finalización ─────────────────────────────────────────────────────

function FinishStep({ steps, completedAt, onGo }: { steps: Record<SetupStep, { status: StepStatus }>; completedAt: number | null; onGo: (s: SetupStep) => void }) {
  const pending = SETUP_STEPS.filter((s) => s !== "finish" && steps[s].status !== "done");
  return (
    <div className="space-y-4 text-sm">
      {completedAt ? (
        <p className="flex items-center gap-2 font-medium text-emerald-700 dark:text-emerald-400">
          <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> Configuración inicial terminada.
        </p>
      ) : (
        <p className="text-muted-foreground">Repasa lo que queda. Puedes finalizar ahora y completarlo más tarde.</p>
      )}
      {pending.length > 0 && (
        <ul className="space-y-2">
          {pending.map((s) => (
            <li key={s} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-3">
              <span className="flex items-center gap-2">
                <CircleDashed className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                {STEP_LABELS[s].title} <span className="text-muted-foreground">({steps[s].status === "skipped" ? "omitido" : "pendiente"})</span>
              </span>
              <Button type="button" size="sm" variant="outline" onClick={() => onGo(s)}>
                Completar
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className="grid gap-2 sm:grid-cols-3">
        <Link href="/admin/crm" className="rounded-lg border border-border p-3 text-primary hover:bg-muted">
          Ir al CRM
        </Link>
        <Link href="/admin/configuracion" className="rounded-lg border border-border p-3 text-primary hover:bg-muted">
          Más ajustes
        </Link>
        <Link href="/admin" className="rounded-lg border border-border p-3 text-primary hover:bg-muted">
          Ir al panel
        </Link>
      </div>
    </div>
  );
}
