/**
 * «Página no encontrada». En la web de una empresa, dentro de su web (su menú, su pie y su color de marca) y con su
 * nombre en la pestaña; en la instalación de una sola empresa, la pantalla suelta de siempre, en español.
 */
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Home, SearchX } from "lucide-react";
import { useLocation } from "wouter";
import PublicLayout from "@/components/PublicLayout";
import { usePageTitle, useTenantTheme } from "@/components/TenantTheme";

function Message({ onHome }: { onHome: () => void }) {
  return (
    <>
      <div className="flex justify-center mb-6">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
          <SearchX className="h-8 w-8 text-primary" aria-hidden="true" />
        </div>
      </div>
      <p className="text-sm font-semibold uppercase tracking-widest text-muted-foreground mb-2">Error 404</p>
      <h1 className="text-2xl md:text-3xl font-heading font-bold text-foreground mb-4">Página no encontrada</h1>
      <p className="text-foreground/80 mb-8 leading-relaxed">
        La página que buscas no existe o se ha movido.
        <br />
        Revisa la dirección o vuelve al inicio.
      </p>
      <div id="not-found-button-group" className="flex flex-col sm:flex-row gap-3 justify-center">
        <Button onClick={onHome} className="px-6">
          <Home className="w-4 h-4 mr-2" aria-hidden="true" />
          Volver al inicio
        </Button>
      </div>
    </>
  );
}

export default function NotFound() {
  const [location, setLocation] = useLocation();
  const { theme } = useTenantTheme();
  usePageTitle("Página no encontrada");
  // Áreas privadas (panel, portales): la pantalla suelta, sin el menú de la web
  const privateArea = /^[/](admin|empleado|partner|supplier|gestoria)([/]|$)/.test(location);
  const goHome = () => setLocation(location.startsWith("/admin") ? "/admin" : "/");

  if (theme?.neutralSite && !privateArea) {
    return (
      <PublicLayout>
        <section className="container py-20 md:py-28 max-w-xl text-center">
          <Message onHome={goHome} />
        </section>
      </PublicLayout>
    );
  }

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background">
      <Card className="w-full max-w-lg mx-4 shadow-lg border-0">
        <CardContent className="pt-8 pb-8 text-center">
          <Message onHome={goHome} />
        </CardContent>
      </Card>
    </div>
  );
}
