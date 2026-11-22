/**
 * Elephant Learning · Reglas de acceso con nombres comerciales (lotes 3-4): qué producto y modalidad abre qué módulos y durante cuánto.
 * Las reglas nuevas nacen INACTIVAS. Activar una regla hace que un pago confirmado conceda acceso, así que pide confirmación expresa.
 */
import { confirmAction } from "@/components/admin/ConfirmHost";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PanelEmpty, PanelError, PanelLoading } from "@/components/admin/PanelStates";
import { toastError } from "@/lib/errorMessage";
import { useI18n } from "@/i18n/I18nProvider";
import { experienceLabel, variantLabel, modulesLabel } from "@shared/learningRules";
import { Pencil, Plus, ShieldCheck } from "lucide-react";

type Rule = { id: number; experienceId: number; variantId: number | null; courseId: number; moduleIds: number[]; durationDays: number | null; startMode: "on_grant" | "fixed_date"; fixedStart: number | null; active: boolean; experienceName: string | null; variantName: string | null; courseTitle: string | null; moduleTitles: string[] };

function RuleForm({ rule, onClose, onSaved }: { rule: Rule | null; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const cat = trpc.learning.admin.catalog.useQuery();
  const [experienceId, setExperienceId] = useState<number | "">(rule?.experienceId ?? "");
  const [variantId, setVariantId] = useState<number | "">(rule?.variantId ?? "");
  const [courseId, setCourseId] = useState<number | "">(rule?.courseId ?? "");
  const [moduleIds, setModuleIds] = useState<number[]>(rule?.moduleIds ?? []);
  const [days, setDays] = useState<string>(rule?.durationDays != null ? String(rule.durationDays) : "");
  const [active, setActive] = useState<boolean>(rule?.active ?? false);
  const save = trpc.learning.admin.saveRule.useMutation({ onSuccess: () => { toast.success(active ? t("learningManage.rules.saveActive") : t("learningManage.rules.saveInactive")); onSaved(); }, onError: (e) => toastError(e) });
  const exp = cat.data?.experiences.find((e) => e.id === experienceId);
  const course = cat.data?.courses.find((c) => c.id === courseId);
  const valid = experienceId !== "" && courseId !== "" && moduleIds.length > 0 && (days === "" || (Number(days) >= 1 && Number(days) <= 3650));
  const wasActive = rule?.active ?? false;
  async function submit() {
    if (active && !wasActive && !(await confirmAction({ description: t("learningManage.rules.activateConfirm") }))) return;
    save.mutate({ id: rule?.id, experienceId: Number(experienceId), variantId: variantId === "" ? null : Number(variantId), courseId: Number(courseId), moduleIds, durationDays: days === "" ? null : Number(days), startMode: "on_grant", fixedStart: null, active });
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>{rule ? t("learningManage.rules.editTitle") : t("learningManage.rules.newTitle")}</DialogTitle></DialogHeader>
        {cat.isLoading ? <PanelLoading /> : cat.isError ? <PanelError error={cat.error} onRetry={() => cat.refetch()} /> : (
          <div className="space-y-3 text-sm">
            <label className="block">{t("learningManage.rules.product")}
              <select className="mt-1 block w-full rounded-md border bg-background px-2 py-1.5" value={experienceId} onChange={(e) => { setExperienceId(e.target.value ? Number(e.target.value) : ""); setVariantId(""); }}>
                <option value="">{t("learningManage.rules.chooseProduct")}</option>
                {cat.data!.experiences.map((e) => <option key={e.id} value={e.id}>{e.title}</option>)}
              </select>
            </label>
            <label className="block">{t("learningManage.rules.variant")}
              <select className="mt-1 block w-full rounded-md border bg-background px-2 py-1.5" value={variantId} disabled={experienceId === ""} onChange={(e) => setVariantId(e.target.value ? Number(e.target.value) : "")}>
                <option value="">{t("learningManage.rules.anyVariant")}</option>
                {(exp?.variants ?? []).map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
            </label>
            <label className="block">{t("learningManage.rules.course")}
              <select className="mt-1 block w-full rounded-md border bg-background px-2 py-1.5" value={courseId} onChange={(e) => { setCourseId(e.target.value ? Number(e.target.value) : ""); setModuleIds([]); }}>
                <option value="">{t("learningManage.rules.chooseCourse")}</option>
                {cat.data!.courses.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
              </select>
            </label>
            {course && (
              <fieldset className="space-y-1"><legend className="mb-1">{t("learningManage.rules.modulesOpened")}</legend>
                {course.modules.map((m) => (
                  <label key={m.id} className="flex items-center gap-2"><input type="checkbox" checked={moduleIds.includes(m.id)} onChange={(e) => setModuleIds(e.target.checked ? [...moduleIds, m.id] : moduleIds.filter((x) => x !== m.id))} />{m.title}</label>
                ))}
              </fieldset>
            )}
            <label className="block">{t("learningManage.rules.duration")}<Input inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value.replace(/\D/g, ""))} placeholder={t("learningManage.rules.durationPlaceholder")} /></label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />{t("learningManage.rules.activeLabel")}</label>
            {!active && <p className="text-xs text-muted-foreground">{t("learningManage.rules.inactiveNote")}</p>}
            <div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose}>{t("learningManage.rules.cancel")}</Button><Button disabled={!valid || save.isPending} onClick={submit}>{t("learningManage.rules.save")}</Button></div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function Rules() {
  const { t, format } = useI18n();
  const fmtDate = (ms: number | null) => (ms ? format.date(ms, { dateStyle: "medium", timeZone: "Europe/Madrid" }) : "—");
  const utils = trpc.useUtils();
  const q = trpc.learning.admin.rules.useQuery();
  const [editing, setEditing] = useState<Rule | null | "new">(null);
  const rules = useMemo(() => (q.data ?? []) as Rule[], [q.data]);
  if (q.isLoading) return <PanelLoading />;
  if (q.isError) return <PanelError error={q.error} onRetry={() => q.refetch()} />;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">{t("learningManage.rules.intro")}</p>
        <Button onClick={() => setEditing("new")}><Plus className="mr-1.5 h-4 w-4" aria-hidden />{t("learningManage.rules.newRule")}</Button>
      </div>
      {!rules.length ? <PanelEmpty title={t("learningManage.rules.emptyTitle")} description={t("learningManage.rules.emptyDesc")} /> : (
        <ul className="grid gap-3 md:grid-cols-2">
          {rules.map((r) => (
            <li key={r.id} className="rounded-xl border bg-card p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="flex items-center gap-1.5 font-semibold"><ShieldCheck className="h-4 w-4 shrink-0 text-primary" aria-hidden /><span className="truncate">{experienceLabel(r)}</span></h3>
                  <p className="text-sm text-muted-foreground">{variantLabel(r)}</p>
                </div>
                <Badge variant={r.active ? "default" : "secondary"}>{r.active ? t("learningManage.rules.active") : t("learningManage.rules.inactive")}</Badge>
              </div>
              <dl className="mt-3 space-y-1 text-sm">
                <div className="flex gap-2"><dt className="w-20 shrink-0 text-muted-foreground">{t("learningManage.rules.course")}</dt><dd>{r.courseTitle ?? "—"}</dd></div>
                <div className="flex gap-2"><dt className="w-20 shrink-0 text-muted-foreground">{t("learningManage.rules.opens")}</dt><dd>{modulesLabel(r)}</dd></div>
                <div className="flex gap-2"><dt className="w-20 shrink-0 text-muted-foreground">{t("learningManage.rules.durationLabel")}</dt><dd>{r.durationDays ? t("learningManage.rules.days", { n: r.durationDays }) : t("learningManage.rules.noLimit")}</dd></div>
                <div className="flex gap-2"><dt className="w-20 shrink-0 text-muted-foreground">{t("learningManage.rules.start")}</dt><dd>{r.startMode === "fixed_date" ? fmtDate(r.fixedStart) : t("learningManage.rules.onGrant")}</dd></div>
              </dl>
              <div className="mt-3"><Button size="sm" variant="outline" onClick={() => setEditing(r)}><Pencil className="mr-1.5 h-4 w-4" aria-hidden />{t("learningManage.rules.edit")}</Button></div>
            </li>
          ))}
        </ul>
      )}
      {editing && <RuleForm rule={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); utils.learning.admin.rules.invalidate(); }} />}
    </div>
  );
}
