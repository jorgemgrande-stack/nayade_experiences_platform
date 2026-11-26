import React, { useState, useEffect, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { errorMessage } from "@/components/admin/PanelStates";
import { useVocabulary } from "@/lib/vocabulary";
import { errorToastMessage } from "@/lib/errorMessage";
import { TONE_BADGE } from "@/lib/panelTones";
import { quoteMailNotice, type QuoteMailResult } from "@shared/quoteMailNotice";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { CatalogConceptSelector, type CatalogProduct } from "@/components/CatalogConceptSelector";
import { Globe, Ticket, Store, Handshake, Users, Plus, Phone, Mail, RefreshCw, AlertCircle } from "lucide-react";
import { StatusBadge } from "@/components/admin/PanelUi";
import { useI18n } from "@/i18n/I18nProvider";

export const PAGE_SIZE = 50;

export const DT_FULL: Intl.DateTimeFormatOptions = { year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" };

export const EUR2: Intl.NumberFormatOptions = { minimumFractionDigits: 2, maximumFractionDigits: 2 };

/** Aviso del envío de un presupuesto según lo que ha pasado con el correo (prueba gratuita incluida). */
export function toastQuoteMail(r: QuoteMailResult | null | undefined, sentMessage: string) {
  const n = quoteMailNotice(r, sentMessage);
  if (n.kind === "success") toast.success(n.message);
  else toast.warning(n.message, { duration: 12000 });
}

// ─── TYPES ───────────────────────────────────────────────────────────────────
export type Tab = "leads" | "quotes" | "reservations" | "invoices" | "anulaciones" | "pagos_pendientes" | "bonos";

export type OpportunityStatus = "nueva" | "enviada" | "ganada" | "perdida";

export type Priority = "baja" | "media" | "alta";

export type QuoteStatus = "borrador" | "enviado" | "visualizado" | "convertido_carrito" | "pago_fallido" | "aceptado" | "rechazado" | "expirado" | "perdido";

/** Error de un campo, enlazado con aria-describedby. */
export function FieldError({ id, msg }: { id: string; msg?: string | null }) {
  if (!msg) return null;
  return <p id={id} role="alert" className="text-xs text-danger mt-1">{msg}</p>;
}

export const invalidProps = (msg: string | undefined, id: string) =>
  msg ? { "aria-invalid": true as const, "aria-describedby": id } : {};

/** Confirmación accesible (sustituye a `confirm()` del navegador). */
export function ConfirmDialog({ open, title, description, confirmLabel = "Eliminar", onConfirm, onCancel }: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  return (
    <AlertDialog open={open} onOpenChange={(o) => { if (!o) onCancel(); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("crmShared.cancelar")}</AlertDialogCancel>
          <AlertDialogAction className="bg-destructive hover:bg-destructive/90 text-white" onClick={onConfirm}>{confirmLabel}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ─── BADGE HELPERS ────────────────────────────────────────────────────────────
export function OpportunityBadge({ status }: { status: OpportunityStatus }) {
  const { t } = useI18n();
  const map: Record<OpportunityStatus, { label: string; tone: "info" | "warning" | "success" | "danger" }> = {
    nueva: { label: t("crmLeads.nueva"), tone: "info" },
    enviada: { label: t("crmLeads.enviada"), tone: "warning" },
    ganada: { label: t("crmLeads.ganada"), tone: "success" },
    perdida: { label: t("crmLeads.perdida"), tone: "danger" },
  };
  const { label, tone } = map[status] ?? map.nueva;
  return <StatusBadge tone={tone}>{label}</StatusBadge>;
}

export function QuoteStatusBadge({ status }: { status: QuoteStatus }) {
  const { t } = useI18n();
  const map: Record<QuoteStatus, { label: string; className: string }> = {
    borrador:           { label: t("crmQuotes.borrador"),         className: "bg-slate-500/15 text-slate-400 border-slate-500/30" },
    enviado:            { label: t("crmQuotes.enviado"),           className: "bg-info/15 text-info border-info/30" },
    visualizado:        { label: t("crmQuotes.visualizado"),       className: "bg-info/15 text-info border-info/30" },
    convertido_carrito: { label: t("crmQuotes.pagoIniciado"),     className: "bg-primary/15 text-primary border-primary/30" },
    pago_fallido:       { label: t("crmQuotes.pagoFallido"),      className: "bg-warning/15 text-warning border-warning/30" },
    aceptado:           { label: t("crmQuotes.aceptado"),          className: TONE_BADGE.success },
    rechazado:          { label: t("crmQuotes.rechazado"),         className: "bg-danger/15 text-danger border-danger/30" },
    expirado:           { label: t("crmQuotes.expirado"),          className: "bg-warning/15 text-warning border-warning/30" },
    perdido:            { label: t("crmQuotes.perdido"),           className: "bg-danger/15 text-danger border-danger/30" },
  };
  const { label, className } = map[status] ?? { label: status, className: "bg-slate-500/15 text-slate-400 border-slate-500/30" };
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${className}`}>{label}</span>;
}

export function PriorityDot({ priority }: { priority: Priority }) {
  const map: Record<Priority, string> = {
    baja: "bg-slate-400",
    media: "bg-warning",
    alta: "bg-danger",
  };
  return <span className={`inline-block w-2 h-2 rounded-full ${map[priority] ?? "bg-slate-400"}`} title={priority} />;
}

// ─── Anulaciones badge helpers ───────────────────────────────────────────────
export function AnulOpBadge({ status }: { status: string }) {
  const { t } = useI18n();
  const map: Record<string, { label: string; cls: string }> = {
    recibida: { label: t("crmCancellations.recibida"), cls: "bg-info/15 text-info border-info/20" },
    en_revision: { label: t("crmCancellations.enRevision"), cls: "bg-warning/15 text-warning border-warning/20" },
    pendiente_documentacion: { label: t("crmCancellations.pendDocs"), cls: "bg-warning/15 text-warning border-warning/20" },
    pendiente_decision: { label: t("crmCancellations.pendDecision"), cls: "bg-warning/15 text-warning border-warning/20" },
    resuelta: { label: t("crmCancellations.resuelta"), cls: "bg-success/15 text-success border-success/20" },
    cerrada: { label: t("crmCancellations.cerrada"), cls: "bg-gray-500/15 text-gray-400 border-gray-500/20" },
    incidencia: { label: t("crmCancellations.incidencia"), cls: "bg-danger/15 text-danger border-danger/20" },
  };
  const s = map[status] ?? { label: status, cls: "bg-foreground/[0.05] text-foreground/50 border-foreground/[0.12]" };
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${s.cls}`}>{s.label}</span>;
}

export function AnulResBadge({ status }: { status: string }) {
  const { t } = useI18n();
  const map: Record<string, { label: string; cls: string }> = {
    sin_resolver: { label: t("crmCancellations.sinResolver"), cls: "bg-foreground/[0.05] text-foreground/50 border-foreground/[0.12]" },
    rechazada: { label: t("crmCancellations.rechazada"), cls: "bg-danger/15 text-danger border-danger/20" },
    aceptada_total: { label: t("crmCancellations.aceptadaTotal"), cls: "bg-success/15 text-success border-success/20" },
    aceptada_parcial: { label: t("crmCancellations.aceptadaParcial"), cls: "bg-success/15 text-success border-success/20" },
  };
  const s = map[status] ?? { label: status, cls: "bg-foreground/[0.05] text-foreground/50 border-foreground/[0.12]" };
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${s.cls}`}>{s.label}</span>;
}

export function AnulFinBadge({ status }: { status: string }) {
  const { t } = useI18n();
  const map: Record<string, { label: string; cls: string }> = {
    sin_compensacion: { label: t("crmCancellations.sinComp"), cls: "bg-foreground/[0.05] text-foreground/50 border-foreground/[0.12]" },
    pendiente_devolucion: { label: t("crmCancellations.pendDev"), cls: "bg-warning/15 text-warning border-warning/20" },
    devuelta_economicamente: { label: t("crmCancellations.devuelta"), cls: "bg-success/15 text-success border-success/20" },
    pendiente_bono: { label: t("crmCancellations.pendBono"), cls: "bg-primary/15 text-primary border-primary/20" },
    compensada_bono: { label: t("crmCancellations.bonoEnviado"), cls: "bg-primary/15 text-primary border-primary/20" },
    incidencia_economica: { label: t("crmCancellations.incidEc"), cls: "bg-danger/15 text-danger border-danger/20" },
  };
  const s = map[status] ?? { label: status, cls: "bg-foreground/[0.05] text-foreground/50 border-foreground/[0.12]" };
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${s.cls}`}>{s.label}</span>;
}

/** Canal de venta: tono semántico + icono propio (el icono distingue canales que comparten tono). */
export const CHANNEL_META: Record<string, { tone: string; Icon: React.ComponentType<{ className?: string }> }> = {
  TPV_FISICO: { tone: "text-primary bg-primary/15 border-primary/30", Icon: Store },
  VENTA_DELEGADA: { tone: "text-foreground/80 bg-foreground/[0.07] border-foreground/20", Icon: Users },
  ONLINE_DIRECTO: { tone: "text-info bg-info/15 border-info/30", Icon: Globe },
  ONLINE_ASISTIDO: { tone: "text-success bg-success/15 border-success/30", Icon: Users },
  TELEFONO: { tone: "text-warning bg-warning/15 border-warning/30", Icon: Phone },
  EMAIL: { tone: "text-info bg-info/15 border-info/30", Icon: Mail },
  PARTNER: { tone: "text-primary bg-primary/15 border-primary/30", Icon: Handshake },
  TICKETING: { tone: "text-danger bg-danger/15 border-danger/30", Icon: Ticket },
};

export const CHANNEL_FALLBACK = "text-foreground/50 bg-foreground/[0.05] border-foreground/[0.12]";

// ─── PRODUCT SEARCH COMBOBOX ─────────────────────────────────────────────────
export function ProductSearchInput({
  value,
  onChange,
  onSelect,
}: {
  value: string;
  onChange: (v: string) => void;
  onSelect: (product: CatalogProduct) => void;
}) {
  return (
    <CatalogConceptSelector
      value={value}
      onChange={onChange}
      onSelectProduct={onSelect}
      inputClassName="bg-foreground/[0.05] border-foreground/[0.12] text-foreground placeholder:text-foreground/40 text-sm"
      showBadge={false}
    />
  );
}

/**
 * Celda de régimen fiscal de una línea de presupuesto.
 * Regla de negocio: el régimen es la fuente de verdad del PRODUCTO.
 *  - Línea con productId → el régimen se MUESTRA, no se edita (badge).
 *  - Línea manual (sin productId) → selector editable con 3 opciones.
 * El PVP se entiende siempre como precio final con impuestos incluidos.
 */
export type QuoteLineItem = {
  description: string; quantity: number; unitPrice: number; total: number;
  fiscalRegime?: "reav" | "general"; taxRate?: number; productId?: number;
};

export function regimeLabel(item: { fiscalRegime?: string; taxRate?: number }): string {
  if (item.fiscalRegime === "reav") return "REAV";
  return (item as any).taxRate === 10 ? "IVA 10%" : "IVA 21%";
}

export function RegimeCell({ item, onChange }: {
  item: QuoteLineItem;
  onChange: (fiscalRegime: "reav" | "general", taxRate: number) => void;
}) {
  const { t } = useI18n();
  const voc = useVocabulary();
  const isProduct = item.productId != null;
  const isReav = item.fiscalRegime === "reav";
  if (isProduct) {
    return (
      <div className="col-span-2 flex items-center justify-center"
        title={t("crmLeads.regimenFiscalHeredadoDel")}>
        <span className={`text-xs font-semibold px-2 py-1 rounded-md border whitespace-nowrap ${
          isReav ? "bg-warning/15 text-warning border-warning/30"
                 : "bg-foreground/[0.06] text-foreground/70 border-foreground/[0.12]"}`}>
          {regimeLabel(item)}
        </span>
      </div>
    );
  }
  return (
    <select
      className="col-span-2 bg-foreground/[0.05] border border-warning/30 text-foreground text-xs rounded-md px-1 py-1.5 h-9"
      title={t("crmLeads.lineaManualElRegimen")}
      value={isReav ? "reav" : ((item as any).taxRate === 10 ? "general_10" : "general")}
      onChange={(e) => {
        const v = e.target.value;
        if (v === "reav") onChange("reav", 0);
        else if (v === "general_10") onChange("general", 10);
        else onChange("general", 21);
      }}
    >
      <option value="general" className="bg-popover">{t("crmLeads.iva21Manual")}</option>
      <option value="general_10" className="bg-popover">{t("crmLeads.iva10Manual")}</option>
      {(voc.showReav || isReav) && <option value="reav" className="bg-popover">{t("crmLeads.reavManual")}</option>}
    </select>
  );
}

// ─── QUOTE EDIT MODAL ────────────────────────────────────────────────────────

// ─── PRODUCT AUTOCOMPLETE FIELD ─────────────────────────────────────────────
export function ProductAutocompleteInput({
  value,
  onChange,
  onSelect,
  placeholder = "Descripción o busca un producto...",
}: {
  value: string;
  onChange: (v: string) => void;
  onSelect: (product: { title: string; unitPrice: number; fiscalRegime: "reav" | "general" }) => void;
  placeholder?: string;
}) {
  const { t, format } = useI18n();
  const voc = useVocabulary();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(value);
  const containerRef = useRef<HTMLDivElement>(null);

  // Sincronizar query cuando value cambia externamente
  useEffect(() => { setQuery(value); }, [value]);

  const { data, isFetching } = trpc.crm.catalog.search.useQuery(
    { q: query },
    { enabled: open && query.trim().length >= 1, staleTime: 2000 }
  );

  const results = data?.results ?? [];

  // Cerrar al hacer clic fuera
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const TYPE_LABELS: Record<string, string> = voc.licensed
    ? { experience: "Producto", pack: "Paquete", legopack: "Paquete" }
    : { experience: "Actividad", pack: "Pack", legopack: t("crmQuotes.legoPack") };
  const TYPE_COLORS: Record<string, string> = {
    experience: "text-info",
    pack: "text-success",
    legopack: "text-primary",
  };

  return (
    <div ref={containerRef} className="relative col-span-4">
      <Input
        className="w-full bg-foreground/[0.05] border-foreground/[0.12] text-foreground placeholder:text-foreground/40 text-sm"
        placeholder={placeholder}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          onChange(e.target.value);
          setOpen(e.target.value.trim().length >= 1);
        }}
        onFocus={() => { if (query.trim().length >= 1) setOpen(true); }}
      />
      {open && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-popover border border-border rounded-lg shadow-lg overflow-hidden">
          {isFetching && (
            <div className="flex items-center gap-2 px-3 py-2 text-xs text-foreground/50">
              <RefreshCw className="w-3 h-3 animate-spin" />{" "}{t("crmQuotes.buscando")}</div>
          )}
          {!isFetching && results.length === 0 && (
            <div className="px-3 py-2 text-xs text-foreground/40">{t("crmQuotes.sinResultadosPara", { query })}</div>
          )}
          {results.map((r) => (
            <button
              key={`${r.type}-${r.id}`}
              type="button"
              className="w-full flex items-center justify-between gap-2 px-3 py-2 hover:bg-foreground/[0.08] transition-colors text-left group"
              onMouseDown={(e) => {
                e.preventDefault();
                setQuery(r.title);
                onChange(r.title);
                onSelect({ title: r.title, unitPrice: r.unitPrice, fiscalRegime: r.fiscalRegime });
                setOpen(false);
              }}
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className={`text-xs font-semibold shrink-0 ${TYPE_COLORS[r.type] ?? "text-foreground/50"}`}>
                  {TYPE_LABELS[r.type] ?? r.type}
                </span>
                <span className="text-sm text-foreground overflow-hidden text-ellipsis whitespace-nowrap group-hover:text-warning transition-colors">{r.title}</span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {r.fiscalRegime === "reav" && (
                  <span className="text-xs text-warning font-semibold">{t("crmQuotes.reav")}</span>
                )}
                <span className="text-sm font-semibold text-warning">{format.currency(r.unitPrice, "EUR", EUR2)}</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── SCHEDULED JOBS MINI ─────────────────────────────────────────────────────
export function ScheduledJobsMini({ entityType, entityId }: { entityType: string; entityId: number }) {
  const { t, format } = useI18n();
  const utils = trpc.useUtils();
  const { data, isLoading, isError } = trpc.emailCommunications.listScheduledJobs.useQuery(
    { relatedEntityType: entityType, relatedEntityId: entityId, limit: 20 },
    { retry: 1 }
  );
  const cancelJob = trpc.emailCommunications.cancelJob.useMutation({
    onSuccess: () => {
      toast.success(t("crmQuotes.jobCancelado"));
      utils.emailCommunications.listScheduledJobs.invalidate({ relatedEntityType: entityType, relatedEntityId: entityId });
    },
    onError: (e) => toast.error(errorToastMessage(e)),
  });

  const rows = data?.rows ?? [];
  const pending = rows.filter(r => r.status === "pending");
  const rest = rows.filter(r => r.status !== "pending");

  const STATUS_STYLE: Record<string, { label: string; color: string }> = {
    pending:   { label: t("crmQuotes.pendiente"),  color: "text-warning" },
    sent:      { label: t("crmQuotes.enviado"),    color: "text-success" },
    skipped:   { label: t("crmQuotes.saltado"),    color: "text-gray-500"  },
    failed:    { label: t("crmQuotes.fallido"),    color: "text-danger"   },
    cancelled: { label: t("crmQuotes.cancelado"),  color: "text-zinc-600"  },
  };

  if (isLoading) return <div className="text-xs text-foreground/40 py-2">{t("crmQuotes.cargandoEmailsProgramados")}</div>;
  if (isError) return null;
  if (!rows.length) return (
    <div className="text-xs text-foreground/35 py-1">{t("crmQuotes.sinEmailsAutomaticosProgramado")}</div>
  );

  function fmtDate(d: Date | string | null | undefined) {
    if (!d) return "—";
    const date = new Date(d);
    const diff = date.getTime() - Date.now();
    const abs = Math.abs(diff);
    const h = Math.floor(abs / 3600000);
    const m = Math.floor((abs % 3600000) / 60000);
    const rel = diff > 0
      ? `en ${h > 24 ? `${Math.floor(h / 24)}d` : h > 0 ? t("crmQuotes.hM", { h, m }) : `${m}m`}`
      : `hace ${h > 24 ? `${Math.floor(h / 24)}d` : h > 0 ? `${h}h` : `${m}m`}`;
    return `${format.date(date, { day: "2-digit", month: "2-digit" })} ${format.time(date, { hour: "2-digit", minute: "2-digit" })} (${rel})`;
  }

  return (
    <div className="space-y-1.5">
      {pending.length > 0 && (
        <div className="space-y-1">
          {pending.map(job => (
            <div key={job.id} className="flex items-center justify-between bg-warning/20 border border-warning/25 rounded-lg px-3 py-2 gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-warning font-medium">{t("crmQuotes.pendiente")}</span>
                  <span className="text-xs text-foreground/50 font-mono">{job.templateKey}</span>
                </div>
                <div className="text-xs text-foreground/40 mt-0.5">{fmtDate(job.scheduledFor)}</div>
                {job.recipientEmail && <div className="text-xs text-foreground/35 overflow-hidden text-ellipsis whitespace-nowrap">{job.recipientEmail}</div>}
              </div>
              <button
                onClick={() => cancelJob.mutate({ id: job.id })}
                disabled={cancelJob.isPending}
                className="text-xs text-danger hover:text-danger shrink-0 px-2 py-1 rounded hover:bg-foreground/[0.06] transition-colors"
              >{t("crmQuotes.cancelar")}</button>
            </div>
          ))}
        </div>
      )}
      {rest.length > 0 && (
        <div className="space-y-1">
          {rest.map(job => {
            const s = STATUS_STYLE[job.status] ?? STATUS_STYLE.skipped;
            return (
              <div key={job.id} className="flex items-center justify-between bg-foreground/[0.03] border border-foreground/[0.07] rounded-lg px-3 py-1.5 gap-3">
                <div className="min-w-0 flex items-center gap-2">
                  <span className={`text-xs ${s.color}`}>{s.label}</span>
                  <span className="text-xs text-foreground/40 font-mono overflow-hidden text-ellipsis whitespace-nowrap">{job.templateKey}</span>
                  {job.skipReason && <span className="text-xs text-foreground/30">({job.skipReason})</span>}
                </div>
                <div className="text-xs text-foreground/30 shrink-0">{fmtDate(job.scheduledFor)}</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Estado de tabla: carga, error recuperable o vacío con acción ─────────────
export function CrmTableState({
  colSpan, loading, error, onRetry, filtered, emptyTitle, emptyHint, actionLabel, onAction, onClearFilters,
}: {
  colSpan: number;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  filtered: boolean;
  emptyTitle: string;
  emptyHint?: string;
  actionLabel?: string;
  onAction?: () => void;
  onClearFilters?: () => void;
}) {
  const { t } = useI18n();
  if (loading) {
    return (
      <tr><td colSpan={colSpan} className="text-center py-12 text-foreground/60" role="status">
        <RefreshCw className="w-5 h-5 animate-spin mx-auto" aria-hidden="true" />
        <span className="sr-only">{t("crmShared.cargando")}</span>
      </td></tr>
    );
  }
  if (error) {
    return (
      <tr><td colSpan={colSpan} className="text-center py-12 px-4">
        <div role="alert" className="flex flex-col items-center gap-3">
          <AlertCircle className="w-6 h-6 text-danger" aria-hidden="true" />
          <p className="text-sm text-foreground/80">{errorMessage(error)}</p>
          <Button size="sm" variant="outline" onClick={onRetry}>
            <RefreshCw className="w-4 h-4 mr-1.5" aria-hidden="true" />{" "}{t("crmShared.reintentar")}</Button>
        </div>
      </td></tr>
    );
  }
  return (
    <tr><td colSpan={colSpan} className="text-center py-12 px-4">
      <div className="flex flex-col items-center gap-2">
        <p className="text-sm font-medium text-foreground/80">{filtered ? t("crmShared.ningunResultadoConEstos") : emptyTitle}</p>
        {!filtered && emptyHint && <p className="text-xs text-foreground/60 max-w-md">{emptyHint}</p>}
        {filtered && onClearFilters ? (
          <Button size="sm" variant="outline" className="mt-2" onClick={onClearFilters}>{t("crmShared.quitarFiltros")}</Button>
        ) : !filtered && actionLabel && onAction ? (
          <Button size="sm" className="mt-2" onClick={onAction}>
            <Plus className="w-4 h-4 mr-1.5" aria-hidden="true" /> {actionLabel}
          </Button>
        ) : null}
      </div>
    </td></tr>
  );
}