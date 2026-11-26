/**
 * MiCuenta.tsx — /admin/mi-cuenta: seguridad de la cuenta del usuario en curso.
 *  - Correo de acceso: solicitar el cambio (con la contraseña actual); se confirma desde el enlace del correo nuevo.
 *  - Dispositivos con los que ha iniciado sesión: ver y olvidar.
 */
import { useState } from "react";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Loader2, Mail, MonitorSmartphone, ShieldCheck, Trash2 } from "lucide-react";
import { PanelEmpty, PanelError, PanelLoading } from "@/components/admin/PanelStates";
import { PanelPageHeader, StatusBadge } from "@/components/admin/PanelUi";
import { HeroCard, PersonAvatar } from "@/components/admin/PanelVisual";
import { toastError } from "@/lib/errorMessage";
import { useI18n } from "@/i18n/I18nProvider";

/** Texto con partes en negrita marcadas como <b>…</b>. */
const rich = (text: string): React.ReactNode => text.split(/(<b>.*?<\/b>)/g).map((p, i) => (p.startsWith("<b>") ? <strong key={i}>{p.slice(3, -4)}</strong> : p));

/** Sección de la cuenta: icono en recuadro de la marca, título, explicación y contenido. */
function AccountSection({ id, icon, title, description, children }: { id: string; icon: React.ReactNode; title: string; description: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4 rounded-xl border border-border bg-card p-5 shadow-sm sm:p-6" aria-labelledby={id}>
      <div className="flex items-start gap-3">
        <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary [&_svg]:h-5 [&_svg]:w-5" aria-hidden="true">{icon}</span>
        <div className="min-w-0">
          <h2 id={id} className="font-semibold text-foreground">{title}</h2>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

function EmailSection() {
  const { t, format: f } = useI18n();
  const fmt = (iso: string) => f.dateTime(iso, { dateStyle: "medium", timeStyle: "short" });
  const { user } = useAuth();
  const pendingQ = trpc.accountSecurity.pendingEmailChange.useQuery();
  const [newEmail, setNewEmail] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const request = trpc.accountSecurity.requestEmailChange.useMutation({
    onSuccess: (r) => {
      toast.success(r.sent ? t("help.account.linkSent", { email: r.newEmail }) : t("help.account.requestNotSent"));
      setNewEmail("");
      setCurrentPassword("");
      pendingQ.refetch();
    },
    onError: (e) => toastError(e),
  });
  const pending = pendingQ.data?.pending ?? null;
  const unavailable = pendingQ.data?.available === false;

  return (
    <AccountSection id="mi-cuenta-correo" icon={<Mail />} title={t("help.account.emailTitle")} description={t("help.account.emailDesc")}>
      <p className="rounded-lg bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
        {t("help.account.currentEmail")} <span className="break-all font-medium text-foreground">{user?.email ?? "—"}</span>
      </p>
      {pending && (
        <p className="text-sm rounded-lg bg-warning/10 border border-warning/40 text-foreground px-3 py-2" role="status">
          {rich(t("help.account.pendingChange", { email: pending.newEmail, date: fmt(pending.expiresAt) }))}
        </p>
      )}
      {unavailable ? (
        <p className="text-sm text-muted-foreground">{t("help.account.unavailableEmail")}</p>
      ) : (
        <form
          className="grid gap-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            request.mutate({ newEmail, currentPassword });
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="mi-cuenta-nuevo-correo">{t("help.account.newEmail")}</Label>
            <Input id="mi-cuenta-nuevo-correo" type="email" autoComplete="email" required value={newEmail} onChange={(e) => setNewEmail(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="mi-cuenta-contrasena">{t("help.account.currentPassword")}</Label>
            <Input id="mi-cuenta-contrasena" type="password" autoComplete="current-password" required value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
            <p className="text-xs text-muted-foreground">{t("help.account.passwordHint")}</p>
          </div>
          <div className="sm:col-span-2 flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={request.isPending || !newEmail || !currentPassword}>
              {request.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" />}
              {t("help.account.sendLink")}
            </Button>
            <span className="text-xs text-muted-foreground">{t("help.account.sendLinkHint")}</span>
          </div>
        </form>
      )}
    </AccountSection>
  );
}

function DevicesSection() {
  const { t, format: f } = useI18n();
  const fmt = (iso: string) => f.dateTime(iso, { dateStyle: "medium", timeStyle: "short" });
  const devicesQ = trpc.accountSecurity.myDevices.useQuery();
  const forget = trpc.accountSecurity.forgetDevice.useMutation({
    onSuccess: () => {
      toast.success(t("help.account.forgotten"));
      devicesQ.refetch();
    },
    onError: (e) => toastError(e),
  });
  const data = devicesQ.data;

  return (
    <AccountSection id="mi-cuenta-dispositivos" icon={<MonitorSmartphone />} title={t("help.account.devicesTitle")} description={t("help.account.devicesText")}>
      {devicesQ.isLoading ? (
        <PanelLoading label={t("help.account.loading")} className="py-6" />
      ) : devicesQ.isError ? (
        <PanelError error={devicesQ.error} onRetry={() => devicesQ.refetch()} title={t("help.account.loadError")} />
      ) : data?.available === false ? (
        <p className="text-sm text-muted-foreground">{t("help.account.devicesUnavailable")}</p>
      ) : !data?.devices.length ? (
        <PanelEmpty icon={<MonitorSmartphone />} title={t("help.account.devicesEmpty")} />
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {data.devices.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground" aria-hidden="true"><MonitorSmartphone className="h-4 w-4" /></span>
              <div className="min-w-0 flex-1">
                <p className="break-words text-sm font-medium text-foreground">
                  {d.label}
                  {d.current && <StatusBadge tone="success" className="ml-2">{t("help.account.thisDevice")}</StatusBadge>}
                </p>
                <p className="text-xs text-muted-foreground">{t("help.account.seen", { first: fmt(d.firstSeenAt), last: fmt(d.lastSeenAt) })}</p>
              </div>
              <Button variant="outline" size="sm" disabled={forget.isPending} onClick={() => forget.mutate({ id: d.id })} aria-label={t("help.account.forgetAria", { label: d.label })}>
                <Trash2 className="w-4 h-4 mr-1.5" aria-hidden="true" />
                {t("help.account.forget")}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </AccountSection>
  );
}

export default function MiCuenta() {
  const { t } = useI18n();
  const { user } = useAuth();
  const devicesQ = trpc.accountSecurity.myDevices.useQuery();
  const deviceCount = devicesQ.data && devicesQ.data.available !== false ? devicesQ.data.devices.length : null;
  const displayName = user?.name?.trim() || user?.email || "—";
  return (
    <AdminLayout title={t("help.account.title")}>
      <div className="max-w-3xl space-y-6">
        <PanelPageHeader icon={<ShieldCheck />} title={t("help.account.title")} description={t("help.account.subtitle")} />
        <HeroCard>
          <div className="flex flex-wrap items-center gap-4 p-5">
            <PersonAvatar name={displayName} id={user?.id ?? 0} size="lg" />
            <div className="min-w-0 flex-1">
              <p className="text-xs text-muted-foreground">{t("help.account.signedInAs")}</p>
              <p className="break-words text-lg font-semibold leading-tight text-foreground">{displayName}</p>
              {user?.email && user.email !== displayName && <p className="break-all text-sm text-muted-foreground">{user.email}</p>}
            </div>
            {deviceCount !== null && (
              <StatusBadge tone="brand" icon={<MonitorSmartphone aria-hidden="true" />}>{t("help.account.deviceCount", { n: deviceCount })}</StatusBadge>
            )}
          </div>
        </HeroCard>
        <EmailSection />
        <DevicesSection />
      </div>
    </AdminLayout>
  );
}
