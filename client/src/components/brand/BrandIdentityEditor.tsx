/**
 * Editor de la identidad visual de la empresa: un único lugar para la marca que usan su WEB y su PANTALLA DE
 * ACCESO (mismos ajustes; ver server/_core/theme.ts). Lo usan «Marca y tema» (administración) y el paso «Marca»
 * de Primeros pasos. Guarda con `integrations.themeSave` (valida el servidor); los cambios se ven al momento,
 * sin desplegar nada.
 *
 * Presentación en secciones (Identidad, Colores, Tipografía, Pantalla de acceso, Web y contacto), con la vista
 * previa viva a un lado (o debajo en anchos estrechos): cómo se aplica la marca en el panel en claro y oscuro, y
 * el acceso en escritorio y móvil con el mismo componente que la pantalla real (AuthShell).
 */
import { confirmAction } from "@/components/admin/ConfirmHost";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { AlertCircle, CheckCircle2, Monitor, RotateCcw, Smartphone, Undo2, X } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import ImageUploader from "@/components/ImageUploader";
import { AuthShell } from "@/components/auth/AuthShell";
import { BrandAppPreview } from "@/components/brand/BrandAppPreview";
import { LoginForm } from "@/pages/Login";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n/I18nProvider";
import { loginLook, contrastRatio, brandTokens, colorFieldState, readableOn, NEUTRAL_INK, type LoginThemeInput } from "@shared/loginBrand";

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

/** Relación de contraste del mejor texto (blanco o grafito) sobre el color; null si no es un hex de 6 cifras. */
const textRatio = (c: string) => (HEX6.test(c.trim()) ? contrastRatio(c.trim(), readableOn(c.trim())) : null);

/** Sección del editor: cabecera con número, título y texto de ayuda, y su contenido. */
function Section({ id, step, title, intro, children }: { id: string; step: number; title: string; intro?: string; children: ReactNode }) {
  return (
    <section className="space-y-4 rounded-2xl border border-border bg-card p-5 shadow-sm" aria-labelledby={id}>
      <div className="flex items-start gap-3">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary" aria-hidden="true">{step}</span>
        <div className="min-w-0">
          <h3 id={id} className="font-semibold leading-7">{title}</h3>
          {intro && <p className="text-sm text-muted-foreground">{intro}</p>}
        </div>
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

function ColorField({ id, label, value, fallback, onChange }: { id: string; label: string; value: string; fallback: string; onChange: (v: string) => void }) {
  // La muestra enseña el color que se usa de verdad: el elegido o, sin elegir, el predeterminado
  const { t } = useI18n();
  const state = colorFieldState(value, fallback);
  // Los avisos de `colorFieldState` son texto español compartido con el servidor: aquí se muestran traducidos
  const hint = state.error ? t("brandEditor.colorInvalid") : state.note ? t("brandEditor.colorDefaultNote", { color: fallback }) : null;
  const ratio = textRatio(state.swatch);
  const aa = ratio !== null && ratio >= 4.5;
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex gap-2">
        <input
          type="color"
          aria-label={t("brandEditor.colorSelector", { label })}
          value={state.swatch}
          onChange={(e) => onChange(e.target.value)}
          className="h-10 w-12 shrink-0 cursor-pointer rounded-md border border-border bg-transparent p-0.5 shadow-sm"
        />
        <Input
          id={id}
          value={value}
          placeholder={t("brandEditor.colorPlaceholder")}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={state.error ? true : undefined}
          aria-describedby={hint ? `${id}-hint` : undefined}
        />
        {value.trim() && (
          <Button type="button" variant="ghost" size="icon" className="shrink-0" onClick={() => onChange("")} aria-label={t("brandEditor.colors.clear", { label })} title={t("brandEditor.colors.clear", { label })}>
            <X className="h-4 w-4" aria-hidden="true" />
          </Button>
        )}
      </div>
      {hint && (
        <p id={`${id}-hint`} className={cn("flex items-start gap-1.5 text-xs", state.error ? "text-destructive" : "text-muted-foreground")} role={state.error ? "alert" : undefined}>
          {state.error && <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
          {hint}
        </p>
      )}
      {!state.error && ratio !== null && (
        <p className={cn("flex items-start gap-1.5 text-xs", aa ? "text-success" : "text-warning")} role="status">
          {aa ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" /> : <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
          {aa ? t("brandEditor.colors.contrastOk", { ratio: ratio.toFixed(1) }) : t("brandEditor.colors.contrastWarn", { ratio: ratio.toFixed(1) })}
        </p>
      )}
    </div>
  );
}

/** Vista previa a escala: el contenido se pinta a su tamaño real (escritorio 1280 px, móvil 390 px). */
function Preview({ theme }: { theme: LoginThemeInput }) {
  const { t } = useI18n();
  const [mode, setMode] = useState<"desktop" | "mobile">("desktop");
  const look = useMemo(() => loginLook(theme), [theme]);
  const size = mode === "desktop" ? { w: 1280, h: 800, scale: 0.5 } : { w: 390, h: 780, scale: 0.55 };
  return (
    <section className="space-y-3 rounded-2xl border border-border bg-card p-4 shadow-sm" aria-labelledby="preview-title">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="preview-title" className="font-semibold">{t("brandEditor.preview.title")}</h3>
        <div className="inline-flex rounded-lg border border-border p-0.5" role="group" aria-label={t("brandEditor.preview.sizeLabel")}>
          {(["desktop", "mobile"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              aria-pressed={mode === m}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm ${mode === m ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              {m === "desktop" ? <Monitor className="w-4 h-4" aria-hidden="true" /> : <Smartphone className="w-4 h-4" aria-hidden="true" />}
              {m === "desktop" ? t("brandEditor.preview.desktop") : t("brandEditor.preview.mobile")}
            </button>
          ))}
        </div>
      </div>
      {/* La muestra escala con el ancho disponible (sin recortarse) */}
      <div className="overflow-hidden rounded-xl border border-border bg-muted/40 p-3">
        <ScaledFrame key={mode} w={size.w} h={size.h} maxScale={size.scale}>
          <AuthShell look={look} preview>
            <LoginForm email="" password="" preview />
          </AuthShell>
        </ScaledFrame>
      </div>
      <p className="text-xs text-muted-foreground">{t("brandEditor.preview.note")}</p>
    </section>
  );
}

/** Pinta `children` a tamaño real (w × h) y lo escala para que quepa en el ancho del contenedor (hasta `maxScale`). */
function ScaledFrame({ w, h, maxScale, children }: { w: number; h: number; maxScale: number; children: ReactNode }) {
  const [box, setBox] = useState<HTMLDivElement | null>(null);
  const [avail, setAvail] = useState(0);
  useEffect(() => {
    if (!box) return;
    const update = () => setAvail(box.clientWidth);
    update();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(update);
    ro.observe(box);
    return () => ro.disconnect();
  }, [box]);
  const scale = avail > 0 ? Math.min(maxScale, avail / w) : maxScale;
  return (
    <div ref={setBox} className="w-full">
      <div className="mx-auto overflow-hidden rounded-lg shadow-sm" style={{ width: w * scale, height: h * scale }}>
        <div style={{ width: w, height: h, transform: `scale(${scale})`, transformOrigin: "top left" }} aria-hidden="true" inert>
          {children}
        </div>
      </div>
    </div>
  );
}

export function BrandIdentityEditor({ variant = "full", onSaved }: { variant?: "full" | "onboarding"; onSaved?: () => void }) {
  const { t } = useI18n();
  const q = trpc.integrations.themeGet.useQuery();
  const pub = trpc.public.getTheme.useQuery(undefined, { staleTime: 60_000 });
  const save = trpc.integrations.themeSave.useMutation();
  const utils = trpc.useUtils();
  const [v, setV] = useState<Values>({});
  const [saved, setSaved] = useState<Values>({});

  // «Otra imagen» se elige antes de subirla: el modo no se deduce solo del valor guardado
  const [bgMode, setBgMode] = useState<Background>("web");
  // Error de campo visible (en vez de solo un aviso emergente) al guardar «otra imagen» sin subirla
  const [bgError, setBgError] = useState(false);

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
  // Colores que se usan cuando el campo está vacío (los mismos que aplica el panel)
  const tokens = brandTokens({ neutralSite: true, primaryColor: primary || null, accentColor: (v.theme_accent_color ?? "").trim() || null });
  const fallbackColors = { primary: tokens?.["--primary"] ?? NEUTRAL_INK, accent: tokens?.["--accent"] ?? NEUTRAL_INK };
  const dirty = JSON.stringify(v) !== JSON.stringify(saved);

  async function persist(values: Values, message: string) {
    try {
      await save.mutateAsync({ values });
      await Promise.all([utils.integrations.themeGet.invalidate(), utils.public.getTheme.invalidate()]);
      toast.success(message);
      onSaved?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("brandEditor.saveError"));
    }
  }

  if (q.isLoading) return <p className="text-sm text-muted-foreground" role="status">{t("brandEditor.loading")}</p>;
  if (q.isError) return <p className="text-sm text-destructive" role="alert">{t("brandEditor.loadError", { message: q.error.message })}</p>;

  const full = variant === "full";
  const loginStep = full ? 4 : 3;

  return (
    <div className="@container">
      <div className="grid grid-cols-1 gap-6 @4xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] @4xl:items-start">
        <div className="space-y-5">
          {/* 1 · Identidad (web y acceso) */}
          <Section id="brand-id" step={1} title={t("brandEditor.identity.title")} intro={t("brandEditor.identity.intro")}>
            <div className="space-y-1.5">
              <Label htmlFor="brand_name">{t("brandEditor.identity.name")}</Label>
              <Input id="brand_name" value={v.brand_name ?? ""} maxLength={120} onChange={(e) => set("brand_name", e.target.value)} />
            </div>
            <div className={cn("grid grid-cols-1 gap-4", full && "sm:grid-cols-2")}>
              <ImageUploader label={t("brandEditor.identity.logo")} value={v.brand_logo_url ?? ""} onChange={(u) => set("brand_logo_url", u)} />
              {full && <ImageUploader label={t("brandEditor.identity.favicon")} value={v.brand_favicon_url ?? ""} onChange={(u) => set("brand_favicon_url", u)} />}
            </div>
          </Section>

          {/* 2 · Colores */}
          <Section id="brand-colors" step={2} title={t("brandEditor.colors.title")} intro={t("brandEditor.colors.intro")}>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <ColorField id="theme_primary_color" label={t("brandEditor.identity.primary")} value={v.theme_primary_color ?? ""} fallback={fallbackColors.primary} onChange={(c) => set("theme_primary_color", c)} />
              <ColorField id="theme_accent_color" label={t("brandEditor.identity.accent")} value={v.theme_accent_color ?? ""} fallback={fallbackColors.accent} onChange={(c) => set("theme_accent_color", c)} />
            </div>
            {lowContrast && (
              <p className="flex items-start gap-2 rounded-lg border border-warning/50 bg-warning/10 p-3 text-sm text-foreground" role="status">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
                {t("brandEditor.identity.lowContrast")}
              </p>
            )}
          </Section>

          {/* 3 · Tipografía */}
          {full && (
            <Section id="brand-type" step={3} title={t("brandEditor.typography.title")} intro={t("brandEditor.typography.intro")}>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="theme_font_family">{t("brandEditor.more.font")}</Label>
                  <Input id="theme_font_family" value={v.theme_font_family ?? ""} placeholder="Inter, system-ui, sans-serif" onChange={(e) => set("theme_font_family", e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="theme_radius">{t("brandEditor.more.radius")}</Label>
                  <Input id="theme_radius" value={v.theme_radius ?? ""} placeholder="10px" onChange={(e) => set("theme_radius", e.target.value)} />
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-muted/40 p-3" style={{ fontFamily: (v.theme_font_family ?? "").trim() || undefined }} aria-hidden="true">
                <span className="text-2xl font-semibold">Aa</span>
                <span className="min-w-0 flex-1 text-sm">{t("brandEditor.typography.sample")}</span>
                <span className="border border-border bg-card px-3 py-1.5 text-xs font-medium" style={{ borderRadius: /^\d{1,2}(\.\d{1,2})?(px|rem)$/.test((v.theme_radius ?? "").trim()) ? (v.theme_radius ?? "").trim() : undefined }}>
                  {t("brandEditor.app.primaryButton")}
                </span>
              </div>
            </Section>
          )}

          {/* Pantalla de acceso */}
          <Section id="brand-login" step={loginStep} title={t("brandEditor.login.title")} intro={t("brandEditor.login.intro")}>
            <fieldset className="space-y-2">
              <legend className="mb-1 text-sm font-medium">{t("brandEditor.login.background")}</legend>
              {(
                [
                  ["web", t("brandEditor.login.bgWeb")],
                  ["custom", t("brandEditor.login.bgCustom")],
                  ["none", t("brandEditor.login.bgNone")],
                ] as const
              ).map(([val, label]) => (
                <label key={val} className={cn("flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm", bg === val ? "border-primary bg-primary/5" : "border-border hover:bg-muted/40")}>
                  <input
                    type="radio"
                    name="login-bg"
                    value={val}
                    checked={bg === val}
                    onChange={() => {
                      setBgMode(val);
                      setBgError(false);
                      set("login_background_url", val === "none" ? "none" : val === "web" ? "" : backgroundOf(saved) === "custom" ? saved.login_background_url : "");
                    }}
                  />
                  {label}
                </label>
              ))}
            </fieldset>
            {bg === "web" && <ImageUploader label={t("brandEditor.login.heroImage")} value={v.brand_hero_image_url ?? ""} onChange={(u) => set("brand_hero_image_url", u)} />}
            {bg === "custom" && (
              <div className="space-y-1.5">
                <ImageUploader label={t("brandEditor.login.customImage")} value={v.login_background_url ?? ""} onChange={(u) => { setBgError(false); set("login_background_url", u); }} />
                {bgError && !(v.login_background_url ?? "").trim() && (
                  <p className="flex items-start gap-1.5 text-xs text-destructive" role="alert">
                    <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    {t("brandEditor.actions.needBackground")}
                  </p>
                )}
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="login_welcome_title">{t("brandEditor.login.headline")}</Label>
              <Input id="login_welcome_title" value={v.login_welcome_title ?? ""} maxLength={TITLE_MAX} placeholder={t("brandEditor.login.headlinePlaceholder", { name: v.brand_name || t("brandEditor.login.headlineFallbackName") })} onChange={(e) => set("login_welcome_title", e.target.value)} aria-describedby="login_welcome_title-n" />
              <p id="login_welcome_title-n" className="text-xs text-muted-foreground">{(v.login_welcome_title ?? "").length}/{TITLE_MAX}</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="login_welcome_message">{t("brandEditor.login.message")}</Label>
              <Textarea id="login_welcome_message" rows={3} value={v.login_welcome_message ?? ""} maxLength={MESSAGE_MAX} placeholder={t("brandEditor.login.messagePlaceholder")} onChange={(e) => set("login_welcome_message", e.target.value)} aria-describedby="login_welcome_message-n" />
              <p id="login_welcome_message-n" className="text-xs text-muted-foreground">{(v.login_welcome_message ?? "").length}/{MESSAGE_MAX}</p>
            </div>
          </Section>

          {full && (
            <Section id="brand-more" step={loginStep + 1} title={t("brandEditor.more.title")}>
              {(
                [
                  ["seo_description", t("brandEditor.more.seo"), ""],
                  ["brand_phone", t("brandEditor.more.phone"), ""],
                  ["email_reservations", t("brandEditor.more.email"), ""],
                  ["brand_location", t("brandEditor.more.address"), ""],
                ] as const
              ).map(([k, label, ph]) => (
                <div key={k} className="space-y-1.5">
                  <Label htmlFor={k}>{label}</Label>
                  <Input id={k} value={v[k] ?? ""} placeholder={ph} onChange={(e) => set(k, e.target.value)} />
                </div>
              ))}
            </Section>
          )}

          {full && pub.data?.neutralSite && (
            <Section id="brand-analytics" step={loginStep + 2} title={t("brandEditor.analytics.title")} intro={t("brandEditor.analytics.intro")}>
              {(
                [
                  ["analytics_ga4_id", t("brandEditor.analytics.ga4"), "G-XXXXXXXXXX"],
                  ["analytics_meta_pixel_id", t("brandEditor.analytics.pixel"), "123456789012345"],
                ] as const
              ).map(([k, label, ph]) => (
                <div key={k} className="space-y-1.5">
                  <Label htmlFor={k}>{label}</Label>
                  <Input id={k} value={v[k] ?? ""} placeholder={ph} autoComplete="off" onChange={(e) => set(k, e.target.value)} />
                </div>
              ))}
            </Section>
          )}

          {/* Barra de acciones: siempre a mano al final del formulario */}
          <div className="sticky bottom-0 z-10 flex flex-col gap-3 rounded-xl border border-border bg-card/95 p-3 shadow-lg backdrop-blur sm:flex-row sm:flex-wrap sm:items-center">
            <p className={cn("flex items-center gap-1.5 text-sm sm:mr-auto", dirty ? "font-medium text-warning" : "text-muted-foreground")} role="status">
              {dirty ? <AlertCircle className="h-4 w-4" aria-hidden="true" /> : <CheckCircle2 className="h-4 w-4" aria-hidden="true" />}
              {dirty ? t("brandEditor.actions.unsaved") : t("brandEditor.actions.clean")}
            </p>
            <Button
              type="button"
              variant="outline"
              disabled={save.isPending}
              onClick={async () => {
                if (!(await confirmAction({ description: t("brandEditor.actions.confirmReset"), destructive: true }))) return;
                const reset = Object.fromEntries(LOGIN_KEYS.map((k) => [k, ""]));
                setV((x) => ({ ...x, ...reset }));
                setBgMode("web");
                setBgError(false);
                void persist(reset, t("brandEditor.actions.resetDone"));
              }}
            >
              <RotateCcw className="w-4 h-4 mr-1.5" aria-hidden="true" />
              {t("brandEditor.actions.reset")}
            </Button>
            {dirty && (
              <Button
                type="button"
                variant="ghost"
                disabled={save.isPending}
                onClick={() => {
                  setV(saved);
                  setBgMode(backgroundOf(saved));
                  setBgError(false);
                }}
              >
                <Undo2 className="w-4 h-4 mr-1.5" aria-hidden="true" />
                {t("brandEditor.actions.discard")}
              </Button>
            )}
            {variant === "onboarding" && !dirty ? (
              // En Primeros pasos, quedarse con la marca tal cual también completa el paso (no es «omitirlo»)
              <Button type="button" onClick={() => onSaved?.()}>
                {t("brandEditor.actions.continueBrand")}
              </Button>
            ) : (
              <Button
                type="button"
                onClick={() => {
                  if (bg === "custom" && !(v.login_background_url ?? "").trim()) {
                    setBgError(true);
                    toast.error(t("brandEditor.actions.needBackground"));
                    return;
                  }
                  void persist(v, t("brandEditor.actions.savedMessage"));
                }}
                disabled={save.isPending || !dirty}
              >
                {save.isPending ? t("brandEditor.actions.saving") : variant === "onboarding" ? t("brandEditor.actions.saveContinue") : t("brandEditor.actions.save")}
              </Button>
            )}
          </div>
        </div>

        {/* Vista previa viva: al lado (fija al desplazarse) o debajo según el ancho */}
        <div className="space-y-5 @4xl:sticky @4xl:top-4">
          <BrandAppPreview
            brandName={v.brand_name ?? ""}
            logoUrl={v.brand_logo_url ?? ""}
            primaryColor={v.theme_primary_color ?? ""}
            accentColor={v.theme_accent_color ?? ""}
            fontFamily={v.theme_font_family ?? ""}
            radius={v.theme_radius ?? ""}
          />
          <Preview theme={theme} />
        </div>
      </div>
    </div>
  );
}
