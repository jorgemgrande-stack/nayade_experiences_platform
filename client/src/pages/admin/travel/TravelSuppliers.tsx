import { useState } from "react";
import { trpc } from "@/lib/trpc";
import AdminLayout from "@/components/AdminLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Plus, Truck, Trash2, Users } from "lucide-react";
import { KINDS, KIND_LABEL, TravelEmpty, TravelNotInstalled, isTravelNotInstalled } from "./travelShared";

function KindsPicker({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {KINDS.map((k) => {
        const on = value.includes(k);
        return (
          <Button key={k} type="button" size="sm" variant={on ? "default" : "outline"} onClick={() => onChange(on ? value.filter((x) => x !== k) : [...value, k])}>{KIND_LABEL[k]}</Button>
        );
      })}
    </div>
  );
}

function NewSupplierDialog({ onClose }: { onClose: () => void }) {
  const utils = trpc.useUtils();
  const [f, setF] = useState({ fiscalName: "", commercialName: "", nif: "", email: "", phone: "", contactPerson: "", kinds: [] as string[] });
  const create = trpc.travel.createSupplier.useMutation({ onSuccess: () => { toast.success("Proveedor creado"); void utils.travel.listSuppliers.invalidate(); onClose(); }, onError: (e) => toast.error(e.message) });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Nuevo proveedor</DialogTitle></DialogHeader>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 py-2">
          <div className="sm:col-span-2 space-y-1"><Label>Razón social</Label><Input value={f.fiscalName} maxLength={256} onChange={(e) => setF({ ...f, fiscalName: e.target.value })} /></div>
          <div className="space-y-1"><Label>Nombre comercial</Label><Input value={f.commercialName} maxLength={256} onChange={(e) => setF({ ...f, commercialName: e.target.value })} /></div>
          <div className="space-y-1"><Label>NIF</Label><Input value={f.nif} maxLength={32} onChange={(e) => setF({ ...f, nif: e.target.value })} /></div>
          <div className="space-y-1"><Label>Correo de reservas</Label><Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></div>
          <div className="space-y-1"><Label>Teléfono</Label><Input value={f.phone} maxLength={32} onChange={(e) => setF({ ...f, phone: e.target.value })} /></div>
          <div className="sm:col-span-2 space-y-1"><Label>Persona de contacto</Label><Input value={f.contactPerson} maxLength={256} onChange={(e) => setF({ ...f, contactPerson: e.target.value })} /></div>
          <div className="sm:col-span-2 space-y-1"><Label>Servicios que presta</Label><KindsPicker value={f.kinds} onChange={(kinds) => setF({ ...f, kinds })} /></div>
          <p className="sm:col-span-2 text-xs text-muted-foreground">Se guarda como proveedor de la empresa (el mismo que usan liquidaciones y gastos). La gestión de reservas con él es manual: envío y confirmación se registran en Operaciones.</p>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button disabled={f.fiscalName.trim().length < 2 || create.isPending} onClick={() => create.mutate({
            fiscalName: f.fiscalName.trim(), commercialName: f.commercialName.trim() || null, nif: f.nif.trim() || null, email: f.email.trim() || null,
            phone: f.phone.trim() || null, contactPerson: f.contactPerson.trim() || null, serviceKinds: f.kinds as any,
          })}>Crear</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SupplierDialog({ s, onClose }: { s: any; onClose: () => void }) {
  const utils = trpc.useUtils();
  const contactsQ = trpc.travel.supplierContacts.useQuery({ supplierId: s.id });
  const [p, setP] = useState({ kinds: s.serviceKinds as string[], email: s.operationalEmail ?? "", phone: s.operationalPhone ?? "", notes: s.notes ?? "", isActive: s.isActive });
  const [c, setC] = useState({ name: "", role: "", email: "", phone: "", isPrimary: false });
  const refresh = () => { void utils.travel.listSuppliers.invalidate(); void utils.travel.supplierContacts.invalidate({ supplierId: s.id }); };
  const save = trpc.travel.saveSupplierProfile.useMutation({ onSuccess: () => { toast.success("Proveedor guardado"); refresh(); onClose(); }, onError: (e) => toast.error(e.message) });
  const add = trpc.travel.addSupplierContact.useMutation({ onSuccess: () => { toast.success("Contacto añadido"); setC({ name: "", role: "", email: "", phone: "", isPrimary: false }); refresh(); }, onError: (e) => toast.error(e.message) });
  const del = trpc.travel.removeSupplierContact.useMutation({ onSuccess: refresh, onError: (e) => toast.error(e.message) });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{s.name}</DialogTitle></DialogHeader>
        <div className="space-y-4 py-2">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1"><Label>Correo operativo</Label><Input type="email" value={p.email} onChange={(e) => setP({ ...p, email: e.target.value })} /></div>
            <div className="space-y-1"><Label>Teléfono operativo</Label><Input value={p.phone} onChange={(e) => setP({ ...p, phone: e.target.value })} /></div>
            <div className="sm:col-span-2 space-y-1"><Label>Servicios</Label><KindsPicker value={p.kinds} onChange={(kinds) => setP({ ...p, kinds })} /></div>
            <div className="sm:col-span-2 space-y-1"><Label>Notas</Label><Textarea rows={2} value={p.notes} onChange={(e) => setP({ ...p, notes: e.target.value })} /></div>
            <label className="flex items-center gap-2 text-sm"><Switch checked={p.isActive} onCheckedChange={(v) => setP({ ...p, isActive: v })} /> Disponible para nuevos expedientes</label>
            <div className="text-xs text-muted-foreground self-center">Conexión: manual</div>
          </div>
          <div className="space-y-2">
            <div className="text-sm font-semibold flex items-center gap-2"><Users className="h-4 w-4" /> Contactos</div>
            {(contactsQ.data ?? []).length === 0 && <p className="text-sm text-muted-foreground">Sin contactos. Añade al menos el de reservas.</p>}
            {(contactsQ.data ?? []).map((x) => (
              <div key={x.id} className="flex items-center justify-between gap-2 border-b border-border pb-1 text-sm">
                <div className="min-w-0"><span className="font-medium">{x.name}</span>{x.isPrimary && <Badge variant="secondary" className="ml-2">Principal</Badge>}<div className="text-xs text-muted-foreground">{[x.role, x.email, x.phone].filter(Boolean).join(" · ")}</div></div>
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => del.mutate({ id: x.id })} aria-label="Quitar"><Trash2 className="h-4 w-4 text-destructive" /></Button>
              </div>
            ))}
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 items-end">
              <Input placeholder="Nombre" value={c.name} onChange={(e) => setC({ ...c, name: e.target.value })} />
              <Input placeholder="Función" value={c.role} onChange={(e) => setC({ ...c, role: e.target.value })} />
              <Input placeholder="Correo" value={c.email} onChange={(e) => setC({ ...c, email: e.target.value })} />
              <Input placeholder="Teléfono" value={c.phone} onChange={(e) => setC({ ...c, phone: e.target.value })} />
            </div>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 text-sm"><Switch checked={c.isPrimary} onCheckedChange={(v) => setC({ ...c, isPrimary: v })} /> Principal</label>
              <Button size="sm" variant="outline" disabled={c.name.trim().length < 2 || add.isPending} onClick={() => add.mutate({ supplierId: s.id, name: c.name.trim(), role: c.role.trim() || null, email: c.email.trim() || null, phone: c.phone.trim() || null, isPrimary: c.isPrimary })}>Añadir contacto</Button>
            </div>
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>Cerrar</Button>
          <Button disabled={save.isPending} onClick={() => save.mutate({ supplierId: s.id, connectionMode: "manual", serviceKinds: p.kinds as any, operationalEmail: p.email.trim() || null, operationalPhone: p.phone.trim() || null, notes: p.notes.trim() || null, isActive: p.isActive })}>Guardar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function TravelSuppliers() {
  const q = trpc.travel.listSuppliers.useQuery(undefined, { retry: (n, e) => !isTravelNotInstalled(e) && n < 2 });
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState<any | null>(null);
  const [kind, setKind] = useState("all");
  const list = (q.data ?? []).filter((s) => kind === "all" || s.serviceKinds.includes(kind));
  return (
    <AdminLayout title="Proveedores turísticos">
      <div className="space-y-5 max-w-full">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold flex items-center gap-2"><Truck className="h-6 w-6 shrink-0" /> Proveedores</h1>
            <p className="text-muted-foreground text-sm">Hoteles, actividades, transporte y seguros con los que montas tus viajes. Son los proveedores de la empresa, con su perfil turístico.</p>
          </div>
          <Button onClick={() => setCreating(true)} disabled={isTravelNotInstalled(q.error)}><Plus className="h-4 w-4 mr-1" /> Nuevo proveedor</Button>
        </div>
        <Select value={kind} onValueChange={setKind}>
          <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="all">Todos los servicios</SelectItem>{KINDS.map((k) => <SelectItem key={k} value={k}>{KIND_LABEL[k]}</SelectItem>)}</SelectContent>
        </Select>
        {isTravelNotInstalled(q.error) ? <TravelNotInstalled /> : q.error ? <Card><CardContent className="p-6 text-sm text-destructive">{q.error.message}</CardContent></Card> : (
          <Card>
            <CardContent className="p-0">
              {q.isLoading ? <p className="p-6 text-sm text-muted-foreground">Cargando…</p> : list.length === 0 ? (
                <TravelEmpty title="Crea tu primer proveedor" text="Da de alta los proveedores con los que trabajas para añadir sus servicios a los expedientes.">
                  <Button size="sm" onClick={() => setCreating(true)}><Plus className="h-4 w-4 mr-1" /> Nuevo proveedor</Button>
                </TravelEmpty>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm min-w-[640px]">
                    <thead className="border-b border-border bg-muted/40 text-left"><tr><th className="p-3 font-medium">Proveedor</th><th className="p-3 font-medium">Servicios</th><th className="p-3 font-medium">Contacto</th><th className="p-3 font-medium">Contactos</th><th className="p-3 font-medium">Estado</th></tr></thead>
                    <tbody>
                      {list.map((s) => (
                        <tr key={s.id} className="border-b border-border last:border-0 hover:bg-muted/20 cursor-pointer" onClick={() => setOpen(s)}>
                          <td className="p-3"><div className="font-medium">{s.name}</div><div className="text-xs text-muted-foreground">{s.fiscalName}{s.nif ? ` · ${s.nif}` : ""}</div></td>
                          <td className="p-3 text-xs">{s.serviceKinds.length ? s.serviceKinds.map((k: string) => KIND_LABEL[k] ?? k).join(", ") : <span className="text-muted-foreground">Sin perfil turístico</span>}</td>
                          <td className="p-3 text-xs">{s.operationalEmail || s.email || "—"}{(s.operationalPhone || s.phone) ? ` · ${s.operationalPhone || s.phone}` : ""}</td>
                          <td className="p-3">{s.contacts}</td>
                          <td className="p-3"><Badge variant={s.isActive ? "secondary" : "outline"}>{s.isActive ? "Activo" : "Inactivo"}</Badge></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
      {creating && <NewSupplierDialog onClose={() => setCreating(false)} />}
      {open && <SupplierDialog s={open} onClose={() => setOpen(null)} />}
    </AdminLayout>
  );
}
