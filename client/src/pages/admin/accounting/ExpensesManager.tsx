import { toast } from "sonner";
/**
 * ExpensesManager — Gestión de Gastos
 * v21.0 — Módulo Financiero Nayade Experiences
 */
import { useState, useRef } from "react";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

import {
  Plus, Pencil, Trash2, Search, Filter, Upload, FileText, X, Euro,
  TrendingDown, Calendar, ChevronDown, Banknote, LinkIcon,
} from "lucide-react";
import { useLocation } from "wouter";

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash: "Efectivo",
  card: "Tarjeta",
  transfer: "Transferencia",
  direct_debit: "Domiciliación",
  tpv_cash: "TPV Caja",
};

const STATUS_LABELS: Record<string, string> = {
  pending: "Pendiente",
  justified: "Justificado",
  accounted: "Contabilizado",
  conciliado: "Conciliado",
};

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-800",
  justified: "bg-blue-100 text-blue-800",
  accounted: "bg-green-100 text-green-800",
  conciliado: "bg-emerald-100 text-emerald-800",
};

type ExpenseForm = {
  date: string;
  concept: string;
  amount: string;
  categoryId: string;
  costCenterId: string;
  supplierId: string;
  paymentMethod: string;
  status: string;
  notes: string;
};

const emptyForm: ExpenseForm = {
  date: new Date().toISOString().slice(0, 10),
  concept: "",
  amount: "",
  categoryId: "",
  costCenterId: "",
  supplierId: "",
  paymentMethod: "transfer",
  status: "pending",
  notes: "",
};

export default function ExpensesManager() {
  
  const [, setLocation] = useLocation();

  // Filters
  const [search, setSearch] = useState("");
  const [filterCategory, setFilterCategory] = useState<string>("all");
  const [filterCostCenter, setFilterCostCenter] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [filterDateFrom, setFilterDateFrom] = useState("");
  const [filterDateTo, setFilterDateTo] = useState("");
  const [showFilters, setShowFilters] = useState(false);

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<ExpenseForm>(emptyForm);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Bank detection state
  const [showBankDetected, setShowBankDetected] = useState(true);
  const [createFromMovId, setCreateFromMovId] = useState<number | null>(null);
  const [movForm, setMovForm] = useState({
    concept: "",
    categoryId: "",
    costCenterId: "",
    supplierId: "",
    paymentMethod: "transfer",
    notes: "",
  });

  // Queries
  const categoriesQ = trpc.financial.categories.list.useQuery();
  const costCentersQ = trpc.financial.costCenters.list.useQuery();
  const suppliersQ = trpc.financial.suppliers.list.useQuery();
  const expensesQ = trpc.financial.expenses.list.useQuery({
    dateFrom: filterDateFrom || undefined,
    dateTo: filterDateTo || undefined,
    categoryId: filterCategory !== "all" ? Number(filterCategory) : undefined,
    costCenterId: filterCostCenter !== "all" ? Number(filterCostCenter) : undefined,
    status: filterStatus !== "all" ? (filterStatus as "pending" | "justified" | "accounted") : undefined,
    limit: 200,
  });

  const utils = trpc.useUtils();

  const createMut = trpc.financial.expenses.create.useMutation({
    onSuccess: () => { utils.financial.expenses.list.invalidate(); },
  });
  const updateMut = trpc.financial.expenses.update.useMutation({
    onSuccess: () => { utils.financial.expenses.list.invalidate(); },
  });
  const deleteMut = trpc.financial.expenses.delete.useMutation({
    onSuccess: () => { utils.financial.expenses.list.invalidate(); },
  });
  const uploadFileMut = trpc.financial.expenses.uploadFile.useMutation();
  const deleteFileMut = trpc.financial.expenses.deleteFile.useMutation({
    onSuccess: () => { utils.financial.expenses.list.invalidate(); },
  });

  const bankCandidatesQ = trpc.bankMovements.listExpenseCandidates.useQuery(
    { page: 1, pageSize: 30 },
    { refetchInterval: 120_000 }
  );

  const createFromMovMut = trpc.bankMovements.createExpenseFromMovement.useMutation({
    onSuccess: () => {
      utils.financial.expenses.list.invalidate();
      bankCandidatesQ.refetch();
      setCreateFromMovId(null);
      toast.success("Gasto creado y vinculado al movimiento bancario");
    },
    onError: (e) => toast.error("Error: " + e.message),
  });

  const ignoreBankMut = trpc.bankMovements.ignoreForExpense.useMutation({
    onSuccess: () => {
      bankCandidatesQ.refetch();
      toast.success("Movimiento ignorado");
    },
    onError: (e) => toast.error("Error: " + e.message),
  });

  const categories = categoriesQ.data ?? [];
  const costCenters = costCentersQ.data ?? [];
  const suppliers = suppliersQ.data ?? [];
  const expenses = expensesQ.data?.items ?? [];
  const total = expensesQ.data?.total ?? 0;

  // Filtered by search
  const filtered = expenses.filter((e) =>
    !search || e.concept.toLowerCase().includes(search.toLowerCase())
  );

  const totalAmount = filtered.reduce((sum, e) => sum + parseFloat(e.amount), 0);

  function openCreate() {
    setEditingId(null);
    setForm(emptyForm);
    setPendingFiles([]);
    setDialogOpen(true);
  }

  function openEdit(e: typeof expenses[number]) {
    setEditingId(e.id);
    setForm({
      date: e.date,
      concept: e.concept,
      amount: e.amount,
      categoryId: String(e.categoryId),
      costCenterId: String(e.costCenterId),
      supplierId: e.supplierId ? String(e.supplierId) : "",
      paymentMethod: e.paymentMethod,
      status: e.status,
      notes: e.notes ?? "",
    });
    setPendingFiles([]);
    setDialogOpen(true);
  }

  async function handleSave() {
    if (!form.concept || !form.amount || !form.categoryId || !form.costCenterId || !form.date) {
      toast.error("Campos requeridos: Rellena concepto, importe, categoría, centro de coste y fecha.");
      return;
    }

    const payload = {
      date: form.date,
      concept: form.concept,
      amount: form.amount,
      categoryId: Number(form.categoryId),
      costCenterId: Number(form.costCenterId),
      supplierId: form.supplierId ? Number(form.supplierId) : null,
      paymentMethod: form.paymentMethod as "cash" | "card" | "transfer" | "direct_debit" | "tpv_cash",
      status: form.status as "pending" | "justified" | "accounted",
      notes: form.notes,
    };

    let expenseId: number;
    if (editingId) {
      await updateMut.mutateAsync({ id: editingId, ...payload });
      expenseId = editingId;
      toast.success("Gasto actualizado");
    } else {
      const res = await createMut.mutateAsync(payload);
      expenseId = res.id;
      toast.success("Gasto creado");
    }

    // Upload pending files
    for (const file of pendingFiles) {
      const base64 = await fileToBase64(file);
      await uploadFileMut.mutateAsync({
        expenseId,
        fileName: file.name,
        mimeType: file.type,
        base64,
      });
    }

    utils.financial.expenses.list.invalidate();
    setDialogOpen(false);
  }

  async function handleDelete(id: number) {
    if (!confirm("¿Eliminar este gasto y sus adjuntos?")) return;
    await deleteMut.mutateAsync({ id });
    toast.success("Gasto eliminado");
  }

  function handleFilesDrop(e: React.DragEvent) {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files);
    setPendingFiles((prev) => [...prev, ...files]);
  }

  function handleFilesInput(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    setPendingFiles((prev) => [...prev, ...files]);
  }

  function fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve((reader.result as string).split(",")[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function getCategoryName(id: number) {
    return categories.find((c) => c.id === id)?.name ?? `Cat. ${id}`;
  }
  function getCostCenterName(id: number) {
    return costCenters.find((c) => c.id === id)?.name ?? `CC ${id}`;
  }

  function openCreateFromMovement(m: NonNullable<typeof bankCandidatesQ.data>["data"][number]) {
    setCreateFromMovId(m.id);
    const desc = `${m.movimiento ?? ""} ${m.masDatos ?? ""}`.trim().slice(0, 120);
    // Try to auto-select category by name
    const suggestedCat = m.suggestedCategoryName
      ? categories.find(c => c.name.toLowerCase().includes(m.suggestedCategoryName!.toLowerCase()))
      : undefined;
    setMovForm({
      concept: desc,
      categoryId: suggestedCat ? String(suggestedCat.id) : "",
      costCenterId: "",
      supplierId: "",
      paymentMethod: "transfer",
      notes: "",
    });
  }

  async function handleCreateFromMovement() {
    if (!createFromMovId || !movForm.concept || !movForm.categoryId || !movForm.costCenterId) {
      toast.error("Rellena concepto, categoría y centro de coste");
      return;
    }
    await createFromMovMut.mutateAsync({
      bankMovementId: createFromMovId,
      concept: movForm.concept,
      categoryId: Number(movForm.categoryId),
      costCenterId: Number(movForm.costCenterId),
      supplierId: movForm.supplierId ? Number(movForm.supplierId) : null,
      paymentMethod: movForm.paymentMethod as "cash" | "card" | "transfer" | "direct_debit" | "tpv_cash",
      notes: movForm.notes || undefined,
    });
  }

  return (
    <AdminLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <TrendingDown className="w-6 h-6 text-red-500" />
              Gastos
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              {total} gastos · Total filtrado: <strong>{totalAmount.toFixed(2)} €</strong>
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setLocation("/admin/contabilidad/gastos/categorias")}>
              Categorías
            </Button>
            <Button variant="outline" size="sm" onClick={() => setLocation("/admin/contabilidad/gastos/proveedores")}>
              Proveedores
            </Button>
            <Button variant="outline" size="sm" onClick={() => setLocation("/admin/contabilidad/gastos/recurrentes")}>
              Recurrentes
            </Button>
            <Button onClick={openCreate} className="gap-2">
              <Plus className="w-4 h-4" /> Nuevo gasto
            </Button>
          </div>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          {["pending", "justified", "accounted", "conciliado"].map((s) => {
            const count = filtered.filter((e) => e.status === s).length;
            const amt = filtered.filter((e) => e.status === s).reduce((sum, e) => sum + parseFloat(e.amount), 0);
            return (
              <Card key={s} className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => setFilterStatus(filterStatus === s ? "all" : s)}>
                <CardContent className="pt-4">
                  <p className="text-xs text-muted-foreground">{STATUS_LABELS[s]}</p>
                  <p className="text-xl font-bold">{amt.toFixed(2)} €</p>
                  <p className="text-xs text-muted-foreground">{count} gastos</p>
                </CardContent>
              </Card>
            );
          })}
          <Card>
            <CardContent className="pt-4">
              <p className="text-xs text-muted-foreground">Total periodo</p>
              <p className="text-xl font-bold text-red-600">{totalAmount.toFixed(2)} €</p>
              <p className="text-xs text-muted-foreground">{filtered.length} gastos</p>
            </CardContent>
          </Card>
        </div>

        {/* Detectados por banco */}
        {(bankCandidatesQ.data?.total ?? 0) > 0 && (
          <Card className="border-blue-500/30 bg-blue-500/5">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium flex items-center gap-2 text-blue-300">
                  <Banknote className="w-4 h-4" />
                  Detectados por banco
                  <span className="inline-flex items-center justify-center w-5 h-5 text-xs rounded-full bg-blue-500/30 text-blue-200">
                    {bankCandidatesQ.data!.total}
                  </span>
                </CardTitle>
                <button
                  onClick={() => setShowBankDetected(!showBankDetected)}
                  className="text-xs text-blue-400 hover:text-blue-200 flex items-center gap-1"
                >
                  {showBankDetected ? "Ocultar" : "Ver movimientos"}
                  <ChevronDown className={`w-3 h-3 transition-transform ${showBankDetected ? "rotate-180" : ""}`} />
                </button>
              </div>
              {!showBankDetected && (
                <p className="text-xs text-zinc-500 mt-1">
                  Movimientos bancarios negativos sin gasto vinculado — haz clic para revisar
                </p>
              )}
            </CardHeader>
            {showBankDetected && (
              <CardContent className="pt-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-zinc-700/50">
                        <th className="text-left py-2 px-2 text-xs text-zinc-400 font-medium">Fecha</th>
                        <th className="text-right py-2 px-2 text-xs text-zinc-400 font-medium">Importe</th>
                        <th className="text-left py-2 px-2 text-xs text-zinc-400 font-medium">Descripción banco</th>
                        <th className="text-left py-2 px-2 text-xs text-zinc-400 font-medium">Categ. sugerida</th>
                        <th className="py-2 px-2"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {bankCandidatesQ.data!.data.map((m) => (
                        <tr key={m.id} className="border-b border-zinc-800/50 hover:bg-blue-500/5">
                          <td className="py-2 px-2 whitespace-nowrap text-zinc-300 text-xs">{m.fecha}</td>
                          <td className="py-2 px-2 text-right font-semibold text-red-400 text-xs whitespace-nowrap">
                            {Math.abs(parseFloat(m.importe)).toLocaleString("es-ES", { minimumFractionDigits: 2 })} €
                          </td>
                          <td className="py-2 px-2 text-zinc-400 text-xs max-w-[220px] truncate" title={`${m.movimiento ?? ""} ${m.masDatos ?? ""}`.trim()}>
                            {(m.movimiento ?? m.masDatos ?? "—").slice(0, 60)}
                          </td>
                          <td className="py-2 px-2 text-xs text-zinc-500">
                            {m.suggestedCategoryName ?? "—"}
                          </td>
                          <td className="py-2 px-2">
                            <div className="flex gap-1 justify-end whitespace-nowrap">
                              <Button
                                size="sm"
                                variant="outline"
                                className="text-xs h-6 px-2 border-blue-500/40 text-blue-300 hover:text-blue-100 hover:border-blue-400"
                                onClick={() => openCreateFromMovement(m)}
                              >
                                Crear gasto
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="text-xs h-6 px-2 text-zinc-500 hover:text-zinc-300"
                                onClick={() => ignoreBankMut.mutate({ bankMovementId: m.id })}
                                disabled={ignoreBankMut.isPending}
                              >
                                Ignorar
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            )}
          </Card>
        )}

        {/* Search & Filters */}
        <div className="space-y-3">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Buscar por concepto..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <Button variant="outline" onClick={() => setShowFilters(!showFilters)} className="gap-2">
              <Filter className="w-4 h-4" />
              Filtros
              <ChevronDown className={`w-4 h-4 transition-transform ${showFilters ? "rotate-180" : ""}`} />
            </Button>
          </div>

          {showFilters && (
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 p-4 bg-muted/30 rounded-lg border">
              <div>
                <Label className="text-xs">Desde</Label>
                <Input type="date" value={filterDateFrom} onChange={(e) => setFilterDateFrom(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">Hasta</Label>
                <Input type="date" value={filterDateTo} onChange={(e) => setFilterDateTo(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">Categoría</Label>
                <Select value={filterCategory} onValueChange={setFilterCategory}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todas</SelectItem>
                    {categories.map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Centro de coste</Label>
                <Select value={filterCostCenter} onValueChange={setFilterCostCenter}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos</SelectItem>
                    {costCenters.map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Estado</Label>
                <Select value={filterStatus} onValueChange={setFilterStatus}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos</SelectItem>
                    <SelectItem value="pending">Pendiente</SelectItem>
                    <SelectItem value="justified">Justificado</SelectItem>
                    <SelectItem value="accounted">Contabilizado</SelectItem>
                    <SelectItem value="conciliado">Conciliado</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
        </div>

        {/* Expenses Table */}
        <div className="border rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left p-3 font-medium">Fecha</th>
                  <th className="text-left p-3 font-medium">Concepto</th>
                  <th className="text-left p-3 font-medium">Categoría</th>
                  <th className="text-left p-3 font-medium">Centro coste</th>
                  <th className="text-left p-3 font-medium">Método</th>
                  <th className="text-right p-3 font-medium">Importe</th>
                  <th className="text-center p-3 font-medium">Estado</th>
                  <th className="text-center p-3 font-medium">Adj.</th>
                  <th className="text-center p-3 font-medium sticky right-0 bg-muted/50">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {expensesQ.isLoading ? (
                  <tr><td colSpan={9} className="text-center p-8 text-muted-foreground">Cargando...</td></tr>
                ) : filtered.length === 0 ? (
                  <tr><td colSpan={9} className="text-center p-8 text-muted-foreground">No hay gastos con los filtros actuales</td></tr>
                ) : (
                  filtered.map((e) => (
                    <tr key={e.id} className="border-t hover:bg-muted/20">
                      <td className="p-3 whitespace-nowrap">{e.date}</td>
                      <td className="p-3 max-w-[200px] truncate" title={e.concept}>{e.concept}</td>
                      <td className="p-3 text-xs text-muted-foreground">{getCategoryName(e.categoryId)}</td>
                      <td className="p-3 text-xs text-muted-foreground">{getCostCenterName(e.costCenterId)}</td>
                      <td className="p-3 text-xs">{PAYMENT_METHOD_LABELS[e.paymentMethod]}</td>
                      <td className="p-3 text-right font-medium text-red-600">{parseFloat(e.amount).toFixed(2)} €</td>
                      <td className="p-3 text-center">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium inline-flex items-center gap-1 ${STATUS_COLORS[e.status] ?? "bg-gray-100 text-gray-800"}`}>
                          {e.status === "conciliado" && <LinkIcon className="w-2.5 h-2.5" />}
                          {STATUS_LABELS[e.status] ?? e.status}
                        </span>
                      </td>
                      <td className="p-3 text-center">
                        {e.files.length > 0 ? (
                          <span className="flex items-center justify-center gap-1 text-blue-600">
                            <FileText className="w-3 h-3" /> {e.files.length}
                          </span>
                        ) : "—"}
                      </td>
                      <td className="p-3 text-center sticky right-0 bg-background border-l">
                        <div className="flex gap-1 justify-center">
                          <Button size="sm" variant="ghost" onClick={() => openEdit(e)}>
                            <Pencil className="w-3 h-3" />
                          </Button>
                          <Button size="sm" variant="ghost" className="text-red-500 hover:text-red-700" onClick={() => handleDelete(e.id)}>
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingId ? "Editar gasto" : "Nuevo gasto"}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Fecha *</Label>
                <Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
              </div>
              <div>
                <Label>Importe (€) *</Label>
                <Input
                  type="number"
                  step="0.01"
                  placeholder="0.00"
                  value={form.amount}
                  onChange={(e) => setForm({ ...form, amount: e.target.value })}
                />
              </div>
            </div>

            <div>
              <Label>Concepto *</Label>
              <Input
                placeholder="Descripción del gasto"
                value={form.concept}
                onChange={(e) => setForm({ ...form, concept: e.target.value })}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Categoría *</Label>
                <Select value={form.categoryId} onValueChange={(v) => setForm({ ...form, categoryId: v })}>
                  <SelectTrigger><SelectValue placeholder="Seleccionar..." /></SelectTrigger>
                  <SelectContent>
                    {categories.map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Centro de coste *</Label>
                <Select value={form.costCenterId} onValueChange={(v) => setForm({ ...form, costCenterId: v })}>
                  <SelectTrigger><SelectValue placeholder="Seleccionar..." /></SelectTrigger>
                  <SelectContent>
                    {costCenters.map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Proveedor</Label>
                <Select value={form.supplierId || "none"} onValueChange={(v) => setForm({ ...form, supplierId: v === "none" ? "" : v })}>
                  <SelectTrigger><SelectValue placeholder="Sin proveedor" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Sin proveedor</SelectItem>
                    {suppliers.map((s) => <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Método de pago</Label>
                <Select value={form.paymentMethod} onValueChange={(v) => setForm({ ...form, paymentMethod: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(PAYMENT_METHOD_LABELS).map(([k, v]) => (
                      <SelectItem key={k} value={k}>{v}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <Label>Estado</Label>
              <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="pending">Pendiente</SelectItem>
                  <SelectItem value="justified">Justificado</SelectItem>
                  <SelectItem value="accounted">Contabilizado</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Notas</Label>
              <Textarea
                placeholder="Observaciones adicionales..."
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                rows={2}
              />
            </div>

            {/* File attachments */}
            <div>
              <Label>Adjuntos (facturas, tickets...)</Label>
              <div
                className="mt-1 border-2 border-dashed rounded-lg p-4 text-center cursor-pointer hover:border-primary/50 transition-colors"
                onDragOver={(e) => e.preventDefault()}
                onDrop={handleFilesDrop}
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="w-6 h-6 mx-auto text-muted-foreground mb-1" />
                <p className="text-sm text-muted-foreground">Arrastra archivos aquí o haz clic para seleccionar</p>
                <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleFilesInput} />
              </div>
              {pendingFiles.length > 0 && (
                <div className="mt-2 space-y-1">
                  {pendingFiles.map((f, i) => (
                    <div key={i} className="flex items-center justify-between text-sm bg-muted/30 rounded px-2 py-1">
                      <span className="flex items-center gap-1"><FileText className="w-3 h-3" />{f.name}</span>
                      <button onClick={() => setPendingFiles((prev) => prev.filter((_, j) => j !== i))}>
                        <X className="w-3 h-3 text-muted-foreground hover:text-red-500" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
              <Button onClick={handleSave} disabled={createMut.isPending || updateMut.isPending}>
                {editingId ? "Guardar cambios" : "Crear gasto"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Dialog: Crear gasto desde movimiento bancario */}
      {createFromMovId !== null && (() => {
        const mov = bankCandidatesQ.data?.data.find(m => m.id === createFromMovId);
        if (!mov) return null;
        return (
          <Dialog open onOpenChange={(open) => { if (!open) setCreateFromMovId(null); }}>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Banknote className="w-4 h-4 text-blue-400" />
                  Crear gasto desde banco
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                {/* Movement summary */}
                <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3 space-y-1">
                  <div className="flex justify-between text-sm">
                    <span className="text-zinc-400">Fecha:</span>
                    <span className="text-zinc-200 font-medium">{mov.fecha}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-zinc-400">Importe:</span>
                    <span className="text-red-400 font-bold">
                      {Math.abs(parseFloat(mov.importe)).toLocaleString("es-ES", { minimumFractionDigits: 2 })} €
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-zinc-400">Banco:</span>
                    <span className="text-zinc-300 text-right max-w-[240px] truncate text-xs">
                      {`${mov.movimiento ?? ""} ${mov.masDatos ?? ""}`.trim() || "—"}
                    </span>
                  </div>
                  {mov.suggestedCategoryName && (
                    <div className="flex justify-between text-sm">
                      <span className="text-zinc-400">Categ. sugerida:</span>
                      <span className="text-blue-300 text-xs">{mov.suggestedCategoryName}</span>
                    </div>
                  )}
                </div>

                <div>
                  <Label>Concepto *</Label>
                  <Input
                    value={movForm.concept}
                    onChange={(e) => setMovForm({ ...movForm, concept: e.target.value })}
                    placeholder="Descripción del gasto"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Categoría *</Label>
                    <Select value={movForm.categoryId} onValueChange={(v) => setMovForm({ ...movForm, categoryId: v })}>
                      <SelectTrigger><SelectValue placeholder="Seleccionar..." /></SelectTrigger>
                      <SelectContent>
                        {categories.map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Centro de coste *</Label>
                    <Select value={movForm.costCenterId} onValueChange={(v) => setMovForm({ ...movForm, costCenterId: v })}>
                      <SelectTrigger><SelectValue placeholder="Seleccionar..." /></SelectTrigger>
                      <SelectContent>
                        {costCenters.map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Proveedor</Label>
                    <Select value={movForm.supplierId || "none"} onValueChange={(v) => setMovForm({ ...movForm, supplierId: v === "none" ? "" : v })}>
                      <SelectTrigger><SelectValue placeholder="Sin proveedor" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Sin proveedor</SelectItem>
                        {suppliers.map((s) => <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Método de pago</Label>
                    <Select value={movForm.paymentMethod} onValueChange={(v) => setMovForm({ ...movForm, paymentMethod: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {Object.entries(PAYMENT_METHOD_LABELS).map(([k, v]) => (
                          <SelectItem key={k} value={k}>{v}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div>
                  <Label>Notas</Label>
                  <Input
                    value={movForm.notes}
                    onChange={(e) => setMovForm({ ...movForm, notes: e.target.value })}
                    placeholder="Observaciones..."
                  />
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <Button variant="outline" onClick={() => setCreateFromMovId(null)}>Cancelar</Button>
                  <Button
                    onClick={handleCreateFromMovement}
                    disabled={createFromMovMut.isPending}
                    className="bg-blue-600 hover:bg-blue-500 text-white"
                  >
                    <Banknote className="w-4 h-4 mr-2" />
                    {createFromMovMut.isPending ? "Creando..." : "Crear gasto vinculado"}
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        );
      })()}
    </AdminLayout>
  );
}
