import { useState } from "react";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  Plus, FileText, Euro, CheckCircle2, Clock,
  ChevronRight, Trash2, RefreshCw, Building2,
  Receipt, Package, TrendingUp, FolderOpen, Lock,
  User, Mail, Phone, CreditCard, MapPin, Monitor, ShoppingCart, Store,
  AlertCircle
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

type FiscalStatus = "pendiente_documentacion" | "documentacion_completa" | "en_revision" | "cerrado" | "anulado";
type OperativeStatus = "abierto" | "en_proceso" | "cerrado" | "anulado";

const FISCAL_STATUS_LABELS: Record<FiscalStatus, string> = {
  pendiente_documentacion: "Pendiente Documentación",
  documentacion_completa: "Documentación Completa",
  en_revision: "En Revisión",
  cerrado: "Cerrado",
  anulado: "Anulado",
};

const FISCAL_STATUS_COLORS: Record<FiscalStatus, string> = {
  pendiente_documentacion: "bg-yellow-100 text-yellow-800 border border-yellow-200",
  documentacion_completa: "bg-blue-100 text-blue-800 border border-blue-200",
  en_revision: "bg-purple-100 text-purple-800 border border-purple-200",
  cerrado: "bg-green-100 text-green-800 border border-green-200",
  anulado: "bg-red-100 text-red-800 border border-red-200",
};

const OPERATIVE_STATUS_COLORS: Record<OperativeStatus, string> = {
  abierto: "bg-emerald-100 text-emerald-800 border border-emerald-200",
  en_proceso: "bg-orange-100 text-orange-800 border border-orange-200",
  cerrado: "bg-slate-100 text-slate-700 border border-slate-200",
  anulado: "bg-red-100 text-red-800 border border-red-200",
};

// ─── Semáforo visual ──────────────────────────────────────────────────────────

type TrafficLight = "red" | "yellow" | "green" | "grey";

function getTrafficLight(fiscalStatus: string, operativeStatus: string): TrafficLight {
  if (operativeStatus === "anulado" || fiscalStatus === "anulado") return "grey";
  if (fiscalStatus === "cerrado" && operativeStatus === "cerrado") return "green";
  if (fiscalStatus === "documentacion_completa" || fiscalStatus === "en_revision") return "yellow";
  if (fiscalStatus === "pendiente_documentacion") return "red";
  return "yellow";
}

const TRAFFIC_LIGHT_CONFIG: Record<TrafficLight, { bg: string; ring: string; label: string; pulse: boolean }> = {
  red:    { bg: "bg-red-500",     ring: "ring-red-300",     label: "Pendiente documentación", pulse: true },
  yellow: { bg: "bg-amber-400",   ring: "ring-amber-200",   label: "En proceso",               pulse: false },
  green:  { bg: "bg-emerald-500", ring: "ring-emerald-300", label: "Cerrado y validado",       pulse: false },
  grey:   { bg: "bg-slate-400",   ring: "ring-slate-200",   label: "Anulado",                  pulse: false },
};

function TrafficLightDot({ fiscalStatus, operativeStatus }: { fiscalStatus: string; operativeStatus: string }) {
  const light = getTrafficLight(fiscalStatus, operativeStatus);
  const cfg = TRAFFIC_LIGHT_CONFIG[light];
  return (
    <span
      title={cfg.label}
      className={`inline-block w-3 h-3 rounded-full ring-2 shrink-0 ${cfg.bg} ${cfg.ring} ${cfg.pulse ? "animate-pulse" : ""}`}
    />
  );
}

const COST_CATEGORIES = [
  { value: "transporte", label: "Transporte" },
  { value: "alojamiento", label: "Alojamiento" },
  { value: "actividad", label: "Actividad" },
  { value: "restauracion", label: "Restauración" },
  { value: "guia", label: "Guía" },
  { value: "seguro", label: "Seguro" },
  { value: "otros", label: "Otros" },
];

const DOC_TYPES_CLIENT = [
  { value: "factura_emitida", label: "Factura Emitida" },
  { value: "contrato", label: "Contrato" },
  { value: "voucher", label: "Voucher" },
  { value: "otro", label: "Otro" },
];

const DOC_TYPES_PROVIDER = [
  { value: "factura_recibida", label: "Factura Recibida" },
  { value: "confirmacion_proveedor", label: "Confirmación Proveedor" },
  { value: "otro", label: "Otro" },
];

// ─── Main Component ───────────────────────────────────────────────────────────

export default function ReavManager() {
  const [filterFiscal, setFilterFiscal] = useState<string>("all");
  const [filterOperative, setFilterOperative] = useState<string>("all");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const { data: expedients, refetch } = trpc.reav.list.useQuery({
    fiscalStatus: filterFiscal === "all" ? undefined : filterFiscal || undefined,
    operativeStatus: filterOperative === "all" ? undefined : filterOperative || undefined,
  });

  const { data: selected, refetch: refetchSelected } = trpc.reav.get.useQuery(
    { id: selectedId! },
    { enabled: selectedId !== null }
  );

  const createMut = trpc.reav.create.useMutation({
    onSuccess: () => { refetch(); setShowCreate(false); toast.success("Expediente creado"); },
    onError: (e) => toast.error(e.message),
  });

  const updateMut = trpc.reav.update.useMutation({
    onSuccess: () => { refetchSelected(); refetch(); toast.success("Guardado"); },
    onError: (e) => toast.error(e.message),
  });

  const recalcMut = trpc.reav.recalculate.useMutation({
    onSuccess: () => { refetchSelected(); toast.success("Márgenes recalculados"); },
    onError: (e) => toast.error(e.message),
  });

  const addDocMut = trpc.reav.addDocument.useMutation({
    onSuccess: () => { refetchSelected(); toast.success("Documento añadido"); },
    onError: (e) => toast.error(e.message),
  });

  const delDocMut = trpc.reav.deleteDocument.useMutation({
    onSuccess: () => { refetchSelected(); toast.success("Documento eliminado"); },
    onError: (e) => toast.error(e.message),
  });

  const addCostMut = trpc.reav.addCost.useMutation({
    onSuccess: () => { refetchSelected(); toast.success("Coste añadido"); },
    onError: (e) => toast.error(e.message),
  });

  const delCostMut = trpc.reav.deleteCost.useMutation({
    onSuccess: () => { refetchSelected(); toast.success("Coste eliminado"); },
    onError: (e) => toast.error(e.message),
  });

  const exportZipMut = trpc.reav.exportZip.useMutation({
    onSuccess: (data) => {
      const link = document.createElement("a");
      link.href = `data:application/zip;base64,${data.base64}`;
      link.download = data.filename;
      link.click();
      toast.success("ZIP descargado");
    },
    onError: (e) => toast.error(`Error al generar ZIP: ${e.message}`),
  });

  function handleExportExcel(exp: any) {
    // Importación dinámica para no aumentar el bundle en la carga inicial
    import("xlsx").then(({ utils, writeFile }) => {
      const wb = utils.book_new();

      // ── Hoja 1: Resumen ──────────────────────────────────────────────────
      const resumen = [
        ["EXPEDIENTE REAV", exp.expedientNumber],
        ["Estado fiscal", exp.fiscalStatus],
        ["Estado operativo", exp.operativeStatus],
        [],
        ["SERVICIO"],
        ["Descripción", exp.serviceDescription],
        ["Fecha", exp.serviceDate],
        ["Destino", exp.destination],
        ["Pax", exp.numberOfPax],
        ["Referencia", exp.sourceRef],
        [],
        ["CLIENTE"],
        ["Nombre", exp.clientName],
        ["Email", exp.clientEmail],
        ["Teléfono", exp.clientPhone],
        ["DNI/NIF", exp.clientDni],
        ["Dirección", exp.clientAddress],
        [],
        ["IMPORTES"],
        ["Venta total (€)", parseFloat(exp.saleAmountTotal ?? "0")],
        ["Coste proveedor real (€)", parseFloat(exp.providerCostReal ?? "0")],
        ["Margen real (€)", parseFloat(exp.agencyMarginReal ?? "0")],
        ["Base imponible REAV (€)", parseFloat(exp.reavTaxBase ?? "0")],
        ["IVA REAV 21% (€)", parseFloat(exp.reavTaxAmount ?? "0")],
      ];
      utils.book_append_sheet(wb, utils.aoa_to_sheet(resumen), "Resumen");

      // ── Hoja 2: Costes de proveedor ───────────────────────────────────────
      const costsHeader = ["Descripción", "Proveedor", "NIF Proveedor", "Categoría", "Importe (€)", "IVA incluido", "N.º Factura", "Fecha Factura", "Pagado"];
      const costsRows = (exp.costs ?? []).map((c: any) => [
        c.description,
        c.providerName ?? "",
        c.providerNif ?? "",
        c.category,
        parseFloat(c.amount),
        c.includesVat ? "Sí" : "No",
        c.invoiceRef ?? "",
        c.invoiceDate ?? "",
        c.isPaid ? "Sí" : "No",
      ]);
      utils.book_append_sheet(wb, utils.aoa_to_sheet([costsHeader, ...costsRows]), "Costes Proveedor");

      // ── Hoja 3: Documentos ────────────────────────────────────────────────
      const docsHeader = ["Lado", "Tipo", "Título", "URL", "Notas"];
      const docsRows = (exp.documents ?? []).map((d: any) => [
        d.side, d.docType, d.title, d.fileUrl ?? "", d.notes ?? "",
      ]);
      utils.book_append_sheet(wb, utils.aoa_to_sheet([docsHeader, ...docsRows]), "Documentos");

      writeFile(wb, `${exp.expedientNumber}_REAV.xlsx`);
      toast.success("Excel descargado");
    }).catch(() => toast.error("Error al generar Excel"));
  }

  return (
    <AdminLayout>
      {/* ── Fondo general claro, sin overflow horizontal ── */}
      <div className="flex h-full min-h-screen bg-slate-50 overflow-x-hidden">

        {/* ── Panel izquierdo: lista de expedientes ── */}
        <div className="w-80 min-w-[280px] max-w-xs border-r border-slate-200 bg-white flex flex-col shrink-0">
          {/* Cabecera del panel */}
          <div className="p-4 border-b border-slate-200 bg-white sticky top-0 z-10">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h2 className="font-bold text-slate-900 text-base">Expedientes REAV</h2>
                <p className="text-xs text-slate-500 mt-0.5">Régimen Agencias de Viaje</p>
              </div>
              <Button
                size="sm"
                onClick={() => setShowCreate(true)}
                className="bg-orange-500 hover:bg-orange-600 text-white shadow-sm"
              >
                <Plus className="w-4 h-4 mr-1" /> Nuevo
              </Button>
            </div>

            {/* Leyenda semáforo */}
            <div className="flex items-center gap-3 text-xs text-slate-500 mb-3 bg-slate-50 rounded-lg p-2">
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse ring-1 ring-red-300 shrink-0" />
                Pendiente
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-amber-400 ring-1 ring-amber-200 shrink-0" />
                En proceso
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 ring-1 ring-emerald-300 shrink-0" />
                Cerrado
              </span>
            </div>

            {/* Filtros */}
            <div className="space-y-2">
              <Select value={filterFiscal} onValueChange={setFilterFiscal}>
                <SelectTrigger className="h-8 text-xs bg-white">
                  <SelectValue placeholder="Estado fiscal..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos los estados fiscales</SelectItem>
                  {Object.entries(FISCAL_STATUS_LABELS).map(([v, l]) => (
                    <SelectItem key={v} value={v}>{l}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={filterOperative} onValueChange={setFilterOperative}>
                <SelectTrigger className="h-8 text-xs bg-white">
                  <SelectValue placeholder="Estado operativo..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos los estados operativos</SelectItem>
                  <SelectItem value="abierto">Abierto</SelectItem>
                  <SelectItem value="en_proceso">En Proceso</SelectItem>
                  <SelectItem value="cerrado">Cerrado</SelectItem>
                  <SelectItem value="anulado">Anulado</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Lista de expedientes */}
          <div className="flex-1 overflow-y-auto">
            {!expedients?.length ? (
              <div className="p-8 text-center text-slate-400">
                <FolderOpen className="w-10 h-10 mx-auto mb-2 opacity-40" />
                <p className="text-sm font-medium">No hay expedientes</p>
                <p className="text-xs mt-1">Crea el primero con el botón "Nuevo"</p>
              </div>
            ) : (
              expedients.map((exp) => (
                <button
                  key={exp.id}
                  onClick={() => setSelectedId(exp.id)}
                  className={`w-full text-left p-3.5 border-b border-slate-100 hover:bg-orange-50/50 transition-colors ${
                    selectedId === exp.id
                      ? "bg-orange-50 border-l-[3px] border-l-orange-500"
                      : "border-l-[3px] border-l-transparent"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-start gap-2 min-w-0">
                      <TrafficLightDot fiscalStatus={exp.fiscalStatus} operativeStatus={exp.operativeStatus} />
                      <div className="min-w-0">
                        <p className="font-mono text-xs text-slate-400 mb-0.5">{exp.expedientNumber}</p>
                        <p className="text-sm font-semibold text-slate-800 truncate leading-tight">
                          {exp.serviceDescription || "Sin descripción"}
                        </p>
                        <p className="text-xs text-slate-500 mt-0.5">
                          {exp.destination || "—"} · {exp.numberOfPax} pax
                        </p>
                      </div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-slate-300 shrink-0 mt-1" />
                  </div>
                  <div className="flex items-center justify-between mt-2">
                    <span className="text-sm font-bold text-slate-900">
                      {parseFloat(exp.saleAmountTotal as string ?? "0").toFixed(2)}€
                    </span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${FISCAL_STATUS_COLORS[exp.fiscalStatus as FiscalStatus]}`}>
                      {FISCAL_STATUS_LABELS[exp.fiscalStatus as FiscalStatus]}
                    </span>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        {/* ── Panel derecho: detalle del expediente ── */}
        <div className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden">
          {!selected ? (
            <div className="flex items-center justify-center h-full min-h-[400px]">
              <div className="text-center text-slate-400 p-8">
                <div className="w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center mx-auto mb-4">
                  <FileText className="w-8 h-8 opacity-40" />
                </div>
                <p className="text-base font-semibold text-slate-600">Selecciona un expediente</p>
                <p className="text-sm mt-1 text-slate-400">o crea uno nuevo desde el panel izquierdo</p>
              </div>
            </div>
          ) : (
            <ExpedientDetail
              exp={selected}
              onUpdate={(data) => updateMut.mutate({ id: selected.id, ...data })}
              onRecalc={() => recalcMut.mutate({ id: selected.id })}
              onAddDoc={(data) => addDocMut.mutate({ expedientId: selected.id, ...data })}
              onDelDoc={(id) => delDocMut.mutate({ id })}
              onAddCost={(data) => addCostMut.mutate({ expedientId: selected.id, ...data })}
              onDelCost={(id) => delCostMut.mutate({ id })}
              onExportZip={() => exportZipMut.mutate({ id: selected.id })}
              exportZipPending={exportZipMut.isPending}
              onExportExcel={() => handleExportExcel(selected)}
            />
          )}
        </div>
      </div>

      {/* ── Modal crear expediente ── */}
      <CreateExpedientModal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onCreate={(data) => createMut.mutate(data)}
        loading={createMut.isPending}
      />
    </AdminLayout>
  );
}

// ─── Detalle del expediente ───────────────────────────────────────────────────

function ExpedientDetail({
  exp, onUpdate, onRecalc, onAddDoc, onDelDoc, onAddCost, onDelCost, onExportZip, exportZipPending, onExportExcel,
}: {
  exp: any;
  onUpdate: (data: any) => void;
  onRecalc: () => void;
  onAddDoc: (data: any) => void;
  onDelDoc: (id: number) => void;
  onAddCost: (data: any) => void;
  onDelCost: (id: number) => void;
  onExportZip: () => void;
  exportZipPending: boolean;
  onExportExcel: () => void;
}) {
  const [editInfo, setEditInfo] = useState(false);
  const [infoForm, setInfoForm] = useState({
    serviceDescription: exp.serviceDescription ?? "",
    serviceDate: exp.serviceDate ?? "",
    serviceEndDate: exp.serviceEndDate ?? "",
    destination: exp.destination ?? "",
    numberOfPax: exp.numberOfPax ?? 1,
    saleAmountTotal: exp.saleAmountTotal ?? "0",
    providerCostEstimated: exp.providerCostEstimated ?? "0",
    agencyMarginEstimated: exp.agencyMarginEstimated ?? "0",
    internalNotes: exp.internalNotes ?? "",
  });

  const [newDoc, setNewDoc] = useState({ side: "client" as "client" | "provider", docType: "factura_emitida", title: "", fileUrl: "", notes: "" });
  const [newCost, setNewCost] = useState({ description: "", providerName: "", amount: "", category: "otros", isPaid: false, includesVat: true, notes: "" });

  const sale = parseFloat(exp.saleAmountTotal ?? "0");
  const costReal = parseFloat(exp.providerCostReal ?? "0");
  const marginReal = parseFloat(exp.agencyMarginReal ?? "0");
  const taxBase = parseFloat(exp.reavTaxBase ?? "0");
  const taxAmount = parseFloat(exp.reavTaxAmount ?? "0");
  const costEst = parseFloat(exp.providerCostEstimated ?? "0");
  const marginEst = parseFloat(exp.agencyMarginEstimated ?? "0");

  const clientDocs = exp.documents?.filter((d: any) => d.side === "client") ?? [];
  const providerDocs = exp.documents?.filter((d: any) => d.side === "provider") ?? [];

  return (
    <div className="p-6 space-y-5 max-w-4xl mx-auto w-full">

      {/* ── Header del expediente ── */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-mono text-xs text-slate-400 mb-1">{exp.expedientNumber}</p>
            <h1 className="text-xl font-bold text-slate-900 leading-tight">
              {exp.serviceDescription || "Expediente REAV"}
            </h1>
            <p className="text-sm text-slate-500 mt-1">
              {exp.destination || "Sin destino"} · {exp.numberOfPax} pax
              {exp.serviceDate ? ` · ${exp.serviceDate}` : ""}
            </p>
            {/* Canal de origen */}
            {exp.channel && (
              <div className="flex items-center gap-1.5 mt-2">
                {exp.channel === "tpv" && (
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded-full">
                    <Store className="w-3 h-3" /> TPV Presencial
                  </span>
                )}
                {exp.channel === "online" && (
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
                    <Monitor className="w-3 h-3" /> Venta Online
                  </span>
                )}
                {exp.channel === "crm" && (
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-purple-700 bg-purple-50 border border-purple-200 px-2 py-0.5 rounded-full">
                    <ShoppingCart className="w-3 h-3" /> CRM / Delegada
                  </span>
                )}
                {exp.sourceRef && (
                  <span className="text-xs text-slate-400">Ref: {exp.sourceRef}</span>
                )}
              </div>
            )}
          </div>
          <div className="flex flex-wrap gap-2 shrink-0">
            <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${FISCAL_STATUS_COLORS[exp.fiscalStatus as FiscalStatus]}`}>
              {FISCAL_STATUS_LABELS[exp.fiscalStatus as FiscalStatus]}
            </span>
            <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${OPERATIVE_STATUS_COLORS[exp.operativeStatus as OperativeStatus]}`}>
              {exp.operativeStatus}
            </span>
          </div>
        </div>
      </div>

      {/* ── BLOQUE 0: Datos del Cliente ── */}
      {(exp.clientName || exp.clientEmail || exp.clientPhone || exp.clientDni || exp.clientAddress) && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
          <h3 className="font-semibold text-slate-800 flex items-center gap-2 mb-4 text-sm uppercase tracking-wide text-slate-500">
            <User className="w-4 h-4 text-orange-500" /> Datos del Cliente
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {exp.clientName && (
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center shrink-0">
                  <User className="w-4 h-4 text-slate-400" />
                </div>
                <div>
                  <p className="text-xs text-slate-500">Nombre</p>
                  <p className="text-sm font-semibold text-slate-800">{exp.clientName}</p>
                </div>
              </div>
            )}
            {exp.clientEmail && (
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center shrink-0">
                  <Mail className="w-4 h-4 text-slate-400" />
                </div>
                <div>
                  <p className="text-xs text-slate-500">Email</p>
                  <a href={`mailto:${exp.clientEmail}`} className="text-sm font-semibold text-blue-600 hover:underline">
                    {exp.clientEmail}
                  </a>
                </div>
              </div>
            )}
            {exp.clientPhone && (
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center shrink-0">
                  <Phone className="w-4 h-4 text-slate-400" />
                </div>
                <div>
                  <p className="text-xs text-slate-500">Teléfono</p>
                  <a href={`tel:${exp.clientPhone}`} className="text-sm font-semibold text-slate-800 hover:underline">
                    {exp.clientPhone}
                  </a>
                </div>
              </div>
            )}
            {exp.clientDni && (
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center shrink-0">
                  <CreditCard className="w-4 h-4 text-slate-400" />
                </div>
                <div>
                  <p className="text-xs text-slate-500">DNI / NIF</p>
                  <p className="text-sm font-semibold text-slate-800">{exp.clientDni}</p>
                </div>
              </div>
            )}
            {exp.clientAddress && (
              <div className="flex items-center gap-3 sm:col-span-2">
                <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center shrink-0">
                  <MapPin className="w-4 h-4 text-slate-400" />
                </div>
                <div>
                  <p className="text-xs text-slate-500">Dirección</p>
                  <p className="text-sm font-semibold text-slate-800">{exp.clientAddress}</p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── BLOQUE 1: Información General ── */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-xs uppercase tracking-wide text-slate-500 flex items-center gap-2">
            <Package className="w-4 h-4 text-orange-500" /> Información General
          </h3>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setEditInfo(!editInfo)}
            className="text-xs h-7"
          >
            {editInfo ? "Cancelar" : "Editar"}
          </Button>
        </div>

        {editInfo ? (
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="sm:col-span-2">
                <label className="text-xs font-medium text-slate-600 mb-1 block">Descripción del servicio</label>
                <Textarea
                  value={infoForm.serviceDescription}
                  onChange={(e) => setInfoForm(f => ({ ...f, serviceDescription: e.target.value }))}
                  rows={2}
                  className="text-sm"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600 mb-1 block">Destino</label>
                <Input
                  value={infoForm.destination}
                  onChange={(e) => setInfoForm(f => ({ ...f, destination: e.target.value }))}
                  className="text-sm"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600 mb-1 block">Nº de pax</label>
                <Input
                  type="number"
                  value={infoForm.numberOfPax}
                  onChange={(e) => setInfoForm(f => ({ ...f, numberOfPax: parseInt(e.target.value) || 1 }))}
                  className="text-sm"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600 mb-1 block">Fecha inicio</label>
                <Input
                  type="date"
                  value={infoForm.serviceDate}
                  onChange={(e) => setInfoForm(f => ({ ...f, serviceDate: e.target.value }))}
                  className="text-sm"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600 mb-1 block">Fecha fin</label>
                <Input
                  type="date"
                  value={infoForm.serviceEndDate}
                  onChange={(e) => setInfoForm(f => ({ ...f, serviceEndDate: e.target.value }))}
                  className="text-sm"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600 mb-1 block">Importe venta total (€)</label>
                <Input
                  type="number"
                  step="0.01"
                  value={infoForm.saleAmountTotal}
                  onChange={(e) => setInfoForm(f => ({ ...f, saleAmountTotal: e.target.value }))}
                  className="text-sm"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600 mb-1 block">Coste proveedor estimado (€)</label>
                <Input
                  type="number"
                  step="0.01"
                  value={infoForm.providerCostEstimated}
                  onChange={(e) => setInfoForm(f => ({ ...f, providerCostEstimated: e.target.value }))}
                  className="text-sm"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600 mb-1 block">Margen agencia estimado (€)</label>
                <Input
                  type="number"
                  step="0.01"
                  value={infoForm.agencyMarginEstimated}
                  onChange={(e) => setInfoForm(f => ({ ...f, agencyMarginEstimated: e.target.value }))}
                  className="text-sm"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="text-xs font-medium text-slate-600 mb-1 block">Notas internas</label>
                <Textarea
                  value={infoForm.internalNotes}
                  onChange={(e) => setInfoForm(f => ({ ...f, internalNotes: e.target.value }))}
                  rows={2}
                  className="text-sm"
                />
              </div>
            </div>
            <div className="flex gap-2 pt-1">
              <Button
                size="sm"
                className="bg-orange-500 hover:bg-orange-600 text-white"
                onClick={() => { onUpdate(infoForm); setEditInfo(false); }}
              >
                Guardar cambios
              </Button>
              <Button variant="outline" size="sm" onClick={() => setEditInfo(false)}>
                Cancelar
              </Button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-4">
            <InfoRow label="Descripción" value={exp.serviceDescription || "—"} />
            <InfoRow label="Destino" value={exp.destination || "—"} />
            <InfoRow label="Nº Pax" value={String(exp.numberOfPax ?? 1)} />
            <InfoRow label="Fecha inicio" value={exp.serviceDate || "—"} />
            <InfoRow label="Fecha fin" value={exp.serviceEndDate || "—"} />
            <InfoRow label="Importe venta" value={`${sale.toFixed(2)}€`} />
            <InfoRow label="Coste est." value={`${costEst.toFixed(2)}€`} />
            <InfoRow label="Margen est." value={`${marginEst.toFixed(2)}€`} />
            {exp.internalNotes && (
              <div className="col-span-2 sm:col-span-3">
                <InfoRow label="Notas internas" value={exp.internalNotes} />
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── BLOQUE 2: Documentos Cliente ── */}
      <DocBlock
        title="Documentos Cliente"
        docs={clientDocs}
        side="client"
        docTypes={DOC_TYPES_CLIENT}
        newDoc={newDoc.side === "client" ? newDoc : { side: "client", docType: "factura_emitida", title: "", fileUrl: "", notes: "" }}
        onNewDocChange={(d) => setNewDoc({ ...d, side: "client" })}
        onAdd={() => {
          if (!newDoc.title) return toast.error("Añade un título al documento");
          onAddDoc({ ...newDoc, side: "client" });
          setNewDoc({ side: "client", docType: "factura_emitida", title: "", fileUrl: "", notes: "" });
        }}
        onDelete={onDelDoc}
      />

      {/* ── BLOQUE 3: Documentos Proveedor ── */}
      <DocBlock
        title="Documentos Proveedor"
        docs={providerDocs}
        side="provider"
        docTypes={DOC_TYPES_PROVIDER}
        newDoc={newDoc.side === "provider" ? newDoc : { side: "provider", docType: "factura_recibida", title: "", fileUrl: "", notes: "" }}
        onNewDocChange={(d) => setNewDoc({ ...d, side: "provider" })}
        onAdd={() => {
          if (!newDoc.title) return toast.error("Añade un título al documento");
          onAddDoc({ ...newDoc, side: "provider" });
          setNewDoc({ side: "provider", docType: "factura_recibida", title: "", fileUrl: "", notes: "" });
        }}
        onDelete={onDelDoc}
      />

      {/* ── BLOQUE 4: Panel Económico ── */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-xs uppercase tracking-wide text-slate-500 flex items-center gap-2">
            <Euro className="w-4 h-4 text-orange-500" /> Panel Económico Interno
          </h3>
          <Button
            variant="outline"
            size="sm"
            onClick={onRecalc}
            className="gap-1.5 text-xs h-7"
          >
            <RefreshCw className="w-3 h-3" /> Recalcular
          </Button>
        </div>

        {/* KPIs económicos */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          <EconCard label="Venta Total" value={`${sale.toFixed(2)}€`} color="text-slate-900" bg="bg-slate-50" />
          <EconCard label="Costes Reales" value={`${costReal.toFixed(2)}€`} color="text-red-600" bg="bg-red-50" />
          <EconCard
            label="Margen Real"
            value={`${marginReal.toFixed(2)}€`}
            color={marginReal >= 0 ? "text-green-700" : "text-red-600"}
            bg={marginReal >= 0 ? "bg-green-50" : "bg-red-50"}
          />
          <EconCard label="Base Imponible REAV" value={`${taxBase.toFixed(2)}€`} color="text-blue-700" bg="bg-blue-50" />
        </div>

        {/* IVA destacado */}
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-5 flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-blue-600 uppercase tracking-wide mb-1">IVA sobre margen (21%)</p>
            <p className="text-2xl font-black text-blue-800">{taxAmount.toFixed(2)}€</p>
          </div>
          <div className="w-12 h-12 rounded-xl bg-blue-100 flex items-center justify-center">
            <Receipt className="w-6 h-6 text-blue-500" />
          </div>
        </div>

        {/* Añadir coste */}
        <div className="border-t border-slate-100 pt-4">
          <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-3">Añadir coste de proveedor</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-2">
            <Input
              placeholder="Descripción *"
              value={newCost.description}
              onChange={(e) => setNewCost(c => ({ ...c, description: e.target.value }))}
              className="text-sm"
            />
            <Input
              placeholder="Proveedor"
              value={newCost.providerName}
              onChange={(e) => setNewCost(c => ({ ...c, providerName: e.target.value }))}
              className="text-sm"
            />
            <Input
              type="number"
              step="0.01"
              placeholder="Importe (€) *"
              value={newCost.amount}
              onChange={(e) => setNewCost(c => ({ ...c, amount: e.target.value }))}
              className="text-sm"
            />
          </div>
          <div className="flex flex-wrap gap-2 items-center">
            <Select value={newCost.category} onValueChange={(v) => setNewCost(c => ({ ...c, category: v }))}>
              <SelectTrigger className="h-9 w-44 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {COST_CATEGORIES.map(cat => (
                  <SelectItem key={cat.value} value={cat.value}>{cat.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <label className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={newCost.includesVat}
                onChange={(e) => setNewCost(c => ({ ...c, includesVat: e.target.checked }))}
                className="accent-orange-500"
              />
              IVA incluido
            </label>
            <Button
              size="sm"
              className="bg-orange-500 hover:bg-orange-600 text-white"
              onClick={() => {
                if (!newCost.description || !newCost.amount) return toast.error("Descripción e importe son obligatorios");
                onAddCost(newCost);
                setNewCost({ description: "", providerName: "", amount: "", category: "otros", isPaid: false, includesVat: true, notes: "" });
              }}
            >
              <Plus className="w-4 h-4 mr-1" /> Añadir
            </Button>
          </div>
        </div>

        {/* Lista de costes */}
        {exp.costs?.length > 0 && (
          <div className="mt-4 space-y-2">
            {exp.costs.map((cost: any) => (
              <div key={cost.id} className="flex items-center justify-between bg-slate-50 rounded-lg px-4 py-2.5 border border-slate-100">
                <div className="flex items-center gap-3 min-w-0">
                  <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${cost.isPaid ? "bg-green-500" : "bg-yellow-400"}`} />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-800 truncate">{cost.description}</p>
                    <p className="text-xs text-slate-500">
                      {cost.providerName || "—"} · {COST_CATEGORIES.find(c => c.value === cost.category)?.label}
                      {cost.includesVat === false && <span className="ml-1 text-amber-600 font-medium">(neto s/IVA)</span>}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0 ml-3">
                  <span className="text-sm font-bold text-slate-900">{parseFloat(cost.amount).toFixed(2)}€</span>
                  <button
                    onClick={() => onDelCost(cost.id)}
                    className="text-slate-300 hover:text-red-500 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── BLOQUE 5: Estado Fiscal ── */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
        <h3 className="font-semibold text-xs uppercase tracking-wide text-slate-500 flex items-center gap-2 mb-4">
          <CheckCircle2 className="w-4 h-4 text-orange-500" /> Estado Fiscal
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
          <div>
            <label className="text-xs font-medium text-slate-600 mb-1.5 block">Estado Fiscal</label>
            <Select value={exp.fiscalStatus} onValueChange={(v) => onUpdate({ fiscalStatus: v })}>
              <SelectTrigger className="text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(FISCAL_STATUS_LABELS).map(([v, l]) => (
                  <SelectItem key={v} value={v}>{l}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs font-medium text-slate-600 mb-1.5 block">Estado Operativo</label>
            <Select value={exp.operativeStatus} onValueChange={(v) => onUpdate({ operativeStatus: v })}>
              <SelectTrigger className="text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="abierto">Abierto</SelectItem>
                <SelectItem value="en_proceso">En Proceso</SelectItem>
                <SelectItem value="cerrado">Cerrado</SelectItem>
                <SelectItem value="anulado">Anulado</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        {/* Resumen fiscal informativo */}
        <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 text-sm text-slate-700 space-y-1.5">
          <p className="font-semibold text-slate-800 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-blue-500" /> Resumen fiscal REAV
          </p>
          <p className="text-xs text-slate-600">Régimen: Agencias de Viaje (REAV) — IVA sobre margen de beneficio</p>
          <div className="grid grid-cols-2 gap-2 mt-2">
            <div className="bg-white rounded-lg p-2.5 border border-blue-100">
              <p className="text-xs text-slate-500">Base imponible</p>
              <p className="text-base font-bold text-slate-900">{taxBase.toFixed(2)}€</p>
              <p className="text-xs text-slate-400">Margen real positivo</p>
            </div>
            <div className="bg-white rounded-lg p-2.5 border border-blue-100">
              <p className="text-xs text-slate-500">IVA 21% a ingresar</p>
              <p className="text-base font-bold text-blue-700">{taxAmount.toFixed(2)}€</p>
              <p className="text-xs text-slate-400">No deducible en REAV</p>
            </div>
          </div>
        </div>
      </div>

      {/* ── BLOQUE 6: Acciones Administrativas ── */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
        <h3 className="font-semibold text-xs uppercase tracking-wide text-slate-500 flex items-center gap-2 mb-4">
          <Lock className="w-4 h-4 text-orange-500" /> Acciones Administrativas
        </h3>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            className="text-sm"
            disabled={exportZipPending}
            onClick={onExportZip}
          >
            <FolderOpen className="w-4 h-4 mr-1.5" />
            {exportZipPending ? "Generando..." : "Exportar ZIP"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="text-sm"
            onClick={onExportExcel}
          >
            <TrendingUp className="w-4 h-4 mr-1.5" /> Exportar Excel
          </Button>
          {exp.invoiceId && (
            <Button
              variant="outline"
              size="sm"
              className="text-sm"
              onClick={() => window.open(`/admin/contabilidad/facturas/${exp.invoiceId}`, "_blank")}
            >
              <Receipt className="w-4 h-4 mr-1.5" /> Ver Factura
            </Button>
          )}
          {exp.reservationId && (
            <Button
              variant="outline"
              size="sm"
              className="text-sm"
              onClick={() => window.open(`/admin/reservas/${exp.reservationId}`, "_blank")}
            >
              <Building2 className="w-4 h-4 mr-1.5" /> Ver Reserva
            </Button>
          )}
          {exp.operativeStatus !== "cerrado" && (
            <Button
              variant="outline"
              size="sm"
              className="text-sm border-red-200 text-red-600 hover:bg-red-50"
              onClick={() => {
                if (confirm("¿Cerrar expediente? Esta acción marcará el expediente como cerrado fiscal y operativamente.")) {
                  onUpdate({ operativeStatus: "cerrado", fiscalStatus: "cerrado" });
                }
              }}
            >
              <Lock className="w-4 h-4 mr-1.5" /> Cerrar Expediente
            </Button>
          )}
        </div>
      </div>

      {/* Espaciado inferior */}
      <div className="h-6" />
    </div>
  );
}

// ─── Sub-componentes ──────────────────────────────────────────────────────────

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-slate-500 mb-0.5">{label}</p>
      <p className="text-sm font-semibold text-slate-800">{value}</p>
    </div>
  );
}

function EconCard({ label, value, color, bg }: { label: string; value: string; color: string; bg: string }) {
  return (
    <div className={`${bg} rounded-xl p-3 text-center border border-slate-100`}>
      <p className="text-xs text-slate-500 mb-1 leading-tight">{label}</p>
      <p className={`text-lg font-black ${color}`}>{value}</p>
    </div>
  );
}

function DocBlock({
  title, docs, side, docTypes, newDoc, onNewDocChange, onAdd, onDelete,
}: {
  title: string;
  docs: any[];
  side: "client" | "provider";
  docTypes: { value: string; label: string }[];
  newDoc: any;
  onNewDocChange: (d: any) => void;
  onAdd: () => void;
  onDelete: (id: number) => void;
}) {
  const icon = side === "client"
    ? <User className="w-4 h-4 text-orange-500" />
    : <Building2 className="w-4 h-4 text-orange-500" />;

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
      <h3 className="font-semibold text-xs uppercase tracking-wide text-slate-500 flex items-center gap-2 mb-4">
        {icon} {title}
      </h3>

      {docs.length === 0 ? (
        <div className="text-center py-4 text-slate-400">
          <FileText className="w-8 h-8 mx-auto mb-1.5 opacity-30" />
          <p className="text-xs">Sin documentos</p>
        </div>
      ) : (
        <div className="space-y-2 mb-4">
          {docs.map((doc: any) => (
            <div
              key={doc.id}
              className="flex items-start justify-between bg-slate-50 rounded-lg px-4 py-2.5 border border-slate-100"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-sm font-semibold text-slate-800">{doc.title}</p>
                  {doc.notes?.includes("automáticamente") && (
                    <span className="text-xs bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded font-medium">Auto</span>
                  )}
                </div>
                <p className="text-xs text-slate-500 mt-0.5">
                  {docTypes.find(d => d.value === doc.docType)?.label ?? doc.docType}
                </p>
                {doc.notes && (
                  <p className="text-xs text-slate-400 mt-0.5 truncate" title={doc.notes}>{doc.notes}</p>
                )}
              </div>
              <div className="flex items-center gap-2 ml-3 shrink-0">
                {doc.fileUrl && (
                  <a
                    href={doc.fileUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-blue-600 hover:text-blue-800 underline"
                  >
                    Ver
                  </a>
                )}
                <button
                  onClick={() => onDelete(doc.id)}
                  className="text-slate-300 hover:text-red-500 transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Añadir documento */}
      <div className="border-t border-slate-100 pt-3 mt-2">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Añadir documento</p>
        <div className="flex flex-wrap gap-2">
          <Select value={newDoc.docType} onValueChange={(v) => onNewDocChange({ ...newDoc, docType: v })}>
            <SelectTrigger className="h-9 w-44 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {docTypes.map(dt => (
                <SelectItem key={dt.value} value={dt.value}>{dt.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            placeholder="Título *"
            value={newDoc.title}
            onChange={(e) => onNewDocChange({ ...newDoc, title: e.target.value })}
            className="flex-1 min-w-[140px] text-sm h-9"
          />
          <Input
            placeholder="URL del archivo"
            value={newDoc.fileUrl}
            onChange={(e) => onNewDocChange({ ...newDoc, fileUrl: e.target.value })}
            className="flex-1 min-w-[140px] text-sm h-9"
          />
          <Button
            size="sm"
            className="bg-orange-500 hover:bg-orange-600 text-white shrink-0 h-9"
            onClick={onAdd}
          >
            <Plus className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Modal crear expediente ───────────────────────────────────────────────────

function CreateExpedientModal({
  open, onClose, onCreate, loading,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (data: any) => void;
  loading: boolean;
}) {
  const [form, setForm] = useState({
    serviceDescription: "",
    serviceDate: "",
    destination: "",
    numberOfPax: 1,
    saleAmountTotal: "",
    providerCostEstimated: "",
    internalNotes: "",
  });

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-base font-bold text-slate-900">Nuevo Expediente REAV</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 pt-1">
          <div>
            <label className="text-xs font-medium text-slate-600 mb-1.5 block">Descripción del servicio *</label>
            <Textarea
              value={form.serviceDescription}
              onChange={(e) => setForm(f => ({ ...f, serviceDescription: e.target.value }))}
              rows={2}
              className="text-sm"
              placeholder="Ej: Viaje de empresa a Los Ángeles de San Rafael..."
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-slate-600 mb-1.5 block">Destino</label>
              <Input
                value={form.destination}
                onChange={(e) => setForm(f => ({ ...f, destination: e.target.value }))}
                className="text-sm"
                placeholder="Ej: Los Ángeles de San Rafael"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600 mb-1.5 block">Fecha servicio</label>
              <Input
                type="date"
                value={form.serviceDate}
                onChange={(e) => setForm(f => ({ ...f, serviceDate: e.target.value }))}
                className="text-sm"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600 mb-1.5 block">Nº Pax</label>
              <Input
                type="number"
                value={form.numberOfPax}
                onChange={(e) => setForm(f => ({ ...f, numberOfPax: parseInt(e.target.value) || 1 }))}
                className="text-sm"
                min={1}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600 mb-1.5 block">Importe venta (€)</label>
              <Input
                type="number"
                step="0.01"
                value={form.saleAmountTotal}
                onChange={(e) => setForm(f => ({ ...f, saleAmountTotal: e.target.value }))}
                className="text-sm"
                placeholder="0.00"
              />
            </div>
            <div className="col-span-2">
              <label className="text-xs font-medium text-slate-600 mb-1.5 block">Coste proveedor estimado (€)</label>
              <Input
                type="number"
                step="0.01"
                value={form.providerCostEstimated}
                onChange={(e) => setForm(f => ({ ...f, providerCostEstimated: e.target.value }))}
                className="text-sm"
                placeholder="0.00"
              />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-slate-600 mb-1.5 block">Notas internas</label>
            <Textarea
              value={form.internalNotes}
              onChange={(e) => setForm(f => ({ ...f, internalNotes: e.target.value }))}
              rows={2}
              className="text-sm"
              placeholder="Observaciones internas..."
            />
          </div>
          <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
            <Button variant="outline" onClick={onClose} className="text-sm">
              Cancelar
            </Button>
            <Button
              className="bg-orange-500 hover:bg-orange-600 text-white text-sm"
              onClick={() => onCreate(form)}
              disabled={loading || !form.serviceDescription}
            >
              {loading ? "Creando..." : "Crear Expediente"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
