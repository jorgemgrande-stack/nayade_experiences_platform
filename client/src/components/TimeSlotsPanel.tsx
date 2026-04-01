/**
 * TimeSlotsPanel — Panel de gestión de horarios por producto
 * Completamente modular: se monta solo si el producto tiene has_time_slots=true
 * No modifica ningún flujo existente.
 */
import { useState } from "react";
import { Clock, Plus, Pencil, Trash2, GripVertical, ChevronUp, ChevronDown, CheckCircle2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

type SlotType = "fixed" | "flexible" | "range";

type TimeSlot = {
  id: number;
  productId: number;
  type: SlotType;
  label: string;
  startTime: string | null;
  endTime: string | null;
  daysOfWeek: string | null;
  capacity: number | null;
  priceOverride: string | null;
  sortOrder: number;
  active: boolean;
};

type SlotForm = {
  type: SlotType;
  label: string;
  startTime: string;
  endTime: string;
  daysOfWeek: string;
  capacity: string;
  priceOverride: string;
  active: boolean;
};

const emptySlotForm: SlotForm = {
  type: "fixed",
  label: "",
  startTime: "",
  endTime: "",
  daysOfWeek: "",
  capacity: "",
  priceOverride: "",
  active: true,
};

const TYPE_LABELS: Record<SlotType, string> = {
  fixed: "Hora fija",
  flexible: "Hora flexible",
  range: "Turno",
};

const TYPE_COLORS: Record<SlotType, string> = {
  fixed: "bg-blue-100 text-blue-700",
  flexible: "bg-purple-100 text-purple-700",
  range: "bg-amber-100 text-amber-700",
};

const DAY_LABELS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

function formatDays(daysOfWeek: string | null): string {
  if (!daysOfWeek) return "Todos los días";
  const days = daysOfWeek.split(",").map(Number);
  if (days.length === 7) return "Todos los días";
  return days.map(d => DAY_LABELS[d]).join(", ");
}

interface Props {
  productId: number;
  hasTimeSlots: boolean;
  onToggle: (enabled: boolean) => void;
}

export default function TimeSlotsPanel({ productId, hasTimeSlots, onToggle }: Props) {
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<SlotForm>(emptySlotForm);
  const utils = trpc.useUtils();

  const { data: slots = [], isLoading } = trpc.timeSlots.getByProductAdmin.useQuery(
    { productId },
    { enabled: hasTimeSlots }
  );

  const createMutation = trpc.timeSlots.create.useMutation({
    onSuccess: () => {
      utils.timeSlots.getByProductAdmin.invalidate({ productId });
      toast.success("Horario creado");
      setShowModal(false);
      setForm(emptySlotForm);
    },
    onError: (e) => toast.error(e.message),
  });

  const updateMutation = trpc.timeSlots.update.useMutation({
    onSuccess: () => {
      utils.timeSlots.getByProductAdmin.invalidate({ productId });
      toast.success("Horario actualizado");
      setShowModal(false);
      setEditingId(null);
      setForm(emptySlotForm);
    },
    onError: (e) => toast.error(e.message),
  });

  const deleteMutation = trpc.timeSlots.delete.useMutation({
    onSuccess: () => {
      utils.timeSlots.getByProductAdmin.invalidate({ productId });
      toast.success("Horario eliminado");
    },
    onError: (e) => toast.error(e.message),
  });

  const reorderMutation = trpc.timeSlots.reorder.useMutation({
    onSuccess: () => utils.timeSlots.getByProductAdmin.invalidate({ productId }),
  });

  const toggleMutation = trpc.timeSlots.toggleProductTimeSlots.useMutation({
    onSuccess: (_, vars) => {
      onToggle(vars.enabled);
      toast.success(vars.enabled ? "Horarios activados" : "Horarios desactivados");
    },
    onError: (e) => toast.error(e.message),
  });

  function openCreate() {
    setEditingId(null);
    setForm(emptySlotForm);
    setShowModal(true);
  }

  function openEdit(slot: TimeSlot) {
    setEditingId(slot.id);
    setForm({
      type: slot.type,
      label: slot.label,
      startTime: slot.startTime ?? "",
      endTime: slot.endTime ?? "",
      daysOfWeek: slot.daysOfWeek ?? "",
      capacity: slot.capacity != null ? String(slot.capacity) : "",
      priceOverride: slot.priceOverride ?? "",
      active: slot.active,
    });
    setShowModal(true);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.label.trim()) { toast.error("El nombre del horario es obligatorio"); return; }
    if (form.type === "fixed" && !form.startTime) { toast.error("Indica la hora de inicio"); return; }
    if (form.type === "range" && (!form.startTime || !form.endTime)) { toast.error("Indica hora de inicio y fin del turno"); return; }

    const payload = {
      productId,
      type: form.type,
      label: form.label.trim(),
      startTime: form.startTime || null,
      endTime: form.endTime || null,
      daysOfWeek: form.daysOfWeek || null,
      capacity: form.capacity ? parseInt(form.capacity) : null,
      priceOverride: form.priceOverride || null,
      sortOrder: editingId ? (slots.find(s => s.id === editingId)?.sortOrder ?? 0) : slots.length,
      active: form.active,
    };

    if (editingId) {
      updateMutation.mutate({ id: editingId, ...payload });
    } else {
      createMutation.mutate(payload);
    }
  }

  function moveSlot(index: number, direction: "up" | "down") {
    const newSlots = [...slots];
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= newSlots.length) return;
    [newSlots[index], newSlots[targetIndex]] = [newSlots[targetIndex], newSlots[index]];
    reorderMutation.mutate({
      items: newSlots.map((s, i) => ({ id: s.id, sortOrder: i })),
    });
  }

  return (
    <div className="col-span-2 border border-slate-200 rounded-xl p-4 bg-slate-50/50">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Clock className="w-4 h-4 text-slate-500" />
          <span className="text-sm font-semibold text-slate-700">Horarios / Time Slots</span>
          {hasTimeSlots && (
            <Badge className="text-xs bg-emerald-100 text-emerald-700 border-0">Activo</Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Switch
            checked={hasTimeSlots}
            onCheckedChange={(v) => toggleMutation.mutate({ productId, enabled: v })}
            disabled={toggleMutation.isPending}
          />
          <span className="text-xs text-slate-500">{hasTimeSlots ? "Activado" : "Desactivado"}</span>
        </div>
      </div>

      {!hasTimeSlots && (
        <p className="text-xs text-slate-400 italic">
          Activa esta opción para configurar horarios específicos para este producto.
          Si está desactivado, el sistema funciona exactamente igual que ahora.
        </p>
      )}

      {hasTimeSlots && (
        <>
          {/* Lista de slots */}
          {isLoading ? (
            <div className="text-xs text-slate-400 py-2">Cargando horarios...</div>
          ) : slots.length === 0 ? (
            <div className="text-xs text-slate-400 italic py-2 text-center border border-dashed border-slate-200 rounded-lg">
              No hay horarios configurados. Añade el primero.
            </div>
          ) : (
            <div className="space-y-1.5 mb-3">
              {slots.map((slot, index) => (
                <div
                  key={slot.id}
                  className={`flex items-center gap-2 p-2.5 rounded-lg border text-sm ${
                    slot.active ? "bg-white border-slate-200" : "bg-slate-100 border-slate-200 opacity-60"
                  }`}
                >
                  {/* Reorder */}
                  <div className="flex flex-col gap-0.5">
                    <button
                      type="button"
                      onClick={() => moveSlot(index, "up")}
                      disabled={index === 0}
                      className="text-slate-300 hover:text-slate-500 disabled:opacity-20"
                    >
                      <ChevronUp className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => moveSlot(index, "down")}
                      disabled={index === slots.length - 1}
                      className="text-slate-300 hover:text-slate-500 disabled:opacity-20"
                    >
                      <ChevronDown className="w-3 h-3" />
                    </button>
                  </div>

                  {/* Type badge */}
                  <Badge className={`text-xs border-0 shrink-0 ${TYPE_COLORS[slot.type]}`}>
                    {TYPE_LABELS[slot.type]}
                  </Badge>

                  {/* Label */}
                  <span className="font-medium text-slate-700 flex-1 truncate">{slot.label}</span>

                  {/* Times */}
                  {slot.startTime && (
                    <span className="text-xs text-slate-500 shrink-0">
                      {slot.startTime}{slot.endTime ? ` – ${slot.endTime}` : ""}
                    </span>
                  )}

                  {/* Days */}
                  <span className="text-xs text-slate-400 shrink-0 hidden sm:block">
                    {formatDays(slot.daysOfWeek)}
                  </span>

                  {/* Capacity */}
                  {slot.capacity && (
                    <span className="text-xs text-slate-400 shrink-0">Cap: {slot.capacity}</span>
                  )}

                  {/* Active indicator */}
                  {slot.active
                    ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                    : <XCircle className="w-3.5 h-3.5 text-slate-300 shrink-0" />
                  }

                  {/* Actions */}
                  <div className="flex gap-1 shrink-0">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="w-6 h-6 text-slate-400 hover:text-blue-600"
                      onClick={() => openEdit(slot as TimeSlot)}
                    >
                      <Pencil className="w-3 h-3" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="w-6 h-6 text-slate-400 hover:text-red-600"
                      onClick={() => {
                        if (confirm("¿Eliminar este horario?")) deleteMutation.mutate({ id: slot.id });
                      }}
                    >
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-full border-dashed border-blue-300 text-blue-600 hover:bg-blue-50"
            onClick={openCreate}
          >
            <Plus className="w-3.5 h-3.5 mr-1" /> Añadir horario
          </Button>
        </>
      )}

      {/* Modal de creación/edición */}
      <Dialog open={showModal} onOpenChange={(open) => { if (!open) { setShowModal(false); setEditingId(null); setForm(emptySlotForm); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-blue-500" />
              {editingId ? "Editar horario" : "Nuevo horario"}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Tipo */}
            <div>
              <Label className="text-xs font-semibold text-slate-600 mb-1.5 block">Tipo de horario</Label>
              <div className="grid grid-cols-3 gap-2">
                {(["fixed", "flexible", "range"] as SlotType[]).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setForm(f => ({ ...f, type: t }))}
                    className={`py-2 px-3 rounded-lg text-xs font-medium border transition-all ${
                      form.type === t
                        ? "border-blue-400 bg-blue-50 text-blue-700"
                        : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                    }`}
                  >
                    {TYPE_LABELS[t]}
                  </button>
                ))}
              </div>
              <p className="text-xs text-slate-400 mt-1.5">
                {form.type === "fixed" && "Hora exacta de inicio (ej: 10:00, 12:00, 16:00)"}
                {form.type === "flexible" && "El cliente elige la hora libremente dentro del rango disponible"}
                {form.type === "range" && "Turno con hora de inicio y fin (ej: Turno mañana 09:00–14:00)"}
              </p>
            </div>

            {/* Nombre */}
            <div>
              <Label htmlFor="slot-label" className="text-xs font-semibold text-slate-600">Nombre visible *</Label>
              <Input
                id="slot-label"
                value={form.label}
                onChange={(e) => setForm(f => ({ ...f, label: e.target.value }))}
                placeholder={
                  form.type === "fixed" ? "Ej: 10:00" :
                  form.type === "range" ? "Ej: Turno mañana" :
                  "Ej: Elige tu hora"
                }
                className="mt-1 text-sm"
              />
            </div>

            {/* Horas */}
            {form.type !== "flexible" && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="slot-start" className="text-xs font-semibold text-slate-600">
                    {form.type === "fixed" ? "Hora *" : "Inicio *"}
                  </Label>
                  <Input
                    id="slot-start"
                    type="time"
                    value={form.startTime}
                    onChange={(e) => setForm(f => ({ ...f, startTime: e.target.value }))}
                    className="mt-1 text-sm"
                  />
                </div>
                {form.type === "range" && (
                  <div>
                    <Label htmlFor="slot-end" className="text-xs font-semibold text-slate-600">Fin *</Label>
                    <Input
                      id="slot-end"
                      type="time"
                      value={form.endTime}
                      onChange={(e) => setForm(f => ({ ...f, endTime: e.target.value }))}
                      className="mt-1 text-sm"
                    />
                  </div>
                )}
              </div>
            )}

            {/* Días de la semana */}
            <div>
              <Label className="text-xs font-semibold text-slate-600 mb-1.5 block">Días disponibles</Label>
              <div className="flex gap-1.5 flex-wrap">
                {DAY_LABELS.map((day, i) => {
                  const selected = form.daysOfWeek
                    ? form.daysOfWeek.split(",").includes(String(i))
                    : false;
                  return (
                    <button
                      key={i}
                      type="button"
                      onClick={() => {
                        const current = form.daysOfWeek ? form.daysOfWeek.split(",").filter(Boolean) : [];
                        const updated = selected
                          ? current.filter(d => d !== String(i))
                          : [...current, String(i)].sort();
                        setForm(f => ({ ...f, daysOfWeek: updated.join(",") }));
                      }}
                      className={`px-2.5 py-1 rounded-md text-xs font-medium border transition-all ${
                        selected
                          ? "border-blue-400 bg-blue-50 text-blue-700"
                          : "border-slate-200 bg-white text-slate-500 hover:border-slate-300"
                      }`}
                    >
                      {day}
                    </button>
                  );
                })}
              </div>
              <p className="text-xs text-slate-400 mt-1">Sin selección = disponible todos los días</p>
            </div>

            {/* Capacidad y precio */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="slot-capacity" className="text-xs font-semibold text-slate-600">Capacidad máx.</Label>
                <Input
                  id="slot-capacity"
                  type="number"
                  min="1"
                  value={form.capacity}
                  onChange={(e) => setForm(f => ({ ...f, capacity: e.target.value }))}
                  placeholder="Sin límite"
                  className="mt-1 text-sm"
                />
              </div>
              <div>
                <Label htmlFor="slot-price" className="text-xs font-semibold text-slate-600">Precio especial (€)</Label>
                <Input
                  id="slot-price"
                  type="number"
                  step="0.01"
                  min="0"
                  value={form.priceOverride}
                  onChange={(e) => setForm(f => ({ ...f, priceOverride: e.target.value }))}
                  placeholder="Precio base"
                  className="mt-1 text-sm"
                />
              </div>
            </div>

            {/* Activo */}
            <div className="flex items-center gap-3">
              <Switch
                checked={form.active}
                onCheckedChange={(v) => setForm(f => ({ ...f, active: v }))}
              />
              <Label className="text-sm text-slate-600">Horario activo (visible para clientes)</Label>
            </div>

            {/* Botones */}
            <div className="flex gap-3 pt-1">
              <Button
                type="button"
                variant="outline"
                onClick={() => { setShowModal(false); setEditingId(null); setForm(emptySlotForm); }}
                className="flex-1"
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled={createMutation.isPending || updateMutation.isPending}
                className="flex-1"
                style={{ background: "linear-gradient(135deg,#3b82f6,#6366f1)", color: "#fff", border: "none", fontWeight: 600 }}
              >
                {editingId ? "Guardar cambios" : "Crear horario"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
