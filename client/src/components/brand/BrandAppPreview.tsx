/**
 * Vista previa de cómo se aplica la marca en el panel: cabecera, menú, botones, tarjeta y mensaje, en tema claro y
 * en tema oscuro. Solo presentación: usa los mismos colores efectivos que aplica el panel (`brandTokens`), nunca
 * colores nuevos. Las superficies de la muestra son neutras (blanco / pizarra) para poder enseñar los dos temas a la vez.
 */
import { brandTokens, NEUTRAL_INK, readableOn } from "@shared/loginBrand";
import { useI18n } from "@/i18n/I18nProvider";

const RADIUS = /^\d{1,2}(\.\d{1,2})?(px|rem)$/;

export interface BrandAppPreviewProps {
  brandName: string;
  logoUrl: string;
  primaryColor: string;
  accentColor: string;
  fontFamily: string;
  radius: string;
}

function Mini({ dark, p }: { dark: boolean; p: BrandAppPreviewProps }) {
  const { t } = useI18n();
  const tokens = brandTokens({ neutralSite: true, primaryColor: p.primaryColor.trim() || null, accentColor: p.accentColor.trim() || null });
  const primary = tokens?.["--primary"] ?? "currentColor";
  const primaryFg = tokens?.["--primary-foreground"] ?? "currentColor";
  const accent = tokens?.["--accent"] ?? primary;
  const accentFg = tokens?.["--accent-foreground"] ?? primaryFg;
  const radius = RADIUS.test(p.radius.trim()) ? p.radius.trim() : undefined;
  const round = { borderRadius: radius ?? undefined };
  const name = p.brandName.trim() || t("brandEditor.login.headlineFallbackName");
  // Superficies neutras fijas (grafito de la marca de Big Elephant y su texto legible), no dependen del tema del panel
  const bgc = dark ? NEUTRAL_INK : readableOn(NEUTRAL_INK);
  const fg = dark ? readableOn(NEUTRAL_INK) : NEUTRAL_INK;
  const mix = (pct: number) => `color-mix(in srgb, ${fg} ${pct}%, ${bgc})`;
  const line = mix(18);
  const sub = mix(6);
  const muted = mix(68);
  const ringShadow = { boxShadow: `0 0 0 1px ${mix(30)}` };
  return (
    <figure className="min-w-0 space-y-1.5">
      <figcaption className="text-xs font-medium text-muted-foreground">{dark ? t("brandEditor.app.dark") : t("brandEditor.app.light")}</figcaption>
      <div className="overflow-hidden rounded-xl border shadow-sm" style={{ backgroundColor: bgc, color: fg, borderColor: line, fontFamily: p.fontFamily.trim() || undefined }} aria-hidden="true">
        <div className="flex items-center gap-2 border-b px-3 py-2" style={{ borderColor: line }}>
          {p.logoUrl.trim() ? (
            <img src={p.logoUrl} alt="" className="h-6 w-6 shrink-0 object-contain" />
          ) : (
            <span className="flex h-6 w-6 shrink-0 items-center justify-center text-xs font-bold" style={{ ...round, ...ringShadow, backgroundColor: primary, color: primaryFg }}>
              {name.slice(0, 1).toUpperCase()}
            </span>
          )}
          <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-sm font-semibold">{name}</span>
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold" style={{ backgroundColor: sub, borderColor: line }}>{t("brandEditor.app.user")}</span>
        </div>
        <div className="flex">
          <nav className="w-[34%] shrink-0 space-y-1 border-r p-2 text-xs" style={{ backgroundColor: sub, borderColor: line }}>
            <div className="px-2 py-1.5 font-medium" style={{ ...round, backgroundColor: `color-mix(in srgb, ${primary} 18%, transparent)`, borderLeft: `3px solid ${primary}` }}>{t("brandEditor.app.menuHome")}</div>
            <div className="px-2 py-1.5" style={{ color: muted }}>{t("brandEditor.app.menuClients")}</div>
            <div className="px-2 py-1.5" style={{ color: muted }}>{t("brandEditor.app.menuInvoices")}</div>
          </nav>
          <div className="min-w-0 flex-1 space-y-2.5 p-3">
            <div className="space-y-2 border p-3" style={{ ...round, borderColor: line }}>
              <p className="text-sm font-semibold">{t("brandEditor.app.cardTitle")}</p>
              <p className="text-xs" style={{ color: muted }}>{t("brandEditor.app.cardText")}</p>
              <div className="flex flex-wrap gap-2">
                <span className="inline-block px-3 py-1.5 text-xs font-medium" style={{ ...round, ...ringShadow, backgroundColor: primary, color: primaryFg }}>{t("brandEditor.app.primaryButton")}</span>
                <span className="inline-block border px-3 py-1.5 text-xs font-medium" style={{ ...round, borderColor: primary }}>{t("brandEditor.app.secondaryButton")}</span>
              </div>
            </div>
            <div className="px-3 py-2 text-xs font-medium" style={{ ...round, ...ringShadow, backgroundColor: accent, color: accentFg }}>
              {t("brandEditor.app.message")}
            </div>
          </div>
        </div>
      </div>
    </figure>
  );
}

export function BrandAppPreview(props: BrandAppPreviewProps) {
  const { t } = useI18n();
  return (
    <section className="space-y-3 rounded-2xl border border-border bg-card p-4 shadow-sm" aria-labelledby="brand-app-title">
      <div>
        <h3 id="brand-app-title" className="font-semibold">{t("brandEditor.app.title")}</h3>
        <p className="text-sm text-muted-foreground">{t("brandEditor.app.intro")}</p>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 @4xl:grid-cols-1 @6xl:grid-cols-2">
        <Mini dark={false} p={props} />
        <Mini dark p={props} />
      </div>
    </section>
  );
}
