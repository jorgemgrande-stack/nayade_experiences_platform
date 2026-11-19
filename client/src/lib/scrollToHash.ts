/**
 * Desplazamiento a una sección de la página por su ancla (`#contacto`, `/reconnect#solicitud`), 18/11/2026.
 *
 * En la web pública las páginas se pintan DESPUÉS de cargar sus bloques: al entrar con un ancla, la sección aún no
 * existe cuando el navegador intenta ir a ella, y un enlace `#id` dentro de la misma página no cambia de ruta para el
 * enrutador. Aquí se espera a que la sección exista (hasta unos segundos) y se desplaza teniendo en cuenta la
 * cabecera fija, para que el título de la sección no quede debajo.
 */

/** Altura de la cabecera fija de la web (si la hay) más un pequeño margen. */
function headerOffset(): number {
  const header = document.querySelector("header");
  if (!header) return 0;
  const pos = getComputedStyle(header).position;
  return pos === "fixed" || pos === "sticky" ? Math.round(header.getBoundingClientRect().height) + 12 : 0;
}

/** Id del ancla (sin «#», decodificado) o null. */
export function hashTarget(hash: string): string | null {
  if (!hash || hash.length < 2 || !hash.startsWith("#")) return null;
  // «#solicitud?experiencia=X»: el ancla es lo anterior a «?» (lo demás rellena el formulario, ver shared/studio/formPrefill.ts)
  const raw = hash.slice(1).split("?")[0];
  if (!raw) return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/** Posición de destino (pura: la usan las pruebas). */
export function targetTop(elementTop: number, scrollY: number, offset: number): number {
  return Math.max(0, Math.round(elementTop + scrollY - offset));
}

/**
 * Desplaza hasta el elemento del ancla cuando exista (reintenta durante `timeoutMs`). Devuelve una función para
 * cancelar la espera. `onMissing` se llama si al final no aparece.
 */
export function scrollToHash(hash: string, o: { smooth?: boolean; timeoutMs?: number; onMissing?: () => void } = {}): () => void {
  const id = hashTarget(hash);
  if (!id) return () => undefined;
  const deadline = Date.now() + (o.timeoutMs ?? 4000);
  let timer: ReturnType<typeof setTimeout> | null = null;
  let cancelled = false;
  const attempt = () => {
    if (cancelled) return;
    const el = document.getElementById(id);
    if (el) {
      // Un instante más para que terminen de pintarse las imágenes y bloques de encima (si no, el destino se mueve)
      timer = setTimeout(() => {
        if (cancelled) return;
        const top = targetTop(el.getBoundingClientRect().top, window.scrollY, headerOffset());
        window.scrollTo({ top, behavior: o.smooth === false ? ("instant" as ScrollBehavior) : "smooth" });
      }, 120);
      return;
    }
    if (Date.now() >= deadline) {
      o.onMissing?.();
      return;
    }
    timer = setTimeout(attempt, 100);
  };
  attempt();
  return () => {
    cancelled = true;
    if (timer) clearTimeout(timer);
  };
}
