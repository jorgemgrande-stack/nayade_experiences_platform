import { useEditorialReveal } from "@/lib/useEditorialReveal";
import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import PublicNav from "./PublicNav";
import PublicFooter from "./PublicFooter";
import WhatsAppFloatingButton from "./WhatsAppFloatingButton";
import { useTheme } from "@/contexts/ThemeContext";
import { cn } from "@/lib/utils";
import { useTenantTheme } from "./TenantTheme";
import { brandTokens } from "@shared/loginBrand";

interface PublicLayoutProps {
  children: React.ReactNode;
  fullWidthHero?: boolean;
  darkContent?: boolean;
  /** Fuerza siempre light mode eliminando html.dark mientras el componente está montado */
  forcePublicLight?: boolean;
}

/**
 * Cabecera centrada: ¿la primera pieza de la página es una portada a todo el ancho (foto o vídeo pegados arriba)? Si lo es,
 * la cabecera se superpone y es transparente; si no, es una barra compacta fija. Y si ya se ha desplazado, pasa a barra.
 */
function useHeaderOverlay(enabled: boolean) {
  const [overHero, setOverHero] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [location] = useLocation();
  useEffect(() => {
    if (!enabled) {
      setOverHero(false);
      setScrolled(false);
      return;
    }
    const onScroll = () => setScrolled(window.scrollY > 48);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    let raf = 0;
    const check = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const first = document.querySelector("main")?.firstElementChild as HTMLElement | null;
        let hero = false;
        if (first) {
          const nodes = [first, ...Array.from(first.querySelectorAll<HTMLElement>("img,video,div")).slice(0, 80)];
          hero = nodes.some((el) => {
            const r = el.getBoundingClientRect();
            if (r.width < window.innerWidth * 0.9 || r.height < 200 || r.top + window.scrollY > 160) return false;
            return el.tagName === "IMG" || el.tagName === "VIDEO" || getComputedStyle(el).backgroundImage.includes("url(");
          });
        }
        setOverHero(hero);
      });
    };
    check();
    const main = document.querySelector("main");
    const mo = main ? new MutationObserver(check) : null;
    if (main) mo!.observe(main, { childList: true, subtree: true });
    window.addEventListener("resize", check);
    return () => {
      cancelAnimationFrame(raf);
      mo?.disconnect();
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", check);
    };
  }, [enabled, location]);
  return { overHero, scrolled };
}

export default function PublicLayout({
  children,
  fullWidthHero = false,
  darkContent = false,
  forcePublicLight = false,
}: PublicLayoutProps) {
  const { adminTheme, publicTheme } = useTheme();
  // Web neutra de una empresa: sin la barra superior de la instalación propia (32 px menos de cabecera)
  const { theme } = useTenantTheme();
  const neutral = !!theme?.neutralSite;
  // Marca de la empresa también dentro del modo claro forzado (force-light redefine los colores de la instalación propia)
  const brand = neutral ? brandTokens(theme) : null;
  const centered = neutral && theme?.header?.style === "centered" && !!theme.logoUrl;
  const hdr = useHeaderOverlay(centered);
  const [location] = useLocation();
  useEditorialReveal(neutral && theme?.finish === "editorial", location);

  // Cuando forcePublicLight=true: retirar dark de <html> mientras la página esté montada.
  // Al desmontar, restablecer si el admin estaba en oscuro.
  useEffect(() => {
    if (!forcePublicLight) return;
    const root = document.documentElement;
    const hadDark = root.classList.contains("dark");
    root.classList.remove("dark");
    return () => {
      if (hadDark) root.classList.add("dark");
    };
  }, [forcePublicLight]);

  // admin oscuro + public claro → forzar variables de light mode en la sección pública
  const forceLight = !forcePublicLight && adminTheme === "dark" && publicTheme === "light";
  // admin claro + public oscuro → añadir clase dark al wrapper para que dark: active
  const addDark = !forcePublicLight && adminTheme === "light" && publicTheme === "dark";

  return (
    <div className={cn(addDark && "dark")}>
      <div
        className={cn(
          "min-h-screen flex flex-col",
          forceLight && "force-light",
          // El texto hereda el color del tema de esta sección (no el del panel): contraste correcto sobre su fondo
          darkContent ? "bg-slate-900" : "bg-background text-foreground"
        )}
        style={brand ?? undefined}
      >
        <PublicNav overlay={{ centered, ...hdr }} />
        <main data-finish={neutral && theme?.finish === "editorial" ? "editorial" : undefined} data-hero-overlay={centered && hdr.overHero ? "" : undefined} className={cn("flex-1", !fullWidthHero && !(centered && hdr.overHero) && (centered ? "pt-16 lg:pt-[76px]" : neutral ? "pt-20" : "pt-20 lg:pt-[112px]"))}>
          {children}
        </main>
        <PublicFooter />
        <WhatsAppFloatingButton />
      </div>
    </div>
  );
}
