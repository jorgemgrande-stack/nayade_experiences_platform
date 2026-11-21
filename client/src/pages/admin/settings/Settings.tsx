import { useState, useEffect, useRef, useCallback, useId, cloneElement, isValidElement } from "react";
import AdminLayout from "@/components/AdminLayout";
import { usePanelSubscription } from "@/hooks/usePanelSubscription";
import { PanelError } from "@/components/admin/PanelStates";
import { validateEmail, validateFiscalData, validatePhone, validateUrl, type FiscalData } from "@shared/formValidation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import {
  Globe, Phone, Mail, Clock,
  CreditCard, Loader2, Info, Building2, Check,
} from "lucide-react";
import CompanyData from "./CompanyData";
import SearchIndexingToggle from "./SearchIndexingToggle";
import { useI18n } from "@/i18n/I18nProvider";

// ─── Sidebar tab definitions ──────────────────────────────────────────────────
const TABS = [
  { id: "business",      label: "settingsGeneral.tabs.business",      icon: Globe },
  { id: "schedule",      label: "settingsGeneral.tabs.schedule",      icon: Clock },
  { id: "payments",      label: "settingsGeneral.tabs.payments",      icon: CreditCard },
  { id: "legalCompany",  label: "settingsGeneral.tabs.legalCompany",  icon: Building2 },
  { id: "notifications", label: "settingsGeneral.tabs.notifications", icon: Mail },
] as const;

type Tab = typeof TABS[number]["id"];

// ─── Field helper ─────────────────────────────────────────────────────────────
// Asocia la etiqueta, la ayuda y el error al control (accesibilidad: label + aria-describedby).
function Field({ label, hint, error, children, col2 = false }: {
  label: string; hint?: string; error?: string | null; children: React.ReactNode; col2?: boolean;
}) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;
  const control = isValidElement(children)
    ? cloneElement(children as React.ReactElement<Record<string, unknown>>, {
        id,
        "aria-describedby": describedBy,
        "aria-invalid": error ? true : undefined,
      })
    : children;
  return (
    <div className={col2 ? "sm:col-span-2" : ""}>
      <Label htmlFor={id} className="text-sm font-display font-medium text-foreground/80">{label}</Label>
      <div className="mt-1.5">{control}</div>
      {hint && <p id={hintId} className="text-xs text-muted-foreground mt-1">{hint}</p>}
      {error && <p id={errorId} className="text-xs text-destructive mt-1">{error}</p>}
    </div>
  );
}

// ─── Auto-save indicator ──────────────────────────────────────────────────────
function AutoSaveStatus({ saving }: { saving: boolean }) {
  const { t } = useI18n();
  return (
    <div className="flex items-center gap-1.5 pt-4 border-t border-border/20 text-xs text-muted-foreground">
      {saving
        ? <><Loader2 className="w-3 h-3 animate-spin" /> {t("settingsGeneral.autoSave.saving")}</>
        : <><Check className="w-3 h-3 text-success" /> {t("settingsGeneral.autoSave.saved")}</>
      }
    </div>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────
export default function Settings() {
  const { t } = useI18n();
  // Empresas con licencias por capacidad: una sola pantalla «Datos de la empresa» con los mismos
  // datos que el asistente «Primeros pasos» (ver CompanyData). En single, la pantalla de siempre.
  const sub = usePanelSubscription();
  const { data: rawSettings, isLoading, isError, error: loadError, refetch } = trpc.cms.getSiteSettings.useQuery(undefined, { enabled: sub.mode === "legacy" });
  const isNewCompany = sub.isLicensed;
  const hasRestaurants = sub.can("restaurant-net");
  // Valores por defecto de la instalación original solo en modo single (Náyade); en cualquier otro
  // caso (multiempresa o estado desconocido) lo no guardado empieza vacío.
  const blankDefaults = sub.data?.mode !== "single";
  const updateMutation = trpc.cms.updateSiteSettings.useMutation({
    onSuccess: () => toast.success(t("settingsGeneral.saved")),
    onError: (e) => toast.error(t("settingsGeneral.saveError", { message: e.message })),
  });

  const [activeTab, setActiveTab] = useState<Tab>("business");

  const [business, setBusiness] = useState({
    businessName: "",
    businessPhone: "",
    businessEmail: "",
    businessAddress: "",
    businessDescription: "",
    businessWebsite: "",
  });

  const [schedule, setSchedule] = useState({
    scheduleHighOpen: "10:00",
    scheduleHighClose: "20:00",
    scheduleLowOpen: "10:00",
    scheduleLowClose: "18:00",
    scheduleDays: "",
  });

  const [payments, setPayments] = useState({
    paymentVat: "21",
    paymentCurrency: "EUR",
    paymentQuoteValidity: "15",
    paymentDepositRestaurant: "5",
  });

  const [notifications, setNotifications] = useState({
    notifEmailBooking: "",
    notifEmailRestaurant: "",
    notifSmsEnabled: "false",
  });

  const [legalCompany, setLegalCompany] = useState({
    legalCompanyName:     "NEXTAIR, S.L.",
    legalCompanyCif:      "B16408031",
    legalCompanyAddress:  "C/JOSE LUIS PEREZ PUJADAS, Nº 14, PLTA.1, PUERTA D EDIFICIO FORUM",
    legalCompanyCity:     "GRANADA",
    legalCompanyZip:      "18006",
    legalCompanyProvince: "Granada",
    legalCompanyEmail:    "",
    legalCompanyPhone:    "",
    legalCompanyIban:     "",
  });

  const initialized = useRef(false);
  const debounceRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const scheduleAutoSave = useCallback((section: string, data: Record<string, string>) => {
    if (!initialized.current) return;
    if (debounceRef.current[section]) clearTimeout(debounceRef.current[section]);
    debounceRef.current[section] = setTimeout(() => {
      updateMutation.mutate({ settings: data });
    }, 1400);
  }, [updateMutation]);

  useEffect(() => {
    if (!rawSettings || sub.mode === "loading") return;
    initialized.current = false;
    const raw = rawSettings as Record<string, string | null>;
    // Empresa nueva: lo que no tenga guardado empieza vacío (nunca con datos de otra empresa)
    const s: Record<string, string | null> = blankDefaults
      ? new Proxy(raw, { get: (t, k: string) => (t[k] ?? "") })
      : raw;
    setBusiness(prev => ({
      businessName:        s.businessName        ?? prev.businessName,
      businessPhone:       s.businessPhone       ?? prev.businessPhone,
      businessEmail:       s.businessEmail       ?? prev.businessEmail,
      businessAddress:     s.businessAddress     ?? prev.businessAddress,
      businessDescription: s.businessDescription ?? prev.businessDescription,
      businessWebsite:     s.businessWebsite     ?? prev.businessWebsite,
    }));
    setSchedule(prev => ({
      scheduleHighOpen:  s.scheduleHighOpen  ?? prev.scheduleHighOpen,
      scheduleHighClose: s.scheduleHighClose ?? prev.scheduleHighClose,
      scheduleLowOpen:   s.scheduleLowOpen   ?? prev.scheduleLowOpen,
      scheduleLowClose:  s.scheduleLowClose  ?? prev.scheduleLowClose,
      scheduleDays:      s.scheduleDays      ?? prev.scheduleDays,
    }));
    setPayments(prev => ({
      paymentVat:               s.paymentVat               ?? prev.paymentVat,
      paymentCurrency:          s.paymentCurrency          ?? prev.paymentCurrency,
      paymentQuoteValidity:     s.paymentQuoteValidity     ?? prev.paymentQuoteValidity,
      paymentDepositRestaurant: s.paymentDepositRestaurant ?? prev.paymentDepositRestaurant,
    }));
    setNotifications(prev => ({
      notifEmailBooking:    s.notifEmailBooking    ?? prev.notifEmailBooking,
      notifEmailRestaurant: s.notifEmailRestaurant ?? prev.notifEmailRestaurant,
      notifSmsEnabled:      s.notifSmsEnabled      ?? prev.notifSmsEnabled,
    }));
    setLegalCompany(prev => ({
      legalCompanyName:     s.legalCompanyName     ?? prev.legalCompanyName,
      legalCompanyCif:      s.legalCompanyCif      ?? prev.legalCompanyCif,
      legalCompanyAddress:  s.legalCompanyAddress  ?? prev.legalCompanyAddress,
      legalCompanyCity:     s.legalCompanyCity     ?? prev.legalCompanyCity,
      legalCompanyZip:      s.legalCompanyZip      ?? prev.legalCompanyZip,
      legalCompanyProvince: s.legalCompanyProvince ?? prev.legalCompanyProvince,
      legalCompanyEmail:    s.legalCompanyEmail    ?? prev.legalCompanyEmail,
      legalCompanyPhone:    s.legalCompanyPhone    ?? prev.legalCompanyPhone,
      legalCompanyIban:     s.legalCompanyIban     ?? prev.legalCompanyIban,
    }));
    // Activar auto-save después de que React aplique todos los setState anteriores
    requestAnimationFrame(() => { initialized.current = true; });
  }, [rawSettings, sub.mode, blankDefaults]);

  // Validación: lo escrito tiene que ser válido para guardarse (los campos vacíos se permiten)
  const legalErrors = validateFiscalData(legalCompany as FiscalData);
  const legalValid = Object.keys(legalErrors).length === 0;
  const businessErrors = {
    businessEmail: validateEmail(business.businessEmail),
    businessPhone: validatePhone(business.businessPhone),
    businessWebsite: validateUrl(business.businessWebsite),
  };
  const businessValid = !businessErrors.businessEmail && !businessErrors.businessPhone && !businessErrors.businessWebsite;
  const notifErrors = {
    notifEmailBooking: validateEmail(notifications.notifEmailBooking),
    notifEmailRestaurant: validateEmail(notifications.notifEmailRestaurant),
  };
  const notifValid = !notifErrors.notifEmailBooking && !notifErrors.notifEmailRestaurant;

  // Auto-save: un efecto por sección, se dispara 1.4s después del último cambio
  // (no se guarda una sección mientras tenga errores; lo escrito se conserva en pantalla)
  useEffect(() => { if (businessValid) scheduleAutoSave("business", business); }, [business]);
  useEffect(() => { scheduleAutoSave("schedule", schedule); }, [schedule]);
  useEffect(() => { scheduleAutoSave("payments", { paymentCurrency: payments.paymentCurrency, paymentDepositRestaurant: payments.paymentDepositRestaurant }); }, [payments]);
  useEffect(() => {
    if (legalValid) scheduleAutoSave("legalCompany", { ...legalCompany, legalCompanyCif: legalCompany.legalCompanyCif.toUpperCase().replace(/[\s.-]/g, "") });
  }, [legalCompany]);
  useEffect(() => { if (notifValid) scheduleAutoSave("notifications", { notifEmailBooking: notifications.notifEmailBooking, notifEmailRestaurant: notifications.notifEmailRestaurant }); }, [notifications]);

  // Pestañas visibles: a una empresa nueva no se le muestran horarios de temporada ni el depósito de restaurante
  const visibleTabs = TABS.filter((tab) => !(isNewCompany && tab.id === "schedule"));
  const blockedNotice = (valid: boolean) =>
    !valid && <p role="status" className="text-xs text-destructive pt-2">{t("settingsGeneral.blocked")}</p>;

  if (sub.mode === "tasks") {
    return (
      <AdminLayout title={t("settingsGeneral.companyTitle")}>
        <div className="max-w-3xl mx-auto px-4 py-8">
          <div className="mb-6">
            <h1 className="text-2xl font-heading font-bold text-foreground">{t("settingsGeneral.companyTitle")}</h1>
            <p className="text-sm text-muted-foreground font-display mt-1">
              {t("settingsGeneral.companyIntro")}
            </p>
          </div>
          <CompanyData />
        </div>
      </AdminLayout>
    );
  }

  if (isError) {
    return (
      <AdminLayout title={t("settingsGeneral.businessTitle")}>
        <div className="max-w-5xl mx-auto px-4 py-8">
          <PanelError error={loadError} onRetry={() => refetch()} title={t("settingsGeneral.businessLoadError")} />
        </div>
      </AdminLayout>
    );
  }

  if (isLoading || sub.mode === "loading") {
    return (
      <AdminLayout title={t("settingsGeneral.businessTitle")}>
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-6 h-6 animate-spin text-accent" />
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout title={t("settingsGeneral.businessTitle")}>
      <div className="max-w-5xl mx-auto px-4 py-8">

        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl font-heading font-bold text-foreground">{t("settingsGeneral.businessTitle")}</h1>
          <p className="text-sm text-muted-foreground font-display mt-1">
            {t("settingsGeneral.businessIntro")}
          </p>
        </div>

        {/* Banner */}
        <div className="mb-5 flex items-start gap-3 bg-muted border border-border rounded-xl p-4">
          <Info className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
          <p className="text-sm font-display text-foreground/70">
            {t("settingsGeneral.banner.a")}<strong>{t("settingsGeneral.banner.b")}</strong>{t("settingsGeneral.banner.c")}
          </p>
        </div>

        {/* Card: sidebar + content */}
        <div className="flex flex-col md:flex-row gap-0 bg-card border border-border/50 rounded-2xl overflow-hidden">

          {/* Sidebar */}
          <nav aria-label={t("settingsGeneral.tabs.nav")} className="md:w-52 shrink-0 border-b md:border-b-0 md:border-r border-border/50 py-2 md:py-3 flex md:block overflow-x-auto">
            {visibleTabs.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => setActiveTab(id)}
                aria-current={activeTab === id ? "true" : undefined}
                className={`shrink-0 md:w-full flex items-center gap-2.5 px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  activeTab === id
                    ? "bg-primary/8 text-primary font-medium"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/40"
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span className="text-sm flex-1 overflow-hidden text-ellipsis whitespace-nowrap font-display">{t(label)}</span>
              </button>
            ))}
          </nav>

          {/* Content */}
          <div className="flex-1 min-w-0 p-4 sm:p-6">

            {/* ── Negocio ── */}
            {activeTab === "business" && (
              <div className="space-y-5">
                <p className="text-sm text-muted-foreground font-display">{t("settingsGeneral.business.intro")}</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Field label={isNewCompany ? t("settingsGeneral.business.nameNew") : t("settingsGeneral.business.nameOld")} col2>
                    <Input value={business.businessName} onChange={e => setBusiness(p => ({ ...p, businessName: e.target.value }))} autoComplete="organization" />
                  </Field>
                  <Field label={t("settingsGeneral.business.phone")} error={businessErrors.businessPhone}>
                    <Input type="tel" value={business.businessPhone} onChange={e => setBusiness(p => ({ ...p, businessPhone: e.target.value }))} placeholder="+34 600 000 000" autoComplete="tel" />
                  </Field>
                  <Field label={t("settingsGeneral.business.email")} error={businessErrors.businessEmail}>
                    <Input type="email" value={business.businessEmail} onChange={e => setBusiness(p => ({ ...p, businessEmail: e.target.value }))} placeholder="hola@tuempresa.com" autoComplete="email" />
                  </Field>
                  <Field label={t("settingsGeneral.business.address")} col2>
                    <Input value={business.businessAddress} onChange={e => setBusiness(p => ({ ...p, businessAddress: e.target.value }))} autoComplete="street-address" />
                  </Field>
                  <Field label={t("settingsGeneral.business.website")} col2 error={businessErrors.businessWebsite}>
                    <Input type="url" value={business.businessWebsite} onChange={e => setBusiness(p => ({ ...p, businessWebsite: e.target.value }))} placeholder="https://www.tuempresa.com" />
                  </Field>
                  <Field label={t("settingsGeneral.business.description")} col2>
                    <Textarea value={business.businessDescription} onChange={e => setBusiness(p => ({ ...p, businessDescription: e.target.value }))} rows={3} className="resize-none" />
                  </Field>
                </div>
                {blockedNotice(businessValid)}
                <AutoSaveStatus saving={updateMutation.isPending} />
                <SearchIndexingToggle />
              </div>
            )}

            {/* ── Horarios ── */}
            {activeTab === "schedule" && (
              <div className="space-y-5">
                <p className="text-sm text-muted-foreground font-display">{t("settingsGeneral.schedule.intro")}</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Field label={t("settingsGeneral.schedule.highOpen")}>
                    <Input type="time" value={schedule.scheduleHighOpen} onChange={e => setSchedule(p => ({ ...p, scheduleHighOpen: e.target.value }))} />
                  </Field>
                  <Field label={t("settingsGeneral.schedule.highClose")}>
                    <Input type="time" value={schedule.scheduleHighClose} onChange={e => setSchedule(p => ({ ...p, scheduleHighClose: e.target.value }))} />
                  </Field>
                  <Field label={t("settingsGeneral.schedule.lowOpen")}>
                    <Input type="time" value={schedule.scheduleLowOpen} onChange={e => setSchedule(p => ({ ...p, scheduleLowOpen: e.target.value }))} />
                  </Field>
                  <Field label={t("settingsGeneral.schedule.lowClose")}>
                    <Input type="time" value={schedule.scheduleLowClose} onChange={e => setSchedule(p => ({ ...p, scheduleLowClose: e.target.value }))} />
                  </Field>
                  <div className="sm:col-span-2">
                    <Field label={t("settingsGeneral.schedule.days")}>
                      <Input value={schedule.scheduleDays} onChange={e => setSchedule(p => ({ ...p, scheduleDays: e.target.value }))} placeholder={t("settingsGeneral.schedule.daysPlaceholder")} />
                    </Field>
                  </div>
                </div>
                <AutoSaveStatus saving={updateMutation.isPending} />
              </div>
            )}

            {/* ── Pagos ── */}
            {activeTab === "payments" && (
              <div className="space-y-5">
                <p className="text-sm text-muted-foreground font-display">{t("settingsGeneral.payments.intro.a")}<strong>{t("settingsGeneral.payments.intro.b")}</strong>{t("settingsGeneral.payments.intro.c")}</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Field label={t("settingsGeneral.payments.currency")}>
                    <Input value={payments.paymentCurrency} onChange={e => setPayments(p => ({ ...p, paymentCurrency: e.target.value }))} placeholder="EUR" />
                  </Field>
                  {hasRestaurants && (
                    <Field label={t("settingsGeneral.payments.deposit")} hint={t("settingsGeneral.payments.depositHint")}>
                      <Input type="number" min="0" step="0.5" value={payments.paymentDepositRestaurant} onChange={e => setPayments(p => ({ ...p, paymentDepositRestaurant: e.target.value }))} />
                    </Field>
                  )}
                </div>
                <AutoSaveStatus saving={updateMutation.isPending} />
              </div>
            )}

            {/* ── Empresa legal ── */}
            {activeTab === "legalCompany" && (
              <div className="space-y-5">
                <div className="flex items-start gap-2 bg-warning/10 border border-warning/30 rounded-xl p-3">
                  <Info className="w-4 h-4 text-warning mt-0.5 shrink-0" />
                  <p className="text-xs text-warning font-display">
                    {t("settingsGeneral.legal.notice.a")}<strong>{t("settingsGeneral.legal.notice.b")}</strong>{t("settingsGeneral.legal.notice.c")}
                  </p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Field label={t("settingsGeneral.legal.name")} col2 error={legalErrors.legalCompanyName}>
                    <Input value={legalCompany.legalCompanyName} onChange={e => setLegalCompany(p => ({ ...p, legalCompanyName: e.target.value }))} placeholder={t("settingsGeneral.legal.namePlaceholder")} autoComplete="organization" />
                  </Field>
                  <Field label={t("settingsGeneral.legal.cif")} error={legalErrors.legalCompanyCif}>
                    <Input value={legalCompany.legalCompanyCif} onChange={e => setLegalCompany(p => ({ ...p, legalCompanyCif: e.target.value }))} placeholder="B12345674" autoCapitalize="characters" spellCheck={false} />
                  </Field>
                  <Field label={t("settingsGeneral.legal.phone")} error={legalErrors.legalCompanyPhone}>
                    <Input type="tel" value={legalCompany.legalCompanyPhone} onChange={e => setLegalCompany(p => ({ ...p, legalCompanyPhone: e.target.value }))} placeholder="+34 900 000 000" autoComplete="tel" />
                  </Field>
                  <Field label={t("settingsGeneral.legal.address")} col2>
                    <Input value={legalCompany.legalCompanyAddress} onChange={e => setLegalCompany(p => ({ ...p, legalCompanyAddress: e.target.value }))} placeholder={t("settingsGeneral.legal.addressPlaceholder")} autoComplete="street-address" />
                  </Field>
                  <Field label={t("settingsGeneral.legal.zip")} error={legalErrors.legalCompanyZip}>
                    <Input inputMode="numeric" value={legalCompany.legalCompanyZip} onChange={e => setLegalCompany(p => ({ ...p, legalCompanyZip: e.target.value }))} placeholder="28001" autoComplete="postal-code" />
                  </Field>
                  <Field label={t("settingsGeneral.legal.city")}>
                    <Input value={legalCompany.legalCompanyCity} onChange={e => setLegalCompany(p => ({ ...p, legalCompanyCity: e.target.value }))} placeholder="Madrid" autoComplete="address-level2" />
                  </Field>
                  <Field label={t("settingsGeneral.legal.province")} col2>
                    <Input value={legalCompany.legalCompanyProvince} onChange={e => setLegalCompany(p => ({ ...p, legalCompanyProvince: e.target.value }))} placeholder="Madrid" autoComplete="address-level1" />
                  </Field>
                  <Field label={t("settingsGeneral.legal.email")} col2 error={legalErrors.legalCompanyEmail}>
                    <Input type="email" value={legalCompany.legalCompanyEmail} onChange={e => setLegalCompany(p => ({ ...p, legalCompanyEmail: e.target.value }))} placeholder="administracion@tuempresa.com" autoComplete="email" />
                  </Field>
                  <Field label={t("settingsGeneral.legal.iban")} col2 error={legalErrors.legalCompanyIban} hint={t("settingsGeneral.legal.ibanHint")}>
                    <Input value={legalCompany.legalCompanyIban} onChange={e => setLegalCompany(p => ({ ...p, legalCompanyIban: e.target.value }))} placeholder="ES00 0000 0000 0000 0000 0000" spellCheck={false} />
                  </Field>
                </div>
                {blockedNotice(legalValid)}
                <AutoSaveStatus saving={updateMutation.isPending} />
              </div>
            )}

            {/* ── Notificaciones ── */}
            {activeTab === "notifications" && (
              <div className="space-y-5">
                <p className="text-sm text-muted-foreground font-display">{t("settingsGeneral.notifications.intro")}</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Field label={isNewCompany ? t("settingsGeneral.notifications.bookingNew") : t("settingsGeneral.notifications.bookingOld")} col2 error={notifErrors.notifEmailBooking}>
                    <Input type="email" value={notifications.notifEmailBooking} onChange={e => setNotifications(p => ({ ...p, notifEmailBooking: e.target.value }))} />
                  </Field>
                  {hasRestaurants && (
                    <Field label={t("settingsGeneral.notifications.restaurant")} col2 error={notifErrors.notifEmailRestaurant}>
                      <Input type="email" value={notifications.notifEmailRestaurant} onChange={e => setNotifications(p => ({ ...p, notifEmailRestaurant: e.target.value }))} />
                    </Field>
                  )}
                </div>
                {blockedNotice(notifValid)}
                <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-xl">
                  <Phone className="w-4 h-4 text-muted-foreground shrink-0" />
                  <p className="text-xs text-muted-foreground font-display">
                    {t("settingsGeneral.notifications.sms")}
                  </p>
                </div>
                <AutoSaveStatus saving={updateMutation.isPending} />
              </div>
            )}

          </div>
        </div>
      </div>
    </AdminLayout>
  );
}
