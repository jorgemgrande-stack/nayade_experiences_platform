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
import {
  ADJUSTMENT_KINDS, ADJUSTMENT_LABELS, CHANNEL_LABELS, PRICING_CHANNELS, PRICING_ORDER_NOTE, RULE_NAME_MAX, RULE_SCOPES, SCOPE_LABELS, VALUE_TYPES,
  VALUE_TYPE_LABELS, WEEKDAY_LABELS, describeAdjustment, emptyRuleForm, normalizeRuleForm, validateRuleForm,
  type PricingChannel, type PricingRule, type RuleForm, type RuleFormErrors,
} from "@shared/pricingRules";

const CAP = "pricing-rules";
const eur = new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" });
const money = (n: number) => eur.format(n || 0);
const fmtDate = (d: string) => d.split("-").reverse().join("/");

type Options = { products: { id: number; title: string; basePrice: number | null; categoryId: number }[]; categories: { id: number; name: string }[] };

function toggle<T>(list: T[], v: T): T[] {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
}

function ruleSummary(r: PricingRule, opts: Options | undefined): string[] {
  const out: string[] = [];
  if (r.scope === "todo") out.push("Todo el catálogo");
  else {
    const names = r.scope === "producto"
      ? r.targetIds.map((id) => opts?.products.find((p) => p.id === id)?.title ?? `#${id}`)
      : r.targetIds.map((id) => opts?.categories.find((c) => c.id === id)?.name ?? `#${id}`);
    out.push(`${r.scope === "producto" ? "Productos" : "Categorías"}: ${names.slice(0, 3).join(", ")}${names.length > 3 ? ` y ${names.length - 3} más` : ""}`);
  }
  if (r.minQuantity > 1) out.push(`Desde ${r.minQuantity} unidades`);
  if (r.weekdays.length) out.push(r.weekdays.map((d) => WEEKDAY_LABELS[d].slice(0, 3)).join(", "));
  if (r.serviceFrom || r.serviceTo) out.push(`Servicio ${r.serviceFrom ? `desde ${fmtDate(r.serviceFrom)}` : ""}${r.serviceFrom && r.serviceTo ? " " : ""}${r.serviceTo ? `hasta ${fmtDate(r.serviceTo)}` : ""}`);
  if (r.validFrom || r.validTo) out.push(`Vigente ${r.validFrom ? `desde ${fmtDate(r.validFrom)}` : ""}${r.validFrom && r.validTo ? " " : ""}${r.validTo ? `hasta ${fmtDate(r.validTo)}` : ""}`);
  out.push(r.channels.map((c) => CHANNEL_LABELS[c]).join(", "));
  if (r.combinable) out.push("Acumulable");
  return out;
}

// ─── Editor ──────────────────────────────────────────────────────────────────

function RuleEditor({ rule, opts, onClose }: { rule: PricingRule | null; opts: Options | undefined; onClose: () => void }) {
  const utils = trpc.useUtils();
  const [form, setForm] = useState<RuleForm>(() => (rule ? { ...rule } : emptyRuleForm()));
  const [valueText, setValueText] = useState(String(rule?.value ?? emptyRuleForm().value).replace(".", ","));
  const [errors, setErrors] = useState<RuleFormErrors>({});
  const done = (msg: string) => {
    toast.success(msg);
    utils.pricingRules.invalidate();
    onClose();
  };
  const create = trpc.pricingRules.create.useMutation({ onSuccess: () => done("Regla creada"), onError: (e) => toastError(e) });
  const update = trpc.pricingRules.update.useMutation({ onSuccess: () => done("Regla guardada"), onError: (e) => toastError(e) });
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
      <FormField id="rule-name" label="Nombre" error={errors.name} required>
        <Input id="rule-name" value={form.name} maxLength={RULE_NAME_MAX} onChange={(e) => set("name", e.target.value)} aria-invalid={!!errors.name} aria-required aria-describedby={describedBy("rule-name", errors.name)} placeholder="Por ejemplo: Grupos de 10 o más" autoFocus />
      </FormField>

      <div className="grid gap-3 sm:grid-cols-3">
        <FormField id="rule-kind" label="Tipo">
          <select id="rule-kind" className={selectClass} value={form.kind} onChange={(e) => set("kind", e.target.value as RuleForm["kind"])}>
            {ADJUSTMENT_KINDS.map((k) => <option key={k} value={k}>{ADJUSTMENT_LABELS[k]}</option>)}
          </select>
        </FormField>
        <FormField id="rule-value-type" label="Cálculo">
          <select id="rule-value-type" className={selectClass} value={form.valueType} onChange={(e) => set("valueType", e.target.value as RuleForm["valueType"])}>
            {VALUE_TYPES.map((k) => <option key={k} value={k}>{VALUE_TYPE_LABELS[k]}</option>)}
          </select>
        </FormField>
        <FormField id="rule-value" label={form.valueType === "porcentaje" ? "Porcentaje (%)" : "Importe (€, IVA incluido)"} error={errors.value} required>
          <Input id="rule-value" inputMode="decimal" value={valueText} onChange={(e) => setValueText(e.target.value)} aria-invalid={!!errors.value} aria-required aria-describedby={describedBy("rule-value", errors.value)} />
        </FormField>
      </div>

      <FormField id="rule-scope" label="Se aplica a" error={errors.targetIds}>
        <select id="rule-scope" className={selectClass} value={form.scope} onChange={(e) => setForm((f) => ({ ...f, scope: e.target.value as RuleForm["scope"], targetIds: [] }))} aria-describedby={describedBy("rule-scope", errors.targetIds)}>
          {RULE_SCOPES.map((k) => <option key={k} value={k}>{SCOPE_LABELS[k]}</option>)}
        </select>
      </FormField>
      {form.scope !== "todo" && (
        <fieldset className="max-h-44 space-y-1 overflow-y-auto rounded-xl border border-border p-3">
          <legend className="px-1 text-xs text-muted-foreground">{form.scope === "producto" ? "Productos" : "Categorías"}</legend>
          {targets.length === 0 && <p className="text-sm text-muted-foreground">No hay {form.scope === "producto" ? "productos" : "categorías"} en el catálogo.</p>}
          {targets.map((t) => (
            <label key={t.id} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.targetIds.includes(t.id)} onChange={() => set("targetIds", toggle(form.targetIds, t.id))} />
              {t.label}
            </label>
          ))}
        </fieldset>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <FormField id="rule-min" label="Cantidad mínima por línea" error={errors.minQuantity} hint="Unidades o personas de la misma línea.">
          <Input id="rule-min" type="number" min={1} step={1} value={form.minQuantity} onChange={(e) => set("minQuantity", Math.trunc(Number(e.target.value)))} aria-invalid={!!errors.minQuantity} />
        </FormField>
        <fieldset>
          <legend className="mb-1.5 text-sm font-medium text-foreground">Canales</legend>
          <div className="flex flex-wrap gap-3">
            {PRICING_CHANNELS.map((c) => (
              <label key={c} className="flex items-center gap-1.5 text-sm">
                <input type="checkbox" checked={form.channels.includes(c)} onChange={() => set("channels", toggle<PricingChannel>(form.channels, c))} />
                {CHANNEL_LABELS[c]}
              </label>
            ))}
          </div>
          {errors.channels && <p className="mt-1 text-xs text-destructive">{errors.channels}</p>}
        </fieldset>
      </div>

      <fieldset>
        <legend className="mb-1.5 text-sm font-medium text-foreground">Días de la semana del servicio <span className="font-normal text-muted-foreground">(ninguno marcado = todos)</span></legend>
        <div className="flex flex-wrap gap-3">
          {[1, 2, 3, 4, 5, 6, 7].map((d) => (
            <label key={d} className="flex items-center gap-1.5 text-sm">
              <input type="checkbox" checked={form.weekdays.includes(d)} onChange={() => set("weekdays", toggle(form.weekdays, d))} />
              {WEEKDAY_LABELS[d]}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="grid gap-3 sm:grid-cols-2">
        <FormField id="rule-service-from" label="Servicio desde" error={errors.serviceFrom}>
          <Input id="rule-service-from" type="date" value={form.serviceFrom ?? ""} onChange={(e) => set("serviceFrom", e.target.value || null)} />
        </FormField>
        <FormField id="rule-service-to" label="Servicio hasta" error={errors.serviceTo}>
          <Input id="rule-service-to" type="date" value={form.serviceTo ?? ""} onChange={(e) => set("serviceTo", e.target.value || null)} />
        </FormField>
        <FormField id="rule-valid-from" label="Vigente desde" error={errors.validFrom} hint="Fecha de la compra, la venta o el presupuesto.">
          <Input id="rule-valid-from" type="date" value={form.validFrom ?? ""} onChange={(e) => set("validFrom", e.target.value || null)} />
        </FormField>
        <FormField id="rule-valid-to" label="Vigente hasta" error={errors.validTo}>
          <Input id="rule-valid-to" type="date" value={form.validTo ?? ""} onChange={(e) => set("validTo", e.target.value || null)} />
        </FormField>
      </div>

      <div className="space-y-2 rounded-xl border border-border p-3">
        <label className="flex items-center justify-between gap-3 text-sm">
          <span>
            <span className="font-medium text-foreground">Acumulable</span>
            <span className="block text-xs text-muted-foreground">Se suma a otras reglas acumulables que también se cumplan. Si no, solo se aplica la de mayor prioridad.</span>
          </span>
          <Switch checked={form.combinable} onCheckedChange={(v) => set("combinable", v)} aria-label="Acumulable" />
        </label>
        <label className="flex items-center justify-between gap-3 text-sm">
          <span className="font-medium text-foreground">Activa</span>
          <Switch checked={form.active} onCheckedChange={(v) => set("active", v)} aria-label="Activa" />
        </label>
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
        <Button type="submit" disabled={create.isPending || update.isPending}>{rule ? "Guardar" : "Crear regla"}</Button>
      </DialogFooter>
    </form>
  );
}

// ─── Simulación ──────────────────────────────────────────────────────────────

function Simulator({ opts }: { opts: Options | undefined }) {
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
        <h2 id="sim-title" className="font-semibold text-foreground">Probar las reglas</h2>
      </div>
      {products.length === 0 ? (
        <p className="text-sm text-muted-foreground">Crea un producto en el catálogo para simular su precio.</p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-4">
            <FormField id="sim-product" label="Producto">
              <select id="sim-product" className={selectClass} value={pid ?? ""} onChange={(e) => setProductId(Number(e.target.value))}>
                {products.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
              </select>
            </FormField>
            <FormField id="sim-qty" label="Cantidad">
              <Input id="sim-qty" type="number" min={1} value={quantity} onChange={(e) => setQuantity(Math.trunc(Number(e.target.value)))} />
            </FormField>
            <FormField id="sim-channel" label="Canal">
              <select id="sim-channel" className={selectClass} value={channel} onChange={(e) => setChannel(e.target.value as PricingChannel)}>
                {PRICING_CHANNELS.map((c) => <option key={c} value={c}>{CHANNEL_LABELS[c]}</option>)}
              </select>
            </FormField>
            <FormField id="sim-date" label="Fecha del servicio">
              <Input id="sim-date" type="date" value={serviceDate} onChange={(e) => setServiceDate(e.target.value)} />
            </FormField>
          </div>
          {sim.isError ? (
            <PanelError error={sim.error} onRetry={() => sim.refetch()} title="No se ha podido simular el precio" />
          ) : r ? (
            <div className="space-y-3" aria-live="polite">
              <dl className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-xl bg-muted/40 px-3 py-2">
                  <dt className="text-xs text-muted-foreground">Precio de catálogo</dt>
                  <dd className="tabular-nums text-foreground">{money(r.baseUnitPrice)} × {r.quantity} = {money(r.baseTotal)}</dd>
                </div>
                <div className="rounded-xl bg-muted/40 px-3 py-2">
                  <dt className="text-xs text-muted-foreground">Precio con reglas</dt>
                  <dd className="font-semibold tabular-nums text-foreground">{money(r.unitPrice)} × {r.quantity} = {money(r.total)}</dd>
                </div>
                <div className="rounded-xl bg-muted/40 px-3 py-2">
                  <dt className="text-xs text-muted-foreground">{r.savings >= 0 ? "Ahorro" : "Recargo"}</dt>
                  <dd className={cn("font-semibold tabular-nums", r.savings > 0 ? "text-success" : "text-foreground")}>{money(Math.abs(r.savings))}</dd>
                </div>
              </dl>
              <p className="text-sm text-foreground">{r.applied.length ? `Se aplica: ${r.applied.map((a) => a.name).join(" + ")}.` : "No se aplica ninguna regla: precio de catálogo."}</p>
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
            <PanelLoading label="Calculando…" />
          )}
        </>
      )}
    </section>
  );
}

// ─── Pantalla ────────────────────────────────────────────────────────────────

export default function PricingRules() {
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
      toast.success("Regla eliminada");
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
            <h1 className="text-2xl font-bold text-foreground">Reglas de precios</h1>
            <p className="max-w-3xl text-sm text-muted-foreground">
              Descuentos y recargos automáticos en la tienda online, el TPV y los presupuestos. Se aplica la regla de mayor prioridad que se cumpla; las
              acumulables se suman entre sí. {PRICING_ORDER_NOTE} Lo ya vendido o facturado no cambia.
            </p>
          </div>
          {canEdit && (
            <Button onClick={() => setEditing(null)}>
              <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" /> Nueva regla
            </Button>
          )}
        </div>

        {list.isLoading ? (
          <PanelLoading label="Cargando las reglas…" />
        ) : list.isError ? (
          <PanelError error={list.error} onRetry={() => list.refetch()} title="No se han podido cargar las reglas" />
        ) : rules.length === 0 ? (
          <PanelEmpty icon={<Percent className="h-6 w-6" />} title="Todavía no hay reglas de precios" description="Sin reglas, los precios son los del catálogo. Crea una para ofrecer, por ejemplo, un descuento a grupos o un suplemento en fin de semana." />
        ) : (
          <section aria-labelledby="rules-title" className="space-y-2">
            <h2 id="rules-title" className="text-sm text-muted-foreground">{rules.length} {rules.length === 1 ? "regla" : "reglas"} · {activeCount} {activeCount === 1 ? "activa" : "activas"} · en orden de prioridad</h2>
            <ol className="divide-y divide-border rounded-2xl border border-border bg-card">
              {rules.map((r, i) => (
                <li key={r.id} className={cn("flex flex-wrap items-center gap-3 px-4 py-3", !r.active && "opacity-60")}>
                  <span className="w-6 text-center text-sm font-semibold tabular-nums text-muted-foreground" aria-label={`Prioridad ${i + 1}`}>{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-foreground">
                      {r.name} <span className={cn("ml-1 text-sm", r.kind === "descuento" ? "text-success" : "text-foreground")}>{describeAdjustment(r)}</span>
                    </p>
                    <p className="text-xs text-muted-foreground">{ruleSummary(r, options.data).join(" · ")}</p>
                  </div>
                  {canEdit && (
                    <div className="flex items-center gap-1">
                      <Switch checked={r.active} disabled={setActive.isPending} onCheckedChange={(v) => setActive.mutate({ id: r.id, active: v })} aria-label={`${r.active ? "Desactivar" : "Activar"} la regla ${r.name}`} />
                      <Button size="sm" variant="ghost" disabled={i === 0 || reorder.isPending} onClick={() => move(i, -1)} aria-label={`Subir la prioridad de ${r.name}`}><ArrowUp className="h-4 w-4" aria-hidden="true" /></Button>
                      <Button size="sm" variant="ghost" disabled={i === rules.length - 1 || reorder.isPending} onClick={() => move(i, 1)} aria-label={`Bajar la prioridad de ${r.name}`}><ArrowDown className="h-4 w-4" aria-hidden="true" /></Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditing(r)} aria-label={`Editar la regla ${r.name}`}><Pencil className="h-4 w-4" aria-hidden="true" /></Button>
                      <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => setRemoving(r)} aria-label={`Eliminar la regla ${r.name}`}><Trash2 className="h-4 w-4" aria-hidden="true" /></Button>
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
            <DialogTitle>{editing ? "Editar regla" : "Nueva regla de precio"}</DialogTitle>
            <DialogDescription>Los importes son con IVA incluido y por unidad o persona. El precio resultante se redondea a céntimos.</DialogDescription>
          </DialogHeader>
          {editing !== undefined && <RuleEditor rule={editing} opts={options.data} onClose={() => setEditing(undefined)} />}
        </DialogContent>
      </Dialog>

      <AlertDialog open={removing !== null} onOpenChange={(o) => !o && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar la regla «{removing?.name}»?</AlertDialogTitle>
            <AlertDialogDescription>Dejará de aplicarse en las próximas compras, ventas y presupuestos. Lo ya vendido o presupuestado conserva su precio.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); if (removing) remove.mutate({ id: removing.id }); }} disabled={remove.isPending}>Eliminar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AdminLayout>
  );
}
