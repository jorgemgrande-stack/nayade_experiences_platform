/**
 * CalendarView — Calendario operativo de reservas confirmadas
 * Muestra SOLO reservas con status=paid y statusReservation!=ANULADA
 * Entidad principal: RESERVA (no actividad suelta, no presupuesto)
 */
import { useState, useMemo } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { productEditionsHref } from "@shared/leadWebRequest";
import { useI18n } from "@/i18n/I18nProvider";
import AdminLayout from "@/components/AdminLayout";
import { PanelPageHeader } from "@/components/admin/PanelUi";
import { MetricCard, SegmentedTabs } from "@/components/admin/PanelVisual";
import { PanelEmpty, PanelError, PanelLoading } from "@/components/admin/PanelStates";
import {
  Calendar, CalendarDays, ChevronLeft, ChevronRight,
  Waves, Utensils, RefreshCw, AlertTriangle, Users,
  Phone, Mail, Clock, CheckCircle, XCircle, User,
  ExternalLink, Layers,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

// ─── Date helpers ─────────────────────────────────────────────────────────────
function formatDate(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function addDays(d: Date, n: number) {
  const r = new Date(d); r.setDate(r.getDate() + n); return r;
}
function getMonthStart(d: Date) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function getMonthEnd(d: Date)   { return new Date(d.getFullYear(), d.getMonth() + 1, 0); }
function buildCalendarGrid(d: Date): Date[] {
  const first = getMonthStart(d);
  const startDow = (first.getDay() + 6) % 7;
  const grid: Date[] = [];
  for (let i = -startDow; i < 42 - startDow; i++) grid.push(addDays(first, i));
  while (grid.length > 35 && grid[grid.length - 7].getMonth() !== d.getMonth()) {
    grid.splice(grid.length - 7, 7);
  }
  return grid;
}
function getEventDateKey(ev: any): string {
  const sd = ev.scheduledDate;
  if (typeof sd === "string" && sd.length >= 10) return sd.slice(0, 10);
  return formatDate(new Date(sd));
}

// ─── Helpers operativos ───────────────────────────────────────────────────────
function getOpStatus(ev: any): "completa" | "sin_monitor" | "sin_hora" | "incidencia" {
  if (ev.opStatus === "incidencia") return "incidencia";
  if (!ev.monitorId) return "sin_monitor";
  if (!ev.arrivalTime) return "sin_hora";
  return "completa";
}

const OP_STATUS_CONFIG = {
  completa:    { dot: "bg-success", label: "opsCalendar.op.completa",   border: "border-l-emerald-500" },
  sin_monitor: { dot: "bg-danger",     label: "opsCalendar.op.sin_monitor",          border: "border-l-red-500" },
  sin_hora:    { dot: "bg-warning",   label: "opsCalendar.op.sin_hora",  border: "border-l-amber-500" },
  incidencia:  { dot: "bg-warning",  label: "opsCalendar.op.incidencia",           border: "border-l-orange-500" },
};

// ─── Pill de reserva en la celda ──────────────────────────────────────────────
function ReservationPill({ ev, onClick }: { ev: any; onClick: () => void }) {
  const opStatus = ev.eventType === "activity" ? getOpStatus(ev) : "completa";
  const cfg = OP_STATUS_CONFIG[opStatus];

  if (ev.eventType === "restaurant") {
    return (
      <button
        onClick={(e) => { e.stopPropagation(); onClick(); }}
        className="w-full flex items-center gap-1 rounded px-1.5 py-0.5 text-xs border overflow-hidden text-ellipsis whitespace-nowrap
          bg-success/15 text-success border-success/30 hover:bg-success/25 transition-colors text-left"
      >
        <Utensils className="w-2.5 h-2.5 shrink-0" />
        <span className="overflow-hidden text-ellipsis whitespace-nowrap">{ev.clientName}</span>
        <span className="shrink-0 opacity-70 ml-auto">·{ev.numberOfPersons}</span>
      </button>
    );
  }

  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className={`w-full flex items-center gap-1 rounded px-1.5 py-0.5 text-xs border-l-2 border border-border overflow-hidden text-ellipsis whitespace-nowrap
        bg-muted/80 hover:bg-muted transition-colors text-left ${cfg.border}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${cfg.dot}`} />
      <span className="overflow-hidden text-ellipsis whitespace-nowrap text-foreground/90">{ev.clientName}</span>
      <span className="shrink-0 text-muted-foreground ml-auto">·{ev.numberOfPersons}</span>
    </button>
  );
}

// ─── Sesiones de convocatorias (capa aparte, solo lectura) ────────────────────
// Paquetes vendidos una vez con varias fechas: no son reservas. Las personas confirmadas de la convocatoria participan
// en todas sus sesiones. Nunca se muestra aquí la nota interna (enlaces de acceso).
interface SessionEvent {
  sessionId: number;
  editionId: number;
  experienceId: number;
  productTitle: string;
  editionLabel: string;
  editionStatus: string;
  scheduledDate: string;
  startTime: string | null;
  durationMinutes: number | null;
  title: string;
  status: "scheduled" | "done" | "cancelled";
  index: number;
  total: number;
  participants: number;
  confirmedEnrollments: number;
}

function SessionPill({ s, onClick }: { s: SessionEvent; onClick: () => void }) {
  const { t } = useI18n();
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      data-testid="sesion-convocatoria"
      className="w-full flex items-center gap-1 rounded px-1.5 py-0.5 text-xs border border-dashed overflow-hidden text-ellipsis whitespace-nowrap
        bg-primary/15 text-primary border-primary/40 hover:bg-primary/25 transition-colors text-left"
    >
      <Layers className="w-2.5 h-2.5 shrink-0" />
      <span className="shrink-0" title={s.startTime ? undefined : t("opsCalendar.session.timeTbc")}>{s.startTime ?? t("opsCalendar.session.timeTbcShort")}</span>
      <span className="overflow-hidden text-ellipsis whitespace-nowrap">{s.productTitle}</span>
      <span className="shrink-0 opacity-70 ml-auto">·{s.participants}</span>
    </button>
  );
}

function SessionModal({ s, onClose }: { s: SessionEvent; onClose: () => void }) {
  const [, navigate] = useLocation();
  const { t, format: f } = useI18n();
  const day = f.date(new Date(s.scheduledDate + "T12:00:00"), { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="bg-card border-border text-foreground max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-foreground">
            <Layers className="w-5 h-5 text-primary" />
            {t("opsCalendar.session.title")}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 mt-1 text-sm">
          <div className="bg-muted/60 rounded-lg p-4 space-y-1">
            <p className="font-semibold text-foreground">{s.productTitle}</p>
            <p className="text-foreground/80">{s.editionLabel}{s.title ? ` · ${s.title}` : ""}</p>
            <p className="text-primary text-xs">{t("opsCalendar.session.indexOf", { index: s.index, total: s.total })}{s.status === "done" ? t("opsCalendar.session.done") : ""}{s.editionStatus === "draft" ? t("opsCalendar.session.draft") : ""}</p>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {[
              { label: t("opsCalendar.session.day"), value: day },
              { label: t("opsCalendar.session.time"), value: s.startTime ? `${s.startTime} h` : t("opsCalendar.session.toConfirm") },
              { label: t("opsCalendar.session.duration"), value: s.durationMinutes ? `${s.durationMinutes} min` : "—" },
            ].map((k) => (
              <div key={k.label} className="bg-muted rounded-lg p-3 text-center">
                <div className="text-[10px] text-muted-foreground mb-1">{k.label}</div>
                <p className="text-foreground text-xs font-medium">{k.value}</p>
              </div>
            ))}
          </div>
          <p className="flex items-center gap-1.5 text-foreground/80">
            <Users className="w-4 h-4 text-primary" />
            {t("opsCalendar.session.places", { places: s.participants, enrollments: s.confirmedEnrollments })}
          </p>
          <div className="flex gap-2 pt-2 border-t border-border">
            <Button variant="outline" size="sm" onClick={onClose} className="border-border text-foreground/80">{t("opsCalendar.close")}</Button>
            <Button size="sm" onClick={() => navigate(productEditionsHref(s.experienceId))} className="ml-auto gap-1">
              <ExternalLink className="w-3.5 h-3.5" /> {t("opsCalendar.session.openEditions")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Modal de resumen operativo de reserva ────────────────────────────────────
function ReservationModal({
  ev, onClose, onGoToActivities,
}: {
  ev: any;
  onClose: () => void;
  onGoToActivities: (dateStr: string) => void;
}) {
  const [, navigate] = useLocation();
  const { t } = useI18n();
  const opStatus = ev.eventType === "activity" ? getOpStatus(ev) : "completa";
  const cfg = OP_STATUS_CONFIG[opStatus];

  // Parsear actividades del extras_json
  let extras: any[] = [];
  try { extras = ev.extrasJson ? JSON.parse(ev.extrasJson) : []; } catch { extras = []; }

  // Actividades internas con herencia de datos operativos
  const activitiesOpJson: Array<{ index: number; monitorId?: number | null; arrivalTime?: string; opNotes?: string }> = (() => {
    try { return ev.activitiesOpJson ? JSON.parse(ev.activitiesOpJson) : []; } catch { return []; }
  })();

  function getActivityOp(index: number) {
    const override = activitiesOpJson.find(a => a.index === index);
    return {
      monitorId:   override?.monitorId   ?? ev.monitorId   ?? null,
      arrivalTime: override?.arrivalTime ?? ev.arrivalTime ?? null,
      opNotes:     override?.opNotes     ?? ev.opNotes     ?? null,
      isInherited: !override,
    };
  }

  const totalActivities = 1 + extras.length; // actividad principal + extras
  const scheduledDate = ev.scheduledDate || "";

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="bg-card border-border text-foreground max-w-xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-foreground">
            <CalendarDays className="w-5 h-5 text-info" />
            {t("opsCalendar.res.title")}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 mt-1">
          {/* Estado operativo */}
          <div className={`flex items-center gap-2 px-3 py-2 rounded-lg bg-muted border-l-4 ${cfg.border.replace("border-l-", "border-l-4 border-")}`}>
            <span className={`w-2 h-2 rounded-full ${cfg.dot}`} />
            <span className="text-sm text-foreground/80">{t(cfg.label)}</span>
          </div>

          {/* Cabecera: datos del cliente y reserva */}
          <div className="bg-muted/60 rounded-lg p-4 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-semibold text-foreground text-base">{ev.clientName}</p>
                {ev.reservationNumber && (
                  <p className="text-info text-xs font-mono mt-0.5">{ev.reservationNumber}</p>
                )}
              </div>
              <div className="flex flex-col items-end gap-1">
                <Badge className="bg-info/20 text-info border-info/40 text-[10px]">
                  {ev.channel || "—"}
                </Badge>
                {ev.statusReservation && (
                  <Badge className="bg-muted/50 text-foreground/80 text-[10px]">
                    {ev.statusReservation}
                  </Badge>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs">
              {ev.clientPhone && (
                <div className="flex items-center gap-1.5 text-muted-foreground">
                  <Phone className="w-3 h-3" />
                  <a href={`tel:${ev.clientPhone}`} className="hover:text-foreground transition-colors">{ev.clientPhone}</a>
                </div>
              )}
              {ev.clientEmail && (
                <div className="flex items-center gap-1.5 text-muted-foreground overflow-hidden text-ellipsis whitespace-nowrap">
                  <Mail className="w-3 h-3 shrink-0" />
                  <span className="overflow-hidden text-ellipsis whitespace-nowrap">{ev.clientEmail}</span>
                </div>
              )}
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <CalendarDays className="w-3 h-3" />
                <span>{t("opsCalendar.res.activityDate", { date: scheduledDate })}</span>
              </div>
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <Users className="w-3 h-3" />
                <span>{t("opsCalendar.res.paxActivities", { pax: ev.numberOfPersons, n: totalActivities })}</span>
              </div>
            </div>
          </div>

          {/* Resumen operativo general */}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {[
              { label: t("opsCalendar.res.monitor"), value: ev.monitorName || t("opsCalendar.res.unassigned"), icon: <User className="w-3 h-3" />, ok: !!ev.monitorId },
              { label: t("opsCalendar.res.arrival"), value: ev.arrivalTime || t("opsCalendar.res.notAssigned"), icon: <Clock className="w-3 h-3" />, ok: !!ev.arrivalTime },
              { label: t("opsCalendar.res.state"), value: ev.opStatus ? (["pendiente", "confirmado", "completado", "incidencia", "cancelado"].includes(ev.opStatus) ? t(`opsCalendar.opState.${ev.opStatus}`) : ev.opStatus) : t("opsCalendar.opState.pendiente"), icon: <CheckCircle className="w-3 h-3" />, ok: ev.opStatus === "confirmado" || ev.opStatus === "completado" },
            ].map(item => (
              <div key={item.label} className="bg-muted rounded-lg p-3 text-center">
                <div className={`flex items-center justify-center gap-1 text-[10px] mb-1 ${item.ok ? "text-success" : "text-warning"}`}>
                  {item.icon}
                  <span>{item.label}</span>
                </div>
                <p className="text-foreground text-xs font-medium overflow-hidden text-ellipsis whitespace-nowrap">{item.value}</p>
              </div>
            ))}
          </div>

          {/* Notas operativas generales */}
          {ev.opNotes && (
            <div className="bg-warning/10 border border-warning/20 rounded-lg p-3">
              <p className="text-xs text-warning font-medium mb-1">{t("opsCalendar.res.opNotes")}</p>
              <p className="text-xs text-foreground/80 italic">"{ev.opNotes}"</p>
            </div>
          )}

          {/* Actividades de la reserva */}
          <div>
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
              {t("opsCalendar.res.activitiesIncluded", { n: totalActivities })}
            </h4>
            <div className="space-y-2">
              {/* Actividad principal */}
              {(() => {
                const op = getActivityOp(0);
                return (
                  <div className="bg-muted rounded-lg p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground overflow-hidden text-ellipsis whitespace-nowrap">{ev.activityTitle || t("opsCalendar.res.mainActivity")}</p>
                        <p className="text-[10px] text-muted-foreground mt-0.5">{ev.numberOfPersons} {t("opsCalendar.pax")}</p>
                      </div>
                      {op.isInherited && <Badge className="text-[9px] bg-muted/50 text-muted-foreground border-border">{t("opsCalendar.res.inherited")}</Badge>}
                    </div>
                    <div className="flex items-center gap-3 mt-2 text-[10px] text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <User className="w-3 h-3" />
                        {op.monitorId ? (ev.monitorName || t("opsCalendar.res.monitorNum", { id: op.monitorId })) : <span className="text-danger">{t("opsCalendar.noMonitor")}</span>}
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {op.arrivalTime || <span className="text-warning">{t("opsCalendar.res.noTime")}</span>}
                      </span>
                    </div>
                    {op.opNotes && <p className="text-[10px] text-muted-foreground italic mt-1">"{op.opNotes}"</p>}
                  </div>
                );
              })()}
              {/* Actividades extras */}
              {extras.map((ex: any, i: number) => {
                const op = getActivityOp(i + 1);
                return (
                  <div key={i} className="bg-muted rounded-lg p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground overflow-hidden text-ellipsis whitespace-nowrap">
                          {ex.experienceTitle || ex.name || t("opsCalendar.res.activityN", { n: i + 2 })}
                        </p>
                        <p className="text-[10px] text-muted-foreground mt-0.5">{ex.participants || ex.pax || "—"} {t("opsCalendar.pax")}</p>
                      </div>
                      {op.isInherited && <Badge className="text-[9px] bg-muted/50 text-muted-foreground border-border">{t("opsCalendar.res.inherited")}</Badge>}
                    </div>
                    <div className="flex items-center gap-3 mt-2 text-[10px] text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <User className="w-3 h-3" />
                        {op.monitorId ? (ev.monitorName || t("opsCalendar.res.monitorNum", { id: op.monitorId })) : <span className="text-danger">{t("opsCalendar.noMonitor")}</span>}
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {op.arrivalTime || <span className="text-warning">{t("opsCalendar.res.noTime")}</span>}
                      </span>
                    </div>
                    {op.opNotes && <p className="text-[10px] text-muted-foreground italic mt-1">"{op.opNotes}"</p>}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Acciones */}
          <div className="flex flex-wrap gap-2 pt-2 border-t border-border">
            <Button variant="outline" size="sm" onClick={onClose} className="border-border text-foreground/80">
              {t("opsCalendar.close")}
            </Button>
            <Button size="sm" variant="outline"
              onClick={() => navigate(`/admin/crm?tab=reservas&id=${ev.id}`)}
              className="border-info/50 text-info hover:bg-info/10 gap-1">
              <ExternalLink className="w-3.5 h-3.5" /> {t("opsCalendar.res.viewCrm")}
            </Button>
            <Button size="sm"
              onClick={() => { onGoToActivities(scheduledDate); onClose(); }}
              className="ml-auto gap-1">
              <CalendarDays className="w-3.5 h-3.5" /> {t("opsCalendar.res.viewDayActivities")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Modal de resumen de día (al hacer click en la celda) ─────────────────────
function DayDetailModal({
  date, events, onClose, onGoToActivities, onSelectReservation,
}: {
  date: Date;
  events: any[];
  onClose: () => void;
  onGoToActivities: (dateStr: string) => void;
  onSelectReservation: (ev: any) => void;
}) {
  const { t, format: f } = useI18n();
  const label = f.date(date, {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  });
  const activities = events.filter(e => e.eventType === "activity");
  const restaurants = events.filter(e => e.eventType === "restaurant");
  const sinMonitor = activities.filter(a => !a.monitorId).length;
  const sinHora = activities.filter(a => !a.arrivalTime).length;
  const totalPax = events.reduce((s, e) => s + (e.numberOfPersons || 0), 0);

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="bg-card border-border text-foreground max-w-lg max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-foreground first-letter:uppercase flex items-center gap-2">
            <CalendarDays className="w-5 h-5 text-info" />
            {label}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 mt-2">
          {/* KPIs */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              { label: t("opsCalendar.day.reservations"), value: events.length, color: "text-foreground" },
              { label: t("opsCalendar.paxTotal"), value: totalPax, color: "text-info" },
              { label: t("opsCalendar.noMonitor"), value: sinMonitor, color: sinMonitor > 0 ? "text-danger" : "text-success" },
              { label: t("opsCalendar.res.noTime"), value: sinHora, color: sinHora > 0 ? "text-warning" : "text-success" },
            ].map(k => (
              <div key={k.label} className="bg-muted rounded-lg p-3 text-center">
                <div className={`text-xl font-bold ${k.color}`}>{k.value}</div>
                <div className="text-muted-foreground text-[10px] mt-0.5">{k.label}</div>
              </div>
            ))}
          </div>

          {/* Alertas */}
          {sinMonitor > 0 && (
            <div className="bg-danger/10 border border-danger/30 rounded-lg p-3 flex items-center gap-2 text-sm">
              <AlertTriangle className="w-4 h-4 text-danger shrink-0" />
              <span className="text-danger">{t("opsCalendar.day.noMonitorAlert", { n: sinMonitor })}</span>
            </div>
          )}
          {sinHora > 0 && (
            <div className="bg-warning/10 border border-warning/30 rounded-lg p-3 flex items-center gap-2 text-sm">
              <AlertTriangle className="w-4 h-4 text-warning shrink-0" />
              <span className="text-warning">{t("opsCalendar.day.noTimeAlert", { n: sinHora })}</span>
            </div>
          )}

          {/* Listado de reservas de actividad */}
          {activities.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-info uppercase tracking-wide mb-2 flex items-center gap-1">
                <Waves className="w-3.5 h-3.5" /> {t("opsCalendar.day.confirmed", { n: activities.length })}
              </h4>
              <div className="space-y-1.5">
                {activities.map((ev: any, i: number) => {
                  const opStatus = getOpStatus(ev);
                  const cfg = OP_STATUS_CONFIG[opStatus];
                  return (
                    <button key={i} onClick={() => { onSelectReservation(ev); onClose(); }}
                      className={`w-full bg-muted rounded-lg p-3 text-left hover:bg-muted transition-colors border-l-2 ${cfg.border.replace("border-l-", "border-l-2 border-")}`}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-foreground text-sm overflow-hidden text-ellipsis whitespace-nowrap">{ev.clientName}</p>
                          <p className="text-muted-foreground text-xs mt-0.5 overflow-hidden text-ellipsis whitespace-nowrap">{ev.activityTitle}</p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="flex items-center gap-1 text-xs text-muted-foreground">
                            <Users className="w-3 h-3" />{ev.numberOfPersons}
                          </span>
                          <span className={`w-2 h-2 rounded-full ${cfg.dot}`} title={t(cfg.label)} />
                        </div>
                      </div>
                      {ev.reservationNumber && (
                        <p className="text-[10px] font-mono text-info/70 mt-1">{ev.reservationNumber}</p>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Restaurantes */}
          {restaurants.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-success uppercase tracking-wide mb-2 flex items-center gap-1">
                <Utensils className="w-3.5 h-3.5" /> {t("opsCalendar.day.restaurant", { n: restaurants.length })}
              </h4>
              <div className="space-y-1.5">
                {restaurants.map((ev: any, i: number) => (
                  <button key={i} onClick={() => { onSelectReservation(ev); onClose(); }}
                    className="w-full bg-muted rounded-lg p-3 text-left hover:bg-muted transition-colors">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-foreground text-sm overflow-hidden text-ellipsis whitespace-nowrap">{ev.activityTitle}</p>
                        <p className="text-muted-foreground text-xs mt-0.5">{ev.clientName}</p>
                      </div>
                      <span className="flex items-center gap-1 text-xs text-muted-foreground shrink-0">
                        <Users className="w-3 h-3" />{ev.numberOfPersons}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {events.length === 0 && (
            <p className="text-center text-muted-foreground py-6">{t("opsCalendar.day.empty")}</p>
          )}

          <div className="flex gap-2 justify-end pt-2 border-t border-border">
            <Button variant="outline" size="sm" onClick={onClose} className="border-border text-foreground/80">
              {t("opsCalendar.close")}
            </Button>
            <Button size="sm"
              onClick={() => { onGoToActivities(formatDate(date)); onClose(); }}
              className="bg-primary hover:bg-primary/90 text-primary-foreground">
              {t("opsCalendar.day.goToActivities")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Vista agenda: lista por día, la forma de leer el mes cuando la cuadrícula no cabe ──────────────────
function AgendaList({ days, eventsByDay, sessionsByDay, today, onDay, onReservation, onSession }: {
  days: Date[];
  eventsByDay: Record<string, any[]>;
  sessionsByDay: Record<string, SessionEvent[]>;
  today: string;
  onDay: (d: Date) => void;
  onReservation: (ev: any) => void;
  onSession: (s: SessionEvent) => void;
}) {
  const { t, format: f } = useI18n();
  return (
    <ol className="space-y-3" aria-label={t("opsCalendar.agenda.label")}>
      {days.map((day) => {
        const key = formatDate(day);
        const evs = eventsByDay[key] || [];
        const sess = sessionsByDay[key] || [];
        const alerts = evs.filter((e) => e.eventType === "activity" && (!e.monitorId || e.opStatus === "incidencia")).length;
        const isToday = key === today;
        return (
          <li key={key} className={`overflow-hidden rounded-xl border bg-card ${isToday ? "border-primary/60" : "border-border"}`}>
            <button
              type="button"
              onClick={() => onDay(day)}
              className="flex min-h-11 w-full items-center gap-3 border-b border-border bg-muted/40 px-4 py-2 text-left hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${isToday ? "bg-primary text-primary-foreground" : "bg-background text-foreground"}`}>{day.getDate()}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium first-letter:uppercase text-foreground">{f.date(day, { weekday: "long", day: "numeric", month: "long" })}</span>
                <span className="block text-xs text-muted-foreground">{t("opsCalendar.agenda.dayCount", { n: evs.length + sess.length })}</span>
              </span>
              {alerts > 0 && <AlertTriangle className="h-4 w-4 shrink-0 text-warning" aria-label={t("opsCalendar.day.noMonitorAlert", { n: alerts })} />}
            </button>
            <ul className="divide-y divide-border">
              {evs.map((ev, i) => {
                const op = ev.eventType === "activity" ? getOpStatus(ev) : "completa";
                const cfg = OP_STATUS_CONFIG[op];
                return (
                  <li key={`e${i}`}>
                    <button type="button" onClick={() => onReservation(ev)} className="flex min-h-11 w-full items-start gap-3 px-4 py-2.5 text-left hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      {ev.eventType === "restaurant"
                        ? <Utensils className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden="true" />
                        : <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${cfg.dot}`} aria-hidden="true" />}
                      <span className="min-w-0 flex-1">
                        <span className="block break-words text-sm font-medium text-foreground">{ev.clientName}</span>
                        <span className="block break-words text-xs text-muted-foreground">{ev.activityTitle}{ev.eventType === "activity" ? ` · ${t(cfg.label)}` : ""}</span>
                      </span>
                      <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground"><Users className="h-3 w-3" aria-hidden="true" />{ev.numberOfPersons}</span>
                    </button>
                  </li>
                );
              })}
              {sess.map((s) => (
                <li key={`s${s.sessionId}`}>
                  <button type="button" onClick={() => onSession(s)} className="flex min-h-11 w-full items-start gap-3 px-4 py-2.5 text-left hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    <Layers className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                    <span className="min-w-0 flex-1">
                      <span className="block break-words text-sm font-medium text-foreground">{s.productTitle}</span>
                      <span className="block break-words text-xs text-muted-foreground">{s.startTime ?? t("opsCalendar.session.timeTbc")} · {t("opsCalendar.session.indexOf", { index: s.index, total: s.total })}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground"><Users className="h-3 w-3" aria-hidden="true" />{s.participants}</span>
                  </button>
                </li>
              ))}
            </ul>
          </li>
        );
      })}
    </ol>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────────
export default function CalendarView() {
  const [, navigate] = useLocation();
  const { t, format: f } = useI18n();
  const [currentDate, setCurrentDate] = useState(() => new Date());
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);
  const [selectedReservation, setSelectedReservation] = useState<any>(null);
  const [selectedSession, setSelectedSession] = useState<SessionEvent | null>(null);
  // En escritorio se elige cuadrícula o agenda; en móvil la cuadrícula no cabe y siempre se ve la agenda
  const [view, setView] = useState<"grid" | "agenda">("grid");

  const monthStart = useMemo(() => getMonthStart(currentDate), [currentDate]);
  const monthEnd = useMemo(() => getMonthEnd(currentDate), [currentDate]);
  const grid = useMemo(() => buildCalendarGrid(currentDate), [currentDate]);

  const fromDate = formatDate(grid[0]);
  const toDate = formatDate(grid[grid.length - 1]);

  const { data, isLoading, isError, error, refetch } = trpc.operations.calendar.getEvents.useQuery(
    { from: fromDate + "T00:00:00", to: toDate + "T23:59:59" },
    { refetchOnWindowFocus: false }
  );

  const eventsByDay = useMemo(() => {
    const map: Record<string, any[]> = {};
    const acts = (data?.activities || []).map((e: any) => ({ ...e, eventType: "activity" }));
    const rests = (data?.restaurants || []).map((e: any) => ({ ...e, eventType: "restaurant" }));
    [...acts, ...rests].forEach(ev => {
      const key = getEventDateKey(ev);
      if (!map[key]) map[key] = [];
      map[key].push(ev);
    });
    return map;
  }, [data]);

  // Sesiones de convocatorias por día (capa aparte: no cuentan como reservas ni en los totales)
  const sessionsByDay = useMemo(() => {
    const map: Record<string, SessionEvent[]> = {};
    for (const s of ((data as { editionSessions?: SessionEvent[] } | undefined)?.editionSessions ?? [])) {
      (map[s.scheduledDate] ??= []).push(s);
    }
    return map;
  }, [data]);

  const today = formatDate(new Date());
  const DOW_LABELS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((d) => t(`opsCalendar.dow.${d}`));

  const monthLabel = f.date(currentDate, { month: "long", year: "numeric" });
  const selectedDayEvents = selectedDay ? (eventsByDay[formatDate(selectedDay)] || []) : [];

  function goToActivities(dateStr: string) {
    sessionStorage.setItem("activitiesDate", dateStr);
    navigate("/admin/operaciones/actividades");
  }

  // Totales del mes
  const allEvents = Object.values(eventsByDay).flat();
  const monthActivities = allEvents.filter(e => e.eventType === "activity");
  const monthPax = monthActivities.reduce((s, e) => s + (e.numberOfPersons || 0), 0);
  const sinMonitorTotal = monthActivities.filter(e => !e.monitorId).length;
  const monthRestaurants = allEvents.filter(e => e.eventType === "restaurant").length;
  // Días del mes con algo programado (reservas o sesiones), para la agenda
  const agendaDays = grid.filter((d) => d.getMonth() === currentDate.getMonth() && ((eventsByDay[formatDate(d)] || []).length > 0 || (sessionsByDay[formatDate(d)] || []).length > 0));

  return (
    <AdminLayout title={t("opsCalendar.pageTitle")}>
      <div className="text-foreground">
        <PanelPageHeader
          icon={<Calendar />}
          title={t("opsCalendar.heading")}
          description={t("opsCalendar.subtitle")}
          actions={
            <Button variant="outline" size="icon" onClick={() => refetch()} aria-label={t("panelStates.retry")}>
              <RefreshCw className="w-4 h-4" aria-hidden="true" />
            </Button>
          }
        />

        {/* Resumen del mes */}
        {!isLoading && !isError && (
          <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
            <MetricCard tone="info" icon={<CalendarDays />} label={t("opsCalendar.month.reservations")} value={monthActivities.length} className="bg-gradient-to-br from-primary/5 to-card" />
            <MetricCard tone="brand" icon={<Users />} label={t("opsCalendar.paxTotal")} value={monthPax} className="bg-gradient-to-br from-primary/5 to-card" />
            <MetricCard tone={sinMonitorTotal > 0 ? "danger" : "success"} icon={sinMonitorTotal > 0 ? <AlertTriangle /> : <CheckCircle />} label={t("opsCalendar.noMonitor")} value={sinMonitorTotal} className="bg-gradient-to-br from-primary/5 to-card" />
            <MetricCard tone="success" icon={<Utensils />} label={t("opsCalendar.month.restaurant")} value={monthRestaurants} className="bg-gradient-to-br from-primary/5 to-card" />
          </div>
        )}

        {/* Navegación del mes */}
        <div className="mb-4 flex flex-wrap items-center gap-2 sm:gap-3">
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" aria-label={t("opsCalendar.prevMonth")}
              onClick={() => setCurrentDate(d => new Date(d.getFullYear(), d.getMonth() - 1, 1))}
              className="h-10 w-10">
              <ChevronLeft className="w-4 h-4" aria-hidden="true" />
            </Button>
            <Button variant="outline" onClick={() => setCurrentDate(new Date())} className="h-10">
              {t("opsCalendar.today")}
            </Button>
            <Button variant="outline" size="icon" aria-label={t("opsCalendar.nextMonth")}
              onClick={() => setCurrentDate(d => new Date(d.getFullYear(), d.getMonth() + 1, 1))}
              className="h-10 w-10">
              <ChevronRight className="w-4 h-4" aria-hidden="true" />
            </Button>
          </div>
          <h2 className="min-w-0 flex-1 text-xl font-semibold first-letter:uppercase text-foreground" aria-live="polite">{monthLabel}</h2>
          <SegmentedTabs
            className="hidden md:inline-flex"
            label={t("opsCalendar.viewLabel")}
            value={view}
            onChange={setView}
            options={[
              { value: "grid", label: t("opsCalendar.viewGrid") },
              { value: "agenda", label: t("opsCalendar.viewAgenda") },
            ]}
          />
        </div>

        {/* Leyenda */}
        <ul className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-label={t("opsCalendar.legendLabel")}>
          <li className="flex items-center gap-1.5"><span className="inline-block h-2 w-2 rounded-full bg-success" aria-hidden="true" />{t("opsCalendar.legend.complete")}</li>
          <li className="flex items-center gap-1.5"><span className="inline-block h-2 w-2 rounded-full bg-warning" aria-hidden="true" />{t("opsCalendar.legend.noTime")}</li>
          <li className="flex items-center gap-1.5"><span className="inline-block h-2 w-2 rounded-full bg-danger" aria-hidden="true" />{t("opsCalendar.noMonitor")}</li>
          <li className="flex items-center gap-1.5"><AlertTriangle className="h-3 w-3 text-warning" aria-hidden="true" />{t("opsCalendar.op.incidencia")}</li>
          <li className="flex items-center gap-1.5"><Layers className="h-3 w-3 text-primary" aria-hidden="true" />{t("opsCalendar.session.title")}</li>
        </ul>

        {isLoading ? (
          <PanelLoading label={t("opsCalendar.loading")} />
        ) : isError ? (
          <PanelError error={error} onRetry={() => refetch()} title={t("opsCalendar.loadError")} />
        ) : (
          <>
            {/* Agenda: siempre en móvil, y a elección en escritorio */}
            <div className={view === "agenda" ? "block" : "md:hidden"}>
              {agendaDays.length === 0 ? (
                <PanelEmpty icon={<CalendarDays />} title={t("opsCalendar.agenda.emptyTitle")} description={t("opsCalendar.agenda.emptyText")} />
              ) : (
                <AgendaList
                  days={agendaDays}
                  eventsByDay={eventsByDay}
                  sessionsByDay={sessionsByDay}
                  today={today}
                  onDay={(d) => setSelectedDay(d)}
                  onReservation={(ev) => setSelectedReservation(ev)}
                  onSession={(s) => setSelectedSession(s)}
                />
              )}
            </div>

            {/* Cuadrícula mensual: desde 768 px */}
            <div className={view === "grid" ? "hidden md:block" : "hidden"}>
              <div className="overflow-hidden rounded-xl border border-border bg-card">
                <div className="grid grid-cols-7 border-b border-border bg-muted/40">
                  {DOW_LABELS.map(d => (
                    <div key={d} className="py-2 text-center text-xs font-semibold uppercase tracking-wide text-muted-foreground">{d}</div>
                  ))}
                </div>
                <div className="grid grid-cols-7">
                  {grid.map((day, idx) => {
                    const key = formatDate(day);
                    const isCurrentMonth = day.getMonth() === currentDate.getMonth();
                    const isToday = key === today;
                    const dayEvents = eventsByDay[key] || [];
                    const acts = dayEvents.filter(e => e.eventType === "activity");
                    const hasAlert = acts.some(e => !e.monitorId || e.opStatus === "incidencia");
                    const isLastRow = idx >= grid.length - 7;
                    const clickable = dayEvents.length > 0;

                    return (
                      <div
                        key={key}
                        onClick={() => clickable && setSelectedDay(day)}
                        className={`min-h-[110px] border-b border-r border-border p-1.5 ${clickable ? "cursor-pointer transition-colors hover:bg-muted/60" : ""} ${!isCurrentMonth ? "opacity-40" : ""} ${isToday ? "bg-primary/5" : ""} ${isLastRow ? "border-b-0" : ""} ${(idx + 1) % 7 === 0 ? "border-r-0" : ""}`}
                      >
                        <div className="mb-1 flex items-center justify-between">
                          <span className={`flex h-6 w-6 items-center justify-center rounded-full text-sm font-semibold ${isToday ? "bg-primary text-primary-foreground" : "text-foreground/80"}`}>
                            {day.getDate()}
                          </span>
                          {hasAlert && <AlertTriangle className="h-3 w-3 text-warning" aria-label={t("opsCalendar.op.incidencia")} />}
                        </div>
                        <div className="space-y-0.5">
                          {dayEvents.slice(0, 3).map((ev, i) => (
                            <ReservationPill key={i} ev={ev} onClick={() => setSelectedReservation(ev)} />
                          ))}
                          {(sessionsByDay[key] || []).slice(0, 2).map((s) => (
                            <SessionPill key={`s${s.sessionId}`} s={s} onClick={() => setSelectedSession(s)} />
                          ))}
                          {(sessionsByDay[key] || []).length > 2 && (
                            <p className="pl-1 text-xs text-primary">{t("opsCalendar.moreSessions", { n: (sessionsByDay[key] || []).length - 2 })}</p>
                          )}
                          {dayEvents.length > 3 && (
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); setSelectedDay(day); }}
                              className="w-full pl-1 text-left text-xs text-muted-foreground transition-colors hover:text-foreground"
                            >
                              {t("opsCalendar.more", { n: dayEvents.length - 3 })}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Modal de resumen del día */}
      {selectedDay && !selectedReservation && (
        <DayDetailModal
          date={selectedDay}
          events={selectedDayEvents}
          onClose={() => setSelectedDay(null)}
          onGoToActivities={goToActivities}
          onSelectReservation={(ev) => { setSelectedReservation(ev); setSelectedDay(null); }}
        />
      )}

      {/* Sesión de convocatoria (solo lectura) */}
      {selectedSession && <SessionModal s={selectedSession} onClose={() => setSelectedSession(null)} />}

      {/* Modal de reserva individual */}
      {selectedReservation && (
        <ReservationModal
          ev={selectedReservation}
          onClose={() => setSelectedReservation(null)}
          onGoToActivities={goToActivities}
        />
      )}
    </AdminLayout>
  );
}
