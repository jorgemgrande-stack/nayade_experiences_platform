import { useEffect, useState } from "react";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

const FIELDS: Array<{ key: string; label: string; placeholder?: string; type?: "color" | "text"; hint?: string }> = [
  { key: "brand_name", label: "Nombre comercial" },
  { key: "brand_logo_url", label: "Logotipo (URL https)", placeholder: "https://…/logo.png" },
  { key: "brand_favicon_url", label: "Favicon (URL https)", placeholder: "https://…/favicon.ico" },
  { key: "theme_primary_color", label: "Color principal", type: "color", placeholder: "#1f3a5f" },
  { key: "theme_accent_color", label: "Color de acento", type: "color", placeholder: "#c9a227" },
  { key: "theme_font_family", label: "Tipografía", placeholder: "Inter, system-ui, sans-serif" },
  { key: "theme_radius", label: "Radio de bordes", placeholder: "10px" },
  { key: "seo_description", label: "Descripción para buscadores" },
  { key: "brand_phone", label: "Teléfono" },
  { key: "email_reservations", label: "Correo de contacto" },
  { key: "brand_location", label: "Dirección" },
];

export default function BrandTheme() {
  const q = trpc.integrations.themeGet.useQuery();
  const save = trpc.integrations.themeSave.useMutation();
  const utils = trpc.useUtils();
  const [v, setV] = useState<Record<string, string>>({});

  useEffect(() => {
    if (q.data) setV(q.data);
  }, [q.data]);

  if (q.isLoading) {
    return (
      <AdminLayout>
        <div className="flex justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      <div className="max-w-2xl space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Marca y tema</h1>
          <p className="text-sm text-muted-foreground">
            Identidad corporativa de tu sitio público: nombre, logotipo, colores y tipografía.
          </p>
        </div>

        <form
          className="bg-card border border-border/50 rounded-2xl p-5 space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await save.mutateAsync({ values: v });
              await utils.integrations.themeGet.invalidate();
              await utils.public.getTheme.invalidate();
              toast.success("Marca guardada");
            } catch (err) {
              toast.error(err instanceof Error ? err.message : "No se pudo guardar");
            }
          }}
        >
          {FIELDS.map((f) => (
            <label key={f.key} className="block space-y-1">
              <span className="text-sm font-medium">{f.label}</span>
              <div className="flex gap-2">
                {f.type === "color" && /^#[0-9a-fA-F]{6}$/.test(v[f.key] ?? "") && (
                  <input
                    type="color"
                    aria-label={f.label}
                    value={v[f.key]}
                    onChange={(e) => setV({ ...v, [f.key]: e.target.value })}
                    className="h-10 w-12 rounded border border-border/60 bg-transparent"
                  />
                )}
                <input
                  className="flex-1 h-10 rounded-lg border border-border/60 bg-background px-3 text-sm"
                  value={v[f.key] ?? ""}
                  placeholder={f.placeholder}
                  onChange={(e) => setV({ ...v, [f.key]: e.target.value })}
                />
              </div>
            </label>
          ))}
          <button
            type="submit"
            disabled={save.isPending}
            className="h-10 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-60"
          >
            {save.isPending ? "Guardando…" : "Guardar"}
          </button>
        </form>
      </div>
    </AdminLayout>
  );
}
