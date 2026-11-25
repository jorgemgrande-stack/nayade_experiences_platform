import { toast } from "sonner";
/**
 * ExpensesManager — Gestión de Gastos
 * v21.0 — Módulo Financiero Nayade Experiences
 */
import { confirmAction } from "@/components/admin/ConfirmHost";
import { useState, useRef, useEffect } from "react";
import AdminLayout from "@/components/AdminLayout";
import { EconomyShell } from "@/components/admin/EconomyShell";
import { formatEur } from "@/lib/money";
import { StatusBadge, type Tone } from "@/components/admin/PanelUi";
import { FormFooter, MetricCard, PageOnlyTag, EconomyFilterBar, EconomySummary, EconomyTable, FilterField, FormField, FormSection, RowActions, type EconomyColumn, type FilterChip } from "./shared/EconomyUi";
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
  Mail, RefreshCw, CheckCircle2, AlertTriangle, Clock, ExternalLink, Eye, Calculator, Download, MoreHorizontal } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
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

const STATUS_TONES: Record<string, Tone> = {
  pending: "warning",
  justified: "info",
  accounted: "success",
  conciliado: "success",
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
  // ── Datos fiscales (IVA soportado) ──
  taxRate: string;
  deductiblePercent: string;
  invoiceType: string;
  supplierNif: string;
  retentionPercent: string;
  accrualDate: string;
  // ── Tratamiento operativo ──
  // true: computa en P&L/EBITDA/KPIs. false: "solo fiscal" (no afecta KPIs).
  isOperational: boolean;
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
  taxRate: "21",
  deductiblePercent: "100",
  invoiceType: "ordinaria",
  supplierNif: "",
  retentionPercent: "",
  accrualDate: "",
  isOperational: true,
};

/**
 * IVA soportado (cuota) de un gasto. Si el gasto tiene el desglose fiscal
 * guardado usa su `taxAmount`; si no, lo deriva del importe total y el tipo.
 * Los gastos de origen RRHH (nóminas, SS, bonus) no llevan IVA → 0.
 */
function ivaSoportado(e: any): number {
  if (typeof e?.source === "string" && e.source.startsWith("hr_")) return 0;
  if (e?.taxAmount != null && e.taxAmount !== "") return parseFloat(e.taxAmount) || 0;
  const total = parseFloat(e?.amount ?? "0") || 0;
  const rate = e?.taxRate != null && e.taxRate !== "" ? parseFloat(e.taxRate) || 0 : 21;
  return rate > 0 ? total - total / (1 + rate / 100) : 0;
}

/** Nombre comparable (sin mayúsculas, acentos ni espacios repetidos): avisa de duplicados en las altas rápidas. */
const sameName = (a: string, b: string) => {
  const n = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase().replace(/\s+/g, " ");
  return !!n(b) && n(a) === n(b);
};

/** Aviso de alta rápida duplicada con la opción de usar el registro que ya existe. */
function DuplicateNotice({ text, onUse }: { text: string; onUse: () => void }) {
  return (
    <p role="alert" className="text-xs text-warning">
      {text}{" "}
      <button type="button" className="font-medium underline" onClick={onUse}>Usar el existente</button>
    </p>
  );
}

export default function ExpensesManager() {
  
  const [, setLocation] = useLocation();

  // Filters
  const [search, setSearch] = useState("");
  const [filterCategory, setFilterCategory] = useState<string>("all");
  const [filterCostCenter, setFilterCostCenter] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [filterDateFrom, setFilterDateFrom] = useState("");
  const [filterDateTo, setFilterDateTo] = useState("");
  const [filterTreatment, setFilterTreatment] = useState<"all" | "operational" | "tax_only">("all");
  const [showFilters, setShowFilters] = useState(false);

  // Paginación (mismo patrón que CRM: limit/offset con state local de página)
  const PAGE_SIZE = 50;
  const [page, setPage] = useState(0);
  useEffect(() => { setPage(0); }, [filterDateFrom, filterDateTo, filterCategory, filterCostCenter, filterStatus, filterTreatment]);

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [showFormErrors, setShowFormErrors] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<ExpenseForm>(emptyForm);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  type ExistingFile = { id: number; filePath: string; fileName: string | null; mimeType: string | null };
  const [existingFiles, setExistingFiles] = useState<ExistingFile[]>([]);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  // Email ingestion state
  const [emailLogsOpen, setEmailLogsOpen] = useState(false);
  const [filterSource, setFilterSource] = useState<"all" | "email">("all");

  // Quick-create sub-dialogs
  const [quickCatOpen, setQuickCatOpen] = useState(false);
  const [quickCatName, setQuickCatName] = useState("");
  const [quickCatDesc, setQuickCatDesc] = useState("");
  const [quickCCOpen, setQuickCCOpen] = useState(false);
  const [quickCCName, setQuickCCName] = useState("");
  const [quickCCDesc, setQuickCCDesc] = useState("");
  const [quickSupOpen, setQuickSupOpen] = useState(false);
  const [quickSupName, setQuickSupName] = useState("");

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
    treatment: filterTreatment,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  });
  const distortionQ = trpc.financial.expenses.distortionKpi.useQuery({}, { staleTime: 60_000 });

  const utils = trpc.useUtils();

  const syncEmailMut = trpc.financial.emailIngestion.triggerSync.useMutation({
    onSuccess: (res) => {
      toast.success(`Sincronización completada: ${res.processed} nuevo(s), ${res.duplicated} duplicado(s)`);
      utils.financial.expenses.list.invalidate();
    },
    onError: (e) => toast.error("Error en sincronización: " + e.message),
  });

  const backfillMut = trpc.financial.expenses.backfillFiscal.useMutation({
    onSuccess: (res) => {
      toast.success(`Fiscalidad recalculada: ${res.updated} gasto(s) actualizado(s)`);
      utils.financial.expenses.list.invalidate();
    },
    onError: (e) => toast.error("Error al recalcular: " + e.message),
  });

  const emailLogsQ = trpc.financial.emailIngestion.listLogs.useQuery(
    { limit: 100 },
    { enabled: emailLogsOpen }
  );

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

  async function handleDeleteFile(fileId: number) {
    await deleteFileMut.mutateAsync({ fileId });
    setExistingFiles((prev) => prev.filter((f) => f.id !== fileId));
  }

  function isImage(mimeType: string | null) {
    return !!mimeType?.startsWith("image/");
  }

  const createCatMut = trpc.financial.categories.create.useMutation({
    onSuccess: (res) => {
      utils.financial.categories.list.invalidate();
      setForm((f) => ({ ...f, categoryId: String(res.id) }));
      setQuickCatOpen(false); setQuickCatName(""); setQuickCatDesc("");
      toast.success("Categoría creada");
    },
    onError: (e) => toast.error(e.message || "Error al crear categoría"),
  });
  const createCCMut = trpc.financial.costCenters.create.useMutation({
    onSuccess: (res) => {
      utils.financial.costCenters.list.invalidate();
      setForm((f) => ({ ...f, costCenterId: String(res.id) }));
      setQuickCCOpen(false); setQuickCCName(""); setQuickCCDesc("");
      toast.success("Centro de coste creado");
    },
    onError: (e) => toast.error(e.message || "Error al crear centro de coste"),
  });
  const createSupMut = trpc.financial.suppliers.create.useMutation({
    onSuccess: (res) => {
      utils.financial.suppliers.list.invalidate();
      setForm((f) => ({ ...f, supplierId: String(res.id) }));
      setQuickSupOpen(false); setQuickSupName("");
      toast.success("Proveedor creado");
    },
    onError: (e) => toast.error(e.message || "Error al crear proveedor"),
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
  const dupCat = quickCatOpen ? categories.find((c) => sameName(c.name, quickCatName)) : undefined;
  const dupCC = quickCCOpen ? costCenters.find((c) => sameName(c.name, quickCCName)) : undefined;
  const dupSup = quickSupOpen ? suppliers.find((s) => sameName(s.name, quickSupName)) : undefined;
  const expenses = expensesQ.data?.items ?? [];
  const total = expensesQ.data?.total ?? 0;

  // Filtered by search + source
  const filtered = expenses.filter((e) => {
    if (search && !e.concept.toLowerCase().includes(search.toLowerCase())) return false;
    if (filterSource === "email" && (e as any).source !== "email") return false;
    return true;
  });

  const totalAmount = filtered.reduce((sum, e) => sum + parseFloat(e.amount), 0);
  const totalIvaSoportado = filtered.reduce((sum, e) => sum + ivaSoportado(e), 0);

  function openCreate() {
    setShowFormErrors(false);
    setEditingId(null);
    setForm(emptyForm);
    setPendingFiles([]);
    setExistingFiles([]);
    setDialogOpen(true);
  }

  function openEdit(e: typeof expenses[number]) {
    setShowFormErrors(false);
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
      taxRate: e.taxRate != null ? String(e.taxRate) : "21",
      deductiblePercent: e.deductiblePercent != null ? String(e.deductiblePercent) : "100",
      invoiceType: e.invoiceType ?? "ordinaria",
      supplierNif: e.supplierNif ?? "",
      retentionPercent: e.retentionPercent != null ? String(e.retentionPercent) : "",
      accrualDate: e.accrualDate ?? "",
      isOperational: (e as any).isOperational ?? true,
    });
    setPendingFiles([]);
    setExistingFiles((e.files ?? []) as ExistingFile[]);
    setDialogOpen(true);
  }

  async function handleSave() {
    setShowFormErrors(true);
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
      // ── Datos fiscales (IVA soportado) ──
      taxRate: form.taxRate,
      deductiblePercent: form.deductiblePercent,
      invoiceType: form.invoiceType as "ordinaria" | "simplificada" | "intracomunitaria" | "importacion" | "exenta" | "sin_factura",
      supplierNif: form.supplierNif || undefined,
      retentionPercent: form.retentionPercent || undefined,
      accrualDate: form.accrualDate || undefined,
      isOperational: form.isOperational,
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
    if (!(await confirmAction({ description: "¿Eliminar este gasto y sus adjuntos?", destructive: true }))) return;
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
  function getSupplierName(id: number | null | undefined) {
    if (!id) return "—";
    return suppliers.find((s) => s.id === id)?.name ?? "—";
  }

  /**
   * Exporta los gastos filtrados a CSV (compatible Excel ES con BOM y `;`).
   * Incluye la columna "Imputación Operativa" para que la gestoría pueda
   * distinguir gastos operativos vs solo fiscales en su reporting.
   *
   * Pide al servidor el conjunto COMPLETO que coincide con los filtros del
   * servidor (fecha/categoría/centro de coste/estado/imputación) — `filtered`
   * solo contiene la página actualmente cargada (PAGE_SIZE=50), y exportar
   * directamente desde ahí truncaba el CSV aunque el contador de arriba
   * mostrara el total real.
   */
  async function exportToCSV() {
    if (total === 0) {
      toast.error("No hay gastos para exportar con los filtros actuales");
      return;
    }
    const full = await utils.financial.expenses.list.fetch({
      dateFrom: filterDateFrom || undefined,
      dateTo: filterDateTo || undefined,
      categoryId: filterCategory !== "all" ? Number(filterCategory) : undefined,
      costCenterId: filterCostCenter !== "all" ? Number(filterCostCenter) : undefined,
      status: filterStatus !== "all" ? (filterStatus as "pending" | "justified" | "accounted") : undefined,
      treatment: filterTreatment,
      limit: total,
      offset: 0,
    });
    // Mismos filtros de solo-cliente (búsqueda + origen) que aplica `filtered`.
    const toExport = (full.items as any[]).filter((e) => {
      if (search && !e.concept.toLowerCase().includes(search.toLowerCase())) return false;
      if (filterSource === "email" && e.source !== "email") return false;
      return true;
    });
    if (toExport.length === 0) {
      toast.error("No hay gastos para exportar con los filtros actuales");
      return;
    }
    const headers = [
      "Fecha", "Concepto", "Proveedor", "NIF Proveedor", "Categoría", "Centro de coste",
      "Método pago", "Estado", "Importe total (€)", "Base imponible (€)", "Tipo IVA (%)",
      "Cuota IVA (€)", "% Deducible", "% Retención IRPF", "Tipo factura",
      "Fecha devengo", "Imputación Operativa", "Origen", "Notas",
    ];
    const escape = (v: unknown) => {
      const s = v == null ? "" : String(v);
      // CSV ES: si tiene `;`, `"`, salto de línea → encerrar en comillas y doblar comillas.
      return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const rows = toExport.map((e: any) => [
      e.date,
      e.concept,
      getSupplierName(e.supplierId),
      e.supplierNif ?? "",
      getCategoryName(e.categoryId),
      getCostCenterName(e.costCenterId),
      PAYMENT_METHOD_LABELS[e.paymentMethod] ?? e.paymentMethod,
      STATUS_LABELS[e.status] ?? e.status,
      parseFloat(e.amount).toFixed(2).replace(".", ","),
      e.taxBase != null ? parseFloat(e.taxBase).toFixed(2).replace(".", ",") : "",
      e.taxRate != null ? e.taxRate : "",
      e.taxAmount != null ? parseFloat(e.taxAmount).toFixed(2).replace(".", ",") : "",
      e.deductiblePercent != null ? e.deductiblePercent : "",
      e.retentionPercent != null ? e.retentionPercent : "",
      e.invoiceType ?? "",
      e.accrualDate ?? "",
      e.isOperational === false ? "Solo fiscal" : "Operativo",
      e.source ?? "manual",
      e.notes ?? "",
    ]);
    const csv = [headers, ...rows].map((r) => r.map(escape).join(";")).join("\r\n");
    // BOM UTF-8 para que Excel ES detecte el encoding correctamente.
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const ts = new Date().toISOString().slice(0, 10);
    a.download = `gastos-${ts}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`${toExport.length} gasto(s) exportado(s)`);
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

  type ExpenseRow = (typeof filtered)[number];
  const dayChip = (v: string) => new Date(`${v}T00:00:00`).toLocaleDateString("es-ES");
  const clearFilters = () => {
    setSearch(""); setFilterCategory("all"); setFilterCostCenter("all"); setFilterStatus("all");
    setFilterDateFrom(""); setFilterDateTo(""); setFilterTreatment("all"); setFilterSource("all");
  };
  const chips: FilterChip[] = [
    ...(search ? [{ id: "q", label: `Búsqueda: ${search}`, onRemove: () => setSearch("") }] : []),
    ...(filterStatus !== "all" ? [{ id: "status", label: `Estado: ${STATUS_LABELS[filterStatus] ?? filterStatus}`, onRemove: () => setFilterStatus("all") }] : []),
    ...(filterCategory !== "all" ? [{ id: "cat", label: `Categoría: ${getCategoryName(Number(filterCategory))}`, onRemove: () => setFilterCategory("all") }] : []),
    ...(filterCostCenter !== "all" ? [{ id: "cc", label: `Centro: ${getCostCenterName(Number(filterCostCenter))}`, onRemove: () => setFilterCostCenter("all") }] : []),
    ...(filterDateFrom ? [{ id: "from", label: `Desde ${dayChip(filterDateFrom)}`, onRemove: () => setFilterDateFrom("") }] : []),
    ...(filterDateTo ? [{ id: "to", label: `Hasta ${dayChip(filterDateTo)}`, onRemove: () => setFilterDateTo("") }] : []),
    ...(filterSource === "email" ? [{ id: "src", label: "Origen: email", onRemove: () => setFilterSource("all") }] : []),
    ...(filterTreatment !== "all" ? [{ id: "treat", label: filterTreatment === "tax_only" ? "Solo fiscales" : "Solo operativos", onRemove: () => setFilterTreatment("all") }] : []),
  ];

  const columns: EconomyColumn<ExpenseRow>[] = [
    {
      key: "fecha",
      header: "Fecha",
      mobile: "title",
      cell: (e) => (
        <>
          <span className="whitespace-nowrap text-muted-foreground @2xl:text-foreground">{e.date}</span>
          <span className="mt-0.5 block text-sm font-medium text-foreground @2xl:hidden">{e.concept}</span>
        </>
      ),
    },
    {
      key: "concepto",
      header: "Concepto",
      mobile: "hidden",
      className: "max-w-[16rem]",
      cell: (e) => (
        <>
          <div className="flex min-w-0 items-center gap-1.5" title={e.concept}>
            {(e as any).source === "email" && <StatusBadge tone="info" icon={<Mail />}>Email</StatusBadge>}
            {(e as any).isOperational === false && (
              <span title="Gasto solo fiscal — no computa en P&L operativo, EBITDA ni KPIs del negocio. Sí computa en gestoría, IVA y tesorería.">
                <StatusBadge tone="warning">Solo fiscal</StatusBadge>
              </span>
            )}
            <span className="overflow-hidden text-ellipsis whitespace-nowrap">{e.concept}</span>
          </div>
          {(e as any).missingAttachment && (
            <div className="mt-0.5 flex items-center gap-1 text-xs text-warning">
              <AlertTriangle className="h-3 w-3" /> Sin adjunto
            </div>
          )}
        </>
      ),
    },
    {
      key: "proveedor",
      header: "Proveedor",
      priority: "lg",
      className: "max-w-[10rem]",
      cell: (e) => <span className="block overflow-hidden text-ellipsis whitespace-nowrap text-xs text-muted-foreground" title={getSupplierName((e as any).supplierId)}>{getSupplierName((e as any).supplierId)}</span>,
    },
    { key: "categoria", header: "Categoría", priority: "md", cell: (e) => <span className="text-xs text-muted-foreground">{getCategoryName(e.categoryId)}</span> },
    { key: "metodo", header: "Método", priority: "xl", cell: (e) => <span className="text-xs">{PAYMENT_METHOD_LABELS[e.paymentMethod]}</span> },
    {
      key: "importe",
      header: "Importe",
      align: "right",
      num: true,
      mobile: "amount",
      cell: (e) => <span className="font-semibold text-danger">{formatEur(parseFloat(e.amount))}</span>,
    },
    {
      key: "iva",
      header: "IVA soportado",
      align: "right",
      num: true,
      priority: "lg",
      cell: (e) => {
        const iva = ivaSoportado(e);
        const rate = (e as any).taxRate != null && (e as any).taxRate !== "" ? parseFloat((e as any).taxRate) : 21;
        const isHr = typeof (e as any).source === "string" && (e as any).source.startsWith("hr_");
        if (isHr || iva === 0) return <span className="text-xs text-muted-foreground">— sin IVA</span>;
        return <span className="text-xs font-medium text-success" title={`Tipo ${rate}%`}>{formatEur(iva)}</span>;
      },
    },
    {
      key: "estado",
      header: "Estado",
      cell: (e) => (
        <StatusBadge tone={STATUS_TONES[e.status] ?? "neutral"} icon={e.status === "conciliado" ? <LinkIcon /> : undefined}>
          {STATUS_LABELS[e.status] ?? e.status}
        </StatusBadge>
      ),
    },
    {
      key: "adj",
      header: "Adj.",
      align: "center",
      priority: "md",
      cell: (e) =>
        e.files.length > 0 ? (
          <span className="inline-flex items-center gap-1 text-info"><FileText className="h-3.5 w-3.5" /><span className="text-xs font-medium">{e.files.length}</span></span>
        ) : <span className="text-muted-foreground">—</span>,
    },
  ];

  return (
    <AdminLayout>
      <EconomyShell screen="expenses"
        description={<>{total} gastos · Total: <strong>{formatEur(totalAmount)}</strong>{" · "}IVA soportado: <strong className="text-success">{formatEur(totalIvaSoportado)}</strong> <PageOnlyTag /></>}
        action={
            <>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="gap-1.5" aria-label="Más acciones de gastos">
                    <MoreHorizontal className="h-4 w-4" aria-hidden="true" /> Más
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => setLocation("/admin/contabilidad/gastos/categorias")}>Categorías</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setLocation("/admin/contabilidad/gastos/proveedores")}>Proveedores</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setLocation("/admin/contabilidad/gastos/recurrentes")}>Recurrentes</DropdownMenuItem>
                  <DropdownMenuItem disabled={syncEmailMut.isPending} onSelect={() => syncEmailMut.mutate()}>
                    {syncEmailMut.isPending ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : <Mail className="mr-2 h-4 w-4" aria-hidden="true" />}
                    {syncEmailMut.isPending ? "Sincronizando..." : "Sincronizar por email"}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={backfillMut.isPending}
                    onSelect={async () => {
                      if (await confirmAction({ description: "¿Recalcular la fiscalidad de los gastos antiguos sin desglose? Se estimará el IVA al 21 % y quedarán marcados como pendientes de revisar." })) {
                        backfillMut.mutate();
                      }
                    }}
                  >
                    {backfillMut.isPending ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : <Calculator className="mr-2 h-4 w-4" aria-hidden="true" />}
                    {backfillMut.isPending ? "Recalculando..." : "Recalcular fiscalidad"}
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setEmailLogsOpen(true)}>
                    <Clock className="mr-2 h-4 w-4" aria-hidden="true" /> Historial de emails procesados
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <Button
                variant="outline"
                size="sm"
                onClick={exportToCSV}
                className="gap-2"
                title="Exportar a CSV los gastos filtrados (incluye columna Imputación Operativa para gestoría)"
              >
                <Download className="w-3.5 h-3.5" />
                Exportar CSV
              </Button>
              <Button onClick={openCreate} className="gap-2">
                <Plus className="w-4 h-4" /> Nuevo gasto
              </Button>
            </>
          }>
      <div className="space-y-6">

        {/* Resumen */}
        <EconomySummary>
          <MetricCard icon={<TrendingDown />} tone="danger" label="Total periodo" value={`${formatEur(totalAmount)}`} detail={<>{filtered.length} gastos · IVA soportado {formatEur(totalIvaSoportado)} <PageOnlyTag /></>} />
          {(["pending", "justified", "accounted", "conciliado"] as const).map((s) => {
            const rowsOf = filtered.filter((e) => e.status === s);
            const amt = rowsOf.reduce((sum, e) => sum + parseFloat(e.amount), 0);
            return (
              <MetricCard
                key={s}
                icon={s === "pending" ? <Clock /> : s === "justified" ? <FileText /> : s === "accounted" ? <Calculator /> : <LinkIcon />}
                tone={STATUS_TONES[s]}
                label={STATUS_LABELS[s]}
                value={`${formatEur(amt)}`}
                detail={<>{rowsOf.length} gastos <PageOnlyTag /></>}
                active={filterStatus === s}
                onClick={() => setFilterStatus(filterStatus === s ? "all" : s)}
              />
            );
          })}
        </EconomySummary>

        {/* KPI Distorsión fiscal — mes + año en curso */}
        {distortionQ.data && distortionQ.data.year_.count > 0 && (
          <Card className="border-warning/50 bg-warning/10">
            <CardContent className="pt-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-warning" />
                  <span className="text-sm font-semibold text-foreground">Distorsión fiscal</span>
                  <span className="text-xs text-muted-foreground hidden md:inline">
                    Gastos marcados como "Solo fiscal" · {distortionQ.data.year}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-x-6 text-sm">
                  <div>
                    <div className="text-xs text-muted-foreground">Este mes</div>
                    <div className="font-semibold text-warning">
                      {formatEur(distortionQ.data.month_.amount)}
                      <span className="text-xs text-muted-foreground font-normal ml-1">
                        ({distortionQ.data.month_.count})
                      </span>
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Este año</div>
                    <div className="font-semibold text-warning">
                      {formatEur(distortionQ.data.year_.amount)}
                      <span className="text-xs text-muted-foreground font-normal ml-1">
                        ({distortionQ.data.year_.count})
                      </span>
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">s/operativo</div>
                    <div className="font-semibold text-warning">
                      {distortionQ.data.pctOfOperational.toFixed(1)} %
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setFilterTreatment(filterTreatment === "tax_only" ? "all" : "tax_only")}
                  className="text-xs text-warning hover:text-warning underline whitespace-nowrap"
                >
                  {filterTreatment === "tax_only" ? "Quitar filtro" : "Filtrar →"}
                </button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Detectados por banco */}
        {(bankCandidatesQ.data?.total ?? 0) > 0 && (
          <Card className="border-info/30 bg-info/5">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium flex items-center gap-2 text-info">
                  <Banknote className="w-4 h-4" />
                  Detectados por banco
                  <span className="inline-flex items-center justify-center w-5 h-5 text-xs rounded-full bg-info/30 text-info">
                    {bankCandidatesQ.data!.total}
                  </span>
                </CardTitle>
                <button
                  onClick={() => setShowBankDetected(!showBankDetected)}
                  className="text-xs text-info hover:text-info flex items-center gap-1"
                >
                  {showBankDetected ? "Ocultar" : "Ver movimientos"}
                  <ChevronDown className={`w-3 h-3 transition-transform ${showBankDetected ? "rotate-180" : ""}`} />
                </button>
              </div>
              {!showBankDetected && (
                <p className="text-xs text-muted-foreground mt-1">
                  Movimientos bancarios negativos sin gasto vinculado — haz clic para revisar
                </p>
              )}
            </CardHeader>
            {showBankDetected && (
              <CardContent className="pt-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="text-left py-2 px-2 text-xs text-muted-foreground font-medium">Fecha</th>
                        <th className="text-right py-2 px-2 text-xs text-muted-foreground font-medium">Importe</th>
                        <th className="text-left py-2 px-2 text-xs text-muted-foreground font-medium">Descripción banco</th>
                        <th className="text-left py-2 px-2 text-xs text-muted-foreground font-medium">Categ. sugerida</th>
                        <th className="py-2 px-2"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {bankCandidatesQ.data!.data.map((m) => (
                        <tr key={m.id} className="border-b border-border hover:bg-info/5">
                          <td className="py-2 px-2 whitespace-nowrap text-foreground text-xs">{m.fecha}</td>
                          <td className="py-2 px-2 text-right font-semibold text-danger text-xs whitespace-nowrap">
                            {formatEur(Math.abs(parseFloat(m.importe)))}
                          </td>
                          <td className="py-2 px-2 text-muted-foreground text-xs max-w-[220px] overflow-hidden text-ellipsis whitespace-nowrap" title={`${m.movimiento ?? ""} ${m.masDatos ?? ""}`.trim()}>
                            {(m.movimiento ?? m.masDatos ?? "—").slice(0, 60)}
                          </td>
                          <td className="py-2 px-2 text-xs text-muted-foreground">
                            {m.suggestedCategoryName ?? "—"}
                          </td>
                          <td className="py-2 px-2">
                            <div className="flex gap-1 justify-end whitespace-nowrap">
                              <Button
                                size="sm"
                                variant="outline"
                                className="text-xs h-6 px-2 border-info/40 text-info hover:text-info hover:border-info/40"
                                onClick={() => openCreateFromMovement(m)}
                              >
                                Crear gasto
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="text-xs h-6 px-2 text-muted-foreground hover:text-foreground"
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

        {/* Filtros */}
        <EconomyFilterBar
          search={{ value: search, onChange: setSearch, placeholder: "Buscar por concepto..." }}
          primary={
            <>
              <FilterField label="Estado" className="w-full sm:w-44">
                <Select value={filterStatus} onValueChange={setFilterStatus}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos</SelectItem>
                    <SelectItem value="pending">Pendiente</SelectItem>
                    <SelectItem value="justified">Justificado</SelectItem>
                    <SelectItem value="accounted">Contabilizado</SelectItem>
                    <SelectItem value="conciliado">Conciliado</SelectItem>
                  </SelectContent>
                </Select>
              </FilterField>
              <FilterField label="Categoría" className="w-full sm:w-48">
                <Select value={filterCategory} onValueChange={setFilterCategory}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todas</SelectItem>
                    {categories.map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </FilterField>
            </>
          }
          more={
            <>
              <FilterField label="Desde">
                <Input type="date" value={filterDateFrom} onChange={(e) => setFilterDateFrom(e.target.value)} />
              </FilterField>
              <FilterField label="Hasta">
                <Input type="date" value={filterDateTo} onChange={(e) => setFilterDateTo(e.target.value)} />
              </FilterField>
              <FilterField label="Centro de coste">
                <Select value={filterCostCenter} onValueChange={setFilterCostCenter}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos</SelectItem>
                    {costCenters.map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </FilterField>
              <FilterField label="Origen">
                <Select value={filterSource} onValueChange={(v) => setFilterSource(v as "all" | "email")}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos</SelectItem>
                    <SelectItem value="email">Desde email</SelectItem>
                  </SelectContent>
                </Select>
              </FilterField>
              <FilterField label="Imputación">
                <Select value={filterTreatment} onValueChange={(v) => setFilterTreatment(v as "all" | "operational" | "tax_only")}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos</SelectItem>
                    <SelectItem value="operational">Solo operativos</SelectItem>
                    <SelectItem value="tax_only">Solo fiscales</SelectItem>
                  </SelectContent>
                </Select>
              </FilterField>
            </>
          }
          chips={chips}
          onClear={clearFilters}
          summary={`${total} ${total === 1 ? "gasto" : "gastos"}`}
        />

        {/* Tabla de gastos */}
        <EconomyTable
          rows={filtered}
          columns={columns}
          rowKey={(e) => e.id}
          caption="Gastos"
          loading={expensesQ.isLoading}
          error={expensesQ.error}
          errorTitle="No se han podido cargar los gastos"
          onRetry={() => void expensesQ.refetch()}
          emptyTitle="No hay gastos con los filtros actuales"
          emptyDescription="Cambia o quita algún filtro, o registra un gasto nuevo."
          emptyAction={
            <>
              {chips.length > 0 && <Button variant="outline" size="sm" onClick={clearFilters}>Limpiar filtros</Button>}
              <Button size="sm" onClick={openCreate}><Plus className="mr-1 h-4 w-4" /> Nuevo gasto</Button>
            </>
          }
          onRowClick={(e) => openEdit(e)}
          actions={(e) => (
            <RowActions
              label={e.concept}
              primary={{ label: "Editar", icon: <Pencil className="h-4 w-4" />, onSelect: () => openEdit(e) }}
              menu={[
                ...(e.files.length > 0 ? [{ label: `Ver adjuntos (${e.files.length})`, icon: <FileText />, onSelect: () => openEdit(e) }] : []),
                { label: "Eliminar gasto", icon: <Trash2 />, destructive: true, onSelect: () => handleDelete(e.id) },
              ]}
            />
          )}
          footer={total > 0 ? (
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-muted/30 px-4 py-3">
              <span className="text-sm tabular-nums text-muted-foreground">
                {total <= PAGE_SIZE
                  ? `Mostrando ${total} de ${total} gastos`
                  : `Página ${page + 1} de ${Math.ceil(total / PAGE_SIZE)} · ${total} gastos`}
              </span>
              {total > PAGE_SIZE && (
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => setPage((p) => p - 1)} disabled={page === 0}>
                    ← Anterior
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setPage((p) => p + 1)} disabled={(page + 1) * PAGE_SIZE >= total}>
                    Siguiente →
                  </Button>
                </div>
              )}
            </div>
          ) : undefined}
        />
      </div>

      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingId ? "Editar gasto" : "Nuevo gasto"}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <FormSection title="Datos del gasto">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField label="Fecha" required error={showFormErrors && !form.date ? "Indica la fecha del gasto." : null}>
                <Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
              </FormField>
              <FormField label="Importe (€)" required error={showFormErrors && !form.amount ? "Indica el importe total con IVA." : null}>
                <Input
                  type="number"
                  step="0.01"
                  placeholder="0.00"
                  className="tabular-nums"
                  value={form.amount}
                  onChange={(e) => setForm({ ...form, amount: e.target.value })}
                />
              </FormField>
            </div>

            <FormField label="Concepto" required error={showFormErrors && !form.concept ? "Describe el gasto." : null}>
              <Input
                placeholder="Descripción del gasto"
                value={form.concept}
                onChange={(e) => setForm({ ...form, concept: e.target.value })}
              />
            </FormField>
            </FormSection>

            <FormSection title="Clasificación">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <Label>Categoría *</Label>
                  <button type="button" onClick={() => { setQuickCatName(""); setQuickCatDesc(""); setQuickCatOpen(true); }} className="flex items-center gap-0.5 text-xs text-primary/70 hover:text-primary">
                    <Plus className="w-3 h-3" />Nueva
                  </button>
                </div>
                <Select value={form.categoryId} onValueChange={(v) => setForm({ ...form, categoryId: v })}>
                  <SelectTrigger className="w-full"><SelectValue placeholder="Seleccionar..." /></SelectTrigger>
                  <SelectContent>
                    {categories.map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                {showFormErrors && !form.categoryId && <p role="alert" className="mt-1 text-xs text-danger">Elige una categoría.</p>}
              </div>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <Label>Centro de coste *</Label>
                  <button type="button" onClick={() => { setQuickCCName(""); setQuickCCDesc(""); setQuickCCOpen(true); }} className="flex items-center gap-0.5 text-xs text-primary/70 hover:text-primary">
                    <Plus className="w-3 h-3" />Nuevo
                  </button>
                </div>
                <Select value={form.costCenterId} onValueChange={(v) => setForm({ ...form, costCenterId: v })}>
                  <SelectTrigger className="w-full"><SelectValue placeholder="Seleccionar..." /></SelectTrigger>
                  <SelectContent>
                    {costCenters.map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                {showFormErrors && !form.costCenterId && <p role="alert" className="mt-1 text-xs text-danger">Elige un centro de coste.</p>}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <Label>Proveedor</Label>
                  <button type="button" onClick={() => { setQuickSupName(""); setQuickSupOpen(true); }} className="flex items-center gap-0.5 text-xs text-primary/70 hover:text-primary">
                    <Plus className="w-3 h-3" />Nuevo
                  </button>
                </div>
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
            </FormSection>

            {/* ── Datos fiscales (IVA soportado) — Gestoría e Impuestos ── */}
            <FormSection title="Datos fiscales (IVA soportado)" className="bg-muted/20">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <Label className="text-xs">Tipo de factura</Label>
                  <Select value={form.invoiceType} onValueChange={(v) => setForm({ ...form, invoiceType: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ordinaria">Ordinaria</SelectItem>
                      <SelectItem value="simplificada">Simplificada (ticket)</SelectItem>
                      <SelectItem value="intracomunitaria">Intracomunitaria</SelectItem>
                      <SelectItem value="importacion">Importación</SelectItem>
                      <SelectItem value="exenta">Exenta</SelectItem>
                      <SelectItem value="sin_factura">Sin factura</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Tipo de IVA</Label>
                  <Select value={form.taxRate} onValueChange={(v) => setForm({ ...form, taxRate: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="21">21 %</SelectItem>
                      <SelectItem value="10">10 %</SelectItem>
                      <SelectItem value="4">4 %</SelectItem>
                      <SelectItem value="0">0 % / Exento</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">% IVA deducible</Label>
                  <Input
                    type="number" step="1" min="0" max="100"
                    value={form.deductiblePercent}
                    onChange={(e) => setForm({ ...form, deductiblePercent: e.target.value })}
                  />
                </div>
              </div>
              {(() => {
                const total = parseFloat(form.amount) || 0;
                const rate = parseFloat(form.taxRate) || 0;
                const base = total / (1 + rate / 100);
                const cuota = total - base;
                const ded = parseFloat(form.deductiblePercent) || 0;
                return (
                  <div className="grid grid-cols-3 gap-3 text-xs">
                    <div className="bg-background rounded px-2 py-1.5">
                      <div className="text-muted-foreground">Base imponible</div>
                      <div className="font-semibold">{formatEur(base)}</div>
                    </div>
                    <div className="bg-background rounded px-2 py-1.5">
                      <div className="text-muted-foreground">Cuota IVA</div>
                      <div className="font-semibold">{formatEur(cuota)}</div>
                    </div>
                    <div className="bg-background rounded px-2 py-1.5">
                      <div className="text-muted-foreground">IVA deducible</div>
                      <div className="font-semibold text-success">{formatEur((cuota * ded / 100))}</div>
                    </div>
                  </div>
                );
              })()}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <Label className="text-xs">NIF proveedor</Label>
                  <Input
                    value={form.supplierNif}
                    onChange={(e) => setForm({ ...form, supplierNif: e.target.value })}
                    placeholder="B12345678"
                  />
                </div>
                <div>
                  <Label className="text-xs">% Retención IRPF</Label>
                  <Input
                    type="number" step="0.01" min="0"
                    value={form.retentionPercent}
                    onChange={(e) => setForm({ ...form, retentionPercent: e.target.value })}
                    placeholder="0"
                  />
                </div>
                <div>
                  <Label className="text-xs">Fecha de devengo</Label>
                  <Input
                    type="date"
                    value={form.accrualDate}
                    onChange={(e) => setForm({ ...form, accrualDate: e.target.value })}
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                El importe del gasto se entiende como total con IVA incluido. La base y la cuota se calculan automáticamente.
              </p>
            </FormSection>

            {/* ── Tratamiento operativo ─────────────────────────────────── */}
            <FormSection title="Tratamiento operativo" className={form.isOperational ? "bg-muted/20" : "border-warning/40 bg-warning/10"}>
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.isOperational}
                  onChange={(e) => setForm({ ...form, isOperational: e.target.checked })}
                  className="mt-0.5 w-4 h-4 rounded border-border accent-primary cursor-pointer"
                />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium flex items-center gap-2 flex-wrap">
                    Computa en resultado operativo
                    {!form.isOperational && (
                      <Badge variant="outline" className="border-warning/50 text-warning bg-warning/10 text-xs uppercase tracking-wide px-1.5 py-0">
                        Solo fiscal
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5 leading-snug">
                    Si lo desactivas, el gasto seguirá existiendo a efectos fiscales y tributarios (gestoría, IVA,
                    Impuesto de Sociedades, tesorería y conciliación bancaria), pero no afectará a los dashboards
                    ni a la rentabilidad operativa del negocio (EBITDA, márgenes, KPIs, P&amp;L operativo).
                  </p>
                </div>
              </label>
            </FormSection>

            <FormSection title="Estado y notas">
            <div>
              <Label>Estado</Label>
              <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
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
            </FormSection>

            <FormSection title="Adjuntos">
            {/* Adjuntos guardados */}
            {existingFiles.length > 0 && (
              <div>
                <Label className="mb-2 block">Adjuntos guardados</Label>
                <div className="space-y-1.5">
                  {existingFiles.map((f) => (
                    <div key={f.id} className="flex items-center gap-2 bg-muted/30 border rounded px-2 py-1.5">
                      {isImage(f.mimeType) ? (
                        <button
                          type="button"
                          className="shrink-0 w-8 h-8 rounded overflow-hidden border border-border hover:opacity-80 transition-opacity"
                          onClick={() => setLightboxUrl(f.filePath)}
                          title="Ver imagen"
                        >
                          <img src={f.filePath} alt={f.fileName ?? ""} className="w-full h-full object-cover" />
                        </button>
                      ) : (
                        <FileText className="w-4 h-4 shrink-0 text-info" />
                      )}
                      <span className="text-sm flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-foreground/80" title={f.fileName ?? f.filePath}>
                        {f.fileName ?? f.filePath.split("/").pop() ?? "Archivo"}
                      </span>
                      <a
                        href={f.filePath}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="shrink-0 p-1 rounded hover:bg-info/10 text-info hover:text-info transition-colors"
                        title="Abrir en nueva pestaña"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                      <button
                        type="button"
                        className="shrink-0 p-1 rounded hover:bg-danger/10 text-muted-foreground hover:text-danger transition-colors"
                        onClick={() => handleDeleteFile(f.id)}
                        title="Eliminar adjunto"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Nuevos adjuntos */}
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
                        <X className="w-3 h-3 text-muted-foreground hover:text-danger" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            </FormSection>

            <FormFooter>
              <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
              <Button onClick={handleSave} disabled={createMut.isPending || updateMut.isPending}>
                {editingId ? "Guardar cambios" : "Crear gasto"}
              </Button>
            </FormFooter>
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
                  <Banknote className="w-4 h-4 text-info" />
                  Crear gasto desde banco
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                {/* Movement summary */}
                <div className="bg-info/10 border border-info/20 rounded-lg p-3 space-y-1">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Fecha:</span>
                    <span className="text-foreground font-medium">{mov.fecha}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Importe:</span>
                    <span className="text-danger font-bold">
                      {formatEur(Math.abs(parseFloat(mov.importe)))}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Banco:</span>
                    <span className="text-foreground text-right max-w-[240px] overflow-hidden text-ellipsis whitespace-nowrap text-xs">
                      {`${mov.movimiento ?? ""} ${mov.masDatos ?? ""}`.trim() || "—"}
                    </span>
                  </div>
                  {mov.suggestedCategoryName && (
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Categ. sugerida:</span>
                      <span className="text-info text-xs">{mov.suggestedCategoryName}</span>
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

      {/* Email ingestion logs modal */}
      <Dialog open={emailLogsOpen} onOpenChange={setEmailLogsOpen}>
        <DialogContent className="max-w-3xl sm:max-w-3xl max-h-[80vh] overflow-y-auto bg-card border-border text-foreground">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Mail className="w-4 h-4 text-info" />
              Historial de ingesta por email
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            {emailLogsQ.isLoading ? (
              <p className="text-sm text-muted-foreground text-center py-6">Cargando...</p>
            ) : !emailLogsQ.data?.length ? (
              <p className="text-sm text-muted-foreground text-center py-6">No hay registros de ingesta todavía.</p>
            ) : (
              <div className="divide-y divide-zinc-800 rounded-lg border border-border overflow-hidden">
                {emailLogsQ.data.map((log) => (
                  <div key={log.id} className="px-4 py-3 flex items-start gap-3">
                    <div className="shrink-0 mt-0.5">
                      {log.status === "processed" && <CheckCircle2 className="w-4 h-4 text-success" />}
                      {log.status === "duplicated" && <RefreshCw className="w-4 h-4 text-muted-foreground" />}
                      {(log.status === "missing_amount" || log.status === "invalid_subject") && (
                        <AlertTriangle className="w-4 h-4 text-warning" />
                      )}
                      {log.status === "error" && <AlertTriangle className="w-4 h-4 text-danger" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-foreground overflow-hidden text-ellipsis whitespace-nowrap max-w-xs">
                          {log.subject ?? "(sin asunto)"}
                        </span>
                        {log.amountDetected && (
                          <span className="text-xs font-semibold text-success">
                            {formatEur(parseFloat(String(log.amountDetected)))}
                          </span>
                        )}
                        {log.attachmentsCount !== null && log.attachmentsCount > 0 && (
                          <span className="text-xs text-muted-foreground">
                            <FileText className="w-3 h-3 inline mr-0.5" />{log.attachmentsCount} adj.
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {log.sender && <span>{log.sender} · </span>}
                        {log.processedAt && <span>{new Date(log.processedAt).toLocaleString("es-ES")}</span>}
                      </div>
                      {log.errorMessage && (
                        <div className="text-xs text-warning mt-1">{log.errorMessage}</div>
                      )}
                    </div>
                    <div className="shrink-0">
                      <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                        log.status === "processed" ? "bg-success/15 text-success" :
                        log.status === "duplicated" ? "bg-muted/15 text-muted-foreground" :
                        log.status === "error" ? "bg-danger/15 text-danger" :
                        "bg-warning/15 text-warning"
                      }`}>
                        {log.status === "processed" ? "procesado" :
                         log.status === "duplicated" ? "duplicado" :
                         log.status === "missing_amount" ? "sin importe" :
                         log.status === "invalid_subject" ? "asunto inválido" : "error"}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
      {/* Quick-create: Categoría */}
      <Dialog open={quickCatOpen} onOpenChange={setQuickCatOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Nueva categoría de gasto</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Nombre *</Label>
              <Input
                value={quickCatName}
                onChange={(e) => setQuickCatName(e.target.value)}
                placeholder="Ej: Suministros"
                onKeyDown={(e) => e.key === "Enter" && quickCatName.trim() && !dupCat && createCatMut.mutate({ name: quickCatName.trim(), description: quickCatDesc || undefined })}
                autoFocus
              />
            </div>
            <div>
              <Label>Descripción</Label>
              <Input value={quickCatDesc} onChange={(e) => setQuickCatDesc(e.target.value)} placeholder="Opcional" />
            </div>
            {dupCat && <DuplicateNotice text={`Ya existe la categoría «${dupCat.name}».`} onUse={() => { setForm((f) => ({ ...f, categoryId: String(dupCat.id) })); setQuickCatOpen(false); }} />}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setQuickCatOpen(false)}>Cancelar</Button>
              <Button
                onClick={() => quickCatName.trim() && createCatMut.mutate({ name: quickCatName.trim(), description: quickCatDesc || undefined })}
                disabled={!quickCatName.trim() || !!dupCat || createCatMut.isPending}
              >Crear y seleccionar</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Quick-create: Centro de coste */}
      <Dialog open={quickCCOpen} onOpenChange={setQuickCCOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Nuevo centro de coste</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Nombre *</Label>
              <Input
                value={quickCCName}
                onChange={(e) => setQuickCCName(e.target.value)}
                placeholder="Ej: Actividades acuáticas"
                onKeyDown={(e) => e.key === "Enter" && quickCCName.trim() && !dupCC && createCCMut.mutate({ name: quickCCName.trim(), description: quickCCDesc || undefined })}
                autoFocus
              />
            </div>
            <div>
              <Label>Descripción</Label>
              <Input value={quickCCDesc} onChange={(e) => setQuickCCDesc(e.target.value)} placeholder="Opcional" />
            </div>
            {dupCC && <DuplicateNotice text={`Ya existe el centro de coste «${dupCC.name}».`} onUse={() => { setForm((f) => ({ ...f, costCenterId: String(dupCC.id) })); setQuickCCOpen(false); }} />}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setQuickCCOpen(false)}>Cancelar</Button>
              <Button
                onClick={() => quickCCName.trim() && createCCMut.mutate({ name: quickCCName.trim(), description: quickCCDesc || undefined })}
                disabled={!quickCCName.trim() || !!dupCC || createCCMut.isPending}
              >Crear y seleccionar</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Quick-create: Proveedor */}
      <Dialog open={quickSupOpen} onOpenChange={setQuickSupOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Nuevo proveedor</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Nombre comercial *</Label>
              <Input
                value={quickSupName}
                onChange={(e) => setQuickSupName(e.target.value)}
                placeholder="Ej: Ferretería López"
                onKeyDown={(e) => e.key === "Enter" && quickSupName.trim() && !dupSup && createSupMut.mutate({ name: quickSupName.trim() })}
                autoFocus
              />
            </div>
            {dupSup && <DuplicateNotice text={`Ya existe el proveedor «${dupSup.name}».`} onUse={() => { setForm((f) => ({ ...f, supplierId: String(dupSup.id) })); setQuickSupOpen(false); }} />}
            <p className="text-xs text-muted-foreground">Podrás añadir NIF, IBAN y más datos desde la sección Proveedores.</p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setQuickSupOpen(false)}>Cancelar</Button>
              <Button
                onClick={() => quickSupName.trim() && createSupMut.mutate({ name: quickSupName.trim() })}
                disabled={!quickSupName.trim() || !!dupSup || createSupMut.isPending}
              >Crear y seleccionar</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      {/* Lightbox para imágenes */}
      {lightboxUrl && (
        <div
          className="fixed inset-0 z-[9999] bg-black/90 flex items-center justify-center p-4"
          onClick={() => setLightboxUrl(null)}
        >
          <button
            className="absolute top-4 right-4 p-2 rounded-full bg-muted/50 hover:bg-muted text-foreground transition-colors"
            onClick={() => setLightboxUrl(null)}
          >
            <X className="w-5 h-5" />
          </button>
          <a
            href={lightboxUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="absolute top-4 right-16 p-2 rounded-full bg-muted/50 hover:bg-muted text-foreground transition-colors"
            onClick={(e) => e.stopPropagation()}
            title="Abrir original"
          >
            <ExternalLink className="w-5 h-5" />
          </a>
          <img
            src={lightboxUrl}
            alt="Adjunto"
            className="max-w-full max-h-[90vh] rounded-lg shadow-md object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </EconomyShell>
    </AdminLayout>
  );
}
