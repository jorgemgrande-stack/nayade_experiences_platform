/**
 * «Pedir presupuesto» en la web de una pyme: formulario genérico (sin categorías ni productos de otra empresa). Entra
 * como oportunidad en su panel. Si tiene productos publicados, el cliente puede indicar por cuál pregunta.
 */
import { useState } from "react";
import { Link } from "wouter";
import { CheckCircle, Send } from "lucide-react";
import { toast } from "sonner";
import PublicLayout from "@/components/PublicLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { usePageTitle } from "@/components/TenantTheme";
import { trackLeadFormSubmit } from "@/lib/ga4";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const GENERAL = "Consulta general";
const selectClass =
  "h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export default function TenantBudgetRequest() {
  usePageTitle("Pedir presupuesto");
  const [sent, setSent] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", phone: "", product: "", date: "", message: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const products = trpc.public.getExperiences.useQuery({ limit: 50, offset: 0 }, { retry: false });
  const options = ((products.data ?? []) as Array<{ id: number; title: string }>).map((p) => p.title);

  const submit = trpc.public.submitLead.useMutation({
    onSuccess: () => {
      trackLeadFormSubmit("presupuesto");
      setSent(true);
    },
    onError: () => toast.error("No se pudo enviar. Inténtalo de nuevo."),
  });

  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => {
    setForm((f) => ({ ...f, [k]: e.target.value }));
    setErrors((x) => ({ ...x, [k]: "" }));
  };

  const onSubmit = (ev: React.FormEvent) => {
    ev.preventDefault();
    const e: Record<string, string> = {};
    if (form.name.trim().length < 2) e.name = "Indica tu nombre";
    if (!EMAIL_RE.test(form.email.trim())) e.email = "Escribe un correo electrónico válido";
    if (form.message.trim().length < 5) e.message = "Cuéntanos qué necesitas";
    setErrors(e);
    const first = Object.keys(e)[0];
    if (first) {
      document.getElementById(`presupuesto-${first}`)?.focus();
      return;
    }
    submit.mutate({
      name: form.name.trim(),
      email: form.email.trim(),
      phone: form.phone.trim() || undefined,
      message: form.message.trim(),
      preferredDate: form.date || undefined,
      selectedCategory: "Presupuesto",
      selectedProduct: form.product || GENERAL,
      source: "web_presupuesto",
    });
  };

  if (sent) {
    return (
      <PublicLayout>
        <section className="container max-w-xl py-20 text-center">
          <CheckCircle className="mx-auto mb-6 h-14 w-14 text-primary" aria-hidden="true" />
          <h1 className="font-heading text-3xl font-bold text-foreground">Solicitud enviada</h1>
          <p className="mt-4 text-foreground/80">Gracias, {form.name.trim()}. Hemos recibido tu petición y te responderemos lo antes posible.</p>
          <Button asChild className="mt-8">
            <Link href="/">Volver al inicio</Link>
          </Button>
        </section>
      </PublicLayout>
    );
  }

  const field = (id: string, error?: string) => ({ id: `presupuesto-${id}`, "aria-invalid": !!error, "aria-describedby": error ? `presupuesto-${id}-error` : undefined });
  const err = (id: string, error?: string) =>
    error ? (
      <p id={`presupuesto-${id}-error`} role="alert" className="text-xs font-medium text-destructive">
        {error}
      </p>
    ) : null;

  return (
    <PublicLayout>
      <section className="container max-w-2xl py-10 md:py-14">
        <h1 className="font-heading text-3xl md:text-4xl font-bold text-primary">Pedir presupuesto</h1>
        <p className="mt-3 text-foreground/80">Cuéntanos qué necesitas y te enviaremos una propuesta sin compromiso.</p>

        <form onSubmit={onSubmit} noValidate className="mt-8 space-y-5 rounded-2xl border border-border bg-card p-5 md:p-8">
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="presupuesto-name">Nombre *</Label>
              <Input {...field("name", errors.name)} value={form.name} onChange={set("name")} autoComplete="name" />
              {err("name", errors.name)}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="presupuesto-email">Correo electrónico *</Label>
              <Input {...field("email", errors.email)} type="email" value={form.email} onChange={set("email")} autoComplete="email" />
              {err("email", errors.email)}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="presupuesto-phone">Teléfono (opcional)</Label>
              <Input {...field("phone")} type="tel" value={form.phone} onChange={set("phone")} autoComplete="tel" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="presupuesto-date">Fecha deseada (opcional)</Label>
              <Input {...field("date")} type="date" value={form.date} onChange={set("date")} />
            </div>
          </div>
          {options.length > 0 && (
            <div className="space-y-1.5">
              <Label htmlFor="presupuesto-product">Producto o servicio (opcional)</Label>
              <select {...field("product")} className={selectClass} value={form.product} onChange={set("product")}>
                <option value="">{GENERAL}</option>
                {options.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="presupuesto-message">¿Qué necesitas? *</Label>
            <Textarea {...field("message", errors.message)} rows={5} value={form.message} onChange={set("message")} />
            {err("message", errors.message)}
          </div>
          <p className="text-xs text-muted-foreground">
            Usaremos tus datos solo para responder a tu solicitud. Más información en la{" "}
            <Link href="/privacidad" className="underline underline-offset-2">
              política de privacidad
            </Link>
            .
          </p>
          <Button type="submit" size="lg" disabled={submit.isPending} className="w-full sm:w-auto">
            <Send className="mr-2 h-4 w-4" aria-hidden="true" />
            {submit.isPending ? "Enviando…" : "Enviar solicitud"}
          </Button>
        </form>
      </section>
    </PublicLayout>
  );
}
