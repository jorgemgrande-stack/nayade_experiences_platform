/**
 * Piezas de «Plantillas y reglas» (Atención Comercial): interruptor accesible, formulario de regla por secciones
 * (compartido por «Nueva regla» y «Editar regla»), tarjeta de regla y ficha de plantilla desplegable.
 * Solo presentación: las consultas y mutaciones son las de siempre.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { AlertTriangle, ChevronDown, Pencil, Plus, Send, Trash2 } from "lucide-react";
import { toastError } from "@/lib/errorMessage";
import { useI18n } from "@/i18n/I18nProvider";
import { confirmAction } from "@/components/admin/ConfirmHost";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusBadge } from "@/components/admin/PanelUi";
import { FormField, FormSection } from "@/pages/admin/accounting/shared/EconomyUi";
import { cn } from "@/lib/utils";

export type TemplateConfig = {
  id: number | null;
  key: string;
  category: string | null;
  friendlyName: string | null;
  isActive: boolean;
  sendToCustomer: boolean;
  sendToAdmin: boolean;
  adminCopyEmail: string | null;
  customSubject: string | null;
  notes: string | null;
  _fromDb?: boolean;
};

export type AutomationRule = {
  id: number;
  templateKey: string;
  name: string;
  isActive: boolean;
  sortOrder: number;
  delayHours: number;
  calculateFrom: string;
  maxSendsPerEntity: number;
  allowedSendStart: string;
  allowedSendEnd: string;
  stopIfConverted: boolean;
  stopIfPaid: boolean;
  onlyIfNotViewed: boolean;
  allowIfViewedButUnpaid: boolean;
  maxCumulativeSendsPerEntity: number | null;
  stopAfterDays: number | null;
  respectCommercialPause: boolean;
  emailSubject: string | null;
  emailBody: string | null;
};

export const CATEGORIES = [
  "Leads", "Presupuestos", "Reservas", "Pagos / Transferencias",
  "Anulaciones", "Cupones", "Restaurantes", "Operaciones internas", "Administración",
];

/** Plantillas con tarea programada antigua propia: el sistema bloquea las reglas nuevas para evitar duplicados. */
const LEGACY_CRON_KEYS = new Set(["quote"]);

/** Formulario de regla: igual para crear y editar (al crear hay menos opciones de «calcular desde» y no hay orden ni paradas). */
type RuleForm = Omit<AutomationRule, "id" | "templateKey" | "emailSubject" | "emailBody"> & { emailSubject: string | null; emailBody: string | null };

export function Toggle({ value, onChange, label }: { value: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm text-foreground">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={value}
        aria-label={label}
        onClick={() => onChange(!value)}
        className={cn("relative h-5 w-9 shrink-0 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", value ? "bg-success" : "bg-muted-foreground/40")}
      >
        <span className={cn("absolute left-0.5 top-0.5 block h-4 w-4 rounded-full bg-background shadow transition-transform", value && "translate-x-4")} />
      </button>
    </div>
  );
}

const FROM_EDIT = ["trigger_time", "last_reminder", "created_at", "viewed_at", "expires_at"] as const;
const FROM_NEW = ["trigger_time", "last_reminder", "created_at"] as const;

/** Campos de una regla en secciones: nombre, cuándo, (paradas), comportamiento comercial y contenido. */
function RuleFields({ form, setForm, mode }: { form: RuleForm; setForm: (fn: (f: RuleForm) => RuleForm) => void; mode: "edit" | "new" }) {
  const { t } = useI18n();
  const num = (v: string) => (v === "" ? null : +v);
  const options = mode === "edit" ? FROM_EDIT : FROM_NEW;
  return (
    <div className="space-y-4">
      <FormField label={t("templateRules.form.name")} required>
        <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder={mode === "new" ? t("templateRules.form.namePlaceholder") : undefined} autoComplete="off" />
      </FormField>

      <FormSection title={t("templateRules.form.timing")} description={t("templateRules.form.timingHelp")}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FormField label={t("templateRules.form.delay")}>
            <Input type="number" min={1} value={form.delayHours} onChange={(e) => setForm((f) => ({ ...f, delayHours: +e.target.value }))} />
          </FormField>
          <FormField label={t("templateRules.form.calculateFrom")}>
            <Select value={form.calculateFrom} onValueChange={(v) => setForm((f) => ({ ...f, calculateFrom: v }))}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                {options.map((o) => <SelectItem key={o} value={o}>{t(`templateRules.fromOption.${o}`)}</SelectItem>)}
              </SelectContent>
            </Select>
          </FormField>
          <FormField label={t("templateRules.form.start")}>
            <Input value={form.allowedSendStart} onChange={(e) => setForm((f) => ({ ...f, allowedSendStart: e.target.value }))} className="font-mono" autoComplete="off" />
          </FormField>
          <FormField label={t("templateRules.form.end")}>
            <Input value={form.allowedSendEnd} onChange={(e) => setForm((f) => ({ ...f, allowedSendEnd: e.target.value }))} className="font-mono" autoComplete="off" />
          </FormField>
          {mode === "edit" && (
            <>
              <FormField label={t("templateRules.form.max")}>
                <Input type="number" min={1} max={10} value={form.maxSendsPerEntity} onChange={(e) => setForm((f) => ({ ...f, maxSendsPerEntity: +e.target.value }))} />
              </FormField>
              <FormField label={t("templateRules.form.order")}>
                <Input type="number" value={form.sortOrder} onChange={(e) => setForm((f) => ({ ...f, sortOrder: +e.target.value }))} />
              </FormField>
            </>
          )}
        </div>
      </FormSection>

      {mode === "edit" && (
        <FormSection title={t("templateRules.form.stop")}>
          <Toggle value={form.stopIfConverted} onChange={(v) => setForm((f) => ({ ...f, stopIfConverted: v }))} label={t("templateRules.form.stopConverted")} />
          <Toggle value={form.stopIfPaid} onChange={(v) => setForm((f) => ({ ...f, stopIfPaid: v }))} label={t("templateRules.form.stopPaid")} />
          <Toggle value={form.isActive} onChange={(v) => setForm((f) => ({ ...f, isActive: v }))} label={t("templateRules.form.ruleActive")} />
        </FormSection>
      )}

      <FormSection title={t("templateRules.form.commercial")} description={t("templateRules.form.commercialHint")} className="border-primary/40 bg-primary/5">
        <Toggle value={form.respectCommercialPause} onChange={(v) => setForm((f) => ({ ...f, respectCommercialPause: v }))} label={t("templateRules.form.respectPause")} />
        {form.respectCommercialPause && (
          <div className="space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <FormField label={t("templateRules.form.totalCap")}>
                <Input type="number" min={1} max={20} value={form.maxCumulativeSendsPerEntity ?? ""} placeholder={t("templateRules.form.unlimited")}
                  onChange={(e) => setForm((f) => ({ ...f, maxCumulativeSendsPerEntity: num(e.target.value) }))} />
              </FormField>
              <FormField label={t("templateRules.form.maxDays")}>
                <Input type="number" min={1} max={365} value={form.stopAfterDays ?? ""} placeholder={t("templateRules.form.noLimit")}
                  onChange={(e) => setForm((f) => ({ ...f, stopAfterDays: num(e.target.value) }))} />
              </FormField>
            </div>
            <Toggle value={form.onlyIfNotViewed} onChange={(v) => setForm((f) => ({ ...f, onlyIfNotViewed: v }))} label={t("templateRules.form.onlyNotViewed")} />
            <Toggle value={form.allowIfViewedButUnpaid} onChange={(v) => setForm((f) => ({ ...f, allowIfViewedButUnpaid: v }))} label={t("templateRules.form.allowViewed")} />
          </div>
        )}
      </FormSection>

      <div className="rounded-lg border border-info/40 bg-info/10 px-3 py-2 text-xs text-foreground">{t("templateRules.form.contentNote")}</div>
      <FormField label={`${t("templateRules.form.subjectOverride")} ${t("templateRules.form.optional")}`}>
        <Input value={form.emailSubject ?? ""} onChange={(e) => setForm((f) => ({ ...f, emailSubject: e.target.value || null }))} placeholder={t("templateRules.form.subjectPlaceholder")} autoComplete="off" />
      </FormField>
      <FormField label={`${t("templateRules.form.bodyOverride")} ${t("templateRules.form.bodyHint")}`}>
        <Textarea value={form.emailBody ?? ""} onChange={(e) => setForm((f) => ({ ...f, emailBody: e.target.value || null }))} rows={4} className="font-mono text-xs" placeholder={t("templateRules.form.bodyPlaceholder")} />
      </FormField>
    </div>
  );
}

function RuleCard({ rule, onUpdate, onDelete }: { rule: AutomationRule; onUpdate: (id: number, data: Partial<AutomationRule>) => void; onDelete: (id: number) => void }) {
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<RuleForm>({ ...rule });
  const from = FROM_EDIT.includes(rule.calculateFrom as (typeof FROM_EDIT)[number]) ? t(`templateRules.from.${rule.calculateFrom}`) : rule.calculateFrom;

  return (
    <div className="rounded-lg border border-border bg-muted/40 p-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className={cn("h-2 w-2 shrink-0 rounded-full", rule.isActive ? "bg-success" : "bg-muted-foreground/40")} aria-hidden="true" />
            <span className="text-sm font-medium text-foreground">{rule.name}</span>
            <span className="sr-only">{rule.isActive ? t("templateRules.state.active") : t("templateRules.state.inactive")}</span>
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {t("templateRules.rules.summary", { hours: rule.delayHours, from, start: rule.allowedSendStart, end: rule.allowedSendEnd, max: rule.maxSendsPerEntity })}
            {rule.maxCumulativeSendsPerEntity != null && ` · ${t("templateRules.rules.cap", { n: rule.maxCumulativeSendsPerEntity })}`}
            {rule.stopAfterDays != null && ` · ${t("templateRules.rules.window", { n: rule.stopAfterDays })}`}
          </div>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {rule.respectCommercialPause && <StatusBadge tone="brand">{t("templateRules.rules.tagCommercial")}</StatusBadge>}
            {rule.onlyIfNotViewed && <StatusBadge tone="info">{t("templateRules.rules.tagNotViewed")}</StatusBadge>}
            {!rule.allowIfViewedButUnpaid && <StatusBadge tone="warning">{t("templateRules.rules.tagSkipViewed")}</StatusBadge>}
          </div>
          {rule.emailSubject && (
            <div className="mt-1 overflow-hidden text-ellipsis whitespace-nowrap text-xs text-muted-foreground">{t("templateRules.rules.subjectLine", { subject: rule.emailSubject })}</div>
          )}
        </div>
        <div className="flex shrink-0 gap-1">
          <Button type="button" variant="ghost" size="sm" onClick={() => { setForm({ ...rule }); setEditing(true); }}>
            <Pencil className="mr-1 h-3.5 w-3.5" aria-hidden="true" />{t("templateRules.rules.edit")}
          </Button>
          <Button type="button" variant="ghost" size="sm" className="text-danger hover:text-danger"
            onClick={async () => { if (await confirmAction({ description: t("templateRules.rules.deleteConfirm", { name: rule.name }), destructive: true })) onDelete(rule.id); }}>
            <Trash2 className="mr-1 h-3.5 w-3.5" aria-hidden="true" />{t("templateRules.rules.delete")}
          </Button>
        </div>
      </div>

      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("templateRules.form.editTitle")}</DialogTitle>
            <DialogDescription className="sr-only">{rule.name}</DialogDescription>
          </DialogHeader>
          <RuleFields form={form} setForm={setForm} mode="edit" />
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setEditing(false)}>{t("templateRules.form.cancel")}</Button>
            <Button size="sm" onClick={() => { onUpdate(rule.id, form); setEditing(false); }}>{t("templateRules.form.saveRule")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

const EMPTY_RULE: RuleForm = {
  name: "", isActive: true, sortOrder: 0, delayHours: 24, calculateFrom: "trigger_time", maxSendsPerEntity: 1,
  allowedSendStart: "09:00", allowedSendEnd: "21:00", stopIfConverted: true, stopIfPaid: true,
  onlyIfNotViewed: false, allowIfViewedButUnpaid: true, maxCumulativeSendsPerEntity: null, stopAfterDays: null,
  respectCommercialPause: false, emailSubject: "", emailBody: "",
};

export function TemplateCard({ config, categoryLabel }: { config: TemplateConfig; categoryLabel?: string }) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const [showNewRule, setShowNewRule] = useState(false);
  const [showTest, setShowTest] = useState(false);
  const [testEmail, setTestEmail] = useState("");
  const utils = trpc.useUtils();

  const upsert = trpc.emailCommunications.upsertTemplateConfig.useMutation({
    onSuccess: () => { toast.success(t("templateRules.saved")); utils.emailCommunications.listTemplateConfigs.invalidate(); },
    onError: (e) => toastError(e),
  });
  const { data: rules, refetch: refetchRules } = trpc.emailCommunications.listRules.useQuery({ templateKey: config.key }, { enabled: expanded });
  const resetRuleForm = () => setRuleForm(EMPTY_RULE);
  const createRule = trpc.emailCommunications.createRule.useMutation({
    onSuccess: () => { toast.success(t("templateRules.rules.created")); setShowNewRule(false); refetchRules(); resetRuleForm(); },
    onError: (e) => toastError(e),
  });
  const updateRule = trpc.emailCommunications.updateRule.useMutation({
    onSuccess: () => { toast.success(t("templateRules.rules.updated")); refetchRules(); },
    onError: (e) => toastError(e),
  });
  const deleteRule = trpc.emailCommunications.deleteRule.useMutation({
    onSuccess: () => { toast.success(t("templateRules.rules.deleted")); refetchRules(); },
    onError: (e) => toastError(e),
  });
  const sendTest = trpc.emailCommunications.sendTestEmail.useMutation({
    onSuccess: (r) => { toast.success(t("templateRules.test.sent", { to: r.to })); setShowTest(false); setTestEmail(""); },
    onError: (e) => toastError(e),
  });

  const [ruleForm, setRuleForm] = useState<RuleForm>(EMPTY_RULE);
  const [localActive, setLocalActive] = useState(config.isActive);
  const [localToCustomer, setLocalToCustomer] = useState(config.sendToCustomer);
  const [localToAdmin, setLocalToAdmin] = useState(config.sendToAdmin);
  const [localAdminEmail, setLocalAdminEmail] = useState(config.adminCopyEmail ?? "");
  const [localSubject, setLocalSubject] = useState(config.customSubject ?? "");
  const dirty = localActive !== config.isActive || localToCustomer !== config.sendToCustomer || localToAdmin !== config.sendToAdmin
    || localAdminEmail !== (config.adminCopyEmail ?? "") || localSubject !== (config.customSubject ?? "");

  const save = () => {
    upsert.mutate({
      key: config.key, isActive: localActive, sendToCustomer: localToCustomer, sendToAdmin: localToAdmin,
      adminCopyEmail: localAdminEmail || null, customSubject: localSubject || null,
    });
  };

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <button type="button" aria-expanded={expanded} onClick={() => setExpanded((e) => !e)}
        className="flex w-full items-center justify-between gap-3 p-3 text-left hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <StatusBadge tone={localActive ? "success" : "neutral"}>{localActive ? t("templateRules.state.active") : t("templateRules.state.inactive")}</StatusBadge>
          <span className="min-w-0 break-words text-sm font-medium text-foreground">{config.friendlyName ?? config.key}</span>
          {rules && rules.length > 0 && <span className="shrink-0 text-xs text-info">{t("templateRules.rulesCount", { count: rules.length })}</span>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {categoryLabel && <span className="hidden text-xs text-muted-foreground sm:inline">{categoryLabel}</span>}
          <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", expanded && "rotate-180")} aria-label={expanded ? t("templateRules.collapse") : t("templateRules.expand")} />
        </div>
      </button>

      {expanded && (
        <div className="space-y-4 border-t border-border p-4">
          {LEGACY_CRON_KEYS.has(config.key) && (
            <div role="note" className="flex gap-2 rounded-lg border border-warning/50 bg-warning/10 p-3 text-xs text-foreground">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
              <div>
                <span className="font-semibold">{t("templateRules.legacy.title")}:</span> {t(`templateRules.legacy.${config.key}`)}.
                <br />{t("templateRules.legacy.body")}
              </div>
            </div>
          )}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <FormSection title={t("templateRules.main.title")} description={t("templateRules.main.help")}>
              <Toggle value={localActive} onChange={setLocalActive} label={t("templateRules.main.active")} />
              <Toggle value={localToCustomer} onChange={setLocalToCustomer} label={t("templateRules.main.toCustomer")} />
              <Toggle value={localToAdmin} onChange={setLocalToAdmin} label={t("templateRules.main.toAdmin")} />
            </FormSection>
            <FormSection title={t("templateRules.admin.title")} description={t("templateRules.admin.help")}>
              <FormField label={t("templateRules.admin.copyEmail")}>
                <Input type="email" value={localAdminEmail} onChange={(e) => setLocalAdminEmail(e.target.value)} placeholder={t("templateRules.admin.copyPlaceholder")} autoComplete="off" />
              </FormField>
              <FormField label={t("templateRules.admin.subject")}>
                <Input value={localSubject} onChange={(e) => setLocalSubject(e.target.value)} placeholder={t("templateRules.admin.subjectPlaceholder")} autoComplete="off" />
              </FormField>
            </FormSection>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={save} disabled={upsert.isPending || !dirty}>
              {upsert.isPending ? t("templateRules.saving") : t("templateRules.save")}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setShowTest(true)}>
              <Send className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />{t("templateRules.sendTest")}
            </Button>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <h4 className="text-sm font-semibold text-foreground">{t("templateRules.rules.title")}</h4>
              <Button type="button" variant="ghost" size="sm" onClick={() => setShowNewRule(true)}>
                <Plus className="mr-1 h-3.5 w-3.5" aria-hidden="true" />{t("templateRules.rules.newRule")}
              </Button>
            </div>
            {!rules || rules.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border py-4 text-center text-xs text-muted-foreground">{t("templateRules.rules.empty")}</p>
            ) : (
              <div className="space-y-2">
                {rules.map((r) => (
                  <RuleCard key={r.id} rule={r as AutomationRule}
                    onUpdate={(id, data) => updateRule.mutate({ id, ...data as any })}
                    onDelete={(id) => deleteRule.mutate({ id })} />
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      <Dialog open={showNewRule} onOpenChange={setShowNewRule}>
        <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("templateRules.form.newTitle")}</DialogTitle>
            <DialogDescription>{t("templateRules.form.template")}: <span className="font-mono text-foreground">{config.key}</span></DialogDescription>
          </DialogHeader>
          <RuleFields form={ruleForm} setForm={setRuleForm} mode="new" />
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => { setShowNewRule(false); resetRuleForm(); }}>{t("templateRules.form.cancel")}</Button>
            <Button size="sm" disabled={!ruleForm.name || createRule.isPending}
              onClick={() => createRule.mutate({ templateKey: config.key, ...ruleForm, emailSubject: ruleForm.emailSubject ?? "", emailBody: ruleForm.emailBody ?? "", calculateFrom: ruleForm.calculateFrom as "trigger_time", isActive: true, sortOrder: (rules?.length ?? 0) })}>
              {t("templateRules.form.create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showTest} onOpenChange={setShowTest}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("templateRules.test.title")}</DialogTitle>
            <DialogDescription>{t("templateRules.test.template")}: <span className="font-mono text-foreground">{config.key}</span></DialogDescription>
          </DialogHeader>
          <FormField label={t("templateRules.test.recipient")} hint={t("templateRules.test.help")}>
            <Input type="email" value={testEmail} onChange={(e) => setTestEmail(e.target.value)} placeholder={t("templateRules.test.placeholder")} autoComplete="off" />
          </FormField>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setShowTest(false)}>{t("templateRules.form.cancel")}</Button>
            <Button size="sm" disabled={!testEmail || sendTest.isPending}
              onClick={() => sendTest.mutate({ to: testEmail, templateKey: config.key })}>
              {t("templateRules.test.send")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
