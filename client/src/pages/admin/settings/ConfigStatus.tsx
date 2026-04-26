import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import {
  CheckCircle2, Circle, AlertTriangle, Loader2,
  Building2, Receipt, Mail, Palette, Settings2, Plug,
  ExternalLink,
} from "lucide-react";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function StatusIcon({ ok, warn }: { ok: boolean; warn?: boolean }) {
  if (ok) return <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />;
  if (warn) return <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />;
  return <Circle className="w-4 h-4 text-muted-foreground/40 shrink-0" />;
}

interface SectionCardProps {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  items: Array<{ label: string; ok: boolean; note?: string }>;
  editHref?: string;
}

function SectionCard({ icon: Icon, title, items, editHref }: SectionCardProps) {
  const allOk = items.every(i => i.ok);
  const anyOk = items.some(i => i.ok);

  return (
    <div className="bg-card border border-border/50 rounded-2xl overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3 bg-muted/30 border-b border-border/50">
        <div className="flex items-center gap-2">
          <Icon className="w-4 h-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
            allOk
              ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400"
              : anyOk
                ? "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400"
                : "bg-muted text-muted-foreground"
          }`}>
            {allOk ? "Configurado" : anyOk ? "Parcial" : "Pendiente"}
          </span>
          {editHref && (
            <a
              href={editHref}
              className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-0.5 transition-colors"
            >
              Editar <ExternalLink className="w-3 h-3" />
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
  const settingsQ = trpc.config.listSystemSettings.useQuery();
  const flagsQ = trpc.config.listFeatureFlags.useQuery();
  const statusQ = trpc.onboarding.getStatus.useQuery();
  const envQ = trpc.onboarding.getEnvStatus.useQuery();

  const isLoading = settingsQ.isLoading || flagsQ.isLoading || statusQ.isLoading || envQ.isLoading;

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
  const status = statusQ.data;
  const env = envQ.data ?? [];

  const getSetting = (key: string) => settings.find(s => s.key === key)?.value ?? "";
  const hasValue = (key: string) => getSetting(key).trim() !== "";
  const isFlagEnabled = (key: string) => flags.find(f => f.key === key)?.enabled ?? true;

  const progress = status?.progress ?? 0;

  // Active modules (flags enabled)
  const activeModules = flags.filter(f => f.enabled && f.module !== "general");
  const moduleGroups = [...new Set(activeModules.map(f => f.module))].sort();

  // Env summary
  const envGroups = [...new Set(env.map(e => e.group))];
  const envByGroup = (group: string) => env.filter(e => e.group === group);

  return (
    <AdminLayout>
      <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-heading font-bold text-foreground">Estado del sistema</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Resumen de la configuración del negocio y estado de integraciones.
          </p>
        </div>

        {/* Progress */}
        <div className="bg-card border border-border/50 rounded-2xl p-5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-foreground">Configuración completada</span>
            <span className="text-lg font-bold text-foreground">{progress}%</span>
          </div>
          <div className="h-2.5 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500 bg-emerald-500"
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="flex flex-wrap gap-3 mt-4">
            {[
              { label: "Negocio",       done: status?.businessInfoCompleted },
              { label: "Fiscal",        done: status?.fiscalCompleted },
              { label: "Branding",      done: status?.brandingCompleted },
              { label: "Emails",        done: status?.emailsCompleted },
              { label: "Módulos",       done: status?.modulesCompleted },
              { label: "Integraciones", done: status?.integrationsReviewed },
            ].map(s => (
              <div key={s.label} className="flex items-center gap-1.5">
                {s.done
                  ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                  : <Circle className="w-3.5 h-3.5 text-muted-foreground/40" />}
                <span className={`text-xs font-medium ${s.done ? "text-foreground" : "text-muted-foreground"}`}>
                  {s.label}
                </span>
              </div>
            ))}
          </div>
          <div className="mt-3">
            <a href="/admin/onboarding" className="text-xs text-primary hover:underline flex items-center gap-1">
              {progress < 100 ? "Completar configuración" : "Revisar configuración"}
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        </div>

        {/* Business & Fiscal */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <SectionCard
            icon={Building2}
            title="Información del negocio"
            editHref="/admin/onboarding"
            items={[
              { label: "Nombre comercial",  ok: hasValue("brand_name"),          note: getSetting("brand_name") || undefined },
              { label: "Teléfono",          ok: hasValue("brand_phone") || hasValue("brand_support_phone") },
              { label: "Dominio web",       ok: hasValue("brand_domain"),         note: getSetting("brand_domain") || undefined },
              { label: "Localización",      ok: hasValue("brand_location") },
            ]}
          />
          <SectionCard
            icon={Receipt}
            title="Datos fiscales"
            editHref="/admin/onboarding"
            items={[
              { label: "NIF / CIF",         ok: hasValue("brand_nif"),     note: getSetting("brand_nif") || undefined },
              { label: "Domicilio fiscal",   ok: hasValue("brand_address") },
              { label: "IVA general",        ok: hasValue("tax_rate_general"), note: getSetting("tax_rate_general") ? `${getSetting("tax_rate_general")}%` : undefined },
              { label: "IVA reducido",       ok: hasValue("tax_rate_reduced"), note: getSetting("tax_rate_reduced") ? `${getSetting("tax_rate_reduced")}%` : undefined },
            ]}
          />
        </div>

        {/* Emails */}
        <SectionCard
          icon={Mail}
          title="Emails y notificaciones"
          editHref="/admin/onboarding"
          items={[
            { label: "Email de reservas",    ok: hasValue("email_reservations"),   note: getSetting("email_reservations") || "(usando valor por defecto)" },
            { label: "Email alertas admin",  ok: hasValue("email_admin_alerts"),   note: getSetting("email_admin_alerts") || "(usando valor por defecto)" },
            { label: "Email contabilidad",   ok: hasValue("email_accounting"),     note: getSetting("email_accounting") || "(usando valor por defecto)" },
            { label: "Email cancelaciones",  ok: hasValue("email_cancellations"),  note: getSetting("email_cancellations") || "(usando valor por defecto)" },
            { label: "Remitente noreply",    ok: hasValue("email_noreply_sender"), note: getSetting("email_noreply_sender") || "(usando valor por defecto)" },
          ]}
        />

        {/* Branding */}
        <SectionCard
          icon={Palette}
          title="Branding"
          editHref="/admin/onboarding"
          items={[
            { label: "Logotipo",        ok: hasValue("brand_logo_url") },
            { label: "Color principal", ok: hasValue("brand_primary_color"), note: getSetting("brand_primary_color") || undefined },
            { label: "Color acento",    ok: hasValue("brand_accent_color"),  note: getSetting("brand_accent_color") || undefined },
            { label: "Instagram",       ok: hasValue("brand_instagram") },
          ]}
        />

        {/* Active modules */}
        <div className="bg-card border border-border/50 rounded-2xl overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3 bg-muted/30 border-b border-border/50">
            <div className="flex items-center gap-2">
              <Settings2 className="w-4 h-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold text-foreground">Módulos activos</h3>
            </div>
            <a href="/admin/onboarding" className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-0.5 transition-colors">
              Editar <ExternalLink className="w-3 h-3" />
            </a>
          </div>
          <div className="p-5">
            {moduleGroups.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">No hay módulos activos.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {moduleGroups.map(group => {
                  const groupFlags = activeModules.filter(f => f.module === group);
                  return groupFlags.map(f => (
                    <span key={f.key} className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400">
                      <CheckCircle2 className="w-3 h-3" />
                      {f.name}
                    </span>
                  ));
                })}
              </div>
            )}
          </div>
        </div>

        {/* Integrations / env vars */}
        <div className="bg-card border border-border/50 rounded-2xl overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3 bg-muted/30 border-b border-border/50">
            <div className="flex items-center gap-2">
              <Plug className="w-4 h-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold text-foreground">Variables de entorno (Railway)</h3>
            </div>
            <span className="text-xs text-muted-foreground">
              {env.filter(e => e.isSet).length}/{env.length} configuradas
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
                        ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                        : <Circle className="w-3.5 h-3.5 text-muted-foreground/40 shrink-0" />}
                      <span className="text-sm text-foreground flex-1">{e.label}</span>
                      <code className="text-xs font-mono text-muted-foreground/60">{e.key}</code>
                      {!e.isSet && (
                        <span className="text-xs text-amber-600 dark:text-amber-400 font-medium">Pendiente</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}
