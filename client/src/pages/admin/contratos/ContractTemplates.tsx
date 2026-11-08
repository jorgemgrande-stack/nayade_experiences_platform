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
import { PageHeader, fmtMs, useEsignRole } from "./ContractsParts";

const EXAMPLE = "Entre {{empresa.nombre}} y {{cliente.nombre}} (DNI/NIF {{cliente.nif}}), en fecha {{fecha}}, se acuerda la prestación del servicio por un importe de {{importe}}.\n\n1. Objeto: …\n2. Condiciones: …";

export default function ContractTemplates() {
  const { isAdmin } = useEsignRole();
  const utils = trpc.useUtils();
  const list = trpc.contractsEsign.templates.useQuery({ includeInactive: true }, { retry: false });
  const [form, setForm] = useState<{ id?: number; title: string; body: string } | null>(null);
  const refresh = () => void utils.contractsEsign.templates.invalidate();
  const save = trpc.contractsEsign.saveTemplate.useMutation({ onSuccess: (t) => { toast.success(`Plantilla guardada (versión ${t.version})`); setForm(null); refresh(); }, onError: (e) => toastError(e) });
  const toggle = trpc.contractsEsign.setTemplateActive.useMutation({ onSuccess: () => refresh(), onError: (e) => toastError(e) });
  const insert = (key: string) => form && setForm({ ...form, body: `${form.body}{{${key}}}` });
  const newButton = isAdmin ? <Button onClick={() => setForm({ title: "", body: EXAMPLE })}><Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />Nueva plantilla</Button> : undefined;
  return (
    <AdminLayout>
      <div className="mx-auto max-w-5xl space-y-5">
        <PageHeader title="Plantillas de contrato" description="Textos base de tus contratos con variables que se rellenan con los datos del cliente del CRM al crear cada contrato." actions={newButton} />
        {list.isLoading ? (
          <PanelLoading label="Cargando las plantillas…" />
        ) : list.isError ? (
          <PanelError error={list.error} onRetry={() => list.refetch()} />
        ) : (list.data ?? []).length === 0 ? (
          <PanelEmpty icon={<FileText className="h-5 w-5" />} title="Aún no hay plantillas" description="Crea tu primera plantilla de contrato para empezar.">{newButton}</PanelEmpty>
        ) : (
          <ul className="space-y-2">
            {(list.data ?? []).map((t) => (
              <li key={t.id} className="flex min-w-0 flex-col gap-2 rounded-xl border border-border bg-card p-4 sm:flex-row sm:items-start">
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="min-w-0 break-words font-medium text-foreground">{t.title}</p>
                    <Badge variant="outline">v{t.version}</Badge>
                    {!t.isActive && <Badge variant="secondary">Desactivada</Badge>}
                  </div>
                  <p className="line-clamp-2 break-words text-xs text-muted-foreground">{t.body}</p>
                  <p className="text-xs text-muted-foreground">Actualizada el {fmtMs(t.updatedAt)}</p>
                </div>
                {isAdmin && (
                  <div className="flex flex-wrap gap-1.5">
                    <Button size="sm" variant="outline" onClick={() => setForm({ id: t.id, title: t.title, body: t.body })}><Pencil className="mr-1 h-4 w-4" aria-hidden="true" />Editar</Button>
                    <Button size="sm" variant="ghost" disabled={toggle.isPending} onClick={() => toggle.mutate({ id: t.id, active: !t.isActive })}>{t.isActive ? "Desactivar" : "Activar"}</Button>
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
            <DialogTitle>{form?.id ? "Editar plantilla" : "Nueva plantilla"}</DialogTitle>
            <DialogDescription>Al guardar un cambio sube la versión. Los contratos ya creados no cambian.</DialogDescription>
          </DialogHeader>
          {form && (
            <div className="space-y-3">
              <FormField id="tp-title" label="Título" required>
                <Input id="tp-title" value={form.title} maxLength={ESIGN_LIMITS.titleMax} onChange={(e) => setForm({ ...form, title: e.target.value })} />
              </FormField>
              <FormField id="tp-body" label="Texto del contrato" required>
                <Textarea id="tp-body" rows={14} value={form.body} maxLength={ESIGN_LIMITS.bodyMax} onChange={(e) => setForm({ ...form, body: e.target.value })} />
              </FormField>
              <div className="space-y-1">
                <p className="text-xs font-medium text-foreground">Variables (pulsa para añadirla al final)</p>
                <div className="flex flex-wrap gap-1.5">
                  {TEMPLATE_VARIABLES.map((v) => (
                    <button key={v.key} type="button" onClick={() => insert(v.key)} title={v.label} className="rounded-full border border-border bg-background px-2 py-0.5 font-mono text-xs text-foreground hover:bg-muted">
                      {`{{${v.key}}}`}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setForm(null)}>Cancelar</Button>
            <Button
              disabled={save.isPending}
              onClick={() => {
                if (!form) return;
                const p = templateProblem(form);
                if (p) return toast.error(p);
                save.mutate(form);
              }}
            >
              Guardar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
