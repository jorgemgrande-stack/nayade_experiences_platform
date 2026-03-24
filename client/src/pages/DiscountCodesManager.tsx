import { useState } from "react";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import {
  Plus, Search, Edit2, Trash2, Copy, ToggleLeft, ToggleRight,
  Tag, Calendar, Users, Percent, Eye,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────
interface DiscountCode {
  id: number;
  code: string;
  name: string;
  description: string | null;
  discountPercent: string;
  expiresAt: Date | null;
  status: "active" | "inactive" | "expired";
  maxUses: number | null;
  currentUses: number;
  observations: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface FormState {
  code: string;
  name: string;
  description: string;
  discountPercent: string;
  expiresAt: string;
  maxUses: string;
  observations: string;
}

const EMPTY_FORM: FormState = {
  code: "",
  name: "",
  description: "",
  discountPercent: "",
  expiresAt: "",
  maxUses: "",
  observations: "",
};

// ─── Status badge ─────────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: string }) {
  if (status === "active") return <Badge className="bg-green-500/20 text-green-400 border-green-500/30">Activo</Badge>;
  if (status === "inactive") return <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30">Inactivo</Badge>;
  return <Badge className="bg-red-500/20 text-red-400 border-red-500/30">Caducado</Badge>;
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function DiscountCodesManager() {
  const utils = trpc.useUtils();

  // Filters
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive" | "expired">("all");
  const [page, setPage] = useState(1);

  // Modals
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [showUses, setShowUses] = useState<number | null>(null);

  // Queries
  const { data, isLoading, refetch } = trpc.discounts.list.useQuery({
    search: search || undefined,
    status: statusFilter,
    page,
    pageSize: 20,
  });

  const { data: usesData } = trpc.discounts.getUses.useQuery(
    { discountCodeId: showUses! },
    { enabled: showUses !== null }
  );

  // Mutations
  const createMutation = trpc.discounts.create.useMutation({
    onSuccess: () => { toast.success("Código creado correctamente"); utils.discounts.list.invalidate(); closeForm(); },
    onError: (e) => toast.error(e.message),
  });
  const updateMutation = trpc.discounts.update.useMutation({
    onSuccess: () => { toast.success("Código actualizado"); utils.discounts.list.invalidate(); closeForm(); },
    onError: (e) => toast.error(e.message),
  });
  const toggleMutation = trpc.discounts.toggleStatus.useMutation({
    onSuccess: () => { utils.discounts.list.invalidate(); },
    onError: (e) => toast.error(e.message),
  });
  const deleteMutation = trpc.discounts.delete.useMutation({
    onSuccess: (res) => {
      if (res.softDeleted) toast.info("Código desactivado (tiene usos registrados)");
      else toast.success("Código eliminado");
      utils.discounts.list.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const duplicateMutation = trpc.discounts.duplicate.useMutation({
    onSuccess: () => { toast.success("Código duplicado"); utils.discounts.list.invalidate(); },
    onError: (e) => toast.error(e.message),
  });

  function openCreate() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setShowForm(true);
  }

  function openEdit(code: DiscountCode) {
    setEditingId(code.id);
    setForm({
      code: code.code,
      name: code.name,
      description: code.description ?? "",
      discountPercent: code.discountPercent,
      expiresAt: code.expiresAt ? new Date(code.expiresAt).toISOString().slice(0, 10) : "",
      maxUses: code.maxUses !== null ? String(code.maxUses) : "",
      observations: code.observations ?? "",
    });
    setShowForm(true);
  }

  function closeForm() {
    setShowForm(false);
    setEditingId(null);
    setForm(EMPTY_FORM);
  }

  function handleSubmit() {
    const percent = parseFloat(form.discountPercent);
    if (!form.code.trim()) return toast.error("El código es obligatorio");
    if (!form.name.trim()) return toast.error("El nombre interno es obligatorio");
    if (isNaN(percent) || percent < 1 || percent > 100) return toast.error("El porcentaje debe estar entre 1 y 100");

    const payload = {
      code: form.code,
      name: form.name,
      description: form.description || undefined,
      discountPercent: percent,
      expiresAt: form.expiresAt || null,
      maxUses: form.maxUses ? parseInt(form.maxUses) : null,
      observations: form.observations || undefined,
    };

    if (editingId) {
      updateMutation.mutate({ id: editingId, ...payload });
    } else {
      createMutation.mutate(payload);
    }
  }

  const items: DiscountCode[] = (data?.items as DiscountCode[]) ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / 20);

  return (
    <AdminLayout title="Códigos de Descuento">
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-display font-bold text-foreground flex items-center gap-2">
              <Tag className="w-6 h-6 text-violet-400" />
              Códigos de Descuento
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              Gestiona los códigos promocionales aplicables en TPV, tienda online y venta delegada.
            </p>
          </div>
          <Button onClick={openCreate} className="bg-violet-600 hover:bg-violet-700 text-white gap-2">
            <Plus className="w-4 h-4" /> Nuevo código
          </Button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: "Total códigos", value: total, icon: Tag, color: "text-violet-400" },
            { label: "Activos", value: items.filter(i => i.status === "active").length, icon: ToggleRight, color: "text-green-400" },
            { label: "Inactivos", value: items.filter(i => i.status === "inactive").length, icon: ToggleLeft, color: "text-yellow-400" },
            { label: "Caducados", value: items.filter(i => i.status === "expired").length, icon: Calendar, color: "text-red-400" },
          ].map((stat) => (
            <Card key={stat.label} className="bg-card border-border">
              <CardContent className="p-4 flex items-center gap-3">
                <stat.icon className={`w-8 h-8 ${stat.color}`} />
                <div>
                  <p className="text-2xl font-bold text-foreground">{stat.value}</p>
                  <p className="text-xs text-muted-foreground">{stat.label}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Filters */}
        <Card className="bg-card border-border">
          <CardContent className="p-4 flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Buscar por código o nombre..."
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                className="pl-9"
              />
            </div>
            <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v as any); setPage(1); }}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder="Estado" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="active">Activos</SelectItem>
                <SelectItem value="inactive">Inactivos</SelectItem>
                <SelectItem value="expired">Caducados</SelectItem>
              </SelectContent>
            </Select>
          </CardContent>
        </Card>

        {/* Table */}
        <Card className="bg-card border-border">
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-8 text-center text-muted-foreground">Cargando...</div>
            ) : items.length === 0 ? (
              <div className="p-12 text-center">
                <Tag className="w-12 h-12 text-muted-foreground/30 mx-auto mb-3" />
                <p className="text-muted-foreground">No hay códigos de descuento todavía.</p>
                <Button onClick={openCreate} variant="outline" className="mt-4 gap-2">
                  <Plus className="w-4 h-4" /> Crear el primero
                </Button>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="border-border">
                    <TableHead>Código</TableHead>
                    <TableHead>Nombre</TableHead>
                    <TableHead className="text-center">Descuento</TableHead>
                    <TableHead className="text-center">Usos</TableHead>
                    <TableHead>Caduca</TableHead>
                    <TableHead className="text-center">Estado</TableHead>
                    <TableHead className="text-right">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((item) => (
                    <TableRow key={item.id} className="border-border hover:bg-muted/20">
                      <TableCell>
                        <span className="font-mono font-bold text-violet-400 bg-violet-500/10 px-2 py-0.5 rounded text-sm">
                          {item.code}
                        </span>
                      </TableCell>
                      <TableCell>
                        <div>
                          <p className="font-medium text-foreground text-sm">{item.name}</p>
                          {item.description && (
                            <p className="text-xs text-muted-foreground truncate max-w-[200px]">{item.description}</p>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-center">
                        <span className="font-bold text-emerald-400 text-lg">{item.discountPercent}%</span>
                      </TableCell>
                      <TableCell className="text-center">
                        <span className="text-sm text-foreground">
                          {item.currentUses}
                          {item.maxUses !== null && <span className="text-muted-foreground"> / {item.maxUses}</span>}
                        </span>
                      </TableCell>
                      <TableCell>
                        {item.expiresAt ? (
                          <span className="text-sm text-muted-foreground">
                            {new Date(item.expiresAt).toLocaleDateString("es-ES")}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground/50">Sin caducidad</span>
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        <StatusBadge status={item.status} />
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost" size="icon" title="Ver usos"
                            onClick={() => setShowUses(item.id)}
                          >
                            <Eye className="w-4 h-4 text-blue-400" />
                          </Button>
                          <Button
                            variant="ghost" size="icon" title="Editar"
                            onClick={() => openEdit(item)}
                          >
                            <Edit2 className="w-4 h-4 text-yellow-400" />
                          </Button>
                          <Button
                            variant="ghost" size="icon" title="Duplicar"
                            onClick={() => duplicateMutation.mutate({ id: item.id })}
                          >
                            <Copy className="w-4 h-4 text-muted-foreground" />
                          </Button>
                          <Button
                            variant="ghost" size="icon"
                            title={item.status === "active" ? "Desactivar" : "Activar"}
                            onClick={() => toggleMutation.mutate({ id: item.id, active: item.status !== "active" })}
                          >
                            {item.status === "active"
                              ? <ToggleRight className="w-4 h-4 text-green-400" />
                              : <ToggleLeft className="w-4 h-4 text-yellow-400" />
                            }
                          </Button>
                          <Button
                            variant="ghost" size="icon" title="Eliminar"
                            onClick={() => {
                              if (confirm(`¿Eliminar el código "${item.code}"?`)) {
                                deleteMutation.mutate({ id: item.id });
                              }
                            }}
                          >
                            <Trash2 className="w-4 h-4 text-red-400" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex justify-center gap-2">
            <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage(p => p - 1)}>Anterior</Button>
            <span className="text-sm text-muted-foreground self-center">Página {page} de {totalPages}</span>
            <Button variant="outline" size="sm" disabled={page === totalPages} onClick={() => setPage(p => p + 1)}>Siguiente</Button>
          </div>
        )}
      </div>

      {/* ── Form Dialog ─────────────────────────────────────────────────────── */}
      <Dialog open={showForm} onOpenChange={(open) => { if (!open) closeForm(); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingId ? "Editar código de descuento" : "Nuevo código de descuento"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Código <span className="text-red-400">*</span></Label>
                <Input
                  placeholder="VERANO25"
                  value={form.code}
                  onChange={(e) => setForm(f => ({ ...f, code: e.target.value.toUpperCase() }))}
                  disabled={!!editingId}
                  className="font-mono uppercase"
                />
                <p className="text-xs text-muted-foreground">Solo letras, números y guiones</p>
              </div>
              <div className="space-y-1.5">
                <Label>Descuento (%) <span className="text-red-400">*</span></Label>
                <div className="relative">
                  <Input
                    type="number" min="1" max="100" step="0.5"
                    placeholder="10"
                    value={form.discountPercent}
                    onChange={(e) => setForm(f => ({ ...f, discountPercent: e.target.value }))}
                  />
                  <Percent className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                </div>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Nombre interno <span className="text-red-400">*</span></Label>
              <Input
                placeholder="Campaña verano 2026"
                value={form.name}
                onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Descripción</Label>
              <Input
                placeholder="Descripción breve del código"
                value={form.description}
                onChange={(e) => setForm(f => ({ ...f, description: e.target.value }))}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Fecha de caducidad</Label>
                <Input
                  type="date"
                  value={form.expiresAt}
                  onChange={(e) => setForm(f => ({ ...f, expiresAt: e.target.value }))}
                />
                <p className="text-xs text-muted-foreground">Dejar vacío = sin caducidad</p>
              </div>
              <div className="space-y-1.5">
                <Label>Uso máximo</Label>
                <Input
                  type="number" min="1"
                  placeholder="Sin límite"
                  value={form.maxUses}
                  onChange={(e) => setForm(f => ({ ...f, maxUses: e.target.value }))}
                />
                <p className="text-xs text-muted-foreground">Dejar vacío = usos ilimitados</p>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Observaciones internas</Label>
              <Textarea
                placeholder="Notas internas sobre este código..."
                value={form.observations}
                onChange={(e) => setForm(f => ({ ...f, observations: e.target.value }))}
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeForm}>Cancelar</Button>
            <Button
              onClick={handleSubmit}
              disabled={createMutation.isPending || updateMutation.isPending}
              className="bg-violet-600 hover:bg-violet-700 text-white"
            >
              {editingId ? "Guardar cambios" : "Crear código"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Uses Dialog ─────────────────────────────────────────────────────── */}
      <Dialog open={showUses !== null} onOpenChange={(open) => { if (!open) setShowUses(null); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Users className="w-5 h-5 text-blue-400" /> Historial de usos
            </DialogTitle>
          </DialogHeader>
          <div className="max-h-96 overflow-y-auto">
            {!usesData || usesData.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">Este código no ha sido usado todavía.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Fecha</TableHead>
                    <TableHead>Canal</TableHead>
                    <TableHead className="text-right">Original</TableHead>
                    <TableHead className="text-right">Descuento</TableHead>
                    <TableHead className="text-right">Final</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {usesData.map((use) => (
                    <TableRow key={use.id}>
                      <TableCell className="text-sm text-muted-foreground">
                        {new Date(use.appliedAt).toLocaleString("es-ES")}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs capitalize">{use.channel}</Badge>
                      </TableCell>
                      <TableCell className="text-right text-sm">{parseFloat(use.originalAmount as unknown as string).toFixed(2)} €</TableCell>
                      <TableCell className="text-right text-sm text-red-400">-{parseFloat(use.discountAmount as unknown as string).toFixed(2)} €</TableCell>
                      <TableCell className="text-right text-sm font-bold text-green-400">{parseFloat(use.finalAmount as unknown as string).toFixed(2)} €</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowUses(null)}>Cerrar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
