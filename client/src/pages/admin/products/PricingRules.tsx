/**
 * Reglas de precios (Business, `pricing-rules`): descuentos y recargos que la empresa aplica a sus productos en la tienda
 * online, el TPV y los presupuestos, con prioridad, vigencia y condiciones, y una simulación de precio para probarlas.
 * Solo administración. Essential no llega a esta pantalla (el guardián de rutas muestra «No incluido en tu plan») y sus
 * precios y cupones siguen igual.
 */
import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Calculator, Pencil, Percent, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { usePanelSubscription } from "@/hooks/usePanelSubscription";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { PanelEmpty, PanelError, PanelLoading } from "@/components/admin/PanelStates";
import { FormField, describedBy, selectClass } from "@/components/admin/crm/CrmParts";
import { toastError } from "@/lib/errorMessage";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n/I18nProvider";
import type { Formatters, Translate } from "@shared/i18n/core";
import {
  ADJUSTMENT_KINDS, PRICING_CHANNELS, RULE_NAME_MAX, RULE_SCOPES, VALUE_TYPES,
  emptyRuleForm, normalizeRuleForm, validateRuleForm,
  type PricingChannel, type PricingRule, type RuleForm, type RuleFormErrors,
} from "@shared/pricingRules";

const CAP = "pricing-rules";
const fmtDateKey = (format: Formatters, d: string) => {
  const [y, m, day] = d.split("-").map(Number);
  return format.date(new Date(y, m - 1, day));
};

const channelLabel = (t: Translate, c: PricingChannel) => ({ web: t("productsPricing.channel.web"), tpv: t("productsPricing.channel.tpv"), presupuesto: t("productsPricing.channel.presupuesto") })[c];
const weekdayLabel = (t: Translate, d: number) => [
  "", t("productsPricing.weekday.d1"), t("productsPricing.weekday.d2"), t("productsPricing.weekday.d3"), t("productsPricing.weekday.d4"), t("productsPricing.weekday.d5"), t("productsPricing.weekday.d6"), t("productsPricing.weekday.d7"),
][d];
const weekdayShort = (t: Translate, d: number) => [
  "", t("productsPricing.weekdayShort.d1"), t("productsPricing.weekdayShort.d2"), t("productsPricing.weekdayShort.d3"), t("productsPricing.weekdayShort.d4"), t("productsPricing.weekdayShort.d5"), t("productsPricing.weekdayShort.d6"), t("productsPricing.weekdayShort.d7"),
][d];
const kindLabel = (t: Translate, k: "descuento" | "recargo") => (k === "descuento" ? t("productsPricing.kind.descuento") : t("productsPricing.kind.recargo"));
const valueTypeLabel = (t: Translate, k: "porcentaje" | "importe") => (k === "porcentaje" ? t("productsPricing.valueType.porcentaje") : t("productsPricing.valueType.importe"));
const scopeLabel = (t: Translate, k: "todo" | "producto" | "categoria") => (k === "todo" ? t("productsPricing.scope.todo") : k === "producto" ? t("productsPricing.scope.producto") : t("productsPricing.scope.categoria"));
function describeAdjustmentI18n(t: Translate, format: Formatters, rule: Pick<PricingRule, "kind" | "valueType" | "value">): string {
  const sign = rule.kind === "descuento" ? "−" : "+";
  const value = format.number(rule.value, { minimumFractionDigits: rule.valueType === "importe" ? 2 : 0, maximumFractionDigits: 2 });
  return rule.valueType === "porcentaje" ? t("productsPricing.adjust.percent", { sign, value }) : t("productsPricing.adjust.perUnit", { sign, value });
}

type Options = { products: { id: number; title: string; basePrice: number | null; categoryId: number }[]; categories: { id: number; name: string }[] };

function toggle<T>(list: T[], v: T): T[] {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
}

function ruleSummary(r: PricingRule, opts: Options | undefined, t: Translate, format: Formatters): string[] {
  const out: string[] = [];
  const fmtDate = (d: string) => fmtDateKey(format, d);
  if (r.scope === "todo") out.push(t("productsPricing.summary.all"));
  else {
    const names = r.scope === "producto"
      ? r.targetIds.map((id) => opts?.products.find((p) => p.id === id)?.title ?? `#${id}`)
      : r.targetIds.map((id) => opts?.categories.find((c) => c.id === id)?.name ?? `#${id}`);
    out.push(t("productsPricing.summary.list", { label: r.scope === "producto" ? t("productsPricing.summary.products") : t("productsPricing.summary.categories"), names: `${names.slice(0, 3).join(", ")}${names.length > 3 ? t("productsPricing.summary.andMore", { n: names.length - 3 }) : ""}` }));
  }
  if (r.minQuantity > 1) out.push(t("productsPricing.summary.fromUnits", { n: r.minQuantity }));
  if (r.weekdays.length) out.push(r.weekdays.map((d) => weekdayShort(t, d)).join(", "));
  if (r.serviceFrom || r.serviceTo) out.push(`${t("productsPricing.summary.service")} ${r.serviceFrom ? t("productsPricing.summary.from", { date: fmtDate(r.serviceFrom) }) : ""}${r.serviceFrom && r.serviceTo ? " " : ""}${r.serviceTo ? t("productsPricing.summary.to", { date: fmtDate(r.serviceTo) }) : ""}`);
  if (r.validFrom || r.validTo) out.push(`${t("productsPricing.summary.valid")} ${r.validFrom ? t("productsPricing.summary.from", { date: fmtDate(r.validFrom) }) : ""}${r.validFrom && r.validTo ? " " : ""}${r.validTo ? t("productsPricing.summary.to", { date: fmtDate(r.validTo) }) : ""}`);
  out.push(r.channels.map((c) => channelLabel(t, c)).join(", "));
  if (r.combinable) out.push(t("productsPricing.summary.combinable"));
  return out;
}

// ─── Editor ──────────────────────────────────────────────────────────────────

function RuleEditor({ rule, opts, onClose }: { rule: PricingRule | null; opts: Options | undefined; onClose: () => void }) {
  const { t } = useI18n();
  const utils = trpc.useUtils();
  const [form, setForm] = useState<RuleForm>(() => (rule ? { ...rule } : emptyRuleForm()));
  const [valueText, setValueText] = useState(String(rule?.value ?? emptyRuleForm().value).replace(".", ","));
  const [errors, setErrors] = useState<RuleFormErrors>({});
  const done = (msg: string) => {
    toast.success(msg);
    utils.pricingRules.invalidate();
    onClose();
  };
  const create = trpc.pricingRules.create.useMutation({ onSuccess: () => done(t("productsPricing.toast.created")), onError: (e) => toastError(e) });
  const update = trpc.pricingRules.update.useMutation({ onSuccess: () => done(t("productsPricing.toast.saved")), onError: (e) => toastError(e) });
  const set = <K extends keyof RuleForm>(k: K, v: RuleForm[K]) => setForm((f) => ({ ...f, [k]: v }));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const value = Number(valueText.replace(",", "."));
    const clean = normalizeRuleForm({ ...form, value: Number.isFinite(value) ? value : NaN });
    const errs = validateRuleForm(clean);
    setErrors(errs);
    if (Object.keys(errs).length) return;
    if (rule) update.mutate({ id: rule.id, ...clean });
    else create.mutate(clean);
  };
  const targets = form.scope === "producto"
    ? (opts?.products ?? []).map((p) => ({ id: p.id, label: p.title }))
    : (opts?.categories ?? []).map((c) => ({ id: c.id, label: c.name }));

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <FormField id="rule-name" label={t("productsPricing.editor.name")} error={errors.name} required>
        <Input id="rule-name" value={form.name} maxLength={RULE_NAME_MAX} onChange={(e) => set("name", e.target.value)} aria-invalid={!!errors.name} aria-required aria-describedby={describedBy("rule-name", errors.name)} placeholder={t("productsPricing.editor.namePlaceholder")} autoFocus />
      </FormField>

      <div className="grid gap-3 sm:grid-cols-3">
        <FormField id="rule-kind" label={t("productsPricing.editor.kind")}>
          <select id="rule-kind" className={selectClass} value={form.kind} onChange={(e) => set("kind", e.target.value as RuleForm["kind"])}>
            {ADJUSTMENT_KINDS.map((k) => <option key={k} value={k}>{kindLabel(t, k)}</option>)}
          </select>
        </FormField>
        <FormField id="rule-value-type" label={t("productsPricing.editor.calc")}>
          <select id="rule-value-type" className={selectClass} value={form.valueType} onChange={(e) => set("valueType", e.target.value as RuleForm["valueType"])}>
            {VALUE_TYPES.map((k) => <option key={k} value={k}>{valueTypeLabel(t, k)}</option>)}
          </select>
        </FormField>
        <FormField id="rule-value" label={form.valueType === "porcentaje" ? t("productsPricing.editor.valuePercent") : t("productsPricing.editor.valueAmount")} error={errors.value} required>
          <Input id="rule-value" inputMode="decimal" value={valueText} onChange={(e) => setValueText(e.target.value)} aria-invalid={!!errors.value} aria-required aria-describedby={describedBy("rule-value", errors.value)} />
        </FormField>
      </div>

      <FormField id="rule-scope" label={t("productsPricing.editor.appliesTo")} error={errors.targetIds}>
        <select id="rule-scope" className={selectClass} value={form.scope} onChange={(e) => setForm((f) => ({ ...f, scope: e.target.value as RuleForm["scope"], targetIds: [] }))} aria-describedby={describedBy("rule-scope", errors.targetIds)}>
          {RULE_SCOPES.map((k) => <option key={k} value={k}>{scopeLabel(t, k)}</option>)}
        </select>
      </FormField>
      {form.scope !== "todo" && (
        <fieldset className="max-h-44 space-y-1 overflow-y-auto rounded-xl border border-border p-3">
          <legend className="px-1 text-xs text-muted-foreground">{form.scope === "producto" ? t("productsPricing.editor.products") : t("productsPricing.editor.categories")}</legend>
          {targets.length === 0 && <p className="text-sm text-muted-foreground">{form.scope === "producto" ? t("productsPricing.editor.noProducts") : t("productsPricing.editor.noCategories")}</p>}
          {targets.map((tg) => (
            <label key={tg.id} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.targetIds.includes(tg.id)} onChange={() => set("targetIds", toggle(form.targetIds, tg.id))} />
              {tg.label}
            </label>
          ))}
        </fieldset>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <FormField id="rule-min" label={t("productsPricing.editor.minQty")} error={errors.minQuantity} hint={t("productsPricing.editor.minQtyHint")}>
          <Input id="rule-min" type="number" min={1} step={1} value={form.minQuantity} onChange={(e) => set("minQuantity", Math.trunc(Number(e.target.value)))} aria-invalid={!!errors.minQuantity} />
        </FormField>
        <fieldset>
          <legend className="mb-1.5 text-sm font-medium text-foreground">{t("productsPricing.editor.channels")}</legend>
          <div className="flex flex-wrap gap-3">
            {PRICING_CHANNELS.map((c) => (
              <label key={c} className="flex items-center gap-1.5 text-sm">
                <input type="checkbox" checked={form.channels.includes(c)} onChange={() => set("channels", toggle<PricingChannel>(form.channels, c))} />
                {channelLabel(t, c)}
              </label>
            ))}
          </div>
          {errors.channels && <p className="mt-1 text-xs text-destructive">{errors.channels}</p>}
        </fieldset>
      </div>

      <fieldset>
        <legend className="mb-1.5 text-sm font-medium text-foreground">{t("productsPricing.editor.weekdays")} <span className="font-normal text-muted-foreground">{t("productsPricing.editor.weekdaysHint")}</span></legend>
        <div className="flex flex-wrap gap-3">
          {[1, 2, 3, 4, 5, 6, 7].map((d) => (
            <label key={d} className="flex items-center gap-1.5 text-sm">
              <input type="checkbox" checked={form.weekdays.includes(d)} onChange={() => set("weekdays", toggle(form.weekdays, d))} />
              {weekdayLabel(t, d)}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="grid gap-3 sm:grid-cols-2">
        <FormField id="rule-service-from" label={t("productsPricing.editor.serviceFrom")} error={errors.serviceFrom}>
          <Input id="rule-service-from" type="date" value={form.serviceFrom ?? ""} onChange={(e) => set("serviceFrom", e.target.value || null)} />
        </FormField>
        <FormField id="rule-service-to" label={t("productsPricing.editor.serviceTo")} error={errors.serviceTo}>
          <Input id="rule-service-to" type="date" value={form.serviceTo ?? ""} onChange={(e) => set("serviceTo", e.target.value || null)} />
        </FormField>
        <FormField id="rule-valid-from" label={t("productsPricing.editor.validFrom")} error={errors.validFrom} hint={t("productsPricing.editor.validFromHint")}>
          <Input id="rule-valid-from" type="date" value={form.validFrom ?? ""} onChange={(e) => set("validFrom", e.target.value || null)} />
        </FormField>
        <FormField id="rule-valid-to" label={t("productsPricing.editor.validTo")} error={errors.validTo}>
          <Input id="rule-valid-to" type="date" value={form.validTo ?? ""} onChange={(e) => set("validTo", e.target.value || null)} />
        </FormField>
      </div>

      <div className="space-y-2 rounded-xl border border-border p-3">
        <label className="flex items-center justify-between gap-3 text-sm">
          <span>
            <span className="font-medium text-foreground">{t("productsPricing.editor.combinable")}</span>
            <span className="block text-xs text-muted-foreground">{t("productsPricing.editor.combinableHint")}</span>
          </span>
          <Switch checked={form.combinable} onCheckedChange={(v) => set("combinable", v)} aria-label={t("productsPricing.editor.combinable")} />
        </label>
        <label className="flex items-center justify-between gap-3 text-sm">
          <span className="font-medium text-foreground">{t("productsPricing.editor.active")}</span>
          <Switch checked={form.active} onCheckedChange={(v) => set("active", v)} aria-label={t("productsPricing.editor.active")} />
        </label>
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>{t("productsPricing.editor.cancel")}</Button>
        <Button type="submit" disabled={create.isPending || update.isPending}>{rule ? t("productsPricing.editor.save") : t("productsPricing.editor.create")}</Button>
      </DialogFooter>
    </form>
  );
}

// ─── Simulación ──────────────────────────────────────────────────────────────

function Simulator({ opts }: { opts: Options | undefined }) {
  const { t, format } = useI18n();
  const money = (n: number) => format.currency(n || 0);
  const products = opts?.products ?? [];
  const [productId, setProductId] = useState<number | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [channel, setChannel] = useState<PricingChannel>("web");
  const [serviceDate, setServiceDate] = useState("");
  const pid = productId ?? products[0]?.id ?? null;
  const sim = trpc.pricingRules.simulate.useQuery(
    { productId: pid ?? 0, quantity: Math.max(1, quantity || 1), channel, serviceDate: serviceDate || null },
    { enabled: pid != null, retry: false },
  );
  const r = sim.data;
  return (
    <section className="space-y-4 rounded-2xl border border-border bg-card p-4" aria-labelledby="sim-title">
      <div className="flex items-center gap-2">
        <Calculator className="h-5 w-5 text-primary" aria-hidden="true" />
        <h2 id="sim-title" className="font-semibold text-foreground">{t("productsPricing.sim.title")}</h2>
      </div>
      {products.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("productsPricing.sim.noProducts")}</p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-4">
            <FormField id="sim-product" label={t("productsPricing.sim.product")}>
              <select id="sim-product" className={selectClass} value={pid ?? ""} onChange={(e) => setProductId(Number(e.target.value))}>
                {products.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
              </select>
            </FormField>
            <FormField id="sim-qty" label={t("productsPricing.sim.quantity")}>
              <Input id="sim-qty" type="number" min={1} value={quantity} onChange={(e) => setQuantity(Math.trunc(Number(e.target.value)))} />
            </FormField>
            <FormField id="sim-channel" label={t("productsPricing.sim.channel")}>
              <select id="sim-channel" className={selectClass} value={channel} onChange={(e) => setChannel(e.target.value as PricingChannel)}>
                {PRICING_CHANNELS.map((c) => <option key={c} value={c}>{channelLabel(t, c)}</option>)}
              </select>
            </FormField>
            <FormField id="sim-date" label={t("productsPricing.sim.date")}>
              <Input id="sim-date" type="date" value={serviceDate} onChange={(e) => setServiceDate(e.target.value)} />
            </FormField>
          </div>
          {sim.isError ? (
            <PanelError error={sim.error} onRetry={() => sim.refetch()} title={t("productsPricing.sim.error")} />
          ) : r ? (
            <div className="space-y-3" aria-live="polite">
              <dl className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-xl bg-muted/40 px-3 py-2">
                  <dt className="text-xs text-muted-foreground">{t("productsPricing.sim.catalogPrice")}</dt>
                  <dd className="tabular-nums text-foreground">{money(r.baseUnitPrice)} × {r.quantity} = {money(r.baseTotal)}</dd>
                </div>
                <div className="rounded-xl bg-muted/40 px-3 py-2">
                  <dt className="text-xs text-muted-foreground">{t("productsPricing.sim.rulesPrice")}</dt>
                  <dd className="font-semibold tabular-nums text-foreground">{money(r.unitPrice)} × {r.quantity} = {money(r.total)}</dd>
                </div>
                <div className="rounded-xl bg-muted/40 px-3 py-2">
                  <dt className="text-xs text-muted-foreground">{r.savings >= 0 ? t("productsPricing.sim.savings") : t("productsPricing.sim.surcharge")}</dt>
                  <dd className={cn("font-semibold tabular-nums", r.savings > 0 ? "text-success" : "text-foreground")}>{money(Math.abs(r.savings))}</dd>
                </div>
              </dl>
              <p className="text-sm text-foreground">{r.applied.length ? t("productsPricing.sim.applied", { names: r.applied.map((a) => a.name).join(" + ") }) : t("productsPricing.sim.none")}</p>
              {r.checks.length > 0 && (
                <ul className="space-y-1 text-xs">
                  {r.checks.map((c) => (
                    <li key={c.id} className={cn(c.applies ? "text-foreground" : "text-muted-foreground")}>
                      <span className="font-medium">{c.name}</span>: {c.reason}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <PanelLoading label={t("productsPricing.sim.calculating")} />
          )}
        </>
      )}
    </section>
  );
}

// ─── Pantalla ────────────────────────────────────────────────────────────────

export default function PricingRules() {
  const { t, format } = useI18n();
  const { user } = useAuth();
  const sub = usePanelSubscription();
  const canEdit = (user as { role?: string } | null)?.role === "admin" && sub.canWrite(CAP);
  const utils = trpc.useUtils();
  const list = trpc.pricingRules.list.useQuery(undefined, { retry: false });
  const options = trpc.pricingRules.options.useQuery(undefined, { retry: false });
  const rules = list.data ?? [];
  const [editing, setEditing] = useState<PricingRule | null | undefined>(undefined);
  const [removing, setRemoving] = useState<PricingRule | null>(null);
  const reorder = trpc.pricingRules.reorder.useMutation({ onSuccess: () => utils.pricingRules.invalidate(), onError: (e) => toastError(e) });
  const setActive = trpc.pricingRules.setActive.useMutation({ onSuccess: () => utils.pricingRules.invalidate(), onError: (e) => toastError(e) });
  const remove = trpc.pricingRules.remove.useMutation({
    onSuccess: () => {
      toast.success(t("productsPricing.toast.removed"));
      utils.pricingRules.invalidate();
      setRemoving(null);
    },
    onError: (e) => toastError(e),
  });
  const move = (i: number, d: -1 | 1) => {
    const ids = rules.map((r) => r.id);
    [ids[i], ids[i + d]] = [ids[i + d], ids[i]];
    reorder.mutate({ ids });
  };
  const activeCount = useMemo(() => rules.filter((r) => r.active).length, [rules]);

  return (
    <AdminLayout>
      <div className="space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-foreground">{t("productsPricing.title")}</h1>
            <p className="max-w-3xl text-sm text-muted-foreground">
              {t("productsPricing.intro")} {t("productsPricing.orderNote")} {t("productsPricing.introEnd")}
            </p>
          </div>
          {canEdit && (
            <Button onClick={() => setEditing(null)}>
              <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" /> {t("productsPricing.newRule")}
            </Button>
          )}
        </div>

        {list.isLoading ? (
          <PanelLoading label={t("productsPricing.loading")} />
        ) : list.isError ? (
          <PanelError error={list.error} onRetry={() => list.refetch()} title={t("productsPricing.loadError")} />
        ) : rules.length === 0 ? (
          <PanelEmpty icon={<Percent className="h-6 w-6" />} title={t("productsPricing.empty.title")} description={t("productsPricing.empty.description")} />
        ) : (
          <section aria-labelledby="rules-title" className="space-y-2">
            <h2 id="rules-title" className="text-sm text-muted-foreground">{t("productsPricing.count", { n: rules.length, active: activeCount })}</h2>
            <ol className="divide-y divide-border rounded-2xl border border-border bg-card">
              {rules.map((r, i) => (
                <li key={r.id} className={cn("flex flex-wrap items-center gap-3 px-4 py-3", !r.active && "opacity-60")}>
                  <span className="w-6 text-center text-sm font-semibold tabular-nums text-muted-foreground" aria-label={t("productsPricing.priority", { n: i + 1 })}>{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-foreground">
                      {r.name} <span className={cn("ml-1 text-sm", r.kind === "descuento" ? "text-success" : "text-foreground")}>{describeAdjustmentI18n(t, format, r)}</span>
                    </p>
                    <p className="text-xs text-muted-foreground">{ruleSummary(r, options.data, t, format).join(" · ")}</p>
                  </div>
                  {canEdit && (
                    <div className="flex items-center gap-1">
                      <Switch checked={r.active} disabled={setActive.isPending} onCheckedChange={(v) => setActive.mutate({ id: r.id, active: v })} aria-label={r.active ? t("productsPricing.action.deactivate", { name: r.name }) : t("productsPricing.action.activate", { name: r.name })} />
                      <Button size="sm" variant="ghost" disabled={i === 0 || reorder.isPending} onClick={() => move(i, -1)} aria-label={t("productsPricing.action.up", { name: r.name })}><ArrowUp className="h-4 w-4" aria-hidden="true" /></Button>
                      <Button size="sm" variant="ghost" disabled={i === rules.length - 1 || reorder.isPending} onClick={() => move(i, 1)} aria-label={t("productsPricing.action.down", { name: r.name })}><ArrowDown className="h-4 w-4" aria-hidden="true" /></Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditing(r)} aria-label={t("productsPricing.action.edit", { name: r.name })}><Pencil className="h-4 w-4" aria-hidden="true" /></Button>
                      <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => setRemoving(r)} aria-label={t("productsPricing.action.remove", { name: r.name })}><Trash2 className="h-4 w-4" aria-hidden="true" /></Button>
                    </div>
                  )}
                </li>
              ))}
            </ol>
          </section>
        )}

        <Simulator opts={options.data} />
      </div>

      <Dialog open={editing !== undefined} onOpenChange={(o) => !o && setEditing(undefined)}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? t("productsPricing.dialog.editTitle") : t("productsPricing.dialog.newTitle")}</DialogTitle>
            <DialogDescription>{t("productsPricing.dialog.description")}</DialogDescription>
          </DialogHeader>
          {editing !== undefined && <RuleEditor rule={editing} opts={options.data} onClose={() => setEditing(undefined)} />}
        </DialogContent>
      </Dialog>

      <AlertDialog open={removing !== null} onOpenChange={(o) => !o && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("productsPricing.delete.title", { name: removing?.name })}</AlertDialogTitle>
            <AlertDialogDescription>{t("productsPricing.delete.text")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("productsPricing.delete.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); if (removing) remove.mutate({ id: removing.id }); }} disabled={remove.isPending}>{t("productsPricing.delete.confirm")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AdminLayout>
  );
}
