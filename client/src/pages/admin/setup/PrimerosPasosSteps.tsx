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
import {
  BUSINESS_ACTIVITIES, COUNTRIES, CURRENCIES, STEP_LABELS, TIMEZONES, commsSchema, configurationSteps, fiscalSchema, identitySchema, spanishFiscalErrors,
  type CompanyData, type PlanStep, type SetupStep,
} from "@shared/setupWizard";

export const errMsg = (e: unknown) => (e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message) : "No se pudo guardar");
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
  return (
    <div className="space-y-4 text-sm">
      <p className="flex items-start gap-2 rounded-lg border border-success/30 bg-success/5 p-3 text-foreground">
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden="true" />
        <span>{children}</span>
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" onClick={onContinue}>
          Continuar
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
  const rest = configurationSteps(steps);
  return (
    <div className="space-y-4 text-sm">
      <p className="text-foreground">
        {tradeName ? <>Vamos a dejar lista <strong>{tradeName}</strong> para trabajar.</> : <>Vamos a dejar tu empresa lista para trabajar.</>}{" "}
        Son {rest.length} pasos cortos{planName ? <>, adaptados a lo que incluye tu plan <strong>{planName}</strong></> : null}.
      </p>
      <ul className="grid gap-2 sm:grid-cols-2">
        {rest.map((s) => (
          <li key={s.id} className="flex items-center gap-2 rounded-lg border border-border p-2.5">
            {s.status === "done" ? (
              <CheckCircle2 className="h-4 w-4 shrink-0 text-success" aria-hidden="true" />
            ) : (
              <CircleDashed className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            )}
            <span className="min-w-0 flex-1">{STEP_LABELS[s.id].title}</span>
            {s.status === "done" && <span className="text-xs text-muted-foreground">ya está</span>}
          </li>
        ))}
      </ul>
      <p className="text-muted-foreground">
        El progreso se guarda solo: puedes salir, volver atrás o corregir cuando quieras. Ningún paso es obligatorio para usar el sistema.
      </p>
      <Button type="button" onClick={onStart} disabled={disabled}>
        Empezar
      </Button>
    </div>
  );
}

// ─── Identidad de empresa ─────────────────────────────────────────────────────

export function IdentityStep({ initial, done, disabled, onSaved }: { initial: Record<keyof CompanyData, string>; done: boolean; disabled: boolean; onSaved: () => void }) {
  const utils = trpc.useUtils();
  const [editing, setEditing] = useState(!done);
  const [v, setV] = useState({ tradeName: initial.tradeName, country: initial.country || "ES", currency: initial.currency || "EUR", timezone: initial.timezone || "Europe/Madrid" });
  const [errors, setErrors] = useState<Partial<Record<keyof typeof v, string>>>({});
  const save = trpc.setupWizard.saveIdentity.useMutation({
    onSuccess: async () => {
      toast.success("Datos de la empresa guardados");
      await utils.setupWizard.status.invalidate();
      onSaved();
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  if (!editing) {
    const country = COUNTRIES.find((c) => c.code === initial.country)?.name ?? initial.country;
    return (
      <AlreadyDone onContinue={onSaved} extra={<Button type="button" variant="ghost" onClick={() => setEditing(true)}><Pencil className="mr-1 h-4 w-4" aria-hidden="true" /> Corregir</Button>}>
        Ya consta: <strong>{initial.tradeName}</strong> · {country} · {initial.currency} · {initial.timezone.replace(/_/g, " ")}.
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
        <Field id="id-tradeName" label="Nombre comercial" error={errors.tradeName} hint="El nombre con el que te conocen tus clientes." required>
          <Input id="id-tradeName" value={v.tradeName} onChange={set("tradeName")} autoComplete="organization" aria-invalid={!!errors.tradeName} aria-required aria-describedby={describedBy("id-tradeName", errors.tradeName, "x")} disabled={disabled} />
        </Field>
        <Field id="id-country" label="País" error={errors.country} required>
          <select id="id-country" className={selectClass} value={v.country} onChange={set("country")} aria-invalid={!!errors.country} disabled={disabled}>
            {COUNTRIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field id="id-currency" label="Moneda" error={errors.currency} required>
          <select id="id-currency" className={selectClass} value={v.currency} onChange={set("currency")} aria-invalid={!!errors.currency} disabled={disabled}>
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </Field>
        <Field id="id-timezone" label="Zona horaria" error={errors.timezone} required>
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
        {save.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden="true" />} Guardar y continuar
      </Button>
    </form>
  );
}

// ─── Datos fiscales y comerciales ─────────────────────────────────────────────

type FiscalKey = "legalName" | "taxId" | "address" | "postalCode" | "city" | "province" | "publicPhone" | "publicEmail" | "publicLocation";

export function FiscalStep({ initial, country, done, fiscalFromRegistry, disabled, onSaved }: { initial: Record<keyof CompanyData, string>; country: string; done: boolean; fiscalFromRegistry: boolean; disabled: boolean; onSaved: () => void }) {
  const utils = trpc.useUtils();
  const [editing, setEditing] = useState(!done);
  const [v, setV] = useState<Record<FiscalKey, string>>({
    legalName: initial.legalName, taxId: initial.taxId, address: initial.address, postalCode: initial.postalCode, city: initial.city,
    province: initial.province, publicPhone: initial.publicPhone, publicEmail: initial.publicEmail, publicLocation: initial.publicLocation,
  });
  const [errors, setErrors] = useState<Partial<Record<FiscalKey, string>>>({});
  const save = trpc.setupWizard.saveFiscal.useMutation({
    onSuccess: async () => {
      toast.success("Datos fiscales guardados");
      await utils.setupWizard.status.invalidate();
      onSaved();
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  if (!editing) {
    return (
      <AlreadyDone onContinue={onSaved} extra={<Button type="button" variant="ghost" onClick={() => setEditing(true)}><Pencil className="mr-1 h-4 w-4" aria-hidden="true" /> Corregir o completar</Button>}>
        Ya constan tus datos fiscales: <strong>{initial.legalName}</strong> · {initial.taxId}
        {initial.address ? <> · {initial.address}</> : null}.{fiscalFromRegistry ? " Son los que figuran en tus facturas." : ""}
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
          Hemos rellenado los datos de tu alta. Si los corriges, se aplicarán a las facturas que emitas a partir de ahora; las ya emitidas conservan los datos con los que se emitieron.
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        {input("legalName", "Razón social", { required: true, hint: "Tal y como figura en el registro mercantil o en Hacienda." })}
        {input("taxId", "NIF / CIF", { required: true, hint: (country || "ES") === "ES" ? "Con su letra o dígito de control, por ejemplo B12345674." : undefined })}
        {input("address", "Dirección fiscal", { required: true, autoComplete: "street-address" })}
        {input("postalCode", "Código postal", { autoComplete: "postal-code", hint: (country || "ES") === "ES" ? "5 cifras, por ejemplo 28001." : undefined })}
        {input("city", "Ciudad", { autoComplete: "address-level2" })}
        {input("province", "Provincia", { autoComplete: "address-level1" })}
      </div>
      <h3 className="pt-2 text-sm font-semibold">Contacto público</h3>
      <p className="text-xs text-muted-foreground">Aparece en tu web y en los correos a tus clientes. Si lo dejas vacío, no se muestra.</p>
      <div className="grid gap-4 sm:grid-cols-2">
        {input("publicPhone", "Teléfono", { autoComplete: "tel" })}
        {input("publicEmail", "Email de contacto", { autoComplete: "email" })}
        {input("publicLocation", "Ubicación", { hint: "Por ejemplo, la ciudad o la dirección donde atiendes a tus clientes." })}
      </div>
      <Button type="submit" disabled={save.isPending || disabled}>
        {save.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden="true" />} Guardar y continuar
      </Button>
    </form>
  );
}

// ─── Tipo de actividad ────────────────────────────────────────────────────────

export function ActivityStep({ initial, allowed, disabled, onSaved }: { initial: string | null; allowed: string[]; disabled: boolean; onSaved: () => void }) {
  const utils = trpc.useUtils();
  const [value, setValue] = useState(initial && allowed.includes(initial) ? initial : "");
  const [error, setError] = useState<string>();
  const save = trpc.setupWizard.saveActivity.useMutation({
    onSuccess: async () => {
      await utils.setupWizard.status.invalidate();
      onSaved();
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  const options = BUSINESS_ACTIVITIES.filter((a) => allowed.includes(a.id));
  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!value) return setError("Elige el tipo que mejor describe tu negocio");
        setError(undefined);
        save.mutate({ activity: value as (typeof BUSINESS_ACTIVITIES)[number]["id"] });
      }}
    >
      <fieldset aria-describedby={error ? "act-error" : undefined}>
        <legend className="mb-2 text-sm font-medium text-foreground">¿Cómo es tu negocio?</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {options.map((a) => (
            <label key={a.id} className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm focus-within:ring-2 focus-within:ring-ring ${value === a.id ? "border-primary bg-primary/5" : "border-border"}`}>
              <input type="radio" name="actividad" value={a.id} checked={value === a.id} onChange={() => setValue(a.id)} disabled={disabled} className="mt-0.5 h-4 w-4 accent-primary" />
              <span>
                <span className="block font-medium text-foreground">{a.label}</span>
                <span className="block text-xs text-muted-foreground">{a.description}</span>
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
      <p className="text-xs text-muted-foreground">Según lo que elijas, te proponemos primero los pasos más útiles para tu negocio. Lo puedes cambiar cuando quieras.</p>
      <Button type="submit" disabled={save.isPending || disabled}>
        Guardar y continuar
      </Button>
    </form>
  );
}

// ─── CRM: primer cliente ──────────────────────────────────────────────────────

export function ClientStep({ noun, count, disabled, onDone }: { noun: string; count: number; disabled: boolean; onDone: () => void }) {
  const [v, setV] = useState({ name: "", email: "", phone: "", nif: "" });
  const [errors, setErrors] = useState<{ name?: string; email?: string }>({});
  const create = trpc.crm.clients.create.useMutation({
    onSuccess: () => {
      toast.success(`Primer ${noun} creado`);
      onDone();
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  if (count > 0) {
    return (
      <AlreadyDone onContinue={onDone} extra={<Link href="/admin/crm/clientes" className={linkClass}>Ver clientes</Link>}>
        Ya tienes {count === 1 ? `1 ${noun}` : `${count} ${noun}s`} en tu CRM.
      </AlreadyDone>
    );
  }
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const out: typeof errors = {};
    if (v.name.trim().length < 2) out.name = "Indica el nombre (mínimo 2 caracteres)";
    if (!EMAIL_RE.test(v.email.trim())) out.email = "Indica un correo válido";
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
        <Link href="/admin/crm/clientes" className={linkClass}>
          Importar o gestionar clientes
        </Link>
      </div>
    </form>
  );
}

// ─── Productos o servicios ────────────────────────────────────────────────────

export function ProductStep({ noun, example, currency, count, disabled, onDone }: { noun: string; example: string; currency: string; count: number; disabled: boolean; onDone: () => void }) {
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
      <AlreadyDone onContinue={onDone} extra={<Link href="/admin/productos/experiencias" className={linkClass}>Ver el catálogo</Link>}>
        Ya tienes {count === 1 ? "1 elemento" : `${count} elementos`} en tu catálogo.
      </AlreadyDone>
    );
  }
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
      toast.success(`Primer ${noun} creado`);
      onDone();
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
        <Field id="pr-price" label={`Precio (${currency === "EUR" ? "€" : currency}, impuestos incluidos)`} error={errors.price} required>
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
        <Link href="/admin/productos/experiencias" className={linkClass}>
          Ir al catálogo completo
        </Link>
      </div>
    </form>
  );
}

// ─── Página web ───────────────────────────────────────────────────────────────

/** Aviso de los datos fiscales que faltan para completar los textos legales de la web (no se inventa ninguno). */
function LegalNotice({ missing }: { missing: string[] }) {
  if (!missing.length) return null;
  return (
    <p role="note" className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm text-foreground">
      Tu aviso legal y tu política de privacidad ya están publicados, pero les faltan estos datos: <strong>{missing.join(", ")}</strong>. Mientras
      no los completes, esas líneas no se muestran en tu web.{" "}
      <Link href="/admin/configuracion" className="text-primary underline underline-offset-4">
        Completar datos de la empresa
      </Link>
    </p>
  );
}

export function WebStep({ done, onContinue, legalMissing = [] }: { done: boolean; onContinue: () => void; legalMissing?: string[] }) {
  const links = (
    <div className="grid gap-2 sm:grid-cols-3">
      <Link href="/admin/cms/paginas" className="rounded-lg border border-border p-3 text-sm text-primary hover:bg-muted">
        Editar mis páginas
      </Link>
      <Link href="/admin/cms/menus" className="rounded-lg border border-border p-3 text-sm text-primary hover:bg-muted">
        Ordenar el menú
      </Link>
      <a href="/" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-lg border border-border p-3 text-sm text-primary hover:bg-muted">
        Ver mi web <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
      </a>
    </div>
  );
  if (done) {
    return (
      <div className="space-y-4">
        <AlreadyDone onContinue={onContinue}>Ya has personalizado tu web. Puedes seguir editándola cuando quieras.</AlreadyDone>
        <LegalNotice missing={legalMissing} />
        {links}
      </div>
    );
  }
  return (
    <div className="space-y-4 text-sm">
      <p className="text-muted-foreground">
        Tu web ya tiene unas páginas iniciales con tu nombre y tus datos: la portada y los textos legales (aviso legal, privacidad y cookies). Revisa los textos, añade tus fotos y publica lo que quieras mostrar. Este paso se marca solo en cuanto guardes un cambio en una página.
      </p>
      <LegalNotice missing={legalMissing} />
      {links}
    </div>
  );
}

// ─── Primera venta (pedido o caja) ────────────────────────────────────────────

export function SaleStep({ count, can, onDone }: { count: number; can: (cap: string) => boolean; onDone: () => void }) {
  const cards = [
    can("bill-cash") && (
      <div key="t" className="rounded-xl border border-border p-4">
        <h3 className="font-medium text-foreground">Venta en caja</h3>
        <p className="mt-1 text-muted-foreground">Cobra en el mostrador con tu terminal de venta y cierra la caja al final del día.</p>
        <Link href="/admin/tpv" className={`mt-3 ${linkClass}`}>
          Abrir el terminal de venta
        </Link>
      </div>
    ),
    can("shop-orders") && (
      <div key="o" className="rounded-xl border border-border p-4">
        <h3 className="font-medium text-foreground">Pedido</h3>
        <p className="mt-1 text-muted-foreground">Los pedidos de tu tienda online llegan solos. También puedes registrar uno a mano.</p>
        <Link href="/admin/crm?tab=reservations&nuevo=1" className={`mt-3 ${linkClass}`}>
          Registrar un pedido
        </Link>
      </div>
    ),
  ].filter(Boolean);
  return (
    <div className="space-y-4 text-sm">
      {count > 0 ? (
        <AlreadyDone onContinue={onDone}>Ya has registrado tu primera venta. Desde aquí tienes los accesos para seguir vendiendo.</AlreadyDone>
      ) : (
        <p className="text-muted-foreground">Elige cómo vas a registrar tu primera venta. Este paso se marca solo en cuanto cobres una venta en caja o registres un pedido.</p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">{cards}</div>
    </div>
  );
}

// ─── Primer presupuesto o factura ─────────────────────────────────────────────

export function DocumentStep({ count, can, disabled, onDone }: { count: number; can: (cap: string) => boolean; disabled: boolean; onDone: () => void }) {
  const canQuotes = can("crm-quotes");
  const clients = trpc.crm.clients.list.useQuery({ limit: 1, offset: 0 }, { enabled: canQuotes && can("crm-contacts") });
  const products = trpc.products.getAll.useQuery(undefined, { enabled: canQuotes && can("shop-catalog") });
  const createQuote = trpc.crm.quotes.createDirect.useMutation({
    onSuccess: (r) => {
      toast.success(`Presupuesto ${r.quoteNumber ?? ""} creado como borrador`);
      onDone();
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
        <h3 className="font-medium text-foreground">Presupuesto</h3>
        <p className="mt-1 text-muted-foreground">Una propuesta que el cliente acepta antes de pagar.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button type="button" size="sm" disabled={!canDraft || createQuote.isPending || disabled} onClick={draft}>
            Crear borrador con mi primer cliente y producto
          </Button>
          <Link href="/admin/crm?tab=quotes&nuevo=1" className={linkClass}>
            Presupuesto a medida
          </Link>
        </div>
        {!canDraft && <p className="mt-2 text-xs text-muted-foreground">Para el borrador automático necesitas un cliente y un producto.</p>}
        <p className="mt-2 text-xs text-muted-foreground">El borrador no se envía al cliente.</p>
      </div>
    ),
    can("bill-invoices") && (
      <div key="i" className="rounded-xl border border-border p-4">
        <h3 className="font-medium text-foreground">Factura</h3>
        <p className="mt-1 text-muted-foreground">Con tu numeración y tus datos fiscales.</p>
        <Link href="/admin/crm?tab=invoices&nuevo=1" className={`mt-3 ${linkClass}`}>
          Emitir una factura
        </Link>
      </div>
    ),
  ].filter(Boolean);
  return (
    <div className="space-y-4 text-sm">
      {count > 0 ? (
        <AlreadyDone onContinue={onDone}>Ya tienes tu primer presupuesto o factura. Desde aquí tienes los accesos a cada uno.</AlreadyDone>
      ) : (
        <p className="text-muted-foreground">Prepara tu primer presupuesto o emite tu primera factura. Este paso se marca solo en cuanto exista el primero.</p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">{cards}</div>
    </div>
  );
}

// ─── Comunicaciones ───────────────────────────────────────────────────────────

export function CommsStep({ initial, tradeName, done, can, disabled, onSaved }: { initial: { fromName: string; replyTo: string; whatsapp: string }; tradeName: string; done: boolean; can: (cap: string) => boolean; disabled: boolean; onSaved: () => void }) {
  const utils = trpc.useUtils();
  const [editing, setEditing] = useState(!done);
  const [v, setV] = useState(initial);
  const [errors, setErrors] = useState<Partial<Record<keyof typeof v, string>>>({});
  const save = trpc.setupWizard.saveComms.useMutation({
    onSuccess: async () => {
      toast.success("Correo de la empresa guardado");
      await utils.setupWizard.status.invalidate();
      onSaved();
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  if (!editing) {
    return (
      <AlreadyDone onContinue={onSaved} extra={<Button type="button" variant="ghost" onClick={() => setEditing(true)}><Pencil className="mr-1 h-4 w-4" aria-hidden="true" /> Corregir</Button>}>
        {initial.replyTo ? <>Las respuestas de tus clientes llegan a <strong>{initial.replyTo}</strong>. </> : null}
        {initial.whatsapp ? <>Tu web muestra el WhatsApp <strong>{initial.whatsapp}</strong>.</> : null}
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
          setErrors({ [first]: "Indica al menos un dato, o pulsa «Omitir por ahora»." });
          document.getElementById(`co-${first}`)?.focus();
          return;
        }
        setErrors({});
        save.mutate(r.data);
      }}
    >
      {email && (
        <>
          <p className="text-sm text-muted-foreground">Los avisos a tus clientes (presupuestos, pedidos, facturas) salen con el nombre de tu empresa. Indica dónde quieres recibir sus respuestas.</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="co-fromName" label="Nombre que verán tus clientes" error={errors.fromName} hint={tradeName ? `Si lo dejas vacío, se usa «${tradeName}».` : undefined}>
              <Input id="co-fromName" value={v.fromName} onChange={(e) => setV((x) => ({ ...x, fromName: e.target.value }))} aria-invalid={!!errors.fromName} disabled={disabled} />
            </Field>
            <Field id="co-replyTo" label="Correo para recibir las respuestas" error={errors.replyTo}>
              <Input id="co-replyTo" type="email" value={v.replyTo} onChange={(e) => setV((x) => ({ ...x, replyTo: e.target.value }))} aria-invalid={!!errors.replyTo} aria-describedby={describedBy("co-replyTo", errors.replyTo)} disabled={disabled} />
            </Field>
          </div>
        </>
      )}
      {whatsapp && (
        <Field id="co-whatsapp" label="WhatsApp de atención" error={errors.whatsapp} hint="Aparece como botón de contacto en tu web. Déjalo vacío si no quieres mostrarlo.">
          <Input id="co-whatsapp" type="tel" value={v.whatsapp} onChange={(e) => setV((x) => ({ ...x, whatsapp: e.target.value }))} aria-invalid={!!errors.whatsapp} aria-describedby={describedBy("co-whatsapp", errors.whatsapp, "x")} disabled={disabled} />
        </Field>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={save.isPending || disabled}>
          {save.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden="true" />} Guardar y continuar
        </Button>
        {email && (
          <Link href="/admin/plantillas-email" className={linkClass}>
            Ver los textos de los correos
          </Link>
        )}
      </div>
    </form>
  );
}

// ─── Módulo sectorial ─────────────────────────────────────────────────────────

export function SectorStep({ modules, disabled, onDone }: { modules: Array<{ id: string; label: string; href: string | null }>; disabled: boolean; onDone: () => void }) {
  return (
    <div className="space-y-4 text-sm">
      <p className="text-muted-foreground">Tienes contratado {modules.length === 1 ? "este módulo" : "estos módulos"} para tu sector. Empieza por su configuración básica:</p>
      <ul className="grid gap-2 sm:grid-cols-2">
        {modules.map((m) => (
          <li key={m.id} className="rounded-lg border border-border p-3">
            <p className="font-medium text-foreground">{m.label}</p>
            {m.href ? (
              <Link href={m.href} className={`mt-1 ${linkClass}`}>
                Abrir {m.label.toLowerCase()}
              </Link>
            ) : (
              <p className="mt-1 text-xs text-muted-foreground">Tu responsable de implantación te acompañará en su puesta en marcha.</p>
            )}
          </li>
        ))}
      </ul>
      <Button type="button" onClick={onDone} disabled={disabled}>
        Hecho, continuar
      </Button>
    </div>
  );
}

// ─── Tu equipo (dentro de «Resumen y puesta en marcha») ───────────────────────

type InviteRole = "agente" | "admin" | "readonly";

export function TeamInvite({ disabled }: { disabled: boolean }) {
  const utils = trpc.useUtils();
  const seats = trpc.setupWizard.seats.useQuery();
  const [v, setV] = useState({ name: "", email: "", role: "agente" as InviteRole });
  const [errors, setErrors] = useState<{ name?: string; email?: string }>({});
  const invite = trpc.admin.createUser.useMutation({
    onSuccess: async () => {
      toast.success(`Invitación enviada a ${v.email}`);
      setV({ name: "", email: "", role: "agente" });
      await Promise.all([utils.setupWizard.seats.invalidate(), utils.setupWizard.status.invalidate()]);
    },
    // El límite del plan lo decide el servidor: su mensaje se muestra tal cual
    onError: (e) => toast.error(errMsg(e)),
  });
  const full = seats.data?.available === 0;
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const out: typeof errors = {};
    if (v.name.trim().length < 2) out.name = "Indica el nombre (mínimo 2 caracteres)";
    if (!EMAIL_RE.test(v.email.trim())) out.email = "Indica un correo válido";
    setErrors(out);
    if (Object.keys(out).length) return void document.getElementById(`us-${Object.keys(out)[0]}`)?.focus();
    invite.mutate({ name: v.name.trim(), email: v.email.trim(), role: v.role });
  };
  return (
    <form onSubmit={submit} noValidate className="space-y-3 rounded-xl border border-border p-4">
      <h3 className="text-sm font-semibold text-foreground">Invita a tu equipo (opcional)</h3>
      {seats.data && (
        <p className="text-xs text-muted-foreground" aria-live="polite">
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
      <div className="grid gap-3 sm:grid-cols-3">
        <Field id="us-name" label="Nombre" error={errors.name} required>
          <Input id="us-name" value={v.name} onChange={(e) => setV((x) => ({ ...x, name: e.target.value }))} aria-invalid={!!errors.name} aria-required aria-describedby={describedBy("us-name", errors.name)} disabled={disabled || full} />
        </Field>
        <Field id="us-email" label="Correo electrónico" error={errors.email} required>
          <Input id="us-email" type="email" value={v.email} onChange={(e) => setV((x) => ({ ...x, email: e.target.value }))} aria-invalid={!!errors.email} aria-required aria-describedby={describedBy("us-email", errors.email)} disabled={disabled || full} />
        </Field>
        <Field id="us-role" label="Permisos">
          <select id="us-role" className={selectClass} value={v.role} onChange={(e) => setV((x) => ({ ...x, role: e.target.value as InviteRole }))} disabled={disabled || full}>
            <option value="agente">Empleado</option>
            <option value="admin">Administrador</option>
            <option value="readonly">Solo lectura</option>
          </select>
        </Field>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="sm" disabled={invite.isPending || disabled || full}>
          {invite.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden="true" />} Enviar invitación
        </Button>
        <Link href="/admin/usuarios" className={linkClass}>
          Gestionar usuarios
        </Link>
      </div>
    </form>
  );
}

// ─── Resumen y puesta en marcha ───────────────────────────────────────────────

export function FinishStep({ steps, completedAt, showTeam, disabled, onGo }: { steps: PlanStep[]; completedAt: number | null; showTeam: boolean; disabled: boolean; onGo: (s: SetupStep) => void }) {
  const others = steps.filter((s) => s.id !== "finish" && s.id !== "welcome");
  const pending = others.filter((s) => s.status !== "done");
  return (
    <div className="space-y-5 text-sm">
      {completedAt ? (
        <p className="flex items-center gap-2 font-medium text-success">
          <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> Tu empresa está en marcha.
          {pending.length > 0 && <span className="font-normal text-muted-foreground"> Te queda{pending.length === 1 ? "" : "n"} {pending.length} paso{pending.length === 1 ? "" : "s"} opcional{pending.length === 1 ? "" : "es"}.</span>}
        </p>
      ) : pending.length === 0 ? (
        <p className="text-foreground">Lo tienes todo listo. Pon tu empresa en marcha cuando quieras.</p>
      ) : (
        <p className="text-muted-foreground">Repasa lo que queda. Puedes ponerte en marcha ahora y completarlo más tarde: nada de esto bloquea el uso del sistema.</p>
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
              <span className="overflow-hidden text-ellipsis whitespace-nowrap">{STEP_LABELS[s.id].title}</span>
              <span className="text-muted-foreground">({s.status === "done" ? "hecho" : s.status === "skipped" ? "omitido" : "pendiente"})</span>
            </span>
            <Button type="button" size="sm" variant="outline" onClick={() => onGo(s.id)}>
              {s.status === "done" ? "Revisar" : "Completar"}
            </Button>
          </li>
        ))}
      </ul>
      {showTeam && <TeamInvite disabled={disabled} />}
      <div className="grid gap-2 sm:grid-cols-3">
        <Link href="/admin" className="rounded-lg border border-border p-3 text-primary hover:bg-muted">
          Ir al inicio
        </Link>
        <Link href="/admin/configuracion" className="rounded-lg border border-border p-3 text-primary hover:bg-muted">
          Más ajustes
        </Link>
        <Link href="/admin/ampliar" className="inline-flex items-center gap-2 rounded-lg border border-border p-3 text-primary hover:bg-muted">
          <Sparkles className="h-4 w-4" aria-hidden="true" /> Ampliar Elephant Core
        </Link>
      </div>
    </div>
  );
}
