/**
 * ProposalView — Página pública de visualización de propuesta comercial
 * Ruta: /propuesta/:token
 *
 * Flujo:
 * 1. Carga la propuesta por token → marca como "visualizado"
 * 2. Muestra resumen: configurable (líneas fijas) o multi-opción (cliente elige)
 * 3. Cliente puede aceptar / seleccionar opción y enviar confirmación
 */
import { useState } from "react";
import { useParams } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  CheckCircle,
  Clock,
  FileText,
  Phone,
  Mail,
  AlertTriangle,
  Star,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(v: string | number | null | undefined): string {
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(Number(v ?? 0));
}

function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("es-ES", { day: "2-digit", month: "long", year: "numeric" });
}

// ─── Item Table ────────────────────────────────────────────────────────────────

type ItemLine = { description: string; quantity: number; unitPrice: number; total: number; isOptional?: boolean };

function ItemsTable({ items, title }: { items: ItemLine[]; title?: string }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-white/10">
      <table className="w-full text-sm">
        {title && (
          <caption className="text-left px-4 py-2 text-xs font-semibold uppercase tracking-widest text-white/50 bg-white/5">
            {title}
          </caption>
        )}
        <thead>
          <tr className="border-b border-white/10 bg-white/5">
            <th className="text-left px-4 py-2.5 text-xs text-white/50 font-medium">Descripción</th>
            <th className="text-center px-3 py-2.5 text-xs text-white/50 font-medium">Cant.</th>
            <th className="text-right px-3 py-2.5 text-xs text-white/50 font-medium">Precio</th>
            <th className="text-right px-4 py-2.5 text-xs text-white/50 font-medium">Total</th>
          </tr>
        </thead>
        <tbody>
          {(items ?? []).map((item, idx) => (
            <tr key={idx} className="border-b border-white/5 last:border-0">
              <td className="px-4 py-2.5 text-white/80">
                {item.description}
                {item.isOptional && <span className="ml-1.5 text-[10px] text-white/30 italic">(opcional)</span>}
              </td>
              <td className="px-3 py-2.5 text-center text-white/60">{item.quantity}</td>
              <td className="px-3 py-2.5 text-right text-white/60">{fmt(item.unitPrice)}</td>
              <td className="px-4 py-2.5 text-right font-semibold text-amber-400">{fmt(item.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Option Card ──────────────────────────────────────────────────────────────

type OptionData = {
  id: number;
  title: string;
  description: string | null;
  items: ItemLine[];
  subtotal: string | null;
  tax: string | null;
  total: string | null;
  isRecommended: boolean;
};

function OptionCard({
  option,
  selected,
  onSelect,
}: {
  option: OptionData;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <div
      onClick={onSelect}
      className={`rounded-2xl border-2 cursor-pointer transition-all duration-200 overflow-hidden ${
        selected
          ? "border-amber-400/80 bg-amber-400/5"
          : "border-white/10 bg-white/[0.03] hover:border-white/20"
      }`}
    >
      <div className="px-5 py-4 flex items-start justify-between gap-3">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-white">{option.title}</span>
            {option.isRecommended && (
              <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-400 bg-amber-400/10 border border-amber-400/30 rounded-full px-2 py-0.5 uppercase tracking-wide">
                <Star className="w-2.5 h-2.5 fill-amber-400" /> Recomendada
              </span>
            )}
          </div>
          {option.description && (
            <p className="text-sm text-white/50 mt-1">{option.description}</p>
          )}
        </div>
        <div className="text-right shrink-0">
          <div className="text-2xl font-bold text-amber-400">{fmt(option.total)}</div>
          <div className="text-xs text-white/30 mt-0.5">IVA incl.</div>
        </div>
      </div>
      {selected && (
        <div className="px-5 pb-4">
          <ItemsTable items={option.items ?? []} />
        </div>
      )}
    </div>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────────

export default function ProposalView() {
  const { token } = useParams<{ token: string }>();
  const [selectedOptionId, setSelectedOptionId] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const [accepted, setAccepted] = useState(false);

  const { data, isLoading, error } = trpc.proposals.getByToken.useQuery(
    { token: token ?? "" },
    { enabled: !!token, retry: false }
  );

  const acceptMutation = trpc.proposals.acceptOption.useMutation();

  async function handleAccept() {
    if (!data) return;
    if (data.proposal.mode === "multi_option" && !selectedOptionId) {
      toast.error("Selecciona una opción antes de confirmar");
      return;
    }
    try {
      await acceptMutation.mutateAsync({
        token: token!,
        selectedOptionId: selectedOptionId ?? undefined,
        message: message.trim() || undefined,
      });
      setAccepted(true);
    } catch (err: unknown) {
      toast.error((err as { message?: string })?.message ?? "Error al confirmar");
    }
  }

  // Loading
  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#0a1628] flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-amber-400 animate-spin" />
      </div>
    );
  }

  // Error / not found
  if (error || !data) {
    return (
      <div className="min-h-screen bg-[#0a1628] flex items-center justify-center px-4">
        <div className="text-center max-w-sm">
          <AlertTriangle className="w-12 h-12 text-amber-400 mx-auto mb-4" />
          <h1 className="text-white text-xl font-bold mb-2">Propuesta no encontrada</h1>
          <p className="text-white/50 text-sm">Este enlace puede haber expirado o no ser válido.</p>
        </div>
      </div>
    );
  }

  const { proposal, lead, options } = data;
  const isExpired = proposal.status === "expirado";
  const isAlreadyAccepted = proposal.status === "aceptado";
  const isRejected = proposal.status === "rechazado";
  const canAccept = !accepted && !isExpired && !isAlreadyAccepted && !isRejected;

  // Accepted confirmation screen
  if (accepted) {
    return (
      <div className="min-h-screen bg-[#0a1628] flex items-center justify-center px-4">
        <div className="text-center max-w-md">
          <CheckCircle className="w-16 h-16 text-emerald-400 mx-auto mb-6" />
          <h1 className="text-white text-2xl font-bold mb-3">¡Confirmación recibida!</h1>
          <p className="text-white/60 text-base leading-relaxed">
            Hemos recibido tu respuesta. Nuestro equipo se pondrá en contacto contigo en breve para dar los próximos pasos.
          </p>
          <p className="text-white/30 text-sm mt-6">Náyade Experiences · contacto@nayadeexperiences.es</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a1628] text-white">
      {/* Hero header */}
      <div className="relative bg-gradient-to-b from-[#0d1f3c] to-[#0a1628] border-b border-white/10">
        <div className="max-w-3xl mx-auto px-4 py-10 text-center">
          <div className="inline-block bg-amber-400/10 border border-amber-400/30 rounded-full px-3 py-1 text-xs font-bold text-amber-400 uppercase tracking-widest mb-5">
            Propuesta Comercial
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold text-white mb-3">{proposal.title}</h1>
          <p className="text-white/50 text-sm mb-4">
            Ref. <span className="font-mono text-white/70">{proposal.proposalNumber}</span>
            {lead && <> · Preparada para <strong className="text-white/80">{lead.name}</strong></>}
          </p>
          {proposal.validUntil && (
            <div className="inline-flex items-center gap-1.5 text-xs text-amber-300 bg-amber-400/10 border border-amber-400/30 rounded-full px-3 py-1">
              <Clock className="w-3.5 h-3.5" />
              Válida hasta el {fmtDate(proposal.validUntil)}
            </div>
          )}
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">

        {/* Status banners */}
        {isExpired && (
          <div className="rounded-xl bg-red-500/10 border border-red-500/30 px-4 py-3 flex items-center gap-2 text-sm text-red-300">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            Esta propuesta ha expirado. Contacta con nosotros para renovarla.
          </div>
        )}
        {isAlreadyAccepted && (
          <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/30 px-4 py-3 flex items-center gap-2 text-sm text-emerald-300">
            <CheckCircle className="w-4 h-4 shrink-0" />
            Ya has confirmado esta propuesta. Nuestro equipo está en contacto contigo.
          </div>
        )}

        {/* Configurable mode — fixed items */}
        {proposal.mode === "configurable" && (
          <div className="space-y-4">
            <ItemsTable items={(proposal.items as ItemLine[]) ?? []} />
            <div className="flex flex-col items-end gap-1 text-sm">
              {Number(proposal.discount ?? 0) > 0 && (
                <div className="text-white/40">Descuento: -{fmt(proposal.discount)}</div>
              )}
              {Number(proposal.tax ?? 0) > 0 && (
                <div className="text-white/40">IVA: {fmt(proposal.tax)}</div>
              )}
              <div className="text-2xl font-bold text-amber-400">{fmt(proposal.total)}</div>
            </div>
          </div>
        )}

        {/* Multi-option mode — client chooses */}
        {proposal.mode === "multi_option" && options.length > 0 && (
          <div className="space-y-4">
            <p className="text-sm text-white/50">Selecciona la opción que mejor se adapte a tus necesidades:</p>
            {options.map(opt => (
              <OptionCard
                key={opt.id}
                option={opt as OptionData}
                selected={selectedOptionId === opt.id}
                onSelect={() => setSelectedOptionId(selectedOptionId === opt.id ? null : opt.id)}
              />
            ))}
          </div>
        )}

        {/* Notes */}
        {proposal.notes && (
          <div className="rounded-xl bg-amber-400/5 border-l-4 border-amber-400/60 px-4 py-3">
            <p className="text-sm text-white/70 leading-relaxed whitespace-pre-line">{proposal.notes}</p>
          </div>
        )}

        {/* Conditions */}
        {proposal.conditions && (
          <div className="rounded-xl bg-white/[0.03] border border-white/10 px-5 py-4">
            <p className="text-xs font-bold uppercase tracking-widest text-white/30 mb-2">Condiciones</p>
            <p className="text-sm text-white/50 leading-relaxed whitespace-pre-line">{proposal.conditions}</p>
          </div>
        )}

        {/* Accept section */}
        {canAccept && (
          <div className="rounded-2xl bg-white/[0.04] border border-white/10 px-5 py-5 space-y-4">
            <h2 className="font-semibold text-white">¿Todo correcto? Confírmalo aquí</h2>
            <div>
              <label className="text-xs text-white/40 block mb-1.5">Mensaje opcional (comentarios, preguntas...)</label>
              <Textarea
                value={message}
                onChange={e => setMessage(e.target.value)}
                rows={3}
                placeholder="Escribe aquí cualquier comentario adicional..."
                className="bg-white/5 border-white/10 text-white placeholder:text-white/20 text-sm resize-none"
              />
            </div>
            <Button
              onClick={handleAccept}
              disabled={acceptMutation.isPending || (proposal.mode === "multi_option" && !selectedOptionId)}
              className="w-full bg-amber-500 hover:bg-amber-400 text-white font-bold py-3 text-base rounded-xl"
            >
              {acceptMutation.isPending
                ? <Loader2 className="w-5 h-5 animate-spin" />
                : <><CheckCircle className="w-5 h-5 mr-2" /> Confirmar propuesta</>}
            </Button>
            {proposal.mode === "multi_option" && !selectedOptionId && (
              <p className="text-xs text-amber-400/70 text-center">Selecciona una opción para continuar</p>
            )}
          </div>
        )}

        {/* Contact footer */}
        <div className="rounded-xl bg-white/[0.03] border border-white/10 px-5 py-4">
          <p className="text-xs font-bold uppercase tracking-widest text-white/30 mb-3">¿Tienes alguna pregunta?</p>
          <div className="flex flex-wrap gap-4 text-sm">
            <a href="tel:+34930347791" className="flex items-center gap-2 text-amber-400 hover:text-amber-300 transition-colors">
              <Phone className="w-4 h-4" /> +34 930 34 77 91
            </a>
            <a href="mailto:contacto@nayadeexperiences.es" className="flex items-center gap-2 text-amber-400 hover:text-amber-300 transition-colors">
              <Mail className="w-4 h-4" /> contacto@nayadeexperiences.es
            </a>
          </div>
        </div>

        <p className="text-center text-white/20 text-xs pb-4">
          Náyade Experiences · {proposal.proposalNumber}
        </p>
      </div>
    </div>
  );
}
