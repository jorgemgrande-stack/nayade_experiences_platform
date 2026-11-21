/**
 * Elephant Studio › Cabecera y pie: el botón destacado de la cabecera, el estilo, el texto y los datos de contacto del
 * pie, y los menús de la cabecera y del pie. Son comunes a todas las páginas: se guardan al momento (como el estilo
 * global), no esperan a «Publicar». Los ajustes los valida el servidor (`integrations.themeSave`); los menús usan los
 * mismos procedimientos que el CMS.
 */
import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { LinkPicker, type LinkTarget } from "@/components/admin/pageBuilder/BlockEditors";
import { Segmented } from "@/components/admin/studio/Inspector";
import ImageUploader from "@/components/ImageUploader";
import { FooterSocialEditor } from "@/components/admin/studio/FooterSocialEditor";
import { FooterTranslationsButton } from "@/components/admin/studio/FooterTranslationsPanel";
import { useStudioText } from "@/components/admin/studio/useStudioText";

const CHROME_KEYS = ["site_header_cta", "site_header_cta_label", "site_header_cta_url", "site_header_style", "site_header_tone", "site_header_logo_light", "site_footer_style", "site_footer_text", "site_footer_contact", "site_footer_social", "site_finish", "site_header_cart"] as const;
type ChromeValues = Record<(typeof CHROME_KEYS)[number], string>;
const CTA_LABEL_MAX = 40;
const FOOTER_TEXT_MAX = 240;

export function SiteChromeEditor({ targets, onChanged }: { targets: LinkTarget[]; onChanged: () => void }) {
  const tx = useStudioText();
  const theme = trpc.integrations.themeGet.useQuery(undefined, { refetchOnWindowFocus: false });
  const save = trpc.integrations.themeSave.useMutation();
  const utils = trpc.useUtils();
  const [v, setV] = useState<ChromeValues | null>(null);

  useEffect(() => {
    if (!theme.data || v) return;
    const d = theme.data as Record<string, string>;
    setV({
      site_header_cta: d.site_header_cta || "auto",
      site_header_cta_label: d.site_header_cta_label ?? "",
      site_header_cta_url: d.site_header_cta_url ?? "",
      site_header_style: d.site_header_style || "classic",
      site_header_tone: d.site_header_tone || "dark",
      site_header_logo_light: d.site_header_logo_light || "",
      site_footer_style: d.site_footer_style || "dark",
      site_finish: d.site_finish || "standard",
      site_footer_text: d.site_footer_text ?? "",
      site_footer_contact: d.site_footer_contact || "true",
      site_footer_social: d.site_footer_social ?? "",
      site_header_cart: d.site_header_cart || "true",
    });
  }, [theme.data, v]);

  if (!v) {
    return (
      <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />{" "}{tx("Cargando…")}</div>
    );
  }
  const set = (p: Partial<ChromeValues>) => setV({ ...v, ...p });
  const customIncomplete = v.site_header_cta === "custom" && (!v.site_header_cta_label.trim() || !v.site_header_cta_url.trim());

  const onSave = async () => {
    if (customIncomplete) return toast.error(tx("Para un botón propio, escribe su texto y elige a dónde lleva."));
    try {
      await save.mutateAsync({ values: v });
      await utils.integrations.themeGet.invalidate();
      toast.success(tx("Cabecera y pie guardados: ya se ven en toda tu web."));
      onChanged();
    } catch (e) {
      toast.error((e as Error).message || tx("No se ha podido guardar"));
    }
  };

  return (
    <div className="space-y-8">
      <section className="space-y-4">
        <h3 className="text-sm font-semibold">{tx("Cabecera")}</h3>
        <Segmented
          label={tx("Estilo de la cabecera")}
          value={v.site_header_style}
          options={[
            { value: "classic", label: tx("Barra de serie") },
            { value: "centered", label: tx("Logo centrado") },
          ]}
          onChange={(x) => set({ site_header_style: x })}
        />
        <p className="text-xs text-muted-foreground">
          {v.site_header_style === "centered"
            ? tx("El logotipo va al centro y el menú se reparte a ambos lados. Sobre una portada a todo el ancho la cabecera es transparente; al desplazarte se convierte en una barra compacta. Con este estilo no se muestran el botón destacado ni el enlace a la tienda.")
            : tx("Una barra fija con el logotipo a la izquierda, el menú y el botón destacado.")}
        </p>
        {v.site_header_style === "centered" && (
          <Segmented
            label={tx("Texto sobre la portada")}
            value={v.site_header_tone}
            options={[
              { value: "dark", label: tx("Oscuro (portada clara)") },
              { value: "light", label: tx("Claro (portada oscura)") },
            ]}
            onChange={(x) => set({ site_header_tone: x })}
          />
        )}
        {v.site_header_style === "centered" && v.site_header_tone === "light" && (
          <div className="space-y-1">
            <ImageUploader label={tx("Logotipo para fondo oscuro (opcional)")} value={v.site_header_logo_light} onChange={(u) => set({ site_header_logo_light: u })} />
            <p className="text-xs text-muted-foreground">{tx("Se usa solo sobre la portada, con la cabecera transparente. Debe ser el mismo logotipo con los tonos oscuros aclarados.")}</p>
          </div>
        )}
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="chrome-header-cart" className="font-normal">{tx("Mostrar el carrito (si tu web vende en línea)")}</Label>
          <Switch id="chrome-header-cart" checked={v.site_header_cart !== "false"} onCheckedChange={(x) => set({ site_header_cart: x ? "true" : "false" })} />
        </div>
        <Segmented
          label={tx("Acabado de la web")}
          value={v.site_finish}
          options={[
            { value: "standard", label: tx("De serie") },
            { value: "editorial", label: tx("Editorial") },
          ]}
          onChange={(x) => set({ site_finish: x })}
        />
        <p className="text-xs text-muted-foreground">
          {v.site_finish === "editorial"
            ? tx("Botones rectos con letra espaciada, tarjetas con borde fino y elevación suave al pasar el cursor, titulares más ligeros y entrada gradual del contenido al desplazarte. No cambia ni el orden ni los textos.")
            : tx("Los botones, tarjetas y titulares de serie.")}
        </p>
        <Segmented
          label={tx("Botón destacado")}
          value={v.site_header_cta}
          options={[
            { value: "auto", label: tx("El de serie") },
            { value: "custom", label: tx("Uno propio") },
            { value: "none", label: tx("Ninguno") },
          ]}
          onChange={(x) => set({ site_header_cta: x })}
        />
        <p className="text-xs text-muted-foreground">
          {v.site_header_cta === "auto"
            ? tx("El de serie es «Pedir presupuesto» si tienes los presupuestos contratados.")
            : v.site_header_cta === "none"
              ? tx("La cabecera no mostrará ningún botón destacado.")
              : tx("Un botón con tu texto que lleva a la página o dirección que elijas.")}
        </p>
        {v.site_header_cta === "custom" && (
          <div className="space-y-3 rounded-lg border border-border p-3">
            <div className="space-y-1.5">
              <Label htmlFor="chrome-cta-label">{tx("Texto del botón")}</Label>
              <Input id="chrome-cta-label" value={v.site_header_cta_label} maxLength={CTA_LABEL_MAX} placeholder={tx("Reserva tu clase")} onChange={(e) => set({ site_header_cta_label: e.target.value })} />
            </div>
            <LinkPicker value={v.site_header_cta_url} onChange={(url) => set({ site_header_cta_url: url })} targets={targets} />
          </div>
        )}
        <MenuEditor zone="header" title={tx("Menú de la cabecera")} targets={targets} onChanged={onChanged} />
      </section>

      <section className="space-y-4 border-t border-border pt-6">
        <h3 className="text-sm font-semibold">{tx("Pie de página")}</h3>
        <div className="space-y-1.5">
          <span className="text-sm font-medium">{tx("Estilo")}</span>
          <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label={tx("Estilo del pie")}>
            {[
              { value: "dark", label: tx("Oscuro"), swatch: "bg-slate-900" },
              { value: "light", label: tx("Claro"), swatch: "bg-slate-100" },
              { value: "brand", label: tx("Color de marca"), swatch: "bg-primary" },
            ].map((o) => (
              <button
                key={o.value}
                type="button"
                role="radio"
                aria-checked={v.site_footer_style === o.value}
                onClick={() => set({ site_footer_style: o.value })}
                className={cn("flex flex-col items-center gap-1.5 rounded-lg border p-2 text-xs transition-colors", v.site_footer_style === o.value ? "border-primary ring-1 ring-primary" : "border-border hover:border-foreground/30")}
              >
                <span className={cn("h-7 w-full rounded-md border border-border", o.swatch)} aria-hidden />
                {o.label}
              </button>
            ))}
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="chrome-footer-text">{tx("Texto del pie (opcional)")}</Label>
          <Textarea id="chrome-footer-text" rows={2} maxLength={FOOTER_TEXT_MAX} value={v.site_footer_text} placeholder={tx("Escuela de esquí en Sierra Nevada desde 1998.")} onChange={(e) => set({ site_footer_text: e.target.value })} />
          <p className="text-xs text-muted-foreground">{tx("{vN} de {FOOTER_TEXT_MAX} caracteres", { vN: v.site_footer_text.length, FOOTER_TEXT_MAX: FOOTER_TEXT_MAX })}</p>
        </div>
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="chrome-footer-contact" className="font-normal">{tx("Mostrar dirección, teléfono y correo")}</Label>
          <Switch id="chrome-footer-contact" checked={v.site_footer_contact !== "false"} onCheckedChange={(x) => set({ site_footer_contact: x ? "true" : "false" })} />
        </div>
        <p className="text-xs text-muted-foreground">{tx("Los datos de contacto y el logotipo se cambian en «Estilo global». Los textos legales se enlazan siempre.")}</p>
        <FooterSocialEditor value={v.site_footer_social} onChange={(json) => set({ site_footer_social: json })} />
        <MenuEditor zone="footer" title={tx("Enlaces del pie")} targets={targets} onChanged={onChanged} />
        <p className="text-xs text-muted-foreground">{tx("Para organizar el pie en columnas, crea en «Menús» del CMS (zona Pie) un elemento sin enlace como título de columna y cuelga de él sus enlaces: hasta 4 columnas. Los elementos con enlace de primer nivel forman la franja legal inferior.")}</p>
        <FooterTranslationsButton />
      </section>

      <div className="sticky bottom-0 flex justify-end border-t border-border bg-background py-3">
        <Button onClick={onSave} disabled={save.isPending}>
          {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{" "}{tx("Guardar cabecera y pie")}</Button>
      </div>
    </div>
  );
}

type MenuRow = { id: number; label: string; url: string | null; parentId: number | null; sortOrder: number; isActive: boolean };

/** Enlaces de primer nivel de un menú: renombrar, cambiar a dónde llevan, ocultar, ordenar, quitar y añadir. */
function MenuEditor({ zone, title, targets, onChanged }: { zone: "header" | "footer"; title: string; targets: LinkTarget[]; onChanged: () => void }) {
  const tx = useStudioText();
  const utils = trpc.useUtils();
  const q = trpc.cms.getMenuItems.useQuery({ zone });
  const done = async () => {
    await utils.cms.getMenuItems.invalidate({ zone });
    onChanged();
  };
  const onError = (e: { message: string }) => toast.error(e.message || tx("No se ha podido guardar el menú"));
  const create = trpc.cms.createMenuItem.useMutation({ onSuccess: done, onError });
  const update = trpc.cms.updateMenuItem.useMutation({ onSuccess: done, onError });
  const remove = trpc.cms.deleteMenuItem.useMutation({ onSuccess: done, onError });
  const reorder = trpc.cms.reorderMenuItems.useMutation({ onSuccess: done, onError });
  const [confirmId, setConfirmId] = useState<number | null>(null);

  const all = (q.data ?? []) as MenuRow[];
  const rows = all.filter((m) => !m.parentId).sort((a, b) => a.sortOrder - b.sortOrder);
  const childrenOf = (id: number) => all.filter((m) => m.parentId === id).length;
  const busy = create.isPending || update.isPending || remove.isPending || reorder.isPending;

  const move = (i: number, dir: -1 | 1) => {
    const next = [...rows];
    const j = i + dir;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    reorder.mutate({ items: next.map((m, k) => ({ id: m.id, sortOrder: (k + 1) * 10 })) });
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">{title}</span>
        {busy && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" aria-label={tx("Guardando")} />}
      </div>
      {q.isLoading && <p className="text-xs text-muted-foreground">{tx("Cargando…")}</p>}
      {!q.isLoading && rows.length === 0 && <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">{tx("Todavía no hay enlaces.")}</p>}
      {rows.map((m, i) => (
        <div key={m.id} className={cn("space-y-2 rounded-lg border border-border p-3", !m.isActive && "opacity-60")}>
          <div className="flex items-center gap-2">
            <Input
              aria-label={tx("Texto del enlace")}
              defaultValue={m.label}
              maxLength={60}
              className="h-8"
              onBlur={(e) => {
                const label = e.target.value.trim();
                if (label && label !== m.label) update.mutate({ id: m.id, label });
                else if (!label) e.target.value = m.label;
              }}
            />
            <Button type="button" variant="ghost" size="icon" className="h-8 w-8" disabled={i === 0 || busy} onClick={() => move(i, -1)} aria-label={tx("Subir")}>
              <ArrowUp className="h-4 w-4" />
            </Button>
            <Button type="button" variant="ghost" size="icon" className="h-8 w-8" disabled={i === rows.length - 1 || busy} onClick={() => move(i, 1)} aria-label={tx("Bajar")}>
              <ArrowDown className="h-4 w-4" />
            </Button>
            {confirmId === m.id ? (
              <Button type="button" variant="destructive" size="sm" className="h-8" disabled={busy} onClick={() => (remove.mutate({ id: m.id }), setConfirmId(null))}>{tx("Quitar")}</Button>
            ) : (
              <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={() => setConfirmId(m.id)} aria-label={tx("Quitar este enlace")}>
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>
          <LinkPicker value={m.url ?? ""} onChange={(url) => url !== (m.url ?? "") && update.mutate({ id: m.id, url })} targets={targets} />
          <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
            <span>{childrenOf(m.id) ? tx("{id} enlaces en su submenú (se editan en «Menús» del CMS)", { id: childrenOf(m.id) }) : ""}</span>
            <label className="flex items-center gap-2">{tx("Visible")}<Switch checked={m.isActive} onCheckedChange={(x) => update.mutate({ id: m.id, isActive: x })} aria-label={tx("Visible")} />
            </label>
          </div>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={busy}
        onClick={() => create.mutate({ label: "Nuevo enlace", url: "/", menuZone: zone, sortOrder: ((rows.at(-1)?.sortOrder ?? 0) || rows.length * 10) + 10, target: "_self", isActive: true })}
      >
        <Plus className="mr-1.5 h-4 w-4" />{" "}{tx("Añadir enlace")}</Button>
    </div>
  );
}
