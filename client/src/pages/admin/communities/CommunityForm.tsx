/**
 * Formulario de creación y configuración de una comunidad: identidad visual (portada, logotipo y color), descripción,
 * visibilidad y reglas de publicación. Las imágenes se suben con el almacenamiento de ficheros del Core.
 */
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import ImageUploader from "@/components/ImageUploader";
import { FormField, selectClass } from "@/components/admin/crm/CrmParts";
import {
  COLOR_RE,
  DESCRIPTION_MAX,
  NAME_MAX,
  POST_MODERATION,
  POST_MODERATION_LABELS,
  VISIBILITIES,
  VISIBILITY_LABELS,
  type PostModeration,
  type Visibility,
} from "@shared/communities";

export interface CommunityFormValues {
  name: string;
  slug?: string;
  description: string | null;
  coverImageUrl: string | null;
  logoUrl: string | null;
  accentColor: string | null;
  visibility: Visibility;
  allowMemberPosts: boolean;
  postModeration: PostModeration;
}

export const EMPTY_COMMUNITY: CommunityFormValues = {
  name: "",
  description: null,
  coverImageUrl: null,
  logoUrl: null,
  accentColor: null,
  visibility: "private",
  allowMemberPosts: true,
  postModeration: "none",
};

export function CommunityForm({ initial, showSlug, busy, submitLabel, onSubmit, onCancel, readOnly }: {
  initial: CommunityFormValues;
  showSlug?: boolean;
  busy?: boolean;
  submitLabel: string;
  onSubmit: (v: CommunityFormValues) => void;
  onCancel?: () => void;
  readOnly?: boolean;
}) {
  const [v, setV] = useState<CommunityFormValues>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = <K extends keyof CommunityFormValues>(k: K, val: CommunityFormValues[K]) => setV((s) => ({ ...s, [k]: val }));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (v.name.trim().length < 2) errs.name = "Pon un nombre de al menos 2 caracteres.";
    if (v.accentColor && !COLOR_RE.test(v.accentColor)) errs.accentColor = "Usa un color en formato #RRGGBB.";
    setErrors(errs);
    if (Object.keys(errs).length) return;
    onSubmit({ ...v, name: v.name.trim(), description: v.description?.trim() || null, slug: v.slug?.trim() || undefined });
  };

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <fieldset disabled={readOnly || busy} className="space-y-4">
        <FormField id="c-name" label="Nombre" required error={errors.name}>
          <Input id="c-name" value={v.name} maxLength={NAME_MAX} onChange={(e) => set("name", e.target.value)} aria-invalid={!!errors.name} />
        </FormField>
        {showSlug && (
          <FormField id="c-slug" label="Dirección" hint="Se usa en el enlace del área de miembros: /comunidad/<dirección>.">
            <Input id="c-slug" value={v.slug ?? ""} maxLength={80} onChange={(e) => set("slug", e.target.value)} />
          </FormField>
        )}
        <FormField id="c-desc" label="Descripción" hint="La ven los miembros en la cabecera de la comunidad.">
          <Textarea id="c-desc" rows={3} value={v.description ?? ""} maxLength={DESCRIPTION_MAX} onChange={(e) => set("description", e.target.value)} />
        </FormField>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <ImageUploader label="Imagen de portada" value={v.coverImageUrl ?? ""} onChange={(url) => set("coverImageUrl", url || null)} />
          </div>
          <div>
            <ImageUploader label="Logotipo" value={v.logoUrl ?? ""} onChange={(url) => set("logoUrl", url || null)} />
          </div>
        </div>
        <FormField id="c-color" label="Color de la comunidad" error={errors.accentColor} hint="Opcional. Sin color, se usa el de la empresa.">
          <div className="flex items-center gap-2">
            <input type="color" aria-label="Elegir color" className="h-9 w-12 rounded border border-input bg-background" value={v.accentColor ?? "#0f766e"} onChange={(e) => set("accentColor", e.target.value)} />
            <Input id="c-color" className="max-w-[8rem]" value={v.accentColor ?? ""} placeholder="#0F766E" onChange={(e) => set("accentColor", e.target.value || null)} aria-invalid={!!errors.accentColor} />
            {v.accentColor && (
              <Button type="button" variant="ghost" size="sm" onClick={() => set("accentColor", null)}>Quitar</Button>
            )}
          </div>
        </FormField>
        <FormField id="c-vis" label="Visibilidad">
          <select id="c-vis" className={selectClass} value={v.visibility} onChange={(e) => set("visibility", e.target.value as Visibility)}>
            {VISIBILITIES.map((x) => <option key={x} value={x}>{VISIBILITY_LABELS[x]}</option>)}
          </select>
        </FormField>
        <div className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
          <div>
            <p className="text-sm font-medium text-foreground">Los miembros pueden publicar</p>
            <p className="text-xs text-muted-foreground">Si lo desactivas, solo publican los moderadores y administradores; los miembros comentan y reaccionan.</p>
          </div>
          <Switch checked={v.allowMemberPosts} onCheckedChange={(c) => set("allowMemberPosts", c)} aria-label="Los miembros pueden publicar" />
        </div>
        <FormField id="c-mod" label="Publicaciones de los miembros">
          <select id="c-mod" className={selectClass} value={v.postModeration} onChange={(e) => set("postModeration", e.target.value as PostModeration)}>
            {POST_MODERATION.map((x) => <option key={x} value={x}>{POST_MODERATION_LABELS[x]}</option>)}
          </select>
        </FormField>
      </fieldset>
      <div className="flex justify-end gap-2">
        {onCancel && <Button type="button" variant="outline" onClick={onCancel}>Cancelar</Button>}
        {!readOnly && <Button type="submit" disabled={busy}>{busy ? "Guardando…" : submitLabel}</Button>}
      </div>
    </form>
  );
}
