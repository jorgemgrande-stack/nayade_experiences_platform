import React, { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

type TemplateConfig = {
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

type AutomationRule = {
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
  emailSubject: string | null;
  emailBody: string | null;
};

const CATEGORIES = [
  "Leads", "Presupuestos", "Reservas", "Pagos / Transferencias",
  "Anulaciones", "Cupones", "Restaurantes", "Operaciones internas", "Administración",
];

// Templates con cron legacy propio. emailManager bloquea el auto-scheduling para estas claves,
// así que las reglas de automatización no generarán jobs aunque se creen aquí.
const LEGACY_CRON_KEYS: Record<string, string> = {
  quote: "quoteReminderJob — 48h, max 2 recordatorios, sin feature flag",
};

function Toggle({ value, onChange, label }: { value: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-gray-400">{label}</span>
      <button
        onClick={() => onChange(!value)}
        className={`w-9 h-5 rounded-full transition-colors ${value ? "bg-emerald-500" : "bg-gray-700"}`}
      >
        <span className={`block w-4 h-4 bg-white rounded-full shadow transition-transform mx-0.5 ${value ? "translate-x-4" : "translate-x-0"}`} />
      </button>
    </div>
  );
}

function RuleCard({
  rule,
  onUpdate,
  onDelete,
}: {
  rule: AutomationRule;
  onUpdate: (id: number, data: Partial<AutomationRule>) => void;
  onDelete: (id: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ ...rule });

  const save = () => {
    onUpdate(rule.id, form);
    setEditing(false);
  };

  return (
    <div className="bg-[#111] border border-[#2a2a2a] rounded-lg p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full shrink-0 ${rule.isActive ? "bg-emerald-400" : "bg-gray-600"}`} />
            <span className="text-sm font-medium text-white">{rule.name}</span>
          </div>
          <div className="mt-1 text-xs text-gray-500 font-mono">
            +{rule.delayHours}h desde {rule.calculateFrom === "trigger_time" ? "trigger" : rule.calculateFrom}
            {" · "}{rule.allowedSendStart}–{rule.allowedSendEnd}
            {" · "}max {rule.maxSendsPerEntity}x
          </div>
          {rule.emailSubject && (
            <div className="mt-1 text-xs text-gray-400 truncate">Asunto: {rule.emailSubject}</div>
          )}
        </div>
        <div className="flex gap-1 shrink-0">
          <button onClick={() => setEditing(true)} className="text-xs text-gray-500 hover:text-white px-2 py-1 rounded hover:bg-[#2a2a2a] transition-colors">Editar</button>
          <button onClick={() => onDelete(rule.id)} className="text-xs text-red-500 hover:text-red-400 px-2 py-1 rounded hover:bg-[#2a2a2a] transition-colors">Borrar</button>
        </div>
      </div>

      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Editar regla</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">Nombre</Label>
              <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className="h-8 text-xs" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Retraso (horas)</Label>
                <Input type="number" min={1} value={form.delayHours} onChange={e => setForm(f => ({ ...f, delayHours: +e.target.value }))} className="h-8 text-xs" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Calcular desde</Label>
                <Select value={form.calculateFrom} onValueChange={v => setForm(f => ({ ...f, calculateFrom: v }))}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="trigger_time">Momento del trigger</SelectItem>
                    <SelectItem value="last_reminder">Último recordatorio</SelectItem>
                    <SelectItem value="created_at">Fecha de creación</SelectItem>
                    <SelectItem value="viewed_at">Fecha de visualización</SelectItem>
                    <SelectItem value="expires_at">Fecha de vencimiento</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Hora inicio (HH:MM)</Label>
                <Input value={form.allowedSendStart} onChange={e => setForm(f => ({ ...f, allowedSendStart: e.target.value }))} className="h-8 text-xs font-mono" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Hora fin (HH:MM)</Label>
                <Input value={form.allowedSendEnd} onChange={e => setForm(f => ({ ...f, allowedSendEnd: e.target.value }))} className="h-8 text-xs font-mono" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Máx. envíos por entidad</Label>
                <Input type="number" min={1} max={10} value={form.maxSendsPerEntity} onChange={e => setForm(f => ({ ...f, maxSendsPerEntity: +e.target.value }))} className="h-8 text-xs" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Orden</Label>
                <Input type="number" value={form.sortOrder} onChange={e => setForm(f => ({ ...f, sortOrder: +e.target.value }))} className="h-8 text-xs" />
              </div>
            </div>
            <div className="space-y-2 border border-[#2a2a2a] rounded p-3">
              <div className="text-xs text-gray-500 mb-1">Condiciones de parada</div>
              <Toggle value={form.stopIfConverted} onChange={v => setForm(f => ({ ...f, stopIfConverted: v }))} label="Parar si ya hay reserva" />
              <Toggle value={form.stopIfPaid} onChange={v => setForm(f => ({ ...f, stopIfPaid: v }))} label="Parar si ya está pagado" />
              <Toggle value={form.isActive} onChange={v => setForm(f => ({ ...f, isActive: v }))} label="Regla activa" />
            </div>
            <div className="col-span-2 rounded-md bg-blue-950/40 border border-blue-800/40 px-3 py-2 text-xs text-blue-300">
              El contenido del email se lee automáticamente desde <strong>/admin/plantillas-email</strong>. Los campos de abajo son opcionales: solo rellena si quieres sobrescribir el asunto o usar un cuerpo distinto al de la plantilla.
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Sobrescribir asunto <span className="text-gray-600">(opcional)</span></Label>
              <Input value={form.emailSubject ?? ""} onChange={e => setForm(f => ({ ...f, emailSubject: e.target.value || null }))} className="h-8 text-xs" placeholder="Vacío = usa el asunto de la plantilla" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Cuerpo alternativo en HTML <span className="text-gray-600">(fallback si no hay plantilla)</span></Label>
              <Textarea value={form.emailBody ?? ""} onChange={e => setForm(f => ({ ...f, emailBody: e.target.value || null }))} rows={4} className="text-xs font-mono" placeholder="Vacío = usa el diseño de /admin/plantillas-email" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setEditing(false)}>Cancelar</Button>
            <Button size="sm" className="bg-orange-500 hover:bg-orange-600 text-white" onClick={save}>Guardar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function TemplateCard({ config }: { config: TemplateConfig }) {
  const [expanded, setExpanded] = useState(false);
  const [showNewRule, setShowNewRule] = useState(false);
  const [showTest, setShowTest] = useState(false);
  const [testEmail, setTestEmail] = useState("");

  const utils = trpc.useUtils();

  const upsert = trpc.emailCommunications.upsertTemplateConfig.useMutation({
    onSuccess: () => { toast.success("Configuración guardada"); utils.emailCommunications.listTemplateConfigs.invalidate(); },
    onError: (e) => toast.error(e.message),
  });

  const { data: rules, refetch: refetchRules } = trpc.emailCommunications.listRules.useQuery(
    { templateKey: config.key },
    { enabled: expanded }
  );

  const createRule = trpc.emailCommunications.createRule.useMutation({
    onSuccess: () => { toast.success("Regla creada"); setShowNewRule(false); refetchRules(); resetRuleForm(); },
    onError: (e) => toast.error(e.message),
  });

  const updateRule = trpc.emailCommunications.updateRule.useMutation({
    onSuccess: () => { toast.success("Regla actualizada"); refetchRules(); },
    onError: (e) => toast.error(e.message),
  });

  const deleteRule = trpc.emailCommunications.deleteRule.useMutation({
    onSuccess: () => { toast.success("Regla eliminada"); refetchRules(); },
    onError: (e) => toast.error(e.message),
  });

  const sendTest = trpc.emailCommunications.sendTestEmail.useMutation({
    onSuccess: (r) => { toast.success(`Email de prueba enviado a ${r.to}`); setShowTest(false); setTestEmail(""); },
    onError: (e) => toast.error(e.message),
  });

  const [ruleForm, setRuleForm] = useState({
    name: "",
    delayHours: 24,
    calculateFrom: "trigger_time" as const,
    maxSendsPerEntity: 1,
    allowedSendStart: "09:00",
    allowedSendEnd: "21:00",
    stopIfConverted: true,
    stopIfPaid: true,
    emailSubject: "",
    emailBody: "",
  });

  const resetRuleForm = () => setRuleForm({
    name: "", delayHours: 24, calculateFrom: "trigger_time",
    maxSendsPerEntity: 1, allowedSendStart: "09:00", allowedSendEnd: "21:00",
    stopIfConverted: true, stopIfPaid: true, emailSubject: "", emailBody: "",
  });

  const [localActive, setLocalActive] = useState(config.isActive);
  const [localToCustomer, setLocalToCustomer] = useState(config.sendToCustomer);
  const [localToAdmin, setLocalToAdmin] = useState(config.sendToAdmin);
  const [localAdminEmail, setLocalAdminEmail] = useState(config.adminCopyEmail ?? "");
  const [localSubject, setLocalSubject] = useState(config.customSubject ?? "");

  const save = () => {
    upsert.mutate({
      key: config.key,
      isActive: localActive,
      sendToCustomer: localToCustomer,
      sendToAdmin: localToAdmin,
      adminCopyEmail: localAdminEmail || null,
      customSubject: localSubject || null,
    });
  };

  const statusColor = localActive ? "bg-emerald-900/30 border-emerald-700/50 text-emerald-400" : "bg-red-900/20 border-red-700/30 text-red-400";

  return (
    <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg overflow-hidden">
      <div className="p-3 flex items-center justify-between gap-3 cursor-pointer" onClick={() => setExpanded(e => !e)}>
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span className={`text-[10px] px-1.5 py-0.5 rounded-full border ${statusColor}`}>
            {localActive ? "Activa" : "Inactiva"}
          </span>
          <span className="text-sm font-medium text-white truncate">{config.friendlyName ?? config.key}</span>
          {rules && rules.length > 0 && (
            <span className="text-xs text-amber-400 shrink-0">{rules.length} regla{rules.length !== 1 ? "s" : ""}</span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs text-gray-600">{config.category}</span>
          <span className="text-gray-600 text-xs">{expanded ? "▲" : "▼"}</span>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-[#2a2a2a] p-4 space-y-4">
          {/* Aviso de cobertura legacy */}
          {LEGACY_CRON_KEYS[config.key] && (
            <div className="bg-amber-900/20 border border-amber-700/40 rounded-lg p-3 flex gap-2 text-xs text-amber-300">
              <span className="shrink-0 mt-0.5">⚠</span>
              <div>
                <span className="font-semibold">Cron legacy activo:</span>{" "}
                {LEGACY_CRON_KEYS[config.key]}.<br />
                Las reglas de automatización que crees aquí <strong>no generarán jobs automáticos</strong> para esta plantilla
                — el sistema los bloquea en <code className="font-mono text-amber-200">emailManager.ts</code> para evitar duplicados.
                Los recordatorios siguen siendo gestionados por el cron legacy.
              </div>
            </div>
          )}
          {/* Config toggles */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-3 bg-[#111] rounded-lg p-3">
              <div className="text-xs text-gray-500 font-medium mb-2">Envío principal</div>
              <Toggle value={localActive} onChange={setLocalActive} label="Plantilla activa" />
              <Toggle value={localToCustomer} onChange={setLocalToCustomer} label="Enviar al cliente" />
              <Toggle value={localToAdmin} onChange={setLocalToAdmin} label="Copia al admin" />
            </div>
            <div className="space-y-3 bg-[#111] rounded-lg p-3">
              <div className="text-xs text-gray-500 font-medium mb-2">Email admin</div>
              <div className="space-y-1">
                <Label className="text-xs text-gray-500">Email de copia (override)</Label>
                <Input
                  type="email"
                  value={localAdminEmail}
                  onChange={e => setLocalAdminEmail(e.target.value)}
                  placeholder="Vacío = usar global"
                  className="h-8 text-xs"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-gray-500">Asunto personalizado (override)</Label>
                <Input
                  value={localSubject}
                  onChange={e => setLocalSubject(e.target.value)}
                  placeholder="Vacío = usar el de la función"
                  className="h-8 text-xs"
                />
              </div>
            </div>
          </div>

          <div className="flex gap-2">
            <Button size="sm" className="bg-orange-500 hover:bg-orange-600 text-white text-xs" onClick={save} disabled={upsert.isPending}>
              {upsert.isPending ? "Guardando..." : "Guardar configuración"}
            </Button>
            <Button size="sm" variant="outline" className="text-xs" onClick={() => setShowTest(true)}>
              Enviar prueba
            </Button>
          </div>

          {/* Rules */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="text-xs font-medium text-gray-400">Reglas de automatización / reenvíos</div>
              <button onClick={() => setShowNewRule(true)} className="text-xs text-orange-400 hover:text-orange-300 transition-colors">+ Nueva regla</button>
            </div>

            {(!rules || rules.length === 0) ? (
              <div className="text-xs text-gray-600 py-2">Sin reglas de automatización configuradas</div>
            ) : (
              <div className="space-y-2">
                {rules.map(r => (
                  <RuleCard
                    key={r.id}
                    rule={r as AutomationRule}
                    onUpdate={(id, data) => updateRule.mutate({ id, ...data as any })}
                    onDelete={(id) => deleteRule.mutate({ id })}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modal: nueva regla */}
      <Dialog open={showNewRule} onOpenChange={setShowNewRule}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Nueva regla de automatización</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="text-xs text-gray-500 bg-[#111] rounded p-2">
              Plantilla: <span className="text-white font-mono">{config.key}</span>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Nombre de la regla</Label>
              <Input value={ruleForm.name} onChange={e => setRuleForm(f => ({ ...f, name: e.target.value }))} placeholder="ej: Recordatorio 24h" className="h-8 text-xs" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Retraso (horas)</Label>
                <Input type="number" min={1} value={ruleForm.delayHours} onChange={e => setRuleForm(f => ({ ...f, delayHours: +e.target.value }))} className="h-8 text-xs" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Calcular desde</Label>
                <Select value={ruleForm.calculateFrom} onValueChange={v => setRuleForm(f => ({ ...f, calculateFrom: v as any }))}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="trigger_time">Momento del trigger</SelectItem>
                    <SelectItem value="last_reminder">Último recordatorio</SelectItem>
                    <SelectItem value="created_at">Fecha de creación</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Hora inicio</Label>
                <Input value={ruleForm.allowedSendStart} onChange={e => setRuleForm(f => ({ ...f, allowedSendStart: e.target.value }))} className="h-8 text-xs font-mono" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Hora fin</Label>
                <Input value={ruleForm.allowedSendEnd} onChange={e => setRuleForm(f => ({ ...f, allowedSendEnd: e.target.value }))} className="h-8 text-xs font-mono" />
              </div>
            </div>
            <div className="col-span-2 rounded-md bg-blue-950/40 border border-blue-800/40 px-3 py-2 text-xs text-blue-300">
              El contenido del email se lee automáticamente desde <strong>/admin/plantillas-email</strong>. Los campos de abajo son opcionales: solo rellena si quieres sobrescribir el asunto o usar un cuerpo distinto al de la plantilla.
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Sobrescribir asunto <span className="text-gray-600">(opcional)</span></Label>
              <Input value={ruleForm.emailSubject} onChange={e => setRuleForm(f => ({ ...f, emailSubject: e.target.value }))} className="h-8 text-xs" placeholder="Vacío = usa el asunto de la plantilla" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Cuerpo alternativo en HTML <span className="text-gray-600">(fallback si no hay plantilla)</span></Label>
              <Textarea value={ruleForm.emailBody} onChange={e => setRuleForm(f => ({ ...f, emailBody: e.target.value }))} rows={4} className="text-xs font-mono" placeholder="Vacío = usa el diseño de /admin/plantillas-email" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => { setShowNewRule(false); resetRuleForm(); }}>Cancelar</Button>
            <Button size="sm" className="bg-orange-500 hover:bg-orange-600 text-white"
              disabled={!ruleForm.name || createRule.isPending}
              onClick={() => createRule.mutate({ templateKey: config.key, ...ruleForm, isActive: true, sortOrder: (rules?.length ?? 0) })}>
              Crear regla
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal: test email */}
      <Dialog open={showTest} onOpenChange={setShowTest}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Enviar email de prueba</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="text-xs text-gray-400">Plantilla: <span className="font-mono text-white">{config.key}</span></div>
            <div className="space-y-1">
              <Label className="text-xs">Email destinatario</Label>
              <Input type="email" value={testEmail} onChange={e => setTestEmail(e.target.value)} placeholder="test@ejemplo.com" className="h-8 text-xs" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setShowTest(false)}>Cancelar</Button>
            <Button size="sm" className="bg-purple-600 hover:bg-purple-700 text-white"
              disabled={!testEmail || sendTest.isPending}
              onClick={() => sendTest.mutate({ to: testEmail, templateKey: config.key })}>
              Enviar prueba
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function TemplateRulesTab() {
  const [search, setSearch] = useState("");
  const [filterCategory, setFilterCategory] = useState("all");

  const { data: configs, isLoading } = trpc.emailCommunications.listTemplateConfigs.useQuery();

  const filtered = (configs ?? []).filter(c => {
    if (filterCategory !== "all" && c?.category !== filterCategory) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        (c?.key ?? "").includes(q) ||
        (c?.friendlyName ?? "").toLowerCase().includes(q) ||
        (c?.category ?? "").toLowerCase().includes(q)
      );
    }
    return true;
  });

  const byCategory = CATEGORIES.map(cat => ({
    cat,
    items: filtered.filter(c => c?.category === cat),
  })).filter(g => g.items.length > 0);

  const uncategorized = filtered.filter(c => !CATEGORIES.includes(c?.category ?? ""));

  if (isLoading) return <div className="py-12 text-center text-gray-600 text-sm">Cargando plantillas...</div>;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <h2 className="text-lg font-semibold text-white">Plantillas y reglas</h2>
        <p className="text-sm text-gray-400 mt-1">
          Configura el comportamiento de cada plantilla de email. Expande una plantilla para ver y crear reglas de automatización.
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <input
          type="text"
          placeholder="Buscar plantilla..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="bg-[#1a1a1a] border border-[#2a2a2a] text-sm text-white rounded px-3 py-1.5 w-48 focus:outline-none focus:border-[#444]"
        />
        <select
          value={filterCategory}
          onChange={e => setFilterCategory(e.target.value)}
          className="bg-[#1a1a1a] border border-[#2a2a2a] text-sm text-gray-300 rounded px-3 py-1.5 focus:outline-none"
        >
          <option value="all">Todas las categorías</option>
          {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      {/* Template groups */}
      <div className="space-y-6">
        {byCategory.map(({ cat, items }) => (
          <div key={cat}>
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">{cat} ({items.length})</div>
            <div className="space-y-2">
              {items.map(c => c && <TemplateCard key={c.key} config={c as TemplateConfig} />)}
            </div>
          </div>
        ))}
        {uncategorized.length > 0 && (
          <div>
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Sin categoría ({uncategorized.length})</div>
            <div className="space-y-2">
              {uncategorized.map(c => c && <TemplateCard key={c.key} config={c as TemplateConfig} />)}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
