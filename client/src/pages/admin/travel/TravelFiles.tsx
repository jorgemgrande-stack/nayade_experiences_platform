import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Link } from "wouter";
import AdminLayout from "@/components/AdminLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { ArrowLeft, Briefcase, FileText, Pencil, Plus, RefreshCw, Search, Send, Ticket, Trash2, Wand2 } from "lucide-react";
import {
  FILE_STATUS_LABEL, KINDS, KIND_LABEL, MODE_LABEL, OPERATION_STATUS_LABEL, QUOTE_STATUS_LABEL, RULE_SOURCE_LABEL, TravelEmpty, TravelNotInstalled,
  downloadBase64Pdf, eur, isTravelNotInstalled, operationClass, pct, toCents,
} from "./travelShared";
import { VeturisSearchDialog, useVeturisOffers } from "./TravelVeturis";

type ServiceForm = {
  kind: string; source: "proveedor" | "propio"; supplierId: number | null; title: string; description: string; serviceDate: string; endDate: string;
  quantity: number; pricingMode: "neto" | "comision" | "manual"; amount: string; net: string;
};

function ServiceDialog({ fileId, siteId, edit, onClose }: { fileId: number; siteId: string | null; edit: any | null; onClose: () => void }) {
  const utils = trpc.useUtils();
  const suppliersQ = trpc.travel.listSuppliers.useQuery();
  const [f, setF] = useState<ServiceForm>(() => edit
    ? {
        kind: edit.kind, source: edit.source, supplierId: edit.supplierId, title: edit.title, description: edit.description ?? "", serviceDate: edit.serviceDate ?? "",
        endDate: edit.endDate ?? "", quantity: edit.quantity, pricingMode: edit.pricingMode,
        amount: String((edit.pricingMode === "neto" ? edit.netCents : edit.sellingCents) / 100), net: String(edit.netCents / 100),
      }
    : { kind: "alojamiento", source: "proveedor", supplierId: null, title: "", description: "", serviceDate: "", endDate: "", quantity: 1, pricingMode: "neto", amount: "", net: "" });
  const mode = f.source === "propio" ? "manual" : f.pricingMode;
  const amountCents = toCents(f.amount || "0");
  const sim = trpc.travel.simulatePrice.useQuery(
    { supplierId: f.source === "propio" ? null : f.supplierId, siteId, mode, amountCents: Number.isFinite(amountCents) ? Math.max(0, amountCents) : 0, netCents: mode === "manual" ? Math.max(0, toCents(f.net || "0") || 0) : undefined },
    { enabled: Number.isFinite(amountCents) },
  );
  const done = (msg: string) => { toast.success(msg); void utils.travel.getFile.invalidate({ id: fileId }); void utils.travel.listFiles.invalidate(); onClose(); };
  const add = trpc.travel.addService.useMutation({ onSuccess: () => done("Servicio añadido"), onError: (e) => toast.error(e.message) });
  const upd = trpc.travel.updateService.useMutation({ onSuccess: () => done("Servicio actualizado"), onError: (e) => toast.error(e.message) });
  const set = (p: Partial<ServiceForm>) => setF((s) => ({ ...s, ...p }));

  function save() {
    if (f.title.trim().length < 2) return toast.error("Indica el servicio");
    if (f.source === "proveedor" && !f.supplierId) return toast.error("Elige el proveedor");
    if (!Number.isFinite(amountCents) || amountCents < 0) return toast.error("Importe no válido");
    const service = {
      kind: f.kind as any, source: f.source, supplierId: f.source === "propio" ? null : f.supplierId, title: f.title.trim(), description: f.description.trim() || null,
      serviceDate: f.serviceDate || null, endDate: f.endDate || null, quantity: f.quantity, pricingMode: mode, amountCents,
      netCents: mode === "manual" ? Math.max(0, toCents(f.net || "0") || 0) : undefined,
    };
    if (edit) upd.mutate({ fileId, serviceId: edit.id, service });
    else add.mutate({ fileId, service });
  }

  const amountLabel = mode === "neto" ? "Coste neto del proveedor (€)" : mode === "comision" ? "PVP fijado por el proveedor (€)" : "PVP (€)";
  const p = sim.data?.price;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{edit ? "Editar servicio" : "Nuevo servicio"}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 py-2">
          <div className="space-y-1">
            <Label>Tipo</Label>
            <Select value={f.kind} onValueChange={(v) => set({ kind: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{KINDS.map((k) => <SelectItem key={k} value={k}>{KIND_LABEL[k]}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Origen</Label>
            <Select value={f.source} onValueChange={(v) => set({ source: v as ServiceForm["source"] })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="proveedor">Proveedor</SelectItem><SelectItem value="propio">Inventario propio</SelectItem></SelectContent>
            </Select>
          </div>
          {f.source === "proveedor" && (
            <>
              <div className="space-y-1">
                <Label>Proveedor</Label>
                <Select value={f.supplierId ? String(f.supplierId) : ""} onValueChange={(v) => set({ supplierId: Number(v) })}>
                  <SelectTrigger><SelectValue placeholder={(suppliersQ.data ?? []).length ? "Elige el proveedor" : "Sin proveedores"} /></SelectTrigger>
                  <SelectContent>{(suppliersQ.data ?? []).filter((s) => s.isActive).map((s) => <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Precio</Label>
                <Select value={f.pricingMode} onValueChange={(v) => set({ pricingMode: v as ServiceForm["pricingMode"] })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{(["neto", "comision", "manual"] as const).map((m) => <SelectItem key={m} value={m}>{MODE_LABEL[m]}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </>
          )}
          <div className="sm:col-span-2 space-y-1"><Label>Servicio</Label><Input value={f.title} maxLength={200} onChange={(e) => set({ title: e.target.value })} placeholder="Hotel 3 noches en régimen de desayuno" /></div>
          <div className="space-y-1"><Label>Desde</Label><Input type="date" value={f.serviceDate} onChange={(e) => set({ serviceDate: e.target.value })} /></div>
          <div className="space-y-1"><Label>Hasta</Label><Input type="date" value={f.endDate} min={f.serviceDate || undefined} onChange={(e) => set({ endDate: e.target.value })} /></div>
          <div className="space-y-1"><Label>Cantidad</Label><Input type="number" min={1} value={f.quantity} onChange={(e) => set({ quantity: Math.max(1, parseInt(e.target.value) || 1) })} /></div>
          <div className="space-y-1"><Label>{amountLabel}</Label><Input inputMode="decimal" value={f.amount} onChange={(e) => set({ amount: e.target.value })} placeholder="0,00" /></div>
          {mode === "manual" && <div className="space-y-1"><Label>Coste (€)</Label><Input inputMode="decimal" value={f.net} onChange={(e) => set({ net: e.target.value })} placeholder="0,00" /></div>}
          <div className="sm:col-span-2 space-y-1"><Label>Descripción (sale en el bono)</Label><Textarea rows={2} maxLength={1000} value={f.description} onChange={(e) => set({ description: e.target.value })} /></div>
          {p && (
            <div className="sm:col-span-2 rounded-md border border-border bg-muted/40 p-3 text-sm grid grid-cols-2 sm:grid-cols-4 gap-2">
              <div><div className="text-xs text-muted-foreground">Coste</div><div className="font-medium">{eur(p.netCents)}</div></div>
              <div><div className="text-xs text-muted-foreground">PVP</div><div className="font-medium">{eur(p.sellingCents)}</div></div>
              <div><div className="text-xs text-muted-foreground">Margen</div><div className="font-medium">{eur(p.marginCents)} · {pct(p.marginBp)}</div></div>
              <div><div className="text-xs text-muted-foreground">Regla</div><div className="font-medium">{RULE_SOURCE_LABEL[p.ruleSource] ?? p.ruleSource}{p.markupBp != null ? ` · +${pct(p.markupBp)}` : p.commissionBp != null ? ` · ${pct(p.commissionBp)}` : ""}</div></div>
            </div>
          )}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={save} disabled={add.isPending || upd.isPending}>Guardar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FileDialog({ edit, onClose, onCreated }: { edit: any | null; onClose: () => void; onCreated?: (id: number) => void }) {
  const utils = trpc.useUtils();
  const [f, setF] = useState(() => ({
    title: edit?.title ?? "", clientName: edit?.clientName ?? "", clientEmail: edit?.clientEmail ?? "", clientPhone: edit?.clientPhone ?? "",
    startDate: edit?.startDate ?? "", endDate: edit?.endDate ?? "", adults: edit?.adults ?? 2, children: edit?.children ?? 0,
    fiscalRegime: (edit?.fiscalRegime ?? "reav") as "reav" | "general", tax: String((edit?.taxRateBp ?? 2100) / 100), notes: edit?.notes ?? "",
  }));
  const set = (p: Partial<typeof f>) => setF((s) => ({ ...s, ...p }));
  const create = trpc.travel.createFile.useMutation({ onSuccess: (r) => { toast.success(`Expediente ${r.fileNumber} creado`); void utils.travel.listFiles.invalidate(); onClose(); onCreated?.(r.id); }, onError: (e) => toast.error(e.message) });
  const update = trpc.travel.updateFile.useMutation({ onSuccess: () => { toast.success("Expediente actualizado"); void utils.travel.getFile.invalidate(); void utils.travel.listFiles.invalidate(); onClose(); }, onError: (e) => toast.error(e.message) });
  function save() {
    if (f.title.trim().length < 2) return toast.error("Indica el nombre del viaje");
    if (f.clientName.trim().length < 2) return toast.error("Indica el cliente");
    const payload = {
      title: f.title.trim(), clientName: f.clientName.trim(), clientEmail: f.clientEmail.trim() || null, clientPhone: f.clientPhone.trim() || null,
      startDate: f.startDate || null, endDate: f.endDate || null, adults: f.adults, children: f.children, fiscalRegime: f.fiscalRegime,
      taxRateBp: Math.round(Number(f.tax.replace(",", ".")) * 100) || 0, notes: f.notes.trim() || null,
    };
    if (edit) update.mutate({ id: edit.id, ...payload });
    else create.mutate(payload);
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{edit ? "Editar expediente" : "Nuevo expediente"}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 py-2">
          <div className="sm:col-span-2 space-y-1"><Label>Viaje o paquete</Label><Input value={f.title} maxLength={200} onChange={(e) => set({ title: e.target.value })} placeholder="Escapada de fin de semana" /></div>
          <div className="space-y-1"><Label>Cliente</Label><Input value={f.clientName} maxLength={200} onChange={(e) => set({ clientName: e.target.value })} /></div>
          <div className="space-y-1"><Label>Correo (para el presupuesto)</Label><Input type="email" value={f.clientEmail} onChange={(e) => set({ clientEmail: e.target.value })} /></div>
          <div className="space-y-1"><Label>Teléfono</Label><Input value={f.clientPhone} onChange={(e) => set({ clientPhone: e.target.value })} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><Label>Adultos</Label><Input type="number" min={0} value={f.adults} onChange={(e) => set({ adults: Math.max(0, parseInt(e.target.value) || 0) })} /></div>
            <div className="space-y-1"><Label>Niños</Label><Input type="number" min={0} value={f.children} onChange={(e) => set({ children: Math.max(0, parseInt(e.target.value) || 0) })} /></div>
          </div>
          <div className="space-y-1"><Label>Ida</Label><Input type="date" value={f.startDate} onChange={(e) => set({ startDate: e.target.value })} /></div>
          <div className="space-y-1"><Label>Vuelta</Label><Input type="date" value={f.endDate} min={f.startDate || undefined} onChange={(e) => set({ endDate: e.target.value })} /></div>
          <div className="space-y-1">
            <Label>Régimen fiscal</Label>
            <Select value={f.fiscalRegime} onValueChange={(v) => set({ fiscalRegime: v as "reav" | "general" })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="reav">REAV (agencia de viajes)</SelectItem><SelectItem value="general">General</SelectItem></SelectContent>
            </Select>
          </div>
          {f.fiscalRegime === "general" && <div className="space-y-1"><Label>IVA (%)</Label><Input inputMode="decimal" value={f.tax} onChange={(e) => set({ tax: e.target.value })} /></div>}
          <div className="sm:col-span-2 space-y-1"><Label>Notas</Label><Textarea rows={2} value={f.notes} onChange={(e) => set({ notes: e.target.value })} /></div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={save} disabled={create.isPending || update.isPending}>Guardar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FileDetail({ id, onBack }: { id: number; onBack: () => void }) {
  const utils = trpc.useUtils();
  const q = trpc.travel.getFile.useQuery({ id });
  const [serviceEdit, setServiceEdit] = useState<any | null | undefined>(undefined);
  const [editFile, setEditFile] = useState(false);
  const [veturisOpen, setVeturisOpen] = useState(false);
  const vt = useVeturisOffers(id);
  const refresh = () => { void utils.travel.getFile.invalidate({ id }); void utils.travel.listFiles.invalidate(); void utils.travel.listOperations.invalidate(); };
  const onError = (e: { message: string }) => toast.error(e.message);
  const genQuote = trpc.travel.generateQuote.useMutation({ onSuccess: (r) => { toast.success(r.updated ? `Presupuesto ${r.quoteNumber} actualizado` : `Presupuesto ${r.quoteNumber} creado`); refresh(); }, onError });
  const sendQuote = trpc.crm.quotes.send.useMutation({ onSuccess: () => { toast.success("Presupuesto enviado al cliente"); refresh(); }, onError });
  const convert = trpc.travel.convertToReservation.useMutation({ onSuccess: (r) => { toast.success(`Reserva creada · ${r.operations} operaciones con proveedores`); refresh(); }, onError });
  const removeSvc = trpc.travel.removeService.useMutation({ onSuccess: () => { toast.success("Servicio quitado"); refresh(); }, onError });
  const submitOp = trpc.travel.submitOperation.useMutation({ onSuccess: (r) => { toast.success(r.note); refresh(); }, onError });
  const voucher = trpc.travel.voucher.useMutation({ onSuccess: (r) => downloadBase64Pdf(r.fileName, r.base64), onError });
  const d = q.data;
  if (q.isLoading) return <div className="text-center py-12 text-muted-foreground"><RefreshCw className="h-5 w-5 animate-spin inline mr-2" /> Cargando…</div>;
  if (q.error) return isTravelNotInstalled(q.error) ? <TravelNotInstalled /> : <Card><CardContent className="p-6 text-sm text-destructive">{q.error.message}</CardContent></Card>;
  if (!d) return null;
  const f = d.file;
  const editable = !d.editBlocker;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Button variant="ghost" size="sm" onClick={onBack} className="-ml-2"><ArrowLeft className="h-4 w-4 mr-1" /> Expedientes</Button>
          <h2 className="text-xl font-bold">{f.title}</h2>
          <p className="text-sm text-muted-foreground">
            {f.fileNumber} · {f.clientName}{f.clientEmail ? ` · ${f.clientEmail}` : ""} · {f.adults} adulto{f.adults === 1 ? "" : "s"}{f.children ? ` · ${f.children} niño${f.children === 1 ? "" : "s"}` : ""}
            {f.startDate ? ` · ${f.startDate}${f.endDate ? ` → ${f.endDate}` : ""}` : ""} · {f.fiscalRegime === "reav" ? "REAV" : `General ${pct(f.taxRateBp)}`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <Badge variant="outline">{FILE_STATUS_LABEL[f.status] ?? f.status}</Badge>
          {f.status !== "cancelado" && <Button size="sm" variant="outline" onClick={() => setEditFile(true)}><Pencil className="h-4 w-4 mr-1" /> Datos</Button>}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card><CardContent className="p-3"><div className="text-xs text-muted-foreground">Coste</div><div className="text-lg font-bold">{eur(d.totals.netCents)}</div></CardContent></Card>
        <Card><CardContent className="p-3"><div className="text-xs text-muted-foreground">PVP</div><div className="text-lg font-bold">{eur(d.totals.sellingCents)}</div></CardContent></Card>
        <Card><CardContent className="p-3"><div className="text-xs text-muted-foreground">Margen</div><div className="text-lg font-bold">{eur(d.totals.marginCents)}</div><div className="text-xs text-muted-foreground">{pct(d.totals.marginBp)} del PVP</div></CardContent></Card>
        <Card><CardContent className="p-3"><div className="text-xs text-muted-foreground">Presupuesto</div><div className="text-lg font-bold">{d.quote ? d.quote.quoteNumber : "—"}</div><div className="text-xs text-muted-foreground">{d.quote ? QUOTE_STATUS_LABEL[d.quote.status] ?? d.quote.status : "Sin generar"}</div></CardContent></Card>
      </div>

      <Card>
        <CardHeader className="pb-2 flex flex-row items-center justify-between gap-2 space-y-0">
          <CardTitle className="text-base">Servicios</CardTitle>
          {editable && (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => setVeturisOpen(true)}><Search className="h-4 w-4 mr-1" /> Veturis</Button>
              <Button size="sm" onClick={() => setServiceEdit(null)}><Plus className="h-4 w-4 mr-1" /> Servicio</Button>
            </div>
          )}
        </CardHeader>
        <CardContent className="p-0">
          {d.services.length === 0 ? (
            <TravelEmpty title="Añade el primer servicio" text="Alojamiento, actividades, transporte o seguros de uno o varios proveedores, o de tu inventario propio.">
              {editable && <Button size="sm" onClick={() => setServiceEdit(null)}><Plus className="h-4 w-4 mr-1" /> Añadir servicio</Button>}
            </TravelEmpty>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[820px]">
                <thead className="border-b border-border bg-muted/40 text-left">
                  <tr><th className="p-2 font-medium">Servicio</th><th className="p-2 font-medium">Proveedor</th><th className="p-2 font-medium">Fechas</th><th className="p-2 font-medium text-right">Coste</th><th className="p-2 font-medium text-right">PVP</th><th className="p-2 font-medium">Regla</th><th className="p-2 font-medium">Operación</th><th className="p-2" /></tr>
                </thead>
                <tbody>
                  {d.services.map((s) => (
                    <tr key={s.id} className="border-b border-border last:border-0 align-top">
                      <td className="p-2"><div className="font-medium">{s.title}</div><div className="text-xs text-muted-foreground">{KIND_LABEL[s.kind] ?? s.kind} · {s.quantity} ud.{vt.byService.get(s.id) ? <> · <Badge variant="outline" className="ml-1">Veturis{vt.byService.get(s.id)!.environment === "test" ? " · pruebas" : ""}</Badge>{vt.byService.get(s.id)!.locator ? ` · ${vt.byService.get(s.id)!.locator}` : ""}</> : null}</div></td>
                      <td className="p-2">{s.source === "propio" ? <span className="text-muted-foreground">Propio</span> : s.supplierName ?? "—"}</td>
                      <td className="p-2 whitespace-nowrap text-xs">{s.serviceDate ?? "—"}{s.endDate && s.endDate !== s.serviceDate ? ` → ${s.endDate}` : ""}</td>
                      <td className="p-2 text-right whitespace-nowrap">{eur(s.netCents)}</td>
                      <td className="p-2 text-right whitespace-nowrap font-medium">{eur(s.sellingCents)}</td>
                      <td className="p-2 text-xs whitespace-nowrap">{RULE_SOURCE_LABEL[s.ruleSource ?? ""] ?? "—"}{s.markupBp != null ? ` +${pct(s.markupBp)}` : s.commissionBp != null ? ` ${pct(s.commissionBp)}` : ""}</td>
                      <td className="p-2">{s.operation ? <Badge variant="outline" className={operationClass(s.operation.status)}>{OPERATION_STATUS_LABEL[s.operation.status] ?? s.operation.status}</Badge> : <span className="text-xs text-muted-foreground">{s.source === "propio" ? "No aplica" : "—"}</span>}</td>
                      <td className="p-2 whitespace-nowrap text-right">
                        {vt.byService.get(s.id)?.status === "quoted" && <Button variant="ghost" size="sm" onClick={() => vt.revalidate.mutate({ serviceId: s.id })} disabled={vt.revalidate.isPending} title="Revalidar precio en Veturis"><RefreshCw className="h-4 w-4" /></Button>}
                        {editable && <Button variant="ghost" size="sm" onClick={() => setServiceEdit(s)} title="Editar"><Pencil className="h-4 w-4" /></Button>}
                        {editable && <Button variant="ghost" size="sm" onClick={() => removeSvc.mutate({ fileId: id, serviceId: s.id })} title="Quitar"><Trash2 className="h-4 w-4 text-destructive" /></Button>}
                        {s.operation?.status === "pending_submission" && <Button variant="ghost" size="sm" onClick={() => submitOp.mutate({ id: s.operation!.id })} disabled={submitOp.isPending} title="Enviar al proveedor"><Send className="h-4 w-4" /></Button>}
                        {(f.status === "reservado" || f.status === "cerrado") && (s.source === "propio" || s.operation?.status === "provider_confirmed" || s.operation?.status === "consolidated") && (
                          <Button variant="ghost" size="sm" onClick={() => voucher.mutate({ fileId: id, serviceId: s.id })} disabled={voucher.isPending} title="Descargar bono"><Ticket className="h-4 w-4" /></Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {d.editBlocker && <p className="p-3 text-xs text-muted-foreground border-t border-border">{d.editBlocker}</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><FileText className="h-4 w-4" /> Presupuesto y reserva</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">El presupuesto es el del CRM: una línea por servicio con su PVP (nunca el coste ni el margen). El cliente lo acepta y paga desde su enlace; al convertirlo nace la reserva y una operación por cada servicio de proveedor.</p>
          <div className="flex flex-wrap gap-2">
            {editable && f.status !== "cancelado" && (
              <Button size="sm" onClick={() => genQuote.mutate({ id })} disabled={genQuote.isPending || !d.services.length}><Wand2 className="h-4 w-4 mr-1" /> {d.quote ? "Actualizar presupuesto" : "Generar presupuesto"}</Button>
            )}
            {f.quoteId && d.quote && ["borrador", "enviado", "visualizado"].includes(d.quote.status) && (
              <Button size="sm" variant="secondary" onClick={() => sendQuote.mutate({ id: f.quoteId!, origin: window.location.origin })} disabled={sendQuote.isPending}><Send className="h-4 w-4 mr-1" /> {d.quote.status === "borrador" ? "Enviar al cliente" : "Reenviar"}</Button>
            )}
            {f.quoteId && <Button size="sm" variant="outline" asChild><Link href="/admin/crm/presupuestos">Ver en el CRM</Link></Button>}
            {!d.conversionBlocker && <Button size="sm" onClick={() => convert.mutate({ id })} disabled={convert.isPending}><Briefcase className="h-4 w-4 mr-1" /> Convertir en reserva</Button>}
          </div>
          {d.conversionBlocker && f.status !== "reservado" && <p className="text-xs text-muted-foreground">{d.conversionBlocker}</p>}
          {f.reservationId && <p className="text-sm">Reserva del Core n.º {f.reservationId}: gestiona el cobro desde <Link href="/admin/crm/reservas" className="underline">Reservas</Link> y las confirmaciones en <Link href="/admin/travel/operaciones" className="underline">Operaciones</Link>.</p>}
        </CardContent>
      </Card>

      {serviceEdit !== undefined && <ServiceDialog fileId={id} siteId={f.siteId} edit={serviceEdit} onClose={() => setServiceEdit(undefined)} />}
      {editFile && <FileDialog edit={f} onClose={() => setEditFile(false)} />}
      {veturisOpen && <VeturisSearchDialog file={{ id, startDate: f.startDate, endDate: f.endDate, adults: f.adults }} onClose={() => setVeturisOpen(false)} />}
    </div>
  );
}

export default function TravelFiles() {
  const [status, setStatus] = useState("all");
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<number | null>(() => {
    const v = Number(new URLSearchParams(window.location.search).get("id"));
    return Number.isInteger(v) && v > 0 ? v : null;
  });
  useEffect(() => {
    const url = new URL(window.location.href);
    if (selected) url.searchParams.set("id", String(selected));
    else url.searchParams.delete("id");
    window.history.replaceState(null, "", url.toString());
  }, [selected]);
  const q = trpc.travel.listFiles.useQuery({ status: status === "all" ? undefined : status, search: search.trim() || undefined }, { enabled: !selected, retry: (n, e) => !isTravelNotInstalled(e) && n < 2 });
  const list = q.data ?? [];

  return (
    <AdminLayout title="Expedientes">
      <div className="space-y-5 max-w-full">
        {selected ? (
          <FileDetail id={selected} onBack={() => setSelected(null)} />
        ) : (
          <>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h1 className="text-2xl font-bold flex items-center gap-2"><Briefcase className="h-6 w-6 shrink-0" /> Expedientes de viaje</h1>
                <p className="text-muted-foreground text-sm">Paquetes y viajes con servicios de varios proveedores: margen, presupuesto, reserva y bonos.</p>
              </div>
              <Button onClick={() => setCreating(true)} disabled={isTravelNotInstalled(q.error)}><Plus className="h-4 w-4 mr-1" /> Nuevo expediente</Button>
            </div>
            <div className="flex flex-wrap gap-2">
              <Input className="w-64" placeholder="Buscar por cliente, viaje o número" value={search} onChange={(e) => setSearch(e.target.value)} />
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  {Object.entries(FILE_STATUS_LABEL).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {isTravelNotInstalled(q.error) ? <TravelNotInstalled /> : (
              <Card>
                <CardContent className="p-0">
                  {q.isLoading ? <p className="p-6 text-sm text-muted-foreground">Cargando…</p> : list.length === 0 ? (
                    <TravelEmpty title="Crea tu primer expediente" text="Un expediente reúne el viaje de un cliente: sus servicios, el presupuesto y la reserva.">
                      <Button size="sm" onClick={() => setCreating(true)}><Plus className="h-4 w-4 mr-1" /> Nuevo expediente</Button>
                    </TravelEmpty>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm min-w-[720px]">
                        <thead className="border-b border-border bg-muted/40 text-left">
                          <tr><th className="p-3 font-medium">Expediente</th><th className="p-3 font-medium">Cliente</th><th className="p-3 font-medium">Fechas</th><th className="p-3 font-medium">Servicios</th><th className="p-3 font-medium text-right">PVP</th><th className="p-3 font-medium text-right">Margen</th><th className="p-3 font-medium">Estado</th></tr>
                        </thead>
                        <tbody>
                          {list.map((f) => (
                            <tr key={f.id} className="border-b border-border last:border-0 hover:bg-muted/20 cursor-pointer" onClick={() => setSelected(f.id)}>
                              <td className="p-3"><div className="font-medium">{f.title}</div><div className="text-xs text-muted-foreground font-mono">{f.fileNumber}</div></td>
                              <td className="p-3">{f.clientName}</td>
                              <td className="p-3 whitespace-nowrap text-xs">{f.startDate ?? "—"}{f.endDate ? ` → ${f.endDate}` : ""}</td>
                              <td className="p-3">{f.services}</td>
                              <td className="p-3 text-right whitespace-nowrap">{eur(f.sellingCents)}</td>
                              <td className="p-3 text-right whitespace-nowrap">{eur(f.sellingCents - f.netCents)}</td>
                              <td className="p-3"><Badge variant="outline">{FILE_STATUS_LABEL[f.status] ?? f.status}</Badge></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>
      {creating && <FileDialog edit={null} onClose={() => setCreating(false)} onCreated={(nid) => setSelected(nid)} />}
    </AdminLayout>
  );
}
