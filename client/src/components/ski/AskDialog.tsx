/**
 * Diálogo de confirmación con nota (shadcn) para las pantallas de Ski Net: sustituye a `window.prompt`/`confirm`.
 * `ask()` devuelve una promesa con el texto escrito (o "" si la nota es opcional) y null si se cancela.
 */
import { useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export interface AskOptions {
  title: string;
  description?: string;
  /** Texto del campo; sin él, es una confirmación simple. */
  label?: string;
  required?: boolean;
  confirmLabel?: string;
  destructive?: boolean;
}

export function useAsk(): { ask: (o: AskOptions) => Promise<string | null>; dialog: ReactNode } {
  const [opts, setOpts] = useState<AskOptions | null>(null);
  const [value, setValue] = useState("");
  const resolver = useRef<((v: string | null) => void) | null>(null);
  const finish = (v: string | null) => {
    resolver.current?.(v);
    resolver.current = null;
    setOpts(null);
  };
  const ask = (o: AskOptions) =>
    new Promise<string | null>((resolve) => {
      resolver.current = resolve;
      setValue("");
      setOpts(o);
    });
  const dialog = (
    <Dialog open={!!opts} onOpenChange={(o) => !o && finish(null)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{opts?.title}</DialogTitle>
          {opts?.description && <DialogDescription>{opts.description}</DialogDescription>}
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (opts?.required && !value.trim()) return;
            finish(value.trim());
          }}
        >
          {opts?.label && (
            <label className="block space-y-1.5 text-sm font-medium text-foreground">
              <span>
                {opts.label}
                {opts.required && <span className="text-destructive"> *</span>}
              </span>
              <Textarea rows={3} value={value} onChange={(e) => setValue(e.target.value)} maxLength={300} autoFocus required={opts.required} />
            </label>
          )}
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={() => finish(null)}>
              Cancelar
            </Button>
            <Button type="submit" variant={opts?.destructive ? "destructive" : "default"} disabled={!!opts?.required && !value.trim()}>
              {opts?.confirmLabel ?? "Aceptar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
  return { ask, dialog };
}
