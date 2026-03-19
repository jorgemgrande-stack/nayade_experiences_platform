import { useState } from "react";
import { trpc } from "@/lib/trpc";
import AdminLayout from "@/components/AdminLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
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
              ? "fill-amber-400 text-amber-400"
              : "fill-transparent text-gray-300"
          }`}
        />
      ))}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; className: string }> = {
    pending: {
      label: "Pendiente",
      className: "bg-amber-100 text-amber-700 border-amber-200",
    },
    approved: {
      label: "Aprobada",
      className: "bg-emerald-100 text-emerald-700 border-emerald-200",
    },
    rejected: {
      label: "Rechazada",
      className: "bg-red-100 text-red-700 border-red-200",
    },
  };
  const cfg = map[status] ?? map.pending;
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${cfg.className}`}
    >
      {cfg.label}
    </span>
  );
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
  const [reply, setReply] = useState(existingReply ?? "");
  const replyMutation = trpc.reviews.adminReply.useMutation({
    onSuccess: () => {
      onSaved();
      onClose();
    },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg">
        <div className="flex items-center justify-between p-5 border-b">
          <h3 className="font-bold text-gray-900">Responder a la reseña</h3>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400"
          >
            ✕
          </button>
        </div>
        <div className="p-5 space-y-3">
          <Label className="text-sm text-gray-600">
            Tu respuesta (visible públicamente)
          </Label>
          <Textarea
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            placeholder="Escribe una respuesta profesional y cordial..."
            className="min-h-[120px] resize-none"
            maxLength={1000}
          />
          <p className="text-xs text-gray-400 text-right">{reply.length}/1000</p>
        </div>
        <div className="flex justify-end gap-2 p-5 border-t">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            onClick={() => replyMutation.mutate({ id: reviewId, reply })}
            disabled={!reply.trim() || replyMutation.isPending}
            className="bg-teal-600 hover:bg-teal-500 text-white"
          >
            {replyMutation.isPending ? "Guardando…" : "Publicar respuesta"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Componente principal ─────────────────────────────────────────────────────

export default function ReviewsManager() {
  const utils = trpc.useUtils();
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

  const { data, isLoading, refetch } = trpc.reviews.adminGetReviews.useQuery({
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
        {/* Cabecera */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              Moderación de Reseñas
            </h1>
            <p className="text-gray-500 text-sm mt-1">
              Gestiona las opiniones de clientes del Hotel y el SPA
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            className="gap-2"
          >
            <RefreshCw className="w-4 h-4" />
            Actualizar
          </Button>
        </div>

        {/* Tarjetas de estadísticas */}
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {[
              {
                label: "Total",
                value: stats.total,
                icon: MessageSquare,
                color: "text-gray-700",
                bg: "bg-gray-50",
              },
              {
                label: "Pendientes",
                value: stats.pending,
                icon: Clock,
                color: "text-amber-600",
                bg: "bg-amber-50",
              },
              {
                label: "Aprobadas",
                value: stats.approved,
                icon: CheckCircle2,
                color: "text-emerald-600",
                bg: "bg-emerald-50",
              },
              {
                label: "Rechazadas",
                value: stats.rejected,
                icon: XCircle,
                color: "text-red-500",
                bg: "bg-red-50",
              },
              {
                label: "Media",
                value: stats.avgRating > 0 ? `${stats.avgRating.toFixed(1)} ★` : "—",
                icon: Star,
                color: "text-amber-500",
                bg: "bg-amber-50",
              },
            ].map((s) => (
              <div
                key={s.label}
                className={`rounded-xl p-4 ${s.bg} border border-gray-100`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <s.icon className={`w-4 h-4 ${s.color}`} />
                  <span className="text-xs text-gray-500 font-medium">
                    {s.label}
                  </span>
                </div>
                <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
              </div>
            ))}
          </div>
        )}

        {/* Filtros */}
        <div className="flex flex-wrap gap-3 items-center">
          <div className="flex items-center gap-2">
            <Label className="text-sm text-gray-600 whitespace-nowrap">
              Tipo:
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
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="hotel">Hotel</SelectItem>
                <SelectItem value="spa">SPA</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <Label className="text-sm text-gray-600 whitespace-nowrap">
              Estado:
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
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="pending">Pendientes</SelectItem>
                <SelectItem value="approved">Aprobadas</SelectItem>
                <SelectItem value="rejected">Rechazadas</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <span className="text-sm text-gray-400 ml-auto">
            {total} resultado{total !== 1 ? "s" : ""}
          </span>
        </div>

        {/* Tabla / listado */}
        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-24 bg-gray-100 rounded-xl animate-pulse"
              />
            ))}
          </div>
        ) : reviews.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <MessageSquare className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p className="font-medium">No hay reseñas con estos filtros</p>
          </div>
        ) : (
          <div className="space-y-3">
            {reviews.map((review) => (
              <div
                key={review.id}
                className="bg-white border border-gray-200 rounded-xl p-5 hover:shadow-sm transition-shadow"
              >
                {/* Fila superior */}
                <div className="flex flex-wrap items-start gap-3 mb-3">
                  {/* Tipo de entidad */}
                  <div
                    className={`flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs font-medium ${
                      review.entityType === "hotel"
                        ? "bg-blue-50 text-blue-600"
                        : "bg-teal-50 text-teal-600"
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
                    <div className="w-7 h-7 rounded-full bg-gradient-to-br from-teal-500 to-cyan-600 flex items-center justify-center">
                      <span className="text-white text-xs font-bold">
                        {review.authorName.charAt(0).toUpperCase()}
                      </span>
                    </div>
                    <div>
                      <span className="font-semibold text-sm text-gray-900">
                        {review.authorName}
                      </span>
                      {review.authorEmail && (
                        <span className="text-gray-400 text-xs ml-1.5">
                          {review.authorEmail}
                        </span>
                      )}
                    </div>
                    {review.verifiedBooking && (
                      <ThumbsUp className="w-3.5 h-3.5 text-teal-500" aria-label="Reserva verificada" />
                    )}
                  </div>

                  <div className="ml-auto flex items-center gap-2 flex-wrap">
                    <StarDisplay rating={review.rating} />
                    <StatusBadge status={review.status} />
                    <span className="text-xs text-gray-400">
                      {new Date(review.createdAt).toLocaleDateString("es-ES")}
                    </span>
                  </div>
                </div>

                {/* Contenido */}
                {review.title && (
                  <p className="font-semibold text-gray-800 text-sm mb-1">
                    {review.title}
                  </p>
                )}
                <p className="text-gray-600 text-sm leading-relaxed line-clamp-3">
                  {review.body}
                </p>

                {/* Respuesta admin existente */}
                {review.adminReply && (
                  <div className="mt-3 bg-teal-50 border border-teal-200 rounded-lg p-3">
                    <p className="text-xs font-semibold text-teal-600 mb-1">
                      Respuesta del equipo
                    </p>
                    <p className="text-xs text-teal-700 leading-relaxed">
                      {review.adminReply}
                    </p>
                  </div>
                )}

                {/* Acciones */}
                <div className="flex flex-wrap gap-2 mt-4 pt-3 border-t border-gray-100">
                  {review.status === "pending" && (
                    <>
                      <Button
                        size="sm"
                        onClick={() =>
                          approveMutation.mutate({ id: review.id })
                        }
                        disabled={approveMutation.isPending}
                        className="bg-emerald-600 hover:bg-emerald-500 text-white gap-1.5 h-8"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Aprobar
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          rejectMutation.mutate({ id: review.id })
                        }
                        disabled={rejectMutation.isPending}
                        className="border-red-200 text-red-600 hover:bg-red-50 gap-1.5 h-8"
                      >
                        <XCircle className="w-3.5 h-3.5" />
                        Rechazar
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
                      className="border-gray-200 text-gray-500 hover:bg-gray-50 gap-1.5 h-8"
                    >
                      <XCircle className="w-3.5 h-3.5" />
                      Retirar
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
                      className="border-emerald-200 text-emerald-600 hover:bg-emerald-50 gap-1.5 h-8"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Aprobar
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
                    className="border-teal-200 text-teal-600 hover:bg-teal-50 gap-1.5 h-8"
                  >
                    <MessageSquare className="w-3.5 h-3.5" />
                    {review.adminReply ? "Editar respuesta" : "Responder"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      if (
                        confirm(
                          "¿Eliminar esta reseña definitivamente? Esta acción no se puede deshacer."
                        )
                      ) {
                        deleteMutation.mutate({ id: review.id });
                      }
                    }}
                    disabled={deleteMutation.isPending}
                    className="text-red-400 hover:text-red-600 hover:bg-red-50 gap-1.5 h-8 ml-auto"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Eliminar
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
              Anterior
            </Button>
            <span className="text-sm text-gray-500">
              Página {page + 1} de {Math.ceil(total / LIMIT)}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={!hasMore}
              onClick={() => setPage(page + 1)}
              className="gap-1"
            >
              Siguiente
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
