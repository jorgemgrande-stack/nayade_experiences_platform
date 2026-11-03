/**
 * Sedes de la empresa (capacidad Business `multi-site`): listar, añadir hasta el límite del plan, renombrar, datos de
 * contacto, desactivar y reactivar. Las sedes viven en el registro del plano de control (sites.*); el límite lo aplica
 * él. Essential ve su única sede (la principal), puede editar sus datos y no puede añadir otras.
 */
import { useState } from "react";
import { Building2, MapPin, Pencil, Plus, RotateCcw, Archive, Phone, Mail } from "lucide-react";
import { toast } from "sonner";
import { Link } from "wouter";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { PanelError, PanelLoading } from "@/components/admin/PanelStates";
import { FormField, describedBy } from "@/components/admin/crm/CrmParts";
import { toastError } from "@/lib/errorMessage";
import { validateSiteForm, type PanelSite, type SiteFormInput } from "@shared/sites";

type Form = { name: string; address: string; phone: string; email: string };
const emptyForm: Form = { name: "", address: "", phone: "", email: "" };
const toForm = (s: PanelSite): Form => ({ name: s.name, address: s.address ?? "", phone: s.phone ?? "", email: s.email ?? "" });

function SiteEditor({ site, onClose }: { site: PanelSite | null; onClose: () => void }) {
  const utils = trpc.useUtils();
  const [form, setForm] = useState<Form>(site ? toForm(site) : emptyForm);
  const [submitted, setSubmitted] = useState(false);
  const errors = validateSiteForm(form as SiteFormInput);
  const done = (msg: string) => {
    void utils.sites.list.invalidate();
    toast.success(msg);
    onClose();
  };
  const create = trpc.sites.create.useMutation({ onSuccess: () => done("Sede añadida"), onError: (e) => toastError(e, "No se ha podido añadir la sede.") });
  const update = trpc.sites.update.useMutation({ onSuccess: () => done("Sede guardada"), onError: (e) => toastError(e, "No se ha podido guardar la sede.") });
  const pending = create.isPending || update.isPending;
  const err = (k: keyof Form) => (submitted ? errors[k] : undefined);
  const submit = () => {
    setSubmitted(true);
    const first = (Object.keys(errors) as Array<keyof Form>)[0];
    if (first) return void document.getElementById(`sede-${first}`)?.focus();
    const data = { name: form.name.trim(), address: form.address.trim() || null, phone: form.phone.trim() || null, email: form.email.trim() || null };
    if (site) update.mutate({ siteId: site.siteId, ...data });
    else create.mutate(data);
  };
  const field = (k: keyof Form, label: string, o: { required?: boolean; type?: string; placeholder?: string; max: number; auto?: string }) => (
    <FormField id={`sede-${k}`} label={label} error={err(k)} required={o.required}>
      <Input
        id={`sede-${k}`}
        type={o.type ?? "text"}
        value={form[k]}
        maxLength={o.max}
        placeholder={o.placeholder}
        autoComplete={o.auto ?? "off"}
        aria-invalid={!!err(k)}
        aria-describedby={describedBy(`sede-${k}`, err(k))}
        onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value }))}
      />
    </FormField>
  );
  return (
    <Dialog open onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{site ? `Editar «${site.name}»` : "Nueva sede"}</DialogTitle>
          <DialogDescription>{site?.isPrimary ? "La sede principal reúne todo lo que no tiene otra sede asignada." : "Cada sede tiene sus cajas, su equipo y sus ventas."}</DialogDescription>
        </DialogHeader>
        <form noValidate className="space-y-4" onSubmit={(e) => { e.preventDefault(); submit(); }}>
          {field("name", "Nombre", { required: true, max: 160, placeholder: "Ej.: Tienda centro" })}
          {field("address", "Dirección (opcional)", { max: 300, placeholder: "Calle, número, código postal y localidad", auto: "street-address" })}
          <div className="grid gap-4 sm:grid-cols-2">
            {field("phone", "Teléfono (opcional)", { max: 40, type: "tel", auto: "tel" })}
            {field("email", "Correo (opcional)", { max: 200, type: "email", auto: "email" })}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>Cancelar</Button>
            <Button type="submit" disabled={pending}>{pending ? "Guardando…" : site ? "Guardar" : "Añadir sede"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function SitesManager() {
  const utils = trpc.useUtils();
  const q = trpc.sites.list.useQuery();
  const [editing, setEditing] = useState<PanelSite | "new" | null>(null);
  const [archiving, setArchiving] = useState<PanelSite | null>(null);
  const archive = trpc.sites.archive.useMutation({
    onSuccess: () => { void utils.sites.list.invalidate(); toast.success("Sede desactivada"); setArchiving(null); },
    onError: (e) => toastError(e, "No se ha podido desactivar la sede."),
  });
  const restore = trpc.sites.restore.useMutation({
    onSuccess: () => { void utils.sites.list.invalidate(); toast.success("Sede reactivada"); },
    onError: (e) => toastError(e, "No se ha podido reactivar la sede."),
  });

  const d = q.data;
  const active = d?.sites.filter((s) => s.status === "active") ?? [];
  const archived = d?.sites.filter((s) => s.status === "archived") ?? [];
  const limitText = d ? (d.limit === null ? `${d.used} sedes activas (sin límite por contrato)` : `${d.used} de ${d.limit} ${d.limit === 1 ? "sede" : "sedes"} incluidas en tu plan`) : "";

  return (
    <AdminLayout>
      <div className="p-4 sm:p-6 space-y-6 max-w-5xl">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <Building2 className="w-6 h-6 text-primary" aria-hidden="true" />
              Sedes
            </h1>
            <p className="text-muted-foreground text-sm mt-1">Los locales o centros donde trabaja tu empresa. Las cajas, su equipo y sus ventas se organizan por sede.</p>
          </div>
          {d?.canManage && (
            <Button onClick={() => setEditing("new")} disabled={!d.canAdd} title={d.canAdd ? undefined : "Has llegado al límite de sedes de tu plan"} className="gap-2">
              <Plus className="w-4 h-4" aria-hidden="true" />
              Nueva sede
            </Button>
          )}
        </div>

        {q.isLoading ? (
          <PanelLoading label="Cargando sedes…" />
        ) : q.isError ? (
          <PanelError error={q.error} onRetry={() => q.refetch()} title="No se han podido cargar las sedes" />
        ) : d ? (
          <>
            <p className="text-sm text-muted-foreground" aria-live="polite">{limitText}</p>
            {!d.multiSite ? (
              <div role="note" className="rounded-xl border border-border bg-muted/40 p-4 text-sm text-foreground">
                Tu plan incluye una sede. Para gestionar varias sedes (cajas, equipo y ventas por sede) necesitas el plan Business.{" "}
                <Link href="/admin/suscripcion" className="font-medium text-primary underline underline-offset-2">Ver planes</Link>
              </div>
            ) : d.canManage && !d.canAdd ? (
              <div role="note" className="rounded-xl border border-border bg-muted/40 p-4 text-sm text-foreground">
                Has llegado al límite de sedes de tu plan. Para añadir más, desactiva una o amplía tu plan.
              </div>
            ) : null}

            <ul className="grid gap-3 sm:grid-cols-2">
              {active.map((s) => (
                <li key={s.siteId} className="rounded-xl border border-border bg-card p-4 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold text-foreground break-words">{s.name}</p>
                      {s.isPrimary && <span className="inline-block mt-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">Sede principal</span>}
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <Button size="sm" variant="ghost" onClick={() => setEditing(s)} aria-label={`Editar ${s.name}`} disabled={!d.managed || (!d.multiSite && !s.isPrimary)}>
                        <Pencil className="w-4 h-4" aria-hidden="true" />
                      </Button>
                      {d.canManage && !s.isPrimary && (
                        <Button size="sm" variant="ghost" onClick={() => setArchiving(s)} aria-label={`Desactivar ${s.name}`}>
                          <Archive className="w-4 h-4" aria-hidden="true" />
                        </Button>
                      )}
                    </div>
                  </div>
                  <dl className="space-y-1 text-sm text-muted-foreground">
                    {s.address && <div className="flex gap-1.5"><MapPin className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" /><dt className="sr-only">Dirección</dt><dd className="break-words">{s.address}</dd></div>}
                    {s.phone && <div className="flex gap-1.5"><Phone className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" /><dt className="sr-only">Teléfono</dt><dd>{s.phone}</dd></div>}
                    {s.email && <div className="flex gap-1.5"><Mail className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" /><dt className="sr-only">Correo</dt><dd className="break-all">{s.email}</dd></div>}
                    {!s.address && !s.phone && !s.email && <p>Sin datos de contacto.</p>}
                  </dl>
                </li>
              ))}
            </ul>

            {archived.length > 0 && (
              <section aria-labelledby="sedes-desactivadas" className="space-y-2">
                <h2 id="sedes-desactivadas" className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Desactivadas</h2>
                <ul className="divide-y divide-border rounded-xl border border-border bg-card">
                  {archived.map((s) => (
                    <li key={s.siteId} className="flex items-center justify-between gap-3 p-3">
                      <span className="text-sm text-foreground break-words">{s.name}</span>
                      {d.canManage && (
                        <Button size="sm" variant="outline" className="gap-1.5" disabled={!d.canAdd || restore.isPending} onClick={() => restore.mutate({ siteId: s.siteId })}>
                          <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                          Reactivar
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {!d.managed && <p className="text-xs text-muted-foreground">La gestión de sedes no está disponible en esta instalación.</p>}
          </>
        ) : null}
      </div>

      {editing && <SiteEditor site={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}

      <AlertDialog open={!!archiving} onOpenChange={(o) => !o && !archive.isPending && setArchiving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Desactivar «{archiving?.name}»?</AlertDialogTitle>
            <AlertDialogDescription>
              No se borra nada: sus cajas, sesiones y ventas se conservan y puedes reactivarla más adelante. Mientras esté desactivada no se le pueden asignar cajas ni personas.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={archive.isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction disabled={archive.isPending} onClick={(e) => { e.preventDefault(); if (archiving) archive.mutate({ siteId: archiving.siteId }); }}>
              {archive.isPending ? "Desactivando…" : "Desactivar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AdminLayout>
  );
}
