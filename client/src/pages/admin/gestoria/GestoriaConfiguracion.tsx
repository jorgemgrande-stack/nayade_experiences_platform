/**
 * Configuración Fiscal — Gestoría e Impuestos (Fase 1).
 *
 * Parámetros del módulo: tipo de Impuesto de Sociedades, cierre del ejercicio,
 * datos fiscales de la empresa y correos de la gestoría. Singleton (tax_settings).
 */
import { useState, useEffect } from "react";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Settings2, Save } from "lucide-react";

const MONTHS = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

export default function GestoriaConfiguracion() {
  const utils = trpc.useUtils();
  const settingsQ = trpc.gestoria.settings.get.useQuery();

  const [form, setForm] = useState({
    corporateTaxRate: "25",
    fiscalYearEndMonth: 12,
    companyNif: "",
    companyName: "",
    companyAddress: "",
    gestoriaEmails: "",
    iaeEpigraphs: "",
  });

  useEffect(() => {
    const d = settingsQ.data;
    if (d) {
      setForm({
        corporateTaxRate: d.corporateTaxRate != null ? String(d.corporateTaxRate) : "25",
        fiscalYearEndMonth: d.fiscalYearEndMonth ?? 12,
        companyNif: d.companyNif ?? "",
        companyName: d.companyName ?? "",
        companyAddress: d.companyAddress ?? "",
        gestoriaEmails: d.gestoriaEmails ?? "",
        iaeEpigraphs: d.iaeEpigraphs ?? "",
      });
    }
  }, [settingsQ.data]);

  const updateMut = trpc.gestoria.settings.update.useMutation({
    onSuccess: () => {
      toast.success("Configuración guardada");
      utils.gestoria.settings.get.invalidate();
    },
    onError: (e) => toast.error("Error: " + e.message),
  });

  return (
    <AdminLayout>
      <div className="p-6 space-y-6 max-w-2xl mx-auto">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Settings2 className="w-6 h-6 text-primary" /> Configuración Fiscal
          </h1>
          <p className="text-sm text-muted-foreground">
            Parámetros del módulo Gestoría e Impuestos
          </p>
        </div>

        {/* Empresa */}
        <div className="bg-card border border-border rounded-lg p-4 space-y-3">
          <h2 className="text-sm font-semibold text-foreground">Datos fiscales de la empresa</h2>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">NIF</Label>
              <Input value={form.companyNif} onChange={(e) => setForm({ ...form, companyNif: e.target.value })} placeholder="B12345678" />
            </div>
            <div>
              <Label className="text-xs">Razón social</Label>
              <Input value={form.companyName} onChange={(e) => setForm({ ...form, companyName: e.target.value })} />
            </div>
          </div>
          <div>
            <Label className="text-xs">Domicilio fiscal</Label>
            <Input value={form.companyAddress} onChange={(e) => setForm({ ...form, companyAddress: e.target.value })} />
          </div>
          <div>
            <Label className="text-xs">Epígrafes IAE</Label>
            <Input value={form.iaeEpigraphs} onChange={(e) => setForm({ ...form, iaeEpigraphs: e.target.value })} placeholder="Ej.: 755, 999" />
          </div>
        </div>

        {/* Parámetros fiscales */}
        <div className="bg-card border border-border rounded-lg p-4 space-y-3">
          <h2 className="text-sm font-semibold text-foreground">Parámetros del ejercicio</h2>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Tipo Impuesto de Sociedades (%)</Label>
              <Input
                type="number" step="0.01" min="0"
                value={form.corporateTaxRate}
                onChange={(e) => setForm({ ...form, corporateTaxRate: e.target.value })}
              />
            </div>
            <div>
              <Label className="text-xs">Cierre del ejercicio fiscal</Label>
              <Select
                value={String(form.fiscalYearEndMonth)}
                onValueChange={(v) => setForm({ ...form, fiscalYearEndMonth: Number(v) })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {MONTHS.map((m, i) => (
                    <SelectItem key={i} value={String(i + 1)}>{m.charAt(0).toUpperCase() + m.slice(1)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        {/* Gestoría */}
        <div className="bg-card border border-border rounded-lg p-4 space-y-3">
          <h2 className="text-sm font-semibold text-foreground">Gestoría externa</h2>
          <div>
            <Label className="text-xs">Correos de la gestoría</Label>
            <Input
              value={form.gestoriaEmails}
              onChange={(e) => setForm({ ...form, gestoriaEmails: e.target.value })}
              placeholder="gestoria@ejemplo.com, contacto@gestoria.com"
            />
            <p className="text-[11px] text-muted-foreground mt-1">
              Separados por comas. Se usarán al enviar expedientes (fase posterior).
            </p>
          </div>
        </div>

        <div className="flex justify-end">
          <Button
            onClick={() => updateMut.mutate({
              corporateTaxRate: form.corporateTaxRate,
              fiscalYearEndMonth: form.fiscalYearEndMonth,
              companyNif: form.companyNif,
              companyName: form.companyName,
              companyAddress: form.companyAddress,
              gestoriaEmails: form.gestoriaEmails,
              iaeEpigraphs: form.iaeEpigraphs,
            })}
            disabled={updateMut.isPending}
            className="gap-2"
          >
            <Save className="w-4 h-4" />
            {updateMut.isPending ? "Guardando…" : "Guardar configuración"}
          </Button>
        </div>
      </div>
    </AdminLayout>
  );
}
