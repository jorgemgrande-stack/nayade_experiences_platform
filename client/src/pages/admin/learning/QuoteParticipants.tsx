/**
 * Retiros con varias plazas: identificar a cada persona de una reserva (cada una recibe SU derecho pendiente de activar) y decidir
 * las devoluciones parciales. Las plazas las fija la reserva confirmada; aquí no se cambia ningún importe ni se ejecuta ningún reembolso.
 */
import { useState } from "react";
import { toast } from "sonner";
import { AlertTriangle } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PanelError } from "@/components/admin/PanelStates";
import { PanelDataList } from "@/components/admin/PanelUi";
import { confirmAction } from "@/components/admin/ConfirmHost";
import { toastError } from "@/lib/errorMessage";
import { useI18n } from "@/i18n/I18nProvider";

/** Personas identificadas de una reserva y alta de nuevas (hasta completar las plazas). */
export function QuoteParticipantsManager({ quoteId, seats, onChanged }: { quoteId: number; seats: number; onChanged: () => void }) {
  const { t } = useI18n();
  const utils = trpc.useUtils();
  const q = trpc.learning.admin.quoteParticipants.useQuery({ quoteId });
  const add = trpc.learning.admin.addQuoteParticipant.useMutation();
  const remove = trpc.learning.admin.removeQuoteParticipant.useMutation();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const active = (q.data ?? []).filter((p) => p.status === "active");
  const full = active.length + 1 >= seats;
  async function submit() {
    setBusy(true);
    try {
      const r = await add.mutateAsync({ quoteId, name, email });
      toast.success(r.created ? t("learningAdmin.participants.added") : t("learningAdmin.participants.already"));
      setName("");
      setEmail("");
      await utils.learning.admin.quoteParticipants.invalidate({ quoteId });
      onChanged();
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  }
  async function drop(participantId: number, who: string) {
    if (!(await confirmAction({ title: t("learningAdmin.participants.removeTitle"), description: t("learningAdmin.participants.removeDesc", { name: who }), confirmLabel: t("learningAdmin.participants.remove") }))) return;
    setBusy(true);
    try {
      await remove.mutateAsync({ participantId, reason: t("learningAdmin.participants.removeReason") });
      toast.success(t("learningAdmin.participants.removed"));
      await utils.learning.admin.quoteParticipants.invalidate({ quoteId });
      onChanged();
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-2 rounded-lg border bg-background p-3 text-sm" data-testid={`participantes-${quoteId}`}>
      <p className="text-muted-foreground">{t("learningAdmin.participants.intro", { seats, free: Math.max(0, seats - 1 - active.length) })}</p>
      {active.length > 0 && (
        <ul className="space-y-1">
          {active.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-2">
              <span>{p.name} · <span className="text-muted-foreground">{p.email}</span></span>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => void drop(p.id, p.name)}>{t("learningAdmin.participants.remove")}</Button>
            </li>
          ))}
        </ul>
      )}
      {!full && (
        <div className="flex flex-wrap items-center gap-2">
          <Input aria-label={t("learningAdmin.participants.name")} placeholder={t("learningAdmin.participants.name")} className="h-8 w-44" value={name} onChange={(e) => setName(e.target.value)} />
          <Input aria-label={t("learningAdmin.participants.email")} placeholder={t("learningAdmin.participants.email")} className="h-8 w-56" value={email} onChange={(e) => setEmail(e.target.value)} />
          <Button size="sm" variant="outline" disabled={busy || !name.trim() || !email.includes("@")} onClick={() => void submit()}>{t("learningAdmin.participants.add")}</Button>
        </div>
      )}
    </div>
  );
}

/** Devoluciones parciales de presupuestos pendientes de decidir: se retira a quien se marque y los demás conservan su acceso. */
export function QuoteRefundReviews() {
  const { t } = useI18n();
  const utils = trpc.useUtils();
  const q = trpc.learning.admin.quoteRefundReviews.useQuery();
  const resolve = trpc.learning.admin.resolveQuoteRefundReview.useMutation();
  const [marked, setMarked] = useState<Record<number, number[]>>({});
  const [busy, setBusy] = useState<number | null>(null);
  async function decide(quoteId: number, quoteNumber: string) {
    const ids = marked[quoteId] ?? [];
    if (!(await confirmAction({ title: t("learningAdmin.refundReview.confirmTitle"), description: t("learningAdmin.refundReview.confirmDesc", { quote: quoteNumber, n: ids.length }), confirmLabel: ids.length ? t("learningAdmin.refundReview.revoke") : t("learningAdmin.refundReview.keep") }))) return;
    setBusy(quoteId);
    try {
      const r = await resolve.mutateAsync({ quoteId, revokeEnrollmentIds: ids, reason: t("learningAdmin.refundReview.reason") });
      toast.success(t("learningAdmin.refundReview.done", { revoked: r.revoked, kept: r.kept }));
      await Promise.all([utils.learning.admin.quoteRefundReviews.invalidate(), utils.learning.admin.enrollments.invalidate()]);
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(null);
    }
  }
  if (q.isLoading) return null;
  if (q.isError) return <PanelError title={t("learningAdmin.refundReview.errorTitle")} error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data!.length) return null;
  const eur = (c: number | null) => (c == null ? "—" : `${(c / 100).toLocaleString("es-ES", { minimumFractionDigits: 2 })} €`);
  return (
    <section className="space-y-3 rounded-xl border border-warning/50 bg-warning/10 p-4" aria-labelledby="learning-refund-review-title">
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warning" aria-hidden="true" />
        <div>
          <h2 id="learning-refund-review-title" className="font-semibold text-foreground">{t("learningAdmin.refundReview.title", { n: q.data!.length })}</h2>
          <p className="text-sm text-muted-foreground">{t("learningAdmin.refundReview.intro")}</p>
        </div>
      </div>
      <PanelDataList
        caption={t("learningAdmin.refundReview.title", { n: q.data!.length })}
        rows={q.data!}
        rowKey={(r) => r.quoteId}
        columns={[
          { key: "quote", header: t("learningAdmin.pendingQuotes.quote"), cell: (r) => <span className="font-mono">{r.quoteNumber}</span> },
          { key: "amount", header: t("learningAdmin.refundReview.amount"), cell: (r) => `${eur(r.refundedCents)} / ${eur(r.chargedCents)}` },
          {
            key: "people", header: t("learningAdmin.refundReview.people"),
            cell: (r) => (
              <ul className="space-y-1">
                {r.people.map((p) => (
                  <li key={p.enrollmentId}>
                    <label className="flex items-center gap-2">
                      <input type="checkbox" checked={(marked[r.quoteId] ?? []).includes(p.enrollmentId)} onChange={(e) => setMarked({ ...marked, [r.quoteId]: e.target.checked ? [...(marked[r.quoteId] ?? []), p.enrollmentId] : (marked[r.quoteId] ?? []).filter((x) => x !== p.enrollmentId) })} />
                      <span>{p.name ?? p.email} <span className="text-muted-foreground">{p.email}</span></span>
                    </label>
                  </li>
                ))}
              </ul>
            ),
          },
          { key: "actions", header: t("learningAdmin.enrollments.actions"), align: "right", cell: (r) => <Button size="sm" variant="outline" disabled={busy != null} onClick={() => void decide(r.quoteId, r.quoteNumber)}>{(marked[r.quoteId] ?? []).length ? t("learningAdmin.refundReview.revoke") : t("learningAdmin.refundReview.keep")}</Button> },
        ]}
      />
    </section>
  );
}
