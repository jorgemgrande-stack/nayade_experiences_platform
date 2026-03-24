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
  Sparkles, Plus, Pencil, Trash2, Eye, EyeOff, Star,
  Clock, Users, ChevronLeft, ChevronRight, RefreshCw, Zap,
} from "lucide-react";
import SupplierSelect from "@/components/SupplierSelect";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

function slugify(s: string) {
  return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

// ─── Treatment Form Dialog ────────────────────────────────────────────────────
interface TreatmentFormData {
  name: string; slug: string; shortDescription: string; description: string;
  price: string; durationMinutes: number; maxPersons: number;
  categoryId: string; coverImageUrl: string; isFeatured: boolean; isActive: boolean;
  discountPercent: string; discountLabel: string; discountExpiresAt: string;
  fiscalRegime: string; productType: string; providerPercent: string; agencyMarginPercent: string;
  supplierId: number | null; supplierCommissionPercent: string;
  supplierCostType: string; settlementFrequency: string; isSettlable: boolean;
}
const EMPTY_TREATMENT: TreatmentFormData = {
  name: "", slug: "", shortDescription: "", description: "",
  price: "", durationMinutes: 60, maxPersons: 2,
  categoryId: "", coverImageUrl: "", isFeatured: false, isActive: true,
  discountPercent: "", discountLabel: "", discountExpiresAt: "",
  fiscalRegime: "general_21", productType: "own", providerPercent: "", agencyMarginPercent: "",
  supplierId: null, supplierCommissionPercent: "", supplierCostType: "comision_sobre_venta",
  settlementFrequency: "manual", isSettlable: false,
};

function TreatmentFormDialog({ open, onClose, editTreatment, categories }: {
  open: boolean; onClose: () => void; editTreatment?: any; categories: any[];
}) {
  const utils = trpc.useUtils();
  const [form, setForm] = useState<TreatmentFormData>(() =>
    editTreatment ? {
      name: editTreatment.name ?? "", slug: editTreatment.slug ?? "",
      shortDescription: editTreatment.shortDescription ?? "",
      description: editTreatment.description ?? "",
      price: editTreatment.price ?? "", durationMinutes: editTreatment.durationMinutes ?? 60,
      maxPersons: editTreatment.maxPersons ?? 2,
      categoryId: editTreatment.categoryId != null ? String(editTreatment.categoryId) : "",
      coverImageUrl: editTreatment.coverImageUrl ?? "",
      isFeatured: editTreatment.isFeatured ?? false, isActive: editTreatment.isActive ?? true,
      discountPercent: editTreatment.discountPercent != null ? String(editTreatment.discountPercent) : "",
      discountLabel: editTreatment.discountLabel ?? "",
      discountExpiresAt: editTreatment.discountExpiresAt ? new Date(editTreatment.discountExpiresAt).toISOString().slice(0, 10) : "",
      fiscalRegime: editTreatment.fiscalRegime ?? "general_21",
      productType: editTreatment.productType ?? "own",
      providerPercent: editTreatment.providerPercent != null ? String(editTreatment.providerPercent) : "",
      agencyMarginPercent: editTreatment.agencyMarginPercent != null ? String(editTreatment.agencyMarginPercent) : "",
      supplierId: editTreatment.supplierId ?? null,
      supplierCommissionPercent: editTreatment.supplierCommissionPercent != null ? String(editTreatment.supplierCommissionPercent) : "",
      supplierCostType: editTreatment.supplierCostType ?? "comision_sobre_venta",
      settlementFrequency: editTreatment.settlementFrequency ?? "manual",
      isSettlable: editTreatment.isSettlable ?? false,
    } : { ...EMPTY_TREATMENT }
  );

  const createMut = trpc.spa.adminCreateTreatment.useMutation({
    onSuccess: () => { utils.spa.adminGetTreatments.invalidate(); toast.success("Tratamiento creado"); onClose(); },
    onError: (e: any) => toast.error("Error", { description: e.message }),
  });
  const updateMut = trpc.spa.adminUpdateTreatment.useMutation({
    onSuccess: () => { utils.spa.adminGetTreatments.invalidate(); toast.success("Tratamiento actualizado"); onClose(); },
    onError: (e: any) => toast.error("Error", { description: e.message }),
  });

  function handleSubmit() {
    const payload = {
      name: form.name, slug: form.slug || slugify(form.name),
      shortDescription: form.shortDescription || undefined,
      description: form.description || undefined,
      price: form.price, durationMinutes: form.durationMinutes, maxPersons: form.maxPersons,
      categoryId: form.categoryId ? parseInt(form.categoryId) : undefined,
      coverImageUrl: form.coverImageUrl || undefined,
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
    if (editTreatment) updateMut.mutate({ id: editTreatment.id, ...payload });
    else createMut.mutate(payload);
  }

  const isLoading = createMut.isPending || updateMut.isPending;

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editTreatment ? "Editar tratamiento" : "Nuevo tratamiento"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Nombre *</Label>
              <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value, slug: slugify(e.target.value) }))} placeholder="Masaje relajante" />
            </div>
            <div>
              <Label>Slug (URL)</Label>
              <Input value={form.slug} onChange={e => setForm(f => ({ ...f, slug: e.target.value }))} placeholder="masaje-relajante" />
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
              <Label>Precio (€/persona) *</Label>
              <Input type="number" value={form.price} onChange={e => setForm(f => ({ ...f, price: e.target.value }))} placeholder="55" />
            </div>
            <div>
              <Label>Duración (minutos)</Label>
              <Input type="number" min={15} step={15} value={form.durationMinutes} onChange={e => setForm(f => ({ ...f, durationMinutes: parseInt(e.target.value) || 60 }))} />
            </div>
            <div>
              <Label>Máx. personas</Label>
              <Input type="number" min={1} value={form.maxPersons} onChange={e => setForm(f => ({ ...f, maxPersons: parseInt(e.target.value) || 1 }))} />
            </div>
          </div>
          <div>
            <Label>Categoría</Label>
            <select
              value={form.categoryId}
              onChange={e => setForm(f => ({ ...f, categoryId: e.target.value }))}
              className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">Sin categoría</option>
              {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <Label>Imagen de portada</Label>
            <ImageUploader value={form.coverImageUrl} onChange={url => setForm(f => ({ ...f, coverImageUrl: url }))} />
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
          <Button onClick={handleSubmit} disabled={isLoading || !form.name || !form.price}>
            {isLoading ? "Guardando..." : editTreatment ? "Guardar cambios" : "Crear tratamiento"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Categories Tab ───────────────────────────────────────────────────────────
function CategoriesTab() {
  const utils = trpc.useUtils();
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const { data: categories, isLoading } = trpc.spa.adminGetCategories.useQuery();

  const createMut = trpc.spa.adminCreateCategory.useMutation({
    onSuccess: () => { utils.spa.adminGetCategories.invalidate(); toast.success("Categoría creada"); setShowForm(false); setName(""); },
    onError: (e: any) => toast.error("Error", { description: e.message }),
  });
  const deleteMut = trpc.spa.adminDeleteCategory.useMutation({
    onSuccess: () => utils.spa.adminGetCategories.invalidate(),
  });

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setShowForm(true)}><Plus className="h-4 w-4 mr-1" /> Nueva categoría</Button>
      </div>
      {showForm && (
        <Card>
          <CardContent className="p-4 flex gap-3 items-end">
            <div className="flex-1">
              <Label>Nombre</Label>
              <Input value={name} onChange={e => setName(e.target.value)} placeholder="Masajes, Circuitos, Faciales..." />
            </div>
            <Button onClick={() => createMut.mutate({ name, slug: slugify(name) })} disabled={!name || createMut.isPending}>Crear</Button>
            <Button variant="outline" onClick={() => setShowForm(false)}>Cancelar</Button>
          </CardContent>
        </Card>
      )}
      {isLoading ? (
        <div className="text-center py-8 text-muted-foreground">Cargando...</div>
      ) : (categories ?? []).length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">No hay categorías.</div>
      ) : (
        <div className="space-y-2">
          {(categories ?? []).map((c: any) => (
            <Card key={c.id}>
              <CardContent className="p-4 flex items-center justify-between">
                <div>
                  <div className="font-medium">{c.name}</div>
                  <div className="text-sm text-muted-foreground">/{c.slug}</div>
                </div>
                <Button variant="ghost" size="sm" onClick={() => deleteMut.mutate({ id: c.id })} className="text-red-500 hover:text-red-700">
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

// ─── Schedule Templates Tab ───────────────────────────────────────────────────
function ScheduleTemplatesTab({ treatments }: { treatments: any[] }) {
  const utils = trpc.useUtils();
  const [showForm, setShowForm] = useState(false);
  const [selectedTreatment, setSelectedTreatment] = useState<number | null>(treatments[0]?.id ?? null);
  const [form, setForm] = useState({
    treatmentId: "", dayOfWeek: "1", startTime: "10:00", endTime: "20:00",
    slotIntervalMinutes: "60", maxBookingsPerSlot: "1",
  });
  const [generateDate, setGenerateDate] = useState("");
  const [generateDays, setGenerateDays] = useState("7");

  const { data: templates, isLoading } = trpc.spa.adminGetTemplates.useQuery({});

  const createMut = trpc.spa.adminCreateTemplate.useMutation({
    onSuccess: () => { utils.spa.adminGetTemplates.invalidate(); toast.success("Plantilla creada"); setShowForm(false); },
    onError: (e: any) => toast.error("Error", { description: e.message }),
  });
  const deleteMut = trpc.spa.adminDeleteTemplate.useMutation({
    onSuccess: () => utils.spa.adminGetTemplates.invalidate(),
  });
  const generateMut = trpc.spa.adminGenerateSlots.useMutation({
    onSuccess: (data: any) => toast.success(`${data.created} slots generados`),
    onError: (e: any) => toast.error("Error", { description: e.message }),
  });

  const DOW = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

  return (
    <div className="space-y-4">
      <div className="flex gap-3 items-center justify-between flex-wrap">
        <div className="flex gap-2 items-center">
          <Input type="date" value={generateDate} onChange={e => setGenerateDate(e.target.value)} className="w-40" />
          <Input type="number" min={1} max={90} value={generateDays} onChange={e => setGenerateDays(e.target.value)} className="w-20" placeholder="Días" />
          <Button
            onClick={() => {
              const fd = generateDate;
              const td = new Date(new Date(fd).getTime() + (parseInt(generateDays) || 7) * 86400000);
              const endD = td.toISOString().slice(0, 10);
              generateMut.mutate({ treatmentId: selectedTreatment ?? (treatments[0]?.id ?? 0), startDate: fd, endDate: endD });
            }}
            disabled={!generateDate || generateMut.isPending}
            className="bg-emerald-600 hover:bg-emerald-500"
          >
            <Zap className="h-4 w-4 mr-1" />
            {generateMut.isPending ? "Generando..." : "Generar slots"}
          </Button>
        </div>
        <Button size="sm" onClick={() => setShowForm(true)}><Plus className="h-4 w-4 mr-1" /> Nueva plantilla</Button>
      </div>

      {showForm && (
        <Card>
          <CardHeader><CardTitle className="text-base">Nueva plantilla de horario</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Tratamiento</Label>
                <select
                  value={form.treatmentId}
                  onChange={e => setForm(f => ({ ...f, treatmentId: e.target.value }))}
                  className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="">Seleccionar...</option>
                  {treatments.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
              <div>
                <Label>Día de la semana</Label>
                <select
                  value={form.dayOfWeek}
                  onChange={e => setForm(f => ({ ...f, dayOfWeek: e.target.value }))}
                  className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
                >
                  {DOW.map((d, i) => <option key={i} value={i}>{d}</option>)}
                </select>
              </div>
              <div>
                <Label>Hora inicio</Label>
                <Input type="time" value={form.startTime} onChange={e => setForm(f => ({ ...f, startTime: e.target.value }))} />
              </div>
              <div>
                <Label>Hora fin</Label>
                <Input type="time" value={form.endTime} onChange={e => setForm(f => ({ ...f, endTime: e.target.value }))} />
              </div>
              <div>
                <Label>Intervalo entre slots (min)</Label>
                <Input type="number" min={15} step={15} value={form.slotIntervalMinutes} onChange={e => setForm(f => ({ ...f, slotIntervalMinutes: e.target.value }))} />
              </div>
              <div>
                <Label>Reservas máx. por slot</Label>
                <Input type="number" min={1} value={form.maxBookingsPerSlot} onChange={e => setForm(f => ({ ...f, maxBookingsPerSlot: e.target.value }))} />
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setShowForm(false)}>Cancelar</Button>
              <Button
                onClick={() => createMut.mutate({
                  treatmentId: parseInt(form.treatmentId),
                  dayOfWeek: parseInt(form.dayOfWeek),
                  startTime: form.startTime,
                  endTime: form.endTime,
                  capacity: parseInt(form.maxBookingsPerSlot) || 1,
                })}
                disabled={createMut.isPending || !form.treatmentId}
              >
                {createMut.isPending ? "Creando..." : "Crear plantilla"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <div className="text-center py-8 text-muted-foreground">Cargando...</div>
      ) : (templates ?? []).length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <p>No hay plantillas. Crea una para empezar a generar slots automáticamente.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {(templates ?? []).map((t: any) => {
            const treatment = treatments.find(tr => tr.id === t.treatmentId);
            return (
              <Card key={t.id}>
                <CardContent className="p-4 flex items-center justify-between">
                  <div>
                    <div className="font-medium">{treatment?.name ?? `Tratamiento #${t.treatmentId}`}</div>
                    <div className="text-sm text-muted-foreground">
                      {DOW[t.dayOfWeek]} · {t.startTime} – {t.endTime} · Cada {t.slotIntervalMinutes} min · Máx. {t.maxBookingsPerSlot} reserva{t.maxBookingsPerSlot !== 1 ? "s" : ""}
                    </div>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => deleteMut.mutate({ id: t.id })} className="text-red-500 hover:text-red-700">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Slots Calendar ───────────────────────────────────────────────────────────
function SlotsCalendar({ treatments }: { treatments: any[] }) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [selectedTreatment, setSelectedTreatment] = useState<number | null>(treatments[0]?.id ?? null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const monthName = new Date(year, month - 1, 1).toLocaleString("es-ES", { month: "long", year: "numeric" });
  const daysInMonth = new Date(year, month, 0).getDate();
  const firstDow = new Date(year, month - 1, 1).getDay();
  const DAYS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

  // Build date range for month
  const fromDate = `${year}-${String(month).padStart(2, "0")}-01`;
  const toDate = `${year}-${String(month).padStart(2, "0")}-${String(daysInMonth).padStart(2, "0")}`;

  const { data: slots, isLoading } = trpc.spa.adminGetSlots.useQuery(
    { treatmentId: selectedTreatment!, startDate: fromDate, endDate: toDate } as any,
    { enabled: !!selectedTreatment }
  );

  // Group slots by date
  const slotsByDate = new Map<string, any[]>();
  (slots ?? []).forEach((s: any) => {
    const d = s.date;
    if (!slotsByDate.has(d)) slotsByDate.set(d, []);
    slotsByDate.get(d)!.push(s);
  });

  const daySlots = selectedDate ? (slotsByDate.get(selectedDate) ?? []) : [];

  function prevMonth() { if (month === 1) { setMonth(12); setYear(y => y - 1); } else setMonth(m => m - 1); }
  function nextMonth() { if (month === 12) { setMonth(1); setYear(y => y + 1); } else setMonth(m => m + 1); }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2 space-y-4">
        <div className="flex flex-wrap gap-2 items-center">
          <span className="text-sm font-medium">Tratamiento:</span>
          {treatments.map(t => (
            <button
              key={t.id}
              onClick={() => setSelectedTreatment(t.id)}
              className={`px-3 py-1 rounded-full text-sm transition-colors ${selectedTreatment === t.id ? "bg-primary text-white" : "bg-muted hover:bg-muted/80"}`}
            >
              {t.name}
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
                {Array(firstDow).fill(null).map((_, i) => <div key={`b${i}`} />)}
                {Array.from({ length: daysInMonth }, (_, i) => {
                  const d = i + 1;
                  const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
                  const daySlotList = slotsByDate.get(dateStr) ?? [];
                  const hasSlots = daySlotList.length > 0;
                  const isSelected = selectedDate === dateStr;

                  return (
                    <button
                      key={dateStr}
                      onClick={() => setSelectedDate(isSelected ? null : dateStr)}
                      className={`rounded-lg p-1.5 text-center border transition-all hover:scale-105 ${
                        isSelected
                          ? "bg-primary text-primary-foreground border-primary"
                          : hasSlots
                            ? "bg-teal-50 border-teal-200 dark:bg-teal-900/20 dark:border-teal-700"
                            : "bg-muted/30 border-muted"
                      }`}
                    >
                      <div className="text-xs font-medium">{d}</div>
                      <div className="text-xs">{hasSlots ? daySlotList.length : "—"}</div>
                    </button>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Day detail */}
      <div>
        {selectedDate ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{selectedDate}</CardTitle>
            </CardHeader>
            <CardContent>
              {daySlots.length === 0 ? (
                <p className="text-muted-foreground text-sm">No hay slots para este día.</p>
              ) : (
                <div className="space-y-2">
                  {daySlots.map((slot: any) => (
                    <div key={slot.id} className="flex items-center justify-between p-2 rounded-lg bg-muted/50">
                      <div>
                        <div className="text-sm font-medium">{slot.startTime} – {slot.endTime}</div>
                        <div className="text-xs text-muted-foreground">
                          {slot.currentBookings}/{slot.maxBookings} reservas
                        </div>
                      </div>
                      <Badge className={slot.isAvailable ? "bg-emerald-500" : "bg-red-500"}>
                        {slot.isAvailable ? "Libre" : "Lleno"}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        ) : (
          <div className="text-center py-12 text-muted-foreground text-sm">
            Selecciona un día para ver los slots
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function SpaManager() {
  const { data: treatments, isLoading } = trpc.spa.adminGetTreatments.useQuery();
  const { data: categories } = trpc.spa.adminGetCategories.useQuery();
  const [showForm, setShowForm] = useState(false);
  const [editTreatment, setEditTreatment] = useState<any>(null);
  const utils = trpc.useUtils();

  const toggleMut = trpc.spa.adminToggleTreatmentActive.useMutation({
    onSuccess: () => utils.spa.adminGetTreatments.invalidate(),
    onError: (e: any) => toast.error("Error", { description: e.message }),
  });
  const deleteMut = trpc.spa.adminDeleteTreatment.useMutation({
    onSuccess: () => { utils.spa.adminGetTreatments.invalidate(); toast.success("Tratamiento eliminado"); },
    onError: (e: any) => toast.error("Error", { description: e.message }),
  });

  return (
    <AdminLayout title="SPA Náyade">
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">SPA Náyade</h1>
          <p className="text-muted-foreground text-sm">Gestiona tratamientos, horarios y disponibilidad</p>
        </div>
        <Button onClick={() => { setEditTreatment(null); setShowForm(true); }}>
          <Plus className="h-4 w-4 mr-2" /> Nuevo tratamiento
        </Button>
      </div>

      <Tabs defaultValue="treatments">
        <TabsList>
          <TabsTrigger value="treatments">Tratamientos</TabsTrigger>
          <TabsTrigger value="categories">Categorías</TabsTrigger>
          <TabsTrigger value="schedule">Plantillas de horario</TabsTrigger>
          <TabsTrigger value="slots">Calendario de slots</TabsTrigger>
        </TabsList>

        {/* ── Treatments ── */}
        <TabsContent value="treatments" className="mt-4">
          {isLoading ? (
            <div className="text-center py-12 text-muted-foreground">Cargando...</div>
          ) : (treatments ?? []).length === 0 ? (
            <div className="text-center py-16 text-muted-foreground">
              <Sparkles className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p>No hay tratamientos. Crea el primero.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {(treatments ?? []).map((t: any) => (
                <Card key={t.id} className={`overflow-hidden ${!t.isActive ? "opacity-60" : ""}`}>
                  <div className="relative h-40 bg-muted">
                    {t.coverImageUrl ? (
                      <img src={t.coverImageUrl} alt={t.name} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <Sparkles className="h-10 w-10 text-muted-foreground" />
                      </div>
                    )}
                    {t.isFeatured && (
                      <Badge className="absolute top-2 left-2 bg-amber-500 text-white text-xs">
                        <Star className="h-3 w-3 mr-1" /> Destacado
                      </Badge>
                    )}
                    <Badge className={`absolute top-2 right-2 text-xs ${t.isActive ? "bg-emerald-500" : "bg-slate-400"}`}>
                      {t.isActive ? "Activo" : "Inactivo"}
                    </Badge>
                  </div>
                  <CardContent className="p-4">
                    <h3 className="font-semibold mb-1">{t.name}</h3>
                    <div className="flex flex-wrap gap-2 text-xs text-muted-foreground mb-3">
                      <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> {t.durationMinutes} min</span>
                      <span className="flex items-center gap-1"><Users className="h-3 w-3" /> Máx. {t.maxPersons}</span>
                    </div>
                    <div className="text-lg font-bold text-primary mb-3">
                      {parseFloat(t.price || "0").toFixed(2)} €
                      <span className="text-sm font-normal text-muted-foreground">/persona</span>
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" onClick={() => { setEditTreatment(t); setShowForm(true); }}>
                        <Pencil className="h-3.5 w-3.5 mr-1" /> Editar
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => toggleMut.mutate({ id: t.id, isActive: !t.isActive })}>
                        {t.isActive ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                      </Button>
                      <Button
                        size="sm" variant="outline"
                        className="text-red-500 hover:text-red-700 ml-auto"
                        onClick={() => { if (confirm(`¿Eliminar "${t.name}"?`)) deleteMut.mutate({ id: t.id }); }}
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

        {/* ── Categories ── */}
        <TabsContent value="categories" className="mt-4">
          <CategoriesTab />
        </TabsContent>

        {/* ── Schedule Templates ── */}
        <TabsContent value="schedule" className="mt-4">
          {(treatments ?? []).length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">Primero crea al menos un tratamiento.</div>
          ) : (
            <ScheduleTemplatesTab treatments={treatments ?? []} />
          )}
        </TabsContent>

        {/* ── Slots Calendar ── */}
        <TabsContent value="slots" className="mt-4">
          {(treatments ?? []).length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">Primero crea al menos un tratamiento.</div>
          ) : (
            <SlotsCalendar treatments={treatments ?? []} />
          )}
        </TabsContent>
      </Tabs>

      {showForm && (
        <TreatmentFormDialog
          open={showForm}
          onClose={() => { setShowForm(false); setEditTreatment(null); }}
          editTreatment={editTreatment}
          categories={categories ?? []}
        />
      )}
    </div>
    </AdminLayout>
  );
}
