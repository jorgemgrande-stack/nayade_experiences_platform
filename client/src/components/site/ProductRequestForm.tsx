/**
 * Formulario público de «Solicitar información» de un producto «bajo petición» o «próximamente» (E-6). La solicitud
 * entra en el CRM de la empresa con el producto como origen; no hay compra ni cobro. Con una convocatoria elegida
 * (E-4) se convierte en una solicitud de plaza.
 */
import { useId, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { DEFAULT_FORM_CONSENT_TEXT } from "@shared/pageBlocks";

export interface ProductRequestTarget {
  productId: number;
  productTitle: string;
  /** Convocatoria elegida (solicitud de plaza) */
  editionId?: number;
  editionLabel?: string;
  /** Pide también el número de plazas */
  withSeats?: boolean;
  /** Texto del botón de envío (por defecto «Enviar solicitud») */
  submitLabel?: string;
}

export function ProductRequestDialog({ target, open, onOpenChange, preview }: { target: ProductRequestTarget | null; open: boolean; onOpenChange: (o: boolean) => void; preview?: boolean }) {
  const id = useId();
  const shownAt = useRef(Date.now());
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [message, setMessage] = useState("");
  const [seats, setSeats] = useState("1");
  const [consent, setConsent] = useState(false);
  const [trap, setTrap] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [sent, setSent] = useState<string | null>(null);
  const submit = trpc.public.submitLead.useMutation();

  const close = (o: boolean) => {
    onOpenChange(o);
    if (!o) {
      setSent(null);
      setErrors({});
    } else {
      shownAt.current = Date.now();
    }
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!target) return;
    const found: Record<string, string> = {};
    if (name.trim().length < 2) found.name = "Escribe tu nombre.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) found.email = "Escribe un correo electrónico válido.";
    if (phone.trim() && !/^[+0-9 ().-]{6,25}$/.test(phone.trim())) found.phone = "Escribe un teléfono válido.";
    if (!consent) found.consent = "Para enviarlo, acepta la política de privacidad.";
    setErrors(found);
    const first = Object.keys(found)[0];
    if (first) {
      document.getElementById(`${id}-${first}`)?.focus();
      return;
    }
    if (preview) {
      toast.info("Es la vista previa: la solicitud no se envía.");
      return;
    }
    try {
      const r = await submit.mutateAsync({
        name: name.trim(),
        email: email.trim(),
        phone: phone.trim() || undefined,
        message: message.trim() || undefined,
        productRequest: {
          experienceId: target.productId,
          editionId: target.editionId,
          seats: target.withSeats ? Math.max(1, Math.min(50, Math.trunc(Number(seats)) || 1)) : undefined,
          consent,
          website: trap,
          elapsedMs: Date.now() - shownAt.current,
          page: window.location.pathname,
        },
      });
      setSent((r as { message?: string }).message || "Hemos recibido tu solicitud. Te responderemos lo antes posible.");
    } catch (err) {
      toast.error((err as Error).message || "No hemos podido enviar tu solicitud. Inténtalo de nuevo.");
    }
  };

  const err = (k: string) => (errors[k] ? <p id={`${id}-${k}-error`} className="mt-1 text-xs text-destructive">{errors[k]}</p> : null);
  const props = (k: string) => (errors[k] ? { "aria-invalid": true as const, "aria-describedby": `${id}-${k}-error` } : {});

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-heading">{target?.editionId ? "Solicitar plaza" : "Solicitar información"}</DialogTitle>
          <DialogDescription>
            {target?.productTitle}
            {target?.editionLabel ? ` · ${target.editionLabel}` : ""}
          </DialogDescription>
        </DialogHeader>
        {sent ? (
          <div className="space-y-4">
            <p role="status" className="rounded-lg bg-primary/10 px-4 py-3 text-foreground">{sent}</p>
            <Button className="w-full" onClick={() => close(false)}>Cerrar</Button>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4" noValidate>
            {/* Campo trampa: invisible para las personas (y para los lectores de pantalla) */}
            <div aria-hidden className="absolute -left-[9999px] h-px w-px overflow-hidden">
              <label>
                Web
                <input tabIndex={-1} autoComplete="off" value={trap} onChange={(e) => setTrap(e.target.value)} name="website" />
              </label>
            </div>
            <div>
              <Label htmlFor={`${id}-name`}>Nombre *</Label>
              <Input id={`${id}-name`} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" className="mt-1" {...props("name")} />
              {err("name")}
            </div>
            <div>
              <Label htmlFor={`${id}-email`}>Correo electrónico *</Label>
              <Input id={`${id}-email`} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" className="mt-1" {...props("email")} />
              {err("email")}
            </div>
            <div>
              <Label htmlFor={`${id}-phone`}>Teléfono (opcional)</Label>
              <Input id={`${id}-phone`} type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" className="mt-1" {...props("phone")} />
              {err("phone")}
            </div>
            {target?.withSeats && (
              <div>
                <Label htmlFor={`${id}-seats`}>Plazas</Label>
                <Input id={`${id}-seats`} type="number" inputMode="numeric" min={1} max={50} value={seats} onChange={(e) => setSeats(e.target.value)} className="mt-1 w-28" />
              </div>
            )}
            <div>
              <Label htmlFor={`${id}-message`}>Mensaje (opcional)</Label>
              <Textarea id={`${id}-message`} value={message} onChange={(e) => setMessage(e.target.value)} rows={3} maxLength={2000} className="mt-1" />
            </div>
            <div>
              <label className="flex items-start gap-2 text-sm text-muted-foreground">
                <input id={`${id}-consent`} type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 h-4 w-4" {...props("consent")} />
                <span>{DEFAULT_FORM_CONSENT_TEXT}</span>
              </label>
              {err("consent")}
            </div>
            <Button type="submit" className="w-full" disabled={submit.isPending}>
              {submit.isPending ? "Enviando…" : target?.submitLabel || "Enviar solicitud"}
            </Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
