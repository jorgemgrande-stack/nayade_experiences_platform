import AdminLayout from "@/components/AdminLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { FileText, Eye, Edit2, Globe } from "lucide-react";

const staticPages = [
  { name: "Inicio", path: "/", status: "publicada", lastEdit: "Hoy" },
  { name: "Experiencias", path: "/experiencias", status: "publicada", lastEdit: "Hoy" },
  { name: "Packs", path: "/packs", status: "publicada", lastEdit: "Hoy" },
  { name: "Hotel Náyade", path: "/hotel", status: "en desarrollo", lastEdit: "—" },
  { name: "SPA & Bienestar", path: "/spa", status: "en desarrollo", lastEdit: "—" },
  { name: "Restaurantes", path: "/restaurantes", status: "en desarrollo", lastEdit: "—" },
  { name: "Galería", path: "/galeria", status: "publicada", lastEdit: "Hoy" },
  { name: "Ubicación", path: "/ubicaciones", status: "publicada", lastEdit: "Hoy" },
  { name: "Solicitar Presupuesto", path: "/presupuesto", status: "publicada", lastEdit: "Hoy" },
  { name: "Contacto", path: "/contacto", status: "publicada", lastEdit: "Hoy" },
];

export default function PagesManager() {
  return (
    <AdminLayout title="Páginas del Sitio">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-semibold text-foreground">Páginas del Sitio Web</h2>
          <p className="text-sm text-muted-foreground mt-1">{staticPages.length} páginas en el sitio</p>
        </div>
        <Button onClick={() => toast.info("Creación de páginas personalizadas — próximamente")} className="bg-primary hover:bg-primary/90">
          <FileText className="w-4 h-4 mr-2" /> Nueva Página
        </Button>
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Página</th>
              <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">URL</th>
              <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Estado</th>
              <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Última edición</th>
              <th className="px-5 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {staticPages.map((page, i) => (
              <tr key={i} className="hover:bg-muted/20 transition-colors">
                <td className="px-5 py-3.5">
                  <div className="flex items-center gap-2">
                    <FileText className="w-4 h-4 text-muted-foreground" />
                    <span className="font-medium text-foreground text-sm">{page.name}</span>
                  </div>
                </td>
                <td className="px-5 py-3.5">
                  <code className="text-xs bg-muted px-2 py-1 rounded text-muted-foreground">{page.path}</code>
                </td>
                <td className="px-5 py-3.5">
                  <Badge variant={page.status === "publicada" ? "default" : "secondary"} className="text-xs capitalize">
                    <Globe className="w-3 h-3 mr-1" />
                    {page.status}
                  </Badge>
                </td>
                <td className="px-5 py-3.5 text-sm text-muted-foreground">{page.lastEdit}</td>
                <td className="px-5 py-3.5">
                  <div className="flex gap-1 justify-end">
                    <a href={page.path} target="_blank" rel="noreferrer">
                      <Button size="sm" variant="ghost" className="h-7 px-2">
                        <Eye className="w-3.5 h-3.5" />
                      </Button>
                    </a>
                    <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => toast.info("Editor visual de páginas — próximamente")}>
                      <Edit2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AdminLayout>
  );
}
