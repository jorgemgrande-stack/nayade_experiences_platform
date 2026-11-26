import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { useStudioText } from "@/components/admin/studio/useStudioText";

/**
 * Navegación editorial común de las páginas del CMS (páginas, blog, multimedia, galería, carrusel, portada, menús,
 * redirecciones e idiomas). Solo enlaza a las rutas que ya existen; no cambia permisos ni funcionalidad.
 */
const SECTIONS = [
  { href: "/admin/cms/paginas", label: "Páginas" },
  { href: "/admin/cms/blog", label: "Blog" },
  { href: "/admin/cms/multimedia", label: "Multimedia" },
  { href: "/admin/cms/galeria", label: "Galería" },
  { href: "/admin/cms/slideshow", label: "Carrusel" },
  { href: "/admin/cms/modulos-home", label: "Portada" },
  { href: "/admin/cms/menus", label: "Menús" },
  { href: "/admin/cms/redirecciones", label: "Redirecciones" },
  { href: "/admin/cms/idiomas", label: "Idiomas" },
] as const;

export default function CmsSectionNav({ className }: { className?: string }) {
  const tx = useStudioText();
  const [location] = useLocation();
  const path = location.split("?")[0].replace(/\/+$/, "");
  const current = path === "/admin/cms" ? "/admin/cms/slideshow" : path;
  return (
    <nav aria-label={tx("Contenidos")} className={cn("mb-4 -mx-1 overflow-x-auto", className)}>
      <ul className="flex min-w-max gap-1 border-b border-border px-1">
        {SECTIONS.map((s) => {
          const active = current === s.href || current.startsWith(`${s.href}/`);
          return (
            <li key={s.href}>
              <Link
                href={s.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "-mb-px inline-flex min-h-10 items-center border-b-2 px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  active ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {tx(s.label)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
