/**
 * Elephant Learning · Reglas de acceso con nombres comerciales (lotes 3-4): qué producto y modalidad abre qué módulos y durante cuánto.
 * Las reglas nuevas nacen INACTIVAS. Activar una regla hace que un pago confirmado conceda acceso, así que pide confirmación expresa.
 */
import { confirmAction } from "@/components/admin/ConfirmHost";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PanelEmpty, PanelError, PanelLoading } from "@/components/admin/PanelStates";
import { StatusBadge } from "@/components/admin/PanelUi";
import { toastError } from "@/lib/errorMessage";
import { useI18n } from "@/i18n/I18nProvider";
import { experienceLabel, variantLabel, modulesLabel } from "@shared/learningRules";
import { modulesWithoutDuration, reconnectStaggeredSettings, RECONNECT_MODULE_DAYS } from "@shared/learning";
import { CalendarRange, Pencil, Plus, ShieldCheck } from "lucide-react";

type Rule = { id: number; experienceId: number; variantId: number | null; courseId: number; moduleIds: number[]; permanent?: boolean; activationRequired?: boolean; moduleSchedule?: Record<number, { unlockOffsetDays: number | null; durationDays: number | null }>; durationDays: number | null; startMode: "on_grant" | "fixed_date"; fixedStart: number | null; active: boolean; experienceName: string | null; variantName: string | null; courseTitle: string | null; moduleTitles: string[] };

function RuleForm({ rule, onClose, onSaved }: { rule: Rule | null; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const cat = trpc.learning.admin.catalog.useQuery();
  const [experienceId, setExperienceId] = useState<number | "">(rule?.experienceId ?? "");
  const [variantId, setVariantId] = useState<number | "">(rule?.variantId ?? "");
  const [courseId, setCourseId] = useState<number | "">(rule?.courseId ?? "");
  const [moduleIds, setModuleIds] = useState<number[]>(rule?.moduleIds ?? []);
  const [days, setDays] = useState<string>(rule?.durationDays != null ? String(rule.durationDays) : "");
  const [active, setActive] = useState<boolean>(rule?.active ?? false);
  const [permanent, setPermanent] = useState<boolean>(rule?.permanent ?? false);
  const [activationRequired, setActivationRequired] = useState<boolean>(rule?.activationRequired ?? false);
  const [sched, setSched] = useState<Record<number, { offset: string; dur: string }>>(() => Object.fromEntries(Object.entries(rule?.moduleSchedule ?? {}).map(([k, v]) => [Number(k), { offset: v.unlockOffsetDays != null ? String(v.unlockOffsetDays) : "", dur: v.durationDays != null ? String(v.durationDays) : "" }])));
  const setField = (m: number, f: "offset" | "dur", v: string) => setSched((s) => ({ ...s, [m]: { offset: s[m]?.offset ?? "", dur: s[m]?.dur ?? "", [f]: v.replace(/\D/g, "") } }));
  const moduleSettings = moduleIds.map((m) => ({ moduleId: m, unlockOffsetDays: sched[m]?.offset ? Number(sched[m].offset) : null, durationDays: sched[m]?.dur ? Number(sched[m].dur) : null }));
  // Una regla no puede activarse con módulos sin duración (ni propia ni general) salvo que sea permanente: lo exige también el servidor
  const missing = modulesWithoutDuration({ durationDays: days === "" ? null : Number(days), moduleIds, moduleSchedule: Object.fromEntries(moduleSettings.map((s) => [s.moduleId, { unlockOffsetDays: s.unlockOffsetDays, durationDays: s.durationDays }])) });
  const blocked = active && !permanent && missing.length > 0;
  const save = trpc.learning.admin.saveRule.useMutation({ onSuccess: () => { toast.success(active ? t("learningManage.rules.saveActive") : t("learningManage.rules.saveInactive")); onSaved(); }, onError: (e) => toastError(e) });
  const exp = cat.data?.experiences.find((e) => e.id === experienceId);
  const course = cat.data?.courses.find((c) => c.id === courseId);
  const valid = experienceId !== "" && courseId !== "" && moduleIds.length > 0 && (days === "" || (Number(days) >= 1 && Number(days) <= 3650)) && !blocked && moduleSettings.every((s) => (s.durationDays == null || (s.durationDays >= 1 && s.durationDays <= 3650)) && (s.unlockOffsetDays == null || s.unlockOffsetDays <= 3650));
  const wasActive = rule?.active ?? false;
  // Preset RECONNECT: M1 día 0, M2 día 30, M3 día 60, 30 días cada uno (en el orden del curso). Solo rellena el formulario; no guarda.
  const orderedSelected = (course?.modules ?? []).map((m) => m.id).filter((id) => moduleIds.includes(id));
  function applyStagger() {
    const preset = reconnectStaggeredSettings(orderedSelected);
    setSched(Object.fromEntries(preset.map((p) => [p.moduleId, { offset: String(p.unlockOffsetDays), dur: String(p.durationDays) }])));
    setDays(String(RECONNECT_MODULE_DAYS));
    setActivationRequired(false);
    toast.info(t("learningManage.rules.staggerApplied"));
  }
  async function submit() {
    if (active && !wasActive && !(await confirmAction({ description: t("learningManage.rules.activateConfirm") }))) return;
    save.mutate({ id: rule?.id, experienceId: Number(experienceId), variantId: variantId === "" ? null : Number(variantId), courseId: Number(courseId), moduleIds, durationDays: days === "" ? null : Number(days), startMode: "on_grant", fixedStart: null, active, permanent, activationRequired, moduleSettings });
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
            {course && moduleIds.length > 0 && (
              <fieldset className="space-y-2 rounded-md border p-2" data-testid="rule-calendar"><legend className="px-1">{t("learningManage.rules.moduleCalendar")}</legend>
                <p className="text-xs text-muted-foreground">{t("learningManage.rules.moduleCalendarHelp")}</p>
                {orderedSelected.length <= 3 && (
                  <div className="flex flex-wrap items-center gap-2">
                    <Button type="button" size="sm" variant="outline" data-testid="rule-stagger-preset" onClick={applyStagger}><CalendarRange className="mr-1.5 h-4 w-4" aria-hidden />{t("learningManage.rules.staggerPreset")}</Button>
                    <span className="text-xs text-muted-foreground">{t("learningManage.rules.staggerHelp")}</span>
                  </div>
                )}
                {course.modules.filter((m) => moduleIds.includes(m.id)).map((m) => (
                  <div key={m.id} className="grid grid-cols-[1fr_6rem_6rem] items-end gap-2">
                    <span className="truncate">{m.title}</span>
                    <label className="text-xs">{t("learningManage.rules.unlockOffset")}<Input inputMode="numeric" aria-label={`${m.title}: ${t("learningManage.rules.unlockOffset")}`} value={sched[m.id]?.offset ?? ""} onChange={(e) => setField(m.id, "offset", e.target.value)} placeholder="0" /></label>
                    <label className="text-xs">{t("learningManage.rules.moduleDuration")}<Input inputMode="numeric" aria-label={`${m.title}: ${t("learningManage.rules.moduleDuration")}`} value={sched[m.id]?.dur ?? ""} onChange={(e) => setField(m.id, "dur", e.target.value)} placeholder={t("learningManage.rules.inheritsDuration")} /></label>
                  </div>
                ))}
              </fieldset>
            )}
            <label className="flex items-center gap-2"><input type="checkbox" checked={permanent} onChange={(e) => setPermanent(e.target.checked)} />{t("learningManage.rules.permanentLabel")}</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={activationRequired} onChange={(e) => setActivationRequired(e.target.checked)} />{t("learningManage.rules.activationLabel")}</label>
            <label className="block">{t("learningManage.rules.duration")}<Input inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value.replace(/\D/g, ""))} placeholder={t("learningManage.rules.durationPlaceholder")} /></label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />{t("learningManage.rules.activeLabel")}</label>
            {!active && <p className="text-xs text-muted-foreground">{t("learningManage.rules.inactiveNote")}</p>}
            {blocked && <p role="alert" data-testid="rule-needs-duration" className="rounded-md border border-warning/40 bg-warning/10 px-2 py-1 text-xs text-warning">{t("learningManage.rules.needsDurationWarning", { n: missing.length })}</p>}
            <div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose}>{t("learningManage.rules.cancel")}</Button><Button disabled={!valid || save.isPending} onClick={submit}>{t("learningManage.rules.save")}</Button></div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * Catálogo de ampliaciones (+30 / +60 días por módulo): producto y sus dos variantes. El servidor comprueba que existen, están
 * vigentes y tienen precio > 0; el importe lo da cada variante (aquí no se escribe ningún precio).
 */
function ExtensionCatalogForm() {
  const { t, format } = useI18n();
  const utils = trpc.useUtils();
  const cat = trpc.learning.admin.catalog.useQuery();
  const cur = trpc.learning.admin.getExtensionCatalog.useQuery();
  const [experienceId, setExperienceId] = useState<number | "">("");
  const [v30, setV30] = useState<number | "">("");
  const [v60, setV60] = useState<number | "">("");
  useEffect(() => {
    const cfg = cur.data?.config;
    if (!cfg) return;
    setExperienceId(cfg.experienceId);
    setV30(cfg.variants.find((v) => v.days === 30)?.variantId ?? "");
    setV60(cfg.variants.find((v) => v.days === 60)?.variantId ?? "");
  }, [cur.data]);
  const save = trpc.learning.admin.setExtensionCatalog.useMutation({ onSuccess: () => { toast.success(t("learningManage.rules.extension.saved")); utils.learning.admin.getExtensionCatalog.invalidate(); }, onError: (e) => toastError(e) });
  const exp = cat.data?.experiences.find((e) => e.id === experienceId);
  const valid = experienceId !== "" && v30 !== "" && v60 !== "" && v30 !== v60;
  const sel = "mt-1 block w-full rounded-md border bg-background px-2 py-1.5";
  return (
    <section className="rounded-xl border bg-card p-4 text-sm" data-testid="extension-catalog">
      <h3 className="font-semibold">{t("learningManage.rules.extension.title")}</h3>
      <p className="mt-1 text-xs text-muted-foreground">{t("learningManage.rules.extension.intro")}</p>
      <p className="mt-2 text-xs">
        {cur.data?.catalog
          ? t("learningManage.rules.extension.current", { product: cur.data.catalog.productName, offers: cur.data.catalog.offers.map((o) => t("learningManage.rules.extension.offer", { days: o.days, price: format.currency(o.priceCents / 100) })).join(" · ") })
          : cur.data?.config ? t("learningManage.rules.extension.current", { product: `#${cur.data.config.experienceId}`, offers: t("learningManage.rules.extension.noOffers") }) : t("learningManage.rules.extension.none")}
      </p>
      {cat.isLoading ? <PanelLoading /> : cat.isError ? <PanelError error={cat.error} onRetry={() => cat.refetch()} /> : (
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          <label className="block">{t("learningManage.rules.extension.product")}
            <select className={sel} value={experienceId} onChange={(e) => { setExperienceId(e.target.value ? Number(e.target.value) : ""); setV30(""); setV60(""); }}>
              <option value="">{t("learningManage.rules.chooseProduct")}</option>
              {cat.data!.experiences.map((e) => <option key={e.id} value={e.id}>{e.title}</option>)}
            </select>
          </label>
          {([[30, v30, setV30], [60, v60, setV60]] as const).map(([days, value, set]) => (
            <label key={days} className="block">{t(`learningManage.rules.extension.variant${days}`)}
              <select className={sel} value={value} disabled={experienceId === ""} onChange={(e) => set(e.target.value ? Number(e.target.value) : "")}>
                <option value="">{t("learningManage.rules.extension.chooseVariant")}</option>
                {(exp?.variants ?? []).map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
            </label>
          ))}
        </div>
      )}
      <div className="mt-3 flex justify-end"><Button size="sm" disabled={!valid || save.isPending} onClick={() => save.mutate({ experienceId: Number(experienceId), variants: { 30: Number(v30), 60: Number(v60) } })}>{t("learningManage.rules.extension.save")}</Button></div>
    </section>
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
                <StatusBadge tone={r.active ? "success" : "neutral"}>{r.active ? t("learningManage.rules.active") : t("learningManage.rules.inactive")}</StatusBadge>
              </div>
              <dl className="mt-3 space-y-1 text-sm">
                <div className="flex gap-2"><dt className="w-20 shrink-0 text-muted-foreground">{t("learningManage.rules.course")}</dt><dd>{r.courseTitle ?? "—"}</dd></div>
                <div className="flex gap-2"><dt className="w-20 shrink-0 text-muted-foreground">{t("learningManage.rules.opens")}</dt><dd>{modulesLabel(r)}</dd></div>
                <div className="flex gap-2"><dt className="w-20 shrink-0 text-muted-foreground">{t("learningManage.rules.durationLabel")}</dt><dd>{r.durationDays ? t("learningManage.rules.days", { n: r.durationDays }) : t("learningManage.rules.noLimit")}</dd></div>
                {(r.permanent || r.activationRequired || r.moduleSchedule) && <div className="flex gap-2"><dt className="w-20 shrink-0 text-muted-foreground">{t("learningManage.rules.moduleCalendar")}</dt><dd>{r.permanent ? t("learningManage.rules.permanentTag") : ""}{r.activationRequired ? t("learningManage.rules.activationTag") : ""}{r.moduleSchedule ? Object.entries(r.moduleSchedule).map(([m, s]) => `#${m}: ${t("learningManage.rules.scheduleLine", { offset: s.unlockOffsetDays ?? 0, duration: s.durationDays != null ? t("learningManage.rules.days", { n: s.durationDays }) : "—" })}`).join(" · ") : ""}</dd></div>}
                <div className="flex gap-2"><dt className="w-20 shrink-0 text-muted-foreground">{t("learningManage.rules.start")}</dt><dd>{r.startMode === "fixed_date" ? fmtDate(r.fixedStart) : t("learningManage.rules.onGrant")}</dd></div>
              </dl>
              <div className="mt-3"><Button size="sm" variant="outline" onClick={() => setEditing(r)}><Pencil className="mr-1.5 h-4 w-4" aria-hidden />{t("learningManage.rules.edit")}</Button></div>
            </li>
          ))}
        </ul>
      )}
      <ExtensionCatalogForm />
      {editing && <RuleForm rule={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); utils.learning.admin.rules.invalidate(); }} />}
    </div>
  );
}
