/**
 * Contratos y firma electrónica · plantillas (/admin/contratos/plantillas): título y texto con variables simples
 * ({{cliente.nombre}}, {{fecha}}, {{importe}}…). Cada cambio sube la versión; los contratos ya creados conservan su texto.
 * Las gestiona la administración; una plantilla se desactiva (no se borra).
 */
import { useState } from "react";
import { FileText, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PanelEmpty, PanelError, PanelLoading, toastError } from "@/components/admin/PanelStates";
import { FormField } from "@/components/admin/crm/CrmParts";
import { ESIGN_LIMITS, TEMPLATE_VARIABLES, templateProblem } from "@shared/contractsEsign";
import { PageHeader, useEsignFmt, useEsignRole } from "./ContractsParts";
import { useI18n } from "@/i18n/I18nProvider";

const EXAMPLE = "Entre {{empresa.nombre}} y {{cliente.nombre}} (DNI/NIF {{cliente.nif}}), en fecha {{fecha}}, se acuerda la prestación del servicio por un importe de {{importe}}.\n\n1. Objeto: …\n2. Condiciones: …";

const VAR_KEYS: Record<string, string> = {
  "cliente.nombre": "clientName",
  "cliente.email": "clientEmail",
  "cliente.nif": "clientTaxId",
  "cliente.telefono": "clientPhone",
  "cliente.direccion": "clientAddress",
  "cliente.empresa": "clientCompany",
  "empresa.nombre": "companyName",
  fecha: "date",
  importe: "amount",
  "contrato.titulo": "title",
};

export default function ContractTemplates() {
  const { t } = useI18n();
  const { fmtMs } = useEsignFmt();
  const { isAdmin } = useEsignRole();
  const utils = trpc.useUtils();
  const list = trpc.contractsEsign.templates.useQuery({ includeInactive: true }, { retry: false });
  const [form, setForm] = useState<{ id?: number; title: string; body: string } | null>(null);
  const refresh = () => void utils.contractsEsign.templates.invalidate();
  const save = trpc.contractsEsign.saveTemplate.useMutation({ onSuccess: (tpl) => { toast.success(t("contracts.templates.saved", { version: tpl.version })); setForm(null); refresh(); }, onError: (e) => toastError(e) });
  const toggle = trpc.contractsEsign.setTemplateActive.useMutation({ onSuccess: () => refresh(), onError: (e) => toastError(e) });
  const insert = (key: string) => form && setForm({ ...form, body: `${form.body}{{${key}}}` });
  const newButton = isAdmin ? <Button onClick={() => setForm({ title: "", body: EXAMPLE })}><Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />{t("contracts.templates.newTemplate")}</Button> : undefined;
  return (
    <AdminLayout>
      <div className="mx-auto max-w-5xl space-y-5">
        <PageHeader title={t("contracts.templates.title")} description={t("contracts.templates.description")} actions={newButton} />
        {list.isLoading ? (
          <PanelLoading label={t("contracts.templates.loading")} />
        ) : list.isError ? (
          <PanelError error={list.error} onRetry={() => list.refetch()} />
        ) : (list.data ?? []).length === 0 ? (
          <PanelEmpty icon={<FileText className="h-5 w-5" />} title={t("contracts.templates.emptyTitle")} description={t("contracts.templates.emptyDescription")}>{newButton}</PanelEmpty>
        ) : (
          <ul className="space-y-2">
            {(list.data ?? []).map((tpl) => (
              <li key={tpl.id} className="flex min-w-0 flex-col gap-2 rounded-xl border border-border bg-card p-4 sm:flex-row sm:items-start">
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="min-w-0 break-words font-medium text-foreground">{tpl.title}</p>
                    <Badge variant="outline">v{tpl.version}</Badge>
                    {!tpl.isActive && <Badge variant="secondary">{t("contracts.templates.inactive")}</Badge>}
                  </div>
                  <p className="line-clamp-2 break-words text-xs text-muted-foreground">{tpl.body}</p>
                  <p className="text-xs text-muted-foreground">{t("contracts.templates.updatedOn", { date: fmtMs(tpl.updatedAt) })}</p>
                </div>
                {isAdmin && (
                  <div className="flex flex-wrap gap-1.5">
                    <Button size="sm" variant="outline" onClick={() => setForm({ id: tpl.id, title: tpl.title, body: tpl.body })}><Pencil className="mr-1 h-4 w-4" aria-hidden="true" />{t("common.edit")}</Button>
                    <Button size="sm" variant="ghost" disabled={toggle.isPending} onClick={() => toggle.mutate({ id: tpl.id, active: !tpl.isActive })}>{tpl.isActive ? t("contracts.templates.deactivate") : t("contracts.templates.activate")}</Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      <Dialog open={form != null} onOpenChange={(o) => !o && setForm(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{form?.id ? t("contracts.templates.editTemplate") : t("contracts.templates.newTemplate")}</DialogTitle>
            <DialogDescription>{t("contracts.templates.dialogDescription")}</DialogDescription>
          </DialogHeader>
          {form && (
            <div className="space-y-3">
              <FormField id="tp-title" label={t("contracts.templates.titleLabel")} required>
                <Input id="tp-title" value={form.title} maxLength={ESIGN_LIMITS.titleMax} onChange={(e) => setForm({ ...form, title: e.target.value })} />
              </FormField>
              <FormField id="tp-body" label={t("contracts.templates.bodyLabel")} required>
                <Textarea id="tp-body" rows={14} value={form.body} maxLength={ESIGN_LIMITS.bodyMax} onChange={(e) => setForm({ ...form, body: e.target.value })} />
              </FormField>
              <div className="space-y-1">
                <p className="text-xs font-medium text-foreground">{t("contracts.templates.variablesHelp")}</p>
                <div className="flex flex-wrap gap-1.5">
                  {TEMPLATE_VARIABLES.map((v) => (
                    <button key={v.key} type="button" onClick={() => insert(v.key)} title={VAR_KEYS[v.key] ? t(`contracts.vars.${VAR_KEYS[v.key]}`) : v.label} className="rounded-full border border-border bg-background px-2 py-0.5 font-mono text-xs text-foreground hover:bg-muted">
                      {`{{${v.key}}}`}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setForm(null)}>{t("common.cancel")}</Button>
            <Button
              disabled={save.isPending}
              onClick={() => {
                if (!form) return;
                const p = templateProblem(form);
                if (p) return toast.error(p);
                save.mutate(form);
              }}
            >
              {t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
