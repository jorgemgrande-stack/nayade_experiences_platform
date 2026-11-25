/**
 * Elephant Studio — historial de versiones publicadas de la página. Cada publicación guarda una versión; cualquiera
 * se puede ver en el lienzo y recuperar como borrador (la web no cambia hasta volver a publicar).
 */
import { History, RotateCcw, Eye } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { PanelEmpty, PanelError, PanelLoading } from "@/components/admin/PanelStates";
import { cn } from "@/lib/utils";
import { useStudioText } from "@/components/admin/studio/useStudioText";
import { useI18n } from "@/i18n/I18nProvider";


export function VersionsPanel({ slug, open, onOpenChange, viewingId, onView, onRestore, restoring }: { slug: string; open: boolean; onOpenChange: (v: boolean) => void; viewingId: number | null; onView: (id: number, label: string) => void; onRestore: (id: number) => void; restoring: boolean }) {
  const tx = useStudioText();
  const { format } = useI18n();
  const versions = trpc.cms.pageVersions.useQuery({ slug }, { enabled: open && !!slug });
  const list = versions.data ?? [];
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
        <SheetHeader className="border-b border-border p-5">
          <SheetTitle className="flex items-center gap-2">
            <History className="h-5 w-5 text-primary" />{" "}{tx("Historial de versiones")}</SheetTitle>
          <SheetDescription>{tx("Cada vez que publicas se guarda una versión. Puedes verla y recuperarla: se carga como borrador y tu web no cambia hasta que vuelvas a publicar.")}</SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {versions.isLoading ? (
            <PanelLoading label={tx("Cargando el historial…")} />
          ) : versions.error ? (
            <PanelError error={versions.error} onRetry={() => void versions.refetch()} />
          ) : !list.length ? (
            <PanelEmpty icon={<History className="h-5 w-5" />} title={tx("Todavía no hay versiones. Se guardará la primera cuando publiques esta página.")} />
          ) : (
            <ol className="space-y-3">
              {list.map((v) => (
                <li key={v.id} className={cn("rounded-xl border p-3 shadow-sm", viewingId === v.id ? "border-primary bg-primary/5 ring-1 ring-primary/40" : "border-border bg-card")}>
                  <div className="flex items-start gap-3">
                    <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-sm font-semibold tabular-nums", v.isCurrent ? "bg-success/15 text-success" : "bg-muted text-muted-foreground")} aria-hidden="true">{v.number}</span>
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-1.5 text-sm font-semibold text-foreground">
                        {tx("Versión")}{" "}{v.number}
                        {v.isCurrent && <span className="rounded-full border border-success/40 bg-success/10 px-2 py-0.5 text-xs font-medium text-success">{tx("En tu web")}</span>}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {v.publishedAt ? format.dateTime(v.publishedAt, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : tx("Fecha desconocida")}
                        {v.author ? tx(" · {author}", { author: v.author }) : ""}
                      </p>
                      <p className="mt-0.5 break-words text-xs text-muted-foreground">
                        {v.note === "Publicada" ? tx("{blockCount} bloques", { blockCount: v.blockCount }) : v.note}
                      </p>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" className="h-10 flex-1" onClick={() => onView(v.id, tx("Versión {n}", { n: v.number }))}>
                      <Eye className="mr-1 h-4 w-4" />{" "}{tx("Ver")}</Button>
                    {!v.isCurrent && (
                      <Button size="sm" variant="secondary" className="h-10 flex-1" disabled={restoring} onClick={() => onRestore(v.id)}>
                        <RotateCcw className="mr-1 h-4 w-4" />{" "}{tx("Recuperar")}</Button>
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
