import React from "react";
import { Waves, Users, Plus, Minus, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { trpc } from "@/lib/trpc";

// ─── Tipos exportados ─────────────────────────────────────────────────────────

export interface ActivityEntry {
  experienceId: number;
  experienceTitle: string;
  family: string;
  participants: number;
  details: Record<string, string | number>;
}

export interface ModalState {
  open: boolean;
  experienceId: number;
  experienceTitle: string;
  family: string;
  slug: string;
}

// ─── Helpers exportados ───────────────────────────────────────────────────────

export const FAMILY_MAP: Record<string, string> = {
  "blob-jump": "saltos",
  "banana-ski": "remolcado",
  "cableski": "cableski",
  "canoas": "alquiler",
  "paddle-surf": "alquiler",
  "hidrobicis": "alquiler",
  "aventura-hinchable": "alquiler",
  "circuito-spa": "spa",
  "donuts-ski": "remolcado",
};

export function getFamilyForSlug(slug: string): string {
  for (const [key, fam] of Object.entries(FAMILY_MAP)) {
    if (slug.includes(key)) return fam;
  }
  return "generico";
}

const FAMILY_CHIP_COLORS: Record<string, { active: string; hover: string }> = {
  saltos:    { active: "bg-amber-500/20 text-amber-300 border-amber-500/50",    hover: "hover:border-amber-500/30 hover:text-white/80" },
  cableski:  { active: "bg-sky-500/20 text-sky-300 border-sky-500/50",          hover: "hover:border-sky-500/30 hover:text-white/80" },
  remolcado: { active: "bg-amber-500/20 text-amber-300 border-amber-500/50",    hover: "hover:border-amber-500/30 hover:text-white/80" },
  alquiler:  { active: "bg-amber-500/20 text-amber-300 border-amber-500/50",    hover: "hover:border-amber-500/30 hover:text-white/80" },
  barco:     { active: "bg-sky-500/20 text-sky-300 border-sky-500/50",          hover: "hover:border-sky-500/30 hover:text-white/80" },
  spa:       { active: "bg-violet-500/20 text-violet-300 border-violet-500/50", hover: "hover:border-violet-500/30 hover:text-white/80" },
  generico:  { active: "bg-amber-500/20 text-amber-300 border-amber-500/50",    hover: "hover:border-amber-500/30 hover:text-white/80" },
};

// ─── Componente ───────────────────────────────────────────────────────────────

export default function ActivityModal({
  modal,
  totalPersons,
  onClose,
  onConfirm,
}: {
  modal: ModalState;
  totalPersons: number;
  onClose: () => void;
  onConfirm: (entry: ActivityEntry) => void;
}) {
  const [participants, setParticipants] = React.useState(totalPersons || 1);
  const [details, setDetails] = React.useState<Record<string, string | number>>({});

  const { data: variants, isLoading: variantsLoading } = trpc.public.getVariantsByExperience.useQuery(
    { experienceId: modal.experienceId },
    { enabled: modal.open && modal.experienceId > 0 }
  );

  const prevExpId = React.useRef(modal.experienceId);
  React.useEffect(() => {
    if (modal.experienceId !== prevExpId.current) {
      setDetails({});
      setParticipants(totalPersons || 1);
      prevExpId.current = modal.experienceId;
    }
  }, [modal.experienceId, totalPersons]);

  const handleConfirm = () => {
    onConfirm({ experienceId: modal.experienceId, experienceTitle: modal.experienceTitle, family: modal.family, participants, details });
  };

  const setDetail = (key: string, value: string | number) => {
    setDetails((prev) => ({ ...prev, [key]: value }));
  };

  const chipColors = FAMILY_CHIP_COLORS[modal.family] ?? FAMILY_CHIP_COLORS.generico;

  const renderVariantFields = () => {
    if (variantsLoading) {
      return (
        <div className="flex items-center gap-2 text-white/40 text-xs py-2">
          <div className="w-3 h-3 rounded-full border border-white/20 border-t-white/60 animate-spin" />
          Cargando opciones…
        </div>
      );
    }
    if (variants && variants.length > 0) {
      return (
        <div className="space-y-4">
          <div>
            <Label className="text-white/60 text-xs mb-2 block">¿Qué formato prefieres?</Label>
            <div className="flex flex-wrap gap-2">
              {variants.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => setDetail("variante", v.name)}
                  className={`px-3 py-1.5 rounded-full text-xs border transition-all ${
                    details.variante === v.name
                      ? chipColors.active
                      : `border-white/15 text-white/50 bg-white/[0.04] ${chipColors.hover}`
                  }`}
                  title={v.description ?? undefined}
                >
                  {v.name}
                  {v.priceModifier && Number(v.priceModifier) > 0 && (
                    <span className="ml-1.5 opacity-60">
                      {v.priceType === "per_person" ? `${v.priceModifier}€/pax` : `${v.priceModifier}€`}
                    </span>
                  )}
                </button>
              ))}
            </div>
            {details.variante && (() => {
              const sel = variants.find(v => v.name === details.variante);
              return sel?.description ? <p className="text-white/30 text-xs mt-2">{sel.description}</p> : null;
            })()}
          </div>
          <div>
            <Label className="text-white/60 text-xs mb-2 block">Notas adicionales (opcional)</Label>
            <Textarea
              value={String(details.notas || "")}
              onChange={(e) => setDetail("notas", e.target.value)}
              className="bg-white/[0.07] border-white/10 text-white placeholder:text-white/20 rounded-xl text-sm resize-none"
              rows={2}
              placeholder="Preferencias, restricciones, nivel…"
            />
          </div>
        </div>
      );
    }
    return renderFamilyFallback();
  };

  const renderFamilyFallback = () => {
    const chipCls = (key: string, val: string) =>
      `px-3 py-1.5 rounded-full text-xs border transition-all ${
        (details[key] as string) === val
          ? chipColors.active
          : `border-white/15 text-white/50 bg-white/[0.04] ${chipColors.hover}`
      }`;

    switch (modal.family) {
      case "cableski":
        return (
          <div className="space-y-4">
            <div>
              <Label className="text-white/60 text-xs mb-2 block">Duración preferida</Label>
              <div className="flex flex-wrap gap-2">
                {["30 minutos", "1 hora", "2 horas", "Día completo"].map((opt) => (
                  <button key={opt} type="button" onClick={() => setDetail("duracion", opt)} className={chipCls("duracion", opt)}>{opt}</button>
                ))}
              </div>
            </div>
            <div>
              <Label className="text-white/60 text-xs mb-2 block">Nivel de experiencia</Label>
              <div className="flex flex-wrap gap-2">
                {["Principiante", "Intermedio", "Avanzado"].map((opt) => (
                  <button key={opt} type="button" onClick={() => setDetail("nivel", opt)} className={chipCls("nivel", opt)}>{opt}</button>
                ))}
              </div>
            </div>
          </div>
        );
      case "saltos":
        return (
          <div className="space-y-4">
            <div>
              <Label className="text-white/60 text-xs mb-2 block">Número de saltos en total (grupo)</Label>
              <div className="flex items-center gap-3">
                <button type="button" onClick={() => setDetail("saltos", Math.max(1, (Number(details.saltos) || 1) - 1))}
                  className="w-8 h-8 rounded-full bg-white/10 border border-white/15 flex items-center justify-center text-white hover:bg-white/20 transition-colors">
                  <Minus className="w-3 h-3" />
                </button>
                <span className="text-white font-bold text-xl w-8 text-center">{details.saltos || 1}</span>
                <button type="button" onClick={() => setDetail("saltos", (Number(details.saltos) || 1) + 1)}
                  className="w-8 h-8 rounded-full bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-300 hover:bg-amber-500/30 transition-colors">
                  <Plus className="w-3 h-3" />
                </button>
              </div>
              <p className="text-white/30 text-xs mt-2">Ej: si sois 5 y cada uno quiere 2 saltos → 10 saltos</p>
            </div>
          </div>
        );
      case "remolcado":
        return (
          <div className="space-y-4">
            <div>
              <Label className="text-white/60 text-xs mb-2 block">Duración preferida</Label>
              <div className="flex flex-wrap gap-2">
                {["15 minutos", "30 minutos", "1 hora"].map((opt) => (
                  <button key={opt} type="button" onClick={() => setDetail("duracion", opt)} className={chipCls("duracion", opt)}>{opt}</button>
                ))}
              </div>
            </div>
          </div>
        );
      case "alquiler":
        return (
          <div className="space-y-4">
            <div>
              <Label className="text-white/60 text-xs mb-2 block">Duración del alquiler</Label>
              <div className="flex flex-wrap gap-2">
                {["30 minutos", "1 hora", "2 horas", "Medio día", "Día completo"].map((opt) => (
                  <button key={opt} type="button" onClick={() => setDetail("duracion", opt)} className={chipCls("duracion", opt)}>{opt}</button>
                ))}
              </div>
            </div>
            <div>
              <Label className="text-white/60 text-xs mb-2 block">Notas adicionales (opcional)</Label>
              <Textarea
                value={String(details.notas || "")}
                onChange={(e) => setDetail("notas", e.target.value)}
                className="bg-white/[0.07] border-white/10 text-white placeholder:text-white/20 rounded-xl text-sm resize-none"
                rows={2}
                placeholder="Cuéntanos qué tienes en mente…"
              />
            </div>
          </div>
        );
      case "barco":
        return (
          <div className="space-y-4">
            <div>
              <Label className="text-white/60 text-xs mb-2 block">Tipo de embarcación</Label>
              <div className="flex flex-wrap gap-2">
                {["Barco pequeño (hasta 8 pax)", "Barco grande (hasta 20 pax)"].map((opt) => (
                  <button key={opt} type="button" onClick={() => setDetail("tipo", opt)} className={chipCls("tipo", opt)}>{opt}</button>
                ))}
              </div>
            </div>
            <div>
              <Label className="text-white/60 text-xs mb-2 block">Duración</Label>
              <div className="flex flex-wrap gap-2">
                {["1 hora", "2 horas", "Medio día"].map((opt) => (
                  <button key={opt} type="button" onClick={() => setDetail("duracion", opt)} className={chipCls("duracion", opt)}>{opt}</button>
                ))}
              </div>
            </div>
          </div>
        );
      case "spa":
        return (
          <div className="space-y-4">
            <div>
              <Label className="text-white/60 text-xs mb-2 block">Tipo de circuito</Label>
              <div className="flex flex-wrap gap-2">
                {["Circuito básico (2h)", "Circuito premium (3h)", "Circuito pareja"].map((opt) => (
                  <button key={opt} type="button" onClick={() => setDetail("tipo", opt)} className={chipCls("tipo", opt)}>{opt}</button>
                ))}
              </div>
            </div>
          </div>
        );
      default:
        return (
          <div>
            <Label className="text-white/60 text-xs mb-2 block">Preferencias adicionales (opcional)</Label>
            <Textarea
              value={String(details.notas || "")}
              onChange={(e) => setDetail("notas", e.target.value)}
              className="bg-white/[0.07] border-white/10 text-white placeholder:text-white/20 rounded-xl text-sm resize-none"
              rows={2}
              placeholder="Cuéntanos qué tienes en mente…"
            />
          </div>
        );
    }
  };

  return (
    <Dialog open={modal.open} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-md" style={{
        background: "rgba(10, 20, 40, 0.95)",
        backdropFilter: "blur(20px)",
        border: "1px solid rgba(255,255,255,0.12)",
        color: "white",
      }}>
        <DialogHeader>
          <div className="flex items-center gap-2 mb-1">
            <div className="w-8 h-8 rounded-full bg-amber-500/20 border border-amber-500/30 flex items-center justify-center">
              <Waves className="w-4 h-4 text-amber-400" />
            </div>
            <DialogTitle className="text-white text-base font-heading">{modal.experienceTitle}</DialogTitle>
          </div>
        </DialogHeader>

        <div className="space-y-5 py-2">
          <div>
            <Label className="text-white/60 text-xs mb-2 block flex items-center gap-1">
              <Users className="w-3 h-3" /> ¿Cuántas personas participan en esta actividad?
            </Label>
            <div className="flex items-center gap-3">
              <button type="button" onClick={() => setParticipants(Math.max(1, participants - 1))}
                className="w-8 h-8 rounded-full bg-white/10 border border-white/15 flex items-center justify-center text-white hover:bg-white/20 transition-colors">
                <Minus className="w-3 h-3" />
              </button>
              <span className="text-white font-bold text-xl w-8 text-center">{participants}</span>
              <button type="button" onClick={() => setParticipants(participants + 1)}
                className="w-8 h-8 rounded-full bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-300 hover:bg-amber-500/30 transition-colors">
                <Plus className="w-3 h-3" />
              </button>
            </div>
            {participants < (totalPersons || 1) && (
              <p className="text-amber-400/70 text-xs mt-1.5">
                De {totalPersons} personas del grupo, {participants} participan en esta actividad
              </p>
            )}
          </div>
          {renderVariantFields()}
        </div>

        <DialogFooter className="flex gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose}
            className="flex-1 border-white/15 text-white/60 hover:text-white hover:border-white/30 bg-transparent">
            <ChevronLeft className="w-3.5 h-3.5 mr-1" /> Cancelar
          </Button>
          <Button type="button" onClick={handleConfirm}
            className="flex-1 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-white border-0">
            Añadir actividad <ChevronRight className="w-3.5 h-3.5 ml-1" />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
