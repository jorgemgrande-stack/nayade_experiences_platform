import { useState, useEffect } from "react";
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
} from "lucide-react";

const EMAIL_TEMPLATES = [
  { id: "budget-user",       label: "Solicitud de presupuesto (al cliente)" },
  { id: "budget-admin",      label: "Solicitud de presupuesto (al admin)" },
  { id: "reservation-confirm", label: "Reserva confirmada (pago Redsys OK)" },
  { id: "reservation-failed",  label: "Pago fallido (Redsys KO)" },
  { id: "restaurant-confirm",  label: "Reserva de restaurante confirmada" },
  { id: "restaurant-payment",  label: "Link de pago depósito restaurante" },
  { id: "password-reset",      label: "Recuperar contraseña" },
  { id: "quote",               label: "Presupuesto enviado al cliente" },
  { id: "confirmation",        label: "Reserva confirmada (CRM admin)" },
  { id: "transfer-confirm",    label: "Pago por transferencia validado" },
];

function EmailPreviewSection() {
  const [templateId, setTemplateId] = useState("budget-user");
  const [toEmail, setToEmail] = useState("reservas@nayadeexperiences.es");
  const sendPreview = trpc.admin.sendEmailPreview.useMutation({
    onSuccess: (data) => toast.success(`Email enviado a ${data.to}`),
    onError: (err) => toast.error(`Error: ${err.message}`),
  });
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
      <div className="ml-11 space-y-4">
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
    </div>
  );
}

// ─── Sección reutilizable ─────────────────────────────────────────────────────
function Section({
  icon: Icon,
  title,
  description,
  children,
  onSave,
  saving,
}: {
  icon: React.ElementType;
  title: string;
  description?: string;
  children: React.ReactNode;
  onSave: () => void;
  saving: boolean;
}) {
  return (
    <div className="bg-card border border-border/50 rounded-2xl p-6">
      <div className="flex items-center gap-3 mb-1">
        <div className="w-8 h-8 rounded-xl bg-accent/10 flex items-center justify-center">
          <Icon className="w-4 h-4 text-accent" />
        </div>
        <h3 className="font-heading font-semibold text-foreground">{title}</h3>
      </div>
      {description && <p className="text-xs text-muted-foreground mb-5 ml-11">{description}</p>}
      <div className="mt-5 space-y-4">{children}</div>
      <div className="mt-5 flex justify-end">
        <Button
          onClick={onSave}
          disabled={saving}
          className="bg-accent text-white hover:bg-accent/90 font-display font-semibold px-6"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <CheckCircle2 className="w-4 h-4 mr-2" />}
          Guardar cambios
        </Button>
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
  col2 = false,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
  col2?: boolean;
}) {
  return (
    <div className={col2 ? "col-span-2" : ""}>
      <Label className="text-sm font-display font-medium text-foreground/80">{label}</Label>
      <div className="mt-1.5">{children}</div>
      {hint && <p className="text-xs text-muted-foreground mt-1">{hint}</p>}
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

  // ── Estado local por sección ──────────────────────────────────────────────
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

  const [savingSection, setSavingSection] = useState<string | null>(null);

  // ── Cargar datos de la BD ─────────────────────────────────────────────────
  useEffect(() => {
    if (!rawSettings) return;
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
  }, [rawSettings]);

  async function saveSection(section: string, data: Record<string, string>) {
    setSavingSection(section);
    try {
      await updateMutation.mutateAsync({ settings: data });
    } finally {
      setSavingSection(null);
    }
  }

  if (isLoading) {
    return (
      <AdminLayout title="Configuración">
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-6 h-6 animate-spin text-accent" />
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout title="Configuración">
      <div className="max-w-3xl space-y-6 pb-12">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-heading font-bold text-foreground">Configuración General</h1>
          <p className="text-sm text-muted-foreground font-display mt-1">
            Ajustes globales de la plataforma Náyade Experiences. Los cambios se guardan en la base de datos.
          </p>
        </div>

        {/* Banner informativo */}
        <div className="flex items-start gap-3 bg-accent/5 border border-accent/20 rounded-xl p-4">
          <Info className="w-4 h-4 text-accent mt-0.5 shrink-0" />
          <p className="text-sm font-display text-foreground/80">
            Las credenciales sensibles (Redsys, SMTP, JWT) se gestionan en la sección <strong>Secrets</strong> del panel de gestión del proyecto, no aquí.
          </p>
        </div>

        {/* ── Información del negocio ── */}
        <Section
          icon={Globe}
          title="Información del Negocio"
          description="Datos de contacto y descripción que aparecen en el sitio web y en los emails automáticos."
          onSave={() => saveSection("business", business)}
          saving={savingSection === "business"}
        >
          <div className="grid grid-cols-2 gap-4">
            <Field label="Nombre del establecimiento" col2>
              <Input
                value={business.businessName}
                onChange={e => setBusiness(p => ({ ...p, businessName: e.target.value }))}
              />
            </Field>
            <Field label="Teléfono">
              <Input
                value={business.businessPhone}
                onChange={e => setBusiness(p => ({ ...p, businessPhone: e.target.value }))}
                placeholder="+34 930 34 77 91"
              />
            </Field>
            <Field label="Email de contacto">
              <Input
                type="email"
                value={business.businessEmail}
                onChange={e => setBusiness(p => ({ ...p, businessEmail: e.target.value }))}
              />
            </Field>
            <Field label="Dirección" col2>
              <Input
                value={business.businessAddress}
                onChange={e => setBusiness(p => ({ ...p, businessAddress: e.target.value }))}
              />
            </Field>
            <Field label="Web corporativa" col2>
              <Input
                value={business.businessWebsite}
                onChange={e => setBusiness(p => ({ ...p, businessWebsite: e.target.value }))}
                placeholder="https://nayadeexperiences.es"
              />
            </Field>
            <Field label="Descripción breve (SEO / emails)" col2>
              <Textarea
                value={business.businessDescription}
                onChange={e => setBusiness(p => ({ ...p, businessDescription: e.target.value }))}
                rows={3}
                className="resize-none"
              />
            </Field>
          </div>
        </Section>

        {/* ── Horarios ── */}
        <Section
          icon={Clock}
          title="Horarios de Apertura"
          description="Horarios que se muestran en la web y se usan en los emails de confirmación."
          onSave={() => saveSection("schedule", schedule)}
          saving={savingSection === "schedule"}
        >
          <div className="grid grid-cols-2 gap-4">
            <Field label="Temporada alta — apertura">
              <Input
                type="time"
                value={schedule.scheduleHighOpen}
                onChange={e => setSchedule(p => ({ ...p, scheduleHighOpen: e.target.value }))}
              />
            </Field>
            <Field label="Temporada alta — cierre">
              <Input
                type="time"
                value={schedule.scheduleHighClose}
                onChange={e => setSchedule(p => ({ ...p, scheduleHighClose: e.target.value }))}
              />
            </Field>
            <Field label="Temporada baja — apertura">
              <Input
                type="time"
                value={schedule.scheduleLowOpen}
                onChange={e => setSchedule(p => ({ ...p, scheduleLowOpen: e.target.value }))}
              />
            </Field>
            <Field label="Temporada baja — cierre">
              <Input
                type="time"
                value={schedule.scheduleLowClose}
                onChange={e => setSchedule(p => ({ ...p, scheduleLowClose: e.target.value }))}
              />
            </Field>
            <div className="col-span-2">
              <Field label="Días de apertura">
                <Input
                  value={schedule.scheduleDays}
                  onChange={e => setSchedule(p => ({ ...p, scheduleDays: e.target.value }))}
                  placeholder="Lunes a Domingo (Abril - Octubre)"
                />
              </Field>
            </div>
          </div>
        </Section>

        {/* ── Pagos ── */}
        <Section
          icon={CreditCard}
          title="Configuración de Pagos"
          description="Parámetros financieros usados en presupuestos, reservas y cálculos de depósito."
          onSave={() => saveSection("payments", payments)}
          saving={savingSection === "payments"}
        >
          <div className="grid grid-cols-2 gap-4">
            <Field label="IVA por defecto (%)" hint="Se aplica a presupuestos y facturas">
              <Input
                type="number"
                min="0"
                max="100"
                value={payments.paymentVat}
                onChange={e => setPayments(p => ({ ...p, paymentVat: e.target.value }))}
              />
            </Field>
            <Field label="Moneda">
              <Input
                value={payments.paymentCurrency}
                onChange={e => setPayments(p => ({ ...p, paymentCurrency: e.target.value }))}
                placeholder="EUR"
              />
            </Field>
            <Field label="Validez de presupuestos (días)" hint="Días antes de que expire un presupuesto">
              <Input
                type="number"
                min="1"
                value={payments.paymentQuoteValidity}
                onChange={e => setPayments(p => ({ ...p, paymentQuoteValidity: e.target.value }))}
              />
            </Field>
            <Field label="Depósito por comensal en restaurante (€)" hint="Importe del depósito en reservas de restaurante">
              <Input
                type="number"
                min="0"
                step="0.5"
                value={payments.paymentDepositRestaurant}
                onChange={e => setPayments(p => ({ ...p, paymentDepositRestaurant: e.target.value }))}
              />
            </Field>
          </div>
        </Section>

        {/* ── Empresa Facturadora ── */}
        <Section
          icon={Building2}
          title="Empresa Facturadora / Datos Fiscales"
          description="Razón social, CIF y domicilio fiscal que aparecen en facturas, presupuestos y tickets TPV."
          onSave={() => saveSection("legalCompany", legalCompany)}
          saving={savingSection === "legalCompany"}
        >
          {/* Aviso legal */}
          <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl p-3 mb-2">
            <Info className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
            <p className="text-xs text-amber-800 font-display">
              Estos datos aparecen como <strong>emisor</strong> en todas las facturas y presupuestos generados por la plataforma, y en la cabecera de los tickets del TPV. Asegúrate de que coinciden exactamente con los datos registrados en la Agencia Tributaria.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Razón Social" col2>
              <Input
                value={legalCompany.legalCompanyName}
                onChange={e => setLegalCompany(p => ({ ...p, legalCompanyName: e.target.value }))}
                placeholder="NEXTAIR, S.L."
              />
            </Field>
            <Field label="CIF / NIF">
              <Input
                value={legalCompany.legalCompanyCif}
                onChange={e => setLegalCompany(p => ({ ...p, legalCompanyCif: e.target.value }))}
                placeholder="B16408031"
              />
            </Field>
            <Field label="Teléfono fiscal">
              <Input
                value={legalCompany.legalCompanyPhone}
                onChange={e => setLegalCompany(p => ({ ...p, legalCompanyPhone: e.target.value }))}
                placeholder="+34 958 000 000"
              />
            </Field>
            <Field label="Domicilio fiscal" col2>
              <Input
                value={legalCompany.legalCompanyAddress}
                onChange={e => setLegalCompany(p => ({ ...p, legalCompanyAddress: e.target.value }))}
                placeholder="C/JOSE LUIS PEREZ PUJADAS, Nº 14, PLTA.1, PUERTA D EDIFICIO FORUM"
              />
            </Field>
            <Field label="Código Postal">
              <Input
                value={legalCompany.legalCompanyZip}
                onChange={e => setLegalCompany(p => ({ ...p, legalCompanyZip: e.target.value }))}
                placeholder="18006"
              />
            </Field>
            <Field label="Municipio">
              <Input
                value={legalCompany.legalCompanyCity}
                onChange={e => setLegalCompany(p => ({ ...p, legalCompanyCity: e.target.value }))}
                placeholder="GRANADA"
              />
            </Field>
            <Field label="Provincia" col2>
              <Input
                value={legalCompany.legalCompanyProvince}
                onChange={e => setLegalCompany(p => ({ ...p, legalCompanyProvince: e.target.value }))}
                placeholder="Granada"
              />
            </Field>
            <Field label="Email fiscal" col2>
              <Input
                type="email"
                value={legalCompany.legalCompanyEmail}
                onChange={e => setLegalCompany(p => ({ ...p, legalCompanyEmail: e.target.value }))}
                placeholder="administracion@nextair.es"
              />
            </Field>
            <Field label="IBAN (para liquidaciones)" col2
              hint="Número de cuenta bancaria que aparece en los documentos de liquidación a proveedores">
              <Input
                value={legalCompany.legalCompanyIban}
                onChange={e => setLegalCompany(p => ({ ...p, legalCompanyIban: e.target.value }))}
                placeholder="ES00 0000 0000 0000 0000 0000"
              />
            </Field>
          </div>
        </Section>

        {/* ── Notificaciones ── */}
        <Section
          icon={Mail}
          title="Notificaciones y Alertas"
          description="Emails que reciben las alertas operativas del sistema (nuevas reservas, pagos, etc.)."
          onSave={() => saveSection("notifications", notifications)}
          saving={savingSection === "notifications"}
        >
          <div className="grid grid-cols-2 gap-4">
            <Field label="Email de alertas de reservas de experiencias" col2>
              <Input
                type="email"
                value={notifications.notifEmailBooking}
                onChange={e => setNotifications(p => ({ ...p, notifEmailBooking: e.target.value }))}
              />
            </Field>
            <Field label="Email de alertas de reservas de restaurante" col2>
              <Input
                type="email"
                value={notifications.notifEmailRestaurant}
                onChange={e => setNotifications(p => ({ ...p, notifEmailRestaurant: e.target.value }))}
              />
            </Field>
          </div>
          <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-xl">
            <Phone className="w-4 h-4 text-muted-foreground shrink-0" />
            <p className="text-xs text-muted-foreground font-display">
              Las notificaciones SMS se configuran a través del conector de GoHighLevel (GHL). Activa la integración en Secrets del panel de gestión.
            </p>
          </div>
        </Section>

        {/* ── Integración GHL (informativo) ── */}
        <div className="bg-card border border-border/50 rounded-2xl p-6">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-8 h-8 rounded-xl bg-blue-500/10 flex items-center justify-center">
              <SettingsIcon className="w-4 h-4 text-blue-500" />
            </div>
            <h3 className="font-heading font-semibold text-foreground">Integración GoHighLevel</h3>
          </div>
          <p className="text-sm font-display text-muted-foreground mb-4 ml-11">
            Las credenciales de GHL (API Key, Location ID) se gestionan como variables de entorno seguras en el panel de gestión del proyecto.
          </p>
          <div className="ml-11 space-y-2">
            <div className="flex items-center gap-2 text-sm font-display">
              <span className="w-2 h-2 rounded-full bg-muted-foreground/40" />
              <code className="text-xs bg-muted px-2 py-0.5 rounded font-mono">GHL_API_KEY</code>
              <span className="text-muted-foreground">— API Key de GoHighLevel</span>
            </div>
            <div className="flex items-center gap-2 text-sm font-display">
              <span className="w-2 h-2 rounded-full bg-muted-foreground/40" />
              <code className="text-xs bg-muted px-2 py-0.5 rounded font-mono">GHL_LOCATION_ID</code>
              <span className="text-muted-foreground">— ID de ubicación en GHL</span>
            </div>
          </div>
          <div className="mt-4 ml-11">
            <Button
              variant="outline"
              size="sm"
              onClick={() => toast.info("Accede a Secrets en el panel de gestión del proyecto para configurar GHL")}
              className="font-display"
            >
              Ver instrucciones
            </Button>
          </div>
        </div>

        {/* ── Prueba de plantillas de email ── */}
        <EmailPreviewSection />

      </div>
    </AdminLayout>
  );
}
