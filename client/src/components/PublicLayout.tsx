import { useEffect } from "react";
import PublicNav from "./PublicNav";
import PublicFooter from "./PublicFooter";
import WhatsAppFloatingButton from "./WhatsAppFloatingButton";
import { useTheme } from "@/contexts/ThemeContext";
import { cn } from "@/lib/utils";

interface PublicLayoutProps {
  children: React.ReactNode;
  fullWidthHero?: boolean;
  darkContent?: boolean;
  /** Fuerza siempre light mode eliminando html.dark mientras el componente está montado */
  forcePublicLight?: boolean;
}

export default function PublicLayout({
  children,
  fullWidthHero = false,
  darkContent = false,
  forcePublicLight = false,
}: PublicLayoutProps) {
  const { adminTheme, publicTheme } = useTheme();

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
          darkContent ? "bg-slate-900" : "bg-background"
        )}
      >
        <PublicNav />
        <main className={cn("flex-1", !fullWidthHero && "pt-20 lg:pt-[112px]")}>
          {children}
        </main>
        <PublicFooter />
        <WhatsAppFloatingButton />
      </div>
    </div>
  );
}
