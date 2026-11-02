/**
 * Elephant Studio — lienzo. Se carga dentro de un marco del editor (mismo origen) y pinta la página con la cabecera,
 * el pie, los colores y la tipografía de la web de la empresa, con el MISMO componente que la web publicada
 * (PageBlocksView). Como es un documento propio, el ancho del marco (ordenador, tableta o móvil) activa el diseño
 * adaptable real.
 *
 * No consulta ni guarda nada por su cuenta: recibe el documento del editor y le devuelve lo que hace la persona
 * (seleccionar, escribir sobre la página, soltar módulos, reordenar). Ver components/admin/studio/protocol.ts.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import PublicLayout from "@/components/PublicLayout";
import { PageBlocksView, StudioEditContext, type StudioEdit } from "@/components/site/PageBlocksView";
import { DRAG_MIME, isToCanvas, parseDragPayload, type FromCanvas, type ToCanvas } from "@/components/admin/studio/protocol";
import { renderTokens } from "@/components/admin/studio/tokens";

const EDITABLE_CSS = `
.studio-editable{outline:none;cursor:text;border-radius:4px;box-shadow:0 0 0 1px rgba(91,91,246,.35);transition:box-shadow .12s}
.studio-editable:hover{box-shadow:0 0 0 1px rgba(91,91,246,.7)}
.studio-editable:focus{box-shadow:0 0 0 2px #5b5bf6;background:rgba(91,91,246,.05)}
.studio-editable:empty::before{content:attr(data-placeholder);opacity:.45;pointer-events:none}
html{scroll-behavior:smooth}
`;

function post(msg: FromCanvas) {
  if (window.parent && window.parent !== window) window.parent.postMessage({ ...msg, studio: 1 }, window.location.origin);
}

export default function StudioCanvas() {
  const [state, setState] = useState<ToCanvas | null>(null);
  const lastLocalSelect = useRef<string | null>(null);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin || e.source !== window.parent || !isToCanvas(e.data)) return;
      setState(e.data);
    };
    window.addEventListener("message", onMessage);
    post({ kind: "ready" });
    return () => window.removeEventListener("message", onMessage);
  }, []);

  // Selección hecha desde el editor (estructura, deshacer…): el bloque se trae a la vista
  const selectedId = state?.selectedId ?? null;
  useEffect(() => {
    if (!selectedId || selectedId === lastLocalSelect.current) return;
    lastLocalSelect.current = selectedId;
    document.querySelector(`[data-studio-block="${CSS.escape(selectedId)}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selectedId]);

  // Enlaces de la cabecera y el pie: no navegan dentro del lienzo; el editor abre esa página si es de la web
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const a = (e.target as Element | null)?.closest?.("a[href]");
      if (!a) return;
      e.preventDefault();
      if (a.closest("[data-studio-block]")) return;
      e.stopPropagation();
      post({ kind: "navigate", href: a.getAttribute("href") ?? "" });
    };
    const onSubmit = (e: Event) => e.preventDefault();
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const ctrl = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      // Ctrl+S guarda también mientras se escribe sobre la página: primero se confirma el texto (al perder el foco)
      if (ctrl && k === "s") {
        e.preventDefault();
        if (t?.isContentEditable) t.blur();
        post({ kind: "key", key: k, ctrl, shift: e.shiftKey });
        return;
      }
      if (t?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t?.tagName ?? "")) return;
      if (["delete", "backspace", "escape"].includes(k) || (ctrl && ["z", "y", "s", "d", "c", "v"].includes(k) && !(k === "c" && window.getSelection()?.toString()))) {
        e.preventDefault();
        post({ kind: "key", key: k, ctrl, shift: e.shiftKey });
      }
    };
    document.addEventListener("click", onClick, true);
    document.addEventListener("submit", onSubmit, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("submit", onSubmit, true);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  const select = useCallback((id: string | null) => {
    lastLocalSelect.current = id;
    post({ kind: "select", id });
  }, []);

  const edit: StudioEdit | null = useMemo(() => {
    if (!state) return null;
    return {
      selectedId: state.selectedId,
      device: state.device,
      readOnly: state.readOnly,
      raw: new Map(state.blocks.map((b) => [b.id, b])),
      onSelect: select,
      onText: (id, key, value) => post({ kind: "text", id, key, value }),
      onAction: (id, action) => post({ kind: "action", id, action }),
      onDrop: (payload, index) => {
        const p = parseDragPayload(payload);
        if (!p) return;
        if (p.what === "block") post({ kind: "move", id: p.value, index });
        else post({ kind: "drop", payload, index });
      },
      dragTypes: (types) => types.includes(DRAG_MIME) || types.includes("text/plain"),
      readDrop: (dt) => {
        const v = dt.getData(DRAG_MIME) || dt.getData("text/plain");
        return parseDragPayload(v) ? v : "";
      },
    };
  }, [state, select]);

  const shown = useMemo(() => (state ? renderTokens(state.blocks, state.tokens) : []), [state]);

  return (
    <div
      onClick={(e) => {
        // Clic fuera de los bloques (cabecera, pie, márgenes): nada seleccionado, se ven los ajustes de la página
        if (!(e.target as Element).closest("[data-studio-block]") && state?.selectedId) select(null);
      }}
    >
      <style>{EDITABLE_CSS}</style>
      <PublicLayout>
        {!state || !edit ? (
          <div className="flex min-h-[50vh] items-center justify-center" role="status" aria-label="Cargando">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        ) : (
          <StudioEditContext.Provider value={edit}>
            <PageBlocksView blocks={shown} pageTitle={state.pageTitle} />
          </StudioEditContext.Provider>
        )}
      </PublicLayout>
    </div>
  );
}
