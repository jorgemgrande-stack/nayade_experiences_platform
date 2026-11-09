/**
 * Elephant Connect · Automatizaciones avanzadas (/admin/automatizaciones): reglas de la empresa con disparador,
 * condiciones y pasos con retardo; plantillas listas para activar (se crean apagadas), historial de ejecuciones, avisos
 * al equipo y modo «probar» (simula sin enviar ni crear nada). La autorización real (licencia `automations-advanced`,
 * administración y solo lectura) la aplica el servidor.
 */
import { useState } from "react";
import { FlaskConical, Pencil, Plus, Trash2, Workflow } from "lucide-react";
import { toast } from "sonner";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PanelEmpty, PanelError, PanelLoading } from "@/components/admin/PanelStates";
import { toastError } from "@/lib/errorMessage";
import {
  ACTION_KINDS,
  ACTION_LABELS,
  AUTOMATION_LIMITS,
  AUTOMATION_TRIGGERS,
  AUTOMATION_TRIGGER_KEYS,
  CONDITION_OP_LABELS,
  EMAIL_PURPOSES,
  EMAIL_PURPOSE_LABELS,
  ENTITY_LABELS,
  OPS_FOR,
  RUN_REASON_LABELS,
  RUN_STATUS_LABELS,
  TEMPLATE_VARIABLES,
  delayText,
  opNeedsValue,
  type ActionKind,
  type AutomationAction,
  type AutomationCondition,
  type AutomationRuleInput,
  type AutomationStep,
  type AutomationTrigger,
  type ConditionOp,
  type FieldDef,
  type RunStatus,
  type TriggerDef,
} from "@shared/automations";

const selectClass = "h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const sectionClass = "space-y-4 rounded-xl border border-border bg-card p-4";
const NONE = "—";
const when = (v: string | number | null | undefined) => (v == null ? NONE : new Date(v).toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" }));
const triggerOf = (t: AutomationTrigger) => AUTOMATION_TRIGGERS[t] as TriggerDef;
const STATUS_VARIANT: Record<RunStatus, "default" | "secondary" | "destructive" | "outline"> = { done: "default", running: "secondary", skipped: "outline", failed: "destructive" };

type Options = { assignees: Array<{ id: number; name: string }>; tags: Array<{ id: number; name: string }>; stages: Array<{ id: number; name: string }> | null };

const UNITS = [
  { key: "min", label: "minutos", mult: 1 },
  { key: "h", label: "horas", mult: 60 },
  { key: "d", label: "días", mult: 1440 },
] as const;
const unitFor = (m: number) => (m > 0 && m % 1440 === 0 ? UNITS[2] : m > 0 && m % 60 === 0 ? UNITS[1] : m === 0 ? UNITS[2] : UNITS[0]);

function defaultAction(kind: ActionKind, o: Options): AutomationAction {
  switch (kind) {
    case "email": return { kind, purpose: "operational", subject: "", body: "" };
    case "task": return { kind, title: "", dueInDays: 1, priority: "media", assignedTo: null };
    case "notify": return { kind, title: "", body: "" };
    case "lead_stage": return { kind, stageId: o.stages?.[0]?.id ?? 0 };
    case "lead_tag": return { kind, tagId: o.tags[0]?.id ?? 0 };
  }
}

const emptyRule = (): AutomationRuleInput => ({ name: "", trigger: "lead_created", conditions: [], steps: [{ delayMinutes: 0, action: { kind: "notify", title: "", body: "" } }], dailyCap: AUTOMATION_LIMITS.dailyCapDefault });

const stepSummary = (t: AutomationTrigger, s: AutomationStep) => `${s.delayMinutes === 0 ? "Al momento" : `${delayText(s.delayMinutes)} ${triggerOf(t).delayLabel}`}: ${ACTION_LABELS[s.action.kind].toLowerCase()}`;

// ─── Editor ───────────────────────────────────────────────────────────────────

function ConditionRow({ trigger, c, onChange, onRemove }: { trigger: AutomationTrigger; c: AutomationCondition; onChange: (c: AutomationCondition) => void; onRemove: () => void }) {
  const fields = triggerOf(trigger).fields as readonly FieldDef[];
  const f = fields.find((x) => x.key === c.field) ?? fields[0];
  const ops = OPS_FOR[f.type];
  return (
    <div className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]">
      <select aria-label="Campo" className={selectClass} value={f.key} onChange={(e) => { const nf = fields.find((x) => x.key === e.target.value)!; onChange({ field: nf.key, op: OPS_FOR[nf.type][0], value: nf.type === "choice" ? nf.options![0].value : "" }); }}>
        {fields.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
      </select>
      <select aria-label="Comparación" className={selectClass} value={ops.includes(c.op) ? c.op : ops[0]} onChange={(e) => onChange({ ...c, op: e.target.value as ConditionOp })}>
        {ops.map((o) => <option key={o} value={o}>{CONDITION_OP_LABELS[o]}</option>)}
      </select>
      {opNeedsValue(c.op) ? (
        f.type === "choice" ? (
          <select aria-label="Valor" className={selectClass} value={c.value} onChange={(e) => onChange({ ...c, value: e.target.value })}>
            {f.options!.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        ) : (
          <Input aria-label="Valor" inputMode={f.type === "number" ? "decimal" : undefined} value={c.value} maxLength={200} onChange={(e) => onChange({ ...c, value: e.target.value })} />
        )
      ) : <span />}
      <Button type="button" variant="ghost" size="icon" aria-label="Quitar condición" onClick={onRemove}><Trash2 className="h-4 w-4" /></Button>
    </div>
  );
}

function ActionFields({ a, onChange, o }: { a: AutomationAction; onChange: (a: AutomationAction) => void; o: Options }) {
  const label = "space-y-1.5 text-sm font-medium text-foreground";
  switch (a.kind) {
    case "email":
      return (
        <div className="space-y-3">
          <label className={label}>
            <span>Tipo de correo</span>
            <select className={selectClass} value={a.purpose} onChange={(e) => onChange({ ...a, purpose: e.target.value as typeof a.purpose })}>
              {EMAIL_PURPOSES.map((p) => <option key={p} value={p}>{EMAIL_PURPOSE_LABELS[p]}</option>)}
            </select>
          </label>
          <label className={label}><span>Asunto</span><Input value={a.subject} maxLength={AUTOMATION_LIMITS.subjectMax} onChange={(e) => onChange({ ...a, subject: e.target.value })} /></label>
          <label className={label}><span>Texto (una línea en blanco separa párrafos)</span><Textarea rows={4} value={a.body} maxLength={AUTOMATION_LIMITS.bodyMax} onChange={(e) => onChange({ ...a, body: e.target.value })} /></label>
          <p className="text-xs text-muted-foreground">Sale con la marca y el remitente de tu empresa, al correo del cliente de la oportunidad, el presupuesto, la reserva o la factura. Nunca a quien tiene las comunicaciones automáticas en pausa. Para boletines y promociones usa Campañas de correo.</p>
        </div>
      );
    case "task":
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className={`${label} sm:col-span-2`}><span>Título de la tarea</span><Input value={a.title} maxLength={AUTOMATION_LIMITS.titleMax} onChange={(e) => onChange({ ...a, title: e.target.value })} /></label>
          <label className={label}><span>Vence a los (días)</span><Input inputMode="numeric" value={String(a.dueInDays)} onChange={(e) => onChange({ ...a, dueInDays: Math.max(0, Math.min(60, Math.round(Number(e.target.value)) || 0)) })} /></label>
          <label className={label}>
            <span>Prioridad</span>
            <select className={selectClass} value={a.priority} onChange={(e) => onChange({ ...a, priority: e.target.value as typeof a.priority })}>
              <option value="baja">Baja</option><option value="media">Media</option><option value="alta">Alta</option>
            </select>
          </label>
          <label className={`${label} sm:col-span-2`}>
            <span>Responsable</span>
            <select className={selectClass} value={a.assignedTo ?? ""} onChange={(e) => onChange({ ...a, assignedTo: e.target.value ? Number(e.target.value) : null })}>
              <option value="">El de la oportunidad (si lo tiene)</option>
              {o.assignees.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </label>
        </div>
      );
    case "notify":
      return (
        <div className="space-y-3">
          <label className={label}><span>Título del aviso</span><Input value={a.title} maxLength={AUTOMATION_LIMITS.titleMax} onChange={(e) => onChange({ ...a, title: e.target.value })} /></label>
          <label className={label}><span>Detalle (opcional)</span><Input value={a.body} maxLength={500} onChange={(e) => onChange({ ...a, body: e.target.value })} /></label>
          <p className="text-xs text-muted-foreground">Aparece en la campana de avisos del panel durante 7 días.</p>
        </div>
      );
    case "lead_stage":
      return o.stages ? (
        <label className={label}>
          <span>Etapa del embudo</span>
          <select className={selectClass} value={a.stageId} onChange={(e) => onChange({ ...a, stageId: Number(e.target.value) })}>
            {o.stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
      ) : <p className="text-sm text-muted-foreground">Mover de etapa necesita el embudo de ventas avanzado.</p>;
    case "lead_tag":
      return o.tags.length ? (
        <label className={label}>
          <span>Etiqueta</span>
          <select className={selectClass} value={a.tagId} onChange={(e) => onChange({ ...a, tagId: Number(e.target.value) })}>
            {o.tags.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </label>
      ) : <p className="text-sm text-muted-foreground">Crea antes alguna etiqueta en el CRM.</p>;
  }
}

function StepEditor({ trigger, step, index, onChange, onRemove, o, canRemove }: { trigger: AutomationTrigger; step: AutomationStep; index: number; onChange: (s: AutomationStep) => void; onRemove: () => void; o: Options; canRemove: boolean }) {
  const t = triggerOf(trigger);
  const [unit, setUnit] = useState<(typeof UNITS)[number]>(unitFor(step.delayMinutes));
  const hasLead = t.entity === "lead" || t.entity === "quote";
  const kinds = ACTION_KINDS.filter((k) => hasLead || (k !== "lead_stage" && k !== "lead_tag"));
  return (
    <div className="space-y-3 rounded-lg border border-border bg-background p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-foreground">Paso {index + 1}</p>
        {canRemove && <Button type="button" variant="ghost" size="sm" onClick={onRemove}><Trash2 className="mr-1 h-4 w-4" />Quitar</Button>}
      </div>
      <div className="grid gap-2 sm:grid-cols-[8rem_10rem_1fr] sm:items-center">
        <Input aria-label="Retardo" inputMode="numeric" value={String(Math.round(step.delayMinutes / unit.mult))} onChange={(e) => onChange({ ...step, delayMinutes: Math.max(0, Math.min(AUTOMATION_LIMITS.delayMaxMinutes, (Math.round(Number(e.target.value)) || 0) * unit.mult)) })} />
        <select aria-label="Unidad" className={selectClass} value={unit.key} onChange={(e) => { const u = UNITS.find((x) => x.key === e.target.value)!; setUnit(u); onChange({ ...step, delayMinutes: Math.min(AUTOMATION_LIMITS.delayMaxMinutes, Math.round(step.delayMinutes / unit.mult) * u.mult) }); }}>
          {UNITS.map((u) => <option key={u.key} value={u.key}>{u.label}</option>)}
        </select>
        <span className="text-sm text-muted-foreground">{t.delayLabel} (0 = al momento)</span>
      </div>
      <label className="space-y-1.5 text-sm font-medium text-foreground">
        <span>Acción</span>
        <select className={selectClass} value={step.action.kind} onChange={(e) => onChange({ ...step, action: defaultAction(e.target.value as ActionKind, o) })}>
          {kinds.map((k) => <option key={k} value={k}>{ACTION_LABELS[k]}</option>)}
        </select>
      </label>
      <ActionFields a={step.action} o={o} onChange={(action) => onChange({ ...step, action })} />
    </div>
  );
}

type SimResult = { matched: number; truncated: boolean; lookbackDays: number; items: Array<{ entity: string; entityType: string; step: number | null; action: string | null; outcome: string; reason: string | null; detail: string | null; at: number | null }> };
const OUTCOME_LABELS: Record<string, string> = { ejecutaria: "Se ejecutaría", omitiria: "Se omitiría", esperando: "Esperando", terminada: "Secuencia terminada" };

function Simulation({ r }: { r: SimResult }) {
  return (
    <section className={sectionClass} aria-labelledby="auto-sim">
      <h3 id="auto-sim" className="text-base font-semibold text-foreground">Prueba: qué pasaría ahora</h3>
      <p className="text-sm text-muted-foreground">Con lo ocurrido en los últimos {r.lookbackDays} días, {r.matched} {r.matched === 1 ? "caso cumple" : "casos cumplen"} el disparador y las condiciones. No se ha enviado ni creado nada.</p>
      {r.items.length === 0 ? <p className="text-sm text-muted-foreground">Ningún caso ahora mismo.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-muted-foreground"><th className="py-1 pr-3">Caso</th><th className="py-1 pr-3">Paso</th><th className="py-1 pr-3">Resultado</th><th className="py-1">Detalle</th></tr></thead>
            <tbody>
              {r.items.map((i, n) => (
                <tr key={n} className="border-t border-border align-top">
                  <td className="py-1.5 pr-3 break-words">{ENTITY_LABELS[i.entityType as keyof typeof ENTITY_LABELS] ?? i.entityType} {i.entity}</td>
                  <td className="py-1.5 pr-3">{i.step == null ? NONE : `${i.step + 1}${i.action ? ` · ${ACTION_LABELS[i.action as ActionKind] ?? i.action}` : ""}`}</td>
                  <td className="py-1.5 pr-3"><Badge variant={i.outcome === "ejecutaria" ? "default" : "outline"}>{OUTCOME_LABELS[i.outcome] ?? i.outcome}</Badge></td>
                  <td className="py-1.5 break-words text-muted-foreground">{i.outcome === "esperando" ? `A partir del ${when(i.at)}` : i.reason ? RUN_REASON_LABELS[i.reason] ?? i.reason : i.detail ?? NONE}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {r.truncated && <p className="text-xs text-muted-foreground">Se muestran los primeros {r.items.length}.</p>}
    </section>
  );
}

function RuleEditor({ initial, ruleId, options, onDone }: { initial: AutomationRuleInput; ruleId: number | null; options: Options; onDone: () => void }) {
  const utils = trpc.useUtils();
  const [r, setR] = useState<AutomationRuleInput>(initial);
  const [sim, setSim] = useState<SimResult | null>(null);
  const done = (msg: string) => { toast.success(msg); utils.automations.invalidate(); onDone(); };
  const create = trpc.automations.create.useMutation({ onSuccess: () => done("Regla guardada (apagada: enciéndela cuando la hayas probado)"), onError: (e) => toastError(e) });
  const update = trpc.automations.update.useMutation({ onSuccess: () => done("Regla guardada"), onError: (e) => toastError(e) });
  const simulate = trpc.automations.simulate.useMutation({ onSuccess: (d) => setSim(d as SimResult), onError: (e) => toastError(e) });
  const t = triggerOf(r.trigger);
  const fields = t.fields as readonly FieldDef[];
  const setStep = (i: number, s: AutomationStep) => setR({ ...r, steps: r.steps.map((x, n) => (n === i ? s : x)) });
  return (
    <form className={sectionClass} onSubmit={(e) => { e.preventDefault(); ruleId ? update.mutate({ id: ruleId, rule: r }) : create.mutate(r); }}>
      <h2 className="text-base font-semibold text-foreground">{ruleId ? "Editar regla" : "Nueva regla"}</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1.5 text-sm font-medium text-foreground"><span>Nombre</span><Input value={r.name} maxLength={AUTOMATION_LIMITS.nameMax} onChange={(e) => setR({ ...r, name: e.target.value })} /></label>
        <label className="space-y-1.5 text-sm font-medium text-foreground">
          <span>Cuando…</span>
          <select className={selectClass} value={r.trigger} onChange={(e) => { const nt = e.target.value as AutomationTrigger; setSim(null); setR({ ...r, trigger: nt, conditions: [], steps: r.steps.map((s) => ((s.action.kind === "lead_stage" || s.action.kind === "lead_tag") && !["lead", "quote"].includes(triggerOf(nt).entity) ? { ...s, action: defaultAction("notify", options) } : s)) }); }}>
            {AUTOMATION_TRIGGER_KEYS.map((k) => <option key={k} value={k}>{triggerOf(k).label}</option>)}
          </select>
        </label>
      </div>
      <p className="text-sm text-muted-foreground">{t.description} Solo cuenta lo que ocurra después de encender la regla.</p>

      <div className="space-y-2">
        <p className="text-sm font-semibold text-foreground">Condiciones (todas deben cumplirse)</p>
        {r.conditions.length === 0 && <p className="text-sm text-muted-foreground">Sin condiciones: se aplica a todos los casos.</p>}
        {r.conditions.map((c, i) => (
          <ConditionRow key={i} trigger={r.trigger} c={c} onChange={(nc) => setR({ ...r, conditions: r.conditions.map((x, n) => (n === i ? nc : x)) })} onRemove={() => setR({ ...r, conditions: r.conditions.filter((_, n) => n !== i) })} />
        ))}
        {r.conditions.length < AUTOMATION_LIMITS.conditionsMax && (
          <Button type="button" variant="outline" size="sm" onClick={() => { const f = fields[0]; setR({ ...r, conditions: [...r.conditions, { field: f.key, op: OPS_FOR[f.type][0], value: f.type === "choice" ? f.options![0].value : "" }] }); }}>
            <Plus className="mr-1 h-4 w-4" />Añadir condición
          </Button>
        )}
      </div>

      <div className="space-y-2">
        <p className="text-sm font-semibold text-foreground">Pasos</p>
        {r.steps.map((s, i) => (
          <StepEditor key={`${r.trigger}-${i}`} trigger={r.trigger} step={s} index={i} o={options} canRemove={r.steps.length > 1} onChange={(ns) => setStep(i, ns)} onRemove={() => setR({ ...r, steps: r.steps.filter((_, n) => n !== i) })} />
        ))}
        {r.steps.length < AUTOMATION_LIMITS.stepsMax && (
          <Button type="button" variant="outline" size="sm" onClick={() => setR({ ...r, steps: [...r.steps, { delayMinutes: 1440, action: defaultAction("notify", options) }] })}>
            <Plus className="mr-1 h-4 w-4" />Añadir paso
          </Button>
        )}
        <p className="text-xs text-muted-foreground">Variables para los textos: {TEMPLATE_VARIABLES.map((v) => `{{${v.key}}}`).join(", ")}. Los pasos se ordenan por su momento; uno no empieza hasta que termina el anterior.</p>
      </div>

      <label className="block max-w-xs space-y-1.5 text-sm font-medium text-foreground">
        <span>Máximo de acciones al día de esta regla</span>
        <Input inputMode="numeric" value={String(r.dailyCap)} onChange={(e) => setR({ ...r, dailyCap: Math.max(1, Math.min(AUTOMATION_LIMITS.dailyCapMax, Math.round(Number(e.target.value)) || 1)) })} />
      </label>

      {ruleId && <p className="text-xs text-muted-foreground">Si la regla está encendida, al guardar los cambios empieza a contar desde ahora: lo ocurrido antes ya no la dispara.</p>}
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onDone}>Cancelar</Button>
        <Button type="button" variant="outline" disabled={simulate.isPending} onClick={() => simulate.mutate({ rule: r, ruleId })}><FlaskConical className="mr-1 h-4 w-4" />Probar</Button>
        <Button type="submit" disabled={create.isPending || update.isPending}>Guardar</Button>
      </div>
      {sim && <Simulation r={sim} />}
    </form>
  );
}

// ─── Reglas ───────────────────────────────────────────────────────────────────

type RuleRow = AutomationRuleInput & { id: number; enabled: boolean; enabledAt: number | null; templateKey: string | null };

function Rules({ rules, options }: { rules: RuleRow[]; options: Options }) {
  const utils = trpc.useUtils();
  const [editing, setEditing] = useState<{ id: number | null; rule: AutomationRuleInput } | null>(null);
  const toggle = trpc.automations.setEnabled.useMutation({ onSuccess: (r) => (toast.success(r.enabled ? "Regla encendida" : "Regla apagada"), utils.automations.invalidate()), onError: (e) => toastError(e) });
  const archive = trpc.automations.archive.useMutation({ onSuccess: () => (toast.success("Regla archivada"), utils.automations.invalidate()), onError: (e) => toastError(e) });
  if (editing) return <RuleEditor initial={editing.rule} ruleId={editing.id} options={options} onDone={() => setEditing(null)} />;
  return (
    <div className="space-y-4">
      <div className="flex justify-end"><Button onClick={() => setEditing({ id: null, rule: emptyRule() })}><Plus className="mr-1 h-4 w-4" />Nueva regla</Button></div>
      {rules.length === 0 ? (
        <PanelEmpty icon={<Workflow className="h-5 w-5" />} title="Aún no tienes reglas" description="Crea una desde cero o parte de una plantilla. Todas nacen apagadas: pruébalas y enciéndelas cuando estés conforme." />
      ) : (
        <ul className="space-y-3">
          {rules.map((r) => (
            <li key={r.id} className={sectionClass}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 space-y-1">
                  <p className="break-words font-semibold text-foreground">{r.name} <Badge variant={r.enabled ? "default" : "outline"}>{r.enabled ? "Encendida" : "Apagada"}</Badge></p>
                  <p className="text-sm text-muted-foreground">Cuando: {triggerOf(r.trigger).label}{r.conditions.length ? ` · ${r.conditions.length} ${r.conditions.length === 1 ? "condición" : "condiciones"}` : ""} · hasta {r.dailyCap} al día</p>
                  <ul className="list-inside list-disc text-sm text-foreground">
                    {r.steps.map((s, i) => <li key={i} className="break-words">{stepSummary(r.trigger, s)}</li>)}
                  </ul>
                  {r.enabled && r.enabledAt && <p className="text-xs text-muted-foreground">Activa desde el {when(r.enabledAt)}</p>}
                </div>
                <div className="flex items-center gap-2">
                  <label className="flex items-center gap-2 text-sm">
                    <Switch checked={r.enabled} disabled={toggle.isPending} onCheckedChange={(v) => toggle.mutate({ id: r.id, enabled: v })} aria-label={r.enabled ? "Apagar la regla" : "Encender la regla"} />
                  </label>
                  <Button variant="outline" size="sm" onClick={() => setEditing({ id: r.id, rule: { name: r.name, trigger: r.trigger, conditions: r.conditions, steps: r.steps, dailyCap: r.dailyCap } })}><Pencil className="mr-1 h-4 w-4" />Editar</Button>
                  <Button variant="ghost" size="sm" onClick={() => { if (window.confirm(`¿Archivar «${r.name}»? Se apaga y deja de aparecer; su historial se conserva.`)) archive.mutate({ id: r.id }); }}><Trash2 className="h-4 w-4" /><span className="sr-only">Archivar</span></Button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Templates({ templates }: { templates: Array<{ key: string; title: string; summary: string; trigger: AutomationTrigger; used: boolean; warning: string | null }> }) {
  const utils = trpc.useUtils();
  const create = trpc.automations.createFromTemplate.useMutation({ onSuccess: () => (toast.success("Regla creada apagada: revísala en «Reglas», pruébala y enciéndela"), utils.automations.invalidate()), onError: (e) => toastError(e) });
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {templates.map((t) => (
        <div key={t.key} className={sectionClass}>
          <p className="font-semibold text-foreground">{t.title}</p>
          <p className="text-sm text-muted-foreground">{t.summary}</p>
          <p className="text-xs text-muted-foreground">Cuando: {triggerOf(t.trigger).label}</p>
          {t.warning && <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-foreground">{t.warning}</p>}
          <div className="flex items-center justify-between gap-2">
            {t.used ? <Badge variant="secondary">Ya la tienes</Badge> : <span />}
            <Button size="sm" variant="outline" disabled={create.isPending} onClick={() => create.mutate({ key: t.key })}>Crear desde la plantilla</Button>
          </div>
        </div>
      ))}
    </div>
  );
}

function History({ rules }: { rules: RuleRow[] }) {
  const [ruleId, setRuleId] = useState<number | undefined>(undefined);
  const q = trpc.automations.history.useQuery({ ruleId, limit: 200 });
  return (
    <section className={sectionClass} aria-labelledby="auto-hist">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="auto-hist" className="text-base font-semibold text-foreground">Historial de ejecuciones</h2>
        <select aria-label="Regla" className={`${selectClass} max-w-xs`} value={ruleId ?? ""} onChange={(e) => setRuleId(e.target.value ? Number(e.target.value) : undefined)}>
          <option value="">Todas las reglas</option>
          {rules.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
      </div>
      {q.isLoading ? <PanelLoading /> : q.error ? <PanelError error={q.error} onRetry={() => q.refetch()} /> : !q.data!.length ? <p className="text-sm text-muted-foreground">Todavía no se ha ejecutado nada.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-muted-foreground"><th className="py-1 pr-3">Fecha</th><th className="py-1 pr-3">Regla</th><th className="py-1 pr-3">Caso</th><th className="py-1 pr-3">Paso</th><th className="py-1 pr-3">Estado</th><th className="py-1">Detalle</th></tr></thead>
            <tbody>
              {q.data!.map((h) => (
                <tr key={h.id} className="border-t border-border align-top">
                  <td className="py-1.5 pr-3 whitespace-nowrap">{when(h.lastAttemptAt ?? h.createdAt)}</td>
                  <td className="py-1.5 pr-3 break-words">{h.ruleName}</td>
                  <td className="py-1.5 pr-3">{ENTITY_LABELS[h.entityType]} #{h.entityId}</td>
                  <td className="py-1.5 pr-3">{h.stepIndex + 1} · {ACTION_LABELS[h.action as ActionKind] ?? h.action}</td>
                  <td className="py-1.5 pr-3"><Badge variant={STATUS_VARIANT[h.status]}>{RUN_STATUS_LABELS[h.status]}</Badge>{h.attempts > 1 && <span className="ml-1 text-xs text-muted-foreground">{h.attempts} intentos</span>}</td>
                  <td className="py-1.5 break-words text-muted-foreground">{h.reason ? RUN_REASON_LABELS[h.reason] ?? h.reason : h.detail ?? NONE}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Notices() {
  const q = trpc.automations.notices.useQuery();
  if (q.isLoading) return <PanelLoading />;
  if (q.error) return <PanelError error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data!.length) return <PanelEmpty icon={<Workflow className="h-5 w-5" />} title="Sin avisos en los últimos 7 días" description="Los avisos al equipo de tus reglas aparecen aquí y en la campana del panel." />;
  return (
    <ul className="space-y-2">
      {q.data!.map((n) => (
        <li key={n.id} className="rounded-lg border border-border bg-card p-3 text-sm">
          <p className="break-words font-medium text-foreground">{n.title}</p>
          {n.body && <p className="break-words text-muted-foreground">{n.body}</p>}
          <p className="text-xs text-muted-foreground">{when(n.createdAt)}</p>
        </li>
      ))}
    </ul>
  );
}

export default function Automatizaciones() {
  const [tab, setTab] = useState("reglas");
  const q = trpc.automations.overview.useQuery();
  return (
    <AdminLayout>
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="space-y-1">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Elephant Connect</p>
          <h1 className="text-2xl font-bold text-foreground">Automatizaciones</h1>
          <p className="max-w-3xl text-sm text-muted-foreground">Reglas propias para que las tareas repetitivas no se olviden: cuando pasa algo en tu negocio, el sistema envía el correo, crea la tarea, avisa al equipo o mueve la oportunidad, con los retardos que elijas.</p>
        </header>
        {q.isLoading ? <PanelLoading /> : q.error ? <PanelError error={q.error} onRetry={() => q.refetch()} /> : (
          <>
            {!q.data!.mail.ready && <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-foreground">Los pasos de correo no saldrán todavía: {q.data!.mail.message ?? "el correo de tu empresa no está disponible."}</p>}
            <p className="text-xs text-muted-foreground">Hoy: {q.data!.today.used} de {q.data!.today.cap} acciones como máximo de toda la empresa.</p>
            <Tabs value={tab} onValueChange={setTab}>
              <TabsList className="flex-wrap">
                <TabsTrigger value="reglas">Reglas</TabsTrigger>
                <TabsTrigger value="plantillas">Plantillas</TabsTrigger>
                <TabsTrigger value="historial">Historial</TabsTrigger>
                <TabsTrigger value="avisos">Avisos</TabsTrigger>
              </TabsList>
              <TabsContent value="reglas" className="pt-4"><Rules rules={q.data!.rules as RuleRow[]} options={q.data!.options} /></TabsContent>
              <TabsContent value="plantillas" className="pt-4"><Templates templates={q.data!.templates} /></TabsContent>
              <TabsContent value="historial" className="pt-4"><History rules={q.data!.rules as RuleRow[]} /></TabsContent>
              <TabsContent value="avisos" className="pt-4"><Notices /></TabsContent>
            </Tabs>
          </>
        )}
      </div>
    </AdminLayout>
  );
}
