import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useVocabulary } from "@/lib/vocabulary";
import { errorToastMessage } from "@/lib/errorMessage";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { XCircle, X } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";

// ─── MODAL: Anular Reserva — paso 1: motivo e inicio del expediente ──────────
export function AnularReservaModal({
  reservationId,
  reservationName,
  onClose,
  onCreated,
}: {
  reservationId: number;
  reservationName: string;
  onClose: () => void;
  onCreated: (requestId: number) => void;
}) {
  const { t } = useI18n();
  const voc = useVocabulary();
  const [reason, setReason] = useState<"meteorologicas" | "accidente" | "enfermedad" | "desistimiento" | "otra">("otra");
  const [reasonDetail, setReasonDetail] = useState("");
  const [adminNotes, setAdminNotes] = useState("");

  const createMutation = trpc.cancellations.createManualRequest.useMutation({
    onSuccess: (data) => {
      toast.success(t("crmReservations.expedienteDeAnulacionCreado"));
      onCreated(data.requestId);
    },
    onError: (e) => toast.error(errorToastMessage(e)),
  });

  const handleSubmit = () => {
    createMutation.mutate({
      fullName: reservationName,
      activityDate: new Date().toISOString().split("T")[0],
      reason,
      reasonDetail: reasonDetail.trim() || undefined,
      adminNotes: adminNotes.trim() || undefined,
      linkedReservationId: reservationId,
    });
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-[#111] border border-warning/30 rounded-2xl p-6 max-w-md w-full">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 bg-warning/10 rounded-full flex items-center justify-center flex-shrink-0">
            <XCircle className="w-5 h-5 text-warning" />
          </div>
          <div>
            <h2 className="text-white font-semibold">{t("crmReservations.iniciarAnulacion")}</h2>
            <p className="text-gray-400 text-xs mt-0.5 overflow-hidden text-ellipsis whitespace-nowrap max-w-[280px]">{reservationName}</p>
          </div>
          <button onClick={onClose} className="ml-auto text-gray-500 hover:text-foreground">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="bg-info/8 border border-info/20 rounded-xl px-4 py-3 mb-5">
          <p className="text-info text-xs">{t("crmReservations.seCrearaUnExpediente")}{" "}{voc.licensed ? t("crmReservations.delPedido") : t("crmReservations.deLaReserva")}{t("crmReservations.elegirSiCancelarLineas")}</p>
        </div>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-gray-300 text-sm">{t("crmReservations.motivoDeLaAnulacion")}</label>
            <Select value={reason} onValueChange={(v) => setReason(v as typeof reason)}>
              <SelectTrigger className="bg-[#1a1a1a] border-foreground/[0.12] text-gray-300">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="meteorologicas">{t("crmReservations.condicionesMeteorologicas")}</SelectItem>
                <SelectItem value="accidente">{t("crmReservations.accidente")}</SelectItem>
                <SelectItem value="enfermedad">{t("crmReservations.enfermedad")}</SelectItem>
                <SelectItem value="desistimiento">{t("crmReservations.desistimientoVoluntario")}</SelectItem>
                <SelectItem value="otra">{t("crmReservations.otra")}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <label className="text-gray-300 text-sm">{t("crmReservations.detalleDelMotivoOpcional")}</label>
            <textarea
              value={reasonDetail}
              onChange={(e) => setReasonDetail(e.target.value)}
              placeholder={t("crmReservations.explicacionAdicional")}
              rows={2}
              className="w-full bg-[#1a1a1a] border border-foreground/[0.12] rounded-lg px-3 py-2 text-white text-sm placeholder:text-gray-600 resize-none focus:outline-none focus:border-warning/40"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-gray-300 text-sm">{t("crmReservations.notasInternasOpcional")}</label>
            <textarea
              value={adminNotes}
              onChange={(e) => setAdminNotes(e.target.value)}
              placeholder={t("crmReservations.anotacionesParaElExpediente")}
              rows={2}
              className="w-full bg-[#1a1a1a] border border-foreground/[0.12] rounded-lg px-3 py-2 text-white text-sm placeholder:text-gray-600 resize-none focus:outline-none focus:border-foreground/[0.18]"
            />
          </div>
        </div>

        <div className="flex gap-3 mt-6">
          <button
            onClick={onClose}
            className="flex-1 py-2 rounded-xl border border-foreground/[0.12] text-gray-400 text-sm hover:text-foreground hover:bg-foreground/[0.05] transition-colors"
          >{t("crmReservations.cancelar")}</button>
          <button
            onClick={handleSubmit}
            disabled={createMutation.isPending}
            className="flex-1 py-2 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground text-sm font-medium transition-colors disabled:opacity-50"
          >
            {createMutation.isPending ? t("crmReservations.creandoExpediente") : t("crmReservations.continuar")}
          </button>
        </div>
      </div>
    </div>
  );
}