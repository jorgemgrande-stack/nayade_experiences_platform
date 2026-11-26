import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useVocabulary } from "@/lib/vocabulary";
import { errorToastMessage } from "@/lib/errorMessage";
import { validateContact, hasErrors, type FieldErrors } from "@shared/crmForms";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { CatalogConceptSelector } from "@/components/CatalogConceptSelector";
import { Users, Plus, Trash2 } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { FieldError, invalidProps } from "../shared/crmCommon";
import { CrmFormSection } from "../shared/ui/CrmUi";

// ─── DIRECT QUOTE MODAL (sin lead previo) ───────────────────────────────────

// ─── NEW LEAD MODAL (creación manual de lead por admin) ──────────────────────
export function NewLeadModal({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const utils = trpc.useUtils();
  const voc = useVocabulary();
  const [errors, setErrors] = useState<FieldErrors<"name" | "email" | "phone">>({});
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [company, setCompany] = useState("");
  const [messageText, setMessageText] = useState("");
  const [preferredDate, setPreferredDate] = useState("");
  const [adults, setAdults] = useState(2);
  const [children, setChildren] = useState(0);
  const [source, setSource] = useState("admin");

  // ── Líneas de actividad ──────────────────────────────────────────────────
  type ActivityLine = {
    id: string;
    experienceId: number | null;
    experienceTitle: string;
    family: string;
    participants: number;
  };
  const [activityLines, setActivityLines] = useState<ActivityLine[]>([
    { id: "1", experienceId: null, experienceTitle: "", family: "", participants: 2 },
  ]);

  const updateLine = (idx: number, patch: Partial<ActivityLine>) => {
    setActivityLines(prev => prev.map((l, i) => i === idx ? { ...l, ...patch } : l));
  };
  const addLine = () => {
    setActivityLines(prev => [...prev, {
      id: String(Date.now()),
      experienceId: null,
      experienceTitle: "",
      family: "",
      participants: 2,
    }]);
  };
  const removeLine = (idx: number) => {
    if (activityLines.length === 1) return;
    setActivityLines(prev => prev.filter((_, i) => i !== idx));
  };

  const createLead = trpc.crm.leads.create.useMutation({
    onSuccess: () => {
      toast.success(voc.agreeLead(t("crmEmpty.toast.leadCreatedM", { lead: voc.Lead, name }), t("crmEmpty.toast.leadCreatedF", { lead: voc.Lead, name })));
      utils.crm.leads.list.invalidate();
      utils.crm.leads.counters.invalidate();
      onClose();
    },
    onError: (e) => toast.error(errorToastMessage(e)),
  });

  const handleSubmit = () => {
    const errs = validateContact({ name, email, phone });
    setErrors(errs);
    if (hasErrors(errs)) {
      toast.error(t("crmLeads.revisaLosCamposMarcados"));
      return;
    }
    const validActivities = activityLines.filter(l => l.experienceTitle.trim());
    createLead.mutate({
      name: name.trim(),
      email: email.trim(),
      phone: phone.trim() || undefined,
      company: company.trim() || undefined,
      message: messageText.trim() || undefined,
      preferredDate: preferredDate || undefined,
      numberOfAdults: adults,
      numberOfChildren: children,
      selectedProduct: validActivities.length > 0 ? validActivities[0].experienceTitle : undefined,
      source,
      activitiesJson: validActivities.length > 0
        ? validActivities.map(l => ({
            experienceId: l.experienceId ?? 0,
            experienceTitle: l.experienceTitle,
            family: l.family || "general",
            participants: l.participants,
            details: {},
          }))
        : undefined,
    });
  };

  return (
    <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle className="text-foreground flex items-center gap-2">
          <Users className="w-4 h-4 text-primary" /> {voc.newLead}
        </DialogTitle>
      </DialogHeader>
      <p className="-mt-1 text-xs text-muted-foreground">{t("crmOpps.camposObligatorios")}</p>
      <div className="space-y-4">
        {/* Datos del cliente */}
        <CrmFormSection title={t("crmOpps.seccionContacto")}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="new-lead-name" className="text-xs text-foreground/60 mb-1 block">{t("crmLeads.nombre")}{" "}<span className="text-danger">*</span></Label>
            <Input id="new-lead-name" required value={name} onChange={e => setName(e.target.value)} placeholder={t("crmLeads.anaGarcia")} className="bg-foreground/[0.05] border-foreground/[0.12] text-foreground placeholder:text-muted-foreground" {...invalidProps(errors.name, "new-lead-name-error")} />
            <FieldError id="new-lead-name-error" msg={errors.name} />
          </div>
          <div>
            <Label htmlFor="new-lead-email" className="text-xs text-foreground/60 mb-1 block">{t("crmLeads.email")}{" "}<span className="text-danger">*</span></Label>
            <Input id="new-lead-email" required type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="ana@ejemplo.com" className="bg-foreground/[0.05] border-foreground/[0.12] text-foreground placeholder:text-muted-foreground" {...invalidProps(errors.email, "new-lead-email-error")} />
            <FieldError id="new-lead-email-error" msg={errors.email} />
          </div>
          <div>
            <Label htmlFor="new-lead-phone" className="text-xs text-foreground/60 mb-1 block">{t("crmLeads.telefono")}</Label>
            <Input id="new-lead-phone" type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="+34 600 000 000" className="bg-foreground/[0.05] border-foreground/[0.12] text-foreground placeholder:text-muted-foreground" {...invalidProps(errors.phone, "new-lead-phone-error")} />
            <FieldError id="new-lead-phone-error" msg={errors.phone} />
          </div>
          <div>
            <Label htmlFor="new-lead-company" className="text-xs text-foreground/60 mb-1 block">{t("crmLeads.empresaGrupo")}</Label>
            <Input id="new-lead-company" value={company} onChange={e => setCompany(e.target.value)} placeholder={t("crmLeads.empresaSL")} className="bg-foreground/[0.05] border-foreground/[0.12] text-foreground placeholder:text-muted-foreground" />
          </div>
        </div>

        </CrmFormSection>

        {/* Líneas de actividad */}
        <CrmFormSection title={t("crmOpps.seccionIntereses")}>
        <div>
          <div className="flex items-center justify-between mb-2">
            <Label className="text-xs text-foreground/60">{voc.interests}</Label>
            <button type="button" onClick={addLine} className="flex items-center gap-1 text-xs text-primary hover:text-primary transition-colors">
              <Plus className="w-3 h-3" /> {voc.addInterest}
            </button>
          </div>
          <div className="space-y-2">
            {activityLines.map((line, idx) => (
              <div key={line.id} className="bg-foreground/[0.05] border border-foreground/[0.12] rounded-lg p-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-foreground/40 w-4 shrink-0">{idx + 1}.</span>
                  <CatalogConceptSelector
                    className="flex-1 min-w-0"
                    value={line.experienceTitle}
                    onChange={(v) => updateLine(idx, { experienceTitle: v, experienceId: null, family: "" })}
                    onSelectProduct={(p) => updateLine(idx, {
                      experienceId: p.id,
                      experienceTitle: p.title,
                      family: p.productType === "experience" ? "experience" : "pack",
                    })}
                    inputClassName="bg-foreground/[0.05] border-foreground/[0.12] text-foreground placeholder:text-muted-foreground text-sm h-8"
                    placeholder={voc.productSearch}
                    showBadge={false}
                    sourceType={line.family === "experience" ? "experience" : line.family === "pack" ? "legoPack" : undefined}
                  />
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
                {line.experienceId && (
                  <p className="text-xs text-success pl-6 mt-1.5 flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-success shrink-0" />
                    {voc.licensed ? t("crmLeads.vinculadoAlCatalogo") : <>{line.family === "experience" ? t("crmLeads.experiencia") : t("crmLeads.pack")}{" "}{t("crmLeads.vinculadoDelCatalogo")}</>}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>

        </CrmFormSection>

        {/* Fecha y participantes globales */}
        <CrmFormSection title={t("crmOpps.seccionFechaPersonas")}>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="sm:col-span-1">
            <Label htmlFor="new-lead-date" className="text-xs text-foreground/60 mb-1 block">{voc.serviceDate}</Label>
            <Input id="new-lead-date" type="date" value={preferredDate} onChange={e => setPreferredDate(e.target.value)} className="bg-foreground/[0.05] border-foreground/[0.12] text-foreground" />
          </div>
          <div>
            <Label htmlFor="new-lead-adults" className="text-xs text-foreground/60 mb-1 block">{t("crmLeads.adultos")}</Label>
            <Input id="new-lead-adults" type="number" min={1} value={adults} onChange={e => setAdults(Number(e.target.value))} className="bg-foreground/[0.05] border-foreground/[0.12] text-foreground" />
          </div>
          <div>
            <Label htmlFor="new-lead-children" className="text-xs text-foreground/60 mb-1 block">{t("crmLeads.ninos")}</Label>
            <Input id="new-lead-children" type="number" min={0} value={children} onChange={e => setChildren(Number(e.target.value))} className="bg-foreground/[0.05] border-foreground/[0.12] text-foreground" />
          </div>
        </div>

        </CrmFormSection>

        {/* Canal y notas */}
        <CrmFormSection title={t("crmOpps.seccionOrigenNotas")}>
        <div>
          <Label htmlFor="new-lead-source" className="text-xs text-foreground/60 mb-1 block">{t("crmLeads.canalDeOrigen")}</Label>
          <Select value={source} onValueChange={setSource}>
            <SelectTrigger id="new-lead-source" className="bg-foreground/[0.05] border-foreground/[0.12] text-foreground"><SelectValue /></SelectTrigger>
            <SelectContent className="bg-background border-foreground/[0.12]">
              <SelectItem value="admin" className="text-foreground text-xs">{voc.licensed ? t("crmLeads.altaManual") : t("crmLeads.adminManual")}</SelectItem>
              <SelectItem value="telefono" className="text-foreground text-xs">{t("crmLeads.telefono2")}</SelectItem>
              <SelectItem value="email" className="text-foreground text-xs">{t("crmLeads.email2")}</SelectItem>
              <SelectItem value="whatsapp" className="text-foreground text-xs">{t("crmLeads.whatsapp")}</SelectItem>
              <SelectItem value="presencial" className="text-foreground text-xs">{t("crmLeads.presencial")}</SelectItem>
              <SelectItem value="otro" className="text-foreground text-xs">{t("crmLeads.otro")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label htmlFor="new-lead-message" className="text-xs text-foreground/60 mb-1 block">{t("crmLeads.mensajeNotas")}</Label>
          <Textarea id="new-lead-message" value={messageText} onChange={e => setMessageText(e.target.value)} placeholder={t("crmLeads.informacionAdicionalDelCliente")} rows={3} className="bg-foreground/[0.05] border-foreground/[0.12] text-foreground placeholder:text-muted-foreground resize-none" />
        </div>
        </CrmFormSection>
      </div>
      <DialogFooter className="gap-2 sticky -bottom-6 z-10 -mx-6 -mb-6 border-t border-border bg-background px-6 pb-9 pt-3 max-sm:[&>button]:w-full">
        <Button variant="outline" size="sm" onClick={onClose} className="border-foreground/[0.15] text-foreground/65">{t("crmLeads.cancelar")}</Button>
        <Button size="sm" onClick={handleSubmit} disabled={createLead.isPending}>
          {createLead.isPending ? t("crmLeads.creando") : voc.createLead}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}