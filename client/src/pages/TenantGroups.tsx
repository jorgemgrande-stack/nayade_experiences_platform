/**
 * «Grupos» en la web de cada empresa (colegios, empresas, asociaciones, clubes…): su texto de presentación (página
 * «colegios» del CMS, si la ha publicado) y un formulario de solicitud que crea un lead en SU CRM y avisa a SU correo.
 * Las actividades que se ofrecen son sus propios productos publicados; nada de otra empresa.
 */
import { useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import PublicLayout from "@/components/PublicLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { trackLeadFormSubmit } from "@/lib/ga4";

export const GROUP_TYPES = ["Colegio o instituto", "Empresa", "Asociación o AMPA", "Club deportivo", "Campamento o colonia", "Familia o amigos", "Otro"];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function TenantGroups() {
  const intro = trpc.public.getTenantPage.useQuery({ slug: "colegios" }, { retry: false });
  const products = trpc.public.getExperiences.useQuery({ limit: 50, offset: 0 }, { retry: false });
  const [sent, setSent] = useState(false);
  const [f, setF] = useState({ name: "", email: "", phone: "", organizationName: "", groupType: "", preferredDate: "", participants: "20", companions: "2", experienceType: "", comments: "", honeypot: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = (k: keyof typeof f, v: string) => {
    setF((p) => ({ ...p, [k]: v }));
    setErrors((p) => ({ ...p, [k]: "" }));
  };

  const submit = trpc.public.submitColegiosLead.useMutation({
    onSuccess: () => {
      trackLeadFormSubmit("grupos_solicitud");
      setSent(true);
    },
    onError: () => toast.error("No se ha podido enviar la solicitud. Inténtalo de nuevo."),
  });

  const onSubmit = (ev: React.FormEvent) => {
    ev.preventDefault();
    const e: Record<string, string> = {};
    if (f.name.trim().length < 2) e.name = "Escribe tu nombre";
    if (!EMAIL_RE.test(f.email.trim())) e.email = "Correo no válido";
    if (f.phone.trim().length < 6) e.phone = "Teléfono no válido";
    if (f.organizationName.trim().length < 2) e.organizationName = "Escribe el nombre del grupo o entidad";
    const participants = parseInt(f.participants, 10);
    if (!participants || participants < 1) e.participants = "Indica cuántas personas sois";
    setErrors(e);
    if (Object.keys(e).length) return;
    submit.mutate({
      name: f.name.trim(),
      email: f.email.trim(),
      phone: f.phone.trim(),
      organizationName: f.organizationName.trim(),
      groupType: f.groupType || undefined,
      preferredDate: f.preferredDate || undefined,
      childrenCount: participants,
      monitorsCount: parseInt(f.companions, 10) || 0,
      experienceType: f.experienceType || undefined,
      comments: f.comments.trim() || undefined,
      honeypot: f.honeypot || undefined,
    });
  };

  const field = (k: keyof typeof f, label: string, props: React.ComponentProps<typeof Input> = {}) => (
    <div className="space-y-1.5">
      <Label htmlFor={`g-${k}`}>{label}</Label>
      <Input id={`g-${k}`} value={f[k]} onChange={(e) => set(k, e.target.value)} aria-invalid={!!errors[k]} {...props} />
      {errors[k] && <p className="text-xs text-destructive">{errors[k]}</p>}
    </div>
  );

  const offers = (products.data ?? []) as Array<{ id: number; title: string }>;

  return (
    <PublicLayout>
      <div className="container py-12 grid gap-10 lg:grid-cols-2">
        <div>
          {intro.data ? (
            <article className="prose max-w-none">
              {/* HTML saneado en servidor con lista blanca (server/_core/htmlSanitize.ts) */}
              <div dangerouslySetInnerHTML={{ __html: intro.data.html }} />
            </article>
          ) : (
            <>
              <h1 className="text-4xl font-heading font-bold text-foreground mb-4">Grupos</h1>
              <p className="text-muted-foreground">Colegios, empresas, asociaciones y grupos de amigos: cuéntanos qué necesitáis y os preparamos una propuesta a medida, sin compromiso.</p>
            </>
          )}
        </div>
        <div className="bg-card rounded-2xl border border-border/50 shadow-sm p-6">
          {sent ? (
            <div className="text-center py-10 space-y-3" role="status">
              <CheckCircle2 className="w-12 h-12 text-primary mx-auto" />
              <h2 className="text-2xl font-heading font-bold">Solicitud recibida</h2>
              <p className="text-muted-foreground">Te responderemos lo antes posible.</p>
            </div>
          ) : (
            <form onSubmit={onSubmit} className="space-y-4" noValidate>
              <h2 className="text-xl font-heading font-bold">Solicita presupuesto para tu grupo</h2>
              <input type="text" name="website" tabIndex={-1} autoComplete="off" className="hidden" value={f.honeypot} onChange={(e) => set("honeypot", e.target.value)} aria-hidden="true" />
              <div className="grid gap-4 sm:grid-cols-2">
                {field("organizationName", "Grupo o entidad")}
                <div className="space-y-1.5">
                  <Label htmlFor="g-groupType">Tipo de grupo</Label>
                  <select id="g-groupType" value={f.groupType} onChange={(e) => set("groupType", e.target.value)} className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm">
                    <option value="">Selecciona…</option>
                    {GROUP_TYPES.map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                </div>
                {field("name", "Persona de contacto")}
                {field("email", "Correo", { type: "email" })}
                {field("phone", "Teléfono", { type: "tel" })}
                {field("preferredDate", "Fecha preferida", { type: "date" })}
                {field("participants", "Participantes", { type: "number", min: 1 })}
                {field("companions", "Acompañantes o responsables", { type: "number", min: 0 })}
              </div>
              {offers.length > 0 && (
                <div className="space-y-1.5">
                  <Label htmlFor="g-experienceType">¿Qué os interesa?</Label>
                  <select id="g-experienceType" value={f.experienceType} onChange={(e) => set("experienceType", e.target.value)} className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm">
                    <option value="">Programa a medida</option>
                    {offers.map((o) => (
                      <option key={o.id} value={o.title}>{o.title}</option>
                    ))}
                  </select>
                </div>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="g-comments">Comentarios</Label>
                <Textarea id="g-comments" rows={4} value={f.comments} onChange={(e) => set("comments", e.target.value)} />
              </div>
              <Button type="submit" className="w-full" disabled={submit.isPending}>
                {submit.isPending ? "Enviando…" : "Enviar solicitud"}
              </Button>
            </form>
          )}
        </div>
      </div>
    </PublicLayout>
  );
}
