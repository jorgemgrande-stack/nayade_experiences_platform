/**
 * «Datos de la empresa»: pantalla única de los datos de empresa en modo pyme.
 *
 * Lee y guarda exactamente los mismos campos que el paso «Datos de la empresa» del asistente «Primeros pasos»
 * (setupWizard.status / setupWizard.saveCompany → ajustes de la empresa, COMPANY_SETTING_KEYS). No hay otro
 * almacenamiento: lo que se cambia aquí lo ve el asistente y lo usan presupuestos, facturas y tickets.
 * Los datos de contacto fiscal opcionales (email, teléfono e IBAN de las facturas) son ajustes de la empresa.
 * Lo que se guarda aquí manda sobre los datos del alta en los documentos que se emitan desde ese momento; las facturas
 * ya emitidas conservan su copia del emisor.
 */
import { useEffect, useState } from "react";
import { Link } from "wouter";
import { toast } from "sonner";
import { Loader2, Info, Save } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PanelError } from "@/components/admin/PanelStates";
import { COUNTRIES, CURRENCIES, TIMEZONES, companySchema, spanishFiscalErrors, type CompanyData as CompanyFields } from "@shared/setupWizard";
import { validateEmail, validateIban, validatePhone } from "@shared/formValidation";

type Values = Record<keyof CompanyFields, string>;

/** Datos fiscales opcionales de las facturas (ajustes de la empresa). */
const EXTRA_KEYS = [
  { key: "site_legal_email", label: "Email para facturas", validate: validateEmail, autoComplete: "email" },
  { key: "site_legal_phone", label: "Teléfono para facturas", validate: validatePhone, autoComplete: "tel" },
  { key: "site_legal_iban", label: "IBAN", validate: validateIban, autoComplete: "off" },
] as const;

const selectClass = "h-11 sm:h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-60";

function errMsg(e: unknown): string {
  return e instanceof Error && e.message ? e.message : "No se han podido guardar los datos. Inténtalo de nuevo.";
}

function Field({ id, label, error, hint, required, children }: { id: string; label: string; error?: string; hint?: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-sm font-medium text-foreground/80">
        {label}
        {required && <span className="text-destructive" aria-hidden="true"> *</span>}
      </Label>
      {children}
      {hint && <p id={`${id}-hint`} className="text-xs text-muted-foreground">{hint}</p>}
      {error && <p id={`${id}-error`} className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

const describedBy = (id: string, error?: string, hint?: string) => [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(" ") || undefined;

export default function CompanyData() {
  const utils = trpc.useUtils();
  const status = trpc.setupWizard.status.useQuery(undefined, { retry: false });
  const settingsQ = trpc.config.listSystemSettings.useQuery();
  const readOnly = !!status.data?.licence?.readOnly;

  const [v, setV] = useState<Values | null>(null);
  const [errors, setErrors] = useState<Partial<Record<keyof CompanyFields, string>>>({});
  useEffect(() => {
    if (!status.data || v) return;
    const c = status.data.company as Values;
    setV({ ...c, country: c.country || "ES", currency: c.currency || "EUR", timezone: c.timezone || "Europe/Madrid" });
  }, [status.data, v]);

  const [extra, setExtra] = useState<Record<string, string> | null>(null);
  useEffect(() => {
    if (!settingsQ.data || extra) return;
    const out: Record<string, string> = {};
    for (const x of EXTRA_KEYS) {
      const row = settingsQ.data.find((s) => s.key === x.key);
      if (row) out[x.key] = row.value ?? "";
    }
    setExtra(out);
  }, [settingsQ.data, extra]);

  const save = trpc.setupWizard.saveCompany.useMutation({
    onSuccess: async () => {
      toast.success("Datos de la empresa guardados. Se aplicarán a las facturas que emitas a partir de ahora.");
      await utils.setupWizard.status.invalidate();
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  const saveExtra = trpc.config.updateSystemSetting.useMutation();

  if (status.isError) {
    return <PanelError error={status.error} onRetry={() => status.refetch()} title="No se han podido cargar los datos de la empresa" />;
  }
  if (!v || !extra) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" aria-label="Cargando" />
      </div>
    );
  }

  const set = (k: keyof CompanyFields) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setV((x) => (x ? { ...x, [k]: e.target.value } : x));
  const extraErrors: Record<string, string | null> = Object.fromEntries(EXTRA_KEYS.map((x) => [x.key, x.key in extra ? x.validate(extra[x.key] ?? "") : null]));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const r = companySchema.safeParse(v);
    if (!r.success) {
      const out: Partial<Record<keyof CompanyFields, string>> = {};
      for (const i of r.error.issues) out[i.path[0] as keyof CompanyFields] ??= i.message;
      setErrors(out);
      const first = Object.keys(out)[0];
      if (first) document.getElementById(`co-${first}`)?.focus();
      return;
    }
    // Empresa española: NIF/CIF con su dígito de control y código postal real (el servidor lo vuelve a comprobar)
    const es = spanishFiscalErrors(r.data.country, r.data);
    // El NIF de la entidad fiscal registrada (el de las facturas) se acepta tal cual, como en el servidor
    if (status.data?.fiscalFromRegistry && r.data.taxId === (status.data.company.taxId ?? "").trim().toUpperCase()) delete es.taxId;
    if (es.taxId || es.postalCode) {
      setErrors(es);
      document.getElementById(`co-${es.taxId ? "taxId" : "postalCode"}`)?.focus();
      return;
    }
    if (Object.values(extraErrors).some(Boolean)) return;
    setErrors({});
    try {
      await save.mutateAsync(r.data);
    } catch {
      return; // el aviso lo muestra onError
    }
    try {
      const rows = settingsQ.data ?? [];
      for (const x of EXTRA_KEYS) {
        if (!(x.key in extra)) continue;
        const before = rows.find((s) => s.key === x.key)?.value ?? "";
        if ((extra[x.key] ?? "") !== before) await saveExtra.mutateAsync({ key: x.key, value: extra[x.key] ?? "" });
      }
      await utils.config.listSystemSettings.invalidate();
      await utils.setupWizard.status.invalidate();
    } catch (err) {
      toast.error(errMsg(err));
    }
  };

  const input = (k: keyof CompanyFields, label: string, o: { required?: boolean; hint?: string; autoComplete?: string; type?: string } = {}) => (
    <Field id={`co-${k}`} label={label} error={errors[k]} hint={o.hint} required={o.required}>
      <Input
        id={`co-${k}`}
        type={o.type}
        value={v[k]}
        onChange={set(k)}
        autoComplete={o.autoComplete}
        aria-invalid={!!errors[k]}
        aria-required={o.required}
        aria-describedby={describedBy(`co-${k}`, errors[k], o.hint)}
        disabled={readOnly}
        className="h-11 sm:h-9"
      />
    </Field>
  );
  const pending = save.isPending || saveExtra.isPending;
  const issuer = status.data?.issuer ?? null;

  return (
    <form onSubmit={submit} noValidate className="space-y-6">
      {issuer && (
        <section aria-labelledby="co-issuer-title" className="flex gap-3 rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
          <Info className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
          <div className="min-w-0 space-y-1">
            <h2 id="co-issuer-title" className="text-sm font-medium text-foreground">Datos que figuran en tus documentos</h2>
            <p className="break-words text-foreground/80">
              <strong>{issuer.name || "Sin razón social"}</strong>
              {issuer.taxId ? <> · NIF {issuer.taxId}</> : null}
              {issuer.address ? <> · {issuer.address}</> : null}
            </p>
            <p>
              {issuer.fromSignup
                ? "Son los de tu alta. Si los corriges y guardas, se aplicarán a las facturas, abonos y tickets que emitas a partir de ahora."
                : `Guardados el ${new Date(issuer.since!).toLocaleString("es-ES", { dateStyle: "long", timeStyle: "short" })}. Se aplican a las facturas, abonos y tickets que emitas a partir de ahora.`}
              {" "}Las facturas ya emitidas conservan los datos con los que se emitieron. También aparecen en el aviso legal y la política de privacidad de tu web.
            </p>
          </div>
        </section>
      )}
      {readOnly && (
        <p role="status" className="rounded-lg border border-warning/30 bg-warning/10 p-3 text-xs text-warning">
          Tu suscripción está en solo lectura: puedes consultar los datos, pero no cambiarlos.
        </p>
      )}

      <section className="bg-card border border-border/50 rounded-2xl p-4 sm:p-6 space-y-4">
        <h2 className="text-base font-semibold">Empresa</h2>
        <p className="text-xs text-muted-foreground">Aparecen en tus presupuestos, facturas y tickets, y en el aviso legal y la política de privacidad de tu web.</p>
        <div className="grid gap-4 sm:grid-cols-2">
          {input("tradeName", "Nombre comercial", { required: true, autoComplete: "organization" })}
          {input("legalName", "Razón social", { required: true, hint: "Tal y como figura en el registro mercantil o en Hacienda." })}
          {input("taxId", "NIF / CIF", { required: true, hint: v.country === "ES" ? "Con su letra o dígito de control, por ejemplo B12345674." : undefined })}
          {input("address", "Dirección fiscal", { required: true, autoComplete: "street-address" })}
          {input("postalCode", "Código postal", { autoComplete: "postal-code", hint: v.country === "ES" ? "5 cifras, por ejemplo 28001." : undefined })}
          {input("city", "Ciudad", { autoComplete: "address-level2" })}
          {input("province", "Provincia", { autoComplete: "address-level1" })}
          <Field id="co-country" label="País" error={errors.country} required>
            <select id="co-country" className={selectClass} value={v.country} onChange={set("country")} aria-invalid={!!errors.country} disabled={readOnly}>
              {COUNTRIES.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
            </select>
          </Field>
          <Field id="co-currency" label="Moneda" error={errors.currency} required>
            <select id="co-currency" className={selectClass} value={v.currency} onChange={set("currency")} aria-invalid={!!errors.currency} disabled={readOnly}>
              {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
          <Field id="co-timezone" label="Zona horaria" error={errors.timezone} required>
            <select id="co-timezone" className={selectClass} value={v.timezone} onChange={set("timezone")} aria-invalid={!!errors.timezone} disabled={readOnly}>
              {TIMEZONES.map((t) => <option key={t} value={t}>{t.replace(/_/g, " ")}</option>)}
            </select>
          </Field>
        </div>
      </section>

      <section className="bg-card border border-border/50 rounded-2xl p-4 sm:p-6 space-y-4">
        <h2 className="text-base font-semibold">Contacto público</h2>
        <p className="text-xs text-muted-foreground">Aparece en tu web y en los correos a tus clientes. Si lo dejas vacío, no se muestra.</p>
        <div className="grid gap-4 sm:grid-cols-2">
          {input("publicPhone", "Teléfono", { autoComplete: "tel", type: "tel" })}
          {input("publicEmail", "Email de contacto", { autoComplete: "email", type: "email" })}
          {input("publicLocation", "Ubicación", { hint: "Por ejemplo, la ciudad o la dirección donde atiendes a tus clientes." })}
        </div>
      </section>

      {EXTRA_KEYS.some((x) => x.key in extra) && (
        <section className="bg-card border border-border/50 rounded-2xl p-4 sm:p-6 space-y-4">
          <h2 className="text-base font-semibold">Datos de contacto en las facturas</h2>
          <p className="text-xs text-muted-foreground">Opcionales. Si los dejas vacíos, las facturas no los muestran.</p>
          <div className="grid gap-4 sm:grid-cols-2">
            {EXTRA_KEYS.filter((x) => x.key in extra).map((x) => (
              <Field key={x.key} id={`ex-${x.key}`} label={x.label} error={extraErrors[x.key] ?? undefined}>
                <Input
                  id={`ex-${x.key}`}
                  value={extra[x.key] ?? ""}
                  onChange={(e) => setExtra((p) => ({ ...(p ?? {}), [x.key]: e.target.value }))}
                  autoComplete={x.autoComplete}
                  aria-invalid={!!extraErrors[x.key]}
                  aria-describedby={describedBy(`ex-${x.key}`, extraErrors[x.key] ?? undefined)}
                  disabled={readOnly}
                  className="h-11 sm:h-9"
                />
              </Field>
            ))}
          </div>
        </section>
      )}

      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <Button type="submit" disabled={pending || readOnly} className="h-11 sm:h-10">
          {pending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden="true" /> : <Save className="mr-1 h-4 w-4" aria-hidden="true" />}
          Guardar
        </Button>
        <p className="text-xs text-muted-foreground">
          Son los mismos datos que pide <Link href="/admin/primeros-pasos" className="underline underline-offset-4">Primeros pasos</Link>.
        </p>
      </div>
    </form>
  );
}
