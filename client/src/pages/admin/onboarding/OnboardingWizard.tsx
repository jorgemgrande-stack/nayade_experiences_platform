import { useState, useEffect } from "react";
import { Redirect } from "wouter";
import { usePanelSubscription } from "@/hooks/usePanelSubscription";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n/I18nProvider";
import {
  Building2, Receipt, Palette, Mail, Settings2, Plug,
  Check, ChevronLeft, ChevronRight, Loader2, Shield,
  AlertTriangle, CheckCircle2, Circle,
} from "lucide-react";

// ─── Step Definitions ──────────────────────────────────────────────────────────

type StepId = "business_info" | "fiscal" | "branding" | "emails" | "modules" | "integrations";

interface StepField {
  key: string;
  type?: "text" | "email" | "url" | "number";
  placeholder?: string;
}

interface WizardStep {
  id: StepId;
  icon: React.ComponentType<{ className?: string }>;
  fields?: StepField[];
  hasNote?: boolean;
}

const STEPS: WizardStep[] = [
  {
    id: "business_info",
    icon: Building2,
    fields: [
      { key: "brand_name",          type: "text" },
      { key: "brand_short_name",    type: "text" },
      { key: "brand_phone",         type: "text" },
      { key: "brand_support_phone", type: "text" },
      { key: "brand_domain",        type: "text",  placeholder: "tuempresa.es" },
      { key: "brand_website_url",   type: "url",   placeholder: "https://..." },
      { key: "brand_location",      type: "text" },
    ],
  },
  {
    id: "fiscal",
    icon: Receipt,
    fields: [
      { key: "brand_nif",          type: "text" },
      { key: "brand_address",      type: "text" },
      { key: "tax_rate_general",   type: "number", placeholder: "21" },
      { key: "tax_rate_reduced",   type: "number", placeholder: "10" },
    ],
    hasNote: true,
  },
  {
    id: "branding",
    icon: Palette,
    fields: [
      { key: "brand_logo_url",        type: "url",  placeholder: "https://..." },
      { key: "brand_hero_image_url",  type: "url",  placeholder: "https://..." },
      { key: "brand_primary_color",   type: "text", placeholder: "#2563eb" },
      { key: "brand_accent_color",    type: "text", placeholder: "#f59e0b" },
      { key: "brand_instagram",       type: "url",  placeholder: "https://instagram.com/..." },
    ],
  },
  {
    id: "emails",
    icon: Mail,
    fields: [
      { key: "email_reservations",    type: "email" },
      { key: "email_admin_alerts",    type: "email" },
      { key: "email_accounting",      type: "email" },
      { key: "email_cancellations",   type: "email" },
      { key: "email_tpv_ingestion",   type: "email" },
      { key: "email_noreply_sender",  type: "email" },
      { key: "email_copy_recipient",  type: "email" },
    ],
  },
  { id: "modules", icon: Settings2 },
  { id: "integrations", icon: Plug },
];

// Modules shown in step 5 (key → label)
const MODULE_FLAGS: string[] = [
  "crm_module_enabled", "tpv_enabled", "cash_register_module_enabled", "bank_movements_module_enabled", "card_terminal_batches_enabled",
  "email_ingestion_enabled", "reav_module_enabled", "hotel_module_enabled", "spa_module_enabled", "restaurants_module_enabled",
  "ticketing_module_enabled", "suppliers_module_enabled", "cancellations_module_enabled",
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function StepIndicator({ step, index, isCurrent, isCompleted }: {
  step: WizardStep;
  index: number;
  isCurrent: boolean;
  isCompleted: boolean;
}) {
  const { t } = useI18n();
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
      <span className="text-sm font-medium">{t(`onboarding.steps.${step.id}.title`)}</span>
    </div>
  );
}

// ─── Fields Step ──────────────────────────────────────────────────────────────

function FieldsStep({ step, values, onChange }: {
  step: WizardStep;
  values: Record<string, string>;
  onChange: (key: string, value: string) => void;
}) {
  const { t } = useI18n();
  if (!step.fields) return null;
  return (
    <div className="space-y-4">
      {step.hasNote && (
        <div className="flex gap-3 bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-700 rounded-xl p-4">
          <Shield className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
          <p className="text-sm text-slate-600 dark:text-slate-400">{t("onboarding.steps.fiscal.note")}</p>
        </div>
      )}
      {step.fields.map(field => (
        <div key={field.key}>
          <label className="block text-sm font-medium text-foreground mb-1.5">{t(`onboarding.fields.${field.key}`)}</label>
          <Input
            type={field.type ?? "text"}
            value={values[field.key] ?? ""}
            onChange={e => onChange(field.key, e.target.value)}
            placeholder={field.key === "brand_domain" ? t("onboarding.fields.brand_domain_ph") : field.placeholder ?? ""}
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
  const { t } = useI18n();
  const flagMap = new Map(flags.map(f => [f.key, f]));

  return (
    <div className="space-y-3">
      <div className="flex gap-3 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-xl p-4">
        <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
        <p className="text-sm text-amber-800 dark:text-amber-200">
          {t("onboarding.modules.warning")}
        </p>
      </div>
      {MODULE_FLAGS.map(modKey => {
        const flag = flagMap.get(modKey);
        const enabled = flag?.enabled ?? true;
        return (
          <div key={modKey} className="flex items-center justify-between gap-4 p-4 bg-card border border-border/50 rounded-xl">
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">{t(`onboarding.modules.${modKey}.label`)}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{t(`onboarding.modules.${modKey}.description`)}</p>
            </div>
            <Switch
              checked={enabled}
              disabled={isPending || !flag}
              onCheckedChange={checked => onToggle(modKey, checked)}
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
  const { t } = useI18n();
  const groups = Array.from(new Set(envStatus.map(e => e.group)));

  return (
    <div className="space-y-5">
      <div className="flex gap-3 bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-700 rounded-xl p-4">
        <Shield className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
        <p className="text-sm text-slate-600 dark:text-slate-400">
          {t("onboarding.integrations.noteBefore")}<strong>{t("onboarding.integrations.noteBold")}</strong>{t("onboarding.integrations.noteAfter")}
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
                      <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">{t("onboarding.integrations.set")}</span>
                    </>
                  ) : (
                    <>
                      <Circle className="w-4 h-4 text-muted-foreground/40" />
                      <span className="text-xs text-muted-foreground">{t("onboarding.integrations.pending")}</span>
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

/**
 * En una empresa con licencias (multiempresa) el alta se hace en «Primeros pasos»: este asistente antiguo de la
 * instalación única muestra variables del entorno y activa módulos sin licencia, así que no se ofrece.
 */
export default function OnboardingWizard() {
  const sub = usePanelSubscription();
  if (sub.mode === "loading") return null;
  // Multiempresa (también si la suscripción falla): el asistente «Primeros pasos»; el de siempre, solo en single
  if (sub.mode === "tasks" || sub.install === "multi") return <Redirect to="/admin/primeros-pasos" />;
  return <OnboardingWizardLegacy />;
}

function OnboardingWizardLegacy() {
  const { t } = useI18n();
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
    onError: (e) => toast.error(t("onboarding.toast.moduleError", { message: e.message })),
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

      toast.success(t("onboarding.toast.stepSaved", { title: t(`onboarding.steps.${step.id}.title`) }));

      if (currentStep < STEPS.length - 1) {
        setCurrentStep(prev => prev + 1);
      } else {
        toast.success(t("onboarding.toast.allReady"));
      }
    } catch (e) {
      toast.error(t("onboarding.toast.stepError"));
    } finally {
      setSaving(false);
    }
  }

  async function completeModulesStep() {
    setSaving(true);
    try {
      await completeStepMut.mutateAsync({ step: "modules" });
      toast.success(t("onboarding.toast.modulesDone"));
      setCurrentStep(prev => prev + 1);
    } catch {
      toast.error(t("onboarding.toast.saveError"));
    } finally {
      setSaving(false);
    }
  }

  async function completeIntegrationsStep() {
    setSaving(true);
    try {
      await completeStepMut.mutateAsync({ step: "integrations" });
      toast.success(t("onboarding.toast.done"));
      statusQ.refetch();
    } catch {
      toast.error(t("onboarding.toast.saveError"));
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
          <h1 className="text-2xl font-heading font-bold text-foreground">{t("onboarding.title")}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {t("onboarding.intro")}
          </p>
        </div>

        {/* Progress bar */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-medium text-muted-foreground">{t("onboarding.progress")}</span>
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
              {t("onboarding.allDone")}
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
                  <h2 className="text-lg font-semibold text-foreground">{t(`onboarding.steps.${step.id}.title`)}</h2>
                  {completedMap[step.id] && (
                    <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400">
                      {t("onboarding.completed")}
                    </span>
                  )}
                </div>
                <p className="text-sm text-muted-foreground">{t(`onboarding.steps.${step.id}.subtitle`)}</p>
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
                  {t("onboarding.back")}
                </Button>

                {step.id === "modules" ? (
                  <Button
                    size="sm"
                    disabled={saving}
                    onClick={completeModulesStep}
                  >
                    {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                    {t("onboarding.continue")}
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
                    {allDone ? t("onboarding.backToPanel") : t("onboarding.finish")}
                    {!allDone && <Check className="w-4 h-4 ml-1" />}
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    disabled={saving}
                    onClick={saveCurrentStep}
                  >
                    {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                    {t("onboarding.saveContinue")}
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
