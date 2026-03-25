import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  Plus, FileText, Euro, CheckCircle2, AlertCircle, Clock,
  ChevronRight, Trash2, Upload, RefreshCw, X, Building2,
  Receipt, Package, TrendingUp, FolderOpen, Lock,
  User, Mail, Phone, CreditCard, MapPin, Monitor, ShoppingCart, Store
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
  pendiente_documentacion: "bg-yellow-100 text-yellow-800",
  documentacion_completa: "bg-blue-100 text-blue-800",
  en_revision: "bg-purple-100 text-purple-800",
  cerrado: "bg-green-100 text-green-800",
  anulado: "bg-red-100 text-red-800",
};

const OPERATIVE_STATUS_COLORS: Record<OperativeStatus, string> = {
  abierto: "bg-emerald-100 text-emerald-800",
  en_proceso: "bg-orange-100 text-orange-800",
  cerrado: "bg-slate-100 text-slate-700",
  anulado: "bg-red-100 text-red-800",
};

// ─── Semáforo visual ──────────────────────────────────────────────────────────────────────────────────────

type TrafficLight = "red" | "yellow" | "green" | "grey";

function getTrafficLight(fiscalStatus: string, operativeStatus: string): TrafficLight {
  if (operativeStatus === "anulado" || fiscalStatus === "anulado") return "grey";
  if (fiscalStatus === "cerrado" && operativeStatus === "cerrado") return "green";
  if (fiscalStatus === "documentacion_completa" || fiscalStatus === "en_revision") return "yellow";
  if (fiscalStatus === "pendiente_documentacion") return "red";
  return "yellow";
}

const TRAFFIC_LIGHT_CONFIG: Record<TrafficLight, { bg: string; ring: string; label: string; pulse: boolean }> = {
  red:    { bg: "bg-red-500",    ring: "ring-red-300",    label: "Pendiente documentación", pulse: true },
  yellow: { bg: "bg-amber-400",  ring: "ring-amber-200",  label: "En proceso",               pulse: false },
  green:  { bg: "bg-emerald-500",ring: "ring-emerald-300",label: "Cerrado y validado",       pulse: false },
  grey:   { bg: "bg-slate-400",  ring: "ring-slate-200",  label: "Anulado",                  pulse: false },
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

  return (
    <div className="flex h-full min-h-screen bg-slate-50">
      {/* ── Panel izquierdo: lista de expedientes ── */}
      <div className="w-96 border-r border-slate-200 bg-white flex flex-col">
        <div className="p-4 border-b border-slate-200">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-bold text-slate-900 text-lg">Expedientes REAV</h2>
            <Button size="sm" onClick={() => setShowCreate(true)} className="bg-orange-500 hover:bg-orange-600 text-white">
              <Plus className="w-4 h-4 mr-1" /> Nuevo
            </Button>
          </div>
          {/* Leyenda del semáforo */}
          <div className="flex items-center gap-3 text-xs text-slate-500 mb-2">
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse ring-1 ring-red-300" />Pendiente</span>
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-amber-400 ring-1 ring-amber-200" />En proceso</span>
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-emerald-500 ring-1 ring-emerald-300" />Cerrado</span>
          </div>
          <div className="space-y-2">
            <Select value={filterFiscal} onValueChange={setFilterFiscal}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="Estado fiscal..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                {Object.entries(FISCAL_STATUS_LABELS).map(([v, l]) => (
                  <SelectItem key={v} value={v}>{l}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filterOperative} onValueChange={setFilterOperative}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="Estado operativo..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="abierto">Abierto</SelectItem>
                <SelectItem value="en_proceso">En Proceso</SelectItem>
                <SelectItem value="cerrado">Cerrado</SelectItem>
                <SelectItem value="anulado">Anulado</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {!expedients?.length && (
            <div className="p-8 text-center text-slate-400">
              <FolderOpen className="w-10 h-10 mx-auto mb-2 opacity-40" />
              <p className="text-sm">No hay expedientes</p>
            </div>
          )}
          {expedients?.map((exp) => (
            <button
              key={exp.id}
              onClick={() => setSelectedId(exp.id)}
              className={`w-full text-left p-4 border-b border-slate-100 hover:bg-slate-50 transition-colors ${selectedId === exp.id ? "bg-orange-50 border-l-4 border-l-orange-500" : ""}`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-start gap-2 min-w-0">
                  <TrafficLightDot fiscalStatus={exp.fiscalStatus} operativeStatus={exp.operativeStatus} />
                  <div className="min-w-0">
                    <p className="font-mono text-xs text-slate-500 mb-1">{exp.expedientNumber}</p>
                    <p className="text-sm font-medium text-slate-800 truncate">{exp.serviceDescription || "Sin descripción"}</p>
                    <p className="text-xs text-slate-500 mt-1">{exp.destination || "—"} · {exp.numberOfPax} pax</p>
                  </div>
                </div>
                <div className="flex flex-col gap-1 items-end shrink-0">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${FISCAL_STATUS_COLORS[exp.fiscalStatus as FiscalStatus]}`}>
                    {FISCAL_STATUS_LABELS[exp.fiscalStatus as FiscalStatus]}
                  </span>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${OPERATIVE_STATUS_COLORS[exp.operativeStatus as OperativeStatus]}`}>
                    {exp.operativeStatus}
                  </span>
                </div>
              </div>
              <div className="flex items-center justify-between mt-2">
                <span className="text-sm font-bold text-slate-900">{parseFloat(exp.saleAmountTotal as string ?? "0").toFixed(2)}€</span>
                <ChevronRight className="w-4 h-4 text-slate-400" />
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* ── Panel derecho: detalle del expediente ── */}
      <div className="flex-1 overflow-y-auto">
        {!selected ? (
          <div className="flex items-center justify-center h-full text-slate-400">
            <div className="text-center">
              <FileText className="w-16 h-16 mx-auto mb-4 opacity-30" />
              <p className="text-lg font-medium">Selecciona un expediente</p>
              <p className="text-sm mt-1">o crea uno nuevo desde el panel izquierdo</p>
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
          />
        )}
      </div>

      {/* ── Modal crear expediente ── */}
      <CreateExpedientModal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onCreate={(data) => createMut.mutate(data)}
        loading={createMut.isPending}
      />
    </div>
  );
}

// ─── Detalle del expediente ───────────────────────────────────────────────────

function ExpedientDetail({
  exp,
  onUpdate,
  onRecalc,
  onAddDoc,
  onDelDoc,
  onAddCost,
  onDelCost,
}: {
  exp: any;
  onUpdate: (data: any) => void;
  onRecalc: () => void;
  onAddDoc: (data: any) => void;
  onDelDoc: (id: number) => void;
  onAddCost: (data: any) => void;
  onDelCost: (id: number) => void;
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
  const [newCost, setNewCost] = useState({ description: "", providerName: "", amount: "", category: "otros", isPaid: false, notes: "" });

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
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <p className="font-mono text-sm text-slate-500">{exp.expedientNumber}</p>
          <h1 className="text-2xl font-bold text-slate-900 mt-1">{exp.serviceDescription || "Expediente REAV"}</h1>
          <p className="text-slate-500 text-sm mt-1">{exp.destination || "Sin destino"} · {exp.numberOfPax} pax · {exp.serviceDate || "Sin fecha"}</p>
          {/* Canal de origen */}
          {exp.channel && (
            <div className="flex items-center gap-1.5 mt-2">
              {exp.channel === "tpv" && <><Store className="w-3.5 h-3.5 text-blue-500" /><span className="text-xs font-medium text-blue-700 bg-blue-50 px-2 py-0.5 rounded-full">TPV Presencial</span></>}
              {exp.channel === "online" && <><Monitor className="w-3.5 h-3.5 text-emerald-500" /><span className="text-xs font-medium text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full">Venta Online</span></>}
              {exp.channel === "crm" && <><ShoppingCart className="w-3.5 h-3.5 text-purple-500" /><span className="text-xs font-medium text-purple-700 bg-purple-50 px-2 py-0.5 rounded-full">CRM / Delegada</span></>}
              {exp.sourceRef && <span className="text-xs text-slate-400 ml-1">Ref: {exp.sourceRef}</span>}
            </div>
          )}
        </div>
        <div className="flex gap-2">
          <span className={`text-sm px-3 py-1 rounded-full font-medium ${FISCAL_STATUS_COLORS[exp.fiscalStatus as FiscalStatus]}`}>
            {FISCAL_STATUS_LABELS[exp.fiscalStatus as FiscalStatus]}
          </span>
          <span className={`text-sm px-3 py-1 rounded-full font-medium ${OPERATIVE_STATUS_COLORS[exp.operativeStatus as OperativeStatus]}`}>
            {exp.operativeStatus}
          </span>
        </div>
      </div>

      {/* ── BLOQUE 0: Datos del Cliente ── */}
      {(exp.clientName || exp.clientEmail || exp.clientPhone || exp.clientDni || exp.clientAddress) && (
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <h3 className="font-bold text-slate-800 flex items-center gap-2 mb-4">
            <User className="w-5 h-5 text-orange-500" /> Datos del Cliente
          </h3>
          <div className="grid grid-cols-2 gap-4 text-sm">
            {exp.clientName && (
              <div className="flex items-center gap-2">
                <User className="w-4 h-4 text-slate-400 shrink-0" />
                <div>
                  <p className="text-xs text-slate-500">Nombre</p>
                  <p className="font-medium text-slate-800">{exp.clientName}</p>
                </div>
              </div>
            )}
            {exp.clientEmail && (
              <div className="flex items-center gap-2">
                <Mail className="w-4 h-4 text-slate-400 shrink-0" />
                <div>
                  <p className="text-xs text-slate-500">Email</p>
                  <a href={`mailto:${exp.clientEmail}`} className="font-medium text-blue-600 hover:underline">{exp.clientEmail}</a>
                </div>
              </div>
            )}
            {exp.clientPhone && (
              <div className="flex items-center gap-2">
                <Phone className="w-4 h-4 text-slate-400 shrink-0" />
                <div>
                  <p className="text-xs text-slate-500">Teléfono</p>
                  <a href={`tel:${exp.clientPhone}`} className="font-medium text-slate-800 hover:underline">{exp.clientPhone}</a>
                </div>
              </div>
            )}
            {exp.clientDni && (
              <div className="flex items-center gap-2">
                <CreditCard className="w-4 h-4 text-slate-400 shrink-0" />
                <div>
                  <p className="text-xs text-slate-500">DNI / NIF</p>
                  <p className="font-medium text-slate-800">{exp.clientDni}</p>
                </div>
              </div>
            )}
            {exp.clientAddress && (
              <div className="flex items-center gap-2 col-span-2">
                <MapPin className="w-4 h-4 text-slate-400 shrink-0" />
                <div>
                  <p className="text-xs text-slate-500">Dirección</p>
                  <p className="font-medium text-slate-800">{exp.clientAddress}</p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── BLOQUE 1: Información General ── */}
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-slate-800 flex items-center gap-2">
            <Package className="w-5 h-5 text-orange-500" /> Bloque 1 — Información General
          </h3>
          <Button variant="outline" size="sm" onClick={() => setEditInfo(!editInfo)}>
            {editInfo ? "Cancelar" : "Editar"}
          </Button>
        </div>
        {editInfo ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-slate-600 mb-1 block">Descripción del servicio</label>
                <Textarea
                  value={infoForm.serviceDescription}
                  onChange={(e) => setInfoForm(f => ({ ...f, serviceDescription: e.target.value }))}
                  rows={2}
                />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600 mb-1 block">Destino</label>
                <Input value={infoForm.destination} onChange={(e) => setInfoForm(f => ({ ...f, destination: e.target.value }))} />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600 mb-1 block">Fecha inicio</label>
                <Input type="date" value={infoForm.serviceDate} onChange={(e) => setInfoForm(f => ({ ...f, serviceDate: e.target.value }))} />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600 mb-1 block">Fecha fin</label>
                <Input type="date" value={infoForm.serviceEndDate} onChange={(e) => setInfoForm(f => ({ ...f, serviceEndDate: e.target.value }))} />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600 mb-1 block">Nº de pax</label>
                <Input type="number" value={infoForm.numberOfPax} onChange={(e) => setInfoForm(f => ({ ...f, numberOfPax: parseInt(e.target.value) || 1 }))} />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600 mb-1 block">Importe venta total (€)</label>
                <Input type="number" step="0.01" value={infoForm.saleAmountTotal} onChange={(e) => setInfoForm(f => ({ ...f, saleAmountTotal: e.target.value }))} />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600 mb-1 block">Coste proveedor estimado (€)</label>
                <Input type="number" step="0.01" value={infoForm.providerCostEstimated} onChange={(e) => setInfoForm(f => ({ ...f, providerCostEstimated: e.target.value }))} />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600 mb-1 block">Margen agencia estimado (€)</label>
                <Input type="number" step="0.01" value={infoForm.agencyMarginEstimated} onChange={(e) => setInfoForm(f => ({ ...f, agencyMarginEstimated: e.target.value }))} />
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600 mb-1 block">Notas internas</label>
              <Textarea value={infoForm.internalNotes} onChange={(e) => setInfoForm(f => ({ ...f, internalNotes: e.target.value }))} rows={2} />
            </div>
            <div className="flex gap-2">
              <Button size="sm" className="bg-orange-500 hover:bg-orange-600 text-white" onClick={() => { onUpdate(infoForm); setEditInfo(false); }}>
                Guardar
              </Button>
              <Button variant="outline" size="sm" onClick={() => setEditInfo(false)}>Cancelar</Button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-4 text-sm">
            <InfoRow label="Descripción" value={exp.serviceDescription || "—"} />
            <InfoRow label="Destino" value={exp.destination || "—"} />
            <InfoRow label="Nº Pax" value={String(exp.numberOfPax ?? 1)} />
            <InfoRow label="Fecha inicio" value={exp.serviceDate || "—"} />
            <InfoRow label="Fecha fin" value={exp.serviceEndDate || "—"} />
            <InfoRow label="Importe venta" value={`${sale.toFixed(2)}€`} />
            <InfoRow label="Coste est." value={`${costEst.toFixed(2)}€`} />
            <InfoRow label="Margen est." value={`${marginEst.toFixed(2)}€`} />
            <InfoRow label="Notas" value={exp.internalNotes || "—"} />
          </div>
        )}
      </div>

      {/* ── BLOQUE 2: Documentos Cliente ── */}
      <DocBlock
        title="Bloque 2 — Documentos Cliente"
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
        title="Bloque 3 — Documentos Proveedor"
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
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-slate-800 flex items-center gap-2">
            <Euro className="w-5 h-5 text-orange-500" /> Bloque 4 — Panel Económico Interno
          </h3>
          <Button variant="outline" size="sm" onClick={onRecalc} className="gap-1">
            <RefreshCw className="w-3 h-3" /> Recalcular
          </Button>
        </div>

        {/* Resumen económico */}
        <div className="grid grid-cols-4 gap-3 mb-5">
          <EconCard label="Venta Total" value={`${sale.toFixed(2)}€`} color="text-slate-900" />
          <EconCard label="Costes Reales" value={`${costReal.toFixed(2)}€`} color="text-red-600" />
          <EconCard label="Margen Real" value={`${marginReal.toFixed(2)}€`} color={marginReal >= 0 ? "text-green-600" : "text-red-600"} />
          <EconCard label="Base Imponible REAV" value={`${taxBase.toFixed(2)}€`} color="text-blue-600" />
        </div>
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-5 flex items-center justify-between">
          <div>
            <p className="text-xs font-medium text-blue-700">IVA sobre margen (21%)</p>
            <p className="text-xl font-black text-blue-800">{taxAmount.toFixed(2)}€</p>
          </div>
          <Receipt className="w-8 h-8 text-blue-400" />
        </div>

        {/* Añadir coste */}
        <div className="border-t border-slate-100 pt-4">
          <p className="text-sm font-semibold text-slate-700 mb-3">Añadir coste de proveedor</p>
          <div className="grid grid-cols-3 gap-2 mb-2">
            <Input placeholder="Descripción *" value={newCost.description} onChange={(e) => setNewCost(c => ({ ...c, description: e.target.value }))} />
            <Input placeholder="Proveedor" value={newCost.providerName} onChange={(e) => setNewCost(c => ({ ...c, providerName: e.target.value }))} />
            <Input type="number" step="0.01" placeholder="Importe (€) *" value={newCost.amount} onChange={(e) => setNewCost(c => ({ ...c, amount: e.target.value }))} />
          </div>
          <div className="flex gap-2">
            <Select value={newCost.category} onValueChange={(v) => setNewCost(c => ({ ...c, category: v }))}>
              <SelectTrigger className="h-9 w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {COST_CATEGORIES.map(cat => <SelectItem key={cat.value} value={cat.value}>{cat.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button size="sm" className="bg-orange-500 hover:bg-orange-600 text-white" onClick={() => {
              if (!newCost.description || !newCost.amount) return toast.error("Descripción e importe son obligatorios");
              onAddCost(newCost);
              setNewCost({ description: "", providerName: "", amount: "", category: "otros", isPaid: false, notes: "" });
            }}>
              <Plus className="w-4 h-4 mr-1" /> Añadir
            </Button>
          </div>
        </div>

        {/* Lista de costes */}
        {exp.costs?.length > 0 && (
          <div className="mt-4 space-y-2">
            {exp.costs.map((cost: any) => (
              <div key={cost.id} className="flex items-center justify-between bg-slate-50 rounded-lg px-3 py-2 text-sm">
                <div className="flex items-center gap-3">
                  <span className={`w-2 h-2 rounded-full ${cost.isPaid ? "bg-green-500" : "bg-yellow-400"}`} />
                  <div>
                    <p className="font-medium text-slate-800">{cost.description}</p>
                    <p className="text-xs text-slate-500">{cost.providerName || "—"} · {COST_CATEGORIES.find(c => c.value === cost.category)?.label}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-bold text-slate-900">{parseFloat(cost.amount).toFixed(2)}€</span>
                  <button onClick={() => onDelCost(cost.id)} className="text-red-400 hover:text-red-600">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── BLOQUE 5: Estado Fiscal ── */}
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <h3 className="font-bold text-slate-800 flex items-center gap-2 mb-4">
          <CheckCircle2 className="w-5 h-5 text-orange-500" /> Bloque 5 — Estado Fiscal
        </h3>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-xs font-medium text-slate-600 mb-1 block">Estado Fiscal</label>
            <Select value={exp.fiscalStatus} onValueChange={(v) => onUpdate({ fiscalStatus: v })}>
              <SelectTrigger>
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
            <label className="text-xs font-medium text-slate-600 mb-1 block">Estado Operativo</label>
            <Select value={exp.operativeStatus} onValueChange={(v) => onUpdate({ operativeStatus: v })}>
              <SelectTrigger>
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
        <div className="mt-4 p-3 bg-slate-50 rounded-lg text-xs text-slate-600 space-y-1">
          <p className="font-semibold text-slate-700">Resumen fiscal REAV:</p>
          <p>• Régimen: Agencias de Viaje (REAV) — IVA sobre margen de beneficio</p>
          <p>• Base imponible: <strong>{taxBase.toFixed(2)}€</strong> (margen real positivo)</p>
          <p>• IVA 21% a ingresar: <strong>{taxAmount.toFixed(2)}€</strong></p>
          <p>• El IVA de los costes de proveedor <strong>no es deducible</strong> en REAV</p>
        </div>
      </div>

      {/* ── BLOQUE 6: Acciones Administrativas ── */}
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <h3 className="font-bold text-slate-800 flex items-center gap-2 mb-4">
          <Lock className="w-5 h-5 text-orange-500" /> Bloque 6 — Acciones Administrativas
        </h3>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => toast.info("Exportar ZIP — próximamente")}>
            <FolderOpen className="w-4 h-4 mr-1" /> Exportar ZIP
          </Button>
          <Button variant="outline" size="sm" onClick={() => toast.info("Exportar Excel — próximamente")}>
            <TrendingUp className="w-4 h-4 mr-1" /> Exportar Excel
          </Button>
          {exp.invoiceId && (
            <Button variant="outline" size="sm" onClick={() => window.open(`/admin/contabilidad/facturas/${exp.invoiceId}`, "_blank")}>
              <Receipt className="w-4 h-4 mr-1" /> Ver Factura
            </Button>
          )}
          {exp.reservationId && (
            <Button variant="outline" size="sm" onClick={() => window.open(`/admin/reservas/${exp.reservationId}`, "_blank")}>
              <Building2 className="w-4 h-4 mr-1" /> Ver Reserva
            </Button>
          )}
          {exp.operativeStatus !== "cerrado" && (
            <Button
              variant="outline" size="sm"
              className="border-red-200 text-red-600 hover:bg-red-50"
              onClick={() => { if (confirm("¿Cerrar expediente?")) onUpdate({ operativeStatus: "cerrado", fiscalStatus: "cerrado" }); }}
            >
              <Lock className="w-4 h-4 mr-1" /> Cerrar Expediente
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Sub-componentes ──────────────────────────────────────────────────────────

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-slate-500">{label}</p>
      <p className="font-medium text-slate-800">{value}</p>
    </div>
  );
}

function EconCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="bg-slate-50 rounded-lg p-3 text-center">
      <p className="text-xs text-slate-500 mb-1">{label}</p>
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
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5">
      <h3 className="font-bold text-slate-800 flex items-center gap-2 mb-4">
        <FileText className="w-5 h-5 text-orange-500" /> {title}
      </h3>
      {docs.length === 0 && (
        <p className="text-sm text-slate-400 mb-4">Sin documentos</p>
      )}
      {docs.map((doc: any) => (
        <div key={doc.id} className="flex items-start justify-between bg-slate-50 rounded-lg px-3 py-2 text-sm mb-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="font-medium text-slate-800">{doc.title}</p>
              {doc.notes?.includes("automáticamente") && (
                <span className="text-xs bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded font-medium">Auto</span>
              )}
            </div>
            <p className="text-xs text-slate-500">{docTypes.find(d => d.value === doc.docType)?.label ?? doc.docType}</p>
            {doc.notes && <p className="text-xs text-slate-400 mt-0.5 truncate" title={doc.notes}>{doc.notes}</p>}
          </div>
          <div className="flex items-center gap-2 ml-2 shrink-0">
            {doc.fileUrl && (
              <a href={doc.fileUrl} target="_blank" rel="noreferrer" className="text-blue-500 hover:text-blue-700 text-xs underline">Ver</a>
            )}
            <button onClick={() => onDelete(doc.id)} className="text-red-400 hover:text-red-600">
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>
      ))}
      {/* Añadir documento */}
      <div className="border-t border-slate-100 pt-3 mt-3">
        <div className="flex gap-2 mb-2">
          <Select value={newDoc.docType} onValueChange={(v) => onNewDocChange({ ...newDoc, docType: v })}>
            <SelectTrigger className="h-9 w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {docTypes.map(dt => <SelectItem key={dt.value} value={dt.value}>{dt.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Input placeholder="Título *" value={newDoc.title} onChange={(e) => onNewDocChange({ ...newDoc, title: e.target.value })} />
          <Input placeholder="URL del archivo" value={newDoc.fileUrl} onChange={(e) => onNewDocChange({ ...newDoc, fileUrl: e.target.value })} />
          <Button size="sm" className="bg-orange-500 hover:bg-orange-600 text-white shrink-0" onClick={onAdd}>
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
          <DialogTitle>Nuevo Expediente REAV</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-slate-600 mb-1 block">Descripción del servicio *</label>
            <Textarea value={form.serviceDescription} onChange={(e) => setForm(f => ({ ...f, serviceDescription: e.target.value }))} rows={2} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-slate-600 mb-1 block">Destino</label>
              <Input value={form.destination} onChange={(e) => setForm(f => ({ ...f, destination: e.target.value }))} />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600 mb-1 block">Fecha servicio</label>
              <Input type="date" value={form.serviceDate} onChange={(e) => setForm(f => ({ ...f, serviceDate: e.target.value }))} />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600 mb-1 block">Nº Pax</label>
              <Input type="number" value={form.numberOfPax} onChange={(e) => setForm(f => ({ ...f, numberOfPax: parseInt(e.target.value) || 1 }))} />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600 mb-1 block">Importe venta (€)</label>
              <Input type="number" step="0.01" value={form.saleAmountTotal} onChange={(e) => setForm(f => ({ ...f, saleAmountTotal: e.target.value }))} />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600 mb-1 block">Coste proveedor est. (€)</label>
              <Input type="number" step="0.01" value={form.providerCostEstimated} onChange={(e) => setForm(f => ({ ...f, providerCostEstimated: e.target.value }))} />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-slate-600 mb-1 block">Notas internas</label>
            <Textarea value={form.internalNotes} onChange={(e) => setForm(f => ({ ...f, internalNotes: e.target.value }))} rows={2} />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose}>Cancelar</Button>
            <Button
              className="bg-orange-500 hover:bg-orange-600 text-white"
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
