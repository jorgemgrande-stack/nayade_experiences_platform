import { Languages } from "lucide-react";
import { LOCALES, LOCALE_META, type Locale } from "@shared/i18n/core";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { useI18n } from "./I18nProvider";

/**
 * Selector del idioma de la interfaz (cabecera del panel). Botón con el idioma actual; la lista es un grupo de opciones
 * (`role=radiogroup`) accesible por teclado: Tab para entrar, flechas para moverse, Enter/Espacio para elegir, Esc para cerrar.
 * Los nombres van escritos en su propio idioma (sin banderas).
 */
export default function LanguageSelect() {
  const { locale, setLocale, t } = useI18n();
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="h-9 gap-1.5 px-2 text-xs" aria-label={t("shell.language.change")} data-testid="language-select">
          <Languages className="h-4 w-4" aria-hidden="true" />
          <span className="font-medium uppercase">{locale}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-48 p-1">
        <p className="px-2 pb-1 pt-1.5 text-xs font-semibold text-muted-foreground" id="language-select-label">{t("shell.language.interface")}</p>
        <div role="radiogroup" aria-labelledby="language-select-label" className="flex flex-col">
          {LOCALES.map((l: Locale) => (
            <button
              key={l}
              type="button"
              role="radio"
              aria-checked={locale === l}
              lang={l}
              onClick={() => setLocale(l)}
              onKeyDown={(e) => {
                if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
                e.preventDefault();
                const next = LOCALES[(LOCALES.indexOf(l) + (e.key === "ArrowDown" ? 1 : LOCALES.length - 1)) % LOCALES.length];
                (e.currentTarget.parentElement?.querySelector(`[lang="${next}"]`) as HTMLElement | null)?.focus();
              }}
              className={`flex items-center justify-between rounded-md px-2 py-2 text-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${locale === l ? "font-semibold" : ""}`}
            >
              <span>{LOCALE_META[l].autonym}</span>
              {locale === l && <span aria-hidden="true">✓</span>}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
