import { useState, useEffect, useRef, useCallback } from "react";
import AdminLayout from "@/components/AdminLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Settings as SettingsIcon, Globe, Phone, Mail, Clock,
  CreditCard, Loader2, CheckCircle2, Info, Send, Building2,
  Eye, EyeOff, Wifi, WifiOff, Check,
} from "lucide-react";

const EMAIL_TEMPLATES = [
  { id: "budget-user",         label: "Solicitud de presupuesto (al cliente)" },
  { id: "budget-admin",        label: "Solicitud de presupuesto (al admin)" },
  { id: "reservation-confirm", label: "Reserva confirmada (pago Redsys OK)" },
  { id: "reservation-failed",  label: "Pago fallido (Redsys KO)" },
  { id: "restaurant-confirm",  label: "Reserva de restaurante confirmada" },
  { id: "restaurant-payment",  label: "Link de pago depósito restaurante" },
  { id: "password-reset",      label: "Recuperar contraseña" },
  { id: "quote",               label: "Presupuesto enviado al cliente" },
  { id: "confirmation",        label: "Reserva confirmada (CRM admin)" },
  { id: "transfer-confirm",    label: "Pago por transferencia validado" },
];

// ─── Sidebar tab definitions ──────────────────────────────────────────────────
const TABS = [
  { id: "business",      label: "Negocio",         icon: Globe },
  { id: "schedule",      label: "Horarios",         icon: Clock },
  { id: "payments",      label: "Pagos",            icon: CreditCard },
  { id: "legalCompany",  label: "Empresa legal",    icon: Building2 },
  { id: "notifications", label: "Notificaciones",   icon: Mail },
] as const;

type Tab = typeof TABS[number]["id"];

// ─── GHL Section ──────────────────────────────────────────────────────────────
function GHLSection({ plain = false }: { plain?: boolean }) {
  const { data: status, refetch: refetchStatus } = trpc.cms.getGHLStatus.useQuery();
  const saveMutation = trpc.cms.updateSiteSettings.useMutation({
    onSuccess: () => { toast.success("Credenciales GHL guardadas"); refetchStatus(); },
    onError: (e) => toast.error("Error al guardar: " + e.message),
  });
  const testMutation = trpc.cms.testGHLConnection.useMutation({
    onSuccess: (res) => {
      if (res.ok) toast.success("Conexión con GHL exitosa ✓");
      else toast.error("Fallo de conexión: " + (res.error ?? "Error desconocido"));
    },
    onError: (e) => toast.error("Error: " + e.message),
  });

  const [apiKey, setApiKey] = useState("");
  const [locationId, setLocationId] = useState("");
  const [showKey, setShowKey] = useState(false);

  const isConfigured = status?.configured;
  const fromEnv = status?.fromEnv;

  function handleSave() {
    if (!apiKey && !locationId) return toast.error("Introduce al menos un valor");
    const settings: Record<string, string> = {};
    if (apiKey) settings.ghlApiKey = apiKey;
    if (locationId) settings.ghlLocationId = locationId;
    saveMutation.mutate({ settings });
  }

  function handleTest() {
    const key = apiKey || "";
    const loc = locationId || status?.locationId || "";
    if (!key || !loc) return toast.error("Introduce API Key y Location ID para probar");
    testMutation.mutate({ apiKey: key, locationId: loc });
  }

  const inner = (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <div className={`flex items-center gap-1.5 text-xs font-display font-medium px-2.5 py-1 rounded-full ${isConfigured ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "bg-muted text-muted-foreground"}`}>
          {isConfigured ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
          {isConfigured ? "Conectado" : "Sin configurar"}
        </div>
        {fromEnv && <span className="text-xs text-amber-500 font-display font-medium">· Variables de entorno activas (tienen prioridad)</span>}
      </div>

      {isConfigured && (
        <div className="flex items-center gap-2 p-3 bg-emerald-500/8 border border-emerald-500/20 rounded-xl text-xs font-display text-emerald-700 dark:text-emerald-400">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>
            API Key: <strong>{status?.apiKeyMasked}</strong>
            {status?.locationId && <> · Location ID: <strong>{status.locationId}</strong></>}
          </span>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label className="text-sm font-display font-medium text-foreground/80">
            API Key {isConfigured && <span className="text-xs text-muted-foreground">(dejar vacío para no cambiar)</span>}
          </Label>
          <div className="relative">
            <Input
              type={showKey ? "text" : "password"}
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              placeholder={isConfigured ? "••••••••" : "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9..."}
              className="pr-10 font-mono text-xs"
            />
            <button
              type="button"
              onClick={() => setShowKey(v => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label className="text-sm font-display font-medium text-foreground/80">Location ID</Label>
          <Input
            value={locationId}
            onChange={e => setLocationId(e.target.value)}
            placeholder={status?.locationId || "xxxxxxxxxxxxxxxxxxxxxxxx"}
            className="font-mono text-xs"
          />
        </div>
      </div>

      <div className="flex gap-2 flex-wrap">
        <Button
          onClick={handleSave}
          disabled={saveMutation.isPending || (!apiKey && !locationId)}
          className="bg-blue-600 hover:bg-blue-700 text-white font-display"
          size="sm"
        >
          {saveMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <CheckCircle2 className="w-4 h-4 mr-2" />}
          Guardar credenciales
        </Button>
        <Button variant="outline" size="sm" onClick={handleTest} disabled={testMutation.isPending} className="font-display">
          {testMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Wifi className="w-4 h-4 mr-2" />}
          Probar conexión
        </Button>
      </div>

      <div className="text-xs text-muted-foreground font-display space-y-1 pt-1 border-t border-border/40">
        <p>Los leads del formulario web y presupuestos se sincronizan automáticamente como contactos en GHL con sus tags y notas.</p>
        <p>Tags disponibles: <code className="bg-muted px-1 rounded">Lead Web</code> · <code className="bg-muted px-1 rounded">Experiencia</code> · <code className="bg-muted px-1 rounded">Presupuesto</code> · <code className="bg-muted px-1 rounded">Reserva Online</code></p>
      </div>
    </div>
  );

  if (plain) return inner;

  return (
    <div className="bg-card border border-border/50 rounded-2xl p-6">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-blue-500/10 flex items-center justify-center">
            <SettingsIcon className="w-4 h-4 text-blue-500" />
          </div>
          <h3 className="font-heading font-semibold text-foreground">Integración GoHighLevel</h3>
        </div>
      </div>
      <p className="text-xs text-muted-foreground mb-5 ml-11">
        Sincroniza leads y contactos con tu CRM de GoHighLevel. Las credenciales se guardan de forma segura en la base de datos.
      </p>
      <div className="ml-11">{inner}</div>
    </div>
  );
}

// ─── Email Preview Section ─────────────────────────────────────────────────────
function EmailPreviewSection({ plain = false }: { plain?: boolean }) {
  const [templateId, setTemplateId] = useState("budget-user");
  const [toEmail, setToEmail] = useState("reservas@nayadeexperiences.es");
  const sendPreview = trpc.admin.sendEmailPreview.useMutation({
    onSuccess: (data) => toast.success(`Email enviado a ${data.to}`),
    onError: (err) => toast.error(`Error: ${err.message}`),
  });

  const inner = (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label className="text-xs font-display text-muted-foreground">Plantilla</Label>
          <Select value={templateId} onValueChange={setTemplateId}>
            <SelectTrigger className="font-display">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {EMAIL_TEMPLATES.map(t => (
                <SelectItem key={t.id} value={t.id} className="font-display">{t.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs font-display text-muted-foreground">Enviar a</Label>
          <Input
            type="email"
            value={toEmail}
            onChange={e => setToEmail(e.target.value)}
            placeholder="reservas@nayadeexperiences.es"
            className="font-display"
          />
        </div>
      </div>
      <Button
        onClick={() => sendPreview.mutate({ templateId, to: toEmail })}
        disabled={sendPreview.isPending || !toEmail}
        className="bg-orange-500 hover:bg-orange-600 text-white font-display"
      >
        {sendPreview.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Send className="w-4 h-4 mr-2" />}
        Enviar email de prueba
      </Button>
    </div>
  );

  if (plain) return inner;

  return (
    <div className="bg-card border border-border/50 rounded-2xl p-6">
      <div className="flex items-center gap-3 mb-3">
        <div className="w-8 h-8 rounded-xl bg-orange-500/10 flex items-center justify-center">
          <Send className="w-4 h-4 text-orange-500" />
        </div>
        <h3 className="font-heading font-semibold text-foreground">Prueba de plantillas de email</h3>
      </div>
      <p className="text-sm font-display text-muted-foreground mb-4 ml-11">
        Envía una muestra de cualquier plantilla de email a la dirección que elijas para verificar el diseño.
      </p>
      <div className="ml-11">{inner}</div>
    </div>
  );
}

// ─── Field helper ─────────────────────────────────────────────────────────────
function Field({ label, hint, children, col2 = false }: {
  label: string; hint?: string; children: React.ReactNode; col2?: boolean;
}) {
  return (
    <div className={col2 ? "col-span-2" : ""}>
      <Label className="text-sm font-display font-medium text-foreground/80">{label}</Label>
      <div className="mt-1.5">{children}</div>
      {hint && <p className="text-xs text-muted-foreground mt-1">{hint}</p>}
    </div>
  );
}

// ─── Auto-save indicator ──────────────────────────────────────────────────────
function AutoSaveStatus({ saving }: { saving: boolean }) {
  return (
    <div className="flex items-center gap-1.5 pt-4 border-t border-border/20 text-xs text-muted-foreground">
      {saving
        ? <><Loader2 className="w-3 h-3 animate-spin" /> Guardando…</>
        : <><Check className="w-3 h-3 text-emerald-500" /> Los cambios se guardan automáticamente</>
      }
    </div>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────
export default function Settings() {
  const { data: rawSettings, isLoading } = trpc.cms.getSiteSettings.useQuery();
  const updateMutation = trpc.cms.updateSiteSettings.useMutation({
    onSuccess: () => toast.success("Configuración guardada correctamente"),
    onError: (e) => toast.error("Error al guardar: " + e.message),
  });

  const [activeTab, setActiveTab] = useState<Tab>("business");

  const [business, setBusiness] = useState({
    businessName: "Náyade Experiences",
    businessPhone: "+34 930 34 77 91",
    businessEmail: "reservas@nayadeexperiences.es",
    businessAddress: "Los Ángeles de San Rafael, Segovia",
    businessDescription: "El destino de aventuras del lago. Actividades náuticas, hotel y spa en el embalse de Los Ángeles de San Rafael, a 45 min de Madrid.",
    businessWebsite: "https://nayadeexperiences.es",
  });

  const [schedule, setSchedule] = useState({
    scheduleHighOpen: "10:00",
    scheduleHighClose: "20:00",
    scheduleLowOpen: "10:00",
    scheduleLowClose: "18:00",
    scheduleDays: "Lunes a Domingo (Abril - Octubre)",
  });

  const [payments, setPayments] = useState({
    paymentVat: "21",
    paymentCurrency: "EUR",
    paymentQuoteValidity: "15",
    paymentDepositRestaurant: "5",
  });

  const [notifications, setNotifications] = useState({
    notifEmailBooking: "reservas@nayadeexperiences.es",
    notifEmailRestaurant: "restaurantes@nayadeexperiences.es",
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
    if (!rawSettings) return;
    initialized.current = false;
    const s = rawSettings as Record<string, string | null>;
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
  }, [rawSettings]);

  // Auto-save: un efecto por sección, se dispara 1.4s después del último cambio
  useEffect(() => { scheduleAutoSave("business", business); }, [business]);
  useEffect(() => { scheduleAutoSave("schedule", schedule); }, [schedule]);
  useEffect(() => { scheduleAutoSave("payments", { paymentCurrency: payments.paymentCurrency, paymentDepositRestaurant: payments.paymentDepositRestaurant }); }, [payments]);
  useEffect(() => { scheduleAutoSave("legalCompany", legalCompany); }, [legalCompany]);
  useEffect(() => { scheduleAutoSave("notifications", { notifEmailBooking: notifications.notifEmailBooking, notifEmailRestaurant: notifications.notifEmailRestaurant }); }, [notifications]);

  if (isLoading) {
    return (
      <AdminLayout title="Datos del negocio">
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-6 h-6 animate-spin text-accent" />
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout title="Datos del negocio">
      <div className="max-w-5xl mx-auto px-4 py-8">

        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl font-heading font-bold text-foreground">Datos del negocio</h1>
          <p className="text-sm text-muted-foreground font-display mt-1">
            Información del establecimiento, horarios, condiciones comerciales, empresa facturadora y notificaciones.
          </p>
        </div>

        {/* Banner */}
        <div className="mb-5 flex items-start gap-3 bg-muted border border-border rounded-xl p-4">
          <Info className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
          <p className="text-sm font-display text-foreground/70">
            Las credenciales sensibles (Redsys, SMTP, JWT, GoHighLevel) se gestionan en <strong>Configuración → Ajustes del sistema</strong> o en las variables de entorno del proyecto.
          </p>
        </div>

        {/* Card: sidebar + content */}
        <div className="flex gap-0 bg-card border border-border/50 rounded-2xl overflow-hidden">

          {/* Sidebar */}
          <aside className="w-52 shrink-0 border-r border-border/50 py-3">
            {TABS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setActiveTab(id)}
                className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-left transition-colors ${
                  activeTab === id
                    ? "bg-primary/8 text-primary font-medium"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/40"
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span className="text-sm flex-1 truncate font-display">{label}</span>
              </button>
            ))}
          </aside>

          {/* Content */}
          <div className="flex-1 min-w-0 p-6">

            {/* ── Negocio ── */}
            {activeTab === "business" && (
              <div className="space-y-5">
                <p className="text-sm text-muted-foreground font-display">Datos de contacto y descripción que aparecen en el sitio web y en los emails automáticos.</p>
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Nombre del establecimiento" col2>
                    <Input value={business.businessName} onChange={e => setBusiness(p => ({ ...p, businessName: e.target.value }))} />
                  </Field>
                  <Field label="Teléfono">
                    <Input value={business.businessPhone} onChange={e => setBusiness(p => ({ ...p, businessPhone: e.target.value }))} placeholder="+34 930 34 77 91" />
                  </Field>
                  <Field label="Email de contacto">
                    <Input type="email" value={business.businessEmail} onChange={e => setBusiness(p => ({ ...p, businessEmail: e.target.value }))} />
                  </Field>
                  <Field label="Dirección" col2>
                    <Input value={business.businessAddress} onChange={e => setBusiness(p => ({ ...p, businessAddress: e.target.value }))} />
                  </Field>
                  <Field label="Web corporativa" col2>
                    <Input value={business.businessWebsite} onChange={e => setBusiness(p => ({ ...p, businessWebsite: e.target.value }))} placeholder="https://nayadeexperiences.es" />
                  </Field>
                  <Field label="Descripción breve (SEO / emails)" col2>
                    <Textarea value={business.businessDescription} onChange={e => setBusiness(p => ({ ...p, businessDescription: e.target.value }))} rows={3} className="resize-none" />
                  </Field>
                </div>
                <AutoSaveStatus saving={updateMutation.isPending} />
              </div>
            )}

            {/* ── Horarios ── */}
            {activeTab === "schedule" && (
              <div className="space-y-5">
                <p className="text-sm text-muted-foreground font-display">Horarios que se muestran en la web y se usan en los emails de confirmación.</p>
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Temporada alta — apertura">
                    <Input type="time" value={schedule.scheduleHighOpen} onChange={e => setSchedule(p => ({ ...p, scheduleHighOpen: e.target.value }))} />
                  </Field>
                  <Field label="Temporada alta — cierre">
                    <Input type="time" value={schedule.scheduleHighClose} onChange={e => setSchedule(p => ({ ...p, scheduleHighClose: e.target.value }))} />
                  </Field>
                  <Field label="Temporada baja — apertura">
                    <Input type="time" value={schedule.scheduleLowOpen} onChange={e => setSchedule(p => ({ ...p, scheduleLowOpen: e.target.value }))} />
                  </Field>
                  <Field label="Temporada baja — cierre">
                    <Input type="time" value={schedule.scheduleLowClose} onChange={e => setSchedule(p => ({ ...p, scheduleLowClose: e.target.value }))} />
                  </Field>
                  <div className="col-span-2">
                    <Field label="Días de apertura">
                      <Input value={schedule.scheduleDays} onChange={e => setSchedule(p => ({ ...p, scheduleDays: e.target.value }))} placeholder="Lunes a Domingo (Abril - Octubre)" />
                    </Field>
                  </div>
                </div>
                <AutoSaveStatus saving={updateMutation.isPending} />
              </div>
            )}

            {/* ── Pagos ── */}
            {activeTab === "payments" && (
              <div className="space-y-5">
                <p className="text-sm text-muted-foreground font-display">Parámetros financieros usados en reservas y cálculos de depósito. El IVA y la validez de presupuestos se configuran en <strong>Configuración → Ajustes del sistema</strong>.</p>
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Moneda">
                    <Input value={payments.paymentCurrency} onChange={e => setPayments(p => ({ ...p, paymentCurrency: e.target.value }))} placeholder="EUR" />
                  </Field>
                  <Field label="Depósito por comensal en restaurante (€)" hint="Importe del depósito en reservas de restaurante">
                    <Input type="number" min="0" step="0.5" value={payments.paymentDepositRestaurant} onChange={e => setPayments(p => ({ ...p, paymentDepositRestaurant: e.target.value }))} />
                  </Field>
                </div>
                <AutoSaveStatus saving={updateMutation.isPending} />
              </div>
            )}

            {/* ── Empresa legal ── */}
            {activeTab === "legalCompany" && (
              <div className="space-y-5">
                <div className="flex items-start gap-2 bg-amber-500/10 border border-amber-500/20 rounded-xl p-3">
                  <Info className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
                  <p className="text-xs text-amber-600 dark:text-amber-400 font-display">
                    Estos datos aparecen como <strong>emisor</strong> en todas las facturas y presupuestos generados por la plataforma, y en la cabecera de los tickets del TPV. Asegúrate de que coinciden exactamente con los datos registrados en la Agencia Tributaria.
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Razón Social" col2>
                    <Input value={legalCompany.legalCompanyName} onChange={e => setLegalCompany(p => ({ ...p, legalCompanyName: e.target.value }))} placeholder="NEXTAIR, S.L." />
                  </Field>
                  <Field label="CIF / NIF">
                    <Input value={legalCompany.legalCompanyCif} onChange={e => setLegalCompany(p => ({ ...p, legalCompanyCif: e.target.value }))} placeholder="B16408031" />
                  </Field>
                  <Field label="Teléfono fiscal">
                    <Input value={legalCompany.legalCompanyPhone} onChange={e => setLegalCompany(p => ({ ...p, legalCompanyPhone: e.target.value }))} placeholder="+34 958 000 000" />
                  </Field>
                  <Field label="Domicilio fiscal" col2>
                    <Input value={legalCompany.legalCompanyAddress} onChange={e => setLegalCompany(p => ({ ...p, legalCompanyAddress: e.target.value }))} />
                  </Field>
                  <Field label="Código Postal">
                    <Input value={legalCompany.legalCompanyZip} onChange={e => setLegalCompany(p => ({ ...p, legalCompanyZip: e.target.value }))} placeholder="18006" />
                  </Field>
                  <Field label="Municipio">
                    <Input value={legalCompany.legalCompanyCity} onChange={e => setLegalCompany(p => ({ ...p, legalCompanyCity: e.target.value }))} placeholder="GRANADA" />
                  </Field>
                  <Field label="Provincia" col2>
                    <Input value={legalCompany.legalCompanyProvince} onChange={e => setLegalCompany(p => ({ ...p, legalCompanyProvince: e.target.value }))} placeholder="Granada" />
                  </Field>
                  <Field label="Email fiscal" col2>
                    <Input type="email" value={legalCompany.legalCompanyEmail} onChange={e => setLegalCompany(p => ({ ...p, legalCompanyEmail: e.target.value }))} placeholder="administracion@nextair.es" />
                  </Field>
                  <Field label="IBAN (para liquidaciones)" col2 hint="Número de cuenta bancaria que aparece en los documentos de liquidación a proveedores">
                    <Input value={legalCompany.legalCompanyIban} onChange={e => setLegalCompany(p => ({ ...p, legalCompanyIban: e.target.value }))} placeholder="ES00 0000 0000 0000 0000 0000" />
                  </Field>
                </div>
                <AutoSaveStatus saving={updateMutation.isPending} />
              </div>
            )}

            {/* ── Notificaciones ── */}
            {activeTab === "notifications" && (
              <div className="space-y-5">
                <p className="text-sm text-muted-foreground font-display">Emails que reciben las alertas operativas del sistema (nuevas reservas, pagos, etc.).</p>
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Email de alertas de reservas de experiencias" col2>
                    <Input type="email" value={notifications.notifEmailBooking} onChange={e => setNotifications(p => ({ ...p, notifEmailBooking: e.target.value }))} />
                  </Field>
                  <Field label="Email de alertas de reservas de restaurante" col2>
                    <Input type="email" value={notifications.notifEmailRestaurant} onChange={e => setNotifications(p => ({ ...p, notifEmailRestaurant: e.target.value }))} />
                  </Field>
                </div>
                <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-xl">
                  <Phone className="w-4 h-4 text-muted-foreground shrink-0" />
                  <p className="text-xs text-muted-foreground font-display">
                    Las notificaciones SMS se configuran a través del conector de GoHighLevel (GHL). Activa la integración en la pestaña GoHighLevel.
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
