/**
 * Contratos y firma electrónica · lista (/admin/contratos): contratos de la empresa por estado y búsqueda, y nuevo
 * contrato a partir de una plantilla para un cliente del CRM (opcionalmente enlazado a un presupuesto o una reserva).
 */
import { useState } from "react";
import { Link, useLocation } from "wouter";
import { FileSignature, Plus, Search } from "lucide-react";
import { toast } from "sonner";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PanelEmpty, PanelError, PanelLoading, toastError } from "@/components/admin/PanelStates";
import { FormField, selectClass } from "@/components/admin/crm/CrmParts";
import { cn } from "@/lib/utils";
import { CONTRACT_STATUSES, CONTRACT_STATUS_LABEL, ESIGN_PATHS, SIMPLE_SIGNATURE_NOTICE, type ContractStatus } from "@shared/contractsEsign";
import { PageHeader, StatusBadge, fmtDay, fmtEur, useEsignRole } from "./ContractsParts";

function NewContract({ onClose }: { onClose: () => void }) {
  const [, setLocation] = useLocation();
  const templates = trpc.contractsEsign.templates.useQuery();
  const [q, setQ] = useState("");
  const clients = trpc.contractsEsign.clients.useQuery({ q });
  const [templateId, setTemplateId] = useState<number | null>(null);
  const [clientId, setClientId] = useState<number | null>(null);
  const [amount, setAmount] = useState("");
  const [contractDate, setDate] = useState("");
  const [quoteId, setQuoteId] = useState("");
  const [reservationId, setReservationId] = useState("");
  const create = trpc.contractsEsign.create.useMutation({
    onSuccess: (r) => {
      if (r.missing.length) toast.warning(`Contrato creado. Faltan datos (${r.missing.join(", ")}): complétalos en el borrador.`);
      else toast.success("Contrato creado en borrador");
      setLocation(`${ESIGN_PATHS.contracts}/${r.id}`);
    },
    onError: (e) => toastError(e),
  });
  const list = templates.data ?? [];
  const optId = (v: string) => (v.trim() ? Number(v) : null);
  const submit = () => {
    if (!templateId) return toast.error("Elige una plantilla.");
    if (!clientId) return toast.error("Elige el cliente.");
    const a = amount.trim() ? Number(amount.replace(",", ".")) : null;
    if (a != null && (!Number.isFinite(a) || a < 0)) return toast.error("El importe no es válido.");
    create.mutate({ templateId, clientId, amount: a, contractDate: contractDate || null, quoteId: optId(quoteId), reservationId: optId(reservationId) });
  };
  return (
    <div className="space-y-3">
      {templates.isLoading ? (
        <PanelLoading label="Cargando las plantillas…" />
      ) : list.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Aún no hay plantillas activas. <Link href={ESIGN_PATHS.templates} className="text-primary underline">Crea una plantilla</Link> primero.
        </p>
      ) : (
        <FormField id="nc-tpl" label="Plantilla" required>
          <select id="nc-tpl" className={selectClass} value={templateId ?? ""} onChange={(e) => setTemplateId(e.target.value ? Number(e.target.value) : null)}>
            <option value="">Elige una plantilla</option>
            {list.map((t) => <option key={t.id} value={t.id}>{t.title} (v{t.version})</option>)}
          </select>
        </FormField>
      )}
      <FormField id="nc-q" label="Cliente del CRM" required hint="Busca por nombre, correo o DNI/NIF.">
        <Input id="nc-q" value={q} maxLength={100} onChange={(e) => setQ(e.target.value)} placeholder="Buscar cliente" />
      </FormField>
      <ul className="max-h-48 divide-y divide-border overflow-y-auto rounded-md border border-border" aria-label="Clientes">
        {(clients.data ?? []).map((c) => (
          <li key={c.id}>
            <button type="button" onClick={() => setClientId(c.id)} className={cn("w-full px-3 py-2 text-left text-sm hover:bg-muted/50", clientId === c.id && "bg-muted")} aria-pressed={clientId === c.id}>
              <span className="block break-words font-medium text-foreground">{c.name}</span>
              <span className="block break-words text-xs text-muted-foreground">{[c.email, c.nif, c.company].filter(Boolean).join(" · ") || "Sin datos de contacto"}</span>
            </button>
          </li>
        ))}
        {clients.data?.length === 0 && <li className="px-3 py-2 text-sm text-muted-foreground">No hay clientes con esa búsqueda.</li>}
      </ul>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <FormField id="nc-amount" label="Importe en euros (opcional)">
          <Input id="nc-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0,00" />
        </FormField>
        <FormField id="nc-date" label="Fecha del contrato" hint="Por defecto, hoy.">
          <Input id="nc-date" type="date" value={contractDate} onChange={(e) => setDate(e.target.value)} />
        </FormField>
        <FormField id="nc-quote" label="N.º interno de presupuesto (opcional)">
          <Input id="nc-quote" inputMode="numeric" value={quoteId} onChange={(e) => setQuoteId(e.target.value.replace(/\D/g, ""))} />
        </FormField>
        <FormField id="nc-res" label="N.º interno de reserva (opcional)">
          <Input id="nc-res" inputMode="numeric" value={reservationId} onChange={(e) => setReservationId(e.target.value.replace(/\D/g, ""))} />
        </FormField>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Cancelar</Button>
        <Button disabled={create.isPending || list.length === 0} onClick={submit}>Crear borrador</Button>
      </DialogFooter>
    </div>
  );
}

export default function ContractsList() {
  const { canWrite } = useEsignRole();
  const [status, setStatus] = useState<ContractStatus | "all">("all");
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);
  const list = trpc.contractsEsign.list.useQuery({ status: status === "all" ? undefined : status, q: q.trim() || undefined }, { retry: false });
  const newButton = canWrite ? <Button onClick={() => setCreating(true)}><Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />Nuevo contrato</Button> : undefined;
  return (
    <AdminLayout>
      <div className="mx-auto max-w-5xl space-y-5">
        <PageHeader
          title="Contratos y firma"
          description="Contratos a partir de tus plantillas para clientes del CRM. Se firman en el panel o con un enlace de un solo uso que recibe el cliente por correo."
          actions={newButton}
        />
        <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">{SIMPLE_SIGNATURE_NOTICE}</p>
        <div className="flex flex-wrap items-center gap-2">
          <div role="tablist" aria-label="Estado" className="inline-flex flex-wrap rounded-lg border border-border p-0.5">
            {(["all", ...CONTRACT_STATUSES] as const).map((s) => (
              <button key={s} role="tab" aria-selected={status === s} onClick={() => setStatus(s)} className={cn("rounded-md px-3 py-1.5 text-sm", status === s ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>
                {s === "all" ? "Todos" : CONTRACT_STATUS_LABEL[s]}
              </button>
            ))}
          </div>
          <div className="relative w-full sm:w-64">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <Input className="pl-8" value={q} maxLength={100} onChange={(e) => setQ(e.target.value)} placeholder="Cliente o título" aria-label="Buscar contratos" />
          </div>
        </div>
        {list.isLoading ? (
          <PanelLoading label="Cargando los contratos…" />
        ) : list.isError ? (
          <PanelError error={list.error} onRetry={() => list.refetch()} />
        ) : (list.data ?? []).length === 0 ? (
          <PanelEmpty icon={<FileSignature className="h-5 w-5" />} title="No hay contratos" description="Crea un contrato desde una plantilla y envíalo a firmar al cliente.">
            {newButton}
          </PanelEmpty>
        ) : (
          <ul className="divide-y divide-border rounded-xl border border-border bg-card">
            {(list.data ?? []).map((c) => (
              <li key={c.id}>
                <Link href={`${ESIGN_PATHS.contracts}/${c.id}`} className="flex w-full flex-wrap items-center justify-between gap-2 px-4 py-3 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <span className="min-w-0">
                    <span className="block break-words text-sm font-medium text-foreground">#{c.id} · {c.title}</span>
                    <span className="block break-words text-xs text-muted-foreground">
                      {c.customerName} · {fmtDay(c.contractDate)}{c.amount != null ? ` · ${fmtEur(c.amount)}` : ""}
                    </span>
                  </span>
                  <StatusBadge status={c.status} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Nuevo contrato</DialogTitle>
            <DialogDescription>Se crea en borrador con los datos del cliente ya puestos. Podrás revisarlo antes de enviarlo.</DialogDescription>
          </DialogHeader>
          {creating && <NewContract onClose={() => setCreating(false)} />}
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
