/**
 * Expedientes para Gestoría — Gestoría e Impuestos (Fase 5).
 *
 * Genera expedientes ZIP del ejercicio (resúmenes IVA, laboral, sociedades y
 * calendario en CSV) y gestiona los accesos al Portal de Gestoría.
 */
import { useState } from "react";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { FolderArchive, RefreshCw, Download, UserPlus, FileArchive } from "lucide-react";

export default function GestoriaExpedientes() {
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const [gName, setGName] = useState("");
  const [gEmail, setGEmail] = useState("");
  const utils = trpc.useUtils();

  const dossiersQ = trpc.gestoria.dossiers.list.useQuery(undefined);
  const accessQ = trpc.gestoria.access.list.useQuery();

  const generateMut = trpc.gestoria.dossiers.generate.useMutation({
    onSuccess: () => {
      toast.success("Expediente generado");
      utils.gestoria.dossiers.list.invalidate();
    },
    onError: (e) => toast.error("Error: " + e.message),
  });

  const accessMut = trpc.gestoria.access.createPortalAccess.useMutation({
    onSuccess: () => {
      toast.success("Acceso de gestoría creado — se ha enviado el enlace de activación");
      setGName(""); setGEmail("");
      utils.gestoria.access.list.invalidate();
    },
    onError: (e) => toast.error("Error: " + e.message),
  });

  const yearOptions = [currentYear - 1, currentYear, currentYear + 1];
  const dossiers = dossiersQ.data ?? [];
  const accesses = accessQ.data ?? [];

  return (
    <AdminLayout>
      <div className="p-6 space-y-6 max-w-3xl mx-auto">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <FolderArchive className="w-6 h-6 text-primary" /> Expedientes para Gestoría
          </h1>
          <p className="text-sm text-muted-foreground">Genera y comparte los expedientes fiscales del ejercicio</p>
        </div>

        {/* Generar expediente */}
        <div className="bg-card border border-border rounded-lg p-4 space-y-3">
          <h2 className="text-sm font-semibold text-foreground">Generar expediente del ejercicio</h2>
          <div className="flex items-end gap-3">
            <div>
              <Label className="text-xs">Ejercicio</Label>
              <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
                <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {yearOptions.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <Button onClick={() => generateMut.mutate({ year })} disabled={generateMut.isPending} className="gap-2">
              {generateMut.isPending ? <RefreshCw className="w-4 h-4 animate-spin" /> : <FileArchive className="w-4 h-4" />}
              Generar ZIP
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            El ZIP incluye los resúmenes de IVA (303), retenciones (111), Sociedades (200/202) y el
            calendario de obligaciones en CSV, más un resumen ejecutivo.
          </p>
        </div>

        {/* Lista de expedientes */}
        <div className="bg-card border border-border rounded-lg p-4">
          <h2 className="text-sm font-semibold text-foreground mb-2">Expedientes generados</h2>
          {dossiers.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aún no se ha generado ningún expediente.</p>
          ) : (
            <div className="space-y-1.5">
              {dossiers.map((d) => (
                <div key={d.id} className="flex items-center justify-between text-sm border-b border-border/50 last:border-0 pb-1.5 last:pb-0">
                  <div>
                    <div className="text-foreground/80">{d.title}</div>
                    <div className="text-xs text-muted-foreground">
                      {new Date(d.createdAt).toLocaleString("es-ES")} · {d.fileCount ?? 0} ficheros
                      {d.fileSize ? ` · ${(d.fileSize / 1024).toFixed(0)} KB` : ""}
                    </div>
                  </div>
                  {d.fileUrl && (
                    <a href={d.fileUrl} target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-1 text-xs text-primary hover:underline">
                      <Download className="w-3.5 h-3.5" /> Descargar
                    </a>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Accesos de gestoría */}
        <div className="bg-card border border-border rounded-lg p-4 space-y-3">
          <h2 className="text-sm font-semibold text-foreground">Acceso al Portal de Gestoría</h2>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Nombre de la gestoría</Label>
              <Input value={gName} onChange={(e) => setGName(e.target.value)} placeholder="Gestoría Ejemplo S.L." />
            </div>
            <div>
              <Label className="text-xs">Email</Label>
              <Input value={gEmail} onChange={(e) => setGEmail(e.target.value)} placeholder="contacto@gestoria.com" />
            </div>
          </div>
          <Button
            onClick={() => {
              if (!gName.trim() || !gEmail.trim()) { toast.error("Rellena nombre y email"); return; }
              accessMut.mutate({ name: gName.trim(), email: gEmail.trim() });
            }}
            disabled={accessMut.isPending}
            variant="outline"
            className="gap-2"
          >
            <UserPlus className="w-4 h-4" />
            {accessMut.isPending ? "Creando…" : "Crear acceso y enviar invitación"}
          </Button>

          {accesses.length > 0 && (
            <div className="space-y-1 pt-1">
              {accesses.map((a) => (
                <div key={a.id} className="flex items-center justify-between text-sm border-t border-border/50 pt-1.5">
                  <span className="text-foreground/80">{a.name} · {a.email}</span>
                  <span className={`text-xs font-medium ${a.inviteAccepted ? "text-emerald-400" : "text-amber-400"}`}>
                    {a.inviteAccepted ? "Activa" : "Pendiente de activar"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </AdminLayout>
  );
}
