/**
 * Sedes de la empresa (capacidad Business `multi-site`): listar, añadir hasta el límite del plan, renombrar, datos de
 * contacto, desactivar y reactivar. Las sedes viven en el registro del plano de control (sites.*); el límite lo aplica
 * él. Essential ve su única sede (la principal), puede editar sus datos y no puede añadir otras.
 */
import { useState, type ReactNode } from "react";
import { Building2, MapPin, Pencil, Plus, RotateCcw, Archive, Phone, Mail, Star, Layers, ArchiveX, type LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { Link } from "wouter";
import AdminLayout from "@/components/AdminLayout";
import { PanelDataList, PanelPageHeader, StatusBadge, type PanelColumn } from "@/components/admin/PanelUi";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { PanelError, PanelLoading } from "@/components/admin/PanelStates";
import { FormField, describedBy } from "@/components/admin/crm/CrmParts";
import { toastError } from "@/lib/errorMessage";
import { validateSiteForm, type PanelSite, type SiteFormInput } from "@shared/sites";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n/I18nProvider";

type Form = { name: string; address: string; phone: string; email: string };
const emptyForm: Form = { name: "", address: "", phone: "", email: "" };
const toForm = (s: PanelSite): Form => ({ name: s.name, address: s.address ?? "", phone: s.phone ?? "", email: s.email ?? "" });

/** Sección del formulario de sede: título con icono y sus campos. */
function FormSection({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children: ReactNode }) {
  return (
    <fieldset className="space-y-3 rounded-xl border border-border bg-muted/30 p-4">
      <legend className="flex items-center gap-1.5 px-1 text-sm font-semibold text-foreground">
        <Icon className="h-4 w-4 text-primary" aria-hidden="true" />
        {title}
      </legend>
      {children}
    </fieldset>
  );
}

/** Tarjeta destacada del resumen superior. */
function SummaryCard({ icon: Icon, label, value, detail, children }: { icon: LucideIcon; label: string; value: ReactNode; detail?: ReactNode; children?: ReactNode }) {
  return (
    <div className="space-y-2 rounded-xl border border-border bg-card p-4 shadow-md">
      <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
        <span className="rounded-lg bg-primary/10 p-1.5 text-primary" aria-hidden="true"><Icon className="h-4 w-4" /></span>
        {label}
      </div>
      <p className="break-words text-2xl font-bold leading-tight text-foreground">{value}</p>
      {detail && <p className="text-xs text-muted-foreground">{detail}</p>}
      {children}
    </div>
  );
}

function SiteEditor({ site, onClose }: { site: PanelSite | null; onClose: () => void }) {
  const { t } = useI18n();
  const utils = trpc.useUtils();
  const [form, setForm] = useState<Form>(site ? toForm(site) : emptyForm);
  const [submitted, setSubmitted] = useState(false);
  const errors = validateSiteForm(form as SiteFormInput);
  const done = (msg: string) => {
    void utils.sites.list.invalidate();
    toast.success(msg);
    onClose();
  };
  const create = trpc.sites.create.useMutation({ onSuccess: () => done(t("settingsSites.editor.added")), onError: (e) => toastError(e, t("settingsSites.editor.addError")) });
  const update = trpc.sites.update.useMutation({ onSuccess: () => done(t("settingsSites.editor.saved")), onError: (e) => toastError(e, t("settingsSites.editor.saveError")) });
  const pending = create.isPending || update.isPending;
  const err = (k: keyof Form) => (submitted ? errors[k] : undefined);
  const submit = () => {
    setSubmitted(true);
    const first = (Object.keys(errors) as Array<keyof Form>)[0];
    if (first) return void document.getElementById(`sede-${first}`)?.focus();
    const data = { name: form.name.trim(), address: form.address.trim() || null, phone: form.phone.trim() || null, email: form.email.trim() || null };
    if (site) update.mutate({ siteId: site.siteId, ...data });
    else create.mutate(data);
  };
  const field = (k: keyof Form, label: string, o: { required?: boolean; type?: string; placeholder?: string; max: number; auto?: string }) => (
    <FormField id={`sede-${k}`} label={label} error={err(k)} required={o.required}>
      <Input
        id={`sede-${k}`}
        type={o.type ?? "text"}
        value={form[k]}
        maxLength={o.max}
        placeholder={o.placeholder}
        autoComplete={o.auto ?? "off"}
        aria-invalid={!!err(k)}
        aria-describedby={describedBy(`sede-${k}`, err(k))}
        onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value }))}
      />
    </FormField>
  );
  return (
    <Dialog open onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{site ? t("settingsSites.editor.editTitle", { name: site.name }) : t("settingsSites.editor.newTitle")}</DialogTitle>
          <DialogDescription>{site?.isPrimary ? t("settingsSites.editor.primaryDesc") : t("settingsSites.editor.otherDesc")}</DialogDescription>
        </DialogHeader>
        <form noValidate className="space-y-4" onSubmit={(e) => { e.preventDefault(); submit(); }}>
          <div className="max-h-[60vh] space-y-4 overflow-y-auto pr-1">
            <FormSection icon={Building2} title={t("settingsSites.editor.sectionData")}>
              {field("name", t("settingsSites.editor.name"), { required: true, max: 160, placeholder: t("settingsSites.editor.namePlaceholder") })}
            </FormSection>
            <FormSection icon={MapPin} title={t("settingsSites.editor.sectionAddress")}>
              {field("address", t("settingsSites.editor.address"), { max: 300, placeholder: t("settingsSites.editor.addressPlaceholder"), auto: "street-address" })}
            </FormSection>
            <FormSection icon={Phone} title={t("settingsSites.editor.sectionContact")}>
              <div className="grid gap-4 sm:grid-cols-2">
                {field("phone", t("settingsSites.editor.phone"), { max: 40, type: "tel", auto: "tel" })}
                {field("email", t("settingsSites.editor.email"), { max: 200, type: "email", auto: "email" })}
              </div>
            </FormSection>
          </div>
          <DialogFooter className="border-t border-border pt-4">
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>{t("settingsSites.editor.cancel")}</Button>
            <Button type="submit" disabled={pending}>{pending ? t("settingsSites.editor.saving") : site ? t("settingsSites.editor.save") : t("settingsSites.editor.add")}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function SitesManager() {
  const { t } = useI18n();
  const utils = trpc.useUtils();
  const q = trpc.sites.list.useQuery();
  const [editing, setEditing] = useState<PanelSite | "new" | null>(null);
  const [archiving, setArchiving] = useState<PanelSite | null>(null);
  const archive = trpc.sites.archive.useMutation({
    onSuccess: () => { void utils.sites.list.invalidate(); toast.success(t("settingsSites.archive.done")); setArchiving(null); },
    onError: (e) => toastError(e, t("settingsSites.archive.error")),
  });
  const restore = trpc.sites.restore.useMutation({
    onSuccess: () => { void utils.sites.list.invalidate(); toast.success(t("settingsSites.restore.done")); },
    onError: (e) => toastError(e, t("settingsSites.restore.error")),
  });

  const d = q.data;
  const active = d?.sites.filter((s) => s.status === "active") ?? [];
  const archived = d?.sites.filter((s) => s.status === "archived") ?? [];
  const limitText = d ? (d.limit === null ? t("settingsSites.limitUnlimited", { used: d.used }) : t("settingsSites.limitOf", { used: d.used, limit: d.limit })) : "";

  const columns = (d: NonNullable<typeof q.data>): PanelColumn<PanelSite>[] => [
    {
      key: "site",
      header: t("settingsSites.col.site"),
      cell: (x) => (
        <div className={cn("flex flex-wrap items-center gap-2", x.status === "archived" && "text-muted-foreground")}>
          <span className="font-semibold">{x.name}</span>
          {x.isPrimary && <StatusBadge tone="brand" icon={<Star />}>{t("settingsSites.primary")}</StatusBadge>}
        </div>
      ),
    },
    {
      key: "status",
      header: t("settingsSites.col.status"),
      cell: (x) => (x.status === "active" ? <StatusBadge tone="success">{t("settingsSites.status.active")}</StatusBadge> : <StatusBadge tone="neutral">{t("settingsSites.status.archived")}</StatusBadge>),
    },
    {
      key: "contact",
      header: t("settingsSites.col.contact"),
      cell: (x) =>
        x.address || x.phone || x.email ? (
          <dl className="space-y-1 text-sm text-muted-foreground">
            {x.address && <div className="flex gap-1.5"><MapPin className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /><dt className="sr-only">{t("settingsSites.address")}</dt><dd className="break-words">{x.address}</dd></div>}
            {x.phone && <div className="flex gap-1.5"><Phone className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /><dt className="sr-only">{t("settingsSites.phone")}</dt><dd>{x.phone}</dd></div>}
            {x.email && <div className="flex gap-1.5"><Mail className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /><dt className="sr-only">{t("settingsSites.email")}</dt><dd className="break-all">{x.email}</dd></div>}
          </dl>
        ) : (
          <span className="text-sm text-muted-foreground">{t("settingsSites.noContact")}</span>
        ),
    },
    {
      key: "actions",
      header: t("settingsSites.col.actions"),
      align: "right",
      cell: (x) =>
        x.status === "archived" ? (
          d.canManage ? (
            <Button size="sm" variant="outline" className="gap-1.5" disabled={!d.canAdd || restore.isPending} onClick={() => restore.mutate({ siteId: x.siteId })}>
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
              {t("settingsSites.reactivate")}
            </Button>
          ) : null
        ) : (
          <div className="flex justify-end gap-1">
            <Button size="sm" variant="ghost" onClick={() => setEditing(x)} aria-label={t("settingsSites.edit", { name: x.name })} title={t("settingsSites.edit", { name: x.name })} disabled={!d.managed || (!d.multiSite && !x.isPrimary)}>
              <Pencil className="h-4 w-4" aria-hidden="true" />
            </Button>
            {d.canManage && !x.isPrimary && (
              <Button size="sm" variant="ghost" onClick={() => setArchiving(x)} aria-label={t("settingsSites.deactivate", { name: x.name })} title={t("settingsSites.deactivate", { name: x.name })}>
                <Archive className="h-4 w-4" aria-hidden="true" />
              </Button>
            )}
          </div>
        ),
    },
  ];

  return (
    <AdminLayout>
      <div className="p-4 sm:p-6 space-y-6 max-w-5xl">
        <PanelPageHeader
          icon={<Building2 />}
          title={t("settingsSites.title")}
          description={t("settingsSites.intro")}
          actions={
          d?.canManage && (
            <Button onClick={() => setEditing("new")} disabled={!d.canAdd} title={d.canAdd ? undefined : t("settingsSites.limitReached")} className="gap-2">
              <Plus className="w-4 h-4" aria-hidden="true" />
              {t("settingsSites.newSite")}
            </Button>
          )
          }
        />

        {q.isLoading ? (
          <PanelLoading label={t("settingsSites.loading")} />
        ) : q.isError ? (
          <PanelError error={q.error} onRetry={() => q.refetch()} title={t("settingsSites.loadError")} />
        ) : d ? (
          <>
            <div className="grid gap-4 sm:grid-cols-3" aria-live="polite">
              <SummaryCard icon={Layers} label={t("settingsSites.summary.used")} value={d.limit === null ? d.used : `${d.used} / ${d.limit}`} detail={limitText}>
                {d.limit !== null && d.limit > 0 && (
                  <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                    <div className={cn("h-full rounded-full", d.used >= d.limit ? "bg-warning" : "bg-primary")} style={{ width: `${Math.min(100, Math.round((d.used / d.limit) * 100))}%` }} />
                  </div>
                )}
              </SummaryCard>
              <SummaryCard icon={Star} label={t("settingsSites.summary.primary")} value={d.sites.find((x) => x.isPrimary)?.name ?? "—"} detail={t("settingsSites.summary.primaryHint")} />
              <SummaryCard icon={ArchiveX} label={t("settingsSites.summary.archived")} value={archived.length} detail={archived.length ? t("settingsSites.summary.archivedHint") : t("settingsSites.summary.archivedNone")} />
            </div>
            {!d.multiSite ? (
              <div role="note" className="rounded-xl border border-border bg-muted/40 p-4 text-sm text-foreground">
                {t("settingsSites.singleNote")}{" "}
                <Link href="/admin/suscripcion" className="font-medium text-primary underline underline-offset-2">{t("settingsSites.seePlans")}</Link>
              </div>
            ) : d.canManage && !d.canAdd ? (
              <div role="note" className="rounded-xl border border-border bg-muted/40 p-4 text-sm text-foreground">
                {t("settingsSites.limitNote")}
              </div>
            ) : null}

            <PanelDataList
              caption={t("settingsSites.title")}
              rows={[...active, ...archived]}
              rowKey={(x) => x.siteId}
              columns={columns(d)}
            />
            {!d.managed && <p className="text-xs text-muted-foreground">{t("settingsSites.notManaged")}</p>}
          </>
        ) : null}
      </div>

      {editing && <SiteEditor site={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}

      <AlertDialog open={!!archiving} onOpenChange={(o) => !o && !archive.isPending && setArchiving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("settingsSites.archive.title", { name: archiving?.name })}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("settingsSites.archive.text")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={archive.isPending}>{t("settingsSites.archive.cancel")}</AlertDialogCancel>
            <AlertDialogAction disabled={archive.isPending} onClick={(e) => { e.preventDefault(); if (archiving) archive.mutate({ siteId: archiving.siteId }); }}>
              {archive.isPending ? t("settingsSites.archive.working") : t("settingsSites.archive.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AdminLayout>
  );
}
