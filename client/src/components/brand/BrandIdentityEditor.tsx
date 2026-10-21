/**
 * Editor de la identidad visual de la empresa: un único lugar para la marca que usan su WEB y su PANTALLA DE
 * ACCESO (mismos ajustes; ver server/_core/theme.ts). Lo usan «Marca y tema» (administración) y el paso «Marca»
 * de Primeros pasos. Guarda con `integrations.themeSave` (valida el servidor); los cambios se ven al momento,
 * sin desplegar nada.
 *
 * Vista previa del acceso en escritorio y móvil con el mismo componente que la pantalla real (AuthShell).
 */
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Monitor, RotateCcw, Smartphone } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import ImageUploader from "@/components/ImageUploader";
import { AuthShell } from "@/components/auth/AuthShell";
import { LoginForm } from "@/pages/Login";
import { loginLook, contrastRatio, type LoginThemeInput } from "@shared/loginBrand";

type Values = Record<string, string>;
type Background = "web" | "custom" | "none";

const TITLE_MAX = 80;
const MESSAGE_MAX = 240;
const LOGIN_KEYS = ["login_background_url", "login_welcome_title", "login_welcome_message"];
const HEX6 = /^#[0-9a-fA-F]{6}$/;

const backgroundOf = (v: Values): Background => (v.login_background_url === "none" ? "none" : v.login_background_url ? "custom" : "web");

/** Tema de la vista previa con las mismas reglas que el servidor (fondo de la web por defecto). */
function previewTheme(v: Values, bg: Background, base: { neutralSite: boolean; poweredBy: LoginThemeInput["poweredBy"]; address: string | null }): LoginThemeInput {
  return {
    neutralSite: base.neutralSite,
    brandName: v.brand_name?.trim() || null,
    logoUrl: v.brand_logo_url?.trim() || null,
    primaryColor: v.theme_primary_color?.trim() || null,
    accentColor: v.theme_accent_color?.trim() || null,
    contact: { address: v.brand_location?.trim() || base.address },
    poweredBy: base.poweredBy,
    login: {
      backgroundUrl: bg === "none" ? null : bg === "custom" ? v.login_background_url?.trim() || null : v.brand_hero_image_url?.trim() || null,
      title: v.login_welcome_title?.trim() || null,
      message: v.login_welcome_message?.trim() || null,
    },
  };
}

function ColorField({ id, label, value, onChange, hint }: { id: string; label: string; value: string; onChange: (v: string) => void; hint?: string }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex gap-2">
        <input
          type="color"
          aria-label={`${label}: selector`}
          value={HEX6.test(value) ? value : "#ffffff"}
          onChange={(e) => onChange(e.target.value)}
          className="h-10 w-12 shrink-0 rounded border border-border bg-transparent"
        />
        <Input id={id} value={value} placeholder="#1f3a5f" onChange={(e) => onChange(e.target.value)} aria-describedby={hint ? `${id}-hint` : undefined} />
      </div>
      {hint && <p id={`${id}-hint`} className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** Vista previa a escala: el contenido se pinta a su tamaño real (escritorio 1280 px, móvil 390 px). */
function Preview({ theme }: { theme: LoginThemeInput }) {
  const [mode, setMode] = useState<"desktop" | "mobile">("desktop");
  const look = useMemo(() => loginLook(theme), [theme]);
  const size = mode === "desktop" ? { w: 1280, h: 800, scale: 0.5 } : { w: 390, h: 780, scale: 0.55 };
  return (
    <section className="space-y-3" aria-labelledby="preview-title">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="preview-title" className="font-semibold">Vista previa de la pantalla de acceso</h3>
        <div className="inline-flex rounded-lg border border-border p-0.5" role="group" aria-label="Tamaño de la vista previa">
          {(["desktop", "mobile"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              aria-pressed={mode === m}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm ${mode === m ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              {m === "desktop" ? <Monitor className="w-4 h-4" aria-hidden="true" /> : <Smartphone className="w-4 h-4" aria-hidden="true" />}
              {m === "desktop" ? "Escritorio" : "Móvil"}
            </button>
          ))}
        </div>
      </div>
      <div className="overflow-hidden rounded-xl border border-border bg-muted/40 p-3">
        <div className="mx-auto overflow-hidden rounded-lg shadow-sm" style={{ width: size.w * size.scale, height: size.h * size.scale }}>
          <div style={{ width: size.w, height: size.h, transform: `scale(${size.scale})`, transformOrigin: "top left" }} aria-hidden="true" inert>
            <AuthShell look={look} preview>
              <LoginForm email="" password="" preview />
            </AuthShell>
          </div>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">Así se verá en la dirección de acceso de tu empresa. Los textos y colores se comprueban para que se lean bien.</p>
    </section>
  );
}

export function BrandIdentityEditor({ variant = "full", onSaved }: { variant?: "full" | "onboarding"; onSaved?: () => void }) {
  const q = trpc.integrations.themeGet.useQuery();
  const pub = trpc.public.getTheme.useQuery(undefined, { staleTime: 60_000 });
  const save = trpc.integrations.themeSave.useMutation();
  const utils = trpc.useUtils();
  const [v, setV] = useState<Values>({});
  const [saved, setSaved] = useState<Values>({});

  // «Otra imagen» se elige antes de subirla: el modo no se deduce solo del valor guardado
  const [bgMode, setBgMode] = useState<Background>("web");

  useEffect(() => {
    if (q.data) {
      setV(q.data);
      setSaved(q.data);
      setBgMode(backgroundOf(q.data));
    }
  }, [q.data]);

  const set = (k: string, val: string) => setV((x) => ({ ...x, [k]: val }));
  const bg = bgMode;
  const theme = useMemo(
    () => previewTheme(v, bg, { neutralSite: pub.data?.neutralSite ?? true, poweredBy: pub.data?.poweredBy ?? null, address: pub.data?.contact?.address ?? null }),
    [v, bg, pub.data],
  );
  const primary = (v.theme_primary_color ?? "").trim();
  const lowContrast = HEX6.test(primary) && (contrastRatio(primary, "#ffffff") ?? 21) < 3;
  const dirty = JSON.stringify(v) !== JSON.stringify(saved);

  async function persist(values: Values, message: string) {
    try {
      await save.mutateAsync({ values });
      await Promise.all([utils.integrations.themeGet.invalidate(), utils.public.getTheme.invalidate()]);
      toast.success(message);
      onSaved?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se ha podido guardar");
    }
  }

  if (q.isLoading) return <p className="text-sm text-muted-foreground" role="status">Cargando la marca…</p>;
  if (q.isError) return <p className="text-sm text-destructive" role="alert">No se ha podido cargar la marca: {q.error.message}</p>;

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <div className="space-y-6">
        {/* Identidad (web y acceso) */}
        <section className="rounded-2xl border border-border bg-card p-5 space-y-4" aria-labelledby="brand-id">
          <div>
            <h3 id="brand-id" className="font-semibold">Identidad</h3>
            <p className="text-sm text-muted-foreground">Se usa en tu web y en tu pantalla de acceso.</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="brand_name">Nombre comercial</Label>
            <Input id="brand_name" value={v.brand_name ?? ""} maxLength={120} onChange={(e) => set("brand_name", e.target.value)} />
          </div>
          <ImageUploader label="Logotipo" value={v.brand_logo_url ?? ""} onChange={(u) => set("brand_logo_url", u)} />
          <div className="grid gap-4 sm:grid-cols-2">
            <ColorField id="theme_primary_color" label="Color principal" value={v.theme_primary_color ?? ""} onChange={(c) => set("theme_primary_color", c)} />
            <ColorField id="theme_accent_color" label="Color de acento" value={v.theme_accent_color ?? ""} onChange={(c) => set("theme_accent_color", c)} />
          </div>
          {lowContrast && (
            <p className="text-sm text-amber-800 dark:text-amber-300" role="status">
              El color principal es muy claro para usarlo en botones sobre blanco: en el acceso los botones y enlaces se mostrarán en grafito para que se lean bien.
            </p>
          )}
          {variant === "full" && <ImageUploader label="Favicon (icono de la pestaña)" value={v.brand_favicon_url ?? ""} onChange={(u) => set("brand_favicon_url", u)} />}
        </section>

        {/* Pantalla de acceso */}
        <section className="rounded-2xl border border-border bg-card p-5 space-y-4" aria-labelledby="brand-login">
          <div>
            <h3 id="brand-login" className="font-semibold">Pantalla de acceso</h3>
            <p className="text-sm text-muted-foreground">Lo que ve tu equipo al entrar en el panel.</p>
          </div>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium mb-1">Imagen de fondo</legend>
            {(
              [
                ["web", "La imagen principal de mi web"],
                ["custom", "Otra imagen solo para el acceso"],
                ["none", "Sin imagen (solo el color principal)"],
              ] as const
            ).map(([val, label]) => (
              <label key={val} className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="login-bg"
                  value={val}
                  checked={bg === val}
                  onChange={() => {
                    setBgMode(val);
                    set("login_background_url", val === "none" ? "none" : val === "web" ? "" : backgroundOf(saved) === "custom" ? saved.login_background_url : "");
                  }}
                />
                {label}
              </label>
            ))}
          </fieldset>
          {bg === "web" && <ImageUploader label="Imagen principal de la web" value={v.brand_hero_image_url ?? ""} onChange={(u) => set("brand_hero_image_url", u)} />}
          {bg === "custom" && <ImageUploader label="Imagen de fondo del acceso" value={v.login_background_url ?? ""} onChange={(u) => set("login_background_url", u)} />}
          <div className="space-y-1.5">
            <Label htmlFor="login_welcome_title">Titular (opcional)</Label>
            <Input id="login_welcome_title" value={v.login_welcome_title ?? ""} maxLength={TITLE_MAX} placeholder={`Te damos la bienvenida a ${v.brand_name || "tu empresa"}`} onChange={(e) => set("login_welcome_title", e.target.value)} aria-describedby="login_welcome_title-n" />
            <p id="login_welcome_title-n" className="text-xs text-muted-foreground">{(v.login_welcome_title ?? "").length}/{TITLE_MAX}</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="login_welcome_message">Mensaje de bienvenida (opcional)</Label>
            <Textarea id="login_welcome_message" rows={3} value={v.login_welcome_message ?? ""} maxLength={MESSAGE_MAX} placeholder="Accede a tu panel para gestionar tu negocio." onChange={(e) => set("login_welcome_message", e.target.value)} aria-describedby="login_welcome_message-n" />
            <p id="login_welcome_message-n" className="text-xs text-muted-foreground">{(v.login_welcome_message ?? "").length}/{MESSAGE_MAX}</p>
          </div>
        </section>

        {variant === "full" && (
          <section className="rounded-2xl border border-border bg-card p-5 space-y-4" aria-labelledby="brand-more">
            <h3 id="brand-more" className="font-semibold">Web y contacto</h3>
            {(
              [
                ["theme_font_family", "Tipografía", "Inter, system-ui, sans-serif"],
                ["theme_radius", "Radio de bordes", "10px"],
                ["seo_description", "Descripción para buscadores", ""],
                ["brand_phone", "Teléfono", ""],
                ["email_reservations", "Correo de contacto", ""],
                ["brand_location", "Dirección", ""],
              ] as const
            ).map(([k, label, ph]) => (
              <div key={k} className="space-y-1.5">
                <Label htmlFor={k}>{label}</Label>
                <Input id={k} value={v[k] ?? ""} placeholder={ph} onChange={(e) => set(k, e.target.value)} />
              </div>
            ))}
          </section>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            onClick={() => {
              if (bg === "custom" && !(v.login_background_url ?? "").trim()) {
                toast.error("Sube la imagen de fondo del acceso o elige otra opción.");
                return;
              }
              void persist(v, "Marca guardada: ya se ve en tu web y en tu acceso");
            }}
            disabled={save.isPending || !dirty}
          >
            {save.isPending ? "Guardando…" : "Guardar"}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={save.isPending}
            onClick={() => {
              if (!window.confirm("¿Restaurar la pantalla de acceso a sus valores predeterminados? Se quitan el fondo propio, el titular y el mensaje; la marca y los colores se mantienen.")) return;
              const reset = Object.fromEntries(LOGIN_KEYS.map((k) => [k, ""]));
              setV((x) => ({ ...x, ...reset }));
              setBgMode("web");
              void persist(reset, "Pantalla de acceso restaurada");
            }}
          >
            <RotateCcw className="w-4 h-4 mr-1.5" aria-hidden="true" />
            Restaurar valores predeterminados del acceso
          </Button>
          {dirty && <span className="text-sm text-muted-foreground">Hay cambios sin guardar.</span>}
        </div>
      </div>

      <Preview theme={theme} />
    </div>
  );
}
