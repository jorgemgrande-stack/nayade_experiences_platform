/**
 * Etiquetas del CRM (crm-tags): catálogo de la empresa (nombre único y color opcional). Se asignan
 * desde la ficha de cada cliente y sirven para filtrar el listado de clientes.
 */
import { useState } from "react";
import { Link } from "wouter";
import { Pencil, Plus, Tag, Trash2, Users } from "lucide-react";
import { toast } from "sonner";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PanelEmpty, PanelError, PanelLoading } from "@/components/admin/PanelStates";
import { FormField, TagChip, describedBy, selectClass, useCrmCanWrite } from "@/components/admin/crm/CrmParts";
import { TAG_COLORS, TAG_NAME_MAX, validateTagForm } from "@shared/crmTagsTasks";
import { toastError } from "@/lib/errorMessage";
import { useI18n } from "@/i18n/I18nProvider";

type TagRow = { id: number; name: string; color: string | null; usage: number };

function TagForm({ tag, existing, onClose }: { tag: TagRow | null; existing: TagRow[]; onClose: () => void }) {
  const { t } = useI18n();
  const utils = trpc.useUtils();
  const [name, setName] = useState(tag?.name ?? "");
  const [color, setColor] = useState(tag?.color ?? "");
  const [errors, setErrors] = useState<{ name?: string; color?: string }>({});
  const done = (msg: string) => {
    toast.success(msg);
    utils.crmTags.list.invalidate();
    utils.crmTags.forEntities.invalidate();
    onClose();
  };
  const create = trpc.crmTags.create.useMutation({ onSuccess: () => done(t("crmTags.form.created")), onError: (e) => setErrors({ name: e.message }) });
  const update = trpc.crmTags.update.useMutation({ onSuccess: () => done(t("crmTags.form.saved")), onError: (e) => setErrors({ name: e.message }) });
  const pending = create.isPending || update.isPending;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const errs = validateTagForm({ name, color: color || null }, existing, tag?.id);
    setErrors(errs);
    if (Object.keys(errs).length) return;
    const payload = { name, color: (color || null) as (typeof TAG_COLORS)[number] | null };
    if (tag) update.mutate({ id: tag.id, ...payload });
    else create.mutate(payload);
  };

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <FormField id="tag-name" label={t("crmTags.form.name")} error={errors.name} hint={t("crmTags.form.nameHint", { max: TAG_NAME_MAX })} required>
        <Input id="tag-name" value={name} maxLength={TAG_NAME_MAX} onChange={(e) => setName(e.target.value)} aria-invalid={!!errors.name} aria-required aria-describedby={describedBy("tag-name", errors.name) ?? "tag-name-hint"} autoFocus />
      </FormField>
      <FormField id="tag-color" label={t("crmTags.form.color")} error={errors.color}>
        <select id="tag-color" className={selectClass} value={color} onChange={(e) => setColor(e.target.value)} aria-invalid={!!errors.color} aria-describedby={describedBy("tag-color", errors.color)}>
          <option value="">{t("crmTags.form.noColor")}</option>
          {TAG_COLORS.map((c) => <option key={c} value={c}>{t(`crmTags.color.${c}`)}</option>)}
        </select>
      </FormField>
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        {t("crmTags.form.preview")} <TagChip name={name.trim() || t("crmTags.form.sample")} color={color || null} />
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>{t("crmTags.form.cancel")}</Button>
        <Button type="submit" disabled={pending}>{tag ? t("crmTags.form.saveChanges") : t("crmTags.form.create")}</Button>
      </DialogFooter>
    </form>
  );
}

export default function CrmTags() {
  const { t } = useI18n();
  const canWrite = useCrmCanWrite("crm-tags");
  const utils = trpc.useUtils();
  const tags = trpc.crmTags.list.useQuery();
  const [editing, setEditing] = useState<TagRow | null | undefined>(undefined);
  const [deleting, setDeleting] = useState<TagRow | null>(null);
  const del = trpc.crmTags.delete.useMutation({
    onSuccess: () => {
      toast.success(t("crmTags.page.deleted"));
      utils.crmTags.list.invalidate();
      utils.crmTags.forEntities.invalidate();
      setDeleting(null);
    },
    onError: (e) => toastError(e),
  });
  const list = (tags.data ?? []) as TagRow[];

  return (
    <AdminLayout>
      <div className="max-w-4xl space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-foreground">{t("crmTags.page.title")}</h1>
            <p className="text-sm text-muted-foreground">{t("crmTags.page.description")}</p>
          </div>
          {canWrite && (
            <Button onClick={() => setEditing(null)}>
              <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" /> {t("crmTags.page.newTag")}
            </Button>
          )}
        </div>

        {tags.isLoading ? (
          <PanelLoading label={t("crmTags.page.loading")} />
        ) : tags.isError ? (
          <PanelError error={tags.error} onRetry={() => tags.refetch()} title={t("crmTags.page.loadError")} />
        ) : list.length === 0 ? (
          <PanelEmpty icon={<Tag className="h-6 w-6" />} title={t("crmTags.page.emptyTitle")} description={t("crmTags.page.emptyDesc")}>
            {canWrite && <Button onClick={() => setEditing(null)}><Plus className="mr-1.5 h-4 w-4" aria-hidden="true" /> {t("crmTags.page.createFirst")}</Button>}
          </PanelEmpty>
        ) : (
          <ul className="divide-y divide-border rounded-2xl border border-border bg-card" aria-label={t("crmTags.page.listAria")}>
            {list.map((tg) => (
              <li key={tg.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <TagChip name={tg.name} color={tg.color} />
                <span className="flex-1 text-sm text-muted-foreground">
                  {tg.usage === 0 ? t("crmTags.page.unassigned") : t("crmTags.page.usage", { n: tg.usage })}
                </span>
                <Link href={`/admin/crm/clientes?etiqueta=${tg.id}`} className="inline-flex items-center gap-1 rounded text-sm text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <Users className="h-4 w-4" aria-hidden="true" /> {t("crmTags.page.seeClients")}
                </Link>
                {canWrite && (
                  <>
                    <Button size="sm" variant="ghost" onClick={() => setEditing(tg)} aria-label={t("crmTags.page.editAria", { name: tg.name })}>
                      <Pencil className="h-4 w-4" aria-hidden="true" />
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setDeleting(tg)} aria-label={t("crmTags.page.deleteAria", { name: tg.name })} className="text-destructive hover:text-destructive">
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <Dialog open={editing !== undefined} onOpenChange={(o) => !o && setEditing(undefined)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? t("crmTags.page.editTitle") : t("crmTags.page.newTitle")}</DialogTitle>
            <DialogDescription>{t("crmTags.page.unique")}</DialogDescription>
          </DialogHeader>
          {editing !== undefined && <TagForm tag={editing} existing={list} onClose={() => setEditing(undefined)} />}
        </DialogContent>
      </Dialog>

      <Dialog open={deleting !== null} onOpenChange={(o) => !o && setDeleting(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("crmTags.page.deleteTitle")}</DialogTitle>
            <DialogDescription>
              {deleting && deleting.usage > 0
                ? t("crmTags.page.deleteInUse", { name: deleting.name, n: deleting.usage })
                : t("crmTags.page.deleteIrreversible")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDeleting(null)}>{t("crmTags.page.cancel")}</Button>
            <Button type="button" variant="destructive" disabled={del.isPending} onClick={() => deleting && del.mutate({ id: deleting.id })}>{t("crmTags.page.delete")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
