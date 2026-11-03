/**
 * Elephant Studio: el documento que se edita (los bloques de una página) con deshacer y rehacer (history.ts), y su
 * autoguardado como BORRADOR. Nada de lo que se edita llega a la web hasta que la persona pulsa «Publicar».
 */
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import type { PageBlock } from "@shared/pageBlocks";
import { mapBlock, syncSectionColumns } from "@shared/studio/tree";
import { docReducer, initialDoc as initial } from "./history";

const AUTOSAVE_MS = 1500;

export type SaveStatus = "idle" | "pending" | "saving" | "saved" | "error";

export function useStudioDocument(slug: string | null) {
  const utils = trpc.useUtils();
  const editor = trpc.cms.pageEditor.useQuery({ slug: slug ?? "" }, { enabled: !!slug, refetchOnWindowFocus: false });
  const saveDraft = trpc.cms.savePageDraft.useMutation();
  const [state, dispatch] = useReducer(docReducer, initial);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Si hay un borrador guardado sin publicar (se sabe al momento, sin esperar a que se refresque la lista de páginas)
  const [hasDraft, setHasDraft] = useState(false);
  const savedRevision = useRef(0);
  const loadedFor = useRef<string | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const slugRef = useRef(slug);
  slugRef.current = slug;

  // Al abrir una página: su borrador, o lo publicado, o su contenido antiguo convertido a bloques
  useEffect(() => {
    if (!slug || !editor.data || loadedFor.current === slug || editor.isFetching) return;
    loadedFor.current = slug;
    savedRevision.current = 0;
    dispatch({ type: "load", blocks: editor.data.blocks as PageBlock[] });
    setStatus("idle");
    setError(null);
    setHasDraft(editor.data.source === "draft");
    setSavedAt(editor.data.draftSavedAt ? new Date(editor.data.draftSavedAt) : null);
  }, [slug, editor.data, editor.isFetching]);

  const dirty = state.revision !== savedRevision.current;

  // La función de guardar es estable: el autoguardado solo se programa al cambiar el documento (si un guardado falla,
  // no se reintenta en bucle; se reintenta con el siguiente cambio o con «Guardar»)
  const mutateRef = useRef(saveDraft.mutateAsync);
  mutateRef.current = saveDraft.mutateAsync;

  const save = useCallback(async (): Promise<boolean> => {
    const s = stateRef.current;
    const target = slugRef.current;
    if (!target || loadedFor.current !== target) return false;
    if (s.revision === savedRevision.current) return true;
    setStatus("saving");
    try {
      await mutateRef.current({ slug: target, blocks: s.blocks });
      savedRevision.current = s.revision;
      setHasDraft(true);
      setSavedAt(new Date());
      setError(null);
      setStatus(stateRef.current.revision === s.revision ? "saved" : "pending");
      void utils.cms.sitePages.invalidate();
      return true;
    } catch (e) {
      setStatus("error");
      setError((e as Error).message || "No se ha podido guardar el borrador");
      return false;
    }
  }, [utils]);

  // Autoguardado del borrador poco después del último cambio
  useEffect(() => {
    if (state.revision === savedRevision.current || loadedFor.current !== slug) return;
    setStatus((st) => (st === "saving" ? st : "pending"));
    const t = setTimeout(() => void save(), AUTOSAVE_MS);
    return () => clearTimeout(t);
  }, [state.revision, slug, save]);

  const change = useCallback((blocks: PageBlock[], coalesceKey?: string) => dispatch({ type: "change", blocks, coalesceKey }), []);
  /**
   * Cambia un bloque a partir de su versión VIGENTE (lo usan el inspector, el lienzo y las subidas), esté en la página
   * o dentro de una columna. Si es una sección y cambia su reparto, sus columnas se ajustan sin perder contenido.
   */
  const updateBlock = useCallback(
    (id: string, fn: (b: PageBlock) => PageBlock, coalesceKey?: string) =>
      dispatch({ type: "apply", fn: (blocks) => mapBlock(blocks, id, (b) => syncSectionColumns(fn(b))), coalesceKey }),
    [],
  );

  /** Tras publicar (sin borrador) o recuperar una versión (queda como borrador) en el servidor: lo del editor ya está guardado. */
  const markSaved = useCallback((draftRemains: boolean) => {
    savedRevision.current = stateRef.current.revision;
    setHasDraft(draftRemains);
    setStatus("idle");
    setSavedAt(new Date());
  }, []);

  /** Vuelve a cargar la página desde el servidor (al descartar el borrador). */
  const reload = useCallback(async () => {
    loadedFor.current = null;
    await utils.cms.pageEditor.invalidate({ slug: slugRef.current ?? "" });
  }, [utils]);

  return {
    editor,
    loaded: !!slug && loadedFor.current === slug && !!editor.data,
    blocks: state.blocks,
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
    undo: () => dispatch({ type: "undo" }),
    redo: () => dispatch({ type: "redo" }),
    change,
    updateBlock,
    dirty,
    hasDraft,
    status,
    savedAt,
    error,
    save,
    markSaved,
    reload,
  };
}
