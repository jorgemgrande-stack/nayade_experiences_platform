/**
 * DailyActivities — Actividades del día con estructura 2 niveles
 * Nivel 1: Tarjeta de RESERVA con datos generales + estado operativo
 * Nivel 2: Actividades de la reserva (principal + extras desplegables)
 * Solo reservas confirmadas (status=paid, statusReservation!=ANULADA)
 */
import { useState, type ReactNode } from "react";
import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import AdminLayout from "@/components/AdminLayout";
import { PanelPageHeader } from "@/components/admin/PanelUi";
import {
  Waves, User, Users, Phone, Clock, AlertTriangle, CheckCircle2,
  Calendar, ChevronLeft, ChevronRight, RefreshCw, UserCheck, CalendarDays,
  StickyNote, XCircle, ClipboardList, Hash, ExternalLink,
  CheckCheck, ChevronDown, ChevronUp, Mail,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n/I18nProvider";

type TFn = ReturnType<typeof useI18n>["t"];

function rich(s: string, vals: Record<string, ReactNode>) {
  return s.split(/(\{\w+\})/).map((p, i) => {
    const m = /^\{(\w+)\}$/.exec(p);
    return m && m[1] in vals ? <strong key={i} className="text-foreground">{vals[m[1]]}</strong> : p;
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function addDays(d: Date, n: number) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }
function formatDate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function isWithin2Hours(arrivalTime: string, dateStr: string): boolean {
  const [h, m] = arrivalTime.split(":").map(Number);
  const actTs = new Date(dateStr);
  actTs.setHours(h, m, 0, 0);
  const diff = actTs.getTime() - Date.now();
  return diff > 0 && diff < 2 * 60 * 60 * 1000;
}

// ─── Tipos de estado operativo ─────────────────────────────────────────────────
type OpState = "completa" | "sin_monitor" | "sin_hora" | "incidencia" | "heredado";

function getReservationOpState(res: any): OpState {
  if (res.opStatus === "incidencia") return "incidencia";
  if (!res.monitorId) return "sin_monitor";
  if (!res.arrivalTime) return "sin_hora";
  return "completa";
}

const OP_CONFIG: Record<OpState, { label: string; dot: string; border: string; bg: string }> = {
  completa:    { label: "opsDaily.op.completa",  dot: "bg-success", border: "border-l-emerald-500", bg: "bg-success/10" },
  sin_monitor: { label: "opsDaily.op.sin_monitor",         dot: "bg-danger",     border: "border-l-red-500",     bg: "bg-danger/10" },
  sin_hora:    { label: "opsDaily.op.sin_hora",    dot: "bg-warning",   border: "border-l-amber-500",   bg: "bg-warning/10" },
  incidencia:  { label: "opsDaily.op.incidencia",          dot: "bg-warning",  border: "border-l-orange-500",  bg: "bg-warning/10" },
  heredado:    { label: "opsDaily.op.heredado",     dot: "bg-info",    border: "border-l-blue-500",    bg: "bg-info/10" },
};

type FilterType = "all" | "sin_monitor" | "sin_hora" | "incidencia" | "completa";

// ─── Parsear actividades extras + herencia operativa ──────────────────────────
function parseExtras(extrasJson: any): any[] {
  if (!extrasJson) return [];
  if (Array.isArray(extrasJson)) return extrasJson; // MySQL2 puede devolver JSON ya parseado
  try {
    const parsed = typeof extrasJson === "string" ? JSON.parse(extrasJson) : extrasJson;
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}
function parseActivitiesOp(json: any): Array<{ index: number; lineId?: number; serviceDate?: string | null; monitorId?: number | null; arrivalTime?: string; opNotes?: string; consolidated?: boolean }> {
  if (!json) return [];
  if (Array.isArray(json)) return json; // MySQL2 puede devolver JSON ya parseado
  try { return JSON.parse(json) || []; } catch { return []; }
}
function getActivityOp(index: number, activitiesOpJson: any[], res: any) {
  // Solo overrides de componente de nivel superior (sin lineId).
  const override = activitiesOpJson.find((a: any) => a.index === index && a.lineId == null);
  return {
    monitorId:    override?.monitorId   !== undefined ? override.monitorId   : (res.monitorId   ?? null),
    arrivalTime:  override?.arrivalTime !== undefined ? override.arrivalTime : (res.arrivalTime ?? null),
    opNotes:      override?.opNotes     !== undefined ? override.opNotes     : (res.opNotes     ?? null),
    consolidated: override?.consolidated === true,
    isInherited:  !override,
  };
}

// Op efectiva de una EXPERIENCIA dentro de un Lego Pack: override propio
// (keyado por (parentIndex, lineId)) o, si no, hereda del componente padre.
function getLineOp(parentIndex: number, lineId: number, activitiesOpJson: any[], res: any) {
  const lineOv = activitiesOpJson.find((a: any) => a.index === parentIndex && a.lineId === lineId);
  const parentOp = getActivityOp(parentIndex, activitiesOpJson, res);
  return {
    monitorId:   lineOv?.monitorId   !== undefined ? lineOv.monitorId   : parentOp.monitorId,
    arrivalTime: lineOv?.arrivalTime !== undefined ? lineOv.arrivalTime : parentOp.arrivalTime,
    opNotes:     lineOv?.opNotes     !== undefined ? lineOv.opNotes     : parentOp.opNotes,
    consolidated: lineOv?.consolidated === true,
    isInherited: !lineOv,
  };
}

// ─── Componente de actividad interna (sub-item) ────────────────────────────────
function ActivitySubItem({
  index, title, pax, op, monitors, onEdit, onConsolidate,
}: {
  index: number;
  title: string;
  pax: number | string;
  op: ReturnType<typeof getActivityOp>;
  monitors: any[];
  onEdit: () => void;
  onConsolidate: () => void;
}) {
  const { t } = useI18n();
  const monitorName = op.monitorId ? monitors.find(m => m.id === op.monitorId)?.fullName || t("opsDaily.monitorNum", { id: op.monitorId }) : null;
  return (
    <div className={cn(
      "flex items-start justify-between gap-3 rounded-lg p-3 border",
      op.consolidated
        ? "bg-success/10 border-success/40"
        : "bg-muted/40 border-border/50",
    )}>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-sm font-medium text-foreground/90 truncate">{title}</p>
          <span className="text-[10px] text-muted-foreground">{pax} {t("opsDaily.pax")}</span>
          {op.isInherited && (
            <Badge className="text-[9px] bg-info/10 text-info border-info/30">{t("opsDaily.inherited")}</Badge>
          )}
          {op.consolidated && (
            <Badge className="text-[9px] bg-success/15 text-success border-success/40 flex items-center gap-0.5">
              <CheckCheck className="w-2.5 h-2.5" />{t("opsDaily.consolidated")}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-3 mt-1.5 flex-wrap text-[11px]">
          <span className={cn("flex items-center gap-1", monitorName ? "text-success" : "text-danger")}>
            <User className="w-3 h-3" />
            {monitorName || t("opsDaily.noMonitor")}
          </span>
          <span className={cn("flex items-center gap-1", op.arrivalTime ? "text-info" : "text-warning")}>
            <Clock className="w-3 h-3" />
            {op.arrivalTime || t("opsDaily.noTime")}
          </span>
          {op.opNotes && (
            <span className="flex items-center gap-1 text-muted-foreground italic truncate max-w-xs">
              <StickyNote className="w-3 h-3 shrink-0" />
              {op.opNotes}
            </span>
          )}
        </div>
      </div>
      <div className="shrink-0 flex flex-col gap-1">
        <Button size="sm" variant="outline" onClick={onConsolidate}
          className={cn("text-[10px] h-7 px-2 gap-1", op.consolidated
            ? "border-border text-muted-foreground hover:bg-muted"
            : "border-success/50 text-success hover:bg-success/10")}>
          <CheckCheck className="w-3 h-3" />
          {op.consolidated ? t("opsDaily.unmark") : t("opsDaily.consolidate")}
        </Button>
        <Button size="sm" variant="outline" onClick={onEdit}
          className="border-border text-muted-foreground hover:bg-muted text-[10px] h-7 px-2 gap-1">
          <ClipboardList className="w-3 h-3" /> {t("opsDaily.editBtn")}
        </Button>
      </div>
    </div>
  );
}

// ─── Resumen operativo del día (agregado por actividad) ──────────────────────
// Devuelve los ítems operativos (experiencias) de UNA reserva para el día dado,
// con su nº real de personas. Para packs: cada experiencia de hoy con packQty ×
// defaultQuantity. Para no-packs: el propio componente con su pax.
type DayItem = { title: string; pax: number; optional: boolean };
function reservationDayItems(res: any, dateStr: string, t: TFn): DayItem[] {
  const extras = parseExtras(res.extrasJson);
  const activitiesOpJson = parseActivitiesOp(res.activitiesOpJson);
  const compDates: Array<{ index: number; date: string }> = res.componentDates || [];
  const hasCompDates = compDates.length > 0;
  const effDate = (index: number) => compDates.find(c => c.index === index)?.date ?? res.scheduledDate;
  const lineEffDate = (parentIndex: number, lineId: number) => {
    const ov = activitiesOpJson.find((a: any) => a.index === parentIndex && a.lineId === lineId);
    return ov?.serviceDate || effDate(parentIndex);
  };
  const packLinesOf = (index: number): any[] => res.packExpansions?.[index] || [];
  const out: DayItem[] = [];
  const consider = (index: number, title: string, fallbackPax: number, packQty: number) => {
    const lines = packLinesOf(index);
    if (lines.length) {
      for (const l of lines) {
        if (!hasCompDates || lineEffDate(index, l.lineId) === dateStr) {
          out.push({ title: l.title, pax: (packQty || 1) * (l.quantity || 1), optional: !!l.isOptional });
        }
      }
    } else if (!hasCompDates || effDate(index) === dateStr) {
      out.push({ title, pax: fallbackPax, optional: false });
    }
  };
  consider(0, res.activityTitle || t("opsDaily.activityFallback"), res.numberOfPersons || 1, 1);
  extras.forEach((ex: any, i: number) =>
    consider(i + 1, ex.experienceTitle || ex.name || t("opsDaily.activityN", { n: i + 2 }),
      ex.participants || ex.pax || ex.quantity || res.numberOfPersons || 1, ex.quantity ?? 1));
  return out;
}

// Agrega por nombre de actividad las personas de TODAS las reservas del día.
function computeDaySummary(reservations: any[], dateStr: string, t: TFn): Array<{ title: string; pax: number; anyOptional: boolean }> {
  const agg = new Map<string, { title: string; pax: number; anyOptional: boolean }>();
  for (const res of reservations) {
    for (const it of reservationDayItems(res, dateStr, t)) {
      const cur = agg.get(it.title) || { title: it.title, pax: 0, anyOptional: false };
      cur.pax += it.pax;
      if (it.optional) cur.anyOptional = true;
      agg.set(it.title, cur);
    }
  }
  return Array.from(agg.values()).sort((a, b) => b.pax - a.pax);
}

// ─── Despliegue de experiencias de un Lego Pack ──────────────────────────────
// Cada experiencia muestra su monitor/hora (propios o heredados del componente)
// y permite editar su operativa (override por lineId).
type PackLine = { lineId: number; title: string; quantity: number; groupLabel: string | null; isOptional: boolean };
function PackExpansion({ lines, parentIndex, packQty, activitiesOpJson, res, monitors, onEditLine, onConsolidateLine }: {
  lines?: PackLine[];
  parentIndex: number;
  /** Unidades compradas del pack (cantidad de la línea de presupuesto). El nº real de
   *  personas por experiencia = packQty × defaultQuantity de la línea. */
  packQty: number;
  activitiesOpJson: any[];
  res: any;
  monitors: any[];
  onEditLine: (line: PackLine, op: ReturnType<typeof getLineOp>) => void;
  onConsolidateLine: (line: PackLine, op: ReturnType<typeof getLineOp>) => void;
}) {
  const { t } = useI18n();
  if (!lines || lines.length === 0) return null;
  return (
    <div className="ml-6 pl-3 border-l-2 border-info/40 space-y-1.5 py-1">
      <p className="text-[9px] text-info/80 uppercase tracking-wide font-semibold">{t("opsDaily.packExperiences")}</p>
      {lines.map((line) => {
        const op = getLineOp(parentIndex, line.lineId, activitiesOpJson, res);
        const monitorName = op.monitorId ? (monitors.find(m => m.id === op.monitorId)?.fullName || t("opsDaily.monitorNum", { id: op.monitorId })) : null;
        const ownDate = activitiesOpJson.find((a: any) => a.index === parentIndex && a.lineId === line.lineId)?.serviceDate;
        return (
          <div key={line.lineId} className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2 flex-wrap min-w-0">
              <span className="w-1.5 h-1.5 rounded-full bg-info shrink-0" />
              <span className="text-sm text-foreground/85 truncate">{line.title}</span>
              <span className="text-[11px] font-semibold text-info shrink-0">
                {(packQty || 1) * (line.quantity || 1)} {t("opsDaily.pax")}
              </span>
              {line.isOptional && (
                <Badge className="text-[9px] bg-warning/10 text-warning border-warning/30">{t("opsDaily.optional")}</Badge>
              )}
              {ownDate && (
                <Badge className="text-[9px] bg-primary/10 text-primary border-primary/30 flex items-center gap-0.5">
                  <CalendarDays className="w-2.5 h-2.5" />{ownDate}
                </Badge>
              )}
              <span className={cn("flex items-center gap-0.5 text-[10px]", monitorName ? "text-success" : "text-danger")}>
                <User className="w-2.5 h-2.5" />{monitorName || t("opsDaily.noMonitor")}
              </span>
              <span className={cn("flex items-center gap-0.5 text-[10px]", op.arrivalTime ? "text-info" : "text-warning")}>
                <Clock className="w-2.5 h-2.5" />{op.arrivalTime || t("opsDaily.noTime")}
              </span>
              {op.isInherited && (
                <Badge className="text-[9px] bg-info/10 text-info border-info/30">{t("opsDaily.inherited")}</Badge>
              )}
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <Button size="sm" variant="outline" onClick={() => onConsolidateLine(line, op)}
                className={cn("text-[9px] h-6 px-1.5 gap-1", op.consolidated
                  ? "border-border text-muted-foreground hover:bg-muted"
                  : "border-success/50 text-success hover:bg-success/10")}>
                <CheckCheck className="w-2.5 h-2.5" />{op.consolidated ? t("opsDaily.unmark") : t("opsDaily.consolidate")}
              </Button>
              <Button size="sm" variant="outline" onClick={() => onEditLine(line, op)}
                className="border-border text-muted-foreground hover:bg-muted text-[9px] h-6 px-1.5 gap-1">
                <ClipboardList className="w-2.5 h-2.5" />{t("opsDaily.editBtn")}
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function DailyActivities() {
  const { t, format: f } = useI18n();
  const [currentDate, setCurrentDate] = useState(() => {
    const stored = sessionStorage.getItem("activitiesDate");
    if (stored) {
      sessionStorage.removeItem("activitiesDate");
      const [y, m, d] = stored.split("-").map(Number);
      return new Date(y, m - 1, d);
    }
    return new Date();
  });

  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const [editTarget, setEditTarget] = useState<{ reservationId: number; activityIndex: number; lineId?: number; title: string; current: ReturnType<typeof getActivityOp> } | null>(null);
  const [editMonitorId, setEditMonitorId] = useState<string>("");
  const [editArrivalTime, setEditArrivalTime] = useState<string>("");
  const [editOpNotes, setEditOpNotes] = useState<string>("");
  const [editServiceDate, setEditServiceDate] = useState<string>("");
  const [cancelTarget, setCancelTarget] = useState<{ id: number; title: string } | null>(null);
  const [confirmArrivalTarget, setConfirmArrivalTarget] = useState<{ reservationId: number; time: string } | null>(null);
  const [consolidateTarget, setConsolidateTarget] = useState<{ reservationId: number; activityIndex: number; lineId?: number; lineIds?: number[]; title: string; currentValue: boolean } | null>(null);
  const [opFilter, setOpFilter] = useState<FilterType>("all");

  const dateStr = formatDate(currentDate);

  const { data, isLoading, refetch } = trpc.operations.activities.getForDate.useQuery(
    { date: dateStr },
    { refetchOnWindowFocus: false }
  );
  const { data: monitorsData } = trpc.operations.monitors.list.useQuery(
    { isActive: true },
    { refetchOnWindowFocus: false }
  );

  const utils = trpc.useUtils();
  const invalidate = () => utils.operations.activities.getForDate.invalidate();

  const updateDetailsMutation = trpc.operations.activities.updateDetails.useMutation({
    onSuccess: () => { invalidate(); toast.success(t("opsDaily.toast.saved")); setEditTarget(null); },
    onError: () => toast.error(t("opsDaily.toast.saveError")),
  });

  const updateActivityOpMutation = trpc.operations.activities.updateActivityOp.useMutation({
    onSuccess: () => { invalidate(); toast.success(t("opsDaily.toast.activityUpdated")); setEditTarget(null); },
    onError: () => toast.error(t("opsDaily.toast.activitySaveError")),
  });

  // Mutation silenciosa para consolidar/desmarcar varias experiencias de un pack en lote.
  const quietOpMut = trpc.operations.activities.updateActivityOp.useMutation();
  async function consolidateAllLines(reservationId: number, activityIndex: number, lineIds: number[], value: boolean) {
    for (const lineId of lineIds) {
      await quietOpMut.mutateAsync({ reservationId, activityIndex, lineId, consolidated: value });
    }
    invalidate();
    toast.success(value ? t("opsDaily.toast.linesConsolidated") : t("opsDaily.toast.linesUnmarked"));
  }

  const confirmArrivalMutation = trpc.operations.activities.confirmArrival.useMutation({
    onSuccess: () => { invalidate(); toast.success(t("opsDaily.toast.arrivalConfirmed")); },
    onError: () => toast.error(t("opsDaily.toast.arrivalError")),
  });

  const cancelActivityMutation = trpc.operations.activities.cancelActivity.useMutation({
    onSuccess: () => { invalidate(); setCancelTarget(null); toast.success(t("opsDaily.toast.cancelled")); },
    onError: () => toast.error(t("opsDaily.toast.cancelError")),
  });

  const reservations = (data as any[]) || [];
  const monitors = (monitorsData as any[]) || [];

  // Filtros operativos
  const filtered = reservations.filter(res => {
    const state = getReservationOpState(res);
    if (opFilter === "all") return true;
    if (opFilter === "sin_monitor") return state === "sin_monitor";
    if (opFilter === "sin_hora") return state === "sin_hora";
    if (opFilter === "incidencia") return state === "incidencia";
    if (opFilter === "completa") return state === "completa";
    return true;
  });

  // KPIs
  const sinMonitor = reservations.filter(r => !r.monitorId).length;
  const sinHora = reservations.filter(r => !r.arrivalTime).length;
  const confirmados = reservations.filter(r => r.clientConfirmed).length;
  const incidencias = reservations.filter(r => r.opStatus === "incidencia").length;

  function toggleExpand(id: number) {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function openEditReservation(res: any) {
    const op = { monitorId: res.monitorId ?? null, arrivalTime: res.arrivalTime ?? null, opNotes: res.opNotes ?? null, consolidated: false, isInherited: false };
    setEditTarget({ reservationId: res.id, activityIndex: -1, title: `${res.clientName} — ${res.activityTitle}`, current: op });
    setEditMonitorId(res.monitorId ? String(res.monitorId) : "none");
    setEditArrivalTime(res.arrivalTime || "");
    setEditOpNotes(res.opNotes || "");
    setEditServiceDate("");
  }

  function openEditActivity(res: any, index: number, title: string) {
    const activitiesOpJson = parseActivitiesOp(res.activitiesOpJson);
    const op = getActivityOp(index, activitiesOpJson, res);
    setEditTarget({ reservationId: res.id, activityIndex: index, title, current: op });
    setEditMonitorId(op.monitorId ? String(op.monitorId) : "none");
    setEditArrivalTime(op.arrivalTime || "");
    setEditOpNotes(op.opNotes || "");
    // Fecha efectiva actual del componente (override admin → semilla → madre)
    const eff = (res.componentDates || []).find((c: any) => c.index === index)?.date || res.scheduledDate || "";
    setEditServiceDate(eff);
  }

  // Editar la operativa (monitor/hora/notas/fecha) de una EXPERIENCIA dentro de un Lego Pack.
  function openEditPackLine(res: any, parentIndex: number, line: PackLine, op: ReturnType<typeof getLineOp>) {
    setEditTarget({ reservationId: res.id, activityIndex: parentIndex, lineId: line.lineId, title: line.title, current: op });
    setEditMonitorId(op.monitorId ? String(op.monitorId) : "none");
    setEditArrivalTime(op.arrivalTime || "");
    setEditOpNotes(op.opNotes || "");
    // Fecha efectiva de la experiencia: override propio o, si no, la del componente padre.
    const aoj = parseActivitiesOp(res.activitiesOpJson);
    const ov = aoj.find((a: any) => a.index === parentIndex && a.lineId === line.lineId);
    const compDate = (res.componentDates || []).find((c: any) => c.index === parentIndex)?.date || res.scheduledDate || "";
    setEditServiceDate(ov?.serviceDate || compDate);
  }

  async function handleSave() {
    if (!editTarget) return;
    const monitorId = editMonitorId && editMonitorId !== "none" ? parseInt(editMonitorId) : null;

    if (editTarget.activityIndex === -1) {
      // Guardar en nivel reserva (datos generales)
      await updateDetailsMutation.mutateAsync({
        reservationId: editTarget.reservationId,
        monitorId,
        arrivalTime: editArrivalTime || undefined,
        opNotes: editOpNotes || undefined,
      });
    } else {
      // Guardar override de actividad específica (o de una experiencia del pack si hay lineId).
      // Para experiencias del pack NO se toca la fecha (queda a nivel de componente).
      await updateActivityOpMutation.mutateAsync({
        reservationId: editTarget.reservationId,
        activityIndex: editTarget.activityIndex,
        lineId: editTarget.lineId,
        monitorId,
        arrivalTime: editArrivalTime || undefined,
        opNotes: editOpNotes || undefined,
        serviceDate: editServiceDate || null,
      });
    }
  }

  const FILTER_OPTIONS: { value: FilterType; label: string }[] = [
    { value: "all",         label: t("opsDaily.filter.all") },
    { value: "completa",    label: t("opsDaily.filter.completa") },
    { value: "sin_monitor", label: t("opsDaily.noMonitor") },
    { value: "sin_hora",    label: t("opsDaily.filter.sin_hora") },
    { value: "incidencia",  label: t("opsDaily.filter.incidencia") },
  ];

  // Resumen operativo del día: personas por actividad agregadas entre todas las reservas filtradas.
  const daySummary = computeDaySummary(filtered, dateStr, t);

  return (
    <AdminLayout title={t("opsDaily.pageTitle")}>
      <div className="min-h-screen bg-background text-foreground p-6 -m-6">

        {/* Header */}
        <PanelPageHeader
          className="mb-5"
          icon={<Waves />}
          title={t("opsDaily.heading")}
          description={t("opsDaily.subtitle")}
          actions={
            <Button variant="outline" size="icon" onClick={() => refetch()} aria-label={t("panelStates.retry")}>
              <RefreshCw className="w-4 h-4" />
            </Button>
          }
        />

        {/* Navegación de fecha */}
        <div className="flex items-center gap-3 mb-5 flex-wrap">
          <Button variant="outline" size="icon" onClick={() => setCurrentDate(d => addDays(d, -1))}
            className="border-border text-foreground/80 hover:bg-muted w-8 h-8">
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={() => setCurrentDate(new Date())}
            className="border-border text-foreground/80 hover:bg-muted text-xs">
            {t("opsDaily.today")}
          </Button>
          <Button variant="outline" size="icon" onClick={() => setCurrentDate(d => addDays(d, 1))}
            className="border-border text-foreground/80 hover:bg-muted w-8 h-8">
            <ChevronRight className="w-4 h-4" />
          </Button>
          <div className="flex items-center gap-2 border border-border rounded-md px-3 h-8 bg-transparent hover:bg-muted transition-colors">
            <CalendarDays className="w-4 h-4 text-info shrink-0" />
            <input type="date" value={dateStr}
              onChange={(e) => { if (e.target.value) { const [y, m, d] = e.target.value.split("-").map(Number); setCurrentDate(new Date(y, m - 1, d)); } }}
              className="bg-transparent text-foreground/80 text-sm border-none outline-none cursor-pointer [color-scheme:dark]" />
          </div>
          <h2 className="text-base font-semibold text-foreground capitalize">
            {f.date(currentDate, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
          </h2>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
          {[
            { label: t("opsDaily.kpi.reservations"), value: reservations.length, color: "text-foreground", bg: "bg-muted" },
            { label: t("opsDaily.noMonitor"), value: sinMonitor, color: sinMonitor > 0 ? "text-danger" : "text-success", bg: sinMonitor > 0 ? "bg-danger/10" : "bg-muted" },
            { label: t("opsDaily.op.sin_hora"), value: sinHora, color: sinHora > 0 ? "text-warning" : "text-success", bg: sinHora > 0 ? "bg-warning/10" : "bg-muted" },
            { label: t("opsDaily.arrivalConfirmed"), value: confirmados, color: "text-success", bg: "bg-success/10" },
          ].map(k => (
            <div key={k.label} className={`${k.bg} rounded-xl border border-border p-4`}>
              <div className={`text-3xl font-bold ${k.color}`}>{k.value}</div>
              <div className="text-muted-foreground text-sm mt-1">{k.label}</div>
            </div>
          ))}
        </div>

        {/* Filtros operativos */}
        <div className="flex items-center gap-2 mb-5 flex-wrap">
          {FILTER_OPTIONS.map(opt => (
            <button key={opt.value}
              onClick={() => setOpFilter(opt.value)}
              className={cn(
                "px-3 py-1.5 rounded-full text-xs font-medium border transition-colors",
                opFilter === opt.value
                  ? "bg-primary border-info text-primary-foreground"
                  : "bg-transparent border-border text-muted-foreground hover:border-foreground/30 hover:text-foreground/80"
              )}>
              {opt.label}
              {opt.value !== "all" && (
                <span className="ml-1.5 opacity-60">
                  ({opt.value === "sin_monitor" ? sinMonitor
                    : opt.value === "sin_hora" ? sinHora
                    : opt.value === "incidencia" ? incidencias
                    : reservations.length - sinMonitor - sinHora - incidencias})
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Resumen operativo del día: personas por actividad (agregado entre reservas) */}
        {!isLoading && daySummary.length > 0 && (
          <div className="mb-4 bg-card border border-info/40 rounded-xl p-4">
            <p className="text-[11px] text-info uppercase tracking-wide font-semibold mb-2 flex items-center gap-1.5">
              <Users className="w-3.5 h-3.5" />{t("opsDaily.summary")}
            </p>
            <div className="flex flex-wrap gap-2">
              {daySummary.map((a) => (
                <div key={a.title} className="flex items-center gap-2 bg-muted/60 border border-border rounded-lg px-3 py-1.5">
                  <span className="text-sm text-foreground/90">{a.title}</span>
                  <span className="text-sm font-bold text-info">{a.pax}</span>
                  {a.anyOptional && <span className="text-[9px] text-warning" title={t("opsDaily.includesOptionalTitle")}>{t("opsDaily.includesOptional")}</span>}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Lista de reservas */}
        {isLoading ? (
          <div className="flex items-center justify-center h-48 text-muted-foreground">
            <RefreshCw className="w-5 h-5 animate-spin mr-2" />{t("opsDaily.loading")}
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20 text-muted-foreground">
            <Calendar className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p>{reservations.length === 0 ? t("opsDaily.emptyDay") : t("opsDaily.emptyFilter")}</p>
          </div>
        ) : (
          <div className="space-y-4">
            {filtered.map((res: any) => {
              const extras = parseExtras(res.extrasJson);
              const activitiesOpJson = parseActivitiesOp(res.activitiesOpJson);
              const opState = getReservationOpState(res);
              const cfg = OP_CONFIG[opState];
              const isExpanded = expandedIds.has(res.id);
              const isSoon = res.arrivalTime && isWithin2Hours(res.arrivalTime, dateStr);

              // Fechas efectivas por componente (Parche A) y por experiencia de Lego
              // Pack (Fase C). En esta vista de un solo día se muestran solo los
              // componentes/experiencias cuya fecha efectiva es hoy.
              // Índices: principal = 0, extra `i` = i+1.
              const compDates: Array<{ index: number; date: string }> = res.componentDates || [];
              const hasCompDates = compDates.length > 0;
              const effDate = (index: number) =>
                compDates.find(c => c.index === index)?.date ?? res.scheduledDate;
              const packLinesOf = (index: number): any[] => res.packExpansions?.[index] || [];
              // Fecha efectiva de una experiencia de pack: su override propio o, si no, la del componente.
              const lineEffDate = (parentIndex: number, lineId: number) => {
                const ov = activitiesOpJson.find((a: any) => a.index === parentIndex && a.lineId === lineId);
                return ov?.serviceDate || effDate(parentIndex);
              };
              const linesTodayFor = (index: number): any[] => {
                const lines = packLinesOf(index);
                if (!hasCompDates) return lines;
                return lines.filter((l: any) => lineEffDate(index, l.lineId) === dateStr);
              };
              // Un componente se muestra hoy si: (pack) tiene alguna experiencia hoy, o
              // (no-pack) su fecha efectiva es hoy.
              const componentShowsToday = (index: number) => {
                if (!hasCompDates) return true;
                if (packLinesOf(index).length) return linesTodayFor(index).length > 0;
                return effDate(index) === dateStr;
              };

              const shownComponents = [
                ...(componentShowsToday(0)
                  ? [{ index: 0, title: res.activityTitle || t("opsDaily.mainActivity"), pax: res.numberOfPersons }]
                  : []),
                ...extras
                  .map((ex: any, i: number) => ({
                    index: i + 1,
                    title: ex.experienceTitle || ex.name || t("opsDaily.activityN", { n: i + 2 }),
                    pax: ex.participants || ex.pax || res.numberOfPersons,
                  }))
                  .filter((c: any) => componentShowsToday(c.index)),
              ];
              const totalActivities = shownComponents.length;
              const isMadreToday = !hasCompDates || res.scheduledDate === dateStr;

              // Consolidación granular: un componente-pack se consolida POR EXPERIENCIA;
              // un componente no-pack, como un todo.
              const isPackComp = (index: number) => linesTodayFor(index).length > 0;
              const packAllConsolidated = (index: number) => {
                const ls = linesTodayFor(index);
                return ls.length > 0 && ls.every((l: any) => getLineOp(index, l.lineId, activitiesOpJson, res).consolidated);
              };
              const compOp = (index: number) => isPackComp(index)
                ? { ...getActivityOp(index, activitiesOpJson, res), consolidated: packAllConsolidated(index) }
                : getActivityOp(index, activitiesOpJson, res);
              const consolidateComp = (index: number, title: string) => {
                if (isPackComp(index)) {
                  setConsolidateTarget({ reservationId: res.id, activityIndex: index, lineIds: linesTodayFor(index).map((l: any) => l.lineId), title, currentValue: packAllConsolidated(index) });
                } else {
                  setConsolidateTarget({ reservationId: res.id, activityIndex: index, title, currentValue: getActivityOp(index, activitiesOpJson, res).consolidated });
                }
              };
              const consolidateLine = (parentIndex: number, line: any, op: any) =>
                setConsolidateTarget({ reservationId: res.id, activityIndex: parentIndex, lineId: line.lineId, title: line.title, currentValue: op.consolidated });

              // Contador por UNIDADES (experiencias para packs, componente para no-packs).
              const consolidableStates = shownComponents.flatMap((c) => {
                const ls = linesTodayFor(c.index);
                return ls.length
                  ? ls.map((l: any) => getLineOp(c.index, l.lineId, activitiesOpJson, res).consolidated)
                  : [getActivityOp(c.index, activitiesOpJson, res).consolidated];
              });
              const totalUnits = consolidableStates.length;
              const consolidatedUnits = consolidableStates.filter(Boolean).length;

              return (
                <div key={res.id} className={cn(
                  "bg-card border border-border rounded-xl overflow-hidden border-l-4",
                  cfg.border.replace("border-l-", "border-l-4 border-"),
                )}>
                  {/* ── NIVEL 1: Cabecera de reserva ── */}
                  <div className="p-5">
                    <div className="flex items-start justify-between gap-4">
                      {/* Info principal */}
                      <div className="flex items-start gap-4 flex-1 min-w-0">
                        <div className={cn("w-11 h-11 rounded-full flex items-center justify-center shrink-0",
                          res.clientConfirmed ? "bg-success/20" : "bg-info/20")}>
                          {res.clientConfirmed
                            ? <CheckCheck className="w-5 h-5 text-success" />
                            : <Waves className="w-5 h-5 text-info" />}
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h3 className="font-semibold text-foreground text-base">{res.clientName}</h3>
                            {res.reservationNumber && (
                              <span className="text-[10px] font-mono text-info/80 bg-info/10 border border-info/20 rounded px-1.5 py-0.5">
                                {res.reservationNumber}
                              </span>
                            )}
                            {!isMadreToday && (
                              <span className="text-[10px] text-primary bg-primary/10 border border-primary/30 rounded px-1.5 py-0.5 flex items-center gap-1">
                                <CalendarDays className="w-2.5 h-2.5" />{t("opsDaily.reservationOf", { date: res.scheduledDate })}
                              </span>
                            )}
                            <span className={cn("flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border", cfg.bg, cfg.dot.replace("bg-", "border-").replace("400", "500/40"))}>
                              <span className={cn("w-1.5 h-1.5 rounded-full", cfg.dot)} />
                              {t(cfg.label)}
                            </span>
                            {isSoon && !res.clientConfirmed && (
                              <Badge className="bg-danger/20 text-danger border-danger text-[10px] animate-pulse">{t("opsDaily.imminent")}</Badge>
                            )}
                          </div>

                          {/* Contacto */}
                          <div className="flex items-center gap-3 mt-1.5 flex-wrap text-xs text-muted-foreground">
                            {res.clientPhone && (
                              <a href={`tel:${res.clientPhone}`} className="flex items-center gap-1 text-info hover:text-info">
                                <Phone className="w-3 h-3" />{res.clientPhone}
                              </a>
                            )}
                            {res.clientEmail && (
                              <span className="flex items-center gap-1 truncate max-w-xs">
                                <Mail className="w-3 h-3" />{res.clientEmail}
                              </span>
                            )}
                            <span className="flex items-center gap-1">
                              <Users className="w-3 h-3" />{res.numberOfPersons} {t("opsDaily.pax")}
                            </span>
                            <span className="flex items-center gap-1">
                              <Waves className="w-3 h-3" />{t("opsDaily.activitiesCount", { n: totalActivities })}
                            </span>
                          </div>

                          {/* Datos operativos generales */}
                          <div className="flex items-center gap-2 mt-2 flex-wrap">
                            <span className={cn("flex items-center gap-1 text-xs px-2 py-0.5 rounded border",
                              res.monitorName ? "text-success bg-success/10 border-success/20" : "text-danger bg-danger/10 border-danger/20")}>
                              <UserCheck className="w-3 h-3" />
                              {res.monitorName || t("opsDaily.noMonitor")}
                            </span>
                            <span className={cn("flex items-center gap-1 text-xs px-2 py-0.5 rounded border",
                              res.arrivalTime ? "text-info bg-info/10 border-info/20" : "text-warning bg-warning/10 border-warning/20")}>
                              <Clock className="w-3 h-3" />
                              {res.arrivalTime || t("opsDaily.filter.sin_hora")}
                            </span>
                            {res.clientConfirmed ? (
                              <span className="flex items-center gap-1 text-xs text-success bg-success/10 border border-success/20 rounded px-2 py-0.5">
                                <CheckCircle2 className="w-3 h-3" />{t("opsDaily.arrivalConfirmed")}
                              </span>
                            ) : (
                              <span className="flex items-center gap-1 text-xs text-warning bg-warning/10 border border-warning/20 rounded px-2 py-0.5">
                                <AlertTriangle className="w-3 h-3" />{t("opsDaily.unconfirmed")}
                              </span>
                            )}
                            <span className={cn("flex items-center gap-1 text-xs px-2 py-0.5 rounded border",
                              totalUnits > 0 && consolidatedUnits === totalUnits
                                ? "text-success bg-success/10 border-success/20"
                                : consolidatedUnits > 0
                                  ? "text-warning bg-warning/10 border-warning/20"
                                  : "text-muted-foreground bg-muted/60 border-border")}>
                              <CheckCheck className="w-3 h-3" />
                              {t("opsDaily.consolidatedCount", { done: consolidatedUnits, total: totalUnits })}
                            </span>
                            {res.merchantOrder && (
                              <span className="flex items-center gap-1 text-[10px] text-muted-foreground font-mono">
                                <Hash className="w-3 h-3" />{res.merchantOrder}
                              </span>
                            )}
                          </div>

                          {res.opNotes && (
                            <p className="text-xs text-muted-foreground italic mt-1.5 flex items-center gap-1">
                              <StickyNote className="w-3 h-3 shrink-0" />"{res.opNotes}"
                            </p>
                          )}
                        </div>
                      </div>

                      {/* Acciones lado derecho */}
                      <div className="shrink-0 flex flex-col gap-1.5 items-end">
                        {!res.clientConfirmed && (
                          <Button size="sm"
                            onClick={() => setConfirmArrivalTarget({
                              reservationId: res.id,
                              time: new Date().toTimeString().slice(0, 5),
                            })}
                            disabled={confirmArrivalMutation.isPending}
                            className="bg-success/80 hover:bg-success/90 text-primary-foreground text-xs gap-1 h-7">
                            <CheckCircle2 className="w-3.5 h-3.5" />{t("opsDaily.confirmArrival")}
                          </Button>
                        )}
                        <Button size="sm" variant="outline"
                          onClick={() => openEditReservation(res)}
                          className="border-border text-foreground/80 hover:bg-muted text-xs gap-1 h-7">
                          <ClipboardList className="w-3.5 h-3.5" />{t("opsDaily.editGeneral")}
                        </Button>
                        <Link href={`/admin/crm?tab=reservas&id=${res.id}`}>
                          <span className="flex items-center gap-1 text-xs text-primary hover:text-primary bg-primary/10 border border-primary/20 rounded px-2 py-1 cursor-pointer transition-colors">
                            <ExternalLink className="w-3 h-3" />{t("opsDaily.viewCrm")}
                          </span>
                        </Link>
                        <Button size="sm" variant="outline"
                          onClick={() => setCancelTarget({ id: res.id, title: res.activityTitle || t("opsDaily.activityFallback") })}
                          className="border-danger/40 text-danger hover:bg-danger/10 text-xs gap-1 h-7">
                          <XCircle className="w-3.5 h-3.5" />{t("opsDaily.cancel")}
                        </Button>
                      </div>
                    </div>

                    {/* Botón desplegar actividades — solo si hay extras */}
                    {totalActivities > 1 && (
                      <button onClick={() => toggleExpand(res.id)}
                        className="mt-3 w-full flex items-center justify-center gap-1.5 text-xs text-muted-foreground hover:text-foreground border border-border rounded-lg py-1.5 hover:bg-muted transition-colors">
                        {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                        {isExpanded ? t("opsDaily.hideN", { n: totalActivities }) : t("opsDaily.showN", { n: totalActivities })}
                      </button>
                    )}
                  </div>

                  {/* ── NIVEL 2: Actividades de la reserva que ocurren HOY (desplegable) ── */}
                  {isExpanded && totalActivities > 1 && (
                    <div className="px-5 pb-5 space-y-2 border-t border-border pt-4">
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-semibold mb-3">
                                        {t("opsDaily.todayActivities")}
                      </p>
                      {shownComponents.map((c) => (
                        <div key={c.index} className="space-y-1.5">
                          <ActivitySubItem
                            index={c.index}
                            title={c.title}
                            pax={c.pax}
                            op={compOp(c.index)}
                            monitors={monitors}
                            onEdit={() => openEditActivity(res, c.index, c.title)}
                            onConsolidate={() => consolidateComp(c.index, c.title)}
                          />
                          <PackExpansion
                            lines={linesTodayFor(c.index)}
                            parentIndex={c.index}
                            packQty={c.index === 0 ? 1 : (extras[c.index - 1]?.quantity ?? 1)}
                            activitiesOpJson={activitiesOpJson}
                            res={res}
                            monitors={monitors}
                            onEditLine={(line, op) => openEditPackLine(res, c.index, line, op)}
                            onConsolidateLine={(line, op) => consolidateLine(c.index, line, op)}
                          />
                        </div>
                      ))}
                    </div>
                  )}
                  {/* Si solo hay 1 actividad hoy, mostrar siempre */}
                  {totalActivities === 1 && (
                    <div className="px-5 pb-5 border-t border-border pt-4 space-y-1.5">
                      <ActivitySubItem
                        index={shownComponents[0].index}
                        title={shownComponents[0].title}
                        pax={shownComponents[0].pax}
                        op={compOp(shownComponents[0].index)}
                        monitors={monitors}
                        onEdit={() => openEditActivity(res, shownComponents[0].index, shownComponents[0].title)}
                        onConsolidate={() => consolidateComp(shownComponents[0].index, shownComponents[0].title)}
                      />
                      <PackExpansion
                        lines={linesTodayFor(shownComponents[0].index)}
                        parentIndex={shownComponents[0].index}
                        packQty={shownComponents[0].index === 0 ? 1 : (extras[shownComponents[0].index - 1]?.quantity ?? 1)}
                        activitiesOpJson={activitiesOpJson}
                        res={res}
                        monitors={monitors}
                        onEditLine={(line, op) => openEditPackLine(res, shownComponents[0].index, line, op)}
                        onConsolidateLine={(line, op) => consolidateLine(shownComponents[0].index, line, op)}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Modal de edición operativa (reserva general o actividad específica) */}
      <Dialog open={!!editTarget} onOpenChange={() => setEditTarget(null)}>
        <DialogContent className="bg-card border-border text-foreground max-w-md">
          <DialogHeader>
            <DialogTitle className="text-foreground">
              {editTarget?.activityIndex === -1 ? t("opsDaily.edit.titleGeneral") : editTarget?.lineId != null ? t("opsDaily.edit.titleLine") : t("opsDaily.edit.titleActivity")}
            </DialogTitle>
          </DialogHeader>
          {editTarget && (
            <div className="space-y-4 mt-2">
              <div className="bg-muted rounded-lg p-3">
                <p className="font-semibold text-foreground text-sm">{editTarget.title}</p>
                {editTarget.activityIndex === -1 && (
                  <p className="text-xs text-muted-foreground mt-1">{t("opsDaily.edit.inheritNote")}</p>
                )}
                {editTarget.activityIndex >= 0 && editTarget.current.isInherited && (
                  <p className="text-xs text-info mt-1 flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" />
                    {t("opsDaily.edit.inheritingNote")}
                  </p>
                )}
              </div>

              {editTarget.activityIndex >= 0 && (
                <div>
                  <label className="text-sm text-muted-foreground mb-2 flex items-center gap-1">
                    <CalendarDays className="w-3.5 h-3.5 text-primary" />{t("opsDaily.edit.serviceDate")}
                  </label>
                  <Input type="date" value={editServiceDate} onChange={(e) => setEditServiceDate(e.target.value)}
                    className="bg-muted border-border text-foreground [color-scheme:dark]" />
                  <p className="text-[11px] text-muted-foreground mt-1">
                    {t("opsDaily.edit.serviceDateHelp")}
                  </p>
                </div>
              )}

              <div>
                <label className="text-sm text-muted-foreground mb-2 block">{t("opsDaily.edit.assignedMonitor")}</label>
                <Select value={editMonitorId} onValueChange={setEditMonitorId}>
                  <SelectTrigger className="bg-muted border-border text-foreground">
                    <SelectValue placeholder={t("opsDaily.edit.selectMonitor")} />
                  </SelectTrigger>
                  <SelectContent className="bg-muted border-border">
                    <SelectItem value="none" className="text-muted-foreground">{t("opsDaily.noMonitor")}</SelectItem>
                    {monitors.map((m: any) => (
                      <SelectItem key={m.id} value={String(m.id)} className="text-foreground">{m.fullName}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label className="text-sm text-muted-foreground mb-2 flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5 text-info" />{t("opsDaily.edit.clientArrival")}
                </label>
                <Input type="time" value={editArrivalTime} onChange={(e) => setEditArrivalTime(e.target.value)}
                  className="bg-muted border-border text-foreground [color-scheme:dark]" />
              </div>

              <div>
                <label className="text-sm text-muted-foreground mb-2 flex items-center gap-1">
                  <StickyNote className="w-3.5 h-3.5 text-warning" />{t("opsDaily.edit.opNotes")}
                </label>
                <Textarea value={editOpNotes} onChange={(e) => setEditOpNotes(e.target.value)}
                  placeholder={t("opsDaily.edit.notesPlaceholder")} rows={3}
                  className="bg-muted border-border text-foreground resize-none" />
              </div>

              <div className="flex gap-2 justify-end">
                <Button variant="outline" onClick={() => setEditTarget(null)} className="border-border text-foreground/80">{t("opsDaily.dialogCancel")}</Button>
                <Button
                  disabled={updateDetailsMutation.isPending || updateActivityOpMutation.isPending}
                  onClick={handleSave}
                  className="bg-primary hover:bg-primary/90 text-primary-foreground">
                  {updateDetailsMutation.isPending || updateActivityOpMutation.isPending ? t("opsDaily.saving") : t("opsDaily.save")}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Modal confirmación anulación */}
      <AlertDialog open={!!cancelTarget} onOpenChange={() => setCancelTarget(null)}>
        <AlertDialogContent className="bg-card border-border text-foreground">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-foreground">{t("opsDaily.cancelDialog.title")}</AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground">
              {rich(t("opsDaily.cancelDialog.text", { title: "{title}" }), { title: cancelTarget?.title })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-border text-foreground/80 hover:bg-muted">{t("opsDaily.dialogCancel")}</AlertDialogCancel>
            <AlertDialogAction className="bg-danger hover:bg-danger/90 text-primary-foreground"
              onClick={() => cancelTarget && cancelActivityMutation.mutate({ reservationId: cancelTarget.id })}>
              {t("opsDaily.cancelDialog.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Modal consolidar / desmarcar actividad ───────────────────────── */}
      <Dialog open={!!consolidateTarget} onOpenChange={() => setConsolidateTarget(null)}>
        <DialogContent className="bg-card border-border text-foreground max-w-xs">
          <DialogHeader>
            <DialogTitle className="text-foreground flex items-center gap-2">
              <CheckCheck className="w-4 h-4 text-success" />
              {consolidateTarget?.currentValue ? t("opsDaily.consDialog.titleUnmark") : t("opsDaily.consDialog.titleMark")}
            </DialogTitle>
          </DialogHeader>
          <div className="py-2">
            <p className="text-sm text-muted-foreground">
              {consolidateTarget?.lineIds
                ? (consolidateTarget.currentValue
                    ? <>{rich(t("opsDaily.consDialog.unmarkLines", { n: "{n}", title: "{title}" }), { n: consolidateTarget.lineIds.length, title: consolidateTarget.title })}</>
                    : <>{rich(t("opsDaily.consDialog.markLines", { n: "{n}", title: "{title}" }), { n: consolidateTarget.lineIds.length, title: consolidateTarget.title })}</>)
                : consolidateTarget?.currentValue
                  ? <>{rich(t("opsDaily.consDialog.unmarkOne", { title: "{title}" }), { title: consolidateTarget.title })}</>
                  : <>{rich(t("opsDaily.consDialog.markOne", { title: "{title}" }), { title: consolidateTarget?.title })}</>}
            </p>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" size="sm" onClick={() => setConsolidateTarget(null)}
              className="border-border text-foreground/80 hover:bg-muted">
              {t("opsDaily.dialogCancel")}
            </Button>
            <Button size="sm"
              disabled={updateActivityOpMutation.isPending}
              className={consolidateTarget?.currentValue
                ? "bg-muted hover:bg-muted text-foreground"
                : "bg-success hover:bg-success/90 text-primary-foreground"}
              onClick={() => {
                if (!consolidateTarget) return;
                if (consolidateTarget.lineIds) {
                  consolidateAllLines(consolidateTarget.reservationId, consolidateTarget.activityIndex, consolidateTarget.lineIds, !consolidateTarget.currentValue);
                } else {
                  updateActivityOpMutation.mutate({
                    reservationId: consolidateTarget.reservationId,
                    activityIndex: consolidateTarget.activityIndex,
                    lineId: consolidateTarget.lineId,
                    consolidated: !consolidateTarget.currentValue,
                  });
                }
                setConsolidateTarget(null);
              }}>
              {consolidateTarget?.currentValue ? t("opsDaily.unmark") : t("opsDaily.consolidate")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Modal confirmar llegada con hora ──────────────────────────────── */}
      <Dialog open={!!confirmArrivalTarget} onOpenChange={() => setConfirmArrivalTarget(null)}>
        <DialogContent className="bg-card border-border text-foreground max-w-xs">
          <DialogHeader>
            <DialogTitle className="text-foreground flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-success" />
              {t("opsDaily.confirmArrival")}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">{t("opsDaily.arrivalDialog.text")}</p>
            <Input
              type="time"
              value={confirmArrivalTarget?.time ?? ""}
              onChange={(e) => setConfirmArrivalTarget((prev) => prev ? { ...prev, time: e.target.value } : prev)}
              className="bg-muted border-border text-foreground"
            />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" size="sm" onClick={() => setConfirmArrivalTarget(null)}
              className="border-border text-foreground/80 hover:bg-muted">
              {t("opsDaily.dialogCancel")}
            </Button>
            <Button size="sm"
              className="bg-success hover:bg-success/90 text-primary-foreground"
              disabled={confirmArrivalMutation.isPending}
              onClick={() => {
                if (!confirmArrivalTarget) return;
                confirmArrivalMutation.mutate({
                  reservationId: confirmArrivalTarget.reservationId,
                  arrivalTime: confirmArrivalTarget.time || undefined,
                });
                setConfirmArrivalTarget(null);
              }}>
              {t("opsDaily.arrivalDialog.confirm")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
