import { useState } from "react";
import { confirmAction } from "@/components/admin/ConfirmHost";
import { trpc } from "@/lib/trpc";
import AdminLayout from "@/components/AdminLayout";
import { useI18n } from "@/i18n/I18nProvider";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { PanelEmpty, PanelError, PanelLoading } from "@/components/admin/PanelStates";
import { PanelPageHeader, StatusBadge, type Tone } from "@/components/admin/PanelUi";
import { MetricCard } from "@/components/admin/PanelVisual";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Star,
  CheckCircle2,
  XCircle,
  Trash2,
  MessageSquare,
  Hotel,
  Sparkles,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  ThumbsUp,
  Clock,
} from "lucide-react";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function StarDisplay({ rating }: { rating: number }) {
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((s) => (
        <Star
          key={s}
          className={`w-3.5 h-3.5 ${
            s <= rating
              ? "fill-warning text-warning"
              : "fill-transparent text-muted-foreground/40"
          }`}
        />
      ))}
    </div>
  );
}

function ReviewStatusBadge({ status }: { status: string }) {
  const { t } = useI18n();
  const map: Record<string, { label: string; tone: Tone }> = {
    pending: { label: t("reviewsAdmin.status.pending"), tone: "warning" },
    approved: { label: t("reviewsAdmin.status.approved"), tone: "success" },
    rejected: { label: t("reviewsAdmin.status.rejected"), tone: "danger" },
  };
  const cfg = map[status] ?? map.pending;
  return <StatusBadge tone={cfg.tone}>{cfg.label}</StatusBadge>;
}

// ─── Modal de respuesta ───────────────────────────────────────────────────────

function ReplyModal({
  reviewId,
  existingReply,
  onClose,
  onSaved,
}: {
  reviewId: number;
  existingReply: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useI18n();
  const [reply, setReply] = useState(existingReply ?? "");
  const replyMutation = trpc.reviews.adminReply.useMutation({
    onSuccess: () => {
      onSaved();
      onClose();
    },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-card rounded-xl shadow-md w-full max-w-lg">
        <div className="flex items-center justify-between p-5 border-b">
          <h3 className="font-bold text-foreground">{t("reviewsAdmin.reply.title")}</h3>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground"
          >
            ✕
          </button>
        </div>
        <div className="p-5 space-y-3">
          <Label className="text-sm text-muted-foreground">
            {t("reviewsAdmin.reply.label")}
          </Label>
          <Textarea
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            placeholder={t("reviewsAdmin.reply.placeholder")}
            className="min-h-[120px] resize-none"
            maxLength={1000}
          />
          <p className="text-xs text-muted-foreground text-right">{reply.length}/1000</p>
        </div>
        <div className="flex justify-end gap-2 p-5 border-t">
          <Button variant="ghost" onClick={onClose}>
            {t("reviewsAdmin.reply.cancel")}
          </Button>
          <Button
            onClick={() => replyMutation.mutate({ id: reviewId, reply })}
            disabled={!reply.trim() || replyMutation.isPending}
            className="bg-primary hover:bg-primary/90 text-primary-foreground"
          >
            {replyMutation.isPending ? t("reviewsAdmin.reply.saving") : t("reviewsAdmin.reply.publish")}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Componente principal ─────────────────────────────────────────────────────

export default function ReviewsManager() {
  const utils = trpc.useUtils();
  const { t, format } = useI18n();
  const [filterType, setFilterType] = useState<"all" | "hotel" | "spa">("all");
  const [filterStatus, setFilterStatus] = useState<
    "all" | "pending" | "approved" | "rejected"
  >("all");
  const [page, setPage] = useState(0);
  const [replyTarget, setReplyTarget] = useState<{
    id: number;
    reply: string | null;
  } | null>(null);
  const LIMIT = 20;

  const { data, isLoading, isError, error, refetch } = trpc.reviews.adminGetReviews.useQuery({
    entityType:
      filterType === "all" ? undefined : (filterType as "hotel" | "spa"),
    status:
      filterStatus === "all"
        ? undefined
        : (filterStatus as "pending" | "approved" | "rejected"),
    limit: LIMIT,
    offset: page * LIMIT,
  });

  const { data: stats } = trpc.reviews.adminGetStats.useQuery();

  const approveMutation = trpc.reviews.adminApprove.useMutation({
    onSuccess: () => utils.reviews.adminGetReviews.invalidate(),
  });
  const rejectMutation = trpc.reviews.adminReject.useMutation({
    onSuccess: () => utils.reviews.adminGetReviews.invalidate(),
  });
  const deleteMutation = trpc.reviews.adminDelete.useMutation({
    onSuccess: () => utils.reviews.adminGetReviews.invalidate(),
  });

  const reviews = data?.reviews ?? [];
  const total = data?.total ?? 0;
  const hasMore = (page + 1) * LIMIT < total;

  return (
    <AdminLayout>
      <div className="p-6 max-w-7xl mx-auto space-y-6">
        <PanelPageHeader
          icon={<MessageSquare />}
          title={t("reviewsAdmin.title")}
          description={t("reviewsAdmin.subtitle")}
          actions={
            <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-2">
              <RefreshCw className="w-4 h-4" />
              {t("reviewsAdmin.refresh")}
            </Button>
          }
        />

        {/* Resumen */}
        {stats && (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <MetricCard tone="brand" icon={<MessageSquare />} label={t("reviewsAdmin.stats.total")} value={stats.total} className="bg-gradient-to-br from-primary/5 to-card" />
            <MetricCard tone="warning" icon={<Clock />} label={t("reviewsAdmin.stats.pending")} value={stats.pending} className="bg-gradient-to-br from-primary/5 to-card" />
            <MetricCard tone="success" icon={<CheckCircle2 />} label={t("reviewsAdmin.stats.approved")} value={stats.approved} className="bg-gradient-to-br from-primary/5 to-card" />
            <MetricCard tone="danger" icon={<XCircle />} label={t("reviewsAdmin.stats.rejected")} value={stats.rejected} className="bg-gradient-to-br from-primary/5 to-card" />
            <MetricCard tone="warning" icon={<Star />} label={t("reviewsAdmin.stats.average")} value={stats.avgRating > 0 ? `${format.number(stats.avgRating, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} ★` : "—"} className="bg-gradient-to-br from-primary/5 to-card" />
          </div>
        )}

        {/* Filtros */}
        <div className="flex flex-wrap gap-3 items-center">
          <div className="flex items-center gap-2">
            <Label className="text-sm text-muted-foreground whitespace-nowrap">
              {t("reviewsAdmin.filter.type")}
            </Label>
            <Select
              value={filterType}
              onValueChange={(v) => {
                setFilterType(v as typeof filterType);
                setPage(0);
              }}
            >
              <SelectTrigger className="w-36 h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("reviewsAdmin.filter.all")}</SelectItem>
                <SelectItem value="hotel">Hotel</SelectItem>
                <SelectItem value="spa">SPA</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <Label className="text-sm text-muted-foreground whitespace-nowrap">
              {t("reviewsAdmin.filter.status")}
            </Label>
            <Select
              value={filterStatus}
              onValueChange={(v) => {
                setFilterStatus(v as typeof filterStatus);
                setPage(0);
              }}
            >
              <SelectTrigger className="w-40 h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("reviewsAdmin.filter.all")}</SelectItem>
                <SelectItem value="pending">{t("reviewsAdmin.filter.pending")}</SelectItem>
                <SelectItem value="approved">{t("reviewsAdmin.filter.approved")}</SelectItem>
                <SelectItem value="rejected">{t("reviewsAdmin.filter.rejected")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <span className="text-sm text-muted-foreground ml-auto">
            {t("reviewsAdmin.filter.results", { n: total })}
          </span>
        </div>

        {/* Tabla / listado */}
        {isLoading ? (
          <PanelLoading />
        ) : isError ? (
          <PanelError error={error} onRetry={() => refetch()} />
        ) : reviews.length === 0 ? (
          <PanelEmpty icon={<MessageSquare />} title={t("reviewsAdmin.empty")} />
        ) : (
          <div className="space-y-3">
            {reviews.map((review) => (
              <div
                key={review.id}
                className="bg-card border border-border rounded-xl p-5 hover:shadow-sm transition-shadow"
              >
                {/* Fila superior */}
                <div className="flex flex-wrap items-start gap-3 mb-3">
                  {/* Tipo de entidad */}
                  <div
                    className={`flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs font-medium ${
                      review.entityType === "hotel"
                        ? "bg-info/10 text-info"
                        : "bg-primary/10 text-primary"
                    }`}
                  >
                    {review.entityType === "hotel" ? (
                      <Hotel className="w-3.5 h-3.5" />
                    ) : (
                      <Sparkles className="w-3.5 h-3.5" />
                    )}
                    {review.entityType === "hotel" ? "Hotel" : "SPA"} #{review.entityId}
                  </div>

                  {/* Autor y fecha */}
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-full bg-primary flex items-center justify-center">
                      <span className="text-primary-foreground text-xs font-bold">
                        {review.authorName.charAt(0).toUpperCase()}
                      </span>
                    </div>
                    <div>
                      <span className="font-semibold text-sm text-foreground">
                        {review.authorName}
                      </span>
                      {review.authorEmail && (
                        <span className="text-muted-foreground text-xs ml-1.5">
                          {review.authorEmail}
                        </span>
                      )}
                    </div>
                    {review.verifiedBooking && (
                      <ThumbsUp className="w-3.5 h-3.5 text-primary" aria-label={t("reviewsAdmin.verifiedBooking")} />
                    )}
                  </div>

                  <div className="ml-auto flex items-center gap-2 flex-wrap">
                    <StarDisplay rating={review.rating} />
                    <ReviewStatusBadge status={review.status} />
                    <span className="text-xs text-muted-foreground">
                      {format.date(review.createdAt)}
                    </span>
                  </div>
                </div>

                {/* Contenido */}
                {review.title && (
                  <p className="font-semibold text-foreground text-sm mb-1">
                    {review.title}
                  </p>
                )}
                <p className="text-muted-foreground text-sm leading-relaxed line-clamp-3">
                  {review.body}
                </p>

                {/* Respuesta admin existente */}
                {review.adminReply && (
                  <div className="mt-3 bg-primary/5 border border-primary/30 rounded-lg p-3">
                    <p className="text-xs font-semibold text-primary mb-1">
                      {t("reviewsAdmin.teamReply")}
                    </p>
                    <p className="text-xs text-foreground leading-relaxed">
                      {review.adminReply}
                    </p>
                  </div>
                )}

                {/* Acciones */}
                <div className="flex flex-wrap gap-2 mt-4 pt-3 border-t border-border">
                  {review.status === "pending" && (
                    <>
                      <Button
                        size="sm"
                        onClick={() =>
                          approveMutation.mutate({ id: review.id })
                        }
                        disabled={approveMutation.isPending}
                        className="bg-success hover:bg-success/90 text-primary-foreground gap-1.5 h-8"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        {t("reviewsAdmin.action.approve")}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          rejectMutation.mutate({ id: review.id })
                        }
                        disabled={rejectMutation.isPending}
                        className="border-danger/40 text-danger hover:bg-danger/10 gap-1.5 h-8"
                      >
                        <XCircle className="w-3.5 h-3.5" />
                        {t("reviewsAdmin.action.reject")}
                      </Button>
                    </>
                  )}
                  {review.status === "approved" && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        rejectMutation.mutate({ id: review.id })
                      }
                      disabled={rejectMutation.isPending}
                      className="border-border text-muted-foreground hover:bg-muted gap-1.5 h-8"
                    >
                      <XCircle className="w-3.5 h-3.5" />
                      {t("reviewsAdmin.action.withdraw")}
                    </Button>
                  )}
                  {review.status === "rejected" && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        approveMutation.mutate({ id: review.id })
                      }
                      disabled={approveMutation.isPending}
                      className="border-success/40 text-success hover:bg-success/10 gap-1.5 h-8"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      {t("reviewsAdmin.action.approve")}
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      setReplyTarget({
                        id: review.id,
                        reply: review.adminReply ?? null,
                      })
                    }
                    className="border-primary/40 text-primary hover:bg-primary/10 gap-1.5 h-8"
                  >
                    <MessageSquare className="w-3.5 h-3.5" />
                    {review.adminReply ? t("reviewsAdmin.action.editReply") : t("reviewsAdmin.action.reply")}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={async () => {
                      if (
                        (await confirmAction({ description: t("reviewsAdmin.action.confirmDelete"), destructive: true }))
                      ) {
                        deleteMutation.mutate({ id: review.id });
                      }
                    }}
                    disabled={deleteMutation.isPending}
                    className="text-danger/70 hover:text-danger hover:bg-danger/10 gap-1.5 h-8 ml-auto"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    {t("reviewsAdmin.action.delete")}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Paginación */}
        {total > LIMIT && (
          <div className="flex items-center justify-between pt-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page === 0}
              onClick={() => setPage(page - 1)}
              className="gap-1"
            >
              <ChevronLeft className="w-4 h-4" />
              {t("reviewsAdmin.pager.previous")}
            </Button>
            <span className="text-sm text-muted-foreground">
              {t("reviewsAdmin.pager.page", { page: page + 1, pages: Math.ceil(total / LIMIT) })}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={!hasMore}
              onClick={() => setPage(page + 1)}
              className="gap-1"
            >
              {t("reviewsAdmin.pager.next")}
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        )}
      </div>

      {/* Modal de respuesta */}
      {replyTarget && (
        <ReplyModal
          reviewId={replyTarget.id}
          existingReply={replyTarget.reply}
          onClose={() => setReplyTarget(null)}
          onSaved={() => utils.reviews.adminGetReviews.invalidate()}
        />
      )}
    </AdminLayout>
  );
}
