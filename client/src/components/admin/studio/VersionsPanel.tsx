/**
 * Elephant Studio — historial de versiones publicadas de la página. Cada publicación guarda una versión; cualquiera
 * se puede ver en el lienzo y recuperar como borrador (la web no cambia hasta volver a publicar).
 */
import { History, RotateCcw, Eye } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

const fmt = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("es-ES", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "Fecha desconocida";

export function VersionsPanel({ slug, open, onOpenChange, viewingId, onView, onRestore, restoring }: { slug: string; open: boolean; onOpenChange: (v: boolean) => void; viewingId: number | null; onView: (id: number, label: string) => void; onRestore: (id: number) => void; restoring: boolean }) {
  const versions = trpc.cms.pageVersions.useQuery({ slug }, { enabled: open && !!slug });
  const list = versions.data ?? [];
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
        <SheetHeader className="border-b border-border p-5">
          <SheetTitle className="flex items-center gap-2">
            <History className="h-5 w-5 text-[#5b5bf6]" /> Historial de versiones
          </SheetTitle>
          <SheetDescription>Cada vez que publicas se guarda una versión. Puedes verla y recuperarla: se carga como borrador y tu web no cambia hasta que vuelvas a publicar.</SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {versions.isLoading ? (
            <p className="p-3 text-sm text-muted-foreground">Cargando el historial…</p>
          ) : !list.length ? (
            <p className="p-3 text-sm text-muted-foreground">Todavía no hay versiones. Se guardará la primera cuando publiques esta página.</p>
          ) : (
            <ol className="space-y-2">
              {list.map((v) => (
                <li key={v.id} className={cn("rounded-lg border p-3", viewingId === v.id ? "border-[#5b5bf6] bg-[#5b5bf6]/5" : "border-border")}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">
                        Versión {v.number} {v.isCurrent && <span className="ml-1 rounded bg-emerald-100 px-1.5 py-0.5 text-[11px] font-semibold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">En tu web</span>}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {fmt(v.publishedAt)}
                        {v.author ? ` · ${v.author}` : ""}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {v.note === "Publicada" ? `${v.blockCount} bloques` : v.note}
                      </p>
                    </div>
                  </div>
                  <div className="mt-2 flex gap-2">
                    <Button size="sm" variant="outline" className="h-8" onClick={() => onView(v.id, `Versión ${v.number}`)}>
                      <Eye className="mr-1 h-3.5 w-3.5" /> Ver
                    </Button>
                    {!v.isCurrent && (
                      <Button size="sm" variant="ghost" className="h-8" disabled={restoring} onClick={() => onRestore(v.id)}>
                        <RotateCcw className="mr-1 h-3.5 w-3.5" /> Recuperar
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
