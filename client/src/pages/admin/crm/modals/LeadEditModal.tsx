import React from "react";
import { trpc } from "@/lib/trpc";
import { useVocabulary } from "@/lib/vocabulary";
import { errorToastMessage } from "@/lib/errorMessage";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Plus, CheckCircle, RefreshCw, Trash2, Pencil } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { EUR2, FieldError, invalidProps } from "../shared/crmCommon";
import { CrmFormSection } from "../shared/ui/CrmUi";

// ─── LEAD EDIT MODAL ────────────────────────────────────────────────────────
export function LeadEditModal({
  leadId,
  onClose,
}: {
  leadId: number;
  onClose: () => void;
}) {
  const { t, format } = useI18n();
  const utils = trpc.useUtils();
  const voc = useVocabulary();
  const [submitted, setSubmitted] = React.useState(false);
  const { data, isLoading } = trpc.crm.leads.get.useQuery({ id: leadId });
  const { data: leadSources } = trpc.crm.leadSources.list.useQuery();

  type ActivityLine = {
    id: string;
    experienceId: number | null;
    experienceTitle: string;
    family: string;
    participants: number;
    search: string;
    showSuggestions: boolean;
  };

  const [form, setForm] = React.useState<{
    name: string; email: string; phone: string; company: string;
    selectedCategory: string; selectedProduct: string;
    message: string; priority: string; opportunityStatus: string;
    preferredDate: string; numberOfAdults: number; numberOfChildren: number;
    leadSourceId: number | null;
  } | null>(null);
  const [activityLines, setActivityLines] = React.useState<ActivityLine[]>([]);
  const [activeLineIdx, setActiveLineIdx] = React.useState<number>(0);
  const [initialized, setInitialized] = React.useState(false);

  // Populate form once data loads
  React.useEffect(() => {
    if (data && !initialized) {
      const { lead } = data;
      setForm({
        name: lead.name ?? "",
        email: lead.email ?? "",
        phone: lead.phone ?? "",
        company: (lead as any).company ?? "",
        selectedCategory: lead.selectedCategory ?? "",
        selectedProduct: lead.selectedProduct ?? "",
        message: lead.message ?? "",
        priority: lead.priority ?? "media",
        opportunityStatus: lead.opportunityStatus ?? "nueva",
        preferredDate: lead.preferredDate ? new Date(lead.preferredDate).toISOString().split("T")[0] : "",
        numberOfAdults: (lead as any).numberOfAdults ?? 2,
        numberOfChildren: (lead as any).numberOfChildren ?? 0,
        leadSourceId: (lead as any).leadSourceId ?? null,
      });
      const existingActivities = (lead as any).activitiesJson as ActivityLine[] | null;
      if (existingActivities && existingActivities.length > 0) {
        setActivityLines(existingActivities.map((a: any, i: number) => ({
          id: String(i + 1),
          experienceId: a.experienceId ?? null,
          experienceTitle: a.experienceTitle ?? "",
          family: a.family ?? "general",
          participants: a.participants ?? 2,
          search: "",
          showSuggestions: false,
        })));
      } else {
        setActivityLines([{ id: "1", experienceId: null, experienceTitle: "", family: "", participants: 2, search: "", showSuggestions: false }]);
      }
      setInitialized(true);
    }
  }, [data, initialized]);

  const activeSearch = activityLines[activeLineIdx]?.search ?? "";
  const { data: productSuggestions } = trpc.crm.products.search.useQuery(
    { q: activeSearch, limit: 8 },
    { enabled: activeSearch.length >= 2 }
  );

  const updateLine = (idx: number, patch: Partial<ActivityLine>) => {
    setActivityLines(prev => prev.map((l, i) => i === idx ? { ...l, ...patch } : l));
  };
  const addLine = () => {
    setActivityLines(prev => [...prev, { id: String(Date.now()), experienceId: null, experienceTitle: "", family: "", participants: 2, search: "", showSuggestions: false }]);
    setActiveLineIdx(activityLines.length);
  };
  const removeLine = (idx: number) => {
    if (activityLines.length === 1) return;
    setActivityLines(prev => prev.filter((_, i) => i !== idx));
    setActiveLineIdx(Math.max(0, activeLineIdx - 1));
  };

  const updateLead = trpc.crm.leads.update.useMutation({
    onSuccess: () => {
      toast.success(`${voc.Lead} ${voc.agreeLead("actualizado", "actualizada")}`);
      utils.crm.leads.list.invalidate();
      utils.crm.leads.counters.invalidate();
      onClose();
    },
    onError: (e) => toast.error(errorToastMessage(e)),
  });

  if (isLoading || !form) {
    return (
      <DialogContent className="max-w-xl">
        <div className="flex items-center justify-center py-12">
          <RefreshCw className="w-6 h-6 animate-spin text-warning" />
        </div>
      </DialogContent>
    );
  }

  const handleSave = () => {
    setSubmitted(true);
    if (!form.name.trim() || !form.email.trim()) {
      toast.error(t("crmLeads.nombreYEmailSon"));
      return;
    }
    const validActivities = activityLines.filter(l => l.experienceTitle.trim());
    updateLead.mutate({
      id: leadId,
      name: form.name,
      email: form.email,
      phone: form.phone,
      company: form.company || undefined,
      selectedCategory: form.selectedCategory || undefined,
      selectedProduct: validActivities.length > 0 ? validActivities[0].experienceTitle : form.selectedProduct,
      message: form.message,
      priority: form.priority as "baja" | "media" | "alta",
      opportunityStatus: form.opportunityStatus as "nueva" | "enviada" | "ganada" | "perdida",
      preferredDate: form.preferredDate || undefined,
      numberOfAdults: form.numberOfAdults,
      numberOfChildren: form.numberOfChildren,
      activitiesJson: validActivities.length > 0
        ? validActivities.map(l => ({
            experienceId: l.experienceId ?? 0,
            experienceTitle: l.experienceTitle,
            family: l.family || "general",
            participants: l.participants,
            details: {},
          }))
        : undefined,
      leadSourceId: form.leadSourceId,
    });
  };

  return (
    <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle className="text-foreground flex items-center gap-2">
          <Pencil className="w-4 h-4 text-warning" /> {voc.editLead}
        </DialogTitle>
      </DialogHeader>
      <p className="-mt-1 text-xs text-muted-foreground">{t("crmOpps.camposObligatorios")}</p>
      <div className="space-y-4">
        {/* Datos del cliente */}
        <CrmFormSection title={t("crmOpps.seccionContacto")}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="edit-lead-name" className="text-foreground/65 text-xs">{t("crmLeads.nombre")}{" "}<span className="text-danger">*</span></Label>
            <Input id="edit-lead-name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="bg-foreground/[0.05] border-foreground/[0.12] text-foreground mt-1" {...invalidProps(submitted && !form.name.trim() ? "x" : undefined, "edit-lead-name-error")} />
            <FieldError id="edit-lead-name-error" msg={submitted && !form.name.trim() ? t("crmOpps.campoObligatorio") : undefined} />
          </div>
          <div>
            <Label htmlFor="edit-lead-email" className="text-foreground/65 text-xs">{t("crmLeads.email")}{" "}<span className="text-danger">*</span></Label>
            <Input id="edit-lead-email" required type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="bg-foreground/[0.05] border-foreground/[0.12] text-foreground mt-1" {...invalidProps(submitted && !form.email.trim() ? "x" : undefined, "edit-lead-email-error")} />
            <FieldError id="edit-lead-email-error" msg={submitted && !form.email.trim() ? t("crmOpps.campoObligatorio") : undefined} />
          </div>
          <div>
            <Label className="text-foreground/65 text-xs">{t("crmLeads.telefono")}</Label>
            <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="bg-foreground/[0.05] border-foreground/[0.12] text-foreground mt-1" />
          </div>
          <div>
            <Label className="text-foreground/65 text-xs">{t("crmLeads.empresaGrupo")}</Label>
            <Input value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} className="bg-foreground/[0.05] border-foreground/[0.12] text-foreground mt-1" />
          </div>
        </div>

        </CrmFormSection>

        {/* Líneas de actividad */}
        <CrmFormSection title={t("crmOpps.seccionIntereses")}>
        <div>
          <div className="flex items-center justify-between mb-2">
            <Label className="text-foreground/65 text-xs">{voc.interests}</Label>
            <button type="button" onClick={addLine} className="flex items-center gap-1 text-xs text-warning hover:text-warning transition-colors">
              <Plus className="w-3 h-3" /> {voc.addInterest}
            </button>
          </div>
          <div className="space-y-2">
            {activityLines.map((line, idx) => (
              <div key={line.id} className="bg-foreground/[0.05] border border-foreground/[0.12] rounded-lg p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-foreground/40 w-4">{idx + 1}.</span>
                  <div className="relative flex-1">
                    <Input
                      value={line.experienceTitle || line.search}
                      onChange={e => { updateLine(idx, { search: e.target.value, experienceTitle: "", experienceId: null }); setActiveLineIdx(idx); }}
                      onFocus={() => { updateLine(idx, { showSuggestions: true }); setActiveLineIdx(idx); }}
                      onBlur={() => setTimeout(() => updateLine(idx, { showSuggestions: false }), 200)}
                      placeholder={voc.productSearch}
                      className="bg-foreground/[0.05] border-foreground/[0.12] text-foreground placeholder:text-muted-foreground text-sm h-8"
                    />
                    {line.showSuggestions && productSuggestions && productSuggestions.length > 0 && activeLineIdx === idx && (
                      <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-background border border-foreground/[0.15] rounded-lg shadow-lg max-h-40 overflow-y-auto">
                        {(productSuggestions as any[]).map((p: any) => (
                          <button key={`${p.productType}-${p.id}`} type="button"
                            className="w-full text-left px-3 py-2 hover:bg-foreground/[0.07] text-xs text-foreground flex items-center gap-2"
                            onMouseDown={() => updateLine(idx, {
                              experienceId: p.id,
                              experienceTitle: p.title,
                              family: p.productType === "experience" ? "experience" : "pack",
                              search: "",
                              showSuggestions: false,
                            })}>
                            <span className="text-foreground/50">{p.productType === "experience" ? "🏊" : "📦"}</span>
                            <span>{p.title}</span>
                            {p.basePrice && Number(p.basePrice) > 0 && <span className="ml-auto text-foreground/50">{format.currency(Number(p.basePrice), "EUR", EUR2)}</span>}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <span className="text-xs text-foreground/50">{t("crmLeads.pax2")}</span>
                    <Input
                      type="number" min={1} value={line.participants}
                      onChange={e => updateLine(idx, { participants: Math.max(1, Number(e.target.value)) })}
                      className="bg-foreground/[0.05] border-foreground/[0.12] text-foreground w-14 h-8 text-xs text-center"
                    />
                    {activityLines.length > 1 && (
                      <button type="button" onClick={() => removeLine(idx)} className="text-foreground/40 hover:text-danger transition-colors ml-1">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
                {line.experienceTitle && (
                  <p className="text-xs text-success pl-6">✓ {line.experienceTitle}</p>
                )}
              </div>
            ))}
          </div>
        </div>

        </CrmFormSection>

        {/* Fecha y participantes */}
        <CrmFormSection title={t("crmOpps.seccionFechaPersonas")}>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="sm:col-span-1">
            <Label className="text-foreground/65 text-xs">{voc.serviceDate}</Label>
            <Input type="date" value={form.preferredDate} onChange={e => setForm({ ...form, preferredDate: e.target.value })} className="bg-foreground/[0.05] border-foreground/[0.12] text-foreground mt-1" />
          </div>
          <div>
            <Label className="text-foreground/65 text-xs">{t("crmLeads.adultos")}</Label>
            <Input type="number" min={1} value={form.numberOfAdults} onChange={e => setForm({ ...form, numberOfAdults: Number(e.target.value) })} className="bg-foreground/[0.05] border-foreground/[0.12] text-foreground mt-1" />
          </div>
          <div>
            <Label className="text-foreground/65 text-xs">{t("crmLeads.ninos")}</Label>
            <Input type="number" min={0} value={form.numberOfChildren} onChange={e => setForm({ ...form, numberOfChildren: Number(e.target.value) })} className="bg-foreground/[0.05] border-foreground/[0.12] text-foreground mt-1" />
          </div>
        </div>

        </CrmFormSection>

        {/* Prioridad y estado */}
        <CrmFormSection title={t("crmOpps.seccionEstadoNotas")}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <Label className="text-foreground/65 text-xs">{t("crmLeads.prioridad2")}</Label>
            <Select value={form.priority} onValueChange={(v) => setForm({ ...form, priority: v })}>
              <SelectTrigger className="bg-foreground/[0.05] border-foreground/[0.12] text-foreground mt-1"><SelectValue /></SelectTrigger>
              <SelectContent className="bg-background border-foreground/[0.12]">
                <SelectItem value="baja" className="text-foreground">{t("crmLeads.baja")}</SelectItem>
                <SelectItem value="media" className="text-foreground">{t("crmLeads.media")}</SelectItem>
                <SelectItem value="alta" className="text-foreground">{t("crmLeads.alta")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-foreground/65 text-xs">{t("crmLeads.estadoOportunidad")}</Label>
            <Select value={form.opportunityStatus} onValueChange={(v) => setForm({ ...form, opportunityStatus: v })}>
              <SelectTrigger className="bg-foreground/[0.05] border-foreground/[0.12] text-foreground mt-1"><SelectValue /></SelectTrigger>
              <SelectContent className="bg-background border-foreground/[0.12]">
                <SelectItem value="nueva" className="text-foreground">{t("crmLeads.n1NuevaOportunidad")}</SelectItem>
                <SelectItem value="enviada" className="text-foreground">{t("crmLeads.n2OportunidadEnviada")}</SelectItem>
                <SelectItem value="ganada" className="text-foreground">{t("crmLeads.n3OportunidadGanada")}</SelectItem>
                <SelectItem value="perdida" className="text-foreground">{t("crmLeads.n4OportunidadPerdida")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Origen del lead */}
        {leadSources && leadSources.length > 0 && (
          <div>
            <Label className="text-foreground/65 text-xs">{voc.leadOrigin}</Label>
            <Select
              value={form.leadSourceId ? String(form.leadSourceId) : "none"}
              onValueChange={v => setForm({ ...form, leadSourceId: v === "none" ? null : Number(v) })}
            >
              <SelectTrigger className="bg-foreground/[0.05] border-foreground/[0.12] text-foreground mt-1"><SelectValue placeholder={t("crmLeads.sinAsignar")} /></SelectTrigger>
              <SelectContent className="bg-background border-foreground/[0.12]">
                <SelectItem value="none" className="text-foreground/50 text-xs">{t("crmLeads.sinAsignar")}</SelectItem>
                {(leadSources as any[]).map((src: any) => (
                  <SelectItem key={src.id} value={String(src.id)} className="text-xs">
                    <span style={{ color: src.color ?? undefined }}>{src.name}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Notas */}
        <div>
          <Label className="text-foreground/65 text-xs">{t("crmLeads.mensajeComentarios")}</Label>
          <Textarea value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} className="bg-foreground/[0.05] border-foreground/[0.12] text-foreground mt-1 resize-none h-16 text-sm" />
        </div>
        </CrmFormSection>
      </div>
      <DialogFooter>
        <Button variant="outline" size="sm" onClick={onClose}>{t("crmLeads.cancelar")}</Button>
        <Button
          size="sm"
          onClick={handleSave}
          disabled={updateLead.isPending}
        >
          {updateLead.isPending ? <RefreshCw className="w-4 h-4 animate-spin mr-1" /> : <CheckCircle className="w-4 h-4 mr-1" />}{t("crmLeads.guardarCambios")}</Button>
      </DialogFooter>
    </DialogContent>
  );
}