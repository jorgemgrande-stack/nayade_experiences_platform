import { useState, useEffect } from "react";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Building2, Receipt, Palette, Mail, Settings2, Plug,
  Check, ChevronLeft, ChevronRight, Loader2, Shield,
  AlertTriangle, CheckCircle2, Circle,
} from "lucide-react";

// ─── Step Definitions ──────────────────────────────────────────────────────────

type StepId = "business_info" | "fiscal" | "branding" | "emails" | "modules" | "integrations";

interface StepField {
  key: string;
  label: string;
  type?: "text" | "email" | "url" | "number";
  placeholder?: string;
}

interface WizardStep {
  id: StepId;
  title: string;
  subtitle: string;
  icon: React.ComponentType<{ className?: string }>;
  fields?: StepField[];
  note?: string;
}

const STEPS: WizardStep[] = [
  {
    id: "business_info",
    title: "Información del negocio",
    subtitle: "Nombre, teléfono y datos de contacto del negocio",
    icon: Building2,
    fields: [
      { key: "brand_name",          label: "Nombre comercial",              type: "text" },
      { key: "brand_short_name",    label: "Nombre corto",                  type: "text" },
      { key: "brand_phone",         label: "Teléfono principal",            type: "text" },
      { key: "brand_support_phone", label: "Teléfono de reservas / soporte", type: "text" },
      { key: "brand_domain",        label: "Dominio web",                   type: "text",  placeholder: "nayadeexperiences.es" },
      { key: "brand_website_url",   label: "URL completa de la web",        type: "url",   placeholder: "https://..." },
      { key: "brand_location",      label: "Localización / dirección breve", type: "text" },
    ],
  },
  {
    id: "fiscal",
    title: "Datos fiscales",
    subtitle: "NIF/CIF, domicilio fiscal e impuestos",
    icon: Receipt,
    fields: [
      { key: "brand_nif",          label: "NIF / CIF",               type: "text" },
      { key: "brand_address",      label: "Domicilio fiscal completo", type: "text" },
      { key: "tax_rate_general",   label: "IVA general (%)",          type: "number", placeholder: "21" },
      { key: "tax_rate_reduced",   label: "IVA reducido (%)",         type: "number", placeholder: "10" },
    ],
    note: "El IBAN y credenciales bancarias no se almacenan en base de datos. Configúralos en Railway como variables de entorno si fueran necesarios.",
  },
  {
    id: "branding",
    title: "Branding",
    subtitle: "Logo, colores e imagen visual de la marca",
    icon: Palette,
    fields: [
      { key: "brand_logo_url",        label: "URL del logotipo",             type: "url",  placeholder: "https://..." },
      { key: "brand_hero_image_url",  label: "URL imagen hero (opcional)",   type: "url",  placeholder: "https://..." },
      { key: "brand_primary_color",   label: "Color principal (hex)",        type: "text", placeholder: "#2563eb" },
      { key: "brand_accent_color",    label: "Color acento (hex)",           type: "text", placeholder: "#f59e0b" },
      { key: "brand_instagram",       label: "URL perfil de Instagram",      type: "url",  placeholder: "https://instagram.com/..." },
    ],
  },
  {
    id: "emails",
    title: "Emails y notificaciones",
    subtitle: "Direcciones de correo para cada tipo de notificación (vacío = usa el email por defecto del sistema)",
    icon: Mail,
    fields: [
      { key: "email_reservations",    label: "Email de reservas",           type: "email" },
      { key: "email_admin_alerts",    label: "Email de alertas de admin",   type: "email" },
      { key: "email_accounting",      label: "Email de contabilidad",       type: "email" },
      { key: "email_cancellations",   label: "Email de cancelaciones",      type: "email" },
      { key: "email_tpv_ingestion",   label: "Email ingesta datáfono",      type: "email" },
      { key: "email_noreply_sender",  label: "Email remitente noreply",     type: "email" },
      { key: "email_copy_recipient",  label: "Email copia de reservas",     type: "email" },
    ],
  },
  {
    id: "modules",
    title: "Módulos activos",
    subtitle: "Activa o desactiva los módulos que usa tu negocio",
    icon: Settings2,
  },
  {
    id: "integrations",
    title: "Integraciones externas",
    subtitle: "Credenciales de servicios externos — solo se configuran en Railway, nunca en base de datos",
    icon: Plug,
  },
];

// Modules shown in step 5 (key → label)
const MODULE_FLAGS: Array<{ key: string; label: string; description: string }> = [
  { key: "crm_module_enabled",                    label: "CRM",                          description: "Leads, presupuestos, reservas y clientes" },
  { key: "tpv_enabled",                           label: "TPV físico",                   description: "Terminal punto de venta presencial" },
  { key: "cash_register_module_enabled",          label: "Caja registradora",            description: "Seguimiento de fondos y cierres de caja" },
  { key: "bank_movements_module_enabled",         label: "Movimientos bancarios",        description: "Importación y gestión de extractos bancarios" },
  { key: "card_terminal_batches_enabled",         label: "Conciliación datáfono",        description: "Liquidaciones y batches del datáfono" },
  { key: "email_ingestion_enabled",               label: "Ingesta de emails IMAP",       description: "Lectura automática de emails del datáfono" },
  { key: "reav_module_enabled",                   label: "Expedientes REAV",             description: "Gestión de expedientes REAV" },
  { key: "hotel_module_enabled",                  label: "Hotel",                        description: "Habitaciones y reservas de hotel" },
  { key: "spa_module_enabled",                    label: "SPA",                          description: "Reservas de spa y tratamientos" },
  { key: "restaurants_module_enabled",            label: "Restaurantes",                 description: "Reservas de restaurante" },
  { key: "ticketing_module_enabled",              label: "Ticketing",                    description: "Venta de entradas individuales" },
  { key: "suppliers_module_enabled",              label: "Proveedores",                  description: "Gestión de proveedores y liquidaciones" },
  { key: "cancellations_module_enabled",          label: "Módulo cancelaciones",         description: "Seguimiento y procesamiento de cancelaciones" },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function StepIndicator({ step, index, isCurrent, isCompleted }: {
  step: WizardStep;
  index: number;
  isCurrent: boolean;
  isCompleted: boolean;
}) {
  const Icon = step.icon;
  return (
    <div className={`flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors ${
      isCurrent ? "bg-primary/10 text-primary" : "text-muted-foreground"
    }`}>
      <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 text-xs font-bold ${
        isCompleted ? "bg-emerald-500 text-white" : isCurrent ? "bg-primary text-white" : "bg-muted text-muted-foreground"
      }`}>
        {isCompleted ? <Check className="w-3.5 h-3.5" /> : index + 1}
      </div>
      <span className="text-sm font-medium">{step.title}</span>
    </div>
  );
}

// ─── Fields Step ──────────────────────────────────────────────────────────────

function FieldsStep({ step, values, onChange }: {
  step: WizardStep;
  values: Record<string, string>;
  onChange: (key: string, value: string) => void;
}) {
  if (!step.fields) return null;
  return (
    <div className="space-y-4">
      {step.note && (
        <div className="flex gap-3 bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-700 rounded-xl p-4">
          <Shield className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
          <p className="text-sm text-slate-600 dark:text-slate-400">{step.note}</p>
        </div>
      )}
      {step.fields.map(field => (
        <div key={field.key}>
          <label className="block text-sm font-medium text-foreground mb-1.5">{field.label}</label>
          <Input
            type={field.type ?? "text"}
            value={values[field.key] ?? ""}
            onChange={e => onChange(field.key, e.target.value)}
            placeholder={field.placeholder ?? ""}
            className="h-9"
          />
        </div>
      ))}
    </div>
  );
}

// ─── Modules Step ─────────────────────────────────────────────────────────────

function ModulesStep({ flags, onToggle, isPending }: {
  flags: Array<{ key: string; enabled: boolean; riskLevel: string }>;
  onToggle: (key: string, enabled: boolean) => void;
  isPending: boolean;
}) {
  const flagMap = new Map(flags.map(f => [f.key, f]));

  return (
    <div className="space-y-3">
      <div className="flex gap-3 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-xl p-4">
        <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
        <p className="text-sm text-amber-800 dark:text-amber-200">
          Los cambios son inmediatos. Desactivar un módulo oculta su sección en el panel de admin.
        </p>
      </div>
      {MODULE_FLAGS.map(mod => {
        const flag = flagMap.get(mod.key);
        const enabled = flag?.enabled ?? true;
        return (
          <div key={mod.key} className="flex items-center justify-between gap-4 p-4 bg-card border border-border/50 rounded-xl">
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">{mod.label}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{mod.description}</p>
            </div>
            <Switch
              checked={enabled}
              disabled={isPending || !flag}
              onCheckedChange={checked => onToggle(mod.key, checked)}
            />
          </div>
        );
      })}
    </div>
  );
}

// ─── Integrations Step ────────────────────────────────────────────────────────

function IntegrationsStep({ envStatus }: {
  envStatus: Array<{ key: string; label: string; group: string; isSet: boolean }>;
}) {
  const groups = [...new Set(envStatus.map(e => e.group))];

  return (
    <div className="space-y-5">
      <div className="flex gap-3 bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-700 rounded-xl p-4">
        <Shield className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Las credenciales de integraciones externas <strong>nunca se guardan en base de datos</strong>.
          Configúralas directamente en las variables de entorno de Railway.
        </p>
      </div>

      {groups.map(group => (
        <div key={group} className="bg-card border border-border/50 rounded-xl overflow-hidden">
          <div className="px-4 py-2.5 bg-muted/30 border-b border-border/50">
            <h4 className="text-xs font-semibold text-foreground uppercase tracking-wide">{group}</h4>
          </div>
          <div className="divide-y divide-border/30">
            {envStatus.filter(e => e.group === group).map(env => (
              <div key={env.key} className="flex items-center justify-between gap-4 px-4 py-3">
                <div>
                  <p className="text-sm font-medium text-foreground">{env.label}</p>
                  <code className="text-xs font-mono text-muted-foreground/60">{env.key}</code>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {env.isSet ? (
                    <>
                      <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                      <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">Configurado</span>
                    </>
                  ) : (
                    <>
                      <Circle className="w-4 h-4 text-muted-foreground/40" />
                      <span className="text-xs text-muted-foreground">Pendiente en Railway</span>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Main Wizard ──────────────────────────────────────────────────────────────

export default function OnboardingWizard() {
  const [currentStep, setCurrentStep] = useState(0);
  const [values, setValues] = useState<Record<string, string>>({});
  const [initialized, setInitialized] = useState(false);
  const [saving, setSaving] = useState(false);

  const settingsQ = trpc.config.listSystemSettings.useQuery();
  const flagsQ = trpc.config.listFeatureFlags.useQuery();
  const statusQ = trpc.onboarding.getStatus.useQuery();
  const envQ = trpc.onboarding.getEnvStatus.useQuery();

  const updateSettingMut = trpc.config.updateSystemSetting.useMutation();
  const updateFlagMut = trpc.config.updateFeatureFlag.useMutation({
    onSuccess: () => flagsQ.refetch(),
    onError: (e) => toast.error("Error al cambiar módulo: " + e.message),
  });
  const completeStepMut = trpc.onboarding.completeStep.useMutation({
    onSuccess: () => statusQ.refetch(),
  });

  // Initialize form values from DB settings (once)
  useEffect(() => {
    if (settingsQ.data && !initialized) {
      const init: Record<string, string> = {};
      settingsQ.data.forEach(s => {
        if (!s.isSensitive) {
          init[s.key] = s.value ?? "";
        }
      });
      setValues(init);
      setInitialized(true);
    }
  }, [settingsQ.data, initialized]);

  function handleChange(key: string, value: string) {
    setValues(prev => ({ ...prev, [key]: value }));
  }

  async function saveCurrentStep() {
    const step = STEPS[currentStep];
    setSaving(true);
    try {
      // Save all fields in this step (skip sensitive fields, skip empty on first steps if desired)
      if (step.fields) {
        for (const field of step.fields) {
          const value = values[field.key] ?? "";
          try {
            await updateSettingMut.mutateAsync({ key: field.key, value });
          } catch {
            // Some fields may not exist in DB yet — log but don't block wizard
            console.warn(`[Onboarding] Could not save setting: ${field.key}`);
          }
        }
      }

      // Mark step as completed
      await completeStepMut.mutateAsync({ step: step.id });

      toast.success(`Paso "${step.title}" guardado`);

      if (currentStep < STEPS.length - 1) {
        setCurrentStep(prev => prev + 1);
      } else {
        toast.success("¡Configuración completada! El sistema está listo.");
      }
    } catch (e) {
      toast.error("Error al guardar el paso");
    } finally {
      setSaving(false);
    }
  }

  async function completeModulesStep() {
    setSaving(true);
    try {
      await completeStepMut.mutateAsync({ step: "modules" });
      toast.success("Módulos configurados");
      setCurrentStep(prev => prev + 1);
    } catch {
      toast.error("Error al guardar");
    } finally {
      setSaving(false);
    }
  }

  async function completeIntegrationsStep() {
    setSaving(true);
    try {
      await completeStepMut.mutateAsync({ step: "integrations" });
      toast.success("¡Configuración completada!");
      statusQ.refetch();
    } catch {
      toast.error("Error al guardar");
    } finally {
      setSaving(false);
    }
  }

  const statusData = statusQ.data;
  const completedMap: Record<StepId, boolean> = {
    business_info: statusData?.businessInfoCompleted ?? false,
    fiscal:        statusData?.fiscalCompleted ?? false,
    branding:      statusData?.brandingCompleted ?? false,
    emails:        statusData?.emailsCompleted ?? false,
    modules:       statusData?.modulesCompleted ?? false,
    integrations:  statusData?.integrationsReviewed ?? false,
  };

  const progress = statusData?.progress ?? 0;
  const step = STEPS[currentStep];
  const isLoading = settingsQ.isLoading || flagsQ.isLoading || statusQ.isLoading;
  const isLastStep = currentStep === STEPS.length - 1;
  const allDone = progress === 100;

  return (
    <AdminLayout>
      <div className="max-w-4xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl font-heading font-bold text-foreground">Configuración inicial</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Completa los datos de tu negocio para empezar a usar la plataforma.
          </p>
        </div>

        {/* Progress bar */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-medium text-muted-foreground">Progreso de configuración</span>
            <span className="text-xs font-semibold text-foreground">{progress}%</span>
          </div>
          <div className="h-2 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-emerald-500 transition-all duration-500 rounded-full"
              style={{ width: `${progress}%` }}
            />
          </div>
          {allDone && (
            <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-1 flex items-center gap-1">
              <CheckCircle2 className="w-3.5 h-3.5" />
              Configuración completada. Puedes editar cualquier sección cuando quieras.
            </p>
          )}
        </div>

        {isLoading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="flex gap-0 bg-card border border-border/50 rounded-2xl overflow-hidden">
            {/* Sidebar */}
            <aside className="w-56 shrink-0 border-r border-border/50 py-3">
              {STEPS.map((s, idx) => (
                <button
                  key={s.id}
                  onClick={() => setCurrentStep(idx)}
                  className="w-full text-left"
                >
                  <StepIndicator
                    step={s}
                    index={idx}
                    isCurrent={currentStep === idx}
                    isCompleted={completedMap[s.id]}
                  />
                </button>
              ))}
            </aside>

            {/* Content */}
            <div className="flex-1 min-w-0 p-6">
              {/* Step header */}
              <div className="mb-5">
                <div className="flex items-center gap-2 mb-1">
                  {(() => { const Icon = step.icon; return <Icon className="w-5 h-5 text-muted-foreground" />; })()}
                  <h2 className="text-lg font-semibold text-foreground">{step.title}</h2>
                  {completedMap[step.id] && (
                    <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400">
                      Completado
                    </span>
                  )}
                </div>
                <p className="text-sm text-muted-foreground">{step.subtitle}</p>
              </div>

              {/* Step content */}
              {step.id === "modules" ? (
                <ModulesStep
                  flags={flagsQ.data ?? []}
                  onToggle={(key, enabled) => updateFlagMut.mutate({ key, enabled })}
                  isPending={updateFlagMut.isPending}
                />
              ) : step.id === "integrations" ? (
                <IntegrationsStep envStatus={envQ.data ?? []} />
              ) : (
                <FieldsStep step={step} values={values} onChange={handleChange} />
              )}

              {/* Navigation */}
              <div className="flex items-center justify-between mt-8 pt-5 border-t border-border/50">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentStep(prev => Math.max(0, prev - 1))}
                  disabled={currentStep === 0}
                >
                  <ChevronLeft className="w-4 h-4 mr-1" />
                  Anterior
                </Button>

                {step.id === "modules" ? (
                  <Button
                    size="sm"
                    disabled={saving}
                    onClick={completeModulesStep}
                  >
                    {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                    Continuar
                    <ChevronRight className="w-4 h-4 ml-1" />
                  </Button>
                ) : step.id === "integrations" ? (
                  <Button
                    size="sm"
                    disabled={saving}
                    onClick={completeIntegrationsStep}
                    variant={allDone ? "outline" : "default"}
                  >
                    {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                    {allDone ? "Volver al panel" : "Finalizar configuración"}
                    {!allDone && <Check className="w-4 h-4 ml-1" />}
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    disabled={saving}
                    onClick={saveCurrentStep}
                  >
                    {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                    Guardar y continuar
                    <ChevronRight className="w-4 h-4 ml-1" />
                  </Button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
