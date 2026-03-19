import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Star, MessageSquare, ChevronDown, ChevronUp, ThumbsUp } from "lucide-react";

// ─── TIPOS ────────────────────────────────────────────────────────────────────

type EntityType = "hotel" | "spa";

interface ReviewSectionProps {
  entityType: EntityType;
  entityId: number;
  /** Tema visual: "dark" para páginas con fondo oscuro (SPA, Hotel), "light" para páginas claras */
  theme?: "dark" | "light";
}

// ─── COMPONENTE ESTRELLAS ─────────────────────────────────────────────────────

function StarRating({
  value,
  onChange,
  size = "md",
  readonly = false,
}: {
  value: number;
  onChange?: (v: number) => void;
  size?: "sm" | "md" | "lg";
  readonly?: boolean;
}) {
  const [hovered, setHovered] = useState(0);
  const sizes = { sm: "w-4 h-4", md: "w-5 h-5", lg: "w-7 h-7" };
  const active = hovered || value;

  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          disabled={readonly}
          onClick={() => onChange?.(star)}
          onMouseEnter={() => !readonly && setHovered(star)}
          onMouseLeave={() => !readonly && setHovered(0)}
          className={readonly ? "cursor-default" : "cursor-pointer transition-transform hover:scale-110"}
          aria-label={`${star} estrellas`}
        >
          <Star
            className={`${sizes[size]} transition-colors ${
              star <= active
                ? "fill-amber-400 text-amber-400"
                : "fill-transparent text-gray-400"
            }`}
          />
        </button>
      ))}
    </div>
  );
}

// ─── BARRA DE DISTRIBUCIÓN ────────────────────────────────────────────────────

function RatingBar({
  stars,
  count,
  percentage,
  theme,
}: {
  stars: number;
  count: number;
  percentage: number;
  theme: "dark" | "light";
}) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className={`w-4 text-right font-medium ${theme === "dark" ? "text-white/70" : "text-gray-600"}`}>
        {stars}
      </span>
      <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400 flex-shrink-0" />
      <div className={`flex-1 h-2 rounded-full overflow-hidden ${theme === "dark" ? "bg-white/10" : "bg-gray-200"}`}>
        <div
          className="h-full bg-amber-400 rounded-full transition-all duration-500"
          style={{ width: `${percentage}%` }}
        />
      </div>
      <span className={`w-6 text-right text-xs ${theme === "dark" ? "text-white/50" : "text-gray-400"}`}>
        {count}
      </span>
    </div>
  );
}

// ─── TARJETA DE RESEÑA ────────────────────────────────────────────────────────

function ReviewCard({
  review,
  theme,
}: {
  review: {
    id: number;
    authorName: string;
    rating: number;
    title: string | null;
    body: string;
    adminReply: string | null;
    stayDate: string | null;
    verifiedBooking: boolean;
    createdAt: Date;
  };
  theme: "dark" | "light";
}) {
  const [expanded, setExpanded] = useState(false);
  const MAX_CHARS = 240;
  const isLong = review.body.length > MAX_CHARS;
  const displayBody =
    isLong && !expanded ? review.body.slice(0, MAX_CHARS) + "…" : review.body;

  const cardBg = theme === "dark" ? "bg-white/5 border-white/10" : "bg-white border-gray-200";
  const textPrimary = theme === "dark" ? "text-white" : "text-gray-900";
  const textSecondary = theme === "dark" ? "text-white/60" : "text-gray-500";
  const replyBg = theme === "dark" ? "bg-teal-900/40 border-teal-700/40" : "bg-teal-50 border-teal-200";

  const date = new Date(review.createdAt).toLocaleDateString("es-ES", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <div className={`rounded-xl border p-5 ${cardBg}`}>
      {/* Cabecera */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-3">
          {/* Avatar inicial */}
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-teal-500 to-cyan-600 flex items-center justify-center flex-shrink-0">
            <span className="text-white font-bold text-sm">
              {review.authorName.charAt(0).toUpperCase()}
            </span>
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`font-semibold text-sm ${textPrimary}`}>
                {review.authorName}
              </span>
              {review.verifiedBooking && (
                <Badge
                  variant="outline"
                  className="text-xs px-1.5 py-0 border-teal-500/50 text-teal-400"
                >
                  <ThumbsUp className="w-2.5 h-2.5 mr-1" />
                  Reserva verificada
                </Badge>
              )}
            </div>
            <span className={`text-xs ${textSecondary}`}>{date}</span>
          </div>
        </div>
        <StarRating value={review.rating} size="sm" readonly />
      </div>

      {/* Título */}
      {review.title && (
        <p className={`font-semibold text-sm mb-1.5 ${textPrimary}`}>
          {review.title}
        </p>
      )}

      {/* Cuerpo */}
      <p className={`text-sm leading-relaxed ${textSecondary}`}>{displayBody}</p>
      {isLong && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1 text-xs text-teal-400 mt-1.5 hover:text-teal-300 transition-colors"
        >
          {expanded ? (
            <>
              <ChevronUp className="w-3 h-3" /> Ver menos
            </>
          ) : (
            <>
              <ChevronDown className="w-3 h-3" /> Leer más
            </>
          )}
        </button>
      )}

      {/* Respuesta del equipo */}
      {review.adminReply && (
        <div className={`mt-3 rounded-lg border p-3 ${replyBg}`}>
          <p className="text-xs font-semibold text-teal-400 mb-1">
            Respuesta del equipo Náyade
          </p>
          <p className={`text-xs leading-relaxed ${textSecondary}`}>
            {review.adminReply}
          </p>
        </div>
      )}
    </div>
  );
}

// ─── FORMULARIO DE NUEVA RESEÑA ───────────────────────────────────────────────

function ReviewForm({
  entityType,
  entityId,
  theme,
  onSuccess,
}: {
  entityType: EntityType;
  entityId: number;
  theme: "dark" | "light";
  onSuccess: () => void;
}) {
  const [rating, setRating] = useState(0);
  const [form, setForm] = useState({
    authorName: "",
    authorEmail: "",
    title: "",
    body: "",
    stayDate: "",
  });

  const submitMutation = trpc.reviews.submitReview.useMutation({
    onSuccess: () => {
      setRating(0);
      setForm({ authorName: "", authorEmail: "", title: "", body: "", stayDate: "" });
      onSuccess();
    },
    onError: (err) => {
      alert("Error al enviar: " + err.message);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (rating === 0) {
      alert("Por favor selecciona una valoración de estrellas.");
      return;
    }
    submitMutation.mutate({
      entityType,
      entityId,
      rating,
      authorName: form.authorName,
      authorEmail: form.authorEmail || undefined,
      title: form.title || undefined,
      body: form.body,
      stayDate: form.stayDate || undefined,
    });
  };

  const inputClass =
    theme === "dark"
      ? "bg-white/5 border-white/15 text-white placeholder:text-white/30 focus:border-teal-500"
      : "bg-white border-gray-300 text-gray-900 placeholder:text-gray-400 focus:border-teal-500";
  const labelClass =
    theme === "dark" ? "text-white/70 text-sm" : "text-gray-600 text-sm";

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Valoración con estrellas */}
      <div>
        <Label className={labelClass}>Tu valoración *</Label>
        <div className="mt-2">
          <StarRating value={rating} onChange={setRating} size="lg" />
          {rating > 0 && (
            <span className={`text-xs mt-1 block ${theme === "dark" ? "text-white/50" : "text-gray-400"}`}>
              {["", "Muy malo", "Malo", "Regular", "Bueno", "Excelente"][rating]}
            </span>
          )}
        </div>
      </div>

      {/* Nombre y email */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <Label className={labelClass}>Nombre *</Label>
          <Input
            className={`mt-1 ${inputClass}`}
            placeholder="Tu nombre"
            value={form.authorName}
            onChange={(e) => setForm({ ...form, authorName: e.target.value })}
            required
            minLength={2}
          />
        </div>
        <div>
          <Label className={labelClass}>Email (opcional)</Label>
          <Input
            type="email"
            className={`mt-1 ${inputClass}`}
            placeholder="tu@email.com"
            value={form.authorEmail}
            onChange={(e) => setForm({ ...form, authorEmail: e.target.value })}
          />
        </div>
      </div>

      {/* Título y fecha */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <Label className={labelClass}>Título de la reseña</Label>
          <Input
            className={`mt-1 ${inputClass}`}
            placeholder="Resumen en una frase"
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            maxLength={256}
          />
        </div>
        <div>
          <Label className={labelClass}>Fecha de la visita</Label>
          <Input
            type="date"
            className={`mt-1 ${inputClass}`}
            value={form.stayDate}
            onChange={(e) => setForm({ ...form, stayDate: e.target.value })}
          />
        </div>
      </div>

      {/* Cuerpo de la reseña */}
      <div>
        <Label className={labelClass}>Tu opinión *</Label>
        <Textarea
          className={`mt-1 min-h-[100px] resize-none ${inputClass}`}
          placeholder="Cuéntanos tu experiencia con detalle (mínimo 10 caracteres)..."
          value={form.body}
          onChange={(e) => setForm({ ...form, body: e.target.value })}
          required
          minLength={10}
          maxLength={2000}
        />
        <p className={`text-xs mt-1 ${theme === "dark" ? "text-white/30" : "text-gray-400"}`}>
          {form.body.length}/2000 caracteres
        </p>
      </div>

      <Button
        type="submit"
        disabled={submitMutation.isPending}
        className="w-full bg-teal-600 hover:bg-teal-500 text-white font-semibold"
      >
        {submitMutation.isPending ? "Enviando…" : "Enviar opinión"}
      </Button>
      <p className={`text-xs text-center ${theme === "dark" ? "text-white/30" : "text-gray-400"}`}>
        Tu reseña será publicada tras revisión del equipo (24-48h).
      </p>
    </form>
  );
}

// ─── COMPONENTE PRINCIPAL ─────────────────────────────────────────────────────

export function ReviewSection({
  entityType,
  entityId,
  theme = "dark",
}: ReviewSectionProps) {
  const [showForm, setShowForm] = useState(false);
  const [page, setPage] = useState(0);
  const LIMIT = 6;

  const { data, refetch, isLoading } = trpc.reviews.getPublicReviews.useQuery({
    entityType,
    entityId,
    limit: LIMIT,
    offset: page * LIMIT,
  });

  const reviews = data?.reviews ?? [];
  const stats = data?.stats;
  const total = data?.total ?? 0;
  const hasMore = (page + 1) * LIMIT < total;

  const sectionBg = theme === "dark" ? "border-white/10" : "border-gray-200";
  const headingClass = theme === "dark" ? "text-white" : "text-gray-900";
  const subClass = theme === "dark" ? "text-white/60" : "text-gray-500";
  const dividerClass = theme === "dark" ? "border-white/10" : "border-gray-200";
  const formBg =
    theme === "dark"
      ? "bg-white/5 border-white/10 rounded-xl p-5"
      : "bg-gray-50 border-gray-200 rounded-xl p-5 border";

  return (
    <section className={`border-t pt-10 mt-10 ${sectionBg}`}>
      {/* Encabezado */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
        <div>
          <h2 className={`text-2xl font-bold ${headingClass}`}>
            Opiniones de clientes
          </h2>
          {stats && stats.totalReviews > 0 && (
            <p className={`text-sm mt-1 ${subClass}`}>
              {stats.totalReviews} {stats.totalReviews === 1 ? "valoración" : "valoraciones"} verificadas
            </p>
          )}
        </div>
        <Button
          onClick={() => setShowForm(!showForm)}
          variant="outline"
          className={`gap-2 ${
            theme === "dark"
              ? "border-teal-500/50 text-teal-400 hover:bg-teal-900/30 hover:border-teal-400"
              : "border-teal-600 text-teal-600 hover:bg-teal-50"
          }`}
        >
          <MessageSquare className="w-4 h-4" />
          {showForm ? "Cancelar" : "Escribir una opinión"}
        </Button>
      </div>

      {/* Resumen estadístico */}
      {stats && stats.totalReviews > 0 && (
        <div className={`flex flex-col sm:flex-row gap-6 mb-8 pb-8 border-b ${dividerClass}`}>
          {/* Puntuación media grande */}
          <div className="flex flex-col items-center justify-center sm:w-36 flex-shrink-0">
            <span className={`text-6xl font-black ${headingClass}`}>
              {stats.averageRating.toFixed(1)}
            </span>
            <StarRating value={Math.round(stats.averageRating)} size="md" readonly />
            <span className={`text-xs mt-1 ${subClass}`}>
              de 5 estrellas
            </span>
          </div>
          {/* Barras de distribución */}
          <div className="flex-1 space-y-2">
            {stats.distribution.map((d) => (
              <RatingBar
                key={d.stars}
                stars={d.stars}
                count={d.count}
                percentage={d.percentage}
                theme={theme}
              />
            ))}
          </div>
        </div>
      )}

      {/* Formulario de nueva reseña */}
      {showForm && (
        <div className={`mb-8 ${formBg}`}>
          <h3 className={`text-lg font-semibold mb-4 ${headingClass}`}>
            Comparte tu experiencia
          </h3>
          <ReviewForm
            entityType={entityType}
            entityId={entityId}
            theme={theme}
            onSuccess={() => {
              setShowForm(false);
              refetch();
            }}
          />
        </div>
      )}

      {/* Listado de reseñas */}
      {isLoading ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className={`rounded-xl h-28 animate-pulse ${
                theme === "dark" ? "bg-white/5" : "bg-gray-100"
              }`}
            />
          ))}
        </div>
      ) : reviews.length === 0 ? (
        <div className={`text-center py-12 ${subClass}`}>
          <MessageSquare className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="font-medium">Aún no hay opiniones</p>
          <p className="text-sm mt-1">
            Sé el primero en compartir tu experiencia
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {reviews.map((review) => (
              <ReviewCard key={review.id} review={review} theme={theme} />
            ))}
          </div>

          {/* Paginación */}
          <div className="flex items-center justify-between mt-6">
            <Button
              variant="ghost"
              size="sm"
              disabled={page === 0}
              onClick={() => setPage(page - 1)}
              className={theme === "dark" ? "text-white/60 hover:text-white" : "text-gray-500"}
            >
              ← Anteriores
            </Button>
            <span className={`text-xs ${subClass}`}>
              {page * LIMIT + 1}–{Math.min((page + 1) * LIMIT, total)} de {total}
            </span>
            <Button
              variant="ghost"
              size="sm"
              disabled={!hasMore}
              onClick={() => setPage(page + 1)}
              className={theme === "dark" ? "text-white/60 hover:text-white" : "text-gray-500"}
            >
              Siguientes →
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
