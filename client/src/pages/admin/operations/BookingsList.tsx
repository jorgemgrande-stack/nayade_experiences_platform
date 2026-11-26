import { useState } from "react";
import { confirmAction } from "@/components/admin/ConfirmHost";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Search, CalendarDays, Users, CheckCircle, XCircle, Clock, PlayCircle, CreditCard, ArrowUpDown, Banknote, HelpCircle, ExternalLink } from "lucide-react";
import { Link } from "wouter";
import { PanelDataList, PanelPageHeader, StatusBadge, type PanelColumn, type Tone } from "@/components/admin/PanelUi";
import { MetricCard, SegmentedTabs } from "@/components/admin/PanelVisual";
import { PanelEmpty, PanelError, PanelLoading } from "@/components/admin/PanelStates";
import { toastError } from "@/lib/errorMessage";
import { useI18n } from "@/i18n/I18nProvider";

const statusConfig: Record<string, { label: string; tone: Tone; icon: React.ReactNode }> = {
  pendiente:  { label: "opsBookings.status.pendiente",  tone: "warning", icon: <Clock className="w-3 h-3" /> },
  confirmado: { label: "opsBookings.status.confirmado", tone: "info",    icon: <CheckCircle className="w-3 h-3" /> },
  en_curso:   { label: "opsBookings.status.en_curso",   tone: "success", icon: <PlayCircle className="w-3 h-3" /> },
  completado: { label: "opsBookings.status.completado", tone: "neutral", icon: <CheckCircle className="w-3 h-3" /> },
  cancelado:  { label: "opsBookings.status.cancelado",  tone: "danger",  icon: <XCircle className="w-3 h-3" /> },
};

const sourceConfig: Record<string, { label: string; tone: Tone; icon: React.ReactNode; crmTab: string }> = {
  tarjeta_fisica: { label: "opsBookings.source.tarjeta_fisica",   tone: "brand",   icon: <CreditCard className="w-3 h-3" />,  crmTab: "reservations" },
  tarjeta_redsys: { label: "opsBookings.source.tarjeta_redsys",   tone: "brand",   icon: <CreditCard className="w-3 h-3" />,  crmTab: "reservations" },
  redsys:         { label: "opsBookings.source.tarjeta_redsys",   tone: "brand",   icon: <CreditCard className="w-3 h-3" />,  crmTab: "reservations" },
  transferencia:  { label: "opsBookings.source.transferencia",     tone: "info",    icon: <ArrowUpDown className="w-3 h-3" />, crmTab: "reservations" },
  efectivo:       { label: "opsBookings.source.efectivo",          tone: "success", icon: <Banknote className="w-3 h-3" />,  crmTab: "reservations" },
  otro:           { label: "opsBookings.source.otro",              tone: "neutral", icon: <HelpCircle className="w-3 h-3" />, crmTab: "reservations" },
};

export default function BookingsList() {
  const { t, format: f } = useI18n();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const utils = trpc.useUtils();

  const { data: bookings, isLoading, isError, error, refetch } = trpc.bookings.getAll.useQuery({
    status: statusFilter === "all" ? undefined : statusFilter,
    limit: 100,
    offset: 0,
  });

  const updateStatus = trpc.bookings.updateStatus.useMutation({
    onSuccess: () => { utils.bookings.getAll.invalidate(); toast.success(t("opsBookings.statusUpdated")); },
    onError: (e) => toastError(e),
  });

  const filtered = bookings?.filter(b =>
    b.clientName.toLowerCase().includes(search.toLowerCase()) ||
    (b.clientEmail ?? '').toLowerCase().includes(search.toLowerCase()) ||
    (b.bookingNumber ?? '').toLowerCase().includes(search.toLowerCase())
  ) ?? [];

  const columns: PanelColumn<any>[] = [
    { key: "number", header: t("opsBookings.col.number"), cell: (b) => <span className="whitespace-nowrap font-mono text-sm font-semibold text-foreground">{b.bookingNumber}</span> },
    {
      key: "client", header: t("opsBookings.col.client"),
      cell: (b) => (
        <div className="min-w-0">
          <span className="block font-medium text-foreground">{b.clientName}</span>
          {b.clientEmail && <span className="block break-all text-xs text-muted-foreground">{b.clientEmail}</span>}
        </div>
      ),
    },
    {
      key: "date", header: t("opsBookings.col.date"),
      cell: (b) => (
        <div className="whitespace-nowrap text-foreground">
          <span className="inline-flex items-center gap-1.5">
            <CalendarDays className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
            {f.date(b.scheduledDate, { day: "2-digit", month: "short", year: "numeric" })}
          </span>
          <span className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground max-md:justify-end">
            <Users className="h-3.5 w-3.5" aria-hidden="true" />
            {b.numberOfPersons} {t("opsBookings.col.persons").toLowerCase()}
          </span>
        </div>
      ),
    },
    { key: "total", header: t("opsBookings.col.total"), align: "right", cell: (b) => <span className="font-semibold tabular-nums text-foreground">{f.currency(parseFloat(b.totalAmount))}</span> },
    {
      key: "state", header: t("opsBookings.col.state"),
      cell: (b) => {
        const st = statusConfig[b.status] ?? statusConfig.pendiente;
        const src = sourceConfig[b.sourceChannel ?? ""] ?? null;
        return (
          <div className="flex flex-col items-start gap-1 max-md:items-end">
            <StatusBadge tone={st.tone} icon={st.icon}>{t(st.label)}</StatusBadge>
            {src ? <StatusBadge tone={src.tone} icon={src.icon}>{t(src.label)}</StatusBadge> : <span className="text-xs text-muted-foreground">{t("opsBookings.manual")}</span>}
          </div>
        );
      },
    },
    {
      key: "actions", header: <span className="sr-only">{t("opsBookings.col.actions")}</span>, align: "right",
      cell: (b) => {
        const crmLink = b.reservationId ? "/admin/crm?tab=reservations" : b.quoteId ? "/admin/crm?tab=quotes" : null;
        return (
          <div className="flex flex-wrap items-center justify-end gap-1.5">
            {crmLink && (
              <Link href={crmLink}>
                <Button size="sm" variant="ghost" className="h-8 gap-1 text-xs text-muted-foreground hover:text-foreground">
                  <ExternalLink className="h-3 w-3" aria-hidden="true" /> CRM
                </Button>
              </Link>
            )}
            {b.status === "pendiente" && (
              <Button size="sm" variant="outline" className="h-8 text-xs" disabled={updateStatus.isPending}
                onClick={() => updateStatus.mutate({ id: b.id, status: "confirmado" })}>
                {t("opsBookings.confirm")}
              </Button>
            )}
            {b.status === "confirmado" && (
              <Button size="sm" variant="outline" className="h-8 border-success/40 text-xs text-success hover:bg-success/10" disabled={updateStatus.isPending}
                onClick={() => updateStatus.mutate({ id: b.id, status: "completado" })}>
                {t("opsBookings.complete")}
              </Button>
            )}
            {(b.status === "pendiente" || b.status === "confirmado") && (
              <Button size="sm" variant="ghost" className="h-8 text-xs text-destructive hover:bg-destructive/10" disabled={updateStatus.isPending}
                onClick={async () => { if ((await confirmAction({ description: t("opsBookings.cancelConfirm"), destructive: true, confirmLabel: t("opsBookings.cancel") }))) updateStatus.mutate({ id: b.id, status: "cancelado" }); }}>
                {t("opsBookings.cancel")}
              </Button>
            )}
          </div>
        );
      },
    },
  ];

  const statusOptions = ["all", "pendiente", "confirmado", "en_curso", "completado", "cancelado"].map((v) => ({
    value: v, label: v === "all" ? t("opsBookings.all") : t(`opsBookings.status.${v}`),
  }));
  const hasFilters = search.trim() !== "" || statusFilter !== "all";

  return (
    <AdminLayout title={t("opsBookings.title")}>
      <PanelPageHeader icon={<CalendarDays />} title={t("opsBookings.heading")} description={t("opsBookings.count", { n: filtered.length })} />

      {filtered.length > 0 && (
        <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <MetricCard tone="brand" icon={<CalendarDays />} label={t("opsBookings.summaryCount")} value={filtered.length} className="bg-gradient-to-br from-primary/5 to-card" />
          <MetricCard tone="info" icon={<Users />} label={t("opsBookings.col.persons")} value={filtered.reduce((n, b) => n + (b.numberOfPersons ?? 0), 0)} className="bg-gradient-to-br from-primary/5 to-card" />
          <MetricCard tone="success" icon={<Banknote />} label={t("opsBookings.col.total")} value={f.currency(filtered.reduce((n, b) => n + (parseFloat(b.totalAmount) || 0), 0))} className="bg-gradient-to-br from-primary/5 to-card" />
        </div>
      )}

      <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative min-w-0 flex-1 lg:max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("opsBookings.searchPlaceholder")} aria-label={t("opsBookings.searchPlaceholder")} className="h-10 pl-9" />
        </div>
        <SegmentedTabs label={t("opsBookings.statusPlaceholder")} value={statusFilter} onChange={setStatusFilter} options={statusOptions} />
      </div>

      {isLoading ? (
        <PanelLoading />
      ) : isError ? (
        <PanelError error={error} onRetry={() => refetch()} title={t("opsBookings.loadError")} />
      ) : filtered.length === 0 ? (
        <PanelEmpty icon={<CalendarDays />} title={hasFilters ? t("opsBookings.noMatchTitle") : t("opsBookings.emptyTitle")} description={hasFilters ? t("opsBookings.noMatchText") : t("opsBookings.emptyText")}>
          {hasFilters && <Button size="sm" variant="outline" onClick={() => { setSearch(""); setStatusFilter("all"); }}>{t("opsBookings.clearFilters")}</Button>}
        </PanelEmpty>
      ) : (
        <PanelDataList rows={filtered} columns={columns} rowKey={(b) => b.id} caption={t("opsBookings.heading")} />
      )}
    </AdminLayout>
  );
}
