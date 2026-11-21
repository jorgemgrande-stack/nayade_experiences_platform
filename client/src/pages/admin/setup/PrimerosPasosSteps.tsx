/**
 * Pasos de «Primeros pasos». Cada paso «de hacer» usa los procedimientos que ya existen (crm, products,
 * integrations, admin) y se da por hecho cuando el dato existe; si ya existe, no se vuelve a pedir.
 */
import { useMemo, useState } from "react";
import { Link } from "wouter";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CheckCircle2, CircleDashed, ExternalLink, Loader2, Pencil, SkipForward, Sparkles } from "lucide-react";
import { singleLineQuoteAmounts } from "@/lib/quoteAmounts";
import { useI18n } from "@/i18n/I18nProvider";
import { LOCALE_META } from "@shared/i18n/core";
import {
  BUSINESS_ACTIVITIES, COUNTRIES, CURRENCIES, TIMEZONES, commsSchema, configurationSteps, fiscalSchema, identitySchema, spanishFiscalErrors,
  type CompanyData, type PlanStep, type SetupStep,
} from "@shared/setupWizard";

export const errMsg = (e: unknown, fallback = "No se pudo guardar") => (e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message) : fallback);

/** Títulos y resúmenes de los pasos en el idioma de la interfaz (los textos originales viven en shared/setupWizard.ts, en español). */
export function useStepLabels(): Record<SetupStep, { title: string; summary: string }> {
  const { t } = useI18n();
  return {
    welcome: { title: t("setup.stepLabels.welcome.title"), summary: t("setup.stepLabels.welcome.summary") },
    company: { title: t("setup.stepLabels.company.title"), summary: t("setup.stepLabels.company.summary") },
    fiscal: { title: t("setup.stepLabels.fiscal.title"), summary: t("setup.stepLabels.fiscal.summary") },
    activity: { title: t("setup.stepLabels.activity.title"), summary: t("setup.stepLabels.activity.summary") },
    brand: { title: t("setup.stepLabels.brand.title"), summary: t("setup.stepLabels.brand.summary") },
    web: { title: t("setup.stepLabels.web.title"), summary: t("setup.stepLabels.web.summary") },
    client: { title: t("setup.stepLabels.client.title"), summary: t("setup.stepLabels.client.summary") },
    product: { title: t("setup.stepLabels.product.title"), summary: t("setup.stepLabels.product.summary") },
    operation: { title: t("setup.stepLabels.operation.title"), summary: t("setup.stepLabels.operation.summary") },
    document: { title: t("setup.stepLabels.document.title"), summary: t("setup.stepLabels.document.summary") },
    comms: { title: t("setup.stepLabels.comms.title"), summary: t("setup.stepLabels.comms.summary") },
    sector: { title: t("setup.stepLabels.sector.title"), summary: t("setup.stepLabels.sector.summary") },
    finish: { title: t("setup.stepLabels.finish.title"), summary: t("setup.stepLabels.finish.summary") },
    users: { title: t("setup.stepLabels.users.title"), summary: t("setup.stepLabels.users.summary") },
  };
}

/** Sustantivos, ejemplos, tipos de actividad y países de shared/setupWizard.ts (texto español de origen) en el idioma de la interfaz. */
export function useSetupText() {
  const { t, locale } = useI18n();
  const nouns: Record<string, string> = {
    cliente: t("setup.nouns.cliente"),
    alumno: t("setup.nouns.alumno"),
    producto: t("setup.nouns.producto"),
    servicio: t("setup.nouns.servicio"),
    "producto o servicio": t("setup.nouns.productoOServicio"),
    curso: t("setup.nouns.curso"),
  };
  const examples: Record<string, string> = {
    "Camiseta de algodón": t("setup.examples.camiseta"),
    "Sesión de asesoría (1 hora)": t("setup.examples.asesoria"),
    "Plan mensual": t("setup.examples.plan"),
    "Mi primer servicio": t("setup.examples.servicio"),
    "Menú del día": t("setup.examples.menu"),
    "Curso de iniciación (8 horas)": t("setup.examples.curso"),
  };
  const activities: Record<string, { label: string; description: string }> = {
    comercio: { label: t("setup.activities.comercio.label"), description: t("setup.activities.comercio.description") },
    servicios: { label: t("setup.activities.servicios.label"), description: t("setup.activities.servicios.description") },
    web: { label: t("setup.activities.web.label"), description: t("setup.activities.web.description") },
    sectorial: { label: t("setup.activities.sectorial.label"), description: t("setup.activities.sectorial.description") },
  };
  return {
    noun: (n: string) => nouns[n] ?? n,
    example: (e: string) => examples[e] ?? e,
    activity: (a: { id: string; label: string; description: string }) => activities[a.id] ?? a,
    country: (c: { code: string; name: string }) => {
      if (locale === "es") return c.name;
      try {
        return new Intl.DisplayNames([LOCALE_META[locale].tag], { type: "region" }).of(c.code) ?? c.name;
      } catch {
        return c.name;
      }
    },
  };
}
const slugify = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "elemento";
const TAX_RATES = ["21", "10", "4", "0"] as const;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ─── Piezas comunes ───────────────────────────────────────────────────────────

export function Field({ id, label, error, hint, required, children }: { id: string; label: string; error?: string; hint?: string; required?: boolean; children: React.ReactNode }) {
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

/** Aviso de «esto ya está hecho» con los datos reales y la opción de continuar o añadir más. */
function AlreadyDone({ children, onContinue, extra }: { children: React.ReactNode; onContinue: () => void; extra?: React.ReactNode }) {
  const { t } = useI18n();
  return (
    <div className="space-y-4 text-sm">
      <p className="flex items-start gap-2 rounded-lg border border-success/30 bg-success/5 p-3 text-foreground">
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden="true" />
        <span>{children}</span>
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" onClick={onContinue}>
          {t("setup.continue")}
        </Button>
        {extra}
      </div>
    </div>
  );
}

const linkClass = "inline-flex items-center gap-1 text-sm text-primary underline-offset-4 hover:underline";

/** Validación con zod → errores por campo y foco en el primero. */
function issues<T extends string>(r: { success: false; error: { issues: Array<{ path: PropertyKey[]; message: string }> } }, prefix: string): Partial<Record<T, string>> {
  const out: Partial<Record<T, string>> = {};
  for (const i of r.error.issues) out[i.path[0] as T] ??= i.message;
  const first = Object.keys(out)[0];
  if (first) document.getElementById(`${prefix}-${first}`)?.focus();
  return out;
}

// ─── Bienvenida ───────────────────────────────────────────────────────────────

export function WelcomeStep({ tradeName, planName, steps, disabled, onStart }: { tradeName: string; planName: string | null; steps: PlanStep[]; disabled: boolean; onStart: () => void }) {
  const { t } = useI18n();
  const labels = useStepLabels();
  const rest = configurationSteps(steps);
  return (
    <div className="space-y-4 text-sm">
      <p className="text-foreground">
        {tradeName ? <>{t("setup.welcome.readyBefore")} <strong>{tradeName}</strong> {t("setup.welcome.readyAfter")}</> : <>{t("setup.welcome.readyNoName")}</>}{" "}
        {t("setup.welcome.count", { count: rest.length })}{planName ? <>{t("setup.welcome.planBefore")} <strong>{planName}</strong></> : null}.
      </p>
      <ul className="grid gap-2 sm:grid-cols-2">
        {rest.map((s) => (
          <li key={s.id} className="flex items-center gap-2 rounded-lg border border-border p-2.5">
            {s.status === "done" ? (
              <CheckCircle2 className="h-4 w-4 shrink-0 text-success" aria-hidden="true" />
            ) : (
              <CircleDashed className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            )}
            <span className="min-w-0 flex-1">{labels[s.id].title}</span>
            {s.status === "done" && <span className="text-xs text-muted-foreground">{t("setup.welcome.already")}</span>}
          </li>
        ))}
      </ul>
      <p className="text-muted-foreground">
        {t("setup.welcome.autosave")}
      </p>
      <Button type="button" onClick={onStart} disabled={disabled}>
        {t("setup.welcome.start")}
      </Button>
    </div>
  );
}

// ─── Identidad de empresa ─────────────────────────────────────────────────────

export function IdentityStep({ initial, done, disabled, onSaved }: { initial: Record<keyof CompanyData, string>; done: boolean; disabled: boolean; onSaved: () => void }) {
  const { t } = useI18n();

  const tx = useSetupText();
  const utils = trpc.useUtils();
  const [editing, setEditing] = useState(!done);
  const [v, setV] = useState({ tradeName: initial.tradeName, country: initial.country || "ES", currency: initial.currency || "EUR", timezone: initial.timezone || "Europe/Madrid" });
  const [errors, setErrors] = useState<Partial<Record<keyof typeof v, string>>>({});
  const save = trpc.setupWizard.saveIdentity.useMutation({
    onSuccess: async () => {
      toast.success(t("setup.identity.saved"));
      await utils.setupWizard.status.invalidate();
      onSaved();
    },
    onError: (e) => toast.error(errMsg(e, t("setup.saveFail"))),
  });
  if (!editing) {
    const found = COUNTRIES.find((c) => c.code === initial.country);
    const country = found ? tx.country(found) : initial.country;
    return (
      <AlreadyDone onContinue={onSaved} extra={<Button type="button" variant="ghost" onClick={() => setEditing(true)}><Pencil className="mr-1 h-4 w-4" aria-hidden="true" /> {t("setup.fix")}</Button>}>
        {t("setup.identity.known")} <strong>{initial.tradeName}</strong> · {country} · {initial.currency} · {initial.timezone.replace(/_/g, " ")}.
      </AlreadyDone>
    );
  }
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setV((x) => ({ ...x, [k]: e.target.value }));
  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        const r = identitySchema.safeParse(v);
        if (!r.success) return setErrors(issues(r, "id"));
        setErrors({});
        save.mutate(r.data);
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="id-tradeName" label={t("setup.identity.tradeName")} error={errors.tradeName} hint={t("setup.identity.tradeNameHint")} required>
          <Input id="id-tradeName" value={v.tradeName} onChange={set("tradeName")} autoComplete="organization" aria-invalid={!!errors.tradeName} aria-required aria-describedby={describedBy("id-tradeName", errors.tradeName, "x")} disabled={disabled} />
        </Field>
        <Field id="id-country" label={t("setup.identity.country")} error={errors.country} required>
          <select id="id-country" className={selectClass} value={v.country} onChange={set("country")} aria-invalid={!!errors.country} disabled={disabled}>
            {COUNTRIES.map((c) => (
              <option key={c.code} value={c.code}>
                {tx.country(c)}
              </option>
            ))}
          </select>
        </Field>
        <Field id="id-currency" label={t("setup.identity.currency")} error={errors.currency} required>
          <select id="id-currency" className={selectClass} value={v.currency} onChange={set("currency")} aria-invalid={!!errors.currency} disabled={disabled}>
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </Field>
        <Field id="id-timezone" label={t("setup.identity.timezone")} error={errors.timezone} required>
          <select id="id-timezone" className={selectClass} value={v.timezone} onChange={set("timezone")} aria-invalid={!!errors.timezone} disabled={disabled}>
            {TIMEZONES.map((t) => (
              <option key={t} value={t}>
                {t.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Button type="submit" disabled={save.isPending || disabled}>
        {save.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden="true" />} {t("setup.saveContinue")}
      </Button>
    </form>
  );
}

// ─── Datos fiscales y comerciales ─────────────────────────────────────────────

type FiscalKey = "legalName" | "taxId" | "address" | "postalCode" | "city" | "province" | "publicPhone" | "publicEmail" | "publicLocation";

export function FiscalStep({ initial, country, done, fiscalFromRegistry, disabled, onSaved }: { initial: Record<keyof CompanyData, string>; country: string; done: boolean; fiscalFromRegistry: boolean; disabled: boolean; onSaved: () => void }) {
  const { t } = useI18n();

  const utils = trpc.useUtils();
  const [editing, setEditing] = useState(!done);
  const [v, setV] = useState<Record<FiscalKey, string>>({
    legalName: initial.legalName, taxId: initial.taxId, address: initial.address, postalCode: initial.postalCode, city: initial.city,
    province: initial.province, publicPhone: initial.publicPhone, publicEmail: initial.publicEmail, publicLocation: initial.publicLocation,
  });
  const [errors, setErrors] = useState<Partial<Record<FiscalKey, string>>>({});
  const save = trpc.setupWizard.saveFiscal.useMutation({
    onSuccess: async () => {
      toast.success(t("setup.fiscal.saved"));
      await utils.setupWizard.status.invalidate();
      onSaved();
    },
    onError: (e) => toast.error(errMsg(e, t("setup.saveFail"))),
  });
  if (!editing) {
    return (
      <AlreadyDone onContinue={onSaved} extra={<Button type="button" variant="ghost" onClick={() => setEditing(true)}><Pencil className="mr-1 h-4 w-4" aria-hidden="true" /> {t("setup.fixOrComplete")}</Button>}>
        {t("setup.fiscal.known")} <strong>{initial.legalName}</strong> · {initial.taxId}
        {initial.address ? <> · {initial.address}</> : null}.{fiscalFromRegistry ? " " + t("setup.fiscal.fromRegistry") : ""}
      </AlreadyDone>
    );
  }
  const set = (k: FiscalKey) => (e: React.ChangeEvent<HTMLInputElement>) => setV((x) => ({ ...x, [k]: e.target.value }));
  const input = (k: FiscalKey, label: string, o: { required?: boolean; hint?: string; autoComplete?: string } = {}) => (
    <Field id={`fi-${k}`} label={label} error={errors[k]} hint={o.hint} required={o.required}>
      <Input id={`fi-${k}`} value={v[k]} onChange={set(k)} autoComplete={o.autoComplete} aria-invalid={!!errors[k]} aria-required={o.required} aria-describedby={describedBy(`fi-${k}`, errors[k], o.hint)} disabled={disabled} />
    </Field>
  );
  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        const r = fiscalSchema.safeParse(v);
        if (!r.success) return setErrors(issues(r, "fi"));
        // Empresa española: NIF/CIF con su dígito de control y código postal real
        const es = spanishFiscalErrors(country, r.data);
        // El NIF de la entidad fiscal registrada (el de las facturas) se acepta tal cual, como en el servidor
        if (fiscalFromRegistry && r.data.taxId === initial.taxId.trim().toUpperCase()) delete es.taxId;
        if (es.taxId || es.postalCode) {
          setErrors(es);
          document.getElementById(`fi-${es.taxId ? "taxId" : "postalCode"}`)?.focus();
          return;
        }
        setErrors({});
        save.mutate(r.data);
      }}
    >
      {fiscalFromRegistry && (
        <p className="rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
          {t("setup.fiscal.registryNote")}
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        {input("legalName", t("setup.fiscal.legalName"), { required: true, hint: t("setup.fiscal.legalNameHint") })}
        {input("taxId", t("setup.fiscal.taxId"), { required: true, hint: (country || "ES") === "ES" ? t("setup.fiscal.taxIdHint") : undefined })}
        {input("address", t("setup.fiscal.address"), { required: true, autoComplete: "street-address" })}
        {input("postalCode", t("setup.fiscal.postalCode"), { autoComplete: "postal-code", hint: (country || "ES") === "ES" ? t("setup.fiscal.postalCodeHint") : undefined })}
        {input("city", t("setup.fiscal.city"), { autoComplete: "address-level2" })}
        {input("province", t("setup.fiscal.province"), { autoComplete: "address-level1" })}
      </div>
      <h3 className="pt-2 text-sm font-semibold">{t("setup.fiscal.publicContact")}</h3>
      <p className="text-xs text-muted-foreground">{t("setup.fiscal.publicContactNote")}</p>
      <div className="grid gap-4 sm:grid-cols-2">
        {input("publicPhone", t("setup.fiscal.phone"), { autoComplete: "tel" })}
        {input("publicEmail", t("setup.fiscal.publicEmail"), { autoComplete: "email" })}
        {input("publicLocation", t("setup.fiscal.publicLocation"), { hint: t("setup.fiscal.publicLocationHint") })}
      </div>
      <Button type="submit" disabled={save.isPending || disabled}>
        {save.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden="true" />} {t("setup.saveContinue")}
      </Button>
    </form>
  );
}

// ─── Tipo de actividad ────────────────────────────────────────────────────────

export function ActivityStep({ initial, allowed, disabled, onSaved }: { initial: string | null; allowed: string[]; disabled: boolean; onSaved: () => void }) {
  const { t } = useI18n();

  const utils = trpc.useUtils();
  const tx = useSetupText();
  const [value, setValue] = useState(initial && allowed.includes(initial) ? initial : "");
  const [error, setError] = useState<string>();
  const save = trpc.setupWizard.saveActivity.useMutation({
    onSuccess: async () => {
      await utils.setupWizard.status.invalidate();
      onSaved();
    },
    onError: (e) => toast.error(errMsg(e, t("setup.saveFail"))),
  });
  const options = BUSINESS_ACTIVITIES.filter((a) => allowed.includes(a.id));
  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!value) return setError(t("setup.activity.pick"));
        setError(undefined);
        save.mutate({ activity: value as (typeof BUSINESS_ACTIVITIES)[number]["id"] });
      }}
    >
      <fieldset aria-describedby={error ? "act-error" : undefined}>
        <legend className="mb-2 text-sm font-medium text-foreground">{t("setup.activity.question")}</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {options.map((a) => (
            <label key={a.id} className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm focus-within:ring-2 focus-within:ring-ring ${value === a.id ? "border-primary bg-primary/5" : "border-border"}`}>
              <input type="radio" name="actividad" value={a.id} checked={value === a.id} onChange={() => setValue(a.id)} disabled={disabled} className="mt-0.5 h-4 w-4 accent-primary" />
              <span>
                <span className="block font-medium text-foreground">{tx.activity(a).label}</span>
                <span className="block text-xs text-muted-foreground">{tx.activity(a).description}</span>
              </span>
            </label>
          ))}
        </div>
        {error && (
          <p id="act-error" role="alert" className="mt-2 text-xs font-medium text-destructive">
            {error}
          </p>
        )}
      </fieldset>
      <p className="text-xs text-muted-foreground">{t("setup.activity.note")}</p>
      <Button type="submit" disabled={save.isPending || disabled}>
        {t("setup.saveContinue")}
      </Button>
    </form>
  );
}

// ─── CRM: primer cliente ──────────────────────────────────────────────────────

export function ClientStep({ noun, count, disabled, onDone }: { noun: string; count: number; disabled: boolean; onDone: () => void }) {
  const { t } = useI18n();

  const nounT = useSetupText().noun(noun);
  const [v, setV] = useState({ name: "", email: "", phone: "", nif: "" });
  const [errors, setErrors] = useState<{ name?: string; email?: string }>({});
  const create = trpc.crm.clients.create.useMutation({
    onSuccess: () => {
      toast.success(t("setup.client.created", { noun: nounT }));
      onDone();
    },
    onError: (e) => toast.error(errMsg(e, t("setup.saveFail"))),
  });
  if (count > 0) {
    return (
      <AlreadyDone onContinue={onDone} extra={<Link href="/admin/crm/clientes" className={linkClass}>{t("setup.client.seeClients")}</Link>}>
        {t("setup.client.already", { count, noun: nounT })}
      </AlreadyDone>
    );
  }
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const out: typeof errors = {};
    if (v.name.trim().length < 2) out.name = t("setup.client.nameMin");
    if (!EMAIL_RE.test(v.email.trim())) out.email = t("setup.client.emailInvalid");
    setErrors(out);
    if (Object.keys(out).length) return void document.getElementById(`cl-${Object.keys(out)[0]}`)?.focus();
    create.mutate({ name: v.name.trim(), email: v.email.trim(), phone: v.phone.trim() || undefined, nif: v.nif.trim() || undefined });
  };
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement>) => setV((x) => ({ ...x, [k]: e.target.value }));
  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="cl-name" label={t("setup.client.name")} error={errors.name} required>
          <Input id="cl-name" value={v.name} onChange={set("name")} aria-invalid={!!errors.name} aria-required aria-describedby={describedBy("cl-name", errors.name)} disabled={disabled} />
        </Field>
        <Field id="cl-email" label={t("setup.client.email")} error={errors.email} required>
          <Input id="cl-email" type="email" value={v.email} onChange={set("email")} aria-invalid={!!errors.email} aria-required aria-describedby={describedBy("cl-email", errors.email)} disabled={disabled} />
        </Field>
        <Field id="cl-phone" label={t("setup.client.phone")}>
          <Input id="cl-phone" type="tel" value={v.phone} onChange={set("phone")} disabled={disabled} />
        </Field>
        <Field id="cl-nif" label={t("setup.client.nif")}>
          <Input id="cl-nif" value={v.nif} onChange={set("nif")} disabled={disabled} />
        </Field>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={create.isPending || disabled}>
          {t("setup.client.create", { noun: nounT })}
        </Button>
        <Link href="/admin/crm/clientes" className={linkClass}>
          {t("setup.client.manage")}
        </Link>
      </div>
    </form>
  );
}

// ─── Productos o servicios ────────────────────────────────────────────────────

export function ProductStep({ noun, example, currency, count, disabled, onDone }: { noun: string; example: string; currency: string; count: number; disabled: boolean; onDone: () => void }) {
  const { t } = useI18n();

  const tx = useSetupText();
  const nounT = tx.noun(noun);
  const exampleT = tx.example(example);
  const utils = trpc.useUtils();
  const categories = trpc.products.getCategories.useQuery(undefined, { enabled: count === 0 });
  const locations = trpc.products.getLocations.useQuery(undefined, { enabled: count === 0 });
  const createCategory = trpc.products.createCategory.useMutation();
  const createLocation = trpc.products.createLocation.useMutation();
  const createProduct = trpc.products.create.useMutation();
  const [v, setV] = useState({ title: "", price: "", tax: "21", customTax: "", unit: "per_unit" as "per_unit" | "per_person" });
  const [errors, setErrors] = useState<{ title?: string; price?: string; tax?: string }>({});
  const [busy, setBusy] = useState(false);
  if (count > 0) {
    return (
      <AlreadyDone onContinue={onDone} extra={<Link href="/admin/productos/experiencias" className={linkClass}>{t("setup.product.seeCatalog")}</Link>}>
        {t("setup.product.already", { count })}
      </AlreadyDone>
    );
  }
  const taxValue = v.tax === "otro" ? v.customTax : v.tax;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const out: typeof errors = {};
    const price = Number(v.price.replace(",", "."));
    const tax = Number(taxValue.replace(",", "."));
    if (v.title.trim().length < 2) out.title = t("setup.product.nameMin");
    if (!Number.isFinite(price) || price < 0 || v.price.trim() === "") out.price = t("setup.product.priceInvalid");
    if (!Number.isFinite(tax) || tax < 0 || tax > 100 || taxValue.trim() === "") out.tax = t("setup.product.taxInvalid");
    setErrors(out);
    if (Object.keys(out).length) return void document.getElementById(`pr-${Object.keys(out)[0]}`)?.focus();
    setBusy(true);
    try {
      // Una categoría y un lugar de servicio por defecto si la empresa aún no tiene (el catálogo los exige)
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
        // El primer producto se puede cobrar ya en el TPV (en la ficha es «Vendible en TPV»)
        isPresentialSale: true,
      });
      await Promise.all([utils.products.getCategories.invalidate(), utils.products.getLocations.invalidate(), utils.products.getAll.invalidate()]);
      toast.success(t("setup.product.created", { noun: nounT }));
      onDone();
    } catch (err) {
      toast.error(errMsg(err, t("setup.saveFail")));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="pr-title" label={t("setup.product.name")} error={errors.title} hint={t("setup.product.example", { example: exampleT })} required>
          <Input id="pr-title" value={v.title} onChange={(e) => setV((x) => ({ ...x, title: e.target.value }))} aria-invalid={!!errors.title} aria-required aria-describedby={describedBy("pr-title", errors.title, t("setup.product.example", { example: exampleT }))} disabled={disabled} />
        </Field>
        <Field id="pr-price" label={t("setup.product.price", { currency: currency === "EUR" ? "€" : currency })} error={errors.price} required>
          <Input id="pr-price" inputMode="decimal" value={v.price} onChange={(e) => setV((x) => ({ ...x, price: e.target.value }))} aria-invalid={!!errors.price} aria-required aria-describedby={describedBy("pr-price", errors.price)} disabled={disabled} />
        </Field>
        <Field id="pr-tax" label={t("setup.product.tax")} error={errors.tax} required>
          <select id="pr-tax" className={selectClass} value={v.tax} onChange={(e) => setV((x) => ({ ...x, tax: e.target.value }))} aria-invalid={!!errors.tax} aria-describedby={describedBy("pr-tax", errors.tax)} disabled={disabled}>
            {TAX_RATES.map((t) => (
              <option key={t} value={t}>
                {t} %
              </option>
            ))}
            <option value="otro">{t("setup.product.other")}</option>
          </select>
        </Field>
        {v.tax === "otro" && (
          <Field id="pr-customTax" label={t("setup.product.customTax")}>
            <Input id="pr-customTax" inputMode="decimal" value={v.customTax} onChange={(e) => setV((x) => ({ ...x, customTax: e.target.value }))} disabled={disabled} />
          </Field>
        )}
        <Field id="pr-unit" label={t("setup.product.unit")}>
          <select id="pr-unit" className={selectClass} value={v.unit} onChange={(e) => setV((x) => ({ ...x, unit: e.target.value as "per_unit" | "per_person" }))} disabled={disabled}>
            <option value="per_unit">{t("setup.product.perUnit")}</option>
            <option value="per_person">{t("setup.product.perPerson")}</option>
          </select>
        </Field>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={busy || disabled}>
          {busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden="true" />} {t("setup.product.create", { noun: nounT })}
        </Button>
        <Link href="/admin/productos/experiencias" className={linkClass}>
          {t("setup.product.fullCatalog")}
        </Link>
      </div>
    </form>
  );
}

// ─── Página web ───────────────────────────────────────────────────────────────

/** Aviso de los datos fiscales que faltan para completar los textos legales de la web (no se inventa ninguno). */
function LegalNotice({ missing }: { missing: string[] }) {
  const { t } = useI18n();
  if (!missing.length) return null;
  return (
    <p role="note" className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm text-foreground">
      {t("setup.web.legalBefore")} <strong>{missing.join(", ")}</strong>{t("setup.web.legalAfter")}{" "}
      <Link href="/admin/configuracion" className="text-primary underline underline-offset-4">
        {t("setup.web.completeData")}
      </Link>
    </p>
  );
}

export function WebStep({ done, onContinue, legalMissing = [] }: { done: boolean; onContinue: () => void; legalMissing?: string[] }) {
  const { t } = useI18n();

  const links = (
    <div className="grid gap-2 sm:grid-cols-3">
      <Link href="/admin/cms/paginas" className="rounded-lg border border-border p-3 text-sm text-primary hover:bg-muted">
        {t("setup.web.editPages")}
      </Link>
      <Link href="/admin/cms/menus" className="rounded-lg border border-border p-3 text-sm text-primary hover:bg-muted">
        {t("setup.web.sortMenu")}
      </Link>
      <a href="/" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-lg border border-border p-3 text-sm text-primary hover:bg-muted">
        {t("setup.web.viewSite")} <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
      </a>
    </div>
  );
  if (done) {
    return (
      <div className="space-y-4">
        <AlreadyDone onContinue={onContinue}>{t("setup.web.done")}</AlreadyDone>
        <LegalNotice missing={legalMissing} />
        {links}
      </div>
    );
  }
  return (
    <div className="space-y-4 text-sm">
      <p className="text-muted-foreground">
        {t("setup.web.intro")}
      </p>
      <LegalNotice missing={legalMissing} />
      {links}
    </div>
  );
}

// ─── Primera venta (pedido o caja) ────────────────────────────────────────────

export function SaleStep({ count, can, onDone }: { count: number; can: (cap: string) => boolean; onDone: () => void }) {
  const { t } = useI18n();

  const cards = [
    can("bill-cash") && (
      <div key="t" className="rounded-xl border border-border p-4">
        <h3 className="font-medium text-foreground">{t("setup.sale.cashTitle")}</h3>
        <p className="mt-1 text-muted-foreground">{t("setup.sale.cashText")}</p>
        <Link href="/admin/tpv" className={`mt-3 ${linkClass}`}>
          {t("setup.sale.cashLink")}
        </Link>
      </div>
    ),
    can("shop-orders") && (
      <div key="o" className="rounded-xl border border-border p-4">
        <h3 className="font-medium text-foreground">{t("setup.sale.orderTitle")}</h3>
        <p className="mt-1 text-muted-foreground">{t("setup.sale.orderText")}</p>
        <Link href="/admin/crm?tab=reservations&nuevo=1" className={`mt-3 ${linkClass}`}>
          {t("setup.sale.orderLink")}
        </Link>
      </div>
    ),
  ].filter(Boolean);
  return (
    <div className="space-y-4 text-sm">
      {count > 0 ? (
        <AlreadyDone onContinue={onDone}>{t("setup.sale.done")}</AlreadyDone>
      ) : (
        <p className="text-muted-foreground">{t("setup.sale.intro")}</p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">{cards}</div>
    </div>
  );
}

// ─── Primer presupuesto o factura ─────────────────────────────────────────────

export function DocumentStep({ count, can, disabled, onDone }: { count: number; can: (cap: string) => boolean; disabled: boolean; onDone: () => void }) {
  const { t } = useI18n();

  const canQuotes = can("crm-quotes");
  const clients = trpc.crm.clients.list.useQuery({ limit: 1, offset: 0 }, { enabled: canQuotes && can("crm-contacts") });
  const products = trpc.products.getAll.useQuery(undefined, { enabled: canQuotes && can("shop-catalog") });
  const createQuote = trpc.crm.quotes.createDirect.useMutation({
    onSuccess: (r) => {
      toast.success(t("setup.document.draftCreated", { number: r.quoteNumber ?? "" }));
      onDone();
    },
    onError: (e) => toast.error(errMsg(e, t("setup.saveFail"))),
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
      // El precio del producto ya incluye el impuesto (como en el editor de presupuestos): total = PVP, base = PVP − IVA
      subtotal: singleLineQuoteAmounts(unit, tax).subtotal,
      taxRate: tax,
      total: singleLineQuoteAmounts(unit, tax).total,
      sendNow: false,
    });
  };
  const cards = [
    canQuotes && (
      <div key="q" className="rounded-xl border border-border p-4">
        <h3 className="font-medium text-foreground">{t("setup.document.quoteTitle")}</h3>
        <p className="mt-1 text-muted-foreground">{t("setup.document.quoteText")}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button type="button" size="sm" disabled={!canDraft || createQuote.isPending || disabled} onClick={draft}>
            {t("setup.document.draftButton")}
          </Button>
          <Link href="/admin/crm?tab=quotes&nuevo=1" className={linkClass}>
            {t("setup.document.custom")}
          </Link>
        </div>
        {!canDraft && <p className="mt-2 text-xs text-muted-foreground">{t("setup.document.needData")}</p>}
        <p className="mt-2 text-xs text-muted-foreground">{t("setup.document.notSent")}</p>
      </div>
    ),
    can("bill-invoices") && (
      <div key="i" className="rounded-xl border border-border p-4">
        <h3 className="font-medium text-foreground">{t("setup.document.invoiceTitle")}</h3>
        <p className="mt-1 text-muted-foreground">{t("setup.document.invoiceText")}</p>
        <Link href="/admin/crm?tab=invoices&nuevo=1" className={`mt-3 ${linkClass}`}>
          {t("setup.document.invoiceLink")}
        </Link>
      </div>
    ),
  ].filter(Boolean);
  return (
    <div className="space-y-4 text-sm">
      {count > 0 ? (
        <AlreadyDone onContinue={onDone}>{t("setup.document.done")}</AlreadyDone>
      ) : (
        <p className="text-muted-foreground">{t("setup.document.intro")}</p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">{cards}</div>
    </div>
  );
}

// ─── Comunicaciones ───────────────────────────────────────────────────────────

export function CommsStep({ initial, tradeName, done, can, disabled, onSaved }: { initial: { fromName: string; replyTo: string; whatsapp: string }; tradeName: string; done: boolean; can: (cap: string) => boolean; disabled: boolean; onSaved: () => void }) {
  const { t } = useI18n();

  const utils = trpc.useUtils();
  const [editing, setEditing] = useState(!done);
  const [v, setV] = useState(initial);
  const [errors, setErrors] = useState<Partial<Record<keyof typeof v, string>>>({});
  const save = trpc.setupWizard.saveComms.useMutation({
    onSuccess: async () => {
      toast.success(t("setup.comms.saved"));
      await utils.setupWizard.status.invalidate();
      onSaved();
    },
    onError: (e) => toast.error(errMsg(e, t("setup.saveFail"))),
  });
  if (!editing) {
    return (
      <AlreadyDone onContinue={onSaved} extra={<Button type="button" variant="ghost" onClick={() => setEditing(true)}><Pencil className="mr-1 h-4 w-4" aria-hidden="true" /> {t("setup.fix")}</Button>}>
        {initial.replyTo ? <>{t("setup.comms.replyBefore")} <strong>{initial.replyTo}</strong>{t("setup.comms.replyAfter")} </> : null}
        {initial.whatsapp ? <>{t("setup.comms.whatsappBefore")} <strong>{initial.whatsapp}</strong>{t("setup.comms.whatsappAfter")}</> : null}
      </AlreadyDone>
    );
  }
  const email = can("comms-email");
  const whatsapp = can("comms-whatsapp-links");
  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        const r = commsSchema.safeParse(v);
        if (!r.success) return setErrors(issues(r, "co"));
        // El paso se completa con un dato real: sin ninguno no hay nada que guardar (se puede omitir)
        if (!r.data.fromName && !r.data.replyTo && !r.data.whatsapp) {
          const first = email ? "replyTo" : "whatsapp";
          setErrors({ [first]: t("setup.comms.atLeastOne") });
          document.getElementById(`co-${first}`)?.focus();
          return;
        }
        setErrors({});
        save.mutate(r.data);
      }}
    >
      {email && (
        <>
          <p className="text-sm text-muted-foreground">{t("setup.comms.intro")}</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="co-fromName" label={t("setup.comms.fromName")} error={errors.fromName} hint={tradeName ? t("setup.comms.fromNameHint", { name: tradeName }) : undefined}>
              <Input id="co-fromName" value={v.fromName} onChange={(e) => setV((x) => ({ ...x, fromName: e.target.value }))} aria-invalid={!!errors.fromName} disabled={disabled} />
            </Field>
            <Field id="co-replyTo" label={t("setup.comms.replyTo")} error={errors.replyTo}>
              <Input id="co-replyTo" type="email" value={v.replyTo} onChange={(e) => setV((x) => ({ ...x, replyTo: e.target.value }))} aria-invalid={!!errors.replyTo} aria-describedby={describedBy("co-replyTo", errors.replyTo)} disabled={disabled} />
            </Field>
          </div>
        </>
      )}
      {whatsapp && (
        <Field id="co-whatsapp" label={t("setup.comms.whatsapp")} error={errors.whatsapp} hint={t("setup.comms.whatsappHint")}>
          <Input id="co-whatsapp" type="tel" value={v.whatsapp} onChange={(e) => setV((x) => ({ ...x, whatsapp: e.target.value }))} aria-invalid={!!errors.whatsapp} aria-describedby={describedBy("co-whatsapp", errors.whatsapp, "x")} disabled={disabled} />
        </Field>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={save.isPending || disabled}>
          {save.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden="true" />} {t("setup.saveContinue")}
        </Button>
        {email && (
          <Link href="/admin/plantillas-email" className={linkClass}>
            {t("setup.comms.viewTemplates")}
          </Link>
        )}
      </div>
    </form>
  );
}

// ─── Módulo sectorial ─────────────────────────────────────────────────────────

export function SectorStep({ modules, disabled, onDone }: { modules: Array<{ id: string; label: string; href: string | null }>; disabled: boolean; onDone: () => void }) {
  const { t, locale } = useI18n();

  return (
    <div className="space-y-4 text-sm">
      <p className="text-muted-foreground">{t("setup.sector.intro", { count: modules.length })}</p>
      <ul className="grid gap-2 sm:grid-cols-2">
        {modules.map((m) => (
          <li key={m.id} className="rounded-lg border border-border p-3">
            <p className="font-medium text-foreground">{m.label}</p>
            {m.href ? (
              <Link href={m.href} className={`mt-1 ${linkClass}`}>
                {t("setup.sector.open", { label: locale === "es" ? m.label.toLowerCase() : m.label })}
              </Link>
            ) : (
              <p className="mt-1 text-xs text-muted-foreground">{t("setup.sector.noLink")}</p>
            )}
          </li>
        ))}
      </ul>
      <Button type="button" onClick={onDone} disabled={disabled}>
        {t("setup.sector.done")}
      </Button>
    </div>
  );
}

// ─── Tu equipo (dentro de «Resumen y puesta en marcha») ───────────────────────

type InviteRole = "agente" | "admin" | "readonly";

export function TeamInvite({ disabled }: { disabled: boolean }) {
  const { t } = useI18n();

  const utils = trpc.useUtils();
  const seats = trpc.setupWizard.seats.useQuery();
  const [v, setV] = useState({ name: "", email: "", role: "agente" as InviteRole });
  const [errors, setErrors] = useState<{ name?: string; email?: string }>({});
  const invite = trpc.admin.createUser.useMutation({
    onSuccess: async () => {
      toast.success(t("setup.team.sent", { email: v.email }));
      setV({ name: "", email: "", role: "agente" });
      await Promise.all([utils.setupWizard.seats.invalidate(), utils.setupWizard.status.invalidate()]);
    },
    // El límite del plan lo decide el servidor: su mensaje se muestra tal cual
    onError: (e) => toast.error(errMsg(e, t("setup.saveFail"))),
  });
  const full = seats.data?.available === 0;
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const out: typeof errors = {};
    if (v.name.trim().length < 2) out.name = t("setup.client.nameMin");
    if (!EMAIL_RE.test(v.email.trim())) out.email = t("setup.client.emailInvalid");
    setErrors(out);
    if (Object.keys(out).length) return void document.getElementById(`us-${Object.keys(out)[0]}`)?.focus();
    invite.mutate({ name: v.name.trim(), email: v.email.trim(), role: v.role });
  };
  return (
    <form onSubmit={submit} noValidate className="space-y-3 rounded-xl border border-border p-4">
      <h3 className="text-sm font-semibold text-foreground">{t("setup.team.title")}</h3>
      {seats.data && (
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {seats.data.limit === null ? (
            <>{t("setup.team.activeUsers", { used: seats.data.used })}</>
          ) : (
            <>
              {t("setup.team.usersLabel")} <strong className="text-foreground">{seats.data.used}</strong> {t("setup.team.usersOf", { limit: seats.data.limit })}
              {full ? t("setup.team.full") : "."}
            </>
          )}
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-3">
        <Field id="us-name" label={t("setup.team.name")} error={errors.name} required>
          <Input id="us-name" value={v.name} onChange={(e) => setV((x) => ({ ...x, name: e.target.value }))} aria-invalid={!!errors.name} aria-required aria-describedby={describedBy("us-name", errors.name)} disabled={disabled || full} />
        </Field>
        <Field id="us-email" label={t("setup.team.email")} error={errors.email} required>
          <Input id="us-email" type="email" value={v.email} onChange={(e) => setV((x) => ({ ...x, email: e.target.value }))} aria-invalid={!!errors.email} aria-required aria-describedby={describedBy("us-email", errors.email)} disabled={disabled || full} />
        </Field>
        <Field id="us-role" label={t("setup.team.permissions")}>
          <select id="us-role" className={selectClass} value={v.role} onChange={(e) => setV((x) => ({ ...x, role: e.target.value as InviteRole }))} disabled={disabled || full}>
            <option value="agente">{t("setup.team.roleAgent")}</option>
            <option value="admin">{t("setup.team.roleAdmin")}</option>
            <option value="readonly">{t("setup.team.roleReadonly")}</option>
          </select>
        </Field>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="sm" disabled={invite.isPending || disabled || full}>
          {invite.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden="true" />} {t("setup.team.send")}
        </Button>
        <Link href="/admin/usuarios" className={linkClass}>
          {t("setup.team.manage")}
        </Link>
      </div>
    </form>
  );
}

// ─── Resumen y puesta en marcha ───────────────────────────────────────────────

export function FinishStep({ steps, completedAt, showTeam, disabled, onGo }: { steps: PlanStep[]; completedAt: number | null; showTeam: boolean; disabled: boolean; onGo: (s: SetupStep) => void }) {
  const { t } = useI18n();

  const labels = useStepLabels();
  const others = steps.filter((s) => s.id !== "finish" && s.id !== "welcome");
  const pending = others.filter((s) => s.status !== "done");
  return (
    <div className="space-y-5 text-sm">
      {completedAt ? (
        <p className="flex items-center gap-2 font-medium text-success">
          <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> {t("setup.finish.running")}
          {pending.length > 0 && <span className="font-normal text-muted-foreground"> {t("setup.finish.remaining", { n: pending.length })}</span>}
        </p>
      ) : pending.length === 0 ? (
        <p className="text-foreground">{t("setup.finish.allReady")}</p>
      ) : (
        <p className="text-muted-foreground">{t("setup.finish.pendingNote")}</p>
      )}
      <ul className="space-y-2">
        {others.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-3">
            <span className="flex min-w-0 items-center gap-2">
              {s.status === "done" ? (
                <CheckCircle2 className="h-4 w-4 shrink-0 text-success" aria-hidden="true" />
              ) : s.status === "skipped" ? (
                <SkipForward className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              ) : (
                <CircleDashed className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              )}
              <span className="overflow-hidden text-ellipsis whitespace-nowrap">{labels[s.id].title}</span>
              <span className="text-muted-foreground">({s.status === "done" ? t("setup.finish.done") : s.status === "skipped" ? t("setup.finish.skipped") : t("setup.finish.pending")})</span>
            </span>
            <Button type="button" size="sm" variant="outline" onClick={() => onGo(s.id)}>
              {s.status === "done" ? t("setup.finish.review") : t("setup.finish.complete")}
            </Button>
          </li>
        ))}
      </ul>
      {showTeam && <TeamInvite disabled={disabled} />}
      <div className="grid gap-2 sm:grid-cols-3">
        <Link href="/admin" className="rounded-lg border border-border p-3 text-primary hover:bg-muted">
          {t("setup.finish.goHome")}
        </Link>
        <Link href="/admin/configuracion" className="rounded-lg border border-border p-3 text-primary hover:bg-muted">
          {t("setup.finish.moreSettings")}
        </Link>
        <Link href="/admin/ampliar" className="inline-flex items-center gap-2 rounded-lg border border-border p-3 text-primary hover:bg-muted">
          <Sparkles className="h-4 w-4" aria-hidden="true" /> {t("setup.finish.expand")}
        </Link>
      </div>
    </div>
  );
}
