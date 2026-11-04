/**
 * Elephant Studio: selector rápido para añadir un módulo en un sitio concreto de la página (el «+» entre bloques, una
 * columna vacía o el final de la página). Los mismos módulos que la biblioteca (solo los de la licencia), con su
 * miniatura, buscador y «Mis bloques».
 */
import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { blockLabel, createBlock, type PageBlock } from "@shared/pageBlocks";
import { MODULE_FAMILIES, searchModules, type ModuleDef } from "@shared/studio/modules";
import { BlockThumb } from "./BlockThumb";

export function QuickInsert({
  open, where, modules, saved, onPick, onClose,
}: {
  open: boolean;
  /** Dónde se va a añadir, en palabras («al final de la página», «en la columna 2»…) */
  where: string;
  modules: ModuleDef[];
  saved: Array<{ id: string; name: string; block: PageBlock }>;
  onPick: (payload: string) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const found = useMemo(() => searchModules(modules, q), [modules, q]);
  const samples = useMemo(() => new Map(modules.map((m) => [m.type, [createBlock(m.type)] as PageBlock[]])), [modules]);
  const tile = (key: string, label: string, blocks: PageBlock[], payload: string, sub?: string) => (
    <button
      key={key}
      type="button"
      onClick={() => {
        setQ("");
        onPick(payload);
      }}
      className="flex flex-col gap-1.5 rounded-lg border border-border bg-background p-1.5 text-left transition-colors hover:border-[#5b5bf6]/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5b5bf6]"
    >
      <BlockThumb blocks={blocks} width={112} ratio={16 / 10} />
      <span className="px-0.5 text-xs font-medium leading-tight">{label}</span>
      {sub && <span className="-mt-1 px-0.5 text-[11px] text-muted-foreground">{sub}</span>}
    </button>
  );
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          setQ("");
          onClose();
        }
      }}
    >
      <DialogContent className="max-h-[85vh] overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="border-b border-border p-4">
          <DialogTitle>Añadir {where}</DialogTitle>
          <DialogDescription>Elige un módulo. Podrás cambiar sus textos sobre la página y su diseño en el panel derecho.</DialogDescription>
          <div className="relative pt-2">
            <Search className="pointer-events-none absolute left-2.5 top-[calc(50%+4px)] h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar módulos" aria-label="Buscar módulos" className="h-9 pl-8" />
          </div>
        </DialogHeader>
        <div className="max-h-[60vh] space-y-5 overflow-y-auto p-4">
          {!q.trim() && saved.length > 0 && (
            <section className="space-y-2">
              <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Mis bloques</h3>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">{saved.map((s) => tile(s.id, s.name, [s.block], `saved:${s.id}`, blockLabel(s.block.type)))}</div>
            </section>
          )}
          {MODULE_FAMILIES.map((fam) => {
            const list = found.filter((m) => m.family === fam.key);
            if (!list.length) return null;
            return (
              <section key={fam.key} className="space-y-2">
                <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{fam.label}</h3>
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">{list.map((m) => tile(m.type, m.label, samples.get(m.type) ?? [], `module:${m.type}`))}</div>
              </section>
            );
          })}
          {!found.length && <p className="text-sm text-muted-foreground">Ningún módulo coincide con «{q}».</p>}
        </div>
      </DialogContent>
    </Dialog>
  );
}
