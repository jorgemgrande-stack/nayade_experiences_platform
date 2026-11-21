/**
 * Botón flotante de WhatsApp de la web (Studio › Cabecera y pie): activo, número, posición y mensaje inicial por
 * idioma de la web. Solo enlaza con wa.me (el visitante decide si envía el mensaje); sin servicios de chat de terceros.
 */
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Segmented } from "@/components/admin/studio/Inspector";
import { localeAutonym } from "@/hooks/useSiteLocale";
import { WHATSAPP_MESSAGE_MAX, type WhatsappPosition } from "@shared/whatsappButton";
import { useStudioText } from "@/components/admin/studio/useStudioText";

interface Form {
  enabled: boolean;
  whatsapp: string;
  position: WhatsappPosition;
  messages: Record<string, string>;
}

export function WhatsAppButtonEditor() {
  const tx = useStudioText();
  const utils = trpc.useUtils();
  const q = trpc.whatsappButton.get.useQuery(undefined, { retry: false, refetchOnWindowFocus: false });
  const locales = trpc.public.getSiteLocales.useQuery(undefined, { retry: false, refetchOnWindowFocus: false });
  const [v, setV] = useState<Form | null>(null);
  useEffect(() => {
    if (q.data && !v) setV({ enabled: q.data.enabled && q.data.valid, whatsapp: q.data.whatsapp, position: q.data.position, messages: { ...q.data.messages } });
  }, [q.data, v]);
  const save = trpc.whatsappButton.save.useMutation({
    onSuccess: (d) => {
      setV({ enabled: d.enabled, whatsapp: d.whatsapp, position: d.position, messages: { ...d.messages } });
      void utils.whatsappButton.get.invalidate();
      void utils.public.getTheme.invalidate();
      toast.success(tx("Botón de WhatsApp guardado"));
    },
    onError: (e) => toast.error(e.message),
  });
  if (q.isLoading || !v) return <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-label={tx("Cargando")} />;
  const langs = locales.data?.multilingual ? locales.data.locales : [locales.data?.defaultLocale ?? "es"];
  return (
    <section aria-labelledby="wa-button-title" className="space-y-4 border-t border-border pt-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 id="wa-button-title" className="text-sm font-semibold text-foreground">{tx("Botón de WhatsApp")}</h3>
          <p className="text-xs text-muted-foreground">{tx("Fijo en una esquina de todas las páginas públicas. Abre WhatsApp con un mensaje inicial que el visitante decide si envía.")}</p>
        </div>
        <Switch id="wa-enabled" checked={v.enabled} onCheckedChange={(x) => setV({ ...v, enabled: x })} aria-label={tx("Mostrar el botón de WhatsApp")} />
      </div>
      <div className="space-y-1">
        <Label htmlFor="wa-number">{tx("Número de WhatsApp")}</Label>
        <Input id="wa-number" inputMode="tel" value={v.whatsapp} maxLength={25} placeholder="+49 174 2013503" onChange={(e) => setV({ ...v, whatsapp: e.target.value })} />
        <p className="text-xs text-muted-foreground">{tx("Un móvil con WhatsApp. Con prefijo internacional si no es de España.")}</p>
      </div>
      <Segmented
          label={tx("Posición")}
          value={v.position}
          options={[
            { value: "right", label: tx("Abajo a la derecha") },
            { value: "left", label: tx("Abajo a la izquierda") },
          ]}
          onChange={(x) => setV({ ...v, position: x as WhatsappPosition })}
        />
      {langs.map((l) => (
        <div key={l} className="space-y-1">
          <Label htmlFor={`wa-msg-${l}`}>{tx("Mensaje inicial · {l}", { l: localeAutonym(l) })}</Label>
          <Textarea id={`wa-msg-${l}`} rows={2} maxLength={WHATSAPP_MESSAGE_MAX} value={v.messages[l] ?? ""} onChange={(e) => setV({ ...v, messages: { ...v.messages, [l]: e.target.value } })} />
        </div>
      ))}
      <Button type="button" size="sm" disabled={save.isPending} onClick={() => save.mutate(v)}>
        {save.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />}{tx("Guardar botón de WhatsApp")}</Button>
    </section>
  );
}
