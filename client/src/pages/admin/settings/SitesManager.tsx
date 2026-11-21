/**
 * Sedes de la empresa (capacidad Business `multi-site`): listar, añadir hasta el límite del plan, renombrar, datos de
 * contacto, desactivar y reactivar. Las sedes viven en el registro del plano de control (sites.*); el límite lo aplica
 * él. Essential ve su única sede (la principal), puede editar sus datos y no puede añadir otras.
 */
import { useState } from "react";
import { Building2, MapPin, Pencil, Plus, RotateCcw, Archive, Phone, Mail } from "lucide-react";
import { toast } from "sonner";
import { Link } from "wouter";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { PanelError, PanelLoading } from "@/components/admin/PanelStates";
import { FormField, describedBy } from "@/components/admin/crm/CrmParts";
import { toastError } from "@/lib/errorMessage";
import { validateSiteForm, type PanelSite, type SiteFormInput } from "@shared/sites";
import { useI18n } from "@/i18n/I18nProvider";

type Form = { name: string; address: string; phone: string; email: string };
const emptyForm: Form = { name: "", address: "", phone: "", email: "" };
const toForm = (s: PanelSite): Form => ({ name: s.name, address: s.address ?? "", phone: s.phone ?? "", email: s.email ?? "" });

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
          {field("name", t("settingsSites.editor.name"), { required: true, max: 160, placeholder: t("settingsSites.editor.namePlaceholder") })}
          {field("address", t("settingsSites.editor.address"), { max: 300, placeholder: t("settingsSites.editor.addressPlaceholder"), auto: "street-address" })}
          <div className="grid gap-4 sm:grid-cols-2">
            {field("phone", t("settingsSites.editor.phone"), { max: 40, type: "tel", auto: "tel" })}
            {field("email", t("settingsSites.editor.email"), { max: 200, type: "email", auto: "email" })}
          </div>
          <DialogFooter>
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

  return (
    <AdminLayout>
      <div className="p-4 sm:p-6 space-y-6 max-w-5xl">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <Building2 className="w-6 h-6 text-primary" aria-hidden="true" />
              {t("settingsSites.title")}
            </h1>
            <p className="text-muted-foreground text-sm mt-1">{t("settingsSites.intro")}</p>
          </div>
          {d?.canManage && (
            <Button onClick={() => setEditing("new")} disabled={!d.canAdd} title={d.canAdd ? undefined : t("settingsSites.limitReached")} className="gap-2">
              <Plus className="w-4 h-4" aria-hidden="true" />
              {t("settingsSites.newSite")}
            </Button>
          )}
        </div>

        {q.isLoading ? (
          <PanelLoading label={t("settingsSites.loading")} />
        ) : q.isError ? (
          <PanelError error={q.error} onRetry={() => q.refetch()} title={t("settingsSites.loadError")} />
        ) : d ? (
          <>
            <p className="text-sm text-muted-foreground" aria-live="polite">{limitText}</p>
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

            <ul className="grid gap-3 sm:grid-cols-2">
              {active.map((s) => (
                <li key={s.siteId} className="rounded-xl border border-border bg-card p-4 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold text-foreground break-words">{s.name}</p>
                      {s.isPrimary && <span className="inline-block mt-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">{t("settingsSites.primary")}</span>}
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <Button size="sm" variant="ghost" onClick={() => setEditing(s)} aria-label={t("settingsSites.edit", { name: s.name })} disabled={!d.managed || (!d.multiSite && !s.isPrimary)}>
                        <Pencil className="w-4 h-4" aria-hidden="true" />
                      </Button>
                      {d.canManage && !s.isPrimary && (
                        <Button size="sm" variant="ghost" onClick={() => setArchiving(s)} aria-label={t("settingsSites.deactivate", { name: s.name })}>
                          <Archive className="w-4 h-4" aria-hidden="true" />
                        </Button>
                      )}
                    </div>
                  </div>
                  <dl className="space-y-1 text-sm text-muted-foreground">
                    {s.address && <div className="flex gap-1.5"><MapPin className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" /><dt className="sr-only">{t("settingsSites.address")}</dt><dd className="break-words">{s.address}</dd></div>}
                    {s.phone && <div className="flex gap-1.5"><Phone className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" /><dt className="sr-only">{t("settingsSites.phone")}</dt><dd>{s.phone}</dd></div>}
                    {s.email && <div className="flex gap-1.5"><Mail className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" /><dt className="sr-only">{t("settingsSites.email")}</dt><dd className="break-all">{s.email}</dd></div>}
                    {!s.address && !s.phone && !s.email && <p>{t("settingsSites.noContact")}</p>}
                  </dl>
                </li>
              ))}
            </ul>

            {archived.length > 0 && (
              <section aria-labelledby="sedes-desactivadas" className="space-y-2">
                <h2 id="sedes-desactivadas" className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">{t("settingsSites.inactive")}</h2>
                <ul className="divide-y divide-border rounded-xl border border-border bg-card">
                  {archived.map((s) => (
                    <li key={s.siteId} className="flex items-center justify-between gap-3 p-3">
                      <span className="text-sm text-foreground break-words">{s.name}</span>
                      {d.canManage && (
                        <Button size="sm" variant="outline" className="gap-1.5" disabled={!d.canAdd || restore.isPending} onClick={() => restore.mutate({ siteId: s.siteId })}>
                          <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                          {t("settingsSites.reactivate")}
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            )}
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
