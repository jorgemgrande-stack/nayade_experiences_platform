/**
 * Contratar desde la prueba gratuita: plan, periodicidad y módulos → importe calculado por el servidor → datos de
 * facturación y condiciones → pago en Stripe. Solo la administración y solo en prueba. El acceso de pago se activa
 * cuando Stripe confirma el cobro (no al volver del pago); los datos de la prueba se conservan.
 */
import { useEffect, useMemo, useState } from "react";
import { CreditCard, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";

type Plan = "essential" | "business";
type Interval = "month" | "year";
type Line = { key: string; name: string; quantity: number; amountCents: number; interval: Interval; status: string };
type Preview = {
  quote: { ok: boolean; errors: string[]; currency: string; lines: Line[]; totals: { monthlyCents: number; yearlyCents: number } };
  taxNotice: string;
  termsVersion: string | null;
  privacyVersion: string | null;
};
type CatalogModule = { key: string; name: string; kind: string; commercialStatus: string; state: string; monthly: { amountCents: number } | null };

const PLANS: Array<{ id: Plan; name: string }> = [
  { id: "essential", name: "Essential" },
  { id: "business", name: "Business" },
];
const money = (cents: number, currency = "EUR") => new Intl.NumberFormat("es-ES", { style: "currency", currency }).format(cents / 100);
const newKey = () => crypto.randomUUID();

export function ConversionSection() {
  const status = trpc.subscription.conversionStatus.useQuery(undefined, { retry: false, staleTime: 60_000 });
  const catalog = trpc.subscription.catalog.useQuery(undefined, { retry: false, staleTime: 60_000, enabled: !!status.data?.enabled });
  const [plan, setPlan] = useState<Plan>("essential");
  const [interval, setBilling] = useState<Interval>("month");
  const [add, setAdd] = useState<string[]>([]);
  const [buyer, setBuyer] = useState({ legalName: "", taxId: "", country: "ES", postalCode: "", line1: "", city: "" });
  const [accepted, setAccepted] = useState({ terms: false, privacy: false });
  // Una clave por selección: repetir el envío (doble clic, reintento) devuelve el mismo pago
  const key = useMemo(newKey, [plan, interval, add.join(",")]);

  const preview = trpc.subscription.conversionPreview.useMutation();
  const start = trpc.subscription.conversionStart.useMutation({
    onSuccess: (r) => window.location.assign(r.url),
    onError: (e) => toast.error(e.message),
  });
  const enabled = !!status.data?.enabled;
  useEffect(() => {
    if (enabled) preview.mutate({ plan, interval, ...(add.length ? { add } : {}) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, plan, interval, add.join(",")]);

  if (!status.data) return null;
  if (!enabled) {
    return (
      <section id="contratar" className="rounded-2xl border border-border bg-card p-6 space-y-2" aria-labelledby="sub-convert">
        <h2 id="sub-convert" className="font-semibold text-foreground">Contratar</h2>
        <p className="text-sm text-muted-foreground">La contratación en línea desde el panel todavía no está disponible. Escríbenos y te ayudamos a contratar tu plan sin perder nada de lo que has preparado.</p>
      </section>
    );
  }

  const modules = (((catalog.data as { modules?: CatalogModule[] } | null)?.modules) ?? []).filter((m) => m.kind === "module" && m.commercialStatus === "available" && m.state !== "active");
  const p = preview.data as Preview | undefined;
  const ready = !!p?.quote.ok && !!p.termsVersion && accepted.terms && accepted.privacy && buyer.legalName.trim().length >= 2 && buyer.taxId.trim() && buyer.postalCode.trim() && buyer.line1.trim() && buyer.city.trim();
  const field = (k: keyof typeof buyer, label: string, o: { autoComplete?: string; maxLength?: number } = {}) => (
    <div className="space-y-1">
      <Label htmlFor={`conv-${k}`}>{label}</Label>
      <Input id={`conv-${k}`} value={buyer[k]} maxLength={o.maxLength ?? 160} autoComplete={o.autoComplete} onChange={(e) => setBuyer((b) => ({ ...b, [k]: e.target.value }))} />
    </div>
  );

  return (
    <section id="contratar" className="rounded-2xl border border-border bg-card p-6 space-y-5" aria-labelledby="sub-convert">
      <div>
        <h2 id="sub-convert" className="font-semibold text-foreground flex items-center gap-2">
          <CreditCard className="w-4 h-4" aria-hidden="true" /> Contratar
        </h2>
        <p className="text-sm text-muted-foreground mt-1">Elige tu plan y los módulos que quieras. Todo lo que has preparado durante la prueba se conserva.</p>
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-foreground">Plan</legend>
        <div className="flex flex-wrap gap-2">
          {PLANS.map((x) => (
            <Button key={x.id} type="button" variant={plan === x.id ? "default" : "outline"} aria-pressed={plan === x.id} onClick={() => setPlan(x.id)}>
              {x.name}
            </Button>
          ))}
        </div>
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-foreground">Facturación</legend>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant={interval === "month" ? "default" : "outline"} aria-pressed={interval === "month"} onClick={() => setBilling("month")}>Mensual</Button>
          <Button type="button" variant={interval === "year" ? "default" : "outline"} aria-pressed={interval === "year"} onClick={() => setBilling("year")}>Anual</Button>
        </div>
      </fieldset>

      {modules.length > 0 && (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-foreground">Módulos adicionales</legend>
          <ul className="grid gap-2 sm:grid-cols-2">
            {modules.map((m) => (
              <li key={m.key} className="flex items-center gap-2 text-sm">
                <Checkbox id={`conv-mod-${m.key}`} checked={add.includes(m.key)} onCheckedChange={(v) => setAdd((a) => (v ? [...a, m.key] : a.filter((k) => k !== m.key)))} />
                <Label htmlFor={`conv-mod-${m.key}`} className="font-normal">
                  {m.name}
                  {m.monthly && <span className="text-muted-foreground"> · {money(m.monthly.amountCents)}/mes</span>}
                </Label>
              </li>
            ))}
          </ul>
        </fieldset>
      )}

      <div className="rounded-xl bg-muted/50 p-4 space-y-2" aria-live="polite">
        {preview.isPending && (
          <p className="text-sm text-muted-foreground flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> Calculando el importe…
          </p>
        )}
        {preview.isError && <p className="text-sm text-red-800 dark:text-red-300">{preview.error.message}</p>}
        {p && !preview.isPending && (
          <>
            {!p.quote.ok && <p className="text-sm text-red-800 dark:text-red-300">{p.quote.errors[0] ?? "Revisa la selección"}</p>}
            <table className="w-full text-sm">
              <caption className="sr-only">Detalle del importe</caption>
              <tbody>
                {p.quote.lines.map((l) => (
                  <tr key={l.key} className="border-b border-border last:border-0">
                    <th scope="row" className="py-1.5 pr-4 text-left font-normal text-foreground">
                      {l.name}
                      {l.quantity > 1 ? ` × ${l.quantity}` : ""}
                    </th>
                    <td className="py-1.5 text-right text-foreground">
                      {money(l.amountCents, p.quote.currency)}/{l.interval === "year" ? "año" : "mes"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-sm font-medium text-foreground">
              Total: {p.quote.totals.yearlyCents > 0 && `${money(p.quote.totals.yearlyCents, p.quote.currency)}/año`}
              {p.quote.totals.yearlyCents > 0 && p.quote.totals.monthlyCents > 0 && " + "}
              {p.quote.totals.monthlyCents > 0 && `${money(p.quote.totals.monthlyCents, p.quote.currency)}/mes`} (sin impuestos)
            </p>
            <p className="text-xs text-muted-foreground">{p.taxNotice} La suscripción se renueva automáticamente; podrás cambiar los módulos o cancelarla desde esta página.</p>
          </>
        )}
      </div>

      <fieldset className="space-y-3">
        <legend className="text-sm font-medium text-foreground">Datos de facturación (empresa o profesional)</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          {field("legalName", "Razón social", { autoComplete: "organization" })}
          {field("taxId", "NIF / CIF", { maxLength: 40 })}
          {field("line1", "Dirección", { autoComplete: "address-line1" })}
          {field("city", "Ciudad", { autoComplete: "address-level2", maxLength: 80 })}
          {field("postalCode", "Código postal", { autoComplete: "postal-code", maxLength: 12 })}
          {field("country", "País (código de 2 letras)", { autoComplete: "country", maxLength: 2 })}
        </div>
      </fieldset>

      <div className="space-y-2">
        <div className="flex items-start gap-2 text-sm">
          <Checkbox id="conv-terms" checked={accepted.terms} onCheckedChange={(v) => setAccepted((a) => ({ ...a, terms: v === true }))} />
          <Label htmlFor="conv-terms" className="font-normal leading-snug">
            Acepto las condiciones de contratación de Elephant Source{p?.termsVersion ? ` (versión ${p.termsVersion})` : ""}.
          </Label>
        </div>
        <div className="flex items-start gap-2 text-sm">
          <Checkbox id="conv-privacy" checked={accepted.privacy} onCheckedChange={(v) => setAccepted((a) => ({ ...a, privacy: v === true }))} />
          <Label htmlFor="conv-privacy" className="font-normal leading-snug">He leído la política de privacidad.</Label>
        </div>
      </div>

      <Button
        disabled={!ready || start.isPending}
        onClick={() =>
          start.mutate({
            idempotencyKey: key,
            plan,
            interval,
            ...(add.length ? { add } : {}),
            buyer: { type: "business", legalName: buyer.legalName.trim(), taxId: buyer.taxId.trim(), country: buyer.country.trim().toUpperCase(), postalCode: buyer.postalCode.trim(), line1: buyer.line1.trim(), city: buyer.city.trim() },
            consents: { terms: true, privacy: true, termsVersion: p!.termsVersion!, ...(p!.privacyVersion ? { privacyVersion: p!.privacyVersion } : {}) },
          })
        }
      >
        {start.isPending && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" aria-hidden="true" />}
        Continuar al pago seguro
      </Button>
      <p className="text-xs text-muted-foreground">El pago se hace en Stripe. Tu plan se activa en cuanto Stripe confirma el cobro; si cierras la ventana antes, no se cobra nada.</p>
    </section>
  );
}
