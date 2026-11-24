import AdminLayout from "@/components/AdminLayout";
import { PanelPageHeader } from "@/components/admin/PanelUi";
import { trpc } from "@/lib/trpc";
import { usePanelSubscription } from "@/hooks/usePanelSubscription";
import { useVocabulary } from "@/lib/vocabulary";
import { COMPANY_DATA_HREF } from "./configSections";
import { SetupStatusCard } from "@/components/onboarding/SetupStatusCard";
import { SETUP_WIZARD_PATH } from "@/components/SetupWizardLink";
import { useI18n } from "@/i18n/I18nProvider";
import {
  CheckCircle2, Circle, AlertTriangle, Loader2,
  Building2, Receipt, Mail, Palette, Settings2, Plug,
  ExternalLink,
} from "lucide-react";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function StatusIcon({ ok, warn }: { ok: boolean; warn?: boolean }) {
  if (ok) return <CheckCircle2 className="w-4 h-4 text-success shrink-0" />;
  if (warn) return <AlertTriangle className="w-4 h-4 text-warning shrink-0" />;
  return <Circle className="w-4 h-4 text-muted-foreground/40 shrink-0" />;
}

interface SectionCardProps {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  items: Array<{ label: string; ok: boolean; note?: string }>;
  editHref?: string;
}

function SectionCard({ icon: Icon, title, items, editHref }: SectionCardProps) {
  const { t } = useI18n();
  const allOk = items.every(i => i.ok);
  const anyOk = items.some(i => i.ok);

  return (
    <div className="bg-card border border-border/50 rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3 bg-muted/30 border-b border-border/50">
        <div className="flex items-center gap-2">
          <Icon className="w-4 h-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
            allOk
              ? "bg-success/10 text-success"
              : anyOk
                ? "bg-warning/10 text-warning"
                : "bg-muted text-muted-foreground"
          }`}>
            {allOk ? t("settingsStatus.card.configured") : anyOk ? t("settingsStatus.card.partial") : t("settingsStatus.card.pending")}
          </span>
          {editHref && (
            <a
              href={editHref}
              className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-0.5 transition-colors"
            >
              {t("settingsStatus.card.edit")} <ExternalLink className="w-3 h-3" />
            </a>
          )}
        </div>
      </div>
      <div className="px-5 py-3 space-y-2">
        {items.map(item => (
          <div key={item.label} className="flex items-center gap-2.5">
            <StatusIcon ok={item.ok} warn={!item.ok} />
            <span className="text-sm text-foreground flex-1">{item.label}</span>
            {item.note && <span className="text-xs text-muted-foreground">{item.note}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function ConfigStatus() {
  const { t } = useI18n();
  // Empresa con licencias por capacidad: sin variables del servidor ni feature flags, y los datos de empresa se
  // editan en «Datos de la empresa». En single, como siempre.
  const sub = usePanelSubscription();
  const technical = sub.mode === "legacy";
  const voc = useVocabulary();
  const settingsQ = trpc.config.listSystemSettings.useQuery();
  const flagsQ = trpc.config.listFeatureFlags.useQuery(undefined, { enabled: technical });
  const wizard = trpc.setupWizard.status.useQuery(undefined, { retry: false, staleTime: 60_000 });
  const envQ = trpc.onboarding.getEnvStatus.useQuery(undefined, { enabled: technical });
  const companyHref = technical ? SETUP_WIZARD_PATH : COMPANY_DATA_HREF;
  const settingsHref = technical ? SETUP_WIZARD_PATH : "/admin/configuracion";

  const isLoading = sub.mode === "loading" || settingsQ.isLoading || (technical && (flagsQ.isLoading || envQ.isLoading)) || wizard.isLoading;

  if (isLoading) {
    return (
      <AdminLayout>
        <div className="flex justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      </AdminLayout>
    );
  }

  const settings = settingsQ.data ?? [];
  const flags = flagsQ.data ?? [];
  const env = envQ.data ?? [];

  const getSetting = (key: string) => settings.find(s => s.key === key)?.value ?? "";
  const hasValue = (key: string) => getSetting(key).trim() !== "";
  const isFlagEnabled = (key: string) => flags.find(f => f.key === key)?.enabled ?? true;

  // Active modules (flags enabled)
  const activeModules = flags.filter(f => f.enabled && f.module !== "general");
  const moduleGroups = Array.from(new Set(activeModules.map(f => f.module))).sort();

  // Env summary
  const envGroups = Array.from(new Set(env.map(e => e.group)));
  const envByGroup = (group: string) => env.filter(e => e.group === group);

  return (
    <AdminLayout>
      <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
        {/* Header */}
        <PanelPageHeader title={t("settingsStatus.title")} description={t("settingsStatus.intro")} />

        {/* Estado de la configuración: el mismo recorrido que «Primeros pasos» */}
        {wizard.data && <SetupStatusCard plan={wizard.data.plan} />}

        {/* Business & Fiscal */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <SectionCard
            icon={Building2}
            title={technical ? t("settingsStatus.business.titleTech") : t("settingsStatus.business.titleCompany")}
            editHref={companyHref}
            items={[
              { label: t("settingsStatus.business.name"),  ok: hasValue("brand_name"),          note: getSetting("brand_name") || undefined },
              { label: t("settingsStatus.business.phone"),          ok: hasValue("brand_phone") || hasValue("brand_support_phone") },
              { label: t("settingsStatus.business.domain"),       ok: hasValue("brand_domain"),         note: getSetting("brand_domain") || undefined },
              { label: t("settingsStatus.business.location"),      ok: hasValue("brand_location") },
            ]}
          />
          <SectionCard
            icon={Receipt}
            title={t("settingsStatus.fiscal.title")}
            editHref={companyHref}
            items={[
              { label: t("settingsStatus.fiscal.taxId"),         ok: hasValue("brand_nif"),     note: getSetting("brand_nif") || undefined },
              { label: t("settingsStatus.fiscal.address"),   ok: hasValue("brand_address") },
              { label: t("settingsStatus.fiscal.vatGeneral"),        ok: hasValue("tax_rate_general"), note: getSetting("tax_rate_general") ? `${getSetting("tax_rate_general")}%` : undefined },
              { label: t("settingsStatus.fiscal.vatReduced"),       ok: hasValue("tax_rate_reduced"), note: getSetting("tax_rate_reduced") ? `${getSetting("tax_rate_reduced")}%` : undefined },
            ]}
          />
        </div>

        {/* Emails */}
        <SectionCard
          icon={Mail}
          title={t("settingsStatus.emails.title")}
          editHref={settingsHref}
          items={[
            { label: t("settingsStatus.emails.orders", { what: voc.ordersLower }), ok: hasValue("email_reservations"),   note: getSetting("email_reservations") || t("settingsStatus.emails.usingDefault") },
            { label: t("settingsStatus.emails.admin"),  ok: hasValue("email_admin_alerts"),   note: getSetting("email_admin_alerts") || t("settingsStatus.emails.usingDefault") },
            { label: t("settingsStatus.emails.accounting"),   ok: hasValue("email_accounting"),     note: getSetting("email_accounting") || t("settingsStatus.emails.usingDefault") },
            { label: t("settingsStatus.emails.cancellations"),  ok: hasValue("email_cancellations"),  note: getSetting("email_cancellations") || t("settingsStatus.emails.usingDefault") },
            { label: t("settingsStatus.emails.noreply"),    ok: hasValue("email_noreply_sender"), note: getSetting("email_noreply_sender") || t("settingsStatus.emails.usingDefault") },
          ]}
        />

        {/* Branding */}
        <SectionCard
          icon={Palette}
          title={technical ? t("settingsStatus.branding.titleTech") : t("settingsStatus.branding.titleBrand")}
          editHref={settingsHref}
          items={[
            { label: t("settingsStatus.branding.logo"),        ok: hasValue("brand_logo_url") },
            { label: t("settingsStatus.branding.primary"), ok: hasValue("brand_primary_color"), note: getSetting("brand_primary_color") || undefined },
            { label: t("settingsStatus.branding.accent"),    ok: hasValue("brand_accent_color"),  note: getSetting("brand_accent_color") || undefined },
            { label: t("settingsStatus.branding.instagram"),       ok: hasValue("brand_instagram") },
          ]}
        />

        {/* Active modules */}
        {technical && <div className="bg-card border border-border/50 rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3 bg-muted/30 border-b border-border/50">
            <div className="flex items-center gap-2">
              <Settings2 className="w-4 h-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold text-foreground">{t("settingsStatus.modules.title")}</h3>
            </div>
            <a href={SETUP_WIZARD_PATH} className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-0.5 transition-colors">
              {t("settingsStatus.card.edit")} <ExternalLink className="w-3 h-3" />
            </a>
          </div>
          <div className="p-5">
            {moduleGroups.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">{t("settingsStatus.modules.none")}</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {moduleGroups.map(group => {
                  const groupFlags = activeModules.filter(f => f.module === group);
                  return groupFlags.map(f => (
                    <span key={f.key} className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full bg-success/10 text-success">
                      <CheckCircle2 className="w-3 h-3" />
                      {f.name}
                    </span>
                  ));
                })}
              </div>
            )}
          </div>
        </div>}

        {/* Integrations / env vars */}
        {technical && <div className="bg-card border border-border/50 rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3 bg-muted/30 border-b border-border/50">
            <div className="flex items-center gap-2">
              <Plug className="w-4 h-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold text-foreground">{t("settingsStatus.env.title")}</h3>
            </div>
            <span className="text-xs text-muted-foreground">
              {t("settingsStatus.env.configured", { set: env.filter(e => e.isSet).length, total: env.length })}
            </span>
          </div>
          <div className="divide-y divide-border/30">
            {envGroups.map(group => (
              <div key={group} className="px-5 py-4">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">{group}</p>
                <div className="space-y-2">
                  {envByGroup(group).map(e => (
                    <div key={e.key} className="flex items-center gap-2.5">
                      {e.isSet
                        ? <CheckCircle2 className="w-3.5 h-3.5 text-success shrink-0" />
                        : <Circle className="w-3.5 h-3.5 text-muted-foreground/40 shrink-0" />}
                      <span className="text-sm text-foreground flex-1">{e.label}</span>
                      <code className="text-xs font-mono text-muted-foreground/60">{e.key}</code>
                      {!e.isSet && (
                        <span className="text-xs text-warning font-medium">{t("settingsStatus.card.pending")}</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>}
      </div>
    </AdminLayout>
  );
}
