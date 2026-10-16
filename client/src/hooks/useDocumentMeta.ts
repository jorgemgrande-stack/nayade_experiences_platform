import { useEffect } from "react";

export interface DocumentMeta {
  title?: string | null;
  description?: string | null;
  /** URL canónica absoluta; por defecto, la URL actual sin parámetros de consulta salvo los indicados. */
  canonical?: string | null;
  image?: string | null;
}

function setMeta(attr: "name" | "property", key: string, value: string) {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute("content", value);
}

function setCanonical(href: string) {
  let el = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!el) {
    el = document.createElement("link");
    el.rel = "canonical";
    document.head.appendChild(el);
  }
  el.href = href;
}

/**
 * Título, descripción, canonical y Open Graph al navegar dentro de la web (el HTML inicial ya los
 * trae del servidor; esto los mantiene al cambiar de página sin recargar). Restaura el título al salir.
 */
export function useDocumentMeta(meta: DocumentMeta | null) {
  const key = meta ? JSON.stringify(meta) : "";
  useEffect(() => {
    if (!meta) return;
    const prevTitle = document.title;
    if (meta.title) {
      document.title = meta.title;
      setMeta("property", "og:title", meta.title);
      setMeta("name", "twitter:title", meta.title);
    }
    if (meta.description) {
      setMeta("name", "description", meta.description);
      setMeta("property", "og:description", meta.description);
      setMeta("name", "twitter:description", meta.description);
    }
    const canonical = meta.canonical ?? `${window.location.origin}${window.location.pathname}`;
    setCanonical(canonical);
    setMeta("property", "og:url", canonical);
    if (meta.image) {
      setMeta("property", "og:image", meta.image);
      setMeta("name", "twitter:image", meta.image);
    }
    return () => {
      document.title = prevTitle;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}
