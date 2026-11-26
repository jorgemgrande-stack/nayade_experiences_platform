import { useMemo } from "react";
import { useI18n } from "@/i18n/I18nProvider";
import { formatAmount, formatAxisEur, formatEur, formatEurCents, formatPercent, type MoneyLocale, type MoneyOptions } from "@/lib/money";

/** Formato de euros con el idioma del panel («1.234.567,89 €» en español y en alemán). */
export function useMoney() {
  const { locale } = useI18n();
  const l: MoneyLocale = locale === "de" ? "de" : "es";
  return useMemo(
    () => ({
      eur: (v: number | string | null | undefined, o?: MoneyOptions) => formatEur(v, { locale: l, ...o }),
      cents: (v: number | string | null | undefined, o?: MoneyOptions) => formatEurCents(v, { locale: l, ...o }),
      amount: (v: number | string | null | undefined, o?: MoneyOptions) => formatAmount(v, { locale: l, ...o }),
      pct: (v: number | null | undefined, maxDecimals?: number) => formatPercent(v, { locale: l, maxDecimals }),
      axis: (v: number | null | undefined) => formatAxisEur(v, { locale: l }),
    }),
    [l],
  );
}
