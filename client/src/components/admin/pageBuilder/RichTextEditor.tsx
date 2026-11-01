/**
 * Texto con formato sencillo para los bloques de la web: negrita, cursiva, subtítulo, listas y enlaces, sin HTML a la
 * vista. Lo que se pega llega como texto sin formato (sin estilos de otras webs ni de procesadores de texto). El
 * servidor sanea el resultado con su lista blanca al guardar.
 */
import { useEffect, useRef, useState } from "react";
import { Bold, Heading2, Italic, Link2, List, ListOrdered, Unlink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const TOOLS = [
  { cmd: "bold", label: "Negrita", icon: Bold },
  { cmd: "italic", label: "Cursiva", icon: Italic },
  { cmd: "h3", label: "Subtítulo", icon: Heading2 },
  { cmd: "insertUnorderedList", label: "Lista", icon: List },
  { cmd: "insertOrderedList", label: "Lista numerada", icon: ListOrdered },
] as const;

export function RichTextEditor({ value, onChange, id, ariaLabel }: { value: string; onChange: (html: string) => void; id?: string; ariaLabel: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const saved = useRef<Range | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [link, setLink] = useState("");

  // El contenido solo se escribe desde fuera cuando cambia de verdad (no mientras se escribe: el cursor no salta)
  useEffect(() => {
    const el = ref.current;
    if (el && el.innerHTML !== value && document.activeElement !== el) el.innerHTML = value;
  }, [value]);

  const emit = () => {
    if (ref.current) onChange(ref.current.innerHTML);
  };

  const run = (cmd: string) => {
    ref.current?.focus();
    if (cmd === "h3") {
      const inHeading = document.queryCommandValue("formatBlock").toLowerCase() === "h3";
      document.execCommand("formatBlock", false, inHeading ? "p" : "h3");
    } else document.execCommand(cmd, false);
    emit();
  };

  const openLink = () => {
    const sel = window.getSelection();
    saved.current = sel && sel.rangeCount && ref.current?.contains(sel.anchorNode) ? sel.getRangeAt(0).cloneRange() : null;
    setLink("");
    setLinkOpen(true);
  };

  const applyLink = () => {
    const url = link.trim();
    setLinkOpen(false);
    if (!url || !saved.current) return;
    ref.current?.focus();
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(saved.current);
    const href = /^(https?:|mailto:|tel:|\/|#)/i.test(url) ? url : /@/.test(url) ? `mailto:${url}` : `https://${url}`;
    if (saved.current.collapsed) document.execCommand("insertHTML", false, `<a href="${href.replace(/"/g, "&quot;")}">${url.replace(/[<>&]/g, "")}</a>`);
    else document.execCommand("createLink", false, href);
    emit();
  };

  return (
    <div className="rounded-md border border-input bg-background focus-within:ring-2 focus-within:ring-ring/40">
      <div className="flex flex-wrap items-center gap-0.5 border-b border-border px-1.5 py-1" role="toolbar" aria-label={`Formato de ${ariaLabel.toLowerCase()}`}>
        {TOOLS.map((t) => (
          <Button key={t.cmd} type="button" variant="ghost" size="icon" className="h-8 w-8" title={t.label} aria-label={t.label} onMouseDown={(e) => e.preventDefault()} onClick={() => run(t.cmd)}>
            <t.icon className="h-4 w-4" />
          </Button>
        ))}
        <Button type="button" variant="ghost" size="icon" className="h-8 w-8" title="Enlace" aria-label="Enlace" onMouseDown={(e) => e.preventDefault()} onClick={openLink}>
          <Link2 className="h-4 w-4" />
        </Button>
        <Button type="button" variant="ghost" size="icon" className="h-8 w-8" title="Quitar enlace" aria-label="Quitar enlace" onMouseDown={(e) => e.preventDefault()} onClick={() => run("unlink")}>
          <Unlink className="h-4 w-4" />
        </Button>
      </div>
      {linkOpen && (
        <div className="flex flex-col gap-2 border-b border-border bg-muted/40 p-2 sm:flex-row sm:items-center">
          <Input
            autoFocus
            value={link}
            onChange={(e) => setLink(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                applyLink();
              }
              if (e.key === "Escape") setLinkOpen(false);
            }}
            placeholder="A dónde lleva: /contacto, www.tuweb.es o un correo"
            aria-label="A dónde lleva el enlace"
            className="h-8"
          />
          <div className="flex gap-2">
            <Button type="button" size="sm" onClick={applyLink}>
              Añadir enlace
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setLinkOpen(false)}>
              Cancelar
            </Button>
          </div>
        </div>
      )}
      <div
        ref={ref}
        id={id}
        role="textbox"
        aria-multiline="true"
        aria-label={ariaLabel}
        contentEditable
        suppressContentEditableWarning
        onInput={emit}
        onBlur={emit}
        onPaste={(e) => {
          e.preventDefault();
          const text = e.clipboardData.getData("text/plain");
          document.execCommand("insertText", false, text);
          emit();
        }}
        className={cn(
          "min-h-[120px] max-w-none break-words px-3 py-2 text-sm leading-relaxed outline-none",
          "[&_h3]:mt-3 [&_h3]:text-base [&_h3]:font-semibold [&_p]:my-2 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5",
          "[&_a]:text-primary [&_a]:underline [&_h1]:text-lg [&_h1]:font-bold [&_h2]:text-base [&_h2]:font-semibold [&_table]:my-2 [&_td]:border [&_td]:p-1 [&_img]:max-h-40",
        )}
      />
    </div>
  );
}
