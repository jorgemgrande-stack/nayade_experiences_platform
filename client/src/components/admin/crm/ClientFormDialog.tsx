/**
 * Alta y edición de un cliente del CRM (formulario genérico para cualquier pyme).
 *
 * Particular o empresa; datos de contacto, fiscales y de dirección; observaciones. Valida NIF, NIE o CIF,
 * correo, teléfono y código postal con mensajes en español, y avisa de duplicados por correo o NIF antes
 * del alta. Ante un error no se cierra ni se vacía: lo escrito se conserva.
 */
import { useId, useState } from "react";
import { Link } from "wouter";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { errorMessage } from "@/components/admin/PanelStates";
import { selectClass } from "@/components/admin/crm/CrmParts";
import {
  CLIENT_KIND_LABELS, CLIENT_KINDS, clientDisplayName, clientFormPayload, clientFormValues, duplicateMessage, validateClientForm,
  type ClientFormField, type ClientFormValues, type ClientKind, type DuplicateMatch,
} from "@shared/clientProfile";

/** Países más habituales; si el cliente tiene otro guardado, se conserva como opción. */
const COUNTRIES: Array<[string, string]> = [
  ["ES", "España"], ["PT", "Portugal"], ["FR", "Francia"], ["IT", "Italia"], ["DE", "Alemania"], ["GB", "Reino Unido"],
  ["IE", "Irlanda"], ["NL", "Países Bajos"], ["BE", "Bélgica"], ["AD", "Andorra"], ["US", "Estados Unidos"], ["MX", "México"],
];

export type ClientFormSource = Partial<Record<string, unknown>> & { id: number };

export function ClientFormDialog({ client, onClose, onSaved }: { client?: ClientFormSource | null; onClose: () => void; onSaved?: (id: number) => void }) {
  const utils = trpc.useUtils();
  const isEdit = !!client;
  const initial = clientFormValues(client);
  const [form, setForm] = useState<ClientFormValues>(initial);
  const [submitted, setSubmitted] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [duplicates, setDuplicates] = useState<DuplicateMatch[]>([]);
  const [checking, setChecking] = useState(false);
  // Duplicado solo por NIF: se avisa y la persona decide si lo crea igualmente
  const [acceptNifDuplicate, setAcceptNifDuplicate] = useState(false);
  const uid = useId();

  const set = <K extends ClientFormField>(k: K, v: ClientFormValues[K]) => {
    setForm((p) => ({ ...p, [k]: v }));
    if (k === "email" || k === "nif") { setDuplicates([]); setAcceptNifDuplicate(false); }
  };
  const changed = (k: ClientFormField) => !isEdit || form[k] !== initial[k];
  const errors = validateClientForm(form, changed);
  const hasErrors = Object.keys(errors).length > 0;
  const shown = (k: ClientFormField) => (submitted ? errors[k] : undefined);

  const invalidate = () => {
    utils.crm.clients.list.invalidate();
    utils.crm.clients.stats.invalidate();
    utils.crm.clients.getHistory.invalidate();
  };
  const create = trpc.crm.clients.create.useMutation({
    onSuccess: (r) => { toast.success("Cliente creado"); invalidate(); onSaved?.(Number(r.id)); onClose(); },
    onError: (e) => setServerError(errorMessage(e, "No se ha podido crear el cliente.")),
  });
  const update = trpc.crm.clients.update.useMutation({
    onSuccess: () => { toast.success("Cambios guardados"); invalidate(); onSaved?.(client!.id); onClose(); },
    onError: (e) => setServerError(errorMessage(e, "No se han podido guardar los cambios.")),
  });
  const pending = create.isPending || update.isPending || checking;

  const submit = async () => {
    setSubmitted(true);
    setServerError(null);
    if (hasErrors) {
      const first = (["company", "name", "email", "phone", "nif", "postalCode", "notes"] as const).find((k) => errors[k]);
      if (first) document.getElementById(`${uid}-${first}`)?.focus();
      return;
    }
    const payload = clientFormPayload(form, { normalizeNif: changed("nif") });
    if (changed("email") || changed("nif")) {
      setChecking(true);
      try {
        const found = await utils.crm.clients.findDuplicates.fetch({
          email: changed("email") ? payload.email : undefined,
          nif: changed("nif") ? payload.nif : undefined,
          excludeId: client?.id,
        });
        setDuplicates(found);
        const blocking = found.some((d) => d.by.includes("email"));
        if (blocking || (found.length > 0 && !acceptNifDuplicate)) return;
      } catch (e) {
        setServerError(errorMessage(e, "No se ha podido comprobar si el cliente ya existe."));
        return;
      } finally {
        setChecking(false);
      }
    }
    if (isEdit && client) update.mutate({ id: client.id, ...payload });
    else create.mutate(payload);
  };

  const field = (k: ClientFormField, label: string, opts: { type?: string; required?: boolean; placeholder?: string; autoComplete?: string; wide?: boolean; inputMode?: "numeric" | "tel" | "email"; hint?: string } = {}) => {
    const id = `${uid}-${k}`;
    const err = shown(k);
    return (
      <div className={opts.wide ? "sm:col-span-2" : ""}>
        <label htmlFor={id} className="block text-sm font-medium text-foreground">
          {label}{opts.required && <span className="text-destructive" aria-hidden="true"> *</span>}
        </label>
        <Input
          id={id}
          type={opts.type ?? "text"}
          value={form[k] as string}
          onChange={(e) => set(k, e.target.value)}
          placeholder={opts.placeholder}
          autoComplete={opts.autoComplete}
          inputMode={opts.inputMode}
          aria-required={opts.required || undefined}
          aria-invalid={err ? true : undefined}
          aria-describedby={err ? `${id}-error` : opts.hint ? `${id}-hint` : undefined}
          className="mt-1"
        />
        {opts.hint && !err && <p id={`${id}-hint`} className="mt-1 text-xs text-muted-foreground">{opts.hint}</p>}
        {err && <p id={`${id}-error`} className="mt-1 text-xs font-medium text-destructive">{err}</p>}
      </div>
    );
  };

  const isCompany = form.kind === "empresa";
  const blockingDuplicate = duplicates.find((d) => d.by.includes("email"));
  const countryOptions = COUNTRIES.some(([c]) => c === form.country) || !form.country ? COUNTRIES : [...COUNTRIES, [form.country, form.country] as [string, string]];

  return (
    <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">
      <DialogHeader>
        <DialogTitle>{isEdit ? `Editar ${clientDisplayName({ name: initial.name, company: initial.company }) || "cliente"}` : "Nuevo cliente"}</DialogTitle>
        <DialogDescription>Los campos marcados con * son obligatorios.</DialogDescription>
      </DialogHeader>

      <form id={`${uid}-form`} noValidate className="space-y-4" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        {serverError && (
          <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {serverError} Tus datos siguen en el formulario.
          </div>
        )}
        {submitted && hasErrors && <p role="alert" className="text-sm text-destructive">Revisa los campos marcados antes de guardar.</p>}
        {duplicates.length > 0 && (
          <div role="alert" className="space-y-2 rounded-md border border-amber-400/50 bg-amber-500/10 px-3 py-2 text-sm text-foreground">
            {duplicates.map((d) => (
              <p key={d.id}>
                {duplicateMessage(d)}{" "}
                <Link href={`/admin/crm/clientes/${d.id}`} onClick={onClose} className="font-medium text-primary underline underline-offset-4">Abrir su ficha</Link>
              </p>
            ))}
            {blockingDuplicate ? (
              <p className="text-muted-foreground">Cada cliente necesita un correo distinto. Usa otro correo o abre la ficha que ya existe.</p>
            ) : (
              <label className="flex items-center gap-2">
                <input type="checkbox" className="h-4 w-4 accent-primary" checked={acceptNifDuplicate} onChange={(e) => setAcceptNifDuplicate(e.target.checked)} />
                Es otro contacto: guardar igualmente
              </label>
            )}
          </div>
        )}

        <fieldset>
          <legend className="text-sm font-medium text-foreground">Tipo de cliente</legend>
          <div className="mt-2 inline-flex rounded-md border border-border p-0.5" role="radiogroup" aria-label="Tipo de cliente">
            {CLIENT_KINDS.map((k: ClientKind) => (
              <label key={k} className={`cursor-pointer rounded px-3 py-1.5 text-sm has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring ${form.kind === k ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
                <input type="radio" name={`${uid}-kind`} value={k} checked={form.kind === k} onChange={() => set("kind", k)} className="sr-only" />
                {CLIENT_KIND_LABELS[k]}
              </label>
            ))}
          </div>
        </fieldset>

        <section aria-labelledby={`${uid}-contact`} className="space-y-3">
          <h3 id={`${uid}-contact`} className="text-sm font-semibold text-foreground">Datos de contacto</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {isCompany && field("company", "Razón social", { required: true, wide: true, autoComplete: "organization", placeholder: "Nombre legal de la empresa" })}
            {field("name", isCompany ? "Persona de contacto" : "Nombre y apellidos", { required: !isCompany, wide: true, autoComplete: "name" })}
            {field("email", "Correo electrónico", { type: "email", required: true, autoComplete: "email", inputMode: "email", placeholder: "nombre@empresa.com" })}
            {field("phone", "Teléfono", { type: "tel", autoComplete: "tel", inputMode: "tel", placeholder: "+34 600 000 000" })}
          </div>
        </section>

        <section aria-labelledby={`${uid}-tax`} className="space-y-3">
          <h3 id={`${uid}-tax`} className="text-sm font-semibold text-foreground">Datos fiscales y dirección</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {field("nif", isCompany ? "CIF / NIF" : "NIF / NIE", { placeholder: isCompany ? "B12345674" : "12345678Z", hint: "Necesario para emitir facturas completas." })}
            <div>
              <label htmlFor={`${uid}-country`} className="block text-sm font-medium text-foreground">País</label>
              <select id={`${uid}-country`} className={`${selectClass} mt-1`} value={form.country} onChange={(e) => set("country", e.target.value)}>
                {countryOptions.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
              </select>
            </div>
            {field("address", "Dirección", { wide: true, autoComplete: "street-address", placeholder: "Calle, número, piso" })}
            {field("city", "Población", { autoComplete: "address-level2" })}
            {field("postalCode", "Código postal", { inputMode: "numeric", autoComplete: "postal-code", placeholder: "28001" })}
          </div>
        </section>

        <div>
          <label htmlFor={`${uid}-notes`} className="block text-sm font-medium text-foreground">Observaciones</label>
          <Textarea
            id={`${uid}-notes`}
            rows={2}
            value={form.notes}
            onChange={(e) => set("notes", e.target.value)}
            placeholder="Preferencias, condiciones acordadas…"
            aria-invalid={shown("notes") ? true : undefined}
            className="mt-1"
          />
          {shown("notes") && <p className="mt-1 text-xs font-medium text-destructive">{shown("notes")}</p>}
        </div>
      </form>

      <DialogFooter className="gap-2">
        <Button variant="outline" onClick={onClose}>Cancelar</Button>
        <Button type="submit" form={`${uid}-form`} disabled={pending || !!blockingDuplicate}>
          {pending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />}
          {pending ? "Guardando…" : isEdit ? "Guardar cambios" : "Crear cliente"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
