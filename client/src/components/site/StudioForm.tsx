/**
 * Formulario a medida de la web de la empresa (Elephant Studio). Pinta los campos que ha configurado la empresa,
 * valida antes de enviar (el servidor vuelve a validar contra el formulario publicado) y envía por
 * `public.submitLead` con `studioForm`: cada envío entra en el CRM como oportunidad. Antispam: campo trampa
 * invisible y tiempo mínimo de relleno. En el editor y en la vista previa no se envía nada.
 */
import { useId, useRef, useState } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { formFieldVisibility, type BlockDataMap, type FormFieldItem } from "@shared/pageBlocks";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const options = (f: FormFieldItem) => Array.from(new Set(f.options.split(/\r?\n/).map((o) => o.trim()).filter(Boolean)));
const INPUT_TYPE: Partial<Record<FormFieldItem["kind"], string>> = { email: "email", phone: "tel", number: "number", date: "date", time: "time" };
const AUTOCOMPLETE: Record<string, string> = { name: "name", email: "email", phone: "tel" };

/** Dirección de la página en la que está el formulario («/» es la portada). */
function currentSlug(): string {
  const parts = window.location.pathname.split("/").filter(Boolean);
  const last = parts[parts.length - 1] ?? "";
  return /^[a-z0-9-]{1,64}$/.test(last) ? last : "inicio";
}

type Values = Record<string, string | string[] | boolean>;

export function StudioFormFields({ blockId, form, preview, pageTitle, editing }: { blockId: string; form: BlockDataMap["form"]; preview?: boolean; pageTitle?: string; editing?: boolean }) {
  const id = useId();
  const [, navigate] = useLocation();
  const shownAt = useRef(Date.now());
  const [values, setValues] = useState<Values>({});
  const [consent, setConsent] = useState(false);
  const [trap, setTrap] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [sent, setSent] = useState<string | null>(null);
  const submit = trpc.public.submitLead.useMutation();
  const set = (k: string, v: string | string[] | boolean) => {
    setValues((s) => ({ ...s, [k]: v }));
    setErrors((e) => (e[k] ? { ...e, [k]: "" } : e));
  };

  // Campos con condición: solo los que tocan según las respuestas (en el editor se ven todos, marcados)
  const visible = formFieldVisibility(form.fields, values);

  const check = (): Record<string, string> => {
    const out: Record<string, string> = {};
    form.fields.forEach((f, i) => {
      if (!visible[i]) return;
      const k = `f${i}`;
      const v = values[k];
      if (f.kind === "hidden") return;
      const empty = v === undefined || v === "" || v === false || (Array.isArray(v) && !v.length);
      if (f.required === "on" && empty) out[k] = f.kind === "checkbox" ? "Marca esta casilla para continuar." : "Este campo es obligatorio.";
      else if (f.kind === "email" && typeof v === "string" && v && !EMAIL_RE.test(v.trim())) out[k] = "Escribe un correo electrónico válido.";
    });
    if (form.consent === "on" && !consent) out.consent = "Para enviarlo, acepta la política de privacidad.";
    return out;
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const found = check();
    setErrors(found);
    if (Object.values(found).some(Boolean)) {
      document.getElementById(`${id}-${Object.keys(found).find((k) => found[k])}`)?.focus();
      return;
    }
    if (preview) {
      toast.info("Es la vista previa: el formulario no se envía.");
      return;
    }
    const emailIdx = form.fields.findIndex((f) => f.role === "email");
    const nameIdx = form.fields.findIndex((f) => f.role === "name");
    const email = emailIdx >= 0 ? String(values[`f${emailIdx}`] ?? "").trim() : "";
    const name = nameIdx >= 0 ? String(values[`f${nameIdx}`] ?? "").trim() : "";
    try {
      const r = await submit.mutateAsync({
        // El servidor toma el nombre, el correo y el mensaje de las respuestas validadas del formulario publicado
        name: name.length >= 2 ? name : "Contacto web",
        email: EMAIL_RE.test(email) ? email : "sin-correo@formulario.invalid",
        message: pageTitle ? `Página: ${pageTitle}` : undefined,
        source: "web_formulario",
        studioForm: { slug: currentSlug(), blockId, values: Object.fromEntries(Object.entries(values).filter(([k]) => visible[Number(k.slice(1))] !== false)), consent, website: trap, elapsedMs: Date.now() - shownAt.current },
      });
      const studio = (r as { studio?: { ok: boolean; errors?: Record<string, string>; message?: string; redirectUrl?: string } }).studio;
      if (studio && !studio.ok) {
        setErrors(studio.errors ?? {});
        return;
      }
      if (studio?.redirectUrl) navigate(studio.redirectUrl);
      else setSent(studio?.message || form.successMessage || "¡Gracias! Hemos recibido tu mensaje.");
    } catch (err) {
      toast.error((err as Error).message || "No hemos podido enviar el formulario. Inténtalo de nuevo en unos minutos.");
    }
  };

  if (sent) {
    return (
      <p role="status" className="rounded-lg bg-primary/10 px-4 py-3 text-foreground">
        {sent}
      </p>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      {/* Campo trampa: invisible para las personas (y para los lectores de pantalla) */}
      <div aria-hidden className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <label>
          Web
          <input tabIndex={-1} autoComplete="off" value={trap} onChange={(e) => setTrap(e.target.value)} name="website" />
        </label>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {form.fields.map((f, i) => {
          if (f.kind === "hidden") return null;
          if (!visible[i] && !editing) return null;
          const cond =
            editing && (f.showIf ?? "").trim() ? (
              <span className="block text-xs font-normal text-muted-foreground">
                Se muestra si «{(f.showIf ?? "").trim()}» es «{(f.showValue ?? "").trim() || "Sí"}»
              </span>
            ) : null;
          const k = `f${i}`;
          const fid = `${id}-${k}`;
          const err = errors[k];
          const required = f.required === "on";
          const label = (
            <>
              {f.label || `Campo ${i + 1}`}
              {required && <span className="text-destructive" aria-hidden> *</span>}
            </>
          );
          const common = { id: fid, "aria-invalid": !!err || undefined, "aria-describedby": err ? `${fid}-err` : undefined, required };
          let control: React.ReactNode;
          if (f.kind === "textarea") {
            control = <Textarea {...common} rows={5} maxLength={4000} placeholder={f.placeholder} value={String(values[k] ?? "")} onChange={(e) => set(k, e.target.value)} />;
          } else if (f.kind === "select") {
            control = (
              <select {...common} value={String(values[k] ?? "")} onChange={(e) => set(k, e.target.value)} className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <option value="">{f.placeholder || "Elige una opción"}</option>
                {options(f).map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            );
          } else if (f.kind === "radio" || f.kind === "multi") {
            const picked = values[k];
            control = (
              <div role={f.kind === "radio" ? "radiogroup" : "group"} aria-labelledby={`${fid}-lbl`} aria-describedby={common["aria-describedby"]} className="flex flex-wrap gap-x-5 gap-y-2 pt-1">
                {options(f).map((o, j) => {
                  const oid = `${fid}-${j}`;
                  const checked = f.kind === "radio" ? picked === o : Array.isArray(picked) && picked.includes(o);
                  return (
                    <label key={o} htmlFor={oid} className="flex items-center gap-2 text-sm">
                      <input
                        id={oid}
                        type={f.kind === "radio" ? "radio" : "checkbox"}
                        name={fid}
                        checked={checked}
                        onChange={(e) => {
                          if (f.kind === "radio") set(k, o);
                          else {
                            const cur = Array.isArray(picked) ? picked : [];
                            set(k, e.target.checked ? [...cur, o] : cur.filter((x) => x !== o));
                          }
                        }}
                        className="h-4 w-4 accent-[var(--primary)]"
                      />
                      {o}
                    </label>
                  );
                })}
              </div>
            );
          } else if (f.kind === "checkbox") {
            return (
              <div key={i} className={cn("sm:col-span-2", cond && "rounded-md border border-dashed border-border p-2")}>
                {cond}
                <div className="flex items-start gap-2">
                  <Checkbox id={fid} checked={values[k] === true} onCheckedChange={(v) => set(k, v === true)} aria-invalid={!!err || undefined} className="mt-0.5" />
                  <Label htmlFor={fid} className="block text-sm font-normal leading-snug">
                    {label}
                  </Label>
                </div>
                {err && (
                  <p id={`${fid}-err`} role="alert" className="mt-1 text-sm text-destructive">
                    {err}
                  </p>
                )}
              </div>
            );
          } else {
            control = (
              <Input
                {...common}
                type={INPUT_TYPE[f.kind] ?? "text"}
                autoComplete={AUTOCOMPLETE[f.role]}
                maxLength={f.kind === "text" ? 300 : 200}
                placeholder={f.placeholder}
                value={String(values[k] ?? "")}
                onChange={(e) => set(k, e.target.value)}
              />
            );
          }
          return (
            <div key={i} className={cn("space-y-1.5", f.width === "half" ? "sm:col-span-1" : "sm:col-span-2", cond && "rounded-md border border-dashed border-border p-2")}>
              {cond}
              <Label id={`${fid}-lbl`} htmlFor={fid}>
                {label}
              </Label>
              {control}
              {err && (
                <p id={`${fid}-err`} role="alert" className="text-sm text-destructive">
                  {err}
                </p>
              )}
            </div>
          );
        })}
      </div>
      {form.consent === "on" && (
        <div>
          <div className="flex items-start gap-2">
            <Checkbox id={`${id}-consent`} checked={consent} onCheckedChange={(v) => setConsent(v === true)} aria-invalid={!!errors.consent || undefined} className="mt-0.5" />
            <Label htmlFor={`${id}-consent`} className="block text-sm font-normal leading-snug">
              He leído y acepto la{" "}
              <a href="/privacidad" className="underline decoration-primary underline-offset-4" onClick={(e) => preview && e.preventDefault()}>
                política de privacidad
              </a>
              .
            </Label>
          </div>
          {errors.consent && (
            <p role="alert" className="mt-1 text-sm text-destructive">
              {errors.consent}
            </p>
          )}
        </div>
      )}
      <Button type="submit" size="lg" disabled={submit.isPending}>
        {submit.isPending ? "Enviando…" : form.submitLabel || "Enviar"}
      </Button>
    </form>
  );
}
