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
import { PageHeader, StatusBadge, downloadBase64Pdf, fmtDay, fmtEur, fmtMs, useEsignRole } from "./ContractsParts";

type Detail = inferRouterOutputs<AppRouter>["contractsEsign"]["get"];

function EditDraft({ c, onDone }: { c: Detail; onDone: () => void }) {
  const utils = trpc.useUtils();
  const [title, setTitle] = useState(c.title);
  const [body, setBody] = useState(c.body);
  const [amount, setAmount] = useState(c.amount ?? "");
  const save = trpc.contractsEsign.updateDraft.useMutation({
    onSuccess: () => { toast.success("Borrador guardado"); void utils.contractsEsign.get.invalidate({ id: c.id }); onDone(); },
    onError: (e) => toastError(e),
  });
  return (
    <div className="space-y-3">
      <FormField id="ed-title" label="Título" required>
        <Input id="ed-title" value={title} maxLength={ESIGN_LIMITS.titleMax} onChange={(e) => setTitle(e.target.value)} />
      </FormField>
      <FormField id="ed-amount" label="Importe en euros (opcional)">
        <Input id="ed-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </FormField>
      <FormField id="ed-body" label="Texto del contrato" required hint="Sustituye los ________ por los datos que faltan antes de enviarlo.">
        <Textarea id="ed-body" rows={16} value={body} maxLength={ESIGN_LIMITS.bodyMax} onChange={(e) => setBody(e.target.value)} />
      </FormField>
      <DialogFooter>
        <Button variant="outline" onClick={onDone}>Cancelar</Button>
        <Button
          disabled={save.isPending}
          onClick={() => {
            const a = String(amount).trim() ? Number(String(amount).replace(",", ".")) : null;
            if (a != null && (!Number.isFinite(a) || a < 0)) return toast.error("El importe no es válido.");
            save.mutate({ id: c.id, title, body, amount: a });
          }}
        >
          Guardar
        </Button>
      </DialogFooter>
    </div>
  );
}

function SendPanel({ c }: { c: Detail }) {
  const utils = trpc.useUtils();
  const [url, setUrl] = useState<string | null>(null);
  const [hours, setHours] = useState(String(ESIGN_LIMITS.linkDefaultHours));
  const refresh = () => { void utils.contractsEsign.get.invalidate({ id: c.id }); void utils.contractsEsign.list.invalidate(); };
  const send = trpc.contractsEsign.send.useMutation({
    onSuccess: (r, v) => {
      setUrl(r.url);
      if (v.email && r.mailed) toast.success("Enlace enviado al cliente por correo");
      else if (v.email) toast.warning(r.mailError ?? "No se pudo enviar el correo");
      else toast.success("Enlace de firma generado");
      refresh();
    },
    onError: (e) => toastError(e),
  });
  const revoke = trpc.contractsEsign.revokeLink.useMutation({ onSuccess: () => { setUrl(null); toast.success("Enlace desactivado"); refresh(); }, onError: (e) => toastError(e) });
  const h = Math.min(ESIGN_LIMITS.linkMaxHours, Math.max(1, Number(hours) || ESIGN_LIMITS.linkDefaultHours));
  return (
    <section className="space-y-2 rounded-lg border border-border p-3">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground"><Link2 className="h-4 w-4" aria-hidden="true" />Firma a distancia</h2>
      <p className="text-xs text-muted-foreground">
        {c.link
          ? `Enlace activo hasta el ${fmtMs(c.link.expiresAt)}. Es de un solo uso: al firmar o rechazar deja de valer.`
          : "Al enviarlo se fija el texto (ya no se puede editar) y se genera un enlace personal de un solo uso que caduca."}
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <FormField id="sd-hours" label="Validez del enlace (horas)">
          <Input id="sd-hours" className="w-28" inputMode="numeric" value={hours} onChange={(e) => setHours(e.target.value.replace(/\D/g, ""))} />
        </FormField>
        <Button size="sm" disabled={send.isPending || !c.customerEmail} onClick={() => send.mutate({ id: c.id, hours: h, email: true })} title={c.customerEmail ? undefined : "El cliente no tiene correo"}>
          <Mail className="mr-1.5 h-4 w-4" aria-hidden="true" />Enviar por correo
        </Button>
        <Button size="sm" variant="outline" disabled={send.isPending} onClick={() => send.mutate({ id: c.id, hours: h, email: false })}>
          {c.link ? "Generar un enlace nuevo" : "Solo generar el enlace"}
        </Button>
        {c.link && <Button size="sm" variant="ghost" disabled={revoke.isPending} onClick={() => revoke.mutate({ id: c.id })}>Desactivar el enlace</Button>}
      </div>
      {url && (
        <div className="space-y-1">
          <p className="break-all rounded bg-muted px-2 py-1 text-xs text-foreground">{url}</p>
          <Button size="sm" variant="outline" onClick={() => navigator.clipboard?.writeText(url).then(() => toast.success("Enlace copiado"))}>Copiar el enlace</Button>
          <p className="text-xs text-muted-foreground">Solo se muestra ahora: si lo pierdes, genera uno nuevo (el anterior deja de valer).</p>
        </div>
      )}
    </section>
  );
}

function PanelSign({ c }: { c: Detail }) {
  const utils = trpc.useUtils();
  const [name, setName] = useState(c.customerName);
  const [taxId, setTaxId] = useState("");
  const [accepted, setAccepted] = useState(false);
  const sign = trpc.contractsEsign.signInPanel.useMutation({
    onSuccess: () => { toast.success("Contrato firmado"); void utils.contractsEsign.get.invalidate({ id: c.id }); void utils.contractsEsign.list.invalidate(); },
    onError: (e) => toastError(e),
  });
  return (
    <section className="space-y-2 rounded-lg border border-border p-3">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground"><FileSignature className="h-4 w-4" aria-hidden="true" />Firma en este equipo</h2>
      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          sign.mutate({ id: c.id, signerName: name, signerTaxId: taxId || null, accepted });
        }}
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FormField id="ps-name" label="Nombre de quien firma" required>
            <Input id="ps-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={ESIGN_LIMITS.nameMax} required />
          </FormField>
          <FormField id="ps-tax" label="DNI/NIF (opcional)">
            <Input id="ps-tax" value={taxId} onChange={(e) => setTaxId(e.target.value)} maxLength={ESIGN_LIMITS.taxIdMax} />
          </FormField>
        </div>
        <label className="flex items-start gap-2 text-sm text-foreground">
          <input type="checkbox" className="mt-1" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} />
          Quien firma ha leído y acepta el contrato.
        </label>
        <Button type="submit" disabled={!accepted || sign.isPending}>Firmar</Button>
        <p className="text-xs text-muted-foreground">El cliente firma en este equipo. Se guardan su nombre, su DNI/NIF si lo indica, la fecha, la IP, el navegador, quién lo recoge y la huella del texto.</p>
      </form>
    </section>
  );
}

export default function ContractDetail({ id }: { id: number }) {
  const { canWrite, isAdmin } = useEsignRole();
  const utils = trpc.useUtils();
  const q = trpc.contractsEsign.get.useQuery({ id }, { retry: false });
  const [editing, setEditing] = useState(false);
  const [voiding, setVoiding] = useState(false);
  const [reason, setReason] = useState("");
  const [downloading, setDownloading] = useState(false);
  useEffect(() => setReason(""), [voiding]);
  const voidM = trpc.contractsEsign.void.useMutation({
    onSuccess: () => { toast.success("Contrato anulado"); setVoiding(false); void utils.contractsEsign.get.invalidate({ id }); void utils.contractsEsign.list.invalidate(); },
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
        <Link href={ESIGN_PATHS.contracts} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" aria-hidden="true" />Contratos</Link>
        {q.isLoading ? (
          <PanelLoading label="Cargando el contrato…" />
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
                  {canWrite && canTransition(c.status, "edit") && <Button size="sm" variant="outline" onClick={() => setEditing(true)}><Pencil className="mr-1.5 h-4 w-4" aria-hidden="true" />Editar</Button>}
                  {isAdmin && canTransition(c.status, "void") && <Button size="sm" variant="ghost" onClick={() => setVoiding(true)}><XCircle className="mr-1.5 h-4 w-4" aria-hidden="true" />Anular</Button>}
                  {c.status === "signed" && <Button size="sm" disabled={downloading} onClick={download}><Download className="mr-1.5 h-4 w-4" aria-hidden="true" />PDF firmado</Button>}
                </>
              }
            />
            {c.blanks && c.status === "draft" && <p className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-foreground">Faltan datos por completar (________). Edita el borrador antes de enviarlo o firmarlo.</p>}
            <p className="text-xs text-muted-foreground">
              {c.templateId ? `Plantilla #${c.templateId} (versión ${c.templateVersion}). ` : ""}
              {c.quoteId ? `Presupuesto #${c.quoteId}. ` : ""}
              {c.reservationId ? `Reserva #${c.reservationId}. ` : ""}
              Cliente del CRM #{c.clientId}.
            </p>
            <section className="space-y-2">
              <h2 className="text-sm font-semibold text-foreground">Texto del contrato</h2>
              <div className="max-h-[28rem] overflow-y-auto whitespace-pre-line break-words rounded-md border border-border bg-muted/40 px-4 py-3 text-sm text-foreground">{c.body}</div>
              {c.contentHash && <p className="break-all text-xs text-muted-foreground">Huella SHA-256 del texto fijado: {c.contentHash}</p>}
            </section>

            {c.status === "signed" && (
              <section className="space-y-1 rounded-lg border border-border p-3 text-sm">
                <h2 className="font-semibold text-foreground">Firma</h2>
                <p className="break-words text-foreground">
                  Firmado por {c.signerName}{c.signerTaxId ? ` (DNI/NIF ${c.signerTaxId})` : ""} el {fmtMs(c.signedAt)} {c.signedMethod === "link" ? "con el enlace" : "en el panel"}.
                </p>
                <p className="break-all text-xs text-muted-foreground">IP {c.signedIp ?? "desconocida"} · {c.signedUserAgent ?? "navegador desconocido"} · recogida por {c.signedBy}</p>
                {c.pdf && <p className="break-all text-xs text-muted-foreground">PDF guardado el {fmtMs(c.pdf.createdAt)} · SHA-256 {c.pdf.hash}</p>}
              </section>
            )}
            {(c.status === "rejected" || c.status === "void") && (
              <p className="rounded-lg border border-border px-3 py-2 text-sm text-foreground">
                {c.status === "rejected" ? "Rechazado por el cliente" : "Anulado"} el {fmtMs(c.closedAt)}{c.closeReason ? `: ${c.closeReason}` : "."}
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
              <h2 className="text-sm font-semibold text-foreground">Registro de evidencias</h2>
              <div className="overflow-x-auto rounded-xl border border-border">
                <table className="w-full min-w-[40rem] text-left text-xs">
                  <thead className="bg-muted/50 text-muted-foreground">
                    <tr><th className="px-3 py-2">Fecha</th><th className="px-3 py-2">Evento</th><th className="px-3 py-2">Quién</th><th className="px-3 py-2">IP</th><th className="px-3 py-2">Detalle</th></tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {c.events.map((e) => (
                      <tr key={e.id}>
                        <td className="whitespace-nowrap px-3 py-2">{fmtMs(e.createdAt)}</td>
                        <td className="px-3 py-2">{EVIDENCE_EVENT_LABEL[e.event] ?? e.event}</td>
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
                  <DialogTitle>Editar borrador</DialogTitle>
                  <DialogDescription>Solo se puede editar en borrador. Al enviarlo a firma el texto queda fijado con su huella.</DialogDescription>
                </DialogHeader>
                {editing && <EditDraft c={c} onDone={() => setEditing(false)} />}
              </DialogContent>
            </Dialog>
            <Dialog open={voiding} onOpenChange={setVoiding}>
              <DialogContent className="sm:max-w-md">
                <DialogHeader>
                  <DialogTitle>Anular el contrato</DialogTitle>
                  <DialogDescription>El contrato no se borra: queda anulado con el motivo y el enlace de firma deja de valer.</DialogDescription>
                </DialogHeader>
                <FormField id="vd-reason" label="Motivo" required>
                  <Textarea id="vd-reason" rows={3} maxLength={ESIGN_LIMITS.reasonMax} value={reason} onChange={(e) => setReason(e.target.value)} />
                </FormField>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setVoiding(false)}>Cancelar</Button>
                  <Button variant="destructive" disabled={voidM.isPending} onClick={() => voidM.mutate({ id, reason })}>Anular</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </>
        )}
      </div>
    </AdminLayout>
  );
}
