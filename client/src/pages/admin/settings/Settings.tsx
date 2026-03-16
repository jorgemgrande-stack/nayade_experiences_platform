import AdminLayout from "@/components/AdminLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Settings as SettingsIcon, Globe, Phone, Mail, MapPin, Link, Bell } from "lucide-react";

export default function Settings() {
  return (
    <AdminLayout title="Configuración">
      <div className="max-w-3xl space-y-8">
        <div>
          <h2 className="text-xl font-semibold text-foreground mb-1">Configuración General</h2>
          <p className="text-sm text-muted-foreground">Ajustes globales de la plataforma Náyade Experiences</p>
        </div>

        {/* Información del negocio */}
        <div className="bg-card border border-border rounded-xl p-6">
          <div className="flex items-center gap-2 mb-5">
            <Globe className="w-4 h-4 text-primary" />
            <h3 className="font-semibold text-foreground">Información del Negocio</h3>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <Label className="text-sm font-medium">Nombre del establecimiento</Label>
              <Input defaultValue="Náyade Experiences" className="mt-1.5" />
            </div>
            <div>
              <Label className="text-sm font-medium">Teléfono</Label>
              <Input defaultValue="+34 919 041 947" className="mt-1.5" />
            </div>
            <div>
              <Label className="text-sm font-medium">Email de contacto</Label>
              <Input defaultValue="hola@nayadeexperiences.es" className="mt-1.5" />
            </div>
            <div className="col-span-2">
              <Label className="text-sm font-medium">Dirección</Label>
              <Input defaultValue="Los Ángeles de San Rafael, Segovia" className="mt-1.5" />
            </div>
            <div className="col-span-2">
              <Label className="text-sm font-medium">Descripción breve (SEO)</Label>
              <Textarea defaultValue="El destino de aventuras del lago. Actividades náuticas, hotel y spa en el embalse de Los Ángeles de San Rafael, a 45 min de Madrid." className="mt-1.5 resize-none" rows={3} />
            </div>
          </div>
          <Button className="mt-5" onClick={() => toast.success("Configuración guardada")}>Guardar cambios</Button>
        </div>

        {/* Horarios */}
        <div className="bg-card border border-border rounded-xl p-6">
          <div className="flex items-center gap-2 mb-5">
            <Bell className="w-4 h-4 text-primary" />
            <h3 className="font-semibold text-foreground">Horarios de Apertura</h3>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label className="text-sm font-medium">Temporada alta (apertura)</Label>
              <Input defaultValue="10:00" type="time" className="mt-1.5" />
            </div>
            <div>
              <Label className="text-sm font-medium">Temporada alta (cierre)</Label>
              <Input defaultValue="20:00" type="time" className="mt-1.5" />
            </div>
            <div>
              <Label className="text-sm font-medium">Temporada baja (apertura)</Label>
              <Input defaultValue="10:00" type="time" className="mt-1.5" />
            </div>
            <div>
              <Label className="text-sm font-medium">Temporada baja (cierre)</Label>
              <Input defaultValue="18:00" type="time" className="mt-1.5" />
            </div>
            <div className="col-span-2">
              <Label className="text-sm font-medium">Días de apertura</Label>
              <Input defaultValue="Lunes a Domingo (Abril - Octubre)" className="mt-1.5" />
            </div>
          </div>
          <Button className="mt-5" onClick={() => toast.success("Horarios guardados")}>Guardar horarios</Button>
        </div>

        {/* Integración GHL */}
        <div className="bg-card border border-border rounded-xl p-6">
          <div className="flex items-center gap-2 mb-5">
            <Link className="w-4 h-4 text-primary" />
            <h3 className="font-semibold text-foreground">Integración GoHighLevel</h3>
          </div>
          <div className="space-y-4">
            <div>
              <Label className="text-sm font-medium">GHL API Key</Label>
              <Input type="password" placeholder="Introduce tu API Key de GoHighLevel" className="mt-1.5" />
              <p className="text-xs text-muted-foreground mt-1">Necesaria para sincronización de leads y envío de correos automáticos</p>
            </div>
            <div>
              <Label className="text-sm font-medium">GHL Location ID</Label>
              <Input placeholder="ID de la ubicación en GoHighLevel" className="mt-1.5" />
            </div>
          </div>
          <Button className="mt-5" onClick={() => toast.info("Para configurar GHL, añade las variables GHL_API_KEY y GHL_LOCATION_ID en Secrets del panel de gestión")}>
            Guardar integración GHL
          </Button>
        </div>

        {/* Pagos */}
        <div className="bg-card border border-border rounded-xl p-6">
          <div className="flex items-center gap-2 mb-5">
            <SettingsIcon className="w-4 h-4 text-primary" />
            <h3 className="font-semibold text-foreground">Configuración de Pagos</h3>
          </div>
          <div className="space-y-4">
            <div>
              <Label className="text-sm font-medium">IVA por defecto (%)</Label>
              <Input defaultValue="21" type="number" className="mt-1.5 max-w-xs" />
            </div>
            <div>
              <Label className="text-sm font-medium">Moneda</Label>
              <Input defaultValue="EUR" className="mt-1.5 max-w-xs" />
            </div>
            <div>
              <Label className="text-sm font-medium">Validez por defecto de presupuestos (días)</Label>
              <Input defaultValue="15" type="number" className="mt-1.5 max-w-xs" />
            </div>
          </div>
          <Button className="mt-5" onClick={() => toast.success("Configuración de pagos guardada")}>Guardar</Button>
        </div>
      </div>
    </AdminLayout>
  );
}
