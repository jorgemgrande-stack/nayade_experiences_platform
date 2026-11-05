/**
 * Extensiones del menú que la persona ya ha descubierto (ha entrado en alguna de sus pantallas): apaga la marca
 * «Nuevo» (shared/panelNews.ts). Se recuerda en este navegador, por persona; si el almacenamiento no está disponible,
 * la marca se apaga igualmente durante la sesión.
 */
import { useCallback, useState } from "react";

const keyOf = (userId: string | number | null) => `be.panel.discoveredExtensions:${userId ?? "anon"}`;

function read(key: string): Set<string> {
  try {
    const v = JSON.parse(window.localStorage.getItem(key) ?? "[]");
    return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

export function useDiscoveredExtensions(userId: string | number | null) {
  const key = keyOf(userId);
  const [state, setState] = useState(() => ({ key, set: read(key) }));
  const discovered = state.key === key ? state.set : read(key);
  const markDiscovered = useCallback(
    (moduleIds: string[]) => {
      setState((prev) => {
        const base = prev.key === key ? prev.set : read(key);
        if (moduleIds.every((m) => base.has(m))) return prev.key === key ? prev : { key, set: base };
        const next = new Set(base);
        for (const m of moduleIds) next.add(m);
        try {
          window.localStorage.setItem(key, JSON.stringify(Array.from(next)));
        } catch {
          // Sin almacenamiento: solo esta sesión
        }
        return { key, set: next };
      });
    },
    [key],
  );
  return { discovered, markDiscovered };
}
