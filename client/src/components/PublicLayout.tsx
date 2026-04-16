import PublicNav from "./PublicNav";
import PublicFooter from "./PublicFooter";
import { useTheme } from "@/contexts/ThemeContext";
import { cn } from "@/lib/utils";

interface PublicLayoutProps {
  children: React.ReactNode;
  fullWidthHero?: boolean;
  darkContent?: boolean;
  /** Fuerza siempre light mode (p.ej. checkout — páginas transaccionales) */
  forcePublicLight?: boolean;
}

export default function PublicLayout({
  children,
  fullWidthHero = false,
  darkContent = false,
  forcePublicLight = false,
}: PublicLayoutProps) {
  const { adminTheme, publicTheme } = useTheme();

  // admin oscuro + public claro → forzar variables de light mode en la sección pública
  // También si la página exige siempre light (checkout, etc.)
  const forceLight = forcePublicLight || (adminTheme === "dark" && publicTheme === "light");
  // admin claro + public oscuro → añadir clase dark al wrapper (solo si no se fuerza light)
  const addDark = !forcePublicLight && adminTheme === "light" && publicTheme === "dark";

  return (
    // Wrapper de scope: aplica 'dark' al árbol si el public debe ser oscuro con admin claro
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
      </div>
    </div>
  );
}
