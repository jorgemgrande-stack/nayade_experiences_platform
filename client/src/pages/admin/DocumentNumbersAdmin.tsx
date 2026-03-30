/**
 * Panel Admin: Series de Numeración
 * Gestión centralizada de los contadores de documentos del sistema.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { AlertTriangle, RefreshCw, Edit2, History, Hash } from "lucide-react";

const DOC_TYPE_LABELS: Record<string, string> = {
  presupuesto: "Presupuestos",
  factura: "Facturas",
  reserva: "Reservas",
  tpv: "Tickets TPV",
  cupon: "Cupones",
  liquidacion: "Liquidaciones",
  anulacion: "Anulaciones",
};

const DOC_TYPE_COLORS: Record<string, string> = {
  presupuesto: "bg-blue-100 text-blue-800",
  factura: "bg-green-100 text-green-800",
  reserva: "bg-purple-100 text-purple-800",
  tpv: "bg-orange-100 text-orange-800",
  cupon: "bg-yellow-100 text-yellow-800",
  liquidacion: "bg-red-100 text-red-800",
  anulacion: "bg-gray-100 text-gray-800",
};

export default function DocumentNumbersAdmin() {
  const utils = trpc.useUtils();

  const { data: counters, isLoading } = trpc.documentNumbers.getCounters.useQuery();

  // Edit prefix dialog
  const [editDialog, setEditDialog] = useState<{
    open: boolean;
    documentType: string;
    year: number;
    currentPrefix: string;
    newPrefix: string;
  }>({ open: false, documentType: "", year: 0, currentPrefix: "", newPrefix: "" });

  // Reset counter dialog
  const [resetDialog, setResetDialog] = useState<{
    open: boolean;
    documentType: string;
    year: number;
    currentNumber: number;
    newValue: string;
  }>({ open: false, documentType: "", year: 0, currentNumber: 0, newValue: "" });

  // Logs dialog
  const [logsDialog, setLogsDialog] = useState<{
    open: boolean;
    documentType?: string;
  }>({ open: false });

  const { data: logs, isLoading: logsLoading } = trpc.documentNumbers.getLogs.useQuery(
    { documentType: logsDialog.documentType as any, limit: 100 },
    { enabled: logsDialog.open }
  );

  const updatePrefix = trpc.documentNumbers.updatePrefix.useMutation({
    onSuccess: () => {
      utils.documentNumbers.getCounters.invalidate();
      setEditDialog(d => ({ ...d, open: false }));
      toast.success("Prefijo actualizado", { description: "Los nuevos documentos usarán el nuevo prefijo." });
    },
    onError: (err) => toast.error("Error", { description: err.message }),
  });

  const resetCounter = trpc.documentNumbers.resetCounter.useMutation({
    onSuccess: () => {
      utils.documentNumbers.getCounters.invalidate();
      setResetDialog(d => ({ ...d, open: false }));
      toast.success("Contador reseteado", { description: "El contador ha sido actualizado correctamente." });
    },
    onError: (err) => toast.error("Error", { description: err.message }),
  });

  const nextNumber = (counter: { prefix: string; year: number; currentNumber: number }) =>
    `${counter.prefix}-${counter.year}-${String(counter.currentNumber + 1).padStart(4, "0")}`;

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Hash className="h-7 w-7 text-primary" />
        <div>
          <h1 className="text-2xl font-bold">Series de Numeración</h1>
          <p className="text-sm text-muted-foreground">
            Gestión centralizada de los contadores de documentos del sistema. Los cambios solo afectan a nuevos documentos.
          </p>
        </div>
      </div>

      {/* Aviso importante */}
      <div className="flex items-start gap-3 p-4 rounded-lg border border-amber-200 bg-amber-50 text-amber-800">
        <AlertTriangle className="h-5 w-5 mt-0.5 flex-shrink-0" />
        <div className="text-sm">
          <strong>Importante:</strong> Los números ya emitidos nunca se modifican. Cambiar el prefijo o resetear un contador
          solo afecta a los documentos generados a partir de ese momento. El reset manual está pensado exclusivamente
          para correcciones de inicio de año.
        </div>
      </div>

      {/* Tabla de contadores */}
      <Card>
        <CardHeader>
          <CardTitle>Contadores activos</CardTitle>
          <CardDescription>Estado actual de cada serie de numeración</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">Cargando contadores...</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tipo de documento</TableHead>
                  <TableHead>Año</TableHead>
                  <TableHead>Prefijo</TableHead>
                  <TableHead>Último emitido</TableHead>
                  <TableHead>Próximo número</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(counters ?? []).map((counter) => (
                  <TableRow key={`${counter.documentType}-${counter.year}`}>
                    <TableCell>
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${DOC_TYPE_COLORS[counter.documentType] ?? "bg-gray-100 text-gray-800"}`}>
                        {DOC_TYPE_LABELS[counter.documentType] ?? counter.documentType}
                      </span>
                    </TableCell>
                    <TableCell className="font-mono">{counter.year}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="font-mono">{counter.prefix}</Badge>
                    </TableCell>
                    <TableCell className="font-mono text-muted-foreground">
                      {counter.currentNumber === 0
                        ? "—"
                        : `${counter.prefix}-${counter.year}-${String(counter.currentNumber).padStart(4, "0")}`}
                    </TableCell>
                    <TableCell className="font-mono font-semibold text-primary">
                      {nextNumber(counter)}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setEditDialog({
                            open: true,
                            documentType: counter.documentType,
                            year: counter.year,
                            currentPrefix: counter.prefix,
                            newPrefix: counter.prefix,
                          })}
                          title="Editar prefijo"
                        >
                          <Edit2 className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setResetDialog({
                            open: true,
                            documentType: counter.documentType,
                            year: counter.year,
                            currentNumber: counter.currentNumber,
                            newValue: String(counter.currentNumber),
                          })}
                          title="Resetear contador"
                        >
                          <RefreshCw className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Botón de historial */}
      <div className="flex justify-end">
        <Button
          variant="outline"
          onClick={() => setLogsDialog({ open: true })}
        >
          <History className="h-4 w-4 mr-2" />
          Ver historial de generación
        </Button>
      </div>

      {/* Dialog: editar prefijo */}
      <Dialog open={editDialog.open} onOpenChange={(o) => setEditDialog(d => ({ ...d, open: o }))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar prefijo de serie</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <p className="text-sm text-muted-foreground mb-1">
                Serie: <strong>{DOC_TYPE_LABELS[editDialog.documentType]}</strong> — Año {editDialog.year}
              </p>
              <p className="text-sm text-muted-foreground">
                Prefijo actual: <code className="bg-muted px-1 rounded">{editDialog.currentPrefix}</code>
              </p>
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Nuevo prefijo (solo mayúsculas, números y guiones)</label>
              <Input
                value={editDialog.newPrefix}
                onChange={(e) => setEditDialog(d => ({ ...d, newPrefix: e.target.value.toUpperCase() }))}
                placeholder="ej: FAC"
                maxLength={16}
              />
            </div>
            <p className="text-xs text-amber-700 bg-amber-50 p-2 rounded border border-amber-200">
              Los documentos ya emitidos con el prefijo anterior no se verán afectados.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDialog(d => ({ ...d, open: false }))}>Cancelar</Button>
            <Button
              onClick={() => updatePrefix.mutate({
                documentType: editDialog.documentType as any,
                year: editDialog.year,
                newPrefix: editDialog.newPrefix,
              })}
              disabled={updatePrefix.isPending || !editDialog.newPrefix || editDialog.newPrefix === editDialog.currentPrefix}
            >
              {updatePrefix.isPending ? "Guardando..." : "Guardar prefijo"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog: resetear contador */}
      <Dialog open={resetDialog.open} onOpenChange={(o) => setResetDialog(d => ({ ...d, open: o }))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Resetear contador</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="flex items-start gap-3 p-3 rounded-lg border border-red-200 bg-red-50 text-red-800">
              <AlertTriangle className="h-5 w-5 mt-0.5 flex-shrink-0" />
              <p className="text-sm">
                <strong>Acción irreversible.</strong> Usar solo para correcciones de inicio de año o errores graves.
                Asegúrate de que el nuevo valor no genere números duplicados.
              </p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground mb-1">
                Serie: <strong>{DOC_TYPE_LABELS[resetDialog.documentType]}</strong> — Año {resetDialog.year}
              </p>
              <p className="text-sm text-muted-foreground">
                Valor actual: <code className="bg-muted px-1 rounded">{resetDialog.currentNumber}</code>
              </p>
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Nuevo valor del contador</label>
              <Input
                type="number"
                min={0}
                value={resetDialog.newValue}
                onChange={(e) => setResetDialog(d => ({ ...d, newValue: e.target.value }))}
              />
              <p className="text-xs text-muted-foreground mt-1">
                El próximo documento generado tendrá el número {parseInt(resetDialog.newValue || "0") + 1}.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResetDialog(d => ({ ...d, open: false }))}>Cancelar</Button>
            <Button
              variant="destructive"
              onClick={() => resetCounter.mutate({
                documentType: resetDialog.documentType as any,
                year: resetDialog.year,
                newValue: parseInt(resetDialog.newValue),
              })}
              disabled={resetCounter.isPending || resetDialog.newValue === ""}
            >
              {resetCounter.isPending ? "Reseteando..." : "Confirmar reset"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog: historial de logs */}
      <Dialog open={logsDialog.open} onOpenChange={(o) => setLogsDialog(d => ({ ...d, open: o }))}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Historial de generación de números</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex gap-2">
              <Select
                value={logsDialog.documentType ?? "all"}
                onValueChange={(v) => setLogsDialog(d => ({ ...d, documentType: v === "all" ? undefined : v }))}
              >
                <SelectTrigger className="w-48">
                  <SelectValue placeholder="Todos los tipos" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos los tipos</SelectItem>
                  {Object.entries(DOC_TYPE_LABELS).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {logsLoading ? (
              <div className="text-center py-8 text-muted-foreground">Cargando historial...</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Número generado</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Contexto</TableHead>
                    <TableHead>Generado por</TableHead>
                    <TableHead>Fecha</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(logs ?? []).map((log) => (
                    <TableRow key={log.id}>
                      <TableCell className="font-mono font-semibold">{log.documentNumber}</TableCell>
                      <TableCell>
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${DOC_TYPE_COLORS[log.documentType] ?? "bg-gray-100 text-gray-800"}`}>
                          {DOC_TYPE_LABELS[log.documentType] ?? log.documentType}
                        </span>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{log.context ?? "—"}</TableCell>
                      <TableCell className="text-xs">{log.generatedBy ?? "system"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {new Date(log.generatedAt).toLocaleString("es-ES")}
                      </TableCell>
                    </TableRow>
                  ))}
                  {(logs ?? []).length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-muted-foreground py-6">
                        No hay registros en el historial
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
