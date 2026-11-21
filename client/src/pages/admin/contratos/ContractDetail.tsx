/**
 * Contratos y firma electrónica · ficha (/admin/contratos/<id>): texto del contrato (editable en borrador), envío a firma
 * con enlace de un solo uso (por correo al cliente o copiándolo), firma en el panel (como el mostrador de Ski Net:
 * nombre escrito, DNI/NIF opcional y aceptación expresa en este equipo), anulación, PDF firmado y registro de evidencias.
 */
import { useEffect, useState } from "react";
import { Link } from "wouter";
import { ArrowLeft, Download, FileSignature, Link2, Mail, Pencil, XCircle } from "lucide-react";
import { toast } from "sonner";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../../../server/routers";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PanelError, PanelLoading, toastError } from "@/components/admin/PanelStates";
import { FormField } from "@/components/admin/crm/CrmParts";
import { ESIGN_LIMITS, ESIGN_PATHS, EVIDENCE_EVENT_LABEL, SIMPLE_SIGNATURE_NOTICE, canTransition } from "@shared/contractsEsign";
import { PageHeader, StatusBadge, downloadBase64Pdf, useEsignFmt, useEsignRole } from "./ContractsParts";
import { useI18n } from "@/i18n/I18nProvider";

type Detail = inferRouterOutputs<AppRouter>["contractsEsign"]["get"];

function EditDraft({ c, onDone }: { c: Detail; onDone: () => void }) {
  const { t } = useI18n();
  const utils = trpc.useUtils();
  const [title, setTitle] = useState(c.title);
  const [body, setBody] = useState(c.body);
  const [amount, setAmount] = useState(c.amount ?? "");
  const save = trpc.contractsEsign.updateDraft.useMutation({
    onSuccess: () => { toast.success(t("contracts.detail.draftSaved")); void utils.contractsEsign.get.invalidate({ id: c.id }); onDone(); },
    onError: (e) => toastError(e),
  });
  return (
    <div className="space-y-3">
      <FormField id="ed-title" label={t("contracts.templates.titleLabel")} required>
        <Input id="ed-title" value={title} maxLength={ESIGN_LIMITS.titleMax} onChange={(e) => setTitle(e.target.value)} />
      </FormField>
      <FormField id="ed-amount" label={t("contracts.create.amountLabel")}>
        <Input id="ed-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </FormField>
      <FormField id="ed-body" label={t("contracts.templates.bodyLabel")} required hint={t("contracts.detail.hint")}>
        <Textarea id="ed-body" rows={16} value={body} maxLength={ESIGN_LIMITS.bodyMax} onChange={(e) => setBody(e.target.value)} />
      </FormField>
      <DialogFooter>
        <Button variant="outline" onClick={onDone}>{t("common.cancel")}</Button>
        <Button
          disabled={save.isPending}
          onClick={() => {
            const a = String(amount).trim() ? Number(String(amount).replace(",", ".")) : null;
            if (a != null && (!Number.isFinite(a) || a < 0)) return toast.error(t("contracts.create.invalidAmount"));
            save.mutate({ id: c.id, title, body, amount: a });
          }}
        >
          {t("common.save")}
        </Button>
      </DialogFooter>
    </div>
  );
}

function SendPanel({ c }: { c: Detail }) {
  const { t } = useI18n();
  const { fmtMs } = useEsignFmt();
  const utils = trpc.useUtils();
  const [url, setUrl] = useState<string | null>(null);
  const [hours, setHours] = useState(String(ESIGN_LIMITS.linkDefaultHours));
  const refresh = () => { void utils.contractsEsign.get.invalidate({ id: c.id }); void utils.contractsEsign.list.invalidate(); };
  const send = trpc.contractsEsign.send.useMutation({
    onSuccess: (r, v) => {
      setUrl(r.url);
      if (v.email && r.mailed) toast.success(t("contracts.detail.mailSent"));
      else if (v.email) toast.warning(r.mailError ?? t("contracts.detail.mailFailed"));
      else toast.success(t("contracts.detail.linkGenerated"));
      refresh();
    },
    onError: (e) => toastError(e),
  });
  const revoke = trpc.contractsEsign.revokeLink.useMutation({ onSuccess: () => { setUrl(null); toast.success(t("contracts.detail.linkDeactivated")); refresh(); }, onError: (e) => toastError(e) });
  const h = Math.min(ESIGN_LIMITS.linkMaxHours, Math.max(1, Number(hours) || ESIGN_LIMITS.linkDefaultHours));
  return (
    <section className="space-y-2 rounded-lg border border-border p-3">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground"><Link2 className="h-4 w-4" aria-hidden="true" />{t("contracts.detail.remoteSign")}</h2>
      <p className="text-xs text-muted-foreground">
        {c.link
          ? t("contracts.detail.linkActive", { date: fmtMs(c.link.expiresAt) })
          : t("contracts.detail.linkInfo")}
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <FormField id="sd-hours" label={t("contracts.detail.hoursLabel")}>
          <Input id="sd-hours" className="w-28" inputMode="numeric" value={hours} onChange={(e) => setHours(e.target.value.replace(/\D/g, ""))} />
        </FormField>
        <Button size="sm" disabled={send.isPending || !c.customerEmail} onClick={() => send.mutate({ id: c.id, hours: h, email: true })} title={c.customerEmail ? undefined : t("contracts.detail.noClientEmail")}>
          <Mail className="mr-1.5 h-4 w-4" aria-hidden="true" />{t("contracts.detail.sendByMail")}
        </Button>
        <Button size="sm" variant="outline" disabled={send.isPending} onClick={() => send.mutate({ id: c.id, hours: h, email: false })}>
          {c.link ? t("contracts.detail.generateNew") : t("contracts.detail.generateOnly")}
        </Button>
        {c.link && <Button size="sm" variant="ghost" disabled={revoke.isPending} onClick={() => revoke.mutate({ id: c.id })}>{t("contracts.detail.deactivateLink")}</Button>}
      </div>
      {url && (
        <div className="space-y-1">
          <p className="break-all rounded bg-muted px-2 py-1 text-xs text-foreground">{url}</p>
          <Button size="sm" variant="outline" onClick={() => navigator.clipboard?.writeText(url).then(() => toast.success(t("contracts.detail.linkCopied")))}>{t("contracts.detail.copyLink")}</Button>
          <p className="text-xs text-muted-foreground">{t("contracts.detail.shownOnce")}</p>
        </div>
      )}
    </section>
  );
}

function PanelSign({ c }: { c: Detail }) {
  const { t } = useI18n();
  const utils = trpc.useUtils();
  const [name, setName] = useState(c.customerName);
  const [taxId, setTaxId] = useState("");
  const [accepted, setAccepted] = useState(false);
  const sign = trpc.contractsEsign.signInPanel.useMutation({
    onSuccess: () => { toast.success(t("contracts.detail.signed")); void utils.contractsEsign.get.invalidate({ id: c.id }); void utils.contractsEsign.list.invalidate(); },
    onError: (e) => toastError(e),
  });
  return (
    <section className="space-y-2 rounded-lg border border-border p-3">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground"><FileSignature className="h-4 w-4" aria-hidden="true" />{t("contracts.detail.panelSign")}</h2>
      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          sign.mutate({ id: c.id, signerName: name, signerTaxId: taxId || null, accepted });
        }}
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FormField id="ps-name" label={t("contracts.detail.signerName")} required>
            <Input id="ps-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={ESIGN_LIMITS.nameMax} required />
          </FormField>
          <FormField id="ps-tax" label={t("contracts.detail.signerTaxId")}>
            <Input id="ps-tax" value={taxId} onChange={(e) => setTaxId(e.target.value)} maxLength={ESIGN_LIMITS.taxIdMax} />
          </FormField>
        </div>
        <label className="flex items-start gap-2 text-sm text-foreground">
          <input type="checkbox" className="mt-1" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} />
          {t("contracts.detail.accept")}
        </label>
        <Button type="submit" disabled={!accepted || sign.isPending}>{t("contracts.detail.sign")}</Button>
        <p className="text-xs text-muted-foreground">{t("contracts.detail.panelSignInfo")}</p>
      </form>
    </section>
  );
}

export default function ContractDetail({ id }: { id: number }) {
  const { t } = useI18n();
  const { fmtDay, fmtEur, fmtMs } = useEsignFmt();
  const { canWrite, isAdmin } = useEsignRole();
  const utils = trpc.useUtils();
  const q = trpc.contractsEsign.get.useQuery({ id }, { retry: false });
  const [editing, setEditing] = useState(false);
  const [voiding, setVoiding] = useState(false);
  const [reason, setReason] = useState("");
  const [downloading, setDownloading] = useState(false);
  useEffect(() => setReason(""), [voiding]);
  const voidM = trpc.contractsEsign.void.useMutation({
    onSuccess: () => { toast.success(t("contracts.detail.voided")); setVoiding(false); void utils.contractsEsign.get.invalidate({ id }); void utils.contractsEsign.list.invalidate(); },
    onError: (e) => toastError(e),
  });
  const download = async () => {
    setDownloading(true);
    try {
      const r = await utils.contractsEsign.downloadPdf.fetch({ id }, { staleTime: 0 });
      downloadBase64Pdf(r.filename, r.base64);
      void utils.contractsEsign.get.invalidate({ id });
    } catch (e) {
      toastError(e as never);
    } finally {
      setDownloading(false);
    }
  };
  const c = q.data;
  return (
    <AdminLayout>
      <div className="mx-auto max-w-5xl space-y-5">
        <Link href={ESIGN_PATHS.contracts} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" aria-hidden="true" />{t("contracts.detail.back")}</Link>
        {q.isLoading ? (
          <PanelLoading label={t("contracts.detail.loading")} />
        ) : q.isError || !c ? (
          <PanelError error={q.error} onRetry={() => q.refetch()} />
        ) : (
          <>
            <PageHeader
              title={`#${c.id} · ${c.title}`}
              description={`${c.customerName}${c.customerEmail ? ` · ${c.customerEmail}` : ""} · ${fmtDay(c.contractDate)}${c.amount != null ? ` · ${fmtEur(c.amount)}` : ""}`}
              actions={
                <>
                  <StatusBadge status={c.status} />
                  {canWrite && canTransition(c.status, "edit") && <Button size="sm" variant="outline" onClick={() => setEditing(true)}><Pencil className="mr-1.5 h-4 w-4" aria-hidden="true" />{t("common.edit")}</Button>}
                  {isAdmin && canTransition(c.status, "void") && <Button size="sm" variant="ghost" onClick={() => setVoiding(true)}><XCircle className="mr-1.5 h-4 w-4" aria-hidden="true" />{t("contracts.detail.void")}</Button>}
                  {c.status === "signed" && <Button size="sm" disabled={downloading} onClick={download}><Download className="mr-1.5 h-4 w-4" aria-hidden="true" />{t("contracts.detail.pdfSigned")}</Button>}
                </>
              }
            />
            {c.blanks && c.status === "draft" && <p className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-foreground">{t("contracts.detail.blanks")}</p>}
            <p className="text-xs text-muted-foreground">
              {c.templateId ? t("contracts.detail.template", { id: c.templateId, version: c.templateVersion }) : ""}
              {c.quoteId ? t("contracts.detail.quote", { id: c.quoteId }) : ""}
              {c.reservationId ? t("contracts.detail.reservation", { id: c.reservationId }) : ""}
              {t("contracts.detail.crmClient", { id: c.clientId })}
            </p>
            <section className="space-y-2">
              <h2 className="text-sm font-semibold text-foreground">{t("contracts.detail.bodyTitle")}</h2>
              <div className="max-h-[28rem] overflow-y-auto whitespace-pre-line break-words rounded-md border border-border bg-muted/40 px-4 py-3 text-sm text-foreground">{c.body}</div>
              {c.contentHash && <p className="break-all text-xs text-muted-foreground">{t("contracts.detail.hash", { hash: c.contentHash })}</p>}
            </section>

            {c.status === "signed" && (
              <section className="space-y-1 rounded-lg border border-border p-3 text-sm">
                <h2 className="font-semibold text-foreground">{t("contracts.detail.signatureTitle")}</h2>
                <p className="break-words text-foreground">
                  {t("contracts.detail.signedBy", { name: c.signerName, tax: c.signerTaxId ? t("contracts.detail.taxPart", { tax: c.signerTaxId }) : "", date: fmtMs(c.signedAt), method: c.signedMethod === "link" ? t("contracts.detail.byLink") : t("contracts.detail.inPanel") })}
                </p>
                <p className="break-all text-xs text-muted-foreground">{t("contracts.detail.ipLine", { ip: c.signedIp ?? t("contracts.detail.unknownIp"), agent: c.signedUserAgent ?? t("contracts.detail.unknownAgent"), by: c.signedBy })}</p>
                {c.pdf && <p className="break-all text-xs text-muted-foreground">{t("contracts.detail.pdfStored", { date: fmtMs(c.pdf.createdAt), hash: c.pdf.hash })}</p>}
              </section>
            )}
            {(c.status === "rejected" || c.status === "void") && (
              <p className="rounded-lg border border-border px-3 py-2 text-sm text-foreground">
                {t("contracts.detail.closedOn", { what: c.status === "rejected" ? t("contracts.detail.rejectedBy") : t("contracts.detail.voidedLabel"), date: fmtMs(c.closedAt), reason: c.closeReason ? `: ${c.closeReason}` : "." })}
              </p>
            )}
            {canWrite && (c.status === "draft" || c.status === "sent") && (
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                <SendPanel c={c} />
                <PanelSign c={c} />
              </div>
            )}
            <p className="text-xs text-muted-foreground">{SIMPLE_SIGNATURE_NOTICE}</p>

            <section className="space-y-2">
              <h2 className="text-sm font-semibold text-foreground">{t("contracts.detail.evidence")}</h2>
              <div className="overflow-x-auto rounded-xl border border-border">
                <table className="w-full min-w-[40rem] text-left text-xs">
                  <thead className="bg-muted/50 text-muted-foreground">
                    <tr><th className="px-3 py-2">{t("contracts.detail.colDate")}</th><th className="px-3 py-2">{t("contracts.detail.colEvent")}</th><th className="px-3 py-2">{t("contracts.detail.colWho")}</th><th className="px-3 py-2">{t("contracts.detail.colIp")}</th><th className="px-3 py-2">{t("contracts.detail.colDetail")}</th></tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {c.events.map((e) => (
                      <tr key={e.id}>
                        <td className="whitespace-nowrap px-3 py-2">{fmtMs(e.createdAt)}</td>
                        <td className="px-3 py-2">{e.event in EVIDENCE_EVENT_LABEL ? t(`contracts.events.${e.event}`) : e.event}</td>
                        <td className="px-3 py-2">{e.actor}</td>
                        <td className="px-3 py-2">{e.ip ?? ""}</td>
                        <td className="break-all px-3 py-2" title={e.userAgent ?? undefined}>{e.detail ?? ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <Dialog open={editing} onOpenChange={setEditing}>
              <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
                <DialogHeader>
                  <DialogTitle>{t("contracts.detail.editDraft")}</DialogTitle>
                  <DialogDescription>{t("contracts.detail.editDescription")}</DialogDescription>
                </DialogHeader>
                {editing && <EditDraft c={c} onDone={() => setEditing(false)} />}
              </DialogContent>
            </Dialog>
            <Dialog open={voiding} onOpenChange={setVoiding}>
              <DialogContent className="sm:max-w-md">
                <DialogHeader>
                  <DialogTitle>{t("contracts.detail.voidTitle")}</DialogTitle>
                  <DialogDescription>{t("contracts.detail.voidDescription")}</DialogDescription>
                </DialogHeader>
                <FormField id="vd-reason" label={t("contracts.detail.reason")} required>
                  <Textarea id="vd-reason" rows={3} maxLength={ESIGN_LIMITS.reasonMax} value={reason} onChange={(e) => setReason(e.target.value)} />
                </FormField>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setVoiding(false)}>{t("common.cancel")}</Button>
                  <Button variant="destructive" disabled={voidM.isPending} onClick={() => voidM.mutate({ id, reason })}>{t("contracts.detail.void")}</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </>
        )}
      </div>
    </AdminLayout>
  );
}
