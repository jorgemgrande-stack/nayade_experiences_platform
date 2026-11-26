/**
 * «Agente IA (Vapi)»: llamadas del asistente de voz. Cabecera con acciones, indicadores (el de «sin revisar» filtra),
 * tabla compacta (tarjetas en móvil), ficha de la llamada en diálogo y panel de conexión con Vapi. Las consultas y
 * acciones son las de siempre; las piezas visuales están en VapiAgenteParts.tsx.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Link } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { VOICE_SETUP_PATH } from "@shared/voiceSetup";
import AdminLayout from "@/components/AdminLayout";
import { toast } from "sonner";
import { BarChart3, Bot, CheckCircle2, Eye, Phone, PhoneCall, PhoneMissed, RefreshCw, Rocket, Search, Settings, UserPlus } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PanelPageHeader, type PanelColumn } from "@/components/admin/PanelUi";
import { PanelEmpty, PanelError, PanelLoading } from "@/components/admin/PanelStates";
import { MetricCard } from "@/components/admin/PanelVisual";
import { ResponsiveList } from "./ResponsiveList";
import { CallDialog, CallStatus, VapiConfigPanel, callIdentity, useCallFormat } from "./VapiAgenteParts";

export default function VapiAgente() {
  const { t } = useI18n();
  const fmt = useCallFormat();
  const utils = trpc.useUtils();
  const [search, setSearch] = useState("");
  const [onlyUnreviewed, setOnlyUnreviewed] = useState(false);
  const [selectedCallId, setSelectedCallId] = useState<number | null>(null);
  const [page, setPage] = useState(0);
  const [showConfig, setShowConfig] = useState(false);
  const [credApiKey, setCredApiKey] = useState("");
  const [credSecret, setCredSecret] = useState("");
  const [credsSaved, setCredsSaved] = useState(false);
  const PAGE_SIZE = 50;
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const { data: stats } = trpc.vapiCalls.getStats.useQuery(undefined, { refetchInterval: 60000 });
  const { data: creds, refetch: refetchCreds } = trpc.vapiCalls.getCredentials.useQuery();

  const { data: callsData, isLoading: callsLoading, isError, error, refetch } =
    trpc.vapiCalls.listCalls.useQuery({
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
      search: search || undefined,
      onlyUnreviewed,
    }, { refetchInterval: 60000 });

  const sync = trpc.vapiCalls.syncCalls.useMutation({
    onSuccess: (data) => {
      toast.success(t("vapiAgente.syncDone", { inserted: data.inserted, updated: data.updated }));
      utils.vapiCalls.listCalls.invalidate();
      utils.vapiCalls.getStats.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const saveCreds = trpc.vapiCalls.saveCredentials.useMutation({
    onSuccess: () => {
      toast.success(t("vapiAgente.cfg.saved"));
      setCredApiKey("");
      setCredSecret("");
      setCredsSaved(true);
      refetchCreds();
      utils.vapiCalls.getStats.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const webhookUrl = `${window.location.origin}/api/vapi/webhook`;
  const calls = callsData?.rows ?? [];
  const total = callsData?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  type CallRow = (typeof calls)[number];
  const viewBtn = (c: CallRow) => (
    <Button size="sm" variant="ghost" className="h-8 gap-1 px-2 text-xs" onClick={() => setSelectedCallId(c.id)} aria-label={t("vapiAgente.viewCall", { who: callIdentity(c).name === "—" ? fmt.phone(c.phoneNumber) : callIdentity(c).name })}>
      <Eye className="h-3.5 w-3.5" aria-hidden="true" />{t("vapiAgente.view")}
    </Button>
  );
  const reviewedLine = (c: CallRow) => c.reviewed
    ? <span className="inline-flex items-center gap-1 text-xs text-success"><CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />{t("vapiAgente.reviewedYes")}</span>
    : <span className="text-xs text-warning">{t("vapiAgente.reviewedNo")}</span>;
  const summaryOf = (c: CallRow) => c.summary?.slice(0, 90) ?? (c.endedReason ? `(${c.endedReason})` : "—");
  const columns: PanelColumn<CallRow>[] = [
    { key: "date", header: t("vapiAgente.col.date"), cell: (c) => <span className="block whitespace-nowrap text-xs">{fmt.dateTime(c.startedAt)}<span className="block text-muted-foreground">{fmt.duration(c.durationSeconds)}</span></span> },
    {
      key: "contact",
      header: `${t("vapiAgente.col.name")} · ${t("vapiAgente.col.summary")}`,
      cell: (c) => (
        <span className="block max-w-[300px]">
          <span className="block overflow-hidden text-ellipsis whitespace-nowrap font-medium">{callIdentity(c).name}</span>
          <span className="block overflow-hidden text-ellipsis whitespace-nowrap text-xs text-muted-foreground">{callIdentity(c).email}</span>
          <span className="block overflow-hidden text-ellipsis whitespace-nowrap text-xs text-muted-foreground">{summaryOf(c)}</span>
        </span>
      ),
    },
    { key: "phone", header: t("vapiAgente.col.phone"), cell: (c) => <span className="whitespace-nowrap font-medium">{fmt.phone(c.phoneNumber)}</span> },
    { key: "status", header: t("vapiAgente.col.status"), cell: (c) => <span className="flex flex-col items-start gap-1"><CallStatus status={c.status} />{reviewedLine(c)}</span> },
    { key: "actions", header: <span className="sr-only">{t("vapiAgente.view")}</span>, align: "right", cell: viewBtn },
  ];
  const callCard = (c: CallRow) => (
    <div className="space-y-1.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="overflow-hidden text-ellipsis whitespace-nowrap font-medium text-foreground">{callIdentity(c).name}</p>
          <p className="text-xs text-muted-foreground">{fmt.dateTime(c.startedAt)} · {fmt.duration(c.durationSeconds)}</p>
        </div>
        <CallStatus status={c.status} />
      </div>
      <p className="break-words text-xs text-muted-foreground">{fmt.phone(c.phoneNumber)} · {callIdentity(c).email}</p>
      <p className="line-clamp-2 text-xs text-muted-foreground">{summaryOf(c)}</p>
      <div className="flex items-center justify-between">{reviewedLine(c)}{viewBtn(c)}</div>
    </div>
  );

  return (
    <AdminLayout>
      <div className="mx-auto max-w-7xl space-y-5 p-4 sm:p-6">
        <PanelPageHeader
          className="mb-0"
          icon={<Bot />}
          title={t("vapiAgente.title")}
          description={t("vapiAgente.subtitle")}
          actions={
            <>
              {/* Asistente de alta de Vapi (solo administración; el servidor lo vuelve a comprobar) */}
              {isAdmin && (
                <Link href={VOICE_SETUP_PATH}>
                  <Button size="sm" variant="outline" className="gap-1.5"><Rocket className="h-3.5 w-3.5" aria-hidden="true" />{t("vapiAgente.setup")}</Button>
                </Link>
              )}
              <Button size="sm" variant="outline" onClick={() => sync.mutate({ limit: 100 })} disabled={sync.isPending || !creds?.hasApiKey} title={!creds?.hasApiKey ? t("vapiAgente.syncNeedsKey") : undefined} className="gap-1.5">
                <RefreshCw className={`h-3.5 w-3.5 ${sync.isPending ? "animate-spin" : ""}`} aria-hidden="true" />
                {sync.isPending ? t("vapiAgente.syncing") : t("vapiAgente.sync")}
              </Button>
              <Button size="sm" variant={showConfig ? "default" : "outline"} onClick={() => setShowConfig((v) => !v)} aria-expanded={showConfig} className="gap-1.5">
                <Settings className="h-3.5 w-3.5" aria-hidden="true" />{t("vapiAgente.config")}
              </Button>
            </>
          }
        />

        {showConfig && (
          <VapiConfigPanel
            hasApiKey={!!creds?.hasApiKey}
            apiKeyMasked={creds?.apiKeyMasked}
            hasSecret={!!creds?.webhookSecret}
            saving={saveCreds.isPending}
            saved={credsSaved}
            apiKey={credApiKey}
            secret={credSecret}
            onApiKey={(v) => { setCredApiKey(v); setCredsSaved(false); }}
            onSecret={(v) => { setCredSecret(v); setCredsSaved(false); }}
            webhookUrl={webhookUrl}
            onSave={() => {
              if (!credApiKey && !creds?.hasApiKey) {
                toast.error(t("vapiAgente.cfg.required"));
                return;
              }
              saveCreds.mutate({ apiKey: credApiKey, webhookSecret: credSecret });
            }}
          />
        )}

        <div role="group" aria-label={t("vapiAgente.kpi.group")} className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <MetricCard compact tone="info" icon={<Phone />} label={t("vapiAgente.kpi.today")} value={stats?.today ?? 0} />
          <MetricCard compact tone="brand" icon={<BarChart3 />} label={t("vapiAgente.kpi.last7")} value={stats?.last7 ?? 0} />
          <MetricCard compact tone="success" icon={<PhoneCall />} label={t("vapiAgente.kpi.ended")} value={stats?.ended ?? 0} />
          <MetricCard compact tone="danger" icon={<PhoneMissed />} label={t("vapiAgente.kpi.failed")} value={stats?.failed ?? 0} />
          <MetricCard
            compact
            tone="warning"
            icon={<Eye />}
            label={t("vapiAgente.kpi.unreviewed")}
            value={stats?.unreviewed ?? 0}
            detail={t("vapiAgente.kpi.unreviewedHint")}
            active={onlyUnreviewed}
            onClick={() => { setOnlyUnreviewed((v) => !v); setPage(0); }}
          />
          <MetricCard compact tone="brand" icon={<UserPlus />} label={t("vapiAgente.kpi.leads")} value={stats?.withLead ?? 0} />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-[200px] max-w-sm flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              placeholder={t("vapiAgente.filters.search")}
              aria-label={t("vapiAgente.filters.search")}
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(0); }}
              autoComplete="off"
              name="vapi-search"
              className="h-9 pl-8 text-sm"
            />
          </div>
          <label className="flex cursor-pointer select-none items-center gap-2 text-sm text-foreground">
            <input type="checkbox" checked={onlyUnreviewed} onChange={(e) => { setOnlyUnreviewed(e.target.checked); setPage(0); }} className="accent-primary" />
            {t("vapiAgente.filters.onlyUnreviewed")}
          </label>
          <span className="ml-auto text-xs text-muted-foreground">{t("vapiAgente.filters.count", { n: total })}</span>
        </div>

        {callsLoading ? (
          <PanelLoading />
        ) : isError ? (
          <PanelError title={t("vapiAgente.errorTitle")} error={error} onRetry={() => refetch()} />
        ) : calls.length === 0 ? (
          <PanelEmpty
            icon={<Phone className="h-5 w-5" />}
            title={search || onlyUnreviewed ? t("vapiAgente.emptyFiltered") : t("vapiAgente.emptyTitle")}
            description={search || onlyUnreviewed ? undefined : t("vapiAgente.emptyHint")}
          />
        ) : (
          <ResponsiveList rows={calls} columns={columns} rowKey={(c) => c.id} caption={t("vapiAgente.table")} card={callCard} />
        )}

        {totalPages > 1 && (
          <div className="flex items-center justify-between">
            <Button size="sm" variant="ghost" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0}>{t("vapiAgente.prev")}</Button>
            <span className="text-xs text-muted-foreground">{t("vapiAgente.page", { page: page + 1, pages: totalPages })}</span>
            <Button size="sm" variant="ghost" onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}>{t("vapiAgente.next")}</Button>
          </div>
        )}
      </div>

      {selectedCallId !== null && (
        <CallDialog
          callId={selectedCallId}
          onClose={() => setSelectedCallId(null)}
          onLeadCreated={() => {
            utils.vapiCalls.listCalls.invalidate();
            utils.vapiCalls.getStats.invalidate();
          }}
          onReviewed={() => {
            utils.vapiCalls.listCalls.invalidate();
          }}
        />
      )}
    </AdminLayout>
  );
}
