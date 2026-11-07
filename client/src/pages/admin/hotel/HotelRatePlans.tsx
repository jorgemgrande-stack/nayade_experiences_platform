import { useState } from "react";
import { trpc } from "@/lib/trpc";
import AdminLayout from "@/components/AdminLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Plus, Tag } from "lucide-react";
import { EmptyStep, PmsNotInstalled, eur, isPmsNotInstalled } from "./pmsShared";

function adjustLabel(p: { adjustType: string; adjustValue: number }) {
  if (p.adjustType === "percent") return `${p.adjustValue >= 0 ? "+" : ""}${(p.adjustValue / 100).toLocaleString("es-ES")} % por noche`;
  if (p.adjustType === "fixed") return `${p.adjustValue >= 0 ? "+" : "−"}${eur(Math.abs(p.adjustValue))} por noche`;
  return "Precio de la tarifa";
}

function PlanDialog({ roomTypes, edit, onClose }: { roomTypes: any[]; edit: any | null; onClose: () => void }) {
  const utils = trpc.useUtils();
  const [f, setF] = useState(() => ({
    roomTypeId: edit?.roomTypeId ?? roomTypes[0]?.id ?? 0, code: edit?.code ?? "", name: edit?.name ?? "", description: edit?.description ?? "",
    refundable: edit?.refundable ?? true, includesBreakfast: edit?.includesBreakfast ?? false, adjustType: edit?.adjustType ?? "none",
    value: edit ? String(edit.adjustType === "percent" ? edit.adjustValue / 100 : edit.adjustValue / 100) : "0", sortOrder: edit?.sortOrder ?? 0, isActive: edit?.isActive ?? true,
  }));
  const save = trpc.hotel.adminSaveRatePlan.useMutation({ onSuccess: () => { toast.success("Plan guardado"); void utils.hotel.adminListRatePlans.invalidate(); onClose(); }, onError: (e) => toast.error(e.message) });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{edit ? "Editar plan de tarifa" : "Nuevo plan de tarifa"}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 py-2">
          <div className="sm:col-span-2 space-y-1">
            <Label>Tipología</Label>
            <Select value={f.roomTypeId ? String(f.roomTypeId) : ""} onValueChange={(v) => setF({ ...f, roomTypeId: Number(v) })}>
              <SelectTrigger><SelectValue placeholder="Elige la tipología" /></SelectTrigger>
              <SelectContent>{roomTypes.map((t) => <SelectItem key={t.id} value={String(t.id)}>{t.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1"><Label>Nombre</Label><Input value={f.name} maxLength={120} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="No reembolsable" /></div>
          <div className="space-y-1"><Label>Código</Label><Input value={f.code} maxLength={32} onChange={(e) => setF({ ...f, code: e.target.value })} placeholder="NR" /></div>
          <div className="sm:col-span-2 space-y-1"><Label>Descripción</Label><Input value={f.description} maxLength={255} onChange={(e) => setF({ ...f, description: e.target.value })} /></div>
          <div className="space-y-1">
            <Label>Ajuste sobre la noche</Label>
            <Select value={f.adjustType} onValueChange={(v) => setF({ ...f, adjustType: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="none">Sin ajuste (BAR)</SelectItem><SelectItem value="percent">Porcentaje</SelectItem><SelectItem value="fixed">Importe por noche</SelectItem></SelectContent>
            </Select>
          </div>
          {f.adjustType !== "none" && <div className="space-y-1"><Label>{f.adjustType === "percent" ? "% (negativo = descuento)" : "€ por noche (negativo = descuento)"}</Label><Input inputMode="decimal" value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })} /></div>}
          <label className="flex items-center gap-2 text-sm"><Switch checked={f.refundable} onCheckedChange={(v) => setF({ ...f, refundable: v })} /> Reembolsable</label>
          <label className="flex items-center gap-2 text-sm"><Switch checked={f.includesBreakfast} onCheckedChange={(v) => setF({ ...f, includesBreakfast: v })} /> Incluye desayuno</label>
          <div className="space-y-1"><Label>Orden</Label><Input type="number" min={0} value={f.sortOrder} onChange={(e) => setF({ ...f, sortOrder: Math.max(0, parseInt(e.target.value) || 0) })} /></div>
          <label className="flex items-center gap-2 text-sm"><Switch checked={f.isActive} onCheckedChange={(v) => setF({ ...f, isActive: v })} /> Activo</label>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button disabled={save.isPending || !f.roomTypeId} onClick={() => {
            const n = Math.round(Number(f.value.replace(",", ".")) * 100);
            if (f.adjustType !== "none" && !Number.isFinite(n)) return toast.error("Ajuste no válido");
            save.mutate({ id: edit?.id, roomTypeId: f.roomTypeId, code: f.code.trim() || null, name: f.name.trim(), description: f.description.trim() || null, refundable: f.refundable, includesBreakfast: f.includesBreakfast, adjustType: f.adjustType as any, adjustValue: f.adjustType === "none" ? 0 : n, sortOrder: f.sortOrder, isActive: f.isActive });
          }}>Guardar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function HotelRatePlans() {
  const typesQ = trpc.hotel.adminGetRoomTypes.useQuery();
  const q = trpc.hotel.adminListRatePlans.useQuery(undefined, { retry: (n, e) => !isPmsNotInstalled(e) && n < 2 });
  const [edit, setEdit] = useState<any | null | undefined>(undefined);
  const types = typesQ.data ?? [];
  const plans = q.data ?? [];
  return (
    <AdminLayout title="Planes de tarifa">
      <div className="space-y-5 max-w-full">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold flex items-center gap-2"><Tag className="h-6 w-6 shrink-0" /> Planes de tarifa</h1>
            <p className="text-muted-foreground text-sm">Variantes de precio de cada tipología: tarifa flexible (BAR), no reembolsable, con desayuno… Se aplican sobre el precio de cada noche en la web y en recepción. Sin planes, el precio de siempre.</p>
          </div>
          <Button onClick={() => setEdit(null)} disabled={!types.length || isPmsNotInstalled(q.error)}><Plus className="h-4 w-4 mr-1" /> Nuevo plan</Button>
        </div>
        {isPmsNotInstalled(q.error) ? <PmsNotInstalled /> : !types.length && !typesQ.isLoading ? (
          <Card><CardContent className="p-0"><EmptyStep title="Crea primero una tipología" text="Los planes de tarifa son de cada tipología." href="/admin/hotel" action="Ir a tipologías" /></CardContent></Card>
        ) : plans.length === 0 && !q.isLoading ? (
          <Card><CardContent className="p-0"><EmptyStep title="Crea tu primer plan" text="Por ejemplo, «No reembolsable» con −10 % o «Con desayuno» con +12 € por noche." /><div className="flex justify-center pb-8"><Button onClick={() => setEdit(null)}><Plus className="h-4 w-4 mr-1" /> Nuevo plan</Button></div></CardContent></Card>
        ) : (
          types.filter((t: any) => plans.some((p) => p.roomTypeId === t.id)).map((t: any) => (
            <Card key={t.id}>
              <CardHeader className="pb-2"><CardTitle className="text-base">{t.name}</CardTitle></CardHeader>
              <CardContent className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
                {plans.filter((p) => p.roomTypeId === t.id).map((p) => (
                  <button key={p.id} type="button" onClick={() => setEdit(p)} className={`text-left rounded-lg border border-border p-3 hover:bg-muted/30 ${p.isActive ? "" : "opacity-60"}`}>
                    <div className="font-medium">{p.name}{p.code ? <span className="text-xs text-muted-foreground"> · {p.code}</span> : null}</div>
                    <div className="text-sm">{adjustLabel(p)}</div>
                    <div className="flex flex-wrap gap-1 mt-1">
                      <Badge variant="outline">{p.refundable ? "Reembolsable" : "No reembolsable"}</Badge>
                      {p.includesBreakfast && <Badge variant="outline">Desayuno</Badge>}
                      {!p.isActive && <Badge variant="secondary">Inactivo</Badge>}
                    </div>
                  </button>
                ))}
              </CardContent>
            </Card>
          ))
        )}
      </div>
      {edit !== undefined && <PlanDialog roomTypes={types} edit={edit} onClose={() => setEdit(undefined)} />}
    </AdminLayout>
  );
}
