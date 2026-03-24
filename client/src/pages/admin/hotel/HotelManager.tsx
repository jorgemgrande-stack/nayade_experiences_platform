import { useState } from "react";
import { trpc } from "@/lib/trpc";
import AdminLayout from "@/components/AdminLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import ImageUploader from "@/components/ImageUploader";
import {
  BedDouble, Plus, Pencil, Trash2, Eye, EyeOff, Star,
  Users, Baby, Maximize2, ChevronLeft, ChevronRight, RefreshCw,
} from "lucide-react";
import SupplierSelect from "@/components/SupplierSelect";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

// ─── Helpers ──────────────────────────────────────────────────────────────────
function slugify(s: string) {
  return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

// ─── Room Form Dialog ─────────────────────────────────────────────────────────
interface RoomFormData {
  name: string; slug: string; shortDescription: string; description: string;
  basePrice: string; maxAdults: number; maxChildren: number; surfaceM2: string;
  totalUnits: number; coverImageUrl: string; image1: string; image2: string;
  image3: string; amenities: string; isFeatured: boolean; isActive: boolean;
  discountPercent: string; discountLabel: string; discountExpiresAt: string;
  fiscalRegime: string; productType: string; providerPercent: string; agencyMarginPercent: string;
  supplierId: number | null; supplierCommissionPercent: string;
  supplierCostType: string; settlementFrequency: string; isSettlable: boolean;
}
const EMPTY_ROOM: RoomFormData = {
  name: "", slug: "", shortDescription: "", description: "", basePrice: "",
  maxAdults: 2, maxChildren: 2, surfaceM2: "", totalUnits: 1,
  coverImageUrl: "", image1: "", image2: "", image3: "",
  amenities: "", isFeatured: false, isActive: true,
  discountPercent: "", discountLabel: "", discountExpiresAt: "",
  fiscalRegime: "general_21", productType: "own", providerPercent: "", agencyMarginPercent: "",
  supplierId: null, supplierCommissionPercent: "", supplierCostType: "comision_sobre_venta",
  settlementFrequency: "manual", isSettlable: false,
};

function RoomFormDialog({ open, onClose, editRoom }: {
  open: boolean; onClose: () => void; editRoom?: any;
}) {
  const utils = trpc.useUtils();
  const [form, setForm] = useState<RoomFormData>(() =>
    editRoom ? {
      name: editRoom.name ?? "", slug: editRoom.slug ?? "",
      shortDescription: editRoom.shortDescription ?? "", description: editRoom.description ?? "",
      basePrice: editRoom.basePrice ?? "", maxAdults: editRoom.maxAdults ?? 2,
      maxChildren: editRoom.maxChildren ?? 2,
      surfaceM2: editRoom.surfaceM2 != null ? String(editRoom.surfaceM2) : "",
      totalUnits: editRoom.totalUnits ?? 1, coverImageUrl: editRoom.coverImageUrl ?? "",
      image1: editRoom.image1 ?? "", image2: editRoom.image2 ?? "", image3: editRoom.image3 ?? "",
      amenities: Array.isArray(editRoom.amenities) ? editRoom.amenities.join(", ") : "",
      isFeatured: editRoom.isFeatured ?? false, isActive: editRoom.isActive ?? true,
      discountPercent: editRoom.discountPercent != null ? String(editRoom.discountPercent) : "",
      discountLabel: editRoom.discountLabel ?? "",
      discountExpiresAt: editRoom.discountExpiresAt ? new Date(editRoom.discountExpiresAt).toISOString().slice(0, 10) : "",
      fiscalRegime: editRoom.fiscalRegime ?? "general_21",
      productType: editRoom.productType ?? "own",
      providerPercent: editRoom.providerPercent != null ? String(editRoom.providerPercent) : "",
      agencyMarginPercent: editRoom.agencyMarginPercent != null ? String(editRoom.agencyMarginPercent) : "",
      supplierId: editRoom.supplierId ?? null,
      supplierCommissionPercent: editRoom.supplierCommissionPercent != null ? String(editRoom.supplierCommissionPercent) : "",
      supplierCostType: editRoom.supplierCostType ?? "comision_sobre_venta",
      settlementFrequency: editRoom.settlementFrequency ?? "manual",
      isSettlable: editRoom.isSettlable ?? false,
    } : { ...EMPTY_ROOM }
  );

  const createMut = trpc.hotel.adminCreateRoomType.useMutation({
    onSuccess: () => { utils.hotel.adminGetRoomTypes.invalidate(); toast.success("Tipología creada"); onClose(); },
    onError: (e: any) => toast.error("Error", { description: e.message }),
  });
  const updateMut = trpc.hotel.adminUpdateRoomType.useMutation({
    onSuccess: () => { utils.hotel.adminGetRoomTypes.invalidate(); toast.success("Tipología actualizada"); onClose(); },
    onError: (e: any) => toast.error("Error", { description: e.message }),
  });

  function buildPayload() {
    return {
      name: form.name, slug: form.slug || slugify(form.name),
      shortDescription: form.shortDescription || undefined,
      description: form.description || undefined,
      basePrice: form.basePrice, maxAdults: form.maxAdults, maxChildren: form.maxChildren,
      surfaceM2: form.surfaceM2 ? parseInt(form.surfaceM2) : undefined,
      totalUnits: form.totalUnits,
      coverImageUrl: form.coverImageUrl || undefined,
      image1: form.image1 || undefined, image2: form.image2 || undefined, image3: form.image3 || undefined,
      amenities: form.amenities ? form.amenities.split(",").map(s => s.trim()).filter(Boolean) : [],
      isFeatured: form.isFeatured, isActive: form.isActive,
      discountPercent: form.discountPercent || undefined,
      discountLabel: form.discountLabel || undefined,
      discountExpiresAt: form.discountExpiresAt || undefined,
      fiscalRegime: form.fiscalRegime as "reav" | "general_21" | "mixed",
      productType: form.productType as "own" | "semi_own" | "third_party",
      providerPercent: form.providerPercent || undefined,
      agencyMarginPercent: form.agencyMarginPercent || undefined,
      supplierId: form.supplierId ?? undefined,
      supplierCommissionPercent: form.supplierCommissionPercent || undefined,
      supplierCostType: form.supplierCostType as "comision_sobre_venta" | "coste_fijo" | "porcentaje_margen" | "hibrido",
      settlementFrequency: form.settlementFrequency as "semanal" | "quincenal" | "mensual" | "manual",
      isSettlable: form.isSettlable,
    };
  }

  function handleSubmit() {
    if (editRoom) updateMut.mutate({ id: editRoom.id, ...buildPayload() });
    else createMut.mutate(buildPayload());
  }

  const isLoading = createMut.isPending || updateMut.isPending;

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editRoom ? "Editar tipología" : "Nueva tipología"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Nombre *</Label>
              <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value, slug: slugify(e.target.value) }))} placeholder="Suite Junior" />
            </div>
            <div>
              <Label>Slug (URL)</Label>
              <Input value={form.slug} onChange={e => setForm(f => ({ ...f, slug: e.target.value }))} placeholder="suite-junior" />
            </div>
          </div>
          <div>
            <Label>Descripción corta</Label>
            <Input value={form.shortDescription} onChange={e => setForm(f => ({ ...f, shortDescription: e.target.value }))} placeholder="Breve descripción para las tarjetas" />
          </div>
          <div>
            <Label>Descripción completa</Label>
            <Textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={4} />
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <Label>Precio base (€/noche) *</Label>
              <Input type="number" value={form.basePrice} onChange={e => setForm(f => ({ ...f, basePrice: e.target.value }))} placeholder="120" />
            </div>
            <div>
              <Label>Máx. adultos</Label>
              <Input type="number" min={1} value={form.maxAdults} onChange={e => setForm(f => ({ ...f, maxAdults: parseInt(e.target.value) || 1 }))} />
            </div>
            <div>
              <Label>Máx. niños</Label>
              <Input type="number" min={0} value={form.maxChildren} onChange={e => setForm(f => ({ ...f, maxChildren: parseInt(e.target.value) || 0 }))} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Superficie (m²)</Label>
              <Input type="number" value={form.surfaceM2} onChange={e => setForm(f => ({ ...f, surfaceM2: e.target.value }))} placeholder="28" />
            </div>
            <div>
              <Label>Unidades totales</Label>
              <Input type="number" min={1} value={form.totalUnits} onChange={e => setForm(f => ({ ...f, totalUnits: parseInt(e.target.value) || 1 }))} />
            </div>
          </div>
          <div>
            <Label>Imagen de portada</Label>
            <ImageUploader value={form.coverImageUrl} onChange={url => setForm(f => ({ ...f, coverImageUrl: url }))} />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div><Label>Imagen 2</Label><ImageUploader value={form.image1} onChange={url => setForm(f => ({ ...f, image1: url }))} /></div>
            <div><Label>Imagen 3</Label><ImageUploader value={form.image2} onChange={url => setForm(f => ({ ...f, image2: url }))} /></div>
            <div><Label>Imagen 4</Label><ImageUploader value={form.image3} onChange={url => setForm(f => ({ ...f, image3: url }))} /></div>
          </div>
          <div>
            <Label>Servicios incluidos (separados por coma)</Label>
            <Input value={form.amenities} onChange={e => setForm(f => ({ ...f, amenities: e.target.value }))} placeholder="WiFi, Desayuno, TV, Minibar..." />
          </div>
          {/* Descuento promocional */}
          <div className="border rounded-lg p-4 space-y-3 bg-amber-50 dark:bg-amber-950/20">
            <h4 className="font-semibold text-sm text-amber-700 dark:text-amber-400">Descuento promocional</h4>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label>Descuento (%)</Label>
                <Input type="number" min={0} max={100} step={0.01} value={form.discountPercent}
                  onChange={e => setForm(f => ({ ...f, discountPercent: e.target.value }))} placeholder="0" />
              </div>
              <div>
                <Label>Etiqueta</Label>
                <Input value={form.discountLabel} onChange={e => setForm(f => ({ ...f, discountLabel: e.target.value }))}
                  placeholder="Oferta primavera" />
              </div>
              <div>
                <Label>Expira el</Label>
                <Input type="date" value={form.discountExpiresAt}
                  onChange={e => setForm(f => ({ ...f, discountExpiresAt: e.target.value }))} />
              </div>
            </div>
          </div>
          {/* Régimen fiscal */}
          <div className="border rounded-lg p-4 space-y-3 bg-blue-50 dark:bg-blue-950/20">
            <h4 className="font-semibold text-sm text-blue-700 dark:text-blue-400">Régimen fiscal</h4>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Régimen</Label>
                <Select value={form.fiscalRegime} onValueChange={v => setForm(f => ({ ...f, fiscalRegime: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="general_21">General 21%</SelectItem>
                    <SelectItem value="reav">REAV (agencia viajes)</SelectItem>
                    <SelectItem value="mixed">Mixto</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Tipo de producto</Label>
                <Select value={form.productType} onValueChange={v => setForm(f => ({ ...f, productType: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="own">Propio</SelectItem>
                    <SelectItem value="semi_own">Semi-propio</SelectItem>
                    <SelectItem value="third_party">Tercero</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>% Proveedor</Label>
                <Input type="number" min={0} max={100} step={0.01} value={form.providerPercent}
                  onChange={e => setForm(f => ({ ...f, providerPercent: e.target.value }))} placeholder="0" />
              </div>
              <div>
                <Label>% Margen agencia</Label>
                <Input type="number" min={0} max={100} step={0.01} value={form.agencyMarginPercent}
                  onChange={e => setForm(f => ({ ...f, agencyMarginPercent: e.target.value }))} placeholder="0" />
              </div>
            </div>
          </div>
          {/* Proveedor y liquidaciones */}
          <div className="border rounded-lg p-4 space-y-3 bg-violet-50 dark:bg-violet-950/20">
            <h4 className="font-semibold text-sm text-violet-700 dark:text-violet-400">Proveedor y liquidaciones</h4>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <Label>Proveedor</Label>
                <SupplierSelect value={form.supplierId} onChange={v => setForm(f => ({ ...f, supplierId: v }))} />
              </div>
              <div>
                <Label>Comisión proveedor (%)</Label>
                <Input type="number" min={0} max={100} step={0.01} value={form.supplierCommissionPercent}
                  onChange={e => setForm(f => ({ ...f, supplierCommissionPercent: e.target.value }))} placeholder="0" />
              </div>
              <div>
                <Label>Tipo de coste</Label>
                <Select value={form.supplierCostType} onValueChange={v => setForm(f => ({ ...f, supplierCostType: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="comision_sobre_venta">Comisión sobre venta</SelectItem>
                    <SelectItem value="coste_fijo">Coste fijo</SelectItem>
                    <SelectItem value="porcentaje_margen">% Margen</SelectItem>
                    <SelectItem value="hibrido">Híbrido</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Frecuencia de liquidación</Label>
                <Select value={form.settlementFrequency} onValueChange={v => setForm(f => ({ ...f, settlementFrequency: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="semanal">Semanal</SelectItem>
                    <SelectItem value="quincenal">Quincenal</SelectItem>
                    <SelectItem value="mensual">Mensual</SelectItem>
                    <SelectItem value="manual">Manual</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-2 pt-5">
                <Switch checked={form.isSettlable} onCheckedChange={v => setForm(f => ({ ...f, isSettlable: v }))} />
                <Label>Liquidable con proveedor</Label>
              </div>
            </div>
          </div>
          <div className="flex gap-6">
            <div className="flex items-center gap-2">
              <Switch checked={form.isFeatured} onCheckedChange={v => setForm(f => ({ ...f, isFeatured: v }))} />
              <Label>Destacado</Label>
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={form.isActive} onCheckedChange={v => setForm(f => ({ ...f, isActive: v }))} />
              <Label>Activo</Label>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={handleSubmit} disabled={isLoading || !form.name || !form.basePrice}>
            {isLoading ? "Guardando..." : editRoom ? "Guardar cambios" : "Crear tipología"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Inventory Calendar ───────────────────────────────────────────────────────
function InventoryCalendar({ rooms }: { rooms: any[] }) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [selectedRoom, setSelectedRoom] = useState<number | null>(rooms[0]?.id ?? null);
  const [editCell, setEditCell] = useState<{ date: string; available: number; price: string } | null>(null);
  const utils = trpc.useUtils();

  const { data: calendar, isLoading } = trpc.hotel.adminGetCalendar.useQuery(
    { roomTypeId: selectedRoom!, year, month },
    { enabled: !!selectedRoom }
  );

  const updateMut = trpc.hotel.adminUpsertBlock.useMutation({
    onSuccess: () => { utils.hotel.adminGetCalendar.invalidate(); toast.success("Actualizado"); setEditCell(null); },
    onError: (e: any) => toast.error("Error", { description: e.message }),
  });

  const monthName = new Date(year, month - 1, 1).toLocaleString("es-ES", { month: "long", year: "numeric" });
  const daysInMonth = new Date(year, month, 0).getDate();
  const firstDow = new Date(year, month - 1, 1).getDay();
  const DAYS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

  function prevMonth() { if (month === 1) { setMonth(12); setYear(y => y - 1); } else setMonth(m => m - 1); }
  function nextMonth() { if (month === 12) { setMonth(1); setYear(y => y + 1); } else setMonth(m => m + 1); }

  const dayMap = new Map((calendar ?? []).map((d: any) => [d.date, d]));
  const blanks = Array(firstDow).fill(null);
  const currentRoom = rooms.find(r => r.id === selectedRoom);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 items-center">
        <span className="text-sm font-medium">Tipología:</span>
        {rooms.map(r => (
          <button
            key={r.id}
            onClick={() => setSelectedRoom(r.id)}
            className={`px-3 py-1 rounded-full text-sm transition-colors ${selectedRoom === r.id ? "bg-primary text-white" : "bg-muted hover:bg-muted/80"}`}
          >
            {r.name}
          </button>
        ))}
      </div>
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <button onClick={prevMonth} className="p-2 rounded-lg hover:bg-muted"><ChevronLeft className="h-4 w-4" /></button>
            <CardTitle className="capitalize text-base">{monthName}</CardTitle>
            <button onClick={nextMonth} className="p-2 rounded-lg hover:bg-muted"><ChevronRight className="h-4 w-4" /></button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-7 gap-1 mb-2">
            {DAYS.map(d => <div key={d} className="text-center text-xs text-muted-foreground font-medium py-1">{d}</div>)}
          </div>
          {isLoading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <RefreshCw className="h-5 w-5 animate-spin mr-2" /> Cargando...
            </div>
          ) : (
            <div className="grid grid-cols-7 gap-1">
              {blanks.map((_, i) => <div key={`b${i}`} />)}
              {Array.from({ length: daysInMonth }, (_, i) => {
                const d = i + 1;
                const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
                const cell = dayMap.get(dateStr) as any;
                const total = currentRoom?.totalUnits ?? 0;
                const avail = cell?.availableUnits ?? total;
                const price = cell?.priceOverride ?? null;
                const pct = total > 0 ? avail / total : 1;
                const bgClass = avail === 0
                  ? "bg-red-100 border-red-300 dark:bg-red-900/30 dark:border-red-700"
                  : pct < 0.4
                    ? "bg-amber-50 border-amber-300 dark:bg-amber-900/20 dark:border-amber-700"
                    : "bg-emerald-50 border-emerald-200 dark:bg-emerald-900/20 dark:border-emerald-700";

                return (
                  <button
                    key={dateStr}
                    onClick={() => setEditCell({ date: dateStr, available: avail, price: price ? String(price) : "" })}
                    className={`rounded-lg p-1.5 text-center border transition-all hover:scale-105 ${bgClass}`}
                  >
                    <div className="text-xs font-medium">{d}</div>
                    <div className={`text-xs font-bold ${avail === 0 ? "text-red-600 dark:text-red-400" : "text-slate-600 dark:text-slate-300"}`}>
                      {avail}/{total}
                    </div>
                    {price && <div className="text-xs text-blue-600 dark:text-blue-400">{parseFloat(price).toFixed(0)}€</div>}
                  </button>
                );
              })}
            </div>
          )}
          <div className="flex gap-4 mt-4 justify-center text-xs text-muted-foreground">
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-emerald-200 dark:bg-emerald-900 inline-block" /> Disponible</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-amber-200 dark:bg-amber-900 inline-block" /> Pocas plazas</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-red-200 dark:bg-red-900 inline-block" /> Completo</span>
          </div>
        </CardContent>
      </Card>

      {editCell && (
        <Dialog open onOpenChange={() => setEditCell(null)}>
          <DialogContent className="max-w-sm">
            <DialogHeader><DialogTitle>Editar inventario — {editCell.date}</DialogTitle></DialogHeader>
            <div className="space-y-4 py-2">
              <div>
                <Label>Unidades disponibles</Label>
                <Input type="number" min={0} value={editCell.available}
                  onChange={e => setEditCell(c => c ? { ...c, available: parseInt(e.target.value) || 0 } : null)} />
              </div>
              <div>
                <Label>Precio especial (€/noche, vacío = precio base)</Label>
                <Input type="number" value={editCell.price}
                  onChange={e => setEditCell(c => c ? { ...c, price: e.target.value } : null)}
                  placeholder="Dejar vacío para precio base" />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditCell(null)}>Cancelar</Button>
              <Button
                onClick={() => updateMut.mutate({
                  roomTypeId: selectedRoom!,
                  date: editCell.date,
                  availableUnits: editCell.available,
                  reason: editCell.price ? `precio:${editCell.price}` : undefined,
                })}
                disabled={updateMut.isPending}
              >
                {updateMut.isPending ? "Guardando..." : "Guardar"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

// ─── Rate Seasons Tab ─────────────────────────────────────────────────────────
function RateSeasonsTab() {
  const utils = trpc.useUtils();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: "", dateFrom: "", dateTo: "", multiplier: "1.00" });

  const { data: seasons, isLoading } = trpc.hotel.adminGetRateSeasons.useQuery();

  const createMut = trpc.hotel.adminCreateRateSeason.useMutation({
    onSuccess: () => { utils.hotel.adminGetRateSeasons.invalidate(); toast.success("Temporada creada"); setShowForm(false); },
    onError: (e: any) => toast.error("Error", { description: e.message }),
  });
  const deleteMut = trpc.hotel.adminDeleteRateSeason.useMutation({
    onSuccess: () => utils.hotel.adminGetRateSeasons.invalidate(),
  });

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setShowForm(true)}>
          <Plus className="h-4 w-4 mr-1" /> Nueva temporada
        </Button>
      </div>

      {showForm && (
        <Card>
          <CardHeader><CardTitle className="text-base">Nueva temporada de precios</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Nombre</Label>
                <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Temporada alta" />
              </div>
              <div>
                <Label>Multiplicador de precio</Label>
                <Input type="number" step="0.01" value={form.multiplier} onChange={e => setForm(f => ({ ...f, multiplier: e.target.value }))} placeholder="1.20 = +20%" />
              </div>
              <div>
                <Label>Desde</Label>
                <Input type="date" value={form.dateFrom} onChange={e => setForm(f => ({ ...f, dateFrom: e.target.value }))} />
              </div>
              <div>
                <Label>Hasta</Label>
                <Input type="date" value={form.dateTo} onChange={e => setForm(f => ({ ...f, dateTo: e.target.value }))} />
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setShowForm(false)}>Cancelar</Button>
              <Button
                onClick={() => createMut.mutate({ name: form.name, startDate: form.dateFrom, endDate: form.dateTo })}
                disabled={createMut.isPending || !form.name}
              >
                {createMut.isPending ? "Creando..." : "Crear temporada"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <div className="text-center py-8 text-muted-foreground">Cargando...</div>
      ) : (seasons ?? []).length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">No hay temporadas configuradas.</div>
      ) : (
        <div className="space-y-2">
          {(seasons ?? []).map((s: any) => (
            <Card key={s.id}>
              <CardContent className="p-4 flex items-center justify-between">
                <div>
                  <div className="font-medium">{s.name}</div>
                  <div className="text-sm text-muted-foreground">
                    {s.dateFrom} → {s.dateTo} · Multiplicador: ×{parseFloat(s.multiplier).toFixed(2)}
                  </div>
                </div>
                <Button variant="ghost" size="sm" onClick={() => deleteMut.mutate({ id: s.id })} className="text-red-500 hover:text-red-700">
                  <Trash2 className="h-4 w-4" />
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function HotelManager() {
  const { data: rooms, isLoading } = trpc.hotel.adminGetRoomTypes.useQuery();
  const [showForm, setShowForm] = useState(false);
  const [editRoom, setEditRoom] = useState<any>(null);
  const utils = trpc.useUtils();

  const toggleMut = trpc.hotel.adminToggleRoomTypeActive.useMutation({
    onSuccess: () => utils.hotel.adminGetRoomTypes.invalidate(),
    onError: (e: any) => toast.error("Error", { description: e.message }),
  });
  const deleteMut = trpc.hotel.adminDeleteRoomType.useMutation({
    onSuccess: () => { utils.hotel.adminGetRoomTypes.invalidate(); toast.success("Tipología eliminada"); },
    onError: (e: any) => toast.error("Error", { description: e.message }),
  });

  return (
    <AdminLayout title="Hotel Náyade">
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Hotel Náyade</h1>
          <p className="text-muted-foreground text-sm">Gestiona tipologías, tarifas e inventario</p>
        </div>
        <Button onClick={() => { setEditRoom(null); setShowForm(true); }}>
          <Plus className="h-4 w-4 mr-2" /> Nueva tipología
        </Button>
      </div>

      <Tabs defaultValue="rooms">
        <TabsList>
          <TabsTrigger value="rooms">Tipologías</TabsTrigger>
          <TabsTrigger value="inventory">Inventario / Calendario</TabsTrigger>
          <TabsTrigger value="rates">Temporadas de precio</TabsTrigger>
        </TabsList>

        {/* ── Rooms ── */}
        <TabsContent value="rooms" className="mt-4">
          {isLoading ? (
            <div className="text-center py-12 text-muted-foreground">Cargando...</div>
          ) : (rooms ?? []).length === 0 ? (
            <div className="text-center py-16 text-muted-foreground">
              <BedDouble className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p>No hay tipologías. Crea la primera.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {(rooms ?? []).map((room: any) => (
                <Card key={room.id} className={`overflow-hidden ${!room.isActive ? "opacity-60" : ""}`}>
                  <div className="relative h-40 bg-muted">
                    {room.coverImageUrl ? (
                      <img src={room.coverImageUrl} alt={room.name} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <BedDouble className="h-10 w-10 text-muted-foreground" />
                      </div>
                    )}
                    {room.isFeatured && (
                      <Badge className="absolute top-2 left-2 bg-amber-500 text-white text-xs">
                        <Star className="h-3 w-3 mr-1" /> Destacado
                      </Badge>
                    )}
                    <Badge className={`absolute top-2 right-2 text-xs ${room.isActive ? "bg-emerald-500" : "bg-slate-400"}`}>
                      {room.isActive ? "Activo" : "Inactivo"}
                    </Badge>
                  </div>
                  <CardContent className="p-4">
                    <h3 className="font-semibold mb-1">{room.name}</h3>
                    <div className="flex flex-wrap gap-2 text-xs text-muted-foreground mb-3">
                      <span className="flex items-center gap-1"><Users className="h-3 w-3" /> {room.maxAdults} adultos</span>
                      {room.maxChildren > 0 && <span className="flex items-center gap-1"><Baby className="h-3 w-3" /> {room.maxChildren} niños</span>}
                      {room.surfaceM2 && <span className="flex items-center gap-1"><Maximize2 className="h-3 w-3" /> {room.surfaceM2} m²</span>}
                    </div>
                    <div className="text-lg font-bold text-primary mb-3">
                      {parseFloat(room.basePrice || "0").toFixed(2)} €
                      <span className="text-sm font-normal text-muted-foreground">/noche</span>
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" onClick={() => { setEditRoom(room); setShowForm(true); }}>
                        <Pencil className="h-3.5 w-3.5 mr-1" /> Editar
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => toggleMut.mutate({ id: room.id, isActive: !room.isActive })}>
                        {room.isActive ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                      </Button>
                      <Button
                        size="sm" variant="outline"
                        className="text-red-500 hover:text-red-700 ml-auto"
                        onClick={() => { if (confirm(`¿Eliminar "${room.name}"?`)) deleteMut.mutate({ id: room.id }); }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* ── Inventory ── */}
        <TabsContent value="inventory" className="mt-4">
          {(rooms ?? []).length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">Primero crea al menos una tipología.</div>
          ) : (
            <InventoryCalendar rooms={rooms ?? []} />
          )}
        </TabsContent>

        {/* ── Rate Seasons ── */}
        <TabsContent value="rates" className="mt-4">
          <RateSeasonsTab />
        </TabsContent>
      </Tabs>

      {showForm && (
        <RoomFormDialog
          open={showForm}
          onClose={() => { setShowForm(false); setEditRoom(null); }}
          editRoom={editRoom}
        />
      )}
    </div>
    </AdminLayout>
  );
}
