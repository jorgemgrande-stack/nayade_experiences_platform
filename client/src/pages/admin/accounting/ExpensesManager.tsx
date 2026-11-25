/**
 * ExpensesManager — Gastos
 * Cabecera con «Nuevo gasto» y acciones secundarias en un menú; una franja de pendientes de una línea (detectados por
 * banco, solo fiscales, sin adjunto); resumen del filtro COMPLETO calculado en el servidor; búsqueda en servidor; lista
 * en tabla (escritorio) y tarjetas (móvil); formulario en secciones plegables con pie fijo (importe e IVA calculados).
 * Solo presentación: los importes, impuestos, estados y permisos de los gastos no cambian.
 */
import { toast } from "sonner";
import { confirmAction } from "@/components/admin/ConfirmHost";
import { useState, useRef, useEffect, useMemo } from "react";
import AdminLayout from "@/components/AdminLayout";
import { EconomyShell } from "@/components/admin/EconomyShell";
import { CompactEmpty, SummaryStrip, ToolbarRow, type SummaryStripItem } from "@/components/admin/SalesFamilyShell";
import { StatusBadge, type Tone } from "@/components/admin/PanelUi";
import { FormFooter, EconomyTable, FilterField, FormField, RowActions, type EconomyColumn } from "./shared/EconomyUi";
import { CollapsibleSection, EconomyPager, MoreFilters } from "./shared/EconomyParts";
import { trpc } from "@/lib/trpc";
import { useI18n, useFormat } from "@/i18n/I18nProvider";
import { useMoney } from "@/lib/useMoney";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  Plus, Pencil, Trash2, Upload, FileText, X, Banknote, LinkIcon, Mail, RefreshCw, CheckCircle2, AlertTriangle, Clock,
  ExternalLink, Calculator, Download, MoreHorizontal, Paperclip, Scale, SearchX,
} from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

const STATUSES = ["pending", "justified", "accounted", "conciliado"] as const;
const PAYMENT_METHODS = ["cash", "card", "transfer", "direct_debit", "tpv_cash"] as const;
const INVOICE_TYPES = ["ordinaria", "simplificada", "intracomunitaria", "importacion", "exenta", "sin_factura"] as const;
const STATUS_TONES: Record<string, Tone> = { pending: "warning", justified: "info", accounted: "success", conciliado: "success" };
const PAGE_DEFAULT = 50;

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

/** Nombre comparable (sin mayúsculas, acentos ni espacios repetidos): avisa de duplicados en las altas rápidas. */
const sameName = (a: string, b: string) => {
  const n = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase().replace(/\s+/g, " ");
  return !!n(b) && n(a) === n(b);
};

/** Aviso de alta rápida duplicada con la opción de usar el registro que ya existe. */
function DuplicateNotice({ text, action, onUse }: { text: string; action: string; onUse: () => void }) {
  return (
    <p role="alert" className="text-xs text-warning">
      {text}{" "}
      <button type="button" className="font-medium underline" onClick={onUse}>{action}</button>
    </p>
  );
}

/** Chip-contador de la franja de pendientes: un botón de una línea que filtra o abre un panel. */
function PendingChip({ icon, label, title, active, tone, onClick }: { icon: React.ReactNode; label: string; title?: string; active?: boolean; tone: "info" | "warning"; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={cn(
        "inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-sm:h-10",
        tone === "info" ? "border-info/40 bg-info/10 text-foreground hover:bg-info/20" : "border-warning/40 bg-warning/10 text-foreground hover:bg-warning/20",
        active && "ring-2 ring-primary/60",
      )}
    >
      <span aria-hidden="true" className={cn("[&_svg]:h-3.5 [&_svg]:w-3.5", tone === "info" ? "text-info" : "text-warning")}>{icon}</span>
      {label}
    </button>
  );
}

export default function ExpensesManager() {
  const { t } = useI18n();
  const f = useFormat();
  const money = useMoney();

  // Filtros (todos viajan al servidor: listado y resumen usan exactamente los mismos)
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const searchTimeout = useMemo(() => ({ id: 0 as any }), []);
  const [filterCategory, setFilterCategory] = useState<string>("all");
  const [filterCostCenter, setFilterCostCenter] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [filterDateFrom, setFilterDateFrom] = useState("");
  const [filterDateTo, setFilterDateTo] = useState("");
  const [filterTreatment, setFilterTreatment] = useState<"all" | "operational" | "tax_only">("all");
  const [filterSource, setFilterSource] = useState<"all" | "email">("all");
  const [filterMissing, setFilterMissing] = useState(false);
  const [moreIndicators, setMoreIndicators] = useState(false);

  const [pageSize, setPageSize] = useState(PAGE_DEFAULT);
  const [page, setPage] = useState(0);
  useEffect(() => { setPage(0); }, [debouncedSearch, filterDateFrom, filterDateTo, filterCategory, filterCostCenter, filterStatus, filterTreatment, filterSource, filterMissing, pageSize]);
  const handleSearch = (v: string) => {
    setSearch(v);
    clearTimeout(searchTimeout.id);
    searchTimeout.id = setTimeout(() => setDebouncedSearch(v), 400);
  };

  // Diálogo del formulario
  const [dialogOpen, setDialogOpen] = useState(false);
  const [showFormErrors, setShowFormErrors] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<ExpenseForm>(emptyForm);
  const [openData, setOpenData] = useState(true);
  const [openClass, setOpenClass] = useState(true);
  const [openAdvanced, setOpenAdvanced] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  type ExistingFile = { id: number; filePath: string; fileName: string | null; mimeType: string | null };
  const [existingFiles, setExistingFiles] = useState<ExistingFile[]>([]);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  const [emailLogsOpen, setEmailLogsOpen] = useState(false);

  // Altas rápidas
  const [quickCatOpen, setQuickCatOpen] = useState(false);
  const [quickCatName, setQuickCatName] = useState("");
  const [quickCatDesc, setQuickCatDesc] = useState("");
  const [quickCCOpen, setQuickCCOpen] = useState(false);
  const [quickCCName, setQuickCCName] = useState("");
  const [quickCCDesc, setQuickCCDesc] = useState("");
  const [quickSupOpen, setQuickSupOpen] = useState(false);
  const [quickSupName, setQuickSupName] = useState("");

  // Detectados por banco
  const [bankOpen, setBankOpen] = useState(false);
  const [createFromMovId, setCreateFromMovId] = useState<number | null>(null);
  const [movForm, setMovForm] = useState({ concept: "", categoryId: "", costCenterId: "", supplierId: "", paymentMethod: "transfer", notes: "" });

  const filterInput = {
    dateFrom: filterDateFrom || undefined,
    dateTo: filterDateTo || undefined,
    categoryId: filterCategory !== "all" ? Number(filterCategory) : undefined,
    costCenterId: filterCostCenter !== "all" ? Number(filterCostCenter) : undefined,
    status: filterStatus !== "all" ? (filterStatus as (typeof STATUSES)[number]) : undefined,
    treatment: filterTreatment,
    search: debouncedSearch || undefined,
    source: filterSource === "email" ? "email" : undefined,
    attachment: filterMissing ? ("missing" as const) : undefined,
  };

  // Consultas
  const categoriesQ = trpc.financial.categories.list.useQuery();
  const costCentersQ = trpc.financial.costCenters.list.useQuery();
  const suppliersQ = trpc.financial.suppliers.list.useQuery();
  const expensesQ = trpc.financial.expenses.list.useQuery({ ...filterInput, limit: pageSize, offset: page * pageSize });
  // Totales del filtro completo (no de la página) y totales globales para la franja de pendientes
  const summaryQ = trpc.financial.expenses.filterSummary.useQuery(filterInput);
  const globalQ = trpc.financial.expenses.filterSummary.useQuery({ treatment: "all" }, { staleTime: 60_000 });
  const distortionQ = trpc.financial.expenses.distortionKpi.useQuery({}, { staleTime: 60_000 });

  const utils = trpc.useUtils();
  const refreshExpenses = () => {
    utils.financial.expenses.list.invalidate();
    utils.financial.expenses.filterSummary.invalidate();
  };

  const syncEmailMut = trpc.financial.emailIngestion.triggerSync.useMutation({
    onSuccess: (res) => { toast.success(t("economyExp.toast.synced", { processed: res.processed, duplicated: res.duplicated })); refreshExpenses(); },
    onError: (e) => toast.error(t("economyExp.toast.syncError", { message: e.message })),
  });
  const backfillMut = trpc.financial.expenses.backfillFiscal.useMutation({
    onSuccess: (res) => { toast.success(t("economyExp.toast.recalculated", { updated: res.updated })); refreshExpenses(); },
    onError: (e) => toast.error(t("economyExp.toast.recalcError", { message: e.message })),
  });
  const emailLogsQ = trpc.financial.emailIngestion.listLogs.useQuery({ limit: 100 }, { enabled: emailLogsOpen });

  const createMut = trpc.financial.expenses.create.useMutation({ onSuccess: refreshExpenses });
  const updateMut = trpc.financial.expenses.update.useMutation({ onSuccess: refreshExpenses });
  const deleteMut = trpc.financial.expenses.delete.useMutation({ onSuccess: refreshExpenses });
  const uploadFileMut = trpc.financial.expenses.uploadFile.useMutation();
  const deleteFileMut = trpc.financial.expenses.deleteFile.useMutation({ onSuccess: refreshExpenses });

  async function handleDeleteFile(fileId: number) {
    await deleteFileMut.mutateAsync({ fileId });
    setExistingFiles((prev) => prev.filter((x) => x.id !== fileId));
  }
  const isImage = (mimeType: string | null) => !!mimeType?.startsWith("image/");

  const createCatMut = trpc.financial.categories.create.useMutation({
    onSuccess: (res) => {
      utils.financial.categories.list.invalidate();
      setForm((x) => ({ ...x, categoryId: String(res.id) }));
      setQuickCatOpen(false); setQuickCatName(""); setQuickCatDesc("");
      toast.success(t("economyExp.toast.categoryCreated"));
    },
    onError: (e) => toast.error(e.message || t("economyExp.toast.createError", { message: "" })),
  });
  const createCCMut = trpc.financial.costCenters.create.useMutation({
    onSuccess: (res) => {
      utils.financial.costCenters.list.invalidate();
      setForm((x) => ({ ...x, costCenterId: String(res.id) }));
      setQuickCCOpen(false); setQuickCCName(""); setQuickCCDesc("");
      toast.success(t("economyExp.toast.costCenterCreated"));
    },
    onError: (e) => toast.error(e.message || t("economyExp.toast.createError", { message: "" })),
  });
  const createSupMut = trpc.financial.suppliers.create.useMutation({
    onSuccess: (res) => {
      utils.financial.suppliers.list.invalidate();
      setForm((x) => ({ ...x, supplierId: String(res.id) }));
      setQuickSupOpen(false); setQuickSupName("");
      toast.success(t("economyExp.toast.supplierCreated"));
    },
    onError: (e) => toast.error(e.message || t("economyExp.toast.createError", { message: "" })),
  });

  const bankCandidatesQ = trpc.bankMovements.listExpenseCandidates.useQuery({ page: 1, pageSize: 30 }, { refetchInterval: 120_000 });
  const createFromMovMut = trpc.bankMovements.createExpenseFromMovement.useMutation({
    onSuccess: () => {
      refreshExpenses();
      bankCandidatesQ.refetch();
      setCreateFromMovId(null);
      toast.success(t("economyExp.toast.linkedCreated"));
    },
    onError: (e) => toast.error(t("economyExp.toast.error", { message: e.message })),
  });
  const ignoreBankMut = trpc.bankMovements.ignoreForExpense.useMutation({
    onSuccess: () => { bankCandidatesQ.refetch(); toast.success(t("economyExp.toast.ignored")); },
    onError: (e) => toast.error(t("economyExp.toast.error", { message: e.message })),
  });

  const categories = categoriesQ.data ?? [];
  const costCenters = costCentersQ.data ?? [];
  const suppliers = suppliersQ.data ?? [];
  const dupCat = quickCatOpen ? categories.find((c) => sameName(c.name, quickCatName)) : undefined;
  const dupCC = quickCCOpen ? costCenters.find((c) => sameName(c.name, quickCCName)) : undefined;
  const dupSup = quickSupOpen ? suppliers.find((s) => sameName(s.name, quickSupName)) : undefined;
  const expenses = expensesQ.data?.items ?? [];
  const total = expensesQ.data?.total ?? 0;
  const summary = summaryQ.data;
  const globalSummary = globalQ.data;
  const bankTotal = bankCandidatesQ.data?.total ?? 0;
  const dash = "—";

  const statusLabel = (s: string) => (STATUSES as readonly string[]).includes(s) ? t(`economyExp.status.${s}`) : s;
  const paymentLabel = (s: string) => (PAYMENT_METHODS as readonly string[]).includes(s) ? t(`economyExp.payment.${s}`) : s;
  const getCategoryName = (id: number) => categories.find((c) => c.id === id)?.name ?? t("economyExp.categoryFallback", { id });
  const getCostCenterName = (id: number) => costCenters.find((c) => c.id === id)?.name ?? t("economyExp.costCenterFallback", { id });
  const getSupplierName = (id: number | null | undefined) => (id ? suppliers.find((s) => s.id === id)?.name ?? dash : dash);
  const day = (v: string | null | undefined) => (v ? f.date(new Date(`${v.slice(0, 10)}T00:00:00`)) : dash);

  /** IVA soportado de una fila: misma regla que el servidor (RRHH sin IVA; cuota guardada; si no, derivada del tipo). */
  function ivaSoportado(e: any): number {
    if (typeof e?.source === "string" && e.source.startsWith("hr_")) return 0;
    if (e?.taxAmount != null && e.taxAmount !== "") return parseFloat(e.taxAmount) || 0;
    const totalAmount = parseFloat(e?.amount ?? "0") || 0;
    const rate = e?.taxRate != null && e.taxRate !== "" ? parseFloat(e.taxRate) || 0 : 21;
    return rate > 0 ? totalAmount - totalAmount / (1 + rate / 100) : 0;
  }

  function openCreate() {
    setShowFormErrors(false);
    setEditingId(null);
    setForm(emptyForm);
    setPendingFiles([]);
    setExistingFiles([]);
    setOpenData(true); setOpenClass(true); setOpenAdvanced(false);
    setDialogOpen(true);
  }

  function openEdit(e: (typeof expenses)[number]) {
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
    setOpenData(true); setOpenClass(true); setOpenAdvanced(e.files.length > 0 || (e as any).isOperational === false);
    setDialogOpen(true);
  }

  async function handleSave() {
    setShowFormErrors(true);
    if (!form.concept || !form.amount || !form.categoryId || !form.costCenterId || !form.date) {
      setOpenData(true); setOpenClass(true);
      toast.error(t("economyExp.toast.required"));
      return;
    }
    const payload = {
      date: form.date,
      concept: form.concept,
      amount: form.amount,
      categoryId: Number(form.categoryId),
      costCenterId: Number(form.costCenterId),
      supplierId: form.supplierId ? Number(form.supplierId) : null,
      paymentMethod: form.paymentMethod as (typeof PAYMENT_METHODS)[number],
      status: form.status as "pending" | "justified" | "accounted",
      notes: form.notes,
      // ── Datos fiscales (IVA soportado) ──
      taxRate: form.taxRate,
      deductiblePercent: form.deductiblePercent,
      invoiceType: form.invoiceType as (typeof INVOICE_TYPES)[number],
      supplierNif: form.supplierNif || undefined,
      retentionPercent: form.retentionPercent || undefined,
      accrualDate: form.accrualDate || undefined,
      isOperational: form.isOperational,
    };

    let expenseId: number;
    if (editingId) {
      await updateMut.mutateAsync({ id: editingId, ...payload });
      expenseId = editingId;
      toast.success(t("economyExp.toast.updated"));
    } else {
      const res = await createMut.mutateAsync(payload);
      expenseId = res.id;
      toast.success(t("economyExp.toast.created"));
    }

    // Subir adjuntos pendientes
    for (const file of pendingFiles) {
      const base64 = await fileToBase64(file);
      await uploadFileMut.mutateAsync({ expenseId, fileName: file.name, mimeType: file.type, base64 });
    }
    refreshExpenses();
    setDialogOpen(false);
  }

  async function handleDelete(id: number) {
    if (!(await confirmAction({ description: t("economyExp.confirm.delete"), destructive: true }))) return;
    await deleteMut.mutateAsync({ id });
    toast.success(t("economyExp.toast.deleted"));
  }

  function handleFilesDrop(e: React.DragEvent) {
    e.preventDefault();
    setPendingFiles((prev) => [...prev, ...Array.from(e.dataTransfer.files)]);
  }
  function handleFilesInput(e: React.ChangeEvent<HTMLInputElement>) {
    setPendingFiles((prev) => [...prev, ...Array.from(e.target.files ?? [])]);
  }
  function fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve((reader.result as string).split(",")[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  /**
   * Exporta los gastos filtrados a CSV (compatible Excel ES con BOM y `;`). El CSV no cambia: mismas columnas y datos.
   * Pide al servidor el conjunto COMPLETO que coincide con los filtros (ahora también la búsqueda y el origen).
   */
  async function exportToCSV() {
    if (total === 0) {
      toast.error(t("economyExp.toast.nothingToExport"));
      return;
    }
    const full = await utils.financial.expenses.list.fetch({ ...filterInput, limit: total, offset: 0 });
    const toExport = full.items as any[];
    if (toExport.length === 0) {
      toast.error(t("economyExp.toast.nothingToExport"));
      return;
    }
    const PAYMENT_ES: Record<string, string> = { cash: "Efectivo", card: "Tarjeta", transfer: "Transferencia", direct_debit: "Domiciliación", tpv_cash: "TPV Caja" };
    const STATUS_ES: Record<string, string> = { pending: "Pendiente", justified: "Justificado", accounted: "Contabilizado", conciliado: "Conciliado" };
    const headers = [
      "Fecha", "Concepto", "Proveedor", "NIF Proveedor", "Categoría", "Centro de coste",
      "Método pago", "Estado", "Importe total (€)", "Base imponible (€)", "Tipo IVA (%)",
      "Cuota IVA (€)", "% Deducible", "% Retención IRPF", "Tipo factura",
      "Fecha devengo", "Imputación Operativa", "Origen", "Notas",
    ];
    const escape = (v: unknown) => {
      const s = v == null ? "" : String(v);
      return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const rows = toExport.map((e: any) => [
      e.date,
      e.concept,
      getSupplierName(e.supplierId),
      e.supplierNif ?? "",
      getCategoryName(e.categoryId),
      getCostCenterName(e.costCenterId),
      PAYMENT_ES[e.paymentMethod] ?? e.paymentMethod,
      STATUS_ES[e.status] ?? e.status,
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
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `gastos-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(t("economyExp.toast.exported", { count: toExport.length }));
  }

  function openCreateFromMovement(m: NonNullable<typeof bankCandidatesQ.data>["data"][number]) {
    setBankOpen(false);
    setCreateFromMovId(m.id);
    const desc = `${m.movimiento ?? ""} ${m.masDatos ?? ""}`.trim().slice(0, 120);
    const suggestedCat = m.suggestedCategoryName
      ? categories.find((c) => c.name.toLowerCase().includes(m.suggestedCategoryName!.toLowerCase()))
      : undefined;
    setMovForm({ concept: desc, categoryId: suggestedCat ? String(suggestedCat.id) : "", costCenterId: "", supplierId: "", paymentMethod: "transfer", notes: "" });
  }

  async function handleCreateFromMovement() {
    if (!createFromMovId || !movForm.concept || !movForm.categoryId || !movForm.costCenterId) {
      toast.error(t("economyExp.toast.linkedRequired"));
      return;
    }
    await createFromMovMut.mutateAsync({
      bankMovementId: createFromMovId,
      concept: movForm.concept,
      categoryId: Number(movForm.categoryId),
      costCenterId: Number(movForm.costCenterId),
      supplierId: movForm.supplierId ? Number(movForm.supplierId) : null,
      paymentMethod: movForm.paymentMethod as (typeof PAYMENT_METHODS)[number],
      notes: movForm.notes || undefined,
    });
  }

  type ExpenseRow = (typeof expenses)[number];
  const clearFilters = () => {
    setSearch(""); setDebouncedSearch(""); setFilterCategory("all"); setFilterCostCenter("all"); setFilterStatus("all");
    setFilterDateFrom(""); setFilterDateTo(""); setFilterTreatment("all"); setFilterSource("all"); setFilterMissing(false);
  };
  const chips = [
    ...(debouncedSearch ? [{ id: "q", label: t("economyExp.chip.search", { value: debouncedSearch }), onRemove: () => { setSearch(""); setDebouncedSearch(""); } }] : []),
    ...(filterStatus !== "all" ? [{ id: "status", label: t("economyExp.chip.status", { value: statusLabel(filterStatus) }), onRemove: () => setFilterStatus("all") }] : []),
    ...(filterCategory !== "all" ? [{ id: "cat", label: t("economyExp.chip.category", { value: getCategoryName(Number(filterCategory)) }), onRemove: () => setFilterCategory("all") }] : []),
    ...(filterCostCenter !== "all" ? [{ id: "cc", label: t("economyExp.chip.costCenter", { value: getCostCenterName(Number(filterCostCenter)) }), onRemove: () => setFilterCostCenter("all") }] : []),
    ...(filterDateFrom ? [{ id: "from", label: t("economyExp.chip.from", { value: day(filterDateFrom) }), onRemove: () => setFilterDateFrom("") }] : []),
    ...(filterDateTo ? [{ id: "to", label: t("economyExp.chip.to", { value: day(filterDateTo) }), onRemove: () => setFilterDateTo("") }] : []),
    ...(filterSource === "email" ? [{ id: "src", label: t("economyExp.chip.email"), onRemove: () => setFilterSource("all") }] : []),
    ...(filterTreatment !== "all" ? [{ id: "treat", label: filterTreatment === "tax_only" ? t("economyExp.chip.taxOnly") : t("economyExp.chip.operational"), onRemove: () => setFilterTreatment("all") }] : []),
    ...(filterMissing ? [{ id: "missing", label: t("economyExp.chip.missing"), onRemove: () => setFilterMissing(false) }] : []),
  ];
  const moreActive = (filterCostCenter !== "all" ? 1 : 0) + (filterSource !== "all" ? 1 : 0) + (filterTreatment !== "all" ? 1 : 0);

  // ── Resumen del filtro completo (servidor) ──
  const statusItem = (s: (typeof STATUSES)[number]): SummaryStripItem => ({
    key: s,
    label: summary ? `${statusLabel(s)} (${summary.byStatus[s].count})` : statusLabel(s),
    value: summary ? money.eur(summary.byStatus[s].amount) : dash,
    tone: STATUS_TONES[s],
    active: filterStatus === s,
    onClick: () => setFilterStatus(filterStatus === s ? "all" : s),
  });
  const totalItem: SummaryStripItem = { key: "total", label: summary ? `${t("economyExp.summary.total")} (${summary.count})` : t("economyExp.summary.total"), value: summary ? money.eur(summary.total) : dash, primary: true, tone: "danger" };
  const ivaItem: SummaryStripItem = { key: "iva", label: t("economyExp.summary.iva"), value: summary ? money.eur(summary.ivaSoportado) : dash, tone: "success" };
  const desktopItems = [totalItem, ivaItem, ...STATUSES.map(statusItem)];
  const mobileItems = [totalItem, ivaItem, statusItem("pending")];
  const moreToggle = (
    <Button type="button" variant="ghost" size="sm" className="h-8 px-2 text-xs" aria-expanded={moreIndicators} onClick={() => setMoreIndicators((v) => !v)}>
      {moreIndicators ? t("economyExp.summary.lessIndicators") : t("economyExp.summary.moreIndicators")}
    </Button>
  );

  // ── Franja de pendientes ──
  const globalTaxOnly = globalSummary?.taxOnlyCount ?? 0;
  const globalMissing = globalSummary?.missingAttachmentCount ?? 0;
  const dk = distortionQ.data;
  const taxOnlyTitle = dk && dk.year_.count > 0
    ? `${t("economyExp.pending.taxOnlyHint")} ${t("economyExp.pending.taxOnlyYear", { year: dk.year, amount: money.eur(dk.year_.amount), count: dk.year_.count, pct: dk.pctOfOperational.toFixed(1).replace(".", f.number(0.1).slice(1, 2)) })}`
    : t("economyExp.pending.taxOnlyHint");
  const showPending = bankTotal > 0 || globalTaxOnly > 0 || globalMissing > 0;

  const columns: EconomyColumn<ExpenseRow>[] = [
    {
      key: "fecha",
      header: t("economyExp.col.date"),
      mobile: "title",
      cell: (e) => <span className="whitespace-nowrap text-muted-foreground @2xl:text-foreground">{day(e.date)}</span>,
    },
    {
      key: "concepto",
      header: t("economyExp.col.concept"),
      mobile: "hidden",
      className: "min-w-[14rem] max-w-[26rem]",
      cell: (e) => (
        <>
          <p className="line-clamp-2 break-words text-sm font-medium text-foreground" title={e.concept}>{e.concept}</p>
          <ExpenseBadges e={e as any} />
        </>
      ),
    },
    {
      key: "proveedor",
      header: t("economyExp.col.supplier"),
      priority: "lg",
      className: "max-w-[11rem]",
      cell: (e) => <span className="line-clamp-2 break-words text-xs text-muted-foreground" title={getSupplierName(e.supplierId)}>{getSupplierName(e.supplierId)}</span>,
    },
    { key: "categoria", header: t("economyExp.col.category"), priority: "md", className: "max-w-[11rem]", cell: (e) => <span className="line-clamp-2 break-words text-xs text-muted-foreground">{getCategoryName(e.categoryId)}</span> },
    { key: "metodo", header: t("economyExp.col.method"), priority: "xl", cell: (e) => <span className="whitespace-nowrap text-xs">{paymentLabel(e.paymentMethod)}</span> },
    {
      key: "importe",
      header: t("economyExp.col.amount"),
      align: "right",
      num: true,
      mobile: "amount",
      cell: (e) => <span className="font-semibold text-danger">{money.eur(e.amount)}</span>,
    },
    {
      key: "iva",
      header: t("economyExp.col.iva"),
      align: "right",
      num: true,
      priority: "lg",
      cell: (e) => {
        const iva = ivaSoportado(e);
        const rate = (e as any).taxRate != null && (e as any).taxRate !== "" ? parseFloat((e as any).taxRate) : 21;
        if (iva === 0) return <span className="text-xs text-muted-foreground">{t("economyExp.noVat")}</span>;
        return <span className="text-xs font-medium text-success" title={t("economyExp.vatRate", { rate })}>{money.eur(iva)}</span>;
      },
    },
    {
      key: "estado",
      header: t("economyExp.col.status"),
      cell: (e) => (
        <StatusBadge tone={STATUS_TONES[e.status] ?? "neutral"} icon={e.status === "conciliado" ? <LinkIcon /> : undefined}>
          {statusLabel(e.status)}
        </StatusBadge>
      ),
    },
    {
      key: "adj",
      header: t("economyExp.col.files"),
      align: "center",
      priority: "md",
      cell: (e) =>
        e.files.length > 0 ? (
          <span className="inline-flex items-center gap-1 text-info"><FileText className="h-3.5 w-3.5" aria-hidden="true" /><span className="text-xs font-medium">{e.files.length}</span></span>
        ) : <span className="text-muted-foreground">{dash}</span>,
    },
  ];

  /** Etiquetas de una fila (email, solo fiscal, sin adjunto), pequeñas y en una línea que envuelve. */
  function ExpenseBadges({ e }: { e: any }) {
    const items: React.ReactNode[] = [];
    if (e.source === "email") items.push(<StatusBadge key="mail" tone="info" icon={<Mail />}>{t("economyExp.badge.email")}</StatusBadge>);
    if (e.isOperational === false) items.push(<span key="fiscal" title={t("economyExp.pending.taxOnlyHint")}><StatusBadge tone="warning" icon={<Scale />}>{t("economyExp.badge.taxOnly")}</StatusBadge></span>);
    if (e.missingAttachment) items.push(<StatusBadge key="att" tone="warning" icon={<AlertTriangle />}>{t("economyExp.badge.missing")}</StatusBadge>);
    return items.length ? <div className="mt-1 flex flex-wrap items-center gap-1">{items}</div> : null;
  }

  const rowMenu = (e: ExpenseRow) => [
    ...(e.files.length > 0 ? [{ label: t("economyExp.action.viewFiles", { count: e.files.length }), icon: <Paperclip />, onSelect: () => openEdit(e) }] : []),
    { label: t("economyExp.action.delete"), icon: <Trash2 />, destructive: true, onSelect: () => handleDelete(e.id) },
  ];

  // ── Cálculo del pie del formulario (solo visualización: misma fórmula que el bloque fiscal) ──
  const formTotal = parseFloat(form.amount) || 0;
  const formRate = parseFloat(form.taxRate) || 0;
  const formBase = formTotal / (1 + formRate / 100);
  const formCuota = formTotal - formBase;
  const formDeductible = parseFloat(form.deductiblePercent) || 0;
  const saving = createMut.isPending || updateMut.isPending || uploadFileMut.isPending;

  const filtersActive = chips.length > 0;
  const headerAction = (
    <>
      <Button onClick={openCreate} className="gap-2 max-sm:min-h-10"><Plus className="h-4 w-4" aria-hidden="true" /> {t("economyExp.new")}</Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" className="gap-1.5 max-sm:min-h-10" aria-label={t("economyExp.moreActions")}>
            <MoreHorizontal className="h-4 w-4" aria-hidden="true" /> {t("economyExp.menu.more")}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem title={t("economyExp.menu.exportHint")} onSelect={() => void exportToCSV()}>
            <Download className="mr-2 h-4 w-4" aria-hidden="true" /> {t("economyExp.menu.export")}
          </DropdownMenuItem>
          <DropdownMenuItem disabled={syncEmailMut.isPending} onSelect={() => syncEmailMut.mutate()}>
            {syncEmailMut.isPending ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : <Mail className="mr-2 h-4 w-4" aria-hidden="true" />}
            {syncEmailMut.isPending ? t("economyExp.menu.syncing") : t("economyExp.menu.sync")}
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={backfillMut.isPending}
            onSelect={async () => {
              if (await confirmAction({ description: t("economyExp.confirm.recalc") })) backfillMut.mutate();
            }}
          >
            {backfillMut.isPending ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : <Calculator className="mr-2 h-4 w-4" aria-hidden="true" />}
            {backfillMut.isPending ? t("economyExp.menu.recalculating") : t("economyExp.menu.recalc")}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setEmailLogsOpen(true)}>
            <Clock className="mr-2 h-4 w-4" aria-hidden="true" /> {t("economyExp.menu.logs")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );

  return (
    <AdminLayout>
      <EconomyShell screen="expenses" description={t("economyExp.description")} action={headerAction}>
        <div className="space-y-3">
          {/* Pendientes: una sola línea de chips, nunca antes de la lista */}
          {showPending && (
            <div role="group" aria-label={t("economyExp.pending.label")} className="-mx-1 flex items-center gap-2 overflow-x-auto px-1 pb-0.5">
              {bankTotal > 0 && (
                <PendingChip tone="info" icon={<Banknote />} label={t("economyExp.pending.bank", { count: bankTotal })} title={t("economyExp.pending.bankHint")} onClick={() => setBankOpen(true)} />
              )}
              {globalTaxOnly > 0 && (
                <PendingChip tone="warning" icon={<Scale />} label={t("economyExp.pending.taxOnly", { count: globalTaxOnly })} title={taxOnlyTitle} active={filterTreatment === "tax_only"} onClick={() => setFilterTreatment(filterTreatment === "tax_only" ? "all" : "tax_only")} />
              )}
              {globalMissing > 0 && (
                <PendingChip tone="warning" icon={<AlertTriangle />} label={t("economyExp.pending.missing", { count: globalMissing })} title={t("economyExp.pending.missingHint")} active={filterMissing} onClick={() => setFilterMissing((v) => !v)} />
              )}
            </div>
          )}

          {/* Resumen del filtro completo */}
          <div className="hidden sm:block"><SummaryStrip items={desktopItems} label={t("economyExp.summary.label")} /></div>
          <div className="space-y-2 sm:hidden">
            <SummaryStrip items={mobileItems} label={t("economyExp.summary.label")} />
            <div className="flex justify-end">{moreToggle}</div>
            {moreIndicators && <SummaryStrip items={STATUSES.filter((s) => s !== "pending").map(statusItem)} label={t("economyExp.summary.label")} />}
          </div>

          <ToolbarRow
            search={{ value: search, onChange: handleSearch, placeholder: t("economyExp.toolbar.search") }}
            filters={
              <>
                <Select value={filterStatus} onValueChange={setFilterStatus}>
                  <SelectTrigger aria-label={t("economyExp.toolbar.status")} className="h-9 w-full sm:w-44 max-sm:h-10"><SelectValue placeholder={t("economyExp.toolbar.status")} /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t("economyExp.toolbar.allStatuses")}</SelectItem>
                    {STATUSES.map((s) => <SelectItem key={s} value={s}>{statusLabel(s)}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={filterCategory} onValueChange={setFilterCategory}>
                  <SelectTrigger aria-label={t("economyExp.toolbar.category")} className="h-9 w-full sm:w-48 max-sm:h-10"><SelectValue placeholder={t("economyExp.toolbar.category")} /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t("economyExp.toolbar.allCategories")}</SelectItem>
                    {categories.map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground max-sm:justify-between">
                  {t("economyExp.toolbar.from")}
                  <Input type="date" value={filterDateFrom} max={filterDateTo || undefined} onChange={(e) => setFilterDateFrom(e.target.value)} className="h-9 w-40 bg-card max-sm:h-10 max-sm:w-44" />
                </label>
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground max-sm:justify-between">
                  {t("economyExp.toolbar.to")}
                  <Input type="date" value={filterDateTo} min={filterDateFrom || undefined} onChange={(e) => setFilterDateTo(e.target.value)} className="h-9 w-40 bg-card max-sm:h-10 max-sm:w-44" />
                </label>
                <MoreFilters label={t("economyExp.toolbar.more")} count={moreActive}>
                  <FilterField label={t("economyExp.toolbar.costCenter")}>
                    <Select value={filterCostCenter} onValueChange={setFilterCostCenter}>
                      <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">{t("economyExp.toolbar.allCostCenters")}</SelectItem>
                        {costCenters.map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </FilterField>
                  <FilterField label={t("economyExp.toolbar.source")}>
                    <Select value={filterSource} onValueChange={(v) => setFilterSource(v as "all" | "email")}>
                      <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">{t("economyExp.toolbar.allSources")}</SelectItem>
                        <SelectItem value="email">{t("economyExp.toolbar.sourceEmail")}</SelectItem>
                      </SelectContent>
                    </Select>
                  </FilterField>
                  <FilterField label={t("economyExp.toolbar.treatment")}>
                    <Select value={filterTreatment} onValueChange={(v) => setFilterTreatment(v as "all" | "operational" | "tax_only")}>
                      <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">{t("economyExp.toolbar.allTreatments")}</SelectItem>
                        <SelectItem value="operational">{t("economyExp.toolbar.operational")}</SelectItem>
                        <SelectItem value="tax_only">{t("economyExp.toolbar.taxOnlyOption")}</SelectItem>
                      </SelectContent>
                    </Select>
                  </FilterField>
                </MoreFilters>
              </>
            }
            chips={chips}
            onClear={clearFilters}
            summary={t("economyExp.toolbar.resultCount", { count: total })}
          />

          {!expensesQ.isLoading && !expensesQ.error && expenses.length === 0 ? (
            <CompactEmpty
              icon={<SearchX />}
              title={filtersActive ? t("economyExp.empty.title", { total: globalSummary?.count ?? 0 }) : t("economyExp.empty.noneTitle")}
              description={filtersActive ? t("economyExp.empty.description") : t("economyExp.empty.noneDescription")}
              action={
                <>
                  {filtersActive && <Button variant="outline" size="sm" className="max-sm:h-10" onClick={clearFilters}>{t("economyExp.empty.clear")}</Button>}
                  <Button size="sm" className="max-sm:h-10" onClick={openCreate}><Plus className="mr-1 h-4 w-4" aria-hidden="true" /> {t("economyExp.new")}</Button>
                </>
              }
            />
          ) : (
            <EconomyTable
              rows={expenses}
              columns={columns}
              rowKey={(e) => e.id}
              caption={t("economyExp.caption")}
              loading={expensesQ.isLoading}
              error={expensesQ.error}
              errorTitle={t("economyExp.loadError")}
              onRetry={() => void expensesQ.refetch()}
              emptyTitle={t("economyExp.empty.noneTitle")}
              onRowClick={(e) => openEdit(e)}
              actions={(e) => (
                <RowActions
                  label={e.concept}
                  primary={{ label: t("economyExp.action.edit"), icon: <Pencil className="h-4 w-4" />, onSelect: () => openEdit(e) }}
                  menu={rowMenu(e)}
                />
              )}
              mobileActions={(e) => <RowActions label={e.concept} menu={rowMenu(e)} />}
              mobileCard={(e, menu) => (
                <div className="space-y-1.5">
                  <div className="flex items-start justify-between gap-3">
                    <p className="line-clamp-2 min-w-0 break-words text-sm font-medium text-foreground">{e.concept}</p>
                    <span className="whitespace-nowrap text-sm font-semibold tabular-nums text-danger">{money.eur(e.amount)}</span>
                  </div>
                  <p className="overflow-hidden text-ellipsis whitespace-nowrap text-xs text-muted-foreground">
                    {[getSupplierName(e.supplierId) !== dash ? getSupplierName(e.supplierId) : null, getCategoryName(e.categoryId)].filter(Boolean).join(" · ")}
                  </p>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                      <StatusBadge tone={STATUS_TONES[e.status] ?? "neutral"} icon={e.status === "conciliado" ? <LinkIcon /> : undefined}>{statusLabel(e.status)}</StatusBadge>
                      <span className="text-xs text-muted-foreground">{day(e.date)}</span>
                      {(e as any).isOperational === false && <StatusBadge tone="warning" icon={<Scale />}>{t("economyExp.badge.taxOnly")}</StatusBadge>}
                      {(e as any).missingAttachment && <StatusBadge tone="warning" icon={<AlertTriangle />}>{t("economyExp.badge.missing")}</StatusBadge>}
                    </div>
                    {menu}
                  </div>
                </div>
              )}
              footer={<EconomyPager page={page} pageSize={pageSize} total={total} onPage={setPage} onPageSize={setPageSize} />}
            />
          )}
        </div>

        {/* Detectados por banco: panel lateral con tarjetas y «Crear gasto» visible en cada una */}
        <Sheet open={bankOpen} onOpenChange={setBankOpen}>
          <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-xl">
            <SheetHeader className="border-b border-border p-4">
              <SheetTitle className="flex items-center gap-2"><Banknote className="h-4 w-4 text-info" aria-hidden="true" />{t("economyExp.bank.title")}</SheetTitle>
              <SheetDescription>{t("economyExp.bank.description")} · {t("economyExp.bank.count", { count: bankTotal })}</SheetDescription>
            </SheetHeader>
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
              {(bankCandidatesQ.data?.data ?? []).length === 0 && <p className="text-sm text-muted-foreground">{t("economyExp.bank.empty")}</p>}
              {(bankCandidatesQ.data?.data ?? []).map((m) => (
                <div key={m.id} className="space-y-2 rounded-lg border border-border bg-card p-3">
                  <div className="flex items-start justify-between gap-3">
                    <span className="text-xs text-muted-foreground">{day(m.fecha)}</span>
                    <span className="whitespace-nowrap text-sm font-semibold tabular-nums text-danger">{money.eur(Math.abs(parseFloat(m.importe)))}</span>
                  </div>
                  <p className="line-clamp-2 break-words text-sm text-foreground" title={`${m.movimiento ?? ""} ${m.masDatos ?? ""}`.trim()}>
                    {(m.movimiento ?? m.masDatos ?? t("economyExp.bank.noDescription")).slice(0, 120)}
                  </p>
                  {m.suggestedCategoryName && <p className="text-xs text-info">{t("economyExp.bank.suggested", { name: m.suggestedCategoryName })}</p>}
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <Button size="sm" className="h-10 flex-1 sm:h-9 sm:flex-none" aria-label={t("economyExp.bank.createLabel", { date: day(m.fecha) })} onClick={() => openCreateFromMovement(m)}>
                      {t("economyExp.bank.create")}
                    </Button>
                    <Button size="sm" variant="ghost" className="h-10 flex-1 text-muted-foreground sm:h-9 sm:flex-none" aria-label={t("economyExp.bank.ignoreLabel", { date: day(m.fecha) })} disabled={ignoreBankMut.isPending} onClick={() => ignoreBankMut.mutate({ bankMovementId: m.id })}>
                      {t("economyExp.bank.ignore")}
                    </Button>
                  </div>
                </div>
              ))}
              {bankTotal > (bankCandidatesQ.data?.data ?? []).length && (
                <p className="text-xs text-muted-foreground">{t("economyExp.bank.showingOf", { shown: (bankCandidatesQ.data?.data ?? []).length, total: bankTotal })}</p>
              )}
            </div>
            <div className="border-t border-border bg-background p-3">
              <Button variant="outline" className="h-10 w-full sm:w-auto" onClick={() => setBankOpen(false)}>{t("economyExp.bank.close")}</Button>
            </div>
          </SheetContent>
        </Sheet>

        {/* Nuevo / Editar gasto */}
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>{editingId ? t("economyExp.form.editTitle") : t("economyExp.form.newTitle")}</DialogTitle>
            </DialogHeader>

            <div className="space-y-3">
              <CollapsibleSection title={t("economyExp.form.sectionData")} open={openData} onOpenChange={setOpenData}>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <FormField label={t("economyExp.form.date")} required error={showFormErrors && !form.date ? t("economyExp.form.errDate") : null}>
                    <Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
                  </FormField>
                  <FormField label={t("economyExp.form.amount")} required hint={t("economyExp.form.amountHint")} error={showFormErrors && !form.amount ? t("economyExp.form.errAmount") : null}>
                    <Input type="number" step="0.01" inputMode="decimal" placeholder="0.00" className="tabular-nums" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
                  </FormField>
                </div>
                <FormField label={t("economyExp.form.concept")} required error={showFormErrors && !form.concept ? t("economyExp.form.errConcept") : null}>
                  <Input placeholder={t("economyExp.form.conceptPlaceholder")} value={form.concept} onChange={(e) => setForm({ ...form, concept: e.target.value })} />
                </FormField>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <FormField label={t("economyExp.form.status")}>
                    <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                      <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {(["pending", "justified", "accounted"] as const).map((s) => <SelectItem key={s} value={s}>{statusLabel(s)}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </FormField>
                  <FormField label={t("economyExp.form.notes")}>
                    <Textarea placeholder={t("economyExp.form.notesPlaceholder")} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} />
                  </FormField>
                </div>
              </CollapsibleSection>

              <CollapsibleSection title={t("economyExp.form.sectionClass")} open={openClass} onOpenChange={setOpenClass}>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="min-w-0">
                    <div className="mb-1 flex items-center justify-between">
                      <Label>{t("economyExp.form.category")} <span className="text-danger" aria-hidden="true">*</span></Label>
                      <button type="button" onClick={() => { setQuickCatName(""); setQuickCatDesc(""); setQuickCatOpen(true); }} className="flex min-h-8 items-center gap-0.5 text-xs text-primary hover:underline"><Plus className="h-3 w-3" aria-hidden="true" />{t("economyExp.form.newShort")}</button>
                    </div>
                    <Select value={form.categoryId} onValueChange={(v) => setForm({ ...form, categoryId: v })}>
                      <SelectTrigger className="w-full"><SelectValue placeholder={t("economyExp.form.select")} /></SelectTrigger>
                      <SelectContent>{categories.map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}</SelectContent>
                    </Select>
                    {showFormErrors && !form.categoryId && <p role="alert" className="mt-1 text-xs text-danger">{t("economyExp.form.errCategory")}</p>}
                  </div>
                  <div className="min-w-0">
                    <div className="mb-1 flex items-center justify-between">
                      <Label>{t("economyExp.form.costCenter")} <span className="text-danger" aria-hidden="true">*</span></Label>
                      <button type="button" onClick={() => { setQuickCCName(""); setQuickCCDesc(""); setQuickCCOpen(true); }} className="flex min-h-8 items-center gap-0.5 text-xs text-primary hover:underline"><Plus className="h-3 w-3" aria-hidden="true" />{t("economyExp.form.newShortM")}</button>
                    </div>
                    <Select value={form.costCenterId} onValueChange={(v) => setForm({ ...form, costCenterId: v })}>
                      <SelectTrigger className="w-full"><SelectValue placeholder={t("economyExp.form.select")} /></SelectTrigger>
                      <SelectContent>{costCenters.map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}</SelectContent>
                    </Select>
                    {showFormErrors && !form.costCenterId && <p role="alert" className="mt-1 text-xs text-danger">{t("economyExp.form.errCostCenter")}</p>}
                  </div>
                  <div className="min-w-0">
                    <div className="mb-1 flex items-center justify-between">
                      <Label>{t("economyExp.form.supplier")}</Label>
                      <button type="button" onClick={() => { setQuickSupName(""); setQuickSupOpen(true); }} className="flex min-h-8 items-center gap-0.5 text-xs text-primary hover:underline"><Plus className="h-3 w-3" aria-hidden="true" />{t("economyExp.form.newShortM")}</button>
                    </div>
                    <Select value={form.supplierId || "none"} onValueChange={(v) => setForm({ ...form, supplierId: v === "none" ? "" : v })}>
                      <SelectTrigger className="w-full"><SelectValue placeholder={t("economyExp.noSupplier")} /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">{t("economyExp.noSupplier")}</SelectItem>
                        {suppliers.map((s) => <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <FormField label={t("economyExp.form.method")}>
                    <Select value={form.paymentMethod} onValueChange={(v) => setForm({ ...form, paymentMethod: v })}>
                      <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                      <SelectContent>{PAYMENT_METHODS.map((k) => <SelectItem key={k} value={k}>{paymentLabel(k)}</SelectItem>)}</SelectContent>
                    </Select>
                  </FormField>
                </div>
              </CollapsibleSection>

              <CollapsibleSection title={t("economyExp.form.sectionAdvanced")} hint={t("economyExp.form.sectionAdvancedHint")} open={openAdvanced} onOpenChange={setOpenAdvanced}>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <FormField label={t("economyExp.form.invoiceType")}>
                    <Select value={form.invoiceType} onValueChange={(v) => setForm({ ...form, invoiceType: v })}>
                      <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                      <SelectContent>{INVOICE_TYPES.map((k) => <SelectItem key={k} value={k}>{t(`economyExp.invoiceType.${k}`)}</SelectItem>)}</SelectContent>
                    </Select>
                  </FormField>
                  <FormField label={t("economyExp.form.taxRate")}>
                    <Select value={form.taxRate} onValueChange={(v) => setForm({ ...form, taxRate: v })}>
                      <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="21">21 %</SelectItem>
                        <SelectItem value="10">10 %</SelectItem>
                        <SelectItem value="4">4 %</SelectItem>
                        <SelectItem value="0">{t("economyExp.form.rate0")}</SelectItem>
                      </SelectContent>
                    </Select>
                  </FormField>
                  <FormField label={t("economyExp.form.deductible")}>
                    <Input type="number" step="1" min="0" max="100" value={form.deductiblePercent} onChange={(e) => setForm({ ...form, deductiblePercent: e.target.value })} />
                  </FormField>
                </div>
                <div className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-3">
                  <div className="rounded bg-muted/40 px-2 py-1.5"><div className="text-muted-foreground">{t("economyExp.form.base")}</div><div className="font-semibold tabular-nums">{money.eur(formBase)}</div></div>
                  <div className="rounded bg-muted/40 px-2 py-1.5"><div className="text-muted-foreground">{t("economyExp.form.cuota")}</div><div className="font-semibold tabular-nums">{money.eur(formCuota)}</div></div>
                  <div className="rounded bg-muted/40 px-2 py-1.5"><div className="text-muted-foreground">{t("economyExp.form.deductibleAmount")}</div><div className="font-semibold tabular-nums text-success">{money.eur(formCuota * formDeductible / 100)}</div></div>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <FormField label={t("economyExp.form.nif")}>
                    <Input value={form.supplierNif} onChange={(e) => setForm({ ...form, supplierNif: e.target.value })} placeholder="B12345678" />
                  </FormField>
                  <FormField label={t("economyExp.form.retention")}>
                    <Input type="number" step="0.01" min="0" value={form.retentionPercent} onChange={(e) => setForm({ ...form, retentionPercent: e.target.value })} placeholder="0" />
                  </FormField>
                  <FormField label={t("economyExp.form.accrual")}>
                    <Input type="date" value={form.accrualDate} onChange={(e) => setForm({ ...form, accrualDate: e.target.value })} />
                  </FormField>
                </div>
                <p className="text-xs text-muted-foreground">{t("economyExp.form.taxHelp")}</p>

                <div className={cn("rounded-lg border p-3", form.isOperational ? "border-border bg-muted/20" : "border-warning/40 bg-warning/10")}>
                  <label className="flex cursor-pointer items-start gap-3">
                    <input type="checkbox" checked={form.isOperational} onChange={(e) => setForm({ ...form, isOperational: e.target.checked })} className="mt-0.5 h-4 w-4 cursor-pointer rounded border-border accent-primary" />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                        {t("economyExp.form.treatmentLabel")}
                        {!form.isOperational && <StatusBadge tone="warning">{t("economyExp.badge.taxOnly")}</StatusBadge>}
                      </div>
                      <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{t("economyExp.form.treatmentHint")}</p>
                    </div>
                  </label>
                </div>

                <div className="space-y-2">
                  {existingFiles.length > 0 && (
                    <div>
                      <Label className="mb-2 block">{t("economyExp.form.savedFiles")}</Label>
                      <div className="space-y-1.5">
                        {existingFiles.map((file) => (
                          <div key={file.id} className="flex items-center gap-2 rounded border bg-muted/30 px-2 py-1.5">
                            {isImage(file.mimeType) ? (
                              <button type="button" className="h-8 w-8 shrink-0 overflow-hidden rounded border border-border hover:opacity-80" onClick={() => setLightboxUrl(file.filePath)} title={t("economyExp.form.viewImage")}>
                                <img src={file.filePath} alt={file.fileName ?? ""} className="h-full w-full object-cover" />
                              </button>
                            ) : (
                              <FileText className="h-4 w-4 shrink-0 text-info" aria-hidden="true" />
                            )}
                            <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-sm text-foreground/80" title={file.fileName ?? file.filePath}>
                              {file.fileName ?? file.filePath.split("/").pop() ?? t("economyExp.form.fileFallback")}
                            </span>
                            <a href={file.filePath} target="_blank" rel="noopener noreferrer" className="shrink-0 rounded p-2 text-info hover:bg-info/10" title={t("economyExp.form.openNew")} aria-label={t("economyExp.form.openNew")}>
                              <ExternalLink className="h-3.5 w-3.5" />
                            </a>
                            <button type="button" className="shrink-0 rounded p-2 text-muted-foreground hover:bg-danger/10 hover:text-danger" onClick={() => handleDeleteFile(file.id)} title={t("economyExp.form.removeFile")} aria-label={t("economyExp.form.removeFile")}>
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  <div>
                    <Label>{t("economyExp.form.dropFiles")}</Label>
                    <div
                      className="mt-1 cursor-pointer rounded-lg border-2 border-dashed p-4 text-center transition-colors hover:border-primary/50"
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={handleFilesDrop}
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <Upload className="mx-auto mb-1 h-6 w-6 text-muted-foreground" aria-hidden="true" />
                      <p className="text-sm text-muted-foreground">{t("economyExp.form.dropHint")}</p>
                      <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleFilesInput} />
                    </div>
                    {pendingFiles.length > 0 && (
                      <div className="mt-2 space-y-1">
                        {pendingFiles.map((file, i) => (
                          <div key={i} className="flex items-center justify-between rounded bg-muted/30 px-2 py-1 text-sm">
                            <span className="flex items-center gap-1"><FileText className="h-3 w-3" aria-hidden="true" />{file.name}</span>
                            <button type="button" className="p-1" aria-label={t("economyExp.form.removeFile")} onClick={() => setPendingFiles((prev) => prev.filter((_, j) => j !== i))}>
                              <X className="h-3 w-3 text-muted-foreground hover:text-danger" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </CollapsibleSection>
            </div>

            <FormFooter className="sm:items-center">
              <p className="mr-auto flex flex-wrap items-baseline gap-x-4 gap-y-0.5 text-sm max-sm:order-last max-sm:w-full">
                <span className="text-muted-foreground">{t("economyExp.form.footerTotal")} <strong className="tabular-nums text-foreground">{money.eur(formTotal)}</strong></span>
                <span className="text-muted-foreground">{t("economyExp.form.footerVat")} <strong className="tabular-nums text-foreground">{money.eur(formCuota)}</strong></span>
              </p>
              <Button variant="outline" onClick={() => setDialogOpen(false)}>{t("economyExp.form.cancel")}</Button>
              <Button onClick={handleSave} disabled={saving}>
                {saving ? t("economyExp.form.saving") : editingId ? t("economyExp.form.save") : t("economyExp.form.create")}
              </Button>
            </FormFooter>
          </DialogContent>
        </Dialog>

        {/* Crear gasto desde un movimiento bancario */}
        {createFromMovId !== null && (() => {
          const mov = bankCandidatesQ.data?.data.find((m) => m.id === createFromMovId);
          if (!mov) return null;
          return (
            <Dialog open onOpenChange={(open) => { if (!open) setCreateFromMovId(null); }}>
              <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2"><Banknote className="h-4 w-4 text-info" aria-hidden="true" />{t("economyExp.bank.dialogTitle")}</DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                  <div className="space-y-1 rounded-lg border border-info/20 bg-info/10 p-3">
                    <div className="flex justify-between gap-3 text-sm"><span className="text-muted-foreground">{t("economyExp.bank.date")}</span><span className="font-medium text-foreground">{day(mov.fecha)}</span></div>
                    <div className="flex justify-between gap-3 text-sm"><span className="text-muted-foreground">{t("economyExp.bank.amount")}</span><span className="font-bold tabular-nums text-danger">{money.eur(Math.abs(parseFloat(mov.importe)))}</span></div>
                    <div className="flex justify-between gap-3 text-sm"><span className="shrink-0 text-muted-foreground">{t("economyExp.bank.bankText")}</span><span className="line-clamp-2 min-w-0 break-words text-right text-xs text-foreground">{`${mov.movimiento ?? ""} ${mov.masDatos ?? ""}`.trim() || dash}</span></div>
                    {mov.suggestedCategoryName && <div className="flex justify-between gap-3 text-sm"><span className="text-muted-foreground">{t("economyExp.bank.suggestedShort")}</span><span className="text-xs text-info">{mov.suggestedCategoryName}</span></div>}
                  </div>
                  <FormField label={t("economyExp.bank.concept")} required>
                    <Input value={movForm.concept} onChange={(e) => setMovForm({ ...movForm, concept: e.target.value })} placeholder={t("economyExp.form.conceptPlaceholder")} />
                  </FormField>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <FormField label={t("economyExp.form.category")} required>
                      <Select value={movForm.categoryId} onValueChange={(v) => setMovForm({ ...movForm, categoryId: v })}>
                        <SelectTrigger className="w-full"><SelectValue placeholder={t("economyExp.form.select")} /></SelectTrigger>
                        <SelectContent>{categories.map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}</SelectContent>
                      </Select>
                    </FormField>
                    <FormField label={t("economyExp.form.costCenter")} required>
                      <Select value={movForm.costCenterId} onValueChange={(v) => setMovForm({ ...movForm, costCenterId: v })}>
                        <SelectTrigger className="w-full"><SelectValue placeholder={t("economyExp.form.select")} /></SelectTrigger>
                        <SelectContent>{costCenters.map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}</SelectContent>
                      </Select>
                    </FormField>
                    <FormField label={t("economyExp.form.supplier")}>
                      <Select value={movForm.supplierId || "none"} onValueChange={(v) => setMovForm({ ...movForm, supplierId: v === "none" ? "" : v })}>
                        <SelectTrigger className="w-full"><SelectValue placeholder={t("economyExp.noSupplier")} /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">{t("economyExp.noSupplier")}</SelectItem>
                          {suppliers.map((s) => <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </FormField>
                    <FormField label={t("economyExp.form.method")}>
                      <Select value={movForm.paymentMethod} onValueChange={(v) => setMovForm({ ...movForm, paymentMethod: v })}>
                        <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                        <SelectContent>{PAYMENT_METHODS.map((k) => <SelectItem key={k} value={k}>{paymentLabel(k)}</SelectItem>)}</SelectContent>
                      </Select>
                    </FormField>
                  </div>
                  <FormField label={t("economyExp.bank.notes")}>
                    <Input value={movForm.notes} onChange={(e) => setMovForm({ ...movForm, notes: e.target.value })} placeholder={t("economyExp.bank.notesPlaceholder")} />
                  </FormField>
                  <FormFooter>
                    <Button variant="outline" onClick={() => setCreateFromMovId(null)}>{t("economyExp.bank.cancel")}</Button>
                    <Button onClick={handleCreateFromMovement} disabled={createFromMovMut.isPending}>
                      <Banknote className="mr-2 h-4 w-4" aria-hidden="true" />
                      {createFromMovMut.isPending ? t("economyExp.bank.creating") : t("economyExp.bank.createLinked")}
                    </Button>
                  </FormFooter>
                </div>
              </DialogContent>
            </Dialog>
          );
        })()}

        {/* Historial de ingesta por email */}
        <Dialog open={emailLogsOpen} onOpenChange={setEmailLogsOpen}>
          <DialogContent className="max-h-[80vh] max-w-3xl overflow-y-auto border-border bg-card text-foreground sm:max-w-3xl">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2"><Mail className="h-4 w-4 text-info" aria-hidden="true" />{t("economyExp.logs.title")}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 py-2">
              {emailLogsQ.isLoading ? (
                <p className="py-6 text-center text-sm text-muted-foreground">{t("economyExp.logs.loading")}</p>
              ) : !emailLogsQ.data?.length ? (
                <p className="py-6 text-center text-sm text-muted-foreground">{t("economyExp.logs.empty")}</p>
              ) : (
                <div className="divide-y divide-border overflow-hidden rounded-lg border border-border">
                  {emailLogsQ.data.map((log) => (
                    <div key={log.id} className="flex items-start gap-3 px-4 py-3">
                      <div className="mt-0.5 shrink-0">
                        {log.status === "processed" && <CheckCircle2 className="h-4 w-4 text-success" aria-hidden="true" />}
                        {log.status === "duplicated" && <RefreshCw className="h-4 w-4 text-muted-foreground" aria-hidden="true" />}
                        {(log.status === "missing_amount" || log.status === "invalid_subject") && <AlertTriangle className="h-4 w-4 text-warning" aria-hidden="true" />}
                        {log.status === "error" && <AlertTriangle className="h-4 w-4 text-danger" aria-hidden="true" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="max-w-xs overflow-hidden text-ellipsis whitespace-nowrap text-sm font-medium text-foreground">{log.subject ?? t("economyExp.logs.noSubject")}</span>
                          {log.amountDetected && <span className="text-xs font-semibold text-success">{money.eur(String(log.amountDetected))}</span>}
                          {log.attachmentsCount !== null && log.attachmentsCount > 0 && (
                            <span className="text-xs text-muted-foreground"><FileText className="mr-0.5 inline h-3 w-3" aria-hidden="true" />{t("economyExp.logs.attachments", { count: log.attachmentsCount })}</span>
                          )}
                        </div>
                        <div className="mt-0.5 text-xs text-muted-foreground">
                          {log.sender && <span>{log.sender} · </span>}
                          {log.processedAt && <span>{f.dateTime(log.processedAt)}</span>}
                        </div>
                        {log.errorMessage && <div className="mt-1 text-xs text-warning">{log.errorMessage}</div>}
                      </div>
                      <div className="shrink-0">
                        <span className={cn("rounded px-1.5 py-0.5 text-xs font-medium",
                          log.status === "processed" ? "bg-success/15 text-success" :
                          log.status === "duplicated" ? "bg-muted text-muted-foreground" :
                          log.status === "error" ? "bg-danger/15 text-danger" : "bg-warning/15 text-warning")}>
                          {["processed", "duplicated", "missing_amount", "invalid_subject"].includes(log.status) ? t(`economyExp.logs.${log.status}`) : t("economyExp.logs.error")}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </DialogContent>
        </Dialog>

        {/* Altas rápidas */}
        <Dialog open={quickCatOpen} onOpenChange={setQuickCatOpen}>
          <DialogContent className="max-w-sm">
            <DialogHeader><DialogTitle>{t("economyExp.quick.categoryTitle")}</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <FormField label={t("economyExp.quick.name")} required>
                <Input
                  value={quickCatName}
                  onChange={(e) => setQuickCatName(e.target.value)}
                  placeholder={t("economyExp.quick.categoryPlaceholder")}
                  onKeyDown={(e) => e.key === "Enter" && quickCatName.trim() && !dupCat && createCatMut.mutate({ name: quickCatName.trim(), description: quickCatDesc || undefined })}
                  autoFocus
                />
              </FormField>
              <FormField label={t("economyExp.quick.description")}>
                <Input value={quickCatDesc} onChange={(e) => setQuickCatDesc(e.target.value)} placeholder={t("economyExp.quick.optional")} />
              </FormField>
              {dupCat && <DuplicateNotice text={t("economyExp.quick.dupCategory", { name: dupCat.name })} action={t("economyExp.quick.useExisting")} onUse={() => { setForm((x) => ({ ...x, categoryId: String(dupCat.id) })); setQuickCatOpen(false); }} />}
              <FormFooter>
                <Button variant="outline" onClick={() => setQuickCatOpen(false)}>{t("economyExp.quick.cancel")}</Button>
                <Button onClick={() => quickCatName.trim() && createCatMut.mutate({ name: quickCatName.trim(), description: quickCatDesc || undefined })} disabled={!quickCatName.trim() || !!dupCat || createCatMut.isPending}>{t("economyExp.quick.createSelect")}</Button>
              </FormFooter>
            </div>
          </DialogContent>
        </Dialog>

        <Dialog open={quickCCOpen} onOpenChange={setQuickCCOpen}>
          <DialogContent className="max-w-sm">
            <DialogHeader><DialogTitle>{t("economyExp.quick.costCenterTitle")}</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <FormField label={t("economyExp.quick.name")} required>
                <Input
                  value={quickCCName}
                  onChange={(e) => setQuickCCName(e.target.value)}
                  placeholder={t("economyExp.quick.costCenterPlaceholder")}
                  onKeyDown={(e) => e.key === "Enter" && quickCCName.trim() && !dupCC && createCCMut.mutate({ name: quickCCName.trim(), description: quickCCDesc || undefined })}
                  autoFocus
                />
              </FormField>
              <FormField label={t("economyExp.quick.description")}>
                <Input value={quickCCDesc} onChange={(e) => setQuickCCDesc(e.target.value)} placeholder={t("economyExp.quick.optional")} />
              </FormField>
              {dupCC && <DuplicateNotice text={t("economyExp.quick.dupCostCenter", { name: dupCC.name })} action={t("economyExp.quick.useExisting")} onUse={() => { setForm((x) => ({ ...x, costCenterId: String(dupCC.id) })); setQuickCCOpen(false); }} />}
              <FormFooter>
                <Button variant="outline" onClick={() => setQuickCCOpen(false)}>{t("economyExp.quick.cancel")}</Button>
                <Button onClick={() => quickCCName.trim() && createCCMut.mutate({ name: quickCCName.trim(), description: quickCCDesc || undefined })} disabled={!quickCCName.trim() || !!dupCC || createCCMut.isPending}>{t("economyExp.quick.createSelect")}</Button>
              </FormFooter>
            </div>
          </DialogContent>
        </Dialog>

        <Dialog open={quickSupOpen} onOpenChange={setQuickSupOpen}>
          <DialogContent className="max-w-sm">
            <DialogHeader><DialogTitle>{t("economyExp.quick.supplierTitle")}</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <FormField label={t("economyExp.quick.tradeName")} required>
                <Input
                  value={quickSupName}
                  onChange={(e) => setQuickSupName(e.target.value)}
                  placeholder={t("economyExp.quick.supplierPlaceholder")}
                  onKeyDown={(e) => e.key === "Enter" && quickSupName.trim() && !dupSup && createSupMut.mutate({ name: quickSupName.trim() })}
                  autoFocus
                />
              </FormField>
              {dupSup && <DuplicateNotice text={t("economyExp.quick.dupSupplier", { name: dupSup.name })} action={t("economyExp.quick.useExisting")} onUse={() => { setForm((x) => ({ ...x, supplierId: String(dupSup.id) })); setQuickSupOpen(false); }} />}
              <p className="text-xs text-muted-foreground">{t("economyExp.quick.supplierHint")}</p>
              <FormFooter>
                <Button variant="outline" onClick={() => setQuickSupOpen(false)}>{t("economyExp.quick.cancel")}</Button>
                <Button onClick={() => quickSupName.trim() && createSupMut.mutate({ name: quickSupName.trim() })} disabled={!quickSupName.trim() || !!dupSup || createSupMut.isPending}>{t("economyExp.quick.createSelect")}</Button>
              </FormFooter>
            </div>
          </DialogContent>
        </Dialog>

        {/* Imagen adjunta a pantalla completa */}
        {lightboxUrl && (
          <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/90 p-4" onClick={() => setLightboxUrl(null)}>
            <button className="absolute right-4 top-4 rounded-full bg-muted/50 p-2 text-foreground hover:bg-muted" aria-label={t("economyExp.form.close")} onClick={() => setLightboxUrl(null)}>
              <X className="h-5 w-5" />
            </button>
            <a href={lightboxUrl} target="_blank" rel="noopener noreferrer" className="absolute right-16 top-4 rounded-full bg-muted/50 p-2 text-foreground hover:bg-muted" onClick={(e) => e.stopPropagation()} title={t("economyExp.form.openOriginal")} aria-label={t("economyExp.form.openOriginal")}>
              <ExternalLink className="h-5 w-5" />
            </a>
            <img src={lightboxUrl} alt={t("economyExp.form.lightbox")} className="max-h-[90vh] max-w-full rounded-lg object-contain shadow-md" onClick={(e) => e.stopPropagation()} />
          </div>
        )}
      </EconomyShell>
    </AdminLayout>
  );
}
