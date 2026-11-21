import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { createFormatters, createTranslator, DEFAULT_LOCALE, resolveLocale, type Formatters, type Locale, type Translate } from "@shared/i18n/core";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { FLAT } from "./catalog";

/**
 * Idioma de la INTERFAZ del panel. Individual por usuario: se guarda en el servidor (`user_ui_prefs`) y, para pintar sin
 * parpadeo, también en el navegador con la clave del propio usuario (en un equipo compartido no se mezclan personas).
 * No toca contenidos de la empresa ni el idioma de otros usuarios.
 */
const STORAGE_PREFIX = "panel.uiLocale.";

function readStored(userId: unknown): string | null {
  try {
    return userId == null ? null : window.localStorage.getItem(STORAGE_PREFIX + String(userId));
  } catch {
    return null;
  }
}
function writeStored(userId: unknown, locale: Locale) {
  try {
    if (userId != null) window.localStorage.setItem(STORAGE_PREFIX + String(userId), locale);
  } catch {
    /* sin almacenamiento: solo se pierde el respaldo local */
  }
}

interface I18nValue {
  locale: Locale;
  t: Translate;
  format: Formatters;
  setLocale: (l: Locale) => void;
}

const fallback: I18nValue = {
  locale: DEFAULT_LOCALE,
  t: createTranslator(DEFAULT_LOCALE, FLAT).t,
  format: createFormatters(DEFAULT_LOCALE),
  setLocale: () => {},
};

const Ctx = createContext<I18nValue>(fallback);

export function I18nProvider({ children }: { children: ReactNode }) {
  const { user, isAuthenticated } = useAuth();
  const userId = (user as { id?: number } | null)?.id ?? null;
  const utils = trpc.useUtils();
  const saved = trpc.uiLocale.get.useQuery(undefined, { enabled: isAuthenticated, staleTime: Infinity, retry: false, refetchOnWindowFocus: false });
  const persist = trpc.uiLocale.set.useMutation({
    onSuccess: (r, v) => {
      if (r.persisted) utils.uiLocale.get.setData(undefined, { locale: v.locale });
    },
  });

  const [chosen, setChosen] = useState<Locale | null>(null);
  // Cambia el usuario (otra sesión en el mismo navegador): se descarta la elección en memoria de la persona anterior
  useEffect(() => setChosen(null), [userId]);

  const locale: Locale = useMemo(
    () => chosen ?? resolveLocale({ saved: saved.data?.locale, stored: readStored(userId) }),
    [chosen, saved.data?.locale, userId],
  );

  // Con la preferencia del servidor ya leída, se copia al navegador (respaldo para el siguiente primer pintado)
  useEffect(() => {
    if (saved.data?.locale && userId != null) writeStored(userId, locale);
  }, [saved.data?.locale, locale, userId]);

  // `lang` del documento solo en el panel: la web pública de la empresa gestiona el suyo (idioma del CONTENIDO, no de la interfaz)
  useEffect(() => {
    if (!window.location.pathname.startsWith("/admin")) return;
    const previous = document.documentElement.lang;
    document.documentElement.lang = locale;
    return () => {
      document.documentElement.lang = previous;
    };
  }, [locale]);

  const setLocale = useCallback(
    (l: Locale) => {
      setChosen(l);
      writeStored(userId, l);
      if (isAuthenticated) persist.mutate({ locale: l });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [userId, isAuthenticated],
  );

  const value = useMemo<I18nValue>(
    () => ({
      locale,
      t: createTranslator(locale, FLAT, (key, loc) => {
        if (import.meta.env?.DEV) console.warn(`[i18n] falta «${key}» en ${loc}; se usa el español`);
      }).t,
      format: createFormatters(locale),
      setLocale,
    }),
    [locale, setLocale],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Traductor, idioma actual y selector: `const { t, locale, setLocale } = useI18n()`. */
export const useI18n = () => useContext(Ctx);
/** Fechas, números y monedas en el idioma del usuario. */
export const useFormat = (): Formatters => useContext(Ctx).format;
