import AdminLayout from "@/components/AdminLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Navigation, ExternalLink, Edit2, Eye } from "lucide-react";

const menuStructure = [
  { label: "Experiencias", href: "/experiencias", children: ["Blob Jump", "Banana Ski & Donuts", "Cableski & Wakeboard", "Canoas & Kayaks", "Paddle Surf", "Hidropedales", "Minimotos Eléctricas", "Paseos en Barco", "Aventura Hinchable"] },
  { label: "Packs", href: "/packs", children: ["Packs de Día", "Packs Escolares", "Team Building Empresas"] },
  { label: "Hotel", href: "/hotel", children: [] },
  { label: "SPA", href: "/spa", children: [] },
  { label: "Restaurantes", href: "/restaurantes", children: ["El Galeón", "La Cabaña del Lago", "Nassau Bar & Music"] },
  { label: "Galería", href: "/galeria", children: [] },
  { label: "Ubicación", href: "/ubicaciones", children: [] },
];

export default function MenusManager() {
  return (
    <AdminLayout title="Gestión de Menús">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-semibold text-foreground">Estructura del Menú de Navegación</h2>
          <p className="text-sm text-muted-foreground mt-1">Vista actual del menú del sitio público</p>
        </div>
        <Button onClick={() => toast.info("Editor de menús avanzado — próximamente")} className="bg-primary hover:bg-primary/90">
          <Edit2 className="w-4 h-4 mr-2" /> Editar Menú
        </Button>
      </div>

      <div className="grid gap-4">
        {menuStructure.map((item, i) => (
          <div key={i} className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="px-5 py-4 flex items-center justify-between bg-muted/30 border-b border-border">
              <div className="flex items-center gap-3">
                <Navigation className="w-4 h-4 text-primary" />
                <span className="font-semibold text-foreground">{item.label}</span>
                <code className="text-xs bg-muted px-2 py-0.5 rounded text-muted-foreground">{item.href}</code>
              </div>
              <div className="flex items-center gap-2">
                {item.children.length > 0 && (
                  <Badge variant="outline" className="text-xs">{item.children.length} submenús</Badge>
                )}
                <a href={item.href} target="_blank" rel="noreferrer">
                  <Button size="sm" variant="ghost">
                    <Eye className="w-3.5 h-3.5 mr-1" /> Ver
                  </Button>
                </a>
              </div>
            </div>
            {item.children.length > 0 && (
              <div className="px-5 py-3 flex flex-wrap gap-2">
                {item.children.map((child, j) => (
                  <Badge key={j} variant="secondary" className="text-xs font-normal">
                    <ExternalLink className="w-3 h-3 mr-1" />
                    {child}
                  </Badge>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="mt-6 p-4 bg-amber-50 border border-amber-200 rounded-xl">
        <p className="text-sm text-amber-800 font-medium">Nota sobre la edición de menús</p>
        <p className="text-xs text-amber-700 mt-1">La estructura del menú se gestiona directamente desde el código fuente del proyecto. Para añadir o modificar elementos del menú de navegación, los cambios se aplican en el archivo de configuración del componente de navegación. Contacta con el equipo técnico para modificaciones estructurales del menú.</p>
      </div>
    </AdminLayout>
  );
}
