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
import { useI18n } from "@/i18n/I18nProvider";

type Values = Record<keyof CompanyFields, string>;

/** Datos fiscales opcionales de las facturas (ajustes de la empresa). */
const EXTRA_KEYS = [
  { key: "site_legal_email", label: "settingsCompany.extra.email", validate: validateEmail, autoComplete: "email" },
  { key: "site_legal_phone", label: "settingsCompany.extra.phone", validate: validatePhone, autoComplete: "tel" },
  { key: "site_legal_iban", label: "settingsCompany.extra.iban", validate: validateIban, autoComplete: "off" },
] as const;

const selectClass = "h-11 sm:h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-60";

function errMsg(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback;
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
  const { t, format } = useI18n();
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
      toast.success(t("settingsCompany.saved"));
      await utils.setupWizard.status.invalidate();
    },
    onError: (e) => toast.error(errMsg(e, t("settingsCompany.saveFailed"))),
  });
  const saveExtra = trpc.config.updateSystemSetting.useMutation();

  if (status.isError) {
    return <PanelError error={status.error} onRetry={() => status.refetch()} title={t("settingsCompany.loadError")} />;
  }
  if (!v || !extra) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" aria-label={t("settingsCompany.loading")} />
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
      toast.error(errMsg(err, t("settingsCompany.saveFailed")));
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
            <h2 id="co-issuer-title" className="text-sm font-medium text-foreground">{t("settingsCompany.issuer.title")}</h2>
            <p className="break-words text-foreground/80">
              <strong>{issuer.name || t("settingsCompany.issuer.noName")}</strong>
              {issuer.taxId ? <> · {t("settingsCompany.issuer.taxId", { taxId: issuer.taxId })}</> : null}
              {issuer.address ? <> · {issuer.address}</> : null}
            </p>
            <p>
              {issuer.fromSignup
                ? t("settingsCompany.issuer.fromSignup")
                : t("settingsCompany.issuer.savedOn", { date: format.dateTime(issuer.since!, { dateStyle: "long", timeStyle: "short" }) })}
              {" "}{t("settingsCompany.issuer.keep")}
            </p>
          </div>
        </section>
      )}
      {readOnly && (
        <p role="status" className="rounded-lg border border-warning/30 bg-warning/10 p-3 text-xs text-warning">
          {t("settingsCompany.readOnly")}
        </p>
      )}

      <section className="bg-card border border-border/50 rounded-2xl p-4 sm:p-6 space-y-4">
        <h2 className="text-base font-semibold">{t("settingsCompany.company.title")}</h2>
        <p className="text-xs text-muted-foreground">{t("settingsCompany.company.intro")}</p>
        <div className="grid gap-4 sm:grid-cols-2">
          {input("tradeName", t("settingsCompany.company.tradeName"), { required: true, autoComplete: "organization" })}
          {input("legalName", t("settingsCompany.company.legalName"), { required: true, hint: t("settingsCompany.company.legalNameHint") })}
          {input("taxId", t("settingsCompany.company.taxId"), { required: true, hint: v.country === "ES" ? t("settingsCompany.company.taxIdHint") : undefined })}
          {input("address", t("settingsCompany.company.address"), { required: true, autoComplete: "street-address" })}
          {input("postalCode", t("settingsCompany.company.postalCode"), { autoComplete: "postal-code", hint: v.country === "ES" ? t("settingsCompany.company.postalCodeHint") : undefined })}
          {input("city", t("settingsCompany.company.city"), { autoComplete: "address-level2" })}
          {input("province", t("settingsCompany.company.province"), { autoComplete: "address-level1" })}
          <Field id="co-country" label={t("settingsCompany.company.country")} error={errors.country} required>
            <select id="co-country" className={selectClass} value={v.country} onChange={set("country")} aria-invalid={!!errors.country} disabled={readOnly}>
              {COUNTRIES.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
            </select>
          </Field>
          <Field id="co-currency" label={t("settingsCompany.company.currency")} error={errors.currency} required>
            <select id="co-currency" className={selectClass} value={v.currency} onChange={set("currency")} aria-invalid={!!errors.currency} disabled={readOnly}>
              {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
          <Field id="co-timezone" label={t("settingsCompany.company.timezone")} error={errors.timezone} required>
            <select id="co-timezone" className={selectClass} value={v.timezone} onChange={set("timezone")} aria-invalid={!!errors.timezone} disabled={readOnly}>
              {TIMEZONES.map((tz) => <option key={tz} value={tz}>{tz.replace(/_/g, " ")}</option>)}
            </select>
          </Field>
        </div>
      </section>

      <section className="bg-card border border-border/50 rounded-2xl p-4 sm:p-6 space-y-4">
        <h2 className="text-base font-semibold">{t("settingsCompany.contact.title")}</h2>
        <p className="text-xs text-muted-foreground">{t("settingsCompany.contact.intro")}</p>
        <div className="grid gap-4 sm:grid-cols-2">
          {input("publicPhone", t("settingsCompany.contact.phone"), { autoComplete: "tel", type: "tel" })}
          {input("publicEmail", t("settingsCompany.contact.email"), { autoComplete: "email", type: "email" })}
          {input("publicLocation", t("settingsCompany.contact.location"), { hint: t("settingsCompany.contact.locationHint") })}
        </div>
      </section>

      {EXTRA_KEYS.some((x) => x.key in extra) && (
        <section className="bg-card border border-border/50 rounded-2xl p-4 sm:p-6 space-y-4">
          <h2 className="text-base font-semibold">{t("settingsCompany.invoiceContact.title")}</h2>
          <p className="text-xs text-muted-foreground">{t("settingsCompany.invoiceContact.intro")}</p>
          <div className="grid gap-4 sm:grid-cols-2">
            {EXTRA_KEYS.filter((x) => x.key in extra).map((x) => (
              <Field key={x.key} id={`ex-${x.key}`} label={t(x.label)} error={extraErrors[x.key] ?? undefined}>
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
          {t("settingsCompany.save")}
        </Button>
        <p className="text-xs text-muted-foreground">
          {t("settingsCompany.sameData.a")}<Link href="/admin/primeros-pasos" className="underline underline-offset-4">{t("settingsCompany.firstSteps")}</Link>{t("settingsCompany.sameData.b")}
        </p>
      </div>
    </form>
  );
}
